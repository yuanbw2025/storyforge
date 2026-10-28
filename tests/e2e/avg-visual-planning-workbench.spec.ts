import { expect, test, type Page,type Locator } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'

async function readyRuntime(page:Page){
  // Navigation reloads the uncached module graph before the actual runtime
  // assertions below can inspect restored pixels or dialogue.
  await expect(page.locator('.avg-stage')).toBeVisible({timeout:30_000})
}

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

async function saveProcessingRecipe(page:Page){
  const form=page.getByRole('region',{name:'本地图像加工配方',exact:true})
  await expect(form.getByRole('checkbox',{name:'明确裁切原图范围',exact:true})).toBeEnabled()
  await form.getByRole('checkbox',{name:'明确裁切原图范围',exact:true}).check()
  await form.getByLabel('裁切宽度（%）',{exact:true}).fill('50')
  await form.getByLabel('允许的加工与用途说明',{exact:true}).fill('明确保留原创工程图左半边，等比放入共同画布并透明留边；只验像素链路，不签艺术质量。')
  await form.getByRole('button',{name:'保存本项加工配方',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'加工配方已保存到尚未开始的专业制作方案'})).toBeVisible()
}

async function saveForegroundRecipe(page:Page,boundaryUnmix=false){
  const form=page.getByRole('region',{name:'本地图像加工配方',exact:true})
  await form.getByRole('checkbox',{name:'生成时使用纯品红底色，并在本地移除底色（实验性）',exact:true}).check()
  if(boundaryUnmix)await form.getByRole('combobox',{name:'前景边缘处理',exact:true}).selectOption('2')
  await form.getByLabel('保留底色与主体用色声明',{exact:true}).fill('原创工程家族的纯品红只作底色，人物服装和主体禁用该色；准许本地分离，仍须逐张查看。')
  await form.getByLabel('允许的加工与用途说明',{exact:true}).fill('整幅原图先移除声明的底色，再完整放入相同画布；不得裁掉主体，不签艺术通过。')
  await form.getByRole('button',{name:'保存本项加工配方',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'加工配方已保存到尚未开始的专业制作方案'})).toBeVisible()
}

async function adoptProfessionalDesign(page:Page,label:string){
  const panel=page.getByRole('region',{name:'专业视觉策划（实验）',exact:true})
  const card=panel.getByRole('article',{name:`专业方案：${label}`,exact:true})
  await expect(card).toBeVisible({timeout:60_000})
  if(label==='视觉基准')await card.getByLabel('构图与留白',{exact:true}).fill('作者修订：保留下方完整对白区')
  else await card.getByLabel('生成画面要求',{exact:true}).fill('作者修订：保留下方完整对白区；保持已批准的门窗布局')
  await card.getByRole('button',{name:`保存待确认：${label}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
  await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
}

/** Compatibility setup uses a genuine old pending Brief through the public
 * preparation service. It never seeds a Build/Run/adoption or relabels V5. */
async function prepareLegacyProfessionalIntent(page:Page,scope:{projectId:number;worldId:number;workId:number}){
  await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [service,forms,contracts]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/visual-planning-form.ts'),load('/storyforge/src/lib/avg/author-workspace-contract.ts')])
    const view=await service.readAvgAssemblyWorkspaceV1(scope),workspace=contracts.parseAvgAuthorWorkspaceV1(view.draft.editorJson)
    const template=forms.createAvgVisualFormTemplateV4(workspace,'background')
    template.requiredDetails=['已有作者用途，进入旧版表单后另行核对修订']
    await service.prepareAvgAssemblyBriefV1({scope,expectedDraftRevision:view.draft.revision,visualPlanning:{schema:'storyforge.avg.visual-planning-scope',version:1,
      batchKey:`legacy.native.${crypto.randomUUID()}`,revision:1,templates:[template],referenceCatalog:[]}})
  },scope)
}

async function prepare(page:Page,firstImageBusy=false,imageModel='agnes.image-2.1-flash.v1',processing=false,nativeAncestor=false){
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  const origin=new URL(page.url()).origin
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))await route.continue();else await route.abort('blockedbyclient')})
  // Save the author workspace/world, then a genuine V4 pending Brief through
  // the public service. Subsequent editing/start/Run/adoption use the real UI.
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
  if(nativeAncestor){
    await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      const [service,drafts]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts')])
      await service.prepareAvgAssemblyBriefV1({scope,expectedDraftRevision:(await drafts.readAvgDraftV1(scope)).revision})
    },source.scope)
    await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
    await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'已明确开始，等待逐项作者确认。'})).toBeVisible()
    await page.getByRole('button',{name:'停止并保留当前组装，准备新版本',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'旧组装与输入已保留，新方案等待明确开始和重新确认。'})).toBeVisible()
  }
  await prepareLegacyProfessionalIntent(page,source.scope)
  await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const media=page.getByRole('region',{name:'图片生产（实验）',exact:true})
  await media.getByText('导入仅供生成使用的参考图',{exact:true}).click()
  await media.getByLabel('参考图文件',{exact:true}).setInputFiles({name:'原创专业参考.png',mimeType:'image/png',buffer:Buffer.from(source.png,'base64')})
  await media.getByLabel('参考图来源与授权',{exact:true}).fill('本测试原创工程像素，仅验证来源与实际传输，不签艺术或商业质量')
  await media.getByRole('button',{name:'导入为参考，不加入演出',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'参考图已解码'})).toBeVisible()
  const panel=page.getByRole('region',{name:'专业视觉策划（实验）',exact:true})
  await panel.getByRole('button',{name:'修改尚未开始的专业用途',exact:true}).click()
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
  if(imageModel!=='agnes.image-2.1-flash.v1'){
    await panel.getByRole('combobox',{name:'专业图片模型',exact:true}).selectOption(imageModel)
    await panel.getByRole('button',{name:'核对并保存图片模型',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'图片模型与当前配置已核对并保存'})).toBeVisible()
  }
  if(processing){await saveProcessingRecipe(page);expect(models).toHaveLength(0);expect(images).toHaveLength(0)}
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

for(const variant of [false,true,'held-pending'] as const)test(`professional visual workbench reuses historical author edits after HTTP503 and pending-import=${variant} without new text calls and restores a real frozen native Preview`,async({page},info)=>{
  const importBeforeRestart=variant!==false
  let legacyHold:{buildId:number;ledger:string}|null=null
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
  if(variant==='held-pending'){
    await expect(subject.getByText(/此方案已明确采用/)).toBeVisible({timeout:30_000})
    legacyHold=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      const [{db},service,configured,visual,scheduler]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/product-production/service.ts'),
        load('/storyforge/src/lib/product-production/production-executor.ts'),load('/storyforge/src/lib/avg/visual-planning-workspace.ts'),load('/storyforge/src/lib/product-production/scheduler.ts')])
      const build=await db.productBuilds.where('workId').equals(scope.workId).first(),details=await service.readProductProductionDetailsV1(scope,build.productionId,['avg'])
      const execution=await visual.resolveAvgVisualPlanningExecutionV4(scope,details.executionBrief,build.id)
      const original=configured.createConfiguredProductProductionExecutorV1({production:details.production,brief:details.executionBrief,...execution})
      // Recreate a legacy pre-attachment foreign error through the actual
      // scheduler/executor/controlled HTTP. No table or old event is rewritten.
      await scheduler.runProductProductionUntilBlockedV1({scope,productionId:build.productionId,...execution,executor:async(input:any)=>{
        try{return await original(input)}catch(error){
          if(input.task.kind==='avg-media-image-generate'&&error instanceof Error&&'usage' in error)throw Object.assign(new Error(error.message),{name:error.name,usage:error.usage})
          throw error
        }
      }})
      const failed=await db.productBuilds.get(build.id),ledger=JSON.parse(failed.budgetLedgerJson),held=ledger.attempts.find((a:any)=>a.taskKey.startsWith('avg.media.generate.'))
      if(held.usageKnown!==false||held.usage.mediaCalls!==1||held.errorCode!=='task-executor-nonretryable')throw new Error('Expected actual legacy observed failure hold')
      return {buildId:build.id,ledger:failed.budgetLedgerJson}
    },source.scope)
    await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  }else await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
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
  expect(images[0].model).toBe('agnes-image-2.1-flash')
  if(importBeforeRestart){
    const restored=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      const [{db},backup,known]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/avg/visual-planning-restart.ts')])
      const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=await db.productBuilds.where('projectId').equals(projectId).first()
      const importedScope={projectId,worldId:build.worldId,workId:build.workId}
      const beforeRuns=await db.agentRuns.where('productBuildId').equals(build.id).toArray(),beforeEvents=await db.agentRunEvents.where('projectId').equals(projectId).toArray()
      await known.assertAvgVisualPlanningRestartKnownV4(importedScope,build)
      return {scope:importedScope,unchanged:JSON.stringify(beforeRuns)===JSON.stringify(await db.agentRuns.where('productBuildId').equals(build.id).toArray())
        &&JSON.stringify(beforeEvents)===JSON.stringify(await db.agentRunEvents.where('projectId').equals(projectId).toArray()),
        importedCompleted:beforeRuns.filter((r:any)=>r.parentRelation?.startsWith('task:avg.visual.propose.')).map((r:any)=>({status:r.status,terminalReceiptHash:r.terminalReceiptHash}))}
    },source.scope)
    expect(restored.unchanged).toBe(true)
    expect(restored.importedCompleted).toEqual([{status:'running',terminalReceiptHash:null},{status:'running',terminalReceiptHash:null}])
    Object.assign(source.scope,restored.scope)
    const url=new URL(page.url());url.searchParams.set('project',String(source.scope.projectId));url.searchParams.set('work',String(source.scope.workId))
    await page.goto(url.toString());await page.getByRole('button',{name:'素材',exact:true}).click()
    await expect(panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/)).toBeVisible()
  }
  await panel.getByRole('combobox',{name:'专业图片模型',exact:true}).selectOption('agnes.image-2.5-flash.v1')
  await panel.getByRole('button',{name:'核对并保存图片模型',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'图片模型与当前配置已核对并保存'})).toBeVisible()
  await panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/).scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath('avg-v4-reuse-zero-call-budget.png')})
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/)).toBeVisible()
  await expect(panel.getByRole('combobox',{name:'专业图片模型',exact:true})).toHaveValue('agnes.image-2.5-flash.v1')
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
  await expect.poll(()=>images.length,{timeout:60_000}).toBe(2)
  await expect(card.getByText('原图已接收，等待作者选择',{exact:true})).toBeVisible({timeout:60_000})
  expect(models).toHaveLength(2);expect(images).toHaveLength(2)
  expect(images[1].model).toBe('agnes-image-2.5-flash')
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
  await page.reload();await readyRuntime(page)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/,{timeout:10_000})
  await expect(page.locator('.avg-dialogue p')).toContainText(source.text)
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
  await page.goto(url.toString());await readyRuntime(page);await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  const importedHistory=await historicalDesignEvidence(page,restored.scope)
  expect(importedHistory.unchanged).toBe(true);expect(importedHistory.designs).toEqual(history.designs)
  await page.screenshot({path:info.outputPath('avg-v4-professional-restored-preview.png')})
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await readyRuntime(page);await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  expect(models).toHaveLength(2);expect(images).toHaveLength(2)
  if(legacyHold){
    const preserved=await page.evaluate(async saved=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
      return (await db.productBuilds.get(saved.buildId)).budgetLedgerJson===saved.ledger
    },legacyHold)
    expect(preserved).toBe(true)
  }
})

test('chosen Image 2.5 continues into a new offline author stage with exact original pixels and portable source proof',async({page},info)=>{
  test.setTimeout(420_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page,false,'agnes.image-2.5-flash.v1')
  for(const label of ['视觉基准',`场景方案：${source.titles[0]}`]){
    const proposal=panel.getByRole('article',{name:`专业方案：${label}`,exact:true})
    await expect(proposal).toBeVisible({timeout:60_000})
    if(label==='视觉基准')await proposal.getByLabel('构图与留白',{exact:true}).fill('作者修订：保留下方完整对白区')
    else await proposal.getByLabel('生成画面要求',{exact:true}).fill('作者修订：保留下方完整对白区；保持已批准的门窗布局')
    await proposal.getByRole('button',{name:`保存待确认：${label}`,exact:true}).click()
    await proposal.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
    await proposal.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
    await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  }
  const name=`${source.titles[0]}背景`,card=page.getByRole('article',{name:`图片候选：${name}`,exact:true})
  await expect(card.getByText('原图已接收，等待作者选择',{exact:true})).toBeVisible({timeout:60_000})
  await confirmEngineeringVisualReview(card,name)
  await card.getByRole('button',{name:`保存选图候选：${name}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
  await card.getByRole('button',{name:`确认选用：${name}`,exact:true}).click()
  await page.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adoptSource(page,'演出与媒资',true)
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.evaluate(async()=>{const load=new Function('p','return import(p)');(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({apiKey:''})})
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click()
  await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const retain=page.getByRole('region',{name:'保留专业演出图片',exact:true})
  await page.evaluate(async()=>{
    const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts')
    const add=db.productProductionBriefs.add.bind(db.productProductionBriefs)
    db.productProductionBriefs.add=(row:any,...args:any[])=>{
      if(JSON.parse(row.briefJson).avgAssembly?.version===1){db.productProductionBriefs.add=add;throw new Error('工程验证：沿用方案保存中断')}
      return add(row,...args)
    }
  })
  await retain.getByRole('button',{name:'保留专业演出图并准备新方案',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'工程验证：沿用方案保存中断'})).toBeVisible()
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('button',{name:'素材',exact:true})).toBeVisible({timeout:30_000})
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(retain.getByText('当前有待开始方案。再次准备会核对是否为同一次图片沿用；其他方案请到制作页查看。',{exact:true})).toBeVisible()
  await retain.getByRole('button',{name:'保留专业演出图并准备新方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已保留准确专业演出图并准备零生成调用的新方案'})).toBeVisible({timeout:60_000})
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  // A refresh deliberately drops the loaded history module before the new
  // author-stage transaction first reads its V4 source descriptor.
  await page.reload();await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await adoptSource(page,'演出与媒资',true)
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  const decoded=()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.some(i=>i.complete&&i.naturalWidth===576))
  await expect.poll(decoded).toBe(true)
  const originalUrl=page.url()
  const restored=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)'),[schema,backup,service,proof,workspace]=await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/product-production/service.ts'),
      load('/storyforge/src/lib/product-production/artifact-store.ts'),load('/storyforge/src/lib/avg/author-workspace-contract.ts')])
    const builds=await schema.db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber'),latest=builds.at(-1),brief=await schema.db.productProductionBriefs.where('[productionId+revision]').equals([latest.productionId,latest.briefRevision]).first()
    const draft=await schema.db.avgAuthoringDrafts.where('workId').equals(scope.workId).first(),source=workspace.parseAvgAuthorWorkspaceV1(draft.editorJson).presentation.inheritedImages[0].source
    if(builds.length!==2||source.version!==2||source.raw.version!==4||JSON.parse(brief.briefJson).avgAssembly.version!==1)throw new Error('Expected original V4 source and explicitly new local stage')
    await proof.verifyProductBuildTerminalArtifactSetV1({scope,productionId:latest.productionId,buildId:latest.id,expectedControlEpoch:latest.controlEpoch,expectedPlanHash:latest.planHash})
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=(await schema.db.productBuilds.where('projectId').equals(projectId).sortBy('buildNumber')).at(-1)
    const importedScope={projectId,worldId:build.worldId,workId:build.workId}
    const original=await(await load('/storyforge/src/lib/avg/media-generated-reference.ts')).readAvgAdoptedGeneratedImageV2({scope:importedScope,source})
    const imageHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original.data))).map(b=>b.toString(16).padStart(2,'0')).join('')
    if(imageHash!==source.raw.contentHash)throw new Error('Imported source image bytes changed')
    const session=await service.startProductProductionPreviewV1({scope:importedScope,productionId:build.productionId,expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    return {scope:importedScope,sessionId:session.sessionId}
  },source.scope)
  const importedUrl=new URL(originalUrl);importedUrl.searchParams.set('project',String(restored.scope.projectId));importedUrl.searchParams.set('work',String(restored.scope.workId));importedUrl.searchParams.set('session',String(restored.sessionId))
  await page.goto(importedUrl.toString());await readyRuntime(page);await expect.poll(decoded).toBe(true)
  await page.screenshot({path:info.outputPath('avg-v4-chosen-image-offline-stage-continuation.png')})
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)');await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await readyRuntime(page);await expect.poll(decoded).toBe(true)
  expect(models).toHaveLength(2);expect(images).toHaveLength(1);expect(images[0].model).toBe('agnes-image-2.5-flash')
})

test('stopped Image 2.5 original pixels remain readable without a key after refresh and complete portable restore',async({page},info)=>{
  test.setTimeout(240_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page,false,'agnes.image-2.5-flash.v1')
  for(const label of ['视觉基准',`场景方案：${source.titles[0]}`]){
    const card=panel.getByRole('article',{name:`专业方案：${label}`,exact:true})
    await expect(card).toBeVisible({timeout:60_000})
    if(label==='视觉基准')await card.getByLabel('构图与留白',{exact:true}).fill('作者修订：保留下方完整对白区')
    else await card.getByLabel('生成画面要求',{exact:true}).fill('作者修订：保留下方完整对白区；保持已批准的门窗布局')
    await card.getByRole('button',{name:`保存待确认：${label}`,exact:true}).click()
    await card.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
    await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
    await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  }
  await expect(page.getByRole('article',{name:`图片候选：${source.titles[0]}背景`,exact:true})).toBeVisible({timeout:60_000})
  expect(models).toHaveLength(2);expect(images).toHaveLength(1);expect(images[0].model).toBe('agnes-image-2.5-flash')
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'停止专业视觉制作并保留记录',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'本次专业视觉制作已停止'})).toBeVisible()
  await page.evaluate(async()=>{const load=new Function('p','return import(p)');const config=await load('/storyforge/src/stores/ai-config.ts');config.useAIConfigStore.getState().setConfig({apiKey:''})})
  const originalUrl=page.url()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  const history=page.getByRole('region',{name:'已停止版本的原图',exact:true})
  const snapshot=()=>page.evaluate(async scope=>{
    const load=new Function('p','return import(p)'),backup=await load('/storyforge/src/lib/export/json-export.ts')
    const {exportedAt:_at,...data}=await backup.exportProjectJSON(scope.projectId)
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(b=>b.toString(16).padStart(2,'0')).join('')
  },source.scope)
  const before=await snapshot()
  await history.getByRole('button',{name:'读取原图与来源',exact:true}).click()
  const card=history.getByRole('article',{name:`历史原图：${source.titles[0]}背景`,exact:true})
  await expect(card.getByText(/Agnes Image 2.5 Flash/)).toBeVisible({timeout:60_000})
  await expect(card.getByText(/原调用费用：未知/)).toBeVisible()
  await card.getByRole('button',{name:'查看原图',exact:true}).click()
  await expect.poll(()=>card.getByRole('img').evaluateAll((imgs:HTMLImageElement[])=>imgs.length===1&&imgs[0].complete&&imgs[0].naturalWidth===576)).toBe(true)
  await expect(history.getByRole('button',{name:/生成|采用|选用/})).toHaveCount(0)
  expect(await snapshot()).toBe(before);expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await card.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('avg-v4-stopped-image25-source-preview.png')})
  const restored=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)'),[schema,backup]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts')])
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=await schema.db.productBuilds.where('projectId').equals(projectId).first()
    return {scope:{projectId,worldId:build.worldId,workId:build.workId},productionId:build.productionId}
  },source.scope)
  const importedUrl=new URL(originalUrl);importedUrl.searchParams.set('project',String(restored.scope.projectId));importedUrl.searchParams.set('work',String(restored.scope.workId));importedUrl.searchParams.set('assembly',String(restored.productionId))
  await page.goto(importedUrl.toString());await page.getByRole('button',{name:'素材',exact:true}).click()
  await history.getByRole('button',{name:'读取原图与来源',exact:true}).click()
  await card.getByRole('button',{name:'查看原图',exact:true}).click()
  await expect.poll(()=>card.getByRole('img').evaluateAll((imgs:HTMLImageElement[])=>imgs.length===1&&imgs[0].complete&&imgs[0].naturalWidth===576)).toBe(true)
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)'),lifecycle=await load('/storyforge/src/lib/workspace/lifecycle.ts');await lifecycle.deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await page.getByRole('button',{name:'素材',exact:true}).click()
  await history.getByRole('button',{name:'读取原图与来源',exact:true}).click();await card.getByRole('button',{name:'查看原图',exact:true}).click()
  await expect.poll(()=>card.getByRole('img').evaluateAll((imgs:HTMLImageElement[])=>imgs.length===1&&imgs[0].complete&&imgs[0].naturalWidth===576)).toBe(true)
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
})

for(const nativeAncestor of [false,true])test(nativeAncestor?'author refusal after a native ancestor starts an exact professional child without new requests':'author refuses an exact professional proposal and refresh retains its reason and original evidence without another request',async({page},info)=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page,false,'agnes.image-2.1-flash.v1',false,nativeAncestor),direction=panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})
  await direction.getByLabel('退回依据',{exact:true}).fill('作者拒绝：构图方向不合适，停止本批，保留原始方案与未知费用')
  await direction.getByRole('button',{name:'退回此方案并停止本批',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已记录退回依据并停止本批'})).toBeVisible()
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(panel.getByRole('article',{name:'专业方案：视觉基准',exact:true})).toBeVisible()
  const state=await page.evaluate(async scope=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {db}=await load('/storyforge/src/lib/db/schema.ts');const builds=await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber'),build=builds[builds.length-1];return {id:build.id,number:build.buildNumber,status:build.status,failure:build.failureJson,artifacts:await db.agentRunArtifacts.where('projectId').equals(scope.projectId).count()}},source.scope)
  expect(state.status).toBe('cancelled');expect(state.failure).toContain('作者拒绝');expect(state.artifacts).toBeGreaterThan(0)
  expect(models).toHaveLength(1);expect(images).toHaveLength(0)
  await panel.getByRole('button',{name:'保留记录并准备新版本方案',exact:true}).click()
  await expect(panel.getByRole('status').filter({hasText:'新版本方案'})).toBeVisible()
  await expect(panel).toContainText('上一版已记录 1 次方案、0 次图片调用')
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(panel.getByRole('status').filter({hasText:'新版本方案'})).toBeVisible()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已明确开始，等待逐项作者确认。'})).toBeVisible()
  await expect(page.getByRole('article',{name:'作者确认：系统规则',exact:true}).getByText('等待作者输入',{exact:true})).toBeVisible()
  const replacement=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {db}=await load('/storyforge/src/lib/db/schema.ts')
    const builds=await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber')
    const child=builds[builds.length-1],brief=await db.productProductionBriefs.where('[productionId+revision]').equals([child.productionId,child.briefRevision]).first()
    return {builds:builds.map((b:any)=>({id:b.id,number:b.buildNumber,parent:b.parentBuildNumber,status:b.status,failure:b.failureJson})),childArtifacts:await db.productBuildArtifacts.where('buildId').equals(child.id).count(),
      childPlanRevision:child.planRevision,childRuns:await db.agentRuns.where('productBuildId').equals(child.id).count(),evolutionBase:JSON.parse(brief.briefJson).evolution.base}
  },source.scope)
  expect(replacement.builds).toHaveLength(nativeAncestor?3:2)
  const parent=replacement.builds.find(b=>b.id===state.id)!,child=replacement.builds[replacement.builds.length-1]
  expect(parent.failure).toBe(state.failure);expect(parent.status).toBe('cancelled');expect(child.parent).toBe(parent.number)
  expect(child.status).toBe('building');expect(replacement.childPlanRevision).toBe(1);expect(replacement.childRuns).toBeGreaterThan(0)
  expect(replacement.evolutionBase).toMatchObject({kind:'recovery-build',buildNumber:parent.number})
  expect(replacement.childArtifacts).toBe(0);expect(models).toHaveLength(1);expect(images).toHaveLength(0)
  await page.screenshot({path:info.outputPath('avg-professional-refusal-exact-parent.png'),fullPage:true})
  const proof=info.outputPath('avg-professional-refusal-exact-parent.json')
  await writeFile(proof,JSON.stringify({nativeAncestor,original:state,replacement,modelCalls:models.length,imageCalls:images.length,scope:'Controlled native preparation/start/refusal/refresh/restart. Exact actual parent, frozen Plan/root, old failure and zero new provider requests; no artwork or real provider acceptance.'}))
  await info.attach('avg-professional-refusal-exact-parent',{path:proof,contentType:'application/json'})
})

async function prepareProfessionalFamily(page:Page,options:{propReference?:boolean;version?:4|5;processing?:boolean;processingTargetIndex?:number;reservedForeground?:boolean;boundaryUnmix?:boolean}={}){
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
  if(options.version!==5)await prepareLegacyProfessionalIntent(page,source.scope)
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
  if(options.version!==5)await panel.getByRole('button',{name:'修改尚未开始的专业用途',exact:true}).click()
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
  if(options.version===5){
    const policies=panel.locator('fieldset[aria-label^="参考内容范围："]')
    await expect(policies).toHaveCount(options.propReference?3:2)
    for(const policy of await policies.all()){
      await policy.getByRole('textbox',{name:/^允许参考：/}).fill('只取用本次已确认的配色、主体比例与公开造型')
      await policy.getByRole('textbox',{name:/^必须排除：/}).fill('发光按钮\n新增剧情物件')
    }
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
  if(options.processing){
    if(options.reservedForeground){
      for(const index of [1,2]){
        await page.getByRole('region',{name:'本地图像加工配方',exact:true}).getByLabel('加工目标',{exact:true}).selectOption({index})
        await saveForegroundRecipe(page,options.boundaryUnmix===true)
      }
    }else{
      if(options.processingTargetIndex!==undefined)await page.getByRole('region',{name:'本地图像加工配方',exact:true}).getByLabel('加工目标',{exact:true}).selectOption({index:options.processingTargetIndex})
      await saveProcessingRecipe(page)
    }
  }
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


test('fresh V5 native family form preserves reference content policies and starts the actual five-target Plan without a provider request',async({page},info)=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both original default-off experiments must be explicit')
  const {source,calls}=await prepareProfessionalFamily(page,{version:5,propReference:true,processing:true})
  const state=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [service,contracts]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/product-production/contracts.ts')])
    const view=await service.readAvgAssemblyWorkspaceV1(scope),brief=contracts.parseProductProductionBriefV3(view.details.brief.briefJson),plan=JSON.parse(view.details.build.planJson)
    return {version:brief.avgVisualPlanning.version,scope:brief.avgVisualPlanning.scope,processing:brief.avgVisualPlanning.imageProcessing,
      modelTasks:plan.tasks.filter((t:any)=>t.executionMode==='model').length,imageTasks:plan.tasks.filter((t:any)=>t.kind==='avg-media-image-generate').length,
      imageSkills:plan.tasks.filter((t:any)=>t.kind==='avg-media-image-generate').map((t:any)=>t.skillId),usage:view.visualProgress.budget.usage,assets:JSON.parse(view.draft.editorJson).presentation.stage.assets}
  },source.scope)
  expect(state.version).toBe(5);expect(state.scope.version).toBe(2);expect(state.scope.templates).toHaveLength(5)
  expect(state.scope.referenceCatalog).toHaveLength(3)
  for(const entry of state.scope.referenceCatalog){expect(entry.reference.version).toBe(2);expect(entry.reference.contentPolicy).toEqual({permittedFeatures:['只取用本次已确认的配色、主体比例与公开造型'],excludedFeatures:['发光按钮','新增剧情物件']})}
  expect(state.processing.entries).toHaveLength(1);expect(state.modelTasks).toBe(4);expect(state.imageTasks).toBe(5);expect(new Set(state.imageSkills)).toEqual(new Set(['avg.compiled-image-request.v2']))
  expect(state.usage).toMatchObject({modelCalls:0,mediaCalls:0});expect(state.assets).toEqual([]);expect(calls).toEqual([])
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await page.getByRole('region',{name:'专业视觉策划（实验）',exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:info.outputPath('avg-v5-professional-family-scope.png'),fullPage:true})
})

for(const [visualVersion,noKeyBeforeProcessing,reservedForeground,boundaryUnmix] of [[4,false,false,false],[5,false,false,false],[5,true,false,false],[5,false,true,false],[5,false,true,true]] as const)test(boundaryUnmix?'V5 native boundary-unmix2 family preserves originals and clean edges through producer, Stage, Release, reference and portable restore':reservedForeground?'V5 native declared foreground family removes both opaque backdrops through actual producer, Preview, reference provenance and portable restore':noKeyBeforeProcessing?'V5 native received images resume local processing after key removal and refresh without any new request':visualVersion===4?'professional family images use exact references, alpha and five consumers through native Preview and portable restore':'V5 native family images preserve policy2, local derivatives and five consumers through Source5/6 Preview and portable restore',async({page},info)=>{
  let publishedV5Backup: Record<string, unknown> | undefined
  // Hosted CI reached the final retained-preview read at the old 420s ceiling.
  // Only the three full V5 publication scenarios need CI execution headroom;
  // local limits and every source/pixel/lineage/adoption assertion stay intact.
  test.setTimeout(process.env.CI && visualVersion===5 && !noKeyBeforeProcessing ? 900_000 : 420_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both default-off visual experiments must be explicit')
  const {source,panel,calls}=await prepareProfessionalFamily(page,{propReference:true,version:visualVersion,processing:visualVersion===5,reservedForeground,boundaryUnmix,...(noKeyBeforeProcessing?{processingTargetIndex:4}:{})})
  const fixture=await page.evaluate(async({scope,reservedForeground})=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const view=await(await load('/storyforge/src/lib/avg/assembly-service.ts')).readAvgAssemblyWorkspaceV1(scope)
    const planning=view.details.executionBrief.avgVisualPlanning
    // Original engineering pixels: transparent actor canvas, common body and
    // changed mouth only. These prove physical alpha/slots, never art quality.
    const images=planning.scope.templates.map((t:any,index:number)=>{
      const p=t.parameters,canvas=document.createElement('canvas');canvas.width=p.width;canvas.height=p.height;const c=canvas.getContext('2d')!
      if(t.subjectKind==='character'){
        if(reservedForeground){c.fillStyle='#ff00ff';c.fillRect(0,0,p.width,p.height)}
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
    const foreground=reservedForeground?await load('/storyforge/src/lib/avg/image-foreground-contract.ts'):null
    return {templates:planning.scope.templates,catalog:planning.scope.referenceCatalog,processing:planning.imageProcessing,images,
      foregroundMarkers:foreground?[foreground.AVG_RESERVED_MAGENTA_INVARIANT_V1,foreground.AVG_RESERVED_MAGENTA_FORBIDDEN_V1]:[]}
  },{scope:source.scope,reservedForeground})
  expect(calls).toEqual([])
  const referenceBytes=new Map(source.references.map((r:any)=>[createHash('sha256').update(Buffer.from(r.png,'base64')).digest('hex'),`data:image/png;base64,${r.png}`]))
  const models:any[]=[],images:Array<{key:string;references:string[]}>=[]
  await page.route('https://visual.fixture.invalid/v1/chat/completions',async route=>{
    const body=route.request().postDataJSON();models.push(body)
    const content=body.messages.find((m:any)=>m.role==='user').content as string
    const packet=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1))
    expect(packet.schema).toBe('storyforge.avg.visual-planning-inputs');if(visualVersion===5)expect(packet.version).toBe(5);expect(content).not.toContain(source.scenes[0].text);expect(content).not.toContain('data:image/')
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
    if(visualVersion===5){expect(body.prompt).toContain('发光按钮');expect(body.prompt).toContain('只取用本次已确认的配色、主体比例与公开造型')}
    if(reservedForeground&&template.subjectKind==='character')for(const marker of fixture.foregroundMarkers)expect(body.prompt).toContain(marker)
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
  if(noKeyBeforeProcessing){
    // Bounded real scheduler cycles create all five actual HTTP/producer rows.
    // The final requirement owns the recipe, so its processor cannot be ready
    // until the next cycle. No execution result, event, pixel or adoption is
    // replaced. The subsequent cold UI resumes the real local processor.
    const received=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      const [{db},service,visual,configured,scheduler,config]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/product-production/service.ts'),
        load('/storyforge/src/lib/avg/visual-planning-workspace.ts'),load('/storyforge/src/lib/product-production/production-executor.ts'),load('/storyforge/src/lib/product-production/scheduler.ts'),load('/storyforge/src/stores/ai-config.ts')])
      const build=await db.productBuilds.where('workId').equals(scope.workId).first(),details=await service.readProductProductionDetailsV1(scope,build.productionId,['avg'])
      const execution=await visual.resolveAvgVisualPlanningExecutionV5(scope,details.executionBrief,build.id)
      const executor=configured.createConfiguredProductProductionExecutorV1({production:details.production,brief:details.executionBrief,...execution})
      const raws=()=>db.productBuildArtifacts.where('buildId').equals(build.id).filter((r:any)=>r.status==='accepted'&&r.artifactKey.startsWith('avg.media.raw.')).count()
      for(let cycle=0;cycle<12&&await raws()<5;cycle++)await scheduler.runProductProductionSchedulerCycleV1({scope,productionId:build.productionId,...execution,executor})
      const rawCount=await raws(),processed=await db.productBuildArtifacts.where('buildId').equals(build.id).filter((r:any)=>r.status==='accepted'&&r.artifactKey.startsWith('avg.media.processed.')).count()
      if(rawCount!==5||processed!==0)throw new Error('Expected actual completed raw prefix before its first local processor')
      config.useAIConfigStore.getState().setConfig({apiKey:''})
      return {rawCount,processed,keyConfigured:!!config.useAIConfigStore.getState().config.apiKey}
    },source.scope)
    expect(received).toEqual({rawCount:5,processed:0,keyConfigured:false});expect(models).toHaveLength(4);expect(images).toHaveLength(5)
    await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
    expect(await page.evaluate(async()=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {useAIConfigStore}=await load('/storyforge/src/stores/ai-config.ts');return !!useAIConfigStore.getState().config.apiKey})).toBe(false)
    const local=page.getByRole('button',{name:'执行本地加工（0 次新请求）',exact:true})
    await expect(local).toBeEnabled();await local.click()
    await expect.poll(()=>page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
      const build=await db.productBuilds.where('workId').equals(scope.workId).first()
      return db.productBuildArtifacts.where('buildId').equals(build.id).filter((r:any)=>r.status==='accepted'&&r.artifactKey.startsWith('avg.media.processed.')).count()
    },source.scope),{timeout:30_000}).toBe(1)
    await expect(local).toHaveCount(0)
    expect(models).toHaveLength(4);expect(images).toHaveLength(5)
    const evidence=info.outputPath('native-no-key-before-first-local-processing.json')
    await writeFile(evidence,JSON.stringify({before:received,after:{processed:1,modelCalls:models.length,imageCalls:images.length},scope:'Actual cold browser UI resumed native local processor, controlled HTTP originals, no provider requests after key removal. No artistic acceptance.'}))
    await info.attach('native-no-key-before-first-local-processing',{path:evidence,contentType:'application/json'})
  }else{
    await generate.click()
    await expect(page.getByRole('status').filter({hasText:'专业视觉步骤已执行'})).toBeVisible({timeout:60_000})
  }
  for(const t of fixture.templates)await expect(page.getByRole('article',{name:`图片候选：${t.parameters.name}`,exact:true}).getByText('原图已接收，等待作者选择',{exact:false})).toBeVisible({timeout:60_000})
  expect(images).toHaveLength(5);expect(images.map(i=>i.references.length).sort()).toEqual([1,2,2,2,2])
  const measured=await page.evaluate(async({scope,visualVersion,reservedForeground})=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [service,decoder]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/image-decoder.ts')])
    const view=await service.readAvgAssemblyWorkspaceV1(scope),result=[]
    const preview=visualVersion===5?await load('/storyforge/src/lib/avg/media-candidate-preview-v5.ts'):service
    for(const r of view.imageDefinition.mediaBatch.requirements){const row=view.artifacts.find((a:any)=>a.artifactKey===`avg.media.raw.${r.requirementKey}`),bytes=await (visualVersion===5?preview.readAvgRawImageCandidateBytesV5:preview.readAvgRawImageCandidateBytesV2)({scope,productionId:view.details.production.id,requirementKey:r.requirementKey,version:row.version,contentHash:row.contentHash});result.push({key:r.requirementKey,...await decoder.inspectAvgImageBytesV1({data:bytes.data,...bytes.asset,requireAlpha:reservedForeground?false:r.alpha==='required'})})}
    return result
  },{scope:source.scope,visualVersion,reservedForeground})
  expect(measured.filter((r:any)=>r.hasAlpha)).toHaveLength(reservedForeground?0:2)
  if(reservedForeground){
    const observations=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
      const [service,preview,contracts,blobs]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/media-candidate-preview-v5.ts'),
        load('/storyforge/src/lib/avg/image-processing-contract-v2.ts'),load('/storyforge/src/lib/product-production/media-blob-store.ts')])
      const view=await service.readAvgAssemblyWorkspaceV1(scope),results=[]
      const pixel=async(data:ArrayBuffer,width:number,height:number,x:number,y:number)=>{
        const image=await createImageBitmap(new Blob([data],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
        const context=canvas.getContext('2d')!;context.drawImage(image,0,0);image.close();return Array.from(context.getImageData(x,y,1,1).data)
      }
      const fringe=async(data:ArrayBuffer,width:number,height:number)=>{
        const image=await createImageBitmap(new Blob([data],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
        const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);image.close();const rgba=ctx.getImageData(0,0,width,height).data
        let count=0;for(let y=32;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;if(rgba[at+3]>=16&&rgba[at]>=rgba[at+1]+25&&rgba[at+2]>=rgba[at+1]+25)count++}
        return count
      }
      for(const target of view.imageDefinition.mediaBatch.requirements.filter((r:any)=>r.mediaKind==='character-pose'||r.mediaKind==='character-expression')){
        const row=view.artifacts.find((a:any)=>a.artifactKey===`avg.media.processed.${target.requirementKey}`)
        if(!row)throw new Error('Missing actual family foreground producer')
        const payload=await contracts.parseAvgProcessedImagePayloadV2(row.payloadJson)
        const raw=await preview.readAvgRawImageCandidateBytesV5({scope,productionId:view.details.production.id,requirementKey:target.requirementKey,version:payload.raw.version,contentHash:payload.raw.contentHash})
        const derived=await preview.readAvgProcessedImageCandidateBytesV5({scope,productionId:view.details.production.id,requirementKey:target.requirementKey,version:row.version,contentHash:row.contentHash})
        results.push({key:target.requirementKey,receipt:payload.receipt,policyVersion:payload.recipe.foreground.version,
          outputFringeOutsideMarkerBand:await fringe(derived.data,target.width,target.height),sourceCorner:await pixel(raw.data,target.width,target.height,0,0),
          outputCorner:await pixel(derived.data,target.width,target.height,0,0),
          sourceBody:await pixel(raw.data,target.width,target.height,Math.floor(target.width*.5),Math.floor(target.height*.5)),
          outputBody:await pixel(derived.data,target.width,target.height,Math.floor(target.width*.5),Math.floor(target.height*.5)),
          rawPreserved:await blobs.sha256MediaData(raw.data)===payload.receipt.source.contentHash,
          outputHashMatches:await blobs.sha256MediaData(derived.data)===payload.receipt.output.contentHash})
      }
      return results
    },source.scope)
    expect(observations).toHaveLength(2)
    for(const observation of observations){
      expect(observation.sourceCorner).toEqual([255,0,255,255]);expect(observation.outputCorner).toEqual([0,0,0,0])
      expect(observation.sourceBody).toEqual([83,122,114,255]);expect(observation.outputBody).toEqual(observation.sourceBody)
      expect(observation.rawPreserved&&observation.outputHashMatches).toBe(true)
      expect(observation.receipt).toMatchObject({version:2,processor:'storyforge.avg.local-foreground-canvas.v2',output:{hasAlpha:true},foreground:{reservedBorderRatio:1}})
      expect(observation.receipt.foreground.clearedPixelCount).toBeGreaterThan(0)
      expect(observation.receipt.foreground.opaquePixelCount).toBeGreaterThan(0)
      expect(observation.receipt.foreground.sourcePixelHash).not.toBe(observation.receipt.foreground.cutoutPixelHash)
      if(boundaryUnmix){expect(observation.policyVersion).toBe(2);expect(observation.receipt.foreground).toMatchObject({version:2,algorithm:'storyforge.avg.foreground.declared-magenta-boundary-unmix.v2'});expect(observation.outputFringeOutsideMarkerBand).toBe(0)}
      else expect(observation.policyVersion).toBe(1)
    }
    await info.attach('native-family-both-foreground-producer-pixels.json',{body:JSON.stringify(observations,null,2),contentType:'application/json'})
  }
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
    if(visualVersion===5&&fixture.processing.entries.some((e:any)=>e.requirementKey===t.parameters.requirementKey)){
      await expect(card.getByText('供应商原图（保留）',{exact:false})).toBeVisible()
      await expect(card.getByText('加工后候选',{exact:false})).toBeVisible()
      const viewport=page.viewportSize()!
      await page.setViewportSize({...viewport,height:1800})
      await card.locator('.avg-visual-review-grid').scrollIntoViewIfNeeded()
      await card.locator('.avg-visual-review-grid').screenshot({path:info.outputPath('avg-v5-native-processing-policy-comparison.png')})
      await page.setViewportSize(viewport)
    }
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
  await page.screenshot({path:info.outputPath(`avg-v${visualVersion}-family-pose-inventory.png`),fullPage:true})
  await inventory.getByRole('button',{name:'关闭',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[0].text)
  await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'继续保管',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[1].text)
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  const nextBounds=await page.locator('.avg-actor img').boundingBox();expect(nextBounds).not.toBeNull();expect(bounds).not.toBeNull()
  expect(Math.abs(nextBounds!.width-bounds!.width)).toBeLessThan(1);expect(Math.abs(nextBounds!.height-bounds!.height)).toBeLessThan(1)
  await page.reload();await readyRuntime(page);await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[1].text)
  await page.screenshot({path:info.outputPath(`avg-v${visualVersion}-family-expression.png`),fullPage:true})
  if(visualVersion===5&&!noKeyBeforeProcessing){
    // The original V5 Brief/producer/processed/author chain stays intact.
    // A complete route, all native catalog pixels and independent publication
    // are additional gates; the preview's technical QA is not rewritten.
    await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
    await page.getByRole('button',{name:'继续',exact:true}).click()
    const routeSession=Number(new URL(originalUrl).searchParams.get('session'))
    expect(routeSession).toBeGreaterThan(0)
    await expect.poll(()=>page.evaluate(async id=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      return (await(await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
    },routeSession)).toBe(true)
    await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}&assembly=1`)
    await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
    const release=page.getByRole('region',{name:'本地原型版本验收',exact:true})
    await release.getByRole('button',{name:'准备本地原型版本',exact:true}).click()
    await expect(release.getByRole('alert')).toBeVisible()
    await release.getByRole('checkbox',{name:'我已核对此预览存档的完整路线，确认系统与演出结果',exact:true}).check()
    await release.getByRole('button',{name:'确认此预览的完整路线',exact:true}).click()
    await expect(release.getByText(/完整路线：已确认/)).toBeVisible()
    await release.getByRole('button',{name:'准备本地原型版本',exact:true}).click()
    await expect(release.getByRole('alert')).toBeVisible()
    await release.getByRole('button',{name:'验证全部冻结媒资',exact:true}).click()
    await expect(release.getByRole('status').filter({hasText:'全部冻结媒资已实际解码'})).toBeVisible({timeout:60_000})
    await release.getByRole('button',{name:'准备本地原型版本',exact:true}).click()
    await expect(release.getByRole('status').filter({hasText:'本地原型版本已准备，请核对后保存。'})).toBeVisible({timeout:process.env.CI ? 180_000 : 60_000})
    await expect(release.getByRole('button',{name:'确认保存本地原型版本',exact:true})).toBeDisabled()
    await release.getByRole('checkbox',{name:'我已核对版本，将它保存为本地原型',exact:true}).check()
    const publicationStarted=Date.now(),publicationWaitMs=process.env.CI ? 180_000 : 60_000
    await release.getByRole('button',{name:'确认保存本地原型版本',exact:true}).click()
    // Publication revalidates the same five-image proof set as preparation;
    // retain its existing constrained-runner budget and actual elapsed time.
    await expect(release.getByText('此版本已冻结；后续修改请创建新 Build。',{exact:true})).toBeVisible({timeout:publicationWaitMs})
    const publicationDurationPath=info.outputPath('five-image-publication-duration.json')
    await writeFile(publicationDurationPath,JSON.stringify({elapsedMs:Date.now()-publicationStarted,maximumWaitMs:publicationWaitMs}))
    await info.attach('five-image-publication-duration',{path:publicationDurationPath,contentType:'application/json'})
    publishedV5Backup=await page.evaluate(async({scope,backgroundKey,poseKey,expressionKey,iconKey,detailKey})=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      const [{db},files,pkg,module,config]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),
        load('/storyforge/src/lib/product-production/runtime-package.ts'),load('/storyforge/src/lib/avg/executable-module.ts'),load('/storyforge/src/stores/ai-config.ts')])
      const build=await db.productBuilds.where('workId').equals(scope.workId).first(),record=await db.productReleases.get(build.releasedProductReleaseId)
      const manifest=await pkg.verifyProductReleaseManifest(record.manifestJson)
      const brief=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
      if(JSON.parse(brief.briefJson).avgAssembly||JSON.parse(brief.briefJson).avgVisualPlanning.version!==5||config.useAIConfigStore.getState().config.apiKey)throw new Error('Original V5/no-Key publication boundary changed')
      return {schema:'storyforge.avg.visual-release-native-test-export',version:1,backup:await files.exportProjectJSON(scope.projectId),
        expected:{scope,releaseId:record.id,releaseUid:manifest.lineage.releaseUid,manifestJson:record.manifestJson,packageHash:build.packageHash,
          previewJson:build.previewManifestJson,assets:module.avgRuntimeStage(manifest.runtimePackage).assets,backgroundKey,poseKey,expressionKey,iconKey,detailKey}}
    },{scope:source.scope,backgroundKey:background.assetKey,poseKey:pose.assetKey,expressionKey:expression.assetKey,iconKey:icon.assetKey,detailKey:detail.assetKey})
    await release.getByRole('button',{name:'从此版本开始新存档',exact:true}).click()
    await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
    await expect.poll(()=>page.locator('.avg-background img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(background.width)
    const releaseSession=Number(new URL(page.url()).searchParams.get('session'))
    const binding=await page.evaluate(async id=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;return(await load('/storyforge/src/lib/db/schema.ts')).db.productRuntimeSessions.get(id)},releaseSession)
    expect(binding.productBuildId).toBeNull();expect(binding.productReleaseId).toBe((publishedV5Backup.expected as any).releaseId)
    await page.screenshot({path:info.outputPath('avg-v5-original-release-playing.png')})
    await page.goto(originalUrl)
    await readyRuntime(page)
    await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
    expect(models).toHaveLength(4);expect(images).toHaveLength(5);expect(calls).toEqual([])
  }
  const restoreStarted=Date.now()
  const restored=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [schema,backup,service,proof]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/product-production/service.ts'),load('/storyforge/src/lib/product-production/artifact-store.ts')])
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=await schema.db.productBuilds.where('projectId').equals(projectId).first(),importedScope={projectId,worldId:build.worldId,workId:build.workId}
    await service.recoverImportedProductProductionProofsV1({scope:importedScope,productionId:build.productionId})
    await proof.verifyProductBuildTerminalArtifactSetV1({scope:importedScope,productionId:build.productionId,buildId:build.id,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})
    const session=await service.startProductProductionPreviewV1({scope:importedScope,productionId:build.productionId,expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    return {scope:importedScope,sessionId:session.sessionId}
  },source.scope)
  const restoreTiming=info.outputPath('five-image-portable-proof-duration.json')
  await writeFile(restoreTiming,JSON.stringify({elapsedMs:Date.now()-restoreStarted,totalTestLimitMs:420_000}))
  await info.attach('five-image-portable-proof-duration',{path:restoreTiming,contentType:'application/json'})
  const importedUrl=new URL(originalUrl);importedUrl.searchParams.set('project',String(restored.scope.projectId));importedUrl.searchParams.set('work',String(restored.scope.workId));importedUrl.searchParams.set('session',String(restored.sessionId))
  await page.goto(importedUrl.toString());await readyRuntime(page);await expect.poll(()=>page.locator('.avg-actor img').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(pose.width)
  await page.getByRole('button',{name:'物品与证据',exact:true}).click();await expect.poll(()=>page.getByRole('dialog',{name:'物品与证据',exact:true}).locator('.avg-inventory-detail-image').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(detail.width)
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await readyRuntime(page);await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  expect(models).toHaveLength(4);expect(images).toHaveLength(5);expect(calls).toEqual([])
  await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
  if(visualVersion===5){
    await page.getByRole('button',{name:'素材',exact:true}).click()
    const history=page.getByRole('region',{name:'新版已停止版本的图像',exact:true})
    await history.getByRole('button',{name:'读取保留图像与来源',exact:true}).click()
    await expect(history.getByRole('status')).toContainText('5 项原图来源可读取')
    const target=fixture.templates.find((t:any)=>t.parameters.requirementKey===fixture.processing.entries[0].requirementKey)!
    const original=history.getByRole('article',{name:`新版历史图像：${target.parameters.name}`,exact:true})
    await original.getByRole('button',{name:'查看保留图像',exact:true}).click()
    await expect(original.getByRole('img')).toHaveCount(2)
    await expect.poll(()=>original.getByRole('img').evaluateAll((imgs:HTMLImageElement[])=>imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true)
    await expect(history.getByRole('button',{name:/保存选图候选/})).toHaveCount(0)
    expect(models).toHaveLength(4);expect(images).toHaveLength(5)
    const viewport=page.viewportSize()!
    await page.setViewportSize({...viewport,height:1800});await original.scrollIntoViewIfNeeded()
    await original.screenshot({path:info.outputPath('avg-v5-frozen-historical-raw-processed.png')})
    await page.setViewportSize(viewport)
  }
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click();await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const retainStarted=Date.now()
  await page.getByRole('button',{name:'保留专业演出图并准备新方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已保留准确专业演出图并准备零生成调用的新方案'})).toBeVisible({timeout:30_000})
  const retainTiming=info.outputPath('five-image-stage-retention-prepare-duration.json')
  await writeFile(retainTiming,JSON.stringify({elapsedMs:Date.now()-retainStarted,maximumWaitMs:30_000}))
  await info.attach('five-image-stage-retention-prepare-duration',{path:retainTiming,contentType:'application/json'})
  await page.reload();await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await adoptSource(page,'演出与媒资',true)
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  const retained=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)'),[schema,proof,workspace]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/product-production/artifact-store.ts'),load('/storyforge/src/lib/avg/author-workspace-contract.ts')])
    const build=(await schema.db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber')).at(-1),draft=await schema.db.avgAuthoringDrafts.where('workId').equals(scope.workId).first()
    await proof.verifyProductBuildTerminalArtifactSetV1({scope,productionId:build.productionId,buildId:build.id,expectedControlEpoch:build.controlEpoch,expectedPlanHash:build.planHash})
    return workspace.parseAvgAuthorWorkspaceV1(draft.editorJson).presentation.inheritedImages.map((entry:any)=>({assetKey:entry.assetKey,version:entry.source.version,originalHash:entry.source.raw.contentHash}))
  },source.scope)
  expect(retained).toHaveLength(5);expect(retained.map((entry:any)=>entry.version).sort()).toEqual(visualVersion===5?(reservedForeground?[5,5,5,6,6]:[5,5,5,5,6]):[2,2,2,2,2])
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((imgs:HTMLImageElement[])=>imgs.length>0&&imgs.every(i=>i.complete&&i.naturalWidth>0))).toBe(true)
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',pose.altText)
  await page.getByRole('button',{name:'物品与证据',exact:true}).click()
  const retainedInventory=page.getByRole('dialog',{name:'物品与证据',exact:true})
  await expect.poll(()=>retainedInventory.locator('nav img').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(icon.width)
  await expect.poll(()=>retainedInventory.locator('.avg-inventory-detail-image').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(detail.width)
  await retainedInventory.getByRole('button',{name:'关闭',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[0].text)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'继续保管',exact:true}).click()
  await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[1].text)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.screenshot({path:info.outputPath(`avg-v${visualVersion}-five-originals-retained-new-stage.png`),fullPage:true})
  expect(models).toHaveLength(4);expect(images).toHaveLength(5);expect(calls).toEqual([])
  if(visualVersion===5&&!noKeyBeforeProcessing){
    // A real later Plan/root is explicitly started and stopped without any
    // source adoption or provider dispatch. Keep the already chosen Source5/6
    // images from Build1 through that empty batch, using the same native action.
    await page.goto(`./avg/production?project=${source.scope.projectId}&work=${source.scope.workId}`)
    await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click();await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
    const later=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      const [service,drafts,store]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/stores/ai-config.ts')])
      const view=await service.readAvgAssemblyWorkspaceV1(scope),original=view.details.buildHistory.find((b:any)=>b.buildNumber===1)
      const frozen=JSON.parse(view.details.briefHistory.find((b:any)=>b.revision===original.briefRevision).briefJson).avgVisualPlanning.scope
      const {sourceInputHash:_hash,aspectRatio:_ratio,...planning}=structuredClone(frozen)
      const draft=await drafts.readAvgDraftV1(scope),workspace=JSON.parse(draft.editorJson),template=planning.templates.find((t:any)=>t.subjectKind==='environment')
      const scene=workspace.systemPlan.scenes.find((s:any)=>s.key!==template.parameters.consumer.sceneKey),script=workspace.scripts.find((s:any)=>s.sceneKey===scene.key)
      template.parameters.assetKey+='.later';template.parameters.requirementKey+='.later';template.parameters.name='尚未生成的后继工程背景'
      template.parameters.consumer={...template.parameters.consumer,consumerKey:template.parameters.consumer.consumerKey+'.later',sceneKey:scene.key,subjectKey:scene.key}
      template.parameters.family={...template.parameters.family,familyKey:template.parameters.family.familyKey+'.later',subjectKey:scene.key}
      template.parameters.triggerBeatKey=script.lines[0].lineKey
      planning.batchKey+='.later';planning.revision++;planning.templates=[template]
      planning.referenceCatalog=planning.referenceCatalog.filter((r:any)=>template.allowedReferenceKeys.includes(r.referenceKey))
      store.useAIConfigStore.getState().setConfig({apiKey:'test-only-intercepted-later-preparation'})
      const prepared=await service.prepareAvgAssemblyBriefV1({scope,expectedDraftRevision:draft.revision,visualPlanning:planning})
      return {productionId:prepared.production.id,priorNumber:view.details.build.buildNumber}
    },source.scope)
    await page.getByRole('button',{name:'读取已保存版本',exact:true}).click()
    await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
    await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'已明确开始，等待逐项作者确认。'})).toBeVisible()
    await page.getByRole('button',{name:'停止专业视觉制作并保留记录',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'本次专业视觉制作已停止'})).toBeVisible()
    const empty=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
      const build=(await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber')).at(-1)
      const draft=await db.avgAuthoringDrafts.where('workId').equals(scope.workId).first()
      return {number:build.buildNumber,status:build.status,planRevision:build.planRevision,rawCount:await db.productBuildArtifacts.where('buildId').equals(build.id).filter((a:any)=>a.artifactKey.startsWith('avg.media.raw.')).count(),sources:JSON.parse(draft.editorJson).presentation.inheritedImages.map((e:any)=>({version:e.source.version,build:e.source.raw.buildNumber,hash:e.source.raw.contentHash}))}
    },source.scope)
    expect(empty).toMatchObject({number:later.priorNumber+1,status:'cancelled',planRevision:1,rawCount:0})
    expect(empty.sources.map((e:any)=>e.version).sort()).toEqual(reservedForeground?[5,5,5,6,6]:[5,5,5,5,6]);expect(empty.sources.every((e:any)=>e.build===1)).toBe(true)
    await page.evaluate(async()=>{const load=new Function('p','return import(p)') as (p:string)=>Promise<any>;const {useAIConfigStore}=await load('/storyforge/src/stores/ai-config.ts');useAIConfigStore.getState().setConfig({apiKey:''})})
    await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
    await page.getByRole('button',{name:'保留专业演出图并准备新方案',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'已保留准确专业演出图并准备零生成调用的新方案'})).toBeVisible({timeout:30_000})
    await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
    await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'已明确开始，等待逐项作者确认。'})).toBeVisible()
    await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
    await adoptSource(page,'演出与媒资',true)
    await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
    const continued=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
      const builds=await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber'),build=builds.at(-1)
      const brief=JSON.parse((await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()).briefJson)
      const draft=await db.avgAuthoringDrafts.where('workId').equals(scope.workId).first()
      return {number:build.buildNumber,parent:build.parentBuildNumber,status:build.status,planRevision:build.planRevision,assemblyVersion:brief.avgAssembly.version,visual:!!brief.avgVisualPlanning,capabilities:brief.capabilityRequirements,budget:brief.productionBudget,rawCount:await db.productBuildArtifacts.where('buildId').equals(build.id).filter((a:any)=>a.artifactKey.startsWith('avg.media.raw.')).count(),sources:JSON.parse(draft.editorJson).presentation.inheritedImages.map((e:any)=>({version:e.source.version,build:e.source.raw.buildNumber,hash:e.source.raw.contentHash})),olderPreviews:builds.filter((b:any)=>b.buildNumber<build.parentBuildNumber).map((b:any)=>({number:b.buildNumber,previewHash:b.previewHash}))}
    },source.scope)
    expect(continued).toMatchObject({number:empty.number+1,parent:empty.number,status:'preview-ready',planRevision:1,assemblyVersion:1,visual:false,capabilities:[],rawCount:0,budget:{maximumMediaCalls:0,maximumModelCalls:0}})
    expect(continued.sources).toEqual(empty.sources);expect(continued.olderPreviews.every((b:any)=>b.previewHash)).toBe(true)
    expect(models).toHaveLength(4);expect(images).toHaveLength(5);expect(calls).toEqual([])
    await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
    await expect.poll(()=>page.locator('.avg-background img').evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(background.width)
    await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',pose.altText)
    await page.screenshot({path:info.outputPath('avg-v5-earlier-images-after-empty-batch.png'),fullPage:true})
    const proof=info.outputPath('avg-v5-earlier-images-after-empty-batch.json')
    await writeFile(proof,JSON.stringify({empty,continued,modelCalls:models.length,imageCalls:images.length,scope:'Actual native start/stop/olderSource5and6 continuation, no provider dispatch in later or continued Builds. Controlled engineering pixels, not art or real-provider acceptance.'}))
    await info.attach('avg-v5-earlier-images-after-empty-batch',{path:proof,contentType:'application/json'})
  }
  if(publishedV5Backup){
    const expected=publishedV5Backup.expected as any
    const originalRelease=await page.evaluate(async expected=>{
      const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
      const [{db},media,hash,runtime]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/product-production/release-media.ts'),
        load('/storyforge/src/lib/product-production/media-blob-store.ts'),load('/storyforge/src/lib/product/runtime-instances.ts')])
      const record=await db.productReleases.get(expected.releaseId)
      if(record.manifestJson!==expected.manifestJson)throw new Error('Original V5 Release changed after child revisions')
      for(const asset of expected.assets)if(await hash.sha256MediaData(await media.readProductReleaseMediaBytes({scope:expected.scope,productReleaseId:record.id,asset}))!==asset.blobContentHash)throw new Error('Original V5 Release bytes changed')
      return runtime.createProductRuntimeInstance({scope:expected.scope,kind:'avg',title:'V5 original after child revisions',productSource:{kind:'release',productReleaseId:record.id}})
    },expected)
    const oldReleaseUrl=new URL(originalUrl);oldReleaseUrl.searchParams.set('session',String(originalRelease.id))
    await page.goto(oldReleaseUrl.toString())
    await expect.poll(()=>page.locator('.avg-background img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(background.width)
    await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',pose.altText)
    expect(models).toHaveLength(4);expect(images).toHaveLength(5);expect(calls).toEqual([])
    // Export only after the whole original native case, including later
    // source5/6 revisions, restore and old-release boundaries, has passed.
    // The shared closed-reader consumes the original five-image case only.
    // Each foreground variant retains its own complete successful export.
    const exportPath=(!reservedForeground?process.env.AVG_VISUAL_RELEASE_BACKUP_FILE:undefined)??info.outputPath('v5-native-release.json')
    await mkdir(dirname(exportPath),{recursive:true})
    await writeFile(exportPath,JSON.stringify({...publishedV5Backup,backupSHA256:createHash('sha256').update(JSON.stringify(publishedV5Backup.backup)).digest('hex')}),{flag:'wx'})
  }
})

for(const outcome of ['unknown','unauthorized'] as const)test(`V5 native ${outcome} keeps the original response and never silently resends`,async({page},info)=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both original default-off experiments must be explicit')
  const {source,panel,calls}=await prepareProfessionalFamily(page,{version:5,propReference:true,processing:true})
  let modelCalls=0,imageCalls=0
  await page.route('https://visual.fixture.invalid/v1/chat/completions',async route=>{
    modelCalls++
    const body=route.request().postDataJSON(),content=body.messages.find((m:any)=>m.role==='user').content as string
    const packet=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1))
    expect(packet.version).toBe(5)
    const direction=body.messages.find((m:any)=>m.role==='system').content.includes('storyforge.avg.visual-bible')
    const payload=direction?{schema:'storyforge.avg.visual-bible',version:1,style:{medium:'二维工程插画',rendering:'统一轮廓',palette:['灰绿'],lighting:'自然光',composition:'保留对白区'},
      subjects:packet.subjects.map((t:any)=>({subjectKey:t.subjectKey,subjectKind:t.subjectKind,identityInvariants:['工程公开身份'],allowedChanges:['本次画面用途'],forbiddenDepictions:['新增秘密']}))}
      :{schema:'storyforge.avg.media-brief',version:1,subjectKey:packet.subjects[0].subjectKey,subjectKind:packet.subjects[0].subjectKind,designIntent:'工程失败保留校准，不签艺术质量',
        outputs:packet.requirements.map((r:any)=>({requirementKey:r.requirementKey,prompt:`工程故障候选[${r.requirementKey}]`,negativePrompt:'水印',invariants:['保持公开主体'],forbiddenDepictions:['新增秘密'],referenceKeys:r.requiredReferenceKeys}))}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(payload)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:200}})})
  })
  await page.route('https://visual.fixture.invalid/v1/images/generations',async route=>{
    imageCalls++
    expect(imageCalls).toBe(1)
    await route.fulfill({status:outcome==='unknown'?202:401,contentType:'application/json',body:JSON.stringify(outcome==='unknown'?{operation_id:'controlled-native-v5-pending'}:{error:{message:'controlled native authorization failure'}})})
  })
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const generate=panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true})
  const approve=async(label:string)=>{
    const card=panel.getByRole('article',{name:`专业方案：${label}`,exact:true})
    await card.getByRole('button',{name:`保存待确认：${label}`,exact:true}).click()
    await card.getByRole('checkbox',{name:'我已核对本方案内容及允许参考',exact:true}).check()
    await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
    await expect(card.getByText('此方案已明确采用。',{exact:false})).toBeVisible()
  }
  await generate.click();await approve('视觉基准')
  await generate.click();for(const label of [`场景方案：${source.titles[0]}`,`人物方案：${source.characterName}`,`物件方案：${source.itemName}`])await approve(label)
  await generate.click()
  const restart=panel.getByRole('button',{name:'保留记录并准备新版本方案',exact:true})
  await expect(restart).toBeVisible({timeout:60_000})
  const read=()=>page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [{db},config]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/stores/ai-config.ts')])
    const build=await db.productBuilds.where('workId').equals(scope.workId).first(),production=await db.productProductions.get(build.productionId),draft=await db.avgAuthoringDrafts.where('workId').equals(scope.workId).first()
    return {buildNumber:build.buildNumber,status:build.status,failure:build.failureJson,ledger:build.budgetLedgerJson,briefRevision:production.currentBriefRevision,draftRevision:draft.revision,
      rawCount:await db.productBuildArtifacts.where('buildId').equals(build.id).filter((r:any)=>r.artifactKey.startsWith('avg.media.raw.')).count(),keyConfigured:!!config.useAIConfigStore.getState().config.apiKey}
  },source.scope)
  const before=await read()
  expect(['failed','recovery-required']).toContain(before.status);expect(before.rawCount).toBe(0);expect(before.keyConfigured).toBe(true)
  expect(modelCalls).toBe(4);expect(imageCalls).toBe(1)
  if(outcome==='unknown'){
    await restart.click()
    await expect(page.getByRole('alert').filter({hasText:/未知结果.*不能|不能.*重发/})).toBeVisible()
    expect(await read()).toEqual(before)
  }
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  expect(await read()).toEqual(before);expect(modelCalls).toBe(4);expect(imageCalls).toBe(1);expect(calls).toEqual([])
  const proof=info.outputPath(`avg-v5-native-${outcome}-retained-without-resend.json`)
  await writeFile(proof,JSON.stringify({outcome,modelCalls,imageCalls,...before,scope:'Controlled actual native HTTP failure, original records retained, no new request or key reset; unknown restart rejected before any new Brief.'}))
  await info.attach(`avg-v5-native-${outcome}-retained`,{path:proof,contentType:'application/json'})
})

test('unselected original is revalidated offline into current review and Preview then retained through source3 and complete restore',async({page},info)=>{
  test.setTimeout(420_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page,false)
  const labels=['视觉基准',`场景方案：${source.titles[0]}`],name=`${source.titles[0]}背景`
  const adoptDesign=(label:string)=>adoptProfessionalDesign(page,label)
  for(const label of labels)await adoptDesign(label)
  const image=page.getByRole('article',{name:`图片候选：${name}`,exact:true})
  await expect(image.getByText('原图已接收，等待作者选择',{exact:true})).toBeVisible({timeout:60_000})
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'停止专业视觉制作并保留记录',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'本次专业视觉制作已停止'})).toBeVisible()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'保留记录并准备新版本方案',exact:true}).click()
  const roles=panel.getByRole('region',{name:'历史专业方案复用',exact:true})
  await roles.getByRole('button',{name:'读取此版本已确认方案',exact:true}).click()
  for(const label of labels)await roles.getByRole('checkbox',{name:`复用已确认方案：${label}`,exact:true}).check()
  await roles.getByRole('button',{name:'保存复用方案',exact:true}).click()
  await expect(panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/)).toBeVisible()
  const history=page.getByRole('region',{name:'已停止版本的原图',exact:true})
  await history.getByRole('button',{name:'读取原图与来源',exact:true}).click()
  await history.getByRole('checkbox',{name:`沿用原图：${name}`,exact:true}).check()
  await history.getByRole('button',{name:'保存原图沿用方案',exact:true}).click()
  await expect(panel.getByText(/新方案上限：0 次方案调用、0 次图片请求/)).toBeVisible()
  await page.evaluate(async()=>{const load=new Function('p','return import(p)');(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({apiKey:''})})
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(page.getByText('本方案保留原图，图片任务为零调用复验。',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  for(const label of labels){
    await expect(panel.getByRole('article',{name:`专业方案：${label}`,exact:true}).getByText(/本岗位没有新的模型调用/)).toBeVisible()
    await adoptDesign(label)
  }
  await expect(image.getByText('原图已接收，等待作者选择',{exact:true})).toBeVisible({timeout:60_000})
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
  await confirmEngineeringVisualReview(image,name)
  await image.getByRole('button',{name:`保存选图候选：${name}`,exact:true}).click()
  await image.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
  await image.getByRole('button',{name:`确认选用：${name}`,exact:true}).click()
  await page.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adoptSource(page,'演出与媒资',true)
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click()
  await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await page.getByRole('button',{name:'保留专业演出图并准备新方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已保留准确专业演出图并准备零生成调用的新方案'})).toBeVisible({timeout:60_000})
  await page.reload();await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
  await adoptSource(page,'演出与媒资',true)
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  const decoded=()=>page.locator('.avg-background img').evaluateAll((imgs:HTMLImageElement[])=>imgs.length===1&&imgs.every(img=>img.complete&&img.naturalWidth===576&&img.naturalHeight===324))
  await expect.poll(decoded).toBe(true)
  const originalUrl=page.url()
  const restored=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)'),[schema,backup,service,reference,workspace]=await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/product-production/service.ts'),
      load('/storyforge/src/lib/avg/media-generated-reference.ts'),load('/storyforge/src/lib/avg/author-workspace-contract.ts')])
    const builds=await schema.db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber'),latest=builds.at(-1)
    const draft=await schema.db.avgAuthoringDrafts.where('workId').equals(scope.workId).first(),origin=workspace.parseAvgAuthorWorkspaceV1(draft.editorJson).presentation.inheritedImages[0].source
    if(builds.length!==3||origin.version!==3||origin.raw.schema!=='storyforge.avg.image-revalidation-producer-proof'||origin.original.raw.version!==4)throw new Error('Expected separate local proof and flat original HTTP origin')
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=(await schema.db.productBuilds.where('projectId').equals(projectId).sortBy('buildNumber')).at(-1)
    const importedScope={projectId,worldId:build.worldId,workId:build.workId},proved=await reference.readAvgAdoptedGeneratedImageV2({scope:importedScope,source:origin})
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',proved.data))).map(b=>b.toString(16).padStart(2,'0')).join('')
    if(hash!==origin.raw.contentHash||hash!==origin.original.raw.contentHash)throw new Error('Original and current physical pixels changed')
    const session=await service.startProductProductionPreviewV1({scope:importedScope,productionId:build.productionId,expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    return {scope:importedScope,sessionId:session.sessionId,localBuild:origin.raw.buildNumber,originalBuild:origin.original.raw.buildNumber,hash,latestBuild:latest.buildNumber}
  },source.scope)
  expect(restored.localBuild).toBe(2);expect(restored.originalBuild).toBe(1);expect(restored.latestBuild).toBe(3)
  const importedUrl=new URL(originalUrl);importedUrl.searchParams.set('project',String(restored.scope.projectId));importedUrl.searchParams.set('work',String(restored.scope.workId));importedUrl.searchParams.set('session',String(restored.sessionId))
  await page.goto(importedUrl.toString());await readyRuntime(page);await expect.poll(decoded).toBe(true)
  await page.screenshot({path:info.outputPath('avg-v4-unselected-source3-offline-native-preview.png')})
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)');await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await readyRuntime(page);await expect.poll(decoded).toBe(true)
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
})

for(const mode of ['direct','revalidated'] as const)test(`professional ${mode} original is natively cropped with transparent padding and retained through Source4 Preview and portable restore`,async({page},info)=>{
  test.setTimeout(420_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1'||process.env.VITE_STORYFORGE_AVG_VISUAL_PLANNING!=='1','Both visual experiments must be explicit')
  const {source,models,images,panel}=await prepare(page,false,'agnes.image-2.1-flash.v1',mode==='direct')
  const labels=['视觉基准',`场景方案：${source.titles[0]}`],name=`${source.titles[0]}背景`
  if(mode==='revalidated'){
    for(const label of labels)await adoptProfessionalDesign(page,label)
    const image=page.getByRole('article',{name:`图片候选：${name}`,exact:true})
    await expect(image.getByText('原图已接收，等待作者选择',{exact:true})).toBeVisible({timeout:60_000})
    await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
    await page.getByRole('button',{name:'停止专业视觉制作并保留记录',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'本次专业视觉制作已停止'})).toBeVisible()
    await page.getByRole('button',{name:'素材',exact:true}).click()
    await panel.getByRole('button',{name:'保留记录并准备新版本方案',exact:true}).click()
    const roles=panel.getByRole('region',{name:'历史专业方案复用',exact:true})
    await roles.getByRole('button',{name:'读取此版本已确认方案',exact:true}).click()
    for(const label of labels)await roles.getByRole('checkbox',{name:`复用已确认方案：${label}`,exact:true}).check()
    await roles.getByRole('button',{name:'保存复用方案',exact:true}).click()
    await expect(panel.getByText(/新方案上限：0 次方案调用、1 次图片请求/)).toBeVisible()
    const history=page.getByRole('region',{name:'已停止版本的原图',exact:true})
    await history.getByRole('button',{name:'读取原图与来源',exact:true}).click()
    await history.getByRole('checkbox',{name:`沿用原图：${name}`,exact:true}).check()
    await history.getByRole('button',{name:'保存原图沿用方案',exact:true}).click()
    await expect(panel.getByText(/新方案上限：0 次方案调用、0 次图片请求/)).toBeVisible()
    await saveProcessingRecipe(page)
    expect(models).toHaveLength(2);expect(images).toHaveLength(1)
    await page.evaluate(async()=>{const load=new Function('p','return import(p)');(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({apiKey:''})})
    await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
    await expect(page.getByRole('region',{name:'本地图像加工配方',exact:true}).getByLabel('裁切宽度（%）',{exact:true})).toHaveValue('50')
    await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
    await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`)
    await page.getByRole('button',{name:'素材',exact:true}).click();await panel.getByRole('button',{name:'执行已确认的专业方案与图片任务',exact:true}).click()
  }
  for(const label of labels)await adoptProfessionalDesign(page,label)
  const card=page.getByRole('article',{name:`图片候选：${name}`,exact:true})
  const output=card.locator('figure').filter({has:page.locator('figcaption').filter({hasText:'加工后候选'})}).getByRole('img')
  const pixels=async(image:Locator)=>{
    await expect(image).toBeVisible({timeout:60_000})
    await expect.poll(()=>image.evaluate((i:HTMLImageElement)=>i.complete?[i.naturalWidth,i.naturalHeight]:[])).toEqual([576,324])
    const measured=await image.evaluate((i:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight
      const ctx=c.getContext('2d')!;ctx.drawImage(i,0,0);return {padding:Array.from(ctx.getImageData(10,20,1,1).data),retained:Array.from(ctx.getImageData(250,80,1,1).data)}})
    expect(measured).toEqual({padding:[0,0,0,0],retained:[228,194,132,255]})
  }
  await pixels(output);await card.locator('.avg-visual-review-grid').screenshot({path:info.outputPath(`avg-v4-${mode}-native-processing-comparison.png`)})
  await confirmEngineeringVisualReview(card,name)
  await card.getByRole('button',{name:`保存选图候选：${name}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
  await card.getByRole('button',{name:`确认选用：${name}`,exact:true}).click()
  await page.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adoptSource(page,'演出与媒资',true)
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  const productionUrl=page.url();await page.getByRole('button',{name:'试玩此预览',exact:true}).click();await pixels(page.locator('.avg-background img'))
  await page.goto(productionUrl);await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click();await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click();await page.getByRole('button',{name:'保留专业演出图并准备新方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已保留准确专业演出图并准备零生成调用的新方案'})).toBeVisible({timeout:60_000})
  await page.reload();await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adoptSource(page,'系统规则');for(const title of source.titles)await adoptSource(page,`场景：${title}`);await adoptSource(page,'演出与媒资',true)
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click();await pixels(page.locator('.avg-background img'))
  const originalUrl=page.url(),restored=await page.evaluate(async({scope,mode})=>{
    const load=new Function('p','return import(p)'),[schema,backup,reference,workspace,service]=await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/avg/media-generated-reference.ts'),
      load('/storyforge/src/lib/avg/author-workspace-contract.ts'),load('/storyforge/src/lib/product-production/service.ts')])
    const draft=await schema.db.avgAuthoringDrafts.where('workId').equals(scope.workId).first(),w=workspace.parseAvgAuthorWorkspaceV1(draft.editorJson),origin=w.presentation.inheritedImages[0].source
    if(w.mediaBatch||w.imageProcessing||origin.version!==4||origin.processing.noProviderRequest!==true||origin.raw.schema!==(mode==='direct'?'storyforge.avg.visual-image-producer-proof':'storyforge.avg.image-revalidation-producer-proof'))throw new Error('Expected real separate original/local/processing source and no mirrored batch')
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)),build=(await schema.db.productBuilds.where('projectId').equals(projectId).sortBy('buildNumber')).at(-1)
    const importedScope={projectId,worldId:build.worldId,workId:build.workId},proved=await reference.readAvgAdoptedGeneratedImageV2({scope:importedScope,source:origin})
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',proved.data))).map(b=>b.toString(16).padStart(2,'0')).join('')
    if(hash!==origin.processing.contentHash||hash===origin.raw.contentHash)throw new Error('Derived pixels must retain their own accurate proof')
    const session=await service.startProductProductionPreviewV1({scope:importedScope,productionId:build.productionId,expectedBuildId:build.id,expectedPreviewHash:build.previewHash})
    return {scope:importedScope,sessionId:session.sessionId,hash,rawHash:origin.raw.contentHash,source:origin}
  },{scope:source.scope,mode})
  expect(restored.hash).not.toBe(restored.rawHash)
  const importedUrl=new URL(originalUrl);importedUrl.searchParams.set('project',String(restored.scope.projectId));importedUrl.searchParams.set('work',String(restored.scope.workId));importedUrl.searchParams.set('session',String(restored.sessionId))
  await page.goto(importedUrl.toString());await pixels(page.locator('.avg-background img'))
  await page.screenshot({path:info.outputPath(`avg-v4-${mode}-processed-source4-restored-preview.png`)})
  await page.evaluate(async workId=>{const load=new Function('p','return import(p)');await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)},restored.scope.workId)
  await page.goto(originalUrl);await pixels(page.locator('.avg-background img'))
  expect(models).toHaveLength(2);expect(images).toHaveLength(1)
})
