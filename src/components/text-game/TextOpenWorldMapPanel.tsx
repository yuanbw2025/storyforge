import { MapPinned } from 'lucide-react'
import { projectTextOpenWorldPlayerMapV1 } from '../../lib/open-world/map-view'
import type { TextOpenWorldEffectStateV1, TextOpenWorldRuntimePackageV1 } from '../../lib/types'

const KNOWLEDGE_LABELS = { heard: '听说', visited: '已到访', familiar: '熟悉' } as const
const RISK_LABELS = { safe: '安全', ordinary: '普通风险', dangerous: '危险' } as const

export default function TextOpenWorldMapPanel(props: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
}) {
  const view = projectTextOpenWorldPlayerMapV1(props)
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
      {view.locations.map(location => <g key={location.locationKey} transform={`translate(${location.x} ${location.y})`}>
        <circle r={location.current ? 28 : 20} className={location.current ? 'fill-accent' : 'fill-bg-surface stroke-text-muted'} strokeWidth="6" />
        <text y="-38" textAnchor="middle" className="fill-current text-[30px] font-semibold">{location.title}</text>
      </g>)}
    </svg>
    <div className="mt-2 space-y-1" aria-label="地图列表视图">
      {view.listFallback.map(location => <div key={location.locationKey} className="rounded bg-bg-base px-2 py-1 text-xs">
        <span className="flex items-center justify-between gap-2"><strong>{location.current ? `当前位置 · ${location.title}` : location.title}</strong><small className="text-text-muted">{KNOWLEDGE_LABELS[location.knowledge]}</small></span>
        {location.description && <p className="mt-1 text-text-muted">{location.description}</p>}
        {location.earlyArrivalDescription && <p className="mt-1 text-text-muted">当前可见：{location.earlyArrivalDescription}</p>}
      </div>)}
    </div>
    <div className="mt-2 space-y-1" aria-label="已知道路列表">
      {view.edges.map(edge => <p key={edge.edgeKey} className="text-[10px] text-text-muted">{nodeByKey.get(edge.fromLocationKey)!.title} → {nodeByKey.get(edge.toLocationKey)!.title} · {edge.travelMinutes}分钟 · {RISK_LABELS[edge.riskProfile]} · {edge.open ? '可通行' : '未开放'}</p>)}
      {!view.edges.length && <p className="text-xs text-text-muted">尚未发现可显示的道路。</p>}
    </div>
  </article>
}
