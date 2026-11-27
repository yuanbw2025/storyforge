import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })
test.setTimeout(180_000)

const MODE_GROUP = '[aria-label="编辑模式"]'
const PASTE_STRIP = '[aria-label="大段粘贴确认"]'

/** 生产路径的模型请求与外部资源请求计数器：0 次才算通过。 */
function watchNetwork(page: Page) {
  const counters = { model: 0, external: 0 }
  const external: string[] = []
  page.on('request', request => {
    const url = request.url()
    if (/\/chat\/completions|\/models\/|\/responses$/.test(url)) counters.model += 1
    if (/^https?:/i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url)) {
      counters.external += 1
      external.push(url)
    }
  })
  return { counters, external }
}

async function bootEditor(page: Page, title: string) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await createLongform(page, title)
  await openLongformLeaf(page, '大纲')
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByTitle('编辑章节').click()
  await expect(page.locator(MODE_GROUP)).toBeVisible({ timeout: 20_000 })
  return page.url()
}

async function switchMode(page: Page, label: '富文本' | '实时预览' | 'Markdown 源码') {
  await page.locator(MODE_GROUP).getByRole('button', { name: label, exact: true }).click()
}

async function focusCm(page: Page) {
  await page.locator('.cm-content').click()
}

async function saveChapter(page: Page) {
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible({ timeout: 20_000 })
}

async function chapterRow(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const params = new URLSearchParams(location.search)
    const outlineNodeId = Number(params.get('chapter'))
    const projectId = Number(location.pathname.split('/').filter(Boolean).pop())
    const row = await db.chapters.where('outlineNodeId').equals(outlineNodeId).first()
    if (!row || row.projectId !== projectId) return null
    return { content: row.content as string, wordCount: row.wordCount as number }
  })
}

test('生产路径：空章默认实时预览，键盘输入/撤销/源码切换与切换后撤销', async ({ page }) => {
  const net = watchNetwork(page)
  await bootEditor(page, 'PRODE2E 编辑与撤销')
  // 新空章默认实时预览：CM 真实挂载，三种模式可见
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(MODE_GROUP).getByRole('button', { name: '实时预览', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await focusCm(page)
  await page.keyboard.type('第一章正文')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 小标题')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- 列表一')
  await page.keyboard.press('Enter')
  await page.keyboard.type('列表二')
  // Backspace 删掉一个字符再补回：验证真实键盘删除不影响后续输入
  await page.keyboard.press('Backspace')
  await expect(page.locator('.cm-content')).toContainText('列表')
  await page.keyboard.type('二')
  // Tab 在 CM 里可能把焦点移出编辑区（未绑定缩进命令），正文不得被破坏
  await page.keyboard.press('Tab')
  await expect(page.locator('.cm-content')).toContainText('列表二')
  await focusCm(page)
  await page.keyboard.press('Enter')
  await page.keyboard.type('> 引用')
  await page.keyboard.press('Enter')
  await page.keyboard.type('正文段落')
  await expect(page.locator('.cm-content')).toContainText('第一章正文')
  await expect(page.locator('.cm-content')).toContainText('列表二')

  // 多次 undo / redo：以文本是否回到同值判定，不假设按键与事务一一对应
  await focusCm(page)
  const typedText = await page.locator('.cm-content').innerText()
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  const undoneText = await page.locator('.cm-content').innerText()
  expect(undoneText).not.toBe(typedText)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => page.locator('.cm-content').innerText()).toBe(typedText)

  // 源码 ↔ 实时预览切换：0 章节写入（先等既有自动保存落定，排除 autosave 干扰）
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible({ timeout: 30_000 })
  const beforeSwitch = await chapterRow(page)
  // 用标记属性证明切换复用同一个 CM 视图实例（不是重建）
  await page.locator('.cm-editor').evaluate(element => element.setAttribute('data-prode2e-same-view', '1'))
  await switchMode(page, 'Markdown 源码')
  await expect(page.locator('.cm-editor')).toHaveAttribute('data-prode2e-same-view', '1')
  await switchMode(page, '实时预览')
  await expect(page.locator('.cm-editor')).toHaveAttribute('data-prode2e-same-view', '1')
  const textAfterSwitch = await page.locator('.cm-content').innerText()
  expect(textAfterSwitch).toContain('第一章正文')
  expect(textAfterSwitch).toContain('正文段落')
  expect(await chapterRow(page)).toEqual(beforeSwitch)

  // 切换后仍可 undo 到切换前的编辑（同一份历史），redo 回到切换时的文本
  await focusCm(page)
  const textAtSwitch = await page.locator('.cm-content').innerText()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => page.locator('.cm-content').innerText()).not.toBe(textAtSwitch)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => page.locator('.cm-content').innerText()).toBe(textAtSwitch)

  expect(net.counters.model).toBe(0)
})

test('生产路径：大段粘贴确认/取消、剪贴板保留与小段粘贴不拦截', async ({ page }) => {
  const net = watchNetwork(page)
  await bootEditor(page, 'PRODE2E 粘贴确认')
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 20_000 })
  const large = '大段粘贴内容'.repeat(2000)
  const originalRow = await chapterRow(page)
  const originalText = await page.locator('.cm-content').innerText()

  // 取消：正文/字数不变，内容仍在剪贴板
  await page.evaluate(text => navigator.clipboard.writeText(text), large)
  await focusCm(page)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator(PASTE_STRIP)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(PASTE_STRIP)).toContainText(large.length.toLocaleString())
  await page.locator(PASTE_STRIP).getByRole('button', { name: '取消粘贴', exact: true }).click()
  await expect(page.locator(PASTE_STRIP)).toHaveCount(0)
  expect(await page.locator('.cm-content').innerText()).toBe(originalText)
  expect(await chapterRow(page)).toEqual(originalRow)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(large)

  // 小段粘贴：不进入确认通道，直接进入正文
  await page.evaluate(() => navigator.clipboard.writeText('小段粘贴'))
  await focusCm(page)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator(PASTE_STRIP)).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('小段粘贴')

  // 确认：正文更新，草稿进入待保存（DB 仍未写）
  await page.evaluate(text => navigator.clipboard.writeText(text), large)
  await focusCm(page)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator(PASTE_STRIP)).toBeVisible({ timeout: 20_000 })
  await page.locator(PASTE_STRIP).getByRole('button', { name: '确认粘贴', exact: true }).click()
  await expect(page.locator(PASTE_STRIP)).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('大段粘贴内容')
  expect(await chapterRow(page)).toEqual(originalRow)

  expect(net.counters.model).toBe(0)
  expect(net.counters.external).toBe(0)
})

test('生产路径：保存生命周期、刷新重开一致与 0 模型请求', async ({ page }) => {
  const net = watchNetwork(page)
  const url = await bootEditor(page, 'PRODE2E 保存往返')
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 20_000 })
  await focusCm(page)
  await page.keyboard.type('## 列表与代码')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- 甲')
  await page.keyboard.press('Enter')
  await page.keyboard.type('乙')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const a = 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')

  await saveChapter(page)
  const saved = await chapterRow(page)
  expect(saved?.content ?? '').toContain('<ul>')
  expect(saved?.content ?? '').toContain('<h2>')
  expect(saved?.content ?? '').toContain('<pre>')
  const savedWordCount = saved!.wordCount
  expect(savedWordCount).toBeGreaterThan(0)

  // 刷新后重新打开同一章：HTML 与可见文字一致、字数一致
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 25_000 })
  await page.goto(url)
  await expect(page.locator(MODE_GROUP)).toBeVisible({ timeout: 25_000 })
  // 已有正文：默认回到富文本，可见文字与保存前一致
  await expect(page.locator('.tiptap-editor')).toBeVisible({ timeout: 20_000 })
  const reopenedRichText = await page.locator('.tiptap-editor').innerText()
  expect(reopenedRichText.replace(/\s+/g, '')).toContain('列表与代码')
  // 重开后的已提交行与保存时逐字一致（保存不产生漂移）
  expect(await chapterRow(page)).toEqual(saved)
  await switchMode(page, '实时预览')
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 20_000 })
  const previewText = await page.locator('.cm-content').innerText()
  expect(previewText).toContain('列表与代码')
  expect(previewText).toContain('甲')
  expect(previewText).toContain('const a = 1')
  expect((await chapterRow(page))?.wordCount).toBe(savedWordCount)
  expect(net.counters.model).toBe(0)
})

test('生产路径：危险链接与事件属性不执行、不加载远程资源', async ({ page }) => {
  const net = watchNetwork(page)
  const dialogs: string[] = []
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
  const url = await bootEditor(page, 'PRODE2E 安全')
  await focusCm(page)
  await page.keyboard.type('[危险](javascript:alert(1))')
  await page.keyboard.press('Enter')
  await page.keyboard.type('[数据](data:text/html;base64,PHNjcmlwdD5hbGVydCgyKTwvc2NyaXB0Pg==)')
  await page.keyboard.press('Enter')
  await page.keyboard.type('![远程](https://example.invalid/remote.png)')
  await page.keyboard.press('Enter')
  await page.keyboard.type('<img src=x onerror="alert(3)">')
  await saveChapter(page)
  await page.reload()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible({ timeout: 25_000 })
  await page.goto(url)
  await expect(page.locator(MODE_GROUP)).toBeVisible({ timeout: 25_000 })
  await switchMode(page, '实时预览')
  await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 20_000 })
  // 预览里点击危险链接不应导航或执行
  const link = page.locator('.cm-content').getByText('危险', { exact: true })
  if (await link.count()) {
    await link.click({ timeout: 5_000 }).catch(() => undefined)
  }
  await page.waitForTimeout(500)
  expect(dialogs).toEqual([])
  expect(net.counters.external).toBe(0)
  expect(net.counters.model).toBe(0)
})

for (const width of [1728, 1366, 390]) {
  test(`生产路径 ${width}px：正文编辑区不被工具栏或提示条遮挡`, async ({ page }) => {
    // 窄屏下左侧导航是抽屉，先在常规宽度完成建作品/建章/进正文，再切到目标宽度验布局
    await page.setViewportSize({ width: 1366, height: 900 })
    await bootEditor(page, `PRODE2E 布局 ${width}`)
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 20_000 })
    await focusCm(page)
    await page.keyboard.type('布局检查正文')
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.cm-editor')).toBeVisible()
    const geometry = await page.evaluate(() => {
      const editor = document.querySelector('.cm-editor') as HTMLElement | null
      const content = document.querySelector('.cm-content') as HTMLElement | null
      if (!editor || !content) return null
      const box = editor.getBoundingClientRect()
      const point = { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + Math.min(box.height / 2, 40)) }
      const hit = document.elementFromPoint(point.x, point.y)
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        viewportWidth: window.innerWidth,
        hitInsideEditor: Boolean(hit && editor.contains(hit)),
        contentVisible: content.getBoundingClientRect().height > 0,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
    expect(geometry).not.toBeNull()
    expect(geometry!.height).toBeGreaterThan(120)
    expect(geometry!.contentVisible).toBe(true)
    expect(geometry!.hitInsideEditor).toBe(true)
    expect(geometry!.scrollWidth).toBeLessThanOrEqual(width + 1)
    await page.screenshot({ path: test.info().outputPath(`production-mount-${width}.png`), fullPage: false })
  })
}
