import { describe,expect,it } from 'vitest'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { composeAvgCharacterFamilyRequirementsV1, hashAvgCharacterFamilyProposalV1, parseAvgCharacterFamilyPlanV1,
  parseAvgCharacterFamilyBatchV1, type AvgCharacterFamilyPlanV1 } from '../../src/lib/avg/character-family-contract'
import { freezeAvgVisualProductionBatchV1, validateAvgVisualProductionBatchSourceV1 } from '../../src/lib/avg/media-source'
import { parseAvgVisualProductionBatchV1 } from '../../src/lib/avg/media-production-contract'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'

const plan=():AvgCharacterFamilyPlanV1=>({schema:'storyforge.avg.character-family-plan',version:1,familyKey:'keeper',revision:1,subjectKey:'keeper',name:'保管员',
  baseline:{assetKey:'original.keeper',assetVersion:1,contentHash:'a'.repeat(64),mimeType:'image/png',byteSize:100,license:'author-owned-engineering'},stylePrompt:'原创工程校准',identityInvariants:['脸与服装保持'],negativePrompt:'',forbiddenDepictions:[],allowedChange:'仅允许表情变化',
  width:576,height:768,resolutionTier:'1K',alpha:'required',variants:[{variantKey:'neutral',name:'平静',mediaKind:'character-expression',changeDescription:'平静表情',sceneKey:'desk',lineKey:'line.desk'}]})
async function batch(){
  const workspace=avgAuthorWorkspaceFixture(),p=plan(),requirements=composeAvgCharacterFamilyRequirementsV1(p)
  const base=await freezeAvgVisualProductionBatchV1({schema:'storyforge.avg.visual-production-batch',version:1,batchKey:'family.keeper',revision:1,requirements},workspace)
  const body={schema:'storyforge.avg.character-family-proposal' as const,version:1 as const,plan:p,sourceInputHash:base.sourceInputHash,sourceDraftHash:'b'.repeat(64)}
  const proposal={...body,proposalHash:await hashAvgCharacterFamilyProposalV1(body)},approval={proposalHash:proposal.proposalHash,providerInputAllowed:true as const,derivativeUseAllowed:true as const,declaration:'明确本批外发与衍生'}
  return {workspace,base,value:{...base,characterFamily:{proposal,approval}}}
}
describe('AVG bounded shared character family contract',()=>{
  it('keeps exact shared identity, per-variant target and independent final image choices',async()=>{
    const {workspace,value}=await batch(),parsed=await validateAvgVisualProductionBatchSourceV1(value,workspace)
    expect(parsed.requirements[0]).toMatchObject({family:{subjectKey:'keeper',familyKey:'keeper',variantKey:'neutral',revision:1},consumer:{domain:'stage',slot:'actor',sceneKey:'desk'},triggerBeatKey:'line.desk',alpha:'required',references:[{purpose:'identity',contentHash:'a'.repeat(64)}]})
    expect(parsed.characterFamily!.approval.proposalHash).toBe(value.characterFamily.proposal.proposalHash)
  })
  it('old ordinary batches preserve bytes; null or invented family authority cannot be ignored',async()=>{
    const {base}=await batch()
    expect(canonicalProductProductionJsonV2(parseAvgVisualProductionBatchV1(base))).toBe(canonicalProductProductionJsonV2(base))
    expect(()=>parseAvgVisualProductionBatchV1({...base,characterFamily:null})).toThrow()
    expect(()=>parseAvgCharacterFamilyPlanV1({...plan(),providerCall:true})).toThrow()
  })
  it('changed plan, synthesized request, false consent and mismatched approval reject',async()=>{
    const {workspace,value}=await batch(),changed=structuredClone(value);changed.characterFamily.proposal.plan.stylePrompt+=' changed'
    await expect(validateAvgVisualProductionBatchSourceV1(changed,workspace)).rejects.toThrow(/提案/)
    const wrong=structuredClone(value);wrong.requirements[0].triggerBeatKey='line.wait'
    await expect(validateAvgVisualProductionBatchSourceV1(wrong,workspace)).rejects.toThrow(/提案/)
    expect(()=>parseAvgCharacterFamilyBatchV1({...value.characterFamily,approval:{...value.characterFamily.approval,providerInputAllowed:false}})).toThrow(/授权/)
    expect(()=>parseAvgCharacterFamilyBatchV1({...value.characterFamily,approval:{...value.characterFamily.approval,proposalHash:'f'.repeat(64)}})).toThrow(/授权/)
  })
  it('requires bounded unique variants, one actor image per exact position and real identity constraints',()=>{
    const p=plan()
    expect(()=>parseAvgCharacterFamilyPlanV1({...p,variants:[]})).toThrow()
    expect(()=>parseAvgCharacterFamilyPlanV1({...p,variants:Array.from({length:9},(_,i)=>({...p.variants[0],variantKey:`v${i}`}))})).toThrow()
    expect(()=>parseAvgCharacterFamilyPlanV1({...p,variants:[p.variants[0],{...p.variants[0],variantKey:'smile'}]})).toThrow()
    expect(()=>parseAvgCharacterFamilyPlanV1({...p,identityInvariants:[]})).toThrow()
    expect(()=>parseAvgCharacterFamilyPlanV1({...p,baseline:{...p.baseline,byteSize:8*1024*1024+1}})).toThrow()
  })
})
