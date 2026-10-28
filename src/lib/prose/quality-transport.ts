import type { ChatMessage } from '../types'
import type { AIRequestConfigResolution, ChatResult, StreamResult } from '../ai/client'
import { executeRegisteredAIEntryV1 } from '../agent/formal-ai-entry'
import type { QualityReviewModeV1 } from './quality-review'
import { wholeChapterQualityRequestOptionsV1 } from './quality-review-request-options'

export type QualityModelCallV1 = (messages: ChatMessage[], resolution: AIRequestConfigResolution, evidence: StreamResult) => Promise<string>

function retainCompletion(raw: string, result: ChatResult, evidence: StreamResult) {
  evidence.usage = result.usage
  evidence.finishReason = result.finishReason
  evidence.completion = result.finishReason === 'stop' ? 'complete' : 'unknown'
  return raw
}

/** Both authoring surfaces dispatch the exact resolution frozen by the durable service. */
export function createWholeChapterQualityCallV1(projectId: number, mode: QualityReviewModeV1, signal?: AbortSignal): QualityModelCallV1 {
  return async (messages, resolution, evidence) => {
    const result: ChatResult = {}
    const options = wholeChapterQualityRequestOptionsV1(resolution.config)
    const raw = mode === 'quality'
      ? await executeRegisteredAIEntryV1('prose.review.quality', messages, resolution.config, { category: 'review.quality', projectId, contextOverflowPolicy: 'reject' }, signal, result, options, resolution)
      : mode === 'style'
        ? await executeRegisteredAIEntryV1('prose.review.anti-ai', messages, resolution.config, { category: 'review.anti-ai', projectId, contextOverflowPolicy: 'reject' }, signal, result, options, resolution)
        : await executeRegisteredAIEntryV1('prose.review.readability', messages, resolution.config, { category: 'review.readability', projectId, contextOverflowPolicy: 'reject' }, signal, result, options, resolution)
    return retainCompletion(raw, result, evidence)
  }
}

export function createQualityRevisionCallV1(projectId: number, stage: 'revision' | 'recheck', signal?: AbortSignal): QualityModelCallV1 {
  return async (messages, resolution, evidence) => {
    const result: ChatResult = {}
    const raw = stage === 'revision'
      ? await executeRegisteredAIEntryV1('prose.chapter.quality-revise', messages, resolution.config, { category: 'review.revise', projectId, contextOverflowPolicy: 'reject' }, signal, result, { responseFormat: 'json_object' }, resolution)
      : await executeRegisteredAIEntryV1('prose.review.recheck', messages, resolution.config, { category: 'review.quality', projectId, contextOverflowPolicy: 'reject' }, signal, result, { responseFormat: 'json_object' }, resolution)
    return retainCompletion(raw, result, evidence)
  }
}
