import { useEffect,useRef,type RefObject } from 'react'
import { avgTransientCueDurationV1,type AvgTransientCueV1 } from '../../lib/avg/visual-cues'

/** The React key is session/visit/line/cue. Runtime cloning and phase changes
 * do not restart it; leaving the line cancels it without changing story state. */
export function NativeVisualCue({cue,stageRef,paused,reducedMotion}:{
  cue:AvgTransientCueV1;stageRef:RefObject<HTMLDivElement|null>;paused:boolean;reducedMotion:boolean
}){
  const flashRef=useRef<HTMLDivElement>(null),animationRef=useRef<Animation|null>(null),pausedRef=useRef(paused)
  const suppressed=useRef(reducedMotion)
  pausedRef.current=paused
  const {cueKey,type,easing}=cue,duration=avgTransientCueDurationV1(cue)
  useEffect(()=>{
    if(reducedMotion)suppressed.current=true
    const target=type==='flash'?flashRef.current:stageRef.current
    if(suppressed.current||!target||typeof target.animate!=='function')return
    const frames:Keyframe[]=type==='flash'?[{opacity:0,offset:0},{opacity:.94,offset:.18},{opacity:0,offset:1}]
      :type==='transition'?[{opacity:.2},{opacity:1}]
      :[{translate:'0 0',offset:0},{translate:'-10px 3px',offset:.18},{translate:'9px -2px',offset:.38},
        {translate:'-6px 2px',offset:.58},{translate:'4px -1px',offset:.78},{translate:'0 0',offset:1}]
    const animation=target.animate(frames,{duration,easing,fill:'none'})
    animationRef.current=animation
    if(pausedRef.current)animation.pause()
    return()=>{animation.cancel();if(animationRef.current===animation)animationRef.current=null}
  },[cueKey,type,duration,easing,stageRef,reducedMotion])
  useEffect(()=>{
    const animation=animationRef.current
    if(!animation||animation.playState==='finished'||animation.playState==='idle')return
    if(paused)animation.pause();else animation.play()
  },[paused])
  return type==='flash'&&!reducedMotion?<div ref={flashRef} className="avg-flash" aria-hidden="true" style={{animation:'none',opacity:0}}/>:null
}
