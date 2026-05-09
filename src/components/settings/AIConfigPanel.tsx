import { useState, useEffect, useSyncExternalStore } from 'react'
import { Wifi, WifiOff, Eye, EyeOff, CheckCircle, Trash2, ScrollText } from 'lucide-react'
import { useAIConfigStore, type TestResult } from '../../stores/ai-config'
import type { AIProvider } from '../../lib/types'
import { getLogs, subscribeLogs, clearLogs, formatLog } from '../../lib/ai/logger'

const PROVIDER_OPTIONS: { value: AIProvider; label: string; cors: boolean; hint: string }[] = [
  { value: 'deepseek', label: 'DeepSeek', cors: true, hint: '获取 Key: platform.deepseek.com → API Keys' },
  { value: 'qwen', label: '通义千问', cors: true, hint: '获取 Key: dashscope.console.aliyun.com → API-KEY 管理' },
  { value: 'doubao', label: '豆包', cors: true, hint: '获取 Key: console.volcengine.com → 模型推理 → API Key' },
  { value: 'minimax', label: 'MiniMax', cors: true, hint: '获取 Key: platform.minimaxi.com → API Keys' },
  { value: 'glm', label: '智谱 GLM', cors: true, hint: '获取 Key: open.bigmodel.cn → API Keys' },
  { value: 'wenxin', label: '文心一言', cors: true, hint: '获取 Key: console.bce.baidu.com → 千帆大模型 → API Key' },
  { value: 'gemini', label: 'Gemini', cors: true, hint: '获取 Key: aistudio.google.com → API Keys' },
  { value: 'poe', label: 'Poe', cors: true, hint: '获取 Key: poe.com → Settings → API → API Key' },
  { value: 'openai', label: 'OpenAI (需代理)', cors: false, hint: '⚠️ OpenAI 不支持浏览器直连，需要中间代理服务器' },
  { value: 'kimi', label: 'Kimi (需代理)', cors: false, hint: '⚠️ Kimi 不支持浏览器直连，需要中间代理服务器' },
  { value: 'claude', label: 'Claude (需代理)', cors: false, hint: '⚠️ Claude 不支持浏览器直连，需要中间代理服务器' },
  { value: 'ollama', label: 'Ollama (本地)', cors: true, hint: '本地运行 Ollama，无需 API Key' },
  { value: 'custom', label: '自定义', cors: true, hint: '填写任何兼容 OpenAI 格式的 API' },
]

const THEME_OPTIONS = [
  { value: 'work', label: '🔨 工作', desc: '深色暖黑，专注生产' },
  { value: 'forge', label: '🔥 熔炉', desc: '暖棕火光，仪式感' },
  { value: 'paper', label: '📄 纸张', desc: '浅色米白，沉浸写作' },
]

export default function AIConfigPanel() {
  const { config, setConfig, switchProvider, testConnection } = useAIConfigStore()
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  // 订阅日志变化
  const logs = useSyncExternalStore(subscribeLogs, getLogs)

  const currentTheme = localStorage.getItem('storyforge-theme') || 'work'
  const currentProviderInfo = PROVIDER_OPTIONS.find((p) => p.value === config.provider)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection()
    setTestResult(result)
    setTesting(false)
  }

  const handleThemeChange = (theme: string) => {
    localStorage.setItem('storyforge-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    window.dispatchEvent(new Event('themechange'))
  }

  // 切换 provider 时清空测试结果
  useEffect(() => {
    setTestResult(null)
  }, [config.provider])

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-text-primary mb-6">设置</h2>

      {/* AI 配置 */}
      <div className="bg-bg-surface border border-border rounded-xl p-5 mb-6">
        <h3 className="text-base font-semibold text-text-primary mb-4">AI 模型配置</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">提供商</label>
            <select
              value={config.provider}
              onChange={(e) => switchProvider(e.target.value as AIProvider)}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}{!opt.cors ? ' ⚠️' : ''}
                </option>
              ))}
            </select>
            {/* 配置提示 */}
            {currentProviderInfo && (
              <p className={`mt-1.5 text-xs ${currentProviderInfo.cors ? 'text-text-muted' : 'text-amber-500'}`}>
                {currentProviderInfo.hint}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => setConfig({ apiKey: e.target.value })}
                placeholder={config.provider === 'ollama' ? '不需要 Key' : '输入 API Key...'}
                className="w-full px-3 py-2 pr-10 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">Base URL</label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({ baseUrl: e.target.value })}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">模型</label>
              <input
                type="text"
                value={config.model}
                onChange={(e) => setConfig({ model: e.target.value })}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">
                Temperature: {config.temperature}
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={config.temperature}
                onChange={(e) => setConfig({ temperature: Number(e.target.value) })}
                className="w-full accent-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">
                Max Tokens: {config.maxTokens}
              </label>
              <input
                type="range"
                min={1024}
                max={16384}
                step={1024}
                value={config.maxTokens}
                onChange={(e) => setConfig({ maxTokens: Number(e.target.value) })}
                className="w-full accent-accent"
              />
            </div>
          </div>

          {/* 测试连接 */}
          <div className="pt-2 space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={testing || !config.apiKey}
                className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors text-sm"
              >
                {testing ? (
                  <span className="animate-spin">⏳</span>
                ) : testResult?.ok ? (
                  <CheckCircle className="w-4 h-4" />
                ) : testResult && !testResult.ok ? (
                  <WifiOff className="w-4 h-4" />
                ) : (
                  <Wifi className="w-4 h-4" />
                )}
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="flex items-center gap-1.5 px-3 py-2 text-text-muted hover:text-text-secondary text-sm transition-colors"
              >
                <ScrollText className="w-4 h-4" />
                日志 {logs.length > 0 && `(${logs.length})`}
              </button>
            </div>
            {/* 测试结果详情 */}
            {testResult && (
              <div className={`text-sm px-3 py-2 rounded-lg ${testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <p>{testResult.message}</p>
                {testResult.duration && (
                  <p className="text-xs mt-0.5 opacity-70">耗时 {testResult.duration}ms</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 日志面板 */}
      {showLogs && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-primary">连接日志</h3>
            <button
              onClick={clearLogs}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
            >
              <Trash2 className="w-3 h-3" /> 清空
            </button>
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-1 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-text-muted">暂无日志，点击「测试连接」生成</p>
            ) : (
              logs.map((log) => (
                <pre key={log.id} className="text-text-secondary whitespace-pre-wrap break-all">
                  {formatLog(log)}
                </pre>
              ))
            )}
          </div>
        </div>
      )}

      {/* 主题切换 */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-base font-semibold text-text-primary mb-4">主题</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {THEME_OPTIONS.map((theme) => (
            <button
              key={theme.value}
              onClick={() => handleThemeChange(theme.value)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${
                currentTheme === theme.value
                  ? 'border-accent bg-accent/10'
                  : 'border-border hover:border-border-hover hover:bg-bg-hover'
              }`}
            >
              <span className="text-lg">{theme.label.split(' ')[0]}</span>
              <div>
                <p className="text-sm text-text-primary font-medium">{theme.label.split(' ').slice(1).join(' ')}</p>
                <p className="text-xs text-text-muted">{theme.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
