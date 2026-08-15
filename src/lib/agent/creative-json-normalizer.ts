import type { CreativeArtifactIssueV1 } from './creative-reliability'

export type CreativeJsonNormalizationStepV1 =
  | 'trim-outer-whitespace'
  | 'remove-single-json-fence'

export interface CreativeJsonEnvelopeResultV1 {
  version: 1
  originalText: string
  normalizedText: string
  value: Record<string, unknown> | null
  steps: CreativeJsonNormalizationStepV1[]
  issues: CreativeArtifactIssueV1[]
}

function issue(code: string, path: string, message: string): CreativeArtifactIssueV1 {
  return {
    version: 1,
    code,
    severity: 'error',
    disposition: 'repairable',
    path,
    message,
    suggestedAction: 'repair-once',
    evidenceRefs: [],
    deterministic: true,
  }
}

/**
 * 只执行能够证明语义无损的 JSON 外壳归一化。它不会从解释文字中搜索对象、
 * 不会选择多个对象，也不会补字段或猜测领域语义。
 */
export function normalizeCreativeJsonEnvelopeV1(raw: string): CreativeJsonEnvelopeResultV1 {
  const originalText = raw
  let normalizedText = raw
  const steps: CreativeJsonNormalizationStepV1[] = []
  const trimmed = normalizedText.trim()
  if (trimmed !== normalizedText) {
    normalizedText = trimmed
    steps.push('trim-outer-whitespace')
  }

  const fence = normalizedText.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  if (fence) {
    normalizedText = fence[1].trim()
    steps.push('remove-single-json-fence')
  }

  if (!normalizedText.startsWith('{') || !normalizedText.endsWith('}')) {
    return {
      version: 1,
      originalText,
      normalizedText,
      value: null,
      steps,
      issues: [issue(
        'creative-json-not-single-object',
        '$',
        '模型响应必须是单个 JSON 对象；解释文字、多个对象或数组外壳不能自动猜测。',
      )],
    }
  }

  let value: unknown
  try {
    value = JSON.parse(normalizedText)
  } catch {
    return {
      version: 1,
      originalText,
      normalizedText,
      value: null,
      steps,
      issues: [issue('creative-json-invalid', '$', '模型响应不是有效 JSON。')],
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      version: 1,
      originalText,
      normalizedText,
      value: null,
      steps,
      issues: [issue('creative-json-root-not-object', '$', '模型响应根必须是 JSON 对象。')],
    }
  }
  return {
    version: 1,
    originalText,
    normalizedText,
    value: value as Record<string, unknown>,
    steps,
    issues: [],
  }
}

