import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1,
  type TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1,
  type TextOpenWorldPlayerWorldRecordProjectionV1,
  type TextOpenWorldPlayerWorldRecordTabV1,
} from '../../lib/open-world/player-world-record'

const TAB_LABELS: Record<TextOpenWorldPlayerWorldRecordTabV1, string> = {
  relationships: '关系',
  encyclopedia: '百科',
  rumors: '传闻',
  history: '历程',
  achievements: '成就',
}

const ATTITUDE_CLASSES = {
  bad: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
  neutral: 'border-border bg-bg-base text-text-muted',
  good: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
} as const

function EmptyState({ children }: { children: string }) {
  return <p className="rounded border border-dashed border-border bg-bg-base/60 px-3 py-5 text-center text-xs text-text-muted">{children}</p>
}

export default function TextOpenWorldWorldRecordPanel(props: {
  sessionKey: number | string
  projection: TextOpenWorldPlayerWorldRecordProjectionV1
  onFocusLocation(locationKey: string): void
}) {
  const [activeTab, setActiveTab] = useState<TextOpenWorldPlayerWorldRecordTabV1>('relationships')
  const [encyclopediaCategory, setEncyclopediaCategory] = useState<'all' | TextOpenWorldPlayerWorldRecordEncyclopediaCategoryV1>('all')
  const [encyclopediaQuery, setEncyclopediaQuery] = useState('')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    setActiveTab('relationships')
    setEncyclopediaCategory('all')
    setEncyclopediaQuery('')
  }, [props.sessionKey])

  const filteredEncyclopediaEntries = useMemo(() => {
    const query = encyclopediaQuery.trim().toLocaleLowerCase()
    return props.projection.encyclopedia.entries.filter(entry => (
      (encyclopediaCategory === 'all' || entry.category === encyclopediaCategory)
        && (!query || `${entry.title}\n${entry.summary}\n${entry.details.join('\n')}`.toLocaleLowerCase().includes(query))
    ))
  }, [encyclopediaCategory, encyclopediaQuery, props.projection.encyclopedia.entries])

  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1.length) % TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1.length - 1
    if (nextIndex == null) return
    event.preventDefault()
    const nextTab = TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1[nextIndex]
    setActiveTab(nextTab)
    tabRefs.current[nextIndex]?.focus()
  }

  return <article
    className="rounded border border-border bg-bg-surface p-4"
    data-testid="text-open-world-world-record-panel"
  >
    <div className="mb-3">
      <h2 className="text-sm font-semibold">世界记录</h2>
      <p className="mt-1 text-[11px] text-text-muted">只记录角色已经接触、听闻或亲历的世界内容。</p>
    </div>

    <div
      role="tablist"
      aria-label="世界记录分类"
      className="grid grid-cols-3 gap-1 rounded bg-bg-base p-1 sm:grid-cols-5"
    >
      {TEXT_OPEN_WORLD_PLAYER_WORLD_RECORD_TABS_V1.map((tab, index) => <button
        key={tab}
        ref={node => { tabRefs.current[index] = node }}
        id={`text-open-world-world-record-tab-${tab}`}
        type="button"
        role="tab"
        aria-selected={activeTab === tab}
        aria-controls={`text-open-world-world-record-panel-${tab}`}
        tabIndex={activeTab === tab ? 0 : -1}
        onClick={() => setActiveTab(tab)}
        onKeyDown={event => moveTabFocus(event, index)}
        className={`rounded px-2 py-2 text-xs transition-colors ${activeTab === tab ? 'bg-accent text-white' : 'text-text-muted hover:bg-bg-surface hover:text-text-primary'}`}
      >{TAB_LABELS[tab]}</button>)}
    </div>

    {activeTab === 'relationships' && <section
      id="text-open-world-world-record-panel-relationships"
      role="tabpanel"
      aria-labelledby="text-open-world-world-record-tab-relationships"
      data-testid="text-open-world-relationships"
      className="mt-4 space-y-4"
    >
      <div className="rounded border border-border bg-bg-base p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <strong>道德评价</strong>
          <span>{props.projection.relationships.morality.value}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-border" aria-hidden="true">
          <div
            className="h-full rounded bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, ((props.projection.relationships.morality.value - props.projection.relationships.morality.minimum) / Math.max(1, props.projection.relationships.morality.maximum - props.projection.relationships.morality.minimum)) * 100))}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-text-muted">范围 {props.projection.relationships.morality.minimum}～{props.projection.relationships.morality.maximum}</p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold">已接触势力</h3>
        {props.projection.relationships.factions.length ? <ul className="space-y-1">
          {props.projection.relationships.factions.map(faction => <li key={faction.uiId} className="flex items-center justify-between gap-3 rounded bg-bg-base px-3 py-2 text-xs">
            <span>{faction.title}</span><strong>亲合度 {faction.affinity}</strong>
          </li>)}
        </ul> : <EmptyState>尚未接触任何有记录的势力。</EmptyState>}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold">人物关系</h3>
        {props.projection.relationships.actors.length ? <ul className="space-y-2">
          {props.projection.relationships.actors.map(actor => <li key={actor.uiId} className="rounded border border-border p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{actor.name}</strong>
              <span className={`rounded border px-2 py-0.5 text-[10px] ${ATTITUDE_CLASSES[actor.attitude]}`}>{actor.attitudeLabel}</span>
            </div>
            <p className="mt-2 text-text-muted">问候语气：{actor.greetingTone}</p>
            {actor.factionTitle && <p className="mt-1 text-[11px] text-text-muted">所属势力：{actor.factionTitle}</p>}
            {!!actor.contextLabels.length && <p className="mt-1 text-[11px] text-text-muted">{actor.contextLabels.join(' · ')}</p>}
            {!!actor.knownReasonLabels.length && <p className="mt-1 text-[11px] text-text-muted">关系受以下已知经历影响：{actor.knownReasonLabels.join('、')}</p>}
            <p className="mt-1 text-[11px] text-text-muted">{actor.optionalInteractionSummary}{actor.tradeSummary ? ` · ${actor.tradeSummary}` : ''}</p>
          </li>)}
        </ul> : <EmptyState>当前位置和已揭示任务中还没有可记录的人物关系。</EmptyState>}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold">近期关系变化</h3>
        {props.projection.relationships.recentChanges.length ? <ol className="space-y-2">
          {props.projection.relationships.recentChanges.map(change => <li key={change.uiId} className="rounded bg-bg-base p-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2"><strong>{change.title}</strong>{change.timeLabel && <span className="text-[10px] text-text-muted">{change.timeLabel}</span>}</div>
            {change.detail && <p className="mt-1 text-text-muted">{change.detail}</p>}
          </li>)}
        </ol> : <EmptyState>还没有可回顾的关系变化。</EmptyState>}
      </div>
    </section>}

    {activeTab === 'encyclopedia' && <section
      id="text-open-world-world-record-panel-encyclopedia"
      role="tabpanel"
      aria-labelledby="text-open-world-world-record-tab-encyclopedia"
      className="mt-4 space-y-3"
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="text-[11px] text-text-muted">
          搜索百科
          <input
            type="search"
            value={encyclopediaQuery}
            onChange={event => setEncyclopediaQuery(event.target.value)}
            placeholder="搜索名称或已知内容"
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-2 text-xs text-text-primary"
          />
        </label>
        <label className="text-[11px] text-text-muted">
          分类
          <select
            value={encyclopediaCategory}
            onChange={event => setEncyclopediaCategory(event.target.value as typeof encyclopediaCategory)}
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-2 text-xs text-text-primary"
          >
            <option value="all">全部</option>
            {props.projection.encyclopedia.categories.map(category => <option key={category.kind} value={category.kind}>{category.label}（{category.count}）</option>)}
          </select>
        </label>
      </div>
      {filteredEncyclopediaEntries.length ? <ul className="grid gap-2 lg:grid-cols-2">
        {filteredEncyclopediaEntries.map(entry => <li key={entry.uiId} className="rounded border border-border p-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><span className="text-[10px] text-text-muted">{entry.categoryLabel}</span><h3 className="font-semibold">{entry.title}</h3></div>
            <span className="rounded bg-bg-base px-2 py-1 text-[10px] text-text-muted">{entry.certaintyLabel}</span>
          </div>
          <p className="mt-2 text-text-muted">{entry.summary}</p>
          {entry.details.map((detail, index) => <p key={`${entry.uiId}-detail-${index}`} className="mt-1 text-[11px] text-text-muted">{detail}</p>)}
          {entry.mapFocus && <button
            type="button"
            onClick={() => props.onFocusLocation(entry.mapFocus!.locationKey)}
            className="mt-3 rounded border border-border px-2 py-1 text-[11px] hover:border-accent hover:text-accent"
          >在地图中查看</button>}
        </li>)}
      </ul> : <EmptyState>{props.projection.encyclopedia.entries.length ? '没有匹配当前筛选的百科条目。' : '旅途中还没有形成可查看的百科记录。'}</EmptyState>}
    </section>}

    {activeTab === 'rumors' && <section
      id="text-open-world-world-record-panel-rumors"
      role="tabpanel"
      aria-labelledby="text-open-world-world-record-tab-rumors"
      className="mt-4"
    >
      {props.projection.rumors.entries.length ? <ul className="space-y-2">
        {props.projection.rumors.entries.map(rumor => <li key={rumor.uiId} className="rounded border border-border p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>传闻记录</strong>
            <span className="rounded bg-bg-base px-2 py-1 text-[10px]">可信程度：{rumor.reliabilityLabel}</span>
          </div>
          <p className="mt-2">{rumor.text}</p>
          <p className="mt-2 text-[11px] text-text-muted">{rumor.relatedFactStatusLabel}</p>
          {(rumor.heardAtLabel || rumor.regionTitle) && <p className="mt-1 text-[10px] text-text-muted">{[rumor.heardAtLabel, rumor.regionTitle].filter(Boolean).join(' · ')}</p>}
        </li>)}
      </ul> : <EmptyState>还没有亲自听闻并记录的传闻。</EmptyState>}
    </section>}

    {activeTab === 'history' && <section
      id="text-open-world-world-record-panel-history"
      role="tabpanel"
      aria-labelledby="text-open-world-world-record-tab-history"
      className="mt-4 space-y-4"
    >
      {props.projection.history.status === 'awaiting-events' && <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs" role="status">事件记录正在与当前存档同步，完成前不会展示不完整历程。</p>}
      <div>
        <h3 className="mb-2 text-xs font-semibold">行动与世界变化</h3>
        {props.projection.history.eventEntries.length ? <ol className="space-y-2">
          {props.projection.history.eventEntries.map(entry => <li key={entry.uiId} className="rounded border border-border p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><span className="text-[10px] text-text-muted">{entry.categoryLabel} · {entry.originLabel}</span><h4 className="font-semibold">{entry.headline}</h4></div>{entry.timeLabel && <span className="text-[10px] text-text-muted">{entry.timeLabel}</span>}</div>
            {entry.details.map((detail, index) => <p key={`${entry.uiId}-detail-${index}`} className="mt-1 text-text-muted">{detail}</p>)}
          </li>)}
        </ol> : <EmptyState>{props.projection.history.status === 'awaiting-events' ? '等待事件记录同步。' : '还没有可回顾的行动或世界变化。'}</EmptyState>}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold">见闻与发现</h3>
        {props.projection.history.knowledgeEntries.length ? <ol className="space-y-2">
          {props.projection.history.knowledgeEntries.map(entry => <li key={entry.uiId} className="rounded bg-bg-base p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><span className="text-[10px] text-text-muted">{entry.kindLabel}</span><h4 className="font-semibold">{entry.headline}</h4></div><span className="text-[10px] text-text-muted">{entry.timeLabel}</span></div>
            {entry.details.map((detail, index) => <p key={`${entry.uiId}-detail-${index}`} className="mt-1 text-text-muted">{detail}</p>)}
            {entry.regionTitle && <p className="mt-1 text-[10px] text-text-muted">记录地点：{entry.regionTitle}</p>}
          </li>)}
        </ol> : <EmptyState>还没有可回顾的见闻与发现。</EmptyState>}
      </div>
    </section>}

    {activeTab === 'achievements' && <section
      id="text-open-world-world-record-panel-achievements"
      role="tabpanel"
      aria-labelledby="text-open-world-world-record-tab-achievements"
      className="mt-4 space-y-3"
    >
      <div className="rounded bg-bg-base p-3 text-xs">
        <strong>已获得 {props.projection.achievements.earnedCount} / {props.projection.achievements.totalCount}</strong>
        <p className="mt-1 text-[11px] text-text-muted">另有 {props.projection.achievements.lockedCount} 项尚未解锁；未解锁内容保持隐藏。</p>
      </div>
      {props.projection.achievements.earned.length ? <ul className="space-y-2">
        {props.projection.achievements.earned.map(achievement => <li key={achievement.uiId} className="rounded border border-border p-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2"><strong>{achievement.title}</strong>{achievement.earnedAtLabel && <span className="text-[10px] text-text-muted">{achievement.earnedAtLabel}</span>}</div>
          <p className="mt-1 text-text-muted">{achievement.description}</p>
          {achievement.regionTitle && <p className="mt-1 text-[10px] text-text-muted">获得地点：{achievement.regionTitle}</p>}
        </li>)}
      </ul> : <EmptyState>还没有获得成就。继续探索时，未解锁成就不会提前剧透。</EmptyState>}
    </section>}
  </article>
}
