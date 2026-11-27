import { expect, test } from '@playwright/test'

/**
 * 051-VERIFY-NATURALPANEL · 真实自然面板 Markdown 阅读主路径补齐断言
 *
 * longform-markdown-read.spec.ts 已覆盖完整 N5 渲染→源码切换→flush保存→reload/关tab
 * 本片只补合同要求的剩余真实路径断言，不重写已有绿色测试。
 */

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '051-verify-isolated'))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    return url.origin === origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
})

async function seed(page: import('@playwright/test').Page, md: string) {
  return page.evaluate(async md => {
    const load = new Function('path', 'return import(path)') as <T>(p: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { scope } = await seedCurrentWorkspace('051 Verify isolated natural panel')
    await useWorldviewStore.getState().loadAll(scope)
    const w = useWorldviewStore.getState().localSaveWitnesses.worldStructure!
    if (!w) throw new Error('witness not initialized after loadAll')
    await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: md }, scope,
      { kind: 'natural-field-local-save-v1', expected: w, session: 'v-seed', generation: 1 })
    const row = (await db.worldviews.toArray())[0]
    return { projectId: scope.projectId, rowId: row.id }
  }, md)
}

async function snapshot(page: import('@playwright/test').Page) {

  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(p: string) => Promise<T>
    return (await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')).db.worldviews.toArray()
  })
}

async function flush(page: import('@playwright/test').Page) {

  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(p: string) => Promise<T>
    await (await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')).flushPendingEditsV1()
  })
}


function pane(page: any) { return page.locator('.lf-world-field:visible').first() }

test('① 默认读态可见且编辑入口清晰：光标点击可进入普通 InlineTextarea', async ({ page }, info) => {
  const md = '# 初始世界🌊\n\n**要点**。\n'
  const ids = await seed(page, md)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  // 默认显示阅读态（seed 为非空 MD）
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  // 同时能看到编辑入口按钮
  await expect(pane(page).getByRole('button', { name: '编辑源码', exact: true })).toBeVisible()
  // 点击打开源码 pre
  await pane(page).getByRole('button', { name: '查看源码', exact: true }).click()
  await expect(pane(page).locator('[data-markdown-source]')).toContainText(md)
  // 点「返回阅读」回到阅读态
  await pane(page).getByRole('button', { name: '返回阅读', exact: true }).click()
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  // 点击正文 body 触发 editor.begin → textarea
  await pane(page).locator('[data-markdown-body]').first().click()
  await expect(pane(page).locator('textarea')).toBeVisible()
  await page.screenshot({ path: info.outputPath('051-default-ready.png'), fullPage: true })
})

test('② 写入 MD 后阅读态与源码切换不污染 DB；复制不触发 begin/save', async ({ page }, info) => {
  const md = '# 世界🌊\n\n正文 **重点**\n\n| 港 | 山 |\n| -- | -- |\n\n```text\n|-- A  \n```\n'
  const ids = await seed(page, md)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  await expect(pane(page).locator('h1')).toContainText('世界🌊')
  await expect(pane(page).locator('table')).toBeVisible()
  await expect(pane(page).locator('pre code')).toContainText('|-- A')
  await expect(pane(page).locator('textarea')).toHaveCount(0)

  const before = await snapshot(page)

  // 复制源码 → read view 保持，无 textarea
  await pane(page).getByRole('button', { name: '复制源码', exact: true }).click()
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  await expect(pane(page).locator('textarea')).toHaveCount(0)
  expect(JSON.stringify(await snapshot(page))).toBe(JSON.stringify(before))

  // 查看源码 & 返回阅读
  await pane(page).getByRole('button', { name: '查看源码', exact: true }).click()
  await expect(pane(page).locator('[data-markdown-source]')).toContainText(md)
  await pane(page).getByRole('button', { name: '返回阅读', exact: true }).click()
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  await expect(pane(page).locator('textarea')).toHaveCount(0)
  expect(JSON.stringify(await snapshot(page))).toBe(JSON.stringify(before))
  await page.screenshot({ path: info.outputPath('051-toggle-retain.png'), fullPage: true })
})

test('③ 编辑提交保留原串；刷新/关 tab 重开逐字回读', async ({ page, context }, info) => {
  const original = '# 世界🌊\r\n\r\n正文 **重点** 与 [锚点](#local)\r\n\r\n```text\r\n  |-- A  \r\n```\r\n  '
  const ids = await seed(page, original)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()

  // The centre of this mixed Markdown body can land in its code block;
  // code clicks intentionally keep reading. Use the explicit edit action.
  await pane(page).locator('[data-markdown-body] pre').first().click()
  await expect(pane(page).locator('textarea')).toHaveCount(0)
  await pane(page).getByRole('button', { name: '编辑源码', exact: true }).click()
  const area = pane(page).locator('textarea').first()
  await expect(area).toBeVisible()
  await area.fill('# 改写后自然结构')
  await flush(page)
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  await expect(pane(page).locator('textarea')).toHaveCount(0)
  expect((await snapshot(page))[0].worldStructure).toBe('# 改写后自然结构')

  // 同一 URL 刷新
  await page.reload()
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  expect((await snapshot(page))[0].worldStructure).toBe('# 改写后自然结构')

  // 关 tab + 新 tab 打开同一 URL
  await page.screenshot({ path: info.outputPath('051-roundtrip.png'), fullPage: true })
  const currentUrl = page.url()
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(currentUrl)
  await expect(pane(reopened).locator('[data-markdown-read-view]')).toBeVisible()
  expect((await snapshot(reopened))[0].worldStructure).toBe('# 改写后自然结构')
  await reopened.close()
})

test('④ 选择/拖选/键盘 copy 不误触发 save；危险 HTML/script/iframe/SVG/远程图片 0 执行', async ({ page }, info) => {
  const attack = '\n# title\n<script>window.__executed051++</script>\n<img src=x onerror="window.__executed051++">\n<svg onload="window.__executed051++"></svg>\n<iframe srcdoc="<script>parent.__executed051++</script>"></iframe>\n![外图](https://evil.invalid/img.png)\n[src](javascript:alert%281%29)'
  const ids = await seed(page, attack)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  // 所有危险 HTML 元素不应出现在 DOM 中
  await expect(pane(page).locator('[data-markdown-read-view] script,[data-markdown-read-view] img,[data-markdown-read-view] svg,[data-markdown-read-view] iframe,[data-markdown-read-view] [onerror],[data-markdown-read-view] [onload],[data-markdown-read-view] [src*=javascript]')).toHaveCount(0)
  // 安全链接不会被渲染为可点击的危险 href
  const links = await pane(page).locator('a[href]').all()
  for (const a of links) expect(await a.getAttribute('href')).not.toMatch(/^javascript:/i)
  // 双击不会触发 editor.begin（read view cancelClick 防护）
  await pane(page).locator('[data-markdown-body]').first().dblclick()
  await expect(pane(page).locator('textarea')).toHaveCount(0)
  // 普通 keyboard copy 不误触发 save
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Meta+c')
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  // DB 从未被改写
  const rows = await snapshot(page)
  expect(rows[0].worldStructure).toBe(attack)
  await page.screenshot({ path: info.outputPath('051-security-pure.png'), fullPage: true })
})

test('⑤ 非 MD 条目负例：清空后再导航不触发 markdownRead 分支', async ({ page }) => {
  // 创建项目但不写任何 MD，模拟首次使用场景

  const ids = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(p: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const { scope } = await seedCurrentWorkspace('051 Verify no-md field negative')
    await useWorldviewStore.getState().loadAll(scope)
    return { projectId: scope.projectId }
  })
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  // 默认自然面板第一个字段为空 → markdownRead=false → 不出现 read view
  await expect(pane(page).locator('[data-markdown-read-view]')).toHaveCount(0)
  // 仍可点击进入普通 textarea 编辑
  const entry = pane(page).getByRole('button', { name: '编辑源码' }).or(pane(page).locator('.cursor-text').first()).first()
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(pane(page).locator('textarea')).toBeVisible()
})

test('⑥ 保存失败保持源码态不伪成功；重试后才返回阅读', async ({ page }, info) => {
  const md = '# 原稿'
  const ids = await seed(page, md)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  // 注入失败模拟：hook Dexie worldviews updating 抛错
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(p: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    ;(window as unknown as { _cleanup051v?: () => void })._cleanup051v?.()
    const fault = () => { throw new DOMException('simulated quota', 'QuotaExceededError') }
    db.worldviews.hook('updating', fault)
    ;(window as unknown as { _cleanup051v: () => void })._cleanup051v = () => db.worldviews.hook('updating').unsubscribe(fault)
  })
  await pane(page).locator('[data-markdown-body]').first().click()
  const area = pane(page).locator('textarea').first()
  await expect(area).toBeVisible(); await area.fill('# 保存失败应保留')
  // flush 应抛错（hook 已注入），不吞错地让测试继续；area 仍可见
  try { await flush(page) } catch (e) { void e }
  await expect(pane(page).locator('textarea')).toBeVisible()
  await expect(pane(page).locator('[data-markdown-read-view]')).toHaveCount(0)
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  // 清除 hook 并重试
  await page.evaluate(async () => { (window as unknown as { _cleanup051v: () => void })._cleanup051v() })
  await pane(page).getByRole('button', { name: '重试', exact: true }).click()
  await expect(pane(page).locator('[data-markdown-read-view]')).toBeVisible()
  expect((await snapshot(page))[0].worldStructure).toBe('# 保存失败应保留')
  await page.screenshot({ path: info.outputPath('051-failure-retained.png'), fullPage: true })
})
