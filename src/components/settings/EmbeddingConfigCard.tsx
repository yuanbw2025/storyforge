import { IS_SHOWCASE } from '../../lib/showcase/policy'
import ShowcaseNotice from '../showcase/ShowcaseNotice'
/**
 * NS-5 · 语义检索(embedding)配置卡 — Labs。
 * 默认关闭=纯关键词检索(零额外成本/不外传)。开启后:配置 OpenAI 兼容 /embeddings 端点,
 * 并可为当前项目历史章节批量建立语义索引(幂等可续跑)。隐私首选本地 Ollama(手稿不出本机)。
 */
import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { hasUnmatchedSessionCredentialV1, useAIConfigStore } from '../../stores/ai-config'
import { useProjectStore } from '../../stores/project'
import { ensureChunkEmbeddings, rebuildProjectNarrativeSummaries, rebuildProjectRetrievalChunks } from '../../lib/retrieval/retrieval'
import { isEmbeddingReady } from '../../lib/ai/adapters/embedding-adapter'
import { EMBEDDING_PROXY_ENDPOINTS as PROXY_PAIRS, hasLocalProviderProxy } from '../../lib/ai/proxy-endpoints'
import type { EmbeddingConfig } from '../../lib/types'

// 开发模式使用已登记的本地代理；生产预设在作者点击时改用对应直连地址。
const PRESETS: Array<{ label: string; note: string; cfg: Partial<EmbeddingConfig> }> = [
  { label: '硅基流动 · bge-m3', note: '无需显卡 · 国内可用 · 有免费额度(推荐)', cfg: { provider: 'custom', baseUrl: '/siliconflow-proxy/v1', model: 'BAAI/bge-m3' } },
  { label: '通义 · v3', note: '阿里大厂 · 便宜稳 · 中文强', cfg: { provider: 'qwen', baseUrl: '/qwen-proxy/compatible-mode/v1', model: 'text-embedding-v3' } },
  { label: '智谱 · embedding-3', note: '国内大厂 · OpenAI 兼容', cfg: { provider: 'glm', baseUrl: '/glm-proxy/api/paas/v4', model: 'embedding-3' } },
  { label: '本地 Ollama · bge-m3', note: '免费离线 · 手稿不出本机 · 需显卡', cfg: { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'bge-m3', apiKey: '' } },
  { label: 'OpenAI · 3-small', note: '需外网 · 1536维', cfg: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small' } },
]

export default function EmbeddingConfigCard() {
  return IS_SHOWCASE ? <ShowcaseNotice /> : <EmbeddingConfigCardFull />
}

function EmbeddingConfigCardFull() {
  const { embedding, setEmbeddingConfig } = useAIConfigStore()
  const currentProjectId = useProjectStore(s => s.currentProjectId)
  const [indexing, setIndexing] = useState(false)
  const [progress, setProgress] = useState('')
  const [msg, setMsg] = useState('')

  const buildIndex = async () => {
    if (!currentProjectId) return
    setIndexing(true); setMsg(''); setProgress('准备中…')
    try {
      const chunks = await rebuildProjectRetrievalChunks({
        projectId: currentProjectId,
        onProgress: (done, total) => setProgress(`切块 ${done}/${total} 章`),
      })
      const summaries = await rebuildProjectNarrativeSummaries({
        projectId: currentProjectId,
        onProgress: (done, total) => setProgress(`摘要 ${done}/${total} 章`),
      })
      if (!isEmbeddingReady(embedding)) {
        setMsg(`检索索引已就绪:扫描 ${chunks.chapters} 章,重建 ${chunks.rebuiltChapters} 章 / ${chunks.chunks} 块;摘要树 ${summaries.chapterNodes} 章、${summaries.volumeNodes} 卷、${summaries.bookNodes} 全书。未配置 embedding,将使用层级摘要+关键词检索。`)
        return
      }
      const r = await ensureChunkEmbeddings({
        projectId: currentProjectId, cfg: embedding,
        onProgress: (done, total) => setProgress(`嵌入 ${done}/${total} 块`),
      })
      setMsg(r.total === 0
        ? `检索索引已就绪:扫描 ${chunks.chapters} 章,当前 ${chunks.chunks} 块;摘要树 ${summaries.chapterNodes} 章、${summaries.volumeNodes} 卷、${summaries.bookNodes} 全书;语义向量已全部就绪。`
        : `完成:扫描 ${chunks.chapters} 章,重建 ${chunks.rebuiltChapters} 章 / ${chunks.chunks} 块;摘要树 ${summaries.chapterNodes} 章、${summaries.volumeNodes} 卷、${summaries.bookNodes} 全书;本次嵌入 ${r.embedded} 块,跳过已就绪 ${r.skipped} 块`)
    } catch (e) {
      setMsg(`建立索引失败:${e instanceof Error ? e.message : String(e)}（已有索引仍可用;embedding 失败会自动退回关键词检索）`)
    } finally {
      setIndexing(false); setProgress('')
    }
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" /> 语义检索(embedding)
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-normal">Labs</span>
        </h3>
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input type="checkbox" checked={embedding.enabled} onChange={e => setEmbeddingConfig({ enabled: e.target.checked })} className="accent-accent" />
          启用
        </label>
      </div>
      <p className="text-[11px] text-text-muted mb-4 leading-relaxed">
        关闭时,远距前文检索只走<strong>关键词通道</strong>(纯本机、零成本)。开启后叠加<strong>语义向量</strong>召回——更擅长"几百章前靠近义/语义命中的伏笔",
        与关键词混合打分,失败自动退回关键词、不阻断生成。<strong>云端模型会把正文发往该服务商;选本地 Ollama 则一个字都不出本机。</strong>
      </p>

      <div className="pt-2 border-t border-border/50 mb-4">
        <button onClick={buildIndex} disabled={indexing || !currentProjectId}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 text-accent text-sm rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors">
          {indexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {indexing ? `建立中… ${progress}` : '为当前项目历史章节建立检索索引'}
        </button>
        {!currentProjectId && <p className="text-[11px] text-text-muted mt-1.5">打开一个项目后,这里可为其历史章节批量建索引。</p>}
        <p className="text-[11px] text-text-muted mt-1.5">
          先按章节正文重建关键词块与章→卷→全书摘要树;若已启用并配置 embedding,再只嵌入"缺向量或换了模型"的块。未启用 embedding 时,远距召回仍可走层级摘要+纯关键词通道。
        </p>
        {msg && <p className="text-[11px] text-text-secondary mt-1.5 px-2 py-1 rounded bg-bg-base">{msg}</p>}
      </div>

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
          <p className="text-[11px] text-text-muted">
            {hasLocalProviderProxy()
              ? '国内预设默认使用开发服务器的本地代理。'
              : '线上部署不自带本地代理，预设使用服务商直连地址。直连仍需服务商允许跨域；自建代理请手动填写 Base URL。'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Base URL</label>
              <input type="text" value={embedding.baseUrl} onChange={e => setEmbeddingConfig({ baseUrl: e.target.value })}
                className="w-full px-3 py-1.5 bg-bg-base border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent" />
              {(() => {
                const pair = PROXY_PAIRS.find(p => embedding.baseUrl === p.proxy || embedding.baseUrl === p.direct)
                if (!pair) return null
                const isProxy = embedding.baseUrl === pair.proxy
                return isProxy ? (
                  <button onClick={() => setEmbeddingConfig({ baseUrl: pair.direct })}
                    className="mt-1 text-[11px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
                    🔗 切换到直连(线上部署用)
                  </button>
                ) : hasLocalProviderProxy() ? (
                  <button onClick={() => setEmbeddingConfig({ baseUrl: pair.proxy })}
                    className="mt-1 text-[11px] px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors">
                    🔄 切换到本地代理(本地运行用)
                  </button>
                ) : null
              })()}
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">嵌入模型</label>
              <input type="text" value={embedding.model} onChange={e => setEmbeddingConfig({ model: e.target.value })}
                className="w-full px-3 py-1.5 bg-bg-base border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-secondary mb-1">API Key <span className="text-text-muted">(本地 Ollama 可留空)</span></label>
            <input type="password" value={embedding.apiKey} onChange={e => setEmbeddingConfig({ apiKey: e.target.value })}
              placeholder="sk-..." className="w-full px-3 py-1.5 bg-bg-base border border-border rounded text-text-primary text-xs focus:outline-none focus:border-accent" />
            {hasUnmatchedSessionCredentialV1('embedding') && (
              <p className="mt-2 text-xs text-text-secondary" role="status">临时 API Key 未能与当前配置匹配，请确认嵌入服务地址后重新填写。</p>
            )}
          </div>
          <p className="text-[11px] text-text-muted">
            语义向量幂等可续跑;新写章节在接受时会自动建索引。约百万字嵌一次,云端约 ¥0.2、本地免费。
          </p>
        </div>
      )}
    </div>
  )
}
