import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CompositionEvent, type FormEvent } from 'react'
import { CTextarea } from '../shared/CompositionInput'
import { inputAreaLayoutV1, worldviewInputAreaFieldV1 } from '../../lib/input-area-layout'
import type { PendingMasterCandidate, VisibleMasterCandidateDraftV1 } from '../agent/useMasterCopilot'
import { parseWorldviewFieldCandidateDraft, type WorldviewFieldCopilotCandidate, WORLDVIEW_AGENT_FIELDS } from '../../lib/agent/worldview-field-copilot'
import { WORLDVIEW_GENERATABLE_FIELD_SPECS } from '../../lib/registry/field-registry'
import { freezeWorldviewDiffBaselineV2, selectWorldviewDiffDisplaySourceV2, extractWorldviewDiffArtifactValueV2, canonicalDiffSourceJsonV2,
  type DiffSourceBindingV2, type DiffCandidateIdentityV2, type DiffDraftKindV2, type FrozenDiffBaselineV2 } from '../../lib/agent/worldview-diff-display-source'
import { hashCanonicalValue } from '../../lib/agent/run/hash'
import { WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1 } from './worldview-diff.worker'
import WorldviewTextDiff, { worldviewLFMap } from './WorldviewTextDiff'

export interface WorldviewReviewViewV1 {
  version: 'worldview-review-view-v1'; status: 'verified' | 'unknown'; generation: number; sessionKey: string
  projectId: number; worldId: number; workId: number; worldGroupId: number | null; field: string
  eventId: number; conversationId: number; taskId: string; runId: number; runStepId: string; runGeneration: number; skillId: string
}
export interface WorldviewEditorCompositionV1 {version:1;sessionKey:string;candidateEventId:number;compositionActive:boolean;tailPending:boolean}
let nextEditorEpoch=0
export function worldviewEditorSessionKeyV1(viewKey:string,epoch:number){return canonicalDiffSourceJsonV2({viewKey,epoch})}
export function readWorldviewEditorSessionKeyV1(value:unknown):{viewKey:string;epoch:number}|null {
  if(typeof value!=='string'||value.length>20000)return null
  try{const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length!==2
    ||typeof parsed.viewKey!=='string'||!parsed.viewKey.length||parsed.viewKey.length>8192||!Number.isSafeInteger(parsed.epoch)||parsed.epoch<1
    ||worldviewEditorSessionKeyV1(parsed.viewKey,parsed.epoch)!==value)return null;return parsed}catch{return null}
}
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0
export function worldviewReviewSessionKeyV1(view:Omit<WorldviewReviewViewV1,'status'|'generation'|'sessionKey'|'version'>) {try{return canonicalDiffSourceJsonV2(view)}catch{return ''}}
export function isWorldviewReviewViewV1(candidate:PendingMasterCandidate,view?:WorldviewReviewViewV1):view is WorldviewReviewViewV1 {
  if(!view||typeof view.sessionKey!=='string'||!view.sessionKey.length||view.sessionKey.length>8192||view.version!=='worldview-review-view-v1'||view.status!=='verified'||!Number.isSafeInteger(view.generation)||view.generation<1)return false
  const {status:_status,generation:_generation,sessionKey,version:_version,...identity}=view
  if(Object.keys(identity).length!==12||![view.projectId,view.worldId,view.workId,view.eventId,view.conversationId,view.runId].every(positive)
    ||view.worldGroupId!==null&&!positive(view.worldGroupId)||!Number.isSafeInteger(view.runGeneration)||view.runGeneration<1
    ||typeof view.taskId!=='string'||!view.taskId||typeof view.runStepId!=='string'||!view.runStepId||view.skillId!=='world-origin.worldview-field'
    ||!WORLDVIEW_AGENT_FIELDS.includes(view.field as typeof WORLDVIEW_AGENT_FIELDS[number]))return false
  const event=candidate.event,payload=candidate.payload,scope=payload.workspaceScope
  try{if(parseWorldviewFieldCandidateDraft(event.content).field!==view.field)return false}catch{/* A genuinely invalid artifact retains its guarded raw repair route. */}
  if(payload.executionBinding&&payload.executionBinding.skillId!==view.skillId)return false
  return sessionKey===worldviewReviewSessionKeyV1(identity)&&event.kind==='candidate'&&event.id===view.eventId&&event.conversationId===view.conversationId
    &&event.projectId===view.projectId&&event.workId===view.workId&&event.durableRunId===view.runId
    &&scope?.projectId===view.projectId&&scope.worldId===view.worldId&&scope.workId===view.workId
    &&payload.taskId===view.taskId&&payload.runId===view.runId&&payload.runStepId===view.runStepId&&payload.runGeneration===view.runGeneration
    &&payload.skillId===view.skillId&&payload.worldviewField===view.field
}
interface EditSession {
  key:string;kind:DiffDraftKindV2;raw:string;layoutRole:'raw'|'json'|'candidate';frozen:FrozenDiffBaselineV2|null;baselineFailure:string|null;violation:boolean
  revision:number;signature:string;draftObject:VisibleMasterCandidateDraftV1|undefined;issued:{content:string|null;raw:string;kind:DiffDraftKindV2}|null
  compositionActive:boolean;tailPending:boolean;tailDuplicate:string|null;pendingTail:string|null;mounts:number;hasVisible:boolean;discarding:boolean
}
const sessions=new Map<string,EditSession>()
function savedEditorValue(candidate:PendingMasterCandidate,parsed:WorldviewFieldCopilotCandidate|null):string {
  if(!parsed)return candidate.event.content
  if(typeof parsed.value!=='string')return JSON.stringify(parsed.value,null,2)
  try{return extractWorldviewDiffArtifactValueV2(candidate.event.content,parsed.field)}catch{return parsed.value}
}
function sourceBinding(candidate:PendingMasterCandidate,view:WorldviewReviewViewV1,parsed:WorldviewFieldCopilotCandidate|null):DiffSourceBindingV2 {
  const identity:DiffCandidateIdentityV2={scope:{projectId:String(view.projectId),worldId:String(view.worldId),workId:String(view.workId),conversationId:String(view.conversationId)},
    taskId:view.taskId,eventId:view.eventId,field:view.field,runId:String(view.runId),runStepId:view.runStepId,runGeneration:view.runGeneration}
  const textField=WORLDVIEW_GENERATABLE_FIELD_SPECS.find(spec=>spec.field===view.field&&spec.type==='longtext')
  return {identity,payloadField:candidate.payload.worldviewField??'',parserField:parsed?.field??null,admittedTextField:textField?.field??'',
    operation:candidate.payload.worldviewFieldOperation!,baseSnapshot:candidate.payload.baseSnapshot}
}
export default function WorldviewFieldCandidateReview({candidate,busy,visibleDraft,onUpdate,onInvalidEdit,resizableInputs=false,viewBinding,onEditorCompositionStateChange}:{
  candidate:PendingMasterCandidate;busy:boolean;visibleDraft?:VisibleMasterCandidateDraftV1
  onUpdate:(content:string,rawValue:string)=>void;onInvalidEdit?:(rawValue:string,error:string)=>void;resizableInputs?:boolean
  viewBinding?:WorldviewReviewViewV1;onEditorCompositionStateChange?:(state:WorldviewEditorCompositionV1)=>void
}) {
  let parsed:WorldviewFieldCopilotCandidate|null=null
  try{parsed=parseWorldviewFieldCandidateDraft(candidate.event.content)}catch{/* Original raw repair route. */}
  const trusted=isWorldviewReviewViewV1(candidate,viewBinding)
  // Identity consistency keeps the same DOM during the initial owner lookup;
  // only the separate trusted check grants callbacks or precise comparison.
  const consistent=!!viewBinding&&isWorldviewReviewViewV1(candidate,{...viewBinding,status:'verified',generation:1})
  const key=consistent?viewBinding!.sessionKey:`unknown:${candidate.event.id??'missing'}`
  const editorEpoch=useRef(0);if(!editorEpoch.current)editorEpoch.current=++nextEditorEpoch
  const editor=useRef<HTMLTextAreaElement|null>(null),current=useRef<{key:string;trusted:boolean}>({key,trusted});current.current={key,trusted}
  const [,redraw]=useState(0),[mode,setMode]=useState<'compare'|'edit'>(()=>candidate.payload.worldviewFieldOperation==='expand'||candidate.payload.worldviewFieldOperation==='polish'?'compare':'edit')
  const [notice,setNotice]=useState(''),[baselineHash,setBaselineHash]=useState<{key:string;hash:string}|null>(null)
  const selection=useRef<{start:number;end:number;direction:'forward'|'backward'|'none';top:number;left:number}|null>(null)
  const pendingRange=useRef<readonly[number,number]|null>(null),compositionOwner=useRef<EditSession|null>(null)
  const compositionDraftTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const unknown=useRef<EditSession|null>(null)
  let session=consistent?sessions.get(key):undefined
  if(!session&&trusted&&unknown.current?.key===key&&unknown.current.baselineFailure==='review-session-capacity')session=unknown.current
  if(!session) {
    const raw=visibleDraft?.rawValue??savedEditorValue(candidate,parsed)
    session={key,kind:visibleDraft?'unknown':parsed?'field-value':'raw-artifact',raw,layoutRole:!parsed?'raw':typeof parsed.value==='string'?'candidate':'json',
      frozen:null,baselineFailure:null,violation:false,revision:0,signature:'',draftObject:undefined,issued:null,compositionActive:false,tailPending:false,tailDuplicate:null,pendingTail:null,mounts:0,hasVisible:!!visibleDraft,discarding:false}
    if(trusted) {
      // Retain every mounted/unsynchronized session. Only inactive, acknowledged
      // view caches may leave memory; unknown pending drafts never gain a route
      // by eviction. A new mount always starts from its owned frozen artifact.
      if(sessions.size>=64)for(const [id,old]of sessions)if(!old.mounts&&!old.hasVisible&&old.pendingTail===null&&!old.compositionActive&&!old.tailPending&&!old.issued){sessions.delete(id);break}
      if(sessions.size<64){sessions.set(key,session);try{session.frozen=freezeWorldviewDiffBaselineV2(sourceBinding(candidate,viewBinding,parsed))}catch(error){session.baselineFailure=error instanceof Error?error.message:'baseline-unavailable'}}
      else {session.kind='unknown';session.baselineFailure='review-session-capacity';unknown.current=session}
    }else {if(unknown.current?.key===key)session=unknown.current;else unknown.current=session;session.kind='unknown'}
  }
  const activeSession=session
  const hadVisible=session.hasVisible
  if(visibleDraft) {
    if(visibleDraft.status==='discarding')session.discarding=true
    if(session.draftObject!==visibleDraft) {
      // Kind comes from an observed handler in this exact owner session, never
      // from parsing the draft's text. An unobserved/remounted draft is unknown.
      if(!session.issued||session.issued.raw!==visibleDraft.rawValue||session.issued.kind!==session.kind)session.kind='unknown'
      session.draftObject=visibleDraft
    }
    session.raw=visibleDraft.rawValue;session.hasVisible=true
  }else {
    // Original Master removes a visible draft only after its own ack/discard.
    // Observing that removal is stronger than Promise.resolve and also covers
    // a discarding state that React legitimately batched out of the paint.
    if(trusted&&hadVisible){session.issued=null;if(session.kind==='unknown')session.kind=parsed?'field-value':'raw-artifact'}
    if(session.discarding){session.discarding=false;session.issued=null;session.kind=parsed?'field-value':'raw-artifact';session.raw=savedEditorValue(candidate,parsed)}
    session.hasVisible=false;session.draftObject=undefined
    if(!session.compositionActive&&!session.tailPending&&session.pendingTail===null&&(!session.issued||session.issued.content===candidate.event.content))session.raw=session.kind==='raw-artifact'?candidate.event.content:savedEditorValue(candidate,parsed)
  }
  if(session.pendingTail!==null&&!session.compositionActive&&session.tailPending)session.raw=session.pendingTail
  let source:ReturnType<typeof selectWorldviewDiffDisplaySourceV2>|null=null
  if(trusted&&session.frozen&&!session.violation) {
    try{if(canonicalDiffSourceJsonV2(candidate.payload.baseSnapshot)!==session.frozen.snapshot||candidate.payload.worldviewFieldOperation!==session.frozen.operation)session.violation=true}catch{session.violation=true}
    source=selectWorldviewDiffDisplaySourceV2({frozen:session.frozen,binding:sourceBinding(candidate,viewBinding,parsed),candidateContent:candidate.event.content,rightRevision:session.revision,
      legacyParsedValue:typeof parsed?.value==='string'?parsed.value:undefined,
      ...(visibleDraft?{visible:{identity:sourceBinding(candidate,viewBinding,parsed).identity,kind:session.kind,draft:{rawValue:visibleDraft.rawValue,status:visibleDraft.status}}}:{})})
    if(!source.available&&['frozen-baseline-drift','candidate-identity-drift'].includes(source.reason))session.violation=true
  }
  const signature=JSON.stringify([session.raw,candidate.event.content,session.kind])
  if(signature!==session.signature){session.signature=signature;session.revision++}
  if(source?.available)source={...source,rightRevision:session.revision}
  useEffect(()=>{activeSession.mounts++;return()=>{if(compositionDraftTimer.current!==null){clearTimeout(compositionDraftTimer.current);compositionDraftTimer.current=null}activeSession.mounts--;if(activeSession.compositionActive){activeSession.compositionActive=false;activeSession.tailPending=true;activeSession.pendingTail??=activeSession.raw}}},[activeSession])
  useEffect(()=>{
    let active=true
    if(activeSession.frozen)void hashCanonicalValue(activeSession.frozen).then(hash=>{if(active)setBaselineHash({key:activeSession.key,hash})}).catch(()=>{if(active)setNotice('无法准备精确对照；原文和候选保留。')})
    return()=>{active=false}
  },[activeSession])
  const notificationKey=viewBinding?.sessionKey,notificationEvent=viewBinding?.eventId
  const notify=useCallback((target:EditSession)=>{if(trusted&&notificationKey&&notificationEvent!=null&&target.key===notificationKey)onEditorCompositionStateChange?.({version:1,sessionKey:worldviewEditorSessionKeyV1(target.key,editorEpoch.current),candidateEventId:notificationEvent,compositionActive:target.compositionActive,tailPending:target.tailPending})},[trusted,notificationKey,notificationEvent,onEditorCompositionStateChange])
  useLayoutEffect(()=>{notify(activeSession)},[activeSession,notify,viewBinding?.generation])
  const allowed=()=>!busy&&current.current.trusted&&current.current.key===activeSession.key&&activeSession.kind!=='unknown'
  const input=(raw:string)=>{
    const target=compositionOwner.current??activeSession
    if(!compositionOwner.current&&(target.kind==='unknown'||!current.current.trusted||busy))return
    target.raw=raw;target.pendingTail=raw
    if(!allowed()||target!==activeSession){target.compositionActive=false;target.tailPending=true;compositionOwner.current=null;notify(target);redraw(value=>value+1);return}
    if(target.tailDuplicate===raw&&!target.tailPending){target.pendingTail=null;return}
    target.tailDuplicate=null
    let content:string|null=null
    try {
      if(target.kind==='raw-artifact')content=raw
      else {if(!parsed)throw new Error('候选编辑类型未确定。');const value=typeof parsed.value==='string'?raw:JSON.parse(raw);content=JSON.stringify({...parsed,value},null,2)}
      const validated=parseWorldviewFieldCandidateDraft(content)
      if(validated.field!==(candidate.payload.worldviewField??parsed?.field))throw new Error('不能修改候选对应的世界字段。')
    }catch(error){content=null;target.issued={content:null,raw,kind:target.kind};onInvalidEdit?.(raw,error instanceof SyntaxError?`对象 JSON 无效：${error.message}`:error instanceof Error?error.message:String(error))}
    if(content!==null){target.issued={content,raw,kind:target.kind};onUpdate(content,raw)}
    if(target.tailPending){target.tailDuplicate=raw;target.compositionActive=false;target.tailPending=false;compositionOwner.current=null;notify(target)}
    target.pendingTail=null;redraw(value=>value+1)
  }
  const events={
    onCompositionStartCapture:(event:CompositionEvent<HTMLTextAreaElement>)=>{
      if(!allowed())return
      activeSession.compositionActive=true;activeSession.tailPending=true;compositionOwner.current=activeSession;notify(activeSession)
      activeSession.issued={content:null,raw:event.currentTarget.value,kind:activeSession.kind}
      onInvalidEdit?.(event.currentTarget.value,'正在组合输入，请先完成输入或放弃本次修改。');redraw(value=>value+1)
    },
    onCompositionEndCapture:()=>{const target=compositionOwner.current;if(target){target.compositionActive=false;target.tailPending=true;notify(target)}},
    onInputCapture:(event:FormEvent<HTMLTextAreaElement>)=>{
      const target=compositionOwner.current
      if(target){target.raw=event.currentTarget.value;target.pendingTail=target.raw
        const raw=target.raw
        // CTextarea updates its controlled local value in the input bubble.
        // Native dispatch can run microtasks between capture and bubble. Wait
        // for the next task so a parent render cannot restore the old local
        // value before CTextarea reads the actual composition text in bubble.
        // The parent action fence was already set synchronously at start.
        if(compositionDraftTimer.current!==null)clearTimeout(compositionDraftTimer.current)
        compositionDraftTimer.current=setTimeout(()=>{compositionDraftTimer.current=null;if(target===activeSession&&allowed()&&target.compositionActive&&compositionOwner.current===target&&target.pendingTail===raw){target.raw=raw;target.issued={content:null,raw,kind:target.kind};onInvalidEdit?.(raw,'正在组合输入，请先完成输入或放弃本次修改。')}},0)}
    },onChange:(event:React.ChangeEvent<HTMLTextAreaElement>)=>input(event.target.value),
  }
  const remember=()=>{const element=editor.current;if(element)selection.current={start:element.selectionStart,end:element.selectionEnd,direction:element.selectionDirection,top:element.scrollTop,left:element.scrollLeft}}
  const switchMode=(next:'compare'|'edit')=>{if(activeSession.compositionActive||activeSession.tailPending)return;remember();setMode(next)}
  useLayoutEffect(()=>{
    if(mode!=='edit'||activeSession.compositionActive||activeSession.tailPending)return
    const element=editor.current;if(!element)return
    const range=pendingRange.current,previous=selection.current
    if(!range&&!previous)return
    const frame=requestAnimationFrame(()=>{
      if(current.current.key!==activeSession.key||activeSession.compositionActive||activeSession.tailPending)return
      if(range&&activeSession.kind==='field-value') {
        const map=worldviewLFMap(activeSession.raw)
        if(map.domText!==element.value){setNotice('正文显示换行尚未同步，请直接在编辑框定位。');return}
        element.focus({preventScroll:true});element.setSelectionRange(map.rawToDom(range[0],'before'),map.rawToDom(range[1],'after'));pendingRange.current=null
      }else if(previous){element.focus({preventScroll:true});element.setSelectionRange(previous.start,previous.end,previous.direction);element.scrollTop=previous.top;element.scrollLeft=previous.left}
    })
    return()=>cancelAnimationFrame(frame)
  },[mode,activeSession])
  const operation=session.frozen?.operation??candidate.payload.worldviewFieldOperation,comparable=operation==='expand'||operation==='polish'
  const isObject=activeSession.kind==='field-value'&&parsed&&typeof parsed.value!=='string'
  const displayFits=!!source?.available&&source.left.length<=WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1&&source.right.length<=WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1
  const editorVisible=mode==='edit'||!comparable||!source?.available||!displayFits||activeSession.kind==='unknown'
  const readOnly=!trusted||activeSession.kind==='unknown'||visibleDraft?.status==='discarding'
  return <div className="worldview-review-v2" data-review-session={trusted?viewBinding.sessionKey:undefined}>
    {parsed?.temporaryAssumptions?.length?<div className="wv-review-notice"><strong>本轮临时假设（不会随正文自动写入 Canon）</strong><ul>{parsed.temporaryAssumptions.map((item,index)=><li key={index}>{item}</li>)}</ul></div>:null}
    {comparable&&<div className="wv-review-tabs"><button type="button" aria-pressed={!editorVisible} disabled={!source?.available||!displayFits||activeSession.compositionActive||activeSession.tailPending} onClick={()=>switchMode('compare')}>对比</button><button type="button" aria-pressed={editorVisible} disabled={activeSession.compositionActive||activeSession.tailPending} onClick={()=>switchMode('edit')}>编辑候选</button></div>}
    {!trusted&&<p className="wv-review-notice" role="status">候选归属尚未核实，当前只读；草稿已保留。</p>}
    {trusted&&activeSession.baselineFailure==='review-session-capacity'&&<div className="wv-review-notice"><p>同时待处理的候选较多，请先完成或放弃其他编辑；本次保持只读，原串未丢弃。</p>{!visibleDraft&&<button type="button" onClick={()=>{unknown.current=null;redraw(value=>value+1)}}>重新准备对照</button>}</div>}
    {trusted&&activeSession.kind==='unknown'&&activeSession.baselineFailure!=='review-session-capacity'&&<p className="wv-review-notice">当前草稿的编辑来源未确定，请先通过原入口放弃该修改；不会按正文或整份结构猜测写入。</p>}
    {activeSession.violation&&<p className="wv-review-notice">同一候选的冻结原文发生变化，精确对照已停用。</p>}
    {comparable&&(!source?.available||activeSession.violation)&&<p className="wv-review-notice">此候选暂不能精确对照，原文与编辑内容均保留。</p>}
    {source?.available&&!displayFits&&<p className="wv-review-notice">当前内容超过精确对照的显示范围；完整草稿仍保留在编辑框，未截断或改写。</p>}
    {source?.available&&source.legacyBoundaryTrim&&<p className="wv-review-notice">首尾空白将按现有采用规则去除。</p>}
    {operation==='create'&&<p className="wv-review-notice">新建候选正文</p>}
    {operation==='rewrite'&&<p className="wv-review-notice">重写以新版为主；旧版保留供随时回看。</p>}
    {activeSession.kind==='raw-artifact'&&<p className="wv-review-notice">历史候选结构修复：编辑完整字段 artifact，保存确认前不会切换为正文编辑。</p>}
    {isObject&&<p className="wv-review-notice">只编辑当前字段的 value 对象；外层 field 合同由 Harness 保管。</p>}
    <div hidden={!editorVisible} aria-hidden={!editorVisible}>
      <CTextarea key={compositionOwner.current?.key??activeSession.key} ref={editor} inputAreaLayout={inputAreaLayoutV1(resizableInputs,worldviewInputAreaFieldV1(candidate.payload.worldviewField??parsed?.field??''),activeSession.layoutRole)}
        aria-label={`${candidate.payload.label}${activeSession.kind==='raw-artifact'?'候选原始内容':'候选内容'}`} value={activeSession.raw} disabled={busy} readOnly={readOnly}
        aria-invalid={visibleDraft?.status==='blocked'} {...events} className={`min-h-56 w-full resize-y ${isObject||activeSession.kind==='raw-artifact'?'font-mono':''}`}/>
    </div>
    {trusted&&activeSession.kind==='raw-artifact'&&!visibleDraft&&typeof parsed?.value==='string'&&<button type="button" disabled={activeSession.compositionActive||activeSession.tailPending||busy} onClick={()=>{
      if(!allowed()||activeSession.compositionActive||activeSession.tailPending)return
      activeSession.kind='field-value';activeSession.raw=savedEditorValue(candidate,parsed);activeSession.issued=null;selection.current=null;setMode('edit');redraw(value=>value+1)
    }}>修复已确认，编辑正文</button>}
    {comparable&&source?.available&&<p className="wv-review-notice">精确文字对照不是事实校验，仍需作者确认。</p>}
    {source?.available&&!activeSession.violation&&!editorVisible&&baselineHash?.key===key&&<><WorldviewTextDiff left={source.left} right={source.right} identityKey={key} baselineHash={baselineHash.hash} rightRevision={session.revision} sourceKind={activeSession.kind==='raw-artifact'?'raw-artifact':'field-value'}
      onEditRange={activeSession.kind==='field-value'?(start,end)=>{if(activeSession.compositionActive||activeSession.tailPending)return;pendingRange.current=[start,end];setMode('edit')}:undefined}/></>}
    {operation==='rewrite'&&session.frozen&&<details><summary>查看重写前原文</summary><pre style={{whiteSpace:'pre-wrap'}}>{session.frozen.raw}</pre></details>}
    {activeSession.pendingTail!==null&&!activeSession.compositionActive&&compositionOwner.current!==activeSession&&<div className="wv-review-notice"><p>此候选保留了切换时尚未发送的输入尾部，请核实后恢复。</p><button type="button" disabled={!trusted||busy||activeSession.kind==='unknown'} onClick={()=>{
      if(!allowed()||activeSession.pendingTail===null)return
      compositionOwner.current=activeSession;input(activeSession.pendingTail)
    }}>恢复未发送输入</button></div>}
    {notice&&<p className="wv-review-notice" role="status">{notice}</p>}
  </div>
}
