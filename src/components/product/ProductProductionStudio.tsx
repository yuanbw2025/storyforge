import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Archive, ArchiveRestore, CheckCircle2, CirclePause, FileCheck2, Gamepad2, Loader2,
  GitBranch, Lock, PackageCheck, Play, Plus, RefreshCw, Rocket, ShieldCheck, Sparkles, Square, Unlock, Upload,
} from 'lucide-react'
import {
  authorizeProductProductionStartV1,
  archiveProductProductionV1,
  beginProductProductionEvolutionV1,
  canRetryProductProductionBlockerV1,
  compileProductProductionBriefV3,
  consultProductProductionStartV1,
  createProductProductionWithBriefV1,
  draftTextAdventureCommercialMediaRepairV1,
  evaluateProductProductionAuthorizationReadinessV1,
  inspectProductProductionCapabilityReadinessV1,
  isTextAdventureMediaAnchorBlockerV1,
  isTextAdventureSourceDecisionBlockerV1,
  listProductProductionReviewArtifactsV1,
  listTextAdventureMediaAssetsV1,
  listProductProductionWorkspaceV1,
  publishProductProductionV1,
  readProductProductionDetailsV1,
  readProductProductionProgressV1,
  readTextAdventureMediaAssetBytesV1,
  reviseTextAdventureMediaAssetV1,
  retryTextAdventureSourceReviewV1,
  retryProductProductionBlockerV1,
  resolveTextAdventureMediaAnchorDecisionV1,
  resolveTextAdventureSourceDecisionV1,
  restoreArchivedProductProductionV1,
  runAuthorizedProductProductionV1,
  saveStoppedProductProductionBriefRevisionV1,
  setProductProductionPausedV1,
  startProductProductionPreviewV1,
  stopProductProductionV1,
  type ProductProductionDetailsV1,
  type ProductProductionProgressV1,
  type ProductProductionReviewArtifactV1,
  type TextAdventureMediaAssetV1,
} from '../../lib/product-production/service'
import type {
  ProductBuildCompatibilityReportV1, ProductEvolutionAffectedLaneV1, ProductProductionBriefV3, ProductProductionRecordV1,
  ProductProductionScaleV1, ProductProductionSourceOptionsV1, ProductProductionSourceSelectionV1,
  ProductStartingPointSuggestionV1, ProductionProductKindV1, TtrpgCampaignProposalSectionV2, WorkspaceScope,
  ProductProductionHandoffV1, WorldReferenceCatalogEntryV1,
} from '../../lib/types'
import { PRODUCT_BROWSER_PERFORMANCE_POLICY_V1 } from '../../lib/product-production/browser-performance'
import type {
  CompletedProductBuildPlaythroughV1,
  VerifiedProductBrowserPerformanceGateV1,
  VerifiedProductMainRoutePlaythroughGateV1,
  VerifiedProductMediaRuntimeGateV1,
  VerifiedTextAdventureHumanPlaytestGateV1,
  VerifiedTextAdventureHumanVisualReviewGateV1,
} from '../../lib/product-production/quality-receipts'
import type { InAppBrowserPerformanceLabProgressV1 } from '../../lib/product-production/in-app-browser-performance-lab'
import { parseProductProductionHandoffV1 } from '../../lib/product-production/handoff'
import type { TtrpgProductionWizardValueV2 } from '../ttrpg/TtrpgProductionWizard'
import TtrpgCampaignProposalSelector from '../ttrpg/TtrpgCampaignProposalSelector'
import TextAdventureProductionWizard, {
  createDefaultTextAdventureProductionWizardValueV1,
  toTextAdventureProductionBriefDraftV1,
  type TextAdventureProductionWizardValueV1,
} from '../text-game/TextAdventureProductionWizard'
import { minimumTextAdventureCommercialImageCountV1 } from '../../lib/adventure/production-brief'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../../lib/ai/client'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
type SupportedProduct = ProductionProductKindV1

const PRODUCT_LABELS: Record<SupportedProduct, string> = {
  ttrpg: '跑团 CampaignPack',
  'character-interaction': '角色互动',
  'text-adventure': '文字冒险',
  avg: 'AVG（含媒资）',
  'text-open-world': '文字开放世界',
}

interface CommandActivityV1 {
  label: string
  status: 'pending' | 'succeeded' | 'conflict'
  detail: string
}

const loadProductQualityReceiptsV1 = () => import('../../lib/product-production/quality-receipts')
const loadTtrpgProductionWizardV2 = () => import('../ttrpg/TtrpgProductionWizard')
const TtrpgProductionWizard = lazy(loadTtrpgProductionWizardV2)
const TextAdventurePackagePanel = lazy(() => import('./TextAdventurePackagePanel'))

const SOURCE_SELECTION_FACETS = [
  ['storySources', 'storyResourceKeys', '故事来源'],
  ['characters', 'characterResourceKeys', '角色'],
  ['importantLocations', 'importantLocationResourceKeys', '地点'],
  ['artifacts', 'artifactResourceKeys', '道具'],
  ['codexEntries', 'codexEntryResourceKeys', '设定 / 阵营'],
  ['storyArcs', 'storyArcResourceKeys', '故事线'],
] as const satisfies ReadonlyArray<[
  keyof ProductProductionSourceOptionsV1,
  keyof ProductProductionSourceSelectionV1,
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

function TextAdventureMediaThumbnail(props: { scope: WorkspaceScope; asset: TextAdventureMediaAssetV1 }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    void readTextAdventureMediaAssetBytesV1({ scope: props.scope, asset: props.asset })
      .then(data => {
        if (!active) return
        objectUrl = URL.createObjectURL(new Blob([data], { type: props.asset.mimeType }))
        setUrl(objectUrl)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [props.asset, props.scope])
  if (failed) return <div className="flex aspect-video items-center justify-center bg-error/5 text-[10px] text-error">图片校验失败</div>
  if (!url) return <div className="flex aspect-video items-center justify-center bg-bg-surface text-[10px] text-text-muted">正在校验图片…</div>
  return <img src={url} alt={String(props.asset.metadata.altText ?? '')} className="aspect-video w-full object-cover" />
}

function nonEmptyLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
}

function frozenSourceFacetSummary(
  draft: ProductProductionBriefV3,
  options: ProductProductionSourceOptionsV1 | null,
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
    draft: '草稿', superseded: '已取代',
    waiting: '等待依赖', ready: '可执行', running: '执行中', 'retry-ready': '等待重试', completed: '已完成',
    blocked: '阻塞', stale: '旧 epoch',
  } as Record<string, string>)[value] ?? value
}

function reviewArtifactLabel(key: string): string {
  const questScriptPart = /^content\.quest-script\.main\.act-([1-3])\.(single|multi)$/.exec(key)
  if (questScriptPart) return `第${questScriptPart[1]}幕${questScriptPart[2] === 'single' ? '单解' : '多解'}目标任务脚本`
  const sceneScriptPart = /^content\.scene-script\.act-([1-3])\.part-([1-2])$/.exec(key)
  if (sceneScriptPart) return `第${sceneScriptPart[1]}幕分场正文 · 分包 ${sceneScriptPart[2]}`
  return ({
    'design.game': '产品与核心循环设计',
    'content.source-sufficiency': '来源充分性与改编审计',
    'content.source-decision': '作者来源决策回执',
    'content.story-bible': '故事圣经',
    'content.cast-bible': '角色圣经与关系弧',
    'content.adventure-architecture': '世界空间与叙事架构',
    'content.narrative-arc-scenes': '三幕与场景卡',
    'content.narrative-decision-plan': '玩家决定与跨场景回响',
    'content.narrative-arc-plan': '分幕叙事弧与选择回响',
    'content.main-quest-plan': '主线阶段与任务计划',
    'content.quest-script.supplemental': '支线与区域事件脚本',
    'content.quest-script': '任务脚本与结算规则',
    'content.scene-script.act-1': '第一幕分场正文',
    'content.scene-script.act-2': '第二幕分场正文',
    'content.scene-script.act-3': '第三幕分场正文',
    'content.dialogue-pass.act-1': '第一幕对白声音与知识边界审校',
    'content.dialogue-pass.act-2': '第二幕对白声音与知识边界审校',
    'content.dialogue-pass.act-3': '第三幕对白声音与知识边界审校',
    'content.narrative': '主线与分支叙事',
    'content.product-module': '角色属性、资源与装备系统',
    'content.adventure-side-quests': '支线任务包',
    'content.adventure-ambient-events': '区域与随机事件包',
    'quality.adventure-review': '独立叙事质量审查',
    'media.requirements': '美术需求清单',
    'media.visual-bible': '冻结视觉圣经与角色锚点',
    'media.anchor-decision': '角色视觉锚点作者确认回执',
    'media.audit': '美术需求、素材与运行引用审计',
    'runtime.package': '装配后的可玩运行包',
    'quality.autoplay': '确定性自动游玩报告',
    'quality.visual-review': '独立多模态视觉质量审查',
    'quality.report': '静态检查与自动质量报告',
    'quality.playtest-plan': '真人试玩与发布验证计划',
  } as Record<string, string>)[key] ?? key
}

function productionTaskPresentation(taskKey: string): { label: string; owner: string } {
  const questScriptPart = /^content\.quest-script\.main\.act-([1-3])\.(single|multi)$/.exec(taskKey)
  if (questScriptPart) return {
    label: `第${questScriptPart[1]}幕${questScriptPart[2] === 'single' ? '单解' : '多解'}目标脚本`,
    owner: `任务脚本工程师 · 第${questScriptPart[1]}幕${questScriptPart[2] === 'single' ? '单解' : '多解'} Run`,
  }
  const sceneScriptPart = /^content\.scene-script\.act-([1-3])\.part-([1-2])$/.exec(taskKey)
  if (sceneScriptPart) return {
    label: `第${sceneScriptPart[1]}幕正文 ${sceneScriptPart[2]}/2`,
    owner: `分场叙事作者 · 第${sceneScriptPart[1]}幕分包 ${sceneScriptPart[2]} Run`,
  }
  if (/^media\.visual\.\d{3}$/.test(taskKey)) return {
    label: `视觉素材 ${Number(taskKey.slice(-3))}`,
    owner: '媒资 Provider · 单项可恢复',
  }
  if (/^media\.audio\.\d{3}$/.test(taskKey)) return {
    label: `音频素材 ${Number(taskKey.slice(-3))}`,
    owner: '媒资 Provider · 单项可恢复',
  }
  const exact = ({
    'content.source-sufficiency': ['来源充分性审查', '来源与改编编辑'],
    'source.author-gate': ['来源作者决策闸门', '确定性治理系统'],
    'content.design': ['产品设计与生产约束', '创意总监'],
    'content.story-bible': ['故事圣经', '故事架构师'],
    'content.cast-bible': ['角色圣经与关系弧', '角色总监'],
    'content.adventure-architecture': ['空间与叙事架构', '空间设计师'],
    'content.product-module': ['属性、资源与装备系统', '通用玩法设计师'],
    'content.narrative-arc-scenes': ['三幕与场景卡', '叙事设计师 · 结构 Run'],
    'content.narrative-decision-plan': ['玩家决定与跨场景回响', '叙事设计师 · 决定 Run'],
    'content.narrative-arc-plan': ['分幕叙事弧与选择回响', '确定性叙事弧装配器'],
    'content.main-quest-plan': ['主线阶段与目标拆分', '主线任务设计师'],
    'content.adventure-side-quests': ['支线任务设计', '支线任务设计师'],
    'content.adventure-ambient-events': ['区域与随机事件设计', 'Storylet 设计师'],
    'content.quest-script.supplemental': ['支线与事件脚本', '任务脚本工程师 · 补充内容 Run'],
    'content.quest-script': ['任务脚本确定性装配', '任务脚本装配器'],
    'content.scene-script.act-1': ['分场正文 1/3', '第一幕分场叙事作者'],
    'content.scene-script.act-2': ['分场正文 2/3', '第二幕分场叙事作者'],
    'content.scene-script.act-3': ['分场正文 3/3', '第三幕分场叙事作者'],
    'content.dialogue-pass.act-1': ['对白审校 1/3', '第一幕独立对白编辑'],
    'content.dialogue-pass.act-2': ['对白审校 2/3', '第二幕独立对白编辑'],
    'content.dialogue-pass.act-3': ['对白审校 3/3', '第三幕独立对白编辑'],
    'integration.narrative': ['三幕叙事确定性装配', '叙事装配器'],
    'content.narrative': ['装配后的主线与分支叙事', '叙事装配器'],
    'content.adventure-quality-review': ['叙事连续性独立审查', '连续性与内容审校'],
    'media.requirements': ['美术需求清单', '美术总监'],
    'media.visual-bible.compile': ['冻结视觉圣经与角色锚点', '确定性视觉圣经编译器'],
    'media.anchor-author-gate': ['角色视觉锚点作者确认', '确定性治理系统'],
    'media.visual': ['受控图片生成与验收', '媒资 Provider'],
    'media.audio': ['受控音频生成与验收', '媒资 Provider'],
    'integration.package': ['确定性游戏装配', '运行包编译器'],
    'qa.autoplay': ['确定性路线与状态自动游玩', '自动游玩执行器'],
    'qa.release': ['静态检查与发布质量门', '确定性质量系统'],
    'qa.playtest-strategy': ['真人试玩与发布验证计划', '独立试玩总监'],
  } as Record<string, [string, string]>)[taskKey]
  return exact ? { label: exact[0], owner: exact[1] } : { label: taskKey, owner: '已登记生产岗位' }
}

function buildFailureSummary(value: string): string {
  try {
    const parsed = JSON.parse(value) as { taskKey?: unknown; detail?: unknown; code?: unknown }
    const task = typeof parsed.taskKey === 'string' ? parsed.taskKey : ''
    const detail = typeof parsed.detail === 'string' ? parsed.detail : typeof parsed.code === 'string' ? parsed.code : ''
    return [task, detail].filter(Boolean).join(' · ')
  } catch { return '' }
}

interface SourceDecisionDisplayV1 {
  decision: 'ready-with-private-additions' | 'blocked'
  gaps: string[]
  privateAdditions: Array<{ key: string; title: string; rationale: string }>
}

function sourceDecisionDisplay(
  artifacts: ProductProductionReviewArtifactV1[],
): SourceDecisionDisplayV1 | null {
  const artifact = artifacts.find(item => item.artifactKey === 'content.source-sufficiency')
  if (!artifact?.payload || typeof artifact.payload !== 'object' || Array.isArray(artifact.payload)) return null
  const row = artifact.payload as Record<string, unknown>
  if (row.decision !== 'ready-with-private-additions' && row.decision !== 'blocked') return null
  const gaps = Array.isArray(row.gaps) ? row.gaps.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const gap = value as Record<string, unknown>
    return typeof gap.description === 'string' ? [gap.description] : []
  }) : []
  const privateAdditions = Array.isArray(row.privateAdditions) ? row.privateAdditions.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const addition = value as Record<string, unknown>
    return typeof addition.key === 'string' && typeof addition.title === 'string'
      && typeof addition.rationale === 'string'
      ? [{ key: addition.key, title: addition.title, rationale: addition.rationale }]
      : []
  }) : []
  return { decision: row.decision, gaps, privateAdditions }
}

interface MediaAnchorDisplayV1 {
  style: string
  palette: string[]
  characterAnchors: Array<{
    characterKey: string
    name: string
    role: string
    identity: string
    visualAnchor: string
    palette: string[]
  }>
}

function mediaAnchorDisplay(
  artifacts: ProductProductionReviewArtifactV1[],
): MediaAnchorDisplayV1 | null {
  const artifact = artifacts.find(item => item.artifactKey === 'media.visual-bible')
  if (!artifact?.payload || typeof artifact.payload !== 'object' || Array.isArray(artifact.payload)) return null
  const row = artifact.payload as Record<string, unknown>
  if (typeof row.style !== 'string' || !Array.isArray(row.palette) || !Array.isArray(row.characterAnchors)) return null
  const characterAnchors = row.characterAnchors.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const anchor = value as Record<string, unknown>
    return typeof anchor.characterKey === 'string' && typeof anchor.name === 'string'
      && typeof anchor.role === 'string' && typeof anchor.identity === 'string'
      && typeof anchor.visualAnchor === 'string' && Array.isArray(anchor.palette)
      ? [{
          characterKey: anchor.characterKey,
          name: anchor.name,
          role: anchor.role,
          identity: anchor.identity,
          visualAnchor: anchor.visualAnchor,
          palette: anchor.palette.filter((color): color is string => typeof color === 'string'),
        }]
      : []
  })
  return {
    style: row.style,
    palette: row.palette.filter((color): color is string => typeof color === 'string'),
    characterAnchors,
  }
}

function compatibilityReport(value: string | undefined): ProductBuildCompatibilityReportV1 | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<ProductBuildCompatibilityReportV1>
    return parsed.schema === 'storyforge.product-build-compatibility' && parsed.version === 1
      && ['compatible', 'restart-recommended', 'breaking'].includes(parsed.level ?? '')
      ? parsed as ProductBuildCompatibilityReportV1 : null
  } catch { return null }
}

export function shouldAutoContinueProductProductionV1(input: {
  productionStatus: string | null
  buildStatus: string | null
  running: boolean
}): boolean {
  return !input.running && input.productionStatus === 'producing'
    && input.buildStatus != null && ['authorized', 'building'].includes(input.buildStatus)
}

export default function ProductProductionStudio(props: {
  scope: WorkspaceScope
  worldGroupId?: number | null
  allowedProducts: readonly SupportedProduct[]
  initialProduct?: SupportedProduct
  initialSource?: ProductProductionHandoffV1 | null
  onProductSelected?: (productType: SupportedProduct) => void
  onPublished?: (productType: SupportedProduct) => void
  onPreviewStarted?: (productType: SupportedProduct, sessionId: number) => void
}) {
  if (props.allowedProducts.length === 0) {
    throw new Error('[upper-product-production] 当前入口没有登记可生产产品')
  }
  const initialProduct = props.initialProduct && props.allowedProducts.includes(props.initialProduct)
    ? props.initialProduct : props.allowedProducts[0]
  const [releases, setReleases] = useState<WorldReferenceCatalogEntryV1[]>([])
  const [productions, setProductions] = useState<ProductProductionRecordV1[]>([])
  const [selectedProductionId, setSelectedProductionId] = useState<number | null>(null)
  const [details, setDetails] = useState<ProductProductionDetailsV1 | null>(null)
  const [worldReleaseId, setWorldReleaseId] = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<ProductStartingPointSuggestionV1[]>([])
  const [suggestionKey, setSuggestionKey] = useState('')
  const [sourceOptions, setSourceOptions] = useState<ProductProductionSourceOptionsV1 | null>(null)
  const [selectionDefaults, setSelectionDefaults] = useState<Record<string, ProductProductionSourceSelectionV1>>({})
  const [sourceSelection, setSourceSelection] = useState<ProductProductionSourceSelectionV1 | null>(null)
  const [title, setTitle] = useState('')
  const [openingSituation, setOpeningSituation] = useState('')
  const [playerRole, setPlayerRole] = useState('')
  const [scale, setScale] = useState<ProductProductionScaleV1['scope']>(
    initialProduct === 'text-adventure' ? 'short-arc' : 'scene',
  )
  const [requiredFactsText, setRequiredFactsText] = useState('')
  const [forbiddenChangesText, setForbiddenChangesText] = useState('')
  const [contentBoundariesText, setContentBoundariesText] = useState('不生成未授权的露骨或仇恨内容')
  const [productType, setProductType] = useState<SupportedProduct>(initialProduct)
  const [qualityProfile, setQualityProfile] = useState<ProductProductionBriefV3['qualityProfile']>('prototype')
  const [visualLevel, setVisualLevel] = useState<'none' | 'key-scenes' | 'illustrated'>(
    initialProduct === 'avg' || initialProduct === 'text-adventure' ? 'key-scenes' : 'none',
  )
  const [audioLevel, setAudioLevel] = useState<'none' | 'music-sfx'>(initialProduct === 'avg' ? 'music-sfx' : 'none')
  const [confirmTtrpgDefaultMappings, setConfirmTtrpgDefaultMappings] = useState(false)
  const [ttrpgWizard, setTtrpgWizard] = useState<TtrpgProductionWizardValueV2 | null>(null)
  const [textAdventureWizard, setTextAdventureWizard] = useState<TextAdventureProductionWizardValueV1>(
    () => createDefaultTextAdventureProductionWizardValueV1(initialProduct === 'text-adventure' ? 'short-arc' : 'scene'),
  )
  const [draft, setDraft] = useState<ProductProductionBriefV3 | null>(null)
  const [briefRepairDraft, setBriefRepairDraft] = useState<{
    productionId: number
    brief: ProductProductionBriefV3
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [productionRunning, setProductionRunning] = useState(false)
  const [campaignProposalRunning, setCampaignProposalRunning] = useState(false)
  const [progress, setProgress] = useState<ProductProductionProgressV1 | null>(null)
  const [performanceGate, setPerformanceGate] = useState<VerifiedProductBrowserPerformanceGateV1 | null>(null)
  const [performanceGateError, setPerformanceGateError] = useState('')
  const [performanceLabRunning, setPerformanceLabRunning] = useState(false)
  const [performanceLabProgress, setPerformanceLabProgress] = useState<InAppBrowserPerformanceLabProgressV1 | null>(null)
  const [playthroughGate, setPlaythroughGate] = useState<VerifiedProductMainRoutePlaythroughGateV1 | null>(null)
  const [playthroughGateError, setPlaythroughGateError] = useState('')
  const [humanPlaytestGate, setHumanPlaytestGate] = useState<VerifiedTextAdventureHumanPlaytestGateV1 | null>(null)
  const [humanPlaytestGateError, setHumanPlaytestGateError] = useState('')
  const [humanPlaytestSessionId, setHumanPlaytestSessionId] = useState<number | null>(null)
  const [humanPlaytestRole, setHumanPlaytestRole] = useState<'author' | 'independent-player'>('author')
  const [humanPlaytestParticipantLabel, setHumanPlaytestParticipantLabel] = useState('作者')
  const [humanPlaytestIndependenceConfirmed, setHumanPlaytestIndependenceConfirmed] = useState(false)
  const [humanPlaytestRatings, setHumanPlaytestRatings] = useState({
    comprehension: 0, pacing: 0, agency: 0, emotionalImpact: 0,
  })
  const [humanPlaytestFeedback, setHumanPlaytestFeedback] = useState({
    comprehensionObstacles: '', boringMoments: '', errors: '', choiceExperience: '', endingFeedback: '',
  })
  const [humanPlaytestBlockingIssues, setHumanPlaytestBlockingIssues] = useState('')
  const [humanPlaytestNote, setHumanPlaytestNote] = useState('')
  const [mediaRuntimeGate, setMediaRuntimeGate] = useState<VerifiedProductMediaRuntimeGateV1 | null>(null)
  const [mediaRuntimeGateError, setMediaRuntimeGateError] = useState('')
  const [humanVisualGate, setHumanVisualGate] = useState<VerifiedTextAdventureHumanVisualReviewGateV1 | null>(null)
  const [humanVisualGateError, setHumanVisualGateError] = useState('')
  const [humanVisualDecisions, setHumanVisualDecisions] = useState<Record<string, 'approved' | 'rejected' | null>>({})
  const [humanVisualNotes, setHumanVisualNotes] = useState<Record<string, string>>({})
  const [completedPlaythroughs, setCompletedPlaythroughs] = useState<CompletedProductBuildPlaythroughV1[]>([])
  const [reviewArtifacts, setReviewArtifacts] = useState<ProductProductionReviewArtifactV1[]>([])
  const [mediaAssets, setMediaAssets] = useState<TextAdventureMediaAssetV1[]>([])
  const [mediaLicense, setMediaLicense] = useState('作者原创并授权随本产品分发')
  const [mediaDeclaration, setMediaDeclaration] = useState('我确认拥有该图片的必要权利，并对本声明负责。')
  const [mediaCommercialUse, setMediaCommercialUse] = useState(false)
  const [mediaRedistribution, setMediaRedistribution] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [commandActivity, setCommandActivity] = useState<CommandActivityV1 | null>(null)
  const [evolutionGoal, setEvolutionGoal] = useState('')
  const [evolutionLanes, setEvolutionLanes] = useState<ProductEvolutionAffectedLaneV1[]>([
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
  const {
    allowedProducts,
    initialSource,
    onProductSelected,
    scope,
  } = props

  const refresh = useCallback(async (preferredId?: number | null) => {
    const { worldReleases: nextReleases, productions: nextProductions } = await listProductProductionWorkspaceV1(
      scope,
      allowedProducts,
    )
    setReleases(nextReleases)
    setProductions(nextProductions)
    const parsedInitialSource = initialSource ? parseProductProductionHandoffV1(initialSource) : null
    const handedOffRelease = parsedInitialSource
      ? nextReleases.find(release => release.reference.localReleaseRecordId === parsedInitialSource.worldReleaseId
        && release.reference.releaseHash === parsedInitialSource.worldContentHash)
      : null
    if (parsedInitialSource && (!handedOffRelease || !allowedProducts.includes(parsedInitialSource.productType))) {
      setError('世界引擎交接的 WorldRelease 已失效、hash 已变化或产品类型不一致；请返回世界引擎重新选择。')
    }
    setWorldReleaseId(current => parsedInitialSource
      ? handedOffRelease?.reference.localReleaseRecordId ?? null
      : current ?? nextReleases[0]?.reference.localReleaseRecordId ?? null)
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
      setHumanVisualGate(null)
      setHumanVisualGateError('')
      setHumanVisualDecisions({})
      setHumanVisualNotes({})
      setCompletedPlaythroughs([])
      setReviewArtifacts([])
      setMediaAssets([])
      return
    }
    const nextDetails = await readProductProductionDetailsV1(scope, desired, allowedProducts)
    setProductType(nextDetails.production.productType)
    onProductSelected?.(nextDetails.production.productType)
    setDetails(nextDetails)
    setProgress(nextDetails.build && nextDetails.brief?.status === 'authorized'
      ? await readProductProductionProgressV1({ scope, productionId: desired })
      : null)
    if (nextDetails.build) {
      const qualityReceipts = await loadProductQualityReceiptsV1()
      setReviewArtifacts(await listProductProductionReviewArtifactsV1({
        scope,
        buildId: nextDetails.build.id!,
      }))
      const nextMediaAssets = nextDetails.production.productType === 'text-adventure'
        ? await listTextAdventureMediaAssetsV1({ scope, buildId: nextDetails.build.id! })
        : []
      setMediaAssets(nextMediaAssets)
      try {
        setPerformanceGate(await qualityReceipts.readLatestProductBrowserPerformanceGateV1({
          scope, productBuildId: nextDetails.build.id!,
        }))
        setPerformanceGateError('')
      } catch (cause) {
        setPerformanceGate(null)
        setPerformanceGateError(cause instanceof Error ? cause.message : String(cause))
      }
      try {
        setMediaRuntimeGate(await qualityReceipts.readLatestProductMediaRuntimeGateV1({
          scope, productBuildId: nextDetails.build.id!,
        }))
        setMediaRuntimeGateError('')
      } catch (cause) {
        setMediaRuntimeGate(null)
        setMediaRuntimeGateError(cause instanceof Error ? cause.message : String(cause))
      }
      let nextPlaythroughError = ''
      try {
        setPlaythroughGate(await qualityReceipts.readLatestProductBuildMainRouteGateV1({
          scope, productBuildId: nextDetails.build.id!,
        }))
      } catch (cause) {
        setPlaythroughGate(null)
        nextPlaythroughError = cause instanceof Error ? cause.message : String(cause)
      }
      let nextCompletedPlaythroughs: CompletedProductBuildPlaythroughV1[] = []
      try {
        nextCompletedPlaythroughs = await qualityReceipts.listCompletedProductBuildPlaythroughsV1({
          scope, productBuildId: nextDetails.build.id!,
        })
        setCompletedPlaythroughs(nextCompletedPlaythroughs)
        setHumanPlaytestSessionId(current => current != null
          && nextCompletedPlaythroughs.some(item => item.sessionId === current)
          ? current : nextCompletedPlaythroughs[0]?.sessionId ?? null)
      } catch (cause) {
        setCompletedPlaythroughs([])
        const message = cause instanceof Error ? cause.message : String(cause)
        nextPlaythroughError = [nextPlaythroughError, message].filter(Boolean).join('；')
      }
      setPlaythroughGateError(nextPlaythroughError)
      let nextBrief: ProductProductionBriefV3 | null = null
      try { nextBrief = nextDetails.brief ? JSON.parse(nextDetails.brief.briefJson) as ProductProductionBriefV3 : null }
      catch { nextBrief = null }
      if (nextDetails.production.productType === 'text-adventure'
        && nextBrief?.qualityProfile === 'commercial-candidate') {
        try {
          setHumanPlaytestGate(await qualityReceipts.readLatestTextAdventureHumanPlaytestGateV1({
            scope, productBuildId: nextDetails.build.id!,
          }))
          setHumanPlaytestGateError('')
        } catch (cause) {
          setHumanPlaytestGate(null)
          setHumanPlaytestGateError(cause instanceof Error ? cause.message : String(cause))
        }
      } else {
        setHumanPlaytestGate(null)
        setHumanPlaytestGateError('')
      }
      const humanVisualRequired = nextDetails.production.productType === 'text-adventure'
        && nextBrief?.qualityProfile === 'commercial-candidate'
        && nextMediaAssets.length > 0
        && ['preview-ready', 'release-ready'].includes(nextDetails.build.status)
      if (humanVisualRequired) {
        try {
          const nextHumanVisualGate = await qualityReceipts.readLatestTextAdventureHumanVisualReviewGateV1({
            scope, productBuildId: nextDetails.build.id!,
          })
          setHumanVisualGate(nextHumanVisualGate)
          setHumanVisualGateError('')
          setHumanVisualDecisions(Object.fromEntries(nextMediaAssets.map(asset => [
            asset.artifactKey,
            nextHumanVisualGate?.evidence.assets.find(item => item.artifactKey === asset.artifactKey)?.decision ?? null,
          ])))
          setHumanVisualNotes(Object.fromEntries(nextMediaAssets.map(asset => [
            asset.artifactKey,
            nextHumanVisualGate?.evidence.assets.find(item => item.artifactKey === asset.artifactKey)?.note ?? '',
          ])))
        } catch (cause) {
          setHumanVisualGate(null)
          setHumanVisualGateError(cause instanceof Error ? cause.message : String(cause))
          setHumanVisualDecisions(Object.fromEntries(nextMediaAssets.map(asset => [asset.artifactKey, null])))
          setHumanVisualNotes(Object.fromEntries(nextMediaAssets.map(asset => [asset.artifactKey, ''])))
        }
      } else {
        setHumanVisualGate(null)
        setHumanVisualGateError('')
        setHumanVisualDecisions(Object.fromEntries(nextMediaAssets.map(asset => [asset.artifactKey, null])))
        setHumanVisualNotes(Object.fromEntries(nextMediaAssets.map(asset => [asset.artifactKey, ''])))
      }
    } else {
      setPerformanceGate(null)
      setPerformanceGateError('')
      setPlaythroughGate(null)
      setPlaythroughGateError('')
      setHumanPlaytestGate(null)
      setHumanPlaytestGateError('')
      setHumanPlaytestSessionId(null)
      setMediaRuntimeGate(null)
      setMediaRuntimeGateError('')
      setHumanVisualGate(null)
      setHumanVisualGateError('')
      setHumanVisualDecisions({})
      setHumanVisualNotes({})
      setCompletedPlaythroughs([])
      setReviewArtifacts([])
      setMediaAssets([])
    }
  }, [allowedProducts, initialSource, onProductSelected, scope, selectedProductionId])

  useEffect(() => { void refresh() }, [props.scope.projectId, props.scope.worldId, props.scope.workId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true
    void loadTtrpgProductionWizardV2().then(module => {
      if (active) setTtrpgWizard(current => current ?? module.createDefaultTtrpgProductionWizardValueV2())
    })
    return () => { active = false }
  }, [])
  useEffect(() => () => {
    queuedProductionIdRef.current = null
    productionAbort.current?.abort('product-production-studio-unmounted')
    performanceLabAbort.current?.abort('product-production-studio-unmounted')
  }, [])
  useEffect(() => () => {
    performanceLabAbort.current?.abort('product-production-build-changed')
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
    const result = await consultProductProductionStartV1({ scope: props.scope, worldReleaseId })
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
    setMessage(`已通过中立世界网关生成 ${result.suggestions.length} 个可追溯起点；尚未开始制作。`)
  }, '分析世界并生成起点建议')

  const compileBrief = () => run(async () => {
    if (worldReleaseId == null || !suggestionKey) throw new Error('请选择 WorldRelease 与游戏起点。')
    if (productType === 'ttrpg' && !ttrpgWizard) throw new Error('跑团创建向导仍在载入，请稍后重试。')
    const ttrpgWizardModule = productType === 'ttrpg' ? await loadTtrpgProductionWizardV2() : null
    const next = await compileProductProductionBriefV3({
      scope: props.scope, worldReleaseId, suggestionKey, productType, qualityProfile,
      scale, visualLevel, audioLevel, playerRole, openingSituation,
      coreExperience: openingSituation ? ['有后果的选择', openingSituation] : undefined,
      requiredFacts: nonEmptyLines(requiredFactsText),
      forbiddenChanges: nonEmptyLines(forbiddenChangesText),
      contentBoundaries: nonEmptyLines(contentBoundariesText),
      confirmTtrpgDefaultMappings: productType === 'ttrpg' && confirmTtrpgDefaultMappings,
      ttrpg: productType === 'ttrpg' && ttrpgWizard && ttrpgWizardModule ? ttrpgWizardModule.toTtrpgProductionBriefDraftInputV2({
        value: ttrpgWizard,
        sourceOptions,
        sourceSelection,
        openingSituation,
      }) : undefined,
      textAdventure: productType === 'text-adventure'
        ? toTextAdventureProductionBriefDraftV1(textAdventureWizard)
        : undefined,
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
      const { generateTtrpgCampaignProposalCandidateV2 } = await import('../../lib/ttrpg/campaign-proposal-harness')
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
    const productionId = await createProductProductionWithBriefV1({
      scope: props.scope, worldReleaseId, title, brief: draft,
    })
    setSuggestions([]); setDraft(null)
    await refresh(productionId)
    setMessage('Production 与 Brief revision 已保存；未授权前不会创建 Build 或调用生成能力。')
  }, '保存 Brief revision')

  const prepareCommercialMediaBriefRepair = () => run(async () => {
    if (!details?.production.id) throw new Error('当前没有可修订的 Production。')
    const repaired = draftTextAdventureCommercialMediaRepairV1(details)
    setBriefRepairDraft({ productionId: details.production.id, brief: repaired })
    setMessage(`已生成 Brief r${(details.brief?.revision ?? 0) + 1} 候选；冻结世界、故事目标和玩法合同均保持不变，请核对媒资数量后再保存。`)
  }, '生成商业媒资 Brief 修订候选')

  const saveCommercialMediaBriefRepair = () => run(async () => {
    if (!details?.production.id || briefRepairDraft?.productionId !== details.production.id) {
      throw new Error('商业媒资 Brief 修订候选不存在或已过期。')
    }
    const productionId = details.production.id
    await saveStoppedProductProductionBriefRevisionV1({
      scope: props.scope,
      details,
      brief: briefRepairDraft.brief,
    })
    setBriefRepairDraft(null)
    await refresh(productionId)
    setMessage('修订 Brief 已保存到同一 Production；旧 Build 与全部工件保留为审计证据，尚未开始新 Build。')
  }, '保存商业媒资 Brief revision')

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
      const result = await runAuthorizedProductProductionV1({
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
            ? '自动制作完成：Build 已可试玩；商业候选还需完成真实浏览器性能、主路线试玩、媒资自动解码，并在有图时完成独立 Visual QA 与作者逐图确认后才可发布。'
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
    if (productionId == null || !shouldAutoContinueProductProductionV1({
      productionStatus: productionStatus ?? null,
      buildStatus: buildStatus ?? null,
      running: productionRunningRef.current,
    })) return
    void startProduction(productionId)
  }, [details?.production.id, details?.production.status, details?.build?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const authorize = () => run(async () => {
    if (!details) throw new Error('缺少当前 Production。')
    const productionId = details.production.id!
    await authorizeProductProductionStartV1({ scope: props.scope, details })
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
    const result = await setProductProductionPausedV1({ scope: props.scope, production: details.production })
    await refresh(details.production.id)
    setMessage(result === 'resumed' ? 'Build 已恢复；旧执行者仍因 epoch 变化而无法写入。' : 'Build 已暂停并递增 control epoch。')
  }, details?.production.status === 'paused' ? '恢复制作' : '暂停制作')

  const stop = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    queuedProductionIdRef.current = null
    productionAbort.current?.abort('author-stopped')
    await stopProductProductionV1({ scope: props.scope, production: details.production })
    await refresh(details.production.id)
    setMessage('Production 已停止，未发布产物保留用于审计。')
  }, '停止制作')

  const archiveOrRestore = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const restoring = details.production.status === 'archived'
    if (restoring) await restoreArchivedProductProductionV1({ scope: props.scope, production: details.production })
    else await archiveProductProductionV1({ scope: props.scope, production: details.production })
    await refresh(details.production.id)
    setMessage(restoring
      ? 'Production 已从归档元数据恢复；旧 Build、Release、receipt 和存档引用保持原 hash。'
      : 'Production 已归档；这是可恢复状态，不会删除 Build、Release、receipt 或媒资 Blob。')
  }, details?.production.status === 'archived' ? '恢复归档' : '归档 Production')

  const publish = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const { prepared, receipt } = await publishProductProductionV1({
      scope: props.scope, productionId: details.production.id!,
    })
    await refresh(details.production.id)
    setMessage(`ProductRelease v${receipt.releaseVersion} 已原子发布；玩家端读取同一 RuntimePackage。`)
    props.onPublished?.(prepared.productType as SupportedProduct)
  }, '原子发布')

  const preview = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const opened = await startProductProductionPreviewV1({
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
    const qualityReceipts = await loadProductQualityReceiptsV1()
    await qualityReceipts.recordProductBuildMainRoutePlaythroughV1({
      scope: props.scope,
      productBuildId: details.build.id!,
      productRuntimeSessionId: candidate.sessionId,
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

  const recordHumanPlaytest = () => run(async () => {
    if (!details?.build || details.production.productType !== 'text-adventure') {
      throw new Error('缺少当前商业文字冒险 Build。')
    }
    const candidate = completedPlaythroughs.find(item => item.sessionId === humanPlaytestSessionId)
    if (!candidate) throw new Error('请选择一个已经到达结局的当前 Build 试玩会话。')
    if (Object.values(humanPlaytestRatings).some(score => score < 1 || score > 5)) {
      throw new Error('请对理解、节奏、能动性和情绪触达分别给出 1–5 分。')
    }
    if (Object.values(humanPlaytestFeedback).some(value => !value.trim())) {
      throw new Error('请填写理解障碍、无聊点、错误、选择感受和结局反馈；没有问题时请明确填写“无”。')
    }
    const userAgent = navigator.userAgent || 'unknown-browser'
    const environment = {
      browserName: /Edg\//.test(userAgent) ? 'edge'
        : /Chrome\//.test(userAgent) ? 'chromium'
          : /Firefox\//.test(userAgent) ? 'firefox'
            : /Safari\//.test(userAgent) ? 'safari' : 'browser',
      browserVersion: userAgent,
      platform: navigator.platform || 'desktop',
      viewport: { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) },
    }
    const qualityReceipts = await loadProductQualityReceiptsV1()
    if (humanPlaytestRole === 'author' && playthroughGate?.gateReceipt.status !== 'passed') {
      await qualityReceipts.recordProductBuildMainRoutePlaythroughV1({
        scope: props.scope, productBuildId: details.build.id!, productRuntimeSessionId: candidate.sessionId,
        authorConfirmation: 'author-confirmed-main-route', environment,
      })
    }
    const result = await qualityReceipts.recordTextAdventureHumanPlaytestV1({
      scope: props.scope, productBuildId: details.build.id!, productRuntimeSessionId: candidate.sessionId,
      participantRole: humanPlaytestRole,
      participantLabel: humanPlaytestParticipantLabel,
      participantDeclaration: humanPlaytestRole === 'author'
        ? 'author-self-attestation' : 'not-involved-in-production',
      environment,
      assessment: {
        ratings: humanPlaytestRatings,
        blockingIssues: humanPlaytestBlockingIssues.split('\n').map(item => item.trim()).filter(Boolean),
        feedback: humanPlaytestFeedback,
        note: humanPlaytestNote,
      },
    })
    await refresh(details.production.id)
    setMessage(result.gateReceipt.status === 'passed'
      ? '作者与独立玩家的两个不同完整会话均已通过，真人试玩覆盖回执已冻结。'
      : result.gateReceipt.status === 'failed'
        ? '本次真人试玩证据已冻结，但时长、交互量、评分或阻断问题未通过；商业发布仍被阻断。'
        : '本次真人试玩证据已冻结；仍需由另一角色使用不同新会话完整通关。')
  }, '冻结真人试玩回执')

  const confirmHumanVisualReview = () => run(async () => {
    if (!details?.build || details.production.productType !== 'text-adventure') {
      throw new Error('缺少当前文字冒险 Build。')
    }
    const decisions = mediaAssets.map(asset => ({
      assetKey: asset.assetKey,
      decision: humanVisualDecisions[asset.artifactKey],
      note: humanVisualNotes[asset.artifactKey] ?? '',
    }))
    if (decisions.some(item => item.decision == null)) throw new Error('请先逐张接受或退回当前 Build 的全部图片。')
    const qualityReceipts = await loadProductQualityReceiptsV1()
    const verified = await qualityReceipts.recordTextAdventureHumanVisualReviewV1({
      scope: props.scope,
      productBuildId: details.build.id!,
      decisions: decisions.map(item => ({
        assetKey: item.assetKey,
        decision: item.decision as 'approved' | 'rejected',
        note: item.note,
      })),
    })
    await refresh(details.production.id)
    setMessage(verified.evidence.passed
      ? `作者已逐图确认 ${verified.evidence.assets.length} 张冻结图片；审美决定和每图 hash 已写入不可变回执。`
      : `作者退回了 ${verified.evidence.assets.filter(asset => asset.decision === 'rejected').length} 张图片；当前 Build 保留用于审计，但不能发布。`)
  }, '冻结逐图审查回执')

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
      const { runInAppBrowserPerformanceLabV1 } = await import('../../lib/product-production/in-app-browser-performance-lab')
      const measurement = await runInAppBrowserPerformanceLabV1({
        scope: props.scope, productBuildId: buildId, host: performanceLabHost.current,
        signal: controller.signal, onProgress: setPerformanceLabProgress,
      })
      const qualityReceipts = await loadProductQualityReceiptsV1()
      const verified = await qualityReceipts.recordProductBrowserPerformanceMeasurementV1({
        scope: props.scope, productBuildId: buildId, measurement,
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
    const created = await beginProductProductionEvolutionV1({
      scope: props.scope, productionId: details.production.id!, userText: evolutionGoal,
      affectedLanes: evolutionLanes,
    })
    setEvolutionGoal('')
    await refresh(details.production.id)
    setMessage(`演化目标已编译为 Brief r${created.briefRevision}；请审查后再次授权，系统会创建新 Build 并复用可证明未变的基础。`)
  }, '创建演化 Brief')

  const reviseMediaAsset = (
    asset: TextAdventureMediaAssetV1,
    action: 'upload-replacement' | 'regenerate' | 'lock' | 'unlock',
    file?: File,
  ) => run(async () => {
    if (!details) throw new Error('缺少当前文字冒险 Production。')
    if (action === 'upload-replacement' && (!mediaLicense.trim() || !mediaDeclaration.trim())) {
      throw new Error('上传图片前必须填写许可与权利声明。')
    }
    const result = await reviseTextAdventureMediaAssetV1({
      scope: props.scope, details, asset, action,
      upload: file ? {
        file,
        altText: String(asset.metadata.altText ?? asset.metadata.name ?? file.name),
        license: mediaLicense,
        commercialUse: mediaCommercialUse,
        redistribution: mediaRedistribution,
        declaration: mediaDeclaration,
        attribution: '无需署名',
      } : undefined,
    })
    await refresh(details.production.id)
    setMessage(`图片 ${asset.artifactKey} 已执行 ${action}：Build #${result.parentBuildNumber} 保持不可变，新 Build #${result.buildNumber} 将自动重新装配和质检。`)
  }, `修订图片 · ${action}`)

  const retryBlocker = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const productionId = details.production.id!
    await retryProductProductionBlockerV1({ scope: props.scope, details })
    await refresh(productionId)
    setMessage('重试已由作者确认；未受影响的已完成产物会跨 epoch 复用，阻塞工件及其下游将按质量反馈定向重做。')
  }, '重试阻塞任务')

  const resolveSourceDecision = (
    action: 'accept-product-private-expansion' | 'cancel',
  ) => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const productionId = details.production.id!
    await resolveTextAdventureSourceDecisionV1({
      scope: props.scope,
      details,
      action,
      note: action === 'accept-product-private-expansion'
        ? '作者已在制作工作台逐项查看并接受本 Build 的产品私域补充清单；补充事实不得回写 WorldRelease。'
        : '作者拒绝当前来源方案并取消 Build；修改来源或产品范围后再创建新 Build。',
    })
    await refresh(productionId)
    setMessage(action === 'accept-product-private-expansion'
      ? '产品私域补充已由作者明确接受并冻结为决策证据；制作将从新 epoch 自动续跑。'
      : '当前 Build 已取消；世界版本、旧 Build 与已发布内容未被修改。')
  }, '处理来源作者决策')

  const retrySourceReview = () => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const productionId = details.production.id!
    await retryTextAdventureSourceReviewV1({ scope: props.scope, details })
    await refresh(productionId)
    setMessage('当前阻断归因已被作者退回；来源编辑将按世界/产品私域边界重新审查，原 WorldRelease 与 Brief 保持不变。')
  }, '重新审查来源判断')

  const resolveMediaAnchorDecision = (
    action: 'confirm-character-anchors' | 'cancel',
  ) => run(async () => {
    if (!details) throw new Error('缺少 Production。')
    const productionId = details.production.id!
    await resolveTextAdventureMediaAnchorDecisionV1({
      scope: props.scope,
      details,
      action,
      note: action === 'confirm-character-anchors'
        ? '作者已在制作工作台检查当前 Build 的视觉风格、角色身份与角色视觉锚点，同意按此冻结基线开始逐项出图。'
        : '作者拒绝当前角色视觉锚点并取消 Build；修改视觉方向后再创建新 Build。',
    })
    await refresh(productionId)
    setMessage(action === 'confirm-character-anchors'
      ? '角色视觉锚点已由作者确认并冻结为决策证据；逐项图片生产将从新 epoch 继续。'
      : '当前 Build 已取消；已发布版本、世界版本和已有媒资未被修改。')
  }, '处理角色视觉锚点决策')

  const selectedSuggestion = suggestions.find(item => item.suggestionKey === suggestionKey) ?? null
  const canPause = details && ['producing', 'preview-ready'].includes(details.production.status)
    && details.build && !['released', 'cancelled', 'failed', 'archived', 'paused', 'recovery-required'].includes(details.build.status)
  const canRetryBlocker = !!details && canRetryProductProductionBlockerV1(details)
  const sourceDecisionBlocker = !!details && isTextAdventureSourceDecisionBlockerV1(details)
  const sourceDecision = useMemo(
    () => sourceDecisionBlocker ? sourceDecisionDisplay(reviewArtifacts) : null,
    [reviewArtifacts, sourceDecisionBlocker],
  )
  const mediaAnchorBlocker = !!details && isTextAdventureMediaAnchorBlockerV1(details)
  const mediaAnchor = useMemo(
    () => mediaAnchorBlocker ? mediaAnchorDisplay(reviewArtifacts) : null,
    [mediaAnchorBlocker, reviewArtifacts],
  )
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
  const overallTaskProgress = useMemo(() => {
    const tasks = progress?.tasks ?? []
    const completed = tasks.filter(task => task.status === 'completed').length
    const active = tasks.filter(task => task.status === 'running' || task.status === 'retry-ready')
      .map(task => productionTaskPresentation(task.taskKey).label)
    const visual = tasks.filter(task => /^media\.visual\.\d{3}$/.test(task.taskKey))
    const completedVisual = visual.filter(task => task.status === 'completed').length
    return {
      completed,
      total: tasks.length,
      percent: tasks.length ? Math.round(completed / tasks.length * 100) : 0,
      active,
      completedVisual,
      totalVisual: visual.length,
    }
  }, [progress])
  const blockerSummary = canRetryBlocker && details?.build
    ? buildFailureSummary(details.build.failureJson) : ''
  const compatibility = useMemo(
    () => compatibilityReport(details?.build?.compatibilityJson),
    [details?.build?.compatibilityJson],
  )
  const selectedBrief = useMemo(() => {
    try { return details?.brief ? JSON.parse(details.brief.briefJson) as ProductProductionBriefV3 : null }
    catch { return null }
  }, [details?.brief])
  const commercialPerformanceRequired = selectedBrief?.qualityProfile === 'commercial-candidate'
  const commercialTextAdventureImageMinimum = selectedBrief?.qualityProfile === 'commercial-candidate'
    && selectedBrief.intent.productType === 'text-adventure' && selectedBrief.textAdventure
    ? minimumTextAdventureCommercialImageCountV1(selectedBrief.textAdventure.media.mode) : 0
  const commercialTextAdventureMediaPlanReady = (selectedBrief?.media.imageCount ?? 0)
    >= commercialTextAdventureImageMinimum
  const commercialMediaRepairAvailable = details?.production.status === 'stopped'
    && details.build?.status === 'cancelled'
    && selectedBrief?.qualityProfile === 'commercial-candidate'
    && selectedBrief.intent.productType === 'text-adventure'
    && commercialTextAdventureImageMinimum > 0
    && !commercialTextAdventureMediaPlanReady
  const activeBriefRepairDraft = briefRepairDraft && briefRepairDraft.productionId === details?.production.id
    ? briefRepairDraft.brief : null
  const commercialPerformancePassed = performanceGate?.gateReceipt.status === 'passed'
    && performanceGate.evidence.receipt.passed
  const commercialPlaythroughPassed = playthroughGate?.gateReceipt.status === 'passed'
  const commercialHumanPlaytestRequired = commercialPerformanceRequired
    && selectedBrief?.intent.productType === 'text-adventure'
  const commercialHumanPlaytestPassed = !commercialHumanPlaytestRequired
    || humanPlaytestGate?.gateReceipt.status === 'passed' && humanPlaytestGate.evidence.passed
  const selectedHumanPlaytest = completedPlaythroughs.find(item => item.sessionId === humanPlaytestSessionId) ?? null
  const humanPlaytestAuthor = humanPlaytestGate?.evidence.sessions.find(item =>
    item.sessionEvidenceHash === humanPlaytestGate.evidence.authorSessionEvidenceHash) ?? null
  const humanPlaytestIndependent = humanPlaytestGate?.evidence.sessions.find(item =>
    item.sessionEvidenceHash === humanPlaytestGate.evidence.independentPlayerSessionEvidenceHash) ?? null
  const selectedHumanPlaytestClaimedByOtherRole = selectedHumanPlaytest != null
    && humanPlaytestGate?.evidence.sessions.some(item => item.eventStreamHash === selectedHumanPlaytest.eventStreamHash
      && item.participantRole !== humanPlaytestRole) === true
  const humanPlaytestFormComplete = Object.values(humanPlaytestRatings).every(score => score >= 1 && score <= 5)
    && Object.values(humanPlaytestFeedback).every(value => value.trim().length > 0)
    && humanPlaytestParticipantLabel.trim().length > 0
    && (humanPlaytestRole === 'author' || humanPlaytestIndependenceConfirmed)
  const commercialMediaRuntimeRequired = commercialPerformanceRequired
    && (selectedBrief?.media.requiredMediaKinds.length ?? 0) > 0
  const commercialMediaRuntimePassed = !commercialMediaRuntimeRequired
    || mediaRuntimeGate?.gateReceipt.status === 'passed' && mediaRuntimeGate.evidence.passed
  const visualReviewArtifact = reviewArtifacts.find(artifact => artifact.artifactKey === 'quality.visual-review')
  const mediaAuditArtifact = reviewArtifacts.find(artifact => artifact.artifactKey === 'media.audit')
  const visualReviewStatus = visualReviewArtifact?.payload && typeof visualReviewArtifact.payload === 'object'
    && !Array.isArray(visualReviewArtifact.payload)
    ? String((visualReviewArtifact.payload as Record<string, unknown>).status ?? '')
    : ''
  const mediaAuditPassed = !!mediaAuditArtifact?.payload && typeof mediaAuditArtifact.payload === 'object'
    && !Array.isArray(mediaAuditArtifact.payload)
    && (mediaAuditArtifact.payload as Record<string, unknown>).passed === true
  const commercialHumanVisualRequired = commercialPerformanceRequired
    && selectedBrief?.intent.productType === 'text-adventure' && mediaAssets.length > 0
  const commercialHumanVisualPassed = !commercialHumanVisualRequired
    || humanVisualGate?.gateReceipt.status === 'passed' && humanVisualGate.evidence.passed
  const humanVisualDecisionsComplete = mediaAssets.length > 0 && mediaAssets.every(asset => {
    const decision = humanVisualDecisions[asset.artifactKey]
    return decision === 'approved' || decision === 'rejected' && !!humanVisualNotes[asset.artifactKey]?.trim()
  })
  const commercialQualityPassed = commercialPerformancePassed
    && commercialPlaythroughPassed && commercialHumanPlaytestPassed
    && commercialMediaRuntimePassed && commercialHumanVisualPassed
  const capabilityReadiness = inspectProductProductionCapabilityReadinessV1({
    projectId: props.scope.projectId,
  })
  const requestedCommercialImageReady = qualityProfile !== 'commercial-candidate'
    || !['avg', 'ttrpg', 'text-adventure'].includes(productType)
    || (productType === 'ttrpg' ? ttrpgWizard?.maximumGeneratedAssets === 0 : visualLevel === 'none')
    || capabilityReadiness.image.ready || capabilityReadiness.mediaRelayReady
  const requestedCommercialAudioReady = qualityProfile !== 'commercial-candidate'
    || productType !== 'avg' || audioLevel === 'none' || capabilityReadiness.mediaRelayReady
  const authorizationReadiness = useMemo(() => {
    if (!details?.brief) return null
    try {
      const brief = JSON.parse(details.brief.briefJson) as ProductProductionBriefV3
      return evaluateProductProductionAuthorizationReadinessV1({ brief, readiness: capabilityReadiness })
    } catch {
      return {
        ready: false,
        blockerCode: 'capability-unbound' as const,
        blockerMessages: ['当前 Brief 无法解析，不能授权开工。'],
        requiredMediaRequirementKeys: [],
      }
    }
  }, [capabilityReadiness, details?.brief])

  return <div className="grid min-h-[720px] grid-cols-1 bg-bg-base text-text-primary lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="product-production-studio">
    <aside className="border-b border-border bg-bg-surface p-4 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between gap-2"><div><small className="font-mono text-[9px] text-accent">PRODUCT-PROD</small><h2 className="font-serif text-base">游戏制作</h2></div><button aria-label="刷新制作列表" onClick={() => void refresh()} className="rounded border border-border p-2 text-text-muted"><RefreshCw className="h-3.5 w-3.5" /></button></div>
      <button onClick={() => { const nextScale = initialProduct === 'text-adventure' ? 'short-arc' : 'scene'; setSelectedProductionId(null); setDetails(null); setBriefRepairDraft(null); setProductType(initialProduct); setScale(nextScale); setTextAdventureWizard(createDefaultTextAdventureProductionWizardValueV1(nextScale)); props.onProductSelected?.(initialProduct); setSuggestions([]); setSourceOptions(null); setSelectionDefaults({}); setSourceSelection(null); setDraft(null); setMessage(''); setError('') }} className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent"><Plus className="h-3.5 w-3.5" />新建 Production</button>
      <div className="mt-4 grid gap-2">{productions.map(row => <button key={row.id} onClick={() => void refresh(row.id)} className={`rounded border p-3 text-left ${selectedProductionId === row.id ? 'border-accent bg-accent/10' : 'border-border bg-bg-base'}`}><strong className="block truncate text-xs">{row.title}</strong><span className="mt-1 flex items-center justify-between text-[9px] text-text-muted"><code>{row.productionKey}</code><em className="not-italic text-accent">{statusLabel(row.status)}</em></span></button>)}{productions.length === 0 && <p className="rounded border border-dashed border-border p-4 text-[10px] leading-relaxed text-text-muted">还没有 Production。会谈只读取冻结 WorldRelease，不会在后台自动开始制作。</p>}</div>
    </aside>
    <main className="min-w-0 p-5 md:p-8">
      {(message || error) && <div role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} className={`mb-5 flex items-start gap-2 rounded border p-3 text-xs ${error ? 'border-error/30 bg-error/5 text-error' : 'border-success/30 bg-success/5 text-success'}`}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || message}</span></div>}
      {commandActivity && <div role="status" aria-live="polite" data-testid="product-production-command-activity" className={`mb-5 rounded border p-3 text-[10px] ${commandActivity.status === 'succeeded' ? 'border-success/30 bg-success/5 text-success' : commandActivity.status === 'conflict' ? 'border-error/30 bg-error/5 text-error' : 'border-accent/30 bg-accent/5 text-accent'}`}><strong>{commandActivity.label} · {commandActivity.status === 'pending' ? 'pending' : commandActivity.status === 'succeeded' ? 'succeeded' : 'conflict / failed'}</strong><span className="mt-1 block">{commandActivity.detail}</span></div>}
      {(busy || productionRunning) && <div role="status" aria-live="polite" aria-busy="true" className="mb-5 flex items-center gap-2 text-xs text-accent"><Loader2 className="h-4 w-4 animate-spin" />{productionRunning ? '内容、视觉、音频、装配与质检正在按 DAG 自动推进…' : '正在执行受治理的制作步骤…'}</div>}
      {(details?.production.productType ?? productType) === 'text-adventure' && <Suspense fallback={<section className="mb-5 rounded border border-border bg-bg-elevated p-5 text-xs text-text-muted">正在载入文字冒险产品包校验器…</section>}><TextAdventurePackagePanel
        scope={props.scope}
        productReleaseId={details?.production.productType === 'text-adventure'
          ? details.production.currentProductReleaseId : null}
        onImported={() => props.onPublished?.('text-adventure')}
      /></Suspense>}
      {!details ? <>
        <header className="mb-6 border-b border-border pb-5"><small className="font-mono text-[9px] tracking-widest text-accent">CONSULT → BRIEF → AUTHORIZE</small><h1 className="mt-2 font-serif text-2xl">从冻结世界版本开始制作</h1><p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">先选择来源和起点，系统生成可审查 Brief。只有点击“保存 Brief”并再次“授权开始”后，才会创建 Build。</p></header>
        <section className="grid gap-4 rounded border border-border bg-bg-elevated p-5 md:grid-cols-2">
          <label className="grid gap-2 text-[10px] text-text-muted">冻结 WorldRelease<select aria-label="冻结 WorldRelease" value={worldReleaseId ?? ''} onChange={event => { setWorldReleaseId(Number(event.target.value) || null); setSuggestions([]); setSourceOptions(null); setSelectionDefaults({}); setSourceSelection(null); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">{releases.map(release => <option key={release.reference.releaseUid} value={release.reference.localReleaseRecordId}>v{release.reference.releaseVersion} · {release.label}</option>)}</select></label>
          <label className="grid gap-2 text-[10px] text-text-muted">产品形态<select aria-label="产品形态" disabled={props.allowedProducts.length === 1} value={productType} onChange={event => { const next = event.target.value as SupportedProduct; if (!props.allowedProducts.includes(next)) return; const nextScale = next === 'text-adventure' ? 'short-arc' : 'scene'; setProductType(next); setScale(nextScale); setTextAdventureWizard(createDefaultTextAdventureProductionWizardValueV1(nextScale)); props.onProductSelected?.(next); setVisualLevel(next === 'avg' || next === 'ttrpg' || next === 'text-adventure' ? 'key-scenes' : 'none'); setAudioLevel(next === 'avg' ? 'music-sfx' : 'none'); setConfirmTtrpgDefaultMappings(false); void loadTtrpgProductionWizardV2().then(module => setTtrpgWizard(module.createDefaultTtrpgProductionWizardValueV2())); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary disabled:opacity-70">{props.allowedProducts.map(kind => <option key={kind} value={kind}>{PRODUCT_LABELS[kind]}</option>)}</select><span>{productType === 'ttrpg' ? '跑团使用自己的需求适配器、规则、战役、媒资和运行协议；世界事实只从冻结 WorldRelease 渐进读取。' : productType === 'text-adventure' ? '文字冒险拥有独立的叙事、规则、媒资、Build、Release 与运行状态；只读引用冻结 WorldRelease。' : '每种产品使用自己的需求适配器和生产图，共享中立世界协议但不共享业务表。'}</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">制作质量<select value={qualityProfile} onChange={event => { setQualityProfile(event.target.value as ProductProductionBriefV3['qualityProfile']); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="prototype">原型 · 内置占位素材</option><option value="internal">内部评审 · Agnes 就绪则生成图片</option><option value="commercial-candidate">商业候选 · 生成正式图片并完成质量门</option></select><span>始终复用“设置”中的全局 AI 配置。Agnes 文字与图片共用同一个 API Key，图片自动切换到专用模型，不会要求你再次填写。</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">游戏标题<input value={title} onChange={event => setTitle(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" placeholder="会谈后可修改" /></label>
          <div className={`rounded border p-3 text-[10px] leading-5 md:col-span-2 ${capabilityReadiness.text.ready && requestedCommercialImageReady && requestedCommercialAudioReady ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`} data-testid="product-production-capability-readiness"><strong className="block text-xs">{capabilityReadiness.text.ready ? '文本生成能力已就绪' : '文本生成能力未就绪'}</strong><span>{capabilityReadiness.text.ready ? `将直接复用 ${capabilityReadiness.text.provider} / ${capabilityReadiness.text.model}，无需再次填写 API Key。` : capabilityReadiness.text.issue}</span>{['avg', 'ttrpg', 'text-adventure'].includes(productType) && (productType === 'ttrpg' ? (ttrpgWizard?.maximumGeneratedAssets ?? 1) > 0 : visualLevel !== 'none') && <span className="block">{capabilityReadiness.image.ready ? `图片能力已就绪：复用同一 Agnes Key，自动调用 ${capabilityReadiness.image.model}。` : capabilityReadiness.mediaRelayReady ? `Agnes 图片不可用，将使用已绑定媒体中继${capabilityReadiness.mediaRelayOrigin ? `：${capabilityReadiness.mediaRelayOrigin}` : ''}。` : capabilityReadiness.image.issue}</span>}{productType === 'avg' && audioLevel !== 'none' && <span className="block">{capabilityReadiness.mediaRelayReady ? `音乐与音效能力已绑定${capabilityReadiness.mediaRelayOrigin ? `：${capabilityReadiness.mediaRelayOrigin}` : ''}。` : 'Agnes 当前公开接口未提供独立音乐/SFX 生成；选择商业音频时仍需绑定音频能力，或改为静音。'}</span>}</div>
          <label className="grid gap-2 text-[10px] text-text-muted">玩家身份 / 主角<input value={playerRole} maxLength={300} onChange={event => { setPlayerRole(event.target.value); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" placeholder="例如：扮演港口守灯人；或与某角色同行" /></label>
          <label className="grid gap-2 text-[10px] text-text-muted">游戏规模<select aria-label="游戏规模" value={scale} onChange={event => { const next = event.target.value as ProductProductionScaleV1['scope']; setScale(next); if (productType === 'text-adventure') setTextAdventureWizard(createDefaultTextAdventureProductionWizardValueV1(next)); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="scene">体验切片 · 约 20 分钟</option><option value="short-arc">完整短篇 · 约 60 分钟</option><option value="chapter">完整章节 · 约 120 分钟</option>{productType !== 'text-adventure' && <><option value="multi-chapter">多章节</option><option value="campaign">长线战役</option></>}</select><span>{productType === 'text-adventure' ? '当前正式生产限定 20–120 分钟，优先保证一条完整主线、可解释分支和足量内容。' : '规模会冻结到 Brief 并约束预算和内容量。'}</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted md:col-span-2">你想玩的第一幕与核心目标<textarea value={openingSituation} maxLength={2000} rows={4} onChange={event => { setOpeningSituation(event.target.value); setDraft(null) }} className="rounded border border-border bg-bg-base p-3 text-xs text-text-primary" placeholder="例如：主角在港口封锁前收到失踪导师的信号，必须决定先救人还是公开真相。" /><span>这是后续内容、美术和音频拆分共同遵守的用户目标，不会被 Agent 自行替换。</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">视觉目标<select disabled={!['avg', 'ttrpg', 'text-adventure'].includes(productType)} value={visualLevel} onChange={event => { setVisualLevel(event.target.value as 'none' | 'key-scenes' | 'illustrated'); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary disabled:opacity-50"><option value="none">纯文字</option><option value="key-scenes">关键插图</option>{productType === 'text-adventure' && <option value="illustrated">丰富插图</option>}</select><span>{productType === 'text-adventure' ? qualityProfile === 'prototype' ? '主支线拆分后生成视觉圣经和需求清单；占位素材失败时完整降级为纯文字。' : '生产期生成并冻结产品自有插图，玩家界面按叙事节拍加载；首版不在运行期动态出图。' : productType === 'avg' || productType === 'ttrpg' ? qualityProfile === 'prototype' ? '内容会自主拆分美术需求；原型档使用明确标记的安全占位素材。' : '内容拆分需求后，直接复用全局图片能力并行制作并接入玩家界面。' : '当前产品以专用文字舞台为主。'}</span></label>
          <label className="grid gap-2 text-[10px] text-text-muted">音频目标<select disabled={productType !== 'avg'} value={audioLevel} onChange={event => { setAudioLevel(event.target.value as 'none' | 'music-sfx'); setDraft(null) }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary disabled:opacity-50"><option value="none">静音</option><option value="music-sfx">主题音 + 关键音效</option></select><span>{audioLevel === 'music-sfx' ? qualityProfile === 'commercial-candidate' ? '音乐与音效需要独立音频能力，并和内容、美术并行，完成后自动接入 Cue。' : '音频与内容、美术并行；未绑定外部音频时使用明确标记的程序化 WAV。' : '不制作音频，游戏仍可完整通关。'}</span></label>
          {productType === 'ttrpg' && <>{ttrpgWizard ? <Suspense fallback={<div className="rounded border border-border bg-bg-base p-4 text-xs text-text-muted md:col-span-2">正在载入跑团九步向导…</div>}><TtrpgProductionWizard scope={props.scope} value={ttrpgWizard} sourceOptions={sourceOptions} sourceSelection={sourceSelection} onChange={next => { setTtrpgWizard(next); setConfirmTtrpgDefaultMappings(next.confirmAll); setDraft(null) }} /></Suspense> : <div className="rounded border border-border bg-bg-base p-4 text-xs text-text-muted md:col-span-2">正在载入跑团九步向导…</div>}<label className="flex items-start gap-2 rounded border border-border bg-bg-base p-3 text-[10px] leading-5 text-text-muted md:col-span-2"><input type="checkbox" checked={confirmTtrpgDefaultMappings} disabled={!ttrpgWizard} onChange={event => { setConfirmTtrpgDefaultMappings(event.target.checked); setTtrpgWizard(current => current ? ({ ...current, confirmAll: event.target.checked }) : current); setDraft(null) }} className="mt-1" /><span><strong className="block text-xs text-text-primary">确认第一方规则默认映射</strong>同时确认九步向导末页列出的世界边界、规则许可、AI 身份披露和媒资权利；未确认时 Brief 保持阻塞。</span></label></>}
          {productType === 'text-adventure' && <TextAdventureProductionWizard value={textAdventureWizard} onChange={next => { setTextAdventureWizard(next); setDraft(null) }} />}
          <details className="rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted md:col-span-2"><summary className="cursor-pointer text-xs text-text-primary">内容边界与世界约束（可选）</summary><div className="mt-3 grid gap-3 md:grid-cols-3"><label className="grid gap-1">必须保留的事实<textarea rows={3} value={requiredFactsText} onChange={event => { setRequiredFactsText(event.target.value); setDraft(null) }} placeholder="每行一项" className="rounded border border-border bg-bg-elevated p-2" /></label><label className="grid gap-1">禁止改变<textarea rows={3} value={forbiddenChangesText} onChange={event => { setForbiddenChangesText(event.target.value); setDraft(null) }} placeholder="每行一项" className="rounded border border-border bg-bg-elevated p-2" /></label><label className="grid gap-1">内容边界<textarea rows={3} value={contentBoundariesText} onChange={event => { setContentBoundariesText(event.target.value); setDraft(null) }} placeholder="每行一项" className="rounded border border-border bg-bg-elevated p-2" /></label></div></details>
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
          {sourceOptions && sourceSelection && <details className="mt-4 rounded border border-border bg-bg-elevated p-4" data-testid="product-production-source-selector">
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
        {draft && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Brief v3 审查摘要</h2><code className="text-[9px] text-accent">{draft.intent.productType} / {draft.qualityProfile}</code></div><div className="mt-4 grid gap-3 text-[10px] md:grid-cols-3"><article className="rounded bg-bg-base p-3"><strong className="block text-xs">体验</strong><p className="mt-1 text-text-muted">{draft.intent.openingSituation}</p></article><article className="rounded bg-bg-base p-3"><strong className="block text-xs">规模</strong><p className="mt-1 text-text-muted">{draft.scale.targetPlayMinutes} 分钟 · {draft.scale.targetEndingCount} 结局</p>{draft.textAdventure && <p className="mt-1 text-text-muted">{draft.textAdventure.narrative.targetRegionCount} 大区域 / {draft.textAdventure.narrative.targetAreaCount} 区域 / {draft.textAdventure.narrative.targetLocationCount} 地点 / {draft.textAdventure.narrative.targetSceneCount} 场景</p>}</article><article className="rounded bg-bg-base p-3"><strong className="block text-xs">完成合同</strong><p className="mt-1 text-text-muted">可玩预览 · 媒资覆盖 {Math.round(draft.completionContract.minimumMediaCoverage * 100)}% · {draft.media.imageCount} 张图片</p>{draft.textAdventure && <p className="mt-1 text-text-muted">主线 1 · 支线 {draft.textAdventure.narrative.targetSideQuestCount} · 区域事件 {draft.textAdventure.narrative.targetAmbientEventCount} · {draft.textAdventure.media.mode}</p>}</article></div>{selectedSuggestion && <p className="mt-4 text-[10px] text-text-muted">起点冲突：{selectedSuggestion.openingConflict}</p>}<p className="mt-2 text-[10px] text-text-muted" data-testid="product-production-source-selection-summary">本次通过世界网关冻结 {draft.source.selection.resourceKeys.length} 项语义资源（{frozenSourceFacetSummary(draft, sourceOptions)}）；上层叙事、媒资和运行状态均由产品 Build 自己拥有。</p>{draft.unresolvedDecisionKeys.length > 0 && <p className="mt-2 rounded border border-error/30 bg-error/5 p-2 text-[10px] text-error">待确认：{draft.unresolvedDecisionKeys.join('、')}</p>}</section>}
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
        <section className="mt-5 grid gap-3 md:grid-cols-4"><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">BRIEF</small><strong className="mt-1 block text-sm">{details.brief ? `r${details.brief.revision} · ${statusLabel(details.brief.status)}` : '未建立'}</strong></article><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">BUILD</small><strong className="mt-1 block text-sm">{details.build ? `#${details.build.buildNumber} · ${statusLabel(details.build.status)}` : '等待授权'}</strong></article><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">ARTIFACTS</small><strong className="mt-1 block text-sm">{details.artifactCount} 个版本</strong></article><article className="rounded border border-border bg-bg-elevated p-4"><small className="text-[9px] text-text-muted">RELEASE</small><strong className="mt-1 block text-sm">{details.production.currentProductReleaseId ? `#${details.production.currentProductReleaseId}` : '未发布'}</strong></article></section>
        <section className="mt-5 rounded border border-border bg-bg-elevated p-5">
          <h2 className="text-sm font-semibold">下一步</h2>
          <p className="mt-2 text-[10px] leading-5 text-text-muted">一次作者授权会启动整套自动制作；正式文本任务直接复用“设置”里的全局 AI 配置，不另收 API Key。每一步都有 CAS、scope、epoch 和 hash 复验。</p>
          {details.production.status === 'brief-ready' && authorizationReadiness && !authorizationReadiness.ready && <div className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error" data-testid="product-production-authorization-blocker"><strong className="block">能力未绑定，尚未创建 Build</strong><span className="mt-1 block">{authorizationReadiness.blockerMessages.join('；')}</span></div>}
          {sourceDecisionBlocker && <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-4 text-[10px] text-text-primary" data-testid="text-adventure-source-decision-blocker"><strong className="block text-xs">来源编辑已完成审查，等待作者决策</strong>{sourceDecision?.decision === 'ready-with-private-additions' ? <><p className="mt-2 leading-5 text-text-muted">冻结世界资料可以支撑主线，但需要以下内容仅作为本游戏私域事实补充。接受后不会回写或改变 WorldRelease。</p><ul className="mt-2 grid gap-2">{sourceDecision.privateAdditions.map(item => <li key={item.key} className="rounded bg-bg-base p-2"><strong>{item.title}</strong><span className="ml-2 text-text-muted">{item.rationale}</span></li>)}</ul></> : <><p className="mt-2 leading-5 text-error">来源中存在阻断缺口或事实冲突，系统禁止用 AI 私自补写来绕过。</p><ul className="mt-2 grid gap-1 text-text-muted">{sourceDecision?.gaps.map(gap => <li key={gap}>· {gap}</li>)}</ul></>}<p className="mt-3 text-text-muted">若不接受，请取消本 Build，返回来源选择或缩小产品范围后重新授权；系统不会原地改写已授权 Brief。</p></div>}
          {mediaAnchorBlocker && <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-4 text-[10px] text-text-primary" data-testid="text-adventure-media-anchor-blocker">
            <strong className="block text-xs">美术总监已完成视觉圣经，等待作者确认角色锚点</strong>
            <p className="mt-2 leading-5 text-text-muted">确认后，每张插图会把下列身份、视觉特征和色板作为不可弱化约束；未经确认不会调用图片 Provider。</p>
            {!commercialTextAdventureMediaPlanReady && <p className="mt-2 rounded border border-error/30 bg-error/5 p-3 text-error" data-testid="text-adventure-media-plan-blocker">当前旧 Build 只计划 {selectedBrief?.media.imageCount ?? 0} 张图片，低于社区推荐关键插图档的 {commercialTextAdventureImageMinimum} 张底线。不得继续消耗图片额度；请取消此 Build，并用修正后的商业 Brief 重新授权。已完成工件仍保留供审计。</p>}
            {mediaAnchor ? <><p className="mt-2 rounded bg-bg-base p-2"><strong>整体风格：</strong>{mediaAnchor.style}</p><ul className="mt-2 grid gap-2">{mediaAnchor.characterAnchors.map(anchor => <li key={anchor.characterKey} className="rounded border border-border bg-bg-base p-3"><span className="flex flex-wrap items-center gap-2"><strong>{anchor.name}</strong><em className="not-italic text-accent">{anchor.role}</em><span className="text-text-muted">{anchor.identity}</span></span><p className="mt-1 leading-5 text-text-muted">{anchor.visualAnchor}</p><span className="mt-2 flex gap-1" aria-label={`${anchor.name} 色板`}>{anchor.palette.map(color => <i key={color} title={color} className="h-4 w-4 rounded border border-border" style={{ backgroundColor: color }} />)}</span></li>)}</ul></> : <p className="mt-2 text-error">视觉圣经读取失败；请保留当前 Build 并检查工件。</p>}
            <p className="mt-3 text-text-muted">若不接受，请取消本 Build，再以“视觉”演化目标创建新版。确认只对当前冻结视觉圣经 hash 有效。</p>
          </div>}
          {commercialMediaRepairAvailable && <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-4 text-[10px] leading-5 text-text-primary" data-testid="text-adventure-commercial-media-repair">
            <strong className="block text-xs">旧 Build 已安全取消，可以在同一 Production 修订</strong>
            <p className="mt-2 text-text-muted">系统只提升商业媒资计划，不改 WorldRelease、冻结来源、故事目标、玩法合同或旧工件。修订候选保存后仍需作者再次授权，才会创建 Build #{(details.build?.buildNumber ?? 0) + 1}。</p>
            {activeBriefRepairDraft && <div className="mt-3 grid gap-2 sm:grid-cols-3" data-testid="text-adventure-commercial-media-repair-diff">
              <span className="rounded bg-bg-base p-2">图片：{selectedBrief?.media.imageCount ?? 0} → <strong>{activeBriefRepairDraft.media.imageCount}</strong></span>
              <span className="rounded bg-bg-base p-2">媒资调用上限：{selectedBrief?.productionBudget.maximumMediaCalls ?? 0} → <strong>{activeBriefRepairDraft.productionBudget.maximumMediaCalls}</strong></span>
              <span className="rounded bg-bg-base p-2">来源 hash：<strong>保持不变</strong></span>
            </div>}
          </div>}
          {canRetryBlocker && <div className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error"><strong className="block">自动制作停在可恢复边界</strong><span className="mt-1 block">{blockerSummary || '执行能力返回失败；可检查全局 AI 配置后重试。'}</span></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {details.production.status === 'brief-ready' && <button disabled={busy || productionRunning || authorizationReadiness?.ready !== true} onClick={authorize} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" />作者授权并开始自动制作</button>}
            {details.build && ['authorized', 'building'].includes(details.build.status) && !productionRunning && <button disabled={busy} onClick={build} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white"><PackageCheck className="h-3.5 w-3.5" />继续自动制作</button>}
            {sourceDecision?.decision === 'ready-with-private-additions' && <button disabled={busy || productionRunning} onClick={() => resolveSourceDecision('accept-product-private-expansion')} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" />接受私域补充并继续</button>}
            {sourceDecision?.decision === 'blocked' && <button disabled={busy || productionRunning} onClick={retrySourceReview} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />按产品边界重新审查</button>}
            {sourceDecisionBlocker && <button disabled={busy || productionRunning} onClick={() => resolveSourceDecision('cancel')} className="flex items-center gap-2 rounded border border-error/40 px-4 py-2 text-xs text-error disabled:opacity-40"><Square className="h-3.5 w-3.5" />取消本次 Build</button>}
            {mediaAnchorBlocker && mediaAnchor && <button disabled={busy || productionRunning || !commercialTextAdventureMediaPlanReady} onClick={() => resolveMediaAnchorDecision('confirm-character-anchors')} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" />确认角色锚点并开始出图</button>}
            {mediaAnchorBlocker && <button disabled={busy || productionRunning} onClick={() => resolveMediaAnchorDecision('cancel')} className="flex items-center gap-2 rounded border border-error/40 px-4 py-2 text-xs text-error disabled:opacity-40"><Square className="h-3.5 w-3.5" />拒绝并取消 Build</button>}
            {commercialMediaRepairAvailable && !activeBriefRepairDraft && <button disabled={busy || productionRunning} onClick={prepareCommercialMediaBriefRepair} className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent disabled:opacity-40"><FileCheck2 className="h-3.5 w-3.5" />生成 12 图修订 Brief</button>}
            {commercialMediaRepairAvailable && activeBriefRepairDraft && <button disabled={busy || productionRunning} onClick={saveCommercialMediaBriefRepair} className="flex items-center gap-2 rounded bg-success px-4 py-2 text-xs text-white disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" />保存为 Brief r{(details.brief?.revision ?? 0) + 1}</button>}
            {canRetryBlocker && <button disabled={busy || productionRunning} onClick={retryBlocker} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white"><RefreshCw className="h-3.5 w-3.5" />修正后重试</button>}
            {details.build && ['preview-ready', 'release-ready', 'released'].includes(details.build.status) && <button disabled={busy || productionRunning} onClick={preview} className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent"><Play className="h-3.5 w-3.5" />{details.build.status === 'released' ? '试玩此 Build' : '试玩未发布 Build'}</button>}
            {details.build?.status === 'release-ready' && <button disabled={busy || productionRunning || (commercialPerformanceRequired && !commercialQualityPassed)} onClick={publish} className="flex items-center gap-2 rounded bg-success px-4 py-2 text-xs text-white disabled:opacity-40"><Rocket className="h-3.5 w-3.5" />复验并原子发布</button>}
            {details.production.status === 'released' && <button disabled={busy} onClick={() => props.onPublished?.(details.production.productType)} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white"><Gamepad2 className="h-3.5 w-3.5" />进入玩家模式</button>}
          </div>
        </section>
        {progress && progress.tasks.length > 0 && <section aria-live="polite" className="mt-5 rounded border border-border bg-bg-elevated p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">自动制作任务</h2><code className="text-[9px] text-text-muted">Build #{progress.buildNumber} · epoch {progress.controlEpoch}</code></div>
          <div className="mt-4 rounded border border-border bg-bg-base p-3" data-testid="product-production-overall-progress"><span className="flex items-center justify-between gap-3 text-[10px]"><strong>总任务进度 {overallTaskProgress.percent}%</strong><span className="text-text-muted">{overallTaskProgress.completed}/{overallTaskProgress.total} 个 durable task 已签收</span></span><progress aria-label="文字冒险总任务进度" className="mt-2 w-full" max={100} value={overallTaskProgress.percent}>{overallTaskProgress.percent}%</progress><p className="mt-2 text-[9px] text-text-muted">{overallTaskProgress.active.length > 0 ? `正在执行：${overallTaskProgress.active.join('、')}` : progress.terminal ? '全部计划任务已完成，等待后续人工发布门。' : '等待依赖或作者处理当前闸门。'}{overallTaskProgress.totalVisual > 0 ? ` · 视觉素材 ${overallTaskProgress.completedVisual}/${overallTaskProgress.totalVisual} 已生成并签收` : ''}</p></div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid="product-production-lane-progress">{laneProgress.map(lane => {
            const percent = lane.total ? Math.round(lane.completed / lane.total * 100) : 0
            return <article key={lane.lane} className="rounded border border-border bg-bg-base p-3">
              <span className="flex items-center justify-between text-[10px]"><strong>{lane.lane}</strong><em className="not-italic text-text-muted">{lane.completed}/{lane.total}</em></span>
              <progress aria-label={`${lane.lane} 泳道进度`} className="mt-2 w-full" max={100} value={percent}>{percent}%</progress>
              <p className="mt-1 text-[9px] text-text-muted">运行 {lane.running} · 阻塞 {lane.blocked}</p>
            </article>
          })}</div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4" data-testid="product-production-budget-usage">
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">模型调用</span><strong className="mt-1 block">{progress.budget.usage.modelCalls} / {progress.budget.limits.maximumModelCalls}</strong></article>
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">媒资调用</span><strong className="mt-1 block">{progress.budget.usage.mediaCalls} / {progress.budget.limits.maximumMediaCalls}</strong></article>
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">成本</span><strong className="mt-1 block">{progress.budget.usage.costUsd == null ? '供应商未回传' : `$${progress.budget.usage.costUsd.toFixed(4)}`} / {progress.budget.limits.maximumCostUsd == null ? '未设金额上限' : `$${progress.budget.limits.maximumCostUsd.toFixed(2)}`}</strong></article>
            <article className="rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">持久化媒资</span><strong className="mt-1 block">{formatBytes(progress.budget.usage.storageBytes)} / {formatBytes(progress.budget.limits.maximumStorageBytes)}</strong></article>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{progress.tasks.map(task => {
            const presentation = productionTaskPresentation(task.taskKey)
            return <article key={task.taskKey} className="rounded border border-border bg-bg-base p-3"><span className="flex items-center justify-between gap-2"><strong className="text-[10px]">{presentation.label}</strong><em className={`not-italic text-[9px] ${task.status === 'completed' ? 'text-success' : task.status === 'blocked' ? 'text-error' : 'text-accent'}`}>{statusLabel(task.status)}</em></span><p className="mt-1 text-[9px] text-text-muted">{presentation.owner}</p><code className="mt-1 block text-[8px] text-text-muted">{task.taskKey}</code><p className="mt-2 text-[9px] text-text-muted">{task.lane} · attempt {task.attempt || '—'}{task.blocker ? ` · ${task.blocker}` : ''}</p></article>
          })}</div>
        </section>}
        {details?.production.productType === 'text-adventure' && reviewArtifacts.length > 0 && <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="text-adventure-author-workbench">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">文字冒险工件审查台</h2><p className="mt-1 text-[10px] leading-5 text-text-muted">每项均来自当前 Build 的已采纳或跨版本复用工件。展开可核对内容和来源 hash；试玩与发布仍是显式作者闸门。</p></div><span className="rounded bg-accent/10 px-2 py-1 text-[9px] text-accent">{reviewArtifacts.length} 项 · Build #{details.build?.buildNumber}</span></div>
          <div className="mt-4 grid gap-2">{reviewArtifacts.map(artifact => <details key={`${artifact.artifactKey}:${artifact.version}`} className="rounded border border-border bg-bg-base p-3">
            <summary className="cursor-pointer list-none"><span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">{reviewArtifactLabel(artifact.artifactKey)}</strong><span className="text-[9px] text-text-muted">v{artifact.version} · {artifact.status === 'carried-forward' ? '沿用前版' : '当前生成'} · {formatBytes(artifact.byteSize)}</span></span><span className="mt-1 block font-mono text-[9px] text-text-muted">{artifact.artifactKey} · {compactHash(artifact.contentHash)}</span></summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg-surface p-3 text-[9px] leading-5 text-text-muted">{JSON.stringify(artifact.payload, null, 2)}</pre>
          </details>)}</div>
          <p className="mt-3 text-[10px] leading-5 text-text-muted">需要修改时，在下方“继续演化下一版”描述局部目标并只勾选受影响泳道；依赖 hash 未变化的工件会保留，旧 Build 与存档不会被覆盖。</p>
        </section>}
        {details?.production.productType === 'text-adventure' && mediaAssets.length > 0 && <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="text-adventure-media-authoring">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">插图素材、独立质检与作者逐图验收</h2><p className="mt-1 max-w-3xl text-[10px] leading-5 text-text-muted">每次替换、锁定、解锁或单项重生成都会派生新 Build；旧 Preview、Release 与存档不会被覆盖。商业候选必须依次通过需求绑定审计、独立多模态 Visual QA 和作者逐图确认，任何一层都不能替代另一层。</p></div><span className="rounded bg-accent/10 px-2 py-1 text-[9px] text-accent">{mediaAssets.length} 张冻结图片</span></div>
          {commercialHumanVisualRequired && <div className="mt-4 grid gap-2 text-[10px] md:grid-cols-3" data-testid="text-adventure-visual-review-layers">
            <div className={`rounded border p-3 ${mediaAuditPassed ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`}><strong>① 需求与绑定审计</strong><span className="mt-1 block">{mediaAuditPassed ? '已通过' : '未通过或缺失'}</span></div>
            <div className={`rounded border p-3 ${visualReviewStatus === 'passed' ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`}><strong>② 独立 Visual QA</strong><span className="mt-1 block">{visualReviewStatus === 'passed' ? '已实际观察并通过' : visualReviewStatus || '未通过或缺失'}</span></div>
            <div className={`rounded border p-3 ${commercialHumanVisualPassed ? 'border-success/30 bg-success/5 text-success' : 'border-accent/30 bg-accent/5 text-accent'}`}><strong>③ 作者逐图确认</strong><span className="mt-1 block">{commercialHumanVisualPassed ? '已冻结不可变回执' : '等待逐张判断'}</span></div>
          </div>}
          <div className="mt-4 grid gap-3 rounded border border-border bg-bg-base p-3 text-[10px] md:grid-cols-2">
            <label className="grid gap-1"><span>作者图片许可</span><input value={mediaLicense} onChange={event => setMediaLicense(event.target.value)} maxLength={500} className="rounded border border-border bg-bg-surface px-3 py-2" /></label>
            <label className="grid gap-1"><span>权利声明</span><input value={mediaDeclaration} onChange={event => setMediaDeclaration(event.target.value)} maxLength={4000} className="rounded border border-border bg-bg-surface px-3 py-2" /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={mediaCommercialUse} onChange={event => setMediaCommercialUse(event.target.checked)} />我确认允许商业使用</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={mediaRedistribution} onChange={event => setMediaRedistribution(event.target.checked)} />我确认允许随导出包与社区作品再分发</label>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{mediaAssets.map(asset => <article key={`${asset.artifactKey}:${asset.version}`} className="overflow-hidden rounded border border-border bg-bg-base">
            <TextAdventureMediaThumbnail scope={props.scope} asset={asset} />
            <div className="p-3 text-[10px]"><span className="flex items-center justify-between gap-2"><strong className="text-xs">{String(asset.metadata.name ?? asset.artifactKey)}</strong><em className={`not-italic ${asset.locked ? 'text-accent' : 'text-text-muted'}`}>{asset.locked ? '已锁定' : '可重生成'}</em></span><p className="mt-1 text-text-muted">{asset.assetKey} · {asset.artifactKey} · {asset.mimeType} · {formatBytes(asset.byteSize)}</p><p className="mt-1 text-text-muted">{String(asset.metadata.source ?? 'unknown')} · {String(asset.metadata.license ?? asset.rights.license ?? '未声明许可')}</p><code className="mt-1 block text-[9px]" title={asset.contentHash}>{compactHash(asset.contentHash)}</code>
              <div className="mt-3 flex flex-wrap gap-2"><label className={`flex cursor-pointer items-center gap-1 rounded border border-accent/40 px-2 py-1 text-accent ${(busy || productionRunning) ? 'pointer-events-none opacity-40' : ''}`}><Upload className="h-3 w-3" />上传替换<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy || productionRunning} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void reviseMediaAsset(asset, 'upload-replacement', file) }} /></label>{asset.locked ? <button disabled={busy || productionRunning} onClick={() => reviseMediaAsset(asset, 'unlock')} className="flex items-center gap-1 rounded border border-border px-2 py-1 disabled:opacity-40"><Unlock className="h-3 w-3" />解锁</button> : <><button disabled={busy || productionRunning} onClick={() => reviseMediaAsset(asset, 'lock')} className="flex items-center gap-1 rounded border border-border px-2 py-1 disabled:opacity-40"><Lock className="h-3 w-3" />锁定</button><button disabled={busy || productionRunning} onClick={() => reviseMediaAsset(asset, 'regenerate')} className="flex items-center gap-1 rounded border border-border px-2 py-1 disabled:opacity-40"><RefreshCw className="h-3 w-3" />重生成此图</button></>}</div>
              {commercialHumanVisualRequired && <fieldset className="mt-3 rounded border border-border bg-bg-surface p-3" data-testid={`text-adventure-human-visual-${asset.artifactKey}`}><legend className="px-1 font-semibold">作者对当前冻结图片的判断</legend><div className="flex gap-2"><button type="button" aria-pressed={humanVisualDecisions[asset.artifactKey] === 'approved'} onClick={() => setHumanVisualDecisions(current => ({ ...current, [asset.artifactKey]: 'approved' }))} className={`rounded border px-3 py-1 ${humanVisualDecisions[asset.artifactKey] === 'approved' ? 'border-success bg-success/10 text-success' : 'border-border'}`}>接受此图</button><button type="button" aria-pressed={humanVisualDecisions[asset.artifactKey] === 'rejected'} onClick={() => setHumanVisualDecisions(current => ({ ...current, [asset.artifactKey]: 'rejected' }))} className={`rounded border px-3 py-1 ${humanVisualDecisions[asset.artifactKey] === 'rejected' ? 'border-error bg-error/10 text-error' : 'border-border'}`}>退回修改</button></div><label className="mt-2 grid gap-1"><span>审查备注{humanVisualDecisions[asset.artifactKey] === 'rejected' ? '（退回必填）' : '（可选）'}</span><textarea value={humanVisualNotes[asset.artifactKey] ?? ''} onChange={event => setHumanVisualNotes(current => ({ ...current, [asset.artifactKey]: event.target.value }))} maxLength={2000} rows={2} placeholder="说明构图、角色一致性、剧透、文字伪影或其他问题" className="rounded border border-border bg-bg-base p-2" /></label></fieldset>}
            </div>
          </article>)}</div>
          {commercialHumanVisualRequired && <div className="mt-4 rounded border border-border bg-bg-base p-4 text-[10px]" data-testid="text-adventure-human-visual-review"><strong className="block">冻结作者逐图审查</strong><p className="mt-1 leading-5 text-text-muted">回执绑定当前 Build、Preview、需求审计、独立 Visual QA、每张 Artifact/Blob hash。任何图片修订都会使旧回执失效。退回决定也会保存，但不会解锁发布。</p>{humanVisualGateError && <p className="mt-2 text-error">当前回执无法复验：{humanVisualGateError}</p>}{humanVisualGate && <p className={`mt-2 ${humanVisualGate.evidence.passed ? 'text-success' : 'text-error'}`}>最新回执：{humanVisualGate.evidence.passed ? '全部接受' : `${humanVisualGate.evidence.assets.filter(asset => asset.decision === 'rejected').length} 张退回`} · {compactHash(humanVisualGate.gateReceipt.receiptHash)}</p>}<button disabled={busy || productionRunning || visualReviewStatus !== 'passed' || !mediaAuditPassed || !humanVisualDecisionsComplete} onClick={confirmHumanVisualReview} className="mt-3 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">冻结本次逐图审查回执</button></div>}
        </section>}
        {canEvolve && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-accent" /><h2 className="text-sm font-semibold">继续演化下一版</h2></div><p className="mt-2 text-[10px] leading-5 text-text-muted">描述希望增加、延续或改变的体验。旧 Build、Release 和存档不会被改写；提交后先生成新的可审查 Brief，不会直接调用模型。</p><textarea value={evolutionGoal} onChange={event => setEvolutionGoal(event.target.value)} maxLength={2000} rows={4} placeholder="例如：从当前结局继续，让配角成为新主角，增加一条调查旧港失踪案的支线，并保留已经发生的选择后果。" className="mt-4 w-full rounded border border-border bg-bg-base p-3 text-xs text-text-primary" /><fieldset className="mt-3 flex flex-wrap gap-3 text-[10px] text-text-muted"><legend className="mb-2">本轮影响范围（未勾选且依赖未变化的产物可复用）</legend>{([['content', '剧情内容'], ['product', '玩法模块'], ['visual', '美术'], ['audio', '音乐/音效'], ['runtime', '装配/运行时']] as const).map(([lane, label]) => <label key={lane} className="flex items-center gap-1.5"><input type="checkbox" checked={evolutionLanes.includes(lane)} onChange={event => setEvolutionLanes(current => event.target.checked ? [...new Set([...current, lane])] : current.filter(item => item !== lane))} />{label}</label>)}</fieldset><button disabled={busy || productionRunning || !evolutionGoal.trim() || evolutionLanes.length === 0} onClick={evolve} className="mt-3 flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent disabled:opacity-40"><GitBranch className="h-3.5 w-3.5" />生成下一轮 Brief</button></section>}
        {compatibility && <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="product-production-compatibility"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">存档兼容报告</h2><strong className={`text-[10px] ${compatibility.level === 'compatible' ? 'text-success' : compatibility.level === 'breaking' ? 'text-error' : 'text-accent'}`}>{compatibility.level === 'compatible' ? '可兼容' : compatibility.level === 'breaking' ? '破坏性变化' : '建议重开'}</strong></div><p className="mt-2 text-[10px] leading-5 text-text-muted">{compatibility.fromBuildNumber == null ? '首个 Build，无旧存档需要迁移。' : `Build #${compatibility.fromBuildNumber} → #${compatibility.toBuildNumber} · ${compatibility.migrationPolicy}`}</p><ul className="mt-3 grid gap-1 text-[10px] text-text-muted">{compatibility.reasons.map(reason => <li key={reason}>· {reason}</li>)}</ul>{compatibility.level === 'breaking' && <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">旧存档继续固定在旧 packageHash；系统不会静默迁移或覆盖。</p>}</section>}
        <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="product-production-version-history">
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">版本 lineage 与命令回执</h2><span className="text-[9px] text-text-muted">刷新后仍来自 IndexedDB 权威投影</span></div>
          <div className="mt-4 grid gap-2 lg:grid-cols-2">
            <div><h3 className="text-[10px] font-semibold">Brief / Build / Release</h3><div className="mt-2 grid gap-2">{details.buildHistory.map(buildRow => <article key={buildRow.id} className="rounded bg-bg-base p-3 text-[10px]"><span className="flex items-center justify-between"><strong>Build #{buildRow.buildNumber}</strong><em className="not-italic text-accent">{statusLabel(buildRow.status)}</em></span><p className="mt-1 text-text-muted">Brief r{buildRow.briefRevision} · parent {buildRow.parentBuildNumber == null ? '—' : `#${buildRow.parentBuildNumber}`} · Release {buildRow.releasedProductReleaseId == null ? '—' : `#${buildRow.releasedProductReleaseId}`}</p><code className="mt-1 block" title={buildRow.packageHash}>{compactHash(buildRow.packageHash)}</code></article>)}</div></div>
            <div><h3 className="text-[10px] font-semibold">最近命令 receipt</h3><div className="mt-2 grid gap-2">{details.recentCommands.map(command => <article key={command.id} className="rounded bg-bg-base p-3 text-[10px]"><span className="flex items-center justify-between"><strong>{command.type}</strong><em className={`not-italic ${command.status === 'succeeded' ? 'text-success' : command.status === 'claimed' ? 'text-accent' : 'text-error'}`}>{command.status === 'claimed' ? 'pending' : command.status}</em></span><code className="mt-1 block text-text-muted" title={command.commandId}>{command.commandId}</code>{command.errorCode && <p className="mt-1 text-error">{command.errorCode}</p>}</article>)}{details.recentCommands.length === 0 && <p className="rounded border border-dashed border-border p-3 text-[10px] text-text-muted">尚无命令 receipt。</p>}</div></div>
          </div>
        </section>
        {details.build && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">冻结证据链</h2><span className="flex items-center gap-1 text-[9px] text-success"><ShieldCheck className="h-3.5 w-3.5" />Canonical JSON v2</span></div><p className="mt-3 text-[9px] leading-5 text-text-muted">商业浏览器验收：缓存场景 p95 ≤ {PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumCachedSceneP95Ms}ms、选择输入 p95 ≤ {PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumChoiceInputP95Ms}ms、桌面峰值堆内存 ≤ {Math.round(PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumDesktopHeapBytes / 1024 / 1024)}MiB、30 分钟稳定增长 ≤ {Math.round(PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.maximumLongRunGrowthRatio * 100)}%。Smoke 不会被标成商业通过。</p>{performanceGateError ? <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">浏览器性能回执损坏：{performanceGateError}</p> : performanceGate ? <div className={`mt-3 rounded border p-3 text-[10px] ${performanceGate.gateReceipt.status === 'passed' ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`} data-testid="product-production-performance-receipt"><strong>{performanceGate.gateReceipt.status === 'passed' ? '真实浏览器性能已通过' : '最新浏览器测量未通过'}</strong><p className="mt-1">场景 p95 {performanceGate.evidence.receipt.metrics.cachedSceneP95Ms?.toFixed(1) ?? '—'}ms · 输入 p95 {performanceGate.evidence.receipt.metrics.choiceInputP95Ms?.toFixed(1) ?? '—'}ms · 峰值堆 {performanceGate.evidence.receipt.metrics.peakUsedHeapBytes == null ? '—' : `${(performanceGate.evidence.receipt.metrics.peakUsedHeapBytes / 1024 / 1024).toFixed(1)}MiB`} · 长跑 {(performanceGate.evidence.receipt.metrics.longRunDurationMs / 60_000).toFixed(1)} 分钟</p>{performanceGate.evidence.receipt.failures.length > 0 && <p className="mt-1">失败项：{performanceGate.evidence.receipt.failures.join('、')}</p>}<code className="mt-1 block">{compactHash(performanceGate.gateReceipt.receiptHash)}</code></div> : <p className="mt-3 rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted">当前 Build 尚无浏览器性能回执。</p>}<div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{buildHashRows.map(([label, hash]) => <div key={label} className="flex items-center justify-between rounded bg-bg-base p-3 text-[10px]"><span className="text-text-muted">{label}</span><code title={hash}>{compactHash(hash)}</code></div>)}</div>{details.build.rootTerminalReceiptHash && <p className="mt-4 text-[10px] text-text-muted">终端 receipt：<code>{compactHash(details.build.rootTerminalReceiptHash)}</code></p>}</section>}
        {commercialPerformanceRequired && details.build && <section className="mt-5 rounded border border-border bg-bg-elevated p-5"><h2 className="text-sm font-semibold">作者主路线试玩回执</h2><p className="mt-2 text-[10px] leading-5 text-text-muted">这里不是“点一下算通过”：系统会重放当前 Build 预览存档的起点、每次选择和结局，再由作者明确确认。</p>{playthroughGateError ? <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">主路线回执无法验证：{playthroughGateError}</p> : playthroughGate ? <div className="mt-3 rounded border border-success/30 bg-success/5 p-3 text-[10px] text-success" data-testid="product-production-playthrough-receipt"><strong className="block">主路线试玩已由作者确认</strong><span className="mt-1 block">结局 {playthroughGate.evidence.endingKey} · {playthroughGate.evidence.choiceCount} 次选择 · 事件流 {compactHash(playthroughGate.evidence.eventStreamHash)}</span><code className="mt-1 block">{compactHash(playthroughGate.gateReceipt.receiptHash)}</code></div> : <p className="mt-3 rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted">{completedPlaythroughs.length > 0 ? `已检测到 ${completedPlaythroughs.length} 个到达结局的当前 Build 预览存档，等待作者确认。` : '尚未检测到当前 Build 的完整主路线试玩。'}</p>}</section>}
        {commercialHumanPlaytestRequired && details.build && <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="text-adventure-human-playtest-review">
          <h2 className="text-sm font-semibold">真人试玩覆盖验收</h2>
          <p className="mt-2 text-[10px] leading-5 text-text-muted">商业文字冒险必须由作者和一名未参与生产的玩家，分别从两个不同新会话完整通关。系统冻结真实起止时间、每次选择与行动、主观评分和文字反馈；同一事件流不能重复冒充两种身份。公开代号、评分与反馈会进入社区候选证据，请勿填写真实姓名或隐私。</p>
          {humanPlaytestGateError && <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">真人试玩回执无法复验：{humanPlaytestGateError}</p>}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {([['作者', humanPlaytestAuthor], ['独立玩家', humanPlaytestIndependent]] as const).map(([label, session]) => <article key={label} className={`rounded border p-3 text-[10px] ${session?.passed ? 'border-success/30 bg-success/5 text-success' : session ? 'border-error/30 bg-error/5 text-error' : 'border-border bg-bg-base text-text-muted'}`}><strong>{label}</strong><span className="mt-1 block">{session ? `${Math.round(session.elapsedMs / 60_000)} 分钟 · ${session.choiceCount} 选择 · ${session.meaningfulActionCount}/${session.actionCount} 有效/总行动 · ${session.dialogueActionCount} 交谈 · ${session.passed ? '通过' : '未通过'}` : '尚无完整回执'}</span>{session && <code className="mt-1 block">{compactHash(session.sessionEvidenceHash)}</code>}</article>)}
          </div>
          {humanPlaytestGate && <p className={`mt-3 rounded border p-3 text-[10px] ${humanPlaytestGate.evidence.passed ? 'border-success/30 bg-success/5 text-success' : 'border-accent/30 bg-accent/5 text-accent'}`}>覆盖状态：{humanPlaytestGate.evidence.passed ? '双角色均通过' : humanPlaytestGate.gateReceipt.status === 'failed' ? '最新角色证据未达标' : '仍缺另一角色'} · receipt {compactHash(humanPlaytestGate.gateReceipt.receiptHash)}</p>}
          <div className="mt-4 grid gap-3 text-[10px] md:grid-cols-2">
            <label className="grid gap-1"><span>选择完整试玩会话</span><select value={humanPlaytestSessionId ?? ''} onChange={event => setHumanPlaytestSessionId(event.target.value ? Number(event.target.value) : null)} className="rounded border border-border bg-bg-base p-2"><option value="">请选择</option>{completedPlaythroughs.map(item => <option key={item.sessionId} value={item.sessionId}>会话 #{item.sessionId} · {Math.round(item.elapsedMs / 60_000)} 分钟 · {item.choiceCount} 选择 · {item.meaningfulActionCount}/{item.actionCount} 有效/总行动 · {item.endingKey}</option>)}</select></label>
            <label className="grid gap-1"><span>试玩者身份</span><select value={humanPlaytestRole} onChange={event => { const role = event.target.value as 'author' | 'independent-player'; setHumanPlaytestRole(role); setHumanPlaytestParticipantLabel(role === 'author' ? '作者' : ''); setHumanPlaytestIndependenceConfirmed(false) }} className="rounded border border-border bg-bg-base p-2"><option value="author">作者</option><option value="independent-player">未参与生产的独立玩家</option></select></label>
          </div>
          <label className="mt-3 grid gap-1 text-[10px]"><span>试玩者公开代号（建议匿名昵称）</span><input value={humanPlaytestParticipantLabel} onChange={event => setHumanPlaytestParticipantLabel(event.target.value)} maxLength={200} className="rounded border border-border bg-bg-base p-2" /></label>
          {humanPlaytestRole === 'independent-player' && <label className="mt-3 flex items-start gap-2 rounded border border-border bg-bg-base p-3 text-[10px]"><input type="checkbox" checked={humanPlaytestIndependenceConfirmed} onChange={event => setHumanPlaytestIndependenceConfirmed(event.target.checked)} /><span>我确认该试玩者未参与本 Build 的故事、任务、脚本、美术或质量生产，只依据玩家界面独立完成本次会话。</span></label>}
          {selectedHumanPlaytest && <p className="mt-3 rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted">实测 {Math.round(selectedHumanPlaytest.elapsedMs / 60_000)} 分钟（目标区间 {Math.round(selectedBrief!.scale.targetPlayMinutes * 0.75)}–{Math.round(selectedBrief!.scale.targetPlayMinutes * 1.25)} 分钟）· {selectedHumanPlaytest.choiceCount}/{Math.max(2, Math.ceil(selectedBrief!.scale.targetPlayMinutes / 6))} 选择 · {selectedHumanPlaytest.meaningfulActionCount}/{Math.max(6, Math.ceil(selectedBrief!.scale.targetPlayMinutes / 4))} 个不同有效行动（总操作 {selectedHumanPlaytest.actionCount}）· {selectedHumanPlaytest.dialogueActionCount} 交谈</p>}
          {selectedHumanPlaytestClaimedByOtherRole && <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">这个事件流已经由另一身份签收，不能重复使用；请启动一个全新的 Build Preview 会话。</p>}
          <fieldset className="mt-4"><legend className="font-semibold">1–5 分主观评价（3 分为最低通过线）</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{([['comprehension', '目标与规则理解'], ['pacing', '节奏'], ['agency', '选择能动性'], ['emotionalImpact', '情绪触达']] as const).map(([key, label]) => <label key={key} className="grid gap-1"><span>{label}</span><select aria-label={label} value={humanPlaytestRatings[key]} onChange={event => setHumanPlaytestRatings(current => ({ ...current, [key]: Number(event.target.value) }))} className="rounded border border-border bg-bg-base p-2"><option value={0}>请选择</option>{[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score} 分</option>)}</select></label>)}</div></fieldset>
          <div className="mt-4 grid gap-3 md:grid-cols-2">{([['comprehensionObstacles', '理解障碍'], ['boringMoments', '无聊或拖沓点'], ['errors', '错误或异常'], ['choiceExperience', '选择与后果感受'], ['endingFeedback', '结局反馈']] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-[10px]"><span>{label}（没有时明确写“无”）</span><textarea value={humanPlaytestFeedback[key]} onChange={event => setHumanPlaytestFeedback(current => ({ ...current, [key]: event.target.value }))} rows={2} maxLength={2000} className="rounded border border-border bg-bg-base p-2" /></label>)}</div>
          <label className="mt-3 grid gap-1 text-[10px]"><span>尚未关闭的 blocking 问题（每行一项；没有则留空）</span><textarea value={humanPlaytestBlockingIssues} onChange={event => setHumanPlaytestBlockingIssues(event.target.value)} rows={2} maxLength={4000} className="rounded border border-border bg-bg-base p-2" /></label>
          <label className="mt-3 grid gap-1 text-[10px]"><span>补充说明（可选）</span><textarea value={humanPlaytestNote} onChange={event => setHumanPlaytestNote(event.target.value)} rows={2} maxLength={4000} className="rounded border border-border bg-bg-base p-2" /></label>
          <button disabled={busy || productionRunning || !selectedHumanPlaytest || !humanPlaytestFormComplete || selectedHumanPlaytestClaimedByOtherRole} onClick={recordHumanPlaytest} className="mt-4 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">冻结本次真人试玩证据</button>
        </section>}
        {commercialPerformanceRequired && details.build?.status === 'preview-ready' && !commercialPerformancePassed && <section className="mt-5 rounded border border-error/30 bg-error/5 p-4 text-[10px] text-error" data-testid="product-production-performance-blocker">
          <strong className="block">商业发布等待真实浏览器性能验收</strong>
          <span className="mt-1 block">{performanceGateError || (performanceGate ? `最新回执未通过：${performanceGate.evidence.receipt.failures.join('、') || 'unknown'}。短时 smoke 不能解锁发布。` : '当前 Build 尚无浏览器性能回执。')}</span>
          <p className="mt-2 leading-5 text-text-muted">验收会加载当前 Build 的冻结媒资，执行至少 20 次真实 DOM 选择与缓存场景切换，并持续 30 分钟采集浏览器堆内存。请保持此页面与浏览器窗口打开；可随时停止，停止不会写入通过回执。</p>
          <div ref={performanceLabHost} className={`mt-3 ${performanceLabRunning ? 'block' : 'hidden'}`} data-testid="product-production-performance-lab-surface" />
          {performanceLabProgress && <div className="mt-3 rounded border border-border bg-bg-base p-3 text-text-muted" data-testid="product-production-performance-lab-progress">
            <span className="flex items-center justify-between gap-2"><strong>{performanceLabProgress.phase === 'preparing' ? '准备媒资' : performanceLabProgress.phase === 'warmup' ? '预热' : performanceLabProgress.phase === 'recording' ? '冻结回执' : '长期稳定性采样'}</strong><code>{formatDurationMs(performanceLabProgress.elapsedMs)} / {formatDurationMs(performanceLabProgress.durationMs)}</code></span>
            <progress aria-label="浏览器性能验收进度" className="mt-2 w-full" max={performanceLabProgress.durationMs} value={Math.min(performanceLabProgress.elapsedMs, performanceLabProgress.durationMs)} />
            <span className="mt-2 block">场景 {performanceLabProgress.sceneSamples} · 输入 {performanceLabProgress.inputSamples} · 内存 {performanceLabProgress.memorySamples}；最新 {performanceLabProgress.latestSceneLatencyMs?.toFixed(1) ?? '—'}ms / {performanceLabProgress.latestInputLatencyMs?.toFixed(1) ?? '—'}ms / {performanceLabProgress.latestHeapBytes == null ? '—' : `${(performanceLabProgress.latestHeapBytes / 1024 / 1024).toFixed(1)}MiB`}</span>
          </div>}
          <div className="mt-3 flex flex-wrap gap-2">{performanceLabRunning
            ? <button onClick={stopBrowserPerformanceLab} className="rounded border border-error/40 bg-bg-base px-4 py-2 text-xs text-error">停止性能验收</button>
            : <button disabled={busy || productionRunning} onClick={() => void startBrowserPerformanceLab()} className="rounded bg-error px-4 py-2 text-xs text-white disabled:opacity-40">开始 30 分钟商业性能验收</button>}</div>
        </section>}
        {commercialPerformanceRequired && details.build?.status === 'preview-ready' && !commercialPlaythroughPassed && <section className="mt-5 rounded border border-error/30 bg-error/5 p-4 text-[10px] text-error" data-testid="product-production-playthrough-blocker"><strong className="block">商业发布等待作者完成主路线试玩</strong><span className="mt-1 block">{playthroughGateError || (completedPlaythroughs.length > 0 ? `最新完整试玩已到达结局 ${completedPlaythroughs[0].endingKey}；实际用时 ${Math.round(completedPlaythroughs[0].elapsedMs / 60_000)} 分钟、${completedPlaythroughs[0].choiceCount} 次选择、${completedPlaythroughs[0].actionCount} 次行动、${completedPlaythroughs[0].dialogueActionCount} 次交谈。${commercialHumanPlaytestRequired ? '请在上方“真人试玩覆盖验收”中以作者身份填写质量反馈；提交时会同时冻结主路线回执。' : '确认后将冻结事件流回执。'}` : '请点击“试玩未发布 Build”，实际选择到达一个结局，再回到制作页。')}</span>{completedPlaythroughs.length > 0 && !playthroughGateError && !commercialHumanPlaytestRequired && <button disabled={busy || productionRunning} onClick={confirmMainRoutePlaythrough} className="mt-3 rounded bg-error px-4 py-2 text-xs text-white disabled:opacity-40">确认本次主路线试玩并冻结回执</button>}</section>}
        {commercialHumanPlaytestRequired && details.build?.status === 'preview-ready' && !commercialHumanPlaytestPassed && <section className="mt-5 rounded border border-error/30 bg-error/5 p-4 text-[10px] text-error" data-testid="text-adventure-human-playtest-blocker"><strong className="block">商业发布等待双角色真人试玩</strong><span className="mt-1 block">{humanPlaytestGateError || (humanPlaytestGate?.gateReceipt.status === 'failed' ? '最新作者或独立玩家会话未满足真实时长、交互量、最低 3 分或零 blocking 问题要求。' : `作者：${humanPlaytestAuthor?.passed ? '已通过' : '未通过或缺失'}；独立玩家：${humanPlaytestIndependent?.passed ? '已通过' : '未通过或缺失'}。两者必须使用不同的完整会话。`)}</span></section>}
        {commercialHumanVisualRequired && details.build?.status === 'preview-ready' && !commercialHumanVisualPassed && <section className="mt-5 rounded border border-error/30 bg-error/5 p-4 text-[10px] text-error" data-testid="text-adventure-human-visual-blocker"><strong className="block">商业发布等待作者逐图确认</strong><span className="mt-1 block">{humanVisualGateError || (humanVisualGate ? `最新回执退回了 ${humanVisualGate.evidence.assets.filter(asset => asset.decision === 'rejected').length} 张图片；请修订后在新 Build 重新审查。` : '请在“插图素材、独立质检与作者逐图验收”中检查每张实际图片并冻结回执。')}</span></section>}
        {commercialMediaRuntimeRequired && details.build && <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="product-production-media-runtime-receipt"><h2 className="text-sm font-semibold">真实浏览器媒资验收</h2><p className="mt-2 text-[10px] leading-5 text-text-muted">打开当前 Build 预览时，系统会自动解码每个冻结图片和音频对象，核对 hash/尺寸/透明度，并从 WebAudio PCM 计算声道、采样率、LUFS、true peak 与循环接缝。这里验证的是技术可显示性；逐图审美与内容确认在插图素材区独立完成。</p>{mediaRuntimeGateError ? <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">媒资回执无法验证：{mediaRuntimeGateError}</p> : mediaRuntimeGate ? <div className={`mt-3 rounded border p-3 text-[10px] ${mediaRuntimeGate.evidence.passed ? 'border-success/30 bg-success/5 text-success' : 'border-error/30 bg-error/5 text-error'}`}><strong className="block">{mediaRuntimeGate.evidence.passed ? '全部冻结媒资已解码并通过商业规格' : '最新媒资解码或商业规格存在失败'}</strong><span className="mt-1 block">通过 {mediaRuntimeGate.evidence.assets.filter(asset => asset.status === 'decoded' && asset.policyFailures.length === 0).length}/{mediaRuntimeGate.evidence.assets.length} · receipt {compactHash(mediaRuntimeGate.gateReceipt.receiptHash)}</span>{!mediaRuntimeGate.evidence.passed && <span className="mt-1 block">失败：{mediaRuntimeGate.evidence.assets.filter(asset => asset.status === 'failed' || asset.policyFailures.length > 0).map(asset => `${asset.assetKey}:${asset.failureCode ?? asset.policyFailures.join('+')}`).join('、')}</span>}</div> : <p className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">商业发布等待媒资浏览器验收。请点击“试玩未发布 Build”；进入{PRODUCT_LABELS[selectedBrief.intent.productType]}后会自动检查，无需额外操作。</p>}</section>}
      </>}
    </main>
  </div>
}
