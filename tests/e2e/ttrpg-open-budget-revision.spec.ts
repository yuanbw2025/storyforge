import { expect, test } from '@playwright/test'
test.setTimeout(180000)
test.beforeEach(()=>{test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW!=='1','requires isolated open preview')})
let retainedNetwork: unknown[] = []
test.afterEach(async({page},info)=>{void page;await info.attach('budget-native-http-counts',{contentType:'application/json',body:JSON.stringify({calls:retainedNetwork,realProvider:false})})})
/** Native IndexedDB and normal controls; every provider response is an explicit fixture. */
test('stopped V2 TTRPG prepares and saves a new budget without inference, then separately starts V3 and publishes',async({page},info)=>{
 const calls:Array<{method:string;path:string;key?:string}>=[],requests=new Map<string,{wire:any;hash:string;key:string;output:string}>()
 retainedNetwork=calls
 await page.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url())
  if(r.method()==='POST'&&!url.pathname.includes('/local-codex/v1/')){await route.abort('blockedbyclient');throw Error('Unexpected POST in isolated budget fixture')}
  await route.fallback()
 })
 await page.route('**/local-codex/v1/**',async route=>{
  const r=route.request(),url=new URL(r.url()),method=r.method()
  if(url.pathname.endsWith('/status'))return route.fulfill({json:{state:'ready'}})
  if(method==='POST'&&url.pathname.endsWith('/requests')){
   const wire=r.postDataJSON(),system=wire.messages.find((m:any)=>m.role==='system')?.content??''
   const key=system.includes('storyforge.ttrpg-open-source-facts')?'sourceFacts':system.includes('storyforge.ttrpg-open-rule-system')?'ruleSystem':system.includes('storyforge.ttrpg-open-situation-layer')?'situationLayer':null
   if(!key||requests.size>=3||[...requests.values()].some(x=>x.key===key))throw Error('Unexpected or duplicate provider fixture task')
   const prepared=await page.evaluate(async({requestId,key})=>{
    const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts')
    const a=(await db.agentRunArtifacts.toArray()).find((a:any)=>a.content?.includes('storyforge.product-production-local-request')&&a.content.includes(requestId))
    if(!a)throw Error('New request has no pre-dispatch owner')
    const evidence=JSON.parse(a.content),build=await db.productBuilds.get(evidence.owner.buildId),production=await db.productProductions.get(evidence.owner.productionId)
    const row=await db.productProductionBriefs.where('[productionId+revision]').equals([production.id,build.briefRevision]).first()
    const brief=(await load('/storyforge/src/lib/product-production/contracts.ts')).parseProductProductionBriefV3(row.briefJson)
    const data=await(await load('/storyforge/tests/helpers/open-ttrpg-production-artifacts.ts')).openProductionCompilerFixtureV1(true,{scope:evidence.owner.scope,productionId:production.id,brief})
    return{evidence,buildNumber:build.buildNumber,output:JSON.stringify(data[key])}
   },{requestId:wire.id,key})
   expect(prepared.buildNumber).toBe(2);expect(prepared.evidence.messages).toEqual(wire.messages);expect(prepared.evidence.request.requestId).toBe(wire.id)
   requests.set(wire.id,{wire,hash:prepared.evidence.request.requestHash,key,output:prepared.output});calls.push({method,path:url.pathname,key})
   return route.fulfill({json:{id:wire.id,status:'accepted'}})
  }
  const id=[...requests.keys()].find(id=>url.pathname.endsWith('/requests/'+id)||url.pathname.endsWith('/requests/'+id+'/acknowledge'))
  if(!id)throw Error('Unexpected native operation '+method+' '+url.pathname)
  const record=requests.get(id)!;calls.push({method,path:url.pathname,key:record.key})
  if(method==='GET')return route.fulfill({json:{id,model:record.wire.model,createdAt:Date.now(),status:'completed',text:record.output,usage:{inputTokens:101,outputTokens:11},dispatched:true,requestHash:record.hash,requestHashAlgorithm:'sha256-json-request-v1',receiptRetention:'until-owner-ack-v1'}})
  if(method==='POST'&&url.pathname.endsWith('/acknowledge')){
   const retained=await page.evaluate(async text=>{
    const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),hash=await(await load('/storyforge/src/lib/ai/chapter-memory/text-normalization.ts')).sha256Text(text),rows=await db.agentRunArtifacts.toArray()
    return{raw:rows.some((a:any)=>a.artifactKind==='raw-response'&&a.contentHash===hash&&a.content===text),metadata:rows.some((a:any)=>a.artifactKind==='source-snapshot'&&a.content?.includes('storyforge.product-production-local-response')&&a.content.includes(hash))}
   },record.output)
   expect(retained).toEqual({raw:true,metadata:true});return route.fulfill({json:{id,status:'completed',acknowledged:true,acknowledgedAt:Date.now()}})
  }
  throw Error('Unexpected native mutation')
 })
 await page.goto('./')
 const f=await page.evaluate(async()=>{
  const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),helper=await load('/storyforge/tests/helpers/open-ttrpg-production-browser.ts')
  const base=await(await load('/storyforge/tests/helpers/open-ttrpg-production.ts')).openProductionFixtureV1()
  // Normalize this explicit fixture before freezing its hash; the compiler fixture fills seats/information policy.
  await(await load('/storyforge/tests/helpers/open-ttrpg-production-artifacts.ts')).openProductionCompilerFixtureV1(true,{brief:base.brief,productionId:base.productionId,scope:base.scope})
  base.brief.productionBudget={...base.brief.productionBudget,maximumModelCalls:16,maximumInputTokens:192000,maximumOutputTokens:60000,maximumDurationMs:3600000,maximumMediaCalls:0}
  const {executeProductProductionCommand:command}=await load('/storyforge/src/lib/product-production/commands.ts')
  let initial=await db.productProductions.get(base.productionId)
  const saved=await command({scope:base.scope,productionId:base.productionId,command:{type:'save-brief-revision',commandId:'budget-native.old.brief',expectedStateRevision:initial.stateRevision,parentRevision:initial.currentBriefRevision,brief:base.brief}})
  if(!saved.ok)throw Error('Old fixture brief preparation failed')
  initial=await db.productProductions.get(base.productionId);const initialBrief=await db.productProductionBriefs.where('[productionId+revision]').equals([initial.id,initial.currentBriefRevision]).first()
  const started=await command({scope:base.scope,productionId:base.productionId,command:{type:'authorize-start',commandId:'budget-native.old.start',expectedStateRevision:initial.stateRevision,briefRevision:initialBrief.revision,briefHash:initialBrief.briefHash,authorizationNonce:'explicit.old.fixture'}})
  if(!started.ok)throw Error('Old fixture authorization failed')
  const f={scope:base.scope,productionId:base.productionId,executionProfile:2},old=await helper.runOpenBrowserProductionV1(f)
  const {useAIConfigStore}=await load('/storyforge/src/stores/ai-config.ts');useAIConfigStore.getState().setConfig({provider:'codex',model:'fixture-budget-native-only',apiKey:'',contextWindow:131072,maxTokens:24000})
  const p=await db.projects.get(f.scope.projectId);await(await load('/storyforge/src/lib/workspace/works.ts')).updateWorkspace(f.scope.projectId,{productPlatformOptIns:{...p.productPlatformOptIns,productProductionV3:true}})
  const production=await db.productProductions.get(f.productionId),build=await db.productBuilds.get(old.buildId)
  return{scope:f.scope,productionId:f.productionId,oldBuildId:old.buildId,oldInternalFixtureReportedCalls:old.modelCalls,production,build,worlds:await db.worldReleases.toArray()}
 })
 expect(f.build.status).toBe('recovery-required');expect(JSON.parse(f.build.planJson).tasks[0].skillId).toContain('.v2')
 expect(requests.size).toBe(0)
 await page.goto(`./ttrpg/production?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
 await expect(page.getByRole('button',{name:'停止',exact:true})).toBeVisible({timeout:30000})
 const helpVisible=await page.getByTestId('ttrpg-open-budget-revision-help').isVisible()
 await page.getByRole('button',{name:'停止',exact:true}).click()
 await expect.poll(async()=>page.evaluate(async productionId=>{const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts');return(await db.productProductions.get(productionId)).status},f.productionId)).toBe('stopped')
 const stopped=await page.evaluate(async input=>{
  const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),build=await db.productBuilds.get(input.oldBuildId)
  return{production:await db.productProductions.get(input.productionId),build,runs:await db.agentRuns.where('productBuildId').equals(build.id).toArray(),events:await db.agentRunEvents.where('projectId').equals(input.scope.projectId).toArray(),briefCount:await db.productProductionBriefs.where('productionId').equals(input.productionId).count(),raw:await db.agentRunArtifacts.where('projectId').equals(input.scope.projectId).toArray()}
 },f)
 expect(stopped.build.status).toBe('cancelled');expect(stopped.build.budgetLedgerJson).toBe(f.build.budgetLedgerJson)
 await info.attach('budget-old-stopped-snapshot',{contentType:'application/json',body:JSON.stringify({f,stopped,realProvider:false})})
 const panel=page.getByTestId('ttrpg-open-budget-revision')
 await expect(panel).toBeVisible({timeout:15000})
 await expect(panel.getByRole('spinbutton',{name:'输入用量上限（tokens）',exact:true})).toHaveValue('192000')

 await panel.getByRole('spinbutton',{name:'输入用量上限（tokens）',exact:true}).fill('384000')
 await expect(panel.getByRole('button',{name:'保存为新制作方案',exact:true})).toBeDisabled()
 await panel.getByRole('button',{name:'核对新预算',exact:true}).click()
 await expect(panel.getByRole('button',{name:'保存为新制作方案',exact:true})).toBeEnabled()
 await expect(panel).toContainText('96,000');expect(requests.size).toBe(0)
 await page.screenshot({path:info.outputPath('new-ttrpg-budget-proposal.png'),fullPage:true})
 await panel.getByRole('button',{name:'保存为新制作方案',exact:true}).click()
 const start=page.getByRole('button',{name:'作者授权并开始自动制作',exact:true});await expect(start).toBeEnabled({timeout:30000})
 expect(requests.size).toBe(0)
 const saved=await page.evaluate(async input=>{
  const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),production=await db.productProductions.get(input.productionId),row=await db.productProductionBriefs.where('[productionId+revision]').equals([production.id,production.currentBriefRevision]).first(),build=await db.productBuilds.get(input.oldBuildId)
  return{production,brief:row,briefCount:await db.productProductionBriefs.where('productionId').equals(input.productionId).count(),buildCount:await db.productBuilds.where('productionId').equals(input.productionId).count(),oldBuild:build,oldRuns:await db.agentRuns.where('productBuildId').equals(build.id).toArray(),oldEvents:await db.agentRunEvents.where('projectId').equals(input.scope.projectId).toArray(),raw:await db.agentRunArtifacts.where('projectId').equals(input.scope.projectId).toArray()}
 },f)
 expect(saved.production.id).toBe(f.productionId);expect(saved.production.status).toBe('brief-ready');expect(saved.buildCount).toBe(1);expect(saved.briefCount).toBe(stopped.briefCount+1)
 expect(JSON.parse(saved.brief.briefJson).productionBudget.maximumInputTokens).toBe(384000);expect(saved.oldBuild).toEqual(stopped.build);expect(saved.oldRuns).toEqual(stopped.runs);expect(saved.oldEvents).toEqual(stopped.events);expect(saved.raw).toEqual(stopped.raw)
 await start.click()
 const review=page.getByTestId('ttrpg-open-production-review')
 await expect(review.getByRole('heading',{name:'核对来源事实',exact:true})).toBeVisible({timeout:30000})
 await review.getByRole('button',{name:'读取本任务待审稿',exact:true}).click();await expect(review.getByRole('checkbox').first()).toBeVisible()
 for(const checkbox of await review.getByRole('checkbox').all()){await expect(checkbox).not.toBeChecked();await checkbox.check()}
 await page.getByRole('button',{name:'修正后继续制作',exact:true}).click()
 await expect(review.getByRole('heading',{name:'核对角色属性',exact:true})).toBeVisible({timeout:30000})
 await review.getByRole('button',{name:'读取本任务待审稿',exact:true}).click();await expect(review.getByRole('checkbox').first()).toBeVisible()
 for(const checkbox of await review.getByRole('checkbox').all()){await expect(checkbox).not.toBeChecked();await checkbox.check()}
 await page.getByRole('button',{name:'修正后继续制作',exact:true}).click()
 await expect(page.getByRole('button',{name:'复验并原子发布',exact:true})).toBeVisible({timeout:30000})
 await page.getByRole('button',{name:'复验并原子发布',exact:true}).click();await expect(page).toHaveURL(/\/ttrpg\/play/,{timeout:30000})
 const published=await page.evaluate(async input=>{
  const load=new Function('p','return import(p)'),{db}=await load('/storyforge/src/lib/db/schema.ts'),production=await db.productProductions.get(input.productionId),build=await db.productBuilds.where('[productionId+buildNumber]').equals([production.id,production.currentBuildNumber]).first(),release=await db.productReleases.get(production.currentProductReleaseId),oldBuild=await db.productBuilds.get(input.oldBuildId)
  return{production,build,release,oldBuild,oldRuns:await db.agentRuns.where('productBuildId').equals(oldBuild.id).toArray(),oldEvents:await db.agentRunEvents.where('projectId').equals(input.scope.projectId).toArray(),worlds:await db.worldReleases.toArray(),sourceManifest:JSON.parse(release.manifestJson).sourceContracts.sourceManifest}
 },f)
 expect(helpVisible).toBe(true);expect(requests.size).toBe(3);expect(published.build.buildNumber).toBe(2);expect(published.build.status).toBe('released');expect(JSON.parse(published.build.planJson).tasks[0]).toMatchObject({skillId:'product-production.ttrpg-open-source-facts.v3',timeoutMs:600000,budgetReservation:{inputTokens:96000}})
 expect(published.oldBuild).toEqual(stopped.build);expect(published.oldRuns).toEqual(stopped.runs);expect(published.oldEvents.filter((e:any)=>stopped.events.some((old:any)=>old.id===e.id))).toEqual(stopped.events);expect(published.worlds).toEqual(f.worlds)
 for(const step of ['ttrpg.open.source-facts','ttrpg.open.rule-system','ttrpg.open.situation-layer'])expect(published.sourceManifest.runContextManifests.some((m:any)=>m.stepId===step)).toBe(true)
 await info.attach('budget-revision-native-evidence',{contentType:'application/json',body:JSON.stringify({f,stopped,saved,published,calls,realProvider:false,independentHumanAcceptance:false,scope:'Normalbudget controls afterexplicitStop,zero-modelpreview/save,separatestart/newV3/exactolderrecords/normalreview/publish;initialoldgeneration isinternalfixture callback'})})
})
