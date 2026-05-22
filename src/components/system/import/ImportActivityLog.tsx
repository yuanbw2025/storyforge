import { useImportStatusStore } from '../../../stores/import-status'
import { Info, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react'
import type { ImportLogLevel } from '../../../lib/types/import-session'

const ICONS: Record<ImportLogLevel, typeof Info> = {
  info: Info,
  warn: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
}
const COLORS: Record<ImportLogLevel, string> = {
  info: 'text-text-secondary',
  warn: 'text-warn',
  error: 'text-error',
  success: 'text-success',
}

/** 滚动活动日志，仅展示内存里的最近 200 条（DB 里有完整归档） */
export default function ImportActivityLog() {
  const activity = useImportStatusStore(s => s.activity)
  if (activity.length === 0) return null

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-text-primary">活动日志</div>
        <div className="text-xs text-text-muted">最近 {activity.length} 条</div>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
        {activity.map(entry => {
          const Icon = ICONS[entry.level]
          const color = COLORS[entry.level]
          const time = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false })
          return (
            <div key={entry.id} className={`flex items-start gap-2 text-xs ${color}`}>
              <Icon className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span className="text-text-muted font-mono text-[10px] mt-0.5">{time}</span>
              <span className="flex-1 leading-relaxed break-all">{entry.message}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
