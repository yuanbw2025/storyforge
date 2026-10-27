import {expect,test,type Page} from '@playwright/test'

// All data is created in Playwright's fresh non-persistent context; no original
// engineering/author profile, model transport or external network is permitted.
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','isolated open preview only') })
let modelAttempts=0
const loadSeed=async (page:Page)=>page.evaluate(async()=>{
  const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
  const {seedManualTableV1}=await load('/storyforge/tests/helpers/open-ttrpg-manual.ts')
  const {f,input}=await seedManualTableV1(),{db}=await load('/storyforge/src/lib/db/schema.ts'),core=await load('/storyforge/src/lib/product/runtime-core.ts')
  return {scope:f.scope,sessionId:f.sessionId,productionId:f.productionId,input,state:await core.readProductRuntimeState(f.sessionId),worlds:await db.worldReleases.toArray(),builds:await db.productBuilds.toArray()}
})
async function evidence(page:Page,sessionId:number){return page.evaluate(async sessionId=>{
  const load=new Function('p','return import(p)') as (p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts'),core=await load('/storyforge/src/lib/product/runtime-core.ts')
  return {row:await db.productRuntimeSessions.get(sessionId),state:await core.readProductRuntimeState(sessionId),events:await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'),participants:await db.ttrpgSessionParticipants.where('sessionId').equals(sessionId).sortBy('seatKey'),checkpoints:await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray()}
},sessionId)}
async function enter(page:Page,f:Awaited<ReturnType<typeof loadSeed>>){
  await page.goto(`./ttrpg/play?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}&session=${f.sessionId}`)
  await expect(page.getByTestId('ttrpg-open-player-table')).toBeVisible()
}
async function verifyChild(page:Page,parent:Awaited<ReturnType<typeof evidence>>,cut:number){
  await expect.poll(()=>Number(new URL(page.url()).searchParams.get('session'))).not.toBe(parent.row.id)
  const childId=Number(new URL(page.url()).searchParams.get('session')),child=await evidence(page,childId)
  expect(child.row.parentSessionId).toBe(parent.row.id);expect(child.row.parentThroughSequence).toBe(cut)
  expect(child.row.runtimeSourceHash).toBe(parent.row.runtimeSourceHash);expect(child.row.productBuildId).toBe(parent.row.productBuildId)
  expect(child.state.ttrpg.authorization).toBeNull();expect(child.state.ttrpg.product.sessionZero.completed).toBe(false)
  expect(child.state.ttrpg.branchLineage.parentSessionKey).toBe(parent.state.ttrpg.sessionKey)
  expect(child.state.entities).toEqual(parent.state.entities);expect(child.state.lastSequence).toBe(0)
  expect(child.state.ttrpg.openRun.worldTime.worldTurn).toBe(parent.state.ttrpg.openRun.worldTime.worldTurn)
  await expect(page.getByTestId('ttrpg-open-player-table')).toBeVisible()
  await page.getByLabel('我的角色',{exact:true}).selectOption('viewer.seat.hero')
  await expect(page.getByRole('checkbox',{name:'我已了解安全约定和 AI 身份，并确认这是我的角色。',exact:true})).not.toBeChecked()
  await page.reload();await expect(page.getByTestId('ttrpg-open-player-table')).toBeVisible()
  expect(Number(new URL(page.url()).searchParams.get('session'))).toBe(childId)
  expect(await evidence(page,parent.row.id)).toEqual(parent)
  const scope=await page.evaluate(async()=>{const {db}=await import('/storyforge/src/lib/db/schema.ts');return {worlds:await db.worldReleases.toArray(),builds:await db.productBuilds.toArray(),runs:await db.agentRuns.count()}})
  expect(scope.runs).toBe(0);expect(modelAttempts).toBe(0)
  return {childId,child,scope}
}
test.beforeEach(async({page})=>{
  modelAttempts=0
  const allowedOrigin=new URL(test.info().project.use.baseURL!).origin
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url())
    if(request.method()==='POST'&&/local-codex|chat\/completions|audio\/speech/.test(url.pathname)){modelAttempts++;return route.abort('blockedbyclient')}
    if(url.protocol==='http:'&&url.origin===allowedOrigin)return route.continue()
    if(['data:','blob:'].includes(url.protocol))return route.continue()
    return route.abort('blockedbyclient')
  })
  await page.goto('./')
})
test('normal open tools create a current-progress branch and retain its route after reload',async({page})=>{
  const f=await loadSeed(page);await enter(page,f);const parent=await evidence(page,f.sessionId)
  await page.getByRole('button',{name:'存档与分支',exact:true}).click()
  await expect(page.getByTestId('ttrpg-open-save-and-branch')).toBeVisible()
  await expect(page.getByText('冻结 TTRPG 产品校验失败',{exact:false})).toHaveCount(0)
  await page.getByRole('button',{name:'从当前进度建立分支',exact:true}).click()
  const proof=await verifyChild(page,parent,parent.state.lastSequence)
  expect(proof.scope.worlds).toEqual(f.worlds);expect(proof.scope.builds).toEqual(f.builds)
  await page.screenshot({path:test.info().outputPath('normal-open-branch.png'),fullPage:true})
  await test.info().attach('branch-proof',{body:JSON.stringify({parent,proof}),contentType:'application/json'})
})
test('normal consultation stays open across saved updates; handoff clears it; checkpoint restores the earlier cut',async({page})=>{
  const f=await loadSeed(page);await enter(page,f)
  await page.getByRole('button',{name:'存档与分支',exact:true}).click()
  await page.getByRole('button',{name:'保存检查点',exact:true}).click()
  await expect(page.getByText('检查点已保存。',{exact:true})).toBeVisible()
  const checkpoint=(await evidence(page,f.sessionId)).checkpoints[0];expect(checkpoint.throughSequence).toBe(f.state.lastSequence)
  await page.getByLabel('我的角色',{exact:true}).selectOption('viewer.seat.hero')
  await page.getByRole('button',{name:'确认身份并进入',exact:true}).click()
  let panel=page.getByTestId('ttrpg-open-consultation-desk');await panel.locator('summary').click()
  await panel.getByRole('button',{name:'开始本次咨询与交流',exact:true}).click()
  await expect(panel.getByLabel('Oracle 咨询表',{exact:true})).toBeEnabled()
  await expect(panel).toHaveJSProperty('open',true)
  await panel.getByLabel('Oracle 咨询表',{exact:true}).selectOption('oracle.yes')
  await panel.getByLabel('Oracle 可能性',{exact:true}).selectOption('even')
  await panel.getByLabel('Oracle 咨询问题',{exact:true}).fill('恢复分支前是否下雨？')
  await panel.getByRole('button',{name:'确认问题并咨询一次',exact:true}).click()
  await expect(panel.getByRole('region',{name:'已保存的咨询结果'})).toContainText('恢复分支前是否下雨？')
  await expect(panel).toHaveJSProperty('open',true)
  await page.screenshot({path:test.info().outputPath('consultation-after-saved-result.png'),fullPage:true})
  await page.getByRole('button',{name:'交接给另一位玩家',exact:true}).click()
  await expect(page.getByTestId('ttrpg-open-consultation-desk')).toHaveCount(0)
  await page.getByLabel('我的角色',{exact:true}).selectOption('viewer.seat.hero')
  await page.getByRole('button',{name:'确认身份并进入',exact:true}).click()
  panel=page.getByTestId('ttrpg-open-consultation-desk');await expect(panel).toHaveJSProperty('open',false)
  await panel.locator('summary').click();await expect(panel.getByRole('region',{name:'已保存的咨询结果'})).toContainText('恢复分支前是否下雨？')
  await panel.getByRole('button',{name:'结束本次咨询与交流',exact:true}).click()
  await expect(panel.getByRole('button',{name:'开始本次咨询与交流',exact:true})).toBeEnabled()
  const parent=await evidence(page,f.sessionId);expect(parent.state.lastSequence).toBeGreaterThan(checkpoint.throughSequence)
  await page.getByRole('button',{name:'从检查点 冒险检查点 建立恢复分支',exact:true}).click()
  const proof=await verifyChild(page,parent,checkpoint.throughSequence)
  expect(parent.state.ttrpg.openRun.oracleReceipts).toHaveLength(1)
  expect(proof.child.state.ttrpg.openRun.oracleReceipts).toEqual(f.state.ttrpg.openRun.oracleReceipts)
  expect(proof.child.state.ttrpg.openRun.oracleReceipts ?? []).toHaveLength(0)
  expect(proof.scope.worlds).toEqual(f.worlds);expect(proof.scope.builds).toEqual(f.builds)
  await test.info().attach('checkpoint-cut-proof',{body:JSON.stringify({checkpoint,parent,proof}),contentType:'application/json'})
})
