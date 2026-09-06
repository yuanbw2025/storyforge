import { MapPinned } from 'lucide-react'
import { projectTextOpenWorldPlayerMapV1 } from '../../lib/open-world/map-view'
import {
  projectTextOpenWorldFastTravelOptionsV1,
  projectTextOpenWorldTravelOptionsV1,
  type TextOpenWorldFastTravelOptionV1,
  type TextOpenWorldTravelOptionV1,
} from '../../lib/open-world/travel'
import type { TextOpenWorldSessionProjectionV1 } from '../../lib/types'

const KNOWLEDGE_LABELS = { heard: '听说', visited: '已到访', familiar: '熟悉' } as const
const RISK_LABELS = { safe: '安全', ordinary: '普通风险', dangerous: '危险' } as const

export default function TextOpenWorldMapPanel(props: {
  projection: TextOpenWorldSessionProjectionV1
  busy: boolean
  onTravel(actionKey: string, destinationLocationKey: string): void
}) {
  const view = projectTextOpenWorldPlayerMapV1({ runtimePackage: props.projection.runtimePackage, state: props.projection.state })
  const travelOptions = projectTextOpenWorldTravelOptionsV1(props.projection)
  const fastTravelOptions = projectTextOpenWorldFastTravelOptionsV1(props.projection)
  const travelByDestinationKey = new Map<string, TextOpenWorldTravelOptionV1>()
  travelOptions.forEach(option => { if (!travelByDestinationKey.has(option.destinationLocationKey)) travelByDestinationKey.set(option.destinationLocationKey, option) })
  const fastTravelByDestinationKey = new Map<string, TextOpenWorldFastTravelOptionV1>()
  fastTravelOptions.forEach(option => fastTravelByDestinationKey.set(option.destinationLocationKey, option))
  const nodeByKey = new Map(view.locations.map(node => [node.locationKey, node]))
  return <article className="rounded border border-border bg-bg-surface p-4" data-testid="text-open-world-map-topology">
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><MapPinned className="h-4 w-4 text-accent" />世界地图</div>
    <svg role="img" aria-labelledby="text-open-world-map-title text-open-world-map-description" viewBox={`0 0 ${view.viewBox.width} ${view.viewBox.height}`} className="w-full rounded border border-border bg-bg-base">
      <title id="text-open-world-map-title">玩家当前已知的世界地图</title>
      <desc id="text-open-world-map-description">只显示已经听说或到访的地点；实线道路当前可通行，虚线道路尚未开放。</desc>
      {view.edges.map(edge => {
        const from = nodeByKey.get(edge.fromLocationKey)!
        const to = nodeByKey.get(edge.toLocationKey)!
        return <line key={edge.edgeKey} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" strokeWidth="8" strokeDasharray={edge.open ? undefined : '20 16'} className={edge.open ? 'text-accent/60' : 'text-text-muted/40'} />
      })}
      {view.locations.map(location => { const travel = travelByDestinationKey.get(location.locationKey); return <g key={location.locationKey} transform={`translate(${location.x} ${location.y})`}
        role={travel ? 'button' : undefined} tabIndex={travel ? 0 : undefined} aria-disabled={travel ? !travel.available || props.busy : undefined}
        aria-label={travel ? `${travel.label}，耗时${travel.travelMinutes}分钟` : undefined}
        onClick={() => { if (travel?.available && !props.busy) props.onTravel(travel.actionKey, travel.destinationLocationKey) }}
        onKeyDown={event => { if (travel?.available && !props.busy && (event.key === 'Enter' || event.key === ' ')) props.onTravel(travel.actionKey, travel.destinationLocationKey) }}
        className={travel?.available ? 'cursor-pointer' : undefined}>
        <circle r={location.current ? 28 : 20} className={location.current ? 'fill-accent' : 'fill-bg-surface stroke-text-muted'} strokeWidth="6" />
        <text y="-38" textAnchor="middle" className="fill-current text-[30px] font-semibold">{location.title}</text>
      </g> })}
    </svg>
    <div className="mt-2 space-y-1" aria-label="地图列表视图">
      {view.listFallback.map(location => <div key={location.locationKey} className="rounded bg-bg-base px-2 py-1 text-xs">
        <span className="flex items-center justify-between gap-2"><strong>{location.current ? `当前位置 · ${location.title}` : location.title}</strong><small className="text-text-muted">{KNOWLEDGE_LABELS[location.knowledge]}</small></span>
        {location.description && <p className="mt-1 text-text-muted">{location.description}</p>}
        {location.earlyArrivalDescription && <p className="mt-1 text-text-muted">当前可见：{location.earlyArrivalDescription}</p>}
        {fastTravelByDestinationKey.has(location.locationKey) && <button type="button" disabled={!fastTravelByDestinationKey.get(location.locationKey)!.available || props.busy} onClick={() => {
          const option = fastTravelByDestinationKey.get(location.locationKey)!
          props.onTravel(option.actionKey, option.destinationLocationKey)
        }} className="mt-1 rounded border border-accent/40 px-2 py-1 text-[10px] text-accent disabled:border-border disabled:text-text-muted">快速旅行 · {fastTravelByDestinationKey.get(location.locationKey)!.travelMinutes ?? '—'}分钟</button>}
      </div>)}
    </div>
    <div className="mt-2 space-y-1" aria-label="已知道路列表">
      {travelOptions.map(option => <div key={option.actionKey} className="flex items-center justify-between gap-2 rounded bg-bg-base px-2 py-1 text-[10px] text-text-muted"><span>{nodeByKey.get(option.originLocationKey)!.title} → {option.destinationTitle} · {option.travelMinutes}分钟 · {RISK_LABELS[option.riskProfile]}</span><button type="button" disabled={!option.available || props.busy} onClick={() => props.onTravel(option.actionKey, option.destinationLocationKey)} className="rounded border border-accent/40 px-2 py-1 text-accent disabled:border-border disabled:text-text-muted">{option.available ? '出发' : option.unavailableReasons[0]?.message ?? '不可用'}</button></div>)}
      {!travelOptions.length && view.edges.map(edge => <p key={edge.edgeKey} className="text-[10px] text-text-muted">{nodeByKey.get(edge.fromLocationKey)!.title} {edge.bidirectional ? '↔' : '→'} {nodeByKey.get(edge.toLocationKey)!.title} · {edge.travelMinutes}分钟 · {RISK_LABELS[edge.riskProfile]} · {edge.open ? '可通行' : '未开放'}</p>)}
      {!view.edges.length && <p className="text-xs text-text-muted">尚未发现可显示的道路。</p>}
    </div>
    <div className="mt-2 space-y-1" aria-label="快速旅行列表">
      {fastTravelOptions.map(option => <div key={option.fastTravelPointKey} className="flex items-center justify-between gap-2 rounded bg-bg-base px-2 py-1 text-[10px] text-text-muted"><span>{option.destinationTitle} · {option.travelMinutes == null ? '路线阻断' : `${option.travelMinutes}分钟`}</span><button type="button" disabled={!option.available || props.busy} onClick={() => props.onTravel(option.actionKey, option.destinationLocationKey)} className="rounded border border-accent/40 px-2 py-1 text-accent disabled:border-border disabled:text-text-muted">{option.available ? '快速旅行' : option.unavailableReasons[0]?.message ?? '不可用'}</button></div>)}
      {!fastTravelOptions.length && <p className="text-[10px] text-text-muted">到访其他地点后可解锁快速旅行。</p>}
    </div>
  </article>
}
