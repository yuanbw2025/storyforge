import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { assertAvgAudioProcessingWaveBytes } from './audio-processing-dispatch'
import { avgHash, avgRecord } from './protocol-validation'
import { assertAvgProcessedAudioArtifact, type AvgProcessedAudioArtifactFieldsV1,
  type AvgAudioProcessingEntry } from './processed-audio-contract'
import { inspectAvgVoiceBytesV1 } from './voice-decoder'
import { parseAvgVoiceByteMeasurementV1 } from './voice-raw-contract'
import { inspectAvgVoiceWaveV1 } from './voice-wave'
import { inspectAvgSoundBytesV1, parseAvgSoundByteMeasurementV1 } from './sound-decoder'

type Original = Awaited<ReturnType<typeof import('./audio-processing-raw-source').readAvgAudioProcessingRawSourceV1>>
export type AvgProcessedAudioStoredFieldsV1 = AvgProcessedAudioArtifactFieldsV1
  & Pick<ProductBuildArtifactRecordV1, 'requirementKey' | 'qualityJson' | 'blobObjectId'>
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Physical/codec verification only. The caller must independently prove the
 * actual current or explicitly frozen original, producer/Plan/context and
 * authority. This cannot select a historical mode, admit, audition or adopt. */
export async function inspectAvgProcessedAudioSourceV1(input: {
  scope: WorkspaceScope; entry: AvgAudioProcessingEntry; original: Original
  row: AvgProcessedAudioStoredFieldsV1; sourceContextHash: string
}) {
  const frozen = structuredClone(input), { row, original, entry } = frozen
  const sourceContextHash = avgHash(frozen.sourceContextHash, 'processed context hash')
  const parsed = await assertAvgProcessedAudioArtifact({ entry, row, source: {
    raw: { artifactKey: original.row.artifactKey, version: original.row.version,
      contentHash: original.row.contentHash, producerReceiptHash: original.row.producerReceiptHash! },
    asset: original.asset, requestIdentityHash: original.requestIdentityHash,
    rights: JSON.parse(original.row.rightsJson),
  } })
  const quality = avgRecord(JSON.parse(row.qualityJson), ['schema', 'version', 'rawProducerReceiptHash',
    'processingReceiptHash', 'sourceRightsHash', 'sourceContextHash', 'noProviderRequest',
    'contentHashVerified', 'decoderVerified', 'measurement', 'hearing', 'authorAdopted'], 'processed audio evidence')
  const recorded = entry.domain === 'voice'
    ? parseAvgVoiceByteMeasurementV1(quality.measurement) : parseAvgSoundByteMeasurementV1(quality.measurement)
  if (row.requirementKey !== null || !same(quality, {
    schema: 'storyforge.avg.processed-audio-evidence', version: 1,
    rawProducerReceiptHash: original.row.producerReceiptHash,
    processingReceiptHash: parsed.payload.receipt.receiptHash,
    sourceRightsHash: parsed.rights.sourceRightsHash, sourceContextHash,
    noProviderRequest: true, contentHashVerified: true, decoderVerified: true,
    measurement: recorded, hearing: 'unobserved', authorAdopted: false,
  })) throw new Error('[avg-audio-process] 加工证据不能替换原producer/上下文/权利或冒充审听与采用')
  const originalBlob = original.row.blobObjectId === null ? null : await db.mediaBlobObjects.get(original.row.blobObjectId)
  const outputBlob = row.blobObjectId === null ? null : await db.mediaBlobObjects.get(row.blobObjectId)
  for (const [blob, expected] of [[originalBlob, original.asset], [outputBlob, parsed.asset]] as const) {
    if (!blob || !await assertRecordInScope(frozen.scope, 'mediaBlobObjects', blob, { owner: 'work' })
      || blob.storageState !== 'ready' || blob.contentHash !== expected.contentHash
      || blob.mimeType !== 'audio/wav' || blob.byteSize !== expected.byteSize) {
      throw new Error('[avg-audio-process] 加工接收缺少同作品准确原件或衍生WAV字节')
    }
  }
  const inspect = async () => {
    const [source, output] = await Promise.all([
      readVerifiedMediaBlobObjectData(originalBlob!), readVerifiedMediaBlobObjectData(outputBlob!),
    ])
    await assertAvgAudioProcessingWaveBytes({ source, output, recipe: entry.recipe, receipt: parsed.payload.receipt })
    const decoded = entry.domain === 'voice'
      ? await inspectAvgVoiceBytesV1({ data: output, assetKey: parsed.asset.assetKey,
        contentHash: parsed.asset.contentHash, maximumDurationMs: entry.recipe.maximumDurationMs })
      : await inspectAvgSoundBytesV1({ data: output, assetKey: parsed.asset.assetKey,
        contentHash: parsed.asset.contentHash, mimeType: 'audio/wav' })
    const wave = inspectAvgVoiceWaveV1(output, entry.recipe.maximumDurationMs), actual = decoded.measurement
    const expected = parsed.payload.receipt.output
    // Device decode rate and loudness may vary. Source PCM frames/rate, bytes,
    // channels and duration remain exact; never add voice-only fields to sound V1.
    if (recorded.contentHash !== expected.contentHash || recorded.mimeType !== 'audio/wav'
      || recorded.byteSize !== expected.byteSize || recorded.channelCount !== expected.channelCount
      || Math.abs(recorded.durationMs - expected.durationMs) > 1
      || actual.contentHash !== expected.contentHash || actual.byteSize !== expected.byteSize
      || actual.channelCount !== expected.channelCount || Math.abs(actual.durationMs - expected.durationMs) > 1
      || wave.channelCount !== expected.channelCount || wave.sampleRateHz !== expected.sampleRateHz
      || wave.sampleCount !== expected.sampleCount
      || 'sourceSampleRateHz' in recorded && (recorded.sourceSampleRateHz !== wave.sampleRateHz || recorded.sampleCount !== wave.sampleCount)) {
      throw new Error('[avg-audio-process] 加工原始PCM、实际衍生解码或记录测量与冻结处理回执不一致')
    }
    return actual
  }
  const observed = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : await inspect()
  return { ...parsed, recorded, observed }
}
