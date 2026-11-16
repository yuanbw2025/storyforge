import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import { expect, test } from '@playwright/test'

test('shortform drafts and edited AI candidates survive navigation and refresh before explicit adoption',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('storyforge_guide_completed','e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://short-test.invalid/v1', model: 'gpt-4o', temperature: 0.2, maxTokens: 4000, apiKey: 'isolated-test-key' })
  let calls=0
  await page.route('https://short-test.invalid/**',async route=>{
    calls++
    expect(JSON.stringify(route.request().postDataJSON())).toContain('不会自动保存为正式设定')
    const brief={version:1,premise:'旧港守灯人必须在风暴夜作出选择。',coreChange:'从等待过去到迎接明天。',dominantEmotion:'克制的希望',pointOfView:'third-limited',tense:'past',audience:'中文短篇读者',storyPromise:'以熄灯的代价兑现开篇承诺。',mustKeep:['旧灯'],forbidden:[],targetWordCount:5000,chapterCount:3}
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(brief)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './short/editor')
  await page.getByRole('button',{name:'选择或创建短篇'}).click()
  await page.getByLabel('新短篇名称').fill('短篇恢复验收')
  await page.getByLabel('新短篇目标字数').fill('5000')
  await page.getByLabel('新短篇章节数').fill('3')
  await page.getByRole('button',{name:'创建并进入当前页面'}).click()
  await expect(page).toHaveURL(/short\/editor\?project=\d+/)
  const nav=page.getByRole('navigation',{name:'短篇页面导航'})
  await nav.getByRole('button',{name:'创作意图',exact:true}).click()
  await page.getByLabel('故事前提',{exact:true}).fill('不会自动保存为正式设定')
  await nav.getByRole('button',{name:'故事设计',exact:true}).click()
  await nav.getByRole('button',{name:'创作意图',exact:true}).click()
  await expect(page.getByLabel('故事前提',{exact:true})).toHaveValue('不会自动保存为正式设定')
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('故事前提',{exact:true})).toHaveValue('不会自动保存为正式设定')
  await page.getByRole('button',{name:'AI 生成候选',exact:true}).click()
  await expect(page.locator('.short-candidate')).toBeVisible()
  await page.getByLabel('故事前提',{exact:true}).fill('作者修订后的旧港守灯故事。')
  await nav.getByRole('button',{name:'版本与导出',exact:true}).click()
  await expect(page.getByText('创作 Brief 尚未确认',{exact:false})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('故事前提',{exact:true})).toHaveValue('作者修订后的旧港守灯故事。')
  expect(calls).toBe(1)
  await page.getByRole('button',{name:'作者确认并采纳',exact:true}).click()
  await expect(page).toHaveURL(/short\/story\?project=\d+/)
  await nav.getByRole('button',{name:'创作意图',exact:true}).click()
  await expect(page.getByLabel('故事前提',{exact:true})).toHaveValue('作者修订后的旧港守灯故事。')
  await page.screenshot({path:'/tmp/storyforge-short-live-desktop.png'})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'/tmp/storyforge-short-live-mobile.png'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
