import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { avgHash, avgKey, avgNumber, avgProtocolBody, avgRecord, avgText } from './protocol-validation'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { parseAvgSoundChannelV1 } from './sound-plan-contract'
import { avgProcessedAudioArtifactKeyV1, type AvgAudioProcessingDomainV1 } from './audio-production-contract'

type Ref = { artifactKey: string; version: number; contentHash: string }
interface AvgProcessedAudioChoiceFieldsV2 {
  version: 2; requirementKey: string; requestIdentityHash: string
  raw: Ref; processed: Ref & { recipeHash: string; receiptHash: string }; review: Ref
  asset: FrozenRuntimeMediaAssetV2; declaration: string
}
export interface AvgAuthorVoiceChoiceV2 extends AvgProcessedAudioChoiceFieldsV2 { schema: 'storyforge.avg.voice-choice' }
export interface AvgAuthorSoundChoiceV2 extends AvgProcessedAudioChoiceFieldsV2 { schema: 'storyforge.avg.sound-choice' }

/** Inert explicit successor choices. They bind raw and derived versions
 * separately and grant no producer/adoption authority. An actual reader must
 * prove both producers, frozen recipe, owned bytes and an independent review
 * of the chosen derived hash. V1 codecs still reject these versions/fields. */
export function parseAvgAuthorVoiceChoiceV2(value: unknown): AvgAuthorVoiceChoiceV2 {
  return { schema: 'storyforge.avg.voice-choice', ...parse(value, 'voice') }
}
export function parseAvgAuthorSoundChoiceV2(value: unknown): AvgAuthorSoundChoiceV2 {
  return { schema: 'storyforge.avg.sound-choice', ...parse(value, 'sound') }
}

function parse(value: unknown, domain: AvgAudioProcessingDomainV1): AvgProcessedAudioChoiceFieldsV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'requirementKey', 'requestIdentityHash', 'raw', 'processed', 'review', 'asset', 'declaration'], 'processed audio choice')
  if (r.schema !== `storyforge.avg.${domain}-choice` || r.version !== 2) throw new Error('[avg-audio-process] 加工音频选择须使用准确独立版本')
  const requirementKey = avgKey(r.requirementKey, 'processed choice requirement')
  const reference = (value: unknown, artifactKey: string): Ref => {
    const row = avgRecord(value, ['artifactKey', 'version', 'contentHash'], 'audio choice reference')
    if (row.artifactKey !== artifactKey) throw new Error('[avg-audio-process] 原音频、加工音频和独立评审须属于准确同一需求')
    return { artifactKey, version: avgNumber(row.version, 'audio choice reference version', 1, 1e6), contentHash: avgHash(row.contentHash, 'audio choice reference hash') }
  }
  const raw = reference(r.raw, `avg.${domain}.raw.${requirementKey}`)
  const p = avgRecord(r.processed, ['artifactKey', 'version', 'contentHash', 'recipeHash', 'receiptHash'], 'processed choice reference')
  const processed = { ...reference({ artifactKey: p.artifactKey, version: p.version, contentHash: p.contentHash }, avgProcessedAudioArtifactKeyV1(domain, requirementKey)),
    recipeHash: avgHash(p.recipeHash, 'chosen audio recipe'), receiptHash: avgHash(p.receiptHash, 'chosen audio processing receipt') }
  const review = reference(r.review, `avg.review.audio.${requirementKey}`)
  const asset = parseAvgExecutableStageV1({ version: 1, cues: [], assets: [r.asset] }).assets[0]!
  if (domain === 'sound') parseAvgSoundChannelV1(asset.kind)
  if (domain === 'voice' && asset.kind !== 'voice' || asset.mimeType !== 'audio/wav'
    || asset.contentHash !== processed.contentHash || asset.blobContentHash !== processed.contentHash
    || asset.width !== null || asset.height !== null || asset.durationMs === null || !Number.isSafeInteger(asset.durationMs)
    || asset.durationMs < 1 || asset.durationMs > 120_000 || asset.byteSize < 44 || asset.byteSize > 32 * 1024 * 1024) {
    throw new Error('[avg-audio-process] 选用须绑定准确有界的加工WAV，原件不能冒充衍生版本')
  }
  return { version: 2, requirementKey, requestIdentityHash: avgHash(r.requestIdentityHash, 'processed audio request'), raw, processed, review, asset,
    declaration: avgText(r.declaration, 'processed audio author declaration', 4000) }
}
