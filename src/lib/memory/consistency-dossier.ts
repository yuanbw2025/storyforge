import { estimateTokens } from '../ai/context-budget'
import { hashChapterText } from '../ai/chapter-memory/text-normalization'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import type {
  ConsistencyDossierFindingV1,
  ConsistencyDossierSourceRefV1,
  LongTermConsistencyDossierV1,
} from '../types/memory-engineering'
import type { TemporalFact } from '../types/temporal-fact'
import { aggregateInventory, type ItemLedgerEntry } from '../types/item-ledger'
import { parseFields, type StateCard } from '../types/state-card'
import type { KnowledgeLedgerEntry } from '../types/knowledge-ledger'
import type { RetrievalChunk } from '../types/retrieval-chunk'
import type { StoryTimelineEvent } from '../types/story-timeline'
import type { Chapter, OutlineNode } from '../types'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  type WorkspaceScopeLike,
} from '../world-engine/scope'

const DEFAULT_DOSSIER_TOKEN_LIMIT = 6_000
const STALE_STATUSES = new Set(['stale', 'source-missing', 'invalid-range'])

function termsFrom(text: string): string[] {
  return [...new Set(text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(term => term.trim())
    .filter(term => term.length >= 2))]
    .slice(0, 32)
}

function beforeOrAt(orderOf: ReadonlyMap<number, number>, rowChapterId: unknown, boundaryOrder: number): boolean {
  if (typeof rowChapterId !== 'number') return true
  const rowOrder = orderOf.get(rowChapterId)
  return rowOrder != null && rowOrder <= boundaryOrder
}

async function sourceRef(
  table: string,
  row: { id?: number; status?: string },
  authority: ConsistencyDossierSourceRefV1['authority'],
): Promise<ConsistencyDossierSourceRefV1 | null> {
  if (row.id == null) return null
  const status = STALE_STATUSES.has(row.status ?? '')
    ? 'stale'
    : ['rejected', 'candidate'].includes(row.status ?? '')
      ? 'invalid'
      : 'current'
  return {
    table,
    recordId: row.id,
    exportId: `${table}:${row.id}`,
    contentHash: await hashCanonicalValue(row),
    authority,
    status,
  }
}

function finding(input: Omit<ConsistencyDossierFindingV1, 'findingId'>): ConsistencyDossierFindingV1 {
  return {
    ...input,
    findingId: [input.level, input.code, ...input.sourceExportIds].join(':'),
  }
}

function capLines(
  groups: Array<{ key: keyof Pick<LongTermConsistencyDossierV1, 'structuredFacts' | 'characterKnowledge' | 'currentStates' | 'inventory' | 'timeline' | 'keywordEvidence'>; lines: string[] }>,
  maxTokens: number,
): { values: Record<string, string[]>; estimatedTokens: number; truncated: boolean } {
  const values: Record<string, string[]> = Object.fromEntries(groups.map(group => [group.key, []]))
  let estimatedTokens = 0
  let truncated = false
  for (const group of groups) {
    for (const line of group.lines) {
      const tokens = estimateTokens(line)
      if (estimatedTokens + tokens > maxTokens) {
        truncated = true
        continue
      }
      values[group.key].push(line)
      estimatedTokens += tokens
    }
  }
  return { values, estimatedTokens, truncated }
}

/**
 * Builds the deterministic half of long-term consistency. No provider,
 * embedding endpoint, or model is consulted. L2 is exposed as an author
 * review queue and L3 can only be authorized by the caller for a later,
 * separately budgeted Harness run.
 */
export async function buildLongTermConsistencyDossierV1(input: {
  scope: WorkspaceScopeLike
  boundaryChapterId: number
  query?: string
  maxTokens?: number
  authorizeGenerativeReview?: boolean
}): Promise<LongTermConsistencyDossierV1> {
  const scope = await resolveReadScopeLike(input.scope)
  const [project, world, work, boundary] = await Promise.all([
    db.projects.get(scope.projectId),
    db.worlds.get(scope.worldId),
    db.works.get(scope.workId),
    db.chapters.get(input.boundaryChapterId),
  ])
  if (!project || !boundary
    || !await assertRecordInScope(scope, 'chapters', boundary, { owner: 'work' })) {
    throw new Error('无法为当前作品边界建立长期一致性档案')
  }
  // v54 startup migration supplies the portable identities in production.
  // Deterministic legacy labels keep historical exports and isolated Harness
  // fixtures readable without mutating data from a CONTEXT_SOURCES reader.
  const workspaceUid = project.workspaceUid ?? `LEGACY-PROJECT-${scope.projectId}`
  const workCode = work?.code ?? `LEGACY-WORK-${scope.workId || scope.projectId}`
  const worldCode = world?.code ?? `LEGACY-WORLD-${scope.worldId || scope.projectId}`

  const [facts, knowledge, states, items, timeline, chunks, outlines, chapters] = await Promise.all([
    readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' }),
    readOwnedRows<KnowledgeLedgerEntry>(scope, 'knowledgeLedger', { owner: 'work' }),
    readOwnedRows<StateCard>(scope, 'stateCards', { owner: 'work' }),
    readOwnedRows<ItemLedgerEntry>(scope, 'itemLedger', { owner: 'work' }),
    readOwnedRows<StoryTimelineEvent>(scope, 'storyTimelineEvents', { owner: 'work' }),
    readOwnedRows<RetrievalChunk>(scope, 'retrievalChunks', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
  ])
  const { sequence } = resolveCanonicalChapterSequence(outlines, chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, index) => { if (entry.chapter.id != null) orderOf.set(entry.chapter.id, index) })
  const boundaryOrder = orderOf.get(input.boundaryChapterId)
  if (boundaryOrder == null) throw new Error('一致性档案的章节不在当前作品规范章序中')

  const boundaryOutline = outlines.find(row => row.id === boundary.outlineNodeId)
  const boundaryWorldGroupId = boundaryOutline?.worldGroupId ?? null
  const relevantFacts = facts.filter(row => {
    if (row.worldGroupId != null && row.worldGroupId !== boundaryWorldGroupId) return false
    if (!['confirmed', 'superseded', 'stale', 'source-missing', 'invalid-range'].includes(row.status)) return false
    const from = row.validFromChapterId == null ? -1 : orderOf.get(row.validFromChapterId)
    if (from == null || from > boundaryOrder) return false
    const to = row.validToChapterId == null ? null : orderOf.get(row.validToChapterId)
    return to == null || to > boundaryOrder || STALE_STATUSES.has(row.status)
  })
  const relevantKnowledge = knowledge.filter(row => (
    ['confirmed', 'source-missing', 'invalid-range'].includes(row.status)
    && beforeOrAt(orderOf, row.sourceChapterId, boundaryOrder)
  ))
  const relevantItems = items.filter(row => beforeOrAt(orderOf, row.chapterId, boundaryOrder))
  const relevantTimeline = timeline
    .filter(row => beforeOrAt(orderOf, row.chapterId, boundaryOrder))
    .sort((a, b) => a.order - b.order)

  const query = [input.query, boundary.title, boundaryOutline?.summary]
    .filter(Boolean).join(' ')
  const queryTerms = termsFrom(query)
  const historicalChapterIds = new Set(sequence.slice(0, boundaryOrder).map(entry => entry.chapter.id).filter((id): id is number => id != null))
  const currentChapterById = new Map(chapters.filter(row => row.id != null).map(row => [row.id!, row]))
  const keywordChunks: RetrievalChunk[] = []
  for (const chunk of chunks) {
    if (!historicalChapterIds.has(chunk.sourceChapterId)) continue
    const lowerText = chunk.text.toLocaleLowerCase()
    const keywords = chunk.keywords.map(value => value.toLocaleLowerCase())
    if (queryTerms.length && !queryTerms.some(term => lowerText.includes(term) || keywords.some(keyword => keyword.includes(term)))) continue
    const chapter = currentChapterById.get(chunk.sourceChapterId)
    if (!chapter || chunk.sourceTextHash !== await hashChapterText(chapter.content ?? '')) continue
    keywordChunks.push(chunk)
    if (keywordChunks.length >= 12) break
  }

  const structuredFacts = relevantFacts
    .filter(row => ['confirmed', 'superseded'].includes(row.status))
    .map(row => `${row.subjectName}｜${row.predicate}=${row.value}`)
  const characterKnowledge = relevantKnowledge
    .filter(row => row.status === 'confirmed')
    .map(row => `${row.characterName}｜${row.action}｜${row.knowledgeKey}：${row.belief || row.statement}`)
  const currentStates = states.map(row => (
    `${row.category}/${row.entityName}｜${parseFields(row.fields).map(field => `${field.key}=${field.value}`).join('；')}`
  ))
  const inventory = aggregateInventory(relevantItems)
    .filter(row => row.quantity !== 0)
    .map(row => `${row.heldByName}｜${row.itemName}=${row.quantity}`)
  const timelineLines = relevantTimeline.map(row => `${row.storyTime || `序号${row.order}`}｜${row.title}`)
  const keywordEvidence = keywordChunks.map(row => `章节#${row.sourceChapterId}｜${row.text.slice(0, 360)}`)

  const sourceRows: Array<[string, Array<{ id?: number; status?: string }>, ConsistencyDossierSourceRefV1['authority']]> = [
    ['temporalFacts', relevantFacts, 'author-confirmed'],
    ['knowledgeLedger', relevantKnowledge, 'author-confirmed'],
    ['stateCards', states, 'accepted-evidence'],
    ['itemLedger', relevantItems, 'accepted-evidence'],
    ['storyTimelineEvents', relevantTimeline, 'accepted-evidence'],
    ['retrievalChunks', keywordChunks, 'derived-cache'],
  ]
  const sourceRefs = (await Promise.all(sourceRows.flatMap(([table, rows, authority]) => (
    rows.map(row => sourceRef(table, row, authority))
  )))).filter((ref): ref is ConsistencyDossierSourceRefV1 => ref != null)

  const findings: ConsistencyDossierFindingV1[] = []
  if (!project.workspaceUid || !work?.code || !world?.code) {
    findings.push(finding({
      level: 'L0-structural', severity: 'warning', code: 'legacy-portable-identity',
      message: '当前记录来自旧身份格式；启动迁移后会补齐可移植 workspaceUid/workCode。',
      sourceExportIds: [], execution: 'deterministic',
    }))
  }
  for (const ref of sourceRefs.filter(row => row.status !== 'current')) {
    findings.push(finding({
      level: 'L0-structural', severity: ref.status === 'invalid' ? 'blocking' : 'warning',
      code: `source-${ref.status}`, message: `${ref.exportId} 不能作为当前权威上下文，需作者复核。`,
      sourceExportIds: [ref.exportId], execution: 'deterministic',
    }))
  }
  const valuesByFactKey = new Map<string, TemporalFact[]>()
  for (const row of relevantFacts.filter(item => item.status === 'confirmed')) {
    const key = `${row.subjectName}\u0000${row.predicate}`
    valuesByFactKey.set(key, [...(valuesByFactKey.get(key) ?? []), row])
  }
  for (const rows of valuesByFactKey.values()) {
    if (new Set(rows.map(row => row.value)).size < 2) continue
    findings.push(finding({
      level: 'L1-state', severity: 'blocking', code: 'simultaneous-canon-values',
      message: `${rows[0].subjectName} 的 ${rows[0].predicate} 同时存在多个已确认值。`,
      sourceExportIds: rows.map(row => `temporalFacts:${row.id}`), execution: 'deterministic',
    }))
  }
  if (keywordEvidence.length) {
    findings.push(finding({
      level: 'L2-semantic', severity: 'info', code: 'keyword-evidence-review',
      message: `有 ${keywordEvidence.length} 条历史正文证据与本章边界相关，语义关系交由作者复核。`,
      sourceExportIds: keywordChunks.map(row => `retrievalChunks:${row.id}`), execution: 'author-review',
    }))
  }
  if (input.authorizeGenerativeReview) {
    findings.push(finding({
      level: 'L3-generative', severity: 'info', code: 'model-review-authorized',
      message: '作者已允许后续 Harness 运行创建生成式复核候选；本次档案构建仍未调用模型。',
      sourceExportIds: [], execution: 'optional-model',
    }))
  }

  const maxTokens = Math.max(256, Math.floor(input.maxTokens ?? DEFAULT_DOSSIER_TOKEN_LIMIT))
  const capped = capLines([
    { key: 'structuredFacts', lines: structuredFacts },
    { key: 'characterKnowledge', lines: characterKnowledge },
    { key: 'currentStates', lines: currentStates },
    { key: 'inventory', lines: inventory },
    { key: 'timeline', lines: timelineLines },
    { key: 'keywordEvidence', lines: keywordEvidence },
  ], maxTokens)
  const base = {
    version: 1 as const,
    projectId: scope.projectId,
    workspaceUid,
    worldCode,
    workCode,
    boundaryChapterId: input.boundaryChapterId,
    structuredFacts: capped.values.structuredFacts,
    characterKnowledge: capped.values.characterKnowledge,
    currentStates: capped.values.currentStates,
    inventory: capped.values.inventory,
    timeline: capped.values.timeline,
    keywordEvidence: capped.values.keywordEvidence,
    sourceRefs,
    findings,
    retrievalPolicy: {
      structuredExact: true as const,
      dependencyGraph: true as const,
      fullTextKeyword: true as const,
      embedding: {
        enabled: false as const,
        authoritative: false as const,
        reason: '向量相似度只表达近似相关性，不能确认 Canon、时序或作者意图。',
      },
    },
    checks: {
      L0: 'completed' as const,
      L1: 'completed' as const,
      L2: 'author-review-only' as const,
      L3: input.authorizeGenerativeReview ? 'author-authorized' as const : 'disabled' as const,
    },
    tokenBudget: {
      estimatedTokens: capped.estimatedTokens,
      maxTokens,
      truncated: capped.truncated,
      modelCalls: 0 as const,
    },
  }
  return { ...base, dossierHash: await hashCanonicalValue(base) }
}

export function formatLongTermConsistencyDossierV1(dossier: LongTermConsistencyDossierV1): string {
  const section = (title: string, lines: readonly string[]) => lines.length ? [`【${title}】`, ...lines] : []
  return [
    `【长期一致性档案】边界章节 #${dossier.boundaryChapterId}｜档案 ${dossier.dossierHash}`,
    `检索策略：结构化精确事实 + 依赖图 + 本地关键词；embedding=${dossier.retrievalPolicy.embedding.enabled ? 'on' : 'off'}（不具权威性）`,
    ...section('已确认时序事实', dossier.structuredFacts),
    ...section('角色认知边界', dossier.characterKnowledge),
    ...section('当前状态', dossier.currentStates),
    ...section('当前物品', dossier.inventory),
    ...section('故事时间线', dossier.timeline),
    ...section('历史正文关键词证据（仅供核对）', dossier.keywordEvidence),
    ...section('待处理一致性项', dossier.findings.map(item => `${item.level}/${item.severity}｜${item.message}`)),
    `预算：${dossier.tokenBudget.estimatedTokens}/${dossier.tokenBudget.maxTokens} tokens；模型调用=${dossier.tokenBudget.modelCalls}`,
  ].join('\n')
}
