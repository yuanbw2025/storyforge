import { describe, expect, it } from 'vitest'
import { resolveColorForInput } from '../../src/lib/editor/rich-editor-theme'

describe('AUDIT-6 · 富文本当前主题工具', () => {
  it('把 rgb 与 CSS 变量解析为颜色输入可接受的十六进制值', () => {
    document.documentElement.style.setProperty('--editor-test-color', 'rgb(17, 34, 51)')
    expect(resolveColorForInput('rgb(171, 205, 239)', '#000000')).toBe('#abcdef')
    expect(resolveColorForInput('var(--editor-test-color)', '#000000')).toBe('#112233')
  })

  it('未知颜色使用显式兜底值', () => {
    expect(resolveColorForInput('currentColor', '#123456')).toBe('#123456')
  })
})
