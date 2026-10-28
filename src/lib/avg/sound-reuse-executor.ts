import type { ProductProductionBriefV3 } from '../types'
import { ProductProductionDraftRejectedErrorV1, type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskUsageV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgSoundPlanningExecutionSourcesV1 } from './sound-planning-task-source'
import { parseAvgSoundPlanningBriefV2, avgSoundProductionExecutionReadyV1 } from './sound-production-brief'
import { readAvgSoundReuseRetainedArtifactV1 } from './sound-reuse-source'
import { parseAvgSoundRevalidationEvidenceV1 } from './sound-reuse-contract'
import { hashAvgSoundExactTextV1 } from './sound-planning-evidence'
import { inspectAvgSoundBytesV1 } from './sound-decoder'

/** A new local producer through the existing scheduler. It retains the old
 * payload and rights, emits its own checkpoint and never calls a provider or
 * copies an old RunID. Processing still consumes this Build's new raw receipt. */
export async function executeAvgSoundReuseTaskV1(input: ProductProductionTaskExecutionInputV1, brief: ProductProductionBriefV3) {
  const started = Date.now(), usage = (): ProductProductionTaskUsageV1 => ({ modelCalls: 0, mediaCalls: 0, inputTokens: 0,
    outputTokens: 0, costUsd: 0, durationMs: Date.now() - started, storageBytes: 0 })
  try {
    const { repair } = parseAvgSoundPlanningBriefV2(brief.avgSoundPlanning), raw = input.task.kind === 'avg-sound-raw-reuse'
    if (!avgSoundProductionExecutionReadyV1() || (!raw && input.task.kind !== 'avg-sound-requirements-reuse')
      || input.attempt !== 1 || !input.taskRunId || input.authorDraftJson || input.capabilityBindings.length || input.signal.aborted) {
      throw new Error('[avg-sound-repair] 复验只接受准确单次本地任务，不调用生成模型')
    }
    const source = await readAvgSoundPlanningExecutionSourcesV1(input, brief)
    const retained = await readAvgSoundReuseRetainedArtifactV1({ scope: input.scope, repair, raw, packet: source.packet })
    if (source.build.parentBuildNumber !== repair.parent.buildNumber || repair.parent.buildNumber >= input.buildNumber) {
      throw new Error('[avg-sound-repair] 返修父预览与当前新制作版本不一致')
    }
    const original = retained.row
    if (raw) await inspectAvgSoundBytesV1({ data: retained.data!, contentHash: original.contentHash,
      assetKey: JSON.parse(original.metadataJson).assetKey, mimeType: 'audio/wav', signal: input.signal })
    const quality = parseAvgSoundRevalidationEvidenceV1({ schema: raw ? 'storyforge.avg.raw-sound-revalidation' : 'storyforge.avg.sound-requirements-revalidation',
      version: 1, noProviderRequest: true, retainedOrigin: repair.source, sourceBuildRevision: repair.sourceBuildRevision,
      repairHash: await hashProductProductionValueV2(repair), sourceContextHash: await hashAvgSoundExactTextV1(input.contextText),
      inputs: source.refs, contentHashVerified: true, ...(raw ? { decoderVerified: true, hearing: 'unobserved', authorAdopted: false } : {}) })
    await readAvgSoundPlanningExecutionSourcesV1(input, brief)
    if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const artifact = { artifactKey: input.task.outputArtifactKeys[0], kind: original.kind, mediaKind: original.mediaKind,
      payload: JSON.parse(original.payloadJson), metadata: JSON.parse(original.metadataJson), quality, rights: JSON.parse(original.rightsJson),
      ...(raw ? { blobObjectId: original.blobObjectId!, mimeType: original.mimeType!, byteSize: original.byteSize,
        contentHash: original.contentHash } : {}) }
    return { artifacts: [artifact], passedGateIds: [...input.task.acceptanceGateIds],
      usage: { ...usage(), storageBytes: new TextEncoder().encode(canonicalProductProductionJsonV2(artifact)).byteLength } }
  } catch (error) {
    throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '[avg-sound-repair] 原件复验失败', usage())
  }
}
