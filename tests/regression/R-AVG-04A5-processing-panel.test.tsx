import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import ImageProcessingPlanPanel from '../../src/components/avg/ImageProcessingPlanPanel'
import { db } from '../../src/lib/db/schema'
import * as readiness from '../../src/lib/avg/visual-planning-brief'
import { avgVisualPlanningFixtureV4 } from '../helpers/avg-visual-planning-fixture'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { prepareAvgVisualImageProcessingV4 } from '../../src/lib/avg/visual-processing-workspace'
import { avgImageProcessingRecipeFixture } from '../helpers/avg-image-processing-fixture'

const roots:Root[]=[]
beforeEach(async()=>{await db.delete();await db.open();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(readiness,'avgVisualPlanningExecutionReadyV4').mockReturnValue(true)})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();db.close();document.body.innerHTML=''})

async function fixture(){
  const f=await avgVisualPlanningFixtureV4('linear'),owner=f.owner
  const saved=await executeProductProductionCommand({scope:owner.scope,productionId:owner.productionId,command:{type:'save-brief-revision',
    commandId:'processing.panel.prepare',expectedStateRevision:owner.details.production.stateRevision,parentRevision:owner.details.brief!.revision,brief:f.brief}})
  expect(saved.ok).toBe(true)
  let view=await readAvgAssemblyWorkspaceV1(owner.scope),action:Promise<void>=Promise.resolve()
  const pending=vi.fn(),notice=vi.fn(),errors:string[]=[],host=document.createElement('div');document.body.append(host)
  const root=createRoot(host);roots.push(root)
  const onAction=(task:()=>Promise<void>)=>{action=task().catch(error=>{errors.push(error instanceof Error?error.message:String(error))});return action}
  const refresh=async()=>{view=await readAvgAssemblyWorkspaceV1(owner.scope);root.render(node())}
  const node=()=> <ImageProcessingPlanPanel scope={owner.scope} workspace={parseAvgAuthorWorkspaceV1(view.draft.editorJson)} view={view}
    draftRevision={view.draft.revision} disabled={false} canEdit={true} onPending={pending} onAction={onAction} onReload={refresh} onNotice={notice}/>
  await act(async()=>root.render(node()))
  const dispatch=vi.fn(async()=>{throw new Error('Recipe preparation must not make a provider request')});vi.stubGlobal('fetch',dispatch)
  const field=()=>{const label=Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.trim().startsWith('允许的加工与用途说明'));return label!.querySelector('textarea')!}
  const edit=async(value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field(),value);field().dispatchEvent(new Event('input',{bubbles:true}))})
  const click=async(name:string)=>act(async()=>{const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.trim()===name)!;expect(button).toBeDefined();expect(button.disabled).toBe(false);button.click();await action})
  return {owner,getView:()=>view,refresh:()=>act(refresh),host,pending,notice,errors,dispatch,field,edit,click}
}

describe('AVG professional processing recipe panel with real pending Brief commands',()=>{
  it('saves and explicitly removes a V4 recipe without a mirrored author batch, Build, Run or provider call',async()=>{
    const s=await fixture(),before=s.getView(),brief=parseProductProductionBriefV3(before.details!.brief!.briefJson),draft=before.draft
    await s.edit('仅做作者明确允许的裁切与透明留边；工程材料');await s.click('保存本项加工配方')
    expect(s.notice).toHaveBeenCalled();expect(s.errors).toEqual([]);expect(s.pending).toHaveBeenCalledWith(true)
    const saved=parseProductProductionBriefV3(s.getView().details!.brief!.briefJson)
    expect(saved.avgVisualPlanning!.imageProcessing!.entries[0].recipe.declaration).toContain('透明留边')
    expect(saved.productionBudget.maximumModelCalls).toBe(brief.productionBudget.maximumModelCalls)
    expect(saved.productionBudget.maximumMediaCalls).toBe(brief.productionBudget.maximumMediaCalls)
    expect(s.getView().draft).toEqual(draft)
    expect(parseAvgAuthorWorkspaceV1(s.getView().draft.editorJson).mediaBatch).toBeUndefined()
    expect(parseAvgAuthorWorkspaceV1(s.getView().draft.editorJson).imageProcessing).toBeUndefined()
    expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(s.dispatch).not.toHaveBeenCalled()
    await s.click('移除此项加工配方');expect(s.notice).toHaveBeenCalledTimes(2)
    const removed=parseProductProductionBriefV3(s.getView().details!.brief!.briefJson)
    expect(removed.avgVisualPlanning).toEqual(brief.avgVisualPlanning);expect(removed.productionBudget).toEqual(brief.productionBudget)
    expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(s.dispatch).not.toHaveBeenCalled()
  },20_000)
  it('preserves local edits and refuses a stale save after another window changes the pending Brief until explicit discard',async()=>{
    const s=await fixture(),view=s.getView(),brief=parseProductProductionBriefV3(view.details!.brief!.briefJson)
    await s.edit('本窗口未保存的加工要求')
    const changed=await prepareAvgVisualImageProcessingV4({scope:s.owner.scope,productionId:s.owner.productionId,
      expectedBriefHash:view.details!.brief!.briefHash,expectedDraftRevision:view.draft.revision,expectedBuild:null,
      plan:{schema:'storyforge.avg.image-processing-plan',version:1,entries:[{requirementKey:brief.avgVisualPlanning!.scope.templates[0].parameters.requirementKey,
        recipe:{...avgImageProcessingRecipeFixture(),declaration:'另一个窗口保存的明确加工要求'}}]}})
    await s.refresh();await s.click('保存本项加工配方')
    expect(s.errors).toHaveLength(1);expect(s.errors[0]).toMatch(/已变化/);expect(s.getView().details!.brief!.briefHash).toBe(changed.brief!.briefHash)
    expect(s.field().value).toBe('本窗口未保存的加工要求')
    await s.click('撤销未保存的加工');expect(s.field().value).toBe('另一个窗口保存的明确加工要求')
    expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(s.dispatch).not.toHaveBeenCalled()
  },20_000)
})
