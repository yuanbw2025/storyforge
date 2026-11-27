import type { Transaction } from 'dexie'
import type { Geography, Project, Work, WorkspaceScope } from '../types'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { readOwnedRows } from '../workspace/scope'
import { resolveHistoryWorkAuthorScopeV1 } from '../workspace/ownership'

export type GeographyFormRecordV1 = Geography & { worldId?: number; ragDocumentId?: string }
export type GeographyFormFieldV1 = 'overview' | 'locations'
/** A form may save both existing fields atomically. This is not an AI write contract. */
export interface GeographyFormSaveV1 {
  kind: 'geography-form-save-v1'
  expected: GeographyFormRecordV1 | null
}
export function geographyFormRequestV1(data: Record<string, unknown>, scope: WorkspaceScope) {
  const fields = Object.keys(data).filter(key => key !== 'projectId' && key !== 'worldGroupId')
  if (data.projectId !== scope.projectId || !fields.length
    || fields.some(field => !['overview', 'locations'].includes(field) || !(FIELD_BY_TARGET.get('geographies') ?? []).some(spec => spec.field === field && !spec.adoptionPolicy) || typeof data[field] !== 'string')
    || (data.worldGroupId != null && (!Number.isSafeInteger(data.worldGroupId) || Number(data.worldGroupId) < 1)))
    throw new Error('地理保存字段或作用域凭据无效。')
  if (fields.includes('locations')) {
    let rows: unknown
    try { rows = JSON.parse(data.locations as string) } catch { throw new Error('地点原文格式异常，输入已保留。') }
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.name !== 'string')
      || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('地点记录格式异常，输入已保留。')
  }
  return fields as GeographyFormFieldV1[]
}
export function assertGeographyFormIdentityV1(row: GeographyFormRecordV1, scope: WorkspaceScope, groupId: number | null) {
  if (row.id == null || row.projectId !== scope.projectId || row.worldId !== scope.worldId
    || (row.worldGroupId ?? null) !== groupId || !isPortableResourceUidV1(row.ragDocumentId, 'geography'))
    throw new Error('地理记录身份或分区已变化，输入已保留。')
}
export async function assertGeographyFormExpectedV1(row: GeographyFormRecordV1 | null, scope: WorkspaceScope, groupId: number | null,
  expected: GeographyFormRecordV1 | null, fields: GeographyFormFieldV1[], transaction: Transaction) {
  await resolveHistoryWorkAuthorScopeV1(scope, transaction)
  const [project, work] = await Promise.all([
    transaction.table<Project, number>('projects').get(scope.projectId), transaction.table<Work, number>('works').get(scope.workId),
  ])
  if (project?.workspacePurpose !== 'independent-work' || work?.kind !== 'novel' || work.novelProfile !== 'long')
    throw new Error('地理本机保存确认仅开放独立长篇。')
  if (row) assertGeographyFormIdentityV1(row, scope, groupId)
  if (expected) assertGeographyFormIdentityV1(expected, scope, groupId)
  if ((row?.id ?? null) !== (expected?.id ?? null) || (row?.ragDocumentId ?? null) !== (expected?.ragDocumentId ?? null)
    || fields.some(field => row?.[field] !== expected?.[field])) throw new Error('地理字段已被修改，当前输入已保留；请核对后重新读取。')
}
export function assertGeographyFormWrittenV1(row: GeographyFormRecordV1 | undefined, scope: WorkspaceScope, groupId: number | null,
  expected: GeographyFormRecordV1 | null, data: Record<string, unknown>, fields: GeographyFormFieldV1[]) {
  if (!row) throw new Error('地理保存后记录不存在，输入已保留。')
  assertGeographyFormIdentityV1(row, scope, groupId)
  if ((expected && (row.id !== expected.id || row.ragDocumentId !== expected.ragDocumentId))
    || fields.some(field => row[field] !== data[field])) throw new Error('地理精确保存校验失败，输入已保留。')
  return row
}
export async function readGeographyFormV1(scope: WorkspaceScope, groupId: number | null) {
  await resolveHistoryWorkAuthorScopeV1(scope)
  const rows = (await readOwnedRows<GeographyFormRecordV1>(scope, 'geographies', { owner: 'world' }))
    .filter(row => (row.worldGroupId ?? null) === groupId)
  if (rows.length > 1) throw new Error('地理分区记录不唯一，不能确认保存。')
  if (rows[0]) assertGeographyFormIdentityV1(rows[0], scope, groupId)
  return rows[0] ?? null
}
