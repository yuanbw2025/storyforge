import { canonicalStringify } from '../agent/run/hash'
import { estimateTokens } from '../ai/context-budget'
import { estimateTtrpgOpenProductionTextV3, TTRPG_OPEN_WIRE_ESTIMATION_V3,
  TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3 } from './open-production-wire-budget'
import * as p from './open-contract-parse'

/** A pre-dispatch refusal; it never represents a sent, failed or unknown call. */
export class TtrpgOpenInputBudgetErrorV1 extends Error {
  readonly code = 'ttrpg-open-input-budget-exhausted'
  constructor(inputTokens: number, outputTokens: number, remainingTokens: number) {
    super(`[ttrpg-open-input] 完整请求超过剩余硬预算（输入预留 ${inputTokens}，输出预留 ${outputTokens}，剩余 ${remainingTokens}）；既有进度已保存`)
    this.name = 'TtrpgOpenInputBudgetErrorV1'
  }
}
export function assertTtrpgOpenRuntimeInputAllowanceV1(remainingTokens: number, outputTokens: number) {
  if (remainingTokens <= outputTokens + TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3) {
    throw new TtrpgOpenInputBudgetErrorV1(TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3 + 1, outputTokens, remainingTokens)
  }
}

/** New requests freeze their estimator; historical rendered bytes retain their
 * original reservation. This approximation never replaces actual provider usage. */
export const TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1 = {
  schema: 'storyforge.ttrpg-open-input-estimation', version: 1,
  method: TTRPG_OPEN_WIRE_ESTIMATION_V3, overheadReserveTokens: TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3,
} as const

export function estimateTtrpgOpenRuntimeInputTokensV1(value: unknown): number {
  const rendered = p.object(value, 'rendered runtime request')
  const legacy = estimateTokens(canonicalStringify(rendered))
  if (!Object.prototype.hasOwnProperty.call(rendered, 'inputEstimation')) return legacy
  const method = p.record(rendered.inputEstimation, ['schema', 'version', 'method', 'overheadReserveTokens'], 'runtime input estimation')
  for (const key of ['schema', 'version', 'method', 'overheadReserveTokens'] as const) {
    if (method[key] !== TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1[key]) p.fail('runtime input estimation: 不支持的估算版本或预留')
  }
  const messages = p.list(rendered.messages, 'runtime request messages', (value, label) => {
    const message = p.record(value, ['role', 'content'], label)
    p.oneOf(message.role, ['system', 'user', 'assistant'], label + '.role')
    if (typeof message.content !== 'string') p.fail(label + '.content: 必须是原始文本')
    return message
  }, 100, 1)
  // Match the complete visible wire, including JSON/message packaging. The
  // existing production approximation also reserves provider-side overhead.
  return Math.max(legacy, estimateTtrpgOpenProductionTextV3(canonicalStringify(messages))
    + TTRPG_OPEN_WIRE_OVERHEAD_RESERVE_V3)
}

/** V1/V2 journals may contain a bare message array or non-JSON rendered text.
 * Only a new explicit object marker changes their original byte-based budget. */
export function estimateTtrpgOpenFrozenRuntimeInputTokensV1(content: string): number {
  let value: unknown
  try { value = JSON.parse(content) } catch { return estimateTokens(content) }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.prototype.hasOwnProperty.call(value, 'inputEstimation')) return estimateTokens(content)
  return estimateTtrpgOpenRuntimeInputTokensV1(value)
}

/** Missing provider usage stays explicitly estimated. New requests keep their
 * conservative input reservation; old requests keep the old fallback formula. */
export function estimateTtrpgOpenRuntimeFallbackInputV1(value: unknown): number {
  const rendered = p.object(value, 'rendered runtime request')
  if (Object.prototype.hasOwnProperty.call(rendered, 'inputEstimation')) return estimateTtrpgOpenRuntimeInputTokensV1(rendered)
  if (!Array.isArray(rendered.messages) || rendered.messages.some(message => typeof message?.content !== 'string')) {
    return p.fail('缺少原始完整请求正文')
  }
  return estimateTokens(rendered.messages.map(message => message.content).join('\n'))
}
