import type { Transaction } from 'dexie'
import { parseFields, type StateCategory, type StateField } from '../types/state-card'
import type { TemporalFact } from '../types/temporal-fact'
import { normalizeFactPredicate } from '../registry/fact-predicate-registry'

interface LegacyStateCardRow {
  id?: number
  projectId: number
  category: StateCategory
  entityName: string
  fields: string
  lastChapterId?: number | null
  createdAt?: number
  updatedAt?: number
}

interface StableSubjectRefs {
  characterId?: number | null
  locationId?: number | null
  storyArcId?: number | null
  subjectWorldGroupId?: number | null
  codexEntryId?: number | null
}

type TableApi = Pick<Transaction, 'table'> | { table: (name: string) => any }

const MIGRATED_SOURCE = 'migrated-state-card'
const MIGRATED_PREDICATE = 'migratedStateCard'

function normalizeEntityName(name: string): string {
  return (name || '').trim()
}

function safeFields(raw: string): StateField[] {
  try {
    return parseFields(raw).filter(field => field.key?.trim() && field.value?.trim())
  } catch {
    return []
  }
}

function factValueFor(category: StateCategory, field: StateField, predicate: string): string {
  if (predicate === MIGRATED_PREDICATE) {
    return JSON.stringify({ category, field: field.key, value: field.value })
  }
  return field.value
}

function predicateFor(category: StateCategory, fieldKey: string): string {
  if (category !== 'character') return MIGRATED_PREDICATE
  return normalizeFactPredicate(fieldKey)?.key ?? MIGRATED_PREDICATE
}

async function projectRows(api: TableApi, table: string, projectId: number): Promise<any[]> {
  try {
    return await api.table(table).where('projectId').equals(projectId).toArray()
  } catch {
    return []
  }
}

async function resolveStableSubject(api: TableApi, card: LegacyStateCardRow): Promise<StableSubjectRefs> {
  const name = normalizeEntityName(card.entityName)
  if (!name) return {}

  if (card.category === 'character') {
    const hit = (await projectRows(api, 'characters', card.projectId)).find(row => row.name === name)
    return { characterId: hit?.id ?? null }
  }
  if (card.category === 'location') {
    const hit = (await projectRows(api, 'importantLocations', card.projectId)).find(row => row.name === name)
    return { locationId: hit?.id ?? null }
  }
  if (card.category === 'item' || card.category === 'faction') {
    const hit = (await projectRows(api, 'codexEntries', card.projectId)).find(row => row.name === name)
    return { codexEntryId: hit?.id ?? null }
  }
  if (card.category === 'event') {
    const arc = (await projectRows(api, 'storyArcs', card.projectId)).find(row => row.name === name)
    if (arc?.id != null) return { storyArcId: arc.id }
    const wg = (await projectRows(api, 'worldGroups', card.projectId)).find(row => row.name === name)
    return { subjectWorldGroupId: wg?.id ?? null }
  }
  return {}
}

function dedupeKey(fact: Pick<TemporalFact, 'projectId' | 'subjectName' | 'predicate' | 'value' | 'validFromChapterId' | 'sourceQuote'>): string {
  return [
    fact.projectId,
    fact.subjectName,
    fact.predicate,
    fact.value,
    fact.validFromChapterId ?? '',
    fact.sourceQuote ?? '',
  ].join('\u0000')
}

/**
 * NS-4 旧 stateCards → TemporalFact candidate 桥接。
 *
 * 不变量：
 * - 零丢失：旧 stateCards 原样保留，不删除、不覆盖；
 * - 不自动升 Canon：全部写 status:'candidate'；
 * - 可重复运行：按稳定 key 去重；
 * - 主体能解析到稳定主表时写 FK，解析不到也保留 subjectName 供作者后续人工处理。
 */
export async function migrateStateCardsToTemporalFactCandidates(api: TableApi, onlyProjectId?: number): Promise<{ written: number; skippedDuplicate: number }> {
  const cards = (await api.table('stateCards').toArray().catch(() => [])) as LegacyStateCardRow[]
  const scopedCards = onlyProjectId == null ? cards : cards.filter(card => card.projectId === onlyProjectId)
  if (!scopedCards.length) return { written: 0, skippedDuplicate: 0 }

  const existing = (await api.table('temporalFacts').toArray().catch(() => [])) as TemporalFact[]
  const seen = new Set(existing.map(fact => dedupeKey(fact)))
  const now = Date.now()
  let written = 0
  let skippedDuplicate = 0

  for (const card of scopedCards) {
    const subjectName = normalizeEntityName(card.entityName)
    if (!subjectName) continue
    const refs = await resolveStableSubject(api, card)
    for (const field of safeFields(card.fields)) {
      const predicate = predicateFor(card.category, field.key)
      const value = factValueFor(card.category, field, predicate)
      const fact: TemporalFact = {
        projectId: card.projectId,
        ...refs,
        subjectName,
        predicate,
        factKind: 'state',
        value,
        sourceType: 'import',
        sourceRecordTable: MIGRATED_SOURCE,
        sourceQuote: `迁移状态卡/${card.category}/${subjectName}/${field.key}：${field.value}`,
        validFromChapterId: card.lastChapterId ?? null,
        validToChapterId: null,
        status: 'candidate',
        locked: false,
        createdAt: card.createdAt ?? now,
        updatedAt: now,
      }
      const key = dedupeKey(fact)
      if (seen.has(key)) {
        skippedDuplicate++
        continue
      }
      await api.table('temporalFacts').add(fact)
      seen.add(key)
      written++
    }
  }

  return { written, skippedDuplicate }
}
