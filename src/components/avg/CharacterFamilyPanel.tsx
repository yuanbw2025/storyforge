import { useEffect, useState } from 'react'
import type { FrozenRuntimeMediaAssetV2, WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgCharacterFamilyPlanV1, AvgCharacterFamilyProposalV1 } from '../../lib/avg/character-family-contract'
import { prepareAvgCharacterFamilyProposalV1, saveAvgCharacterFamilyBatchDraftV1 } from '../../lib/avg/character-family-service'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { readAvgGeneratedReferenceImageV1 } from '../../lib/avg/media-generated-reference'
import GeneratedReferencePicker from './GeneratedReferencePicker'
import MediaAssetPreview from './MediaAssetPreview'
import { hasAvgCharacterFamilyReservedBackdropV1,setAvgCharacterFamilyReservedBackdropV1,buildAvgCharacterFamilyForegroundProcessingPlan } from '../../lib/avg/character-family-foreground'
import { AVG_RESERVED_MAGENTA_INVARIANT_V1,AVG_RESERVED_MAGENTA_FORBIDDEN_V1 } from '../../lib/avg/image-foreground-contract'
import { parseAvgImageProcessingPlan,type AvgImageProcessingPlan } from '../../lib/avg/image-processing-contract'

type Form=Omit<AvgCharacterFamilyPlanV1,'baseline'>&{baseline:AvgCharacterFamilyPlanV1['baseline']|null}
function initial(workspace:AvgAuthorWorkspaceV1):Form{
  const saved=workspace.mediaBatch?.characterFamily?.proposal.plan
  if(saved)return structuredClone(saved)
  const character=workspace.systemPlan.characters[0],script=workspace.scripts[0]
  return {schema:'storyforge.avg.character-family-plan',version:1,familyKey:`character.${character?.key??'new'}`,revision:1,subjectKey:character?.key??'',
    name:character?.displayName??'',baseline:null,stylePrompt:'',identityInvariants:[''],negativePrompt:'',forbiddenDepictions:[],allowedChange:'',
    width:576,height:768,resolutionTier:'1K',alpha:'required',variants:[{variantKey:'v1',name:'',mediaKind:'character-expression',changeDescription:'',sceneKey:script?.sceneKey??'',lineKey:script?.lines[0]?.lineKey??''}]}
}
function baselineOf(asset:FrozenRuntimeMediaAssetV2):NonNullable<Form['baseline']>{
  if(!['image/png','image/jpeg','image/webp'].includes(asset.mimeType))throw new Error('家族基准只接受 PNG、JPEG 或 WebP')
  return {assetKey:asset.assetKey,assetVersion:asset.version,contentHash:asset.contentHash,mimeType:asset.mimeType as NonNullable<Form['baseline']>['mimeType'],byteSize:asset.byteSize,license:asset.license}
}
function savedForegroundDeclaration(workspace:AvgAuthorWorkspaceV1){
  const keys=new Set(workspace.mediaBatch?.characterFamily?workspace.mediaBatch.requirements.map(r=>r.requirementKey):[])
  const entry=workspace.imageProcessing?.entries.find(e=>keys.has(e.requirementKey)&&e.recipe.version===2)
  return entry?.recipe.version===2?entry.recipe.foreground.declaration:''
}
function savedForegroundVersion(workspace:AvgAuthorWorkspaceV1):0|1|2{
  const keys=new Set(workspace.mediaBatch?.characterFamily?workspace.mediaBatch.requirements.map(r=>r.requirementKey):[])
  const versions=new Set((workspace.imageProcessing?.entries??[]).filter(e=>keys.has(e.requirementKey)&&e.recipe.version===2)
    .map(e=>e.recipe.version===2?e.recipe.foreground.version:1))
  if(versions.size>1)return 0
  return versions.has(2)?2:1
}

/** An author-owned shared identity plan. No professional story/art generation
 * role is implied; provider work continues through the ordinary media Harness. */
export default function CharacterFamilyPanel({scope,view,workspace,disabled,visible,onPending,onAction,onReload,onNotice}:{
  scope:WorkspaceScope;view:Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>;workspace:AvgAuthorWorkspaceV1;disabled:boolean;visible:boolean;
  onPending:(pending:boolean)=>void;onAction:(task:()=>Promise<void>)=>Promise<void>;onReload:()=>Promise<void>;onNotice:(notice:string)=>void
}){
  const savedJson=JSON.stringify(workspace.mediaBatch?.characterFamily??null)
  const [form,setForm]=useState<Form>(()=>initial(workspace)),[pending,setPending]=useState(false)
  const [proposal,setProposal]=useState<AvgCharacterFamilyProposalV1|null>(null),[external,setExternal]=useState(false),[derivative,setDerivative]=useState(false)
  const [preview,setPreview]=useState<FrozenRuntimeMediaAssetV2|null>(null),[declaration,setDeclaration]=useState('')
  const [foregroundDeclaration,setForegroundDeclaration]=useState(()=>savedForegroundDeclaration(workspace))
  const [foregroundVersion,setForegroundVersion]=useState<0|1|2>(()=>savedForegroundVersion(workspace))
  useEffect(()=>{setForm(initial(workspace));setPending(false);setProposal(null);setExternal(false);setDerivative(false);setPreview(null);setForegroundDeclaration(savedForegroundDeclaration(workspace))},[savedJson,scope.workId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{onPending(pending)},[pending,onPending])
  useEffect(()=>{if(!pending)setForegroundVersion(savedForegroundVersion(workspace))},[workspace,pending])
  const change=(patch:Partial<Form>)=>{setForm(old=>({...old,...patch}));setPending(true);setProposal(null);setExternal(false);setDerivative(false)}
  const variant=(index:number,patch:Partial<Form['variants'][number]>)=>change({variants:form.variants.map((value,i)=>i===index?{...value,...patch}:value)})
  const images=view.media.items.map(row=>row.asset).filter(asset=>asset.mimeType.startsWith('image/')&&asset.byteSize<=8*1024*1024)
  const makePlan=()=>({...form,baseline:form.baseline!,identityInvariants:form.identityInvariants.map(s=>s.trim()).filter(Boolean),forbiddenDepictions:form.forbiddenDepictions.map(s=>s.trim()).filter(Boolean)})
  const foreground=hasAvgCharacterFamilyReservedBackdropV1(form)
  const proposedProcessing=proposal&&foreground&&foregroundVersion!==0?buildAvgCharacterFamilyForegroundProcessingPlan(proposal.plan,foregroundDeclaration,foregroundVersion):undefined
  const processingForSave=():AvgImageProcessingPlan|null|undefined=>{
    if(proposedProcessing)return proposedProcessing
    const old=workspace.mediaBatch?.characterFamily?.proposal.plan,processing=workspace.imageProcessing
    if(!old||!hasAvgCharacterFamilyReservedBackdropV1(old)||!processing)return undefined
    const keys=new Set(workspace.mediaBatch!.requirements.map(r=>r.requirementKey))
    if(!processing.entries.some(e=>keys.has(e.requirementKey)&&e.recipe.version===2))return undefined
    const entries=processing.entries.filter(e=>!keys.has(e.requirementKey)||e.recipe.version===1)
    return entries.length?parseAvgImageProcessingPlan({schema:processing.schema,version:entries.some(e=>e.recipe.version===2)?2:1,entries}):null
  }
  return <section aria-label="人物家族批量方案"><h5>人物家族：同一基准的表情与姿态</h5>
    <p>选定合法基准，共享身份与画布约束，再逐项指定差异及出现位置。每批最多 8 个变体，仍须逐张查看、选用并确认演出。</p>
    <fieldset className="avg-form" disabled={disabled}>
      <label>家族人物<select value={form.subjectKey} onChange={e=>{const person=workspace.systemPlan.characters.find(c=>c.key===e.target.value);change({subjectKey:e.target.value,name:person?.displayName??'',familyKey:`character.${e.target.value}`})}}>{workspace.systemPlan.characters.map(c=><option key={c.key} value={c.key}>{c.displayName}</option>)}</select></label>
      <label>家族编号<input value={form.familyKey} maxLength={50} onChange={e=>change({familyKey:e.target.value})}/></label>
      <label>基准修订<input type="number" min={1} max={1000000} value={form.revision} onChange={e=>change({revision:Number(e.target.value)})}/></label>
      <label>家族名称<input value={form.name} maxLength={100} onChange={e=>change({name:e.target.value})}/></label>
      <label>使用已导入基准<select value={form.baseline&&!form.baseline.generatedSource?form.baseline.assetKey:''} onChange={e=>{const asset=images.find(asset=>asset.assetKey===e.target.value);change({baseline:asset?baselineOf(asset):null});setPreview(asset??null)}}><option value="">请选择</option>{images.map(asset=><option key={asset.assetKey} value={asset.assetKey}>{asset.name}</option>)}</select></label>
      <GeneratedReferencePicker scope={scope} disabled={disabled} visible={visible} refreshKey={`${view.details?.build?.id??''}:${view.details?.build?.stateRevision??''}`} onAction={onAction}
        onSelect={value=>{change({baseline:value?{...baselineOf(value.asset),generatedSource:value.source}:null});setPreview(value?.asset??null)}}/>
      {form.baseline&&<><p>家族基准：{form.baseline.assetKey} · {form.baseline.contentHash.slice(0,12)} · {form.baseline.license}</p>
        {form.baseline.generatedSource&&!preview&&<button className="lf-action" onClick={()=>void onAction(async()=>{const image=await readAvgGeneratedReferenceImageV1({scope,source:form.baseline!.generatedSource!});setPreview(image.asset)})}>查看已保存的家族基准</button>}</>}
      {visible&&preview&&<MediaAssetPreview key={`${preview.assetKey}:${preview.contentHash}`} scope={scope} asset={preview} generatedSource={form.baseline?.generatedSource}/>}
      <label>家族画风与通用要求<textarea value={form.stylePrompt} maxLength={7000} onChange={e=>change({stylePrompt:e.target.value})}/></label>
      <label>身份与造型必须保持（每行一项）<textarea value={form.identityInvariants.filter(text=>!foreground||text!==AVG_RESERVED_MAGENTA_INVARIANT_V1).join('\n')}
        onChange={e=>change({identityInvariants:[...e.target.value.split('\n'),...(foreground?[AVG_RESERVED_MAGENTA_INVARIANT_V1]:[])]})}/></label>
      <label>本家族允许变化<textarea value={form.allowedChange} maxLength={300} onChange={e=>change({allowedChange:e.target.value})}/></label>
      <label>家族排除画面<textarea value={form.negativePrompt} maxLength={3000} onChange={e=>change({negativePrompt:e.target.value})}/></label>
      <label>家族禁止表现（每行一项）<textarea value={form.forbiddenDepictions.filter(text=>!foreground||text!==AVG_RESERVED_MAGENTA_FORBIDDEN_V1).join('\n')}
        onChange={e=>change({forbiddenDepictions:[...e.target.value.split('\n'),...(foreground?[AVG_RESERVED_MAGENTA_FORBIDDEN_V1]:[])]})}/></label>
      <label>家族最小宽度<input type="number" min={320} max={8192} value={form.width} onChange={e=>change({width:Number(e.target.value)})}/></label>
      <label>家族最小高度<input type="number" min={320} max={8192} value={form.height} onChange={e=>change({height:Number(e.target.value)})}/></label>
      <label>家族生成档位<select value={form.resolutionTier} onChange={e=>change({resolutionTier:e.target.value as Form['resolutionTier']})}><option>1K</option><option>2K</option></select></label>
      <label><input type="checkbox" checked={form.alpha==='required'} onChange={e=>change(e.target.checked?{alpha:'required'}:setAvgCharacterFamilyReservedBackdropV1({...form,alpha:'not-required'},false))}/>家族全部变体要求透明像素</label>
      <label><input type="checkbox" checked={foreground} disabled={form.alpha!=='required'}
        onChange={e=>change(setAvgCharacterFamilyReservedBackdropV1(form,e.target.checked))}/>为全部变体预留纯品红底色并准备本地前景加工（实验性）</label>
      {foreground&&<><p>主体、服装和道具不得使用品红及其相近色。底色要求会进入新的准确家族提案，须重新核对基准外发与衍生权限；全部变体各自保存同画布加工配方，结果仍须逐张检查和选用。</p>
        <label>家族前景边缘处理<select value={foregroundVersion} onChange={e=>{
          if(e.target.value!=='1'&&e.target.value!=='2')return
          setForegroundVersion(e.target.value==='2'?2:1);change({})
        }}>{foregroundVersion===0&&<option value={0}>当前各变体不同，请选择统一处理方式</option>}
          <option value={1}>仅移除底色，保留颜色</option><option value={2}>移除底色并还原边缘颜色（实验性）</option></select></label>
        {foregroundVersion===2&&<p>此方式会还原局部边缘颜色，原图与已有版本保留；每张结果仍须检查主体和细节后再选用。</p>}
        <label>家族保留底色与本地加工说明<textarea maxLength={2000} value={foregroundDeclaration}
          onChange={e=>{setForegroundDeclaration(e.target.value);change({})}}/></label></>}
      {!foreground&&workspace.imageProcessing?.entries.some(e=>e.recipe.version===2)&&workspace.mediaBatch?.characterFamily
        &&<p>保存不再预留底色的新家族方案时，会移除本家族的前景加工草稿；已有普通裁切配方及历史版本保留。</p>}
      {form.variants.map((v,index)=><fieldset key={index} className="avg-form"><legend>家族变体 {index+1}</legend>
        <label>变体编号<input value={v.variantKey} onChange={e=>variant(index,{variantKey:e.target.value})}/></label>
        <label>变体名称<input value={v.name} maxLength={80} onChange={e=>variant(index,{name:e.target.value})}/></label>
        <label>变体用途<select value={v.mediaKind} onChange={e=>variant(index,{mediaKind:e.target.value as typeof v.mediaKind})}><option value="character-expression">表情</option><option value="character-pose">姿态</option></select></label>
        <label>变体差异<textarea value={v.changeDescription} maxLength={1500} onChange={e=>variant(index,{changeDescription:e.target.value})}/></label>
        <label>变体场景<select value={v.sceneKey} onChange={e=>variant(index,{sceneKey:e.target.value,lineKey:workspace.scripts.find(s=>s.sceneKey===e.target.value)?.lines[0]?.lineKey??''})}>{workspace.systemPlan.scenes.map(s=><option key={s.key} value={s.key}>{s.title}</option>)}</select></label>
        <label>变体出现的对白<select value={v.lineKey} onChange={e=>variant(index,{lineKey:e.target.value})}>{workspace.scripts.find(s=>s.sceneKey===v.sceneKey)?.lines.map(line=><option key={line.lineKey} value={line.lineKey}>{line.text}</option>)}</select></label>
        <button className="lf-action" onClick={()=>change({variants:form.variants.filter((_,i)=>i!==index)})}>移除此家族变体</button>
      </fieldset>)}
      <button className="lf-action" disabled={form.variants.length>=8} onClick={()=>{let key=`v${form.variants.length+1}`;while(form.variants.some(v=>v.variantKey===key))key=`${key}a`;const next=workspace.scripts.flatMap(s=>s.lines.map(line=>({sceneKey:s.sceneKey,lineKey:line.lineKey}))).find(line=>!form.variants.some(v=>v.sceneKey===line.sceneKey&&v.lineKey===line.lineKey));change({variants:[...form.variants,{variantKey:key,name:'',mediaKind:'character-expression',changeDescription:'',sceneKey:next?.sceneKey??'',lineKey:next?.lineKey??''}]})}}>新增家族变体</button>
      <button className="lf-action" disabled={!form.baseline||foreground&&(!foregroundDeclaration.trim()||foregroundVersion===0)} onClick={()=>void onAction(async()=>{
        const plan=makePlan();if(foreground){if(foregroundVersion===0)throw new Error('[avg-family] 请明确选择本批边缘处理方式');buildAvgCharacterFamilyForegroundProcessingPlan(plan,foregroundDeclaration,foregroundVersion)}
        const reviewed=await prepareAvgCharacterFamilyProposalV1({scope,expectedDraftRevision:view.draft.revision,plan});setProposal(reviewed);setExternal(false);setDerivative(false);setPending(true)
      })}>生成待核对的家族方案</button>
      {proposal&&<section aria-label="家族方案核对"><p>本批 {proposal.plan.variants.length} 张，共用准确基准与身份约束。方案 {proposal.proposalHash.slice(0,12)}。</p>
        {workspace.mediaBatch&&!workspace.mediaBatch.characterFamily&&<p>保存会替换当前编辑草稿的图片需求批次。已采用的其他舞台图片保留原始字节和来源，新版本仍需确认演出。</p>}
        {workspace.mediaBatch?.characterFamily?.proposal.plan.familyKey===proposal.plan.familyKey&&<p>保存将替换当前同家族批次的编辑需求与自动立绘配置。旧 Build、原图、调用和采用回执保留。</p>}
        <details><summary>查看准确家族方案</summary><pre>{JSON.stringify(proposal,null,2)}</pre></details>
        {proposedProcessing&&<p>同时保存 {proposedProcessing.entries.length} 项独立前景加工草稿：先分离已声明底色，再放入 {proposal.plan.width} × {proposal.plan.height} 共同画布。尚未执行、评审或选用。</p>}
        <label><input type="checkbox" checked={external} onChange={e=>setExternal(e.target.checked)}/>我有权将此基准发送给本批全部图片请求</label>
        <label><input type="checkbox" checked={derivative} onChange={e=>setDerivative(e.target.checked)}/>我有权以此基准制作本批全部变体</label>
        <label>本批基准与衍生授权声明<textarea value={declaration} maxLength={2000} onChange={e=>{setDeclaration(e.target.value);setExternal(false);setDerivative(false)}}/></label>
        <button className="lf-action" disabled={!external||!derivative||!declaration.trim()} onClick={()=>void onAction(async()=>{
          const imageProcessing=processingForSave()
          await saveAvgCharacterFamilyBatchDraftV1({scope,expectedDraftRevision:view.draft.revision,proposal,...(imageProcessing===undefined?{}:{imageProcessing}),approval:{proposalHash:proposal.proposalHash,providerInputAllowed:external,derivativeUseAllowed:derivative,declaration}})
          await onReload();setPending(false);setProposal(null);setExternal(false);setDerivative(false);onNotice('人物家族需求与准确授权已保存；到制作页核对方案并开始后，再逐张生成、选用与确认演出。')
        })}>保存已核对的家族批次</button>
      </section>}
    </fieldset>
    <button className="lf-action" disabled={disabled||!pending} onClick={()=>{setForm(initial(workspace));setProposal(null);setExternal(false);setDerivative(false);setPending(false);setPreview(null);setForegroundDeclaration(savedForegroundDeclaration(workspace));setForegroundVersion(savedForegroundVersion(workspace))}}>撤销未保存的家族方案</button>
  </section>
}
