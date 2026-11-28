import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { openLongformLeaf } from './helpers/longform-navigation'

test('032 actual DOCX upload and frozen original recovery show safe structure without changing text or dispatching a model', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let posts = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '032-docx-structure'))
  await context.route('**/*', route => {
    if (route.request().method() === 'POST') posts++
    return new URL(route.request().url()).origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()
  })
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 原作🌙</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve"> 原段落 é完整尾字  </w:t></w:r></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并格内容</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>甲格</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙格</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>原文终点🪶</w:t></w:r></w:p></w:body></w:document>')
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style></w:styles>')
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  const bytes = await zip.generateAsync({ type: 'uint8array' })
  await page.goto('./')
  const scope = await page.evaluate(async () => {
    const { seedCurrentWorkspace } = await (new Function('return import("/storyforge/tests/helpers/current-workspace.ts")'))()
    return (await seedCurrentWorkspace('032 Word 结构隔离工程')).scope
  })
  await page.goto(`./workspace/${scope.projectId}`)
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15000 })
  await openLongformLeaf(page, '文档解析')
  const upload = page.locator('input[type=file][accept*=".docx"]'), area = page.getByPlaceholder(/^把文档内容粘贴在这里/)
  await upload.setInputFiles({ name: '原稿.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(bytes) })
  const preview = page.getByLabel('Word 文档结构对照', { exact: true })
  await expect(preview).toBeVisible()
  await preview.locator('summary').click()
  await expect(preview.getByText('第一章 原作🌙', { exact: true })).toBeVisible()
  await expect(preview.locator('td[colspan="2"]')).toHaveText('合并格内容')
  await expect(preview.getByText('原文终点🪶', { exact: true })).toBeVisible()
  const text = await area.inputValue()
  expect(text).toContain(' 原段落 é完整尾字  ')
  expect(text).toContain('甲格'); expect(text).toContain('乙格'); expect(text).toContain('原文终点🪶')
  await area.fill('换成作者粘贴原文')
  await expect(preview).toHaveCount(0)
  const id = await page.evaluate(async ({ bytes, scope, text }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useImportSessionStore, hashImportChunkTextV1 } = await load<typeof import('../../src/stores/import-session')>('/storyforge/src/stores/import-session.ts')
    const { quickHash } = await load<typeof import('../../src/lib/import/chunker')>('/storyforge/src/lib/import/chunker.ts')
    const store = useImportSessionStore.getState(), fileHash = quickHash(text)
    const id = await store.create({ projectId: scope.projectId, targetScope: scope, filename: '原稿.docx', fileHash, totalChars: text.length,
      totalChunks: 1, chunkSize: text.length, chunks: [{ index: 0, startChar: 0, endChar: text.length, charCount: text.length, sourceTextHash: await hashImportChunkTextV1(text), status: 'pending', attempts: 0 }],
      merged: {}, rollingContext: '', importTarget: 'reference', status: 'paused' })
    await store.saveBlob(id, '原稿.docx', new Blob([Uint8Array.from(bytes)]), fileHash)
    return id
  }, { bytes: Array.from(bytes), scope, text })
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15000 })
  await openLongformLeaf(page, '文档解析')
  await expect(preview).toBeVisible()
  await preview.locator('summary').click()
  await expect(preview.locator('td[colspan="2"]')).toHaveText('合并格内容')
  const restored = await page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const { getChunkText } = await (new Function('return import("/storyforge/src/lib/import/chunk-text-registry.ts")'))()
    return { text: getChunkText(id, 0), bytes: Array.from(new Uint8Array(await (await db.importFiles.get(id)).blob.arrayBuffer())), characters: await db.characters.count(), status: (await db.importSessions.get(id)).status }
  }, id)
  expect(restored.text).toBe(text);expect(restored.bytes).toEqual(Array.from(bytes));expect(restored.status).toBe('paused');expect(restored.characters).toBe(0)
  expect(posts).toBe(0)
})
