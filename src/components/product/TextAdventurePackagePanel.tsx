import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, FileArchive, Loader2, Trash2, Upload } from 'lucide-react'
import type { ProductRelease, WorkspaceScope } from '../../lib/types'
import {
  exportTextAdventureCommunityPackageV1,
  importTextAdventureCommunityPackageV1,
  MAXIMUM_TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_BYTES_V1,
  TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_EXTENSION_V1,
  textAdventureCommunityPackageFileNameV1,
  type TextAdventureCommunityCandidateDossierV1,
  type TextAdventureCommunityPackageV1,
} from '../../lib/adventure/community-package'
import {
  DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
  deleteImportedProductReleaseV1,
  listImportedProductReleasesV1,
  type DeleteImportedProductReleaseResultV1,
} from '../../lib/product-platform/distribution-bundle'
import { useDialog } from '../shared/Dialog'

export interface TextAdventurePackagePanelProps {
  scope: WorkspaceScope
  productReleaseId?: number | null
  onImported?: (result: {
    release: ProductRelease
    package: TextAdventureCommunityPackageV1
  }) => void | Promise<void>
  onDeleted?: (result: DeleteImportedProductReleaseResultV1) => void | Promise<void>
  exportPackage?: typeof exportTextAdventureCommunityPackageV1
  importPackage?: typeof importTextAdventureCommunityPackageV1
  listImportedReleases?: typeof listImportedProductReleasesV1
  deleteImportedRelease?: typeof deleteImportedProductReleaseV1
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function dossierCards(dossier: TextAdventureCommunityCandidateDossierV1) {
  return [
    ['最短路线', `${dossier.metrics.estimatedMinimumRouteMinutes.toFixed(1)} 分钟`],
    ['可见文本', `${dossier.metrics.minimumRouteTextUnits.toLocaleString()}–${dossier.metrics.maximumRouteTextUnits.toLocaleString()}`],
    ['路线 / 结局', `${dossier.metrics.routeCount} / ${dossier.metrics.reachableEndingCount}`],
    ['对白 / 决策', `${dossier.metrics.minimumRouteDialogueTurns} / ${dossier.metrics.minimumRouteStatefulDecisions}`],
    ['主线阶段 / 目标', `${dossier.metrics.mainQuestStageCount} / ${dossier.metrics.mainQuestObjectiveCount}`],
    ['大区 / 地点 / 场景', `${dossier.systems.regions} / ${dossier.systems.locations} / ${dossier.systems.scenes}`],
    ['支线 / 事件', `${dossier.systems.sideQuests} / ${dossier.systems.storylets}`],
    ['冻结插图', `${dossier.systems.mediaAssets}`],
    ['作者实测', `${Math.round(dossier.evidence.humanPlaytest.author.elapsedMs / 60_000)} 分钟 / ${dossier.evidence.humanPlaytest.author.meaningfulActionCount} 有效行动`],
    ['独立玩家实测', `${Math.round(dossier.evidence.humanPlaytest.independentPlayer.elapsedMs / 60_000)} 分钟 / ${dossier.evidence.humanPlaytest.independentPlayer.meaningfulActionCount} 有效行动`],
  ] as const
}

export default function TextAdventurePackagePanel(props: TextAdventurePackagePanelProps) {
  const dialog = useDialog()
  const [busy, setBusy] = useState<'export' | 'import' | 'delete' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [dossier, setDossier] = useState<TextAdventureCommunityCandidateDossierV1 | null>(null)
  const [importedReleases, setImportedReleases] = useState<ProductRelease[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (props.listImportedReleases ?? listImportedProductReleasesV1)({
      scope: props.scope,
      productType: 'text-adventure',
    }).then(rows => {
      if (!cancelled) setImportedReleases(rows)
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId, props.listImportedReleases])

  const runExport = async () => {
    if (!props.productReleaseId) return
    setBusy('export'); setError(''); setMessage('')
    try {
      const candidate = await (props.exportPackage ?? exportTextAdventureCommunityPackageV1)({
        scope: props.scope,
        productReleaseId: props.productReleaseId,
      })
      setDossier(candidate.dossier)
      const blob = new Blob([JSON.stringify(candidate, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = textAdventureCommunityPackageFileNameV1({
          title: candidate.dossier.title,
          releaseVersion: candidate.distributionBundle.productRelease.manifest.lineage.releaseVersion,
          candidatePackageHash: candidate.candidatePackageHash,
        })
        anchor.click()
      } finally {
        URL.revokeObjectURL(url)
      }
      setMessage('社区候选资格已离线复验，完整产品包已下载。下载不会自动公开作品。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const importFile = async (file: File) => {
    setBusy('import'); setError(''); setMessage('')
    try {
      if (!file.name.toLowerCase().endsWith(TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_EXTENSION_V1)) {
        throw new Error(`请选择 ${TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_EXTENSION_V1} 产品包。`)
      }
      if (file.size <= 0 || file.size > MAXIMUM_TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_BYTES_V1) {
        throw new Error(`产品包大小无效；上限为 ${Math.floor(MAXIMUM_TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_BYTES_V1 / 1024 / 1024)} MiB。`)
      }
      let parsed: unknown
      try { parsed = JSON.parse(await file.text()) } catch { throw new Error('产品包不是合法 JSON。') }
      const result = await (props.importPackage ?? importTextAdventureCommunityPackageV1)({
        scope: props.scope,
        package: parsed,
      })
      setImportedReleases(current => [
        result.release,
        ...current.filter(row => row.id !== result.release.id),
      ])
      setDossier(result.package.dossier)
      setMessage(`已复验并导入“${result.package.dossier.title}”；这是本地可玩副本，不代表远程作者身份或社区推荐。`)
      await props.onImported?.(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const deleteImportedRelease = async (release: ProductRelease) => {
    if (!release.id || !release.distributionProvenance) return
    if (!await dialog.confirm({
      title: '删除本地导入副本？',
      message: `将删除“${release.label}”及其全部本地存档。原创世界、其他 Release 和共享媒资不会被删除。`,
      confirmText: '删除副本',
      tone: 'danger',
    })) return
    setBusy('delete'); setError(''); setMessage('')
    try {
      const result = await (props.deleteImportedRelease ?? deleteImportedProductReleaseV1)({
        scope: props.scope,
        productReleaseId: release.id,
        confirmation: DELETE_IMPORTED_PRODUCT_RELEASE_CONFIRMATION_V1,
      })
      setImportedReleases(current => current.filter(row => row.id !== release.id))
      if (dossier?.releaseContentHash === release.contentHash) setDossier(null)
      setMessage(`已删除本地导入副本及 ${result.deletedSessionCount} 个存档；回收 ${result.reclaimedBlobObjectIds.length} 个无引用媒资对象，仍被其他产品引用的 ${result.retainedBlobObjectIds.length} 个已保留。`)
      await props.onDeleted?.(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return <section className="mb-5 rounded border border-border bg-bg-elevated p-5" data-testid="text-adventure-package-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <span className="flex items-center gap-2 text-sm font-semibold"><FileArchive className="h-4 w-4 text-accent" />完整产品包与社区候选档案</span>
        <p className="mt-2 max-w-3xl text-[10px] leading-5 text-text-muted">导出会重新核验商业 Brief、真实内容规模、自动游玩、作者与独立玩家双角色完整试玩、浏览器性能及全部冻结媒资；上传先离线复验，再原子写入当前 Work。两者都不会自动向社区公开。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!props.productReleaseId || busy != null} onClick={() => void runExport()} className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-4 py-2 text-xs text-accent disabled:opacity-40">
          {busy === 'export' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          复验并导出产品包
        </button>
        <button type="button" disabled={busy != null} onClick={() => inputRef.current?.click()} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">
          {busy === 'import' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          上传产品包
        </button>
        <input ref={inputRef} aria-label="上传文字冒险产品包" type="file" className="sr-only" accept={`${TEXT_ADVENTURE_COMMUNITY_PACKAGE_FILE_EXTENSION_V1},application/json`} onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importFile(file)
        }} />
      </div>
    </div>
    {!props.productReleaseId && <p className="mt-3 rounded border border-border bg-bg-base p-3 text-[10px] text-text-muted">当前没有可导出的正式文字冒险 Release；仍可上传其他作者交付的完整产品包并在本机游玩。</p>}
    {importedReleases.length > 0 && <div className="mt-4 rounded border border-border bg-bg-base p-3" data-testid="text-adventure-imported-release-copies">
      <strong className="text-[10px]">本地导入副本</strong>
      <p className="mt-1 text-[9px] leading-5 text-text-muted">删除仅作用于选定的导入 Release、由它创建的本地会话和产品私域媒资。原创世界、原创 Build/Release 以及仍被其他产品引用的 Blob 保持不变。</p>
      <ul className="mt-2 grid gap-2">{importedReleases.map(release => <li key={release.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2 text-[10px]"><span><strong>{release.label}</strong><code className="ml-2 text-[9px] text-text-muted">{compactHash(release.contentHash)}</code></span><button type="button" disabled={busy != null} onClick={() => void deleteImportedRelease(release)} className="flex items-center gap-1 rounded border border-error/40 bg-error/5 px-3 py-1.5 text-error disabled:opacity-40"><Trash2 className="h-3 w-3" />删除本地副本</button></li>)}</ul>
    </div>}
    {(message || error) && <div role={error ? 'alert' : 'status'} className={`mt-3 rounded border p-3 text-[10px] ${error ? 'border-error/30 bg-error/5 text-error' : 'border-success/30 bg-success/5 text-success'}`}>{error || message}</div>}
    {dossier && <div className="mt-4" data-testid="text-adventure-candidate-dossier">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2 text-xs font-semibold text-success"><CheckCircle2 className="h-4 w-4" />具备社区提交资格：{dossier.title}</span><code className="text-[9px] text-text-muted" title={dossier.releaseContentHash}>{compactHash(dossier.releaseContentHash)}</code></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{dossierCards(dossier).map(([label, value]) => <div key={label} className="rounded bg-bg-base p-3"><small className="block text-[9px] text-text-muted">{label}</small><strong className="mt-1 block text-xs">{value}</strong></div>)}</div>
      <p className="mt-3 text-[9px] leading-5 text-text-muted">本地资格通过不等于已获推荐；远程社区仍需作者显式提交和人工审核。候选包 <code>{compactHash(dossier.distributionBundleHash)}</code> · 纯文字降级可完整通关。</p>
    </div>}
  </section>
}
