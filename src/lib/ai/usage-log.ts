/**
 * AI 消耗统计 — 持久化每次 AI 调用的 token 用量与费用
 *
 * 在 AI 调用链路（client.ts streamChat/chat）的唯一出口记录，按「消耗类型」分类。
 * 类型来源于各 AI 行为的 moduleKey（如 chapter.content / worldview.dimension），
 * 映射为友好中文标签展示。
 */
import { db } from '../db/schema'

/** 一条 AI 消耗记录 */
export interface AIUsageEntry {
  id?: number
  projectId?: number | null
  timestamp: number
  /** 消耗类型标识（moduleKey 或显式 category，如 'chapter.content'） */
  category: string
  model: string
  inputTokens: number
  outputTokens: number
  /** 计算所得费用（美元） */
  costUsd: number
}

// ── 消耗类型 → 友好标签 + 配色 ────────────────────────────────

interface CategoryMeta { label: string; color: string }

/** moduleKey 前缀 → 类型标签。未命中归「其他」。 */
const CATEGORY_RULES: Array<{ test: (k: string) => boolean; meta: CategoryMeta }> = [
  { test: k => k.startsWith('chapter.content') || k.startsWith('chapter.continue'), meta: { label: '正文生成', color: '#6E8BdE' } },
  { test: k => k.startsWith('chapter.'), meta: { label: '正文润色', color: '#7BA0C8' } },
  { test: k => k.startsWith('outline.'), meta: { label: '大纲生成', color: '#C8956E' } },
  { test: k => k.startsWith('detail.'), meta: { label: '细纲生成', color: '#C8A86E' } },
  { test: k => k.startsWith('worldview.'), meta: { label: '世界观生成', color: '#5EA88A' } },
  { test: k => k.startsWith('story.timeline'), meta: { label: '故事年表提取', color: '#9B8BC0' } },
  { test: k => k.startsWith('story.'), meta: { label: '故事设计生成', color: '#7B9BC0' } },
  { test: k => k.startsWith('rules.'), meta: { label: '创作规则生成', color: '#B0926E' } },
  { test: k => k.startsWith('character.'), meta: { label: '角色生成', color: '#B06B9B' } },
  { test: k => k.startsWith('foreshadow.'), meta: { label: '伏笔生成', color: '#6EB0A8' } },
  { test: k => k.startsWith('storyArc') || k.startsWith('story-arc'), meta: { label: '故事线生成', color: '#8BA86E' } },
  { test: k => k.startsWith('state.extract'), meta: { label: '主角状态提取', color: '#C07B7B' } },
  { test: k => k.startsWith('fact.extract'), meta: { label: '事实抽取(NS-4)', color: '#7B9BC0' } },
  { test: k => k.startsWith('retrieval.embed'), meta: { label: '语义索引(NS-5)', color: '#6EA8B0' } },
  { test: k => k.startsWith('inventory'), meta: { label: '物品提取', color: '#C09B6E' } },
  { test: k => k.startsWith('relation'), meta: { label: '关系提取', color: '#9B6EB0' } },
  { test: k => k.startsWith('scene.verify'), meta: { label: '场景考证', color: '#6E9BC0' } },
  { test: k => k.startsWith('review') || k.startsWith('readability'), meta: { label: '章节审校', color: '#A88B5E' } },
  { test: k => k.startsWith('codex'), meta: { label: '词条/角色聚合', color: '#5E9BA8' } },
  { test: k => k.startsWith('summary'), meta: { label: '摘要生成', color: '#8B8B8B' } },
  { test: k => k.startsWith('inspiration'), meta: { label: '灵感反推', color: '#C0A05E' } },
  { test: k => k.startsWith('world-group'), meta: { label: '世界建议', color: '#5EA8A0' } },
  { test: k => k.startsWith('import'), meta: { label: '导入解析', color: '#8B7BB0' } },
  { test: k => k.startsWith('reference') || k.startsWith('master'), meta: { label: '作品分析', color: '#A07B8B' } },
  { test: k => k === 'test', meta: { label: '连接测试', color: '#888888' } },
]

const OTHER_META: CategoryMeta = { label: '其他', color: '#999999' }

export function categoryMeta(category: string | undefined): CategoryMeta {
  if (!category) return OTHER_META
  return CATEGORY_RULES.find(r => r.test(category))?.meta ?? OTHER_META
}

// ── 价格表（每 1M token 的美元单价；按模型名子串匹配，估算值，可在页面调汇率） ──

interface ModelPrice { input: number; output: number }

const MODEL_PRICING: Array<{ match: (m: string) => boolean; price: ModelPrice }> = [
  { match: m => /gemini.*flash/i.test(m), price: { input: 0.3, output: 2.5 } },
  { match: m => /gemini/i.test(m), price: { input: 1.6, output: 6.0 } },        // 截图：$1.6/1M 输入
  { match: m => /gpt-4o-mini|4o-mini/i.test(m), price: { input: 0.15, output: 0.6 } },
  { match: m => /gpt-4o|gpt-4\.1/i.test(m), price: { input: 2.5, output: 10 } },
  { match: m => /o1|o3/i.test(m), price: { input: 15, output: 60 } },
  { match: m => /claude.*haiku/i.test(m), price: { input: 0.8, output: 4 } },
  { match: m => /claude.*opus/i.test(m), price: { input: 15, output: 75 } },
  { match: m => /claude/i.test(m), price: { input: 3, output: 15 } },
  { match: m => /deepseek/i.test(m), price: { input: 0.27, output: 1.1 } },
  { match: m => /qwen|通义/i.test(m), price: { input: 0.5, output: 2 } },
  { match: m => /kimi|moonshot/i.test(m), price: { input: 1, output: 3 } },
  { match: m => /doubao|豆包/i.test(m), price: { input: 0.3, output: 1 } },
]

const DEFAULT_PRICE: ModelPrice = { input: 1.0, output: 3.0 }

export function modelPrice(model: string): ModelPrice {
  return MODEL_PRICING.find(p => p.match(model || ''))?.price ?? DEFAULT_PRICE
}

/** 按 token 数 + 模型计算美元费用 */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = modelPrice(model)
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

// ── 汇率（美元→人民币），可在页面调整，存 localStorage ──

const RATE_KEY = 'sf-usd-cny-rate'
const DEFAULT_RATE = 7.2

export function getUsdCnyRate(): number {
  const v = Number(localStorage.getItem(RATE_KEY))
  return v > 0 ? v : DEFAULT_RATE
}
export function setUsdCnyRate(rate: number) {
  localStorage.setItem(RATE_KEY, String(rate))
}

// ── 记录入口（client.ts 在拿到 usage 后调用，失败静默不影响主流程） ──

let _enabled = true
export function setUsageLoggingEnabled(on: boolean) { _enabled = on }

export async function recordUsage(entry: Omit<AIUsageEntry, 'id' | 'costUsd'> & { costUsd?: number }): Promise<void> {
  if (!_enabled) return
  try {
    const costUsd = entry.costUsd ?? computeCostUsd(entry.model, entry.inputTokens, entry.outputTokens)
    await db.aiUsageLog.add({ ...entry, costUsd })
  } catch (err) {
    console.warn('[UsageLog] 记录失败（不影响生成）:', err)
  }
}
