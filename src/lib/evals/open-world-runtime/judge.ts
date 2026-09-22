import { type ChatResult } from '../../ai/client'
import { supportsVerifiedJsonObjectResponseV1 } from '../../ai/provider-capabilities'
import { executeRegisteredAIEntryV1 } from '../../agent/formal-ai-entry'
import { hashCanonicalValue } from '../../agent/run/hash'
import type { AIConfig } from '../../types'
import {
  buildTextOpenWorldRuntimeAIEvalGraderMessagesV1,
  parseTextOpenWorldRuntimeAISemanticGradeV1,
  TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_GRADE_JSON_SCHEMA_V1,
  TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_GRADER_PROMPT_VERSION_V1,
  TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_GRADER_TIMEOUT_MS_V1,
} from './protocol'
import type {
  TextOpenWorldRuntimeAIEvalFixtureV1,
  TextOpenWorldRuntimeAIEvalObservationV1,
  TextOpenWorldRuntimeAIEvalJudgeV1,
} from './types'

export function createTextOpenWorldRuntimeAIEvalJudgeV1(input: {
  config: AIConfig
  signal?: AbortSignal
}): TextOpenWorldRuntimeAIEvalJudgeV1 {
  return async (sample: {
    fixture: TextOpenWorldRuntimeAIEvalFixtureV1
    observation: TextOpenWorldRuntimeAIEvalObservationV1
  }) => {
    const messages = buildTextOpenWorldRuntimeAIEvalGraderMessagesV1(sample)
    const result: ChatResult = {}
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(input.signal?.reason)
    if (input.signal?.aborted) forwardAbort()
    else input.signal?.addEventListener('abort', forwardAbort, { once: true })
    const timeout = globalThis.setTimeout(() => {
      controller.abort(new DOMException('G6-10 grader超时', 'TimeoutError'))
    }, TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_GRADER_TIMEOUT_MS_V1)
    const startedAt = Date.now()
    try {
      const output = await executeRegisteredAIEntryV1(
        'eval.text-open-world.runtime-ai-grader',
        messages,
        { ...input.config, temperature: 0, maxTokens: 1_200 },
        { category: 'eval.text-open-world.runtime-ai-grader', contextOverflowPolicy: 'reject' },
        controller.signal,
        result,
        input.config.provider === 'nvidia'
          ? {
              jsonSchema: {
                name: 'text_open_world_runtime_ai_eval_grade_v1',
                schema: TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_GRADE_JSON_SCHEMA_V1,
                strict: true,
              },
            }
          : supportsVerifiedJsonObjectResponseV1(input.config.provider)
            ? { responseFormat: 'json_object' }
            : undefined,
      )
      return {
        grade: parseTextOpenWorldRuntimeAISemanticGradeV1(output),
        evidence: {
          provider: input.config.provider,
          model: input.config.model,
          promptVersion: TEXT_OPEN_WORLD_RUNTIME_AI_EVAL_GRADER_PROMPT_VERSION_V1,
          inputHash: await hashCanonicalValue(messages),
          outputHash: await hashCanonicalValue(output),
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          finishReason: result.finishReason ?? null,
          durationMs: Math.max(1, Date.now() - startedAt),
        },
      }
    } finally {
      globalThis.clearTimeout(timeout)
      input.signal?.removeEventListener('abort', forwardAbort)
    }
  }
}
