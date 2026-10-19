import { describe,expect,it } from 'vitest'
import { avgVisualReviewFixture } from '../helpers/avg-visual-review-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { composeAvgCharacterFamilyRequirementsV1 } from '../../src/lib/avg/character-family-contract'
import { parseAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { assertAvgVisualReviewScopeV1,assertAvgVisualReviewSelectableV1,assertAvgVisualReviewRevisionV1,parseAvgAuthorVisualReviewV1 } from '../../src/lib/avg/visual-review'
import { freezeAvgVisualProductionBatchV1 } from '../../src/lib/avg/media-source'
import { avgVisualBatchArtifactKeysV1,parseAvgVisualProductionBatchV1 } from '../../src/lib/avg/media-production-contract'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'

const r=()=>composeAvgCharacterFamilyRequirementsV1({schema:'storyforge.avg.character-family-plan',version:1,familyKey:'keeper',revision:1,subjectKey:'keeper',name:'保管员',baseline:{assetKey:'baseline',assetVersion:1,contentHash:'b'.repeat(64),mimeType:'image/png',byteSize:24,license:'原创工程图'},
 stylePrompt:'固定机位工程图',identityInvariants:['身份与服装'],negativePrompt:'',forbiddenDepictions:[],allowedChange:'允许变化表情',width:576,height:324,resolutionTier:'1K',alpha:'not-required',variants:[{variantKey:'calm',name:'平静',mediaKind:'character-expression',changeDescription:'平静',sceneKey:'desk',lineKey:'line.desk'}]})[0]
const hash='a'.repeat(64)
describe('AVG explicit author visual review scope and blocking policy',()=>{
 it('preserves old review/batch bytes and adds a closed review output only with an explicit new policy',async()=>{
   const old={schema:'storyforge.avg.review-issues',version:1,targetKey:'desk',observations:['text'],unobserved:[],issues:[]}
   expect(canonicalProductProductionJsonV2(parseAvgProfessionalArtifactV1(old))).toBe(canonicalProductProductionJsonV2(old))
   const base=await freezeAvgVisualProductionBatchV1({schema:'storyforge.avg.visual-production-batch',version:1,batchKey:'new.family',revision:1,requirements:[r()]},avgAuthorWorkspaceFixture())
   expect(canonicalProductProductionJsonV2(parseAvgVisualProductionBatchV1(base))).toBe(canonicalProductProductionJsonV2(base))
   expect(avgVisualBatchArtifactKeysV1(base)).toHaveLength(2)
   expect(avgVisualBatchArtifactKeysV1({...base,visualReviewPolicy:'author-visual-v1'})).toContain('avg.review.visual.cf.keeper.r1.calm')
   expect(()=>parseAvgVisualProductionBatchV1({...base,visualReviewPolicy:null})).toThrow()
 })
 it('requires exact result/reference hashes, all five named criteria and applicable observations',()=>{
   const report=avgVisualReviewFixture(r(),hash)
   expect(assertAvgVisualReviewSelectableV1(report,r(),hash)).toEqual(report)
   expect(()=>assertAvgVisualReviewSelectableV1(report,r(),'f'.repeat(64))).toThrow(/准确原图/)
   const noReference=structuredClone(report);noReference.visualEvidence!.referenceHashes=[]
   expect(()=>assertAvgVisualReviewSelectableV1(noReference,r(),hash)).toThrow(/未完整/)
   const missing=structuredClone(report);missing.visualEvidence!.checks.pop()
   expect(()=>parseAvgAuthorVisualReviewV1(missing)).toThrow(/不完整/)
   const bypass=structuredClone(report);bypass.visualEvidence!.checks[0].result='not-applicable'
   expect(()=>assertAvgVisualReviewScopeV1(bypass,r(),hash)).toThrow(/不适用/)
   const noBaseline={...r(),references:[]},noProof=avgVisualReviewFixture(noBaseline,hash);noProof.visualEvidence!.checks[0].result='pass'
   expect(()=>assertAvgVisualReviewScopeV1(noProof,noBaseline,hash)).toThrow(/缺少对应图像基准/)
 })
 it('keeps unknowns and blocking failures separate from selectable images; average/pass fields cannot override them',()=>{
   const unknown=avgVisualReviewFixture(r(),hash);unknown.visualEvidence!.checks[0].result='unknown';unknown.unobserved=['身份待核对']
   expect(parseAvgAuthorVisualReviewV1(unknown).unobserved).toHaveLength(1)
   expect(()=>assertAvgVisualReviewSelectableV1(unknown,r(),hash)).toThrow(/未观察/)
   const failed=avgVisualReviewFixture(r(),hash);failed.visualEvidence!.checks[0]={criterion:'identity',result:'fail',note:'身份漂移'}
   expect(()=>assertAvgVisualReviewScopeV1(failed,r(),hash)).toThrow(/blocking/)
   failed.issues=[{issueKey:'visual.identity',locationKey:r().assetKey,severity:'blocking',owner:'media',evidence:'身份漂移',allowedChange:'保留原身份修订',impact:'无法选用',recheck:'重新对照基准'}]
   expect(()=>assertAvgVisualReviewSelectableV1(failed,r(),hash)).toThrow(/blocking/)
   expect(()=>parseAvgAuthorVisualReviewV1({...failed,passed:true})).toThrow()
   const fake=structuredClone(failed);fake.issues[0].locationKey='foreign.work'
   expect(()=>assertAvgVisualReviewScopeV1(fake,r(),hash)).toThrow(/冻结消费位置/)
 })
 it('requires a new observation explanation before clearing a previous unknown/blocking conclusion',()=>{
   const previous=avgVisualReviewFixture(r(),hash);previous.unobserved=['身份待核对'];previous.visualEvidence!.checks[0].result='unknown'
   const current=avgVisualReviewFixture(r(),hash)
   expect(()=>assertAvgVisualReviewRevisionV1(previous,current)).toThrow(/重新观察/)
   current.visualEvidence!.note='已重新查看基准与准确原图，说明本次结论变更；工程样本非艺术验收'
   expect(()=>assertAvgVisualReviewRevisionV1(previous,current)).not.toThrow()
 })
})
