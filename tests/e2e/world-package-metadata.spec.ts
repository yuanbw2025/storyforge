import { expect, test } from '@playwright/test'
import { publishCurrentWorldRelease, openWorldSection } from './helpers/world-release'

test('SFQA020: sharing UI downloads an inspectable 200-character warning and rejects 201/13 warnings without clipping or another file', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./world/worlds')
  await page.getByRole('button', { name: '新建世界', exact: true }).click()
  await page.getByLabel('新世界名称').fill('世界分享边界')
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await expect(page).toHaveURL(/world\/basics\?project=\d+/)
  await publishCurrentWorldRelease(page, '分享包边界封存')
  await openWorldSection(page, 'sharing')
  const panel = page.getByRole('region', { name: '世界发布与导入', exact: true })
  await panel.getByLabel('作者署名', { exact: true }).fill('测试作者')
  const warning = panel.getByLabel('内容警告（可选）', { exact: true })
  await warning.fill('警'.repeat(200))
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载世界分享包', exact: true }).click()
  const file = await download
  await expect(panel.getByRole('status')).toContainText('已生成')
  const stream = await file.createReadStream()
  if (!stream) throw new Error('Missing downloaded package')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  expect(input.manifest.contentWarnings).toEqual(['警'.repeat(200)])
  await panel.locator('input[type=file]').setInputFiles({ name: 'successful-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) })
  await expect(panel.getByTestId('world-package-preview')).toContainText('分享包预检通过')
  for (const text of ['警'.repeat(201), Array.from({ length: 13 }, () => '警告').join(',')]) {
    await warning.fill(text)
    await panel.getByRole('button', { name: '下载世界分享包', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText('最多 12 条，每条最多 200 字')
    await expect(warning).toHaveValue(text)
    expect(downloads).toHaveLength(1)
  }
})
