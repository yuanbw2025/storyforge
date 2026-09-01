import { expect, type Locator, type Page } from '@playwright/test'

export function currentWorldReleasePanel(page: Page): Locator {
  return page.getByRole('region', { name: '世界修订、发布与产品交接' })
}

/**
 * Freeze and publish the current semantic world through the only supported UI
 * boundary. Product builds, media and sessions deliberately remain outside.
 */
export async function publishCurrentWorldRelease(
  page: Page,
  label = 'E2E 纯语义世界修订',
): Promise<Locator> {
  const panel = currentWorldReleasePanel(page)
  await expect(panel).toBeVisible({ timeout: 15_000 })
  await panel.getByLabel('修订名称').fill(label)
  await panel.getByRole('button', { name: '冻结修订', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('已冻结新的纯语义世界修订')
  await panel.getByRole('button', { name: '发布版本', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(/发布修订 \d+？/)
  await dialog.getByRole('button', { name: '发布世界版本', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('不可变 WorldRelease 已发布')
  return panel
}
