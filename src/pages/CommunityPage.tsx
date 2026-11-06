import { evaluateCurrentProductEntryV1 } from '../lib/product/product-catalog'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { liveQuery } from 'dexie'
import ProductFrame from '../components/navigation/ProductFrame'
import { db } from '../lib/db/schema'
import type { Project, Work, WorkspaceScope } from '../lib/types'
import type { OnlineRoomJoinHandoffV1 } from '../lib/online/http-transport'
import { createProductRuntimeInstance } from '../lib/product/runtime-instances'
import { useWorldGroupStore } from '../stores/world-group'
const MarketplacePanel = lazy(() => import('../components/community/MarketplacePanel'))

export default function CommunityPage() {
  const catalogEntry = evaluateCurrentProductEntryV1('platform.marketplace')
  const [params] = useSearchParams(), navigate = useNavigate()
  const [rows, setRows] = useState<{ project: Project; work: Work }[]>([])
  const [error, setError] = useState('')
  const activeWorldGroupId = useWorldGroupStore(state => state.activeGroupId)
  useEffect(() => {
    const sub = liveQuery(async () => {
      const [projects, works] = await Promise.all([db.projects.toArray(), db.works.toArray()])
      return works.flatMap(work => { const project = projects.find(p => p.id === work.projectId); return project ? [{project, work}] : [] })
    }).subscribe({ next: setRows, error: cause => setError(String(cause)) })
    return () => sub.unsubscribe()
  }, [])
  const selected = rows.find(row => row.project.id === Number(params.get('project')) && (params.has('work') ? row.work.id === Number(params.get('work')) : row.work.id === row.project.activeWorkId))
  const projectId = selected?.project.id, workId = selected?.work.id, worldId = selected?.work.worldId
  const scope = useMemo<WorkspaceScope | undefined>(() => projectId != null && workId != null && worldId != null ? {projectId, workId, worldId} : undefined, [projectId, workId, worldId])
  const join = async (handoff: OnlineRoomJoinHandoffV1) => {
    if (!scope || !selected) throw new Error('请先选择拥有该跑团发行版本的作品。')
    const releases = await db.productReleases.where('workId').equals(scope.workId).toArray()
    const release = releases.find(row => row.contentHash === handoff.releaseHash && row.projectId === scope.projectId && row.worldId === scope.worldId && row.productType === 'ttrpg')
    if (!release?.id) throw new Error('这部作品中没有该跑团发行版本，请先领取或导入，再进入在线房间。')
    const worldGroupId = selected.project.enableMultiWorld ? activeWorldGroupId : null
    const sessions = await db.productRuntimeSessions.where('projectId').equals(scope.projectId).toArray()
    const session = sessions.find(row => row.kind === 'ttrpg' && row.productReleaseId === release.id && row.workId === scope.workId && row.worldId === scope.worldId && (row.worldGroupId ?? null) === worldGroupId)
      ?? await createProductRuntimeInstance({scope, kind:'ttrpg', title:`${release.label} · 在线战役`, productSource:{kind:'release', productReleaseId:release.id}, worldGroupId})
    navigate(`/ttrpg/room?project=${scope.projectId}&work=${scope.workId}&session=${session.id}`, {state:{onlineHandoff:handoff}})
  }
  return <ProductFrame product="community" title="社区与发行" page="社区市场" navigation={[{label:'社区市场',path:'/community/market',active:true},{label:'作品总览',path:'/home/library'},{label:'通用设置',path:'/home/settings'}]}>
    {!catalogEntry.enterable && <p role="status" className="lf-paper">当前社区尚未开放新的领取或发行操作；已有记录、合法发行物与在线房间交接仍可查看。</p>}
    <section className="lf-paper"><h3>作品发行与社区</h3><p>浏览发行物、管理领取记录与在线招募。导入或参加房间前，选择接收内容的本地作品。</p><label>本地作品<select aria-label="社区接收作品" value={selected?.work.id ?? ''} onChange={event => {const row=rows.find(r=>r.work.id===Number(event.target.value)); navigate(row?`/community/market?project=${row.project.id}&work=${row.work.id}`:'/community/market')}}><option value="">仅浏览社区</option>{rows.map(row=><option key={row.work.id} value={row.work.id}>{row.work.title}</option>)}</select></label></section>
    {error&&<p role="alert">{error}</p>}<section className="lf-paper"><Suspense fallback={<p>正在读取社区…</p>}><MarketplacePanel scope={scope} onRoomHandoff={join}/></Suspense></section>
  </ProductFrame>
}
