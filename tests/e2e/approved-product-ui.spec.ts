import { expect, test } from '@playwright/test'
import { products } from '../../ui-preview/src/catalog'

test('approved home, every product and live longform share complete navigation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await page.goto(page.url().replace(/\/$/, ''))
  await expect(page).toHaveURL(/\/storyforge\/$/)
  await expect(page.getByRole('heading', { name: /天地为炉/ })).toBeVisible()
  await expect(page.getByText('你的创作与游玩空间', { exact: true })).toHaveCount(0)
  const catalog = products.filter(product => product.id !== 'community')
  for (const product of catalog) {
    const nav = page.getByRole('navigation', { name: '产品导航', exact: true })
    await expect(nav.locator('button, a')).toHaveText(catalog.map(item => item.short))
    await nav.getByText(product.short, { exact: true }).click()
    if (product.id === 'home') await expect(page.getByTestId('home-page')).toBeVisible()
    else if (product.id === 'world') await expect(page.getByTestId('world-engine-page')).toBeVisible()
    else if (product.id === 'long') await expect(page.getByRole('navigation', { name: '长篇一级导航' })).toBeVisible()
    else if (product.id === 'chat') await expect(page.getByTestId('character-chat-page')).toBeVisible()
    else if (product.id === 'short') await expect(page.getByRole('navigation', {name:'短篇页面导航'})).toBeVisible()
    else if(product.id==='avg') await expect(page.getByTestId('avg-page')).toBeVisible()
    else if(product.id==='comic') await expect(page.getByRole('navigation',{name:'漫画页面导航'})).toBeVisible()
    else if(product.id==='script') await expect(page.getByRole('navigation',{name:'剧本页面导航'})).toBeVisible()
    else if(product.id==='motion') await expect(page.getByRole('navigation',{name:'漫剧素材页面导航'})).toBeVisible()
    else if(product.id==='town') await expect(page.getByTestId('town-author-page')).toBeVisible()
    else if(product.id==='ttrpg') await expect(page.getByTestId('ttrpg-author-page')).toBeVisible()
    else if(product.id==='adventure') await expect(page.getByRole('navigation',{name:'文字冒险导航'})).toBeVisible()
    else await expect(page.getByTestId('approved-product-ui')).toBeVisible()
    const url = page.url()
    await page.reload()
    await expect(page).toHaveURL(url)
    await expect(page.getByRole('navigation', { name: '产品导航' })).toBeVisible()
  }
  await page.getByRole('navigation', { name: '产品导航' }).getByText('长篇', { exact: true }).click()
  await page.getByRole('navigation', { name: '产品导航' }).getByText('首页', { exact: true }).click()
  await expect(page.getByRole('heading', { name: /天地为炉/ })).toBeVisible()
  await page.screenshot({ path: '/tmp/storyforge-restored-home.png' })
  expect(errors).toEqual([])
})

test('shortform pages remain browsable without creating a work', async ({ page }) => {
  await page.goto('./short')
  const short = products.find(product => product.id === 'short')!
  for (const item of [...short.pages.map(item=>({...item,label:item.id==='library'?'作品库':item.label})),{id:'community',label:'社区与发行'},{id:'settings',label:'通用设置'}]) {
    await page.getByRole('navigation', {name:'短篇页面导航'}).getByRole('button', { name: item.label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/short/${item.id}$`))
    await expect(page.locator('.lf-heading')).toContainText(item.label)
    await page.reload()
    await expect(page.locator('.lf-heading')).toContainText(item.label)
  }
  await page.goto('./short/intent')
  await expect(page.getByRole('button', {name:'选择或创建短篇'})).toBeVisible()
  const count = await page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('storyforge-core')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('works', 'readonly')
        const query = tx.objectStore('works').count()
        query.onsuccess = () => resolve(query.result)
        tx.oncomplete = () => db.close()
      }
    })
  })
  expect(count).toBe(0)
  await page.goto('./short/intent')
  await expect(page.getByRole('button', {name:'选择或创建短篇'})).toBeVisible()
  await page.screenshot({ path: '/tmp/storyforge-restored-short.png' })
})

test('mobile navigation reaches shortform and home without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./long')
  await page.getByRole('navigation', { name: '产品导航' }).getByText('短篇', { exact: true }).click()
  await expect(page).toHaveURL(/short$/)
  await page.getByRole('button', { name: '短篇导航', exact: true }).click()
  await page.getByRole('navigation', {name:'短篇页面导航'}).getByRole('button', { name: '创作意图', exact: true }).click()
  await expect(page).toHaveURL(/short\/intent$/)
  await expect(page.getByRole('button', {name:'选择或创建短篇'})).toBeVisible()
  await page.getByRole('navigation', { name: '产品导航' }).getByText('首页', { exact: true }).click()
  await expect(page.getByRole('heading', { name: /天地为炉/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '/tmp/storyforge-restored-mobile.png' })
})
