import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { FileText, ClipboardList, RotateCcw } from 'lucide-react'
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
import { rebuildChapterChunks, ensureChunkEmbeddings, rebuildProjectNarrativeSummaries } from '../../lib/retrieval/retrieval'
import { isEmbeddingReady } from '../../lib/ai/adapters/embedding-adapter'
import { propagateChapterEditStale, buildEditImpactGraphV1, type EditImpactGraphV1 } from '../../lib/consistency/impact-analysis'
import {
  buildImpactRemediationPlanV1,
  type ImpactRemediationPlanV1,
} from '../../lib/consistency/impact-remediation-plan'
import {
  buildImpactHandoffUrlV2,
  buildImpactHandoffV2,
} from '../../lib/consistency/impact-handoff'
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
import { analyzeContextSegments, calculateBudget, estimateTokens, getModelPreset, type ContextBudget } from '../../lib/ai/context-budget'
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
import type { ChatMessage, Project, StateDiffItem, WorkspaceScope } from '../../lib/types'
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
  commitChapterTransitionStateAdoptionV1,
  isChapterTransitionCandidateCurrentV1,
  readLatestChapterTransitionCandidateV1,
  recoverChapterTransitionCandidateV1,
  verifyChapterTransitionRunV1,
  type ChapterTransitionCandidateV1,
} from '../../lib/agent/run/chapter-transition-durable'
import {
  beginChapterPostAdoptionStepV1,
  beginChapterPostAdoptionOrganizationAdoptionV1,
  chapterPostAdoptionChainStateV1,
  commitChapterPostAdoptionOrganizationV1,
  createChapterPostAdoptionDurableRunV1,
  failChapterPostAdoptionStepV1,
  markChapterPostAdoptionOrganizationStaleV1,
  recordChapterPostAdoptionOutputV1,
  rejectChapterPostAdoptionOrganizationAdoptionV1,
  recoverChapterPostAdoptionOrganizationV1,
  recoverChapterPostAdoptionConsistencyV1,
  readChapterPostAdoptionChainStatusV1,
  readLatestChapterPostAdoptionRunV1,
  scheduleChapterPostAdoptionStepsV1,
  succeedChapterPostAdoptionStepV1,
  verifyChapterPostAdoptionRunV1,
  CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1,
  CHAPTER_POST_ADOPTION_STEP_IDS_V1,
  type ChapterPostAdoptionDurableEvidenceV1,
  type ChapterPostAdoptionChainStateV1,
  type ChapterPostAdoptionStepIdV1,
} from '../../lib/agent/run/chapter-post-adoption-durable'
import {
  buildChapterPostAdoptionResumePlanV1,
  isChapterPostAdoptionStepRunnableV1,
} from '../../lib/agent/run/chapter-post-adoption-resume'
import { createContextManifestFromAssemblyV1 } from '../../lib/agent/run/context-manifest'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../../lib/agent/run/event-store'
import { hashChapterText, normalizeChapterText } from '../../lib/ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../../lib/agent/run/hash'
import {
  adoptImpactPatchCandidateV1,
  createImpactPatchCandidateV1,
  readLatestImpactPatchCandidateV1,
  rejectImpactPatchCandidateV1,
  type ImpactPatchCandidateV1,
} from '../../lib/agent/run/impact-patch-durable'
import { executeImpactRemediationV1 } from '../../lib/agent/run/impact-remediation-durable'
import { executeImpactPostCorrectionRemediationV1 } from '../../lib/agent/run/impact-post-correction-remediation-durable'
import {
  executeImpactAuthorReviewV1,
  readCurrentImpactAuthorReviewStateV1,
  readImpactAuthorReviewsV1,
  type ImpactAuthorReviewRecordV1,
  type ImpactReviewDecisionV1,
} from '../../lib/agent/run/impact-review-durable'
import { replanImpactRemediationV1 } from '../../lib/consistency/impact-remediation-replan'
import {
  readCurrentImpactPostCorrectionReplanV1,
  type ImpactPostCorrectionReplanResultV1,
} from '../../lib/agent/run/impact-post-correction-replan-durable'
import {
  adoptImpactOutlineRegenerationCandidateV1,
  generateImpactOutlineRegenerationCandidateV1,
  readCompletedImpactOutlineRegenerationsV1,
  readPendingImpactOutlineRegenerationCandidateV1,
  rejectImpactOutlineRegenerationCandidateV1,
  type ImpactOutlineRegenerationCandidateV1,
  type ImpactOutlineRegenerationCompletionV1,
} from '../../lib/agent/run/impact-outline-regeneration-durable'
import { classifyAgentRunFailureV1 } from '../../lib/agent/run/failure-policy'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import {
  beginProseGenerationStepV1,
  commitProseGenerationAdoptionV1,
  createProseGenerationDurableRunV1,
  failProseGenerationStepV1,
  hashProseGenerationCandidateV1,
  isProseGenerationCandidateCurrentV1,
  markProseGenerationStaleV1,
  persistProseGenerationCandidateV1,
  readLatestProseGenerationCandidateV1,
  recordProseGenerationCandidateV1,
  recordProseGenerationModelOutputV1,
  rejectProseGenerationCandidateV1,
  recoverProseGenerationCandidateV1,
  PROSE_GENERATION_SOURCE_KEYS_V1,
  PROSE_GENERATION_STEP_ID_V1,
  type ProseGenerationCandidateV1,
} from '../../lib/agent/run/prose-generation-durable'
import { runDurableProseSemanticReviewV1 } from '../../lib/agent/run/prose-semantic-durable'
import { AgentTeamBudgetTracker } from '../../lib/agent/team-budget'
import {
  isConsistencyAgentCurrent,
  hashConsistencyAgentCandidateV1,
  persistConsistencyAgentCandidate,
  readLatestConsistencyAgentRun,
  runBackgroundConsistencyAgent,
  toConsistencyAuditResult,
  type ConsistencyAgentRun,
} from '../../lib/agent/consistency-agent'
import {
  buildChapterInformationBoundaryV1,
  buildInformationBoundaryInstructionV1,
  validateProseInformationBoundaryV1,
  type InformationBoundaryManifestV1,
} from '../../lib/agent/information-boundary'

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
  assembled: Awaited<ReturnType<typeof assembleContext>>
  informationBoundary: InformationBoundaryManifestV1
}

interface Props {
  project: Project
  outlineNodeId?: number | null
}

export default function ChapterEditor({ project, outlineNodeId }: Props) {
  const navigate = useNavigate()
  const {
    chapters,
    currentChapter,
    selectChapter,
    getOrCreateByOutlineNode,
    updateChapter,
    refreshChapter,
    loadAll: loadChapters,
  } = useChapterStore()
  const { nodes, updateNode, loadAll: loadOutlineNodes } = useOutlineStore()
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
  const [editorWorkspaceScope, setEditorWorkspaceScope] = useState<WorkspaceScope | null>(null)
  const [showContext, setShowContext] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [impactInfo, setImpactInfo] = useState<string | null>(null)
  const [analyzingImpact, setAnalyzingImpact] = useState(false)
  const [impactGraph, setImpactGraph] = useState<EditImpactGraphV1 | null>(null)
  const [impactRemediationPlan, setImpactRemediationPlan] = useState<ImpactRemediationPlanV1 | null>(null)
  const [impactRemediationBusy, setImpactRemediationBusy] = useState(false)
  const [impactRemediationReceipt, setImpactRemediationReceipt] = useState<string | null>(null)
  const [impactRemediationError, setImpactRemediationError] = useState('')
  const [impactPostCorrectionReplan, setImpactPostCorrectionReplan] = useState<ImpactPostCorrectionReplanResultV1 | null>(null)
  const [impactReviewItemId, setImpactReviewItemId] = useState<string | null>(null)
  const [impactReviewDecision, setImpactReviewDecision] = useState<ImpactReviewDecisionV1>('acknowledged')
  const [impactReviewNote, setImpactReviewNote] = useState('')
  const [impactReviewBusy, setImpactReviewBusy] = useState(false)
  const [impactReviewReceipt, setImpactReviewReceipt] = useState<string | null>(null)
  const [impactReviewError, setImpactReviewError] = useState('')
  const [impactReviewRecords, setImpactReviewRecords] = useState<ImpactAuthorReviewRecordV1[]>([])
  const [impactPatchTargetId, setImpactPatchTargetId] = useState<number | null>(null)
  const [impactPatchSummary, setImpactPatchSummary] = useState('')
  const [impactPatchReason, setImpactPatchReason] = useState('')
  const [impactPatchCandidate, setImpactPatchCandidate] = useState<ImpactPatchCandidateV1 | null>(null)
  const [impactPatchBusy, setImpactPatchBusy] = useState(false)
  const [impactPatchError, setImpactPatchError] = useState('')
  const [impactOutlineRegenerationItemId, setImpactOutlineRegenerationItemId] = useState<string | null>(null)
  const [impactOutlineRegenerationCandidate, setImpactOutlineRegenerationCandidate] = useState<ImpactOutlineRegenerationCandidateV1 | null>(null)
  const [impactOutlineRegenerationCompleted, setImpactOutlineRegenerationCompleted] = useState<ImpactOutlineRegenerationCompletionV1[]>([])
  const [impactOutlineRegenerationBusy, setImpactOutlineRegenerationBusy] = useState(false)
  const [impactOutlineRegenerationReceipt, setImpactOutlineRegenerationReceipt] = useState<string | null>(null)
  const [impactOutlineRegenerationError, setImpactOutlineRegenerationError] = useState('')
  const [pendingDiffs, setPendingDiffs] = useState<StateDiffItem[] | null>(null)
  // A2: 按需召回 — 手动额外勾选/取消的状态卡 ID
  const [extraStateIds, setExtraStateIds] = useState<number[]>([])
  const [showStatePreview, setShowStatePreview] = useState(false)
  const ai = useAIStream(createAISessionKey(
    project.id!,
    'chapter.content',
    currentChapter?.id ?? outlineNodeId ?? 'unselected',
  ))
  const restoreAI = ai.restore
  const stateAI = useAIStream()
  const memoryAI = useAIStream()
  const editorRef = useRef<RichEditorHandle>(null)
  const organizationAbortRef = useRef<AbortController | null>(null)
  const transitionSnapshotRef = useRef<AgentRunSnapshotV1 | null>(null)
  const transitionCandidateRef = useRef<ChapterTransitionCandidateV1 | null>(null)
  const proseCandidateRef = useRef<ProseGenerationCandidateV1 | null>(null)
  const proseSnapshotRef = useRef<AgentRunSnapshotV1 | null>(null)
  const proseSemanticAbortRef = useRef<AbortController | null>(null)
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
  const [proseCandidate, setProseCandidate] = useState<ProseGenerationCandidateV1 | null>(null)
  const [proseGenerationError, setProseGenerationError] = useState('')
  const [proseHarnessStage, setProseHarnessStage] = useState<'idle' | 'reviewing' | 'revising' | 'rereviewing'>('idle')
  const [planReconciliationCurrent, setPlanReconciliationCurrent] = useState(false)
  const [organizationRun, setOrganizationRun] = useState<ChapterOrganizationRun | null>(null)
  const [organizationCurrent, setOrganizationCurrent] = useState(false)
  const [organizingChapter, setOrganizingChapter] = useState(false)
  const [organizationError, setOrganizationError] = useState('')
  const [showOrganization, setShowOrganization] = useState(false)
  const [transitionCandidate, setTransitionCandidate] = useState<ChapterTransitionCandidateV1 | null>(null)
  const [transitionRunId, setTransitionRunId] = useState<number | null>(null)
  const [postAdoptionRunId, setPostAdoptionRunId] = useState<number | null>(null)
  const [postAdoptionChainState, setPostAdoptionChainState] = useState<ChapterPostAdoptionChainStateV1 | null>(null)
  const [transitionError, setTransitionError] = useState('')
  const [consistencyRun, setConsistencyRun] = useState<ConsistencyAgentRun | null>(null)
  const [consistencyCurrent, setConsistencyCurrent] = useState(false)
  const aiConfig = useAIConfigStore(s => s.config)
  const dialog = useDialog()

  const updatePostAdoptionSnapshot = useCallback((snapshot: AgentRunSnapshotV1) => {
    transitionSnapshotRef.current = snapshot
    setPostAdoptionRunId(snapshot.run.id)
    setPostAdoptionChainState(chapterPostAdoptionChainStateV1(snapshot))
  }, [])

  useEffect(() => {
    consistencyRunRef.current = consistencyRun
  }, [consistencyRun])

  useEffect(() => {
    transitionCandidateRef.current = transitionCandidate
  }, [transitionCandidate])

  useEffect(() => {
    proseCandidateRef.current = proseCandidate
  }, [proseCandidate])

  // HARNESS-45/53: recover current impact patch and author review evidence on remount.
  useEffect(() => {
    let active = true
    setImpactGraph(null)
    setImpactRemediationPlan(null)
    setImpactRemediationReceipt(null)
    setImpactRemediationError('')
    setImpactPostCorrectionReplan(null)
    setImpactReviewItemId(null)
    setImpactReviewDecision('acknowledged')
    setImpactReviewNote('')
    setImpactReviewReceipt(null)
    setImpactReviewError('')
    setImpactReviewRecords([])
    setImpactInfo(null)
    setImpactPatchTargetId(null)
    setImpactPatchSummary('')
    setImpactPatchReason('')
    setImpactPatchCandidate(null)
    setImpactPatchError('')
    setImpactOutlineRegenerationItemId(null)
    setImpactOutlineRegenerationCandidate(null)
    setImpactOutlineRegenerationCompleted([])
    setImpactOutlineRegenerationReceipt(null)
    setImpactOutlineRegenerationError('')
    if (!currentChapter?.id) return () => { active = false }
    void (async () => {
      const scope = await resolveScopeLike(project.id!)
      const [candidate, reviewState, postCorrectionState] = await Promise.all([
        readLatestImpactPatchCandidateV1({
          scope,
          sourceChapterId: currentChapter.id!,
        }).catch(error => {
          console.warn('[ImpactPatch] durable candidate 恢复失败:', error)
          return null
        }),
        readCurrentImpactAuthorReviewStateV1({
          scope,
          chapterId: currentChapter.id!,
        }).catch(error => {
          console.warn('[ImpactReview] durable review 恢复失败:', error)
          return null
        }),
        readCurrentImpactPostCorrectionReplanV1({
          scope,
          chapterId: currentChapter.id!,
        }).catch(error => {
          console.warn('[ImpactReplan] 修正后重规划恢复失败:', error)
          return null
        }),
      ])
      if (!active) return
      if (postCorrectionState) {
        const [pendingRegeneration, completedRegenerations, currentReviews] = await Promise.all([
          readPendingImpactOutlineRegenerationCandidateV1({
            scope,
            sourceChapterId: currentChapter.id!,
          }).catch(error => {
            console.warn('[ImpactOutlineRegeneration] durable candidate 恢复失败:', error)
            return null
          }),
          readCompletedImpactOutlineRegenerationsV1({
            scope,
            sourceChapterId: currentChapter.id!,
          }).catch(error => {
            console.warn('[ImpactOutlineRegeneration] terminal receipt 恢复失败:', error)
            return []
          }),
          readImpactAuthorReviewsV1({
            scope,
            plan: postCorrectionState.output.plan,
          }).catch(error => {
            console.warn('[ImpactOutlineRegeneration] 依赖复核恢复失败:', error)
            return []
          }),
        ])
        if (!active) return
        const currentReviewByItem = new Map(currentReviews.map(review => [review.output.itemId, review]))
        const planItemByNode = new Map(postCorrectionState.output.plan.items.map(item => [item.nodeId, item]))
        const pendingRegenerationItems = postCorrectionState.output.plan.items.filter(item => (
          (postCorrectionState.output.remainingItemIds.includes(item.id)
            || postCorrectionState.output.newItemIds.includes(item.id))
          && item.action === 'review-outline'
          && item.recordId !== currentChapter.outlineNodeId
          && !completedRegenerations.some(record => record.candidate.item.id === item.id)
        ))
        const dependenciesReady = (item: typeof pendingRegenerationItems[number]) => (
          item.dependencyNodeIds.every(nodeId => {
            const dependency = planItemByNode.get(nodeId)
            return dependency?.mode === 'author-confirmed'
              && currentReviewByItem.get(dependency.id)?.output.decision === 'acknowledged'
          })
        )
        const eligibleRegenerationItems = pendingRegenerationItems.filter(dependenciesReady)
        const blockedRegenerationItem = pendingRegenerationItems.find(item => !dependenciesReady(item))
        const reviewTarget = blockedRegenerationItem ?? eligibleRegenerationItems[0]
        const firstReviewDependency = postCorrectionState.output.plan.items.find(item => (
          reviewTarget?.dependencyNodeIds.includes(item.nodeId) && item.mode === 'author-confirmed'
        ))
        const selectedReview = currentReviewByItem.get(firstReviewDependency?.id ?? '')
        setImpactPostCorrectionReplan(postCorrectionState)
        setImpactGraph(postCorrectionState.output.graph)
        setImpactRemediationPlan(postCorrectionState.output.plan)
        setImpactRemediationReceipt(postCorrectionState.receiptHash)
        setImpactOutlineRegenerationCandidate(pendingRegeneration?.candidate ?? null)
        setImpactOutlineRegenerationCompleted(completedRegenerations)
        setImpactReviewRecords(currentReviews)
        setImpactReviewItemId(firstReviewDependency?.id ?? null)
        setImpactReviewDecision(selectedReview?.output.decision ?? 'acknowledged')
        setImpactReviewNote(selectedReview?.output.note ?? '')
        setImpactReviewReceipt(selectedReview?.receiptHash ?? null)
        setImpactOutlineRegenerationItemId(
          pendingRegeneration?.candidate.item.id
          ?? eligibleRegenerationItems[0]?.id
          ?? null,
        )
        setImpactOutlineRegenerationReceipt(completedRegenerations[0]?.receiptHash ?? null)
        setImpactInfo(
          pendingRegeneration
            ? '已恢复一条 H57 生成式后续章纲候选；确认前不会修改正式摘要。'
            : blockedRegenerationItem && firstReviewDependency
              ? `H57 生成式目标仍等待直接依赖复核：${firstReviewDependency.reason}`
            : `已恢复人工修正后的当前计划：已解决 ${postCorrectionState.output.resolvedItemIds.length} 项、仍需处理 ${postCorrectionState.output.remainingItemIds.length} 项、新增 ${postCorrectionState.output.newItemIds.length} 项。`,
        )
      } else if (reviewState) {
        const selectedReview = reviewState.reviews.find(record => record.output.decision === 'needs-manual-action')
          ?? reviewState.reviews[0]
        setImpactGraph(reviewState.graph)
        setImpactRemediationPlan(reviewState.plan)
        setImpactReviewRecords(reviewState.reviews)
        setImpactReviewItemId(selectedReview.output.itemId)
        setImpactReviewDecision(selectedReview.output.decision)
        setImpactReviewNote(selectedReview.output.note)
        setImpactReviewReceipt(selectedReview.receiptHash)
        setImpactInfo(`已从 Run 账本恢复 ${reviewState.reviews.length} 项当前作者复核；正式数据未改变。`)
      }
      if (candidate) {
        setImpactPatchCandidate(candidate)
        setImpactPatchTargetId(candidate.proposal.recordId)
        setImpactPatchSummary(candidate.proposal.fields.summary)
        setImpactPatchReason(candidate.proposal.reason)
        setImpactInfo('发现一条待作者确认的影响修订候选；确认前不会改动正式大纲。')
      }
    })().catch(error => {
      if (active) console.warn('[ImpactRecovery] 影响状态恢复失败:', error)
    })
    return () => { active = false }
  }, [currentChapter?.id, currentChapter?.outlineNodeId, project.id])

  // H7: durable prose candidates survive editor unmounts and browser refreshes.
  // Only restore candidates whose source chapter hash is still current; stale
  // output remains in the event ledger for audit but is never shown as adoptable.
  useEffect(() => {
    let active = true
    const chapterId = currentChapter?.id
    if (!chapterId) {
      setProseCandidate(null)
      proseCandidateRef.current = null
      return () => { active = false }
    }
    setProseCandidate(null)
    proseCandidateRef.current = null
    void (async () => {
      const scope = await resolveScopeLike(project.id!)
      const candidate = await readLatestProseGenerationCandidateV1({
        scope,
        chapterId,
      })
      if (!active || !candidate) return
      const recovered = await recoverProseGenerationCandidateV1({ scope, candidate })
      if (!active || !recovered || recovered.projection.state !== 'awaiting_confirmation') return
      setProseCandidate(candidate)
      proseCandidateRef.current = candidate
      restoreAI({ output: candidate.outputText, operation: candidate.operation })
      proseSnapshotRef.current = recovered
    })().catch(error => {
      if (active) console.warn('[ProseGeneration] durable candidate 恢复失败:', error)
    })
    return () => { active = false }
  }, [currentChapter?.id, project.id, restoreAI])

  useEffect(() => () => {
    proseSemanticAbortRef.current?.abort()
    proseSemanticAbortRef.current = null
  }, [currentChapter?.id])

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
    setPostAdoptionRunId(null)
    setPostAdoptionChainState(null)
    if (!currentChapter?.id) return () => { active = false }
    void (async () => {
      const scope = await resolveScopeLike(project.id!)
      const run = await readLatestChapterOrganizationRun({
        projectId: project.id!,
        chapterId: currentChapter.id!,
      })
      let postAdoptionSnapshot: AgentRunSnapshotV1 | null = null
      const linkedPostAdoptionSnapshot = await readLatestChapterPostAdoptionRunV1({
        scope,
        chapterId: currentChapter.id!,
      })
      const linkedParentRunId = linkedPostAdoptionSnapshot?.contract.lineage?.parent.runId
      const linkedChainState = linkedParentRunId == null
        ? null
        : (await readChapterPostAdoptionChainStatusV1({
            scope,
            parentRunId: linkedParentRunId,
          })).state
      if (run?.candidate.durable?.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization) {
        try {
          postAdoptionSnapshot = await recoverChapterPostAdoptionOrganizationV1({
            scope,
            candidate: run.candidate as ChapterOrganizationRun['candidate'] & {
              durable: ChapterPostAdoptionDurableEvidenceV1
            },
          })
        } catch (error) {
          console.warn('[ChapterPostAdoption] 恢复 durable 候选证据失败:', error)
        }
      } else if (run?.candidate.durable) {
        try {
          await recoverChapterOrganizationCandidateV1({
            scope,
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
      if (linkedPostAdoptionSnapshot) {
        transitionSnapshotRef.current = linkedPostAdoptionSnapshot
        setPostAdoptionRunId(linkedPostAdoptionSnapshot.run.id)
        setPostAdoptionChainState(linkedChainState ?? chapterPostAdoptionChainStateV1(linkedPostAdoptionSnapshot))
      } else if (postAdoptionSnapshot) {
        transitionSnapshotRef.current = postAdoptionSnapshot
        setPostAdoptionRunId(postAdoptionSnapshot.run.id)
        setPostAdoptionChainState(chapterPostAdoptionChainStateV1(postAdoptionSnapshot))
      }
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
      if (run?.candidate.durable?.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency) {
        const scope = await resolveScopeLike(project.id!)
        const recovered = await recoverChapterPostAdoptionConsistencyV1({
          scope,
          candidate: run.candidate,
        })
        if (recovered) {
          let currentSnapshot = recovered
          if (recovered.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]?.status === 'succeeded') {
            try {
              currentSnapshot = (await verifyChapterPostAdoptionRunV1({
                scope,
                runId: recovered.run.id,
              })).snapshot
            } catch {
              // Earlier post-adoption steps may still need recovery or author confirmation.
            }
          }
          transitionSnapshotRef.current = currentSnapshot
          setPostAdoptionRunId(currentSnapshot.run.id)
          setPostAdoptionChainState(chapterPostAdoptionChainStateV1(currentSnapshot))
        }
      }
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

  useEffect(() => {
    let cancelled = false
    void resolveScopeLike(project.id!).then(scope => {
      if (!cancelled) setEditorWorkspaceScope(scope)
    }).catch(() => {
      if (!cancelled) setEditorWorkspaceScope(null)
    })
    return () => { cancelled = true }
  }, [project.id])

  const impactPatchTargets = useMemo(() => {
    if (!impactGraph) return []
    const seen = new Set<number>()
    return impactGraph.nodes
      .filter(node => node.kind === 'outline' && node.recordId != null && node.recordId !== outlineNode?.id)
      .flatMap(node => {
        const id = node.recordId!
        if (seen.has(id)) return []
        seen.add(id)
        const target = nodes.find(item => item.id === id)
        return target ? [{ id, title: target.title, summary: target.summary ?? '' }] : []
      })
  }, [impactGraph, nodes, outlineNode?.id])

  const impactOutlineRegenerationTargets = useMemo(() => {
    const replan = impactPostCorrectionReplan
    if (!replan) return []
    const activeIds = new Set([
      ...replan.output.remainingItemIds,
      ...replan.output.newItemIds,
    ])
    const completedIds = new Set(impactOutlineRegenerationCompleted.map(record => record.candidate.item.id))
    const reviewByItem = new Map(impactReviewRecords.map(review => [review.output.itemId, review]))
    const itemByNode = new Map(replan.output.plan.items.map(item => [item.nodeId, item]))
    return replan.output.plan.items.flatMap(item => {
      if (!activeIds.has(item.id) || completedIds.has(item.id)
        || item.action !== 'review-outline' || item.recordId == null
        || item.recordId === outlineNode?.id) return []
      const dependenciesReady = item.dependencyNodeIds.every(nodeId => {
        const dependency = itemByNode.get(nodeId)
        return dependency?.mode === 'author-confirmed'
          && reviewByItem.get(dependency.id)?.output.decision === 'acknowledged'
      })
      if (!dependenciesReady) return []
      const target = nodes.find(node => node.id === item.recordId && node.type === 'chapter')
      return target ? [{ itemId: item.id, id: target.id!, title: target.title, summary: target.summary ?? '' }] : []
    })
  }, [impactOutlineRegenerationCompleted, impactPostCorrectionReplan, impactReviewRecords, nodes, outlineNode?.id])

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
          if (current) return
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
      // 角色也由同一次 assembleContext 装配，随后从主文本中拆出一次注入；
      // 这样 durable Context Manifest 能覆盖真正发送给模型的全部注册表来源。
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
        'characters',
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
      'characters',
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
      assembled,
      characterContext: segmentFor('characters'),
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
    informationBoundary: InformationBoundaryManifestV1,
  ) => createChapterGenerationNode({
    operation,
    category,
    projectId: project.id!,
    chapterIdentity: currentChapter?.id ?? outlineNodeId ?? 'unselected',
    ai,
    gate: output => {
      const issues = validateProseInformationBoundaryV1(output, informationBoundary)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
  })

  const runDurableChapterGeneration = async (input: {
    operation: ChapterGenerationOperation
    category: ChapterGenerationCategory
    node: ReturnType<typeof createChapterGenerationNode>
    prepared: PreparedGenerationNode
    messages?: ChatMessage[]
    assembled?: Awaited<ReturnType<typeof assembleContext>>
    informationBoundary: InformationBoundaryManifestV1
  }): Promise<void> => {
    if (!currentChapter?.id || !input.assembled) {
      throw new Error('正文生成缺少章节或受控上下文快照。')
    }
    const chapterId = currentChapter.id
    const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
    const scope = await resolveScopeLike(project.id!)
    const sourceChapter = await db.chapters.get(chapterId)
    if (!sourceChapter) throw new Error('正文生成开始前找不到章节。')
    const sourceTextHash = await hashChapterText(sourceChapter.content ?? '')
    const actualMessages = input.messages ?? input.prepared.messages
    proseSemanticAbortRef.current?.abort()
    proseSemanticAbortRef.current = null
    setProseHarnessStage('idle')
    const budget = new AgentTeamBudgetTracker(
      useAIConfigStore.getState().agentTeamBudgetProfile,
    )
    const generationReservation = budget.reserveCall({
      label: input.operation === 'continue' ? '正文续写' : '正文生成',
      messages: actualMessages,
      maxOutputTokens: 16_000,
    })
    let generationSettled = false

    const previousCandidate = proseCandidateRef.current
    if (previousCandidate && await isProseGenerationCandidateCurrentV1(previousCandidate)) {
      await markProseGenerationStaleV1({
        scope,
        runId: previousCandidate.durable.runId,
        reason: '作者启动了新的正文生成；旧候选已被替代。',
      })
    }
    setProseCandidate(null)
    proseCandidateRef.current = null

    let snapshot = await createProseGenerationDurableRunV1({
      scope,
      worldGroupId: chapterWorldGroupId ?? null,
      chapterId,
      operation: input.operation,
      semanticReview: true,
    })
    const contextManifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: PROSE_GENERATION_STEP_ID_V1,
      attempt: 1,
      projectId: project.id!,
      worldGroupId: chapterWorldGroupId ?? null,
      declaredSourceKeys: PROSE_GENERATION_SOURCE_KEYS_V1,
      assembled: input.assembled,
      boundary: { chapterId, outlineNodeId: sourceChapter.outlineNodeId },
      readerVersion: 'chapter-prose-generation-context-v1',
    })
    snapshot = await beginProseGenerationStepV1({
      scope,
      snapshot,
      contextManifest,
      binding: {
        operation: input.operation,
        sourceTextHash,
        promptHash: await hashCanonicalValue(actualMessages),
        informationBoundaryHash: input.informationBoundary.manifestHash,
      },
      budgetReservationTokens: generationReservation.estimatedInputTokens
        + generationReservation.reservedOutputTokens,
    })
    proseSnapshotRef.current = snapshot

    let traceError: unknown = null
    let persistedCandidate: ProseGenerationCandidateV1 | null = null
    let result
    try {
      result = await runGenerationNode(input.node, input.prepared, {
        messages: input.messages,
        deferStepSucceeded: true,
        shadowTrace: {
        beforeModel: async () => {},
        modelResponded: async output => {
          budget.settleCall(generationReservation, output)
          generationSettled = true
          snapshot = await recordProseGenerationModelOutputV1({
            scope,
            snapshot,
            output: String(output ?? ''),
            usedTokens: generationReservation.estimatedInputTokens + estimateTokens(String(output ?? '')),
          })
          proseSnapshotRef.current = snapshot
        },
        candidateReady: async output => {
          const originalOutputText = String(output ?? '')
          if (!originalOutputText.trim()) throw new Error('模型没有返回可采纳的正文候选。')
          const generationConfig = resolveRequestConfig(aiConfig, {
            category: input.category,
            projectId: project.id!,
          }).config
          const reviewMeta = {
            category: 'review.consistency.deep',
            projectId: project.id!,
            configOverrides: { maxTokens: 3_000 },
            contextOverflowPolicy: 'reject' as const,
          }
          const reviewConfig = resolveRequestConfig(aiConfig, reviewMeta).config
          const semanticController = new AbortController()
          proseSemanticAbortRef.current = semanticController
          let cycle
          try {
            const semanticResult = await runDurableProseSemanticReviewV1({
              scope,
              snapshot,
              projectId: project.id!,
              worldGroupId: chapterWorldGroupId ?? null,
              chapterId,
              outlineNodeId: sourceChapter.outlineNodeId,
              chapterTitle,
              originalText: originalOutputText,
              generationMessages: actualMessages,
              generationAssembled: input.assembled!,
              informationBoundary: input.informationBoundary,
              generationProvider: generationConfig.provider,
              generationModel: generationConfig.model,
              reviewerProvider: reviewConfig.provider,
              reviewerModel: reviewConfig.model,
              budget,
              review: messages => chat(messages, aiConfig, {
                category: 'review.consistency.deep',
                projectId: project.id!,
                configOverrides: { maxTokens: 3_000 },
                contextOverflowPolicy: 'reject',
              }, semanticController.signal),
              revise: messages => chat(messages, aiConfig, {
                category: input.category,
                projectId: project.id!,
                configOverrides: { maxTokens: 16_000 },
                contextOverflowPolicy: 'reject',
              }, semanticController.signal),
              onStage: setProseHarnessStage,
              onSnapshot: nextSnapshot => {
                snapshot = nextSnapshot
                proseSnapshotRef.current = nextSnapshot
              },
            })
            snapshot = semanticResult.snapshot
            cycle = semanticResult.cycle
            proseSnapshotRef.current = snapshot
          } finally {
            if (proseSemanticAbortRef.current === semanticController) {
              proseSemanticAbortRef.current = null
            }
            setProseHarnessStage('idle')
          }
          if (cycle.status !== 'passed') {
            const reviewIssues = cycle.finalReview.issues
              .filter(issue => issue.severity === 'blocking')
              .map(issue => `${issue.code}: ${issue.reason}`)
            const hardIssues = cycle.deterministicIssues.map(issue => `${issue.code}: ${issue.message}`)
            const message = [...hardIssues, ...reviewIssues].join('；') || '语义评审未签发通过结论。'
            setProseGenerationError(message)
            throw new Error(message)
          }
          const outputText = cycle.outputText
          const baseCandidate = {
            version: 1 as const,
            type: 'prose-generation-candidate' as const,
            projectId: project.id!,
            chapterId,
            chapterTitle,
            worldGroupId: chapterWorldGroupId ?? null,
            operation: input.operation,
            sourceTextHash,
            outputText,
            outputTextHash: await hashCanonicalValue(outputText),
            expectedContentHash: await hashChapterText(
              input.operation === 'continue'
                ? [normalizeChapterText(sourceChapter.content ?? ''), normalizeChapterText(outputText)]
                    .filter(Boolean)
                    .join('\n')
                : outputText,
            ),
            informationBoundaryHash: input.informationBoundary.manifestHash,
            perspectiveCharacterId,
            perspectiveFromChapter: true,
            semanticReview: {
              version: 1 as const,
              initial: cycle.initialReview,
              final: cycle.finalReview,
              ...(cycle.revision ? { revision: cycle.revision } : {}),
              budget: cycle.budget,
            },
            createdAt: Date.now(),
          }
          const candidateHash = await hashProseGenerationCandidateV1(baseCandidate)
          const candidate: ProseGenerationCandidateV1 = {
            ...baseCandidate,
            durable: {
              runId: snapshot.run.id,
              stepId: PROSE_GENERATION_STEP_ID_V1,
              attempt: 1,
              contextManifestHash: contextManifest.manifestHash,
              candidateHash,
            },
          }
          await persistProseGenerationCandidateV1({ scope, candidate })
          snapshot = await recordProseGenerationCandidateV1({
            scope,
            snapshot,
            candidate,
          })
          proseSnapshotRef.current = snapshot
          persistedCandidate = candidate
          setProseCandidate(candidate)
          proseCandidateRef.current = candidate
          restoreAI({ output: outputText, operation: input.operation })
        },
        stepSucceeded: async () => {},
        stepFailed: async failure => {
          snapshot = await failProseGenerationStepV1({
            scope,
            snapshot,
            code: failure.error instanceof Error ? failure.error.message : `${failure.phase}_failed`,
            retryable: true,
          })
          proseSnapshotRef.current = snapshot
        },
        onTraceError: error => { traceError = error },
        },
      })
    } catch (error) {
      if (!generationSettled) budget.settleFailedCall(generationReservation)
      throw error
    }
    if (result.gate?.status === 'blocked') {
      setProseGenerationError(result.gate.issues.map(issue => issue.message).join('；'))
      return
    }
    if (traceError || !persistedCandidate) {
      snapshot = await failProseGenerationStepV1({
        scope,
        snapshot,
        code: traceError instanceof Error ? traceError.message : 'prose_candidate_not_persisted',
        retryable: true,
      })
      proseSnapshotRef.current = snapshot
      setProseGenerationError(
        traceError instanceof Error ? traceError.message : '正文候选没有进入 durable ledger。',
      )
      throw traceError instanceof Error ? traceError : new Error('正文候选没有进入 durable ledger。')
    }
  }

  const runPreparedChapterGeneration = (
    operation: ChapterGenerationOperation,
    category: ChapterGenerationCategory,
    prepared: PreparedGenerationNode,
    backgroundMemoryIds: number[],
    messages?: ChatMessage[],
    assembled?: Awaited<ReturnType<typeof assembleContext>>,
    informationBoundary?: InformationBoundaryManifestV1,
  ) => {
    if (!informationBoundary) {
      setProseGenerationError('正文生成缺少信息边界快照，已阻止模型调用。')
      return
    }
    ai.setOperation(operation)
    const node = chapterGenerationNode(operation, category, informationBoundary)
    void runDurableChapterGeneration({
      operation,
      category,
      node,
      prepared,
      messages,
      assembled,
      informationBoundary,
    }).catch(error => {
      console.error('[ChapterEditor] 生成节点执行失败:', error)
    })
    scheduleRecentMemoryRebuild(backgroundMemoryIds)
  }

  const prepareOrRunChapterGeneration = (
    operation: ChapterGenerationOperation,
    category: ChapterGenerationCategory,
    messages: ChatMessage[],
    backgroundMemoryIds: number[],
    assembled: Awaited<ReturnType<typeof assembleContext>>,
    informationBoundary: InformationBoundaryManifestV1,
  ) => {
    const node = chapterGenerationNode(operation, category, informationBoundary)
    const prepared = prepareGenerationNode(node, messages)
    if (transparentMode) {
      ai.setOperation(operation)
      setPendingGeneration({
        operation,
        category,
        prepared,
        backgroundMemoryIds,
        assembled,
        informationBoundary,
      })
      return
    }
    setPendingGeneration(null)
    runPreparedChapterGeneration(
      operation,
      category,
      prepared,
      backgroundMemoryIds,
      undefined,
      assembled,
      informationBoundary,
    )
  }

  const handleGenerate = async () => {
    if (!outlineNode) return
    setProseGenerationError('')
    await persistCurrentEditorContent()
    const backgroundMemoryIds = await prepareContinuityBeforeGeneration()
    const {
      text: fullCtx,
      segments: assembledSegments,
      assembled,
      characterContext,
      worldRulesContext,
      continuity,
      continuityBudgetTokens,
    } = await buildFullWorldCtx('write')
    const informationBoundary = await buildChapterInformationBoundaryV1({
      scope: await resolveScopeLike(project.id!),
      chapterId: currentChapter?.id ?? null,
      outlineNodeId: outlineNode.id!,
      worldGroupId: chapterWorldGroupId ?? null,
      perspectiveCharacterId,
    })
    const messages = buildChapterContentPrompt(
      outlineNode.title,
      outlineNode.summary,
      fullCtx,
      characterContext,
      continuity.previousTail,
      worldRulesContext,
      [buildInformationBoundaryInstructionV1(informationBoundary), customInstruction.trim()]
        .filter(Boolean)
        .join('\n'),
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
      assembled,
      informationBoundary,
    )
  }

  const handleContinue = async () => {
    if (!plainText || !outlineNode) return
    setProseGenerationError('')
    await persistCurrentEditorContent()
    const backgroundMemoryIds = await prepareContinuityBeforeGeneration()
    const {
      text: fullCtx,
      assembled,
      characterContext,
      continuity,
      continuityBudgetTokens,
    } = await buildFullWorldCtx('write')
    const informationBoundary = await buildChapterInformationBoundaryV1({
      scope: await resolveScopeLike(project.id!),
      chapterId: currentChapter?.id ?? null,
      outlineNodeId: outlineNode.id!,
      worldGroupId: chapterWorldGroupId ?? null,
      perspectiveCharacterId,
    })
    const ctxWithChars = characterContext ? `${fullCtx}\n\n【角色设定】\n${characterContext}` : fullCtx
    const messages = buildContinuePrompt(
      plainText,
      outlineNode.summary,
      ctxWithChars,
      [buildInformationBoundaryInstructionV1(informationBoundary), customInstruction.trim()]
        .filter(Boolean)
        .join('\n'),
      { continuity, continuityBudgetTokens },
    )
    prepareOrRunChapterGeneration(
      'continue',
      'chapter.continue',
      messages,
      backgroundMemoryIds,
      assembled,
      informationBoundary,
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
    let postAdoptionSnapshot: AgentRunSnapshotV1 | null = null
    const durableCandidate = organizationRun.candidate.durable
    try {
      if (durableCandidate?.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization) {
        const workspaceScope = await resolveScopeLike(project.id!)
        postAdoptionSnapshot = await beginChapterPostAdoptionOrganizationAdoptionV1({
          scope: workspaceScope,
          runId: durableCandidate.runId,
          candidateHash: durableCandidate.candidateHash,
        })
        updatePostAdoptionSnapshot(postAdoptionSnapshot)
      }
      const result = await adoptChapterOrganizationSelection({ run: organizationRun, selection })
      setOrganizationRun(result.run)
      setOrganizationCurrent(true)
      const failed = Object.entries(result.run.candidate.domainErrors)
      if (failed.length) {
        setOrganizationError(failed.map(([domain, message]) => `${domain}: ${message}`).join('；'))
        if (postAdoptionSnapshot && durableCandidate) {
          const rejected = await rejectChapterPostAdoptionOrganizationAdoptionV1({
            scope: await resolveScopeLike(project.id!),
            snapshot: postAdoptionSnapshot,
            candidateHash: durableCandidate.candidateHash,
          })
          updatePostAdoptionSnapshot(rejected)
        }
      } else if (result.run.candidate.durable) {
        const workspaceScope = await resolveScopeLike(project.id!)
        if (result.run.candidate.durable.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization) {
          const snapshot = await commitChapterPostAdoptionOrganizationV1({
            scope: workspaceScope,
            runId: result.run.candidate.durable.runId,
            candidate: result.run.candidate as ChapterOrganizationRun['candidate'] & {
              durable: ChapterPostAdoptionDurableEvidenceV1
            },
            written: result.written,
          })
          updatePostAdoptionSnapshot(snapshot)
          try {
            const verified = await verifyChapterPostAdoptionRunV1({
              scope: workspaceScope,
              runId: snapshot.run.id,
            })
            updatePostAdoptionSnapshot(verified.snapshot)
          } catch (verificationError) {
            // 其它后处理步骤可能仍在运行；终态验证会在最后一步完成后重试。
            console.info('[ChapterPostAdoption] 六域采纳后暂不能签发终态回执:', verificationError)
            try {
              updatePostAdoptionSnapshot(await readAgentRunV1(workspaceScope, snapshot.run.id))
            } catch {
              // Keep the verification error when a refresh window prevents a re-read.
            }
          }
        } else {
          await commitChapterOrganizationDurableAdoptionV1({
            scope: workspaceScope,
            runId: result.run.candidate.durable.runId,
            candidate: result.run.candidate,
            written: result.written,
          })
        }
      }
    } catch (error) {
      setOrganizationError(error instanceof Error ? error.message : '写入整理结果失败')
      if (postAdoptionSnapshot && durableCandidate && await isChapterOrganizationCurrent(organizationRun.candidate)) {
        try {
          const rejected = await rejectChapterPostAdoptionOrganizationAdoptionV1({
            scope: await resolveScopeLike(project.id!),
            snapshot: postAdoptionSnapshot,
            candidateHash: durableCandidate.candidateHash,
            code: 'chapter_organization_partial_adoption',
          })
          updatePostAdoptionSnapshot(rejected)
        } catch (traceError) {
          console.warn('[ChapterPostAdoption] 部分采纳失败证据写入失败:', traceError)
        }
      }
      if (organizationRun) {
        const current = await isChapterOrganizationCurrent(organizationRun.candidate)
        setOrganizationCurrent(current)
        if (!current && organizationRun.candidate.durable) {
          try {
            const staleScope = await resolveScopeLike(project.id!)
            if (organizationRun.candidate.durable.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization) {
              await markChapterPostAdoptionOrganizationStaleV1({
                scope: staleScope,
                runId: organizationRun.candidate.durable.runId,
                candidateHash: organizationRun.candidate.durable.candidateHash,
                reason: '正文已变化；作者确认前的六域交接候选已失效。',
              })
            } else {
              await markChapterOrganizationStaleV1({
                scope: staleScope,
                runId: organizationRun.candidate.durable.runId,
                reason: '正文已变化；作者确认前的整理候选已失效。',
              })
            }
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
      const graph = await buildEditImpactGraphV1(project.id, currentChapter.id)
      const remediationPlan = await buildImpactRemediationPlanV1(graph)
      const impactScope = await resolveScopeLike(project.id)
      const reviewRecords = await readImpactAuthorReviewsV1({ scope: impactScope, plan: remediationPlan })
      setImpactGraph(graph)
      setImpactRemediationPlan(remediationPlan)
      setImpactPostCorrectionReplan(null)
      setImpactRemediationReceipt(null)
      setImpactRemediationError('')
      const firstAuthorItem = remediationPlan.items.find(item => item.mode === 'author-confirmed')
      const firstReviewRecord = reviewRecords.find(record => record.output.itemId === firstAuthorItem?.id)
      setImpactReviewItemId(firstAuthorItem?.id ?? null)
      setImpactReviewDecision(firstReviewRecord?.output.decision ?? 'acknowledged')
      setImpactReviewNote(firstReviewRecord?.output.note ?? '')
      setImpactReviewReceipt(firstReviewRecord?.receiptHash ?? null)
      setImpactReviewError('')
      setImpactReviewRecords(reviewRecords)
      setImpactPatchCandidate(null)
      setImpactPatchError('')
      setImpactPatchSummary('')
      setImpactPatchReason('')
      setImpactOutlineRegenerationItemId(null)
      setImpactOutlineRegenerationCandidate(null)
      setImpactOutlineRegenerationCompleted([])
      setImpactOutlineRegenerationReceipt(null)
      setImpactOutlineRegenerationError('')
      const firstTarget = graph.nodes.find(node => (
        node.kind === 'outline'
        && node.recordId != null
        && node.recordId !== currentChapter.outlineNodeId
      ))
      setImpactPatchTargetId(firstTarget?.recordId ?? null)
      const parts = [
        `影响图已生成：${graph.nodes.length} 个节点、${graph.edges.length} 条边`,
        `源自本章事实 ${graph.nodes.filter(node => node.kind === 'fact').length} 条`,
        demotedFacts > 0 ? `其中 ${demotedFacts} 条证据已失效→标记 stale 待复核` : '证据均仍成立',
        `建议复核后续 ${graph.downstreamChapterIds.length} 章、${graph.nodes.filter(node => node.kind === 'summary').length} 个摘要节点`,
        `治理计划 ${remediationPlan.counts.deterministic} 项可确定性重建、${remediationPlan.counts.authorConfirmed} 项须作者确认`,
        `证据指纹 ${graph.graphHash.slice(0, 12)}`,
      ]
      setImpactInfo(parts.join('；'))
    } catch (err) {
      console.error('[EditImpact] 失败:', err)
      setImpactInfo('影响分析失败，请重试')
    } finally {
      setAnalyzingImpact(false)
    }
  }

  const handleDismissImpact = () => {
    if (impactPatchCandidate || impactOutlineRegenerationCandidate) {
      if (impactPatchCandidate) setImpactPatchError('请先确认或放弃当前影响修订候选。')
      if (impactOutlineRegenerationCandidate) setImpactOutlineRegenerationError('请先确认或放弃当前生成式重建候选。')
      return
    }
    setImpactInfo(null)
    setImpactGraph(null)
    setImpactRemediationPlan(null)
    setImpactPostCorrectionReplan(null)
    setImpactRemediationReceipt(null)
    setImpactRemediationError('')
    setImpactReviewItemId(null)
    setImpactReviewDecision('acknowledged')
    setImpactReviewNote('')
    setImpactReviewReceipt(null)
    setImpactReviewError('')
    setImpactReviewRecords([])
    setImpactPatchTargetId(null)
    setImpactPatchSummary('')
    setImpactPatchReason('')
    setImpactPatchError('')
    setImpactOutlineRegenerationItemId(null)
    setImpactOutlineRegenerationCandidate(null)
    setImpactOutlineRegenerationCompleted([])
    setImpactOutlineRegenerationReceipt(null)
    setImpactOutlineRegenerationError('')
  }

  const handleCreateImpactPatch = async () => {
    if (!currentChapter?.id || !impactPatchTargetId || !impactPatchSummary.trim() || !impactPatchReason.trim()) return
    setImpactPatchBusy(true)
    setImpactPatchError('')
    try {
      const scope = await resolveScopeLike(project.id!)
      const created = await createImpactPatchCandidateV1({
        scope,
        worldGroupId: chapterWorldGroupId ?? null,
        sourceChapterId: currentChapter.id,
        proposal: {
          target: 'outlineNodes',
          recordId: impactPatchTargetId,
          fields: { summary: impactPatchSummary.trim() },
          reason: impactPatchReason.trim(),
          evidenceRefs: [`chapter:${currentChapter.id}`, `graph:${impactGraph?.graphHash ?? 'unknown'}`],
        },
      })
      setImpactPatchCandidate(created.candidate)
      setImpactInfo('影响修订候选已保存；请确认后才会写入后续大纲摘要。')
    } catch (error) {
      setImpactPatchError(error instanceof Error ? error.message : '影响修订候选创建失败')
    } finally {
      setImpactPatchBusy(false)
    }
  }

  const handleGenerateImpactOutlineRegeneration = async () => {
    const expectedReplan = impactPostCorrectionReplan
    const itemId = impactOutlineRegenerationItemId
    if (!expectedReplan || !itemId || impactOutlineRegenerationCandidate || impactPatchCandidate) return
    setImpactOutlineRegenerationBusy(true)
    setImpactOutlineRegenerationError('')
    try {
      const result = await generateImpactOutlineRegenerationCandidateV1({
        scope: await resolveScopeLike(project.id!),
        expectedReplan,
        itemId,
        aiConfig,
      })
      setImpactOutlineRegenerationCandidate(result.candidate)
      setImpactOutlineRegenerationReceipt(null)
      setImpactInfo('H57 生成式后续章纲候选已持久化；作者确认前正式摘要保持不变。')
    } catch (error) {
      setImpactOutlineRegenerationError(error instanceof Error ? error.message : '生成式后续章纲重建失败')
    } finally {
      setImpactOutlineRegenerationBusy(false)
    }
  }

  const handleConfirmImpactOutlineRegeneration = async () => {
    const candidate = impactOutlineRegenerationCandidate
    if (!candidate) return
    setImpactOutlineRegenerationBusy(true)
    setImpactOutlineRegenerationError('')
    try {
      const result = await adoptImpactOutlineRegenerationCandidateV1({
        scope: await resolveScopeLike(project.id!),
        runId: candidate.durableRunId,
      })
      await loadOutlineNodes(project.id!)
      setImpactOutlineRegenerationCandidate(null)
      setImpactOutlineRegenerationCompleted(previous => [
        result,
        ...previous.filter(record => record.candidate.item.id !== result.candidate.item.id),
      ])
      setImpactOutlineRegenerationReceipt(result.receiptHash)
      setImpactOutlineRegenerationItemId(null)
      setImpactInfo(`后续章纲摘要已由作者确认写入；终态回执 ${result.receiptHash.slice(0, 12)}。`)
    } catch (error) {
      setImpactOutlineRegenerationError(error instanceof Error ? error.message : '生成式后续章纲采纳失败')
    } finally {
      setImpactOutlineRegenerationBusy(false)
    }
  }

  const handleRejectImpactOutlineRegeneration = async () => {
    const candidate = impactOutlineRegenerationCandidate
    if (!candidate) return
    setImpactOutlineRegenerationBusy(true)
    setImpactOutlineRegenerationError('')
    try {
      await rejectImpactOutlineRegenerationCandidateV1({
        scope: await resolveScopeLike(project.id!),
        runId: candidate.durableRunId,
      })
      setImpactOutlineRegenerationCandidate(null)
      setImpactInfo('生成式后续章纲候选已放弃，正式摘要未改变。')
    } catch (error) {
      setImpactOutlineRegenerationError(error instanceof Error ? error.message : '生成式后续章纲候选拒绝失败')
    } finally {
      setImpactOutlineRegenerationBusy(false)
    }
  }

  const handleRunImpactRemediation = async () => {
    const plan = impactRemediationPlan
    if (!plan || !currentChapter?.id || !project.id || plan.counts.deterministic === 0) return
    setImpactRemediationBusy(true)
    setImpactRemediationError('')
    try {
      const scope = await resolveScopeLike(project.id)
      const currentPostCorrection = impactPostCorrectionReplan?.output.plan.planHash === plan.planHash
        ? impactPostCorrectionReplan
        : null
      const result = currentPostCorrection
        ? await executeImpactPostCorrectionRemediationV1({
            scope,
            worldGroupId: chapterWorldGroupId ?? null,
            sourceChapterId: currentChapter.id,
            expectedReplan: currentPostCorrection,
          })
        : await executeImpactRemediationV1({
            scope,
            worldGroupId: chapterWorldGroupId ?? null,
            plan,
          })
      setImpactRemediationReceipt(result.receiptHash)
      setImpactInfo(result.reused
        ? `确定性影响重建已复用终态 Run；回执 ${result.receiptHash.slice(0, 12)}。`
        : `确定性影响重建已完成；检索块 ${result.output.retrieval.count} 条，摘要层级已重建；回执 ${result.receiptHash.slice(0, 12)}。`)
    } catch (error) {
      setImpactRemediationError(error instanceof Error ? error.message : '确定性影响重建失败')
    } finally {
      setImpactRemediationBusy(false)
    }
  }

  const handleReplanImpactRemediation = async () => {
    const previousPlan = impactRemediationPlan
    if (!previousPlan || impactRemediationBusy) return
    setImpactRemediationBusy(true)
    setImpactRemediationError('')
    try {
      const result = await replanImpactRemediationV1({
        scope: await resolveScopeLike(project.id!),
        previousPlan,
        reason: 'author-requested',
      })
      const reviewRecords = await readImpactAuthorReviewsV1({
        scope: await resolveScopeLike(project.id!),
        plan: result.plan,
      })
      setImpactGraph(result.graph)
      setImpactRemediationPlan(result.plan)
      setImpactPostCorrectionReplan(null)
      setImpactRemediationReceipt(null)
      const firstAuthorItem = result.plan.items.find(item => item.mode === 'author-confirmed')
      const firstReviewRecord = reviewRecords.find(record => record.output.itemId === firstAuthorItem?.id)
      setImpactReviewItemId(firstAuthorItem?.id ?? null)
      setImpactReviewDecision(firstReviewRecord?.output.decision ?? 'acknowledged')
      setImpactReviewNote(firstReviewRecord?.output.note ?? '')
      setImpactReviewReceipt(firstReviewRecord?.receiptHash ?? null)
      setImpactReviewError('')
      setImpactReviewRecords(reviewRecords)
      setImpactOutlineRegenerationItemId(null)
      setImpactOutlineRegenerationCandidate(null)
      setImpactOutlineRegenerationCompleted([])
      setImpactOutlineRegenerationReceipt(null)
      setImpactOutlineRegenerationError('')
      setImpactInfo(result.changed
        ? `影响处理计划已刷新；旧计划 ${previousPlan.planHash.slice(0, 12)} 保留为历史证据，新计划 ${result.plan.planHash.slice(0, 12)} 已绑定当前正文。`
        : `影响处理计划与当前正文一致，无需变更；计划 ${result.plan.planHash.slice(0, 12)}。`)
    } catch (error) {
      setImpactRemediationError(error instanceof Error ? error.message : '影响处理计划刷新失败')
    } finally {
      setImpactRemediationBusy(false)
    }
  }

  const handleExecuteImpactReview = async () => {
    const plan = impactRemediationPlan
    const itemId = impactReviewItemId
    if (!plan || !itemId || !currentChapter?.id || !project.id || impactReviewNote.trim().length < 2) return
    setImpactReviewBusy(true)
    setImpactReviewError('')
    try {
      const result = await executeImpactAuthorReviewV1({
        scope: await resolveScopeLike(project.id),
        worldGroupId: chapterWorldGroupId ?? null,
        plan,
        itemId,
        decision: impactReviewDecision,
        note: impactReviewNote.trim(),
      })
      const reviewRecords = await readImpactAuthorReviewsV1({
        scope: await resolveScopeLike(project.id),
        plan,
      })
      setImpactReviewRecords(reviewRecords)
      setImpactReviewDecision(result.output.decision)
      setImpactReviewNote(result.output.note)
      setImpactReviewReceipt(result.receiptHash)
      setImpactInfo(result.reused
        ? `作者复核记录已复用；正式数据未改变。回执 ${result.receiptHash.slice(0, 12)}。`
        : `作者复核已记录；正式数据未改变。回执 ${result.receiptHash.slice(0, 12)}。`)
    } catch (error) {
      setImpactReviewError(error instanceof Error ? error.message : '作者复核记录失败')
    } finally {
      setImpactReviewBusy(false)
    }
  }

  const handleImpactReviewItemChange = (itemId: string | null) => {
    const record = impactReviewRecords.find(candidate => candidate.output.itemId === itemId)
    setImpactReviewItemId(itemId)
    setImpactReviewDecision(record?.output.decision ?? 'acknowledged')
    setImpactReviewNote(record?.output.note ?? '')
    setImpactReviewReceipt(record?.receiptHash ?? null)
    setImpactReviewError('')
  }

  const handleOpenImpactManualEntry = () => {
    const plan = impactRemediationPlan
    const itemId = impactReviewItemId
    if (!plan || !itemId || !currentChapter?.id || !project.id) return
    const record = impactReviewRecords.find(candidate => candidate.output.itemId === itemId)
    if (record?.output.decision !== 'needs-manual-action') {
      setImpactReviewError('只有已记录为“需人工处理”的影响项可以打开人工入口。')
      return
    }
    try {
      const handoff = buildImpactHandoffV2({
        plan,
        itemId,
        decision: 'needs-manual-action',
        reviewRunId: record.runId,
        reviewReceiptHash: record.receiptHash,
        sourceOutlineNodeId: currentChapter.outlineNodeId ?? outlineNodeId ?? null,
      })
      navigate(buildImpactHandoffUrlV2(project.id, handoff))
    } catch (error) {
      setImpactReviewError(error instanceof Error ? error.message : '人工入口交接失败')
    }
  }

  const handleConfirmImpactPatch = async () => {
    const candidate = impactPatchCandidate
    if (!candidate) return
    setImpactPatchBusy(true)
    setImpactPatchError('')
    try {
      const scope = await resolveScopeLike(project.id!)
      const result = await adoptImpactPatchCandidateV1({ scope, candidate })
      await loadOutlineNodes(project.id!)
      setImpactPatchCandidate(null)
      setImpactGraph(null)
      setImpactRemediationPlan(null)
      setImpactPostCorrectionReplan(null)
      setImpactRemediationReceipt(null)
      setImpactRemediationError('')
      setImpactPatchTargetId(null)
      setImpactPatchSummary('')
      setImpactPatchReason('')
      setImpactInfo(`影响修订已写入大纲摘要；终态回执 ${result.receiptHash.slice(0, 12)}。`)
    } catch (error) {
      setImpactPatchError(error instanceof Error ? error.message : '影响修订写回失败')
    } finally {
      setImpactPatchBusy(false)
    }
  }

  const handleRejectImpactPatch = async () => {
    const candidate = impactPatchCandidate
    if (!candidate) return
    setImpactPatchBusy(true)
    setImpactPatchError('')
    try {
      const scope = await resolveScopeLike(project.id!)
      await rejectImpactPatchCandidateV1({ scope, candidate })
      setImpactPatchCandidate(null)
      setImpactPatchSummary('')
      setImpactPatchReason('')
      setImpactInfo('影响修订候选已放弃，正式大纲未改变。')
    } catch (error) {
      setImpactPatchError(error instanceof Error ? error.message : '影响修订拒绝失败')
    } finally {
      setImpactPatchBusy(false)
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

  // HARNESS-20/41: 正文采纳后的单一 post-adoption barrier。
  // 六域结构抽取复用“整理本章”Agent；检索、章节记忆和确定性一致性守卫均有独立证据。
  const handleAutoPostGenerate = async (task: {
    chapterId: number
    chapterTitle: string
    chapterContent: string
    chapterPlainText: string
    parent?: {
      runId: number
      receiptHash: string
      artifactHash: string
    }
    resumeRunId?: number
  }) => {
    const controller = new AbortController()
    organizationAbortRef.current?.abort()
    organizationAbortRef.current = controller
    setOrganizingChapter(true)
    try {
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
    let snapshot = task.resumeRunId != null
      ? await readAgentRunV1(scope, task.resumeRunId)
      : await createChapterPostAdoptionDurableRunV1({
          scope,
          worldGroupId: transitionWorldGroupId,
          chapterId: task.chapterId,
          parent: task.parent,
        })
    if (snapshot.contract.scope.chapterIds?.length !== 1 || snapshot.contract.scope.chapterIds[0] !== task.chapterId) {
      throw new Error('章节后处理恢复运行与当前章节不匹配。')
    }
    if (task.resumeRunId != null) {
      const resumePlan = buildChapterPostAdoptionResumePlanV1(snapshot)
      if (resumePlan.terminal) return
      if (!resumePlan.canResume) {
        throw new Error(`章节后处理当前不可自动恢复：${resumePlan.blockedReason ?? '需要检查运行证据'}`)
      }
    }
    setPostAdoptionRunId(snapshot.run.id)
    setPostAdoptionChainState(chapterPostAdoptionChainStateV1(snapshot))
    transitionSnapshotRef.current = snapshot
    snapshot = await scheduleChapterPostAdoptionStepsV1({ scope, snapshot })

    const assembledFor = async (sourceKeys: readonly string[]) => assembleContext({
      projectId: project.id!,
      scope,
      worldGroupId: transitionWorldGroupId,
      chapterId: task.chapterId,
      outlineNodeId: transitionChapter?.outlineNodeId ?? null,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: [...sourceKeys],
      stateReferenceText: task.chapterPlainText,
      extraStateIds,
      inputBudgetMaxTokens: 24_000,
    })
    const manifestFor = async (
      stepId: ChapterPostAdoptionStepIdV1,
      attempt: number,
      sourceKeys: readonly string[],
      assembled: Awaited<ReturnType<typeof assembleContext>>,
    ) => createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId,
      attempt,
      projectId: project.id!,
      worldGroupId: transitionWorldGroupId,
      declaredSourceKeys: sourceKeys,
      assembled,
      boundary: { chapterId: task.chapterId, outlineNodeId: transitionChapter?.outlineNodeId ?? undefined },
      readerVersion: 'chapter-post-adoption-context-v1',
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
      setPostAdoptionChainState(chapterPostAdoptionChainStateV1(next))
    }
    const shouldRunStep = (stepId: ChapterPostAdoptionStepIdV1): boolean => {
      if (task.resumeRunId == null) return true
      return isChapterPostAdoptionStepRunnableV1(
        buildChapterPostAdoptionResumePlanV1(snapshot),
        stepId,
      )
    }

    // 1. 一次综合抽取六域候选；作者确认前业务表零写入。
    if (!shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization)) {
      if (snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]?.status === 'awaiting_confirmation') {
        setShowOrganization(true)
      }
    } else {
    setAutoProcessing('extracting')
    try {
      await ensureFresh()
      const organizationAssembly = await assembledFor(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization)
      const organizationManifest = await manifestFor(
        CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        1,
        CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.organization,
        organizationAssembly,
      )
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        contextManifest: organizationManifest,
        binding: { chapterId: task.chapterId, sourceTextHash: expectedSourceTextHash },
      }))
      const [allRelations] = await Promise.all([
        db.characterRelations.where('projectId').equals(project.id!).toArray(),
        loadForeshadows(project.id!),
      ])
      const scopedCharacters = project.enableMultiWorld
        ? characters.filter(character => (
          character.isCrossWorld
          || (character.homeWorldGroupId ?? null) === (transitionWorldGroupId ?? null)
        ))
        : characters
      const scopedCharacterIds = new Set(
        scopedCharacters.flatMap(character => character.id != null ? [character.id] : []),
      )
      const existingRelations = allRelations.filter(relation => (
        scopedCharacterIds.has(relation.fromCharacterId)
        && scopedCharacterIds.has(relation.toCharacterId)
      ))
      const organizationContextSnapshot = organizationAssembly.included.flatMap((sourceKey, index) => (
        sourceKey === 'chapterContent' ? [] : [organizationAssembly.segments[index]?.content ?? '']
      )).filter(Boolean).join('\n\n')
      const budget = new AgentTeamBudgetTracker(useAIConfigStore.getState().agentTeamBudgetProfile)
      const candidate = await runChapterOrganization({
        projectId: project.id!,
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        worldGroupId: transitionWorldGroupId,
        chapterContent: task.chapterContent,
        stateContext: buildSelectiveStateContext(task.chapterPlainText, extraStateIds).text,
        characters: scopedCharacters,
        knownItemNames: itemEntries.map(entry => entry.itemName),
        existingRelations,
        foreshadows: useForeshadowStore.getState().foreshadows,
        contextSnapshot: organizationContextSnapshot,
        budget,
        call: messages => chat(messages, aiConfig, {
          category: 'chapter.organize',
          projectId: project.id!,
          configOverrides: { maxTokens: 8_000 },
          contextOverflowPolicy: 'reject',
        }, controller.signal),
      })
      await ensureFresh()
      const candidateHash = await hashChapterOrganizationCandidateV1(candidate)
      const run = await persistChapterOrganizationCandidate(candidate, {
        durable: {
          runId: snapshot.run.id,
          stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
          attempt: 1,
          contextManifestHash: organizationManifest.manifestHash,
          candidateHash,
        },
      })
      updateSnapshot(await recordChapterPostAdoptionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        output: run.candidate,
        candidateHash,
        requiresConfirmation: true,
      }))
      setOrganizationRun(run)
      setOrganizationCurrent(true)
      setShowOrganization(true)
    } catch (error) {
      try {
        updateSnapshot(await readAgentRunV1(scope, snapshot.run.id))
      } catch {
        // Keep the original processing error when a refresh window prevents a re-read.
      }
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
        ...failure,
      }))
      if (!controller.signal.aborted) {
        setTransitionError(error instanceof Error ? error.message : '六域交接候选生成失败')
      }
      if (controller.signal.aborted) return
    } finally {
      setAutoProcessing('idle')
    }
    }

    // 2. summary + handoff 仍只调用一次模型，并由原子 CAS 写回 chapters。
    if (shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory)) try {
      await ensureFresh()
      const memoryAssembly = await assembledFor(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.memory)
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        contextManifest: await manifestFor(
          CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
          1,
          CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.memory,
          memoryAssembly,
        ),
        binding: { chapterId: task.chapterId, sourceTextHash: expectedSourceTextHash },
      }))
      const result = await handleChapterMemory({
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        chapterContent: task.chapterContent,
      })
      if (result !== 'written') throw new Error(`章节记忆后处理未写入：${result}`)
      updateSnapshot(await recordChapterPostAdoptionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        output: { status: result, sourceTextHash: expectedSourceTextHash },
      }))
      updateSnapshot(await succeedChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        output: { status: result, sourceTextHash: expectedSourceTextHash },
      }))
    } catch (error) {
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
        ...failure,
      }))
      setTransitionError(error instanceof Error ? error.message : '章节记忆后处理失败')
    }

    // 3. 记忆写回后再重建检索与层级摘要，避免把刚生成的可信摘要留在 pending 状态。
    if (shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval)) try {
      await ensureFresh()
      const retrievalAssembly = await assembledFor(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.retrieval)
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
        contextManifest: await manifestFor(
          CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
          1,
          CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.retrieval,
          retrievalAssembly,
        ),
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
          .catch(e => console.warn('[ChapterPostAdoption] 语义索引补建失败（关键词检索仍可用）:', e))
      }
      updateSnapshot(await succeedChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
        output: { chunks, summaries, sourceTextHash: expectedSourceTextHash },
      }))
    } catch (error) {
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
        ...failure,
      }))
      setTransitionError(error instanceof Error ? error.message : '检索后处理失败')
    }

    // 4. 零 token 确定性一致性守卫。报告进入同一 durable Run；语义深审仍由作者显式触发。
    if (shouldRunStep(CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency)) try {
      await ensureFresh()
      const consistencyAssembly = await assembledFor(CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.consistency)
      const consistencyManifest = await manifestFor(
        CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        1,
        CHAPTER_POST_ADOPTION_STEP_SOURCE_KEYS_V1.consistency,
        consistencyAssembly,
      )
      updateSnapshot(await beginChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        contextManifest: consistencyManifest,
        model: false,
      }))
      const guard = await runBackgroundConsistencyAgent({
        projectId: project.id!,
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        worldGroupId: transitionWorldGroupId,
        chapterContent: task.chapterContent,
        budget: new AgentTeamBudgetTracker(useAIConfigStore.getState().agentTeamBudgetProfile),
        contextEvidence: {
          included: consistencyAssembly.included,
          omitted: consistencyAssembly.omitted,
          trimmed: consistencyAssembly.trimmed,
          inputTokens: consistencyAssembly.totalInputTokens,
          inputBudget: consistencyAssembly.inputBudget,
        },
      })
      await ensureFresh()
      const candidateHash = await hashConsistencyAgentCandidateV1(guard)
      const durableGuard = {
        ...guard,
        durable: {
          runId: snapshot.run.id,
          stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
          attempt: 1,
          contextManifestHash: consistencyManifest.manifestHash,
          candidateHash,
        },
      }
      const run = await persistConsistencyAgentCandidate(durableGuard)
      updateSnapshot(await recordChapterPostAdoptionOutputV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        output: durableGuard,
        candidateHash,
        requiresConfirmation: false,
        modelResponded: false,
      }))
      updateSnapshot(await succeedChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        output: durableGuard,
      }))
      setConsistencyRun(run)
      setConsistencyCurrent(true)
      useReviewResultStore.getState().setConsistency(task.chapterId, toConsistencyAuditResult(durableGuard))
      if (snapshot.projection.steps[CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]?.status === 'succeeded') {
        const verified = await verifyChapterPostAdoptionRunV1({ scope, runId: snapshot.run.id })
        updateSnapshot(verified.snapshot)
      }
    } catch (error) {
      const failure = await classifyAgentRunFailureV1(error)
      updateSnapshot(await failChapterPostAdoptionStepV1({
        scope,
        snapshot,
        stepId: CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency,
        ...failure,
      }))
      setTransitionError(error instanceof Error ? error.message : '正文一致性守卫失败')
    }
    } finally {
      if (organizationAbortRef.current === controller) organizationAbortRef.current = null
      setOrganizingChapter(false)
    }
  }

  const handleResumePostAdoption = () => {
    if (!currentChapter?.id || postAdoptionRunId == null || organizingChapter) return
    const chapterTitle = outlineNode?.title || currentChapter.title || '未知章节'
    void handleAutoPostGenerate({
      chapterId: currentChapter.id,
      chapterTitle,
      chapterContent: currentChapter.content ?? content,
      chapterPlainText: htmlToPlainText(currentChapter.content ?? content),
      resumeRunId: postAdoptionRunId,
    }).catch(error => {
      setTransitionError(error instanceof Error ? error.message : '章节后处理恢复失败')
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

    // H7:正文生成/续写的确认先经过 durable candidate + adopt(CAS)，再更新编辑器。
    // 这样作者看到的内容、正式 chapters 行和后处理 barrier 绑定在同一份候选证据上。
    const durableCandidate = shouldAutoProcess ? proseCandidateRef.current : null
    if (durableCandidate && durableCandidate.operation === aiAction) {
      const beforeHtml = editorRef.current.getHTML()
      let fullHtml = html
      let fullText = normalizeProse(text)
      if (aiAction === 'continue') {
        editorRef.current.appendContent(html)
        fullHtml = editorRef.current.getHTML()
        fullText = editorRef.current.getPlainText()
      }
      const fullWordCount = countWords(fullText)
      try {
        const scope = await resolveScopeLike(project.id!)
        const verification = await commitProseGenerationAdoptionV1({
          scope,
          runId: durableCandidate.durable.runId,
          candidate: durableCandidate,
          contentHtml: fullHtml,
          wordCount: fullWordCount,
        })
        proseSnapshotRef.current = verification.snapshot
        await refreshChapter(acceptedChapterId)
        setProseCandidate(null)
        proseCandidateRef.current = null
        ai.reset()
        if (aiAction === 'generate') {
          editorRef.current.setContent(fullHtml)
        }
        setContent(fullHtml)
        setPlainText(fullText)
        setSavedContent(fullHtml)
        void handleAutoPostGenerate({
          chapterId: acceptedChapterId,
          chapterTitle: acceptedChapterTitle,
          chapterContent: fullHtml,
          chapterPlainText: fullText,
          parent: {
            runId: verification.snapshot.run.id,
            receiptHash: verification.receiptHash,
            artifactHash: durableCandidate.expectedContentHash,
          },
        }).catch(error => {
          setTransitionError(error instanceof Error ? error.message : '章节后处理启动失败')
        })
      } catch (error) {
        if (aiAction === 'continue') {
          editorRef.current.setContent(beforeHtml)
          setContent(beforeHtml)
          setPlainText(editorRef.current.getPlainText())
        }
        setTransitionError(error instanceof Error ? error.message : '正文候选采纳失败')
      }
      return
    }
    if (shouldAutoProcess) {
      await dialog.alert({
        title: '正文候选不可采纳',
        message: proseGenerationError
          || '本次输出没有通过 durable 候选与信息边界校验。请关闭后重试，作者原稿未被修改。',
      })
      return
    }

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
    setProseGenerationError('')
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

  const handleDismissAI = async () => {
    proseSemanticAbortRef.current?.abort()
    proseSemanticAbortRef.current = null
    setProseHarnessStage('idle')
    const candidate = proseCandidateRef.current
    if (candidate) {
      try {
        const scope = await resolveScopeLike(project.id!)
        const snapshot = await rejectProseGenerationCandidateV1({
          scope,
          runId: candidate.durable.runId,
          candidate,
        })
        proseSnapshotRef.current = snapshot
      } catch (error) {
        console.warn('[ProseGeneration] 候选拒绝证据写入失败:', error)
      }
      setProseCandidate(null)
      proseCandidateRef.current = null
    }
    ai.reset()
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
          impactRemediationPlan={impactRemediationPlan}
          impactRemediationBusy={impactRemediationBusy}
          impactRemediationReceipt={impactRemediationReceipt}
          impactRemediationError={impactRemediationError || null}
          impactReviewItemId={impactReviewItemId}
          impactReviewDecision={impactReviewDecision}
          impactReviewNote={impactReviewNote}
          impactReviewBusy={impactReviewBusy}
          impactReviewReceipt={impactReviewReceipt}
          impactReviewError={impactReviewError || null}
          impactReviewRecords={impactReviewRecords}
          impactPatchTargets={impactPatchTargets}
          impactPatchTargetId={impactPatchTargetId}
          impactPatchSummary={impactPatchSummary}
          impactPatchReason={impactPatchReason}
          impactPatchCandidate={impactPatchCandidate}
          impactPatchBusy={impactPatchBusy}
          impactPatchError={impactPatchError || null}
          impactOutlineRegenerationTargets={impactOutlineRegenerationTargets}
          impactOutlineRegenerationItemId={impactOutlineRegenerationItemId}
          impactOutlineRegenerationCandidate={impactOutlineRegenerationCandidate}
          impactOutlineRegenerationBusy={impactOutlineRegenerationBusy}
          impactOutlineRegenerationReceipt={impactOutlineRegenerationReceipt}
          impactOutlineRegenerationError={impactOutlineRegenerationError || null}
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
          onDismissImpact={handleDismissImpact}
          onImpactPatchTargetChange={setImpactPatchTargetId}
          onImpactPatchSummaryChange={setImpactPatchSummary}
          onImpactPatchReasonChange={setImpactPatchReason}
          onCreateImpactPatch={() => { void handleCreateImpactPatch() }}
          onRunImpactRemediation={() => { void handleRunImpactRemediation() }}
          onReplanImpactRemediation={() => { void handleReplanImpactRemediation() }}
          onImpactReviewItemChange={handleImpactReviewItemChange}
          onImpactReviewDecisionChange={setImpactReviewDecision}
          onImpactReviewNoteChange={setImpactReviewNote}
          onExecuteImpactReview={() => { void handleExecuteImpactReview() }}
          onOpenImpactManualEntry={handleOpenImpactManualEntry}
          onConfirmImpactPatch={() => { void handleConfirmImpactPatch() }}
          onRejectImpactPatch={() => { void handleRejectImpactPatch() }}
          onImpactOutlineRegenerationItemChange={setImpactOutlineRegenerationItemId}
          onGenerateImpactOutlineRegeneration={() => { void handleGenerateImpactOutlineRegeneration() }}
          onConfirmImpactOutlineRegeneration={() => { void handleConfirmImpactOutlineRegeneration() }}
          onRejectImpactOutlineRegeneration={() => { void handleRejectImpactOutlineRegeneration() }}
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
          worldGroupId={chapterWorldGroupId ?? null}
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
                pending.assembled,
                pending.informationBoundary,
              )
            }}
          />
        </div>
      )}

      {proseGenerationError && (
        <div className="mb-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          正文候选未通过质量门：{proseGenerationError}
        </div>
      )}

      {proseHarnessStage !== 'idle' && (
        <div className="mb-3 border-l-2 border-l-accent bg-accent/5 px-3 py-2 text-xs text-text-secondary">
          {proseHarnessStage === 'reviewing' && '正在核对候选与章纲、角色、事实和信息边界...'}
          {proseHarnessStage === 'revising' && '正在按有逐字证据的问题定向修订一次...'}
          {proseHarnessStage === 'rereviewing' && '正在复核修订稿；通过前不会开放采纳...'}
        </div>
      )}

      {proseCandidate?.semanticReview && (
        <div className="mb-3 border-l-2 border-l-success bg-success/5 px-3 py-2 text-xs text-text-secondary">
          <span className="font-medium text-success">语义评审通过</span>
          <span className="ml-2">
            {proseCandidate.semanticReview.revision ? '已完成一次证据定向修订并复核' : '原候选无需自动修订'}
            {proseCandidate.semanticReview.final.issues.filter(issue => issue.severity !== 'blocking').length > 0
              ? `；保留 ${proseCandidate.semanticReview.final.issues.filter(issue => issue.severity !== 'blocking').length} 条非阻断提示`
              : ''}
          </span>
        </div>
      )}

      {(ai.output || ai.isStreaming || ai.error) && (
        <div className="mb-3">
          <AIStreamOutput output={ai.output} isStreaming={ai.isStreaming || proseHarnessStage !== 'idle'} error={ai.error} tokenUsage={ai.tokenUsage}
            onStop={() => {
              ai.stop()
              proseSemanticAbortRef.current?.abort()
            }}
            onAccept={(
              ai.operation === 'generate' || ai.operation === 'continue'
            ) && !proseCandidate ? undefined : handleAcceptAI}
            onDismiss={() => { void handleDismissAI() }}
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
      {(postAdoptionRunId != null || transitionRunId != null || transitionError) && (
        <div className={`mb-3 p-3 rounded-lg border text-xs ${transitionError
          ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
          : 'bg-sky-500/10 border-sky-500/20 text-sky-300'}`}>
          <div>
            章节后处理 Run #{postAdoptionRunId ?? transitionRunId ?? '—'} · 六域交接、章节记忆、检索与一致性守卫统一记录，可恢复
          </div>
          {postAdoptionChainState && (
            <div className="mt-1">
              全链状态：{postAdoptionChainState === 'downstream-completed'
                ? '正文与章后交接均已完成'
                : postAdoptionChainState === 'downstream-awaiting-confirmation'
                  ? '正文已完成，章后交接等待作者确认'
                  : postAdoptionChainState === 'downstream-failed'
                    ? '正文已完成，章后交接失败但可恢复'
                    : postAdoptionChainState === 'upstream-invalid'
                      ? '父正文回执或正文产物已失效，需要重新处理'
                      : postAdoptionChainState === 'prose-completed'
                        ? '正文已完成，章后处理尚未启动'
                        : postAdoptionChainState === 'legacy-unlinked'
                          ? '兼容后处理记录未绑定正文 Run'
                          : '正文已完成，章后处理正在执行'}
            </div>
          )}
          {organizationRun?.candidate.durable?.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization && (
            <div className="mt-1">六域交接候选待作者确认，确认后才会写入状态、事实、物品、年表、关系与伏笔。</div>
          )}
          {transitionCandidate && transitionCandidate.stateDiffs.length > 0 && (
            <div className="mt-1">状态候选待作者确认：{transitionCandidate.stateDiffs.length} 条</div>
          )}
          {transitionError && <div className="mt-1">{transitionError}</div>}
          {postAdoptionChainState === 'downstream-failed' && (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 rounded border border-sky-400/30 px-2 py-1 text-[11px] text-sky-200 hover:bg-sky-400/10 disabled:opacity-50"
              onClick={handleResumePostAdoption}
              disabled={organizingChapter}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              继续章后处理
            </button>
          )}
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
      {compareSourceHtml == null && editorWorkspaceScope && currentChapter.id && <FloatingToolbar
        key={`selection-edit-${currentChapter.id}`}
        scope={editorWorkspaceScope}
        projectId={project.id!}
        chapterId={currentChapter.id}
        worldGroupId={chapterWorldGroupId}
        aiConfig={aiConfig}
        getSelectionSnapshot={() => editorRef.current?.getSelectionSnapshot() ?? null}
        getSelectionRect={() => {
          const sel = window.getSelection()
          if (!sel || sel.isCollapsed || !sel.rangeCount) return null
          return sel.getRangeAt(0).getBoundingClientRect()
        }}
        getCurrentHtml={() => editorRef.current?.getHTML() ?? content}
        previewRangeReplacement={(from, to, text) => (
          editorRef.current?.previewRangeReplacement(from, to, text) ?? null
        )}
        persistBeforeGenerate={persistCurrentEditorContent}
        onContentAdopted={(html, demotedFacts) => {
          editorRef.current?.setContent(html)
          setContent(html)
          setPlainText(htmlToPlainText(html))
          setSavedContent(html)
          void refreshChapter(currentChapter.id!)
          setImpactInfo(demotedFacts > 0
            ? `局部编辑已写入；${demotedFacts} 条失去逐字证据的确认事实已标为待复核。`
            : '局部编辑已写入并通过正文终验。')
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
