/**
 * 本地文件夹备份/恢复（FB-11 数据持久层）
 *
 * 纯逻辑层（不含 React），便于测试。负责:
 *   · 选择文件夹 / 校验授权（File System Access API）
 *   · 把某项目的完整数据写成 JSON 落到文件夹（自动备份 + 手动）
 *   · 从文件夹读回所有 storyforge-*.json（首页「从本地文件夹恢复」用）
 *
 * 句柄持久化在 folder-handle-store.ts（独立 IndexedDB），与本模块配合。
 */
import { exportProjectJSON, type ProjectExportData } from '../export/json-export'
import { db } from '../db/schema'

interface WindowWithFSA extends Window {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}

/** 浏览器是否支持 File System Access API（仅 Chrome/Edge 等） */
export function isFSASupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** 弹出系统选择框让用户挑一个文件夹（readwrite）。取消返回 null。 */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as WindowWithFSA).showDirectoryPicker
  if (!picker) return null
  try {
    return await picker({ mode: 'readwrite' })
  } catch (err) {
    const e = err as { name?: string }
    if (e?.name !== 'AbortError') console.error('[folder] 选择目录失败:', err)
    return null
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
    const q = await (handle as unknown as { queryPermission?: (o: object) => Promise<string> }).queryPermission?.(opts)
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
    if ((await h.queryPermission?.(opts)) === 'granted') return true
    if ((await h.requestPermission?.(opts)) === 'granted') return true
    return false
  } catch {
    return false
  }
}

function safeName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '-')
}

/** 项目备份文件名（按书名生成，恢复时按 storyforge-*.json 识别） */
export function backupFilename(projectName: string): string {
  return `storyforge-${safeName(projectName)}.json`
}

/** 把某项目的完整数据写成 JSON 落到绑定文件夹。返回是否成功。 */
export async function writeProjectJSONToFolder(
  handle: FileSystemDirectoryHandle,
  projectId: number,
): Promise<boolean> {
  const project = await db.projects.get(projectId)
  if (!project) return false
  const data = await exportProjectJSON(projectId)
  const fileHandle = await handle.getFileHandle(backupFilename(project.name), { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(data, null, 2))
  await writable.close()
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
        out.push({ name, data: JSON.parse(text) as ProjectExportData })
      } catch (e) {
        console.warn('[folder] 跳过无法解析的备份文件:', name, e)
      }
    }
  }
  return out
}
