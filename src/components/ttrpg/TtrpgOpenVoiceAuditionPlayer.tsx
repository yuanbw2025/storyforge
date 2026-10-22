import { useLayoutEffect,useRef,useState } from 'react'
import type { TtrpgOpenVoiceAuditionV1 } from '../../lib/ttrpg/open-voice-audition'
import { ttrpgOpenVoiceReadingPositionV1 } from '../../lib/ttrpg/open-voice-timeline-contract'
import { applyTtrpgNarrationRateV1,useTtrpgNarrationRateV1 } from '../../lib/ttrpg/narration-listening-preferences'

/** A private draft preview, not an accepted E16 track or word alignment. */
export default function TtrpgOpenVoiceAuditionPlayer(props: { audition: TtrpgOpenVoiceAuditionV1; url: string; register: (stop: (()=>void)|null)=>void; onFailure: ()=>void }) {
  const node=useRef<HTMLAudioElement|null>(null),[position,setPosition]=useState({active:-1,previous:-1,next:0})
  const {sourceText,generatedTimeline}=props.audition
  const {clock:timeline,normalizedText:readingText}=generatedTimeline
  const {originalPart}=timeline,{active}=position
  const {url,register}=props
  const narrationRate=useTtrpgNarrationRateV1()
  useLayoutEffect(()=>{
    const element=node.current
    if(!element)return
    element.src=url;element.muted=false
    const stop=()=>{element.muted=true;element.pause();element.removeAttribute('src');element.load()}
    register(stop)
    return()=>{stop();register(null)}
  },[url,register])
  useLayoutEffect(()=>{if(node.current)applyTtrpgNarrationRateV1(node.current,narrationRate)},[narrationRate,url,register])
  const sample=(element:HTMLAudioElement)=>{
    setPosition(ttrpgOpenVoiceReadingPositionV1(timeline,element.currentTime))
  }
  const segment=active>=0?timeline.segments[active]:undefined
  const seek=(index:number)=>{
    const element=node.current,row=timeline.segments[index]
    if(!element||!row||!Number.isFinite(element.duration))return
    element.currentTime=Math.min(element.duration,row.sampleOffset/timeline.sampleRate);sample(element)
  }
  return <section data-testid="ttrpg-voice-audition">
    <h4>本次候选试听</h4><p>仅供本人核对，尚未加入本局音轨。</p>
    <p>本次只朗读标出的片段，完整原文保留供核对。</p>
    <p className="sf-open-audio-caption" aria-label="试听原文">{sourceText.slice(0,originalPart.textOffset)}<mark aria-label="本次配音原文范围">{sourceText.slice(originalPart.textOffset,originalPart.textOffset+originalPart.textLength)}</mark>{sourceText.slice(originalPart.textOffset+originalPart.textLength)}</p>
    <p className="sf-open-audio-caption" aria-label="试听读法">{segment?<>{readingText.slice(0,segment.readingOffsetUtf16)}<mark>{readingText.slice(segment.readingOffsetUtf16,segment.readingOffsetUtf16+segment.readingLengthUtf16)}</mark>{readingText.slice(segment.readingOffsetUtf16+segment.readingLengthUtf16)}</>:readingText}</p>
    <p>高亮按实际朗读片段定位，不代表逐字时间。</p>
    <audio ref={node} controls preload="metadata" src={props.url} aria-label="候选配音试听" onTimeUpdate={e=>sample(e.currentTarget)} onSeeked={e=>sample(e.currentTarget)}
      onLoadedMetadata={e=>{const el=e.currentTarget,expected=timeline.samples/timeline.sampleRate;if(!Number.isFinite(el.duration)||el.duration<=0||Math.abs(el.duration-expected)>.02){el.pause();props.onFailure()}}}
      onError={props.onFailure}/>
    <div className="sf-open-audio-actions"><button disabled={position.previous<0} onClick={()=>seek(position.previous)}>上一段读法</button><button disabled={active<0} onClick={()=>seek(active)}>本段开头</button><button disabled={position.next<0} onClick={()=>seek(position.next)}>下一段读法</button></div>
  </section>
}
