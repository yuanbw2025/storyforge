/**
 * NS-5 · 叙事感知混合检索（关键词通道 + 可选 embedding 通道）。
 *
 * 设计 §22.8 NS-5。本模块负责：
 * - 把章节正文切块、抽实体关键词、写入 retrievalChunks（可重建缓存，按 sourceTextHash 失效重建）；
 * - 按"当前章需要"召回历史块：关键词重叠打分（纯浏览器，无需 embedding）+ 可选 embedding 余弦；
 *   硬过滤：未来章不泄漏（规范章序）、世界隔离、按时间重组；去重、邻接保留、top-K。
 * - embedding 不可用时只走关键词通道（优雅降级）。
 */
import { db } from '../db/schema'
import type { RetrievalChunk } from '../types/retrieval-chunk'
import type { NarrativeSummaryNode } from '../types/narrative-summary'
import { cosineSimilarity } from '../types/retrieval-chunk'
import type { Chapter, EmbeddingConfig, OutlineNode } from '../types'
import { normalizeChapterText, hashChapterText, getChapterDerivedMemoryStatus, sha256Text } from '../ai/chapter-memory/text-normalization'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { embedTexts, embeddingModelTag, isEmbeddingReady } from '../ai/adapters/embedding-adapter'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
} from '../workspace/scope'

const CHUNK_SIZE = 400
const SUMMARY_EXCERPT_CHARS = 220
const ROLLUP_CHARS = 1200

/** 把正文切成定长块（按段落边界尽量不切断）。 */
export function splitIntoChunks(text: string, size = CHUNK_SIZE): string[] {
  const clean = text.trim()
  if (!clean) return []
  const paras = clean.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let buf = ''
  for (const p of paras) {
    if ((buf + p).length > size && buf) { chunks.push(buf); buf = '' }
    buf = buf ? `${buf}\n${p}` : p
    while (buf.length > size * 1.6) { chunks.push(buf.slice(0, size)); buf = buf.slice(size) }
  }
  if (buf) chunks.push(buf)
  return chunks
}

/** 抽取出现在块里的已知实体（角色/词条名）作为关键词。 */
export function extractKeywords(text: string, knownEntities: string[]): string[] {
  const found = new Set<string>()
  for (const e of knownEntities) {
    if (e && e.length >= 2 && text.includes(e)) found.add(e)
  }
  return [...found]
}

/**
 * 重建某章的检索块（删旧块 + 切块 + 抽关键词 + 写入）。正文未变（hash 相同）则跳过。
 * embedding 字段留空——由可选 embedding 通道异步回填，不阻塞。
 */
export async function rebuildChapterChunks(args: {
  projectId: number
  chapter: Chapter
  worldGroupId?: number | null
  knownEntities: string[]
  scope?: WorkspaceScope
}): Promise<{ rebuilt: boolean; count: number }> {
  const { projectId, chapter, worldGroupId, knownEntities } = args
  if (chapter.id == null) return { rebuilt: false, count: 0 }
  const scope = args.scope ?? await resolveScopeLike(projectId)
  const currentChapter = await db.chapters.get(chapter.id)
  if (!await assertRecordInScope(scope, 'chapters', currentChapter, { owner: 'work' })) {
    throw new Error('检索块来源章节不存在或不属于当前作品。')
  }
  const normalized = normalizeChapterText(chapter.content || '')
  const hash = await hashChapterText(chapter.content || '')

  const existing = (await readOwnedRows<RetrievalChunk>(scope, 'retrievalChunks', { owner: 'work' }))
    .filter(chunk => chunk.sourceChapterId === chapter.id)
  if (existing.length && existing[0].sourceTextHash === hash) {
    return { rebuilt: false, count: existing.length } // 正文未变，复用
  }
  // 正文变了 / 首次：清旧块重建
  if (existing.length) await db.retrievalChunks.bulkDelete(existing.map(c => c.id!).filter(Boolean))
  if (!normalized.trim()) return { rebuilt: true, count: 0 }

  const pieces = splitIntoChunks(normalized)
  const now = Date.now()
  const rows: RetrievalChunk[] = pieces.map((text, i) => stampNewRecord(scope, 'retrievalChunks', {
    projectId,
    worldGroupId: worldGroupId ?? null,
    sourceChapterId: chapter.id!,
    chunkIndex: i,
    text,
    keywords: extractKeywords(text, knownEntities),
    embedding: null,
    embeddingModel: null,
    sourceTextHash: hash,
    createdAt: now,
  }, { owner: 'work' }) as RetrievalChunk)
  if (rows.length) await db.retrievalChunks.bulkAdd(rows)
  return { rebuilt: true, count: rows.length }
}

/**
 * 为整个项目重建/补齐检索块。用于老书、导入项目和手动“建立索引”：
 * 先确保历史章节都有 retrievalChunks，embedding 再作为可选第二步补向量。
 */
export async function rebuildProjectRetrievalChunks(args: {
  projectId: number
  onProgress?: (done: number, total: number) => void
  scope?: WorkspaceScope
}): Promise<{ chapters: number; rebuiltChapters: number; chunks: number }> {
  const scope = args.scope ?? await resolveScopeLike(args.projectId)
  const [chapters, outlineNodes, characters, codexEntries, locations] = await Promise.all([
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<any>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<any>(scope, 'codexEntries', { owner: 'world' }),
    readOwnedRows<any>(scope, 'importantLocations', { owner: 'world' }),
  ])
  const knownEntities = [
    ...characters.map(c => c.name),
    ...codexEntries.map(e => e.name),
    ...locations.map(l => l.name),
  ].filter((name): name is string => !!name && name.length >= 2)
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const worldByChapter = new Map<number, number | null>()
  sequence.forEach(entry => {
    if (entry.chapter.id != null) worldByChapter.set(entry.chapter.id, entry.worldGroupId)
  })

  let rebuiltChapters = 0
  let chunks = 0
  const sorted = sequence.map(entry => entry.chapter)
  const sequenced = new Set(sorted.map(chapter => chapter.id))
  for (const chapter of chapters) {
    if (!sequenced.has(chapter.id)) sorted.push(chapter)
  }

  for (let i = 0; i < sorted.length; i++) {
    const chapter = sorted[i]
    const result = await rebuildChapterChunks({
      projectId: args.projectId,
      chapter,
      worldGroupId: chapter.id != null ? worldByChapter.get(chapter.id) ?? null : null,
      knownEntities,
      scope,
    })
    if (result.rebuilt) rebuiltChapters++
    chunks += result.count
    args.onProgress?.(i + 1, sorted.length)
  }
  return { chapters: sorted.length, rebuiltChapters, chunks }
}

/**
 * RAG-1 可见资料库的“删除派生索引”边界。
 * 只清 retrievalChunks / narrativeSummaryNodes；章节正文与任何 Canon 记录绝不删除。
 */
export async function clearProjectRetrievalCache(projectId: number): Promise<{
  chunks: number
  summaries: number
}> {
  const scope = await resolveScopeLike(projectId)
  const [chunks, summaries] = await Promise.all([
    readOwnedRows<RetrievalChunk>(scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<NarrativeSummaryNode>(scope, 'narrativeSummaryNodes', { owner: 'work' }),
  ])
  return db.transaction('rw', db.retrievalChunks, db.narrativeSummaryNodes, async () => {
    const chunkKeys = chunks.map(chunk => chunk.id).filter((id): id is number => id != null)
    const summaryKeys = summaries.map(node => node.id).filter((id): id is number => id != null)
    if (chunkKeys.length) await db.retrievalChunks.bulkDelete(chunkKeys)
    if (summaryKeys.length) await db.narrativeSummaryNodes.bulkDelete(summaryKeys)
    return { chunks: chunkKeys.length, summaries: summaryKeys.length }
  })
}

function capText(text: string, max = SUMMARY_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max)}…`
}

function rollupLines(lines: string[], max = ROLLUP_CHARS): string {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const clean = line.trim()
    if (!clean) continue
    if (used + clean.length > max) {
      const left = Math.max(0, max - used)
      if (left > 20) out.push(`${clean.slice(0, left)}…`)
      break
    }
    out.push(clean)
    used += clean.length
  }
  return out.join('\n')
}

function outlineById(nodes: OutlineNode[]): Map<number, OutlineNode> {
  return new Map(nodes.filter(node => node.id != null).map(node => [node.id!, node]))
}

function nearestVolume(node: OutlineNode | null, byId: Map<number, OutlineNode>): OutlineNode | null {
  let cur = node
  const guard = new Set<number>()
  while (cur?.id != null) {
    if (cur.type === 'volume') return cur
    if (cur.parentId == null || guard.has(cur.id)) return null
    guard.add(cur.id)
    cur = byId.get(cur.parentId) ?? null
  }
  return null
}

async function chapterSummaryText(chapter: Chapter, outlineNode: OutlineNode | null): Promise<{ summary: string; sourceHash: string; status: NarrativeSummaryNode['status'] }> {
  const sourceHash = await hashChapterText(chapter.content || '')
  const memory = await getChapterDerivedMemoryStatus(chapter)
  if (chapter.summary?.trim() && memory.summary === 'verified') {
    return { summary: chapter.summary.trim(), sourceHash, status: 'verified' }
  }
  const text = normalizeChapterText(chapter.content || '')
  if (text) {
    const outline = outlineNode?.summary?.trim()
    const fallback = outline ? `${outline}\n正文摘录：${capText(text)}` : `正文摘录：${capText(text)}`
    return { summary: fallback, sourceHash, status: 'verified' }
  }
  if (outlineNode?.summary?.trim()) {
    return { summary: outlineNode.summary.trim(), sourceHash, status: 'pending' }
  }
  return { summary: '', sourceHash, status: 'pending' }
}

/**
 * NS-5 · 重建章→卷→全书层级摘要树。
 *
 * v1 采用 deterministic roll-up：不额外烧 AI token；来源是当前正文、已验证章节摘要和大纲。
 * 这是派生记忆，不是 Canon；每次重建先把旧节点标为 rebuilding，再原子替换为新 verified/pending 节点。
 */
export async function rebuildProjectNarrativeSummaries(args: {
  projectId: number
  onProgress?: (done: number, total: number) => void
  scope?: WorkspaceScope
}): Promise<{ chapterNodes: number; volumeNodes: number; bookNodes: number; staleNodes: number }> {
  const scope = args.scope ?? await resolveScopeLike(args.projectId)
  const [chapters, outlineNodes, characters, codexEntries, locations] = await Promise.all([
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<any>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<any>(scope, 'codexEntries', { owner: 'world' }),
    readOwnedRows<any>(scope, 'importantLocations', { owner: 'world' }),
  ])
  const existing = await readOwnedRows<NarrativeSummaryNode>(scope, 'narrativeSummaryNodes', { owner: 'work' })
  for (const node of existing) {
    if (node.id != null) await db.narrativeSummaryNodes.update(node.id, { status: 'rebuilding', updatedAt: Date.now() })
  }

  const knownEntities = [
    ...characters.map(c => c.name),
    ...codexEntries.map(e => e.name),
    ...locations.map(l => l.name),
  ].filter((name): name is string => !!name && name.length >= 2)
  const byId = outlineById(outlineNodes)
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const sequencedIds = new Set(sequence.map(entry => entry.chapter.id).filter((id): id is number => id != null))
  const ordered = [
    ...sequence,
    ...chapters
      .filter(chapter => chapter.id != null && !sequencedIds.has(chapter.id))
      .sort((a, b) => a.order - b.order || (a.id ?? 0) - (b.id ?? 0))
      .map(chapter => ({ chapter, outlineNode: null, worldGroupId: null })),
  ]

  const now = Date.now()
  const next: NarrativeSummaryNode[] = []
  const chapterNodesByVolume = new Map<number | 'root', NarrativeSummaryNode[]>()

  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]
    const chapter = entry.chapter
    if (chapter.id == null) continue
    const source = await chapterSummaryText(chapter, entry.outlineNode)
    const title = entry.outlineNode?.title || chapter.title || `章节#${chapter.id}`
    const summary = source.summary
    const volume = nearestVolume(entry.outlineNode, byId)
    const node = stampNewRecord(scope, 'narrativeSummaryNodes', {
      projectId: args.projectId,
      worldGroupId: entry.worldGroupId ?? null,
      level: 'chapter',
      sourceChapterId: chapter.id,
      sourceOutlineNodeId: entry.outlineNode?.id ?? null,
      title,
      summary,
      keywords: extractKeywords(`${title}\n${summary}`, knownEntities),
      sourceHash: source.sourceHash,
      status: source.status,
      generatedBy: 'system-rollup',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as NarrativeSummaryNode
    next.push(node)
    const volumeKey = volume?.id ?? 'root'
    const list = chapterNodesByVolume.get(volumeKey) ?? []
    list.push(node)
    chapterNodesByVolume.set(volumeKey, list)
    args.onProgress?.(i + 1, ordered.length)
  }

  const volumeNodes: NarrativeSummaryNode[] = []
  for (const [volumeKey, children] of chapterNodesByVolume) {
    if (!children.length) continue
    const volume = typeof volumeKey === 'number' ? byId.get(volumeKey) ?? null : null
    const title = volume?.title ?? '未分卷章节'
    const sourceText = children.map(child => `${child.sourceChapterId}:${child.sourceHash}:${child.status}:${child.summary}`).join('\n')
    const summary = rollupLines(children.map(child => `- ${child.title}：${child.summary}`))
    const status = children.some(child => child.status === 'verified') ? 'verified' : 'pending'
    const node = stampNewRecord(scope, 'narrativeSummaryNodes', {
      projectId: args.projectId,
      worldGroupId: children.find(child => child.worldGroupId != null)?.worldGroupId ?? volume?.worldGroupId ?? null,
      level: 'volume',
      sourceChapterId: null,
      sourceOutlineNodeId: volume?.id ?? null,
      title,
      summary,
      keywords: extractKeywords(`${title}\n${summary}`, knownEntities),
      sourceHash: await sha256Text(sourceText),
      status,
      generatedBy: 'system-rollup',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as NarrativeSummaryNode
    volumeNodes.push(node)
    next.push(node)
  }

  const bookSummary = rollupLines(volumeNodes.length
    ? volumeNodes.map(node => `- ${node.title}：${node.summary}`)
    : next.filter(node => node.level === 'chapter').map(node => `- ${node.title}：${node.summary}`), 1800)
  const bookSource = next.map(node => `${node.level}:${node.sourceOutlineNodeId ?? ''}:${node.sourceChapterId ?? ''}:${node.sourceHash}:${node.status}`).join('\n')
  if (bookSummary) {
    next.push(stampNewRecord(scope, 'narrativeSummaryNodes', {
      projectId: args.projectId,
      worldGroupId: null,
      level: 'book',
      sourceChapterId: null,
      sourceOutlineNodeId: null,
      title: '全书叙事摘要',
      summary: bookSummary,
      keywords: extractKeywords(bookSummary, knownEntities),
      sourceHash: await sha256Text(bookSource),
      status: next.some(node => node.status === 'verified') ? 'verified' : 'pending',
      generatedBy: 'system-rollup',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' }) as NarrativeSummaryNode)
  }

  await db.transaction('rw', db.narrativeSummaryNodes, async () => {
    const keys = existing.map(node => node.id).filter((id): id is number => id != null)
    if (keys.length) await db.narrativeSummaryNodes.bulkDelete(keys)
    if (next.length) await db.narrativeSummaryNodes.bulkAdd(next)
  })
  return {
    chapterNodes: next.filter(node => node.level === 'chapter').length,
    volumeNodes: next.filter(node => node.level === 'volume').length,
    bookNodes: next.filter(node => node.level === 'book').length,
    staleNodes: existing.filter(node => node.status === 'stale' || node.status === 'rebuilding').length,
  }
}

/**
 * 按当前章读取已验证的层级摘要：全书 + 所属卷 + 当前章之前的少量章节节点。
 * 未验证/重建中/过期节点不注入，避免派生记忆污染生成。
 */
export async function readNarrativeSummaryContext(args: {
  projectId: number
  currentChapterId: number
  worldGroupId?: number | null
  maxChapterNodes?: number
  scope?: WorkspaceScope
}): Promise<string> {
  const scope = args.scope ?? await resolveReadScopeLike(args.projectId)
  const [nodes, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<NarrativeSummaryNode>(scope, 'narrativeSummaryNodes', { owner: 'work' })
      .then(rows => rows.filter(node => node.status === 'verified')),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  if (!nodes.length) return ''
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  const outlineOf = new Map<number, OutlineNode | null>()
  const chapterById = new Map(chapters.filter(chapter => chapter.id != null).map(chapter => [chapter.id!, chapter]))
  sequence.forEach((entry, i) => {
    if (entry.chapter.id != null) {
      orderOf.set(entry.chapter.id, i)
      outlineOf.set(entry.chapter.id, entry.outlineNode)
    }
  })
  const currentOrder = orderOf.get(args.currentChapterId)
  if (currentOrder == null) return ''
  const byId = outlineById(outlineNodes)
  const currentVolume = nearestVolume(outlineOf.get(args.currentChapterId) ?? null, byId)
  const staleSourceIds = new Set<number>()
  for (const node of nodes) {
    if (node.level !== 'chapter' || node.sourceChapterId == null) continue
    const chapter = chapterById.get(node.sourceChapterId)
    if (!chapter || await hashChapterText(chapter.content || '') !== node.sourceHash) {
      staleSourceIds.add(node.sourceChapterId)
    }
  }
  const lines: string[] = ['【层级叙事摘要（章→卷→全书，派生记忆；只含已验证节点）】']
  const priorChapterNodes = nodes
    .filter(node => {
      if (node.level !== 'chapter' || node.sourceChapterId == null) return false
      if (staleSourceIds.has(node.sourceChapterId)) return false
      const order = orderOf.get(node.sourceChapterId)
      if (order == null || order >= currentOrder) return false
      if (node.worldGroupId != null && node.worldGroupId !== (args.worldGroupId ?? null)) return false
      return true
    })
    .sort((a, b) => (orderOf.get(a.sourceChapterId!) ?? -1) - (orderOf.get(b.sourceChapterId!) ?? -1))

  if (priorChapterNodes.length) {
    lines.push(`【全书截至本章】\n${rollupLines(priorChapterNodes.map(node => `- ${node.title}：${node.summary}`), 1800)}`)
  }

  const volumeNodes = currentVolume
    ? priorChapterNodes.filter(node => {
        const outline = node.sourceOutlineNodeId != null ? byId.get(node.sourceOutlineNodeId) ?? null : null
        return nearestVolume(outline, byId)?.id === currentVolume.id
      })
    : []
  if (currentVolume && volumeNodes.length) {
    lines.push(`【本卷截至本章：${currentVolume.title}】\n${rollupLines(volumeNodes.map(node => `- ${node.title}：${node.summary}`), 1200)}`)
  }

  const recent = priorChapterNodes.slice(-(args.maxChapterNodes ?? 8))
  if (recent.length) {
    lines.push('【当前章之前的摘要节点】')
    for (const node of recent) lines.push(`- ${node.title}：${node.summary}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

export interface RetrievedChunk {
  chunk: RetrievalChunk
  score: number
}

/**
 * 召回与查询相关的历史块。
 * - queryTerms：当前章的实体/关键词（角色名、章纲要点）；
 * - queryEmbedding：可选，提供则叠加余弦分（混合检索）；
 * - 硬过滤：只取规范章序 < 当前章的块（不泄漏未来）、当前世界（∪ null）。
 */
export async function retrieveChunks(args: {
  projectId: number
  currentChapterId: number
  worldGroupId?: number | null
  queryTerms: string[]
  queryEmbedding?: number[] | null
  /** 查询向量所属模型；只对同模型的块向量算余弦，绝不跨模型混算（不传则不限制） */
  queryEmbeddingModel?: string | null
  topK?: number
  scope?: WorkspaceScope
}): Promise<RetrievedChunk[]> {
  const { projectId, currentChapterId, worldGroupId, queryTerms, queryEmbedding, queryEmbeddingModel, topK = 6 } = args
  const scope = args.scope ?? await resolveReadScopeLike(projectId)
  const [chunks, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<RetrievalChunk>(scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  if (!chunks.length) return []

  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, i) => { if (entry.chapter.id != null) orderOf.set(entry.chapter.id, i) })
  const currentOrder = orderOf.get(currentChapterId)
  if (currentOrder == null) return []

  const terms = queryTerms.filter(t => t && t.length >= 2)
  const scored: RetrievedChunk[] = []
  for (const chunk of chunks) {
    const chunkOrder = orderOf.get(chunk.sourceChapterId)
    if (chunkOrder == null || chunkOrder >= currentOrder) continue          // 未来/当前章不召回
    if (chunk.worldGroupId != null && chunk.worldGroupId !== (worldGroupId ?? null)) continue // 世界隔离
    // 关键词重叠分（命中实体 + 命中文本词）
    let kw = 0
    for (const t of terms) {
      if (chunk.keywords.includes(t)) kw += 2
      else if (chunk.text.includes(t)) kw += 1
    }
    // 可选 embedding 余弦：仅当查询向量与块向量出自同一模型时才算（防跨模型混算）
    const sameModel = !queryEmbeddingModel || chunk.embeddingModel === queryEmbeddingModel
    const sem = queryEmbedding && sameModel ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0
    const score = kw + sem * 3
    if (score > 0) scored.push({ chunk, score })
  }
  scored.sort((a, b) => b.score - a.score || b.chunk.sourceChapterId - a.chunk.sourceChapterId)
  // 取 top-K 后按时间(章序→块序)重组，便于阅读
  const top = scored.slice(0, topK)
  top.sort((a, b) =>
    (orderOf.get(a.chunk.sourceChapterId)! - orderOf.get(b.chunk.sourceChapterId)!) ||
    (a.chunk.chunkIndex - b.chunk.chunkIndex))
  return top
}

// ── Embedding 通道（NS-5 语义检索，可选；不可用时上面纯关键词照常工作） ──

const EMBED_BATCH = 16

/**
 * 把查询文本嵌成向量供 retrieveChunks 混合打分用；不可用/失败返回 null（调用方退回纯关键词）。
 */
export async function embedQuery(text: string, cfg: EmbeddingConfig | null | undefined, projectId?: number | null): Promise<number[] | null> {
  if (!isEmbeddingReady(cfg) || !text.trim()) return null
  try {
    const [vec] = await embedTexts([text], cfg, projectId)
    return vec || null
  } catch (err) {
    console.warn('[NS-5] 查询嵌入失败，退回关键词通道:', err)
    return null
  }
}

/**
 * 为项目内"缺向量或向量过期(换了模型)"的检索块批量回填 embedding。
 * 幂等可续跑：每批落盘，再次运行只补未完成的；与当前模型不符的向量视为过期、重算。
 * 任一批失败不丢已完成的，整体抛错由调用方提示。
 */
export async function ensureChunkEmbeddings(args: {
  projectId: number
  cfg: EmbeddingConfig
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  scope?: WorkspaceScope
}): Promise<{ embedded: number; total: number; skipped: number }> {
  const { projectId, cfg, onProgress, signal } = args
  if (!isEmbeddingReady(cfg)) return { embedded: 0, total: 0, skipped: 0 }
  const scope = args.scope ?? await resolveScopeLike(projectId)
  const tag = embeddingModelTag(cfg)
  const all = await readOwnedRows<RetrievalChunk>(scope, 'retrievalChunks', { owner: 'work' })
  const pending = all.filter(c => c.id != null && (!c.embedding || !c.embedding.length || c.embeddingModel !== tag))
  const total = pending.length
  let embedded = 0
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    if (signal?.aborted) break
    const batch = pending.slice(i, i + EMBED_BATCH)
    const vectors = await embedTexts(batch.map(c => c.text), cfg, projectId, signal)
    await db.transaction('rw', db.retrievalChunks, async () => {
      for (let j = 0; j < batch.length; j++) {
        await db.retrievalChunks.update(batch[j].id!, { embedding: vectors[j], embeddingModel: tag })
      }
    })
    embedded += batch.length
    onProgress?.(embedded, total)
  }
  return { embedded, total, skipped: all.length - total }
}
