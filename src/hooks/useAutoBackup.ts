import { useEffect, useRef } from 'react'
import { useBackupStore, AUTO_BACKUP_INTERVAL } from '../stores/backup'

/**
 * 自动定时备份 Hook
 * 每 5 分钟为当前项目创建一个自动快照
 */
export function useAutoBackup(projectId: number | null) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { createSnapshot } = useBackupStore()

  useEffect(() => {
    // 清理旧定时器
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (!projectId) return

    // 启动定时备份
    timerRef.current = setInterval(async () => {
      try {
        const now = new Date()
        const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        await createSnapshot(projectId, `自动备份 ${timeStr}`, 'auto')
      } catch (err) {
        console.error('[AutoBackup] 创建快照失败:', err)
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
