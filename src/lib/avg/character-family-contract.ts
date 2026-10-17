import type { AvgVisualProductionRequirementV1 } from './media-production-contract'
import type { AvgMediaReferenceV1 } from './media-reference-contract'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1 } from './media-reference-contract'
import { parseAvgGeneratedReferenceSourceV1 } from './media-generated-reference-contract'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { avgBoolean, avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'

export type AvgCharacterFamilyBaselineV1 = Pick<AvgMediaReferenceV1,'assetKey'|'assetVersion'|'contentHash'|'mimeType'|'byteSize'|'license'|'generatedSource'>
export interface AvgCharacterFamilyPlanV1 {
  schema:'storyforge.avg.character-family-plan';version:1
  familyKey:string;revision:number;subjectKey:string;name:string
  baseline:AvgCharacterFamilyBaselineV1
  stylePrompt:string;identityInvariants:string[];negativePrompt:string;forbiddenDepictions:string[]
  allowedChange:string;width:number;height:number;resolutionTier:'1K'|'2K';alpha:'required'|'not-required'
  variants:Array<{variantKey:string;name:string;mediaKind:'character-pose'|'character-expression';changeDescription:string;sceneKey:string;lineKey:string}>
}
export interface AvgCharacterFamilyProposalV1 {
  schema:'storyforge.avg.character-family-proposal';version:1;plan:AvgCharacterFamilyPlanV1;sourceInputHash:string;sourceDraftHash:string;proposalHash:string
}
export interface AvgCharacterFamilyBatchV1 {
  proposal:AvgCharacterFamilyProposalV1
  approval:{proposalHash:string;providerInputAllowed:true;derivativeUseAllowed:true;declaration:string}
}

function texts(value:unknown,label:string){return avgList(value,label,(v,p)=>avgText(v,p,1000),24)}
export function parseAvgCharacterFamilyPlanV1(value:unknown):AvgCharacterFamilyPlanV1 {
  const r=avgRecord(avgProtocolBody(value),['schema','version','familyKey','revision','subjectKey','name','baseline','stylePrompt','identityInvariants',
    'negativePrompt','forbiddenDepictions','allowedChange','width','height','resolutionTier','alpha','variants'],'character family plan')
  if(r.schema!=='storyforge.avg.character-family-plan'||r.version!==1)throw new Error('[avg-family] 人物家族方案版本无效')
  const hasGenerated=!!r.baseline&&Object.prototype.hasOwnProperty.call(r.baseline,'generatedSource')
  const b=avgRecord(r.baseline,['assetKey','assetVersion','contentHash','mimeType','byteSize','license',...(hasGenerated?['generatedSource']:[])],'family baseline')
  const generatedSource=hasGenerated?parseAvgGeneratedReferenceSourceV1(b.generatedSource):null
  const baseline:AvgCharacterFamilyBaselineV1={assetKey:avgKey(b.assetKey,'baseline.assetKey'),assetVersion:avgNumber(b.assetVersion,'baseline.assetVersion',1,1e6),
    contentHash:avgHash(b.contentHash,'baseline.contentHash'),mimeType:avgEnum(b.mimeType,AVG_IMAGE_REFERENCE_CAPABILITY_V1.mimeTypes,'baseline.mimeType'),
    byteSize:avgNumber(b.byteSize,'baseline.byteSize',24,AVG_IMAGE_REFERENCE_CAPABILITY_V1.maximumReferenceBytes),license:avgText(b.license,'baseline.license',2000),
    ...(generatedSource?{generatedSource}:{})}
  if(generatedSource&&generatedSource.raw.contentHash!==baseline.contentHash)throw new Error('[avg-family] 基准图必须是准确的生成原图字节')
  const familyKey=avgKey(r.familyKey,'familyKey'),revision=avgNumber(r.revision,'family.revision',1,1e6)
  const variants=avgUnique(avgList(r.variants,'variants',value=>{
    const v=avgRecord(value,['variantKey','name','mediaKind','changeDescription','sceneKey','lineKey'],'family variant'),variantKey=avgKey(v.variantKey,'variantKey')
    if(`cf.${familyKey}.r${revision}.${variantKey}`.length>80)throw new Error('[avg-family] 家族或变体编号过长')
    return {variantKey,name:avgText(v.name,'variant.name',80),mediaKind:avgEnum(v.mediaKind,['character-pose','character-expression'] as const,'variant.mediaKind'),
      changeDescription:avgText(v.changeDescription,'variant.changeDescription',1500),sceneKey:avgKey(v.sceneKey,'variant.sceneKey'),lineKey:avgKey(v.lineKey,'variant.lineKey')}
  },8),v=>v.variantKey,'family variants')
  if(!variants.length)throw new Error('[avg-family] 本批至少需要一个明确变体')
  avgUnique(variants,v=>`${v.sceneKey}\u0000${v.lineKey}`,'family consumer positions')
  const identityInvariants=texts(r.identityInvariants,'identityInvariants')
  if(!identityInvariants.length)throw new Error('[avg-family] 请明确此家族必须保持的身份与造型约束')
  return {schema:r.schema,version:1,familyKey,revision,subjectKey:avgKey(r.subjectKey,'subjectKey'),name:avgText(r.name,'family.name',100),baseline,
    stylePrompt:avgText(r.stylePrompt,'stylePrompt',7000),identityInvariants,negativePrompt:avgText(r.negativePrompt,'negativePrompt',3000,true),
    forbiddenDepictions:texts(r.forbiddenDepictions,'forbiddenDepictions'),allowedChange:avgText(r.allowedChange,'allowedChange',300),
    width:avgNumber(r.width,'width',320,8192),height:avgNumber(r.height,'height',320,8192),resolutionTier:avgEnum(r.resolutionTier,['1K','2K'] as const,'resolutionTier'),
    alpha:avgEnum(r.alpha,['required','not-required'] as const,'alpha'),variants}
}
export function parseAvgCharacterFamilyProposalV1(value:unknown):AvgCharacterFamilyProposalV1 {
  const r=avgRecord(value,['schema','version','plan','sourceInputHash','sourceDraftHash','proposalHash'],'character family proposal')
  if(r.schema!=='storyforge.avg.character-family-proposal'||r.version!==1)throw new Error('[avg-family] 家族提案版本无效')
  return {schema:r.schema,version:1,plan:parseAvgCharacterFamilyPlanV1(r.plan),sourceInputHash:avgHash(r.sourceInputHash,'family.sourceInputHash'),sourceDraftHash:avgHash(r.sourceDraftHash,'family.sourceDraftHash'),proposalHash:avgHash(r.proposalHash,'family.proposalHash')}
}
export function parseAvgCharacterFamilyBatchV1(value:unknown):AvgCharacterFamilyBatchV1 {
  const r=avgRecord(value,['proposal','approval'],'character family batch'),proposal=parseAvgCharacterFamilyProposalV1(r.proposal)
  const a=avgRecord(r.approval,['proposalHash','providerInputAllowed','derivativeUseAllowed','declaration'],'family approval')
  if(a.proposalHash!==proposal.proposalHash||!avgBoolean(a.providerInputAllowed,'providerInputAllowed')||!avgBoolean(a.derivativeUseAllowed,'derivativeUseAllowed'))throw new Error('[avg-family] 请对准确家族提案确认本批全部外发与衍生授权')
  return {proposal,approval:{proposalHash:proposal.proposalHash,providerInputAllowed:true,derivativeUseAllowed:true,declaration:avgText(a.declaration,'family.approval.declaration',2000)}}
}
export async function hashAvgCharacterFamilyProposalV1(value:Omit<AvgCharacterFamilyProposalV1,'proposalHash'>){return hashProductProductionValueV2(value)}

/** Deterministic author-input composition only. The existing media Skill owns
 * every provider attempt; this creates no candidate image or adoption. */
export function composeAvgCharacterFamilyRequirementsV1(value:AvgCharacterFamilyPlanV1):AvgVisualProductionRequirementV1[]{
  const plan=parseAvgCharacterFamilyPlanV1(value)
  return plan.variants.map(v=>{
    const requirementKey=`cf.${plan.familyKey}.r${plan.revision}.${v.variantKey}`
    return {requirementKey,revision:1,assetKey:`avg.generated.${requirementKey}`,name:`${plan.name} · ${v.name}`,altText:`${plan.name}：${v.name}`,
      family:{subjectKey:plan.subjectKey,familyKey:plan.familyKey,variantKey:v.variantKey,revision:plan.revision},
      consumer:{consumerKey:requirementKey,domain:'stage',slot:'actor',subjectKey:plan.subjectKey,sceneKey:v.sceneKey,lineKey:null,required:true,fallback:'none'},
      triggerBeatKey:v.lineKey,itemVariantKey:null,mediaKind:v.mediaKind,
      prompt:`${plan.stylePrompt}\n本变体：${v.changeDescription}\n同一家族保持画布、人物比例与站位锚点一致。`,negativePrompt:plan.negativePrompt,
      invariants:[...plan.identityInvariants],forbiddenDepictions:[...plan.forbiddenDepictions],width:plan.width,height:plan.height,
      resolutionTier:plan.resolutionTier,alpha:plan.alpha,references:[{...plan.baseline,purpose:'identity',
        allowedChange:`${plan.allowedChange}\n本变体允许：${v.changeDescription}`,dataClass:'avg-authorized-reference',
        providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null}]}
  })
}
