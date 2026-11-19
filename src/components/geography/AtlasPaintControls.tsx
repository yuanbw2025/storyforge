import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveAIConfigPresetV1, useAIConfigStore } from '../../stores/ai-config'
import type { AtlasGeometry } from '../../lib/world-map/atlas/geometry'
import { DEFAULT_ATLAS_LAYERS } from '../../lib/world-map/atlas/layers'
import { drawLabels, drawTerrain } from '../../lib/world-map/atlas/paint'
import { drawEnhancedAtlas } from '../../lib/world-map/atlas/enhance'
import { atlasPaintGeometryHash, generateAtlasPaintPreview, readAtlasPaintFile, type AtlasPaintPreview } from '../../lib/world-map/atlas/paint-preview'
import { ATLAS_PAINT_REVISION, atlasTerrainHash, type AtlasPaintPackageV2 } from '../../lib/world-map/atlas/paint-package'
import { atlasImageConfig, atlasImageConnectionProblem, defaultAtlasImageConnection, readAtlasImageConnection,
  saveAtlasImageConnection, type AtlasImageConnection } from '../../lib/world-map/atlas/image-connection'
import { readAtlasView, removeAtlasView, saveAtlasView } from '../../lib/authoring/atlas-view-cache'
import type { AtlasViewStyle } from '../../lib/world-map/atlas/view-style'
import type { AtlasSymbolStyle } from '../../lib/world-map/atlas/symbols'

interface Props {
  geometry: AtlasGeometry; seed: string; sheet?: HTMLImageElement
  style?: AtlasViewStyle; symbols?: AtlasSymbolStyle; ownerKey?: string
  onChange: (image: HTMLImageElement | undefined, art?: AtlasPaintPreview) => void
}
function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
interface Surface { art: AtlasPaintPreview; image: HTMLImageElement; key: string }
interface Candidate extends Surface { preview: string; original: string }

export default function AtlasPaintControls({ geometry, seed, sheet, style = 'painted', symbols = 'watercolor', ownerKey, onChange }: Props) {
  const key = JSON.stringify(geometry) + seed + style + symbols + (ownerKey || '')
  const currentKey = useRef(key); currentKey.current = key
  const globalConfig = useAIConfigStore(s => s.config), presets = useAIConfigStore(s => s.presets)
  const [connection, setConnection] = useState(readAtlasImageConnection)
  const config = useMemo(() => {
    if (connection.presetId === '$current') return globalConfig
    const preset = presets.find(p => p.id === connection.presetId)
    return preset ? resolveAIConfigPresetV1(preset, globalConfig) : undefined
  }, [connection.presetId, globalConfig, presets])
  const aspect = geometry.width / geometry.height
  const problem = atlasImageConnectionProblem(connection, config)
    || (aspect < 1 / 3 || aspect > 6 ? '此地图过于狭长，当前图片接口需先分区增强；程序地图仍可完整使用。' : '')
  const [busy, setBusy] = useState(false), [restoring, setRestoring] = useState(false)
  const [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const [candidateState, setCandidate] = useState<Candidate>()
  const [acceptedState, setAccepted] = useState<Surface>()
  const [stale, setStale] = useState<AtlasPaintPackageV2>()
  const [fingerprint, setFingerprint] = useState<{ key: string; hash: string }>()
  const [enabled, setEnabled] = useState(false)
  const candidate = candidateState?.key === key ? candidateState : undefined
  const accepted = acceptedState?.key === key ? acceptedState : undefined
  const controller = useRef<AbortController | null>(null), epoch = useRef(0)
  const invalidate = useCallback(() => { epoch.current++; controller.current?.abort(); controller.current = null }, [])
  const modeKey = 'storyforge-atlas-view-mode:' + ownerKey + ':' + style + ':' + symbols
  const rememberMode = (value: boolean) => { try { localStorage.setItem(modeKey, value ? 'ai' : 'native') } catch { /* Image saving reports its own error. */ } }
  useEffect(() => {
    invalidate(); const ticket = epoch.current
    setBusy(false); setCandidate(undefined); setAccepted(undefined); setStale(undefined); setError(''); setSaved(false); setEnabled(false)
    setRestoring(true); onChange(undefined)
    void (async () => {
      try {
        const hash = await atlasTerrainHash(geometry, seed)
        if (epoch.current !== ticket) return
        setFingerprint({ key, hash })
        if (!ownerKey) return
        const entry = await readAtlasView(ownerKey, style, symbols)
        if (epoch.current !== ticket || !entry) return
        if (entry.error) setError(entry.error)
        if (entry.art.geometryHash !== hash) { setStale(entry.art); return }
        const art = await readAtlasPaintFile(new File([JSON.stringify(entry.art)], 'cache.json'), '', geometry, { terrainHash: hash, style, symbols })
        const image = new Image(); image.src = art.image; await image.decode()
        if (epoch.current !== ticket) return
        setAccepted({ art, image, key }); setSaved(!entry.error)
        let active = true
        try { active = localStorage.getItem(modeKey) !== 'native' } catch { /* Restore adopted image by default. */ }
        setEnabled(active); if (active) onChange(image, art)
      } catch (cause) { if (epoch.current === ticket) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { if (epoch.current === ticket) setRestoring(false) }
    })()
    return invalidate
  }, [key, ownerKey, geometry, seed, style, symbols, onChange, invalidate, modeKey])

  const changeConnection = (next: AtlasImageConnection) => {
    setConnection(next)
    try { saveAtlasImageConnection(next) } catch { setError('图片连接选择未能保存；当前选择仍可使用。') }
  }
  const prepare = async (art: AtlasPaintPreview, ticket: number) => {
    const image = new Image(); image.src = art.image; await image.decode()
    if (epoch.current !== ticket) return
    const render = (enhance: boolean) => {
      const terrain = enhance ? art.version === 2 ? drawEnhancedAtlas(geometry, seed, image, style, DEFAULT_ATLAS_LAYERS, sheet)
        : drawTerrain(geometry, seed, sheet, DEFAULT_ATLAS_LAYERS, image, 'painted')
        : drawTerrain(geometry, seed, sheet, DEFAULT_ATLAS_LAYERS, undefined, style)
      const canvas = document.createElement('canvas'); canvas.width = terrain.width; canvas.height = terrain.height
      const c = canvas.getContext('2d')!; c.drawImage(terrain, 0, 0)
      c.scale(canvas.width / geometry.width, canvas.height / geometry.height)
      drawLabels(c, geometry, 1, !!sheet, { sheet: style === 'painted' && !enhance ? undefined : sheet,
        fullDetail: true, screenScale: 1, style: style === 'sketch' ? 'sketch' : 'illustrated' })
      return canvas.toDataURL('image/jpeg', 0.9)
    }
    setCandidate({ art, image, preview: render(true), original: render(false), key })
  }
  const generate = async () => {
    if (controller.current || problem || !config || fingerprint?.key !== key) return
    const ticket = ++epoch.current, abort = new AbortController()
    controller.current = abort; setBusy(true); setError('')
    const timer = window.setTimeout(() => abort.abort(Error('已等待 90 秒，已停止等待。服务端可能仍在处理，请核对结果后再决定是否重试。')), 90_000)
    try {
      const terrain = drawTerrain(geometry, seed, sheet, { ...DEFAULT_ATLAS_LAYERS, rivers: false, roads: false,
        borders: false, provinces: false, walls: false, rifts: false, passages: false }, undefined, style, false)
      const ratio = 1536 / Math.max(geometry.width, geometry.height)
      const width = Math.round(geometry.width * ratio), height = Math.round(geometry.height * ratio)
      const reference = document.createElement('canvas'); reference.width = width; reference.height = height
      reference.getContext('2d')!.drawImage(terrain, 0, 0, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => reference.toBlob(b => b ? resolve(b) : reject(Error('参考图导出失败。')), 'image/png'))
      if (epoch.current !== ticket) return
      const art = await generateAtlasPaintPreview({ geometry, seed, reference: blob, aiConfig: atlasImageConfig(connection, config),
        imageModel: connection.model, protocol: connection.protocol, style, symbols, width, height, signal: abort.signal })
      await prepare(art, ticket)
    } catch (cause) { if (epoch.current === ticket) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      clearTimeout(timer); if (controller.current === abort) controller.current = null
      if (epoch.current === ticket) setBusy(false)
    }
  }
  const adoptCandidate = async () => {
    if (!candidate) return
    const captured = candidate, capturedKey = key
    setAccepted(captured); setCandidate(undefined); setEnabled(true); setStale(undefined); onChange(captured.image, captured.art); rememberMode(true)
    if (!ownerKey || captured.art.version !== 2) { setSaved(false); return }
    setBusy(true)
    try { await saveAtlasView(ownerKey, captured.art); if (currentKey.current === capturedKey) setSaved(true) }
    catch (cause) { if (currentKey.current === capturedKey) { setSaved(false); setError(cause instanceof Error ? cause.message : String(cause)) } }
    finally { if (currentKey.current === capturedKey) setBusy(false) }
  }
  const remove = async () => {
    const capturedKey = key; setBusy(true)
    try {
      if (ownerKey) await removeAtlasView(ownerKey, style, symbols)
      if (currentKey.current !== capturedKey) return
      setAccepted(undefined); setStale(undefined); setEnabled(false); setSaved(false); setError(''); onChange(undefined); rememberMode(false)
    } catch { if (currentKey.current === capturedKey) setError('移除本机增强图失败，原图已保留，请重试。') }
    finally { if (currentKey.current === capturedKey) setBusy(false) }
  }
  const exportPackage = (art: AtlasPaintPreview) => download(new Blob([JSON.stringify(art)], { type: 'application/json' }), '世界地图-增强底图.json')
  return <section aria-label="地图美术增强" className="max-h-[52%] shrink-0 overflow-y-auto border-b border-border bg-bg-base px-4 py-3 text-sm text-text-primary">
    <div className="flex flex-wrap items-center gap-3">
      <label>制作方式 <select aria-label="地图制作方式" value={enabled ? 'ai' : 'native'} disabled={busy || restoring} onChange={event => {
        const value = event.target.value === 'ai'; setEnabled(value); rememberMode(value)
        onChange(value ? accepted?.image : undefined, value ? accepted?.art : undefined)
      }} className="rounded border border-border bg-bg-base px-2 py-1"><option value="native">程序绘制</option><option value="ai">AI 美术增强</option></select></label>
      <strong role="status">当前显示：{enabled && accepted ? accepted.art.version === 2 ? 'AI 增强（地貌范围约束）' : '旧版图片底图' : '程序绘制'}</strong>
      {accepted?.art.version === 2 && <span className="text-xs text-text-muted">{accepted.art.source.model} · {saved ? '已保存到本机' : '仅本次查看'}</span>}
      {restoring && <span>正在恢复本机增强图…</span>}
    </div>
    <details className="mt-2" open={enabled && !accepted || undefined}>
      <summary className="cursor-pointer">图片连接与增强候选</summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label>图片连接 <select aria-label="地图图片连接" value={connection.presetId} disabled={busy} onChange={event => {
          const id = event.target.value, preset = presets.find(p => p.id === id)
          changeConnection(defaultAtlasImageConnection(id === '$current' ? globalConfig : preset?.config, id))
        }} className="rounded border border-border bg-bg-base px-2 py-1"><option value="">选择已有连接预设</option>
          <option value="$current">当前写作连接（随写作连接变化）</option>
          {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>图片接口 <select aria-label="地图图片接口" value={connection.protocol} disabled={busy} onChange={event => changeConnection({ ...connection,
          protocol: event.target.value as AtlasImageConnection['protocol'], capability: 'unknown' })} className="rounded border border-border bg-bg-base px-2 py-1">
          <option value="agnes">Agnes 参考图</option><option value="openai-edit">OpenAI 兼容图片编辑</option><option value="gemini-interactions">Gemini 原生 Interactions</option></select></label>
        <label>图片模型 <input aria-label="绘画底图模型" value={connection.model} disabled={busy} className="w-52 rounded border border-border bg-bg-base px-2 py-1"
          onChange={event => changeConnection({ ...connection, model: event.target.value, capability: 'unknown' })}/></label>
        <label>连接能力 <select aria-label="地图图片能力" value={connection.capability} disabled={busy} onChange={event => changeConnection({ ...connection,
          capability: event.target.value as AtlasImageConnection['capability'] })} className="rounded border border-border bg-bg-base px-2 py-1">
          <option value="unknown">尚未确认</option><option value="text">仅文本</option><option value="vision">仅看图／理解图片</option>
          <option value="text-to-image">仅文生图</option><option value="reference-image">支持参考图重绘</option></select></label>
        <button type="button" disabled={busy || restoring || !!problem || !!candidate || fingerprint?.key !== key} onClick={() => { void generate() }}>{busy ? '正在处理…' : '生成增强候选'}</button>
        {busy && controller.current && <button type="button" onClick={() => controller.current?.abort(Error('已停止等待。服务端可能仍在处理，请核对后再重试。'))}>停止等待</button>}
      </div>
      <p className="mt-2 text-xs text-text-muted">{problem || '使用所选连接与型号生成一次参考图候选，可能消耗该服务额度。结果由你核对后使用，不自动重发。'} 图片连接可与写作连接不同；新连接请先在模型设置中保存为预设。</p>
    </details>
    <div className="mt-2 flex flex-wrap items-center gap-4">
      <label className="cursor-pointer">导入底图或底图包<input aria-label="导入绘画底图" type="file" accept="image/png,image/jpeg,image/webp,.json" className="sr-only" disabled={busy || restoring} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy || fingerprint?.key !== key) return
        const ticket = ++epoch.current; setError(''); setBusy(true)
        try {
          const legacyHash = await atlasPaintGeometryHash(geometry, seed)
          let art = await readAtlasPaintFile(file, legacyHash, geometry, { terrainHash: fingerprint.hash, style, symbols })
          if (art.version === 1 && !file.name.toLowerCase().endsWith('.json')) art = { ...art, version: 2, geometryHash: fingerprint.hash, style, symbols, rendering: 'masked-v2',
            source: { provider: 'import', model: '本地图片', createdAt: Date.now(), promptRevision: ATLAS_PAINT_REVISION } }
          await prepare(art, ticket)
        } catch (cause) { if (epoch.current === ticket) setError(cause instanceof Error ? cause.message : String(cause)) }
        finally { if (epoch.current === ticket) setBusy(false) }
      }}/></label>
      {accepted && <><button type="button" onClick={() => exportPackage(accepted.art)}>导出底图包</button><button type="button" disabled={busy} onClick={() => { void remove() }}>移除增强图</button></>}
    </div>
    {stale && <div role="status" className="mt-2 text-amber-500">地形已变更，旧增强图已暂停使用，当前显示程序地图。可重新生成候选，或先<button onClick={() => exportPackage(stale)}>导出旧底图包</button><button disabled={busy} onClick={() => { void remove() }}>移除旧图</button>。</div>}
    {accepted?.art.version === 1 && <p className="mt-2 text-xs text-text-muted">旧版底图的山林和水面已合在图片内，仅本次查看；可导出保留。移除后恢复独立图层。</p>}
    {accepted?.art.version === 2 && <p className="mt-2 text-xs text-text-muted">山林与地貌按原范围合成，可分别筛选；模型细节仍需核对。本机缓存用于恢复查看，底图包用于备份或换设备。</p>}
    {error && <p role="alert" className="mt-2 text-red-400">{error}
      {ownerKey && !accepted && !stale && <button type="button" disabled={busy} onClick={() => { void remove() }}>清除本机查看缓存</button>}</p>}
    {candidate && <div className="mt-3"><p>比较原版与增强候选。文字、道路、河流和城镇仍由程序绘制，图片不会修改世界设定。</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2"><figure><figcaption>程序原版</figcaption><img src={candidate.original} alt="程序地图原版" className="max-h-72 max-w-full"/></figure>
        <figure><figcaption>AI 增强候选（已约束地貌范围）</figcaption><img src={candidate.preview} alt="带程序文字的绘画底图候选" className="max-h-72 max-w-full"/></figure></div>
      <div className="mt-2 flex gap-4"><button type="button" disabled={busy} onClick={() => { void adoptCandidate() }}>使用此底图</button><button type="button" onClick={() => setCandidate(undefined)}>放弃候选</button>
        <button type="button" onClick={() => download(new Blob([JSON.stringify(candidate.art)], { type: 'application/json' }), '世界地图-增强候选.json')}>导出候选包</button></div>
    </div>}
  </section>
}
