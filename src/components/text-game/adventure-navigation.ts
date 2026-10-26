import type { WorkspaceScope } from '../../lib/types'

const LAST_WORKSPACE = 'storyforge.text-adventure.last-workspace'

/** A navigation preference only; the page must validate all IDs against current ownership. */
export function readAdventureWorkspace(): WorkspaceScope | null {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_WORKSPACE) ?? 'null') as WorkspaceScope | null
    return value && [value.projectId, value.worldId, value.workId].every(id => Number.isSafeInteger(id) && id > 0)
      ? { projectId: value.projectId, worldId: value.worldId, workId: value.workId } : null
  } catch { return null }
}

export function rememberAdventureWorkspace(scope: WorkspaceScope | null): void {
  try {
    if (scope) localStorage.setItem(LAST_WORKSPACE, JSON.stringify(scope))
    else localStorage.removeItem(LAST_WORKSPACE)
  } catch { /* Navigation still works when browser preferences are unavailable. */ }
}
