export type FieldGenerationMode = 'expand' | 'rewrite' | 'polish'

const MODE_LABELS: Record<FieldGenerationMode, string> = {
  expand: '扩写',
  rewrite: '重写',
  polish: '润色',
}

const MODE_INSTRUCTIONS: Record<FieldGenerationMode, string> = {
  expand: '保留当前字段的事实、方向和关键措辞，在此基础上补全、扩写和细化；不要另起炉灶。',
  rewrite: '忽略当前字段已有内容，按上下文与用户补充说明重新生成一版；适合推倒重来。',
  polish: '主要优化表达、逻辑顺序和可读性；除非用户明确要求，不要新增重大设定。',
}

export function composeFieldGenerationHint(
  userHint: string | undefined,
  currentValue: string | undefined,
  mode: FieldGenerationMode = 'expand',
): string {
  const parts: string[] = []
  const current = mode === 'rewrite' ? '' : currentValue?.trim()
  if (current) {
    parts.push(`【当前字段已有内容】\n${current}`)
  }
  parts.push(`【本次生成模式】${MODE_LABELS[mode]}`)
  parts.push(`【执行要求】${MODE_INSTRUCTIONS[mode]}`)
  if (userHint?.trim()) {
    parts.push(`【用户补充说明】\n${userHint.trim()}`)
  }
  return parts.join('\n\n')
}
