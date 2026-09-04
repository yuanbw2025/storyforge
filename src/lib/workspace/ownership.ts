import { db } from '../db/schema'
import { isWorkspaceUid, isWorkCode } from '../memory/identity'
import type { Project, Work, WorkspaceScope, World } from '../types'
import { isCurrentWorldCode } from './identity'

export interface WorkspaceOwnershipResolution {
  scope: WorkspaceScope
  project: Project
  world: World
  work: Work
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
