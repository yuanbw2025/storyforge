/**
 * Headless comparison contract only. This module neither reads candidates nor
 * grants execution/adoption or access to another Work. Callers must bind actual
 * adopter targets, source evidence and atomic admission before using its result.
 */
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { ADOPTION_BY_TARGET } from '../registry/adoption-schema'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type { WorkspaceScope } from '../types/world-ownership'

export type CandidateTargetIdentityV1 =
  | { kind: 'record'; recordId: number }
  | { kind: 'singleton'; recordId?: number }
  | { kind: 'create'; intentId: string }
  | { kind: 'possible-records'; recordIds: readonly number[]; reason: string }
  | { kind: 'unknown'; reason: string }

export interface CandidateTargetWriteV1 {
  table: string
  /** Defaults to the registered owner; never inferred from the producing Run. */
  owner?: 'workspace' | 'world' | 'work'
  target: CandidateTargetIdentityV1
  /** Segment arrays, not dotted strings. An object update replaces its root. */
  paths: readonly (readonly string[])[]
  semantics: 'patch' | 'record-replace'
}

export interface CandidateTargetFootprintV1 {
  version: 1
  /** Producer identity stays separate from the normalized formal write owner. */
  scope: WorkspaceScope
  worldGroupId: number | null
  writes: readonly CandidateTargetWriteV1[]
}

export interface NormalizedCandidateTargetWriteV1 {
  table: string
  owner: 'workspace' | 'world' | 'work'
  projectId: number
  ownerId: number
  worldGroupId: number | null
  target: CandidateTargetIdentityV1
  paths: readonly (readonly string[])[]
  semantics: 'patch' | 'record-replace'
}

export interface CandidateTargetConflictV1 {
  requestedIndex: number
  pendingIndex: number
  table: string
  kind: 'field-overlap' | 'record-replace' | 'uncertain-target'
  requestedPath: readonly string[]
  pendingPath: readonly string[]
}

export class CandidateTargetContractErrorV1 extends Error {
  constructor(message: string) {
    super(`[candidate-target-scope] ${message}`)
    this.name = 'CandidateTargetContractErrorV1'
  }
}

function fail(message: string): never { throw new CandidateTargetContractErrorV1(message) }

function record(value: unknown, keys: readonly string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('必须是对象')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))
    || required.some(key => !Object.prototype.hasOwnProperty.call(result, key))) {
    fail('包含未知字段或缺少必要字段')
  }
  return result
}

function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('身份必须是正安全整数')
  return value
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) fail('身份或原因不能为空或超过512字符')
  return value
}

function identity(value: unknown): CandidateTargetIdentityV1 {
  const raw = record(value, ['kind', 'recordId', 'intentId', 'recordIds', 'reason'], ['kind'])
  switch (raw.kind) {
    case 'record':
      record(raw, ['kind', 'recordId'])
      return { kind: 'record', recordId: id(raw.recordId) }
    case 'singleton':
      record(raw, ['kind', 'recordId'], ['kind'])
      return { kind: 'singleton', ...(raw.recordId === undefined ? {} : { recordId: id(raw.recordId) }) }
    case 'create':
      record(raw, ['kind', 'intentId'])
      return { kind: 'create', intentId: text(raw.intentId) }
    case 'possible-records': {
      record(raw, ['kind', 'recordIds', 'reason'])
      if (!Array.isArray(raw.recordIds) || !raw.recordIds.length) fail('可能记录范围不能为空')
      const recordIds = [...new Set(raw.recordIds.map(id))].sort((a, b) => a - b)
      return { kind: 'possible-records', recordIds, reason: text(raw.reason) }
    }
    case 'unknown':
      record(raw, ['kind', 'reason'])
      return { kind: 'unknown', reason: text(raw.reason) }
    default: return fail('未知目标身份版本或类型')
  }
}

/** Pure identity algebra, including already bound stable creation intents.
 * A distinct intent is NOT proof that a name/composite upsert creates new rows.
 * The registry normalizer below deliberately does not manufacture that proof.
 */
export function candidateTargetIdentitiesOverlapV1(
  left: CandidateTargetIdentityV1,
  right: CandidateTargetIdentityV1,
): boolean {
  const a = identity(left)
  const b = identity(right)
  if (a.kind === 'unknown' || b.kind === 'unknown') return true
  if (a.kind === 'singleton' && b.kind === 'singleton') return true
  if (a.kind === 'create' && b.kind === 'create') return a.intentId === b.intentId
  // A bound create cannot mutate an existing record. Unbound creates are
  // normalized to unknown before registered footprint comparison.
  if (a.kind === 'create' || b.kind === 'create') return false
  const ids = (target: typeof a): readonly number[] | undefined => (
    target.kind === 'record' ? [target.recordId]
      : target.kind === 'possible-records' ? target.recordIds
        : target.kind === 'singleton' && target.recordId !== undefined ? [target.recordId] : undefined
  )
  const leftIds = ids(a)
  const rightIds = ids(b)
  return !leftIds || !rightIds || leftIds.some(value => rightIds.includes(value))
}

export function candidateTargetPathsOverlapV1(left: readonly string[], right: readonly string[]): boolean {
  const valid = (path: readonly string[]) => Array.isArray(path) && path.length > 0
    && path.every(part => typeof part === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(part)
      && !['constructor', 'prototype', '__proto__'].includes(part))
  if (!valid(left) || !valid(right)) fail('字段路径必须是非空合法片段数组')
  return left.slice(0, Math.min(left.length, right.length)).every((part, index) => part === right[index])
}

/** Validate registered writable fields and owner shape, without DB reads or
 * owner authority. This does not validate aiGeneration or adoption writePolicy
 * permissions; those remain the actual caller/adopter's responsibility.
 * Unknown is bounded to this table, actual owner/group and nonempty field set.
 * Current adoption metadata does not attest stable-create idempotency: such
 * inputs remain conservative until a real adopter binding is separately added.
 */
export function normalizeCandidateTargetFootprintV1(value: unknown): readonly NormalizedCandidateTargetWriteV1[] {
  const raw = record(value, ['version', 'scope', 'worldGroupId', 'writes'])
  if (raw.version !== 1) fail('只支持version=1')
  const scope = record(raw.scope, ['projectId', 'worldId', 'workId'])
  const projectId = id(scope.projectId)
  const worldId = id(scope.worldId)
  const workId = id(scope.workId)
  const worldGroupId = raw.worldGroupId === null ? null : id(raw.worldGroupId)
  if (!Array.isArray(raw.writes) || !raw.writes.length) fail('写入范围必须非空；只读动作不得伪装为待写候选')
  return raw.writes.map(item => {
    const write = record(item, ['table', 'owner', 'target', 'paths', 'semantics'], ['table', 'target', 'paths', 'semantics'])
    const table = text(write.table)
    const spec = REGISTRY_BY_NAME.get(table)
    const fields = FIELD_BY_TARGET.get(table)
    if (!spec?.domainOwner || !fields?.length) fail(`目标表${table}没有登记归属或正式可写字段`)
    const owner = write.owner ?? spec.domainOwner.defaultOwner
    if ((owner !== 'workspace' && owner !== 'world' && owner !== 'work') || !spec.domainOwner.allowed.includes(owner)) {
      fail(`目标表${table}不允许该owner`)
    }
    const locator = spec.domainOwner.locator
    if (locator.kind === 'parent' || locator.kind === 'exclusive-work-instance'
      || (locator.kind === 'field' && locator.owner !== owner)) {
      fail('间接或实例归属需要实际领域适配器，不能从生产Run推定')
    }
    if (write.semantics !== 'patch' && write.semantics !== 'record-replace') fail('缺少实际写入语义')
    if (!Array.isArray(write.paths) || !write.paths.length) fail('写字段集合必须非空')
    const paths: string[][] = []
    for (const path of write.paths) {
      candidateTargetPathsOverlapV1(path, path)
      const field = fields.find(candidate => candidate.field === path[0])
      if (!field) fail(`未登记字段${table}.${path[0]}`)
      if (path.length > 1 && !['object', 'json', 'array'].includes(field.type)) fail('标量字段没有子路径写权限')
      // Generic adopt updates top-level object/JSON/array values, not subpaths.
      // textReplacement.paths describes author edits, not AI patch authority.
      if (!paths.some(existing => existing[0] === path[0])) paths.push([path[0]])
    }
    paths.sort((a, b) => a[0].localeCompare(b[0]))
    let target = identity(write.target)
    if (target.kind === 'create') {
      const adoption = ADOPTION_BY_TARGET.get(table)
      if (!adoption || adoption.recordOnly) fail('该目标没有登记集合创建能力')
      target = { kind: 'unknown', reason: '登记的集合创建权限不能证明稳定意图幂等；须绑定实际adopter及lookup范围' }
    }
    return {
      table, owner, projectId,
      ownerId: owner === 'world' ? worldId : owner === 'work' ? workId : projectId,
      worldGroupId: spec.worldScoped ? worldGroupId : null,
      target, paths, semantics: write.semantics,
    }
  })
}

/** Returns every intersection; never treats a malformed/unknown plan as empty. */
export function compareCandidateTargetFootprintsV1(
  requested: CandidateTargetFootprintV1,
  pending: CandidateTargetFootprintV1,
): readonly CandidateTargetConflictV1[] {
  const left = normalizeCandidateTargetFootprintV1(requested)
  const right = normalizeCandidateTargetFootprintV1(pending)
  const conflicts: CandidateTargetConflictV1[] = []
  left.forEach((a, requestedIndex) => right.forEach((b, pendingIndex) => {
    if (a.table !== b.table || a.projectId !== b.projectId || a.owner !== b.owner
      || a.ownerId !== b.ownerId || a.worldGroupId !== b.worldGroupId
      || !candidateTargetIdentitiesOverlapV1(a.target, b.target)) return
    const replaces = a.semantics === 'record-replace' || b.semantics === 'record-replace'
    for (const requestedPath of a.paths) for (const pendingPath of b.paths) {
      if (!replaces && !candidateTargetPathsOverlapV1(requestedPath, pendingPath)) continue
      conflicts.push({ requestedIndex, pendingIndex, table: a.table, requestedPath, pendingPath,
        kind: a.target.kind === 'unknown' || b.target.kind === 'unknown'
          ? 'uncertain-target' : replaces ? 'record-replace' : 'field-overlap' })
    }
  }))
  return conflicts
}
