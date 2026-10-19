import { useEffect,useRef,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../lib/product-production/plan'
import { readAvgHistoricalImageCandidatesV5 } from '../../lib/avg/media-candidate-preview-v5'
import MediaAssetPreview from './MediaAssetPreview'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Snapshot=Awaited<ReturnType<typeof readAvgHistoricalImageCandidatesV5>>
/** Read-only original V5 history. No V4 reuse packet, candidate adoption or
 * provider call is inferred from retaining these raw/processed images. */
export default function HistoricalImagePanelV5({scope,view,disabled,visible}:{scope:WorkspaceScope;view:View;disabled:boolean;visible:boolean}){
  const details=view.details!,build=details.build!
  const [number,setNumber]=useState(build.buildNumber),[saved,setSaved]=useState<{identity:string;snapshot:Snapshot}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[expanded,setExpanded]=useState('')
  const candidates=details.buildHistory.filter(b=>['paused','cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(b.status)
    &&details.briefHistory.some(row=>row.revision===b.briefRevision&&row.briefHash===b.briefHash&&parseProductProductionBriefV3(row.briefJson).avgVisualPlanning?.version===5))
  const source=candidates.find(row=>row.buildNumber===number)??build
  const identity=`${scope.projectId}:${scope.worldId}:${scope.workId}:${details.production.id}:${source.id}:${source.stateRevision}:${source.briefHash}:${source.planHash}`
  const snapshot=saved?.identity===identity?saved.snapshot:null
  const fence=useRef({request:0})
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
  return <section aria-label="新版已停止版本的图像"><h5>已保留的原图与加工结果</h5>
    <p>按原方案、参考范围和生成记录读取；图片展开时另核对本机字节。查看不会选图、重试或调用模型。</p>
    {candidates.length>1&&<label>制作版本<select aria-label="新版历史制作版本" value={source.buildNumber} disabled={loading||disabled} onChange={e=>setNumber(Number(e.target.value))}>{candidates.map(b=><option key={b.id} value={b.buildNumber}>制作版本 {b.buildNumber}</option>)}</select></label>}
    <button className="lf-action" disabled={disabled||loading} onClick={()=>void read()}>{loading?'正在核对图像来源…':'读取保留图像与来源'}</button>
    {error&&<p role="alert">{error}</p>}
    {snapshot&&<><p role="status">版本 {snapshot.buildNumber}，{snapshot.candidates.filter(c=>c.available).length} 项原图来源可读取；这不代表视觉评审通过。</p>
      {snapshot.candidates.map(c=><article key={c.requirement.requirementKey} aria-label={`新版历史图像：${c.requirement.name}`}><h6>{c.requirement.name}</h6>
        {c.available?<><p>{c.asset.source} · {c.asset.width} × {c.asset.height}</p>
          {c.processingIssue&&<p>加工结果：{c.processingIssue}</p>}
          <button className="lf-action" onClick={()=>setExpanded(expanded===c.requirement.requirementKey?'':c.requirement.requirementKey)}>{expanded===c.requirement.requirementKey?'收起图像':'查看保留图像'}</button>
          {visible&&expanded===c.requirement.requirementKey&&<div className="avg-visual-review-grid">
            <MediaAssetPreview scope={scope} productionId={details.production.id!} asset={c.asset} caption="原始候选" raw={{visualVersion:5,historicalV5:snapshot.boundary,requirementKey:c.requirement.requirementKey,version:c.raw.version,contentHash:c.raw.contentHash}}/>
            {c.processed&&<MediaAssetPreview scope={scope} productionId={details.production.id!} asset={c.processed.asset} caption="本地加工结果" raw={{visualVersion:5,historicalV5:snapshot.boundary,processed:true,requirementKey:c.requirement.requirementKey,version:c.processed.row.version,contentHash:c.processed.row.contentHash}}/>}
          </div>}
        </>:<p role="alert">{c.issue}</p>}
      </article>)}
    </>}
  </section>
}
