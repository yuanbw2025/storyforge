import { describe, expect, it } from 'vitest'
import { normalizeThemeAdaptiveColorHtml, resolveColorForInput } from '../../src/lib/editor/rich-editor-theme'

describe('AUDIT-6 · 富文本主题兼容工具', () => {
  it('把旧正文硬编码色转换为当前主题变量', () => {
    const html = '<p style="color:#f5e6d3;background:rgb(31, 41, 55)">正文</p>'
    expect(normalizeThemeAdaptiveColorHtml(html)).toBe(
      '<p style="color:var(--editor-ink-cream);background:var(--editor-mark-blue)">正文</p>',
    )
  })

  it('把 rgb 与 CSS 变量解析为颜色输入可接受的十六进制值', () => {
    document.documentElement.style.setProperty('--editor-test-color', 'rgb(17, 34, 51)')
    expect(resolveColorForInput('rgb(171, 205, 239)', '#000000')).toBe('#abcdef')
    expect(resolveColorForInput('var(--editor-test-color)', '#000000')).toBe('#112233')
  })

  it('未知颜色使用显式兜底值', () => {
    expect(resolveColorForInput('currentColor', '#123456')).toBe('#123456')
  })
})
