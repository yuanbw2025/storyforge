/**
 * 跨作品洞察归纳器（Phase 19-d Layer 3）
 *
 * 读取多本已完成作品的 Layer 1 五维分析，调用 AI 归纳共性方法论，
 * 产出 MasterInsight 记录写入 DB。
 */
import { db } from '../db/schema'
import { chat } from '../ai/client'
import { renderPrompt } from '../ai/prompt-engine'
import { usePromptStore } from '../../stores/prompt'
import { useAIConfigStore } from '../../stores/ai-config'
import { extractJSON } from '../ai/adapters/import-adapter'
import type { AIConfig, ChatMessage } from '../types'
import type { MasterInsight } from '../types'

const ANALYSIS_DIMS = [
  'worldviewPattern', 'characterDesign', 'plotRhythm', 'foreshadowing', 'proseStyle',
] as const

const DIM_LABELS: Record<string, string> = {
  worldviewPattern: '世界观范式',
  characterDesign: '角色设计',
  plotRhythm: '情节节奏',
  foreshadowing: '伏笔悬念',
  proseStyle: '文笔语言',
}

export interface InsightGeneratorListener {
  onActivity?: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void
}

interface RawInsight {
  title?: string
  genre?: string
  description?: string
  bulletPoints?: string[]
}

export async function generateInsights(
  workIds: number[],
  opts?: { genre?: string; insightCount?: number },
  listener?: InsightGeneratorListener,
): Promise<MasterInsight[]> {
  const insightCount = opts?.insightCount ?? 5

  listener?.onActivity?.('info', `▶ 开始归纳洞察，涉及 ${workIds.length} 本作品`)

  const summaries = await buildAnalysisSummaries(workIds, listener)
  if (!summaries) {
    listener?.onActivity?.('error', '未找到已完成的分析数据')
    return []
  }

  listener?.onActivity?.('info', '▶ 调用 AI 归纳跨作品方法论…')

  const tpl = usePromptStore.getState().getActive('master.generate-insights')
  const { messages } = renderPrompt(tpl, {
    genre: opts?.genre || '',
    workCount: workIds.length,
    insightCount,
    analysisSummaries: summaries,
  })

  const baseConfig = useAIConfigStore.getState().config
  const config: AIConfig = { ...baseConfig, maxTokens: 4096 }
  if (!config.apiKey) throw new Error('未配置 AI API Key')

  const output = await chat(messages as ChatMessage[], config)
  const parsed = extractJSON(output)

  if (!Array.isArray(parsed)) {
    listener?.onActivity?.('error', 'AI 输出格式异常，未能解析')
    return []
  }

  const now = Date.now()
  const results: MasterInsight[] = []

  for (const raw of parsed as RawInsight[]) {
    if (!raw.title || !raw.description) continue
    const insight: MasterInsight = {
      title: raw.title.slice(0, 100),
      genre: raw.genre || opts?.genre || undefined,
      description: raw.description.slice(0, 2000),
      bulletPoints: Array.isArray(raw.bulletPoints)
        ? raw.bulletPoints.map(s => String(s).slice(0, 200)).slice(0, 8)
        : [],
      sourceWorkIds: workIds,
      createdAt: now,
      updatedAt: now,
    }
    const id = (await db.masterInsights.add(insight)) as number
    results.push({ ...insight, id })
  }

  listener?.onActivity?.('success', `✓ 归纳出 ${results.length} 条洞察`)
  return results
}

async function buildAnalysisSummaries(
  workIds: number[],
  listener?: InsightGeneratorListener,
): Promise<string> {
  const parts: string[] = []

  for (const workId of workIds) {
    const work = await db.masterWorks.get(workId)
    if (!work || work.status !== 'done') continue

    const chunks = await db.masterChunkAnalysis
      .where('workId').equals(workId)
      .sortBy('chunkIndex')

    if (!chunks.length) continue

    listener?.onActivity?.('info', `  读取「${work.title}」的 ${chunks.length} 块分析…`)

    const dimSummaries: string[] = []
    for (const dim of ANALYSIS_DIMS) {
      const contents = chunks
        .map(c => c[dim])
        .filter((v): v is string => !!v && v !== '（本块无明显此维度信息）')

      if (!contents.length) continue
      const selected = contents.slice(0, 4).map(t => t.slice(0, 200))
      dimSummaries.push(`  · ${DIM_LABELS[dim]}：${selected.join('；')}`)
    }

    if (dimSummaries.length) {
      parts.push(
        `═══ ${work.title}${work.author ? `（${work.author}）` : ''}${work.genre ? ` [${work.genre}]` : ''} ═══\n` +
        `总字数：${(work.totalChars / 10000).toFixed(1)} 万字，分析深度：${work.analysisDepth}\n` +
        dimSummaries.join('\n'),
      )
    }
  }

  return parts.join('\n\n')
}
