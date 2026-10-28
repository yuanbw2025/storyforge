import { test,expect } from '@playwright/test'

test('module capability view follows actual draft rules while future modules stay disabled and cannot enter persisted author input',async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  await expect(page.getByRole('button',{name:'新建 AVG',exact:true})).toBeVisible({timeout:30_000})
  const scope=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    return (await(await load('/storyforge/src/lib/avg/draft-service.ts')).createAvgDraftV1('模块配置与扩展边界')).scope
  })
  await page.goto(`./avg/production?project=${scope.projectId}&work=${scope.workId}`)
  await page.getByRole('button',{name:'打开系统与效果工作台',exact:true}).click()
  const panel=page.getByRole('region',{name:'模块能力'})
  await panel.getByText('当前草稿的模块能力',{exact:true}).click()
  await expect(panel.getByRole('checkbox',{name:'物品 · 已配置',exact:true})).toBeChecked()
  await expect(panel.getByRole('checkbox',{name:'证据与出示 · 已配置',exact:true})).toBeChecked()
  for(const name of ['热点与地点','话题与关键词','消息与手机','档案','鉴赏','跨周目进度','提示与辅助']){
    const control=panel.getByRole('checkbox',{name:`${name} · 规划中，未实现`,exact:true})
    await expect(control).not.toBeChecked();await expect(control).toBeDisabled()
  }
  await page.getByRole('combobox',{name:'工程配置',exact:true}).selectOption('linear')
  await expect(panel.getByRole('checkbox',{name:'物品 · 未配置',exact:true})).not.toBeChecked()
  await expect(panel.getByRole('checkbox',{name:'证据与出示 · 未配置',exact:true})).not.toBeChecked()
  await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'编辑草稿已保存'})).toBeVisible()
  await page.reload();await panel.getByText('当前草稿的模块能力',{exact:true}).click()
  await expect(panel.getByRole('checkbox',{name:'对话与选择 · 已配置',exact:true})).toBeChecked()
  await expect(panel.getByRole('checkbox',{name:'物品 · 未配置',exact:true})).not.toBeChecked()
  await page.getByText('高级配置：完整规则、脚本与演出',{exact:true}).click()
  const config=page.getByRole('textbox',{name:'高级组装配置',exact:true}),original=await config.inputValue()
  await config.fill(JSON.stringify({...JSON.parse(original),gallery:{enabled:true}}))
  await page.getByRole('button',{name:'应用高级配置到编辑草稿',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'未知字段'})).toBeVisible()
  const evidence=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
    const draft=await(await load('/storyforge/src/lib/avg/draft-service.ts')).readAvgDraftV1(scope)
    return {workspace:JSON.parse(draft.editorJson),productions:await db.productProductions.where('workId').equals(scope.workId).count()}
  },scope)
  expect(evidence.workspace).toEqual(JSON.parse(original));expect(evidence.workspace.version).toBe(1);expect(evidence.productions).toBe(0)
  await page.getByRole('button',{name:'撤销高级配置输入',exact:true}).click()
  await page.getByText('高级配置：完整规则、脚本与演出',{exact:true}).click()
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath('avg-module-admission.png'),fullPage:true})
})
