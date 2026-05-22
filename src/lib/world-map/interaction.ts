/**
 * 世界地图交互逻辑
 * 处理缩放、平移、拖拽、点击、悬停等 Canvas 交互事件
 */

import type { WorldMapData, MapMarker } from '../types/world-map'
import { hitTestMarker } from './renderer'

// ── Viewport（视口变换） ────────────────────────────────────

export interface Viewport {
  /** 缩放倍数（1 = 100%） */
  scale: number
  /** 画布左上角在世界坐标中的偏移 */
  offsetX: number
  offsetY: number
}

export function createViewport(): Viewport {
  return { scale: 1, offsetX: 0, offsetY: 0 }
}

/** 限制 viewport 不超出地图边界 */
export function clampViewport(vp: Viewport, mapW: number, mapH: number, canvasW: number, canvasH: number): Viewport {
  const s = vp.scale
  const visibleW = canvasW / s
  const visibleH = canvasH / s

  let ox = vp.offsetX
  let oy = vp.offsetY

  // 如果地图比可视区小，居中
  if (mapW * s <= canvasW) {
    ox = -(canvasW / s - mapW) / 2
  } else {
    ox = Math.max(0, Math.min(ox, mapW - visibleW))
  }

  if (mapH * s <= canvasH) {
    oy = -(canvasH / s - mapH) / 2
  } else {
    oy = Math.max(0, Math.min(oy, mapH - visibleH))
  }

  return { scale: s, offsetX: ox, offsetY: oy }
}

/** 屏幕坐标 → 世界坐标 */
export function screenToWorld(
  screenX: number, screenY: number,
  viewport: Viewport,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const cssX = screenX - rect.left
  const cssY = screenY - rect.top
  // CSS 像素 → 世界坐标
  const worldX = cssX / viewport.scale + viewport.offsetX
  const worldY = cssY / viewport.scale + viewport.offsetY
  return { x: worldX, y: worldY }
}

// ── 交互状态 ────────────────────────────────────────────────

export interface InteractionState {
  selectedMarkerId: string | null
  hoveredMarkerId: string | null
  isDragging: boolean
  dragStartX: number
  dragStartY: number
  /** 正在平移地图（中键或空格+左键 或 空白区域左键拖拽） */
  isPanning: boolean
  panStartX: number
  panStartY: number
  panStartOffsetX: number
  panStartOffsetY: number
}

export function createInteractionState(): InteractionState {
  return {
    selectedMarkerId: null,
    hoveredMarkerId: null,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    panStartOffsetX: 0,
    panStartOffsetY: 0,
  }
}

// ── 回调接口 ────────────────────────────────────────────────

export interface InteractionCallbacks {
  onSelect: (marker: MapMarker | null) => void
  onHover: (markerId: string | null) => void
  onDragEnd: (markerId: string, newX: number, newY: number) => void
  onDoubleClick: (x: number, y: number) => void
  onRequestRender: () => void
  onViewportChange: (vp: Viewport) => void
}

// ── 事件绑定 ────────────────────────────────────────────────

const MIN_SCALE = 0.3
const MAX_SCALE = 5

/**
 * 绑定 Canvas 交互事件，返回解绑函数
 */
export function bindCanvasInteraction(
  canvas: HTMLCanvasElement,
  getData: () => WorldMapData | null,
  state: InteractionState,
  viewport: Viewport,
  callbacks: InteractionCallbacks,
): () => void {
  let draggedMarker: MapMarker | null = null
  /** 拖拽阈值：移动超过 4px 才算拖拽（区分点击和拖拽） */
  const DRAG_THRESHOLD = 4

  const onMouseDown = (e: MouseEvent) => {
    const data = getData()
    if (!data) return
    const { x, y } = screenToWorld(e.clientX, e.clientY, viewport, canvas)

    // 中键平移
    if (e.button === 1) {
      e.preventDefault()
      state.isPanning = true
      state.panStartX = e.clientX
      state.panStartY = e.clientY
      state.panStartOffsetX = viewport.offsetX
      state.panStartOffsetY = viewport.offsetY
      canvas.style.cursor = 'grabbing'
      return
    }

    if (e.button !== 0) return

    const hit = hitTestMarker(data, x, y, 16 / viewport.scale)

    if (hit) {
      state.selectedMarkerId = hit.id
      state.isDragging = true
      state.dragStartX = e.clientX
      state.dragStartY = e.clientY
      draggedMarker = hit
      canvas.style.cursor = 'grabbing'
      callbacks.onSelect(hit)
      callbacks.onRequestRender()
    } else {
      // 空白区域：开始平移
      state.selectedMarkerId = null
      callbacks.onSelect(null)
      state.isPanning = true
      state.panStartX = e.clientX
      state.panStartY = e.clientY
      state.panStartOffsetX = viewport.offsetX
      state.panStartOffsetY = viewport.offsetY
      canvas.style.cursor = 'grabbing'
      callbacks.onRequestRender()
    }
  }

  const onMouseMove = (e: MouseEvent) => {
    const data = getData()
    if (!data) return

    // 平移地图
    if (state.isPanning) {
      const dx = (e.clientX - state.panStartX) / viewport.scale
      const dy = (e.clientY - state.panStartY) / viewport.scale
      const clamped = clampViewport(
        { scale: viewport.scale, offsetX: state.panStartOffsetX - dx, offsetY: state.panStartOffsetY - dy },
        data.width, data.height, canvas.clientWidth, canvas.clientHeight,
      )
      viewport.offsetX = clamped.offsetX
      viewport.offsetY = clamped.offsetY
      callbacks.onViewportChange({ ...viewport })
      callbacks.onRequestRender()
      return
    }

    if (state.isDragging && draggedMarker) {
      // 检测是否超过拖拽阈值
      const ddx = e.clientX - state.dragStartX
      const ddy = e.clientY - state.dragStartY
      if (Math.abs(ddx) < DRAG_THRESHOLD && Math.abs(ddy) < DRAG_THRESHOLD) return

      const { x, y } = screenToWorld(e.clientX, e.clientY, viewport, canvas)
      const marker = data.markers.find(m => m.id === draggedMarker!.id)
      if (marker) {
        marker.x = Math.max(20, Math.min(data.width - 20, x))
        marker.y = Math.max(20, Math.min(data.height - 20, y))
        callbacks.onRequestRender()
      }
    } else {
      // 悬停检测
      const { x, y } = screenToWorld(e.clientX, e.clientY, viewport, canvas)
      const hit = hitTestMarker(data, x, y, 16 / viewport.scale)
      const newHoverId = hit?.id || null
      if (newHoverId !== state.hoveredMarkerId) {
        state.hoveredMarkerId = newHoverId
        canvas.style.cursor = newHoverId ? 'pointer' : 'default'
        callbacks.onHover(newHoverId)
        callbacks.onRequestRender()
      }
    }
  }

  const onMouseUp = (e: MouseEvent) => {
    if (state.isPanning) {
      state.isPanning = false
      canvas.style.cursor = state.hoveredMarkerId ? 'pointer' : 'default'
      return
    }

    if (state.isDragging && draggedMarker) {
      const data = getData()
      if (data) {
        const { x, y } = screenToWorld(e.clientX, e.clientY, viewport, canvas)
        callbacks.onDragEnd(
          draggedMarker.id,
          Math.max(20, Math.min(data.width - 20, x)),
          Math.max(20, Math.min(data.height - 20, y)),
        )
      }
    }
    state.isDragging = false
    draggedMarker = null
    canvas.style.cursor = state.hoveredMarkerId ? 'pointer' : 'default'
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const data = getData()
    if (!data) return

    // 以鼠标位置为中心缩放
    const { x: worldX, y: worldY } = screenToWorld(e.clientX, e.clientY, viewport, canvas)
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * zoomFactor))

    if (newScale === viewport.scale) return

    // 保持鼠标指向的世界坐标不变
    const rect = canvas.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const newOffsetX = worldX - cssX / newScale
    const newOffsetY = worldY - cssY / newScale

    const clamped = clampViewport(
      { scale: newScale, offsetX: newOffsetX, offsetY: newOffsetY },
      data.width, data.height, canvas.clientWidth, canvas.clientHeight,
    )

    viewport.scale = clamped.scale
    viewport.offsetX = clamped.offsetX
    viewport.offsetY = clamped.offsetY
    callbacks.onViewportChange({ ...viewport })
    callbacks.onRequestRender()
  }

  const onDblClick = (e: MouseEvent) => {
    const data = getData()
    if (!data) return
    const { x, y } = screenToWorld(e.clientX, e.clientY, viewport, canvas)
    const hit = hitTestMarker(data, x, y, 16 / viewport.scale)
    if (!hit) {
      callbacks.onDoubleClick(x, y)
    }
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
  }

  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('mousemove', onMouseMove)
  canvas.addEventListener('mouseup', onMouseUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('dblclick', onDblClick)
  canvas.addEventListener('contextmenu', onContextMenu)

  return () => {
    canvas.removeEventListener('mousedown', onMouseDown)
    canvas.removeEventListener('mousemove', onMouseMove)
    canvas.removeEventListener('mouseup', onMouseUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('dblclick', onDblClick)
    canvas.removeEventListener('contextmenu', onContextMenu)
  }
}
