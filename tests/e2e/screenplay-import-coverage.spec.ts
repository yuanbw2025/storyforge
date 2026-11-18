import { test, expect } from '@playwright/test'

test('上传接近5MiB原作保留真实章名和首中末正文，刷新后全本来源仍可读', async ({ page }, info) => {
  test.setTimeout(120000)
  const source = Array.from({ length: 100 }, (_, i) => `第${i + 1}章 标题${i + 1}\n开头标记${i}。${'中文原作。'.repeat(3400)}结尾标记${i}。\n`).join('')
  await page.goto('./script/library')
  await page.getByRole('button', { name: '新建剧本改编', exact: true }).click()
  await page.getByLabel('剧本名称', { exact: true }).fill('百万字来源检查')
  await page.getByLabel('来源方式', { exact: true }).selectOption('import')
  await page.getByLabel('上传原作文档').setInputFiles({ name: '百万字.txt', mimeType: 'text/plain', buffer: Buffer.from(source) })
  await expect(page.getByLabel('导入原作内容')).toHaveValue(source)
  await page.getByRole('button', { name: '冻结来源并创建剧本', exact: true }).click()
  await expect(page).toHaveURL(/script\/source\?work=\d+/)
  for (const index of [1, 50, 100]) {
    const nav = page.getByRole('navigation', { name: '原作来源单元', exact: true })
    await nav.getByRole('button', { name: new RegExp(`^第${index}章 标题${index} [1-9]\\d* 字$`) }).click()
    await expect(page.locator('.sp-source pre')).toContainText(`开头标记${index - 1}。`)
    await expect(page.locator('.sp-source pre')).toContainText(`结尾标记${index - 1}。`)
  }
  await page.reload()
  await page.getByRole('navigation', { name: '原作来源单元', exact: true }).getByRole('button', { name: /^第100章 标题100 [1-9]\d* 字$/ }).click()
  await expect(page.locator('.sp-source pre')).toContainText('结尾标记99。')
  await page.screenshot({ path: info.outputPath('final-chapter-after-reload.png') })
})
