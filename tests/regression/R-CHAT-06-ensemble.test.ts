import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {seedChatEnsembleFixture} from '../helpers/chat-ensemble-fixture'
import {chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {advanceChatNarrativeTurnV1, resumeChatNarrativeTurnV1} from '../../src/lib/character-interaction/narrative-turn'
import {readProductRuntimeState, readProductRuntimeStateVersion, leaveInteractionParticipant, joinInteractionParticipant, commitInteractionPlayerMessage} from '../../src/lib/character-interaction/runtime-api'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
const basic = (actor: string): ChatNarrativeActionV1 => ({kind: 'speak', text: `${actor}说明自己接下来要处理的事项，玩家可以不参与。`,
  goalKey: actor === 'guard' ? 'find-seal' : actor === 'artisan' ? 'fix-road' : `care-${actor}`,
  evidenceFactKeys: [actor === 'guard' ? 'lost' : actor === 'artisan' ? 'road' : `prepared-${actor}`], audienceKeys: ['player', actor],
  waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})
function mock(resolve: (actor: string, index: number) => ChatNarrativeActionV1, review = () => chatActionReviewOutputFixture()) {
  let actions = 0, calls = 0
  const actors: string[] = [], requests: {actor: string; characters: number}[] = []
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {calls++; actors.push(input.participantKey); requests.push({actor: input.participantKey, characters: JSON.stringify(messages).length}); return JSON.stringify(resolve(input.participantKey, actions++))}),
    runReviewAI: async () => {calls++; return JSON.stringify(review())}}))
  return {actors, requests, count: () => calls}
}

it('retains the first role action when a second role fails, then explicitly continues other roles without replaying the first', async () => {
  const f = await seedChatEnsembleFixture(), worlds = await db.worldReleases.toArray()
  const model = mock((actor, index) => index === 1 ? {...basic(actor), audienceKeys: ['player', actor, 'unknown-role']} : basic(actor))
  await expect(advanceChatNarrativeTurnV1({...f, kind: 'scene-start', expectedSequence: f.sceneSequence, schedulingMode: 'round-robin', actionLimit: 3, aiConfig: {} as never})).rejects.toThrow()
  let state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.speakerKey)).toEqual(['guard'])
  const sequence = (await readProductRuntimeStateVersion(f.sessionId)).sequence
  await expect(resumeChatNarrativeTurnV1({...f, expectedSequence: sequence, aiConfig: {} as never})).rejects.toThrow()
  expect(model.actors).toEqual(['guard', 'artisan'])
  await advanceChatNarrativeTurnV1({...f, kind: 'continue', expectedSequence: sequence, schedulingMode: 'round-robin', actionLimit: 2, aiConfig: {} as never})
  state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.map(m => m.speakerKey)).toEqual(['guard', 'artisan', 'courier'])
  expect(model.actors).toEqual(['guard', 'artisan', 'artisan', 'courier'])
  expect((await db.agentRuns.toArray()).filter(r => r.status === 'failed')).toHaveLength(1)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  db.close(); await db.open()
  expect((await readProductRuntimeState(restored.id!)).interaction).toEqual(state)
  expect(model.actors).toHaveLength(4)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
})

it('requires actual disclosed words for another role to learn a private fact, and a returning third role still does not know it', async () => {
  const f = await seedChatEnsembleFixture()
  const original = (await readProductRuntimeState(f.sessionId)).interaction!, secret = original.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!.text
  let audience = ['player', 'guard'], recipients = ['player']
  const model = mock(() => ({...basic('guard'), text: secret, evidenceFactKeys: ['regret'], audienceKeys: [...audience],
    disclosures: [{factKey: 'regret', toParticipantKeys: [...recipients], evidenceExcerpt: secret, wording: 'equivalent'}]}),
  () => ({...chatActionReviewOutputFixture(), disclosureChecks: [{factKey: 'regret', passed: true, reason: '工程披露复核，不代表真实语义质量。'}]}))
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'private-question', text: '可以只对我说说你为什么这么谨慎吗？', audienceKeys: ['guard']})
  await advanceChatNarrativeTurnV1({...f, kind: 'player-response', expectedSequence: message.sequence, replyToSequence: message.sequence, actionLimit: 1, aiConfig: {} as never})
  let state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!.audienceKeys).toEqual(['guard', 'player'])
  for (const actor of ['artisan', 'courier']) expect(JSON.stringify(buildInteractionContextWindow(state, actor))).not.toContain(secret)
  await leaveInteractionParticipant({...await command(f.sessionId), participantKey: 'courier'})
  audience = ['player', 'guard', 'artisan']; recipients = ['artisan']
  await advanceChatNarrativeTurnV1({...f, kind: 'continue', expectedSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, participantKey: 'guard', actionLimit: 1, aiConfig: {} as never})
  await joinInteractionParticipant({...await command(f.sessionId), participantKey: 'courier'})
  state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(JSON.stringify(buildInteractionContextWindow(state, 'artisan'))).toContain(secret)
  expect(JSON.stringify(buildInteractionContextWindow(state, 'courier'))).not.toContain(secret)
  expect(model.count()).toBe(4)
})

it('keeps eight roles within three explicit bounded turns and accounts for all generation/review calls', async () => {
  const f = await seedChatEnsembleFixture(8), model = mock(actor => basic(actor)), worlds = await db.worldReleases.toArray()
  for (const [index, actionLimit] of [3, 3, 2].entries()) {
    await advanceChatNarrativeTurnV1({...f, kind: index === 0 ? 'scene-start' : 'continue', expectedSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, schedulingMode: 'round-robin', actionLimit, aiConfig: {} as never})
  }
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(model.actors).toEqual(state.profiles.map(p => p.participantKey))
  expect(new Set(model.actors).size).toBe(8); expect(model.count()).toBe(16)
  expect(state.messages).toHaveLength(8)
  expect(state.chatNarrative!.triggers.map(t => t.actionSequences.length)).toEqual([3, 3, 2])
  expect(state.remainingDirectorBudget).toBe(76)
  for (const actor of state.profiles.map(p => p.participantKey)) {
    const view = buildInteractionContextWindow(state, actor)
    expect(view.chatNarrative!.goals.every(g => g.actorKey === actor)).toBe(true)
    expect(model.requests.find(r => r.actor === actor)!.characters).toBeGreaterThan(0)
  }
  expect(await db.worldReleases.toArray()).toEqual(worlds)
})
