import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Settings } from 'lucide-react'
import { db } from '../lib/db/schema'
import type { ProductRuntimeCheckpoint, ProductRuntimeSession, ProductRuntimeState, WorkspaceScope } from '../lib/types'
import { branchProductRuntimeSession, verifyProductRuntimeCheckpoint, readProductRuntimeState, createProductRuntimeCheckpoint } from '../lib/ttrpg/runtime-api'
import { resolveScope } from '../lib/workspace/scope'
import TtrpgPlayTable from '../components/ttrpg/TtrpgPlayTable'
import './ttrpg-community.css'

export default function TtrpgSessionPage() {
  const { sessionId } = useParams()
  // A route change must unmount the old table before any asynchronous reads.
  return <TtrpgSessionView key={sessionId} sessionId={Number(sessionId)} />
}

function TtrpgSessionView({ sessionId }: { sessionId: number }) {
  const navigate = useNavigate()
  const [checkpoints, setCheckpoints] = useState<ProductRuntimeCheckpoint[]>([])
  const [restoring, setRestoring] = useState(false), [playing, setPlaying] = useState(false)
  const [loaded, setLoaded] = useState<{ session: ProductRuntimeSession; state: ProductRuntimeState; scope: WorkspaceScope } | null>(null)
  const [loadError, setLoadError] = useState(''), [restoreError, setRestoreError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const request = useRef(0), mounted = useRef(true), restoringRef = useRef(false)
  const refresh = useCallback(async () => {
    const revision = ++request.current
    if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new Error('存档地址无效')
    const session = await db.productRuntimeSessions.get(sessionId)
    if (!session || session.kind !== 'ttrpg' || session.worldId == null || session.workId == null) throw new Error('当前浏览器中没有这份跑团存档')
    const [scope, state, rows] = await Promise.all([
      resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId } }),
      readProductRuntimeState(sessionId),
      db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray(),
    ])
    if (!mounted.current || revision !== request.current) return
    setLoaded({ session, scope, state })
    setCheckpoints(rows.sort((a, b) => b.createdAt - a.createdAt))
    setLoadError('')
  }, [sessionId])
  useEffect(() => {
    let stale = false
    mounted.current = true
    setLoadError('')
    void refresh().catch(cause => { if (!stale) setLoadError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { stale = true; mounted.current = false }
  }, [refresh, loadAttempt])
  const restore = async (checkpoint: ProductRuntimeCheckpoint) => {
    if (!loaded || restoringRef.current || playing) return
    restoringRef.current = true; setRestoring(true); setRestoreError('')
    try {
      if (!await verifyProductRuntimeCheckpoint(checkpoint.id!)) throw new Error('存档校验失败，无法读取')
      if (!mounted.current) return
      const child = await branchProductRuntimeSession({ parentSessionId: sessionId, throughSequence: checkpoint.throughSequence,
        title: `${loaded.session.title} · ${checkpoint.name}` })
      if (mounted.current) navigate(`/play/session/${child.id}`)
    } catch (cause) {
      if (mounted.current) setRestoreError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      restoringRef.current = false
      if (mounted.current) setRestoring(false)
    }
  }
  return <div className="sf-community sf-community-playing">
    <header className="sf-community-nav"><Link to="/play"><ArrowLeft size={16} />我的冒险</Link><Link to={`/settings?returnTo=${encodeURIComponent(`/play/session/${sessionId}`)}`}><Settings size={16} />API 设置</Link></header>
    <main className="sf-community-table">
      {loaded && checkpoints.length > 0 && <details className="sf-community-checkpoints"><summary>读取存档 · {checkpoints.length}</summary>
        <p>读取时会另建一条冒险记录，保留现在的进度。</p>
        {playing && <p>请等待本轮主持结束，或停止主持后再读取存档。</p>}
        {checkpoints.map(checkpoint => <button key={checkpoint.id} disabled={restoring || playing} onClick={() => void restore(checkpoint)}>
          {checkpoint.name} · {new Date(checkpoint.createdAt).toLocaleString('zh-CN')}</button>)}
      </details>}
      {restoreError && <div className="sf-community-error" role="alert"><p>{restoreError}</p><p>当前冒险没有被替换，你可以继续游玩或选择其他存档。</p><button onClick={() => setRestoreError('')}>返回当前冒险</button></div>}
      {loadError && <div className="sf-community-error" role="alert"><p>{loadError}</p><button onClick={() => setLoadAttempt(attempt => attempt + 1)}>重新读取冒险</button></div>}
      {restoring && <p role="status">正在读取存档，当前进度会保留…</p>}
      {loaded ? <fieldset className="sf-community-table-controls" disabled={restoring} aria-label="冒险桌面">
        <TtrpgPlayTable {...loaded} onChanged={refresh} onBusyChange={setPlaying}
          onCheckpoint={async name => { await createProductRuntimeCheckpoint({ sessionId, name }); await refresh() }} />
      </fieldset> : !loadError && <p role="status">正在恢复你的冒险…</p>}
    </main>
  </div>
}
