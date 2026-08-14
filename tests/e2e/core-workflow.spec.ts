import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openCleanHome(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./projects', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /开始.*第一部.*小说/ }))
    .toBeVisible({ timeout: 15_000 })
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: '+ 新建项目', exact: true }).click()
  await page.getByPlaceholder('如：《剑出山门》').fill(name)
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+$/)
  await expect(page.getByTitle(name)).toBeVisible()
}

function sidebarButton(page: Page, name: string) {
  return page.getByRole('navigation')
    .getByText(name, { exact: true })
    .locator('xpath=ancestor::button[1]')
}

test('产品综合首页提供并列功能入口和真实世界基座', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '你的创作与游玩空间', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '产品页签' })).toBeVisible()
  await expect(page.getByRole('button', { name: '世界引擎', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '分步骤写作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '节点创作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '跑团', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '角色聊天', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '文字游戏', exact: true })).toBeVisible()
})

test('产品综合首页可从零创建世界引擎并分配稳定编号', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('潮汐之后')
  await page.getByPlaceholder('一句话描述这个世界或作品').fill('海平面吞没大陆后的漂浮聚落。')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()

  await expect(page.getByRole('heading', { name: '世界引擎', exact: true })).toBeVisible()
  await expect(page.locator('.sf-worlds-featured').getByRole('heading', { name: '潮汐之后', exact: true })).toBeVisible()
  await expect(page.locator('.sf-world-code-large')).toHaveText(/W-[A-Z0-9]+-[A-Z0-9]+ · v1/)
  await expect(page.getByText('从基础设定开始', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '回到总览', exact: true }).click()
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('群星港')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()
  await expect(page.locator('.sf-worlds-featured').getByRole('heading', { name: '群星港', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '回到总览', exact: true }).click()
  const tidalWorld = page.locator('.sf-world-card').filter({ hasText: '潮汐之后' })
  await expect(tidalWorld).toHaveCount(1)
  await tidalWorld.click()
  await expect(page.locator('.sf-worlds-featured').getByRole('heading', { name: '潮汐之后', exact: true })).toBeVisible()

  await page.getByRole('banner').getByRole('button', { name: '搜索世界', exact: true }).click()
  await expect(page.getByRole('heading', { name: '选择一个世界', exact: true })).toBeVisible()
})

test('分步骤作品进入世界引擎时直接复用完整工作台，不要求开启多世界', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /分步骤作品/ }).click()
  await page.getByPlaceholder('例如：《幽都遗闻》').fill('分步骤世界基线')
  await page.getByRole('button', { name: '创建分步骤作品', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+\?module=outline$/)

  await page.goto('./')
  await page.getByRole('button', { name: '世界引擎', exact: true }).click()
  await expect(page.getByRole('heading', { name: '完整世界工作台', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '同步分步骤设定', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '自然环境', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '大纲与细纲', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+\?module=outline$/)
})

test('世界引擎可在同一 World 创建并切换两部隔离作品', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('双作品世界')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()

  const manager = page.getByRole('region', { name: '世界作品' })
  await expect(manager).toContainText('双作品世界')
  await manager.getByRole('button', { name: '新建作品' }).click()
  await manager.getByPlaceholder('作品名称').fill('第二部作品')
  await manager.getByRole('button', { name: '创建并切换' }).click()
  await expect(manager.locator('.sf-world-work-row.active')).toContainText('第二部作品')

  await manager.locator('.sf-world-work-row').filter({ hasText: '双作品世界' }).locator('button').first().click()
  await expect(manager.locator('.sf-world-work-row.active')).toContainText('双作品世界')
  await expect(page.getByRole('region', { name: '叙事蓝图与世界发布' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '叙事蓝图与发布' })).toBeVisible()
})

test('世界引擎从主线冻结发布并创建绑定文字游戏实例', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('发布实例世界')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()

  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByTitle('新增主线').click()
  await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  await expect(page.getByText('阶段列表（1）', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  await expect(page.getByText('阶段列表（2）', { exact: true })).toBeVisible()

  await page.goto('./')
  await page.getByRole('button', { name: '世界引擎', exact: true }).click()
  const pipeline = page.getByRole('region', { name: '叙事蓝图与世界发布' })
  await pipeline.getByRole('button', { name: '同步主线与支线', exact: true }).click()
  await expect(pipeline.getByRole('status')).toContainText('已同步 1 条主线/支线。')
  const narrativeButtons = pipeline.locator('.sf-world-module-list button')
  await expect(narrativeButtons).toHaveCount(1)
  await narrativeButtons.click()
  await pipeline.getByLabel('共享范围 主线').selectOption('world')
  await expect(pipeline.getByRole('status')).toContainText('“主线”已设为整个世界可复用的叙事。')
  await pipeline.getByLabel('角色资产').uncheck()
  await pipeline.getByPlaceholder('例如：世界修订 1').fill('E2E 首发修订')
  await pipeline.getByRole('button', { name: '冻结修订', exact: true }).click()
  await expect(pipeline.getByRole('status')).toContainText('已冻结新的世界草稿修订。')
  await pipeline.getByLabel('修订名称').fill('E2E 发布修订')
  await pipeline.getByRole('button', { name: '冻结修订', exact: true }).click()
  await expect(pipeline.getByRole('region', { name: '最新修订差异' })).toContainText('相对修订 1')
  await pipeline.getByRole('button', { name: '发布版本', exact: true }).click()
  const publishDialog = page.getByRole('dialog')
  await expect(publishDialog).toContainText('发布修订 2？')
  await publishDialog.getByRole('button', { name: '发布版本', exact: true }).click()
  await expect(pipeline.getByRole('status')).toContainText('不可变世界版本已发布。')

  await pipeline.getByLabel('实例名称').fill('E2E 主线文字游戏')
  await pipeline.getByRole('button', { name: '创建实例', exact: true }).click()
  await expect(pipeline.getByRole('status')).toContainText('已创建独立实例“E2E 主线文字游戏”。')
  await pipeline.getByRole('button', { name: '查看实例', exact: true }).click()
  await expect(page).toHaveURL(/\/storyforge\/workspace\/\d+\?module=simulation-runtime$/)
  await expect(page.getByRole('heading', { name: 'E2E 主线文字游戏', exact: true })).toBeVisible()
  await expect(page.getByText('体验中心 · 文字游戏', { exact: true })).toBeVisible()
  const frozenNarrative = page.getByRole('region', { name: '冻结叙事进度' })
  await expect(frozenNarrative).toContainText('主线')
  await frozenNarrative.getByRole('button').click()
  await expect(frozenNarrative).toContainText('已到达结局')

  await page.goto('./')
  await page.getByRole('button', { name: '世界引擎', exact: true }).click()
  const sharing = page.getByRole('region', { name: '世界发布与导入' })
  await expect(sharing).toContainText('导出不可变版本 v1 的世界设定与已选叙事模块。')
  await sharing.getByLabel('作者署名').fill('E2E 发布作者')
  const download = page.waitForEvent('download')
  await sharing.getByRole('button', { name: '下载世界分享包', exact: true }).click()
  const packageDownload = await download
  const packagePath = await packageDownload.path()
  expect(packagePath).not.toBeNull()
  const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(packagePath!, 'utf8'))
  expect(packageJson.release.manifest.selectedTables).not.toContain('characters')
  expect(packageJson.release.manifest.selectedTables).toContain('narrativeModules')
  expect(packageJson.release.manifest.selectedTables).toContain('outlineNodes')
  await expect(sharing.getByRole('status')).toContainText('世界分享包 v2 已生成')

  const fileChooser = page.waitForEvent('filechooser')
  await sharing.getByRole('button', { name: '选择世界分享包', exact: true }).click()
  await (await fileChooser).setFiles(packagePath!)
  await expect(page.getByTestId('world-package-preview')).toContainText('分享包预检通过')
  await page.getByRole('button', { name: '确认导入为本地副本', exact: true }).click()
  await expect(page.getByRole('heading', { name: '发布实例世界（导入）', exact: true })).toBeVisible()
  await expect(page.getByText(/社区导入 · W-/)).toBeVisible()
  await expect(page.locator('.sf-world-module-row.active')).toContainText('主线')
})

test('世界引擎叙事发布面板在窄屏纵向排列且没有横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await page.getByRole('main').getByRole('button', { name: '新建内容', exact: true }).first().click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('窄屏世界')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()

  const pipeline = page.getByRole('region', { name: '叙事蓝图与世界发布' })
  await expect(pipeline).toBeVisible()
  await pipeline.getByLabel('新叙事类型').selectOption('opening')
  await pipeline.getByLabel('新叙事名称').fill('窄屏开局')
  await pipeline.getByRole('button', { name: '创建叙事' }).click()
  await expect(pipeline.getByText('窄屏开局', { exact: true })).toBeVisible()
  await expect(pipeline.getByLabel('世界基础')).toBeVisible()
  await expect(pipeline.getByLabel('大纲与细纲')).toBeVisible()

  const stageBoxes = await pipeline.locator('.sf-world-pipeline-stage').evaluateAll(elements => (
    elements.map(element => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
    })
  ))
  expect(stageBoxes).toHaveLength(3)
  expect(stageBoxes[1].top).toBeGreaterThanOrEqual(stageBoxes[0].bottom - 1)
  expect(stageBoxes[2].top).toBeGreaterThanOrEqual(stageBoxes[1].bottom - 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('世界引擎可生成并预检本地世界分享包，再导入为新编号副本', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('分享包测试世界')
  await page.getByPlaceholder('一句话描述这个世界或作品').fill('用于本地发布包往返的测试世界。')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()
  await expect(page.getByRole('heading', { name: '世界引擎', exact: true })).toBeVisible()

  await page.getByLabel('作者署名').fill('E2E 作者')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载世界分享包', exact: true }).click()
  const packageDownload = await download
  const packagePath = await packageDownload.path()
  expect(packagePath).not.toBeNull()

  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '选择世界分享包', exact: true }).click()
  await (await fileChooser).setFiles(packagePath!)
  await expect(page.getByTestId('world-package-preview')).toContainText('分享包预检通过')
  await page.getByRole('button', { name: '确认导入为本地副本', exact: true }).click()
  await expect(page.getByRole('heading', { name: '分享包测试世界（导入）', exact: true })).toBeVisible()
  await expect(page.getByText(/社区导入 · W-/)).toBeVisible()
})

async function openSidebarLeaf(page: Page, branchName: string, leafName: string) {
  const leaf = sidebarButton(page, leafName)
  const branch = sidebarButton(page, branchName)
  // 对真实 branch 做一次显式归一：若点击后叶子消失，说明刚才是关闭，再点一次打开。
  // 「创作区」是 section 标题而非按钮，branch.count() 为 0，叶子本身已常驻渲染。
  if (await branch.count() > 0) {
    await branch.click()
    if (await leaf.count() === 0) await branch.click()
  }
  await expect(leaf).toHaveCount(1)
  await leaf.scrollIntoViewIfNeeded()
  await leaf.click()
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

test('领域节点模式可自由建图、运行、刷新恢复并完整清理', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 节点模式')
  await openSidebarLeaf(page, '创作区', '节点模式')
  await expect(page.getByRole('heading', { name: '领域节点创作', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '创建空白节点图', exact: true }).click()

  const flowName = page.getByRole('textbox', { name: '节点图名称' })
  await expect(flowName).toHaveValue('未命名节点图')
  await flowName.fill('E2E 节点分支')
  await page.getByRole('button', { name: /^自由文本/ }).click()
  await page.getByLabel('作者输入').fill('潮汐退去后，第一座城从海床升起。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('节点图已保存。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByText('节点图运行完成，候选已保存。', { exact: true })).toBeVisible()

  await page.goto(page.url(), { waitUntil: 'domcontentloaded' })
  await openSidebarLeaf(page, '创作区', '节点模式')
  await expect(page.getByRole('textbox', { name: '节点图名称' })).toHaveValue('E2E 节点分支')
  await page.getByText('自由文本', { exact: true }).last().click()
  await expect(page.getByLabel('候选输出')).toContainText('潮汐退去后，第一座城从海床升起。')

  await page.getByRole('button', { name: '删除当前节点图', exact: true }).click()
  const confirmDelete = page.locator('div.fixed.inset-0').filter({
    hasText: '删除节点图“E2E 节点分支”？',
  })
  await confirmDelete.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '领域节点创作', exact: true })).toBeVisible()
})

test('领域节点模式空态可直接创建官方模板并自动布局', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E FLOW-3E 官方模板')
  await openSidebarLeaf(page, '创作区', '节点模式')
  await expect(page.getByRole('heading', { name: '领域节点创作', exact: true })).toBeVisible()

  await page.getByRole('button', { name: /基础世界构建/ }).click()
  await expect(page.getByRole('textbox', { name: '节点图名称' })).toHaveValue('基础世界构建')
  await expect(page.locator('[data-authoring-node-template]')).toHaveCount(13)
  await page.getByRole('button', { name: '自动布局', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('节点图已保存。', { exact: true })).toBeVisible()

  await page.reload()
  await openSidebarLeaf(page, '创作区', '节点模式')
  await expect(page.getByRole('textbox', { name: '节点图名称' })).toHaveValue('基础世界构建')
  await expect(page.locator('[data-authoring-node-template]')).toHaveCount(13)
})

test('领域节点模式可创建世界到正文的完整创作链并刷新恢复', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 完整创作链')
  await openSidebarLeaf(page, '创作区', '节点模式')
  await page.getByRole('button', { name: '创建完整创作链', exact: true }).click()

  await expect(page.getByRole('textbox', { name: '节点图名称' })).toHaveValue('完整创作链')
  await expect(page.getByText('所属卷候选 *', { exact: true })).toBeVisible()
  await expect(page.getByText('章节候选 *', { exact: true })).toBeVisible()
  await expect(page.locator('[data-authoring-node-template="control.volume-count"]')).toBeVisible()
  await expect(page.locator('[data-authoring-node-template="control.chapter-count"]')).toBeVisible()
  await expect(page.locator('[data-authoring-node-template="control.word-count"]')).toBeVisible()
  await expect(page.locator('[data-authoring-node-template="chapter.prose"]')).toBeVisible()
  await expect(page.getByText('完整创作链已创建，请按上游到下游逐步运行并确认采纳。', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await openSidebarLeaf(page, '创作区', '节点模式')
  await expect(page.getByRole('textbox', { name: '节点图名称' })).toHaveValue('完整创作链')
  await expect(page.getByText('所属卷候选 *', { exact: true })).toBeVisible()
  await expect(page.getByText('章节候选 *', { exact: true })).toBeVisible()
})

test('领域角色节点可生成候选、人工确认并写入角色主档', async ({ page }) => {
  const dimensions = [
    'identity', 'profile', 'appearance', 'location', 'personality', 'values', 'strengths',
    'weaknesses', 'fears', 'motivation', 'goals', 'innerConflict', 'background', 'keyEvents',
    'abilities', 'powerLevel', 'speechStyle', 'habits', 'signatureItem', 'arc', 'storyRole', 'ending',
  ]
  const candidate = Object.fromEntries([
    ['name', '潮汐测者'], ['roleWeight', 'main'], ['moralAxis', 'good'], ['orderAxis', 'lawful'],
    ['relationships', '与旧城守门人互相扶持。'], ['shortDescription', '能够听见海床回声的测潮者。'],
    ...dimensions.map(key => [key, `候选${key}`]),
  ])
  await page.route('**/chat/completions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(candidate) } }],
        usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
      }),
    })
  })
  await openCleanHome(page)
  await createProject(page, 'E2E 领域角色节点')
  await openSidebarLeaf(page, '创作区', '节点模式')
  await page.getByRole('button', { name: '创建空白节点图', exact: true }).click()
  await page.getByRole('button', { name: /^角色档案/ }).click()
  await page.locator('textarea').last().fill('创建一名能够听见海床回声的主角。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '运行全部', exact: true }).click()
  await expect(page.getByText('节点图运行完成，候选已保存。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('候选输出')).toContainText('潮汐测者')
  await page.getByRole('button', { name: '确认采纳', exact: true }).click()
  await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeVisible()
  await openSidebarLeaf(page, '创作区', '角色生成')
  await expect(page.getByText('潮汐测者', { exact: true })).toBeVisible()
})

test('互动运行时可演进、判定、检查点、分支并刷新恢复', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 互动运行时')
  await openSidebarLeaf(page, '体验中心', '互动运行时')
  await expect(page.getByRole('heading', { name: '互动运行时', exact: true })).toBeVisible()

  await page.getByPlaceholder('新会话名称').fill('雾港沙盒')
  await page.getByLabel('运行时类型').selectOption('ttrpg')
  await page.getByLabel('冻结 世界 E2E 互动运行时', { exact: true }).check()
  await page.getByRole('button', { name: '创建并冻结', exact: true }).click()
  await expect(page.getByRole('heading', { name: '雾港沙盒', exact: true })).toBeVisible()
  await expect(page.getByText('体验中心 · 跑团', { exact: true })).toBeVisible()
  await expect(page.getByText('Canon 冻结审计', { exact: true })).toBeVisible()
  await expect(page.getByText('完整', { exact: true })).toBeVisible()
  await expect(page.getByTestId('ttrpg-combat-panel')).toBeVisible()

  await page.getByLabel('推进时间').fill('6')
  await page.getByRole('button', { name: '推进时间', exact: true }).click()
  await expect(page.getByText('时间 +6', { exact: true })).toBeVisible()
  await page.getByLabel('骰式').fill('2d6+1')
  await page.getByRole('button', { name: '判定', exact: true }).click()
  await expect(page.getByText(/2d6\+1: \[\d+, \d+\] = \d+/)).toBeVisible()
  await page.getByPlaceholder('记录只属于该会话的叙事…').fill('钟楼守卫交出了潮汐密钥。')
  await page.getByRole('button', { name: '追加叙事事件', exact: true }).click()
  await expect(page.getByText('钟楼守卫交出了潮汐密钥。', { exact: true })).toHaveCount(2)

  await page.getByPlaceholder('检查点名称').fill('进入钟楼前')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('进入钟楼前', { exact: true })).toBeVisible()
  await page.getByPlaceholder('新分支名称').fill('拒绝密钥分支')
  await page.getByRole('button', { name: '分支', exact: true }).click()
  await expect(page.getByRole('heading', { name: '拒绝密钥分支', exact: true })).toBeVisible()
  await expect(page.getByText('雾港沙盒', { exact: true })).toBeVisible()

  await page.reload()
  await openSidebarLeaf(page, '体验中心', '互动运行时')
  await expect(page.getByRole('heading', { name: '拒绝密钥分支', exact: true })).toBeVisible()
  await expect(page.getByText('钟楼守卫交出了潮汐密钥。', { exact: true })).toBeVisible()
  await expect(page.getByText('逻辑时间', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '删除会话 拒绝密钥分支', exact: true }).click()
  await expect(page.getByRole('heading', { name: '删除互动会话“拒绝密钥分支”？' })).toBeVisible()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '雾港沙盒', exact: true })).toBeVisible()
})

test('可见资料库精确选择字段，节点冻结权重与实际召回', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E RAG 可见资料')

  await openSidebarLeaf(page, '世界观', '世界起源')
  const originPlaceholder = '创世神话 / 历史时期 / 文明起源……世界从何而来？'
  await page.getByText(originPlaceholder, { exact: true }).last().click()
  await page.getByRole('textbox', { name: originPlaceholder }).fill('潮汐退去后，第一座浮空城从海床升起。')
  await page.getByRole('heading', { name: '🌌 世界来源' }).click()

  await sidebarButton(page, '资料与检索库').click()
  await expect(page.getByRole('heading', { name: '资料与检索库', exact: true })).toBeVisible()
  await page.getByText('世界观主世界观', { exact: true }).click()
  await expect(page.getByText('潮汐退去后，第一座浮空城从海床升起。', { exact: true })).toBeVisible()
  await page.getByRole('spinbutton', { name: '默认权重' }).fill('2.5')
  await expect(page.getByRole('spinbutton', { name: '默认权重' })).toHaveValue('2.5')

  await sidebarButton(page, '节点模式').click()
  await page.getByRole('button', { name: '创建空白节点图', exact: true }).click()
  await page.getByRole('button', { name: /^项目资料/ }).click()
  await page.getByText('项目资料', { exact: true }).last().click()
  await page.getByRole('button', { name: '精确资料', exact: true }).click()
  await page.getByText('世界观 · 主世界观', { exact: true }).click()
  await page.getByRole('button', { name: /^世界来源 \d+ tokens · 本地关键词$/ }).click()
  await expect(page.getByText(/已选 1 项/)).toBeVisible()
  await page.getByRole('button', { name: '运行全部', exact: true }).click()
  await expect(page.getByText('节点图运行完成，候选已保存。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('候选输出')).toContainText('第一座浮空城')

  await page.reload()
  await sidebarButton(page, '资料与检索库').click()
  await expect(page.getByText(/项目资料 · .*纳入 1 \/ 省略 0 \/ 裁剪 0/)).toBeVisible()
})

test('人文知识主入口可保存拆分概述，并安全关联与断开城池地点', async ({ page }) => {
  await openCleanHome(page)
  await createProject(page, 'E2E 世界知识归并')

  await sidebarButton(page, '重要地点').click()
  await expect(page.getByRole('heading', { name: '📍 重要地点' })).toBeVisible()
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await page.locator('input[value="新地点"]').fill('雁门关')
  await page.getByRole('heading', { name: '📍 重要地点' }).click()
  await expect(page.getByText('雁门关', { exact: true })).toBeVisible()

  await sidebarButton(page, '人文环境').click()
  await expect(page.getByRole('heading', { name: '🏛️ 人文环境与社会' })).toBeVisible()
  await expect(page.getByRole('button', { name: /打开正式历史年表/ })).toBeVisible()
  await page.getByRole('button', { name: /打开正式历史年表/ }).click()
  await expect(page.getByRole('heading', { name: '📜 历史年表与时间线' })).toBeVisible()
  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /政治制度/ }).click()
  await page.getByText('政体、官制、法律、军事、外交、权力主体与阶层结构').last().click()
  await page.locator('textarea').last().fill('议政院与六部共同治理')

  await page.getByRole('button', { name: /城池重镇/ }).click()
  await expect(page.getByRole('button', { name: /新建词条/ })).toBeVisible()
  await page.getByRole('button', { name: /新建词条/ }).click()
  await page.getByPlaceholder('名称', { exact: true }).fill('雁门城')
  await page.getByLabel('城池重要地点').selectOption({ label: '雁门关' })
  await expect(page.getByText('地点关联已保存', { exact: true })).toBeVisible()

  await page.reload()
  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /政治制度/ }).click()
  await expect(page.getByText('议政院与六部共同治理', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /城池重镇/ }).click()
  await page.getByText('雁门城', { exact: true }).click()
  await expect(page.getByLabel('城池重要地点')).toHaveValue(/\d+/)

  await sidebarButton(page, '重要地点').click()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await page.getByText('雁门关', { exact: true }).click()
  await page.getByRole('button', { name: '删除地点', exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('雁门关', { exact: true })).toHaveCount(0)

  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /城池重镇/ }).click()
  await page.getByText('雁门城', { exact: true }).click()
  await expect(page.getByLabel('城池重要地点')).toHaveValue('')
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

test('局部改写只读取冻结选区，刷新恢复候选并在作者确认后精确替换正文', async ({ page }) => {
  let selectionEditCalls = 0
  const sourceText = '暮色沉入河谷，旧塔的铜铃忽然响了三声。守门人抬头望向北方，认出了久违的归鸟。'
  const selectedText = '旧塔的铜铃忽然响了三声。'
  const replacementText = '旧塔沉默多年的铜铃骤然连响三声。'
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'selection-edit-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    selectionEditCalls += 1
    const request = route.request().postDataJSON() as { messages?: Array<{ content?: string }> }
    const visiblePrompt = request.messages?.map(message => message.content ?? '').join('\n') ?? ''
    expect(visiblePrompt).toContain(selectedText)
    expect(visiblePrompt).not.toContain('暮色沉入河谷')
    expect(visiblePrompt).not.toContain('守门人抬头望向北方')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: replacementText } }],
        usage: { prompt_tokens: 96, completion_tokens: 22, total_tokens: 118 },
      }),
    })
  })

  await createBookWithSavedChapter(page, 'E2E 局部改写闭环', sourceText)
  const editor = page.locator('.tiptap-editor')
  await editor.evaluate((element, text) => {
    const node = element.querySelector('p')?.firstChild
    if (!node) throw new Error('正文缺少可选文本节点')
    const content = node.textContent ?? ''
    const start = content.indexOf(text)
    if (start < 0) throw new Error('正文缺少目标选区')
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + text.length)
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, selectedText)

  await expect(page.getByRole('button', { name: '改写', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '改写', exact: true }).click()
  await expect(page.getByText('候选尚未写入正文', { exact: true })).toBeVisible()
  await expect(page.getByText(replacementText, { exact: true })).toBeVisible()
  await expect(editor).toContainText(sourceText)
  expect(selectionEditCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '章节').click()
  await expect(page.getByText('候选尚未写入正文', { exact: true })).toBeVisible()
  await expect(page.getByText(replacementText, { exact: true })).toBeVisible()
  await expect(editor).toContainText(sourceText)
  expect(selectionEditCalls).toBe(1)

  await editor.fill(`${sourceText}作者临时补写。`)
  await page.getByRole('button', { name: '确认替换', exact: true }).click()
  await expect(page.getByText('当前编辑器正文已变化，旧候选不会覆盖你的新修改。请保存后重新选择。', { exact: true })).toBeVisible()
  await expect(editor).toContainText('作者临时补写。')
  expect(selectionEditCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '章节').click()
  await expect(page.getByText('候选尚未写入正文', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认替换', exact: true }).click()
  await expect(editor).toContainText(`暮色沉入河谷，${replacementText}守门人抬头望向北方，认出了久违的归鸟。`)
  await expect(editor).not.toContainText(selectedText)
  expect(selectionEditCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '章节').click()
  await expect(editor).toContainText(replacementText)
})

test('整理本章只调用一次模型，刷新恢复候选并在确认后写入故事年表', async ({ page }) => {
  let organizationCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'chapter-organization-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    organizationCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              stateDiffs: [],
              facts: [],
              inventoryEvents: [],
              storyEvents: [{
                title: '旧城门开启',
                storyTime: '',
                importance: 2,
                description: '林舟打开了封闭已久的旧城门。',
                sourceQuote: '林舟推开旧城门。',
              }],
              relations: [],
              foreshadowUpdates: [],
            }),
          },
        }],
        usage: { prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 },
      }),
    })
  })

  await createBookWithSavedChapter(
    page,
    'E2E 整理本章确认闭环',
    '林舟推开旧城门。风从封闭已久的街道深处涌来。',
  )
  await page.getByRole('button', { name: '整理本章', exact: true }).click()

  const modal = page.locator('div.fixed.inset-0').filter({ hasText: '整理本章 · 第1章' })
  await expect(modal.getByRole('heading', { name: '整理本章 · 第1章', exact: true })).toBeVisible()
  await expect(modal.getByText('故事年表', { exact: true })).toBeVisible()
  await expect(modal.getByText('旧城门开启 · 重要度 2', { exact: true })).toBeVisible()
  await expect(modal.getByText('证据：“林舟推开旧城门。”', { exact: true })).toBeVisible()
  await expect(modal.getByText('1 / 7 次模型调用', { exact: true })).toBeVisible()
  expect(organizationCalls).toBe(1)

  await modal.getByRole('button', { name: '关闭整理本章', exact: true }).click()
  await openSidebarLeaf(page, '创作区', '故事年表')
  await expect(page.getByText('还没有故事年表', { exact: true })).toBeVisible()

  await page.reload()
  await sidebarButton(page, '章节').click()
  await page.getByRole('button', { name: '查看整理结果', exact: true }).click()
  await expect(modal.getByText('旧城门开启 · 重要度 2', { exact: true })).toBeVisible()
  expect(organizationCalls).toBe(1)

  await modal.getByRole('button', { name: '确认写入所选（1）', exact: true }).click()
  await expect(modal.getByText('已写入', { exact: true })).toHaveCount(1)
  await modal.getByRole('button', { name: '关闭整理本章', exact: true }).click()
  await openSidebarLeaf(page, '创作区', '故事年表')
  await expect(page.locator('input[value="旧城门开启"]')).toBeVisible()
  await expect(page.getByText('林舟打开了封闭已久的旧城门。', { exact: true })).toBeVisible()
  expect(organizationCalls).toBe(1)
})

test('一致性 Agent 显式单次检测，刷新恢复只读报告且不写业务产物', async ({ page }) => {
  let consistencyCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'consistency-agent-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    consistencyCalls += 1
    const content = JSON.stringify({
      findings: [],
      cognitionReferences: [],
      lifecycleReferences: [],
    })
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        `data: ${JSON.stringify({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 150, completion_tokens: 20, total_tokens: 170 },
        })}`,
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })

  await createBookWithSavedChapter(
    page,
    'E2E 一致性 Agent 只读闭环',
    '林舟取出一直随身携带的潮汐钥匙，确认门上的月纹仍未熄灭。',
  )
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  const review = page.locator('main').getByText('一致性', { exact: true }).last()
  await review.click()
  await page.getByRole('button', { name: '开始检测', exact: true }).click()

  await expect(page.getByText('当前正文报告 · Fast Guard', { exact: false })).toBeVisible()
  await expect(page.getByText('1/7 次模型调用', { exact: false })).toBeVisible()
  await expect(page.getByText('未发现有证据支持的一致性问题。', { exact: true })).toBeVisible()
  expect(consistencyCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '章节').click()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.locator('main').getByText('一致性', { exact: true }).last().click()
  await expect(page.getByText('当前正文报告 · Fast Guard', { exact: false })).toBeVisible()
  await expect(page.getByText('未发现有证据支持的一致性问题。', { exact: true })).toBeVisible()
  expect(consistencyCalls).toBe(1)

  await openSidebarLeaf(page, '创作区', '故事年表')
  await expect(page.getByText('还没有故事年表', { exact: true })).toBeVisible()
})

test('智能实体改名先预览，再原子同步正文与角色主档并可撤销', async ({ page }) => {
  await createBookWithSavedChapter(
    page,
    'E2E 智能实体改名',
    '顾临川踏入山门。顾临川望见远处灯火。',
  )

  await sidebarButton(page, '角色生成').click()
  await page.getByRole('button', { name: '新建角色', exact: true }).click()
  await page.getByRole('button', { name: '主要', exact: true }).click()
  await page.getByRole('button', { name: '绝对中立', exact: true }).click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()
  await page.locator('div.cursor-text.text-2xl').click()
  await page.locator('input.text-2xl').fill('顾临川')
  await page.locator('input.text-2xl').press('Enter')
  await expect(page.locator('div.cursor-text.text-2xl')).toHaveText('顾临川')

  await sidebarButton(page, '章节').click()
  await page.getByRole('button', { name: '查找替换', exact: true }).click()
  await page.getByRole('button', { name: '智能实体改名', exact: true }).click()
  await page.getByRole('combobox', { name: '选择稳定实体' }).selectOption({
    label: '角色 · 顾临川（角色 · 主世界/未分组）',
  })
  await page.getByRole('textbox', { name: '新名称' }).fill('沈照野')
  await page.getByRole('button', { name: '预览影响范围', exact: true }).click()

  await expect(page.getByText('未发现名称归属冲突，可按本预览安全执行。')).toBeVisible()
  await expect(page.getByText('2 处 / 1 章', { exact: true })).toBeVisible()
  await expect(page.getByText('角色主档 · 1 条', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '创建快照并改名', exact: true }).click()
  const confirmRename = page.locator('div.fixed.inset-0').filter({ hasText: '确认将「顾临川」改为「沈照野」？' })
  await confirmRename.getByRole('button', { name: '创建快照并改名', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText('沈照野踏入山门。沈照野望见远处灯火。')
  await expect(page.getByRole('combobox', { name: '选择稳定实体' }).locator('option')).toContainText([
    '选择角色、地点或词条',
    '角色 · 沈照野（角色 · 主世界/未分组）',
  ])

  await page.getByRole('button', { name: '撤销上次实体改名', exact: true }).click()
  const confirmUndo = page.locator('div.fixed.inset-0').filter({ hasText: '撤销上次实体改名？' })
  await confirmUndo.getByRole('button', { name: '原子撤销', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText('顾临川踏入山门。顾临川望见远处灯火。')
  await expect(page.getByRole('combobox', { name: '选择稳定实体' }).locator('option')).toContainText([
    '选择角色、地点或词条',
    '角色 · 顾临川（角色 · 主世界/未分组）',
  ])
})

test('对照润色沉淀有界样本，并完成文风画像与互动校准闭环', async ({ page }) => {
  let styleLearningCalls = 0
  let calibrationCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'style-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const system = body.messages?.find(message => message.role === 'system')?.content ?? ''
    const isCalibration = system.includes('克制的文学改稿助手')
    if (isCalibration) calibrationCalls++
    else {
      styleLearningCalls++
      const combined = body.messages?.map(message => message.content).join('\n') ?? ''
      expect(combined).toContain('【文风学习正式输入基线】')
      expect(combined).toContain('他非常快速地跑过长街')
      expect(combined).toContain('HARNESS-76 严格输出协议')
    }
    const content = isCalibration
      ? '他掠过长街，雨声在身后收紧。'
      : '## 用词习惯\n- 偏爱克制动词和具体名词，避免抽象评价。\n## 句式与节奏\n- 以短句推进，在关键动作后断句留白。\n## 对话风格\n- 对话稀疏，用动作承接而不解释情绪。\n## 描写与画面\n- 以感官细节带出环境，不堆叠形容词。\n## 标志性表达\n- 转折处用克制动作收束，不追加总结句。\n## 倾向与禁忌\n- 避免冗余副词、情绪直说与全知式解释。'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      }),
    })
  })

  await createBookWithSavedChapter(
    page,
    'E2E 文风高级校准',
    '他非常快速地跑过长街，雨水不断落在他的肩上。',
  )
  await page.getByLabel('章节状态').selectOption('polished')
  await page.getByRole('button', { name: '对照润色', exact: true }).click()
  await expect(page.getByRole('region', { name: '对照润色' })).toBeVisible()
  await page.locator('.tiptap-editor').last().fill('他掠过长街，雨水敲肩。')
  await page.getByRole('button', { name: '创建快照并保存', exact: true }).click()
  await expect(page.getByRole('region', { name: '对照润色' })).toHaveCount(0)

  await sidebarButton(page, '文风学习').click()
  await expect(page.getByRole('heading', { name: '文风学习', exact: true })).toBeVisible()
  await expect(page.getByText('已保存 1 / 8 组', { exact: false })).toBeVisible()
  await expect(page.getByText('他非常快速地跑过长街', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '一键学习我的文风', exact: true }).click()
  await expect(page.getByRole('heading', { name: '待确认文风画像', exact: true })).toBeVisible()
  await expect(page.getByLabel('待确认文风画像')).toHaveValue(/偏爱克制动词/)
  expect(styleLearningCalls).toBe(1)

  const beforeConfirmation = await page.evaluate(async () => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const profiles = await request(database.transaction('userStyleProfiles').objectStore('userStyleProfiles').getAll()) as Array<{ profile: string; enabled: boolean }>
    const runs = await request(database.transaction('agentRuns').objectStore('agentRuns').getAll()) as Array<{ status: string; contractJson: string }>
    database.close()
    return { profiles, runs: runs.filter(run => run.contractJson.includes('prose.style-learn')) }
  })
  expect(beforeConfirmation.profiles).toEqual([expect.objectContaining({ profile: '', enabled: false })])
  expect(beforeConfirmation.runs).toEqual([expect.objectContaining({ status: 'awaiting_confirmation' })])

  await page.reload()
  await sidebarButton(page, '文风学习').click()
  await expect(page.getByText('已恢复待确认文风候选；没有重复调用模型。', { exact: true })).toBeVisible()
  await expect(page.getByLabel('待确认文风画像')).toHaveValue(/偏爱克制动词/)
  expect(styleLearningCalls).toBe(1)
  await page.getByRole('button', { name: '确认采用画像', exact: true }).click()
  await expect(page.getByText('我的文风画像', { exact: true })).toBeVisible()
  await expect(page.locator('textarea[placeholder*="文风画像"]')).toHaveValue(/偏爱克制动词/)
  await expect(page.getByRole('button', { name: /注入中/ })).toBeVisible()

  const runCountBeforeCalibration = await page.evaluate(async () => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const count = await request(database.transaction('agentRuns').objectStore('agentRuns').count())
    database.close()
    return count
  })

  await page.getByPlaceholder('粘贴一段待校准短文（最多 1600 字符）')
    .fill('他很快地跑过长街，身后是连绵的雨。')
  await page.getByRole('button', { name: '生成校准稿', exact: true }).click()
  const result = page.locator('#style-calibration-result')
  await expect(result).toHaveValue('他掠过长街，雨声在身后收紧。')
  expect(calibrationCalls).toBe(1)
  expect(await page.evaluate(async () => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const count = await request(database.transaction('agentRuns').objectStore('agentRuns').count())
    database.close()
    return count
  })).toBe(runCountBeforeCalibration)
  await result.fill('他掠过长街，雨声在身后收紧。')
  await page.getByPlaceholder('可选：具体哪里像 / 哪里还不对').fill('动作更克制，收束更干净')
  await page.getByRole('button', { name: '接近我的风格', exact: true }).click()
  await page.getByRole('button', { name: '保存为改稿样本', exact: true }).click()
  await expect(page.getByText('已保存 2 / 8 组', { exact: false })).toBeVisible()

  await page.reload()
  await sidebarButton(page, '文风学习').click()
  await expect(page.getByText('已保存 2 / 8 组', { exact: false })).toBeVisible()
  await expect(page.locator('textarea[placeholder*="文风画像"]')).toHaveValue(/偏爱克制动词/)
  expect(styleLearningCalls).toBe(1)
  expect(calibrationCalls).toBe(1)
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

test('上下文窗口、四类通用任务与主 Agent 角色模型路由跨模块和刷新保留', async ({ page }) => {
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
  await page.getByLabel('主 Agent 编排模型预设').selectOption({ label: '审查模型 · deepseek/deepseek-review' })
  await page.getByLabel('正文领域 Agent模型预设').selectOption({ label: '创作模型 · deepseek/deepseek-chat' })
  await page.getByLabel('正文领域 Agent上下文输入档位').selectOption('lean')
  await page.getByLabel('主 Agent 团队总预算').selectOption('economy')

  await page.reload()
  await sidebarButton(page, '设置').click()
  await expectNumericInputValue(contextWindow, 2_100_000)
  await expect(page.getByLabel('创作生成模型预设')).toHaveValue(await page.getByLabel('结构提取模型预设').inputValue())
  await expect(page.getByLabel('分析总结模型预设')).toHaveValue(await page.getByLabel('审查校验模型预设').inputValue())
  await expect(page.getByLabel('主 Agent 编排模型预设')).toHaveValue(await page.getByLabel('审查校验模型预设').inputValue())
  await expect(page.getByLabel('正文领域 Agent模型预设')).toHaveValue(await page.getByLabel('创作生成模型预设').inputValue())
  await expect(page.getByLabel('正文领域 Agent上下文输入档位')).toHaveValue('lean')
  await expect(page.getByLabel('主 Agent 团队总预算')).toHaveValue('economy')
  await expect(page.getByLabel('创作生成模型预设').locator('option:checked')).toContainText('创作模型')
  await expect(page.getByLabel('分析总结模型预设').locator('option:checked')).toContainText('审查模型')
  await expect(page.getByLabel('正文领域 Agent模型预设').locator('option:checked')).toContainText('创作模型')
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

test('主 Agent 调度世界领域任务，拒绝零写入并精确采纳可见编辑', async ({ page }) => {
  let generationCalls = 0
  const firstCandidate = {
    field: 'worldOrigin',
    value: '模型候选一：潮汐退去后，最初的陆地显露。',
  }
  const secondCandidate = {
    field: 'worldOrigin',
    value: '模型候选二：群星坠落后，文明在灯塔旁诞生。',
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'chat-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    if (!isPlanner) generationCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isPlanner
              ? JSON.stringify({
                  summary: '交给世界来源 Agent。',
                  tasks: [{
                    id: 'world-1',
                    agentId: 'world-origin',
                    instruction: '生成世界来源',
                    dependsOn: [],
                  }],
                })
              : generationCalls === 1
                ? JSON.stringify({ field: 'powerHierarchy', value: '错投到力量体系的候选。' })
                : generationCalls === 2
                ? JSON.stringify(firstCandidate)
                : JSON.stringify(secondCandidate),
          },
        }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 对话副驾确认闭环')
  await page.getByRole('button', { name: '打开 AI 对话副驾' }).click()
  const copilot = page.getByRole('complementary', { name: '主 Agent 创作副驾' })
  const request = copilot.getByRole('textbox', { name: '告诉主 Agent 你的目标' })
  const candidate = copilot.getByRole('textbox', { name: '世界来源候选内容' })

  await request.fill('生成一段世界来源，包含文明起点')
  await copilot.getByRole('button', { name: '交给主 Agent', exact: true }).click()
  await expect(candidate).toContainText(firstCandidate.value)
  await expect(copilot.getByText(/均衡 · ≈[\d,]+ tokens/)).toBeVisible()
  await expect(copilot.getByText(/查看本次实际输入证据 · \d+ 个来源/)).toBeVisible()
  await expect(copilot.getByText(/本轮团队预算约 [\d,]+ \/ 160,000 tokens · 2\/7 次调用 · Canon 打回 1\/1/)).toBeVisible()

  await openSidebarLeaf(page, '世界观', '世界起源')
  await expect(page.locator('main').getByText(firstCandidate.value, { exact: true }))
    .toHaveCount(0)
  await copilot.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(copilot.getByText('候选已拒绝，没有写入项目。', { exact: true }).last()).toBeVisible()

  await request.fill('重新生成一段世界来源')
  await copilot.getByRole('button', { name: '交给主 Agent', exact: true }).click()
  await expect(candidate).toContainText(secondCandidate.value)
  const edited = {
    ...secondCandidate,
    value: '作者确认版：星潮退去后，观潮者点燃第一座灯塔，并以此作为文明纪元的起点。',
  }
  await candidate.fill(JSON.stringify(edited, null, 2))
  await copilot.getByRole('button', { name: '采纳', exact: true }).click()

  await expect(copilot.getByText('世界基座“世界来源”已写入当前世界。', { exact: true }).last())
    .toBeVisible()
  await expect(page.locator('main').getByText(edited.value, { exact: true })).toBeVisible()
  expect(generationCalls).toBe(3)
})

test('故事核心面板通过主 Agent 生成单字段候选，刷新恢复后编辑采纳并持久化', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = {
    field: 'logline',
    value: '守灯人为找回父亲遗失的记忆追查潮汐钟，却发现整座港城依靠遗忘维持秩序。',
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'story-core-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    if (!isPlanner) {
      generationCalls += 1
      expect(combined).toContain('story-core Skill')
      expect(combined).toContain('目标字段是 logline')
      expect(combined).toContain('E2E 故事核心 Harness 闭环')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isPlanner
              ? JSON.stringify({
                  summary: '交给世界基座 Agent 的故事核心 Skill。',
                  tasks: [{
                    id: 'story-core-1',
                    agentId: 'world-origin',
                    skillId: 'world-origin.story-core',
                    instruction: '生成故事核心字段。目标字段=logline；生成模式=expand。',
                    dependsOn: [],
                  }],
                })
              : JSON.stringify(modelCandidate),
          },
        }],
        usage: { prompt_tokens: 180, completion_tokens: 50, total_tokens: 230 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 故事核心 Harness 闭环')
  await openSidebarLeaf(page, '设定库', '故事设计')
  await expect(page.getByRole('heading', { name: /一句话故事/ })).toBeVisible()

  await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
  const candidate = page.getByRole('textbox', { name: '一句话故事候选内容' })
  await expect(candidate).toContainText(modelCandidate.value)
  await expect(page.getByText('点击填写一句话故事…', { exact: true })).toBeVisible()
  await expect(page.getByText('本次实际输入证据', { exact: true })).toBeVisible()

  await page.reload()
  await openSidebarLeaf(page, '设定库', '故事设计')
  await expect(candidate).toContainText(modelCandidate.value)
  await expect(page.getByText('点击填写一句话故事…', { exact: true })).toBeVisible()

  const edited = {
    ...modelCandidate,
    value: '作者确认版：守灯人为找回父亲主动典当的记忆追查潮汐钟，并拒绝让港城继续以遗忘换取安稳。',
  }
  await candidate.fill(JSON.stringify(edited, null, 2))
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText(edited.value, { exact: true })).toBeVisible()
  await expect(candidate).toHaveCount(0)
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '设定库', '故事设计')
  await expect(page.getByText(edited.value, { exact: true })).toBeVisible()
  await expect(candidate).toHaveCount(0)
})

test('创作规则建议通过固定 Skill 刷新恢复，拒绝重生后编辑确认并写入规范字段', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = {
    field: 'writingStyle',
    value: '采用克制的第三人称限知，多写动作与物件细节，避免全知解释人物动机。',
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'creative-rules-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    generationCalls += 1
    expect(combined).toContain('创作规则候选硬约束')
    expect(combined).toContain('目标字段是 writingStyle')
    expect(combined).toContain('E2E 创作规则 Harness 闭环')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelCandidate) } }],
        usage: { prompt_tokens: 160, completion_tokens: 45, total_tokens: 205 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 创作规则 Harness 闭环')
  await openSidebarLeaf(page, '创作区', '创作规则')
  await expect(page.getByRole('heading', { name: /创作规则/ })).toBeVisible()

  const writingStyle = page.getByPlaceholder(/描述期望的写作风格/)
  await page.getByRole('button', { name: 'AI 建议', exact: true }).first().click()
  const candidate = page.getByRole('textbox', { name: '写作风格候选内容' })
  await expect(candidate).toHaveValue(modelCandidate.value)
  await expect(writingStyle).toHaveValue('')
  await expect(page.getByText('本次实际输入证据', { exact: true })).toBeVisible()

  await page.reload()
  await openSidebarLeaf(page, '创作区', '创作规则')
  await expect(candidate).toHaveValue(modelCandidate.value)
  await expect(writingStyle).toHaveValue('')
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  expect(generationCalls).toBe(1)

  await page.getByRole('button', { name: 'AI 建议', exact: true }).first().click()
  const edited = '作者确认：用克制短句和可见动作呈现压力，只写视角人物能够感知的信息。'
  await candidate.fill(edited)
  await page.getByRole('button', { name: '确认写入', exact: true }).click()
  await expect(writingStyle).toHaveValue(edited)
  await expect(candidate).toHaveCount(0)
  expect(generationCalls).toBe(2)

  const atmosphere = page.getByPlaceholder(/描述作品的整体基调和氛围/)
  await atmosphere.fill('冷峻但不绝望，危险之后必须保留可行动的希望。')
  await atmosphere.blur()
  await page.reload()
  await openSidebarLeaf(page, '创作区', '创作规则')
  await expect(writingStyle).toHaveValue(edited)
  await expect(atmosphere).toHaveValue('冷峻但不绝望，危险之后必须保留可行动的希望。')
  await expect(candidate).toHaveCount(0)
})

test('神明与信仰面板一次生成结构化候选，刷新恢复后采纳并持久化', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = {
    field: 'divineDesign',
    value: {
      hasDivinity: true,
      divineRank: '潮母之下设三位守潮神。',
      divineNames: '潮母掌记忆，盐灯神掌见证。',
      divineRules: '神明不得取走未被自愿典当的记忆。',
    },
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'worldview-field-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    if (!isPlanner) {
      generationCalls += 1
      expect(combined).toContain('worldview-field Skill')
      expect(combined).toContain('目标字段是 divineDesign')
      expect(combined).toContain('E2E 世界基座 Harness 闭环')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isPlanner
              ? JSON.stringify({
                  summary: '交给世界基座 Agent 的字段 Skill。',
                  tasks: [{
                    id: 'worldview-field-1',
                    agentId: 'world-origin',
                    skillId: 'world-origin.worldview-field',
                    instruction: '生成世界基座字段。目标字段=divineDesign；生成模式=expand。',
                    dependsOn: [],
                  }],
                })
              : JSON.stringify(modelCandidate),
          },
        }],
        usage: { prompt_tokens: 190, completion_tokens: 70, total_tokens: 260 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 世界基座 Harness 闭环')
  await openSidebarLeaf(page, '世界观', '世界起源')
  await page.getByRole('button', { name: '神明与信仰', exact: true }).click()

  await page.getByRole('button', { name: 'AI 生成信仰体系', exact: true }).click()
  const candidate = page.getByRole('textbox', { name: '神明与信仰候选内容' })
  await expect(candidate).toContainText(modelCandidate.value.divineRules)
  await expect(page.getByText('本次实际输入证据', { exact: true })).toBeVisible()
  await expect(page.getByText('存在神明或宗教信仰', { exact: true })).toBeVisible()

  await page.reload()
  await openSidebarLeaf(page, '世界观', '世界起源')
  await expect(candidate).toContainText(modelCandidate.value.divineNames)
  await expect(page.getByRole('button', { name: '神明与信仰', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const edited = {
    ...modelCandidate,
    value: {
      ...modelCandidate.value,
      divineRules: '作者确认版：神谕必须由两名无血缘见证者共同记录。',
    },
  }
  await candidate.fill(JSON.stringify(edited, null, 2))
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText(edited.value.divineRules, { exact: true })).toBeVisible()
  await expect(candidate).toHaveCount(0)
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '世界观', '世界起源')
  await page.getByRole('button', { name: '神明与信仰', exact: true }).click()
  await expect(page.getByText(edited.value.divineRules, { exact: true })).toBeVisible()
  await expect(candidate).toHaveCount(0)
})

test('灵感反推主面板通过定向 durable Skill 生成、恢复、拒绝并确认版本', async ({ page }) => {
  let generationCalls = 0
  const modelResult = {
    worldview: {
      worldOrigin: '模型版：盐海退潮后，灯塔城从海床升起。',
      powerHierarchy: '',
      continentLayout: '',
      climateByRegion: '',
      historyLine: '',
      races: '',
      factionLayout: '',
    },
    storyCore: {
      logline: '守灯人必须在下一次海啸前找回失踪的潮汐钟。',
      theme: '记忆与守护',
      centralConflict: '',
      plotPattern: '',
      mainPlot: '',
    },
    characters: [],
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'inspiration-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).not.toContain('你只把用户目标拆成幕后领域任务')
    generationCalls += 1
    expect(combined).toContain('退潮后城市从海床升起')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify(modelResult),
          },
        }],
        usage: { prompt_tokens: 140, completion_tokens: 60, total_tokens: 200 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 灵感副驾确认闭环')
  await sidebarButton(page, '灵感反推').click()
  await page.getByPlaceholder(/随便写点什么/).fill('退潮后城市从海床升起，守灯人听见潮汐钟。')
  await page.getByPlaceholder('碎片标题（可选）').fill('潮汐灯塔')
  await page.getByRole('button', { name: /加入素材库/ }).click()
  await expect(page.getByText('潮汐灯塔', { exact: true })).toBeVisible()
  await expect(page.getByText('0 个已确认版本', { exact: true })).toBeVisible()

  await page.getByPlaceholder('例如：偏黑暗风格、需要感情线、主角要有反转...').fill('强化灯塔意象和守灯人的核心冲突')
  await page.getByRole('button', { name: '开始反推', exact: true }).click()
  const candidate = page.getByRole('textbox', { name: '灵感反推候选内容' })
  await expect(candidate).toContainText('模型版：盐海退潮后')

  await page.reload()
  await sidebarButton(page, '灵感反推').click()
  await expect(candidate).toContainText('模型版：盐海退潮后')
  await page.getByRole('button', { name: '放弃本次结果', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await expect(page.getByText('0 个已确认版本', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '开始反推', exact: true }).click()
  await expect(candidate).toContainText('模型版：盐海退潮后')
  const edited = {
    ...modelResult,
    worldview: {
      ...modelResult.worldview,
      worldOrigin: '作者确认版：盐海退潮后，第一座灯塔城从海床升起。',
    },
  }
  await candidate.fill(JSON.stringify(edited, null, 2))
  await page.getByRole('button', { name: '确认融合版本', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await expect(page.getByText('1 个已确认版本', { exact: true })).toBeVisible()

  await openSidebarLeaf(page, '世界观', '世界起源')
  await expect(page.locator('main').getByText(edited.worldview.worldOrigin, { exact: true }))
    .toHaveCount(0)
  expect(generationCalls).toBe(2)
})

test('分步骤角色面板通过 character.create Skill 生成、恢复并确认角色候选', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = {
    name: '模型守灯人',
    roleWeight: 'secondary',
    moralAxis: 'good',
    orderAxis: 'lawful',
    relationships: '',
    shortDescription: '守护旧港灯塔的年轻钟匠。',
    personality: '克制谨慎，不轻易许诺。',
    background: '出身旧港钟匠世家。',
    motivation: '修复失踪的潮汐钟。',
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'character-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    if (!isPlanner) {
      generationCalls += 1
      expect(combined).toContain('E2E 角色副驾确认闭环')
      expect(combined).toContain('"roleWeight": "main | secondary | npc | extra"')
      expect(combined).toContain('设计一名守灯钟匠')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isPlanner
              ? JSON.stringify({
                  summary: '交给角色领域 Agent。',
                  tasks: [{
                    id: 'character-1',
                    agentId: 'character',
                    instruction: '设计一名守灯钟匠',
                    dependsOn: [],
                  }],
                })
              : JSON.stringify(modelCandidate),
          },
        }],
        usage: { prompt_tokens: 180, completion_tokens: 70, total_tokens: 250 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 角色副驾确认闭环')
  await openSidebarLeaf(page, '角色设计', '角色生成')
  await expect(page.getByText('角色生成 · 0', { exact: true })).toBeVisible()

  const request = page.getByPlaceholder('角色要求（可选）')
  const candidate = page.getByRole('textbox', { name: '角色候选内容' })
  await request.fill('设计一名守灯钟匠，克制寡言')
  await page.getByRole('button', { name: 'AI 设计角色', exact: true }).click()
  await expect(candidate).toContainText('模型守灯人')
  await page.reload()
  await openSidebarLeaf(page, '角色设计', '角色生成')
  await expect(candidate).toContainText('模型守灯人')
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(page.getByText('角色生成 · 0', { exact: true })).toBeVisible()

  await request.fill('重新设计一名守灯钟匠')
  await page.getByRole('button', { name: 'AI 设计角色', exact: true }).click()
  await expect(candidate).toContainText('模型守灯人')
  const edited = {
    ...modelCandidate,
    name: '沈砚灯',
    shortDescription: '作者确认的旧港守灯钟匠。',
  }
  await candidate.fill(JSON.stringify(edited, null, 2))
  await page.getByRole('button', { name: '采纳', exact: true }).click()

  await expect(page.getByText('角色生成 · 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /沈砚灯.*作者确认的旧港守灯钟/ })).toBeVisible()
  expect(generationCalls).toBe(2)
})

test('已有角色补全通过定向 Skill 恢复候选，确认后只写入所选字段', async ({ page }) => {
  let characterCalls = 0
  let supplementCalls = 0
  const modelCharacter = {
    name: '模型守灯人',
    roleWeight: 'secondary',
    moralAxis: 'good',
    orderAxis: 'lawful',
    relationships: '',
    shortDescription: '守护旧港灯塔的年轻钟匠。',
    personality: '',
    background: '出身旧港钟匠世家。',
    motivation: '修复失踪的潮汐钟。',
  }
  const supplementCandidate = {
    version: 1,
    patch: {
      personality: '克制谨慎，会先核对每一次潮声再行动。',
      goals: '短期找回潮汐钟，长期重建旧港的报时秩序。',
    },
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'character-supplement-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    const isSupplement = combined.includes('只允许补全的字段')
    let content: string
    if (isPlanner) {
      content = JSON.stringify({
        summary: '交给角色领域 Agent。',
        tasks: [{
          id: 'character-1',
          agentId: 'character',
          instruction: '设计一名守灯钟匠',
          dependsOn: [],
        }],
      })
    } else if (isSupplement) {
      supplementCalls += 1
      expect(combined).toContain('【本次目标角色】模型守灯人')
      expect(combined).toContain('personality（性格）')
      expect(combined).toContain('goals（目标(短/长期)）')
      expect(combined).toContain('已启用反向哺喂')
      content = JSON.stringify(supplementCandidate)
    } else {
      characterCalls += 1
      content = JSON.stringify(modelCharacter)
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 180, completion_tokens: 70, total_tokens: 250 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 已有角色补全闭环')
  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByPlaceholder('角色要求（可选）').fill('设计一名守灯钟匠')
  await page.getByRole('button', { name: 'AI 设计角色', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '角色候选内容' })).toContainText('模型守灯人')
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText('角色生成 · 1', { exact: true })).toBeVisible()

  await page.getByTitle(/AI 补全设定/).click()
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await page.getByLabel('性格', { exact: true }).check()
  await page.getByLabel('目标(短/长期)', { exact: true }).check()
  await page.getByLabel('结合剧情已写内容', { exact: false }).check()
  await page.getByRole('button', { name: '生成 2 个字段候选', exact: true }).click()
  await expect(page.getByRole('region', { name: '角色补全候选' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '补全候选-性格' }))
    .toHaveValue(supplementCandidate.patch.personality)
  await expect(page.getByPlaceholder('性格…')).toHaveValue('')

  await page.reload()
  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByRole('button', { name: /模型守灯人.*守护旧港灯塔/ }).click()
  await expect(page.getByPlaceholder('性格…')).toHaveValue('')
  await page.getByTitle(/AI 补全设定/).click()
  await expect(page.getByRole('textbox', { name: '补全候选-目标(短/长期)' }))
    .toHaveValue(supplementCandidate.patch.goals)
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(page.getByRole('region', { name: '角色补全候选' })).toHaveCount(0)
  expect(supplementCalls).toBe(1)

  await page.getByRole('button', { name: '生成 2 个字段候选', exact: true }).click()
  const editedPersonality = '作者确认：克制但并不冷漠，会在钟声失准时主动求助。'
  await page.getByRole('textbox', { name: '补全候选-性格' }).fill(editedPersonality)
  await page.getByRole('button', { name: '确认写入', exact: true }).click()

  await expect(page.getByPlaceholder('性格…')).toHaveValue(editedPersonality)
  await expect(page.getByPlaceholder('目标(短/长期)…')).toHaveValue(supplementCandidate.patch.goals)
  await expect(page.getByPlaceholder('背景故事…')).toHaveValue(modelCharacter.background)
  expect(characterCalls).toBe(1)
  expect(supplementCalls).toBe(2)
})

test('主 Agent 调度大纲领域任务，确认可见整批候选后同步到正式大纲', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = [
    { title: '第一卷：退潮', summary: '守灯人发现从海床升起的浮空城。' },
    { title: '第二卷：涨潮', summary: '旧港被海潮包围，潮汐钟的代价公开。' },
  ]
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'outline-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    if (!isPlanner) {
      generationCalls += 1
      expect(combined).toContain('E2E 大纲副驾确认闭环')
      expect(combined).toContain('规划全书两卷卷纲')
      expect(combined).toContain('请严格输出 JSON')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isPlanner
              ? JSON.stringify({
                  summary: '交给大纲领域 Agent。',
                  tasks: [{
                    id: 'outline-1',
                    agentId: 'outline',
                    instruction: '规划全书两卷卷纲',
                    dependsOn: [],
                  }],
                })
              : JSON.stringify(modelCandidate),
          },
        }],
        usage: { prompt_tokens: 220, completion_tokens: 80, total_tokens: 300 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 大纲副驾确认闭环')
  await page.getByRole('button', { name: '大纲', exact: true }).click()

  await page.getByRole('button', { name: '打开 AI 对话副驾' }).click()
  const copilot = page.getByRole('complementary', { name: '主 Agent 创作副驾' })
  const request = copilot.getByRole('textbox', { name: '告诉主 Agent 你的目标' })
  const candidate = copilot.getByRole('textbox', { name: '卷级大纲候选内容' })

  await request.fill('规划全书两卷卷纲')
  await copilot.getByRole('button', { name: '交给主 Agent', exact: true }).click()
  await expect(candidate).toContainText('第一卷：退潮')
  await copilot.getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(page.locator('main').getByText('第一卷：退潮', { exact: true })).toHaveCount(0)

  await request.fill('重新规划全书两卷卷纲')
  await copilot.getByRole('button', { name: '交给主 Agent', exact: true }).click()
  const edited = [
    { ...modelCandidate[0], summary: '作者确认版：守灯人发现从海床升起的浮空城。' },
    modelCandidate[1],
  ]
  await candidate.fill(JSON.stringify(edited, null, 2))
  await copilot.getByRole('button', { name: '采纳', exact: true }).click()

  await expect(copilot.getByText('卷级大纲已写入项目。', { exact: true }).last()).toBeVisible()
  await expect(page.locator('main').getByText('第一卷：退潮', { exact: true }).first()).toBeVisible()
  await expect(page.locator('main').getByText('第二卷：涨潮', { exact: true }).first()).toBeVisible()
  expect(generationCalls).toBe(2)
})

test('故事线面板通过主 Agent 生成 durable 候选，确认后才写入并可刷新恢复', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = [{
    name: '潮汐钟主线',
    type: 'main',
    description: '守灯人追查潮汐钟，并在城市存续与共同记忆之间作出选择。',
    stages: [
      {
        title: '退潮启程',
        description: '浮空城出现，守灯人从前辈遗物中发现钟声线索。',
        keyEvents: ['浮空城升起', '前辈遗物暴露密令'],
      },
      {
        title: '钟塔裂痕',
        description: '各方争夺潮汐钟，主角确认钟声会改写全城记忆。',
        keyEvents: ['势力争夺钟塔', '主角确认钟声代价'],
        turningPoint: '主角发现前辈正是上一次敲钟者。',
      },
      {
        title: '涨潮抉择',
        description: '海潮吞没旧港，主角公开真相并改变潮汐钟的用途。',
        keyEvents: ['旧港撤离', '主角公开真相'],
      },
    ],
  }]
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'story-arc-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    if (!isPlanner) {
      generationCalls += 1
      expect(combined).toContain('story-arcs Skill')
      expect(combined).toContain('E2E 故事线 Harness 闭环')
      expect(combined).toContain('生成一条主线故事线')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isPlanner
              ? JSON.stringify({
                  summary: '交给故事线编排 Skill。',
                  tasks: [{
                    id: 'story-arcs-1',
                    agentId: 'outline',
                    skillId: 'outline.story-arcs',
                    instruction: '依据当前作品生成一条主线故事线',
                    dependsOn: [],
                  }],
                })
              : JSON.stringify(modelCandidate),
          },
        }],
        usage: { prompt_tokens: 240, completion_tokens: 100, total_tokens: 340 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 故事线 Harness 闭环')
  await openSidebarLeaf(page, '创作区', '故事线')
  await expect(page.getByRole('heading', { name: /全局故事线/ })).toBeVisible()

  await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
  const candidate = page.getByRole('textbox', { name: '主线故事线候选内容' })
  await expect(candidate).toContainText('潮汐钟主线')
  await expect(page.getByText('还没有故事线。', { exact: true })).toBeVisible()
  await expect(page.getByText('本次实际输入证据', { exact: true })).toBeVisible()

  const edited = [{
    ...modelCandidate[0],
    description: '作者确认版：守灯人追查潮汐钟，并拒绝以全城记忆换取安全。',
  }]
  await candidate.fill(JSON.stringify(edited, null, 2))
  await page.getByRole('button', { name: '采纳', exact: true }).click()

  await expect(page.getByRole('button', { name: '潮汐钟主线', exact: true })).toBeVisible()
  await expect(page.locator('main input').first()).toHaveValue('潮汐钟主线')
  await expect(page.locator('main textarea').first()).toHaveValue(edited[0].description)
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '创作区', '故事线')
  await expect(page.getByRole('heading', { name: /全局故事线/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '潮汐钟主线', exact: true })).toBeVisible()
  await expect(page.locator('main input').first()).toHaveValue('潮汐钟主线')
  await expect(page.locator('main textarea').first()).toHaveValue(edited[0].description)
})

test('主 Agent 为明确章纲生成正文，拒绝零写入并把可见修订稿同步到编辑器', async ({ page }) => {
  let generationCalls = 0
  const modelDraft = '模型初稿：退潮后的盐海露出黑色礁脊，守灯人沿着潮痕走向沉默的钟楼。'
    + '风把旧誓言送回岸边，他意识到这次选择会改变整座港城的命运。'.repeat(4)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'prose-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    const isPlanner = combined.includes('你只把用户目标拆成幕后领域任务')
    if (!isPlanner) {
      generationCalls += 1
      expect(combined).toContain('第一章')
      expect(combined).toContain('守灯人第一次看见浮空城')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: isPlanner
              ? JSON.stringify({
                  summary: '交给正文领域 Agent。',
                  tasks: [{
                    id: 'prose-1',
                    agentId: 'prose',
                    instruction: '写第一章正文',
                    dependsOn: [],
                  }],
                })
              : modelDraft,
          },
        }],
        usage: { prompt_tokens: 260, completion_tokens: 180, total_tokens: 440 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 正文副驾确认闭环')
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const summary = page.getByPlaceholder('章节摘要（可编辑，失焦自动保存）')
  await summary.fill('退潮后，守灯人第一次看见浮空城。')

  await page.getByRole('button', { name: '打开 AI 对话副驾' }).click()
  const copilot = page.getByRole('complementary', { name: '主 Agent 创作副驾' })
  const request = copilot.getByRole('textbox', { name: '告诉主 Agent 你的目标' })
  const candidate = copilot.getByRole('textbox', { name: '《第1章》正文候选内容' })

  await request.fill('写第一章正文')
  await copilot.getByRole('button', { name: '交给主 Agent', exact: true }).click()
  await expect(candidate).toContainText('模型初稿')
  await copilot.getByRole('button', { name: '拒绝', exact: true }).click()

  await request.fill('重新写第一章正文')
  await copilot.getByRole('button', { name: '交给主 Agent', exact: true }).click()
  const edited = modelDraft.replace('模型初稿', '作者确认稿')
  await candidate.fill(edited)
  await copilot.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(copilot.getByText('正文已写入目标章节。', { exact: true }).last()).toBeVisible()

  await copilot.getByRole('button', { name: '关闭主 Agent' }).click()
  await page.getByTitle('编辑章节').click()
  await expect(page.locator('.tiptap-editor')).toContainText('作者确认稿')
  await expect(page.locator('.tiptap-editor')).not.toContainText('模型初稿')
  expect(generationCalls).toBe(2)
})

test('外部文档词条先形成带证据候选，作者确认后才进入 Codex', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'codex-import-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              worldview: {},
              characters: [],
              outline: [],
              codexCandidates: [{
                categoryRef: 'builtin:city',
                name: '临渊城',
                summary: '扼守海峡的贸易重镇',
                description: '常住十万人，万舟汇聚。',
                fields: { scale: '十万人', economy: '海贸' },
                tags: ['港城', '贸易'],
                confidence: 0.94,
                evidenceQuote: '临渊城扼守海峡',
              }],
              writingTechniques: {},
            }),
          },
        }],
        usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
      }),
    })
  })
  await openCleanHome(page)
  await createProject(page, 'E2E 词条导入审查')

  await sidebarButton(page, '文档解析').click()
  await page.getByPlaceholder(/把文档内容粘贴在这里/).fill(
    '临渊城扼守海峡，常住十万人，万舟汇聚，是北境最大的贸易港。',
  )
  await page.getByRole('button', { name: '开始解析', exact: true }).click()
  await page.getByRole('button', { name: /导入当前项目（1 块）/ }).click()

  await expect(page.getByRole('heading', { name: '✓ 全部解析完成' })).toBeVisible()
  await expect(page.getByText('1 条 Codex 候选等待作者审查')).toBeVisible()
  await page.getByRole('button', { name: '审查并选择', exact: true }).click()
  await expect(page.getByText('逐字证据：')).toBeVisible()
  await expect(page.getByText(/第 1 块“临渊城扼守海峡”/)).toBeVisible()
  await page.locator('input[value="临渊城"]').fill('新临渊城')
  await page.getByRole('button', { name: '确认导入 1 条', exact: true }).click()

  await expect(page.getByText(/词条审查已完成：新增 1/)).toBeVisible()
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await sidebarButton(page, '人文环境').click()
  await page.getByRole('button', { name: /城池重镇/ }).click()
  await expect(page.getByText('新临渊城', { exact: true })).toBeVisible()
})

test('真实章节入口可打开五阶段工坊并预览首节点最终提示词', async ({ page }) => {
  await createBookWithSavedChapter(
    page,
    'E2E 透明章纲工坊',
    '林舟已经拿着青铜钥匙来到密室门前。',
  )

  await page.getByTitle('五阶段章纲工坊').click()
  await expect(page.getByRole('heading', { name: /五阶段章纲工坊/ })).toBeVisible()
  await expect(page.getByText('预计调用 5 次模型', { exact: false })).toBeVisible()
  await expect(page.getByText('当前：现状扫描', { exact: false })).toBeVisible()
  await expect(page.getByText('正在按注册表装配本章证据')).toHaveCount(0)

  await page.getByLabel('每个节点发送前预览/编辑最终消息（一次性，不保存）').check()
  await page.getByRole('button', { name: '生成本步', exact: true }).click()

  await expect(page.getByTestId('prompt-preview-gate')).toBeVisible()
  await expect(page.getByText('最终发送内容', { exact: true })).toBeVisible()
  const prompts = page.getByTestId('prompt-preview-gate').locator('textarea')
  await expect(prompts).toHaveCount(2)
  await expect(prompts.nth(0)).toContainText('现状扫描')
  await expect(prompts.nth(1)).toContainText('第1章')
  await expect(page.getByTestId('prompt-preview-gate').getByText(
    '不写回模板或作品资料',
    { exact: false },
  )).toBeVisible()
})

test('真实世界观入口可维护修炼 DAG 并关联角色境界', async ({ page }) => {
  let progressExtractionCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'cultivation-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    progressExtractionCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('修炼进度提取登记闭集')
    expect(combined).toContain('正式踏入筑基境')
    const characterId = Number(combined.match(/"characterId":(\d+)/)?.[1])
    const cultivationSystemId = Number(combined.match(/"cultivationSystemId":(\d+)/)?.[1])
    const stageId = combined.match(/"id":"([^"]+)","name":"筑基境"/)?.[1]
    expect(Number.isInteger(characterId)).toBe(true)
    expect(Number.isInteger(cultivationSystemId)).toBe(true)
    expect(stageId).toBeTruthy()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              events: [{
                characterId,
                cultivationSystemId,
                stageId,
                trigger: '生死关头凝成道基',
                quote: '在生死关头凝成道基，正式踏入筑基境',
              }],
            }),
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      }),
    })
  })
  await openCleanHome(page)
  await createProject(page, 'E2E 修炼体系闭环')

  await openSidebarLeaf(page, '世界观', '世界起源')
  await page.getByRole('button', { name: '力量体系', exact: true }).click()
  await expect(page.getByRole('heading', { name: '修炼体系', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新增体系', exact: true }).click()
  await page.getByPlaceholder('如：剑修、武夫、召唤师').fill('剑修')
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('剑修', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '添加第一个起始境界', exact: true }).click()
  const stageNameField = page.getByText('境界名称', { exact: true }).locator('..')
  await stageNameField.getByText('新境界', { exact: true }).click()
  await stageNameField.locator('input').fill('炼体境')
  await stageNameField.locator('input').press('Enter')
  await expect(page.getByText('炼体境', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '添加后续境界', exact: true }).click()
  await stageNameField.getByText('新境界', { exact: true }).click()
  await stageNameField.locator('input').fill('筑基境')
  await stageNameField.locator('input').press('Enter')
  await expect(page.getByText('← 炼体境', { exact: true })).toBeVisible()

  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByRole('button', { name: /新建角色/ }).click()
  await page.getByRole('button', { name: '主要', exact: true }).click()
  await page.getByRole('button', { name: '守序善良', exact: true }).click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()

  await page.getByLabel('主修体系').selectOption({ label: '剑修' })
  await page.getByLabel('当前设定境界').selectOption({ label: '筑基境' })
  await expect(page.getByLabel('主修体系').locator('option:checked')).toHaveText('剑修')
  await expect(page.getByLabel('当前设定境界').locator('option:checked')).toHaveText('筑基境')

  await page.reload()
  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByRole('button', { name: /新角色/ }).last().click()
  await expect(page.getByLabel('主修体系').locator('option:checked')).toHaveText('剑修')
  await expect(page.getByLabel('当前设定境界').locator('option:checked')).toHaveText('筑基境')

  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await expectInputValue(page, '第1卷')
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await expectInputValue(page, '第1章')
  await page.getByTitle('编辑章节').click()
  const editor = page.locator('.tiptap-editor')
  await editor.fill('林舟与强敌鏖战三日，最终在生死关头凝成道基，正式踏入筑基境，剑气照亮整座山谷。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()

  await openSidebarLeaf(page, '创作区', '修炼进度')
  await expect(page.getByRole('heading', { name: '修炼进度', exact: true })).toBeVisible()
  await expect(page.getByText('正文尚无已确认境界', { exact: true })).toBeVisible()
  await expect(page.getByText('角色卡设定：筑基境', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '分析本章', exact: true }).click()
  await expect(page.getByText('发现 1 条严格证据候选；可取消不采纳项后批次确认。', { exact: true })).toBeVisible()
  await expect(page.getByText('生死关头凝成道基', { exact: true })).toBeVisible()
  expect(progressExtractionCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '创作区', '修炼进度')
  await expect(page.getByText(/已恢复 1 条待确认修炼候选/)).toBeVisible()
  await expect(page.getByText('生死关头凝成道基', { exact: true })).toBeVisible()
  expect(progressExtractionCalls).toBe(1)

  await page.getByLabel('确认所选修炼候选').click()
  await expect(page.getByText('正文当前：筑基境', { exact: true })).toBeVisible()
  await expect(page.getByText('已原子写入 1 条修炼历程并完成终验。', { exact: true })).toBeVisible()
  expect(progressExtractionCalls).toBe(1)

  const feedbackToggle = page.getByLabel('反哺后续写作（默认关闭）')
  await feedbackToggle.click()
  await expect(feedbackToggle).toBeChecked()
  await page.reload()
  await openSidebarLeaf(page, '创作区', '修炼进度')
  await expect(page.getByText('正文当前：筑基境', { exact: true })).toBeVisible()
  await expect(page.getByLabel('反哺后续写作（默认关闭）')).toBeChecked()
  expect(progressExtractionCalls).toBe(1)
})

test('世界地图把明确距离和方位落实到命名实体，并持久化手动比例尺', async ({ page }) => {
  let generationCalls = 0
  let releaseMapResponse: (() => void) | null = null
  let responseFulfilled = false
  const mapResponseGate = new Promise<void>(resolve => { releaseMapResponse = resolve })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'world-map-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls++
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const source = request.messages?.find(message => message.role === 'user')?.content ?? ''
    expect(source).toContain('疆域东西横跨三千公里')
    expect(source).toContain('东港在西京以东，相距六百公里')
    const content = JSON.stringify({
      seed: 'e2e-spatial-map',
      mapName: '主世界',
      pointCount: 5000,
      landRatio: 0.68,
      continentCount: 1,
      stateCount: 2,
      burgDensity: 0.2,
      temperatureShift: 0,
      precipitationFactor: 1,
      heightmapTemplate: 'pangea',
      namingStyle: 'chinese',
      stateNames: ['西陆帝国', '东海王国'],
      burgNames: ['西京', '东港'],
      riverNames: ['潮河'],
      mapWidthKm: 3000,
      mapWidthEvidenceQuote: '疆域东西横跨三千公里',
      spatialEntities: [
        {
          name: '西陆帝国',
          kind: 'state',
          scaleTier: 'empire',
          capitalName: '西京',
          source: 'inferred',
        },
        {
          name: '东海王国',
          kind: 'state',
          scaleTier: 'kingdom',
          capitalName: '东港',
          source: 'inferred',
        },
        {
          name: '西京',
          kind: 'settlement',
          scaleTier: 'metropolis',
          source: 'explicit',
          evidenceQuote: '西京',
        },
        {
          name: '东港',
          kind: 'settlement',
          scaleTier: 'city',
          source: 'explicit',
          evidenceQuote: '东港',
        },
      ],
      spatialRelations: [{
        from: '东港',
        to: '西京',
        direction: 'east',
        distanceTier: 'far',
        distanceValue: 600,
        distanceUnit: 'km',
        source: 'explicit',
        evidenceQuote: '东港在西京以东，相距六百公里',
      }],
    })
    await mapResponseGate
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280 },
      }),
    })
    responseFulfilled = true
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 空间约束地图')
  await openSidebarLeaf(page, '世界观', '自然环境')
  await page.getByRole('button', { name: /疆域尺寸/ }).click()
  await page.getByText('世界整体大小、核心区域的疆域范围', { exact: true }).last().click()
  await page.locator('textarea').last().fill('疆域东西横跨三千公里')
  await page.getByRole('heading', { name: '📐 疆域尺寸' }).click()
  await page.getByRole('button', { name: /山川水系/ }).click()
  await page.getByText('重要山脉、河流、湖泊、运河与水路', { exact: true }).last().click()
  await page.locator('textarea').last().fill('东港在西京以东，相距六百公里')
  await page.getByRole('heading', { name: '⛰ 山川水系' }).click()

  await openSidebarLeaf(page, '世界观', '世界地图')
  await page.getByTitle('新建根世界').click()
  await expect(page.getByText('新世界', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'AI 生成地图', exact: true }).click()
  await expect.poll(() => generationCalls).toBe(1)
  await page.getByText('新世界', { exact: true }).click()
  releaseMapResponse?.()
  await expect.poll(() => responseFulfilled).toBe(true)
  await expect(page.getByText('地图候选尚未写入', { exact: true })).toHaveCount(0)
  await page.getByText('主世界', { exact: true }).click()
  await expect(page.getByText('地图候选尚未写入', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('确认前主地图和正式数据保持不变。', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 生成地图', exact: true })).toBeDisabled()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '世界观', '世界地图')
  await expect(page.getByText('地图候选尚未写入', { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(generationCalls).toBe(1)
  await page.getByRole('button', { name: '确认使用此地图', exact: true }).click()
  await expect(page.getByText('比例尺：用户疆域尺寸', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'AI 重新生成', exact: true })).toBeVisible()
  await expect(page.getByText(/2 国/)).toBeVisible()
  expect(generationCalls).toBe(1)

  const scale = page.locator('select').last()
  await scale.selectOption('2')
  await expect(page.getByText('比例尺：手动设定', { exact: true })).toBeVisible()
  await page.reload()
  await openSidebarLeaf(page, '世界观', '世界地图')
  await expect(page.getByText('比例尺：手动设定', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'AI 重新生成', exact: true })).toBeVisible()
  await expect(page.locator('select').last()).toHaveValue('2')
})

test('角色驱动 Skill 隔离选定方案，恢复确认后持久化并导入正式大纲', async ({ page }) => {
  let generationCalls = 0
  const oldCandidate = [{
    volumeTitle: '旧候选秘密卷',
    volumeSummary: '旧结果只用于验证重新生成时不会回灌模型。',
    characterArcs: '新角色从守塔职责走向第一次主动追查。',
    chapters: [{
      title: '旧候选秘密章',
      summary: '新角色听见港务官告知潮汐钟失窃，决定离开灯塔调查。',
      keyCharacters: ['新角色'],
      arcProgress: '港务官的告知促使新角色从被动守塔转为主动调查。',
    }],
  }]
  const modelCandidate = [{
    volumeTitle: '第一卷 归潮',
    volumeSummary: '新角色沿着潮汐钟线索回到旧港，并把个人抉择接入既有故事核心。',
    characterArcs: '新角色从逃避旧港转向承担守护共同记忆的责任。',
    chapters: [{
      title: '第一章 失钟',
      summary: '新角色从守灯人口中得知潮汐钟失窃，亲自查验钟楼后决定追查。',
      keyCharacters: ['新角色'],
      arcProgress: '守灯人的告知和现场查验推动新角色停止逃避并开始调查。',
    }],
  }]
  const editedCandidate = [{
    ...modelCandidate[0],
    volumeSummary: '作者确认版：新角色沿着潮汐钟线索回到旧港，并拒绝让共同记忆再次被交易。',
  }]

  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'character-driven-copilot-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = body.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('角色驱动编排硬约束')
    if (generationCalls === 1) {
      expect(combined).toContain('其它激活方案秘密')
    } else {
      expect(generationCalls).toBe(2)
      expect(combined).toContain('当前方案起点：逃避旧港旧案')
      expect(combined).toContain('当前方案终点：守护共同记忆')
      expect(combined).toContain('当前方案要求：必须服务潮汐钟故事核心')
      expect(combined).toContain('守灯人必须在共同记忆与港城安全之间作出选择')
      expect(combined).not.toContain('旧候选秘密卷')
      expect(combined).not.toContain('其它激活方案秘密')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content: JSON.stringify(
          generationCalls === 1 ? oldCandidate : modelCandidate,
        ) } }],
        usage: { prompt_tokens: 260, completion_tokens: 100, total_tokens: 360 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 角色驱动 Harness 闭环')

  await openSidebarLeaf(page, '设定库', '故事设计')
  await page.getByText('点击填写一句话故事…', { exact: true }).click()
  const storyCoreEditor = page.getByPlaceholder('点击填写一句话故事…')
  await storyCoreEditor.fill('守灯人必须在共同记忆与港城安全之间作出选择。')
  await storyCoreEditor.blur()
  await expect(page.getByText('守灯人必须在共同记忆与港城安全之间作出选择。', { exact: true }))
    .toBeVisible()

  await openSidebarLeaf(page, '角色设计', '角色生成')
  await page.getByRole('button', { name: /新建角色/ }).click()
  await page.getByRole('button', { name: '主要', exact: true }).click()
  await page.getByRole('button', { name: '守序善良', exact: true }).click()
  await page.getByRole('button', { name: '创建并分流', exact: true }).click()

  await openSidebarLeaf(page, '创作区', '角色驱动')
  await page.getByRole('button', { name: '新建方案', exact: true }).click()
  await expect(page.getByText('角色弧光设定', { exact: true })).toBeVisible()

  const characterPicker = page.locator('select').filter({
    has: page.locator('option', { hasText: '+ 添加角色' }),
  })
  await characterPicker.selectOption({ index: 1 })
  const initial = page.getByPlaceholder('角色在故事开始时的状态、处境、性格特点...')
  const target = page.getByPlaceholder('角色在故事结束时应达到的状态、成长结果...')
  const hint = page.getByPlaceholder(/控制在3卷以内/)
  await initial.fill('被动守在外海灯塔')
  await initial.blur()
  await target.fill('主动追查潮汐钟失窃案')
  await target.blur()
  await hint.fill('其它激活方案秘密：必须留在外海')
  await hint.blur()

  await page.getByRole('button', { name: '生成剧情大纲', exact: true }).click()
  const candidate = page.getByRole('textbox', { name: '角色驱动卷章候选内容' })
  await expect(candidate).toContainText('旧候选秘密卷')
  await expect(page.getByText('本次实际输入证据', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存到当前方案', exact: true }).click()
  await expect(page.getByText('生成结果：1 卷，1 章', { exact: true })).toBeVisible()
  await expect(page.getByText('旧候选秘密卷', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '设为当前参考', exact: true }).click()
  await expect(page.getByRole('button', { name: '后续 AI 正在参考', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '复制为新版本', exact: true }).click()
  await expect(page.getByLabel('当前角色驱动方案')).toContainText('v2')
  await expect(page.getByRole('button', { name: '设为当前参考', exact: true })).toBeVisible()

  await initial.fill('当前方案起点：逃避旧港旧案')
  await initial.blur()
  await target.fill('当前方案终点：守护共同记忆')
  await target.blur()
  await hint.fill('当前方案要求：必须服务潮汐钟故事核心')
  await hint.blur()
  await page.getByRole('button', { name: '生成剧情大纲', exact: true }).click()
  await expect(candidate).toContainText('第一卷 归潮')
  await expect(page.getByText('旧候选秘密卷', { exact: true })).toBeVisible()

  await page.reload()
  await openSidebarLeaf(page, '创作区', '角色驱动')
  const planPicker = page.getByLabel('当前角色驱动方案')
  const copiedPlanValue = await planPicker.locator('option').filter({ hasText: 'v2' }).getAttribute('value')
  expect(copiedPlanValue).not.toBeNull()
  await planPicker.selectOption(copiedPlanValue!)
  await expect(candidate).toContainText('第一卷 归潮')
  await candidate.fill(JSON.stringify(editedCandidate, null, 2))
  await page.getByRole('button', { name: '保存到当前方案', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  await expect(page.getByText(editedCandidate[0].volumeSummary, { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '设为当前参考', exact: true }).click()
  await expect(page.getByRole('button', { name: '后续 AI 正在参考', exact: true })).toBeVisible()
  await page.reload()
  await openSidebarLeaf(page, '创作区', '角色驱动')
  await expect(page.getByLabel('当前角色驱动方案')).toContainText('v2')
  await expect(page.getByLabel('当前角色驱动方案').locator('option')).toHaveCount(2)
  await expect(initial).toHaveValue('当前方案起点：逃避旧港旧案')
  await expect(target).toHaveValue('当前方案终点：守护共同记忆')
  await expect(hint).toHaveValue('当前方案要求：必须服务潮汐钟故事核心')
  await expect(page.getByText(editedCandidate[0].volumeSummary, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '后续 AI 正在参考', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '导入选中卷到大纲（1 卷）', exact: true }).click()
  await expect(page.getByText('已成功导入到大纲', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await expect(page.locator('input[value="第一卷 归潮"]')).toBeVisible()
  await expect(page.locator('input[value="第一章 失钟"]')).toBeVisible()
  expect(generationCalls).toBe(2)
})

test('角色中途重规划保护已写正文，只把审查后的 patch 应用到未来大纲', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'character-revision-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const source = request.messages?.find(message => message.role === 'user')?.content ?? ''
    expect(source).toContain('第 1-1 章')
    expect(source).toContain('已写保护区')
    expect(source).toContain('旧线索浮现')
    expect(source).toContain('终局会师')
    const nodeIds = [...source.matchAll(/\[node:(\d+)\]/g)].map(match => Number(match[1]))
    expect(nodeIds).toHaveLength(3)
    const [writtenNodeId, futureNodeId, endingNodeId] = nodeIds
    const content = JSON.stringify({
      changeSummary: '让新角色在既有正文之后加入归途线。',
      scopeSummary: '第1章保持不动，第2章自然切入，第3章承接终局。',
      affectedWrittenChapters: [{
        ordinal: 1,
        title: '第1章',
        severity: 'medium',
        reason: '正文已成立，只能人工复核，不能自动覆盖。',
        evidenceQuotes: ['旧城门后的承诺已经写入正文'],
        recommendation: 'protect',
      }],
      immutableFacts: [{
        statement: '主角已经推开旧城门。',
        sourceChapterOrdinal: 1,
        evidenceQuote: '主角推开旧城门并立下承诺',
      }],
      conflicts: [],
      foreshadowSuggestions: [{
        chapterOrdinal: 2,
        title: '旧线索浮现',
        suggestion: '让新角色以线索提供者身份出现。',
      }],
      mainPlotSuggestion: '主线目标保持不变，只调整参与角色。',
      options: [
        {
          id: 'light',
          intensity: 'light',
          label: '轻量融入',
          summary: '只补充未来章摘要。',
          risks: [],
          patches: [{
            outlineNodeId: writtenNodeId,
            proposedTitle: '被拒绝的正文改名',
            proposedSummary: '不得写回。',
            reason: '用于验证保护边界。',
          }],
        },
        {
          id: 'balanced',
          intensity: 'balanced',
          label: '中度改线',
          summary: '从第二章开始重排角色切入。',
          risks: ['需要复核终局衔接'],
          patches: [{
            outlineNodeId: futureNodeId,
            proposedTitle: '归途重排',
            proposedSummary: '新角色带来旧案证据，与主角共同踏上归途。',
            reason: '在已写正文之后自然切入。',
          }],
        },
        {
          id: 'deep',
          intensity: 'deep',
          label: '深度重构',
          summary: '连同终局铺垫一起调整。',
          risks: ['调整范围较大'],
          patches: [{
            outlineNodeId: endingNodeId,
            proposedTitle: '终局会师',
            proposedSummary: '多方角色在终局前完成会师。',
            reason: '保留终局锚点标题，只调整摘要。',
          }],
        },
      ],
      warnings: [],
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content } }],
          usage: { prompt_tokens: 240, completion_tokens: 120, total_tokens: 360 },
      }),
    })
  })

  await createBookWithSavedChapter(
    page,
    'E2E 角色中途重规划',
    '主角推开旧城门并立下承诺，旧城门后的承诺已经写入正文。',
  )
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const secondTitle = page.locator('input[value="第2章"]')
  await expect(secondTitle).toBeVisible()
  await secondTitle.fill('旧线索浮现')
  const renamedSecondTitle = page.locator('input[value="旧线索浮现"]')
  await renamedSecondTitle.blur()
  await renamedSecondTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）')
    .fill('主角发现旧案仍有缺口。')
  await renamedSecondTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）').blur()

  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  const thirdTitle = page.locator('input[value="第3章"]')
  await expect(thirdTitle).toBeVisible()
  await thirdTitle.fill('终局会师')
  const renamedThirdTitle = page.locator('input[value="终局会师"]')
  await renamedThirdTitle.blur()
  await renamedThirdTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）')
    .fill('各方在终局前会师。')
  await renamedThirdTitle.locator('xpath=..').getByPlaceholder('章节摘要（可编辑，失焦自动保存）').blur()

  await openSidebarLeaf(page, '创作区', '角色驱动')
  await page.getByRole('button', { name: '中途重规划', exact: true }).click()
  await expect(page.getByRole('heading', { name: '角色变更影响分析', exact: true })).toBeVisible()
  await expect(page.getByText('已有正文但缺少章节记忆；系统会使用有限证据，结论需重点人工复核。')).toBeVisible()
  await page.getByPlaceholder('写清新旧弧光差异、关键转折和与主线的关系...')
    .fill('新增一名掌握旧案证据的角色，但不得推翻第一章已经成立的承诺。')
  await page.getByRole('button', { name: '分析影响并生成三档方案', exact: true }).click()

  await expect(page.getByRole('heading', { name: '影响分析结果', exact: true })).toBeVisible()
  await expect(page.getByText('已拒绝第 1 章 patch：属于已写保护区', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  await expect(page.getByText('归途重排', { exact: false }).first()).toBeVisible()
  await page.reload()
  await openSidebarLeaf(page, '创作区', '角色驱动')
  await page.getByRole('button', { name: '中途重规划', exact: true }).click()
  await expect(page.getByRole('heading', { name: '影响分析结果', exact: true })).toBeVisible()
  await expect(page.getByText('归途重排', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: '应用选中 patch 到未写大纲', exact: true }).click()
  await page.getByRole('button', { name: '应用到大纲', exact: true }).click()
  await expect(page.getByText('已应用 1 项', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await expect(page.locator('input[value="第1章"]')).toBeVisible()
  await expect(page.locator('input[value="归途重排"]')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '大纲', exact: true }).click()
  await expect(page.locator('input[value="第1章"]')).toBeVisible()
  await expect(page.locator('input[value="归途重排"]')).toBeVisible()
})

test('世界组七字段扩写只产生可恢复候选，作者确认后一次性写入正式世界观', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = {
    worldOrigin: '作者确认前不可见的新世界来源：黑潮来自被封存的旧纪元。',
    powerHierarchy: '守灯人通过记忆契约维持力量，拾忆者能短暂夺回被典当的往事。',
    continentLayout: '群岛环绕沉没钟塔分布，西侧旧港与东侧灯塔群隔海相望。',
    climateByRegion: '外海终年暴雨，内港受潮汐钟庇护，北岸每月经历一次记忆雾。',
    historyLine: '旧纪元崩毁后，港城以周期性遗忘换取存续，拾忆者随后开始反抗。',
    races: '人类、潮裔与失忆者共同生活，各自保存不同版本的旧纪元历史。',
    factionLayout: '灯塔议会维护遗忘契约，拾忆者试图公开真相，港务会在两者之间摇摆。',
  }
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'worldview-expand-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('经过登记的当前世界资料')
    expect(combined).toContain('黑潮前的世界由七座灯塔共同守护。')
    expect(combined).toContain('守灯人必须在共同记忆与港城安全之间作出选择。')
    expect(combined).toContain('黑潮每年抹去港城的一段共同历史。')
    expect(combined).toContain('严格输出既定七字段')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(modelCandidate) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 360, completion_tokens: 180, total_tokens: 540 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 世界组七字段 Harness 闭环')

  await openSidebarLeaf(page, '世界观', '世界起源')
  const originPlaceholder = '创世神话 / 历史时期 / 文明起源……世界从何而来？'
  await page.getByText(originPlaceholder, { exact: true }).last().click()
  await page.getByRole('textbox', { name: originPlaceholder })
    .fill('黑潮前的世界由七座灯塔共同守护。')
  await page.getByRole('heading', { name: '🌌 世界来源' }).click()
  await expect(page.getByText('黑潮前的世界由七座灯塔共同守护。', { exact: true })).toBeVisible()

  await openSidebarLeaf(page, '设定库', '故事设计')
  await page.getByText('点击填写一句话故事…', { exact: true }).click()
  const logline = page.getByPlaceholder('点击填写一句话故事…')
  await logline.fill('守灯人必须在共同记忆与港城安全之间作出选择。')
  await logline.blur()

  await sidebarButton(page, '项目概况').click()
  const multiWorldToggle = page.getByText(/多世界模式/)
    .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]/button')
  await multiWorldToggle.click()
  await expect(page.getByRole('heading', { name: '危险操作:启用多世界模式' })).toBeVisible()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('heading', { name: '是否立即下载备份(JSON 文件到本地)?' })).toBeVisible()
  await page.getByRole('button', { name: '已备份，继续', exact: true }).click()
  await expect(sidebarButton(page, '世界总览')).toHaveCount(1)

  await sidebarButton(page, '世界总览').click()
  await expect(page.getByRole('heading', { name: '🌐 世界总览' })).toBeVisible()
  const primaryRow = page.getByText('主世界', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await primaryRow.getByTitle('编辑').click()
  const description = page.getByPlaceholder('这个世界的核心特征、氛围、独特之处...')
  await description.fill('黑潮每年抹去港城的一段共同历史。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存中...', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'AI 扩写世界观', exact: true }).click()
  await expect(page.getByText('七字段世界观候选尚未写入', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(modelCandidate.worldOrigin, { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await openSidebarLeaf(page, '世界观', '世界起源')
  await expect(page.getByText('黑潮前的世界由七座灯塔共同守护。', { exact: true })).toBeVisible()
  await expect(page.getByText(modelCandidate.worldOrigin, { exact: true })).toHaveCount(0)

  await page.reload()
  await sidebarButton(page, '世界总览').click()
  await expect(page.getByRole('heading', { name: '🌐 世界总览' })).toBeVisible()
  const restoredPrimaryRow = page.getByText('主世界', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await restoredPrimaryRow.getByTitle('编辑').click()
  await expect(page.getByText('七字段世界观候选尚未写入', { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(generationCalls).toBe(1)

  await page.getByRole('button', { name: '确认写入七字段', exact: true }).click()
  await expect(page.getByRole('button', { name: '已写入世界观', exact: true })).toBeVisible({ timeout: 30_000 })
  await openSidebarLeaf(page, '世界观', '世界起源')
  await expect(page.getByText(modelCandidate.worldOrigin, { exact: true })).toBeVisible()
  await expect(page.getByText('黑潮前的世界由七座灯塔共同守护。', { exact: true })).toHaveCount(0)
  await page.reload()
  await openSidebarLeaf(page, '世界观', '世界起源')
  await expect(page.getByText(modelCandidate.worldOrigin, { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)
})

test('多世界建议刷新恢复整批候选，作者选择后只创建所选世界', async ({ page }) => {
  let generationCalls = 0
  const modelCandidate = [{
    name: '灰烬钟庭',
    type: 'traversal',
    description: '燃尽未来换取当下力量的钟塔世界。',
    entryCondition: '在退潮时敲响无主铜钟',
    powerRestriction: '每次使用高阶能力都会提前遗忘一段未来计划',
    plannedChapterCount: 18,
  }, {
    name: '兽潮棋盘',
    type: 'instance',
    description: '城邦按季节重排，居民必须在兽潮前完成迁城。',
    entryCondition: '持有上一世界获得的潮纹棋子',
    powerRestriction: '外来能力只能通过本地棋阵节点释放',
    plannedChapterCount: 12,
  }, {
    name: '星梯上界',
    type: 'ascension',
    description: '漂浮阶梯连接不同重力层级，越高处时间越慢。',
    entryCondition: '集齐三枚世界门坐标',
    powerRestriction: '只能携带一个已被本地法则承认的核心能力',
    plannedChapterCount: 24,
  }]
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'world-suggest-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('经过登记的世界规划资料')
    expect(combined).toContain('希望下一批世界逐步挑战主角对记忆和身份的选择。')
    expect(combined).toContain('主世界')
    expect(combined).toContain('守灯人必须在共同记忆与港城安全之间作出选择。')
    expect(combined).toContain('严格输出既定六字段')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(modelCandidate) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 280, completion_tokens: 160, total_tokens: 440 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 多世界建议 Harness 闭环')
  await openSidebarLeaf(page, '设定库', '故事设计')
  await page.getByText('点击填写一句话故事…', { exact: true }).click()
  const logline = page.getByPlaceholder('点击填写一句话故事…')
  await logline.fill('守灯人必须在共同记忆与港城安全之间作出选择。')
  await logline.blur()

  await sidebarButton(page, '项目概况').click()
  const multiWorldToggle = page.getByText(/多世界模式/)
    .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]/button')
  await multiWorldToggle.click()
  await expect(page.getByRole('heading', { name: '危险操作:启用多世界模式' })).toBeVisible()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect(page.getByRole('heading', { name: '是否立即下载备份(JSON 文件到本地)?' })).toBeVisible()
  await page.getByRole('button', { name: '已备份，继续', exact: true }).click()

  await sidebarButton(page, '世界总览').click()
  await page.getByRole('button', { name: 'AI 建议世界', exact: true }).click()
  const concept = page.getByPlaceholder(/描述你的整体故事概念/)
  await concept.fill('希望下一批世界逐步挑战主角对记忆和身份的选择。')
  await page.getByRole('button', { name: '生成建议', exact: true }).click()
  await expect(page.getByText('世界建议候选尚未写入；请选择后统一确认', { exact: true }))
    .toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('灰烬钟庭', { exact: true })).toBeVisible()
  await expect(page.getByText('兽潮棋盘', { exact: true })).toBeVisible()
  await expect(page.getByText('星梯上界', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  const beforeRows = page.locator('section').filter({ hasText: '世界列表' }).first().locator('div.group')
  await expect(beforeRows).toHaveCount(1)
  await page.reload()
  await sidebarButton(page, '世界总览').click()
  await expect(page.getByText('世界建议候选尚未写入；请选择后统一确认', { exact: true }))
    .toBeVisible({ timeout: 30_000 })
  expect(generationCalls).toBe(1)

  const greyRow = page.getByText('灰烬钟庭', { exact: true }).locator('xpath=ancestor::div[contains(@class,"items-start")][1]')
  const starRow = page.getByText('星梯上界', { exact: true }).locator('xpath=ancestor::div[contains(@class,"items-start")][1]')
  await greyRow.getByRole('button', { name: '选择', exact: true }).click()
  await starRow.getByRole('button', { name: '选择', exact: true }).click()
  await page.getByRole('button', { name: '确认写入所选 2 项', exact: true }).click()
  await expect(page.getByText('已写入 2 个世界', { exact: true })).toBeVisible({ timeout: 30_000 })
  const worldList = page.locator('section').filter({ hasText: '世界列表' }).first()
  await expect(worldList.getByText('灰烬钟庭', { exact: true }).first()).toBeVisible()
  await expect(worldList.getByText('星梯上界', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('兽潮棋盘', { exact: true })).toHaveCount(0)
  expect(generationCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '世界总览').click()
  const restoredWorldList = page.locator('section').filter({ hasText: '世界列表' }).first()
  await expect(restoredWorldList.getByText('灰烬钟庭', { exact: true }).first()).toBeVisible()
  await expect(restoredWorldList.getByText('星梯上界', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('兽潮棋盘', { exact: true })).toHaveCount(0)
})

test('世界宪法扫描刷新恢复批次，确认后仍只写待确认事实', async ({ page }) => {
  let generationCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'constitution-extract-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('世界宪法扫描登记边界')
    expect(combined).toContain('魔法源于月亮潮汐')
    expect(combined).toContain('magicSource')
    const sourceKey = combined.match(/\[(worldviews:\d+:worldOrigin)\]/)?.[1]
    const worldGroupToken = combined.match(/世界主体：\s*(null|\d+)\s*\|/)?.[1]
    const worldGroupId = worldGroupToken === 'null' ? null : Number(worldGroupToken)
    expect(sourceKey).toBeTruthy()
    expect(worldGroupId === null || Number.isInteger(worldGroupId)).toBe(true)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({ assertions: [{
              subjectType: 'worldGroup',
              subjectId: worldGroupId,
              predicate: 'magicSource',
              value: '月亮潮汐',
              sourceKey,
              quote: '魔法源于月亮潮汐',
            }] }),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 世界宪法 Harness 闭环')
  await openSidebarLeaf(page, '世界观', '世界起源')
  const originPlaceholder = '创世神话 / 历史时期 / 文明起源……世界从何而来？'
  await page.getByText(originPlaceholder, { exact: true }).last().click()
  await page.getByRole('textbox', { name: originPlaceholder }).fill('曜月界的魔法源于月亮潮汐。')
  await page.getByRole('heading', { name: '🌌 世界来源' }).click()
  await expect(page.getByText('曜月界的魔法源于月亮潮汐。', { exact: true })).toBeVisible()

  await sidebarButton(page, '事实库').click()
  await page.getByRole('button', { name: '查看世界宪法', exact: true }).click()
  await expect(page.getByRole('heading', { name: '世界宪法（CONSISTENCY-3）' })).toBeVisible()
  await page.getByRole('button', { name: '扫描已登记设定', exact: true }).click()
  await expect(page.getByText('扫描批次待确认（1 条）', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('月亮潮汐', { exact: true })).toBeVisible()
  await expect(page.getByText(/事实库仍为零写入/)).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '事实库').click()
  await page.getByRole('button', { name: '查看世界宪法', exact: true }).click()
  await expect(page.getByText('扫描批次待确认（1 条）', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/已恢复待确认扫描批次/)).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.getByRole('button', { name: '确认写入事实候选', exact: true }).click()
  await expect(page.getByText(/已原子写入 1 条事实候选/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '已确认（0）', exact: true })).toHaveCount(0)
  await expect(page.getByTitle('确认世界宪法')).toHaveCount(1)
  await expect(page.getByText('月亮潮汐', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '事实库').click()
  await page.getByRole('button', { name: '查看世界宪法', exact: true }).click()
  await expect(page.getByTitle('确认世界宪法')).toHaveCount(1)
  await expect(page.getByText('月亮潮汐', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)
})

test('Codex 内容拆分刷新恢复候选，作者确认后才原子新增词条', async ({ page }) => {
  let generationCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'codex-extract-durable-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('Codex 词条抽取登记基线')
    expect(combined).toContain('目标分类：世界结构')
    expect(combined).toContain('"type"')
    expect(combined).toContain('月环城悬浮在潮汐海上空')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify([{
              name: '月环城',
              icon: '🌙',
              summary: '悬浮于潮汐海上空的环形城邦。',
              description: '月环城依靠七座潮汐锚稳定在海面上空。',
              fields: { type: '浮空城邦', scope: '潮汐海外环', feature: '七座潮汐锚维持高度' },
              tags: ['浮空城', '潮汐锚'],
              importance: 4,
            }]),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 220, completion_tokens: 90, total_tokens: 310 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E Codex durable 拆分闭环')
  await openSidebarLeaf(page, '世界观', '自然环境')
  await expect(page.getByRole('heading', { name: '🏔️ 自然环境与地理' })).toBeVisible()
  await expect(page.getByText('📚 世界结构 · 具体词条', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'AI 从内容拆分词条', exact: true }).click()
  const source = page.getByPlaceholder('粘贴或编辑要拆分的整段设定内容')
  await source.fill('月环城悬浮在潮汐海上空，由七座潮汐锚固定。')
  await page.getByRole('button', { name: '开始拆分', exact: true }).click()
  await expect(page.getByText('月环城', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '写入所选 1 项', exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '世界观', '自然环境')
  await expect(page.getByText('月环城', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'AI 从内容拆分词条', exact: true }).click()
  await expect(page.getByText('月环城', { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(generationCalls).toBe(1)

  await page.getByRole('button', { name: '写入所选 1 项', exact: true }).click()
  await expect(page.getByText('月环城', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('已原子写入 1 个词条。', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '世界观', '自然环境')
  await expect(page.getByText('月环城', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)
})

test('伏笔建议刷新恢复候选，作者确认后才原子新增正式伏笔', async ({ page }) => {
  let generationCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'foreshadow-suggestions-durable-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('【伏笔建议正式基线】')
    expect(combined).toContain('项目：E2E 伏笔 durable 建议闭环')
    expect(combined).toContain('已有伏笔：无')
    expect(combined).toContain('【HARNESS-72 严格输出协议】')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              foreshadows: [{
                name: '反照的空椅',
                type: 'symbol',
                description: '议事厅始终空着一把椅子，终局揭示它属于被抹去的建国者。',
              }],
            }),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 210, completion_tokens: 55, total_tokens: 265 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 伏笔 durable 建议闭环')
  await openSidebarLeaf(page, '创作区', '伏笔')
  await expect(page.getByRole('heading', { name: '伏笔追踪', exact: true })).toBeVisible()
  await expect(page.getByText(/0 个伏笔/)).toBeVisible()

  await page.getByRole('button', { name: 'AI 建议', exact: true }).click()
  await expect(page.getByText('反照的空椅', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('生成 1 条严格候选；可取消不采纳项后批次确认。', { exact: true })).toBeVisible()
  await expect(page.getByText(/0 个伏笔/)).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '创作区', '伏笔')
  await expect(page.getByText('已恢复 1 条待确认伏笔候选；没有重复调用模型。', { exact: true })).toBeVisible()
  await expect(page.getByText('反照的空椅', { exact: true })).toBeVisible()
  await expect(page.getByText(/0 个伏笔/)).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.getByLabel('确认所选伏笔候选').click()
  await expect(page.getByText('已原子写入 1 条伏笔并完成终验。', { exact: true })).toBeVisible()
  await expect(page.getByText(/1 个伏笔/)).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '创作区', '伏笔')
  await page.getByTitle('列表视图').click()
  await expect(page.getByText('反照的空椅', { exact: true })).toBeVisible()
  await expect(page.getByText(/1 个伏笔/)).toBeVisible()
  expect(generationCalls).toBe(1)
})

test('历史考据刷新恢复持久候选，确认后只写正式考据结果', async ({ page }) => {
  let generationCalls = 0
  const result = `## 前提识别
- 镜税署与盐晶是作者声明的架空设定。

## 可能存在的问题
- 垄断执行成本需要解释，信心：高。

## 修改方案 / 折中方案
- 增设行会连带责任与分级验票。

## 时代质感补充
- 可描写封签、簿册和码头抽验；真实类比出处待考。`
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'history-agent-durable-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('【历史 Agent 正式输入基线】')
    expect(combined).toContain('盐晶新律颁布')
    expect(combined).toContain('星历三百年')
    expect(combined).toContain('【HARNESS-73 严格输出协议】')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: result }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 180, completion_tokens: 80, total_tokens: 260 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 历史 Agent durable 闭环')
  await openSidebarLeaf(page, '世界观', '历史年表')
  await expect(page.getByRole('heading', { name: '📜 历史年表与时间线' })).toBeVisible()
  await page.getByRole('button', { name: '添加事件', exact: true }).click()
  const title = page.locator('input[value="新历史事件"]')
  await title.fill('盐晶新律颁布')
  await page.getByLabel('数字化年份').fill('300')
  await page.getByPlaceholder('如：开元十三年、公元725年').fill('星历三百年')
  await page.getByRole('heading', { name: '📜 历史年表与时间线' }).click()

  await page.getByRole('button', { name: 'AI 历史考据', exact: true }).click()
  await expect(page.getByText('历史考据持久候选', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('垄断执行成本需要解释，信心：高。', { exact: false })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '世界观', '历史年表')
  await page.getByText('盐晶新律颁布', { exact: true }).click()
  await expect(page.getByText('已恢复待确认候选；没有重复调用模型。', { exact: true })).toBeVisible()
  await expect(page.getByText('历史考据持久候选', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.getByRole('button', { name: '确认写入', exact: true }).click()
  await expect(page.getByText('AI 历史考据结果', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('垄断执行成本需要解释，信心：高。', { exact: false })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '世界观', '历史年表')
  await page.getByText('盐晶新律颁布', { exact: true }).click()
  await expect(page.getByText('AI 历史考据结果', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)
})

test('参考分析总结刷新恢复持久候选，确认后同步版本和激活参考投影', async ({ page }) => {
  let generationCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'reference-derived-durable-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('【参考分析派生 Agent 正式输入基线】')
    expect(combined).toContain('镜城证词')
    expect(combined).toContain('有限视角在关键证词处切换')
    expect(combined).toContain('【HARNESS-74 严格输出协议】')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              narrativeStyle: '全书用受限视角保持证词之间的信息差。',
              characterCraft: '林照雪通过克制行动而非自述完成立场变化。',
            }),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 170, completion_tokens: 58, total_tokens: 228 },
      }),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E 参考派生 durable 闭环')
  const projectId = Number(page.url().match(/workspace\/(\d+)/)?.[1])
  expect(projectId).toBeGreaterThan(0)
  await page.evaluate(async currentProjectId => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const project = await request(database.transaction('projects').objectStore('projects').get(currentProjectId)) as {
      activeWorldId: number
      activeWorkId: number
    }
    const now = Date.now()
    const transaction = database.transaction([
      'references', 'referenceAnalysisRuns', 'referenceChunkAnalysis',
    ], 'readwrite')
    const referenceId = await request(transaction.objectStore('references').add({
      projectId: currentProjectId,
      worldId: project.activeWorldId,
      workId: project.activeWorkId,
      title: '镜城证词',
      author: '测试作者',
      type: 'story',
      note: '验证版本化总结派生',
      url: '',
      genre: '悬疑',
      totalChars: 300,
      fileHash: 'e2e-reference-hash',
      analysisDepth: 'deep',
      analysisStatus: 'done',
      analysisProgress: 100,
      createdAt: now,
      updatedAt: now,
    })) as number
    const analysisRunId = await request(transaction.objectStore('referenceAnalysisRuns').add({
      projectId: currentProjectId,
      worldId: project.activeWorldId,
      workId: project.activeWorkId,
      referenceId,
      version: 1,
      status: 'active',
      depth: 'deep',
      sourceFilename: 'mirror.md',
      fileHash: 'e2e-reference-hash',
      totalChars: 300,
      sourceKind: 'own-work',
      usageScope: 'creative-reference',
      rightsNote: '作者自有测试文本',
      rightsConfirmed: true,
      rightsDeclaredAt: now,
      expectedChunks: 1,
      completedChunks: 1,
      progress: 100,
      completedAt: now,
      activatedAt: now,
      createdAt: now,
      updatedAt: now,
    })) as number
    await request(transaction.objectStore('referenceChunkAnalysis').add({
      projectId: currentProjectId,
      worldId: project.activeWorldId,
      workId: project.activeWorkId,
      referenceId,
      analysisRunId,
      chunkIndex: 0,
      label: '第一章',
      narrativeStyle: '有限视角在关键证词处切换。',
      characterCraft: '林照雪以克制行动推动角色弧。',
      createdAt: now,
    }))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  }, projectId)

  await page.reload()
  await openSidebarLeaf(page, '著作信息', '项目参考')
  await page.getByText('镜城证词', { exact: true }).click()
  await expect(page.getByText('v1 · 深层 · mirror.md', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'AI 全书总结', exact: true }).click()
  await expect(page.getByText('全书总结持久候选', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('全书用受限视角保持证词之间的信息差。', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '著作信息', '项目参考')
  await page.getByText('镜城证词', { exact: true }).click()
  await expect(page.getByText('已恢复待确认候选；没有重复调用模型。', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.getByRole('button', { name: '确认写入', exact: true }).click()
  await expect(page.getByText('AI 全书总结', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('全书用受限视角保持证词之间的信息差。', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)

  await page.reload()
  await openSidebarLeaf(page, '著作信息', '项目参考')
  await page.getByText('镜城证词', { exact: true }).click()
  await expect(page.getByText('全书用受限视角保持证词之间的信息差。', { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)
})

test('影响人工修正后可恢复生成式章纲候选并经确认原子写回', async ({ page }) => {
  let generationCalls = 0
  const regeneratedSummary = '钟楼根据半开启的潮门重新安排守夜人撤离，并留下追查潮声来源的因果钩子。'
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'impact-outline-regeneration-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain('潮门只开启一半')
    expect(combined).toContain('钟楼照常回应')
    expect(combined).toContain('HARNESS-77 严格输出协议')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify({
              summary: regeneratedSummary,
              reason: '人工修正后的潮门状态改变了后续行动条件。',
              evidenceRefs: ['章节正文', '当前章节大纲'],
            }),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 210, completion_tokens: 55, total_tokens: 265 },
      }),
    })
  })

  await createBookWithSavedChapter(
    page,
    'E2E 影响章纲重建闭环',
    '潮门只开启一半，钟声穿过旧港。',
  )
  const projectId = Number(page.url().match(/workspace\/(\d+)/)?.[1])
  expect(projectId).toBeGreaterThan(0)
  const fixture = await page.evaluate(async currentProjectId => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const project = await request(database.transaction('projects').objectStore('projects').get(currentProjectId)) as {
      activeWorldId: number
      activeWorkId: number
    }
    const outlines = await request(
      database.transaction('outlineNodes').objectStore('outlineNodes').index('projectId').getAll(currentProjectId),
    ) as Array<Record<string, any>>
    const chapters = await request(
      database.transaction('chapters').objectStore('chapters').index('projectId').getAll(currentProjectId),
    ) as Array<Record<string, any>>
    const sourceOutline = outlines.find(row => row.type === 'chapter')!
    const volume = outlines.find(row => row.type === 'volume')!
    const sourceChapter = chapters.find(row => row.outlineNodeId === sourceOutline.id)!
    const now = Date.now()
    const transaction = database.transaction(['outlineNodes', 'chapters', 'temporalFacts'], 'readwrite')
    await request(transaction.objectStore('outlineNodes').put({
      ...sourceOutline,
      summary: '潮门由完全开启改为只开启一半。',
      updatedAt: now,
    }))
    const targetOutlineNodeId = await request(transaction.objectStore('outlineNodes').add({
      projectId: currentProjectId,
      workId: project.activeWorkId,
      worldGroupId: sourceOutline.worldGroupId ?? null,
      parentId: volume.id,
      type: 'chapter',
      title: '第2章',
      summary: '钟楼照常回应',
      order: 1,
      createdAt: now,
      updatedAt: now,
    })) as number
    const targetChapterId = await request(transaction.objectStore('chapters').add({
      projectId: currentProjectId,
      workId: project.activeWorkId,
      outlineNodeId: targetOutlineNodeId,
      title: '第2章',
      content: '<p>钟楼仍按旧计划回应。</p>',
      wordCount: 11,
      status: 'draft',
      order: 1,
      notes: '',
      createdAt: now,
      updatedAt: now,
    })) as number
    const factId = await request(transaction.objectStore('temporalFacts').add({
      projectId: currentProjectId,
      workId: project.activeWorkId,
      worldGroupId: sourceOutline.worldGroupId ?? null,
      subjectType: 'location',
      subjectId: null,
      subjectName: '潮门',
      predicate: 'state',
      value: '完全开启',
      validFromChapterId: sourceChapter.id,
      validToChapterId: null,
      sourceChapterId: sourceChapter.id,
      sourceQuote: '潮门完全开启',
      sourceTextHash: '',
      status: 'confirmed',
      locked: false,
      createdAt: now,
      updatedAt: now,
    })) as number
    database.close()
    return {
      factId,
      sourceChapterId: sourceChapter.id as number,
      targetChapterId,
      targetOutlineNodeId,
    }
  }, projectId)

  await page.reload()
  await sidebarButton(page, '章节').click()
  await expect(page.locator('.tiptap-editor')).toContainText('潮门只开启一半')
  await page.getByRole('button', { name: '影响分析', exact: true }).click()
  await expect(page.getByText(/影响图已生成/)).toBeVisible()
  await page.getByLabel('作者复核项').selectOption({
    label: `复核事实 · temporalFacts#${fixture.factId}`,
  })
  await page.getByRole('button', { name: '需人工处理', exact: true }).click()
  await page.getByLabel('作者复核理由').fill('重新确认潮门的当前状态。')
  await page.getByRole('button', { name: '记录复核', exact: true }).click()
  await expect(page.getByText('最近决定：需人工处理', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开人工入口', exact: true }).click()

  await expect(page.getByRole('heading', { name: '事实库（NS-4 长期一致性）', exact: true })).toBeVisible()
  await expect(page.getByText('潮门', { exact: true })).toBeVisible()
  await page.getByTitle('确认为权威事实（Canon）').click()
  await page.getByRole('button', { name: '验证已保存修正', exact: true }).click()
  await expect(page.getByText('修正已验证并重新规划', { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: '返回来源章节', exact: true }).click()

  const dependencyReview = page.getByLabel('作者复核项')
  await expect(dependencyReview).toBeVisible({ timeout: 20_000 })
  await dependencyReview.selectOption({
    label: `复核后续正文 · chapters#${fixture.targetChapterId}`,
  })
  await page.getByRole('button', { name: '已确认', exact: true }).click()
  await page.getByLabel('作者复核理由').fill('已复核第二章正文，允许重建对应章纲摘要。')
  await page.getByRole('button', { name: '记录复核', exact: true }).click()
  await expect(page.getByText('最近决定：已确认', { exact: true })).toBeVisible()

  const regenerationTarget = page.getByLabel('生成式后续章纲目标')
  await expect(regenerationTarget).toBeVisible({ timeout: 20_000 })
  const targetValue = await regenerationTarget.locator('option').filter({ hasText: '第2章' }).getAttribute('value')
  expect(targetValue).toBeTruthy()
  await regenerationTarget.selectOption(targetValue!)
  await page.getByRole('button', { name: 'AI 重建章纲候选', exact: true }).click()
  await expect(page.getByText(regeneratedSummary, { exact: true })).toBeVisible({ timeout: 30_000 })
  expect(generationCalls).toBe(1)

  const pending = await page.evaluate(async ({ currentProjectId, targetId }) => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const target = await request(database.transaction('outlineNodes').objectStore('outlineNodes').get(targetId)) as { summary: string }
    const runs = await request(
      database.transaction('agentRuns').objectStore('agentRuns').index('projectId').getAll(currentProjectId),
    ) as Array<{ id: number; parentRunId: number | null; status: string; contractJson: string }>
    const child = runs.find(run => run.contractJson.includes('outline.impact-summary-regenerate'))!
    const parent = runs.find(run => run.id === child.parentRunId)!
    database.close()
    return { summary: target.summary, childStatus: child.status, parentStatus: parent.status }
  }, { currentProjectId: projectId, targetId: fixture.targetOutlineNodeId })
  expect(pending).toEqual({
    summary: '钟楼照常回应',
    childStatus: 'awaiting_confirmation',
    parentStatus: 'completed',
  })

  await page.reload()
  await sidebarButton(page, '章节').click()
  await expect(page.getByText('已恢复一条 H57 生成式后续章纲候选；确认前不会修改正式摘要。', { exact: true }))
    .toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(regeneratedSummary, { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)
  await page.getByRole('button', { name: '确认重建摘要', exact: true }).click()
  await expect(page.getByText(/后续章纲摘要已由作者确认写入/)).toBeVisible({ timeout: 20_000 })

  const completed = await page.evaluate(async ({ currentProjectId, targetId }) => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const target = await request(database.transaction('outlineNodes').objectStore('outlineNodes').get(targetId)) as { summary: string }
    const runs = await request(
      database.transaction('agentRuns').objectStore('agentRuns').index('projectId').getAll(currentProjectId),
    ) as Array<{
      id: number
      parentRunId: number | null
      status: string
      terminalReceiptHash: string | null
      contractJson: string
    }>
    const child = runs.find(run => run.contractJson.includes('outline.impact-summary-regenerate'))!
    const parent = runs.find(run => run.id === child.parentRunId)!
    database.close()
    return {
      summary: target.summary,
      childStatus: child.status,
      childReceiptLength: child.terminalReceiptHash?.length ?? 0,
      parentStatus: parent.status,
      parentReceiptLength: parent.terminalReceiptHash?.length ?? 0,
    }
  }, { currentProjectId: projectId, targetId: fixture.targetOutlineNodeId })
  expect(completed).toEqual({
    summary: regeneratedSummary,
    childStatus: 'completed',
    childReceiptLength: 64,
    parentStatus: 'completed',
    parentReceiptLength: 64,
  })
  expect(generationCalls).toBe(1)

  await page.reload()
  await sidebarButton(page, '章节').click()
  await expect(page.getByText(/生成式章纲重建回执/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('生成式后续章纲目标')).toHaveCount(0)
  expect(generationCalls).toBe(1)
})

test('Prompt 示例 AI 只进入编辑草稿，作者保存后才写全局模板', async ({ page }) => {
  let generationCalls = 0
  const systemDraft = '你是只用具体动作呈现人物犹疑的叙事编辑。'
  const userDraft = '请重写这段内容：{{userHint}}'
  const firstExample = '好示例一：她把未寄出的信重新压回抽屉。'
  const secondExample = '好示例二：门把转了半圈，又慢慢回到原处。'
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama',
      apiKey: '',
      model: 'prompt-examples-authoring-draft-e2e',
      baseUrl: 'http://localhost:1234/v1',
      temperature: 0,
      maxTokens: 0,
      contextWindow: 100000,
    }))
  })
  await page.route('http://localhost:1234/v1/chat/completions', async route => {
    generationCalls += 1
    const request = route.request().postDataJSON() as {
      messages?: Array<{ role: string; content: string }>
    }
    const combined = request.messages?.map(message => message.content).join('\n') ?? ''
    expect(combined).toContain(systemDraft)
    expect(combined).toContain(userDraft)
    expect(combined).not.toContain('E2E Prompt 草稿边界')
    const content = `${firstExample}\n===EXAMPLE===\n${secondExample}`
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        `data: ${JSON.stringify({
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 90, completion_tokens: 30, total_tokens: 120 },
        })}`,
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })

  await openCleanHome(page)
  await createProject(page, 'E2E Prompt 草稿边界')
  await sidebarButton(page, '提示词库').click()
  await page.getByRole('button', { name: '新建', exact: true }).click()

  const editor = page.locator('main')
  const nameInput = editor.locator('input[type="text"]').first()
  await nameInput.fill('E2E Prompt 示例草稿')
  const systemPrompt = editor.getByText('System Prompt', { exact: true })
    .locator('xpath=..').locator('textarea')
  const userPrompt = editor.getByText('User Prompt 模板', { exact: true })
    .locator('xpath=../..').locator('textarea')
  await systemPrompt.fill(systemDraft)
  await userPrompt.fill(userDraft)

  const generate = editor.getByRole('button', { name: 'AI 生成', exact: true }).first()
  await generate.click()
  await expect(editor.getByText(firstExample, { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('已将 2 条好示例加入当前草稿；点击顶部「保存」后才会生效。', { exact: true }))
    .toBeVisible()
  expect(generationCalls).toBe(1)

  const beforeSave = await page.evaluate(async () => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const templates = await request(database.transaction('promptTemplates').objectStore('promptTemplates').getAll()) as Array<{
      scope: string
      name: string
      systemPrompt: string
      userPromptTemplate: string
      examples?: unknown
    }>
    const runCount = await request(database.transaction('agentRuns').objectStore('agentRuns').count())
    database.close()
    return {
      template: templates.find(template => template.scope === 'user' && template.name === '未命名模板'),
      runCount,
    }
  })
  expect(beforeSave.template).toMatchObject({ systemPrompt: '', userPromptTemplate: '' })
  expect(beforeSave.template?.examples).toBeUndefined()
  expect(beforeSave.runCount).toBe(0)

  await editor.getByRole('button', { name: /^保存/ }).click()
  await expect.poll(async () => page.evaluate(async () => {
    const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      value.onsuccess = () => resolve(value.result)
      value.onerror = () => reject(value.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('storyforge')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    const templates = await request(database.transaction('promptTemplates').objectStore('promptTemplates').getAll()) as Array<{
      name: string
      examples?: { good?: Array<{ text: string }> }
    }>
    database.close()
    return templates.find(template => template.name === 'E2E Prompt 示例草稿')
      ?.examples?.good?.map(example => example.text) ?? []
  })).toEqual([firstExample, secondExample])

  await page.reload()
  await sidebarButton(page, '提示词库').click()
  await page.getByText('E2E Prompt 示例草稿', { exact: true }).first().click()
  await expect(editor.getByText(firstExample, { exact: true })).toBeVisible()
  expect(generationCalls).toBe(1)
})
