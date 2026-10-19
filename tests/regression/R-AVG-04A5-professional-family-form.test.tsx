import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import VisualPlanningScopeForm from '../../src/components/avg/VisualPlanningScopeForm'
import { createAvgDraftV1, readAvgDraftV1, selectAvgWorldV1 } from '../../src/lib/avg/draft-service'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { importAvgMediaV1, saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { readAvgAssemblyWorkspaceV1, prepareAvgAssemblyBriefV1, startAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { avgProfessionalFamilyScopeFixtureV4 } from '../helpers/avg-professional-family-scope-fixture'
import { avgVisualFormReferenceV4, replaceAvgVisualFormReferenceV4 } from '../../src/lib/avg/visual-planning-form'
import type { AvgVisualPlanningDraftV4 } from '../../src/lib/avg/visual-planning-workspace'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const roots:Root[]=[]
beforeEach(async()=>{
  await db.delete();await db.open()
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Inert form/start must not make a provider request')}))
  useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-no-network',baseUrl:'https://visual.fixture.invalid/v1',model:'agnes-2.5-flash'})
})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();db.close();document.body.innerHTML=''})

async function setup(){
  const owner=await createAvgDraftV1('专业家族表单工程验证'),world=await createMistHarborWorld(),input=avgProfessionalFamilyScopeFixtureV4('form')
  const selected=await selectAvgWorldV1(owner.scope,0,world.worldReleaseId)
  await saveAvgAuthorWorkspaceV1(owner.scope,selected.revision,input.workspace)
  const imports=[]
  for(const name of ['配色参考','身份参考','构图参考']){
    const data=await deterministicRegionMapPngV1({width:32,height:32,palette:['#16243b','#586c80','#e4cca2']})
    imports.push(await importAvgMediaV1({scope:owner.scope,data,mimeType:'image/png',kind:'background',name,altText:'原创工程参考，仅验协议',license:'本测试原创像素，不签艺术接受',characterTag:''}))
  }
  return {...owner,input,imports,view:await readAvgAssemblyWorkspaceV1(owner.scope),blobCount:await db.mediaBlobObjects.count()}
}
function actions(){
  const errors:unknown[]=[],onPending=vi.fn(),onCancel=vi.fn();let last=Promise.resolve()
  const onAction=(task:()=>Promise<void>)=>{last=task().catch(error=>{errors.push(error)});return last}
  return {errors,onPending,onCancel,onAction,action:()=>last}
}
async function mount(element:ReactNode){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
  await act(async()=>root.render(element));return host
}
function control(host:HTMLElement,label:string){
  const el=Array.from(host.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('[aria-label]')).find(e=>e.getAttribute('aria-label')===label)
  if(!el)throw new Error('Missing control: '+label);return el
}
function button(host:HTMLElement,name:string){const el=Array.from(host.querySelectorAll('button')).find(e=>e.textContent===name);if(!el)throw new Error('Missing button: '+name);return el}
async function fill(host:HTMLElement,label:string,value:string){
  const el=control(host,label),proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype
  await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})
}
async function click(host:HTMLElement,name:string,a?:ReturnType<typeof actions>){await act(async()=>{button(host,name).click();if(a)await a.action()})}
async function approve(host:HTMLElement){
  for(const text of ['我有权向本次图片供应商发送该参考','我有权用该参考进行本次衍生创作']){
    const box=Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(e=>e.closest('label')?.textContent===text)!
    await act(async()=>box.click())
  }
}

describe('AVG professional family form into actual public S2/start boundary',()=>{
  it('declares five exact consumers, shared character canvas and approved real references before any Run or request',async()=>{
    const s=await setup(),a=actions();let prepared:Awaited<ReturnType<typeof prepareAvgAssemblyBriefV1>>|null=null
    const onPrepare=vi.fn(async(value:AvgVisualPlanningDraftV4)=>{prepared=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:s.view.draft.revision,visualPlanning:value})})
    const host=await mount(<VisualPlanningScopeForm {...s} workspace={s.input.workspace} {...a} disabled={false} visible={true} onPrepare={onPrepare}/>)
    await fill(host,'必须呈现的场景细节（每行一项）','保留已有门窗和对白区')
    for(const name of ['新增人物姿态','新增人物表情','新增物件图标与详情图'])await click(host,name)
    const cards=Array.from(host.querySelectorAll<HTMLElement>('article[aria-label]'));expect(cards).toHaveLength(5)
    for(const card of cards.slice(1))await fill(card,'必须保持或呈现的细节（每行一项）','保持公开造型\n仅改变本变体\n')
    expect(control(cards[1],'必须保持或呈现的细节（每行一项）').value).toBe('保持公开造型\n仅改变本变体\n')
    await fill(cards[1],'图像宽度','640');expect(control(cards[2],'图像宽度').value).toBe('640')
    await fill(host,'本次风格参考',s.imports[0].assetKey);await fill(host,'参考允许改变的内容','只参考配色，允许重新布局')
    await fill(cards[1],'已导入的家族基准',s.imports[1].assetKey);await fill(cards[1],'家族基准允许变化','同一人物只改变姿态和表情')
    expect(control(cards[2],'已导入的家族基准').value).toBe(s.imports[1].assetKey)
    const save=button(host,'准备专业视觉制作方案');expect(save.disabled).toBe(true);await approve(host);expect(save.disabled).toBe(false)
    await click(host,'准备专业视觉制作方案',a);expect(prepared).not.toBeNull()
    expect(a.errors).toEqual([]);expect(await db.agentRuns.count()).toBe(0);expect(await db.mediaBlobObjects.count()).toBe(s.blobCount)
    const details=(await readAvgAssemblyWorkspaceV1(s.scope)).details!,brief=parseProductProductionBriefV3(details.brief!.briefJson),scope=brief.avgVisualPlanning!.scope
    expect(scope.templates.map(t=>t.subjectKind)).toEqual(['environment','character','character','prop','prop'])
    expect(scope.templates[1].parameters.triggerBeatKey).not.toBe(scope.templates[2].parameters.triggerBeatKey)
    expect(scope.templates[1].parameters).toMatchObject({width:640,alpha:'required'});expect(scope.templates[2].parameters.width).toBe(640)
    expect(scope.referenceCatalog.map(r=>r.reference.purpose).sort()).toEqual(['identity','style'])
    expect(scope.templates[1].requiredReferenceKeys).toHaveLength(2);expect(scope.templates[3].requiredReferenceKeys).toHaveLength(1)
    const saved=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
    expect(saved.mediaBatch).toBeUndefined();expect(saved.presentation.stage.assets).toEqual([])
    await startAvgAssemblyV1({scope:s.scope,productionId:details.production.id!,expectedBriefHash:details.brief!.briefHash})
    const started=await readAvgAssemblyWorkspaceV1(s.scope)
    expect(started.visualProgress!.budget.usage).toMatchObject({modelCalls:0,mediaCalls:0})
  },30_000)

  it('preserves all saved family targets and optional reference metadata through refresh, cancellation and explicit reapproval',async()=>{
    const s=await setup(),a=actions();let value=s.input.planning
    value=replaceAvgVisualFormReferenceV4(value,value.templates.map(t=>t.parameters.requirementKey),'style',{...avgVisualFormReferenceV4(s.imports[0],'style'),allowedChange:'保持配色'})
    value=replaceAvgVisualFormReferenceV4(value,value.templates.filter(t=>t.subjectKind==='character').map(t=>t.parameters.requirementKey),'identity',{...avgVisualFormReferenceV4(s.imports[1],'identity'),allowedChange:'允许姿态变化'})
    value.referenceCatalog.push({referenceKey:'optional.composition',reference:{...avgVisualFormReferenceV4(s.imports[2],'composition'),allowedChange:'只参考布局'}})
    value.templates[0].allowedReferenceKeys.push('optional.composition')
    const original=await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:s.view.draft.revision,visualPlanning:value}),view=await readAvgAssemblyWorkspaceV1(s.scope)
    const prepared=parseProductProductionBriefV3(original.brief!.briefJson).avgVisualPlanning!.scope
    const onPrepare=vi.fn(async(planning:AvgVisualPlanningDraftV4)=>{await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:view.draft.revision,visualPlanning:planning})})
    const host=await mount(<VisualPlanningScopeForm scope={s.scope} workspace={parseAvgAuthorWorkspaceV1(view.draft.editorJson)} view={view} prepared={prepared} {...a} disabled={false} visible={true} onPrepare={onPrepare}/>)
    expect(host.querySelectorAll('article[aria-label]')).toHaveLength(5)
    const save=button(host,'准备专业视觉制作方案');expect(save.disabled).toBe(true)
    await fill(host,'参考允许改变的内容','尚未保存的修改');await click(host,'撤销未保存的专业用途')
    expect(control(host,'参考允许改变的内容').value).toBe('保持配色');expect(a.onCancel).toHaveBeenCalledTimes(1)
    await approve(host);await click(host,'准备专业视觉制作方案',a);expect(onPrepare).toHaveResolved()
    expect(a.errors).toEqual([]);const {sourceInputHash:_hash,aspectRatio:_ratio,...expected}=prepared
    expect(onPrepare.mock.calls[0][0]).toEqual({...expected,revision:prepared.revision+1})
    expect(await db.agentRuns.count()).toBe(0)
  },30_000)

  it('keeps the rejected form while preserving an actually changed author draft and creates no production',async()=>{
    const s=await setup(),a=actions()
    const host=await mount(<VisualPlanningScopeForm {...s} workspace={s.input.workspace} {...a} disabled={false} visible={true}
      onPrepare={async visualPlanning=>{await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:s.view.draft.revision,visualPlanning})}}/>)
    await fill(host,'必须呈现的场景细节（每行一项）','作者尚未提交的画面用途')
    const changed=structuredClone(s.input.workspace);changed.scripts[0].lines[0].text+='另外保存的作者改稿'
    const saved=await saveAvgAuthorWorkspaceV1(s.scope,s.view.draft.revision,changed)
    await click(host,'准备专业视觉制作方案',a);expect(a.errors).toHaveLength(1)
    expect(String(a.errors[0])).toMatch(/草稿已变化/);expect((await readAvgDraftV1(s.scope)).editorJson).toBe(saved.editorJson)
    expect(control(host,'必须呈现的场景细节（每行一项）').value).toBe('作者尚未提交的画面用途')
    expect(await db.productProductions.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0)
    expect(a.onPending).toHaveBeenLastCalledWith(true)
  },30_000)

  it('invalidates previous reference approval and rejects two variants at the same exact actor consumer before writes',async()=>{
    const s=await setup(),a=actions()
    const host=await mount(<VisualPlanningScopeForm {...s} workspace={s.input.workspace} {...a} disabled={false} visible={true}
      onPrepare={async visualPlanning=>{await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:s.view.draft.revision,visualPlanning})}}/>)
    await fill(host,'必须呈现的场景细节（每行一项）','保持门窗')
    await click(host,'新增人物姿态');await click(host,'新增人物表情')
    const cards=Array.from(host.querySelectorAll<HTMLElement>('article[aria-label]'))
    for(const card of cards.slice(1))await fill(card,'必须保持或呈现的细节（每行一项）','保持公开身份')
    await fill(host,'本次风格参考',s.imports[0].assetKey);await fill(host,'参考允许改变的内容','只改变光照');await approve(host)
    const save=button(host,'准备专业视觉制作方案');expect(save.disabled).toBe(false)
    await fill(cards[2],'人物消费场景',control(cards[1],'人物消费场景').value)
    await fill(cards[2],'画面出现的台词',control(cards[1],'画面出现的台词').value)
    expect(save.disabled).toBe(true);await approve(host);await click(host,'准备专业视觉制作方案',a)
    expect(a.errors).toHaveLength(1);expect(String(a.errors[0])).toMatch(/consumer targets|重复/)
    expect(await db.productProductions.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0)
    expect(host.querySelectorAll('article[aria-label]')).toHaveLength(3)
    expect(a.onPending).toHaveBeenLastCalledWith(true)
  },30_000)

  it('adds base and existing item display variants without inventing predicates or replacing their distinct slots',async()=>{
    const s=await setup(),a=actions()
    const host=await mount(<VisualPlanningScopeForm {...s} workspace={s.input.workspace} {...a} disabled={false} visible={true}
      onPrepare={async visualPlanning=>{await prepareAvgAssemblyBriefV1({scope:s.scope,expectedDraftRevision:s.view.draft.revision,visualPlanning})}}/>)
    await fill(host,'必须呈现的场景细节（每行一项）','保持门窗')
    await click(host,'新增物件图标与详情图');await click(host,'新增物件图标与详情图')
    const cards=Array.from(host.querySelectorAll<HTMLElement>('article[aria-label]'));expect(cards).toHaveLength(5)
    for(const card of cards.slice(1))await fill(card,'必须保持或呈现的细节（每行一项）','保持物件公开形态')
    expect(control(cards[1],'物件显示变体').value).toBe('');expect(control(cards[3],'物件显示变体').value).not.toBe('')
    await click(host,'准备专业视觉制作方案',a);expect(a.errors).toEqual([])
    const saved=parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
    if(saved.systemPlan.version!==2||s.input.workspace.systemPlan.version!==2)throw new Error('Expected actual inventory source')
    const item=saved.systemPlan.inventory.items[0],original=s.input.workspace.systemPlan.inventory.items[0]
    expect(item.iconAssetKey).toBeTruthy();expect(item.detailAssetKey).toBeTruthy()
    expect(item.variants[0].iconAssetKey).toBeTruthy();expect(item.variants[0].detailAssetKey).toBeTruthy()
    expect(item.variants[0].iconAssetKey).not.toBe(item.iconAssetKey);expect(item.variants[0].when).toEqual(original.variants[0].when)
    expect(await db.agentRuns.count()).toBe(0)
  },30_000)
})
