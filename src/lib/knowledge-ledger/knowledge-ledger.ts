import type { Chapter, KnowledgeLedgerEntry, OutlineNode } from '../types'
import type { ConsistencyFinding } from '../ai/adapters/consistency-audit-adapter'
import { db } from '../db/schema'
import { readOwnedRows, resolveScope } from '../world-engine/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import { adopt } from '../registry/adopt'
import { resolveProjectionBoundary } from '../consistency/projection-boundary'

export const KNOWLEDGE_ACTIONS = ['learn', 'mislearn', 'forget', 'correct'] as const

export type KnowledgeProjectionState = 'known' | 'mistaken'

export interface ProjectedKnowledge {
  characterId: number | null
  characterName: string
  knowledgeKey: string
  statement: string
  state: KnowledgeProjectionState
  belief: string | null
  evidence: KnowledgeLedgerEntry[]
}

export interface ProjectKnowledgeInput {
  entries: KnowledgeLedgerEntry[]
  outlineNodes: OutlineNode[]
  chapters: Chapter[]
  chapterId?: number | null
  outlineNodeId?: number | null
  worldGroupId?: number | null
  characterId?: number | null
}

export interface CognitionReference {
  characterId: number
  characterName: string
  knowledgeKey: string
  quote: string
}

export interface CognitionCatalogEntry {
  characterId: number
  characterName: string
  knowledgeKey: string
  statement: string
}

export interface CognitionAuditSnapshot {
  catalog: CognitionCatalogEntry[]
  projected: ProjectedKnowledge[]
}

export type KnowledgeCandidateInput = Pick<
  KnowledgeLedgerEntry,
  'characterId' | 'characterName' | 'knowledgeKey' | 'statement' | 'action' | 'sourceType'
> & Partial<Pick<
  KnowledgeLedgerEntry,
  'worldGroupId' | 'factId' | 'belief' | 'sourceChapterId' | 'sourceQuote'
>>

export async function adoptKnowledgeCandidates(args: {
  projectId: number
  worldGroupId?: number | null
  candidates: KnowledgeCandidateInput[]
}): Promise<{ written: number; skipped: number }> {
  const result = await adopt({
    projectId: args.projectId,
    worldGroupId: args.worldGroupId,
    target: 'knowledgeLedger',
    mode: 'add-many',
    data: args.candidates.map(candidate => ({ ...candidate, status: 'candidate' })),
  })
  return { written: result.written.length, skipped: result.skipped.length + result.fkErrors.length + result.typeErrors.length }
}

export async function listKnowledgeEvents(
  projectId: number,
  status?: KnowledgeLedgerEntry['status'],
): Promise<KnowledgeLedgerEntry[]> {
  const rows = await db.knowledgeLedger.where('projectId').equals(projectId).toArray()
  const selected = status ? rows.filter(row => row.status === status) : rows
  return selected.sort((a, b) => b.updatedAt - a.updatedAt || (b.id ?? 0) - (a.id ?? 0))
}

/** 人工确认是候选进入认知投影的唯一入口。 */
export async function confirmKnowledgeCandidate(eventId: number): Promise<boolean> {
  const entry = await db.knowledgeLedger.get(eventId)
  if (!entry?.id || !['candidate', 'source-missing', 'invalid-range'].includes(entry.status)) return false
  if (entry.characterId == null || !entry.knowledgeKey.trim() || !entry.statement.trim()) return false
  const character = await db.characters.get(entry.characterId)
  if (!character || character.projectId !== entry.projectId) return false
  if (entry.action === 'mislearn' && !entry.belief?.trim()) return false
  if (entry.sourceChapterId != null) {
    const chapter = await db.chapters.get(entry.sourceChapterId)
    if (!chapter || chapter.projectId !== entry.projectId) return false
  }
  await db.knowledgeLedger.update(entry.id, { status: 'confirmed', updatedAt: Date.now() })
  return true
}

export async function rejectKnowledgeCandidate(eventId: number): Promise<boolean> {
  const entry = await db.knowledgeLedger.get(eventId)
  if (!entry?.id || entry.status === 'confirmed') return false
  await db.knowledgeLedger.update(entry.id, { status: 'rejected', updatedAt: Date.now() })
  return true
}

function characterKey(entry: Pick<KnowledgeLedgerEntry, 'characterId' | 'characterName'>): string {
  return entry.characterId != null ? `id:${entry.characterId}` : `name:${entry.characterName.trim()}`
}

/**
 * CONSISTENCY-2 · 计算目标章开始前的角色认知。
 *
 * 只读取 confirmed 事件；目标章自身事件严格排除。无章节的 manual/import
 * 事件视为基线，先于所有章节事件。章节位置始终从规范大纲顺序实时解析。
 */
export function projectCharacterKnowledge(input: ProjectKnowledgeInput): ProjectedKnowledge[] {
  const {
    targetOrder,
    orderOfChapter: orderOf,
  } = resolveProjectionBoundary(input)
  if (targetOrder == null) return []

  const eligible = input.entries
    .filter(entry => entry.status === 'confirmed')
    .filter(entry => input.characterId == null || entry.characterId === input.characterId)
    .filter(entry => {
      const eventWorld = entry.worldGroupId ?? null
      const targetWorld = input.worldGroupId ?? null
      return eventWorld == null || eventWorld === targetWorld
    })
    .filter(entry => {
      if (entry.sourceChapterId == null) return true
      const order = orderOf.get(entry.sourceChapterId)
      return order != null && order < targetOrder
    })
    .sort((a, b) => {
      const aOrder = a.sourceChapterId == null ? -1 : orderOf.get(a.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
      const bOrder = b.sourceChapterId == null ? -1 : orderOf.get(b.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
      return aOrder - bOrder || a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0)
    })

  const projected = new Map<string, ProjectedKnowledge>()
  for (const entry of eligible) {
    const key = JSON.stringify([characterKey(entry), entry.knowledgeKey])
    if (entry.action === 'forget') {
      projected.delete(key)
      continue
    }
    const previous = projected.get(key)
    projected.set(key, {
      characterId: entry.characterId ?? null,
      characterName: entry.characterName,
      knowledgeKey: entry.knowledgeKey,
      statement: entry.statement,
      state: entry.action === 'mislearn' ? 'mistaken' : 'known',
      belief: entry.action === 'mislearn' ? entry.belief?.trim() || null : null,
      evidence: [...(previous?.evidence ?? []), entry],
    })
  }
  return [...projected.values()].sort((a, b) =>
    a.characterName.localeCompare(b.characterName, 'zh-Hans-CN')
    || a.knowledgeKey.localeCompare(b.knowledgeKey))
}

export async function readProjectCharacterKnowledge(
  projectId: number,
  chapterId?: number | null,
  worldGroupId?: number | null,
  characterId?: number | null,
  outlineNodeId?: number | null,
  scope?: WorkspaceScope,
): Promise<ProjectedKnowledge[]> {
  const resolved = scope ?? await resolveScope({ projectId })
  const [entries, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<any>(resolved, 'knowledgeLedger', { owner: 'work' }),
    readOwnedRows<any>(resolved, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<any>(resolved, 'chapters', { owner: 'work' }),
  ])
  return projectCharacterKnowledge({
    entries,
    outlineNodes,
    chapters,
    chapterId,
    outlineNodeId,
    worldGroupId,
    characterId,
  })
}

export async function readCognitionAuditSnapshot(
  projectId: number,
  chapterId?: number | null,
  worldGroupId?: number | null,
  outlineNodeId?: number | null,
): Promise<CognitionAuditSnapshot> {
  const [entries, outlineNodes, chapters] = await Promise.all([
    db.knowledgeLedger.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
  ])
  const worldEntries = entries.filter(entry =>
    entry.status === 'confirmed'
    && entry.characterId != null
    && (entry.worldGroupId == null || entry.worldGroupId === (worldGroupId ?? null)))
  const catalogByKey = new Map<string, CognitionCatalogEntry>()
  for (const entry of worldEntries) {
    const key = `${entry.characterId}:${entry.knowledgeKey}`
    if (!catalogByKey.has(key)) {
      catalogByKey.set(key, {
        characterId: entry.characterId!,
        characterName: entry.characterName,
        knowledgeKey: entry.knowledgeKey,
        statement: entry.statement,
      })
    }
  }
  return {
    catalog: [...catalogByKey.values()],
    projected: projectCharacterKnowledge({
      entries, outlineNodes, chapters, chapterId, outlineNodeId, worldGroupId,
    }),
  }
}

export function formatCognitionCatalog(catalog: CognitionCatalogEntry[]): string {
  if (!catalog.length) return ''
  return [
    '【角色认知审计闭集】',
    ...catalog.slice(0, 160).map(item =>
      `- characterId=${item.characterId} | knowledgeKey=${item.knowledgeKey} | ${item.characterName} | ${item.statement}`),
  ].join('\n')
}

export function parseCognitionReferences(
  raw: string,
  generatedText: string,
  catalog: CognitionCatalogEntry[],
): CognitionReference[] {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { cognitionReferences?: unknown }
    if (!Array.isArray(parsed.cognitionReferences)) return []
    const allowed = new Map(catalog.map(item => [`${item.characterId}:${item.knowledgeKey}`, item]))
    return parsed.cognitionReferences.flatMap((value): CognitionReference[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const row = value as Record<string, unknown>
      const characterId = Number(row.characterId)
      const knowledgeKey = String(row.knowledgeKey ?? '').trim()
      const quote = String(row.quote ?? '').trim()
      const match = allowed.get(`${characterId}:${knowledgeKey}`)
      if (!match || !quote || !generatedText.includes(quote)) return []
      return [{ characterId, characterName: match.characterName, knowledgeKey, quote }]
    })
  } catch {
    return []
  }
}

export function formatCharacterKnowledgeContext(items: ProjectedKnowledge[]): string {
  if (!items.length) return ''
  return [
    '【角色认知边界（只能按角色本人已知内容写作）】',
    ...items.slice(0, 120).map(item => item.state === 'known'
      ? `- ${item.characterName}知道[${item.knowledgeKey}]：${item.statement}`
      : `- ${item.characterName}误以为[${item.knowledgeKey}]：${item.belief || '内容未记录'}（真实命题：${item.statement}）`),
  ].join('\n')
}

/**
 * 对闭集结构化引用做确定性检查。调用方必须先把 AI 输出限制为已登记的
 * characterId + knowledgeKey，并提供正文逐字 quote；本函数不做模糊语义猜测。
 */
export function checkCognitionBoundary(
  generatedText: string,
  references: CognitionReference[],
  projected: ProjectedKnowledge[],
): ConsistencyFinding[] {
  const known = new Map(projected.map(item => [
    `${item.characterId ?? 'null'}:${item.knowledgeKey}`,
    item,
  ]))
  const findings: ConsistencyFinding[] = []
  const seen = new Set<string>()
  for (const reference of references) {
    const quote = reference.quote.trim()
    if (!quote || !generatedText.includes(quote)) continue
    const dedupe = `${reference.characterId}:${reference.knowledgeKey}:${quote}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const state = known.get(`${reference.characterId}:${reference.knowledgeKey}`)
    if (state?.state === 'known') continue
    const evidenceEntry = state?.evidence[state.evidence.length - 1]
    findings.push({
      category: '角色认知边界',
      severity: 'hard',
      quote,
      evidence: evidenceEntry ? [{
        sourceType: 'canon',
        sourceId: evidenceEntry.id ?? 0,
        quote: state.state === 'mistaken'
          ? `${state.characterName}误以为：${state.belief || '内容未记录'}`
          : state.statement,
      }] : [],
      reason: state?.state === 'mistaken'
        ? `“${reference.characterName}”此时对“${state.statement}”仍持错误认知，正文却按真实命题行动或陈述。`
        : `“${reference.characterName}”在本章开始前没有获知“${reference.knowledgeKey}”，正文出现了提前知情。`,
      suggestion: '补充此前的获知证据，或把正文改为符合该角色当前认知的信息。',
    })
  }
  return findings
}
