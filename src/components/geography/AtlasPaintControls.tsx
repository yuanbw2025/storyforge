import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import type { AtlasGeometry } from '../../lib/world-map/atlas/geometry'
import { DEFAULT_ATLAS_LAYERS } from '../../lib/world-map/atlas/layers'
import { drawLabels, drawTerrain } from '../../lib/world-map/atlas/paint'
import {
  atlasPaintGeometryHash, generateAtlasPaintPreview, readAtlasPaintFile, type AtlasPaintPreview,
} from '../../lib/world-map/atlas/paint-preview'

interface Props {
  geometry: AtlasGeometry
  seed: string
  sheet?: HTMLImageElement
  onChange: (image: HTMLImageElement | undefined) => void
}

function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function AtlasPaintControls({ geometry, seed, sheet, onChange }: Props) {
  const aiConfig = useAIConfigStore(state => state.config)
  const [model, setModel] = useState('gpt-image-2')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [candidate, setCandidate] = useState<{ art: AtlasPaintPreview; image: HTMLImageElement; preview: string }>()
  const [accepted, setAccepted] = useState<AtlasPaintPreview>()
  const controller = useRef<AbortController | null>(null)
  const epoch = useRef(0)
  const invalidate = useCallback(() => { epoch.current++; controller.current?.abort() }, [])
  const geometryKey = JSON.stringify(geometry) + seed
  useEffect(() => {
    invalidate()
    setBusy(false); setCandidate(undefined); setAccepted(undefined); setError(''); onChange(undefined)
    return invalidate
  }, [geometryKey, onChange, invalidate])

  const prepare = async (art: AtlasPaintPreview, ticket: number) => {
    const image = new Image(); image.src = art.image; await image.decode()
    if (epoch.current !== ticket) return
    const terrain = drawTerrain(geometry, seed, sheet, DEFAULT_ATLAS_LAYERS, image)
    const preview = document.createElement('canvas')
    preview.width = terrain.width; preview.height = terrain.height
    const c = preview.getContext('2d')!
    c.drawImage(terrain, 0, 0)
    c.scale(preview.width / geometry.width, preview.height / geometry.height)
    drawLabels(c, geometry, 1, !!sheet, { sheet, fullDetail: true, screenScale: 1 })
    setCandidate({ art, image, preview: preview.toDataURL('image/jpeg', 0.85) })
  }
  const generate = async () => {
    if (controller.current) return
    const ticket = ++epoch.current, abort = new AbortController()
    controller.current = abort; setBusy(true); setError('')
    try {
      const canvas = drawTerrain(geometry, seed, sheet, { ...DEFAULT_ATLAS_LAYERS,
        rivers: false, roads: false, borders: false, provinces: false, walls: false, rifts: false, passages: false })
      const width = 1536, height = Math.round(width * geometry.height / geometry.width / 16) * 16
      const reference = document.createElement('canvas'); reference.width = width; reference.height = height
      reference.getContext('2d')!.drawImage(canvas, 0, 0, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => reference.toBlob(value => value ? resolve(value) : reject(Error('参考图导出失败。')), 'image/png'))
      if (epoch.current !== ticket) return
      const art = await generateAtlasPaintPreview({ geometry, seed, reference: blob, aiConfig,
        imageModel: model, width, height, signal: abort.signal })
      await prepare(art, ticket)
    } catch (cause) {
      if (epoch.current === ticket) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (controller.current === abort) controller.current = null
      if (epoch.current === ticket) setBusy(false)
    }
  }
  return <section aria-label="连续绘画底图" className="border-b border-border bg-bg-base px-4 py-3 text-sm text-text-primary">
    <div className="flex flex-wrap items-center gap-3">
      <strong>连续绘画</strong>
      <label className="flex items-center gap-2">图片模型<input aria-label="绘画底图模型" className="w-36 rounded border border-border bg-bg-base px-2 py-1" value={model} disabled={busy} onChange={event => setModel(event.target.value)} /></label>
      <button type="button" disabled={busy || !sheet || !!candidate} onClick={() => { void generate() }}>{busy ? '正在生成候选…' : '生成绘画底图'}</button>
      {busy && <button type="button" onClick={() => controller.current?.abort()}>停止等待</button>}
      <label className="cursor-pointer">导入底图或底图包<input aria-label="导入绘画底图" type="file" accept="image/png,image/jpeg,image/webp,.json" className="sr-only" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy) return
        const ticket = ++epoch.current; setError(''); setBusy(true)
        try { const hash = await atlasPaintGeometryHash(geometry, seed); await prepare(await readAtlasPaintFile(file, hash, geometry), ticket) }
        catch (cause) { if (epoch.current === ticket) setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { if (epoch.current === ticket) setBusy(false) }
      }} /></label>
      {accepted && <><button type="button" onClick={() => download(new Blob([JSON.stringify(accepted)], { type: 'application/json' }), '世界地图-绘画底图.json')}>保存底图包</button><button type="button" onClick={() => { setAccepted(undefined); onChange(undefined) }}>移除底图</button></>}
    </div>
    <p className="mt-2 text-xs text-text-muted">{accepted ? '底图已用于本次查看。' : '尚未使用绘画底图，地图暂显示绘本构图。'}通过当前 AI 连接生成一张候选，核对后使用；也可导入已有图片。保存底图包可供下次恢复。</p>
    {accepted && <p className="mt-1 text-xs text-text-muted">绘画底图包含山林和水面；这些内容合在图片中。道路、城镇、边界与文字仍可分别筛选。</p>}
    {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}
    {candidate && <div className="mt-3"><p>请核对轮廓与地形是否贴合。文字由地图程序叠加，底图不会修改世界设定。</p><img src={candidate.preview} alt="带程序文字的绘画底图候选" className="mt-2 max-h-64 max-w-full rounded border border-border" /><div className="mt-2 flex gap-4"><button type="button" onClick={() => { setAccepted(candidate.art); onChange(candidate.image); setCandidate(undefined) }}>使用此底图</button><button type="button" onClick={() => setCandidate(undefined)}>放弃候选</button></div></div>}
  </section>
}
