import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { serializeAuthoringMarkdownExportV1, MARKDOWN_HTML_FORMAT_BOUNDARY_V1 } from '../../src/lib/editor/authoring-markdown-export'
import { compileNovelMarkdownV1, createNovelMarkdownStateV1 } from '../../src/lib/editor/novel-markdown-codec'
import { canExportAuthoringHtmlV1, parseAuthoringHtmlV1 } from '../../src/lib/editor/authoring-html-blocks'
import { marked } from 'marked'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useOutlineStore } from '../../src/stores/outline'
import { adopt } from '../../src/lib/registry/adopt'
import { exportProjectMarkdown, exportProjectTXT } from '../../src/lib/export/text-export'
import { countWords, htmlToPlainText } from '../../src/lib/utils/html'

describe('037: one pure serialization kernel for actual Markdown export', () => {
  it.each([1, 2, 3, 4, 5, 6])('retains actual heading%s in the Markdown file', level => {
    expect(serializeAuthoringMarkdownExportV1(`<h${level}>标题</h${level}>`)).toEqual({ markdown: '#'.repeat(level) + ' 标题', containsHtml: false })
  })
  it.each([
    '<p>甲</p><p>乙</p>',
    '<p>原作完整句子 &amp; &lt;不是标签&gt; é e\u0301 𐀀，句末也保留。</p>',
    '<blockquote><p>甲</p><p>乙</p></blockquote><ul><li><p>丙</p><ul><li><p>丁</p></li></ul></li></ul>',
    '<p><strong>甲😀</strong>与<em>乙</em>及<s>丙</s></p>',
    '<pre><code class="language-js">const x = "&lt;tag&gt;*"\n</code></pre>',
    '<p><a href="https://example.test/a" title="题">正常链接</a></p>',
  ])('retains full structure and visible text under standard paragraph rules: %s', original => {
    const result = serializeAuthoringMarkdownExportV1(original)
    expect(result.containsHtml).toBe(false)
    const blocks = compileNovelMarkdownV1(createNovelMarkdownStateV1(result.markdown, [], { rootParagraphs: 'commonmark' }), undefined, { rootParagraphs: 'commonmark' })
    expect(parseAuthoringHtmlV1(blocks.map(row => row.html).join('')).pmDoc.eq(parseAuthoringHtmlV1(original).pmDoc)).toBe(true)
  })
  it('keeps exact safe old style and empty paragraphs as explicit HTML fragments, without internal keys', () => {
    const original = '<p></p><p style="line-height:1.8"><span style="color:red;font-size:18px">旧稿😀</span></p><p></p>'
    const result = serializeAuthoringMarkdownExportV1(original)
    expect(result.containsHtml).toBe(true)
    expect(result.markdown).toBe('<p></p>\n\n<p style="line-height:1.8"><span style="color:red;font-size:18px">旧稿😀</span></p>\n\n<p></p>')
    expect(result.markdown).not.toMatch(/blockKey|sourceRevision|res:v1/)
  })
  it.each(['<p onclick="bad()">字</p>', '<p><img src="https://blocked.invalid/a"></p>', '<script>bad()</script>', '<p><a href="javascript:bad()">字</a></p>', '<p style="background:url(https://blocked.invalid/a)">字</p>'])('refuses unsafe fallback instead of deleting or emitting executable HTML: %s', original => {
    expect(() => serializeAuthoringMarkdownExportV1(original)).toThrow('完整项目备份')
  })

  it.each([
    '<p style="color:red"><!-- --!><img src=x onerror=alert(1)> --></p>',
    '<p><!-- --!><script>alert(1)</script> --></p>',
    '<p><!--><img src=x onerror=alert(1)> --></p>',
    '<p><!---><a href="javascript:alert(1)">链接</a> --></p>',
    '<p><!-- outer <!-- --!><img src=x onerror=alert(1)> --></p>',
  ])('rejects browser-ambiguous comment fallback: %s', original => {
    expect(() => serializeAuthoringMarkdownExportV1(original)).toThrow('完整项目备份')
    expect(canExportAuthoringHtmlV1(original)).toBe(false)
  })

  it.each([
    '<ol><li><p>甲</p></li></ol><ol><li><p>乙</p></li></ol>',
    '<ul><li><p>甲</p></li></ul><ul><li><p>乙</p></li></ul>',
    '<blockquote><p>甲</p></blockquote><blockquote><p>乙</p></blockquote>',
  ])('preserves adjacent root container boundaries: %s', original => {
    const result = serializeAuthoringMarkdownExportV1(original)
    const rendered = marked.parse(result.markdown, { async: false })
    expect(parseAuthoringHtmlV1(rendered).pmDoc.eq(parseAuthoringHtmlV1(original).pmDoc)).toBe(true)
  })

  it('preserves container runs on both sides of a styled HTML boundary', () => {
    const original = '<ol><li><p>甲</p></li></ol><ol><li><p>乙</p></li></ol><p style="line-height:1.8">中间旧样式</p><ul><li><p>丙</p></li></ul><ul><li><p>丁</p></li></ul>'
    const result = serializeAuthoringMarkdownExportV1(original)
    expect(result.containsHtml).toBe(true)
    const rendered = marked.parse(result.markdown, { async: false })
    expect(parseAuthoringHtmlV1(rendered).pmDoc.eq(parseAuthoringHtmlV1(original).pmDoc)).toBe(true)
  })

  it('keeps ordinary safe comments and styles as exact explicit HTML fallback', () => {
    const original = '<p style="line-height:1.8"><!--作者注释--><span style="color:red">旧稿</span></p>'
    expect(serializeAuthoringMarkdownExportV1(original)).toEqual({ markdown: original, containsHtml: true })
  })
})

beforeEach(async () => {
  await db.delete(); await db.open()
  useOutlineStore.setState({ nodes: [], loadedScope: null, loading: false, loadError: null })
})
afterEach(() => db.close())
const databaseBytes = async () => JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
async function manuscript(html: string) {
  const { scope } = await createWorkspace({ name: '原型导出', description: '', genres: [], status: 'drafting', targetWordCount: 1000 }, { kind: 'novel', novelProfile: 'long' })
  const outlineNodeId = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, title: '本章', type: 'chapter', summary: '', order: 0, worldGroupId: null }, scope)
  const result = await adopt({ projectId: scope.projectId, scope, target: 'chapters', mode: 'add', data: { outlineNodeId, title: '本章', content: html, wordCount: countWords(htmlToPlainText(html)), status: 'draft', order: 0, notes: '' } })
  expect(result.fkErrors).toEqual([])
  return scope
}

it('actual owned export keeps h1-h6 and safe styles, states the file boundary and leaves every DB byte unchanged', async () => {
  const styled = '<p style="line-height:1.8"><span style="color:red">旧稿😀</span></p>'
  const body = [1, 2, 3, 4, 5, 6].map(level => `<h${level}>正文${level}</h${level}>`).join('') + styled
  const scope = await manuscript(body), before = await databaseBytes()
  const markdown = await exportProjectMarkdown(scope)
  for (const level of [1, 2, 3, 4, 5, 6]) expect(markdown).toContain('#'.repeat(level) + ` 正文${level}`)
  expect(markdown).toContain(styled)
  expect(markdown.split(MARKDOWN_HTML_FORMAT_BOUNDARY_V1)).toHaveLength(2)
  expect(await databaseBytes()).toBe(before)
})

it('failed Markdown safety validation preserves the owned manuscript and its TXT alternative', async () => {
  const scope = await manuscript('<p>原稿</p><script>inert_fixture</script>'), before = await databaseBytes()
  await expect(exportProjectMarkdown(scope)).rejects.toThrow('完整项目备份')
  expect(await exportProjectTXT(scope)).toContain('原稿')
  expect(await databaseBytes()).toBe(before)
})

it.each([
  '<p style="color:red"><!-- --!><img src=x onerror=alert(1)> --></p>',
  '<p><!-- --!><script>alert(1)</script> --></p>',
])('actual owned export refuses ambiguous comments with source bytes and TXT unchanged: %s', async payload => {
  const scope = await manuscript(`<p>作者原稿</p>${payload}`)
  const before = await databaseBytes()
  const plain = await exportProjectTXT(scope)
  await expect(exportProjectMarkdown(scope)).rejects.toThrow('完整项目备份')
  expect(await exportProjectTXT(scope)).toBe(plain)
  expect(await databaseBytes()).toBe(before)
})
