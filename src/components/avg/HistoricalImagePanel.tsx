import { useEffect,useRef,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import type { readAvgHistoricalImageCandidatesV4 } from '../../lib/avg/visual-image-history'
import type { AvgVisualRawReuseSourceV4 } from '../../lib/avg/visual-image-reuse-contract'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import MediaAssetPreview from './MediaAssetPreview'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Snapshot=Awaited<ReturnType<typeof readAvgHistoricalImageCandidatesV4>>

/** Reading remains explicit and local. Source selection only revises an
 * unstarted Brief; current production, review and adoption are separate. */
export default function HistoricalImagePanel({scope,view,disabled=false,onAction,onReload,onNotice,onPending}:{
  scope:WorkspaceScope;view:View;disabled?:boolean;onAction?:(task:()=>Promise<void>)=>Promise<void>;
  onReload?:()=>Promise<void>;onNotice?:(notice:string)=>void;onPending?:(value:boolean)=>void
}){
  const details=view.details!,build=details.build!
  const next=details.brief?parseProductProductionBriefV3(details.brief.briefJson):null
  const canSelect=!!onAction&&!!onReload&&details.production.status==='brief-ready'&&!!next?.avgVisualPlanning
    &&details.brief!.revision>build.briefRevision&&!build.previewHash
  const initial=next?.avgVisualPlanning?.rawReuse??[]
  const [selected,setSelected]=useState<AvgVisualRawReuseSourceV4[]>(initial)
  const [sourceNumber,setSourceNumber]=useState(build.buildNumber)
  const sourceBuild=(details.buildHistory??[]).find(b=>b.buildNumber===sourceNumber)??build
  const owner=`${scope.projectId}:${scope.worldId}:${scope.workId}:${details.production.id}:${build.id}:${build.stateRevision}:${details.brief?.briefHash??''}:${view.draft?.revision??0}`
  const identity=`${owner}:${sourceBuild.id}:${sourceBuild.stateRevision}:${sourceBuild.briefHash}:${sourceBuild.planHash}`
  const fence=useRef({request:0}),identityRef=useRef(identity);identityRef.current=identity
  const [saved,setSaved]=useState<{identity:string;snapshot:Snapshot}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState('')
  const changed=canSelect&&JSON.stringify(selected)!==JSON.stringify(initial)
  const initialJson=JSON.stringify(initial)
  useEffect(()=>{setSelected(JSON.parse(initialJson) as AvgVisualRawReuseSourceV4[])},[owner,initialJson])
  useEffect(()=>{setSourceNumber(build.buildNumber)},[owner,build.buildNumber])
  useEffect(()=>{onPending?.(changed);return()=>onPending?.(false)},[changed,onPending])
  useEffect(()=>{const state=fence.current;state.request++;setSaved(null);setError('');setExpanded('');setLoading(false);return()=>{state.request++}},[identity])
  const snapshot=saved?.identity===identity?saved.snapshot:null
  const read=async()=>{
    const ticket=++fence.current.request,currentIdentity=identity
    setLoading(true);setError('')
    try{
      const {readAvgHistoricalImageCandidatesV4}=await import('../../lib/avg/visual-image-history')
      const result=await readAvgHistoricalImageCandidatesV4({scope,productionId:details.production.id!,buildId:sourceBuild.id!,
        expectedBuildRevision:sourceBuild.stateRevision,expectedBriefHash:sourceBuild.briefHash,expectedPlanHash:sourceBuild.planHash})
      if(fence.current.request===ticket&&identityRef.current===currentIdentity){setSaved({identity:currentIdentity,snapshot:result});setExpanded('')}
    }catch(cause){if(fence.current.request===ticket&&identityRef.current===currentIdentity)setError(cause instanceof Error?cause.message:'原图来源读取失败')}
    finally{if(fence.current.request===ticket&&identityRef.current===currentIdentity)setLoading(false)}
  }
  const save=()=>onAction?.(async()=>{
    const {prepareAvgVisualRawReuseV4}=await import('../../lib/avg/visual-image-reuse-workspace')
    await prepareAvgVisualRawReuseV4({scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash,
      expectedDraftRevision:view.draft.revision,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,
      sources:[...selected].sort((a,b)=>a.requirementKey.localeCompare(b.requirementKey))})
    await onReload!();onNotice?.('已保存原图沿用方案；到制作页核对并明确开始，本版仍需评审、选图和演出确认。')
  })
  return <section className="avg-input-card" aria-label="已停止版本的原图"><h5>已停止版本的原图</h5>
    <p>查看原始方案、生成记录和图片。读取只核对本机保存的来源与字节；下一版的用途、评审和选用仍需重新确认。</p>
    {(details.buildHistory??[]).filter(b=>['cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(b.status)).length>1&&<label>来源版本<select aria-label="原图来源版本" value={sourceBuild.buildNumber} disabled={loading||disabled} onChange={e=>setSourceNumber(Number(e.target.value))}>
      {details.buildHistory.filter(b=>['cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(b.status)).map(b=><option key={b.id} value={b.buildNumber}>制作版本 {b.buildNumber}</option>)}
    </select></label>}
    <button className="lf-action" disabled={loading||disabled} onClick={()=>void read()}>{loading?'正在核对原图来源…':'读取原图与来源'}</button>
    {error&&<p role="alert">{error}</p>}
    {snapshot&&<><p role="status">已核对版本 {snapshot.buildNumber} 的原始编译来源；{snapshot.candidates.filter(c=>c.available).length} 张原图来源可读取。</p>
      {snapshot.candidates.map(candidate=><article className="avg-input-card" key={candidate.requirement.requirementKey} aria-label={`历史原图：${candidate.requirement.name}`}>
        <h5>{candidate.requirement.name}</h5>
        {candidate.available?<><p>{candidate.asset.source==='agnes.image-2.5-flash.v1'?'Agnes Image 2.5 Flash':'Agnes Image 2.1 Flash'} · {candidate.asset.width} × {candidate.asset.height} · 原调用费用：{candidate.costUsd===null?'未知':`$${candidate.costUsd}`}</p>
          {canSelect&&next!.avgVisualPlanning!.scope.templates.some(t=>t.parameters.requirementKey===candidate.requirement.requirementKey)&&<label><input type="checkbox" aria-label={`沿用原图：${candidate.requirement.name}`} disabled={disabled||loading}
            checked={selected.some(s=>s.requirementKey===candidate.reuseSource.requirementKey&&s.raw.proofHash===candidate.reuseSource.raw.proofHash)} onChange={e=>setSelected(previous=>[...previous.filter(s=>s.requirementKey!==candidate.reuseSource.requirementKey),...(e.target.checked?[candidate.reuseSource]:[])])}/>沿用此原图为新版本候选</label>}
          <button className="lf-action" onClick={()=>setExpanded(expanded===candidate.requirement.requirementKey?'':candidate.requirement.requirementKey)}>{expanded===candidate.requirement.requirementKey?'收起原图':'查看原图'}</button>
          {expanded===candidate.requirement.requirementKey&&<MediaAssetPreview scope={scope} productionId={details.production.id!} asset={candidate.asset}
            raw={{requirementKey:candidate.requirement.requirementKey,version:candidate.raw.version,contentHash:candidate.raw.contentHash,historical:snapshot.boundary,historicalSource:candidate.reuseSource}}/>}
        </>:<p>{candidate.issue}</p>}
      </article>)}
    </>}
    {canSelect&&<><p>已保留 {selected.length} 项原图，剩余 {next!.avgVisualPlanning!.scope.templates.length-selected.length} 项仍需有限图片请求。保存选择不会开始调用，原请求与费用保留。</p>
      {selected.map(source=><p key={source.requirementKey}>版本 {source.raw.buildNumber} · {source.requirementKey}<button className="lf-action" disabled={disabled} onClick={()=>setSelected(previous=>previous.filter(s=>s.requirementKey!==source.requirementKey))}>移除此原图沿用</button></p>)}
      <button className="lf-action" disabled={disabled||loading||!changed} onClick={()=>void save()}>保存原图沿用方案</button></>}
  </section>
}
