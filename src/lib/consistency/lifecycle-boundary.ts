import type { Chapter, Character, OutlineNode } from '../types'
import type { ConsistencyFinding } from '../ai/adapters/consistency-audit-adapter'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { getFactPredicate, normalizeFactValue } from '../registry/fact-predicate-registry'
import type { TemporalFact } from '../types/temporal-fact'
import type { WorkspaceScope } from '../types/world-ownership'
import { readOwnedRows, resolveReadScopeLike } from '../workspace/scope'

export type CharacterLifecycleStatus = 'alive' | 'dead' | 'missing' | 'unknown'

export interface ProjectedCharacterLifecycle {
  characterId: number
  characterName: string
  status: CharacterLifecycleStatus
  fact: TemporalFact
}

export interface LifecycleCatalogEntry {
  characterId: number
  characterName: string
  status: 'dead'
  factId: number
  effectiveChapterId: number | null
}

export interface LifecycleActivityReference {
  characterId: number
  characterName: string
  activityType: 'normal-activity'
  quote: string
}

export interface LifecycleAuditSnapshot {
  catalog: LifecycleCatalogEntry[]
  projected: ProjectedCharacterLifecycle[]
}

interface ProjectLifecycleInput {
  facts: TemporalFact[]
  characters: Character[]
  outlineNodes: OutlineNode[]
  chapters: Chapter[]
  chapterId: number
  worldGroupId?: number | null
}

function resolveFactCharacterId(
  fact: TemporalFact,
  characters: Character[],
): number | null {
  if (fact.characterId != null) return fact.characterId
  const matches = characters.filter(character =>
    character.id != null && character.name === fact.subjectName)
  return matches.length === 1 ? matches[0].id! : null
}

function characterVisibleInWorld(
  character: Character,
  worldGroupId?: number | null,
): boolean {
  if (character.isCrossWorld) return true
  const home = character.homeWorldGroupId ?? null
  return home == null || home === (worldGroupId ?? null)
}

/**
 * 投影目标章“开始之前”的角色存亡状态。
 *
 * - 章序只来自规范大纲遍历，不读可漂移的 chapter.order；
 * - confirmed 与 superseded 都是历史 Canon，后者只在 validTo 之前有效；
 * - 目标章内新发生的死亡不提前约束该章，章内先后仍交软审计；
 * - 无法解析的章节引用、角色身份或枚举值不参与硬判决。
 */
export function projectCharacterLifecycles(
  input: ProjectLifecycleInput,
): ProjectedCharacterLifecycle[] {
  const { sequence } = resolveCanonicalChapterSequence(input.outlineNodes, input.chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, index) => {
    if (entry.chapter.id != null) orderOf.set(entry.chapter.id, index)
  })
  const targetOrder = orderOf.get(input.chapterId)
  if (targetOrder == null) return []

  const characterById = new Map(input.characters
    .filter(character => character.id != null)
    .map(character => [character.id!, character]))
  const aliveSpec = getFactPredicate('aliveStatus')
  if (!aliveSpec) return []

  const eligible = input.facts.flatMap(fact => {
    if (fact.predicate !== 'aliveStatus'
      || (fact.status !== 'confirmed' && fact.status !== 'superseded')) return []
    if (fact.worldGroupId != null && fact.worldGroupId !== (input.worldGroupId ?? null)) return []
    const characterId = resolveFactCharacterId(fact, input.characters)
    const character = characterId != null ? characterById.get(characterId) : undefined
    if (!characterId || !character || !characterVisibleInWorld(character, input.worldGroupId)) return []
    const status = normalizeFactValue(aliveSpec, fact.value) as CharacterLifecycleStatus | null
    if (!status) return []
    const fromOrder = fact.validFromChapterId == null
      ? -1
      : orderOf.get(fact.validFromChapterId)
    if (fromOrder == null || fromOrder >= targetOrder) return []
    const toOrder = fact.validToChapterId == null
      ? null
      : orderOf.get(fact.validToChapterId)
    if (fact.validToChapterId != null && toOrder == null) return []
    if (toOrder != null && toOrder <= targetOrder) return []
    return [{ fact, characterId, character, status, fromOrder }]
  }).sort((left, right) =>
    left.fromOrder - right.fromOrder
    || left.fact.createdAt - right.fact.createdAt
    || (left.fact.id ?? 0) - (right.fact.id ?? 0))

  const current = new Map<number, ProjectedCharacterLifecycle>()
  for (const item of eligible) {
    current.set(item.characterId, {
      characterId: item.characterId,
      characterName: item.character.name,
      status: item.status,
      fact: item.fact,
    })
  }
  return [...current.values()].sort((a, b) =>
    a.characterName.localeCompare(b.characterName, 'zh-Hans-CN'))
}

export async function readLifecycleAuditSnapshot(
  projectId: number,
  chapterId: number,
  worldGroupId?: number | null,
  scope?: WorkspaceScope,
): Promise<LifecycleAuditSnapshot> {
  const resolved = scope ?? await resolveReadScopeLike(projectId)
  const [facts, characters, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<TemporalFact>(resolved, 'temporalFacts', { owner: 'work' }),
    readOwnedRows<Character>(resolved, 'characters', { owner: 'world' }),
    readOwnedRows<OutlineNode>(resolved, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Chapter>(resolved, 'chapters', { owner: 'work' }),
  ])
  const projected = projectCharacterLifecycles({
    facts, characters, outlineNodes, chapters, chapterId, worldGroupId,
  })
  const catalog = projected.flatMap((item): LifecycleCatalogEntry[] =>
    item.status === 'dead' && item.fact.id != null
      ? [{
          characterId: item.characterId,
          characterName: item.characterName,
          status: 'dead',
          factId: item.fact.id,
          effectiveChapterId: item.fact.validFromChapterId ?? null,
        }]
      : [])
  return { catalog, projected }
}

export function formatLifecycleCatalog(catalog: LifecycleCatalogEntry[]): string {
  if (!catalog.length) return ''
  return [
    '【角色存亡审计闭集（目标章开始前）】',
    ...catalog.slice(0, 120).map(item =>
      `- characterId=${item.characterId} | ${item.characterName} | status=dead | canonFactId=${item.factId}`),
  ].join('\n')
}

/**
 * 模型只负责从正文中指出“正常在场行动”的逐字引用；身份与状态均来自闭集。
 * 尸体、回忆、梦境、幻象、转述和明确复活不属于 normal-activity。
 */
export function parseLifecycleActivityReferences(
  raw: string,
  generatedText: string,
  catalog: LifecycleCatalogEntry[],
): LifecycleActivityReference[] {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { lifecycleReferences?: unknown }
    if (!Array.isArray(parsed.lifecycleReferences)) return []
    const allowed = new Map(catalog.map(item => [item.characterId, item]))
    return parsed.lifecycleReferences.flatMap((value): LifecycleActivityReference[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const row = value as Record<string, unknown>
      const characterId = Number(row.characterId)
      const activityType = String(row.activityType ?? '')
      const quote = String(row.quote ?? '').trim()
      const match = allowed.get(characterId)
      if (!match
        || activityType !== 'normal-activity'
        || !quote
        || !generatedText.includes(quote)) return []
      return [{
        characterId,
        characterName: match.characterName,
        activityType: 'normal-activity',
        quote,
      }]
    })
  } catch {
    return []
  }
}

/** 对闭集活动引用与规范章序存亡投影做确定性比较。 */
export function checkCharacterLifecycleBoundary(
  generatedText: string,
  references: LifecycleActivityReference[],
  projected: ProjectedCharacterLifecycle[],
): ConsistencyFinding[] {
  const stateByCharacter = new Map(projected.map(item => [item.characterId, item]))
  const findings: ConsistencyFinding[] = []
  const seen = new Set<string>()
  for (const reference of references) {
    const quote = reference.quote.trim()
    const state = stateByCharacter.get(reference.characterId)
    if (!quote || !generatedText.includes(quote) || state?.status !== 'dead') continue
    const dedupe = `${reference.characterId}:${quote}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    findings.push({
      category: '角色存亡时序',
      severity: 'hard',
      quote,
      evidence: [{
        sourceType: 'canon',
        sourceId: state.fact.id ?? 0,
        quote: state.fact.sourceQuote?.trim()
          || `${state.characterName}｜存亡状态：dead`,
      }],
      reason: `“${state.characterName}”在本章开始前已由 Canon 标记为死亡，正文却让其作为存活角色正常行动。`,
      suggestion: '改为尸体、回忆、梦境或转述语境；若角色确已复活，请先提取并确认新的 aliveStatus=alive 事实。',
    })
  }
  return findings
}
