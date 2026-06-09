/**
 * 世界关系流向图 — Phase 25.5.4
 * 自适应布局（智能默认 + 手动切换），纯 SVG，不引第三方库。
 *
 * 4 种布局模板：
 *   - flow     横向流程线（诸天流/快穿）
 *   - radial   中心辐射（无限流：主世界居中）
 *   - ladder   纵向阶梯（修仙多界：飞升向上）
 *   - tree     树状分支（平行世界）
 */
import { useState, useMemo } from 'react'
import { useWorldGroupStore } from '../../stores/world-group'
import { WORLD_LINK_TYPE_LABELS } from '../../lib/types/world-group'
import type { WorldGroup, WorldGroupLink, WorldGroupLinkType } from '../../lib/types'

type LayoutMode = 'flow' | 'radial' | 'ladder' | 'tree'

const LAYOUT_LABELS: Record<LayoutMode, string> = {
  flow: '横向流程',
  radial: '中心辐射',
  ladder: '纵向阶梯',
  tree: '树状分支',
}

/** 连线颜色/样式（按关系类型区分） */
const LINK_STYLE: Record<WorldGroupLinkType, { color: string; dash?: string }> = {
  portal: { color: '#3b82f6' },              // 传送门 实线蓝
  ascension: { color: '#a855f7', dash: '5 4' }, // 飞升 紫虚线
  summon: { color: '#f59e0b' },              // 召唤 橙
  branch: { color: '#10b981', dash: '2 3' }, // 分支 绿点线
  return: { color: '#6b7280', dash: '6 3' }, // 回归 灰虚线
  custom: { color: '#9ca3af' },              // 自定义 灰
}

const W = 680
const H = 360
const NODE_R = 30

interface Pos { x: number; y: number }

/** 智能默认布局：依据世界类型猜测 */
function smartDefault(groups: WorldGroup[]): LayoutMode {
  if (groups.some(g => g.type === 'instance')) return 'radial'      // 有副本 → 无限流
  const ascensionCount = groups.filter(g => g.type === 'ascension').length
  if (ascensionCount >= 2) return 'ladder'                          // 多上界 → 修仙多界
  if (groups.some(g => g.type === 'parallel')) return 'tree'        // 平行世界 → 树状
  return 'flow'                                                     // 默认横向流程
}

/** 各布局的节点定位 */
function computePositions(groups: WorldGroup[], mode: LayoutMode): Map<number, Pos> {
  const pos = new Map<number, Pos>()
  const n = groups.length
  if (n === 0) return pos

  if (mode === 'flow') {
    const gap = (W - 2 * NODE_R - 40) / Math.max(1, n - 1)
    groups.forEach((g, i) => pos.set(g.id!, { x: NODE_R + 20 + i * gap, y: H / 2 }))
  } else if (mode === 'radial') {
    // 主世界居中，其余沿圆周
    const primary = groups.find(g => g.type === 'primary') || groups[0]
    const others = groups.filter(g => g.id !== primary.id)
    pos.set(primary.id!, { x: W / 2, y: H / 2 })
    const radius = Math.min(W, H) / 2 - NODE_R - 30
    others.forEach((g, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, others.length) - Math.PI / 2
      pos.set(g.id!, { x: W / 2 + radius * Math.cos(angle), y: H / 2 + radius * Math.sin(angle) })
    })
  } else if (mode === 'ladder') {
    // 按 order 分层，从下往上（飞升向上）
    const sorted = [...groups].sort((a, b) => a.order - b.order)
    const gap = (H - 2 * NODE_R - 40) / Math.max(1, n - 1)
    sorted.forEach((g, i) => pos.set(g.id!, { x: W / 2, y: H - NODE_R - 20 - i * gap }))
  } else {
    // tree：第一个为根，其余均分到下一行
    const root = groups.find(g => g.type === 'primary') || groups[0]
    const children = groups.filter(g => g.id !== root.id)
    pos.set(root.id!, { x: W / 2, y: NODE_R + 30 })
    const gap = W / Math.max(1, children.length + 1)
    children.forEach((g, i) => pos.set(g.id!, { x: gap * (i + 1), y: H - NODE_R - 40 }))
  }
  return pos
}

interface Props {
  /** 点击节点（如跳转编辑） */
  onNodeClick?: (group: WorldGroup) => void
}

export default function WorldRelationGraph({ onNodeClick }: Props) {
  const { groups, links } = useWorldGroupStore()
  const [mode, setMode] = useState<LayoutMode | null>(null)

  const effectiveMode: LayoutMode = mode ?? smartDefault(groups)
  const positions = useMemo(() => computePositions(groups, effectiveMode), [groups, effectiveMode])

  if (groups.length < 2) return null

  return (
    <div className="space-y-2">
      {/* 布局切换 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-muted">布局</span>
        {(Object.keys(LAYOUT_LABELS) as LayoutMode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
              effectiveMode === m
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
            }`}
          >
            {LAYOUT_LABELS[m]}
          </button>
        ))}
      </div>

      {/* 画布 */}
      <div className="border border-border rounded-lg bg-bg-surface overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}>
          <defs>
            {Object.entries(LINK_STYLE).map(([type, s]) => (
              <marker
                key={type}
                id={`arrow-${type}`}
                viewBox="0 0 10 10"
                refX="9" refY="5"
                markerWidth="7" markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
              </marker>
            ))}
          </defs>

          {/* 连线 */}
          {links.map((l: WorldGroupLink) => {
            const from = positions.get(l.fromGroupId)
            const to = positions.get(l.toGroupId)
            if (!from || !to) return null
            const style = LINK_STYLE[l.linkType] || LINK_STYLE.custom
            // 缩短到节点边缘
            const dx = to.x - from.x, dy = to.y - from.y
            const dist = Math.hypot(dx, dy) || 1
            const ux = dx / dist, uy = dy / dist
            const x1 = from.x + ux * NODE_R, y1 = from.y + uy * NODE_R
            const x2 = to.x - ux * (NODE_R + 4), y2 = to.y - uy * (NODE_R + 4)
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
            return (
              <g key={l.id}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={style.color}
                  strokeWidth={1.5}
                  strokeDasharray={style.dash}
                  markerEnd={`url(#arrow-${l.linkType})`}
                />
                <text x={mx} y={my - 4} textAnchor="middle" className="fill-text-muted" style={{ fontSize: 9 }}>
                  {l.name || WORLD_LINK_TYPE_LABELS[l.linkType]}
                </text>
              </g>
            )
          })}

          {/* 节点 */}
          {groups.map((g: WorldGroup) => {
            const p = positions.get(g.id!)
            if (!p) return null
            return (
              <g
                key={g.id}
                transform={`translate(${p.x}, ${p.y})`}
                style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
                onClick={() => onNodeClick?.(g)}
              >
                <circle
                  r={NODE_R}
                  fill={g.color || '#1f2937'}
                  fillOpacity={0.15}
                  stroke={g.color || '#6b7280'}
                  strokeWidth={1.5}
                />
                <text textAnchor="middle" dy="-2" style={{ fontSize: 18 }}>{g.icon || '🌐'}</text>
                <text textAnchor="middle" dy="16" className="fill-text-primary" style={{ fontSize: 10 }}>
                  {g.name.length > 6 ? g.name.slice(0, 6) + '…' : g.name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
