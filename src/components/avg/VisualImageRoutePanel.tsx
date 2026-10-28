import { useEffect,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import { prepareAvgVisualImageRouteV4,prepareAvgVisualImageRouteV5 } from '../../lib/avg/visual-image-route-workspace'
import type { AvgImageAdapterIdV4 } from '../../lib/avg/media-reference-contract'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
export default function VisualImageRoutePanel({scope,view,disabled,onAction,onReload,onNotice,onPending}:{
  scope:WorkspaceScope;view:View;disabled:boolean;onAction:(task:()=>Promise<void>)=>Promise<void>;
  onReload:()=>Promise<void>;onNotice:(text:string)=>void;onPending:(pending:boolean)=>void
}){
  const details=view.details!,brief=parseProductProductionBriefV3(details.brief!.briefJson),saved=brief.avgVisualPlanning!.imageBinding.adapterId
  const [selected,setSelected]=useState<AvgImageAdapterIdV4>(saved),changed=selected!==saved
  useEffect(()=>{setSelected(saved)},[saved])
  useEffect(()=>{onPending(changed);return()=>onPending(false)},[changed,onPending])
  return <section className="avg-input-card" aria-label="专业图片模型"><h5>图片模型</h5>
    <p>模型选择保存为新的制作方案，已有请求与账单保留。模型能力、费用和实际画面以本批回执与查看结果为准；保存配置不会开始请求。</p>
    <label>专业图片模型<select aria-label="专业图片模型" value={selected} disabled={disabled} onChange={e=>setSelected(e.target.value as AvgImageAdapterIdV4)}>
      <option value="agnes.image-2.1-flash.v1">Agnes Image 2.1 Flash</option>
      <option value="agnes.image-2.5-flash.v1">Agnes Image 2.5 Flash</option>
    </select></label>
    <button className="lf-action" disabled={disabled} onClick={()=>void onAction(async()=>{
      await (brief.avgVisualPlanning!.version===5?prepareAvgVisualImageRouteV5:prepareAvgVisualImageRouteV4)({scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash,
        expectedDraftRevision:view.draft.revision,expectedBuild:details.build?{id:details.build.id!,revision:details.build.stateRevision}:null,adapterId:selected})
      await onReload();onNotice('图片模型与当前配置已核对并保存；方案尚未开始。')
    })}>核对并保存图片模型</button>
    {changed&&<button className="lf-action" disabled={disabled} onClick={()=>setSelected(saved)}>撤销未保存的模型选择</button>}
  </section>
}
