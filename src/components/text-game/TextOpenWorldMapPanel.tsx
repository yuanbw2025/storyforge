import { useEffect, useRef, useState } from 'react'
import {
  Clock3,
  Compass,
  Footprints,
  MapPinned,
  MapPin,
  Navigation,
  Route,
  Zap,
} from 'lucide-react'
import {
  projectTextOpenWorldPlayerMapScreenV1,
  type TextOpenWorldPlayerMapLocationFunctionV1,
  type TextOpenWorldPlayerMapLocationV1,
} from '../../lib/open-world/player-map'
import { classifyTextOpenWorldPlayerIssueV1 } from '../../lib/open-world/player-resilience'
import type {
  TextOpenWorldFastTravelOptionV1,
  TextOpenWorldTravelOptionV1,
} from '../../lib/open-world/travel'
import type {
  TextOpenWorldFeedbackReceiptV1,
  TextOpenWorldSessionProjectionV1,
} from '../../lib/types'

const KNOWLEDGE_LABELS = { unknown: '未探索', heard: '听说', visited: '已到访', familiar: '熟悉' } as const
const RISK_LABELS = { safe: '安全', ordinary: '普通风险', dangerous: '危险' } as const
const KIND_LABELS = {
  settlement: '聚落', interior: '室内', wilderness: '荒野', dungeon: '险地', landmark: '地标',
} as const
const FUNCTION_LABELS: Record<TextOpenWorldPlayerMapLocationFunctionV1, string> = {
  narrative: '故事', service: '服务', exploration: '探索', combat: '战斗', crafting: '制作', travel: '交通',
}

export interface TextOpenWorldMapTravelRequestV1 {
  sessionKey: string | number
  expectedBaseSequence: number
  kind: 'travel' | 'fast-travel'
  actionKey: string
  destinationLocationKey: string
}

export type TextOpenWorldMapTravelResultV1 =
  | TextOpenWorldFeedbackReceiptV1
  | null
  | void
  | Promise<TextOpenWorldFeedbackReceiptV1 | null | void>

interface MapSelection {
  sessionKey: string | number
  baseSequence: number
  locationKey: string
}

interface MapActionOutcome {
  sessionKey: string | number
  actionKey: string
  destinationLocationKey: string
  baseSequence: number
  feedback: TextOpenWorldFeedbackReceiptV1 | null
  error: string | null
}

function requestMatchesReceipt(
  request: TextOpenWorldMapTravelRequestV1,
  receipt: TextOpenWorldFeedbackReceiptV1,
): boolean {
  return typeof request.sessionKey === 'number'
    && receipt.sessionId === request.sessionKey
    && receipt.actionKey === request.actionKey
    && receipt.targetKey === request.destinationLocationKey
    && receipt.baseSequence === request.expectedBaseSequence
}

function errorMessage(error: unknown): string {
  return classifyTextOpenWorldPlayerIssueV1({
    error,
    surface: 'runtime-operation',
  })?.message ?? '地图操作未能完成。'
}

function firstReason(
  option: TextOpenWorldTravelOptionV1 | TextOpenWorldFastTravelOptionV1,
): string {
  return option.unavailableReasons[0]?.message ?? '当前不可用。'
}

function OrdinaryTravelButton(props: {
  option: TextOpenWorldTravelOptionV1
  busy: boolean
  blockedReason: string | null
  onConfirm(option: TextOpenWorldTravelOptionV1): void
}) {
  const disabled = !props.option.available || props.busy || props.blockedReason != null
  return <button
    type="button"
    disabled={disabled}
    aria-label={`${props.option.label}：前往${props.option.destinationTitle}，耗时${props.option.travelMinutes}分钟，${RISK_LABELS[props.option.riskProfile]}`}
    title={props.blockedReason ?? (!props.option.available ? firstReason(props.option) : props.option.description)}
    onClick={() => props.onConfirm(props.option)}
    className="inline-flex min-h-11 items-center justify-center gap-1 rounded border border-accent/40 px-3 py-2 text-[10px] text-accent disabled:border-border disabled:text-text-muted"
  >
    <Footprints className="h-3 w-3" aria-hidden="true" />
    沿道路出发 · {props.option.travelMinutes}分钟
  </button>
}

function FastTravelButton(props: {
  option: TextOpenWorldFastTravelOptionV1
  busy: boolean
  blockedReason: string | null
  onConfirm(option: TextOpenWorldFastTravelOptionV1): void
}) {
  const disabled = !props.option.available || props.busy || props.blockedReason != null
  return <button
    type="button"
    disabled={disabled}
    aria-label={`${props.option.label}：前往${props.option.destinationTitle}${props.option.travelMinutes == null ? '' : `，耗时${props.option.travelMinutes}分钟`}`}
    title={props.blockedReason ?? (!props.option.available ? firstReason(props.option) : props.option.description)}
    onClick={() => props.onConfirm(props.option)}
    className="inline-flex min-h-11 items-center justify-center gap-1 rounded border border-accent/40 px-3 py-2 text-[10px] text-accent disabled:border-border disabled:text-text-muted"
  >
    <Zap className="h-3 w-3" aria-hidden="true" />
    确认快速旅行 · {props.option.travelMinutes ?? '—'}分钟
  </button>
}

function LocationActions(props: {
  location: TextOpenWorldPlayerMapLocationV1
  busy: boolean
  blockedReason: string | null
  onOrdinary(option: TextOpenWorldTravelOptionV1): void
  onFast(option: TextOpenWorldFastTravelOptionV1): void
}) {
  if (props.location.current) {
    return <span className="inline-flex items-center gap-1 text-[10px] text-accent">
      <MapPin className="h-3 w-3" aria-hidden="true" />你在这里
    </span>
  }
  const hasOptions = props.location.ordinaryTravelOptions.length > 0 || props.location.fastTravelOption != null
  if (!hasOptions) return <span className="text-[10px] text-text-muted">当前没有可直接执行的路线</span>
  return <div className="flex flex-wrap gap-2">
    {props.location.ordinaryTravelOptions.map(option => <OrdinaryTravelButton
      key={option.actionKey}
      option={option}
      busy={props.busy}
      blockedReason={props.blockedReason}
      onConfirm={props.onOrdinary}
    />)}
    {props.location.fastTravelOption && <FastTravelButton
      option={props.location.fastTravelOption}
      busy={props.busy}
      blockedReason={props.blockedReason}
      onConfirm={props.onFast}
    />}
  </div>
}

export default function TextOpenWorldMapPanel(props: {
  projection: TextOpenWorldSessionProjectionV1
  /** Authoritative ProductRuntime event baseline, not the nested game projection sequence. */
  runtimeEventSequence: number
  busy: boolean
  /** Pure UI identity: changing Session resets browsing and pending map feedback. */
  sessionKey?: string | number | null
  /** UI-only task focus. Unknown locations are ignored and never disclosed. */
  focusedLocationKey?: string | null
  /** Lets a repeated request for the same known location restore keyboard focus. */
  focusedLocationRequestId?: number | null
  onTravel(request: TextOpenWorldMapTravelRequestV1): TextOpenWorldMapTravelResultV1
}) {
  const map = projectTextOpenWorldPlayerMapScreenV1(props.projection)
  const sessionKey = props.sessionKey ?? 'map-session'
  const nodeByKey = new Map(map.locations.map(node => [node.locationKey, node]))
  const regionByKey = new Map(map.regions.map(region => [region.regionKey, region]))
  const focusedLocationKey = props.focusedLocationKey && nodeByKey.has(props.focusedLocationKey)
    ? props.focusedLocationKey
    : null
  const [selection, setSelection] = useState<MapSelection>(() => ({
    sessionKey,
    baseSequence: props.runtimeEventSequence,
    locationKey: focusedLocationKey ?? map.currentLocationKey,
  }))
  const selectedLocationKey = selection.sessionKey === sessionKey && nodeByKey.has(selection.locationKey)
    ? selection.locationKey
    : map.currentLocationKey
  const selectedLocation = nodeByKey.get(selectedLocationKey)!
  const selectedRegion = regionByKey.get(selectedLocation.regionKey)!
  const selectionStale = selection.sessionKey !== sessionKey
    || selection.baseSequence !== props.runtimeEventSequence
  const locationItemRefs = useRef(new Map<string, HTMLDivElement>())
  const previousCurrentLocationKey = useRef(map.currentLocationKey)
  const previousSessionKey = useRef<string | number>(sessionKey)
  const currentSessionKey = useRef<string | number>(sessionKey)
  currentSessionKey.current = sessionKey
  const requestGeneration = useRef(0)
  const submitting = useRef(false)
  const [submittingRequest, setSubmittingRequest] = useState<TextOpenWorldMapTravelRequestV1 | null>(null)
  const [mapOutcome, setMapOutcome] = useState<MapActionOutcome | null>(null)
  const selectionContext = useRef({
    sessionKey,
    baseSequence: props.runtimeEventSequence,
  })
  selectionContext.current = {
    sessionKey,
    baseSequence: props.runtimeEventSequence,
  }

  const selectLocation = (locationKey: string) => {
    if (!nodeByKey.has(locationKey)) return
    setMapOutcome(null)
    setSelection({
      sessionKey,
      baseSequence: props.runtimeEventSequence,
      locationKey,
    })
  }

  useEffect(() => {
    if (previousSessionKey.current === sessionKey) return
    previousSessionKey.current = sessionKey
    previousCurrentLocationKey.current = map.currentLocationKey
    requestGeneration.current += 1
    submitting.current = false
    setSubmittingRequest(null)
    setMapOutcome(null)
    setSelection({
      sessionKey,
      baseSequence: props.runtimeEventSequence,
      locationKey: focusedLocationKey ?? map.currentLocationKey,
    })
  }, [focusedLocationKey, map.currentLocationKey, props.runtimeEventSequence, sessionKey])

  useEffect(() => () => {
    requestGeneration.current += 1
    submitting.current = false
  }, [])

  useEffect(() => {
    if (previousCurrentLocationKey.current === map.currentLocationKey) return
    previousCurrentLocationKey.current = map.currentLocationKey
    setSelection({
      sessionKey,
      baseSequence: props.runtimeEventSequence,
      locationKey: map.currentLocationKey,
    })
  }, [map.currentLocationKey, props.runtimeEventSequence, sessionKey])

  useEffect(() => {
    if (!focusedLocationKey) return
    const context = selectionContext.current
    setMapOutcome(null)
    setSelection({
      sessionKey: context.sessionKey,
      baseSequence: context.baseSequence,
      locationKey: focusedLocationKey,
    })
    const timeout = window.setTimeout(() => locationItemRefs.current.get(focusedLocationKey)?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [focusedLocationKey, props.focusedLocationRequestId])

  const submitTravel = (
    kind: TextOpenWorldMapTravelRequestV1['kind'],
    option: TextOpenWorldTravelOptionV1 | TextOpenWorldFastTravelOptionV1,
  ) => {
    if (!option.available || props.busy || submitting.current || selectionStale) return
    const request: TextOpenWorldMapTravelRequestV1 = {
      sessionKey: selection.sessionKey,
      expectedBaseSequence: selection.baseSequence,
      kind,
      actionKey: option.actionKey,
      destinationLocationKey: option.destinationLocationKey,
    }
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    submitting.current = true
    setSubmittingRequest(request)
    setMapOutcome(null)
    let result: TextOpenWorldMapTravelResultV1
    try {
      result = props.onTravel(request)
    } catch (error) {
      result = Promise.reject(error)
    }
    void Promise.resolve(result)
      .then(feedback => {
        if (requestGeneration.current !== generation || currentSessionKey.current !== request.sessionKey) return
        if (!feedback) return
        setMapOutcome({
          sessionKey: request.sessionKey,
          actionKey: request.actionKey,
          destinationLocationKey: request.destinationLocationKey,
          baseSequence: request.expectedBaseSequence,
          feedback: requestMatchesReceipt(request, feedback) ? feedback : null,
          error: requestMatchesReceipt(request, feedback)
            ? null
            : '旅行结果与本次请求不一致，已停止显示该结果。',
        })
      })
      .catch(error => {
        if (requestGeneration.current !== generation || currentSessionKey.current !== request.sessionKey) return
        setMapOutcome({
          sessionKey: request.sessionKey,
          actionKey: request.actionKey,
          destinationLocationKey: request.destinationLocationKey,
          baseSequence: request.expectedBaseSequence,
          feedback: null,
          error: errorMessage(error),
        })
      })
      .finally(() => {
        if (requestGeneration.current !== generation || currentSessionKey.current !== request.sessionKey) return
        submitting.current = false
        setSubmittingRequest(null)
      })
  }
  const visibleOutcome = mapOutcome?.sessionKey === sessionKey
    ? mapOutcome
    : null
  const mapFeedback = visibleOutcome?.feedback ?? null
  const mapError = visibleOutcome?.error?.trim() || null
  const travelBusy = props.busy || submittingRequest != null
  const highlightedRouteKeys = new Set([
    ...selectedLocation.ordinaryTravelOptions.map(option => option.edgeKey),
    ...(selectedLocation.fastTravelOption?.routeEdgeKeys ?? []),
  ].filter(edgeKey => map.routes.some(route => route.edgeKey === edgeKey)))
  const blockedReason = selectionStale
    ? '地图状态已经变化，请重新选择地点后再出发。'
    : null

  return <article
    className="rounded border border-border bg-bg-surface p-3 sm:p-4"
    data-testid="text-open-world-map-topology"
    data-open-world-ui-key="overlay.map"
  >
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MapPinned className="h-4 w-4 text-accent" aria-hidden="true" />世界地图
        </div>
        <p className="mt-1 text-[10px] text-text-muted">地图只呈现当前角色已经听说或到访的内容。</p>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] text-text-muted" aria-label="地图探索摘要">
        <span className="rounded border border-border px-2 py-1">已知地点 {map.knownLocationCount}</span>
        <span className="rounded border border-border px-2 py-1">已到访 {map.visitedLocationCount}</span>
        <span className="rounded border border-border px-2 py-1">快旅点 {map.unlockedFastTravelPointCount}</span>
      </div>
    </header>

    {(mapFeedback || mapError) && <section
      className={`mt-3 rounded border px-3 py-2 text-xs ${mapFeedback?.presentation.mayNarrateSuccess ? 'border-accent/40 bg-accent/5' : 'border-danger/40 bg-danger/5'}`}
      data-testid="text-open-world-map-feedback"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <strong>{mapFeedback?.presentation.headline ?? '旅行未能执行'}</strong>
      {mapFeedback?.presentation.details.slice(0, 3).map((detail, index) => <p key={`${index}:${detail}`} className="mt-1 text-text-muted">{detail}</p>)}
      {mapError && <p className="mt-1 text-text-muted">{mapError}</p>}
    </section>}

    <div className="mt-3 flex flex-wrap gap-2" aria-label="已知地区">
      {map.regions.map(region => <button
        type="button"
        key={region.regionKey}
        onClick={() => {
          const location = region.locations.find(item => item.current) ?? region.locations[0]
          if (location) selectLocation(location.locationKey)
        }}
        className={`min-h-9 rounded-full border px-3 py-1 text-[10px] ${region.regionKey === selectedRegion.regionKey ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted'}`}
        aria-pressed={region.regionKey === selectedRegion.regionKey}
      >
        {region.title} · {KNOWLEDGE_LABELS[region.knowledge]}
      </button>)}
    </div>

    <div className="open-world-player-map-primary mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="min-w-0" aria-label="交互式节点地图">
        <svg
          role="group"
          aria-labelledby="text-open-world-map-title text-open-world-map-description"
          viewBox={`0 0 ${map.viewBox.width} ${map.viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="open-world-player-map-svg block h-auto min-h-[16rem] w-full rounded border border-border bg-bg-base"
          data-testid="text-open-world-map-svg"
          data-layout-source={map.layoutSource}
        >
          <title id="text-open-world-map-title">玩家当前已知的世界地图</title>
          <desc id="text-open-world-map-description">只显示已经听说或到访的地点；实线道路当前可通行，虚线道路尚未开放。选择地点后查看路线并确认出发。</desc>
          {map.routes.map(route => {
            const from = nodeByKey.get(route.fromLocationKey)!
            const to = nodeByKey.get(route.toLocationKey)!
            const highlighted = highlightedRouteKeys.has(route.edgeKey)
            return <line
              key={route.edgeKey}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="currentColor"
              strokeWidth={highlighted ? 13 : 8}
              strokeDasharray={route.open ? undefined : '20 16'}
              className={highlighted ? 'text-accent' : route.open ? 'text-accent/45' : 'text-text-muted/35'}
              data-map-route={route.edgeKey}
              data-route-selected={highlighted || undefined}
              aria-hidden="true"
            />
          })}
          {map.locations.map(location => {
            const selected = location.locationKey === selectedLocationKey
            const focused = location.locationKey === focusedLocationKey
            return <g
              key={location.locationKey}
              transform={`translate(${location.x} ${location.y})`}
              role="button"
              tabIndex={0}
              aria-label={`查看地点：${location.title}，${KNOWLEDGE_LABELS[location.knowledge]}${location.current ? '，当前位置' : ''}`}
              aria-pressed={selected}
              data-map-location={location.locationKey}
              data-map-knowledge={location.knowledge}
              data-task-focused={focused || undefined}
              onClick={() => selectLocation(location.locationKey)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                selectLocation(location.locationKey)
              }}
              className="cursor-pointer"
            >
              <circle
                r="58"
                fill="transparent"
                pointerEvents="all"
                data-map-location-hit={location.locationKey}
                aria-hidden="true"
              />
              <circle r="52" className="open-world-player-map-focus-ring" aria-hidden="true" />
              {focused && <circle r={location.current ? 49 : 42} className="fill-none stroke-accent" strokeWidth="5" strokeDasharray="10 7" aria-hidden="true" />}
              {selected && <circle r={location.current ? 40 : 34} className="fill-none stroke-warning" strokeWidth="5" aria-hidden="true" />}
              <circle
                r={location.current ? 28 : 22}
                className={location.current
                  ? 'fill-accent stroke-accent'
                  : location.knowledge === 'heard'
                    ? 'fill-bg-base stroke-text-muted'
                    : 'fill-bg-surface stroke-accent/70'}
                strokeWidth="6"
                strokeDasharray={location.knowledge === 'heard' ? '8 5' : undefined}
              />
              {location.unlockedFastTravelPointKey && <text y="8" textAnchor="middle" className="fill-current text-[22px] font-bold" aria-hidden="true">↯</text>}
              <text y="-43" textAnchor="middle" className="fill-current text-[28px] font-semibold">{location.title}</text>
            </g>
          })}
        </svg>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted" aria-label="地图图例">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />当前位置</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-warning" />选中地点</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-dashed border-text-muted" />仅听说</span>
          <span>↯ 已解锁快速旅行</span>
          <span>虚线道路 = 当前阻断</span>
        </div>
      </section>

      <aside
        className="min-w-0 rounded border border-border bg-bg-base p-3"
        aria-label="选中地点详情"
        aria-live="polite"
        data-selected-location={selectedLocation.locationKey}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <small className="text-text-muted">{selectedRegion.title} · {KNOWLEDGE_LABELS[selectedLocation.knowledge]}</small>
            <h3 className="mt-1 break-words text-sm font-semibold">{selectedLocation.title}</h3>
          </div>
          {selectedLocation.current && <MapPin className="h-4 w-4 shrink-0 text-accent" aria-label="当前位置" />}
        </div>
        {selectedLocation.kind && <p className="mt-2 text-[10px] text-text-muted">地点类型：{KIND_LABELS[selectedLocation.kind]}</p>}
        {selectedLocation.description
          ? <p className="mt-2 text-xs leading-5 text-text-muted">{selectedLocation.description}</p>
          : <p className="mt-2 text-xs leading-5 text-text-muted">你目前只知道这个地点的名称；亲自到访后才能了解更多。</p>}
        {selectedLocation.earlyArrivalDescription && <p className="mt-2 rounded border border-border px-2 py-1 text-[10px] text-text-muted">当前可见：{selectedLocation.earlyArrivalDescription}</p>}
        {selectedRegion.theme && <p className="mt-2 text-[10px] text-text-muted">地区主题：{selectedRegion.theme}</p>}
        {selectedRegion.levelBand && <p className="mt-1 text-[10px] text-text-muted">建议等级：{selectedRegion.levelBand.minimum}—{selectedRegion.levelBand.maximum}</p>}
        {selectedLocation.functions && <div className="mt-3 flex flex-wrap gap-1" aria-label="地点功能">
          {selectedLocation.functions.map(item => <span key={item} className="rounded bg-bg-surface px-2 py-1 text-[9px] text-text-muted">{FUNCTION_LABELS[item]}</span>)}
        </div>}
        {selectedLocation.unlockedFastTravelPointKey && <p className="mt-3 flex items-center gap-1 text-[10px] text-accent"><Zap className="h-3 w-3" aria-hidden="true" />快速旅行点已解锁</p>}

        <div className="mt-4 border-t border-border pt-3" aria-label="前往选中地点">
          <strong className="flex items-center gap-1 text-xs"><Navigation className="h-3 w-3 text-accent" aria-hidden="true" />可用路线</strong>
          <div className="mt-2">
            <LocationActions
              location={selectedLocation}
              busy={travelBusy}
              blockedReason={blockedReason}
              onOrdinary={option => submitTravel('travel', option)}
              onFast={option => submitTravel('fast-travel', option)}
            />
          </div>
          {blockedReason && <div className="mt-2 rounded border border-warning/40 px-2 py-2 text-[10px] text-warning">
            {blockedReason}
            <button type="button" className="ml-2 underline" onClick={() => selectLocation(selectedLocation.locationKey)}>重新选择</button>
          </div>}
          {selectedLocation.ordinaryTravelOptions.map(option => <p key={option.actionKey} className="mt-2 text-[10px] text-text-muted">
            <Clock3 className="mr-1 inline h-3 w-3" aria-hidden="true" />{option.travelMinutes}分钟 · {RISK_LABELS[option.riskProfile]}
            {!option.available && ` · ${firstReason(option)}`}
          </p>)}
          {selectedLocation.fastTravelOption && <p className="mt-2 text-[10px] text-text-muted">
            快旅耗时：{selectedLocation.fastTravelOption.travelMinutes == null ? '路线阻断' : `${selectedLocation.fastTravelOption.travelMinutes}分钟`} · 不演出普通途中事件
            {!selectedLocation.fastTravelOption.available && ` · ${firstReason(selectedLocation.fastTravelOption)}`}
          </p>}
        </div>
      </aside>
    </div>

    <section className="mt-4" aria-labelledby="text-open-world-map-list-title">
      <div className="flex items-center gap-2 text-xs font-semibold" id="text-open-world-map-list-title">
        <Compass className="h-3 w-3 text-accent" aria-hidden="true" />地点列表
      </div>
      <p className="mt-1 text-[10px] text-text-muted">移动端与键盘玩家可以在这里完成与节点地图相同的选点和旅行操作。</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="地图列表视图" role="list">
        {map.listFallback.map(location => {
          const focused = location.locationKey === focusedLocationKey
          const selected = location.locationKey === selectedLocationKey
          return <div
            key={location.locationKey}
            ref={element => {
              if (element) locationItemRefs.current.set(location.locationKey, element)
              else locationItemRefs.current.delete(location.locationKey)
            }}
            role="listitem"
            className={`min-w-0 rounded border bg-bg-base p-2 text-xs ${selected ? 'border-accent/60' : 'border-border'}${focused ? ' ring-1 ring-accent' : ''}`}
            data-task-focused={focused || undefined}
            data-selected={selected || undefined}
            aria-current={location.current ? 'location' : undefined}
            tabIndex={focused ? -1 : undefined}
          >
            <button
              type="button"
              className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 text-left"
              aria-pressed={selected}
              onClick={() => selectLocation(location.locationKey)}
            >
              <strong className="min-w-0 break-words">{location.current ? `当前位置 · ${location.title}` : location.title}</strong>
              <small className="shrink-0 text-text-muted">{KNOWLEDGE_LABELS[location.knowledge]}</small>
            </button>
            {focused && <small className="mt-1 block text-accent">任务定位</small>}
            {location.description && <p className="mt-1 text-text-muted">{location.description}</p>}
            {location.earlyArrivalDescription && <p className="mt-1 text-text-muted">当前可见：{location.earlyArrivalDescription}</p>}
            {selected && <div className="mt-2 border-t border-border pt-2">
              <LocationActions
                location={location}
                busy={travelBusy}
                blockedReason={blockedReason}
                onOrdinary={option => submitTravel('travel', option)}
                onFast={option => submitTravel('fast-travel', option)}
              />
            </div>}
          </div>
        })}
      </div>
    </section>

    <section className="mt-4" aria-labelledby="text-open-world-road-list-title">
      <div className="flex items-center gap-2 text-xs font-semibold" id="text-open-world-road-list-title">
        <Route className="h-3 w-3 text-accent" aria-hidden="true" />已知道路
      </div>
      <div className="mt-2 space-y-1" aria-label="已知道路列表">
        {map.routes.map(route => {
          const travel = route.ordinaryTravelOptions[0] ?? null
          return <div key={route.edgeKey} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded bg-bg-base px-2 py-2 text-[10px] text-text-muted">
            <span className="min-w-0 break-words">{route.fromTitle} {route.bidirectional ? '↔' : '→'} {route.toTitle} · {route.travelMinutes}分钟 · {RISK_LABELS[route.riskProfile]} · {route.open ? '可通行' : '未开放'}</span>
            {travel && <button type="button" className="min-h-9 rounded border border-border px-2 py-1 text-accent" onClick={() => selectLocation(travel.destinationLocationKey)}>查看路线</button>}
          </div>
        })}
        {!map.routes.length && <p className="text-xs text-text-muted">尚未发现可显示的道路。</p>}
      </div>
    </section>

    <section className="mt-4" aria-labelledby="text-open-world-fast-travel-list-title">
      <div className="flex items-center gap-2 text-xs font-semibold" id="text-open-world-fast-travel-list-title">
        <Zap className="h-3 w-3 text-accent" aria-hidden="true" />快速旅行
      </div>
      <div className="mt-2 space-y-1" aria-label="快速旅行列表">
        {map.locations.flatMap(location => location.fastTravelOption ? [
          <div key={location.fastTravelOption.fastTravelPointKey} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded bg-bg-base px-2 py-2 text-[10px] text-text-muted">
            <span className="min-w-0 break-words">{location.title} · {location.fastTravelOption.travelMinutes == null ? '路线阻断' : `${location.fastTravelOption.travelMinutes}分钟`}</span>
            <button type="button" className="min-h-9 rounded border border-border px-2 py-1 text-accent" onClick={() => selectLocation(location.locationKey)}>查看快旅路线</button>
          </div>,
        ] : [])}
        {!map.locations.some(location => location.fastTravelOption) && <p className="text-[10px] text-text-muted">到访其他地点后可解锁快速旅行。</p>}
      </div>
    </section>
  </article>
}
