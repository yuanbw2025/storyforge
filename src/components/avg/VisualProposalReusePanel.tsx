import { useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgVisualBibleV1, AvgMediaBriefV1 } from '../../lib/avg/visual-planning-contract'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import { prepareAvgVisualProposalReuseV4, readAvgVisualReuseOptionsV4, type AvgVisualReuseSelectionV4 } from '../../lib/avg/visual-planning-reuse-workspace'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
const selectionKey=(items:AvgVisualReuseSelectionV4[])=>JSON.stringify([...items].sort((a,b)=>a.artifact.artifactKey.localeCompare(b.artifact.artifactKey)))
const statusLabel:Record<string,string>={cancelled:'已停止',failed:'失败', 'recovery-required':'待处理失败',paused:'已暂停',
  'preview-ready':'预览已冻结','release-ready':'可发布',released:'已发布'}

function DesignPreview({value,subjectName,outputName}:{value:unknown;subjectName:(key:string)=>string;outputName:(key:string)=>string}){
  // Display only. All source schemas and exact payloads were verified by the
  // reader; this view grants no candidate/adoption authority.
  const p=value as AvgVisualBibleV1|AvgMediaBriefV1
  return p.schema==='storyforge.avg.visual-bible'?<>
    <p>媒介：{p.style.medium}；绘制：{p.style.rendering}；配色：{p.style.palette.join('、')}</p>
    <p>光照：{p.style.lighting}；构图：{p.style.composition}</p>
    {p.subjects.map(s=><p key={s.subjectKey}>{subjectName(s.subjectKey)}：保持 {s.identityInvariants.join('；')}；允许 {s.allowedChanges.join('；')}；不表现 {s.forbiddenDepictions.join('；')}</p>)}
  </>:<><p>{p.designIntent}</p>{p.outputs.map(o=><p key={o.requirementKey}>{outputName(o.requirementKey)}：{o.prompt}；保持 {o.invariants.join('；')}；排除 {[o.negativePrompt,...o.forbiddenDepictions].filter(Boolean).join('；')}；使用 {o.referenceKeys.length} 份已许可参考。</p>)}</>
}

export default function VisualProposalReusePanel({scope,view,workspace,disabled,onAction,onReload,onNotice,onPending}:{
  scope:WorkspaceScope;view:View;workspace:AvgAuthorWorkspaceV1;disabled:boolean;onAction:(task:()=>Promise<void>)=>Promise<void>;
  onReload:()=>Promise<void>;onNotice:(message:string)=>void;onPending:(pending:boolean)=>void
}){
  const details=view.details!,brief=parseProductProductionBriefV3(details.brief!.briefJson),build=details.build!
  const saved=(brief.avgVisualPlanning?.proposalReuse??[]).map(r=>({buildNumber:r.buildNumber,buildRevision:r.buildRevision,artifact:r.artifact}))
  const savedKey=selectionKey(saved)
  const [choices,setChoices]=useState<AvgVisualReuseSelectionV4[]>(saved)
  const [sourceNumber,setSourceNumber]=useState(String(build.buildNumber))
  const [read,setRead]=useState<Awaited<ReturnType<typeof readAvgVisualReuseOptionsV4>>|null>(null)
  const changed=selectionKey(choices)!==savedKey
  useEffect(()=>{setChoices(JSON.parse(savedKey))},[savedKey])
  useEffect(()=>{onPending(changed);return()=>onPending(false)},[changed,onPending])
  const histories=details.buildHistory.filter(b=>['cancelled','failed','recovery-required','paused','preview-ready','release-ready','released'].includes(b.status))
  const selected=histories.find(b=>String(b.buildNumber)===sourceNumber)
  const subjectName=(key:string)=>workspace.systemPlan.scenes.find(s=>s.key===key)?.title??workspace.systemPlan.characters.find(c=>c.key===key)?.displayName
    ??(workspace.systemPlan.version===2?workspace.systemPlan.inventory.items.find(i=>i.key===key)?.name:undefined)??'旧版本主体'
  const outputName=(key:string)=>brief.avgVisualPlanning!.scope.templates.find(t=>t.parameters.requirementKey===key)?.parameters.name??'本图'
  const label=(key:string)=>{
    if(key==='avg.media.visual-bible')return '视觉基准'
    for(const [kind,title] of [['environment','场景方案'],['character','人物方案'],['prop','物件方案']]){
      const prefix=`avg.media.${kind}-brief.`
      if(key.startsWith(prefix))return `${title}：${subjectName(key.slice(prefix.length))}`
    }
    return '历史专业方案'
  }
  return <section className="avg-input-card" aria-label="历史专业方案复用"><h5>选择历史专业方案</h5>
    <p>读取已确认的改稿作为新候选初稿，原模型内容分别保留。保存此选择不开始制作；开始新版本后仍需逐份确认采用。参考、用途、视觉基准或岗位方法变化会停止复用，需另行调整方案。</p>
    <label>来源版本<select aria-label="复用来源版本" value={sourceNumber} disabled={disabled} onChange={e=>{setSourceNumber(e.target.value);setRead(null)}}>
      {histories.map(b=><option key={b.buildNumber} value={b.buildNumber}>制作版本 {b.buildNumber} · {statusLabel[b.status]}</option>)}
    </select></label>
    <button className="lf-action" disabled={disabled||!selected} onClick={()=>void onAction(async()=>{
      setRead(await readAvgVisualReuseOptionsV4({scope,productionId:details.production.id!,buildNumber:selected!.buildNumber,expectedBuildRevision:selected!.stateRevision}))
    })}>读取此版本已确认方案</button>
    {read?.options.map(option=><article key={option.artifactKey} aria-label={`历史方案：${label(option.artifactKey)}`}>
      <p>{label(option.artifactKey)}</p>
      {option.available?<>
        <details><summary>查看历史改稿与原模型内容</summary><p>已确认改稿{option.authorEdited?'（含人工修改）':''}</p><DesignPreview value={option.payload} {...{subjectName,outputName}}/><p>原模型内容</p><DesignPreview value={option.modelPayload} {...{subjectName,outputName}}/></details>
        <label><input type="checkbox" disabled={disabled} checked={choices.some(c=>selectionKey([c])===selectionKey([option.selection]))} onChange={e=>{
          setChoices(old=>[...old.filter(c=>c.artifact.artifactKey!==option.artifactKey),...(e.target.checked?[option.selection]:[])])
        }}/>复用已确认方案：{label(option.artifactKey)}</label>
      </>:<p role="status">不可复用：{option.reason}</p>}
    </article>)}
    <p>已选 {choices.length} 个岗位。各岗位可分别选择来源版本；未选择的岗位保留原有限生成预算。</p>
    {choices.map(choice=><p key={choice.artifact.artifactKey}>版本 {choice.buildNumber}：{label(choice.artifact.artifactKey)} <button className="lf-action" disabled={disabled} onClick={()=>setChoices(old=>old.filter(c=>c.artifact.artifactKey!==choice.artifact.artifactKey))}>取消复用：{label(choice.artifact.artifactKey)}</button></p>)}
    <button className="lf-action" disabled={disabled||!changed} onClick={()=>void onAction(async()=>{
      await prepareAvgVisualProposalReuseV4({scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash,
        expectedDraftRevision:view.draft.revision,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,selections:choices})
      await onReload();onNotice('复用来源与新版本预算已保存，尚未开始；请核对后明确开始。')
    })}>保存复用方案</button>
    {changed&&<button className="lf-action" disabled={disabled} onClick={()=>setChoices(saved)}>撤销未保存的复用选择</button>}
  </section>
}
