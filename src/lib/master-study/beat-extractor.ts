/**
 * 章节节奏点提取器（Phase 19-c Layer 2）
 *
 * 串行逐章调用 AI，提取 opening/conflict/reversal/climax/hook/foreshadow/relief
 * 等节奏点，结果写入 masterChapterBeats 表。
 */
import { db } from '../db/schema'
import { chat } from '../ai/client'
import { renderPrompt } from '../ai/prompt-engine'
import { usePromptStore } from '../../stores/prompt'
import { extractJSON } from '../ai/adapters/import-adapter'
import { getMasterAIConfig } from './model-resolver'
import type { AIConfig, ChatMessage } from '../types'
import type { MasterWork, MasterChapterBeat, BeatType } from '../types'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 1500
const VALID_BEAT_TYPES = new Set<BeatType>([
  'opening', 'conflict', 'reversal', 'climax', 'hook', 'foreshadow', 'relief',
])

export interface ChapterSlice {
  index: number
  label?: string
  text: string
}

export interface BeatExtractorListener {
  onProgress?: (done: number, total: number) => void
  onActivity?: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void
}

let abortController: AbortController | null = null

export function cancelBeatExtraction() {
  abortController?.abort()
}

export function isBeatExtractionRunning(): boolean {
  return abortController !== null
}

export async function extractChapterBeats(
  work: MasterWork,
  chapters: ChapterSlice[],
  listener?: BeatExtractorListener,
): Promise<number> {
  if (!work.id) return 0

  abortController = new AbortController()
  const signal = abortController.signal

  const existing = await db.masterChapterBeats.where('workId').equals(work.id).toArray()
  const doneSet = new Set(existing.map(b => b.chapterIndex))

  let totalInserted = existing.length
  const total = chapters.length

  listener?.onActivity?.('info', `▶ 开始节奏分析，共 ${total} 章`)

  for (const ch of chapters) {
    if (signal.aborted) break
    if (doneSet.has(ch.index)) {
      listener?.onProgress?.(ch.index + 1, total)
      continue
    }

    let ok = false
    let lastErr = ''
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) break
      listener?.onActivity?.('info',
        `▶ 第 ${ch.index + 1}/${total} 章分析中（第 ${attempt + 1} 次）`)
      try {
        const beats = await extractOnce(work, ch, signal)
        const rows: MasterChapterBeat[] = beats.map(b => ({
          workId: work.id!,
          chapterIndex: ch.index,
          chapterLabel: ch.label,
          position: clamp(b.position ?? 0, 0, 100),
          type: VALID_BEAT_TYPES.has(b.type) ? b.type : 'conflict',
          excerpt: (b.excerpt || '').slice(0, 200),
          note: (b.note || '').slice(0, 200),
        }))
        await db.masterChapterBeats.bulkAdd(rows)
        totalInserted += rows.length
        listener?.onActivity?.('success', `✓ 第 ${ch.index + 1} 章提取 ${rows.length} 个节奏点`)
        listener?.onProgress?.(ch.index + 1, total)
        ok = true
        break
      } catch (err) {
        if ((err as Error).name === 'AbortError') break
        lastErr = err instanceof Error ? err.message : String(err)
        listener?.onActivity?.('warn',
          `第 ${ch.index + 1} 章第 ${attempt + 1} 次失败：${lastErr.slice(0, 80)}`)
        if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS)
      }
    }
    if (!ok && !signal.aborted) {
      listener?.onActivity?.('error',
        `✗ 第 ${ch.index + 1} 章失败：${lastErr.slice(0, 80)}`)
    }
  }

  abortController = null
  listener?.onActivity?.('info', `节奏分析结束，共提取 ${totalInserted} 个节奏点`)
  return totalInserted
}

interface RawBeat {
  position?: number
  type: BeatType
  excerpt?: string
  note?: string
}

async function extractOnce(
  work: MasterWork,
  ch: ChapterSlice,
  signal: AbortSignal,
): Promise<RawBeat[]> {
  const tpl = usePromptStore.getState().getActive('master.extract-beats')
  const { messages } = renderPrompt(tpl, {
    workTitle: work.title,
    workAuthor: work.author || '',
    chapterIndex: ch.index + 1,
    chapterLabel: ch.label || '',
    chapterChars: ch.text.length,
    rawChapter: ch.text,
  })
  const config: AIConfig = getMasterAIConfig(4096)
  if (!config.apiKey) throw new Error('未配置 AI API Key')
  const output = await chatWithAbort(messages, config, signal)
  const parsed = extractJSON(output)
  if (Array.isArray(parsed)) return parsed as RawBeat[]
  return []
}

async function chatWithAbort(
  messages: ChatMessage[],
  config: AIConfig,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e
  }
  return await chat(messages, config, undefined, signal)
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * 把原文按章节标题切分（简单启发式）。
 * 匹配「第X章」「第X回」等常见格式。
 */
export function splitIntoChapters(text: string): ChapterSlice[] {
  const lines = text.split('\n')
  const chapters: ChapterSlice[] = []
  let current: { label: string; lines: string[]; startLine: number } | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^第[零一二三四五六七八九十百千万\d]+[章回节]/.test(trimmed)) {
      if (current && current.lines.length > 0) {
        chapters.push({
          index: chapters.length,
          label: current.label,
          text: current.lines.join('\n'),
        })
      }
      current = { label: trimmed.slice(0, 50), lines: [], startLine: 0 }
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current && current.lines.length > 0) {
    chapters.push({
      index: chapters.length,
      label: current.label,
      text: current.lines.join('\n'),
    })
  }

  if (chapters.length === 0) {
    const chunkSize = 5000
    for (let i = 0; i < text.length; i += chunkSize) {
      chapters.push({
        index: chapters.length,
        label: `段落 ${chapters.length + 1}`,
        text: text.slice(i, i + chunkSize),
      })
    }
  }

  return chapters
}
