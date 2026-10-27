import { useEffect, useRef, useState } from 'react'
import type { ProductRuntimeCheckpoint, ProductRuntimeSession } from '../../lib/types'

/** Save controls use the existing verified checkpoint/branch commands; no private runtime projection. */
export default function TtrpgOpenSavePanel(props: {
  session: ProductRuntimeSession
  checkpoints: ProductRuntimeCheckpoint[]
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onCheckpoint: (name: string) => Promise<void>
  onBranch: (title: string) => Promise<number>
  onRestoreCheckpoint: (id: number) => Promise<number>
}) {
  const [checkpointName, setCheckpointName] = useState('冒险检查点')
  const [branchTitle, setBranchTitle] = useState('新的冒险分支')
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const locked = useRef(false), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const run = async (job: () => Promise<unknown>, message: string) => {
    if (locked.current || props.busy) return
    locked.current = true; setPending(true); setError(''); setNotice(''); props.onBusyChange(true)
    try { await job(); if (live.current) setNotice(message) }
    catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : '存档操作未完成，请保留当前进度并重试。') }
    finally { locked.current = false; props.onBusyChange(false); if (live.current) setPending(false) }
  }
  return <section className="rounded border border-border bg-bg-base p-4" data-testid="ttrpg-open-save-and-branch">
    <h2 className="font-semibold text-text-primary">存档与分支</h2>
    <p className="mt-1 text-sm text-text-secondary">冒险进度会自动保存。检查点便于找回某个时刻；建立分支会保留原冒险，在新记录中继续。</p>
    <p className="mt-1 text-xs text-text-muted">分支沿用原有规则、实际经历和游戏时间。进入后需重新确认开局约定与 AI 授权。</p>
    {props.busy && <p role="status">请等待本轮操作结束，再保存或建立分支。</p>}
    {pending && <p role="status">正在保存，当前进度会保留…</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={pending || props.busy} className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <label>检查点名称 <input aria-label="开放跑团检查点名称" value={checkpointName} onChange={e => setCheckpointName(e.target.value)} className="rounded border border-border bg-bg-surface px-2 py-1" /></label>
        <button disabled={!checkpointName.trim()} onClick={() => void run(() => props.onCheckpoint(checkpointName.trim()), '检查点已保存。')}>保存检查点</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <label>新分支名称 <input aria-label="开放跑团分支名称" value={branchTitle} onChange={e => setBranchTitle(e.target.value)} className="rounded border border-border bg-bg-surface px-2 py-1" /></label>
        <button disabled={!branchTitle.trim()} onClick={() => void run(() => props.onBranch(branchTitle.trim()), '已建立新分支。')}>从当前进度建立分支</button>
      </div>
      <ul className="space-y-2">
        {props.checkpoints.filter(row => row.sessionId === props.session.id).map(row => <li key={row.id} className="flex flex-wrap items-center gap-2">
          <span>{row.name} · {new Date(row.createdAt).toLocaleString('zh-CN')}</span>
          <button disabled={row.id == null} onClick={() => void run(() => props.onRestoreCheckpoint(row.id!), '已建立恢复分支。')} aria-label={`从检查点 ${row.name} 建立恢复分支`}>从此处继续新分支</button>
        </li>)}
      </ul>
      {props.checkpoints.length === 0 && <p className="text-sm text-text-muted">尚未保存检查点，当前冒险仍会自动保存。</p>}
    </fieldset>
  </section>
}
