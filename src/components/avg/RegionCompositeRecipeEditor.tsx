import { useEffect, useRef, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgMediaReferenceV2 } from '../../lib/avg/media-reference-contract-v2'
import type { AvgVisualRawReuseSourceV5 } from '../../lib/avg/visual-image-reuse-contract'
import { AVG_REGION_COMPOSITE_ALGORITHM_V1, parseAvgImageRegionCompositeRecipeV3, deriveAvgRegionCompositeGeometryV1,
  type AvgImageRegionCompositeRecipeV3, type AvgRegionRectV1 } from '../../lib/avg/image-region-composite-contract'
import type { readAvgRegionEditorImagesV1, previewAvgRegionEditorV1 } from '../../lib/avg/image-region-editor-preview'
import RegionCompositeImageEditor from './RegionCompositeImageEditor'

type Images = Awaited<ReturnType<typeof readAvgRegionEditorImagesV1>>
type Trial = Awaited<ReturnType<typeof previewAvgRegionEditorV1>>
const blank = (): AvgRegionRectV1 => ({ x: 0, y: 0, width: 0, height: 0 })
const identity = (ref: AvgMediaReferenceV2) => `${ref.assetKey}:${ref.assetVersion}:${ref.contentHash}`

export default function RegionCompositeRecipeEditor({ scope, references, source, recipe, disabled, onChange, onValid, onPending }: {
  scope: WorkspaceScope; references: AvgMediaReferenceV2[]; source?: AvgVisualRawReuseSourceV5; recipe: AvgImageRegionCompositeRecipeV3 | null;
  disabled: boolean; onChange: (recipe: AvgImageRegionCompositeRecipeV3) => void; onValid: (valid: boolean) => void; onPending: (pending: boolean) => void
}) {
  const options = references.filter(ref => ref.purpose === 'identity' && ref.generatedSource && ref.providerInputAllowed && ref.derivativeUseAllowed)
  const savedIdentity = recipe ? `${recipe.baseReference.assetKey}:${recipe.baseReference.assetVersion}:${recipe.baseReference.contentHash}` : ''
  const [selected, setSelected] = useState(savedIdentity || (options[0] ? identity(options[0]) : ''))
  const [images, setImages] = useState<Images | null>(null), [urls, setUrls] = useState<{ raw: string; base: string } | null>(null)
  const [loadError, setLoadError] = useState(''), [trialError, setTrialError] = useState(''), [loading, setLoading] = useState(false)
  const [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [trial, setTrial] = useState<Trial | null>(null), [trialUrl, setTrialUrl] = useState('')
  const running = useRef<AbortController | null>(null), callback = useRef(onValid), pendingCallback = useRef(onPending); callback.current = onValid; pendingCallback.current = onPending
  const optionJson = JSON.stringify(options), sourceJson = JSON.stringify(source ?? null), scopeJson = JSON.stringify(scope)
  const reference = options.find(ref => identity(ref) === selected), referenceJson = JSON.stringify(reference ?? null), recipeJson = JSON.stringify(recipe)
  useEffect(() => {
    const next = JSON.parse(optionJson) as AvgMediaReferenceV2[]
    if (!next.some(ref => identity(ref) === selected)) setSelected(next.find(ref => identity(ref) === savedIdentity) ? savedIdentity : next[0] ? identity(next[0]) : '')
  }, [optionJson, selected, savedIdentity])
  useEffect(() => {
    let active = true; setImages(null); setLoadError(''); setLoading(false)
    if (sourceJson === 'null' || referenceJson === 'null') return
    setLoading(true)
    void import('../../lib/avg/image-region-editor-preview').then(api => api.readAvgRegionEditorImagesV1({ scope: JSON.parse(scopeJson),
      source: JSON.parse(sourceJson), reference: JSON.parse(referenceJson) })).then(value => { if (active) setImages(value) })
      .catch(error => { if (active) setLoadError(error instanceof Error ? error.message : '无法读取这两张图') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [scopeJson, sourceJson, referenceJson])
  useEffect(() => {
    if (!images) { setUrls(null); return }
    const raw = URL.createObjectURL(new Blob([images.raw.data], { type: images.raw.asset.mimeType })), base = URL.createObjectURL(new Blob([images.base.data], { type: images.base.asset.mimeType }))
    setUrls({ raw, base }); return () => { URL.revokeObjectURL(raw); URL.revokeObjectURL(base) }
  }, [images])
  useEffect(() => { running.current?.abort(); running.current = null; setBusy(false); setTrial(null); setTrialError('') }, [recipeJson, scopeJson, sourceJson, referenceJson])
  useEffect(() => () => { running.current?.abort() }, [])
  useEffect(() => {
    if (!trial) { setTrialUrl(''); return }
    const url = URL.createObjectURL(new Blob([trial.data], { type: 'image/png' })); setTrialUrl(url); return () => URL.revokeObjectURL(url)
  }, [trial])
  const matches = !!recipe && savedIdentity === selected && !!images && recipe.width === images.base.width && recipe.height === images.base.height
  let validation = ''
  if (recipe) { try { parseAvgImageRegionCompositeRecipeV3(recipe); if (images) deriveAvgRegionCompositeGeometryV1(recipe, images.raw.width, images.raw.height) }
    catch (error) { validation = error instanceof Error ? error.message : '区域配置不完整' } }
  const valid = matches && !loading && !loadError && !validation
  useEffect(() => { callback.current(valid); return () => callback.current(false) }, [valid])
  const pendingBase = !disabled && !!recipe && savedIdentity !== selected
  useEffect(() => { pendingCallback.current(pendingBase); return () => pendingCallback.current(false) }, [pendingBase])
  const selectedRegion = recipe?.regions[index]
  const editRegion = (side: 'source' | 'target', rect: AvgRegionRectV1) => {
    if (!recipe || !matches || disabled) return
    onChange({ ...recipe, regions: recipe.regions.map((region, i) => i === index ? { ...region, [side]: rect } : region) })
  }
  const begin = () => {
    if (!images || !reference || disabled) return
    onChange({ schema: 'storyforge.avg.image-processing-recipe', version: 3, algorithm: AVG_REGION_COMPOSITE_ALGORITHM_V1,
      width: images.base.width, height: images.base.height, baseReference: { assetKey: reference.assetKey, assetVersion: reference.assetVersion, contentHash: reference.contentHash },
      regions: [], alphaPolicy: 'preserve-base-alpha', declaration: recipe?.declaration ?? '' }); setIndex(0)
  }
  const preview = async () => {
    if (!valid || !recipe || !images || busy || running.current || disabled) return
    const controller = new AbortController(); running.current = controller; setBusy(true); setTrialError(''); setTrial(null)
    try { const api = await import('../../lib/avg/image-region-editor-preview'), output = await api.previewAvgRegionEditorV1({ scope, recipe, sourceRead: images.sourceRead, signal: controller.signal })
      if (!controller.signal.aborted && running.current === controller) setTrial(output)
    } catch (error) { if (!controller.signal.aborted && running.current === controller) setTrialError(error instanceof Error ? error.message : '本地试算失败') }
    finally { if (running.current === controller) { running.current = null; setBusy(false) } }
  }
  return <section aria-label="局部表情区域编辑" style={{ gridColumn: '1 / -1', minWidth: 0 }}><h6>保留立绘，只替换局部表情</h6>
    <p>选用原图实际参考过的已采用立绘，在两图上分别拖出需要取用和替换的区域。身体、画布、透明度和区域外像素保持；试算仅在内存中显示，保存后仍须明确开始制作、独立评审和选用。</p>
    {!source ? <p>请先为本项沿用已保存原图，再配置局部表情。</p> : !options.length ? <p>本项没有可用于局部表情的已采用身份底图。</p> : <>
      <label>已采用身份底图<select aria-label="已采用身份底图" disabled={disabled || busy} value={selected} onChange={event => setSelected(event.target.value)}>
        {options.map((ref, i) => <option key={identity(ref)} value={identity(ref)}>身份底图 {i + 1} · v{ref.assetVersion}</option>)}
      </select></label>
      {loading && <p role="status">正在核对原图、底图与使用范围…</p>}{loadError && <p role="alert">{loadError}</p>}
      {!!images && <p>原图：{images.raw.asset.name}；底图：{images.base.asset.name}。</p>}
      {!matches && <button className="lf-action" disabled={!images || disabled || loading || busy} onClick={begin}>{recipe ? '以此底图重新配置区域' : '使用此底图配置局部表情'}</button>}
      {!!recipe && matches && <>
        <p>至多4个区域，替换总面积不超过底图12%；各区域不能重叠。先添加区域，再在两图上拖动或填写百分比。</p>
        <label>当前编辑区域<select aria-label="当前编辑区域" disabled={disabled || !recipe.regions.length || busy} value={index} onChange={event => setIndex(Number(event.target.value))}>
          {recipe.regions.map((_, i) => <option key={i} value={i}>区域 {i + 1}</option>)}
        </select></label>
        <button className="lf-action" disabled={disabled || busy || recipe.regions.length >= 4} onClick={() => { onChange({ ...recipe, regions: [...recipe.regions, { source: blank(), target: blank(), featherPx: 0 }] }); setIndex(recipe.regions.length) }}>添加表情区域</button>
        <button className="lf-action" disabled={disabled || busy || !selectedRegion} onClick={() => { onChange({ ...recipe, regions: recipe.regions.filter((_, i) => i !== index) }); setIndex(Math.max(0, index - 1)) }}>移除此区域</button>
        {!!selectedRegion && <label>边缘羽化（像素）<input aria-label="边缘羽化（像素）" type="number" min={0} max={16} value={selectedRegion.featherPx} disabled={disabled || busy}
          onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) onChange({ ...recipe, regions: recipe.regions.map((region, i) => i === index ? { ...region, featherPx: value } : region) }) }} /></label>}
      </>}
      <button className="lf-action" disabled={!valid || busy || disabled} onClick={() => void preview()}>试算局部表情效果</button>
      {busy && <><p role="status">正在本机计算并独立复核…</p><button className="lf-action" onClick={() => { running.current?.abort(); running.current = null; setBusy(false); setTrial(null) }}>取消本地试算</button></>}
      {trialError && <p role="alert">{trialError}</p>}
      {!!images && !!urls && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: 12 }}>
        <RegionCompositeImageEditor label="原图取用" url={urls.raw} width={images.raw.width} height={images.raw.height} value={matches ? selectedRegion?.source : undefined}
          disabled={disabled || busy || !matches || !selectedRegion} onChange={rect => editRegion('source', rect)} />
        <RegionCompositeImageEditor label="底图替换" url={urls.base} width={images.base.width} height={images.base.height} value={matches ? selectedRegion?.target : undefined}
          disabled={disabled || busy || !matches || !selectedRegion} onChange={rect => editRegion('target', rect)} />
        <figure style={{ margin: 0, minWidth: 0 }}><p>本地试算 · {images.base.width} × {images.base.height}</p>
          {trial && trialUrl ? <><img src={trialUrl} alt="本地局部表情试算，尚未成为制作候选或采用" style={{ width: '100%', maxHeight: 600, objectFit: 'contain', background: '#c6c6c6' }} />
            <figcaption>{trial.receipt.preservation.changedPixelCount}个像素变化，区域外与全幅透明度保持。尚未保存为媒资、评审或采用。</figcaption></>
            : <div style={{ aspectRatio: `${images.base.width}/${images.base.height}`, background: '#e5e5e5', padding: 12 }}>填写区域及加工用途说明后，点击“试算局部表情效果”。</div>}
        </figure>
      </div>}
      {!!recipe && matches && validation && <p role="status">{validation}；请补全区域及加工用途说明。</p>}
    </>}
  </section>
}
