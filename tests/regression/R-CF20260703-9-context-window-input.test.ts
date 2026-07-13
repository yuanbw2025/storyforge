import { describe, expect, it } from 'vitest'
import { parseContextWindowInput } from '../../src/lib/ai/context-window-input'

describe('CF-20260703-9 · 上下文窗口输入解析', () => {
  it('支持纯数字和常见分组符，空值表示使用模型预设', () => {
    expect(parseContextWindowInput('2100000')).toEqual({ kind: 'valid', value: 2_100_000 })
    expect(parseContextWindowInput('2,100,000')).toEqual({ kind: 'valid', value: 2_100_000 })
    expect(parseContextWindowInput('2 100 000')).toEqual({ kind: 'valid', value: 2_100_000 })
    expect(parseContextWindowInput('')).toEqual({ kind: 'empty' })
  })

  it('拒绝非法值，让调用方保留此前已保存配置', () => {
    expect(parseContextWindowInput('128K').kind).toBe('invalid')
    expect(parseContextWindowInput('0').kind).toBe('invalid')
  })
})

