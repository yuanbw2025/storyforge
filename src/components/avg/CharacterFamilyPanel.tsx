import { useEffect, useState } from 'react'
import type { FrozenRuntimeMediaAssetV2, WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgCharacterFamilyPlanV1, AvgCharacterFamilyProposalV1 } from '../../lib/avg/character-family-contract'
import { prepareAvgCharacterFamilyProposalV1, saveAvgCharacterFamilyBatchDraftV1 } from '../../lib/avg/character-family-service'
import type { readAvgAssemblyWorkspaceV1 } from '../../lib/avg/assembly-service'
import { readAvgGeneratedReferenceImageV1 } from '../../lib/avg/media-generated-reference'
import GeneratedReferencePicker from './GeneratedReferencePicker'
import MediaAssetPreview from './MediaAssetPreview'

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
  useEffect(()=>{setForm(initial(workspace));setPending(false);setProposal(null);setExternal(false);setDerivative(false);setPreview(null)},[savedJson,scope.workId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{onPending(pending)},[pending,onPending])
  const change=(patch:Partial<Form>)=>{setForm(old=>({...old,...patch}));setPending(true);setProposal(null);setExternal(false);setDerivative(false)}
  const variant=(index:number,patch:Partial<Form['variants'][number]>)=>change({variants:form.variants.map((value,i)=>i===index?{...value,...patch}:value)})
  const images=view.media.items.map(row=>row.asset).filter(asset=>asset.mimeType.startsWith('image/')&&asset.byteSize<=8*1024*1024)
  const makePlan=()=>({...form,baseline:form.baseline!,identityInvariants:form.identityInvariants.map(s=>s.trim()).filter(Boolean),forbiddenDepictions:form.forbiddenDepictions.map(s=>s.trim()).filter(Boolean)})
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
      <label>身份与造型必须保持（每行一项）<textarea value={form.identityInvariants.join('\n')} onChange={e=>change({identityInvariants:e.target.value.split('\n')})}/></label>
      <label>本家族允许变化<textarea value={form.allowedChange} maxLength={300} onChange={e=>change({allowedChange:e.target.value})}/></label>
      <label>家族排除画面<textarea value={form.negativePrompt} maxLength={3000} onChange={e=>change({negativePrompt:e.target.value})}/></label>
      <label>家族禁止表现（每行一项）<textarea value={form.forbiddenDepictions.join('\n')} onChange={e=>change({forbiddenDepictions:e.target.value.split('\n')})}/></label>
      <label>家族最小宽度<input type="number" min={320} max={8192} value={form.width} onChange={e=>change({width:Number(e.target.value)})}/></label>
      <label>家族最小高度<input type="number" min={320} max={8192} value={form.height} onChange={e=>change({height:Number(e.target.value)})}/></label>
      <label>家族生成档位<select value={form.resolutionTier} onChange={e=>change({resolutionTier:e.target.value as Form['resolutionTier']})}><option>1K</option><option>2K</option></select></label>
      <label><input type="checkbox" checked={form.alpha==='required'} onChange={e=>change({alpha:e.target.checked?'required':'not-required'})}/>家族全部变体要求透明像素</label>
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
      <button className="lf-action" disabled={!form.baseline} onClick={()=>void onAction(async()=>{const reviewed=await prepareAvgCharacterFamilyProposalV1({scope,expectedDraftRevision:view.draft.revision,plan:makePlan()});setProposal(reviewed);setExternal(false);setDerivative(false);setPending(true)})}>生成待核对的家族方案</button>
      {proposal&&<section aria-label="家族方案核对"><p>本批 {proposal.plan.variants.length} 张，共用准确基准与身份约束。方案 {proposal.proposalHash.slice(0,12)}。</p>
        {workspace.mediaBatch&&!workspace.mediaBatch.characterFamily&&<p>保存会替换当前编辑草稿的图片需求批次。已采用的其他舞台图片保留原始字节和来源，新版本仍需确认演出。</p>}
        {workspace.mediaBatch?.characterFamily?.proposal.plan.familyKey===proposal.plan.familyKey&&<p>保存将替换当前同家族批次的编辑需求与自动立绘配置。旧 Build、原图、调用和采用回执保留。</p>}
        <details><summary>查看准确家族方案</summary><pre>{JSON.stringify(proposal,null,2)}</pre></details>
        <label><input type="checkbox" checked={external} onChange={e=>setExternal(e.target.checked)}/>我有权将此基准发送给本批全部图片请求</label>
        <label><input type="checkbox" checked={derivative} onChange={e=>setDerivative(e.target.checked)}/>我有权以此基准制作本批全部变体</label>
        <label>本批基准与衍生授权声明<textarea value={declaration} maxLength={2000} onChange={e=>{setDeclaration(e.target.value);setExternal(false);setDerivative(false)}}/></label>
        <button className="lf-action" disabled={!external||!derivative||!declaration.trim()} onClick={()=>void onAction(async()=>{
          await saveAvgCharacterFamilyBatchDraftV1({scope,expectedDraftRevision:view.draft.revision,proposal,approval:{proposalHash:proposal.proposalHash,providerInputAllowed:external,derivativeUseAllowed:derivative,declaration}})
          await onReload();onNotice('人物家族需求与准确授权已保存；到制作页核对方案并开始后，再逐张生成、选用与确认演出。')
        })}>保存已核对的家族批次</button>
      </section>}
    </fieldset>
    <button className="lf-action" disabled={disabled||!pending} onClick={()=>{setForm(initial(workspace));setProposal(null);setExternal(false);setDerivative(false);setPending(false);setPreview(null)}}>撤销未保存的家族方案</button>
  </section>
}
