import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
test('real release host desk exports selected facts, checks bytes, keeps private choices explicit and clears at handoff', async ({ page }) => {
  test.setTimeout(120000)
  const sent: string[] = []
  page.on('request', r => { if (/\/v1\/(?:chat\/completions|responses)/.test(r.url())) sent.push(r.url()) })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const f = await (await importer('/storyforge/tests/helpers/open-ttrpg-world-patch.ts')).seedTtrpgWorldPatchReviewV1()
    const db = (await importer('/storyforge/src/lib/db/schema.ts')).db
    return { sessionId: f.host.sessionId, scope: f.scope, world: JSON.stringify(await db.worldReleases.toArray()), releases: JSON.stringify(await db.productReleases.toArray()) }
  })
  await page.goto(`./play/session/${f.sessionId}`)
  const enter = async () => {
    await page.getByLabel('我的主持席位', { exact: true }).selectOption('viewer.gm')
    await page.getByLabel('我是本桌真人主持，已了解安全约定，可以查看主持专用资料。', { exact: true }).check()
    await page.getByRole('button', { name: '确认主持身份并进入', exact: true }).click()
  }
  await enter()
  let card = page.getByTestId('ttrpg-world-patch')
  await expect(card).toBeVisible(); await card.locator('summary').first().click()
  await expect(card.getByRole('group', { name: '选择补丁事实' })).toBeVisible()
  await expect(card).not.toContainText('GM-PATCH'); await expect(card).not.toContainText('PRIVATE-PATCH'); await expect(card).not.toContainText('BELIEF-MEMORY')
  const exportButton = card.getByRole('button', { name: '导出待作者审阅的世界补丁', exact: true })
  await expect(exportButton).toBeDisabled()
  await card.getByLabel('交付事实：守灯人知道港口情况。', { exact: true }).check()
  const downloaded = page.waitForEvent('download'); await exportButton.click(); const download = await downloaded
  const path = (await download.path())!, bytes = await readFile(path, 'utf8'), data = JSON.parse(bytes)
  expect(data.purpose).toBe('author-review-only'); expect(data.facts).toHaveLength(1); expect(data.decisions.filter((d: any) => d.decision === 'pending')).toHaveLength(1)
  for (const secret of ['GM-PATCH', 'PRIVATE-PATCH', 'BELIEF-MEMORY', 'RETIRED-PATCH', 'sessionId']) expect(bytes).not.toContain(secret)
  await card.getByLabel('选择补丁文件', { exact: true }).setInputFiles(path)
  await expect(card).toContainText('来源匹配当前冒险的冻结版本。')
  await card.getByLabel('明确包含本人有权读取的私人事实', { exact: true }).check()
  await expect(card).toContainText('PRIVATE-PATCH-REQUIRES-CHOICE')
  await expect(card.getByRole('button', { name: '导出待作者审阅的世界补丁', exact: true })).toBeDisabled()
  await card.getByLabel('明确包含主持秘密，作为私密审阅材料', { exact: true }).check()
  await expect(card).toContainText('GM-PATCH-REQUIRES-CHOICE')
  await page.setViewportSize({ width: 390, height: 844 }); await card.scrollIntoViewIfNeeded()
  await card.getByLabel('交付事实：GM-PATCH-REQUIRES-CHOICE', { exact: true }).scrollIntoViewIfNeeded()
  await expect(card.getByLabel('交付事实：GM-PATCH-REQUIRES-CHOICE', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '导出待作者审阅的世界补丁', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('p8-world-patch-mobile.png') })
  await page.reload(); await enter(); card = page.getByTestId('ttrpg-world-patch'); await card.locator('summary').first().click()
  await expect(card.getByLabel('明确包含主持秘密，作为私密审阅材料', { exact: true })).not.toBeChecked()
  await expect(card).not.toContainText('GM-PATCH')
  await page.getByRole('button', { name: '返回身份选择', exact: true }).click()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByTestId('ttrpg-world-patch')).toHaveCount(0)
  const after = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const db = (await importer('/storyforge/src/lib/db/schema.ts')).db
    return { world: JSON.stringify(await db.worldReleases.toArray()), releases: JSON.stringify(await db.productReleases.toArray()) }
  })
  expect(after.world).toBe(f.world); expect(after.releases).toBe(f.releases); expect(sent).toEqual([])
})
