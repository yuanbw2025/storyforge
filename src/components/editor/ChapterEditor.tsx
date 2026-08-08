import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { FileText, ClipboardList } from 'lucide-react'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import { useStateCardStore } from '../../stores/state-card'
import { useCharacterStore } from '../../stores/character'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { useAutoSave } from '../../hooks/useAutoSave'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { buildChapterContentPrompt, buildContinuePrompt, buildPolishPrompt, buildExpandPrompt, buildDeAIPrompt } from '../../lib/ai/adapters/chapter-adapter'
import { buildReviewRevisePrompt, type ReviewResult } from '../../lib/ai/adapters/review-adapter'
import { buildStateExtractPrompt, parseStateDiffs } from '../../lib/ai/adapters/state-extract-adapter'
import { rebuildChapterChunks, ensureChunkEmbeddings, rebuildProjectNarrativeSummaries } from '../../lib/retrieval/retrieval'
import { isEmbeddingReady } from '../../lib/ai/adapters/embedding-adapter'
import { propagateChapterEditStale, analyzeEditImpact } from '../../lib/consistency/impact-analysis'
import { runChapterMemoryTask } from '../../lib/ai/chapter-memory/run-chapter-memory'
import { prepareContinuityContext } from '../../lib/ai/chapter-memory/continuity-context'
import { isPlanReconciliationCurrent } from '../../lib/ai/chapter-memory/plan-reconciliation'
import { findNextCanonicalChapter, findPreviousCanonicalChapter } from '../../lib/ai/chapter-memory/canonical-chapter-sequence'
import { chat, resolveRequestConfig } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
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
import {
  prepareGenerationNode,
  runGenerationNode,
  type PreparedGenerationNode,
} from '../../lib/generation/generation-node'
import {
  createChapterGenerationNode,
  type ChapterGenerationCategory,
  type ChapterGenerationOperation,
} from '../../lib/generation/chapter-generation-node'
import RichEditor, { type RichEditorHandle } from './RichEditor'
import EmotionBeatCard from './EmotionBeatCard'
import FloatingToolbar from './FloatingToolbar'
import ChapterEditorHeader from './ChapterEditorHeader'
import ChapterMemoryPanel from './ChapterMemoryPanel'
import ChapterContextPreview from './ChapterContextPreview'
import ChapterEditorToolbar from './ChapterEditorToolbar'
import PromptPreviewGate from '../shared/PromptPreviewGate'
import { useItemLedgerStore } from '../../stores/item-ledger'
import { useLocationStore } from '../../stores/location'
import { useCodexStore } from '../../stores/codex'
import { buildEditorEntityReferences } from '../../lib/editor/entity-reference'
import type { ChatMessage, Project, StateDiffItem } from '../../lib/types'
import {
  adoptChapterOrganizationSelection,
  isChapterOrganizationCurrent,
  persistChapterOrganizationCandidate,
  readLatestChapterOrganizationRun,
  runChapterOrganization,
  type ChapterOrganizationRun,
  type ChapterOrganizationSelection,
} from '../../lib/agent/chapter-organization'
import {
  beginChapterOrganizationDurableStepV1,
  commitChapterOrganizationDurableAdoptionV1,
  createChapterOrganizationDurableRunV1,
  failChapterOrganizationDurableStepV1,
  hashChapterOrganizationCandidateV1,
  markChapterOrganizationStaleV1,
  recordChapterOrganizationCandidateV1,
  recoverChapterOrganizationCandidateV1,
  CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
  CHAPTER_ORGANIZATION_SOURCE_KEYS_V1,
} from '../../lib/agent/run/chapter-organization-durable'
import {
  beginChapterTransitionStepV1,
  commitChapterTransitionStateAdoptionV1,
  createChapterTransitionDurableRunV1,
  failChapterTransitionStepV1,
  hashChapterTransitionCandidateV1,
  isChapterTransitionCandidateCurrentV1,
  persistChapterTransitionCandidateV1,
  readLatestChapterTransitionCandidateV1,
  recordChapterTransitionOutputV1,
  recoverChapterTransitionCandidateV1,
  scheduleChapterTransitionStepsV1,
  succeedChapterTransitionStepV1,
  verifyChapterTransitionRunV1,
  CHAPTER_TRANSITION_SOURCE_KEYS_V1,
  CHAPTER_TRANSITION_STEP_IDS_V1,
  type ChapterTransitionCandidateV1,
  type ChapterTransitionStepIdV1,
} from '../../lib/agent/run/chapter-transition-durable'
import { createContextManifestFromAssemblyV1 } from '../../lib/agent/run/context-manifest'
import type { AgentRunSnapshotV1 } from '../../lib/agent/run/event-store'
import { hashChapterText } from '../../lib/ai/chapter-memory/text-normalization'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import { AgentTeamBudgetTracker } from '../../lib/agent/team-budget'
import {
  isConsistencyAgentCurrent,
  persistConsistencyAgentCandidate,
  readLatestConsistencyAgentRun,
  runBackgroundConsistencyAgent,
  toConsistencyAuditResult,
  type ConsistencyAgentRun,
} from '../../lib/agent/consistency-agent'

const StateDiffModal = lazy(() => import('../state/StateDiffModal'))
const OutlinePreview = lazy(() => import('../outline/OutlinePreview'))
const ReviewPanel = lazy(() => import('./ReviewPanel'))
const NotePanel = lazy(() => import('./NotePanel'))
const ComparePolishPanel = lazy(() => import('./ComparePolishPanel'))
const ChapterOrganizationModal = lazy(() => import('./ChapterOrganizationModal'))

function LazyPanelFallback() {
  return <div className="rounded-lg border border-border bg-bg-surface p-4 text-sm text-text-muted">面板加载中...</div>
}

/** 生成任务类型(原 memory-builder 三层记忆已被 assembleContext 取代,此类型仅用于调试日志标签) */
type MemoryTaskType = 'write' | 'plan' | 'review'

interface PendingChapterGeneration {
  operation: ChapterGenerationOperation
  category: ChapterGenerationCategory
  prepared: PreparedGenerationNode
  backgroundMemoryIds: number[]
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
  const { entries: itemEntries, loadAll: loadItemLedger } = useItemLedgerStore()
  const { locations, loadAll: loadLocations } = useLocationStore()
  const { categories: codexCategories, entries: codexEntries, loadExisting: loadCodex } = useCodexStore()

  // content 为 HTML 字符串；旧数据是纯文本，RichEditor 内部会自动包装
  const [content, setContent] = useState('')
  const [plainText, setPlainText] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [manualSaveError, setManualSaveError] = useState('')
  const [showContext, setShowContext] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
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
  const editorRef = useRef<RichEditorHandle>(null)
  const organizationAbortRef = useRef<AbortController | null>(null)
  const transitionSnapshotRef = useRef<AgentRunSnapshotV1 | null>(null)
  const transitionCandidateRef = useRef<ChapterTransitionCandidateV1 | null>(null)
  const consistencyRunRef = useRef<ConsistencyAgentRun | null>(null)
  const memoryRebuildInFlightRef = useRef(new Set<number>())
  const creatingChapterForOutlineRef = useRef(new Set<number>())
  const reviseReportRef = useRef<ReviewResult | null>(null)  // G8：记住上次"按报告修改"的报告，供重试
  // Phase A1: 自动流程标记
  const [autoProcessing, setAutoProcessing] = useState<'idle' | 'extracting' | 'memory'>('idle')
  const [showOutlinePreview, setShowOutlinePreview] = useState(false)
  const [showReviewPanel, setShowReviewPanel] = useState(false)
  const [showNotePanel, setShowNotePanel] = useState(false)
  const [compareSourceHtml, setCompareSourceHtml] = useState<string | null>(null)
  const [contextBudget, setContextBudget] = useState<ContextBudget | null>(null)
  const [transparentMode, setTransparentMode] = useState(false)
  const [pendingGeneration, setPendingGeneration] = useState<PendingChapterGeneration | null>(null)
  const [planReconciliationCurrent, setPlanReconciliationCurrent] = useState(false)
  const [organizationRun, setOrganizationRun] = useState<ChapterOrganizationRun | null>(null)
  const [organizationCurrent, setOrganizationCurrent] = useState(false)
  const [organizingChapter, setOrganizingChapter] = useState(false)
  const [organizationError, setOrganizationError] = useState('')
  const [showOrganization, setShowOrganization] = useState(false)
  const [transitionCandidate, setTransitionCandidate] = useState<ChapterTransitionCandidateV1 | null>(null)
  const [transitionRunId, setTransitionRunId] = useState<number | null>(null)
  const [transitionError, setTransitionError] = useState('')
  const [consistencyRun, setConsistencyRun] = useState<ConsistencyAgentRun | null>(null)
  const [consistencyCurrent, setConsistencyCurrent] = useState(false)
  const aiConfig = useAIConfigStore(s => s.config)
  const dialog = useDialog()

  useEffect(() => {
    consistencyRunRef.current = consistencyRun
  }, [consistencyRun])

  useEffect(() => {
    transitionCandidateRef.current = transitionCandidate
  }, [transitionCandidate])

  // 字数（基于纯文本）
  const wordCount = useMemo(() => countWords(plainText), [plainText])

  // 有未保存内容时阻止页面关闭
  useBeforeUnload(content !== savedContent && plainText.length > 0)

  useEffect(() => { loadChapters(project.id!) }, [project.id, loadChapters])
  useEffect(() => { loadStateCards(project.id!) }, [project.id, loadStateCards])
  useEffect(() => { loadCharacters(project.id!) }, [project.id, loadCharacters])
  useEffect(() => { loadArcs(project.id!) }, [project.id, loadArcs])
  useEffect(() => { loadForeshadows(project.id!) }, [project.id, loadForeshadows])
  useEffect(() => { loadItemLedger(project.id!) }, [project.id, loadItemLedger])
  useEffect(() => { loadLocations(project.id!) }, [project.id, loadLocations])
  useEffect(() => { loadCodex(project.id!) }, [project.id, loadCodex])
  useEffect(() => {
    let active = true
    setOrganizationRun(null)
    setOrganizationCurrent(false)
    setShowOrganization(false)
    setOrganizationError('')
    if (!currentChapter?.id) return () => { active = false }
    void (async () => {
      const run = await readLatestChapterOrganizationRun({
        projectId: project.id!,
        chapterId: currentChapter.id!,
      })
      if (run?.candidate.durable) {
        try {
          await recoverChapterOrganizationCandidateV1({
            scope: await resolveScopeLike(project.id!),
            candidate: run.candidate,
          })
        } catch (error) {
          console.warn('[ChapterOrganization] 恢复 durable 候选证据失败:', error)
        }
      }
      const current = run ? await isChapterOrganizationCurrent(run.candidate) : false
      if (!active) return
      setOrganizationRun(run)
      setOrganizationCurrent(current)
    })().catch(error => {
      if (active) setOrganizationError(error instanceof Error ? error.message : '读取整理记录失败')
    })
    return () => { active = false }
  }, [currentChapter?.id, project.id])
  useEffect(() => {
    let active = true
    transitionSnapshotRef.current = null
    setTransitionCandidate(null)
    transitionCandidateRef.current = null
    setPendingDiffs(null)
    setTransitionRunId(null)
    setTransitionError('')
    if (!currentChapter?.id) return () => { active = false }
    void (async () => {
      const scope = await resolveScopeLike(project.id!)
      const stored = await readLatestChapterTransitionCandidateV1({
        scope,
        chapterId: currentChapter.id!,
      })
      const recovered = stored
        ? await recoverChapterTransitionCandidateV1({ scope, candidate: stored })
        : null
      if (!active || !recovered) return
      setTransitionCandidate(recovered)
      setTransitionRunId(recovered.durable.runId)
      setPendingDiffs(recovered.stateDiffs)
    })().catch(error => {
      if (active) setTransitionError(error instanceof Error ? error.message : '读取章节后处理记录失败')
    })
    return () => { active = false }
  }, [currentChapter?.id, project.id])
  useEffect(() => {
    let active = true
    setConsistencyRun(null)
    setConsistencyCurrent(false)
    if (!currentChapter?.id) return () => { active = false }
    void (async () => {
      const run = await readLatestConsistencyAgentRun({
        projectId: project.id!,
        chapterId: currentChapter.id!,
      })
      const current = run ? await isConsistencyAgentCurrent(run.candidate) : false
      if (!active) return
      setConsistencyRun(run)
      setConsistencyCurrent(current)
      if (run) {
        useReviewResultStore.getState().setConsistency(
          currentChapter.id!,
          toConsistencyAuditResult(run.candidate),
        )
      }
    })()
    return () => { active = false }
  }, [currentChapter?.id, project.id])
  useEffect(() => {
    setPendingGeneration(null)
  }, [currentChapter?.id, outlineNodeId])

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

  const handleManualSave = useCallback(async () => {
    if (manualSaving) return
    setManualSaving(true)
    setManualSaveError('')
    try {
      await persistCurrentEditorContent()
    } catch (error) {
      setManualSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setManualSaving(false)
    }
  }, [manualSaving, persistCurrentEditorContent])

  // 切换章节：同步到本地 state（RichEditor 会基于 value 重建内容）
  useEffect(() => {
    const raw = currentChapter?.content || ''
    setContent(raw)
    setPlainText(htmlToPlainText(raw))
  }, [currentChapter])

  // 切换章节时同步 savedContent（只在章节 id 变化时）
  useEffect(() => {
    setSavedContent(currentChapter?.content || '')
    setManualSaveError('')
  }, [currentChapter?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- 保存基线只在切章时重置，自动保存不能重置脏状态

  useEffect(() => {
    setCompareSourceHtml(null)
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

  // 后台一致性 Agent：正文稳定落盘后只跑零 token 确定性守卫。
  // 没有告警时不制造归档记录；LLM fast/deep 必须由质量审校面板中的明确按钮触发。
  useEffect(() => {
    let active = true
    const chapterId = currentChapter?.id
    const savedPlain = htmlToPlainText(savedContent).trim()
    if (!chapterId || !savedPlain) return () => { active = false }
    const timer = setTimeout(() => {
      void (async () => {
        if (consistencyRunRef.current) {
          const current = await isConsistencyAgentCurrent(consistencyRunRef.current.candidate)
          if (active) setConsistencyCurrent(current)
        }
        const budget = new AgentTeamBudgetTracker(
          useAIConfigStore.getState().agentTeamBudgetProfile,
        )
        const candidate = await runBackgroundConsistencyAgent({
          projectId: project.id!,
          chapterId,
          chapterTitle: outlineNode?.title || currentChapter.title || '未知章节',
          worldGroupId: chapterWorldGroupId ?? null,
          chapterContent: savedContent,
          budget,
        })
        if (!active || candidate.findings.length === 0) return
        const run = await persistConsistencyAgentCandidate(candidate)
        if (!active) return
        setConsistencyRun(run)
        setConsistencyCurrent(true)
        useReviewResultStore.getState().setConsistency(
          chapterId,
          toConsistencyAuditResult(candidate),
        )
      })().catch(error => {
        console.error('[ConsistencyAgent] 后台确定性检查失败:', error)
      })
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    chapterWorldGroupId,
    currentChapter?.id,
    currentChapter?.title,
    outlineNode?.title,
    project.id,
    savedContent,
  ])
  const entityReferences = useMemo(() => buildEditorEntityReferences({
    characters,
    itemEntries,
    locations,
    codexCategories,
    codexEntries,
    worldGroupId: project.enableMultiWorld ? chapterWorldGroupId : undefined,
  }), [characters, itemEntries, locations, codexCategories, codexEntries, project.enableMultiWorld, chapterWorldGroupId])
  const perspectiveCharacters = useMemo(() => characters
    .filter(character => character.id != null)
    .filter(character => (
      !project.enableMultiWorld
      || character.isCrossWorld
      || (character.homeWorldGroupId ?? null) === (chapterWorldGroupId ?? null)
    ))
    .map(character => ({ id: character.id!, name: character.name })), [
    chapterWorldGroupId,
    characters,
    project.enableMultiWorld,
  ])
  const perspectiveCharacterId = perspectiveCharacters.some(
    character => character.id === currentChapter?.perspectiveCharacterId,
  ) ? currentChapter?.perspectiveCharacterId ?? null : null
  const perspectiveCharacter = perspectiveCharacters.find(character => character.id === perspectiveCharacterId)
  const perspectiveBoundary = perspectiveCharacter
    ? '叙事视角角色：' + perspectiveCharacter.name
      + '（characterId=' + perspectiveCharacter.id + '）。只允许使用该角色在本章开始前已知的信息。'
    : '本章未指定叙事视角角色。不得代入任何角色的私人认知，也不得把其他角色掌握的信息写成当前人物已知。'

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
      sourceKeys: ['contextMemo', 'chapterOutline', 'canonAssertions', 'worldview', 'storyCore', 'characterDrivenPlan', 'powerSystem', 'cultivationProgress', 'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations', 'userStyleProfile'],
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

  const handleOpenComparePolish = async () => {
    const saved = await persistCurrentEditorContent()
    if (!saved?.plain.trim()) {
      await dialog.alert({ title: '暂无正文可供对照', message: '请先写入或生成本章正文，再打开对照润色。' })
      return
    }
    setCompareSourceHtml(saved.html)
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
        'characterDrivenPlan',
        'powerSystem',
        'cultivationProgress',
        'codex',
        'creativeRules',
        'worldRules',
        'historical',
        'locations',
        'foreshadows',
        'storyArcs',
        'storylineProgress',
        'emotionBeats',
        'stateCards',
        'currentFacts', // NS-4:当前章生效的已确认事实，回注生成防止前后矛盾
        'canonAssertions', // CONSISTENCY-3:不依赖章节时点的已确认世界宪法
        ...(perspectiveCharacterId != null
          ? ['characterKnowledge'] as const
          : []), // CONSISTENCY-2:只有明确视角时才注入该角色认知
        'heldItems', // CONSISTENCY-1:当前已持有物品，避免新章重复写首次获得
        'retrievedPassages', // NS-5:相关前文召回，防远距离细节/伏笔矛盾
        'references',
        'userStyleProfile',
      ],
      ...(perspectiveCharacterId != null ? { characterId: perspectiveCharacterId } : {}),
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

  const chapterGenerationNode = (
    operation: ChapterGenerationOperation,
    category: ChapterGenerationCategory,
  ) => createChapterGenerationNode({
    operation,
    category,
    projectId: project.id!,
    chapterIdentity: currentChapter?.id ?? outlineNodeId ?? 'unselected',
    ai,
  })

  const runPreparedChapterGeneration = (
    operation: ChapterGenerationOperation,
    category: ChapterGenerationCategory,
    prepared: PreparedGenerationNode,
    backgroundMemoryIds: number[],
    messages?: ChatMessage[],
  ) => {
    ai.setOperation(operation)
    const node = chapterGenerationNode(operation, category)
    void runGenerationNode(node, prepared, { messages }).catch(error => {
      console.error('[ChapterEditor] 生成节点执行失败:', error)
    })
    scheduleRecentMemoryRebuild(backgroundMemoryIds)
  }

  const prepareOrRunChapterGeneration = (
    operation: ChapterGenerationOperation,
    category: ChapterGenerationCategory,
    messages: ChatMessage[],
    backgroundMemoryIds: number[],
  ) => {
    const node = chapterGenerationNode(operation, category)
    const prepared = prepareGenerationNode(node, messages)
    if (transparentMode) {
      ai.setOperation(operation)
      setPendingGeneration({ operation, category, prepared, backgroundMemoryIds })
      return
    }
    setPendingGeneration(null)
    runPreparedChapterGeneration(
      operation,
      category,
      prepared,
      backgroundMemoryIds,
    )
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
      [perspectiveBoundary, customInstruction.trim()].filter(Boolean).join('\n'),
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

    prepareOrRunChapterGeneration(
      'generate',
      'chapter.content',
      messages,
      backgroundMemoryIds,
    )
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
      [perspectiveBoundary, customInstruction.trim()].filter(Boolean).join('\n'),
      { continuity, continuityBudgetTokens },
    )
    prepareOrRunChapterGeneration(
      'continue',
      'chapter.continue',
      messages,
      backgroundMemoryIds,
    )
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

  const handleRunChapterOrganization = async (force = false) => {
    if (!currentChapter?.id || !plainText.trim()) return
    if (organizingChapter) {
      organizationAbortRef.current?.abort()
      return
    }
    if (organizationRun && !force) {
      const current = await isChapterOrganizationCurrent(organizationRun.candidate)
      setOrganizationCurrent(current)
      const hasPending = Object.values(organizationRun.candidate.domainStatus).some(
        status => status === 'pending' || status === 'failed',
      )
      if (hasPending || !current) {
        setShowOrganization(true)
        return
      }
    }

    const effectiveConfig = resolveRequestConfig(aiConfig, { category: 'chapter.organize' }).config
    if (!isAIConfigReady(effectiveConfig)) {
      const message = getAIConfigRequiredMessage(effectiveConfig)
      setOrganizationError(message)
      await dialog.alert({ title: '无法整理本章', message })
      return
    }
    const persisted = await persistCurrentEditorContent()
    if (!persisted) return

    const controller = new AbortController()
    organizationAbortRef.current?.abort()
    organizationAbortRef.current = controller
    setOrganizingChapter(true)
    setOrganizationError('')
    let durableSnapshot: Awaited<ReturnType<typeof createChapterOrganizationDurableRunV1>> | null = null
    let candidateEventPersisted = false
    try {
      const workspaceScope = await resolveScopeLike(project.id!)
      durableSnapshot = await createChapterOrganizationDurableRunV1({
        scope: workspaceScope,
        worldGroupId: chapterWorldGroupId ?? null,
        chapterId: currentChapter.id,
      })
      const assembled = await assembleContext({
        projectId: project.id!,
        scope: workspaceScope,
        worldGroupId: chapterWorldGroupId ?? null,
        chapterId: currentChapter.id,
        outlineNodeId: currentChapter.outlineNodeId,
        sourceKeys: [...CHAPTER_ORGANIZATION_SOURCE_KEYS_V1],
        inputBudgetMaxTokens: 24_000,
      })
      const contextManifest = await createContextManifestFromAssemblyV1({
        runId: durableSnapshot.run.id,
        stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
        attempt: 1,
        projectId: project.id!,
        worldGroupId: chapterWorldGroupId ?? null,
        declaredSourceKeys: CHAPTER_ORGANIZATION_SOURCE_KEYS_V1,
        assembled,
        boundary: { chapterId: currentChapter.id, outlineNodeId: currentChapter.outlineNodeId },
        readerVersion: 'chapter-organization-context-v1',
      })
      const organizationContextSnapshot = assembled.included.flatMap((sourceKey, index) => (
        sourceKey === 'chapterContent' ? [] : [assembled.segments[index]?.content ?? '']
      )).filter(Boolean).join('\n\n')
      durableSnapshot = await beginChapterOrganizationDurableStepV1({
        scope: workspaceScope,
        snapshot: durableSnapshot,
        contextManifest,
        binding: {
          chapterId: currentChapter.id,
          sourceKeys: CHAPTER_ORGANIZATION_SOURCE_KEYS_V1,
        },
      })
      const [allRelations] = await Promise.all([
        db.characterRelations.where('projectId').equals(project.id!).toArray(),
        loadForeshadows(project.id!),
      ])
      const scopedCharacters = project.enableMultiWorld
        ? characters.filter(character => (
          character.isCrossWorld
          || (character.homeWorldGroupId ?? null) === (chapterWorldGroupId ?? null)
        ))
        : characters
      const scopedCharacterIds = new Set(
        scopedCharacters.flatMap(character => character.id != null ? [character.id] : []),
      )
      const existingRelations = allRelations.filter(relation => (
        scopedCharacterIds.has(relation.fromCharacterId)
        && scopedCharacterIds.has(relation.toCharacterId)
      ))
      const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
      const budget = new AgentTeamBudgetTracker(useAIConfigStore.getState().agentTeamBudgetProfile)
      const candidate = await runChapterOrganization({
        projectId: project.id!,
        chapterId: currentChapter.id,
        chapterTitle,
        worldGroupId: chapterWorldGroupId ?? null,
        chapterContent: persisted.html,
        stateContext: buildSelectiveStateContext(persisted.plain, extraStateIds).text,
        characters: scopedCharacters,
        knownItemNames: itemEntries.map(entry => entry.itemName),
        existingRelations,
        foreshadows: useForeshadowStore.getState().foreshadows,
        // 正文已在专用区完整提供；这里只追加其它登记来源，避免正文重复消耗 tokens。
        contextSnapshot: organizationContextSnapshot,
        budget,
        call: messages => chat(messages, aiConfig, {
          category: 'chapter.organize',
          projectId: project.id!,
          configOverrides: { maxTokens: 8_000 },
          contextOverflowPolicy: 'reject',
        }, controller.signal),
      })
      const candidateHash = await hashChapterOrganizationCandidateV1(candidate)
      const run = await persistChapterOrganizationCandidate(candidate, {
        durable: {
          runId: durableSnapshot.run.id,
          stepId: CHAPTER_ORGANIZATION_DURABLE_STEP_ID_V1,
          attempt: 1,
          contextManifestHash: contextManifest.manifestHash,
          candidateHash,
        },
      })
      candidateEventPersisted = true
      await recordChapterOrganizationCandidateV1({
        scope: workspaceScope,
        snapshot: durableSnapshot,
        candidate: run.candidate,
      })
      setOrganizationRun(run)
      setOrganizationCurrent(true)
      setShowOrganization(true)
    } catch (error) {
      if (durableSnapshot && !candidateEventPersisted) {
        try {
          await failChapterOrganizationDurableStepV1({
            scope: await resolveScopeLike(project.id!),
            snapshot: durableSnapshot,
            code: error instanceof Error ? error.message : 'chapter_organization_failed',
            retryable: true,
          })
        } catch (traceError) {
          console.warn('[ChapterOrganization] durable 失败证据写入失败:', traceError)
        }
      }
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '整理本章失败'
        setOrganizationError(message)
        await dialog.alert({ title: '整理本章失败', message })
      }
    } finally {
      if (organizationAbortRef.current === controller) organizationAbortRef.current = null
      setOrganizingChapter(false)
    }
  }

  const handleApplyChapterOrganization = async (selection: ChapterOrganizationSelection) => {
    if (!organizationRun || organizingChapter) return
    setOrganizingChapter(true)
    setOrganizationError('')
    try {
      const result = await adoptChapterOrganizationSelection({ run: organizationRun, selection })
      setOrganizationRun(result.run)
      setOrganizationCurrent(true)
      const failed = Object.entries(result.run.candidate.domainErrors)
      if (failed.length) {
        setOrganizationError(failed.map(([domain, message]) => `${domain}: ${message}`).join('；'))
      } else if (result.run.candidate.durable) {
        const workspaceScope = await resolveScopeLike(project.id!)
        await commitChapterOrganizationDurableAdoptionV1({
          scope: workspaceScope,
          runId: result.run.candidate.durable.runId,
          candidate: result.run.candidate,
          written: result.written,
        })
      }
    } catch (error) {
      setOrganizationError(error instanceof Error ? error.message : '写入整理结果失败')
      if (organizationRun) {
        const current = await isChapterOrganizationCurrent(organizationRun.candidate)
        setOrganizationCurrent(current)
        if (!current && organizationRun.candidate.durable) {
          try {
            await markChapterOrganizationStaleV1({
              scope: await resolveScopeLike(project.id!),
              runId: organizationRun.candidate.durable.runId,
              reason: '正文已变化；作者确认前的整理候选已失效。',
            })
          } catch (traceError) {
            console.warn('[ChapterOrganization] stale 证据写入失败:', traceError)
          }
        }
      }
    } finally {
      setOrganizingChapter(false)
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
    let succeeded = false
    try {
      const pendingCandidate = transitionCandidateRef.current
      if (pendingCandidate && !await isChapterTransitionCandidateCurrentV1(pendingCandidate)) {
        throw new Error('章节正文已变化，这批状态候选已过期；请重新生成。')
      }
      await applyDiffs(project.id!, accepted, currentChapter?.id)
      console.log(`[StateExtract] ${accepted.length} 条变更已写入状态表`)
      const candidate = transitionCandidateRef.current
      if (candidate && candidate.chapterId === currentChapter?.id && transitionRunId != null) {
        const scope = await resolveScopeLike(project.id!)
        const snapshot = await commitChapterTransitionStateAdoptionV1({
          scope,
          runId: transitionRunId,
          candidate,
          written: accepted.length,
        })
        transitionSnapshotRef.current = snapshot
        try {
          await verifyChapterTransitionRunV1({ scope, runId: transitionRunId })
        } catch (verificationError) {
          // Memory may still be running; the later post-step completion retries verification.
          console.info('[ChapterTransition] 状态采纳后暂不能签发终态回执:', verificationError)
        }
        setTransitionCandidate(null)
        transitionCandidateRef.current = null
      }
      succeeded = true
    } catch (err) {
      console.error('[StateExtract] 写入状态表失败:', err)
      setTransitionError(err instanceof Error ? err.message : '状态候选写入失败')
    }
    if (succeeded) setPendingDiffs(null)
    stateAI.reset()
  }

  // ── NS-1: 单次生成 summary + continuity handoff ──
  const handleChapterMemory = async (task: {
    chapterId: number
    chapterTitle: string
    chapterContent: string
  }): Promise<'written' | 'stale' | 'parse-error' | 'failed'> => {
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
      return result.status
    } catch (err) {
      console.error('[ChapterMemory] 统一抽取失败，保留真实 tail 降级:', err)
      return 'failed'
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

  // ── D6: 正文接受后的 Chapter Transition post-processing barrier ──
  // 正文先落库；检索、状态候选、章节记忆分别记录为可恢复 durable steps。
  const handleAutoPostGenerate = async (task: {
    chapterId: number
    chapterTitle: string
    chapterContent: string
    chapterPlainText: string
  }) => {
    const scope = await resolveScopeLike(project.id!)
    const transitionChapter = await db.chapters.get(task.chapterId)
    const transitionOutline = transitionChapter?.outlineNodeId != null
      ? await db.outlineNodes.get(transitionChapter.outlineNodeId)
      : null
    const transitionWorldGroupId = transitionOutline?.worldGroupId ?? chapterWorldGroupId ?? null
    const expectedSourceTextHash = await hashChapterText(task.chapterContent)
    setTransitionError('')
    setTransitionCandidate(null)
    transitionCandidateRef.current = null
    setPendingDiffs(null)
    let snapshot = await createChapterTransitionDurableRunV1({
      scope,
      worldGroupId: transitionWorldGroupId,
      chapterId: task.chapterId,
    })
    setTransitionRunId(snapshot.run.id)
    transitionSnapshotRef.current = snapshot
    snapshot = await scheduleChapterTransitionStepsV1({ scope, snapshot })

    const assembled = await assembleContext({
      projectId: project.id!,
      scope,
      worldGroupId: transitionWorldGroupId,
      chapterId: task.chapterId,
      outlineNodeId: transitionChapter?.outlineNodeId ?? null,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: [...CHAPTER_TRANSITION_SOURCE_KEYS_V1],
      stateReferenceText: task.chapterPlainText,
      extraStateIds,
      inputBudgetMaxTokens: 24_000,
    })
    const manifestFor = (stepId: ChapterTransitionStepIdV1) => createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId,
      attempt: 1,
      projectId: project.id!,
      worldGroupId: transitionWorldGroupId,
      declaredSourceKeys: CHAPTER_TRANSITION_SOURCE_KEYS_V1,
      assembled,
      boundary: { chapterId: task.chapterId, outlineNodeId: transitionChapter?.outlineNodeId ?? undefined },
      readerVersion: 'chapter-transition-context-v1',
    })
    const ensureFresh = async () => {
      const latest = await db.chapters.get(task.chapterId)
      if (!latest || await hashChapterText(latest.content ?? '') !== expectedSourceTextHash) {
        throw new Error('正文已变化，章节后处理候选已过期。')
      }
    }
    const updateSnapshot = (next: AgentRunSnapshotV1) => {
      snapshot = next
      transitionSnapshotRef.current = next
    }

    // 1. NS-5：检索块和叙事摘要是确定性派生缓存；embedding 仍是可选后台补建。
    try {
      await ensureFresh()
      updateSnapshot(await beginChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.retrieval,
        contextManifest: await manifestFor(CHAPTER_TRANSITION_STEP_IDS_V1.retrieval),
        model: false,
      }))
      const chapter = await db.chapters.get(task.chapterId)
      if (!chapter) throw new Error('章节在后处理期间不可见。')
      const chunks = await rebuildChapterChunks({
        projectId: project.id!,
        chapter: { ...chapter, content: task.chapterContent },
        worldGroupId: transitionWorldGroupId,
        knownEntities: characters.map(c => c.name),
        scope,
      })
      const summaries = await rebuildProjectNarrativeSummaries({ projectId: project.id!, scope })
      const embCfg = useAIConfigStore.getState().embedding
      if (isEmbeddingReady(embCfg)) {
        void ensureChunkEmbeddings({ projectId: project.id!, cfg: embCfg, scope })
          .catch(e => console.warn('[ChapterTransition] 语义索引补建失败（关键词检索仍可用）:', e))
      }
      updateSnapshot(await succeedChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.retrieval,
        output: { chunks, summaries, sourceTextHash: expectedSourceTextHash },
      }))
    } catch (error) {
      updateSnapshot(await failChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.retrieval,
        code: error instanceof Error ? error.message : 'retrieval_post_step_failed',
      }))
      setTransitionError(error instanceof Error ? error.message : '检索后处理失败')
      return
    }

    // 2. 状态抽取只写候选；候选持久化后等待作者逐项确认。
    setAutoProcessing('extracting')
    try {
      await ensureFresh()
      updateSnapshot(await beginChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
        contextManifest: await manifestFor(CHAPTER_TRANSITION_STEP_IDS_V1.state),
        binding: { chapterId: task.chapterId, sourceTextHash: expectedSourceTextHash },
      }))
      const stateContextIndex = assembled.included.indexOf('stateCards')
      const stateCtx = stateContextIndex >= 0
        ? assembled.segments[stateContextIndex]?.content ?? ''
        : ''
      const characterNames = characters.map(character => character.name)
      const messages = buildStateExtractPrompt(stateCtx, task.chapterTitle, task.chapterPlainText, characterNames)
      const raw = await stateAI.start(messages, undefined, { category: 'state.extract', projectId: project.id! })
      const parsed = parseStateDiffs(raw, characterNames)
      if (parsed.error) throw new Error(parsed.error)
      const stateDiffs = parsed.diffs as StateDiffItem[]
      const baseCandidate = {
        version: 1 as const,
        type: 'chapter-transition-state-candidate' as const,
        projectId: project.id!,
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        worldGroupId: transitionWorldGroupId,
        sourceTextHash: expectedSourceTextHash,
        stateDiffs,
        createdAt: Date.now(),
      }
      const candidateHash = await hashChapterTransitionCandidateV1(baseCandidate)
      const candidate: ChapterTransitionCandidateV1 = {
        ...baseCandidate,
        durable: {
          runId: snapshot.run.id,
          stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
          attempt: 1,
          contextManifestHash: (await manifestFor(CHAPTER_TRANSITION_STEP_IDS_V1.state)).manifestHash,
          candidateHash,
        },
      }
      await persistChapterTransitionCandidateV1({ scope, candidate })
      updateSnapshot(await recordChapterTransitionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
        output: stateDiffs,
        candidateHash,
        requiresConfirmation: stateDiffs.length > 0,
      }))
      setTransitionCandidate(candidate)
      transitionCandidateRef.current = candidate
      if (stateDiffs.length > 0) {
        setPendingDiffs(stateDiffs)
      } else {
        updateSnapshot(await succeedChapterTransitionStepV1({
          scope,
          snapshot,
          stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
          output: stateDiffs,
        }))
      }
    } catch (error) {
      updateSnapshot(await failChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.state,
        code: error instanceof Error ? error.message : 'state_post_step_failed',
      }))
      setTransitionError(error instanceof Error ? error.message : '状态后处理失败')
    } finally {
      stateAI.reset()
    }

    // 3. summary + handoff 仍只调用一次模型，并由原子 CAS 写回 chapters。
    try {
      await ensureFresh()
      updateSnapshot(await beginChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.memory,
        contextManifest: await manifestFor(CHAPTER_TRANSITION_STEP_IDS_V1.memory),
        binding: { chapterId: task.chapterId, sourceTextHash: expectedSourceTextHash },
      }))
      const result = await handleChapterMemory({
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        chapterContent: task.chapterContent,
      })
      if (result !== 'written') throw new Error(`章节记忆后处理未写入：${result}`)
      updateSnapshot(await recordChapterTransitionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.memory,
        output: { status: result, sourceTextHash: expectedSourceTextHash },
      }))
      updateSnapshot(await succeedChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.memory,
        output: { status: result, sourceTextHash: expectedSourceTextHash },
      }))
      if (snapshot.projection.steps[CHAPTER_TRANSITION_STEP_IDS_V1.state]?.status === 'succeeded') {
        await verifyChapterTransitionRunV1({ scope, runId: snapshot.run.id })
      }
    } catch (error) {
      updateSnapshot(await failChapterTransitionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_TRANSITION_STEP_IDS_V1.memory,
        code: error instanceof Error ? error.message : 'memory_post_step_failed',
      }))
      setTransitionError(error instanceof Error ? error.message : '章节记忆后处理失败')
    }
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
      }).catch(error => {
        setTransitionError(error instanceof Error ? error.message : '章节后处理启动失败')
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
        <ChapterEditorHeader
          title={chapterDisplay?.title ?? currentChapter.title}
          wordCount={wordCount}
          status={currentChapter.status}
          showContext={showContext}
          canCompare={!!plainText && compareSourceHtml == null}
          saveDisabled={compareSourceHtml != null}
          saving={manualSaving}
          saveError={manualSaveError}
          isSaved={content === savedContent}
          onStatusChange={status => {
            if (currentChapter.id) void updateChapter(currentChapter.id, { status })
          }}
          onToggleContext={() => setShowContext(!showContext)}
          onOpenCompare={() => { void handleOpenComparePolish() }}
          onSave={() => { void handleManualSave() }}
        />

      {showContext && (
        <ChapterContextPreview
          worldContext={worldCtx}
          characterContext={charCtx}
          outlineNode={outlineNode ?? undefined}
          stateCards={stateCards}
          matchedIds={selectiveState.matchedIds}
          allIds={selectiveState.allIds}
          extraIds={extraStateIds}
          stateListExpanded={showStatePreview}
          onToggleStateList={() => setShowStatePreview(!showStatePreview)}
          onToggleStateCard={cardId => {
            const isExtra = extraStateIds.includes(cardId)
            const isMatched = selectiveState.matchedIds.includes(cardId)
            if (isExtra) {
              setExtraStateIds(extraStateIds.filter(id => id !== cardId))
            } else if (!isMatched) {
              setExtraStateIds([...extraStateIds, cardId])
            }
          }}
        />
      )}

      {/* AI 工具栏 */}
      {compareSourceHtml == null && (
        <ChapterEditorToolbar
          isStreaming={ai.isStreaming}
          hasText={!!plainText}
          organizingChapter={organizingChapter}
          hasOrganizationCandidate={Boolean(
            organizationRun
            && Object.values(organizationRun.candidate.domainStatus).some(
              status => status === 'pending' || status === 'failed',
            ),
          )}
          analyzingImpact={analyzingImpact}
          impactInfo={impactInfo}
          hasOutline={!!outlineNodeId}
          showOutlinePreview={showOutlinePreview}
          showReviewPanel={showReviewPanel}
          consistencyAlertCount={consistencyCurrent ? consistencyRun?.candidate.findings.length ?? 0 : 0}
          showNotePanel={showNotePanel}
          customInstruction={customInstruction}
          perspectiveCharacterId={perspectiveCharacterId}
          perspectiveCharacters={perspectiveCharacters}
          onGenerate={() => { void handleGenerate() }}
          onContinue={() => { void handleContinue() }}
          onExpand={handleExpand}
          onPolish={handlePolish}
          onDeAI={() => { void handleDeAI() }}
          onOrganizeChapter={() => { void handleRunChapterOrganization() }}
          onAnalyzeImpact={() => { void handleEditImpact() }}
          onDismissImpact={() => setImpactInfo(null)}
          onToggleOutlinePreview={() => setShowOutlinePreview(!showOutlinePreview)}
          onToggleReviewPanel={() => setShowReviewPanel(!showReviewPanel)}
          onToggleNotePanel={() => setShowNotePanel(!showNotePanel)}
          onCustomInstructionChange={setCustomInstruction}
          onPerspectiveCharacterChange={characterId => {
            if (currentChapter.id) void updateChapter(currentChapter.id, {
              perspectiveCharacterId: characterId,
            })
          }}
        />
      )}
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
          <Suspense fallback={<LazyPanelFallback />}>
            <OutlinePreview outlineNodeId={outlineNodeId} onClose={() => setShowOutlinePreview(false)} />
          </Suspense>
        </div>
      )}

      {/* F: 质量审校面板 */}
      {showReviewPanel && (
        <div className="mb-3">
          <Suspense fallback={<LazyPanelFallback />}>
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
              consistencyRun={consistencyRun}
              consistencyCurrent={consistencyCurrent}
              onConsistencyRun={run => {
                setConsistencyRun(run)
                setConsistencyCurrent(true)
              }}
              onBeforeConsistencyRun={async () => {
                await persistCurrentEditorContent()
              }}
            />
          </Suspense>
        </div>
      )}

      {/* H3: 便签面板 */}
      {showNotePanel && (
        <div className="mb-3">
          <Suspense fallback={<LazyPanelFallback />}>
            <NotePanel projectId={project.id!} chapterId={currentChapter?.id} onClose={() => setShowNotePanel(false)} />
          </Suspense>
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
      <details className="mb-2 rounded-lg border border-border bg-bg-surface/60 px-3 py-2 text-xs">
        <summary className="cursor-pointer text-text-secondary hover:text-text-primary">
          AI 生成高级选项
          {transparentMode && <span className="ml-2 text-accent">透明模式已开启</span>}
        </summary>
        <label className="mt-2 flex cursor-pointer items-start gap-2 border-t border-border pt-2">
          <input
            type="checkbox"
            checked={transparentMode}
            onChange={event => {
              setTransparentMode(event.target.checked)
              setPendingGeneration(null)
            }}
            className="mt-0.5 accent-accent"
          />
          <span>
            <span className="font-medium text-text-secondary">发送前预览最终提示词</span>
            <span className="ml-2 text-[10px] text-text-muted">
              默认关闭；开启后可临时编辑拼接后的真实消息，不写回模板或作品资料。
            </span>
          </span>
        </label>
      </details>

      {contextBudget && (
        <div className="mb-2">
          <ContextBudgetBar budget={contextBudget} compact={ai.isStreaming} />
        </div>
      )}

      {pendingGeneration && (
        <div className="mb-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <PromptPreviewGate
            messages={pendingGeneration.prepared.messages}
            backLabel="取消本次预览"
            onBack={() => setPendingGeneration(null)}
            onConfirm={messages => {
              const pending = pendingGeneration
              setPendingGeneration(null)
              runPreparedChapterGeneration(
                pending.operation,
                pending.category,
                pending.prepared,
                pending.backgroundMemoryIds,
                messages,
              )
            }}
          />
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
      {(transitionRunId != null || transitionError) && (
        <div className={`mb-3 p-3 rounded-lg border text-xs ${transitionError
          ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          : 'bg-sky-500/10 border-sky-500/20 text-sky-300'}`}>
          <div>章节后处理 Run #{transitionRunId ?? '—'} · 检索、状态候选、章节记忆独立记录，可恢复</div>
          {transitionCandidate && transitionCandidate.stateDiffs.length > 0 && (
            <div className="mt-1">状态候选待作者确认：{transitionCandidate.stateDiffs.length} 条</div>
          )}
          {transitionError && <div className="mt-1">{transitionError}</div>}
        </div>
      )}

      <ChapterMemoryPanel
        summary={currentChapter.summary}
        hasText={!!plainText}
        memoryBusy={autoProcessing === 'memory' || memoryAI.isStreaming}
        reconciliation={currentChapter.planReconciliation}
        reconciliationCurrent={planReconciliationCurrent}
        onGenerateMemory={() => { void handleManualMemory() }}
        onConfirmActualProgress={() => { void handleConfirmActualProgress() }}
        onApplyOutlineCandidate={() => { void handleApplyOutlineCandidate() }}
      />

      {/* TipTap 富文本编辑器 / 对照润色模式 */}
      {compareSourceHtml != null ? (
        <Suspense fallback={<LazyPanelFallback />}>
          <ComparePolishPanel
            key={currentChapter.id}
            projectId={project.id!}
            chapterId={currentChapter.id!}
            chapterTitle={chapterDisplay?.title ?? currentChapter.title}
            worldGroupId={chapterWorldGroupId}
            sourceHtml={compareSourceHtml}
            entityReferences={entityReferences}
            onSaved={result => {
              setContent(result.html)
              setPlainText(result.plainText)
              setSavedContent(result.html)
            }}
            onClose={() => setCompareSourceHtml(null)}
          />
        </Suspense>
      ) : (
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-bg-elevated px-8 py-8 shadow-theme-md">
        <RichEditor
          ref={editorRef}
          value={content}
          onChange={(html, plain) => {
            setContent(html)
            setPlainText(plain)
            setManualSaveError('')
          }}
          placeholder="开始写作..."
          minHeight={560}
          className="sf-manuscript-editor border-0 bg-transparent shadow-none"
          entityReferences={entityReferences}
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
      )}

      {/* Phase 24.3: 选中文本浮动工具栏 */}
      {compareSourceHtml == null && <FloatingToolbar
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
      />}

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
        <Suspense fallback={null}>
          <StateDiffModal
            diffs={pendingDiffs}
            chapterTitle={outlineNode?.title || currentChapter.title || ''}
            onConfirm={handleAcceptDiffs}
            onCancel={() => { setPendingDiffs(null); stateAI.reset() }}
            showSkip={autoProcessing !== 'idle'}
          />
        </Suspense>
      )}

      {organizationRun && showOrganization && (
        <Suspense fallback={null}>
          <ChapterOrganizationModal
            run={organizationRun}
            current={organizationCurrent}
            busy={organizingChapter}
            error={organizationError}
            onApply={selection => { void handleApplyChapterOrganization(selection) }}
            onRerun={() => { void handleRunChapterOrganization(true) }}
            onClose={() => setShowOrganization(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
