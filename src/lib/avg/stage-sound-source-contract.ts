import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { avgHash, avgKey, avgList, avgNumber, avgRecord, avgText, avgUnique } from './protocol-validation'

type Ref = { artifactKey: string; version: number; contentHash: string }
type AdoptedRef = Ref & { authorReceiptHash: string }

/** Portable original locators, not new production or author authority. */
export interface AvgGeneratedSoundSourceV1 {
  schema: 'storyforge.avg.generated-sound-source'; version: 1
  productionKey: string; buildNumber: number; controlEpoch: number; briefHash: string; planHash: string
  requirementKey: string; requestIdentityHash: string
  raw: Ref & { producerReceiptHash: string; responseEvidenceHash: string; requestSnapshotHash: string; rightsHash: string }
  compiled: Ref; review: AdoptedRef; choice: AdoptedRef
}
export interface AvgInheritedStageSoundV1 {
  assetKey: string; source: AvgGeneratedSoundSourceV1; declaration: string
}

export function parseAvgGeneratedSoundSourceV1(value: unknown): AvgGeneratedSoundSourceV1 {
  const r = avgRecord(value, ['schema', 'version', 'productionKey', 'buildNumber', 'controlEpoch', 'briefHash', 'planHash',
    'requirementKey', 'requestIdentityHash', 'raw', 'compiled', 'review', 'choice'], 'generated sound source')
  if (r.schema !== 'storyforge.avg.generated-sound-source' || r.version !== 1) throw new Error('[avg-sound] 已采用声音来源版本无效')
  const requirementKey = avgKey(r.requirementKey, 'sound source requirement')
  const reference = (value: unknown, key: string, extra: string[] = []) => {
    const row = avgRecord(value, ['artifactKey', 'version', 'contentHash', ...extra], 'sound source reference')
    if (row.artifactKey !== key) throw new Error('[avg-sound] 沿用必须绑定同一需求的准确原音频、编译、审听与选用')
    return { artifactKey: key, version: avgNumber(row.version, 'sound source version', 1, 1e6), contentHash: avgHash(row.contentHash, 'sound source hash'),
      ...Object.fromEntries(extra.map(k => [k, avgHash(row[k], `sound source ${k}`)])) }
  }
  const raw = reference(r.raw, `avg.sound.raw.${requirementKey}`, ['producerReceiptHash', 'responseEvidenceHash', 'requestSnapshotHash', 'rightsHash']) as AvgGeneratedSoundSourceV1['raw']
  return { schema: r.schema, version: 1, productionKey: avgKey(r.productionKey, 'sound source production'),
    buildNumber: avgNumber(r.buildNumber, 'sound source build', 1, 1e9), controlEpoch: avgNumber(r.controlEpoch, 'sound source epoch', 0, 1e9),
    briefHash: avgHash(r.briefHash, 'sound source brief'), planHash: avgHash(r.planHash, 'sound source plan'), requirementKey,
    requestIdentityHash: avgHash(r.requestIdentityHash, 'sound source identity'), raw,
    compiled: reference(r.compiled, 'avg.media.compiled-sound-requirements'),
    review: reference(r.review, `avg.review.audio.${requirementKey}`, ['authorReceiptHash']) as AdoptedRef,
    choice: reference(r.choice, `avg.sound.choice.${requirementKey}`, ['authorReceiptHash']) as AdoptedRef }
}

/** Absent extension preserves every old stage payload/hash. */
export function parseAvgInheritedStageSoundsV1(value: unknown, assets: FrozenRuntimeMediaAssetV2[]): AvgInheritedStageSoundV1[] {
  return avgUnique(avgList(value, 'inheritedSounds', value => {
    const row = avgRecord(value, ['assetKey', 'source', 'declaration'], 'inherited stage sound')
    const assetKey = avgKey(row.assetKey, 'inherited sound asset'), source = parseAvgGeneratedSoundSourceV1(row.source)
    const asset = assets.find(a => a.assetKey === assetKey)
    if (!asset || !['bgm', 'ambience', 'sfx'].includes(asset.kind) || !['audio/wav', 'audio/ogg'].includes(asset.mimeType)
      || asset.contentHash !== source.raw.contentHash || asset.blobContentHash !== source.raw.contentHash) {
      throw new Error('[avg-sound] 沿用声音须绑定目录中准确的原始WAV/OGG')
    }
    return { assetKey, source, declaration: avgText(row.declaration, 'inherited sound declaration', 2000) }
  }, 128), row => row.assetKey, 'inherited stage sounds')
}
