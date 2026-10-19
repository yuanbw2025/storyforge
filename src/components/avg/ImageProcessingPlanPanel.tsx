import { useEffect,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgImageProcessingRecipeV1,AvgImageProcessingPlanV1 } from '../../lib/avg/image-processing-contract'
import { saveAvgImageProcessingDraftV1 } from '../../lib/avg/assembly-service'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import type { AvgVisualProductionRequirementV1 } from '../../lib/avg/media-production-contract'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'

type Requirement=Pick<AvgVisualProductionRequirementV1,'requirementKey'|'name'|'width'|'height'|'alpha'>
function initial(requirements:Requirement[],plan:AvgImageProcessingPlanV1|undefined,key:string):AvgImageProcessingRecipeV1{
  const saved=plan?.entries.find(e=>e.requirementKey===key)
  const r=requirements.find(r=>r.requirementKey===key)!
  return saved?.recipe??{schema:'storyforge.avg.image-processing-recipe',version:1,crop:null,width:r.width,height:r.height,fit:'contain',anchor:{x:5000,y:5000},background:null,declaration:''}
}
export default function ImageProcessingPlanPanel({scope,workspace,draftRevision,view,disabled,canEdit,onPending,onAction,onReload,onNotice}:{
  scope:WorkspaceScope;workspace:AvgAuthorWorkspaceV1;draftRevision:number;disabled:boolean;canEdit:boolean;onPending:(value:boolean)=>void;
  view?:Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>;onNotice:(message:string)=>void
}){
  const details=view?.details,visual=details?.brief?parseProductProductionBriefV3(details.brief.briefJson).avgVisualPlanning:undefined
  const requirements:Requirement[]=visual?visual.scope.templates.map(t=>t.parameters):workspace.mediaBatch?.requirements??[]
  const plan=visual?visual.imageProcessing:workspace.imageProcessing
  const editAllowed=canEdit&&(!visual||details!.production.status==='brief-ready'&&(!details!.build||details!.brief!.revision>details!.build.briefRevision))
  const revisionKey=`${scope.projectId}:${scope.worldId}:${scope.workId}:${draftRevision}:${visual?`${details!.production.id}:${details!.brief!.briefHash}:${details!.build?.id??0}:${details!.build?.stateRevision??0}`:'legacy'}`
  const [key,setKey]=useState(requirements[0]?.requirementKey??''),[recipe,setRecipe]=useState<AvgImageProcessingRecipeV1|null>(null)
  const [dirty,setDirty]=useState(false),[editRevision,setEditRevision]=useState(revisionKey)
  const [editDraftRevision,setEditDraftRevision]=useState(draftRevision)
  const savedJson=JSON.stringify(plan??null),batchJson=JSON.stringify(requirements)
  useEffect(()=>{
    if(dirty)return
    const list=JSON.parse(batchJson) as Requirement[],saved=JSON.parse(savedJson) as AvgImageProcessingPlanV1|null
    const r=list.find(r=>r.requirementKey===key)??list[0]
    setKey(r?.requirementKey??'');setRecipe(r?initial(list,saved??undefined,r.requirementKey):null);setEditRevision(revisionKey);setEditDraftRevision(draftRevision)
  },[key,savedJson,batchJson,revisionKey,dirty,draftRevision])
  useEffect(()=>{onPending(dirty)},[dirty,onPending])
  useEffect(()=>()=>onPending(false),[onPending])
  if(!requirements.length||!recipe)return null
  const r=requirements.find(r=>r.requirementKey===key)
  if(!r)return <section aria-label="本地图像加工配方"><p role="alert">加工目标已变化，请撤销未保存的加工后重新核对。</p><button className="lf-action" onClick={()=>setDirty(false)}>撤销未保存的加工</button></section>
  const edit=(next:AvgImageProcessingRecipeV1)=>{if(!dirty){setEditRevision(revisionKey);setEditDraftRevision(draftRevision)}setRecipe(next);setDirty(true)}
  const save=(remove=false)=>void onAction(async()=>{
    if(dirty&&editRevision!==revisionKey)throw new Error('[avg-process] 编辑期间草稿或专业方案已变化，请撤销未保存的加工后重新核对')
    const entries=(plan?.entries??[]).filter(e=>e.requirementKey!==key)
    if(!remove)entries.push({requirementKey:key,recipe})
    const next:AvgImageProcessingPlanV1|null=entries.length?{schema:'storyforge.avg.image-processing-plan',version:1,entries}:null
    if(visual){
      const {prepareAvgVisualImageProcessingV4,prepareAvgVisualImageProcessingV5}=await import('../../lib/avg/visual-processing-workspace')
      await (visual.version===5?prepareAvgVisualImageProcessingV5:prepareAvgVisualImageProcessingV4)({scope,productionId:details!.production.id!,expectedBriefHash:details!.brief!.briefHash,expectedDraftRevision:draftRevision,
        expectedBuild:details!.build?{id:details!.build.id!,revision:details!.build.stateRevision}:null,plan:next})
    }else await saveAvgImageProcessingDraftV1({scope,expectedDraftRevision:dirty?editDraftRevision:draftRevision,plan:next})
    setDirty(false);await onReload();onNotice(visual?'加工配方已保存到尚未开始的专业制作方案；尚未执行或采用，原图与供应商请求保留。':'加工配方已保存为下次制作方案草稿；尚未执行或采用，原图与供应商请求保留。')
  })
  return <section aria-label="本地图像加工配方" className="avg-processing-plan"><h5>本地图像加工配方</h5>
    <p>先保存图片需求，再为下次 Build 冻结加工配方。裁切后等比适配到共同画布，保留原图；加工结果还须独立视觉评审和选用。透明留边不会移除原图的不透明底色。</p>
    {!editAllowed&&<p>当前制作方案已冻结。修改配方前请先保留当前版本，并在制作页明确准备新版本。</p>}
    <fieldset className="avg-form" disabled={disabled||!editAllowed}>
      <label>加工目标<select aria-label="加工目标" value={key} disabled={dirty} onChange={e=>setKey(e.target.value)}>{requirements.map(r=><option key={r.requirementKey} value={r.requirementKey}>{r.name}</option>)}</select></label>
      <label>加工画布宽<input type="number" min={32} max={4096} value={recipe.width} onChange={e=>edit({...recipe,width:Number(e.target.value)})}/></label>
      <label>加工画布高<input type="number" min={32} max={4096} value={recipe.height} onChange={e=>edit({...recipe,height:Number(e.target.value)})}/></label>
      <label>画布适配<select value={recipe.fit} onChange={e=>edit({...recipe,fit:e.target.value as 'contain'|'cover'})}><option value="contain">完整放入并留边</option><option value="cover">填满画布并裁去超出部分</option></select></label>
      <label>水平锚点<select value={recipe.anchor.x} onChange={e=>edit({...recipe,anchor:{...recipe.anchor,x:Number(e.target.value)}})}><option value={0}>靠左</option><option value={5000}>居中</option><option value={10000}>靠右</option></select></label>
      <label>垂直锚点<select value={recipe.anchor.y} onChange={e=>edit({...recipe,anchor:{...recipe.anchor,y:Number(e.target.value)}})}><option value={0}>靠上</option><option value={5000}>居中</option><option value={10000}>靠下</option></select></label>
      <label><input type="checkbox" checked={!!recipe.crop} onChange={e=>edit({...recipe,crop:e.target.checked?{x:0,y:0,width:10000,height:10000}:null})}/>明确裁切原图范围</label>
      {recipe.crop&&(['x','y','width','height'] as const).map((field,index)=><label key={field}>{['裁切左侧（%）','裁切顶部（%）','裁切宽度（%）','裁切高度（%）'][index]}<input type="number" min={field==='width'||field==='height'?0.01:0} max={100} step={0.01} value={recipe.crop![field]/100} onChange={e=>edit({...recipe,crop:{...recipe.crop!,[field]:Math.round(Number(e.target.value)*100)}})}/></label>)}
      <label><input type="checkbox" checked={!!recipe.background} onChange={e=>edit({...recipe,background:e.target.checked?{red:255,green:255,blue:255,alpha:255}:null})}/>明确填充画布底色</label>
      {recipe.background&&(['red','green','blue','alpha'] as const).map((field,index)=><label key={field}>{['底色红','底色绿','底色蓝','底色不透明度（0～255）'][index]}<input type="number" min={0} max={255} value={recipe.background![field]} onChange={e=>edit({...recipe,background:{...recipe.background!,[field]:Number(e.target.value)}})}/></label>)}
      <label>允许的加工与用途说明<textarea value={recipe.declaration} maxLength={2000} onChange={e=>edit({...recipe,declaration:e.target.value})}/></label>
      <p>最终选图仍须满足该需求的 {r.width} × {r.height} 最小尺寸、画幅和透明要求；裁掉主体或放大变糊须记录返修。</p>
      <button className="lf-action" disabled={!dirty||!recipe.declaration.trim()} onClick={()=>save()}>保存本项加工配方</button>
      <button className="lf-action" disabled={dirty||!plan?.entries.some(e=>e.requirementKey===key)} onClick={()=>save(true)}>移除此项加工配方</button>
      <button className="lf-action" disabled={!dirty} onClick={()=>{setDirty(false);setRecipe(initial(requirements,plan,key))}}>撤销未保存的加工</button>
    </fieldset>
    {!!plan?.entries.length&&<details><summary>已保存的加工配方（{plan.entries.length} 项）</summary><pre>{savedJson}</pre></details>}
  </section>
}
