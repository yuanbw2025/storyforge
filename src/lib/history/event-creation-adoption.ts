import Dexie, { type Table, type Transaction } from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import type { AdoptResult } from '../registry/types'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { copyHistoryAuthorOriginV1, copyHistoryAuthorSelectionV1, historyAuthorRecordV1 } from '../types/history'
import { scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { resolveHistoryWorkAuthorScopeV1 } from '../workspace/ownership'
import { hashCanonicalValue } from '../agent/run/hash'
import { assertLongformHistoryScopeV1 } from './authoring-scope'
import { assertSelectedHistoryEventsCompleteV1, copyHistoryEventCandidatesV1, parseHistoryEventCreationRequestV1, type HistoryEventCandidatesV1, type HistoryEventCreationRequestV1 } from './event-creation-contract'

export const HISTORY_EVENT_CREATION_FIELDS_V1 = ['title', 'era', 'date', 'description', 'impact'] as const
export interface HistoryEventCreationScopeV1 extends WorkspaceScope { worldGroupId: number | null }
export interface HistoryEventCreationSnapshotV1 {
  version: 1
  scope: HistoryEventCreationScopeV1
  request: HistoryEventCreationRequestV1
  baseline: { histories: Record<string, unknown>[]; events: Record<string, unknown>[] }
  baselineHash: string
}
export interface AdoptHistoryEventCreationInputV1 {
  target: 'historicalTimelineEvents'
  mode: 'add-many'
  historyEventCreation: HistoryEventCreationSnapshotV1
  data: HistoryEventCandidatesV1
}
function fail(message: string): never { throw new Error(`[HistoryEvents] ${message}`) }
function native(transaction: Transaction, table: Table): Table {
  if (transaction.db !== db || !transaction.active || !transaction.storeNames.includes(table.name)) fail('原写入事务缺少历史作用域闭包。')
  return transaction.table(table.name)
}
export function historyEventCreationTransactionTablesV1(): Table[] {
  return scopeTransactionTables(db.worldGroups, db.histories, db.historicalTimelineEvents)
}
function copyScope(value: unknown): HistoryEventCreationScopeV1 {
  const row = historyAuthorRecordV1(value, ['projectId', 'worldId', 'workId', 'worldGroupId'], '事件作用域')
  const origin = copyHistoryAuthorOriginV1({ version: 1, kind: 'work', scope: { projectId: row.projectId, worldId: row.worldId, workId: row.workId } })
  const selected = copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: row.worldGroupId })
  if (origin.kind !== 'work' || selected.kind !== 'partition') fail('事件生成需要原作品及明确分区。')
  return { ...origin.scope, worldGroupId: selected.worldGroupId }
}
export function parseHistoryEventCreationSnapshotV1(value: unknown): HistoryEventCreationSnapshotV1 {
  const row = historyAuthorRecordV1(value, ['version', 'scope', 'request', 'baseline', 'baselineHash'], '事件快照')
  const scope = copyScope(row.scope), request = parseHistoryEventCreationRequestV1(row.request)
  const baseline = historyAuthorRecordV1(row.baseline, ['histories', 'events'], '事件基线')
  if (row.version !== 1 || typeof row.baselineHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.baselineHash)
    || !Array.isArray(baseline.histories) || !Array.isArray(baseline.events) || baseline.histories.length > 1) fail('事件快照基线无效。')
  const copy = (rows: unknown[]) => rows.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('历史原记录快照无效。')
    const row = structuredClone(value) as Record<string, unknown>
    if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 || row.projectId !== scope.projectId || row.worldId !== scope.worldId
      || row.workId != null || (row.worldGroupId ?? null) !== scope.worldGroupId) fail('历史原记录不属于冻结世界分区。')
    return row
  })
  const result = { version: 1 as const, scope, request, baseline: { histories: copy(baseline.histories), events: copy(baseline.events) }, baselineHash: row.baselineHash }
  const identity = REGISTRY_BY_NAME.get('historicalTimelineEvents')!.resourceIdentity!.field
  if (result.baseline.events.some(row => request.draftIds.includes(String(row[identity])))) fail('新事件身份不得复用已有原记录。')
  if (request.mode === 'from-empty' && result.baseline.events.length) fail('原时间轴已有事件，请改为补充候选。')
  return result
}
async function baselineInTransaction(scope: HistoryEventCreationScopeV1, transaction: Transaction, allocated: readonly string[] = []) {
  await resolveHistoryWorkAuthorScopeV1({ projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId }, transaction)
  await assertLongformHistoryScopeV1(scope, scope.worldGroupId, transaction)
  if (scope.worldGroupId !== null) {
    const group = await native(transaction, db.worldGroups).get(scope.worldGroupId)
    if (!group || group.projectId !== scope.projectId || group.worldId !== scope.worldId) fail('历史分区不属于当前世界。')
  }
  const owned = (row: Record<string, unknown>) => row.projectId === scope.projectId && row.worldId === scope.worldId && row.workId == null
  const histories = (await native(transaction, db.histories).where('projectId').equals(scope.projectId).toArray())
    .filter((row: Record<string, unknown>) => owned(row) && (row.worldGroupId ?? null) === scope.worldGroupId)
  if (histories.length > 1) fail('历史分区有多条总述记录，请先核对原始数据。')
  const all = (await native(transaction, db.historicalTimelineEvents).where('projectId').equals(scope.projectId).toArray()).filter(owned) as Record<string, unknown>[]
  const field = REGISTRY_BY_NAME.get('historicalTimelineEvents')!.resourceIdentity!.field
  if (all.some(row => allocated.includes(String(row[field])) && (row.worldGroupId ?? null) !== scope.worldGroupId)) fail('新事件身份已用于其他分区。')
  const events = all.filter(row => (row.worldGroupId ?? null) === scope.worldGroupId && !allocated.includes(String(row[field])))
  return { baseline: { histories, events }, allocatedRows: all.filter(row => allocated.includes(String(row[field]))) }
}
export async function readHistoryEventCreationSnapshotV1(scopeValue: HistoryEventCreationScopeV1, requestValue: HistoryEventCreationRequestV1): Promise<HistoryEventCreationSnapshotV1> {
  const scope = copyScope(scopeValue), request = parseHistoryEventCreationRequestV1(requestValue)
  return db.transaction('r', historyEventCreationTransactionTablesV1(), async () => {
    const { baseline } = await baselineInTransaction(scope, Dexie.currentTransaction!)
    return parseHistoryEventCreationSnapshotV1({ version: 1, scope, request, baseline, baselineHash: await Dexie.waitFor(hashCanonicalValue(baseline)) })
  })
}

/** Existing record-only generic adoption remains closed. Only this exact
 * creation contract can add the author's selected, preallocated new rows. */
export async function adoptHistoryEventCreationInTransactionV1(input: AdoptHistoryEventCreationInputV1, owner?: { transaction: Transaction }): Promise<AdoptResult> {
  historyAuthorRecordV1(input, ['target', 'mode', 'historyEventCreation', 'data'], '事件采纳')
  if (input.target !== 'historicalTimelineEvents' || input.mode !== 'add-many') fail('事件候选只允许增加所选新记录。')
  const snapshot = parseHistoryEventCreationSnapshotV1(input.historyEventCreation)
  const candidate = copyHistoryEventCandidatesV1(input.data, snapshot.request)
  const selected = new Set(candidate.selectedIds ?? [])
  assertSelectedHistoryEventsCompleteV1(candidate)
  const fields = new Set((FIELD_BY_TARGET.get(input.target) ?? []).map(field => field.field))
  if (HISTORY_EVENT_CREATION_FIELDS_V1.some(field => !fields.has(field))) fail('事件创作字段尚未登记，不允许写入。')
  const tables = historyEventCreationTransactionTablesV1()
  if (owner && (Dexie.currentTransaction !== owner.transaction || owner.transaction.mode !== 'readwrite')) fail('缺少原调用方写入事务。')
  const write = async (transaction: Transaction) => {
    if (transaction.mode !== 'readwrite') fail('事件采纳必须使用原写入事务。')
    for (const table of tables) native(transaction, table)
    if (await Dexie.waitFor(hashCanonicalValue(snapshot.baseline)) !== snapshot.baselineHash) fail('事件原稿摘要不匹配。')
    const { baseline, allocatedRows } = await baselineInTransaction(snapshot.scope, transaction, snapshot.request.draftIds)
    if (await Dexie.waitFor(hashCanonicalValue(baseline)) !== snapshot.baselineHash) fail('原历史或时间轴已变化，候选保留，请重新对照。')
    const table = native(transaction, db.historicalTimelineEvents)
    const identity = REGISTRY_BY_NAME.get(input.target)!.resourceIdentity!.field
    const result: AdoptResult = { written: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
    for (const draft of candidate.events.filter(event => selected.has(event.draftId))) {
      const patch = { title: draft.title, era: draft.era, date: draft.date, description: draft.description, impact: draft.impact }
      const existing = allocatedRows.filter(row => row[identity] === draft.draftId)
      if (existing.length > 1) fail('事件身份重复，未修改原时间轴。')
      if (existing[0]) {
        if (HISTORY_EVENT_CREATION_FIELDS_V1.some(field => existing[0][field] !== patch[field]) || existing[0].year !== null || existing[0].isHistorical !== false) fail('已加入的候选事件又被修改，不覆盖作者内容。')
        result.written.push({ id: existing[0].id as number, fields: [...HISTORY_EVENT_CREATION_FIELDS_V1] })
        continue
      }
      const now = Date.now()
      const row = stampNewRecord(snapshot.scope, input.target, { ...patch, [identity]: draft.draftId, projectId: snapshot.scope.projectId,
        worldGroupId: snapshot.scope.worldGroupId, year: null, isHistorical: false, createdAt: now, updatedAt: now }, { owner: 'world' })
      const id = await table.add(row) as number
      result.written.push({ id, fields: [...HISTORY_EVENT_CREATION_FIELDS_V1] })
    }
    return result
  }
  if (owner) return write(owner.transaction)
  return db.transaction('rw', tables, () => write(Dexie.currentTransaction!))
}

export async function assertHistoryEventCreationFreshV1(value: HistoryEventCreationSnapshotV1, beforeDispatch = false): Promise<void> {
  const snapshot = parseHistoryEventCreationSnapshotV1(value)
  await db.transaction('r', historyEventCreationTransactionTablesV1(), async () => {
    const { baseline, allocatedRows } = await baselineInTransaction(snapshot.scope, Dexie.currentTransaction!, snapshot.request.draftIds)
    if (beforeDispatch && allocatedRows.length) fail('本次身份已有事件，未再次调用模型。')
    if (await Dexie.waitFor(hashCanonicalValue(snapshot.baseline)) !== snapshot.baselineHash
      || await Dexie.waitFor(hashCanonicalValue(baseline)) !== snapshot.baselineHash) fail('原历史或时间轴已变化，候选保留，请重新对照。')
  })
}
export async function historyEventCreationMatchesBusinessV1(value: HistoryEventCreationSnapshotV1, data: HistoryEventCandidatesV1): Promise<boolean> {
  const snapshot = parseHistoryEventCreationSnapshotV1(value), candidate = copyHistoryEventCandidatesV1(data, snapshot.request)
  if (!candidate.selectedIds?.length) return false
  return db.transaction('r', historyEventCreationTransactionTablesV1(), async () => {
    const transaction = Dexie.currentTransaction!
    await resolveHistoryWorkAuthorScopeV1({ projectId: snapshot.scope.projectId, worldId: snapshot.scope.worldId, workId: snapshot.scope.workId }, transaction)
    const rows = await native(transaction, db.historicalTimelineEvents).where('projectId').equals(snapshot.scope.projectId).toArray() as Record<string, unknown>[]
    const identity = REGISTRY_BY_NAME.get('historicalTimelineEvents')!.resourceIdentity!.field
    return candidate.events.filter(row => candidate.selectedIds!.includes(row.draftId)).every(draft => {
      const matches = rows.filter(row => row.worldId === snapshot.scope.worldId && row.workId == null
        && (row.worldGroupId ?? null) === snapshot.scope.worldGroupId && row[identity] === draft.draftId)
      return matches.length === 1 && matches[0].year === null && matches[0].isHistorical === false
        && HISTORY_EVENT_CREATION_FIELDS_V1.every(field => matches[0][field] === draft[field])
    })
  })
}
