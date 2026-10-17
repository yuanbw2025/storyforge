import { useEffect,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgImageProcessingRecipeV1 } from '../../lib/avg/image-processing-contract'
import { saveAvgImageProcessingDraftV1 } from '../../lib/avg/assembly-service'

function initial(workspace:AvgAuthorWorkspaceV1,key:string):AvgImageProcessingRecipeV1{
  const saved=workspace.imageProcessing?.entries.find(e=>e.requirementKey===key)
  const r=workspace.mediaBatch!.requirements.find(r=>r.requirementKey===key)!
  return saved?.recipe??{schema:'storyforge.avg.image-processing-recipe',version:1,crop:null,width:r.width,height:r.height,fit:'contain',anchor:{x:5000,y:5000},background:null,declaration:''}
}
export default function ImageProcessingPlanPanel({scope,workspace,draftRevision,disabled,canEdit,onPending,onAction,onReload,onNotice}:{
  scope:WorkspaceScope;workspace:AvgAuthorWorkspaceV1;draftRevision:number;disabled:boolean;canEdit:boolean;onPending:(value:boolean)=>void;
  onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>;onNotice:(message:string)=>void
}){
  const [key,setKey]=useState(workspace.mediaBatch?.requirements[0]?.requirementKey??''),[recipe,setRecipe]=useState<AvgImageProcessingRecipeV1|null>(null)
  const [dirty,setDirty]=useState(false),[editRevision,setEditRevision]=useState(draftRevision)
  const savedJson=JSON.stringify(workspace.imageProcessing??null),batchJson=JSON.stringify(workspace.mediaBatch??null)
  useEffect(()=>{
    if(dirty)return
    const r=workspace.mediaBatch?.requirements.find(r=>r.requirementKey===key)??workspace.mediaBatch?.requirements[0]
    setKey(r?.requirementKey??'');setRecipe(r?initial(workspace,r.requirementKey):null);setEditRevision(draftRevision)
  },[key,savedJson,batchJson,draftRevision,dirty,workspace])
  useEffect(()=>{onPending(dirty)},[dirty,onPending])
  useEffect(()=>()=>onPending(false),[onPending])
  if(!workspace.mediaBatch||!recipe)return null
  const r=workspace.mediaBatch.requirements.find(r=>r.requirementKey===key)
  if(!r)return null
  const edit=(next:AvgImageProcessingRecipeV1)=>{if(!dirty)setEditRevision(draftRevision);setRecipe(next);setDirty(true)}
  const save=(remove=false)=>void onAction(async()=>{
    const entries=(workspace.imageProcessing?.entries??[]).filter(e=>e.requirementKey!==key)
    if(!remove)entries.push({requirementKey:key,recipe})
    await saveAvgImageProcessingDraftV1({scope,expectedDraftRevision:dirty?editRevision:draftRevision,plan:entries.length?{schema:'storyforge.avg.image-processing-plan',version:1,entries}:null})
    setDirty(false);await onReload();onNotice('加工配方已保存为下次制作方案草稿；尚未执行或采用，原图与供应商请求保留。')
  })
  return <section aria-label="本地图像加工配方" className="avg-processing-plan"><h5>本地图像加工配方</h5>
    <p>先保存图片需求，再为下次 Build 冻结加工配方。裁切后等比适配到共同画布，保留原图；加工结果还须独立视觉评审和选用。透明留边不会移除原图的不透明底色。</p>
    {!canEdit&&<p>当前制作方案已冻结。修改配方前请先保留当前版本，并在制作页明确准备新版本。</p>}
    <fieldset className="avg-form" disabled={disabled||!canEdit}>
      <label>加工目标<select value={key} disabled={dirty} onChange={e=>setKey(e.target.value)}>{workspace.mediaBatch.requirements.map(r=><option key={r.requirementKey} value={r.requirementKey}>{r.name}</option>)}</select></label>
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
      <button className="lf-action" disabled={dirty||!workspace.imageProcessing?.entries.some(e=>e.requirementKey===key)} onClick={()=>save(true)}>移除此项加工配方</button>
      <button className="lf-action" disabled={!dirty} onClick={()=>{setDirty(false);setRecipe(initial(workspace,key))}}>撤销未保存的加工</button>
    </fieldset>
    {!!workspace.imageProcessing?.entries.length&&<details><summary>已保存的加工配方（{workspace.imageProcessing.entries.length} 项）</summary><pre>{savedJson}</pre></details>}
  </section>
}
