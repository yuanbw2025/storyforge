import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const routes = ['library','intent','story','chapters','editor','review','versions','derive','community','settings']
test('shortform route surfaces remain editable and fit desktop and narrow screens', async ({ page }, info) => {
  test.setTimeout(180000)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./short/intent')
  await page.getByRole('button',{name:'选择或创建短篇'}).click()
  await page.getByLabel('新短篇名称').fill('风暴夜的守灯人')
  await page.getByLabel('新短篇目标字数').fill('5000')
  await page.getByLabel('新短篇章节数').fill('3')
  await page.getByRole('button',{name:'创建并进入当前页面'}).click()
  await expect(page.getByLabel('故事前提',{exact:true})).toBeVisible()
  const project = new URL(page.url()).searchParams.get('project')!
  const output = process.env.SHORT_LAYOUT_SHOTS || info.outputPath('screens')
  mkdirSync(output,{recursive:true})
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900})
    for (const route of routes) {
      await page.goto(`./short/${route}?project=${project}`)
      await expect(page.locator('.lf-heading h2')).toBeVisible()
      if (['intent','story','chapters','editor','review','versions'].includes(route)) await expect(page.getByTestId('short-novel-studio')).toBeVisible()
      if (route==='editor') await expect(page.locator('.ProseMirror[contenteditable=true]')).toBeVisible()
      await page.screenshot({path:path.join(output,`${width}-${route}.png`)})
      if (process.env.SHORT_LAYOUT_BASELINE !== '1') {
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
        expect(await page.locator('.lf-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true)
        if (route==='intent') expect((await page.getByLabel('故事前提',{exact:true}).boundingBox())!.y).toBeLessThan(width===390?450:400)
      }
      if (route==='versions') {
        await page.getByText('完整备份、导入与恢复',{exact:true}).click()
        await page.screenshot({path:path.join(output,`${width}-versions-backup.png`)})
      }
      if (route==='editor') {
        await page.getByRole('button',{name:'查找替换',exact:true}).click()
        await page.screenshot({path:path.join(output,`${width}-editor-find.png`)})
      }
      if (route==='intent') {
        const summary=page.locator('.short-instruction summary')
        if (await summary.count()) await summary.click()
        await page.screenshot({path:path.join(output,`${width}-intent-instruction.png`)})
      }
    }
  }
  if (process.env.SHORT_LAYOUT_BASELINE !== '1') {
    await page.setViewportSize({width:1440,height:900})
    await page.goto(`./short/intent?project=${project}`)
    await page.getByRole('button',{name:'修改作品名称'}).click()
    await page.getByRole('dialog').getByRole('textbox').fill('作者修改后的短篇名称')
    await page.getByRole('button',{name:'保存名称',exact:true}).click()
    await expect(page.locator('.short-work-tools')).toContainText('作者修改后的短篇名称')
    await page.getByRole('button',{name:'编辑作品简介'}).click()
    await page.getByRole('dialog').getByRole('textbox').fill('作者保存的作品简介')
    await page.getByRole('button',{name:'保存简介',exact:true}).click()
    await expect(page.locator('.short-work-tools>span')).toHaveAttribute('title','作者保存的作品简介')
    await page.reload()
    await page.getByRole('button',{name:'编辑作品简介'}).click()
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('作者保存的作品简介')
  }
})
