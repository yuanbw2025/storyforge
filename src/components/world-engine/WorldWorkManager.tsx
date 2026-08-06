import { useCallback, useEffect, useState } from 'react'
import { BookOpenText, Check, Plus, Trash2, X } from 'lucide-react'
import type { Work } from '../../lib/types/world-ownership'
import { createWorldWork, listWorldWorks, switchActiveWork } from '../../lib/world-engine/works'
import { deleteWork } from '../../lib/world-engine/lifecycle'
import { useDialog } from '../shared/Dialog'

interface Props {
  projectId: number
  activeWorkId?: number | null
  onChanged: () => Promise<void> | void
}

export default function WorldWorkManager({ projectId, activeWorkId, onChanged }: Props) {
  const dialog = useDialog()
  const [works, setWorks] = useState<Work[]>([])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setWorks(await listWorldWorks(projectId))
  }, [projectId])

  useEffect(() => { void reload() }, [reload])

  const choose = async (workId: number) => {
    if (workId === activeWorkId || busy) return
    setBusy(true); setError('')
    try {
      await switchActiveWork(projectId, workId)
      await onChanged()
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换作品失败')
    } finally { setBusy(false) }
  }

  const create = async () => {
    if (!title.trim() || busy) return
    setBusy(true); setError('')
    try {
      const work = await createWorldWork(projectId, { title })
      await switchActiveWork(projectId, work.id!)
      setTitle(''); setCreating(false)
      await onChanged()
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建作品失败')
    } finally { setBusy(false) }
  }

  const remove = async (work: Work) => {
    if (!work.id || works.length <= 1 || busy) return
    const confirmed = await dialog.confirm({
      title: `删除作品“${work.title}”？`,
      message: '世界设定不会删除，但该作品的大纲、正文和状态数据将被清理。',
      confirmText: '删除',
      tone: 'danger',
    })
    if (!confirmed) return
    setBusy(true); setError('')
    try {
      await deleteWork(work.id)
      await onChanged()
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除作品失败')
    } finally { setBusy(false) }
  }

  return (
    <section className="sf-world-work-manager" aria-label="世界作品">
      <div className="sf-world-work-heading">
        <div><span className="sf-card-kicker"><BookOpenText className="h-4 w-4" /> 世界作品</span><h3>基于此世界的创作</h3></div>
        <button className="sf-icon-button" onClick={() => setCreating(value => !value)} title={creating ? '取消新建' : '新建作品'} aria-label={creating ? '取消新建' : '新建作品'}>
          {creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>
      {creating && <div className="sf-world-work-create"><input value={title} onChange={event => setTitle(event.target.value)} placeholder="作品名称" autoFocus onKeyDown={event => { if (event.key === 'Enter') void create() }} /><button className="sf-icon-button" onClick={() => void create()} disabled={!title.trim() || busy} title="创建并切换" aria-label="创建并切换"><Check className="h-4 w-4" /></button></div>}
      <div className="sf-world-work-list">
        {works.map(work => <div key={work.id} className={`sf-world-work-row ${work.id === activeWorkId ? 'active' : ''}`}><button onClick={() => void choose(work.id!)} disabled={busy}><span><strong>{work.title}</strong><small>{work.status === 'drafting' ? '创作中' : work.status}</small></span>{work.id === activeWorkId && <Check className="h-4 w-4" />}</button><button className="sf-icon-button" onClick={() => void remove(work)} disabled={busy || works.length <= 1} title="删除作品" aria-label={`删除作品 ${work.title}`}><Trash2 className="h-3.5 w-3.5" /></button></div>)}
      </div>
      {error && <p className="sf-world-work-error">{error}</p>}
    </section>
  )
}
