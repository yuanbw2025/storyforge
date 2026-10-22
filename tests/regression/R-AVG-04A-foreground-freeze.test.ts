import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../../src/lib/product-production/character-alpha-matting'
import { AVG_RESERVED_MAGENTA_INVARIANT_V1,AVG_RESERVED_MAGENTA_FORBIDDEN_V1 } from '../../src/lib/avg/image-foreground-contract'
import { compileAvgImageProcessingRequirementDeclarations,assertAvgImageProcessingRequirements,
  type AvgImageProcessingPlanV2,type AvgImageProcessingPlan } from '../../src/lib/avg/image-processing-contract'
import { compileAvgVisualPlanningProposalV1,freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { compileAvgVisualPlanningProposalV2 } from '../../src/lib/avg/media-source-v2'
import { freezeAvgVisualPlanningScopeV2 } from '../../src/lib/avg/media-production-v2'
import { parseAvgVisualPlanningBriefV4 } from '../../src/lib/avg/visual-planning-brief'
import { parseAvgVisualPlanningBriefV5 } from '../../src/lib/avg/visual-planning-brief-v5'
import { prepareAvgRawImageRequestFromBatchV1 } from '../../src/lib/avg/media-raw-contract'
import { prepareAvgRawImageRequestFromBatchV2 } from '../../src/lib/avg/media-request-v2'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { prepareAvgVisualImageProcessingV5 } from '../../src/lib/avg/visual-processing-workspace'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import type { AvgVisualRequirementTemplateV1 } from '../../src/lib/avg/visual-planning-contract'

const policy={schema:'storyforge.avg.foreground-policy' as const,version:1 as const,method:'reserved-magenta' as const,
  reservedColor:'#FF00FF' as const,subjectUsesReservedColor:false as const,algorithm:DECLARED_MAGENTA_ALPHA_MATTING_ID_V1,
  declaration:'工程作者明确将品红保留给底色，主体不使用该色；不签真实美术、参考权利或商用验收。'}
const projection=(t:AvgVisualRequirementTemplateV1)=>({...t.parameters,invariants:t.requiredDetails,forbiddenDepictions:t.forbiddenDepictions})
function plan(templates:AvgVisualRequirementTemplateV1[]):AvgImageProcessingPlanV2 {
 const target=templates.find(t=>t.subjectKind==='character')!.parameters
 return {schema:'storyforge.avg.image-processing-plan',version:2,entries:[{requirementKey:target.requirementKey,
  recipe:{schema:'storyforge.avg.image-processing-recipe',version:2,crop:null,width:target.width,height:target.height,
   fit:'contain',anchor:{x:5000,y:5000},background:null,declaration:'独立前景加工和画布适配',foreground:policy}}]}
}
function templatesWithPlan(templates:AvgVisualRequirementTemplateV1[],next:AvgImageProcessingPlan|null,previous?:AvgImageProcessingPlan){
 const requirements=compileAvgImageProcessingRequirementDeclarations(templates.map(projection),next,previous)
 return templates.map((t,i)=>({...t,requiredDetails:requirements[i].invariants,forbiddenDepictions:requirements[i].forbiddenDepictions}))
}
beforeEach(async()=>{await db.delete();await db.open();vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No provider dispatch is authorized by preparation')}))})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()})

describe('AVG foreground declarations frozen before any original image request',()=>{
 it('changes only the selected target and reverses explicit removal without changing references or author details',()=>{
  const f=avgVersionedPlanningFixture(),before=structuredClone(f.versioned.templates),p=plan(before)
  const next=templatesWithPlan(before,p),index=before.findIndex(t=>t.parameters.requirementKey===p.entries[0].requirementKey)
  expect(f.versioned.templates).toEqual(before)
  expect(next[index].requiredDetails).toEqual([...before[index].requiredDetails,AVG_RESERVED_MAGENTA_INVARIANT_V1])
  expect(next[index].forbiddenDepictions).toEqual([...before[index].forbiddenDepictions,AVG_RESERVED_MAGENTA_FORBIDDEN_V1])
  next.forEach((t,i)=>{if(i!==index)expect(t).toEqual(before[i]);expect(t.parameters).toEqual(before[i].parameters);expect(t.allowedReferenceKeys).toEqual(before[i].allowedReferenceKeys)})
  expect(templatesWithPlan(next,p,p)).toEqual(next)
  expect(templatesWithPlan(next,null,p)).toEqual(before)
  // Unowned author text must not disappear just because no recipe is selected.
  expect(templatesWithPlan(next,null)).toEqual(next)
 })
 it('refuses a missing target, an opaque target and a background instead of silently changing consumer scope',()=>{
  const f=avgVersionedPlanningFixture(),p=plan(f.versioned.templates),requirements=f.versioned.templates.map(projection)
  expect(()=>compileAvgImageProcessingRequirementDeclarations(requirements,{...p,entries:[{...p.entries[0],requirementKey:'foreign.target'}]})).toThrow(/需求/)
  const target=requirements.find(r=>r.requirementKey===p.entries[0].requirementKey)!
  expect(()=>compileAvgImageProcessingRequirementDeclarations(requirements.map(r=>r===target?{...r,alpha:'not-required' as const}:r),p)).toThrow(/透明前景/)
  const background=requirements.find(r=>r.mediaKind==='background')!
  expect(()=>compileAvgImageProcessingRequirementDeclarations(requirements,{...p,entries:[{requirementKey:background.requirementKey,recipe:{...p.entries[0].recipe,width:background.width,height:background.height}}]})).toThrow(/透明前景/)
 })
 it('rejects a frozen requirement with either declaration removed without repairing it in the reader',()=>{
  const f=avgVersionedPlanningFixture(),p=plan(f.versioned.templates),requirements=templatesWithPlan(f.versioned.templates,p).map(projection)
  const target=requirements.find(r=>r.requirementKey===p.entries[0].requirementKey)!
  for(const missing of ['invariants','forbiddenDepictions'] as const){
   const changed=requirements.map(r=>r===target?{...r,[missing]:[]}:r),before=structuredClone(changed)
   expect(()=>assertAvgImageProcessingRequirements(p,changed)).toThrow(/冻结/);expect(changed).toEqual(before)
  }
 })
 it.each([4,5] as const)('carries V%s frozen declarations through the actual compiler into exact request text and input hash',async version=>{
  const f=avgVersionedPlanningFixture(),p=plan(f.versioned.templates),templates=templatesWithPlan(f.versioned.templates,p)
  const input={visualBible:f.visualBible,mediaBriefs:f.mediaBriefs,source:f.source}
  const image=await avgVoiceAssemblyFixtureV3(true),capability={...image.capabilities.find(c=>c.mediaClass==='image')!,allowedDataClasses:['image-prompt','avg-authorized-reference']}
  const requestInput={capability,qualityProfile:'prototype' as const,requirementKey:p.entries[0].requirementKey,idempotencyKey:'foreground.freeze.fixture'}
  const prepared=version===4?await (async()=>{
   const old=await compileAvgVisualPlanningProposalV1({...input,scope:await freezeAvgVisualPlanningScopeV1(f.legacy,f.source)})
   const compiled=await compileAvgVisualPlanningProposalV1({...input,scope:await freezeAvgVisualPlanningScopeV1({...f.legacy,templates},f.source)})
   return {old:await prepareAvgRawImageRequestFromBatchV1({...requestInput,batch:old.batch}),next:await prepareAvgRawImageRequestFromBatchV1({...requestInput,batch:compiled.batch})}
  })():await (async()=>{
   const old=await compileAvgVisualPlanningProposalV2({...input,scope:await freezeAvgVisualPlanningScopeV2(f.versioned,f.source)})
   const compiled=await compileAvgVisualPlanningProposalV2({...input,scope:await freezeAvgVisualPlanningScopeV2({...f.versioned,templates},f.source)})
   return {old:await prepareAvgRawImageRequestFromBatchV2({...requestInput,batch:old.batch}),next:await prepareAvgRawImageRequestFromBatchV2({...requestInput,batch:compiled.batch})}
  })()
  expect(prepared.next.request.prompt).toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  expect(prepared.next.request.negativePrompt).toContain(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
  expect(prepared.old.request.prompt).not.toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  expect(prepared.next.request.inputHash).not.toBe(prepared.old.request.inputHash)
  expect(prepared.next.references).toEqual(prepared.old.references)
  expect(fetch).not.toHaveBeenCalled();expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0)
 })
 it('preserves legacy Work JSON and requires actual frozen foreground declarations for a new Work plan',async()=>{
  const f=avgVersionedPlanningFixture(),original=JSON.stringify(f.source)
  expect(JSON.stringify(parseAvgAuthorWorkspaceV1(f.source))).toBe(original)
  const p=plan(f.legacy.templates),prepared=await compileAvgVisualPlanningProposalV1({scope:await freezeAvgVisualPlanningScopeV1(f.legacy,f.source),
   visualBible:f.visualBible,mediaBriefs:f.mediaBriefs,source:f.source})
  const batch=prepared.batch,requirements=compileAvgImageProcessingRequirementDeclarations(batch.requirements,p)
  const workspace={...f.source,mediaBatch:{...batch,requirements},imageProcessing:p}
  expect(parseAvgAuthorWorkspaceV1(JSON.stringify(workspace)).imageProcessing).toEqual(p)
  expect(()=>parseAvgAuthorWorkspaceV1({...workspace,mediaBatch:batch})).toThrow(/冻结/)
  expect(batch.requirements).not.toEqual(requirements)
 })
 it.each([4,5] as const)('rejects a V%s Brief that adds a foreground recipe after the raw scope was frozen',async version=>{
  const f=await avgV5FormalFixture(),p=plan(f.planning.scope.templates),planning=f.planning
  const value=version===5?{...planning,imageProcessing:p}:{...planning,version:4,scope:{...planning.scope,version:1,
   referenceCatalog:planning.scope.referenceCatalog.map(({referenceKey,reference})=>{const {schema:_s,version:_v,contentPolicy:_p,...legacy}=reference;return {referenceKey,reference:legacy}})},imageProcessing:p}
  expect(()=> (version===5?parseAvgVisualPlanningBriefV5:parseAvgVisualPlanningBriefV4)(value)).toThrow(/冻结/)
 })
 it('saves and removes an actual unstarted V5 Brief revision with no Build, Run, network or draft mutation',async()=>{
  const f=await avgV5FormalFixture(),{owner}=f
  // No fake reference bytes: this contract-only pending batch has no references.
  const brief={...f.brief,avgVisualPlanning:{...f.planning,scope:{...f.planning.scope,referenceCatalog:[],templates:f.planning.scope.templates.map(t=>({...t,allowedReferenceKeys:[],requiredReferenceKeys:[]}))}}}
  brief.capabilityRequirements=brief.capabilityRequirements.map(c=>c.mediaClass==='image'?{...c,allowedDataClasses:['image-prompt']}:c)
  brief.externalDataPolicy={...brief.externalDataPolicy,allowedDataClasses:brief.externalDataPolicy.allowedDataClasses.filter(c=>c!=='avg-authorized-reference'),allowReferenceImages:false}
  const accepted=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',
   commandId:'foreground.pending.fixture',expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief:parseProductProductionBriefV3(brief)}})
  expect(accepted.ok).toBe(true)
  const before=await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg']),draft=await readAvgDraftV1(owner.scope),p=plan(brief.avgVisualPlanning.scope.templates)
  const input={scope:owner.scope,productionId:owner.productionId,expectedBriefHash:before.brief!.briefHash,expectedDraftRevision:draft.revision,expectedBuild:null,plan:p}
  const next=await prepareAvgVisualImageProcessingV5(input),parsed=parseProductProductionBriefV3(next.brief!.briefJson)
  expect(next.brief!.revision).toBe(before.brief!.revision+1)
  expect(parsed.avgVisualPlanning!.scope.templates.find(t=>t.parameters.requirementKey===p.entries[0].requirementKey)!.requiredDetails).toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  expect(await readAvgDraftV1(owner.scope)).toEqual(draft)
  expect((await readProductProductionDetailsV1(owner.scope,owner.productionId,['avg'])).briefHistory.find(b=>b.revision===before.brief!.revision)).toEqual(before.brief)
  const identical=await prepareAvgVisualImageProcessingV5({...input,expectedBriefHash:next.brief!.briefHash})
  expect(identical).toEqual(next)
  const removed=await prepareAvgVisualImageProcessingV5({...input,expectedBriefHash:next.brief!.briefHash,plan:null})
  expect(parseProductProductionBriefV3(removed.brief!.briefJson).avgVisualPlanning).toEqual(brief.avgVisualPlanning)
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  expect(await hashProductProductionValueV2(parsed)).toBe(next.brief!.briefHash)
 })
})
