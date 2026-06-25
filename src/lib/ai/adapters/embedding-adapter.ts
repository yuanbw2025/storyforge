/**
 * NS-5 · Embedding 适配器 — 语义检索通道的唯一出口。
 *
 * 走 OpenAI 兼容 /embeddings 端点（{model, input:[...]} → {data:[{embedding:[...]}]}）。
 * 批量嵌入（一次多段省往返）；带超时重试；消耗记到 'retrieval.embed' 分类。
 * 失败抛错由调用方决定降级——绝不污染主流程。
 */
import type { EmbeddingConfig } from '../../types'
import { recordUsage } from '../usage-log'
import { estimateTokens } from '../context-budget'

/** 当前向量所属模型标识（换 provider/model 即视为失效，绝不跨模型混算余弦）。 */
export function embeddingModelTag(cfg: EmbeddingConfig): string {
  return `${cfg.provider}:${cfg.model}`
}

/** 配置是否可用于真正发起嵌入调用。 */
export function isEmbeddingReady(cfg: EmbeddingConfig | null | undefined): cfg is EmbeddingConfig {
  return !!(cfg && cfg.enabled && cfg.baseUrl && cfg.model && (cfg.apiKey || cfg.provider === 'ollama'))
}

const EMBED_TIMEOUT_MS = 60_000

/**
 * 批量把文本嵌成向量。返回与 input 等长、同序的向量数组。
 * 任一失败抛错（调用方据此降级到纯关键词）。
 */
export async function embedTexts(
  texts: string[],
  cfg: EmbeddingConfig,
  projectId?: number | null,
  signal?: AbortSignal,
): Promise<number[][]> {
  if (!texts.length) return []
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal) signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`embedding HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = await res.json() as { data?: Array<{ embedding?: number[]; index?: number }> }
    const data = json.data
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error(`embedding 返回条数不符：期望 ${texts.length}，实得 ${data?.length ?? 0}`)
    }
    // 按 index 归位（多数实现已有序，仍按 index 防错位）
    const out: number[][] = new Array(texts.length)
    data.forEach((d, i) => {
      const vec = d.embedding
      if (!Array.isArray(vec) || !vec.length) throw new Error('embedding 向量为空')
      const at = typeof d.index === 'number' && d.index >= 0 && d.index < texts.length ? d.index : i
      out[at] = vec
    })
    // 消耗记账（嵌入只有输入，无输出）
    const inputTokens = texts.reduce((s, t) => s + estimateTokens(t), 0)
    void recordUsage({ projectId: projectId ?? null, timestamp: Date.now(), category: 'retrieval.embed', model: cfg.model, inputTokens, outputTokens: 0 })
    return out
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}
