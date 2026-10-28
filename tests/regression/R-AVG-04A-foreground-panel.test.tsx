import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import ImageProcessingPlanPanel from '../../src/components/avg/ImageProcessingPlanPanel'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readAvgAssemblyWorkspaceV1,saveAvgImageProcessingDraftV1 } from '../../src/lib/avg/assembly-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { compileAvgVisualPlanningProposalV1,freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { DECLARED_MAGENTA_ALPHA_MATTING_ID_V1 } from '../../src/lib/product-production/character-alpha-matting'
import { AVG_RESERVED_MAGENTA_INVARIANT_V1,AVG_RESERVED_MAGENTA_FORBIDDEN_V1 } from '../../src/lib/avg/image-foreground-contract'
import type { AvgImageProcessingPlanV2 } from '../../src/lib/avg/image-processing-contract'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from '../../src/lib/avg/image-foreground-boundary-unmix'
import { AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4, AVG_FOREGROUND_SAM2_MATTING_ID_V4,
  AVG_FOREGROUND_SAM2_MODEL_REVISION_V4, AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4,
  AVG_FOREGROUND_SAM2_MATTING_ID_V5, AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5, AVG_FOREGROUND_SAM2_QUALITY_GATE_V5,
  AVG_FOREGROUND_SAM2_MATTING_ID_V6, AVG_FOREGROUND_SAM2_QUALITY_GATE_V6, AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6 } from '../../src/lib/avg/image-foreground-contract'

const roots:Root[]=[]
beforeEach(async()=>{await db.delete();await db.open();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('UI preparation has no provider authority')}))})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close();document.body.replaceChildren()})
async function panel(){
 const f=await avgV5FormalFixture(),{owner}=f
 const brief={...f.brief,avgVisualPlanning:{...f.planning,scope:{...f.planning.scope,referenceCatalog:[],templates:f.planning.scope.templates.map(t=>({...t,allowedReferenceKeys:[],requiredReferenceKeys:[]}))}}}
 brief.capabilityRequirements=brief.capabilityRequirements.map(c=>c.mediaClass==='image'?{...c,allowedDataClasses:['image-prompt']}:c)
 brief.externalDataPolicy={...brief.externalDataPolicy,allowedDataClasses:brief.externalDataPolicy.allowedDataClasses.filter(c=>c!=='avg-authorized-reference'),allowReferenceImages:false}
 const saved=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',commandId:'foreground.panel.fixture',
  expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief:parseProductProductionBriefV3(brief)}})
 expect(saved.ok).toBe(true)
 let view=await readAvgAssemblyWorkspaceV1(owner.scope),action=Promise.resolve(),canEdit=true
 const errors:string[]=[],notices=vi.fn(),host=document.createElement('div');document.body.append(host)
 const root=createRoot(host);roots.push(root)
 const onAction=(task:()=>Promise<void>)=>{action=task().catch(error=>{errors.push(error instanceof Error?error.message:String(error))});return action}
 const refresh=async()=>{view=await readAvgAssemblyWorkspaceV1(owner.scope);root.render(node())}
 const node=()=> <ImageProcessingPlanPanel scope={owner.scope} workspace={parseAvgAuthorWorkspaceV1(view.draft.editorJson)} draftRevision={view.draft.revision}
  view={view} disabled={false} canEdit={canEdit} onPending={()=>{}} onAction={onAction} onReload={refresh} onNotice={notices}/>
 await act(async()=>root.render(node()))
 const input=(text:string)=>Array.from(host.querySelectorAll('label')).find(l=>l.textContent!.startsWith(text))!.querySelector('input,textarea')! as HTMLInputElement|HTMLTextAreaElement
 const text=async(label:string,value:string)=>act(async()=>{const field=input(label) as HTMLTextAreaElement
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}))})
 const button=(name:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent!.trim()===name)!
 const click=async(name:string)=>act(async()=>{expect(button(name).disabled).toBe(false);button(name).click();await action})
 const select=async(key:string)=>act(async()=>{const select=host.querySelector('select[aria-label="加工目标"]')!
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,key);select.dispatchEvent(new Event('change',{bubbles:true}))})
 const target=brief.avgVisualPlanning.scope.templates.find(t=>t.subjectKind==='character')!
 return {owner,host,input,text,button,click,select,target,errors,notices,getView:()=>view,setCanEdit:async(value:boolean)=>act(async()=>{canEdit=value;root.render(node())})}
}

describe('AVG explicit foreground preparation UI and ordinary Work draft',()=>{
 it('freezes an explicitly selected boundary policy2 in the actual unstarted V5 Brief without starting production',async()=>{
  const s=await panel(),before=s.getView().draft
  await s.select(s.target.parameters.requirementKey)
  await act(async()=>{(s.input('生成时使用纯品红底色') as HTMLInputElement).click()})
  const select=Array.from(s.host.querySelectorAll('label')).find(l=>l.textContent!.startsWith('前景边缘处理'))!.querySelector('select')!
  expect(select.value).toBe('1')
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,'2');select.dispatchEvent(new Event('change',{bubbles:true}))})
  await s.text('允许的加工与用途说明','本次明确选择独立边缘颜色还原，原图与已有候选保留')
  await s.text('保留底色与主体用色声明','主体不使用保留底色；处理结果仍须逐张评审与选用')
  await s.click('保存本项加工配方');expect(s.errors).toEqual([])
  const planning=parseProductProductionBriefV3(s.getView().details!.brief!.briefJson).avgVisualPlanning!
  const entry=planning.imageProcessing!.entries.find(e=>e.requirementKey===s.target.parameters.requirementKey)!
  if(entry.recipe.version!==2)throw new Error('Expected explicit foreground recipe')
  expect(entry.recipe.foreground).toMatchObject({version:2,algorithm:AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2})
  expect(planning.scope.templates.find(t=>t.parameters.requirementKey===s.target.parameters.requirementKey)!.requiredDetails).toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  expect(s.getView().draft).toEqual(before)
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it.each([
  {version:4,algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V4,promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V4},
  {version:5,algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V5,promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5},
  {version:6,algorithm:AVG_FOREGROUND_SAM2_MATTING_ID_V6,promptStrategy:AVG_FOREGROUND_SAM2_PROMPT_STRATEGY_V5},
 ])('freezes local SAM 2 policy V$version without changing the producer request or starting a model task',async({version,algorithm,promptStrategy})=>{
  const s=await panel()
  await s.select(s.target.parameters.requirementKey)
  await act(async()=>{(s.input('生成时使用纯品红底色') as HTMLInputElement).click()})
  const policySelect=Array.from(s.host.querySelectorAll('label')).find(l=>l.textContent!.startsWith('前景边缘处理'))!.querySelector('select')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(policySelect,String(version));policySelect.dispatchEvent(new Event('change',{bubbles:true}))})
  expect(s.host.textContent).toContain('本机分割只处理同一作品中已冻结并保存的原图')
  if(version!==6){expect(s.host.textContent).toContain('SAM 2.1 Hiera Tiny');expect(s.host.textContent).toContain('仅适用于单张、居中的')}
  if(version===5){expect(s.host.textContent).toContain('按固定分数与面积挡板选择掩模');expect(s.host.textContent).toContain('已有透明像素的原图会拒绝重分割')}
  else if(version===6){expect(s.host.textContent).toContain('均匀亮灰底色');expect(s.host.textContent).toContain('保留原件')}
  else expect(s.host.textContent).toContain('多人拼版、表情表或姿势表可能残留旁侧人物碎片或误删主体')
  await s.text('允许的加工与用途说明','本机透明前景候选，作者逐张评审后采用')
  await s.text('本机模型处理与作者审阅声明','本机 SAM 2.1 与 PyMatting 仅用于候选加工；不代替美术验收')
  await s.click('保存本项加工配方');expect(s.errors).toEqual([])
  const planning=parseProductProductionBriefV3(s.getView().details!.brief!.briefJson).avgVisualPlanning!
  const entry=planning.imageProcessing!.entries.find(e=>e.requirementKey===s.target.parameters.requirementKey)!
  if(entry.recipe.version!==2)throw new Error('Expected V2 processing recipe')
  expect(entry.recipe.foreground).toMatchObject({version,algorithm,
    modelRevision:AVG_FOREGROUND_SAM2_MODEL_REVISION_V4,checkpointSha256:AVG_FOREGROUND_SAM2_CHECKPOINT_SHA256_V4,
    promptStrategy})
  if(version===5)expect(entry.recipe.foreground).toHaveProperty('qualityGate',AVG_FOREGROUND_SAM2_QUALITY_GATE_V5)
  if(version===6)expect(entry.recipe.foreground).toMatchObject({qualityGate:AVG_FOREGROUND_SAM2_QUALITY_GATE_V6,backgroundRule:AVG_FOREGROUND_SAM2_NEUTRAL_RULE_V6})
  expect(planning.scope.templates.find(t=>t.parameters.requirementKey===s.target.parameters.requirementKey)!.requiredDetails)
    .not.toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it('shows the experiment only for a supported target and requires a separate declaration before freezing it',async()=>{
  const s=await panel(),draft=s.getView().draft
  expect(s.host.textContent).not.toContain('生成时使用纯品红底色')
  await s.select(s.target.parameters.requirementKey)
  await act(async()=>{(s.input('生成时使用纯品红底色') as HTMLInputElement).click()})
  expect((s.input('明确填充画布底色') as HTMLInputElement).disabled).toBe(true)
  await s.text('允许的加工与用途说明','原创工程目标的独立本地加工')
  expect(s.button('保存本项加工配方').disabled).toBe(true)
  await s.text('保留底色与主体用色声明','作者明确声明主体不用品红，该色仅用于生成背景；工程测试不签艺术或商用通过')
  await s.click('保存本项加工配方')
  expect(s.errors).toEqual([])
  const brief=parseProductProductionBriefV3(s.getView().details!.brief!.briefJson),planning=brief.avgVisualPlanning!
  expect(planning.imageProcessing!.version).toBe(2)
  expect(planning.scope.templates.find(t=>t.parameters.requirementKey===s.target.parameters.requirementKey)!.requiredDetails).toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1)
  expect(s.getView().draft).toEqual(draft)
  await s.click('移除此项加工配方')
  const removed=parseProductProductionBriefV3(s.getView().details!.brief!.briefJson).avgVisualPlanning!
  expect(removed.imageProcessing).toBeUndefined()
  expect(removed.scope.templates.find(t=>t.parameters.requirementKey===s.target.parameters.requirementKey)).toEqual(s.target)
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it('hides an unused foreground experiment when editing is unavailable without mutating the pending scheme',async()=>{
  const s=await panel(),before=s.getView().details!.brief
  await s.select(s.target.parameters.requirementKey)
  expect(s.host.textContent).toContain('生成时使用纯品红底色')
  await s.setCanEdit(false)
  expect(s.host.textContent).not.toContain('生成时使用纯品红底色')
  expect(s.getView().details!.brief).toEqual(before);expect(fetch).not.toHaveBeenCalled()
 })
 it('saves an ordinary Work recipe with its actual requirements atomically and rejects stale edits',async()=>{
  const f=avgVersionedPlanningFixture(),owner=await prepareNativeAvgAssembly(f.source)
  const compiled=await compileAvgVisualPlanningProposalV1({scope:await freezeAvgVisualPlanningScopeV1(f.legacy,f.source),visualBible:f.visualBible,mediaBriefs:f.mediaBriefs,source:f.source})
  let draft=await readAvgDraftV1(owner.scope)
  draft=await saveAvgAuthorWorkspaceV1(owner.scope,draft.revision,{...f.source,mediaBatch:compiled.batch})
  const requirement=compiled.batch.requirements.find(r=>r.mediaKind==='character-pose')!
  const plan:AvgImageProcessingPlanV2={schema:'storyforge.avg.image-processing-plan',version:2,entries:[{requirementKey:requirement.requirementKey,
   recipe:{schema:'storyforge.avg.image-processing-recipe',version:2,crop:null,width:requirement.width,height:requirement.height,fit:'contain',anchor:{x:5000,y:5000},background:null,
    declaration:'独立本地加工',foreground:{schema:'storyforge.avg.foreground-policy',version:1,method:'reserved-magenta',reservedColor:'#FF00FF',subjectUsesReservedColor:false,
     algorithm:DECLARED_MAGENTA_ALPHA_MATTING_ID_V1,declaration:'作者明确本次底色与主体用色；不签美术通过'}}}]}
  const saved=await saveAvgImageProcessingDraftV1({scope:owner.scope,expectedDraftRevision:draft.revision,plan}),workspace=parseAvgAuthorWorkspaceV1(saved.editorJson)
  const actual=workspace.mediaBatch!.requirements.find(r=>r.requirementKey===requirement.requirementKey)!
  expect(actual.invariants).toContain(AVG_RESERVED_MAGENTA_INVARIANT_V1);expect(actual.forbiddenDepictions).toContain(AVG_RESERVED_MAGENTA_FORBIDDEN_V1)
  expect(actual.references).toEqual(requirement.references);expect(workspace.imageProcessing).toEqual(plan)
  await expect(saveAvgImageProcessingDraftV1({scope:owner.scope,expectedDraftRevision:draft.revision,plan:null})).rejects.toThrow(/已变化/)
  expect(await readAvgDraftV1(owner.scope)).toEqual(saved)
  const removed=await saveAvgImageProcessingDraftV1({scope:owner.scope,expectedDraftRevision:saved.revision,plan:null})
  expect(parseAvgAuthorWorkspaceV1(removed.editorJson).mediaBatch).toEqual(compiled.batch)
  expect(parseAvgAuthorWorkspaceV1(removed.editorJson).imageProcessing).toBeUndefined()
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
})
