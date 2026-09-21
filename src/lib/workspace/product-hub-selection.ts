import { isWorkspaceUid } from '../memory/identity'
import type { Project, WorkspacePurpose } from '../types/project'
import {
  resolveWorkspaceOwnership,
  WorkspaceOwnershipError,
} from './ownership'

export const PRODUCT_HUB_WORLD_WORKSPACE_PARAM_V1 = 'worldWorkspace'
export const PRODUCT_HUB_WORK_WORKSPACE_PARAM_V1 = 'workWorkspace'

export interface ProductHubRejectedWorkspaceV1 {
  projectId: number
  workspaceUid: string
  code: string
}

export interface ProductHubWorkspaceCatalogV1 {
  worldProjects: Project[]
  workProjects: Project[]
  rejected: ProductHubRejectedWorkspaceV1[]
}

function rejectedWorkspace(
  project: Project & { id: number },
  error: WorkspaceOwnershipError,
): ProductHubRejectedWorkspaceV1 {
  return {
    projectId: project.id,
    workspaceUid: project.workspaceUid,
    code: error.code,
  }
}

/**
 * Builds the ProductHub catalog from the current Project root contract.
 *
 * The supplied rows only establish stable identity and ordering. Every
 * selectable workspace is re-read through the ownership resolver, so a stale
 * snapshot, deleted Project, foreign Work pointer, or mismatched World/Work
 * pair can never become a product scope.
 */
export async function loadProductHubWorkspaceCatalogV1(
  projects: readonly Project[],
): Promise<ProductHubWorkspaceCatalogV1> {
  const checked = await Promise.all(projects.map(async snapshot => {
    if (snapshot.id == null) return null
    const project = snapshot as Project & { id: number }
    try {
      const ownership = await resolveWorkspaceOwnership(project.id)
      if (ownership.project.workspaceUid !== project.workspaceUid) {
        throw new WorkspaceOwnershipError(
          'WORKSPACE_SELECTION_STALE',
          '工作区稳定身份已变化',
        )
      }
      return { project: ownership.project, rejected: null }
    } catch (error) {
      if (!(error instanceof WorkspaceOwnershipError)) throw error
      return { project: null, rejected: rejectedWorkspace(project, error) }
    }
  }))

  const valid = checked.flatMap(row => row?.project ? [row.project] : [])
  return {
    worldProjects: valid.filter(project => project.workspacePurpose === 'world-engine'),
    workProjects: valid.filter(project => project.workspacePurpose === 'independent-work'),
    rejected: checked.flatMap(row => row?.rejected ? [row.rejected] : []),
  }
}

export function resolveProductHubWorkspaceSelectionV1(
  projects: readonly Project[],
  requestedWorkspaceUid: string | null,
): Project | undefined {
  const requested = isWorkspaceUid(requestedWorkspaceUid)
    ? projects.find(project => project.workspaceUid === requestedWorkspaceUid)
    : undefined
  return requested ?? projects[0]
}

export function updateProductHubWorkspaceQueryV1(
  current: URLSearchParams,
  purpose: WorkspacePurpose,
  workspaceUid: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current)
  const key = purpose === 'world-engine'
    ? PRODUCT_HUB_WORLD_WORKSPACE_PARAM_V1
    : PRODUCT_HUB_WORK_WORKSPACE_PARAM_V1
  if (workspaceUid == null) next.delete(key)
  else {
    if (!isWorkspaceUid(workspaceUid)) throw new Error('[product-hub-selection] workspaceUid 无效')
    next.set(key, workspaceUid)
  }
  return next
}
