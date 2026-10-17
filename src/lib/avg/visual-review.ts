import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { parseAvgProfessionalArtifactV1, type AvgReviewIssuesV1 } from './artifact-contract'
import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import { readAvgDraftReferenceBytesV1 } from './editor-service'
import { inspectAvgImageBytesV1 } from './image-decoder'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { inspectAvgProcessedImageSourceV1, readAvgProcessedImageSourceV1 } from './image-processing-source'
import { assertAvgConsumedRawImageV4, readAvgImageConsumptionDefinitionV4 } from './image-consumption'

const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
export function parseAvgAuthorVisualReviewV1(value:unknown){
  const report=parseAvgProfessionalArtifactV1(value)
  if(report.schema!=='storyforge.avg.review-issues'||!report.visualEvidence||report.observations.some(o=>o!=='visual')
    ||!report.observations.length&&!report.unobserved.length||report.observations.includes('visual')!==(report.visualEvidence.imageHash!==null))throw new Error('[avg-review] 请准确声明已查看的原图与参考，未观察项必须记录')
  return report
}
export function assertAvgVisualReviewScopeV1(report:AvgReviewIssuesV1,r:AvgVisualProductionRequirementV1,rawHash:string){
  const v=report.visualEvidence
  const locations=new Set([r.requirementKey,r.assetKey,r.family.subjectKey,r.consumer.sceneKey,r.triggerBeatKey,...r.references.map(ref=>ref.assetKey)])
  if(!v||report.targetKey!==r.requirementKey||v.imageHash!==null&&v.imageHash!==rawHash||v.referenceHashes.some(hash=>!r.references.some(ref=>ref.contentHash===hash))
    ||report.issues.some(issue=>!locations.has(issue.locationKey)))throw new Error('[avg-review] 评审不属于准确原图、参考或冻结消费位置')
  if(!report.unobserved.length&&(!v.imageHash||!same(v.referenceHashes,r.references.map(ref=>ref.contentHash))))throw new Error('[avg-review] 未完整查看原图和全部参考，不能省略未观察项')
  for(const check of v.checks){
    const applicable=check.criterion==='identity'?r.references.some(ref=>ref.purpose==='identity')
      :check.criterion==='continuity'?r.references.length>0:check.criterion==='alpha-edge'?r.alpha==='required':true
    if(check.result==='not-applicable'&&applicable)throw new Error('[avg-review] 必需观察项不能标为不适用')
    if(['identity','continuity'].includes(check.criterion)&&!applicable&&check.result==='pass')throw new Error('[avg-review] 缺少对应图像基准，不能声明身份或跨图连续性已通过')
    if(check.result==='unknown'&&!report.unobserved.length)throw new Error('[avg-review] 请明确保留未知观察项')
    if(check.result==='fail'&&(!check.note.trim()||!report.issues.some(issue=>issue.issueKey===`visual.${check.criterion}`&&issue.severity==='blocking')))throw new Error('[avg-review] 失败观察项须有对应 blocking 问题、证据和返修交接')
  }
}
export function assertAvgVisualReviewSelectableV1(value:unknown,r:AvgVisualProductionRequirementV1,rawHash:string){
  const report=parseAvgAuthorVisualReviewV1(value);assertAvgVisualReviewScopeV1(report,r,rawHash)
  if(!report.observations.includes('visual')||report.unobserved.length||report.visualEvidence!.checks.some(check=>['unknown','fail'].includes(check.result))||report.issues.some(issue=>issue.severity==='blocking'))throw new Error('[avg-review] 评审有未观察或 blocking 问题，请先返修并重新核对，不能选用')
  return report
}
export function assertAvgVisualReviewRevisionV1(previous:unknown|null,next:AvgReviewIssuesV1){
  if(previous===null)return
  const old=parseAvgAuthorVisualReviewV1(previous)
  const previouslyBlocked=old.unobserved.length>0||old.issues.some(issue=>issue.severity==='blocking')||old.visualEvidence!.checks.some(check=>['unknown','fail'].includes(check.result))
  const nowSelectable=next.unobserved.length===0&&!next.issues.some(issue=>issue.severity==='blocking')&&next.visualEvidence!.checks.every(check=>['pass','not-applicable'].includes(check.result))
  if(previouslyBlocked&&nowSelectable&&old.visualEvidence!.note.trim()===next.visualEvidence!.note.trim())throw new Error('[avg-review] 解除未知或 blocking 结论须说明本次重新观察与修订依据')
}

/** Records author assessment, including rejection/unknown. It never creates
 * an artistic pass, human-identity claim or independently scored model review. */
export async function validateAvgAuthorVisualReviewV1(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;raw:ProductBuildArtifactRecordV1;payload:unknown;processed?:ProductBuildArtifactRecordV1}){
  const a=await readAvgImageConsumptionDefinitionV4({...input,buildId:input.raw.buildId})
  if(!a.mediaBatch.visualReviewPolicy)throw new Error('[avg-review] 当前冻结批次没有视觉评审合同')
  const report=parseAvgAuthorVisualReviewV1(input.payload),raw=await assertAvgConsumedRawImageV4({...input,row:input.raw}),r=raw.payload.requirement
  const needsProcessing=a.imageProcessing?.entries.some(e=>e.requirementKey===r.requirementKey)
  const processed=needsProcessing?(input.processed?await inspectAvgProcessedImageSourceV1({...input,processed:input.processed}):await readAvgProcessedImageSourceV1({...input,buildId:input.raw.buildId})):undefined
  if(!needsProcessing&&input.processed)throw new Error('[avg-process] 评审不能夹带未冻结加工')
  const image=processed?.row??input.raw,asset=processed?.asset??raw.asset
  assertAvgVisualReviewScopeV1(report,r,image.contentHash)
  if(report.visualEvidence!.imageHash){
    const blob=image.blobObjectId===null?null:await db.mediaBlobObjects.get(image.blobObjectId)
    if(!blob||!await assertRecordInScope(input.scope,'mediaBlobObjects',blob,{owner:'work'})||blob.contentHash!==asset.contentHash||blob.mimeType!==asset.mimeType||blob.byteSize!==asset.byteSize)throw new Error('[avg-review] 评审图片字节不存在或跨作品')
    const inspect=async()=>inspectAvgImageBytesV1({data:await readVerifiedMediaBlobObjectData(blob),...asset})
    const measured=Dexie.currentTransaction?await Dexie.waitFor(Dexie.ignoreTransaction(inspect),20_000):await inspect()
    const technicalFailure=measured.width<r.width||measured.height<r.height||Math.abs(measured.width/measured.height/(r.width/r.height)-1)>0.02||r.alpha==='required'&&!measured.hasAlpha
    if(technicalFailure&&!report.unobserved.length&&!report.issues.some(issue=>issue.severity==='blocking'))throw new Error('[avg-review] 尺寸、画幅或透明要求未满足，请记录 blocking 返修问题')
  }
  for(const reference of r.references){
    if(!report.visualEvidence!.referenceHashes.includes(reference.contentHash))continue
    await validateAvgGeneratedReferencesV1(input.scope,[reference],r.family)
    const data=await readAvgDraftReferenceBytesV1(input.scope,reference)
    const inspect=()=>inspectAvgImageBytesV1({data,...reference})
    if(Dexie.currentTransaction)await Dexie.waitFor(Dexie.ignoreTransaction(inspect),20_000);else await inspect()
  }
  return report
}
