/**
 * WorldMap3DCanvas — Three.js 3D 世界地图组件
 * 支持 360° 旋转、俯仰角调整、滚轮缩放、拖拽平移
 */

import { useRef, useEffect } from 'react'
import type { WorldMapData, MapMarker } from '../../lib/types/world-map'
import { WorldMap3DRenderer } from '../../lib/world-map/renderer3d'

interface Props {
  data: WorldMapData
  selectedMarkerId: string | null
  onSelectMarker: (marker: MapMarker | null) => void
}

export default function WorldMap3DCanvas({
  data,
  selectedMarkerId,
  onSelectMarker,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WorldMap3DRenderer | null>(null)

  // 初始化 3D 渲染器
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const r = new WorldMap3DRenderer(container)
    rendererRef.current = r

    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [])

  // 数据变化时重建场景
  useEffect(() => {
    const r = rendererRef.current
    if (!r || !data) return

    r.setData(data, {
      selectedMarkerId,
      onSelectMarker,
    })
  }, [data])

  // 选中状态变化
  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.updateOptions({
      selectedMarkerId,
      onSelectMarker,
    })
  }, [selectedMarkerId, onSelectMarker])

  return (
    <div className="relative w-full h-full min-h-[400px] rounded-lg border border-border overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      {/* 操作提示 */}
      <div className="absolute bottom-3 left-3 flex gap-2 text-[10px] text-text-muted bg-bg-base/80 rounded px-2 py-1">
        <span>🖱️ 左键旋转</span>
        <span>🔄 右键平移</span>
        <span>🔍 滚轮缩放</span>
        <span>📍 点击标记</span>
      </div>
    </div>
  )
}
