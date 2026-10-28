import { useCallback, useEffect, useState } from 'react'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import { parseProductProductionPlanV3 } from '../../lib/product-production/plan'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { confirmAvgWorkspaceInputV1, restartAvgVisualPlanningFromDraftV4,restartAvgVisualPlanningFromDraftV5 } from '../../lib/avg/assembly-service'
import { avgVisualPlanningExecutionReadyV5 } from '../../lib/avg/visual-planning-brief-v5'
import { avgVisualPlanningExecutionReadyV4 } from '../../lib/avg/visual-planning-brief'
import { stageAvgVisualPlanningAuthorInputV4, refuseAvgVisualPlanningBatchV4,stageAvgVisualPlanningAuthorInputV5,refuseAvgVisualPlanningBatchV5,type AvgVisualPlanningDraftV5,type AvgVisualPlanningDraftV4 } from '../../lib/avg/visual-planning-workspace'
import type { AvgVisualBibleV1, AvgMediaBriefV1 } from '../../lib/avg/visual-planning-contract'
import VisualPlanningScopeForm from './VisualPlanningScopeForm'
import VisualProposalReusePanel from './VisualProposalReusePanel'
import VisualProposalReusePanelV5 from './VisualProposalReusePanelV5'
import VisualImageRoutePanel from './VisualImageRoutePanel'

type View = Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Semantic = AvgVisualBibleV1 | AvgMediaBriefV1
const list = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean)

function proposalProducerSettled(view:View,proposal:ProductBuildArtifactRecordV1):boolean{
  const details=view.details,build=details?.build,brief=details?.executionBrief
  if(!build?.id||!brief)return false
  try{
    const task=parseProductProductionPlanV3(build.planJson,brief,build.briefHash).tasks.find(row=>row.outputArtifactKeys.includes(proposal.artifactKey))
    if(!task)return false
    const entry=(JSON.parse(build.budgetLedgerJson) as {tasks?:Record<string,{status?:unknown;runId?:unknown;terminalReceiptHash?:unknown;errorCode?:unknown}>}).tasks?.[task.taskKey]
    return entry?.status==='settled'&&entry.runId===proposal.producerRunId
      &&entry.terminalReceiptHash===proposal.producerReceiptHash&&entry.errorCode===null
  }catch{return false}
}

function ProposalCard({scope,view,proposal,workspace,disabled,declaration,onAction,onReload,onNotice,onPending,onContinue,continueDisabled}: {
  scope:WorkspaceScope;view:View;proposal:ProductBuildArtifactRecordV1;workspace:AvgAuthorWorkspaceV1;disabled:boolean;declaration:string;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>;onNotice:(text:string)=>void;onPending:(key:string,value:boolean)=>void
  onContinue:()=>Promise<void>;continueDisabled:boolean
}) {
  const original = JSON.parse(proposal.payloadJson) as {targetArtifactKey:string;payload:Semantic;modelPayload?:Semantic}
  const modelPayload=original.modelPayload??original.payload
  const [value,setValue]=useState<Semantic>(()=>{
    const saved=view.artifacts.filter(a=>a.artifactKey===original.targetArtifactKey&&['accepted','pending'].includes(a.status)).sort((a,b)=>b.version-a.version)[0]
    return saved?JSON.parse(saved.payloadJson):structuredClone(original.payload)
  }),[changed,setChanged]=useState(false)
  const [reviewed,setReviewed]=useState(false),[reason,setReason]=useState('')
  const build=view.details!.build!,productionId=view.details!.production.id!,key=original.targetArtifactKey
  const accepted=view.artifacts.find(a=>a.artifactKey===key&&a.status==='accepted')
  const producerSettled=proposalProducerSettled(view,proposal)
  const pending=view.artifacts.filter(a=>a.artifactKey===key&&a.status==='pending'&&a.version>(accepted?.version??0)).sort((a,b)=>b.version-a.version)[0]
  const candidateHash=pending?String(JSON.parse(pending.metadataJson).candidateHash??''):''
  const canEdit=build.status==='building'&&view.details!.production.status==='producing'&&!accepted&&producerSettled
  const subjectName=(key:string)=>workspace.systemPlan.scenes.find(s=>s.key===key)?.title??workspace.systemPlan.characters.find(c=>c.key===key)?.displayName??(workspace.systemPlan.version===2?workspace.systemPlan.inventory.items.find(i=>i.key===key)?.name:undefined)??key
  const label=value.schema==='storyforge.avg.visual-bible'?'视觉基准':`${{environment:'场景方案',character:'人物方案',prop:'物件方案'}[value.subjectKind]}：${subjectName(value.subjectKey)}`
  useEffect(()=>{setReviewed(false)},[candidateHash])
  useEffect(()=>{onPending(key,changed||!!reason.trim());return()=>onPending(key,false)},[changed,reason,key,onPending])
  const change=(update:(next:Semantic)=>void)=>{const next=structuredClone(value);update(next);setValue(next);setChanged(true);setReviewed(false)}
  const selection={scope,productionId,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,artifactKey:key,
    proposal:{artifactKey:proposal.artifactKey,version:proposal.version,contentHash:proposal.contentHash}}
  return <article className="avg-input-card" aria-label={`专业方案：${label}`}><h5>{label}</h5>
    <p>{accepted?'此方案已明确采用。':pending?'已有待确认版本，请核对后采用。':original.modelPayload?'历史方案已复验，尚未采用。':'原始方案已接收，尚未采用。'} 原始内容与作者修订分别保留。</p>
    {!accepted&&!producerSettled&&<div role="status"><p>该方案的 producer ledger 尚未完成结算，暂不能编辑或保存；可继续或恢复本批任务，完成后再读取已保存版本。</p>
      <button className="lf-action" disabled={continueDisabled} onClick={()=>void onContinue()}>继续或恢复本批任务</button></div>}
    {original.modelPayload&&<p>初稿来自所选历史改稿，本岗位没有新的模型调用；{accepted?'已在此版本确认采用。':'当前版本尚需保存并确认采用。'}</p>}
    <details><summary>查看原始方案内容</summary>{modelPayload.schema==='storyforge.avg.visual-bible'?<><p>{Object.values(modelPayload.style).map(v=>Array.isArray(v)?v.join('、'):v).join('；')}</p>{modelPayload.subjects.map(s=><p key={s.subjectKey}>保持：{s.identityInvariants.join('；')}。允许变化：{s.allowedChanges.join('；')}。不表现：{s.forbiddenDepictions.join('；')}</p>)}</>:<><p>{modelPayload.designIntent}</p>{modelPayload.outputs.map(o=><p key={o.requirementKey}>{o.prompt}；保持：{o.invariants.join('；')}；排除：{[o.negativePrompt,...o.forbiddenDepictions].filter(Boolean).join('；')}</p>)}</>}</details>
    <fieldset className="avg-form" disabled={disabled||!canEdit}>
      {value.schema==='storyforge.avg.visual-bible'?<>
        {(['medium','rendering','lighting','composition'] as const).map((field,i)=><label key={field}>{['画面媒介','绘制方式','光照方向','构图与留白'][i]}<textarea aria-label={['画面媒介','绘制方式','光照方向','构图与留白'][i]} value={value.style[field]} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.visual-bible')p.style[field]=e.target.value})}/></label>)}
        <label>主配色（每行一项）<textarea aria-label="主配色（每行一项）" value={value.style.palette.join('\n')} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.visual-bible')p.style.palette=list(e.target.value)})}/></label>
        {value.subjects.map((subject,i)=><fieldset key={subject.subjectKey}><legend>主体：{subjectName(subject.subjectKey)}</legend>
          {(['identityInvariants','allowedChanges','forbiddenDepictions'] as const).map((field,j)=><label key={field}>{['主体保持项','主体允许变化','主体不得表现的信息'][j]}（每行一项）<textarea aria-label={`${['主体保持项','主体允许变化','主体不得表现的信息'][j]}（每行一项）`} value={subject[field].join('\n')} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.visual-bible')p.subjects[i][field]=list(e.target.value)})}/></label>)}
        </fieldset>)}
      </>:<>
        <label>设计意图<textarea aria-label="设计意图" value={value.designIntent} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.designIntent=e.target.value})}/></label>
        {value.outputs.map((output,i)=>{const template=view.details!.executionBrief!.avgVisualPlanning!.scope.templates.find(t=>t.parameters.requirementKey===output.requirementKey)!;return <fieldset key={output.requirementKey}><legend>{template.parameters.name}</legend>
          <label>生成画面要求<textarea aria-label="生成画面要求" value={output.prompt} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.outputs[i].prompt=e.target.value})}/></label>
          <label>排除画面<textarea aria-label="排除画面" value={output.negativePrompt} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.outputs[i].negativePrompt=e.target.value})}/></label>
          {(['invariants','forbiddenDepictions'] as const).map((field,j)=><label key={field}>{['本图保持项','本图不得表现的信息'][j]}（每行一项）<textarea aria-label={`${['本图保持项','本图不得表现的信息'][j]}（每行一项）`} value={output[field].join('\n')} onChange={e=>change(p=>{if(p.schema==='storyforge.avg.media-brief')p.outputs[i][field]=list(e.target.value)})}/></label>)}
          <p>用途、尺寸和参考权限来自已确认制作方案，本卡只能修改画面设计。</p>
        </fieldset>})}
      </>}
      <button className="lf-action" disabled={!declaration.trim()} onClick={()=>void onAction(async()=>{await (view.details!.executionBrief!.avgVisualPlanning!.version===5?stageAvgVisualPlanningAuthorInputV5:stageAvgVisualPlanningAuthorInputV4)({...selection,payload:value,declaration});setChanged(false);await onReload();onNotice('方案已保存为待确认版本；尚未采用或发送图片请求。')})}>保存待确认：{label}</button>
      {pending&&<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已核对本方案内容及允许参考</label><button className="lf-action" disabled={changed||!reviewed} onClick={()=>void onAction(async()=>{await confirmAvgWorkspaceInputV1({scope,productionId,artifactKey:key,candidateVersion:pending.version,candidateHash});setReason('');await onReload();onNotice('该准确方案已采用；下一步仍需明确执行。')})}>确认采用：{label}</button></>}
      <label>退回依据<textarea aria-label="退回依据" value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="lf-action" disabled={!reason.trim()} onClick={()=>void onAction(async()=>{await (view.details!.executionBrief!.avgVisualPlanning!.version===5?refuseAvgVisualPlanningBatchV5:refuseAvgVisualPlanningBatchV4)({...selection,reason});setChanged(false);setReason('');await onReload();onNotice('已记录退回依据并停止本批；原方案、账单和图片均保留，不会自动重发。')})}>退回此方案并停止本批</button>
    </fieldset>
    {changed&&<button className="lf-action" disabled={disabled} onClick={()=>{setValue(structuredClone(original.payload));setChanged(false)}}>撤销本卡未保存修改</button>}
    {!!reason.trim()&&<button className="lf-action" disabled={disabled} onClick={()=>setReason('')}>撤销未提交的退回依据</button>}
  </article>
}

export default function VisualPlanningPanel({scope,view,workspace,disabled,visible,activeBuild,sourcesReady,declaration,generating,onAction,onPrepare,onGenerate,onCancel,onReload,onNotice,onPending}: {
  scope:WorkspaceScope;view:View;workspace:AvgAuthorWorkspaceV1;disabled:boolean;visible:boolean;activeBuild:boolean;sourcesReady:boolean;declaration:string;generating:boolean;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onPrepare:(value:AvgVisualPlanningDraftV4|AvgVisualPlanningDraftV5)=>Promise<void>;onGenerate:()=>Promise<void>;onCancel:()=>void;
  onReload:()=>Promise<void>;onNotice:(text:string)=>void;onPending:(pending:boolean)=>void
}) {
  const brief=view.details?.brief?parseProductProductionBriefV3(view.details.brief.briefJson):null
  const planning=brief?.avgVisualPlanning,prepared=planning?.scope
  const version=planning?.version??5
  const [edited,setEdited]=useState(false),[cardsPending,setCardsPending]=useState<Record<string,boolean>>({}),[editPrepared,setEditPrepared]=useState(false),[reusePending,setReusePending]=useState(false),[routePending,setRoutePending]=useState(false)
  const pendingCards=Object.values(cardsPending).some(Boolean)
  const enabled=version===5?avgVisualPlanningExecutionReadyV5():avgVisualPlanningExecutionReadyV4()
  const build=view.details?.build,closed=!!build&&!['authorized','building','integrating'].includes(build.status)
  const failed=!!build&&['failed','recovery-required'].includes(build.status)
  const recordedUsage=view.visualRecordedUsage??view.visualProgress?.budget.usage
  const pendingVersion=!!build&&!!view.details?.brief&&view.details.brief.revision!==build.briefRevision&&view.details.production.status==='brief-ready'
  const canDeclareScope=!build?.previewHash||!view.details?.executionBrief?.avgVisualPlanning
  const needsPreviewRevision=!!build?.previewHash&&workspace.basePreviewHash!==build.previewHash
  const proposals=view.artifacts.filter(a=>a.artifactKey.startsWith('avg.proposal.')&&a.status==='accepted')
  const available=!workspace.mediaBatch&&!workspace.voiceProduction&&!workspace.imageProcessing&&!workspace.presentation.stage.assets.some(a=>!a.mimeType.startsWith('image/'))
  useEffect(()=>{onPending(edited||pendingCards||reusePending||routePending);return()=>onPending(false)},[edited,pendingCards,reusePending,routePending,onPending])
  const cardPending=useCallback((key:string,value:boolean)=>setCardsPending(old=>old[key]===value?old:{...old,[key]:value}),[])
  if(!enabled&&!planning)return null
  return <section className="lf-paper" aria-label="专业视觉策划（实验）"><h4>专业视觉策划 <small>实验</small></h4>
    <p>先确认具体用途与合法参考，再由美术方向及对应的场景、人物、物件岗位提出方案。采用后编译图片需求，每项最多请求一次；费用可能未知，图片返回后仍须单独评审、选用和确认演出。</p>
    {!planning&&<p>可在同一批声明背景、人物姿态/表情及物件图标/详情图。没有身份基准时只生成原创设计，不承诺人物连续性；实际图像仍须逐项检查。</p>}
    {!available&&!planning&&<p>当前草稿已使用其他生成或声音方案。请保留该记录，通过原制作流程完成本批。</p>}
    {enabled&&available&&!activeBuild&&canDeclareScope&&needsPreviewRevision&&<p>请先在制作页点击“以此预览开始修订”并保存，再准备新增媒资。</p>}
    {enabled&&available&&!activeBuild&&canDeclareScope&&(!prepared||editPrepared)&&<VisualPlanningScopeForm
      version={version} key={view.details?.brief?.briefHash??`new.${version}`} {...{scope,workspace,view,prepared,visible,onAction}} disabled={disabled||pendingCards||needsPreviewRevision}
      onPending={setEdited} onCancel={()=>setEditPrepared(false)} onPrepare={async value=>{await onPrepare(value);setEdited(false);setEditPrepared(false)}}/>}
    {prepared&&<><p>已保存专业用途：{prepared.templates.map(t=>t.parameters.name).join('、')}；{prepared.referenceCatalog.length} 张授权参考。准备方案不会调用模型，须到制作页核对并明确开始。</p>
      <p>{pendingVersion?'新方案':'本批'}上限：{brief!.productionBudget.maximumModelCalls} 次方案调用、{brief!.productionBudget.maximumMediaCalls} 次图片请求。{recordedUsage?`${pendingVersion?'上一版已记录':'已记录'} ${recordedUsage.modelCalls} 次方案、${recordedUsage.mediaCalls} 次图片调用；费用${recordedUsage.costUsd===null?'未知':` $${recordedUsage.costUsd}`}。`:'费用以实际回执为准。'}</p>
      {pendingVersion&&<p role="status">新版本方案 v{view.details!.brief!.revision} 已准备，尚未开始。上一版及原始调用记录只读保留；请到制作页核对后明确开始。</p>}
      {pendingVersion&&planning?.version===4&&<VisualProposalReusePanel {...{scope,view,workspace,onAction,onReload,onNotice}} disabled={!enabled||disabled||edited} onPending={setReusePending}/>}
      {pendingVersion&&planning?.version===5&&<VisualProposalReusePanelV5 {...{scope,view,workspace,onAction,onReload,onNotice}} disabled={!enabled||disabled||edited} onPending={setReusePending}/>}
      {planning&&!activeBuild&&(!build||pendingVersion)&&<VisualImageRoutePanel {...{scope,view,onAction,onReload,onNotice}} disabled={!enabled||disabled||edited||reusePending} onPending={setRoutePending}/>}
      {!activeBuild&&(!build||pendingVersion)&&!edited&&<button className="lf-action" disabled={!enabled||disabled} onClick={()=>setEditPrepared(true)}>修改尚未开始的专业用途</button>}
      {build&&<><p>模型方案与原始响应、用量和未知费用保存在本次制作记录中。刷新只读取记录；继续执行需要明确点击。</p>
        {!sourcesReady&&!closed&&<p>请先到制作页明确采用系统规则和全部场景脚本。</p>}
        {!closed&&<button className="lf-action lf-action-primary" disabled={!enabled||disabled||edited||pendingCards||!sourcesReady||!declaration.trim()} onClick={()=>void onGenerate()}>执行已确认的专业方案与图片任务</button>}
        {generating&&<button className="lf-action" onClick={onCancel}>停止等待并保留记录</button>}
        {proposals.map(proposal=><ProposalCard key={`${build.id}:${proposal.artifactKey}:${proposal.contentHash}`} {...{scope,view,proposal,workspace,declaration,onAction,onReload,onNotice,onPending:cardPending,
          onContinue:onGenerate,continueDisabled:!enabled||disabled||edited||pendingCards||!sourcesReady||!declaration.trim()||generating||closed}} disabled={!enabled||disabled||edited||closed}/>)}
        {closed&&<p role={failed&&!pendingVersion?'alert':undefined}>{pendingVersion?'上一版已停止，旧方案与账单保留。新方案须另行明确开始，不会自动调用。':failed?'本批尚未完成，已停止自动调用。原始返回、已发生的调用与费用记录保留。可在此准备新版本，核对后另行开始。':'本次制作已结束或暂停，方案与账单保留，当前不会自动调用。'}{build.previewHash&&'冻结预览可在制作页试玩。'}</p>}
        {enabled&&!pendingVersion&&!build.previewHash&&['cancelled','failed','recovery-required'].includes(build.status)&&<>
          <p>准备新方案不发送请求。当前采用与评审不会复制到新版；开始后将按新方案的有限上限重新执行，旧结果未知时禁止重发。</p>
          <button className="lf-action" disabled={disabled||edited||pendingCards||generating} onClick={()=>void onAction(async()=>{
            await (version===5?restartAvgVisualPlanningFromDraftV5:restartAvgVisualPlanningFromDraftV4)({scope,productionId:view.details!.production.id!,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,expectedDraftRevision:view.draft.revision})
            await onReload();onNotice('新版本方案已准备，未发送请求；请到制作页核对并明确开始。')
          })}>保留记录并准备新版本方案</button>
        </>}
      </>}
    </>}
  </section>
}
