import { avgHash, avgKey, avgKeys, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import type { AvgVoiceProductionBatchV1 } from './voice-production-contract'

/** Portable producer witness from the existing historical media reader.
 * It is an exact locator/proof, never an adoption or retransmission grant. */
export interface AvgRetainedVoiceProofV1 {
  schema: 'storyforge.avg.historical-raw-voice-proof'; version: 1
  buildNumber: number; briefHash: string; planHash: string; controlEpoch: number
  taskKey: string; artifactKey: string; artifactVersion: number; contentHash: string
  inputHash: string; producerReceiptHash: string; candidateHash: string; proofHash: string
}
export interface AvgVoiceRecoveryV1 {
  schema: 'storyforge.avg.voice-recovery'; version: 1
  sourceBuildNumber: number; sourceBuildRevision: number; sourceBriefHash: string; sourcePlanHash: string
  sourceControlEpoch: number; sourceVoiceHash: string
  retained: Array<{ requirementKey: string; proof: AvgRetainedVoiceProofV1 }>
  rerunRequirementKeys: string[]
  declaration: string
}

export function parseAvgRetainedVoiceProofV1(value: unknown): AvgRetainedVoiceProofV1 {
  const r = avgRecord(value, ['schema', 'version', 'buildNumber', 'briefHash', 'planHash', 'controlEpoch', 'taskKey',
    'artifactKey', 'artifactVersion', 'contentHash', 'inputHash', 'producerReceiptHash', 'candidateHash', 'proofHash'], 'retained voice proof')
  if (r.schema !== 'storyforge.avg.historical-raw-voice-proof' || r.version !== 1) throw new Error('[avg-voice] 保留配音证明版本无效')
  return { schema: r.schema, version: 1, buildNumber: avgNumber(r.buildNumber, 'buildNumber', 1, 1e9),
    briefHash: avgHash(r.briefHash, 'briefHash'), planHash: avgHash(r.planHash, 'planHash'),
    controlEpoch: avgNumber(r.controlEpoch, 'controlEpoch', 0, 1e9), taskKey: avgKey(r.taskKey, 'taskKey'),
    artifactKey: avgKey(r.artifactKey, 'artifactKey'), artifactVersion: avgNumber(r.artifactVersion, 'artifactVersion', 1, 1e9),
    contentHash: avgHash(r.contentHash, 'contentHash'), inputHash: avgHash(r.inputHash, 'inputHash'),
    producerReceiptHash: avgHash(r.producerReceiptHash, 'producerReceiptHash'),
    candidateHash: avgHash(r.candidateHash, 'candidateHash'), proofHash: avgHash(r.proofHash, 'proofHash') }
}

export function parseAvgVoiceRecoveryV1(value: unknown, batch: AvgVoiceProductionBatchV1): AvgVoiceRecoveryV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'sourceBuildNumber', 'sourceBuildRevision', 'sourceBriefHash',
    'sourcePlanHash', 'sourceControlEpoch', 'sourceVoiceHash', 'retained', 'rerunRequirementKeys', 'declaration'], 'voice recovery')
  if (r.schema !== 'storyforge.avg.voice-recovery' || r.version !== 1) throw new Error('[avg-voice] 配音恢复版本无效')
  const sourceBuildNumber = avgNumber(r.sourceBuildNumber, 'sourceBuildNumber', 1, 1e9)
  const sourceControlEpoch = avgNumber(r.sourceControlEpoch, 'sourceControlEpoch', 0, 1e9)
  const sourceBriefHash = avgHash(r.sourceBriefHash, 'sourceBriefHash'), sourcePlanHash = avgHash(r.sourcePlanHash, 'sourcePlanHash')
  const retained = avgUnique(avgList(r.retained, 'retained', value => {
    const item = avgRecord(value, ['requirementKey', 'proof'], 'retained voice'), requirementKey = avgKey(item.requirementKey, 'requirementKey')
    const proof = parseAvgRetainedVoiceProofV1(item.proof)
    if (proof.buildNumber !== sourceBuildNumber || proof.controlEpoch !== sourceControlEpoch || proof.briefHash !== sourceBriefHash
      || proof.planHash !== sourcePlanHash || proof.artifactKey !== `avg.voice.raw.${requirementKey}`
      || proof.taskKey !== `avg.voice.generate.${requirementKey}`) throw new Error('[avg-voice] 保留配音证明与准确恢复来源不一致')
    return { requirementKey, proof }
  }, 8), item => item.requirementKey, 'retained voice')
  const rerunRequirementKeys = avgKeys(r.rerunRequirementKeys, 'rerunRequirementKeys')
  const keys = [...retained.map(item => item.requirementKey), ...rerunRequirementKeys]
  if (keys.length !== batch.requirements.length || new Set(keys).size !== keys.length
    || batch.requirements.some(item => !keys.includes(item.requirementKey))) throw new Error('[avg-voice] 恢复必须明确逐项覆盖本批保留或重做的句子')
  return { schema: r.schema, version: 1, sourceBuildNumber, sourceControlEpoch, sourceBriefHash, sourcePlanHash,
    sourceBuildRevision: avgNumber(r.sourceBuildRevision, 'sourceBuildRevision', 0, 1e9),
    sourceVoiceHash: avgHash(r.sourceVoiceHash, 'sourceVoiceHash'), retained, rerunRequirementKeys,
    declaration: avgText(r.declaration, 'declaration', 2000) }
}
