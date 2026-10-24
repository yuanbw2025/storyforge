import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as api from '../../src/lib/character-interaction/runtime-api'
import {useHistoricalChatReaderFixture, freezeLegacyChatActionContractFixture} from '../helpers/chat-historical-reader'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {sha256Text} from '../../src/lib/ai/chapter-memory/text-normalization'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatResolutionActionFixture} from '../helpers/chat-resolution-evidence'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const runtime = async (id: number) => (await api.readProductRuntimeState(id)).interaction!
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({additionalGuardGoal: true}), v = await api.readProductRuntimeStateVersion(f.sessionId)
  await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const observed = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '收束来源工程夹具', runAI: withChatActionChoiceFixture(async () => JSON.stringify({kind: 'complete', text: '借用登记中没有记录铜印的去向。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
      audienceKeys: ['guard', 'artisan', 'player'], waitingForPlayer: false, newFacts: [{factKey: 'no-registration', kind: 'observation', text: '借用登记中没有记录铜印的去向。', evidenceFactKeys: ['lost'], evidenceExcerpt: '借用登记中没有记录铜印的去向。'}],
      disclosures: [], threadUpdates: [], goalStatus: null})), runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: observed.snapshot.run.id})
  const next = await api.readProductRuntimeStateVersion(f.sessionId)
  await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'continue', baseSequence: next.sequence, baseStateHash: next.stateHash, kind: 'continue', sourceEventSequence: next.sequence})
  return f
}

it.each(['current', 'saved-v10', 'options'] as const)('preserves exact terminal evidence across review/command crash and parentless imported branches: %s', async mode => {
  const f = await prepared(), before = await runtime(f.sessionId), worlds = await db.worldReleases.toArray(), action = chatResolutionActionFixture()
  const alternate = structuredClone(action); alternate.text = '铜印仍然失踪。' + action.text; alternate.goalUpdates![0].evidenceFactKeys = ['lost']; alternate.goalUpdates![0].evidenceExcerpt = '寻找先到这里，不再继续。'
  if (mode === 'saved-v10') {
    useHistoricalChatReaderFixture('chat-narrative-runtime-view-v10')
  }
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: mode === 'options' ? 'character.chat-narrative-options' : 'character.chat-narrative-action', objective: '收束依据版本恢复，不是剧情验收',
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(mode === 'options' ? {options: [action, alternate]} : action)}),
    onNarrativeActionSaved: id => {runId = id; throw Error('before-review')}})).rejects.toThrow('before-review')
  expect(await runtime(f.sessionId)).toEqual(before); vi.restoreAllMocks(); db.close(); await db.open()
  if (mode === 'saved-v10') freezeLegacyChatActionContractFixture()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(mode === 'options'
    ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))} : chatActionReviewOutputFixture())}})
  const commit = api.commitChatNarrativeAction
  vi.spyOn(api, 'commitChatNarrativeAction').mockImplementationOnce(async input => {await commit(input); throw Error('after-command')})
  const adopt = () => adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, ...(mode === 'options' ? {optionKey: 'option-2'} : {})})
  await expect(adopt()).rejects.toThrow('after-command')
  const committed = await api.readProductRuntimeStateVersion(f.sessionId)
  vi.restoreAllMocks(); db.close(); await db.open()
  const adopted = await adopt(); await adopt()
  expect(await api.readProductRuntimeStateVersion(f.sessionId)).toEqual(committed)
  const state = await runtime(f.sessionId), evidence = state.chatNarrative!.resolutionEvidence
  expect(JSON.parse(adopted.event!.payloadJson).resolutionEvidenceVersion).toBe(mode === 'saved-v10' ? undefined : 1)
  if (mode === 'saved-v10') expect(evidence).toBeUndefined()
  else {
    expect(evidence!.goals).toHaveLength(2); expect(evidence!.threads).toHaveLength(1)
    const goal = evidence!.goals.find(r => r.targetKey === 'find-seal')!
    expect(goal.evidenceFactKeys).toEqual(mode === 'options' ? alternate.goalUpdates![0].evidenceFactKeys : action.goalUpdates![0].evidenceFactKeys)
    expect(state.messages.at(-1)!.text.slice(goal.source.start, goal.source.end)).toBe(mode === 'options' ? alternate.goalUpdates![0].evidenceExcerpt : action.goalUpdates![0].evidenceExcerpt)
  }
  expect(state.chatNarrative!.situation.facts).toEqual(before.chatNarrative!.situation.facts)
  expect(state.chatNarrative!.factEvidence).toEqual(before.chatNarrative!.factEvidence)
  if (mode === 'current') {
    const backup = await exportProjectJSON(f.scope.projectId)
    const event = backup.productRuntimeEvents.find(e => e.type === 'interaction.narrative.action-reviewed.committed' && e.commandId === adopted.event!.commandId)!
    const portable = event as unknown as {_portablePayloadJson: string}; const payload = JSON.parse(portable._portablePayloadJson)
    payload.resolutionEvidenceVersion = 99; portable._portablePayloadJson = JSON.stringify(payload)
    const projects = await db.projects.count()
    await expect(importProjectJSON(backup)).rejects.toThrow('收束依据')
    expect(await db.projects.count()).toBe(projects)
  }
  let parent = f.sessionId
  for (const title of ['first', 'nested']) {
    const source = await api.readProductRuntimeState(parent), child = await api.branchProductRuntimeSession({parentSessionId: parent, throughSequence: source.lastSequence, title})
    await api.deleteProductRuntimeSession(parent); parent = child.id!
  }
  const expected = await runtime(parent)
  expect(expected.chatNarrative!.resolutionEvidence).toEqual(evidence)
  expect(expected.chatNarrative!.situation.goals[0].updatedSequence).toBeLessThan(0)
  expect(await db.productRuntimeEvents.where('sessionId').equals(parent).count()).toBe(0)
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(parent).count()).toBe(0)
  await api.createProductRuntimeCheckpoint({sessionId: parent, name: 'resolution-checkpoint'})
  const backup = await exportProjectJSON(f.scope.projectId)
  if (mode === 'current') for (const field of ['initialStateJson', 'runtimeHeadStateJson', 'stateJson'] as const) {
    const corrupt = structuredClone(backup), row = field === 'stateJson' ? corrupt.productRuntimeCheckpoints[0] : corrupt.productRuntimeSessions.find(s => s.title === 'nested')!
    const container = row as unknown as Record<string, string>, initial = JSON.parse(container[field])
    initial.interaction.chatNarrative.resolutionEvidence.goals[0].source.messageId = 'missing'
    container[field] = JSON.stringify(initial)
    if (field === 'stateJson') container.stateHash = await sha256Text(container[field])
    const projects = await db.projects.count()
    await expect(importProjectJSON(corrupt)).rejects.toThrow('收束依据')
    expect(await db.projects.count()).toBe(projects); expect(await runtime(parent)).toEqual(expected)
  }
  const importedId = await importProjectJSON(backup); db.close(); await db.open()
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(s => s.title === 'nested')!
  expect(await runtime(imported.id!)).toEqual(expected)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(calls).toBe(2)
})

it('does not store terminal status or evidence when semantic review rejects the closure', async () => {
  const f = await prepared(), before = await runtime(f.sessionId), review = chatActionReviewOutputFixture()
  review.checks.find(c => c.check === 'consequences')!.passed = false
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '失败原子性',
    onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(chatResolutionActionFixture())}), runReviewAI: async () => {calls++; return JSON.stringify(review)}})).rejects.toThrow()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await runtime(f.sessionId)).toEqual(before); expect(calls).toBe(2)
})
