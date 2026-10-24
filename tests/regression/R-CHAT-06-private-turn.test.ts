import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {advanceChatNarrativeTurnV1, createChatNarrativeSituationV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {previewChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {previewChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {parseChatTurnDirectionV1} from '../../src/lib/character-interaction/narrative-contract'
import {chatTurnHasPrivateSceneBoundaryV1} from '../../src/lib/character-interaction/narrative-audience'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, leaveInteractionParticipant, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1, ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
function action(): ChatNarrativeActionV1 {
  return {kind: 'speak', text: '我轻声答应，先独自核对账簿。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
    audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
}
function mock(getAction: () => ChatNarrativeActionV1 = action) {
  return vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(getAction())), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())}))
}

it.each(['manual', 'natural', 'round-robin'] as const)('binds private replies and later explicit continuation to the conversation: %s', async schedulingMode => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3}), spy = mock(), worlds = await db.worldReleases.toArray()
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'private', text: '这段只对你说。', audienceKeys: ['guard']})
  // A later public UI selection cannot widen the already-sent private message.
  await advanceChatNarrativeTurnV1({...f, expectedSequence: message.sequence, kind: 'player-response', replyToSequence: message.sequence, actionLimit: 2, schedulingMode, audienceKeys: null, aiConfig: {} as never})
  let state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers[0].direction).toMatchObject({actorKey: 'guard', audienceParticipantKeys: ['guard'], conversationMode: 'private'})
  expect(state.messages).toHaveLength(3)
  expect(interactionVisibilityView(state, 'artisan').messages).toHaveLength(0)
  await advanceChatNarrativeTurnV1({...f, expectedSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, kind: 'continue', actionLimit: 1, schedulingMode, audienceKeys: ['guard'], aiConfig: {} as never})
  state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.triggers[1].direction?.audienceParticipantKeys).toEqual(['guard'])
  expect(interactionVisibilityView(state, 'artisan').messages).toHaveLength(0)
  expect(spy).toHaveBeenCalledTimes(3)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
})

it('rejects a widened model reply before adoption, keeps the actual private message and does not retry on resume', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), spy = mock(() => ({...action(), audienceKeys: ['player', 'guard', 'artisan']}))
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'private', text: '不能向旁人公开。', audienceKeys: ['guard']})
  await expect(advanceChatNarrativeTurnV1({...f, expectedSequence: message.sequence, kind: 'player-response', replyToSequence: message.sequence, actionLimit: 1, aiConfig: {} as never})).rejects.toThrow('听众范围')
  const state = await readProductRuntimeState(f.sessionId)
  expect(state.interaction!.messages).toHaveLength(1)
  await expect(resumeChatNarrativeTurnV1({...f, expectedSequence: state.lastSequence, aiConfig: {} as never})).rejects.toThrow()
  expect(spy).toHaveBeenCalledTimes(1)
  expect(interactionVisibilityView(state.interaction!, 'artisan').messages).toHaveLength(0)
})

it('rejects an absent private recipient before trigger creation and does not fall back to another role', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), spy = mock()
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'guard'})
  const before = await readProductRuntimeState(f.sessionId)
  await expect(advanceChatNarrativeTurnV1({...f, expectedSequence: before.lastSequence, kind: 'continue', audienceKeys: ['guard'], aiConfig: {} as never})).rejects.toThrow('离场')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(spy).not.toHaveBeenCalled()
})

it('preserves a private incomplete turn through branch, import and zero-call reopen, then resumes only its original role', async () => {
  const f = await seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3}), spy = mock()
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence,
    direction: {actorKey: 'guard', actionLimit: 2, audienceParticipantKeys: ['guard']}})
  const result = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, skillId: 'character.chat-narrative-action', participantKey: 'guard', objective: '私聊工程夹具'})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'private branch'})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
  const scope = {projectId, workId: restored.workId, worldId: restored.worldId}
  db.close(); await db.open()
  expect(spy).toHaveBeenCalledTimes(1)
  await resumeChatNarrativeTurnV1({scope, sessionId: restored.id!, expectedSequence: 0, aiConfig: {} as never})
  const state = (await readProductRuntimeState(restored.id!)).interaction!
  expect(state.messages).toHaveLength(2)
  expect(state.chatNarrative!.triggers[0].direction?.audienceParticipantKeys).toEqual(['guard'])
  expect(interactionVisibilityView(state, 'artisan').messages).toHaveLength(0)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(1)
  expect(spy).toHaveBeenCalledTimes(2)
})

it('closes the direction schema over the actor, scheduling pool and original message listeners', async () => {
  expect(parseChatTurnDirectionV1({actorKey: 'guard', actionLimit: 1}, ['guard', 'artisan'], 3)).toEqual({actorKey: 'guard', actionLimit: 1})
  for (const direction of [
    {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: []},
    {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['artisan']},
    {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard', 'guard']},
    {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], scheduling: {mode: 'natural', participantKeys: ['guard', 'artisan']}},
    {actorKey: 'guard', actionLimit: 1, conversationMode: 'present'},
    {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], conversationMode: 'invalid'},
    {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], conversationMode: ['private']},
    {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], conversationMode: null},
  ]) expect(() => parseChatTurnDirectionV1(direction, ['guard', 'artisan'], 3)).toThrow()
  const f = await seedChatNarrativeRuntimeFixture()
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'scope', text: '原私聊', audienceKeys: ['guard']})
  await expect(requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: message.sequence,
    direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard', 'artisan']}})).rejects.toThrow('扩大')
  await expect(requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: message.sequence,
    direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], conversationMode: 'present'}})).rejects.toThrow('私聊消息')
  await expect(requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: message.sequence,
    direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], conversationMode: 'present'}})).rejects.toThrow('全部在场角色')
})

it.each(['private', 'present'] as const)('preserves explicit %s intent with the same actual listeners through branch/import and applies the correct scene boundary', async mode => {
  const f = await seedChatNarrativeRuntimeFixture()
  const spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockRejectedValue(new Error('before provider'))
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'scope', text: '门边有一把备用钥匙。', audienceKeys: mode === 'private' ? ['guard'] : null})
  await expect(advanceChatNarrativeTurnV1({...f, expectedSequence: message.sequence, kind: 'player-response', replyToSequence: message.sequence,
    audienceKeys: null, actionLimit: 1, aiConfig: {} as never})).rejects.toThrow('before provider')
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: mode})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === child.title)!
  db.close(); await db.open()
  const state = (await readProductRuntimeState(restored.id!)).interaction!
  expect(state.messages[0]).toMatchObject({audienceKeys: ['player', 'guard'], playerConversation: mode})
  expect(state.chatNarrative!.triggers[0].direction).toMatchObject({audienceParticipantKeys: ['guard'], conversationMode: mode})
  expect(interactionVisibilityView(state, 'artisan').messages).toHaveLength(0)
  expect(chatTurnHasPrivateSceneBoundaryV1(state, {audienceParticipantKeys: ['guard', 'artisan'], conversationMode: 'private'})).toBe(true)
  expect(chatTurnHasPrivateSceneBoundaryV1(state, {audienceParticipantKeys: ['guard']})).toBe(true)
  // An explicit new background request exercises metadata rules without inventing a model result.
  const base = await command(restored.id!)
  const requested = await requestChatNarrativeTrigger({...base, kind: 'player-seed', sourceEventSequence: base.baseSequence, seed: '门边有一把备用钥匙。',
    direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], conversationMode: mode}})
  const ready = (await readProductRuntimeState(restored.id!)).interaction!, situation = ready.chatNarrative!.situation
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: '查看门边钥匙', location: situation.location, timeLabel: situation.timeLabel,
    newFacts: [{factKey: 'side-key', kind: 'object', text: '门边有一把备用钥匙。', audienceKeys: ['player', 'guard'], evidenceFactKeys: ['lost'], seedExcerpt: '门边有一把备用钥匙'}], newGoals: [], newThreads: [], possibilities: []}
  const preview = () => previewChatSituationV1(ready, {sequence: requested.sequence + 1, triggerSequence: requested.sequence, draft})
  if (mode === 'private') expect(preview).toThrow('共用的场景')
  else expect(preview().chatNarrative!.situation.title).toBe(draft.title)
  expect(spy).toHaveBeenCalledTimes(1)
})

it.each([false, true])('cannot bypass send-time privacy through a low-level trigger missing audience fields (direction: %s)', async directed => {
  const f = await seedChatNarrativeRuntimeFixture()
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'private-api', text: '只向守卫说明。', audienceKeys: ['guard']})
  const trigger = await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'player-response', sourceEventSequence: message.sequence,
    ...(directed ? {direction: {actorKey: 'guard', actionLimit: 1}} : {})})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  const input = {sequence: trigger.sequence + 1, triggerSequence: trigger.sequence, actorKey: 'guard', messageId: 'reply', action: action()}
  expect(() => previewChatNarrativeActionV1(state, {...input, action: {...action(), audienceKeys: ['player', 'guard', 'artisan']}})).toThrow('听众范围')
  expect(previewChatNarrativeActionV1(state, input).messages).toHaveLength(2)
  expect((await readProductRuntimeState(f.sessionId)).interaction).toEqual(state)
})

it('keeps private situations and consequences out of other roles and shared scene metadata', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), spy = vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockRejectedValue(new Error('before provider'))
  await expect(createChatNarrativeSituationV1({...f, expectedSequence: f.sceneSequence, seed: '门边有一把备用钥匙，先私下查看。', audienceKeys: ['guard'], actionLimit: 1, aiConfig: {} as never})).rejects.toThrow('before provider')
  const full = await readProductRuntimeState(f.sessionId), state = full.interaction!, situation = state.chatNarrative!.situation
  const originalPossibilities = structuredClone(situation.possibilities.filter(p => p.actorKey === 'artisan'))
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: situation.title, location: situation.location, timeLabel: situation.timeLabel,
    newFacts: [{factKey: 'private-key', kind: 'object', text: '门边有一把备用钥匙。', audienceKeys: ['player', 'guard'], evidenceFactKeys: ['lost'], seedExcerpt: '门边有一把备用钥匙'}], newGoals: [], newThreads: [], possibilities: []}
  const input = {sequence: full.lastSequence + 1, triggerSequence: full.lastSequence, draft}
  const next = previewChatSituationV1(state, input)
  expect(next.chatNarrative!.situation.possibilities.filter(p => p.actorKey === 'artisan')).toEqual(originalPossibilities)
  expect(JSON.stringify(interactionVisibilityView(next, 'artisan'))).not.toContain('private-key')
  for (const bad of [
    {...draft, title: '私聊中得知的钥匙下落'},
    {...draft, newFacts: [{...draft.newFacts[0], audienceKeys: ['player', 'guard', 'artisan']}]},
    {...draft, possibilities: [{actorKey: 'artisan', text: '跟着查看', evidenceFactKeys: ['lost']}]},
    {...draft, newGoals: [{goalKey: 'private-goal', actorKey: 'artisan', desire: '帮忙', concern: '无', boundary: '无', evidenceFactKeys: ['lost']}]},
  ]) expect(() => previewChatSituationV1(state, {...input, draft: bad})).toThrow()
  expect(() => previewChatNarrativeActionV1(next, {sequence: input.sequence + 1, triggerSequence: full.lastSequence, actorKey: 'guard', messageId: 'public-leak', action: {...action(), audienceKeys: ['player', 'guard', 'artisan']}})).toThrow('听众范围')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(full)
  expect(spy).toHaveBeenCalledTimes(1)
})

it.each([undefined, null])('freezes the public seed audience and preserves absent roles plans without private scene restrictions (selection: %s)', async audienceKeys => {
  const f = await seedChatNarrativeRuntimeFixture()
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockRejectedValue(new Error('before provider'))
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'artisan'})
  const version = await readProductRuntimeStateVersion(f.sessionId)
  await expect(createChatNarrativeSituationV1({...f, expectedSequence: version.sequence, seed: '门边有一把备用钥匙。', audienceKeys, actionLimit: 1, aiConfig: {} as never})).rejects.toThrow('before provider')
  const state = (await readProductRuntimeState(f.sessionId)).interaction!, story = state.chatNarrative!, trigger = story.triggers.at(-1)!
  expect(trigger.direction).toMatchObject({audienceParticipantKeys: ['guard'], conversationMode: 'present'})
  const outside = story.situation.possibilities.filter(p => p.actorKey === 'artisan')
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: '查看门边钥匙', location: story.situation.location, timeLabel: story.situation.timeLabel,
    newFacts: [{factKey: 'public-key', kind: 'object', text: '门边有一把备用钥匙。', audienceKeys: ['player', 'guard'], evidenceFactKeys: ['lost'], seedExcerpt: '门边有一把备用钥匙'}], newGoals: [], newThreads: [], possibilities: []}
  const next = previewChatSituationV1(state, {sequence: trigger.requestedSequence + 1, triggerSequence: trigger.requestedSequence, draft})
  expect(next.chatNarrative!.situation.title).toBe(draft.title)
  expect(next.chatNarrative!.situation.possibilities.filter(p => p.actorKey === 'artisan')).toEqual(outside)
  expect(JSON.stringify(interactionVisibilityView(next, 'artisan'))).not.toContain('public-key')
})
