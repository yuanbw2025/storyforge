import { useRef, useEffect, useCallback, useMemo, type ComponentRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

type ForceGraphHandle = ComponentRef<typeof ForceGraph2D>
import { useCharacterRelationStore } from '../../stores/character-relation'
import { useCharacterStore } from '../../stores/character'

// 关系类型对应颜色
const RELATION_COLORS: Record<string, string> = {
  family:     '#f59e0b',
  lover:      '#ec4899',
  friend:     '#22c55e',
  rival:      '#f97316',
  enemy:      '#ef4444',
  master:     '#a78bfa',
  student:    '#60a5fa',
  ally:       '#14b8a6',
  subordinate:'#94a3b8',
  other:      '#6b7280',
}

const RELATION_LABELS: Record<string, string> = {
  family:'亲属', lover:'恋人', friend:'朋友', rival:'对手',
  enemy:'敌人', master:'师父', student:'弟子', ally:'盟友',
  subordinate:'上下级', other:'其他',
}

interface GraphNode { id: string; name: string; role: string; color: string }
interface GraphLink { source: string; target: string; type: string; bidirectional: boolean; label: string; color: string }

// react-force-graph-2d 在运行时会把 GraphNode / GraphLink 附加上 x/y 坐标属性
type PositionedNode = GraphNode & { x: number; y: number }
type PositionedLink = GraphLink & {
  source: PositionedNode
  target: PositionedNode
}

const ROLE_COLORS: Record<string, string> = {
  protagonist: '#6366f1',
  antagonist:  '#ef4444',
  supporting:  '#22c55e',
  minor:       '#94a3b8',
}

interface Props {
  width?: number
  height?: number
}

export default function RelationGraph({ width = 700, height = 480 }: Props) {
  const graphRef = useRef<ForceGraphHandle | undefined>(undefined)
  const { characters } = useCharacterStore()
  const { relations } = useCharacterRelationStore()

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = characters.map(c => ({
      id: String(c.id),
      name: c.name,
      role: c.role,
      color: ROLE_COLORS[c.role] ?? '#94a3b8',
    }))

    const links: GraphLink[] = relations.map(r => ({
      source: String(r.fromCharacterId),
      target: String(r.toCharacterId),
      type: r.relationType,
      bidirectional: r.isBidirectional,
      label: r.label ?? RELATION_LABELS[r.relationType] ?? r.relationType,
      color: RELATION_COLORS[r.relationType] ?? '#6b7280',
    }))

    return { nodes, links }
  }, [characters, relations])

  // 初始化时居中
  useEffect(() => {
    if (graphRef.current) {
      setTimeout(() => graphRef.current?.zoomToFit(400, 40), 300)
    }
  }, [graphData.nodes.length])

  const drawNode = useCallback((rawNode: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const node = rawNode as PositionedNode
    const label = node.name
    const fontSize = Math.max(10, 14 / globalScale)
    const r = Math.max(6, 18 / globalScale)

    // 圆形节点
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = node.color as string
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.lineWidth = 1 / globalScale
    ctx.stroke()

    // 标签
    ctx.font = `${fontSize}px PingFang SC, Microsoft YaHei, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, node.x, node.y + r + fontSize * 0.8)
  }, [])

  const drawLink = useCallback((rawLink: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const link = rawLink as PositionedLink
    const start = link.source
    const end = link.target
    if (!start || !end || !start.x || !end.x) return

    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.strokeStyle = (link.color as string) + 'aa'
    ctx.lineWidth = Math.max(0.5, 1.5 / globalScale)
    ctx.stroke()

    // 链接标签
    const midX = (start.x + end.x) / 2
    const midY = (start.y + end.y) / 2
    const fontSize = Math.max(8, 10 / globalScale)
    ctx.font = `${fontSize}px PingFang SC, sans-serif`
    ctx.fillStyle = link.color + 'cc'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(link.label, midX, midY)
  }, [])

  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <p className="text-sm">暂无角色数据，请先在「角色」模块添加角色</p>
      </div>
    )
  }

  if (relations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <p className="text-sm">暂无关系数据，请在下方添加角色关系</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border bg-bg-base">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor="#0a0a0f"
        nodeCanvasObject={drawNode}
        nodeCanvasObjectMode={() => 'replace'}
        linkCanvasObject={drawLink}
        linkCanvasObjectMode={() => 'replace'}
        linkDirectionalArrowLength={(link: object) => ((link as GraphLink).bidirectional ? 0 : Math.max(3, 6))}
        linkDirectionalArrowRelPos={0.85}
        cooldownTicks={100}
        onEngineStop={() => graphRef.current?.zoomToFit(400, 40)}
        enableNodeDrag
        enableZoomInteraction
      />

      {/* 图例 */}
      <div className="p-3 border-t border-border flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(RELATION_COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1 text-xs text-text-muted">
            <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: color }} />
            {RELATION_LABELS[key]}
          </div>
        ))}
      </div>
    </div>
  )
}
