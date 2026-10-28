import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductBuildArtifactRecordV1 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { putMediaBlobObject, readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { ProductProductionDraftRejectedErrorV1, type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskExecutionResultV1, type ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { avgEnum } from './protocol-validation'
import { processAvgAudioPcmWaveWithWorker, assertAvgAudioProcessingWaveBytes } from './audio-processing-dispatch'
import { AVG_AUDIO_PCM_KINDS_V1 } from './audio-processing-contract'
import { avgAudioProcessingTaskKeyV1, avgProcessedAudioArtifactKeyV1,
  parseAvgAudioProductionProcessingPlan } from './audio-production-contract'
import { AVG_AUDIO_PROCESSING_STORAGE_BYTES_V1, AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1,
  avgAudioProcessingInputTokensV1 } from './audio-production-brief'
import { parseAvgProcessedAudioPayload, deriveAvgProcessedAudioAssetV1, deriveAvgProcessedAudioRightsV1,
  type AvgAudioProcessingEntry } from './processed-audio-contract'
import { inspectAvgVoiceBytesV1 } from './voice-decoder'
import { inspectAvgSoundBytesV1 } from './sound-decoder'
import { inspectAvgVoiceWaveV1 } from './voice-wave'

/** Physical local execution only. The versioned caller proves the actual
 * frozen Brief/Plan, raw producer/response, context and root/child claim;
 * recheck must repeat that proof. Returning this candidate grants no sealed
 * admission, independent audition, author choice or Stage/Release authority.
 * One existing fixed Worker is used; no HTTP, model call, retry or fallback. */
export async function executeAvgBoundedAudioProcessingV1(input: {
  request: ProductProductionTaskExecutionInputV1
  raw: { row: Pick<ProductBuildArtifactRecordV1, 'artifactKey' | 'version' | 'contentHash' | 'producerReceiptHash'
    | 'producerRunId' | 'buildId' | 'controlEpoch' | 'status' | 'blobObjectId' | 'kind' | 'mediaKind' | 'mimeType' | 'byteSize' | 'rightsJson'>;
    asset: FrozenRuntimeMediaAssetV2; requestIdentityHash: string }
  entry: AvgAudioProcessingEntry
  recheck: () => Promise<void>
}): Promise<ProductProductionTaskExecutionResultV1> {
  const started = Date.now(), recheck = input.recheck
  const request = { ...input.request, scope: structuredClone(input.request.scope), task: structuredClone(input.request.task),
    inputArtifacts: structuredClone(input.request.inputArtifacts), capabilityBindings: structuredClone(input.request.capabilityBindings) }
  const raw = structuredClone(input.raw)
  const entry = parseAvgAudioProductionProcessingPlan({ schema: 'storyforge.avg.audio-production-processing-plan',
    version: input.entry.recipe.version === 2 ? 2 : 1, entries: [input.entry] }).entries[0]!
  let storedBytes = 0, candidateBytes = 0
  const usage = (): ProductProductionTaskUsageV1 => ({ modelCalls: 0, mediaCalls: 0, inputTokens: 0, outputTokens: 0,
    costUsd: 0, durationMs: Date.now() - started, storageBytes: storedBytes + candidateBytes })
  const stopped = () => {
    if (request.signal.aborted) throw new DOMException('Audio processing aborted', 'AbortError')
  }
  try {
    const task = request.task, rawKey = 'avg.' + entry.domain + '.raw.' + entry.requirementKey
    if (!request.taskRunId || request.attempt !== 1 || request.authorDraftJson || task.kind !== 'avg-audio-process'
      || task.taskKey !== avgAudioProcessingTaskKeyV1(entry.domain, entry.requirementKey)
      || task.executionMode !== 'deterministic' || task.skillId !== null || task.maxAttempts !== 1
      || task.timeoutMs !== AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1 || task.failurePolicy !== 'pause'
      || task.fallbackTaskKey !== null || task.reuse !== null
      || task.capabilityRequirementKeys.length || request.capabilityBindings.length
      || !task.inputArtifactKeys.includes(rawKey) || task.outputArtifactKeys.length !== 1
      || task.outputArtifactKeys[0] !== avgProcessedAudioArtifactKeyV1(entry.domain, entry.requirementKey)
      || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 0
      || task.budgetReservation.maximumCostUsd !== 0 || task.budgetReservation.outputTokens !== 0
      || task.budgetReservation.inputTokens !== avgAudioProcessingInputTokensV1(entry.domain)
      || task.budgetReservation.durationMs !== AVG_AUDIO_PROCESSING_TASK_DURATION_MS_V1
      || task.budgetReservation.storageBytes !== AVG_AUDIO_PROCESSING_STORAGE_BYTES_V1
      || raw.row.artifactKey !== rawKey || raw.row.buildId !== request.buildId
      || raw.row.controlEpoch !== request.controlEpoch || raw.row.status !== 'accepted'
      || !raw.row.producerRunId || !raw.row.producerReceiptHash
      || raw.row.kind !== 'audio' || raw.row.mediaKind !== raw.asset.kind
      || raw.row.mimeType !== 'audio/wav' || raw.asset.mimeType !== 'audio/wav'
      || raw.row.contentHash !== raw.asset.contentHash || raw.row.byteSize !== raw.asset.byteSize
      || raw.asset.blobContentHash !== raw.asset.contentHash) {
      throw new Error('[avg-audio-process] 加工须属于准确原件、单次本地任务及零新增供应商调用预算')
    }
    stopped()
    await recheck()
    stopped()
    const blob = raw.row.blobObjectId === null ? null : await db.mediaBlobObjects.get(raw.row.blobObjectId)
    if (!blob || !await assertRecordInScope(request.scope, 'mediaBlobObjects', blob, { owner: 'work' })
      || blob.contentHash !== raw.asset.contentHash || blob.mimeType !== 'audio/wav' || blob.byteSize !== raw.asset.byteSize) {
      throw new Error('[avg-audio-process] 加工原音频缺少同作品准确WAV字节')
    }
    const original = await readVerifiedMediaBlobObjectData(blob)
    const kind = avgEnum(raw.asset.kind, AVG_AUDIO_PCM_KINDS_V1, 'processing audio kind')
    if ((entry.domain === 'voice') !== (kind === 'voice')) throw new Error('[avg-audio-process] 加工原音频不属于准确配音或声音域')
    stopped()
    const result = await processAvgAudioPcmWaveWithWorker({ data: original, recipe: entry.recipe,
      source: { contentHash: raw.asset.contentHash, mimeType: 'audio/wav', kind }, signal: request.signal })
    // V2 execution already completes an independent full verify Worker under
    // the shared deadline. Sealed admission and later reads independently
    // verify again; avoid a redundant third Worker before local persistence.
    if (entry.recipe.version === 1) await assertAvgAudioProcessingWaveBytes({ source: original, output: result.data, recipe: entry.recipe, receipt: result.receipt })
    stopped()
    const inspected = kind === 'voice'
      ? await inspectAvgVoiceBytesV1({ data: result.data, contentHash: result.receipt.output.contentHash,
        assetKey: raw.asset.assetKey, maximumDurationMs: entry.recipe.maximumDurationMs, signal: request.signal })
      : await inspectAvgSoundBytesV1({ data: result.data, contentHash: result.receipt.output.contentHash,
        assetKey: raw.asset.assetKey, mimeType: 'audio/wav', signal: request.signal })
    const measured = inspected.measurement
    // Native sound V1 reports the device decode rate, not source PCM frames.
    // Read real WAV frames/rate separately; do not invent voice fields in that
    // old codec or mistake legitimate device resampling for a file rewrite.
    const wave = inspectAvgVoiceWaveV1(result.data, entry.recipe.maximumDurationMs)
    if (measured.contentHash !== result.receipt.output.contentHash || measured.byteSize !== result.receipt.output.byteSize
      || measured.channelCount !== result.receipt.output.channelCount || wave.channelCount !== result.receipt.output.channelCount
      || wave.sampleRateHz !== result.receipt.output.sampleRateHz || wave.sampleCount !== result.receipt.output.sampleCount
      || Math.abs(measured.durationMs - result.receipt.output.durationMs) > 1) {
      throw new Error('[avg-audio-process] 加工WAV的真实解码与处理回执不一致')
    }
    const payload = await parseAvgProcessedAudioPayload({ schema: 'storyforge.avg.processed-audio', version: entry.recipe.version,
      domain: entry.domain, requirementKey: entry.requirementKey, requestIdentityHash: raw.requestIdentityHash,
      raw: { artifactKey: raw.row.artifactKey, version: raw.row.version, contentHash: raw.row.contentHash,
        producerReceiptHash: raw.row.producerReceiptHash }, sourceAsset: raw.asset, recipe: entry.recipe, receipt: result.receipt })
    const metadata = deriveAvgProcessedAudioAssetV1(payload)
    const rights = await deriveAvgProcessedAudioRightsV1(payload, JSON.parse(raw.row.rightsJson))
    const quality = { schema: 'storyforge.avg.processed-audio-evidence', version: 1,
      rawProducerReceiptHash: raw.row.producerReceiptHash, processingReceiptHash: result.receipt.receiptHash,
      sourceRightsHash: rights.sourceRightsHash, sourceContextHash: await sha256Text(request.contextText),
      noProviderRequest: true, contentHashVerified: true, decoderVerified: true,
      measurement: measured, hearing: 'unobserved', authorAdopted: false }
    await recheck()
    stopped()
    const output = await putMediaBlobObject({ scope: request.scope, data: result.data, mimeType: 'audio/wav',
      expectedContentHash: result.receipt.output.contentHash })
    storedBytes = output.byteSize
    await recheck()
    stopped()
    const artifact = { artifactKey: task.outputArtifactKeys[0], requirementKey: null,
      kind: 'audio' as const, mediaKind: kind, payload, metadata, rights, quality,
      contentHash: output.contentHash, blobObjectId: output.id!, mimeType: 'audio/wav', byteSize: output.byteSize }
    candidateBytes = new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength
    return { artifacts: [artifact], passedGateIds: [...task.acceptanceGateIds], usage: usage() }
  } catch (error) {
    throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '[avg-audio-process] 本地加工失败，原音频保留', usage())
  }
}
