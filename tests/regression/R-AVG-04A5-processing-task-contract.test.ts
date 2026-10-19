import { describe,expect,it } from 'vitest'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { buildAvgVisualPlanningPlanV4,AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from '../../src/lib/avg/visual-planning-plan'
import type { ProductProductionPlanTaskV3 } from '../../src/lib/types'

async function processingPlan(){
  const {brief}=await avgVisualPlanningFixtureV4('linear'),briefHash=await hashProductProductionValueV2(brief)
  const plan=buildAvgVisualPlanningPlanV4({brief:{...brief,avgVisualPlanning:brief.avgVisualPlanning!},briefHash,buildNumber:1,controlEpoch:0})
  const raw=plan.tasks.find(t=>t.kind==='avg-media-image-generate')!,requirementKey=raw.taskKey.slice('avg.media.generate.'.length)
  const task:ProductProductionPlanTaskV3={...structuredClone(raw),taskKey:`avg.media.process.${requirementKey}`,kind:'avg-media-image-process',executionMode:'deterministic',
    skillId:null,contextProfile:'avg-visual-planning-v4' as const,capabilityRequirementKeys:[],maxAttempts:1,reuse:null,
    inputArtifactKeys:[...raw.inputArtifactKeys,...raw.outputArtifactKeys],outputArtifactKeys:[`avg.media.processed.${requirementKey}`],
    dependsOn:[...raw.dependsOn,raw.taskKey],requiredReceipts:[...raw.requiredReceipts,{taskKey:raw.taskKey,receiptHash:null}],
    budgetReservation:{...raw.budgetReservation,modelCalls:0,mediaCalls:0,maximumCostUsd:0}}
  plan.tasks.splice(plan.tasks.indexOf(raw)+1,0,task)
  const review=plan.tasks.find(t=>t.kind==='avg-author-visual-review')!
  review.inputArtifactKeys.push(...task.outputArtifactKeys);review.dependsOn.push(task.taskKey);review.requiredReceipts.push({taskKey:task.taskKey,receiptHash:null})
  return {brief,briefHash,plan,task,raw}
}

describe('AVG V4 shared local processing Plan boundary',()=>{
  it('admits a bounded compiler-and-raw processing shape without changing an already frozen non-processing Brief',async()=>{
    const {brief,briefHash,plan,task}=await processingPlan()
    expect(parseProductProductionPlanV3(plan,undefined,briefHash).tasks.find(t=>t.taskKey===task.taskKey)).toMatchObject({
      kind:'avg-media-image-process',executionMode:'deterministic',contextProfile:'avg-visual-planning-v4',capabilityRequirementKeys:[],
      budgetReservation:{modelCalls:0,mediaCalls:0,maximumCostUsd:0}})
    // A structural task shape alone does not add a recipe, current writer,
    // accepted producer or permission to rewrite an authorized old Plan.
    expect(()=>parseProductProductionPlanV3(plan,brief,briefHash)).toThrow()
  })
  it.each(['foreign-product','model','skill','capability','model-budget','media-budget','unknown-cash','retry','compiler-input','compiler-dependency','raw-input','raw-dependency'] as const)('rejects %s in a local V4 processing task',async invalid=>{
    const {briefHash,plan,task,raw}=await processingPlan()
    if(invalid==='foreign-product')plan.productType='text-adventure'
    if(invalid==='model')task.executionMode='model'
    if(invalid==='skill')task.skillId='avg.compiled-image-request.v1'
    if(invalid==='capability')task.capabilityRequirementKeys.push('avg.media.image')
    if(invalid==='model-budget')task.budgetReservation.modelCalls=1
    if(invalid==='media-budget')task.budgetReservation.mediaCalls=1
    if(invalid==='unknown-cash')task.budgetReservation.maximumCostUsd=null
    if(invalid==='retry')task.maxAttempts=2
    if(invalid==='compiler-input')task.inputArtifactKeys=task.inputArtifactKeys.filter(k=>k!==AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4)
    if(invalid==='compiler-dependency'){
      const compiler=plan.tasks.find(t=>t.outputArtifactKeys.includes(AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4))!
      task.dependsOn=task.dependsOn.filter(k=>k!==compiler.taskKey);task.requiredReceipts=task.requiredReceipts.filter(r=>r.taskKey!==compiler.taskKey)
    }
    if(invalid==='raw-input')task.inputArtifactKeys=task.inputArtifactKeys.filter(k=>!raw.outputArtifactKeys.includes(k))
    if(invalid==='raw-dependency'){
      task.dependsOn=task.dependsOn.filter(k=>k!==raw.taskKey);task.requiredReceipts=task.requiredReceipts.filter(r=>r.taskKey!==raw.taskKey)
    }
    expect(()=>parseProductProductionPlanV3(plan,undefined,briefHash)).toThrow()
  })
})
