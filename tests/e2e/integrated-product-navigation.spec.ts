import { expect, test } from '@playwright/test'

for (const [product, navName, labels, entry, contentName, contentLabel] of [
 ['comic','漫画页面导航',['作品库','漫画制作台','阅读预览','版本与导出','通用设置'],'漫画制作台','漫画内容分类','页格分镜'],
 ['motion','漫剧素材页面导航',['作品库','漫剧制作台','版本与交付','通用设置'],'漫剧制作台','漫剧素材内容分类','参考帧'],
 ['chat','角色聊天主导航',['作品库','世界引擎','制作台','发布与版本','游玩'],'制作台','角色聊天页内目录','记忆与边界'],
] as const) {
 test(`${product}: primary operations, nested content, direct reload and mobile access`,async({page})=>{
  await page.goto(`./${product}/library`)
  const nav=page.getByRole('navigation',{name:navName,exact:true})
  await expect(nav.getByRole('button')).toHaveText([...labels])
  await expect(nav.getByRole('button',{name:contentLabel,exact:true})).toHaveCount(0)
  await nav.getByRole('button',{name:entry,exact:true}).click()
  const contents=page.getByRole('navigation',{name:contentName,exact:true})
  await contents.getByRole('button',{name:contentLabel,exact:true}).click()
  await page.reload()
  await expect(contents.getByRole('button',{name:contentLabel,exact:true})).toHaveAttribute('aria-current','page')
  await expect(nav.getByRole('button',{name:entry,exact:true})).toHaveAttribute('aria-current','page')
  await page.screenshot({path:`/tmp/integrated-${product}-desktop.png`,fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await expect(contents.getByRole('button',{name:contentLabel,exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)).toBe(true)
  await page.screenshot({path:`/tmp/integrated-${product}-mobile.png`,fullPage:true})
 })
}
test('adventure: real product entry persists across pages', async ({ page }) => {
 const pages = [['library', '作品与试玩'], ['vision', '产品定向'], ['play', '开始冒险']] as const
 for (const [section, heading] of pages) {
  await page.goto(`./adventure/${section}`)
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  await expect(page.getByText('文字冒险 · 可验证预览', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
 }
})

test('openworld: real product entry persists across pages', async ({ page }) => {
 const pages = [['', '制作与试玩'], ['runtime', '制作与试玩'], ['vision', '产品定向'], ['play', '开始冒险']] as const
 for (const [section, heading] of pages) {
  await page.goto(`./openworld${section ? `/${section}` : ''}`)
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  await expect(page.getByText('文字开放世界 · 展示作品与创作', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
 }
})
