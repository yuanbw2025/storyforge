import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { parseAvgSoundChannelV1 } from './sound-plan-contract'

export interface AvgAuthorSoundChoiceV1 {
  schema: 'storyforge.avg.sound-choice'; version: 1; requirementKey: string; requestIdentityHash: string
  raw: { artifactKey: string; version: number; contentHash: string }
  review: { artifactKey: string; version: number; contentHash: string }
  asset: FrozenRuntimeMediaAssetV2; declaration: string
}

/** Inert proposal. Actual raw producer, review/adoption receipts and physical
 * Blob bytes must be read by the service before any formal consumption. */
export function parseAvgAuthorSoundChoiceV1(value: unknown): AvgAuthorSoundChoiceV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'requirementKey', 'requestIdentityHash', 'raw', 'review', 'asset', 'declaration'], 'sound choice')
  if (r.schema !== 'storyforge.avg.sound-choice' || r.version !== 1) throw new Error('[avg-sound] 声音选择版本无效')
  const requirementKey = avgKey(r.requirementKey, 'sound choice requirement')
  const reference = (input: unknown, prefix: string) => {
    const row = avgRecord(input, ['artifactKey', 'version', 'contentHash'], 'sound evidence reference')
    const key = avgKey(prefix + requirementKey, 'sound evidence key')
    if (row.artifactKey !== key) throw new Error('[avg-sound] 声音选择必须引用同一需求的原始音频与审听版本')
    return { artifactKey: key, version: avgNumber(row.version, 'sound evidence version', 1, 1e6), contentHash: avgHash(row.contentHash, 'sound evidence hash') }
  }
  const raw = reference(r.raw, 'avg.sound.raw.'), review = reference(r.review, 'avg.review.audio.')
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [r.asset] }).assets[0]!
  parseAvgSoundChannelV1(asset.kind)
  if (!['audio/wav', 'audio/ogg'].includes(asset.mimeType) || asset.contentHash !== raw.contentHash || asset.width !== null || asset.height !== null
    || asset.durationMs === null || !Number.isSafeInteger(asset.durationMs) || asset.durationMs < 1 || asset.durationMs > 120_000
    || asset.byteSize < (asset.mimeType === 'audio/wav' ? 44 : 27) || asset.byteSize > 32 * 1024 * 1024) throw new Error('[avg-sound] 声音选择必须绑定准确有界的原始WAV/OGG')
  return { schema: r.schema, version: 1, requirementKey, requestIdentityHash: avgHash(r.requestIdentityHash, 'sound request identity'),
    raw, review, asset, declaration: avgText(r.declaration, 'sound choice declaration', 4000) }
}
