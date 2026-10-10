import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { liveQuery } from 'dexie'
import { db } from '../../lib/db/schema'
import { extensionScope } from '../../lib/extensions/store'
import { safeStartup, startExtensions, type ExtensionSession } from '../../lib/extensions/runtime'
import type { ExtensionReviewRequest, RegisteredView } from '../../lib/extensions/types'
import './extensions.css'
import type { Project } from '../../lib/types'
const PluginTools = lazy(() => import('./PluginTools'))
const PluginPublicationReview = lazy(() => import('./PluginPublicationReview'))
const PluginAITasks = lazy(() => import('./PluginAITasks'))
const HistoryPanel = lazy(() => import('../history/HistoryPanel'))
const StoryTimelinePanel = lazy(() => import('../timeline/StoryTimelinePanel'))
class PluginBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <section className="sf-extension-error" role="alert"><p>插件界面发生错误，已恢复默认内容。可以在工坊停用插件。</p>{this.props.fallback}</section> : this.props.children }
}
export default function ExtensionSurface({ projectId, owner, workId, target = 'workbench', children }: { projectId: number; owner: 'world' | 'work'; workId?: number; target?: string; children?: ReactNode }) {
  const navigate = useNavigate()
  const [flowBusy, setFlowBusy] = useState(false)
  const [signature, setSignature] = useState<string | null>(null), [session, setSession] = useState<ExtensionSession | null>(null), [error, setError] = useState(''), [selected, setSelected] = useState(''), [review, setReview] = useState<ExtensionReviewRequest | null>(null), [project, setProject] = useState<Project>()
  useEffect(() => {
    const sub = liveQuery(async () => ({ profiles: await db.extensionProfiles.where('projectId').equals(projectId).toArray(), project: await db.projects.get(projectId) })).subscribe({ next: value => { setProject(value.project); setSignature(JSON.stringify(value.profiles.map(row => [row.id, row.revision]))) }, error: e => setError(String(e)) })
    return () => sub.unsubscribe()
  }, [projectId])
  useEffect(() => {
    const controller = new AbortController(); let active: ExtensionSession | undefined
    setSession(null); setError(''); setReview(null)
    if (signature !== null && !safeStartup()) void extensionScope(projectId, owner, workId).then(scope => startExtensions(scope, setReview, controller.signal)).then(value => { active = value; if (controller.signal.aborted) void value.dispose(); else setSession(value) }).catch(e => { if (!controller.signal.aborted) setError(String(e)) })
    return () => { controller.abort(); void active?.dispose() }
  }, [projectId, owner, workId, signature])
  const addons = session?.views.filter(view => view.mode === 'add' && (view.target === 'workbench' || view.target === target)) ?? []
  const replacement = session?.views.find(view => view.target === target && view.mode === 'replace')
  const view = addons.find(item => `${item.pluginId}/${item.id}` === selected)
  function renderView(item: RegisteredView, fallback: ReactNode) { const View = item.component; return <PluginBoundary key={`${signature}/${item.pluginId}/${item.id}`} fallback={fallback}><div className="sf-extension-surface"><View/></div></PluginBoundary> }
  return <>
    {(addons.length > 0 || replacement || target === 'workbench') && <div className="sf-extension-toolbar"><Link to={`/workshop/installed?project=${projectId}&owner=${owner}${workId ? `&work=${workId}` : ''}`}>插件与工坊</Link>{addons.map(item => <button key={`${item.pluginId}/${item.id}`} aria-pressed={selected === `${item.pluginId}/${item.id}`} onClick={() => setSelected(selected === `${item.pluginId}/${item.id}` ? '' : `${item.pluginId}/${item.id}`)}>{item.title}</button>)}{replacement && <span>正在使用：{replacement.title}</span>}</div>}
    {(error || session?.errors.length) ? <div className="sf-extension-error" role="alert">{error || session?.errors.join('；')} <Link to={`/workshop/installed?project=${projectId}`}>管理插件</Link></div> : null}
    {view && renderView(view, null)}
    {replacement ? renderView(replacement, children) : children}
    {target === 'workbench' && !addons.length && !error && <p>此作用域尚未启用工作台插件。可以先安装“创作便笺”，或查看已安装内容包。</p>}
    {review && project && ((review.scope.workId != null && review.scope.workId !== project.activeWorkId) || (review.scope.worldId != null && review.scope.worldId !== project.activeWorldId) ? <p role="alert">请先在工作区切换到插件所属作品或世界，再打开正式生成面板。</p> : <section className="sf-extension-review"><header className="sf-extension-actions"><h3>功能请求与作者确认</h3><button onClick={() => setReview(null)}>关闭确认面板</button></header><p>{review.instruction}</p><small>来自 {review.pluginId}；请检查下方内容后确认执行。</small><Suspense fallback={<p>加载正式 AI 面板…</p>}>{review.kind === 'tool' ? <PluginTools projectId={projectId} workId={workId} request={review}/> : review.kind === 'world-semantics' || review.kind === 'rule-pack' ? <PluginPublicationReview request={review}/> : review.kind === 'task' ? <PluginAITasks projectId={projectId} workId={workId} request={review}/> : review.kind === 'workflow' ? <section><p>确认后创建一份可编辑的节点流程。它不会自动调用模型；请在节点工作台检查来源、预算和目标，再开始运行。</p><button disabled={flowBusy} onClick={() => { setFlowBusy(true); void import('../../lib/extensions/flows').then(module => module.createExtensionFlow(review)).then(() => { setReview(null); navigate(`/workspace/${projectId}?module=visual-workflows&mode=nodes`) }).catch(e => setError(String(e))).finally(() => setFlowBusy(false)) }}>创建流程并打开节点工作台</button></section> : review.kind === 'history' ? <HistoryPanel project={project}/> : <StoryTimelinePanel project={project}/>}</Suspense></section>)}
  </>
}
