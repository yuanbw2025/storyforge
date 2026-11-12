import { expect, test, type Page } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'folder-picker-e2e')
    window.showDirectoryPicker = async () => {
      const failure = localStorage.getItem('folder-picker-test-failure')
      if (failure) throw new DOMException('合成目录选择失败', failure)
      return (await navigator.storage.getDirectory()).getDirectoryHandle('隔离验收目录', { create: true })
    }
  })
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  let modelRequests = 0
  await page.route(/\/chat\/completions|\/v1\/responses|\/v1\/messages/, async route => {
    modelRequests += 1
    await route.abort()
  })
  await page.goto('./long?module=outline')
  return { pageErrors, modelRequests: () => modelRequests }
}

test('新建与设置中选择失败可见、取消静默，原绑定跨刷新保持且零文件改写', async ({ page }) => {
  const evidence = await prepare(page)
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill('目录失败隔离验收')
  const field = page.getByTestId('project-storage-folder-field')
  await page.evaluate(() => localStorage.setItem('folder-picker-test-failure', 'NotAllowedError'))
  await field.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(field.getByRole('alert')).toHaveText('选择文件夹失败：合成目录选择失败')
  await expect(field.getByText('尚未选择，可稍后在设置中指定', { exact: true })).toBeVisible()
  await page.evaluate(() => localStorage.setItem('folder-picker-test-failure', 'AbortError'))
  await field.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(field.getByRole('alert')).toHaveCount(0)
  await page.evaluate(() => localStorage.removeItem('folder-picker-test-failure'))
  await field.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(field.getByText('已选择：隔离验收目录', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  await openLongformLeaf(page, '设置')
  const settings = page.getByTestId('project-storage-workspace-settings')
  await expect(settings.getByText('隔离验收目录', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('隔离验收目录')
    const file = await dir.getFileHandle('保留.txt', { create: true })
    const writable = await file.createWritable()
    await writable.write('合成原文件，目录选择失败不得改写')
    await writable.close()
    localStorage.setItem('folder-picker-test-failure', 'SecurityError')
  })
  await settings.getByRole('button', { name: '更换位置', exact: true }).click()
  await expect(settings.getByText('保存位置失败：合成目录选择失败', { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: '更换位置', exact: true })).toBeEnabled()
  await expect(settings.getByText('隔离验收目录', { exact: true })).toBeVisible()
  await page.evaluate(() => localStorage.setItem('folder-picker-test-failure', 'AbortError'))
  await settings.getByRole('button', { name: '更换位置', exact: true }).click()
  await expect(settings.getByText(/保存位置失败/)).toHaveCount(0)
  await page.reload()
  await expect(settings.getByText('隔离验收目录', { exact: true })).toBeVisible()
  expect(await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('隔离验收目录')
    const names: string[] = []
    for await (const name of dir.keys()) names.push(name)
    return { names, text: await (await (await dir.getFileHandle('保留.txt')).getFile()).text() }
  })).toEqual({ names: ['保留.txt'], text: '合成原文件，目录选择失败不得改写' })
  expect(evidence.pageErrors).toEqual([])
  expect(evidence.modelRequests()).toBe(0)
})

test('首页恢复入口提示选择失败且不开始恢复；取消仍可再次选择', async ({ page }) => {
  const evidence = await prepare(page)
  await page.goto('./home/data')
  await page.evaluate(() => localStorage.setItem('folder-picker-test-failure', 'NotAllowedError'))
  const choose = page.getByRole('button', { name: '从备份文件夹恢复', exact: true })
  await choose.click()
  await expect(page.getByRole('alert')).toContainText('合成目录选择失败')
  await expect(choose).toBeEnabled()
  await page.evaluate(() => localStorage.setItem('folder-picker-test-failure', 'AbortError'))
  await choose.click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(evidence.pageErrors).toEqual([])
  expect(evidence.modelRequests()).toBe(0)
})
