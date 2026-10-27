import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProviderCapabilityRequirementV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1, verifyAvgHistoricalRawVoiceArtifactV1 } from '../product-production/artifact-store'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import type { AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { parseAvgAuthorVoiceChoiceV1, type AvgAuthorVoiceChoiceV1 } from './voice-choice-contract'
import { assertAvgRawVoiceArtifactV1 } from './voice-raw-contract'
import { assertAvgRawVoiceOriginV1 } from './voice-recovery'
import { inspectAvgVoiceBytesV1 } from './voice-decoder'

export interface AvgVoiceSourceValidationV1 {
  schema: 'storyforge.avg.voice-source-validation'
  version: 1
  rawReceiptHash: string
  responseEvidenceHash: string
  contentHash: string
  durationMs: number
  channelCount: number
  sourceSampleRateHz: number
  sampleCount: number
}
export type AvgVoiceChoiceValidationV1 = Omit<AvgVoiceSourceValidationV1, 'schema'> & {
  schema: 'storyforge.avg.voice-choice-validation'
  choiceHash: string
}

/** Verifies current sealed producer, saved HTTP body, same-Work Blob and real
 * decoding before an author decision. Author review/adoption is a separate
 * receipt check: this technical result cannot select or configure audio. */
export async function readAvgRawVoiceSourceV1(input: {
  scope: WorkspaceScope; buildId: number; assembly: AvgAssemblyBriefV3
  capability: ProviderCapabilityRequirementV1; raw: { artifactKey: string; version: number; contentHash: string }
  historicalReadOnly?: { expectedBuildRevision: number; expectedBriefHash: string; expectedPlanHash: string; sourceControlEpoch: number }
}) {
  // Author decisions never supply historicalReadOnly. Their stage/confirm
  // path must still prove the actual currently completed producer.
  const readProducer = async () => input.historicalReadOnly
    ? (await verifyAvgHistoricalRawVoiceArtifactV1({ scope: input.scope, buildId: input.buildId, ...input.raw, ...input.historicalReadOnly })).artifact
    : verifyAcceptedProductBuildArtifactV1({ scope: input.scope, buildId: input.buildId, ...input.raw })
  const row = await readProducer()
  const parseRaw = () => assertAvgRawVoiceArtifactV1({ assembly: input.assembly, capability: input.capability, row })
  const raw = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(parseRaw), 20_000) : await parseRaw()
  const build = await db.productBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg-voice] 配音所属版本不存在或跨作品')
  const response = await assertAvgRawVoiceOriginV1({ scope: input.scope, build, assembly: input.assembly, row, raw: raw.payload })
  const blob = row.blobObjectId == null ? null : await db.mediaBlobObjects.get(row.blobObjectId)
  if (!blob?.id || !await assertRecordInScope(input.scope, 'mediaBlobObjects', blob, { owner: 'work' })
    || blob.contentHash !== raw.asset.contentHash || blob.byteSize !== raw.asset.byteSize || blob.mimeType !== 'audio/wav') {
    throw new Error('[avg-voice] 选择缺少同作品的准确配音字节')
  }
  const inspect = async () => {
    const data = await readVerifiedMediaBlobObjectData(blob)
    const expected = new Uint8Array(response.data)
    if (data.byteLength !== response.data.byteLength || !new Uint8Array(data).every((value, i) => value === expected[i])) {
      throw new Error('[avg-voice] 配音 Blob 与保存的实际响应字节不一致')
    }
    return inspectAvgVoiceBytesV1({ data, assetKey: raw.asset.assetKey, contentHash: raw.asset.contentHash,
      maximumDurationMs: raw.payload.requirement.maximumDurationMs })
  }
  const inspected = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : await inspect()
  const before = raw.payload.measurement, measured = inspected.measurement
  // Device resampling and loudness estimates may differ. The original PCM
  // frames/rate/channels, hash and duration must remain exact across devices.
  if (measured.sourceSampleRateHz !== before.sourceSampleRateHz || measured.sampleCount !== before.sampleCount
    || measured.channelCount !== before.channelCount || Math.abs(measured.durationMs - before.durationMs) > 1) {
    throw new Error('[avg-voice] 配音真实解码与原始 PCM 测量不一致')
  }
  const current = await readProducer()
  if (canonicalProductProductionJsonV2(current) !== canonicalProductProductionJsonV2(row)) throw new Error('[avg-voice] 配音来源在读取期间已变化')
  const validation: AvgVoiceSourceValidationV1 = { schema: 'storyforge.avg.voice-source-validation', version: 1,
    rawReceiptHash: row.producerReceiptHash!,
    responseEvidenceHash: response.responseEvidenceHash, contentHash: measured.contentHash, durationMs: before.durationMs,
    channelCount: before.channelCount, sourceSampleRateHz: before.sourceSampleRateHz, sampleCount: before.sampleCount }
  return { validation, raw: row, payload: raw.payload, asset: raw.asset, blobObjectId: blob.id }
}

/** A voice review reads the raw source above without inventing a selection.
 * A choice additionally binds its exact proposal; neither grants adoption. */
export async function readAvgChosenVoiceSourceV1(input: {
  scope: WorkspaceScope; buildId: number; assembly: AvgAssemblyBriefV3
  capability: ProviderCapabilityRequirementV1; choice: AvgAuthorVoiceChoiceV1
}) {
  const choice = parseAvgAuthorVoiceChoiceV1(input.choice)
  const selected = await readAvgRawVoiceSourceV1({ ...input, raw: choice.raw })
  if (choice.requirementKey !== selected.payload.requirement.requirementKey || choice.requestIdentityHash !== selected.payload.request.identityHash
    || canonicalProductProductionJsonV2(choice.asset) !== canonicalProductProductionJsonV2(selected.asset)) {
    throw new Error('[avg-voice] 作者选择与准确配音需求、请求或媒资不一致')
  }
  const validation: AvgVoiceChoiceValidationV1 = { ...selected.validation, schema: 'storyforge.avg.voice-choice-validation',
    choiceHash: await hashProductProductionValueV2(choice) }
  return { ...selected, validation }
}
