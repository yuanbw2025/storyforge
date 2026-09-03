/**
 * adopt() 统一写回入口(Phase 1.2a)。
 *
 * 本文件是纯新增写回层;现有调用方在 1.2b 再逐步迁移。
 */
import Dexie from 'dexie'
import { db } from '../db/schema'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from '../workspace/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import { hashChapterText, sha256Text, CHAPTER_TEXT_NORMALIZATION_VERSION } from '../ai/chapter-memory/text-normalization'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import { FIELD_BY_TARGET } from './field-registry'
import { ADOPTION_BY_TARGET } from './adoption-schema'
import type { AdoptInput, AdoptResult, CollectionAdoptionSpec, FieldSpec, TableSpec } from './types'
import { normalizeCharacterAxes } from '../character/character-axes'
import {
  refreshSettingAssertionSourceStatus,
} from '../fact-ledger/setting-assertions'
import type { CanonAssertionSourceTable } from './canon-assertion-source-registry'

const CANON_SOURCE_TABLES = new Set<CanonAssertionSourceTable>([
  'worldviews',
  'powerSystems',
  'cultivationSystems',
  'storyCores',
  'characters',
])

/** Content adoption invalidates every narrative summary that depended on the
 * changed chapter. Keep this lifecycle rule at the single write boundary so
 * durable AI adoption cannot leave a fresh-looking summary cache behind. */
async function markChapterNarrativeSummariesStale(
  scope: WorkspaceScope,
  chapterId: number,
): Promise<void> {
  const rows = await readOwnedRows<Record<string, unknown>>(scope, 'narrativeSummaryNodes', { owner: 'work' })
  const now = Date.now()
  for (const row of rows) {
    if (typeof row.id !== 'number') continue
    if (row.level === 'book' || row.level === 'volume' || row.sourceChapterId === chapterId) {
      await db.narrativeSummaryNodes.update(row.id, { status: 'stale', updatedAt: now })
    }
  }
}

async function refreshCanonSourceAfterWrite(
  target: string,
  projectId: number,
  recordId: number,
  fields: readonly string[],
): Promise<void> {
  if (!CANON_SOURCE_TABLES.has(target as CanonAssertionSourceTable)) return
  await refreshSettingAssertionSourceStatus({
    projectId,
    table: target as CanonAssertionSourceTable,
    recordId,
    changedFields: fields,
  })
}

export async function adopt(input: AdoptInput): Promise<AdoptResult> {
  const result = emptyResult()
  const fieldSpecs = FIELD_BY_TARGET.get(input.target) ?? []
  if (!fieldSpecs.length) {
    result.skipped.push({ reason: `target ${input.target} 未在 FIELD_REGISTRY 登记`, data: input.data })
    return result
  }

  const tableSpec = REGISTRY_BY_NAME.get(input.target)
  if (!tableSpec) throw new Error(`[adopt] target ${input.target} 不在 PROJECT_TABLES`)

  const payloads = Array.isArray(input.data) ? input.data : [input.data]
  if (payloads.some(payload => payload && (Object.prototype.hasOwnProperty.call(payload, 'worldId')
    || Object.prototype.hasOwnProperty.call(payload, 'workId')))) {
    result.skipped.push({ reason: 'AI/结构化输入不得携带 World/Work owner ID；owner 由 WorkspaceScope 派生', data: input.data })
    return result
  }

  const scope = await resolveScope(input)
  const scopedInput: AdoptInput = { ...input, projectId: scope.projectId, scope }

  if (scopedInput.recordId != null) {
    return adoptCollectionRecord(scopedInput, fieldSpecs, tableSpec, result)
  }

  const isCollection = scopedInput.mode === 'add' || scopedInput.mode === 'add-many' || scopedInput.mode === 'merge-diffs'
  if (isCollection) return adoptCollection(scopedInput, fieldSpecs, tableSpec, result)
  return adoptSingleton(scopedInput, fieldSpecs, tableSpec, result)
}

/**
 * 按 ADOPTION_SCHEMA.replaceScope 清理既有集合。
 * 用于“整批结果替换”场景，避免 AI pipeline 在 adopt() 之外裸删旧结果。
 */
export async function clearAdoptedCollection(input: {
  projectId: number
  workspaceScope?: WorkspaceScope
  target: string
  scope: Record<string, unknown>
}): Promise<number> {
  const workspaceScope = await resolveScope({ projectId: input.projectId, scope: input.workspaceScope })
  const adoption = ADOPTION_BY_TARGET.get(input.target)
  const tableSpec = REGISTRY_BY_NAME.get(input.target)
  const fields = FIELD_BY_TARGET.get(input.target) ?? []
  if (!adoption || !tableSpec || !adoption.replaceScope?.length) {
    throw new Error(`[adopt] target ${input.target} 未登记 replaceScope`)
  }

  const result = emptyResult()
  const normalized = normalizeAndValidate(input.scope, fields, result)
  if (!normalized || result.unknown.length || result.typeErrors.length) {
    throw new Error(`[adopt] ${input.target} replaceScope 非法`)
  }
  for (const field of adoption.replaceScope) {
    if (normalized[field] == null) throw new Error(`[adopt] ${input.target} replaceScope 缺少 ${field}`)
  }
  if (!await applyFkChecks(normalized, input.scope, adoption, result, workspaceScope)) {
    throw new Error(`[adopt] ${input.target} replaceScope FK 不属于当前项目`)
  }

  const rows = await readOwnedRows<Record<string, unknown>>(workspaceScope, input.target, { owner: adoption.ownerFrom })
  const ids = rows
    .filter(row => adoption.replaceScope!.every(field => (row[field] ?? null) === (normalized[field] ?? null)))
    .map(row => row.id)
    .filter((id): id is number => typeof id === 'number')
  if (ids.length) await tableSpec.table.bulkDelete(ids)
  return ids.length
}

/**
 * 在同一 IndexedDB 事务中完成“按登记范围清理旧结果 → 写入整批新结果”。
 * 任一条未能写入都会抛错并回滚，避免提取结果解析/FK 异常时先删掉作者已有数据。
 */
export async function replaceAdoptedCollection(input: {
  projectId: number
  workspaceScope?: WorkspaceScope
  target: string
  scope: Record<string, unknown>
  data: Record<string, unknown>[]
}): Promise<AdoptResult> {
  const adoption = ADOPTION_BY_TARGET.get(input.target)
  const tableSpec = REGISTRY_BY_NAME.get(input.target)
  if (!adoption || !tableSpec || !adoption.replaceScope?.length) {
    throw new Error(`[adopt] target ${input.target} 未登记 replaceScope`)
  }
  const relatedTables = (adoption.fkChecks ?? [])
    .map(check => REGISTRY_BY_NAME.get(check.target)?.table)
    .filter((table): table is NonNullable<typeof table> => table != null)
  const workspaceScope = await resolveScope({
    projectId: input.projectId,
    scope: input.workspaceScope,
  })
  const tables = scopeTransactionTables(tableSpec.table, ...relatedTables)
  return db.transaction('rw', tables, async () => {
    await clearAdoptedCollection({
      projectId: input.projectId,
      workspaceScope,
      target: input.target,
      scope: input.scope,
    })
    const result = await adopt({
      projectId: input.projectId,
      scope: workspaceScope,
      target: input.target,
      mode: 'add-many',
      data: input.data,
    })
    if (result.written.length !== input.data.length) {
      throw new Error(
        `[adopt] ${input.target} 整批替换未完整写入（${result.written.length}/${input.data.length}），已回滚。`,
      )
    }
    return result
  })
}

function emptyResult(): AdoptResult {
  return { written: [], aliasMapped: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
}

async function adoptCollectionRecord(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  if (!ADOPTION_BY_TARGET.has(input.target)) {
    result.skipped.push({ reason: `target ${input.target} 不是已登记的集合写回目标`, data: input.data })
    return result
  }
  if (Array.isArray(input.data)) {
    result.skipped.push({ reason: 'recordId 定点更新只接受单条 data', data: input.data })
    return result
  }
  if (input.compareAndSet) {
    if (input.compareAndSet.kind === 'record-field-value-hash') {
      return adoptRegisteredRecordFieldWithCas(input, fieldSpecs, tableSpec, result)
    }
    if (input.compareAndSet.kind === 'record-fields-value-hash') {
      return adoptRegisteredRecordFieldsWithCas(input, fieldSpecs, tableSpec, result)
    }
    return adoptChapterMemoryRecordWithCas(input, fieldSpecs, tableSpec, result)
  }
  const target = await tableSpec.table.get(input.recordId!)
  if (!target || !await assertRecordInScope(input.scope!, input.target, target, {
    owner: ADOPTION_BY_TARGET.get(input.target)?.ownerFrom,
  })) {
    result.skipped.push({
      reason: `record ${input.recordId} 不存在、不属于当前项目或不属于当前 scope`,
      data: input.data,
    })
    return result
  }
  let patch = normalizeAndValidate(input.data, fieldSpecs, result)
  if (!patch || Object.keys(patch).length === 0) return result
  if (input.target === 'characters') patch = normalizeCharacterAxes(patch, target)

  if (input.mode === 'append') {
    for (const [field, val] of Object.entries(patch)) {
      const spec = fieldSpecs.find(f => f.field === field)
      if (spec?.type === 'longtext') {
        const existing = target[field]
        patch[field] = existing ? `${String(existing)}\n\n${String(val)}` : val
      }
    }
  }

  patch.updatedAt = Date.now()
  await tableSpec.table.update(input.recordId!, patch as any)
  if (input.target === 'chapters' && Object.prototype.hasOwnProperty.call(patch, 'content')) {
    await markChapterNarrativeSummariesStale(input.scope!, input.recordId!)
  }
  await refreshCanonSourceAfterWrite(input.target, input.projectId, input.recordId!, Object.keys(patch))
  result.written.push({ id: input.recordId!, fields: Object.keys(patch) })
  return result
}

/** Stable hash shared by durable candidates and the atomic writer. */
export async function hashAdoptFieldValueV1(value: unknown): Promise<string> {
  return sha256Text(JSON.stringify({
    present: value !== undefined,
    value: value === undefined ? null : value,
  }))
}

/**
 * Stable, order-independent snapshot hash for a closed set of registered fields.
 * Missing and explicit null remain distinct so a stale author candidate cannot
 * silently overwrite a field that was added after the self-check.
 */
export async function hashAdoptRecordFieldsV1(
  record: Record<string, unknown>,
  fields: readonly string[],
): Promise<string> {
  const canonicalFields = [...new Set(fields)].sort()
  return sha256Text(JSON.stringify(canonicalFields.map(field => ({
    field,
    present: record[field] !== undefined,
    value: record[field] === undefined ? null : record[field],
  }))))
}

async function adoptRegisteredRecordFieldsWithCas(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  const cas = input.compareAndSet!
  const adoption = ADOPTION_BY_TARGET.get(input.target)
  if (
    cas.kind !== 'record-fields-value-hash'
    || input.mode !== 'replace'
    || Array.isArray(input.data)
    || !/^[a-f0-9]{64}$/.test(cas.expectedHash)
    || cas.fields.length === 0
    || new Set(cas.fields).size !== cas.fields.length
    || !adoption
  ) {
    result.skipped.push({ reason: '字段集合 compareAndSet 仅支持已登记集合目标的定点 replace', data: input.data })
    return result
  }
  const registered = new Set(fieldSpecs.map(spec => spec.field))
  const unknownCasField = cas.fields.find(field => !registered.has(field))
  if (unknownCasField) {
    result.skipped.push({ reason: `CAS 字段 ${input.target}.${unknownCasField} 未在 FIELD_REGISTRY 登记`, data: input.data })
    return result
  }
  const patch = normalizeAndValidate(input.data, fieldSpecs, result, { preserveEmptyStrings: true })
  const patchKeys = Object.keys(patch ?? {})
  if (
    !patch
    || patchKeys.length === 0
    || result.unknown.length > 0
    || result.typeErrors.length > 0
    || patchKeys.some(field => !cas.fields.includes(field))
  ) {
    result.skipped.push({ reason: '字段集合 compareAndSet 只能写入其声明的已登记字段', data: input.data })
    return result
  }

  const transactionTables = input.target === 'chapters'
    ? scopeTransactionTables(tableSpec.table, db.narrativeSummaryNodes)
    : scopeTransactionTables(tableSpec.table)
  await db.transaction('rw', transactionTables, async () => {
    const target = await tableSpec.table.get(input.recordId!)
    if (!target || !await assertRecordInScope(input.scope!, input.target, target, { owner: adoption.ownerFrom })) {
      result.skipped.push({ reason: `record ${input.recordId} 不存在或不属于当前 scope`, data: input.data })
      return
    }
    const currentHash = await Dexie.waitFor(hashAdoptRecordFieldsV1(target, cas.fields))
    if (currentHash !== cas.expectedHash) {
      result.skipped.push({ reason: `CAS 失败：${input.target} 的工作区字段已变化`, data: input.data })
      return
    }
    const changedFields = Object.keys(patch)
    patch.updatedAt = Date.now()
    await tableSpec.table.update(input.recordId!, patch as any)
    if (input.target === 'chapters' && Object.prototype.hasOwnProperty.call(patch, 'content')) {
      await markChapterNarrativeSummariesStale(input.scope!, input.recordId!)
    }
    result.written.push({ id: input.recordId!, fields: changedFields })
  })
  if (result.written.length) {
    await refreshCanonSourceAfterWrite(input.target, input.projectId, input.recordId!, result.written[0].fields)
  }
  return result
}

async function adoptRegisteredRecordFieldWithCas(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  const cas = input.compareAndSet!
  const adoption = ADOPTION_BY_TARGET.get(input.target)
  if (
    cas.kind !== 'record-field-value-hash'
    || input.mode !== 'replace'
    || !adoption?.recordOnly
    || Array.isArray(input.data)
    || !/^[a-f0-9]{64}$/.test(cas.expectedHash)
  ) {
    result.skipped.push({ reason: '通用 compareAndSet 仅支持已登记 record-only 目标的定点 replace', data: input.data })
    return result
  }
  const registered = fieldSpecs.find(spec => spec.field === cas.field)
  if (!registered) {
    result.skipped.push({ reason: `CAS 字段 ${input.target}.${cas.field} 未在 FIELD_REGISTRY 登记`, data: input.data })
    return result
  }
  const patch = normalizeAndValidate(input.data, fieldSpecs, result)
  if (
    !patch
    || result.unknown.length > 0
    || result.typeErrors.length > 0
    || Object.keys(patch).length !== 1
    || !Object.prototype.hasOwnProperty.call(patch, cas.field)
  ) {
    result.skipped.push({ reason: '通用 compareAndSet 每次只允许替换其声明的单一字段', data: input.data })
    return result
  }
  await db.transaction('rw', scopeTransactionTables(tableSpec.table), async () => {
    const target = await tableSpec.table.get(input.recordId!)
    if (!target || !await assertRecordInScope(input.scope!, input.target, target, { owner: adoption.ownerFrom })) {
      result.skipped.push({ reason: `record ${input.recordId} 不存在或不属于当前 scope`, data: input.data })
      return
    }
    if (await Dexie.waitFor(hashAdoptFieldValueV1(target[cas.field])) !== cas.expectedHash) {
      result.skipped.push({ reason: `CAS 失败：${input.target}.${cas.field} 已变化`, data: input.data })
      return
    }
    patch.updatedAt = Date.now()
    await tableSpec.table.update(input.recordId!, patch as any)
    result.written.push({ id: input.recordId!, fields: [cas.field] })
  })
  return result
}

async function adoptChapterMemoryRecordWithCas(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  const cas = input.compareAndSet!
  if (
    input.target !== 'chapters'
    || cas.kind !== 'chapter-source-text-hash'
    || input.mode !== 'replace'
  ) {
    result.skipped.push({ reason: 'compareAndSet 仅支持 chapters recordId replace', data: input.data })
    return result
  }
  if (cas.textNormalizationVersion !== CHAPTER_TEXT_NORMALIZATION_VERSION) {
    result.skipped.push({ reason: `不支持的正文标准化版本 ${cas.textNormalizationVersion}`, data: input.data })
    return result
  }

  const patch = normalizeAndValidate(input.data as Record<string, unknown>, fieldSpecs, result)
  if (!patch || Object.keys(patch).length === 0) return result
  if (!validateChapterMemoryProvenance(input.recordId!, patch, cas.expectedHash, cas.textNormalizationVersion, result, input.data)) {
    return result
  }

  await db.transaction('rw', tableSpec.table, db.narrativeSummaryNodes, async () => {
    const target = await tableSpec.table.get(input.recordId!)
    if (!target || !await assertRecordInScope(input.scope!, input.target, target, {
      owner: ADOPTION_BY_TARGET.get(input.target)?.ownerFrom,
    })) {
      result.skipped.push({ reason: `record ${input.recordId} 不存在或不属于当前 scope`, data: input.data })
      return
    }
    const currentHash = await Dexie.waitFor(hashChapterText(String(target.content ?? '')))
    if (currentHash !== cas.expectedHash) {
      result.skipped.push({ reason: 'CAS 失败：章节正文已变化，丢弃旧派生记忆', data: input.data })
      return
    }
    if (
      cas.expectedContentHash
      && await Dexie.waitFor(sha256Text(String(target.content ?? ''))) !== cas.expectedContentHash
    ) {
      result.skipped.push({ reason: 'CAS 失败：章节正文 HTML 或格式已变化，丢弃旧局部编辑候选', data: input.data })
      return
    }

    patch.updatedAt = Date.now()
    await tableSpec.table.update(input.recordId!, patch as any)
    if (Object.prototype.hasOwnProperty.call(patch, 'content')) {
      await markChapterNarrativeSummariesStale(input.scope!, input.recordId!)
    }
    result.written.push({ id: input.recordId!, fields: Object.keys(patch) })
  })
  return result
}

function validateChapterMemoryProvenance(
  chapterId: number,
  patch: Record<string, unknown>,
  expectedHash: string,
  normalizationVersion: string,
  result: AdoptResult,
  raw: unknown,
): boolean {
  if (patch.summary != null) {
    if (
      patch.summarySourceTextHash !== expectedHash
      || patch.summaryTextNormalizationVersion !== normalizationVersion
    ) {
      result.skipped.push({ reason: 'summary 来源 hash/version 与 CAS 条件不一致', data: raw })
      return false
    }
  }
  if (patch.continuityHandoff != null) {
    const handoff = patch.continuityHandoff as Record<string, unknown>
    if (
      handoff.chapterId !== chapterId
      || handoff.sourceTextHash !== expectedHash
      || handoff.textNormalizationVersion !== normalizationVersion
    ) {
      result.skipped.push({ reason: 'handoff 来源 chapter/hash/version 与 CAS 条件不一致', data: raw })
      return false
    }
  }
  if (patch.planReconciliation != null) {
    const reconciliation = patch.planReconciliation as Record<string, unknown>
    if (
      reconciliation.chapterId !== chapterId
      || reconciliation.sourceTextHash !== expectedHash
      || reconciliation.textNormalizationVersion !== normalizationVersion
    ) {
      result.skipped.push({ reason: 'plan reconciliation 来源 chapter/hash/version 与 CAS 条件不一致', data: raw })
      return false
    }
  }
  return true
}

async function adoptSingleton(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  const data = input.data as Record<string, unknown>
  const patch = normalizeAndValidate(data, fieldSpecs, result)
  if (!patch || Object.keys(patch).length === 0) return result

  const target = await findSingleton(input, tableSpec)
  if (input.mode === 'append') {
    for (const [field, val] of Object.entries(patch)) {
      const spec = fieldSpecs.find(f => f.field === field)
      if (spec?.type === 'longtext') {
        const existing = target?.[field]
        patch[field] = existing ? `${String(existing)}\n\n${String(val)}` : val
      }
    }
  }

  const now = Date.now()
  if (target?.id != null) {
    await tableSpec.table.update(target.id, { ...patch, updatedAt: now } as any)
    await refreshCanonSourceAfterWrite(input.target, input.projectId, target.id, Object.keys(patch))
    result.written.push({ id: target.id, fields: Object.keys(patch) })
  } else {
    const row = stampNewRecord(input.scope!, input.target, {
      ...defaultSingletonRow(input.target),
      projectId: input.projectId,
      ...(tableSpec.worldScoped ? { [tableSpec.worldGroupField ?? 'worldGroupId']: input.worldGroupId ?? null } : {}),
      ...patch,
      createdAt: now,
      updatedAt: now,
    }, { owner: tableSpec.domainOwner?.defaultOwner === 'world' ? 'world' : 'work' })
    const id = await tableSpec.table.add(row as any) as number
    result.written.push({ id, fields: Object.keys(patch) })
  }
  return result
}

async function adoptCollection(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  const adoption = ADOPTION_BY_TARGET.get(input.target)
  if (!adoption) throw new Error(`[adopt] target ${input.target} 是集合写回但未在 ADOPTION_SCHEMAS 登记`)
  if (adoption.recordOnly) {
    result.skipped.push({ reason: `target ${input.target} 仅允许 recordId 定点更新`, data: input.data })
    return result
  }

  const items = Array.isArray(input.data) ? input.data : [input.data as Record<string, unknown>]
  for (const raw of items) {
    let item = normalizeAndValidate(raw, fieldSpecs, result)
    if (!item) continue
    item = applyTableDefaults(item, tableSpec)
    if (input.target === 'characters') item = normalizeCharacterAxes(item)
    if (input.target === 'itemLedger') {
      item = await resolveItemLedgerOwner(input.scope!, item)
    }
    // AI/结构化采纳只能生成待确认候选，不能借输入字段绕过人工确认。
    if (input.target === 'knowledgeLedger') item = { ...item, status: 'candidate' }
    if (!applyRequired(item, raw, adoption, result)) continue
    if (!await applyFkChecks(item, raw, adoption, result, input.scope!)) continue
    await applyArrayMemberChecks(item, adoption, result, input.scope!)
    applyAutoStamps(item, input, tableSpec, adoption)
    item = stampNewRecord(input.scope!, input.target, item, { owner: adoption.ownerFrom })

    const existing = await findExisting(input.scope!, tableSpec, item, adoption)
    if (existing?.id != null) {
      if (adoption.duplicatePolicy === 'skip') {
        result.skipped.push({ reason: '重复(skip)', data: raw })
      } else if (adoption.duplicatePolicy === 'update') {
        // 防误清空:更新既有记录时,不让 null 覆盖既有字段值(保持旧行为——null 视为"不提供")。
        // 新增记录(else 分支)仍保留 null(顶层卷 parentId 等需要)。
        const patch: Record<string, unknown> = { updatedAt: Date.now() }
        for (const [k, v] of Object.entries(item)) if (v !== null) patch[k] = v
        await tableSpec.table.update(existing.id, patch as any)
        await refreshCanonSourceAfterWrite(input.target, input.projectId, existing.id, Object.keys(patch))
        result.written.push({ id: existing.id, fields: Object.keys(patch) })
      } else if (adoption.duplicatePolicy === 'merge') {
        const patch = mergeByStrategy(existing, item, adoption.mergeStrategy ?? 'overwrite-non-empty')
        patch.updatedAt = Date.now()
        await tableSpec.table.update(existing.id, patch as any)
        await refreshCanonSourceAfterWrite(input.target, input.projectId, existing.id, Object.keys(patch))
        result.written.push({ id: existing.id, fields: Object.keys(patch) })
      } else {
        throw new Error(`[adopt] 重复记录 ${input.target}.${JSON.stringify(identityValue(item, adoption))}`)
      }
    } else {
      const id = await tableSpec.table.add(item as any) as number
      result.written.push({ id, fields: Object.keys(item) })
    }
  }
  return result
}

async function resolveItemLedgerOwner(
  scope: WorkspaceScope,
  item: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (item.characterId != null || typeof item.heldByName !== 'string') return item
  const heldByName = item.heldByName.trim()
  if (!heldByName) return item
  const matches = (await readOwnedRows<any>(scope, 'characters', { owner: 'world' }))
    .filter(character => character.name.trim() === heldByName)
  return {
    ...item,
    characterId: matches.length === 1 ? matches[0].id ?? null : null,
  }
}

function applyTableDefaults(item: Record<string, unknown>, tableSpec: TableSpec): Record<string, unknown> {
  return tableSpec.defaults ? { ...tableSpec.defaults, ...item } : item
}

function normalizeAndValidate(
  raw: Record<string, unknown>,
  fieldSpecs: FieldSpec[],
  result: AdoptResult,
  options: { preserveEmptyStrings?: boolean } = {},
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  const byName = new Map(fieldSpecs.map(f => [f.field, f] as const))
  const byAlias = new Map<string, FieldSpec>()
  for (const f of fieldSpecs) for (const a of f.aliases ?? []) byAlias.set(a, f)

  for (const [key, val] of Object.entries(raw)) {
    // 空字符串跳过;但 null 必须保留——如 outlineNodes 顶层卷的 parentId:null。
    // 旧实现 `val == null` 一并跳过,导致顶层卷写库时丢了 parentId(存成 undefined),
    // 而大纲面板用 `parentId === null` 严格过滤顶层卷 → 卷被藏起,表现为"采纳没反应"(FB-10b)。
    if (val === '' && !options.preserveEmptyStrings) continue
    let spec = byName.get(key)
    let canonical = key
    if (!spec) {
      const aliasHit = byAlias.get(key)
      if (!aliasHit) {
        result.unknown.push(key)
        continue
      }
      spec = aliasHit
      canonical = aliasHit.field
      result.aliasMapped.push({ from: key, to: canonical })
    }

    // null 直接保留(不走类型转换,避免 String(null)→'null');是字段的合法显式值
    if (val == null) {
      out[canonical] = null
      continue
    }
    const cleaned = validateAndCoerce(spec, val, result)
    if (cleaned !== undefined) out[canonical] = cleaned
  }

  return out
}

function validateAndCoerce(spec: FieldSpec, value: unknown, result: AdoptResult): unknown {
  const raw = spec.sanitize ? spec.sanitize(value) : value
  if (spec.type === 'string' || spec.type === 'longtext') return String(raw)
  if (spec.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n)) return n
    result.typeErrors.push({ field: spec.field, expected: 'number', got: typeof value })
    return undefined
  }
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === '是' || raw === 'yes' || raw === 1) return true
    if (raw === 'false' || raw === '否' || raw === 'no' || raw === 0) return false
    result.typeErrors.push({ field: spec.field, expected: 'boolean', got: typeof value })
    return undefined
  }
  if (spec.type === 'enum') {
    const normalized = spec.enumAliasMap?.[String(raw)] ?? String(raw)
    if (!spec.enums || spec.enums.includes(normalized)) return normalized
    result.typeErrors.push({ field: spec.field, expected: `enum:${spec.enums.join('|')}`, got: String(value) })
    return undefined
  }
  if (spec.type === 'array') {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed
      } catch {
        // fall through
      }
    }
    result.typeErrors.push({ field: spec.field, expected: 'array', got: typeof value })
    return undefined
  }
  if (spec.type === 'json') {
    if (typeof raw === 'string') {
      try {
        JSON.parse(raw)
        return raw
      } catch {
        result.typeErrors.push({ field: spec.field, expected: 'json', got: 'string' })
        return undefined
      }
    }
    return JSON.stringify(raw)
  }
  if (spec.type === 'object') {
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      } catch {
        // fall through
      }
      result.typeErrors.push({ field: spec.field, expected: 'object', got: 'string' })
      return undefined
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
    result.typeErrors.push({ field: spec.field, expected: 'object', got: typeof value })
    return undefined
  }
  return undefined
}

async function findSingleton(input: AdoptInput, tableSpec: TableSpec): Promise<any | null> {
  const owner = tableSpec.domainOwner?.defaultOwner === 'world' ? 'world' : 'work'
  const rows = await readOwnedRows<any>(input.scope!, input.target, { owner })
  if (tableSpec.worldScoped) {
    const wgField = tableSpec.worldGroupField ?? 'worldGroupId'
    return (rows as any[]).find(r => (r[wgField] ?? null) === (input.worldGroupId ?? null)) ?? null
  }
  return (rows as any[])[0] ?? null
}

function defaultSingletonRow(target: string): Record<string, unknown> {
  if (target === 'worldviews') {
    return { summary: '' }
  }
  if (target === 'storyCores') {
    return { theme: '', centralConflict: '', plotPattern: '', mainPlot: '' }
  }
  if (target === 'creativeRules') {
    return {
      writingStyle: '',
      narrativePOV: 'third-limited',
      toneAndMood: '',
      prohibitions: '[]',
      consistencyRules: '[]',
      specialRequirements: '',
      referenceWorks: '[]',
    }
  }
  return {}
}

function applyRequired(
  item: Record<string, unknown>,
  raw: unknown,
  adoption: CollectionAdoptionSpec,
  result: AdoptResult,
): boolean {
  for (const req of adoption.required) {
    if (item[req] == null || item[req] === '') {
      result.skipped.push({ reason: `必填字段 ${req} 缺失`, data: raw })
      return false
    }
  }
  return true
}

async function applyFkChecks(
  item: Record<string, unknown>,
  raw: unknown,
  adoption: CollectionAdoptionSpec,
  result: AdoptResult,
  scope: WorkspaceScope,
): Promise<boolean> {
  for (const fk of adoption.fkChecks ?? []) {
    const refValue = item[fk.field]
    if (refValue == null) continue
    const targetSpec = PROJECT_TABLES.find(s => s.name === fk.target)
    if (!targetSpec) continue
    const exists = await targetSpec.table.get(refValue as number)
    if (!exists || !await assertRecordInScope(scope, fk.target, exists, { owner: adoption.ownerFrom })) {
      result.fkErrors.push({ field: fk.field, refValue })
      result.skipped.push({ reason: `FK 校验失败：${fk.field} -> ${fk.target}`, data: raw })
      return false
    }
  }
  return true
}

async function applyArrayMemberChecks(
  item: Record<string, unknown>,
  adoption: CollectionAdoptionSpec,
  result: AdoptResult,
  scope: WorkspaceScope,
): Promise<void> {
  for (const arr of adoption.arrayMemberChecks ?? []) {
    const value = item[arr.field]
    if (!Array.isArray(value)) continue
    const targetSpec = PROJECT_TABLES.find(s => s.name === arr.itemTarget)
    if (!targetSpec) continue
    const filtered: unknown[] = []
    for (const v of value) {
      const target = await targetSpec.table.get(v as number)
      if (target && await assertRecordInScope(scope, arr.itemTarget, target, { owner: adoption.ownerFrom })) filtered.push(v)
      else result.fkErrors.push({ field: `${arr.field}[]`, refValue: v })
    }
    item[arr.field] = filtered
  }
}

function applyAutoStamps(
  item: Record<string, unknown>,
  input: AdoptInput,
  tableSpec: TableSpec,
  adoption: CollectionAdoptionSpec,
): void {
  const now = Date.now()
  for (const stamp of adoption.autoStamps) {
    if (stamp === 'projectId') item.projectId = input.projectId
    else if (stamp === 'worldId' && input.scope) item.worldId = input.scope.worldId
    else if (stamp === 'workId' && input.scope) item.workId = input.scope.workId
    else if (stamp === 'worldGroupId' && tableSpec.worldScoped) item[tableSpec.worldGroupField ?? 'worldGroupId'] = input.worldGroupId ?? null
    else if (stamp === 'homeWorldGroupId' && tableSpec.homeWorldScoped) item.homeWorldGroupId = input.worldGroupId ?? null
    else if (stamp === 'createdAt' && item.createdAt == null) item.createdAt = now
    else if (stamp === 'updatedAt') item.updatedAt = now
  }
}

async function findExisting(
  scope: WorkspaceScope,
  tableSpec: TableSpec,
  item: Record<string, unknown>,
  adoption: CollectionAdoptionSpec,
): Promise<any | null> {
  if (adoption.identity === 'id' && item.id != null) {
    const candidate = await tableSpec.table.get(item.id as number)
    return candidate && await assertRecordInScope(scope, tableSpec.name, candidate, { owner: adoption.ownerFrom })
      ? candidate
      : null
  }
  const candidates = await readOwnedRows(scope, tableSpec.name, { owner: adoption.ownerFrom })
  return (candidates as any[]).find(row => identityMatches(row, item, adoption)) ?? null
}

function identityMatches(row: Record<string, unknown>, item: Record<string, unknown>, adoption: CollectionAdoptionSpec): boolean {
  if (adoption.identity === 'id') return row.id === item.id
  if (adoption.identity === 'name') return row.name === item.name
  return adoption.identity.fields.every(f => (row[f] ?? null) === (item[f] ?? null))
}

function identityValue(item: Record<string, unknown>, adoption: CollectionAdoptionSpec): unknown {
  if (adoption.identity === 'id') return item.id
  if (adoption.identity === 'name') return item.name
  return Object.fromEntries(adoption.identity.fields.map(f => [f, item[f] ?? null]))
}

function mergeByStrategy(
  existing: Record<string, unknown>,
  item: Record<string, unknown>,
  strategy: CollectionAdoptionSpec['mergeStrategy'],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key === 'id' || key === 'projectId' || key === 'createdAt') continue
    if (value == null || value === '') continue
    const current = existing[key]
    if (strategy === 'append-text' && typeof current === 'string' && typeof value === 'string') {
      patch[key] = current ? `${current}\n\n${value}` : value
    } else if (strategy === 'union-array' && Array.isArray(current) && Array.isArray(value)) {
      patch[key] = Array.from(new Set([...current, ...value]))
    } else {
      patch[key] = value
    }
  }
  return patch
}
