import { test, expect } from '@playwright/test'

test('061 recommendations restore independent choices and add only selected draft names, keeping author intent and formal keywords untouched', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let calls=0
  await context.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','history061-keyword-suggestions'))
  await context.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url())
    if(req.method()==='POST'&&url.pathname.endsWith('/synthetic-keywords/v1/chat/completions')) {
      calls++
      const sent=JSON.parse(req.postData()!).messages.map((row:{content:string})=>row.content).join('\n')
      expect(sent).toContain('已确认飞钱制度的完整描述');expect(sent).not.toContain('我的私有未确认意见')
      const captured=/主机(?:分配的)?草稿身份：(\[[^\n]*\])/.exec(sent)
      expect(captured).not.toBeNull()
      const ids=JSON.parse(captured![1]) as string[]
      const suggestions=ids.map((draftId,index)=>({draftId,keyword:`第${calls}批推荐${index+1}`,category:'economy',era:'custom',reason:'待确认设想：增加市井交换的创作方向。'}))
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({version:1,suggestions})},finish_reason:'stop'}],usage:{prompt_tokens:900,completion_tokens:200,total_tokens:1100}})})
    }
    return url.origin===origin&&['GET','HEAD'].includes(req.method())?route.continue():route.abort()
  })
  await page.goto('./')
  const scope=await page.evaluate(async endpoint=>{
    const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
    const {seedCurrentWorkspace}=await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const {useAIConfigStore}=await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const {useHistoricalStore}=await load<typeof import('../../src/stores/historical')>('/storyforge/src/stores/historical.ts')
    const f=await seedCurrentWorkspace('061 推荐关键词页面')
    await useHistoricalStore.getState().addKeyword({projectId:f.scope.projectId,keyword:'既有飞钱',category:'economy',era:'custom',description:'已确认飞钱制度的完整描述'},{projectId:f.scope.projectId,worldId:f.scope.worldId})
    useAIConfigStore.getState().setConfig({provider:'openai',apiKey:'synthetic-local-only',model:'gpt-4.1-mini',baseUrl:endpoint,maxTokens:0,temperature:0.35})
    return f.scope
  },`${origin}/synthetic-keywords/v1`)
  const read=()=>page.evaluate(async scope=>{
    const {readHistoryKeywordDraftsV1}=await(new Function('return import("/storyforge/src/lib/history/keyword-drafts.ts")'))()
    const {db}=await(new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return {drafts:(await readHistoryKeywordDraftsV1({scope,worldGroupId:null})).value.drafts,formal:await db.historicalKeywords.where('projectId').equals(scope.projectId).toArray()}
  },scope)
  await page.goto(`./workspace/${scope.projectId}?module=history`)
  await page.getByRole('button',{name:'历史细节风暴',exact:true}).click()
  await page.getByRole('button',{name:'整理关键词草稿',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'关键词草稿',exact:true})
  await dialog.getByRole('button',{name:'添加关键词草稿',exact:true}).click()
  await dialog.getByRole('textbox',{name:'草稿关键词名称',exact:true}).fill('作者原有私有草稿')
  await dialog.getByRole('textbox',{name:'草稿创作方向',exact:true}).fill('我的私有未确认意见')
  await dialog.getByRole('spinbutton',{name:'本批最多建议数',exact:true}).fill('2')
  await dialog.getByRole('button',{name:'推荐一批关键词',exact:true}).click()
  await expect(dialog.getByRole('checkbox',{name:'选择建议1：第1批推荐1',exact:true})).not.toBeChecked()
  await dialog.getByRole('textbox',{name:'建议1的关键词',exact:true}).fill('作者改名后的推荐词')
  await dialog.getByRole('checkbox',{name:'选择建议1：作者改名后的推荐词',exact:true}).check()
  await dialog.getByRole('button',{name:'关闭关键词草稿',exact:true}).click()
  await page.reload()
  await page.getByRole('button',{name:'历史细节风暴',exact:true}).click()
  await page.getByRole('button',{name:'整理关键词草稿',exact:true}).click()
  dialog=page.getByRole('dialog',{name:'关键词草稿',exact:true})
  await expect(dialog.getByRole('checkbox',{name:'选择建议1：作者改名后的推荐词',exact:true})).toBeChecked()
  expect(calls).toBe(1)
  await dialog.getByRole('button',{name:'加入所选建议到草稿（1）',exact:true}).click()
  await expect(dialog.getByRole('textbox',{name:'草稿关键词名称',exact:true})).toHaveValue('作者改名后的推荐词')
  await expect(dialog.getByRole('textbox',{name:'草稿条目内容',exact:true})).toHaveValue('')
  await expect(dialog.getByRole('textbox',{name:'草稿创作方向',exact:true})).toHaveValue('')
  let saved=await read()
  expect(saved.drafts).toHaveLength(2);expect(saved.drafts[0].conceptNote).toBe('我的私有未确认意见');expect(saved.formal).toHaveLength(1)
  await dialog.getByRole('textbox',{name:'草稿创作方向',exact:true}).fill('我为此词补充的真实意图')
  await dialog.getByRole('button',{name:'再推荐一批',exact:true}).click()
  await expect(dialog.getByRole('checkbox',{name:'选择建议1：第2批推荐1',exact:true})).toBeVisible()
  await dialog.getByRole('button',{name:'放弃本批建议',exact:true}).click()
  await expect(dialog.getByRole('button',{name:'再推荐一批',exact:true})).toBeVisible()
  saved=await read()
  expect(saved.drafts).toHaveLength(2);expect(saved.drafts[1]).toMatchObject({keyword:'作者改名后的推荐词',conceptNote:'我为此词补充的真实意图'});expect(saved.formal).toHaveLength(1);expect(calls).toBe(2)
})
