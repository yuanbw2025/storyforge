import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import HistoricalImagePanel from '../../src/components/avg/HistoricalImagePanel'
import type { readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'

const readers=vi.hoisted(()=>({history:vi.fn()}))
vi.mock('../../src/lib/avg/visual-image-history',()=>({readAvgHistoricalImageCandidatesV4:readers.history}))
vi.mock('../../src/components/avg/MediaAssetPreview',()=>({default:()=> <span>已核对来源的工程预览</span>}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const roots:Root[]=[]
const scope={projectId:1,worldId:1,workId:1}
function view(id=1){return {details:{production:{id},build:{id,stateRevision:4,briefHash:'a'.repeat(64),planHash:'b'.repeat(64)}}} as unknown as Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>}
function result(id=1){return {buildNumber:id,boundary:{buildId:id,expectedBuildRevision:4,controlEpoch:0,expectedBriefHash:'a'.repeat(64),expectedPlanHash:'b'.repeat(64)},
  candidates:[{available:true,requirement:{requirementKey:'background',name:`原图${id}`},asset:{source:'agnes.image-2.5-flash.v1',width:576,height:324},raw:{version:1,contentHash:'c'.repeat(64)},costUsd:null}]}}
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('History UI must not dispatch providers')}))})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.unstubAllGlobals();document.body.innerHTML=''})
async function mount(){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
  await act(async()=>root.render(<HistoricalImagePanel scope={scope} view={view()}/>))
  return {host,root}
}
async function click(host:HTMLElement,label='读取原图与来源'){
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label)
  expect(button).toBeDefined();await act(async()=>{button!.click();await vi.dynamicImportSettled()})
}
describe('AVG explicit stopped image source panel',()=>{
  it('reads only on demand, retains unknown original fees and provides no generation/adoption controls',async()=>{
    readers.history.mockResolvedValue(result())
    const {host}=await mount();expect(readers.history).not.toHaveBeenCalled()
    await click(host)
    expect(readers.history).toHaveBeenCalledWith({scope,productionId:1,buildId:1,expectedBuildRevision:4,expectedBriefHash:'a'.repeat(64),expectedPlanHash:'b'.repeat(64)})
    expect(host.textContent).toContain('原调用费用：未知');expect(host.textContent).toContain('Agnes Image 2.5 Flash')
    expect(Array.from(host.querySelectorAll('button')).some(b=>/生成|采用|选用/.test(b.textContent??''))).toBe(false)
    await click(host,'查看原图');expect(host.textContent).toContain('已核对来源的工程预览')
    expect(readers.history).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['success','error'] as const)('ignores an old owner %s after the next owner has loaded',async mode=>{
    let resolve!:(value:unknown)=>void,reject!:(reason:Error)=>void
    const old=new Promise((yes,no)=>{resolve=yes;reject=no})
    readers.history.mockReturnValueOnce(old).mockResolvedValueOnce(result(2))
    const {host,root}=await mount();await click(host)
    await act(async()=>root.render(<HistoricalImagePanel scope={{...scope,workId:2}} view={view(2)}/>))
    await click(host);expect(host.textContent).toContain('原图2')
    await act(async()=>{if(mode==='success')resolve(result(1));else reject(new Error('旧作品迟到错误'))})
    expect(host.textContent).toContain('原图2');expect(host.textContent).not.toContain('原图1');expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('retains a source error until an explicit reread succeeds',async()=>{
    readers.history.mockRejectedValueOnce(new Error('原始回执缺失')).mockResolvedValueOnce(result())
    const {host}=await mount();await click(host)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('原始回执缺失');expect(readers.history).toHaveBeenCalledTimes(1)
    await click(host);expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.textContent).toContain('原图1')
    expect(readers.history).toHaveBeenCalledTimes(2);expect(fetch).not.toHaveBeenCalled()
  })
})
