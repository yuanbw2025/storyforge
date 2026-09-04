/**
 * NS-6 · 全闭环 — 正文修改的 stale 传播 + 影响分析。
 *
 * 设计 §22.8 NS-6 / §26.4：改某章正文后——
 * - 该章派生记忆失效：handoff/摘要由 hash 自动 stale（NS-1）、检索块由 hash 重建（NS-5）；
 *   事实账本里【源自该章】且证据引文已不在新正文的【已确认】事实 → 标记 stale/待复核（§16.7），
 *   绝不自动删事实、绝不动 locked。
 * - 影响分析：列出"引用了该章事实/紧随其后的"后续章节，交作者复核——只提示、不自动改正文。
 */
import { db } from '../db/schema'
import type { TemporalFact } from '../types/temporal-fact'
import { hashChapterText, normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  type WorkspaceScopeLike,
} from '../workspace/scope'
import type { Chapter, OutlineNode } from '../types'

/**
 * 正文改动后传播 stale：源自该章、证据已失效的【已确认】事实标记 stale（待作者重新确认）。
 * 不删事实、不动 locked、不碰候选/已否决。
 */
export async function propagateChapterEditStale(scopeInput: WorkspaceScopeLike, chapterId: number): Promise<{ demotedFacts: number }> {
  const scope = await resolveScopeLike(scopeInput)
  const chapter = await db.chapters.get(chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('来源章节不存在或不属于当前作品')
  }
  const content = normalizeChapterText(chapter?.content || '')
  const facts = (await readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' }))
    .filter(f => f.sourceChapterId === chapterId && f.status === 'confirmed' && !f.locked)
  let demoted = 0
  for (const f of facts) {
    // 证据引文已不在新正文 → 该确认事实失去依据，标记 stale 待复核
    if (f.sourceQuote && !content.includes(f.sourceQuote) && f.id != null) {
      await db.temporalFacts.update(f.id, { status: 'stale', updatedAt: Date.now() })
      demoted++
    }
  }
  return { demotedFacts: demoted }
}

export interface EditImpact {
  /** 源自被改章的事实（作者应复核它们是否仍成立） */
  factsFromChapter: TemporalFact[]
  /** 规范章序在被改章之后、可能受影响需复核的后续章 id（按章序） */
  downstreamChapterIds: number[]
}

export const EDIT_IMPACT_GRAPH_VERSION_V1 = 1 as const

export type EditImpactGraphNodeKindV1 =
  | 'changed-source'
  | 'chapter'
  | 'outline'
  | 'fact'
  | 'source-record'
  | 'summary'
  | 'retrieval-chunk'
  | 'storyline-progress'
  | 'storyline-crossing'
  | 'state-card'
  | 'item-ledger'
  | 'timeline-event'

export interface EditImpactGraphNodeV1 {
  id: string
  kind: EditImpactGraphNodeKindV1
  table: string
  recordId: number | null
  status?: string
  label?: string
}

export interface EditImpactGraphEdgeV1 {
  from: string
  to: string
  relation: string
  evidence?: string
}

export interface EditImpactGraphV1 {
  version: typeof EDIT_IMPACT_GRAPH_VERSION_V1
  source: {
    table: 'chapters'
    recordId: number
    sourceTextHash: string
  }
  nodes: EditImpactGraphNodeV1[]
  edges: EditImpactGraphEdgeV1[]
  staleFactIds: number[]
  downstreamChapterIds: number[]
  sourceRecordIds: string[]
  graphHash: string
}

function parentChain(node: OutlineNode | undefined, byId: Map<number, OutlineNode>): OutlineNode[] {
  const chain: OutlineNode[] = []
  const seen = new Set<number>()
  let current = node
  while (current?.id != null && !seen.has(current.id)) {
    chain.push(current)
    seen.add(current.id)
    current = current.parentId == null ? undefined : byId.get(current.parentId)
  }
  return chain
}

/**
 * NS-6/HARNESS-43: deterministic impact graph for an edited chapter.
 * The graph is a read-only projection of registered tables. It is evidence
 * for a later author-confirmed patch, never a write instruction by itself.
 */
export async function buildEditImpactGraphV1(
  scopeInput: WorkspaceScopeLike,
  chapterId: number,
): Promise<EditImpactGraphV1> {
  const scope = await resolveReadScopeLike(scopeInput)
  const source = await db.chapters.get(chapterId)
  if (!source || !await assertRecordInScope(scope, 'chapters', source, { owner: 'work' })) {
    throw new Error('来源章节不存在或不属于当前作品')
  }
  const [facts, outlineNodes, chapters, summaries, chunks, progress, crossings, stateCards, itemLedger, timeline] = await Promise.all([
    readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<any>(scope, 'narrativeSummaryNodes', { owner: 'work' }),
    readOwnedRows<any>(scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<any>(scope, 'storylineProgress', { owner: 'work' }),
    readOwnedRows<any>(scope, 'storylineCrossings', { owner: 'work' }),
    readOwnedRows<any>(scope, 'stateCards', { owner: 'work' }),
    readOwnedRows<any>(scope, 'itemLedger', { owner: 'work' }),
    readOwnedRows<any>(scope, 'storyTimelineEvents', { owner: 'work' }),
  ])
  const byOutlineId = new Map(outlineNodes.filter(node => node.id != null).map(node => [node.id!, node]))
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const sourceIndex = sequence.findIndex(entry => entry.chapter.id === chapterId)
  const downstreamChapterIds = sourceIndex < 0
    ? []
    : sequence.slice(sourceIndex + 1).map(entry => entry.chapter.id).filter((id): id is number => id != null)
  const relevantChapterIds = new Set([chapterId, ...downstreamChapterIds])
  const relevantVolumeIds = new Set<number>()
  for (const chapter of chapters.filter(row => relevantChapterIds.has(row.id ?? -1))) {
    const volume = parentChain(chapter.outlineNodeId == null ? undefined : byOutlineId.get(chapter.outlineNodeId), byOutlineId)
      .find(node => node.type === 'volume')
    if (volume?.id != null) relevantVolumeIds.add(volume.id)
  }

  const nodes: EditImpactGraphNodeV1[] = []
  const nodeIds = new Set<string>()
  const edges: EditImpactGraphEdgeV1[] = []
  const edgeIds = new Set<string>()
  const addNode = (node: EditImpactGraphNodeV1) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const addEdge = (edge: EditImpactGraphEdgeV1) => {
    const key = `${edge.from}|${edge.to}|${edge.relation}|${edge.evidence ?? ''}`
    if (edgeIds.has(key)) return
    edgeIds.add(key)
    edges.push(edge)
  }
  const sourceNodeId = `source:chapters:${chapterId}`
  addNode({ id: sourceNodeId, kind: 'changed-source', table: 'chapters', recordId: chapterId, label: source.title })

  const chapterNodeId = (id: number) => `chapter:${id}`
  const outlineNodeId = (id: number) => `outline:${id}`
  const addChapterDependencies = (chapter: Chapter) => {
    if (chapter.id == null) return
    const id = chapter.id
    const chapterNode = chapterNodeId(id)
    if (id !== chapterId) {
      addNode({ id: chapterNode, kind: 'chapter', table: 'chapters', recordId: id, label: chapter.title })
      addEdge({ from: sourceNodeId, to: chapterNode, relation: 'chronological-downstream' })
    }
    if (chapter.outlineNodeId != null) {
      const outline = byOutlineId.get(chapter.outlineNodeId)
      if (outline?.id != null) {
        const outlineId = outlineNodeId(outline.id)
        addNode({ id: outlineId, kind: 'outline', table: 'outlineNodes', recordId: outline.id, label: outline.title })
        addEdge({ from: id === chapterId ? sourceNodeId : chapterNode, to: outlineId, relation: 'chapter-outline' })
      }
    }
  }
  addChapterDependencies(source)
  for (const chapter of chapters.filter(row => row.id != null && downstreamChapterIds.includes(row.id))) addChapterDependencies(chapter)

  const relevantFacts = facts.filter(fact => fact.sourceChapterId === chapterId)
  const staleFactIds: number[] = []
  const sourceRecordIds: string[] = []
  for (const fact of relevantFacts) {
    const factId = fact.id != null ? `fact:${fact.id}` : `fact:${fact.subjectName}:${fact.predicate}:${fact.value}`
    addNode({ id: factId, kind: 'fact', table: 'temporalFacts', recordId: fact.id ?? null, status: fact.status, label: `${fact.subjectName}/${fact.predicate}` })
    addEdge({ from: sourceNodeId, to: factId, relation: 'source-fact', evidence: fact.sourceQuote })
    if (['stale', 'source-missing', 'invalid-range'].includes(fact.status) && fact.id != null) staleFactIds.push(fact.id)
    const typedSourceRecordId = fact.sourceRecordTable === 'worldviews' ? fact.sourceWorldviewId
      : fact.sourceRecordTable === 'powerSystems' ? fact.sourcePowerSystemId
        : fact.sourceRecordTable === 'cultivationSystems' ? fact.sourceCultivationSystemId
          : fact.sourceRecordTable === 'storyCores' ? fact.sourceStoryCoreId
            : fact.sourceRecordTable === 'characters' ? fact.sourceCharacterId
              : null
    if (fact.sourceRecordTable && typedSourceRecordId != null) {
      const sourceRecordId = `${fact.sourceRecordTable}:${typedSourceRecordId}`
      sourceRecordIds.push(sourceRecordId)
      const nodeId = `source-record:${sourceRecordId}`
      addNode({ id: nodeId, kind: 'source-record', table: fact.sourceRecordTable, recordId: typedSourceRecordId })
      addEdge({ from: nodeId, to: factId, relation: 'fact-source-record' })
    }
  }

  for (const summary of summaries.filter(row => (
    (row.sourceChapterId != null && relevantChapterIds.has(row.sourceChapterId))
    || (row.level === 'volume' && row.sourceOutlineNodeId != null && relevantVolumeIds.has(row.sourceOutlineNodeId))
    || row.level === 'book'
  ))) {
    if (summary.id == null) continue
    const id = `summary:${summary.id}`
    addNode({ id, kind: 'summary', table: 'narrativeSummaryNodes', recordId: summary.id, status: summary.status, label: summary.title })
    const parent = summary.sourceChapterId === chapterId
      ? sourceNodeId
      : summary.sourceChapterId != null
        ? chapterNodeId(summary.sourceChapterId)
        : summary.sourceOutlineNodeId != null
          ? outlineNodeId(summary.sourceOutlineNodeId)
          : sourceNodeId
    addEdge({ from: parent, to: id, relation: 'derived-summary' })
  }
  for (const chunk of chunks.filter(row => row.sourceChapterId === chapterId)) {
    if (chunk.id == null) continue
    const id = `retrieval-chunk:${chunk.id}`
    addNode({ id, kind: 'retrieval-chunk', table: 'retrievalChunks', recordId: chunk.id, status: chunk.sourceTextHash === await hashChapterText(source.content ?? '') ? 'current' : 'stale' })
    addEdge({ from: sourceNodeId, to: id, relation: 'derived-retrieval' })
  }

  const chapterLinked = (row: any): number | null => (
    typeof row.chapterId === 'number' ? row.chapterId
      : typeof row.sourceChapterId === 'number' ? row.sourceChapterId
        : typeof row.lastActiveChapterId === 'number' ? row.lastActiveChapterId
          : null
  )
  const derivedRows: Array<{ rows: any[]; kind: EditImpactGraphNodeKindV1; table: string; relation: string }> = [
    { rows: progress, kind: 'storyline-progress', table: 'storylineProgress', relation: 'storyline-progress' },
    { rows: crossings, kind: 'storyline-crossing', table: 'storylineCrossings', relation: 'storyline-crossing' },
    { rows: stateCards, kind: 'state-card', table: 'stateCards', relation: 'derived-state' },
    { rows: itemLedger, kind: 'item-ledger', table: 'itemLedger', relation: 'derived-item' },
    { rows: timeline, kind: 'timeline-event', table: 'storyTimelineEvents', relation: 'derived-timeline' },
  ]
  for (const group of derivedRows) {
    for (const row of group.rows) {
      const linkedChapterId = chapterLinked(row)
      if (linkedChapterId == null || !relevantChapterIds.has(linkedChapterId) || row.id == null) continue
      const id = `${group.kind}:${row.id}`
      addNode({ id, kind: group.kind, table: group.table, recordId: row.id, label: row.title ?? row.entityName ?? row.itemName })
      addEdge({ from: linkedChapterId === chapterId ? sourceNodeId : chapterNodeId(linkedChapterId), to: id, relation: group.relation })
    }
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id))
  edges.sort((left, right) => `${left.from}|${left.to}|${left.relation}`.localeCompare(`${right.from}|${right.to}|${right.relation}`))
  const body = {
    version: EDIT_IMPACT_GRAPH_VERSION_V1,
    source: { table: 'chapters' as const, recordId: chapterId, sourceTextHash: await hashChapterText(source.content ?? '') },
    nodes,
    edges,
    staleFactIds: [...new Set(staleFactIds)].sort((a, b) => a - b),
    downstreamChapterIds,
    sourceRecordIds: [...new Set(sourceRecordIds)].sort(),
  }
  return { ...body, graphHash: await hashCanonicalValue(body) }
}

/**
 * 影响分析：改了某章后，列出源自该章的事实 + 其后续章（供作者复核）。只读、只提示，不自动改任何正文。
 */
export async function analyzeEditImpact(scopeInput: WorkspaceScopeLike, chapterId: number): Promise<EditImpact> {
  const scope = await resolveReadScopeLike(scopeInput)
  const source = await db.chapters.get(chapterId)
  if (!await assertRecordInScope(scope, 'chapters', source, { owner: 'work' })) {
    throw new Error('来源章节不存在或不属于当前作品')
  }
  const [facts, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' })
      .then(rows => rows.filter(f => f.sourceChapterId === chapterId)),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const idx = sequence.findIndex(e => e.chapter.id === chapterId)
  const downstreamChapterIds = idx >= 0
    ? sequence.slice(idx + 1).map(e => e.chapter.id!).filter(id => id != null)
    : []
  return { factsFromChapter: facts, downstreamChapterIds }
}
