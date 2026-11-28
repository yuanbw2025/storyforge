import { test, expect } from '@playwright/test'

test('061 one joint request restores independent field choice and preserves the unselected original calendar',async({page,context,baseURL})=>{
  const origin=new URL(baseURL!).origin
  let calls=0
  await context.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','history061-joint-text'))
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(req.method()==='POST'&&url.pathname.endsWith('/synthetic-history-joint/v1/chat/completions')){
      calls++;const sent=JSON.parse(req.postData()!).messages.map((row:{content:string})=>row.content).join('\n');expect(sent).toContain('同一份完整输入');expect(sent).toContain('作者原总述');expect(sent).toContain('作者原纪年')
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({version:1,values:{overview:'待确认总述：灰潮后初燃炭火。',eraSystem:'待确认纪年：炭火元年起，每月九日。'}})}}],usage:{prompt_tokens:1000,completion_tokens:200,total_tokens:1200}})})
    }
    return url.origin===origin&&['GET','HEAD'].includes(req.method())?route.continue():route.abort()
  })
  await page.goto('./')
  const scope=await page.evaluate(async endpoint=>{
    const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
    const {seedCurrentWorkspace}=await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts'),{useHistoryStore}=await load<typeof import('../../src/stores/project-singletons')>('/storyforge/src/stores/project-singletons.ts'),{useAIConfigStore}=await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const f=await seedCurrentWorkspace('061 联合历史页面')
    await useHistoryStore.getState().saveForHistoryAuthorV1({origin:{version:1,kind:'work',scope:f.scope},selection:{kind:'partition',worldGroupId:null},patch:{overview:'作者原总述',eraSystem:'作者原纪年'}})
    useAIConfigStore.getState().setConfig({provider:'openai',apiKey:'synthetic-local-only',model:'gpt-4.1-mini',baseUrl:endpoint,maxTokens:0,temperature:0.35});return f.scope
  },`${origin}/synthetic-history-joint/v1`)
  const read=()=>page.evaluate(async projectId=>{const {db}=await(new Function('return import("/storyforge/src/lib/db/schema.ts")'))();return (await db.histories.where('projectId').equals(projectId).toArray())[0]},scope.projectId)
  await page.goto(`./workspace/${scope.projectId}?module=history`)
  await page.getByRole('button',{name:'历史总述与纪年',exact:true}).click();await page.getByText('更多历史起草',{exact:true}).click();await page.getByRole('button',{name:'联合起草历史总述与纪年',exact:true}).click()
  let dialog=page.getByRole('dialog',{name:'历史 AI · 历史总述与纪年联合起草',exact:true})
  await dialog.getByRole('button',{name:'生成候选',exact:true}).click()
  await expect(dialog.getByRole('checkbox',{name:'采用联合候选：历史总述',exact:true})).not.toBeChecked();await expect(dialog.getByRole('checkbox',{name:'采用联合候选：纪年体系',exact:true})).not.toBeChecked();await expect(dialog.getByRole('button',{name:'确认采用',exact:true})).toBeDisabled()
  await dialog.getByRole('textbox',{name:'联合候选：历史总述',exact:true}).fill('作者改过的联合总述\n尾空格  ');await dialog.getByRole('checkbox',{name:'采用联合候选：历史总述',exact:true}).check()
  await dialog.getByRole('button',{name:'关闭历史候选',exact:true}).click();await page.reload();await page.getByRole('button',{name:'历史总述与纪年',exact:true}).click();await page.getByRole('button',{name:'继续编辑：历史总述与纪年联合起草',exact:true}).click()
  dialog=page.getByRole('dialog',{name:'历史 AI · 历史总述与纪年联合起草',exact:true})
  await expect(dialog.getByRole('textbox',{name:'联合候选：历史总述',exact:true})).toHaveValue('作者改过的联合总述\n尾空格  ');await expect(dialog.getByRole('checkbox',{name:'采用联合候选：历史总述',exact:true})).toBeChecked();await expect(dialog.getByRole('checkbox',{name:'采用联合候选：纪年体系',exact:true})).not.toBeChecked();expect(calls).toBe(1)
  expect(await read()).toMatchObject({overview:'作者原总述',eraSystem:'作者原纪年'})
  await dialog.getByRole('button',{name:'确认采用',exact:true}).click();await expect(dialog).not.toBeVisible()
  expect(await read()).toMatchObject({overview:'作者改过的联合总述\n尾空格  ',eraSystem:'作者原纪年'});expect(calls).toBe(1)
})
