import { describe, expect, it } from 'vitest'
import { parseAuthoringHtmlV1, safeAuthoringLinkV1, splitAuthoringHtmlV1 } from '../../src/lib/editor/authoring-html-blocks'
import { normalizeRichEditorHTMLV1 } from '../../src/lib/editor/rich-editor-schema'

describe('037 prototype: original HTML framing and inert semantic parsing', () => {
  it('keeps exact root bytes and gaps, including repeated text, empty paragraphs and quoted greater-than', () => {
    const html = '\n<!--before--><p title="a > b">重复😀</p>\n <p></p><p></p><p>重复😀</p>\n<!--after-->'
    const result = splitAuthoringHtmlV1(html)
    expect(result.framed).toBe(true)
    expect(result.slices.map(row => row.html)).toEqual(['<p title="a > b">重复😀</p>', '<p></p>', '<p></p>', '<p>重复😀</p>'])
    expect(result.slices.map(row => row.leading + row.html).join('') + result.trailing).toBe(html)
    for (const row of result.slices) expect(html.slice(row.from, row.to)).toBe(row.html)
    expect(result.slices[0].from).not.toBe(result.slices[3].from)
  })

  it.each(['<p>不闭合', '<p><strong>错位</p></strong>', '旧纯文本<不是标签', '<p a="未闭合>原稿</p>'])('protects ambiguous input instead of repairing %s', html => {
    const framed = splitAuthoringHtmlV1(html)
    expect(framed.framed).toBe(false)
    expect(framed.slices[0].html).toBe(html)
    expect(parseAuthoringHtmlV1(html, framed.framed).protected).toBe(true)
  })

  it('retains supported old styles in the semantic snapshot but protects their raw HTML from Markdown rewriting', () => {
    const html = '<p style="line-height:1.8;margin-bottom:14px"><span style="color:#123456;font-family:serif;font-size:18px">旧稿 &amp; 😀</span></p>'
    const parsed = parseAuthoringHtmlV1(html)
    expect(parsed.protected).toBe(true)
    expect(parsed.pmDoc.textContent).toBe('旧稿 & 😀')
    expect(parsed.pmDoc.firstChild?.attrs.lineHeight).toBe('1.8')
    expect(parsed.pmDoc.firstChild?.attrs.paragraphSpacing).toBe('14px')
    expect(parsed.pmDoc.firstChild?.firstChild?.marks[0].attrs).toMatchObject({ color: '#123456', fontFamily: 'serif', fontSize: '18px' })
  })

  it('never gives the inert tree executable nodes, events, resource attributes or URL CSS', () => {
    const html = '<p onclick="bad()">原稿<img src="https://private.invalid/x"><span style="background-color:url(https://private.invalid/y)">文字</span></p><script>bad()</script><iframe src="https://private.invalid/z"></iframe>'
    const parsed = parseAuthoringHtmlV1(html)
    expect(parsed.protected).toBe(true)
    expect(parsed.dom.querySelector('script,iframe,object,embed,img,[src],[srcset],[onclick]')).toBeNull()
    expect(parsed.dom.innerHTML).not.toMatch(/private|url\(|bad\(/)
    expect(parsed.pmDoc.textContent).toBe('原稿文字')
    expect(splitAuthoringHtmlV1(html).slices.map(row => row.leading + row.html).join('')).toBe(html)
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///private/a', 'https://user:pass@example.test', 'https://example.test/\nx', '/relative'])('rejects unsupported link target %s', value => {
    expect(safeAuthoringLinkV1(value)).toBe(false)
  })

  it.each(['https://example.test/a', 'http://example.test/a', 'mailto:reader@example.test'])('allows the declared link protocols: %s', value => {
    expect(safeAuthoringLinkV1(value)).toBe(true)
  })

  it.each([1, 2, 3, 4, 5, 6])('the same rich schema retains heading%s without changing ordinary paragraphs', level => {
    expect(normalizeRichEditorHTMLV1(`<h${level}>标题😀</h${level}><p>正文</p>`)).toBe(`<h${level}>标题😀</h${level}><p>正文</p>`)
  })
})
