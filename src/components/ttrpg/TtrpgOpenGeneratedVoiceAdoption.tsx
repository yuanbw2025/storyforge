import { useCallback,useEffect,useRef,useState } from 'react'
import * as api from '../../lib/ttrpg/open-audio-service'
import { TTRPG_GENERATED_AUDIO_RIGHTS_V1 } from '../../lib/ttrpg/open-generated-audio-contract'

type Adoption=Awaited<ReturnType<typeof api.readTtrpgOpenGeneratedAudioAdoptionV1>>
type Choice=Awaited<ReturnType<typeof api.readTtrpgOpenPreparedGeneratedAudioV1>>['choices'][number]
/** Human rights/file review is separate from listening and generation. Reads
 * can reconcile a committed cue; only an explicit final button adopts it. */
export default function TtrpgOpenGeneratedVoiceAdoption(props:{input:api.TtrpgOpenAudioDeskInputV1;requestKey:string;candidateHash?:string;
  reviewed:boolean;canPlay:boolean;busy:boolean;sequence:number;stopAudition:()=>void;onChanged:()=>Promise<void>}) {
  const live=useRef(false),epoch=useRef<symbol|null>(null),locked=useRef(false),latest=useRef(props);latest.current=props
  const [adopted,setAdopted]=useState<Adoption>(null),[choices,setChoices]=useState<Choice[]>([]),[pending,setPending]=useState<api.TtrpgOpenAudioReviewV1|null>(null)
  const [name,setName]=useState(''),[source,setSource]=useState(''),[license,setLicense]=useState(''),[rights,setRights]=useState(false),[working,setWorking]=useState(false),[message,setMessage]=useState('')
  const reviewedSequence=useRef(props.sequence)
  const refresh=useCallback(async()=>{
    const token=Symbol(),p=latest.current;epoch.current=token
    const result=await api.readTtrpgOpenGeneratedAudioAdoptionV1({...p.input,requestKey:p.requestKey})
    if(live.current&&token===epoch.current){setAdopted(result);setMessage('');if(result){setPending(null);setRights(false)}}
  },[])
  useEffect(()=>{live.current=true;return()=>{live.current=false;epoch.current=null}},[])
  useEffect(()=>{void refresh().catch(()=>{if(live.current)setMessage('采用记录暂不可读取，请核对当前身份。')})},[props.sequence,props.reviewed,props.candidateHash,refresh])
  useEffect(()=>{if(reviewedSequence.current!==props.sequence){reviewedSequence.current=props.sequence;setPending(null);setRights(false)}},[props.sequence])
  const resetPermission=()=>{setPending(null);setRights(false);setMessage('')}
  async function perform(job:()=>Promise<void>){if(locked.current||!live.current)return;locked.current=true;setWorking(true);setMessage('')
    try{await job()}catch{if(live.current){setPending(null);setRights(false);setMessage('本次操作尚未确认，请读取采用记录或重新核对原文件与使用权；不会自动重复加入音轨。')}}
    finally{locked.current=false;if(live.current)setWorking(false)}}
  async function prepare(){const p=latest.current;if(!rights||!p.candidateHash||!p.reviewed)return
    p.stopAudition()
    const result=await api.prepareTtrpgOpenGeneratedAudioV1({...p.input,requestKey:p.requestKey,candidateHash:p.candidateHash,name,source,license,
      rightsDeclaration:TTRPG_GENERATED_AUDIO_RIGHTS_V1,decision:'prepare-this-original-generated-voice-for-session-use'})
    if(!live.current)return
    if(result.status==='already-adopted'){setAdopted(result.adopted);resetPermission()}
    else{setPending(result.review);setMessage('文件已准备，尚未加入音轨。请核对来源、许可和接收范围后确认。')}
  }
  async function readChoices(){const p=latest.current;if(!p.candidateHash)return
    const result=await api.readTtrpgOpenPreparedGeneratedAudioV1({...p.input,requestKey:p.requestKey,candidateHash:p.candidateHash})
    if(live.current){setChoices(result.choices);setAdopted(result.adopted);resetPermission()}}
  async function adoptAudio(){if(!pending||!rights)return;const p=latest.current,review=pending
    p.stopAudition()
    await api.confirmTtrpgOpenAudioReviewV1({...p.input,review,decision:'confirm-this-audio-and-audience'})
    if(!live.current)return
    resetPermission();await refresh();await p.onChanged()
  }
  const busy=working||props.busy
  return <section data-testid="ttrpg-generated-voice-adoption"><h4>{adopted?'已加入本局音轨':'加入本局音轨'}</h4>
    <button disabled={busy} onClick={()=>void perform(refresh)}>读取采用记录</button>
    {message&&<p role="status">{message}</p>}
    {adopted?<><p>{adopted.name}</p><p>来源：{adopted.source}</p><p>许可说明：{adopted.license}</p><p>已保存原配音的音轨记录；播放与静音仍由本机控制。</p></>:props.reviewed&&props.candidateHash?<>
      <p>本人试听确认已保存。加入音轨前，请单独确认使用权与用途；接收范围沿用这条原配音。</p>
      <button disabled={busy} onClick={()=>void perform(readChoices)}>读取已准备文件</button>
      {choices.map(choice=><button key={choice.assetKey+':'+choice.version} disabled={busy} onClick={()=>{setName(choice.name);setSource(choice.source);setLicense(choice.license);resetPermission()}}>重新核对：{choice.name}</button>)}
      <fieldset disabled={busy||!props.canPlay}><legend>本条配音的来源与许可</legend>
        <label>音轨名称<input aria-label="生成配音音轨名称" value={name} onChange={e=>{setName(e.target.value);resetPermission()}}/></label>
        <label>来源说明<textarea aria-label="生成配音来源说明" value={source} onChange={e=>{setSource(e.target.value);resetPermission()}}/></label>
        <label>许可说明<textarea aria-label="生成配音许可说明" value={license} onChange={e=>{setLicense(e.target.value);resetPermission()}}/></label>
        <label><input type="checkbox" aria-label="确认生成配音使用权" checked={rights} onChange={e=>{setRights(e.target.checked);if(!e.target.checked)setPending(null)}}/>我确认有权在原接收范围内使用这条配音，并已核对来源和许可说明。</label>
        <button disabled={!rights||!name.trim()||!source.trim()||!license.trim()} onClick={()=>void perform(prepare)}>核对配音文件与使用范围</button>
        {pending&&<div data-testid="ttrpg-generated-audio-review"><p>音轨：{pending.asset!.name}</p><p>来源：{pending.asset!.source}</p><p>许可说明：{pending.asset!.license}</p><p>接收范围：{pending.recipients.join('、')}</p>
          <button disabled={!rights} onClick={()=>void perform(adoptAudio)}>确认加入本局音轨</button></div>}
      </fieldset>
    </>:<p>请先保存这条原配音的本人试听确认；已有采用结果可直接读取。</p>}
  </section>
}
