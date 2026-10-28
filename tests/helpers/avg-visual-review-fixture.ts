import type { AvgReviewIssuesV1 } from '../../src/lib/avg/artifact-contract'
import type { AvgVisualProductionRequirementV1 } from '../../src/lib/avg/media-production-contract'
import { AVG_VISUAL_REVIEW_CRITERIA_V1 } from '../../src/lib/avg/visual-review-contract'

/** Explicitly synthetic author assessment for controlled engineering images.
 * This fixture is never a human, professional or real-provider art verdict. */
export function avgVisualReviewFixture(r:AvgVisualProductionRequirementV1,rawHash:string):AvgReviewIssuesV1{
  return {schema:'storyforge.avg.review-issues',version:1,targetKey:r.requirementKey,observations:['visual'],unobserved:[],issues:[],visualEvidence:{imageHash:rawHash,
    referenceHashes:r.references.map(ref=>ref.contentHash),note:'已对照准确原创工程图与全部参考，仅验证控制链，不签艺术通过',checks:AVG_VISUAL_REVIEW_CRITERIA_V1.map(criterion=>({criterion,
      result:criterion==='identity'&&!r.references.some(ref=>ref.purpose==='identity')||criterion==='continuity'&&!r.references.length||criterion==='alpha-edge'&&r.alpha!=='required'?'not-applicable':'pass',
      note:'原创工程材料的控制评审；不签艺术或商业验收'}))}}
}
