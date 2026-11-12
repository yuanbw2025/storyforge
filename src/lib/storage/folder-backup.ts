/**
 * 本地文件夹备份/恢复（FB-11 数据持久层）
 *
 * 纯逻辑层（不含 React），便于测试。负责:
 *   · 选择文件夹 / 校验授权（File System Access API）
 *   · 在用户明确点击后，把某项目的完整数据写成 JSON 恢复快照
 *   · 从文件夹读回所有 storyforge-*.json（首页「从本地文件夹恢复」用）
 *
 * 句柄持久化在 folder-handle-store.ts（独立 IndexedDB），与本模块配合。
 */
import { exportProjectJSON, type ProjectExportData } from '../export/json-export'
import { inspectProjectBackup } from '../export/backup-trust'
import { db } from '../db/schema'
import { isWorkspaceUid } from '../memory/identity'

interface WindowWithFSA extends Window {
  showDirectoryPicker?: (opts?: {
    mode?: 'read' | 'readwrite'
    id?: string
    startIn?: FileSystemDirectoryHandle
  }) => Promise<FileSystemDirectoryHandle>
}

export interface PickFolderOptions {
  /** Lets the browser remember the last picker location for this purpose. */
  id?: string
  /** Opens a relocation picker at the currently bound project folder when supported. */
  startIn?: FileSystemDirectoryHandle
}

/** 浏览器是否支持 File System Access API（仅 Chrome/Edge 等） */
export function isFSASupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** 弹出系统选择框让用户挑一个文件夹（readwrite）。取消返回 null，其它失败交由入口提示。 */
export async function pickFolder(options: PickFolderOptions = {}): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as WindowWithFSA).showDirectoryPicker
  if (!picker) return null
  try {
    return await picker({ mode: 'readwrite', ...options })
  } catch (err) {
    const e = err as { name?: string }
    if (e?.name === 'AbortError') return null
    throw err
  }
}

/** 已授权才返回 true，**不弹窗**（用于启动期静默判断能否自动写/读）。 */
export async function folderPermissionGranted(
  handle: FileSystemDirectoryHandle,
  write = true,
): Promise<boolean> {
  try {
    const opts = { mode: write ? 'readwrite' : 'read' }
    // queryPermission 尚未进 lib.dom 标准类型
    const permissionHandle = handle as unknown as {
      queryPermission?: (o: object) => Promise<string>
      requestPermission?: (o: object) => Promise<string>
    }
    // OPFS directory handles are already origin-authorized and intentionally
    // expose neither permission method. External picker handles expose them.
    if (!permissionHandle.queryPermission && !permissionHandle.requestPermission) return true
    const q = await permissionHandle.queryPermission?.(opts)
    return q === 'granted'
  } catch {
    return false
  }
}

/** 校验并在需要时**弹窗请求**授权（须在用户手势内调用）。返回是否已授权。 */
export async function ensureFolderPermission(
  handle: FileSystemDirectoryHandle,
  write = true,
): Promise<boolean> {
  try {
    const opts = { mode: write ? 'readwrite' : 'read' }
    const h = handle as unknown as {
      queryPermission?: (o: object) => Promise<string>
      requestPermission?: (o: object) => Promise<string>
    }
    if (!h.queryPermission && !h.requestPermission) return true
    if ((await h.queryPermission?.(opts)) === 'granted') return true
    if ((await h.requestPermission?.(opts)) === 'granted') return true
    return false
  } catch {
    return false
  }
}

/** 名称保留在快照内作为标签；文件身份不随改名或非法字符规范化变化。 */
export function backupFilename(workspaceUid: string): string {
  if (!isWorkspaceUid(workspaceUid)) throw new Error('工作区缺少有效的稳定身份，未写入快照。')
  // Legacy titles could never contain %. Fixed-width ASCII hex also keeps
  // case-distinct valid workspace IDs separate on case-insensitive volumes.
  const encoded = Array.from(workspaceUid, ch => ch.charCodeAt(0).toString(16)).join('')
  return `storyforge-uid%${encoded}.json`
}

async function readSnapshotText(handle: FileSystemDirectoryHandle, filename: string): Promise<string | null> {
  try {
    const file = await handle.getFileHandle(filename)
    return await (await file.getFile()).text()
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'NotFoundError') return null
    throw cause
  }
}

function assertSnapshotOwner(text: string, workspaceUid: string): void {
  let existing: unknown
  try { existing = JSON.parse(text) }
  catch { throw new Error('现有快照无法解析，已保留原文件，请先另存或恢复。') }
  if (!inspectProjectBackup(existing).valid) throw new Error('现有快照格式异常，已保留原文件，请先另存或恢复。')
  if ((existing as ProjectExportData).project.workspaceUid !== workspaceUid) {
    throw new Error('现有快照属于其他工作区，已阻止覆盖。')
  }
}

/**
 * 把某项目的完整数据写成 JSON 恢复快照。调用方必须位于明确的用户手势内；
 * MEMORY-0 禁止页面进入、授权恢复或定时器调用本函数。
 */
export async function writeProjectSnapshotToFolder(
  handle: FileSystemDirectoryHandle,
  projectId: number,
): Promise<boolean> {
  const project = await db.projects.get(projectId)
  if (!project) return false
  const filename = backupFilename(project.workspaceUid)
  const data = await exportProjectJSON(projectId)
  if (data.project.workspaceUid !== project.workspaceUid) throw new Error('工作区身份已变化，请重新保存快照。')
  const payload = JSON.stringify(data, null, 2)
  const original = await readSnapshotText(handle, filename)
  // Creating the first writable handle can leave an empty file if the staged
  // write fails. Only this UID-specific path is eligible for the next attempt.
  if (original !== null && original !== '') assertSnapshotOwner(original, project.workspaceUid)
  const fileHandle = await handle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  // FSA stages data until close(). Recheck the visible file after opening and
  // before committing; an unrelated replacement must not become our snapshot.
  const expected = original ?? ''
  const assertUnchanged = async () => {
    if (await (await fileHandle.getFile()).text() !== expected) {
      throw new Error('快照已变化，已停止覆盖，请重新核对文件。')
    }
  }
  try {
    await assertUnchanged()
    await writable.write(payload)
    await assertUnchanged()
    await writable.close()
  } catch (cause) {
    try { await writable.abort() } catch { /* The stream may already be closed. */ }
    throw cause
  }
  return true
}

export interface FolderBackupFile {
  name: string
  data: ProjectExportData
}

/** 读回文件夹里所有 storyforge-*.json（解析失败的单个文件跳过，不阻断）。 */
export async function readStoryforgeBackups(
  handle: FileSystemDirectoryHandle,
): Promise<FolderBackupFile[]> {
  const out: FolderBackupFile[] = []
  // entries() 是异步迭代器（FileSystemDirectoryHandle）
  const dir = handle as unknown as {
    entries: () => AsyncIterableIterator<[string, { kind: string; getFile: () => Promise<File> }]>
  }
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === 'file' && /^storyforge-.*\.json$/i.test(name)) {
      try {
        const file = await entry.getFile()
        const text = await file.text()
        const parsed = JSON.parse(text) as ProjectExportData
        const report = inspectProjectBackup(parsed)
        if (!report.valid) {
          console.warn('[folder] 跳过非当前格式的备份文件:', name, report.errors.join('；'))
          continue
        }
        out.push({ name, data: parsed })
      } catch (e) {
        console.warn('[folder] 跳过无法解析的备份文件:', name, e)
      }
    }
  }
  return out
}
