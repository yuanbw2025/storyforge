import { expect, test } from '@playwright/test'
import { THEME_OPTIONS } from '../../src/lib/theme'
import { createLongform } from './helpers/product-entry'

test('正文提示与原自定义指令共用，切章和刷新不携带上一章临时要求', async ({ page }) => {
  await createLongform(page, '逐章提示验收')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByTitle('编辑章节', { exact: true }).first().click()
  const instruction = page.getByPlaceholder('自定义指令...', { exact: true })
  await instruction.fill('第一章只写抵达渡口。')
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '正文生成提示', exact: true })
  await expect(dialog.getByRole('textbox')).toHaveValue('第一章只写抵达渡口。')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '✨ 生成正文', exact: true })).toBeFocused()
  await page.getByRole('button', { name: /第2章/ }).click()
  await expect(instruction).toHaveValue('')
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await expect(dialog.getByRole('textbox')).toHaveValue('')
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await dialog.boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(390)
  await dialog.getByRole('textbox').fill('第二章先问同行者意愿。')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(instruction).toHaveValue('第二章先问同行者意愿。')
  await page.reload()
  await expect(instruction).toHaveValue('')
})

test('未来演化的小字在所有主题有清晰对比，主题切换不改正文', async ({ page }) => {
  await createLongform(page, '未来提示主题验收')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByTitle('编辑章节', { exact: true }).click()
  const editor = page.locator('.tiptap-editor')
  await editor.fill('山间雨停，两人来到渡口。')
  await page.getByRole('button', { name: '影响分析', exact: true }).click()
  const panel = page.getByLabel('FUTURE-1 未来演化边界', { exact: true })
  await expect(panel).toBeVisible()
  const original = await editor.innerHTML()
  for (const theme of THEME_OPTIONS) {
    await page.evaluate(id => { document.documentElement.dataset.theme = id }, theme.id)
    const samples = await panel.evaluate(el => {
      const rgb = (s: string) => s.match(/[\d.]+/g)!.map(Number)
      const luminance = (c: number[]) => c.slice(0, 3).map(v => {
        const x = v / 255
        return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4
      }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
      const background = rgb(getComputedStyle(el).backgroundColor)
      return [...el.querySelectorAll('span'), el.lastElementChild!].map(item => {
        const style = getComputedStyle(item), a = luminance(rgb(style.color)), b = luminance(background)
        return { text: item.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), size: parseFloat(style.fontSize) }
      })
    })
    for (const sample of samples) {
      expect(sample.ratio, `${theme.name}: ${sample.text}`).toBeGreaterThanOrEqual(4.5)
      expect(sample.size).toBeGreaterThanOrEqual(12)
    }
    expect(await editor.innerHTML()).toBe(original)
    if (theme.id === 'storyforge' || theme.id === 'ember') await panel.screenshot({ path: test.info().outputPath(`${theme.id}-future-panel.png`) })
  }
})
