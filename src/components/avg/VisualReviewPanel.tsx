import { useEffect,useState,type ReactNode } from 'react'
import type { ProductBuildArtifactRecordV1,WorkspaceScope } from '../../lib/types'
import type { AvgVisualProductionRequirementV2 } from '../../lib/avg/media-production-contract-v2'
import { parseAvgVisualProductionRequirementV2 } from '../../lib/avg/media-production-contract-v2'
import type { AvgMediaReferenceV2 } from '../../lib/avg/media-reference-contract-v2'
import type { AvgReviewIssuesV2 } from '../../lib/avg/visual-review-contract-v2'
import { hashProductProductionValueV2 } from '../../lib/product-production/hash'
import { stageAvgVisualReviewV2 } from '../../lib/avg/visual-review-service-v5'
import type { AvgVisualProductionRequirementV1 } from '../../lib/avg/media-production-contract'
import type { AvgMediaReferenceV1 } from '../../lib/avg/media-reference-contract'
import type { AvgReviewIssuesV1 } from '../../lib/avg/artifact-contract'
import { AVG_VISUAL_REVIEW_CRITERIA_V1,type AvgAuthorVisualEvidenceV1,type AvgVisualReviewCriterionV1 } from '../../lib/avg/visual-review-contract'
import { readAvgDraftReferenceImageV1,readAvgDraftReferenceImageV2 } from '../../lib/avg/editor-service'
import { confirmAvgWorkspaceInputV1,stageAvgVisualReviewV1 } from '../../lib/avg/assembly-service'

type Requirement=AvgVisualProductionRequirementV1|AvgVisualProductionRequirementV2
type Reference=AvgMediaReferenceV1|AvgMediaReferenceV2
type PolicyAnswer=Pick<AvgReviewIssuesV2['referencePolicy']['checks'][number],'permittedFeatures'|'excludedFeatures'|'note'>
const policyDefaults=(r:Requirement):PolicyAnswer[]=>r.references.map(()=>({permittedFeatures:'unknown',excludedFeatures:'unknown',note:''}))
const reference2=(r:Reference):r is AvgMediaReferenceV2=>'version' in r&&r.version===2&&'schema' in r&&r.schema==='storyforge.avg.media-reference'

const LABELS:Record<AvgVisualReviewCriterionV1,string>={identity:'身份与造型',continuity:'参考连续性',composition:'构图与完整性',legibility:'可辨认性', 'alpha-edge':'透明边缘'}
function applicable(r:Requirement,c:AvgVisualReviewCriterionV1){return c==='identity'?r.references.some(ref=>ref.purpose==='identity'):c==='continuity'?r.references.length>0:c==='alpha-edge'?r.alpha==='required':true}
function defaults(r:Requirement):AvgAuthorVisualEvidenceV1['checks']{return AVG_VISUAL_REVIEW_CRITERIA_V1.map(criterion=>({criterion,result:applicable(r,criterion)?'unknown':'not-applicable',note:''}))}

function ReferenceView({scope,reference,ratio,family,onObserved}:{scope:WorkspaceScope;reference:Reference;ratio:number;family:AvgVisualProductionRequirementV1['family'];onObserved:(hash:string,available:boolean)=>void}){
  const [url,setUrl]=useState(''),[error,setError]=useState('')
  const json=JSON.stringify(reference)
  useEffect(()=>{
    let active=true,created='';setUrl('');setError('')
    const ref=JSON.parse(json) as Reference
    void (reference2(ref)?readAvgDraftReferenceImageV2(scope,ref,family):readAvgDraftReferenceImageV1(scope,ref)).then(image=>{if(active){created=URL.createObjectURL(new Blob([image.data],{type:image.asset.mimeType}));setUrl(created)}}).catch(cause=>{if(active)setError(String(cause))})
    return()=>{active=false;if(created)URL.revokeObjectURL(created)}
  },[scope,json,family])
  return <figure className="avg-review-reference"><figcaption>参考 · {reference.purpose} · {reference.contentHash.slice(0,12)}</figcaption>
    {error?<p role="alert">{error}</p>:url?<img src={url} alt={`准确参考 ${reference.purpose}`} style={{aspectRatio:ratio}} onLoad={()=>onObserved(reference.contentHash,true)} onError={()=>{setError('参考图片无法解码，请重新打开并核对准确文件。');onObserved(reference.contentHash,false)}}/>:<p>读取准确参考…</p>}
    <p>{reference.allowedChange}</p>{reference2(reference)&&<><p>允许取用：{reference.contentPolicy.permittedFeatures.join('；')}</p><p>明确排除：{reference.contentPolicy.excludedFeatures.join('；')||'无额外排除项'}</p></>}<p>授权：{reference.license}</p>
  </figure>
}

/** Author observations become a separate pending/accepted issue Artifact.
 * A decoder callback proves display availability, never artistic correctness. */
export default function VisualReviewPanel({scope,productionId,requirement:r,raw,reviewedImage=raw,policyVersion,accepted,pending,image,rawObserved,disabled,canAdopt,locked,declaration,onPending,onAction,onReload}:{
  scope:WorkspaceScope;productionId:number;requirement:Requirement;policyVersion?:2;raw:ProductBuildArtifactRecordV1;accepted?:ProductBuildArtifactRecordV1;pending?:ProductBuildArtifactRecordV1;
  image:ReactNode;rawObserved:boolean;disabled:boolean;canAdopt:boolean;locked:boolean;declaration:string;onPending:(value:boolean)=>void;
  reviewedImage?:ProductBuildArtifactRecordV1;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>
}){
  const [observed,setObserved]=useState<string[]>([]),[checks,setChecks]=useState(()=>defaults(r)),[dirty,setDirty]=useState(false)
  const [repair,setRepair]=useState(''),[reviewed,setReviewed]=useState('')
  const [note,setNote]=useState(''),[policy,setPolicy]=useState<PolicyAnswer[]>(()=>policyDefaults(r))
  const policyRequirement=policyVersion===2?parseAvgVisualProductionRequirementV2(r):null
  const needsRepair=checks.some(c=>c.result==='fail')||!!policyRequirement&&policy.some(c=>c.permittedFeatures==='fail'||c.excludedFeatures==='fail')
  const identity=`${scope.projectId}:${scope.worldId}:${scope.workId}:${policyVersion??1}:${JSON.stringify(r)}:${raw.version}:${raw.contentHash}:${reviewedImage.version}:${reviewedImage.contentHash}:${JSON.stringify(r.references)}`
  useEffect(()=>{setObserved([]);setChecks(defaults(r));setDirty(false);setRepair('');setReviewed('');setNote('');setPolicy(policyDefaults(r))},[identity]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{onPending(dirty)},[dirty,onPending])
  useEffect(()=>()=>onPending(false),[onPending])
  const refsReady=r.references.every(ref=>observed.includes(ref.contentHash))
  let candidateHash='';try{candidateHash=pending?String(JSON.parse(pending.metadataJson).candidateHash):''}catch{/* authority service rejects damaged records */}
  const report=():Omit<AvgReviewIssuesV1,'visualEvidence'|'audioEvidence'>&{visualEvidence:AvgAuthorVisualEvidenceV1}=>{
    const unavailable=[...(!rawObserved?['未查看准确原图']:[]),...r.references.filter(ref=>!observed.includes(ref.contentHash)).map(ref=>`未查看参考 ${ref.contentHash.slice(0,12)}`),...checks.filter(c=>c.result==='unknown').map(c=>`未观察：${LABELS[c.criterion]}`)]
    const issues=checks.filter(c=>c.result==='fail').map(c=>({issueKey:`visual.${c.criterion}`,locationKey:r.assetKey,evidence:c.note,severity:'blocking' as const,owner:'media' as const,
      allowedChange:repair,impact:'本候选不能选用；保留原图、费用与评审记录',recheck:`重新查看准确图像与参考，并复验${LABELS[c.criterion]}`}))
    return {schema:'storyforge.avg.review-issues',version:1,targetKey:r.requirementKey,observations:rawObserved?['visual']:[],unobserved:unavailable,issues,
      visualEvidence:{imageHash:rawObserved?reviewedImage.contentHash:null,referenceHashes:r.references.filter(ref=>observed.includes(ref.contentHash)).map(ref=>ref.contentHash),checks,note}}
  }
  const saveReport=async()=>{
    const base=report(),common={scope,productionId,requirementKey:r.requirementKey,rawVersion:raw.version,rawContentHash:raw.contentHash,declaration}
    if(!policyRequirement){await stageAvgVisualReviewV1({...common,report:base});return}
    const extra=policy.flatMap((answer,index)=>(['permittedFeatures','excludedFeatures'] as const).filter(field=>answer[field]==='fail').map(field=>({
      issueKey:`reference.${index}.${field==='permittedFeatures'?'permitted':'excluded'}`,locationKey:policyRequirement.references[index].assetKey,
      evidence:answer.note,severity:'blocking' as const,owner:'media' as const,allowedChange:repair,impact:'参考内容不符合本次声明，候选须返修',recheck:'重新查看候选与准确参考的允许/排除内容'})))
    const value:AvgReviewIssuesV2={...base,version:2,
      unobserved:[...base.unobserved,...policy.flatMap((p,i)=>p.permittedFeatures==='unknown'||p.excludedFeatures==='unknown'?[`参考${i+1}的使用内容尚未完整核对`]:[])],
      issues:[...base.issues,...extra],referencePolicy:{requirementHash:await hashProductProductionValueV2(policyRequirement),
        checks:await Promise.all(policyRequirement.references.map(async(ref,i)=>({assetKey:ref.assetKey,assetVersion:ref.assetVersion,contentHash:ref.contentHash,
          policyHash:await hashProductProductionValueV2(ref.contentPolicy),...policy[i]})))}}
    await stageAvgVisualReviewV2({...common,report:value})
  }
  return <section className="avg-visual-review" aria-label={`视觉评审：${r.name}`}><h6>作者视觉观察</h6>
    <p>并列查看原图、冻结配方的加工结果（如有）与本次准确参考，按共同画布检查身份、比例、构图、辨认和透明边缘。评审绑定实际将选用的图片版本，不能代替最终舞台和专业艺术验收。</p>
    <div className="avg-visual-review-grid">{image}{r.references.map((reference,i)=><ReferenceView key={`${identity}:${reference.assetKey}:${i}`} scope={scope} reference={reference} ratio={r.width/r.height} family={r.family}
      onObserved={(hash,available)=>setObserved(old=>available?old.includes(hash)?old:[...old,hash]:old.filter(value=>value!==hash))}/>)}</div>
    <p>{rawObserved?'准确原图已显示':'原图尚未显示'} · 参考 {observed.length}/{new Set(r.references.map(ref=>ref.contentHash)).size}。{!r.references.length&&'本项没有参考，不能据此证明跨图连续性。'}</p>
    {accepted&&<details><summary>已确认的评审 v{accepted.version}</summary><pre>{accepted.payloadJson}</pre><p>这是作者问题记录，不是商业质量通过回执。</p></details>}
    {locked&&<p>该评审已被组装执行消费；修改须先明确保留当前版本并创建新 Build。</p>}
    <fieldset disabled={disabled||!canAdopt||locked} className="avg-form">
      {checks.map((c,index)=><label key={c.criterion}>{LABELS[c.criterion]}<select aria-label={`观察结果：${LABELS[c.criterion]}`} value={c.result} onChange={event=>{setChecks(old=>old.map((entry,i)=>i===index?{...entry,result:event.target.value as typeof c.result,note:''}:entry));setDirty(true)}}>
        <option value="unknown">未观察 / 未确定</option><option value="pass" disabled={!rawObserved||!refsReady||['identity','continuity'].includes(c.criterion)&&!applicable(r,c.criterion)}>此项可用</option><option value="fail">需要返修（blocking）</option><option value="not-applicable" disabled={applicable(r,c.criterion)}>本需求不适用</option>
      </select>{c.result==='fail'&&<textarea aria-label={`问题证据：${LABELS[c.criterion]}`} value={c.note} maxLength={2000} onChange={event=>{setChecks(old=>old.map((entry,i)=>i===index?{...entry,note:event.target.value}:entry));setDirty(true)}}/>}</label>)}
      {policyRequirement&&<fieldset aria-label="逐项参考内容核对"><legend>逐项核对参考的使用范围</legend><p>传送参考和声明不代表结果符合；请查看候选与每张准确参考，再分别记录允许取用和排除内容。</p>
        {policyRequirement.references.map((ref,index)=><fieldset key={`${ref.assetKey}:${ref.assetVersion}:${ref.contentHash}`}><legend>参考 {index+1}</legend>
          <p>允许取用：{ref.contentPolicy.permittedFeatures.join('；')}</p><p>必须排除：{ref.contentPolicy.excludedFeatures.join('；')||'无额外排除项'}</p>
          {(['permittedFeatures','excludedFeatures'] as const).map((field,i)=><label key={field}>{i===0?'允许取用的内容符合声明':'排除内容符合声明'}<select aria-label={`参考${index+1}：${i===0?'允许取用':'排除内容'}`} value={policy[index]?.[field]??'unknown'} onChange={event=>{setPolicy(old=>old.map((p,j)=>j===index?{...p,[field]:event.target.value}:p));setDirty(true)}}>
            <option value="unknown">未观察 / 未确定</option><option value="pass" disabled={!rawObserved||!observed.includes(ref.contentHash)}>此项符合</option><option value="fail" disabled={!rawObserved||!observed.includes(ref.contentHash)}>需要返修</option>
          </select></label>)}
          <label>本张参考的观察依据或未观察原因<textarea aria-label={`参考${index+1}：观察依据`} maxLength={2000} value={policy[index]?.note??''} onChange={event=>{setPolicy(old=>old.map((p,j)=>j===index?{...p,note:event.target.value}:p));setDirty(true)}}/></label>
        </fieldset>)}
      </fieldset>}
      {needsRepair&&<label>允许的返修与加工范围<textarea value={repair} maxLength={2000} onChange={event=>{setRepair(event.target.value);setDirty(true)}}/></label>}
      <label>本次评审依据与修订说明<textarea value={note} maxLength={4000} onChange={event=>{setNote(event.target.value);setDirty(true)}}/></label>
      <button className="lf-action" disabled={!note.trim()||!dirty&&!!(accepted||pending)||checks.some(c=>c.result==='fail'&&!c.note.trim())||needsRepair&&!repair.trim()||!!policyRequirement&&policy.some(c=>!c.note.trim())} onClick={()=>void onAction(async()=>{
        await saveReport()
        setDirty(false);await onReload()
      })}>保存视觉评审候选：{r.name}</button>
      <button className="lf-action" disabled={!dirty} onClick={()=>{setChecks(defaults(r));setRepair('');setNote('');setPolicy(policyDefaults(r));setDirty(false)}}>撤销未保存的观察</button>
    </fieldset>
    {pending&&<><details><summary>核对视觉评审候选 v{pending.version}</summary><pre>{pending.payloadJson}</pre></details>
      <label><input type="checkbox" disabled={disabled||dirty||!canAdopt||locked} checked={reviewed===candidateHash&&!!candidateHash} onChange={event=>setReviewed(event.target.checked?candidateHash:'')}/>我已核对这份准确评审及未观察项</label>
      <button className="lf-action" disabled={disabled||dirty||!canAdopt||locked||!candidateHash||reviewed!==candidateHash} onClick={()=>void onAction(async()=>{
        await confirmAvgWorkspaceInputV1({scope,productionId,artifactKey:pending.artifactKey,candidateVersion:pending.version,candidateHash});await onReload()
      })}>确认评审记录：{r.name}</button></>}
  </section>
}
