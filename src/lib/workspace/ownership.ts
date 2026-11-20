import { db } from '../db/schema'
import Dexie, { type Table, type Transaction } from 'dexie'
import { isWorkspaceUid, isWorkCode } from '../memory/identity'
import type { Project, Work, WorkspaceScope, World, WorldOwnerScope } from '../types'
import { copyHistoryAuthorOriginV1 } from '../types/history'
import { isCurrentWorldCode } from './identity'

export interface WorkspaceOwnershipResolution {
  scope: WorkspaceScope
  project: Project
  world: World
  work: Work
}

export interface WorldAuthoringOwnershipResolutionV1 {
  scope: WorldOwnerScope
  project: Project
  world: World
}

/** New World authoring is deliberately narrower than generic World domain helpers.
 * Callers that write invoke this inside their native write transaction. */
export function resolveWorldAuthoringOwnershipV1(input: WorldOwnerScope, transaction?: Transaction): Promise<WorldAuthoringOwnershipResolutionV1> {
  try {
    const origin = copyHistoryAuthorOriginV1({ version: 1, kind: 'world', scope: input })
    const scope = origin.scope
    const read = historyAuthorRootReaderV1(transaction)
    return read(db.projects).get(scope.projectId).then(project => read(db.worlds).get(scope.worldId).then(world => {
      if (!project || !isWorkspaceUid(project.workspaceUid) || project.workspacePurpose !== 'world-engine') {
        fail('WORLD_AUTHORING_PROJECT_INVALID', 'World 作者入口需要有效的世界引擎工作区')
      }
      if (!world || world.projectId !== project.id || world.id !== scope.worldId
        || world.identityKind !== 'world-draft' || !isCurrentWorldCode(world.identityKind, world.code)) {
        fail('WORLD_AUTHORING_ROOT_INVALID', 'World 作者入口需要该工作区的有效世界草稿')
      }
      return { scope, project, world }
    }))
  } catch (error) { return Dexie.Promise.reject(error) }
}

/** Validate the explicitly selected Work, never whichever Work is active later.
 * This is additive; the existing Work ownership resolver remains unchanged. */
export function resolveHistoryWorkAuthorScopeV1(input: WorkspaceScope, transaction?: Transaction): Promise<WorkspaceScope> {
  try {
    const origin = copyHistoryAuthorOriginV1({ version: 1, kind: 'work', scope: input })
    if (origin.kind !== 'work') throw new Error('历史 Work 作者入口无效')
    const scope = origin.scope
    const read = historyAuthorRootReaderV1(transaction)
    return read(db.projects).get(scope.projectId).then(project => read(db.worlds).get(scope.worldId).then(world =>
      read(db.works).get(scope.workId).then(work => {
        if (!project || !isWorkspaceUid(project.workspaceUid) || !world || world.projectId !== project.id
          || !isCurrentWorldCode(world.identityKind, world.code)
          || (project.workspacePurpose === 'world-engine' ? world.identityKind !== 'world-draft'
            : project.workspacePurpose !== 'independent-work' || world.identityKind !== 'workspace-scope')
          || !work || work.projectId !== project.id || work.worldId !== world.id || !isWorkCode(work.code)) {
          fail('HISTORY_WORK_AUTHOR_INVALID', '历史作者入口需要真实且身份有效的 World/Work')
        }
        return scope
      })))
  } catch (error) { return Dexie.Promise.reject(error) }
}

/** The two additive author validators share their existing rules. Only their
 * table transport opts into an already active native transaction. */
function historyAuthorRootReaderV1(transaction?: Transaction) {
  const native = transaction?.idbtrans
  return <T>(table: Table<T, number>): Table<T, number> => {
    if (!transaction) return table
    let root = transaction
    while (root.parent) root = root.parent
    if (transaction.db !== db || !transaction.active || !native || transaction.idbtrans !== native
      || !root.active || root.idbtrans !== native
      || !transaction.storeNames.includes(table.name) || !native.objectStoreNames.contains(table.name)) {
      throw new Error('历史作者根读取的原事务已失效或缺少作用域表')
    }
    return transaction.table<T, number>(table.name)
  }
}

export class WorkspaceOwnershipError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'WorkspaceOwnershipError'
  }
}

const inFlightResolutions = new Map<number, Promise<WorkspaceOwnershipResolution>>()

function fail(code: string, message: string): never {
  throw new WorkspaceOwnershipError(code, message)
}

async function resolveCurrentWorkspaceOwnership(
  projectId: number,
): Promise<WorkspaceOwnershipResolution> {
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    fail('WORKSPACE_ID_INVALID', '本地工作区 ID 无效')
  }
  const project = await db.projects.get(projectId)
  if (!project) fail('WORKSPACE_NOT_FOUND', `本地工作区 ${projectId} 不存在`)
  if (!isWorkspaceUid(project.workspaceUid)) {
    fail('WORKSPACE_IDENTITY_INVALID', '本地工作区缺少当前格式的稳定身份')
  }
  if (project.workspacePurpose !== 'independent-work' && project.workspacePurpose !== 'world-engine') {
    fail('WORKSPACE_PURPOSE_INVALID', '本地工作区缺少明确产品用途')
  }
  if (project.activeWorldId == null || project.activeWorkId == null) {
    fail('WORKSPACE_ROOTS_MISSING', '本地工作区缺少当前 World/Work 根')
  }

  const [world, work] = await Promise.all([
    db.worlds.get(project.activeWorldId),
    db.works.get(project.activeWorkId),
  ])
  if (!world || world.projectId !== projectId) {
    fail('WORLD_ROOT_INVALID', '当前 World 根不存在或不属于本地工作区')
  }
  if (world.identityKind !== 'workspace-scope' && world.identityKind !== 'world-draft') {
    fail('WORLD_IDENTITY_INVALID', '当前 World 根缺少明确身份')
  }
  if (!isCurrentWorldCode(world.identityKind, world.code)) {
    fail('WORLD_CODE_INVALID', '当前 World 根缺少当前格式的稳定身份')
  }
  if (!work || work.projectId !== projectId || work.worldId !== world.id) {
    fail('WORK_ROOT_INVALID', '当前 Work 根不存在、越界或未绑定当前 World')
  }
  if (!isWorkCode(work.code)) fail('WORK_IDENTITY_INVALID', '当前 Work 缺少稳定身份')
  if (project.workspacePurpose === 'world-engine' && world.identityKind !== 'world-draft') {
    fail('WORKSPACE_WORLD_MISMATCH', '世界引擎工作区必须绑定可发布的 world-draft')
  }
  if (project.workspacePurpose === 'independent-work' && world.identityKind !== 'workspace-scope') {
    fail('WORKSPACE_WORLD_MISMATCH', '独立作品工作区只能绑定内部 workspace-scope')
  }

  return {
    scope: { projectId, worldId: world.id!, workId: work.id! },
    project,
    world,
    work,
  }
}

/** Resolve only the current architecture. Missing or malformed roots fail closed. */
export function resolveWorkspaceOwnership(projectId: number): Promise<WorkspaceOwnershipResolution> {
  const existing = inFlightResolutions.get(projectId)
  if (existing) return existing
  const pending = resolveCurrentWorkspaceOwnership(projectId)
    .finally(() => inFlightResolutions.delete(projectId))
  inFlightResolutions.set(projectId, pending)
  return pending
}

export async function resolveWorkspaceScope(projectId: number): Promise<WorkspaceScope> {
  return (await resolveWorkspaceOwnership(projectId)).scope
}

export function hasCurrentWorkspaceOwnership(project: Project): boolean {
  return isWorkspaceUid(project.workspaceUid)
    && (project.workspacePurpose === 'independent-work' || project.workspacePurpose === 'world-engine')
    && project.activeWorldId != null
    && project.activeWorkId != null
}
