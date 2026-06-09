/**
 * 参考作品深度分析流水线（Phase 20 — 八维分析）
 *
 * 整合原 master-study/pipeline.ts 的核心逻辑，升级为 8 维度分析：
 *   1. narrativeStructure   叙事架构
 *   2. openingTechnique     开篇与黄金三章
 *   3. plotRhythm           情节结构与节奏
 *   4. characterCraft       人物塑造
 *   5. conflictEscalation   冲突与升级
 *   6. foreshadowing        伏笔与悬念
 *   7. proseAndDialogue     文笔与对话
 *   8. worldBuilding        世界观构建
 *
 * 与 master-study/pipeline 的区别：
 *   · 写入 referenceChunkAnalysis 表（而非 masterChunkAnalysis）
 *   · 分析结果关联到 Reference 而非 MasterWork
 *   · 使用新的 8 维分析 prompt
 *   · 状态写回 Reference 的 analysisStatus / analysisProgress
 */
import { db } from '../db/schema'
import { chat } from '../ai/client'
import { useAIConfigStore } from '../../stores/ai-config'
import { chunkDocument, quickHash, type ChunkPlan } from '../import/chunker'
import { extractJSON } from '../ai/adapters/import-adapter'
import type { AIConfig, ChatMessage, Reference, ReferenceChunkAnalysis, ReferenceAnalysisDepth } from '../types'

/** 不同深度对应的分块字符数 + maxTokens 上限 */
const DEPTH_PRESET: Record<ReferenceAnalysisDepth, {
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
let activeRefId: number | null = null

export interface RefAnalysisPipelineListener {
  onProgress?: (progress: number, message?: string) => void
  onActivity?: (level: 'info' | 'success' | 'warn' | 'error', message: string) => void
  onDone?: (refId: number, success: boolean) => void
}

let listener: RefAnalysisPipelineListener = {}

export function setRefAnalysisPipelineListener(l: RefAnalysisPipelineListener) {
  listener = l || {}
}

export function isRefAnalysisPipelineRunning(): boolean {
  return activeController !== null && !activePaused.value
}

export function getActiveRefAnalysisId(): number | null {
  return activeRefId
}

export function cancelRefAnalysisPipeline() {
  activePaused.value = true
  activeController?.abort()
  listener.onActivity?.('warn', '✕ 用户取消分析')
}

// ── 内存分块文本缓存 ─────────────────────────────────────────
const IN_MEM_CHUNKS: Record<number, ChunkPlan[]> = {}

export function registerRefChunks(refId: number, chunks: ChunkPlan[]) {
  IN_MEM_CHUNKS[refId] = chunks
}

export function clearRefChunks(refId: number) {
  delete IN_MEM_CHUNKS[refId]
}

export function hasRefChunks(refId: number): boolean {
  return !!IN_MEM_CHUNKS[refId]?.length
}

// ── 主入口 ─────────────────────────────────────────────────

/**
 * 跑一次参考作品八维深度分析。
 * 前置：必须已经 registerRefChunks()，Reference 记录存在。
 */
export async function runRefAnalysis(refId: number): Promise<void> {
  const ref = await db.references.get(refId)
  if (!ref) {
    listener.onActivity?.('error', `参考 #${refId} 不存在`)
    listener.onDone?.(refId, false)
    return
  }
  const chunks = IN_MEM_CHUNKS[refId]
  if (!chunks || chunks.length === 0) {
    await patchRef(refId, {
      analysisStatus: 'failed',
      analysisError: '找不到分块原文（可能页面刷新过，请重新上传文件）',
    })
    listener.onActivity?.('error', '找不到分块原文，需要重新上传')
    listener.onDone?.(refId, false)
    return
  }

  const depth = ref.analysisDepth || 'standard'
  activeController = new AbortController()
  activePaused = { value: false }
  activeRefId = refId

  await patchRef(refId, { analysisStatus: 'analyzing', analysisProgress: 0, analysisError: undefined })
  listener.onActivity?.('info', `▶ 开始分析「${ref.title}」共 ${chunks.length} 块（${depth}）`)

  // 已有分析 → 断点续跑
  const existing = await db.referenceChunkAnalysis
    .where('referenceId').equals(refId).toArray()
  const doneSet = new Set(existing.map(r => r.chunkIndex))

  let rollingContext = ''
  const preset = DEPTH_PRESET[depth]
  let completed = doneSet.size
  const total = chunks.length

  try {
    for (const chunk of chunks) {
      if (activePaused.value) {
        listener.onActivity?.('warn', '⏸ 分析已中止')
        await patchRef(refId, { analysisStatus: 'failed', analysisError: '用户取消' })
        listener.onDone?.(refId, false)
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
            ref,
            depth,
            chunk,
            totalChunks: total,
            knownContext: rollingContext,
            maxTokens: preset.maxTokens,
            signal: activeController.signal,
          })
          const row: ReferenceChunkAnalysis = {
            referenceId: refId,
            chunkIndex: chunk.index,
            label: chunk.label,
            startOffset: chunk.startChar,
            endOffset: chunk.endChar,
            narrativeStructure: trim(analysis.narrativeStructure),
            openingTechnique:   trim(analysis.openingTechnique),
            plotRhythm:         trim(analysis.plotRhythm),
            characterCraft:     trim(analysis.characterCraft),
            conflictEscalation: trim(analysis.conflictEscalation),
            foreshadowing:      trim(analysis.foreshadowing),
            proseAndDialogue:   trim(analysis.proseAndDialogue),
            worldBuilding:      trim(analysis.worldBuilding),
            // 历史维度
            historicalContext:  trim(analysis.historicalContext),
            socialInstitutions: trim(analysis.socialInstitutions),
            dailyLife:          trim(analysis.dailyLife),
            materialCulture:    trim(analysis.materialCulture),
            languageCustoms:    trim(analysis.languageCustoms),
            rawExcerpt:         trim(analysis.rawExcerpt),
            createdAt: Date.now(),
          }
          await db.referenceChunkAnalysis.add(row)
          completed++
          const progress = Math.min(100, Math.round((completed / total) * 100))
          await patchRef(refId, { analysisProgress: progress })
          listener.onProgress?.(progress, `块 ${chunk.index + 1} 完成`)
          listener.onActivity?.('success', `✓ 块 ${chunk.index + 1} 完成`)
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
      }
    }

    // 收尾
    const finalAnalyses = await db.referenceChunkAnalysis
      .where('referenceId').equals(refId).toArray()
    const successRatio = total > 0 ? finalAnalyses.length / total : 0
    const finalStatus = successRatio > 0 ? 'done' : 'failed'
    const errMsg = successRatio < 1
      ? `共 ${total} 块，成功 ${finalAnalyses.length}，失败 ${total - finalAnalyses.length}`
      : undefined
    await patchRef(refId, {
      analysisStatus: finalStatus as Reference['analysisStatus'],
      analysisProgress: Math.round(successRatio * 100),
      analysisError: errMsg,
    })
    listener.onActivity?.(finalStatus === 'done' ? 'success' : 'warn',
      `分析结束：${finalAnalyses.length} / ${total} 块已入库`)
    listener.onDone?.(refId, finalStatus === 'done')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if ((err as Error).name === 'AbortError') {
      listener.onActivity?.('warn', '已中止')
      await patchRef(refId, { analysisStatus: 'failed', analysisError: '用户取消' })
    } else {
      await patchRef(refId, { analysisStatus: 'failed', analysisError: msg })
      listener.onActivity?.('error', `分析异常：${msg}`)
    }
    listener.onDone?.(refId, false)
  } finally {
    activeController = null
    activeRefId = null
  }
}

// ── 十三维分析 prompt ─────────────────────────────────────────

interface RawEightDimAnalysis {
  narrativeStructure?: string
  openingTechnique?: string
  plotRhythm?: string
  characterCraft?: string
  conflictEscalation?: string
  foreshadowing?: string
  proseAndDialogue?: string
  worldBuilding?: string
  // 历史维度
  historicalContext?: string
  socialInstitutions?: string
  dailyLife?: string
  materialCulture?: string
  languageCustoms?: string
  rawExcerpt?: string
}

async function analyzeChunkOnce(args: {
  ref: Reference
  depth: ReferenceAnalysisDepth
  chunk: ChunkPlan
  totalChunks: number
  knownContext: string
  maxTokens: number
  signal?: AbortSignal
}): Promise<RawEightDimAnalysis> {
  const { ref, depth, chunk, totalChunks, knownContext } = args

  const depthGuide = depth === 'deep'
    ? '请进行深度分析，每个维度详尽论述（300-500字），引用原文佐证。'
    : depth === 'standard'
    ? '请做中等深度分析，每个维度 100-200 字。'
    : '请做快速分析，每个维度 50-100 字，抓核心要点。'

  const isHistorical = ref.type === 'historical'

  const systemPrompt = isHistorical
    ? `你是一位极其严谨、精通全球物质文化史、社会制度史和文学创作的历史学家与小说考证顾问。你正在逐块分析一部【历史考证资料/文献】，提炼其中可用于小说创作的时代细节与方法论。

**资料信息**：
- 标题：${ref.title}
- 作者：${ref.author || '未知'}
- 类型：历史考证资料 / 文献

**当前进度**：第 ${chunk.index + 1}/${totalChunks} 块（${chunk.label || ''}，约 ${chunk.charCount} 字）

${knownContext ? `**前文已识别的关键信息**：\n${knownContext}\n` : ''}

**分析要求**：
${depthGuide}

请从以下 13 个维度分析本块文本（前 8 个为文学创作维度，后 5 个为历史考证维度），输出**纯 JSON**（不要 markdown 包裹）：

{
  "narrativeStructure": "叙事架构 —— 本块使用的叙事视角、时间线安排、POV 切换技巧、叙事距离调控（若为纯史料，分析其史料叙述视角与可信度）",
  "openingTechnique": "开篇与黄金三章 —— 分析本块的场景切入方式、信息引入节奏",
  "plotRhythm": "情节结构与节奏 —— 本块所记录的历史事件的起承转合节奏、高潮/冲突分布、张弛有度的处理",
  "characterCraft": "人物塑造 —— 历史人物的多维刻画手法、人物关系动态变化、历史人物的性格特征提炼",
  "conflictEscalation": "冲突与升级 —— 历史事件中的外在冲突（政治斗争/战争/阶级冲突）和内在冲突（心理/道德困境）的设计、冲突升级的节奏",
  "foreshadowing": "伏笔与悬念 —— 历史事件的因果链条、前兆与后续影响、历史悬念设置",
  "proseAndDialogue": "文笔与对话 —— 史料的修辞手法、叙述密度、历史人物的言论/对话风格、氛围营造",
  "worldBuilding": "世界观构建 —— 历史设定如何融入叙事、细节构建沉浸感、文化/政治/经济体系的暗示",
  
  "historicalContext": "历史背景与时代特征 —— 提炼本块中体现的时代大势、历史转折点、政治气候、重大历史事件的真实背景",
  "socialInstitutions": "社会制度与等级 —— 提炼本块中体现的官制、科举、法律、阶层划分、社会流动性、行会/组织运作机制",
  "dailyLife": "日常生活细节 —— 提炼本块中体现的衣食住行、岁时节日、娱乐消遣、民间信仰、日常消费水平",
  "materialCulture": "物质文化（器物/科技） —— 提炼本块中体现的器物、工具、建筑、科技水平、生产工艺、武器装备细节",
  "languageCustoms": "语言习惯与称谓 —— 提炼本块中体现的时代特色词汇、避讳、人际称谓、书面/口语风格、行话",
  
  "rawExcerpt": "（选取本块中最具历史质感或写作技巧的精彩片段，约100-200字原文引用）"
}

**注意**：
- 如果某个维度在本块中无明显体现，写"本块未涉及"即可
- 重点提炼真实、地道、能直接丰富小说细节的历史考证内容，而非简单复述情节
- 分析应当具体、可操作，让作者能直接作为写作素材使用`
    : `你是一位资深文学评论家和网文创作方法论研究者。你正在逐块分析一部小说，从 8 个维度提炼创作方法论。

**作品信息**：
- 标题：${ref.title}
- 作者：${ref.author || '未知'}
- 流派：${ref.genre || '未知'}

**当前进度**：第 ${chunk.index + 1}/${totalChunks} 块（${chunk.label || ''}，约 ${chunk.charCount} 字）

${knownContext ? `**前文已识别的关键信息**：\n${knownContext}\n` : ''}

**分析要求**：
${depthGuide}

请从以下 8 个维度分析本块文本，输出**纯 JSON**（不要 markdown 包裹）：

{
  "narrativeStructure": "叙事架构 —— 本块使用的叙事视角（第几人称、全知/限知）、时间线安排（顺叙/倒叙/插叙）、POV 切换技巧、叙事距离调控",
  "openingTechnique": "开篇与黄金三章 —— 如果是开头部分：分析钩子设计、角色引入方式、世界展示节奏、前三章的信息密度控制；如果不是开头：分析本块的段落开头技巧、场景切入方式",
  "plotRhythm": "情节结构与节奏 —— 本块的起承转合节奏、高潮/爽点分布、张弛有度的处理、情节推进的动力机制、章末钩子/悬念设置",
  "characterCraft": "人物塑造 —— 人物的多维刻画手法（行为/对话/内心/他人视角）、弧线推进、标签化与去标签化、人物关系动态变化",
  "conflictEscalation": "冲突与升级 —— 外在冲突（人vs人/人vs环境/人vs势力）和内在冲突（心理/道德困境）的设计、冲突升级的节奏、压力曲线",
  "foreshadowing": "伏笔与悬念 —— 本块埋设的伏笔、回收的前文伏笔、悬念管理技巧、读者预期的建立与打破",
  "proseAndDialogue": "文笔与对话 —— 修辞手法、句式变化、叙述密度、对话的个性化与功能性（推动情节/揭示人物/传递信息）、氛围营造",
  "worldBuilding": "世界观构建 —— 设定如何融入叙事（而非info-dump）、规则展示时机、细节构建沉浸感、文化/政治/经济体系的暗示",
  "rawExcerpt": "（选取本块中最能体现写作技巧的精彩片段，约100-200字原文引用）"
}

**注意**：
- 如果某个维度在本块中无明显体现，写"本块未涉及"即可
- 重点分析有特色、值得学习的写作手法，而非简单复述情节
- 分析应当具体、可操作，让读者能学以致用`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请分析以下文本：\n\n${chunk.text}` },
  ]

  const baseConfig = useAIConfigStore.getState().config
  const config: AIConfig = { ...baseConfig, maxTokens: args.maxTokens }
  if (!config.apiKey) throw new Error('未配置 AI API Key（请先到「系统设置 → AI 配置」填写）')
  const output = await chatWithAbort(messages, config, args.signal)
  const obj = extractJSON(output) as RawEightDimAnalysis
  return obj || {}
}

// ── 工具函数 ─────────────────────────────────────────────────

async function chatWithAbort(
  messages: ChatMessage[],
  config: AIConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e
  }
  return await chat(messages, config, undefined, signal)
}

function buildRollingContext(prev: string, row: ReferenceChunkAnalysis): string {
  const pieces: string[] = []
  if (row.plotRhythm) pieces.push(`情节：${row.plotRhythm.slice(0, 120)}`)
  if (row.foreshadowing) pieces.push(`伏笔：${row.foreshadowing.slice(0, 120)}`)
  if (row.characterCraft) pieces.push(`角色：${row.characterCraft.slice(0, 100)}`)
  if (row.conflictEscalation) pieces.push(`冲突：${row.conflictEscalation.slice(0, 100)}`)
  const fresh = pieces.join('\n')
  const merged = prev ? `${prev}\n---\n${fresh}` : fresh
  return merged.length > 1500 ? merged.slice(-1500) : merged
}

async function patchRef(refId: number, changes: Partial<Reference>) {
  await db.references.update(refId, { ...changes, updatedAt: Date.now() })
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

export interface PlanChunksResult {
  chunks: ChunkPlan[]
  totalChars: number
  fileHash: string
  depth: ReferenceAnalysisDepth
}

/** 把文本按深度分块，用于 UI 预览块数 */
export function planRefChunks(text: string, depth: ReferenceAnalysisDepth): PlanChunksResult {
  const preset = DEPTH_PRESET[depth]
  const chunks = chunkDocument(text, { targetChars: preset.targetChars })
  return {
    chunks,
    totalChars: text.length,
    fileHash: quickHash(text),
    depth,
  }
}
