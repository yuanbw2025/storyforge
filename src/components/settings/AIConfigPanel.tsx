import { useState, useEffect, useSyncExternalStore } from 'react'
import { Wifi, WifiOff, Eye, EyeOff, CheckCircle, Trash2, ScrollText } from 'lucide-react'
import { useAIConfigStore, type TestResult } from '../../stores/ai-config'
import type { AIProvider } from '../../lib/types'
import { PROVIDER_MODELS } from '../../lib/types'
import { getLogs, subscribeLogs, clearLogs, formatLog } from '../../lib/ai/logger'

const PROVIDER_OPTIONS: { value: AIProvider; label: string; cors: boolean; hint: string }[] = [
  { value: 'deepseek', label: 'DeepSeek', cors: false, hint: '获取 Key: platform.deepseek.com → API Keys（需点击下方「切换到本地代理」）' },
  { value: 'qwen', label: '通义千问', cors: true, hint: '获取 Key: dashscope.console.aliyun.com → API-KEY 管理' },
  { value: 'doubao', label: '豆包', cors: true, hint: '获取 Key: console.volcengine.com → 模型推理 → API Key' },
  { value: 'minimax', label: 'MiniMax', cors: true, hint: '获取 Key: platform.minimaxi.com → API Keys' },
  { value: 'glm', label: '智谱 GLM', cors: true, hint: '获取 Key: open.bigmodel.cn → API Keys' },
  { value: 'wenxin', label: '文心一言', cors: true, hint: '获取 Key: console.bce.baidu.com → 千帆大模型 → API Key' },
  { value: 'gemini', label: 'Gemini', cors: true, hint: '获取 Key: aistudio.google.com → API Keys' },
  { value: 'poe', label: 'Poe', cors: true, hint: '获取 Key: poe.com → Settings → API → API Key' },
  { value: 'openai', label: 'OpenAI', cors: false, hint: '获取 Key: platform.openai.com → API Keys（需点击下方「切换到本地代理」）' },
  { value: 'kimi', label: 'Kimi', cors: false, hint: '获取 Key: platform.moonshot.cn → API Key 管理（需点击下方「切换到本地代理」）' },
  { value: 'claude', label: 'Claude', cors: false, hint: '获取 Key: console.anthropic.com → API Keys（需点击下方「切换到本地代理」）' },
  { value: 'modelscope', label: '魔搭社区', cors: true, hint: '获取 Key: modelscope.cn → 我的 → Access Token' },
  { value: 'ollama', label: 'Ollama (本地)', cors: true, hint: '本地运行 Ollama，无需 API Key' },
  { value: 'custom', label: '自定义', cors: true, hint: '填写任何兼容 OpenAI 格式的 API' },
]

const THEME_OPTIONS = [
  { value: 'forge',  label: '熔炉',   emoji: '🔥', desc: '暗夜琥珀 · 火光余烬', swatches: ['#1A0F0A', '#D97757', '#C8A155'] },
  { value: 'scroll', label: '古卷',   emoji: '📜', desc: '旧纸染黄 · 铁胆墨香', swatches: ['#E5D5A8', '#7B3A1A', '#8B5E1A'] },
  { value: 'paper',  label: '纸与墨', emoji: '🖊', desc: '素纸如雪 · 墨迹清朗', swatches: ['#FAF7F0', '#B85C3F', '#8A7E6A'] },
]

export default function AIConfigPanel() {
  const { config, setConfig, switchProvider, testConnection } = useAIConfigStore()
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  // 订阅日志变化
  const logs = useSyncExternalStore(subscribeLogs, getLogs)

  const currentTheme = localStorage.getItem('storyforge-theme') || 'forge'
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
              {(() => {
                // 需要代理的 provider 及其代理路径 / 原始地址映射
                const PROXY_MAP: Record<string, { proxy: string; direct: string }> = {
                  deepseek: { proxy: '/deepseek-proxy/v1', direct: 'https://api.deepseek.com/v1' },
                  openai:   { proxy: '/openai-proxy/v1',   direct: 'https://api.openai.com/v1' },
                  kimi:     { proxy: '/kimi-proxy/v1',     direct: 'https://api.moonshot.cn/v1' },
                  claude:   { proxy: '/claude-proxy/v1',   direct: 'https://api.anthropic.com/v1' },
                }
                const pm = PROXY_MAP[config.provider]
                if (!pm) return null
                const isProxy = config.baseUrl.startsWith('/' + config.provider)
                return (
                  <div className="mt-1.5 flex gap-2">
                    {!isProxy ? (
                      <button
                        onClick={() => setConfig({ baseUrl: pm.proxy })}
                        className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                      >
                        🔄 切换到本地代理
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfig({ baseUrl: pm.direct })}
                        className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                      >
                        🔗 恢复直连
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">模型</label>
              {PROVIDER_MODELS[config.provider] ? (
                <>
                  <select
                    value={config.model}
                    onChange={(e) => setConfig({ model: e.target.value })}
                    className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                  >
                    {PROVIDER_MODELS[config.provider].map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.value}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const selected = PROVIDER_MODELS[config.provider]?.find((m) => m.value === config.model)
                    return selected?.desc ? (
                      <p className="mt-1 text-xs text-text-muted">{selected.desc}</p>
                    ) : null
                  })()}
                </>
              ) : (
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig({ model: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                />
              )}
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
                Max Tokens:
                {config.maxTokens === 0
                  ? <span className="text-accent font-normal ml-1">不限制（模型最大）</span>
                  : <><span className="ml-1">{config.maxTokens}</span><span className="text-text-muted font-normal ml-1">（≈{Math.round(config.maxTokens * 0.6)}字）</span></>
                }
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.maxTokens === 0}
                    onChange={(e) => setConfig({ maxTokens: e.target.checked ? 0 : 8192 })}
                    className="accent-accent"
                  />
                  不限
                </label>
                {config.maxTokens > 0 && (
                  <input
                    type="range"
                    min={1024}
                    max={65536}
                    step={1024}
                    value={config.maxTokens}
                    onChange={(e) => setConfig({ maxTokens: Number(e.target.value) })}
                    className="w-full accent-accent"
                  />
                )}
              </div>
              {config.maxTokens > 0 && (
                <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                  <span>1K</span><span>16K</span><span>32K</span><span>64K</span>
                </div>
              )}
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
            {/* CORS 错误提示 */}
            {testResult && !testResult.ok && config.provider === 'deepseek' &&
              (testResult.message.includes('CORS') || testResult.message.includes('网络错误')) && (
              <p className="text-xs text-amber-400 px-1">
                {import.meta.env.DEV
                  ? '💡 本地运行时，可点击「切换到本地代理」解决此问题'
                  : '💡 建议改用 Gemini（支持浏览器直调）或在本地运行此工具'}
              </p>
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
        <div className="flex flex-col gap-3">
          {THEME_OPTIONS.map((theme) => {
            const isActive = currentTheme === theme.value
            return (
              <button
                key={theme.value}
                onClick={() => handleThemeChange(theme.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                  isActive
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-border-hover hover:bg-bg-hover'
                }`}
              >
                {/* 色块预览 */}
                <div className="flex items-end gap-1 flex-shrink-0">
                  {theme.swatches.map((c, j) => (
                    <div
                      key={j}
                      style={{
                        width: j === 0 ? 28 : 18,
                        height: j === 0 ? 28 : 18,
                        background: c,
                        borderRadius: j === 0 ? 6 : 4,
                        border: '1px solid rgba(0,0,0,0.08)',
                        marginBottom: j === 0 ? 0 : 5,
                        flexShrink: 0,
                      }}
                    />
                  ))}
                </div>
                {/* 文字 */}
                <div className="flex-1">
                  <p className="text-sm text-text-primary font-medium leading-none mb-1">
                    {theme.emoji} {theme.label}
                  </p>
                  <p className="text-xs text-text-muted">{theme.desc}</p>
                </div>
                {/* 选中标记 */}
                {isActive && (
                  <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17 4 12"/>
                    </svg>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
