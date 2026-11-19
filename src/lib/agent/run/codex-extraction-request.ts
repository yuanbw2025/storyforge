import type { AIConfig, ChatMessage } from '../../types'
import type { CodexFieldDef } from '../../types/codex'
import { describeResolvedAIRequestSettingsV1, estimateChatRequestOptionsTokens, resolveRequestConfig,
  type AIRequestConfigResolution, type AIRequestSettingsV1, type ChatRequestOptions } from '../../ai/client'
import { getModelCapacityV1, modelInputBudgetV1, prepareModelCapacityV1 } from '../../ai/model-capacity'
import { estimateTokens } from '../../ai/context-budget'
import { codexEntryTransportOptionsV1 } from '../../ai/adapters/structured-extract-adapter'
import { parseProseRequestSettingsV1 } from '../../prose/request-evidence'
import { canonicalStringify, hashCanonicalValue } from './hash'

export const CODEX_EXTRACTION_INPUT_LIMIT_V1 = 32_000
export const CODEX_EXTRACTION_OUTPUT_LIMIT_V1 = 4_000
type Policy = { operation: 'extract' | 'enrich'; supplementTags: boolean }

/** Public evidence only. The existing capacity binding covers the actual
 * connection and credential; AIConfig and its plaintext key stay in memory. */
export interface CodexExtractionRequestBindingV1 {
  version: 'codex-extraction-request-binding-v1'
  taskKind: AIRequestConfigResolution['taskKind']
  presetId: string | null
  fallbackReason: Exclude<AIRequestConfigResolution['fallbackReason'], undefined> | null
  settings: AIRequestSettingsV1
  responseOptions: ChatRequestOptions | null
  inputBudgetTokens: number
  outputBudgetTokens: number
  bindingHash: string
}
export interface FrozenCodexExtractionRequestV1 {
  resolution: AIRequestConfigResolution
  binding: CodexExtractionRequestBindingV1
  assertCurrent: () => void
}
export class CodexExtractionRequestChangedErrorV1 extends Error {
  constructor() { super('词条拆分的模型路由或请求配置已变化；请明确开始新的提取，原请求不会重发。'); this.name = 'CodexExtractionRequestChangedErrorV1' }
}
export class CodexExtractionRequestBudgetErrorV1 extends Error {
  constructor() { super('完整词条拆分输入超出本轮冻结预算；已停止，未裁剪或发送。请缩短来源后明确开始新的提取。'); this.name = 'CodexExtractionRequestBudgetErrorV1' }
}
const category = (policy: Policy) => policy.operation === 'extract' ? 'codex.extract' : 'codex.enrich'
function guardBody(resolution: AIRequestConfigResolution) {
  const { provider, model, baseUrl, apiKey, temperature, maxTokens } = resolution.config
  // This comparison is local only. It is never persisted or used as an error.
  return canonicalStringify({ taskKind: resolution.taskKind, presetId: resolution.presetId,
    fallbackReason: resolution.fallbackReason ?? null, provider, model, baseUrl: baseUrl ?? '', apiKey: apiKey ?? '',
    temperature: temperature ?? null, maxTokens: maxTokens ?? null })
}

export async function prepareCodexExtractionRequestV1(input: {
  config: AIConfig; fields: readonly CodexFieldDef[]; policy: Policy; previous?: CodexExtractionRequestBindingV1
}): Promise<FrozenCodexExtractionRequestV1> {
  const requested = structuredClone(input.config), meta = { category: category(input.policy) }
  const initial = structuredClone(resolveRequestConfig(requested, meta)), guard = guardBody(initial)
  const capacityConfig = input.previous
    ? { ...initial.config, modelCapacity: input.previous.settings.modelCapacity }
    : await prepareModelCapacityV1(initial.config)
  const capacity = getModelCapacityV1(capacityConfig)
  if (input.previous && capacity.bindingHash !== input.previous.settings.modelCapacity?.bindingHash) throw new CodexExtractionRequestChangedErrorV1()
  const outputBudgetTokens = Math.min(CODEX_EXTRACTION_OUTPUT_LIMIT_V1,
    modelInputBudgetV1(capacity, initial.config.maxTokens).outputBudget)
  const resolution = { ...initial, config: { ...capacityConfig, modelCapacity: capacity, maxTokens: outputBudgetTokens } }
  const responseOptions = codexEntryTransportOptionsV1(resolution.config, input.fields, input.policy) ?? null
  const body = {
    version: 'codex-extraction-request-binding-v1' as const,
    taskKind: resolution.taskKind, presetId: resolution.presetId, fallbackReason: resolution.fallbackReason ?? null,
    settings: describeResolvedAIRequestSettingsV1(resolution, false, responseOptions ?? undefined), responseOptions,
    inputBudgetTokens: Math.min(CODEX_EXTRACTION_INPUT_LIMIT_V1, modelInputBudgetV1(capacity, outputBudgetTokens).inputBudget),
    outputBudgetTokens,
  }
  const binding = { ...body, bindingHash: await hashCanonicalValue(body) }
  if (input.previous && binding.bindingHash !== input.previous.bindingHash) throw new CodexExtractionRequestChangedErrorV1()
  const assertCurrent = () => { if (guardBody(resolveRequestConfig(requested, meta)) !== guard) throw new CodexExtractionRequestChangedErrorV1() }
  assertCurrent()
  return { resolution, binding, assertCurrent }
}

/** Old plans omit this extension and retain their original bytes/hashes. */
export async function parseCodexExtractionRequestBindingV1(value: unknown, fields: readonly CodexFieldDef[], policy: Policy): Promise<CodexExtractionRequestBindingV1> {
  const row = value as CodexExtractionRequestBindingV1
  const keys = ['version', 'taskKind', 'presetId', 'fallbackReason', 'settings', 'responseOptions', 'inputBudgetTokens', 'outputBudgetTokens', 'bindingHash']
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join('|') !== keys.sort().join('|')
    || row.version !== 'codex-extraction-request-binding-v1' || row.taskKind !== (policy.operation === 'extract' ? 'extraction' : 'creation')
    || !(row.presetId === null || typeof row.presetId === 'string' && row.presetId.length > 0 && row.presetId.length <= 500)
    || ![null, 'missing-preset', 'missing-api-key'].includes(row.fallbackReason)
    || typeof row.bindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.bindingHash)) throw new Error('词条拆分的冻结模型绑定无效。')
  const settings = parseProseRequestSettingsV1(row.settings), capacity = settings.modelCapacity
  if (!capacity || settings.stream || !Number.isSafeInteger(row.outputBudgetTokens) || row.outputBudgetTokens < 1
    || row.outputBudgetTokens > CODEX_EXTRACTION_OUTPUT_LIMIT_V1 || settings.requested.maxTokens !== row.outputBudgetTokens
    || row.inputBudgetTokens !== Math.min(CODEX_EXTRACTION_INPUT_LIMIT_V1, modelInputBudgetV1(capacity, row.outputBudgetTokens).inputBudget)
    || canonicalStringify(row.responseOptions) !== canonicalStringify(codexEntryTransportOptionsV1(settings, fields, policy) ?? null)) throw new Error('词条拆分的冻结参数与预算不一致。')
  const { bindingHash, ...body } = row
  if (await hashCanonicalValue(body) !== bindingHash) throw new Error('词条拆分的冻结模型绑定 hash 不匹配。')
  return structuredClone(row)
}

export function assertCodexExtractionRequestBudgetV1(messages: readonly ChatMessage[], binding: CodexExtractionRequestBindingV1) {
  const tokens = estimateTokens(JSON.stringify(messages)) + estimateChatRequestOptionsTokens(binding.responseOptions ?? undefined)
    + estimateTokens(JSON.stringify({ model: binding.settings.model, stream: binding.settings.stream, parameters: binding.settings.parameters })) + 3
  if (tokens > binding.inputBudgetTokens) throw new CodexExtractionRequestBudgetErrorV1()
}
