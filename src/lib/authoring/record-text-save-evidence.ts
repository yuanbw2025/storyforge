import type { Transaction } from 'dexie'
import { db } from '../db/schema'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { hashAdoptFieldValueV1 } from '../registry/adopt'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { resolveHistoryWorkAuthorScopeV1 } from '../workspace/ownership'
import type { Project, Work, WorkspaceScope } from '../types'
import type { LocalSaveAckV1, LocalSaveIntentV1, LocalSaveRecordIdentityV1, LocalSaveWitnessV1 } from './local-save-evidence'

export type RecordTextTableV1 = LocalSaveRecordIdentityV1['table']
export interface RecordTextRowV1 {
  id?: number; projectId: number; worldId?: number; workId?: number; worldGroupId?: number | null
  ragDocumentId?: string; updatedAt: number
}
const prefix = { characters: 'character', outlineNodes: 'outline-node' } as const
export function recordAuthorTextFieldsV1(table: RecordTextTableV1) {
  return (FIELD_BY_TARGET.get(table) ?? []).filter(spec => !spec.adoptionPolicy && !spec.field.startsWith('statusProducer')
    && ['string', 'longtext'].includes(spec.type)).map(spec => spec.field)
}
export function recordTextSaveRequestV1(table: RecordTextTableV1, id: number, patch: Record<string, unknown>,
  scope: WorkspaceScope | undefined, intent: LocalSaveIntentV1) {
  const expected = intent?.expected, identity = expected?.identity as LocalSaveRecordIdentityV1 | undefined
  if (intent?.kind !== 'natural-field-local-save-v1' || !intent.session || !Number.isSafeInteger(intent.generation) || intent.generation < 0
    || !identity || identity.table !== table || identity.recordId !== id || expected.recordId !== id || expected.version !== 1
    || !['database-read', 'committed-write'].includes(expected.source) || !scope || identity.projectId !== scope.projectId
    || identity.worldId !== scope.worldId || identity.workId !== scope.workId || !recordAuthorTextFieldsV1(table).includes(identity.field)
    || Object.keys(patch).length !== 1 || typeof patch[identity.field] !== 'string') throw new Error('文字保存字段或记录凭据无效。')
  return { identity, raw: patch[identity.field] as string }
}
export async function recordTextWitnessV1(row: RecordTextRowV1 | undefined, identity: LocalSaveRecordIdentityV1,
  source: LocalSaveWitnessV1['source']): Promise<LocalSaveWitnessV1> {
  const value: unknown = row ? Reflect.get(row, identity.field) : undefined
  if (!row || row.id !== identity.recordId || row.projectId !== identity.projectId
    || (identity.table === 'characters' ? row.worldId !== identity.worldId : row.workId !== identity.workId)
    || (identity.table === 'outlineNodes' && (row.worldGroupId ?? null) !== identity.worldGroupId)
    || !isPortableResourceUidV1(row.ragDocumentId, prefix[identity.table]) || (value !== undefined && typeof value !== 'string'))
    throw new Error('文字记录已删除、归属或身份变化，不能确认本机保存。')
  return { version: 1, source, identity: { ...identity }, recordId: row.id!, resourceUid: row.ragDocumentId!,
    value: value as string | undefined, present: Object.prototype.hasOwnProperty.call(row, identity.field),
    valueHash: await hashAdoptFieldValueV1(value), confirmedAt: Date.now() }
}
export async function assertRecordTextSaveExpectedV1(row: RecordTextRowV1 | undefined, intent: LocalSaveIntentV1, transaction: Transaction) {
  const identity = intent.expected.identity as LocalSaveRecordIdentityV1
  await resolveHistoryWorkAuthorScopeV1({ projectId: identity.projectId, worldId: identity.worldId, workId: identity.workId }, transaction)
  const [project, work] = await Promise.all([transaction.table<Project, number>('projects').get(identity.projectId), transaction.table<Work, number>('works').get(identity.workId)])
  if (project?.workspacePurpose !== 'independent-work' || work?.kind !== 'novel' || work.novelProfile !== 'long') throw new Error('文字保存确认仅开放独立长篇。')
  const actual = await recordTextWitnessV1(row, identity, 'database-read'), expected = intent.expected
  if (actual.resourceUid !== expected.resourceUid || actual.present !== expected.present || actual.value !== expected.value
    || actual.valueHash !== expected.valueHash) throw new Error('文字字段已被修改，当前输入已保留，请核对后保存。')
}
export async function recordTextSaveAckV1(row: RecordTextRowV1 | undefined, intent: LocalSaveIntentV1, raw: string): Promise<LocalSaveAckV1> {
  const witness = await recordTextWitnessV1(row, intent.expected.identity as LocalSaveRecordIdentityV1, 'committed-write')
  if (witness.resourceUid !== intent.expected.resourceUid || witness.value !== raw || !witness.present)
    throw new Error('保存后未读到相同身份与原文，输入已保留。')
  return { kind: 'natural-field-local-save-ack-v1', session: intent.session, generation: intent.generation, witness }
}
export async function readRecordTextWitnessesV1(table: RecordTextTableV1, id: number, scope: WorkspaceScope) {
  await resolveHistoryWorkAuthorScopeV1(scope)
  const row = await db.table<RecordTextRowV1, number>(table).get(id)
  const witnesses: Record<string, LocalSaveWitnessV1> = {}
  for (const field of recordAuthorTextFieldsV1(table)) {
    const identity: LocalSaveRecordIdentityV1 = { ...scope, table, field, recordId: id, worldGroupId: table === 'outlineNodes' ? row?.worldGroupId ?? null : null }
    try { witnesses[field] = await recordTextWitnessV1(row, identity, 'database-read') }
    catch { /* A malformed field remains unknown; other fields retain their own evidence. */ }
  }
  return witnesses
}
