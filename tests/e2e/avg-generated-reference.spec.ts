import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'
import { expect, test, type Page } from '@playwright/test'

async function adopt(page: Page, label: string) {
  const card=page.getByRole('article',{name:`作者确认：${label}`,exact:true})
  await card.getByRole('button',{name:`保存候选：${label}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已核对该候选内容及素材来源授权',exact:true}).check()
  await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
  await expect(card.getByText('已采用 v1',{exact:true})).toBeVisible()
}

test('an author previews an adopted generated reference, authorizes it for a new batch and plays the derived background',async({page},info)=>{
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1','Experimental image production is disabled by default')
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  let original='',derived='';const bodies:Array<{extra_body?:{image?:string[]}}>=[]
  await page.route('https://apihub.agnes-ai.com/v1/images/generations',async route=>{
    bodies.push(route.request().postDataJSON())
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:bodies.length===1?original:derived}]})})
  })
  const seeded=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [fixture,service,draft,config]=await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/stores/ai-config.ts')])
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted',model:'agnes-2.5-flash',baseUrl:'https://apihub.agnes-ai.com/v1'})
    const s=await fixture.prepareNativeAvgAssembly()
    const png=(color:string)=>{const canvas=document.createElement('canvas');canvas.width=576;canvas.height=324;const context=canvas.getContext('2d')!;context.fillStyle=color;context.fillRect(0,0,576,324);return canvas.toDataURL('image/png').split(',')[1]}
    const r={requirementKey:'desk.reference',revision:1,assetKey:'avg.generated.reference',name:'已采用的工程基准图',altText:'原创蓝色工程参考',
      family:{subjectKey:'desk',familyKey:'desk.reference',variantKey:'base',revision:1},
      consumer:{consumerKey:'desk.reference',domain:'reference',slot:'style',subjectKey:'desk',sceneKey:null,lineKey:null,required:false,fallback:'omit'},
      triggerBeatKey:null,itemVariantKey:null,mediaKind:'background',prompt:'原创固定机位室内基准',negativePrompt:'',invariants:[],forbiddenDepictions:[],width:576,height:324,resolutionTier:'1K',alpha:'not-required',references:[]}
    const saved=await service.saveAvgVisualBatchDraftV1({scope:s.scope,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,batchKey:'generated.reference.base',revision:1,requirements:[r]})
    const prepared=await service.prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:saved.revision})
    const started=await service.startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief.briefHash})
    for(const artifactKey of ['avg.system.plan',...started.executionBrief.avgAssembly.sceneKeys.map((key:string)=>`avg.content.scene-script.${key}`)]){
      const candidate=await service.stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,artifactKey,declaration:'原创工程来源，仅验证生成参考链路'})
      await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    }
    return {scope:s.scope,productionId:s.productionId,parentId:started.build.id,original:png('#26384c'),derived:png('#365b43'),titles:JSON.parse((await draft.readAvgDraftV1(s.scope)).editorJson).systemPlan.scenes.map((scene:{title:string})=>scene.title) as string[]}
  })
  original=seeded.original;derived=seeded.derived
  await page.evaluate(async s=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [service,production,{db}]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/product-production/service.ts'),load('/storyforge/src/lib/db/schema.ts')])
    await service.runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const raw=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.parentId,'avg.media.raw.desk.reference']).first()
    const candidate=await service.stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey:'desk.reference',rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'明确采用该工程基准图，尚未授权后续外发'})
    await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:candidate.artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    await production.stopProductProductionV1({scope:s.scope,production:(await production.readProductProductionDetailsV1(s.scope,s.productionId,['avg'])).production})
  },seeded)
  await page.goto(`./avg/production?project=${seeded.scope.projectId}&work=${seeded.scope.workId}&assembly=1`)
  await page.getByRole('button',{name:'停止并保留当前组装，准备新版本',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新方案等待明确开始'})).toBeVisible()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const panel=page.getByRole('region',{name:'图片生产（实验）',exact:true})
  await expect(panel.getByRole('region',{name:'图片恢复方案',exact:true})).toHaveCount(0)
  await panel.getByRole('button',{name:'移除此需求',exact:true}).click()
  await panel.getByText('新增图片需求',{exact:true}).first().click()
  await panel.getByLabel('需求名称',{exact:true}).fill('沿用生成参考的工程背景')
  await panel.getByLabel('画面要求',{exact:true}).fill('沿用已采用基准的房间结构，调整白天照明。')
  await panel.getByText('为此需求添加合法参考（最多 4 张）',{exact:true}).click()
  const picker=panel.getByRole('region',{name:'已采用生成图参考',exact:true})
  await expect(picker.getByRole('combobox',{name:'已采用的生成图',exact:true})).toBeVisible()
  await picker.getByRole('combobox',{name:'已采用的生成图',exact:true}).selectOption({label:'已采用的工程基准图'})
  await picker.getByRole('button',{name:'核验并查看生成图',exact:true}).click()
  await expect.poll(()=>picker.locator('img').evaluate((image:HTMLImageElement)=>image.complete?image.naturalWidth:0)).toBe(576)
  await picker.getByRole('button',{name:'使用这张生成图作为参考',exact:true}).click()
  await picker.screenshot({path:info.outputPath('avg-generated-reference-source.png')})
  await panel.getByRole('combobox',{name:'参考用途',exact:true}).selectOption('composition')
  await panel.getByLabel('允许改变什么',{exact:true}).fill('保持机位和结构，允许改变照明。')
  await panel.getByRole('checkbox',{name:'我有权将该参考图发送给本次图片供应商',exact:true}).check()
  await panel.getByRole('checkbox',{name:'我有权以该参考图进行本次衍生创作',exact:true}).check()
  await page.screenshot({path:info.outputPath('avg-generated-reference-review.png')})
  await panel.getByRole('button',{name:'添加这张授权参考',exact:true}).click()
  await panel.getByRole('button',{name:'加入本批需求',exact:true}).click()
  await panel.getByRole('button',{name:'保存并冻结图片需求',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'图片需求和准确来源已保存'})).toBeVisible()
  expect(bodies).toHaveLength(1)
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'准备制作方案',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adopt(page,'系统规则');for(const title of seeded.titles)await adopt(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'生成本批图片（最多 1 次）',exact:true}).click()
  const card=panel.getByRole('article',{name:'图片候选：沿用生成参考的工程背景',exact:true})
  await confirmEngineeringVisualReview(card,'沿用生成参考的工程背景')
  await expect(card.getByRole('button',{name:'保存选图候选：沿用生成参考的工程背景',exact:true})).toBeEnabled()
  expect(bodies).toHaveLength(2);expect(bodies[1].extra_body?.image).toEqual([`data:image/png;base64,${original}`])
  await card.getByRole('button',{name:'保存选图候选：沿用生成参考的工程背景',exact:true}).click()
  await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
  await card.getByRole('button',{name:'确认选用：沿用生成参考的工程背景',exact:true}).click()
  await panel.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adopt(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible()
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  await expect(page.locator('.avg-stage')).toBeVisible()
  await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((images:HTMLImageElement[])=>images.some(image=>image.complete&&image.naturalWidth===576))).toBe(true)
  await page.reload();await expect(page.locator('.avg-stage')).toBeVisible()
  expect(bodies).toHaveLength(2)
  const proof=await page.evaluate(async scope=>{
    const {db}=await(new Function('p','return import(p)') as(p:string)=>Promise<any>)('/storyforge/src/lib/db/schema.ts')
    const row=await db.productBuildArtifacts.where('workId').equals(scope.workId).filter((row:any)=>row.artifactKey.startsWith('avg.media.raw.image.')).first()
    return {imports:await db.avgDraftMedia.where('workId').equals(scope.workId).count(),source:JSON.parse(row.payloadJson).request.references[0].generatedSource}
  },seeded.scope)
  expect(proof.imports).toBe(0);expect(proof.source).toMatchObject({schema:'storyforge.avg.generated-reference-source',version:1,raw:{buildNumber:1},requirementKey:'desk.reference'})
  await page.screenshot({path:info.outputPath('avg-generated-reference-preview.png')})
})
