import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { liveQuery } from 'dexie'
import { BookOpen, ImagePlus, Loader2, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import type { Work, WorkspaceScope } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { saveWorkCoverDraftV1 } from '../../lib/work-cover/drafts'
import { adoptWorkCoverV1, prepareWorkCoverAdoptionV1 } from '../../lib/work-cover/adoption'
import { canAdoptWorkCoverImageV1, readWorkCoverCardStateV1, readWorkCoverPreviewBlobV1 } from '../../lib/work-cover/card-state'
import { readWorkCoverConnectionV1, workCoverConnectionLabelV1 } from '../../lib/work-cover/connection'
import './work-cover-card.css'

type Snapshot = Awaited<ReturnType<typeof readWorkCoverCardStateV1>>
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function savedFailure(code: string | null) {
  if (code === 'image-http-401' || code === 'image-http-403') return '上次图片请求未获授权，请在设置中检查凭据与图片权限。'
  if (code === 'image-http-402') return '上次图片请求额度不足，请检查连接账户。'
  if (code === 'image-response-rejected') return '上次图片响应不符合已登记协议，原答已保留。'
  if (code === 'image-not-dispatched') return '上次生成在发送前已停止。'
  return '上次图片生成未完成，请查看连接与输入。'
}

export default function WorkCoverCard({ work, onManual, children }: { work: Work; onManual: () => void; children: ReactNode }) {
  const scope = useMemo<WorkspaceScope>(() => ({ projectId: work.projectId, worldId: work.worldId, workId: work.id! }), [work.projectId, work.worldId, work.id])
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [prompt, setPrompt] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<'generate' | 'adopt' | 'recover' | null>(null)
  const [preview, setPreview] = useState(''), [showCandidate, setShowCandidate] = useState(true), [refresh, setRefresh] = useState(0)
  const dirty = useRef(false), baseline = useRef<number | null>(null), seenRevision = useRef(0)
  const busyRef = useRef(false), mounted = useRef(true), controller = useRef<AbortController | null>(null)
  useAIConfigStore()
  let connectionLabel = '', connectionError = ''
  try { connectionLabel = workCoverConnectionLabelV1() } catch (cause) { connectionError = message(cause) }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    const changed = () => setRefresh(value => value + 1)
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  useEffect(() => {
    const subscription = liveQuery(() => readWorkCoverCardStateV1(scope, open || busy != null)).subscribe({
      next: next => {
        const revision = next.draft?.revision ?? 0
        if (revision < seenRevision.current) return
        seenRevision.current = revision
        setSnapshot(next)
        if (!dirty.current) { setPrompt(next.brief?.prompt ?? ''); baseline.current = next.draft?.revision ?? null }
      },
      error: cause => setError(message(cause)),
    })
    return () => subscription.unsubscribe()
  }, [scope, open, busy, refresh])
  const asset = snapshot?.asset
  const candidate = asset && asset.id !== snapshot?.draft?.adoptedAssetId ? asset : null
  useEffect(() => {
    let current = true, url = ''
    setPreview('')
    if (candidate) void readWorkCoverPreviewBlobV1(scope, candidate).then(blob => {
      if (!current) return
      url = URL.createObjectURL(blob); setPreview(url)
    }).catch(cause => { if (current) setError(message(cause)) })
    return () => { current = false; if (url) URL.revokeObjectURL(url) }
  }, [scope, candidate])
  const run = snapshot?.run, pending = run?.state === 'dispatch-intent'
  const recoverable = run && ['response-observed', 'materializing'].includes(run.state)
  const visiblePreview = Boolean(candidate && preview && showCandidate)
  const adoptable = Boolean(candidate && canAdoptWorkCoverImageV1(candidate))
  const sourceWork = snapshot?.work ?? work

  const generate = async () => {
    if (!snapshot || !prompt.trim() || busyRef.current || pending) return
    busyRef.current = true; setBusy('generate'); setError(''); setNotice('')
    const abort = new AbortController(); controller.current = abort
    try {
      const connection = readWorkCoverConnectionV1()
      const draft = await saveWorkCoverDraftV1({ scope, prompt, expectedRevision: baseline.current, expectedWorkUpdatedAt: snapshot.work.updatedAt })
      dirty.current = false; baseline.current = draft.revision; seenRevision.current = draft.revision
      const { prepareCoverRunV1, submitCoverImageOnceV1 } = await import('../../lib/work-cover/run')
      const authorization = await prepareCoverRunV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision,
        connection, currentConnection: readWorkCoverConnectionV1, signal: abort.signal })
      await submitCoverImageOnceV1(authorization, abort.signal)
      const { materializeCoverCandidateV1 } = await import('../../lib/work-cover/materialize')
      await materializeCoverCandidateV1({ scope, runId: authorization.runId })
      if (mounted.current) { setShowCandidate(true); setNotice('图片已保存，确认后可用作封面。') }
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { busyRef.current = false; controller.current = null; if (mounted.current) { setBusy(null); setRefresh(value => value + 1) } }
  }
  const recover = async () => {
    if (!run || busyRef.current) return
    busyRef.current = true; setBusy('recover'); setError('')
    try {
      const { materializeCoverCandidateV1 } = await import('../../lib/work-cover/materialize')
      await materializeCoverCandidateV1({ scope, runId: run.runId })
      if (mounted.current) { setShowCandidate(true); setNotice('已恢复原请求的图片，未重新生成。') }
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { busyRef.current = false; if (mounted.current) { setBusy(null); setRefresh(value => value + 1) } }
  }
  const endWait = async () => {
    if (!run || busyRef.current) return
    busyRef.current = true; setBusy('recover'); setError('')
    try {
      const { acknowledgeExpiredCoverWaitV1 } = await import('../../lib/work-cover/run')
      await acknowledgeExpiredCoverWaitV1(scope, run.runId)
      if (mounted.current) setNotice('已结束本机等待；原请求结果仍未知，未重新发送。')
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { busyRef.current = false; if (mounted.current) { setBusy(null); setRefresh(value => value + 1) } }
  }
  const reviewReturned = async () => {
    if (!snapshot?.draft || !snapshot.returnedAsset?.id || busyRef.current) return
    busyRef.current = true; setBusy('recover'); setError('')
    try {
      const { selectReturnedWorkCoverCandidateV1 } = await import('../../lib/work-cover/select-candidate')
      await selectReturnedWorkCoverCandidateV1({ scope, draftId: snapshot.draft.id!, expectedDraftRevision: snapshot.draft.revision,
        expectedWorkUpdatedAt: snapshot.work.updatedAt, assetId: snapshot.returnedAsset.id })
      if (mounted.current) { setShowCandidate(true); setNotice('已载入较早输入生成的图片供你查看；确认后才会用作封面。') }
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { busyRef.current = false; if (mounted.current) { setBusy(null); setRefresh(value => value + 1) } }
  }
  const confirmCover = async () => {
    if (!snapshot?.draft || !candidate || !adoptable || !preview || busyRef.current) return
    busyRef.current = true; setBusy('adopt'); setError('')
    try {
      const draft = snapshot.draft
      const pendingIntent = draft.pendingAdoptionJson ? JSON.parse(draft.pendingAdoptionJson) as { operationKey?: unknown } : null
      const confirmation = typeof pendingIntent?.operationKey === 'string'
        ? { draftId: draft.id!, operationKey: pendingIntent.operationKey }
        : await prepareWorkCoverAdoptionV1({ scope, draftId: draft.id!, expectedDraftRevision: draft.revision,
          assetId: candidate.id!, expectedWorkUpdatedAt: snapshot.work.updatedAt })
      await adoptWorkCoverV1(scope, confirmation)
      if (mounted.current) setNotice('封面已保存。')
    } catch (cause) { if (mounted.current) setError(message(cause)) }
    finally { busyRef.current = false; if (mounted.current) { setBusy(null); setRefresh(value => value + 1) } }
  }
  const reload = async () => {
    if (busyRef.current) return
    setError('')
    try {
      const current = await readWorkCoverCardStateV1(scope, true)
      const draft = current.draft && current.brief && current.draft.expectedWorkUpdatedAt !== current.work.updatedAt
        ? await saveWorkCoverDraftV1({ scope, prompt: current.brief.prompt, expectedRevision: current.draft.revision, expectedWorkUpdatedAt: current.work.updatedAt })
        : current.draft
      if (!mounted.current) return
      dirty.current = false; baseline.current = draft?.revision ?? null; seenRevision.current = draft?.revision ?? 0
      setPrompt(current.brief?.prompt ?? ''); setShowCandidate(true); setNotice('已重新载入作品与提示词，请查看后再操作。'); setRefresh(value => value + 1)
    } catch (cause) { if (mounted.current) setError(message(cause)) }
  }

  return <div className="sf-cover-card">
    <div className="lf-library-book">
      <div className="sf-cover-column">
        <button type="button" className="lf-library-cover" aria-label={visiblePreview ? `查看未采用封面：${work.title}` : `修改封面：${work.title}`}
          onClick={() => { if (visiblePreview) setOpen(true); else onManual() }}>
          {visiblePreview ? <img src={preview} alt={`${work.title}的未采用封面`} loading="lazy"/> : sourceWork.coverImage ? <img src={sourceWork.coverImage} alt="" loading="lazy"/> : <span className="lf-library-cover-placeholder"><BookOpen size={28} aria-hidden="true"/><span>暂无封面</span></span>}
          {visiblePreview ? <span className="sf-cover-unadopted">未采用</span> : <span className="lf-library-cover-action"><ImagePlus size={14} aria-hidden="true"/>{sourceWork.coverImage ? '更换封面' : '上传封面'}</span>}
        </button>
        <button type="button" className="sf-cover-toggle" aria-expanded={open} aria-controls={`cover-prompt-${scope.workId}`} onClick={() => setOpen(value => !value)}><Sparkles size={13} aria-hidden="true"/>{busy === 'generate' ? '生成中…' : 'AI封面'}</button>
      </div>
      {children}
    </div>
    {open && <div className="sf-cover-prompt" id={`cover-prompt-${scope.workId}`}>
      <label className="sr-only" htmlFor={`cover-description-${scope.workId}`}>封面提示词：{work.title}</label>
      <textarea id={`cover-description-${scope.workId}`} value={prompt} maxLength={8_000} rows={3} disabled={busy != null || pending}
        placeholder="描述你想要的封面画面…" onChange={event => { dirty.current = true; setPrompt(event.target.value) }}/>
      <div className="sf-cover-actions"><button type="button" className="lf-action lf-action-primary" disabled={!snapshot || !prompt.trim() || busy != null || pending || Boolean(connectionError)} onClick={() => void generate()}>
        {busy === 'generate' && <Loader2 size={14} className="animate-spin" aria-hidden="true"/>}{busy === 'generate' ? '生成中…' : run?.state === 'outcome-unknown' ? '新生成一张' : '生成'}
      </button>{busy === 'generate' && <button type="button" className="sf-cover-link" onClick={() => controller.current?.abort()}>停止等待</button>}
        {recoverable && <button type="button" className="sf-cover-link" disabled={busy != null} onClick={() => void recover()}>恢复已返回图片</button>}
      </div>
      {connectionError ? <p className="sf-cover-note">{connectionError} <Link to="/home/settings">配置图片连接</Link></p> : <p className="sf-cover-note">{connectionLabel}</p>}
      <details className="sf-cover-disclosure"><summary>生成会发送哪些资料</summary><p>作品名、简介、题材和上方提示词；不读取或发送正文。</p><pre>{JSON.stringify({ 作品名: sourceWork.title, 简介: sourceWork.description, 题材: sourceWork.genres, 提示词: prompt.trim() }, null, 2)}</pre></details>
      {pending && !busy && <p className="sf-cover-note">原图片请求的结果尚未确认，不会自动重发。等待超过三分钟后可 <button type="button" className="sf-cover-link" onClick={() => void endWait()}>结束等待</button>。</p>}
      {run?.state === 'outcome-unknown' && <p className="sf-cover-note">上次请求结果未知；新生成是另一笔请求，费用未知。</p>}
      {run?.state === 'failed' && !error && <p className="sf-cover-note">{savedFailure(run.errorCode)}未自动重发，原封面已保留。</p>}
      {snapshot?.returnedAsset && <p className="sf-cover-note">较早输入的图片已保存。<button type="button" className="sf-cover-link" disabled={busy != null} onClick={() => void reviewReturned()}>查看已保存图片</button></p>}
    </div>}
    {visiblePreview && <div className="sf-cover-candidate-actions">
      <button type="button" className="lf-action" disabled={!adoptable || busy != null} onClick={() => void confirmCover()}>{busy === 'adopt' ? '保存中…' : '用作封面'}</button>
      <button type="button" className="sf-cover-link" disabled={busy != null} onClick={() => setShowCandidate(false)}>保留旧封面</button>
      {!adoptable && <p className="sf-cover-note">图片已保留；封面须在 5 MiB、2000 万像素与编码上限以内。</p>}
    </div>}
    {(error || notice) && <p className="sf-cover-note" role={error ? 'alert' : 'status'}>{error || notice} {error && <button type="button" className="sf-cover-link" disabled={busy != null} onClick={() => void reload()}>重新载入</button>}</p>}
  </div>
}
