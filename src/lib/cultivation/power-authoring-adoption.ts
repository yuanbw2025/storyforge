import Dexie, { type Table, type Transaction } from 'dexie'
import { db } from '../db/schema'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { transactionTablesForReferences } from '../registry/lifecycle'
import { scopeTransactionTables } from '../workspace/scope'
import { resolveHistoryWorkAuthorScopeV1 } from '../workspace/ownership'
import { hashCanonicalValue } from '../agent/run/hash'
import { refreshSettingAssertionSourceStatus } from '../fact-ledger/setting-assertions'
import { clearRemovedCultivationStageReferences, refreshCultivationProgressStageSources } from './lifecycle'
import { preparePowerAuthoringEditV1, type PowerAuthoringScopeV1, type PowerAuthoringSnapshotV1, type PowerAuthoringTargetV1 } from './power-authoring-contract'
import type { AdoptResult } from '../registry/types'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'

export interface PowerAuthoringReferenceV1 {
  table: string
  id: number
  workId: number | null
  stageId: string | null
  label: string
  /** Native identity/preimage, never model-generated content. */
  rowHash: string
}
export interface PowerAuthoringBaselineV1 {
  snapshot: PowerAuthoringSnapshotV1
  recordHash: string
  references: PowerAuthoringReferenceV1[]
  referenceHash: string
}
export interface AdoptPowerAuthoringInputV1 {
  target: PowerAuthoringTargetV1['table']
  powerAuthoring: {
    scope: PowerAuthoringScopeV1
    edit: PowerAuthoringTargetV1
    recordHash: string
    referenceHash: string
    allocatedStageIds: readonly string[]
    confirmedRemovalHash?: string
  }
  data: unknown
  mode: 'replace'
}

function fail(message: string): never { throw new Error(`[PowerAuthoring] ${message}`) }
function exact(value: unknown, fields: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !fields.includes(key))) fail(`${label} 包含未登记字段或结构异常`)
}
function hash(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('缺少原始状态摘要') }
function nativeTable(transaction: Transaction, table: Table): Table {
  if (transaction.db !== db || !transaction.active || !transaction.storeNames.includes(table.name)) fail('原采纳事务缺少登记表')
  return transaction.table(table.name)
}
export function powerAuthoringTransactionTablesV1(target: PowerAuthoringTargetV1['table']): Table[] {
  if (!['worldviews', 'powerSystems', 'cultivationSystems'].includes(target)) fail('未登记的力量目标')
  return scopeTransactionTables(...transactionTablesForReferences(target), db.worldGroups, db.temporalFacts)
}

async function baselineInTransaction(scope: PowerAuthoringScopeV1, edit: PowerAuthoringTargetV1, transaction: Transaction): Promise<PowerAuthoringBaselineV1> {
  exact(scope, ['projectId', 'worldId', 'workId', 'worldGroupId'], '力量作用域')
  if (scope.worldGroupId !== null && (!Number.isSafeInteger(scope.worldGroupId) || scope.worldGroupId < 1)) fail('必须指定原分区或 null')
  await resolveHistoryWorkAuthorScopeV1({ projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId }, transaction)
  const spec = REGISTRY_BY_NAME.get(edit.table), table = spec?.table
  if (!table || !spec.resourceIdentity) fail('力量目标未登记')
  const record = await nativeTable(transaction, table).get(edit.recordId)
  if (!record || record.projectId !== scope.projectId || record.worldId !== scope.worldId
    || (record.worldGroupId ?? null) !== scope.worldGroupId
    || !isPortableResourceUidV1(record[spec.resourceIdentity.field], spec.resourceIdentity.resourceKind)) fail('原记录不存在、身份缺失或属于其他 World/分区')
  if (scope.worldGroupId !== null) {
    const group = await nativeTable(transaction, db.worldGroups).get(scope.worldGroupId)
    if (!group || group.projectId !== scope.projectId || group.worldId !== scope.worldId) fail('原分区不属于该 World')
  }
  const references: PowerAuthoringReferenceV1[] = []
  if (edit.table === 'cultivationSystems' && edit.field === 'stages') {
    // Parent registry is the authority for holders. A corrupt cross-World FK
    // must not make an authoring operation mutate another owner's records.
    for (const ref of REGISTRY_BY_NAME.get('cultivationSystems')!.refs ?? []) {
      if (ref.kind !== 'simple') fail('新增引用类型需要登记力量阶段影响规则')
      const match = /^([^[]+)\[([^\]]+)\]$/.exec(ref.target)
      if (!match) fail('力量引用声明异常')
      const spec = REGISTRY_BY_NAME.get(match[1])
      if (!spec) fail('力量引用目标未登记')
      const rows = await nativeTable(transaction, spec.table).where('projectId').equals(scope.projectId)
        .filter(row => row[match[2]] === edit.recordId).toArray()
      for (const row of rows) {
        const work = typeof row.workId === 'number' ? await nativeTable(transaction, db.works).get(row.workId) : null
        const owned = spec.domainOwner?.defaultOwner === 'work'
          ? work?.projectId === scope.projectId && work.worldId === scope.worldId
          : row.worldId === scope.worldId
        if (!owned || !Number.isSafeInteger(row.id)) fail('存在跨 World 或身份不明的力量引用，请先修复原引用')
        references.push({ table: spec.name, id: row.id, workId: work?.id ?? null,
          stageId: typeof row.cultivationStageId === 'string' ? row.cultivationStageId : typeof row.stageId === 'string' ? row.stageId : null,
          label: String(row.name ?? row.characterName ?? row.stageName ?? row.id), rowHash: await hashCanonicalValue(row) })
      }
    }
  }
  references.sort((a, b) => a.table.localeCompare(b.table) || a.id - b.id)
  return { snapshot: { table: edit.table, record } as PowerAuthoringSnapshotV1,
    recordHash: await hashCanonicalValue(record), references, referenceHash: await hashCanonicalValue(references) }
}

/** Native preimage for exact adoption. The subsequent candidate producer must
 * disclose it through a registered context source; this read never writes. */
export async function readPowerAuthoringBaselineV1(scope: PowerAuthoringScopeV1, edit: PowerAuthoringTargetV1): Promise<PowerAuthoringBaselineV1> {
  const frozen = structuredClone({ scope, edit })
  return db.transaction('r', powerAuthoringTransactionTablesV1(frozen.edit.table), () => {
    const transaction = Dexie.currentTransaction!
    return Dexie.waitFor(baselineInTransaction(frozen.scope, frozen.edit, transaction))
  })
}

export function powerRemovalImpactHashV1(baseline: PowerAuthoringBaselineV1, removedStageIds: readonly string[]) {
  return hashCanonicalValue({ recordHash: baseline.recordHash, referenceHash: baseline.referenceHash,
    removedStageIds: [...removedStageIds].sort(), references: baseline.references.filter(ref => ref.stageId && removedStageIds.includes(ref.stageId)) })
}

/** Called by the sole adopt() router. No model call, row creation, or optimistic
 * acknowledgement. With an owner, formal writes and the Run receipt share its
 * already active native transaction, including rollback of all lifecycle effects. */
export async function adoptPowerAuthoringInTransactionV1(untrusted: AdoptPowerAuthoringInputV1, owner?: { transaction: Transaction }): Promise<AdoptResult> {
  exact(untrusted, ['target', 'powerAuthoring', 'data', 'mode'], '采纳')
  exact(untrusted.powerAuthoring, ['scope', 'edit', 'recordHash', 'referenceHash', 'allocatedStageIds', 'confirmedRemovalHash'], '力量确认')
  const input = structuredClone(untrusted), intent = input.powerAuthoring
  if (input.mode !== 'replace' || input.target !== intent.edit?.table) fail('仅允许原记录定点 replace')
  hash(intent.recordHash); hash(intent.referenceHash)
  if (!Array.isArray(intent.allocatedStageIds) || intent.allocatedStageIds.some(id => typeof id !== 'string' || !id.trim())) fail('新增阶段 ID 白名单异常')
  const tables = powerAuthoringTransactionTablesV1(input.target)
  if (owner && (owner.transaction.db !== db || !owner.transaction.active || owner.transaction.mode !== 'readwrite'
    || Dexie.currentTransaction !== owner.transaction || tables.some(table => !owner.transaction.storeNames.includes(table.name)))) fail('缺少原调用方写事务或完整生命周期表')
  const write = async (transaction: Transaction): Promise<AdoptResult> => {
    const before = await baselineInTransaction(intent.scope, intent.edit, transaction)
    if (before.recordHash !== intent.recordHash || before.referenceHash !== intent.referenceHash) fail('原记录或引用已变化，候选未写入；请重新核对')
    const prepared = preparePowerAuthoringEditV1({ scope: intent.scope, target: intent.edit, snapshot: before.snapshot,
      value: input.data, allocatedStageIds: intent.allocatedStageIds })
    const fields = Object.keys(prepared.patch)
    if (fields.length !== 1 || !FIELD_BY_TARGET.get(input.target)?.some(spec => spec.field === fields[0])) fail('目标字段不在 FIELD_REGISTRY')
    if (fields[0] === 'name' && !prepared.patch.name.trim()) fail('体系或路径名称不能为空')
    if (prepared.removedStageIds.length && intent.confirmedRemovalHash !== await powerRemovalImpactHashV1(before, prepared.removedStageIds)) fail('删除阶段需要确认当前引用影响，未写入')
    const table = REGISTRY_BY_NAME.get(input.target)!.table
    const scopedTable = nativeTable(transaction, table), update = table.update.bind(scopedTable)
    const updatedAt = Date.now()
    if (await update(intent.edit.recordId, { ...prepared.patch, updatedAt }) !== 1) fail('原记录写入0行，采纳已回滚')
    if (input.target === 'cultivationSystems' && prepared.patch.stages !== undefined) {
      await clearRemovedCultivationStageReferences(intent.scope.projectId, intent.edit.recordId, new Set(prepared.removedStageIds), transaction)
      await refreshCultivationProgressStageSources({ projectId: intent.scope.projectId, systemId: intent.edit.recordId,
        previousStages: (before.snapshot.record as { stages: string }).stages, nextStages: prepared.patch.stages }, transaction)
    }
    await refreshSettingAssertionSourceStatus({ projectId: intent.scope.projectId, table: input.target,
      recordId: intent.edit.recordId, changedFields: fields }, transaction)
    const actual = await scopedTable.get(intent.edit.recordId)
    if (!actual || actual.ragDocumentId !== Reflect.get(before.snapshot.record, 'ragDocumentId')
      || actual.worldId !== intent.scope.worldId || actual.projectId !== intent.scope.projectId
      || await hashCanonicalValue(actual) !== await hashCanonicalValue({ ...before.snapshot.record, ...prepared.patch, updatedAt })) fail('力量采纳后态不匹配，已回滚')
    return { written: [{ id: intent.edit.recordId, fields }], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
  }
  if (owner) return Dexie.waitFor(write(owner.transaction))
  return db.transaction('rw', tables, () => {
    const transaction = Dexie.currentTransaction!
    return Dexie.waitFor(write(transaction))
  })
}
