/**
 * Phase 28.1 — 分析结果去重、合并与结构化
 *
 * - 维度合并：每个维度聚合所有 chunk 的分析，去重后按 chunk 顺序排列（本地，纯展示去重）
 * - 角色合并：由 AI 完成（见 buildCharacterMergePrompt / parseCharacterMergeOutput）。
 *   原 Phase 28.1 用正则从分析文本抠人名 + 句子切分，准确率低、同一角色会重复，
 *   现按"文本提取一律用 AI 不用正则"原则改为 AI 聚合。
 */

import type { ReferenceChunkAnalysis, AnalysisDimension } from '../types/reference'
import { ANALYSIS_DIMENSIONS, DIMENSION_LABELS } from '../types/reference'

/** AI 聚合后的角色卡（去重合并好的，同一人的不同称呼/不同块归为一个） */
export interface AIMergedCharacter {
  name: string
  role?: string       // 主角 / 反派 / 配角 等（AI 判断）
  summary: string     // 一句话定位
  analysis: string    // 合并后的人物塑造手法分析
}

/** 单条合并后的分析条目 */
export interface MergedAnalysisItem {
  /** 分析文本 */
  text: string
  /** 来源 chunk 标注（如"块 1 · 第 1-3 章"） */
  sourceLabel: string
  /** chunk 序号 */
  chunkIndex: number
}

/** 某个维度的合并结果 */
export interface MergedDimension {
  dimension: AnalysisDimension
  label: string
  items: MergedAnalysisItem[]
  /** 该维度的精炼摘要（可选，28.3 AI 总结后填入） */
  summary?: string
}

/** 角色合并卡片 */
export interface MergedCharacterCard {
  /** 角色名 */
  name: string
  /** 所有出处的合并分析 */
  analyses: MergedAnalysisItem[]
}

/** 全书合并结果 */
export interface MergedAnalysisResult {
  /** 按维度合并的分析 */
  dimensions: MergedDimension[]
  /** 角色合并卡片（从 characterCraft 中提取） */
  characters: MergedCharacterCard[]
  /** 总块数 */
  totalChunks: number
}

/**
 * 文本相似度（Jaccard on character 2-gram）
 * 返回 0~1，越大越相似
 */
function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const ngram = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const sa = ngram(a)
  const sb = ngram(b)
  let inter = 0
  for (const g of sa) if (sb.has(g)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * 核心：合并分析结果
 */
export function mergeAnalysisResults(
  chunks: ReferenceChunkAnalysis[],
  isHistorical: boolean,
): MergedAnalysisResult {
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
  const totalChunks = sorted.length

  // 根据是否历史资料过滤维度
  const histDims = new Set<AnalysisDimension>([
    'historicalContext', 'socialInstitutions', 'dailyLife', 'materialCulture', 'languageCustoms',
  ])
  const visibleDimensions = ANALYSIS_DIMENSIONS.filter(dim => {
    if (isHistorical) return true // 历史资料展示所有维度
    return !histDims.has(dim) // 普通小说不展示历史维度
  })

  const dimensions: MergedDimension[] = []

  for (const dim of visibleDimensions) {
    const items: MergedAnalysisItem[] = []
    const seen: string[] = [] // 已收录文本的前 60 字，用于去重

    for (const chunk of sorted) {
      const raw = chunk[dim]
      if (!raw || typeof raw !== 'string') continue
      const text = raw.trim()
      if (!text || text === '本块未涉及') continue

      // 去重：与已有条目的相似度超过 0.6 则跳过
      const prefix = text.slice(0, 60)
      const isDup = seen.some(s => textSimilarity(s, prefix) > 0.6)
      if (isDup) continue

      seen.push(prefix)
      items.push({
        text,
        sourceLabel: chunk.label
          ? `块 ${chunk.chunkIndex + 1} · ${chunk.label}`
          : `块 ${chunk.chunkIndex + 1}`,
        chunkIndex: chunk.chunkIndex,
      })
    }

    dimensions.push({
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      items,
    })
  }

  // 角色合并由 AI 完成（见 buildCharacterMergePrompt / parseCharacterMergeOutput），
  // 此处不再用正则从分析文本抠人名。characters 留空，由组件触发 AI 聚合后从
  // reference.mergedCharacters 读取展示。
  const characters: MergedCharacterCard[] = []

  return { dimensions, characters, totalChunks }
}

/** 收集所有分块的 characterCraft（人物塑造）分析文本，供 AI 角色聚合使用 */
export function collectCharacterCraftTexts(chunks: ReferenceChunkAnalysis[]): string[] {
  return [...chunks]
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map(c => {
      const text = c.characterCraft
      if (!text || typeof text !== 'string' || text.trim() === '' || text.trim() === '本块未涉及') return ''
      const label = c.label ? `块 ${c.chunkIndex + 1} · ${c.label}` : `块 ${c.chunkIndex + 1}`
      return `【${label}】\n${text.trim()}`
    })
    .filter(Boolean)
}

/**
 * 构建「AI 角色卡聚合」prompt。
 * 让 AI 阅读所有分块的人物塑造分析，把同一角色（含不同称呼、不同分块出现）
 * 归并为一张去重后的角色卡，彻底避免正则抠名导致的角色重复。
 */
export function buildCharacterMergePrompt(
  title: string,
  author: string,
  craftTexts: string[],
): { system: string; user: string } {
  const system = `你是一位资深的小说人物分析专家。下面给你的是同一部作品被分成多个文本块后、每一块各自的「人物塑造手法」分析。同一个角色往往会在多个块里出现，也可能用不同的称呼（本名、绰号、身份代称等）指代同一人。

你的任务：把这些分块分析归并成一份**去重后的角色清单**。要求：
1. 同一个角色（即使在不同块、用不同称呼出现）必须合并成**一条**，绝不能重复列出。
2. 只保留确有人物塑造分析价值的角色（主角、重要配角、关键反派等），忽略一笔带过、没有塑造手法可言的龙套。
3. 每个角色给出：统一的角色名（取最常用、最正式的称呼）、角色定位（如主角/反派/配角）、一句话定位、以及综合所有分块后的人物塑造手法分析。
4. 严格输出纯 JSON，不要任何解释、不要 markdown 代码围栏。`

  const user = `作品：「${title}」 作者：${author || '未知'}

以下是各分块的「人物塑造手法」分析：

${craftTexts.join('\n\n')}

请输出去重合并后的角色清单，格式为 JSON：
{
  "characters": [
    {
      "name": "角色名",
      "role": "主角/反派/配角等",
      "summary": "一句话定位（20 字内）",
      "analysis": "综合所有分块后的人物塑造手法分析（100-300 字）"
    }
  ]
}`

  return { system, user }
}

/** 解析 AI 角色聚合输出为 AIMergedCharacter[] */
export function parseCharacterMergeOutput(raw: string): AIMergedCharacter[] {
  let jsonText = raw.trim()
  // 去除可能的 markdown 围栏
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) jsonText = fenceMatch[1].trim()
  // 截取首个 { 到末个 }
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')
  if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1)

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return []
  }

  const arr = (parsed as { characters?: unknown })?.characters
  if (!Array.isArray(arr)) return []

  const result: AIMergedCharacter[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name.trim() : ''
    if (!name) continue
    // 归一化去重（防止 AI 偶发重复）
    const key = name.replace(/[\s·・\-—_]+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      name,
      role: typeof obj.role === 'string' ? obj.role.trim() : undefined,
      summary: typeof obj.summary === 'string' ? obj.summary.trim() : '',
      analysis: typeof obj.analysis === 'string' ? obj.analysis.trim() : '',
    })
  }
  return result
}

/**
 * 生成 AI 全书总结的 prompt
 */
export function buildSummaryPrompt(
  title: string,
  author: string,
  merged: MergedAnalysisResult,
  isHistorical: boolean,
): { system: string; user: string } {
  // 把每个维度的前 3 条拼成概述
  const dimSummaries = merged.dimensions
    .filter(d => d.items.length > 0)
    .map(d => {
      const samples = d.items.slice(0, 3).map(i => i.text.slice(0, 200)).join('\n')
      return `【${d.label}】\n${samples}`
    })
    .join('\n\n')

  const system = isHistorical
    ? `你是一位历史文献分析专家。请根据以下分块分析的汇总，为这部历史资料撰写一份精炼的全书总结。每个维度 100-200 字，重点提炼可直接用于小说创作的时代细节和考证要点。输出纯 JSON。`
    : `你是一位资深文学评论家。请根据以下分块分析的汇总，为这部小说撰写一份精炼的全书总结。每个维度 100-200 字，重点提炼最核心的创作方法论和值得学习的技巧。输出纯 JSON。`

  const dimKeys = merged.dimensions.filter(d => d.items.length > 0).map(d => d.dimension)

  const user = `作品：「${title}」 作者：${author || '未知'}

以下是各维度的分块分析汇总：

${dimSummaries}

请为以上每个维度输出一段 100-200 字的精炼总结，格式为 JSON：
{
${dimKeys.map(k => `  "${k}": "（该维度的全书总结）"`).join(',\n')}
}`

  return { system, user }
}
