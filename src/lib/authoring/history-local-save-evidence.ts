import type { Transaction } from 'dexie'
import { db } from '../db/schema'
import { hashAdoptFieldValueV1 } from '../registry/adopt'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { assertRecordInScope, readOwnedRows, getTableSpec } from '../workspace/scope'
import { resolveHistoryWorkAuthorScopeV1 } from '../workspace/ownership'
import type { Work, Project } from '../types'
import { localSaveIdentityKeyV1, type LocalSaveHistoryIdentityV1, type LocalSaveIntentV1, type LocalSaveWitnessV1, type LocalSaveAckV1 } from './local-save-evidence'

export interface HistoryTextRowV1 {
  id?: number; projectId: number; worldId?: number; worldGroupId?: number | null; ragDocumentId?: string
  overview?: string; eraSystem?: string; description?: string; conceptNote?: string
}
const prefixes = { histories: 'history', historicalTimelineEvents: 'historical-event', historicalKeywords: 'historical-keyword' } as const

export function historyTextSaveRequestV1(patch: Record<string, unknown>, intent: LocalSaveIntentV1) {
  const expected = intent?.expected, identity = expected?.identity as LocalSaveHistoryIdentityV1 | undefined
  if (intent?.kind !== 'natural-field-local-save-v1' || !identity || !Object.prototype.hasOwnProperty.call(prefixes, identity.table)
    || !(identity.table === 'histories' ? ['overview', 'eraSystem'] : ['description', 'conceptNote']).includes(identity.field)
    || !intent.session || !Number.isSafeInteger(intent.generation) || intent.generation < 0 || expected.version !== 1
    || !['database-read', 'committed-write'].includes(expected.source)
    || Object.keys(patch).length !== 1 || typeof patch[identity.field] !== 'string') throw new Error('历史保存字段凭据无效。')
  if (identity.table !== 'histories' && (!Number.isSafeInteger(identity.recordId) || identity.recordId < 1
    || expected.recordId !== identity.recordId)) throw new Error('历史保存记录凭据无效。')
  return { identity: { ...identity }, expected, raw: patch[identity.field] as string }
}

export async function historyTextWitnessV1(row: HistoryTextRowV1 | null | undefined, identity: LocalSaveHistoryIdentityV1,
  source: LocalSaveWitnessV1['source']): Promise<LocalSaveWitnessV1> {
  const value = row?.[identity.field]
  if (value !== undefined && typeof value !== 'string') throw new Error('历史文字格式异常，不能确认本机保存。')
  if (row && (row.id == null || row.projectId !== identity.projectId || row.worldId !== identity.worldId
    || (row.worldGroupId ?? null) !== identity.worldGroupId || !isPortableResourceUidV1(row.ragDocumentId, prefixes[identity.table])
    || ('recordId' in identity && row.id !== identity.recordId))) throw new Error('历史记录身份或分区不一致，不能确认本机保存。')
  if (!row && identity.table !== 'histories') throw new Error('历史记录已不存在，不能确认本机保存。')
  return { version: 1, source, identity: { ...identity }, recordId: row?.id ?? null, resourceUid: row?.ragDocumentId ?? null,
    value, present: row != null && Object.prototype.hasOwnProperty.call(row, identity.field),
    valueHash: await hashAdoptFieldValueV1(value), confirmedAt: Date.now() }
}

export async function assertHistoryTextSaveExpectedV1(row: HistoryTextRowV1 | null | undefined,
  intent: LocalSaveIntentV1, transaction: Transaction) {
  const identity = intent.expected.identity as LocalSaveHistoryIdentityV1
  await resolveHistoryWorkAuthorScopeV1({ projectId: identity.projectId, worldId: identity.worldId, workId: identity.workId }, transaction)
  const [project, work] = await Promise.all([
    transaction.table<Project, number>('projects').get(identity.projectId), transaction.table<Work, number>('works').get(identity.workId),
  ])
  if (project?.workspacePurpose !== 'independent-work' || work?.kind !== 'novel' || work.novelProfile !== 'long')
    throw new Error('历史本机保存确认仅开放独立长篇。')
  const actual = await historyTextWitnessV1(row, identity, 'database-read'), expected = intent.expected
  if (actual.recordId !== expected.recordId || actual.resourceUid !== expected.resourceUid
    || actual.present !== expected.present || actual.value !== expected.value || actual.valueHash !== expected.valueHash)
    throw new Error('历史字段已变化，当前草稿已保留；请核对后重新读取。')
}

export async function historyTextSaveAckV1(row: HistoryTextRowV1 | null | undefined, intent: LocalSaveIntentV1, raw: string): Promise<LocalSaveAckV1> {
  const witness = await historyTextWitnessV1(row, intent.expected.identity as LocalSaveHistoryIdentityV1, 'committed-write')
  if (witness.value !== raw || !witness.present || witness.recordId == null || witness.resourceUid == null
    || (intent.expected.recordId != null && (witness.recordId !== intent.expected.recordId || witness.resourceUid !== intent.expected.resourceUid)))
    throw new Error('历史保存后未读到相同原文，当前输入已保留。')
  return { kind: 'natural-field-local-save-ack-v1', session: intent.session, generation: intent.generation, witness }
}

export async function readHistoryTextWitnessesV1(identities: LocalSaveHistoryIdentityV1[]) {
  const reads = new Map<string, Promise<HistoryTextRowV1[]>>()
  const pairs = await Promise.all(identities.map(async identity => {
    const key = JSON.stringify([identity.projectId, identity.worldId, identity.workId, identity.table])
    if (!reads.has(key)) reads.set(key, resolveHistoryWorkAuthorScopeV1({ projectId: identity.projectId, worldId: identity.worldId, workId: identity.workId })
      .then(() => readOwnedRows<HistoryTextRowV1>(identity, identity.table, { owner: 'world' })))
    const rows = await reads.get(key)!
    const candidates = rows.filter(row => (row.worldGroupId ?? null) === identity.worldGroupId
      && (!('recordId' in identity) || row.id === identity.recordId))
    if (candidates.length > 1) throw new Error('历史分区记录不唯一。')
    const row = candidates[0]
    if (row && !await assertRecordInScope(identity, identity.table, row, { owner: 'world' })) throw new Error('历史记录已切换。')
    return [localSaveIdentityKeyV1(identity), await historyTextWitnessV1(row, identity, 'database-read')] as const
  }).map(read => read.catch(() => null)))
  return Object.fromEntries(pairs.filter((pair): pair is readonly [string, LocalSaveWitnessV1] => pair !== null))
}

/** Existing selected-record writers use this after their native transaction commits. */
export async function readHistoryTextSaveAckV1(intent: LocalSaveIntentV1, raw: string) {
  const identity = intent.expected.identity as LocalSaveHistoryIdentityV1
  if (!('recordId' in identity)) throw new Error('历史记录凭据缺少身份。')
  const row = await db.table<HistoryTextRowV1, number>(getTableSpec(identity.table).table.name).get(identity.recordId)
  return historyTextSaveAckV1(row, intent, raw)
}
