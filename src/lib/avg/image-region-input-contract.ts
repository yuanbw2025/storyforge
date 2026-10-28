import type { FrozenRuntimeMediaAssetV2 } from '../types'
import type { AvgMediaReferenceV2 } from './media-reference-contract-v2'
import { parseAvgMediaReferencesV2 } from './media-reference-contract-v2'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord } from './protocol-validation'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'

export interface AvgRegionInputEvidenceV1 {
  schema: 'storyforge.avg.region-input-evidence'; version: 1
  raw: { productionKey: string; buildNumber: number; briefHash: string; planHash: string; controlEpoch: number;
    artifactKey: string; version: number; contentHash: string; producerReceiptHash: string }
  sourceAsset: FrozenRuntimeMediaAssetV2
  base: { reference: AvgMediaReferenceV2; asset: FrozenRuntimeMediaAssetV2 }
}
/** Portable metadata, not producer/Work authority. Recovered consumers must
 * re-read the actual original/current source and compare this exact evidence. */
export function parseAvgRegionInputEvidenceV1(value: unknown, requirementKey: string): AvgRegionInputEvidenceV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'raw', 'sourceAsset', 'base'], 'region input evidence')
  if (r.schema !== 'storyforge.avg.region-input-evidence' || r.version !== 1) throw new Error('[avg-composite] 两输入来源版本无效')
  const raw = avgRecord(r.raw, ['productionKey', 'buildNumber', 'briefHash', 'planHash', 'controlEpoch', 'artifactKey', 'version', 'contentHash', 'producerReceiptHash'], 'region raw origin')
  if (raw.artifactKey !== `avg.media.raw.${avgKey(requirementKey, 'region requirementKey')}`) throw new Error('[avg-composite] 两输入来源不属于准确原图')
  const base = avgRecord(r.base, ['reference', 'asset'], 'region base origin')
  const reference = parseAvgMediaReferencesV2([base.reference])[0]!
  const sourceAsset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [r.sourceAsset] }).assets[0]!
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [base.asset] }).assets[0]!
  if (sourceAsset.kind !== 'character-expression' || sourceAsset.contentHash !== raw.contentHash || reference.purpose !== 'identity' || !reference.generatedSource
    || !['character-pose', 'character-expression'].includes(asset.kind)
    || canonicalProductProductionJsonV2([reference.assetKey, reference.assetVersion, reference.contentHash, reference.mimeType, reference.byteSize, reference.license])
      !== canonicalProductProductionJsonV2([asset.assetKey, asset.version, asset.contentHash, asset.mimeType, asset.byteSize, asset.license])) throw new Error('[avg-composite] 两输入元数据缺少准确原图或已采用身份基准')
  return { schema: r.schema, version: 1, sourceAsset, base: { reference, asset }, raw: {
    productionKey: avgKey(raw.productionKey, 'region source productionKey'), buildNumber: avgNumber(raw.buildNumber, 'region source buildNumber', 1, 1e9),
    briefHash: avgHash(raw.briefHash, 'region source briefHash'), planHash: avgHash(raw.planHash, 'region source planHash'),
    controlEpoch: avgNumber(raw.controlEpoch, 'region source epoch', 0, 1e9), artifactKey: raw.artifactKey,
    version: avgNumber(raw.version, 'region raw version', 1, 1e9), contentHash: avgHash(raw.contentHash, 'region raw hash'),
    producerReceiptHash: avgHash(raw.producerReceiptHash, 'region raw producer') } }
}
