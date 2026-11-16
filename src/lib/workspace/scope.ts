/**
 * 统一 Workspace/World/Work 作用域门。
 *
 * 逻辑归属只从 PROJECT_TABLES.domainOwner 派生。这个模块不维护第二份表清单，
 * 也不允许调用方把 AI 返回的 owner id 当成可信输入。
 */
import { resolveWorkspaceScope } from './ownership'
import type { Table } from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { DomainOwnerKind, TableSpec } from '../registry/types'
import type { WorkspaceScope, WorldOwnerScope } from '../types/world-ownership'
import { isWorkspaceUid } from '../memory/identity'
import { isCurrentWorldCode } from './identity'
import { stampResourceIdentityV1 } from '../context-gateway/resource-uid'

export type ScopeOwner = Exclude<DomainOwnerKind, 'instance'>

export interface ScopeInput {
  projectId?: number
  scope?: WorkspaceScope
}

export interface ScopeReadOptions {
  owner?: ScopeOwner
}

/** Public convenience input. A physical project id is always resolved to the
 * current World/Work roots before any data is read or written. */
export type WorkspaceScopeLike = number | WorkspaceScope
export type WorldOwnerScopeLike = number | WorldOwnerScope

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

/** Resolve only a genuine World owner. Explicit owners never follow active Work/World pointers. */
export async function resolveWorldOwnerScopeLike(value: WorldOwnerScopeLike): Promise<WorldOwnerScope> {
  const projectId = typeof value === 'number' ? value : value.projectId
  if (!Number.isSafeInteger(projectId) || projectId < 1) fail('World owner 缺少有效的 projectId')
  const project = await db.projects.get(projectId)
  if (!project || !isWorkspaceUid(project.workspaceUid)) fail('World owner 对应的工作区身份无效')
  const worldId = typeof value === 'number' ? project.activeWorldId : value.worldId
  if (worldId == null || !Number.isSafeInteger(worldId) || worldId < 1) fail('World owner 缺少有效的 worldId')
  const world = await db.worlds.get(worldId)
  if (!world || world.projectId !== projectId || !isCurrentWorldCode(world.identityKind, world.code)
    || (project.workspacePurpose === 'world-engine' ? world.identityKind !== 'world-draft'
      : project.workspacePurpose !== 'independent-work' || world.identityKind !== 'workspace-scope')) {
    fail('World owner 不是工作区中有效的世界')
  }
  return { projectId, worldId }
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

/** Reads and writes share the same current scope contract; there is no
 * project-only or pre-cutover database path. */
export async function resolveReadScope(input: ScopeInput): Promise<WorkspaceScope> {
  return resolveScope(input)
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

function scopeValue(scope: WorldOwnerScope, owner: ScopeOwner): number | undefined {
  if (owner === 'world') return scope.worldId
  if (owner === 'work') return 'workId' in scope && typeof scope.workId === 'number' ? scope.workId : undefined
  return scope.projectId
}

function locatorOwner(spec: TableSpec, requested?: ScopeOwner): ScopeOwner | null {
  const locator = spec.domainOwner?.locator
  if (!locator || locator.kind === 'workspace') return null
  if (locator.kind === 'field') {
    return locator.owner === 'instance' ? null : locator.owner
  }
  if (locator.kind === 'exclusive-fields') return requested ?? (spec.domainOwner?.defaultOwner as ScopeOwner)
  if (locator.kind === 'exclusive-work-instance') return 'work'
  if (locator.kind === 'parent') {
    if (locator.owner === 'inherit') return requested ?? (spec.domainOwner?.defaultOwner as ScopeOwner)
    return locator.owner === 'instance' ? null : locator.owner
  }
  return requested ?? null
}

function directOwnerMatches(spec: TableSpec, row: Record<string, unknown>, scope: WorldOwnerScope, requested?: ScopeOwner): boolean {
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
  if (locator.kind === 'workspace') return rowProjectId(row) === scope.projectId
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
      : hasWork && row[locator.workField] === scopeValue(scope, 'work')
  }
  if (locator.kind === 'exclusive-work-instance') {
    const hasWork = row[locator.workField] != null
    const hasInstance = row[locator.instanceField] != null
    return hasWork !== hasInstance
      && hasWork
      && row[locator.workField] === scopeValue(scope, 'work')
      && (requested == null || requested === 'work')
  }
  // Parent locators are validated by assertRecordInScope, after loading the parent.
  return rowProjectId(row) === scope.projectId
}

/** World-only scopes may enter only an explicitly requested, registered World owner. */
function assertOwnerScope(scope: WorldOwnerScope, spec: TableSpec, options: ScopeReadOptions): void {
  if ('workId' in scope && typeof scope.workId === 'number' && Number.isSafeInteger(scope.workId) && scope.workId > 0) return
  if (!Number.isSafeInteger(scope.projectId) || scope.projectId < 1 || !Number.isSafeInteger(scope.worldId) || scope.worldId < 1
    || options.owner !== 'world' || !spec.domainOwner?.allowed.includes('world') || locatorOwner(spec, 'world') !== 'world') {
    fail(`${spec.name} 需要真实 Work 作用域；World owner 仅允许显式的世界操作`)
  }
}

/**
 * Check one row without trusting any id supplied by a prompt or component.
 * Parent-owned records inherit their scope from the registered parent row.
 */
export function assertRecordInScope(scope: WorkspaceScope, tableName: string, row: unknown, options?: ScopeReadOptions): Promise<boolean>
export function assertRecordInScope(scope: WorldOwnerScope, tableName: string, row: unknown, options: ScopeReadOptions & { owner: 'world' }): Promise<boolean>
export function assertRecordInScope(scope: WorldOwnerScope, tableName: string, row: unknown, options: ScopeReadOptions = {}): Promise<boolean> {
  return recordInScope(scope, tableName, row, options)
}

async function recordInScope(
  scope: WorldOwnerScope,
  tableName: string,
  row: unknown,
  options: ScopeReadOptions = {},
): Promise<boolean> {
  const spec = getTableSpec(tableName)
  assertOwnerScope(scope, spec, options)
  if (!row || typeof row !== 'object') return false
  const record = row as Record<string, unknown>
  if (spec.owner === 'global') return true
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'parent') {
    const parentSpec = getTableSpec(locator.table)
    const parentId = record[locator.field]
    if (parentId == null) return false
    const parent = await parentSpec.table.get(parentId as number)
    return !!parent && await recordInScope(scope, parentSpec.name, parent, { owner: options.owner })
  }
  return directOwnerMatches(spec, record, scope, options.owner)
}

/** Read only rows owned by the supplied scope. No component should hand-roll this filter. */
export function readOwnedRows<T = Record<string, unknown>>(scope: WorkspaceScope, tableName: string, options?: ScopeReadOptions): Promise<T[]>
export function readOwnedRows<T = Record<string, unknown>>(scope: WorldOwnerScope, tableName: string, options: ScopeReadOptions & { owner: 'world' }): Promise<T[]>
export async function readOwnedRows<T = Record<string, unknown>>(
  scope: WorldOwnerScope,
  tableName: string,
  options: ScopeReadOptions = {},
): Promise<T[]> {
  const spec = getTableSpec(tableName)
  assertOwnerScope(scope, spec, options)
  if (spec.owner === 'global') return spec.table.toArray() as Promise<T[]>
  // The current schema keeps projectId on physical rows. Filtering in memory here is
  // intentional until each domain table receives a dedicated owner index; correctness
  // takes precedence over an unsafe project-wide query.
  const rows = spec.owner === 'project' || spec.owner === 'transient'
    ? await spec.table.where('projectId').equals(scope.projectId).toArray()
    : await spec.table.toArray()
  // Keep this to one awaited Promise while callers may be inside a Dexie
  // transaction. Most direct-owner checks resolve without issuing another IDB
  // request; awaiting them one by one can let a browser auto-commit a large
  // transaction before the caller performs its write.
  const records = rows as Record<string, unknown>[]
  const ownership = await Promise.all(records.map(row => (
    recordInScope(scope, tableName, row, options)
  )))
  return records.filter((_, index) => ownership[index]) as T[]
}

/** Stamp a new row from trusted scope. Existing owner ids must agree or the write fails closed. */
export function stampNewRecord<T>(scope: WorkspaceScope, tableName: string, input: T, options?: ScopeReadOptions): T
export function stampNewRecord<T>(scope: WorldOwnerScope, tableName: string, input: T, options: ScopeReadOptions & { owner: 'world' }): T
export function stampNewRecord<T>(
  scope: WorldOwnerScope,
  tableName: string,
  input: T,
  options: ScopeReadOptions = {},
): T {
  const spec = getTableSpec(tableName)
  assertOwnerScope(scope, spec, options)
  const result: Record<string, unknown> = { ...(input as Record<string, unknown>), projectId: scope.projectId }
  stampResourceIdentityV1(spec, result)
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
  } else if (locator.kind === 'exclusive-work-instance') {
    if (owner !== 'work') fail(`${tableName} 通用 scope 只能创建 Work-owned 记录`)
    if (result[locator.workField] != null && result[locator.workField] !== scopeValue(scope, 'work')) {
      fail(`${tableName}.${locator.workField} 越过当前 scope`)
    }
    if (result[locator.instanceField] != null) fail(`${tableName} 不能同时绑定 Work 和运行实例`)
    result[locator.workField] = scopeValue(scope, 'work')
    result[locator.instanceField] = null
  } else if (locator.kind === 'field') {
    const field = locator.field
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
