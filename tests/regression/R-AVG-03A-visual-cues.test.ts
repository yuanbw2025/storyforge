import { describe,expect,it } from 'vitest'
import type { AvgPresentationCue } from '../../src/lib/types'
import { avgTransientCueDurationV1,avgVisibleCueDurationsV1,selectAvgTransientCuesV1 } from '../../src/lib/avg/visual-cues'
const cue=(cueKey:string,type:AvgPresentationCue['type'],durationMs=0,extra:Partial<AvgPresentationCue>={}):AvgPresentationCue=>({cueKey,type,durationMs,phase:'before',beatKey:'line.original',order:0,easing:'linear',...extra})
describe('Native AVG visual cues bind effects to visible cue identity instead of persistent historical flags',()=>{
  it('selects at most one latest visible transient of each kind without losing simultaneous kinds',()=>{
    const first=cue('flash.first','flash',400),second=cue('flash.second','flash',900),shake=cue('shake.original','shake',800)
    expect(selectAvgTransientCuesV1([first,shake,second, ...Array.from({length:1000},(_,i)=>cue(`flash.${i}`,'flash',700))])).toEqual([cue('flash.999','flash',700),shake])
    expect(selectAvgTransientCuesV1([])).toEqual([])
    expect(first.durationMs).toBe(400)
  })
  it('uses each effect duration, retaining the existing default when duration is zero',()=>{
    expect(avgTransientCueDurationV1({...cue('fade','transition',1700),type:'transition'})).toBe(1700)
    expect(avgTransientCueDurationV1({...cue('flash','flash'),type:'flash'})).toBe(550)
    expect(avgTransientCueDurationV1({...cue('shake','shake'),type:'shake'})).toBe(380)
  })
  it('does not inflate camera, actor or tone durations using another actor or a wait',()=>{
    const result=avgVisibleCueDurationsV1([cue('camera','camera',400),cue('tone','set-tone',300),
      cue('keeper','move-actor',650,{actorKey:'keeper'}),cue('visitor','show-actor',950,{actorKey:'visitor'}),cue('hold','wait',10_000)])
    expect(result.cameraMs).toBe(400);expect(result.toneMs).toBe(300)
    expect([...result.actors]).toEqual([['keeper',650],['visitor',950]])
    expect(avgVisibleCueDurationsV1([]).cameraMs).toBe(0)
  })
})
