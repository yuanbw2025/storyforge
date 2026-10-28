import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { avgHash, avgKey, avgList, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import { parseAvgRetainedVoiceProofV1, type AvgRetainedVoiceProofV1 } from './voice-recovery-contract'
import { parseAvgGeneratedVoiceSourceV1, parseAvgInheritedStageVoicesV1,
  type AvgGeneratedVoiceSourceV1, type AvgInheritedStageVoiceV1 } from './stage-voice-source-contract'

export interface AvgRetainedVoiceProcessingProofV1 extends Omit<AvgRetainedVoiceProofV1, 'schema'> {
  schema: 'storyforge.avg.audio-processing-producer-proof'
  noProviderRequest: true
  processingEvidenceHash: string
}
export interface AvgGeneratedVoiceSourceV2 extends Omit<AvgGeneratedVoiceSourceV1, 'version'> {
  version: 2
  processing: AvgRetainedVoiceProcessingProofV1
}
export type AvgGeneratedVoiceSource = AvgGeneratedVoiceSourceV1 | AvgGeneratedVoiceSourceV2
export interface AvgInheritedStageVoice extends Omit<AvgInheritedStageVoiceV1, 'source'> { source: AvgGeneratedVoiceSource }

/** Distinct portable locator for an adopted derivative. Both actual producers,
 * original author receipts and physical bytes must still be proved on read. */
export function parseAvgGeneratedVoiceSourceV2(value: unknown): AvgGeneratedVoiceSourceV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'productionKey', 'requirementKey',
    'requestIdentityHash', 'raw', 'review', 'choice', 'processing'], 'processed generated voice source')
  if (r.version !== 2) throw new Error('[avg-voice-process] 加工配音沿用来源须为独立版本')
  const base = parseAvgGeneratedVoiceSourceV1({ schema: r.schema, version: 1, productionKey: r.productionKey,
    requirementKey: r.requirementKey, requestIdentityHash: r.requestIdentityHash, raw: r.raw, review: r.review, choice: r.choice })
  const p = avgRecord(r.processing, ['schema', 'version', 'noProviderRequest', 'buildNumber', 'briefHash', 'planHash',
    'controlEpoch', 'taskKey', 'artifactKey', 'artifactVersion', 'contentHash', 'inputHash', 'producerReceiptHash',
    'candidateHash', 'proofHash', 'processingEvidenceHash'], 'retained voice processing proof')
  if (p.schema !== 'storyforge.avg.audio-processing-producer-proof' || p.noProviderRequest !== true) {
    throw new Error('[avg-voice-process] 加工配音须保留独立零请求producer证明')
  }
  const { schema: _schema, noProviderRequest: _noRequest, processingEvidenceHash, ...fields } = p
  const common = parseAvgRetainedVoiceProofV1({ ...fields, schema: 'storyforge.avg.historical-raw-voice-proof' })
  if (common.taskKey !== `avg.voice.process.${base.requirementKey}` || common.artifactKey !== `avg.voice.processed.${base.requirementKey}`
    || common.buildNumber !== base.raw.buildNumber || common.briefHash !== base.raw.briefHash
    || common.planHash !== base.raw.planHash || common.controlEpoch !== base.raw.controlEpoch) {
    throw new Error('[avg-voice-process] 加工配音与原件的准确需求、版本或冻结生产图不一致')
  }
  return { ...base, version: 2, processing: { ...common, schema: 'storyforge.avg.audio-processing-producer-proof',
    noProviderRequest: true, processingEvidenceHash: avgHash(processingEvidenceHash, 'voice processing evidence hash') } }
}

export function parseAvgGeneratedVoiceSource(value: unknown): AvgGeneratedVoiceSource {
  return (avgProtocolBody(value) as { version?: unknown } | null)?.version === 2
    ? parseAvgGeneratedVoiceSourceV2(value) : parseAvgGeneratedVoiceSourceV1(value)
}

/** V1 remains strict. Optional successor entries bind the derived hash instead
 * of relabelling it as the original audio. No host IDs enter this locator. */
export function parseAvgInheritedStageVoices(value: unknown, assets: FrozenRuntimeMediaAssetV2[]): AvgInheritedStageVoice[] {
  return avgUnique(avgList(value, 'inheritedVoices', value => {
    const r = avgRecord(value, ['assetKey', 'source', 'declaration'], 'inherited voice')
    if ((r.source as { version?: unknown } | null)?.version !== 2) return parseAvgInheritedStageVoicesV1([r], assets)[0]!
    const source = parseAvgGeneratedVoiceSourceV2(r.source), assetKey = avgKey(r.assetKey, 'inherited processed voice asset')
    const asset = assets.find(a => a.assetKey === assetKey)
    if (asset?.kind !== 'voice' || asset.mimeType !== 'audio/wav' || asset.contentHash !== source.processing.contentHash
      || asset.blobContentHash !== source.processing.contentHash) throw new Error('[avg-voice-process] 沿用须绑定准确加工音频字节')
    return { assetKey, source, declaration: avgText(r.declaration, 'inherited processed voice declaration', 2000) }
  }, 128), e => e.assetKey, 'inherited stage voices')
}
