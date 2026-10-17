import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'

async function adoptSource(page:Page,label:string,waitForCompletion=false){
  const card=page.getByRole('article',{name:`作者确认：${label}`,exact:true})
  await card.getByRole('button',{name:`保存候选：${label}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已核对该候选内容及素材来源授权',exact:true}).check()
  const started=Date.now()
  await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
  if(waitForCompletion)await expect(page.getByRole('status').filter({hasText:'该准确版本已确认采用。'})).toBeVisible({timeout:30_000})
  await expect(card.getByText('已采用 v1',{exact:true})).toBeVisible()
  return Date.now()-started
}

async function prepare(page:Page,firstImageBusy=false){
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  const origin=new URL(page.url()).origin
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))await route.continue();else await route.abort('blockedbyclient')})
  // Seed only an author-owned saved workspace and frozen world. Production,
  // Brief/start/Plan/Run, original responses and adoption are the actual UI.
  const source=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [drafts,editor,presets,worlds,config]=await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/avg/editor-service.ts'),
      load('/storyforge/src/lib/avg/authoring-presets.ts'),load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'),load('/storyforge/src/stores/ai-config.ts')])
    const owner=await drafts.createAvgDraftV1('专业视觉工作台工程验证'),world=await worlds.createMistHarborWorld()
    const selected=await drafts.selectAvgWorldV1(owner.scope,0,world.worldReleaseId),workspace=presets.createAvgAuthoringPresetV1('linear')
    await editor.saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,workspace)
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted-no-network',model:'agnes-2.5-flash',baseUrl:'https://visual.fixture.invalid/v1'})
    const canvas=document.createElement('canvas');canvas.width=576;canvas.height=324
    const context=canvas.getContext('2d')!;context.fillStyle='#24364b';context.fillRect(0,0,576,324);context.fillStyle='#e4c284';context.fillRect(80,40,100,140)
    return {scope:owner.scope,png:canvas.toDataURL('image/png').split(',')[1],titles:workspace.systemPlan.scenes.map((s:any)=>s.title),text:workspace.scripts[0].lines[0].text}
  })
  const models:any[]=[],images:any[]=[]
  await page.route('https://visual.fixture.invalid/v1/chat/completions',async route=>{
    const body=route.request().postDataJSON();models.push(body)
    const content=body.messages.find((m:any)=>m.role==='user').content as string
    const packet=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1))
    expect(packet.schema).toBe('storyforge.avg.visual-planning-inputs')
    expect(content).not.toContain(source.text);expect(content).not.toContain('data:image/')
    const direction=body.messages.find((m:any)=>m.role==='system').content.includes('storyforge.avg.visual-bible')
    const output=direction?{schema:'storyforge.avg.visual-bible',version:1,style:{medium:'二维插画',rendering:'清晰轮廓',palette:['暖灰'],lighting:'左上柔光',composition:'保留下方对白区'},
      subjects:packet.subjects.map((s:any)=>({subjectKey:s.subjectKey,subjectKind:s.subjectKind,identityInvariants:['保持门窗位置'],allowedChanges:['允许光照变化'],forbiddenDepictions:['新增剧情秘密']}))}
      :{schema:'storyforge.avg.media-brief',version:1,subjectKey:packet.subjects[0].subjectKey,subjectKind:'environment',designIntent:'已确认地点的背景工程方案',
        outputs:packet.requirements.map((r:any)=>({requirementKey:r.requirementKey,prompt:'左上柔光，窗框位置稳定，下方留白',negativePrompt:'水印',invariants:['保持门窗布局'],forbiddenDepictions:['新增人物'],referenceKeys:r.requiredReferenceKeys}))}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(output)},finish_reason:'stop'}],usage:{prompt_tokens:200,completion_tokens:200}})})
  })
  await page.route('https://visual.fixture.invalid/v1/images/generations',async route=>{
    const body=route.request().postDataJSON();images.push(body)
    expect(body.extra_body.image).toEqual([`data:image/png;base64,${source.png}`])
    expect(body.prompt).toContain('作者修订：保留下方完整对白区')
    if(firstImageBusy&&images.length===1){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'生图队列已满，请稍后重试'}})});return}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:source.png}]})})
  })
  await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const media=page.getByRole('region',{name:'图片生产（实验）',exact:true})
  await media.getByText('导入仅供生成使用的参考图',{exact:true}).click()
  await media.getByLabel('参考图文件',{exact:true}).setInputFiles({name:'原创专业参考.png',mimeType:'image/png',buffer:Buffer.from(source.png,'base64')})
  await media.getByLabel('参考图来源与授权',{exact:true}).fill('本测试原创工程像素，仅验证来源与实际传输，不签艺术或商业质量')
  await media.getByRole('button',{name:'导入为参考，不加入演出',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'参考图已解码'})).toBeVisible()
  const panel=page.getByRole('region',{name:'专业视觉策划（实验）',exact:true})
  await panel.getByLabel('必须呈现的场景细节（每行一项）',{exact:true}).fill('明确窗户、书桌与门的位置；保留下方对白区')
  await panel.getByLabel('本次风格参考',{exact:true}).selectOption({label:'原创专业参考.png'})
  await panel.getByLabel('参考允许改变的内容',{exact:true}).fill('只参考配色，允许重新设计布局细节')
  await expect(panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true})).toBeDisabled()
  await panel.getByRole('checkbox',{name:'我有权向本次图片供应商发送该参考',exact:true}).check()
  await panel.getByRole('checkbox',{name:'我有权用该参考进行本次衍生创作',exact:true}).check()
  await panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'专业视觉方案已准备'})).toBeVisible()
  expect(models).toHaveLength(0);expect(images).toHaveLength(0)
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'修改尚未开始的专业用途',exact:true}).click()
  await expect(panel.getByLabel('本次风格参考',{exact:true})).not.toHaveValue('')
  await panel.getByLabel('必须呈现的场景细节（每行一项）',{exact:true}).fill('作者再次确认门窗与书桌的位置，并保留下方完整对白区')
  await expect(panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true})).toBeDisabled()
  await panel.getByRole('checkbox',{name:'我有权向本次图片供应商发送该参考',exact:true}).check()
  await panel.getByRole('checkbox',{name:'我有权用该参考进行本次衍生创作',exact:true}).check()
  await panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'专业视觉方案已准备'})).toBeVisible()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  await expect(panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})).toBeVisible({timeout:60_000})
  return {source,models,images,panel}
}

async function historicalDesignEvidence(page:Page,scope:{projectId:number;worldId:number;workId:number}){
  return page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [{db},author,backup]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/avg/author-artifacts.ts'),load('/storyforge/src/lib/export/json-export.ts')])
    const builds=await db.productBuilds.where('workId').equals(scope.workId).toArray(),build=builds.sort((a:any,b:any)=>b.buildNumber-a.buildNumber)[0]
    const {exportedAt:_before,...before}=await backup.exportProjectJSON(scope.projectId)
    const rows=await db.productBuildArtifacts.where('buildId').equals(build.id).filter((r:any)=>r.status==='accepted'
      &&(r.artifactKey==='avg.media.visual-bible'||r.artifactKey.startsWith('avg.media.environment-brief.'))).toArray()
    const designs=[]
    for(const row of rows){
      const result=await author.readAvgHistoricalVisualArtifactV4({scope,buildId:build.id,expectedBuildRevision:build.stateRevision,
        controlEpoch:row.controlEpoch,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,
        artifact:{artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash}})
      designs.push({payload:result.payload,original:JSON.parse(result.original.rawText),edited:result.candidate.visualProposalValidation.authorEdited})
    }
    const {exportedAt:_after,...after}=await backup.exportProjectJSON(scope.projectId)
    return {unchanged:JSON.stringify(before)===JSON.stringify(after),designs}
  },scope)
}

test('professional visual workbench reuses historical author edits after HTTP503 without new text calls and restores a real frozen native Preview',async({page},info)=>{
  test.setTimeout(240_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page,true)
  let direction=panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})
  await direction.getByLabel('构图与留白',{exact:true}).fill('作者修订：保留下方完整对白区')
  await direction.getByRole('button',{name:'保存待确认：视觉基准',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'方案已保存为待确认版本；尚未采用或发送图片请求。'})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  direction=panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})
  await expect(direction.getByLabel('构图与留白',{exact:true})).toHaveValue('作者修订：保留下方完整对白区')
  expect(models).toHaveLength(1);expect(images).toHaveLength(0)
  await direction.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
  await direction.getByRole('button',{name:'确认采用：视觉基准',exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  const subject=panel.getByRole('article',{name:`专业方案：场景方案：${source.titles[0]}`,exact:true})
  await expect(subject).toBeVisible({timeout:60_000})
  await subject.getByLabel('生成画面要求',{exact:true}).fill('作者修订：保留下方完整对白区；保持已批准的门窗布局')
  await subject.getByRole('button',{name:`保存待确认：场景方案：${source.titles[0]}`,exact:true}).click()
  await subject.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
  await subject.getByRole('button',{name:`确认采用：场景方案：${source.titles[0]}`,exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  await expect(panel.getByRole('button',{name:'保留记录并准备新版本方案',exact:true})).toBeVisible({timeout:60_000})
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await panel.getByRole('button',{name:'保留记录并准备新版本方案',exact:true}).click()
  const reuse=panel.getByRole('region',{name:'历史专业方案复用',exact:true})
  await reuse.getByRole('button',{name:'读取此版本已确认方案',exact:true}).click()
  const choices=reuse.getByRole('checkbox')
  await expect(choices).toHaveCount(2)
  await expect(reuse.getByRole('checkbox',{name:'复用已确认方案：视觉基准',exact:true})).toBeVisible()
  await expect(reuse.getByRole('checkbox',{name:`复用已确认方案：场景方案：${source.titles[0]}`,exact:true})).toBeVisible()
  await choices.nth(0).check();await choices.nth(1).check()
  await reuse.getByRole('button',{name:'保存复用方案',exact:true}).click()
  await expect(panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/)).toBeVisible()
  await panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/).scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath('avg-v4-reuse-zero-call-budget.png')})
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/)).toBeVisible()
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  await expect(direction.getByLabel('构图与留白',{exact:true})).toHaveValue('作者修订：保留下方完整对白区')
  await expect(direction.getByText(/本岗位没有新的模型调用/)).toBeVisible()
  await direction.getByRole('button',{name:'保存待确认：视觉基准',exact:true}).click()
  await direction.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
  await direction.getByRole('button',{name:'确认采用：视觉基准',exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  await expect(subject.getByLabel('生成画面要求',{exact:true})).toHaveValue('作者修订：保留下方完整对白区；保持已批准的门窗布局')
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await subject.getByRole('button',{name:`保存待确认：场景方案：${source.titles[0]}`,exact:true}).click()
  await subject.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
  await subject.getByRole('button',{name:`确认采用：场景方案：${source.titles[0]}`,exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  const card=page.getByRole('article',{name:`图片候选：${source.titles[0]}背景`,exact:true})
  await expect(card).toBeVisible({timeout:60_000});expect(models).toHaveLength(2);expect(images).toHaveLength(2)
  await confirmEngineeringVisualReview(card,`${source.titles[0]}背景`)
  await card.getByRole('button',{name:`保存选图候选：${source.titles[0]}背景`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
  await card.getByRole('button',{name:`确认选用：${source.titles[0]}背景`,exact:true}).click()
  await page.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.evaluate(async()=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {useAIConfigStore}=await load('/storyforge/src/stores/ai-config.ts');useAIConfigStore.getState().setConfig({apiKey:''})})
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adoptSource(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  const originalUrl=page.url()
  await page.reload();await expect(page.locator('.avg-dialogue p')).toContainText(source.text)
  const history=await historicalDesignEvidence(page,source.scope)
  expect(history.unchanged).toBe(true);expect(history.designs).toHaveLength(2)
  expect(history.designs.every(d=>d.edited)).toBe(true)
  expect(history.designs.find(d=>d.payload.schema==='storyforge.avg.visual-bible')!.payload.style.composition).toBe('作者修订：保留下方完整对白区')
  expect(history.designs.every(d=>JSON.stringify(d.original)!==JSON.stringify(d.payload))).toBe(true)
  const restored=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [schema,backup,service,proof]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/product-production/service.ts'),load('/storyforge/src/lib/product-production/artifact-store.ts')])
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),builds=await schema.db.productBuilds.where('projectId').equals(projectId).toArray(),build=builds.sort((a:any,b:any)=>b.buildNumber-a.buildNumber)[0]
    const importedScope={projectId,worldId:build.worldId,workId:build.workId}
    await service.recoverImportedProductProductionProofsV1({scope:importedScope,productionId:build.productionId})
    await proof.verifyProductBuildTerminalArtifactSetV1({scope:importedScope,productionId:build.productionId,buildId:build.id,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})
    const session=await service.startProductProductionPreviewV1({scope:importedScope,productionId:build.productionId,expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    return {scope:importedScope,sessionId:session.sessionId}
  },source.scope)
  const url=new URL(originalUrl);url.searchParams.set('project',String(restored.scope.projectId));url.searchParams.set('work',String(restored.scope.workId));url.searchParams.set('session',String(restored.sessionId))
  await page.goto(url.toString());await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  const importedHistory=await historicalDesignEvidence(page,restored.scope)
  expect(importedHistory.unchanged).toBe(true);expect(importedHistory.designs).toEqual(history.designs)
  await page.screenshot({path:info.outputPath('avg-v4-professional-restored-preview.png')})
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  expect(models).toHaveLength(2);expect(images).toHaveLength(2)
})

test('author refuses an exact professional proposal and refresh retains its reason and original evidence without another request',async({page})=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page),direction=panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})
  await direction.getByLabel('退回依据',{exact:true}).fill('作者拒绝：构图方向不合适，停止本批，保留原始方案与未知费用')
  await direction.getByRole('button',{name:'退回此方案并停止本批',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已记录退回依据并停止本批'})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})).toBeVisible()
  const state=await page.evaluate(async scope=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {db}=await load('/storyforge/src/lib/db/schema.ts');const build=await db.productBuilds.where('workId').equals(scope.workId).first();return {status:build.status,failure:build.failureJson,artifacts:await db.agentRunArtifacts.where('projectId').equals(scope.projectId).count()}},source.scope)
  expect(state.status).toBe('cancelled');expect(state.failure).toContain('作者拒绝');expect(state.artifacts).toBeGreaterThan(0)
  expect(models).toHaveLength(1);expect(images).toHaveLength(0)
  await panel.getByRole('button',{name:'保留记录并准备新版本方案',exact:true}).click()
  await expect(panel.getByRole('status').filter({hasText:'新版本方案'})).toBeVisible()
  await expect(panel).toContainText('上一版已记录 1 次方案、0 次图片调用')
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(panel.getByRole('status').filter({hasText:'新版本方案'})).toBeVisible()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await expect(page.getByRole('article',{name:'作者确认：系统规则',exact:true}).getByText('等待作者输入',{exact:true})).toBeVisible()
  const replacement=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {db}=await load('/storyforge/src/lib/db/schema.ts')
    const builds=await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber')
    return {builds:builds.map((b:any)=>({id:b.id,number:b.buildNumber,parent:b.parentBuildNumber,status:b.status,failure:b.failureJson})),childArtifacts:await db.productBuildArtifacts.where('buildId').equals(builds[1].id).count()}
  },source.scope)
  expect(replacement.builds).toHaveLength(2);expect(replacement.builds[0].failure).toBe(state.failure)
  expect(replacement.builds[0].status).toBe('cancelled');expect(replacement.builds[1].parent).toBe(replacement.builds[0].number)
  expect(replacement.childArtifacts).toBe(0);expect(models).toHaveLength(1);expect(images).toHaveLength(0)

})

async function prepareProfessionalFamily(page:Page,options:{propReference?:boolean}={}){
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  const origin=new URL(page.url()).origin,calls:string[]=[]
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))await route.continue();else{if(url.hostname==='visual.fixture.invalid')calls.push(url.pathname);await route.abort('blockedbyclient')}})
  const source=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [drafts,editor,presets,worlds,config]=await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/avg/editor-service.ts'),load('/storyforge/src/lib/avg/authoring-presets.ts'),load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'),load('/storyforge/src/stores/ai-config.ts')])
    const owner=await drafts.createAvgDraftV1('专业家族用途原生工程验证'),world=await worlds.createMistHarborWorld(),selected=await drafts.selectAvgWorldV1(owner.scope,0,world.worldReleaseId)
    const workspace=presets.createAvgAuthoringPresetV1('evidence')
    await editor.saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,workspace)
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted-no-network',model:'agnes-2.5-flash',baseUrl:'https://visual.fixture.invalid/v1'})
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const context=canvas.getContext('2d')!
    const references=['家族风格参考.png','人物身份参考.png','物件身份参考.png'].map((name,i)=>{context.fillStyle=['#26384e','#be8650','#527864'][i];context.fillRect(0,0,32,32);context.fillStyle='#e4d5a0';context.fillRect(4+i*3,5,8,20);return {name,png:canvas.toDataURL('image/png').split(',')[1]}})
    return {scope:owner.scope,references,titles:workspace.systemPlan.scenes.map((s:any)=>s.title),characterName:workspace.systemPlan.characters[0].displayName,itemName:workspace.systemPlan.inventory.items[0].name,
      scenes:workspace.scripts.map((s:any)=>({key:s.sceneKey,lineKey:s.lines[0].lineKey,text:s.lines[0].text}))}
  })
  await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const media=page.getByRole('region',{name:'图片生产（实验）',exact:true})
  await media.getByText('导入仅供生成使用的参考图',{exact:true}).click()
  for(const reference of options.propReference?source.references:source.references.slice(0,2)){
    await media.getByLabel('参考图文件',{exact:true}).setInputFiles({name:reference.name,mimeType:'image/png',buffer:Buffer.from(reference.png,'base64')})
    await media.getByLabel('参考图来源与授权',{exact:true}).fill('本测试原创工程参考，只验许可和传输协议，不签艺术质量')
    await media.getByRole('button',{name:'导入为参考，不加入演出',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'参考图已解码'})).toBeVisible()
  }
  const panel=page.getByRole('region',{name:'专业视觉策划（实验）',exact:true})
  await panel.getByLabel('必须呈现的场景细节（每行一项）',{exact:true}).fill('保持已有门窗与对白区')
  for(const name of ['新增人物姿态','新增人物表情','新增物件图标与详情图'])await panel.getByRole('button',{name,exact:true}).click()
  await expect(panel.getByRole('article',{name:/^专业用途 /})).toHaveCount(5)
  for(let i=2;i<=5;i++)await panel.getByRole('article',{name:`专业用途 ${i}`,exact:true}).getByLabel('必须保持或呈现的细节（每行一项）',{exact:true}).fill('保持公开造型\n明确本图的姿态或物件用途')
  const pose=panel.getByRole('article',{name:'专业用途 2',exact:true}),expression=panel.getByRole('article',{name:'专业用途 3',exact:true})
  await pose.getByLabel('图像宽度',{exact:true}).fill('640');await expect(expression.getByLabel('图像宽度',{exact:true})).toHaveValue('640')
  for(const [card,index] of [[pose,0],[expression,1]] as const){await card.getByLabel('人物消费场景',{exact:true}).selectOption(source.scenes[index].key);await card.getByLabel('画面出现的台词',{exact:true}).selectOption(source.scenes[index].lineKey)}
  await panel.getByLabel('本次风格参考',{exact:true}).selectOption({label:'家族风格参考.png'})
  await panel.getByLabel('参考允许改变的内容',{exact:true}).fill('只参考配色，允许重新布局')
  await pose.getByLabel('已导入的家族基准',{exact:true}).selectOption({label:'人物身份参考.png'})
  await pose.getByLabel('家族基准允许变化',{exact:true}).fill('保持同一人物，只改变姿态和表情')
  await expect(expression.getByLabel('已导入的家族基准',{exact:true})).toHaveValue(await pose.getByLabel('已导入的家族基准',{exact:true}).inputValue())
  if(options.propReference){
    const icon=panel.getByRole('article',{name:'专业用途 4',exact:true}),detail=panel.getByRole('article',{name:'专业用途 5',exact:true})
    await icon.getByLabel('已导入的家族基准',{exact:true}).selectOption({label:'物件身份参考.png'})
    await icon.getByLabel('家族基准允许变化',{exact:true}).fill('保持同一信封的轮廓与封印，仅改变图标和详情的观察尺度')
    await expect(detail.getByLabel('已导入的家族基准',{exact:true})).toHaveValue(await icon.getByLabel('已导入的家族基准',{exact:true}).inputValue())
  }
  const prepareButton=panel.getByRole('button',{name:'准备专业视觉制作方案',exact:true})
  await expect(prepareButton).toBeDisabled()
  for(const name of ['我有权向本次图片供应商发送该参考','我有权用该参考进行本次衍生创作'])await panel.getByRole('checkbox',{name,exact:true}).check()
  await prepareButton.click();await expect(page.getByRole('status').filter({hasText:'专业视觉方案已准备'})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'修改尚未开始的专业用途',exact:true}).click()
  await expect(panel.getByRole('article',{name:/^专业用途 /})).toHaveCount(5)
  await expect(prepareButton).toBeDisabled()
  await expect(pose.getByLabel('图像宽度',{exact:true})).toHaveValue('640')
  await pose.getByLabel('图像宽度',{exact:true}).fill('704')
  await expect(expression.getByLabel('图像宽度',{exact:true})).toHaveValue('704')
  await panel.getByRole('button',{name:'撤销未保存的专业用途',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已明确开始，等待逐项作者确认。'})).toBeVisible()
  return {source,panel,calls}
}

test('professional family form preserves five exact targets and reference permissions through refresh and starts the real Plan without dispatch',async({page},info)=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,calls}=await prepareProfessionalFamily(page)
  const state=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [service,contracts]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/product-production/contracts.ts')])
    const view=await service.readAvgAssemblyWorkspaceV1(scope),details=view.details,brief=contracts.parseProductProductionBriefV3(details.brief.briefJson),plan=JSON.parse(details.build.planJson)
    return {scope:brief.avgVisualPlanning.scope,modelTasks:plan.tasks.filter((t:any)=>t.executionMode==='model').length,imageTasks:plan.tasks.filter((t:any)=>t.taskKey.startsWith('avg.media.generate.')).length,usage:view.visualProgress.budget.usage,assets:JSON.parse(view.draft.editorJson).presentation.stage.assets}
  },source.scope)
  expect(state.scope.templates.map((t:any)=>t.subjectKind)).toEqual(['environment','character','character','prop','prop'])
  expect(state.scope.templates[1].parameters.width).toBe(640);expect(state.scope.templates[2].parameters.width).toBe(640)
  expect(state.scope.referenceCatalog.map((r:any)=>r.reference.purpose).sort()).toEqual(['identity','style'])
  expect(state.modelTasks).toBe(4);expect(state.imageTasks).toBe(5);expect(state.usage).toMatchObject({modelCalls:0,mediaCalls:0});expect(state.assets).toEqual([]);expect(calls).toEqual([])
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await page.screenshot({path:info.outputPath('avg-v4-professional-family-scope.png'),fullPage:true})
})


test('professional family images use exact references, alpha and five consumers through native Preview and portable restore',async({page},info)=>{
  test.setTimeout(300_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,panel,calls}=await prepareProfessionalFamily(page,{propReference:true})
  const fixture=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const view=await(await load('/storyforge/src/lib/avg/assembly-service.ts')).readAvgAssemblyWorkspaceV1(scope)
    const planning=view.details.executionBrief.avgVisualPlanning
    // Original engineering pixels: transparent actor canvas, common body and
    // changed mouth only. These prove physical alpha/slots, never art quality.
    const images=planning.scope.templates.map((t:any,index:number)=>{
      const p=t.parameters,canvas=document.createElement('canvas');canvas.width=p.width;canvas.height=p.height;const c=canvas.getContext('2d')!
      if(t.subjectKind==='character'){
        c.fillStyle='#537a72';c.fillRect(p.width*.28,p.height*.31,p.width*.44,p.height*.65)
        c.fillStyle='#c89563';c.beginPath();c.ellipse(p.width*.5,p.height*.19,p.width*.13,p.height*.13,0,0,Math.PI*2);c.fill()
        c.strokeStyle='#26384e';c.lineWidth=5;c.beginPath();c.moveTo(p.width*.45,p.height*.22);c.lineTo(p.width*.55,p.height*(p.mediaKind==='character-expression'?.24:.22));c.stroke()
      }else{
        c.fillStyle=t.subjectKind==='environment'?'#26384e':'#527864';c.fillRect(0,0,p.width,p.height)
        c.fillStyle='#d7c49b';c.fillRect(p.width*.16,p.height*.2,p.width*.68,p.height*.6)
        c.strokeStyle='#435a4e';c.lineWidth=8;c.beginPath();c.moveTo(p.width*.16,p.height*.2);c.lineTo(p.width*.5,p.height*.55);c.lineTo(p.width*.84,p.height*.2);c.stroke()
      }
      c.fillStyle='#e8d7a0';c.font='14px sans-serif';c.fillText(`ENGINEERING ${index+1}`,12,22)
      return {key:p.requirementKey,png:canvas.toDataURL('image/png').split(',')[1]}
    })
    return {templates:planning.scope.templates,catalog:planning.scope.referenceCatalog,images}
  },source.scope)
  expect(calls).toEqual([])
  const referenceBytes=new Map(source.references.map((r:any)=>[createHash('sha256').update(Buffer.from(r.png,'base64')).digest('hex'),`data:image/png;base64,${r.png}`]))
  const models:any[]=[],images:Array<{key:string;references:string[]}>=[]
  await page.route('https://visual.fixture.invalid/v1/chat/completions',async route=>{
    const body=route.request().postDataJSON();models.push(body)
    const content=body.messages.find((m:any)=>m.role==='user').content as string
    const packet=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1))
    expect(packet.schema).toBe('storyforge.avg.visual-planning-inputs');expect(content).not.toContain(source.scenes[0].text);expect(content).not.toContain('data:image/')
    const direction=body.messages.find((m:any)=>m.role==='system').content.includes('storyforge.avg.visual-bible')
    const payload=direction?{schema:'storyforge.avg.visual-bible',version:1,style:{medium:'二维工程插画',rendering:'统一轮廓',palette:['灰绿','暖黄'],lighting:'左上柔光',composition:'人物共同画布，下方保留对白区'},
      subjects:packet.subjects.map((s:any)=>({subjectKey:s.subjectKey,subjectKind:s.subjectKind,identityInvariants:['公开主体和比例保持'],allowedChanges:['仅变化已确认用途与姿态'],forbiddenDepictions:['新增剧情秘密']}))}
      :{schema:'storyforge.avg.media-brief',version:1,subjectKey:packet.subjects[0].subjectKey,subjectKind:packet.subjects[0].subjectKind,designIntent:'准确工程用途；不代签艺术和商业验收',
        outputs:packet.requirements.map((r:any)=>({requirementKey:r.requirementKey,prompt:`工程候选[${r.requirementKey}] 保持已确认身份、共同画布和本项用途`,negativePrompt:'水印',invariants:['保持主体比例'],forbiddenDepictions:['新增秘密'],referenceKeys:r.requiredReferenceKeys}))}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(payload)},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:400}})})
  })
  await page.route('https://visual.fixture.invalid/v1/images/generations',async route=>{
    const body=route.request().postDataJSON(),key=String(body.prompt).match(/工程候选\[([^\]]+)\]/)?.[1]
    const template=fixture.templates.find((t:any)=>t.parameters.requirementKey===key)
    expect(template).toBeDefined();expect(images.some(i=>i.key===key)).toBe(false)
    const expected=template.requiredReferenceKeys.map((k:string)=>referenceBytes.get(fixture.catalog.find((r:any)=>r.referenceKey===k).reference.contentHash))
    expect(expected.every((r:unknown)=>typeof r==='string')).toBe(true)
    expect(body.extra_body.image).toEqual(expected)
    const image=fixture.images.find((i:any)=>i.key===key)!
    images.push({key:key!,references:body.extra_body.image})
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:image.png}]})})
  })
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const generate=panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true})
  const approve=async(label:string)=>{
    const card=panel.getByRole('article',{name:`专业方案：${label}`,exact:true})
    await expect(card).toBeVisible({timeout:60_000})
    await card.getByRole('button',{name:`保存待确认：${label}`,exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'方案已保存为待确认版本'})).toBeVisible()
    await card.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
    await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
    await expect(card.getByText('此方案已明确采用。',{exact:false})).toBeVisible()
  }
  await generate.click();await approve('视觉基准');expect(models).toHaveLength(1);expect(images).toHaveLength(0)
  await generate.click()
  for(const label of [`场景方案：${source.titles[0]}`,`人物方案：${source.characterName}`,`物件方案：${source.itemName}`])await approve(label)
  expect(models).toHaveLength(4);expect(images).toHaveLength(0)
  await generate.click()
  for(const t of fixture.templates)await expect(page.getByRole('article',{name:`图片候选：${t.parameters.name}`,exact:true}).getByText('原图已接收，等待作者选择',{exact:false})).toBeVisible({timeout:60_000})
  expect(images).toHaveLength(5);expect(images.map(i=>i.references.length).sort()).toEqual([1,2,2,2,2])
  const measured=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [service,decoder]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/image-decoder.ts')])
    const view=await service.readAvgAssemblyWorkspaceV1(scope),result=[]
    for(const r of view.imageDefinition.mediaBatch.requirements){const row=view.artifacts.find((a:any)=>a.artifactKey===`avg.media.raw.${r.requirementKey}`),bytes=await service.readAvgRawImageCandidateBytesV2({scope,productionId:view.details.production.id,requirementKey:r.requirementKey,version:row.version,contentHash:row.contentHash});result.push({key:r.requirementKey,...await decoder.inspectAvgImageBytesV1({data:bytes.data,...bytes.asset,requireAlpha:r.alpha==='required'})})}
    return result
  },source.scope)
  expect(measured.filter((r:any)=>r.hasAlpha)).toHaveLength(2)
  const readMeasurements:Array<{name:string;elapsedMs:number;explicitRereads:number;initialReadErrors:string[]}>=[]
  for(const t of fixture.templates){
    const name=t.parameters.name,card=page.getByRole('article',{name:`图片候选：${name}`,exact:true})
    const readStarted=Date.now()
    const expand=card.getByRole('button',{name:`查看原图：${name}`,exact:true});if(await expand.isVisible())await expand.click()
    const reread=card.getByRole('button',{name:`重新读取媒资：${name}`,exact:true})
    const ready=()=>card.getByRole('img').evaluateAll((imgs:HTMLImageElement[],count:number)=>imgs.length>=count&&imgs.every(i=>i.complete&&i.naturalWidth>0),t.requiredReferenceKeys.length+1)
    // Concurrent Build progress can be rejected at several exact proof layers.
    // Observe the actual raw-media reread control, retaining its error rather
    // than coupling this path to one message. One explicit local reread still
    // rechecks all byte/producer fences; persistent/reference errors must fail.
    await expect.poll(async()=>await ready()||await reread.isVisible()||(await card.getByRole('alert').allTextContents()).length>0,{timeout:30_000}).toBe(true)
    const initialReadErrors=await card.getByRole('alert').allTextContents(),needsReread=await reread.isVisible()
    if(needsReread)await reread.click()
    else expect(initialReadErrors,'Reference/display errors have no raw-media recovery control').toEqual([])
    const referenceCount=new Set(t.requiredReferenceKeys.map((key:string)=>fixture.catalog.find((ref:any)=>ref.referenceKey===key).reference.contentHash)).size
    await expect(card.getByRole('region',{name:`视觉评审：${name}`,exact:true}).getByText(`准确原图已显示 · 参考 ${referenceCount}/${referenceCount}。`,{exact:true})).toBeVisible({timeout:30_000})
    await expect.poll(()=>card.getByRole('img').evaluateAll((imgs:HTMLImageElement[],count:number)=>imgs.length>=count&&imgs.every(i=>i.complete&&i.naturalWidth>0),t.requiredReferenceKeys.length+1)).toBe(true)
    readMeasurements.push({name,elapsedMs:Date.now()-readStarted,explicitRereads:Number(needsReread),initialReadErrors})
    await confirmEngineeringVisualReview(card,name)
    await card.getByRole('button',{name:`保存选图候选：${name}`,exact:true}).click()
    await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
    await card.getByRole('button',{name:`确认选用：${name}`,exact:true}).click()
    await expect(card.getByText('已确认选用',{exact:false})).toBeVisible()
  }
  const readDurationPath=info.outputPath('five-image-read-recovery-duration.json')
  await writeFile(readDurationPath,JSON.stringify({maximumWaitPerPhaseMs:30_000,measurements:readMeasurements}))
  await info.attach('five-image-read-recovery-duration',{path:readDurationPath,contentType:'application/json'})
  const configurationStarted=Date.now()
  await page.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  // This five-image operation revalidates four role lineages and all byte
  // proofs. Wait for its bounded completion, retaining the actual elapsed time.
  await expect(page.getByRole('status').filter({hasText:'已选图片已配置到演出草稿'})).toBeVisible({timeout:30_000})
  const durationPath=info.outputPath('five-image-configuration-duration.json')
  await writeFile(durationPath,JSON.stringify({elapsedMs:Date.now()-configurationStarted,maximumWaitMs:30_000}))
  await info.attach('five-image-configuration-duration',{path:durationPath,contentType:'application/json'})
  const configured=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,service=await load('/storyforge/src/lib/avg/assembly-service.ts')
    const view=await service.readAvgAssemblyWorkspaceV1(scope),workspace=JSON.parse(view.draft.editorJson)
    return {assets:workspace.presentation.stage.assets,cues:workspace.presentation.stage.cues,item:workspace.systemPlan.inventory.items[0],usage:view.visualProgress.budget.usage}
  },source.scope)
  expect(configured.assets).toHaveLength(5);expect(configured.usage).toMatchObject({modelCalls:4,mediaCalls:5,costUsd:null})
  for(const t of fixture.templates){const p=t.parameters;expect(configured.assets.some((a:any)=>a.assetKey===p.assetKey)).toBe(true);if(p.consumer.domain==='stage')expect(configured.cues).toContainEqual(expect.objectContaining({assetKey:p.assetKey,beatKey:p.triggerBeatKey,...(t.subjectKind==='character'?{actorKey:p.family.subjectKey}:{})}));else expect(configured.item[p.consumer.slot==='icon'?'iconAssetKey':'detailAssetKey']).toBe(p.assetKey)}
  await page.evaluate(async()=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {useAIConfigStore}=await load('/storyforge/src/stores/ai-config.ts');useAIConfigStore.getState().setConfig({apiKey:''})})
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  // The five-image stage adoption rechecks physical bytes and role lineages.
  // Bound that operation by its real completion notice, then keep the normal
  // five-second adopted-version assertion used by all existing cases.
  const stageAdoptionMs=await adoptSource(page,'演出与媒资',true)
  const adoptionDurationPath=info.outputPath('five-image-stage-adoption-duration.json')
  await writeFile(adoptionDurationPath,JSON.stringify({elapsedMs:stageAdoptionMs,maximumWaitMs:30_000}))
  await info.attach('five-image-stage-adoption-duration',{path:adoptionDurationPath,contentType:'application/json'})
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  const background=fixture.templates[0].parameters,pose=fixture.templates[1].parameters,expression=fixture.templates[2].parameters,icon=fixture.templates[3].parameters,detail=fixture.templates[4].parameters
  await expect.poll(()=>page.locator('.avg-background img').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(background.width)
  await expect(page.locator('.avg-background img')).toHaveAttribute('alt',background.altText)
  await expect.poll(()=>page.locator('.avg-actor img').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(pose.width)
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',pose.altText)
  const originalUrl=page.url(),bounds=await page.locator('.avg-actor img').boundingBox()
  await page.getByRole('button',{name:'物品与证据',exact:true}).click();const inventory=page.getByRole('dialog',{name:'物品与证据',exact:true})
  await expect.poll(()=>inventory.locator('nav img').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(icon.width)
  await expect.poll(()=>inventory.locator('.avg-inventory-detail-image').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(detail.width)
  await page.screenshot({path:info.outputPath('avg-v4-family-pose-inventory.png'),fullPage:true})
  await inventory.getByRole('button',{name:'关闭',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[0].text)
  await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'继续保管',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[1].text)
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  const nextBounds=await page.locator('.avg-actor img').boundingBox();expect(nextBounds).not.toBeNull();expect(bounds).not.toBeNull()
  expect(Math.abs(nextBounds!.width-bounds!.width)).toBeLessThan(1);expect(Math.abs(nextBounds!.height-bounds!.height)).toBeLessThan(1)
  await page.reload();await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[1].text)
  await page.screenshot({path:info.outputPath('avg-v4-family-expression.png'),fullPage:true})
  const restored=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [schema,backup,service,proof]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/product-production/service.ts'),load('/storyforge/src/lib/product-production/artifact-store.ts')])
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=await schema.db.productBuilds.where('projectId').equals(projectId).first(),importedScope={projectId,worldId:build.worldId,workId:build.workId}
    await service.recoverImportedProductProductionProofsV1({scope:importedScope,productionId:build.productionId})
    await proof.verifyProductBuildTerminalArtifactSetV1({scope:importedScope,productionId:build.productionId,buildId:build.id,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})
    const session=await service.startProductProductionPreviewV1({scope:importedScope,productionId:build.productionId,expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    return {scope:importedScope,sessionId:session.sessionId}
  },source.scope)
  const importedUrl=new URL(originalUrl);importedUrl.searchParams.set('project',String(restored.scope.projectId));importedUrl.searchParams.set('work',String(restored.scope.workId));importedUrl.searchParams.set('session',String(restored.sessionId))
  await page.goto(importedUrl.toString());await expect.poll(()=>page.locator('.avg-actor img').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(pose.width)
  await page.getByRole('button',{name:'物品与证据',exact:true}).click();await expect.poll(()=>page.getByRole('dialog',{name:'物品与证据',exact:true}).locator('.avg-inventory-detail-image').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(detail.width)
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  expect(models).toHaveLength(4);expect(images).toHaveLength(5);expect(calls).toEqual([])
})
