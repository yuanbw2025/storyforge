import { useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import { prepareAvgImageRecoveryBriefV1, readAvgImageRecoveryOptionsV1, type readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { avgMediaProductionEnabledV2 } from '../../lib/avg/assembly-contract'
import MediaAssetPreview from './MediaAssetPreview'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Options=Awaited<ReturnType<typeof readAvgImageRecoveryOptionsV1>>
export default function MediaRecoveryPanel({scope,view,disabled,visible,onAction,onReload,onNotice}:{scope:WorkspaceScope;view:View;disabled:boolean;visible:boolean;
  onAction:(action:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>;onNotice:(notice:string)=>void}){
  const build=view.details?.build,productionId=view.details?.production.id
  const eligible=!!build&&!build.previewHash&&['cancelled','failed','recovery-required'].includes(build.status)
  const pendingBrief=!!build&&view.details?.production.status==='brief-ready'&&view.details.brief?.revision!==build.briefRevision
  const [options,setOptions]=useState<Options|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<string[]>([]),[observed,setObserved]=useState<Record<string,string>>({}),[expanded,setExpanded]=useState(''),[reviewed,setReviewed]=useState(false)
  useEffect(()=>{
    let active=true;setOptions(null);setSelected([]);setObserved({});setReviewed(false);setError('')
    if(eligible&&productionId)void readAvgImageRecoveryOptionsV1(scope,productionId).then(value=>{if(active)setOptions(value)}).catch(cause=>{if(active)setError(String(cause))})
    return()=>{active=false}
  },[scope,productionId,build?.id,build?.stateRevision,eligible])
  if(!eligible||!productionId||!build)return null
  if(pendingBrief){
    const assembly=view.details?.executionBrief?.avgAssembly
    if(assembly?.version!==2||!assembly.imageRecovery)return null
    return <section aria-label="图片恢复方案"><h5>图片恢复方案已保存</h5><p>请到制作页核对保留图片、新请求上限和原费用记录，再明确开始新版本。旧版本仍保留。</p></section>
  }
  const rerun=options?.items.filter(r=>!selected.includes(r.requirementKey))??[]
  return <section aria-label="图片恢复方案"><h5>保留原图并准备恢复</h5><p>查看要保留的图片并明确勾选。新版本会重新复验这些原图，未保留项至多各发送一次新请求；仍须重新确认规则、脚本、选图和演出。</p>
    {error&&<p role="alert">{error}</p>}{!options&&!error&&<p>核验成功原图及原调用记录…</p>}
    {options?.items.map(r=><article key={r.requirementKey}><strong>{r.name}</strong>{r.asset&&r.proof?<><button className="lf-action" onClick={()=>setExpanded(expanded===r.requirementKey?'':r.requirementKey)}>查看保留原图：{r.name}</button>
      {visible&&expanded===r.requirementKey&&<MediaAssetPreview scope={scope} productionId={productionId} asset={r.asset} raw={{requirementKey:r.requirementKey,version:r.proof.artifactVersion,contentHash:r.proof.contentHash,retained:true}}
        onObserved={()=>setObserved(old=>({...old,[r.requirementKey]:r.proof!.contentHash}))}/>}
      <label><input type="checkbox" checked={selected.includes(r.requirementKey)} disabled={disabled||observed[r.requirementKey]!==r.proof.contentHash} onChange={event=>{setSelected(event.target.checked?[...selected,r.requirementKey]:selected.filter(key=>key!==r.requirementKey));setReviewed(false)}}/>保留原图：{r.name}</label></>:<p>未接收可复验原图：{r.issue}</p>}
      {!selected.includes(r.requirementKey)&&r.retryBlocker&&<p role="alert">{r.retryBlocker}</p>}</article>)}
    <p>保留 {selected.length} 张；新版本至多 {rerun.length} 次图片请求。原账单和未知费用继续保留，当前不会自动重发。</p>
    <label><input type="checkbox" checked={reviewed} disabled={disabled||!selected.length} onChange={event=>setReviewed(event.target.checked)}/>我已查看保留原图，并核对重做项目、原调用记录和费用边界</label>
    <button className="lf-action" disabled={disabled||!avgMediaProductionEnabledV2()||!options||!selected.length||!reviewed||rerun.some(r=>!!r.retryBlocker)} onClick={()=>void onAction(async()=>{
      await prepareAvgImageRecoveryBriefV1({scope,productionId,expectedDraftRevision:view.draft.revision,expectedBuildId:options!.buildId,expectedBuildRevision:options!.buildRevision,
        retainedRequirementKeys:selected,declaration:'作者已查看并明确保留所选原图；未保留项在新版本明确开始后至多一次请求；原账单和未知费用记录保留，不代表商业艺术验收'})
      await onReload();onNotice('图片恢复方案已保存，尚未开始。请到制作页核对保留/重做清单并明确开始新版本。')
    })}>准备图片恢复方案</button>
  </section>
}
