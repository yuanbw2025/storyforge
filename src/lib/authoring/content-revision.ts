import { PROJECT_TABLES } from '../registry/project-tables'
import type { TableSpec } from '../registry/types'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, readOwnedRows } from '../workspace/scope'
import { hashCanonicalValue } from '../agent/run/hash'

export interface WorkspaceContentRevisionEntryV1 {
  table: string
  rowCount: number
  contentHash: string
}

export interface WorkspaceContentRevisionVectorV1 {
  version: 1
  entries: WorkspaceContentRevisionEntryV1[]
  vectorHash: string
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isBinaryTable(spec: TableSpec): boolean {
  return spec.portableData?.kind === 'binary-blob'
}

/**
 * Derive the conservative Canon set from PROJECT_TABLES metadata. Agent logs,
 * caches, usage and transient tables are excluded without introducing another
 * table-name registry.
 */
export function contentRevisionTableSpecsV1(): TableSpec[] {
  return PROJECT_TABLES
    .filter(spec => !isBinaryTable(spec))
    .filter(spec => spec.workspaceProjection != null || spec.worldSemantic != null)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function parseWorkspaceContentRevisionV1(value: unknown): WorkspaceContentRevisionVectorV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('内容修订向量必须是对象')
  }
  const record = value as Partial<WorkspaceContentRevisionVectorV1>
  if (record.version !== 1 || !Array.isArray(record.entries) || !hash(record.vectorHash)) {
    throw new Error('内容修订向量身份或哈希无效')
  }
  const allowed = new Set(contentRevisionTableSpecsV1().map(spec => spec.name))
  const entries = record.entries.map(entry => {
    if (!entry || typeof entry.table !== 'string' || !allowed.has(entry.table)
      || !Number.isInteger(entry.rowCount) || entry.rowCount < 0 || !hash(entry.contentHash)) {
      throw new Error('内容修订向量表项无效')
    }
    return { table: entry.table, rowCount: entry.rowCount, contentHash: entry.contentHash }
  })
  if (new Set(entries.map(entry => entry.table)).size !== entries.length) {
    throw new Error('内容修订向量包含重复表项')
  }
  const parsed: WorkspaceContentRevisionVectorV1 = {
    version: 1,
    entries: entries.sort((left, right) => left.table.localeCompare(right.table)),
    vectorHash: record.vectorHash,
  }
  return parsed
}

function inWorldGroup(
  spec: TableSpec,
  row: Record<string, unknown>,
  worldGroupId: number | null,
): boolean {
  if (spec.worldScoped) {
    const field = spec.worldGroupField ?? 'worldGroupId'
    return (row[field] ?? null) === worldGroupId
  }
  if (spec.homeWorldScoped) {
    if (worldGroupId == null) return true
    return row.isCrossWorld === true || (row.homeWorldGroupId ?? null) === worldGroupId
  }
  return true
}

function vectorBody(input: Omit<WorkspaceContentRevisionVectorV1, 'vectorHash'>): unknown {
  return input
}

async function readRevisionRows(
  spec: TableSpec,
  scope: WorkspaceScope,
): Promise<Record<string, unknown>[]> {
  if (spec.owner === 'global' || spec.table.schema.idxByName.projectId) {
    return readOwnedRows<Record<string, unknown>>(scope, spec.name)
  }
  const owned: Record<string, unknown>[] = []
  for (const row of await spec.table.toArray() as Record<string, unknown>[]) {
    if (await assertRecordInScope(scope, spec.name, row)) owned.push(row)
  }
  return owned
}

export async function captureWorkspaceContentRevisionV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
}): Promise<WorkspaceContentRevisionVectorV1> {
  const entries: WorkspaceContentRevisionEntryV1[] = []
  for (const spec of contentRevisionTableSpecsV1()) {
    const rows = (await readRevisionRows(spec, input.scope))
      .filter(row => inWorldGroup(spec, row, input.worldGroupId))
      .sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0))
    entries.push({
      table: spec.name,
      rowCount: rows.length,
      contentHash: await hashCanonicalValue(rows),
    })
  }
  const body = {
    version: 1 as const,
    entries,
  }
  return { ...body, vectorHash: await hashCanonicalValue(vectorBody(body)) }
}

export async function verifyWorkspaceContentRevisionV1(
  frozen: WorkspaceContentRevisionVectorV1,
  input: { scope: WorkspaceScope; worldGroupId: number | null },
): Promise<{ fresh: boolean; current: WorkspaceContentRevisionVectorV1; changedTables: string[] }> {
  const parsed = parseWorkspaceContentRevisionV1(frozen)
  const expectedFrozenHash = await hashCanonicalValue(vectorBody({
    version: parsed.version,
    entries: parsed.entries,
  }))
  if (expectedFrozenHash !== parsed.vectorHash) throw new Error('内容修订向量完整性校验失败')
  const current = await captureWorkspaceContentRevisionV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
  })
  const before = new Map(parsed.entries.map(entry => [entry.table, entry]))
  const changedTables = current.entries
    .filter(entry => {
      const prior = before.get(entry.table)
      return !prior || prior.rowCount !== entry.rowCount || prior.contentHash !== entry.contentHash
    })
    .map(entry => entry.table)
  return {
    fresh: current.vectorHash === parsed.vectorHash && changedTables.length === 0,
    current,
    changedTables,
  }
}

export async function assertWorkspaceContentRevisionFreshV1(
  frozen: WorkspaceContentRevisionVectorV1,
  input: { scope: WorkspaceScope; worldGroupId: number | null },
): Promise<void> {
  const result = await verifyWorkspaceContentRevisionV1(frozen, input)
  if (!result.fresh) {
    throw new Error(`候选生成后项目内容已变化，必须重新生成。变化表：${result.changedTables.join('、') || '未知'}`)
  }
}
