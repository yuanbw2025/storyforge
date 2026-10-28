import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'
import { expect, test, type Page } from '@playwright/test'

async function adopt(page:Page,label:string){
  const card=page.getByRole('article',{name:`作者确认：${label}`,exact:true})
  await card.getByRole('button',{name:`保存候选：${label}`,exact:true}).click()
  await card.getByRole('checkbox',{name:'我已核对该候选内容及素材来源授权',exact:true}).check()
  await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
  await expect(card.getByText('已采用 v1',{exact:true})).toBeVisible()
}

for(const reservedForeground of [false,true])test(reservedForeground?'native ordinary family freezes both foreground requests and retains exact processed PNGs offline without regenerating the previous background':'reviewed character family keeps the previous background and can later compile offline with adopted images',async({page},info)=>{
  if(reservedForeground)test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1','Experimental image production is disabled by default')
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  let image='';const calls:Array<{prompt?:string;extra_body?:{image?:string[]}}>=[]
  await page.route('https://apihub.agnes-ai.com/v1/images/generations',async route=>{calls.push(route.request().postDataJSON());await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:image}]})})})
  const s=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [fixture,service,draft,editor,config]=await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/avg/editor-service.ts'),load('/storyforge/src/stores/ai-config.ts')])
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted',model:'agnes-2.5-flash',baseUrl:'https://apihub.agnes-ai.com/v1'})
    const s=await fixture.prepareNativeAvgAssembly(),canvas=document.createElement('canvas');canvas.width=576;canvas.height=324
    const context=canvas.getContext('2d')!;context.fillStyle='#26384c';context.fillRect(0,0,576,324)
    const png=canvas.toDataURL('image/png').split(',')[1],data=Uint8Array.from(atob(png),c=>c.charCodeAt(0)).buffer
    const baseline=await editor.importAvgMediaForAssemblyV1({scope:s.scope,data,mimeType:'image/png',kind:'character-pose',name:'原创人物工程基准',license:'原创色块工程素材，仅用于链路测试',altText:'非商业角色图',characterTag:'keeper'})
    const r={requirementKey:'desk.background',revision:1,assetKey:'avg.generated.desk',name:'旧版工程背景',altText:'原创背景工程色块',family:{subjectKey:'desk',familyKey:'desk.day',variantKey:'day',revision:1},
      consumer:{consumerKey:'desk.background',domain:'stage',slot:'background',subjectKey:'desk',sceneKey:'desk',lineKey:null,required:true,fallback:'none'},triggerBeatKey:'line.desk',itemVariantKey:null,mediaKind:'background',prompt:'原创房间工程图',negativePrompt:'',invariants:[],forbiddenDepictions:[],width:576,height:324,resolutionTier:'1K',alpha:'not-required',references:[]}
    const saved=await service.saveAvgVisualBatchDraftV1({scope:s.scope,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,batchKey:'stage.base',revision:1,requirements:[r]})
    const details=await service.prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:saved.revision})
    const started=await service.startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:details.brief.briefHash})
    for(const artifactKey of ['avg.system.plan',...started.executionBrief.avgAssembly.sceneKeys.map((key:string)=>`avg.content.scene-script.${key}`)]){
      const candidate=await service.stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,artifactKey,declaration:'原创工程输入，非艺术验收'})
      await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    }
    return {scope:s.scope,productionId:s.productionId,buildId:started.build.id,image:png,baselineKey:baseline.assetKey,titles:JSON.parse((await draft.readAvgDraftV1(s.scope)).editorJson).systemPlan.scenes.map((s:{title:string})=>s.title) as string[]}
  })
  image=s.image
  await page.evaluate(async s=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [service,draft,{db}]=await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/db/schema.ts')])
    await service.runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
    const raw=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId,'avg.media.raw.desk.background']).first()
    const candidate=await service.stageAvgMediaChoiceV2({scope:s.scope,productionId:s.productionId,requirementKey:'desk.background',rawVersion:raw.version,rawContentHash:raw.contentHash,declaration:'明确选用工程背景'})
    await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:candidate.artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    await service.configureAvgChosenMediaDraftV2({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision})
    const stage=await service.stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,artifactKey:'avg.author.stage',declaration:'确认工程演出'})
    await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey:stage.artifactKey,candidateVersion:stage.version,candidateHash:JSON.parse(stage.metadataJson).candidateHash})
    await service.runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
  },s)
  await page.goto(`./avg/production?project=${s.scope.projectId}&work=${s.scope.workId}&assembly=1`)
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click()
  await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await page.getByText('批量制作人物家族',{exact:true}).click()
  const family=page.getByRole('region',{name:'人物家族批量方案',exact:true})
  await family.getByRole('combobox',{name:'使用已导入基准',exact:true}).selectOption(s.baselineKey)
  await expect(page.getByLabel('文件',{exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:'移出本次组装',exact:true})).toBeDisabled()
  await expect(page.getByLabel('高级组装配置',{exact:true})).toBeDisabled()
  await family.getByRole('textbox',{name:'家族画风与通用要求',exact:true}).fill('原创工程人物，固定机位、画布和比例。')
  await family.getByRole('textbox',{name:'身份与造型必须保持（每行一项）',exact:true}).fill('面部与服装不变')
  await family.getByRole('textbox',{name:'本家族允许变化',exact:true}).fill('仅改变表情')
  await family.getByRole('spinbutton',{name:'家族最小高度',exact:true}).fill('324')
  if(reservedForeground){
    await family.getByRole('checkbox',{name:'家族全部变体要求透明像素',exact:true}).check()
    await family.getByRole('checkbox',{name:'为全部变体预留纯品红底色并准备本地前景加工（实验性）',exact:true}).check()
    await family.getByRole('textbox',{name:'家族保留底色与本地加工说明',exact:true}).fill('纯品红只作为底色，工程人物与服装禁用该色；允许每张原图独立分离，完整保留主体与原图，不签艺术通过。')
  }else await family.getByRole('checkbox',{name:'家族全部变体要求透明像素',exact:true}).uncheck()
  await family.getByRole('textbox',{name:'变体名称',exact:true}).fill('平静')
  await family.getByRole('textbox',{name:'变体差异',exact:true}).fill('平静表情')
  await family.getByRole('button',{name:'新增家族变体',exact:true}).click()
  await family.getByRole('textbox',{name:'变体名称',exact:true}).nth(1).fill('微笑')
  await family.getByRole('textbox',{name:'变体差异',exact:true}).nth(1).fill('轻微微笑')
  await family.getByRole('button',{name:'生成待核对的家族方案',exact:true}).click()
  const review=family.getByRole('region',{name:'家族方案核对',exact:true})
  await review.getByRole('textbox',{name:'本批基准与衍生授权声明',exact:true}).fill('原创工程基准，授权本批外发与衍生，仅验证链路。')
  await review.getByRole('checkbox',{name:'我有权将此基准发送给本批全部图片请求',exact:true}).check()
  await review.getByRole('checkbox',{name:'我有权以此基准制作本批全部变体',exact:true}).check()
  // A material edit invalidates the reviewed proposal and both permissions.
  await family.getByRole('textbox',{name:'家族名称',exact:true}).fill('保管员工程家族')
  await expect(review).toHaveCount(0)
  await family.getByRole('button',{name:'生成待核对的家族方案',exact:true}).click()
  await expect(review.getByRole('checkbox',{name:'我有权将此基准发送给本批全部图片请求',exact:true})).not.toBeChecked()
  await review.getByRole('checkbox',{name:'我有权将此基准发送给本批全部图片请求',exact:true}).check()
  await review.getByRole('checkbox',{name:'我有权以此基准制作本批全部变体',exact:true}).check()
  await family.screenshot({path:info.outputPath('avg-family-review.png')})
  await review.getByRole('button',{name:'保存已核对的家族批次',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'人物家族需求与准确授权已保存'})).toBeVisible();expect(calls).toHaveLength(1)
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click();await page.getByText('批量制作人物家族',{exact:true}).click()
  await expect(family.getByRole('textbox',{name:'家族名称',exact:true})).toHaveValue('保管员工程家族')
  await expect(family.getByRole('textbox',{name:'变体名称',exact:true}).nth(1)).toHaveValue('微笑')
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'准备新版本方案',exact:true}).click();await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adopt(page,'系统规则');for(const title of s.titles)await adopt(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const panel=page.getByRole('region',{name:'图片生产（实验）',exact:true})
  if(reservedForeground){
    image=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=576;canvas.height=324;const context=canvas.getContext('2d')!
      context.fillStyle='#ff00ff';context.fillRect(0,0,576,324)
      context.fillStyle='#537a72';context.fillRect(180,90,216,210)
      context.fillStyle='#c89563';context.beginPath();context.ellipse(288,65,40,40,0,0,Math.PI*2);context.fill()
      return canvas.toDataURL('image/png').split(',')[1]
    })
  }
  await panel.getByRole('button',{name:'生成本批图片（最多 2 次）',exact:true}).click()
  for(const name of ['保管员工程家族 · 平静','保管员工程家族 · 微笑']){
    const card=panel.getByRole('article',{name:`图片候选：${name}`,exact:true})
    const show=card.getByRole('button',{name:`查看原图：${name}`,exact:true});if(await show.isVisible())await show.click()
    if(reservedForeground){
      const output=card.locator('figure').filter({has:page.locator('figcaption').filter({hasText:'加工后候选'})}).getByRole('img')
      await expect.poll(()=>output.evaluate((i:HTMLImageElement)=>i.complete?i.naturalWidth:0)).toBe(576)
      expect(await output.evaluate((i:HTMLImageElement)=>{
        const canvas=document.createElement('canvas');canvas.width=i.naturalWidth;canvas.height=i.naturalHeight;const context=canvas.getContext('2d')!;context.drawImage(i,0,0)
        return {corner:Array.from(context.getImageData(0,0,1,1).data),body:Array.from(context.getImageData(288,162,1,1).data)}
      })).toEqual({corner:[0,0,0,0],body:[83,122,114,255]})
    }
    if(name.endsWith('平静')){
      const review=card.getByRole('region',{name:`视觉评审：${name}`,exact:true})
      await review.getByRole('textbox',{name:'本次评审依据与修订说明',exact:true}).fill('工程校准尚未完成视觉观察，先保留未知记录。')
      await review.getByRole('button',{name:`保存视觉评审候选：${name}`,exact:true}).click()
      await review.getByRole('checkbox',{name:'我已核对这份准确评审及未观察项',exact:true}).check()
      await review.getByRole('button',{name:`确认评审记录：${name}`,exact:true}).click()
      await expect(review.getByText('已确认的评审 v1',{exact:true})).toBeVisible()
      await expect(card.getByRole('button',{name:`保存选图候选：${name}`,exact:true})).toBeDisabled()
      await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
      await expect(review.getByText('已确认的评审 v1',{exact:true})).toBeVisible()
      await review.getByRole('combobox',{name:'观察结果：构图与完整性',exact:true}).selectOption('fail')
      await review.getByRole('textbox',{name:'问题证据：构图与完整性',exact:true}).fill('记录构图 blocking 的控制探针，不认定实际艺术缺陷。')
      await review.getByRole('textbox',{name:'允许的返修与加工范围',exact:true}).fill('按冻结构图检查完整主体，不擅改人物身份。')
      await review.getByRole('textbox',{name:'本次评审依据与修订说明',exact:true}).fill('保存 blocking 控制记录，图像和账单保持原样。')
      await review.getByRole('button',{name:`保存视觉评审候选：${name}`,exact:true}).click()
      await review.getByRole('checkbox',{name:'我已核对这份准确评审及未观察项',exact:true}).check()
      await review.getByRole('button',{name:`确认评审记录：${name}`,exact:true}).click()
      await expect(review.getByText('已确认的评审 v2',{exact:true})).toBeVisible()
      await expect(card.getByRole('button',{name:`保存选图候选：${name}`,exact:true})).toBeDisabled()
      expect(calls).toHaveLength(3)
    }
    await confirmEngineeringVisualReview(card,name)
    if(name.endsWith('平静')){await card.locator('.avg-visual-review-grid').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('avg-visual-review-comparison.png')})}
    await expect(card.getByRole('button',{name:`保存选图候选：${name}`,exact:true})).toBeEnabled()
    await card.getByRole('button',{name:`保存选图候选：${name}`,exact:true}).click()
    await card.getByRole('checkbox',{name:'我已查看这张图片并核对用途、来源与使用权',exact:true}).check()
    await card.getByRole('button',{name:`确认选用：${name}`,exact:true}).click()
  }
  expect(calls).toHaveLength(3);for(const body of calls.slice(1))expect(body.extra_body?.image).toEqual([`data:image/png;base64,${s.image}`])
  if(reservedForeground){
    for(const body of calls.slice(1)){expect(body.prompt).toContain('底色只能为纯品红 #FF00FF');expect(body.prompt).toContain('主体、服装和道具禁止使用品红')}
    const receipts=await page.evaluate(async scope=>{
      const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
      const [{db},contracts]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/avg/image-processing-contract-v2.ts')])
      const build=(await db.productBuilds.where('workId').equals(scope.workId).sortBy('buildNumber')).at(-1)
      const rows=await db.productBuildArtifacts.where('buildId').equals(build.id).filter((row:any)=>row.status==='accepted'&&row.artifactKey.startsWith('avg.media.processed.')).toArray()
      return Promise.all(rows.map(async(row:any)=>({producerReceiptHash:row.producerReceiptHash,payload:await contracts.parseAvgProcessedImagePayloadV2(row.payloadJson),quality:JSON.parse(row.qualityJson)})))
    },s.scope)
    expect(receipts).toHaveLength(2)
    for(const row of receipts){
      expect(row.producerReceiptHash).toMatch(/^[a-f0-9]{64}$/)
      expect(row.payload.receipt).toMatchObject({version:2,processor:'storyforge.avg.local-foreground-canvas.v2',output:{width:576,height:324,hasAlpha:true}})
      expect(row.payload.receipt.foreground.clearedPixelCount).toBeGreaterThan(0)
      expect(row.quality).toMatchObject({noProviderRequest:true,decoderVerified:true})
    }
    await info.attach('native-ordinary-family-exact-foreground-producers.json',{body:JSON.stringify(receipts,null,2),contentType:'application/json'})
  }
  await panel.getByRole('button',{name:'将已选图片配置到演出草稿',exact:true}).click()
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await adopt(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible()
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click();await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await panel.getByRole('button',{name:'保留已选演出图片，结束本批需求',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'保留准确旧图并结束本批需求'})).toBeVisible()
  await page.evaluate(async()=>{const config=await(new Function('p','return import(p)') as(p:string)=>Promise<any>)('/storyforge/src/stores/ai-config.ts');config.useAIConfigStore.getState().setConfig({apiKey:''})})
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click();await page.getByRole('button',{name:'准备新版本方案',exact:true}).click();await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adopt(page,'系统规则');for(const title of s.titles)await adopt(page,`场景：${title}`);await adopt(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible();expect(calls).toHaveLength(3)
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click();await expect(page.locator('.avg-stage')).toBeVisible()
  await expect.poll(()=>page.locator('.avg-stage img').evaluateAll((images:HTMLImageElement[])=>images.filter(i=>i.complete&&i.naturalWidth===576).length)).toBe(2)
  await page.reload();await expect(page.locator('.avg-stage')).toBeVisible()
  await page.screenshot({path:info.outputPath('avg-family-inherited-preview.png')})
  const evidence=await page.evaluate(async scope=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>,[{db},draft]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/avg/draft-service.ts')])
    const workspace=JSON.parse((await draft.readAvgDraftV1(scope)).editorJson)
    return {imports:await db.avgDraftMedia.where('workId').equals(scope.workId).count(),images:workspace.presentation.inheritedImages.length,assets:workspace.presentation.stage.assets.length,hasBatch:!!workspace.mediaBatch}
  },s.scope)
  expect(evidence).toEqual({imports:1,images:3,assets:3,hasBatch:false});expect(calls).toHaveLength(3)
})
