import { db } from '../db/schema'
import type { Project } from '../types/project'
import {
  LAST_FOLDER_KEY,
  saveFolderHandle,
  saveProjectFolderHandle,
} from './folder-handle-store'

/**
 * Make one user-selected directory the project's storage workspace.
 *
 * This only persists the browser-granted handle. It intentionally performs no
 * file writes: the first baseline and every later change still go through the
 * memory workspace self-check and explicit author confirmation.
 */
export async function bindProjectStorageWorkspace(
  project: Pick<Project, 'id' | 'workspaceUid'>,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await saveProjectFolderHandle(project, handle)
  await saveFolderHandle(LAST_FOLDER_KEY, handle)
}

/** Bind a directory selected before a project has finished being created. */
export async function bindCreatedProjectStorageWorkspace(
  projectId: number,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('[project-storage] 新项目不存在，无法保存存储位置')
  await bindProjectStorageWorkspace(project, handle)
}
