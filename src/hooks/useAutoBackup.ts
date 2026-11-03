import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useBackupStore, AUTO_BACKUP_INTERVAL, readBackupOwner, type BackupOwner } from '../stores/backup'

/**
 * 自动定时备份 Hook
 * 每 5 分钟为当前项目创建一个自动快照
 */
export function useAutoBackup(projectId: number | null) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const createSnapshot = useBackupStore(state => state.createSnapshot)
  const activate = useBackupStore(state => state.activateAutoBackup)
  const { key: routeKey } = useLocation()

  // Section navigation updates visibility without restarting the five-minute timer.
  useEffect(() => {
    if (projectId) return activate(projectId, routeKey)
  }, [projectId, routeKey, activate])

  useEffect(() => {
    // 清理旧定时器
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (!projectId) return
    let frozenOwner: BackupOwner | null = null

    // 启动定时备份
    timerRef.current = setInterval(async () => {
      try {
        const active = useBackupStore.getState().activeView
        if (!frozenOwner && active?.projectId === projectId) frozenOwner = active.owner
        frozenOwner ??= await readBackupOwner(projectId)
        const now = new Date()
        const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        await createSnapshot(projectId, `自动备份 ${timeStr}`, 'auto', frozenOwner.workspaceUid)
      } catch {
        console.error('[AutoBackup] 自动快照未更新，请查看当前工作区的备份提示。')
      }
    }, AUTO_BACKUP_INTERVAL)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [projectId, createSnapshot])
}
