import { useEffect,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import { prepareAvgVisualProposalReuseV5,readAvgVisualReuseOptionsV5,type AvgVisualReuseSelectionV5 } from '../../lib/avg/visual-planning-reuse-workspace-v5'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Options=Awaited<ReturnType<typeof readAvgVisualReuseOptionsV5>>
const key=(items:AvgVisualReuseSelectionV5[])=>JSON.stringify([...items].sort((a,b)=>a.artifact.artifactKey.localeCompare(b.artifact.artifactKey)))
const statusLabel:Record<string,string>={cancelled:'已停止',failed:'失败','recovery-required':'待处理失败',paused:'已暂停',
  'preview-ready':'预览已冻结','release-ready':'可发布',released:'已发布'}

/** Historical V5 proposals become fresh candidates in a new Build. The old
 * author adoption and model request remain immutable historical evidence. */
export default function VisualProposalReusePanelV5({scope,view,workspace,disabled,onAction,onReload,onNotice,onPending}:{
  scope:WorkspaceScope;view:View;workspace:AvgAuthorWorkspaceV1;disabled:boolean;onAction:(task:()=>Promise<void>)=>Promise<void>;
  onReload:()=>Promise<void>;onNotice:(message:string)=>void;onPending:(pending:boolean)=>void
}){
  const details=view.details!,brief=parseProductProductionBriefV3(details.brief!.briefJson),build=details.build!
  const saved=(brief.avgVisualPlanning?.version===5?brief.avgVisualPlanning.proposalReuse??[]:[]).map(r=>({buildNumber:r.buildNumber,buildRevision:r.buildRevision,artifact:r.artifact}))
  const savedKey=key(saved),[choices,setChoices]=useState<AvgVisualReuseSelectionV5[]>(saved),[sourceNumber,setSourceNumber]=useState(String(build.buildNumber))
  const [read,setRead]=useState<Options|null>(null)
  const changed=key(choices)!==savedKey
  useEffect(()=>{setChoices(JSON.parse(savedKey) as AvgVisualReuseSelectionV5[])},[savedKey])
  useEffect(()=>{onPending(changed);return()=>onPending(false)},[changed,onPending])
  const histories=details.buildHistory.filter(b=>['cancelled','failed','recovery-required','paused','preview-ready','release-ready','released'].includes(b.status))
  const selected=histories.find(b=>String(b.buildNumber)===sourceNumber)
  const subjectName=(subjectKey:string)=>workspace.systemPlan.scenes.find(s=>s.key===subjectKey)?.title
    ??workspace.systemPlan.characters.find(c=>c.key===subjectKey)?.displayName
    ??(workspace.systemPlan.version===2?workspace.systemPlan.inventory.items.find(i=>i.key===subjectKey)?.name:undefined)??subjectKey
  const label=(artifactKey:string)=>artifactKey==='avg.media.visual-bible'?'视觉基准':
    artifactKey.startsWith('avg.media.environment-brief.')?`场景方案：${subjectName(artifactKey.slice('avg.media.environment-brief.'.length))}`:
      artifactKey.startsWith('avg.media.character-brief.')?`人物方案：${subjectName(artifactKey.slice('avg.media.character-brief.'.length))}`:
        artifactKey.startsWith('avg.media.prop-brief.')?`物件方案：${subjectName(artifactKey.slice('avg.media.prop-brief.'.length))}`:'专业方案'
  return <section className="avg-input-card" aria-label="V5 历史专业方案复用">
    <h5>复用已确认的视觉方案</h5>
    <p>读取历史版本中已确认的改稿作为新版本候选初稿。旧版本的采用和模型调用只保留为来源证据；新版本开始后仍须逐项重新确认。语义范围或岗位方法不一致时，系统会拒绝复用。</p>
    <label>来源版本<select aria-label="V5 方案复用来源版本" value={sourceNumber} disabled={disabled} onChange={e=>{setSourceNumber(e.target.value);setRead(null)}}>
      {histories.map(b=><option key={b.buildNumber} value={b.buildNumber}>制作版本 {b.buildNumber} · {statusLabel[b.status]??b.status}</option>)}
    </select></label>
    <button className="lf-action" disabled={disabled||!selected} onClick={()=>void onAction(async()=>{
      setRead(await readAvgVisualReuseOptionsV5({scope,productionId:details.production.id!,buildNumber:selected!.buildNumber,expectedBuildRevision:selected!.stateRevision}))
    })}>读取已确认方案</button>
    {read?.options.map(option=><article key={option.artifactKey} aria-label={`V5 历史方案：${label(option.artifactKey)}`}>
      <p>{label(option.artifactKey)}</p>
      {option.available?<>
        <details><summary>查看已确认改稿与原模型方案</summary>
          <h6>历史作者已确认版本{option.authorEdited?'（经过人工修改）':''}</h6><pre>{JSON.stringify(option.payload,null,2)}</pre>
          <h6>原模型方案</h6><pre>{JSON.stringify(option.modelPayload,null,2)}</pre>
        </details>
        <label><input type="checkbox" disabled={disabled} checked={choices.some(c=>key([c])===key([option.selection]))} onChange={e=>{
          setChoices(old=>[...old.filter(c=>c.artifact.artifactKey!==option.artifactKey),...(e.target.checked?[option.selection]:[])])
        }}/>在新版本复用：{label(option.artifactKey)}</label>
      </>:<p role="status">不可复用：{option.reason}</p>}
    </article>)}
    <p>已选 {choices.length} 个岗位。未选岗位按新方案预算执行。</p>
    {choices.map(choice=><p key={choice.artifact.artifactKey}>版本 {choice.buildNumber}：{label(choice.artifact.artifactKey)} <button className="lf-action" disabled={disabled}
      onClick={()=>setChoices(old=>old.filter(c=>c.artifact.artifactKey!==choice.artifact.artifactKey))}>移除此复用项</button></p>)}
    <button className="lf-action" disabled={disabled||!changed} onClick={()=>void onAction(async()=>{
      await prepareAvgVisualProposalReuseV5({scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash,
        expectedDraftRevision:view.draft.revision,expectedBuildId:build.id!,expectedBuildRevision:build.stateRevision,selections:choices})
      await onReload();onNotice('V5 历史方案来源与预算已保存；尚未开始新制作。')
    })}>保存 V5 复用选择</button>
    {changed&&<button className="lf-action" disabled={disabled} onClick={()=>setChoices(JSON.parse(savedKey) as AvgVisualReuseSelectionV5[])}>撤销未保存的选择</button>}
  </section>
}
