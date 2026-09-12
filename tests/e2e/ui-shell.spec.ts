import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'bronze-shell-e2e')
    localStorage.removeItem('storyforge-theme')
  })
})

test('青铜青绿连续外框覆盖首页和通用设置，窄屏无横向溢出', async ({ page }, testInfo) => {
  await page.goto('./')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'bronze')
  await expect(page.getByRole('banner')).toContainText('StoryForge')
  await expect(page.getByRole('navigation', { name: '产品页签' })).toBeVisible()
  await expect(page.getByTestId('product-context-nav')).toBeVisible()
  await expect(page.getByRole('heading', { name: '我的创作空间', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('home-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: '通用设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '通用设置', exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '设置导航' })).toContainText('模型与连接')
  await expect(page.getByText('具体产品的来源适配、生产参数与发布配置仍在对应产品内管理。')).toBeVisible()
  await expect(page.locator('#settings-ai').getByRole('heading', { name: '模型与连接', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('settings-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png'), fullPage: true })
})

test('长篇三种模式并列切换并在刷新后恢复节点工作区', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /长篇小说/ }).click()
  await page.getByLabel('名称').fill('青铜外框验收长篇')
  await page.getByRole('button', { name: '创建长篇小说', exact: true }).click()

  const modes = page.getByRole('navigation', { name: '长篇创作模式' })
  await expect(modes.getByRole('button', { name: '分步骤模式', exact: true })).toBeVisible()
  await expect(modes.getByRole('button', { name: /节点模式/ })).toBeVisible()
  await expect(modes.getByRole('button', { name: 'Agent 创作', exact: true })).toBeVisible()

  await modes.getByRole('button', { name: 'Agent 创作', exact: true }).click()
  await expect(page).toHaveURL(/mode=agent/)
  await expect(page.getByLabel('关闭 AI 对话副驾')).toBeVisible()
  await modes.getByRole('button', { name: /节点模式/ }).click()
  await expect(page).toHaveURL(/module=visual-workflows.*mode=nodes|mode=nodes.*module=visual-workflows/)
  await expect(page.getByTestId('node-authoring-workspace')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('node-authoring-workspace')).toBeVisible()
  await expect(modes.getByRole('button', { name: /节点模式/ })).toHaveClass(/active/)
  await page.screenshot({ path: testInfo.outputPath('workspace-nodes-desktop.png'), fullPage: true })
})

test('世界状态和文字游戏专属生产链在同一外框内可见', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('雾海群岛')
  await page.getByPlaceholder('一句话描述这个世界或作品').fill('被雾潮连接的群岛与守灯人。')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()

  const status = page.getByRole('region', { name: '世界内容与版本状态' })
  await expect(status).toContainText('本机记录已载入')
  await expect(status).toContainText('仅引用封存版本')
  await expect(page.getByTestId('world-sharing-panel')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('world-engine-desktop.png'), fullPage: true })

  await page.getByTestId('product-more-menu').click()
  await page.getByTestId('product-tab-text-games').click()
  const lifecycle = page.getByTestId('product-lifecycle')
  await expect(lifecycle).toContainText('文字冒险适配器')
  await expect(lifecycle).toContainText('制作与发布')
  await expect(lifecycle).toContainText('成果与运行')
  await expect(page.getByText('面板加载中…')).toBeHidden({ timeout: 20_000 })
  await page.screenshot({ path: testInfo.outputPath('text-game-desktop.png'), fullPage: true })
})

test('独立游戏入口沿用全局顶栏和当前产品导航', async ({ page }, testInfo) => {
  await page.goto('./play/mist-harbor')
  await expect(page.getByTestId('product-route-shell')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '产品页签' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: '雾港：失潮钟声功能导航' })).toContainText('作品介绍')
  await expect(page.getByRole('heading', { name: /雾港.*失潮钟声/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mist-harbor-shell-desktop.png'), fullPage: true })

  await page.goto('./play')
  await expect(page.getByTestId('product-route-shell')).toBeVisible()
  await expect(page.getByRole('complementary', { name: '跑团作品功能导航' })).toContainText('原创冒险')
  await expect(page.getByRole('heading', { name: /坐下来/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('ttrpg-community-shell-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByTestId('product-route-context-nav')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('ttrpg-community-shell-mobile.png'), fullPage: true })
})
