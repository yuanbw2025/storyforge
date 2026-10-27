import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react'
import * as api from '../../lib/ttrpg/open-audio-service'
import type { TtrpgOpenVoiceScriptReviewV1 } from '../../lib/ttrpg/open-voice-script-service'
import type { TtrpgOpenVoiceReadingReviewV1 } from '../../lib/ttrpg/open-voice-reading-service'
import type { TtrpgOpenVoicePronunciationV1 } from '../../lib/ttrpg/open-voice-reading-contract'
import type { TtrpgOpenVoiceCandidateV1 } from '../../lib/ttrpg/open-voice-candidate'
import type { TtrpgOpenVoiceAuditionV1 } from '../../lib/ttrpg/open-voice-audition'
import TtrpgOpenVoiceAuditionPlayer from './TtrpgOpenVoiceAuditionPlayer'
import TtrpgOpenGeneratedVoiceAdoption from './TtrpgOpenGeneratedVoiceAdoption'
import { readTtrpgNarratorVoiceV1, TTRPG_NARRATOR_VOICES_V1, useTtrpgNarratorVoiceV1, type TtrpgNarratorVoiceV1 } from '../../lib/ttrpg/narration-listening-preferences'
import { currentTtrpgOpenVoiceProductProfileV1, ttrpgOpenOriginalVoiceLabelV1 } from '../../lib/ttrpg/open-voice-product-profile'
import { probeTtrpgOpenLocalVoiceProfileV1 } from '../../lib/ttrpg/open-local-voice-transport'

type Desk=Awaited<ReturnType<typeof api.readTtrpgOpenVoiceRequestDeskV1>>
type QualityReview=Awaited<ReturnType<typeof api.readTtrpgOpenVoiceCandidateReviewV1>>
type Rejection=Awaited<ReturnType<typeof api.readTtrpgOpenVoiceCandidateRejectionV1>>
type Generation={controller:AbortController;key:string;phase:'checking'|'reserving'|'preparing'|'running';stopRequested:boolean;voice:TtrpgNarratorVoiceV1}
const jobLabels:Record<string,string>={'not-found':'本机尚未发现任务','waiting-for-slot':'等待本机资源','launch-recorded':'启动已记账','running':'正在生成','running-observed':'观察到原任务仍在运行','unknown':'结果未知，需核对原任务','generated':'原结果已生成','failed':'原任务失败','cancelled-before-start':'启动前已取消','cancelled-before-spawn':'进程创建前已取消','cancelled-confirmed':'已确认停止','stop-requested-without-job':'已阻止后续启动，未确认进程关闭'}
export default function TtrpgOpenVoiceStudio(props:{input:api.TtrpgOpenAudioDeskInputV1;view:api.TtrpgOpenAudioDeskV1;enabled:boolean;busy:boolean;sequence:number;registerStop:(stop:(()=>void)|null)=>void;onChanged:()=>Promise<void>}) {
  const narratorVoice=useTtrpgNarratorVoiceV1()
  const live=useRef(false),revision=useRef(0),previewEpoch=useRef(0),locked=useRef(false),stopLocked=useRef(false),previewStop=useRef<()=>void>(()=>undefined)
  const life=useRef<{url:string;dispose:()=>void}|null>(null),generation=useRef<Generation|null>(null)
  const previewAbort=useRef<AbortController|null>(null)
  const [desk,setDesk]=useState<Desk|null>(null),[selected,setSelected]=useState(''),[message,setMessage]=useState(''),[working,setWorking]=useState(false),[sending,setSending]=useState(false),[stopping,setStopping]=useState(false)
  const [cause,setCause]=useState(''),[audience,setAudience]=useState<'party'|'private'|'gm-only'>('party'),[actor,setActor]=useState('')
  const [source,setSource]=useState<TtrpgOpenVoiceScriptReviewV1|null>(null),[part,setPart]=useState<{textOffset:number;textLength:number}|null>(null),[overrides,setOverrides]=useState<TtrpgOpenVoicePronunciationV1[]>([])
  const [reading,setReading]=useState<TtrpgOpenVoiceReadingReviewV1|null>(null),[agreed,setAgreed]=useState(false),[spoken,setSpoken]=useState('')
  const originalBox=useRef<HTMLTextAreaElement|null>(null),partBox=useRef<HTMLTextAreaElement|null>(null)
  const [candidate,setCandidate]=useState<TtrpgOpenVoiceCandidateV1|null>(null),[job,setJob]=useState(''),[audition,setAudition]=useState<{value:TtrpgOpenVoiceAuditionV1;url:string}|null>(null)
  const [quality,setQuality]=useState<QualityReview>(null),[listened,setListened]=useState(false)
  const [rejection,setRejection]=useState<Rejection>(null),[rejectReason,setRejectReason]=useState('')
  const current=useRef(props);current.current=props
  const stop=useCallback(()=>{previewEpoch.current++;previewStop.current();const old=life.current;life.current=null;old?.dispose();if(old)URL.revokeObjectURL(old.url);if(live.current){setAudition(null);setListened(false)}},[])
  const registerPlayer=useCallback((handle:(()=>void)|null)=>{previewStop.current=handle??(()=>undefined)},[])
  const disposeStudio=useCallback(()=>{live.current=false;revision.current++;generation.current?.controller.abort();previewAbort.current?.abort();stop()},[stop])
  const {registerStop}=props
  useLayoutEffect(()=>{live.current=true;registerStop(stop);return()=>{disposeStudio();registerStop(null)}},[registerStop,stop,disposeStudio])
  useLayoutEffect(()=>{if(!props.enabled)stop()},[props.enabled,stop])
  useEffect(()=>{const close=()=>{if(document.hidden)stop()};document.addEventListener('visibilitychange',close);window.addEventListener('pagehide',stop);return()=>{document.removeEventListener('visibilitychange',close);window.removeEventListener('pagehide',stop)}},[stop])
  const refresh=useCallback(async()=>{const token=++revision.current;try{const value=await api.readTtrpgOpenVoiceRequestDeskV1(current.current.input);if(live.current&&revision.current===token)setDesk(value)}catch{if(live.current&&revision.current===token){setDesk(null);stop();setMessage('配音记录暂不可读取，请核对当前身份。')}}},[stop])
  useEffect(()=>{void refresh()},[props.sequence,refresh])
  const row=desk?.requests.find(r=>r.requestKey===selected),busy=working||sending||props.busy
  const clearDraft=()=>{setSource(null);setPart(null);setOverrides([]);setReading(null);setAgreed(false);setSpoken('')}
  const changedPart=(selection:{textOffset:number;textLength:number})=>{setPart(selection);setOverrides([]);setReading(null);setAgreed(false)}
  const partText=part&&source?source.script.text.slice(part.textOffset,part.textOffset+part.textLength):''
  async function perform(job:()=>Promise<void>){if(locked.current||!live.current)return;locked.current=true;setWorking(true);setMessage('');try{await job()}catch(error){if(live.current)setMessage(error instanceof Error&&error.message.startsWith('本机')?error.message:'操作未完成，请读取原记录并核对本机服务与读法；不会自动重新生成。')}finally{if(live.current){locked.current=false;setWorking(false)}}}
  const choose=(key:string)=>{stop();setSelected(key);setCandidate(null);setQuality(null);setRejection(null);setRejectReason('');setJob('');setMessage('')}
  async function preview(){const selectedCause=props.view.causes.find(c=>JSON.stringify(c.sourceRef)===cause);if(!selectedCause)return
    const reviewed=source??await api.prepareTtrpgOpenVoiceScriptV1({...props.input,narrationSourceRef:selectedCause.sourceRef,audience,privateActorKey:audience==='private'?actor:null,decision:'review-original-narration-for-voice'})
    if(!live.current)return
    setSource(reviewed)
    const selection=part??(reviewed.script.text.length<=2000?{textOffset:0,textLength:reviewed.script.text.length}:null)
    if(!selection){setMessage('请在原文中选取本次朗读片段，最多 2000 字符。');return}
    setPart(selection);previewAbort.current?.abort();const controller=new AbortController();previewAbort.current=controller
    const result=await api.previewTtrpgOpenVoiceReadingV1({...props.input,sourceReview:reviewed,part:selection,overrides,decision:'preview-this-original-voice-reading',signal:controller.signal})
    if(live.current&&!controller.signal.aborted){setReading(result);setAgreed(false)}
  }
  async function continueGeneration(operation:Generation){
    operation.phase='preparing';await api.prepareTtrpgOpenLocalVoiceExecutionV1({...props.input,requestKey:operation.key,decision:'prepare-this-confirmed-local-voice-execution',voice:operation.voice})
    if(operation.stopRequested||operation.controller.signal.aborted){await api.stopTtrpgOpenLocalVoiceJobV1({...props.input,requestKey:operation.key,decision:'stop-this-original-local-voice-execution'});return}
    operation.phase='running';await refresh()
    const result=await api.generateTtrpgOpenLocalVoiceV1({...props.input,requestKey:operation.key,decision:'generate-this-original-confirmed-local-voice',signal:operation.controller.signal})
    if(result.result.status==='raw-response-recorded'&&!operation.stopRequested&&!operation.controller.signal.aborted&&live.current){const review=await api.prepareTtrpgOpenVoiceCandidateV1({...props.input,requestKey:operation.key,decision:'review-this-original-local-voice-result'});if(live.current){setCandidate(review.candidate);setQuality(null)}}
    if(live.current&&!operation.stopRequested)setMessage('原任务状态已保存，请核对候选；播放仍须单独准备。')
  }
  async function finishGeneration(operation:Generation){if(generation.current===operation)generation.current=null;if(live.current){setSending(false);setAgreed(false);await refresh();try{await props.onChanged()}catch{if(live.current)setMessage('原记录已保存，桌面尚未刷新，请重新读取。')}}}
  async function generate(){if(!source||!part||!reading||!agreed||generation.current)return
    const operation:Generation={controller:new AbortController(),key:'',phase:'checking',stopRequested:false,voice:readTtrpgNarratorVoiceV1()};generation.current=operation;setSending(true);setMessage('')
    try{
      await probeTtrpgOpenLocalVoiceProfileV1(currentTtrpgOpenVoiceProductProfileV1(operation.voice),operation.controller.signal)
      operation.phase='reserving'
      const reserved=await api.reserveTtrpgOpenVoiceRequestV1({...props.input,review:source,part,submissionKey:`voice.ui.${crypto.randomUUID()}`,readingConfirmation:{review:reading,decision:'confirm-this-exact-local-voice-reading'},decision:'reserve-this-original-voice-part'})
      operation.key=reserved.requestKey
      if(live.current)choose(reserved.requestKey)
      if(operation.controller.signal.aborted){await api.cancelTtrpgOpenVoiceRequestV1({...props.input,requestKey:operation.key,decision:'cancel-this-unsent-voice-request'});return}
      await continueGeneration(operation)
    }catch{if(live.current&&!operation.stopRequested)setMessage(operation.phase==='checking'?'所选声线的本机生成器尚未就绪，请先准备本机配音服务，或继续文字游玩。本次未预留配音任务。':'生成已结束等待或结果未知，请核对原记录；不会自动重发。')}
    finally{await finishGeneration(operation)}
  }
  async function generateExisting(){if(generation.current||locked.current||!selected||!live.current)return
    const operation:Generation={controller:new AbortController(),key:selected,phase:'preparing',stopRequested:false,voice:readTtrpgNarratorVoiceV1()};generation.current=operation;setSending(true);setMessage('')
    try{await continueGeneration(operation)}catch{if(live.current&&!operation.stopRequested)setMessage('原生成已结束等待或结果未知，请读取原任务，不会自动重发。')}finally{await finishGeneration(operation)}
  }
  async function requestStop(){const operation=generation.current,key=operation?.key||selected;if(!key&&!operation)return
    if(stopLocked.current)return
    if(operation){operation.stopRequested=true;if(operation.phase!=='running'){operation.controller.abort();setMessage('正在停止本次准备，原记录会保留。');return}}
    stopLocked.current=true;setStopping(true);stop();try{const result=await api.stopTtrpgOpenLocalVoiceJobV1({...props.input,requestKey:key,decision:'stop-this-original-local-voice-execution'});if(live.current){setJob(jobLabels[result.backend.status]??'原任务需要核对');setMessage(result.cancellationConfirmed?'原任务已确认停止。':'已请求停止，请核对是否实际关闭。')}}catch{if(live.current)setMessage('停止结果尚需核对，请保留原任务。')}finally{operation?.controller.abort();stopLocked.current=false;if(live.current){setStopping(false);await refresh()}}}
  async function prepareAudition(){if(!candidate||!props.enabled)return;stop();const token=previewEpoch.current
    const value=await api.prepareTtrpgOpenVoiceAuditionV1({...props.input,requestKey:selected,candidateHash:candidate.candidateHash,decision:'prepare-audition-for-this-original-voice-candidate'})
    if(!live.current||!current.current.enabled||previewEpoch.current!==token)return
    const observer=api.observeTtrpgOpenVoiceAuditionV1(value,()=>{stop();if(live.current)setMessage('本次试听已关闭，请重新核对权限或原记录。')})
    try{await observer.ready;if(!live.current||!current.current.enabled||previewEpoch.current!==token){observer.dispose();return}const url=URL.createObjectURL(value.blob);life.current={url,dispose:observer.dispose};setAudition({value,url})}catch(error){observer.dispose();throw error}
  }
  async function readRejection(){const saved=await api.readTtrpgOpenVoiceCandidateRejectionV1({...props.input,requestKey:selected})
    if(!live.current)return
    if(saved){stop();setRejection(saved);setRejectReason(saved.rejection.reason);setCandidate(null);setQuality(null)}
    else setMessage('未发现原拒绝决定；可继续核对原音频候选。')
    await refresh();return saved
  }
  async function readCandidate(){
    const rejected=await api.readTtrpgOpenVoiceCandidateRejectionV1({...props.input,requestKey:selected})
    if(!live.current)return
    if(rejected){stop();setRejection(rejected);setRejectReason(rejected.rejection.reason);setCandidate(null);setQuality(null);await refresh();return}
    const value=await api.prepareTtrpgOpenVoiceCandidateV1({...props.input,requestKey:selected,decision:'review-this-original-local-voice-result'})
    const saved=await api.readTtrpgOpenVoiceCandidateReviewV1({...props.input,requestKey:selected,candidateHash:value.candidate.candidateHash})
    if(live.current){setCandidate(value.candidate);setQuality(saved);setRejection(null);setListened(false)}await refresh()
  }
  async function confirmQuality(){if(!candidate)return
    stop()
    const saved=await api.acceptTtrpgOpenVoiceCandidateReviewV1({...props.input,requestKey:selected,candidateHash:candidate.candidateHash,
      decision:'accept-this-original-voice-candidate-for-review',listening:'self-reported-original-listening',judgment:'acceptable-to-me'})
    if(live.current){setQuality(saved);setListened(false);setMessage('本人试听确认已保存，原生成任务已核验完成；尚未加入本局音轨。');await refresh();await props.onChanged()}
  }
  async function rejectQuality(){const candidateHash=rejection?.rejection.candidateHash??candidate?.candidateHash;if(!candidateHash)return
    stop()
    const saved=await api.rejectTtrpgOpenVoiceCandidateReviewV1({...props.input,requestKey:selected,candidateHash,
      decision:'reject-this-original-voice-candidate-for-session-use',listening:'self-reported-original-listening',judgment:'not-acceptable-to-me',reason:rejection?.rejection.reason??rejectReason})
    if(live.current){setRejection(saved);setRejectReason(saved?.rejection.reason??rejectReason);setCandidate(null);setQuality(null);setListened(false)
      setMessage(saved?.complete?'本人拒绝已保存，原音频保留，未加入音轨。':'原拒绝决定已保存，请读取并补齐原回执。');await refresh();await props.onChanged()}
  }
  const reviewCandidateHash=rejection?.rejection.candidateHash??candidate?.candidateHash??quality?.review.candidateHash
  const rejectionInterrupted=!!rejection&&!rejection.complete&&['failed','cancelled','completed','recovery_required'].includes(rejection.runState)
  const rejectionPaused=!!rejection&&['paused','recovering'].includes(rejection.runState)
  async function resumeReview(){if(!reviewCandidateHash)return;stop()
    await api.resumeTtrpgOpenVoiceCandidateReviewV1({...props.input,requestKey:selected,candidateHash:reviewCandidateHash,decision:'resume-this-original-voice-review-without-inference'})
    if(live.current){await readCandidate();setMessage('原审阅已恢复，不会重新生成或自动确认听感。')}
  }
  return <details data-testid="ttrpg-open-voice-studio"><summary>免费本机配音</summary>
    <p>选择已确认叙述，核对读法后生成。新任务声线：{TTRPG_NARRATOR_VOICES_V1.find(v=>v.id===narratorVoice)?.label}。已准备的任务保留原声线；读取、刷新和试听均不重复生成。</p>{message&&<p role="status">{message}</p>}
    <button disabled={busy||!props.view.canPlay} onClick={()=>void perform(async()=>{
      await probeTtrpgOpenLocalVoiceProfileV1(currentTtrpgOpenVoiceProductProfileV1(narratorVoice))
      if(live.current)setMessage('所选声线已就绪。检查没有生成配音；选择原文并确认读法后才能开始。')
    })}>检查所选声线</button>
    <aside aria-label="本机配音准备说明"><p><strong>本机配音准备说明</strong></p>
      <p>免费配音需要当前电脑已安装语音运行库。沉稳男声和柔和女声使用 Qwen；当前本机合成支持 Apple 芯片的 Mac。普通网页和未配置运行库的电脑可先试听示例或导入已有音频。</p>
      <p>先在开局或音频设置里试听、选择声线和语速，再检查所选声线。生成后需试听、确认使用范围并加入本局音轨。生成失败时保留原任务，请先核对状态；文字游玩可继续。</p>
    </aside>
    <fieldset disabled={busy||!props.view.canPlay}><legend>从原文准备配音</legend>
      <label>配音原文<select aria-label="配音原文" value={cause} onChange={e=>{clearDraft();setCause(e.target.value)}}><option value="">选择已完成的叙述</option>{props.view.causes.map(c=><option key={JSON.stringify(c.sourceRef)} value={JSON.stringify(c.sourceRef)}>{c.text.slice(0,60)}</option>)}</select></label>
      <label>配音范围<select aria-label="配音范围" value={audience} onChange={e=>{clearDraft();setAudience(e.target.value as typeof audience)}}><option value="party">本次全队</option>{props.view.privateControlAllowed&&<><option value="private">指定角色</option><option value="gm-only">仅主持</option></>}</select></label>
      {audience==='private'&&<label>接收角色<select aria-label="配音接收角色" value={actor} onChange={e=>{clearDraft();setActor(e.target.value)}}><option value="">选择角色</option>{props.view.players.map(p=><option key={p.actorKey} value={p.actorKey}>{p.name}</option>)}</select></label>}
      {source&&<><textarea ref={originalBox} readOnly aria-label="配音完整原文" value={source.script.text}/><button onClick={()=>{const box=originalBox.current;if(box&&box.selectionEnd>box.selectionStart)changedPart({textOffset:box.selectionStart,textLength:box.selectionEnd-box.selectionStart})}}>使用选中的原文片段</button></>}
      {partText&&<><p>本次片段长度：{partText.length}/2000</p><textarea ref={partBox} readOnly aria-label="本次朗读片段" value={partText}/>
        <label>选中文字的读法<input aria-label="选中文字的读法" value={spoken} maxLength={4000} onChange={e=>setSpoken(e.target.value)}/></label><button disabled={!spoken.trim()} onClick={()=>{const box=partBox.current;if(!box||box.selectionEnd<=box.selectionStart)return;setOverrides(old=>[...old,{textOffset:box.selectionStart,textLength:box.selectionEnd-box.selectionStart,spokenText:spoken}].sort((a,b)=>a.textOffset-b.textOffset));setSpoken('');setReading(null);setAgreed(false)}}>添加这处读法</button>
        {overrides.map((o,i)=><p key={i}>{partText.slice(o.textOffset,o.textOffset+o.textLength)} → {o.spokenText}<button onClick={()=>{setOverrides(rows=>rows.filter((_,n)=>n!==i));setReading(null);setAgreed(false)}}>移除此处读法</button></p>)}</>}
      <button disabled={!cause||audience==='private'&&!actor||!!part&&part.textLength>2000} onClick={()=>void perform(preview)}>预览本机读法</button>
      {reading&&<><p aria-label="本机归一读法">{reading.preview.normalizedText??reading.preview.readingText}</p>{reading.preview.issues.map((issue,i)=><p key={i}>请补充读法：{reading.preview.readingText.slice(issue.textOffset,issue.textOffset+issue.textLength)}</p>)}
        <p>接收者：{source?.script.scope.recipients.map(r=>r.role==='gm'?'主持':props.view.players.find(p=>p.actorKey===r.actorKey)?.name??'原接收角色').join('、')}</p>
        <label><input type="checkbox" aria-label="确认原文读法与范围" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>我已核对原文、读法与接收范围。</label><button disabled={!agreed||reading.preview.status!=='ready-for-reading-review'} onClick={()=>void generate()}>确认并生成本机配音</button></>}
    </fieldset>
    {desk?.budget&&<p>本轮已预留 {desk.budget.requests}/3 次、{desk.budget.characters}/6000 字符；取消不返还预留。</p>}
    <button disabled={working} onClick={()=>void refresh()}>读取配音记录</button>
    <select aria-label="原配音记录" value={selected} disabled={sending||working} onChange={e=>choose(e.target.value)}><option value="">选择原记录</option>{desk?.requests.map(r=><option key={r.requestKey} value={r.requestKey}>{r.script.text.slice(r.part.textOffset,r.part.textOffset+r.part.textLength).slice(0,50)} · {r.status==='history-only'?'历史':r.status==='cancelled-before-send'?'已取消':r.execution?.dispatchRecorded?'已记账派发':'尚未派发'}</option>)}</select>
    {row&&<section><p className="sf-open-audio-caption">{row.script.text.slice(row.part.textOffset,row.part.textOffset+row.part.textLength)}</p>{row.reading&&<p>原确认读法：{row.reading.normalizedText}</p>}
      {row.status==='history-only'?<p>此记录仅供历史核对，不能恢复执行权。</p>:row.status!=='cancelled-before-send'&&<div className="sf-open-audio-actions">
        {!row.intentComplete&&<button disabled={busy} onClick={()=>void perform(async()=>{await api.recoverTtrpgOpenVoiceIntentV1({...props.input,requestKey:selected,decision:'verify-original-voice-intent-only'});await refresh()})}>恢复预留回执</button>}
        {!row.execution&&<button disabled={busy} onClick={()=>void perform(async()=>{await api.cancelTtrpgOpenVoiceRequestV1({...props.input,requestKey:selected,decision:'cancel-this-unsent-voice-request'});await refresh()})}>取消未发送片段</button>}
        {!row.execution?.dispatchRecorded&&row.reading&&<button disabled={busy||!row.intentComplete} onClick={()=>void perform(async()=>{await api.prepareTtrpgOpenLocalVoiceExecutionV1({...props.input,requestKey:selected,decision:'prepare-this-confirmed-local-voice-execution',voice:readTtrpgNarratorVoiceV1()});await refresh()})}>准备原本机任务</button>}
        {row.execution&&!row.execution.dispatchRecorded&&row.reading&&<button disabled={busy} onClick={()=>void generateExisting()}>生成原已确认片段</button>}
        {row.execution&&<><button disabled={stopping} onClick={()=>void requestStop()}>停止原本机任务</button><button disabled={working} onClick={()=>void perform(async()=>{const result=await api.readTtrpgOpenLocalVoiceJobV1({...props.input,requestKey:selected});if(live.current)setJob(jobLabels[result.backend.status]??'原状态需要核对')})}>核对原本机任务</button></>}
        {row.execution?.dispatchRecorded&&<><button disabled={busy} onClick={()=>void perform(async()=>{await api.recoverTtrpgOpenLocalVoiceRawV1({...props.input,requestKey:selected,decision:'recover-this-original-local-voice-raw-without-resending'});await refresh()})}>取回原始结果</button><button disabled={busy||!row.execution?.rawResponseEvidenceRecorded} onClick={()=>void perform(readCandidate)}>核对原音频候选</button></>}
        {row.execution?.rawResponseEvidenceRecorded&&<button disabled={busy} onClick={()=>void perform(async()=>{await readRejection()})}>读取拒绝决定</button>}
        {row.execution&&['paused','recovering'].includes(row.execution.runState)&&<button disabled={busy||!props.view.canPlay||!reviewCandidateHash} onClick={()=>void perform(resumeReview)}>继续原审阅</button>}
      </div>}{job&&<p role="status">{job}</p>}</section>}
    {(sending||generation.current)&&<button disabled={stopping} onClick={()=>void requestStop()}>停止本次生成</button>}
    {candidate&&<section data-testid="ttrpg-voice-candidate"><h4>{candidate.artifact.status==='blocked'?'原结果需要处理':quality?.complete?'本人审阅已保存':quality?'原审阅回执待补齐':'原音频候选待试听'}</h4><p>本条候选声线：{ttrpgOpenOriginalVoiceLabelV1(candidate.artifact.requestEvidence.model)}</p>{candidate.artifact.issues.map(issue=><p key={issue.code}>{issue.message}</p>)}
      <p>{quality?'本人审阅已保留，尚未加入本局音轨。':'尚未确认听感，也未加入本局音轨。'}</p><button disabled={busy||!props.enabled||candidate.artifact.status==='blocked'} onClick={()=>void perform(prepareAudition)}>准备这条候选试听</button>{!props.enabled&&<p>请先开启本机音频，再准备试听。</p>}
      {!quality&&!rejection&&candidate.artifact.status!=='blocked'&&<><p>适合本桌时保存试听确认；不适合时填写原因并拒绝。</p><label><input type="checkbox" aria-label="确认这条原音频的本人试听结果" disabled={busy||!audition} checked={listened} onChange={e=>setListened(e.target.checked)}/>我已亲自试听这条原音频，将保存下方选择的审阅结果。</label><button disabled={busy||!audition||!listened} onClick={()=>void perform(confirmQuality)}>保存本人试听确认</button>
        <label>拒绝原因<textarea aria-label="配音拒绝原因" value={rejectReason} maxLength={2000} disabled={busy} onChange={e=>setRejectReason(e.target.value)}/></label>
        <button disabled={busy||!audition||!listened||!rejectReason.trim()} onClick={()=>void perform(rejectQuality)}>拒绝这条配音</button></>}
      {quality&&!quality.complete&&<button disabled={busy} onClick={()=>void perform(confirmQuality)}>补齐原审阅回执</button>}
    </section>}
    {rejection&&<section data-testid="ttrpg-voice-rejection"><h4>{rejection.complete?'原配音已拒绝':rejectionInterrupted?'原拒绝决定需核对':'原拒绝回执待补齐'}</h4><p>{rejection.rejection.reason}</p>
      <p>原音频和决定已保留，未加入音轨。需要新配音时，请重新核对原文与本桌额度。</p>
      {rejectionInterrupted&&<p>任务已有其他终态，请保留原决定并核对记录。</p>}
      {rejectionPaused&&<p>请先继续原审阅，再补齐拒绝记录。</p>}
      {!rejection.complete&&!rejectionInterrupted&&<button disabled={busy||rejectionPaused} onClick={()=>void perform(rejectQuality)}>补齐原拒绝回执</button>}
    </section>}
    {selected&&!rejection&&<TtrpgOpenGeneratedVoiceAdoption key={JSON.stringify([props.input.scope,props.input.sessionId,props.input.viewerKey,selected])}
      input={props.input} requestKey={selected} candidateHash={candidate?.candidateHash} reviewed={!!quality?.complete} canPlay={props.view.canPlay}
      busy={busy} sequence={props.sequence} stopAudition={stop} onChanged={props.onChanged}/>}
    {audition&&<TtrpgOpenVoiceAuditionPlayer audition={audition.value} url={audition.url} register={registerPlayer} onFailure={()=>{stop();setMessage('本次音频无法播放，原候选保留。')}}/>}
  </details>
}
