import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { avgRawVoiceArtifactKeyV1, avgVoiceReviewArtifactKeyV1 } from './voice-assembly-contract'

export interface AvgAuthorVoiceChoiceV1 {
  schema: 'storyforge.avg.voice-choice'
  version: 1
  requirementKey: string
  requestIdentityHash: string
  raw: { artifactKey: string; version: number; contentHash: string }
  review: { artifactKey: string; version: number; contentHash: string }
  asset: FrozenRuntimeMediaAssetV2
  declaration: string
}

/** An explicit choice proposal, never a self-issued adoption/playback receipt. */
export function parseAvgAuthorVoiceChoiceV1(value: unknown): AvgAuthorVoiceChoiceV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'requirementKey', 'requestIdentityHash', 'raw', 'review', 'asset', 'declaration'], 'author voice choice')
  if (r.schema !== 'storyforge.avg.voice-choice' || r.version !== 1) throw new Error('[avg-voice] 作者配音选择版本无效')
  const requirementKey = avgKey(r.requirementKey, 'voice choice requirement')
  const raw = avgRecord(r.raw, ['artifactKey', 'version', 'contentHash'], 'voice raw reference')
  const review = avgRecord(r.review, ['artifactKey', 'version', 'contentHash'], 'voice review reference')
  if (raw.artifactKey !== avgRawVoiceArtifactKeyV1(requirementKey) || review.artifactKey !== avgVoiceReviewArtifactKeyV1(requirementKey)) {
    throw new Error('[avg-voice] 配音选择须引用准确的原始音频和审听版本')
  }
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [r.asset] }).assets[0]!
  if (asset.kind !== 'voice' || asset.mimeType !== 'audio/wav' || asset.contentHash !== raw.contentHash
    || asset.width !== null || asset.height !== null || asset.durationMs === null || !Number.isSafeInteger(asset.durationMs)
    || asset.durationMs < 1 || asset.durationMs > 120_000 || asset.byteSize < 44 || asset.byteSize > 32 * 1024 * 1024) {
    throw new Error('[avg-voice] 选择的配音媒资不是准确的有界原始音频')
  }
  return { schema: r.schema, version: 1, requirementKey, requestIdentityHash: avgHash(r.requestIdentityHash, 'voice choice request identity'),
    raw: { artifactKey: raw.artifactKey as string, version: avgNumber(raw.version, 'voice raw version', 1, 1_000_000), contentHash: avgHash(raw.contentHash, 'voice raw hash') },
    review: { artifactKey: review.artifactKey as string, version: avgNumber(review.version, 'voice review version', 1, 1_000_000), contentHash: avgHash(review.contentHash, 'voice review hash') },
    asset, declaration: avgText(r.declaration, 'voice choice declaration', 4000) }
}
