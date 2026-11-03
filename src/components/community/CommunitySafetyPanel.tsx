import { useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Scale, Send, ShieldAlert } from 'lucide-react'
import type { CommunityReportV1, CommunityReportViewV1 } from '../../lib/community/authority'
import type { CommunityHttpClientV1, CommunityHttpErrorV1 } from '../../lib/community/http-client'
import { createCommunityRequestIntentsV1 } from '../../lib/community/request-intent'

type SafetyClientV1 = Pick<CommunityHttpClientV1, 'createReport' | 'myReports' | 'createAppeal' | 'myAppeals'>

function messageOf(error: unknown): string {
  const typed = error as Partial<CommunityHttpErrorV1>
  if (typed.code === 'appeal_forbidden') return '当前账号不是这项处罚的主体，或该处罚尚不能申诉。'
  return error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : String(error)
}

export default function CommunitySafetyPanel(props: {
  client: SafetyClientV1 | null
  accessToken: string
}) {
  const [subjectType, setSubjectType] = useState<CommunityReportV1['subjectType']>('profile')
  const [subjectId, setSubjectId] = useState('')
  const [category, setCategory] = useState<CommunityReportV1['category']>('harassment')
  const [details, setDetails] = useState('')
  const [reports, setReports] = useState<CommunityReportViewV1[]>([])
  const [appealReportId, setAppealReportId] = useState('')
  const [appealStatement, setAppealStatement] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestIntents = useRef(createCommunityRequestIntentsV1())


  const token = () => {
    if (!props.accessToken.trim()) throw new Error('请输入当前账号的访问凭据。')
    return props.accessToken.trim()
  }
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await operation() } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }
  const refresh = () => run(async () => {
    if (!props.client) throw new Error('请先配置社区服务地址。')
    const accessToken = token()
    const [nextReports] = await Promise.all([props.client.myReports(accessToken), props.client.myAppeals(accessToken)])
    setReports(nextReports)
  })
  const submitReport = () => run(async () => {
    const client = props.client
    if (!client) throw new Error('请先配置社区服务地址。')
    const accessToken = token()
    const bodyInput = { subjectType, subjectId: subjectId.trim(), category, details: details.trim() }
    await requestIntents.current.send('safety.report', bodyInput, ({ requestId }) => client.createReport({
      accessToken, requestId, ...bodyInput,
    }))
    setMessage('举报已进入治理队列；自由正文只对举报者和治理人员可见。')
    setReports(await client.myReports(accessToken))
  })
  const submitAppeal = () => run(async () => {
    const client = props.client
    if (!client) throw new Error('请先配置社区服务地址。')
    const accessToken = token()
    const bodyInput = { reportId: appealReportId, statement: appealStatement.trim() }
    await requestIntents.current.send('safety.appeal', bodyInput, ({ requestId }) => client.createAppeal({
      accessToken, requestId, ...bodyInput,
    }))
    setMessage('申诉已提交到独立复核队列。')
    setReports(await client.myReports(accessToken))
  })

  return <div className="space-y-4" data-testid="community-safety-center">
    <section className="rounded-lg border border-warning/30 bg-bg-elevated p-5">
      <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 text-warning" /><div><h3 className="text-sm font-semibold text-text-primary">举报与安全治理</h3><p className="mt-1 text-xs leading-5 text-text-muted">请填写界面显示的精确对象 ID。网关审计只记录案件 ID 和结果，不记录访问凭据、举报正文或申诉正文。</p></div>{busy && <Loader2 className="ml-auto h-4 w-4 animate-spin text-accent" />}</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-[10px] text-text-muted">对象类型<select value={subjectType} onChange={event => setSubjectType(event.target.value as CommunityReportV1['subjectType'])} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="profile">用户资料</option><option value="listing">市场目录</option><option value="lfg">招募</option><option value="room">在线房间</option><option value="review">评价</option></select></label><label className="grid gap-1 text-[10px] text-text-muted">对象 ID<input aria-label="举报对象 ID" value={subjectId} onChange={event => setSubjectId(event.target.value)} className="rounded border border-border bg-bg-base p-2 font-mono text-[10px] text-text-primary" /></label><label className="grid gap-1 text-[10px] text-text-muted">类别<select value={category} onChange={event => setCategory(event.target.value as CommunityReportV1['category'])} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"><option value="harassment">骚扰</option><option value="unsafe-content">不安全内容</option><option value="rights">权利 / 版权</option><option value="fraud">欺诈</option><option value="minor-safety">未成年人安全</option><option value="other">其他</option></select></label><label className="grid gap-1 text-[10px] text-text-muted md:col-span-2">事实说明<textarea value={details} onChange={event => setDetails(event.target.value)} rows={4} maxLength={4000} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /></label></div>
      <button disabled={busy || !props.client || !props.accessToken.trim() || !subjectId.trim() || !details.trim()} onClick={() => void submitReport()} className="mt-3 flex items-center gap-2 rounded bg-warning px-4 py-2 text-xs text-white disabled:opacity-40"><Send className="h-4 w-4" />提交举报</button>
    </section>

    <section className="rounded-lg border border-border bg-bg-elevated p-5">
      <div className="flex items-center gap-2"><Scale className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">我的案件与处罚通知</h3><button disabled={busy || !props.client || !props.accessToken.trim()} onClick={() => void refresh()} className="ml-auto flex items-center gap-1 rounded border border-border px-3 py-2 text-xs text-text-primary disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />刷新</button></div>
      <div className="mt-4 space-y-2">{reports.map(report => <article key={`${report.relation}:${report.reportId}`} className="rounded border border-border bg-bg-base p-3"><div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-[10px] text-text-primary">{report.reportId}</strong><span className="rounded bg-bg-surface px-2 py-0.5 text-[9px] text-text-muted">{report.relation === 'reporter' ? '我提交的举报' : '针对我的处罚'}</span><span className="text-[9px] text-text-muted">{report.status}{report.action ? ` · ${report.action}` : ''}</span></div><p className="mt-2 text-[10px] text-text-muted">对象：{report.subjectType} / {report.subjectId} · 类别：{report.category}{report.reasonCode ? ` · 理由：${report.reasonCode}` : ''}</p>{report.details && <p className="mt-2 text-xs leading-5 text-text-secondary">{report.details}</p>}{report.relation === 'subject' && report.status === 'actioned' && <button onClick={() => setAppealReportId(report.reportId)} className="mt-2 rounded border border-accent px-3 py-1.5 text-xs text-accent">对此处罚申诉</button>}</article>)}{reports.length === 0 && <p className="text-xs text-text-muted">尚未加载案件；被冻结账号也可以从这里读取处罚通知并申诉。</p>}</div>
      {appealReportId && <div className="mt-4 rounded border border-accent/30 bg-accent/5 p-3"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-accent" /><strong className="text-xs text-text-primary">申诉 {appealReportId}</strong></div><textarea aria-label="申诉陈述" value={appealStatement} onChange={event => setAppealStatement(event.target.value)} maxLength={4000} rows={4} className="mt-3 w-full rounded border border-border bg-bg-base p-2 text-xs text-text-primary" /><button disabled={busy || !appealStatement.trim()} onClick={() => void submitAppeal()} className="mt-2 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">提交独立复核</button></div>}
    </section>
    {message && <p className="rounded border border-success/30 bg-success/10 p-3 text-xs text-success">{message}</p>}
    {error && <p className="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger">{error}</p>}
  </div>
}
