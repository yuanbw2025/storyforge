import {
  ATLAS_LAYER_LABELS,
  DEFAULT_ATLAS_LAYERS,
  type AtlasLayers,
} from '../../lib/world-map/atlas/layers'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { generateMap, type MapGenConfig } from '../../lib/world-map/engine'
import {
  geometryFromMap,
  parseAtlasReference,
  type AtlasGeometry,
} from '../../lib/world-map/atlas/geometry'
import { inspectCityPlacement } from '../../lib/world-map/atlas/inspect'
import { loadAtlasSymbols, type AtlasSymbolStyle } from '../../lib/world-map/atlas/symbols'
import { resolveAtlasStyle, type AtlasViewStyle } from '../../lib/world-map/atlas/view-style'
import { drawLabels, drawTerrain } from '../../lib/world-map/atlas/paint'
import AtlasPaintControls from './AtlasPaintControls'
import { drawEnhancedAtlas } from '../../lib/world-map/atlas/enhance'
import type { AtlasPaintPreview } from '../../lib/world-map/atlas/paint-preview'

interface Props {
  config: MapGenConfig
  onReference?: (reference: AtlasGeometry) => Promise<void>
  navigation?: ReactNode
  ownerKey?: string
}

export default function WorldAtlasPreview({ config, onReference, navigation, ownerKey }: Props) {
  const viewport = useRef<HTMLCanvasElement>(null)
  const [expanded, setExpanded] = useState(
    Boolean(onReference) && new URLSearchParams(location.search).get('view') === 'map',
  )
  useEffect(() => {
    if (!expanded) return
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [expanded])
  const camera = useRef({ zoom: 1, x: 0, y: 0 })
  const [auto, setAuto] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, redraw] = useState(0)
  const [layers, setLayers] = useState<AtlasLayers>({
    ...DEFAULT_ATLAS_LAYERS,
  })
  const [showLayers, setShowLayers] = useState(false)
  const reference = !auto && config.atlasReference
  const [sheet, setSheet] = useState<HTMLImageElement>()
  const [initialStyle] = useState(() => {
    let saved = new URLSearchParams(location.search).get('art')
    let symbols: string | null = null
    try {
      saved ||= localStorage.getItem('storyforge-atlas-art')
      symbols = localStorage.getItem('storyforge-atlas-symbols')
    } catch { /* View-only preference. */ }
    return resolveAtlasStyle(saved, symbols)
  })
  const [viewStyle, setViewStyle] = useState<AtlasViewStyle>(initialStyle.style)
  const [symbolStyle, setSymbolStyle] = useState<AtlasSymbolStyle>(initialStyle.symbols)
  const [paintedState, setPainted] = useState<{ key: string; image: HTMLImageElement; art?: AtlasPaintPreview }>()
  const [textScale, setTextScale] = useState(1)
  const usesSymbols = viewStyle !== 'sketch'
  useEffect(() => {
    let active = true
    setSheet(undefined)
    if (!usesSymbols) return
    loadAtlasSymbols(symbolStyle)
      .then((img) => {
        if (active) setSheet(img)
      })
      .catch(() => {
        if (active) setError('插画素材未加载，已使用程序符号。')
      })
    return () => {
      active = false
    }
  }, [symbolStyle, usesSymbols])
  const result = useMemo(() => {
    try {
      const geometry = reference
        ? parseAtlasReference(reference)
        : config.atlasDraft
          ? parseAtlasReference(config.atlasDraft)
          : geometryFromMap(generateMap(config))
      return { geometry }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [config, reference])
  const { geometry } = result
  const geometryKey = JSON.stringify(geometry) + (config.seed || 'atlas') + viewStyle + symbolStyle + (ownerKey || '')
  const painted = paintedState?.key === geometryKey ? paintedState.image : undefined
  const handlePaintedChange = useCallback((image: HTMLImageElement | undefined, art?: AtlasPaintPreview) => {
    setPainted(image ? { key: geometryKey, image, art } : undefined)
  }, [geometryKey])
  const terrain = useMemo(
    () => (geometry ? painted && paintedState?.art?.version === 2
      ? drawEnhancedAtlas(geometry, config.seed || 'atlas', painted, viewStyle, layers, sheet)
      : drawTerrain(geometry, config.seed || 'atlas', sheet, layers, painted, viewStyle) : undefined),
    [geometry, config.seed, sheet, layers, viewStyle, painted, paintedState?.art],
  )
  const kmPerPixel =
    config.kmPerPixel ??
    (config.mapWidthKm && geometry ? config.mapWidthKm / geometry.width : undefined)
  const hasLayer = (key: keyof AtlasLayers) => {
    const kinds: Partial<Record<keyof AtlasLayers, string[]>> = {
      borders: ['border'], provinces: ['province'], fortresses: ['fortress'],
      coastlines: ['land', 'water'], passages: ['passage'], rifts: ['rift'], waterBodies: ['water'],
      mountains: ['ridge'], forests: ['wood'], rivers: ['river'], roads: ['road', 'seaRoute'],
      walls: ['wall'], stateLabels: ['region'], burgIcons: ['city', 'fortress', 'landmark'],
      burgLabels: ['city', 'fortress', 'landmark', 'sea', 'water', 'river', 'ridge', 'wall', 'passage', 'rift'],
    }
    const accepted = kinds[key]
    return !accepted || Boolean(geometry?.features.some((f) => accepted.includes(f.kind)))
  }
  const offshore = useMemo(() => (geometry ? inspectCityPlacement(geometry) : []), [geometry])
  const fit = () => {
    camera.current = { zoom: 1, x: 0, y: 0 }
    redraw((n) => n + 1)
  }
  useEffect(() => {
    fit()
  }, [geometry])
  useEffect(() => {
    const el = viewport.current
    if (!el || !geometry) return
    const size = () => Math.min(el.clientWidth / geometry.width, el.clientHeight / geometry.height)
    function zoomAt(amount: number, x: number, y: number) {
      const cam = camera.current,
        old = cam.zoom
      cam.zoom = Math.max(1, Math.min(8, old * amount))
      cam.x = ((cam.x - x) * cam.zoom) / old + x
      cam.y = ((cam.y - y) * cam.zoom) / old + y
      if (cam.zoom === 1) {
        cam.x = 0
        cam.y = 0
      }
      redraw((n) => n + 1)
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const b = el.getBoundingClientRect()
      zoomAt(
        e.deltaY < 0 ? 1.22 : 1 / 1.22,
        e.clientX - b.left - b.width / 2,
        e.clientY - b.top - b.height / 2,
      )
    }
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!el.hasPointerCapture(e.pointerId)) return
      camera.current.x += e.movementX
      camera.current.y += e.movementY
      redraw((n) => n + 1)
    }
    const key = (e: KeyboardEvent) => {
      if (['+', '=', '-', 'Home'].includes(e.key)) {
        e.preventDefault()
        if (e.key === 'Home') fit()
        else zoomAt(e.key === '-' ? 0.8 : 1.25, 0, 0)
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = geometry.width * size() * 0.12
        camera.current.x += e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0
        camera.current.y += e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
        redraw((n) => n + 1)
      }
    }
    const observer = new ResizeObserver(() => redraw((n) => n + 1))
    observer.observe(el)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('keydown', key)
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('keydown', key)
    }
  }, [geometry, expanded])
  useEffect(() => {
    const el = viewport.current
    if (!el || !geometry || !terrain) return
    const w = el.clientWidth,
      h = el.clientHeight,
      dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (w < 1 || h < 1) return
    el.width = w * dpr
    el.height = h * dpr
    const c = el.getContext('2d')!,
      cam = camera.current
    const k = Math.min(w / geometry.width, h / geometry.height) * cam.zoom
    c.scale(dpr, dpr)
    c.fillStyle = '#263e40'
    c.fillRect(0, 0, w, h)
    c.translate((w - geometry.width * k) / 2 + cam.x, (h - geometry.height * k) / 2 + cam.y)
    c.scale(k, k)
    c.beginPath()
    c.rect(0, 0, geometry.width, geometry.height)
    c.clip()
    c.drawImage(terrain, 0, 0, geometry.width, geometry.height)
    drawLabels(c, geometry, cam.zoom, !!sheet, { layers, sheet: viewStyle === 'painted' && !painted ? undefined : sheet, kmPerPixel, screenScale: k, textScale,
      style: viewStyle === 'sketch' ? 'sketch' : 'illustrated' })
  }, [geometry, terrain, revision, layers, sheet, expanded, kmPerPixel, textScale, viewStyle, painted])
  const exportMap = () => {
    if (!terrain || !geometry) return
    const out = document.createElement('canvas')
    out.width = terrain.width
    out.height = terrain.height
    const c = out.getContext('2d')!
    c.drawImage(terrain, 0, 0)
    c.scale(out.width / geometry.width, out.height / geometry.height)
    drawLabels(c, geometry, 1, !!sheet, { layers, sheet: viewStyle === 'painted' && !painted ? undefined : sheet, kmPerPixel, fullDetail: true, screenScale: 1, textScale,
      style: viewStyle === 'sketch' ? 'sketch' : 'illustrated' })
    out.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob),
        a = document.createElement('a')
      a.href = url
      a.download = (config.mapName || '世界') + '-' + ({ sketch: '简笔地图', illustrated: '绘本地图', painted: '连续绘画' }[viewStyle]) + '.png'
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
  }
  const panel = (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-[150] flex flex-col bg-bg-base'
          : 'flex flex-col h-full min-h-[460px] bg-bg-base'
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm border-b border-border bg-bg-base text-text-primary">
        {expanded && <strong className="mr-auto">{config.mapName}</strong>}
        {navigation}
        <strong>{reference ? '作者参考布局' : '设定自动布局'}</strong>
        <label className="flex items-center gap-2">
          <span>画风</span>
          <select aria-label="地图画风" className="bg-bg-base border border-border rounded px-2 py-1"
            value={viewStyle} onChange={(event) => {
              const style = event.target.value as AtlasViewStyle
              setViewStyle(style)
              try { localStorage.setItem('storyforge-atlas-art', style) } catch { /* View-only preference. */ }
            }}>
            <option value="sketch">简笔地图</option>
            <option value="illustrated">绘本地图</option>
            <option value="painted">连续绘画</option>
          </select>
        </label>
        {viewStyle === 'illustrated' && <label className="flex items-center gap-2">山林素材
          <select aria-label="绘本山林素材" className="bg-bg-base border border-border rounded px-2 py-1"
            value={symbolStyle} onChange={event => {
              const style = event.target.value as AtlasSymbolStyle
              setSymbolStyle(style)
              try { localStorage.setItem('storyforge-atlas-symbols', style) } catch { /* View-only preference. */ }
            }}>
            <option value="watercolor">欧式插画</option><option value="ink">中式插画</option>
          </select>
        </label>}
        <label className="flex items-center gap-2">文字大小
          <input aria-label="地图文字大小" type="range" min="1" max="1.8" step="0.1" value={textScale}
            onChange={event => setTextScale(Number(event.target.value))} className="w-20" />
          <output>{Math.round(textScale * 100)}%</output>
        </label>
        {config.atlasReference && (
          <button onClick={() => setAuto((v) => !v)}>
            {reference ? '查看纯自动结果' : '查看参考布局'}
          </button>
        )}
        {offshore.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer">核对 {offshore.length} 处离岸地点</summary>
            <div className="absolute z-10 mt-2 w-56 bg-bg-base border border-border p-3 rounded">
              {offshore.join('、')} 位于当前陆地或空间分区外，请核对地点归属和落点。
            </div>
          </details>
        )}
        <button onClick={fit}>全图</button>
        <div className="relative">
          <button
            aria-expanded={showLayers}
            aria-controls="atlas-layers"
            onClick={() => setShowLayers((v) => !v)}
          >
            图层筛选
          </button>
          {showLayers && (
            <fieldset
              id="atlas-layers"
              aria-label="地图图层"
              className="absolute top-full mt-3 right-0 z-20 w-60 max-h-[75vh] overflow-y-auto rounded-lg border border-border bg-bg-base p-4 shadow-xl"
            >
              <legend className="sr-only">地图图层</legend>
              {(Object.entries(ATLAS_LAYER_LABELS) as [keyof AtlasLayers, string][]).map(
                ([key, label]) => {
                  const baked = !!painted && paintedState?.art?.version !== 2 && ['terrain', 'mountains', 'forests', 'waterBodies'].includes(key)
                  const available = !baked &&
                    hasLayer(key) &&
                    (key !== 'scaleBar' ||
                      (Boolean(kmPerPixel) && !geometry?.features.some((f) => f.kind === 'realm')))
                  return (
                    <label key={key} className="flex items-center gap-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={baked || (available && layers[key])}
                        disabled={!available}
                        onChange={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
                      />
                      <span>{label}</span>
                      {!available && (
                        <span className="ml-auto text-xs text-text-muted">
                          {baked ? '绘画底图内' : key === 'scaleBar' ? '未设定距离' : '无此类数据'}
                        </span>
                      )}
                    </label>
                  )
                },
              )}
            </fieldset>
          )}
        </div>
        <button onClick={() => setExpanded((v) => !v)}>
          {expanded ? (onReference ? '返回工作台' : '收起地图') : '展开地图'}
        </button>
        <button onClick={exportMap} disabled={!terrain}>
          导出图集
        </button>
        {onReference && (
          <label className="cursor-pointer">
            {loading ? '保存中…' : '导入参考布局'}
            <input
              type="file"
              accept=".json"
              className="sr-only"
              disabled={loading}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setLoading(true)
                setError('')
                try {
                  if (file.size > 2_000_000) throw Error('参考布局文件超过 2 MB。')
                  const ref = parseAtlasReference(JSON.parse(await file.text()))
                  await onReference(ref)
                  setAuto(false)
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause))
                } finally {
                  setLoading(false)
                }
              }}
            />
          </label>
        )}
      </div>
      {geometry && <AtlasPaintControls geometry={geometry} style={viewStyle} symbols={symbolStyle} ownerKey={ownerKey}
        seed={config.seed || 'atlas'} sheet={sheet} onChange={handlePaintedChange} />}
      {(error || result.error) && <p role="alert">{error || result.error}</p>}
      <canvas
        ref={viewport}
        tabIndex={0}
        aria-label="二维世界图集，滚轮缩放，拖动平移，Home 返回全图"
        className="block w-full flex-1 min-h-0 cursor-grab touch-none"
        style={{ height: 0 }}
      />
    </div>
  )
  return expanded ? createPortal(panel, document.body) : panel
}
