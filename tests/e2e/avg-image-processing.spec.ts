import { expect,test,type Page } from '@playwright/test'
import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'

async function adopt(page:Page,label:string){
  const card=page.getByRole('article',{name:`作者确认：${label}`,exact:true})
  await card.getByRole('button',{name:`保存候选：${label}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已核对该候选内容及素材来源授权',exact:true}).check()
  await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
  await expect(card.getByText('已采用 v1',{exact:true})).toBeVisible()
}

test('native local processor crops and fits original pixels, preserves alpha and records exact PNG lineage without network or storage writes',async({page})=>{
  await page.goto('./avg/library')
  const result=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [processor,contract,blob]=await Promise.all([load('/storyforge/src/lib/avg/image-processing.ts'),load('/storyforge/src/lib/avg/image-processing-contract.ts'),load('/storyforge/src/lib/product-production/media-blob-store.ts')])
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32
    const context=canvas.getContext('2d')!;context.fillStyle='#0000ff';context.fillRect(0,0,32,32);context.fillStyle='#ff0000';context.fillRect(32,0,32,32);context.clearRect(0,24,8,8)
    const data=await(await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'))).arrayBuffer()
    const source={contentHash:await blob.sha256MediaData(data),mimeType:'image/png',width:64,height:32}
    const recipe={schema:'storyforge.avg.image-processing-recipe',version:1,crop:null,width:64,height:64,fit:'contain',anchor:{x:5000,y:5000},background:null,declaration:'原创双色块的本地工程像素校验；非美术验收'}
    const read=async(output:ArrayBuffer)=>{
      const bitmap=await createImageBitmap(new Blob([output],{type:'image/png'})),c=document.createElement('canvas');c.width=64;c.height=64
      const ctx=c.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close()
      const at=(x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data)
      return {padding:at(1,1),blue:at(8,20),red:at(56,20),transparentSource:at(4,44),center:at(32,32)}
    }
    const contain=await processor.processAvgImageBytesV1({data,source,recipe})
    const cropRecipe={...recipe,crop:{x:5000,y:0,width:5000,height:10000}},crop=await processor.processAvgImageBytesV1({data,source,recipe:cropRecipe})
    const coverRecipe={...recipe,fit:'cover',anchor:{x:10000,y:5000}},cover=await processor.processAvgImageBytesV1({data,source,recipe:coverRecipe})
    const flatRecipe={...recipe,background:{red:0,green:255,blue:0,alpha:255}},flat=await processor.processAvgImageBytesV1({data,source,recipe:flatRecipe})
    const failures:string[]=[]
    const controller=new AbortController();controller.abort()
    for(const input of [{data,source:{...source,contentHash:'a'.repeat(64)},recipe},{data,source:{...source,width:63},recipe},{data,source,recipe,signal:controller.signal}]){
      try{await processor.processAvgImageBytesV1(input);failures.push('unexpected success')}catch(error){failures.push((error as Error).name+':'+String(error))}
    }
    return {contain:{pixels:await read(contain.data),receipt:contain.receipt},crop:{pixels:await read(crop.data),receipt:crop.receipt},cover:{pixels:await read(cover.data),receipt:cover.receipt},flat:{pixels:await read(flat.data),receipt:flat.receipt},
      inputUnchanged:await blob.sha256MediaData(data)===source.contentHash,outputHashMatches:await blob.sha256MediaData(contain.data)===contain.receipt.output.contentHash,
      receiptVerified:!!await contract.assertAvgImageProcessingReceiptV1(recipe,contain.receipt),failures}
  })
  expect(result.contain.pixels).toMatchObject({padding:[0,0,0,0],blue:[0,0,255,255],red:[255,0,0,255],transparentSource:[0,0,0,0]})
  expect(result.contain.receipt).toMatchObject({processor:'storyforge.avg.local-canvas.v1',output:{width:64,height:64,mimeType:'image/png',hasAlpha:true},geometry:{source:{x:0,y:0,width:64,height:32},destination:{x:0,y:16,width:64,height:32}}})
  for(const image of [result.crop,result.cover]){
    expect(image.pixels.padding).toEqual([255,0,0,255]);expect(image.pixels.center).toEqual([255,0,0,255]);expect(image.receipt.output.hasAlpha).toBe(false)
  }
  expect(result.flat.pixels.padding).toEqual([0,255,0,255]);expect(result.flat.pixels.transparentSource).toEqual([0,255,0,255]);expect(result.flat.receipt.output.hasAlpha).toBe(false)
  expect(result.inputUnchanged&&result.outputHashMatches&&result.receiptVerified).toBe(true)
  expect(result.failures[0]).toContain('hash');expect(result.failures[1]).toContain('尺寸');expect(result.failures[2]).toContain('AbortError')
})

test('an author freezes a local crop in the native workbench, reviews its exact output and carries those pixels into an offline V1 preview',async({page},info)=>{
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1','Experimental image production is disabled by default')
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  let calls=0,image=''
  await page.route('https://apihub.agnes-ai.com/v1/images/generations',async route=>{calls++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:image}]})})})
  const s=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [fixture,service,draft,config]=await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/stores/ai-config.ts')])
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted',model:'agnes-2.5-flash',baseUrl:'https://apihub.agnes-ai.com/v1'})
    const s=await fixture.prepareNativeAvgAssembly(),d=await draft.readAvgDraftV1(s.scope)
    const r={requirementKey:'desk.background',revision:1,assetKey:'avg.generated.desk',name:'本地裁切工程背景',altText:'仅供工程像素校验的双色块',family:{subjectKey:'desk',familyKey:'desk.day',variantKey:'day',revision:1},
      consumer:{consumerKey:'desk.background',domain:'stage',slot:'background',subjectKey:'desk',sceneKey:'desk',lineKey:null,required:true,fallback:'none'},triggerBeatKey:'line.desk',itemVariantKey:null,mediaKind:'background',prompt:'原创工程背景',negativePrompt:'',invariants:[],forbiddenDepictions:[],width:576,height:324,resolutionTier:'1K',alpha:'not-required',references:[]}
    await service.saveAvgVisualBatchDraftV1({scope:s.scope,expectedDraftRevision:d.revision,batchKey:'local.processing',revision:1,requirements:[r],visualReviewPolicy:'author-visual-v1'})
    const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d')!;ctx.fillStyle='#0000ff';ctx.fillRect(0,0,320,360);ctx.fillStyle='#ff0000';ctx.fillRect(320,0,320,360)
    return {scope:s.scope,productionId:s.productionId,image:c.toDataURL('image/png').split(',')[1],titles:JSON.parse(d.editorJson).systemPlan.scenes.map((s:{title:string})=>s.title) as string[]}
  })
  image=s.image
  await page.goto(`./avg/production?project=${s.scope.projectId}&work=${s.scope.workId}&assembly=1`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const panel=page.getByRole('region',{name:'图片生产（实验）',exact:true}),processing=panel.getByRole('region',{name:'本地图像加工配方',exact:true})
  await processing.getByRole('combobox',{name:'画布适配',exact:true}).selectOption('cover')
  await expect(page.getByRole('button',{name:'制作与试玩',exact:true})).toBeDisabled()
  await processing.getByRole('checkbox',{name:'明确裁切原图范围',exact:true}).check()
  await processing.getByLabel('裁切左侧（%）',{exact:true}).fill('50');await processing.getByLabel('裁切宽度（%）',{exact:true}).fill('50')
  await processing.getByLabel('允许的加工与用途说明',{exact:true}).fill('明确裁取工程双色块的右半边并填满画布；只校验本地像素链路，非美术质量验收。')
  await processing.getByRole('button',{name:'保存本项加工配方',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'加工配方已保存'})).toBeVisible()
  expect(calls).toBe(0)
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(processing.getByLabel('裁切左侧（%）',{exact:true})).toHaveValue('50')
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'准备制作方案',exact:true}).click();await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adopt(page,'系统规则');for(const title of s.titles)await adopt(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click();await panel.getByRole('button',{name:'生成本批图片（最多 1 次）',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'本批媒资步骤已执行'})).toBeVisible()
  const diagnostic=await page.evaluate(async scope=>{
    const {db}=await(new Function('p','return import(p)') as(p:string)=>Promise<any>)('/storyforge/src/lib/db/schema.ts')
    const build=await db.productBuilds.where('workId').equals(scope.workId).first(),artifacts=await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
    return {failure:build.failureJson,ledger:JSON.parse(build.budgetLedgerJson).tasks,artifacts:artifacts.map((r:any)=>({key:r.artifactKey,status:r.status}))}
  },s.scope)
  expect(diagnostic.artifacts.some((r:{key:string;status:string})=>r.key==='avg.media.processed.desk.background'&&r.status==='accepted'),JSON.stringify(diagnostic)).toBe(true)
  const card=panel.getByRole('article',{name:'图片候选：本地裁切工程背景',exact:true})
  const output=card.locator('figure').filter({has:page.locator('figcaption').filter({hasText:'加工后候选'})}).getByRole('img')
  await expect(output).toBeVisible();await expect.poll(()=>output.evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(576)
  expect(await output.evaluate((i:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const ctx=c.getContext('2d')!;ctx.drawImage(i,0,0);return Array.from(ctx.getImageData(288,162,1,1).data)})).toEqual([255,0,0,255])
  await card.locator('.avg-visual-review-grid').screenshot({path:info.outputPath('avg-local-processing-comparison.png')})
  await confirmEngineeringVisualReview(card,'本地裁切工程背景')
  await card.getByRole('button',{name:'保存选图候选：本地裁切工程背景',exact:true}).click()
  await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
  await card.getByRole('button',{name:'确认选用：本地裁切工程背景',exact:true}).click()
  await panel.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adopt(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible()
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click();await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click();await panel.getByRole('button',{name:'保留已选演出图片，结束本批需求',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'保留准确旧图并结束本批需求'})).toBeVisible()
  await page.evaluate(async()=>{const c=await(new Function('p','return import(p)') as(p:string)=>Promise<any>)('/storyforge/src/stores/ai-config.ts');c.useAIConfigStore.getState().setConfig({apiKey:''})})
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await page.getByRole('button',{name:'准备新版本方案',exact:true}).click();await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adopt(page,'系统规则');for(const title of s.titles)await adopt(page,`场景：${title}`);await adopt(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible()
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click();await expect(page.locator('.avg-stage')).toBeVisible()
  await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((images:HTMLImageElement[])=>images.some(i=>i.complete&&i.naturalWidth===576))).toBe(true)
  await page.reload();await expect(page.locator('.avg-stage')).toBeVisible()
  expect(calls).toBe(1)
})

test('an OPFS original above the reference limit becomes a separate adopted small reference with portable raw and processing proof',async({page})=>{
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1','Experimental image production is disabled by default')
  await page.goto('./avg/library')
  let calls=0,image=''
  await page.route('https://apihub.agnes-ai.com/v1/images/generations',async route=>{calls++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:image}]})})})
  const s=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [fixture,service,draft,config,processing]=await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/stores/ai-config.ts'),load('/storyforge/tests/helpers/avg-image-processing-fixture.ts')])
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted',model:'agnes-2.5-flash',baseUrl:'https://apihub.agnes-ai.com/v1'})
    const s=await fixture.prepareNativeAvgAssembly(),d=await draft.readAvgDraftV1(s.scope)
    const r={requirementKey:'desk.background',revision:1,assetKey:'avg.generated.desk',name:'大图本地加工探针',altText:'原创随机工程图',family:{subjectKey:'desk',familyKey:'desk.day',variantKey:'day',revision:1},
      consumer:{consumerKey:'desk.background',domain:'stage',slot:'background',subjectKey:'desk',sceneKey:'desk',lineKey:null,required:true,fallback:'none'},triggerBeatKey:'line.desk',itemVariantKey:null,mediaKind:'background',prompt:'原创工程背景',negativePrompt:'',invariants:[],forbiddenDepictions:[],width:576,height:324,resolutionTier:'1K',alpha:'not-required',references:[]}
    const saved=await service.saveAvgVisualBatchDraftV1({scope:s.scope,expectedDraftRevision:d.revision,batchKey:'local.opfs.processing',revision:1,requirements:[r],visualReviewPolicy:'author-visual-v1'})
    const planned=await service.saveAvgImageProcessingDraftV1({scope:s.scope,expectedDraftRevision:saved.revision,plan:{schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:r.requirementKey,recipe:processing.avgImageProcessingRecipeFixture()}]}})
    const prepared=await service.prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:planned.revision}),started=await service.startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief.briefHash})
    for(const artifactKey of ['avg.system.plan',...started.executionBrief.avgAssembly.sceneKeys.map((key:string)=>`avg.content.scene-script.${key}`)]){
      const candidate=await service.stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,artifactKey,declaration:'原创工程输入，非美术或人类验收'})
      await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    }
    const c=document.createElement('canvas');c.width=2048;c.height=1152;const ctx=c.getContext('2d')!,pixels=ctx.createImageData(2048,1152)
    for(let i=0;i<pixels.data.length;i+=65536)crypto.getRandomValues(pixels.data.subarray(i,Math.min(i+65536,pixels.data.length)))
    ctx.putImageData(pixels,0,0)
    return {scope:s.scope,productionId:s.productionId,buildId:started.build.id,requirement:r,image:c.toDataURL('image/png').split(',')[1]}
  })
  image=s.image
  const result=await page.evaluate(async s=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [service,{db},reviews,references,production,backup,blob]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/tests/helpers/avg-visual-review-fixture.ts'),load('/storyforge/src/lib/avg/media-generated-reference.ts'),load('/storyforge/src/lib/product-production/service.ts'),load('/storyforge/src/lib/export/json-export.ts'),load('/storyforge/src/lib/product-production/media-blob-store.ts')])
    await service.runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const raw=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.raw.desk.background']).first(),processed=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.processed.desk.background']).first()
    if(!processed)throw new Error((await db.productBuilds.get(s.buildId)).failureJson)
    const object=await db.mediaBlobObjects.get(raw.blobObjectId)
    const review=await service.stageAvgVisualReviewV1({scope:s.scope,productionId:s.productionId,requirementKey:s.requirement.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,
      report:reviews.avgVisualReviewFixture(s.requirement,processed.contentHash),declaration:'原创随机工程图只验证大图/加工/备份，不签艺术门'})
    await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:review.artifactKey,candidateVersion:review.version,candidateHash:JSON.parse(review.metadataJson).candidateHash})
    const choice=await service.stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey:s.requirement.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,
      processed:{version:processed.version,contentHash:processed.contentHash},declaration:'明确选用准确小图，原始 OPFS 图及其费用保留'})
    await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:choice.artifactKey,candidateVersion:choice.version,candidateHash:JSON.parse(choice.metadataJson).candidateHash})
    const selected=await references.prepareAvgGeneratedReferenceImageV1({scope:s.scope,choiceId:choice.id})
    await production.stopProductProductionV1({scope:s.scope,production:(await production.readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).production})
    const projectId=await backup.importProjectJSON(await backup.exportProjectJSON(s.scope.projectId)),build=await db.productBuilds.where('projectId').equals(projectId).first()
    const scope={projectId,worldId:build.worldId,workId:build.workId},restored=await references.readAvgGeneratedReferenceImageV1({scope,source:selected.source})
    return {backend:object.backend,originalBytes:raw.byteSize,processedBytes:restored.data.byteLength,hashMatches:await blob.sha256MediaData(restored.data)===processed.contentHash,
      hasBothProofs:!!selected.source.processing&&selected.source.raw.contentHash===raw.contentHash&&selected.source.processing.contentHash===processed.contentHash,imports:await db.avgDraftMedia.where('workId').equals(scope.workId).count()}
  },s)
  expect(result.backend).toBe('opfs');expect(result.originalBytes).toBeGreaterThan(8*1024*1024);expect(result.processedBytes).toBeLessThan(8*1024*1024)
  expect(result.hashMatches&&result.hasBothProofs).toBe(true);expect(result.imports).toBe(0);expect(calls).toBe(1)
})
