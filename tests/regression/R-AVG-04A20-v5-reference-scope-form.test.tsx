import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import VisualPlanningScopeForm from '../../src/components/avg/VisualPlanningScopeForm'
import VisualImageRoutePanel from '../../src/components/avg/VisualImageRoutePanel'
import ImageProcessingPlanPanel from '../../src/components/avg/ImageProcessingPlanPanel'
import { avgV5WorkbenchPreparationFixture } from '../helpers/avg-v5-workbench-preparation-fixture'
import { prepareAvgAssemblyBriefV1,readAvgAssemblyWorkspaceV1,startAvgAssemblyV1,restartAvgVisualPlanningFromDraftV4,restartAvgVisualPlanningFromDraftV5 } from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { stopProductProductionV1 } from '../../src/lib/product-production/service'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import type { AvgVisualPlanningDraftV4,AvgVisualPlanningDraftV5 } from '../../src/lib/avg/visual-planning-workspace'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const roots:Root[]=[]
beforeEach(async()=>{
  await db.delete();await db.open();vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')
  // Isolate the controlled fixture gate; real entrypoints still require both
  // original default-off experiment switches and explicit author start.
  vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV5').mockReturnValue(true)
  useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-no-network',baseUrl:'https://v5-ui.fixture.invalid/v1',model:'agnes-2.5-flash'})
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Form/start/restart must not dispatch models')}))
})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();db.close();document.body.innerHTML=''})
function button(host:HTMLElement,name:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent===name);expect(b).not.toBeUndefined();return b!}
async function fill(host:HTMLElement,label:string,value:string){
  const el=host.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`)!;expect(el).not.toBeNull()
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))})
}
async function approve(host:HTMLElement){for(const label of [...host.querySelectorAll('label')].filter(l=>l.textContent!.startsWith('我有权')))await act(async()=>label.querySelector<HTMLInputElement>('input')!.click())}
async function mount(){
  const f=await avgV5WorkbenchPreparationFixture(),view=await readAvgAssemblyWorkspaceV1(f.owner.scope)
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
  let pending:Promise<void>=Promise.resolve();const onPrepare=vi.fn(async(visualPlanning:AvgVisualPlanningDraftV4|AvgVisualPlanningDraftV5)=>{
    await prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:view.draft.revision,visualPlanning})
  })
  await act(async()=>root.render(<VisualPlanningScopeForm scope={f.owner.scope} workspace={f.workspace} view={view} prepared={f.scope} version={5}
    disabled={false} visible={true} onPrepare={onPrepare} onPending={vi.fn()} onCancel={vi.fn()} onAction={task=>{pending=task();return pending}}/>))
  const save=async()=>{await act(async()=>{button(host,'准备专业视觉制作方案').click();await pending})}
  return {f,view,host,onPrepare,save}
}

describe('AVG actual Scope2 form into separate V5 public preparation and start',()=>{
  it('preserves five targets and every policy, requiring fresh consent after a policy edit before saving a reviewable Brief',async()=>{
    const {host,f,onPrepare,save}=await mount(),b=button(host,'准备专业视觉制作方案')
    expect(host.querySelectorAll('article[aria-label]')).toHaveLength(5);expect(b.disabled).toBe(true)
    await approve(host);expect(b.disabled).toBe(false)
    const key=f.scope.referenceCatalog[0].referenceKey
    await fill(host,`允许参考：${key}`,'只使用冷暖配色\n不引用构图\n');expect(b.disabled).toBe(true)
    await fill(host,`必须排除：${key}`,'蜡封信件\n发光按钮\n')
    await approve(host);await save();expect(onPrepare).toHaveBeenCalledTimes(1)
    const view=await readAvgAssemblyWorkspaceV1(f.owner.scope),brief=parseProductProductionBriefV3(view.details!.brief!.briefJson)
    if(brief.avgVisualPlanning?.version!==5)throw new Error('Expected actual new Brief')
    expect(brief.avgVisualPlanning.scope.templates).toEqual(f.scope.templates)
    expect(brief.avgVisualPlanning.scope.referenceCatalog[0].reference.contentPolicy).toEqual({permittedFeatures:['只使用冷暖配色','不引用构图'],excludedFeatures:['蜡封信件','发光按钮']})
    expect(brief.avgVisualPlanning.scope.referenceCatalog[1]).toEqual(f.scope.referenceCatalog[1])
    expect(await db.agentRuns.count()).toBe(0);expect(await db.productBuilds.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
    await startAvgAssemblyV1({scope:f.owner.scope,productionId:view.details!.production.id!,expectedBriefHash:view.details!.brief!.briefHash})
    expect((await readAvgAssemblyWorkspaceV1(f.owner.scope)).details!.executionBrief!.avgVisualPlanning!.version).toBe(5)
    expect(fetch).not.toHaveBeenCalled()
  },30_000)
  it('uses actual V5 route and processing writers from the existing controls without duplicating the author draft or sending a request',async()=>{
    const {f,host,save}=await mount();await approve(host);await save()
    let view=await readAvgAssemblyWorkspaceV1(f.owner.scope),action:Promise<void>=Promise.resolve()
    const before=view.draft
    const panel=document.createElement('div');document.body.append(panel);const root=createRoot(panel);roots.push(root)
    const onAction=(task:()=>Promise<void>)=>{action=task();return action},onReload=async()=>{view=await readAvgAssemblyWorkspaceV1(f.owner.scope)}
    await act(async()=>root.render(<VisualImageRoutePanel scope={f.owner.scope} view={view} disabled={false} onAction={onAction} onReload={onReload} onNotice={vi.fn()} onPending={vi.fn()}/>))
    await act(async()=>{const select=panel.querySelector('select')!;select.value='agnes.image-2.5-flash.v1';select.dispatchEvent(new Event('change',{bubbles:true}))})
    await act(async()=>{button(panel,'核对并保存图片模型').click();await action})
    const brief=parseProductProductionBriefV3(view.details!.brief!.briefJson)
    expect(brief.avgVisualPlanning!.version).toBe(5);expect(brief.avgVisualPlanning!.imageBinding.adapterId).toBe('agnes.image-2.5-flash.v1')
    await act(async()=>root.render(<ImageProcessingPlanPanel scope={f.owner.scope} workspace={f.workspace} view={view} draftRevision={view.draft.revision} disabled={false} canEdit={true}
      onAction={onAction} onReload={onReload} onNotice={vi.fn()} onPending={vi.fn()}/>))
    await act(async()=>{const target=panel.querySelector<HTMLSelectElement>('[aria-label="加工目标"]')!;expect(target).not.toBeNull();target.value=f.scope.templates[4].parameters.requirementKey;target.dispatchEvent(new Event('change',{bubbles:true}))})
    const textarea=panel.querySelector('textarea')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'仅透明留边和明确裁切，不承诺去除背景');textarea.dispatchEvent(new Event('input',{bubbles:true}))})
    await act(async()=>{button(panel,'保存本项加工配方').click();await action})
    const next=parseProductProductionBriefV3(view.details!.brief!.briefJson)
    expect(next.avgVisualPlanning!.version).toBe(5);expect(next.avgVisualPlanning!.imageProcessing!.entries[0].recipe.declaration).toContain('明确裁切');expect(next.avgVisualPlanning!.imageProcessing!.entries[0].requirementKey).toBe(f.scope.templates[4].parameters.requirementKey)
    expect(next.avgVisualPlanning!.scope).toEqual(brief.avgVisualPlanning!.scope);expect(view.draft).toEqual(before)
    expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  },30_000)
  it('blocks an empty permission scope and does not save, adopt or silently downgrade the form',async()=>{
    const {host,f,onPrepare}=await mount();await approve(host)
    await fill(host,`允许参考：${f.scope.referenceCatalog[0].referenceKey}`,'\n')
    await approve(host);expect(button(host,'准备专业视觉制作方案').disabled).toBe(true)
    expect(onPrepare).not.toHaveBeenCalled();expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  },30_000)
  it('prepares a fresh actual V5 revision after a known never-dispatched stop without copying adoption or accepting a V4 restart',async()=>{
    const {f,host,save}=await mount();await approve(host);await save()
    let view=await readAvgAssemblyWorkspaceV1(f.owner.scope)
    await startAvgAssemblyV1({scope:f.owner.scope,productionId:view.details!.production.id!,expectedBriefHash:view.details!.brief!.briefHash})
    view=await readAvgAssemblyWorkspaceV1(f.owner.scope)
    await stopProductProductionV1({scope:f.owner.scope,production:view.details!.production})
    view=await readAvgAssemblyWorkspaceV1(f.owner.scope)
    const old=view.details!.build!,input={scope:f.owner.scope,productionId:view.details!.production.id!,expectedBuildId:old.id!,expectedBuildRevision:old.stateRevision,expectedDraftRevision:view.draft.revision}
    await expect(restartAvgVisualPlanningFromDraftV4(input)).rejects.toThrow()
    await restartAvgVisualPlanningFromDraftV5(input)
    const next=await readAvgAssemblyWorkspaceV1(f.owner.scope),brief=parseProductProductionBriefV3(next.details!.brief!.briefJson)
    expect(brief.avgVisualPlanning!.version).toBe(5);expect(next.details!.brief!.revision).toBeGreaterThan(old.briefRevision)
    expect(next.details!.build!.id).toBe(old.id);expect(next.details!.production.status).toBe('brief-ready')
    expect(await db.productBuildArtifacts.where('buildId').equals(old.id!).count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  },30_000)
})
