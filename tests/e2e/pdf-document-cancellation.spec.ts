import { expect, test } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

function pdfFixture() {
  const streams = ['Page one complete original source text for the import reader.', 'Page two final original source text remains complete.']
  const page = (content: number) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents ${content} 0 R >>`
  const stream = (value: string) => { const body = `BT /F1 12 Tf 30 740 Td (${value}) Tj ET`;return `<< /Length ${body.length} >>\nstream\n${body}\nendstream` }
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>', page(4), stream(streams[0]), page(6), stream(streams[1]), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let text = '%PDF-1.4\n';const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text));text += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return { bytes: Buffer.from(text), expected: streams.join('\n\n') }
}

test('032 native PDF worker reads complete pages, exposes fidelity limits and recovers after a bad file without any model', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let posts = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '032-pdf-lifecycle'))
  await context.route('**/*', route => {
    if (route.request().method() === 'POST') posts++
    return new URL(route.request().url()).origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const scope = await page.evaluate(async () => {
    const { seedCurrentWorkspace } = await (new Function('return import("/storyforge/tests/helpers/current-workspace.ts")'))()
    return (await seedCurrentWorkspace('032 PDF 原件隔离工程')).scope
  })
  await page.goto(`./workspace/${scope.projectId}`)
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 15000 })
  await openLongformLeaf(page, '文档解析')
  const upload = page.locator('input[type=file][accept*=".pdf"]'), area = page.getByPlaceholder(/^把文档内容粘贴在这里/), f = pdfFixture()
  await upload.setInputFiles({ name: '损坏.pdf', mimeType: 'application/pdf', buffer: Buffer.from('bad PDF') })
  await expect(page.getByText('Invalid PDF structure.', { exact: true })).toBeVisible()
  await upload.setInputFiles({ name: '完整两页.pdf', mimeType: 'application/pdf', buffer: f.bytes })
  await expect(area).toHaveValue(f.expected)
  await expect(page.getByText(/2 页.*不保证逐字保真/)).toBeVisible()
  const aborted = await page.evaluate(async bytes => {
    const { extractTextFromFile } = await (new Function('return import("/storyforge/src/lib/doc-parser.ts")'))()
    const controller = new AbortController();controller.abort(new DOMException('作者取消', 'AbortError'))
    try { await extractTextFromFile(new File([Uint8Array.from(bytes)], '取消.pdf'), { signal: controller.signal });return 'unexpected success' }
    catch (cause) { return (cause as Error).name }
  }, Array.from(f.bytes))
  expect(aborted).toBe('AbortError');expect(posts).toBe(0)
})
