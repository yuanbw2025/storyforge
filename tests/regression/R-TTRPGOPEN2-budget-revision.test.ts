import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {openProductionFixtureV1} from '../helpers/open-ttrpg-production'
import * as commands from '../../src/lib/product-production/commands'
import {stopProductProductionV1} from '../../src/lib/product-production/service'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {runProductProductionUntilBlockedV1,ProductProductionResultUnknownErrorV1} from '../../src/lib/product-production/scheduler'
import {inspectTtrpgOpenProductionBudgetRevisionV1 as inspect,prepareTtrpgOpenProductionBudgetRevisionV1 as prepare,
 saveTtrpgOpenProductionBudgetRevisionV1 as save} from '../../src/lib/ttrpg/open-production-budget-revision'
beforeEach(async()=>{await db.delete();await db.open();vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('No real transport permitted in budget fixture')}))})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
const values={maximumModelCalls:16,maximumInputTokens:384000,maximumOutputTokens:60000}
async function fixture(stop=true,twoUnknown=false,execute=true){
 const f=await openProductionFixtureV1();f.brief.productionBudget={...f.brief.productionBudget,maximumModelCalls:16,maximumInputTokens:192000,maximumOutputTokens:60000,maximumDurationMs:3600000,maximumMediaCalls:0}
 let p=(await db.productProductions.get(f.productionId))!
 expect((await commands.executeProductProductionCommand({scope:f.scope,productionId:f.productionId,command:{type:'save-brief-revision',commandId:'budget.fixture.brief',expectedStateRevision:p.stateRevision,parentRevision:p.currentBriefRevision,brief:f.brief}})).ok).toBe(true)
 p=(await db.productProductions.get(f.productionId))!;const row=(await db.productProductionBriefs.where('[productionId+revision]').equals([p.id!,p.currentBriefRevision!]).first())!
 expect((await commands.executeProductProductionCommand({scope:f.scope,productionId:f.productionId,command:{type:'authorize-start',commandId:'budget.fixture.start',expectedStateRevision:p.stateRevision,briefRevision:row.revision,briefHash:row.briefHash,authorizationNonce:'explicit.synthetic.author'}})).ok).toBe(true)
 p=(await db.productProductions.get(f.productionId))!
 const suppliedPlan=await createProductProductionPlanV3({brief:f.brief,briefHash:row.briefHash,buildNumber:1,controlEpoch:p.controlEpoch,ttrpgOpenExecutionProfile:2})
 const stopped=execute?await runProductProductionUntilBlockedV1({...f,suppliedPlan,executor:async()=>{throw new ProductProductionResultUnknownErrorV1()},capabilityBindings:[{requirementKey:f.brief.capabilityRequirements.find(x=>x.mediaClass==='text')!.requirementKey,adapterId:'configured-text.v1',bindingHash:'a'.repeat(64)}]}):{buildId:(await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId,1]).first())!.id!}
 if(twoUnknown){
  // Explicit legacy/crash fixture: another retained unobserved reservation,
  // not a second proven provider call or a claim of native execution.
  const build=(await db.productBuilds.get(stopped.buildId))!,ledger=JSON.parse(build.budgetLedgerJson),entry={...structuredClone(ledger.attempts[0]),attempt:2,idempotencyKey:'b'.repeat(64)}
  ledger.attempts.push(entry);ledger.tasks[entry.taskKey]={...ledger.tasks[entry.taskKey],attempt:2,idempotencyKey:entry.idempotencyKey}
  await db.productBuilds.update(build.id!,{budgetLedgerJson:JSON.stringify(ledger)})
 }
 if(stop)await stopProductProductionV1({scope:f.scope,production:(await db.productProductions.get(f.productionId))!})
 return{...f,buildId:stopped.buildId,row}
}
async function immutable(f:Awaited<ReturnType<typeof fixture>>){return JSON.stringify({world:await db.worldReleases.toArray(),build:await db.productBuilds.get(f.buildId),runs:await db.agentRuns.toArray(),events:await db.agentRunEvents.toArray(),raw:await db.agentRunArtifacts.toArray(),brief:await db.productProductionBriefs.get(f.row.id!)})}

it('previews a real new V3 Plan without mutation and preserves two unresolved legacy reservations as unknown',async()=>{
 const f=await fixture(true,true),before=await immutable(f),inspected=await inspect(f),prods=JSON.stringify(await db.productProductions.toArray()),briefs=JSON.stringify(await db.productProductionBriefs.toArray())
 expect(JSON.parse((await db.productBuilds.get(f.buildId))!.budgetLedgerJson).attempts.filter((a:{usageKnown:boolean})=>!a.usageKnown)).toHaveLength(2)
 const proposal=await prepare({owner:inspected.owner,values})
 expect(proposal.previewPlan.tasks.filter(t=>t.executionMode==='model').map(t=>t.budgetReservation.inputTokens)).toEqual([96000,128000,160000])
 expect(proposal.previewPlan.tasks.filter(t=>t.executionMode==='model').map(t=>t.timeoutMs)).toEqual([600000,600000,600000])
 const prior=structuredClone(proposal.brief);prior.productionBudget={...prior.productionBudget,maximumInputTokens:192000};expect(prior).toEqual(f.brief)
 expect(await immutable(f)).toBe(before);expect(JSON.stringify(await db.productProductions.toArray())).toBe(prods);expect(JSON.stringify(await db.productProductionBriefs.toArray())).toBe(briefs)
 expect(globalThis.fetch).not.toHaveBeenCalled()
},30000)

it('saves a new Brief on the same stopped lineage once, without new Build/Run/start or rewriting old costs',async()=>{
 const f=await fixture(true,true),owner=(await inspect(f)).owner,before=await immutable(f),count=await db.productProductionBriefs.count(),result=await save({owner,values,commandId:'budget.author.save'})
 expect(result.receipt.ok).toBe(true);expect(result.details.production.status).toBe('brief-ready');expect(result.details.brief!.parentRevision).toBe(owner.briefRevision)
 expect(result.details.executionBrief!.productionBudget.maximumInputTokens).toBe(384000)
 expect(await db.productProductionBriefs.count()).toBe(count+1);expect(await db.productBuilds.count()).toBe(1);expect(await immutable(f)).toBe(before)
 const revision=result.details.production.stateRevision;await save({owner,values,commandId:'budget.author.save'})
 expect((await db.productProductions.get(f.productionId))!.stateRevision).toBe(revision);expect(await db.productProductionBriefs.count()).toBe(count+1)
 expect(globalThis.fetch).not.toHaveBeenCalled()
},30000)

it('requires separate author start; the next actual Build uses the current profile while the old V2 Plan stays exact',async()=>{
 const f=await fixture(),owner=(await inspect(f)).owner,before=await immutable(f),saved=await save({owner,values,commandId:'budget.separate.save'}),p=saved.details.production,row=saved.details.brief!
 expect((await commands.executeProductProductionCommand({scope:f.scope,productionId:f.productionId,command:{type:'authorize-start',commandId:'budget.separate.start',expectedStateRevision:p.stateRevision,briefRevision:row.revision,briefHash:row.briefHash,authorizationNonce:'explicit.new.fixture.author'}})).ok).toBe(true)
 const builds=await db.productBuilds.where('productionId').equals(f.productionId).toArray();expect(builds).toHaveLength(2);const next=builds.find(b=>b.id!==f.buildId)!
 expect(next.status).toBe('authorized');expect(next.planRevision).toBe(0)
 const current=JSON.parse(await immutable(f)),prior=JSON.parse(before)
 expect(current.brief).toEqual({...prior.brief,status:'superseded'})
 current.brief.status=prior.brief.status;expect(current).toEqual(prior)
 const projection=await runProductProductionUntilBlockedV1({...f,executor:async()=>{throw new ProductProductionResultUnknownErrorV1()},capabilityBindings:[{requirementKey:f.brief.capabilityRequirements.find(x=>x.mediaClass==='text')!.requirementKey,adapterId:'configured-text.v1',bindingHash:'a'.repeat(64)}]})
 const plan=JSON.parse((await db.productBuilds.get(projection.buildId))!.planJson);expect(plan.tasks[0].skillId).toContain('.v3');expect(plan.tasks[0].budgetReservation.inputTokens).toBe(96000)
 expect((await db.productBuilds.get(f.buildId))!.planJson).toBe(JSON.parse(before).build.planJson);expect(globalThis.fetch).not.toHaveBeenCalled()
},30000)

it('rejects missing/cross Work, non-stopped source and stale owner before any revision is written',async()=>{
 const f=await fixture(false);await expect(inspect(f)).rejects.toThrow('停止')
 await stopProductProductionV1({scope:f.scope,production:(await db.productProductions.get(f.productionId))!})
 const owner=(await inspect(f)).owner
 await expect(inspect({...f,scope:{...f.scope,workId:null}})).rejects.toThrow('明确')
 await expect(inspect({...f,scope:{...f.scope,workId:f.scope.workId!+1}})).rejects.toThrow()
 const count=await db.productProductionBriefs.count();await db.productProductions.update(f.productionId,{stateRevision:owner.expectedStateRevision+1})
 await expect(prepare({owner,values})).rejects.toThrow('变化');expect(await db.productProductionBriefs.count()).toBe(count)
},30000)

it('rejects malformed caps, extra policy fields, and an impossible Plan without changing source or spawning execution',async()=>{
 const f=await fixture(),owner=(await inspect(f)).owner,before=await immutable(f),count=await db.productProductionBriefs.count()
 for(const invalid of [{...values,maximumInputTokens:0},{...values,maximumOutputTokens:-1},{...values,maximumModelCalls:1.5},{...values,maximumModelCalls:1},{...values,maximumInputTokens:1000000001},{...values,maximumCostUsd:0}]){
  await expect(prepare({owner,values:invalid as typeof values})).rejects.toThrow()
 }
 expect(await immutable(f)).toBe(before);expect(await db.productProductionBriefs.count()).toBe(count)
},30000)

it('does not normalize a changed frozen Brief into a new author authority',async()=>{
 const f=await fixture(),owner=(await inspect(f)).owner,changed=structuredClone(f.brief);changed.productionBudget.maximumInputTokens+=1
 await db.productProductionBriefs.update(f.row.id!,{briefJson:JSON.stringify(changed)})
 const before=await immutable(f);await expect(prepare({owner,values})).rejects.toThrow('不可核对');expect(await immutable(f)).toBe(before)
},30000)

it('recovers a successful save with lost return through the exact original command, without another revision',async()=>{
 const f=await fixture(),owner=(await inspect(f)).owner,actual=commands.executeProductProductionCommand
 let lost=false
 vi.spyOn(commands,'executeProductProductionCommand').mockImplementation(async input=>{const result=await actual(input);if(!lost&&input.command.type==='save-brief-revision'){lost=true;throw Error('fixture committed save reply lost')}return result})
 const count=await db.productProductionBriefs.count();await expect(save({owner,values,commandId:'budget.lost.return'})).rejects.toThrow('reply lost')
 const revision=(await db.productProductions.get(f.productionId))!.stateRevision;expect((await save({owner,values,commandId:'budget.lost.return'})).receipt.ok).toBe(true)
 expect(await db.productProductionBriefs.count()).toBe(count+1);expect((await db.productProductions.get(f.productionId))!.stateRevision).toBe(revision);expect(globalThis.fetch).not.toHaveBeenCalled()
},30000)

it('cannot reuse a saved command for different caps or concurrently save two author revisions',async()=>{
 const f=await fixture(),owner=(await inspect(f)).owner,count=await db.productProductionBriefs.count()
 const results=await Promise.allSettled([save({owner,values,commandId:'budget.concurrent.a'}),save({owner,values,commandId:'budget.concurrent.b'})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await db.productProductionBriefs.count()).toBe(count+1)
 const id=results[0].status==='fulfilled'?'budget.concurrent.a':'budget.concurrent.b'
 await expect(save({owner,values:{...values,maximumInputTokens:400000},commandId:id})).rejects.toThrow('另一份');expect(await db.productProductionBriefs.count()).toBe(count+1)
},30000)

// Old ledger formats remain under the existing shared validator. The consumer
// never reinterprets historical reservations into physical calls or zero cost.
it('accepts a stopped never-started Build with the original empty ledger, without inventing a reservation',async()=>{
 const f=await fixture(true,false,false),before=await immutable(f),owner=(await inspect(f)).owner
 expect((await db.productBuilds.get(f.buildId))!.budgetLedgerJson).toBe('{}')
 expect((await prepare({owner,values})).brief.productionBudget.maximumInputTokens).toBe(384000)
 await save({owner,values,commandId:'budget.empty.original'})
 expect(await immutable(f)).toBe(before);expect(await db.agentRuns.count()).toBe(0);expect(globalThis.fetch).not.toHaveBeenCalled()
},30000)
it('keeps the exact valid legacy V1 ledger instead of copying its conversion into the budget UI',async()=>{
 const f=await fixture(),build=(await db.productBuilds.get(f.buildId))!,ledger=JSON.parse(build.budgetLedgerJson)
 delete ledger.attempts;ledger.version=1;await db.productBuilds.update(f.buildId,{budgetLedgerJson:JSON.stringify(ledger)})
 const before=await immutable(f),owner=(await inspect(f)).owner
 await save({owner,values,commandId:'budget.legacy.original'});expect(await immutable(f)).toBe(before)
 expect(JSON.parse((await db.productBuilds.get(f.buildId))!.budgetLedgerJson).version).toBe(1);expect(globalThis.fetch).not.toHaveBeenCalled()
},30000)
