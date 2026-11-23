import { describe, expect, it } from 'vitest'
import { generateJSON, getSchema } from '@tiptap/core'
import { normalizeRichEditorHTMLV1, richEditorExtensionsV1 } from '../../src/lib/editor/rich-editor-schema'

// Captured through the unmodified real shared normalizer at 521300e18, before
// changing only heading.levels. These are golden outputs, not a second schema.
const legacyCases = [
  ['<h2>二级标题😀</h2>', '<h2>二级标题😀</h2>'],
  ['<h3>三级标题</h3>', '<h3>三级标题</h3>'],
  ['<h4>四级标题</h4>', '<h4>四级标题</h4>'],
  ['<p>普通中文😀 &amp; &lt;字面&gt;</p>', '<p>普通中文😀 &amp; &lt;字面&gt;</p>'],
  ['<p></p><p>甲</p><p></p><p></p><p>乙</p>', '<p></p><p>甲</p><p></p><p></p><p>乙</p>'],
  ['<p><strong>加粗</strong><em>斜体</em><s>删除</s><code>字面*</code><br>换行</p>', '<p><strong>加粗</strong><em>斜体</em><s>删除</s><code>字面*</code><br>换行</p>'],
  ['<blockquote><p>引用</p></blockquote><ul><li><p>一</p></li></ul><hr>', '<blockquote><p>引用</p></blockquote><ul><li><p>一</p></li></ul><hr>'],
  ['<pre><code>const x = "&lt;tag&gt;"\n</code></pre>', '<pre><code>const x = "&lt;tag&gt;"\n</code></pre>'],
  ['<p style="line-height:1.8;margin-bottom:12px"><span style="color:#ff0000;background-color:#ffff00;font-family:serif;font-size:18px">旧样式</span></p>', '<p style="line-height: 1.8; margin-bottom: 12px;"><span style="color: #ff0000; background-color: #ffff00; font-family: serif; font-size: 18px;">旧样式</span></p>'],
  ['<h2 style="line-height:2;margin-bottom:8px"><span style="font-size:20px;color:blue">旧标题样式</span></h2>', '<h2 style="line-height: 2; margin-bottom: 8px;"><span style="color: blue; font-size: 20px;">旧标题样式</span></h2>'],
  ['<p><a href="https://example.test/a">链接</a></p>', '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.test/a">链接</a></p>'],
  ['<h7>未知标题</h7>', '<p>未知标题</p>'],
] as const

describe('037-H16: shared heading schema foundation only', () => {
  it.each([1, 2, 3, 4, 5, 6])('parses h%i as a real PM heading without changing following paragraphs', level => {
    const extensions = richEditorExtensionsV1()
    const schema = getSchema(extensions)
    const html = `<h${level}>标题😀</h${level}><p>正文</p>`
    const doc = schema.nodeFromJSON(generateJSON(html, extensions))
    expect(doc.childCount).toBe(2)
    expect(doc.firstChild?.type).toBe(schema.nodes.heading)
    expect(doc.firstChild?.attrs.level).toBe(level)
    expect(doc.firstChild?.textContent).toBe('标题😀')
    expect(doc.child(1).type).toBe(schema.nodes.paragraph)
    expect(doc.child(1).textContent).toBe('正文')
    expect(normalizeRichEditorHTMLV1(html)).toBe(html)
    expect(normalizeRichEditorHTMLV1(normalizeRichEditorHTMLV1(html))).toBe(html)
  })

  it.each(legacyCases)('keeps the prior normalization bytes for %s', (input, expected) => {
    expect(normalizeRichEditorHTMLV1(input)).toBe(expected)
    expect(normalizeRichEditorHTMLV1(expected)).toBe(expected)
  })

  it.each([1, 5, 6])('keeps normalization a strict fixed-point prerequisite for styled h%i', level => {
    const source = `<h${level} style="line-height:1.8;margin-bottom:12px"><span style="color:red">作者原文😀</span></h${level}>`
    const canonical = normalizeRichEditorHTMLV1(source)
    expect(canonical).not.toBe(source)
    expect(canonical).toContain(`<h${level} `)
    expect(canonical).toContain('作者原文😀')
    expect(normalizeRichEditorHTMLV1(canonical)).toBe(canonical)
    // No implicit mutation/migration of the input string to satisfy a guard.
    expect(source).toContain('line-height:1.8;margin-bottom:12px')
  })
})
