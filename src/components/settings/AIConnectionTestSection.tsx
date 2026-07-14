import { CheckCircle, ScrollText, Wifi, WifiOff } from 'lucide-react'
import type { AIProvider } from '../../lib/types'
import type { TestResult } from '../../stores/ai-config'

interface Props {
  testing: boolean
  result: TestResult | null
  configReady: boolean
  provider: AIProvider
  logCount: number
  showLogs: boolean
  isDevelopment: boolean
  onTest: () => void
  onToggleLogs: () => void
}

export default function AIConnectionTestSection({
  testing,
  result,
  configReady,
  provider,
  logCount,
  showLogs,
  isDevelopment,
  onTest,
  onToggleLogs,
}: Props) {
  const showCorsHint = result && !result.ok && provider === 'deepseek'
    && (result.message.includes('CORS') || result.message.includes('网络错误'))

  return (
    <div className="pt-2 space-y-2">
      <div className="flex items-center gap-3">
        <button onClick={onTest} disabled={testing || !configReady}
          className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors text-sm">
          {testing ? (
            <span className="animate-spin">⏳</span>
          ) : result?.ok ? (
            <CheckCircle className="w-4 h-4" />
          ) : result && !result.ok ? (
            <WifiOff className="w-4 h-4" />
          ) : (
            <Wifi className="w-4 h-4" />
          )}
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button onClick={onToggleLogs} aria-pressed={showLogs}
          className="flex items-center gap-1.5 px-3 py-2 text-text-muted hover:text-text-secondary text-sm transition-colors">
          <ScrollText className="w-4 h-4" />
          日志 {logCount > 0 && `(${logCount})`}
        </button>
      </div>
      {result && (
        <div className={`text-sm px-3 py-2 rounded-lg ${result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          <p>{result.message}</p>
          {result.duration && <p className="text-xs mt-0.5 opacity-70">耗时 {result.duration}ms</p>}
        </div>
      )}
      {showCorsHint && (
        <p className="text-xs text-amber-400 px-1">
          {isDevelopment
            ? '💡 本地运行时，可点击「切换到本地代理」解决此问题'
            : '💡 建议改用 Gemini（支持浏览器直调）或在本地运行此工具'}
        </p>
      )}
    </div>
  )
}
