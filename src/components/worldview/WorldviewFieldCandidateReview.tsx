import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CompositionEvent, type FormEvent, type UIEvent } from 'react'
import { CTextarea } from '../shared/CompositionInput'
import { inputAreaLayoutV1, worldviewInputAreaFieldV1 } from '../../lib/input-area-layout'
import type { PendingMasterCandidate, VisibleMasterCandidateDraftV1 } from '../agent/useMasterCopilot'
import { parseWorldviewFieldCandidateDraft, parseWorldviewFieldCandidateDraftV2, type WorldviewFieldCopilotCandidate, type WorldviewFieldCopilotSnapshot, type WorldviewFieldOperationV1, WORLDVIEW_AGENT_FIELDS } from '../../lib/agent/worldview-field-copilot'
import { WORLDVIEW_GENERATABLE_FIELD_SPECS } from '../../lib/registry/field-registry'
import { freezeWorldviewDiffBaselineV2, selectWorldviewDiffDisplaySourceV2, extractWorldviewDiffArtifactValueV2, canonicalDiffSourceJsonV2,
  type DiffSourceBindingV2, type DiffCandidateIdentityV2, type DiffDraftKindV2, type FrozenDiffBaselineV2 } from '../../lib/agent/worldview-diff-display-source'
import { hashCanonicalValue } from '../../lib/agent/run/hash'
import { WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1 } from './worldview-diff.worker'
import WorldviewTextDiff, { worldviewLFMap } from './WorldviewTextDiff'
import { observeAuthorLengthV1 } from '../../lib/ai/author-length-revision'
import { worldviewTargetTextV2 } from '../../lib/agent/worldview-field-v2-contract'
import { compareWorldviewTextBlocksV1, WORLDVIEW_TEXT_COMPARISON_VERSION_V1, type WorldviewTextBlockStatusV1 } from '../../lib/agent/worldview-text-comparison'

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
function WorldviewFieldCandidateReviewV1({candidate,busy,visibleDraft,onUpdate,onInvalidEdit,resizableInputs=false,viewBinding,onEditorCompositionStateChange}:{
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

// Current main V2 renderer. 054-V2-BRIDGE（DSH-054-V2显示桥授权.json）把同一冻结
// 原文的精确对照接入本渲染器；保守块对照保留为不可比较/拒绝路径的回退。
const STATUS_LABELS: Record<WorldviewTextBlockStatusV1, string> = {
  unchanged: '原块保留',
  'possibly-rewritten': '可能改写',
  removed: '原块未出现',
  added: '新增块',
}

function baselineValue(candidate: PendingMasterCandidate, field: string): unknown {
  const snapshot = candidate.payload.baseSnapshot as { values?: Record<string, unknown> } | null
  return snapshot?.values?.[field] ?? ''
}

function serializeWithValue(candidate: WorldviewFieldCopilotCandidate, value: unknown): string {
  return JSON.stringify({ ...candidate, value }, null, 2)
}

function WorldviewFieldCandidateReviewMainV2({
  candidate,
  busy,
  visibleDraft,
  onUpdate,
  onInvalidEdit,
  resizableInputs = false,
}: {
  candidate: PendingMasterCandidate
  busy: boolean
  visibleDraft?: VisibleMasterCandidateDraftV1
  onUpdate: (content: string, rawValue: string) => void
  onInvalidEdit?: (rawValue: string, error: string) => void
  resizableInputs?: boolean
}) {
  const isV2 = candidate.payload.skillId === 'world-origin.worldview-field.v2'
  const parseDraft = isV2 ? parseWorldviewFieldCandidateDraftV2 : parseWorldviewFieldCandidateDraft
  const [frozenBaseline,setFrozenBaseline] = useState<WorldviewFieldCopilotSnapshot|null>(null)
  const [baselineError,setBaselineError] = useState<string|null>(null)
  useEffect(() => {
    let active = true
    setFrozenBaseline(null);setBaselineError(null)
    if (isV2 && candidate.payload.workspaceScope && candidate.payload.runId != null) {
      void import('../../lib/agent/run/worldview-field-v2-durable').then(module => module.restoreWorldviewFieldMasterV2(
        candidate.payload.workspaceScope!,candidate.payload.runId!)).then(read => {if(active)setFrozenBaseline(read.baseline)})
        .catch(error => {if(active)setBaselineError(error instanceof Error?error.message:'原稿读取失败。')})
    }
    return () => {active=false}
  },[isV2,candidate.payload.runId,candidate.event.id,candidate.payload.workspaceScope])
  const parsed = useMemo(() => {
    try { return parseDraft(candidate.event.content) }
    catch { return null }
  }, [candidate.event.content,parseDraft])
  const savedValue = typeof parsed?.value === 'string' ? parsed.value : JSON.stringify(parsed?.value ?? {}, null, 2)
  const layoutField = worldviewInputAreaFieldV1(parsed?.field ?? candidate.payload.worldviewField ?? '')
  const [localValue, setLocalValue] = useState(savedValue)
  const draftValue = visibleDraft?.rawValue ?? (onInvalidEdit ? savedValue : localValue)
  const [showChangesOnly, setShowChangesOnly] = useState(false)
  const [syncScroll, setSyncScroll] = useState(true)
  const leftRef = useRef<HTMLTextAreaElement | null>(null)
  const rightRef = useRef<HTMLTextAreaElement | null>(null)
  const syncing = useRef(false)
  const composing = useRef(false)

  // 054-V2-BRIDGE（DSH-054-V2显示桥授权.json）：V2 也用同一份冻结原文的精确对照。
  // 基线只取 restoreWorldviewFieldMasterV2 的 values 投影——即采纳比较用的同一原文；
  // 不可比较、缺基线、越界或超长时保持下面的保守卡片，不改解析/草稿/采纳语义。
  const diffIdentity = useMemo<DiffCandidateIdentityV2 | null>(() => {
    if (!parsed) return null
    const scope = candidate.payload.workspaceScope
    if (!scope) return null
    const eventId = candidate.event.id
    if (typeof eventId !== 'number' || !Number.isSafeInteger(eventId)) return null
    const conversationId = candidate.event.conversationId
    const rawPayload: { runId?: unknown; runStepId?: unknown; runGeneration?: unknown } = candidate.payload
    try {
      return {
        scope: {
          projectId: String(scope.projectId), worldId: String(scope.worldId), workId: String(scope.workId),
          ...(conversationId === undefined || conversationId === null ? {} : { conversationId: String(conversationId) }),
        },
        taskId: String(candidate.payload.taskId ?? ''), eventId, field: parsed.field,
        ...(typeof rawPayload.runId === 'number' || typeof rawPayload.runId === 'string' ? { runId: String(rawPayload.runId) } : {}),
        ...(typeof rawPayload.runStepId === 'string' && rawPayload.runStepId ? { runStepId: rawPayload.runStepId } : {}),
        ...(Number.isSafeInteger(rawPayload.runGeneration) ? { runGeneration: Number(rawPayload.runGeneration) } : {}),
      }
    } catch { return null }
  }, [candidate, parsed])
  const diffBinding = useMemo<DiffSourceBindingV2 | null>(() => {
    if (!diffIdentity || !parsed || typeof parsed.value !== 'string') return null
    const admitted = WORLDVIEW_GENERATABLE_FIELD_SPECS.find(spec => spec.field === parsed.field && spec.type === 'longtext')
    if (!admitted) return null
    if (!frozenBaseline || typeof frozenBaseline.values !== 'object' || frozenBaseline.values === null) return null
    const values = frozenBaseline.values as Record<string, unknown>
    if (typeof values[parsed.field] !== 'string') return null
    const operation = candidate.payload.worldviewFieldOperation
    if (operation !== 'create' && operation !== 'rewrite' && operation !== 'expand' && operation !== 'polish') return null
    return { identity: diffIdentity, payloadField: candidate.payload.worldviewField ?? '', parserField: parsed.field, admittedTextField: admitted.field, operation, baseSnapshot: { values } }
  }, [diffIdentity, parsed, frozenBaseline, candidate.payload.worldviewField, candidate.payload.worldviewFieldOperation])
  const diffFrozen = useMemo<FrozenDiffBaselineV2 | null>(() => {
    if (!diffBinding) return null
    try { return freezeWorldviewDiffBaselineV2(diffBinding) } catch { return null }
  }, [diffBinding])
  const [diffRevision, setDiffRevision] = useState(0)
  useEffect(() => { setDiffRevision(value => value + 1) }, [draftValue, candidate.event.content])
  const diffSource = useMemo(() => {
    if (!diffFrozen || !diffBinding) return null
    // 右侧只有在可见草稿（真实 ownership lookup）或未偏离已存 artifact 时才能归因。
    if (!visibleDraft && draftValue !== savedValue) return null
    const draftKind: DiffDraftKindV2 = parsed ? (typeof parsed.value === 'string' ? 'field-value' : 'raw-artifact') : 'unknown'
    try {
      return selectWorldviewDiffDisplaySourceV2({
        frozen: diffFrozen, binding: diffBinding, candidateContent: candidate.event.content, rightRevision: diffRevision,
        ...(visibleDraft ? { visible: { identity: diffBinding.identity, kind: draftKind, draft: { rawValue: visibleDraft.rawValue, status: visibleDraft.status } } } : {}),
      })
    } catch { return null }
  }, [diffFrozen, diffBinding, candidate.event.content, diffRevision, visibleDraft, draftValue, savedValue, parsed])
  const [diffBaselineHash, setDiffBaselineHash] = useState<{ identity: string; hash: string } | null>(null)
  useEffect(() => {
    let active = true
    if (!diffFrozen) { setDiffBaselineHash(null); return () => { active = false } }
    void hashCanonicalValue(diffFrozen).then(hash => { if (active) setDiffBaselineHash({ identity: diffFrozen.identity, hash }) }).catch(() => { if (active) setDiffBaselineHash(null) })
    return () => { active = false }
  }, [diffFrozen])

  useEffect(() => {
    setLocalValue(savedValue)
  }, [candidate.event.id, savedValue])

  const edit = (raw: string) => {
    setLocalValue(raw)
    let content: string
    try {
      const value = parsed && typeof parsed.value !== 'string' ? JSON.parse(raw) : raw
      content = parsed ? serializeWithValue(parsed, value) : raw
      const validated = parseDraft(content)
      const field = parsed?.field ?? candidate.payload.worldviewField
      if (field && validated.field !== field) throw new Error('不能修改候选对应的世界字段。')
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      onInvalidEdit?.(raw, cause instanceof SyntaxError ? `对象 JSON 无效：${detail}` : detail)
      return
    }
    onUpdate(content, raw)
  }

  const compositionError = '正在组合输入，请先完成输入或放弃本次修改。'
  const editEvents = {
    onCompositionStartCapture: (event: CompositionEvent<HTMLTextAreaElement>) => {
      composing.current = true
      onInvalidEdit?.(event.currentTarget.value, compositionError)
    },
    onCompositionEndCapture: () => { composing.current = false },
    onInputCapture: (event: FormEvent<HTMLTextAreaElement>) => {
      if (composing.current) onInvalidEdit?.(event.currentTarget.value, compositionError)
    },
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => edit(event.target.value),
  }

  let lengthNotice: React.ReactNode = null
  if (isV2 && parsed && frozenBaseline && candidate.payload.worldviewFieldV2) {
    try {
      const value = typeof parsed.value === 'string' ? draftValue : JSON.parse(draftValue)
      const checked = parseDraft(serializeWithValue(parsed,value))
      const measured = observeAuthorLengthV1({plan:candidate.payload.worldviewFieldV2.lengthPlan,
        text:worldviewTargetTextV2(checked.value),representation:'plain-text',candidateKind:'complete-replacement',
        baseline:{text:worldviewTargetTextV2(frozenBaseline.values[checked.field]),representation:'plain-text'}})
      lengthNotice = <p role="status" className="text-xs text-text-secondary">当前全文 {measured.finalWords} 字，净新增 {measured.additionalWords} 字；
        本次计入 {measured.measuredWords} 字（{measured.status === 'automatic' ? '自动参考，不设最高字数' : measured.status === 'within' ? '在作者范围内' : '尚未达到作者范围'}）。</p>
    } catch { lengthNotice = <p role="status" className="text-xs text-warning">编辑中的对象未完成，保留原计数；修正结构后更新。</p> }
  }
  const evidenceNotice = <>{lengthNotice}{baselineError && <p role="alert" className="text-xs text-error">{baselineError}</p>}</>
  if (!parsed) {
    return (
      <div className="space-y-2">
        {evidenceNotice}
        <p className="text-xs text-error">历史候选无法解析为字段 artifact；请修复结构后再采纳。</p>
        <CTextarea
          inputAreaLayout={inputAreaLayoutV1(resizableInputs, layoutField, 'raw')}
          aria-label={`${candidate.payload.label}候选原始内容`}
          value={visibleDraft?.rawValue ?? candidate.event.content}
          disabled={busy}
          aria-invalid={visibleDraft?.status === 'blocked'}
          {...editEvents}
          className="min-h-48 w-full resize-y font-mono text-xs leading-5"
        />
      </div>
    )
  }

  if (typeof parsed.value !== 'string') {
    return (
      <div className="space-y-1">
        {evidenceNotice}
        <p className="text-[10px] text-text-muted">只编辑当前字段的 value 对象；外层 field 合同由 Harness 保管。</p>
        <CTextarea
          aria-label={`${candidate.payload.label}候选内容`}
          inputAreaLayout={inputAreaLayoutV1(resizableInputs, layoutField, 'json')}
          value={draftValue}
          disabled={busy}
          aria-invalid={visibleDraft?.status === 'blocked'}
          {...editEvents}
          className="min-h-48 w-full resize-y font-mono text-xs leading-5"
        />
      </div>
    )
  }

  const original = String((isV2 ? frozenBaseline?.values[parsed.field] : baselineValue(candidate, parsed.field)) ?? '')
  const operation: WorldviewFieldOperationV1 = candidate.payload.worldviewFieldOperation
    ?? (original.trim() ? 'expand' : 'create')
  const comparison = compareWorldviewTextBlocksV1(original, draftValue)
  const rows = showChangesOnly
    ? comparison.rows.filter(row => row.status !== 'unchanged')
    : comparison.rows

  // 精确对照只在冻结来源真实可用且两侧都在转移上限内时挂载；其余一律回到保守卡片。
  const preciseDiff = diffFrozen && diffSource?.available && diffBaselineHash?.identity === diffFrozen.identity
    && diffSource.left.length <= WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1 && diffSource.right.length <= WORLDVIEW_DIFF_MAX_TRANSFER_UNITS_V1
    ? { identity: diffFrozen.identity, left: diffSource.left, right: diffSource.right, hash: diffBaselineHash.hash }
    : null
  const applyDiffRange = (start: number, end: number) => {
    if (composing.current) return
    const element = rightRef.current
    if (!element) return
    const map = worldviewLFMap(draftValue)
    if (map.domText !== element.value) return
    element.focus({ preventScroll: true })
    element.setSelectionRange(map.rawToDom(start, 'before'), map.rawToDom(end, 'after'))
  }

  const sync = (source: 'left' | 'right', event: UIEvent<HTMLTextAreaElement>) => {
    if (!syncScroll || syncing.current) return
    const target = source === 'left' ? rightRef.current : leftRef.current
    if (!target) return
    syncing.current = true
    const current = event.currentTarget
    const denominator = Math.max(1, current.scrollHeight - current.clientHeight)
    target.scrollTop = (current.scrollTop / denominator) * Math.max(0, target.scrollHeight - target.clientHeight)
    requestAnimationFrame(() => { syncing.current = false })
  }
  const editor = (
    <CTextarea
      ref={rightRef}
      inputAreaLayout={inputAreaLayoutV1(resizableInputs, layoutField, 'candidate')}
      aria-label={`${candidate.payload.label}候选内容`}
      value={draftValue}
      disabled={busy}
      onScroll={event => sync('right', event)}
      aria-invalid={visibleDraft?.status === 'blocked'}
      {...editEvents}
      className="min-h-56 w-full resize-y text-xs leading-5"
    />
  )

  return (
    <div className="space-y-3">
      {evidenceNotice}
      {parsed.temporaryAssumptions?.length ? (
        <div className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs">
          <p className="font-medium text-warning">本轮临时假设（不会随正文自动写入 Canon）</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-secondary">
            {parsed.temporaryAssumptions.map(item => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      {operation === 'create' ? (
        <div>
          <p className="mb-1 text-[10px] text-text-muted">新建候选正文</p>
          {editor}
        </div>
      ) : operation === 'rewrite' ? (
        <div className="space-y-2">
          <p className="text-[10px] text-text-muted">重写以新版为主；旧版保留供随时回看。</p>
          {editor}
          <details className="rounded border border-border bg-bg-base px-3 py-2">
            <summary className="cursor-pointer text-xs text-text-secondary">查看重写前原文</summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">{original || '（原字段为空）'}</pre>
          </details>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[10px] text-text-muted">原文（只读）</span>
            <CTextarea
              ref={leftRef}
              inputAreaLayout={inputAreaLayoutV1(resizableInputs, layoutField, 'original')}
              aria-label={`${candidate.payload.label}原文`}
              value={original}
              readOnly
              onScroll={event => sync('left', event)}
              className="min-h-56 w-full resize-y bg-bg-base text-xs leading-5"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-text-muted">{operation === 'polish' ? '润色后' : '扩写后'}（可编辑）</span>
            {editor}
          </label>
        </div>
      )}

      {(operation === 'expand' || operation === 'polish') && (preciseDiff ? (
        <WorldviewTextDiff left={preciseDiff.left} right={preciseDiff.right} identityKey={preciseDiff.identity} baselineHash={preciseDiff.hash}
          rightRevision={diffRevision} sourceKind="field-value" onEditRange={applyDiffRange}/>
      ) : (
        <div className="rounded border border-border bg-bg-base p-3">
          {frozenBaseline && <p role="status" className="mb-2 text-[10px] text-text-muted">此候选暂不能精确对照，已保留保守块对照；原文与草稿均未改写。</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-text-primary">文本块对照</p>
              <p className="text-[10px] text-text-muted">
                这是保守的结构/相似度提示，不是事实校验。算法 {WORLDVIEW_TEXT_COMPARISON_VERSION_V1}
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-text-secondary">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={syncScroll} onChange={event => setSyncScroll(event.target.checked)} />
                同步滚动
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showChangesOnly} onChange={event => setShowChangesOnly(event.target.checked)} />
                只看变化
              </label>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {rows.length ? rows.map(row => (
              <div key={row.id} className="grid grid-cols-1 gap-2 rounded border border-border/70 p-2 lg:grid-cols-2">
                <div>
                  <span className="text-[10px] text-text-muted">{STATUS_LABELS[row.status]}</span>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{row.original || '—'}</p>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted">
                    候选{row.similarity == null ? '' : ` · 相似度 ${Math.round(row.similarity * 100)}%`}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-text-primary">{row.candidate || '—'}</p>
                </div>
              </div>
            )) : <p className="text-xs text-text-muted">没有可显示的变化。</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Recovery boundary: keep main V2 semantics; strict frozen054 identity remains V1-only. */
export default function WorldviewFieldCandidateReview(props: Parameters<typeof WorldviewFieldCandidateReviewV1>[0]) {
  return props.candidate.payload.skillId === 'world-origin.worldview-field.v2'
    ? <WorldviewFieldCandidateReviewMainV2 {...props} />
    : <WorldviewFieldCandidateReviewV1 {...props} />
}
