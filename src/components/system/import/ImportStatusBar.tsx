import { useImportStatusStore } from '../../../stores/import-status'
import { Loader2, CheckCircle2, AlertTriangle, PauseCircle, Sparkles } from 'lucide-react'

/**
 * 顶部常驻状态条 —— 用户切到其它 Tab 再回来，能一眼看到导入流水线当前在做什么。
 */
export default function ImportStatusBar() {
  const s = useImportStatusStore()
  if (s.phase === 'idle') return null

  const pct = s.totalChunks > 0
    ? Math.round(((s.finishedChunks + s.failedChunks) / s.totalChunks) * 100)
    : 0

  const cfg = (() => {
    switch (s.phase) {
      case 'preparing': return { Icon: Loader2, color: 'text-accent', text: '准备中...', spin: true }
      case 'running':   return { Icon: Sparkles, color: 'text-accent', text: `解析中 ${s.finishedChunks + s.failedChunks}/${s.totalChunks}（${pct}%）`, spin: false }
      case 'merging':   return { Icon: Sparkles, color: 'text-warn', text: '🔀 跨块角色合并中...', spin: true }
      case 'paused':    return { Icon: PauseCircle, color: 'text-warn', text: `已暂停（${pct}%）`, spin: false }
      case 'failed':    return { Icon: AlertTriangle, color: 'text-error', text: `失败（${s.failedChunks} 块）`, spin: false }
      case 'done':      return { Icon: CheckCircle2, color: 'text-success', text: '✓ 已完成', spin: false }
      default:          return null
    }
  })()
  if (!cfg) return null
  const { Icon, color, text, spin } = cfg

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 bg-bg-surface border border-border rounded-lg text-xs ${color}`}>
      <Icon className={`w-3.5 h-3.5 ${spin ? 'animate-spin' : ''}`} />
      <span className="font-medium truncate max-w-[200px]">{s.filename}</span>
      <span>·</span>
      <span>{text}</span>
      {s.totalChunks > 0 && (s.phase === 'running' || s.phase === 'paused') && (
        <div className="w-16 h-1.5 bg-bg-base rounded overflow-hidden ml-1">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
