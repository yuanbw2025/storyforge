import { db } from '../db/schema'
import { readOwnedRows } from '../workspace/scope'
import type { Chapter, DetailedOutline, OutlineNode, WorkspaceScope } from '../types'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { buildBestChapterByOutlineMap } from '../chapters/selectors'
import { htmlToPlainText, countWords } from '../utils/html'

/** Read actual saved production state; candidate/run completion is never book completion. */
export async function readLongformProgressV1(scope: WorkspaceScope, worldGroupId: number | null) {
  const work = await db.works.get(scope.workId)
  if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('当前作品归属已变化。')
  const [nodes, chapters, details, characters, stories, worlds] = await Promise.all([
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<DetailedOutline>(scope, 'detailedOutlines', { owner: 'work' }),
    readOwnedRows<{ name: string; homeWorldGroupId?: number | null; isCrossWorld?: boolean }>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<{ logline?: string; concept?: string; centralConflict?: string }>(scope, 'storyCores', { owner: 'work' }),
    readOwnedRows<{ worldOrigin?: string; worldStructure?: string; worldGroupId?: number | null }>(scope, 'worldviews', { owner: 'world' }),
  ])
  const canonical = walkOutlineChaptersInCanonicalOrder(nodes).chapters
  const all = canonical.filter(item => (item.worldGroupId ?? null) === worldGroupId)
  const byOutline = buildBestChapterByOutlineMap(chapters)
  const detailIds = new Set(details.filter(row => row.scenes?.length).map(row => row.outlineNodeId))
  const rows = all.map(item => {
    const chapter = byOutline.get(item.outlineNode.id!)
    const words = countWords(htmlToPlainText(chapter?.content ?? ''))
    return { outlineNodeId: item.outlineNode.id!, chapterId: chapter?.id, title: item.outlineNode.title, ordinal: canonical.indexOf(item) + 1, hasSummary: !!item.outlineNode.summary.trim(), hasDetails: detailIds.has(item.outlineNode.id!), written: words > 0, words }
  })
  const characterCount = characters.filter(row => row.isCrossWorld || (row.homeWorldGroupId ?? null) === worldGroupId).length
  const storyReady = stories.some(row => row.logline?.trim() || row.concept?.trim() || row.centralConflict?.trim())
  const worldReady = worlds.some(row => (row.worldGroupId ?? null) === worldGroupId && (row.worldOrigin?.trim() || row.worldStructure?.trim()))
  const volumes = nodes.filter(row => row.type === 'volume' && (row.worldGroupId ?? null) === worldGroupId)
  const missing = rows.find(row => !row.written)
  const nextRequest = missing
    ? `我想先写第${missing.ordinal}章《${missing.title}》的正文。沿用已有内容，未确定的地方先作为候选，不要求补齐其他设定。`
    : rows.length
      ? '现有章节均已有正文。请与我讨论下一步：挑选章节续写、修订，或核对结局与导出；先不要新增或覆盖内容。'
      : '我想自由选择从一个场景、一个人物或一条设定开始。请结合已有内容，帮我确定这次最想写的一小步，不要求按顺序填完资料。'
  return { work, rows, characterCount, worldReady, storyReady, volumes: volumes.length, written: rows.filter(row => row.written).length, detailed: rows.filter(row => row.hasDetails).length, words: rows.reduce((sum, row) => sum + row.words, 0), nextRequest }
}
