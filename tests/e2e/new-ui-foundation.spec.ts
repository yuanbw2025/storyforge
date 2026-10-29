import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

test('retired navigation and standalone tools always use the approved application shell', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('storyforge-theme','warm'))
  for(const path of ['?tab=home&legacy=1','?tab=worlds&legacy=1','?tab=nodes&legacy=1','?tab=market&legacy=1','settings?returnTo=%2Fplay','play','play/fog-harbor','play/session/999999']) {
    await page.goto(`./${path}`)
    await expect(page.locator('.longform-app')).toBeVisible()
    await expect(page.locator('.sf-product-shell')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme','storyforge')
    await expect(page.getByRole('navigation',{name:'产品导航'})).toBeVisible()
  }
  await expect(page.getByRole('alert')).toContainText('没有这份跑团存档')
  await page.goto('./settings?returnTo=%2Fplay')
  await expect(page).toHaveURL(/home\/settings\?returnTo=%2Fplay/)
  await page.getByRole('button',{name:'返回之前的页面',exact:true}).click()
  await expect(page).toHaveURL(/\/play$/)
  await expect(page.locator('.longform-app')).toBeVisible()
})

test('portal dialogs use the shared palette and browser reload never restores an old theme', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('storyforge-theme','forge'))
  await createLongform(page,'新界面弹窗验证')
  await page.goto('./long')
  await page.getByRole('button',{name:'重命名',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await expect(dialog).toHaveCSS('background-color','rgb(250, 248, 241)')
  await expect(dialog).toHaveCSS('border-radius','12px')
  await dialog.getByRole('textbox').fill('新界面保留作品')
  await dialog.getByRole('button',{name:'保存名称',exact:true}).click()
  await expect(page.getByRole('heading',{name:'新界面保留作品',exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading',{name:'新界面保留作品',exact:true})).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme','storyforge')
})

test('current cross-product shell remains navigable on a narrow screen',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('./community/market')
  await page.getByRole('button',{name:'页面目录',exact:true}).click()
  await page.getByRole('navigation',{name:'社区与发行导航'}).getByRole('link',{name:'通用设置',exact:true}).click()
  await expect(page).toHaveURL(/home\/settings$/)
  await expect(page.locator('.longform-app')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
