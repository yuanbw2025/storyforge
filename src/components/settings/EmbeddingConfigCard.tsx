import { IS_SHOWCASE } from '../../lib/showcase/policy'
import ShowcaseNotice from '../showcase/ShowcaseNotice'
/** Independent vector-service configuration. Local retrieval is automatic; no maintenance control is shown here. */
import { hasUnmatchedSessionCredentialV1, useAIConfigStore } from '../../stores/ai-config'
import { EMBEDDING_PROXY_ENDPOINTS as PROXY_PAIRS, hasLocalProviderProxy } from '../../lib/ai/proxy-endpoints'
import type { EmbeddingConfig } from '../../lib/types'

// 开发模式使用已登记的本地代理；生产预设在作者点击时改用对应直连地址。
const PRESETS: Array<{ label: string; note: string; cfg: Partial<EmbeddingConfig> }> = [
  { label: '硅基流动 · bge-m3', note: '独立云端向量服务', cfg: { provider: 'custom', baseUrl: '/siliconflow-proxy/v1', model: 'BAAI/bge-m3' } },
  { label: '通义 · v3', note: '独立云端向量服务', cfg: { provider: 'qwen', baseUrl: '/qwen-proxy/compatible-mode/v1', model: 'text-embedding-v3' } },
  { label: '智谱 · embedding-3', note: 'OpenAI 兼容向量接口', cfg: { provider: 'glm', baseUrl: '/glm-proxy/api/paas/v4', model: 'embedding-3' } },
  { label: '本地 Ollama · bge-m3', note: '本机向量服务', cfg: { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'bge-m3', apiKey: '' } },
  { label: 'OpenAI · 3-small', note: '独立云端向量服务', cfg: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' } },
]

export default function EmbeddingConfigCard() {
  return IS_SHOWCASE ? <ShowcaseNotice /> : <EmbeddingConfigCardFull />
}

function EmbeddingConfigCardFull() {
  const { embedding, setEmbeddingConfig } = useAIConfigStore()
  return (
    <details className="bg-bg-surface border border-border rounded-xl p-4 mb-6">
      <summary className="cursor-pointer text-sm font-medium text-text-primary">独立语义检索服务（高级 · 可选）</summary>
      <p className="mt-3 mb-3 text-[13px] leading-relaxed text-text-muted">
        本机检索自动工作，无需维护索引。配置独立向量服务后可补充语义匹配；相关查询和正文片段会发往该服务，聊天模型的 Key 不会用于此处。
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
        <input type="checkbox" checked={embedding.enabled} onChange={e => setEmbeddingConfig({ enabled: e.target.checked })} className="accent-accent" />
        使用独立向量服务
      </label>
      {embedding.enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => {
                const pair = PROXY_PAIRS.find(item => item.proxy === p.cfg.baseUrl)
                setEmbeddingConfig(!hasLocalProviderProxy() && pair ? { ...p.cfg, baseUrl: pair.direct } : p.cfg)
              }}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-bg-elevated border border-border text-text-secondary hover:text-accent hover:border-accent/50 transition-colors text-left">
                <div className="font-medium">{p.label}</div>
                <div className="text-[10px] text-text-muted">{p.note}</div>
              </button>
            ))}
          </div>
          <p className="text-[13px] text-text-muted">
            {hasLocalProviderProxy()
              ? '国内预设默认使用开发服务器的本地代理。'
              : '线上部署不自带本地代理，预设使用服务商直连地址。直连仍需服务商允许跨域；自建代理请手动填写 Base URL。'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Base URL</label>
              <input aria-label="语义检索服务 Base URL" type="text" value={embedding.baseUrl} onChange={e => setEmbeddingConfig({ baseUrl: e.target.value })}
                className="w-full px-3 py-1.5 bg-bg-base border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent" />
              {(() => {
                const pair = PROXY_PAIRS.find(p => embedding.baseUrl === p.proxy || embedding.baseUrl === p.direct)
                if (!pair) return null
                const isProxy = embedding.baseUrl === pair.proxy
                return isProxy ? (
                  <button onClick={() => setEmbeddingConfig({ baseUrl: pair.direct })}
                    className="mt-1 text-[13px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                    🔗 切换到直连(线上部署用)
                  </button>
                ) : hasLocalProviderProxy() ? (
                  <button onClick={() => setEmbeddingConfig({ baseUrl: pair.proxy })}
                    className="mt-1 text-[13px] px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors">
                    🔄 切换到本地代理(本地运行用)
                  </button>
                ) : null
              })()}
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">嵌入模型</label>
              <input aria-label="嵌入模型" type="text" value={embedding.model} onChange={e => setEmbeddingConfig({ model: e.target.value })}
                className="w-full px-3 py-1.5 bg-bg-base border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">API Key <span className="text-text-muted">(本地 Ollama 可留空)</span></label>
            <input aria-label="语义检索服务 API Key" type="password" value={embedding.apiKey} onChange={e => setEmbeddingConfig({ apiKey: e.target.value })}
              placeholder="sk-..." className="w-full px-3 py-1.5 bg-bg-base border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent" />
            {hasUnmatchedSessionCredentialV1('embedding') && (
              <p className="mt-2 text-xs text-text-secondary" role="status">临时 API Key 未能与当前配置匹配，请确认嵌入服务地址后重新填写。</p>
            )}
          </div>
        </div>
      )}
    </details>
  )
}
