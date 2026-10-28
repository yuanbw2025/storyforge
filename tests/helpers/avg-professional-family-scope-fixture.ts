import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'
import type { AvgVisualPlanningDraftV4 } from '../../src/lib/avg/visual-planning-workspace'
import type { AvgVisualRequirementTemplateV1, AvgVisualDesignKindV1 } from '../../src/lib/avg/visual-planning-contract'

/** Author-owned engineering intent only, with no model/Run/Blob/acceptance.
 * Exact source identity and consumer declarations remain validated by code. */
export function avgProfessionalFamilyScopeFixtureV4(stem='family') {
  const workspace=createAvgAuthoringPresetV1('evidence')
  if(workspace.systemPlan.version!==2)throw new Error('Expected native inventory source')
  const scene=workspace.systemPlan.scenes[0],second=workspace.systemPlan.scenes[1],character=workspace.systemPlan.characters[0],item=workspace.systemPlan.inventory.items[0]
  const template=(kind:AvgVisualDesignKindV1,subject:string,variant:string,slot:'background'|'actor'|'icon'|'detail',sceneKey=scene.key):AvgVisualRequirementTemplateV1=>{
    const key=`${stem}.${subject}.${variant}`,stage=slot==='actor'||slot==='background'
    return {subjectKind:kind,requiredDetails:['作者确认的公开主体与构图'],forbiddenDepictions:['不得新增剧情秘密'],allowedReferenceKeys:[],requiredReferenceKeys:[],parameters:{
      requirementKey:key,revision:1,assetKey:`planned.${key}`,name:`工程 ${variant}`,altText:'原创工程意图，不证明图像、艺术或商用质量',
      family:{subjectKey:subject,familyKey:`${stem}.${subject}`,variantKey:variant,revision:1},
      consumer:{consumerKey:key,domain:stage?'stage':slot==='icon'?'inventory':'evidence',slot,subjectKey:subject,sceneKey:stage?sceneKey:null,lineKey:null,required:true,fallback:'none'},
      triggerBeatKey:stage?workspace.scripts.find(s=>s.sceneKey===sceneKey)!.lines[0].lineKey:null,itemVariantKey:null,
      mediaKind:slot==='actor'?variant==='expression'?'character-expression':'character-pose':slot==='background'?'background':slot==='icon'?'ui':'cg',
      width:slot==='actor'?576:slot==='icon'?512:576,height:slot==='actor'?768:slot==='icon'?512:324,resolutionTier:'1K',alpha:slot==='actor'?'required':'not-required'}}
  }
  const planning:AvgVisualPlanningDraftV4={schema:'storyforge.avg.visual-planning-scope',version:1,batchKey:`${stem}.batch`,revision:1,referenceCatalog:[],templates:[
    template('environment',scene.key,'background','background'),template('character',character.key,'pose','actor'),template('character',character.key,'expression','actor',second.key),
    template('prop',item.key,'icon','icon'),template('prop',item.key,'detail','detail')]}
  return {workspace,planning}
}
