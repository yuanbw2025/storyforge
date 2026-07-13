import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openCleanHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /开始.*第一部.*小说/ })).toBeVisible()
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: '+ 新建项目', exact: true }).click()
  await page.getByPlaceholder('如：《剑出山门》').fill(name)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  await expect(page.getByTitle(name)).toBeVisible()
}

function sidebarButton(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('button', { name, exact: true })
}

async function expectInputValue(page: Page, value: string) {
  await expect.poll(() => page.locator('input').evaluateAll(
    (inputs, expected) => inputs.some(input => input.value === expected),
    value,
  )).toBe(true)
}

async function expectNumericInputValue(locator: ReturnType<Page['getByPlaceholder']>, expected: number) {
  await expect.poll(async () => Number((await locator.inputValue()).replaceAll(',', ''))).toBe(expected)
}

async function createBookWithSavedChapter(page: Page, projectName: string, chapterText: string) {
  await openCleanHome(page)
  await createProject(page, projectName)
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expectInputValue(page, '第1卷')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expectInputValue(page, '第1章')
  await page.getByTitle('编辑章节').click()

  const editor = page.locator('.tiptap-editor')
  await expect(editor).toBeVisible()
  await editor.fill(chapterText)
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
}

test('新用户可创建项目并进入工作区', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 创建项目')
  await expect(page.getByRole('button', { name: '大纲', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '章节', exact: true })).toBeVisible()
})

test('建卷建章、保存正文、刷新恢复并导出正文与隐私诊断', async ({ page }) => {
  const projectName = 'E2E 正文往返'
  const chapterText = '林舟推开旧城门，确认正文已经写入并保存。'
  await createBookWithSavedChapter(page, projectName, chapterText)

  await page.reload()
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText(chapterText)

  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  const markdownDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click()
  const markdown = await markdownDownload
  const markdownPath = await markdown.path()
  expect(markdownPath).not.toBeNull()
  expect(await readFile(markdownPath!, 'utf8')).toContain(chapterText)

  const diagnosticDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载诊断信息', exact: true }).click()
  const diagnostic = await diagnosticDownload
  expect(diagnostic.suggestedFilename()).toMatch(/^storyforge-diagnostics-\d{4}-\d{2}-\d{2}\.json$/)
  const diagnosticPath = await diagnostic.path()
  expect(diagnosticPath).not.toBeNull()
  const diagnosticText = await readFile(diagnosticPath!, 'utf8')
  const report = JSON.parse(diagnosticText) as {
    format: string
    privacy: { includesRecordContents: boolean; includesApiKeys: boolean }
  }
  expect(report.format).toBe('storyforge-local-diagnostics')
  expect(report.privacy.includesRecordContents).toBe(false)
  expect(report.privacy.includesApiKeys).toBe(false)
  expect(diagnosticText).not.toContain(projectName)
  expect(diagnosticText).not.toContain(chapterText)
})

test('完整 JSON 导出后可重新导入且正文不丢', async ({ page }) => {
  const projectName = 'E2E JSON 往返'
  const chapterText = '这段正文必须跟随完整 JSON 备份恢复。'
  await createBookWithSavedChapter(page, projectName, chapterText)
  await page.getByRole('button', { name: '数据管理', exact: true }).click()

  const exportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const backup = await exportDownload
  const backupPath = await backup.path()
  expect(backupPath).not.toBeNull()

  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '导入 JSON', exact: true }).click()
  await (await fileChooser).setFiles(backupPath!)
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText(chapterText)
})

test('手动快照可恢复为新项目且不覆盖原项目', async ({ page }) => {
  const projectName = 'E2E 快照恢复'
  await createBookWithSavedChapter(page, projectName, '快照中的正文内容。')
  await page.getByRole('button', { name: '版本历史', exact: true }).click()
  await page.getByPlaceholder('快照名称（可选 — 留空使用时间戳）').fill('E2E 手动快照')
  await page.getByRole('button', { name: '创建快照', exact: true }).click()
  await expect(page.getByText('E2E 手动快照')).toBeVisible()

  const originalWorkspaceUrl = page.url()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '恢复为新项目', exact: true }).click()
  await expect(page).not.toHaveURL(originalWorkspaceUrl)
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await expect(page.getByRole('heading', { name: /共有 2 部作品/ })).toBeVisible()
  await expect(page.getByText(projectName, { exact: true })).toBeVisible()
  await expect(page.getByText(`${projectName}（导入）`, { exact: true })).toBeVisible()
})

test('删除项目经过双重安全门且不影响其它项目', async ({ page }) => {
  const deletedProject = 'E2E 待删除项目'
  const keptProject = 'E2E 保留项目'
  await createBookWithSavedChapter(page, deletedProject, '删除项目时应由注册表级联清理的正文。')
  await page.getByRole('button', { name: '返回首页', exact: true }).click()
  await createProject(page, keptProject)
  await page.getByRole('button', { name: '返回首页', exact: true }).click()

  const deletedRow = page.getByText(deletedProject, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await deletedRow.getByTitle('删除').click()
  await expect(deletedRow.getByRole('button', { name: '确认', exact: true })).toBeVisible()
  await expect(page.getByText(deletedProject, { exact: true })).toBeVisible()

  await deletedRow.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('heading', { name: '危险操作:删除项目' })).toBeVisible()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('heading', { name: '是否立即下载备份(JSON 文件到本地)?' })).toBeVisible()
  await page.getByRole('button', { name: '已备份，继续', exact: true }).click()

  await expect(page.getByText(deletedProject, { exact: true })).toHaveCount(0)
  await expect(page.getByText(keptProject, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /共有 1 部作品/ })).toBeVisible()
})

test('取消删除安全门后项目与正文都保留', async ({ page }) => {
  const projectName = 'E2E 取消删除'
  const chapterText = '取消危险操作后这段正文必须仍然存在。'
  await createBookWithSavedChapter(page, projectName, chapterText)
  await page.getByRole('button', { name: '返回首页', exact: true }).click()

  const projectRow = page.getByText(projectName, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await projectRow.getByTitle('删除').click()
  await projectRow.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByRole('heading', { name: '危险操作:删除项目' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  await expect(page.getByText(projectName, { exact: true })).toBeVisible()
  await page.getByText(projectName, { exact: true }).click()
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText(chapterText)
})

test('上下文窗口与四类任务模型路由跨模块和刷新保留', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E AI 配置持久化')
  await sidebarButton(page, '设置').click()

  const contextWindow = page.getByPlaceholder('本地/自定义模型请按实际填写，如 131072；留空 = 用内置预设')
  await contextWindow.fill('2,100,000')
  await expect(page.getByText('2,100,000 token', { exact: false })).toBeVisible()
  await expect(page.getByText('已自动保存到当前配置', { exact: true })).toBeVisible()

  await sidebarButton(page, '数据管理').click()
  await sidebarButton(page, '设置').click()
  await expectNumericInputValue(contextWindow, 2_100_000)

  await page.getByRole('button', { name: '＋ 保存当前为预设', exact: true }).click()
  const presetName = page.getByPlaceholder('预设名称，如「DeepSeek 主力」')
  await presetName.fill('创作模型')
  await presetName.locator('xpath=..').getByRole('button', { name: '保存', exact: true }).click()

  await page.getByPlaceholder('或手动输入模型名（列表中没有的型号）').fill('deepseek-review')
  await page.getByRole('button', { name: '另存为新预设', exact: true }).click()
  await presetName.fill('审查模型')
  await presetName.locator('xpath=..').getByRole('button', { name: '保存', exact: true }).click()

  await page.getByLabel('创作生成模型预设').selectOption({ label: '创作模型 · deepseek/deepseek-chat' })
  await page.getByLabel('结构提取模型预设').selectOption({ label: '创作模型 · deepseek/deepseek-chat' })
  await page.getByLabel('分析总结模型预设').selectOption({ label: '审查模型 · deepseek/deepseek-review' })
  await page.getByLabel('审查校验模型预设').selectOption({ label: '审查模型 · deepseek/deepseek-review' })

  await page.reload()
  await sidebarButton(page, '设置').click()
  await expectNumericInputValue(contextWindow, 2_100_000)
  await expect(page.getByLabel('创作生成模型预设')).toHaveValue(await page.getByLabel('结构提取模型预设').inputValue())
  await expect(page.getByLabel('分析总结模型预设')).toHaveValue(await page.getByLabel('审查校验模型预设').inputValue())
  await expect(page.getByLabel('创作生成模型预设').locator('option:checked')).toContainText('创作模型')
  await expect(page.getByLabel('分析总结模型预设').locator('option:checked')).toContainText('审查模型')
})

test('本地 OpenAI 兼容服务可刷新并保存模型列表', async ({ page }) => {
  await page.route('http://localhost:1234/v1/models', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'qwen-local' }, { id: 'deepseek-local' }] }),
    })
  })
  await openCleanHome(page)
  await createProject(page, 'E2E 本地模型刷新')
  await sidebarButton(page, '设置').click()

  const provider = page.locator('label:has-text("提供商") + select')
  await provider.selectOption('ollama')
  const baseUrl = page.locator('label:has-text("Base URL") + input')
  await baseUrl.fill('http://localhost:1234/v1/models')
  await page.getByRole('button', { name: '刷新模型', exact: true }).click()

  const modelList = page.getByLabel('服务返回的模型列表')
  await expect(modelList).toBeVisible()
  await expect(modelList.locator('option')).toHaveCount(3)
  await modelList.selectOption('qwen-local')
  await expect(baseUrl).toHaveValue('http://localhost:1234/v1')

  await page.reload()
  await sidebarButton(page, '设置').click()
  await expect(page.locator('input[placeholder="手动输入模型名"]')).toHaveValue('qwen-local')
  await expect(baseUrl).toHaveValue('http://localhost:1234/v1')
})
