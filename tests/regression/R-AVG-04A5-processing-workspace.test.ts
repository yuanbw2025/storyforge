import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as readiness from '../../src/lib/avg/visual-planning-brief'
import {avgVisualPlanningFixtureV4} from '../helpers/avg-visual-planning-fixture'
import {avgImageProcessingRecipeFixture} from '../helpers/avg-image-processing-fixture'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {readProductProductionDetailsV1} from '../../src/lib/product-production/service'
import {prepareAvgVisualImageProcessingV4} from '../../src/lib/avg/visual-processing-workspace'
import {readAvgDraftV1} from '../../src/lib/avg/draft-service'
import {exportProjectJSON} from '../../src/lib/export/json-export'
import type {AvgImageProcessingPlanV1} from '../../src/lib/avg/image-processing-contract'

beforeEach(async()=>{await db.delete();await db.open();vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV4').mockReturnValue(true)})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close()})
async function pending(){
 const f=await avgVisualPlanningFixtureV4('linear'),{owner}=f
 const saved=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',commandId:'processing.preflight.fixture',
  expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief:f.brief}})
 expect(saved.ok).toBe(true)
 const d=await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg']),draft=await readAvgDraftV1(owner.scope)
 const plan:AvgImageProcessingPlanV1={schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:f.planning.scope.templates[0].parameters.requirementKey,recipe:avgImageProcessingRecipeFixture()}]}
 const dispatch=vi.fn(async()=>{throw new Error('No request is authorized by recipe preparation')});vi.stubGlobal('fetch',dispatch)
 return {owner,plan,dispatch,input:{scope:owner.scope,productionId:owner.productionId,expectedBriefHash:d.brief!.briefHash,expectedDraftRevision:draft.revision,expectedBuild:null,plan}}
}
const bytes=(value:Awaited<ReturnType<typeof exportProjectJSON>>)=>({...value,exportedAt:0})
describe('AVG V4 actual pending processing recipe preflight',()=>{
 it.each(['empty','foreign-requirement','duplicate','undersized','wrong-aspect','out-of-bounds-crop','unknown-field'] as const)('rejects %s without mutating the Brief, draft or production evidence',async mode=>{
  const s=await pending(),p=structuredClone(s.plan)
  if(mode==='empty')p.entries=[]
  if(mode==='foreign-requirement')p.entries[0].requirementKey='foreign.requirement'
  if(mode==='duplicate')p.entries.push(structuredClone(p.entries[0]))
  if(mode==='undersized')p.entries[0].recipe.width=288
  if(mode==='wrong-aspect')p.entries[0].recipe.height=576
  if(mode==='out-of-bounds-crop')p.entries[0].recipe.crop={x:9000,y:0,width:5000,height:10000}
  const invalid=mode==='unknown-field'?{...p,providerRepair:true}:p,before=bytes(await exportProjectJSON(s.owner.scope.projectId))
  await expect(prepareAvgVisualImageProcessingV4({...s.input,plan:invalid as AvgImageProcessingPlanV1})).rejects.toThrow()
  expect(bytes(await exportProjectJSON(s.owner.scope.projectId))).toEqual(before)
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(s.dispatch).not.toHaveBeenCalled()
 })
 it.each(['brief','draft','unexpected-build','disabled'] as const)('refuses stale or unauthorized %s input without a new command or request',async mode=>{
  const s=await pending(),before=bytes(await exportProjectJSON(s.owner.scope.projectId)),input={...s.input}
  if(mode==='brief')input.expectedBriefHash='f'.repeat(64)
  if(mode==='draft')input.expectedDraftRevision++
  if(mode==='disabled')vi.mocked(readiness.avgVisualPlanningExecutionReadyV4).mockReturnValue(false)
  await expect(prepareAvgVisualImageProcessingV4({...input,...(mode==='unexpected-build'?{expectedBuild:{id:999999,revision:0}}:{})})).rejects.toThrow(/已变化/)
  expect(bytes(await exportProjectJSON(s.owner.scope.projectId))).toEqual(before);expect(s.dispatch).not.toHaveBeenCalled()
 })
 it('treats an identical saved recipe as readback and clearing as an explicit new Brief revision',async()=>{
  const s=await pending(),first=await prepareAvgVisualImageProcessingV4(s.input),savedInput={...s.input,expectedBriefHash:first.brief!.briefHash}
  const before=bytes(await exportProjectJSON(s.owner.scope.projectId))
  expect(await prepareAvgVisualImageProcessingV4(savedInput)).toEqual(first)
  expect(bytes(await exportProjectJSON(s.owner.scope.projectId))).toEqual(before)
  const removed=await prepareAvgVisualImageProcessingV4({...savedInput,plan:null})
  expect(removed.brief!.revision).toBe(first.brief!.revision+1)
  expect(JSON.parse(removed.brief!.briefJson).avgVisualPlanning.imageProcessing).toBeUndefined()
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(s.dispatch).not.toHaveBeenCalled()
 })
})
