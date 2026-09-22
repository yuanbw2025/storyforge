import { useEffect, useMemo, useState } from 'react'
import { Image, Loader2, Upload, WandSparkles } from 'lucide-react'
import {
  authorizeTextOpenWorldCreatorMediaV1,
  importTextOpenWorldCreatorMediaBlobV1,
  inspectTextOpenWorldCreatorMediaWorkspaceV1,
  previewTextOpenWorldCreatorMediaV1,
} from '../../lib/product-production/service'
import type {
  TextOpenWorldCreatorMediaPreparationV1,
  TextOpenWorldCreatorMediaWorkspaceV1,
} from '../../lib/open-world/creator-media'
import type {
  TextOpenWorldCreatorMediaModeV1,
  TextOpenWorldCreatorMediaRightsBasisV1,
} from '../../lib/open-world/creator-media-contract'
import type { WorkspaceScope } from '../../lib/types'

interface ImportedSlotV1 {
  blobObjectId: number
  fileName: string
  contentHash: string
  mimeType: string
  byteSize: number
  width: number
  height: number
}

const ACKNOWLEDGEMENTS = [
  ['completeBundle', '本次会整体替换头像与场景背景，不保留半套混合结果。'],
  ['rightsAndProvenance', '我已核对来源、许可与权利说明，并授权用于本产品。'],
  ['costAndProvider', '我已核对 Provider 与费用上限；本地导入不会调用图片模型。'],
  ['oldBuildImmutable', '我理解系统会创建新的子 Build，旧 Build、Release 与存档保持不变。'],
] as const

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

export interface TextOpenWorldCreatorMediaStudioProps {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  disabled?: boolean
  onChanged?: () => void | Promise<void>
}

export default function TextOpenWorldCreatorMediaStudio(
  props: TextOpenWorldCreatorMediaStudioProps,
) {
  const [workspace, setWorkspace] = useState<TextOpenWorldCreatorMediaWorkspaceV1 | null>(null)
  const [mode, setMode] = useState<TextOpenWorldCreatorMediaModeV1>('author-import')
  const [maximumCostUsd, setMaximumCostUsd] = useState('1.00')
  const [imports, setImports] = useState<Record<string, ImportedSlotV1>>({})
  const [source, setSource] = useState('作者提供')
  const [license, setLicense] = useState('仅授权用于当前 StoryForge 产品')
  const [rightsBasis, setRightsBasis] = useState<TextOpenWorldCreatorMediaRightsBasisV1>('author-owned')
  const [rightsNote, setRightsNote] = useState('我拥有或已取得这些图片用于当前产品的必要权利。')
  const [prepared, setPrepared] = useState<TextOpenWorldCreatorMediaPreparationV1 | null>(null)
  const [acknowledgement, setAcknowledgement] = useState<Record<(typeof ACKNOWLEDGEMENTS)[number][0], boolean>>({
    completeBundle: false,
    rightsAndProvenance: false,
    costAndProvider: false,
    oldBuildImmutable: false,
  })
  const [busyKey, setBusyKey] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setWorkspace(null)
    setPrepared(null)
    setImports({})
    setError('')
    void inspectTextOpenWorldCreatorMediaWorkspaceV1({
      scope: props.scope,
      productionId: props.productionId,
      buildId: props.buildId,
    }).then(value => {
      if (active) setWorkspace(value)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [props.buildId, props.productionId, props.scope])

  const resetPreview = () => {
    setPrepared(null)
    setMessage('')
  }
  const allAcknowledged = ACKNOWLEDGEMENTS.every(([key]) => acknowledgement[key])
  const importsComplete = workspace != null && workspace.slots.every(slot => imports[slot.artifactKey])
  const canPreview = mode === 'provider-generate'
    ? Number.isFinite(Number(maximumCostUsd)) && Number(maximumCostUsd) > 0
    : importsComplete && Boolean(source.trim() && license.trim() && rightsNote.trim())

  const estimated = useMemo(() => prepared?.mediaPlan.estimatedRerunBudget ?? null, [prepared])

  const chooseFile = async (artifactKey: string, file: File | null) => {
    resetPreview()
    if (!file) {
      setImports(current => {
        const next = { ...current }
        delete next[artifactKey]
        return next
      })
      return
    }
    setBusyKey(`file:${artifactKey}`)
    setError('')
    try {
      const stored = await importTextOpenWorldCreatorMediaBlobV1({
        scope: props.scope,
        data: await file.arrayBuffer(),
      })
      setImports(current => ({
        ...current,
        [artifactKey]: { ...stored, fileName: file.name },
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyKey('')
    }
  }

  const preview = async () => {
    if (!workspace || !canPreview) return
    setBusyKey('preview')
    setError('')
    setMessage('')
    try {
      const value = await previewTextOpenWorldCreatorMediaV1({
        scope: props.scope,
        productionId: props.productionId,
        buildId: props.buildId,
        mode,
        maximumCostUsd: mode === 'provider-generate' ? Number(maximumCostUsd) : undefined,
        imports: mode === 'author-import' ? workspace.slots.map(slot => ({
          artifactKey: slot.artifactKey,
          slotKey: slot.slotKey,
          blobObjectId: imports[slot.artifactKey]!.blobObjectId,
          name: imports[slot.artifactKey]!.fileName,
          altText: slot.altText,
          source,
          license,
          rightsBasis,
          rightsNote,
        })) : undefined,
      })
      setPrepared(value)
      setAcknowledgement({
        completeBundle: false,
        rightsAndProvenance: false,
        costAndProvider: false,
        oldBuildImmutable: false,
      })
      setMessage('媒资计划已冻结预览；完成四项确认后才能创建子 Build。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyKey('')
    }
  }

  const authorize = async () => {
    if (!prepared || !allAcknowledged) return
    setBusyKey('authorize')
    setError('')
    try {
      const receipt = await authorizeTextOpenWorldCreatorMediaV1({ prepared, acknowledgement })
      if (!receipt.ok) throw new Error(String(receipt.result.message ?? receipt.errorCode ?? '媒资授权失败'))
      setMessage(`已创建媒资子 Build #${prepared.mediaPlan.targetBuildNumber}，可以继续自动制作。`)
      setPrepared(null)
      await props.onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyKey('')
    }
  }

  return <section className="mt-5 rounded border border-border bg-bg-elevated p-5" data-testid="text-open-world-creator-media-studio">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <span className="flex items-center gap-2"><Image className="h-4 w-4 text-accent" /><h2 className="text-sm font-semibold">正式媒资工作区</h2></span>
        <p className="mt-2 max-w-3xl text-[10px] leading-5 text-text-muted">首版固定为程序 SVG 地图、完整头像/场景背景包与静音音频降级。替换媒资始终创建新 Build，不改写正在游玩的版本。</p>
      </div>
      {workspace && <code className="text-[9px] text-text-muted">Build #{workspace.buildNumber} · {shortHash(workspace.mediaRequirementsHash)}</code>}
    </div>
    {error && <p role="alert" className="mt-3 rounded border border-error/30 bg-error/5 p-3 text-[10px] text-error">{error}</p>}
    {!workspace && !error && <p className="mt-3 flex items-center gap-2 text-[10px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />读取冻结媒资需求…</p>}
    {workspace && <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" aria-pressed={mode === 'author-import'} onClick={() => { setMode('author-import'); resetPreview() }} className={`rounded border p-3 text-left text-xs ${mode === 'author-import' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-bg-base'}`}><Upload className="mb-2 h-4 w-4" /><strong className="block">作者导入完整图片包</strong><span className="mt-1 block text-[9px] text-text-muted">本地验真，不调用模型，不产生媒资费用。</span></button>
        <button type="button" aria-pressed={mode === 'provider-generate'} onClick={() => { setMode('provider-generate'); resetPreview() }} className={`rounded border p-3 text-left text-xs ${mode === 'provider-generate' ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-bg-base'}`}><WandSparkles className="mb-2 h-4 w-4" /><strong className="block">AI 生成完整图片包</strong><span className="mt-1 block text-[9px] text-text-muted">复用全局 Agnes 或可信 Relay，并冻结费用上限。</span></button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {workspace.slots.map((slot, index) => {
          const current = workspace.currentAssets[index]
          const imported = imports[slot.artifactKey]
          return <article key={slot.artifactKey} className="rounded border border-border bg-bg-base p-3 text-[10px]">
            <span className="flex items-center justify-between gap-2"><strong>{slot.slotKind === 'character-portrait' ? '角色头像' : '场景背景'} · {slot.title}</strong><code>{slot.width}×{slot.height}</code></span>
            <p className="mt-2 text-text-muted">槽位 {slot.slotKey} · 当前 {current?.source ?? 'unknown'} · {current?.license ?? 'unknown'}</p>
            {mode === 'author-import' && <label className="mt-3 block rounded border border-dashed border-border p-3">
              <span className="block text-text-muted">选择 PNG / JPEG / WebP</span>
              <input className="mt-2 block w-full text-[10px]" type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(props.disabled || busyKey)} onChange={event => void chooseFile(slot.artifactKey, event.currentTarget.files?.[0] ?? null)} />
              {busyKey === `file:${slot.artifactKey}` ? <span className="mt-2 flex items-center gap-1 text-accent"><Loader2 className="h-3 w-3 animate-spin" />校验并保存…</span> : imported ? <span className="mt-2 block text-success">{imported.fileName} · {imported.width}×{imported.height} · {(imported.byteSize / 1024).toFixed(1)} KiB</span> : null}
            </label>}
          </article>
        })}
      </div>
      {mode === 'author-import' ? <div className="mt-4 grid gap-3 rounded border border-border bg-bg-base p-4 md:grid-cols-2">
        <label className="text-[10px]">来源<input value={source} maxLength={1000} onChange={event => { setSource(event.target.value); resetPreview() }} className="mt-1 w-full rounded border border-border bg-bg-elevated p-2" /></label>
        <label className="text-[10px]">许可/授权名称<input value={license} maxLength={500} onChange={event => { setLicense(event.target.value); resetPreview() }} className="mt-1 w-full rounded border border-border bg-bg-elevated p-2" /></label>
        <label className="text-[10px]">权利依据<select value={rightsBasis} onChange={event => { setRightsBasis(event.target.value as TextOpenWorldCreatorMediaRightsBasisV1); resetPreview() }} className="mt-1 w-full rounded border border-border bg-bg-elevated p-2"><option value="author-owned">作者自有</option><option value="licensed">已获许可</option><option value="public-domain">公有领域</option></select></label>
        <label className="text-[10px]">权利说明<textarea value={rightsNote} maxLength={2000} rows={3} onChange={event => { setRightsNote(event.target.value); resetPreview() }} className="mt-1 w-full rounded border border-border bg-bg-elevated p-2" /></label>
      </div> : <label className="mt-4 block max-w-sm text-[10px]">本次图片包最高费用（USD）<input type="number" min="0.01" max="1000000" step="0.01" value={maximumCostUsd} onChange={event => { setMaximumCostUsd(event.target.value); resetPreview() }} className="mt-1 w-full rounded border border-border bg-bg-base p-2" /><span className="mt-1 block text-text-muted">这是硬上限，不是预估账单；Provider 未回传确定费用时会进入人工恢复。</span></label>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={Boolean(props.disabled || busyKey || !canPreview)} onClick={() => void preview()} className="rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent disabled:opacity-40">{busyKey === 'preview' ? '验证中…' : '预览媒资子 Build'}</button><span className="text-[9px] text-text-muted">地图：程序生成已覆盖 · 音频：静音降级</span></div>
      {prepared && estimated && <div className="mt-4 rounded border border-accent/30 bg-accent/5 p-4" data-testid="creator-media-plan-preview">
        <h3 className="text-xs font-semibold">Build #{prepared.mediaPlan.targetBuildNumber} 冻结预览</h3>
        <p className="mt-2 text-[10px] leading-5 text-text-muted">模式 {prepared.mediaPlan.mode} · Provider {prepared.mediaPlan.capability.adapterId} · 重做 {prepared.mediaPlan.staleTaskKeys.join('、')} · 复用 {prepared.mediaPlan.reuseTaskKeys.length} 个任务 · 媒资调用 {estimated.mediaCalls} · 最高费用 ${estimated.maximumCostUsd?.toFixed(2) ?? '未封顶'}</p>
        <fieldset className="mt-3 grid gap-2"><legend className="text-[10px] font-semibold">作者确认</legend>{ACKNOWLEDGEMENTS.map(([key, label]) => <label key={key} className="flex items-start gap-2 text-[10px] text-text-muted"><input type="checkbox" checked={acknowledgement[key]} onChange={event => setAcknowledgement(current => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>)}</fieldset>
        <button type="button" disabled={Boolean(props.disabled || busyKey || !allAcknowledged)} onClick={() => void authorize()} className="mt-4 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">{busyKey === 'authorize' ? '创建中…' : '确认并创建媒资子 Build'}</button>
      </div>}
      {message && <p role="status" className="mt-3 rounded border border-success/30 bg-success/5 p-3 text-[10px] text-success">{message}</p>}
    </>}
  </section>
}
