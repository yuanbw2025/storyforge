import { useCallback, useEffect, useState } from 'react'
import { Check, Download, FileJson, Lock, Printer, RefreshCw, X } from 'lucide-react'
import type {
  AdaptationProject,
  ComicMediaAsset,
  ComicVisualSubject,
  Work,
  WorkspaceScope,
  CreationReleaseV1,
} from '../../lib/types'
import type { ComicQualityReportV1 } from '../../lib/comic/qa'
import { listComicReleasesV1, publishComicReleaseV1 } from '../../lib/comic/release'
import { renderComicStoryboardTextV1 } from '../../lib/comic/renderers'
import type { ComicPageGroup, ComicStudioAction } from './studio-model'

interface Props {
  scope: WorkspaceScope
  work: Work
  adaptation: AdaptationProject & { medium: 'comic' }
  groups: ComicPageGroup[]
  subjects: ComicVisualSubject[]
  assets: ComicMediaAsset[]
  quality: ComicQualityReportV1 | null
  busy: boolean
  runQuality: () => Promise<void>
  exportArchive: (format: 'png-zip' | 'webp-zip' | 'cbz') => Promise<void>
  exportPdf: () => Promise<void>
  downloadText: (filename: string, content: string, type?: string) => void
  safeName: (value: string) => string
  act: ComicStudioAction
}

export default function ComicQaPanel({
  scope,
  work,
  adaptation,
  groups,
  subjects,
  assets,
  quality,
  busy,
  runQuality,
  exportArchive,
  exportPdf,
  downloadText,
  safeName,
  act,
}: Props) {
  const [releases, setReleases] = useState<CreationReleaseV1[]>([])
  const reloadReleases = useCallback(async () => setReleases(await listComicReleasesV1(scope)), [scope])
  useEffect(() => { void reloadReleases() }, [reloadReleases])
  const publish = async (tier: 'storyboard' | 'visual') => {
    await act(() => publishComicReleaseV1({ scope, expectedAdaptationRevision: adaptation.revision, tier }), tier === 'visual' ? '漫画视觉版已发布' : '漫画分镜版已发布')
    await reloadReleases()
  }
  return (
    <section className="comic-qa">
      <header>
        <div>
          <strong>确定性 QA</strong>
          <small>
            {quality
              ? `${quality.pageCount} 页 · ${quality.panelCount} 格 · ${quality.selectedPanelCount} 格已选片`
              : '点击重新检查生成报告'}
          </small>
        </div>
        <button onClick={() => void runQuality()}>
          <RefreshCw />
          重新检查
        </button>
      </header>
      {quality && (
        <>
          <div className={`comic-qa-summary ${quality.canStoryboardRelease ? 'valid' : 'invalid'}`}>
            {quality.canStoryboardRelease ? <Check /> : <X />}
            <strong>{quality.canStoryboardRelease ? '可发布专业分镜版' : '分镜版发布已阻止'}</strong>
            <span>
              视觉版{quality.canVisualRelease ? '已就绪' : `仍有 ${quality.visualBlockers.length} 项阻断`} · {quality.issues.filter((issue) => issue.level === 'warning').length} 个警告
            </span>
          </div>
          {!quality.canStoryboardRelease && <ul>{quality.storyboardBlockers.map((blocker, index) => <li key={`story-${index}`} className="error"><code>storyboard-gate</code><span>{blocker}</span></li>)}</ul>}
          <ul>
            {quality.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`} className={issue.level}>
                <code>{issue.code}</code>
                <span>{issue.message}</span>
                <small>{[issue.pageKey, issue.panelKey].filter(Boolean).join(' / ')}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="comic-export-grid">
        <button
          onClick={() => downloadText(
            `${safeName(work.title)}-分镜脚本.md`,
            renderComicStoryboardTextV1({
              title: work.title,
              targetSpec: adaptation.targetSpec,
              pages: groups.map((group) => ({ ...group, assetDataUrls: {} })),
            }),
          )}
        >
          <Download />
          分镜脚本
        </button>
        <button
          onClick={() => downloadText(
            `${safeName(work.title)}-结构.json`,
            JSON.stringify({
              version: 1,
              work: { title: work.title },
              adaptation: {
                targetSpec: adaptation.targetSpec,
                sourceManifestHash: adaptation.activeSourceManifestHash,
              },
              pages: groups,
              visualSubjects: subjects,
              mediaAssets: assets.map(({ blobObjectId: _blobObjectId, ...asset }) => asset),
            }, null, 2),
            'application/json;charset=utf-8',
          )}
        >
          <FileJson />
          结构 JSON
        </button>
        <button onClick={() => void exportArchive('png-zip')} disabled={busy}>
          <Download />
          PNG ZIP
        </button>
        <button onClick={() => void exportArchive('webp-zip')} disabled={busy}>
          <Download />
          WebP ZIP
        </button>
        <button onClick={() => void exportArchive('cbz')} disabled={busy}>
          <Download />
          CBZ
        </button>
        <button onClick={() => void exportPdf()} disabled={busy}>
          <Printer />
          PDF 打印
        </button>
        <button className="primary" onClick={() => void publish('storyboard')} disabled={busy || adaptation.status === 'complete' || !quality?.canStoryboardRelease}><Lock />发布不可变分镜版</button>
        <button className="primary" onClick={() => void publish('visual')} disabled={busy || adaptation.status === 'complete' || !quality?.canVisualRelease}><Lock />发布不可变视觉版</button>
      </div>
      <div className="comic-release-list">{releases.length ? releases.map(release => { let tier = '版本'; try { tier = JSON.parse(release.manifestJson).tier === 'visual' ? '视觉版' : '分镜版' } catch { /* read codec will expose corruption when opened */ } return <article key={release.id}><strong>v{release.version} · {tier} · {release.label}</strong><small>{new Date(release.createdAt).toLocaleString()} · {release.contentHash.slice(0, 12)}</small></article> }) : <p>尚无发布版本。发布后 manifest 与视觉 Blob（仅视觉版）都由 Release 强引用冻结。</p>}</div>
    </section>
  )
}
