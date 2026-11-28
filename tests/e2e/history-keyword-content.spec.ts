import { test, expect } from '@playwright/test'

test('061 batch and single-field content restore choices, preserve unselected fields, and become formal only after explicit creation',async({page,context,baseURL})=>{
  const origin=new URL(baseURL!).origin
  let calls=0
  const requests:Array<{mode:string;targets:Array<{draftId:string;fields:string[]}>}>=[]
  await context.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','history061-keyword-content'))
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(req.method()==='POST'&&url.pathname.endsWith('/synthetic-keyword-content/v1/chat/completions')){
      calls++
      const sent=JSON.parse(req.postData()!).messages.map((row:{content:string})=>row.content).join('\n')
      expect(sent).toContain('正式历史的完整只读约束');expect(sent).toContain('作者原有正文')
      const captured=/本次作者草稿与固定字段范围：(\{[^\n]*\})/.exec(sent);expect(captured).not.toBeNull()
      const input=JSON.parse(captured![1]);requests.push(input.request)
      const patches=input.request.targets.map((target:{draftId:string;fields:string[]})=>({draftId:target.draftId,values:Object.fromEntries(target.fields.map(field=>[field,`待确认第${calls}批${field}候选`]))}))
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({version:1,patches})}}],usage:{prompt_tokens:1200,completion_tokens:400,total_tokens:1600}})})
    }else if(req.method()==='POST')throw Error(`unexpected external request ${url.pathname}`)
    else await route.continue()
  })
  await page.goto('./')
  const seeded=await page.evaluate(async endpoint=>{
    const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
    const {seedCurrentWorkspace}=await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const {useAIConfigStore}=await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const {useHistoricalStore}=await load<typeof import('../../src/stores/historical')>('/storyforge/src/stores/historical.ts')
    const {createHistoryKeywordDraftV1,saveHistoryKeywordDraftsV1}=await load<typeof import('../../src/lib/history/keyword-drafts')>('/storyforge/src/lib/history/keyword-drafts.ts')
    const f=await seedCurrentWorkspace('061 关键词内容页面'),first={...createHistoryKeywordDraftV1('盐路飞钱'),description:'作者原有正文',conceptNote:'作者真实创作方向',selected:true},second={...createHistoryKeywordDraftV1('灰潮灯市'),selected:true}
    await saveHistoryKeywordDraftsV1({scope:f.scope,worldGroupId:null,expectedRevision:null,value:{version:1,drafts:[first,second]}})
    await useHistoricalStore.getState().addKeyword({projectId:f.scope.projectId,keyword:'正式历史',category:'institution',era:'custom',description:'正式历史的完整只读约束'},{projectId:f.scope.projectId,worldId:f.scope.worldId})
    useAIConfigStore.getState().setConfig({provider:'openai',apiKey:'synthetic-local-only',model:'gpt-4.1-mini',baseUrl:endpoint,maxTokens:0,temperature:0.35})
    return {scope:f.scope,first,second}
  },`${origin}/synthetic-keyword-content/v1`)
  const read=()=>page.evaluate(async scope=>{
    const {readHistoryKeywordDraftsV1}=await(new Function('return import("/storyforge/src/lib/history/keyword-drafts.ts")'))(),{db}=await(new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return {drafts:(await readHistoryKeywordDraftsV1({scope,worldGroupId:null})).value.drafts,formal:await db.historicalKeywords.where('projectId').equals(scope.projectId).toArray()}
  },seeded.scope)
  await page.goto(`./workspace/${seeded.scope.projectId}?module=history`)
  await page.getByRole('button',{name:'历史细节风暴',exact:true}).click();await page.getByRole('button',{name:'整理关键词草稿',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'关键词草稿',exact:true})
  await dialog.getByRole('checkbox',{name:'生成字段：地点',exact:true}).check()
  await dialog.getByRole('button',{name:'生成所选条目',exact:true}).click()
  await expect(dialog.getByRole('region',{name:'本次条目生成范围',exact:true})).toContainText('2 个草稿');expect(calls).toBe(0)
  await dialog.getByRole('button',{name:'取消本次生成',exact:true}).click();expect(calls).toBe(0)
  await dialog.getByRole('button',{name:'生成所选条目',exact:true}).click();await dialog.getByRole('button',{name:'确认生成这些字段',exact:true}).click()
  await expect(dialog.getByRole('checkbox',{name:'采纳盐路飞钱的地点',exact:true})).not.toBeChecked()
  expect(requests[0].targets).toEqual([{draftId:seeded.first.draftId,fields:['location']},{draftId:seeded.second.draftId,fields:['description','location']}])
  await dialog.getByRole('checkbox',{name:'采纳盐路飞钱的地点',exact:true}).check()
  await dialog.getByRole('textbox',{name:'候选灰潮灯市的条目内容',exact:true}).fill('作者修改后的条目候选')
  await dialog.getByRole('checkbox',{name:'采纳灰潮灯市的条目内容',exact:true}).check()
  await dialog.getByRole('button',{name:'关闭关键词草稿',exact:true}).click();await page.reload()
  await page.getByRole('button',{name:'历史细节风暴',exact:true}).click();await page.getByRole('button',{name:'整理关键词草稿',exact:true}).click();dialog=page.getByRole('dialog',{name:'关键词草稿',exact:true})
  await expect(dialog.getByRole('textbox',{name:'候选灰潮灯市的条目内容',exact:true})).toHaveValue('作者修改后的条目候选');await expect(dialog.getByRole('checkbox',{name:'采纳盐路飞钱的地点',exact:true})).toBeChecked();expect(calls).toBe(1)
  await dialog.getByRole('button',{name:'采纳所选字段到草稿',exact:true}).click()
  await expect(dialog.getByRole('textbox',{name:'草稿地点',exact:true})).toHaveValue('待确认第1批location候选')
  let saved=await read();expect(saved.formal).toHaveLength(1);expect(saved.drafts[0]).toMatchObject({...seeded.first,location:'待确认第1批location候选'});expect(saved.drafts[1]).toMatchObject({...seeded.second,description:'作者修改后的条目候选',location:''})
  // A single-field rewrite uses the same original request/candidate/adoption path.
  await dialog.getByRole('combobox',{name:'条目内容生成方式',exact:true}).selectOption('rewrite');await dialog.getByRole('combobox',{name:'单字段生成目标',exact:true}).selectOption('location')
  await dialog.getByRole('button',{name:'生成当前字段',exact:true}).click();await dialog.getByRole('button',{name:'确认生成这些字段',exact:true}).click()
  await expect(dialog.getByRole('checkbox',{name:'采纳盐路飞钱的地点',exact:true})).toBeVisible();expect(requests[1]).toEqual({mode:'rewrite',targets:[{draftId:seeded.first.draftId,fields:['location']}]})
  await dialog.getByRole('button',{name:'放弃本批内容',exact:true}).click();saved=await read();expect(saved.drafts[0].location).toBe('待确认第1批location候选');expect(saved.formal).toHaveLength(1);expect(calls).toBe(2)
  await dialog.getByRole('button',{name:'新建所选词条（2）',exact:true}).click()
  await expect.poll(async()=>(await read()).formal.length).toBe(3)
  saved=await read();expect(saved.formal.find((row:{keyword:string})=>row.keyword==='盐路飞钱')).toMatchObject({description:'作者原有正文',conceptNote:'作者真实创作方向',location:'待确认第1批location候选'});expect(calls).toBe(2)
})
