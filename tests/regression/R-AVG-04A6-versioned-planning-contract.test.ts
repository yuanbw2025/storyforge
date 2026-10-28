import { describe,expect,it } from 'vitest'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { compileAvgVisualPlanningProposalV1,freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { assertAvgVisualPlanningProposalV2,compileAvgVisualPlanningProposalV2,freezeAvgVisualPlanningScopeV2,
  freezeAvgVisualProductionBatchV2,validateAvgVisualProductionBatchSourceV2 } from '../../src/lib/avg/media-production-v2'
import { parseAvgVisualPlanningScopeV1 } from '../../src/lib/avg/visual-planning-contract'
import { parseAvgVisualPlanningScopeV2 } from '../../src/lib/avg/visual-planning-contract-v2'
import { parseAvgVisualProductionBatchV1 } from '../../src/lib/avg/media-production-contract'
import { parseAvgVisualProductionBatchV2 } from '../../src/lib/avg/media-production-contract-v2'
import { composeAvgCharacterFamilyRequirementsV2,hashAvgCharacterFamilyProposalV2,parseAvgCharacterFamilyPlanV2,
  type AvgCharacterFamilyPlanV2 } from '../../src/lib/avg/character-family-contract-v2'
import { parseAvgCharacterFamilyPlanV1 } from '../../src/lib/avg/character-family-contract'
import { prepareAvgRawImageRequestFromBatchV2 } from '../../src/lib/avg/media-production-v2'
import { prepareAvgRawImageRequestFromBatchV1 } from '../../src/lib/avg/media-raw-contract'
import { avgImageReferenceCapabilityV2,assertAvgImageRequestV1 } from '../../src/lib/avg/media-reference-contract'
import { assertAvgImageRequestV2 } from '../../src/lib/avg/media-reference-contract-v2'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { ProviderCapabilityRequirementV1 } from '../../src/lib/types'

async function fixture(){const s=avgVersionedPlanningFixture();return {...s,scope:await freezeAvgVisualPlanningScopeV2(s.versioned,s.source)}}
async function capability():Promise<ProviderCapabilityRequirementV1>{return {requirementKey:'avg.media.image',mediaClass:'image',operation:'generate',
  adapterFamily:'agnes-image-reference',minimumCapabilityVersion:'1',allowedDataClasses:['avg-authorized-reference'],maximumRequestCost:null,maximumTotalCost:null,
  rightsPolicyVersion:'controlled-reference.v2',capabilityHash:await hashProductProductionValueV2(avgImageReferenceCapabilityV2('agnes.image-2.5-flash.v1')),required:true}}
async function family(){
  const s=avgVersionedPlanningFixture(),actor=s.versioned.templates.filter(t=>t.subjectKind==='character')
  const plan:AvgCharacterFamilyPlanV2={schema:'storyforge.avg.character-family-plan',version:2,familyKey:'keeper',revision:2,
    subjectKey:actor[0].parameters.family.subjectKey,name:'保管员',baseline:s.versioned.referenceCatalog.find(r=>r.reference.purpose==='identity')!.reference,
    stylePrompt:'原创受控人物',identityInvariants:['脸部比例与服装保持'],negativePrompt:'发光按钮',forbiddenDepictions:['蜡封信件'],allowedChange:'仅本变体姿态或表情',
    width:576,height:768,resolutionTier:'1K',alpha:'required',variants:actor.map(t=>({variantKey:t.parameters.family.variantKey,name:t.parameters.name,
      mediaKind:t.parameters.mediaKind as 'character-pose'|'character-expression',changeDescription:'只改变指定姿态或表情',sceneKey:t.parameters.consumer.sceneKey!,lineKey:t.parameters.triggerBeatKey!}))}
  const requirements=composeAvgCharacterFamilyRequirementsV2(plan),base=await freezeAvgVisualProductionBatchV2({schema:'storyforge.avg.visual-production-batch',version:2,
    batchKey:'versioned.family',revision:2,requirements,visualReviewPolicy:'author-visual-v1'},s.source)
  const body={schema:'storyforge.avg.character-family-proposal' as const,version:2 as const,plan,sourceInputHash:base.sourceInputHash,sourceDraftHash:'c'.repeat(64)}
  const proposal={...body,proposalHash:await hashAvgCharacterFamilyProposalV2(body)}
  const value={...base,characterFamily:{proposal,approval:{proposalHash:proposal.proposalHash,providerInputAllowed:true as const,derivativeUseAllowed:true as const,declaration:'明确本家族本批外发及衍生'}}}
  return {s,plan,value}
}

describe('AVG explicit V2 professional requirements and character family',()=>{
  it('preserves the exact legacy frozen compiler identity recorded before shared validation refactoring',async()=>{
    const s=avgVersionedPlanningFixture(),scope=await freezeAvgVisualPlanningScopeV1(s.legacy,s.source),proposal=await compileAvgVisualPlanningProposalV1({...s,scope})
    expect({scopeHash:await hashProductProductionValueV2(scope),batchHash:proposal.batchHash,proposalHash:await hashProductProductionValueV2(proposal)}).toEqual({
      scopeHash:'e54a60b7d9cd519e69d3f8348208e9169424c29a72f165472009a0b69136c641',batchHash:'871fd6db7bab697c9f398ce2c1491fd74c47fd96bc8d29f2f090d53cc04d0602',
      proposalHash:'689270c4d2098ab654d23a9c017432dc5389cd2ffd130f779b0faa999381272c'})
  })
  it('compiles background, pose, expression, item icon/detail with exact reference policy and no source mutation',async()=>{
    const s=await fixture(),before=structuredClone(s),p=await compileAvgVisualPlanningProposalV2(s)
    expect(s).toEqual(before);expect(p).toMatchObject({version:2,batch:{version:2,visualReviewPolicy:'author-visual-v1'}})
    expect(p.batch.requirements.map(r=>r.mediaKind)).toEqual(['background','character-pose','character-expression','ui','cg'])
    for(const [i,r]of p.batch.requirements.entries()){
      expect(r).toMatchObject(s.scope.templates[i].parameters)
      expect(r.references).toEqual(s.scope.templates[i].requiredReferenceKeys.map(k=>s.scope.referenceCatalog.find(x=>x.referenceKey===k)!.reference))
      expect(r.invariants).toContain('保持已确认主体');expect(r.forbiddenDepictions).toContain('新增剧情物件')
    }
    expect(p.batchHash).toBe(await hashProductProductionValueV2(p.batch));expect(p.inputHashes.scope).toBe(await hashProductProductionValueV2(s.scope))
    expect(await compileAvgVisualPlanningProposalV2({...s,mediaBriefs:[...s.mediaBriefs].reverse()})).toEqual(p)
    await expect(assertAvgVisualPlanningProposalV2(p,s)).resolves.toEqual(p)
  })
  it('keeps old scope, batch, proposal and request entry points strict while preserving V1 request bytes',async()=>{
    const s=await fixture(),p=await compileAvgVisualPlanningProposalV2(s),legacyScope=await freezeAvgVisualPlanningScopeV1(s.legacy,s.source)
    const old=await compileAvgVisualPlanningProposalV1({...s,scope:legacyScope}),cap=await capability(),request={capability:cap,qualityProfile:'internal' as const,requirementKey:old.batch.requirements[0].requirementKey,idempotencyKey:'controlled.versioned',adapterId:'agnes.image-2.5-flash.v1' as const}
    expect(()=>parseAvgVisualPlanningScopeV1(s.scope)).toThrow();expect(()=>parseAvgVisualPlanningScopeV2(legacyScope)).toThrow()
    expect(()=>parseAvgVisualProductionBatchV1(p.batch)).toThrow();expect(()=>parseAvgVisualProductionBatchV2(old.batch)).toThrow()
    await expect(assertAvgVisualPlanningProposalV2(old,s)).rejects.toThrow()
    const first=await prepareAvgRawImageRequestFromBatchV1({...request,batch:old.batch})
    expect(await prepareAvgRawImageRequestFromBatchV1({...request,batch:old.batch})).toEqual(first)
    const next=await prepareAvgRawImageRequestFromBatchV2({...request,batch:p.batch})
    await expect(assertAvgImageRequestV1(next as never)).rejects.toThrow();await expect(assertAvgImageRequestV2(first as never)).rejects.toThrow()
  })
  it('freezes each actual target family in request2 and includes policy and target revisions in both request hashes',async()=>{
    const s=await fixture(),p=await compileAvgVisualPlanningProposalV2(s),cap=await capability()
    for(const r of p.batch.requirements){
      const input={batch:p.batch,capability:cap,qualityProfile:'internal' as const,requirementKey:r.requirementKey,idempotencyKey:`request.${r.requirementKey}`,adapterId:'agnes.image-2.5-flash.v1' as const}
      const request=await prepareAvgRawImageRequestFromBatchV2(input)
      expect(request.targetFamily).toEqual(r.family);expect(request.references).toEqual(r.references)
      expect(await assertAvgImageRequestV2(request)).toEqual(request)
      const changed=structuredClone(p.batch);changed.requirements.find(x=>x.requirementKey===r.requirementKey)!.references[0].contentPolicy.excludedFeatures.push('额外道具')
      const fresh=await prepareAvgRawImageRequestFromBatchV2({...input,batch:changed})
      expect(fresh.inputHash).not.toBe(request.inputHash);expect(fresh.request.inputHash).not.toBe(request.request.inputHash)
      await expect(assertAvgImageRequestV2({...request,targetFamily:{...request.targetFamily,revision:2}})).rejects.toThrow()
    }
  })
  it('pins the selected batch and target before asynchronous request preparation',async()=>{
    const s=await fixture(),p=await compileAvgVisualPlanningProposalV2(s),before=structuredClone(p.batch.requirements[0])
    const pending=prepareAvgRawImageRequestFromBatchV2({batch:p.batch,capability:await capability(),qualityProfile:'internal',
      requirementKey:before.requirementKey,idempotencyKey:'pin.reference.target',adapterId:'agnes.image-2.5-flash.v1'})
    p.batch.requirements[0].family.revision=99;p.batch.requirements[0].references[0].contentPolicy.excludedFeatures=[]
    const request=await pending
    expect(request.targetFamily).toEqual(before.family);expect(request.references).toEqual(before.references)
  })
  it('allows eight declared variants while source validation still refuses undeclared beats',async()=>{
    const {s,plan}=await family()
    plan.variants=Array.from({length:8},(_,i)=>({...plan.variants[0],variantKey:`v${i}`,lineKey:`not.declared.${i}`}))
    expect(parseAvgCharacterFamilyPlanV2(plan).variants).toHaveLength(8)
    await expect(freezeAvgVisualProductionBatchV2({schema:'storyforge.avg.visual-production-batch',version:2,batchKey:'bounded.family',revision:1,
      requirements:composeAvgCharacterFamilyRequirementsV2(plan)},s.source)).rejects.toThrow(/触发拍/)
  })
  it.each(['old-version','old-reference','false-grant','false-derivative','policy-overlap','missing-catalog','unused-catalog','missing-required','duplicate-asset','duplicate-target','unknown-trigger','missing-item-declaration'] as const)('rejects %s during author scope preparation',async mode=>{
    const s=avgVersionedPlanningFixture(),p=s.versioned
    if(mode==='old-version')(p as {version:number}).version=1
    if(mode==='old-reference')(p.referenceCatalog[0] as {reference:unknown}).reference=s.legacy.referenceCatalog[0].reference
    if(mode==='false-grant')(p.referenceCatalog[0].reference as {providerInputAllowed:boolean}).providerInputAllowed=false
    if(mode==='false-derivative')(p.referenceCatalog[0].reference as {derivativeUseAllowed:boolean}).derivativeUseAllowed=false
    if(mode==='policy-overlap')p.referenceCatalog[0].reference.contentPolicy.excludedFeatures.push(p.referenceCatalog[0].reference.contentPolicy.permittedFeatures[0])
    if(mode==='missing-catalog')p.referenceCatalog.pop()
    if(mode==='unused-catalog')p.referenceCatalog.push({...p.referenceCatalog[0],referenceKey:'ref.unused'})
    if(mode==='missing-required')p.templates[0].requiredReferenceKeys=['ref.identity']
    if(mode==='duplicate-asset')p.templates[1].parameters.assetKey=p.templates[0].parameters.assetKey
    if(mode==='duplicate-target')p.templates.push({...structuredClone(p.templates[0]),parameters:{...p.templates[0].parameters,requirementKey:'duplicate.background',assetKey:'duplicate.asset'}})
    if(mode==='unknown-trigger')p.templates[0].parameters.triggerBeatKey='missing.line'
    if(mode==='missing-item-declaration'&&s.source.systemPlan.version===2)s.source.systemPlan.inventory.items[0].iconAssetKey=null
    const before=structuredClone(s);await expect(freezeAvgVisualPlanningScopeV2(p,s.source)).rejects.toThrow();expect(s).toEqual(before)
  })
  it.each(['drop-reference','borrow-reference','add-output','missing-subject','invent-subject','source-drift','model-grant'] as const)('rejects model or source %s without changing trusted input',async mode=>{
    const s=await fixture()
    if(mode==='drop-reference')s.mediaBriefs[0].outputs[0].referenceKeys=[]
    if(mode==='borrow-reference')s.mediaBriefs[0].outputs[0].referenceKeys.push('ref.identity')
    if(mode==='add-output')s.mediaBriefs[0].outputs.push({...s.mediaBriefs[0].outputs[0],requirementKey:'unrequested'})
    if(mode==='missing-subject')s.visualBible.subjects.pop()
    if(mode==='invent-subject')s.visualBible.subjects.push({...s.visualBible.subjects[0],subjectKey:'invented'})
    if(mode==='source-drift')s.source.scripts[0].lines[0].text+=' changed'
    if(mode==='model-grant')(s.mediaBriefs[0].outputs[0] as unknown as Record<string,unknown>).providerInputAllowed=true
    const before=structuredClone(s);await expect(compileAvgVisualPlanningProposalV2(s)).rejects.toThrow();expect(s).toEqual(before)
  })
  it('rejects a self-rehashed changed proposal against exact trusted scope, target and reference inputs',async()=>{
    const s=await fixture(),p=await compileAvgVisualPlanningProposalV2(s),changed=structuredClone(p)
    changed.batch.requirements[0].references[0].contentPolicy.excludedFeatures=[];changed.batchHash=await hashProductProductionValueV2(changed.batch)
    await expect(assertAvgVisualPlanningProposalV2(changed,s)).rejects.toThrow()
    const changedTarget=structuredClone(p);changedTarget.batch.requirements[0].family.revision++;changedTarget.batchHash=await hashProductProductionValueV2(changedTarget.batch)
    await expect(assertAvgVisualPlanningProposalV2(changedTarget,s)).rejects.toThrow()
  })
  it('keeps a family2 exact baseline, permitted/excluded content and distinct pose/expression targets',async()=>{
    const {s,plan,value}=await family(),parsed=await validateAvgVisualProductionBatchSourceV2(value,s.source)
    expect(parsed.requirements).toHaveLength(2);expect(()=>parseAvgCharacterFamilyPlanV1(plan)).toThrow()
    for(const r of parsed.requirements){
      expect(r.references[0].contentPolicy).toEqual(plan.baseline.contentPolicy);expect(r.references[0].contentHash).toBe(plan.baseline.contentHash)
      expect(r.references[0].allowedChange).toContain(plan.baseline.allowedChange);expect(r.references[0].allowedChange).toContain(plan.allowedChange)
      expect(r.family).toMatchObject({familyKey:plan.familyKey,revision:2});expect(r.alpha).toBe('required')
    }
  })
  it.each(['legacy-baseline','style-baseline','empty-identity','duplicate-position','oversize-variants','false-approval','approval-mismatch','changed-policy','changed-target-rehashed'] as const)('refuses family %s',async mode=>{
    const {s,plan,value}=await family()
    if(mode==='legacy-baseline')(plan as {baseline:unknown}).baseline=s.legacy.referenceCatalog[1].reference
    if(mode==='style-baseline')plan.baseline.purpose='style'
    if(mode==='empty-identity')plan.identityInvariants=[]
    if(mode==='duplicate-position')plan.variants[1]={...plan.variants[1],sceneKey:plan.variants[0].sceneKey,lineKey:plan.variants[0].lineKey}
    if(mode==='oversize-variants')plan.variants=Array.from({length:9},(_,i)=>({...plan.variants[0],variantKey:`v${i}`}))
    if(['legacy-baseline','style-baseline','empty-identity','duplicate-position','oversize-variants'].includes(mode)){expect(()=>parseAvgCharacterFamilyPlanV2(plan)).toThrow();return}
    if(mode==='false-approval')(value.characterFamily.approval as {providerInputAllowed:boolean}).providerInputAllowed=false
    if(mode==='approval-mismatch')value.characterFamily.approval.proposalHash='f'.repeat(64)
    if(mode==='changed-policy')value.characterFamily.proposal.plan.baseline.contentPolicy.excludedFeatures=[]
    if(mode==='changed-target-rehashed'){
      value.characterFamily.proposal.plan.revision++
      const {proposalHash:_hash,...body}=value.characterFamily.proposal
      value.characterFamily.proposal.proposalHash=await hashAvgCharacterFamilyProposalV2(body)
      value.characterFamily.approval.proposalHash=value.characterFamily.proposal.proposalHash
    }
    await expect(validateAvgVisualProductionBatchSourceV2(value,s.source)).rejects.toThrow()
  })
})
