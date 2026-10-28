import type { FrozenRuntimeMediaAssetV2 } from '../types'
import type { AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import type { AvgVisualPlanningDraftV4,AvgVisualPlanningDraftV5 } from './visual-planning-workspace'
import type { AvgVisualRequirementTemplateV1 } from './visual-planning-contract'
import type { AvgMediaReferenceV1 } from './media-reference-contract'
import type { AvgMediaReferenceV2 } from './media-reference-contract-v2'

export type AvgVisualFormPurposeV4 = 'background' | 'pose' | 'expression' | 'icon' | 'detail'

/** Unsaved author form values only. The public preparation service validates
 * source, slots, references and authority before saving the reviewable Brief. */
export function createAvgVisualFormTemplateV4(workspace: AvgAuthorWorkspaceV1, purpose: AvgVisualFormPurposeV4,
  target: { subjectKey?: string; sceneKey?: string; lineKey?: string | null; itemVariantKey?: string | null } = {}): AvgVisualRequirementTemplateV1 {
  const scene=workspace.systemPlan.scenes.find(s=>s.key===(target.sceneKey??workspace.systemPlan.entrySceneKey))
  const items=workspace.systemPlan.version===2?workspace.systemPlan.inventory.items:[]
  const kind=purpose==='background'?'environment':purpose==='pose'||purpose==='expression'?'character':'prop'
  const subject=kind==='environment'?scene:kind==='character'
    ?workspace.systemPlan.characters.find(c=>c.key===(target.subjectKey??workspace.systemPlan.characters[0]?.key))
    :items.find(i=>i.key===(target.subjectKey??items[0]?.key))
  if(!subject||kind!=='prop'&&!scene)throw new Error('[avg-visual-form] 请选择已保存的场景、人物或物件')
  const id=crypto.randomUUID(),key=`visual.${purpose}.${id}`,stage=kind!=='prop'
  const name='displayName' in subject?subject.displayName:'title' in subject?subject.title:subject.name
  const suffix={background:'背景',pose:'姿态',expression:'表情',icon:'图标',detail:'详情图'}[purpose]
  return {subjectKind:kind,requiredDetails:[],forbiddenDepictions:['不得新增未确认的剧情秘密'],allowedReferenceKeys:[],requiredReferenceKeys:[],parameters:{
    requirementKey:key,revision:1,assetKey:`avg.visual.${id}`,name:`${name}${suffix}`,altText:`${name}${suffix}`,
    family:{subjectKey:subject.key,familyKey:`visual.${kind}.${subject.key}`,variantKey:`${purpose}.${id}`,revision:1},
    consumer:{consumerKey:key,domain:stage?'stage':purpose==='icon'?'inventory':'evidence',slot:kind==='character'?'actor':purpose==='background'?'background':purpose==='icon'?'icon':'detail',
      subjectKey:subject.key,sceneKey:stage?scene!.key:null,lineKey:null,required:true,fallback:'none'},
    triggerBeatKey:stage?(target.lineKey===undefined?workspace.scripts.find(s=>s.sceneKey===scene!.key)?.lines[0]?.lineKey??null:target.lineKey):null,
    itemVariantKey:kind==='prop'?target.itemVariantKey??null:null,mediaKind:purpose==='pose'?'character-pose':purpose==='expression'?'character-expression':purpose==='icon'?'ui':purpose==='detail'?'cg':'background',
    width:purpose==='icon'?512:purpose==='background'&&workspace.presentation.aspectRatio==='4:3'?640:576,
    height:kind==='character'?768:purpose==='icon'?512:purpose==='background'&&workspace.presentation.aspectRatio==='4:3'?480:324,
    resolutionTier:'1K',alpha:kind==='character'?'required':'not-required'}}
}

export function avgVisualFormReferenceV4(asset: FrozenRuntimeMediaAssetV2, purpose: AvgMediaReferenceV1['purpose'],
  generatedSource?: AvgMediaReferenceV1['generatedSource']): AvgMediaReferenceV1 {
  if(!['image/png','image/jpeg','image/webp'].includes(asset.mimeType))throw new Error('[avg-visual-form] 参考只支持 PNG、JPEG 或 WebP')
  // These are pending form values, never an author receipt. Submission is
  // fenced by fresh explicit permission for the entire displayed reference set.
  return {assetKey:asset.assetKey,assetVersion:asset.version,contentHash:asset.contentHash,mimeType:asset.mimeType as AvgMediaReferenceV1['mimeType'],
    byteSize:asset.byteSize,purpose,allowedChange:'',dataClass:'avg-authorized-reference',license:asset.license,
    providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null,...(generatedSource?{generatedSource}:{})}
}

/** Neutral unsaved form shape. This never becomes a persisted protocol body;
 * preparation still requires either the exact old or exact new parser. */
export type AvgVisualFormDraft=Omit<AvgVisualPlanningDraftV4,'version'|'referenceCatalog'>&{
  version:1|2;referenceCatalog:Array<{referenceKey:string;reference:AvgMediaReferenceV1|AvgMediaReferenceV2}>
}

export function avgVisualFormReferenceV5(asset:FrozenRuntimeMediaAssetV2,purpose:AvgMediaReferenceV2['purpose'],generatedSource?:AvgMediaReferenceV2['generatedSource']):AvgMediaReferenceV2{
  const base=avgVisualFormReferenceV4(asset,purpose)
  return {...base,schema:'storyforge.avg.media-reference',version:2,...(generatedSource?{generatedSource}:{}),contentPolicy:{permittedFeatures:[],excludedFeatures:[]}}
}

export function pruneAvgVisualFormReferences<T extends AvgVisualFormDraft>(value:T):T {
  const draft=structuredClone(value),used=new Set(draft.templates.flatMap(t=>t.allowedReferenceKeys))
  draft.referenceCatalog=draft.referenceCatalog.filter(r=>used.has(r.referenceKey))
  return draft
}

/** Explicitly replace one displayed reference purpose for exact target cards.
 * Other reference purposes, metadata and untouched targets retain their bytes. */
export function replaceAvgVisualFormReference(value:AvgVisualFormDraft, targets:string[],purpose:AvgMediaReferenceV1['purpose'],reference:AvgMediaReferenceV1|AvgMediaReferenceV2|null):AvgVisualFormDraft {
  const draft=structuredClone(value),old=new Set(draft.referenceCatalog.filter(r=>r.reference.purpose===purpose).map(r=>r.referenceKey))
  if(reference&&reference.purpose!==purpose)throw new Error('[avg-visual-form] 参考职责与所选用途不一致')
  const entry=reference?{referenceKey:`visual.reference.${crypto.randomUUID()}`,reference:structuredClone(reference)}:null
  for(const t of draft.templates.filter(t=>targets.includes(t.parameters.requirementKey))){
    t.allowedReferenceKeys=t.allowedReferenceKeys.filter(k=>!old.has(k));t.requiredReferenceKeys=t.requiredReferenceKeys.filter(k=>!old.has(k))
    if(entry){t.allowedReferenceKeys.push(entry.referenceKey);t.requiredReferenceKeys.push(entry.referenceKey)}
  }
  if(entry)draft.referenceCatalog.push(entry)
  return pruneAvgVisualFormReferences(draft)
}

/** Legacy editing wrappers retain the genuine V1 reference type. */
export function pruneAvgVisualFormReferencesV4(value:AvgVisualPlanningDraftV4):AvgVisualPlanningDraftV4{return pruneAvgVisualFormReferences(value)}
export function replaceAvgVisualFormReferenceV4(value:AvgVisualPlanningDraftV4,targets:string[],purpose:AvgMediaReferenceV1['purpose'],reference:AvgMediaReferenceV1|null):AvgVisualPlanningDraftV4{
  const result=replaceAvgVisualFormReference(value,targets,purpose,reference)
  return {...result,version:1,referenceCatalog:result.referenceCatalog.map(entry=>{
    if('contentPolicy' in entry.reference)throw new Error('[avg-visual-form] 旧用途不能接收新版参考声明')
    return {...entry,reference:entry.reference}
  })}
}
export function pruneAvgVisualFormReferencesV5(value:AvgVisualPlanningDraftV5):AvgVisualPlanningDraftV5{return pruneAvgVisualFormReferences(value)}
