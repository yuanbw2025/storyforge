import { saveFile } from '../platform/save-file'
import { db } from '../db/schema'
import type { OutlineNode, Chapter } from '../types'
import { htmlToPlainText } from '../utils/html'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { byOutlineOrderThenId, walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { readOwnedRows, resolveReadScopeLike, scopeTransactionTables, type WorkspaceScopeLike } from '../workspace/scope'

interface TextExportEntry {
  node: OutlineNode | null
  chapter?: Chapter
  depth: number
}

/** Both formats share one owned snapshot and canonical body selection. The
 * structural visit below emits container headings (including empty volumes);
 * it must consume the canonical chapter ids exactly once in their given order. */
async function prepareTextExport(scopeInput: WorkspaceScopeLike): Promise<{ title: string; entries: TextExportEntry[] }> {
  // Numeric resolution may share a promise started by another caller. Capture
  // it before opening the transaction, then recheck explicit roots inside it.
  const capturedScope = await resolveReadScopeLike(scopeInput)
  const { work, outlineNodes, chapters } = await db.transaction('r', scopeTransactionTables(db.outlineNodes, db.chapters), async () => {
    const scope = await resolveReadScopeLike(capturedScope)
    const work = await db.works.get(scope.workId)
    if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('作品不存在')
    const [outlineNodes, chapters] = await Promise.all([
      readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
      readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    ])
    return { work, outlineNodes, chapters }
  })
  const walk = walkOutlineChaptersInCanonicalOrder(outlineNodes)
  if (walk.anomalies.some(anomaly => anomaly.kind === 'outline-cycle')) {
    throw new Error('大纲存在循环，无法确定导出结构；原稿未修改，请先检查大纲。')
  }
  for (const chapter of chapters) {
    const node = walk.nodeById.get(chapter.outlineNodeId)
    if (node && node.type !== 'chapter') {
      throw new Error(`正文「${chapter.title}」关联的不是章节节点，导出已停止；原稿未修改。`)
    }
  }
  const canonical = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const chapterByOutline = new Map(canonical.sequence.flatMap(entry =>
    entry.outlineNode ? [[entry.outlineNode.id!, entry.chapter] as const] : []))
  const children = new Map<number | null, OutlineNode[]>()
  for (const node of walk.nodeById.values()) {
    const parent = node.parentId != null && walk.nodeById.has(node.parentId) ? node.parentId : null
    const siblings = children.get(parent) ?? []
    siblings.push(node)
    children.set(parent, siblings)
  }
  for (const siblings of children.values()) siblings.sort(byOutlineOrderThenId)

  const entries: TextExportEntry[] = []
  let chapterIndex = 0
  const visit = (node: OutlineNode, depth: number) => {
    if (node.type === 'chapter') {
      if (walk.chapters[chapterIndex]?.outlineNode.id !== node.id) throw new Error('章节顺序无法完整核对，导出已停止；原稿未修改。')
      chapterIndex += 1
    }
    entries.push({ node, chapter: node.type === 'chapter' ? chapterByOutline.get(node.id!) : undefined, depth })
    for (const child of children.get(node.id!) ?? []) visit(child, depth + 1)
  }
  for (const root of children.get(null) ?? []) visit(root, 0)
  if (chapterIndex !== walk.chapters.length) throw new Error('存在未能导出的章节，导出已停止；原稿未修改。')
  // The established canonical recovery sequence preserves real bodies whose
  // outline is missing. It does not create or repair any persisted association.
  for (const entry of canonical.sequence) if (!entry.outlineNode) entries.push({ node: null, chapter: entry.chapter, depth: 0 })
  return { title: work.title, entries }
}

/** 导出为 Markdown 格式 */
export async function exportProjectMarkdown(scopeInput: WorkspaceScopeLike): Promise<string> {
  const { title, entries } = await prepareTextExport(scopeInput)
  const { serializeAuthoringMarkdownExportV1, MARKDOWN_HTML_FORMAT_BOUNDARY_V1 } = await import('../editor/authoring-markdown-export')
  const header = `# ${title}\n\n`
  let md = header
  let containsHtml = false
  for (const { node, chapter, depth } of entries) {
    if (!node || node.type === 'chapter') {
      const heading = '#'.repeat(Math.min(6, Math.max(4, depth + 2)))
      md += `${heading} ${node?.title ?? chapter!.title}\n\n`
      if (chapter?.content) {
        const body = serializeAuthoringMarkdownExportV1(chapter.content)
        md += `${body.markdown}\n\n`
        containsHtml ||= body.containsHtml
      }
      else if (node?.summary) md += `*（大纲：${node.summary}）*\n\n`
    } else {
      md += `${'#'.repeat(Math.min(6, depth + 2))} ${node.title}\n\n`
      if (node.type === 'volume' && node.summary) md += `> ${node.summary}\n\n`
    }
  }
  return (containsHtml ? header + MARKDOWN_HTML_FORMAT_BOUNDARY_V1 + '\n\n' + md.slice(header.length) : md).trim()
}

/** 导出为纯文本格式 */
export async function exportProjectTXT(scopeInput: WorkspaceScopeLike): Promise<string> {
  const { title, entries } = await prepareTextExport(scopeInput)
  let txt = `${title}\n${'='.repeat(title.length * 2)}\n\n`
  for (const { node, chapter } of entries) {
    if (!node || node.type === 'chapter') {
      txt += `    ${node?.title ?? chapter!.title}\n\n`
      if (chapter?.content) txt += `${htmlToPlainText(chapter.content)}\n\n`
    } else if (node.type === 'volume') txt += `【${node.title}】\n\n`
    else txt += `  〔${node.title}〕\n\n`
  }
  return txt.trim()
}

/** 下载文本文件 */
export async function downloadTextFile(content: string, filename: string, mimeType: string = 'text/plain'): Promise<void> {
  await saveFile(new Blob([content], { type: `${mimeType};charset=utf-8` }), filename)
}
