import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import AssemblyWorkbench from '../../src/components/avg/AssemblyWorkbench'
import * as service from '../../src/lib/avg/assembly-service'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'

// Parent UI timing only. This child supplies an explicit controlled callback;
// no Build, producer result, author adoption or provider evidence is fabricated.
vi.mock('../../src/components/avg/MediaProductionPanel',()=>({default:({onGenerate}:{onGenerate:()=>void})=><button onClick={onGenerate}>开始受控异步等待</button>}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
let mounted:Root|undefined
beforeEach(async()=>{
  await db.delete();await db.open()
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION','1')
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Progress UI must not contact a provider')}))
})
afterEach(async()=>{
  if(mounted)await act(async()=>mounted!.unmount())
  mounted=undefined;document.body.innerHTML='';vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();db.close()
})
function deferred<T>(){
  let resolve!:(value:T)=>void,reject!:(reason:Error)=>void
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no})
  return {promise,resolve,reject}
}
async function setup(){
  const owner=await prepareNativeAvgAssembly(),view=await service.readAvgAssemblyWorkspaceV1(owner.scope)
  const read=vi.spyOn(service,'readAvgAssemblyWorkspaceV1').mockResolvedValue(view)
  const operation=deferred<Awaited<ReturnType<typeof service.runAvgAssemblyV1>>>()
  const generate=vi.spyOn(service,'runAvgAssemblyV1').mockReturnValue(operation.promise)
  vi.useFakeTimers({toFake:['setInterval','clearInterval']})
  const container=document.createElement('div');document.body.append(container);mounted=createRoot(container)
  await act(async()=>mounted!.render(<AssemblyWorkbench scope={owner.scope} productionId={owner.productionId} page="media-all" onSource={vi.fn()} onPreviewStarted={vi.fn()}/>))
  await act(async()=>{await vi.dynamicImportSettled()})
  const button=[...container.querySelectorAll('button')].find(b=>b.textContent==='开始受控异步等待')!
  expect(button).toBeDefined()
  await act(async()=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})))
  return {owner,view,read,operation,generate,container}
}
const progress=(container:HTMLElement)=>container.querySelector('[aria-label="制作进度读取状态"]')
describe('AVG workbench background progress read ownership',()=>{
  it('keeps a rejected progress snapshot visible until a verified read succeeds, without turning it into an action error',async()=>{
    const f=await setup()
    f.read.mockRejectedValueOnce(new Error('[product-production-artifact] 已采用输入在读取期间已变化'))
    await act(async()=>vi.advanceTimersByTimeAsync(4000))
    expect(progress(f.container)).not.toBeNull()
    expect(progress(f.container)?.textContent).toContain('已采用输入在读取期间已变化')
    expect(f.container.querySelector('[role="alert"]')).toBeNull()
    await act(async()=>vi.advanceTimersByTimeAsync(4000))
    expect(progress(f.container)).toBeNull()
    expect(f.container.querySelector('[role="alert"]')).toBeNull()
    expect(f.generate).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled()
    expect(await db.productBuilds.count()).toBe(0)
  },20_000)
  it('preserves a real task failure when progress polling ends',async()=>{
    const f=await setup()
    f.read.mockRejectedValueOnce(new Error('旧进度快照变化'))
    await act(async()=>vi.advanceTimersByTimeAsync(4000))
    await act(async()=>f.operation.reject(new Error('受控任务失败：401，原请求未重发')))
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain('受控任务失败：401')
    expect(progress(f.container)).toBeNull();expect(f.container.textContent).not.toContain('旧进度快照变化')
    expect(f.generate).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled()
  },20_000)
  it('ignores an older poll failure after the final explicit reload has started',async()=>{
    const f=await setup(),oldPoll=deferred<typeof f.view>(),finalRead=deferred<typeof f.view>()
    f.read.mockReturnValueOnce(oldPoll.promise).mockReturnValueOnce(finalRead.promise)
    await act(async()=>vi.advanceTimersByTimeAsync(4000))
    // A UI-only scheduler projection, never persisted or used as Run evidence.
    const result:Awaited<ReturnType<typeof service.runAvgAssemblyV1>>={productionId:f.owner.productionId,buildId:0,buildNumber:0,
      buildStatus:'building',controlEpoch:0,planHash:'',rootRunId:null,terminal:false,tasks:[],
      budget:{usage:{modelCalls:0,mediaCalls:0,inputTokens:0,outputTokens:0,costUsd:0,durationMs:0,storageBytes:0},limits:JSON.parse(f.owner.details.brief!.briefJson).productionBudget}}
    await act(async()=>f.operation.resolve(result))
    expect(f.read).toHaveBeenCalledTimes(3)
    await act(async()=>oldPoll.reject(new Error('晚到的旧进度错误')))
    await act(async()=>finalRead.resolve(f.view))
    expect(f.container.querySelector('[role="alert"]')).toBeNull();expect(progress(f.container)).toBeNull()
    expect(f.container.textContent).toContain('本批媒资步骤已执行')
    expect(f.generate).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled()
  },20_000)
})
