import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
interface ReaderFixture {
  render(value: string, options?: { readOnly?: boolean; editable?: boolean }): void
  unmount(): void
  edits: string[]
  copied: string[]
  failCopy: boolean
}
declare global {
  interface Window {
    __markdownReader051: ReaderFixture
    __markdownExecuted051: number
    __markdownStorageAttempts051: number
  }
}
const fixtureURL = 'http://markdown-read.fixture.invalid/'
let explicitURL = ''
let linkServer: Server
let linkBudget = 0
const linkReceipts: Array<{ path: string; authorized: boolean }> = []
const attempts = new WeakMap<BrowserContext, Array<{ url: string; authorized: boolean }>>()
let bundle = ''
test.beforeAll(async () => {
  linkServer = createServer((request, response) => {
    const authorized = request.method === 'GET' && request.url === '/docs' && linkBudget > 0
    if (authorized) linkBudget--
    linkReceipts.push({ path: request.url ?? '', authorized })
    response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' }); response.end('Explicit authorized loopback link fixture.')
  })
  await new Promise<void>(resolve => linkServer.listen(0, '127.0.0.1', resolve))
  explicitURL = `http://127.0.0.1:${(linkServer.address() as AddressInfo).port}/docs`
  const entry = 'virtual:markdown-read-a0-fixture'
  const source = JSON.stringify(fileURLToPath(new URL('../../src/components/shared/MarkdownReadView.tsx', import.meta.url)))
  const code = `import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';import Reader from ${source};
const root=createRoot(document.getElementById('fixture'));
const api={edits:[],copied:[],failCopy:false,render:(value,options={})=>root.render(h(Reader,{value,readOnly:options.readOnly,onRequestEdit:options.editable===false?undefined:raw=>api.edits.push(raw)})),unmount:()=>root.unmount()};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async raw=>{api.copied.push(raw);if(api.failCopy)throw Error('isolated clipboard rejection')}}});
window.__markdownReader051=api;api.render('');`
  const built = await build({ configFile: false, publicDir: false, logLevel: 'silent', plugins: [{ name: 'markdown-read-a0-fixture', resolveId(id) { if (id === entry) return '\0' + entry }, load(id) { if (id === '\0' + entry) return code } }],
    build: { write: false, minify: false, rollupOptions: { input: entry, output: { format: 'iife' } } } })
  bundle = (Array.isArray(built) ? built : [built]).flatMap(output => 'output' in output ? output.output : []).filter(output => output.type === 'chunk').map(output => output.code).join('\n')
  expect(bundle).not.toBe('')
})
test.afterAll(async () => { await new Promise<void>((resolve, reject) => linkServer.close(error => error ? reject(error) : resolve())) })
test.beforeEach(async ({ context, page }) => {
  linkBudget = 0; linkReceipts.length = 0
  let initialDocument = true
  const traffic: Array<{ url: string; authorized: boolean }> = []; attempts.set(context, traffic)
  // Observe attempts before interception. Authorize one initial document and
  // only an explicit navigation budget. The loopback server independently
  // records middle-click browser-process navigation that Chrome may omit here.
  context.on('request', request => {
    const initial = initialDocument && request.url() === fixtureURL && request.isNavigationRequest()
    if (initial) initialDocument = false
    traffic.push({ url: request.url(), authorized: initial || (request.url() === explicitURL && request.isNavigationRequest() && linkBudget > 0) })
  })
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url === fixtureURL) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>051-A0 isolated reader</title><style>*{box-sizing:border-box}body{margin:0;font:16px system-ui;color:#234239;background:#faf9f5}#fixture{width:100%;min-width:0;padding:24px}button{cursor:pointer}a{color:#176052}</style><div id="fixture"></div>' })
    if (url === explicitURL && route.request().isNavigationRequest()) return route.continue()
    return route.abort('blockedbyclient')
  })
  await page.addInitScript(() => {
    window.__markdownExecuted051 = 0; window.__markdownStorageAttempts051 = 0
    for (const method of ['setItem', 'removeItem', 'clear'] as const) Storage.prototype[method] = () => { window.__markdownStorageAttempts051++; throw Error('No storage authority') }
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() { window.__markdownStorageAttempts051++; throw Error('No DB authority') }, deleteDatabase() { window.__markdownStorageAttempts051++; throw Error('No DB authority') } } })
  })
  page.on('dialog', dialog => { void dialog.dismiss(); throw Error('Unexpected executable Markdown') })
  await page.goto(fixtureURL); await page.addScriptTag({ content: bundle }); await expect(page.locator('[data-markdown-read-view]')).toBeVisible()
})
test.afterEach(async ({ context, page }, info) => {
  expect(await page.evaluate(() => window.__markdownExecuted051)).toBe(0)
  expect(await page.evaluate(() => window.__markdownStorageAttempts051)).toBe(0)
  const traffic = attempts.get(context)!; expect(traffic.filter(request => !request.authorized)).toEqual([])
  expect(linkReceipts.filter(request => !request.authorized)).toEqual([])
  const report = { executionMarker: await page.evaluate(() => window.__markdownExecuted051), storageApiAttempts: await page.evaluate(() => window.__markdownStorageAttempts051), contextObserved: traffic, explicitLoopbackReceipts: [...linkReceipts] }
  await mkdir(info.outputDir, { recursive: true })
  await writeFile(info.outputPath('native-safety.json'), JSON.stringify(report, null, 2) + '\n')
  await info.attach('attempted-http-requests-before-interception', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
})
async function render(page: Page, value: string, options?: { readOnly?: boolean; editable?: boolean }) {
  await page.evaluate(({ value, options }) => window.__markdownReader051.render(value, options), { value, options })
}
const raw = '  # 世界🌊\r\n\r\n**粗体** 与 *斜体*\r\n\r\n> 引用\r\n\r\n- 一\r\n- 二\r\n\r\n| 港 | 山 |\r\n| :-- | --: |\r\n| A | B |\r\n\r\n```text\r\n+---+   +---+\r\n| A |---| B |  \r\n+---+   +---+\r\n```\r\n  '
test('native HTML/script/SVG/iframe/event/style and every remote image remain inert text with zero unauthorized HTTP attempts', async ({ page }) => {
  const attack = '<script>window.__markdownExecuted051++</script>\n<img src="https://evil.fixture.invalid/html" onerror="window.__markdownExecuted051++">\n<svg onload="window.__markdownExecuted051++"><image href="https://evil.fixture.invalid/svg"></image></svg>\n<iframe src="https://evil.fixture.invalid/frame" srcdoc="<script>parent.__markdownExecuted051++</script>"></iframe>\n<style>@import url(https://evil.fixture.invalid/css);</style>\n<math><mtext><img src=x onerror="window.__markdownExecuted051++"></mtext></math>\n\n![远程图片](https://evil.fixture.invalid/md.png)\n\n[![嵌套图片](https://evil.fixture.invalid/nested.png)](javascript:alert(1))\n\n| 单元 |\n| -- |\n| <img src=x onerror="window.__markdownExecuted051++"> |\n\n&lt;script&gt;window.__markdownExecuted051++&lt;/script&gt;'
  await render(page, attack); await expect(page.locator('#fixture')).toContainText('［图片：远程图片］')
  await expect(page.locator('#fixture')).toContainText('<script>window.__markdownExecuted051++</script>')
  await expect(page.locator('#fixture script,#fixture img,#fixture svg,#fixture iframe,#fixture math,#fixture style,#fixture link,#fixture object,#fixture video,#fixture audio')).toHaveCount(0)
  await expect(page.locator('#fixture [src],#fixture [srcset],#fixture [onerror],#fixture [onload],#fixture a')).toHaveCount(0)
  await page.getByRole('button', { name: '查看源码', exact: true }).click()
  expect(await page.locator('[data-markdown-source]').textContent()).toBe(attack)
  await page.waitForTimeout(350)
  expect(attempts.get(page.context())!.filter(request => request.url !== fixtureURL)).toEqual([])
})
test('native closed URL policy rejects schemes, controls, entities, encoding confusion, credentials and relative routes', async ({ page }) => {
  const bad = ['javascript:alert%281%29', 'JaVaScRiPt:alert%281%29', 'data:text/html,x', 'vbscript:x', 'file:///tmp/x', 'blob:https://x/y', '//evil.fixture.invalid/x', '/local/route', 'https%3a%2f%2fevil.fixture.invalid', '&#106;avascript:alert%281%29', 'java&Tab;script:alert%281%29', 'https://example.test/%0a', 'https://example.test/%250a', 'https://example.test/%00', 'https://example.test/%C2%85', 'https://example.test/%E2%80%8B', 'https://user:pass@example.test', 'https://example.test/?x=&NewLine;']
  await render(page, bad.map((url, i) => `[unsafe-${i}](${url})`).join('\n\n'))
  await expect(page.locator('#fixture a')).toHaveCount(0); expect(await page.locator('#fixture').textContent()).toContain('unsafe-0')
  expect(attempts.get(page.context())!.filter(request => request.url !== fixtureURL)).toEqual([])
})
for (const width of [1366, 390]) test(`native semantic reading/copy preserves original CRLF source and ASCII/table overflow at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 }); await render(page, raw)
  await expect(page.getByRole('heading', { name: '世界🌊' })).toBeVisible(); await expect(page.locator('strong')).toHaveText('粗体')
  await expect(page.locator('blockquote')).toContainText('引用'); await expect(page.locator('ul li')).toHaveCount(2); await expect(page.getByRole('columnheader')).toHaveCount(2)
  expect(await page.locator('pre code').textContent()).toBe('+---+   +---+\n| A |---| B |  \n+---+   +---+')
  expect(await page.locator('pre').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre')
  await page.getByRole('button', { name: '复制源码', exact: true }).click()
  expect(await page.evaluate(() => window.__markdownReader051.copied)).toEqual([raw])
  await page.getByRole('button', { name: '查看源码', exact: true }).click(); expect(await page.locator('[data-markdown-source]').textContent()).toBe(raw)
  expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([])
  await page.getByRole('button', { name: '返回阅读', exact: true }).click()
  await page.screenshot({ path: info.outputPath(`markdown-reader-${width}.png`), fullPage: true })
  const wide = `| ${'宽'.repeat(150)} | 右 |\n| -- | -- |\n| 内容 | 内容 |\n\n\`\`\`text\n${'A--'.repeat(150)}\n\`\`\``
  await render(page, wide)
  await expect.poll(() => page.locator('[data-markdown-table-scroll]').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth)).toBe(true)
  const scroll = page.locator('[data-markdown-table-scroll]'); await scroll.hover(); await page.mouse.wheel(250, 0)
  await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([])
})
test('native selection, double click, copy, code/table scrolling and readonly/source actions never trigger body editing', async ({ page }) => {
  const value = '可选择这段文字\n\n```text\n  code ASCII  \n```'
  await render(page, value); const paragraph = page.locator('[data-markdown-body] p').first()
  await paragraph.dblclick(); await page.waitForTimeout(300); expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([])
  await paragraph.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
  await page.waitForTimeout(300); expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([])
  await page.evaluate(() => window.getSelection()!.removeAllRanges()); await page.locator('pre code').click(); await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([])
  await paragraph.click(); await expect.poll(() => page.evaluate(() => window.__markdownReader051.edits)).toEqual([value])
  await page.getByRole('button', { name: '查看源码', exact: true }).click(); await page.locator('[data-markdown-source]').click(); await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([value])
  await page.getByRole('button', { name: '编辑源码', exact: true }).click(); expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([value, value])
  await render(page, value, { readOnly: true }); await expect(page.getByRole('button', { name: '编辑源码', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '返回阅读', exact: true }).click(); await paragraph.click(); await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([value, value])
})
test('native safe-link hover is passive; left/middle/keyboard link actions are explicit and separate from edit requests', async ({ page, context }) => {
  await render(page, `[明确外链](${explicitURL}) 与 [页内锚点](#inside)\n\n普通文字`)
  const link = page.getByRole('link', { name: '明确外链', exact: true }); await expect(link).toHaveAttribute('rel', 'noopener noreferrer'); await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
  await link.hover(); await page.waitForTimeout(300); expect(attempts.get(context)!.filter(request => request.url !== fixtureURL)).toEqual([])
  for (const action of ['left', 'middle', 'keyboard'] as const) {
    linkBudget++
    const popupPromise = context.waitForEvent('page')
    if (action === 'keyboard') { await link.focus(); await link.press('Enter') } else await link.click({ button: action === 'left' ? 'left' : 'middle' })
    const popup = await popupPromise; await expect(popup).toHaveURL(explicitURL); await popup.waitForLoadState(); await popup.close()
    expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([])
  }
  await page.getByRole('link', { name: '页内锚点', exact: true }).click(); await expect(page).toHaveURL(fixtureURL + '#inside')
  expect(await page.evaluate(() => window.__markdownReader051.edits)).toEqual([])
  expect(linkReceipts).toEqual(Array.from({ length: 3 }, () => ({ path: '/docs', authorized: true })))
  expect(linkBudget).toBe(0)
})
