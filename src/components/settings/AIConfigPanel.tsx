import { useState } from 'react'
import { Wifi, WifiOff, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { useAIConfigStore } from '../../stores/ai-config'
import type { AIProvider } from '../../lib/types'

const PROVIDER_OPTIONS: { value: AIProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'qwen', label: '通义千问' },
  { value: 'doubao', label: '豆包' },
  { value: 'ollama', label: 'Ollama (本地)' },
  { value: 'custom', label: '自定义' },
]

const THEME_OPTIONS = [
  { value: 'midnight', label: '🌑 深夜书房', desc: '纯黑底 + 靛蓝' },
  { value: 'ocean', label: '🌃 暗夜蓝', desc: '深蓝底 + 青蓝' },
  { value: 'graphite', label: '🌫️ 墨灰', desc: '灰底 + 暖橙' },
  { value: 'mist', label: '☁️ 烟白', desc: '浅灰底 + 靛蓝' },
  { value: 'parchment', label: '📜 暖纸', desc: '米色底 + 棕色' },
]

export default function AIConfigPanel() {
  const { config, setConfig, switchProvider, testConnection } = useAIConfigStore()
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<boolean | null>(null)

  const currentTheme = localStorage.getItem('storyforge-theme') || 'midnight'

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const ok = await testConnection()
    setTestResult(ok)
    setTesting(false)
  }

  const handleThemeChange = (theme: string) => {
    localStorage.setItem('storyforge-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    // 强制重新渲染
    window.dispatchEvent(new Event('themechange'))
  }

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
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleTest}
              disabled={testing || !config.apiKey}
              className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors text-sm"
            >
              {testing ? (
                <span className="animate-spin">⏳</span>
              ) : testResult === true ? (
                <CheckCircle className="w-4 h-4" />
              ) : testResult === false ? (
                <WifiOff className="w-4 h-4" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              {testing ? '测试中...' : '测试连接'}
            </button>
            {testResult === true && <span className="text-success text-sm">✓ 连接成功</span>}
            {testResult === false && <span className="text-error text-sm">✗ 连接失败</span>}
          </div>
        </div>
      </div>

      {/* 主题切换 */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-base font-semibold text-text-primary mb-4">主题</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
