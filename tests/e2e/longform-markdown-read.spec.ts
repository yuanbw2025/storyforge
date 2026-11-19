import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Page, type BrowserContext } from '@playwright/test'
const fields = ['worldStructure', 'worldDimensions', 'continentLayout', 'mountainsRivers', 'climateByRegion'] as const
const labels = ['世界结构', '疆域尺寸', '地貌分布', '山川水系', '气候环境']
const traffic = new WeakMap<BrowserContext, Array<{ url: string; authorized: boolean }>>()
const modelAttempts = new WeakMap<BrowserContext, number>()
let linkServer: Server, linkURL = '', linkBudget = 0
const linkReceipts: Array<{ path: string; authorized: boolean }> = []
test.beforeAll(async () => {
  linkServer = createServer((request, response) => { const authorized = request.method === 'GET' && request.url === '/docs' && linkBudget > 0; if (authorized) linkBudget--; linkReceipts.push({ path: request.url ?? '', authorized }); response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' }); response.end('Explicit N5 loopback link') })
  await new Promise<void>(resolve => linkServer.listen(0, '127.0.0.1', resolve)); linkURL = `http://127.0.0.1:${(linkServer.address() as AddressInfo).port}/docs`
})
test.afterAll(async () => { await new Promise<void>((resolve, reject) => linkServer.close(error => error ? reject(error) : resolve())) })
test.beforeEach(async ({ page, context, baseURL }) => {
  linkBudget = 0; linkReceipts.length = 0; traffic.set(context, []); modelAttempts.set(context, 0); const origin = new URL(baseURL!).origin
  await context.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', '051-N5-isolated'); (window as unknown as { executed051: number; copied051: string[] }).executed051 = 0; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (raw: string) => { const state = window as unknown as { copied051: string[] }; (state.copied051 ??= []).push(raw) } } }) })
  context.on('request', request => {
    const url = new URL(request.url()); const model = /\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)
    if (model) modelAttempts.set(context, modelAttempts.get(context)! + 1)
    const local = url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.includes('__051_unauthorized')
    const explicit = request.url() === linkURL && request.isNavigationRequest() && linkBudget > 0
    traffic.get(context)!.push({ url: request.url(), authorized: !model && (local || explicit) })
  })
  await context.route('**/*', route => { const request = route.request(), url = new URL(request.url()); return (url.origin === origin && ['GET', 'HEAD'].includes(request.method()) && !url.pathname.includes('__051_unauthorized')) || (request.url() === linkURL && request.isNavigationRequest()) ? route.continue() : route.abort('blockedbyclient') })
  await page.goto('./')
})
test.afterEach(async ({ context }, info) => {
  expect(modelAttempts.get(context)).toBe(0); expect(traffic.get(context)!.filter(item => !item.authorized)).toEqual([]); expect(linkReceipts.filter(item => !item.authorized)).toEqual([])
  const execution = await Promise.all(context.pages().map(page => page.evaluate(() => (window as unknown as { executed051?: number }).executed051 ?? 0)))
  expect(execution.every(count => count === 0)).toBe(true)
  await mkdir(info.outputDir, { recursive: true }); await writeFile(info.outputPath('native-N5-safety.json'), JSON.stringify({ modelAttempts: modelAttempts.get(context), execution, contextObserved: traffic.get(context), explicitLoopbackReceipts: linkReceipts }, null, 2) + '\n')
})
async function seed(page: Page, value = '', multi = false) {
  return page.evaluate(async ({ value, multi }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { useWorldviewStore: store } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const { scope } = await seedCurrentWorkspace('051 N5 隔离验收', { enableMultiWorld: multi })
    let group: number | null = null, second: number | null = null
    if (multi) {
      const { useWorldGroupStore: groups } = await load<typeof import('../../src/stores/world-group')>('/storyforge/src/stores/world-group.ts')
      await groups.getState().loadAll(scope); group = await groups.getState().ensurePrimaryGroup(scope)
      second = await groups.getState().createGroup({ projectId: scope.projectId, name: '副世界', description: '', type: 'custom', order: 1 }, scope)
      groups.getState().setActiveGroup(group)
      await store.getState().loadAll(scope, second); await store.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: second, worldStructure: '# 副世界原稿' }, scope, { kind: 'natural-field-local-save-v1', expected: store.getState().localSaveWitnesses.worldStructure!, session: 'second-seed', generation: 1 })
    }
    await store.getState().loadAll(scope, group)
    if (value) await store.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: group, worldStructure: value }, scope, { kind: 'natural-field-local-save-v1', expected: store.getState().localSaveWitnesses.worldStructure!, session: 'seed', generation: 1 })
    return { scope, group, second }
  }, { value, multi })
}
const pane = (page: Page) => page.locator('.lf-world-field:visible').first()
const reader = (page: Page) => pane(page).locator('[data-markdown-read-view]')
async function enter(page: Page) { const field = pane(page); const action = field.getByRole('button', { name: '编辑源码', exact: true }).or(field.locator('.cursor-text').first()).first(); await expect(action).toBeVisible(); await action.click(); return field.locator('[data-input-area-layout] textarea').first() }
async function select(page: Page, i: number) { await page.locator('nav button').filter({ hasText: labels[i] }).first().click() }
async function flush(page: Page) { await page.evaluate(async () => { const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>; await (await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')).flushPendingEditsV1() }) }
async function rows(page: Page) { return page.evaluate(async () => { const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>; return (await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')).db.worldviews.toArray() }) }
const base = '# 世界结构🌊\r\n\r\n正文 **重点** 与 *选择*\r\n\r\n| 港 | 山 |\r\n| :-- | --: |\r\n| A | B |\r\n\r\n```text\r\n+---+   +---+\r\n| A |---| B |  \r\n+---+   +---+\r\n```\r\n  '
test('actual N5 source input saves through F, returns to Markdown only after ack, and reload/closed-tab reopen retain actual submitted source', async ({ page, context }) => {
  const { scope } = await seed(page); const url = `./workspace/${scope.projectId}?module=worldview-natural`; await page.goto(url)
  const submitted: string[] = []
  for (let i = 0; i < fields.length; i++) {
    await select(page, i); const area = await enter(page); await area.fill(base.replace('世界结构', labels[i])); submitted.push(await area.inputValue())
    await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'dirty'); await flush(page)
    await expect(reader(page)).toBeVisible(); await expect(reader(page).getByRole('heading', { name: labels[i] + '🌊', exact: true })).toBeVisible()
    await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved'); expect((await rows(page))[0][fields[i]]).toBe(submitted[i])
  }
  await page.reload(); await expect(reader(page)).toBeVisible(); const actualURL = page.url(); await page.close(); const reopened = await context.newPage(); await reopened.goto(actualURL)
  for (let i = 0; i < fields.length; i++) { await select(reopened, i); await expect(reader(reopened)).toBeVisible(); expect((await rows(reopened))[0][fields[i]]).toBe(submitted[i]) }
})
for (const theme of ['storyforge', 'starlight-dark']) for (const width of [1366, 390]) test(`actual parent geometry ${theme} ${width}: inline/block ASCII/table overflow stays contained without writes`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); await page.evaluate(theme => localStorage.setItem('storyforge-theme', theme), theme)
  const large = base + '\r\n长行 `' + 'A--'.repeat(350) + '`\r\n\r\n```text\r\n' + '|--'.repeat(350) + '\r\n```\r\n\r\n| ' + '宽'.repeat(180) + ' | 右 |\r\n| -- | -- |\r\n| 内容 | 内容 |'
  const { scope } = await seed(page, large); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await expect(reader(page)).toBeVisible(); const before = JSON.stringify(await rows(page))
  for (const selector of ['[data-markdown-inline-code]', 'pre', '[data-markdown-table-scroll]']) {
    const target = reader(page).locator(selector).last(); await expect(target).toBeVisible()
    expect(await target.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await target.evaluate(el => el.getBoundingClientRect().right <= el.closest('[data-markdown-read-view]')!.getBoundingClientRect().right + 1)).toBe(true)
    await target.hover(); await page.mouse.wheel(250, 0); await expect.poll(() => target.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  }
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth + 1)).toBe(true)
  await expect(pane(page).locator('[data-input-area-layout] textarea')).toHaveCount(0); expect(JSON.stringify(await rows(page))).toBe(before)
  await page.screenshot({ path: info.outputPath(`N5-${theme}-${width}.png`), fullPage: true })
})
test('actual parent source/copy/selection/double-click/ctrl/middle/link stay separate, HTML/images stay inert, and CRLF no-input leaves the whole row unchanged', async ({ page, context }) => {
  const attack = '\r\n\r\n<script>window.executed051++</script>\r\n<img src="https://evil.invalid/__051_unauthorized_html" onerror="window.executed051++">\r\n<svg onload="window.executed051++"></svg>\r\n<iframe srcdoc="<script>parent.executed051++</script>"></iframe>\r\n\r\n![外图](https://evil.invalid/__051_unauthorized_md)\r\n\r\n| x |\r\n| -- |\r\n| <img src="/__051_unauthorized_cell" onerror="window.executed051++"> |\r\n\r\n[危险](javascript:alert%281%29) [混淆](https://evil.invalid/%250a)'
  const value = '  ' + base + `\r\n\r\n[明确外链](${linkURL}) [页内](#inside)\r\n` + attack
  const { scope } = await seed(page, value); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`); await expect(reader(page)).toBeVisible(); const before = JSON.stringify(await rows(page))
  await expect(reader(page).locator('script,img,svg,iframe,style,object,[src],[srcset]')).toHaveCount(0)
  const paragraph = reader(page).locator('p').first(); await paragraph.dblclick(); await page.waitForTimeout(300); await expect(reader(page)).toBeVisible()
  await paragraph.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) }); await page.waitForTimeout(300); await expect(reader(page)).toBeVisible()
  await page.evaluate(() => window.getSelection()!.removeAllRanges()); await paragraph.click({ modifiers: ['Control'] }); await page.keyboard.press('Escape'); await paragraph.click({ modifiers: ['Meta'] }); await page.waitForTimeout(300); await expect(reader(page)).toBeVisible()
  await reader(page).getByRole('button', { name: '复制源码', exact: true }).click(); expect(await page.evaluate(() => (window as unknown as { copied051: string[] }).copied051)).toEqual([value])
  await reader(page).getByRole('button', { name: '查看源码', exact: true }).click(); expect(await reader(page).locator('[data-markdown-source]').textContent()).toBe(value)
  await reader(page).getByRole('button', { name: '返回阅读', exact: true }).click(); const link = reader(page).getByRole('link', { name: '明确外链', exact: true }); await link.hover()
  expect(linkReceipts).toHaveLength(0)
  for (const action of ['left', 'middle', 'control', 'keyboard'] as const) { linkBudget++; const next = context.waitForEvent('page'); if (action === 'keyboard') { await link.focus(); await link.press('Enter') } else await link.click({ button: action === 'middle' ? 'middle' : 'left', modifiers: action === 'control' ? ['ControlOrMeta'] : [] }); const popup = await next; await expect(popup).toHaveURL(linkURL); await popup.close(); await expect(reader(page)).toBeVisible() }
  if (process.platform === 'darwin') { await link.click({ modifiers: ['Control'] }); await page.keyboard.press('Escape'); await expect(reader(page)).toBeVisible() }
  expect(linkReceipts).toHaveLength(4); await reader(page).getByRole('link', { name: '页内', exact: true }).click(); await expect(reader(page)).toBeVisible()
  expect(JSON.stringify(await rows(page))).toBe(before)
  await reader(page).locator('p').first().click()
  const area = pane(page).locator('[data-input-area-layout] textarea').first(); await expect(area).toBeVisible(); await area.evaluate(el => (el as HTMLTextAreaElement).setSelectionRange(2, 9)); await flush(page)
  await expect(reader(page)).toBeVisible(); expect(JSON.stringify(await rows(page))).toBe(before)
})
test('actual original textarea survives held old ack/new dirty/IME, resize/reset/window return and storage failure until latest real confirmation', async ({ page }) => {
  const { scope } = await seed(page, '# 原稿'); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`); await expect(reader(page)).toBeVisible()
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>; const { useWorldviewStore: store } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts'); const original = store.getState().saveWorldview
    const state = window as unknown as { release051?: () => void; calls051: number; flush051: string }; state.calls051 = 0
    store.setState({ saveWorldview: ((...args: Parameters<typeof original>) => { state.calls051++; const result = original(...args); return state.calls051 === 1 ? result.then(ack => new Promise<typeof ack>(resolve => { state.release051 = () => resolve(ack) })) : result }) as typeof original })
  })
  const area = await enter(page); await area.evaluate(el => { el.dataset.original051 = 'same' }); await area.fill('# first')
  await page.evaluate(async () => { const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>; const state = window as unknown as { flush051: string }; state.flush051 = 'pending'; void (await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')).flushPendingEditsV1().then(() => { state.flush051 = 'done' }, error => { state.flush051 = String(error) }) })
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { release051?: () => void }).release051)).toBe('function')
  await area.dispatchEvent('compositionstart'); await area.fill('# 中文尾字🌊'); await page.evaluate(() => (window as unknown as { release051: () => void }).release051())
  await expect.poll(() => page.evaluate(() => (window as unknown as { flush051: string }).flush051)).toContain('输入法')
  await expect(reader(page)).toHaveCount(0); await expect(area).toHaveAttribute('data-original051', 'same'); await expect(area).toHaveValue('# 中文尾字🌊')
  await area.dispatchEvent('compositionend'); const handle = pane(page).getByRole('button', { name: '调整输入区大小', exact: true }); await handle.press('ArrowDown'); await pane(page).getByRole('button', { name: '恢复自适应', exact: true }).click()
  await expect(area).toHaveAttribute('data-original051', 'same'); await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) }); await flush(page)
  await expect(reader(page)).toBeVisible(); expect((await rows(page))[0].worldStructure).toBe('# 中文尾字🌊')
  await page.evaluate(async () => { const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>; const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'); const fault = () => { throw new DOMException('051 simulated quota', 'QuotaExceededError') }; db.worldviews.hook('updating', fault); (window as unknown as { cleanup051: () => void }).cleanup051 = () => db.worldviews.hook('updating').unsubscribe(fault) })
  const retry = await enter(page); await retry.fill('# failure retained'); await expect(flush(page)).rejects.toThrow('051 simulated quota'); await expect(reader(page)).toHaveCount(0); await expect(retry).toHaveValue('# failure retained')
  await page.evaluate(() => (window as unknown as { cleanup051: () => void }).cleanup051()); await pane(page).getByRole('button', { name: '重试', exact: true }).click(); await expect(reader(page)).toBeVisible(); expect((await rows(page))[0].worldStructure).toBe('# failure retained')
})
test('actual same-field stale stays editable; scope switch drains the original group and read-error boundary remains inert', async ({ page }) => {
  const { scope, group, second } = await seed(page, '# 主世界原稿', true); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`); await expect(reader(page)).toBeVisible()
  const area = await enter(page); await area.fill('# stale draft')
  await page.evaluate(async ({ scope, group }) => { const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>; const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'); const { adopt } = await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts'); const row = (await db.worldviews.toArray()).find(row => row.worldGroupId === group)!; await adopt({ projectId: scope.projectId, scope, target: 'worldviews', mode: 'replace', recordId: row.id!, preserveAuthorText: true, data: { worldStructure: '# 外页更新' } }) }, { scope, group })
  await expect(flush(page)).rejects.toThrow('已被修改'); await expect(reader(page)).toHaveCount(0); await expect(area).toHaveValue('# stale draft')
  await page.reload(); await expect(reader(page)).toBeVisible(); const original = await enter(page); await original.dispatchEvent('compositionstart'); await original.fill('# 原世界组合尾字')
  await page.getByRole('button', { name: /主世界/, exact: false }).first().click(); await page.getByRole('button', { name: /副世界/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: '输入法' })).toBeVisible(); await expect(original).toHaveValue('# 原世界组合尾字')
  await original.dispatchEvent('compositionend'); await page.getByRole('button', { name: /副世界/ }).click(); await expect(reader(page).getByRole('heading', { name: '副世界原稿', exact: true })).toBeVisible()
  const all = await rows(page); expect(all.find(row => row.worldGroupId === group)?.worldStructure).toBe('# 原世界组合尾字'); expect(all.find(row => row.worldGroupId === second)?.worldStructure).toBe('# 副世界原稿')
  const before = JSON.stringify(all)
  await page.evaluate(async () => { const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>; (await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')).useWorldviewStore.setState({ loadError: 'isolated readonly boundary' }) })
  await expect(page.getByRole('group', { name: '设定读取保护' })).toHaveAttribute('inert', ''); await expect(reader(page).getByRole('button', { name: '编辑源码', exact: true })).toBeDisabled(); expect(JSON.stringify(await rows(page))).toBe(before)
})
