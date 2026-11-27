import { test, expect } from '@playwright/test'

test('031 native private Blob chunks reopen exact Unicode and read only the selected original range', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let modelAttempts = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '031-isolated'))
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)/.test(url.pathname)) modelAttempts++
    return url.origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)')
    const { seedCurrentWorkspace } = await load('/storyforge/tests/helpers/current-workspace.ts')
    const { scope } = await seedCurrentWorkspace('031 隔离原生逐块来源')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord } = await load('/storyforge/src/lib/workspace/scope.ts')
    const { createReferenceAnalysisRun } = await load('/storyforge/src/lib/reference-analysis/lifecycle.ts')
    const referenceId = await db.references.add(stampNewRecord(scope, 'references', { projectId: scope.projectId, workId: scope.workId, title: '031 合成参考', author: '', type: 'story', note: '', url: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    const text = '\uFEFF海😀e\u0301\r\n\r\n尾空白。  '.repeat(4096) + '\uD800'
    const chunks = Array.from({ length: 32 }, (_, index) => ({ index, startChar: index * text.length, endChar: (index + 1) * text.length, charCount: text.length, label: `原块${index}` }))
    const input = { referenceId, depth: 'deep', sourceFilename: 'synthetic.txt', fileHash: 'native-original-hash', totalChars: text.length * chunks.length, expectedChunks: chunks.length, sourceKind: 'own-work', usageScope: 'analysis-only', rightsConfirmed: true, sourceReader: { chunks, read: async () => text } }
    const fail = () => { throw new DOMException('native source quota', 'QuotaExceededError') }; db.referenceAnalysisSources.hook('creating', fail)
    let failed = false
    try { await createReferenceAnalysisRun(input) } catch (cause) { failed = String(cause).includes('native source quota') }
    finally { db.referenceAnalysisSources.hook('creating').unsubscribe(fail) }
    if (!failed || await db.referenceAnalysisRuns.count() !== 0 || await db.referenceAnalysisSources.count() !== 0) throw new Error('native source failed to roll back')
    const run = await createReferenceAnalysisRun(input)
    const source = await db.referenceAnalysisSources.get(run.id)
    if (source.sourceStorageV1 !== 'utf16le-blob-chunks' || source.chunks.some((chunk: { text: string; textBlobV1: Blob }) => chunk.text !== '' || !(chunk.textBlobV1 instanceof Blob))) throw new Error('source materialized whole-book strings')
    return { scope, referenceId, runId: run.id, text }
  })
  await page.close()
  const reopened = await context.newPage(); await reopened.goto('./')
  const result = await reopened.evaluate(async fixture => {
    const load = new Function('path', 'return import(path)')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { scopeTransactionTables } = await load('/storyforge/src/lib/workspace/scope.ts')
    const { readReferenceAnalysisChunkPlanV1, readReferenceAnalysisChunkV1, readReferenceChunkAuthorityV1, writeReferenceChunkRunLinkV1 } = await load('/storyforge/src/lib/reference-analysis/lifecycle.ts')
    const original = Blob.prototype.arrayBuffer; let reads = 0, maxBytes = 0
    Blob.prototype.arrayBuffer = function () { reads++; maxBytes = Math.max(maxBytes, this.size); return original.call(this) }
    let step = 'metadata'
    try {
      const plan = await readReferenceAnalysisChunkPlanV1(fixture.runId), planReads = reads
      step = 'selected chunk'
      const last = await readReferenceAnalysisChunkV1(fixture.runId, 31)
      step = 'native authority transaction'
      const authority = await db.transaction('rw', scopeTransactionTables(db.references, db.referenceAnalysisRuns, db.referenceAnalysisSources), () => readReferenceChunkAuthorityV1(fixture.scope, fixture.runId, 0))
      step = 'original request claim writer'
      await writeReferenceChunkRunLinkV1(fixture.scope, fixture.runId, authority.chunk, undefined, { chunkIndex: 0, ordinal: 1, claimKey: 'isolated-native-claim', agentRunId: null })
      step = 'counts'
      return { count: plan.length, planReads, reads, maxBytes, last: last.text, first: authority.chunk.text, attempts: await db.agentRuns.count(), sourceCount: await db.referenceAnalysisSources.count() }
    } catch (cause) {
      const error = cause as { name?: string; message?: string; inner?: { name?: string; message?: string }; stack?: string }
      throw new Error(`${step}: ${error.name}: ${error.message}; inner=${error.inner?.name}: ${error.inner?.message}; ${error.stack}`)
    } finally { Blob.prototype.arrayBuffer = original }
  }, fixture)
  expect(result).toMatchObject({ count: 32, planReads: 0, reads: 3, first: fixture.text, last: fixture.text, attempts: 0, sourceCount: 1 })
  expect(result.maxBytes).toBe(fixture.text.length * 2)
  expect(modelAttempts).toBe(0)
})
