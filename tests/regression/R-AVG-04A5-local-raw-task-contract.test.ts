import { describe, expect, it } from 'vitest'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { evaluateProductProductionAuthorizationReadinessV1, inspectProductProductionCapabilityReadinessV1 } from '../../src/lib/product-production/service'
import { buildAvgVisualPlanningPlanV4, AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from '../../src/lib/avg/visual-planning-plan'
import { avgVisualPlanningTargetKeysV4, type AvgVisualProposalReuseSourceV4 } from '../../src/lib/avg/visual-planning-reuse-contract'
import { avgVisualPlanningBudgetV4, avgVisualPlanningGateIdsV4 } from '../../src/lib/avg/visual-planning-policy'

const hash='a'.repeat(64)
function semanticSource(artifactKey:string):AvgVisualProposalReuseSourceV4{return {schema:'storyforge.avg.visual-proposal-reuse-source',version:1,
  productionKey:'schema-only-history',buildNumber:1,buildRevision:1,controlEpoch:0,briefHash:hash,planHash:hash,
  artifact:{artifactKey,version:1,contentHash:hash},authorReceiptHash:hash,
  proposal:{artifactKey:artifactKey.replace(/^avg\.media\./,'avg.proposal.'),version:1,contentHash:hash},
  producerReceiptHash:hash,requestSnapshotHash:hash,rawResponseHash:hash}}
async function reusedBrief(){
  const {brief}=await avgVisualPlanningFixtureV4('linear')
  brief.avgVisualPlanning!.proposalReuse=avgVisualPlanningTargetKeysV4(brief.avgVisualPlanning!.scope).map(semanticSource)
  brief.capabilityRequirements=brief.capabilityRequirements.map(c=>c.mediaClass==='text'?{...c,required:false}:c)
  brief.productionBudget=avgVisualPlanningBudgetV4(brief);brief.completionContract.requiredGateIds=avgVisualPlanningGateIdsV4(brief)
  return parseProductProductionBriefV3(brief)
}
function readiness(){
  const base=inspectProductProductionCapabilityReadinessV1({projectId:1})
  return {...base,text:{...base.text,ready:false,issue:'unused-text-provider-unavailable'},
    image:{...base.image,ready:true,credentialPresent:true,issue:null}}
}

describe('AVG local raw revalidation shared authorization and Plan boundary',()=>{
  it('honors a valid reused V4 zero-text policy while still requiring the actual image provider',async()=>{
    const brief=await reusedBrief(),available=readiness()
    expect(brief.productionBudget.maximumModelCalls).toBe(0);expect(brief.productionBudget.maximumMediaCalls).toBe(1)
    expect(evaluateProductProductionAuthorizationReadinessV1({brief,readiness:available})).toMatchObject({ready:true,blockerMessages:[],requiredMediaRequirementKeys:['avg.media.image']})
    const blocked=evaluateProductProductionAuthorizationReadinessV1({brief,readiness:{...available,image:{...available.image,ready:false,issue:'required-image-unavailable'}}})
    expect(blocked.ready).toBe(false);expect(blocked.blockerMessages).toEqual(['required-image-unavailable'])
  })
  it('keeps required V4 text and legacy generic text gates, and rejects a forged optional flag before authorization',async()=>{
    const {brief}=await avgVisualPlanningFixtureV4('linear'),available=readiness()
    expect(evaluateProductProductionAuthorizationReadinessV1({brief,readiness:available}).blockerMessages).toContain('unused-text-provider-unavailable')
    brief.capabilityRequirements=brief.capabilityRequirements.map(c=>c.mediaClass==='text'?{...c,required:false}:c)
    expect(()=>parseProductProductionBriefV3(brief)).toThrow()
    const valid=await reusedBrief()
    expect(evaluateProductProductionAuthorizationReadinessV1({brief:{capabilityRequirements:valid.capabilityRequirements},readiness:available}).ready).toBe(false)
  })
  async function localPlan(){
    const {brief}=await avgVisualPlanningFixtureV4('linear'),briefHash=await hashProductProductionValueV2(brief)
    const plan=buildAvgVisualPlanningPlanV4({brief:{...brief,avgVisualPlanning:brief.avgVisualPlanning!},briefHash,buildNumber:1,controlEpoch:0})
    const task=plan.tasks.find(t=>t.kind==='avg-media-image-generate')!
    Object.assign(task,{kind:'avg-media-image-reuse',executionMode:'deterministic',skillId:null,contextProfile:'avg-visual-planning-v4',capabilityRequirementKeys:[],maxAttempts:1,reuse:null})
    task.budgetReservation={...task.budgetReservation,modelCalls:0,mediaCalls:0,maximumCostUsd:0}
    return {brief,briefHash,plan,task}
  }
  it('admits only a bounded compiled-image revalidation shape and never reinterprets an already authorized provider Brief',async()=>{
    const {brief,briefHash,plan,task}=await localPlan()
    expect(parseProductProductionPlanV3(plan,undefined,briefHash).tasks.find(t=>t.taskKey===task.taskKey)).toMatchObject({
      kind:'avg-media-image-reuse',executionMode:'deterministic',contextProfile:'avg-visual-planning-v4',capabilityRequirementKeys:[],
      budgetReservation:{modelCalls:0,mediaCalls:0,maximumCostUsd:0}})
    // Structural admission is not a new frozen Brief, executor or receipt.
    expect(()=>parseProductProductionPlanV3(plan,brief,briefHash)).toThrow()
  })
  it.each(['foreign-product','model','media-provider','skill','capability','model-budget','media-budget','unknown-cash','retry','missing-compilation','missing-compiler-dependency','wrong-task-namespace'] as const)('rejects %s in the V4 local image context',async invalid=>{
    const {briefHash,plan,task}=await localPlan()
    if(invalid==='foreign-product')plan.productType='text-adventure'
    if(invalid==='model'||invalid==='media-provider')task.executionMode=invalid
    if(invalid==='skill')task.skillId='avg.compiled-image-request.v1'
    if(invalid==='capability')task.capabilityRequirementKeys=['avg.media.image']
    if(invalid==='model-budget')task.budgetReservation.modelCalls=1
    if(invalid==='media-budget')task.budgetReservation.mediaCalls=1
    if(invalid==='unknown-cash')task.budgetReservation.maximumCostUsd=null
    if(invalid==='retry')task.maxAttempts=2
    if(invalid==='missing-compilation')task.inputArtifactKeys=task.inputArtifactKeys.filter(k=>k!==AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4)
    if(invalid==='missing-compiler-dependency'){
      const compiler=plan.tasks.find(t=>t.outputArtifactKeys.includes(AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4))!
      task.dependsOn=task.dependsOn.filter(k=>k!==compiler.taskKey);task.requiredReceipts=task.requiredReceipts.filter(r=>r.taskKey!==compiler.taskKey)
    }
    if(invalid==='wrong-task-namespace'){
      const key=task.taskKey;task.taskKey='arbitrary.local.image'
      for(const t of plan.tasks){t.dependsOn=t.dependsOn.map(k=>k===key?task.taskKey:k);t.requiredReceipts=t.requiredReceipts.map(r=>r.taskKey===key?{...r,taskKey:task.taskKey}:r)}
    }
    expect(()=>parseProductProductionPlanV3(plan,undefined,briefHash)).toThrow()
  })
})
