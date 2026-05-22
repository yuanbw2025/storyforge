/**
 * 作品学习流水线（Phase 19-b Layer 1 — 五维分析）
 *
 * 独立于 Phase 18 的 import/pipeline：
 *   · 用户的原文不写进项目的世界观/角色/大纲表
 *   · 每块 AI 提炼五维方法论（worldview/character/plot/foreshadow/prose）
 *   · 结果写进 masterChunkAnalysis 表
 *   · 分析深度控制分块粒度 + 单块 maxTokens
 *   · 原文 Blob 存到 importFiles 表（复用 Phase 18 的 session 主键机制，
 *     这里用 "master:<workId>" 负数虚拟 id 占坑不方便，所以我们走独立的
 *     Blob 缓存：由调用方在 start 前把分块文本 register 到内存，持久化
 *     则通过 master-study-archive 层做 ZIP 下载）
 *
 * UI 侧和 MasterStudiesPanel 通过事件总线（不引入新 store）：
 *   · pipeline 直接写 db + 通过 patchWork 通知 store 刷新
 */
import { db } from '../db/schema'
import { chat } from '../ai/client'
import { renderPrompt } from '../ai/prompt-engine'
import { usePromptStore } from '../../stores/prompt'
import { useAIConfigStore } from '../../stores/ai-config'
import { useMasterStudyStore } from '../../stores/master-study'
import { chunkDocument, quickHash, type ChunkPlan } from '../import/chunker'
import { extractJSON } from '../ai/adapters/import-adapter'
import type { AIConfig, ChatMessage } from '../types'
import type {
  MasterAnalysisDepth,
  MasterChunkAnalysis,
  MasterWork,
} from '../types'

/** 不同深度对应的分块字符数 + maxTokens 上限 */
const DEPTH_PRESET: Record<MasterAnalysisDepth, {
  targetChars: number
  maxTokens: number
}> = {
  quick:    { targetChars: 40000, maxTokens: 4096 },
  standard: { targetChars: 25000, maxTokens: 6144 },
  deep:     { targetChars: 15000, maxTokens: 8192 },
}

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 1500

// ── 运行状态（单例） ────────────────────────────────────────
let activeController: AbortController | null = null
let activePaused = { value: false }
let activeWorkId: number | null = null

export interface MasterPipelineListener {
  onProgress?: (progress: number, message?: string) => void
  onActivity?: (level: 'info' | 'success' | 'warn' | 'error', message: string) => void
  onDone?: (workId: number, success: boolean) => void
}

let listener: MasterPipelineListener = {}

export function setMasterPipelineListener(l: MasterPipelineListener) {
  listener = l || {}
}

export function isMasterPipelineRunning(): boolean {
  return activeController !== null && !activePaused.value
}

export function getActiveMasterWorkId(): number | null {
  return activeWorkId
}

export function cancelMasterPipeline() {
  activePaused.value = true
  activeController?.abort()
  listener.onActivity?.('warn', '✕ 用户取消分析')
}

// ── 内存分块文本缓存（参照 Phase 18） ─────────────────────
const IN_MEM_CHUNKS: Record<number, ChunkPlan[]> = {}

export function registerMasterChunks(workId: number, chunks: ChunkPlan[]) {
  IN_MEM_CHUNKS[workId] = chunks
}

export function clearMasterChunks(workId: number) {
  delete IN_MEM_CHUNKS[workId]
}

export function hasMasterChunks(workId: number): boolean {
  return !!IN_MEM_CHUNKS[workId]?.length
}

// ── 主入口 ─────────────────────────────────────────────────

export interface RunMasterAnalysisArgs {
  workId: number
}

/**
 * 跑一次作品分析流水线。
 * 前置：必须已经 createWork() + registerMasterChunks()。
 */
export async function runMasterAnalysis(args: RunMasterAnalysisArgs): Promise<void> {
  const { workId } = args
  const store = useMasterStudyStore.getState()
  const work = await store.getWork(workId)
  if (!work) {
    listener.onActivity?.('error', `作品 #${workId} 不存在`)
    listener.onDone?.(workId, false)
    return
  }
  const chunks = IN_MEM_CHUNKS[workId]
  if (!chunks || chunks.length === 0) {
    await store.patchWork(workId, {
      status: 'failed',
      errorMessage: '内存里找不到分块原文（可能页面刷新过，请重新上传同一文件）',
    })
    listener.onActivity?.('error', '找不到分块原文，需要重新上传')
    listener.onDone?.(workId, false)
    return
  }

  activeController = new AbortController()
  activePaused = { value: false }
  activeWorkId = workId

  await store.patchWork(workId, { status: 'analyzing', progress: 0, errorMessage: undefined })
  listener.onActivity?.('info', `▶ 开始分析「${work.title}」共 ${chunks.length} 块（${work.analysisDepth}）`)

  // 已有分析 → 断点续跑（跳过已写过的块）
  const existing = await db.masterChunkAnalysis.where('workId').equals(workId).toArray()
  const doneSet = new Set(existing.map(r => r.chunkIndex))

  // rolling context：上一块的 prose 结论拼一拼，不太长
  let rollingContext = ''
  const preset = DEPTH_PRESET[work.analysisDepth]

  let completed = doneSet.size
  const total = chunks.length

  try {
    for (const chunk of chunks) {
      if (activePaused.value) {
        listener.onActivity?.('warn', '⏸ 分析已中止')
        await store.patchWork(workId, { status: 'failed', errorMessage: '用户取消' })
        listener.onDone?.(workId, false)
        return
      }
      if (doneSet.has(chunk.index)) continue

      let ok = false
      let lastErr = ''
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (activePaused.value) break
        listener.onActivity?.('info',
          `▶ 块 ${chunk.index + 1}/${total} 分析中（第 ${attempt + 1} 次）`)
        try {
          const analysis = await analyzeChunkOnce({
            work,
            chunk,
            totalChunks: total,
            knownContext: rollingContext,
            maxTokens: preset.maxTokens,
            signal: activeController.signal,
          })
          const row: MasterChunkAnalysis = {
            workId,
            chunkIndex: chunk.index,
            label: chunk.label,
            startOffset: chunk.startChar,
            endOffset: chunk.endChar,
            worldviewPattern: trim(analysis.worldviewPattern),
            characterDesign:  trim(analysis.characterDesign),
            plotRhythm:       trim(analysis.plotRhythm),
            foreshadowing:    trim(analysis.foreshadowing),
            proseStyle:       trim(analysis.proseStyle),
            rawExcerpt:       trim(analysis.rawExcerpt),
            createdAt: Date.now(),
          }
          await db.masterChunkAnalysis.add(row)
          completed++
          const progress = Math.min(100, Math.round((completed / total) * 100))
          await store.patchWork(workId, { progress })
          listener.onProgress?.(progress, `块 ${chunk.index + 1} 完成`)
          listener.onActivity?.('success', `✓ 块 ${chunk.index + 1} 完成`)
          // 更新 rolling（只取 plot + foreshadow，避免 prompt 爆）
          rollingContext = buildRollingContext(rollingContext, row)
          ok = true
          break
        } catch (err) {
          if ((err as Error).name === 'AbortError') return
          lastErr = err instanceof Error ? err.message : String(err)
          listener.onActivity?.('warn',
            `块 ${chunk.index + 1} 第 ${attempt + 1} 次失败：${lastErr.slice(0, 80)}`)
          if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS)
        }
      }
      if (!ok) {
        listener.onActivity?.('error',
          `✗ 块 ${chunk.index + 1} 重试 ${MAX_ATTEMPTS} 次仍失败：${lastErr.slice(0, 80)}`)
        // 不中止整体，继续分析后续块；最后标 failed
      }
    }

    // 收尾 —— 统计成功 vs 失败
    const finalAnalyses = await db.masterChunkAnalysis.where('workId').equals(workId).toArray()
    const successRatio = finalAnalyses.length / total
    const finalStatus = successRatio >= 1
      ? 'done'
      : (successRatio > 0 ? 'done' : 'failed') // 有部分结果就算 done，用户可看已有
    const errMsg = successRatio < 1
      ? `共 ${total} 块，成功 ${finalAnalyses.length}，失败 ${total - finalAnalyses.length}`
      : undefined
    await store.patchWork(workId, {
      status: finalStatus,
      progress: Math.round(successRatio * 100),
      errorMessage: errMsg,
    })
    listener.onActivity?.(finalStatus === 'done' ? 'success' : 'warn',
      `分析结束：${finalAnalyses.length} / ${total} 块已入库`)
    listener.onDone?.(workId, finalStatus === 'done')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if ((err as Error).name === 'AbortError') {
      listener.onActivity?.('warn', '已中止')
      await store.patchWork(workId, { status: 'failed', errorMessage: '用户取消' })
    } else {
      await store.patchWork(workId, { status: 'failed', errorMessage: msg })
      listener.onActivity?.('error', `分析异常：${msg}`)
    }
    listener.onDone?.(workId, false)
  } finally {
    activeController = null
    activeWorkId = null
  }
}

// ── 子步骤 ─────────────────────────────────────────────────

interface RawAnalysis {
  worldviewPattern?: string
  characterDesign?: string
  plotRhythm?: string
  foreshadowing?: string
  proseStyle?: string
  rawExcerpt?: string
}

async function analyzeChunkOnce(args: {
  work: MasterWork
  chunk: ChunkPlan
  totalChunks: number
  knownContext: string
  maxTokens: number
  signal?: AbortSignal
}): Promise<RawAnalysis> {
  const tpl = usePromptStore.getState().getActive('master.analyze-chunk')
  const { messages } = renderPrompt(tpl, {
    chunkIndex: args.chunk.index + 1,
    totalChunks: args.totalChunks,
    chunkChars: args.chunk.charCount,
    chunkLabel: args.chunk.label || '',
    workTitle: args.work.title,
    workAuthor: args.work.author || '',
    workGenre: args.work.genre || '',
    knownContext: args.knownContext.slice(0, 1500) || '（本块是第一块，无已识别上下文）',
    rawDocument: args.chunk.text,
    depth: args.work.analysisDepth,
  })
  const baseConfig = useAIConfigStore.getState().config
  const config: AIConfig = { ...baseConfig, maxTokens: args.maxTokens }
  if (!config.apiKey) throw new Error('未配置 AI API Key（请先到「系统设置 → AI 配置」填写）')
  const output = await chatWithAbort(messages, config, args.signal)
  const obj = extractJSON(output) as RawAnalysis
  return obj || {}
}

async function chatWithAbort(
  messages: ChatMessage[],
  config: AIConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e
  }
  return await Promise.race([
    chat(messages, config),
    new Promise<string>((_, reject) => {
      if (!signal) return
      const onAbort = () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }),
  ])
}

function buildRollingContext(prev: string, row: MasterChunkAnalysis): string {
  const pieces: string[] = []
  if (row.plotRhythm) pieces.push(`情节节奏：${row.plotRhythm.slice(0, 120)}`)
  if (row.foreshadowing) pieces.push(`伏笔：${row.foreshadowing.slice(0, 120)}`)
  if (row.characterDesign) pieces.push(`角色：${row.characterDesign.slice(0, 100)}`)
  const fresh = pieces.join('\n')
  const merged = prev ? `${prev}\n---\n${fresh}` : fresh
  return merged.length > 1500 ? merged.slice(-1500) : merged
}

function trim(s: string | undefined): string | undefined {
  if (typeof s !== 'string') return undefined
  const t = s.trim()
  return t || undefined
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── 给 UI 用的便利函数 ─────────────────────────────────────

export interface PrepareChunksResult {
  chunks: ChunkPlan[]
  totalChars: number
  fileHash: string
  depth: MasterAnalysisDepth
}

/** 把文本按深度分块；用于 UI 在确认前预览块数 */
export function planMasterChunks(text: string, depth: MasterAnalysisDepth): PrepareChunksResult {
  const preset = DEPTH_PRESET[depth]
  const chunks = chunkDocument(text, { targetChars: preset.targetChars })
  return {
    chunks,
    totalChars: text.length,
    fileHash: quickHash(text),
    depth,
  }
}
