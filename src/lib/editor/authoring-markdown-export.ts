import { isHtml } from '../utils/html'
import { canExportAuthoringHtmlV1, parseAuthoringHtmlV1, splitAuthoringHtmlV1, authoringSchemaV1 } from './authoring-html-blocks'
import { escapeAuthoringMarkdownTextV1, projectAuthoringPmV1 } from './authoring-markdown-projection'
import { compileNovelMarkdownV1, createNovelMarkdownStateV1 } from './novel-markdown-codec'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'

export const MARKDOWN_HTML_FORMAT_BOUNDARY_V1 = '<!-- 含安全 HTML 格式片段；完整格式恢复请使用完整项目备份。 -->'

/** One serialization kernel serves the novel editing projection and standard
 * Markdown files. The file uses standard paragraph separation; it is not a
 * second manuscript or a replacement for the full HTML backup lifecycle. */
export function serializeAuthoringMarkdownExportV1(html: string): { markdown: string; containsHtml: boolean } {
  if (!html) return { markdown: '', containsHtml: false }
  if (!isHtml(html)) {
    const lines = html.replace(/\r\n?/g, '\n').split('\n')
    return { markdown: lines.map(line => line ? escapeAuthoringMarkdownTextV1(line) : '<p></p>').join('\n\n'), containsHtml: lines.some(line => !line) }
  }
  const framing = splitAuthoringHtmlV1(html)
  if (!framing.framed) throw new Error('旧 HTML 的结构无法安全表示为 Markdown；原稿未改变，请改用 TXT 或完整项目备份。')
  let containsHtml = false
  const parts: string[] = []
  let run: { from: number; to: number; source: string; doc: ProseMirrorNode }[] = []
  const appendHtml = (source: string) => {
    if (!canExportAuthoringHtmlV1(source)) throw new Error('旧格式包含不能安全导出的 HTML；原稿未改变，请改用 TXT 或完整项目备份。')
    parts.push(source); containsHtml = true
  }
  const flushStandard = () => {
    if (!run.length) return
    // Prove the assembled run, not just individual blocks: adjacent lists can
    // otherwise merge in Markdown and silently lose their restart boundaries.
    const source = run.map(row => row.source).join('\n\n')
    const blocks = compileNovelMarkdownV1(createNovelMarkdownStateV1(source, [], { rootParagraphs: 'commonmark' }), undefined, { rootParagraphs: 'commonmark' })
    const actual = blocks.reduce((fragment, block) => fragment.append(block.pmDoc.content), Fragment.empty)
    const expected = run.reduce((fragment, row) => fragment.append(row.doc.content), Fragment.empty)
    const schema = authoringSchemaV1()
    if (schema.nodes.doc.create(null, actual).eq(schema.nodes.doc.create(null, expected))) parts.push(source)
    else appendHtml(html.slice(run[0].from, run[run.length - 1].to))
    run = []
  }
  for (const slice of framing.slices) {
    const parsed = parseAuthoringHtmlV1(slice.html)
    const projection = projectAuthoringPmV1(parsed.pmDoc.childCount === 1 ? parsed.pmDoc.firstChild! : parsed.pmDoc)
    if (!parsed.protected && projection.lossless && projection.source !== '') {
      run.push({ from: slice.from, to: slice.to, source: projection.source, doc: parsed.pmDoc })
    } else {
      flushStandard()
      appendHtml(slice.html)
    }
  }
  flushStandard()
  return { markdown: parts.join('\n\n'), containsHtml }
}
