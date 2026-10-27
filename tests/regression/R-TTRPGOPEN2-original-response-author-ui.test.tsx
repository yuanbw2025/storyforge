import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import Panel from '../../src/components/ttrpg/TtrpgOpenOriginalResponseHandoff'
const mock=vi.hoisted(()=>({capture:vi.fn(),book:vi.fn(),draft:vi.fn()}))
vi.mock('../../src/lib/product-production/local-request',()=>({captureProductProductionOriginalResponseV1:mock.capture}))
import * as reviewService from '../../src/lib/ttrpg/open-original-response-review-service'
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let host:HTMLDivElement,root:Root
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();vi.spyOn(reviewService,'bookTtrpgOpenOriginalResponseV1').mockImplementation(mock.book);vi.spyOn(reviewService,'readTtrpgOpenOriginalResponseDraftV1').mockImplementation(mock.draft);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
const owner={scope:{projectId:1,worldId:2,workId:3},productionId:4,buildId:5,controlEpoch:0,planHash:'a'.repeat(64),taskKey:'ttrpg.open.source-facts',runId:6,attempt:1}
const source={captureRunId:7,captureReceiptHash:'b'.repeat(64)},booking={...source,blocked:false,blockers:[]}
const captured={runId:7,receiptHash:source.captureReceiptHash,text:'完整原模型回答',usage:{inputTokens:101,outputTokens:11},modelCalls:0,candidateReady:false}
function props(){return {owner,expectedStateRevision:2,value:'',disabled:false,booking:null as typeof booking|null,onBusy:vi.fn(),onBooked:vi.fn(),onDraft:vi.fn()}}
const button=(label:string)=>[...host.querySelectorAll('button')].find(row=>row.textContent===label)!
async function click(label:string){await act(async()=>{button(label).click();await Promise.resolve();await Promise.resolve()})}

it('keeps capture, booking and normalized draft load as three explicit actions with no automatic submit, and guards rapid duplicate capture',async()=>{
 const p=props();mock.capture.mockResolvedValue(captured);mock.book.mockResolvedValue({booking});mock.draft.mockResolvedValue({authorDraftJson:'{"review":false}',originalResponseSource:source})
 await act(async()=>root.render(createElement(Panel,p)))
 await act(async()=>{const b=button('读取并保留完整原回答');b.click();b.click();await Promise.resolve();await Promise.resolve()})
 await act(async()=>{await vi.waitFor(()=>expect(button('核对并记入原用量')).toBeTruthy())})
 expect(p.onBusy.mock.calls).toEqual([[true],[false]]);expect(mock.capture).toHaveBeenCalledOnce();expect(mock.book).not.toHaveBeenCalled();expect(mock.draft).not.toHaveBeenCalled();expect(p.onDraft).not.toHaveBeenCalled()
 expect(button('核对并记入原用量').disabled).toBe(false);await click('核对并记入原用量');await act(async()=>{await vi.waitFor(()=>{expect(host.querySelector('[role=alert]')?.textContent ?? '').toBe('');expect(p.onBooked).toHaveBeenCalledOnce()})})
 expect(mock.book).toHaveBeenCalledWith({owner,source,expectedStateRevision:2,disposition:'use-native-token-usage'});expect(mock.draft).not.toHaveBeenCalled()
 await act(async()=>root.render(createElement(Panel,{...p,booking})));expect(button('将原回答载入修订稿').disabled).toBe(false);await click('将原回答载入修订稿')
 await act(async()=>{await vi.waitFor(()=>expect(p.onDraft).toHaveBeenCalledWith('{"review":false}',source))})
 expect(mock.draft).toHaveBeenCalledWith({owner,source,existingDraft:''});expect(host.textContent).toContain('完整原模型回答')
})

it('requires explicit conservative disposition for missing or unreliable usage and never offers a free completed response',async()=>{
 const p=props();mock.capture.mockResolvedValue({...captured,usage:null});mock.book.mockResolvedValue({booking})
 await act(async()=>root.render(createElement(Panel,p)));await click('读取并保留完整原回答')
 await act(async()=>{await vi.waitFor(()=>expect(button('核对并记入原用量')).toBeTruthy())})
 expect(button('核对并记入原用量').disabled).toBe(true);expect(host.textContent).not.toContain('已确认未计费')
 await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());await click('核对并记入原用量')
 await act(async()=>{await vi.waitFor(()=>{expect(host.querySelector('[role=alert]')?.textContent ?? '').toBe('');expect(mock.book).toHaveBeenCalledOnce()})})
 expect(mock.book.mock.calls[0][0].disposition).toBe('charge-reservation-upper-bound')
})

it('preserves an advanced edit made while loading the old answer instead of allowing a late overwrite',async()=>{
 const p=props();mock.capture.mockResolvedValue(captured);let finish!:(value:unknown)=>void
 mock.draft.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 await act(async()=>root.render(createElement(Panel,{...p,booking})));await click('读取并保留完整原回答')
 await act(async()=>{await vi.waitFor(()=>expect(button('将原回答载入修订稿')).toBeTruthy())});expect(button('将原回答载入修订稿').disabled).toBe(false);await click('将原回答载入修订稿')
 await act(async()=>{await vi.waitFor(()=>{expect(host.querySelector('[role=alert]')?.textContent ?? '').toBe('');expect(mock.draft).toHaveBeenCalledOnce()})})
 await act(async()=>root.render(createElement(Panel,{...p,booking,value:'{"my":"edit"}'})))
 await act(async()=>{finish({authorDraftJson:'{"old":true}',originalResponseSource:source});await Promise.resolve()})
 expect(p.onDraft).not.toHaveBeenCalled();expect(host.textContent).toContain('已保留你的修改')
})

it('drops late capture and draft operations after switching Work and remounting the owner-bound panel',async()=>{
 const p=props();let finish!:(value:unknown)=>void;mock.capture.mockReturnValue(new Promise(resolve=>{finish=resolve}))
 await act(async()=>root.render(createElement(Panel,{...p,key:'old'})));await click('读取并保留完整原回答')
 await act(async()=>{await vi.waitFor(()=>expect(mock.capture).toHaveBeenCalledOnce())})
 const next={...p,owner:{...owner,scope:{...owner.scope,workId:999}},onBooked:vi.fn(),onDraft:vi.fn()}
 await act(async()=>root.render(createElement(Panel,{...next,key:'new'})))
 await act(async()=>{finish(captured);await Promise.resolve()})
 expect(p.onBooked).not.toHaveBeenCalled();expect(next.onBooked).not.toHaveBeenCalled();expect(p.onDraft).not.toHaveBeenCalled();expect(next.onDraft).not.toHaveBeenCalled()
 expect(button('读取并保留完整原回答')).toBeTruthy();expect(host.textContent).not.toContain(captured.text)
})
