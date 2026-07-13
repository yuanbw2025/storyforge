export type ContextWindowInputResult =
  | { kind: 'empty' }
  | { kind: 'valid'; value: number }
  | { kind: 'invalid'; message: string }

/** 解析用户手填的上下文窗口，允许常见千分位分隔符；非法值不应覆盖已保存配置。 */
export function parseContextWindowInput(raw: string): ContextWindowInputResult {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'empty' }

  const normalized = trimmed.replace(/[\s,，_]/g, '')
  if (!/^\d+$/.test(normalized)) {
    return { kind: 'invalid', message: '请输入正整数，可使用逗号或空格分组' }
  }

  const value = Number(normalized)
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { kind: 'invalid', message: '请输入大于 0 的有效整数；留空表示使用模型预设' }
  }

  return { kind: 'valid', value }
}

