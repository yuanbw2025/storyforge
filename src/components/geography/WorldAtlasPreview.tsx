import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { generateMap, type MapGenConfig } from '../../lib/world-map/engine'
import { geometryFromMap, parseAtlasReference, type AtlasGeometry } from '../../lib/world-map/atlas/geometry'
import {inspectCityPlacement} from '../../lib/world-map/atlas/inspect'
import { loadAtlasSymbols } from '../../lib/world-map/atlas/symbols'
import { drawLabels, drawTerrain } from '../../lib/world-map/atlas/paint'

interface Props {
  config: MapGenConfig
  onReference?: (reference: AtlasGeometry) => Promise<void>
}

export default function WorldAtlasPreview({ config, onReference }: Props) {
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
  const [showLabels, setShowLabels] = useState(true)
  const reference = !auto && config.atlasReference
  const [sheet, setSheet] = useState<HTMLImageElement>()
  useEffect(() => {
    let active = true
    loadAtlasSymbols()
      .then((img) => {
        if (active) setSheet(img)
      })
      .catch(() => {
        if (active) setError('插画素材未加载，已使用程序符号。')
      })
    return () => {
      active = false
    }
  }, [])
  const result = useMemo(() => {
    try {
      const geometry = reference
        ? parseAtlasReference(reference)
        : config.atlasDraft
          ? parseAtlasReference(config.atlasDraft)
          : geometryFromMap(generateMap(config))
      return { geometry, terrain: drawTerrain(geometry, config.seed || 'atlas', sheet) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [config, reference, sheet])
  const { geometry, terrain } = result
  const offshore = useMemo(()=>geometry?inspectCityPlacement(geometry):[],[geometry])
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
    if (showLabels) drawLabels(c, geometry, cam.zoom, !!sheet)
  }, [geometry, terrain, revision, showLabels, sheet, expanded])
  const exportMap = () => {
    if (!terrain || !geometry) return
    const out = document.createElement('canvas')
    out.width = terrain.width
    out.height = terrain.height
    const c = out.getContext('2d')!
    c.drawImage(terrain, 0, 0)
    c.scale(out.width / geometry.width, out.height / geometry.height)
    if (showLabels) drawLabels(c, geometry, 1, !!sheet)
    out.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob),
        a = document.createElement('a')
      a.href = url
      a.download = (config.mapName || '世界') + '-绘本图集.png'
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
        <strong>{reference ? '作者参考布局' : '设定自动布局'}</strong>
        {config.atlasReference && (
          <button onClick={() => setAuto((v) => !v)}>{reference ? '查看纯自动结果' : '查看参考布局'}</button>
        )}
        {offshore.length>0 && <details className="relative"><summary className="cursor-pointer">核对 {offshore.length} 处离岸地点</summary><div className="absolute z-10 mt-2 w-56 bg-bg-base border border-border p-3 rounded">{offshore.join('、')} 位于当前陆地轮廓外，请核对是海上地点还是落点偏差。</div></details>}
        <button onClick={fit}>全图</button>
        <button onClick={() => setShowLabels((v) => !v)}>{showLabels ? '隐藏地名' : '显示地名'}</button>
        <button onClick={() => setExpanded((v) => !v)}>{expanded ? '返回工作台' : '展开地图'}</button>
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
