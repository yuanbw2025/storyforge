import type { ProductProductionBriefV3 } from '../types'
import { ProductProductionDraftRejectedErrorV1, type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskExecutionResultV1 } from '../product-production/scheduler'
import { avgAudioProcessingExecutionReadyV1 } from './audio-production-brief'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'

/** Same durable scheduler and deterministic task; no provider or author
 * authority. Remains closed until sealed admission and all derived consumers
 * are wired. Lazy loading keeps the shared canonical Plan parser outside
 * synchronous factory cycles and avoids an unconditional processing bundle. */
export async function executeAvgAudioProcessingTaskV1(input: ProductProductionTaskExecutionInputV1,
  value: ProductProductionBriefV3): Promise<ProductProductionTaskExecutionResultV1> {
  const started = Date.now()
  const request = { ...input, scope: structuredClone(input.scope), task: structuredClone(input.task),
    inputArtifacts: structuredClone(input.inputArtifacts), capabilityBindings: structuredClone(input.capabilityBindings) }
  const brief = structuredClone(value)
  try {
    if (!avgAudioProcessingExecutionReadyV1()) throw new Error('[avg-audio-process] 正式加工的准入、独立试听/采用与消费闭环尚未就绪')
    if (request.signal.aborted) throw new DOMException('Audio processing aborted', 'AbortError')
    const [{ readAvgAudioProcessingSourcesV1 }, { executeAvgBoundedAudioProcessingV1 }] = await Promise.all([
      import('./audio-processing-task-source'), import('./audio-processing-execution-kernel')])
    const source = () => readAvgAudioProcessingSourcesV1(request, brief)
    const frozen = await source()
    return await executeAvgBoundedAudioProcessingV1({ request, entry: frozen.entry, raw: frozen.raw,
      recheck: async () => {
        const current = await source()
        if (canonicalProductProductionJsonV2({ entry: current.entry, raw: current.raw, refs: current.refs })
          !== canonicalProductProductionJsonV2({ entry: frozen.entry, raw: frozen.raw, refs: frozen.refs })) {
          throw new Error('[avg-audio-process] 加工期间准确原producer、配方或依赖发生变化')
        }
      } })
  } catch (error) {
    if (error instanceof ProductProductionDraftRejectedErrorV1) throw error
    throw new ProductProductionDraftRejectedErrorV1(error instanceof Error ? error.message : '[avg-audio-process] 加工来源无效',
      { modelCalls: 0, mediaCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
        durationMs: Date.now() - started, storageBytes: 0 })
  }
}
