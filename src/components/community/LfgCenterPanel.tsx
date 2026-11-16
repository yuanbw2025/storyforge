import { useEffect, useState } from 'react'
import { CalendarClock, Check, Link2, Loader2, LogIn, RefreshCw, ShieldCheck, UserPlus, Users, X } from 'lucide-react'
import type { CommunityLfgApplicationV1, CommunityLfgAttendanceV1, CommunityLfgParticipationV1, CommunityProfileV1 } from '../../lib/community/authority'
import type { CommunityHttpClientV1, CommunityHttpErrorV1 } from '../../lib/community/http-client'
import { createCommunityRequestIntentsV1 } from '../../lib/community/request-intent'
import type { OnlineRoomJoinHandoffV1 } from '../../lib/online/http-transport'
import CommunityReviewPanel from './CommunityReviewPanel'

type LfgClientV1 = Pick<CommunityHttpClientV1,
  'discoverLfg' | 'upsertProfile' | 'createLfg' | 'applyToLfg' | 'applicationsForPost'
  | 'myApplications' | 'myParticipation' | 'decideApplication' | 'closeLfg' | 'markAttendance'
  | 'attendanceForPost' | 'promoteWaitlist' | 'bindRoomHandoffs' | 'claimRoomHandoff'
  | 'listReviews' | 'reviewCapabilities' | 'upsertReview' | 'withdrawReview' | 'respondToReview'>

export interface LfgReleaseOptionV1 { releaseHash: string; title: string }

function errorMessage(error: unknown): string {
  const typed = error as Partial<CommunityHttpErrorV1>
  if (typed.code === 'profile_required') return '请先保存社区资料，再申请或创建招募。'
  if (typed.code === 'entitlement_required') return '当前账号没有主持该发行物的有效权益。'
  if (typed.code === 'age_restricted') return '该招募仅面向已确认成年用户。'
  return error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : String(error)
}

export default function LfgCenterPanel(props: {
  client: LfgClientV1 | null
  accessToken: string
  releases: LfgReleaseOptionV1[]
  onRoomHandoff?: (handoff: OnlineRoomJoinHandoffV1) => void | Promise<void>
}) {
  const [profile, setProfile] = useState<CommunityProfileV1 | null>(null)
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [ageBand, setAgeBand] = useState<'adult' | 'minor' | 'unknown'>('unknown')
  const [locale, setLocale] = useState('zh-CN')
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai')
  const [posts, setPosts] = useState<Awaited<ReturnType<LfgClientV1['discoverLfg']>>>([])
  const [myApplications, setMyApplications] = useState<CommunityLfgApplicationV1[]>([])
  const [participation, setParticipation] = useState<CommunityLfgParticipationV1[]>([])
  const [hostApplications, setHostApplications] = useState<CommunityLfgApplicationV1[]>([])
  const [hostAttendance, setHostAttendance] = useState<CommunityLfgAttendanceV1[]>([])
  const [managedPostId, setManagedPostId] = useState<string | null>(null)
  const [handoffRoomId, setHandoffRoomId] = useState('')
  const [actorAssignments, setActorAssignments] = useState<Record<string, string>>({})
  const [replacementAbsentId, setReplacementAbsentId] = useState('')
  const [reviewPostId, setReviewPostId] = useState<string | null>(null)
  const [applicationPreference, setApplicationPreference] = useState('')
  const [applicationNote, setApplicationNote] = useState('')
  const [releaseHash, setReleaseHash] = useState(props.releases[0]?.releaseHash ?? '')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(180)
  const [playerCapacity, setPlayerCapacity] = useState(4)
  const [waitlistCapacity, setWaitlistCapacity] = useState(2)
  const [audience, setAudience] = useState<'all-ages' | 'adult-only'>('all-ages')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [requestIntents] = useState(createCommunityRequestIntentsV1)

  useEffect(() => {
    if (!releaseHash && props.releases[0]) setReleaseHash(props.releases[0].releaseHash)
  }, [props.releases, releaseHash])

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key); setError(''); setMessage('')
    try { await operation() } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(null) }
  }
  const requireClient = () => {
    if (!props.client) throw new Error('请先配置社区服务地址。')
    return props.client
  }
  const token = () => {
    if (!props.accessToken.trim()) throw new Error('请输入当前账号的访问凭据。')
    return props.accessToken.trim()
  }
  const refresh = () => run('refresh-lfg', async () => {
    const client = requireClient()
    setPosts(await client.discoverLfg({ locale, includeFull: true }))
    if (props.accessToken.trim()) {
      try {
        const [applications, history] = await Promise.all([
          client.myApplications(props.accessToken.trim()), client.myParticipation(props.accessToken.trim()),
        ])
        setMyApplications(applications); setParticipation(history)
      }
      catch (cause) {
        if ((cause as Partial<CommunityHttpErrorV1>).code !== 'profile_required') throw cause
      }
    }
  })
  const saveProfile = () => run('profile', async () => {
    const client = requireClient()
    const accessToken = token()
    const bodyInput = { handle, displayName, bio: '', locale, timeZone, ageBand }
    const next = await requestIntents.send(client, accessToken, 'lfg.profile', bodyInput, ({ requestId }) => client.upsertProfile({
      accessToken, requestId, ...bodyInput,
    }))
    setProfile(next); setMessage('社区资料已保存；年龄段只用于招募准入，不在公开卡片展示。')
  })
  const apply = (postId: string) => run(`apply:${postId}`, async () => {
    const client = requireClient()
    const accessToken = token()
    const bodyInput = { postId, characterPreference: applicationPreference, note: applicationNote }
    const result = await requestIntents.send(client, accessToken, 'lfg.apply', bodyInput, ({ requestId }) => client.applyToLfg({
      accessToken, requestId, ...bodyInput,
    }))
    setMyApplications(current => [result, ...current.filter(item => item.applicationId !== result.applicationId)])
    setMessage(result.status === 'pending' ? '申请已提交，等待主持人处理。' : `申请状态：${result.status}`)
  })
  const create = () => run('create-lfg', async () => {
    const client = requireClient()
    const accessToken = token()
    const timestamp = new Date(startsAt).getTime()
    if (!Number.isFinite(timestamp)) throw new Error('请选择有效的未来开团时间。')
    const bodyInput = {
      releaseHash, title, summary, locale, timeZone, startsAt: timestamp,
      durationMinutes, playerCapacity, waitlistCapacity, audience,
      safetyTags: ['X-card', 'lines-and-veils'],
    }
    const post = await requestIntents.send(client, accessToken, 'lfg.create', bodyInput, ({ requestId }) => client.createLfg({
      accessToken, requestId, ...bodyInput,
    }))
    setPosts(current => [{ post, accepted: 0, waitlisted: 0, availableSeats: post.playerCapacity }, ...current])
    setMessage('招募已公开；主持人可在下方读取申请、安排正式席位和候补。')
  })
  const loadApplications = (postId: string) => run(`manage:${postId}`, async () => {
    const client = requireClient()
    const accessToken = token()
    const [applications, attendance] = await Promise.all([
      client.applicationsForPost({ accessToken, postId }), client.attendanceForPost({ accessToken, postId }),
    ])
    setHostApplications(applications); setHostAttendance(attendance)
    setManagedPostId(postId)
  })
  const decide = (applicationId: string, decision: 'accept' | 'decline') => run(`decide:${applicationId}`, async () => {
    const client = requireClient()
    const accessToken = token()
    const bodyInput = { applicationId, decision }
    const updated = await requestIntents.send(client, accessToken, 'lfg.decide', bodyInput, ({ requestId }) => client.decideApplication({
      accessToken, requestId, ...bodyInput,
    }))
    setHostApplications(current => current.map(item => item.applicationId === updated.applicationId ? updated : item))
    setMessage(decision === 'accept' ? `申请已进入 ${updated.status === 'accepted' ? '正式席位' : '候补席位'}。` : '申请已婉拒。')
  })
  const bindAcceptedSeats = () => run(`bind:${managedPostId ?? ''}`, async () => {
    const client = requireClient()
    const accessToken = token()
    const post = posts.find(item => item.post.postId === managedPostId)?.post
    if (!post) throw new Error('请先从公开招募卡片进入申请管理。')
    const accepted = hostApplications.filter(item => item.status === 'accepted')
    if (accepted.length === 0) throw new Error('当前没有已接受的正式席位。')
    const bindings = accepted.map(item => ({
      applicationId: item.applicationId,
      actorKey: (actorAssignments[item.applicationId] ?? '').trim(),
    }))
    if (bindings.some(item => !item.actorKey)) throw new Error('请为每个已接受申请填写唯一角色 Key。')
    const bodyInput = { postId: post.postId, roomId: handoffRoomId.trim(), releaseHash: post.releaseHash, bindings }
    const result = await requestIntents.send(client, accessToken, 'lfg.bind', bodyInput, ({ requestId, createdAt }) => client.bindRoomHandoffs({
      accessToken, requestId, ...bodyInput, expiresAt: createdAt + 24 * 60 * 60 * 1_000,
    }))
    setMessage(`已为 ${result.length} 个正式席位绑定在线房间；邀请密钥只会交给对应申请人。`)
  })
  const claimRoom = (application: CommunityLfgApplicationV1) => run(`claim:${application.applicationId}`, async () => {
    const client = requireClient()
    const memberAccessToken = token()
    const claimed = await client.claimRoomHandoff({
      accessToken: memberAccessToken, applicationId: application.applicationId,
    })
    await props.onRoomHandoff?.({ ...claimed, memberAccessToken })
    setMessage('在线席位已载入跑团页；请核对并明确点击加入。')
  })
  const markAttendance = (applicationId: string, status: 'confirmed' | 'no-show') => run(`attendance:${applicationId}:${status}`, async () => {
    const client = requireClient()
    const accessToken = token()
    const bodyInput = { applicationId, status }
    const row = await requestIntents.send(client, accessToken, 'lfg.attendance', bodyInput, ({ requestId }) => client.markAttendance({
      accessToken, requestId, ...bodyInput,
    }))
    setHostAttendance(current => [row, ...current.filter(item => item.attendanceId !== row.attendanceId)])
    if (status === 'no-show') setReplacementAbsentId(applicationId)
    setMessage(status === 'confirmed' ? '已确认成员实际出席。' : '已登记缺席；可从候补中补入席位。')
  })
  const promoteWaitlist = (replacementApplicationId: string) => run(`promote:${replacementAbsentId}:${replacementApplicationId}`, async () => {
    if (!replacementAbsentId) throw new Error('请先选择一个已登记缺席的正式成员。')
    const client = requireClient()
    const accessToken = token()
    const bodyInput = { absentApplicationId: replacementAbsentId, replacementApplicationId }
    const result = await requestIntents.send(client, accessToken, 'lfg.promote', bodyInput, ({ requestId }) => client.promoteWaitlist({
      accessToken, requestId, ...bodyInput,
    }))
    setHostApplications(current => current.map(item => item.applicationId === result.absent.applicationId
      ? result.absent : item.applicationId === result.replacement.applicationId ? result.replacement : item))
    setHostAttendance(current => [result.attendance, ...current.filter(item => item.attendanceId !== result.attendance.attendanceId)])
    setReplacementAbsentId(''); setMessage('候补已原子补入正式席位。')
  })
  const closePost = (status: 'closed' | 'cancelled') => run(`close:${managedPostId}:${status}`, async () => {
    if (!managedPostId) throw new Error('请先选择主持的招募。')
    const client = requireClient()
    const accessToken = token()
    const bodyInput = { postId: managedPostId, status }
    const post = await requestIntents.send(client, accessToken, 'lfg.close', bodyInput, ({ requestId }) => client.closeLfg({
      accessToken, requestId, ...bodyInput,
    }))
    setPosts(current => current.map(item => item.post.postId === post.postId ? { ...item, post } : item))
    setMessage(status === 'closed' ? '场次已正常结束；到达开团时间且已确认出席的成员可以发布实际参团评价。' : '招募已取消，全部有效申请已撤回。')
  })

  return <div className="space-y-4" data-testid="lfg-center">
    <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">社区身份与安全准入</h3>{busy && <Loader2 className="ml-auto h-4 w-4 animate-spin text-accent" />}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-3"><label className="grid gap-2 text-[10px] text-text-muted">公开 handle<input value={handle} onChange={event => setHandle(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">显示名称<input value={displayName} onChange={event => setDisplayName(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">年龄准入<select value={ageBand} onChange={event => setAgeBand(event.target.value as typeof ageBand)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="unknown">未确认</option><option value="adult">已成年</option><option value="minor">未成年</option></select></label><label className="grid gap-2 text-[10px] text-text-muted">语言区域<input value={locale} onChange={event => setLocale(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">时区<input value={timeZone} onChange={event => setTimeZone(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><button disabled={busy != null || !handle.trim() || !displayName.trim()} onClick={() => void saveProfile()} className="self-end rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">保存社区资料</button></div>
      {profile && <p className="mt-3 text-xs text-success">已连接 @{profile.handle} · {profile.displayName}</p>}
    </section>

    <section className="rounded-lg border border-border bg-bg-elevated p-5" data-testid="lfg-my-applications">
      <div className="flex items-center gap-2"><LogIn className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">我的申请与在线席位</h3></div>
      <p className="mt-2 text-xs text-text-muted">只有被正式接受且由主持人分配房间的申请才能领取邀请；领取后仍需在跑团页确认加入。</p>
      <div className="mt-4 space-y-2">{myApplications.map(item => <article key={item.applicationId} className="flex flex-wrap items-center gap-3 rounded border border-border bg-bg-base p-3 text-xs"><div className="min-w-0 flex-1"><strong className="text-text-primary">申请 {item.applicationId}</strong><p className="mt-1 text-text-muted">状态：{item.status} · 角色偏好：{item.characterPreference || '未指定'}</p></div>{item.status === 'accepted' && <button disabled={busy != null} onClick={() => void claimRoom(item)} className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-white disabled:opacity-40"><LogIn className="h-3.5 w-3.5" />进入在线房间</button>}</article>)}{myApplications.length === 0 && <p className="text-xs text-text-muted">刷新招募后会同步当前账号的申请。</p>}</div>
      {participation.some(item => item.post.status === 'closed' && item.attendance?.status === 'confirmed') && <div className="mt-4 border-t border-border pt-4"><strong className="text-xs text-text-primary">已验证参团历史</strong><div className="mt-2 flex flex-wrap gap-2">{participation.filter(item => item.post.status === 'closed' && item.attendance?.status === 'confirmed').map(item => <button key={item.post.postId} onClick={() => setReviewPostId(current => current === item.post.postId ? null : item.post.postId)} className="rounded border border-success/40 px-3 py-2 text-xs text-success">评价实际场次 · {item.post.title}</button>)}</div></div>}
    </section>

    {reviewPostId && (() => { const item = participation.find(row => row.post.postId === reviewPostId); return item ? <CommunityReviewPanel client={props.client} accessToken={props.accessToken} subjectType="actual-play" releaseHash={item.post.releaseHash} postId={item.post.postId} heading={`实际参团评价 · ${item.post.title}`} /> : null })()}

    <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="flex flex-wrap items-center gap-3"><Users className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">公开招募</h3><span className="text-[10px] text-text-muted">申请备注仅主持人可见</span><button disabled={busy != null || !props.client} onClick={() => void refresh()} className="ml-auto flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-primary"><RefreshCw className="h-4 w-4" />刷新招募</button></div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{posts.map(item => {
        const mine = profile?.userId === item.post.creatorId
        const applied = myApplications.find(row => row.postId === item.post.postId)
        return <article key={item.post.postId} className="rounded border border-border bg-bg-base p-4"><div className="flex items-start gap-3"><CalendarClock className="mt-0.5 h-4 w-4 text-accent" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-text-primary">{item.post.title}</h4><span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] text-accent">{item.availableSeats} 个空位</span>{item.post.audience === 'adult-only' && <span className="rounded bg-warning/10 px-2 py-0.5 text-[10px] text-warning">仅成年</span>}</div><p className="mt-2 text-xs leading-5 text-text-muted">{item.post.summary}</p><p className="mt-2 text-[10px] text-text-secondary">{new Date(item.post.startsAt).toLocaleString()} · {item.post.durationMinutes} 分钟 · 正式 {item.accepted}/{item.post.playerCapacity} · 候补 {item.waitlisted}/{item.post.waitlistCapacity}</p><p className="mt-1 text-[10px] text-text-muted">安全工具：{item.post.safetyTags.join('、') || '未声明'}</p><div className="mt-3 flex flex-wrap gap-2">{mine ? <button onClick={() => void loadApplications(item.post.postId)} className="rounded border border-border px-3 py-2 text-xs text-text-primary">管理申请</button> : <button disabled={busy != null || !!applied} onClick={() => void apply(item.post.postId)} className="flex items-center gap-2 rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40"><UserPlus className="h-4 w-4" />{applied ? `已申请 · ${applied.status}` : '申请加入'}</button>}</div></div></div></article>
      })}{posts.length === 0 && <p className="rounded border border-dashed border-border p-8 text-center text-xs text-text-muted lg:col-span-2">点击刷新发现未来场次；满员团可作为候补入口继续展示。</p>}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="grid gap-2 text-[10px] text-text-muted">角色偏好<input value={applicationPreference} onChange={event => setApplicationPreference(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">给主持人的私密备注<input value={applicationNote} onChange={event => setApplicationNote(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label></div>
    </section>

    <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <h3 className="text-sm font-semibold text-text-primary">创建招募</h3><p className="mt-2 text-xs text-text-muted">只有该 Release 的创作者或持有有效主持权益的买家可以开团。</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3"><label className="grid gap-2 text-[10px] text-text-muted">发行物<select value={releaseHash} onChange={event => setReleaseHash(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="">选择本地或手动输入下方哈希</option>{props.releases.map(item => <option key={item.releaseHash} value={item.releaseHash}>{item.title}</option>)}</select></label><label className="grid gap-2 text-[10px] text-text-muted">Release 哈希<input value={releaseHash} onChange={event => setReleaseHash(event.target.value)} className="rounded border border-border bg-bg-base p-2 font-mono text-[10px] text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">开团时间<input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">标题<input value={title} onChange={event => setTitle(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted md:col-span-2">说明<input value={summary} onChange={event => setSummary(event.target.value)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">时长（分钟）<input type="number" min={30} max={1440} value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">正式席位<input type="number" min={1} max={20} value={playerCapacity} onChange={event => setPlayerCapacity(Number(event.target.value))} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">候补席位<input type="number" min={0} max={100} value={waitlistCapacity} onChange={event => setWaitlistCapacity(Number(event.target.value))} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label><label className="grid gap-2 text-[10px] text-text-muted">受众<select value={audience} onChange={event => setAudience(event.target.value as typeof audience)} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="all-ages">全年龄</option><option value="adult-only">仅成年</option></select></label></div>
      <button disabled={busy != null || !releaseHash || !title.trim() || !summary.trim() || !startsAt} onClick={() => void create()} className="mt-4 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">发布招募</button>
    </section>

    {managedPostId && <section className="rounded-lg border border-border bg-bg-elevated p-5"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-text-primary">申请、出席与候补管理</h3><button disabled={busy != null} onClick={() => void closePost('closed')} className="ml-auto rounded border border-success/40 px-3 py-2 text-xs text-success">正常结束场次</button><button disabled={busy != null} onClick={() => void closePost('cancelled')} className="rounded border border-warning/40 px-3 py-2 text-xs text-warning">取消招募</button></div><div className="mt-4 space-y-2">{hostApplications.map(item => { const attendance = hostAttendance.find(row => row.applicationId === item.applicationId); return <article key={item.applicationId} className="flex flex-wrap items-center gap-3 rounded border border-border bg-bg-base p-3 text-xs"><div className="min-w-0 flex-1"><strong className="text-text-primary">{item.userId}</strong><p className="mt-1 text-text-muted">角色：{item.characterPreference || '未指定'} · 备注：{item.note || '无'}{attendance ? ` · 出席：${attendance.status}` : ''}</p>{item.status === 'accepted' && <label className="mt-2 grid max-w-sm gap-1 text-[10px] text-text-muted">在线角色 Key<input aria-label={`角色席位 ${item.applicationId}`} value={actorAssignments[item.applicationId] ?? ''} onChange={event => setActorAssignments(current => ({ ...current, [item.applicationId]: event.target.value }))} placeholder="例如 investigator.chen" className="rounded border border-border bg-bg-surface p-2 font-mono text-[10px] text-text-primary" /></label>}</div><span className="text-text-muted">{item.status}</span>{item.status === 'pending' && <><button onClick={() => void decide(item.applicationId, 'accept')} className="flex items-center gap-1 rounded bg-success px-2 py-1 text-white"><Check className="h-3 w-3" />接受</button><button onClick={() => void decide(item.applicationId, 'decline')} className="flex items-center gap-1 rounded border border-border px-2 py-1 text-text-primary"><X className="h-3 w-3" />婉拒</button></>}{item.status === 'accepted' && attendance?.status !== 'replaced' && <><button onClick={() => void markAttendance(item.applicationId, 'confirmed')} className="rounded border border-success/40 px-2 py-1 text-success">确认出席</button><button onClick={() => void markAttendance(item.applicationId, 'no-show')} className="rounded border border-warning/40 px-2 py-1 text-warning">登记缺席</button></>}{item.status === 'waitlisted' && replacementAbsentId && <button onClick={() => void promoteWaitlist(item.applicationId)} className="rounded bg-accent px-2 py-1 text-white">补入空缺</button>}</article>})}{hostApplications.length === 0 && <p className="text-xs text-text-muted">暂无申请。</p>}</div>{hostApplications.some(item => item.status === 'accepted') && <div className="mt-4 rounded border border-accent/30 bg-accent/5 p-3"><div className="flex items-center gap-2"><Link2 className="h-4 w-4 text-accent" /><strong className="text-xs text-text-primary">分配权威在线房间</strong></div><p className="mt-1 text-[10px] leading-4 text-text-muted">当前账号必须同时拥有该在线房间的 GM 席位。服务器验证 Release、申请人与角色唯一性；邀请密钥不会返回主持人界面。</p><div className="mt-3 flex flex-wrap gap-2"><input aria-label="交接在线房间 ID" value={handoffRoomId} onChange={event => setHandoffRoomId(event.target.value)} placeholder="room..." className="min-w-[240px] flex-1 rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /><button disabled={busy != null || !handoffRoomId.trim() || hostApplications.filter(item => item.status === 'accepted').some(item => !(actorAssignments[item.applicationId] ?? '').trim())} onClick={() => void bindAcceptedSeats()} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">分配在线席位</button></div></div>}</section>}
    {message && <p className="rounded border border-success/30 bg-success/10 p-3 text-xs text-success">{message}</p>}
    {error && <p className="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}
  </div>
}
