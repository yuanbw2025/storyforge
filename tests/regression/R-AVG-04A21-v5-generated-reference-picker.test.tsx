import { act } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import GeneratedReferencePicker from '../../src/components/avg/GeneratedReferencePicker'

const readers=vi.hoisted(()=>({list:vi.fn(),prepare1:vi.fn(),prepare2:vi.fn(),preview:vi.fn()}))
vi.mock('../../src/lib/avg/media-generated-reference',()=>({listAvgGeneratedReferenceImagesV1:readers.list,prepareAvgGeneratedReferenceImageV1:readers.prepare1,prepareAvgGeneratedReferenceImageV2:readers.prepare2}))
vi.mock('../../src/components/avg/MediaAssetPreview',()=>({default:(props:{onObserved:()=>void})=>{readers.preview(props);return <button onClick={props.onObserved}>显示受控参考</button>}}))
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
const roots:Root[]=[],scope={projectId:1,worldId:2,workId:3}
// UI reader dispatch and availability controls only. These deliberately inert
// metadata rows do not assert actual producer, byte, adoption or art evidence.
const selected={asset:{assetKey:'controlled',contentHash:'a'.repeat(64)},source:{version:5,choice:{authorReceiptHash:'b'.repeat(64)}}}
beforeEach(()=>{
  vi.resetAllMocks();readers.list.mockResolvedValue({items:[{choiceId:9,name:'受控参考',tooLarge:false}],nextCursor:null})
  readers.prepare2.mockResolvedValue(selected);readers.prepare1.mockResolvedValue({...selected,source:{...selected.source,version:2}})
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Reference picking must stay local')}))
})
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML=''})
function button(host:HTMLElement,text:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent===text);expect(b).not.toBeUndefined();return b!}
async function mount(version:1|2=2){
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
  let action:Promise<void>=Promise.resolve();const onSelect=vi.fn(),onAction=(task:()=>Promise<void>)=>{action=task();return action}
  const render=async(next=version)=>{await act(async()=>root.render(next===2?<GeneratedReferencePicker version={2} scope={scope} disabled={false} visible={true} refreshKey="same" onSelect={onSelect} onAction={onAction}/>:<GeneratedReferencePicker scope={scope} disabled={false} visible={true} refreshKey="same" onSelect={onSelect} onAction={onAction}/>))}
  await render()
  const choose=async(value='9')=>{await act(async()=>{const s=host.querySelector('select')!;s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}))})}
  const click=async(text:string,wait=true)=>{await act(async()=>{const b=button(host,text);expect(b.disabled).toBe(false);b.click();if(wait)await action})}
  return {host,onSelect,render,choose,click}
}
describe('AVG versioned generated reference picker uses exact reader family',()=>{
  it('uses the V2 source reader, retains the returned actual source and requires explicit display then selection',async()=>{
    const s=await mount();await s.choose();await s.click('核验并查看生成图')
    expect(readers.prepare2).toHaveBeenCalledWith({scope,choiceId:9});expect(readers.prepare1).not.toHaveBeenCalled()
    expect(button(s.host,'使用这张生成图作为参考').disabled).toBe(true)
    await s.click('显示受控参考');expect(s.onSelect).toHaveBeenLastCalledWith(null)
    await s.click('使用这张生成图作为参考');expect(s.onSelect).toHaveBeenLastCalledWith(selected)
    expect(readers.preview.mock.calls.at(-1)![0].generatedSource).toEqual(selected.source);expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps a late response from a deselected source out of the display and author selection',async()=>{
    let resolve!:(value:typeof selected)=>void
    readers.prepare2.mockImplementation(()=>new Promise(r=>{resolve=r}))
    const s=await mount();await s.choose();await s.click('核验并查看生成图',false);await s.choose('')
    await act(async()=>resolve(selected));expect(s.host.textContent).not.toContain('显示受控参考')
    expect(s.onSelect).toHaveBeenLastCalledWith(null);expect(fetch).not.toHaveBeenCalled()
  })
  it('clears the prepared selection on protocol change and keeps old callers on the original strict reader',async()=>{
    const s=await mount();await s.choose();await s.click('核验并查看生成图');await s.render(1)
    expect(s.host.textContent).not.toContain('显示受控参考');expect(s.host.querySelector('select')!.value).toBe('')
    await s.choose();await s.click('核验并查看生成图');expect(readers.prepare1).toHaveBeenCalledWith({scope,choiceId:9})
    expect(readers.preview.mock.calls.at(-1)![0].generatedSource.version).toBe(2);expect(fetch).not.toHaveBeenCalled()
  })
})
