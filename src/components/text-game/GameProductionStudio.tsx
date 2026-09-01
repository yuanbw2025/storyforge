import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Archive, ArchiveRestore, CheckCircle2, CirclePause, FileCheck2, Gamepad2, Loader2,
  GitBranch, PackageCheck, Play, Plus, RefreshCw, Rocket, ShieldCheck, Sparkles, Square,
} from 'lucide-react'
import {
  authorizeGameProductionStartV1,
  archiveGameProductionV1,
  beginGameProductionEvolutionV1,
  compileGameProductionBriefV3,
  consultGameProductionStartV1,
  createGameProductionWithBriefV1,
  evaluateGameProductionAuthorizationReadinessV1,
  inspectGameProductionCapabilityReadinessV1,
  listGameProductionWorkspaceV1,
  publishGameProductionV1,
  readGameProductionDetailsV1,
  readGameProductionProgressV1,
  retryGameProductionBlockerV1,
  restoreArchivedGameProductionV1,
  runAuthorizedGameProductionV1,
  setGameProductionPausedV1,
  startGameProductionPreviewV1,
  stopGameProductionV1,
  type GameProductionDetailsV1,
  type GameProductionProgressV1,
} from '../../lib/game-production/service'
import type {
  GameBuildCompatibilityReportV1, GameEvolutionAffectedLaneV1, GameProductionBriefV3, GameProductionRecordV1,
  GameProductionScaleV1, GameProductionSourceOptionsV1, GameProductionSourceSelectionV1,
  GameStartingPointSuggestionV1, TtrpgCampaignProposalSectionV2, WorkspaceScope,
  WorldGameProductionHandoffV2, WorldRelease,
} from '../../lib/types'
import { GAME_BROWSER_PERFORMANCE_POLICY_V1 } from '../../lib/game-production/browser-performance'
import {
  listCompletedGameBuildPlaythroughsV1,
  readLatestGameBuildMainRouteGateV1,
  readLatestGameBrowserPerformanceGateV1,
  readLatestGameMediaRuntimeGateV1,
  recordGameBrowserPerformanceMeasurementV1,
  recordGameBuildMainRoutePlaythroughV1,
  type CompletedGameBuildPlaythroughV1,
  type VerifiedGameBrowserPerformanceGateV1,
  type VerifiedGameMainRoutePlaythroughGateV1,
  type VerifiedGameMediaRuntimeGateV1,
} from '../../lib/game-production/quality-receipts'
import {
  runInAppBrowserPerformanceLabV1,
  type InAppBrowserPerformanceLabProgressV1,
} from '../../lib/game-production/in-app-browser-performance-lab'
import { parseWorldGameProductionHandoffV2 } from '../../lib/game-production/handoff'
import TtrpgProductionWizard, {
  createDefaultTtrpgProductionWizardValueV2,
  toTtrpgProductionBriefDraftInputV2,
  type TtrpgProductionWizardValueV2,
} from '../ttrpg/TtrpgProductionWizard'
import TtrpgCampaignProposalSelector from '../ttrpg/TtrpgCampaignProposalSelector'
import { generateTtrpgCampaignProposalCandidateV2 } from '../../lib/ttrpg/campaign-proposal-harness'
import { loadTtrpgWorldSourceCatalogV2 } from '../../lib/ttrpg/world-source'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../../lib/ai/client'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
export type SupportedGameProductionProduct =
  | 'storygame'
  | 'character-interaction'
  | 'text-adventure'
  | 'avg'
  | 'narrative-simulation'
  | 'text-open-world'
  | 'ttrpg'

type SupportedProduct = SupportedGameProductionProduct

interface CommandActivityV1 {
  label: string
  status: 'pending' | 'succeeded' | 'conflict'
  detail: string
}

const SOURCE_SELECTION_FACETS = [
  ['storySources', 'storyResourceKeys', '故事来源'],
  ['characters', 'characterResourceKeys', '角色'],
  ['importantLocations', 'importantLocationResourceKeys', '地点'],
  ['artifacts', 'artifactResourceKeys', '道具'],
  ['codexEntries', 'codexEntryResourceKeys', '设定 / 阵营'],
  ['storyArcs', 'storyArcResourceKeys', '故事线'],
] as const satisfies ReadonlyArray<[
  keyof GameProductionSourceOptionsV1,
  keyof GameProductionSourceSelectionV1,
  string,
]>

function compactHash(value: string): string {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : '—'
}

function formatBytes(value: number): string {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB`
    : value >= 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${value} B`
}

function formatDurationMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function nonEmptyLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
}

function frozenSourceFacetSummary(
  draft: GameProductionBriefV3,
  options: GameProductionSourceOptionsV1 | null,
): string {
  if (!options) return `语义资源 ${draft.source.selection.resourceKeys.length}`
  const selected = new Set(draft.source.selection.resourceKeys)
  return SOURCE_SELECTION_FACETS.map(([optionField, , label]) => (
    `${label} ${options[optionField].filter(option => selected.has(option.resourceKey)).length}`
  )).join(' · ')
}

function statusLabel(value: string): string {
  return ({
    consulting: '会谈中', 'brief-ready': '待授权', producing: '制作中', paused: '已暂停',
    'preview-ready': '可预览', released: '已发布', stopped: '已停止', failed: '失败', archived: '已归档',
    authorized: '已授权', planning: '规划中', building: '构建中', integrating: '装配中', validating: '质检中',
    'release-ready': '可发布', 'recovery-required': '需要处理', cancelled: '已取消',
    waiting: '等待依赖', ready: '可执行', running: '执行中', 'retry-ready': '等待重试', completed: '已完成',
    blocked: '阻塞', stale: '旧 epoch',
  } as Record<string, string>)[value] ?? value
}

function buildFailureSummary(value: string): string {
  try {
    const parsed = JSON.parse(value) as { taskKey?: unknown; detail?: unknown; code?: unknown }
    const task = typeof parsed.taskKey === 'string' ? parsed.taskKey : ''
    const detail = typeof parsed.detail === 'string' ? parsed.detail : typeof parsed.code === 'string' ? parsed.code : ''
    return [task, detail].filter(Boolean).join(' · ')
  } catch { return '' }
}

async function ttrpgWorldSourceAlignmentMessageV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<string> {
  const catalog = await loadTtrpgWorldSourceCatalogV2(input)
  const unavailable = catalog.unavailableResourceKinds
  return unavailable.length
    ? `当前测试来源仍有 ${unavailable.join('、')} 无法解析；请改用其它冻结测试来源。`
    : '冻结来源可用于跑团上层开发。当前 Build 只允许制作和试玩；正式世界适配与商业发布将在世界出口稳定后接入。'
}

function compatibilityReport(value: string | undefined): GameBuildCompatibilityReportV1 | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<GameBuildCompatibilityReportV1>
    return parsed.schema === 'storyforge.game-build-compatibility' && parsed.version === 1
      && ['compatible', 'restart-recommended', 'breaking'].includes(parsed.level ?? '')
      ? parsed as GameBuildCompatibilityReportV1 : null
  } catch { return null }
}

export function shouldAutoContinueGameProductionV1(input: {
  productionStatus: string | null
  buildStatus: string | null
  running: boolean
}): boolean {
  return !input.running && input.productionStatus === 'producing'
    && input.buildStatus != null && ['authorized', 'building'].includes(input.buildStatus)
}

export default function GameProductionStudio(props: {
  scope: WorkspaceScope
  worldGroupId?: number | null
  initialProduct?: SupportedProduct
  initialSource?: WorldGameProductionHandoffV2 | null
  onPublished?: (productType: SupportedProduct) => void
  onPreviewStarted?: (productType: SupportedProduct, sessionId: number) => void
}) {
  const [releases, setReleases] = useState<WorldRelease[]>([])
  const [productions, setProductions] = useState<GameProductionRecordV1[]>([])
  const [selectedProductionId, setSelectedProductionId] = useState<number | null>(null)
  const [details, setDetails] = useState<GameProductionDetailsV1 | null>(null)
  const [worldReleaseId, setWorldReleaseId] = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<GameStartingPointSuggestionV1[]>([])
  const [suggestionKey, setSuggestionKey] = useState('')
  const [sourceOptions, setSourceOptions] = useState<GameProductionSourceOptionsV1 | null>(null)
  const [selectionDefaults, setSelectionDefaults] = useState<Record<string, GameProductionSourceSelectionV1>>({})
  const [sourceSelection, setSourceSelection] = useState<GameProductionSourceSelectionV1 | null>(null)
  const [title, setTitle] = useState('')
  const [openingSituation, setOpeningSituation] = useState('')
  const [playerRole, setPlayerRole] = useState('')
  const [scale, setScale] = useState<GameProductionScaleV1['scope']>('scene')
  const [requiredFactsText, setRequiredFactsText] = useState('')
  const [forbiddenChangesText, setForbiddenChangesText] = useState('')
  const [contentBoundariesText, setContentBoundariesText] = useState('不生成未授权的露骨或仇恨内容')
  const [productType, setProductType] = useState<SupportedProduct>(props.initialProduct ?? 'storygame')
  const [qualityProfile, setQualityProfile] = useState<GameProductionBriefV3['qualityProfile']>('prototype')
  const [visualLevel, setVisualLevel] = useState<'none' | 'key-scenes'>(props.initialProduct === 'avg' ? 'key-scenes' : 'none')
  const [audioLevel, setAudioLevel] = useState<'none' | 'music-sfx'>(props.initialProduct === 'avg' ? 'music-sfx' : 'none')
  const [confirmTtrpgDefaultMappings, setConfirmTtrpgDefaultMappings] = useState(false)
  const [ttrpgWizard, setTtrpgWizard] = useState<TtrpgProductionWizardValueV2>(
    createDefaultTtrpgProductionWizardValueV2,
  )
  const [draft, setDraft] = useState<GameProductionBriefV3 | null>(null)
  const [busy, setBusy] = useState(false)
  const [productionRunning, setProductionRunning] = useState(false)
  const [campaignProposalRunning, setCampaignProposalRunning] = useState(false)
  const [progress, setProgress] = useState<GameProductionProgressV1 | null>(null)
  const [performanceGate, setPerformanceGate] = useState<VerifiedGameBrowserPerformanceGateV1 | null>(null)
  const [performanceGateError, setPerformanceGateError] = useState('')
  const [performanceLabRunning, setPerformanceLabRunning] = useState(false)
  const [performanceLabProgress, setPerformanceLabProgress] = useState<InAppBrowserPerformanceLabProgressV1 | null>(null)
  const [playthroughGate, setPlaythroughGate] = useState<VerifiedGameMainRoutePlaythroughGateV1 | null>(null)
  const [playthroughGateError, setPlaythroughGateError] = useState('')
  const [mediaRuntimeGate, setMediaRuntimeGate] = useState<VerifiedGameMediaRuntimeGateV1 | null>(null)
  const [mediaRuntimeGateError, setMediaRuntimeGateError] = useState('')
  const [completedPlaythroughs, setCompletedPlaythroughs] = useState<CompletedGameBuildPlaythroughV1[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [commandActivity, setCommandActivity] = useState<CommandActivityV1 | null>(null)
  const [evolutionGoal, setEvolutionGoal] = useState('')
  const [evolutionLanes, setEvolutionLanes] = useState<GameEvolutionAffectedLaneV1[]>([
    'content', 'product', 'visual', 'audio',
  ])
  const productionAbort = useRef<AbortController | null>(null)
  const performanceLabAbort = useRef<AbortController | null>(null)
  const performanceLabHost = useRef<HTMLDivElement | null>(null)
  const productionRunningRef = useRef(false)
  const queuedProductionIdRef = useRef<number | null>(null)
  const selectedProductionIdRef = useRef<number | null>(null)
  selectedProductionIdRef.current = selectedProductionId
  const aiConfig = useAIConfigStore((state) => state.config)

  const refresh = useCallback(async (preferredId?: number | null) => {
    const { worldReleases: nextReleases, productions: nextProductions } = await listGameProductionWorkspaceV1(props.scope)
    setReleases(nextReleases)
    setProductions(nextProductions)
    const initialSource = props.initialSource ? parseWorldGameProductionHandoffV2(props.initialSource) : null
    const handedOffRelease = initialSource
      ? nextReleases.find(release => release.id === initialSource.worldReleaseId
        && release.contentHash === initialSource.worldContentHash)
      : null
    if (initialSource && (!handedOffRelease || initialSource.productType !== productType)) {
      setError('世界引擎交接的 WorldRelease 已失效、hash 已变化或产品类型不一致；请返回世界引擎重新选择。')
    }
    setWorldReleaseId(current => initialSource
      ? handedOffRelease?.id ?? null
      : current ?? nextReleases[0]?.id ?? null)
    const desired = preferredId !== undefined
      ? preferredId
      : selectedProductionId != null && nextProductions.some(row => row.id === selectedProductionId)
        ? selectedProductionId
        : nextProductions[0]?.id ?? null
    selectedProductionIdRef.current = desired
    setSelectedProductionId(desired)
    if (desired == null) {
      setDetails(null)
      setProgress(null)
      setPerformanceGate(null)
      setPerformanceGateError('')
      setPlaythroughGate(null)
      setPlaythroughGateError('')
      setMediaRuntimeGate(null)
      setMediaRuntimeGateError('')
      setCompletedPlaythroughs([])
      return
    }
    const nextDetails = await readGameProductionDetailsV1(props.scope, desired)
    setDetails(nextDetails)
    setProgress(nextDetails.build && nextDetails.brief?.status === 'authorized'
      ? await readGameProductionProgressV1({ scope: props.scope, productionId: desired })
      : null)
    if (nextDetails.build) {
      try {
        setPerformanceGate(await readLatestGameBrowserPerformanceGateV1({
          scope: props.scope, gameBuildId: nextDetails.build.id!,
        }))
        setPerformanceGateError('')
      } catch (cause) {
        setPerformanceGate(null)
        setPerformanceGateError(cause instanceof Error ? cause.message : String(cause))
      }
      try {
        setMediaRuntimeGate(await readLatestGameMediaRuntimeGateV1({
          scope: props.scope, gameBuildId: nextDetails.build.id!,
        }))
        setMediaRuntimeGateError('')
      } catch (cause) {
        setMediaRuntimeGate(null)
        setMediaRuntimeGateError(cause instanceof Error ? cause.message : String(cause))
      }
      let nextPlaythroughError = ''
      try {
        setPlaythroughGate(await readLatestGameBuildMainRouteGateV1({
          scope: props.scope, gameBuildId: nextDetails.build.id!,
        }))
      } catch (cause) {
        setPlaythroughGate(null)
        nextPlaythroughError = cause instanceof Error ? cause.message : String(cause)
      }
      try {
        setCompletedPlaythroughs(await listCompletedGameBuildPlaythroughsV1({
          scope: props.scope, gameBuildId: nextDetails.build.id!,
        }))
      } catch (cause) {
        setCompletedPlaythroughs([])
        const message = cause instanceof Error ? cause.message : String(cause)
        nextPlaythroughError = [nextPlaythroughError, message].filter(Boolean).join('；')
      }
      setPlaythroughGateError(nextPlaythroughError)
    } else {
      setPerformanceGate(null)
      setPerformanceGateError('')
      setPlaythroughGate(null)
      setPlaythroughGateError('')
      setMediaRuntimeGate(null)
      setMediaRuntimeGateError('')
      setCompletedPlaythroughs([])
    }
  }, [productType, props.initialSource, props.scope, selectedProductionId])

  useEffect(() => { void refresh() }, [props.scope.projectId, props.scope.worldId, props.scope.workId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    queuedProductionIdRef.current = null
    productionAbort.current?.abort('game-production-studio-unmounted')
    performanceLabAbort.current?.abort('game-production-studio-unmounted')
  }, [])
  useEffect(() => () => {
    performanceLabAbort.current?.abort('game-production-build-changed')
  }, [details?.build?.id])

  const run = async (action: () => Promise<void>, label = '受治理操作') => {
    setBusy(true); setError(''); setMessage('')
    setCommandActivity({ label, status: 'pending', detail: '正在等待 durable receipt…' })
    try {
      await action()
      setCommandActivity({ label, status: 'succeeded', detail: '状态已从持久化投影复验。' })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      setError(detail)
      setCommandActivity({
        label, status: 'conflict',
        detail: /conflict|revision|过期|stale/i.test(detail) ? `检测到并发状态冲突：${detail}` : detail,
      })
    }
    finally { setBusy(false) }
  }

  const consult = () => run(async () => {
    if (worldReleaseId == null) throw new Error('请先发布一个 WorldRelease。')
    const result = await consultGameProductionStartV1({ scope: props.scope, worldReleaseId })
    setSuggestions(result.suggestions)
    setSourceOptions(result.sourceOptions)
    setSelectionDefaults(result.selectionDefaults)
    const preferred = result.suggestions.find(item => item.recommendedProductTypes.includes(productType)) ?? result.suggestions[0]
    setSuggestionKey(preferred?.suggestionKey ?? '')
    setSourceSelection(preferred ? structuredClone(result.selectionDefaults[preferred.suggestionKey]) : null)
    // 起点建议只补空值。作者在分析前已输入的标题、主角、规模和目标是本轮
    // 生产的最高优先级指令，不能被“推荐项”静默替换。
    setTitle(current => current.trim() ? current : preferred?.title ? `${preferred.title} · 游戏` : '新的世界游戏')
    setOpeningSituation(current => current.trim() ? current : preferred?.openingConflict ?? '')
    setPlayerRole(current => current.trim()
      ? current
      : preferred?.protagonistRefs.length ? '扮演所选主角' : '扮演世界中的行动者')
    setDraft(null)
    setMessage(productType === 'ttrpg'
      ? await ttrpgWorldSourceAlignmentMessageV1({ scope: props.scope, worldReleaseId })
      : `已从冻结世界版本生成 ${result.suggestions.length} 个可追溯起点；尚未开始制作。`)
  }, '分析世界并生成起点建议')

  const compileBrief = () => run(async () => {
    if (worldReleaseId == null || !suggestionKey) throw new Error('请选择 WorldRelease 与游戏起点。')
    const next = await compileGameProductionBriefV3({
      scope: props.scope, worldReleaseId, suggestionKey, productType, qualityProfile,
      scale, visualLevel, audioLevel, playerRole, openingSituation,
      coreExperience: openingSituation ? ['有后果的选择', openingSituation] : undefined,
      requiredFacts: nonEmptyLines(requiredFactsText),
      forbiddenChanges: nonEmptyLines(forbiddenChangesText),
      contentBoundaries: nonEmptyLines(contentBoundariesText),
      confirmTtrpgDefaultMappings: productType === 'ttrpg' && confirmTtrpgDefaultMappings,
      ttrpg: productType === 'ttrpg' ? toTtrpgProductionBriefDraftInputV2({
        value: ttrpgWizard,
        sourceOptions,
        sourceSelection,
        openingSituation,
      }) : undefined,
      sourceSelection: sourceSelection ?? undefined,
    })
    setDraft(next)
    setMessage(next.unresolvedDecisionKeys.length
      ? `Brief 仍有 ${next.unresolvedDecisionKeys.length} 项需要作者决定。`
      : '严格 Brief 已生成。检查范围、媒资和完成合同后再保存。')
  }, '编译 Brief')

  const generateAiCampaignProposals = (sections?: TtrpgCampaignProposalSectionV2[]) => run(async () => {
    if (!draft?.ttrpg || draft.intent.productType !== 'ttrpg') throw new Error('请先编译 TTRPG Brief。')
    const sourceHash = draft.source.worldContentHash
    setCampaignProposalRunning(true)
    try {
      const result = await generateTtrpgCampaignProposalCandidateV2({
        scope: props.scope,
        worldReleaseId: draft.source.worldReleaseId,
        objective: draft.ttrpg.naturalLanguageInstruction,
        seed: {
          title: draft.ttrpg.campaign.title,
          background: draft.ttrpg.campaign.background,
          coreConflict: draft.ttrpg.campaign.coreConflict,
          opening: draft.ttrpg.story.openingScene,
          structure: draft.ttrpg.story.structure,
        },
        aiConfig,
        priorDesign: draft.ttrpg.campaignDesign,
        regenerateSections: sections,
      })
      setDraft(current => {
        if (!current?.ttrpg || current.source.worldContentHash !== sourceHash) return current
        return {
          ...current,
          ttrpg: { ...current.ttrpg, campaignDesign: result.design },
          unresolvedDecisionKeys: [...new Set([
            ...current.unresolvedDecisionKeys.filter(key => key !== 'ttrpg-campaign-proposal-selection'),
            'ttrpg-campaign-proposal-selection',
          ])],
        }
      })
      setMessage(`AI 已${sections?.length ? `定向重生成 ${sections.join('、')}` : '重生成全部未锁定分区'}，并保留 ${result.candidate.preservedSections.length} 个分区（Run #${result.candidate.runId}）；请重新检查并确认。`)
    } finally {
      setCampaignProposalRunning(false)
    }
  }, '生成 AI 战役提案')

  const saveBrief = () => run(async () => {
    if (!draft || worldReleaseId == null || !title.trim()) throw new Error('请先生成 Brief 并填写游戏标题。')
    const productionId = await createGameProductionWithBriefV1({
      scope: props.scope, worldReleaseId, title, brief: draft,
    })
    setSuggestions([]); setDraft(null)
    await refresh(productionId)
    setMessage('Production 与 Brief revision 已保存；未授权前不会创建 Build 或调用生成能力。')
  }, '保存 Brief revision')

  const startProduction = async (productionId: number) => {
    if (productionRunningRef.current) {
      queuedProductionIdRef.current = productionId
      return
    }
    productionRunningRef.current = true
    const controller = new AbortController()
    productionAbort.current = controller
    setProductionRunning(true); setError(''); setMessage('正在复用“设置”中的全局 AI 配置，自动执行内容、视觉、装配和质量门。')
    setCommandActivity({ label: '执行 Build DAG', status: 'pending', detail: '调度器正在写入 checkpoint 与 task receipt…' })
    try {
      const result = await runAuthorizedGameProductionV1({
        scope: props.scope, productionId, signal: controller.signal,
        onProgress: next => {
          if (selectedProductionIdRef.current === productionId) setProgress(next)
        },
      })
      if (selectedProductionIdRef.current === productionId) {
        setProgress(result)
        await refresh(productionId)
        setCommandActivity({ label: '执行 Build DAG', status: 'succeeded', detail: `Build ${result.buildStatus}，持久化投影已复验。` })
        setMessage(result.buildStatus === 'release-ready'
          ? '自动制作完成：Build 已通过硬门与媒资覆盖门，可以预览并原子发布。'
          : result.buildStatus === 'preview-ready'
            ? '自动制作完成：Build 已可试玩；商业候选需完成真实浏览器性能、主路线试玩以及所需媒资自动解码回执后才可发布。'
            : '调度已停在可恢复边界；请查看任务状态和阻塞原因。')
      }
    } catch (cause) {
      if (selectedProductionIdRef.current === productionId) {
        if (!controller.signal.aborted) {
          const detail = cause instanceof Error ? cause.message : String(cause)
          setError(detail)
          setCommandActivity({ label: '执行 Build DAG', status: 'conflict', detail })
        }
        await refresh(productionId).catch(() => undefined)
      }
    } finally {
      if (productionAbort.current === controller) productionAbort.current = null
      productionRunningRef.current = false
      setProductionRunning(false)
      const queuedProductionId = queuedProductionIdRef.current
      queuedProductionIdRef.current = null
      if (queuedProductionId != null) queueMicrotask(() => { void startProduction(queuedProductionId) })
    }
  }

  // “开始制作”是持续有效的作者命令，不是只存在于当前组件生命周期的点击事件。
  // 切页、刷新或浏览器崩溃后，只要 durable Production/Build 仍处于可执行态，
  // 工作台就从 checkpoint 自动续跑；pause/stop 会先改变持久状态和 epoch，因而不会命中这里。
  useEffect(() => {
    const productionId = details?.production.id
    const productionStatus = details?.production.status
    const buildStatus = details?.build?.status
    if (productionId == null || !shouldAutoContinueGameProductionV1({
      productionStatus: productionStatus ?? null,
      buildStatus: buildStatus ?? null,
      running: productionRunningRef.current,
    })) return
    void startProduction(productionId)
  }, [details?.production.id, details?.production.status, details?.build?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const authorize = () => run(async () => {
    if (!details) throw new Error('缺少当前 Production。')
    const productionId = details.production.id!
    await authorizeGameProductionStartV1({ scope: props.scope, details })
    await refresh(productionId)
    setMessage('作者授权已记录，Build 已创建；系统将自动开始制作。')
  }, '授权并开始制作')

  const build = () => {
    if (!details?.production.id) throw new Error('缺少 Production。')
    void startProduction(details.production.id)
  }

  const pauseOrResume = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    if (details.production.status !== 'paused') {
      queuedProductionIdRef.current = null
      productionAbort.current?.abort('author-paused')
    }
    const result = await setGameProductionPausedV1({ scope: props.scope, production: details.production })
    await refresh(details.production.id)
    setMessage(result === 'resumed' ? 'Build 已恢复；旧执行者仍因 epoch 变化而无法写入。' : 'Build 已暂停并递增 control epoch。')
  }, details?.production.status === 'paused' ? '恢复制作' : '暂停制作')

  const stop = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    queuedProductionIdRef.current = null
    productionAbort.current?.abort('author-stopped')
    await stopGameProductionV1({ scope: props.scope, production: details.production })
    await refresh(details.production.id)
    setMessage('Production 已停止，未发布产物保留用于审计。')
  }, '停止制作')

  const archiveOrRestore = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const restoring = details.production.status === 'archived'
    if (restoring) await restoreArchivedGameProductionV1({ scope: props.scope, production: details.production })
    else await archiveGameProductionV1({ scope: props.scope, production: details.production })
    await refresh(details.production.id)
    setMessage(restoring
      ? 'Production 已从归档元数据恢复；旧 Build、Release、receipt 和存档引用保持原 hash。'
      : 'Production 已归档；这是可恢复状态，不会删除 Build、Release、receipt 或媒资 Blob。')
  }, details?.production.status === 'archived' ? '恢复归档' : '归档 Production')

  const publish = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    if (selectedBrief?.intent.productType === 'ttrpg') {
      throw new Error('当前跑团 Build 属于上层开发预览；正式世界适配完成前不能发布为商业 GameRelease。')
    }
    const { prepared, receipt } = await publishGameProductionV1({
      scope: props.scope, productionId: details.production.id!,
    })
    await refresh(details.production.id)
    setMessage(`GameRelease v${receipt.releaseVersion} 已原子发布；玩家端读取同一 RuntimePackage。`)
    props.onPublished?.(prepared.productType as SupportedProduct)
  }, '原子发布')

  const preview = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const opened = await startGameProductionPreviewV1({
      scope: props.scope, productionId: details.production.id!, worldGroupId: props.worldGroupId ?? null,
    })
    setMessage(`已从未发布 Build #${details.build?.buildNumber} 创建独立预览存档；正式表和 Release 均未改变。`)
    props.onPreviewStarted?.(opened.productType, opened.sessionId)
  }, '启动 Build Preview')

  const confirmMainRoutePlaythrough = () => run(async () => {
    if (!details?.build) throw new Error('缺少当前 Build。')
    const candidate = completedPlaythroughs[0]
    if (!candidate) throw new Error('请先试玩当前未发布 Build 并到达一个结局。')
    const userAgent = navigator.userAgent || 'unknown-browser'
    const browserName = /Edg\//.test(userAgent) ? 'edge'
      : /Chrome\//.test(userAgent) ? 'chromium'
        : /Firefox\//.test(userAgent) ? 'firefox'
          : /Safari\//.test(userAgent) ? 'safari' : 'browser'
    await recordGameBuildMainRoutePlaythroughV1({
      scope: props.scope,
      gameBuildId: details.build.id!,
      simulationSessionId: candidate.sessionId,
      authorConfirmation: 'author-confirmed-main-route',
      environment: {
        browserName,
        browserVersion: userAgent,
        platform: navigator.platform || 'desktop',
        viewport: {
          width: Math.max(1, window.innerWidth),
          height: Math.max(1, window.innerHeight),
        },
      },
    })
    await refresh(details.production.id)
    setMessage(`已确认主路线试玩：${candidate.choiceCount} 次选择到达结局 ${candidate.endingKey}，事件流与 Build hash 已冻结。`)
  }, '确认主路线试玩')

  const startBrowserPerformanceLab = async () => {
    if (!details?.build || !performanceLabHost.current) {
      setError('缺少当前 Build 或性能采样舞台。')
      return
    }
    const productionId = details.production.id!
    const buildId = details.build.id!
    const controller = new AbortController()
    performanceLabAbort.current?.abort('new-performance-run')
    performanceLabAbort.current = controller
    setPerformanceLabRunning(true); setPerformanceLabProgress(null); setError(''); setMessage('')
    setCommandActivity({ label: '30 分钟浏览器性能验收', status: 'pending', detail: '正在预热真实 Build 媒资与浏览器渲染舞台…' })
    try {
      const measurement = await runInAppBrowserPerformanceLabV1({
        scope: props.scope, gameBuildId: buildId, host: performanceLabHost.current,
        signal: controller.signal, onProgress: setPerformanceLabProgress,
      })
      const verified = await recordGameBrowserPerformanceMeasurementV1({
        scope: props.scope, gameBuildId: buildId, measurement,
      })
      await refresh(productionId)
      if (verified.gateReceipt.status !== 'passed') {
        const failures = verified.evidence.receipt.failures.join('、') || 'unknown'
        setCommandActivity({ label: '30 分钟浏览器性能验收', status: 'conflict', detail: `真实测量未通过：${failures}` })
        setMessage(`浏览器性能回执已冻结，但未通过：${failures}。`)
      } else {
        setCommandActivity({ label: '30 分钟浏览器性能验收', status: 'succeeded', detail: '真实浏览器回执已写入当前 Build 并完成 hash 复验。' })
        setMessage('30 分钟浏览器性能验收已通过；场景、输入、堆峰值和长期增长回执均已冻结。')
      }
    } catch (cause) {
      if (controller.signal.aborted) {
        setCommandActivity({ label: '30 分钟浏览器性能验收', status: 'conflict', detail: '验收已由用户停止；未写入通过回执。' })
        setMessage('浏览器性能验收已停止；当前 Build 和已有回执未改变。')
      } else {
        const detail = cause instanceof Error ? cause.message : String(cause)
        setError(detail)
        setCommandActivity({ label: '30 分钟浏览器性能验收', status: 'conflict', detail })
      }
    } finally {
      if (performanceLabAbort.current === controller) performanceLabAbort.current = null
      setPerformanceLabRunning(false)
    }
  }

  const stopBrowserPerformanceLab = () => {
    performanceLabAbort.current?.abort('author-stopped-performance-lab')
  }

  const evolve = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const created = await beginGameProductionEvolutionV1({
      scope: props.scope, productionId: details.production.id!, userText: evolutionGoal,
      affectedLanes: evolutionLanes,
    })
    setEvolutionGoal('')
    await refresh(details.production.id)
    setMessage(`演化目标已编译为 Brief r${created.briefRevision}；请审查后再次授权，系统会创建新 Build 并复用可证明未变的基础。`)
  }, '创建演化 Brief')

  const retryBlocker = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const productionId = details.production.id!
    await retryGameProductionBlockerV1({ scope: props.scope, details })
    await refresh(productionId)
    setMessage('重试已由作者确认；已完成产物会跨 epoch 复用，不会重复调用。')
  }, '重试阻塞任务')

  const selectedSuggestion = suggestions.find(item => item.suggestionKey === suggestionKey) ?? null
  const canPause = details && ['producing', 'preview-ready'].includes(details.production.status)
    && details.build && !['released', 'cancelled', 'failed', 'archived', 'paused', 'recovery-required'].includes(details.build.status)
  const canEvolve = details && !['brief-ready', 'consulting', 'producing', 'paused'].includes(details.production.status)
    && (details.production.status === 'released'
      || !!details.build && ['preview-ready', 'release-ready', 'released'].includes(details.build.status))
  const canArchive = !!details && !['producing', 'paused', 'archived'].includes(details.production.status)
  const buildHashRows = useMemo(() => details?.build ? [
    ['Brief', details.build.briefHash], ['Plan', details.build.planHash], ['Package', details.build.packageHash],
    ['Manifest', details.build.manifestHash], ['Preview', details.build.previewHash], ['Quality', details.build.qualityReportHash],
  ] : [], [details?.build])
  const laneProgress = useMemo(() => {
    const lanes = new Map<string, { completed: number; total: number; running: number; blocked: number }>()
    for (const task of progress?.tasks ?? []) {
      const current = lanes.get(task.lane) ?? { completed: 0, total: 0, running: 0, blocked: 0 }
      current.total += 1
      if (task.status === 'completed') current.completed += 1
      if (task.status === 'running') current.running += 1
      if (task.status === 'blocked') current.blocked += 1
      lanes.set(task.lane, current)
    }
    return [...lanes.entries()].map(([lane, value]) => ({ lane, ...value }))
  }, [progress])
  const blockerSummary = details?.build?.status === 'recovery-required'
    ? buildFailureSummary(details.build.failureJson) : ''
  const compatibility = useMemo(
    () => compatibilityReport(details?.build?.compatibilityJson),
    [details?.build?.compatibilityJson],
  )
  const selectedBrief = useMemo(() => {
    try { return details?.brief ? JSON.parse(details.brief.briefJson) as GameProductionBriefV3 : null }
    catch { return null }
  }, [details?.brief])
  const commercialPerformanceRequired = selectedBrief?.qualityProfile === 'commercial-candidate'
  const commercialPerformancePassed = performanceGate?.gateReceipt.status === 'passed'
    && performanceGate.evidence.receipt.passed
  const commercialPlaythroughPassed = playthroughGate?.gateReceipt.status === 'passed'
  const commercialMediaRuntimeRequired = commercialPerformanceRequired
    && (selectedBrief?.media.requiredMediaKinds.length ?? 0) > 0
  const commercialMediaRuntimePassed = !commercialMediaRuntimeRequired
    || mediaRuntimeGate?.gateReceipt.status === 'passed' && mediaRuntimeGate.evidence.passed
  const commercialQualityPassed = commercialPerformancePassed
    && commercialPlaythroughPassed && commercialMediaRuntimePassed
  const capabilityReadiness = inspectGameProductionCapabilityReadinessV1({
    projectId: props.scope.projectId,
  })
  const requestedCommercialImageReady = qualityProfile !== 'commercial-candidate'
    || !['avg', 'ttrpg'].includes(productType) || (productType === 'ttrpg' ? ttrpgWizard.maximumGeneratedAssets === 0 : visualLevel === 'none')
    || capabilityReadiness.image.ready || capabilityReadiness.mediaRelayReady
  const requestedCommercialAudioReady = qualityProfile !== 'commercial-candidate'
    || productType !== 'avg' || audioLevel === 'none' || capabilityReadiness.mediaRelayReady
  const authorizationReadiness = useMemo(() => {
    if (!details?.brief) return null
    try {
      const brief = JSON.parse(details.brief.briefJson) as GameProductionBriefV3
      return evaluateGameProductionAuthorizationReadinessV1({ brief, readiness: capabilityReadiness })
    } catch {
      return {
        ready: false,
        blockerCode: 'capability-unbound' as const,
        blockerMessages: ['当前 Brief 无法解析，不能授权开工。'],
        requiredMediaRequirementKeys: [],
      }
    }
  }, [capabilityReadiness, details?.brief])

  return <div className="grid min-h-[720px] grid-cols-1 bg-bg-base text-text-primary lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="game-production-studio">
    <aside className="border-b border-border bg-bg-surface p-4 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-2"><div><small className="font-mono text-[9px] text-accent">GAME-PROD</small><h2 className="font-serif text-base">游戏制作</h2></div><button aria-label="刷新制作列表" onClick={() => void refresh()} className="rounded border border-border p-2 text-text-muted"><RefreshCw className="h-3.5 w-3.5" /></button></div>
      <button onClick={() => { setSelectedProductionId(null); setDetails(null); setSuggestions([]); setSourceOptions(null); setSelectionDefaults({}); setSourceSelection(null); setDraft(null); setMessage(''); setError('') }} className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent"><Plus className="h-3.5 w-3.5" />新建 Production</button>
      <div className="mt-4 grid gap-2">{productions.map(row => <button key={row.id} onClick={() => void refresh(row.id)} className={`rounded border p-3 text-left ${selectedProductionId === row.id ? 'border-accent bg-accent/10' : 'border-border bg-bg-base'}`}><strong className="block truncate text-xs">{row.title}</strong><span className="mt-1 flex items-center justify-between text-[9px] text-text-muted"><code>{row.productionKey}</code><em className="not-italic text-accent">{statusLabel(row.status)}</em></span></button>)}{productions.length === 0 && <p className="rounded border border-dashed border-border p-4 text-[10px] leading-relaxed text-text-muted">还没有 Production。会谈只读取冻结 WorldRelease，不会在后台自动开始制作。</p>}</div>
    </aside>
    <main className="min-w-0 p-5 md:p-8">
      {(message || error) && <div role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} className={`mb-5 flex items-start gap-2 rounded border p-3 text-xs ${error ? 'border-error/30 bg-error/5 text-error' : 'border-success/30 bg-success/5 text-success'}`}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || message}</span></div>}
      {commandActivity && <div role="status" aria-live="polite" data-testid="game-production-command-activity" className={`mb-5 rounded border p-3 text-[10px] ${commandActivity.status === 'succeeded' ? 'border-success/30 bg-success/5 text-success' : commandActivity.status === 'conflict' ? 'border-error/30 bg-error/5 text-error' : 'border-accent/30 bg-accent/5 text-accent'}`}><strong>{commandActivity.label} · {commandActivity.status === 'pending' ? 'pending' : commandActivity.status === 'succeeded' ? 'succeeded' : 'conflict / failed'}</strong><span className="mt-1 block">{commandActivity.detail}</span></div>}
      {(busy || productionRunning) && <div role="status" aria-live="polite" aria-busy="true" className="mb-5 flex items-center gap-2 text-xs text-accent"><Loader2 className="h-4 w-4 animate-spin" />{productionRunning ? '内容、视觉、音频、装配与质检正在按 DAG 自动推进…' : '正在执行受治理的制作步骤…'}</div>}
      {!details ? <>
        <header className="mb-6 border-b border-border pb-5"><small className="font-mono text-[9px] tracking-widest text-accent">CONSULT → BRIEF → AUTHORIZE</small><h1 className="mt-2 font-serif text-2xl">从冻结世界版本开始制作</h1><p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">先选择来源和起点，系统生成可审查 Brief。只有点击“保存 Brief”并再次“授权开始”后，才会创建 Build。</p></header>
        <section className="grid gap-4 rounded border border-border bg-bg-elevated p-5 md:grid-cols-2">
          <label className="grid gap-2 text-[10px] text-text-muted">冻结 WorldRelease<select value={worldReleaseId ?? ''} onChange={event => { setWorldReleaseId(Number(event.target.value) || null); setSuggestions([]); setSourceOptions(null); setSelectionDefaults({}); setSourceSelection(null); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">{releases.map(release => <option key={release.id} value={release.id}>v{release.version} · {release.label}</option>)}</select></label>
          <label className="grid gap-2 text-[10px] text-text-muted">产品形态<select value={productType} onChange={event => { const next = event.target.value as SupportedProduct; setProductType(next); setVisualLevel(next === 'avg' || next === 'ttrpg' ? 'key-scenes' : 'none'); setAudioLevel(next === 'avg' ? 'music-sfx' : 'none'); setConfirmTtrpgDefaultMappings(false); setTtrpgWizard(createDefaultTtrpgProductionWizardValueV2()); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="storygame">分支叙事</option><option value="character-interaction">角色互动</option><option value="text-adventure">文字冒险</option><option value="avg">轻量 AVG（含媒资）</option><option value="narrative-simulation">叙事模拟</option><option value="text-open-world">文字开放世界</option><option value="ttrpg">跑团 CampaignPack（上层开发）</option></select><span>{productType === 'ttrpg' ? '可以完成 Brief、规则、战役、媒资和试玩 Build；正式世界适配与商业发布留到世界出口稳定后接入。' : '六类文字游戏继续使用各自现有适配器；本次施工不替它们建立公共生产协议。'}</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">制作质量<select value={qualityProfile} onChange={event => { setQualityProfile(event.target.value as GameProductionBriefV3['qualityProfile']); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="prototype">原型 · 内置占位素材</option><option value="internal">内部评审 · Agnes 就绪则生成图片</option><option value="commercial-candidate">商业候选 · 生成正式图片并完成质量门</option></select><span>始终复用“设置”中的全局 AI 配置。Agnes 文字与图片共用同一个 API Key，图片自动切换到专用模型，不会要求你再次填写。</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">游戏标题<input value={title} onChange={event => setTitle(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" placeholder="会谈后可修改" /></label>
          <div className={`rounded border p-3 text-[10px] leading-5 md:col-span-2 ${capabilityReadiness.text.ready && requestedCommercialImageReady && requestedCommercialAudioReady ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`} data-testid="game-production-capability-readiness"><strong className="block text-xs">{capabilityReadiness.text.ready ? '文本生成能力已就绪' : '文本生成能力未就绪'}</strong><span>{capabilityReadiness.text.ready ? `将直接复用 ${capabilityReadiness.text.provider} / ${capabilityReadiness.text.model}，无需再次填写 API Key。` : capabilityReadiness.text.issue}</span>{['avg', 'ttrpg'].includes(productType) && (productType === 'ttrpg' ? ttrpgWizard.maximumGeneratedAssets > 0 : visualLevel !== 'none') && <span className="block">{capabilityReadiness.image.ready ? `图片能力已就绪：复用同一 Agnes Key，自动调用 ${capabilityReadiness.image.model}。` : capabilityReadiness.mediaRelayReady ? `Agnes 图片不可用，将使用已绑定媒体中继${capabilityReadiness.mediaRelayOrigin ? `：${capabilityReadiness.mediaRelayOrigin}` : ''}。` : capabilityReadiness.image.issue}</span>}{productType === 'avg' && audioLevel !== 'none' && <span className="block">{capabilityReadiness.mediaRelayReady ? `音乐与音效能力已绑定${capabilityReadiness.mediaRelayOrigin ? `：${capabilityReadiness.mediaRelayOrigin}` : ''}。` : 'Agnes 当前公开接口未提供独立音乐/SFX 生成；选择商业音频时仍需绑定音频能力，或改为静音。'}</span>}</div>
          <label className="grid gap-2 text-[10px] text-text-muted">玩家身份 / 主角<input value={playerRole} maxLength={300} onChange={event => { setPlayerRole(event.target.value); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" placeholder="例如：扮演港口守灯人；或与某角色同行" /></label>
          <label className="grid gap-2 text-[10px] text-text-muted">游戏规模<select value={scale} onChange={event => { setScale(event.target.value as GameProductionScaleV1['scope']); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="scene">单场景 · 约 15 分钟</option><option value="short-arc">短篇支线</option><option value="chapter">完整章节</option><option value="multi-chapter">多章节</option><option value="campaign">长线战役</option></select></label>
          <label className="grid gap-2 text-[10px] text-text-muted md:col-span-2">你想玩的第一幕与核心目标<textarea value={openingSituation} maxLength={2000} rows={4} onChange={event => { setOpeningSituation(event.target.value); setDraft(null) }} className="rounded border border-border bg-bg-base p-3 text-xs text-text-primary" placeholder="例如：主角在港口封锁前收到失踪导师的信号，必须决定先救人还是公开真相。" /><span>这是后续内容、美术和音频拆分共同遵守的用户目标，不会被 Agent 自行替换。</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">视觉目标<select disabled={!['avg', 'ttrpg'].includes(productType)} value={visualLevel} onChange={event => { setVisualLevel(event.target.value as 'none' | 'key-scenes'); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary disabled:opacity-50"><option value="none">纯文字</option><option value="key-scenes">关键场景 + 角色素材</option></select><span>{productType === 'avg' || productType === 'ttrpg' ? qualityProfile === 'prototype' ? '内容会自主拆分美术需求；原型档使用明确标记的安全占位素材。' : '内容拆分需求后，直接复用全局图片能力并行制作并接入玩家界面。' : '当前产品以专用文字舞台为主。'}</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">音频目标<select disabled={productType !== 'avg'} value={audioLevel} onChange={event => { setAudioLevel(event.target.value as 'none' | 'music-sfx'); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary disabled:opacity-50"><option value="none">静音</option><option value="music-sfx">主题音 + 关键音效</option></select><span>{audioLevel === 'music-sfx' ? qualityProfile === 'commercial-candidate' ? '音乐与音效需要独立音频能力，并和内容、美术并行，完成后自动接入 Cue。' : '音频与内容、美术并行；未绑定外部音频时使用明确标记的程序化 WAV。' : '不制作音频，游戏仍可完整通关。'}</span></label>
          {productType === 'ttrpg' && <><TtrpgProductionWizard scope={props.scope} value={ttrpgWizard} sourceOptions={sourceOptions} sourceSelection={sourceSelection} onChange={next => { setTtrpgWizard(next); setConfirmTtrpgDefaultMappings(next.confirmAll); setDraft(null) }} /><label className="flex items-start gap-2 rounded border border-border bg-bg-base p-3 text-[10px] leading-5 text-text-muted md:col-span-2"><input type="checkbox" checked={confirmTtrpgDefaultMappings} onChange={event => { setConfirmTtrpgDefaultMappings(event.target.checked); setTtrpgWizard(current => ({ ...current, confirmAll: event.target.checked })); setDraft(null) }} className="mt-1" /><span><strong className="block text-xs text-text-primary">确认第一方规则默认映射</strong>同时确认九步向导末页列出的世界边界、规则许可、AI 身份披露和媒资权利；未确认时 Brief 保持阻塞。</span></label></>}
          <details className="rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted md:col-span-2"><summary className="cursor-pointer text-xs text-text-primary">内容边界与世界约束（可选）</summary><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="grid gap-1">必须保留的事实<textarea rows={3} value={requiredFactsText} onChange={event => { setRequiredFactsText(event.target.value); setDraft(null) }} placeholder="每行一项" className="rounded border border-border bg-bg-elevated p-2" /></label><label className="grid gap-1">禁止改变<textarea rows={3} value={forbiddenChangesText} onChange={event => { setForbiddenChangesText(event.target.value); setDraft(null) }} placeholder="每行一项" className="rounded border border-border bg-bg-elevated p-2" /></label><label className="grid gap-1">内容边界<textarea rows={3} value={contentBoundariesText} onChange={event => { setContentBoundariesText(event.target.value); setDraft(null) }} placeholder="每行一项" className="rounded border border-border bg-bg-elevated p-2" /></label></div></details>
          {productType === 'ttrpg' && <div className="rounded border border-warning/30 bg-warning/5 p-3 text-[10px] leading-5 text-warning md:col-span-2" data-testid="ttrpg-upper-layer-development-gate"><strong className="block text-xs">跑团上层开发模式</strong><span>当前来源只作为冻结测试输入。允许生成、保存、制作和试玩 Build；不会把它冒充最终世界对接，也不会发布为商业 GameRelease。</span></div>}
          <div className="flex flex-wrap gap-2 md:col-span-2"><button disabled={busy || worldReleaseId == null} onClick={consult} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />分析可玩起点</button>{suggestionKey && <button disabled={busy || !openingSituation.trim() || !playerRole.trim()} onClick={compileBrief} className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent disabled:opacity-40"><FileCheck2 className="h-3.5 w-3.5" />生成严格 Brief</button>}{draft && <button disabled={busy || !title.trim()} onClick={saveBrief} className="flex items-center gap-2 rounded border border-success/40 bg-success/10 px-4 py-2 text-xs text-success"><ShieldCheck className="h-3.5 w-3.5" />保存 Brief revision</button>}</div>
        </section>
        {suggestions.length > 0 && <section className="mt-5">
          <h2 className="mb-3 text-sm font-semibold">可追溯起点</h2>
          <div className="grid gap-3 md:grid-cols-2">{suggestions.map(item => <button key={item.suggestionKey} onClick={() => {
            setSuggestionKey(item.suggestionKey)
            setSourceSelection(structuredClone(selectionDefaults[item.suggestionKey]))
            setOpeningSituation(current => current.trim() ? current : item.openingConflict)
            setPlayerRole(current => current.trim() ? current : item.protagonistRefs.length ? '扮演所选主角' : '扮演世界中的行动者')
            setDraft(null)
            setTitle(current => current.trim() ? current : `${item.title} · 游戏`)
          }} className={`rounded border p-4 text-left ${item.suggestionKey === suggestionKey ? 'border-accent bg-accent/10' : 'border-border bg-bg-elevated'}`}><span className="flex justify-between gap-2"><strong className="text-sm">{item.title}</strong><code className="text-[9px] text-accent">{item.kind}</code></span><p className="mt-2 text-[10px] leading-5 text-text-muted">{item.rationale}</p><small className="mt-2 block text-[9px] text-text-muted">来源 {item.sourceRefs.join('、') || '自定义'} · 建议规模 {item.scale}</small></button>)}</div>
          {sourceOptions && sourceSelection && <details className="mt-4 rounded border border-border bg-bg-elevated p-4" data-testid="game-production-source-selector">
            <summary className="cursor-pointer text-xs font-semibold">编辑本次进入游戏的冻结素材</summary>
            <p className="mt-2 text-[10px] leading-5 text-text-muted">这里只能勾选当前 WorldRelease 通过中立网关公开的语义资源；取消资源不会删除世界数据。</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">{SOURCE_SELECTION_FACETS.map(([optionField, selectionField, label]) => {
              const options = sourceOptions[optionField]
              if (options.length === 0) return null
              const selectedIds = new Set(sourceSelection[selectionField])
              return <fieldset key={selectionField} className="rounded border border-border bg-bg-base p-3">
                <legend className="px-1 text-[10px] font-semibold">{label} · {selectedIds.size}/{options.length}</legend>
                <div className="mt-2 max-h-44 space-y-2 overflow-auto">{options.map(option => <label key={option.resourceKey} className="flex items-start gap-2 text-[10px] text-text-muted" title={option.summary}>
                  <input type="checkbox" checked={selectedIds.has(option.resourceKey)} onChange={event => {
                    const checked = event.currentTarget.checked
                    setSourceSelection(current => {
                      if (!current) return current
                      const ids = new Set(current[selectionField])
                      if (checked) ids.add(option.resourceKey)
                      else ids.delete(option.resourceKey)
                      return { ...current, [selectionField]: [...ids].sort() }
                    })
                    setDraft(null)
                  }} className="mt-0.5" />
                  <span><strong className="block text-text-primary">{option.label}</strong>{option.summary && <small className="line-clamp-2">{option.summary}</small>}</span>
                </label>)}</div>
              </fieldset>
            })}</div>
            <button type="button" onClick={() => { setSourceSelection(structuredClone(selectionDefaults[suggestionKey])); setDraft(null) }} className="mt-4 rounded border border-border px-3 py-2 text-[10px] text-text-muted">恢复该起点的推荐素材</button>
          </details>}
        </section>}
        {draft && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Brief v3 审查摘要</h2><code className="text-[9px] text-accent">{draft.intent.productType} / {draft.qualityProfile}</code></div><div className="mt-4 grid gap-3 text-[10px] md:grid-cols-3"><article className="rounded bg-bg-base p-3"><strong className="block text-xs">体验</strong><p className="mt-1 text-text-muted">{draft.intent.openingSituation}</p></article><article className="rounded bg-bg-base p-3"><strong className="block text-xs">规模</strong><p className="mt-1 text-text-muted">{draft.scale.targetPlayMinutes} 分钟 · {draft.scale.targetEndingCount} 结局</p></article><article className="rounded bg-bg-base p-3"><strong className="block text-xs">完成合同</strong><p className="mt-1 text-text-muted">可玩预览 · 媒资覆盖 {Math.round(draft.completionContract.minimumMediaCoverage * 100)}%</p></article></div>{selectedSuggestion && <p className="mt-4 text-[10px] text-text-muted">起点冲突：{selectedSuggestion.openingConflict}</p>}<p className="mt-2 text-[10px] text-text-muted" data-testid="game-production-source-selection-summary">本次通过世界网关冻结 {draft.source.selection.resourceKeys.length} 项语义资源（{frozenSourceFacetSummary(draft, sourceOptions)}）；上层叙事、媒资和运行状态均由产品 Build 自己拥有。</p></section>}
        {draft?.ttrpg?.campaignDesign && <TtrpgCampaignProposalSelector
          value={draft.ttrpg.campaignDesign}
          aiGenerating={campaignProposalRunning}
          aiReady={isAIConfigReady(resolveRequestConfig(aiConfig, {
            category: 'authoring.ttrpg-campaign', projectId: props.scope.projectId,
          }).config)}
          onGenerateAi={(sections) => void generateAiCampaignProposals(sections)}
          onChange={(campaignDesign) => setDraft(current => current?.ttrpg ? {
          ...current,
          ttrpg: { ...current.ttrpg, campaignDesign },
          unresolvedDecisionKeys: campaignDesign.selection.confirmed
            ? current.unresolvedDecisionKeys.filter(key => key !== 'ttrpg-campaign-proposal-selection')
            : [...new Set([...current.unresolvedDecisionKeys, 'ttrpg-campaign-proposal-selection'])],
        } : current)} />}
      </> : <>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div><small className="font-mono text-[9px] tracking-widest text-accent">{details.production.productionKey}</small><h1 className="mt-2 font-serif text-2xl">{details.production.title}</h1><p className="mt-2 text-xs text-text-muted">Production {statusLabel(details.production.status)} · revision {details.production.stateRevision} · epoch {details.production.controlEpoch}</p></div>
          <div className="flex flex-wrap gap-2">
            <button aria-label="刷新当前 Production" disabled={busy} onClick={() => void refresh(details.production.id)} className="rounded border border-border p-2 text-text-muted"><RefreshCw className="h-4 w-4" /></button>
            {details.production.status === 'paused' && <button disabled={busy} onClick={pauseOrResume} className="flex items-center gap-2 rounded border border-accent/40 px-3 py-2 text-xs text-accent"><Play className="h-3.5 w-3.5" />恢复并继续</button>}
            {canPause && <button disabled={busy} onClick={pauseOrResume} title="停止领取新任务；已完成产物与预算回执保留" className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs"><CirclePause className="h-3.5 w-3.5" />暂停</button>}
            {details.production.status !== 'archived' && details.build && !['released', 'cancelled'].includes(details.build.status) && <button disabled={busy} onClick={stop} title="取消当前未发布 Build；已完成产物保留用于审计" className="flex items-center gap-2 rounded border border-error/30 px-3 py-2 text-xs text-error"><Square className="h-3.5 w-3.5" />停止</button>}
            {details.production.status === 'archived' ? <button disabled={busy} onClick={archiveOrRestore} className="flex items-center gap-2 rounded border border-accent/40 px-3 py-2 text-xs text-accent"><ArchiveRestore className="h-3.5 w-3.5" />恢复归档</button> : canArchive && <button disabled={busy} onClick={archiveOrRestore} title="可恢复归档；不会删除 Build、Release、存档或媒资" className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-muted"><Archive className="h-3.5 w-3.5" />归档</button>}
          </div>
        </header>
        <section className="mt-5 grid gap-3 md:grid-cols-4"><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">BRIEF</small><strong className="mt-1 block text-sm">{details.brief ? `r${details.brief.revision} · ${statusLabel(details.brief.status)}` : '未建立'}</strong></article><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">BUILD</small><strong className="mt-1 block text-sm">{details.build ? `#${details.build.buildNumber} · ${statusLabel(details.build.status)}` : '等待授权'}</strong></article><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">ARTIFACTS</small><strong className="mt-1 block text-sm">{details.artifactCount} 个版本</strong></article><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">RELEASE</small><strong className="mt-1 block text-sm">{details.production.currentGameReleaseId ? `#${details.production.currentGameReleaseId}` : '未发布'}</strong></article></section>
        <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><h2 className="text-sm font-semibold">下一步</h2><p className="mt-2 text-[10px] leading-5 text-text-muted">一次作者授权会启动整套自动制作；正式文本任务直接复用“设置”里的全局 AI 配置，不另收 API Key。每一步都有 CAS、scope、epoch 和 hash 复验。</p>{selectedBrief?.intent.productType === 'ttrpg' && <div className="mt-3 rounded border border-warning/30 bg-warning/5 p-3 text-[10px] text-warning"><strong className="block">跑团 Build 仅供上层开发与试玩</strong><span className="mt-1 block">规则、战役、角色、媒资和运行验证可以继续；最终世界适配完成前不开放正式发布。</span></div>}{details.production.status === 'brief-ready' && authorizationReadiness && !authorizationReadiness.ready && <div className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error" data-testid="game-production-authorization-blocker"><strong className="block">能力未绑定，尚未创建 Build</strong><span className="mt-1 block">{authorizationReadiness.blockerMessages.join('；')}</span></div>}{details.build?.status === 'recovery-required' && <div className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error"><strong className="block">自动制作停在可恢复边界</strong><span className="mt-1 block">{blockerSummary || '执行能力返回失败；可检查全局 AI 配置后重试。'}</span></div>}<div className="mt-4 flex flex-wrap gap-2">{details.production.status === 'brief-ready' && <button disabled={busy || productionRunning || authorizationReadiness?.ready !== true} onClick={authorize} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" />作者授权并开始自动制作</button>}{details.build && ['authorized', 'building'].includes(details.build.status) && !productionRunning && <button disabled={busy} onClick={build} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white"><PackageCheck className="h-3.5 w-3.5" />继续自动制作</button>}{details.build?.status === 'recovery-required' && <button disabled={busy || productionRunning} onClick={retryBlocker} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white"><RefreshCw className="h-3.5 w-3.5" />修正配置后重试</button>}{details.build && ['preview-ready', 'release-ready', 'released'].includes(details.build.status) && <button disabled={busy || productionRunning} onClick={preview} className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent"><Play className="h-3.5 w-3.5" />{details.build.status === 'released' ? '试玩此 Build' : '试玩未发布 Build'}</button>}{details.build?.status === 'release-ready' && <button disabled={busy || productionRunning || selectedBrief?.intent.productType === 'ttrpg' || (commercialPerformanceRequired && !commercialQualityPassed)} title={selectedBrief?.intent.productType === 'ttrpg' ? '最终世界适配完成前只允许试玩 Build' : undefined} onClick={publish} className="flex items-center gap-2 rounded bg-success px-4 py-2 text-xs text-white disabled:opacity-40"><Rocket className="h-3.5 w-3.5" />{selectedBrief?.intent.productType === 'ttrpg' ? '正式发布等待最终对接' : '复验并原子发布'}</button>}{details.production.status === 'released' && <button disabled={busy} onClick={() => props.onPublished?.((details.brief ? JSON.parse(details.brief.briefJson).intent.productType : 'storygame') as SupportedProduct)} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white"><Gamepad2 className="h-3.5 w-3.5" />进入玩家模式</button>}</div></section>
        {progress && progress.tasks.length > 0 && <section aria-live="polite" className="mt-5 rounded border border-border bg-bg-elevated p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">自动制作任务</h2><code className="text-[9px] text-text-muted">Build #{progress.buildNumber} · epoch {progress.controlEpoch}</code></div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid="game-production-lane-progress">{laneProgress.map(lane => {
            const percent = lane.total ? Math.round(lane.completed / lane.total * 100) : 0
            return <article key={lane.lane} className="rounded border border-border bg-bg-base p-3">
              <span className="flex items-center justify-between text-[10px]"><strong>{lane.lane}</strong><em className="not-italic text-text-muted">{lane.completed}/{lane.total}</em></span>
              <progress aria-label={`${lane.lane} 泳道进度`} className="mt-2 w-full" max={100} value={percent}>{percent}%</progress>
              <p className="mt-1 text-[9px] text-text-muted">运行 {lane.running} · 阻塞 {lane.blocked}</p>
            </article>
          })}</div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4" data-testid="game-production-budget-usage">
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">模型调用</span><strong className="mt-1 block">{progress.budget.usage.modelCalls} / {progress.budget.limits.maximumModelCalls}</strong></article>
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">媒资调用</span><strong className="mt-1 block">{progress.budget.usage.mediaCalls} / {progress.budget.limits.maximumMediaCalls}</strong></article>
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">成本</span><strong className="mt-1 block">{progress.budget.usage.costUsd == null ? '供应商未回传' : `$${progress.budget.usage.costUsd.toFixed(4)}`} / {progress.budget.limits.maximumCostUsd == null ? '未设金额上限' : `$${progress.budget.limits.maximumCostUsd.toFixed(2)}`}</strong></article>
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">持久化媒资</span><strong className="mt-1 block">{formatBytes(progress.budget.usage.storageBytes)} / {formatBytes(progress.budget.limits.maximumStorageBytes)}</strong></article>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{progress.tasks.map(task => <article key={task.taskKey} className="rounded border border-border bg-bg-base p-3"><span className="flex items-center justify-between gap-2"><strong className="text-[10px]">{task.taskKey}</strong><em className={`not-italic text-[9px] ${task.status === 'completed' ? 'text-success' : task.status === 'blocked' ? 'text-error' : 'text-accent'}`}>{statusLabel(task.status)}</em></span><p className="mt-2 text-[9px] text-text-muted">{task.lane} · attempt {task.attempt || '—'}{task.blocker ? ` · ${task.blocker}` : ''}</p></article>)}</div>
        </section>}
        {canEvolve && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-accent" /><h2 className="text-sm font-semibold">继续演化下一版</h2></div><p className="mt-2 text-[10px] leading-5 text-text-muted">描述希望增加、延续或改变的体验。旧 Build、Release 和存档不会被改写；提交后先生成新的可审查 Brief，不会直接调用模型。</p><textarea value={evolutionGoal} onChange={event => setEvolutionGoal(event.target.value)} maxLength={2000} rows={4} placeholder="例如：从当前结局继续，让配角成为新主角，增加一条调查旧港失踪案的支线，并保留已经发生的选择后果。" className="mt-4 w-full rounded border border-border bg-bg-base p-3 text-xs text-text-primary" /><fieldset className="mt-3 flex flex-wrap gap-3 text-[10px] text-text-muted"><legend className="mb-2">本轮影响范围（未勾选且依赖未变化的产物可复用）</legend>{([['content', '剧情内容'], ['product', '玩法模块'], ['visual', '美术'], ['audio', '音乐/音效']] as const).map(([lane, label]) => <label key={lane} className="flex items-center gap-1.5"><input type="checkbox" checked={evolutionLanes.includes(lane)} onChange={event => setEvolutionLanes(current => event.target.checked ? [...new Set([...current, lane])] : current.filter(item => item !== lane))} />{label}</label>)}</fieldset><button disabled={busy || productionRunning || !evolutionGoal.trim() || evolutionLanes.length === 0} onClick={evolve} className="mt-3 flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent disabled:opacity-40"><GitBranch className="h-3.5 w-3.5" />生成下一轮 Brief</button></section>}
        {compatibility && <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="game-production-compatibility"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">存档兼容报告</h2><strong className={`text-[10px] ${compatibility.level === 'compatible' ? 'text-success' : compatibility.level === 'breaking' ? 'text-error' : 'text-accent'}`}>{compatibility.level === 'compatible' ? '可兼容' : compatibility.level === 'breaking' ? '破坏性变化' : '建议重开'}</strong></div><p className="mt-2 text-[10px] leading-5 text-text-muted">{compatibility.fromBuildNumber == null ? '首个 Build，无旧存档需要迁移。' : `Build #${compatibility.fromBuildNumber} → #${compatibility.toBuildNumber} · ${compatibility.migrationPolicy}`}</p><ul className="mt-3 grid gap-1 text-[10px] text-text-muted">{compatibility.reasons.map(reason => <li key={reason}>· {reason}</li>)}</ul>{compatibility.level === 'breaking' && <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">旧存档继续固定在旧 packageHash；系统不会静默迁移或覆盖。</p>}</section>}
        <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="game-production-version-history">
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">版本 lineage 与命令回执</h2><span className="text-[9px] text-text-muted">刷新后仍来自 IndexedDB 权威投影</span></div>
          <div className="mt-4 grid gap-2 lg:grid-cols-2">
            <div><h3 className="text-[10px] font-semibold">Brief / Build / Release</h3><div className="mt-2 grid gap-2">{details.buildHistory.map(buildRow => <article key={buildRow.id} className="rounded bg-bg-base p-3 text-[10px]"><span className="flex items-center justify-between"><strong>Build #{buildRow.buildNumber}</strong><em className="not-italic text-accent">{statusLabel(buildRow.status)}</em></span><p className="mt-1 text-text-muted">Brief r{buildRow.briefRevision} · parent {buildRow.parentBuildNumber == null ? '—' : `#${buildRow.parentBuildNumber}`} · Release {buildRow.releasedGameReleaseId == null ? '—' : `#${buildRow.releasedGameReleaseId}`}</p><code className="mt-1 block" title={buildRow.packageHash}>{compactHash(buildRow.packageHash)}</code></article>)}</div></div>
            <div><h3 className="text-[10px] font-semibold">最近命令 receipt</h3><div className="mt-2 grid gap-2">{details.recentCommands.map(command => <article key={command.id} className="rounded bg-bg-base p-3 text-[10px]"><span className="flex items-center justify-between"><strong>{command.type}</strong><em className={`not-italic ${command.status === 'succeeded' ? 'text-success' : command.status === 'claimed' ? 'text-accent' : 'text-error'}`}>{command.status === 'claimed' ? 'pending' : command.status}</em></span><code className="mt-1 block text-text-muted" title={command.commandId}>{command.commandId}</code>{command.errorCode && <p className="mt-1 text-error">{command.errorCode}</p>}</article>)}{details.recentCommands.length === 0 && <p className="rounded border border-dashed border-border p-3 text-[10px] text-text-muted">尚无命令 receipt。</p>}</div></div>
          </div>
        </section>
        {details.build && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">冻结证据链</h2><span className="flex items-center gap-1 text-[9px] text-success"><ShieldCheck className="h-3.5 w-3.5" />Canonical JSON v2</span></div><p className="mt-3 text-[9px] leading-5 text-text-muted">商业浏览器验收：缓存场景 p95 ≤ {GAME_BROWSER_PERFORMANCE_POLICY_V1.maximumCachedSceneP95Ms}ms、选择输入 p95 ≤ {GAME_BROWSER_PERFORMANCE_POLICY_V1.maximumChoiceInputP95Ms}ms、桌面峰值堆内存 ≤ {Math.round(GAME_BROWSER_PERFORMANCE_POLICY_V1.maximumDesktopHeapBytes / 1024 / 1024)}MiB、30 分钟稳定增长 ≤ {Math.round(GAME_BROWSER_PERFORMANCE_POLICY_V1.maximumLongRunGrowthRatio * 100)}%。Smoke 不会被标成商业通过。</p>{performanceGateError ? <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">浏览器性能回执损坏：{performanceGateError}</p> : performanceGate ? <div className={`mt-3 rounded border p-3 text-[10px] ${performanceGate.gateReceipt.status === 'passed' ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`} data-testid="game-production-performance-receipt"><strong>{performanceGate.gateReceipt.status === 'passed' ? '真实浏览器性能已通过' : '最新浏览器测量未通过'}</strong><p className="mt-1">场景 p95 {performanceGate.evidence.receipt.metrics.cachedSceneP95Ms?.toFixed(1) ?? '—'}ms · 输入 p95 {performanceGate.evidence.receipt.metrics.choiceInputP95Ms?.toFixed(1) ?? '—'}ms · 峰值堆 {performanceGate.evidence.receipt.metrics.peakUsedHeapBytes == null ? '—' : `${(performanceGate.evidence.receipt.metrics.peakUsedHeapBytes / 1024 / 1024).toFixed(1)}MiB`} · 长跑 {(performanceGate.evidence.receipt.metrics.longRunDurationMs / 60_000).toFixed(1)} 分钟</p>{performanceGate.evidence.receipt.failures.length > 0 && <p className="mt-1">失败项：{performanceGate.evidence.receipt.failures.join('、')}</p>}<code className="mt-1 block">{compactHash(performanceGate.gateReceipt.receiptHash)}</code></div> : <p className="mt-3 rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted">当前 Build 尚无浏览器性能回执。</p>}<div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{buildHashRows.map(([label, hash]) => <div key={label} className="flex items-center justify-between rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">{label}</span><code title={hash}>{compactHash(hash)}</code></div>)}</div>{details.build.rootTerminalReceiptHash && <p className="mt-4 text-[10px] text-text-muted">终端 receipt：<code>{compactHash(details.build.rootTerminalReceiptHash)}</code></p>}</section>}
        {commercialPerformanceRequired && details.build && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><h2 className="text-sm font-semibold">作者主路线试玩回执</h2><p className="mt-2 text-[10px] leading-5 text-text-muted">这里不是“点一下算通过”：系统会重放当前 Build 预览存档的起点、每次选择和结局，再由作者明确确认。</p>{playthroughGateError ? <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">主路线回执无法验证：{playthroughGateError}</p> : playthroughGate ? <div className="mt-3 rounded border border-success/30 bg-success/5 p-3 text-[10px] text-success" data-testid="game-production-playthrough-receipt"><strong className="block">主路线试玩已由作者确认</strong><span className="mt-1 block">结局 {playthroughGate.evidence.endingKey} · {playthroughGate.evidence.choiceCount} 次选择 · 事件流 {compactHash(playthroughGate.evidence.eventStreamHash)}</span><code className="mt-1 block">{compactHash(playthroughGate.gateReceipt.receiptHash)}</code></div> : <p className="mt-3 rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted">{completedPlaythroughs.length > 0 ? `已检测到 ${completedPlaythroughs.length} 个到达结局的当前 Build 预览存档，等待作者确认。` : '尚未检测到当前 Build 的完整主路线试玩。'}</p>}</section>}
        {commercialPerformanceRequired && details.build?.status === 'preview-ready' && !commercialPerformancePassed && <section className="mt-5 rounded border border-error/30 bg-error/5 p-4 text-[10px] text-error" data-testid="game-production-performance-blocker">
          <strong className="block">商业发布等待真实浏览器性能验收</strong>
          <span className="mt-1 block">{performanceGateError || (performanceGate ? `最新回执未通过：${performanceGate.evidence.receipt.failures.join('、') || 'unknown'}。短时 smoke 不能解锁发布。` : '当前 Build 尚无浏览器性能回执。')}</span>
          <p className="mt-2 leading-5 text-text-muted">验收会加载当前 Build 的冻结媒资，执行至少 20 次真实 DOM 选择与缓存场景切换，并持续 30 分钟采集浏览器堆内存。请保持此页面与浏览器窗口打开；可随时停止，停止不会写入通过回执。</p>
          <div ref={performanceLabHost} className={`mt-3 ${performanceLabRunning ? 'block' : 'hidden'}`} data-testid="game-production-performance-lab-surface" />
          {performanceLabProgress && <div className="mt-3 rounded border border-border bg-bg-base p-3 text-text-muted" data-testid="game-production-performance-lab-progress">
            <span className="flex items-center justify-between gap-2"><strong>{performanceLabProgress.phase === 'preparing' ? '准备媒资' : performanceLabProgress.phase === 'warmup' ? '预热' : performanceLabProgress.phase === 'recording' ? '冻结回执' : '长期稳定性采样'}</strong><code>{formatDurationMs(performanceLabProgress.elapsedMs)} / {formatDurationMs(performanceLabProgress.durationMs)}</code></span>
            <progress aria-label="浏览器性能验收进度" className="mt-2 w-full" max={performanceLabProgress.durationMs} value={Math.min(performanceLabProgress.elapsedMs, performanceLabProgress.durationMs)} />
            <span className="mt-2 block">场景 {performanceLabProgress.sceneSamples} · 输入 {performanceLabProgress.inputSamples} · 内存 {performanceLabProgress.memorySamples}；最新 {performanceLabProgress.latestSceneLatencyMs?.toFixed(1) ?? '—'}ms / {performanceLabProgress.latestInputLatencyMs?.toFixed(1) ?? '—'}ms / {performanceLabProgress.latestHeapBytes == null ? '—' : `${(performanceLabProgress.latestHeapBytes / 1024 / 1024).toFixed(1)}MiB`}</span>
          </div>}
          <div className="mt-3 flex flex-wrap gap-2">{performanceLabRunning
            ? <button onClick={stopBrowserPerformanceLab} className="rounded border border-error/40 bg-bg-base px-4 py-2 text-xs text-error">停止性能验收</button>
            : <button disabled={busy || productionRunning} onClick={() => void startBrowserPerformanceLab()} className="rounded bg-error px-4 py-2 text-xs text-white disabled:opacity-40">开始 30 分钟商业性能验收</button>}</div>
        </section>}
        {commercialPerformanceRequired && details.build?.status === 'preview-ready' && !commercialPlaythroughPassed && <section className="mt-5 rounded border border-error/30 bg-error/5 p-4 text-[10px] text-error" data-testid="game-production-playthrough-blocker"><strong className="block">商业发布等待作者完成主路线试玩</strong><span className="mt-1 block">{playthroughGateError || (completedPlaythroughs.length > 0 ? `最新完整试玩已到达结局 ${completedPlaythroughs[0].endingKey}；确认后将冻结事件流回执。` : '请点击“试玩未发布 Build”，实际选择到达一个结局，再回到制作页。')}</span>{completedPlaythroughs.length > 0 && !playthroughGateError && <button disabled={busy || productionRunning} onClick={confirmMainRoutePlaythrough} className="mt-3 rounded bg-error px-4 py-2 text-xs text-white disabled:opacity-40">确认本次主路线试玩并冻结回执</button>}</section>}
        {commercialMediaRuntimeRequired && details.build && <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="game-production-media-runtime-receipt"><h2 className="text-sm font-semibold">真实浏览器媒资验收</h2><p className="mt-2 text-[10px] leading-5 text-text-muted">打开当前 Build 预览时，系统会自动解码每个冻结图片和音频对象，核对 hash/尺寸/透明度，并从 WebAudio PCM 计算声道、采样率、LUFS、true peak 与循环接缝；不需要作者手工逐张批准。</p>{mediaRuntimeGateError ? <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">媒资回执无法验证：{mediaRuntimeGateError}</p> : mediaRuntimeGate ? <div className={`mt-3 rounded border p-3 text-[10px] ${mediaRuntimeGate.evidence.passed ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`}><strong className="block">{mediaRuntimeGate.evidence.passed ? '全部冻结媒资已解码并通过商业规格' : '最新媒资解码或商业规格存在失败'}</strong><span className="mt-1 block">通过 {mediaRuntimeGate.evidence.assets.filter(asset => asset.status === 'decoded' && asset.policyFailures.length === 0).length}/{mediaRuntimeGate.evidence.assets.length} · receipt {compactHash(mediaRuntimeGate.gateReceipt.receiptHash)}</span>{!mediaRuntimeGate.evidence.passed && <span className="mt-1 block">失败：{mediaRuntimeGate.evidence.assets.filter(asset => asset.status === 'failed' || asset.policyFailures.length > 0).map(asset => `${asset.assetKey}:${asset.failureCode ?? asset.policyFailures.join('+')}`).join('、')}</span>}</div> : <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">商业发布等待媒资浏览器验收。请点击“试玩未发布 Build”；进入 AVG 后会自动检查，无需额外操作。</p>}</section>}
      </>}
    </main>
  </div>
}
