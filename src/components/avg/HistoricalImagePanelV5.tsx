import { useEffect,useRef,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { parseProductProductionPlanV3 } from '../../lib/product-production/plan'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import type { AvgVisualRawReuseSourceV5 } from '../../lib/avg/visual-image-reuse-contract'
import { readAvgHistoricalImageCandidatesV5 } from '../../lib/avg/media-candidate-preview-v5'
import MediaAssetPreview from './MediaAssetPreview'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Snapshot=Awaited<ReturnType<typeof readAvgHistoricalImageCandidatesV5>>
/** V5 history is read-only until the author explicitly selects an exact raw
 * source for a newer Brief. Selection creates no Run, adoption or provider call. */
export default function HistoricalImagePanelV5({scope,view,disabled,visible,onAction,onReload,onNotice,onPending}:{scope:WorkspaceScope;view:View;disabled:boolean;visible:boolean;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>;onNotice:(notice:string)=>void;onPending:(value:boolean)=>void}){
  const details=view.details!,build=details.build!
  const next=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null
  const canSelect=details.production.status==='brief-ready'&&!!next?.avgVisualPlanning&&next.avgVisualPlanning.version===5
    &&details.brief!.revision>build.briefRevision&&!build.previewHash
  const initial=next?.avgVisualPlanning?.version===5?next.avgVisualPlanning.rawReuse??[]:[]
  const [number,setNumber]=useState(build.buildNumber),[saved,setSaved]=useState<{identity:string;snapshot:Snapshot}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[expanded,setExpanded]=useState('')
  const [selected,setSelected]=useState<AvgVisualRawReuseSourceV5[]>(initial)
  const candidates=details.buildHistory.filter(b=>['paused','cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(b.status)
    &&details.briefHistory.some(row=>row.revision===b.briefRevision&&row.briefHash===b.briefHash&&parseProductProductionBriefV3(row.briefJson).avgVisualPlanning?.version===5))
  const source=candidates.find(row=>row.buildNumber===number)??build
  const owner=`${scope.projectId}:${scope.worldId}:${scope.workId}:${details.production.id}:${build.id}:${build.stateRevision}:${details.brief?.briefHash??''}:${view.draft?.revision??0}`
  const identity=`${owner}:${source.id}:${source.stateRevision}:${source.briefHash}:${source.planHash}`
  const initialJson=JSON.stringify(initial),changed=canSelect&&JSON.stringify(selected)!==initialJson
  const snapshot=saved?.identity===identity?saved.snapshot:null
  const fence=useRef({request:0})
  useEffect(()=>{setSelected(JSON.parse(initialJson) as AvgVisualRawReuseSourceV5[])},[owner,initialJson])
  useEffect(()=>{onPending(changed);return()=>onPending(false)},[changed,onPending])
  useEffect(()=>{const state=fence.current;state.request++;setSaved(null);setError('');setExpanded('');setLoading(false);return()=>{state.request++}},[identity])
  useEffect(()=>setNumber(build.buildNumber),[build.id,build.buildNumber])
  const read=async()=>{
    const ticket=++fence.current.request;setSaved(null);setLoading(true);setError('')
    try{
      const briefRow=details.briefHistory.find(row=>row.revision===source.briefRevision&&row.briefHash===source.briefHash)
      if(!briefRow)throw new Error('原制作方案不存在')
      const brief=parseProductProductionBriefV3(briefRow.briefJson),plan=parseProductProductionPlanV3(source.planJson,brief,source.briefHash)
      const result=await readAvgHistoricalImageCandidatesV5({scope,productionId:details.production.id!,historical:{buildId:source.id!,expectedBuildRevision:source.stateRevision,
        expectedBriefHash:source.briefHash,expectedPlanHash:source.planHash,controlEpoch:plan.controlEpoch}})
      if(fence.current.request===ticket)setSaved({identity,snapshot:result})
    }catch(cause){if(fence.current.request===ticket)setError(String(cause))}
    finally{if(fence.current.request===ticket)setLoading(false)}
  }
  const save=()=>onAction(async()=>{
    const {prepareAvgVisualRawReuseV5}=await import('../../lib/avg/visual-image-reuse-workspace')
    await prepareAvgVisualRawReuseV5({scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash,
      expectedDraftRevision:view.draft.revision,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,
      sources:[...selected].sort((a,b)=>a.requirementKey.localeCompare(b.requirementKey))})
    await onReload();onNotice('已保存 V5 原图沿用方案；明确开始后会先核对新编译需求，再执行零图片请求的本地复验/加工。本版本仍需独立评审和选用。')
  })
  return <section aria-label="新版已停止版本的图像"><h5>已保留的原图与加工结果</h5>
    <p>按原方案、参考范围和生成记录读取；图片展开时另核对本机字节。明确选择只准备新方案，不沿用旧评审或选择，也不会调用模型或图片供应商。</p>
    {candidates.length>1&&<label>制作版本<select aria-label="新版历史制作版本" value={source.buildNumber} disabled={loading||disabled} onChange={e=>setNumber(Number(e.target.value))}>{candidates.map(b=><option key={b.id} value={b.buildNumber}>制作版本 {b.buildNumber}</option>)}</select></label>}
    <button className="lf-action" disabled={disabled||loading} onClick={()=>void read()}>{loading?'正在核对图像来源…':'读取保留图像与来源'}</button>
    {error&&<p role="alert">{error}</p>}
    {snapshot&&<><p role="status">版本 {snapshot.buildNumber}，{snapshot.candidates.filter(c=>c.available).length} 项原图来源可读取；这不代表视觉评审通过。</p>
      {snapshot.candidates.map(c=><article key={c.requirement.requirementKey} aria-label={`新版历史图像：${c.requirement.name}`}><h6>{c.requirement.name}</h6>
        {c.available?<><p>{c.asset.source} · {c.asset.width} × {c.asset.height}</p>
          {canSelect&&next!.avgVisualPlanning!.scope.templates.some(t=>t.parameters.requirementKey===c.requirement.requirementKey)&&<label><input type="checkbox" aria-label={`沿用 V5 原图：${c.requirement.name}`} disabled={disabled||loading}
            checked={selected.some(s=>s.requirementKey===c.requirement.requirementKey&&s.raw.proofHash===c.reuseSource.raw.proofHash)}
            onChange={e=>setSelected(previous=>[...previous.filter(s=>s.requirementKey!==c.requirement.requirementKey),...(e.target.checked?[c.reuseSource]:[])])}/>沿用此原图为新版本候选</label>}
          {c.processingIssue&&<p>加工结果：{c.processingIssue}</p>}
          <button className="lf-action" onClick={()=>setExpanded(expanded===c.requirement.requirementKey?'':c.requirement.requirementKey)}>{expanded===c.requirement.requirementKey?'收起图像':'查看保留图像'}</button>
          {visible&&expanded===c.requirement.requirementKey&&<div className="avg-visual-review-grid">
            <MediaAssetPreview scope={scope} productionId={details.production.id!} asset={c.asset} caption="原始候选" raw={{visualVersion:5,historicalV5:snapshot.boundary,requirementKey:c.requirement.requirementKey,version:c.raw.version,contentHash:c.raw.contentHash}}/>
            {c.processed&&<MediaAssetPreview scope={scope} productionId={details.production.id!} asset={c.processed.asset} caption="本地加工结果" raw={{visualVersion:5,historicalV5:snapshot.boundary,processed:true,requirementKey:c.requirement.requirementKey,version:c.processed.row.version,contentHash:c.processed.row.contentHash}}/>}
          </div>}
        </>:<p role="alert">{c.issue}</p>}
      </article>)}
    </>}
    {canSelect&&<><p>已选 {selected.length} 项原图；剩余 {next!.avgVisualPlanning!.scope.templates.length-selected.length} 项继续走 V5 图片生产。原图片请求、费用和来源保持原样。</p>
      {selected.map(source=><p key={source.requirementKey}>版本 {source.raw.buildNumber} · {source.requirementKey}<button className="lf-action" disabled={disabled} onClick={()=>setSelected(previous=>previous.filter(s=>s.requirementKey!==source.requirementKey))}>移除此原图沿用</button></p>)}
      <button className="lf-action" disabled={disabled||loading||!changed} onClick={()=>void save()}>保存 V5 原图沿用方案</button></>}
  </section>
}
