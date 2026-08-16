import { expect, test, type Page } from '@playwright/test'

async function openCleanHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'memory-e2e')
    window.showDirectoryPicker = async () => navigator.storage.getDirectory()
  })
  await page.goto('./projects', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /开始.*第一部.*小说/ })).toBeVisible({ timeout: 15_000 })
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: '+ 新建项目', exact: true }).click()
  await page.getByPlaceholder('如：《剑出山门》').fill(name)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
}

function sidebarButton(page: Page, name: string) {
  return page.getByRole('navigation').getByText(name, { exact: true }).locator('xpath=ancestor::button[1]')
}

async function opfsFileText(page: Page, path: string): Promise<string> {
  return page.evaluate(async (relativePath) => {
    const parts = relativePath.split('/').filter(Boolean)
    const fileName = parts.pop()!
    let directory = await navigator.storage.getDirectory()
    for (const part of parts) directory = await directory.getDirectoryHandle(part)
    return (await (await directory.getFileHandle(fileName)).getFile()).text()
  }, path)
}

test('本地记忆工作区以真实浏览器文件系统完成手动双向核对', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'OPFS 记忆验收')
  await sidebarButton(page, '数据管理').click()
  await expect(page.getByRole('heading', { name: '数据管理', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '选择本地文件夹', exact: true }).click()
  await expect(page.getByText(/已绑定.*尚未写入任何文件/)).toBeVisible()
  expect(await page.evaluate(async () => {
    const names: string[] = []
    for await (const name of (await navigator.storage.getDirectory()).keys()) names.push(name)
    return names
  })).toEqual([])

  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByText(/核对完成：发现 \d+ 项需要处理/)).toBeVisible()
  expect(await page.evaluate(async () => {
    const names: string[] = []
    for await (const name of (await navigator.storage.getDirectory()).keys()) names.push(name)
    return names
  })).toEqual([])

  await page.getByRole('button', { name: '确认写入项目改动', exact: true }).click()
  await expect(page.getByText('项目改动已写入本地文件，并完成回读核对', { exact: true })).toBeVisible({ timeout: 15_000 })
  const rootText = await opfsFileText(page, 'storyforge.workspace.json')
  expect(rootText).toContain('OPFS 记忆验收')
  expect(JSON.parse(await opfsFileText(page, '.storyforge/manifest.json')).manifestHash).toMatch(/^[a-f0-9]{64}$/)
  expect(await opfsFileText(page, '.storyforge/recovery/project.json')).toContain('workspaceUid')
  expect(await opfsFileText(page, '.storyforge/runs/memory-index.json')).toContain('indexHash')

  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle('storyforge.workspace.json')
    const decoded = JSON.parse(await (await handle.getFile()).text())
    decoded.data.name = '硬盘修改后的项目名'
    const writable = await handle.createWritable()
    await writable.write(`${JSON.stringify(decoded, null, 2)}\n`)
    await writable.close()
  })
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByText(/本地改动 1/)).toBeVisible()
  await expect(page.getByText(/storyforge\.workspace\.json.*name/)).toBeVisible()
  await page.getByRole('button', { name: '确认采纳本地改动', exact: true }).click()
  await expect(page.getByText('本地文件改动已采纳，并完成数据库与文件回读核对', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTitle('硬盘修改后的项目名')).toBeVisible()
  await expect(page.getByText(/已一致 \d+ · 项目内改动 0 · 本地改动 0/)).toBeVisible()
})
