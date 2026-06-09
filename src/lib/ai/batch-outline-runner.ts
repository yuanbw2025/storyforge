/**
 * 批量大纲生成器 — Phase D1
 *
 * 按卷循环生成章节大纲，每生成一章就把该章摘要加入上下文传给下一章，
 * 保持故事线连贯。支持中途取消、进度回调。
 */
import { chat } from './client'
import { buildChapterOutlinePrompt } from './adapters/outline-adapter'
import { parseChapterOutlineSmart, type ParsedChapter } from './parse-outline-output'
import { useAIConfigStore } from '../../stores/ai-config'
import type { OutlineNode } from '../types'

export interface BatchOutlineProgress {
  /** 当前正在处理的卷索引（0-based） */
  currentVolumeIndex: number
  /** 总卷数 */
  totalVolumes: number
  /** 当前卷标题 */
  currentVolumeTitle: string
  /** 当前卷已解析出的章节 */
  parsedChapters: ParsedChapter[]
  /** 累计已完成的卷数 */
  completedVolumes: number
  /** 阶段描述 */
  stage: string
}

export interface BatchOutlineResult {
  /** 按卷 ID 分组的章节列表 */
  chaptersByVolume: Map<number, ParsedChapter[]>
  /** 是否被用户取消 */
  cancelled: boolean
  /** 总耗时(ms) */
  elapsed: number
}

export interface BatchOutlineOptions {
  /** 要处理的卷列表（已排序） */
  volumes: OutlineNode[]
  /** 世界观上下文（单一，作为兜底） */
  worldContext: string
  /** 多世界：按卷解析各自世界上下文（提供则逐卷覆盖 worldContext） */
  worldContextResolver?: (volumeId: number) => Promise<string>
  /** 用户补充说明 */
  userHint?: string
  /** 角色上下文 */
  characterContext?: string
  /** Phase 32: 世界规则清单（替代旧 historicalContext + creativeMode） */
  worldRulesContext?: string
  /** 多世界：按卷解析各自世界规则（提供则逐卷覆盖 worldRulesContext） */
  worldRulesContextResolver?: (volumeId: number) => Promise<string>
  /** 进度回调 */
  onProgress?: (progress: BatchOutlineProgress) => void
  /** 取消信号 */
  signal?: AbortSignal
}

/**
 * 批量生成章节大纲
 *
 * 按卷顺序逐个调用 AI，前一卷的生成结果作为上下文注入后续卷。
 */
export async function runBatchOutlineGeneration(
  options: BatchOutlineOptions,
): Promise<BatchOutlineResult> {
  const {
    volumes,
    worldContext,
    worldContextResolver,
    userHint,
    characterContext,
    worldRulesContext,
    worldRulesContextResolver,
    onProgress,
    signal,
  } = options
  const config = useAIConfigStore.getState().config
  const chaptersByVolume = new Map<number, ParsedChapter[]>()
  const startTime = Date.now()

  let prevVolumeChaptersSummary = ''

  for (let i = 0; i < volumes.length; i++) {
    // 检查取消
    if (signal?.aborted) {
      return { chaptersByVolume, cancelled: true, elapsed: Date.now() - startTime }
    }

    const vol = volumes[i]
    const volId = vol.id!

    onProgress?.({
      currentVolumeIndex: i,
      totalVolumes: volumes.length,
      currentVolumeTitle: vol.title,
      parsedChapters: [],
      completedVolumes: i,
      stage: `正在生成「${vol.title}」的章节大纲...`,
    })

    // 构建前序摘要：上一卷的章节梗概
    const prevSummary = prevVolumeChaptersSummary
      || (i > 0 ? volumes[i - 1].summary : '')

    // 多世界：用本卷所属世界的上下文
    const volWorldContext = worldContextResolver ? await worldContextResolver(volId) : worldContext
    const volWorldRulesContext = worldRulesContextResolver
      ? await worldRulesContextResolver(volId)
      : worldRulesContext

    const messages = buildChapterOutlinePrompt(
      vol.title,
      vol.summary,
      volWorldContext,
      prevSummary,
      userHint,
      undefined, // options
      characterContext,
      volWorldRulesContext,
    )

    try {
      const rawOutput = await chat(messages, config, { category: 'outline.chapter', projectId: vol.projectId })

      if (signal?.aborted) {
        return { chaptersByVolume, cancelled: true, elapsed: Date.now() - startTime }
      }

      const parsed = await parseChapterOutlineSmart(rawOutput, config)
      chaptersByVolume.set(volId, parsed)

      // 把本卷章节摘要串联，作为下一卷的前序上下文
      prevVolumeChaptersSummary = parsed
        .map((ch, idx) => `${idx + 1}. ${ch.title}：${ch.summary}`)
        .join('\n')
        .slice(0, 800) // 限制 token

      onProgress?.({
        currentVolumeIndex: i,
        totalVolumes: volumes.length,
        currentVolumeTitle: vol.title,
        parsedChapters: parsed,
        completedVolumes: i + 1,
        stage: `「${vol.title}」完成，生成了 ${parsed.length} 章`,
      })
    } catch (err) {
      if (signal?.aborted) {
        return { chaptersByVolume, cancelled: true, elapsed: Date.now() - startTime }
      }
      // 单卷失败不中断，记录空结果继续
      console.error(`[BatchOutline] 卷「${vol.title}」生成失败:`, err)
      chaptersByVolume.set(volId, [])

      onProgress?.({
        currentVolumeIndex: i,
        totalVolumes: volumes.length,
        currentVolumeTitle: vol.title,
        parsedChapters: [],
        completedVolumes: i + 1,
        stage: `「${vol.title}」生成失败，已跳过`,
      })
    }
  }

  return {
    chaptersByVolume,
    cancelled: false,
    elapsed: Date.now() - startTime,
  }
}
