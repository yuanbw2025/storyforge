import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as harness from '../../src/lib/character-interaction/harness'
import {forkChatHistoricalOptionV1, readChatHistoricalOptionMessageIdsV1, readChatHistoricalOptionsPlanV1} from '../../src/lib/character-interaction/narrative-options-history'
import {applyChatMessageEditV1} from '../../src/lib/character-interaction/narrative-edit'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, deleteProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, updateChatMessageEditDraft} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const generate = harness.generateInteractionRuntimeCandidateV1
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
function options(): ChatNarrativeActionV1[] {
  return [
    {kind: 'complete', text: '我把灯移到门边，门边亮了起来。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
      newFacts: [{factKey: 'light', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null},
    {kind: 'complete', text: '我轻轻关上窗，窗户关上了。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player', 'artisan'], waitingForPlayer: false,
      newFacts: [{factKey: 'closed', kind: 'observation', text: '窗户关上了。', evidenceFactKeys: ['lost'], evidenceExcerpt: '窗户关上了。'}], disclosures: [], threadUpdates: [], goalStatus: null},
  ]
}
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
async function selected(crash = false) {
  const f = await seedChatNarrativeRuntimeFixture()
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const generated = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-options', objective: '比较工程夹具',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify({options: options()})), runReviewAI: async () => JSON.stringify({options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))})})
  const adoption = harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, optionKey: 'option-1',
    onDurableBoundary: type => {if (crash && type === 'runtime.candidate.adopted') throw new Error('interrupted after commit')}})
  if (crash) await expect(adoption).rejects.toThrow('interrupted after commit')
  else await adoption
  const message = (await readProductRuntimeState(f.sessionId)).interaction!.messages[0]
  return {...f, runId: generated.snapshot.run.id, message}
}
type Fixture = Awaited<ReturnType<typeof selected>>
async function later(f: Fixture) {
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'later-player', text: '后来，我想换个办法。'})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: v.sequence})
  const generated = await generate({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '后续工程夹具',
    runAI: withChatActionChoiceFixture(async () => JSON.stringify({...options()[0], text: '后来窗户被我推开了。', newFacts: [{factKey: 'opened', kind: 'observation', text: '后来窗户被我推开了。', evidenceFactKeys: ['lost'], evidenceExcerpt: '后来窗户被我推开了。'}]})),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
}

it('offers only verified visible expressions and branches before an older choice, recomputing its own audience and consequences', async () => {
  const f = await selected(); await later(f)
  const parent = await readProductRuntimeState(f.sessionId)
  expect(await readChatHistoricalOptionMessageIdsV1(f.scope, f.sessionId)).toEqual([f.message.messageId])
  const plan = await readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId)
  expect(plan.edit.removedMessageCount).toBe(3)
  expect(plan.options.map(option => option.text)).toEqual(options().map(action => action.text))
  expect(JSON.stringify(plan)).not.toContain('柜台下')
  expect(Object.keys(plan.options[1]).sort()).toEqual(['audienceKeys', 'key', 'text'])
  const count = await db.agentRuns.count()
  const child = await forkChatHistoricalOptionV1({scope: f.scope, plan, optionKey: 'option-2'})
  expect(await db.agentRuns.count()).toBe(count)
  let state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages).toHaveLength(0)
  expect(state.chatNarrative!.situation.facts.some(fact => ['light', 'opened', 'closed'].includes(fact.factKey))).toBe(false)
  expect(state.chatNarrative!.pendingEdit).toMatchObject({mode: 'option', text: options()[1].text, audienceKeys: options()[1].audienceKeys,
    sourceOption: {candidateHash: plan.candidateHash, optionKey: 'option-2'}})
  let calls = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async messages => {calls++; expect(JSON.stringify(messages)).not.toContain('后来窗户被我推开了'); return JSON.stringify(options()[1])}),
    runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())},
  }))
  db.close(); await db.open()
  await applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: 0, text: options()[1].text, aiConfig: {} as never})
  expect(calls).toBe(2)
  state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages.map(message => message.text)).toEqual([options()[1].text])
  expect(state.messages[0].audienceKeys).toEqual(['guard', 'player', 'artisan'])
  expect(state.chatNarrative!.situation.facts.filter(fact => ['light', 'opened', 'closed'].includes(fact.factKey)).map(fact => fact.factKey)).toEqual(['closed'])
  expect(state.chatNarrative!.pendingEdit).toBeUndefined()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(parent)
  expect((await db.agentRuns.get(f.runId))!.productRuntimeSessionId).toBe(f.sessionId)
  expect(await readChatHistoricalOptionMessageIdsV1(f.scope, child.id!)).toEqual([state.messages[0].messageId])
  const nextPlan = await readChatHistoricalOptionsPlanV1(f.scope, child.id!, state.messages[0].messageId)
  expect(nextPlan.selectedOptionKey).toBe('option-2')
  const returned = await forkChatHistoricalOptionV1({scope: f.scope, plan: nextPlan, optionKey: 'option-1'})
  expect((await readProductRuntimeState(returned.id!)).interaction!.chatNarrative!.pendingEdit).toMatchObject({text: options()[0].text, audienceKeys: options()[0].audienceKeys,
    sourceOption: {candidateHash: plan.candidateHash, optionKey: 'option-1'}})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const importedChild = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
  const importedPlan = await readChatHistoricalOptionsPlanV1({projectId, worldId: importedChild.worldId, workId: importedChild.workId}, importedChild.id!, state.messages[0].messageId)
  expect(importedPlan.selectedOptionKey).toBe('option-2')
  expect(importedPlan.options).toEqual(nextPlan.options)
})

it('resolves nested and imported ancestry without treating invalidated import receipts as new work', async () => {
  const f = await selected(); await later(f)
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'choice child'})
  await branchProductRuntimeSession({parentSessionId: child.id!, throughSequence: 0, title: 'choice nested'})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const nested = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === 'choice nested')!
  const scope = {projectId, worldId: nested.worldId, workId: nested.workId}
  expect(await readChatHistoricalOptionMessageIdsV1(scope, nested.id!)).toEqual([f.message.messageId])
  const plan = await readChatHistoricalOptionsPlanV1(scope, nested.id!, f.message.messageId)
  expect(plan.runId).not.toBe(f.runId)
  expect(plan.edit.sourceSessionId).not.toBe(f.sessionId)
  const replacement = await forkChatHistoricalOptionV1({scope, plan, optionKey: 'option-2', title: 'imported alternate'})
  expect((await readProductRuntimeState(replacement.id!)).interaction!.chatNarrative!.pendingEdit).toMatchObject({mode: 'option', sourceOption: {candidateHash: plan.candidateHash, optionKey: 'option-2'}})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages[0].text).toBe(options()[0].text)
})

it.each(['hash', 'run', 'selected', 'message', 'extra'])('rejects forged %s branch intent before creating any child', async change => {
  const f = await selected(), plan = await readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId)
  const intent = {kind: 'character-chat-option-switch' as const, sourceMessageId: f.message.messageId, runId: f.runId, candidateHash: plan.candidateHash, optionKey: 'option-2' as const}
  const altered = {...intent, ...(change === 'hash' ? {candidateHash: '0'.repeat(64)} : change === 'run' ? {runId: 99999} : change === 'selected' ? {optionKey: 'option-1' as const} : change === 'message' ? {sourceMessageId: 'missing'} : {text: '伪造候选'})}
  const count = await db.productRuntimeSessions.count()
  await expect(branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: plan.edit.sourceSequence - 1, intent: altered})).rejects.toThrow()
  expect(await db.productRuntimeSessions.count()).toBe(count)
})

it('rejects stale previews, another scope and changed preview text without changing either timeline', async () => {
  const f = await selected(), plan = await readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId), count = await db.productRuntimeSessions.count()
  const changed = structuredClone(plan); changed.options[1].text = '另一段伪造文字。'
  await expect(forkChatHistoricalOptionV1({scope: f.scope, plan: changed, optionKey: 'option-2'})).rejects.toThrow('已经变化')
  await expect(forkChatHistoricalOptionV1({scope: f.scope, plan, optionKey: 'option-1'})).rejects.toThrow('另一条候选')
  const other = await seedChatNarrativeRuntimeFixture()
  await expect(readChatHistoricalOptionsPlanV1(other.scope, f.sessionId, f.message.messageId)).rejects.toThrow()
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'change', text: '先等等。'})
  await expect(forkChatHistoricalOptionV1({scope: f.scope, plan, optionKey: 'option-2'})).rejects.toThrow('已经变化')
  expect(await db.productRuntimeSessions.count()).toBe(count + 1)
})

it('does not expose an incompletely adopted or corrupt candidate, but keeps the committed dialogue readable', async () => {
  const f = await selected(true)
  expect(await readChatHistoricalOptionMessageIdsV1(f.scope, f.sessionId)).toEqual([])
  await expect(readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId)).rejects.toThrow('尚未完成')
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: f.runId})
  const checkpoint = (await db.agentRunCheckpoints.where('runId').equals(f.runId).toArray()).at(-1)!
  await db.agentRunCheckpoints.update(checkpoint.id!, {resumePayloadJson: '{}'})
  await expect(readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId)).rejects.toThrow()
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages[0].text).toBe(options()[0].text)
})

it('preserves immutable selected text and provenance across branch/import, and cancellation leaves no chosen effects', async () => {
  const f = await selected(), plan = await readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId)
  const child = await forkChatHistoricalOptionV1({scope: f.scope, plan, optionKey: 'option-2', title: 'chosen draft'})
  await expect(updateChatMessageEditDraft({...await command(child.id!), text: '修改选中的候选'})).rejects.toThrow('候选不能改写')
  await updateChatMessageEditDraft({...await command(child.id!), text: options()[1].text})
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === 'chosen draft')!
  const draft = (await readProductRuntimeState(imported.id!)).interaction!.chatNarrative!.pendingEdit!
  expect(draft.sourceOption).toEqual({candidateHash: plan.candidateHash, optionKey: 'option-2'})
  await updateChatMessageEditDraft({...await command(imported.id!), text: '', cancel: true})
  const state = (await readProductRuntimeState(imported.id!)).interaction!
  expect(state.chatNarrative!.pendingEdit).toBeUndefined()
  expect(state.messages).toHaveLength(0)
  expect(state.chatNarrative!.situation.facts.some(fact => ['light', 'closed'].includes(fact.factKey))).toBe(false)
})

it('keeps descendant dialogue after its source is deleted but cannot invent missing alternatives', async () => {
  const f = await selected(), child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'orphaned choice'})
  const before = await readProductRuntimeState(child.id!)
  await deleteProductRuntimeSession(f.sessionId)
  expect(await readProductRuntimeState(child.id!)).toEqual(before)
  expect(await readChatHistoricalOptionMessageIdsV1(f.scope, child.id!)).toEqual([])
  await expect(readChatHistoricalOptionsPlanV1(f.scope, child.id!, f.message.messageId)).rejects.toThrow('原始时间线已删除')
})

it.each(['text', 'audience', 'review'])('retains the selected draft without consequences when %s reconciliation fails', async failure => {
  const f = await selected(), plan = await readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId)
  const child = await forkChatHistoricalOptionV1({scope: f.scope, plan, optionKey: 'option-2'})
  const before = (await readProductRuntimeState(child.id!)).interaction!
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => {const action = options()[1]; if (failure === 'text') action.text += '后来发生的事。'; if (failure === 'audience') action.audienceKeys = ['guard', 'player']; return JSON.stringify(action)}),
    runReviewAI: async () => {const review = chatActionReviewOutputFixture(); if (failure === 'review') review.checks[0].passed = false; return JSON.stringify(review)},
  }))
  await expect(applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: 0, text: options()[1].text, aiConfig: {} as never})).rejects.toThrow()
  const state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages).toEqual(before.messages)
  expect(state.chatNarrative!.situation).toEqual(before.chatNarrative!.situation)
  expect(state.chatNarrative!.pendingEdit).toMatchObject({mode: 'option', sourceOption: before.chatNarrative!.pendingEdit!.sourceOption})
})

it('resumes review of the saved selected alternative without generating its text again', async () => {
  const f = await selected(), plan = await readChatHistoricalOptionsPlanV1(f.scope, f.sessionId, f.message.messageId)
  const child = await forkChatHistoricalOptionV1({scope: f.scope, plan, optionKey: 'option-2'})
  let calls = 0, runId = 0
  vi.spyOn(harness, 'generateInteractionRuntimeCandidateV1').mockImplementation(input => generate({...input,
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(options()[1])}), onNarrativeActionSaved: id => {runId = id; throw new Error('crash before review')},
  }))
  await expect(applyChatMessageEditV1({scope: f.scope, sessionId: child.id!, expectedSequence: 0, text: options()[1].text, aiConfig: {} as never})).rejects.toThrow('crash before review')
  db.close(); await db.open()
  await harness.resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}})
  await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(calls).toBe(2)
  const state = (await readProductRuntimeState(child.id!)).interaction!
  expect(state.messages.map(message => message.text)).toEqual([options()[1].text])
  expect(state.chatNarrative!.situation.facts.filter(fact => fact.factKey === 'closed')).toHaveLength(1)
})
