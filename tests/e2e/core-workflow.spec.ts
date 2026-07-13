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

async function expectInputValue(page: Page, value: string) {
  await expect.poll(() => page.locator('input').evaluateAll(
    (inputs, expected) => inputs.some(input => input.value === expected),
    value,
  )).toBe(true)
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
