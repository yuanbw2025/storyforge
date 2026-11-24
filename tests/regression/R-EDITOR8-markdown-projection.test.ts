import { describe, expect, it } from 'vitest'
import { parseAuthoringHtmlV1 } from '../../src/lib/editor/authoring-html-blocks'
import { projectAuthoringPmV1, joinMarkdownBlockProjectionsV1 } from '../../src/lib/editor/authoring-markdown-projection'
import { compileNovelMarkdownV1, createNovelMarkdownStateV1 } from '../../src/lib/editor/novel-markdown-codec'

describe('037 prototype: schema to novel source projection', () => {
  it.each([
    '<p>甲</p><p></p><p></p><p>乙😀</p>',
    '<p># 字面 * &amp; &lt;tag&gt; 与中文😀</p>',
    '<h1>一</h1><h5>五</h5><h6>六</h6><p>正文</p>',
    '<p>甲<strong>乙😀</strong><em>丙</em><s>丁</s><code>#*</code></p>',
    '<p>甲<br>乙</p>',
    '<blockquote><p>甲</p><p>乙</p></blockquote><p>末尾</p>',
    '<ul><li><p>甲</p><ul><li><p>乙</p></li></ul></li><li><p>丙</p></li></ul>',
    '<ol start="3"><li><p>甲</p></li><li><p>乙</p></li></ol>',
    '<pre><code class="language-js">甲\n乙</code></pre>',
    '<pre><code>甲\n</code></pre>',
    '<p>甲</p><hr><p>乙</p>',
    '<p><a href="https://example.test/a" title="标题">链接<strong>😀</strong></a></p>',
    '<p></p><ul><li><p>甲</p></li></ul><p></p><blockquote><p>乙</p></blockquote><p></p>',
  ])('projects without losing existing schema structure: %s', original => {
    const parsed = parseAuthoringHtmlV1(original)
    const projection = projectAuthoringPmV1(parsed.pmDoc)
    expect(projection.lossless).toBe(true)
    const html = compileNovelMarkdownV1(createNovelMarkdownStateV1(projection.source)).map(row => row.html).join('')
    expect(parseAuthoringHtmlV1(html).pmDoc.eq(parsed.pmDoc)).toBe(true)
  })

  it('never claims that old font/color/spacing is representable by plain Markdown', () => {
    const parsed = parseAuthoringHtmlV1('<p style="line-height:1.8"><span style="color:red">保护</span></p>')
    expect(parsed.protected).toBe(true)
    expect(projectAuthoringPmV1(parsed.pmDoc).lossless).toBe(false)
  })

  it('assigns separate positional ranges to repeated and empty blocks without internal tokens', () => {
    const rows = [
      { source: '', kind: 'paragraph', lossless: true },
      { source: '重复', kind: 'paragraph', lossless: true },
      { source: '', kind: 'paragraph', lossless: true },
      { source: '', kind: 'paragraph', lossless: true },
      { source: '重复', kind: 'paragraph', lossless: true },
      { source: '', kind: 'paragraph', lossless: true },
    ]
    const result = joinMarkdownBlockProjectionsV1(rows)
    expect(result.source).toBe('\n重复\n\n\n重复\n')
    expect(result.ranges).toHaveLength(rows.length)
    rows.forEach((row, i) => expect(result.source.slice(result.ranges[i].from, result.ranges[i].to)).toBe(row.source))
    expect(new Set(result.ranges.map(row => row.from)).size).toBe(rows.length)
  })
})
