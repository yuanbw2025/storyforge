/**
 * WORLD-2C C3 · 统一 World/Work 作用域门。
 *
 * 逻辑归属只从 PROJECT_TABLES.domainOwner 派生。这个模块不维护第二份表清单，
 * 也不允许调用方把 AI 返回的 owner id 当成可信输入。
 */
import { resolveExistingWorkspaceScope, resolveWorkspaceScope } from './ownership'
import type { Table } from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { DomainOwnerKind, TableSpec } from '../registry/types'
import type { WorkspaceScope } from '../types/world-ownership'

export type ScopeOwner = Exclude<DomainOwnerKind, 'instance'>

export interface ScopeInput {
  projectId?: number
  scope?: WorkspaceScope
}

export interface ScopeReadOptions {
  owner?: ScopeOwner
}

const LEGACY_READ_OWNER_ID = 0

/** Transitional adapter: callers may still pass the physical project id, but
 * new boundaries should carry the complete World/Work scope. */
export type WorkspaceScopeLike = number | WorkspaceScope

export function asScopeInput(value: WorkspaceScopeLike): ScopeInput {
  return typeof value === 'number' ? { projectId: value } : { scope: value }
}

export function scopeProjectId(value: WorkspaceScopeLike): number {
  return typeof value === 'number' ? value : value.projectId
}

export async function resolveScopeLike(value: WorkspaceScopeLike): Promise<WorkspaceScope> {
  return resolveScope(asScopeInput(value))
}

export async function resolveReadScopeLike(value: WorkspaceScopeLike): Promise<WorkspaceScope> {
  return resolveReadScope(asScopeInput(value))
}

const REGISTRY_BY_NAME = new Map(PROJECT_TABLES.map(spec => [spec.name, spec] as const))

function fail(message: string): never {
  throw new Error(`[scope] ${message}`)
}

export async function resolveScope(input: ScopeInput): Promise<WorkspaceScope> {
  if (input.scope) {
    const scope = input.scope
    if (
      !Number.isInteger(scope.projectId)
      || !Number.isInteger(scope.worldId)
      || !Number.isInteger(scope.workId)
      || scope.projectId <= 0
      || scope.worldId <= 0
      || scope.workId <= 0
    ) {
      fail('WorkspaceScope 必须包含有效的 projectId/worldId/workId')
    }
    if (input.projectId != null && input.projectId !== scope.projectId) {
      fail('projectId 与 WorkspaceScope.projectId 不一致')
    }
    const [project, world, work] = await Promise.all([
      db.projects.get(scope.projectId),
      db.worlds.get(scope.worldId),
      db.works.get(scope.workId),
    ])
    if (!project || world?.projectId !== scope.projectId || work?.projectId !== scope.projectId || work.worldId !== scope.worldId) {
      fail('WorkspaceScope 不是当前工作区的有效 World/Work')
    }
    return scope
  }
  if (input.projectId == null) fail('缺少 projectId 或 WorkspaceScope')
  return resolveWorkspaceScope(input.projectId)
}

/**
 * Read-only scope resolver. Fully migrated workspaces use their real roots;
 * untouched legacy workspaces receive an internal sentinel that can only match
 * rows with no World/Work owner fields. It never performs ownership migration.
 */
export async function resolveReadScope(input: ScopeInput): Promise<WorkspaceScope> {
  if (input.scope) {
    if (!isLegacyReadScope(input.scope)) return resolveScope(input)
    const existing = await resolveExistingWorkspaceScope(input.scope.projectId)
    if (existing) fail('旧项目只读 scope 不能用于已迁移的工作区')
    return input.scope
  }
  if (input.projectId == null) fail('缺少 projectId 或 WorkspaceScope')
  const existing = await resolveExistingWorkspaceScope(input.projectId)
  return existing ?? {
    projectId: input.projectId,
    worldId: LEGACY_READ_OWNER_ID,
    workId: LEGACY_READ_OWNER_ID,
  }
}

export function isLegacyReadScope(scope: WorkspaceScope): boolean {
  return scope.worldId === LEGACY_READ_OWNER_ID && scope.workId === LEGACY_READ_OWNER_ID
}

/** Tables required when a caller invokes a scope-validating write inside its own transaction. */
export function scopeTransactionTables(...tables: Table[]): Table[] {
  return [...new Set([db.projects, db.worlds, db.works, ...tables])]
}

export function getTableSpec(tableName: string): TableSpec {
  const spec = REGISTRY_BY_NAME.get(tableName)
  if (!spec) fail(`目标表 ${tableName} 未登记在 PROJECT_TABLES`)
  return spec
}

function rowProjectId(row: Record<string, unknown>): number | undefined {
  return typeof row.projectId === 'number' ? row.projectId : undefined
}

function scopeValue(scope: WorkspaceScope, owner: ScopeOwner): number | undefined {
  if (owner === 'world') return scope.worldId
  if (owner === 'work') return scope.workId
  return scope.projectId
}

function locatorOwner(spec: TableSpec, requested?: ScopeOwner): ScopeOwner | null {
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace') return null
  if (locator.kind === 'field') {
    return locator.owner === 'instance' ? null : locator.owner
  }
  if (locator.kind === 'exclusive-fields') return requested ?? (spec.domainOwner?.legacyDefault as ScopeOwner)
  if (locator.kind === 'parent') return locator.owner === 'instance' ? null : locator.owner
  // compat-project is retained only for transition diagnostics. C3 callers must not
  // silently treat a whole project as one Work.
  return requested ?? null
}

function directOwnerMatches(spec: TableSpec, row: Record<string, unknown>, scope: WorkspaceScope, requested?: ScopeOwner): boolean {
  // The LocalWorkspace root is the only project-owned row whose physical key
  // is the project identity instead of a projectId column.
  if (spec.name === 'projects') return row.id === scope.projectId
  const physicalProjectId = rowProjectId(row)
  if (
    spec.owner !== 'global'
    && (
      (spec.owner === 'project' || spec.owner === 'transient')
        ? physicalProjectId !== scope.projectId
        : physicalProjectId != null && physicalProjectId !== scope.projectId
    )
  ) return false
  const domain = spec.domainOwner
  if (!domain) return spec.owner === 'global' || rowProjectId(row) === scope.projectId
  const locator = domain.locator
  if (isLegacyReadScope(scope)) {
    if (locator.kind === 'workspace') return rowProjectId(row) === scope.projectId
    if (locator.kind === 'exclusive-fields') {
      return row[locator.worldField] == null && row[locator.workField] == null
    }
    if (locator.kind === 'field') return row[locator.field] == null
    if (locator.kind === 'compat-project') return row.worldId == null && row.workId == null
    // Parent locators are validated recursively by assertRecordInScope().
    return rowProjectId(row) === scope.projectId
  }
  if (locator.kind === 'workspace') return rowProjectId(row) === scope.projectId
  if (locator.kind === 'compat-project') {
    const owner = requested ?? (domain.legacyDefault as ScopeOwner)
    const value = scopeValue(scope, owner)
    const field = owner === 'world' ? 'worldId' : owner === 'work' ? 'workId' : undefined
    return field == null ? rowProjectId(row) === scope.projectId : row[field] === value
  }
  if (locator.kind === 'field') {
    if (locator.owner === 'instance') return false
    return row[locator.field] === scopeValue(scope, locator.owner)
  }
  if (locator.kind === 'exclusive-fields') {
    const hasWorld = row[locator.worldField] != null
    const hasWork = row[locator.workField] != null
    if (hasWorld === hasWork) return false
    const owner = requested ?? (hasWorld ? 'world' : 'work')
    return owner === 'world'
      ? hasWorld && row[locator.worldField] === scope.worldId
      : hasWork && row[locator.workField] === scope.workId
  }
  // Parent locators are validated by assertRecordInScope, after loading the parent.
  return rowProjectId(row) === scope.projectId
}

/**
 * Check one row without trusting any id supplied by a prompt or component.
 * Parent-owned records inherit their scope from the registered parent row.
 */
export async function assertRecordInScope(
  scope: WorkspaceScope,
  tableName: string,
  row: unknown,
  options: ScopeReadOptions = {},
): Promise<boolean> {
  if (!row || typeof row !== 'object') return false
  const record = row as Record<string, unknown>
  const spec = getTableSpec(tableName)
  if (spec.owner === 'global') return true
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'parent') {
    const parentSpec = getTableSpec(locator.table)
    const parentId = record[locator.field]
    if (parentId == null) return false
    const parent = await parentSpec.table.get(parentId as number)
    return !!parent && await assertRecordInScope(scope, parentSpec.name, parent, { owner: options.owner })
  }
  return directOwnerMatches(spec, record, scope, options.owner)
}

/** Read only rows owned by the supplied scope. No component should hand-roll this filter. */
export async function readOwnedRows<T = Record<string, unknown>>(
  scope: WorkspaceScope,
  tableName: string,
  options: ScopeReadOptions = {},
): Promise<T[]> {
  const spec = getTableSpec(tableName)
  if (spec.owner === 'global') return spec.table.toArray() as Promise<T[]>
  // The current schema keeps projectId on physical rows. Filtering in memory here is
  // intentional until each domain table receives a dedicated owner index; correctness
  // takes precedence over an unsafe project-wide query.
  const rows = spec.owner === 'project' || spec.owner === 'transient'
    ? await spec.table.where('projectId').equals(scope.projectId).toArray()
    : await spec.table.toArray()
  const owned: T[] = []
  for (const row of rows as Record<string, unknown>[]) {
    if (await assertRecordInScope(scope, tableName, row, options)) owned.push(row as T)
  }
  return owned
}

/** Stamp a new row from trusted scope. Existing owner ids must agree or the write fails closed. */
export function stampNewRecord<T>(
  scope: WorkspaceScope,
  tableName: string,
  input: T,
  options: ScopeReadOptions = {},
): T {
  if (isLegacyReadScope(scope)) fail(`${tableName} 不得使用只读兼容 scope 写入`)
  const spec = getTableSpec(tableName)
  const result: Record<string, unknown> = { ...(input as Record<string, unknown>), projectId: scope.projectId }
  const owner = locatorOwner(spec, options.owner)
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace' || owner == null) {
    if (result.worldId != null || result.workId != null) fail(`${tableName} 不允许携带 World/Work owner`)
    return result as T
  }
  if (locator.kind === 'exclusive-fields') {
    const selected = owner === 'world' ? 'worldId' : 'workId'
    const other = selected === 'worldId' ? 'workId' : 'worldId'
    if (result[selected] != null && result[selected] !== scopeValue(scope, owner)) fail(`${tableName}.${selected} 越过当前 scope`)
    if (result[other] != null) fail(`${tableName} 不能同时绑定 World 和 Work`)
    result[selected] = scopeValue(scope, owner)
    result[other] = null
  } else if (locator.kind === 'field' || locator.kind === 'compat-project') {
    const field = locator.kind === 'field' ? locator.field : owner === 'world' ? 'worldId' : 'workId'
    const expected = scopeValue(scope, owner)
    if (result[field] != null && result[field] !== expected) fail(`${tableName}.${field} 越过当前 scope`)
    result[field] = expected
  }
  return result as T
}

export function assertScopedForeignKey(
  scope: WorkspaceScope,
  tableName: string,
  row: unknown,
  options?: ScopeReadOptions,
): Promise<boolean> {
  return assertRecordInScope(scope, tableName, row, options)
}
