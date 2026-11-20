import { useState, useSyncExternalStore } from 'react'
import { ScrollText } from 'lucide-react'
import { getLogs, subscribeLogs, clearLogs } from '../../lib/ai/logger'
import AIConnectionLogPanel from './AIConnectionLogPanel'

/** Mounted only by the explicit development settings entry. */
export default function AIConnectionDeveloperTools() {
  const [showLogs, setShowLogs] = useState(false)
  const logs = useSyncExternalStore(subscribeLogs, getLogs)
  return <>
    <button onClick={() => setShowLogs(!showLogs)} aria-pressed={showLogs}
      className="flex items-center gap-1.5 px-3 py-2 text-text-muted hover:text-text-secondary text-sm transition-colors">
      <ScrollText className="w-4 h-4" />
      日志 {logs.length > 0 && `(${logs.length})`}
    </button>
    {showLogs && <AIConnectionLogPanel logs={logs} onClear={clearLogs} />}
  </>
}
