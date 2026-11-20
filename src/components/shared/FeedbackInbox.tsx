import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { APP_BUILD_ID } from '../../lib/version'
import { clientMetadata } from '../../lib/feedback/client-support'
import { feedbackBuildMessage, feedbackStageLabels } from '../../lib/feedback/followup-contract'
import { feedbackSnapshot, subscribeFeedback, rememberFeedbackNotices } from '../../lib/feedback/followup-storage'
import { installFeedbackFollowup, readFeedbackProgress, refreshFeedbacks, removeExpiredFeedback, stopFeedbackFollowup } from '../../lib/feedback/followup-service'

const button = 'rounded border border-border px-3 py-2 disabled:opacity-50'
export default function FeedbackInbox({ monitor = false }: { monitor?: boolean }) {
  const { entries, error: storageError } = useSyncExternalStore(subscribeFeedback, feedbackSnapshot)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [notice, setNotice] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const unread = entries.filter(row => row.state === 'active' && row.progress && row.progress.revision > row.readRevision).length
  useEffect(() => {
    if (!monitor) return
    const fresh = entries.filter(row => row.state === 'active' && row.progress && row.progress.revision > row.readRevision && row.progress.revision > row.notifiedRevision)
    if (!fresh.length) return
    void rememberFeedbackNotices(fresh.map(row => ({ id: row.id, revision: row.progress!.revision })))
      .then(() => { if (mounted.current) setNotice(true) })
      .catch(() => { if (mounted.current) setError('本机未能保存提醒状态，请在我的反馈中查看进展。') })
  }, [entries, monitor])
  useEffect(() => {
    if (!monitor) return
    const stop = installFeedbackFollowup(() => setError('反馈进展读取失败，原记录已保留。可以手动重试。'))
    return stop
  }, [monitor])
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch { setError('操作未完成，记录已保留。请检查网络或本机存储后重试。') }
    finally { setBusy(false) }
  }
  return <>
    {!monitor && <button type="button" className={button} onClick={() => setOpen(value => !value)}>我的反馈{unread ? `（${unread} 条新进展）` : ''}</button>}
    {monitor && notice && !open && unread > 0 && <aside role="status" className="fixed top-4 right-4 z-50 max-w-sm rounded-lg border border-border bg-bg-surface p-4 text-text-primary shadow-lg">
      <p>你的反馈有 {unread} 条新进展。</p><button type="button" className={button} onClick={() => setOpen(true)}>查看我的反馈</button>
      <button type="button" className={button} onClick={() => setNotice(false)}>稍后查看</button>
    </aside>}
    {open && <section role="dialog" aria-label="我的反馈" aria-modal="false" className={monitor ? 'fixed inset-x-3 bottom-3 z-50 mx-auto max-h-[80vh] max-w-2xl overflow-auto rounded-lg border border-border bg-bg-surface p-4 text-text-primary shadow-lg' : 'mt-4 rounded border border-border p-4'}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">我的反馈</h2><button type="button" className={button} onClick={() => setOpen(false)}>关闭</button></div>
      <p className="my-3 text-sm text-text-muted">本机接收的反馈进展。跟进可用 90 天，到期清理不代表问题已解决。清除浏览器数据会丢失跟进记录。</p>
      <button type="button" disabled={busy || !navigator.onLine} className={button} onClick={() => void act(() => refreshFeedbacks(true))}>{busy ? '正在检查…' : '检查进展'}</button>
      {!navigator.onLine && <p role="status">当前离线，下次联网打开应用后补收。</p>}
      {(error || storageError) && <p role="alert">{error || storageError}</p>}
      {!entries.length && !storageError && <p className="mt-3">暂无本机跟进记录。提交反馈时可选择接收处理进展；以前未选择的反馈不会自动出现在这里。</p>}
      <ul className="space-y-3">{entries.map(row => <li key={row.id} className="mt-3 rounded border border-border p-3">
        <h3 className="font-medium">{row.title || '已提交的反馈'}</h3>
        <p className="break-all text-xs text-text-muted">回执：{row.id}</p>
        <p>{row.state === 'pending' ? '提交结果待确认，请保留记录并检查进展。' : row.state === 'revoking' ? '正在停止跟进，联网后完成。' : row.state === 'unavailable' ? '跟进不可用，可能已到期或已撤回；不代表问题已解决。' : feedbackStageLabels[row.progress?.stage ?? 'accepted']}</p>
        {row.progress && <><p className="whitespace-pre-wrap">{row.progress.message}</p><p className="text-sm">{feedbackBuildMessage(row.progress, APP_BUILD_ID, clientMetadata().distribution, clientMetadata().platform)}</p>
          {row.progress.issueUrl && <a className="underline" href={row.progress.issueUrl} target="_blank" rel="noopener noreferrer">查看公开工单</a>}
          {row.progress.release && <a className="ml-3 underline" href={row.progress.release.url} target="_blank" rel="noopener noreferrer">查看修复版本 {row.progress.release.tag}</a>}</>}
        {row.failures >= 5 && <p role="status">连续读取失败，自动检查已暂停；请手动重试。</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {row.progress && row.state === 'active' && row.progress.revision > row.readRevision && <button type="button" className={button} disabled={busy} onClick={() => void act(() => readFeedbackProgress(row.id))}>标为已读</button>}
          {row.state === 'unavailable' ? <button type="button" className={button} disabled={busy} onClick={() => void act(() => removeExpiredFeedback(row.id))}>清除本机记录</button>
            : <button type="button" className={button} disabled={busy || row.state === 'revoking'} onClick={() => void act(() => stopFeedbackFollowup(row.id))}>停止跟进并移除</button>}
        </div>
      </li>)}</ul>
    </section>}
  </>
}
