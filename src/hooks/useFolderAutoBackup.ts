import { useEffect, useRef } from 'react'
import { loadFolderHandle, projFolderKey } from '../lib/storage/folder-handle-store'
import { folderPermissionGranted, writeProjectJSONToFolder } from '../lib/storage/folder-backup'

/** 本地文件夹自动备份间隔（毫秒）— 5 分钟 */
export const FOLDER_AUTO_INTERVAL = 5 * 60 * 1000

/**
 * 本地文件夹自动备份 Hook（FB-11 数据持久层）。
 *
 * 进入某项目工作区时：若该项目此前绑过本地文件夹、且授权仍有效（不弹窗静默判断），
 * 则**进入即写一次** + 之后每 FOLDER_AUTO_INTERVAL 写一次完整 JSON。
 * 句柄持久在独立 IndexedDB，刷新/更新后依然在 → 让「自动保存」名副其实、绑定不丢。
 *
 * 未绑定 / 授权失效 → 静默跳过（不打扰；用户可在「数据管理」面板重新授权）。
 */
export function useFolderAutoBackup(projectId: number | null) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (!projectId) return

    void (async () => {
      const handle = await loadFolderHandle(projFolderKey(projectId))
      if (!handle || cancelled) return
      if (!(await folderPermissionGranted(handle))) return // 授权失效：静默跳过

      // 进入工作区先落一次盘
      writeProjectJSONToFolder(handle, projectId).catch(err =>
        console.error('[FolderAutoBackup] 首次写入失败:', err))

      timerRef.current = setInterval(() => {
        writeProjectJSONToFolder(handle, projectId).catch(err =>
          console.error('[FolderAutoBackup] 写入失败:', err))
      }, FOLDER_AUTO_INTERVAL)
    })()

    return () => {
      cancelled = true
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    }
  }, [projectId])
}
