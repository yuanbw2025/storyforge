import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, Download, ExternalLink, Heart, KeyRound, Loader2, PackageCheck, RefreshCw, Search, Send, ShieldAlert, ShoppingBag, Upload, UserPlus,
} from 'lucide-react'
import { db } from '../../lib/db/schema'
import {
  CommercialHttpClientV1,
  type CommercialHttpErrorV1,
} from '../../lib/commercial/http-client'
import { CommunityHttpClientV1 } from '../../lib/community/http-client'
import { CommercialOperationsHttpClientV1 } from '../../lib/commercial/operations-http-client'
import type { CommercialListingV1 } from '../../lib/commercial/authority'
import type { CommunitySocialEdgeV1 } from '../../lib/community/authority'
import { exportGameDistributionBundleV2, importMarketplaceGameDistributionV2 } from '../../lib/game-platform/distribution-bundle'
import type { GameDistributionBundleV2, MarketplaceImportProvenanceV2 } from '../../lib/game-platform/distribution-bundle'
import type { GameProductType, GameRelease, WorkspaceScope } from '../../lib/types'
import type { OnlineRoomJoinHandoffV1 } from '../../lib/online/http-transport'
import LfgCenterPanel from './LfgCenterPanel'
import CommunityReviewPanel from './CommunityReviewPanel'
import CommunitySafetyPanel from './CommunitySafetyPanel'
import CommercialOperationsPanel from './CommercialOperationsPanel'
import {
  currentGamePlatformEnvironmentV1,
  evaluateGamePlatformCapabilityV1,
} from '../../lib/game-platform/capability-status'

type MarketplaceClientV1 = Pick<CommercialHttpClientV1,
  'discover' | 'acquire' | 'downloadRelease' | 'createListing' | 'registerRelease' | 'submitListing'
  | 'myListings' | 'reviewQueue' | 'publishListing' | 'requestListingChanges' | 'reviseListing'
  | 'suspendListing' | 'withdrawListing'>

interface LocalReleaseView {
  row: GameRelease
  productType: GameProductType
  title: string
}

const PRODUCT_OPTIONS: Array<{ value: '' | GameProductType; label: string }> = [
  { value: '', label: '全部产品' }, { value: 'ttrpg', label: '跑团战役' },
  { value: 'storygame', label: '分支叙事' }, { value: 'character-interaction', label: '角色互动' },
  { value: 'text-adventure', label: '文字冒险' }, { value: 'avg', label: 'AVG / Galgame' },
  { value: 'narrative-simulation', label: '叙事模拟' }, { value: 'text-open-world', label: '文字开放世界' },
]

function releaseView(row: GameRelease): LocalReleaseView | null {
  try {
    const manifest = JSON.parse(row.manifestJson) as {
      productType?: GameProductType
      runtimePackage?: { definition?: { title?: string } }
      definition?: { title?: string }
    }
    if (!PRODUCT_OPTIONS.some(item => item.value === manifest.productType)) return null
    return {
      row, productType: manifest.productType!,
      title: manifest.runtimePackage?.definition?.title || manifest.definition?.title || row.label,
    }
  } catch { return null }
}

function price(listing: CommercialListingV1): string {
  if (listing.amountMinor === 0) return '免费'
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency: listing.currency,
  }).format(listing.amountMinor / 100)
}

function messageOf(error: unknown): string {
  const typed = error as Partial<CommercialHttpErrorV1>
  if (typed.code === 'entitlement_required') return '当前账号尚未拥有这个发行物，请先领取或完成支付。'
  if (typed.code === 'release_delivery_missing') return '发行物仍在处理或尚未上传，请稍后重试。'
  return error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : String(error)
}

export default function MarketplacePanel(props: {
  scope?: WorkspaceScope
  client?: MarketplaceClientV1
  communityClient?: CommunityHttpClientV1
  operationsClient?: CommercialOperationsHttpClientV1
  initialServiceUrl?: string
  onImported?: (release: GameRelease) => void | Promise<void>
  onRoomHandoff?: (handoff: OnlineRoomJoinHandoffV1) => void | Promise<void>
  exportBundle?: (input: { scope: WorkspaceScope; gameReleaseId: number }) => Promise<GameDistributionBundleV2>
  importBundle?: (input: {
    scope: WorkspaceScope
    bundle: unknown
    provenance: MarketplaceImportProvenanceV2
  }) => Promise<GameRelease>
}) {
  const [serviceUrl, setServiceUrl] = useState(props.initialServiceUrl ?? import.meta.env.VITE_STORYFORGE_PLATFORM_SERVICE_URL ?? '')
  const [accessToken, setAccessToken] = useState('')
  const [mode, setMode] = useState<'discover' | 'groups' | 'creator' | 'review' | 'safety' | 'operations'>('discover')
  const [query, setQuery] = useState('')
  const [productType, setProductType] = useState<'' | GameProductType>('')
  const [listings, setListings] = useState<CommercialListingV1[]>([])
  const [localReleases, setLocalReleases] = useState<LocalReleaseView[]>([])
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(null)
  const [creatorTitle, setCreatorTitle] = useState('')
  const [creatorSummary, setCreatorSummary] = useState('')
  const [amountMinor, setAmountMinor] = useState(0)
  const [allowRemix, setAllowRemix] = useState(false)
  const [requiresAttribution, setRequiresAttribution] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [checkout, setCheckout] = useState<{ listingId: string; url: string } | null>(null)
  const [reviewListingId, setReviewListingId] = useState<string | null>(null)
  const [socialEdges, setSocialEdges] = useState<CommunitySocialEdgeV1[]>([])
  const [creatorListings, setCreatorListings] = useState<CommercialListingV1[]>([])
  const [reviewQueue, setReviewQueue] = useState<CommercialListingV1[]>([])
  const [reviewReasonCode, setReviewReasonCode] = useState('catalog.changes-required')
  const [revisionListingId, setRevisionListingId] = useState<string | null>(null)
  const acquisitionIds = useRef(new Map<string, string>())
  const socialRequestIds = useRef(new Map<string, string>())
  const operationRequestIds = useRef(new Map<string, string>())
  const submission = useRef<{
    fingerprint: string
    createRequestId: string
    reviseRequestId: string
    uploadRequestId: string
    submitRequestId: string
  } | null>(null)

  const generatedClient = useMemo(() => {
    if (props.client || !serviceUrl.trim()) return null
    try { return new CommercialHttpClientV1({ baseUrl: serviceUrl, timeoutMs: 180_000 }) } catch { return null }
  }, [props.client, serviceUrl])
  const generatedOperationsClient = useMemo(() => {
    if (props.operationsClient || !serviceUrl.trim()) return null
    try { return new CommercialOperationsHttpClientV1({ baseUrl: serviceUrl }) } catch { return null }
  }, [props.operationsClient, serviceUrl])
  const operationsClient = props.operationsClient ?? generatedOperationsClient
  const client = props.client ?? generatedClient
  const generatedCommunityClient = useMemo(() => {
    if (props.communityClient || !serviceUrl.trim()) return null
    try { return new CommunityHttpClientV1({ baseUrl: serviceUrl, timeoutMs: 60_000 }) } catch { return null }
  }, [props.communityClient, serviceUrl])
  const communityClient = props.communityClient ?? generatedCommunityClient

  const refreshLocal = useCallback(async () => {
    if (!props.scope) { setLocalReleases([]); return }
    const rows = await db.gameReleases.where('workId').equals(props.scope.workId).toArray()
    const views = rows.flatMap(row => {
      const view = releaseView(row)
      return view ? [view] : []
    }).sort((left, right) => right.row.createdAt - left.row.createdAt)
    setLocalReleases(views)
    setSelectedReleaseId(current => current ?? views[0]?.row.id ?? null)
  }, [props.scope])

  useEffect(() => { void refreshLocal() }, [refreshLocal])
  useEffect(() => {
    const selected = localReleases.find(item => item.row.id === selectedReleaseId)
    if (!selected) return
    setCreatorTitle(selected.title)
    setCreatorSummary(`${selected.title} · StoryForge 不可变发行版本`)
    submission.current = null
  }, [localReleases, selectedReleaseId])

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key); setMessage(''); setError('')
    try { await operation() } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(null) }
  }
  const operationRequestId = (key: string) => {
    const prior = operationRequestIds.current.get(key)
    if (prior) return prior
    const created = `${key}.${crypto.randomUUID()}`
    operationRequestIds.current.set(key, created)
    return created
  }

  const discover = () => run('discover', async () => {
    if (!client) throw new Error('请先配置市场服务地址。')
    setListings(await client.discover({ productType: productType || undefined, query }))
    if (communityClient && accessToken.trim()) {
      try { setSocialEdges(await communityClient.mySocialEdges(accessToken.trim())) } catch { setSocialEdges([]) }
    }
  })

  const toggleSocial = (kind: CommunitySocialEdgeV1['kind'], targetId: string) => run(`social:${kind}:${targetId}`, async () => {
    if (!communityClient) throw new Error('请先配置社区服务地址。')
    if (!accessToken.trim()) throw new Error('请输入当前账号的访问凭据。')
    const prior = socialEdges.find(edge => edge.kind === kind && edge.targetId === targetId)
    const active = !prior?.active
    const requestKey = `${kind}:${targetId}:${active}`
    const requestId = socialRequestIds.current.get(requestKey) ?? `social.${crypto.randomUUID()}`
    socialRequestIds.current.set(requestKey, requestId)
    const edge = await communityClient.setSocialEdge({
      accessToken: accessToken.trim(), requestId, kind, targetId, active,
    })
    setSocialEdges(current => edge.active
      ? [edge, ...current.filter(item => item.edgeId !== edge.edgeId)]
      : current.filter(item => item.edgeId !== edge.edgeId))
    setMessage(active ? '社区关系已保存到账号。' : '社区关系已取消。')
  })

  const download = async (listing: CommercialListingV1) => {
    if (!client) throw new Error('请先配置市场服务地址。')
    if (!accessToken.trim()) throw new Error('请输入当前账号的访问凭据。')
    if (!props.scope) throw new Error('请选择一个已完成 World/Work 初始化的本地工作区。')
    const payload = await client.downloadRelease({ accessToken: accessToken.trim(), releaseHash: listing.releaseHash })
    const release = await (props.importBundle ?? importMarketplaceGameDistributionV2)({
      scope: props.scope, bundle: payload.bundle, provenance: payload.provenance,
    })
    await refreshLocal()
    await props.onImported?.(release)
    setMessage(`《${listing.title}》已校验并导入当前 Work；本地副本不会因后续退款指令被远程删除。`)
  }

  const acquire = (listing: CommercialListingV1) => run(`acquire:${listing.listingId}`, async () => {
    if (!client) throw new Error('请先配置市场服务地址。')
    if (!accessToken.trim()) throw new Error('请输入当前账号的访问凭据。')
    const requestId = acquisitionIds.current.get(listing.listingId) ?? `acquire.${crypto.randomUUID()}`
    acquisitionIds.current.set(listing.listingId, requestId)
    const result = await client.acquire({ accessToken: accessToken.trim(), requestId, listingId: listing.listingId })
    if (result.checkout) {
      setCheckout({ listingId: listing.listingId, url: result.checkout.checkoutUrl })
      setMessage('订单已创建。请在支付页完成支付，收到确认后点击“下载已拥有版本”。')
      return
    }
    await download(listing)
  })

  const submitRelease = () => run('submit', async () => {
    if (!client) throw new Error('请先配置市场服务地址。')
    if (!accessToken.trim()) throw new Error('请输入创作者账号访问凭据。')
    if (!props.scope || selectedReleaseId == null) throw new Error('当前 Work 没有可提交的正式 GameRelease。')
    const selected = localReleases.find(item => item.row.id === selectedReleaseId)
    if (!selected) throw new Error('所选 Release 已不存在。')
    const fingerprint = JSON.stringify({
      releaseId: selectedReleaseId, title: creatorTitle.trim(), summary: creatorSummary.trim(),
      amountMinor, allowRemix, requiresAttribution, revisionListingId,
    })
    if (submission.current?.fingerprint !== fingerprint) {
      submission.current = {
        fingerprint,
        createRequestId: `listing.${crypto.randomUUID()}`,
        reviseRequestId: `listing-revise.${crypto.randomUUID()}`,
        uploadRequestId: `upload.${crypto.randomUUID()}`,
        submitRequestId: `submit.${crypto.randomUUID()}`,
      }
    }
    const ids = submission.current
    const bundle = await (props.exportBundle ?? exportGameDistributionBundleV2)({
      scope: props.scope, gameReleaseId: selectedReleaseId,
    })
    const listingInput = {
      releaseHash: bundle.gameRelease.contentHash,
      title: creatorTitle.trim(), summary: creatorSummary.trim(), contentWarnings: [] as string[],
      license: {
        licenseId: 'storyforge.creator-standard', licenseVersion: '1.0.0', allowOfflineExport: true,
        allowRemix, commercialReuse: false, requiresAttribution,
        termsUrl: 'https://storyforge.example/licenses/creator-standard-1',
      },
      currency: 'CNY', amountMinor, creatorShareBps: 8_000,
    }
    await client.registerRelease({ accessToken: accessToken.trim(), requestId: ids.uploadRequestId, bundle })
    const listing = revisionListingId
      ? await client.reviseListing({
          accessToken: accessToken.trim(), requestId: ids.reviseRequestId,
          listingId: revisionListingId, ...listingInput,
        })
      : await client.createListing({
          accessToken: accessToken.trim(), requestId: ids.createRequestId,
          productType: selected.productType, ...listingInput,
        })
    await client.submitListing({
      accessToken: accessToken.trim(), requestId: ids.submitRequestId, listingId: listing.listingId,
    })
    setCreatorListings(await client.myListings(accessToken.trim()))
    setRevisionListingId(null)
    setMessage(`《${listing.title}》及完整发行物已提交审核；审核通过后才会出现在公开发现页。`)
  })

  const loadCreatorListings = () => run('creator-listings', async () => {
    if (!client || !accessToken.trim()) throw new Error('请输入创作者账号访问凭据。')
    setCreatorListings(await client.myListings(accessToken.trim()))
  })
  const loadReviewQueue = () => run('review-queue', async () => {
    if (!client || !accessToken.trim()) throw new Error('请输入审核账号访问凭据。')
    setReviewQueue(await client.reviewQueue(accessToken.trim()))
  })
  const approveListing = (listingId: string) => run(`approve:${listingId}`, async () => {
    if (!client) throw new Error('请先配置市场服务地址。')
    const listing = await client.publishListing({
      accessToken: accessToken.trim(), requestId: operationRequestId(`approve:${listingId}`), listingId,
    })
    setReviewQueue(current => current.filter(item => item.listingId !== listing.listingId))
    setMessage(`《${listing.title}》已审核发布。`)
  })
  const rejectListing = (listingId: string) => run(`reject:${listingId}`, async () => {
    if (!client) throw new Error('请先配置市场服务地址。')
    const listing = await client.requestListingChanges({
      accessToken: accessToken.trim(), requestId: operationRequestId(`changes:${listingId}:${reviewReasonCode.trim()}`),
      listingId, reasonCode: reviewReasonCode.trim(),
    })
    setReviewQueue(current => current.filter(item => item.listingId !== listing.listingId))
    setMessage(`《${listing.title}》已退回修改；创作者修订后可重新提交审核。`)
  })
  const beginRevision = (listing: CommercialListingV1) => {
    const matchingRelease = localReleases.find(item => item.row.contentHash === listing.releaseHash)
    setRevisionListingId(listing.listingId)
    setSelectedReleaseId(matchingRelease?.row.id ?? null)
    setCreatorTitle(listing.title)
    setCreatorSummary(listing.summary)
    setAmountMinor(listing.amountMinor)
    setAllowRemix(listing.license.allowRemix)
    setRequiresAttribution(listing.license.requiresAttribution)
    submission.current = null
    setMessage(`正在修订《${listing.title}》；请选择修正后的正式 GameRelease，再重新提交。`)
  }
  const withdrawRemoteListing = (listingId: string) => run(`withdraw:${listingId}`, async () => {
    if (!client) throw new Error('请先配置市场服务地址。')
    const listing = await client.withdrawListing({
      accessToken: accessToken.trim(), requestId: operationRequestId(`withdraw:${listingId}`), listingId,
    })
    setCreatorListings(current => current.map(item => item.listingId === listing.listingId ? listing : item))
    setMessage(`《${listing.title}》已撤回；已合法导出的本地副本不会被远程删除。`)
  })

  const catalogDecision = evaluateGamePlatformCapabilityV1('release-catalog', {
    environment: currentGamePlatformEnvironmentV1(), experimentalProject: false, authorOptIn: false,
    onlineServiceConfigured: client != null, aiGmBetaGatePassed: false,
  })
  const rolloutBlockers = catalogDecision.blockers.filter(blocker => blocker !== '在线服务未配置')
  if (rolloutBlockers.length > 0) {
    return <section className="m-5 rounded-lg border border-warning/40 bg-warning/5 p-6" data-testid="marketplace-rollout-blocked">
      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><ShieldAlert className="h-4 w-4 text-warning" />社区市场尚未进入当前环境</div>
      <p className="mt-2 max-w-3xl text-xs leading-6 text-text-secondary">{catalogDecision.capability.reason}</p>
      <p className="mt-2 text-[10px] text-warning">{rolloutBlockers.join('；')}</p>
      <p className="mt-2 text-[10px] text-text-muted">本地 GameRelease、完整分发包导出和离线游玩仍可使用；目录服务通过部署验收前不向生产用户展示伪入口。</p>
    </section>
  }

  return <div className="space-y-5 p-5" data-testid="community-marketplace">
    <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="text-[10px] uppercase tracking-[0.18em] text-accent">COMMUNITY / MARKETPLACE</div><h2 className="mt-1 text-base font-semibold text-text-primary">发现、购买和发布可验证游戏</h2><p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">目录、权益与支付由服务端授权；下载包会在浏览器内复验 GameRelease、WorldRelease 和每个媒资哈希，再写入当前 Work。</p></div>
        {busy && <Loader2 className="h-5 w-5 animate-spin text-accent" />}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        {!props.client && <label className="grid gap-2 text-[10px] text-text-muted">市场服务地址<input value={serviceUrl} onChange={event => setServiceUrl(event.target.value)} placeholder="https://market.example.com" className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label>}
        <label className="grid gap-2 text-[10px] text-text-muted">账号访问凭据（仅保存在当前页面内存）<span className="flex items-center gap-2 rounded border border-border bg-bg-base px-2"><KeyRound className="h-4 w-4" /><input type="password" value={accessToken} onChange={event => setAccessToken(event.target.value)} autoComplete="off" className="min-w-0 flex-1 bg-transparent py-2 text-xs text-text-primary outline-none" /></span></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => setMode('discover')} className={`rounded px-3 py-2 text-xs ${mode === 'discover' ? 'bg-accent text-white' : 'border border-border text-text-primary'}`}><ShoppingBag className="mr-2 inline h-4 w-4" />玩家市场</button><button onClick={() => setMode('groups')} className={`rounded px-3 py-2 text-xs ${mode === 'groups' ? 'bg-accent text-white' : 'border border-border text-text-primary'}`}><PackageCheck className="mr-2 inline h-4 w-4" />组团中心</button><button onClick={() => setMode('creator')} className={`rounded px-3 py-2 text-xs ${mode === 'creator' ? 'bg-accent text-white' : 'border border-border text-text-primary'}`}><Upload className="mr-2 inline h-4 w-4" />创作者提交</button><button onClick={() => setMode('review')} className={`rounded px-3 py-2 text-xs ${mode === 'review' ? 'bg-accent text-white' : 'border border-border text-text-primary'}`}><PackageCheck className="mr-2 inline h-4 w-4" />发行审核</button><button onClick={() => setMode('safety')} className={`rounded px-3 py-2 text-xs ${mode === 'safety' ? 'bg-accent text-white' : 'border border-border text-text-primary'}`}><ShieldAlert className="mr-2 inline h-4 w-4" />安全与申诉</button><button onClick={() => setMode('operations')} className={`rounded px-3 py-2 text-xs ${mode === 'operations' ? 'bg-accent text-white' : 'border border-border text-text-primary'}`}><KeyRound className="mr-2 inline h-4 w-4" />支持与结算</button></div>
    </section>

    {mode === 'discover' ? <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]"><label className="flex items-center gap-2 rounded border border-border bg-bg-base px-3"><Search className="h-4 w-4 text-text-muted" /><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void discover() }} placeholder="搜索战役或文字游戏" className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none" /></label><select value={productType} onChange={event => setProductType(event.target.value as typeof productType)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">{PRODUCT_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button disabled={busy != null || !client} onClick={() => void discover()} className="flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><RefreshCw className="h-4 w-4" />刷新</button></div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">{listings.map(listing => {
        const favorite = socialEdges.some(edge => edge.kind === 'favorite-listing' && edge.targetId === listing.listingId)
        const subscribed = socialEdges.some(edge => edge.kind === 'subscribe-listing' && edge.targetId === listing.listingId)
        const followed = socialEdges.some(edge => edge.kind === 'follow-creator' && edge.targetId === listing.creatorId)
        return <article key={listing.listingId} className="rounded border border-border bg-bg-base p-4">
          <div className="flex items-start gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-accent" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-text-primary">{listing.title}</h3><span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] text-accent">{PRODUCT_OPTIONS.find(item => item.value === listing.productType)?.label}</span><strong className="ml-auto text-xs text-text-primary">{price(listing)}</strong></div><p className="mt-2 text-xs leading-5 text-text-muted">{listing.summary}</p><p className="mt-2 break-all font-mono text-[9px] text-text-muted">Release {listing.releaseHash}</p><p className="mt-1 font-mono text-[9px] text-text-muted">Listing {listing.listingId} · Creator {listing.creatorId}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy != null} onClick={() => void acquire(listing)} className="rounded bg-accent px-3 py-2 text-xs text-white">{listing.amountMinor === 0 ? '领取并导入' : '创建支付订单'}</button><button disabled={busy != null} onClick={() => void run(`download:${listing.listingId}`, () => download(listing))} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-primary"><Download className="h-4 w-4" />下载已拥有版本</button><button onClick={() => setReviewListingId(current => current === listing.listingId ? null : listing.listingId)} className="rounded border border-border px-3 py-2 text-xs text-text-primary">评价与评分</button>{checkout?.listingId === listing.listingId && <a href={checkout.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded border border-warning px-3 py-2 text-xs text-warning">前往支付<ExternalLink className="h-4 w-4" /></a>}</div>
            <div className="mt-2 flex flex-wrap gap-2"><button aria-pressed={favorite} disabled={busy != null || !communityClient} onClick={() => void toggleSocial('favorite-listing', listing.listingId)} className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] ${favorite ? 'border-accent text-accent' : 'border-border text-text-muted'}`}><Heart className="h-3 w-3" />{favorite ? '已收藏' : '收藏'}</button><button aria-pressed={subscribed} disabled={busy != null || !communityClient} onClick={() => void toggleSocial('subscribe-listing', listing.listingId)} className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] ${subscribed ? 'border-accent text-accent' : 'border-border text-text-muted'}`}><Bell className="h-3 w-3" />{subscribed ? '已订阅更新' : '订阅更新'}</button><button aria-pressed={followed} disabled={busy != null || !communityClient} onClick={() => void toggleSocial('follow-creator', listing.creatorId)} className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] ${followed ? 'border-accent text-accent' : 'border-border text-text-muted'}`}><UserPlus className="h-3 w-3" />{followed ? '已关注创作者' : '关注创作者'}</button></div>
          </div></div>
        </article>
      })}{listings.length === 0 && <div className="rounded border border-dashed border-border p-8 text-center text-xs text-text-muted lg:col-span-2">配置服务后点击刷新；公开目录只返回已审核且可领取的发行物。</div>}</div>
      {reviewListingId && (() => { const listing = listings.find(item => item.listingId === reviewListingId); return listing ? <div className="mt-5"><CommunityReviewPanel client={communityClient} accessToken={accessToken} subjectType="release" releaseHash={listing.releaseHash} heading={`《${listing.title}》评价`} /></div> : null })()}
    </section> : mode === 'groups' ? <LfgCenterPanel
      client={communityClient}
      accessToken={accessToken}
      releases={localReleases.map(item => ({ releaseHash: item.row.contentHash, title: item.title }))}
      onRoomHandoff={props.onRoomHandoff}
    /> : mode === 'review' ? <section className="rounded-lg border border-border bg-bg-elevated p-5" data-testid="commercial-review-queue">
      <div className="flex flex-wrap items-center gap-2"><PackageCheck className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">发行物审核队列</h3><button disabled={busy != null || !client || !accessToken.trim()} onClick={() => void loadReviewQueue()} className="ml-auto flex items-center gap-1 rounded border border-border px-3 py-2 text-xs text-text-primary disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />加载待审</button></div>
      <p className="mt-2 text-xs text-text-muted">只有 catalog:publish 权限账号可以读取队列和发布；完整发行包已在提交时通过服务端验证。</p>
      <label className="mt-4 grid max-w-md gap-1 text-[10px] text-text-muted">修改理由码<input aria-label="发行审核理由码" value={reviewReasonCode} onChange={event => setReviewReasonCode(event.target.value)} className="rounded border border-border bg-bg-base p-2 font-mono text-[10px] text-text-primary" /></label>
      <div className="mt-4 space-y-2">{reviewQueue.map(listing => <article key={listing.listingId} className="rounded border border-border bg-bg-base p-4"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm text-text-primary">{listing.title}</strong><span className="text-[10px] text-text-muted">{listing.productType} · {listing.creatorId}</span><span className="ml-auto font-mono text-[9px] text-text-muted">{listing.listingId}</span></div><p className="mt-2 text-xs leading-5 text-text-muted">{listing.summary}</p><p className="mt-1 break-all font-mono text-[9px] text-text-muted">{listing.releaseHash}</p><div className="mt-3 flex gap-2"><button disabled={busy != null} onClick={() => void approveListing(listing.listingId)} className="rounded bg-success px-3 py-2 text-xs text-white">审核发布</button><button disabled={busy != null || !reviewReasonCode.trim()} onClick={() => void rejectListing(listing.listingId)} className="rounded border border-warning/50 px-3 py-2 text-xs text-warning">要求修改</button></div></article>)}{reviewQueue.length === 0 && <p className="rounded border border-dashed border-border p-6 text-center text-xs text-text-muted">加载后显示 submitted 且完整包已验证的目录项。</p>}</div>
    </section> : mode === 'safety' ? <CommunitySafetyPanel client={communityClient} accessToken={accessToken} /> : mode === 'operations' ? <CommercialOperationsPanel client={operationsClient} accessToken={accessToken} /> : <>
    <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="flex items-center gap-2"><Send className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">{revisionListingId ? '修订并重新提交发行物' : '提交当前 Work 的正式发行物'}</h3>{revisionListingId && <button onClick={() => { setRevisionListingId(null); submission.current = null }} className="ml-auto rounded border border-border px-2 py-1 text-[10px] text-text-muted">取消修订</button>}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="grid gap-2 text-[10px] text-text-muted">本地 GameRelease<select value={selectedReleaseId ?? ''} onChange={event => { setSelectedReleaseId(Number(event.target.value) || null); submission.current = null }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="">请选择正式发布</option>{localReleases.map(item => <option key={item.row.id} value={item.row.id}>{item.title} · v{item.row.version} · {item.productType}</option>)}</select></label><label className="grid gap-2 text-[10px] text-text-muted">售价（分）<input type="number" min={0} step={1} value={amountMinor} onChange={event => { setAmountMinor(Math.max(0, Number(event.target.value) || 0)); submission.current = null }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">公开标题<input value={creatorTitle} onChange={event => { setCreatorTitle(event.target.value); submission.current = null }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">简介<input value={creatorSummary} onChange={event => { setCreatorSummary(event.target.value); submission.current = null }} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label></div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-text-secondary"><label className="flex items-center gap-2"><input type="checkbox" checked={allowRemix} onChange={event => { setAllowRemix(event.target.checked); submission.current = null }} />允许合规派生</label><label className="flex items-center gap-2"><input type="checkbox" checked={requiresAttribution} onChange={event => { setRequiresAttribution(event.target.checked); submission.current = null }} />要求署名</label></div>
      <p className="mt-4 text-xs leading-5 text-text-muted">提交时会本地冻结完整分发包、上传内容寻址媒资并确认权利；目录先进入 submitted，审核通过后才公开。相同表单重试沿用请求 ID，不会重复建单。</p>
      <button disabled={busy != null || !client || selectedReleaseId == null || !creatorTitle.trim() || !creatorSummary.trim()} onClick={() => void submitRelease()} className="mt-4 flex items-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"><Upload className="h-4 w-4" />{revisionListingId ? '上传修订版并重新提交' : '冻结、上传并提交审核'}</button>
    </section>
    <section className="rounded-lg border border-border bg-bg-elevated p-5"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-text-primary">我的远程发行状态</h3><button disabled={busy != null || !client || !accessToken.trim()} onClick={() => void loadCreatorListings()} className="ml-auto flex items-center gap-1 rounded border border-border px-3 py-2 text-xs text-text-primary disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />同步状态</button></div><div className="mt-4 space-y-2">{creatorListings.map(listing => <article key={listing.listingId} className="flex flex-wrap items-center gap-3 rounded border border-border bg-bg-base p-3"><div className="min-w-0 flex-1"><strong className="text-xs text-text-primary">{listing.title}</strong><p className="mt-1 font-mono text-[9px] text-text-muted">{listing.listingId} · {listing.status}{listing.reviewedBy ? ` · reviewer ${listing.reviewedBy}` : ''}</p>{listing.reviewReasonCode && <p className="mt-1 text-[10px] text-warning">修改理由：{listing.reviewReasonCode}</p>}</div>{listing.status === 'changes-requested' && <button disabled={busy != null} onClick={() => beginRevision(listing)} className="rounded border border-accent/50 px-3 py-1.5 text-xs text-accent">开始修订</button>}{!['withdrawn', 'suspended'].includes(listing.status) && <button disabled={busy != null} onClick={() => void withdrawRemoteListing(listing.listingId)} className="rounded border border-warning/40 px-3 py-1.5 text-xs text-warning">撤回发行</button>}</article>)}{creatorListings.length === 0 && <p className="text-xs text-text-muted">点击同步读取当前账号的草稿、审核中、要求修改、已发布、暂停和撤回状态。</p>}</div></section>
    </>}

    {message && <p className="rounded border border-success/30 bg-success/10 p-3 text-xs text-success">{message}</p>}
    {error && <p className="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}
  </div>
}
