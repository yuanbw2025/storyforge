/**
 * Phase 30.1 — 细纲 + 章节正文 批量生成引擎
 *
 * 功能：
 * 1. batchGenerateDetails: 对无细纲的章节批量调用完善细纲 AI
 * 2. batchGenerateChapters: 对空/少于阈值字数的章节批量生成正文
 *
 * 均支持：进度回调、AbortSignal 中途停止、单章失败不中断。
 */

import { chat } from './client'
import { useAIConfigStore } from '../../stores/ai-config'
import { buildEnhancedDetailPrompt, parseEnhancedDetailSmart } from './adapters/detail-scene-adapter'
import { buildChapterContentPrompt } from './adapters/chapter-adapter'
import type { OutlineNode, DetailedOutline } from '../types'
import type { ScenePace } from '../types/detailed-outline'
import { nanoid } from '../utils/id'

// ── 公共类型 ─────────────────────────────────────────────────────

export interface BatchProgress {
  current: number
  total: number
  currentTitle: string
  stage: string
  /** 已完成数（含失败跳过的） */
  completed: number
  /** 失败的章节标题列表 */
  failures: string[]
}

// ── 批量细纲 ─────────────────────────────────────────────────────

export interface BatchDetailOptions {
  /** 需要生成细纲的章节节点列表（按 order 排好序） */
  chapters: OutlineNode[]
  /** 已有细纲列表（用于跳过） */
  existingDetails: DetailedOutline[]
  /** 世界观上下文（单一，作为兜底） */
  worldContext: string
  /** 多世界：按章解析各自世界上下文（提供则逐章覆盖 worldContext） */
  worldContextResolver?: (chapterNodeId: number) => Promise<string>
  /** 角色上下文（ID:name 列表） */
  characterContext: string
  /** 伏笔上下文 */
  foreshadowContext: string
  /** 保存回调：把生成的细纲数据写入 store/DB */
  onSave: (outlineNodeId: number, data: Partial<DetailedOutline>) => Promise<void>
  onProgress?: (p: BatchProgress) => void
  signal?: AbortSignal
}

export interface BatchDetailResult {
  generated: number
  skipped: number
  failed: number
  cancelled: boolean
  elapsed: number
}

/** 批量生成细纲：跳过已有、串行调用 AI、逐个保存 */
export async function batchGenerateDetails(
  opts: BatchDetailOptions,
): Promise<BatchDetailResult> {
  const { chapters, existingDetails, worldContext, worldContextResolver, characterContext, foreshadowContext, onSave, onProgress, signal } = opts
  const config = useAIConfigStore.getState().config
  const start = Date.now()

  // 过滤出需要生成的
  const detailNodeIds = new Set(existingDetails.filter(d => d.scenes.length > 0).map(d => d.outlineNodeId))
  const todo = chapters.filter(ch => !detailNodeIds.has(ch.id!))

  let generated = 0
  let failed = 0
  const failures: string[] = []

  for (let i = 0; i < todo.length; i++) {
    if (signal?.aborted) {
      return { generated, skipped: chapters.length - todo.length, failed, cancelled: true, elapsed: Date.now() - start }
    }

    const ch = todo[i]
    const idx = chapters.indexOf(ch)
    const prevSummary = idx > 0 ? (chapters[idx - 1].summary || '') : ''
    const nextSummary = idx < chapters.length - 1 ? (chapters[idx + 1].summary || '') : ''

    onProgress?.({
      current: i + 1,
      total: todo.length,
      currentTitle: ch.title,
      stage: `正在生成「${ch.title}」的细纲...`,
      completed: i,
      failures,
    })

    try {
      // 多世界：用本章所属世界的上下文
      const chWorldContext = worldContextResolver ? await worldContextResolver(ch.id!) : worldContext
      const messages = buildEnhancedDetailPrompt(
        ch.title,
        ch.summary || '',
        prevSummary,
        nextSummary,
        chWorldContext,
        characterContext,
        foreshadowContext,
      )

      const rawOutput = await chat(messages, config, { category: 'detail.scene', projectId: ch.projectId })
      if (signal?.aborted) {
        return { generated, skipped: chapters.length - todo.length, failed, cancelled: true, elapsed: Date.now() - start }
      }

      const parsed = await parseEnhancedDetailSmart(rawOutput, config)
      if (parsed) {
        const data: Partial<DetailedOutline> = {}
        if (parsed.openingHook) data.openingHook = parsed.openingHook
        if (parsed.endingCliffhanger) data.endingCliffhanger = parsed.endingCliffhanger
        if (parsed.sceneLocation) data.sceneLocation = parsed.sceneLocation
        if (parsed.emotionArc) data.emotionArc = parsed.emotionArc as DetailedOutline['emotionArc']
        if (parsed.appearingCharacterIds) data.appearingCharacterIds = parsed.appearingCharacterIds
        if (parsed.foreshadowIds) data.foreshadowIds = parsed.foreshadowIds
        // Phase 30.3: 快照大纲摘要
        data.lastUsedSummary = ch.summary || ''

        if (parsed.scenes && parsed.scenes.length > 0) {
          data.scenes = parsed.scenes.map(s => ({
            sceneId: nanoid(),
            title: s.title,
            summary: s.summary,
            characterIds: s.characterIds || [],
            location: s.location || '',
            conflict: s.conflict || '',
            pace: (s.pace || 'medium') as ScenePace,
            estimatedWords: s.estimatedWords || 0,
            notes: '',
          }))
        }

        await onSave(ch.id!, data)
        generated++
      } else {
        failed++
        failures.push(ch.title)
      }
    } catch (err) {
      console.error(`[BatchDetail] 「${ch.title}」生成失败:`, err)
      failed++
      failures.push(ch.title)
    }
  }

  onProgress?.({
    current: todo.length,
    total: todo.length,
    currentTitle: '',
    stage: `完成！生成 ${generated}，跳过 ${chapters.length - todo.length}，失败 ${failed}`,
    completed: todo.length,
    failures,
  })

  return {
    generated,
    skipped: chapters.length - todo.length,
    failed,
    cancelled: false,
    elapsed: Date.now() - start,
  }
}

// ── 批量章节正文 ──────────────────────────────────────────────────

export interface BatchChapterOptions {
  /** 章节列表（带 content） */
  chapters: Array<{
    id: number
    title: string
    summary: string
    content: string
  }>
  /** 字数阈值：content 字数 < threshold 才生成 */
  minWordThreshold: number
  /** 世界观上下文（单一，作为兜底） */
  worldContext: string
  /** 多世界：按章解析各自世界上下文（提供则逐章覆盖 worldContext） */
  worldContextResolver?: (chapterNodeId: number) => Promise<string>
  characterContext: string
  /** 保存回调 */
  onSave: (chapterId: number, content: string) => Promise<void>
  onProgress?: (p: BatchProgress) => void
  signal?: AbortSignal
}

export interface BatchChapterResult {
  generated: number
  skipped: number
  failed: number
  cancelled: boolean
  elapsed: number
}

/** 批量生成章节正文：跳过已有足够内容的章节 */
export async function batchGenerateChapters(
  opts: BatchChapterOptions,
): Promise<BatchChapterResult> {
  const {
    chapters,
    minWordThreshold,
    worldContext,
    worldContextResolver,
    characterContext,
    onSave,
    onProgress,
    signal,
  } = opts
  const config = useAIConfigStore.getState().config
  const start = Date.now()

  const todo = chapters.filter(ch => (ch.content || '').length < minWordThreshold)

  let generated = 0
  let failed = 0
  const failures: string[] = []

  for (let i = 0; i < todo.length; i++) {
    if (signal?.aborted) {
      return { generated, skipped: chapters.length - todo.length, failed, cancelled: true, elapsed: Date.now() - start }
    }

    const ch = todo[i]
    const idx = chapters.indexOf(ch)
    const prevEnding = idx > 0
      ? (chapters[idx - 1].content || '').slice(-500)
      : ''

    onProgress?.({
      current: i + 1,
      total: todo.length,
      currentTitle: ch.title,
      stage: `正在生成「${ch.title}」正文...`,
      completed: i,
      failures,
    })

    try {
      const chWorldContext = worldContextResolver ? await worldContextResolver(ch.id) : worldContext
      const messages = buildChapterContentPrompt(
        ch.title,
        ch.summary || '',
        chWorldContext,
        characterContext,
        prevEnding,
      )

      const content = await chat(messages, config)
      if (signal?.aborted) {
        return { generated, skipped: chapters.length - todo.length, failed, cancelled: true, elapsed: Date.now() - start }
      }

      if (content && content.trim().length > 50) {
        await onSave(ch.id, content.trim())
        generated++
      } else {
        failed++
        failures.push(ch.title)
      }
    } catch (err) {
      console.error(`[BatchChapter] 「${ch.title}」生成失败:`, err)
      failed++
      failures.push(ch.title)
    }
  }

  onProgress?.({
    current: todo.length,
    total: todo.length,
    currentTitle: '',
    stage: `完成！生成 ${generated}，跳过 ${chapters.length - todo.length}，失败 ${failed}`,
    completed: todo.length,
    failures,
  })

  return {
    generated,
    skipped: chapters.length - todo.length,
    failed,
    cancelled: false,
    elapsed: Date.now() - start,
  }
}
