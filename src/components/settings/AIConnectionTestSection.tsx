import { CheckCircle, ScrollText, Wifi, WifiOff } from 'lucide-react'
import { AI_PROXY_ENDPOINTS } from '../../lib/ai/proxy-endpoints'
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
  const showCorsHint = result && !result.ok
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
          {testing ? '测试中...' : '测试最小连接'}
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
      <p className="px-1 text-[10px] text-text-muted">
        只验证当前 Key、Base URL 和模型能完成一次极短请求；不代表长输出、批量评测或剩余额度充足。
      </p>
      {showCorsHint && (
        <p className="text-xs text-amber-400 px-1">
          {isDevelopment
            ? AI_PROXY_ENDPOINTS[provider]
              ? '可尝试已有的本地代理（仅转发到该服务商官方地址）。自定义中转站需由服务方允许当前网页来源的 CORS 预检。'
              : '自定义中转站没有内置通用代理。请让服务方允许当前网页来源的 OPTIONS 预检，以及 Content-Type、Authorization 请求头；或使用你自己部署的同源反向代理。'
            : '请检查网络和 Base URL。若控制台显示 CORS，需由服务方允许当前网页来源的 OPTIONS 预检及 Content-Type、Authorization 请求头，或配置你自己部署的同源反向代理。'}
        </p>
      )}
    </div>
  )
}
