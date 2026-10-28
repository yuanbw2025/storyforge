import { useEffect,useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import { parseAvgImageProcessingPlan,type AvgImageProcessingRecipe,type AvgImageProcessingPlan } from '../../lib/avg/image-processing-contract'
import { supportsAvgForegroundRequirementV1 } from '../../lib/avg/image-foreground-contract'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../../lib/product-production/character-alpha-matting'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from '../../lib/avg/image-foreground-boundary-unmix'
import { AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3 } from '../../lib/avg/image-foreground-estimated-magenta-v3'
import { AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MATTING_ID_V4,
  AVG_FOREGROUND_SAM2_MATTING_METHOD_V4, AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,
  AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4, AVG_FOREGROUND_SAM2_MATTING_ID_V5,
  AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5, AVG_FOREGROUND_SAM2_QUALITY_GATE_V5, AVG_FOREGROUND_SAM2_MATTING_ID_V6,
  AVG_FOREGROUND_SAM2_MATTING_METHOD_V6, AVG_FOREGROUND_SAM2_QUALITY_GATE_V6, AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6,
  supportsAvgSam2ForegroundRequirementV4 } from '../../lib/avg/image-foreground-contract'
import { saveAvgImageProcessingDraftV1 } from '../../lib/avg/assembly-service'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import type { AvgVisualProductionRequirementV1 } from '../../lib/avg/media-production-contract'
import { parseProductProductionBriefV3 } from '../../lib/product-production/contracts'
import RegionCompositeRecipeEditor from './RegionCompositeRecipeEditor'

type Requirement=Pick<AvgVisualProductionRequirementV1,'requirementKey'|'name'|'width'|'height'|'alpha'|'mediaKind'|'consumer'>
function initial(requirements:Requirement[],plan:AvgImageProcessingPlan|undefined,key:string):AvgImageProcessingRecipe{
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
  const [key,setKey]=useState(requirements[0]?.requirementKey??''),[recipe,setRecipe]=useState<AvgImageProcessingRecipe|null>(null)
  const [dirty,setDirty]=useState(false),[editRevision,setEditRevision]=useState(revisionKey)
  const [editDraftRevision,setEditDraftRevision]=useState(draftRevision)
  const [regionValid,setRegionValid]=useState(false),[regionPending,setRegionPending]=useState(false)
  const savedJson=JSON.stringify(plan??null),batchJson=JSON.stringify(requirements)
  useEffect(()=>{
    if(dirty)return
    const list=JSON.parse(batchJson) as Requirement[],saved=JSON.parse(savedJson) as AvgImageProcessingPlan|null
    const r=list.find(r=>r.requirementKey===key)??list[0]
    setKey(r?.requirementKey??'');setRecipe(r?initial(list,saved??undefined,r.requirementKey):null);setEditRevision(revisionKey);setEditDraftRevision(draftRevision)
  },[key,savedJson,batchJson,revisionKey,dirty,draftRevision])
  useEffect(()=>{onPending(dirty||regionPending)},[dirty,regionPending,onPending])
  useEffect(()=>()=>onPending(false),[onPending])
  if(!requirements.length||!recipe)return null
  const r=requirements.find(r=>r.requirementKey===key)
  if(!r)return <section aria-label="本地图像加工配方"><p role="alert">加工目标已变化，请撤销未保存的加工后重新核对。</p><button className="lf-action" onClick={()=>setDirty(false)}>撤销未保存的加工</button></section>
  const edit=(next:AvgImageProcessingRecipe)=>{if(!dirty){setEditRevision(revisionKey);setEditDraftRevision(draftRevision)}setRecipe(next);setDirty(true)}
  const regionTemplate=visual?.version===5?visual.scope.templates.find(t=>t.parameters.requirementKey===key&&t.parameters.mediaKind==='character-expression'):undefined
  const sam2=recipe.version===2&&(recipe.foreground.version===4||recipe.foreground.version===5||recipe.foreground.version===6)
  const save=(remove=false)=>void onAction(async()=>{
    if(dirty&&editRevision!==revisionKey)throw new Error('[avg-process] 编辑期间草稿或专业方案已变化，请撤销未保存的加工后重新核对')
    const entries:Array<AvgImageProcessingPlan['entries'][number]>=(plan?.entries??[]).filter(e=>e.requirementKey!==key)
    if(!remove)entries.push({requirementKey:key,recipe})
    const next=entries.length?parseAvgImageProcessingPlan({schema:'storyforge.avg.image-processing-plan',version:entries.some(e=>e.recipe.version===3)?3:entries.some(e=>e.recipe.version===2)?2:1,entries}):null
    if(visual){
      const {prepareAvgVisualImageProcessingV4,prepareAvgVisualImageProcessingV5}=await import('../../lib/avg/visual-processing-workspace')
      await (visual.version===5?prepareAvgVisualImageProcessingV5:prepareAvgVisualImageProcessingV4)({scope,productionId:details!.production.id!,expectedBriefHash:details!.brief!.briefHash,expectedDraftRevision:draftRevision,
        expectedBuild:details!.build?{id:details!.build.id!,revision:details!.build.stateRevision}:null,plan:next})
    }else await saveAvgImageProcessingDraftV1({scope,expectedDraftRevision:dirty?editDraftRevision:draftRevision,plan:next})
    setDirty(false);await onReload();onNotice(visual?'加工配方已保存到尚未开始的专业制作方案；尚未执行或采用，历史原图与请求保留。':'加工配方已保存为下次制作方案草稿；尚未执行或采用，历史原图与请求保留。')
  })
  return <section aria-label="本地图像加工配方" className="avg-processing-plan"><h5>本地图像加工配方</h5>
    <p>先保存图片需求，再为下次 Build 冻结加工配方。裁切后等比适配到共同画布，保留原图；加工结果还须独立视觉评审和选用。透明留边不会移除原图的不透明底色。</p>
    {!editAllowed&&<p>当前制作方案已冻结。修改配方前请先保留当前版本，并在制作页明确准备新版本。</p>}
    <fieldset className="avg-form" disabled={disabled||!editAllowed}>
      <label>加工目标<select aria-label="加工目标" value={key} disabled={dirty} onChange={e=>setKey(e.target.value)}>{requirements.map(r=><option key={r.requirementKey} value={r.requirementKey}>{r.name}</option>)}</select></label>
      {regionTemplate&&<label style={{gridColumn:'1 / -1'}}>允许的加工与用途说明<textarea aria-label="允许的加工与用途说明" value={recipe.declaration} maxLength={2000} onChange={e=>edit({...recipe,declaration:e.target.value})}/></label>}
      {visual?.version===5&&regionTemplate&&<RegionCompositeRecipeEditor key={key} scope={scope}
        references={visual.scope.referenceCatalog.filter(entry=>regionTemplate.allowedReferenceKeys.includes(entry.referenceKey)).map(entry=>entry.reference)}
        source={visual.rawReuse?.find(source=>source.requirementKey===key)} recipe={recipe.version===3?recipe:null}
        disabled={disabled||!editAllowed} onChange={edit} onValid={setRegionValid} onPending={setRegionPending}/>}
      {recipe.version===3&&<button className="lf-action" onClick={()=>edit({...initial(requirements,undefined,key),declaration:recipe.declaration})}>改用裁切或透明留边</button>}
      {recipe.version!==3&&(canEdit||recipe.version===2)&&supportsAvgForegroundRequirementV1(r)&&<label><input type="checkbox" checked={recipe.version===2} onChange={e=>{
        if(e.target.checked)edit({...recipe,version:2,background:null,foreground:{schema:'storyforge.avg.foreground-policy',version:1,
          method:'reserved-magenta',reservedColor:'#FF00FF',subjectUsesReservedColor:false,algorithm:DECLARED_MAGENTA_ALPHA_MATTING_ID_V1,declaration:''}})
        else if(recipe.version===2){const {foreground:_foreground,...canvas}=recipe;edit({...canvas,version:1})}
      }}/>{sam2?'对现有图片使用本机 SAM 2.1 分割并生成透明候选':'生成时使用纯品红底色，并在本地移除底色（实验性）'}</label>}
      {recipe.version===2&&<>{sam2
        ?<p>本机分割只处理同一作品中已冻结并保存的原图，不修改供应商请求、不上传参考、不触发生成。服务需单独启动；候选仍须对照原图查看、独立评审和选用。</p>
        :<p>保存后会把纯品红底色和主体禁用该色的要求写入下次生成方案。仅处理符合该声明的不透明原图；旧图和复杂背景不会自动补声明或重新生成。结果仍须检查边缘、主体完整性并独立选用。</p>}
        <label>前景边缘处理<select value={recipe.foreground.version} onChange={e=>{
          if(recipe.version!==2)return
          const declaration=recipe.foreground.declaration
          if(e.target.value==='1')edit({...recipe,foreground:{schema:'storyforge.avg.foreground-policy',version:1,method:'reserved-magenta',reservedColor:'#FF00FF',subjectUsesReservedColor:false,algorithm:DECLARED_MAGENTA_ALPHA_MATTING_ID_V1,declaration}})
          else if(e.target.value==='2')edit({...recipe,foreground:{schema:'storyforge.avg.foreground-policy',version:2,method:'reserved-magenta',reservedColor:'#FF00FF',subjectUsesReservedColor:false,algorithm:AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2,declaration}})
          else if(e.target.value==='3')edit({...recipe,foreground:{schema:'storyforge.avg.foreground-policy',version:3,method:'estimated-magenta-family',reservedColor:'#FF00FF',subjectUsesReservedColor:false,algorithm:AVG_FOREGROUND_ESTIMATED_MAGENTA_ID_V3,declaration}})
          else if(e.target.value==='4')edit({...recipe,foreground:{schema:'storyforge.avg.foreground-policy',version:4,method:'local-sam2-box-matting',algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V4,
            model:'sam2.1-hiera-tiny',modelRevision:AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,checkpointSha256:AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
            promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4,mattingMethod:AVG_FOREGROUND_SAM2_MATTING_METHOD_V4,declaration}})
          else if(e.target.value==='5')edit({...recipe,foreground:{schema:'storyforge.avg.foreground-policy',version:5,method:'local-sam2-box-anchor-matting',algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V5,
            model:'sam2.1-hiera-tiny',modelRevision:AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,checkpointSha256:AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
            promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,mattingMethod:AVG_FOREGROUND_SAM2_MATTING_METHOD_V4,qualityGate:AVG_FOREGROUND_SAM2_QUALITY_GATE_V5,declaration}})
          else if(e.target.value==='6')edit({...recipe,foreground:{schema:'storyforge.avg.foreground-policy',version:6,method:'local-sam2-neutral-background-matting',algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V6,
            model:'sam2.1-hiera-tiny',modelRevision:AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,checkpointSha256:AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
            promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5,mattingMethod:AVG_FOREGROUND_SAM2_MATTING_METHOD_V6,qualityGate:AVG_FOREGROUND_SAM2_QUALITY_GATE_V6,backgroundRule:AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6,declaration}})
        }}><option value={1}>精确品红：移除底色并保留边缘颜色</option><option value={2}>精确品红：移除底色并还原边缘颜色（实验性）</option>
          <option value={3}>偏色品红：估算边缘底色并还原（实验性）</option><option value={4} disabled={!supportsAvgSam2ForegroundRequirementV4(r)}>本机 SAM 2.1 人物框分割（旧候选策略）</option>
          <option value={5} disabled={!supportsAvgSam2ForegroundRequirementV4(r)}>本机 SAM 2.1 人物框与身体锚点（实验性候选）</option>
          <option value={6} disabled={!supportsAvgSam2ForegroundRequirementV4(r)}>本机 SAM 2.1 均匀亮灰背景细化（实验性候选）</option></select></label>
        {recipe.foreground.version===2&&<p>边缘颜色还原会改变局部像素；无可靠邻近颜色时保留原处理结果。保存后仍须对照原图检查发丝、衣饰和主体细节，再独立选用。</p>}
        {recipe.foreground.version===3&&<p>此独立算法只接受边缘至少 85% 属于稳定品红色系的原图，记录估算底色与覆盖率，并对连通背景和狭窄边界做本地处理。它不会重写原生成要求；复杂或不稳定边缘会直接拒绝，结果仍是待评审候选。</p>}
        {recipe.foreground.version===4&&<p>此策略调用你本机的 SAM 2.1 Hiera Tiny 与 PyMatting，不上传图片；服务须在本机 5278 端口运行，采用居中人物框提示和窄边缘 alpha 细化。仅适用于单张、居中的人物图；多人拼版、表情表或姿势表可能残留旁侧人物碎片或误删主体，应先拆成单张再处理。分割分数只描述模型输出，不是质量判定；头发、鞋底投影、遮挡或偏离画面中心的主体仍可能处理错误，输出必须与原图对照评审后再采用。</p>}
        {recipe.foreground.version===5&&<p>此策略调用本机 SAM 2.1 Hiera Tiny 与 PyMatting，比较人物框和身体定位提示，按固定分数与面积挡板选择掩模，优先保留较完整的主体。已有透明像素的原图会拒绝重分割，请使用画布加工保留原始透明度。仅适用于单张、居中的不透明人物图，拼版、表情表和姿势表应先拆分。头发、衣饰、投影和偏离中心的主体仍可能处理错误，必须对照原图评审后再采用。</p>}
        {recipe.foreground.version===6&&<p>仅适用于均匀亮灰底色、居中且不透明的单个人物。先检查原图背景，再将与画面外缘连通的亮灰区域从分割和边缘细化中排除；背景不稳定或需要削减过多主体时会拒绝加工并保留原件。肤色、发丝、白衣和镂空处仍须对照原图检查，评审通过后才能独立选用。</p>}
        <label>{sam2?'本机模型处理与作者审阅声明':'保留底色与主体用色声明'}<textarea maxLength={2000} value={recipe.foreground.declaration}
          onChange={e=>{if(recipe.version===2)edit({...recipe,foreground:{...recipe.foreground,declaration:e.target.value}})}}/></label></>}
      {recipe.version===3?<p>局部表情合成使用原身份参考 v{recipe.baseReference.assetVersion}，画布 {recipe.width} × {recipe.height}，已确认区域 {recipe.regions.length} 项。加工只改变这些表情区域，保持底图画布、透明度和区域外像素。</p>:<>
      <label>加工画布宽<input type="number" min={32} max={4096} value={recipe.width} onChange={e=>edit({...recipe,width:Number(e.target.value)})}/></label>
      <label>加工画布高<input type="number" min={32} max={4096} value={recipe.height} onChange={e=>edit({...recipe,height:Number(e.target.value)})}/></label>
      <label>画布适配<select value={recipe.fit} onChange={e=>edit({...recipe,fit:e.target.value as 'contain'|'cover'})}><option value="contain">完整放入并留边</option><option value="cover">填满画布并裁去超出部分</option></select></label>
      <label>水平锚点<select value={recipe.anchor.x} onChange={e=>edit({...recipe,anchor:{...recipe.anchor,x:Number(e.target.value)}})}><option value={0}>靠左</option><option value={5000}>居中</option><option value={10000}>靠右</option></select></label>
      <label>垂直锚点<select value={recipe.anchor.y} onChange={e=>edit({...recipe,anchor:{...recipe.anchor,y:Number(e.target.value)}})}><option value={0}>靠上</option><option value={5000}>居中</option><option value={10000}>靠下</option></select></label>
      <label><input type="checkbox" checked={!!recipe.crop} onChange={e=>edit({...recipe,crop:e.target.checked?{x:0,y:0,width:10000,height:10000}:null})}/>明确裁切原图范围</label>
      {recipe.crop&&(['x','y','width','height'] as const).map((field,index)=><label key={field}>{['裁切左侧（%）','裁切顶部（%）','裁切宽度（%）','裁切高度（%）'][index]}<input type="number" min={field==='width'||field==='height'?0.01:0} max={100} step={0.01} value={recipe.crop![field]/100} onChange={e=>edit({...recipe,crop:{...recipe.crop!,[field]:Math.round(Number(e.target.value)*100)}})}/></label>)}
      <label><input type="checkbox" checked={!!recipe.background} disabled={recipe.version===2} onChange={e=>edit({...recipe,background:e.target.checked?{red:255,green:255,blue:255,alpha:255}:null})}/>明确填充画布底色</label>
      {recipe.background&&(['red','green','blue','alpha'] as const).map((field,index)=><label key={field}>{['底色红','底色绿','底色蓝','底色不透明度（0～255）'][index]}<input type="number" min={0} max={255} value={recipe.background![field]} onChange={e=>edit({...recipe,background:{...recipe.background!,[field]:Number(e.target.value)}})}/></label>)}
      </>}
      {!regionTemplate&&<label>允许的加工与用途说明<textarea aria-label="允许的加工与用途说明" value={recipe.declaration} maxLength={2000} onChange={e=>edit({...recipe,declaration:e.target.value})}/></label>}
      <p>最终选图仍须满足该需求的 {r.width} × {r.height} 最小尺寸、画幅和透明要求；裁掉主体或放大变糊须记录返修。</p>
      <button className="lf-action" disabled={!dirty||!recipe.declaration.trim()||recipe.version===2&&!recipe.foreground.declaration.trim()||recipe.version===3&&!regionValid} onClick={()=>save()}>保存本项加工配方</button>
      <button className="lf-action" disabled={dirty||!plan?.entries.some(e=>e.requirementKey===key)} onClick={()=>save(true)}>移除此项加工配方</button>
      <button className="lf-action" disabled={!dirty} onClick={()=>{setDirty(false);setRecipe(initial(requirements,plan,key))}}>撤销未保存的加工</button>
    </fieldset>
    {!!plan?.entries.length&&<details><summary>已保存的加工配方（{plan.entries.length} 项）</summary><pre>{savedJson}</pre></details>}
  </section>
}
