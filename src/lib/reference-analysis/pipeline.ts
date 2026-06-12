/**
 * 参考作品·作品分析流水线（FB-5b — 13 维统一分析）
 *
 * 维度见 ANALYSIS_DIMENSIONS（reference.ts）：13 个小说维度 + 题材自适应历史维度。
 * 两档：
 *   · 浅层（quick）—— 复用导入解析已出的写作技法，写一条「全书」row，便宜。
 *   · 深层（deep） —— 逐块精读，每维含原文引用 + 全书总结，写 per-chunk rows + 断点续跑。
 *
 * 数据走向：
 *   · 写入 referenceChunkAnalysis 表，关联到 Reference。
 *   · 状态写回 Reference 的 analysisStatus / analysisProgress。
 */
import { db } from '../db/schema'
import { chat } from '../ai/client'
import { useAIConfigStore } from '../../stores/ai-config'
import { chunkDocument, quickHash, type ChunkPlan } from '../import/chunker'
import { extractJSON } from '../ai/adapters/import-adapter'
import type { AIConfig, ChatMessage, Reference, ReferenceChunkAnalysis, ReferenceAnalysisDepth } from '../types'

/** 两档:浅层(大块·轻析) / 深层(小块·深析) */
const DEPTH_PRESET: Record<ReferenceAnalysisDepth, {
  targetChars: number
  maxTokens: number
}> = {
  quick: { targetChars: 40000, maxTokens: 4096 },  // 浅层
  deep:  { targetChars: 15000, maxTokens: 8192 },  // 深层
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

// ── 浅层:直接用导入解析已出的 13 维写作技法,零额外 AI ──────────

/**
 * 浅层分析:把导入解析顺手产出的 13 维 writingTechniques 落成一条「全书」分析行。
 * 不额外调 AI(随导入解析免费得到),写完即 done。
 */
export async function writeShallowAnalysisFromTechniques(
  refId: number,
  wt: import('../types').WritingTechniques | undefined,
): Promise<void> {
  // 清掉旧分析(可能之前跑过)
  await db.referenceChunkAnalysis.where('referenceId').equals(refId).delete()
  const w = wt || {}
  const hasAny = Object.values(w).some(v => typeof v === 'string' && v.trim())
  if (hasAny) {
    const row: ReferenceChunkAnalysis = {
      referenceId: refId,
      chunkIndex: 0,
      label: '全书',
      narrativeStyle: trim(w.narrativeStyle),
      openingTechnique: trim(w.openingTechnique),
      plotStructure: trim(w.plotStructure),
      pacingControl: trim(w.pacingControl),
      climaxDesign: trim(w.climaxDesign),
      conflictEscalation: trim(w.conflictEscalation),
      characterCraft: trim(w.characterCraft),
      dialogueTechnique: trim(w.dialogueTechnique),
      proseStyle: trim(w.proseStyle),
      emotionalBeats: trim(w.emotionalBeats),
      foreshadowing: trim(w.foreshadowing),
      worldBuilding: trim(w.worldBuilding),
      otherTechniques: trim(w.otherTechniques),
      createdAt: Date.now(),
    }
    await db.referenceChunkAnalysis.add(row)
  }
  await patchRef(refId, {
    analysisDepth: 'quick',
    analysisStatus: hasAny ? 'done' : 'failed',
    analysisProgress: 100,
    analysisError: hasAny ? undefined : '解析未产出写作技法,无法生成浅层分析',
  })
}

// ── 深层主入口 ─────────────────────────────────────────────────

/**
 * 跑一次参考作品深层分析(逐块深析)。
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

  const depth = ref.analysisDepth || 'quick'
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
            // 13 小说维度
            narrativeStyle:     trim(analysis.narrativeStyle),
            openingTechnique:   trim(analysis.openingTechnique),
            plotStructure:      trim(analysis.plotStructure),
            pacingControl:      trim(analysis.pacingControl),
            climaxDesign:       trim(analysis.climaxDesign),
            conflictEscalation: trim(analysis.conflictEscalation),
            characterCraft:     trim(analysis.characterCraft),
            dialogueTechnique:  trim(analysis.dialogueTechnique),
            proseStyle:         trim(analysis.proseStyle),
            emotionalBeats:     trim(analysis.emotionalBeats),
            foreshadowing:      trim(analysis.foreshadowing),
            worldBuilding:      trim(analysis.worldBuilding),
            otherTechniques:    trim(analysis.otherTechniques),
            // 5 历史维度（仅历史题材）
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

interface RawAnalysis {
  // 13 小说维度
  narrativeStyle?: string
  openingTechnique?: string
  plotStructure?: string
  pacingControl?: string
  climaxDesign?: string
  conflictEscalation?: string
  characterCraft?: string
  dialogueTechnique?: string
  proseStyle?: string
  emotionalBeats?: string
  foreshadowing?: string
  worldBuilding?: string
  otherTechniques?: string
  // 5 历史维度
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
}): Promise<RawAnalysis> {
  const { ref, depth, chunk, totalChunks, knownContext } = args

  const depthGuide = depth === 'deep'
    ? '【深层·拆成模板】请逐维度详尽论述（每维 300-500 字），并引用原文片段佐证。'
    : '【浅层·快速摸底】请快速提炼，每维 50-100 字抓核心套路，不必引用原文。'

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

请从以下 18 个维度分析本块文本（前 13 个为文学创作维度，后 5 个为历史考证维度），输出**纯 JSON**（不要 markdown 包裹）：

{
  "narrativeStyle": "叙事视角与手法 —— 叙事视角、时间线安排、POV 切换（若为纯史料，分析其史料叙述视角与可信度）",
  "openingTechnique": "开篇技法 / 黄金三章 —— 本块的场景切入方式、信息引入节奏",
  "plotStructure": "情节结构与套路 —— 本块所记录历史事件的起承转合、因果布局",
  "pacingControl": "节奏控制 —— 张弛有度的处理、信息释放速率",
  "climaxDesign": "高潮设计 —— 历史事件的高潮/转折点的铺垫与呈现",
  "conflictEscalation": "冲突设计与升级 —— 历史事件中外在冲突（政治/战争/阶级）与内在冲突（心理/道德）、冲突升级节奏",
  "characterCraft": "人物塑造 —— 历史人物的多维刻画、关系动态、性格特征提炼",
  "dialogueTechnique": "对话技巧 —— 历史人物的言论/对话风格、潜台词",
  "proseStyle": "文笔风格 —— 史料的修辞、叙述密度、氛围营造",
  "emotionalBeats": "爽点 / 情绪节拍 —— 历史叙述中的情绪张力与读者代入",
  "foreshadowing": "伏笔与回收 —— 历史事件的因果链条、前兆与后续影响、历史悬念",
  "worldBuilding": "世界观构建 —— 历史设定如何融入叙事、细节沉浸感、文化/政治/经济体系暗示",
  "otherTechniques": "其他值得学习的技巧 —— 上述未覆盖的史料写作手法",

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
    : `你是一位资深文学评论家和网文创作方法论研究者。你正在逐块分析一部小说，从 13 个维度提炼创作方法论。

**作品信息**：
- 标题：${ref.title}
- 作者：${ref.author || '未知'}
- 流派：${ref.genre || '未知'}

**当前进度**：第 ${chunk.index + 1}/${totalChunks} 块（${chunk.label || ''}，约 ${chunk.charCount} 字）

${knownContext ? `**前文已识别的关键信息**：\n${knownContext}\n` : ''}

**分析要求**：
${depthGuide}

请从以下 13 个维度分析本块文本，输出**纯 JSON**（不要 markdown 包裹）：

{
  "narrativeStyle": "叙事视角与手法 —— 第几人称、全知/限知、时间线安排、POV 切换、叙事距离调控",
  "openingTechnique": "开篇技法 / 黄金三章 —— 若为开头：钩子设计、角色引入、世界展示节奏、信息密度；否则：本块的段落/场景切入技巧",
  "plotStructure": "情节结构与套路 —— 起承转合、伏笔回收布局、悬念设置、情节推进的动力机制",
  "pacingControl": "节奏控制 —— 快慢交替、张弛有度、信息释放速率、章末钩子",
  "climaxDesign": "高潮设计 —— 爽点/高潮的铺垫与引爆、情绪峰值的制造",
  "conflictEscalation": "冲突设计与升级 —— 外在冲突（人vs人/环境/势力）与内在冲突（心理/道德）、冲突升级节奏、压力曲线",
  "characterCraft": "人物塑造 —— 多维刻画（行为/对话/内心/他人视角）、弧线推进、标签化与去标签化、关系动态",
  "dialogueTechnique": "对话技巧 —— 对话的个性化与功能性（推动情节/揭示人物/传递信息）、潜台词、节奏",
  "proseStyle": "文笔风格 —— 修辞手法、句式变化、叙述密度、语言特色、氛围营造",
  "emotionalBeats": "爽点 / 情绪节拍 —— 情绪起伏的设计、读者代入与情绪出口、节拍布置",
  "foreshadowing": "伏笔与回收 —— 本块埋设的伏笔、回收的前文伏笔、悬念管理、读者预期的建立与打破",
  "worldBuilding": "世界观构建 —— 设定如何融入叙事（而非 info-dump）、规则展示时机、细节沉浸感、文化/政治/经济体系暗示",
  "otherTechniques": "其他值得学习的技巧 —— 上述未覆盖但有特色的写作手法",
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
  const obj = extractJSON(output) as RawAnalysis
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
  if (row.plotStructure) pieces.push(`情节：${row.plotStructure.slice(0, 120)}`)
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
