import type { FieldGenerationMode } from '../ai/field-generation-context'

export function resolveFieldGenerationRequestModeV1(request: string): FieldGenerationMode {
  const explicit = /生成模式\s*=\s*(expand|rewrite|polish)\b/i.exec(request)?.[1]?.toLowerCase()
  if (explicit === 'rewrite' || explicit === 'polish' || explicit === 'expand') return explicit
  if (/重写|重做|推倒重来/.test(request)) return 'rewrite'
  if (/润色|优化表达/.test(request)) return 'polish'
  return 'expand'
}
