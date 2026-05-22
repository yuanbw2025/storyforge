/**
 * WorldMapCanvas — Canvas 渲染 + 交互包装组件
 * 负责：挂载 <canvas>、调用 renderer、绑定交互事件
 * 支持：滚轮缩放 + 拖拽平移 + 标记选中/拖动
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import type { WorldMapData, MapMarker } from '../../lib/types/world-map'
import { renderWorldMap, type RenderOptions } from '../../lib/world-map/renderer'
import {
  bindCanvasInteraction,
  createInteractionState,
  createViewport,
  clampViewport,
  type Viewport,
} from '../../lib/world-map/interaction'

interface Props {
  data: WorldMapData
  selectedMarkerId: string | null
  onSelectMarker: (marker: MapMarker | null) => void
  onMarkerDragEnd: (markerId: string, x: number, y: number) => void
  onDoubleClickEmpty: (x: number, y: number) => void
}

export default function WorldMapCanvas({
  data,
  selectedMarkerId,
  onSelectMarker,
  onMarkerDragEnd,
  onDoubleClickEmpty,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(createInteractionState())
  const viewportRef = useRef(createViewport())
  const dataRef = useRef(data)
  const [scalePercent, setScalePercent] = useState(100)

  // 保持 dataRef 最新
  useEffect(() => {
    dataRef.current = data
  }, [data])

  // 同步选中状态
  useEffect(() => {
    stateRef.current.selectedMarkerId = selectedMarkerId
    doRender()
  }, [selectedMarkerId])

  // 渲染函数：应用 viewport 变换
  const doRender = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const vp = viewportRef.current
    const dpr = window.devicePixelRatio || 1

    // 设置 canvas 分辨率匹配容器
    const container = containerRef.current
    if (container) {
      const w = container.clientWidth
      const h = container.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
        canvas.style.width = w + 'px'
        canvas.style.height = h + 'px'
      }
    }

    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 应用 viewport 变换：dpr 缩放 → viewport 缩放 → viewport 偏移
    ctx.scale(dpr, dpr)
    ctx.scale(vp.scale, vp.scale)
    ctx.translate(-vp.offsetX, -vp.offsetY)

    const opts: RenderOptions = {
      selectedMarkerId: stateRef.current.selectedMarkerId,
      hoveredMarkerId: stateRef.current.hoveredMarkerId,
    }
    renderWorldMap(ctx, dataRef.current, opts)
    ctx.restore()
  }, [])

  // 初次渲染 + data 变化时重新渲染
  useEffect(() => {
    // 初始化 viewport：让地图适配容器
    const container = containerRef.current
    if (container && data) {
      const cw = container.clientWidth
      const ch = container.clientHeight
      const fitScale = Math.min(cw / data.width, ch / data.height, 1)
      const vp = clampViewport(
        { scale: fitScale, offsetX: 0, offsetY: 0 },
        data.width, data.height, cw, ch,
      )
      viewportRef.current = vp
      setScalePercent(Math.round(vp.scale * 100))
    }
    doRender()
  }, [data, doRender])

  // 窗口 resize 时重新渲染
  useEffect(() => {
    const onResize = () => {
      const container = containerRef.current
      if (container && dataRef.current) {
        const vp = clampViewport(
          viewportRef.current,
          dataRef.current.width, dataRef.current.height,
          container.clientWidth, container.clientHeight,
        )
        viewportRef.current = vp
      }
      doRender()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [doRender])

  // 绑定交互事件
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const unbind = bindCanvasInteraction(
      canvas,
      () => dataRef.current,
      stateRef.current,
      viewportRef.current,
      {
        onSelect: (marker) => {
          onSelectMarker(marker)
        },
        onHover: () => {},
        onDragEnd: (markerId, newX, newY) => {
          onMarkerDragEnd(markerId, newX, newY)
        },
        onDoubleClick: (x, y) => {
          onDoubleClickEmpty(x, y)
        },
        onRequestRender: doRender,
        onViewportChange: (vp: Viewport) => {
          setScalePercent(Math.round(vp.scale * 100))
        },
      },
    )

    return unbind
  }, [doRender, onSelectMarker, onMarkerDragEnd, onDoubleClickEmpty])

  // 缩放控制按钮
  const handleZoom = useCallback((delta: number) => {
    const data = dataRef.current
    const container = containerRef.current
    if (!data || !container) return
    const vp = viewportRef.current
    const cw = container.clientWidth
    const ch = container.clientHeight

    // 以画面中心为缩放中心
    const centerWorldX = vp.offsetX + cw / (2 * vp.scale)
    const centerWorldY = vp.offsetY + ch / (2 * vp.scale)

    const newScale = Math.max(0.3, Math.min(5, vp.scale * (delta > 0 ? 1.3 : 1 / 1.3)))
    const newOffsetX = centerWorldX - cw / (2 * newScale)
    const newOffsetY = centerWorldY - ch / (2 * newScale)

    const clamped = clampViewport(
      { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY },
      data.width, data.height, cw, ch,
    )
    viewportRef.current = clamped
    setScalePercent(Math.round(clamped.scale * 100))
    doRender()
  }, [doRender])

  const handleFitView = useCallback(() => {
    const data = dataRef.current
    const container = containerRef.current
    if (!data || !container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const fitScale = Math.min(cw / data.width, ch / data.height, 1)
    const vp = clampViewport(
      { scale: fitScale, offsetX: 0, offsetY: 0 },
      data.width, data.height, cw, ch,
    )
    viewportRef.current = vp
    setScalePercent(Math.round(vp.scale * 100))
    doRender()
  }, [doRender])

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px] rounded-lg border border-border bg-[#1a1810] overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        style={{ imageRendering: 'auto' }}
      />

      {/* 缩放控制 */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-bg-base/90 rounded-lg border border-border px-1.5 py-1 shadow-sm">
        <button onClick={() => handleZoom(-1)} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary text-sm rounded hover:bg-bg-hover" title="缩小">−</button>
        <button onClick={handleFitView} className="px-1.5 text-[10px] text-text-muted hover:text-text-primary rounded hover:bg-bg-hover min-w-[36px] text-center" title="适配视图">{scalePercent}%</button>
        <button onClick={() => handleZoom(1)} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary text-sm rounded hover:bg-bg-hover" title="放大">+</button>
      </div>

      {/* 底部提示 */}
      <div className="absolute bottom-3 left-3 flex gap-2 text-[10px] text-text-muted bg-bg-base/80 rounded px-2 py-1">
        <span>🖱️ 滚轮缩放</span>
        <span>✋ 拖拽平移</span>
        <span>📍 拖拽移动标记</span>
        <span>👆 双击添加</span>
      </div>
    </div>
  )
}
