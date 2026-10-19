import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import AssemblyWorkbench from '../../src/components/avg/AssemblyWorkbench'
import { avgV5WorkbenchPreparationFixture } from '../helpers/avg-v5-workbench-preparation-fixture'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as service from '../../src/lib/avg/assembly-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import VisualPlanningPanel from '../../src/components/avg/VisualPlanningPanel'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'
import { readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let mounted:Root|undefined
beforeEach(async()=>{await db.delete();await db.open();vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1');vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','1')})
afterEach(async()=>{if(mounted)await act(async()=>mounted!.unmount());mounted=undefined;document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();db.close()})
describe('AVG connected workbench guard for gated versioned metadata',()=>{
  it.each(['media','visual'] as const)('preserves V5 metadata with %s disabled without offering an old form or an enabled editing action',async off=>{
    const {owner,author,brief}=await avgV5FormalFixture(),view=await readAvgAssemblyWorkspaceV1(owner.scope)
    vi.stubEnv(off==='media'?'VITE_STORYFORGE_AVG_MEDIA_PRODUCTION':'VITE_STORYFORGE_AVG_VISUAL_PLANNING','0')
    // UI-only metadata overlay: no V5 Brief/Build/Run or receipt is written.
    const projected={...view,details:{...view.details!,brief:{...view.details!.brief!,briefJson:JSON.stringify(brief),briefHash:await hashProductProductionValueV2(brief)}}}
    const container=document.createElement('div');document.body.appendChild(container);mounted=createRoot(container)
    const prepare=vi.fn(),generate=vi.fn(),action=vi.fn(),pending=vi.fn()
    await act(async()=>mounted!.render(<VisualPlanningPanel scope={owner.scope} view={projected} workspace={author.source} disabled={false}
      visible={true} activeBuild={false} sourcesReady={true} declaration="工程验证" generating={false} onAction={action} onPrepare={prepare}
      onGenerate={generate} onCancel={vi.fn()} onReload={vi.fn()} onNotice={vi.fn()} onPending={pending}/>))
    expect(container.textContent).toContain('已保存专业用途')
    expect(container.querySelectorAll('form,input,textarea')).toHaveLength(0)
    for(const control of container.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('button,select'))expect(control.disabled).toBe(true)
    expect(prepare).not.toHaveBeenCalled();expect(generate).not.toHaveBeenCalled();expect(action).not.toHaveBeenCalled()
  })
  it.each(['professional','inherited-only'] as const)('uses the pending %s contract for the start control instead of an old execution tag',async mode=>{
    useAIConfigStore.getState().setConfig({provider:'agnes',apiKey:'test-only-no-network',baseUrl:'https://ui-gates.fixture.invalid/v1',model:'agnes-2.5-flash'})
    vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('UI guard must never dispatch a provider')}))
    const f=await avgV5WorkbenchPreparationFixture()
    await service.prepareAvgAssemblyBriefV1({scope:f.owner.scope,expectedDraftRevision:(await service.readAvgAssemblyWorkspaceV1(f.owner.scope)).draft.revision,visualPlanning:f.planning})
    const original=await service.readAvgAssemblyWorkspaceV1(f.owner.scope),prepared=parseProductProductionBriefV3(original.details!.brief!.briefJson)
    // Only the nonvisual case overlays readonly UI metadata to exercise the
    // pending-vs-original contract selector; no child Build/receipt is seeded
    // and this test never claims backend continuation or producer evidence.
    const view=mode==='professional'?original:{...original,details:{...original.details!,executionBrief:prepared,
      brief:{...original.details!.brief!,briefJson:f.owner.details.brief!.briefJson,briefHash:f.owner.details.brief!.briefHash}}}
    vi.spyOn(service,'readAvgAssemblyWorkspaceV1').mockResolvedValue(view)
    vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING','0')
    const container=document.createElement('div');document.body.append(container);mounted=createRoot(container)
    await act(async()=>mounted!.render(<AssemblyWorkbench scope={f.owner.scope} productionId={original.details!.production.id!} page="production" onSource={vi.fn()} onPreviewStarted={vi.fn()}/>))
    await act(async()=>{await vi.dynamicImportSettled()})
    const start=[...container.querySelectorAll('button')].find(b=>b.textContent==='确认方案并开始组装')!
    expect(start).toBeDefined();expect(start.disabled).toBe(mode==='professional')
    expect(await db.productBuilds.count()).toBe(0);expect(await db.agentRuns.count()).toBe(0);expect(fetch).not.toHaveBeenCalled()
  },20_000)

})
