import { expect, test } from '@playwright/test'

test('048 native exact power adoption rolls back with its Run owner, preserves original DAG and survives project backup', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let modelCalls = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed','048-native'))
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url())
    if(request.method()==='POST')modelCalls++
    return url.origin===origin&&['GET','HEAD'].includes(request.method())?route.continue():route.abort()
  })
  await page.goto('./')
  const seeded=await page.evaluate(async()=>{
    const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
    const {seedCurrentWorkspace}=await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const {db}=await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const {stampNewRecord}=await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const {useCultivationStore}=await load<typeof import('../../src/stores/cultivation')>('/storyforge/src/stores/cultivation.ts')
    const {fingerprintSettingSource}=await load<typeof import('../../src/lib/fact-ledger/setting-assertions')>('/storyforge/src/lib/fact-ledger/setting-assertions.ts')
    const {scope}=await seedCurrentWorkspace('048 隔离力量采纳')
    const stages=JSON.stringify([
      {id:'root',name:'起境',features:'原能力',breakthrough:'原代价',parentStageIds:[],extra:{keep:'作者原注',number:125}},
      {id:'left',name:'左路',parentStageIds:['root']},{id:'right',name:'右路',parentStageIds:['root']},
      {id:'merge',name:'合流',parentStageIds:['left','right']},
    ])
    const id=await useCultivationStore.getState().addSystem({projectId:scope.projectId,name:'原路径048',description:'原路径原理048',stages},scope)
    const characterId=await db.characters.add(stampNewRecord(scope,'characters',{projectId:scope.projectId,name:'原关联角色048',roleWeight:'main',moralAxis:'neutral',orderAxis:'neutral',cultivationSystemId:id,cultivationStageId:'merge',createdAt:1,updatedAt:1},{owner:'world'}) as never)
    const progressId=await db.cultivationProgress.add(stampNewRecord(scope,'cultivationProgress',{projectId:scope.projectId,characterId,characterName:'原关联角色048',cultivationSystemId:id,cultivationSystemName:'原路径048',stageId:'merge',stageName:'合流',transition:'enter',sourceChapterTitle:'原章',sourceQuote:'原进度正文证据不丢',sourceOffset:0,trigger:'入境',status:'confirmed',createdAt:1,updatedAt:1},{owner:'work'}) as never)
    const factId=await db.temporalFacts.add(stampNewRecord(scope,'temporalFacts',{projectId:scope.projectId,subjectName:'原路径048',predicate:'powerCeiling',factKind:'state',value:'旧阶段图',sourceType:'setting',sourceRecordTable:'cultivationSystems',sourceCultivationSystemId:id,sourceField:'stages',sourceFingerprint:fingerprintSettingSource(stages),status:'confirmed',locked:false,createdAt:1,updatedAt:1},{owner:'work'}) as never)
    return {scope,id,characterId,progressId,factId}
  })
  const result=await page.evaluate(async f=>{
    const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
    const {db}=await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const Dexie=db.constructor as typeof import('dexie').default
    const {adopt}=await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts')
    const policy=await load<typeof import('../../src/lib/cultivation/power-authoring-adoption')>('/storyforge/src/lib/cultivation/power-authoring-adoption.ts')
    const scope={...f.scope,worldGroupId:null},edit={table:'cultivationSystems' as const,recordId:f.id,field:'stages' as const}
    const baseline=await policy.readPowerAuthoringBaselineV1(scope,edit)
    const request={target:'cultivationSystems' as const,powerAuthoring:{scope,edit,recordHash:baseline.recordHash,referenceHash:baseline.referenceHash,allocatedStageIds:[],confirmedRemovalHash:await policy.powerRemovalImpactHashV1(baseline,['merge'])},data:{version:1,updates:[],additions:[],removals:['merge']},mode:'replace' as const}
    const read=async()=>({system:await db.cultivationSystems.get(f.id),character:await db.characters.get(f.characterId),progress:await db.cultivationProgress.get(f.progressId),fact:await db.temporalFacts.get(f.factId)})
    const before=await read()
    let error=''
    try{await db.transaction('rw',policy.powerAuthoringTransactionTablesV1('cultivationSystems'),()=>{
      const transaction=Dexie.currentTransaction!
      return Dexie.Promise.resolve(adopt(request,{transaction})).then(()=>{throw new Error('synthetic receipt fault')})
    })}catch(cause){error=cause instanceof Error?cause.message:String(cause)}
    const rolledBack=await read()
    const receipt=await adopt(request),saved=await read()
    return {before,rolledBack,error,receipt,saved}
  },seeded)
  expect(result.error).toContain('synthetic receipt fault')
  expect(result.rolledBack).toEqual(result.before)
  expect(result.receipt.written).toEqual([{id:seeded.id,fields:['stages']}])
  expect(JSON.parse(result.saved.system!.stages)).toEqual(JSON.parse(result.before.system!.stages).slice(0,3))
  expect(result.saved.character).toMatchObject({cultivationSystemId:seeded.id,cultivationStageId:null})
  expect(result.saved.progress).toMatchObject({stageId:null,status:'source-missing',sourceQuote:'原进度正文证据不丢'})
  expect(result.saved.fact?.status).toBe('stale')
  await page.goto(`./workspace/${seeded.scope.projectId}?module=worldview-origin&originField=power`)
  const panel=page.getByRole('region',{name:'修炼体系编辑',exact:true})
  await panel.getByRole('navigation',{name:'境界列表',exact:true}).getByRole('button',{name:'起境',exact:true}).click()
  await expect(panel.locator('[data-markdown-read-view]').filter({hasText:'原能力'})).toBeVisible()
  await expect(panel.getByRole('navigation',{name:'境界列表',exact:true}).getByRole('button',{name:'合流',exact:true})).toHaveCount(0)
  const backup=await page.evaluate(async f=>{
    const load=new Function('path','return import(path)') as <T>(path:string)=>Promise<T>
    const {db}=await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const {exportProjectJSON,importProjectJSON}=await load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts')
    const exported=await exportProjectJSON(f.scope.projectId),projectId=await importProjectJSON(exported)
    const system=await db.cultivationSystems.where('projectId').equals(projectId).first()
    const character=await db.characters.where('projectId').equals(projectId).first()
    const progress=await db.cultivationProgress.where('projectId').equals(projectId).first()
    return {projectId,system,character,progress}
  },seeded)
  expect(backup.projectId).not.toBe(seeded.scope.projectId)
  expect(backup.system?.stages).toBe(result.saved.system!.stages)
  expect(backup.character).toMatchObject({cultivationSystemId:backup.system!.id,cultivationStageId:null})
  expect(backup.progress).toMatchObject({cultivationSystemId:backup.system!.id,stageId:null,status:'source-missing',sourceQuote:'原进度正文证据不丢'})
  const url=page.url();await page.close();const reopened=await context.newPage();await reopened.goto(url)
  const readback=await reopened.evaluate(async id=>{
    const {db}=await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.cultivationSystems.get(id)
  },seeded.id)
  expect(readback).toEqual(result.saved.system)
  expect(modelCalls).toBe(0)
})
