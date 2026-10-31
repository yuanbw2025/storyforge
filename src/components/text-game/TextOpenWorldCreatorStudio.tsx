import TextOpenWorldNovelWorldDraft from './TextOpenWorldNovelWorldDraft'
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
  inspectTextOpenWorldCreatorWorldSourceV1,
  listTextOpenWorldCreatorWorldSourcesV1,
} from '../../lib/open-world/creator-source'
import { parseProductProductionHandoffV1 } from '../../lib/product-production/handoff'
import type {
  ProductProductionHandoffV1,
  TextOpenWorldCreatorSourceGapV1,
  TextOpenWorldCreatorSourceReadinessV1,
  TextOpenWorldCreatorSourceSelectionV1,
  TextOpenWorldCreatorWorldSourceCandidateV1,
  WorkspaceScope,
} from '../../lib/types'

export type CreatorSourceKindV1 = 'world-release' | 'novel'

export type TextOpenWorldCreatorStudioSelectionV1 = TextOpenWorldCreatorSourceSelectionV1

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

  const activateSource = (next: CreatorSourceKindV1) => {
    if (next === sourceKind) return
    invalidateRequest()
    setError('')
    if (next === 'novel') clearWorldState()
    setSourceKind(next)
  }

  useEffect(() => {
    if (routeIntentKey.current === initialIntentKey) return
    routeIntentKey.current = initialIntentKey
    requestGeneration.current += 1
    setLoading(false)
    setError('')
    clearWorldState()
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
  }

  const canContinue = Boolean(props.onContinue && sourceKind === 'world-release'
    && worldPreview && worldPreview.readiness !== 'blocked')

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
            正式制作从已封存的世界版本开始；小说须先显式派生世界草稿、检查并封存。这里不会自动开始内容生产。
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
        {kind === 'world-release' ? '冻结世界版本' : '从小说派生世界'}
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
        <p className="mt-2 text-xs text-text-muted">可先从小说派生独立世界草稿，并在世界页面检查确认、封存；已有世界也可直接封存版本。</p>
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
      id="creator-source-panel-novel" role="tabpanel" aria-labelledby="creator-source-tab-novel"
    ><TextOpenWorldNovelWorldDraft sourceScope={novelScope} /></section>}

    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated p-4">
      <span className="flex items-center gap-2 text-xs text-text-muted"><FileText className="h-4 w-4" aria-hidden="true" />{sourceKind === 'world-release' ? '下一步：主 Agent 会谈与 Brief 确认' : '先检查并封存世界，再回到产品定向'}</span>
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
