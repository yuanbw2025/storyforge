import { avgHash, avgKey, avgKeys, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import type { AvgVisualProductionBatchV1 } from './media-production-contract'

/** Portable historical proof. Local Build/Run/Blob IDs never enter a Brief. */
export interface AvgRetainedRawProofV1 {
  schema: 'storyforge.avg.retained-raw-image-proof'; version: 1
  buildNumber: number; briefHash: string; planHash: string; controlEpoch: number
  taskKey: string; artifactKey: string; artifactVersion: number; contentHash: string
  inputHash: string; producerReceiptHash: string; candidateHash: string; proofHash: string
}
export interface AvgImageRecoveryV1 {
  schema: 'storyforge.avg.image-recovery'; version: 1
  sourceBuildNumber: number; sourceBuildRevision: number; sourceBriefHash: string; sourcePlanHash: string
  sourceControlEpoch: number; sourceBatchHash: string
  retained: Array<{ requirementKey: string; proof: AvgRetainedRawProofV1 }>
  rerunRequirementKeys: string[]
  declaration: string
}
export function parseAvgRetainedRawProofV1(value: unknown): AvgRetainedRawProofV1 {
  const r = avgRecord(value, ['schema','version','buildNumber','briefHash','planHash','controlEpoch','taskKey','artifactKey','artifactVersion',
    'contentHash','inputHash','producerReceiptHash','candidateHash','proofHash'], 'retained raw proof')
  if (r.schema !== 'storyforge.avg.retained-raw-image-proof' || r.version !== 1) throw new Error('[avg-media] 保留原图证明版本无效')
  return { schema:r.schema,version:1,buildNumber:avgNumber(r.buildNumber,'buildNumber',1,1e9),briefHash:avgHash(r.briefHash,'briefHash'),
    planHash:avgHash(r.planHash,'planHash'),controlEpoch:avgNumber(r.controlEpoch,'controlEpoch',0,1e9),taskKey:avgKey(r.taskKey,'taskKey'),
    artifactKey:avgKey(r.artifactKey,'artifactKey'),artifactVersion:avgNumber(r.artifactVersion,'artifactVersion',1,1e9),contentHash:avgHash(r.contentHash,'contentHash'),
    inputHash:avgHash(r.inputHash,'inputHash'),producerReceiptHash:avgHash(r.producerReceiptHash,'producerReceiptHash'),
    candidateHash:avgHash(r.candidateHash,'candidateHash'),proofHash:avgHash(r.proofHash,'proofHash') }
}
export function parseAvgImageRecoveryV1(value: unknown, batch: AvgVisualProductionBatchV1): AvgImageRecoveryV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema','version','sourceBuildNumber','sourceBuildRevision','sourceBriefHash','sourcePlanHash',
    'sourceControlEpoch','sourceBatchHash','retained','rerunRequirementKeys','declaration'], 'image recovery')
  if (r.schema !== 'storyforge.avg.image-recovery' || r.version !== 1) throw new Error('[avg-media] 图片恢复版本无效')
  const sourceBuildNumber=avgNumber(r.sourceBuildNumber,'sourceBuildNumber',1,1e9),sourceControlEpoch=avgNumber(r.sourceControlEpoch,'sourceControlEpoch',0,1e9)
  const sourceBriefHash=avgHash(r.sourceBriefHash,'sourceBriefHash'),sourcePlanHash=avgHash(r.sourcePlanHash,'sourcePlanHash')
  const retained=avgUnique(avgList(r.retained,'retained',value=>{
    const row=avgRecord(value,['requirementKey','proof'],'retained image'),requirementKey=avgKey(row.requirementKey,'requirementKey'),proof=parseAvgRetainedRawProofV1(row.proof)
    if (proof.buildNumber!==sourceBuildNumber||proof.controlEpoch!==sourceControlEpoch||proof.briefHash!==sourceBriefHash||proof.planHash!==sourcePlanHash
      ||proof.artifactKey!==`avg.media.raw.${requirementKey}`) throw new Error('[avg-media] 保留原图证明与恢复来源不一致')
    return {requirementKey,proof}
  },8),row=>row.requirementKey,'retained')
  const rerunRequirementKeys=avgKeys(r.rerunRequirementKeys,'rerunRequirementKeys'),keys=[...retained.map(r=>r.requirementKey),...rerunRequirementKeys]
  if (!retained.length||keys.length!==batch.requirements.length||new Set(keys).size!==keys.length
    ||batch.requirements.some(r=>!keys.includes(r.requirementKey))) throw new Error('[avg-media] 恢复必须明确覆盖每项需求，且至少保留一张原图')
  return {schema:r.schema,version:1,sourceBuildNumber,sourceBuildRevision:avgNumber(r.sourceBuildRevision,'sourceBuildRevision',0,1e9),sourceBriefHash,
    sourcePlanHash,sourceControlEpoch,sourceBatchHash:avgHash(r.sourceBatchHash,'sourceBatchHash'),retained,rerunRequirementKeys,declaration:avgText(r.declaration,'declaration',2000)}
}
