import { expect, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
test('native Creator selects an exact frozen protagonist and restores it before formal confirmation', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : route.abort()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality096-isolated'))
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<unknown>
    const { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } =
      await importer('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
    const f = await seedCurrentProductWorld('096 browser source protagonist')
    const catalog = await loadCurrentProductWorldSourceCatalogV1({ scope: f.scope, worldReleaseId: f.release.id!, productType: 'text-open-world' })
    return { projectId: f.scope.projectId, releaseId: f.release.id!, role: catalog.characters[0]! }
  })
  await page.goto(`./world/versions?project=${fixture.projectId}`)
  const versions = page.getByRole('region', { name: '世界修订、发布与产品交接' })
  await expect(versions).toBeVisible({ timeout: 30_000 })
  await versions.getByLabel('冻结世界版本').selectOption(String(fixture.releaseId))
  await versions.getByRole('button', { name: '交给文字开放世界', exact: true }).click()
  const source = page.getByTestId('text-open-world-creator-studio')
  await expect(source.getByTestId('creator-source-continue')).toBeEnabled({ timeout: 30_000 })
  await source.getByTestId('creator-source-continue').click()
  const studio = page.getByTestId('text-open-world-creator-brief-studio')
  await expect(studio).toBeVisible()
  await studio.getByLabel('主角来源').selectOption('source-character')
  const confirm = studio.getByTestId('text-open-world-creator-brief-confirm')
  await expect(confirm).toBeDisabled()
  const role = studio.getByLabel('封存角色')
  await expect(role.locator('option').filter({ hasText: fixture.role.name })).toHaveCount(1)
  await role.selectOption(fixture.role.resourceKey)
  await studio.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(studio).toContainText('草稿已保存，可刷新后继续')
  await page.reload()
  await expect(studio).toBeVisible({ timeout: 30_000 })
  await expect(studio.getByLabel('主角来源')).toHaveValue('source-character')
  await expect(studio.getByLabel('封存角色')).toHaveValue(fixture.role.resourceKey)
  await expect(confirm).toBeDisabled()
})
