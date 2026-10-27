import type { ProductProductionTaskExecutionInputV1, ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { ProductProductionDraftRejectedErrorV1 } from '../product-production/scheduler'
import type { AvgVoiceProductionBriefV3 } from './voice-production-policy'
import { readAvgVoiceTaskSourcesV3 } from './voice-task-source'
import { readAvgVoiceRecoverySourceV1 } from './voice-recovery'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'

/** A new deterministic producer revalidates old audio. No transport, config,
 * copied response event, author approval or rewritten original charge. */
export async function executeAvgVoiceRecoveryTaskV1(input: ProductProductionTaskExecutionInputV1,
  brief: AvgVoiceProductionBriefV3): Promise<ProductProductionTaskExecutionResultV1> {
  const started = Date.now(), usage = (storageBytes = 0) => ({ modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
    costUsd: 0, durationMs: Date.now() - started, storageBytes })
  try {
    const source = await readAvgVoiceTaskSourcesV3(input, brief), { assembly, accepted } = source
    const retained = assembly.voice.recovery?.retained.find(r => input.task.taskKey === `avg.voice.generate.${r.requirementKey}`)
    if (!retained || input.task.kind !== 'avg-media-voice-reuse' || input.task.executionMode !== 'deterministic'
      || input.task.skillId !== null || input.task.contextProfile !== 'avg-task-v1' || input.task.budgetReservation.mediaCalls !== 0
      || input.task.budgetReservation.modelCalls !== 0 || input.task.maxAttempts !== 1 || input.attempt !== 1
      || !input.contextText.trim() || input.signal.aborted) throw new Error('[avg-voice] 保留配音不属于准确零调用任务')
    const prior = await readAvgVoiceRecoverySourceV1({ scope: input.scope, productionId: input.productionId,
      assembly, requirementKey: retained.requirementKey }), row = prior.artifact
    await readAvgVoiceTaskSourcesV3(input, brief)
    if (input.signal.aborted) throw new Error('[avg-voice] 配音复验已停止，未发送请求')
    const quality = { schema: 'storyforge.avg.raw-voice-revalidation', version: 1, noProviderRequest: true,
      retainedOrigin: prior.proof, contentHashVerified: true, decoderVerified: true,
      sourceRule: accepted.artifact, sourceScripts: accepted.scripts.map(s => s.artifact) }
    return { artifacts: [{ artifactKey: row.artifactKey, kind: 'audio', mediaKind: 'voice',
      payload: JSON.parse(row.payloadJson), metadata: JSON.parse(row.metadataJson), rights: JSON.parse(row.rightsJson), quality,
      blobObjectId: row.blobObjectId, contentHash: row.contentHash, mimeType: row.mimeType, byteSize: row.byteSize }],
      passedGateIds: [...input.task.acceptanceGateIds],
      usage: usage(new TextEncoder().encode(canonicalProductProductionJsonV2(quality) + row.payloadJson + row.metadataJson + row.rightsJson).byteLength) }
  } catch (error) {
    throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '[avg-voice] 配音复验失败', usage())
  }
}
