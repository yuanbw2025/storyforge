import { avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgVoiceRecoveryV1, type AvgVoiceRecoveryV1 } from './voice-recovery-contract'
import type { AvgVoiceProductionBatchV1 } from './voice-production-contract'

/** Explicit single-line, zero-request successor of an adopted frozen voice.
 * The original producer Build and the current preview parent can differ. */
export interface AvgVoiceLocalRepairV2 extends Omit<AvgVoiceRecoveryV1, 'version' | 'rerunRequirementKeys'> {
  version: 2
  sourceProductionKey: string
  targetVoiceHash: string
  parentBuildNumber: number
  parentPreviewHash: string
  parentManifestHash: string
  adoptedChoice: { payloadVersion: 1 | 2; artifactKey: string; version: number; contentHash: string; authorReceiptHash: string }
  rerunRequirementKeys: []
}
export type AvgVoiceRecovery = AvgVoiceRecoveryV1 | AvgVoiceLocalRepairV2

/** Strict successor codec. V1 itself still rejects new fields and versions. */
export function parseAvgVoiceLocalRepairV2(value: unknown, batch: AvgVoiceProductionBatchV1): AvgVoiceLocalRepairV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'sourceBuildNumber', 'sourceBuildRevision', 'sourceBriefHash',
    'sourcePlanHash', 'sourceControlEpoch', 'sourceVoiceHash', 'retained', 'rerunRequirementKeys', 'declaration',
    'sourceProductionKey', 'targetVoiceHash', 'parentBuildNumber', 'parentPreviewHash', 'parentManifestHash', 'adoptedChoice'], 'local voice repair')
  if (r.schema !== 'storyforge.avg.voice-recovery' || r.version !== 2) throw new Error('[avg-voice-repair] 局部返修方案版本无效')
  const { sourceProductionKey, targetVoiceHash, parentBuildNumber, parentPreviewHash, parentManifestHash, adoptedChoice, ...base } = r
  const common = parseAvgVoiceRecoveryV1({ ...base, version: 1 }, batch)
  if (batch.requirements.length !== 1 || common.retained.length !== 1 || common.rerunRequirementKeys.length) {
    throw new Error('[avg-voice-repair] 本地返修只处理明确的一句已生成配音，不能夹带新请求')
  }
  const choice = avgRecord(adoptedChoice, ['payloadVersion', 'artifactKey', 'version', 'contentHash', 'authorReceiptHash'], 'local repair adopted choice')
  if (choice.artifactKey !== `avg.voice.choice.${batch.requirements[0].requirementKey}`) throw new Error('[avg-voice-repair] 返修缺少准确原采用版本')
  return { ...common, version: 2, sourceProductionKey: avgKey(sourceProductionKey, 'local repair source production'),
    targetVoiceHash: avgHash(targetVoiceHash, 'local repair target voice'),
    parentBuildNumber: avgNumber(parentBuildNumber, 'local repair parent build', 1, 1e9),
    parentPreviewHash: avgHash(parentPreviewHash, 'local repair parent preview'), parentManifestHash: avgHash(parentManifestHash, 'local repair parent manifest'),
    adoptedChoice: { payloadVersion: avgNumber(choice.payloadVersion, 'local repair choice version', 1, 2) as 1 | 2,
      artifactKey: choice.artifactKey, version: avgNumber(choice.version, 'local repair adopted version', 1, 1e9),
      contentHash: avgHash(choice.contentHash, 'local repair adopted hash'), authorReceiptHash: avgHash(choice.authorReceiptHash, 'local repair author receipt') },
    rerunRequirementKeys: [] }
}

export function parseAvgVoiceRecovery(value: unknown, batch: AvgVoiceProductionBatchV1): AvgVoiceRecovery {
  return (avgProtocolBody(value) as { version?: unknown } | null)?.version === 2
    ? parseAvgVoiceLocalRepairV2(value, batch) : parseAvgVoiceRecoveryV1(value, batch)
}
export const avgVoiceRecoveryParentNumber = (r: AvgVoiceRecovery) => r.version === 2 ? r.parentBuildNumber : r.sourceBuildNumber
