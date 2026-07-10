import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Save, FileText, Eye, ClipboardList, CheckSquare, Square, BookOpenCheck, ShieldCheck, StickyNote } from 'lucide-react'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import { useStateCardStore } from '../../stores/state-card'
import { useCharacterStore } from '../../stores/character'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { CInput } from '../shared/CompositionInput'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { buildChapterContentPrompt, buildContinuePrompt, buildPolishPrompt, buildExpandPrompt, buildDeAIPrompt } from '../../lib/ai/adapters/chapter-adapter'
import { buildReviewRevisePrompt, type ReviewResult } from '../../lib/ai/adapters/review-adapter'
import { buildStateExtractPrompt, parseStateDiffs } from '../../lib/ai/adapters/state-extract-adapter'
import { buildFactExtractPrompt, parseFactExtractResult } from '../../lib/ai/adapters/fact-extract-adapter'
import { useFactLedgerStore } from '../../stores/fact-ledger'
import { rebuildChapterChunks, ensureChunkEmbeddings, rebuildProjectNarrativeSummaries } from '../../lib/retrieval/retrieval'
import { isEmbeddingReady } from '../../lib/ai/adapters/embedding-adapter'
import { propagateChapterEditStale, analyzeEditImpact } from '../../lib/consistency/impact-analysis'
import { runChapterMemoryTask } from '../../lib/ai/chapter-memory/run-chapter-memory'
import { prepareContinuityContext } from '../../lib/ai/chapter-memory/continuity-context'
import { isPlanReconciliationCurrent } from '../../lib/ai/chapter-memory/plan-reconciliation'
import { findNextCanonicalChapter, findPreviousCanonicalChapter } from '../../lib/ai/chapter-memory/canonical-chapter-sequence'
import { chat } from '../../lib/ai/client'
import { db } from '../../lib/db/schema'
import { buildGenreConstraintContext } from '../../lib/ai/genre-metadata'
import { buildStylePromptInjection } from '../../lib/ai/writing-styles'
import { assembleContext } from '../../lib/registry/assemble-context'
import { resolveChapterDisplayMeta } from '../../lib/outline/chapter-display'
import { pickBestChapterForOutline } from '../../lib/chapters/selectors'
import { useCreativeRulesStore } from '../../stores/project-singletons'
import { useStoryArcStore } from '../../stores/story-arc'
import { useForeshadowStore } from '../../stores/foreshadow'
import { htmlToPlainText, plainTextToHtml, countWords } from '../../lib/utils/html'
import AIStreamOutput from '../shared/AIStreamOutput'
import ContextBudgetBar from '../shared/ContextBudgetBar'
import { useDialog } from '../shared/Dialog'
import { useReviewResultStore } from '../../stores/review-result'
import { useAIConfigStore } from '../../stores/ai-config'
import { analyzeContextSegments, calculateBudget, getModelPreset, type ContextBudget } from '../../lib/ai/context-budget'
import StateDiffModal from '../state/StateDiffModal'
import RichEditor, { type RichEditorHandle } from './RichEditor'
import EmotionBeatCard from './EmotionBeatCard'
import OutlinePreview from '../outline/OutlinePreview'
import ReviewPanel from './ReviewPanel'
import NotePanel from './NotePanel'
import FloatingToolbar from './FloatingToolbar'
import type { ChapterStatus, Project, StateDiffItem } from '../../lib/types'

/** 生成任务类型(原 memory-builder 三层记忆已被 assembleContext 取代,此类型仅用于调试日志标签) */
type MemoryTaskType = 'write' | 'plan' | 'review'

const CHAPTER_STATUS_OPTIONS: { value: ChapterStatus; label: string }[] = [
  { value: 'outline', label: '仅大纲' },
  { value: 'draft', label: '初稿' },
  { value: 'revised', label: '已修改' },
  { value: 'polished', label: '已润色' },
  { value: 'final', label: '定稿' },
]

const CHAPTER_STATUS_STYLE: Record<ChapterStatus, string> = {
  outline: 'bg-bg-elevated text-text-muted',
  draft: 'bg-warning/10 text-warning',
  revised: 'bg-info/10 text-info',
  polished: 'bg-accent/10 text-accent',
  final: 'bg-success/10 text-success',
}

interface Props {
  project: Project
  outlineNodeId?: number | null
}

export default function ChapterEditor({ project, outlineNodeId }: Props) {
  const {
    chapters,
    currentChapter,
    selectChapter,
    getOrCreateByOutlineNode,
    updateChapter,
    refreshChapter,
    loadAll: loadChapters,
  } = useChapterStore()
  const { nodes, updateNode } = useOutlineStore()
  const { cards: stateCards, loadAll: loadStateCards, buildStateContext, buildSelectiveStateContext, applyDiffs } = useStateCardStore()
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const { creativeRules } = useCreativeRulesStore()
  const { loadAll: loadArcs } = useStoryArcStore()
  const { buildForeshadowContext, loadAll: loadForeshadows } = useForeshadowStore()

  // content 为 HTML 字符串；旧数据是纯文本，RichEditor 内部会自动包装
  const [content, setContent] = useState('')
  const [plainText, setPlainText] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractingFacts, setExtractingFacts] = useState(false)
  const [impactInfo, setImpactInfo] = useState<string | null>(null)
  const [analyzingImpact, setAnalyzingImpact] = useState(false)
  const [pendingDiffs, setPendingDiffs] = useState<StateDiffItem[] | null>(null)
  // A2: 按需召回 — 手动额外勾选/取消的状态卡 ID
  const [extraStateIds, setExtraStateIds] = useState<number[]>([])
  const [showStatePreview, setShowStatePreview] = useState(false)
  const ai = useAIStream(createAISessionKey(
    project.id!,
    'chapter.content',
    currentChapter?.id ?? outlineNodeId ?? 'unselected',
  ))
  const stateAI = useAIStream()
  const memoryAI = useAIStream()
  const factAI = useAIStream()
  const editorRef = useRef<RichEditorHandle>(null)
  const memoryRebuildInFlightRef = useRef(new Set<number>())
  const creatingChapterForOutlineRef = useRef(new Set<number>())
  const reviseReportRef = useRef<ReviewResult | null>(null)  // G8：记住上次"按报告修改"的报告，供重试
  // Phase A1: 自动流程标记
  const [autoProcessing, setAutoProcessing] = useState<'idle' | 'extracting' | 'memory'>('idle')
  const [showOutlinePreview, setShowOutlinePreview] = useState(false)
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [showNotePanel, setShowNotePanel] = useState(false)
  const [contextBudget, setContextBudget] = useState<ContextBudget | null>(null)
  const [planReconciliationCurrent, setPlanReconciliationCurrent] = useState(false)
  const aiConfig = useAIConfigStore(s => s.config)
  const dialog = useDialog()

  // 字数（基于纯文本）
  const wordCount = useMemo(() => countWords(plainText), [plainText])

  // 有未保存内容时阻止页面关闭
  useBeforeUnload(content !== savedContent && plainText.length > 0)

  useEffect(() => { loadChapters(project.id!) }, [project.id, loadChapters])
  useEffect(() => { loadStateCards(project.id!) }, [project.id, loadStateCards])
  useEffect(() => { loadCharacters(project.id!) }, [project.id, loadCharacters])
  useEffect(() => { loadArcs(project.id!) }, [project.id, loadArcs])
  useEffect(() => { loadForeshadows(project.id!) }, [project.id, loadForeshadows])

  // 如果从大纲进入，选择/创建对应章节（自动创建）
  useEffect(() => {
    if (!outlineNodeId) return
    const existing = pickBestChapterForOutline(chapters.filter(c => c.outlineNodeId === outlineNodeId))
    if (existing?.id) {
      selectChapter(existing.id)
      return
    }

    const node = nodes.find(n => n.id === outlineNodeId)
    if (!node || creatingChapterForOutlineRef.current.has(outlineNodeId)) return

    creatingChapterForOutlineRef.current.add(outlineNodeId)
    void getOrCreateByOutlineNode(project.id!, outlineNodeId, {
      title: node.title,
      content: '', wordCount: 0, status: 'outline', order: chapters.length, notes: '',
    })
      .then(chapter => {
        if (chapter.id) selectChapter(chapter.id)
      })
      .finally(() => {
        creatingChapterForOutlineRef.current.delete(outlineNodeId)
      })
  }, [outlineNodeId, chapters, selectChapter, nodes, getOrCreateByOutlineNode, project.id])

  const persistCurrentEditorContent = useCallback(async (): Promise<{ html: string; plain: string; wordCount: number } | null> => {
    if (!currentChapter?.id) return null
    const html = editorRef.current?.getHTML() ?? content
    const plain = editorRef.current?.getPlainText() ?? htmlToPlainText(html)
    const wc = countWords(plain)
    await updateChapter(currentChapter.id, { content: html, wordCount: wc })
    setContent(html)
    setPlainText(plain)
    setSavedContent(html)
    return { html, plain, wordCount: wc }
  }, [content, currentChapter?.id, updateChapter])

  // 切换章节：同步到本地 state（RichEditor 会基于 value 重建内容）
  useEffect(() => {
    const raw = currentChapter?.content || ''
    setContent(raw)
    setPlainText(htmlToPlainText(raw))
  }, [currentChapter])

  // 切换章节时同步 savedContent（只在章节 id 变化时）
  useEffect(() => {
    setSavedContent(currentChapter?.content || '')
  }, [currentChapter?.id])

  useEffect(() => {
    let cancelled = false
    if (!currentChapter?.planReconciliation) {
      setPlanReconciliationCurrent(false)
      return
    }
    isPlanReconciliationCurrent(project.id!, currentChapter).then(current => {
      if (!cancelled) setPlanReconciliationCurrent(current)
    })
    return () => { cancelled = true }
  }, [project.id, currentChapter])

  // 自动保存
  useAutoSave(content, useCallback(async (html: string) => {
    if (currentChapter?.id) {
      const wc = countWords(htmlToPlainText(html))
      await updateChapter(currentChapter.id, { content: html, wordCount: wc })
      setSavedContent(html)
    }
  }, [currentChapter?.id, updateChapter]))

  const outlineNode = currentChapter ? nodes.find(n => n.id === currentChapter.outlineNodeId) : null
  const chapterDisplay = useMemo(() => {
    return currentChapter ? resolveChapterDisplayMeta(currentChapter, nodes) : null
  }, [currentChapter, nodes])
  // 多世界：沿父链找到所属卷的 worldGroupId
  const chapterWorldGroupId = useMemo(() => {
    if (!project.enableMultiWorld || !outlineNode) return null
    let cur: typeof outlineNode | undefined = outlineNode
    const guard = new Set<number>()
    while (cur && !guard.has(cur.id!)) {
      if (cur.worldGroupId != null) return cur.worldGroupId
      guard.add(cur.id!)
      cur = cur.parentId != null ? nodes.find(n => n.id === cur!.parentId) : undefined
    }
    return null
  }, [project.enableMultiWorld, outlineNode, nodes])

  const [worldCtx, setWorldCtx] = useState('')
  const [charCtx, setCharCtx] = useState('')
  useEffect(() => {
    let cancelled = false
    assembleContext({
      projectId: project.id!,
      worldGroupId: chapterWorldGroupId ?? null,
      outlineNodeId: outlineNode?.id ?? null,
      chapterId: currentChapter?.id ?? null,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: ['contextMemo', 'chapterOutline', 'worldview', 'storyCore', 'powerSystem', 'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations', 'userStyleProfile'],
    }).then(assembled => {
      if (cancelled) return
      const charIdx = assembled.included.indexOf('characters')
      setWorldCtx(assembled.text)
      setCharCtx(charIdx >= 0 ? assembled.segments[charIdx]?.content ?? '' : '')
    })
    return () => { cancelled = true }
  }, [project.id, chapterWorldGroupId, outlineNode?.id, currentChapter?.id, aiConfig.provider, aiConfig.model])

  // A2: 按需召回 — 根据章节大纲+标题+已有文本筛选相关状态卡
  const selectiveState = useMemo(() => {
    if (!stateCards.length) return { text: '', matchedIds: [] as number[], allIds: [] as number[] }
    const refParts: string[] = []
    if (outlineNode?.title) refParts.push(outlineNode.title)
    if (outlineNode?.summary) refParts.push(outlineNode.summary)
    if (currentChapter?.title) refParts.push(currentChapter.title)
    if (plainText) refParts.push(plainText.slice(-2000))
    const ref = refParts.join(' ')
    if (!ref.trim()) return { text: buildStateContext(), matchedIds: stateCards.map(c => c.id!), allIds: stateCards.map(c => c.id!) }
    return buildSelectiveStateContext(ref, extraStateIds)
  }, [stateCards, outlineNode?.title, outlineNode?.summary, currentChapter?.title, plainText, extraStateIds, buildSelectiveStateContext, buildStateContext])

  const handleCreateFromOutline = async () => {
    if (!outlineNodeId) return
    const node = nodes.find(n => n.id === outlineNodeId)
    if (!node) return
    const chapter = await getOrCreateByOutlineNode(project.id!, outlineNodeId, {
      title: node.title,
      content: '', wordCount: 0, status: 'outline', order: chapters.length, notes: '',
    })
    if (chapter.id) selectChapter(chapter.id)
  }

  // AI 操作 —— 所有 AI 交互都基于纯文本
  // Phase A2: 使用三层记忆构建器生成完整上下文
  const rebuildChapterMemoryById = async (chapterId: number): Promise<void> => {
    if (memoryRebuildInFlightRef.current.has(chapterId)) return
    const chapter = await db.chapters.get(chapterId)
    if (!chapter?.content?.trim()) return
    const chapterTitle = nodes.find(node => node.id === chapter.outlineNodeId)?.title || chapter.title
    memoryRebuildInFlightRef.current.add(chapterId)
    try {
      const result = await runChapterMemoryTask({
        projectId: project.id!,
        chapterId,
        chapterTitle,
        chapterContent: chapter.content,
        call: messages => chat(messages, aiConfig, {
          category: 'chapter.memory',
          projectId: project.id!,
        }),
      })
      if (result.status === 'written') await refreshChapter(chapterId)
    } catch (error) {
      console.warn('[ChapterMemory] 惰性重建失败，继续使用 tail 降级:', error)
    } finally {
      memoryRebuildInFlightRef.current.delete(chapterId)
    }
  }

  const prepareContinuityBeforeGeneration = async (): Promise<number[]> => {
    if (!currentChapter?.id) return []
    const snapshot = await prepareContinuityContext({
      projectId: project.id!,
      chapterId: currentChapter.id,
    })
    if (snapshot.anomalies.length) {
      console.warn('[ChapterMemory] 规范章节序列 anomalies:', snapshot.anomalies)
    }
    const predecessorId = snapshot.predecessor?.chapter.id
    if (predecessorId != null && snapshot.memoryRebuildCandidateIds.includes(predecessorId)) {
      // 直接前驱优先且同步补建；失败仍由真实 tail 保底。
      await rebuildChapterMemoryById(predecessorId)
    }
    return snapshot.memoryRebuildCandidateIds
      .filter(id => id !== predecessorId)
      .slice(-4)
  }

  const scheduleRecentMemoryRebuild = (chapterIds: number[]) => {
    if (!chapterIds.length) return
    void (async () => {
      for (const chapterId of chapterIds) await rebuildChapterMemoryById(chapterId)
    })()
  }

  const buildFullWorldCtx = async (taskType: MemoryTaskType = 'write') => {
    // 引用手法注入（Phase 20）
    let citedIds: number[] = []
    try {
      citedIds = JSON.parse(creativeRules?.citedReferenceIds || '[]')
    } catch { /* ignore */ }

    const stateRef = [
      outlineNode?.title,
      outlineNode?.summary,
      currentChapter?.title,
      plainText.slice(-2000),
    ].filter(Boolean).join(' ')

    const assembled = await assembleContext({
      projectId: project.id!,
      worldGroupId: chapterWorldGroupId ?? null,
      outlineNodeId: outlineNode?.id ?? null,
      chapterId: currentChapter?.id ?? null,
      currentChapterOrder: currentChapter?.order ?? 0,
      provider: aiConfig.provider,
      model: aiConfig.model,
      citedReferenceIds: citedIds,
      stateReferenceText: stateRef,
      extraStateIds,
      // 注意:不含 'characters' —— 角色由 charCtx 单独注入(见 handleGenerate / handleContinue),
      // 此前 fullCtx(含characters)+charCtx 双传导致角色内容被注入两遍、白白吃掉一大块 token。
      sourceKeys: [
        'contextMemo',
        'chapterOutline',
        'detailedOutline', // FB-9:正文生成读入本章场景细纲
        'chapterContinuityHandoff',
        'previousPlanReconciliation',
        'previousChapterEnding',
        'recentChapterSummaries',
        'worldview',
        'storyCore',
        'powerSystem',
        'codex',
        'creativeRules',
        'worldRules',
        'historical',
        'locations',
        'foreshadows',
        'storyArcs',
        'emotionBeats',
        'stateCards',
        'currentFacts', // NS-4:当前章生效的已确认事实，回注生成防止前后矛盾
        'heldItems', // CONSISTENCY-1:当前已持有物品，避免新章重复写首次获得
        'retrievedPassages', // NS-5:相关前文召回，防远距离细节/伏笔矛盾
        'references',
        'userStyleProfile',
      ],
    })

    console.log(`[assembleContext] ${taskType} 模式 — included:${assembled.included.join(',')} trimmed:${assembled.trimmed.join(',') || 'none'} tokens:${assembled.totalInputTokens}`)

    // Phase E: 题材约束 + 写作风格注入
    const genreCtx = buildGenreConstraintContext(project.genres?.length ? project.genres : project.genre)
    const styleCtx = project.writingStyleId ? buildStylePromptInjection(project.writingStyleId) : ''

    const segmentFor = (key: string) => {
      const index = assembled.included.indexOf(key)
      return index >= 0 ? assembled.segments[index]?.content ?? '' : ''
    }
    const continuityKeys = new Set([
      'chapterContinuityHandoff',
      'previousPlanReconciliation',
      'previousChapterEnding',
      'recentChapterSummaries',
    ])
    const assembledSegmentsWithoutContinuity = assembled.segments
      .filter((_, index) => !continuityKeys.has(assembled.included[index]))
    const assembledWithoutContinuity = assembledSegmentsWithoutContinuity
      .map(segment => segment.content)
      .join('\n\n')
    const parts = [assembledWithoutContinuity]
    if (genreCtx) parts.push(genreCtx)
    if (styleCtx) parts.push(styleCtx)
    const worldRulesIdx = assembled.included.indexOf('worldRules')
    const maxContext = aiConfig.contextWindow && aiConfig.contextWindow > 0
      ? aiConfig.contextWindow
      : getModelPreset(aiConfig.provider, aiConfig.model).maxContext
    const continuityBudgetTokens = maxContext <= 8_192 ? 3000 : maxContext <= 32_768 ? 6000 : 10_000
    return {
      text: parts.filter(Boolean).join('\n\n'),
      segments: assembledSegmentsWithoutContinuity,
      worldRulesContext: worldRulesIdx >= 0 ? assembled.segments[worldRulesIdx]?.content ?? '' : '',
      continuity: {
        handoff: segmentFor('chapterContinuityHandoff'),
        planReconciliation: segmentFor('previousPlanReconciliation'),
        previousTail: segmentFor('previousChapterEnding'),
        recentSummaries: segmentFor('recentChapterSummaries'),
      },
      continuityBudgetTokens,
    }
  }

  const handleGenerate = async () => {
    if (!outlineNode) return
    const backgroundMemoryIds = await prepareContinuityBeforeGeneration()
    const {
      text: fullCtx,
      segments: assembledSegments,
      worldRulesContext,
      continuity,
      continuityBudgetTokens,
    } = await buildFullWorldCtx('write')
    const messages = buildChapterContentPrompt(
      outlineNode.title,
      outlineNode.summary,
      fullCtx,
      charCtx,
      continuity.previousTail,
      worldRulesContext,
      customInstruction.trim() || undefined,
      { continuity, continuityBudgetTokens },
    )

    // Phase 21.3: 计算上下文预算
    const segments = analyzeContextSegments([
      { label: 'System Prompt', content: messages.find(m => m.role === 'system')?.content || '', layer: 'L0' },
      { label: '章节大纲', content: outlineNode.summary || '', layer: 'L1' },
      ...assembledSegments,
      { label: 'User Prompt', content: messages.find(m => m.role === 'user')?.content || '', layer: 'L1' },
    ])
    setContextBudget(calculateBudget(aiConfig.provider, aiConfig.model, segments, aiConfig.contextWindow))

    ai.setOperation('generate')
    void ai.start(messages, undefined, { category: 'chapter.content', projectId: project.id! })
    scheduleRecentMemoryRebuild(backgroundMemoryIds)
  }

  const handleContinue = async () => {
    if (!plainText || !outlineNode) return
    const backgroundMemoryIds = await prepareContinuityBeforeGeneration()
    const { text: fullCtx, continuity, continuityBudgetTokens } = await buildFullWorldCtx('write')
    // fullCtx 已不含角色(见 buildFullWorldCtx),续写也要角色 → 把 charCtx 一并带上(只此一次,不重复)
    const ctxWithChars = charCtx ? `${fullCtx}\n\n【角色设定】\n${charCtx}` : fullCtx
    const messages = buildContinuePrompt(
      plainText,
      outlineNode.summary,
      ctxWithChars,
      customInstruction.trim() || undefined,
      { continuity, continuityBudgetTokens },
    )
    ai.setOperation('continue')
    void ai.start(messages, undefined, { category: 'chapter.continue', projectId: project.id! })
    scheduleRecentMemoryRebuild(backgroundMemoryIds)
  }

  const handlePolish = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-1000)
    if (!selected) return
    const messages = buildPolishPrompt(selected, customInstruction || '优化文笔，使表达更生动')
    ai.setOperation('polish')
    ai.start(messages, undefined, { category: 'chapter.polish', projectId: project.id! })
  }

  const handleExpand = () => {
    const selected = editorRef.current?.getSelectedText() || plainText.slice(-500)
    if (!selected) return
    const messages = buildExpandPrompt(selected, customInstruction.trim() || undefined)
    ai.setOperation('expand')
    ai.start(messages, undefined, { category: 'chapter.expand', projectId: project.id! })
  }

  const handleDeAI = async () => {
    // 有选区只去味选区；没选区则对【整章正文】去味（不再只取末尾 1000 字 → 修字数缩水 bug G4）
    const selected = editorRef.current?.getSelectedText()
    const isFull = !selected
    const target = (selected || plainText).trim()
    if (!target) return
    // G1：点击先确认，避免误触烧 token
    const ok = await dialog.confirm({
      title: '去 AI 味改写？',
      message: isFull
        ? `将对整章正文（约 ${countWords(target)} 字）做去 AI 味改写，篇幅与原文保持相近。改写结果会先预览，确认后才替换原文。`
        : '将对选中的文字做去 AI 味改写。改写结果会先预览，确认后才替换。',
      confirmText: '开始改写',
    })
    if (!ok) return
    const messages = buildDeAIPrompt(target)
    ai.setOperation(isFull ? 'deai-full' : 'deai')
    ai.start(messages, undefined, { category: 'chapter.deai', projectId: project.id! })
  }

  // G8：按审校报告让 AI 改全文 —— 走和「生成正文」相同的预览→采纳/关闭流程
  const handleReviseByReport = async (report: ReviewResult) => {
    if (!plainText.trim()) return
    const ok = await dialog.confirm({
      title: '按审校报告让 AI 改全文？',
      message: `将依据本章审校报告修改整章正文（约 ${countWords(plainText)} 字），篇幅与原文保持相近。改写结果会先预览，确认后才替换原文。`,
      confirmText: '开始修改',
    })
    if (!ok) return
    reviseReportRef.current = report
    const messages = buildReviewRevisePrompt(plainText, report, worldCtx, charCtx)
    ai.setOperation('revise-full')
    ai.start(messages, undefined, { category: 'review.revise', projectId: project.id! })
  }

  // ── 状态提取 ──
  const handleExtractState = async () => {
    if (!currentChapter || !plainText) return
    setExtracting(true)
    try {
      const stateCtx = buildSelectiveStateContext(plainText, extraStateIds).text
      const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
      const characterNames = characters.map(character => character.name)
      const messages = buildStateExtractPrompt(stateCtx, chapterTitle, plainText, characterNames)
      console.log('[StateExtract] 开始提取，章节:', chapterTitle)
      const raw = await stateAI.start(messages, undefined, { category: 'state.extract', projectId: project.id! })
      const { diffs, error } = parseStateDiffs(raw, characterNames)
      if (error) {
        console.error('[StateExtract] 解析失败:', error)
      }
      setPendingDiffs(diffs as StateDiffItem[])
    } catch (err) {
      console.error('[StateExtract] 提取失败:', err)
    } finally {
      setExtracting(false)
    }
  }

  // NS-4：从本章正文抽取事实候选，走 fact-ledger 单一入口写回（不裸写）。
  const handleExtractFacts = async () => {
    if (!currentChapter?.id || !plainText) return
    setExtractingFacts(true)
    try {
      const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
      const messages = buildFactExtractPrompt({ chapterTitle, chapterContent: plainText })
      const raw = await factAI.start(messages, undefined, { category: 'fact.extract', projectId: project.id! })
      const candidates = parseFactExtractResult({ raw, chapterContent: plainText })
      const written = await useFactLedgerStore.getState().adopt({
        projectId: project.id!,
        sourceChapterId: currentChapter.id,
        worldGroupId: chapterWorldGroupId ?? null,
        candidates,
      })
      console.log(`[FactExtract] 抽取 ${candidates.length} 条，写入候选 ${written} 条`)
    } catch (err) {
      console.error('[FactExtract] 失败:', err)
    } finally {
      factAI.reset()
      setExtractingFacts(false)
    }
  }

  // NS-6：改了历史章后，传播 stale（证据失效的确认事实标记为 stale）+ 列出受影响后续章，交作者复核。
  // 只读·只提示·不自动改任何正文；不删事实、不动 locked。
  const handleEditImpact = async () => {
    if (!currentChapter?.id || !project.id) return
    setAnalyzingImpact(true)
    try {
      // 先把当前正文真正落盘，再据落盘正文判断证据是否失效
      await persistCurrentEditorContent()
      const { demotedFacts } = await propagateChapterEditStale(project.id, currentChapter.id)
      const { factsFromChapter, downstreamChapterIds } = await analyzeEditImpact(project.id, currentChapter.id)
      const parts = [
        `源自本章事实 ${factsFromChapter.length} 条`,
        demotedFacts > 0 ? `其中 ${demotedFacts} 条证据已失效→标记 stale 待复核` : '证据均仍成立',
        `建议复核后续 ${downstreamChapterIds.length} 章`,
      ]
      setImpactInfo(parts.join('；'))
    } catch (err) {
      console.error('[EditImpact] 失败:', err)
      setImpactInfo('影响分析失败，请重试')
    } finally {
      setAnalyzingImpact(false)
    }
  }

  const handleAcceptDiffs = async (accepted: StateDiffItem[]) => {
    try {
      await applyDiffs(project.id!, accepted, currentChapter?.id)
      console.log(`[StateExtract] ${accepted.length} 条变更已写入状态表`)
    } catch (err) {
      console.error('[StateExtract] 写入状态表失败:', err)
    }
    setPendingDiffs(null)
    stateAI.reset()
  }

  // ── NS-1: 单次生成 summary + continuity handoff ──
  const handleChapterMemory = async (task: {
    chapterId: number
    chapterTitle: string
    chapterContent: string
  }) => {
    setAutoProcessing('memory')
    try {
      console.log('[ChapterMemory] 开始统一抽取:', task.chapterTitle)
      const result = await runChapterMemoryTask({
        projectId: project.id!,
        ...task,
        call: messages => memoryAI.start(messages, undefined, {
          category: 'chapter.memory',
          projectId: project.id!,
        }),
      })
      if (result.status === 'written') {
        await refreshChapter(task.chapterId)
        console.log('[ChapterMemory] summary + handoff 已原子写回')
      } else if (result.status === 'stale') {
        console.warn('[ChapterMemory] 正文已变化，旧任务结果已丢弃')
      } else {
        console.error('[ChapterMemory] 结构化输出解析失败，保留真实 tail 降级')
      }
    } catch (err) {
      console.error('[ChapterMemory] 统一抽取失败，保留真实 tail 降级:', err)
    } finally {
      setAutoProcessing('idle')
      memoryAI.reset()
    }
  }

  const handleManualMemory = async () => {
    if (!currentChapter?.id || !plainText.trim() || autoProcessing === 'memory') return
    const chapterId = currentChapter.id
    const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
    const persisted = await persistCurrentEditorContent()
    if (!persisted) return
    await handleChapterMemory({ chapterId, chapterTitle, chapterContent: persisted.html })
  }

  const handleConfirmActualProgress = async () => {
    if (!currentChapter?.id || !currentChapter.planReconciliation) return
    const reconciliation = currentChapter.planReconciliation
    const confirmedActualProgress = [
      ...reconciliation.completedGoals.map(item => `已完成：${item.text}`),
      ...reconciliation.deviations.map(item => `实际偏移：${item.text}`),
      ...reconciliation.newConstraints.map(item => `新增约束：${item.text}`),
      ...reconciliation.unfinishedGoals.map(item => `仍未完成：${item.text}`),
    ].join('；')
    await updateChapter(currentChapter.id, {
      planReconciliation: {
        ...reconciliation,
        reviewStatus: 'confirmed-constraint',
        confirmedActualProgress,
        reviewedAt: Date.now(),
      },
    })
  }

  const handleApplyOutlineCandidate = async () => {
    const reconciliation = currentChapter?.planReconciliation
    if (!currentChapter?.id || !outlineNode?.id || !reconciliation?.proposedOutlineSummary) return
    await updateNode(outlineNode.id, { summary: reconciliation.proposedOutlineSummary })
    await updateChapter(currentChapter.id, {
      planReconciliation: {
        ...reconciliation,
        reviewStatus: 'applied-outline',
        reviewedAt: Date.now(),
      },
    })
  }

  // ── Phase A1: 生成正文完成后的自动流程 ──
  // 接受 AI 生成的文本后，自动触发状态提取 → 一次统一章节记忆抽取。
  const handleAutoPostGenerate = async (task: {
    chapterId: number
    chapterTitle: string
    chapterContent: string
    chapterPlainText: string
  }) => {
    // 0. NS-5：重建本章检索块（非 AI，hash 守卫，便宜；供「相关前文召回」用）
    try {
      if (currentChapter) {
        await rebuildChapterChunks({
          projectId: project.id!,
          chapter: { ...currentChapter, content: task.chapterContent },
          worldGroupId: chapterWorldGroupId ?? null,
          knownEntities: characters.map(c => c.name),
        })
        await rebuildProjectNarrativeSummaries({ projectId: project.id! })
        // NS-5：若启用 embedding，后台为新块补语义向量（best-effort，不阻塞、失败退回关键词）
        const embCfg = useAIConfigStore.getState().embedding
        if (isEmbeddingReady(embCfg)) {
          void ensureChunkEmbeddings({ projectId: project.id!, cfg: embCfg })
            .catch(e => console.warn('[AutoPost] 语义索引补建失败（不影响）:', e))
        }
      }
    } catch (e) { console.error('[AutoPost] 检索块重建失败:', e) }

    // 1. 自动提取状态
    setAutoProcessing('extracting')
    try {
      const stateCtx = buildSelectiveStateContext(task.chapterPlainText, extraStateIds).text
      const characterNames = characters.map(character => character.name)
      const messages = buildStateExtractPrompt(stateCtx, task.chapterTitle, task.chapterPlainText, characterNames)
      console.log('[AutoPost] 自动提取状态:', task.chapterTitle)
      const raw = await stateAI.start(messages, undefined, { category: 'state.extract', projectId: project.id! })
      const { diffs, error } = parseStateDiffs(raw, characterNames)
      if (error) {
        console.error('[AutoPost] 状态提取解析失败:', error)
      }
      if (diffs.length > 0) {
        setPendingDiffs(diffs as StateDiffItem[])
      } else {
        console.log('[AutoPost] 本章无状态变更')
      }
    } catch (err) {
      console.error('[AutoPost] 状态提取失败:', err)
    }

    // 2. summary + handoff 只发起这一轮统一调用，不增加第三次正文读取。
    await handleChapterMemory({
      chapterId: task.chapterId,
      chapterTitle: task.chapterTitle,
      chapterContent: task.chapterContent,
    })
  }

  const handleAcceptAI = async (text: string) => {
    if (!editorRef.current || !currentChapter?.id) return
    const acceptedChapterId = currentChapter.id
    const acceptedChapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
    const aiAction = ai.operation
    if (
      (aiAction === 'polish' || aiAction === 'expand' || aiAction === 'deai')
      && !editorRef.current.getSelectedText()
    ) {
      await dialog.alert({
        title: '请重新选中原文',
        message: '切换页面后原选区无法安全恢复。请在正文中重新选中要替换的文字，再点击“采纳”。生成结果会继续保留。',
      })
      return
    }
    // G6：去掉段落之间的多余空行——丢弃纯空行，每个非空行成一段，段间距交给 CSS（不要空段落）
    const normalizeProse = (t: string) =>
      t.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim().length > 0).join('\n')
    const html = plainTextToHtml(normalizeProse(text))
    const shouldAutoProcess = aiAction === 'generate' || aiAction === 'continue'

    if (aiAction === 'continue') {
      editorRef.current.appendContent(html)
    } else if (aiAction === 'generate' || aiAction === 'deai-full' || aiAction === 'revise-full') {
      // generate / 整章去AI味 / 按报告修改：替换全文
      editorRef.current.setContent(html)
      // setContent 不触发 onChange，这里手动同步
      const newHtml = editorRef.current.getHTML()
      setContent(newHtml)
      setPlainText(editorRef.current.getPlainText())
    } else {
      // polish/expand/deai（选区）：替换选区（若无选区则插入在光标处）
      editorRef.current.replaceSelection(html)
    }
    ai.reset()

    // 先把完整正文落库，再启动带 hash CAS 的异步后处理。
    if (shouldAutoProcess) {
      const fullHtml = editorRef.current.getHTML()
      const fullText = editorRef.current.getPlainText()
      await updateChapter(acceptedChapterId, {
        content: fullHtml,
        wordCount: countWords(fullText),
      })
      setContent(fullHtml)
      setPlainText(fullText)
      setSavedContent(fullHtml)
      void handleAutoPostGenerate({
        chapterId: acceptedChapterId,
        chapterTitle: acceptedChapterTitle,
        chapterContent: fullHtml,
        chapterPlainText: fullText,
      })
    }
  }

  // 没有选中章节
  if (!currentChapter) {
    if (outlineNodeId) {
      const node = nodes.find(n => n.id === outlineNodeId)
      return (
        <div className="max-w-4xl flex flex-col items-center justify-center h-64 gap-3">
          <p className="text-text-muted text-sm">章节「{node?.title}」还没有正文</p>
          <button onClick={handleCreateFromOutline}
            className="px-4 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors">
            创建章节并开始写作
          </button>
        </div>
      )
    }
    return (
      <div className="max-w-4xl">
        <h2 className="text-xl font-bold text-text-primary mb-4">✍️ 写作</h2>
        <div className="space-y-1">
          {chapters.map(ch => (
            <button key={ch.id} onClick={() => selectChapter(ch.id!)}
              className="w-full text-left px-3 py-2 rounded-md text-sm bg-bg-surface hover:bg-bg-hover text-text-secondary transition-colors">
              <span className="text-text-primary">{ch.title}</span>
              <span className="ml-2 text-text-muted text-xs">{ch.wordCount} 字</span>
            </button>
          ))}
          {chapters.length === 0 && (
            <p className="text-text-muted text-sm text-center py-12">请先在「大纲」中创建章节，然后点击写作图标进入编辑</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-bg-base/40">
      {/* 标题栏 —— sticky 固定在顶部，必须不透光，否则正文下滑时会从底下透出来 */}
      <div className="sticky top-0 z-20 border-b border-border bg-bg-base">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">
              创作区 · 正文
            </p>
            <h2 className="font-serif text-xl font-semibold text-text-primary">{chapterDisplay?.title ?? currentChapter.title}</h2>
          </div>
          <span className="rounded-full border border-border bg-bg-elevated px-2.5 py-1 text-xs text-text-muted">
            {wordCount.toLocaleString()} 字
          </span>
          <select
            aria-label="章节状态"
            value={currentChapter.status}
            onChange={e => currentChapter.id && updateChapter(currentChapter.id, {
              status: e.target.value as ChapterStatus,
            })}
            title="章节状态会决定该章是否可用于文风学习"
            className={`text-xs px-2 py-1 rounded border border-transparent focus:outline-none focus:border-accent cursor-pointer ${CHAPTER_STATUS_STYLE[currentChapter.status]}`}
          >
            {CHAPTER_STATUS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowContext(!showContext)}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary">
            <Eye className="w-3.5 h-3.5" /> 上下文
          </button>
          <button onClick={() => { void persistCurrentEditorContent() }}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-accent">
            <Save className="w-3.5 h-3.5" /> 保存
          </button>
        </div>
      </div>

      {/* 上下文查看器 */}
      {showContext && (
        <div className="mx-6 mb-3 max-h-64 overflow-y-auto rounded-xl border border-border bg-bg-elevated p-3 text-xs text-text-muted shadow-theme-sm">
          <p className="font-medium text-text-secondary mb-1">📋 发送给 AI 的上下文：</p>
          <div className="whitespace-pre-wrap">
            {worldCtx && <p>【世界观】{worldCtx.slice(0, 500)}...</p>}
            {charCtx && <p>【角色】{charCtx.slice(0, 300)}...</p>}
            {outlineNode && <p>【章节大纲】{outlineNode.title}：{outlineNode.summary}</p>}
          </div>

          {/* A2: 状态卡注入预览 */}
          {stateCards.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1">
                <p className="font-medium text-text-secondary">
                  📋 状态卡注入（{selectiveState.matchedIds.length}/{selectiveState.allIds.length}）
                </p>
                <button onClick={() => setShowStatePreview(!showStatePreview)}
                  className="text-accent hover:text-accent-hover text-xs">
                  {showStatePreview ? '收起' : '展开调整'}
                </button>
              </div>
              {showStatePreview && (
                <div className="space-y-1 mt-1">
                  {stateCards.map(card => {
                    const isMatched = selectiveState.matchedIds.includes(card.id!)
                    const isExtra = extraStateIds.includes(card.id!)
                    return (
                      <label key={card.id} className="flex items-center gap-1.5 cursor-pointer hover:bg-bg-hover rounded px-1 py-0.5">
                        <button
                          onClick={() => {
                            if (isExtra) {
                              setExtraStateIds(extraStateIds.filter(id => id !== card.id))
                            } else if (!isMatched) {
                              setExtraStateIds([...extraStateIds, card.id!])
                            } else {
                              // 已自动匹配的，不允许取消（用户可通过不勾选来忽略）
                            }
                          }}
                          className="flex-shrink-0"
                        >
                          {isMatched || isExtra
                            ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                            : <Square className="w-3.5 h-3.5 text-text-muted" />
                          }
                        </button>
                        <span className={`px-1 py-0.5 rounded text-[10px] ${
                          card.category === 'character' ? 'bg-blue-500/10 text-blue-400' :
                          card.category === 'location' ? 'bg-green-500/10 text-green-400' :
                          card.category === 'item' ? 'bg-yellow-500/10 text-yellow-400' :
                          card.category === 'faction' ? 'bg-purple-500/10 text-purple-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>{card.category === 'character' ? '角色' : card.category === 'location' ? '地点' : card.category === 'item' ? '物品' : card.category === 'faction' ? '势力' : '事件'}</span>
                        <span className={isMatched || isExtra ? 'text-text-primary' : 'text-text-muted'}>{card.entityName}</span>
                        {isMatched && !isExtra && <span className="text-[10px] text-accent/60">自动匹配</span>}
                        {isExtra && <span className="text-[10px] text-warning">手动添加</span>}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI 工具栏 */}
      <div className="flex flex-wrap gap-2 border-t border-border/60 bg-bg-surface/35 px-6 py-3">
        <button onClick={handleGenerate} disabled={ai.isStreaming}
          className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50 transition-colors">
          ✨ 生成正文
        </button>
        <button onClick={handleContinue} disabled={ai.isStreaming || !plainText}
          className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
          📝 续写
        </button>
        <button onClick={handleExpand} disabled={ai.isStreaming}
          className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
          📖 扩写
        </button>
        <button onClick={handlePolish} disabled={ai.isStreaming}
          className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
          💎 润色
        </button>
        <button onClick={handleDeAI} disabled={ai.isStreaming}
          className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors">
          🔥 去AI味
        </button>
        <button onClick={handleExtractState} disabled={ai.isStreaming || extracting || !plainText}
          title="AI 分析本章内容，提取角色/地点/物品等状态变更"
          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-md hover:bg-emerald-500/20 disabled:opacity-50 transition-colors">
          <ClipboardList className="w-3 h-3" />
          {extracting ? '提取中...' : '提取状态'}
        </button>
        <button onClick={handleExtractFacts} disabled={factAI.isStreaming || extractingFacts || !plainText}
          title="NS-4：AI 从本章正文抽取受控事实，落入事实账本候选（作者确认后注回后续生成，长期一致性）"
          className="flex items-center gap-1 px-3 py-1.5 bg-sky-500/10 text-sky-400 text-xs rounded-md hover:bg-sky-500/20 disabled:opacity-50 transition-colors">
          <ClipboardList className="w-3 h-3" />
          {extractingFacts ? '抽取中...' : '提取事实'}
        </button>
        <button onClick={handleEditImpact} disabled={analyzingImpact || !plainText}
          title="NS-6：改了历史章后，检查源自本章的事实证据是否失效（失效则降级待复核），并列出需复核的后续章节。不会自动改正文。"
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500/10 text-amber-400 text-xs rounded-md hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
          <ClipboardList className="w-3 h-3" />
          {analyzingImpact ? '分析中...' : '影响分析'}
        </button>
        {impactInfo && (
          <span className="flex items-center gap-2 px-2 py-1 text-xs text-amber-300/90 bg-amber-500/5 rounded-md">
            {impactInfo}
            <button onClick={() => setImpactInfo(null)} className="text-text-muted hover:text-text-primary">×</button>
          </span>
        )}
        {outlineNodeId && (
          <button onClick={() => setShowOutlinePreview(!showOutlinePreview)}
            title="大纲预览"
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
              showOutlinePreview
                ? 'bg-accent/10 text-accent'
                : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
            }`}>
            <BookOpenCheck className="w-3 h-3" />
            大纲预览
          </button>
        )}
        <button onClick={() => setShowReviewPanel(!showReviewPanel)}
          disabled={!plainText}
          title="质量审校"
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50 ${
            showReviewPanel
              ? 'bg-success/10 text-success'
              : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}>
          <ShieldCheck className="w-3 h-3" />
          质量审校
        </button>
        <button onClick={() => setShowNotePanel(!showNotePanel)}
          title="便签"
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            showNotePanel
              ? 'bg-yellow-500/10 text-yellow-600'
              : 'bg-bg-elevated text-text-secondary hover:text-text-primary'
          }`}>
          <StickyNote className="w-3 h-3" />
          便签
        </button>
        <CInput value={customInstruction} onChange={e => setCustomInstruction(e.target.value)}
          placeholder="自定义指令..."
          className="min-w-[220px] flex-1 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent" />
      </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      {outlineNode && (
        <div className="rounded-xl border border-border bg-bg-surface/70 px-5 py-4 shadow-theme-sm">
          <div className="flex items-start gap-3">
            <span className="mt-1 text-accent">☰</span>
            <div>
              <p className="text-xs font-semibold text-text-secondary">本章目标 · {outlineNode.title}</p>
              <p className="mt-1 text-sm leading-7 text-text-secondary">
                {outlineNode.summary || '暂无章纲摘要。'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* D3: 大纲预览 */}
      {showOutlinePreview && outlineNodeId && (
        <div className="mb-3">
          <OutlinePreview outlineNodeId={outlineNodeId} onClose={() => setShowOutlinePreview(false)} />
        </div>
      )}

      {/* F: 质量审校面板 */}
      {showReviewPanel && (
        <div className="mb-3">
          <ReviewPanel
            projectId={project.id!}
            chapterId={currentChapter.id!}
            outlineNodeId={currentChapter.outlineNodeId}
            worldGroupId={chapterWorldGroupId}
            chapterContent={plainText}
            chapterTitle={outlineNode?.title || currentChapter?.title || ''}
            worldContext={worldCtx}
            characterContext={charCtx}
            prevChapterSummary={(() => {
              const prev = findPreviousCanonicalChapter(nodes, chapters, currentChapter)
              return prev?.summary || ''
            })()}
            nextChapterSummary={(() => {
              const next = findNextCanonicalChapter(nodes, chapters, currentChapter)
              return next?.summary || ''
            })()}
            foreshadowContext={currentChapter?.id ? buildForeshadowContext(currentChapter.id, chapters, nodes) : ''}
            stateContext={stateCards.slice(0, 10).map(sc => `${sc.category}:${sc.entityName} — ${sc.fields?.slice(0, 50)}`).join('\n')}
            onClose={() => setShowReviewPanel(false)}
            onReviseByReport={handleReviseByReport}
          />
        </div>
      )}

      {/* H3: 便签面板 */}
      {showNotePanel && (
        <div className="mb-3">
          <NotePanel projectId={project.id!} chapterId={currentChapter?.id} onClose={() => setShowNotePanel(false)} />
        </div>
      )}

      {/* AI 输出 */}
      {/* A3: 情感节拍卡 */}
      {outlineNode && currentChapter?.id && (
        <EmotionBeatCard
          projectId={project.id!}
          chapterId={currentChapter.id}
          chapterTitle={outlineNode.title || currentChapter.title}
          chapterSummary={outlineNode.summary || ''}
          worldContext={worldCtx}
          characterContext={charCtx}
          prevChapterEnding={(() => {
            const prev = findPreviousCanonicalChapter(nodes, chapters, currentChapter)
            return htmlToPlainText(prev?.content || '').slice(-500)
          })()}
        />
      )}

      {/* Phase 21.3: 上下文预算条 */}
      {contextBudget && (
        <div className="mb-2">
          <ContextBudgetBar budget={contextBudget} compact={ai.isStreaming} />
        </div>
      )}

      {(ai.output || ai.isStreaming || ai.error) && (
        <div className="mb-3">
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming} error={ai.error} tokenUsage={ai.tokenUsage}
            onStop={ai.stop} onAccept={handleAcceptAI}
            onDismiss={ai.reset}
            onRetry={() => {
              if (ai.operation === 'generate') handleGenerate()
              else if (ai.operation === 'continue') handleContinue()
              else if (ai.operation === 'polish') handlePolish()
              else if (ai.operation === 'expand') handleExpand()
              else if (ai.operation === 'deai' || ai.operation === 'deai-full') handleDeAI()
              else if (ai.operation === 'revise-full') {
                const cachedReport = currentChapter?.id
                  ? useReviewResultStore.getState().byChapter[currentChapter.id]?.review
                  : null
                const report = reviseReportRef.current ?? cachedReport
                if (report) handleReviseByReport(report)
              }
            }} />
        </div>
      )}

      {/* Phase A1/A3: 自动后处理状态指示 */}
      {autoProcessing !== 'idle' && (
        <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <ClipboardList className="w-3.5 h-3.5 animate-pulse" />
            {autoProcessing === 'extracting' && '正在自动提取状态变更...'}
            {autoProcessing === 'memory' && '正在生成章节记忆与计划对账...'}
          </div>
        </div>
      )}

      {/* Phase A3: 章节摘要显示 + 手动重新生成（改完终稿可基于当前正文刷新） */}
      {(currentChapter?.summary || plainText) && (
        <div className="mb-3 p-3 bg-bg-elevated border border-border rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-text-muted">📝 章节摘要</p>
            <button
              onClick={handleManualMemory}
              disabled={!plainText || autoProcessing === 'memory' || memoryAI.isStreaming}
              title="基于当前正文一次刷新摘要与连续性交接记忆"
              className="flex items-center gap-1 text-xs text-text-muted hover:text-accent disabled:opacity-50 transition-colors"
            >
              <FileText className="w-3 h-3" />
              {autoProcessing === 'memory'
                ? '生成中...'
                : currentChapter?.summary ? '刷新章节记忆' : '生成章节记忆'}
            </button>
          </div>
          {currentChapter?.summary
            ? <p className="text-sm text-text-secondary">{currentChapter.summary}</p>
            : <p className="text-xs text-text-muted/60">改完正文后生成章节记忆，让后续章节获得可校验的前情与交接约束。</p>}
        </div>
      )}

      {currentChapter.planReconciliation
        && !planReconciliationCurrent
        && (currentChapter.planReconciliation.reviewStatus === 'pending'
          || currentChapter.planReconciliation.reviewStatus === 'confirmed-constraint') && (
        <div className="mb-3 px-3 py-2 text-xs text-text-muted bg-bg-elevated border border-border rounded-lg">
          计划对账已因正文或章纲变化而失效；刷新章节记忆后再处理。
        </div>
      )}

      {currentChapter.planReconciliation && planReconciliationCurrent && (
        <div className="mb-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-amber-300">计划—正文对账</p>
            <span className="text-[10px] text-text-muted">
              {currentChapter.planReconciliation.reviewStatus === 'pending' ? '待确认' : '已处理'}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-text-secondary">
            {([
              ['已完成', currentChapter.planReconciliation.completedGoals],
              ['未完成', currentChapter.planReconciliation.unfinishedGoals],
              ['实际偏移', currentChapter.planReconciliation.deviations],
              ['新增约束', currentChapter.planReconciliation.newConstraints],
              ['下一章影响', currentChapter.planReconciliation.nextChapterImpacts],
            ] as const).flatMap(([label, items]) => items.map((item, index) => (
              <div key={`${label}:${index}`}>
                <p><span className="text-amber-300/80">{label}：</span>{item.text}</p>
                {item.evidenceQuotes[0] && (
                  <p className="pl-3 text-[11px] text-text-muted">证据：“{item.evidenceQuotes[0].quote}”</p>
                )}
              </div>
            )))}
          </div>
          {currentChapter.planReconciliation.reviewStatus === 'pending' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => { void handleConfirmActualProgress() }}
                className="px-2 py-1 text-xs rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              >
                确认并附加实际进展约束
              </button>
              {currentChapter.planReconciliation.proposedOutlineSummary && (
                <button
                  onClick={() => { void handleApplyOutlineCandidate() }}
                  className="px-2 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20"
                >
                  用候选更新本章章纲
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* TipTap 富文本编辑器 */}
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-bg-elevated px-8 py-8 shadow-theme-md">
        <RichEditor
          ref={editorRef}
          value={content}
          onChange={(html, plain) => {
            setContent(html)
            setPlainText(plain)
          }}
          placeholder="开始写作..."
          minHeight={560}
          className="sf-manuscript-editor border-0 bg-transparent shadow-none"
          contentHeader={
            <div className="mb-8 mt-8 text-center">
              <p className="text-[11px] uppercase tracking-[0.28em] text-text-muted">
                {chapterDisplay?.ordinal != null ? `第 ${chapterDisplay.ordinal} 章` : '正文'}
              </p>
              <h1 className="mt-4 font-serif text-3xl font-semibold tracking-wide text-text-primary">
                {chapterDisplay?.title ?? currentChapter.title}
              </h1>
              <div className="mx-auto mt-5 h-px w-24 bg-border" />
            </div>
          }
        />
      </div>

      {/* Phase 24.3: 选中文本浮动工具栏 */}
      <FloatingToolbar
        getSelectedText={() => editorRef.current?.getSelectedText() || ''}
        getSelectionRect={() => {
          const sel = window.getSelection()
          if (!sel || sel.isCollapsed || !sel.rangeCount) return null
          return sel.getRangeAt(0).getBoundingClientRect()
        }}
        replaceSelectedText={(text) => {
          editorRef.current?.replaceSelection(text)
        }}
        disabled={ai.isStreaming}
      />

      {/* 作者笔记 */}
      <div className="mt-3">
        <label className="block text-xs text-text-muted mb-1">
          <FileText className="w-3 h-3 inline mr-1" />作者笔记
        </label>
        <textarea
          value={currentChapter.notes || ''}
          onChange={e => currentChapter.id && updateChapter(currentChapter.id, { notes: e.target.value })}
          placeholder="写给自己的备忘..."
          rows={2}
          className="w-full p-2 bg-bg-elevated border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent"
        />
      </div>

      </div>

      {/* 状态变更审核弹窗 */}
      {pendingDiffs !== null && (
        <StateDiffModal
          diffs={pendingDiffs}
          chapterTitle={outlineNode?.title || currentChapter.title || ''}
          onConfirm={handleAcceptDiffs}
          onCancel={() => { setPendingDiffs(null); stateAI.reset() }}
          showSkip={autoProcessing !== 'idle'}
        />
      )}
    </div>
  )
}
