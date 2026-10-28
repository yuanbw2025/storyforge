import type { AvgPresentationContentV1, FrozenRuntimeMediaAssetV2, ProductMediaAsset } from '../types'
import { parseAvgPresentationContent } from './runtime'
import { freezeProductMediaAsset } from '../product-production/media-contracts'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgHash, avgKey, avgList, avgRecord, avgUnique } from './protocol-validation'

export type AvgExecutableStageV1 = AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
/** Portable, strict stage metadata. Rule/script closure is checked by the executable compiler. */
export function parseAvgExecutableStageV1(value: unknown): AvgExecutableStageV1 {
  const stageRow = avgRecord(value, ['version','cues','assets'], 'stage')
  const rawCues = avgList(stageRow.cues, 'stage.cues', value => value, 50_000)
  const content = parseAvgPresentationContent(stageRow)
  rawCues.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.prototype.hasOwnProperty.call(content.cues[index], key))) throw new Error('[avg] Cue 含未知字段')
    if (content.cues[index].snapshotKey != null) {
      const key = avgKey(content.cues[index].snapshotKey, 'snapshotKey')
      if (['__proto__','prototype','constructor'].includes(key)) throw new Error('[avg] snapshotKey 为保留键')
    }
  })
  const assets = avgUnique(avgList(stageRow.assets, 'stage.assets', value => {
    if (!value || typeof value !== 'object') throw new Error('[avg] stage asset 无效')
    const raw = value as Record<string, unknown>
    const blobContentHash = avgHash(raw.blobContentHash, 'blobContentHash')
    const frozen = freezeProductMediaAsset(raw as unknown as ProductMediaAsset)
    avgKey(frozen.assetKey, 'assetKey')
    if (['constructor','prototype'].includes(frozen.assetKey)) throw new Error('[avg] assetKey 为保留键')
    if (frozen.contentHash !== blobContentHash || canonicalProductProductionJsonV2({ ...frozen, blobContentHash }) !== canonicalProductProductionJsonV2(raw)) throw new Error('[avg] stage asset 字段/hash 无效')
    return { ...frozen, blobContentHash }
  }, 10_000), asset => asset.assetKey, 'stage.assets')
  return { ...content, assets }
}
