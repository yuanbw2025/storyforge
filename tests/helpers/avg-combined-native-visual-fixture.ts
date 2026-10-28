import { expect, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { confirmEngineeringVisualReview } from './avg-visual-review-playwright'

/** Engineering UI setup uses the original five-image public form, registered
 * producers and independent author actions. It creates no accepted DB rows.
 * Original V5 cases stay byte-for-byte unchanged; this new case continues the
 * same Work into Sound and voice. Real art/listening remains separate. */
export async function adoptSource(page:Page,label:string,waitForCompletion=false){
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

async function prepareProfessionalFamily(page:Page,options:{propReference?:boolean;version?:4|5;processing?:boolean;processingTargetIndex?:number}={}){
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
    if(options.processingTargetIndex!==undefined)await page.getByRole('region',{name:'本地图像加工配方',exact:true}).getByLabel('加工目标',{exact:true}).selectOption({index:options.processingTargetIndex})
    await saveProcessingRecipe(page)
  }
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已明确开始，等待逐项作者确认。'})).toBeVisible()
  return {source,panel,calls}
}

export async function produceCombinedVisualPreview(page: Page, info: TestInfo, visualVersion: 4 | 5 = 5, noKeyBeforeProcessing = false) {
  const {source,panel,calls}=await prepareProfessionalFamily(page,{propReference:true,version:visualVersion,processing:visualVersion===5,...(noKeyBeforeProcessing?{processingTargetIndex:4}:{})})
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
    return {templates:planning.scope.templates,catalog:planning.scope.referenceCatalog,processing:planning.imageProcessing,images}
  },source.scope)
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
  const measured=await page.evaluate(async({scope,visualVersion})=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [service,decoder]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/image-decoder.ts')])
    const view=await service.readAvgAssemblyWorkspaceV1(scope),result=[]
    const preview=visualVersion===5?await load('/storyforge/src/lib/avg/media-candidate-preview-v5.ts'):service
    for(const r of view.imageDefinition.mediaBatch.requirements){const row=view.artifacts.find((a:any)=>a.artifactKey===`avg.media.raw.${r.requirementKey}`),bytes=await (visualVersion===5?preview.readAvgRawImageCandidateBytesV5:preview.readAvgRawImageCandidateBytesV2)({scope,productionId:view.details.production.id,requirementKey:r.requirementKey,version:row.version,contentHash:row.contentHash});result.push({key:r.requirementKey,...await decoder.inspectAvgImageBytesV1({data:bytes.data,...bytes.asset,requireAlpha:r.alpha==='required'})})}
    return result
  },{scope:source.scope,visualVersion})
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
  await page.reload();await expect(page.locator('.avg-actor img')).toHaveAttribute('alt',expression.altText)
  await expect(page.locator('.avg-dialogue p')).toHaveText(source.scenes[1].text)
  await page.screenshot({path:info.outputPath(`avg-v${visualVersion}-family-expression.png`),fullPage:true})
  return { source, fixture, models, images, configured, originalUrl }
}
