import { test, expect } from '@playwright/test'
import { WORLD_PAGES } from '../../src/components/world-engine/navigation'
const sizes = [{ width: 1728, height: 997 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]

for (const size of sizes) test(`世界全部页面与注册子模块可达，删除类别说明和属性外壳 ${size.width}`, async ({ page }, info) => {
  test.setTimeout(360000)
  await page.goto('./world/worlds')
  const id = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const { createWorkspace } = await load('/storyforge/src/lib/workspace/create-workspace.ts')
    return (await createWorkspace({ name: '世界布局检查', description: '合成世界布局样本', genres: [], status: 'drafting', targetWordCount: 300000 }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })).project.id
  })
  await page.setViewportSize(size)
  for (const route of WORLD_PAGES) {
    for (const module of route.modules?.map(([id]) => id) ?? [null]) {
      await page.goto(`./world/${route.id}?project=${id}${module ? `&module=${module}` : ''}`)
      await expect(page.getByTestId('world-engine-page')).toBeVisible()
      await expect(page.locator('.lf-content')).not.toContainText('打开世界功能…')
      if (module && !['settings', 'world-overview'].includes(module)) {
        await expect(page.locator('[data-workspace-ready="world"]')).toBeVisible()
        await expect(page.locator('.workspace-module-body')).not.toContainText('面板加载中…')
        await expect(page.getByRole('button', { name: '打开属性面板', exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '打开 AI 对话副驾', exact: true })).toBeVisible()
      }
      await expect(page.locator('.we-content-heading')).toHaveCount(0)
      if (size.width > 700 && ['world-rules', 'worldview-natural'].includes(module ?? '')) {
        expect((await page.locator('.we-editor').boundingBox())!.y).toBeLessThan(170)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await page.locator('.lf-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${route.id}-${module ?? 'index'}-${size.width}.png`) })
    }
  }
})

test('世界AI副驾保留，长篇属性面板继续可打开关闭', async ({ page }) => {
  await page.goto('./world/worlds')
  await page.getByRole('button', { name: '新建世界', exact: true }).click()
  await page.getByLabel('新世界名称').fill('副驾与属性隔离')
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await expect(page.locator('[data-workspace-ready="world"]')).toBeVisible()
  await page.getByRole('button', { name: '打开 AI 对话副驾', exact: true }).click()
  await expect(page.getByRole('button', { name: '关闭 AI 对话副驾', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '关闭 AI 对话副驾', exact: true }).first().click()
  const firstWorld = new URL(page.url()).searchParams.get('project')!
  await page.goto('./world/worlds')
  await page.getByRole('button', { name: '新建世界', exact: true }).click()
  await page.getByLabel('新世界名称').fill('第二个世界')
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await expect(page.locator('.lf-current')).toContainText('第二个世界')
  await expect(page.getByRole('button', { name: '打开 AI 对话副驾', exact: true })).toHaveCount(1)
  await page.goto(`./world/basics?project=${firstWorld}`)
  await expect(page.locator('.lf-current')).toContainText('副驾与属性隔离')
  await expect(page.getByRole('button', { name: '打开 AI 对话副驾', exact: true })).toHaveCount(1)
  const id = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const { createWorkspace } = await load('/storyforge/src/lib/workspace/create-workspace.ts')
    return (await createWorkspace({ name: '长篇属性反例', description: '', genres: [], status: 'drafting', targetWordCount: 300000 }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })).project.id
  })
  await page.goto(`./workspace/${id}?module=info`)
  await page.getByRole('button', { name: '打开属性面板', exact: true }).click()
  await expect(page.getByRole('button', { name: '关闭属性面板', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '关闭属性面板', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '打开属性面板', exact: true })).toBeVisible()
})


test('手机规则选择后编辑区完整可达，保存及刷新保持原世界', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./world/worlds')
  await page.getByRole('button', { name: '新建世界', exact: true }).click()
  await page.getByLabel('新世界名称').fill('手机规则世界')
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await page.locator('.we-module-world-rules').getByRole('button', { name: /总览/ }).click()
  const editor = page.getByPlaceholder('这个维度中有哪些内容是取自真实历史或现实的？例如：使用唐朝开元年间真实官制三省六部')
  await editor.fill('手机规则原始保存证据')
  await editor.blur()
  await editor.scrollIntoViewIfNeeded()
  const box = (await editor.boundingBox())!
  expect(box.width).toBeGreaterThan(260)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: info.outputPath('mobile-rule-editor.png') })
  await page.reload()
  await page.locator('.we-module-world-rules').getByRole('button', { name: /总览/ }).click()
  await expect(editor).toHaveValue('手机规则原始保存证据')
})

test('世界库新建取消、长名称和搜索无结果保持紧凑可用', async ({ page }, info) => {
  await page.goto('./world/worlds')
  await page.getByRole('button', { name: '新建世界', exact: true }).click()
  await page.getByLabel('新世界名称').fill('取消不创建')
  await page.getByRole('button', { name: '继续浏览', exact: true }).click()
  await expect(page.locator('.lf-library-grid article')).toHaveCount(0)
  await page.getByRole('button', { name: '新建世界', exact: true }).click()
  const title = '长名称的世界'.repeat(15)
  await page.getByLabel('新世界名称').fill(title)
  await page.getByRole('button', { name: '创建世界', exact: true }).click()
  await expect(page).toHaveURL(/project=/)
  await page.goto('./world/worlds')
  for (const size of sizes) {
    await page.setViewportSize(size)
    await expect(page.locator('.lf-library-grid h3')).toHaveText(title)
    expect(await page.locator('.lf-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`long-title-${size.width}.png`) })
    await page.getByLabel('搜索本地世界').fill('不匹配的搜索词')
    await expect(page.getByRole('status')).toHaveText('没有找到匹配的本地世界，请更换搜索词。')
    await expect(page.locator('.lf-library-grid article')).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`no-results-${size.width}.png`) })
    await page.getByLabel('搜索本地世界').fill('')
  }
})
