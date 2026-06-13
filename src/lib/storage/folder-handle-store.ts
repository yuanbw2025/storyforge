/**
 * 本地文件夹句柄持久化（FB-11 数据持久层）
 *
 * File System Access API 的 `FileSystemDirectoryHandle` 是「可结构化克隆」对象,
 * 能存进 IndexedDB（但不能 JSON 序列化进 localStorage）。本模块用一个**独立的
 * IndexedDB 库**（storyforge-fsa）存句柄,**刻意不进 Dexie 主库 / 三注册表**——
 * 它是基础设施（绑定记忆）,不是项目数据,既不导出也不参与项目生命周期。
 *
 * 这样:页面刷新 / 部署更新后,绑定不丢;配合启动期重新授权 + 自动回读,
 * 实现「连了文件夹就不怕重置」。
 */

const DB_NAME = 'storyforge-fsa'
const STORE = 'handles'

/** 每个项目记住各自绑定的文件夹 */
export const projFolderKey = (projectId: number) => `proj-${projectId}`
/** 最近一次绑定的文件夹（首页「从本地文件夹恢复」用，跨项目/库已空时也能找回） */
export const LAST_FOLDER_KEY = 'last'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveFolderHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(handle, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function loadFolderHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB()
  try {
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const r = tx.objectStore(STORE).get(key)
      r.onsuccess = () => resolve((r.result as FileSystemDirectoryHandle) ?? null)
      r.onerror = () => reject(r.error)
    })
  } finally {
    db.close()
  }
}

export async function clearFolderHandle(key: string): Promise<void> {
  const db = await openDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
