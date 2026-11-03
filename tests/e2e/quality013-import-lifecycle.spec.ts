/** Isolated browser regression for import-original recovery and deletion.
 * API seed/cache retention is explicit; recovery/navigation and library
 * deletion/consent exercise the actual UI. No provider/model is started.
 */
import { createHash } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

interface FamilySeed { projectId: number; sessionId: number; title: string; rawHex: string; chunkTexts: string[] }
interface DeleteObservation { settled: boolean; error: string | null; projectId: number }
type ObservedWindow = typeof globalThis & { __quality013Delete?: DeleteObservation }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function isolated(browser: Browser, baseURL: string | undefined, syntheticReply?: string) {
  if (!baseURL) throw new Error('013 requires its parent-reviewed loopback test server')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('013 refuses author/external origins')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const forbidden: Array<{ method: string; origin: string; pathname: string }> = []
  const submissions: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    const synthetic = syntheticReply && url.href === 'https://quality022.invalid/v1/chat/completions'
    const cors = { 'access-control-allow-origin': base.origin, 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? 'authorization, content-type' }
    if (synthetic && request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
    } else if (synthetic && request.method() === 'POST') {
      submissions.push(request.postData() ?? '')
      await route.fulfill({ status: 200, headers: cors, json: {
        choices: [{ message: { role: 'assistant', content: syntheticReply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 31, completion_tokens: 17, total_tokens: 48 },
      } })
    } else if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { forbidden.push({ method: request.method(), origin: url.origin, pathname: url.pathname }); await route.abort('blockedbyclient') }
  })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  return { context, forbidden, submissions }
}

async function seed(page: Page, titles: string[]): Promise<FamilySeed[]> {
  return page.evaluate(async names => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { hashImportChunkTextV1, useImportSessionStore } = await load<typeof import('../../src/stores/import-session')>('/storyforge/src/stores/import-session.ts')
    const { extractTextFromFile } = await load<typeof import('../../src/lib/doc-parser')>('/storyforge/src/lib/doc-parser.ts')
    const { chunkDocument, quickHash } = await load<typeof import('../../src/lib/import/chunker')>('/storyforge/src/lib/import/chunker.ts')
    const { registerChunkTexts } = await load<typeof import('../../src/lib/import/pipeline')>('/storyforge/src/lib/import/pipeline.ts')
    if (await db.projects.count() || await db.works.count()) throw new Error('013 seed requires empty new-context storage')
    const result: FamilySeed[] = []
    for (const title of names) {
      const workspace = await createWorkspace({ name: title, description: 'isolated synthetic import evidence', genres: [], status: 'drafting', targetWordCount: 100_000 }, { kind: 'novel', novelProfile: 'long' })
      const raw = `\uFEFF${title}\r\n第一章 海港\r\n${'灯塔与潮水。e\u0301🌙'.repeat(140)}\u0000\r\n第二章 归航\r\n${'逐字保留原文件。'.repeat(140)}`
      const bytes = new TextEncoder().encode(raw), blob = new Blob([bytes], { type: 'text/plain;charset=utf-8' })
      const parsed = await extractTextFromFile(new File([blob], 'synthetic-source.txt', { type: blob.type }))
      const plans = chunkDocument(parsed.text, { targetChars: 1000 }), fileHash = quickHash(parsed.text)
      const store = useImportSessionStore.getState()
      const chunks = await Promise.all(plans.map(async plan => ({
        index: plan.index, startChar: plan.startChar, endChar: plan.endChar, charCount: plan.charCount,
        sourceTextHash: await hashImportChunkTextV1(plan.text), status: 'pending' as const, attempts: 0,
      })))
      const sessionId = await store.create({ projectId: workspace.scope.projectId, filename: 'synthetic-source.txt', fileHash,
        totalChars: parsed.text.length, totalChunks: plans.length, chunkSize: 1000,
        targetScope: workspace.scope, chunks,
        merged: {}, rollingContext: '', importTarget: 'project', status: 'paused' })
      await store.saveBlob(sessionId, 'synthetic-source.txt', blob, fileHash)
      await store.log(sessionId, -1, 'info', 'synthetic source staged; no model started')
      registerChunkTexts(sessionId, plans.map(plan => ({ index: plan.index, text: plan.text })))
      result.push({ projectId: workspace.scope.projectId, sessionId, title,
        rawHex: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), chunkTexts: plans.map(plan => plan.text) })
    }
    return result
  }, titles)
}

async function family(page: Page, source: FamilySeed) {
  return page.evaluate(async ({ projectId, sessionId }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const file = await db.importFiles.get(sessionId)
    // Byte conversion happens outside any DB transaction; no external promise
    // is awaited inside an IndexedDB read/write scope.
    return { projectExists: Boolean(await db.projects.get(projectId)), session: (await db.importSessions.get(sessionId)) ?? null,
      logs: await db.importLogs.where('sessionId').equals(sessionId).sortBy('id'),
      file: file ? { sessionId: file.sessionId, filename: file.filename, fileHash: file.fileHash, fileSize: file.fileSize,
        createdAt: file.createdAt, rawHex: Array.from(new Uint8Array(await file.blob.arrayBuffer()), byte => byte.toString(16).padStart(2, '0')).join('') } : null }
  }, source)
}
async function cachedChunks(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { hasChunkTexts } = await load<typeof import('../../src/lib/import/pipeline')>('/storyforge/src/lib/import/pipeline.ts')
    const { getChunkText } = await load<typeof import('../../src/lib/import/chunk-text-registry')>('/storyforge/src/lib/import/chunk-text-registry.ts')
    const session = await db.importSessions.get(id)
    return { available: hasChunkTexts(id), chunks: session?.chunks.map(chunk => getChunkText(id, chunk.index)) ?? [] }
  }, sessionId)
}

test('013 native original staged by public API → real document-import recovery UI after cache loss/reload', async ({ browser, baseURL }, testInfo) => {
  const { context, forbidden } = await isolated(browser, baseURL)
  const page = await context.newPage()
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' })
    const [source] = await seed(page, ['QUALITY013 原文恢复'])
    if (!source) throw new Error('013 recovery source missing')
    expect(await cachedChunks(page, source.sessionId)).toEqual({ available: true, chunks: source.chunkTexts })
    const before = await family(page, source)
    expect(before.file?.rawHex).toBe(source.rawHex)
    await page.evaluate(async id => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { clearChunkTexts } = await load<typeof import('../../src/lib/import/pipeline')>('/storyforge/src/lib/import/pipeline.ts')
      clearChunkTexts(id)
    }, source.sessionId)
    expect((await cachedChunks(page, source.sessionId)).available).toBe(false)
    await page.goto(`./workspace/${source.projectId}`)
    await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15_000 })
    expect((await cachedChunks(page, source.sessionId)).available).toBe(false)
    expect(await openLongformLeaf(page, '文档解析')).toBe(true)
    await expect(page.getByText('发现未完成的解析任务', { exact: true })).toBeVisible()
    await expect(page.getByText('已从本地存档恢复原文', { exact: true })).toBeVisible()
    await expect.poll(() => cachedChunks(page, source.sessionId)).toEqual({ available: true, chunks: source.chunkTexts })
    expect(await family(page, source)).toEqual(before)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText('已从本地存档恢复原文', { exact: true })).toBeVisible({ timeout: 15_000 })
    expect(await cachedChunks(page, source.sessionId)).toEqual({ available: true, chunks: source.chunkTexts })
    expect(await family(page, source)).toEqual(before)
    expect(forbidden).toEqual([])
    await testInfo.attach('013-original-recovery-boundary', { contentType: 'application/json', body: JSON.stringify({
      source: { projectId: source.projectId, sessionId: source.sessionId }, originalByteHex: source.rawHex,
      expectedChunkSha256: hash(source.chunkTexts), familyBeforeAfterSha256: hash(before),
      API: 'public createWorkspace/create/saveBlob/log/register/clear only; not a UI upload/start claim',
      UI: 'actual longform document-import navigation, recovery banner and reload',
      parserBoundary: 'raw native Blob bytes exact; chunk text equals the real supported TXT parser/chunker result',
      modelCalls: 0, providerConfiguration: 'none', realAuthorProfile: false, forbidden,
    }, null, 2) })
  } finally { await context.close() }
})

test('013 actual project deletion UI → independent tab retained Session refuses late original/log writes', async ({ browser, baseURL }, testInfo) => {
  const { context, forbidden } = await isolated(browser, baseURL)
  const page = await context.newPage(), worker = await context.newPage()
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' })
    const [target, other] = await seed(page, ['QUALITY013 待删除来源', 'QUALITY013 保留来源'])
    if (!target || !other) throw new Error('013 deletion fixtures missing')
    const foreignBefore = await family(page, other)
    await worker.goto('./', { waitUntil: 'domcontentloaded' })
    await worker.evaluate(async id => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { useImportSessionStore } = await load<typeof import('../../src/stores/import-session')>('/storyforge/src/stores/import-session.ts')
      if (!(await useImportSessionStore.getState().load(id))) throw new Error('013 worker must retain a previously valid Session')
    }, target.sessionId)
    await page.goto('./long')
    const targetCard = page.locator('article').filter({ has: page.getByRole('heading', { name: target.title, exact: true }) })
    await expect(targetCard).toBeVisible({ timeout: 15_000 })
    // Passive observer returns the ORIGINAL public deletion promise unchanged.
    // Deletion, backup policy and lifecycle are not replaced or mocked.
    await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { useProjectStore } = await load<typeof import('../../src/stores/project')>('/storyforge/src/stores/project.ts')
      const original = useProjectStore.getState().deleteProject
      useProjectStore.setState({ deleteProject: id => {
        const observed: DeleteObservation = { projectId: id, settled: false, error: null }
        ;(globalThis as ObservedWindow).__quality013Delete = observed
        const result = original(id)
        void result.then(() => { observed.settled = true }, (error: unknown) => { observed.error = String(error); observed.settled = true })
        return result
      } })
    })
    await targetCard.getByRole('button', { name: '删除作品', exact: true }).click()
    await page.getByRole('dialog', { name: '危险操作:删除项目', exact: true }).getByRole('button', { name: '继续', exact: true }).click()
    await page.getByRole('dialog', { name: /^是否立即下载备份/ }).getByRole('button', { name: '已备份，继续', exact: true }).click()
    await expect.poll(() => page.evaluate(() => (globalThis as ObservedWindow).__quality013Delete)).toEqual({ projectId: target.projectId, settled: true, error: null })
    await expect(targetCard).toHaveCount(0)
    expect(await family(worker, target)).toEqual({ projectExists: false, session: null, logs: [], file: null })
    const results = await worker.evaluate(async ({ projectId, sessionId }) => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { useImportSessionStore } = await load<typeof import('../../src/stores/import-session')>('/storyforge/src/stores/import-session.ts')
      const store = useImportSessionStore.getState()
      const operations = [
        ['saveBlob', () => store.saveBlob(sessionId, 'late.txt', new Blob(['synthetic late original']), 'synthetic-late')],
        ['log', () => store.log(sessionId, 0, 'success', 'synthetic late log')],
        ['patch', () => store.patch(sessionId, { fatalError: 'late phantom update' })],
        ['patchChunk', () => store.patchChunk(sessionId, 0, { status: 'done', attempts: 9 })],
      ] as const
      const observations = []
      for (const [name, operation] of operations) {
        try { await operation(); observations.push({ name, rejected: false, error: null }) }
        catch (error) { observations.push({ name, rejected: true, error: error instanceof Error ? error.name : String(error) }) }
      }
      // create's ancestry gate is separately checked without inventing another root.
      try {
        await store.create({ projectId, filename: 'late-new.txt', fileHash: 'late', totalChars: 1, totalChunks: 0, chunkSize: 1000, chunks: [], merged: {}, rollingContext: '', importTarget: 'project', status: 'pending' })
        observations.push({ name: 'create', rejected: false, error: null })
      } catch (error) { observations.push({ name: 'create', rejected: true, error: error instanceof Error ? error.name : String(error) }) }
      return observations
    }, target)
    expect(results.map(row => row.name)).toEqual(['saveBlob', 'log', 'patch', 'patchChunk', 'create'])
    expect(results.every(row => row.rejected && row.error === 'ImportSessionUnavailableError')).toBe(true)
    expect(await family(worker, target)).toEqual({ projectExists: false, session: null, logs: [], file: null })
    expect(await family(worker, other)).toEqual(foreignBefore)
    expect(forbidden).toEqual([])
    await testInfo.attach('013-delete-late-write-boundary', { contentType: 'application/json', body: JSON.stringify({
      target: { projectId: target.projectId, sessionId: target.sessionId }, other: { projectId: other.projectId, sessionId: other.sessionId },
      UI: 'actual long-library delete, real first confirmation and explicit already-backed-up choice in isolated synthetic data',
      API: 'worker tab previously loaded valid Session; public late CRUD after original deletion promise settled',
      observer: 'passive delegation; original delete promise/permission/cascade retained', results,
      foreignBeforeAfterSha256: hash(foreignBefore), originalForeignByteHex: other.rawHex,
      doesNotClaim: ['paid model cancellation', 'original precollection scheduler race in browser', 'UI upload or actual backup download', 'SFQA022 formal AI adoption'],
      modelCalls: 0, realAuthorProfile: false, forbidden,
    }, null, 2) })
  } finally { await context.close() }
})

test('022 native recovery rejects an equal-count substitute Blob and a same-project foreign Work without dispatch', async ({ browser, baseURL }) => {
  const { context, forbidden } = await isolated(browser, baseURL)
  const page = await context.newPage()
  try {
    await page.goto('./')
    const [source] = await seed(page, ['QUALITY022 原目标和原文'])
    expect(source).toBeDefined()
    const before = await family(page, source)
    const proof = await page.evaluate(async ({ sessionId, projectId }) => {
      const load = new Function('p', 'return import(p)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const works = await load<typeof import('../../src/lib/workspace/works')>('/storyforge/src/lib/workspace/works.ts')
      const api = await load<typeof import('../../src/lib/import/pipeline')>('/storyforge/src/lib/import/pipeline.ts')
      const sourceRow = (await db.importFiles.get(sessionId))!
      const session = (await db.importSessions.get(sessionId))!
      const originalScope = session.targetScope!
      const changed = (await sourceRow.blob.text()).replace('潮水', '外域')
      await db.importFiles.update(sessionId, { blob: new Blob([changed], { type: sourceRow.blob.type }) })
      api.clearChunkTexts(sessionId)
      const sibling = await works.createWorldWork(projectId, { kind: 'novel', novelProfile: 'long', title: '外作品' })
      await works.switchActiveWork(projectId, sibling.id!)
      const wrongOwner = await api.retryFailedChunks({ projectId, sessionId }).then(() => '', error => String(error))
      await works.switchActiveWork(projectId, originalScope.workId)
      return { wrongOwner, originalSessionUnchanged: JSON.stringify(await db.importSessions.get(sessionId)) === JSON.stringify(session) }
    }, source)
    expect(proof.wrongOwner).toContain('作品已切换')
    expect(proof.originalSessionUnchanged).toBe(true)
    await page.goto(`./workspace/${source.projectId}`)
    await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15_000 })
    expect(await openLongformLeaf(page, '文档解析')).toBe(true)
    await expect(page.getByText('发现未完成的解析任务', { exact: true })).toBeVisible()
    await expect(page.getByText('⚠ 本地存档丢失（可能已清理浏览器数据），请在下方重新上传同一文件', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: '继续处理', exact: true })).toHaveCount(0)
    expect((await cachedChunks(page, source.sessionId)).available).toBe(false)
    expect((await family(page, source)).session).toEqual(before.session)
    expect(forbidden).toEqual([])
  } finally { await context.close() }
})


test('022 browser restores the exact paid candidate and waits for a visible author confirmation before Canon', async ({ browser, baseURL }, testInfo) => {
  const raw = ' \n' + JSON.stringify({ worldview: { worldOrigin: '第一次解析：港口源于潮水。' },
    outline: [{ type: 'volume', title: '雾港档案', children: [{ type: 'chapter', title: '第一夜' }] }] }) + ' \n'
  const { context, forbidden, submissions } = await isolated(browser, baseURL, raw)
  const page = await context.newPage()
  try {
    await page.goto('./')
    const [source] = await seed(page, ['QUALITY022 作者确认'])
    if (!source) throw new Error('missing isolated import seed')
    await page.goto(`./workspace/${source.projectId}`)
    await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15_000 })
    await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      useAIConfigStore.setState({ config: { provider: 'custom', contextWindow: 131072, model: 'synthetic-import-model',
        baseUrl: 'https://quality022.invalid/v1', apiKey: 'synthetic-test-only', temperature: 0, maxTokens: 16384 },
        presets: [], taskRoutes: {}, rememberApiKey: false })
    })
    expect(await openLongformLeaf(page, '文档解析')).toBe(true)
    await expect(page.getByText('已从本地存档恢复原文', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '继续处理', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '审查导入候选' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    expect(submissions).toHaveLength(1)
    const canon = () => page.evaluate(async projectId => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      return { worlds: (await db.worldviews.where('projectId').equals(projectId).toArray()).map(row => row.worldOrigin),
        titles: (await db.outlineNodes.where('projectId').equals(projectId).toArray()).map(row => row.title) }
    }, source.projectId)
    expect(await canon()).toEqual({ worlds: [], titles: [] })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText('已从本地存档恢复原文', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '查看详情', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByText('查看模型原答', { exact: true }).click()
    expect(await dialog.locator('pre').textContent()).toBe(raw)
    expect(await canon()).toEqual({ worlds: [], titles: [] })
    expect(submissions).toHaveLength(1)
    await dialog.getByRole('textbox', { name: '世界来源', exact: true }).fill('作者校订：两座岛之间出现港口。')
    await dialog.getByRole('button', { name: '确认保存本块', exact: true }).click()
    await expect.poll(canon).toEqual({ worlds: ['作者校订：两座岛之间出现港口。'], titles: ['雾港档案', '第一夜'] })
    expect((await family(page, source)).session?.chunks[0].durableParse?.confirmation?.receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/)
    expect(submissions).toHaveLength(1)
    expect(forbidden).toEqual([])
    await testInfo.attach('022-author-confirmed-import', { contentType: 'application/json',
      body: JSON.stringify({ syntheticPostCount: submissions.length, rawHash: hash(raw), sourceHash: hash(source.chunkTexts[0]),
        fixture: 'isolated browser database; synthetic transport only', confirmedChunk: 0 }) })
  } finally { await context.close() }
})
