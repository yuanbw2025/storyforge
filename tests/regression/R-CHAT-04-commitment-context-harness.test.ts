import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import {CONTEXT_SOURCES} from '../../src/lib/registry/context-sources'
import {seedChatCommitmentHistoryRuntimeFixture} from '../helpers/chat-commitment-history-runtime'
import {historyTerms} from '../helpers/chat-commitment-history-fixture'
import {seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {chatCommitmentReviewOutputFixture, chatPromiseActionFixture, chatFulfillActionFixture} from '../helpers/chat-commitment-fixture'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {freezeLegacyChatActionContractFixture} from '../helpers/chat-historical-reader'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {vi.restoreAllMocks(); await db.delete()})
const command = async (sessionId: number) => {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}

// This case executes 31 durable setup actions and imports every saved ledger.
// Coverage profiling measured 26 s setup + 21 s import locally; use the same
// bounded lifecycle allowance as the adjacent full-history round-trip test.
it('delivers selected promise history through registered sources and preserves exact historical decisions after reopen and portable import', async () => {
  const f = await seedChatCommitmentHistoryRuntimeFixture(), before = await readProductRuntimeState(f.sessionId)
  const selected = buildInteractionContextWindow(before.interaction!, 'guard')
  expect(selected.selection?.commitments?.some(c => !c.included)).toBe(true)
  const action = {...chatPromiseActionFixture(), text: '地图那项约定已撤回；我还记得另外答应交给你的巡视记录。', commitmentEffects: []}
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '核对旧约定',
    runAI: withChatActionChoiceFixture(async messages => {
      calls++
      expect(messages[1].content).toContain(historyTerms(7)); expect(messages[1].content).toContain(historyTerms(15))
      expect(messages[1].content).toContain('withdrawn'); expect(messages[1].content).not.toContain('柜台下')
      return JSON.stringify(action)
    }), runReviewAI: async messages => {
      calls++
      for (const c of selected.chatNarrative!.goals[0].commitments!) expect(messages[1].content).toContain(c.commitmentKey)
      return JSON.stringify(chatCommitmentReviewOutputFixture(action))
    }})
  const inspection = await readChatContextInspectionV1(f.scope, f.sessionId, generated.snapshot.run.id)
  expect(inspection.available).toBe(true)
  if (!inspection.available) throw new Error('missing inspection')
  expect(inspection.selection?.commitments?.some(c => !c.included)).toBe(true)
  expect(inspection.selection?.commitments).toContainEqual({content: historyTerms(7), included: true, reason: 'dialogue'})
  expect(JSON.stringify(inspection)).not.toMatch(/担心再次错怪人|无辜旅人|柜台下/)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  db.close(); await db.open()
  expect(await readChatContextInspectionV1(f.scope, f.sessionId, generated.snapshot.run.id)).toEqual(inspection)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  const run = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray()).sort((a, b) => b.id! - a.id!)[0]
  const imported = await readChatContextInspectionV1({projectId, workId: session.workId, worldId: session.worldId}, session.id!, run.id!)
  expect(imported.available && imported.selection).toEqual(inspection.selection)
  expect(calls).toBe(2)
}, 90_000)

it('resumes a saved v6 promise context with its original full-history policy after the v8 reader is activated', async () => {
  const f = await seedChatNarrativeRuntimeFixture()
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const first = chatPromiseActionFixture(), base = {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '旧读取版本恢复'}
  const generated = await generateInteractionRuntimeCandidateV1({...base, runAI: withChatActionChoiceFixture(async () => JSON.stringify(first)), runReviewAI: async () => JSON.stringify(chatCommitmentReviewOutputFixture(first))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence})
  const action = chatFulfillActionFixture(`message:harness:${generated.snapshot.run.id}:promise`)
  freezeLegacyChatActionContractFixture()
  let oldSelection: unknown
  vi.spyOn(CONTEXT_SOURCES.find(s => s.key === 'interactionRuntime')!, 'read').mockImplementation(async () => {
    const s = (await readProductRuntimeState(f.sessionId)).interaction!
    const view = buildInteractionContextWindow(s, 'guard', {retrievalVersion: 'chat-relevance-v2'})
    oldSelection = view.selection
    return formatInteractionRuntimeContextV1(s.profiles[0], view)
  })
  const create = manifests.createContextManifestFromAssemblyV1
  vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => create({...input,
    readerVersion: input.readerVersion === 'chat-narrative-runtime-view-v14' ? 'chat-narrative-runtime-view-v6' : input.readerVersion}))
  const record = artifacts.recordAgentRunArtifactV1
  vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(input => record(input.artifactKind === 'context-packet'
    ? {...input, content: JSON.stringify({...JSON.parse(input.content), selection: oldSelection})} : input))
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...base, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(action)}), onNarrativeActionSaved: id => {runId = id; throw new Error('saved-v6')}})).rejects.toThrow('saved-v6')
  vi.restoreAllMocks()
  freezeLegacyChatActionContractFixture()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    calls++; expect(messages[1].content).not.toContain('commitmentPolicy')
    return JSON.stringify(chatCommitmentReviewOutputFixture(action))
  }})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const inspection = await readChatContextInspectionV1(f.scope, f.sessionId, runId)
  expect(inspection.available && inspection.commitments[0].resolution).toBeNull()
  expect(inspection.available && inspection.selection).not.toHaveProperty('commitments')
  expect(calls).toBe(2)
})
