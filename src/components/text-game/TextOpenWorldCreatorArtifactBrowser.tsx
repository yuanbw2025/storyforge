import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  pageTextOpenWorldArtifactGovernanceV1,
  readTextOpenWorldArtifactGovernanceV1,
  type TextOpenWorldArtifactBrowserModeV1,
  type TextOpenWorldArtifactEvidenceRefV1,
  type TextOpenWorldArtifactGovernanceProjectionV1,
  type TextOpenWorldArtifactProductionValidationV1,
  type TextOpenWorldGovernedArtifactHealthV1,
  type TextOpenWorldGovernedArtifactV1,
  type TextOpenWorldGovernedEntityV1,
} from '../../lib/open-world/creator-artifact-governance'
import { prepareTextOpenWorldCreatorArtifactEditV1 } from '../../lib/product-production/service'
import type { WorkspaceScope } from '../../lib/types'
import TextOpenWorldCreatorArtifactEditor, {
  type TextOpenWorldCreatorArtifactEditSelectionV1,
} from './TextOpenWorldCreatorArtifactEditor'

export interface TextOpenWorldCreatorArtifactBrowserProps {
  scope: WorkspaceScope
  productionId: number
  refreshToken?: string | number
}

const TABS: ReadonlyArray<{ key: TextOpenWorldArtifactBrowserModeV1; label: string }> = [
  { key: 'content', label: '内容' },
  { key: 'artifacts', label: 'Artifact' },
  { key: 'diagnostics', label: '诊断' },
]

const ENTITY_STATUS_LABELS: Record<TextOpenWorldGovernedEntityV1['status'], string> = {
  verified: '引用完整',
  'pending-reference': '引用待生产',
  dangling: '悬空引用',
}

const HEALTH_LABELS: Record<TextOpenWorldGovernedArtifactHealthV1, string> = {
  verified: '完整性通过',
  pending: '待完成',
  stale: '历史版本',
  invalid: '无效记录',
  corrupt: '内容损坏',
  dangling: '引用悬空',
}

const PRODUCTION_VALIDATION_LABELS: Record<TextOpenWorldArtifactProductionValidationV1, string> = {
  'production-validated': '生产验证通过',
  'integrity-only': '仅完整性通过',
  'not-applicable': '不适用',
}

const PAGE_SIZES = [20, 30, 50] as const
function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value))
}

function entityLocator(entity: TextOpenWorldGovernedEntityV1): string {
  return `entity:${entity.identity}`
}

function artifactLocator(artifact: TextOpenWorldGovernedArtifactV1): string {
  return `artifact:${artifact.artifactKey}:v${artifact.version}:row${artifact.rowId}`
}

function EvidenceList(props: {
  evidence: TextOpenWorldArtifactEvidenceRefV1[]
  total: number
  truncated: number
}) {
  if (!props.evidence.length) {
    return <p className="text-xs text-text-muted">没有可展示的来源证据引用。</p>
  }
  return <>
    <ul className="space-y-2" data-testid="text-open-world-artifact-source-evidence">
      {props.evidence.map((item, index) => <li
        key={`${item.kind}:${item.field}:${item.key}:${index}`}
        className="rounded border border-border bg-bg-base px-3 py-2 text-xs"
      >
        <span className="text-[10px] text-text-muted">{item.kind} · {item.field}</span>
        <code className="mt-1 block break-all text-[11px]">{item.key}</code>
      </li>)}
    </ul>
    {props.truncated > 0 && <p className="mt-2 text-xs text-warning">
      已验证 {props.total} 条来源证据；为保证界面可用，另有 {props.truncated} 条未展开。
    </p>}
  </>
}

function EntityDetail(props: { entity: TextOpenWorldGovernedEntityV1 }) {
  const { entity } = props
  return <article data-testid="text-open-world-creator-entity-detail">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">{entity.kind}</p>
        <h3 className="mt-1 break-words text-lg font-semibold">{entity.title}</h3>
        <code className="mt-1 block break-all text-[10px] text-text-muted">{entity.identity}</code>
      </div>
      <span className="rounded-full border border-border bg-bg-base px-2.5 py-1 text-[10px]">
        {ENTITY_STATUS_LABELS[entity.status]}
      </span>
    </div>

    {entity.summary && <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{entity.summary}</p>}

    <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
      <div className="rounded border border-border bg-bg-base p-3">
        <dt className="text-text-muted">稳定 ID</dt>
        <dd className="mt-1 break-all font-mono">{entity.key}</dd>
      </div>
      <div className="rounded border border-border bg-bg-base p-3">
        <dt className="text-text-muted">定义 Artifact</dt>
        <dd className="mt-1 break-all font-mono">{entity.artifactKey} · v{entity.artifactVersion}</dd>
      </div>
      <div className="rounded border border-border bg-bg-base p-3 sm:col-span-2">
        <dt className="text-text-muted">Artifact Hash</dt>
        <dd className="mt-1 break-all font-mono">{entity.artifactContentHash}</dd>
      </div>
    </dl>

    {!!entity.fields.length && <section className="mt-5" aria-labelledby="text-open-world-entity-fields-title">
      <h4 id="text-open-world-entity-fields-title" className="mb-2 text-xs font-semibold">公开内容字段</h4>
      <dl className="space-y-2">
        {entity.fields.map(field => <div key={field.key} className="rounded border border-border p-3 text-xs">
          <dt className="font-medium text-text-muted">{field.label}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words leading-5">{field.value}</dd>
        </div>)}
      </dl>
    </section>}

    <section className="mt-5" aria-labelledby="text-open-world-entity-references-title">
      <h4 id="text-open-world-entity-references-title" className="mb-2 text-xs font-semibold">
        稳定引用（{entity.referenceCount}）
      </h4>
      {entity.references.length ? <ul className="space-y-2">
        {entity.references.map(reference => <li
          key={`${reference.field}:${reference.targetIdentity}`}
          className="rounded border border-border bg-bg-base p-3 text-xs"
          data-open-world-artifact-locator={`entity:${reference.targetIdentity}`}
        >
          <span className="text-text-muted">{reference.field} · {reference.targetKind} · {reference.status}</span>
          <code className="mt-1 block break-all">{reference.targetIdentity}</code>
        </li>)}
      </ul> : <p className="text-xs text-text-muted">该实体没有稳定引用。</p>}
      {entity.truncatedReferenceCount > 0 && <p className="mt-2 text-xs text-warning">
        另有 {entity.truncatedReferenceCount} 条引用未在详情展开，但仍已参与完整引用核验。
      </p>}
    </section>

    <section className="mt-5" aria-labelledby="text-open-world-entity-evidence-title">
      <h4 id="text-open-world-entity-evidence-title" className="mb-2 text-xs font-semibold">来源证据</h4>
      <EvidenceList
        evidence={entity.sourceEvidence}
        total={entity.sourceEvidenceCount}
        truncated={entity.truncatedSourceEvidenceCount}
      />
    </section>
  </article>
}

function ArtifactDetail(props: { artifact: TextOpenWorldGovernedArtifactV1 }) {
  const { artifact } = props
  return <article data-testid="text-open-world-creator-artifact-detail">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">{artifact.group}</p>
        <h3 className="mt-1 break-words text-lg font-semibold">{artifact.label}</h3>
        <code className="mt-1 block break-all text-[10px] text-text-muted">{artifact.artifactKey}</code>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        <span className="rounded-full border border-border bg-bg-base px-2.5 py-1 text-[10px]">
          {HEALTH_LABELS[artifact.health]}
        </span>
        <span className="rounded-full border border-border bg-bg-base px-2.5 py-1 text-[10px]">
          {PRODUCTION_VALIDATION_LABELS[artifact.productionValidation]}
        </span>
      </div>
    </div>

    <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
      <div className="rounded border border-border bg-bg-base p-3"><dt className="text-text-muted">Artifact 类型</dt><dd className="mt-1 break-all font-mono">{artifact.kind}</dd></div>
      <div className="rounded border border-border bg-bg-base p-3"><dt className="text-text-muted">版本 / 状态</dt><dd className="mt-1">v{artifact.version} · {artifact.artifactStatus}</dd></div>
      <div className="rounded border border-border bg-bg-base p-3"><dt className="text-text-muted">生产 Run</dt><dd className="mt-1 break-all">{artifact.producerRunId == null ? '无' : `#${artifact.producerRunId} · ${artifact.producerRunState ?? '状态未知'}`}</dd></div>
      <div className="rounded border border-border bg-bg-base p-3"><dt className="text-text-muted">控制 Epoch</dt><dd className="mt-1">{artifact.controlEpoch}{artifact.currentEpoch ? ' · 当前' : ' · 历史'}</dd></div>
      <div className="rounded border border-border bg-bg-base p-3 sm:col-span-2"><dt className="text-text-muted">Content Hash</dt><dd className="mt-1 break-all font-mono">{artifact.contentHash}</dd></div>
      <div className="rounded border border-border bg-bg-base p-3 sm:col-span-2"><dt className="text-text-muted">Input Hash</dt><dd className="mt-1 break-all font-mono">{artifact.inputHash}</dd></div>
      {artifact.producerReceiptHash && <div className="rounded border border-border bg-bg-base p-3 sm:col-span-2"><dt className="text-text-muted">Run Receipt Hash</dt><dd className="mt-1 break-all font-mono">{artifact.producerReceiptHash}</dd></div>}
      <div className="rounded border border-border bg-bg-base p-3"><dt className="text-text-muted">Schema</dt><dd className="mt-1 break-all font-mono">{artifact.schema ?? '未声明'}</dd></div>
      <div className="rounded border border-border bg-bg-base p-3"><dt className="text-text-muted">大小 / 更新时间</dt><dd className="mt-1">{artifact.byteSize.toLocaleString('zh-CN')} B · {formatDate(artifact.updatedAt)}</dd></div>
      <div className="rounded border border-border bg-bg-base p-3 sm:col-span-2"><dt className="text-text-muted">生产验证器</dt><dd className="mt-1 break-all font-mono">{artifact.validatorId ?? '未获得产品生产验证'}</dd></div>
      {artifact.validationReceiptHash && <div className="rounded border border-border bg-bg-base p-3 sm:col-span-2"><dt className="text-text-muted">Validation Receipt Hash</dt><dd className="mt-1 break-all font-mono">{artifact.validationReceiptHash}</dd></div>}
    </dl>

    <section className="mt-5" aria-labelledby="text-open-world-artifact-entities-title">
      <h4 id="text-open-world-artifact-entities-title" className="mb-2 text-xs font-semibold">实体稳定引用</h4>
      {artifact.entityIdentities.length ? <ul className="flex flex-wrap gap-2">
        {artifact.entityIdentities.map(identity => <li key={identity}>
          <code
            className="block max-w-full break-all rounded border border-border bg-bg-base px-2 py-1 text-[10px]"
            data-open-world-artifact-locator={`entity:${identity}`}
          >{identity}</code>
        </li>)}
      </ul> : <p className="text-xs text-text-muted">该 Artifact 未定义可浏览实体。</p>}
    </section>

    <section className="mt-5" aria-labelledby="text-open-world-artifact-evidence-title">
      <h4 id="text-open-world-artifact-evidence-title" className="mb-2 text-xs font-semibold">来源证据</h4>
      <EvidenceList
        evidence={artifact.sourceEvidence}
        total={artifact.sourceEvidenceCount}
        truncated={artifact.truncatedSourceEvidenceCount}
      />
    </section>

    {!!artifact.diagnostics.length && <section className="mt-5" aria-labelledby="text-open-world-artifact-diagnostics-title">
      <h4 id="text-open-world-artifact-diagnostics-title" className="mb-2 text-xs font-semibold">诊断</h4>
      <ul className="space-y-2">
        {artifact.diagnostics.map((diagnostic, index) => <li
          key={`${diagnostic.code}:${index}`}
          className="rounded border border-warning/40 bg-warning/5 p-3 text-xs"
        >
          <code className="text-[10px] text-warning">{diagnostic.code}</code>
          <p className="mt-1 leading-5">{diagnostic.message}</p>
        </li>)}
      </ul>
    </section>}
  </article>
}

export function TextOpenWorldCreatorArtifactBrowser(
  props: TextOpenWorldCreatorArtifactBrowserProps,
) {
  const [projection, setProjection] = useState<TextOpenWorldArtifactGovernanceProjectionV1 | null>(null)
  const [mode, setMode] = useState<TextOpenWorldArtifactBrowserModeV1>('content')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [status, setStatus] = useState('verified')
  const [pageNumber, setPageNumber] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(30)
  const [selectedLocator, setSelectedLocator] = useState<string | null>(null)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const editPreflightGeneration = useRef(0)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  const scope = useMemo<WorkspaceScope>(() => ({
    projectId: props.scope.projectId,
    worldId: props.scope.worldId,
    workId: props.scope.workId,
  }), [props.scope.projectId, props.scope.workId, props.scope.worldId])
  const identityKey = `${scope.projectId}:${scope.worldId}:${scope.workId}:${props.productionId}`
  const load = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      const next = await readTextOpenWorldArtifactGovernanceV1({
        scope,
        productionId: props.productionId,
      })
      if (generation.current === current) setProjection(next)
    } catch (cause) {
      if (generation.current === current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (generation.current === current) setLoading(false)
    }
  }, [props.productionId, scope])

  useEffect(() => {
    setProjection(null)
    setMode('content')
    setQuery('')
    setKind('all')
    setStatus('verified')
    setPageNumber(1)
    setSelectedLocator(null)
    setMobileDetail(false)
  }, [identityKey])

  useEffect(() => {
    void load()
    return () => { generation.current += 1 }
  }, [load, props.refreshToken])

  const kinds = useMemo(() => {
    if (!projection) return []
    const values = mode === 'content'
      ? projection.entities.map(entity => entity.kind)
      : projection.artifacts.map(artifact => artifact.kind)
    return [...new Set(values)].sort((left, right) => left.localeCompare(right))
  }, [mode, projection])

  const page = useMemo(() => projection ? pageTextOpenWorldArtifactGovernanceV1({
    projection,
    expectedSnapshotHash: projection?.snapshotHash,
    mode,
    query,
    kind,
    entityStatus: mode === 'content'
      ? status as TextOpenWorldGovernedEntityV1['status'] | 'all'
      : undefined,
    health: mode === 'content' ? 'all' : status as TextOpenWorldGovernedArtifactHealthV1 | 'all',
    page: pageNumber,
    pageSize,
  }) : null, [kind, mode, pageNumber, pageSize, projection, query, status])

  const rows = useMemo(() => page
    ? mode === 'content'
      ? page.entities.map(item => ({ type: 'entity' as const, locator: entityLocator(item), item }))
      : page.artifacts.map(item => ({ type: 'artifact' as const, locator: artifactLocator(item), item }))
    : [], [mode, page])

  const effectiveLocator = rows.some(row => row.locator === selectedLocator)
    ? selectedLocator : rows[0]?.locator ?? null
  const selectedEntity = mode === 'content'
    ? page?.entities.find(item => entityLocator(item) === effectiveLocator) ?? null : null
  const selectedArtifact = mode !== 'content'
    ? page?.artifacts.find(item => artifactLocator(item) === effectiveLocator) ?? null : null
  const selectedEntityArtifactMatches = selectedEntity
    ? projection?.artifacts.filter(artifact => (
      artifact.artifactKey === selectedEntity.artifactKey
      && artifact.version === selectedEntity.artifactVersion
      && artifact.contentHash === selectedEntity.artifactContentHash
    )) ?? []
    : []
  const selectedBackingArtifact = selectedEntity
    ? selectedEntityArtifactMatches.length === 1 ? selectedEntityArtifactMatches[0]! : null
    : selectedArtifact
  const editSelection = useMemo<TextOpenWorldCreatorArtifactEditSelectionV1 | null>(() => {
    const artifactKey = selectedEntity?.artifactKey ?? selectedArtifact?.artifactKey
    if (!projection || !artifactKey || !selectedBackingArtifact) return null
    return {
      scope,
      productionId: props.productionId,
      buildId: projection.build.id,
      expectedSnapshotHash: projection.snapshotHash,
      artifactKey,
      entityIdentity: selectedEntity?.identity ?? null,
    }
  }, [projection, props.productionId, scope, selectedArtifact?.artifactKey,
    selectedBackingArtifact, selectedEntity?.artifactKey, selectedEntity?.identity])
  const editGovernanceEligible = editSelection != null
    && selectedBackingArtifact?.currentEpoch === true
    && selectedBackingArtifact.health === 'verified'
    && selectedBackingArtifact.productionValidation === 'production-validated'
    && ['accepted', 'carried-forward'].includes(selectedBackingArtifact.artifactStatus)
    && (selectedEntity == null || selectedEntity.status === 'verified')
  const editSelectionKey = editSelection ? [
    editSelection.scope.projectId,
    editSelection.scope.worldId,
    editSelection.scope.workId,
    editSelection.productionId,
    editSelection.buildId,
    editSelection.expectedSnapshotHash,
    editSelection.artifactKey,
    editSelection.entityIdentity ?? 'artifact',
  ].join(':') : null
  const [editPreflight, setEditPreflight] = useState<{
    selectionKey: string | null
    state: 'idle' | 'checking' | 'eligible' | 'ineligible'
    reason: string | null
  }>({ selectionKey: null, state: 'idle', reason: null })

  useEffect(() => {
    const current = ++editPreflightGeneration.current
    if (!editSelection || !editGovernanceEligible || !editSelectionKey) {
      setEditPreflight({ selectionKey: editSelectionKey, state: 'idle', reason: null })
      return () => { editPreflightGeneration.current += 1 }
    }
    setEditPreflight({ selectionKey: editSelectionKey, state: 'checking', reason: null })
    void prepareTextOpenWorldCreatorArtifactEditV1(editSelection).then(context => {
      if (editPreflightGeneration.current !== current) return
      if (!context.editableFields.length) {
        setEditPreflight({
          selectionKey: editSelectionKey,
          state: 'ineligible',
          reason: '该精确目标没有登记的作者可修改字段。',
        })
        return
      }
      setEditPreflight({ selectionKey: editSelectionKey, state: 'eligible', reason: null })
    }).catch(cause => {
      if (editPreflightGeneration.current !== current) return
      setEditPreflight({
        selectionKey: editSelectionKey,
        state: 'ineligible',
        reason: cause instanceof Error ? cause.message : String(cause),
      })
    })
    return () => { editPreflightGeneration.current += 1 }
  }, [editGovernanceEligible, editSelection, editSelectionKey])

  const editEligible = editGovernanceEligible
    && editPreflight.selectionKey === editSelectionKey
    && editPreflight.state === 'eligible'
  const editIneligibleReason = !editSelection || !selectedBackingArtifact
    ? '当前条目不能解析到当前 Build 中唯一的定义 Artifact。'
    : selectedBackingArtifact.health !== 'verified'
        ? '该 Artifact 的证据完整性尚未通过，不能在旧基线上创建修改候选。'
        : selectedBackingArtifact.productionValidation !== 'production-validated'
          ? '该 Artifact 尚未通过产品生产合同验证，不能进入作者修改流程。'
          : !selectedBackingArtifact.currentEpoch
            ? '该 Artifact 属于历史 Epoch；只能修改当前 Build 的当前 Epoch 内容。'
            : selectedEntity && selectedEntity.status !== 'verified'
              ? '该实体仍有待生产或悬空引用，暂不能创建修改候选。'
              : editPreflight.state === 'checking'
                ? '正在通过领域 dispatcher 核验该精确目标的可编辑字段。'
                : editPreflight.reason
                  ?? '该精确 Artifact 或实体不是首版支持的作者修改目标。'

  useEffect(() => {
    if (page && page.page !== pageNumber) setPageNumber(page.page)
    if (effectiveLocator !== selectedLocator) {
      setSelectedLocator(effectiveLocator)
      setMobileDetail(false)
    }
  }, [effectiveLocator, page, pageNumber, selectedLocator])

  const chooseMode = (next: TextOpenWorldArtifactBrowserModeV1) => {
    setMode(next)
    setKind('all')
    setStatus(next === 'content' ? 'verified' : 'all')
    setPageNumber(1)
    setSelectedLocator(null)
    setMobileDetail(false)
  }

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex == null) return
    event.preventDefault()
    chooseMode(TABS[nextIndex].key)
    tabRefs.current[nextIndex]?.focus()
  }

  const chooseRow = (locator: string) => {
    setSelectedLocator(locator)
    setMobileDetail(true)
  }

  const returnToList = () => {
    setMobileDetail(false)
    const restoreFocus = () => {
      if (effectiveLocator) rowRefs.current.get(effectiveLocator)?.focus()
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreFocus)
    else queueMicrotask(restoreFocus)
  }

  const resetFilters = () => {
    setQuery('')
    setKind('all')
    setStatus(mode === 'content' ? 'verified' : 'all')
    setPageNumber(1)
  }

  return <section
    className="mt-5 w-full space-y-4 text-text-primary"
    data-testid="text-open-world-creator-artifact-browser"
    aria-busy={loading}
  >
    <header className="rounded-xl border border-border bg-bg-elevated p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.2em] text-accent">TEXT OPEN WORLD · GOVERNED ARTIFACTS</span>
          <h2 className="mt-2 text-xl font-semibold">{projection?.production.title ?? '受治理内容浏览'}</h2>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-text-muted">
            这里只读展示当前 Production 的精确 Build 投影。完整性通过只证明证据链可重算；内容视图仅接纳同时通过产品生产合同验证的 Artifact，不把它表述为叙事审美或真人试玩质量。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"
          aria-label="刷新受治理 Artifact 快照"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          刷新
        </button>
      </div>
      {projection && <dl className="mt-4 grid gap-2 text-[10px] text-text-muted sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded border border-border bg-bg-base p-3"><dt>Build</dt><dd className="mt-1 text-text-primary">#{projection.build.buildNumber} · {projection.build.status}</dd></div>
        <div className="rounded border border-border bg-bg-base p-3"><dt>生产验证 Artifact</dt><dd className="mt-1 text-text-primary">{projection.summary.currentProductionValidatedArtifactCount}</dd></div>
        <div className="rounded border border-border bg-bg-base p-3"><dt>仅完整性 Artifact</dt><dd className="mt-1 text-text-primary">{projection.summary.currentIntegrityOnlyArtifactCount}</dd></div>
        <div className="rounded border border-border bg-bg-base p-3"><dt>实体 / 问题</dt><dd className="mt-1 text-text-primary">{projection.summary.entityCount} / {projection.summary.currentProblemArtifactCount}</dd></div>
        <div className="rounded border border-border bg-bg-base p-3"><dt>Snapshot Hash</dt><dd className="mt-1 break-all font-mono text-text-primary">{projection.snapshotHash}</dd></div>
      </dl>}
    </header>

    {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
      <AlertTriangle className="mr-2 inline h-4 w-4" aria-hidden="true" />{error}
      {projection && <p className="mt-1 text-xs text-text-muted">仍保留上一次成功读取的快照，没有用失败结果覆盖。</p>}
    </div>}

    {!projection && loading && <section className="rounded-xl border border-border bg-bg-elevated p-8 text-center text-sm text-text-muted">
      <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" aria-hidden="true" />正在核验当前 Build 与 Artifact 证据…
    </section>}

    {projection && <section className="rounded-xl border border-border bg-bg-elevated p-4 md:p-5">
      <div role="tablist" aria-label="受治理内容浏览分类" className="grid grid-cols-3 gap-1 rounded-lg bg-bg-base p-1">
        {TABS.map((tab, index) => <button
          key={tab.key}
          ref={node => { tabRefs.current[index] = node }}
          id={`text-open-world-artifact-browser-tab-${tab.key}`}
          type="button"
          role="tab"
          aria-selected={mode === tab.key}
          aria-controls={`text-open-world-artifact-browser-panel-${tab.key}`}
          tabIndex={mode === tab.key ? 0 : -1}
          onClick={() => chooseMode(tab.key)}
          onKeyDown={event => moveTabFocus(event, index)}
          className={`rounded px-3 py-2 text-xs transition-colors ${mode === tab.key ? 'bg-accent text-white' : 'text-text-muted hover:bg-bg-surface hover:text-text-primary'}`}
        >{tab.label}</button>)}
      </div>

      <section
        id={`text-open-world-artifact-browser-panel-${mode}`}
        role="tabpanel"
        aria-labelledby={`text-open-world-artifact-browser-tab-${mode}`}
        className="mt-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_220px_220px_120px]">
          <label className="grid gap-1 text-xs text-text-muted">安全搜索（标题、摘要或 ID）
            <input
              type="search"
              value={query}
              onChange={event => { setQuery(event.target.value); setPageNumber(1) }}
              placeholder={mode === 'content' ? '实体标题、摘要或稳定 ID' : 'Artifact 标题或 ID'}
              className="rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary"
            />
          </label>
          <label className="grid gap-1 text-xs text-text-muted">类型
            <select value={kind} onChange={event => { setKind(event.target.value); setPageNumber(1) }} className="rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary">
              <option value="all">全部类型</option>
              {kinds.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-text-muted">状态
            <select value={status} onChange={event => { setStatus(event.target.value); setPageNumber(1) }} className="rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary">
              <option value="all">全部状态</option>
              {mode === 'content'
                ? Object.entries(ENTITY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)
                : Object.entries(HEALTH_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-text-muted">每页
            <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]); setPageNumber(1) }} className="rounded-lg border border-border bg-bg-base px-3 py-2 text-sm text-text-primary">
              {PAGE_SIZES.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.5fr)]">
          <div className={mobileDetail ? 'hidden md:block' : 'block'}>
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>{page?.total ?? 0} 条 · 第 {page?.page ?? 1}/{page?.pageCount ?? 1} 页</span>
              {(query || kind !== 'all' || status !== 'all') && <button type="button" className="underline" onClick={resetFilters}>清除筛选</button>}
            </div>
            {rows.length ? <ul className="space-y-2" aria-label={mode === 'content' ? '内容实体列表' : 'Artifact 列表'}>
              {rows.map(row => {
                const title = row.type === 'entity' ? row.item.title : row.item.label
                const subtitle = row.type === 'entity'
                  ? `${row.item.kind} · ${ENTITY_STATUS_LABELS[row.item.status]}`
                  : `${row.item.kind} · v${row.item.version} · ${HEALTH_LABELS[row.item.health]} · ${PRODUCTION_VALIDATION_LABELS[row.item.productionValidation]}`
                return <li key={row.locator}>
                  <button
                    ref={node => {
                      if (node) rowRefs.current.set(row.locator, node)
                      else rowRefs.current.delete(row.locator)
                    }}
                    type="button"
                    onClick={() => chooseRow(row.locator)}
                    aria-current={effectiveLocator === row.locator ? 'true' : undefined}
                    data-open-world-artifact-locator={row.locator}
                    className={`w-full rounded-lg border p-3 text-left ${effectiveLocator === row.locator ? 'border-accent bg-accent/10' : 'border-border bg-bg-base hover:border-accent/50'}`}
                  >
                    <strong className="block break-words text-xs">{title}</strong>
                    <span className="mt-1 block break-all text-[10px] text-text-muted">{subtitle}</span>
                    <code className="mt-1 block break-all text-[10px] text-text-muted">{row.type === 'entity' ? row.item.identity : row.item.artifactKey}</code>
                  </button>
                </li>
              })}
            </ul> : <div className="rounded-lg border border-dashed border-border bg-bg-base p-7 text-center text-xs text-text-muted">
              <FileSearch className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
              {mode === 'diagnostics' ? '当前筛选下没有诊断记录。' : '当前筛选下没有内容。'}
            </div>}

            {page && page.pageCount > 1 && <nav className="mt-3 flex items-center justify-between gap-3" aria-label="受治理内容分页">
              <button type="button" disabled={page.page <= 1} onClick={() => { setPageNumber(page.page - 1); setMobileDetail(false) }} className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-xs disabled:opacity-35"><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />上一页</button>
              <span className="text-[10px] text-text-muted">最多 {page.pageSize} 条/页</span>
              <button type="button" disabled={page.page >= page.pageCount} onClick={() => { setPageNumber(page.page + 1); setMobileDetail(false) }} className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 text-xs disabled:opacity-35">下一页<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </nav>}
          </div>

          <div className={`${mobileDetail ? 'block' : 'hidden md:block'} min-w-0 rounded-xl border border-border bg-bg-surface p-4 md:p-5`}>
            <button type="button" onClick={returnToList} className="mb-4 inline-flex items-center gap-1 text-xs text-accent md:hidden">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />返回列表
            </button>
            {selectedEntity ? <>
              <EntityDetail entity={selectedEntity} />
              {editSelection && <TextOpenWorldCreatorArtifactEditor
                key={`${editSelection.expectedSnapshotHash}:${editSelection.artifactKey}:${editSelection.entityIdentity}`}
                selection={editSelection}
                eligible={editEligible}
                ineligibleReason={editIneligibleReason}
                onRepairBuildCreated={load}
              />}
            </> : selectedArtifact ? <>
              <ArtifactDetail artifact={selectedArtifact} />
              {editSelection && <TextOpenWorldCreatorArtifactEditor
                key={`${editSelection.expectedSnapshotHash}:${editSelection.artifactKey}:artifact`}
                selection={editSelection}
                eligible={editEligible}
                ineligibleReason={editIneligibleReason}
                onRepairBuildCreated={load}
              />}
            </> : <p className="py-10 text-center text-xs text-text-muted">从列表选择一项查看只读详情。</p>}
          </div>
        </div>
      </section>
    </section>}

    <p className="sr-only" aria-live="polite">
      {loading ? '正在刷新 Artifact 快照' : projection ? `已载入快照 ${projection.snapshotHash}` : ''}
    </p>
    {projection && !loading && !error && <span className="sr-only"><CheckCircle2 aria-hidden="true" />快照读取完成</span>}
  </section>
}

export default TextOpenWorldCreatorArtifactBrowser
