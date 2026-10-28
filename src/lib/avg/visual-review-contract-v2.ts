import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgReviewFieldsV1,type AvgReviewIssuesV1 } from './artifact-contract'
import { parseAvgAuthorVisualEvidenceV1,type AvgAuthorVisualEvidenceV1 } from './visual-review-contract'
import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'
import { avgEnum,avgHash,avgKey,avgList,avgNumber,avgProtocolBody,avgRecord,avgText,avgUnique } from './protocol-validation'

/** New reference-policy observation, never inferred from a provider receipt.
 * The original five visual criteria remain required alongside these checks. */
export interface AvgReviewIssuesV2 extends Omit<AvgReviewIssuesV1,'version'|'visualEvidence'|'audioEvidence'>{
  version:2;visualEvidence:AvgAuthorVisualEvidenceV1;audioEvidence?:never
  referencePolicy:{requirementHash:string;checks:Array<{assetKey:string;assetVersion:number;contentHash:string;policyHash:string;
    permittedFeatures:'pass'|'fail'|'unknown';excludedFeatures:'pass'|'fail'|'unknown';note:string}>}
}
export function parseAvgAuthorVisualReviewV2(value:unknown):AvgReviewIssuesV2{
  const r=avgRecord(avgProtocolBody(value),['schema','version','targetKey','observations','unobserved','issues','visualEvidence','referencePolicy'],'reference policy visual review')
  if(r.schema!=='storyforge.avg.review-issues'||r.version!==2)throw new Error('[avg-review] 新参考评审版本无效')
  const fields=parseAvgReviewFieldsV1(r),visualEvidence=parseAvgAuthorVisualEvidenceV1(r.visualEvidence)
  if(fields.observations.some(o=>o!=='visual')||!fields.observations.length&&!fields.unobserved.length
    ||fields.observations.includes('visual')!==(visualEvidence.imageHash!==null))throw new Error('[avg-review] 请准确保留已观察范围和未知项')
  const p=avgRecord(r.referencePolicy,['requirementHash','checks'],'reference policy observation')
  const checks=avgUnique(avgList(p.checks,'reference checks',v=>{
    const c=avgRecord(v,['assetKey','assetVersion','contentHash','policyHash','permittedFeatures','excludedFeatures','note'],'reference check')
    return {assetKey:avgKey(c.assetKey,'reference.assetKey'),assetVersion:avgNumber(c.assetVersion,'reference.assetVersion',1,1e6),
      contentHash:avgHash(c.contentHash,'reference.contentHash'),policyHash:avgHash(c.policyHash,'reference.policyHash'),
      permittedFeatures:avgEnum(c.permittedFeatures,['pass','fail','unknown'] as const,'permittedFeatures'),
      excludedFeatures:avgEnum(c.excludedFeatures,['pass','fail','unknown'] as const,'excludedFeatures'),note:avgText(c.note,'reference.note',2000)}
  },4),c=>c.assetKey,'reference checks')
  return {schema:r.schema,version:2,...fields,visualEvidence,referencePolicy:{requirementHash:avgHash(p.requirementHash,'review.requirementHash'),checks}}
}
export async function assertAvgReferencePolicyReviewV2(report:AvgReviewIssuesV2,requirement:AvgVisualProductionRequirementV2){
  if(report.referencePolicy.requirementHash!==await hashProductProductionValueV2(requirement)
    ||report.referencePolicy.checks.length!==requirement.references.length)throw new Error('[avg-review] 参考评审未绑定准确完整需求或全部参考')
  for(const [index,reference] of requirement.references.entries()){
    const c=report.referencePolicy.checks[index]
    if(c.assetKey!==reference.assetKey||c.assetVersion!==reference.assetVersion||c.contentHash!==reference.contentHash
      ||c.policyHash!==await hashProductProductionValueV2(reference.contentPolicy))throw new Error('[avg-review] 参考版本、顺序或允许/排除声明已变化')
    for(const [field,result] of [['permitted',c.permittedFeatures],['excluded',c.excludedFeatures]] as const){
      if(result==='pass'&&(!report.visualEvidence.imageHash||!report.visualEvidence.referenceHashes.includes(reference.contentHash)))throw new Error('[avg-review] 未观察原图和准确参考，不能声明参考用途符合')
      if(result==='unknown'&&!report.unobserved.length)throw new Error('[avg-review] 参考用途未知必须保留未观察项')
      if(result==='fail'&&!report.issues.some(issue=>issue.issueKey===`reference.${index}.${field}`&&issue.locationKey===reference.assetKey
        &&issue.severity==='blocking'&&issue.owner==='media'))throw new Error('[avg-review] 参考用途失败必须有准确 blocking 返修问题')
    }
  }
}
export function assertAvgReferencePolicySelectableV2(report:AvgReviewIssuesV2){
  if(report.referencePolicy.checks.some(c=>c.permittedFeatures!=='pass'||c.excludedFeatures!=='pass'))throw new Error('[avg-review] 参考内容未完整复核通过，不能选用')
}
export function assertAvgVisualReviewRevisionV2(previous:unknown|null,next:AvgReviewIssuesV2){
  if(previous===null)return
  const old=parseAvgAuthorVisualReviewV2(previous)
  const blocked=(r:AvgReviewIssuesV2)=>r.unobserved.length>0||r.issues.some(i=>i.severity==='blocking')
    ||r.visualEvidence.checks.some(c=>['unknown','fail'].includes(c.result))||r.referencePolicy.checks.some(c=>c.permittedFeatures!=='pass'||c.excludedFeatures!=='pass')
  const oldNotes={visual:old.visualEvidence.note,references:old.referencePolicy.checks.map(c=>c.note)}
  const nextNotes={visual:next.visualEvidence.note,references:next.referencePolicy.checks.map(c=>c.note)}
  if(blocked(old)&&!blocked(next)&&canonicalProductProductionJsonV2(oldNotes)===canonicalProductProductionJsonV2(nextNotes))throw new Error('[avg-review] 解除未知或阻断须说明重新观察依据')
  const visualResolved=old.unobserved.length>0&&!next.unobserved.length
    ||old.issues.some(i=>i.severity==='blocking')&&!next.issues.some(i=>i.severity==='blocking')
    ||old.visualEvidence.checks.some(c=>['unknown','fail'].includes(c.result)&&next.visualEvidence.checks.find(n=>n.criterion===c.criterion)?.result==='pass')
  if(visualResolved&&old.visualEvidence.note===next.visualEvidence.note)throw new Error('[avg-review] 解除视觉未知或问题须补充本次观察依据')
  for(const c of next.referencePolicy.checks){
    const previous=old.referencePolicy.checks.find(p=>p.assetKey===c.assetKey&&p.assetVersion===c.assetVersion&&p.contentHash===c.contentHash&&p.policyHash===c.policyHash)
    if(previous&&(previous.permittedFeatures!=='pass'&&c.permittedFeatures==='pass'||previous.excludedFeatures!=='pass'&&c.excludedFeatures==='pass')
      &&previous.note===c.note)throw new Error('[avg-review] 解除某张参考的未知或失败须补充该参考的重新观察依据')
  }
}
