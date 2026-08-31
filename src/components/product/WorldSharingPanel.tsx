import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Download, FileJson, Loader2, ShieldCheck, Share2, Upload,
} from 'lucide-react'
import type { CommunityWorldLicense, Project } from '../../lib/types'
import {
  createWorldPackageV2,
  downloadWorldPackage,
  importWorldPackage,
  inspectWorldPackage,
  type WorldPackageTrustReport,
  type WorldPackageUse,
} from '../../lib/product/world-package'
import { migrateLegacyWorldPackageV1 } from '../../lib/product/world-package-migration'
import type { WorldRelease } from '../../lib/types'
import { resolveWorkspaceScope } from '../../lib/world-engine/ownership'
import { listWorldReleases } from '../../lib/world-engine/releases'

const LICENSE_OPTIONS: Array<{ value: CommunityWorldLicense; label: string }> = [
  { value: 'CC-BY-4.0', label: 'CC BY 4.0 · 署名' },
  { value: 'CC-BY-SA-4.0', label: 'CC BY-SA 4.0 · 署名相同方式共享' },
  { value: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0 · 署名非商业' },
  { value: 'ALL-RIGHTS-RESERVED', label: '保留所有权利 · 仅授权查看' },
]

const USE_OPTIONS: Array<{ id: WorldPackageUse; label: string }> = [
  { id: 'writing', label: '分步骤写作' },
  { id: 'ttrpg', label: '跑团' },
  { id: 'characterChat', label: '角色聊天' },
  { id: 'textGame', label: '文字游戏' },
]

interface Props {
  project?: Project
  onImported?: (projectId: number) => void
}

type Preview = { input: unknown; report: WorldPackageTrustReport }

export default function WorldSharingPanel({ project, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [authorName, setAuthorName] = useState('')
  const [license, setLicense] = useState<CommunityWorldLicense>('CC-BY-4.0')
  const [allowedUses, setAllowedUses] = useState<Record<WorldPackageUse, boolean>>({
    writing: true, ttrpg: true, characterChat: true, textGame: true,
  })
  const [warnings, setWarnings] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [latestRelease, setLatestRelease] = useState<WorldRelease | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!project?.id) { setLatestRelease(null); return }
    void resolveWorkspaceScope(project.id)
      .then(scope => listWorldReleases(scope))
      .then(releases => { if (!cancelled) setLatestRelease(releases[0] ?? null) })
      .catch(() => { if (!cancelled) setLatestRelease(null) })
    return () => { cancelled = true }
  }, [project?.id, project?.worldVersion])

  const publish = async () => {
    if (!project?.id) return
    setBusy(true); setMessage(null)
    try {
      const options = {
        authorName,
        license,
        allowedUses,
        contentWarnings: warnings.split(/[，,\n]/),
      }
      if (!latestRelease?.id) throw new Error('请先在世界引擎封存一个纯语义 WorldRelease。')
      const pkg = await createWorldPackageV2(latestRelease.id, options)
      downloadWorldPackage(pkg, `storyforge-world-${pkg.manifest.sourceWorldCode}-v${pkg.manifest.sourceWorldVersion}.json`)
      setMessage('纯语义世界分享包已生成；不包含任何产品制作、媒资或运行记录。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成分享包失败。')
    } finally { setBusy(false) }
  }

  const choosePackage = async (file: File) => {
    setBusy(true); setMessage(null)
    try {
      const input: unknown = JSON.parse(await file.text())
      const report = await inspectWorldPackage(input)
      setPreview({ input, report })
      if (!report.valid) setMessage(report.errors.join('；'))
    } catch (error) {
      setPreview(null)
      setMessage(`无法读取分享包：${error instanceof Error ? error.message : 'JSON 格式错误'}`)
    } finally { setBusy(false) }
  }

  const importPackage = async () => {
    if (!preview?.report.importable) return
    setBusy(true); setMessage(null)
    try {
      const id = await importWorldPackage(preview.input)
      setMessage('已导入为新的本地世界副本，原有项目未被覆盖。')
      onImported?.(id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入世界分享包失败。')
    } finally { setBusy(false) }
  }

  const migratePackage = async () => {
    if (!preview?.report.migrationRequired) return
    setBusy(true); setMessage(null)
    try {
      const result = await migrateLegacyWorldPackageV1(preview.input)
      setMessage(result.productRecoveryProjectId == null
        ? '旧包已迁移为纯语义世界版本。'
        : '旧包已拆分：纯语义世界已封存，原产品/媒资内容已保存在独立恢复工作区。')
      onImported?.(result.semanticProjectId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '历史世界包迁移失败。')
    } finally { setBusy(false) }
  }

  return (
    <section className="sf-world-sharing" aria-label="世界发布与导入">
      <div className="sf-section-header">
        <div>
          <div className="sf-eyebrow">LOCAL PUBLISHING</div>
          <h2>发布与导入世界</h2>
        </div>
        <span className="sf-product-status-chip"><ShieldCheck className="h-3.5 w-3.5" />不上传 · 本地文件包</span>
      </div>
      <div className="sf-sharing-grid">
        <div className="sf-sharing-column">
          <div className="sf-sharing-title"><Share2 className="h-4 w-4" /><strong>生成世界分享包</strong></div>
          <p>{latestRelease ? `导出不可变版本 v${latestRelease.version} 的纯语义世界内容。` : '先在上方封存纯语义世界修订，才能生成分享包。'}产品制作、媒资、会话、API 配置和运行存档不会进入文件。</p>
          <label className="sf-sharing-label">作者署名<input value={authorName} onChange={event => setAuthorName(event.target.value)} placeholder="例如：林岚" /></label>
          <label className="sf-sharing-label">许可<select value={license} onChange={event => setLicense(event.target.value as CommunityWorldLicense)}>{LICENSE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <fieldset className="sf-sharing-fieldset"><legend>允许的二创用途</legend><div className="sf-sharing-checks">{USE_OPTIONS.map(option => <label key={option.id}><input type="checkbox" checked={allowedUses[option.id]} onChange={event => setAllowedUses(previous => ({ ...previous, [option.id]: event.target.checked }))} />{option.label}</label>)}</div></fieldset>
          <label className="sf-sharing-label">内容警告（可选）<input value={warnings} onChange={event => setWarnings(event.target.value)} placeholder="逗号分隔，例如：战争、灾难" /></label>
          <button className="sf-button sf-button-primary" onClick={() => void publish()} disabled={busy || !project?.id || !latestRelease?.id || !authorName.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}下载世界分享包
          </button>
        </div>
        <div className="sf-sharing-column sf-sharing-import">
          <div className="sf-sharing-title"><FileJson className="h-4 w-4" /><strong>导入本地世界包</strong></div>
          <p>先读取发布信息、许可、用途和完整性，再由你确认导入为新的本地世界副本。</p>
          <button className="sf-button sf-button-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="h-4 w-4" />选择世界分享包
          </button>
          <input ref={fileRef} className="sf-sharing-file" type="file" accept="application/json,.json" aria-label="选择世界分享包" onChange={event => { const file = event.target.files?.[0]; if (file) void choosePackage(file); event.target.value = '' }} />
          {preview && <WorldPackagePreview preview={preview} busy={busy} onImport={() => void importPackage()} onMigrate={() => void migratePackage()} />}
        </div>
      </div>
      {message && <p className="sf-product-message" role="status">{message}</p>}
    </section>
  )
}

function WorldPackagePreview({ preview, busy, onImport, onMigrate }: { preview: Preview; busy: boolean; onImport: () => void; onMigrate: () => void }) {
  const { report } = preview
  const manifest = report.manifest
  return (
    <div className={`sf-sharing-preview ${report.valid ? 'sf-sharing-preview-valid' : 'sf-sharing-preview-invalid'}`} data-testid="world-package-preview">
      <div className="sf-sharing-preview-heading">{report.valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}<strong>{report.valid ? '分享包预检通过' : '分享包预检未通过'}</strong></div>
      {manifest && <div className="sf-sharing-preview-meta"><strong>{manifest.name}</strong><span>{manifest.sourceWorldCode} · v{manifest.sourceWorldVersion}</span><span>作者：{manifest.authorName} · {manifest.license}</span><span>用途：{USE_OPTIONS.filter(option => manifest.allowedUses[option.id]).map(option => option.label).join('、')}</span>{manifest.contentWarnings.length > 0 && <span>警告：{manifest.contentWarnings.join('、')}</span>}</div>}
      {report.errors.map(error => <p key={error} className="sf-sharing-error">{error}</p>)}
      {report.warnings.map(warning => <p key={warning} className="sf-sharing-warning">{warning}</p>)}
      {report.importable && <button className="sf-button sf-button-primary" onClick={onImport} disabled={busy}><ShieldCheck className="h-4 w-4" />确认导入纯语义世界</button>}
      {report.migrationRequired && <button className="sf-button sf-button-primary" onClick={onMigrate} disabled={busy}><ShieldCheck className="h-4 w-4" />分类迁移并保留旧产品内容</button>}
    </div>
  )
}
