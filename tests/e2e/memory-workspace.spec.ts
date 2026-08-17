import { expect, test, type Page } from '@playwright/test'

async function openCleanHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'memory-e2e')
    let pickerCalls = 0
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      if (pickerCalls++ === 0) return root
      return root.getDirectoryHandle('custom-location', { create: true })
    }
  })
  await page.goto('./projects', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /开始.*第一部.*小说/ })).toBeVisible({ timeout: 15_000 })
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: '+ 新建项目', exact: true }).click()
  await page.getByPlaceholder('如：《剑出山门》').fill(name)
  await page.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(page.getByText(/已选择：/)).toBeVisible()
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

  await sidebarButton(page, '设置').click()
  const storageSettings = page.getByTestId('project-storage-workspace-settings')
  await expect(storageSettings.getByRole('heading', { name: '项目存储工作区', exact: true })).toBeVisible()
  await expect(storageSettings.getByText(/已关联/)).toBeVisible()
  await expect(storageSettings.getByRole('button', { name: '更换位置', exact: true })).toBeVisible()

  // Seed high-value author semantics through the real UI before the first disk baseline.
  await sidebarButton(page, '故事设计').click()
  await page.getByText('点击填写一句话故事…', { exact: true }).click()
  await page.getByPlaceholder('点击填写一句话故事…').fill('浏览器创建的潮汐记忆故事')
  await page.getByPlaceholder('点击填写一句话故事…').press('Tab')
  await expect(page.getByText('浏览器创建的潮汐记忆故事', { exact: true })).toBeVisible()

  await sidebarButton(page, '创作规则').click()
  const writingStyle = page.getByPlaceholder(/描述期望的写作风格/)
  await writingStyle.fill('浏览器创建的克制证据文风')
  await writingStyle.press('Tab')
  await expect(writingStyle).toHaveValue('浏览器创建的克制证据文风')

  await sidebarButton(page, '数据管理').click()
  await expect(page.getByRole('heading', { name: '数据管理', exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: '选择本地文件夹', exact: true })).toHaveCount(0)
  await expect(page.getByText(/项目存储工作区：/)).toBeVisible()
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

  const semanticPaths = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const storyforge = await root.getDirectoryHandle('.storyforge')
    const manifest = JSON.parse(await (await (await storyforge.getFileHandle('manifest.json')).getFile()).text())
    return {
      story: manifest.documents.find((item: { documentKind: string }) => item.documentKind === 'story-core').relativePath,
      rules: manifest.documents.find((item: { documentKind: string }) => item.documentKind === 'creative-rules').relativePath,
    }
  })
  expect(semanticPaths.story).toMatch(/^works\/WORK-[a-f0-9-]+\/memory\/story-core\.yaml$/i)
  expect(semanticPaths.rules).toMatch(/^works\/WORK-[a-f0-9-]+\/memory\/creative-rules\.yaml$/i)
  expect(await opfsFileText(page, semanticPaths.story)).toContain('浏览器创建的潮汐记忆故事')
  expect(await opfsFileText(page, semanticPaths.rules)).toContain('浏览器创建的克制证据文风')

  await page.evaluate(async ({ paths }) => {
    const replaceLine = async (relativePath: string, field: string, value: string) => {
      const parts = relativePath.split('/').filter(Boolean)
      const fileName = parts.pop()!
      let directory = await navigator.storage.getDirectory()
      for (const part of parts) directory = await directory.getDirectoryHandle(part)
      const handle = await directory.getFileHandle(fileName)
      const original = await (await handle.getFile()).text()
      const next = original.replace(new RegExp(`^([\\t ]*)${field}:.*$`, 'm'), `$1${field}: ${value}`)
      if (next === original) throw new Error(`未找到语义字段：${field}`)
      const writable = await handle.createWritable()
      await writable.write(next)
      await writable.close()
    }
    await replaceLine(paths.story, '一句话故事', '硬盘修订的潮汐记忆故事')
    await replaceLine(paths.rules, '写作风格', '硬盘修订的克制证据文风')
  }, { paths: semanticPaths })
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByText(/本地改动 2/)).toBeVisible()
  await expect(page.getByText(/story-core\.yaml.*一句话故事/)).toBeVisible()
  await expect(page.getByText(/creative-rules\.yaml.*写作风格/)).toBeVisible()
  await page.getByRole('button', { name: '确认采纳本地改动', exact: true }).click()
  await expect(page.getByText('本地文件改动已采纳，并完成数据库与文件回读核对', { exact: true }))
    .toBeVisible({ timeout: 15_000 })
  await sidebarButton(page, '故事设计').click()
  await expect(page.getByText('硬盘修订的潮汐记忆故事', { exact: true })).toBeVisible()
  await sidebarButton(page, '创作规则').click()
  await expect(page.getByPlaceholder(/描述期望的写作风格/)).toHaveValue('硬盘修订的克制证据文风')
  await sidebarButton(page, '数据管理').click()

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

  // The storage location can be changed from Settings. Rebinding alone is
  // still zero-write; the new location is initialized only after self-check
  // and explicit confirmation.
  await sidebarButton(page, '设置').click()
  await storageSettings.getByRole('button', { name: '更换位置', exact: true }).click()
  await expect(storageSettings.getByText(/存储位置已改为“custom-location”/)).toBeVisible()
  expect(await page.evaluate(async () => {
    const custom = await (await navigator.storage.getDirectory()).getDirectoryHandle('custom-location')
    const names: string[] = []
    for await (const name of custom.keys()) names.push(name)
    return names
  })).toEqual([])
  await storageSettings.getByRole('button', { name: '核对与同步', exact: true }).click()
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByText(/核对完成：发现 \d+ 项需要处理/)).toBeVisible()
  await page.getByRole('button', { name: '确认写入项目改动', exact: true }).click()
  await expect(page.getByText('项目改动已写入本地文件，并完成回读核对', { exact: true })).toBeVisible({ timeout: 15_000 })
  expect(await opfsFileText(page, 'custom-location/storyforge.workspace.json')).toContain('硬盘修改后的项目名')
})
