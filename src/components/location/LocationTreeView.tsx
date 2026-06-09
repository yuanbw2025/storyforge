/**
 * 地点树状图可视化（D3 + SVG）
 */
import { useMemo, useRef, useEffect, useState } from 'react'
import { stratify, tree } from 'd3-hierarchy'
import type { LocationTreeNode } from '../../stores/location'
import { TAG_EMOJI, type LocationTag } from '../../lib/types/location'

interface FlatNode {
  id: number
  parentId: number | null
  name: string
  tags: LocationTag[]
}

/** 根据第一个标签选颜色 */
function getNodeColor(tags: LocationTag[]): string {
  if (tags.length === 0) return '#94a3b8'
  const tag = tags[0]
  // 自然地形色系
  const terrainColors: Record<string, string> = {
    '大陆': '#f59e0b', '高原': '#a78bfa', '山脉': '#8b5cf6', '山峰': '#8b5cf6',
    '海洋': '#3b82f6', '湖泊': '#06b6d4', '河流': '#06b6d4', '森林': '#22c55e',
    '沙漠': '#f97316', '冰原': '#93c5fd', '草原': '#4ade80', '火山': '#ef4444',
    '岛屿': '#14b8a6', '洞穴': '#6b7280', '浮空岛': '#c084fc', '虚空': '#6366f1',
  }
  // 人文场所色系
  const placeColors: Record<string, string> = {
    '城市': '#f59e0b', '都城': '#eab308', '村庄': '#84cc16', '城镇': '#a3e635',
    '宗门': '#ec4899', '要塞': '#ef4444', '战场': '#dc2626', '神殿': '#c084fc',
    '秘境': '#a78bfa', '集市': '#f97316', '港口': '#06b6d4', '遗迹': '#94a3b8',
  }
  return terrainColors[tag] || placeColors[tag] || '#94a3b8'
}

function getNodeEmoji(tags: LocationTag[]): string {
  if (tags.length === 0) return '📍'
  return TAG_EMOJI[tags[0]] || '📍'
}

interface Props {
  tree: LocationTreeNode[]
  onSelect?: (id: number) => void
}

export default function LocationTreeView({ tree: treeData, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgSize, setSvgSize] = useState({ width: 700, height: 400 })

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setSvgSize({ width: Math.floor(w), height: Math.max(350, Math.floor(w * 0.55)) })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // 扁平化树
  const flatNodes = useMemo(() => {
    const result: FlatNode[] = []
    const walk = (nodes: LocationTreeNode[]) => {
      for (const n of nodes) {
        let tags: LocationTag[] = []
        try { tags = JSON.parse(n.tags || '[]') } catch { /* empty */ }
        result.push({ id: n.id!, parentId: n.parentId, name: n.name, tags })
        if (n.children.length > 0) walk(n.children)
      }
    }
    walk(treeData)
    return result
  }, [treeData])

  const treeLayout = useMemo(() => {
    if (flatNodes.length === 0) return null

    const allNodes: FlatNode[] = [
      { id: -1, parentId: null, name: '世界', tags: [] },
      ...flatNodes.map(n => ({
        ...n,
        parentId: n.parentId ?? -1,
      })),
    ]

    try {
      const root = stratify<FlatNode>()
        .id(d => String(d.id))
        .parentId(d => d.parentId != null ? String(d.parentId) : null)(allNodes)

      const { width, height } = svgSize
      const margin = { top: 40, right: 20, bottom: 40, left: 20 }
      const innerW = width - margin.left - margin.right
      const innerH = height - margin.top - margin.bottom

      const layout = tree<FlatNode>().size([innerW, innerH])
      return { root: layout(root), margin }
    } catch {
      return null
    }
  }, [flatNodes, svgSize])

  if (flatNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-text-muted text-sm">
        暂无地点数据，请添加地点
      </div>
    )
  }

  if (!treeLayout) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-text-muted text-sm">
        地点层级结构有误，请检查父级关系
      </div>
    )
  }

  const { root, margin } = treeLayout
  const { width, height } = svgSize

  return (
    <div ref={containerRef} className="rounded-lg overflow-hidden border border-border bg-bg-base">
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* 连接线 */}
          {root.links().map((link, i) => {
            const s = link.source
            const t = link.target
            return (
              <line
                key={i}
                x1={s.x} y1={s.y}
                x2={t.x} y2={t.y}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={1.5}
              />
            )
          })}

          {/* 节点 */}
          {root.descendants().map((node, i) => {
            const d = node.data
            if (d.id === -1) return null
            const color = getNodeColor(d.tags)
            const emoji = getNodeEmoji(d.tags)

            return (
              <g
                key={i}
                transform={`translate(${node.x},${node.y})`}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onClick={() => onSelect?.(d.id)}
              >
                <circle r={16} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.5} />
                <text y={1} textAnchor="middle" dominantBaseline="middle" fontSize={14} fill={color}>
                  {emoji}
                </text>
                <text y={28} textAnchor="middle" fontSize={11}
                  fill="rgba(255,255,255,0.75)" fontFamily="PingFang SC, Microsoft YaHei, sans-serif">
                  {d.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
