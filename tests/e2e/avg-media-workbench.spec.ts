import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'
import { expect, test, type Page } from '@playwright/test'

async function adopt(page: Page, label: string) {
  const card = page.getByRole('article', { name: `作者确认：${label}`, exact: true })
  await card.getByRole('button', { name: `保存候选：${label}`, exact: true }).click()
  await card.getByRole('checkbox', { name: '我已核对该候选内容及素材来源授权', exact: true }).check()
  await card.getByRole('button', { name: `确认采用：${label}`, exact: true }).click()
  await expect(card.getByText('已采用 v1', { exact: true })).toBeVisible()
}

test('author creates authorized image requirements, refreshes pending choice and plays the generated background through actual UI', async ({ page }, info) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1', 'Experimental image production is disabled by default')
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const seeded = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [draft, world, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const owner = await draft.createAvgDraftV1('图片生产工作台工程验证'), frozen = await world.createMistHarborWorld()
    await draft.selectAvgWorldV1(owner.scope, 0, frozen.worldReleaseId)
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'test-only-intercepted-no-network', model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1' })
    const canvas = document.createElement('canvas'); canvas.width = 576; canvas.height = 324
    const context = canvas.getContext('2d')!; context.fillStyle = '#18213b'; context.fillRect(0, 0, 576, 324)
    return { scope: owner.scope, png: canvas.toDataURL('image/png').split(',')[1] }
  })
  let requests = 0
  await page.route('https://apihub.agnes-ai.com/v1/images/generations', async route => {
    requests++
    expect(route.request().postDataJSON().extra_body.image).toEqual([`data:image/png;base64,${seeded.png}`])
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: seeded.png }] }) })
  })
  await page.goto(`./avg/production?project=${seeded.scope.projectId}&work=${seeded.scope.workId}`)
  await page.getByRole('button', { name: '打开系统与效果工作台', exact: true }).click()
  await page.getByRole('button', { name: '保存编辑草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '编辑草稿已保存' })).toBeVisible()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  let panel = page.getByRole('region', { name: '图片生产（实验）', exact: true })
  await panel.getByText('导入仅供生成使用的参考图', { exact: true }).click()
  await panel.getByLabel('参考图文件', { exact: true }).setInputFiles({ name: '原创工程参考.png', mimeType: 'image/png', buffer: Buffer.from(seeded.png, 'base64') })
  await panel.getByLabel('参考图来源与授权', { exact: true }).fill('CC0-1.0 original engineering fixture')
  await panel.getByRole('button', { name: '导入为参考，不加入演出', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '参考图已解码' })).toBeVisible()
  await panel.getByLabel('需求名称', { exact: true }).fill('原创工作台背景')
  await panel.getByLabel('画面要求', { exact: true }).fill('原创工程室内背景，固定机位和配色。')
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeDisabled()
  await panel.getByText('为此需求添加合法参考（最多 4 张）', { exact: true }).click()
  await panel.getByRole('combobox', { name: '已导入参考图', exact: true }).selectOption({ label: '原创工程参考.png' })
  await panel.getByRole('textbox', { name: '允许改变什么', exact: true }).fill('保留配色，只改变房间细节。')
  await panel.getByRole('button', { name: '添加这张授权参考', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('授权')
  await panel.getByRole('checkbox', { name: '我有权将该参考图发送给本次图片供应商', exact: true }).check()
  await panel.getByRole('checkbox', { name: '我有权以该参考图进行本次衍生创作', exact: true }).check()
  await panel.getByRole('combobox', { name: '已导入参考图', exact: true }).selectOption('')
  await panel.getByRole('combobox', { name: '已导入参考图', exact: true }).selectOption({ label: '原创工程参考.png' })
  await expect(panel.getByRole('checkbox', { name: '我有权将该参考图发送给本次图片供应商', exact: true })).not.toBeChecked()
  await expect(panel.getByRole('checkbox', { name: '我有权以该参考图进行本次衍生创作', exact: true })).not.toBeChecked()
  await panel.getByRole('checkbox', { name: '我有权将该参考图发送给本次图片供应商', exact: true }).check()
  await panel.getByRole('checkbox', { name: '我有权以该参考图进行本次衍生创作', exact: true }).check()
  await panel.getByRole('textbox', { name: '允许改变什么', exact: true }).fill('仅保留配色，允许重新设计房间细节。')
  await expect(panel.getByRole('checkbox', { name: '我有权将该参考图发送给本次图片供应商', exact: true })).not.toBeChecked()
  await panel.getByRole('checkbox', { name: '我有权将该参考图发送给本次图片供应商', exact: true }).check()
  await panel.getByRole('checkbox', { name: '我有权以该参考图进行本次衍生创作', exact: true }).check()
  await panel.getByRole('button', { name: '添加这张授权参考', exact: true }).click()
  await panel.getByRole('button', { name: '加入本批需求', exact: true }).click()
  await panel.getByRole('button', { name: '保存并冻结图片需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '图片需求和准确来源已保存' })).toBeVisible()
  expect(requests).toBe(0)
  await page.reload()
  const titles = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const draft = await (await load('/storyforge/src/lib/avg/draft-service.ts')).readAvgDraftV1(scope)
    return JSON.parse(draft.editorJson).systemPlan.scenes.map((scene: { title: string }) => scene.title) as string[]
  }, seeded.scope)
  await page.getByRole('button', { name: '准备制作方案', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await expect(page.getByRole('article', { name: '作者确认：演出与媒资', exact: true }).getByRole('button', { name: '保存候选：演出与媒资', exact: true })).toBeDisabled()
  await adopt(page, '系统规则')
  for (const title of titles) await adopt(page, `场景：${title}`)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  panel = page.getByRole('region', { name: '图片生产（实验）', exact: true })
  await panel.getByRole('button', { name: '生成本批图片（最多 1 次）', exact: true }).click()
  let card = panel.getByRole('article', { name: '图片候选：原创工作台背景', exact: true })
  await confirmEngineeringVisualReview(card,'原创工作台背景')
  await expect(card.getByRole('button', { name: '保存选图候选：原创工作台背景', exact: true })).toBeEnabled()
  await card.getByRole('button', { name: '保存选图候选：原创工作台背景', exact: true }).click()
  await expect(card.getByText('查看选图版本、用途与声明', { exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('avg-image-production-workbench-candidate.png') })
  await page.reload()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  card = page.getByRole('article', { name: '图片候选：原创工作台背景', exact: true })
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.complete ? image.naturalWidth : 0)).toBe(576)
  await expect(card.getByRole('button', { name: '确认选用：原创工作台背景', exact: true })).toBeDisabled()
  await card.getByRole('checkbox', { name: '我已查看这张图片并核对用途、来源与使用权', exact: true }).check()
  await card.getByRole('button', { name: '确认选用：原创工作台背景', exact: true }).click()
  await page.getByRole('button', { name: '将已选图片配置到演出草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已选图片已配置到演出草稿' })).toBeVisible()
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '新预览已冻结' })).toBeVisible()
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page.locator('.avg-stage')).toBeVisible()
  await expect.poll(() => page.locator('.avg-stage img').evaluateAll((images: HTMLImageElement[]) => images.some(image => image.complete && image.naturalWidth === 576))).toBe(true)
  expect(requests).toBe(1)
  await page.screenshot({ path: info.outputPath('avg-image-production-workbench-preview.png'), fullPage: true })
})

test('author stops an in-flight image request and refresh cannot silently repeat it', async ({ page }) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1', 'Experimental image production is disabled by default')
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const s = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [fixture, service, draft, config] = await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),
      load('/storyforge/src/lib/avg/assembly-service.ts'), load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/stores/ai-config.ts')])
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'test-only-intercepted', model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1' })
    const s = await fixture.prepareNativeAvgAssembly()
    const saved = await service.saveAvgVisualBatchDraftV1({ scope: s.scope, expectedDraftRevision: (await draft.readAvgDraftV1(s.scope)).revision,
      batchKey: 'cancel.browser', revision: 1, requirements: [{ requirementKey: 'desk.background', revision: 1, assetKey: 'avg.generated.desk', name: '取消工程图', altText: '取消校准',
        family: { subjectKey: 'desk', familyKey: 'desk.original', variantKey: 'day', revision: 1 },
        consumer: { consumerKey: 'desk.background', domain: 'stage', slot: 'background', subjectKey: 'desk', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
        triggerBeatKey: 'line.desk', itemVariantKey: null, mediaKind: 'background', prompt: '原创工程房间', negativePrompt: '', invariants: [], forbiddenDepictions: [],
        width: 576, height: 324, resolutionTier: '1K', alpha: 'not-required', references: [] }] })
    const prepared = await service.prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    const started = await service.startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief.briefHash })
    for (const artifactKey of ['avg.system.plan', ...started.executionBrief.avgAssembly.sceneKeys.map((key: string) => `avg.content.scene-script.${key}`)]) {
      const candidate = await service.stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: (await draft.readAvgDraftV1(s.scope)).revision,
        artifactKey, declaration: '原创工程输入，用于验证已发送后取消边界' })
      await service.confirmAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, artifactKey, candidateVersion: candidate.version, candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
    }
    return { scope: s.scope, buildId: started.build.id }
  })
  let requests = 0
  await page.route('https://apihub.agnes-ai.com/v1/images/generations', async route => {
    requests++
    await new Promise(resolve => setTimeout(resolve, 8000))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }).catch(() => undefined)
  })
  await page.goto(`./avg/production?project=${s.scope.projectId}&work=${s.scope.workId}&assembly=1`)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '生成本批图片（最多 1 次）', exact: true }).click()
  await expect.poll(() => requests).toBe(1)
  await page.getByRole('button', { name: '停止等待并保留调用记录', exact: true }).click()
  await expect(page.getByText('本次调用已停止。请先核对原始记录与未知费用，当前不会自动重发。', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await expect(page.getByRole('button', { name: '生成本批图片（最多 1 次）', exact: true })).toBeDisabled()
  const evidence = await page.evaluate(async s => {
    const { db } = await (new Function('p', 'return import(p)') as (p: string) => Promise<any>)('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.get(s.buildId), ledger = JSON.parse(build.budgetLedgerJson)
    return { status: build.status, attempt: ledger.attempts.find((row: { taskKey: string }) => row.taskKey === 'avg.media.generate.desk.background') }
  }, s)
  expect(evidence.status).toBe('recovery-required')
  expect(evidence.attempt).toMatchObject({ usageKnown: false, usage: { mediaCalls: 1 } })
  expect(requests).toBe(1)
})

test('author retains the good image and explicitly starts a child that requests only the failed image', async ({page},info)=>{
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION!=='1','Experimental image production is disabled by default')
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  let png='',requests=0
  await page.route('https://apihub.agnes-ai.com/v1/images/generations',async route=>{
    requests++
    await route.fulfill(requests===2?{status:401,contentType:'application/json',body:'{"error":"controlled second-image failure"}'}
      :{status:200,contentType:'application/json',body:JSON.stringify({data:[{b64_json:png}]})})
  })
  const seeded=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
    const [fixture,service,draft,config]=await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),load('/storyforge/src/lib/avg/assembly-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/stores/ai-config.ts')])
    config.useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-intercepted',model:'agnes-2.5-flash',baseUrl:'https://apihub.agnes-ai.com/v1'})
    const s=await fixture.prepareNativeAvgAssembly(),canvas=document.createElement('canvas');canvas.width=576;canvas.height=324
    const context=canvas.getContext('2d')!;context.fillStyle='#26384c';context.fillRect(0,0,576,324)
    const first={requirementKey:'desk.background',revision:1,assetKey:'avg.generated.desk',name:'保留的工程背景',altText:'原始工程背景',family:{subjectKey:'desk',familyKey:'desk.original',variantKey:'day',revision:1},
      consumer:{consumerKey:'desk.background',domain:'stage',slot:'background',subjectKey:'desk',sceneKey:'desk',lineKey:null,required:true,fallback:'none'},triggerBeatKey:'line.desk',itemVariantKey:null,
      mediaKind:'background',prompt:'原创工程房间',negativePrompt:'',invariants:[],forbiddenDepictions:[],width:576,height:324,resolutionTier:'1K',alpha:'not-required',references:[]}
    const second={...first,requirementKey:'desk.reference',assetKey:'avg.generated.reference',name:'待重做的工程参考',consumer:{consumerKey:'desk.reference',domain:'reference',slot:'style',subjectKey:'desk',sceneKey:null,lineKey:null,required:false,fallback:'omit'},triggerBeatKey:null}
    const saved=await service.saveAvgVisualBatchDraftV1({scope:s.scope,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,batchKey:'repair.browser',revision:1,requirements:[first,second]})
    const prepared=await service.prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:saved.revision})
    const started=await service.startAvgAssemblyV1({scope:s.scope,productionId:s.productionId,expectedBriefHash:prepared.brief.briefHash})
    for(const artifactKey of ['avg.system.plan',...started.executionBrief.avgAssembly.sceneKeys.map((key:string)=>`avg.content.scene-script.${key}`)]){
      const candidate=await service.stageAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,expectedDraftRevision:(await draft.readAvgDraftV1(s.scope)).revision,artifactKey,declaration:'原创工程输入，仅校准恢复路径'})
      await service.confirmAvgWorkspaceInputV1({scope:s.scope,productionId:s.productionId,artifactKey,candidateVersion:candidate.version,candidateHash:JSON.parse(candidate.metadataJson).candidateHash})
    }
    return {scope:s.scope,productionId:s.productionId,parentId:started.build.id,png:canvas.toDataURL('image/png').split(',')[1],titles:JSON.parse((await draft.readAvgDraftV1(s.scope)).editorJson).systemPlan.scenes.map((scene:{title:string})=>scene.title) as string[]}
  })
  png=seeded.png
  await page.evaluate(async s=>{
    const service=await(new Function('p','return import(p)') as(p:string)=>Promise<any>)('/storyforge/src/lib/avg/assembly-service.ts')
    await service.runAvgAssemblyV1({scope:s.scope,productionId:s.productionId})
  },seeded)
  expect(requests).toBe(2)
  await page.goto(`./avg/production?project=${seeded.scope.projectId}&work=${seeded.scope.workId}&assembly=1`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const repair=page.getByRole('region',{name:'图片恢复方案',exact:true})
  await expect(repair.getByRole('button',{name:'准备图片恢复方案',exact:true})).toBeDisabled()
  await repair.getByRole('button',{name:'查看保留原图：保留的工程背景',exact:true}).click()
  await expect.poll(()=>repair.locator('img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(576)
  await repair.getByRole('checkbox',{name:'保留原图：保留的工程背景',exact:true}).check()
  await repair.getByRole('checkbox',{name:'我已查看保留原图，并核对重做项目、原调用记录和费用边界',exact:true}).check()
  await page.screenshot({path:info.outputPath('avg-image-recovery-review.png')})
  await repair.getByRole('button',{name:'准备图片恢复方案',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'图片恢复方案已保存'})).toBeVisible()
  expect(requests).toBe(2)
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adopt(page,'系统规则')
  for(const title of seeded.titles)await adopt(page,`场景：${title}`)
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await page.getByRole('button',{name:'复验并执行本批图片（最多 1 次新请求）',exact:true}).click()
  const card=page.getByRole('article',{name:'图片候选：保留的工程背景',exact:true})
  await expect(card.getByRole('button',{name:'保存选图候选：保留的工程背景',exact:true})).toBeEnabled()
  expect(requests).toBe(3)
  await page.reload();await page.getByRole('button',{name:'素材',exact:true}).click()
  await expect(page.getByRole('button',{name:'复验并执行本批图片（最多 0 次新请求）',exact:true})).toBeDisabled()
  const evidence=await page.evaluate(async s=>{
    const {db}=await(new Function('p','return import(p)') as(p:string)=>Promise<any>)('/storyforge/src/lib/db/schema.ts')
    const builds=await db.productBuilds.where('productionId').equals(s.productionId).toArray(),child=builds.find((b:any)=>b.buildNumber===2)
    const old=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.parentId,'avg.media.raw.desk.background']).first()
    const raw=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([child.id,'avg.media.raw.desk.background']).first()
    return {parent:child.parentBuildNumber,sameBytes:old.contentHash===raw.contentHash&&old.blobObjectId===raw.blobObjectId,newReceipt:old.producerReceiptHash!==raw.producerReceiptHash,usage:JSON.parse(child.budgetLedgerJson).tasks['avg.media.generate.desk.background'].usage}
  },seeded)
  expect(evidence).toMatchObject({parent:1,sameBytes:true,newReceipt:true,usage:{mediaCalls:0,costUsd:0}})
  expect(requests).toBe(3)
})
