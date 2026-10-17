import { useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgVisualPlanningDraftV4 } from '../../lib/avg/visual-planning-workspace'
import type { AvgVisualPlanningScopeV1, AvgVisualRequirementTemplateV1 } from '../../lib/avg/visual-planning-contract'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { parseAvgMediaReferencesV1 } from '../../lib/avg/media-reference-contract'
import { avgVisualFormReferenceV4, createAvgVisualFormTemplateV4, pruneAvgVisualFormReferencesV4, replaceAvgVisualFormReferenceV4, type AvgVisualFormPurposeV4 } from '../../lib/avg/visual-planning-form'
import GeneratedReferencePicker from './GeneratedReferencePicker'

type View=Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
const lines=(s:string)=>s.split('\n')
const sameFamily=(a:AvgVisualRequirementTemplateV1,b:AvgVisualRequirementTemplateV1)=>a.subjectKind===b.subjectKind
  &&a.parameters.family.subjectKey===b.parameters.family.subjectKey&&a.parameters.family.familyKey===b.parameters.family.familyKey
function initial(workspace:AvgAuthorWorkspaceV1,prepared?:AvgVisualPlanningScopeV1):AvgVisualPlanningDraftV4 {
  if(prepared){const {sourceInputHash:_hash,aspectRatio:_ratio,...value}=structuredClone(prepared);return value}
  return {schema:'storyforge.avg.visual-planning-scope',version:1,batchKey:`visual.batch.${crypto.randomUUID()}`,revision:1,
    templates:[createAvgVisualFormTemplateV4(workspace,'background')],referenceCatalog:[]}
}

/** Author intent form only; no provider, formal adoption or media binding. */
export default function VisualPlanningScopeForm({scope,workspace,view,prepared,disabled,visible,onPending,onPrepare,onAction,onCancel}:{
  scope:WorkspaceScope;workspace:AvgAuthorWorkspaceV1;view:View;prepared?:AvgVisualPlanningScopeV1;disabled:boolean;visible:boolean;
  onPending:(value:boolean)=>void;onPrepare:(value:AvgVisualPlanningDraftV4)=>Promise<void>;onAction:(action:()=>Promise<void>)=>Promise<void>;onCancel:()=>void
}){
  const [draft,setDraft]=useState(()=>initial(workspace,prepared)),[pending,setPending]=useState(false)
  const [external,setExternal]=useState(false),[derivative,setDerivative]=useState(false),[generatedFor,setGeneratedFor]=useState<string|null>(null)
  useEffect(()=>{onPending(pending);return()=>onPending(false)},[pending,onPending])
  const change=(value:AvgVisualPlanningDraftV4)=>{setDraft(value);setPending(true);setExternal(false);setDerivative(false);setGeneratedFor(null)}
  const edit=(key:string,mutate:(t:AvgVisualRequirementTemplateV1)=>void)=>{
    const next=structuredClone(draft);mutate(next.templates.find(t=>t.parameters.requirementKey===key)!);change(next)
  }
  const images=view.media.items.map(r=>r.asset).filter(a=>['image/png','image/jpeg','image/webp'].includes(a.mimeType))
  const items=workspace.systemPlan.version===2?workspace.systemPlan.inventory.items:[]
  const nextItem=(slots:('icon'|'detail')[])=>items.flatMap(item=>[null,...item.variants.map(v=>v.key)].map(itemVariantKey=>({subjectKey:item.key,itemVariantKey})))
    .find(target=>!draft.templates.some(t=>t.subjectKind==='prop'&&t.parameters.consumer.subjectKey===target.subjectKey
      &&t.parameters.itemVariantKey===target.itemVariantKey&&slots.includes(t.parameters.consumer.slot as 'icon'|'detail')))
  const commonStyle=draft.referenceCatalog.find(r=>r.reference.purpose==='style'&&draft.templates.every(t=>t.allowedReferenceKeys.includes(r.referenceKey)))
  const familyKeys=(key:string)=>{const selected=draft.templates.find(t=>t.parameters.requirementKey===key)!
    return draft.templates.filter(t=>sameFamily(t,selected)).map(t=>t.parameters.requirementKey)}
  const replaceReference=(key:string,reference:ReturnType<typeof avgVisualFormReferenceV4>|null)=>change(replaceAvgVisualFormReferenceV4(draft,
    key==='style'?draft.templates.map(t=>t.parameters.requirementKey):familyKeys(key),key==='style'?'style':'identity',reference))
  const add=(purpose:AvgVisualFormPurposeV4,paired=false)=>{
    const next=structuredClone(draft),kind=purpose==='pose'||purpose==='expression'?'character':purpose==='background'?'environment':'prop'
    const itemTarget=kind==='prop'?nextItem(paired?['icon','detail']:[purpose as 'icon'|'detail']):undefined
    const subject=kind==='character'?workspace.systemPlan.characters[0]?.key:itemTarget?.subjectKey
    if(kind==='prop'&&!subject)return
    const available=workspace.scripts.flatMap(s=>s.lines.map(l=>({sceneKey:s.sceneKey,lineKey:l.lineKey}))).find(beat=>!next.templates.some(t=>t.parameters.consumer.slot===(kind==='character'?'actor':'background')
      &&t.parameters.consumer.subjectKey===(kind==='character'?subject:beat.sceneKey)&&t.parameters.triggerBeatKey===beat.lineKey))
    for(const target of paired?['icon','detail'] as const:[purpose]){
      const t=createAvgVisualFormTemplateV4(workspace,target,{subjectKey:subject,sceneKey:available?.sceneKey,lineKey:available?.lineKey??null,itemVariantKey:itemTarget?.itemVariantKey})
      const family=next.templates.find(other=>sameFamily(other,t))
      if(family&&kind==='character')Object.assign(t.parameters,{width:family.parameters.width,height:family.parameters.height,resolutionTier:family.parameters.resolutionTier,alpha:family.parameters.alpha})
      const refs=[...(commonStyle?[commonStyle.referenceKey]:[]),...(family?.allowedReferenceKeys.filter(k=>next.referenceCatalog.find(r=>r.referenceKey===k)?.reference.purpose==='identity')??[])]
      t.allowedReferenceKeys=t.requiredReferenceKeys=[...new Set(refs)];next.templates.push(t)
    }
    change(next)
  }
  const valid=draft.templates.length>0&&draft.templates.every(t=>t.requiredDetails.some(v=>v.trim())&&t.parameters.name.trim()&&t.parameters.altText.trim()
    &&(t.parameters.consumer.domain!=='stage'||!!t.parameters.triggerBeatKey))
    &&draft.referenceCatalog.every(r=>!!r.reference.allowedChange.trim())&&(!draft.referenceCatalog.length||external&&derivative)
  return <fieldset className="avg-form" disabled={disabled}>
    <legend>准备专业视觉用途与家族</legend>
    <p>本批 {draft.templates.length}/8 图。人物变体共用家族基准与画布，物件图只引用已有物件及显示变体；每张图仍需独立评审、选用与演出确认。</p>
    <label>本次风格参考<select aria-label="本次风格参考" value={commonStyle&&!commonStyle.reference.generatedSource?commonStyle.reference.assetKey:''} onChange={e=>{
      const asset=images.find(a=>a.assetKey===e.target.value);replaceReference('style',asset?avgVisualFormReferenceV4(asset,'style'):null)
    }}><option value="">不使用统一风格参考</option>{images.map(a=><option key={a.assetKey} value={a.assetKey}>{a.name}</option>)}</select></label>
    <p>改变本次风格参考会替换本批各用途的风格参考，其他参考职责保留。已保存的独立参考会在对应卡中列出。</p>
    <button className="lf-action" onClick={()=>setGeneratedFor(generatedFor==='style'?null:'style')}>从已采用生成图选择风格参考</button>
    {commonStyle&&<label>参考允许改变的内容<textarea aria-label="参考允许改变的内容" value={commonStyle.reference.allowedChange} onChange={e=>{
      const next=structuredClone(draft);next.referenceCatalog.find(r=>r.referenceKey===commonStyle.referenceKey)!.reference.allowedChange=e.target.value;change(next)
    }}/></label>}
    {draft.templates.map((t,index)=>{
      const p=t.parameters,c=p.consumer,key=p.requirementKey,stage=c.domain==='stage',character=t.subjectKind==='character',environment=t.subjectKind==='environment'
      const subjectOptions=character?workspace.systemPlan.characters.map(v=>({key:v.key,name:v.displayName})):environment?workspace.systemPlan.scenes.map(v=>({key:v.key,name:v.title})):items
      const item=items.find(v=>v.key===c.subjectKey),identity=draft.referenceCatalog.find(r=>r.reference.purpose==='identity'&&t.allowedReferenceKeys.includes(r.referenceKey))
      return <article className="avg-input-card" aria-label={`专业用途 ${index+1}`} key={key}><h5>{p.name}</h5>
        <label>用途名称<input aria-label="用途名称" value={p.name} onChange={e=>edit(key,n=>{n.parameters.name=e.target.value})}/></label>
        <label>图像替代说明<input aria-label="图像替代说明" value={p.altText} onChange={e=>edit(key,n=>{n.parameters.altText=e.target.value})}/></label>
        <label>{environment?'专业策划的场景':character?'专业策划的人物':'专业策划的物件'}<select aria-label={environment?'专业策划的场景':character?'专业策划的人物':'专业策划的物件'} value={c.subjectKey} onChange={e=>edit(key,n=>{
          const q=n.parameters;q.consumer.subjectKey=q.family.subjectKey=e.target.value;q.family.familyKey=`visual.${n.subjectKind}.${e.target.value}`
          if(environment){q.consumer.sceneKey=e.target.value;q.triggerBeatKey=null}else if(!character)q.itemVariantKey=null
        })}>{subjectOptions.map(o=><option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
        {character&&<><label>人物变体种类<select aria-label="人物变体种类" value={p.mediaKind} onChange={e=>edit(key,n=>{n.parameters.mediaKind=e.target.value as 'character-pose'|'character-expression'})}><option value="character-pose">姿态</option><option value="character-expression">表情</option></select></label>
          <label>人物消费场景<select aria-label="人物消费场景" value={c.sceneKey??''} onChange={e=>edit(key,n=>{n.parameters.consumer.sceneKey=e.target.value;n.parameters.triggerBeatKey=null})}>{workspace.systemPlan.scenes.map(s=><option key={s.key} value={s.key}>{s.title}</option>)}</select></label></>}
        {stage&&<label>画面出现的台词<select aria-label="画面出现的台词" value={p.triggerBeatKey??''} onChange={e=>edit(key,n=>{n.parameters.triggerBeatKey=e.target.value||null})}><option value="">请选择准确台词</option>{workspace.scripts.find(s=>s.sceneKey===c.sceneKey)?.lines.map(l=><option key={l.lineKey} value={l.lineKey}>{l.text}</option>)}</select></label>}
        {!stage&&<><p>消费槽：{c.slot==='icon'?'物件图标':'证据详情图'}；不修改数量、持有状态或规则条件。</p><label>物件显示变体<select aria-label="物件显示变体" value={p.itemVariantKey??''} onChange={e=>edit(key,n=>{n.parameters.itemVariantKey=e.target.value||null})}><option value="">基础显示</option>{item?.variants.map(v=><option key={v.key} value={v.key}>{v.name}</option>)}</select></label></>}
        <label>{environment?'必须呈现的场景细节（每行一项）':'必须保持或呈现的细节（每行一项）'}<textarea aria-label={environment?'必须呈现的场景细节（每行一项）':'必须保持或呈现的细节（每行一项）'} value={t.requiredDetails.join('\n')} onChange={e=>edit(key,n=>{n.requiredDetails=lines(e.target.value)})}/></label>
        <label>{environment?'专业场景不得表现的信息（每行一项）':'本用途不得表现的信息（每行一项）'}<textarea aria-label={environment?'专业场景不得表现的信息（每行一项）':'本用途不得表现的信息（每行一项）'} value={t.forbiddenDepictions.join('\n')} onChange={e=>edit(key,n=>{n.forbiddenDepictions=lines(e.target.value)})}/></label>
        {(['width','height'] as const).map((field,i)=><label key={field}>{['图像宽度','图像高度'][i]}<input aria-label={['图像宽度','图像高度'][i]} type="number" min={320} max={8192} value={p[field]} onChange={e=>{
          const next=structuredClone(draft);for(const v of next.templates.filter(v=>character?sameFamily(v,t):v.parameters.requirementKey===key))v.parameters[field]=Number(e.target.value);change(next)
        }}/></label>)}
        <label>尺寸档位<select aria-label="尺寸档位" value={p.resolutionTier} onChange={e=>{const next=structuredClone(draft);for(const v of next.templates.filter(v=>character?sameFamily(v,t):v.parameters.requirementKey===key))v.parameters.resolutionTier=e.target.value as '1K'|'2K';change(next)}}><option>1K</option><option>2K</option></select></label>
        {character&&<><label><input type="checkbox" checked={p.alpha==='required'} onChange={e=>{const next=structuredClone(draft);for(const v of next.templates.filter(v=>sameFamily(v,t)))v.parameters.alpha=e.target.checked?'required':'not-required';change(next)}}/>本人物家族要求透明底</label><p>供应商不保证透明；要求透明时，原图不符不能据提示词通过评审。</p></>}
        {!environment&&<><label>已导入的家族基准<select aria-label="已导入的家族基准" value={identity&&!identity.reference.generatedSource?identity.reference.assetKey:''} onChange={e=>{const asset=images.find(a=>a.assetKey===e.target.value);replaceReference(key,asset?avgVisualFormReferenceV4(asset,'identity'):null)}}><option value="">无身份参考</option>{images.map(a=><option key={a.assetKey} value={a.assetKey}>{a.name}</option>)}</select></label>
          <p>替换本家族的身份参考会应用于同一人物或物件家族，其他参考职责保留。</p>
          <button className="lf-action" onClick={()=>setGeneratedFor(generatedFor===key?null:key)}>从已采用生成图选择家族基准</button>
          {identity&&<label>家族基准允许变化<textarea aria-label="家族基准允许变化" value={identity.reference.allowedChange} onChange={e=>{const next=structuredClone(draft);next.referenceCatalog.find(r=>r.referenceKey===identity.referenceKey)!.reference.allowedChange=e.target.value;change(next)}}/></label>}</>}
        {t.allowedReferenceKeys.map(k=>{const r=draft.referenceCatalog.find(r=>r.referenceKey===k);return r?<p key={k}>保留参考：{r.reference.purpose} · {r.reference.assetKey} · {r.reference.contentHash.slice(0,12)} · {r.reference.license}</p>:<p role="alert" key={k}>参考目录不完整，请重新核对。</p>})}
        <button className="lf-action" onClick={()=>change(pruneAvgVisualFormReferencesV4({...draft,templates:draft.templates.filter(v=>v.parameters.requirementKey!==key)}))}>移除此图片用途</button>
      </article>
    })}
    <div className="avg-actions"><button className="lf-action" disabled={draft.templates.length>=8} onClick={()=>add('background')}>新增场景背景</button>
      <button className="lf-action" disabled={draft.templates.length>=8||!workspace.systemPlan.characters.length} onClick={()=>add('pose')}>新增人物姿态</button>
      <button className="lf-action" disabled={draft.templates.length>=8||!workspace.systemPlan.characters.length} onClick={()=>add('expression')}>新增人物表情</button>
      <button className="lf-action" disabled={draft.templates.length>=8||!nextItem(['icon'])} onClick={()=>add('icon')}>新增物件图标</button>
      <button className="lf-action" disabled={draft.templates.length>=8||!nextItem(['detail'])} onClick={()=>add('detail')}>新增物件详情图</button>
      <button className="lf-action" disabled={draft.templates.length>6||!nextItem(['icon','detail'])} onClick={()=>add('icon',true)}>新增物件图标与详情图</button></div>
    {generatedFor&&<section aria-label="选择专业用途的生成参考"><GeneratedReferencePicker scope={scope} disabled={disabled} visible={visible}
      refreshKey={`${view.details?.build?.id??''}:${view.details?.build?.stateRevision??''}:${generatedFor}`} onAction={onAction}
      onSelect={selected=>{if(selected){replaceReference(generatedFor,avgVisualFormReferenceV4(selected.asset,generatedFor==='style'?'style':'identity',selected.source));setGeneratedFor(null)}}}/>
      <button className="lf-action" onClick={()=>setGeneratedFor(null)}>取消选择生成参考</button></section>}
    {!!draft.referenceCatalog.length&&<><p>以下许可覆盖本次列出的全部用途和参考；任何用途、约束或参考改变后均须重新核对。</p>
      <label><input type="checkbox" checked={external} onChange={e=>{setExternal(e.target.checked);setPending(true)}}/>我有权向本次图片供应商发送该参考</label>
      <label><input type="checkbox" checked={derivative} onChange={e=>{setDerivative(e.target.checked);setPending(true)}}/>我有权用该参考进行本次衍生创作</label></>}
    <button className="lf-action" disabled={!valid||!view.draft.worldReleaseId} onClick={()=>void onAction(async()=>{
      if(!valid)throw new Error('请核对全部用途、准确台词和本次参考授权')
      const value=pruneAvgVisualFormReferencesV4({...draft,revision:(prepared?.revision??0)+1})
      for(const t of value.templates){t.requiredDetails=t.requiredDetails.map(v=>v.trim()).filter(Boolean);t.forbiddenDepictions=t.forbiddenDepictions.map(v=>v.trim()).filter(Boolean)}
      for(const entry of value.referenceCatalog)entry.reference=parseAvgMediaReferencesV1([entry.reference])[0]
      await onPrepare(value);setPending(false)
    })}>准备专业视觉制作方案</button>
    {pending&&<button className="lf-action" onClick={()=>{setDraft(initial(workspace,prepared));setExternal(false);setDerivative(false);setGeneratedFor(null);setPending(false);onCancel()}}>撤销未保存的专业用途</button>}
  </fieldset>
}
