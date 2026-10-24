import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, readInteractionRuntimeCandidateV1, resumeChatMemoryReviewV1} from '../../src/lib/character-interaction/harness'
import {CHAT_MEMORY_CHECKS, CHAT_MEMORY_REVIEW_STEP, hasChatMemoryContentReviewV1, chatMemoryReviewBindingV1} from '../../src/lib/character-interaction/memory-review-contract'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, resolveInteractionMemory, branchProductRuntimeSession, deleteProductRuntimeSession, correctChatMemory} from '../../src/lib/character-interaction/runtime-api'
import {appendAgentRunEventV1, readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {deriveStrictExportProjectJSON} from '../../src/lib/export/registry-export'
import {deriveImportProjectJSON} from '../../src/lib/export/registry-import'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {vi.unstubAllGlobals(); await db.delete()})
const state = async (id: number) => (await readProductRuntimeState(id)).interaction!
async function command(id: number) {const v = await readProductRuntimeStateVersion(id); return {sessionId: id, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
const checks = (failed?: string) => JSON.stringify({checks: CHAT_MEMORY_CHECKS.map(check => ({check, passed: check !== failed, reason: '按实际来源核对的隔离工程结果'}))})
async function start() {
  const f = await seedChatNarrativeRuntimeFixture()
  const message = await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'rest', text: '我想先休息。'})
  const draft = (content = '玩家表示想先休息。') => JSON.stringify({kind: 'memory-curator', memoryKind: 'key-memory', content,
    importance: 60, sourceEventSequences: [message.sequence], evidenceExcerpt: '先休息'})
  const input = {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.interaction-memory-curator' as const, objective: '记忆正文审查隔离工程检查'}
  return {...f, message, draft, input}
}

it('reviews only the exact saved memory and shared sources; applies a proposal, never auto-accepts it or forwards proof snapshots', async () => {
  const f = await start(); let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({...f.input, runAI: async messages => {
    calls++; expect(JSON.stringify(messages)).toContain('担心再次错怪人'); return f.draft()
  }, runReviewAI: async messages => {
    calls++; const input = JSON.stringify(messages)
    expect(input).toContain('我想先休息。'); expect(input).toContain('玩家表示想先休息。')
    expect(input).not.toContain('担心再次错怪人'); expect(input).not.toContain('木箱'); return checks()
  }})
  expect(calls).toBe(2); expect((await state(f.sessionId)).memories).toEqual([])
  expect(generated.snapshot.contract.budget.maxModelCalls).toBe(2)
  expect(generated.snapshot.projection.steps[CHAT_MEMORY_REVIEW_STEP].status).toBe('succeeded')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  let current = await state(f.sessionId)
  expect(current.memories[0].status).toBe('proposed'); expect(hasChatMemoryContentReviewV1(current, current.memories[0])).toBe(true)
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: current.memories[0].memoryId, resolution: 'accepted'})
  current = await state(f.sessionId)
  expect(interactionVisibilityView(current, 'guard').memories[0].content).toBe('玩家表示想先休息。')
  expect(JSON.stringify(interactionVisibilityView(current, 'guard'))).not.toContain('contentReview')
  expect(selectChatCoordinatorContextV1(current)).not.toContain('bindingJson')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})).resolves.toBeDefined()
})

it.each([
  ['角色担心再次错怪人。', 'player-visibility'],
  ['玩家答应不休息并帮助搜查。', 'source-fidelity'],
  ['玩家想休息说明玩家患有抑郁症。', 'no-private-inference'],
])('rejects the constructed counterexample %s without a runtime proposal or hidden retry', async (content, failed) => {
  const f = await start(); let calls = 0; let runId = 0
  const input = {...f.input, onRunCreated: (id: number) => {runId = id}, runAI: async () => {calls++; return f.draft(content)}, runReviewAI: async () => {calls++; return checks(failed)}}
  await expect(generateInteractionRuntimeCandidateV1(input)).rejects.toThrow('正文审查未通过')
  expect((await state(f.sessionId)).memories).toEqual([])
  const saved = await readInteractionRuntimeCandidateV1(f.scope, runId)
  expect(saved.candidate.kind === 'memory-curator-candidate' && saved.candidate.contentReview).toBeUndefined()
  expect(saved.snapshot.projection.state).toBe('failed')
  expect(saved.snapshot.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === CHAT_MEMORY_REVIEW_STEP && e.payload.artifactKind === 'raw-response')).toBe(true)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow('尚未审查')
  await expect(resumeChatMemoryReviewV1({...input, runId})).rejects.toThrow('已停止')
  await expect(generateInteractionRuntimeCandidateV1(input)).rejects.toThrow('不会自动重复调用')
  expect(calls).toBe(2)
})

it('recovers after saved raw review output without a model and does not reveal or auto-accept the candidate', async () => {
  const f = await start(); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...f.input, onRunCreated: id => {runId = id}, runAI: async () => {calls++; return f.draft()},
    runReviewAI: async () => {calls++; return checks()}, onMemoryReviewResponseSaved: () => {throw new Error('host lost after raw save')},
  })).rejects.toThrow('host lost')
  db.close(); await db.open()
  const resumed = await resumeChatMemoryReviewV1({scope: f.scope, runId, runAI: async () => {throw new Error('must not call')}})
  expect(resumed.candidate.contentReview).toBeDefined(); expect(calls).toBe(2)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect((await state(f.sessionId)).memories[0].status).toBe('proposed')
})

it('keeps missing responses unknown and rejects changed configuration or stale runtime before a new request', async () => {
  const f = await start(); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...f.input, onRunCreated: id => {runId = id}, runAI: async () => {calls++; return f.draft()},
    onMemoryCandidateSaved: () => {throw new Error('host lost before review')},
  })).rejects.toThrow('host lost')
  vi.stubGlobal('navigator', {locks: {request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({})}})
  await expect(resumeChatMemoryReviewV1({scope: f.scope, runId, aiConfig: {provider: 'openai', model: 'changed', apiKey: 'unused'}})).rejects.toThrow('配置或审查版本已变化')
  let snapshot = await readInstanceAgentRunV1(f.scope, runId)
  for (const [type, payload] of [['step.scheduled', {stepId: CHAT_MEMORY_REVIEW_STEP}], ['step.started', {stepId: CHAT_MEMORY_REVIEW_STEP, attempt: 1}],
    ['model.requested', {stepId: CHAT_MEMORY_REVIEW_STEP, attempt: 1, bindingHash: '1'.repeat(64)}]] as const) {
    snapshot = await appendAgentRunEventV1({scope: f.scope, runId, productRuntimeSessionId: f.sessionId, expectedLastSequence: snapshot.projection.lastSequence, type, payload})
  }
  await expect(resumeChatMemoryReviewV1({scope: f.scope, runId, runAI: async () => {calls++; return checks()}})).rejects.toThrow('结果未知')
  expect(calls).toBe(1); expect((await state(f.sessionId)).memories).toEqual([])
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'later', text: '先暂停。'})
  await expect(resumeChatMemoryReviewV1({scope: f.scope, runId, runAI: async () => {calls++; return checks()}})).rejects.toThrow()
  expect(calls).toBe(1)
})

it('rejects malformed checks, a foreign instance and nonshared or replaced sources', async () => {
  const f = await start(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...f.input, onRunCreated: id => {runId = id}, runAI: async () => f.draft(), runReviewAI: async () => '{"checks":[]}'})).rejects.toThrow('项目不完整')
  const other = await start()
  await expect(assembleContext({projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, productRuntimeSessionId: other.sessionId,
    chatMemoryCandidateRunId: runId, sourceKeys: ['chatMemoryReview']})).rejects.toThrow()
  const current = await state(f.sessionId)
  const fake = {...current.memories[0], participantKey: 'guard', sourceEventSequences: [f.message.sequence], evidenceExcerpt: '休息', kind: 'key-memory' as const,
    content: '玩家想休息', importance: 60, contentReview: {version: 1 as const, bindingJson: '{}', reviewHash: '1'.repeat(64), passedChecks: CHAT_MEMORY_CHECKS}}
  expect(hasChatMemoryContentReviewV1(current, fake)).toBe(false)
  const privateState = structuredClone(current)
  privateState.messages[0].audienceKeys = ['guard']
  privateState.messages[0].speakerKey = 'guard'
  expect(() => chatMemoryReviewBindingV1(privateState, fake)).toThrow('共同可见')
  current.messages[0].supersededBySequence = 99
  expect(() => chatMemoryReviewBindingV1(current, fake)).toThrow('已替代')
  expect((await state(f.sessionId)).memories).toEqual([])
})

it('preserves portable review bindings across branch rebasing, parent deletion and backup; corrections discard the old proof', async () => {
  const f = await start()
  const generated = await generateInteractionRuntimeCandidateV1({...f.input, runAI: async () => f.draft(), runReviewAI: async () => checks()})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const original = (await state(f.sessionId)).memories[0]
  await resolveInteractionMemory({...await command(f.sessionId), memoryId: original.memoryId, resolution: 'accepted'})
  const version = await readProductRuntimeStateVersion(f.sessionId)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: version.sequence, title: '记忆审查分支'})
  await deleteProductRuntimeSession(f.sessionId)
  const branched = await state(branch.id!)
  expect(branched.memories[0].sourceEventSequences[0]).toBeLessThan(0)
  expect(hasChatMemoryContentReviewV1(branched, branched.memories[0])).toBe(true)
  const exported = await deriveStrictExportProjectJSON(f.scope.projectId)
  const importedId = await deriveImportProjectJSON(exported)
  const importedSession = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray())[0]
  const restored = await state(importedSession.id!)
  expect(hasChatMemoryContentReviewV1(restored, restored.memories[0])).toBe(true)
  await correctChatMemory({...await command(importedSession.id!), memoryId: original.memoryId, replacementMemoryId: 'edited', content: '玩家说想先休息，并没有承诺搜查。',
    sourceEventSequences: restored.memories[0].sourceEventSequences, evidenceExcerpt: '先休息', reason: '玩家修正措辞'})
  const edited = (await state(importedSession.id!)).memories.find(m => m.memoryId === 'edited')!
  expect(edited.authorship).toBe('player-correction'); expect(edited.contentReview).toBeUndefined()
})


it('rejects an oversized atomic memory evidence source without calling the reviewer on trimmed evidence', async () => {
  const f = await start(); let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...f.input, runAI: async () => f.draft('长摘要'.repeat(2000)),
    onRunCreated: id => {runId = id}, onMemoryCandidateSaved: () => {throw new Error('saved')},
  })).rejects.toThrow('saved')
  await expect(assembleContext({projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, productRuntimeSessionId: f.sessionId,
    chatMemoryCandidateRunId: runId, sourceKeys: ['chatMemoryReview'], inputBudgetMaxTokens: 500, sourceBudgetScale: 0.1})).rejects.toThrow()
  const saved = await readInstanceAgentRunV1(f.scope, runId)
  expect(saved.events.filter(e => e.type === 'model.requested')).toHaveLength(1)
})

it('does not apply a late review response after cancellation and keeps the retained evidence', async () => {
  const f = await start(), controller = new AbortController(); let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...f.input, signal: controller.signal, onRunCreated: id => {runId = id},
    runAI: async () => {calls++; return f.draft()}, runReviewAI: async () => {calls++; controller.abort(); return checks()},
  })).rejects.toThrow('已取消')
  expect(calls).toBe(2)
  const saved = await readInstanceAgentRunV1(f.scope, runId)
  expect(saved.projection.state).toBe('cancelled')
  expect(saved.events.some(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === CHAT_MEMORY_REVIEW_STEP && e.payload.artifactKind === 'raw-response')).toBe(true)
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow('尚未审查')
  expect((await state(f.sessionId)).memories).toEqual([])
})
