import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Settings } from 'lucide-react'
import { db } from '../lib/db/schema'
import type { ProductRuntimeCheckpoint, ProductRuntimeSession, ProductRuntimeState, WorkspaceScope } from '../lib/types'
import { branchProductRuntimeSession, verifyProductRuntimeCheckpoint, readProductRuntimeState, createProductRuntimeCheckpoint } from '../lib/ttrpg/runtime-api'
import { resolveScope } from '../lib/workspace/scope'
import TtrpgPlayTable from '../components/ttrpg/TtrpgPlayTable'
import './ttrpg-community.css'

export default function TtrpgSessionPage() {
  const { sessionId: id } = useParams(), sessionId = Number(id), navigate = useNavigate()
  const [checkpoints, setCheckpoints] = useState<ProductRuntimeCheckpoint[]>([])
  const [restoring, setRestoring] = useState(false)
  const [loaded, setLoaded] = useState<{ session: ProductRuntimeSession; state: ProductRuntimeState; scope: WorkspaceScope } | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new Error('存档地址无效')
    const session = await db.productRuntimeSessions.get(sessionId)
    if (!session || session.kind !== 'ttrpg' || session.worldId == null || session.workId == null) throw new Error('当前浏览器中没有这份跑团存档')
    const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId } })
    setLoaded({ session, scope, state: await readProductRuntimeState(sessionId) })
    setCheckpoints((await db.productRuntimeCheckpoints.where('sessionId').equals(sessionId).toArray()).sort((a, b) => b.createdAt - a.createdAt))
  }, [sessionId])
  useEffect(() => { void refresh().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))) }, [refresh])
  return <div className="sf-community sf-community-playing">
    <header className="sf-community-nav"><Link to="/play"><ArrowLeft size={16} />我的冒险</Link><Link to={`/settings?returnTo=${encodeURIComponent(`/play/session/${sessionId}`)}`}><Settings size={16} />API 设置</Link></header>
    <main className="sf-community-table">{loaded && checkpoints.length > 0 && <details className="sf-community-checkpoints"><summary>读取存档 · {checkpoints.length}</summary><p>读取时会另建一条冒险记录，保留现在的进度。</p>{checkpoints.map(checkpoint => <button key={checkpoint.id} disabled={restoring} onClick={() => {
      setRestoring(true); void (async () => {
        if (!await verifyProductRuntimeCheckpoint(checkpoint.id!)) throw new Error('存档校验失败，无法读取')
        const child = await branchProductRuntimeSession({ parentSessionId: sessionId, throughSequence: checkpoint.throughSequence, title: `${loaded.session.title} · ${checkpoint.name}` })
        navigate(`/play/session/${child.id}`)
      })().catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setRestoring(false))
    }}>{checkpoint.name} · {new Date(checkpoint.createdAt).toLocaleString('zh-CN')}</button>)}</details>}{error ? <p role="alert">{error}</p> : loaded ? <TtrpgPlayTable key={sessionId} {...loaded} onChanged={refresh}
      onCheckpoint={async name => { await createProductRuntimeCheckpoint({ sessionId, name }); await refresh() }} /> : <p role="status">正在恢复你的冒险…</p>}</main>
  </div>
}
