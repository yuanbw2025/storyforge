// @vitest-environment node
// Use the same native Blob constructor Dexie captures when loading; replacing
// jsdom's Blob after import would make its intrinsic-clone logic lose Node data.
import { Blob as NativeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const values = new Map<string, string>()
  const storage: Storage = { get length() { return values.size }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
    setItem: (key, value) => { values.set(key, String(value)) }, removeItem: key => { values.delete(key) } }
  Object.assign(globalThis, { localStorage: storage, sessionStorage: storage })
})
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createReferenceAnalysisRun, readReferenceAnalysisChunkPlanV1, readReferenceAnalysisChunkV1, readReferenceChunkAuthorityV1 } from '../../src/lib/reference-analysis/lifecycle'
import { encodeReferenceSourceReaderV1, readReferenceSourceChunkV1 } from '../../src/lib/reference-analysis/source-storage'
import type { ReferenceAnalysisSource } from '../../src/lib/types'
import { runRefAnalysis, setRefAnalysisPipelineListener } from '../../src/lib/reference-analysis/pipeline'
import { useAIConfigStore } from '../../src/stores/ai-config'

beforeEach(async () => { vi.stubGlobal('Blob', NativeBlob); await db.delete(); await db.open() })
afterEach(() => { setRefAnalysisPipelineListener({}); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const raw = '\uFEFF海😀e\u0301\r\n\r\n\uD800末尾。  '
function reader(texts: string[]) {
  let offset = 0
  const chunks = texts.map((text, index) => { const startChar = offset; offset += text.length; return { index, startChar, endChar: offset, charCount: text.length, label: `第${index + 1}块` } })
  return { chunks, read: async (index: number) => texts[index] }
}
function source(encoded: Awaited<ReturnType<typeof encodeReferenceSourceReaderV1>>): ReferenceAnalysisSource {
  return { analysisRunId: 1, projectId: 1, workId: 1, filename: 'synthetic.txt', fileHash: 'original-hash', createdAt: 1, ...encoded }
}
async function fixture() {
  const { scope } = await seedCurrentWorkspace('031 native chunk source')
  const referenceId = await db.references.add(stampNewRecord(scope, 'references', { projectId: scope.projectId, workId: scope.workId, title: '隔离参考', author: '', type: 'story', note: '', url: '', analysisDepth: 'deep', analysisStatus: 'pending', analysisProgress: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
  const texts = [raw.slice(0, 3), raw.slice(3), '中间原文。', '尾部原文。']
  const input = { referenceId, depth: 'deep' as const, sourceFilename: 'synthetic.txt', fileHash: 'original-hash', totalChars: texts.join('').length, expectedChunks: texts.length, sourceKind: 'own-work' as const, usageScope: 'analysis-only' as const, rightsConfirmed: true, sourceReader: reader(texts) }
  return { scope, referenceId, input, texts }
}
it('preserves every original UTF-16 cut including surrogate halves, BOM, CRLF and trailing spaces without UTF-8 replacement', async () => {
  for (let cut = 1; cut < raw.length; cut++) {
    const texts = [raw.slice(0, cut), raw.slice(cut)], saved = source(await encodeReferenceSourceReaderV1(reader(texts)))
    expect(saved.chunks.every(chunk => chunk.text === '')).toBe(true)
    expect((await readReferenceSourceChunkV1(saved, 0))?.text).toBe(texts[0])
    expect((await readReferenceSourceChunkV1(saved, 1))?.text).toBe(texts[1])
  }
})
it('retains only immutable Blob handles and reads only the requested block of a many-block source', async () => {
  const text = '海😀尾。'.repeat(32768), input = reader(Array(24).fill(text))
  let inFlight = 0, maxInFlight = 0
  input.read = async () => { maxInFlight = Math.max(maxInFlight, ++inFlight); await Promise.resolve(); inFlight--; return text }
  const saved = source(await encodeReferenceSourceReaderV1(input))
  const read = vi.spyOn(NativeBlob.prototype, 'arrayBuffer')
  expect((await readReferenceSourceChunkV1(saved, 23))?.text).toBe(text)
  expect(read).toHaveBeenCalledTimes(1); expect(maxInFlight).toBe(1)
  expect(saved.chunks.every(chunk => chunk.text === '' && chunk.textBlobV1?.size === text.length * 2)).toBe(true)
})
it('uses original native run/source identity and authorization after reopen while metadata reads decode no chunks', async () => {
  const f = await fixture(), run = await createReferenceAnalysisRun(f.input)
  db.close(); await db.open()
  const read = vi.spyOn(NativeBlob.prototype, 'arrayBuffer')
  expect(await readReferenceAnalysisChunkPlanV1(run.id!)).toEqual(f.input.sourceReader.chunks)
  expect(read).not.toHaveBeenCalled()
  expect((await readReferenceAnalysisChunkV1(run.id!, 3))?.text).toBe(f.texts[3]); expect(read).toHaveBeenCalledTimes(1)
  const authority = await readReferenceChunkAuthorityV1(f.scope, run.id!, 0)
  expect(authority.chunk.text).toBe(f.texts[0]); expect(authority.run.id).toBe(run.id)
  const other = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, create: { title: 'other Work' } })
  await expect(readReferenceChunkAuthorityV1({ ...f.scope, workId: other.id! }, run.id!, 0)).rejects.toThrow('当前作品')
  const stored = (await db.referenceAnalysisSources.get(run.id!))!
  stored.chunks[0].textHashV1 = '0'.repeat(64); await db.referenceAnalysisSources.put(stored)
  await expect(readReferenceChunkAuthorityV1(f.scope, run.id!, 0)).rejects.toThrow('分块摘要已变化')
})
it('rolls back the original first-start claim and source together on quota failure and allows only explicit retry', async () => {
  const f = await fixture()
  const guard = { transactionTables: [db.references], claimInTransaction: async () => { expect(Dexie.currentTransaction?.mode).toBe('readwrite'); await db.references.update(f.referenceId, { note: 'claimed' }) } }
  const fail = () => { throw new DOMException('native Blob source quota', 'QuotaExceededError') }; db.referenceAnalysisSources.hook('creating', fail)
  try { await expect(createReferenceAnalysisRun(f.input, guard)).rejects.toThrow('native Blob source quota') }
  finally { db.referenceAnalysisSources.hook('creating').unsubscribe(fail) }
  expect(await db.referenceAnalysisRuns.count()).toBe(0); expect(await db.referenceAnalysisSources.count()).toBe(0)
  expect((await db.references.get(f.referenceId))?.note).toBe('')
  const saved = await createReferenceAnalysisRun(f.input, guard)
  expect(saved.version).toBe(1); expect(await db.referenceAnalysisSources.count()).toBe(1)
  expect((await readReferenceAnalysisChunkV1(saved.id!, 2))?.text).toBe(f.texts[2])
})
it('cancels before native run/claim creation and rejects missing or corrupted Blob sources without creating attempts', async () => {
  const f = await fixture(), controller = new AbortController()
  f.input.sourceReader.read = async index => { controller.abort(); return f.texts[index] }
  await expect(createReferenceAnalysisRun({ ...f.input, signal: controller.signal })).rejects.toThrow()
  expect(await db.referenceAnalysisRuns.count()).toBe(0); expect(await db.agentRuns.count()).toBe(0)
  const encoded = source(await encodeReferenceSourceReaderV1(reader(['原文'])))
  encoded.chunks[0].textBlobV1 = new NativeBlob(['wrong']) as unknown as Blob
  await expect(readReferenceSourceChunkV1(encoded, 0)).rejects.toThrow('存储格式异常')
  delete encoded.sourceStorageV1
  await expect(readReferenceSourceChunkV1(encoded, 0)).rejects.toThrow('存储格式异常')
})

it('runs the existing durable request chain with exact Blob-backed chunks and never resends completed attempts', async () => {
  const f = await fixture(), run = await createReferenceAnalysisRun(f.input)
  useAIConfigStore.setState({ config: { provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'synthetic-only', temperature: 0, maxTokens: 1000, contextWindow: 64000 }, taskRoutes: {} })
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"narrativeStyle":"观察分析结果"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 } }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', transport)
  await runRefAnalysis(f.referenceId, run.id)
  const completed = await db.referenceAnalysisRuns.get(run.id!)
  expect(completed?.status, completed?.error).toBe('ready')
  expect(transport).toHaveBeenCalledTimes(f.texts.length)
  for (const [index, call] of transport.mock.calls.entries()) {
    const messages = JSON.parse(String(call[1]?.body)).messages as { content: string }[]
    expect(messages.some(message => message.content.includes(f.texts[index]))).toBe(true)
  }
  db.close(); await db.open(); await runRefAnalysis(f.referenceId, run.id)
  expect(transport).toHaveBeenCalledTimes(f.texts.length)
})
