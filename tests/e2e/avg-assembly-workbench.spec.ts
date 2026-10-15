import { test, expect, type Page } from '@playwright/test'

test.use({actionTimeout:15_000})

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
})

async function openNewAuthorWorkspace(page: Page) {
  const scope=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [draft,preset]=await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts')])
    const owner=await draft.createAvgDraftV1('作者系统工作台实际验收'),world=await preset.createMistHarborWorld()
    await draft.selectAvgWorldV1(owner.scope,0,world.worldReleaseId)
    return owner.scope
  })
  await page.goto(`./avg/production?project=${scope.projectId}&work=${scope.workId}`)
  await page.getByRole('button',{name:'打开系统与效果工作台',exact:true}).click()
  await expect(page.getByRole('region',{name:'系统与效果组装（实验）'})).toBeVisible()
  await expect(page.getByRole('button',{name:'保存编辑草稿',exact:true})).toBeEnabled()
  return scope
}

async function adopt(page: Page,label: string) {
  let card=page.getByRole('article',{name:`作者确认：${label}`,exact:true})
  await card.getByRole('button',{name:`保存候选：${label}`,exact:true}).click()
  await expect(card.getByText('查看候选 v1 的准确内容',{exact:true})).toBeVisible()
  await card.getByText('查看候选 v1 的准确内容',{exact:true}).click()
  await card.getByRole('checkbox',{name:'我已核对该候选内容及素材来源授权',exact:true}).check()
  await card.getByRole('button',{name:`确认采用：${label}`,exact:true}).click()
  card=page.getByRole('article',{name:`作者确认：${label}`,exact:true})
  await expect(card.getByText('已采用 v1',{exact:true})).toBeVisible()
}

async function save(page:Page) {
  await page.getByRole('button',{name:'保存编辑草稿',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'编辑草稿已保存'})).toBeVisible()
}

async function createPreview(page: Page,scenes: string[],voiceName?: string) {
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'准备制作方案',exact:true}).click()
  await expect(page.getByRole('button',{name:'确认方案并开始组装',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await expect(page.getByRole('button',{name:'保存候选：系统规则',exact:true})).toBeEnabled()
  await adopt(page,'系统规则')
  for(const scene of scenes)await adopt(page,`场景：${scene}`)
  if(voiceName){
    await page.getByRole('button',{name:'演出与配音',exact:true}).click()
    await page.getByRole('combobox',{name:'配音片段',exact:true}).selectOption({label:voiceName})
    await save(page)
    await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  }
  await adopt(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await expect(page.getByRole('button',{name:'试玩此预览',exact:true})).toBeEnabled()
}

test('author workbench imports and binds actual media, confirms inputs, freezes through the real production graph and plays evidence/voice/save',async({page},info)=>{
  test.setTimeout(150_000)
  const scope=await openNewAuthorWorkspace(page)
  const media=await page.evaluate(async()=>{
    const image=async(width:number,height:number,kind:string)=>{
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!
      if(kind==='actor'){ctx.fillStyle='#496273';ctx.beginPath();ctx.ellipse(width/2,height*.65,width*.30,height*.35,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d8b994';ctx.beginPath();ctx.arc(width/2,height*.2,width*.18,0,Math.PI*2);ctx.fill()}
      else{const gradient=ctx.createLinearGradient(0,0,width,height);gradient.addColorStop(0,kind==='replacement'?'#315b43':'#172b4b');gradient.addColorStop(1,kind==='replacement'?'#d3c997':'#8a6f55');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);ctx.fillStyle='#d8b994';ctx.fillRect(width*.3,height*.4,width*.4,height*.25);ctx.fillStyle='#a93642';ctx.beginPath();ctx.arc(width*.5,height*.52,width*.04,0,Math.PI*2);ctx.fill()}
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    }
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const audio=await (await load('/storyforge/tests/helpers/avg-reading-fixture.ts')).avgReadingAudioFixture(1400)
    return {replacement:await image(1280,720,'replacement'),background:await image(1280,720,'background'),actor:await image(256,512,'actor'),icon:await image(64,64,'icon'),detail:await image(512,320,'detail'),audio:Array.from(new Uint8Array(audio.data))}
  })
  await page.getByRole('button',{name:'素材',exact:true}).click()
  const upload=async(name:string,kind:string,bytes:number[],mime:string,item=false)=>{
    await page.getByLabel('文件',{exact:true}).setInputFiles({name:`${name}.${mime==='image/png'?'png':'wav'}`,mimeType:mime,buffer:Buffer.from(bytes)})
    await page.getByLabel('素材名称',{exact:true}).fill(name)
    await page.getByRole('combobox',{name:'用途',exact:true}).selectOption(kind)
    await page.getByLabel('来源与授权说明',{exact:true}).fill('原创工程校准媒资；用于系统与表现验证。')
    await page.getByLabel('替代文本',{exact:true}).fill(name)
    if(kind.startsWith('character-'))await page.getByRole('combobox',{name:'角色标识',exact:true}).selectOption('keeper')
    if(item)await page.getByRole('combobox',{name:'物件用途（所有状态）',exact:true}).selectOption('letter')
    await page.getByRole('button',{name:'实际解码并导入',exact:true}).click()
    await expect(page.getByRole('status').filter({hasText:'实际文件已解码'})).toBeVisible()
  }
  await upload('校准背景','background',media.background,'image/png')
  await upload('校准立绘','character-pose',media.actor,'image/png')
  await upload('校准图标','ui',media.icon,'image/png',true)
  await upload('校准详情','cg',media.detail,'image/png',true)
  await upload('校准音乐（非人声）','bgm',media.audio,'audio/wav')
  await upload('校准配音（非人声）','voice',media.audio,'audio/wav')
  await save(page)
  await page.reload()
  await expect(page.getByRole('region',{name:'系统与效果组装（实验）'})).toBeVisible()
  await createPreview(page,['桌前','继续保管','完成交接'],'校准配音（非人声）')
  const evidence=await page.evaluate(async s=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
    const production=await db.productProductions.where('workId').equals(s.workId).first(),build=await db.productBuilds.where('productionId').equals(production.id).first()
    const preview=JSON.parse(build.previewManifestJson),ledger=JSON.parse(build.budgetLedgerJson)
    const blobs=await db.avgDraftMedia.where('workId').equals(s.workId).toArray()
    return {version:preview.version,bindings:preview.mediaBindings.length,root:build.rootTerminalReceiptHash,status:build.status,
      zeroCalls:Object.values(ledger.tasks).every((entry:any)=>entry.status==='settled'&&entry.usage.modelCalls===0&&entry.usage.mediaCalls===0),
      sharedAudioBlob:blobs[4].blobObjectId===blobs[5].blobObjectId,quality:JSON.parse(build.qualityReportJson)}
  },scope)
  expect(evidence).toMatchObject({version:2,bindings:6,status:'preview-ready',zeroCalls:true,sharedAudioBlob:true,quality:{mediaCoverage:1,playable:true,releaseReady:false}})
  expect(evidence.root).toMatch(/^[a-f0-9]{64}$/)
  await page.screenshot({path:info.outputPath('avg-assembly-workbench.png'),fullPage:true})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('保管员将信封交给你。请打开背包，检查封口，再向保管员出示。')
  const retry=page.getByRole('button',{name:'重试配音',exact:true})
  await expect.poll(async()=>await retry.isVisible()||await page.locator('audio[data-channel="voice"]').evaluateAll((rows:HTMLAudioElement[])=>rows.some(audio=>!audio.paused||audio.ended))).toBe(true)
  if(await retry.isVisible())await retry.click()
  await expect.poll(()=>page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [runtime,player]=await Promise.all([load('/storyforge/src/lib/product/runtime-core.ts'),load('/storyforge/src/stores/avg-game-player.ts')])
    const current=(await runtime.readProductRuntimeState(player.useAvgGamePlayerStore.getState().selectedSessionId)).avgReading?.current
    return {status:current?.status,playedMs:current?.playedMs}
  })).toMatchObject({status:'ended',playedMs:expect.any(Number)})
  await page.getByRole('button',{name:'物品与证据',exact:true}).click()
  const panel=page.getByRole('dialog',{name:'物品与证据'})
  await expect(panel.getByRole('heading',{name:'封好的信封',exact:true})).toBeVisible()
  await expect.poll(()=>panel.locator('nav img').evaluate((image:HTMLImageElement)=>image.complete?image.naturalWidth:0)).toBe(64)
  await panel.getByRole('button',{name:'检查信封',exact:true}).click()
  await expect(panel.getByRole('heading',{name:'带缺口的封印信',exact:true})).toBeVisible()
  await expect.poll(()=>panel.locator('.avg-inventory-detail-image').evaluate((image:HTMLImageElement)=>image.complete?image.naturalWidth:0)).toBe(512)
  await panel.getByRole('button',{name:'向保管员出示',exact:true}).click()
  await page.screenshot({path:info.outputPath('avg-assembly-stage-inventory.png'),fullPage:true})
  await panel.getByRole('button',{name:'关闭',exact:true}).click()
  await page.getByRole('button',{name:'快速存档',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已快速存档'})).toBeVisible()
  await page.getByRole('button',{name:'继续',exact:true}).click()
  await page.getByRole('button',{name:'确认交接',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('保管员确认缺口，交接完成。')
  await page.reload()
  await expect(page.locator('.avg-dialogue p')).toHaveText('保管员确认缺口，交接完成。')
  const originalSession=Number(new URL(page.url()).searchParams.get('session'))
  const oldSource=await page.evaluate(async s=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
    const build=await db.productBuilds.where('workId').equals(s.workId).first()
    return {id:build.id,packageHash:build.packageHash,previewJson:build.previewManifestJson}
  },scope)
  await page.getByRole('button',{name:'返回制作台',exact:true}).click()
  await page.getByRole('button',{name:'以此预览开始修订',exact:true}).click()
  await page.getByRole('button',{name:'素材',exact:true}).click()
  await page.getByRole('combobox',{name:'替换本次组装中的媒资',exact:true}).selectOption({label:'校准背景'})
  await upload('替换校准背景','background',media.replacement,'image/png')
  await save(page)
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await page.getByRole('button',{name:'准备新版本方案',exact:true}).click()
  await page.getByRole('button',{name:'确认方案并开始组装',exact:true}).click()
  await adopt(page,'系统规则')
  for(const scene of ['桌前','继续保管','完成交接'])await adopt(page,`场景：${scene}`)
  await adopt(page,'演出与媒资')
  await page.getByRole('button',{name:'执行组装并生成新预览',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'新预览已冻结'})).toBeVisible({timeout:60_000})
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('保管员将信封交给你。请打开背包，检查封口，再向保管员出示。')
  const revisions=await page.evaluate(async input=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
    const builds=await db.productBuilds.where('workId').equals(input.scope.workId).toArray(),old=await db.productBuilds.get(input.old.id)
    const current=builds.find((row:any)=>row.id!==input.old.id),preview=JSON.parse(current.previewManifestJson)
    const session=await db.productRuntimeSessions.get(input.session)
    return {oldPreserved:old.previewManifestJson===input.old.previewJson,oldSessionPinned:session.productBuildId===input.old.id,
      newPackage:current.packageHash!==input.old.packageHash,policy:JSON.parse(current.compatibilityJson).migrationPolicy,
      assets:preview.runtimePackage.modules[0].stage.assets.map((asset:any)=>asset.name)}
  },{scope,old:oldSource,session:originalSession})
  expect(revisions).toMatchObject({oldPreserved:true,oldSessionPinned:true,newPackage:true,policy:'pin-old-save'})
  expect(revisions.assets).toContain('替换校准背景');expect(revisions.assets).not.toContain('校准背景')
  await page.screenshot({path:info.outputPath('avg-assembly-revised-stage.png'),fullPage:true})
})

test('linear configuration persists edits on navigation and plays without inventory while tone follows the switch',async({page},info)=>{
  test.setTimeout(100_000)
  const scope=await openNewAuthorWorkspace(page)
  await page.getByRole('combobox',{name:'工程配置',exact:true}).selectOption('linear')
  await page.getByRole('button',{name:'对白与选择',exact:true}).click()
  await page.getByLabel('灯光关闭第1句',{exact:true}).fill('请点击开关，验证线性阅读。')
  await page.getByRole('button',{name:'作品库',exact:true}).click()
  await expect(page.getByRole('heading',{name:'作品库',exact:true})).toBeVisible()
  await page.goto(`./avg/production?project=${scope.projectId}&work=${scope.workId}`)
  await expect(page.getByRole('region',{name:'系统与效果组装（实验）'})).toBeVisible()
  await createPreview(page,['灯光关闭','灯光亮起'])
  await page.getByRole('button',{name:'试玩此预览',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('请点击开关，验证线性阅读。')
  await expect(page.locator('.avg-stage')).toHaveAttribute('data-tone','night')
  const nightBackground=await page.locator('.avg-stage').evaluate(element=>getComputedStyle(element).backgroundImage)
  await expect.poll(()=>page.locator('.avg-stage-scene').evaluate(element=>getComputedStyle(element).filter)).not.toBe('none')
  await expect(page.getByRole('button',{name:'物品与证据',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'继续',exact:true}).click()
  await page.getByRole('button',{name:'打开灯光',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('灯光亮起，变量已生效。')
  await expect(page.locator('.avg-stage')).toHaveAttribute('data-tone','day')
  await expect.poll(()=>page.locator('.avg-stage').evaluate(element=>getComputedStyle(element).backgroundImage)).not.toBe(nightBackground)
  await page.screenshot({path:info.outputPath('avg-assembly-linear.png'),fullPage:true})
})
