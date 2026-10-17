import { useEffect,useState,type ReactNode } from 'react'
import type { ProductBuildArtifactRecordV1,WorkspaceScope } from '../../lib/types'
import type { AvgVisualProductionRequirementV1 } from '../../lib/avg/media-production-contract'
import type { AvgMediaReferenceV1 } from '../../lib/avg/media-reference-contract'
import type { AvgReviewIssuesV1 } from '../../lib/avg/artifact-contract'
import { AVG_VISUAL_REVIEW_CRITERIA_V1,type AvgAuthorVisualEvidenceV1,type AvgVisualReviewCriterionV1 } from '../../lib/avg/visual-review-contract'
import { readAvgDraftReferenceImageV1 } from '../../lib/avg/editor-service'
import { confirmAvgWorkspaceInputV1,stageAvgVisualReviewV1 } from '../../lib/avg/assembly-service'

const LABELS:Record<AvgVisualReviewCriterionV1,string>={identity:'身份与造型',continuity:'参考连续性',composition:'构图与完整性',legibility:'可辨认性', 'alpha-edge':'透明边缘'}
function applicable(r:AvgVisualProductionRequirementV1,c:AvgVisualReviewCriterionV1){return c==='identity'?r.references.some(ref=>ref.purpose==='identity'):c==='continuity'?r.references.length>0:c==='alpha-edge'?r.alpha==='required':true}
function defaults(r:AvgVisualProductionRequirementV1):AvgAuthorVisualEvidenceV1['checks']{return AVG_VISUAL_REVIEW_CRITERIA_V1.map(criterion=>({criterion,result:applicable(r,criterion)?'unknown':'not-applicable',note:''}))}

function ReferenceView({scope,reference,ratio,onObserved}:{scope:WorkspaceScope;reference:AvgMediaReferenceV1;ratio:number;onObserved:(hash:string)=>void}){
  const [url,setUrl]=useState(''),[error,setError]=useState('')
  const json=JSON.stringify(reference)
  useEffect(()=>{
    let active=true,created='';setUrl('');setError('')
    void readAvgDraftReferenceImageV1(scope,JSON.parse(json) as AvgMediaReferenceV1).then(image=>{if(active){created=URL.createObjectURL(new Blob([image.data],{type:image.asset.mimeType}));setUrl(created)}}).catch(cause=>{if(active)setError(String(cause))})
    return()=>{active=false;if(created)URL.revokeObjectURL(created)}
  },[scope,json])
  return <figure className="avg-review-reference"><figcaption>参考 · {reference.purpose} · {reference.contentHash.slice(0,12)}</figcaption>
    {error?<p role="alert">{error}</p>:url?<img src={url} alt={`准确参考 ${reference.purpose}`} style={{aspectRatio:ratio}} onLoad={()=>onObserved(reference.contentHash)}/>:<p>读取准确参考…</p>}
    <p>{reference.allowedChange}</p><p>授权：{reference.license}</p>
  </figure>
}

/** Author observations become a separate pending/accepted issue Artifact.
 * A decoder callback proves display availability, never artistic correctness. */
export default function VisualReviewPanel({scope,productionId,requirement:r,raw,reviewedImage=raw,accepted,pending,image,rawObserved,disabled,canAdopt,locked,declaration,onPending,onAction,onReload}:{
  scope:WorkspaceScope;productionId:number;requirement:AvgVisualProductionRequirementV1;raw:ProductBuildArtifactRecordV1;accepted?:ProductBuildArtifactRecordV1;pending?:ProductBuildArtifactRecordV1;
  image:ReactNode;rawObserved:boolean;disabled:boolean;canAdopt:boolean;locked:boolean;declaration:string;onPending:(value:boolean)=>void;
  reviewedImage?:ProductBuildArtifactRecordV1;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>
}){
  const [observed,setObserved]=useState<string[]>([]),[checks,setChecks]=useState(()=>defaults(r)),[dirty,setDirty]=useState(false)
  const [repair,setRepair]=useState(''),[reviewed,setReviewed]=useState('')
  const [note,setNote]=useState('')
  const identity=`${raw.version}:${raw.contentHash}:${reviewedImage.version}:${reviewedImage.contentHash}:${JSON.stringify(r.references)}`
  useEffect(()=>{setObserved([]);setChecks(defaults(r));setDirty(false);setRepair('');setReviewed('');setNote('')},[identity]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{onPending(dirty)},[dirty,onPending])
  useEffect(()=>()=>onPending(false),[onPending])
  const refsReady=r.references.every(ref=>observed.includes(ref.contentHash))
  let candidateHash='';try{candidateHash=pending?String(JSON.parse(pending.metadataJson).candidateHash):''}catch{/* authority service rejects damaged records */}
  const report=():AvgReviewIssuesV1=>{
    const unavailable=[...(!rawObserved?['未查看准确原图']:[]),...r.references.filter(ref=>!observed.includes(ref.contentHash)).map(ref=>`未查看参考 ${ref.contentHash.slice(0,12)}`),...checks.filter(c=>c.result==='unknown').map(c=>`未观察：${LABELS[c.criterion]}`)]
    const issues=checks.filter(c=>c.result==='fail').map(c=>({issueKey:`visual.${c.criterion}`,locationKey:r.assetKey,evidence:c.note,severity:'blocking' as const,owner:'media' as const,
      allowedChange:repair,impact:'本候选不能选用；保留原图、费用与评审记录',recheck:`重新查看准确图像与参考，并复验${LABELS[c.criterion]}`}))
    return {schema:'storyforge.avg.review-issues',version:1,targetKey:r.requirementKey,observations:rawObserved?['visual']:[],unobserved:unavailable,issues,
      visualEvidence:{imageHash:rawObserved?reviewedImage.contentHash:null,referenceHashes:r.references.filter(ref=>observed.includes(ref.contentHash)).map(ref=>ref.contentHash),checks,note}}
  }
  return <section className="avg-visual-review" aria-label={`视觉评审：${r.name}`}><h6>作者视觉观察</h6>
    <p>并列查看原图、冻结配方的加工结果（如有）与本次准确参考，按共同画布检查身份、比例、构图、辨认和透明边缘。评审绑定实际将选用的图片版本，不能代替最终舞台和专业艺术验收。</p>
    <div className="avg-visual-review-grid">{image}{r.references.map((reference,i)=><ReferenceView key={`${reference.assetKey}:${i}`} scope={scope} reference={reference} ratio={r.width/r.height}
      onObserved={hash=>setObserved(old=>old.includes(hash)?old:[...old,hash])}/>)}</div>
    <p>{rawObserved?'准确原图已显示':'原图尚未显示'} · 参考 {observed.length}/{new Set(r.references.map(ref=>ref.contentHash)).size}。{!r.references.length&&'本项没有参考，不能据此证明跨图连续性。'}</p>
    {accepted&&<details><summary>已确认的评审 v{accepted.version}</summary><pre>{accepted.payloadJson}</pre><p>这是作者问题记录，不是商业质量通过回执。</p></details>}
    {locked&&<p>该评审已被组装执行消费；修改须先明确保留当前版本并创建新 Build。</p>}
    <fieldset disabled={disabled||!canAdopt||locked} className="avg-form">
      {checks.map((c,index)=><label key={c.criterion}>{LABELS[c.criterion]}<select aria-label={`观察结果：${LABELS[c.criterion]}`} value={c.result} onChange={event=>{setChecks(old=>old.map((entry,i)=>i===index?{...entry,result:event.target.value as typeof c.result,note:''}:entry));setDirty(true)}}>
        <option value="unknown">未观察 / 未确定</option><option value="pass" disabled={!rawObserved||!refsReady||['identity','continuity'].includes(c.criterion)&&!applicable(r,c.criterion)}>此项可用</option><option value="fail">需要返修（blocking）</option><option value="not-applicable" disabled={applicable(r,c.criterion)}>本需求不适用</option>
      </select>{c.result==='fail'&&<textarea aria-label={`问题证据：${LABELS[c.criterion]}`} value={c.note} maxLength={2000} onChange={event=>{setChecks(old=>old.map((entry,i)=>i===index?{...entry,note:event.target.value}:entry));setDirty(true)}}/>}</label>)}
      {checks.some(c=>c.result==='fail')&&<label>允许的返修与加工范围<textarea value={repair} maxLength={2000} onChange={event=>{setRepair(event.target.value);setDirty(true)}}/></label>}
      <label>本次评审依据与修订说明<textarea value={note} maxLength={4000} onChange={event=>{setNote(event.target.value);setDirty(true)}}/></label>
      <button className="lf-action" disabled={!note.trim()||!dirty&&!!(accepted||pending)||checks.some(c=>c.result==='fail'&&(!c.note.trim()||!repair.trim()))} onClick={()=>void onAction(async()=>{
        await stageAvgVisualReviewV1({scope,productionId,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,report:report(),declaration})
        setDirty(false);await onReload()
      })}>保存视觉评审候选：{r.name}</button>
      <button className="lf-action" disabled={!dirty} onClick={()=>{setChecks(defaults(r));setRepair('');setNote('');setDirty(false)}}>撤销未保存的观察</button>
    </fieldset>
    {pending&&<><details><summary>核对视觉评审候选 v{pending.version}</summary><pre>{pending.payloadJson}</pre></details>
      <label><input type="checkbox" disabled={disabled||dirty||!canAdopt||locked} checked={reviewed===candidateHash&&!!candidateHash} onChange={event=>setReviewed(event.target.checked?candidateHash:'')}/>我已核对这份准确评审及未观察项</label>
      <button className="lf-action" disabled={disabled||dirty||!canAdopt||locked||!candidateHash||reviewed!==candidateHash} onClick={()=>void onAction(async()=>{
        await confirmAvgWorkspaceInputV1({scope,productionId,artifactKey:pending.artifactKey,candidateVersion:pending.version,candidateHash});await onReload()
      })}>确认评审记录：{r.name}</button></>}
  </section>
}
