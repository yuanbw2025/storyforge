import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileJson, Loader2, ShieldCheck, Share2, Upload } from 'lucide-react'
import type { CommunityWorldLicense, Project, WorldRelease } from '../../lib/types'
import {
  createWorldPackage, downloadWorldPackage, importWorldPackage, inspectWorldPackage,
  type WorldPackageManifest, type WorldPackageTrustReport, type WorldPackageUse,
} from '../../lib/world-engine/world-package'
import { exportOriginalWorldSourceWireV1, installWorldSourcePackageV1, listWorldSourceReceiptsV1 } from '../../lib/world-engine/source-receipt'
import { downloadTextFile } from '../../lib/export/text-export'
import { resolveWorkspaceScope } from '../../lib/workspace/ownership'
import { listWorldReleases } from '../../lib/world-engine/releases'

const LICENSE_OPTIONS: Array<{ value: CommunityWorldLicense; label: string }> = [
  { value: 'CC-BY-4.0', label: 'CC BY 4.0 · 署名' },
  { value: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0 · 署名相同方式共享' },
  { value: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0 · 署名非商业' },
  { value: 'ALL-RIGHTS-RESERVED', label: '保留所有权利 · 仅授权查看' },
]
const USE_OPTIONS: Array<{ id: WorldPackageUse; label: string }> = [
  { id: 'world-remix', label: '复制并改编世界' }, { id: 'ttrpg', label: '跑团' },
  { id: 'character-interaction', label: '角色互动' }, { id: 'ai-town', label: 'AI 小镇' },
  { id: 'text-adventure', label: '文字冒险' }, { id: 'avg', label: 'AVG' }, { id: 'text-open-world', label: '文字开放世界' },
]
interface Props { project?: Project; worldReleaseRevision?: number; onImported?: (projectId: number) => void | Promise<void> }
type Preview = { wire: string; report: WorldPackageTrustReport }
type SourceChoice = Awaited<ReturnType<typeof listWorldSourceReceiptsV1>>[number]
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export default function WorldSharingPanel({ project, worldReleaseRevision = 0, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const epoch = useRef(0), fileRequest = useRef(0), actionRequest = useRef(0)
  const projectId = project?.id ?? null, worldId = project?.activeWorldId ?? null
  const [authorName, setAuthorName] = useState('')
  const [license, setLicense] = useState<CommunityWorldLicense>('CC-BY-4.0')
  const [allowedUses, setAllowedUses] = useState<Record<WorldPackageUse, boolean>>({
    'world-remix': true, ttrpg: true, 'character-interaction': true, 'ai-town': true,
    'text-adventure': true, avg: true, 'text-open-world': true,
  })
  const [warnings, setWarnings] = useState('')
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false)
  const [message, setMessage] = useState<string | null>(null), [fileError, setFileError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [releases, setReleases] = useState<WorldRelease[]>([]), [releaseId, setReleaseId] = useState<number | null>(null)
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [sources, setSources] = useState<SourceChoice[]>([]), [selectedKey, setSelectedKey] = useState('')
  const [libraryRevision, setLibraryRevision] = useState(0), [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const latestRelease = releases.find(row => row.id === releaseId) ?? null
  const selected = sources.find(row => row.key === selectedKey) ?? null

  // Invalidate old owner/unmounted UI work before any queued acknowledgement can
  // update the new view. Accepted DB operations retain their captured old owner.
  useLayoutEffect(() => {
    epoch.current += 1; fileRequest.current += 1; actionRequest.current += 1
    setBusy(false); setReading(false); setPreview(null); setMessage(null); setFileError(null)
    setSources([]); setSelectedKey(''); setLibraryError(null); setReleases([]); setReleaseId(null); setReleaseError(null)
    return () => { epoch.current += 1; fileRequest.current += 1; actionRequest.current += 1 }
  }, [projectId, worldId])

  useEffect(() => {
    let cancelled = false
    const context = epoch.current
    if (projectId == null || worldId == null) return
    setReleaseError(null)
    void resolveWorkspaceScope(projectId).then(scope => {
      if (scope.worldId !== worldId) throw Error('所选世界已变化，请重新选择。')
      return listWorldReleases(scope)
    }).then(rows => {
      if (!cancelled && context === epoch.current) {
        setReleases(rows)
        setReleaseId(previous => rows.some(row => row.id === previous) ? previous : rows[0]?.id ?? null)
      }
    }).catch(cause => { if (!cancelled && context === epoch.current) setReleaseError(errorText(cause)) })
    return () => { cancelled = true }
  }, [projectId, worldId, worldReleaseRevision])

  useEffect(() => {
    let cancelled = false
    const context = epoch.current
    if (projectId == null || worldId == null) { setLibraryLoading(false); return }
    setLibraryLoading(true); setLibraryError(null)
    void listWorldSourceReceiptsV1({ projectId, worldId }).then(rows => {
      if (!cancelled && context === epoch.current) {
        setSources(rows)
        setSelectedKey(previous => rows.some(row => row.key === previous) ? previous : '')
      }
    }).catch(cause => {
      if (!cancelled && context === epoch.current) { setSources([]); setSelectedKey(''); setLibraryError(errorText(cause)) }
    }).finally(() => { if (!cancelled && context === epoch.current) setLibraryLoading(false) })
    return () => { cancelled = true }
  }, [projectId, worldId, worldReleaseRevision, libraryRevision])

  const beginAction = () => {
    const context = epoch.current, request = ++actionRequest.current
    setBusy(true); setMessage(null)
    return () => context === epoch.current && request === actionRequest.current
  }
  const publish = async () => {
    if (busy || projectId == null || !latestRelease?.id) return
    const selectedReleaseId = latestRelease.id
    const options = { authorName, license, allowedUses, contentWarnings: warnings ? warnings.split(/[，,\n]/) : [] }
    const current = beginAction()
    try {
      const pkg = await createWorldPackage(selectedReleaseId, options)
      if (!current()) return
      downloadWorldPackage(pkg, 'storyforge-world-' + pkg.manifest.sourceWorldCode + '-v' + pkg.manifest.sourceWorldVersion + '.json')
      setMessage('纯语义世界分享包已生成；不包含任何产品制作、媒资或运行记录。')
    } catch (error) { if (current()) setMessage(errorText(error)) }
    finally { if (current()) setBusy(false) }
  }
  const choosePackage = async (file: File) => {
    if (busy) return
    const context = epoch.current, request = ++fileRequest.current
    const current = () => context === epoch.current && request === fileRequest.current
    setReading(true); setPreview(null); setFileError(null); setMessage(null)
    try {
      if (file.size > 32 * 1024 * 1024) throw Error('世界分享包超过 32 MiB 文件预算。')
      const wire = await file.text()
      if (!current()) return
      const input: unknown = JSON.parse(wire), report = await inspectWorldPackage(input)
      if (current()) setPreview({ wire, report })
    } catch (error) { if (current()) setFileError('无法读取分享包：' + errorText(error)) }
    finally { if (current()) setReading(false) }
  }
  const installReadonly = async () => {
    if (busy || reading || !preview?.report.importable || projectId == null || worldId == null) return
    const captured = preview, owner = { projectId, worldId }, current = beginAction()
    try {
      await installWorldSourcePackageV1(owner, captured.wire)
      if (!current()) return
      setMessage('已保存只读来源；世界内容未改写，也未开始产品制作。')
      setPreview(previous => previous === captured ? null : previous)
      setLibraryRevision(value => value + 1)
    } catch (error) { if (current()) setMessage(errorText(error)) }
    finally { if (current()) setBusy(false) }
  }
  const importPackage = async () => {
    if (busy || reading || !preview?.report.importable || preview.report.manifest?.allowedUses['world-remix'] !== true) return
    const captured = preview, current = beginAction()
    try {
      const id = await importWorldPackage(captured.wire)
      if (!current()) return
      setMessage('已导入为新的本地世界副本，原有项目未被覆盖。')
      setPreview(previous => previous === captured ? null : previous)
      await onImported?.(id)
    } catch (error) { if (current()) setMessage(errorText(error)) }
    finally { if (current()) setBusy(false) }
  }
  const exportSource = async () => {
    if (busy || libraryLoading || !selected || projectId == null || worldId == null) return
    const choice = selected, owner = { projectId, worldId }, current = beginAction()
    try {
      const wire = await exportOriginalWorldSourceWireV1(owner, choice.declarationHash)
      if (!current()) return
      await downloadTextFile(wire, 'storyforge-source-' + choice.declaration.sourceWorldCode + '-v'
        + choice.declaration.sourceWorldVersion + '-' + choice.declarationHash.slice(0, 12) + '.json', 'application/json')
      if (current()) setMessage('所选原来源包已导出；保留原始署名、用途和警告，未重新署名打包。')
    } catch (error) { if (current()) setMessage(errorText(error)) }
    finally { if (current()) setBusy(false) }
  }

  return <section className="sf-world-sharing" aria-label="世界发布与导入">
    <div className="sf-section-header"><div><div className="sf-eyebrow">LOCAL PUBLISHING</div><h2>发布与导入世界</h2></div>
      <span className="sf-product-status-chip"><ShieldCheck className="h-3.5 w-3.5" />不上传 · 本地文件包</span></div>
    <div className="sf-sharing-grid">
      <div className="sf-sharing-column">
        <div className="sf-sharing-title"><Share2 className="h-4 w-4" /><strong>生成世界分享包</strong></div>
        <p>{latestRelease ? '导出不可变版本 v' + latestRelease.version + ' 的纯语义世界内容。' : '先在“版本与封存”发布世界版本，才能生成分享包。'}产品制作、媒资、会话、API 配置和运行存档不会进入文件。</p>
        <label className="sf-sharing-label">分享版本<select aria-label="分享世界版本" value={releaseId ?? ''} disabled={busy} onChange={event => setReleaseId(Number(event.target.value) || null)}><option value="">选择已发布版本</option>{releases.map(row => <option key={row.id} value={row.id}>v{row.version} · {row.label}</option>)}</select></label>
        <label className="sf-sharing-label">作者署名<input value={authorName} disabled={busy} onChange={event => setAuthorName(event.target.value)} placeholder="例如：林岚" /></label>
        <label className="sf-sharing-label">许可<select value={license} disabled={busy} onChange={event => setLicense(event.target.value as CommunityWorldLicense)}>{LICENSE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <fieldset className="sf-sharing-fieldset" disabled={busy}><legend>允许的二创用途</legend><div className="sf-sharing-checks">{USE_OPTIONS.map(option => <label key={option.id}><input type="checkbox" checked={allowedUses[option.id]} onChange={event => setAllowedUses(previous => ({ ...previous, [option.id]: event.target.checked }))} />{option.label}</label>)}</div></fieldset>
        <label className="sf-sharing-label">内容警告（可选）<input value={warnings} disabled={busy} onChange={event => setWarnings(event.target.value)} placeholder="逗号分隔，例如：战争、灾难" /></label>
        <p>最多 12 条，每条最多 200 字；超出时会保留输入并提示，不生成文件。</p>
        {releaseError && <p className="sf-sharing-error" role="alert">{releaseError}</p>}
        <button className="sf-button sf-button-primary" onClick={() => void publish()} disabled={busy || projectId == null || !latestRelease?.id || !authorName.trim()}><Download className="h-4 w-4" />下载世界分享包</button>
      </div>
      <div className="sf-sharing-column sf-sharing-import">
        <div className="sf-sharing-title"><FileJson className="h-4 w-4" /><strong>导入本地世界包</strong></div>
        <p>先核对原始署名、许可和逐项用途。可将来源只读保存到当前世界；创建可编辑副本还需明确允许世界改编。</p>
        <button className="sf-button sf-button-secondary" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="h-4 w-4" />选择世界分享包</button>
        <input ref={fileRef} disabled={busy} className="sf-sharing-file" type="file" accept="application/json,.json" aria-label="选择世界分享包" onChange={event => { const file = event.target.files?.[0]; if (file) void choosePackage(file); event.target.value = '' }} />
        {reading && <p><Loader2 className="inline h-4 w-4 animate-spin" />正在读取并校验，可重新选择文件。</p>}
        {fileError && <p className="sf-sharing-error" role="alert">{fileError}</p>}
        {preview && <WorldPackagePreview preview={preview} busy={busy || reading} hasOwner={projectId != null && worldId != null} onReadonly={() => void installReadonly()} onImport={() => void importPackage()} />}
      </div>
    </div>
    <section className="sf-sharing-column" aria-label="已保存的只读来源">
      <h3>已保存的只读来源</h3>
      <p>同一世界版本的不同来源声明分别保留。请明确选择一份查看或导出；此处选择不开始产品制作，也不改变已有作品的来源。</p>
      {projectId == null || worldId == null ? <p>先选择一个本地世界，才能保存和查看它的只读来源。</p> : null}
      <label className="sf-sharing-label">来源声明<select aria-label="选择来源声明" value={selectedKey} disabled={busy || libraryLoading || projectId == null || worldId == null} onChange={event => setSelectedKey(event.target.value)}><option value="">请选择来源声明</option>{sources.map(choice => <option key={choice.key} value={choice.key}>{choice.declaration.authorName} · v{choice.declaration.sourceWorldVersion} · {choice.declarationHash.slice(0, 12)}</option>)}</select></label>
      {libraryLoading && <p>正在核验保存的原来源包…</p>}
      {libraryError && <p className="sf-sharing-error" role="alert">来源库校验失败：{libraryError}</p>}
      {!libraryLoading && !libraryError && projectId != null && sources.length === 0 && <p>当前世界尚未保存只读来源。</p>}
      {selected && <div data-testid="world-source-declaration"><SourceDeclarationDetails manifest={selected.declaration} /><small className="break-all">来源声明：{selected.declarationHash}</small></div>}
      <button className="sf-button sf-button-secondary" onClick={() => void exportSource()} disabled={busy || libraryLoading || !selected}><Download className="h-4 w-4" />下载所选原来源包</button>
    </section>
    {message && <p className="sf-product-message" role="status">{message}</p>}
  </section>
}

function SourceDeclarationDetails({ manifest }: { manifest: WorldPackageManifest }) {
  return <div className="sf-sharing-preview-meta">
    <strong>{manifest.name}</strong><span>{manifest.sourceWorldCode} · v{manifest.sourceWorldVersion}</span>
    <span>作者：{manifest.authorName} · {manifest.license}</span>
    <span>原始署名要求：</span><pre aria-label="来源署名要求" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{manifest.attribution || '未填写额外署名说明'}</pre>
    <div>{USE_OPTIONS.map(option => <div key={option.id}>{option.label}：{manifest.allowedUses[option.id] ? '允许' : '不允许'}</div>)}</div>
    {manifest.contentWarnings.length > 0 && <div>警告：<ul>{manifest.contentWarnings.map((warning, index) => <li key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{warning}</li>)}</ul></div>}
  </div>
}
function WorldPackagePreview({ preview, busy, hasOwner, onReadonly, onImport }: { preview: Preview; busy: boolean; hasOwner: boolean; onReadonly: () => void; onImport: () => void }) {
  const { report } = preview, manifest = report.manifest
  return <div className={'sf-sharing-preview ' + (report.valid ? 'sf-sharing-preview-valid' : 'sf-sharing-preview-invalid')} data-testid="world-package-preview">
    <div className="sf-sharing-preview-heading">{report.valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}<strong>{report.valid ? '分享包预检通过' : '分享包预检未通过'}</strong></div>
    {manifest && <SourceDeclarationDetails manifest={manifest} />}
    {report.errors.map(error => <p key={error} className="sf-sharing-error">{error}</p>)}
    {report.warnings.map(warning => <p key={warning} className="sf-sharing-warning">{warning}</p>)}
    {report.importable && <>
      <p>只读保存不会创建可编辑世界副本，也不会开始产品制作。{!hasOwner && '请先选择一个本地世界作为保存位置。'}</p>
      <button className="sf-button sf-button-secondary" onClick={onReadonly} disabled={busy || !hasOwner}><ShieldCheck className="h-4 w-4" />保存为只读来源</button>
      <p>{manifest?.allowedUses['world-remix'] ? '以下导入将创建新的可编辑世界副本，仍需通过来源校验。' : '原声明不允许复制并改编世界；仍可只读保存和查看原来源。'}</p>
      <button className="sf-button sf-button-primary" onClick={onImport} disabled={busy || manifest?.allowedUses['world-remix'] !== true}><ShieldCheck className="h-4 w-4" />确认导入纯语义世界</button>
    </>}
  </div>
}
