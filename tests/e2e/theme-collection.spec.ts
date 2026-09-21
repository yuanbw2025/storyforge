import { expect, test } from '@playwright/test'
import { THEME_OPTIONS } from '../../src/lib/theme'
import { createLongform } from './helpers/product-entry'

function contrast(foreground: string, background: string, backdrop?: string) {
  const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number)
  const fg = rgb(foreground), bg = rgb(background)
  // Use the worst backdrop for translucent paper: white under dark, black under light.
  const under = backdrop ? rgb(backdrop) : Array(3).fill(bg.slice(0, 3).reduce((a, b) => a + b, 0) < 384 ? 255 : 0)
  const alpha = bg[3] ?? 1
  const luminance = (values: number[]) => values.slice(0, 3).map(value => {
    const v = value / 255
    return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  const a = luminance(fg), b = luminance(bg.slice(0, 3).map((value, index) => value * alpha + under[index] * (1 - alpha)))
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

test('all fourteen themes persist, preserve prose and keep editor and dialog actions readable', async ({ page }) => {
  test.setTimeout(180_000)
  await createLongform(page, '全部主题验收')
  await page.getByRole('navigation', { name: '长篇工作台二级导航' }).getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByTitle('编辑章节', { exact: true }).click()
  const editor = page.locator('.tiptap-editor')
  await editor.fill('山水与星光轮转，作者的文字始终留在原处。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
  const chapterUrl = page.url(), original = await editor.innerHTML()
  for (const theme of THEME_OPTIONS) {
    await page.goto('./home/settings')
    await page.getByRole('button', { name: theme.name, exact: true }).click()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id)
    await expect(page.getByRole('button', { name: theme.name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.goto(chapterUrl)
    await expect(editor).toContainText('山水与星光轮转')
    expect(await editor.innerHTML(), theme.name).toBe(original)
    const colors = await editor.evaluate(el => ({
      ink: getComputedStyle(el).color,
      paper: getComputedStyle(document.querySelector('.sf-manuscript-editor > div:last-child')!).backgroundColor,
    }))
    expect(contrast(colors.ink, colors.paper), `${theme.name} 正文`).toBeGreaterThanOrEqual(4.5)
    for (const name of ['整理本章', '影响分析', '生成情感节拍']) {
      const badge = await page.getByRole('button', { name, exact: true }).evaluate(el => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--bg-surface)'
        el.append(probe)
        const surface = getComputedStyle(probe).color
        probe.remove()
        return { ink: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, surface }
      })
      expect(contrast(badge.ink, badge.background, badge.surface), `${theme.name} ${name}`).toBeGreaterThanOrEqual(4.5)
    }
    await page.goto('./long')
    await page.getByRole('button', { name: '重命名', exact: true }).click()
    const button = page.getByRole('dialog').getByRole('button', { name: '保存名称', exact: true })
    const action = await button.evaluate(el => ({ ink: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))
    expect(contrast(action.ink, action.background), `${theme.name} 主按钮`).toBeGreaterThanOrEqual(4.5)
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  }
})

test('theme categories and dark mobile navigation stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./home/settings')
  for (const group of ['浅色', '深色', '混合'] as const) {
    await page.getByLabel('主题分类', { exact: true }).selectOption(group)
    await expect(page.locator('.theme-option')).toHaveCount(THEME_OPTIONS.filter(theme => theme.group === group).length)
  }
  await page.getByLabel('主题分类', { exact: true }).selectOption('深色')
  await page.getByRole('button', { name: '星穹 · 透光版', exact: true }).click()
  await page.getByRole('button', { name: '页面目录', exact: true }).click()
  const nav = await page.locator('.lf-sidebar').evaluate(el => ({ ink: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))
  expect(contrast(nav.ink, nav.background)).toBeGreaterThanOrEqual(4.5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})


test('shared text-adventure surfaces inherit the dark palette and standalone preview stays read only', async ({ page }) => {
  await page.goto('./home/settings')
  await page.getByRole('button', { name: '星穹 · 透光版', exact: true }).click()
  await page.goto('./adventure/play')
  const colors = await page.locator('.lf-paper').first().evaluate(el => ({
    paper: getComputedStyle(el).backgroundColor,
    ink: getComputedStyle(el.querySelector('h3')!).color,
  }))
  expect(contrast(colors.ink, colors.paper)).toBeGreaterThanOrEqual(4.5)
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new Error('Preview must not open IndexedDB') }
    Storage.prototype.setItem = () => { throw new Error('Preview must not persist data') }
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./ui-preview/index.html#adventure/play')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'cosmic-glass')
  await expect(page.locator('.adventure-prose')).toBeVisible()
  expect(errors).toEqual([])
})
