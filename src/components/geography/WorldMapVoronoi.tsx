/**
 * WorldMapVoronoi — Voronoi 地图引擎 Canvas 组件
 * 调用 generateMap + renderMap，支持缩放/拖拽 + 渲染配置
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, RefreshCw, Download, Info, Settings2 } from 'lucide-react'
import { generateMap, renderMap, STYLE_PRESET_LABELS } from '../../lib/world-map/engine'
import { BIOMES } from '../../lib/world-map/engine/climate'
import type {
  MapGenConfig, VoronoiMapData, MapStylePreset, LayerVisibility,
} from '../../lib/world-map/engine'

interface Props {
  config?: Partial<MapGenConfig>
  onMapGenerated?: (data: VoronoiMapData) => void
}

// ── 图层名称 ──
const LAYER_LABELS: Record<keyof LayerVisibility, string> = {
  terrain: '地形',
  coastlines: '海岸线',
  rivers: '河流',
  borders: '国界',
  provinces: '省界',
  roads: '道路',
  stateLabels: '国名',
  burgIcons: '城镇',
  burgLabels: '地名',
  scaleBar: '比例尺',
  vignette: '暗角',
}

export default function WorldMapVoronoi({ config, onMapGenerated }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)

  const [mapData, setMapData] = useState<VoronoiMapData | null>(null)
  const mapDataRef = useRef<VoronoiMapData | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const vpRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 })
  const [scalePercent, setScalePercent] = useState(100)

  const [kmPerPixel, setKmPerPixel] = useState(1)
  const kmPerPixelRef = useRef(1)

  const [showLegend, setShowLegend] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // ── 渲染配置（不影响生成，只影响画面） ──
  const [stylePreset, setStylePreset] = useState<MapStylePreset>(config?.stylePreset || 'topographic')
  const [layers, setLayers] = useState<LayerVisibility>({
    terrain: true, coastlines: true, rivers: true, borders: true,
    provinces: false, roads: true, stateLabels: true, burgIcons: true,
    burgLabels: true, scaleBar: true, vignette: true,
  })

  const stylePresetRef = useRef(stylePreset)
  const layersRef = useRef(layers)
  stylePresetRef.current = stylePreset
  layersRef.current = layers

  // 生成配置（heightmapTemplate / namingStyle 由 AI 决定，从 config prop 传入）
  const configKey = useMemo(() => JSON.stringify(config || {}), [config])
  const mergedConfig = useMemo<MapGenConfig>(
    () => ({ width: 1200, height: 800, ...config }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configKey],
  )

  // ── 生成地图 ──
  const doGenerate = useCallback(
    (cfg: MapGenConfig) => {
      setGenerating(true)
      setError(null)
      requestAnimationFrame(() => setTimeout(() => {
        try {
          const t0 = performance.now()
          const data = generateMap(cfg)
          console.log(`[WorldMapVoronoi] Generated in ${Math.round(performance.now() - t0)}ms (${data.cells.length} cells)`)

          const dpr = window.devicePixelRatio || 1
          const renderScale = Math.min(dpr, 3)
          const offscreen = document.createElement('canvas')
          renderMap(offscreen, data, {
            scale: renderScale,
            kmPerPixel: kmPerPixelRef.current,
            stylePreset: stylePresetRef.current,
            layers: layersRef.current,
          })
          offscreenRef.current = offscreen
          mapDataRef.current = data
          setMapData(data)
          setGenerating(false)
          onMapGenerated?.(data)
        } catch (e) {
          console.error('[WorldMapVoronoi] Generation failed:', e)
          setError(e instanceof Error ? e.message : String(e))
          setGenerating(false)
        }
      }, 50))
    },
    [onMapGenerated],
  )

  useEffect(() => {
    doGenerate(mergedConfig)
  }, [configKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 重新渲染（不重新生成） ──
  const rerender = useCallback(() => {
    const md = mapDataRef.current
    if (!md) return
    const dpr = window.devicePixelRatio || 1
    const offscreen = document.createElement('canvas')
    renderMap(offscreen, md, {
      scale: Math.min(dpr, 3),
      kmPerPixel: kmPerPixelRef.current,
      stylePreset: stylePresetRef.current,
      layers: layersRef.current,
    })
    offscreenRef.current = offscreen
    paint()
  }, [])

  // ── 绘制到显示 canvas ──
  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const offscreen = offscreenRef.current
    const container = containerRef.current
    if (!canvas || !offscreen || !container) return

    const dpr = window.devicePixelRatio || 1
    const cw = container.clientWidth, ch = container.clientHeight
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr; canvas.height = ch * dpr
      canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px'
    }

    const ctx = canvas.getContext('2d')!
    const vp = vpRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#1a1f2e'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)
    ctx.scale(vp.scale, vp.scale)
    ctx.translate(-vp.offsetX, -vp.offsetY)

    const md = mapDataRef.current
    const mapW = md?.width || offscreen.width
    const mapH = md?.height || offscreen.height
    ctx.drawImage(offscreen, 0, 0, offscreen.width, offscreen.height, 0, 0, mapW, mapH)
  }, [])

  useEffect(() => {
    if (!mapData) return
    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth, ch = container.clientHeight
    const fitScale = Math.min(cw / mapData.width, ch / mapData.height, 1)
    vpRef.current = { scale: fitScale, offsetX: -(cw / fitScale - mapData.width) / 2, offsetY: -(ch / fitScale - mapData.height) / 2 }
    setScalePercent(Math.round(fitScale * 100))
    paint()
  }, [mapData, paint])

  useEffect(() => {
    const onResize = () => paint()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [paint])

  // ── 交互 ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let dragging = false, lastX = 0, lastY = 0

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const vp = vpRef.current
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const wx = vp.offsetX + mx / vp.scale, wy = vp.offsetY + my / vp.scale
      const newScale = Math.max(0.2, Math.min(8, vp.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      vp.scale = newScale; vp.offsetX = wx - mx / newScale; vp.offsetY = wy - my / newScale
      setScalePercent(Math.round(newScale * 100)); paint()
    }
    const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId) }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const vp = vpRef.current
      vp.offsetX -= (e.clientX - lastX) / vp.scale; vp.offsetY -= (e.clientY - lastY) / vp.scale
      lastX = e.clientX; lastY = e.clientY; paint()
    }
    const onUp = () => { dragging = false }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [paint])

  const handleZoom = useCallback((delta: number) => {
    const vp = vpRef.current; const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth, ch = container.clientHeight
    const cx = vp.offsetX + cw / (2 * vp.scale), cy = vp.offsetY + ch / (2 * vp.scale)
    const newScale = Math.max(0.2, Math.min(8, vp.scale * (delta > 0 ? 1.3 : 1 / 1.3)))
    vp.scale = newScale; vp.offsetX = cx - cw / (2 * newScale); vp.offsetY = cy - ch / (2 * newScale)
    setScalePercent(Math.round(newScale * 100)); paint()
  }, [paint])

  const handleFitView = useCallback(() => {
    if (!mapData) return
    const container = containerRef.current; if (!container) return
    const cw = container.clientWidth, ch = container.clientHeight
    const fitScale = Math.min(cw / mapData.width, ch / mapData.height, 1)
    vpRef.current = { scale: fitScale, offsetX: -(cw / fitScale - mapData.width) / 2, offsetY: -(ch / fitScale - mapData.height) / 2 }
    setScalePercent(Math.round(fitScale * 100)); paint()
  }, [mapData, paint])

  const handleKmPerPixelChange = useCallback((newVal: number) => {
    kmPerPixelRef.current = newVal; setKmPerPixel(newVal); rerender()
  }, [rerender])

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers(prev => {
      const next = { ...prev, [key]: !prev[key] }
      layersRef.current = next
      requestAnimationFrame(() => rerender())
      return next
    })
  }, [rerender])

  const handleStyleChange = useCallback((preset: MapStylePreset) => {
    setStylePreset(preset); stylePresetRef.current = preset
    requestAnimationFrame(() => rerender())
  }, [rerender])

  // ── 导出 ──
  const [exporting, setExporting] = useState(false)
  const handleExportHD = useCallback(() => {
    if (!mapData || exporting) return
    setExporting(true)
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const exportCanvas = document.createElement('canvas')
        renderMap(exportCanvas, mapData, {
          scale: 5, kmPerPixel: kmPerPixelRef.current,
          stylePreset: stylePresetRef.current, layers: layersRef.current,
        })
        exportCanvas.toBlob((blob) => {
          if (!blob) { setExporting(false); return }
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${mapData.name || 'map'}_${mapData.width * 5}x${mapData.height * 5}.png`
          a.click(); URL.revokeObjectURL(url); setExporting(false)
        }, 'image/png')
      } catch { setExporting(false) }
    }, 50))
  }, [mapData, exporting])

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px] bg-[#1a1f2e] overflow-hidden">
      {generating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1a1f2e]">
          <div className="text-center text-text-muted">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-accent" />
            <p className="text-sm">正在生成地图...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#1a1f2e]">
          <div className="text-center text-red-400 max-w-sm">
            <p className="text-sm mb-3">生成失败</p>
            <p className="text-xs text-text-muted mb-4">{error}</p>
            <button onClick={() => doGenerate(mergedConfig)} className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover">重试</button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* 信息栏 */}
      {mapData && !generating && (
        <div className="absolute top-3 left-3 text-xs bg-[#1e2230] text-gray-300 rounded-lg px-2.5 py-1.5 shadow-lg border border-gray-700/50 space-y-0.5">
          <div className="font-medium text-white">{mapData.name}</div>
          <div className="text-gray-400">
            {mapData.states.filter(s => s.i > 0).length} 国 ·{' '}
            {mapData.burgs.filter(b => b.i > 0).length} 城 ·{' '}
            {mapData.rivers.length} 河 ·{' '}
            {mapData.roads.length} 路
          </div>
        </div>
      )}

      {/* 右上角按钮 */}
      {mapData && !generating && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <button
            onClick={() => setShowSettings(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg shadow-lg border transition-colors ${
              showSettings
                ? 'bg-accent text-white border-accent'
                : 'bg-[#1e2230] text-gray-300 border-gray-700/50 hover:text-white hover:border-gray-600'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            设置
          </button>
          <button
            onClick={handleExportHD}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2230] text-gray-300 hover:text-white text-xs rounded-lg shadow-lg border border-gray-700/50 hover:border-gray-600 transition-colors disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? '导出中...' : '导出高清'}
          </button>
          <button
            onClick={() => doGenerate({ ...mergedConfig, seed: undefined })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e2230] text-gray-300 hover:text-white text-xs rounded-lg shadow-lg border border-gray-700/50 hover:border-gray-600 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            重新生成
          </button>
        </div>
      )}

      {/* 设置面板 — 只有渲染选项 */}
      {mapData && !generating && showSettings && (
        <div className="absolute top-12 right-3 bg-[#1e2230] rounded-lg shadow-xl border border-gray-700/50 p-3 w-52 max-h-[75vh] overflow-y-auto z-20">
          <h4 className="text-[11px] font-medium text-white mb-3">渲染设置</h4>

          {/* 渲染风格 */}
          <div className="mb-3">
            <label className="text-[10px] text-gray-400 block mb-1.5">渲染风格</label>
            <div className="grid grid-cols-2 gap-1">
              {(Object.entries(STYLE_PRESET_LABELS) as [MapStylePreset, string][]).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => handleStyleChange(k)}
                  className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                    stylePreset === k
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : 'bg-[#252a3a] text-gray-400 border-gray-700/50 hover:text-gray-200 hover:border-gray-600'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* 图层开关 */}
          <div>
            <label className="text-[10px] text-gray-400 block mb-1.5">图层显隐</label>
            <div className="space-y-0.5">
              {(Object.entries(LAYER_LABELS) as [keyof LayerVisibility, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer py-0.5 group">
                  <input
                    type="checkbox"
                    checked={layers[key] ?? true}
                    onChange={() => toggleLayer(key)}
                    className="accent-accent w-3 h-3"
                  />
                  <span className="text-[10px] text-gray-400 group-hover:text-gray-200">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 缩放 */}
      {mapData && !generating && (
        <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-[#1e2230] rounded-lg border border-gray-700/50 px-1.5 py-1 shadow-lg">
          <button onClick={() => handleZoom(-1)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white text-sm rounded hover:bg-[#252a3a]">−</button>
          <button onClick={handleFitView} className="px-1.5 text-[10px] text-gray-400 hover:text-white rounded hover:bg-[#252a3a] min-w-[36px] text-center">{scalePercent}%</button>
          <button onClick={() => handleZoom(1)} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white text-sm rounded hover:bg-[#252a3a]">+</button>
        </div>
      )}

      {/* 底部 */}
      {mapData && !generating && (
        <div className="absolute bottom-3 left-3 flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setShowLegend(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-lg border shadow-lg transition-colors ${
                showLegend
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-[#1e2230] text-gray-400 border-gray-700/50 hover:text-white'
              }`}
            >
              <Info className="w-3 h-3" />
              图例
            </button>
            <div className="flex gap-2 text-[10px] text-gray-500 bg-[#1e2230] rounded-lg px-2 py-1 border border-gray-700/50 shadow-lg">
              <span>滚轮缩放</span>
              <span>拖拽平移</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-[#1e2230] rounded-lg border border-gray-700/50 px-2 py-1 shadow-lg">
            <span className="text-[10px] text-gray-400 whitespace-nowrap">比例尺</span>
            <select
              value={kmPerPixel}
              onChange={e => handleKmPerPixelChange(Number(e.target.value))}
              className="bg-transparent text-[10px] text-gray-200 outline-none cursor-pointer"
            >
              <option value={0.1}>1px = 100m</option>
              <option value={0.5}>1px = 500m</option>
              <option value={1}>1px = 1km</option>
              <option value={2}>1px = 2km</option>
              <option value={5}>1px = 5km</option>
              <option value={10}>1px = 10km</option>
              <option value={50}>1px = 50km</option>
            </select>
          </div>
        </div>
      )}

      {mapData && !generating && showLegend && <MapLegend />}
    </div>
  )
}

// ── 图例 ──

function MapLegend() {
  return (
    <div className="absolute bottom-14 left-3 bg-[#1e2230] rounded-lg shadow-xl border border-gray-700/50 p-3 max-h-[60vh] overflow-y-auto w-40 z-20">
      <h4 className="text-[11px] font-medium text-white mb-2">地图图例</h4>

      <LegendSection title="水域">
        <LegendColor color="#2b6da8" label="深海" />
        <LegendColor color="#6baed6" label="浅海" />
        <LegendColor color="#b3d7ea" label="近岸" />
        <LegendLine color="#4a96d0" label="河流" />
      </LegendSection>

      <LegendSection title="生态群落">
        {BIOMES.filter(b => b.id > 0).map(b => (
          <LegendColor key={b.id} color={b.color} label={b.name} />
        ))}
      </LegendSection>

      <LegendSection title="海拔">
        <LegendColor color="rgb(160,130,80)" label="丘陵" />
        <LegendColor color="rgb(190,160,120)" label="山地" />
        <LegendColor color="rgb(220,200,160)" label="高山" />
        <LegendColor color="rgb(240,220,180)" label="雪线" />
      </LegendSection>

      <LegendSection title="标记" noBorder>
        <LegendIcon type="capital" label="首都" />
        <LegendIcon type="town" label="城镇" />
        <LegendLine color="rgba(120,80,40,0.6)" label="主干道" />
        <LegendLine color="rgba(140,110,70,0.4)" label="支路" dashed />
        <LegendLine color="rgba(100,100,100,0.3)" label="省界" dashed />
      </LegendSection>
    </div>
  )
}

function LegendSection({ title, children, noBorder }: { title: string; children: React.ReactNode; noBorder?: boolean }) {
  return (
    <div className={noBorder ? '' : 'mb-2'}>
      <p className="text-[9px] text-gray-500 mb-1 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  )
}

function LegendColor({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <div className="w-3 h-3 rounded-sm border border-white/10" style={{ backgroundColor: color }} />
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  )
}

function LegendLine({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <div className={`w-4 h-0 border-t ${dashed ? 'border-dashed' : ''}`} style={{ borderColor: color }} />
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  )
}

function LegendIcon({ type, label }: { type: 'capital' | 'town'; label: string }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {type === 'capital' ? (
        <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-400 bg-white flex items-center justify-center">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
        </div>
      ) : (
        <div className="w-3 h-3 rounded-full border border-gray-500 bg-white flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-gray-500" />
        </div>
      )}
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  )
}
