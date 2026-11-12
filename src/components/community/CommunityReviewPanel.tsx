import { useEffect, useState } from 'react'
import { Loader2, MessageSquareText, RefreshCw, ShieldCheck, Star } from 'lucide-react'
import type { CommunityReviewAggregateV1, CommunityReviewCapabilitiesV1, CommunityReviewV1 } from '../../lib/community/authority'
import type { CommunityHttpClientV1, CommunityHttpErrorV1 } from '../../lib/community/http-client'
import { createCommunityRequestIntentsV1 } from '../../lib/community/request-intent'

type ReviewClientV1 = Pick<CommunityHttpClientV1, 'listReviews' | 'reviewCapabilities' | 'upsertReview' | 'withdrawReview' | 'respondToReview'>

function messageOf(error: unknown): string {
  const typed = error as Partial<CommunityHttpErrorV1>
  if (typed.code === 'review_eligibility_required') return '当前账号没有通过该评价类型的权益或出席验证。'
  if (typed.code === 'self_review') return '创作者不能评价自己的发行版本。'
  return error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : String(error)
}

function stars(value: number | null): string {
  return value == null ? '尚无评分' : `${'★'.repeat(Math.round(value))}${'☆'.repeat(5 - Math.round(value))} ${value.toFixed(2)}`
}

export default function CommunityReviewPanel(props: {
  client: ReviewClientV1 | null
  accessToken: string
  subjectType: CommunityReviewV1['subjectType']
  releaseHash: string
  postId?: string | null
  heading: string
}) {
  const [reviews, setReviews] = useState<CommunityReviewV1[]>([])
  const [aggregate, setAggregate] = useState<CommunityReviewAggregateV1 | null>(null)
  const [rating, setRating] = useState<CommunityReviewV1['rating']>(5)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [containsSpoilers, setContainsSpoilers] = useState(false)
  const [capabilities, setCapabilities] = useState<CommunityReviewCapabilitiesV1>({ ownReviewId: null, respondableReviewIds: [] })
  const [respondingReviewId, setRespondingReviewId] = useState<string | null>(null)
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [requestIntents] = useState(createCommunityRequestIntentsV1)

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await operation() } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }
  const load = async () => {
    if (!props.client) throw new Error('请先配置社区服务地址。')
    const result = await props.client.listReviews({
      subjectType: props.subjectType, releaseHash: props.releaseHash, postId: props.postId ?? null,
    })
    setReviews(result.reviews); setAggregate(result.aggregate)
    if (props.accessToken.trim()) {
      try {
        setCapabilities(await props.client.reviewCapabilities({
          accessToken: props.accessToken.trim(), subjectType: props.subjectType,
          releaseHash: props.releaseHash, postId: props.postId ?? null,
        }))
      } catch { setCapabilities({ ownReviewId: null, respondableReviewIds: [] }) }
    } else setCapabilities({ ownReviewId: null, respondableReviewIds: [] })
  }
  useEffect(() => {
    setReviews([]); setAggregate(null); setCapabilities({ ownReviewId: null, respondableReviewIds: [] }); setMessage(''); setError('')
    if (props.client) void run(load)
  // Target identity is the reload boundary; load is intentionally local to keep credentials out of effects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.client, props.subjectType, props.releaseHash, props.postId])

  const submit = () => run(async () => {
    const client = props.client
    if (!client) throw new Error('请先配置社区服务地址。')
    const accessToken = props.accessToken.trim()
    if (!accessToken) throw new Error('请输入账号访问凭据。')
    const tagList = [...new Set(tags.split(/[，,]/).map(item => item.trim()).filter(Boolean))]
    const bodyInput = {
      subjectType: props.subjectType, releaseHash: props.releaseHash, postId: props.postId ?? null,
      rating, title: title.trim(), body: body.trim(), tags: tagList, containsSpoilers,
    }
    await requestIntents.send(client, accessToken, 'review.upsert', bodyInput, ({ requestId }) => client.upsertReview({
      accessToken, requestId, ...bodyInput,
    }))
    await load()
    setMessage(props.subjectType === 'release' ? '已发布已验证权益评价。' : '已发布已验证参团评价。')
  })
  const withdraw = (reviewId: string) => run(async () => {
    const client = props.client
    if (!client) throw new Error('请先配置社区服务地址。')
    const accessToken = props.accessToken.trim()
    const bodyInput = { reviewId }
    await requestIntents.send(client, accessToken, 'review.withdraw', bodyInput, ({ requestId }) => client.withdrawReview({
      accessToken, requestId, ...bodyInput,
    }))
    await load(); setMessage('评价已撤回，不再计入公开聚合。')
  })
  const respond = (reviewId: string) => run(async () => {
    const client = props.client
    if (!client) throw new Error('请先配置社区服务地址。')
    const accessToken = props.accessToken.trim()
    const bodyInput = { reviewId, response: response.trim() }
    await requestIntents.send(client, accessToken, 'review.respond', bodyInput, ({ requestId }) => client.respondToReview({
      accessToken, requestId, ...bodyInput,
    }))
    setRespondingReviewId(null); setResponse(''); await load(); setMessage('公开回应已发布。')
  })

  return <section className="rounded-lg border border-accent/30 bg-bg-elevated p-5" data-testid="community-review-panel">
    <div className="flex flex-wrap items-start gap-3"><Star className="mt-0.5 h-4 w-4 text-accent" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-text-primary">{props.heading}</h3><p className="mt-1 text-xs text-text-muted">{props.subjectType === 'release' ? '仅已验证拥有者可评价；创作者自评被拒绝。' : '仅该场次已确认出席的正式成员可评价。'}</p></div><button disabled={busy || !props.client} onClick={() => void run(load)} aria-label="刷新评价" className="rounded border border-border p-2 text-text-secondary disabled:opacity-40"><RefreshCw className="h-4 w-4" /></button>{busy && <Loader2 className="h-4 w-4 animate-spin text-accent" />}</div>
    <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
      <div className="rounded border border-border bg-bg-base p-4">
        <strong className="text-sm text-text-primary">{stars(aggregate?.average ?? null)}</strong>
        <p className="mt-1 text-[10px] text-text-muted">{aggregate?.count ?? 0} 条已验证评价</p>
        <div className="mt-3 space-y-1">{([5, 4, 3, 2, 1] as const).map(value => <div key={value} className="flex items-center gap-2 text-[9px] text-text-muted"><span>{value} 星</span><span className="h-1.5 flex-1 overflow-hidden rounded bg-bg-surface"><span className="block h-full bg-accent" style={{ width: `${aggregate?.count ? ((aggregate.histogram[String(value) as keyof typeof aggregate.histogram] / aggregate.count) * 100) : 0}%` }} /></span><span>{aggregate?.histogram[String(value) as keyof NonNullable<typeof aggregate>['histogram']] ?? 0}</span></div>)}</div>
      </div>
      <div className="space-y-2">{reviews.map(review => <article key={review.reviewId} className="rounded border border-border bg-bg-base p-3">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-xs text-text-primary">{'★'.repeat(review.rating)} · {review.title}</strong><span className="rounded bg-success/10 px-2 py-0.5 text-[9px] text-success"><ShieldCheck className="mr-1 inline h-3 w-3" />{review.verification === 'entitlement' ? '已验证权益' : '已验证出席'}</span>{review.containsSpoilers && <span className="text-[9px] text-warning">含剧透</span>}</div>
        {review.containsSpoilers ? <details className="mt-2 text-xs text-text-muted"><summary>展开剧透评价</summary><p className="mt-2 whitespace-pre-wrap leading-5">{review.body}</p></details> : <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">{review.body}</p>}
        {review.tags.length > 0 && <p className="mt-2 text-[9px] text-accent">{review.tags.map(tag => `#${tag}`).join(' ')}</p>}
        {review.creatorResponse && <div className="mt-3 rounded border-l-2 border-accent bg-bg-surface p-2"><strong className="text-[10px] text-text-primary">创作者 / 主持人回应</strong><p className="mt-1 text-[10px] leading-4 text-text-muted">{review.creatorResponse}</p></div>}
        {(capabilities.ownReviewId === review.reviewId || capabilities.respondableReviewIds.includes(review.reviewId)) && <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2">
          {capabilities.ownReviewId === review.reviewId && <button disabled={busy} onClick={() => void withdraw(review.reviewId)} className="rounded border border-warning/40 px-2 py-1 text-[10px] text-warning">撤回我的评价</button>}
          {capabilities.respondableReviewIds.includes(review.reviewId) && <button disabled={busy} onClick={() => setRespondingReviewId(current => current === review.reviewId ? null : review.reviewId)} className="rounded border border-accent px-2 py-1 text-[10px] text-accent">公开回应</button>}
        </div>}
        {respondingReviewId === review.reviewId && <div className="mt-2 flex gap-2"><input aria-label={`回应评价 ${review.reviewId}`} value={response} onChange={event => setResponse(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-bg-surface p-2 text-xs text-text-primary" /><button disabled={busy || !response.trim()} onClick={() => void respond(review.reviewId)} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">发布回应</button></div>}
      </article>)}{reviews.length === 0 && <p className="rounded border border-dashed border-border p-6 text-center text-xs text-text-muted">暂无已验证评价。</p>}</div>
    </div>
    <div className="mt-5 rounded border border-border bg-bg-base p-4"><div className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-accent" /><strong className="text-xs text-text-primary">发布或更新我的评价</strong></div><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-[10px] text-text-muted">星级<select aria-label="评价星级" value={rating} onChange={event => setRating(Number(event.target.value) as CommunityReviewV1['rating'])} className="rounded border border-border bg-bg-surface p-2 text-xs text-text-primary">{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} 星</option>)}</select></label><label className="grid gap-1 text-[10px] text-text-muted">标题<input aria-label="评价标题" value={title} maxLength={200} onChange={event => setTitle(event.target.value)} className="rounded border border-border bg-bg-surface p-2 text-xs text-text-primary" /></label><label className="grid gap-1 text-[10px] text-text-muted md:col-span-2">正文<textarea aria-label="评价正文" value={body} maxLength={4000} onChange={event => setBody(event.target.value)} rows={4} className="rounded border border-border bg-bg-surface p-2 text-xs text-text-primary" /></label><label className="grid gap-1 text-[10px] text-text-muted">标签（逗号分隔）<input aria-label="评价标签" value={tags} onChange={event => setTags(event.target.value)} className="rounded border border-border bg-bg-surface p-2 text-xs text-text-primary" /></label><label className="flex items-end gap-2 pb-2 text-xs text-text-secondary"><input type="checkbox" checked={containsSpoilers} onChange={event => setContainsSpoilers(event.target.checked)} />含剧透，默认折叠正文</label></div><button disabled={busy || !props.client || !props.accessToken.trim() || !title.trim() || !body.trim()} onClick={() => void submit()} className="mt-3 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">发布已验证评价</button></div>
    {message && <p className="mt-3 rounded border border-success/30 bg-success/10 p-3 text-xs text-success">{message}</p>}
    {error && <p className="mt-3 rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}
  </section>
}
