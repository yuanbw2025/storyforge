import { describe, expect, it } from 'vitest'
import { compileNovelMarkdownV1, createNovelMarkdownStateV1 } from '../../src/lib/editor/novel-markdown-codec'
import { htmlToPlainText } from '../../src/lib/utils/html'
import { normalizeRichEditorHTMLV1 } from '../../src/lib/editor/rich-editor-schema'

const compile = (source: string) => compileNovelMarkdownV1(createNovelMarkdownStateV1(source))
const html = (source: string) => compile(source).map(row => row.html).join('')

describe('037 headless prototype: bounded novel Markdown semantics', () => {
  it('keeps the exact unpartitioned kernel result for nonlocal, indented, Setext, reference and dense inline continuations', () => {
    const lines = ['甲**乙😀**丙', '**未闭合', '后来**', '尾部\\', '软换行', '尾部  ', '    继续缩进', '  两空格', '[引用]: https://example.test', '[标签](https://example.test)', '<span>字</span>', '3. 连续文本', '===', '---', '*斜体* ~~删除~~', '`**代码**`']
    const samples = ['甲\n乙\n丙\n===', '**甲\n乙**\n丙', '甲\n[x]: https://example.test\n乙', ('**甲😀**乙'.repeat(25) + '\n').repeat(30)]
    for (const first of lines) for (const second of lines) samples.push(first + '\n' + second + '\n尾段')
    for (const source of samples) {
      const baseline = compileNovelMarkdownV1(createNovelMarkdownStateV1(source, [], { rootParagraphs: 'commonmark' }))
      expect(html(source), source).toBe(baseline.map(row => row.html).join(''))
    }
  })
  it('keeps physical prose paragraphs, leading/trailing and repeated empty paragraphs', () => {
    expect(html('甲\n乙')).toBe('<p>甲</p><p>乙</p>')
    expect(html('\n甲\n\n\n乙\n')).toBe('<p></p><p>甲</p><p></p><p></p><p>乙</p><p></p>')
    expect(html('')).toBe('<p></p>')
    expect(html('\n\n')).toBe('<p></p><p></p><p></p>')
  })

  it.each([1, 2, 3, 4, 5, 6])('creates actual heading%s in the shared schema', level => {
    const blocks = compile(`${'#'.repeat(level)} 标题😀`)
    expect(blocks[0].html).toBe(`<h${level}>标题😀</h${level}>`)
    expect(blocks[0].pmDoc.firstChild?.attrs.level).toBe(level)
  })

  it('handles Setext headings, emphasis, deletion, entities, escapes and inline code', () => {
    expect(html('标题\n===')).toBe('<h1>标题</h1>')
    expect(html('标题\n---')).toBe('<h2>标题</h2>')
    expect(html('甲**乙😀**与*丙*及~~丁~~ &amp; \\*字\\*与`# code`')).toBe('<p>甲<strong>乙😀</strong>与<em>丙</em>及<s>丁</s> &amp; *字*与<code># code</code></p>')
  })

  it('distinguishes an explicit hard break from a novel paragraph boundary', () => {
    expect(html('甲\\\n乙')).toBe('<p>甲<br>乙</p>')
    expect(html('甲  \n乙')).toBe('<p>甲<br>乙</p>')
    expect(html('**甲\n乙**')).toBe('<p><strong>甲</strong></p><p><strong>乙</strong></p>')
  })

  it('keeps nested list and quote containers and their continuation hard breaks', () => {
    expect(html('- 甲\n  乙\n  - 丙\n- 丁')).toBe('<ul><li><p>甲<br>乙</p><ul><li><p>丙</p></li></ul></li><li><p>丁</p></li></ul>')
    expect(html('> 甲\n> 乙\n>\n> 丙')).toBe('<blockquote><p>甲<br>乙</p><p>丙</p></blockquote>')
    expect(html('3. 甲\n4. 乙')).toBe('<ol start="3"><li><p>甲</p></li><li><p>乙</p></li></ol>')
    expect(html('- 甲\n\n正文')).toBe('<ul><li><p>甲</p></li></ul><p>正文</p>')
    expect(html('- 甲\n\n\n正文')).toBe('<ul><li><p>甲</p></li></ul><p></p><p>正文</p>')
  })

  it('uses complete fenced code as code and unfinished fences as visible, safely saved prose', () => {
    expect(html('```js\nconst a = "<tag>"\n```')).toBe('<pre><code class="language-js">const a = "&lt;tag&gt;"</code></pre>')
    const pending = compile('```js\n甲**乙')
    expect(pending[0].pendingSyntax).toBe(true)
    expect(pending.map(row => row.html).join('')).toBe('<p>```js</p><p>甲**乙</p>')
    expect(htmlToPlainText(pending[0].html)).toBe('```js\n甲**乙')
    expect(html('未闭合**标记')).toBe('<p>未闭合**标记</p>')
  })

  it('only constructs links for explicitly allowed targets', () => {
    expect(html('[甲**乙**](https://example.test "题")')).toBe(normalizeRichEditorHTMLV1('<p><a href="https://example.test" title="题">甲<strong>乙</strong></a></p>'))
    for (const target of ['javascript:bad()', 'data:text/html,bad', 'file:///private/a', '/relative']) {
      const source = `[字](${target})`, blocks = compile(source)
      expect(blocks[0].dom.querySelector('a')).toBeNull()
      expect(htmlToPlainText(blocks[0].html)).toBe(source)
    }
  })

  it.each(['<img src="https://private.invalid/a">', '<script>bad()</script>', '![图](https://private.invalid/a)', '|甲|乙|\n|-|-|', '[^脚注]', '[[双链]]'])('preserves unsupported syntax as literal text: %s', source => {
    const blocks = compile(source)
    expect(blocks.every(row => !row.dom.querySelector('img,script,iframe,table'))).toBe(true)
    expect(htmlToPlainText(blocks.map(row => row.html).join(''))).toBe(source)
  })

  it('maps emitted UTF16 boundaries without inventing a position inside an emoji or entity', () => {
    const block = compile('重复**字😀** &amp;重复')[0]
    const pieces = block.leaves.flatMap(leaf => leaf.pieces)
    const emoji = pieces.find(row => row.text.includes('😀'))!
    expect(emoji.boundaries[emoji.text.indexOf('😀') + 1]).toBe(-1)
    const entity = pieces.find(row => row.text === '&')!
    expect(entity.boundaries).toEqual([10, 15])
  })
})
