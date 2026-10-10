import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { db } from '../../lib/db/schema'
import { useAIConfigStore } from '../../stores/ai-config'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import { adoptExtensionCandidate, cancelExtensionCandidate, generateExtensionCandidate, readExtensionCandidate, saveExtensionDraft } from '../../lib/extensions/ai-run'
import { domainScope } from '../../lib/extensions/domain'
import type { ExtensionReviewRequest } from '../../lib/extensions/types'
import type { WorkspaceScope } from '../../lib/types'
import { resolveScopeLike } from '../../lib/workspace/scope'

import PluginCandidateEditor from './PluginCandidateEditor'

const statusLabel = (status: string) => ({ awaiting_confirmation: '等待确认', completed: '已确认', paused: '已停止', cancelled: '已放弃', failed: '失败', running: '处理中' }[status] ?? '等待处理')
type CandidateState = Awaited<ReturnType<typeof readExtensionCandidate>>
export default function PluginAITasks({ projectId, workId, request }: { projectId: number; workId?: number; request?: ExtensionReviewRequest }) {
  const [scope, setScope] = useState<WorkspaceScope>(), [runs, setRuns] = useState<{id:number;name:string;status:string}[]>([])
  const [state, setState] = useState<CandidateState>(), [draft, setDraft] = useState(''), [instruction, setInstruction] = useState(request?.instruction ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  const config = useAIConfigStore(value => value.config)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    let active = true
    setState(undefined); setError(''); setScope(undefined)
    const resolve = async () => {
      if (request?.profileId) { const profile = await db.extensionProfiles.get(request.profileId); if (!profile || profile.digest !== request.digest) throw new Error('插件已变化，请重新打开任务'); return domainScope(profile) }
      const project = await db.projects.get(projectId), work = await db.works.get(workId ?? project?.activeWorkId ?? -1)
      if (!work || work.projectId !== projectId) throw new Error('请选择作品查看插件 AI 任务')
      return resolveScopeLike({projectId,worldId:work.worldId,workId:work.id!})
    }
    void resolve().then(value => active && setScope(value)).catch(e => active && setError(String(e)))
    return () => { active = false; controller.current?.abort() }
  }, [projectId,workId,request?.profileId,request?.digest])
  useEffect(() => {
    if (!scope) return
    const sub = liveQuery(async () => (await db.agentRuns.where('projectId').equals(projectId).toArray()).filter(run => run.workId === scope.workId && run.contractJson.includes('"extensions.generate"')).sort((a,b)=>b.createdAt-a.createdAt).map(run=>({id:run.id!,name:JSON.parse(run.contractJson).objective as string,status:run.status}))).subscribe({next:setRuns,error:e=>setError(String(e))})
    return () => sub.unsubscribe()
  },[scope,projectId])
  async function act(action:()=>Promise<void>) { if(busy)return;setBusy(true);setError('');setMessage('');try{await action()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)} }
  async function open(runId:number) { if(!scope)return;const next=await readExtensionCandidate(scope,runId);setState(next);setDraft(next.adopted ?? next.draft) }
  return <section className="sf-extension-surface" aria-label="插件 AI 任务">
    <h3>插件 AI 任务与历史</h3><p>一次生成最多调用模型一次。候选可以编辑、保存和确认；中断或结果未知时不会自动重发。历史内容不依赖插件代码。</p>
    {request?.kind==='task' && <><p>来自 {request.pluginId} · {request.taskId}，目标记录 {request.recordKey}。读取范围、输出格式与插件版本在开始时锁定。</p><label>本次创作要求<textarea aria-label="插件 AI 创作要求" value={instruction} maxLength={8000} onChange={e=>setInstruction(e.target.value)} disabled={busy}/></label><button disabled={busy || !scope} onClick={()=>void act(async()=>{if(!isAIConfigReady(config))throw new Error(getAIConfigRequiredMessage(config));controller.current=new AbortController();const next=await generateExtensionCandidate({profileId:request.profileId!,taskId:request.taskId!,recordKey:request.recordKey!,instruction,aiConfig:config,signal:controller.current.signal});setState({...next,historicalOnly:false,draft:next.candidate.artifact.editableText,adopted:undefined});setDraft(next.candidate.artifact.editableText)})}>确认开始生成</button>{busy && <button onClick={()=>controller.current?.abort()}>停止本次请求</button>}</>}
    {error && <p role="alert" className="sf-extension-error">{error}</p>}{message && <p role="status">{message}</p>}
    {state && <section><h4>{state.candidate.registry.manifest.name} · {state.candidate.registry.manifest.aiTasks!.find(task=>task.id===state.candidate.registry.taskId)!.title}</h4><small>锁定版本 {state.candidate.registry.manifest.version} · 状态 {state.historicalOnly ? '历史副本（只读）' : statusLabel(state.snapshot.projection.state)}</small>{state.candidate.artifact.issues.map(issue=><p key={issue.code}>{issue.message}</p>)}<PluginCandidateEditor schema={state.candidate.registry.manifest.schemas[state.candidate.registry.manifest.aiTasks!.find(task=>task.id===state.candidate.registry.taskId)!.outputSchema].schema} value={draft} disabled={busy || state.historicalOnly || state.snapshot.projection.state !== 'awaiting_confirmation'} onChange={setDraft}/>{!state.historicalOnly && state.snapshot.projection.state==='awaiting_confirmation' && <div className="sf-extension-actions"><button disabled={busy} onClick={()=>void act(async()=>{await saveExtensionDraft(scope!,state.snapshot.run.id,draft);setMessage('候选修改已保存，刷新后可以继续。')})}>保存候选修改</button><button disabled={busy} onClick={()=>void act(async()=>{await adoptExtensionCandidate(scope!,state.snapshot.run.id,draft);await open(state.snapshot.run.id);setMessage('已确认写入插件记录，完整回执已保存。')})}>确认写入插件内容</button><button disabled={busy} onClick={()=>void act(async()=>{await cancelExtensionCandidate(scope!,state.snapshot.run.id);await open(state.snapshot.run.id)})}>放弃此候选</button></div>}</section>}
    <div className="sf-extension-actions">{runs.map(run=><button key={run.id} disabled={busy} onClick={()=>void act(()=>open(run.id))}>{run.name} · {statusLabel(run.status)}</button>)}</div>{!runs.length && <p>此作品还没有插件 AI 任务。</p>}
  </section>
}
