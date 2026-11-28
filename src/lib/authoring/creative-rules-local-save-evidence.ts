import type { Transaction } from 'dexie'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import { hashAdoptFieldValueV1 } from '../registry/adopt'
import { readOwnedRows } from '../workspace/scope'
import type { CreativeRules, Project, Work, WorkspaceScope } from '../types'
import { LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1, type LocalSaveCreativeRuleFieldV1, type LocalSaveIntentV1, type LocalSaveWitnessV1 } from './local-save-evidence'
import { parseSystemFictionElementsV1 } from '../prose/system-fiction-contract'

/** Proof representation only; the original structured field remains an object in DB. */
export function creativeRuleProofValueV1(field: LocalSaveCreativeRuleFieldV1, value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (field === 'systemFictionElements') return JSON.stringify(parseSystemFictionElementsV1(value))
  if (typeof value !== 'string') throw new Error('创作规则字段格式异常，不能确认本机保存。')
  return value
}

export function creativeRuleSaveRequestV1(data: Record<string, unknown>, scope: WorkspaceScope, intent: LocalSaveIntentV1) {
  const expected = intent?.expected
  const identity = expected?.identity?.table === 'creativeRules' ? expected.identity : undefined
  const field = identity?.field
  if (intent?.kind !== 'natural-field-local-save-v1' || !identity || !field || ![...LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1, 'systemFictionElements'].includes(field)
    || !intent.session || !Number.isSafeInteger(intent.generation) || intent.generation < 0 || expected.version !== 1
    || !['database-read', 'committed-write'].includes(expected.source) || identity.worldGroupId !== null
    || identity.projectId !== scope.projectId || identity.worldId !== scope.worldId || identity.workId !== scope.workId
    || data.projectId !== scope.projectId || Object.keys(data).some(key => !['projectId', field].includes(key))
    || data[field] === undefined) throw new Error('本机保存字段或作用域凭据无效。')
  return { expected, field, raw: creativeRuleProofValueV1(field, data[field])! }
}

export async function assertCreativeRuleSaveExpectedV1(row: CreativeRules | undefined, scope: WorkspaceScope, intent: LocalSaveIntentV1, transaction: Transaction) {
  const identity = intent.expected.identity
  if (identity.table !== 'creativeRules') throw new Error('本机保存字段或作用域凭据无效。')
  const [project, work] = await Promise.all([
    transaction.table<Project, number>('projects').get(scope.projectId),
    transaction.table<Work, number>('works').get(scope.workId),
  ])
  if (project?.workspacePurpose !== 'independent-work' || work?.kind !== 'novel' || work.novelProfile !== 'long') {
    throw new Error('本机保存确认仅开放独立长篇。')
  }
  const { field } = identity, expected = intent.expected, value = creativeRuleProofValueV1(field, row?.[field])
  if ((row?.id ?? null) !== expected.recordId || (row?.ragDocumentId ?? null) !== expected.resourceUid
    || (row != null && Object.prototype.hasOwnProperty.call(row, field)) !== expected.present
    || value !== expected.value) throw new Error('此字段已被修改或记录已变化，已保留草稿；请核对后重新读取。')
  if (await hashAdoptFieldValueV1(value) !== expected.valueHash) throw new Error('字段预像已变化，已保留草稿。')
}

export async function creativeRuleTextWitnessV1(row: CreativeRules | undefined, scope: WorkspaceScope,
  field: LocalSaveCreativeRuleFieldV1, source: LocalSaveWitnessV1['source']): Promise<LocalSaveWitnessV1> {
  const value = creativeRuleProofValueV1(field, row?.[field])
  if (row && (row.id == null || row.projectId !== scope.projectId || row.workId !== scope.workId
    || !isPortableResourceUidV1(row.ragDocumentId, 'creative-rules'))) throw new Error('创作规则记录身份不完整，不能确认本机保存。')
  return { version: 1, source, identity: { ...scope, table: 'creativeRules', field, worldGroupId: null },
    recordId: row?.id ?? null, resourceUid: row?.ragDocumentId ?? null,
    present: row != null && Object.prototype.hasOwnProperty.call(row, field), value,
    valueHash: await hashAdoptFieldValueV1(value), confirmedAt: Date.now() }
}

export async function readCreativeRuleSaveWitnessesV1(scope: WorkspaceScope) {
  const rows = await readOwnedRows<CreativeRules>(scope, 'creativeRules', { owner: 'work' })
  if (rows.length > 1) throw new Error('创作规则记录不唯一，不能确认本机保存。')
  const pairs = await Promise.all(([...LOCAL_SAVE_CREATIVE_RULE_FIELDS_V1, 'systemFictionElements'] as const).map(async field => {
    try { return [field, await creativeRuleTextWitnessV1(rows[0], scope, field, 'database-read')] }
    catch { return [field, undefined] }
  }))
  return Object.fromEntries(pairs) as Partial<Record<LocalSaveCreativeRuleFieldV1, LocalSaveWitnessV1>>
}
