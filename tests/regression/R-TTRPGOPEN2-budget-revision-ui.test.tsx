import{act,createElement}from'react'
import{createRoot,type Root}from'react-dom/client'
import{beforeEach,afterEach,expect,it,vi}from'vitest'
import Panel from '../../src/components/ttrpg/TtrpgOpenProductionBudgetRevision'
const m=vi.hoisted(()=>({inspect:vi.fn(),prepare:vi.fn(),save:vi.fn()}))
vi.mock('../../src/lib/ttrpg/open-production-budget-revision',()=>({inspectTtrpgOpenProductionBudgetRevisionV1:m.inspect,prepareTtrpgOpenProductionBudgetRevisionV1:m.prepare,saveTtrpgOpenProductionBudgetRevisionV1:m.save}))
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let host:HTMLDivElement,root:Root
const view={scope:{projectId:1,worldId:2,workId:3},productionId:4,buildId:5,buildNumber:1,controlEpoch:2,expectedStateRevision:8,briefRevision:1,briefHash:'a'.repeat(64)}
const owner={...view,ledgerHash:'b'.repeat(64),failureHash:'c'.repeat(64)},values={maximumModelCalls:16,maximumInputTokens:384000,maximumOutputTokens:60000}
const inspection={owner,budget:{maximumModelCalls:16,maximumInputTokens:192000,maximumOutputTokens:60000},nextBuildNumber:2}
const proposal={owner,values,brief:{},briefHash:'d'.repeat(64),previewPlan:{tasks:[{taskKey:'ttrpg.open.source-facts',executionMode:'model',budgetReservation:{inputTokens:96000,outputTokens:12000}}]}}
const saved={receipt:{ok:true},details:{production:{id:4,status:'brief-ready'},brief:{revision:2}}}
const props=()=>({view,disabled:false,onBusy:vi.fn(),onSaved:vi.fn()})
beforeEach(()=>{vi.clearAllMocks();m.inspect.mockResolvedValue(inspection);m.prepare.mockResolvedValue(proposal);m.save.mockResolvedValue(saved);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
async function waitForUI(check:()=>unknown){await vi.waitFor(async()=>{await act(async()=>{await Promise.resolve()});check()})}
const input=(label:string)=>host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
const button=(label:string)=>[...host.querySelectorAll('button')].find(e=>e.textContent===label)!
async function render(p=props()){await act(async()=>{root.render(createElement(Panel,p));await Promise.resolve()});await waitForUI(()=>expect(input('输入用量上限（tokens）'),host.textContent+'; inspect calls='+m.inspect.mock.calls.length).toBeTruthy());return p}
async function click(label:string){await act(async()=>{button(label).click();await Promise.resolve();await Promise.resolve()})}
async function edit(value:string){await act(async()=>{const field=input('输入用量上限（tokens）');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));await Promise.resolve()})}
async function prepared(p=props()){await render(p);await edit('384000');await click('核对新预算');await waitForUI(()=>expect(button('保存为新制作方案').disabled).toBe(false));return p}

it('reads old caps, previews separately and saves only the explicit reviewed budget, without starting generation',async()=>{
 const p=await render();expect(input('输入用量上限（tokens）').value).toBe('192000');expect(m.prepare).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();expect(button('保存为新制作方案').disabled).toBe(true)
 await edit('384000');await click('核对新预算');await waitForUI(()=>expect(button('保存为新制作方案').disabled).toBe(false))
 expect(m.prepare).toHaveBeenCalledWith({owner,values});expect(m.save).not.toHaveBeenCalled();expect(host.textContent).toContain('96,000')
 await click('保存为新制作方案');await waitForUI(()=>expect(p.onSaved).toHaveBeenCalledWith(saved))
 expect(m.save).toHaveBeenCalledOnce();expect(m.save.mock.calls[0][0]).toMatchObject({owner,values});expect(host.textContent).toContain('仍需单独确认开始制作')
})
it('does not authorize save after an input edit or invalid integer',async()=>{
 await prepared();await edit('400000');expect(button('保存为新制作方案').disabled).toBe(true)
 await edit('0');expect(button('核对新预算').disabled).toBe(true);await edit('1.5');expect(button('核对新预算').disabled).toBe(true);expect(m.save).not.toHaveBeenCalled()
})
it('clears a previous successful proposal when a fresh preview fails',async()=>{
 await prepared();m.prepare.mockRejectedValueOnce(Error('原方案已变化'));await click('核对新预算');await waitForUI(()=>expect(host.querySelector('[role=alert]')?.textContent).toContain('已变化'))
 expect(button('保存为新制作方案').disabled).toBe(true);expect(m.save).not.toHaveBeenCalled()
})
it('reuses the exact save command after a lost reply, and never automatically retries',async()=>{
 const p=await prepared();m.save.mockRejectedValueOnce(Error('已提交但返回中断'));await click('保存为新制作方案');await waitForUI(()=>expect(host.querySelector('[role=alert]')).toBeTruthy())
 expect(m.save).toHaveBeenCalledOnce();expect(p.onSaved).not.toHaveBeenCalled();const id=m.save.mock.calls[0][0].commandId
 await click('保存为新制作方案');await waitForUI(()=>expect(p.onSaved).toHaveBeenCalledOnce())
 expect(m.save.mock.calls[1][0].commandId).toBe(id);expect(m.prepare).toHaveBeenCalledOnce()
})
it('guards same-tick duplicate save and drops the completion after switching Work',async()=>{
 const p=await prepared();let finish!:(value:unknown)=>void;m.save.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 await act(async()=>{button('保存为新制作方案').click();button('保存为新制作方案').click();await Promise.resolve();await Promise.resolve()});await waitForUI(()=>expect(m.save).toHaveBeenCalledOnce())
 const next={...p,view:{...view,scope:{...view.scope,workId:999}},onBusy:vi.fn(),onSaved:vi.fn()};m.inspect.mockResolvedValue({...inspection,owner:{...owner,...next.view}})
 await act(async()=>{root.render(createElement(Panel,{...next,key:'new'}));await Promise.resolve()});await act(async()=>{finish(saved);await Promise.resolve()})
 expect(p.onSaved).not.toHaveBeenCalled();expect(next.onSaved).not.toHaveBeenCalled();expect(next.onBusy).not.toHaveBeenCalled()
})
it('drops a late old inspection instead of showing its caps in the newly selected Work',async()=>{
 const p=props();let finish!:(value:unknown)=>void;m.inspect.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
 await act(async()=>{root.render(createElement(Panel,{...p,key:'old'}));await Promise.resolve()});await waitForUI(()=>expect(m.inspect).toHaveBeenCalledOnce())
 const next={...p,view:{...view,scope:{...view.scope,workId:999}}};m.inspect.mockResolvedValue({...inspection,owner:{...owner,...next.view},budget:{...inspection.budget,maximumInputTokens:720000}})
 await act(async()=>{root.render(createElement(Panel,{...next,key:'new'}));await Promise.resolve()});await waitForUI(()=>expect(input('输入用量上限（tokens）')?.value).toBe('720000'))
 await act(async()=>{finish(inspection);await Promise.resolve()});expect(input('输入用量上限（tokens）').value).toBe('720000');expect(m.prepare).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled()
})
