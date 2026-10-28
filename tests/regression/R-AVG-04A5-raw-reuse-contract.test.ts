import { describe,expect,it } from 'vitest'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgVisualPlanningBudgetV4,avgVisualPlanningGateIdsV4 } from '../../src/lib/avg/visual-planning-policy'
import { buildAvgVisualPlanningPlanV4 } from '../../src/lib/avg/visual-planning-plan'
import type { AvgVisualRawReuseSourceV4 } from '../../src/lib/avg/visual-image-reuse-contract'

const hash='a'.repeat(64)
async function fixture(){
  const {brief}=await avgVisualPlanningFixtureV4('linear'),key=brief.avgVisualPlanning!.scope.templates[0].parameters.requirementKey
  const source:AvgVisualRawReuseSourceV4={schema:'storyforge.avg.visual-raw-reuse-source',version:1,
    productionKey:'schema-only-not-authority',requirementKey:key,sourceWorldContentHash:brief.source.worldContentHash,
    compilation:{artifactKey:'avg.media.compiled-visual-requirements',version:1,contentHash:hash},requirementHash:hash,semanticRequirementHash:hash,
    raw:{schema:'storyforge.avg.visual-image-producer-proof',version:4,buildNumber:1,briefHash:hash,planHash:hash,controlEpoch:0,
      taskKey:`avg.media.generate.${key}`,artifactKey:`avg.media.raw.${key}`,artifactVersion:1,contentHash:hash,inputHash:hash,
      producerReceiptHash:hash,candidateHash:hash,responseEvidenceHash:hash,proofHash:hash}}
  return {brief,source,key}
}
function withSources(brief:Awaited<ReturnType<typeof fixture>>['brief'],sources:AvgVisualRawReuseSourceV4[]){
  const next={...brief,avgVisualPlanning:{...brief.avgVisualPlanning!,rawReuse:sources},
    capabilityRequirements:brief.capabilityRequirements.map(c=>c.mediaClass==='image'?{...c,required:sources.length<brief.avgVisualPlanning!.scope.templates.length}:c)}
  next.productionBudget=avgVisualPlanningBudgetV4(next)
  next.capabilityRequirements=next.capabilityRequirements.map(c=>({...c,maximumTotalCost:next.productionBudget.maximumCostUsd}))
  next.completionContract={...next.completionContract,requiredGateIds:avgVisualPlanningGateIdsV4(next)}
  return next
}
describe('AVG V4 frozen raw reuse topology is actual zero-call policy',()=>{
  it('freezes one local image revalidation instead of charging or binding that provider task',async()=>{
    const {brief,source,key}=await fixture(),next=parseProductProductionBriefV3(withSources(brief,[source]))
    expect(next.productionBudget.maximumMediaCalls).toBe(0)
    expect(next.capabilityRequirements.find(c=>c.mediaClass==='image')!.required).toBe(false)
    const briefHash=await hashProductProductionValueV2(next),plan=buildAvgVisualPlanningPlanV4({brief:{...next,avgVisualPlanning:next.avgVisualPlanning!},briefHash,buildNumber:2,controlEpoch:0})
    const task=plan.tasks.find(t=>t.taskKey===`avg.media.generate.${key}`)!
    expect(task).toMatchObject({kind:'avg-media-image-reuse',executionMode:'deterministic',skillId:null,contextProfile:'avg-visual-planning-v4',
      capabilityRequirementKeys:[],maxAttempts:1,reuse:null,budgetReservation:{modelCalls:0,mediaCalls:0,maximumCostUsd:0}})
    expect(plan.tasks.some(t=>t.executionMode==='media-provider')).toBe(false)
    expect(parseProductProductionPlanV3(plan,next,briefHash)).toEqual(plan)
    expect(()=>buildAvgVisualPlanningPlanV4({brief:{...next,avgVisualPlanning:next.avgVisualPlanning!},briefHash,buildNumber:1,controlEpoch:0})).toThrow()
  })
  it('keeps old no-reuse Brief and Plan bytes and required image policy unchanged',async()=>{
    const {brief}=await fixture(),bytes=canonicalProductProductionJsonV2(brief)
    expect(canonicalProductProductionJsonV2(parseProductProductionBriefV3(brief))).toBe(bytes)
    expect(brief.productionBudget.maximumMediaCalls).toBe(1)
    expect(()=>parseProductProductionBriefV3({...brief,capabilityRequirements:brief.capabilityRequirements.map(c=>c.mediaClass==='image'?{...c,required:false}:c)})).toThrow()
  })
  it.each(['empty','duplicate','foreign-requirement','original-proof-version'] as const)('rejects %s source metadata before authorization',async mode=>{
    const {brief,source}=await fixture(),sources=mode==='empty'?[]:mode==='duplicate'?[source,source]:mode==='foreign-requirement'
      ?[{...source,requirementKey:'outside.batch'}]:[{...source,raw:{...source.raw,version:3}}]
    expect(()=>withSources(brief,sources as AvgVisualRawReuseSourceV4[])).toThrow()
  })
})
