import { Trash2 } from 'lucide-react'
import { formatLog, type AILogEntry } from '../../lib/ai/logger'

interface Props {
  logs: AILogEntry[]
  onClear: () => void
}

export default function AIConnectionLogPanel({ logs, onClear }: Props) {
  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">连接日志</h3>
        <button onClick={onClear} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary">
          <Trash2 className="w-3 h-3" /> 清空
        </button>
      </div>
      <div className="max-h-[200px] overflow-y-auto space-y-1 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-text-muted">暂无日志，点击「测试连接」生成</p>
        ) : (
          logs.map(log => (
            <pre key={log.id} className="text-text-secondary whitespace-pre-wrap break-all">{formatLog(log)}</pre>
          ))
        )}
      </div>
    </div>
  )
}
