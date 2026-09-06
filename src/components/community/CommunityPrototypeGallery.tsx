import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, FlaskConical, Loader2, ShieldCheck } from 'lucide-react'
import { importMarketplaceProductDistributionV2 } from '../../lib/product-platform/distribution-bundle'
import {
  loadCommunityPrototypeCatalogV1,
  loadCommunityPrototypeReleaseBundleV1,
  resolveCommunityPrototypePublicPathV1,
  type CommunityPrototypeCatalogEntryV1,
} from '../../lib/product-platform/community-prototype-catalog'
import type { ProductRelease, ProductionProductKindV1, WorkspaceScope } from '../../lib/types'

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/^\[[^\]]+\]\s*/, '') : String(cause)
}

export default function CommunityPrototypeGallery(props: {
  scope: WorkspaceScope
  productType: ProductionProductKindV1
  onImported?: (release: ProductRelease) => void | Promise<void>
}) {
  const [entries, setEntries] = useState<CommunityPrototypeCatalogEntryV1[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const matching = useMemo(
    () => entries.filter(entry => entry.productType === props.productType),
    [entries, props.productType],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void loadCommunityPrototypeCatalogV1({ signal: controller.signal })
      .then(catalog => setEntries(catalog.prototypes))
      .catch(cause => {
        if (!controller.signal.aborted) setError(messageOf(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const importPrototype = async (entry: CommunityPrototypeCatalogEntryV1) => {
    setBusyId(entry.prototypeId); setMessage(''); setError('')
    try {
      const bundle = await loadCommunityPrototypeReleaseBundleV1({ entry })
      const release = await importMarketplaceProductDistributionV2({
        scope: props.scope,
        bundle,
        provenance: {
          listingId: `listing.prototype.${entry.prototypeId}`,
          orderId: null,
          entitlementId: null,
          license: {
            licenseId: 'storyforge.community-prototype',
            licenseVersion: '1.0.0',
            allowOfflineExport: true,
            allowRemix: false,
            commercialReuse: false,
            requiresAttribution: true,
            termsUrl: 'https://github.com/yuanbw2025/storyforge/blob/main/public/prototypes/COMMUNITY-PROTOTYPE-LICENSE.md',
          },
          attribution: ['StoryForge 社区原型；原创 AI 媒资仍需供应商条款复核，禁止商业复用。'],
          localCopyPreserved: true,
          acquiredAt: Date.now(),
        },
      })
      setMessage(`《${entry.title}》已验签并导入当前 Work；现在可在下方创建自己的小镇存档。`)
      await props.onImported?.(release)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusyId(null)
    }
  }

  if (!loading && matching.length === 0 && !error) return null
  return <section className="mx-5 mt-5 overflow-hidden rounded-xl border border-accent/30 bg-bg-elevated" data-testid="community-prototype-gallery">
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-accent/5 px-5 py-4">
      <FlaskConical className="h-5 w-5 text-accent" />
      <div className="min-w-0 flex-1"><strong className="block text-sm text-text-primary">官方社区原型展厅</strong><p className="mt-1 text-[10px] leading-5 text-text-muted">随项目发布的离线体验包；导入前会验证 ProductRelease、来源哈希和每一份媒资。</p></div>
      <span className="rounded-full border border-warning/40 px-2 py-1 text-[9px] text-warning">PROTOTYPE · 非商业素材</span>
    </header>
    {loading ? <div className="flex items-center gap-2 p-5 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin" />正在读取原型目录…</div> : <div className="grid gap-4 p-4 xl:grid-cols-2">{matching.map(entry => <article key={entry.prototypeId} className="overflow-hidden rounded-lg border border-border bg-bg-base">
      <img src={resolveCommunityPrototypePublicPathV1(entry.heroPath)} alt={`${entry.title}主视觉`} className="aspect-[16/9] w-full object-cover" />
      <div className="p-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><strong className="block font-serif text-base text-text-primary">{entry.title}</strong><small className="mt-1 block font-mono text-[9px] text-accent">v{entry.version} · {entry.language}</small></div><ShieldCheck className="h-5 w-5 shrink-0 text-success" /></div>
        <p className="mt-3 text-xs leading-6 text-text-muted">{entry.summary}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">{entry.galleryPaths.map(path => <img key={path} src={resolveCommunityPrototypePublicPathV1(path)} alt="原型场景预览" className="aspect-video w-full rounded border border-border object-cover" />)}</div>
        <ul className="mt-3 grid gap-1 text-[10px] leading-5 text-text-muted md:grid-cols-2">{entry.featureHighlights.map(item => <li key={item} className="flex gap-1.5"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />{item}</li>)}</ul>
        <button disabled={busyId != null} onClick={() => void importPrototype(entry)} className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><Download className="h-4 w-4" />{busyId === entry.prototypeId ? '正在验签并导入…' : '导入原型并准备游玩'}</button>
        <p className="mt-2 text-[9px] leading-4 text-text-muted">内容提示：{entry.contentWarnings.join('、') || '无'}。原型运行只写当前产品私域，不会修改来源世界。</p>
      </div>
    </article>)}</div>}
    {message && <p role="status" className="mx-4 mb-4 rounded border border-success/30 bg-success/5 p-3 text-xs text-success">{message}</p>}
    {error && <p role="alert" className="mx-4 mb-4 rounded border border-error/30 bg-error/5 p-3 text-xs text-error">{error}</p>}
  </section>
}
