import type { AIConfig, ChatMessage, PromptTemplate } from '../types'
import { renderPrompt } from '../ai/prompt-engine'
import { estimateChatRequestOptionsTokens, type ChatRequestOptions } from '../ai/client'
import { trimMessagesToFit } from '../ai/context-budget'
import { freezeModelCapacityV1, modelInputBudgetV1 } from '../ai/model-capacity'
import { formatCodexImportCatalog, type CodexImportCategoryOption } from './codex-classification'

/** The real document-parse frame, also available to opt-in new-plan previews.
 * Source/context/catalog are supplied whole; this function never assembles or clips them. */
export function buildDocumentParseFrameV1(input: {
  template: PromptTemplate
  provider: AIConfig['provider']
  sourceText: string
  chunkIndex: number
  totalChunks: number
  knownContext: string
  categories: readonly Pick<CodexImportCategoryOption, 'ref' | 'fields' | 'label'>[]
}): { messages: ChatMessage[]; options: ChatRequestOptions | undefined } {
  const { messages } = renderPrompt(input.template, {
    chunkIndex: input.chunkIndex + 1, totalChunks: input.totalChunks, knownContext: input.knownContext,
    codexCategoryCatalog: formatCodexImportCatalog(input.categories) || '不提供目录；请返回空的 codexCandidates。',
    rawDocument: input.sourceText,
  })
  const options: ChatRequestOptions | undefined = input.provider === 'deepseek'
    ? { responseFormat: 'json_object', thinkingMode: 'disabled' }
    : input.provider === 'custom' ? { responseFormat: 'json_object' } : undefined
  return { messages, options }
}

/** Physical admission only, not a forecast of semantic output size or fact coverage.
 * The caller prepares the actual routed config through the existing capacity helper.
 * Use the same output clamp, options estimate and message-envelope checker as chat(). */
export function assessDocumentParseRequestV1(input: {
  config: AIConfig
  messages: ChatMessage[]
  options?: ChatRequestOptions
  maxInputTokens: number
  maxOutputTokens: number
}) {
  if (![input.maxInputTokens, input.maxOutputTokens].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('文档解析任务预算无效。')
  }
  const capacity = freezeModelCapacityV1(input.config)
  const requestedOutput = Math.min(input.config.maxTokens > 0 ? input.config.maxTokens : input.maxOutputTokens, input.maxOutputTokens)
  const budget = modelInputBudgetV1(capacity, requestedOutput)
  const checked = trimMessagesToFit(input.messages, input.config.provider, input.config.model,
    budget.outputBudget, undefined, estimateChatRequestOptionsTokens(input.options), capacity)
  const inputBudget = Math.min(budget.inputBudget, input.maxInputTokens)
  return {
    fits: !checked.trimmed && checked.totalInputTokens <= inputBudget && checked.protectedEnvelopePreserved,
    inputBudget,
    outputReservation: budget.outputBudget,
    // After trimming, the checker describes its proposed shortened request, not the original.
    // Never mislabel that number as the full input; shortened messages are never used here.
    inputTokens: checked.trimmed ? null : checked.totalInputTokens,
    wouldTrim: checked.trimmed,
    config: { ...input.config, maxTokens: budget.outputBudget, modelCapacity: capacity },
  }
}
