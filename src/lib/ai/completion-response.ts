import { AIError } from '../types'

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

/** Safe diagnostics: no prompt, answer, reasoning text, headers or credentials. */
export function inspectCompletionResponseV1(payload: unknown) {
  const root = record(payload)
  const choices = Array.isArray(root?.choices) ? root.choices : []
  const choice = record(choices[0])
  const message = record(choice?.message)
  const content = typeof message?.content === 'string' ? message.content : ''
  const finishReason = ['stop', 'length', 'tool_calls', 'content_filter', 'function_call']
    .includes(String(choice?.finish_reason)) ? String(choice?.finish_reason) : 'unknown'
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0
  const summary = `choices=${choices.length}; content=${content.length} chars; `
    + `contentType=${Array.isArray(message?.content) ? 'array' : typeof message?.content}; `
    + `finish=${finishReason}; toolCalls=${toolCalls}; `
    + `reasoning=${Boolean(message?.reasoning_content || message?.reasoning)}; `
    + `refusal=${Boolean(message?.refusal)}; error=${Boolean(root?.error)}`
  return { content, finishReason, toolCalls, summary, hasRefusal: Boolean(message?.refusal) }
}

export class AICompletionResponseErrorV1 extends AIError {
  readonly retryable = false
  constructor(readonly problem: 'invalid-json' | 'empty' | 'refusal', readonly responseSummary: string) {
    const label = problem === 'invalid-json' ? '响应不是有效 JSON'
      : problem === 'refusal' ? '模型拒绝了本次请求' : '响应中没有可用的回答文本'
    super(200, `服务返回 HTTP 200，但${label}；已停止本次调用。${responseSummary}`)
    this.name = 'AICompletionResponseErrorV1'
  }
}

export function requireCompletionTextV1(payload: unknown, allowToolCalls = false): string {
  const response = inspectCompletionResponseV1(payload)
  if (response.hasRefusal || response.finishReason === 'content_filter') {
    throw new AICompletionResponseErrorV1('refusal', response.summary)
  }
  if (!response.content.trim() && !(allowToolCalls && response.toolCalls > 0)) {
    throw new AICompletionResponseErrorV1('empty', response.summary)
  }
  return response.content
}
