import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { activateReferenceAnalysisRun, createReferenceAnalysisRun, getActiveReferenceAnalysisRun,
  getReferenceAnalysisRunChunks } from '../../src/lib/reference-analysis/lifecycle'
import { cancelRefAnalysisPipeline, runRefAnalysis, setRefAnalysisPipelineListener } from '../../src/lib/reference-analysis/pipeline'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const config = { provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'http://127.0.0.1:9/v1',
  apiKey: 'synthetic-only', temperature: 0, maxTokens: 1000, contextWindow: 64_000 }
const originalSource = '仅本机参考素材，PRIVATE_SOURCE_044，不能进入完整备份。'
const invalidRaw = '模型已返回，用量已发生；PRIVATE_INVALID_044，不能解析'
const validRaw = '  {"narrativeStyle":"观察分析结果","rawExcerpt":"PRIVATE_UNCONFIRMED_RAW_044"}\n'
const usage = { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 }

beforeEach(async () => { await db.delete(); await db.open(); useAIConfigStore.setState({ config, taskRoutes: {} }) })
afterEach(() => { setRefAnalysisPipelineListener({}); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function fixture() {
  const { scope } = await seedCurrentWorkspace('044 参考分析私有作品')
  const referenceId = await db.references.add(stampNewRecord(scope, 'references', {
    projectId: scope.projectId, workId: scope.workId, title: '合成参考', author: '作者', type: 'story', note: '', url: '',
    analysisDepth: 'deep', analysisStatus: 'pending', analysisProgress: 0, fileHash: 'reference-044',
    totalChars: originalSource.length, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
  const run = await createReferenceAnalysisRun({ referenceId, depth: 'deep', sourceFilename: 'reference-044.txt',
    fileHash: 'reference-044', totalChars: originalSource.length, expectedChunks: 1, sourceKind: 'own-work',
    usageScope: 'analysis-only', rightsConfirmed: true, sourceText: originalSource })
  return { scope, referenceId, runId: run.id! }
}

function wire(raw: string) {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: raw }, finish_reason: 'stop' }], usage }),
    { headers: { 'Content-Type': 'application/json' } })
}

it.each([401, 402, 403, 'unknown', 'invalid'] as const)('044 reference %s stores attempt evidence and a new read never repeats POST', async mode => {
  const f = await fixture()
  const transport = vi.fn<typeof fetch>(async (_url, options) => {
    expect(options?.method).toBe('POST')
    if (mode === 'unknown') throw new TypeError('isolated post-send disconnect')
    if (mode === 'invalid') return wire(invalidRaw)
    return new Response(JSON.stringify({ error: { message: 'isolated refusal' } }), { status: mode })
  })
  vi.stubGlobal('fetch', transport)
  await runRefAnalysis(f.referenceId, f.runId)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(await db.agentRuns.count()).toBe(1)
  expect((await db.referenceAnalysisRuns.get(f.runId))?.status).toBe('failed')
  const artifacts = await db.agentRunArtifacts.toArray()
  const response = artifacts.find(row => row.artifactKind === 'raw-response')
  if (mode === 'invalid') expect(JSON.parse(response!.content!)).toMatchObject({
    raw: invalidRaw, observation: { usage: { inputTokens: 31, outputTokens: 7 } },
  })
  else expect(response).toBeUndefined()
  expect(artifacts.some(row => row.artifactKind === 'tool-result')).toBe(true)
  db.close(); await db.open()
  await runRefAnalysis(f.referenceId, f.runId)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(await getReferenceAnalysisRunChunks(f.referenceId, f.runId)).toEqual([])
  expect(await getActiveReferenceAnalysisRun(f.referenceId)).toBeUndefined()
  expect((await db.referenceAnalysisSources.get(f.runId))?.chunks[0].text).toBe(originalSource)
})

it('044 private reference response save failure retries local storage, then author may explicitly activate', async () => {
  const f = await fixture()
  const transport = vi.fn<typeof fetch>(async () => wire(validRaw))
  vi.stubGlobal('fetch', transport)
  const add = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
  const failure = vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation((row, key) => {
    if (row.artifactKind === 'raw-response') throw new Error('isolated local evidence write failure')
    return add(row, key)
  })
  await runRefAnalysis(f.referenceId, f.runId)
  expect((await db.referenceAnalysisRuns.get(f.runId))?.status).toBe('failed')
  expect(await getReferenceAnalysisRunChunks(f.referenceId, f.runId)).toEqual([])
  failure.mockRestore()
  await runRefAnalysis(f.referenceId, f.runId)
  expect(transport).toHaveBeenCalledTimes(1)
  expect((await db.referenceAnalysisRuns.get(f.runId))?.status).toBe('ready')
  expect(await getActiveReferenceAnalysisRun(f.referenceId)).toBeUndefined()
  expect(await getReferenceAnalysisRunChunks(f.referenceId, f.runId)).toMatchObject([{ narrativeStyle: '观察分析结果' }])
  const artifact = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response')
  expect(JSON.parse(artifact!.content!).raw).toBe(validRaw)
  await activateReferenceAnalysisRun(f.runId)
  expect((await getActiveReferenceAnalysisRun(f.referenceId))?.id).toBe(f.runId)
})

it('044 backup excludes private execution closure, preserves activated result, and fresh import sends no replacement', async () => {
  const f = await fixture()
  const transport = vi.fn<typeof fetch>(async () => wire(validRaw))
  vi.stubGlobal('fetch', transport)
  await runRefAnalysis(f.referenceId, f.runId)
  await activateReferenceAnalysisRun(f.runId)
  const sourceRuns = await db.agentRuns.toArray()
  const evidence = await db.agentRunArtifacts.toArray()
  expect(evidence.some(row => row.content?.includes(originalSource))).toBe(true)
  expect(evidence.some(row => row.content?.includes('PRIVATE_UNCONFIRMED_RAW_044'))).toBe(true)
  const backup = await exportProjectJSON(f.scope.projectId)
  expect(backup.agentRuns).toEqual([])
  expect(backup.agentRunEvents).toEqual([])
  expect(backup.agentRunArtifacts).toEqual([])
  expect(JSON.stringify(backup)).not.toMatch(/PRIVATE_SOURCE_044|PRIVATE_UNCONFIRMED_RAW_044/)
  expect(await db.agentRuns.toArray()).toEqual(sourceRuns)
  expect(await db.agentRunArtifacts.toArray()).toEqual(evidence)
  await db.delete(); await db.open()
  const id = await importProjectJSON(backup)
  const ref = (await db.references.where('projectId').equals(id).first())!
  const active = (await getActiveReferenceAnalysisRun(ref.id!))!
  expect(await getReferenceAnalysisRunChunks(ref.id!, active.id!)).toMatchObject([{ narrativeStyle: '观察分析结果' }])
  expect(await db.referenceAnalysisSources.count()).toBe(0)
  await runRefAnalysis(ref.id!, active.id!)
  expect(transport).toHaveBeenCalledTimes(1)
})

it('044 backup rejects a private exact artifact shared by another Run without deleting either', async () => {
  const f = await fixture()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => wire(validRaw)))
  await runRefAnalysis(f.referenceId, f.runId)
  const raw = (await db.agentRunArtifacts.toArray()).find(row => row.artifactKind === 'raw-response')!
  const outside = await createAgentRunV1({ scope: f.scope, contract: {
    version: 1, runtimeBindingHash: 'a'.repeat(64), objective: '本机隔离另一运行', workflowKind: 'read-only-audit',
    scope: { projectId: f.scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: ['manualText'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 10, maxOutputTokens: 10, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'outside.output', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'outside.terminal', kind: 'terminal', verifier: 'outside', criterionIds: ['outside.output'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  const ordinary = await exportProjectJSON(f.scope.projectId)
  expect(ordinary.agentRuns).toHaveLength(1)
  expect(ordinary.agentRuns[0].contractJson).toContain('本机隔离另一运行')
  expect(ordinary.agentRunArtifacts).toEqual([])
  await recordAgentRunArtifactV1({ scope: f.scope, runId: outside.run.id, artifactKind: 'raw-response', content: raw.content! })
  await expect(exportProjectJSON(f.scope.projectId)).rejects.toThrow(/其它 Run 引用/)
  expect(await db.agentRuns.count()).toBe(2)
  expect((await db.agentRunArtifacts.get(raw.id!))?.content).toBe(raw.content)
})

it('044 reference retries only a confirmed throttle and freezes the two attempt limit', async () => {
  const f = await fixture()
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: { message: 'isolated throttle' } }), { status: 429 }))
  vi.stubGlobal('fetch', transport)
  const activity: string[] = []
  setRefAnalysisPipelineListener({ onActivity: (_level, text) => { activity.push(text) } })
  await runRefAnalysis(f.referenceId, f.runId)
  expect(transport).toHaveBeenCalledTimes(2)
  expect(await db.agentRuns.count()).toBe(2)
  expect(activity.some(text => text.includes('有界重试'))).toBe(true)
  await runRefAnalysis(f.referenceId, f.runId)
  expect(transport).toHaveBeenCalledTimes(2)
})

it('044 max-six housekeeping cannot silently delete an unknown source and its Harness link', async () => {
  const f = await fixture()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('isolated post-send disconnect') }))
  await runRefAnalysis(f.referenceId, f.runId)
  const previous = await db.referenceAnalysisSources.get(f.runId)
  const next = (index: number) => createReferenceAnalysisRun({ referenceId: f.referenceId, depth: 'deep',
    sourceFilename: `next-${index}.txt`, fileHash: `next-${index}`, totalChars: 10, expectedChunks: 1,
    sourceKind: 'own-work', usageScope: 'analysis-only', rightsConfirmed: true, sourceText: '原文不参与本次分析。' })
  for (let i = 1; i <= 5; i++) await next(i)
  await expect(next(6)).rejects.toThrow()
  expect(await db.referenceAnalysisSources.get(f.runId)).toEqual(previous)
  expect(await db.agentRuns.count()).toBe(1)
})

it('044 old source with no request provenance does not restart after an upgrade', async () => {
  const f = await fixture()
  const source = (await db.referenceAnalysisSources.get(f.runId))!
  Reflect.deleteProperty(source, 'referencePrivateExecutionV1')
  await db.referenceAnalysisSources.put(source)
  const transport = vi.fn<typeof fetch>(async () => wire(validRaw))
  vi.stubGlobal('fetch', transport)
  await runRefAnalysis(f.referenceId, f.runId)
  expect(transport).not.toHaveBeenCalled()
  expect(await db.agentRuns.count()).toBe(0)
  expect((await db.referenceAnalysisRuns.get(f.runId))?.error).toMatch(/旧版本.*不能续发/)
  expect((await db.referenceAnalysisSources.get(f.runId))?.chunks[0].text).toBe(originalSource)
})

it('044 cancelled post-send reference cannot resume as a second request', async () => {
  const f = await fixture()
  let dispatched!: () => void
  const sent = new Promise<void>(resolve => { dispatched = resolve })
  const transport = vi.fn<typeof fetch>(async (_url, options) => {
    dispatched()
    return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('isolated cancellation', 'AbortError')), { once: true })
    })
  })
  vi.stubGlobal('fetch', transport)
  const execution = runRefAnalysis(f.referenceId, f.runId)
  await sent
  cancelRefAnalysisPipeline()
  await execution
  expect((await db.referenceAnalysisRuns.get(f.runId))?.status).toBe('cancelled')
  await runRefAnalysis(f.referenceId, f.runId)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(await db.agentRuns.count()).toBe(1)
  expect(await getActiveReferenceAnalysisRun(f.referenceId)).toBeUndefined()
})
