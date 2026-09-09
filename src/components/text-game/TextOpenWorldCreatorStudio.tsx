import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Database,
  FileSearch,
  FileText,
  Globe2,
  Loader2,
  LockKeyhole,
  Sparkles,
} from 'lucide-react'
import {
  inspectTextOpenWorldCreatorNovelSourceV1,
  inspectTextOpenWorldCreatorWorldSourceV1,
  listTextOpenWorldCreatorNovelSourceCatalogV1,
  listTextOpenWorldCreatorWorldSourcesV1,
} from '../../lib/open-world/creator-source'
import { parseProductProductionHandoffV1 } from '../../lib/product-production/handoff'
import type {
  AdaptationSourceSelectionV1,
  ProductProductionHandoffV1,
  TextOpenWorldCreatorNovelSourceCatalogV1,
  TextOpenWorldCreatorNovelSourcePreviewV1,
  TextOpenWorldCreatorSourceGapV1,
  TextOpenWorldCreatorSourceReadinessV1,
  TextOpenWorldCreatorWorldSourceCandidateV1,
  WorkspaceScope,
} from '../../lib/types'

export type CreatorSourceKindV1 = 'world-release' | 'novel'

export type TextOpenWorldCreatorStudioSelectionV1 =
  | {
      sourceKind: 'world-release'
      sourceScope: WorkspaceScope
      localReleaseRecordId: number
      expectedReleaseHash: string
      preview: TextOpenWorldCreatorWorldSourceCandidateV1
    }
  | {
      sourceKind: 'novel'
      sourceScope: WorkspaceScope
      selection: AdaptationSourceSelectionV1
      preview: TextOpenWorldCreatorNovelSourcePreviewV1
    }

export interface TextOpenWorldCreatorStudioProps {
  /** Stage-one world context. It is deliberately independent from novelScope. */
  worldScope?: WorkspaceScope | null
  /** Current author-owned novel Work context. It may belong to another project. */
  novelScope?: WorkspaceScope | null
  /** Routing identity only; never used to infer either source owner. */
  worldGroupId?: number | null
  initialSource?: ProductProductionHandoffV1 | null
  initialSourceKind?: CreatorSourceKindV1
  onContinue?: (selection: TextOpenWorldCreatorStudioSelectionV1) => void
}

const SOURCE_KINDS: CreatorSourceKindV1[] = ['world-release', 'novel']

const AREA_LABELS: Record<string, string> = {
  foundation: '世界基础',
  story: '故事素材',
  characters: '角色',
  relations: '关系',
  entities: '地点与实体',
  storylines: '故事线',
  outline: '大纲',
  'detailed-outline': '细纲',
  manuscript: '正文',
  'multi-world': '多世界',
}

const REQUIREMENT_STATUS_LABELS: Record<string, string> = {
  matched: '已满足',
  missing: '缺失',
  conflict: '存在冲突',
  omitted: '未选择',
  insufficient: '数量不足',
}

const CAPABILITY_STATUS_LABELS: Record<string, string> = {
  available: '可用',
  partial: '部分可用',
  missing: '缺失',
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function safeError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error) || !cause.message.trim()) return fallback
  return cause.message.replace(/^\[[^\]]+\]\s*/, '').slice(0, 300)
}

function stableHandoffJson(value: ProductProductionHandoffV1 | null | undefined): string {
  if (value == null) return ''
  const row = value as unknown
  if (!row || typeof row !== 'object' || Array.isArray(row)) return JSON.stringify(row) ?? String(row)
  const source = row as Record<string, unknown>
  return JSON.stringify(Object.fromEntries(
    Object.keys(source).sort().map(key => [key, source[key]]),
  ))
}

function readinessLabel(value: TextOpenWorldCreatorSourceReadinessV1): string {
  if (value === 'ready') return '可进入会谈'
  if (value === 'ready-with-gaps') return '可继续，但建议补充'
  return '当前阻断'
}

function coverageLabel(value: 'full-text' | 'outline-only'): string {
  return value === 'full-text' ? '含可用正文' : '仅故事核心与大纲'
}

function GapList(props: { gaps: TextOpenWorldCreatorSourceGapV1[] }) {
  if (!props.gaps.length) {
    return <div className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-success">
      <CheckCircle2 className="mr-2 inline h-4 w-4" aria-hidden="true" />
      当前来源没有阻断或建议缺口。
    </div>
  }
  return <div className="space-y-2" aria-label="来源缺口">
    {props.gaps.map((gap, index) => <article
      key={`${gap.severity}:${gap.title}:${index}`}
      className={`rounded-lg border p-3 ${gap.severity === 'blocking'
        ? 'border-danger/35 bg-danger/5'
        : gap.severity === 'warning'
          ? 'border-warning/35 bg-warning/5'
          : 'border-border bg-bg-base'}`}
    >
      <div className="flex items-start gap-2">
        {gap.severity === 'blocking'
          ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
        <span>
          <strong className="block text-xs text-text-primary">{gap.title}</strong>
          <small className="mt-1 block leading-5 text-text-muted">{gap.detail}</small>
        </span>
      </div>
    </article>)}
  </div>
}

function ReadinessBadge(props: { value: TextOpenWorldCreatorSourceReadinessV1 }) {
  return <span
    data-testid="creator-source-readiness"
    className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${props.value === 'blocked'
      ? 'border-danger/40 bg-danger/10 text-danger'
      : props.value === 'ready-with-gaps'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-success/40 bg-success/10 text-success'}`}
  >{readinessLabel(props.value)}</span>
}

export function TextOpenWorldCreatorStudio(props: TextOpenWorldCreatorStudioProps) {
  const worldProjectId = props.worldScope?.projectId ?? null
  const worldId = props.worldScope?.worldId ?? null
  const worldWorkId = props.worldScope?.workId ?? null
  const novelProjectId = props.novelScope?.projectId ?? null
  const novelWorldId = props.novelScope?.worldId ?? null
  const novelWorkId = props.novelScope?.workId ?? null
  const worldScope = useMemo<WorkspaceScope | null>(() => (
    worldProjectId == null || worldId == null || worldWorkId == null
      ? null
      : { projectId: worldProjectId, worldId, workId: worldWorkId }
  ), [worldProjectId, worldId, worldWorkId])
  const novelScope = useMemo<WorkspaceScope | null>(() => (
    novelProjectId == null || novelWorldId == null || novelWorkId == null
      ? null
      : { projectId: novelProjectId, worldId: novelWorldId, workId: novelWorkId }
  ), [novelProjectId, novelWorldId, novelWorkId])
  const initialSourceJson = stableHandoffJson(props.initialSource)
  const hasInitialSource = initialSourceJson !== ''
  const initialKind: CreatorSourceKindV1 = hasInitialSource
    ? 'world-release'
    : props.initialSourceKind ?? (worldScope ? 'world-release' : 'novel')
  const initialIntentKey = hasInitialSource
    ? `world:${initialSourceJson}`
    : `kind:${props.initialSourceKind ?? ''}`
  const [sourceKind, setSourceKind] = useState<CreatorSourceKindV1>(initialKind)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [worldSources, setWorldSources] = useState<TextOpenWorldCreatorWorldSourceCandidateV1[] | null>(null)
  const [selectedWorldId, setSelectedWorldId] = useState<number | null>(null)
  const [worldPreview, setWorldPreview] = useState<TextOpenWorldCreatorWorldSourceCandidateV1 | null>(null)
  const [novelCatalog, setNovelCatalog] = useState<TextOpenWorldCreatorNovelSourceCatalogV1 | null>(null)
  const [novelMode, setNovelMode] = useState<AdaptationSourceSelectionV1['mode']>('entire-work')
  const [outlineNodeId, setOutlineNodeId] = useState<number | null>(null)
  const [rangeStartId, setRangeStartId] = useState<number | null>(null)
  const [rangeEndId, setRangeEndId] = useState<number | null>(null)
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([])
  const [novelPreview, setNovelPreview] = useState<TextOpenWorldCreatorNovelSourcePreviewV1 | null>(null)
  const requestGeneration = useRef(0)
  const routeIntentKey = useRef(initialIntentKey)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const invalidateRequest = () => {
    requestGeneration.current += 1
    setLoading(false)
  }

  const clearWorldState = () => {
    setWorldSources(null)
    setSelectedWorldId(null)
    setWorldPreview(null)
  }

  const clearNovelState = () => {
    setNovelCatalog(null)
    setNovelMode('entire-work')
    setOutlineNodeId(null)
    setRangeStartId(null)
    setRangeEndId(null)
    setSelectedChapterIds([])
    setNovelPreview(null)
  }

  const activateSource = (next: CreatorSourceKindV1) => {
    if (next === sourceKind) return
    invalidateRequest()
    setError('')
    if (next === 'novel') clearWorldState()
    else clearNovelState()
    setSourceKind(next)
  }

  useEffect(() => {
    if (routeIntentKey.current === initialIntentKey) return
    routeIntentKey.current = initialIntentKey
    requestGeneration.current += 1
    setLoading(false)
    setError('')
    clearWorldState()
    clearNovelState()
    setSourceKind(hasInitialSource ? 'world-release' : props.initialSourceKind ?? initialKind)
  }, [hasInitialSource, initialIntentKey, initialKind, props.initialSourceKind])

  useEffect(() => {
    const generation = ++requestGeneration.current
    setLoading(true)
    setError('')

    const load = async () => {
      try {
        if (sourceKind === 'world-release') {
          clearWorldState()
          let handoff: ProductProductionHandoffV1 | null = null
          if (initialSourceJson) {
            handoff = parseProductProductionHandoffV1(JSON.parse(initialSourceJson))
            if (handoff.productType !== 'text-open-world') {
              throw new Error('该来源交接不属于文字开放世界，不能在此继续。')
            }
          }
          if (!worldScope) {
            if (handoff) throw new Error('来源交接缺少对应的世界工作区，不能核验版本归属。')
            if (generation === requestGeneration.current) setWorldSources([])
            return
          }
          const sources = await listTextOpenWorldCreatorWorldSourcesV1(worldScope)
          if (generation !== requestGeneration.current) return
          setWorldSources(sources)
          if (!handoff) return
          const matched = sources.find(item => (
            item.worldReference.localReleaseRecordId === handoff.worldReleaseId
          ))
          if (!matched || matched.worldReference.releaseHash !== handoff.worldContentHash) {
            throw new Error('来源交接的世界版本或完整 Hash 已失效，请重新选择。')
          }
          setSelectedWorldId(handoff.worldReleaseId)
          const inspected = await inspectTextOpenWorldCreatorWorldSourceV1({
            scope: worldScope,
            localReleaseRecordId: handoff.worldReleaseId,
            expectedReleaseHash: handoff.worldContentHash,
          })
          if (generation !== requestGeneration.current) return
          setWorldPreview(inspected)
        } else {
          clearNovelState()
          if (!novelScope) return
          const catalog = await listTextOpenWorldCreatorNovelSourceCatalogV1(novelScope)
          if (generation !== requestGeneration.current) return
          setNovelCatalog(catalog)
          setOutlineNodeId(catalog.outlines[0]?.id ?? null)
          setRangeStartId(catalog.range.firstChapterId)
          setRangeEndId(catalog.range.lastChapterId)
        }
      } catch (cause) {
        if (generation !== requestGeneration.current) return
        setError(safeError(cause, '来源暂时无法核验，请稍后重试。'))
      } finally {
        if (generation === requestGeneration.current) setLoading(false)
      }
    }
    void load()
    return () => {
      if (generation === requestGeneration.current) requestGeneration.current += 1
    }
  }, [
    sourceKind,
    worldScope,
    novelScope,
    props.worldGroupId,
    initialSourceJson,
  ])

  const selectWorld = async (candidate: TextOpenWorldCreatorWorldSourceCandidateV1) => {
    if (!worldScope) return
    const generation = ++requestGeneration.current
    setSelectedWorldId(candidate.worldReference.localReleaseRecordId)
    setWorldPreview(null)
    setError('')
    setLoading(true)
    try {
      const inspected = await inspectTextOpenWorldCreatorWorldSourceV1({
        scope: worldScope,
        localReleaseRecordId: candidate.worldReference.localReleaseRecordId,
        expectedReleaseHash: candidate.worldReference.releaseHash,
      })
      if (generation === requestGeneration.current) setWorldPreview(inspected)
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(safeError(cause, '世界版本核验失败，请重新选择。'))
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }

  const updateNovelSelection = (operation: () => void) => {
    invalidateRequest()
    setError('')
    setNovelPreview(null)
    operation()
  }

  const currentNovelSelection = (): AdaptationSourceSelectionV1 | null => {
    if (novelMode === 'entire-work') return { mode: 'entire-work' }
    if (novelMode === 'outline-subtree') {
      return outlineNodeId == null ? null : { mode: 'outline-subtree', outlineNodeId }
    }
    if (novelMode === 'chapter-range') {
      return rangeStartId == null || rangeEndId == null
        ? null
        : { mode: 'chapter-range', startChapterId: rangeStartId, endChapterId: rangeEndId }
    }
    return selectedChapterIds.length ? { mode: 'chapters', chapterIds: [...selectedChapterIds] } : null
  }

  const inspectNovel = async () => {
    if (!novelScope) return
    const selection = currentNovelSelection()
    if (!selection) {
      setError('当前小说范围还没有形成有效选择。')
      return
    }
    const generation = ++requestGeneration.current
    setNovelPreview(null)
    setError('')
    setLoading(true)
    try {
      const inspected = await inspectTextOpenWorldCreatorNovelSourceV1({
        sourceScope: novelScope,
        selection,
      })
      if (generation === requestGeneration.current) setNovelPreview(inspected)
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(safeError(cause, '小说候选核验失败，请调整选择。'))
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % SOURCE_KINDS.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + SOURCE_KINDS.length) % SOURCE_KINDS.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = SOURCE_KINDS.length - 1
    else return
    event.preventDefault()
    activateSource(SOURCE_KINDS[nextIndex]!)
    queueMicrotask(() => tabRefs.current[nextIndex]?.focus())
  }

  const continueToBrief = () => {
    if (!props.onContinue) return
    if (sourceKind === 'world-release' && worldScope && worldPreview
      && worldPreview.readiness !== 'blocked') {
      props.onContinue({
        sourceKind,
        sourceScope: worldScope,
        localReleaseRecordId: worldPreview.worldReference.localReleaseRecordId,
        expectedReleaseHash: worldPreview.worldReference.releaseHash,
        preview: worldPreview,
      })
      return
    }
    const selection = currentNovelSelection()
    if (sourceKind === 'novel' && novelScope && novelPreview && selection
      && novelPreview.readiness !== 'blocked') {
      props.onContinue({ sourceKind, sourceScope: novelScope, selection, preview: novelPreview })
    }
  }

  const activePreview = sourceKind === 'world-release' ? worldPreview : novelPreview
  const canContinue = Boolean(props.onContinue && activePreview && activePreview.readiness !== 'blocked')

  return <main
    className="mx-auto w-full max-w-6xl space-y-5 p-4 text-text-primary md:p-6"
    data-testid="text-open-world-creator-studio"
    aria-busy={loading || undefined}
  >
    <header className="rounded-xl border border-border bg-bg-elevated p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.2em] text-accent">TEXT OPEN WORLD · CREATOR</span>
          <h1 className="mt-2 text-xl font-semibold">选择游戏的叙事来源</h1>
          <p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">
            从一个不可变世界版本，或当前小说的受控范围开始。这里只核验可用内容与缺口，不会启动内容生产。
          </p>
        </div>
        <span className="rounded-full border border-border bg-bg-base px-3 py-1.5 text-[10px] text-text-muted">
          阶段二 · 来源确认
        </span>
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs leading-5 text-text-muted" role="note">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <strong className="font-medium text-text-primary">尚未冻结、模型尚未实读、未开始计费和生产。</strong>
        <span>继续后仍需在 G5-02 完成主 Agent 会谈与 Brief 确认，作者明确授权后才会进入正式流程。</span>
      </div>
    </header>

    <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-bg-elevated p-2" role="tablist" aria-label="游戏来源类型">
      {SOURCE_KINDS.map((kind, index) => <button
        key={kind}
        ref={node => { tabRefs.current[index] = node }}
        id={`creator-source-tab-${kind}`}
        type="button"
        role="tab"
        aria-selected={sourceKind === kind}
        aria-controls={`creator-source-panel-${kind}`}
        tabIndex={sourceKind === kind ? 0 : -1}
        className={`flex min-h-14 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${sourceKind === kind
          ? 'bg-accent text-white shadow-sm'
          : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'}`}
        onClick={() => activateSource(kind)}
        onKeyDown={event => onTabKeyDown(event, index)}
      >
        {kind === 'world-release' ? <Globe2 className="h-4 w-4" aria-hidden="true" /> : <BookOpen className="h-4 w-4" aria-hidden="true" />}
        {kind === 'world-release' ? '冻结世界版本' : '小说作品'}
      </button>)}
    </div>

    {loading && <div
      className="flex min-h-24 items-center justify-center gap-3 rounded-xl border border-border bg-bg-elevated text-xs text-text-muted"
      role="status"
      aria-live="polite"
      data-testid="creator-source-loading"
    ><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />正在核验当前来源…</div>}

    {error && <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger" role="alert" data-testid="creator-source-error">
      <CircleAlert className="mr-2 inline h-4 w-4" aria-hidden="true" />{error}
    </div>}

    {sourceKind === 'world-release' && <section
      id="creator-source-panel-world-release"
      role="tabpanel"
      aria-labelledby="creator-source-tab-world-release"
      hidden={sourceKind !== 'world-release'}
      className="space-y-4"
    >
      {!loading && worldSources?.length === 0 && <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-8 text-center" data-testid="creator-world-empty">
        <Globe2 className="mx-auto h-8 w-8 text-text-muted" aria-hidden="true" />
        <h2 className="mt-3 text-sm font-semibold">没有可选择的冻结世界版本</h2>
        <p className="mt-2 text-xs text-text-muted">可切换到小说来源，或先在世界引擎中封存一个完整版本。</p>
      </div>}

      {worldSources && worldSources.length > 0 && <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="冻结世界版本">
        {worldSources.map(source => {
          const selected = source.worldReference.localReleaseRecordId === selectedWorldId
          return <button
            key={source.worldReference.releaseUid}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={loading}
            className={`rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${selected
              ? 'border-accent bg-accent/5'
              : 'border-border bg-bg-elevated hover:border-accent/40'}`}
            onClick={() => void selectWorld(source)}
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <small className="block text-[10px] text-text-muted">{source.worldName} · Release v{source.worldReference.releaseVersion}</small>
                <strong className="mt-1 block text-sm">{source.label}</strong>
                {source.workTitle && <small className="mt-1 block text-[10px] text-text-muted">来源作品：{source.workTitle}</small>}
              </span>
              <ReadinessBadge value={source.readiness} />
            </span>
            <span className="mt-3 block text-[10px] text-text-muted">
              {formatCount(source.resourceCounts.totalResources)} 项语义资源 · {formatCount(source.resourceCounts.totalRows)} 行已封存内容
            </span>
            <code className="mt-2 block break-all text-[9px] leading-4 text-text-muted">完整 Hash：{source.worldReference.releaseHash}</code>
          </button>
        })}
      </div>}

      {worldPreview && <article className="space-y-4 rounded-xl border border-border bg-bg-elevated p-5" data-testid="creator-world-preview">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <small className="text-[10px] text-text-muted">已核验不可变候选</small>
            <h2 className="mt-1 text-base font-semibold">{worldPreview.worldName} · v{worldPreview.worldReference.releaseVersion}</h2>
            <p className="mt-1 text-xs text-text-muted">发布于 {formatDate(worldPreview.releasedAt)}</p>
          </div>
          <ReadinessBadge value={worldPreview.readiness} />
        </header>
        <dl className="grid gap-3 text-xs md:grid-cols-2">
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">WorldRelease 完整 Hash</dt><dd className="mt-1"><code className="break-all text-[10px]">{worldPreview.worldReference.releaseHash}</code></dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">能力目录 Hash</dt><dd className="mt-1"><code className="break-all text-[10px]">{worldPreview.worldReference.capabilityIdentity.catalogHash}</code></dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">语义资源</dt><dd className="mt-1 font-medium">{formatCount(worldPreview.resourceCounts.totalResources)} 项</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">内容行</dt><dd className="mt-1 font-medium">{formatCount(worldPreview.resourceCounts.totalRows)} 行</dd></div>
        </dl>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold"><Database className="h-4 w-4" aria-hidden="true" />能力域</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {worldPreview.capabilities.map(capability => <div key={capability.area} className="rounded-lg border border-border bg-bg-base p-3 text-xs">
              <span className="flex items-center justify-between gap-2"><strong>{AREA_LABELS[capability.area] ?? capability.area}</strong><small className="text-text-muted">{CAPABILITY_STATUS_LABELS[capability.status] ?? capability.status}</small></span>
              <small className="mt-1 block text-text-muted">{capability.resourceCount} 项资源 · {capability.rowCount} 行</small>
            </div>)}
          </div>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold"><FileSearch className="h-4 w-4" aria-hidden="true" />文字开放世界需求核对</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {worldPreview.requirements.map(requirement => <div key={requirement.key} className="rounded-lg border border-border bg-bg-base p-3 text-xs">
              <span className="flex items-center justify-between gap-2"><strong>{requirement.label}</strong><small className="text-text-muted">{REQUIREMENT_STATUS_LABELS[requirement.status] ?? requirement.status}</small></span>
              <small className="mt-1 block text-text-muted">已匹配 {requirement.matchedResourceKeys.length} / 至少 {requirement.minimumResources} 项</small>
            </div>)}
          </div>
        </section>
        <GapList gaps={worldPreview.gaps} />
      </article>}
    </section>}

    {sourceKind === 'novel' && <section
      id="creator-source-panel-novel"
      role="tabpanel"
      aria-labelledby="creator-source-tab-novel"
      hidden={sourceKind !== 'novel'}
      className="space-y-4"
    >
      {!loading && !novelCatalog && !error && <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-8 text-center" data-testid="creator-novel-empty">
        <BookOpen className="mx-auto h-8 w-8 text-text-muted" aria-hidden="true" />
        <h2 className="mt-3 text-sm font-semibold">当前没有可用的小说 Work</h2>
        <p className="mt-2 text-xs text-text-muted">打开一部小说作品后再进入此页面，或改用冻结世界版本。</p>
      </div>}

      {novelCatalog && <article className="space-y-5 rounded-xl border border-border bg-bg-elevated p-5" data-testid="creator-novel-catalog">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <small className="text-[10px] text-text-muted">小说 Work</small>
            <h2 className="mt-1 text-base font-semibold">{novelCatalog.workTitle}</h2>
            <p className="mt-1 text-xs text-text-muted">更新于 {formatDate(novelCatalog.sourceUpdatedAt)}</p>
          </div>
          <ReadinessBadge value={novelCatalog.readiness} />
        </header>
        <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">来源覆盖</dt><dd className="mt-1 font-medium">{coverageLabel(novelCatalog.coverage)}</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">章节</dt><dd className="mt-1 font-medium">{formatCount(novelCatalog.range.chapterCount)} 章</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">大纲</dt><dd className="mt-1 font-medium">{formatCount(novelCatalog.range.outlineCount)} 项</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">整部字数</dt><dd className="mt-1 font-medium">{formatCount(novelCatalog.totalWordCount)} 字</dd></div>
        </dl>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">选择用于设计游戏的小说范围</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['entire-work', '整部小说'],
              ['outline-subtree', '大纲子树'],
              ['chapter-range', '章节范围'],
              ['chapters', '指定章节'],
            ] as const).map(([mode, label]) => <label key={mode} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-xs ${novelMode === mode ? 'border-accent bg-accent/5' : 'border-border bg-bg-base'}`}>
              <input
                type="radio"
                name="text-open-world-novel-mode"
                value={mode}
                checked={novelMode === mode}
                onChange={() => updateNovelSelection(() => setNovelMode(mode))}
              />
              <span>{label}</span>
            </label>)}
          </div>
        </fieldset>

        {novelMode === 'outline-subtree' && <label className="block text-xs text-text-muted">
          大纲根节点
          <select
            className="mt-2 w-full rounded-lg border border-border bg-bg-base p-2 text-text-primary"
            value={outlineNodeId ?? ''}
            onChange={event => updateNovelSelection(() => setOutlineNodeId(Number(event.target.value) || null))}
          >
            {novelCatalog.outlines.map(outline => <option key={outline.id} value={outline.id}>{outline.title}</option>)}
          </select>
        </label>}

        {novelMode === 'chapter-range' && <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-text-muted">起始章节<select className="mt-2 w-full rounded-lg border border-border bg-bg-base p-2 text-text-primary" value={rangeStartId ?? ''} onChange={event => updateNovelSelection(() => setRangeStartId(Number(event.target.value) || null))}>{novelCatalog.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label>
          <label className="text-xs text-text-muted">结束章节<select className="mt-2 w-full rounded-lg border border-border bg-bg-base p-2 text-text-primary" value={rangeEndId ?? ''} onChange={event => updateNovelSelection(() => setRangeEndId(Number(event.target.value) || null))}>{novelCatalog.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select></label>
        </div>}

        {novelMode === 'chapters' && <fieldset className="rounded-lg border border-border bg-bg-base p-3">
          <legend className="px-1 text-xs font-medium">指定章节</legend>
          <div className="mt-2 grid max-h-56 gap-2 overflow-auto sm:grid-cols-2">
            {novelCatalog.chapters.map(chapter => <label key={chapter.id} className="flex items-start gap-2 rounded p-2 text-xs text-text-muted hover:bg-bg-hover">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={selectedChapterIds.includes(chapter.id)}
                onChange={event => updateNovelSelection(() => setSelectedChapterIds(current => event.target.checked
                  ? [...current, chapter.id]
                  : current.filter(id => id !== chapter.id)))}
              />
              <span><strong className="block text-text-primary">{chapter.title}</strong><small>{formatCount(chapter.wordCount)} 字{chapter.hasContent ? '' : ' · 无正文'}</small></span>
            </label>)}
          </div>
        </fieldset>}

        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={loading || currentNovelSelection() == null}
          onClick={() => void inspectNovel()}
        ><FileSearch className="h-4 w-4" aria-hidden="true" />核验小说候选</button>

        {!novelPreview && <GapList gaps={novelCatalog.gaps} />}
      </article>}

      {novelPreview && <article className="space-y-4 rounded-xl border border-accent/30 bg-bg-elevated p-5" data-testid="creator-novel-preview">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div><small className="text-[10px] text-text-muted">已核验候选快照（尚未冻结）</small><h2 className="mt-1 text-base font-semibold">{novelPreview.selection.label}</h2></div>
          <ReadinessBadge value={novelPreview.readiness} />
        </header>
        <dl className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">章节</dt><dd className="mt-1 font-medium">{novelPreview.selection.selectedChapterCount} 章</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">大纲</dt><dd className="mt-1 font-medium">{novelPreview.selection.selectedOutlineCount} 项</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">可用正文</dt><dd className="mt-1 font-medium">{novelPreview.writtenChapterCount} 章</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">候选字数</dt><dd className="mt-1 font-medium">{formatCount(novelPreview.totalWordCount)} 字</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">覆盖</dt><dd className="mt-1 font-medium">{coverageLabel(novelPreview.coverage)}</dd></div>
          <div className="rounded-lg bg-bg-base p-3"><dt className="text-text-muted">候选单元</dt><dd className="mt-1 font-medium">{formatCount(novelPreview.sourceUnitCount)} 项</dd></div>
        </dl>
        <div className="grid gap-3 text-xs md:grid-cols-2">
          <div className="rounded-lg bg-bg-base p-3"><strong className="text-text-muted">候选内容 Hash</strong><code className="mt-2 block break-all text-[10px]">{novelPreview.sourceVersionHash}</code></div>
          <div className="rounded-lg bg-bg-base p-3"><strong className="text-text-muted">选择边界 Hash</strong><code className="mt-2 block break-all text-[10px]">{novelPreview.sourceBoundaryHash}</code></div>
        </div>
        <GapList gaps={novelPreview.gaps} />
      </article>}
    </section>}

    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated p-4">
      <span className="flex items-center gap-2 text-xs text-text-muted"><FileText className="h-4 w-4" aria-hidden="true" />下一步：主 Agent 会谈与 Brief 确认</span>
      <span className="flex items-center gap-3">
        {!props.onContinue && <small className="text-[10px] text-text-muted">G5-02 接口尚未接入</small>}
        <button
          type="button"
          data-testid="creator-source-continue"
          disabled={!canContinue}
          aria-disabled={!canContinue}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          onClick={continueToBrief}
        ><Sparkles className="h-4 w-4" aria-hidden="true" />继续到主 Agent 会谈</button>
      </span>
    </footer>
  </main>
}

export default TextOpenWorldCreatorStudio
