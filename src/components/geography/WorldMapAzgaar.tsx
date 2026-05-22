/**
 * WorldMapAzgaar — 嵌入 Azgaar Fantasy Map Generator 的地图组件
 * 通过同源 iframe 加载自托管的 FMG，支持双向数据同步
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import {
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Check,
  Globe,
} from 'lucide-react'
import { AzgaarBridge } from '../../lib/world-map/azgaar-bridge'
import type { WorldMapData } from '../../lib/types/world-map'

interface Props {
  data: WorldMapData | null
  onSyncBack?: (markers: WorldMapData['markers']) => void
}

export default function WorldMapAzgaar({ data, onSyncBack }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<AzgaarBridge | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [mapInfo, setMapInfo] = useState<{
    states: number
    burgs: number
    rivers: number
  } | null>(null)

  // 轮询等待 FMG 就绪（iframe 加载 + FMG 生成完成）
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = () => {
      const iframe = iframeRef.current
      if (!iframe || cancelled) return

      try {
        const win = iframe.contentWindow as any
        if (win?.pack?.cells && win?.pack?.states) {
          // FMG 就绪
          const bridge = new AzgaarBridge()
          bridge.attachDirect(iframe)
          bridgeRef.current = bridge

          if (!cancelled) {
            setStatus('ready')
            setMapInfo({
              states: bridge.getStates().length,
              burgs: bridge.getBurgs().length,
              rivers: bridge.getRivers().length,
            })
          }

          // 确保图层绘制
          const drawFns = [
            'drawRivers', 'drawReliefIcons', 'drawStates', 'drawBorders',
            'drawRoutes', 'drawLabels', 'drawBurgIcons', 'drawMarkers',
            'drawBiomes', 'drawIce',
          ]
          for (const fn of drawFns) {
            try { if (typeof win[fn] === 'function') win[fn]() } catch { /* skip */ }
          }
          try { win.drawFeatures?.() } catch { /* 忽略 */ }
          return
        }
      } catch { /* iframe 未就绪 */ }

      // 继续轮询（最多 60 秒）
      timer = setTimeout(poll, 500)
    }

    // 延迟 2 秒开始轮询（给 iframe 加载时间）
    timer = setTimeout(poll, 2000)

    return () => {
      cancelled = true
      clearTimeout(timer)
      bridgeRef.current?.detach()
      bridgeRef.current = null
    }
  }, [])

  // 同步 StoryForge 数据到 FMG
  const handleSyncToFMG = useCallback(() => {
    const bridge = bridgeRef.current
    if (!bridge?.isReady || !data) return

    const result = bridge.syncFromWorldMapData(data)
    const msg = `已同步：${result.statesRenamed} 个势力、${result.burgsRenamed} 个城镇、${result.riversRenamed} 条河流`
    setSyncResult(msg)

    setMapInfo({
      states: bridge.getStates().length,
      burgs: bridge.getBurgs().length,
      rivers: bridge.getRivers().length,
    })

    setTimeout(() => setSyncResult(null), 3000)
  }, [data])

  // 从 FMG 反向同步标记点
  const handleSyncBack = useCallback(() => {
    const bridge = bridgeRef.current
    if (!bridge?.isReady || !onSyncBack) return

    const markers = bridge.extractMarkers()
    onSyncBack(markers)
    setSyncResult(`已从 FMG 导入 ${markers.length} 个标记点`)
    setTimeout(() => setSyncResult(null), 3000)
  }, [onSyncBack])

  // 用新 seed 重新生成
  const handleRegenerate = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const win = iframe.contentWindow as any
    if (typeof win?.generate !== 'function') return

    setStatus('loading')
    setMapInfo(null)

    win.generate().then(() => {
      // 绘制图层
      const drawFns = [
        'drawRivers', 'drawReliefIcons', 'drawStates', 'drawBorders',
        'drawRoutes', 'drawLabels', 'drawBurgIcons', 'drawMarkers',
        'drawBiomes', 'drawIce',
      ]
      for (const fn of drawFns) {
        try { if (typeof win[fn] === 'function') win[fn]() } catch { /* skip */ }
      }
      try { win.drawFeatures?.() } catch { /* 忽略 */ }

      // 更新桥接器
      const bridge = new AzgaarBridge()
      bridge.attachDirect(iframe)
      bridgeRef.current = bridge

      setStatus('ready')
      setMapInfo({
        states: bridge.getStates().length,
        burgs: bridge.getBurgs().length,
        rivers: bridge.getRivers().length,
      })
    }).catch(() => {
      setStatus('error')
    })
  }, [])

  return (
    <div className="relative w-full h-full min-h-[500px] rounded-lg border border-border overflow-hidden flex flex-col">
      {/* 工具条 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-elevated border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Globe className="w-3.5 h-3.5" />
          <span>Azgaar Fantasy Map Generator</span>
          {status === 'loading' && (
            <span className="flex items-center gap-1 text-amber-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              加载中...
            </span>
          )}
          {status === 'ready' && mapInfo && (
            <span className="text-emerald-400">
              ✓ {mapInfo.states} 势力 · {mapInfo.burgs} 城镇 · {mapInfo.rivers} 河流
            </span>
          )}
          {status === 'error' && (
            <span className="text-red-400">加载失败</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {syncResult && (
            <span className="text-xs text-emerald-400 flex items-center gap-1 mr-2">
              <Check className="w-3 h-3" />
              {syncResult}
            </span>
          )}

          {data && (
            <button
              onClick={handleSyncToFMG}
              disabled={status !== 'ready'}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40 transition-colors"
              title="将 AI 生成的世界数据（势力名、城市名、河流名）写入当前地图"
            >
              <ArrowDownToLine className="w-3 h-3" />
              同步名称到地图
            </button>
          )}

          {onSyncBack && (
            <button
              onClick={handleSyncBack}
              disabled={status !== 'ready'}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-bg-base text-text-secondary hover:bg-bg-base/80 disabled:opacity-40 transition-colors"
              title="从 FMG 地图中提取城镇数据回 StoryForge"
            >
              <ArrowUpFromLine className="w-3 h-3" />
              导入标记点
            </button>
          )}

          <button
            onClick={handleRegenerate}
            disabled={status !== 'ready'}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-bg-base text-text-secondary hover:bg-bg-base/80 disabled:opacity-40 transition-colors"
            title="用新的随机种子重新生成地图"
          >
            <RefreshCw className="w-3 h-3" />
            换一张
          </button>
        </div>
      </div>

      {/* FMG iframe */}
      <div className="flex-1 relative">
        <iframe
          ref={iframeRef}
          src={`${import.meta.env.BASE_URL}fmg/index.html`}
          /* 同源自托管，不需要 sandbox 限制 */
          className="w-full h-full border-0"
          title="Fantasy Map Generator"
        />

        {/* 加载遮罩 */}
        {status === 'loading' && (
          <div className="absolute inset-0 bg-bg-base/80 flex items-center justify-center z-10 pointer-events-none">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto mb-3" />
              <p className="text-sm text-text-muted">正在加载 Fantasy Map Generator...</p>
              <p className="text-xs text-text-muted mt-1">首次加载需要 10-15 秒</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
