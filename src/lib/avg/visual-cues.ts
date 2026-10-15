import type { AvgPresentationCue } from '../types'

export type AvgTransientCueV1 = AvgPresentationCue & {type:'transition'|'shake'|'flash'}
const DEFAULT_DURATIONS={transition:650,shake:380,flash:550} as const

/** At one clock position, the latest cue of each transient kind wins. No
 * persistent lastTransition flag can replay an effect on another sentence. */
export function selectAvgTransientCuesV1(cues:readonly AvgPresentationCue[]):AvgTransientCueV1[] {
  const latest=new Map<string,AvgTransientCueV1>()
  for(const cue of cues)if(cue.type==='transition'||cue.type==='shake'||cue.type==='flash')latest.set(cue.type,cue as AvgTransientCueV1)
  return [...latest.values()]
}
export function avgTransientCueDurationV1(cue:AvgTransientCueV1):number {
  return cue.durationMs>0?cue.durationMs:DEFAULT_DURATIONS[cue.type]
}

/** Movement/filter durations belong to their own visible cue, never to a
 * wait or an unrelated actor. The legacy parser/state format stays intact. */
export function avgVisibleCueDurationsV1(cues:readonly AvgPresentationCue[]) {
  let cameraMs=0,toneMs=0
  const actors=new Map<string,number>()
  for(const cue of cues){
    const ms=cue.durationMs>0?cue.durationMs:240
    if(cue.type==='camera')cameraMs=ms
    if(cue.type==='set-tone')toneMs=ms
    if((cue.type==='move-actor'||cue.type==='show-actor')&&cue.actorKey)actors.set(cue.actorKey,ms)
  }
  return {cameraMs,toneMs,actors}
}
