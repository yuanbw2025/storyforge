import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import type {AgentRunSnapshotV1} from '../../src/lib/agent/run/event-store'
import {readAgentRunArtifactExactV1} from '../../src/lib/memory/artifact-store'
import {sha256Text} from '../../src/lib/ai/chapter-memory/text-normalization'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {readChatActionChoiceEvidenceV1} from '../../src/lib/character-interaction/action-choice-evidence'
import {readChatCandidateRetrievalVersion} from '../../src/lib/character-interaction/context-reader-version'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'

const originalSkill = skills.getAgentSkillV1
const cases = [
  {producer: 'chat-narrative-action-v61', reader: 'chat-narrative-runtime-view-v17', retrieval: 'chat-relevance-v13'},
  {producer: 'chat-narrative-action-v62', reader: 'chat-narrative-runtime-view-v18', retrieval: 'chat-relevance-v14'},
  {producer: 'chat-narrative-action-v63', reader: 'chat-narrative-runtime-view-v18', retrieval: 'chat-relevance-v14'},
  {producer: 'chat-narrative-action-v64', reader: 'chat-narrative-runtime-view-v18', retrieval: 'chat-relevance-v14'},
] as const
type Producer = typeof cases[number]['producer']
const action = {kind: 'speak', text: '你记得最后一次见到铜印的地方吗？', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

// Freeze the complete released producer before the real Harness creates its
// contract, Gateway source and packets. Never relabel or rewrite saved bytes.
function freeze(producer: Producer, reviewer = producer === 'chat-narrative-action-v64' ? 'chat-narrative-action-review-v39' : 'chat-narrative-action-review-v38') {
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = originalSkill(id)
    return id === 'character.chat-narrative-action' ? {...skill, promptVersion: producer}
      : id === 'character.chat-narrative-action-review' ? {...skill, promptVersion: reviewer} : skill
  })
}
async function start() {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 20}), base = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'reader-recovery', baseSequence: base.sequence,
    baseStateHash: base.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
async function packet(projectId: number, snapshot: AgentRunSnapshotV1, stepId: string) {
  const events = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'context-packet' && event.payload.stepId === stepId)
  expect(events).toHaveLength(1)
  const event = events[0]
  if (event.type !== 'evidence.artifact.recorded') throw Error('missing original packet')
  const bytes = await readAgentRunArtifactExactV1({projectId, artifactKind: 'context-packet', contentHash: event.payload.contentHash})
  return {bytes, artifactHash: event.payload.contentHash, value: JSON.parse(bytes)}
}

it.each(cases)('preserves $producer / $reader through saved candidate, refresh, review and portable inspection', async ({producer, reader, retrieval}) => {
  expect(originalSkill('character.chat-narrative-action').promptVersion).toBe('chat-narrative-action-v72')
  freeze(producer)
  const f = await start(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  let modelCalls = 0, reviewCalls = 0, forbiddenCalls = 0
  const generate = withChatActionChoiceFixture(async () => JSON.stringify(action))
  const runAI = vi.fn((...args: Parameters<typeof generate>) => {modelCalls++; return generate(...args)})
  const reviewAI = vi.fn(async () => {reviewCalls++; return JSON.stringify(chatActionReviewOutputFixture())})
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId,
    participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '验证冻结来源的保存与恢复', runAI, runReviewAI: reviewAI,
    onNarrativeActionSaved: id => {runId = id; throw Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  const saved = await readInstanceAgentRunV1(f.scope, runId)
  expect(saved.contract.executionBindings?.filter(binding => ['interaction:action-choice', 'interaction:runtime-candidate'].includes(binding.stepId))
    .map(binding => binding.promptVersion)).toEqual([producer, producer])
  const choice = await packet(f.scope.projectId, saved, 'interaction:action-choice')
  const expression = await packet(f.scope.projectId, saved, 'interaction:runtime-candidate')
  const state = before.interaction!, profile = state.profiles.find(item => item.participantKey === 'guard')!
  const expected = formatInteractionRuntimeContextV1(profile, buildInteractionContextWindow(state, 'guard', {retrievalVersion: retrieval}))
  for (const source of [choice, expression]) {
    expect(source.value.manifest.sources[0].readerVersion).toBe(reader)
    expect(source.value.text).toBe(expected)
    expect(source.value.manifest.sources[0].contentHash).toBe(await sha256Text(expected))
  }
  expect(choice.value.manifest.sources).toEqual(expression.value.manifest.sources)
  expect((await readChatActionChoiceEvidenceV1({scope: f.scope, snapshot: saved, participantKey: 'guard'})).roleContext)
    .toEqual(buildInteractionContextWindow(state, 'guard', {retrievalVersion: retrieval}))
  expect(runAI).toHaveBeenCalledTimes(2); expect(reviewAI).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)

  vi.restoreAllMocks(); db.close(); await db.open()
  // A current/default producer cannot silently reinterpret a saved producer.
  freeze(producer === 'chat-narrative-action-v61' ? 'chat-narrative-action-v62' : 'chat-narrative-action-v61')
  const noCalls = vi.fn(async (): Promise<string> => {forbiddenCalls++; throw Error('must not dispatch')})
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId, runAI: noCalls, runReviewAI: noCalls})).rejects.toThrow('生成配置或功能版本已变化')
  expect(noCalls).not.toHaveBeenCalled()
  expect((await readInstanceAgentRunV1(f.scope, runId)).projection).toEqual(saved.projection)
  expect(await packet(f.scope.projectId, saved, 'interaction:runtime-candidate')).toEqual(expression)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)

  vi.restoreAllMocks(); freeze(producer)
  const resumed = await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: reviewAI})
  expect(await readChatCandidateRetrievalVersion(resumed.snapshot, f.scope.projectId, 'interactionRuntime', 'guard', state)).toBe(retrieval)
  expect(await packet(f.scope.projectId, resumed.snapshot, 'interaction:action-choice')).toEqual(choice)
  expect(await packet(f.scope.projectId, resumed.snapshot, 'interaction:runtime-candidate')).toEqual(expression)
  const review = await packet(f.scope.projectId, resumed.snapshot, 'interaction:action-review')
  // review38 already selected audience-v2 and source-v18 for released producer61.
  expect(review.value.manifest.sources[0].readerVersion).toBe('chat-action-review-v18')
  expect(resumed.snapshot.contract.executionBindings?.find(binding => binding.stepId === 'interaction:action-review')?.promptVersion)
    .toBe(producer === 'chat-narrative-action-v64' ? 'chat-narrative-action-review-v39' : 'chat-narrative-action-review-v38')
  const done = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(done.snapshot.projection.state).toBe('completed')
  const after = await readProductRuntimeState(f.sessionId)
  expect((await readChatContextInspectionV1(f.scope, f.sessionId, runId)).available).toBe(true)

  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  vi.restoreAllMocks(); db.close(); await db.open()
  const importedSession = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  const scope = {projectId, worldId: importedSession.worldId, workId: importedSession.workId}
  const row = (await db.agentRuns.where('productRuntimeSessionId').equals(importedSession.id!).first())!
  const imported = await readInstanceAgentRunV1(scope, row.id!)
  expect(imported.contract.executionBindings?.find(binding => binding.stepId === 'interaction:runtime-candidate')?.promptVersion).toBe(producer)
  expect((await readChatContextInspectionV1(scope, importedSession.id!, row.id!)).available).toBe(true)
  // Import remaps owner IDs, while exact evidence remains byte-identical.
  for (const [stepId, original] of [['interaction:action-choice', choice], ['interaction:runtime-candidate', expression], ['interaction:action-review', review]] as const)
    expect(await packet(projectId, imported, stepId)).toEqual(original)
  expect((await readProductRuntimeState(importedSession.id!)).interaction).toEqual(after.interaction)
  expect((await db.worldReleases.toArray()).filter(world => world.projectId === f.scope.projectId)).toEqual(worlds)
  // Restoring the configured Skill clears Vitest mock histories; these counters
  // span every refresh/import phase and must not reset with the mocks.
  expect(modelCalls).toBe(2); expect(reviewCalls).toBe(1); expect(forbiddenCalls).toBe(0)
})

it('rejects a newly mixed 62/37 contract before any model request and preserves runtime state', async () => {
  freeze('chat-narrative-action-v62', 'chat-narrative-action-review-v37')
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  const noCalls = vi.fn(async (): Promise<string> => {throw Error('must not dispatch')})
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId,
    participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '拒绝混配', runAI: noCalls, runReviewAI: noCalls}))
    .rejects.toThrow('冻结预算合同不一致')
  expect(noCalls).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const runs = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).toArray()
  for (const row of runs) {
    const saved = await readInstanceAgentRunV1(f.scope, row.id!)
    expect(saved.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
  }
})

it('retains semantic failure and the reader18 packets without retrying during recovery', async () => {
  freeze('chat-narrative-action-v62')
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  const runAI = vi.fn(withChatActionChoiceFixture(async () => JSON.stringify(action)))
  const failed = chatActionReviewOutputFixture()
  const meaning = failed.checks.find(check => check.check === 'meaningful-direction')!
  meaning.passed = false; meaning.reason = '工程拒绝夹具：重复既有提议，不增加有意义的进展。'
  const reviewAI = vi.fn(async () => JSON.stringify(failed))
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId,
    participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '保留审查拒绝', runAI, runReviewAI: reviewAI}))
    .rejects.toThrow('行动语义审查未通过')
  const row = (await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last())!
  const saved = await readInstanceAgentRunV1(f.scope, row.id!)
  const original = await packet(f.scope.projectId, saved, 'interaction:runtime-candidate')
  expect(original.value.manifest.sources[0].readerVersion).toBe('chat-narrative-runtime-view-v18')
  const noCalls = vi.fn(async (): Promise<string> => {throw Error('must not dispatch')})
  db.close(); await db.open()
  await expect(resumeChatNarrativeReviewV1({scope: f.scope, runId: row.id!, runAI: noCalls, runReviewAI: noCalls})).rejects.toThrow()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: row.id!})).rejects.toThrow()
  expect(await packet(f.scope.projectId, await readInstanceAgentRunV1(f.scope, row.id!), 'interaction:runtime-candidate')).toEqual(original)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(runAI).toHaveBeenCalledTimes(2); expect(reviewAI).toHaveBeenCalledTimes(1); expect(noCalls).not.toHaveBeenCalled()
})
