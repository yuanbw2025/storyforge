import{afterEach,beforeEach,expect,it,vi}from'vitest'
import{db}from'../../src/lib/db/schema'
import{CONTEXT_SOURCE_BY_KEY}from'../../src/lib/registry/context-sources'
import{assembleContext}from'../../src/lib/registry/assemble-context'
import{hashProductProductionValueV2}from'../../src/lib/product-production/hash'
import{estimateTokens}from'../../src/lib/ai/context-budget'
import{openProductionFixtureV1}from'../helpers/open-ttrpg-production'
import{parseProductProductionBriefV3}from'../../src/lib/product-production/contracts'
import{executeProductProductionCommand}from'../../src/lib/product-production/commands'
import{createProductProductionPlanV3}from'../../src/lib/product-production/plan'
import{runProductProductionUntilBlockedV1}from'../../src/lib/product-production/scheduler'
const key='product-production.ttrpg-open-task-brief'
beforeEach(async()=>{await db.delete();await db.open();vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('No real provider in atomic source fixture')}))})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
async function fixture(large=false){
 const f=await openProductionFixtureV1(),first=f.brief.ttrpgOpen!.settings.openAuthoring.situationTemplates[0]
 first.driverGoal='核对证据'.repeat(large?4900:1500)
 if(large)f.brief.ttrpgOpen!.settings.openAuthoring.situationTemplates=[first,...Array.from({length:4},(_,i)=>({...structuredClone(first),templateKey:`fixture.large.${i}`}))]
 f.brief=parseProductProductionBriefV3(f.brief)
 let p=(await db.productProductions.get(f.productionId))!
 expect((await executeProductProductionCommand({...f,command:{type:'save-brief-revision',commandId:'atomic.fixture.brief',expectedStateRevision:p.stateRevision,parentRevision:p.currentBriefRevision,brief:f.brief}})).ok).toBe(true)
 p=(await db.productProductions.get(f.productionId))!;const row=(await db.productProductionBriefs.where('[productionId+revision]').equals([p.id!,p.currentBriefRevision!]).first())!
 expect((await executeProductProductionCommand({...f,command:{type:'authorize-start',commandId:'atomic.fixture.start',expectedStateRevision:p.stateRevision,briefRevision:row.revision,briefHash:row.briefHash,authorizationNonce:'explicit.synthetic.atomic'}})).ok).toBe(true)
 p=(await db.productProductions.get(f.productionId))!;const plan=await createProductProductionPlanV3({brief:f.brief,briefHash:row.briefHash,buildNumber:1,controlEpoch:p.controlEpoch,ttrpgOpenExecutionProfile:3})
 const result=await runProductProductionUntilBlockedV1({...f,suppliedPlan:plan,executor:async()=>{throw Error('Explicit internal fixture stops after context preparation; no model transport')},capabilityBindings:[{requirementKey:f.brief.capabilityRequirements.find(r=>r.mediaClass==='text')!.requirementKey,adapterId:'configured-text.v1',bindingHash:'a'.repeat(64)}]})
 return{...f,input:{projectId:f.scope.projectId,scope:f.scope,productProductionId:f.productionId,productBuildId:result.buildId,productProductionTaskKey:'ttrpg.open.situation-layer',sourceKeys:[key]}}
}
const rows=async()=>JSON.stringify({productions:await db.productProductions.toArray(),builds:await db.productBuilds.toArray(),briefs:await db.productProductionBriefs.toArray(),runs:await db.agentRuns.toArray(),events:await db.agentRunEvents.toArray(),worlds:await db.worldReleases.toArray()})
it('delivers a valid full author situation policy above8k through the actual registered scoped source, without changing frozen rows',async()=>{
 const f=await fixture(),source=CONTEXT_SOURCE_BY_KEY.get(key)!,text=await source.read(f.input),before=await rows()
 expect(estimateTokens(text)).toBeGreaterThan(8000);expect(estimateTokens(text)).toBeLessThan(25000)
 const assembled=await assembleContext({...f.input,inputBudgetTokens:25000})
 expect(assembled.sourceSnapshots).toEqual([]) // Full delivery uses original source hash; snapshots are reserved for transformed content.
 expect(await hashProductProductionValueV2(assembled.text)).toBe(await hashProductProductionValueV2(text))
 expect(assembled.sourceEvidence?.find(s=>s.key===key)).toMatchObject({status:'included',delivery:'full'})
 expect(assembled.trimmed).toEqual([]);expect(assembled.text).toContain(f.brief.ttrpgOpen!.settings.openAuthoring.situationTemplates[0].driverGoal)
 expect(await rows()).toBe(before);expect(fetch).not.toHaveBeenCalled()
})
it('still rejects a complete atom above the exact request budget before any trimming or model call',async()=>{
 const f=await fixture(),before=await rows();await expect(assembleContext({...f.input,inputBudgetTokens:8000})).rejects.toThrow(/原子来源.*超出预算/);expect(await rows()).toBe(before);expect(fetch).not.toHaveBeenCalled()
})
it('keeps an explicit hard source ceiling even when a caller requests a larger global window',async()=>{
 const f=await fixture(true),source=CONTEXT_SOURCE_BY_KEY.get(key)!,text=await source.read(f.input),before=await rows()
 expect(source.budgetTokens).toBe(100000);expect(estimateTokens(text)).toBeGreaterThan(100000)
 await expect(assembleContext({...f.input,inputBudgetTokens:200000})).rejects.toThrow(/原子来源.*超出预算/);expect(await rows()).toBe(before);expect(fetch).not.toHaveBeenCalled()
})
it('preserves atomic/protected flags, legacy8k and exact owner/hash/Plan guards',async()=>{
 const f=await fixture(),source=CONTEXT_SOURCE_BY_KEY.get(key)!;expect(source).toMatchObject({atomic:true,protectedFromTrim:true});expect(CONTEXT_SOURCE_BY_KEY.get('product-production.brief')!.budgetTokens).toBe(8000)
 await expect(source.read({...f.input,scope:{...f.scope,workId:f.scope.workId!+1}})).rejects.toThrow()
 const build=(await db.productBuilds.get(f.input.productBuildId))!;await db.productBuilds.update(build.id!,{planHash:'e'.repeat(64)})
 await expect(source.read(f.input)).rejects.toThrow(/计划/);expect(fetch).not.toHaveBeenCalled()
})
