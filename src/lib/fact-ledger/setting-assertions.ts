import { db } from '../db/schema'
import { getFactPredicate, isConstitutionPredicate } from '../registry/fact-predicate-registry'
import {
  CANON_ASSERTION_SOURCE_REGISTRY,
  getCanonAssertionSourceField,
  isAllowedCanonAssertionSource,
  type CanonAssertionSourceTable,
} from '../registry/canon-assertion-source-registry'
import type { FactEntityType, TemporalFact } from '../types/temporal-fact'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
} from '../world-engine/scope'

export interface SettingAssertionSource {
  sourceKey: string
  table: CanonAssertionSourceTable
  recordId: number
  field: string
  label: string
  text: string
  worldGroupId?: number | null
  characterId?: number | null
  characterName?: string
  fingerprint: string
}

export interface ExtractedSettingAssertion {
  subjectType: Extract<FactEntityType, 'worldGroup' | 'character'>
  subjectId: number | null
  predicate: string
  value: string
  sourceKey: string
  quote: string
}

export interface SettingAssertionClash {
  candidate: TemporalFact
  confirmed: TemporalFact
}

function stableText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 可跨浏览器稳定复算的轻量文本指纹；用途是变更检测，不用于安全校验。 */
export function fingerprintSettingSource(value: unknown): string {
  const text = stableText(value).normalize('NFKC').replace(/\s+/g, ' ').trim()
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`
}

/**
 * 确定性冲突比较的有限规范化：Unicode、空白、常见标点与登记枚举别名。
 * 不做语义相似度推断，避免把不同作者设定误判为相同。
 */
export function normalizeConstitutionValue(value: string): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？；：、,.!?;:'"“”‘’（）()《》〈〉【】[\]{}—–\-_/\\]/g, '')
}

function sameSubject(left: TemporalFact, right: TemporalFact): boolean {
  if (left.characterId != null || right.characterId != null) {
    return left.characterId != null && left.characterId === right.characterId
  }
  if (left.subjectWorldGroupId !== undefined || right.subjectWorldGroupId !== undefined) {
    return (left.subjectWorldGroupId ?? null) === (right.subjectWorldGroupId ?? null)
  }
  return left.subjectName === right.subjectName
}

export function checkSettingAssertionClashes(
  candidate: TemporalFact,
  confirmedFacts: readonly TemporalFact[],
): SettingAssertionClash[] {
  if (!isConstitutionPredicate(candidate.predicate)) return []
  const normalized = normalizeConstitutionValue(candidate.value)
  if (!normalized) return []
  return confirmedFacts
    .filter(fact =>
      fact.id !== candidate.id
      && fact.status === 'confirmed'
      && fact.projectId === candidate.projectId
      && (fact.worldGroupId ?? null) === (candidate.worldGroupId ?? null)
      && fact.predicate === candidate.predicate
      && sameSubject(fact, candidate)
      && normalizeConstitutionValue(fact.value) !== normalized,
    )
    .map(confirmed => ({ candidate, confirmed }))
}

export function formatCanonAssertionsContext(facts: readonly TemporalFact[]): string {
  const rows = facts.filter(fact =>
    fact.status === 'confirmed'
    && isConstitutionPredicate(fact.predicate)
    && fact.sourceFingerprint != null,
  )
  if (!rows.length) return ''
  return [
    '【世界宪法（作者已确认，生成内容不得与之矛盾）】',
    ...rows.slice(0, 80).map(fact => {
      const spec = getFactPredicate(fact.predicate)
      return `- ${fact.subjectName}｜${spec?.label ?? fact.predicate}：${fact.value}`
    }),
  ].join('\n')
}

export async function readCanonAssertions(
  projectId: number,
  worldGroupId?: number | null,
): Promise<TemporalFact[]> {
  const rows = await readOwnedRows<TemporalFact>(
    await resolveReadScopeLike(projectId),
    'temporalFacts',
    { owner: 'work' },
  )
  return rows.filter(fact =>
    fact.status === 'confirmed'
    && isConstitutionPredicate(fact.predicate)
    && fact.sourceFingerprint != null
    && (fact.worldGroupId == null || fact.worldGroupId === (worldGroupId ?? null)),
  )
}

export async function listSettingAssertionSources(
  projectId: number,
  worldGroupId?: number | null,
): Promise<SettingAssertionSource[]> {
  const scope = await resolveReadScopeLike(projectId)
  const [worldviews, powerSystems, cultivationSystems, storyCores, characters] = await Promise.all([
    readOwnedRows<any>(scope, 'worldviews', { owner: 'world' }),
    readOwnedRows<any>(scope, 'powerSystems', { owner: 'world' }),
    readOwnedRows<any>(scope, 'cultivationSystems', { owner: 'world' }),
    readOwnedRows<any>(scope, 'storyCores', { owner: 'work' }),
    readOwnedRows<any>(scope, 'characters', { owner: 'world' }),
  ])
  const records: Record<CanonAssertionSourceTable, Array<Record<string, unknown>>> = {
    worldviews: worldviews as unknown as Array<Record<string, unknown>>,
    powerSystems: powerSystems as unknown as Array<Record<string, unknown>>,
    cultivationSystems: cultivationSystems as unknown as Array<Record<string, unknown>>,
    storyCores: storyCores as unknown as Array<Record<string, unknown>>,
    characters: characters as unknown as Array<Record<string, unknown>>,
  }
  const sources: SettingAssertionSource[] = []
  for (const tableSpec of CANON_ASSERTION_SOURCE_REGISTRY) {
    for (const record of records[tableSpec.table]) {
      const recordId = Number(record.id)
      if (!Number.isFinite(recordId)) continue
      const recordWorld = tableSpec.table === 'characters'
        ? (record.homeWorldGroupId as number | null | undefined)
        : (record.worldGroupId as number | null | undefined)
      if (tableSpec.table !== 'storyCores'
        && worldGroupId !== undefined
        && recordWorld != null
        && recordWorld !== (worldGroupId ?? null)) continue
      for (const fieldSpec of tableSpec.fields) {
        const text = stableText(record[fieldSpec.field])
        if (!text) continue
        sources.push({
          sourceKey: `${tableSpec.table}:${recordId}:${fieldSpec.field}`,
          table: tableSpec.table,
          recordId,
          field: fieldSpec.field,
          label: `${tableSpec.label} · ${fieldSpec.label}`,
          text,
          worldGroupId: recordWorld ?? worldGroupId ?? null,
          characterId: tableSpec.table === 'characters' ? recordId : null,
          characterName: tableSpec.table === 'characters' ? String(record.name ?? '') : undefined,
          fingerprint: fingerprintSettingSource(text),
        })
      }
    }
  }
  return sources
}

export function parseSettingAssertionCandidates(
  raw: string,
  sources: readonly SettingAssertionSource[],
  subjects: {
    worldGroups: readonly { id: number | null; name: string }[]
    characters: readonly { id: number; name: string; worldGroupId?: number | null }[]
  },
): ExtractedSettingAssertion[] {
  let parsed: unknown
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return []
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed as { assertions?: unknown })?.assertions
  if (!Array.isArray(rows)) return []
  const sourceByKey = new Map(sources.map(source => [source.sourceKey, source]))
  const result: ExtractedSettingAssertion[] = []
  for (const value of rows) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    const subjectType = row.subjectType === 'worldGroup' || row.subjectType === 'character'
      ? row.subjectType
      : null
    const source = sourceByKey.get(String(row.sourceKey ?? ''))
    const predicate = String(row.predicate ?? '').trim()
    const assertionValue = String(row.value ?? '').trim()
    const quote = String(row.quote ?? '').trim()
    const rawSubjectId = row.subjectId == null || row.subjectId === 'null'
      ? null
      : Number(row.subjectId)
    if (!subjectType || !source || !assertionValue || !quote || !source.text.includes(quote)) continue
    if (!isAllowedCanonAssertionSource(source.table, source.field, predicate)) continue
    const spec = getFactPredicate(predicate)
    if (!spec?.constitution || !spec.subjectTypes.includes(subjectType)) continue
    if (subjectType === 'character') {
      if (!Number.isFinite(rawSubjectId) || !subjects.characters.some(item => item.id === rawSubjectId)) continue
    } else if (!subjects.worldGroups.some(item => item.id === rawSubjectId)) {
      continue
    }
    result.push({
      subjectType,
      subjectId: rawSubjectId,
      predicate,
      value: assertionValue,
      sourceKey: source.sourceKey,
      quote,
    })
  }
  return result
}

export function buildSettingAssertionExtractPrompt(
  sources: readonly SettingAssertionSource[],
  subjects: {
    worldGroups: readonly { id: number | null; name: string }[]
    characters: readonly { id: number; name: string }[]
  },
): string {
  const predicateLines = CANON_ASSERTION_SOURCE_REGISTRY.flatMap(table =>
    table.fields.map(field => `${table.table}.${field.field} => ${field.predicates.join(', ')}`))
  return [
    '从以下封闭设定来源中抽取世界宪法候选。只输出 JSON：{"assertions":[...]}。',
    '每项字段：subjectType, subjectId, predicate, value, sourceKey, quote。',
    'predicate/sourceKey/subjectId 必须来自下方闭集；quote 必须是来源原文中的逐字连续引文。',
    '默认世界的 subjectId 必须输出 JSON null（不要输出字符串 "null"）；示例：{"subjectType":"worldGroup","subjectId":null,"predicate":"magicSource","value":"月亮潮汐","sourceKey":"worldviews:1:worldOrigin","quote":"魔法源于月亮潮汐"}。',
    '你只能提出候选，不能确认、覆盖或改写任何 Canon。无可靠断言时返回 {"assertions":[]}。',
    `主题闭集：\n${predicateLines.join('\n')}`,
    `世界主体：\n${subjects.worldGroups.map(item => `${item.id ?? 'null'} | ${item.name}`).join('\n')}`,
    `角色主体：\n${subjects.characters.map(item => `${item.id} | ${item.name}`).join('\n')}`,
    `来源闭集：\n${sources.map(item => `[${item.sourceKey}] ${item.label}\n${item.text}`).join('\n\n')}`,
  ].join('\n\n')
}

function sourcePatch(source: SettingAssertionSource): Partial<TemporalFact> {
  const patch: Partial<TemporalFact> = {
    sourceRecordTable: source.table,
    sourceRecordId: source.recordId,
    sourceField: source.field,
    sourceFingerprint: source.fingerprint,
  }
  if (source.table === 'worldviews') patch.sourceWorldviewId = source.recordId
  if (source.table === 'powerSystems') patch.sourcePowerSystemId = source.recordId
  if (source.table === 'cultivationSystems') patch.sourceCultivationSystemId = source.recordId
  if (source.table === 'storyCores') patch.sourceStoryCoreId = source.recordId
  if (source.table === 'characters') patch.sourceCharacterId = source.recordId
  return patch
}

function typedSourceRecordId(fact: TemporalFact): number | null {
  if (fact.sourceRecordTable === 'worldviews') return fact.sourceWorldviewId ?? null
  if (fact.sourceRecordTable === 'powerSystems') return fact.sourcePowerSystemId ?? null
  if (fact.sourceRecordTable === 'cultivationSystems') return fact.sourceCultivationSystemId ?? null
  if (fact.sourceRecordTable === 'storyCores') return fact.sourceStoryCoreId ?? null
  if (fact.sourceRecordTable === 'characters') return fact.sourceCharacterId ?? null
  return null
}

export async function validateSettingAssertionSource(
  fact: TemporalFact,
  suppliedScope?: WorkspaceScope,
): Promise<'current' | 'stale' | 'source-missing'> {
  const table = fact.sourceRecordTable as CanonAssertionSourceTable | undefined
  const recordId = typedSourceRecordId(fact)
  const field = fact.sourceField
  if (!table || recordId == null || !field || !fact.sourceFingerprint) return 'source-missing'
  const registered = getCanonAssertionSourceField(table, field)
  if (!registered || !isAllowedCanonAssertionSource(table, field, fact.predicate)) return 'source-missing'
  const record = await db.table(table).get(recordId) as Record<string, unknown> | undefined
  if (!record || Number(record.projectId) !== fact.projectId) return 'source-missing'
  const scope = suppliedScope ?? await resolveReadScopeLike(fact.projectId)
  const owner = table === 'storyCores' ? 'work' : 'world'
  if (!await assertRecordInScope(scope, table, record, { owner })) return 'source-missing'
  return fingerprintSettingSource(record[field]) === fact.sourceFingerprint ? 'current' : 'stale'
}

export async function adoptSettingAssertionCandidates(args: {
  projectId: number
  worldGroupId?: number | null
  candidates: readonly ExtractedSettingAssertion[]
  sources: readonly SettingAssertionSource[]
  subjects: {
    worldGroups: readonly { id: number | null; name: string }[]
    characters: readonly { id: number; name: string; worldGroupId?: number | null }[]
  }
}): Promise<{ written: number; skipped: number }> {
  const scope = await resolveScopeLike(args.projectId)
  const requestedSourceKeys = new Set(args.sources.map(source => source.sourceKey))
  const currentSources = await listSettingAssertionSources(args.projectId, args.worldGroupId)
  const sourceByKey = new Map(currentSources
    .filter(source => requestedSourceKeys.has(source.sourceKey))
    .map(source => [source.sourceKey, source]))
  const existing = await readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' })
  let written = 0
  let skipped = 0
  for (const candidate of args.candidates) {
    const source = sourceByKey.get(candidate.sourceKey)
    const spec = getFactPredicate(candidate.predicate)
    const character = candidate.subjectType === 'character'
      ? args.subjects.characters.find(item => item.id === candidate.subjectId)
      : null
    const world = candidate.subjectType === 'worldGroup'
      ? args.subjects.worldGroups.find(item => item.id === candidate.subjectId)
      : null
    if (!source || !spec?.constitution
      || !isAllowedCanonAssertionSource(source.table, source.field, candidate.predicate)
      || (candidate.subjectType === 'character' && !character)
      || (candidate.subjectType === 'worldGroup' && !world)) {
      skipped++
      continue
    }
    const subjectName = character?.name ?? world?.name ?? '默认世界'
    const sameCandidateSubject = (fact: TemporalFact) => candidate.subjectType === 'character'
      ? fact.characterId === character?.id
      : (fact.subjectWorldGroupId ?? null) === (candidate.subjectId ?? null)
    const duplicate = existing.some(fact =>
      fact.status !== 'rejected'
      && fact.predicate === candidate.predicate
      && sameCandidateSubject(fact)
      && normalizeConstitutionValue(fact.value) === normalizeConstitutionValue(candidate.value)
      && fact.sourceQuote === candidate.quote,
    )
    if (duplicate) {
      skipped++
      continue
    }
    const timestamp = Date.now()
    const fact = stampNewRecord(scope, 'temporalFacts', {
      projectId: args.projectId,
      worldGroupId: character?.worldGroupId ?? source.worldGroupId ?? args.worldGroupId ?? null,
      characterId: character?.id ?? null,
      subjectWorldGroupId: candidate.subjectType === 'worldGroup' ? candidate.subjectId : null,
      subjectName,
      predicate: candidate.predicate,
      factKind: spec.factKind,
      value: candidate.value,
      sourceType: 'setting',
      sourceQuote: candidate.quote,
      ...sourcePatch(source),
      validFromChapterId: null,
      validToChapterId: null,
      status: 'candidate',
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }, { owner: 'work' }) as TemporalFact
    await db.temporalFacts.add(fact)
    existing.push(fact)
    written++
  }
  return { written, skipped }
}

export async function refreshSettingAssertionSourceStatus(args: {
  projectId: number
  table: CanonAssertionSourceTable
  recordId: number
  changedFields?: readonly string[]
}): Promise<{ touched: number }> {
  const fieldFilter = args.changedFields ? new Set(args.changedFields) : null
  const sourceSpec = CANON_ASSERTION_SOURCE_REGISTRY.find(item => item.table === args.table)
  if (!sourceSpec) return { touched: 0 }
  const record = await db.table(args.table).get(args.recordId) as Record<string, unknown> | undefined
  const facts = await db.temporalFacts.where('projectId').equals(args.projectId).toArray()
  const workIds = record && args.table !== 'storyCores' && typeof record.worldId === 'number'
    ? new Set((await db.works.where('worldId').equals(record.worldId).toArray()).map(work => work.id))
    : null
  let touched = 0
  for (const fact of facts) {
    if (fact.id == null || fact.sourceRecordTable !== args.table || typedSourceRecordId(fact) !== args.recordId) continue
    if (record) {
      if (args.table === 'storyCores' && fact.workId !== record.workId) continue
      if (workIds && !workIds.has(fact.workId ?? undefined)) continue
    }
    if (!fact.sourceField || (fieldFilter && !fieldFilter.has(fact.sourceField))) continue
    const registered = getCanonAssertionSourceField(args.table, fact.sourceField)
    const current = record && registered ? fingerprintSettingSource(record[fact.sourceField]) : null
    if (current === fact.sourceFingerprint) continue
    if (fact.status !== 'rejected' && fact.status !== 'superseded') {
      await db.temporalFacts.update(fact.id, {
        status: record && registered ? 'stale' : 'source-missing',
        updatedAt: Date.now(),
      })
      touched++
    }
  }
  return { touched }
}
