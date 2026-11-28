import { expect, test, type Page } from '@playwright/test'
import { xlsxImportFixtureV1 } from '../fixtures/xlsx-import'
import { openLongformLeaf } from './helpers/longform-navigation'

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '032-isolated'))
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort())
  await page.goto('./')
})
async function parse(page: Page, bytes: Uint8Array) {
  return page.evaluate(async bytes => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { extractTextFromFile } = await load<typeof import('../../src/lib/doc-parser')>('/storyforge/src/lib/doc-parser.ts')
    try { return { result: await extractTextFromFile(new File([Uint8Array.from(bytes)], '人物资料.xlsx')), error: '' } }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : String(error) } }
  }, Array.from(bytes))
}
const records = (text: string) => text.split('\n').slice(2).map(line => JSON.parse(line) as Record<string, unknown>)

test('032 native XML preserves XLSX cells and rejects incomplete workbooks without any model', async ({ page }) => {
  for (const strict of [false, true]) {
    const { result, error } = await parse(page, await xlsxImportFixtureV1({ strict }))
    expect(error).toBe(''); expect(result?.status).toBe('ok'); expect(result?.sheetCount).toBe(2)
    expect(result?.rawChars).toBe(result?.text.length)
    const cells = records(result!.text)
    expect(cells).toContainEqual({ workbook: { date1904: '1' } })
    expect(cells).toContainEqual({ numberFormats: [{ id: '164', code: 'yyyy-mm-dd' }], cellNumberFormats: ['0', '164'] })
    expect(cells).toContainEqual({ sheet: '隐秘关系', state: 'veryHidden', part: 'xl/worksheets/second.xml' })
    expect(cells).toContainEqual({ cell: 'A3', type: 's', value: ' 林🌙\r第二行', hiddenRow: true })
    expect(cells).toContainEqual({ cell: 'C1', type: 's', value: '_x0041_' })
    expect(cells).toContainEqual({ cell: 'D3', type: 'n', value: '44000', hiddenRow: true, style: '1' })
    expect(cells).toContainEqual({ cell: 'E3', type: 'n', value: '3', hiddenRow: true, formula: 'SUM(1,2)', formulaAttributes: {} })
    expect(cells).toContainEqual({ cell: 'F3', type: 'b', value: '0', hiddenRow: true })
    expect(cells).toContainEqual({ cell: 'G3', type: 'e', value: '#N/A', hiddenRow: true })
    expect(cells).toContainEqual({ merged: 'A1:B1' })
    expect(cells).toContainEqual({ cell: 'XFD1048576', type: 'inlineStr', value: '<script>不执行</script>' })
    expect(result!.text).not.toContain('忽略注音')
  }
  const inferred = await parse(page, await xlsxImportFixtureV1({ sheet: '<sheetData><row><c t="inlineStr"><is><t>甲</t></is></c><c><v>0</v></c></row></sheetData>' }))
  expect(records(inferred.result!.text)).toContainEqual({ cell: 'B1', type: 'n', value: '0' })
  const empty = await parse(page, await xlsxImportFixtureV1({ sheet: '<sheetData/>', secondSheet: '<sheetData/>' }))
  expect(empty.result?.status).toBe('empty'); expect(empty.result?.diagnostics.nonWhitespaceUnits).toBe(0)
  for (const [sheet, error] of [
    ['<sheetData><row r="1"><c r="A1" t="s"><v>99</v></c></row></sheetData>', '共享字符串'],
    ['<sheetData><row r="1"><c r="A1"><f>1+2</f></c></row></sheetData>', '没有缓存'],
    ['<sheetData><row r="1"><c r="A2"><v>2</v></c></row></sheetData>', '坐标与所在行'],
    ['<sheetData><row r="1"><c r="A1" t="unknown"><v>2</v></c></row></sheetData>', '单元格类型'],
    ['<sheetData><row></sheetData>', 'XML 损坏'],
  ]) expect((await parse(page, await xlsxImportFixtureV1({ sheet }))).error).toContain(error)
  expect((await parse(page, await xlsxImportFixtureV1({ relationTarget: '../../escape.xml' }))).error).toContain('关系路径超出')
})

test('032 actual XLSX upload previews the source and restores original XLSX bytes and frozen ranges on refresh', async ({ page }) => {
  const scope = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    return (await seedCurrentWorkspace('032 XLSX 隔离验收')).scope
  })
  await page.goto(`./workspace/${scope.projectId}`)
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15000 })
  await openLongformLeaf(page, '文档解析')
  const bytes = await xlsxImportFixtureV1()
  const expected = (await parse(page, bytes)).result!.text
  await page.locator('input[type=file][accept*=".xlsx"]').setInputFiles({ name: '人物资料.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(bytes) })
  const area = page.getByPlaceholder(/^把文档内容粘贴在这里/)
  await expect(area).toHaveValue(expected)
  await expect(page.getByText(/2 个工作表/)).toBeVisible()
  await page.getByRole('button', { name: '开始解析', exact: true }).click()
  await expect(page.getByRole('button', { name: '导入当前项目（自动分块）', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /导入项目参考/ })).toBeVisible()
  // Stage the already-previewed bytes as a paused original session. No provider
  // is configured or started, and no candidate or formal record is authored.
  const staged = await page.evaluate(async ({ bytes, scope, text }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useImportSessionStore, hashImportChunkTextV1 } = await load<typeof import('../../src/stores/import-session')>('/storyforge/src/stores/import-session.ts')
    const { quickHash } = await load<typeof import('../../src/lib/import/chunker')>('/storyforge/src/lib/import/chunker.ts')
    const fileHash = quickHash(text), store = useImportSessionStore.getState()
    const sessionId = await store.create({ projectId: scope.projectId, targetScope: scope, filename: '人物资料.xlsx', fileHash,
      totalChars: text.length, totalChunks: 1, chunkSize: text.length, chunks: [{ index: 0, startChar: 0, endChar: text.length,
        charCount: text.length, sourceTextHash: await hashImportChunkTextV1(text), status: 'pending', attempts: 0 }],
      merged: {}, rollingContext: '', importTarget: 'reference', status: 'paused' })
    await store.saveBlob(sessionId, '人物资料.xlsx', new Blob([Uint8Array.from(bytes)]), fileHash)
    return { sessionId, fileHash }
  }, { bytes: Array.from(bytes), scope, text: expected })
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15000 })
  await openLongformLeaf(page, '文档解析')
  await expect.poll(async () => page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    return (await load<typeof import('../../src/lib/import/chunk-text-registry')>('/storyforge/src/lib/import/chunk-text-registry.ts')).getChunkText(id, 0)
  }, staged.sessionId)).toBe(expected)
  const original = await page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const row = await db.importFiles.get(id)
    return { bytes: Array.from(new Uint8Array(await row!.blob.arrayBuffer())), fileHash: row!.fileHash,
      status: (await db.importSessions.get(id))!.status, characters: await db.characters.count() }
  }, staged.sessionId)
  expect(original.bytes).toEqual(Array.from(bytes)); expect(original.fileHash).toBe(staged.fileHash)
  expect(original.status).toBe('paused'); expect(original.characters).toBe(0)
})
