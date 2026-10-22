import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import CharacterFamilyPanel from '../../src/components/avg/CharacterFamilyPanel'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { readAvgAssemblyWorkspaceV1,saveAvgImageProcessingDraftV1 } from '../../src/lib/avg/assembly-service'
import { prepareAvgCharacterFamilyProposalV1,saveAvgCharacterFamilyBatchDraftV1 } from '../../src/lib/avg/character-family-service'
import { setAvgCharacterFamilyReservedBackdropV1,buildAvgCharacterFamilyForegroundProcessingPlanV1 } from '../../src/lib/avg/character-family-foreground'
import { projectAvgForegroundCanvasRecipeV1 } from '../../src/lib/avg/image-processing-contract-v2'
import { avgFamilyForegroundFixture,AVG_FAMILY_FOREGROUND_DECLARATION_FIXTURE } from '../helpers/avg-family-foreground-fixture'
import { AVG_RESERVED_MAGENTA_INVARIANT_V1 } from '../../src/lib/avg/image-foreground-contract'
import { AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2 } from '../../src/lib/avg/image-foreground-boundary-unmix'

vi.mock('../../src/components/avg/GeneratedReferencePicker',()=>({default:()=>null}))
const roots:Root[]=[]
beforeEach(async()=>{await db.delete();await db.open();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No family UI dispatch is authorized')}))})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();db.close();document.body.replaceChildren()})
async function mounted(mixed=false,policyMixed=false){
 const s=await avgFamilyForegroundFixture(),reserved=setAvgCharacterFamilyReservedBackdropV1(s.plan,true)
 const proposal=await prepareAvgCharacterFamilyProposalV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,plan:reserved})
 const imageProcessing=buildAvgCharacterFamilyForegroundProcessingPlanV1(reserved,AVG_FAMILY_FOREGROUND_DECLARATION_FIXTURE)
 let saved=await saveAvgCharacterFamilyBatchDraftV1({scope:s.owner.scope,expectedDraftRevision:s.draft.revision,proposal,imageProcessing,
  approval:{proposalHash:proposal.proposalHash,providerInputAllowed:true,derivativeUseAllowed:true,declaration:'原工程作者的准确家族基准权限，不签艺术通过'}})
 const originalCanvas=projectAvgForegroundCanvasRecipeV1(imageProcessing.entries[1].recipe)
 if(mixed)saved=await saveAvgImageProcessingDraftV1({scope:s.owner.scope,expectedDraftRevision:saved.revision,plan:{...imageProcessing,
  entries:[imageProcessing.entries[0],{...imageProcessing.entries[1],recipe:originalCanvas}]}})
 if(policyMixed){
  const old=imageProcessing.entries[1].recipe;if(old.version!==2)throw new Error('Expected explicit original foreground')
  saved=await saveAvgImageProcessingDraftV1({scope:s.owner.scope,expectedDraftRevision:saved.revision,plan:{...imageProcessing,
   entries:[imageProcessing.entries[0],{...imageProcessing.entries[1],recipe:{...old,foreground:{...old.foreground,version:2,algorithm:AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2}}}]}})
 }
 let view=await readAvgAssemblyWorkspaceV1(s.owner.scope),action=Promise.resolve()
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
 const errors:string[]=[],notice=vi.fn()
 const onAction=(task:()=>Promise<void>)=>{action=task().catch(error=>{errors.push(String(error))});return action}
 const reload=async()=>{view=await readAvgAssemblyWorkspaceV1(s.owner.scope);root.render(node())}
 const node=()=> <CharacterFamilyPanel scope={s.owner.scope} view={view} workspace={parseAvgAuthorWorkspaceV1(view.draft.editorJson)} disabled={false} visible={false}
  onPending={()=>{}} onAction={onAction} onReload={reload} onNotice={notice}/>
 await act(async()=>root.render(node()))
 const field=(text:string)=>Array.from(host.querySelectorAll('label')).find(l=>l.textContent!.startsWith(text))!.querySelector('input,textarea')! as HTMLInputElement|HTMLTextAreaElement
 const fill=async(text:string,value:string)=>act(async()=>{const e=field(text);const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))})
 const click=async(name:string)=>act(async()=>{const b=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===name)!;expect(b).toBeDefined();expect(b.disabled).toBe(false);b.click();await action})
 const toggle=async(text:string)=>act(async()=>{(field(text) as HTMLInputElement).click()})
 const approve=async()=>{for(const text of ['我有权将此基准发送给本批全部图片请求','我有权以此基准制作本批全部变体'])await toggle(text)
  await fill('本批基准与衍生授权声明','本次新方案的基准外发和衍生权限已经明确核对；不签艺术通过')}
 // Rights declaration edits intentionally clear consent; confirm after the note.
 const confirm=async()=>{await fill('本批基准与衍生授权声明','本次新方案的基准外发和衍生权限已经明确核对；不签艺术通过')
  for(const text of ['我有权将此基准发送给本批全部图片请求','我有权以此基准制作本批全部变体'])await toggle(text)}
 return {s,saved,host,field,fill,click,toggle,approve,confirm,errors,notice,originalCanvas,getView:()=>view}
}

describe('AVG family foreground author review and optional processing save',()=>{
 it('hides internal reservation markers, preserves them through author text edits and invalidates old proposal permissions after processing-note edits',async()=>{
  const m=await mounted()
  expect((m.field('为全部变体预留纯品红底色') as HTMLInputElement).checked).toBe(true)
  expect(m.field('身份与造型必须保持').value).not.toContain('[storyforge.')
  await m.fill('身份与造型必须保持','保留白色衬衣、蓝色外套和公开脸型')
  await m.click('生成待核对的家族方案');await m.confirm()
  expect((m.field('我有权将此基准发送给本批全部图片请求') as HTMLInputElement).checked).toBe(true)
  await m.fill('家族保留底色与本地加工说明','新说明：主体不用保留底色，仅允许明确分离与统一画布；结果逐张重新评审')
  expect(m.host.querySelector('section[aria-label="家族方案核对"]')).toBeNull()
  await m.click('生成待核对的家族方案')
  expect((m.field('我有权将此基准发送给本批全部图片请求') as HTMLInputElement).checked).toBe(false)
  await m.confirm();await m.click('保存已核对的家族批次')
  expect(m.errors).toEqual([])
  const w=parseAvgAuthorWorkspaceV1(m.getView().draft.editorJson)
  expect(w.mediaBatch!.characterFamily!.proposal.plan.identityInvariants).toEqual(['保留白色衬衣、蓝色外套和公开脸型',AVG_RESERVED_MAGENTA_INVARIANT_V1])
  expect(w.imageProcessing!.entries).toHaveLength(2)
  for(const e of w.imageProcessing!.entries){expect(e.recipe.version).toBe(2);expect(e.recipe.declaration).toContain('新说明')}
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it('explicitly removes only family foreground recipes when the next proposal cancels reservation, retaining the existing ordinary crop recipe',async()=>{
  const m=await mounted(true),before=parseAvgAuthorWorkspaceV1(m.getView().draft.editorJson)
  await m.toggle('为全部变体预留纯品红底色')
  expect(m.host.textContent).toContain('已有普通裁切配方及历史版本保留')
  await m.click('生成待核对的家族方案');await m.confirm();await m.click('保存已核对的家族批次')
  expect(m.errors).toEqual([])
  const w=parseAvgAuthorWorkspaceV1(m.getView().draft.editorJson)
  expect(w.imageProcessing).toEqual({schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:before.imageProcessing!.entries[1].requirementKey,recipe:m.originalCanvas}]})
  expect(w.mediaBatch!.characterFamily!.proposal.plan.identityInvariants).toEqual(m.s.plan.identityInvariants)
  expect(w.mediaBatch!.characterFamily!.proposal.plan.baseline).toEqual(m.s.plan.baseline)
  expect(await db.mediaBlobObjects.count()).toBe(1);expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it('requires a new review after changing the algorithm and freezes policy2 for every exact variant without dispatch',async()=>{
  const m=await mounted(),select=Array.from(m.host.querySelectorAll('label')).find(l=>l.textContent!.startsWith('家族前景边缘处理'))!.querySelector('select')!
  expect(select.value).toBe('1')
  await m.click('生成待核对的家族方案');await m.confirm()
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,'2');select.dispatchEvent(new Event('change',{bubbles:true}))})
  expect(m.host.querySelector('section[aria-label="家族方案核对"]')).toBeNull()
  await m.click('生成待核对的家族方案')
  expect((m.field('我有权将此基准发送给本批全部图片请求') as HTMLInputElement).checked).toBe(false)
  await m.confirm();await m.click('保存已核对的家族批次')
  expect(m.errors).toEqual([])
  const w=parseAvgAuthorWorkspaceV1(m.getView().draft.editorJson)
  for(const e of w.imageProcessing!.entries){if(e.recipe.version!==2)throw new Error('Expected foreground recipe');expect(e.recipe.foreground).toMatchObject({version:2,algorithm:AVG_FOREGROUND_BOUNDARY_UNMIX_ID_V2})}
  expect(w.mediaBatch!.characterFamily!.proposal.plan.baseline).toEqual(m.s.plan.baseline)
  expect(Array.from(m.host.querySelectorAll('label')).find(l=>l.textContent!.startsWith('家族前景边缘处理'))!.querySelector('select')!.value).toBe('2')
  expect(Array.from(m.host.querySelectorAll('button')).find(b=>b.textContent==='撤销未保存的家族方案')!.disabled).toBe(true)
  expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
 it('shows mixed saved policies without silently replacing them and requires an explicit bulk choice',async()=>{
  const m=await mounted(false,true),before=m.getView().draft.editorJson
  const select=Array.from(m.host.querySelectorAll('label')).find(l=>l.textContent!.startsWith('家族前景边缘处理'))!.querySelector('select')!
  expect(select.value).toBe('0');expect(m.host.textContent).toContain('当前各变体不同')
  expect(Array.from(m.host.querySelectorAll('button')).find(b=>b.textContent==='生成待核对的家族方案')!.disabled).toBe(true)
  expect(m.getView().draft.editorJson).toBe(before)
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,'2');select.dispatchEvent(new Event('change',{bubbles:true}))})
  await m.click('生成待核对的家族方案');await m.confirm();await m.click('保存已核对的家族批次')
  expect(m.errors).toEqual([])
  for(const e of parseAvgAuthorWorkspaceV1(m.getView().draft.editorJson).imageProcessing!.entries){if(e.recipe.version!==2)throw new Error('Expected foreground recipe');expect(e.recipe.foreground.version).toBe(2)}
  expect(await db.productBuilds.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
 })
})
