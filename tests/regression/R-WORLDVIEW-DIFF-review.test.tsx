import { act, type ReactNode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorldviewFieldCandidateReview, { worldviewReviewSessionKeyV1, worldviewEditorSessionKeyV1, type WorldviewReviewViewV1 } from '../../src/components/worldview/WorldviewFieldCandidateReview'
import WorldviewAgentControls, { acceptWorldviewEditorCompositionV1 } from '../../src/components/worldview/WorldviewAgentControls'
import { worldviewLFMap, validateWorldviewDiffReplyV1, projectWorldviewDiffRowsV1 } from '../../src/components/worldview/WorldviewTextDiff'
import { computeWorldviewDiffJobV1, diffJobBindingV1, WORLDVIEW_DIFF_JOB_V1, type WorldviewDiffJobV1 } from '../../src/components/worldview/worldview-diff.worker'
import { DIFF_BUDGET_V2, diffWorldviewTextExactV2, assertWorldviewDiffExactV2 } from '../../src/lib/agent/worldview-text-diff-v2'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import type { PendingMasterCandidate, VisibleMasterCandidateDraftV1 } from '../../src/components/agent/useMasterCopilot'

vi.mock('../../src/components/shared/PromptRunPanel',()=>({default:()=>null}))
vi.mock('../../src/components/agent/HarnessEvidencePanel',()=>({default:()=>null}))
Reflect.set(globalThis,'IS_REACT_ACT_ENVIRONMENT',true)
const mounted:Array<{host:HTMLDivElement;root:ReturnType<typeof createRoot>}>=[]
let serial=100000
const left='# 星海\r\n原有秩序。\r\n\r\n## 约定\r\n仍须遵守。\r\n'
const right='# 星海\r\n原有秩序。\r\n\r\n> 因果约束：甲因乙果。\r\n\r\n> 势力关联：两方互助。\r\n\r\n> 剧情伏笔：未响的钟。\r\n\r\n## 约定\r\n仍须遵守。\r\n'
class FixtureWorker {
  static jobs:WorldviewDiffJobV1[]=[];static terminated=0
  onmessage:((event:MessageEvent)=>void)|null=null;onerror:((event:Event)=>void)|null=null;onmessageerror:((event:MessageEvent)=>void)|null=null;dead=false
  postMessage(job:WorldviewDiffJobV1){FixtureWorker.jobs.push(job);void computeWorldviewDiffJobV1(job).then(reply=>{if(!this.dead)this.onmessage?.({data:reply} as MessageEvent)})}
  terminate(){this.dead=true;FixtureWorker.terminated++}
}
async function mount(element:ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({host,root});await act(async()=>root.render(element));return {host,root}}
async function settle(predicate:()=>boolean=()=>true){for(let i=0;i<40;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,2))});if(predicate())return}throw new Error('expected focused UI state: '+document.body.textContent?.slice(0,900))}
const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===text)!
async function click(host:HTMLElement,text:string){const target=button(host,text);expect(target,`control ${text}`).toBeTruthy();await act(async()=>target.click())}
async function input(area:HTMLTextAreaElement,raw:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,raw);area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new Event('change',{bubbles:true}))})}
function candidate(value=right,base=left):PendingMasterCandidate {
  const id=++serial
  return {event:{id,projectId:1,workId:3,conversationId:4,durableRunId:5,kind:'candidate',sequence:1,payload:'{}',createdAt:1,content:JSON.stringify({field:'worldStructure',value,temporaryAssumptions:['合成假设']})},
    payload:{version:1,taskId:`task-${id}`,agentId:'world-origin',skillId:'world-origin.worldview-field',label:'世界结构',contextSources:[],worldviewField:'worldStructure',worldviewFieldOperation:'expand',workspaceScope:{projectId:1,worldId:2,workId:3},runId:5,runGeneration:1,runStepId:'field-step',candidateHash:'1'.repeat(64),baseSnapshot:{id:9,ragDocumentId:'fixture',updatedAt:1,serialized:'fixed',values:{worldStructure:base}}}} as PendingMasterCandidate
}
function view(item:PendingMasterCandidate):WorldviewReviewViewV1 {
  const identity={...item.payload.workspaceScope!,worldGroupId:null,field:item.payload.worldviewField!,eventId:item.event.id!,conversationId:item.event.conversationId,taskId:item.payload.taskId,runId:item.payload.runId!,runStepId:item.payload.runStepId!,runGeneration:item.payload.runGeneration!,skillId:item.payload.skillId}
  return {...identity,version:'worldview-review-view-v1',status:'verified',generation:1,sessionKey:worldviewReviewSessionKeyV1(identity)}
}
beforeEach(()=>{FixtureWorker.jobs=[];FixtureWorker.terminated=0;vi.stubGlobal('Worker',FixtureWorker);vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('054 forbids network/model')}))})
afterEach(async()=>{for(const item of mounted.splice(0)){await act(async()=>item.root.unmount());item.host.remove()}vi.unstubAllGlobals();vi.restoreAllMocks()})

describe('054-B fixed core actual Review protocol',()=>{
  it('keeps unchanged context, three middle right additions and neutral left padding without input',async()=>{
    const item=candidate(),snapshot=JSON.stringify(item),update=vi.fn(),invalid=vi.fn()
    const ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update} onInvalidEdit={invalid}/>)
    await settle(()=>ui.host.querySelectorAll('.wv-diff-row-added').length===3)
    expect(ui.host.querySelectorAll('[data-diff-scroller]')).toHaveLength(1)
    expect(ui.host.querySelectorAll('.wv-diff-row-added .wv-diff-left .wv-diff-padding')).toHaveLength(3)
    expect(ui.host.querySelectorAll('.wv-diff-row-unchanged').length).toBeGreaterThanOrEqual(2)
    for(const side of ['left','right'] as const){const raw=side==='left'?left:right;const spans=[...ui.host.querySelectorAll<HTMLElement>(`[data-diff-side="${side}"] [data-raw-start]`)];expect(spans.map(span=>raw.slice(Number(span.dataset.rawStart),Number(span.dataset.rawEnd))).join('')).toBe(raw)}
    expect(ui.host.textContent).toContain('＋ 新增');expect(JSON.stringify(item)).toBe(snapshot)
    await click(ui.host,'下一处');await click(ui.host,'编辑候选');await click(ui.host,'对比')
    expect(update).not.toHaveBeenCalled();expect(invalid).not.toHaveBeenCalled()
  })
  it('retains one existing textarea/ref, LF selection and callback through modes/theme/worker redraw',async()=>{
    const item=candidate(),update=vi.fn(),ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row')&&FixtureWorker.jobs.length>0);const area=ui.host.querySelector('textarea')!
    await click(ui.host,'编辑候选');area.focus();area.setSelectionRange(3,7,'backward');area.scrollTop=17
    await click(ui.host,'对比');await act(async()=>window.dispatchEvent(new Event('themechange')));await click(ui.host,'编辑候选')
    await settle();expect(ui.host.querySelector('textarea')).toBe(area);expect(area.selectionDirection).toBe('backward');expect(area.selectionStart).toBe(3)
    await input(area,'作者正文');expect(update).toHaveBeenCalledExactlyOnceWith(JSON.stringify({field:'worldStructure',value:'作者正文',temporaryAssumptions:['合成假设']},null,2),'作者正文')
  })
  it('marks changed digits with side-specific words as well as inline differences',async()=>{
    const item=candidate('议席每八次退潮轮换。','议席每七次退潮轮换。'),update=vi.fn()
    const ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row-modified'))
    expect(ui.host.querySelector('.wv-diff-left [data-diff-kind="remove"]')?.textContent).toBe('七')
    expect(ui.host.querySelector('.wv-diff-right [data-diff-kind="add"]')?.textContent).toBe('八')
    expect(ui.host.querySelector('.wv-diff-left .wv-diff-decoration')?.textContent).toBe('− 原文有改动')
    expect(ui.host.querySelector('.wv-diff-right .wv-diff-decoration')?.textContent).toBe('＋ 候选有改动')
    expect(update).not.toHaveBeenCalled()
  })
  it('keeps a changed digit inside its original sentence and preserves both raw EOL variants exactly',async()=>{
    const base='# 星海\r\n议席每七次退潮轮换。\r\n\r\n## 约定\r\n仍须遵守。',revised=base.replace('七','八').replace(/\r\n/g,'\n'),item=candidate(revised,base)
    const ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={vi.fn()}/>)
    await settle(()=>!!ui.host.querySelector('[data-diff-kind="remove"]'))
    const digit=[...ui.host.querySelectorAll<HTMLElement>('[data-diff-kind="remove"]')].find(span=>span.textContent==='七')!
    expect(digit.closest('.wv-diff-row')!.querySelector('.wv-diff-left')!.textContent).toContain('议席每七次退潮轮换。')
    expect(digit.closest('.wv-diff-row')!.querySelector('.wv-diff-right')!.textContent).toContain('议席每八次退潮轮换。')
    expect(ui.host.textContent).toContain('包含空白或换行变化')
    for(const side of ['left','right'] as const){const raw=side==='left'?base:revised;expect([...ui.host.querySelectorAll<HTMLElement>(`[data-diff-side="${side}"] [data-raw-start]`)].map(span=>raw.slice(Number(span.dataset.rawStart),Number(span.dataset.rawEnd))).join('')).toBe(raw)}
  })
  it('keeps two same-line navigation anchors and locates the selected second change in the actual editor',async()=>{
    const base='议席每七次退潮，配额70份。\n',revised='议席每八次退潮，配额80份。\n',item=candidate(revised,base),update=vi.fn()
    const ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row-modified'))
    expect(ui.host.querySelectorAll('.wv-diff-row-modified')).toHaveLength(1);expect(ui.host.textContent).toContain('2 处变化')
    await click(ui.host,'下一处');await click(ui.host,'下一处')
    expect(ui.host.querySelector('.wv-diff-right [data-diff-current="true"]')?.textContent).toBe('8')
    await click(ui.host,'在候选中定位');const area=ui.host.querySelector('textarea')!
    await settle(()=>area.selectionStart===revised.indexOf('80'));expect(area.selectionEnd).toBe(revised.indexOf('80')+1);expect(update).not.toHaveBeenCalled()
  })
  it('projects bounded physical context, original block offsets and exact source refs without mutating the core',()=>{
    const prefix=Array.from({length:20},(_,i)=>`保留前文${i}。\r\n`).join(''),suffix=Array.from({length:20},(_,i)=>`保留尾文${i}。\r\n`).join('')
    const base=prefix+'议席每七次退潮，配额70份。\r\n'+suffix,revised=base.replace('七','八').replace('70','80')
    const core=diffWorldviewTextExactV2({left:base,right:revised,segmentation:{kind:'intl-grapheme',version:1,locale:'zh-CN'}}),snapshot=JSON.stringify(core),projection=projectWorldviewDiffRowsV1(core,base,revised)
    expect(projection.limited).toBe(false);expect(JSON.stringify(core)).toBe(snapshot)
    const modified=projection.rows.find(row=>row.kind==='modified')!
    expect(base.slice(...modified.left)).toBe('议席每七次退潮，配额70份。\r\n');expect(revised.slice(...modified.right)).toBe('议席每八次退潮，配额80份。\r\n')
    expect(projection.anchors).toHaveLength(2);expect(new Set(projection.anchors.map(anchor=>anchor.groupId)).size).toBe(1)
    for(const side of ['left','right'] as const){const raw=side==='left'?base:revised;expect(projection.rows.map(row=>raw.slice(...row[side])).join('')).toBe(raw);expect(projection.rows.flatMap(row=>row[side==='left'?'leftRefs':'rightRefs']).map(ref=>raw.slice(...ref.range)).join('')).toBe(raw)}
    const tight={...core,budget:{...core.budget,maxRows:core.rows.length}};assertWorldviewDiffExactV2(base,revised,tight)
    const bounded=projectWorldviewDiffRowsV1(tight,base,revised);expect(bounded.rows.length).toBeLessThanOrEqual(tight.budget.maxRows);expect(bounded.limited).toBe(true)
  })
  it.each(['add','remove'] as const)('retains three %s quote blocks and neutral opposite-side offsets through CRLF changes',direction=>{
    const expanded=right.replace('秩序','议席七次'),short=left.replace('秩序','议席七次')
    const a=direction==='add'?short:expanded,b=(direction==='add'?expanded:short).replace('七','八').replace(/\r\n/g,'\n')
    const core=diffWorldviewTextExactV2({left:a,right:b,segmentation:{kind:'intl-grapheme',version:1,locale:'zh-CN'}}),snapshot=JSON.stringify(core),projection=projectWorldviewDiffRowsV1(core,a,b),side=direction==='add'?'right':'left',other=side==='right'?'left':'right'
    const blocks=projection.rows.filter(row=>row.kind===(direction==='add'?'added':'removed')&&(side==='right'?b:a).slice(...row[side]).trim().startsWith('> '))
    expect(blocks).toHaveLength(3)
    for(const row of blocks){expect(row[other][0]).toBe(row[other][1]);for(const ref of row[side==='left'?'leftRefs':'rightRefs']){expect(core.ops[ref.op].kind).toBe(direction);expect(core.ops[ref.op][other]).toEqual(row[other])}}
    for(const [name,raw]of [['left',a],['right',b]] as const){expect(projection.rows.map(row=>raw.slice(...row[name])).join('')).toBe(raw);expect(projection.rows.flatMap(row=>row[name==='left'?'leftRefs':'rightRefs']).map(ref=>raw.slice(...ref.range)).join('')).toBe(raw)}
    expect(JSON.stringify(core)).toBe(snapshot)
  })
  it('locks a same-id baseline drift while right candidate revisions never refreeze the left',async()=>{
    const item=candidate(),update=vi.fn(),v=view(item),ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} busy={false} onUpdate={update}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row')&&FixtureWorker.jobs.length>0)
    const revised={...item,event:{...item.event,content:JSON.stringify({field:'worldStructure',value:right+'新尾声'})},payload:{...item.payload,candidateHash:'2'.repeat(64)}}
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={revised} viewBinding={v} busy={false} onUpdate={update}/>))
    await settle(()=>FixtureWorker.jobs.length>=2);expect(FixtureWorker.jobs[1].leftRaw).toBe(left)
    const changed={...revised,payload:{...revised.payload,baseSnapshot:{values:{worldStructure:'被替换的原文'}}}}
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={changed} viewBinding={v} busy={false} onUpdate={update}/>))
    expect(ui.host.textContent).toContain('冻结原文发生变化')
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} busy={false} onUpdate={update}/>))
    expect(ui.host.querySelector('[data-diff-scroller]')).toBeNull();expect(update).not.toHaveBeenCalled()
  })
  it.each(['saving','failed'] as const)('keeps a whole raw-artifact route across optimistic valid parse with %s persistence',async status=>{
    let item=candidate();item={...item,event:{...item.event,content:'历史损坏'}}
    const v=view(item),calls=vi.fn(),invalid=vi.fn();const draft:VisibleMasterCandidateDraftV1={rawValue:'',status}
    const ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} busy={false} onUpdate={calls} onInvalidEdit={invalid}/>)
    const area=ui.host.querySelector('textarea')!,raw=JSON.stringify({field:'worldStructure',value:'修复正文'})
    await input(area,raw);expect(calls).toHaveBeenCalledExactlyOnceWith(raw,raw)
    item={...item,event:{...item.event,content:raw}};draft.rawValue=raw
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} visibleDraft={draft} busy={false} onUpdate={calls} onInvalidEdit={invalid}/>))
    expect(ui.host.querySelector('textarea')).toBe(area);expect(area.value).toBe(raw);expect(area.getAttribute('aria-label')).toContain('原始内容')
    const next=JSON.stringify({field:'worldStructure',value:'第二次修复'})
    await input(area,next);expect(calls).toHaveBeenLastCalledWith(next,next)
    expect(JSON.parse(calls.mock.calls[1][0]).value).toBe('第二次修复')
  })
  it('keeps JSON-looking field text literal and an unknown remounted draft read-only without new invalid writes',async()=>{
    const literal='{"field":"worldStructure","value":"这是真正文"}',item=candidate(literal),update=vi.fn(),invalid=vi.fn()
    const ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update} onInvalidEdit={invalid}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row')&&FixtureWorker.jobs.length>0);expect(FixtureWorker.jobs[0].rightRaw).toBe(literal)
    const other=candidate(),draft={rawValue:JSON.stringify({field:'worldStructure',value:'来历未明'}),status:'saving' as const}
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={other} viewBinding={view(other)} visibleDraft={draft} busy={false} onUpdate={update} onInvalidEdit={invalid}/>))
    const area=ui.host.querySelector('textarea')!;expect(area.readOnly).toBe(true);expect(area.value).toBe(draft.rawValue)
    await input(area,'不能猜着写');expect(update).not.toHaveBeenCalled();expect(invalid).not.toHaveBeenCalled()
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={other} viewBinding={view(other)} busy={false} onUpdate={update} onInvalidEdit={invalid}/>))
    expect(ui.host.querySelector('textarea')!.readOnly).toBe(false);expect(update).not.toHaveBeenCalled()
  })
  it('holds the raw editor through acknowledgement and remount, then switches only by explicit safe intent',async()=>{
    let item=candidate();item={...item,event:{...item.event,content:'保存的旧损坏结构'}}
    const v=view(item),update=vi.fn(),raw=JSON.stringify({field:'worldStructure',value:'已修复正文'}),ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} busy={false} onUpdate={update}/>)
    await input(ui.host.querySelector('textarea')!,raw)
    item={...item,event:{...item.event,content:raw}}
    const draft={rawValue:raw,status:'saving' as const}
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} visibleDraft={draft} busy={false} onUpdate={update}/>))
    await act(async()=>ui.root.render(null))
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} visibleDraft={draft} busy={false} onUpdate={update}/>))
    const area=ui.host.querySelector('textarea')!;expect(area.value).toBe(raw);expect(area.getAttribute('aria-label')).toContain('原始内容')
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={item} viewBinding={v} busy={false} onUpdate={update}/>))
    expect(area.value).toBe(raw)
    await click(ui.host,'修复已确认，编辑正文');expect(ui.host.querySelector('textarea')).toBe(area);expect(area.value).toBe('已修复正文');expect(update).toHaveBeenCalledTimes(1)
  })
  it('quarantines an old candidate IME tail, never sends it through the new callback, and explicitly restores it',async()=>{
    const first=candidate(),second=candidate('新候选正文'),oldUpdate=vi.fn(),newUpdate=vi.fn(),invalid=vi.fn(),ui=await mount(<WorldviewFieldCandidateReview candidate={first} viewBinding={view(first)} busy={false} onUpdate={oldUpdate} onInvalidEdit={invalid}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row'));await click(ui.host,'编辑候选')
    const area=ui.host.querySelector('textarea')!
    await act(async()=>area.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
    invalid.mockClear()
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'原候选中间组合');area.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'组合',isComposing:true}));ui.root.render(<WorldviewFieldCandidateReview candidate={second} viewBinding={view(second)} busy={false} onUpdate={newUpdate} onInvalidEdit={invalid}/>)})
    await settle();expect(invalid).not.toHaveBeenCalled()
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'原候选组合尾巴');area.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))})
    expect(newUpdate).not.toHaveBeenCalled();expect(oldUpdate).not.toHaveBeenCalled()
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={first} viewBinding={view(first)} busy={false} onUpdate={oldUpdate} onInvalidEdit={invalid}/>))
    expect(ui.host.querySelector('textarea')!.value).toBe('原候选组合尾巴')
    await click(ui.host,'恢复未发送输入');expect(oldUpdate).toHaveBeenCalledExactlyOnceWith(expect.any(String),'原候选组合尾巴');expect(newUpdate).not.toHaveBeenCalled()
  })
  it('preserves an explicitly empty quarantined IME tail and recovers it through the original invalid-draft route',async()=>{
    const first=candidate(),second=candidate('新候选正文'),update=vi.fn(),invalid=vi.fn(),ui=await mount(<WorldviewFieldCandidateReview candidate={first} viewBinding={view(first)} busy={false} onUpdate={update} onInvalidEdit={invalid}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row'));await click(ui.host,'编辑候选');const area=ui.host.querySelector('textarea')!
    await act(async()=>area.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'');area.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'',isComposing:true}));ui.root.render(<WorldviewFieldCandidateReview candidate={second} viewBinding={view(second)} busy={false} onUpdate={update} onInvalidEdit={invalid}/>)})
    await act(async()=>area.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})))
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={first} viewBinding={view(first)} busy={false} onUpdate={update} onInvalidEdit={invalid}/>))
    expect(ui.host.querySelector('textarea')!.value).toBe('');invalid.mockClear();await click(ui.host,'恢复未发送输入')
    expect(invalid).toHaveBeenCalledWith('',expect.any(String));expect(update).not.toHaveBeenCalled()
  })
  it('renders hostile-looking field text literally without HTML, image, model, or candidate writes',async()=>{
    const item=candidate('<img src="https://invalid.example/pixel" onerror="alert(1)"><script>throw 1</script>'),update=vi.fn(),ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row'))
    expect(ui.host.querySelectorAll('img,script')).toHaveLength(0);expect([...ui.host.querySelectorAll('[data-diff-side="right"] [data-raw-start]')].map(node=>node.textContent).join('')).toContain('<img src=')
    expect(update).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps reordered unique text in its actual removed/added positions with annotation-only navigation',async()=>{
    const item=candidate('丙丙\n甲甲\n乙乙\n丁丁\n','甲甲\n乙乙\n丙丙\n丁丁\n'),update=vi.fn(),ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-move-link'))
    expect(ui.host.querySelector('.wv-diff-remove')).not.toBeNull();expect(ui.host.querySelector('.wv-diff-add')).not.toBeNull()
    await act(async()=>ui.host.querySelector<HTMLButtonElement>('.wv-diff-move-link')!.click());expect(update).not.toHaveBeenCalled()
  })
  it('has no owner bypass when the binding is absent or no longer verified',async()=>{
    const item=candidate(),update=vi.fn(),invalid=vi.fn(),ui=await mount(<WorldviewFieldCandidateReview candidate={item} busy={false} onUpdate={update} onInvalidEdit={invalid}/>)
    expect(ui.host.querySelector('textarea')!.readOnly).toBe(true);await input(ui.host.querySelector('textarea')!,'旧scope输入')
    expect(update).not.toHaveBeenCalled();expect(invalid).not.toHaveBeenCalled();expect(FixtureWorker.jobs).toHaveLength(0)
  })
  it.each([['A\r\n😀\rB','A\n😀\nB'],['\r\r\n','\n\n'],['\ud800X','\ud800X'],['e\u0301👩‍👩‍👧','e\u0301👩‍👩‍👧'],['','']])('maps raw UTF16 to actual LF-domain offsets for %j',(raw,expected)=>{
    const map=worldviewLFMap(raw);expect(map.domText).toBe(expected)
    for(let d=0;d<=expected.length;d++)expect(map.rawToDom(map.domToRaw(d))).toBe(d)
    if(raw==='A\r\n😀\rB'){expect(raw.length).toBe(7);expect(expected.length).toBe(6);expect(map.rawToDom(2,'before')).toBe(1);expect(map.rawToDom(2,'after')).toBe(2);expect(map.domToRaw(2)).toBe(3)}
  })
  it('copies a same-side partial range from raw CRLF and refuses cross-column projection',async()=>{
    const item=candidate(),update=vi.fn(),ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={update}/>)
    await settle(()=>!!ui.host.querySelector('.wv-diff-row-added'))
    const span=ui.host.querySelector<HTMLElement>('.wv-diff-row-added [data-diff-side="right"] [data-raw-start]')!,other=ui.host.querySelector<HTMLElement>('[data-diff-side="left"] [data-raw-start]')!
    await act(async()=>span.dispatchEvent(new Event('pointerdown',{bubbles:true})))
    const selection=window.getSelection()!,range=document.createRange();range.setStart(span.firstChild!,0);range.setEnd(span.firstChild!,span.textContent!.length);selection.removeAllRanges();selection.addRange(range)
    const setData=vi.fn(),event=new Event('copy',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{setData}})
    await act(async()=>span.dispatchEvent(event))
    const from=Number(span.dataset.rawStart),to=Number(span.dataset.rawEnd);expect(setData).toHaveBeenCalledWith('text/plain',right.slice(from,to));expect(setData.mock.calls[0][1]).toContain('\r\n')
    range.setStart(other.firstChild!,0);range.setEnd(span.firstChild!,1);selection.removeAllRanges();selection.addRange(range);setData.mockClear()
    const cross=new Event('copy',{bubbles:true,cancelable:true});Object.defineProperty(cross,'clipboardData',{value:{setData}});await act(async()=>span.dispatchEvent(cross))
    expect(setData).not.toHaveBeenCalled();expect(cross.defaultPrevented).toBe(true);expect(update).not.toHaveBeenCalled()
  })
})

async function job():Promise<WorldviewDiffJobV1>{const profile={kind:'intl-grapheme' as const,version:1 as const,locale:'zh-CN' as const},budget={...DIFF_BUDGET_V2};const value:WorldviewDiffJobV1={version:WORLDVIEW_DIFF_JOB_V1,type:'compare',jobId:1,identityKey:'synthetic-job',baselineHash:'1'.repeat(64),leftHash:await hashCanonicalValue(left),rightRevision:1,rightHash:await hashCanonicalValue(right),leftRaw:left,rightRaw:right,sourceKind:'field-value',profile,budget,profileRequestHash:await hashCanonicalValue(profile),budgetHash:await hashCanonicalValue(budget),inputBindingHash:''};value.inputBindingHash=await hashCanonicalValue(diffJobBindingV1(value));return value}
describe('054-B bounded closed Worker contract',()=>{
  it('validates genuine packets and rejects extra fields, stale binding, broken refs and work budgets',async()=>{
    const input=await job(),reply=await computeWorldviewDiffJobV1(input)
    expect(reply.result.rows.map(row=>row.kind)).toEqual(['unchanged','added','unchanged'])
    await expect(validateWorldviewDiffReplyV1(input,reply)).resolves.toMatchObject({leftLength:left.length,rightLength:right.length})
    await expect(computeWorldviewDiffJobV1({...input,extra:true})).rejects.toThrow()
    await expect(validateWorldviewDiffReplyV1(input,{...reply,rightRevision:2})).rejects.toThrow()
    const malformed=structuredClone(reply);malformed.result.rows[0].leftRefs.push({op:0,range:[0,1]})
    await expect(validateWorldviewDiffReplyV1(input,malformed)).rejects.toThrow()
    await expect(computeWorldviewDiffJobV1({...input,budget:{...input.budget,maxDiffSteps:Infinity}})).rejects.toThrow()
  })
  it('terminates a replaced job and uses an explicit complete fallback when Worker cannot start',async()=>{
    const item=candidate(),ui=await mount(<WorldviewFieldCandidateReview candidate={item} viewBinding={view(item)} busy={false} onUpdate={vi.fn()}/>)
    await settle(()=>FixtureWorker.jobs.length>0)
    const revised={...item,event:{...item.event,content:JSON.stringify({field:'worldStructure',value:'改后'})}}
    await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={revised} viewBinding={view(revised)} busy={false} onUpdate={vi.fn()}/>))
    await settle(()=>FixtureWorker.jobs.length>1);expect(FixtureWorker.terminated).toBeGreaterThan(0)
    vi.stubGlobal('Worker',class{constructor(){throw new Error('unavailable')}})
    const other=candidate();await act(async()=>ui.root.render(<WorldviewFieldCandidateReview candidate={other} viewBinding={view(other)} busy={false} onUpdate={vi.fn()}/>))
    await settle(()=>ui.host.textContent!.includes('后台对照不可用'));expect(ui.host.textContent).toContain('因果约束')
  })
})

async function realParentFixture(){
  const workspace=await seedCurrentWorkspace(`054 owner ${++serial}`),conversation=await getOrCreateAgentConversation({projectId:workspace.scope.projectId,worldGroupId:null,purpose:'master-authoring',scope:workspace.scope})
  const item=candidate();item.event={...item.event,projectId:workspace.scope.projectId,workId:workspace.scope.workId,conversationId:conversation.id!};item.payload={...item.payload,workspaceScope:workspace.scope}
  const update=vi.fn<(id:number,content:string,visible:{rawValue:string;error?:string})=>Promise<void>>(async()=>undefined),discard=vi.fn(async()=>undefined),reject=vi.fn(async()=>undefined),adopt=vi.fn(async()=>undefined)
  const copilot={pendingCandidates:[item],busy:false,loading:false,readVisibleCandidateDraft:()=>undefined,updateCandidate:update,discardVisibleCandidateDraft:discard,rejectCandidate:reject,submitTargetedRequest:vi.fn(),error:null} as any
  return{...workspace,conversation,item,copilot,update,discard,reject,adopt}
}
function parent(f:Awaited<ReturnType<typeof realParentFixture>>,overrides:Record<string,unknown>={}){return <WorldviewAgentControls field="worldStructure" project={f.project} activeGroupId={null} copilot={f.copilot} candidate={f.item} hasOtherPendingCandidates={false} onRunningChange={vi.fn()} onAdopted={f.adopt} {...overrides}/>}
describe('054-B actual parent conversation ownership and immediate IME barrier',()=>{
  it('reads the actual scoped active master conversation, permits the original callback and writes no source row',async()=>{
    const f=await realParentFixture(),before=await db.worldviews.toArray(),ui=await mount(parent(f))
    await settle(()=>!ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!.readOnly)
    await click(ui.host,'编辑候选');await input(ui.host.querySelector('textarea[aria-label="世界结构候选内容"]')!,'父控件输入')
    expect(f.update).toHaveBeenCalledExactlyOnceWith(f.item.event.id,JSON.stringify({field:'worldStructure',value:'父控件输入',temporaryAssumptions:['合成假设']},null,2),{rawValue:'父控件输入'})
    expect(await db.worldviews.toArray()).toEqual(before)
  })
  it.each(['group','purpose','status','work','field'] as const)('holds a real mismatched conversation %s without wrong callbacks',async kind=>{
    const f=await realParentFixture()
    if(kind==='field')f.item.event.content=JSON.stringify({field:'worldOrigin',value:'外字段内容'})
    else await db.agentConversations.update(f.conversation.id!,kind==='group'?{worldGroupId:999}:kind==='purpose'?{purpose:'other'}:kind==='status'?{status:'archived'}:{workId:999999})
    const ui=await mount(parent(f));await settle();const area=ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!
    expect(area.readOnly).toBe(true);await input(area,'不该写');await click(ui.host,'采纳');await click(ui.host,'拒绝')
    expect(f.update).not.toHaveBeenCalled();expect(f.adopt).not.toHaveBeenCalled();expect(f.reject).not.toHaveBeenCalled()
  })
  it('keeps old conversation data readonly while live scope/group changes or lookup fails',async()=>{
    const f=await realParentFixture(),ui=await mount(parent(f));await settle(()=>!!ui.host.querySelector('.wv-diff-row')&&FixtureWorker.jobs.length>0)
    await act(async()=>ui.root.render(parent(f,{project:{...f.project,activeWorldId:f.scope.worldId+123}})))
    const area=ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!;expect(area.readOnly).toBe(true);await input(area,'旧身份尾巴');expect(f.update).not.toHaveBeenCalled()
    vi.spyOn(db.agentConversations,'get').mockRejectedValue(new Error('isolated lookup failure'))
    const failed=await mount(parent(f));await settle()
    const failedArea=failed.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!
    expect(failedArea.readOnly).toBe(true);await input(failedArea,'读失败不得写');expect(f.update).not.toHaveBeenCalled()
  })
  it('ignores a late successful lookup for the previous live group and preserves read-only state',async()=>{
    const f=await realParentFixture(),record=await db.agentConversations.get(f.conversation.id!)
    let release!: (value: typeof record)=>void
    vi.spyOn(db.agentConversations,'get').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}) as any)
    const ui=await mount(parent(f));expect(ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!.readOnly).toBe(true)
    await act(async()=>ui.root.render(parent(f,{project:{...f.project,enableMultiWorld:true},activeGroupId:999})))
    await act(async()=>{release(record);await new Promise(resolve=>setTimeout(resolve,2))})
    expect(ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!.readOnly).toBe(true)
    await click(ui.host,'采纳');expect(f.adopt).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled()
  })
  it('uses the immediate parent ref to block external discard before the composition state render',async()=>{
    const f=await realParentFixture()
    let duringComposition: (()=>void)|undefined, duringTail: (()=>void)|undefined
    function Harness(){
      const [item,setItem]=useState(f.item),[draft,setDraft]=useState<VisibleMasterCandidateDraftV1|undefined>()
      const copilot={...f.copilot,pendingCandidates:[item],readVisibleCandidateDraft:()=>draft,
        updateCandidate:(id:number,content:string,visible:{rawValue:string;error?:string})=>{if(visible.error?.includes('组合输入'))duringComposition?.();else duringTail?.();f.update(id,content,visible);setDraft({rawValue:visible.rawValue,status:visible.error?'blocked':'saving',error:visible.error});if(!visible.error)setItem(old=>({...old,event:{...old.event,content}}));return Promise.resolve()}}
      return parent(f,{candidate:item,copilot})
    }
    const ui=await mount(<Harness/>);await settle(()=>!ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!.readOnly);await click(ui.host,'编辑候选')
    const area=ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!
    await input(area,'先前已知来源的可见草稿')
    const discard=button(ui.host,'放弃未保存修改');expect(discard).toBeTruthy();expect(discard.disabled).toBe(false)
    duringComposition=()=>discard.click() // The original callback runs after the child notification, before React's state render.
    await act(async()=>area.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})))
    duringComposition=undefined;duringTail=()=>discard.click()
    expect(f.discard).not.toHaveBeenCalled();expect(discard.disabled).toBe(true)
    f.update.mockClear();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'父层完整尾巴');area.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))})
    expect(f.update).toHaveBeenCalledTimes(1);expect(f.discard).not.toHaveBeenCalled();expect(discard.disabled).toBe(false);duringTail=undefined
    await click(ui.host,'放弃未保存修改');expect(f.discard).toHaveBeenCalledExactlyOnceWith(f.item.event.id)
  })
  it('rejects stale editor-instance unlocks, foreign sessions and extra composition fields',()=>{
    const live=view(candidate()),current={viewKey:live.sessionKey,epoch:9}
    const value={version:1 as const,sessionKey:worldviewEditorSessionKeyV1(live.sessionKey,9),candidateEventId:live.eventId,compositionActive:true,tailPending:true}
    expect(acceptWorldviewEditorCompositionV1(value,live,current)?.state).toEqual(value)
    expect(acceptWorldviewEditorCompositionV1({...value,sessionKey:worldviewEditorSessionKeyV1(live.sessionKey,8),compositionActive:false,tailPending:false},live,current)).toBeNull()
    expect(acceptWorldviewEditorCompositionV1({...value,sessionKey:worldviewEditorSessionKeyV1('another-live-owner',10)},live,current)).toBeNull()
    expect(acceptWorldviewEditorCompositionV1({...value,extra:true},live,current)).toBeNull()
    expect(acceptWorldviewEditorCompositionV1(value,{...live,status:'unknown'},current)).toBeNull()
  })
  it('blocks parent candidate actions during composition and releases only after the actual tail change',async()=>{
    const f=await realParentFixture(),ui=await mount(parent(f));await settle(()=>!ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!.readOnly);await click(ui.host,'编辑候选')
    const area=ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="世界结构候选内容"]')!
    await act(async()=>{area.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));button(ui.host,'采纳').click();button(ui.host,'拒绝').click()})
    expect(f.adopt).not.toHaveBeenCalled();expect(f.reject).not.toHaveBeenCalled();expect(button(ui.host,'编辑候选').disabled).toBe(true)
    f.update.mockClear();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'组合尾巴');area.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))})
    expect(f.update).toHaveBeenCalledExactlyOnceWith(f.item.event.id,expect.any(String),{rawValue:'组合尾巴'});expect(button(ui.host,'编辑候选').disabled).toBe(false)
  })
})
