import { useEffect, useMemo, useState } from 'react'
import { BookOpenCheck, Clock3, History, MapPin, Pin, ScrollText, ShieldCheck } from 'lucide-react'
import {
  projectTextOpenWorldPlayerQuestLogV1,
  type TextOpenWorldPlayerQuestLogCategoryV1,
  type TextOpenWorldPlayerQuestLogEntryV1,
  type TextOpenWorldPlayerQuestLogStatusV1,
  type TextOpenWorldPlayerQuestLogTrackingFilterV1,
} from '../../lib/open-world/player-quest-log'
import type {
  ProductRuntimeEvent,
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldSessionProjectionV1,
} from '../../lib/types'

const CATEGORY_LABELS: Record<TextOpenWorldPlayerQuestLogCategoryV1, string> = {
  main: '主线',
  significant: '重要支线',
  ordinary: '普通支线',
  random: '随机任务',
}

const STATUS_LABELS: Record<TextOpenWorldPlayerQuestLogStatusV1, string> = {
  revealed: '可接取',
  accepted: '已接受',
  active: '进行中',
  suspended: '等待玩家',
  completed: '已完成',
  failed: '永久失败',
  expired: '已过期',
  abandoned: '已放弃',
  withdrawn: '已撤回',
}

const OBJECTIVE_STATUS_LABELS = {
  inactive: '未开始',
  active: '进行中',
  completed: '已完成',
  failed: '未完成',
} as const

const CURRENT_STATUSES = new Set<TextOpenWorldPlayerQuestLogStatusV1>([
  'revealed', 'accepted', 'active', 'suspended',
])
const HISTORY_STATUSES = new Set<TextOpenWorldPlayerQuestLogStatusV1>([
  'completed', 'failed', 'expired', 'abandoned', 'withdrawn',
])

type CategoryFilter = 'all' | 'history' | TextOpenWorldPlayerQuestLogCategoryV1
type StatusFilter = 'all' | 'current' | 'history' | TextOpenWorldPlayerQuestLogStatusV1
type DeadlineFilter = 'all' | 'waits' | 'timed-open' | 'timed-expired'

const ACTION_ORDER: Record<string, number> = {
  track: 0,
  untrack: 1,
  'abandon-quest': 2,
}

function statusMatches(status: TextOpenWorldPlayerQuestLogStatusV1, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'current') return CURRENT_STATUSES.has(status)
  if (filter === 'history') return HISTORY_STATUSES.has(status)
  return status === filter
}

function trackingMatches(
  entry: TextOpenWorldPlayerQuestLogEntryV1,
  filter: TextOpenWorldPlayerQuestLogTrackingFilterV1,
): boolean {
  if (filter === 'all') return true
  if (filter === 'tracked') return entry.tracking != null
  if (filter === 'untracked') return entry.tracking == null
  return entry.tracking === filter
}

function trackingLabel(entry: TextOpenWorldPlayerQuestLogEntryV1): string {
  if (entry.tracking === 'primary') return '主追踪'
  if (entry.tracking === 'pinned') return 'HUD 钉选'
  return '未追踪'
}

function lifecycleCopy(entry: TextOpenWorldPlayerQuestLogEntryV1): string {
  if (entry.status === 'completed') return '任务已经完成并结算，不再接受放弃操作。'
  if (entry.status === 'failed') return '任务已经永久失败，不再接受放弃操作。'
  if (entry.status === 'expired') return '限时任务已经过期，不再接受放弃操作。'
  if (entry.status === 'withdrawn') return '任务已经由世界状态撤回，不再接受放弃操作。'
  if (entry.status === 'abandoned') {
    if (entry.lifecycle.reofferWindow === 'open') return '任务已放弃，可回到原任务发布场景重新接取。'
    if (entry.lifecycle.reofferWindow === 'expired') return '任务已放弃且超过有效期，不能重新接取。'
    return '任务已放弃，本次任务永久结束。'
  }
  if (entry.lifecycle.abandonment === 'protected') {
    return '关键故事线不可放弃；主线推进到安全等待点后会等待玩家。'
  }
  if (entry.lifecycle.abandonment === 'restartable') {
    return '允许放弃；放弃后可回到原任务发布场景重新接取。'
  }
  return '允许放弃；放弃后本次任务永久结束，不能重新接取。'
}

function timeCopy(entry: TextOpenWorldPlayerQuestLogEntryV1): string {
  if (entry.lifecycle.timePolicy === 'waits') return '不限时任务'
  if (entry.status === 'expired') return '限时任务已经过期'
  return entry.deadline.label ? `限时任务 · ${entry.deadline.label}` : '限时任务'
}

function terminalCopy(status: TextOpenWorldPlayerQuestLogStatusV1): string | null {
  if (status === 'failed') return '任务目标已经永久失败。'
  if (status === 'expired') return '任务期限已经结束。'
  if (status === 'abandoned') return '玩家已经放弃本次任务。'
  if (status === 'withdrawn') return '任务已因世界状态变化撤回。'
  if (status === 'completed') return '任务已经完成。'
  return null
}

function deadlineMatches(entry: TextOpenWorldPlayerQuestLogEntryV1, filter: DeadlineFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'waits') return entry.lifecycle.timePolicy === 'waits'
  const expired = entry.status === 'expired' || entry.deadline.expired
  return entry.lifecycle.timePolicy === 'timed' && (filter === 'timed-expired' ? expired : !expired)
}

function sourceLabel(entry: TextOpenWorldPlayerQuestLogEntryV1): string {
  return entry.sourceKind === 'release' ? '世界发布时固定' : '地区动态发放'
}

function entryActions(
  entry: TextOpenWorldPlayerQuestLogEntryV1,
  actions: readonly TextOpenWorldActionAvailabilityV1[],
): TextOpenWorldActionAvailabilityV1[] {
  return actions.filter(action => (
    action.action.actorScope === 'player'
    && action.targetScope === 'quest'
    // Accept/restart/objective/reward Actions belong to their frozen authored
    // scenes. The journal owns only tracking and governed abandonment, so it
    // never becomes an alternate route that skips scene presentation.
    && ['track', 'untrack', 'abandon-quest'].includes(action.action.category)
    && action.validTargetKeys.includes(entry.instanceKey)
  )).sort((left, right) => (
    (ACTION_ORDER[left.action.category] ?? 50) - (ACTION_ORDER[right.action.category] ?? 50)
    || left.action.label.localeCompare(right.action.label)
  ))
}

export interface TextOpenWorldQuestLogPanelProps {
  sessionId: number
  projection: TextOpenWorldSessionProjectionV1
  events: readonly ProductRuntimeEvent[]
  actions: readonly TextOpenWorldActionAvailabilityV1[]
  busy: boolean
  onExecute(action: TextOpenWorldActionAvailabilityV1, instanceKey: string): void
  onFocusLocation(locationKey: string): void
}

export default function TextOpenWorldQuestLogPanel(props: TextOpenWorldQuestLogPanelProps) {
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tracking, setTracking] = useState<TextOpenWorldPlayerQuestLogTrackingFilterV1>('all')
  const [region, setRegion] = useState('all')
  const [owner, setOwner] = useState('all')
  const [deadline, setDeadline] = useState<DeadlineFilter>('all')
  const [selectedInstanceKey, setSelectedInstanceKey] = useState<string | null>(null)
  // Runtime restore and a few legacy test/adaptation paths can replace the
  // outer store snapshot while retaining a mutable Projection object. This is
  // intentionally recomputed so the journal never displays a stale lifecycle.
  const log = projectTextOpenWorldPlayerQuestLogV1({
    sessionId: props.sessionId,
    projection: props.projection,
    events: props.events,
  })
  const regions = useMemo(() => {
    const byKey = new Map<string, string>()
    log.entries.forEach(entry => entry.regions.forEach(item => byKey.set(item.regionKey, item.title)))
    return [...byKey.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [log.entries])
  const owners = useMemo(() => {
    const byRef = new Map<string, string>()
    log.entries.forEach(entry => {
      if ((entry.owner.kind === 'actor' || entry.owner.kind === 'faction') && entry.owner.key) {
        byRef.set(`${entry.owner.kind}:${entry.owner.key}`, entry.owner.title)
      }
    })
    return [...byRef.entries()].sort((left, right) => left[1].localeCompare(right[1]))
  }, [log.entries])
  const filtered = useMemo(() => log.entries.filter(entry => (
    (category === 'all'
      || category === 'history' && HISTORY_STATUSES.has(entry.status)
      || category !== 'history' && entry.category === category)
    && statusMatches(entry.status, status)
    && trackingMatches(entry, tracking)
    && (region === 'all' || entry.regions.some(item => item.regionKey === region))
    && (owner === 'all' || `${entry.owner.kind}:${entry.owner.key ?? ''}` === owner)
    && deadlineMatches(entry, deadline)
  )), [category, deadline, log.entries, owner, region, status, tracking])
  const selected = filtered.find(entry => entry.instanceKey === selectedInstanceKey) ?? filtered[0] ?? null

  useEffect(() => {
    if (selected?.instanceKey !== selectedInstanceKey) setSelectedInstanceKey(selected?.instanceKey ?? null)
  }, [selected?.instanceKey, selectedInstanceKey])

  const selectCategory = (next: CategoryFilter) => {
    setCategory(next)
    if (next === 'history') setStatus('history')
    setSelectedInstanceKey(null)
  }
  const resetFilters = () => {
    setCategory('all')
    setStatus('all')
    setTracking('all')
    setRegion('all')
    setOwner('all')
    setDeadline('all')
    setSelectedInstanceKey(null)
  }
  const actions = selected ? entryActions(selected, props.actions) : []
  const terminal = selected ? terminalCopy(selected.status) : null

  return <section
    className="min-w-0 space-y-3 overflow-hidden"
    data-testid="text-open-world-quest-log"
    aria-label="任务日志"
  >
    <header className="rounded border border-accent/30 bg-accent/5 p-3" data-testid="text-open-world-quest-hud">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />任务日志 · 可见任务实例
          </div>
          <p className="mt-1 text-xs text-text-muted">
            仅显示玩家已经接触的任务、阶段、目标与地点；任务日志操作会进入正式事件链。
          </p>
        </div>
        <small className="shrink-0 text-text-muted">{filtered.length}/{log.visibleTotal} 项</small>
      </div>
      <nav className="mt-3 flex min-w-0 flex-wrap gap-2 pb-1" aria-label="任务分类">
        {([
          ['all', '全部', log.visibleTotal],
          ['main', '主线', log.facets.categories.main],
          ['significant', '重要支线', log.facets.categories.significant],
          ['ordinary', '普通支线', log.facets.categories.ordinary],
          ['random', '随机任务', log.facets.categories.random],
          ['history', '历史', log.facets.statuses.completed + log.facets.statuses.failed
            + log.facets.statuses.expired + log.facets.statuses.abandoned + log.facets.statuses.withdrawn],
        ] as const).map(([key, label, count]) => <button
          key={key}
          type="button"
          aria-pressed={category === key}
          onClick={() => selectCategory(key)}
          className="shrink-0 rounded border border-border bg-bg-surface px-2 py-1 text-xs aria-pressed:border-accent aria-pressed:text-accent"
        >
          {label} <span aria-hidden="true">{count}</span>
        </button>)}
      </nav>
      {category === 'history' && <p className="mt-1 text-[10px] text-text-muted">
        历史汇总已完成、永久失败、过期、放弃与撤回的任务；可继续用状态筛选细分。
      </p>}
      <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <label className="min-w-0 text-[10px] text-text-muted">
          状态
          <select
            aria-label="按任务状态筛选"
            value={status}
            onChange={event => { setStatus(event.target.value as StatusFilter); setSelectedInstanceKey(null) }}
            className="mt-1 block w-full min-w-0 rounded border border-border bg-bg-base px-2 py-1 text-xs text-text"
          >
            <option value="all">全部状态</option>
            <option value="current">当前任务</option>
            <option value="history">历史</option>
            <option value="revealed">可接取</option>
            <option value="accepted">已接受</option>
            <option value="active">进行中</option>
            <option value="suspended">等待玩家</option>
            <option value="completed">已完成</option>
            <option value="failed">永久失败</option>
            <option value="expired">已过期</option>
            <option value="abandoned">已放弃</option>
            <option value="withdrawn">已撤回</option>
          </select>
        </label>
        <label className="min-w-0 text-[10px] text-text-muted">
          期限
          <select
            aria-label="按任务期限筛选"
            value={deadline}
            onChange={event => { setDeadline(event.target.value as DeadlineFilter); setSelectedInstanceKey(null) }}
            className="mt-1 block w-full min-w-0 rounded border border-border bg-bg-base px-2 py-1 text-xs text-text"
          >
            <option value="all">全部期限</option>
            <option value="waits">不限时</option>
            <option value="timed-open">限时未到期</option>
            <option value="timed-expired">已到期</option>
          </select>
        </label>
        <label className="min-w-0 text-[10px] text-text-muted">
          角色 / 势力
          <select
            aria-label="按任务角色或势力筛选"
            value={owner}
            onChange={event => { setOwner(event.target.value); setSelectedInstanceKey(null) }}
            className="mt-1 block w-full min-w-0 rounded border border-border bg-bg-base px-2 py-1 text-xs text-text"
          >
            <option value="all">全部角色与势力</option>
            {owners.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-[10px] text-text-muted">
          追踪
          <select
            aria-label="按追踪状态筛选"
            value={tracking}
            onChange={event => { setTracking(event.target.value as TextOpenWorldPlayerQuestLogTrackingFilterV1); setSelectedInstanceKey(null) }}
            className="mt-1 block w-full min-w-0 rounded border border-border bg-bg-base px-2 py-1 text-xs text-text"
          >
            <option value="all">全部追踪状态</option>
            <option value="tracked">已追踪</option>
            <option value="primary">主追踪</option>
            <option value="pinned">HUD 钉选</option>
            <option value="untracked">未追踪</option>
          </select>
        </label>
        <label className="min-w-0 text-[10px] text-text-muted">
          区域
          <select
            aria-label="按任务区域筛选"
            value={region}
            onChange={event => { setRegion(event.target.value); setSelectedInstanceKey(null) }}
            className="mt-1 block w-full min-w-0 rounded border border-border bg-bg-base px-2 py-1 text-xs text-text"
          >
            <option value="all">全部已知区域</option>
            {regions.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </select>
        </label>
      </div>
    </header>

    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(15rem,0.9fr)_minmax(0,1.6fr)]">
      <div className="min-w-0 space-y-2" role="list" aria-label="筛选后的任务">
        {filtered.map(entry => <button
          key={entry.instanceKey}
          type="button"
          role="listitem"
          aria-current={entry.instanceKey === selected?.instanceKey || undefined}
          onClick={() => setSelectedInstanceKey(entry.instanceKey)}
          className="block w-full min-w-0 rounded border border-border bg-bg-surface p-3 text-left text-xs aria-[current=true]:border-accent aria-[current=true]:bg-accent/5"
          data-quest-instance={entry.instanceKey}
          data-quest-category={entry.category}
          data-quest-status={entry.status}
          data-quest-tracking={entry.tracking ?? 'untracked'}
        >
          <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <strong className="min-w-0 break-words">{entry.title}</strong>
            <span className="shrink-0 text-text-muted">{STATUS_LABELS[entry.status]}</span>
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[10px] text-text-muted">
            <span>{CATEGORY_LABELS[entry.category]}</span>
            <span>{trackingLabel(entry)}</span>
            <span>{entry.owner.title}</span>
            <span>{sourceLabel(entry)}</span>
            {entry.deadline.label && <span className={entry.deadline.expired ? 'text-danger' : 'text-warning'}>{entry.deadline.label}</span>}
          </span>
          {entry.currentStage && <span className="mt-1 block truncate text-text-muted">当前阶段：{entry.currentStage.title}</span>}
        </button>)}
        {!filtered.length && <div className="rounded border border-border bg-bg-surface p-4 text-xs text-text-muted">
          <p>没有符合当前筛选条件的任务。</p>
          <button type="button" onClick={resetFilters} className="mt-2 rounded border border-border px-2 py-1 text-accent">
            清除筛选
          </button>
        </div>}
      </div>

      {selected && <article
        className="min-w-0 overflow-hidden rounded border border-border bg-bg-surface p-4"
        data-testid="text-open-world-quest-detail"
        data-quest-instance={selected.instanceKey}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex flex-wrap gap-2 text-[10px]">
              <span className="rounded bg-accent/10 px-2 py-1 text-accent">{CATEGORY_LABELS[selected.category]}</span>
              <span className="rounded bg-bg-base px-2 py-1 text-text-muted">{STATUS_LABELS[selected.status]}</span>
              <span className="rounded bg-bg-base px-2 py-1 text-text-muted">{trackingLabel(selected)}</span>
              <span className="rounded bg-bg-base px-2 py-1 text-text-muted">来源：{selected.owner.title}</span>
              <span className="rounded bg-bg-base px-2 py-1 text-text-muted">{sourceLabel(selected)}</span>
            </span>
            <h2 className="mt-2 break-words text-base font-semibold">{selected.title}</h2>
          </div>
          {selected.tracking && <Pin className="h-4 w-4 shrink-0 text-accent" aria-label={trackingLabel(selected)} />}
        </div>
        <p className="mt-2 break-words text-xs text-text-muted">{selected.description}</p>

        {!!selected.knownFacts.length && <section className="mt-3 min-w-0" aria-label="关键已知事实">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BookOpenCheck className="h-4 w-4 text-accent" aria-hidden="true" />关键已知事实
          </h3>
          <div className="mt-2 space-y-2">
            {selected.knownFacts.map(fact => <div key={fact.knowledgeKey} className="min-w-0 rounded bg-bg-base p-2 text-xs">
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <strong className="break-words">{fact.title}</strong>
                <small className={fact.visibility === 'rumor' ? 'text-warning' : 'text-accent'}>
                  {fact.visibility === 'rumor' ? '传闻' : '已确认'}
                </small>
              </span>
              <p className="mt-1 break-words text-text-muted">{fact.content}</p>
            </div>)}
          </div>
        </section>}

        <section className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2" aria-label="任务规则">
          <div className="min-w-0 rounded bg-bg-base p-2 text-xs">
            <span className="flex items-center gap-1 font-semibold"><ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />任务保护</span>
            <p className="mt-1 break-words text-text-muted">{lifecycleCopy(selected)}</p>
          </div>
          <div className="min-w-0 rounded bg-bg-base p-2 text-xs">
            <span className="flex items-center gap-1 font-semibold"><Clock3 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />时间与体量</span>
            <p className="mt-1 break-words text-text-muted">{timeCopy(selected)} · 预计 {selected.lifecycle.estimatedMinutes} 分钟</p>
          </div>
        </section>
        {terminal && <p className="mt-3 rounded border border-border bg-bg-base p-2 text-xs" data-testid="text-open-world-quest-terminal-copy">
          {terminal}
        </p>}

        <section className="mt-4 min-w-0" aria-label="任务进度">
          <h3 className="text-sm font-semibold">任务进度</h3>
          <div className="mt-2 space-y-2">
            {selected.stages.map(stage => <div
              key={stage.stageKey}
              className="min-w-0 rounded border border-border/70 bg-bg-base p-2 text-xs"
              data-stage-position={stage.position}
            >
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <strong className="break-words">{stage.title}</strong>
                <small className={stage.position === 'current' ? 'text-accent' : 'text-text-muted'}>
                  {stage.position === 'current' ? '当前阶段' : '已完成阶段'}
                </small>
              </span>
              <div className="mt-1 space-y-1">
                {stage.objectives.map(objective => <div key={objective.objectiveKey} className="min-w-0 rounded px-1 py-1 text-text-muted">
                  <span className="flex min-w-0 flex-wrap justify-between gap-2">
                    <span className="min-w-0 break-words">{objective.required ? '' : '可选 · '}{objective.title}</span>
                    <span className="shrink-0">{OBJECTIVE_STATUS_LABELS[objective.status]}</span>
                  </span>
                  {!!objective.locations.length && <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                    {objective.locations.map(location => <button
                      key={location.locationKey}
                      type="button"
                      disabled={props.busy}
                      onClick={() => props.onFocusLocation(location.mapFocus.locationKey)}
                      className="max-w-full rounded border border-accent/40 px-2 py-1 text-[10px] text-accent disabled:opacity-40"
                      aria-label={`在地图定位${location.title}`}
                    >
                      <MapPin className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      <span className="break-words">{location.title}</span>
                    </button>)}
                  </div>}
                </div>)}
                {!stage.objectives.length && <p className="text-text-muted">本阶段没有公开目标。</p>}
              </div>
            </div>)}
            {!selected.stages.length && <p className="rounded bg-bg-base p-2 text-xs text-text-muted">
              接取或开始任务后显示当前阶段。
            </p>}
          </div>
        </section>

        {!!selected.locations.length && <section className="mt-4 min-w-0" aria-label="已知任务地点">
          <h3 className="text-sm font-semibold">已知地点</h3>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            {selected.locations.map(location => <button
              key={location.locationKey}
              type="button"
              disabled={props.busy}
              onClick={() => props.onFocusLocation(location.mapFocus.locationKey)}
              className="max-w-full rounded border border-border bg-bg-base px-2 py-1 text-left text-xs disabled:opacity-40"
              aria-label={`在地图定位${location.title}`}
            >
              <MapPin className="mr-1 inline h-3 w-3 text-accent" aria-hidden="true" />
              <span className="break-words">{location.regionTitle} · {location.title}</span>
              {location.current && <small className="ml-1 text-accent">当前位置</small>}
            </button>)}
          </div>
        </section>}

        <section className="mt-4 min-w-0" aria-label="任务奖励">
          <h3 className="text-sm font-semibold">任务奖励</h3>
          <div className="mt-1 rounded bg-bg-base p-2 text-xs text-text-muted">
            {!selected.reward.configured && <p>此任务没有配置奖励。</p>}
            {selected.reward.configured && <>
              {selected.reward.title && <strong className="text-text">{selected.reward.title}</strong>}
              {!!selected.reward.preview.lines.length && <ul className="mt-1 list-inside list-disc">
                {selected.reward.preview.lines.map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}
              </ul>}
              {(selected.reward.preview.mode === 'random-hidden'
                || selected.reward.preview.mode === 'fixed-preview-and-random-hidden') && <p className="mt-1">
                另有随机奖励，将在结算时揭晓。
              </p>}
              {selected.reward.claimed
                ? <p className="mt-1 text-text-muted">奖励已经领取。</p>
                : selected.reward.claimable
                  ? <p className="mt-1 text-accent">奖励待领取，当前已经可以领取。</p>
                  : <p className="mt-1">完成任务后可按上述规则结算。</p>}
            </>}
          </div>
        </section>

        {!!actions.length && <section className="mt-4 min-w-0" aria-label="任务操作">
          <h3 className="text-sm font-semibold">可用操作</h3>
          <div className="mt-2 flex min-w-0 flex-wrap gap-2">
            {actions.map(action => <button
              key={action.action.key}
              type="button"
              disabled={props.busy || !action.available}
              onClick={() => action.available && props.onExecute(action, selected.instanceKey)}
              className="max-w-full rounded border border-accent/40 px-2 py-1 text-xs text-accent disabled:border-border disabled:text-text-muted"
              title={!action.available ? action.unavailableReasons.map(reason => reason.message).join('；') : undefined}
              data-action-category={action.action.category}
            >
              <span className="break-words">{action.action.label}</span>
            </button>)}
          </div>
          {actions.some(action => !action.available) && <div className="mt-2 space-y-1 text-[10px] text-text-muted">
            {actions.filter(action => !action.available).map(action => <p key={action.action.key}>
              {action.action.label}：{action.unavailableReasons.map(reason => reason.message).join('；')}
            </p>)}
          </div>}
        </section>}
        {selected.lifecycle.abandonment === 'protected' && <small className="mt-3 block text-text-muted">
          关键故事线不可放弃。
        </small>}

        <section className="mt-4 min-w-0" aria-label="任务历史">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-accent" aria-hidden="true" />任务历史</h3>
          {log.historyStatus === 'awaiting-events' && <p className="mt-2 rounded bg-bg-base p-2 text-xs text-warning" role="status">
            任务状态已更新，历史事件正在同步。
          </p>}
          {log.historyStatus === 'ready' && <div className="mt-2 space-y-1">
            {selected.history.slice().reverse().map((entry, index) => <p
              key={`${entry.sequence}:${entry.kind}:${index}`}
              className="min-w-0 break-words rounded bg-bg-base px-2 py-1 text-[10px] text-text-muted"
              data-quest-history-kind={entry.kind}
            >
              <strong className="text-text">#{entry.sequence}</strong> {entry.summary}
            </p>)}
            {!selected.history.length && <p className="rounded bg-bg-base p-2 text-xs text-text-muted">尚无任务状态事件。</p>}
          </div>}
        </section>
      </article>}
    </div>
  </section>
}
