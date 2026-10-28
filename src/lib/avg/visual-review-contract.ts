import { avgEnum,avgHash,avgList,avgRecord,avgText,avgUnique } from './protocol-validation'

export const AVG_VISUAL_REVIEW_CRITERIA_V1=['identity','continuity','composition','legibility','alpha-edge'] as const
export type AvgVisualReviewCriterionV1=typeof AVG_VISUAL_REVIEW_CRITERIA_V1[number]
export interface AvgAuthorVisualEvidenceV1 {
  imageHash:string|null;referenceHashes:string[];note:string
  checks:Array<{criterion:AvgVisualReviewCriterionV1;result:'pass'|'fail'|'unknown'|'not-applicable';note:string}>
}
export function parseAvgAuthorVisualEvidenceV1(value:unknown):AvgAuthorVisualEvidenceV1{
  const v=avgRecord(value,['imageHash','referenceHashes','checks','note'],'visual evidence')
  const checks=avgUnique(avgList(v.checks,'visual.checks',value=>{
    const c=avgRecord(value,['criterion','result','note'],'visual check')
    return {criterion:avgEnum(c.criterion,AVG_VISUAL_REVIEW_CRITERIA_V1,'visual.criterion'),result:avgEnum(c.result,['pass','fail','unknown','not-applicable'] as const,'visual.result'),note:avgText(c.note,'visual.note',2000,true)}
  },5),c=>c.criterion,'visual checks')
  if(checks.length!==AVG_VISUAL_REVIEW_CRITERIA_V1.length)throw new Error('[avg-review] 视觉观察项不完整')
  return {imageHash:v.imageHash===null?null:avgHash(v.imageHash,'visual.imageHash'),referenceHashes:avgList(v.referenceHashes,'visual.referenceHashes',avgHash,4),checks,note:avgText(v.note,'visual.note',4000)}
}
