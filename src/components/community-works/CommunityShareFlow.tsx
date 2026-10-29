import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { CommunityPublicSnapshotV1 } from '../../lib/community-works/public-snapshot'
import { actOnMySubmission, communityAuth, communityClientConfig, readMySubmissions,
  readMySubmissionStatus, submitSelectedSnapshot, type CommunitySubmissionRow } from '../../lib/community-works/client'
import { sealPublicSnapshotV1, type SealedPublicSnapshotV1 } from '../../lib/community-works/snapshot-seal'
import { useDialog } from '../shared/Dialog'

function Account({ session, onSession }: { session: Session | null; onSession: (value: Session | null) => void }) {
  const client = communityAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!client) return
    let active = true
    void client.auth.getSession().then(({ data }) => { if (active) onSession(data.session) })
    const { data } = client.auth.onAuthStateChange((_event, next) => { if (active) onSession(next) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [client, onSession])
  if (!client) return <p role="alert">社区账号服务尚未配置；此客户端目前不能投稿。</p>
  if (session) return <div className="flex items-center justify-between gap-3 text-xs">
    <span>社区账号已登录</span><button type="button" onClick={() => void client.auth.signOut()}>退出登录</button>
  </div>
  return <section aria-label="社区账号登录" className="space-y-2 border border-border rounded-lg p-3">
    <h4 className="font-medium">登录社区账号</h4>
    <p className="text-xs text-text-muted">邮箱只用于身份验证，不会出现在公开作品里。</p>
    <label className="block text-xs">邮箱<input className="w-full p-2 border border-border rounded bg-bg-base" type="email"
      autoComplete="email" value={email} onChange={event => setEmail(event.target.value.trim())} /></label>
    {sent && <label className="block text-xs">邮件验证码<input className="w-full p-2 border border-border rounded bg-bg-base"
      inputMode="numeric" autoComplete="one-time-code" value={code}
      onChange={event => setCode(event.target.value.trim())} /></label>}
    <div className="flex gap-2">
      <button type="button" disabled={busy || !email.includes('@')} onClick={() => {
        setBusy(true); setMessage('')
        void client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }).then(({ error }) => {
          if (error) throw error
          setSent(true); setMessage('验证码已发送，请检查邮箱。')
        }).catch(() => setMessage('验证码暂时无法发送。')).finally(() => setBusy(false))
      }}>{sent ? '重新发送' : '发送验证码'}</button>
      {sent && <button type="button" disabled={busy || code.length < 6} onClick={() => {
        setBusy(true); setMessage('')
        void client.auth.verifyOtp({ email, token: code, type: 'email' }).then(({ error }) => {
          if (error) throw error
          setCode(''); setMessage('验证成功。')
        }).catch(() => setMessage('验证码无效或已过期。')).finally(() => setBusy(false))
      }}>验证并登录</button>}
    </div>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>
}

function SnapshotPreview({ snapshot }: { snapshot: CommunityPublicSnapshotV1 }) {
  if (snapshot.kind === 'novel') return <div className="space-y-2">
    <h4 className="font-semibold">{snapshot.title}</h4><p className="text-xs">{snapshot.description}</p>
    <p className="text-xs">共 {snapshot.chapters.length} 章；展开可逐字检查实际公开正文。</p>
    {snapshot.chapters.map((chapter, index) => <details key={index} className="border border-border rounded p-2">
      <summary>{index + 1}. {chapter.title}</summary><pre className="whitespace-pre-wrap break-words text-xs mt-3">{chapter.content}</pre>
    </details>)}
  </div>
  return <div className="space-y-2">
    <h4 className="font-semibold">《{snapshot.book.title}》拆书分析</h4>
    <p className="text-xs">作者：{snapshot.book.author || '未填写'} · 分析 v{snapshot.analysis.version} · {snapshot.analysis.depth === 'deep' ? '深层' : '浅层'}</p>
    {snapshot.dimensions.map((dimension, index) => <details key={dimension.key} className="border border-border rounded p-2">
      <summary>{index + 1}. {dimension.key} · {dimension.selected ? `${dimension.entries.length} 条` : '未选'}</summary>
      {dimension.entries.map((entry, position) => <div key={position} className="mt-2"><h5>{entry.label}</h5>
        <pre className="whitespace-pre-wrap break-words text-xs">{entry.text}</pre></div>)}
    </details>)}
    {snapshot.authorCommentary && <details><summary>作者点评</summary><pre className="whitespace-pre-wrap break-words text-xs">{snapshot.authorCommentary}</pre></details>}
  </div>
}

function MySubmissions({ session, revision }: { session: Session; revision: string }) {
  const dialog = useDialog()
  const [rows, setRows] = useState<CommunitySubmissionRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [appealing, setAppealing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const refresh = useCallback(async () => {
    setState('loading')
    try { setRows(await readMySubmissions(session)); setState('ready') }
    catch { setState('error') }
  }, [session])
  useEffect(() => { void refresh() }, [refresh, revision])
  const act = async (row: CommunitySubmissionRow, action: 'withdraw' | 'appeal') => {
    if (busy || (action === 'appeal' && !reason.trim())) return
    if (action === 'withdraw' && !await dialog.confirm({
      title: '确认撤回这份投稿？', message: '撤回后，已公开的作品会立即从社区页面隐藏。',
      confirmText: '撤回投稿', cancelText: '取消', tone: 'danger',
    })) return
    setBusy(true); setMessage('')
    try {
      await actOnMySubmission(session, row, action, reason)
      setMessage(action === 'withdraw' ? '投稿已撤回。' : '申诉已提交，等待人工复核。')
      setAppealing(null); setReason(''); await refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请稍后重试。') }
    finally { setBusy(false) }
  }
  return <details className="border border-border rounded-lg p-3 text-xs">
    <summary>我的投稿与审核状态</summary>
    <button type="button" onClick={() => void refresh()}>刷新列表</button>
    {state === 'loading' && <p role="status">正在读取投稿…</p>}
    {state === 'error' && <p role="alert">投稿列表暂时无法读取。</p>}
    {state === 'ready' && rows.length === 0 && <p>此账号还没有投稿。</p>}
    {rows.map(row => <div key={row.id} className="border-t border-border mt-2 pt-2 space-y-2">
      <p>{row.kind === 'novel' ? '原创小说' : '拆书分析'} · {row.status} · {row.id}</p>
      {row.status !== 'withdrawn' && <button type="button" disabled={busy}
        onClick={() => void act(row, 'withdraw')}>撤回这份投稿</button>}
      {['needs_changes', 'rejected', 'taken_down'].includes(row.status) && <button type="button"
        disabled={busy} onClick={() => setAppealing(row.id)}>申诉</button>}
      {appealing === row.id && <label className="block">申诉理由
        <textarea className="w-full p-2 border border-border rounded bg-bg-base" maxLength={2000}
          value={reason} onChange={event => setReason(event.target.value)} />
        <button type="button" disabled={busy || !reason.trim()} onClick={() => void act(row, 'appeal')}>提交申诉</button>
      </label>}
    </div>)}
    {message && <p role="status">{message}</p>}
  </details>
}

/** Only an explicit, sealed preview can be submitted. All steps keep the local work untouched. */
export default function CommunityShareFlow({ selectionRevision, buildSnapshot }: {
  selectionRevision: string
  buildSnapshot: () => Promise<CommunityPublicSnapshotV1>
}) {
  const [seal, setSeal] = useState<SealedPublicSnapshotV1 | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [penName, setPenName] = useState('')
  const [license, setLicense] = useState<'all-rights-reserved' | 'cc-by-4.0'>('all-rights-reserved')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<{ submissionId: string; status: string } | null>(null)
  const [listRevision, setListRevision] = useState('')
  useEffect(() => { setSeal(null); setReceipt(null); setMessage('') }, [selectionRevision, rights])
  const config = communityClientConfig()
  const configured = config !== null
  return <div className="space-y-4 border-t border-border pt-4">
    <p className="text-xs text-text-muted">只分享这里勾选的公开内容。原项目、未选章节、原文文件、笔记、提示词和本地设置不会上传。</p>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} />
      我确认拥有所选内容的公开发布权；拆书不会上传原文，引用和第三方内容需另行取得权利。</label>
    {config && <a className="text-xs underline" href={`${config.apiOrigin}/community-works/policy`}
      target="_blank" rel="noopener noreferrer">阅读社区内容与审核规则 ↗</a>}
    <button type="button" disabled={!rights || busy} onClick={() => {
      setBusy(true); setMessage(''); setSeal(null)
      void buildSnapshot().then(sealPublicSnapshotV1).then(setSeal)
        .catch(error => setMessage(error instanceof Error ? error.message : '预览失败'))
        .finally(() => setBusy(false))
    }}>生成公开预览</button>
    {seal && <section aria-label="投稿公开预览" className="max-h-96 overflow-y-auto bg-bg-elevated rounded-lg p-3">
      <p className="text-xs mb-2">仅以下内容将进入私有待审稿 · {(seal.byteLength / 1024 / 1024).toFixed(2)} MiB · SHA-256 {seal.sha256}</p>
      <SnapshotPreview snapshot={seal.snapshot} />
    </section>}
    <Account session={session} onSession={setSession} />
    {session && <MySubmissions session={session} revision={listRevision} />}
    {seal && <>
      <label className="block text-xs">公开笔名<input className="w-full p-2 border border-border rounded bg-bg-base"
        maxLength={120} value={penName} onChange={event => setPenName(event.target.value)} /></label>
      <label className="block text-xs">公开许可<select className="w-full p-2 border border-border rounded bg-bg-base"
        value={license} onChange={event => setLicense(event.target.value as typeof license)}>
        <option value="all-rights-reserved">保留所有权利</option><option value="cc-by-4.0">CC BY 4.0 署名许可</option>
      </select></label>
      <p className="text-xs text-text-muted">提交后先进入人工审核。审核通过之前，公开页面不会显示这份内容。</p>
      <button type="button" disabled={!configured || !session || !penName.trim() || busy} onClick={() => {
        if (!session || !seal) return
        setBusy(true); setProgress(0); setMessage('正在复核本地内容…')
        void submitSelectedSnapshot({ seal, currentSnapshot: buildSnapshot, session,
          publicPenName: penName, license, onProgress: setProgress })
          .then(result => { setReceipt(result); setListRevision(result.submissionId); setMessage('已提交私有待审稿，等待审核。') })
          .catch(error => setMessage(error instanceof Error ? error.message : '投稿失败；请稍后重试。'))
          .finally(() => setBusy(false))
      }}>{busy ? `正在处理 ${progress}%` : '确认并提交待审'}</button>
    </>}
    {receipt && session && <div role="status" className="border border-accent rounded p-3 text-xs">
      <p>投稿编号：{receipt.submissionId} · 状态：{receipt.status}</p>
      <button type="button" onClick={() => {
        void readMySubmissionStatus(session, receipt.submissionId)
          .then(next => setReceipt(next)).catch(() => setMessage('状态暂时无法读取，请稍后再试。'))
      }}>刷新审核状态</button>
    </div>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>
}
