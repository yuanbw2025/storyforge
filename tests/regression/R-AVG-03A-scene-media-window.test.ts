import { describe, expect, it } from 'vitest'
import { selectAvgSceneMediaWindowV1 } from '../../src/lib/avg/scene-media-window'
import { compileAvgExecutablePackageV2 } from '../../src/lib/avg/executable-compiler'
import { EMPTY_AVG_STAGE } from '../../src/lib/avg/runtime'
import { avgNativePackage, avgNativeScripts } from '../helpers/avg-native-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import { avgReadingAudioFixture, avgReadingFixture } from '../helpers/avg-reading-fixture'
import { avgInventoryMediaFixture } from '../helpers/avg-inventory-media-fixture'
import { legacyPackage } from '../helpers/avg-carrier-fixture'

async function fixture() {
  const images=await avgInventoryMediaFixture(),voice=await avgReadingAudioFixture()
  const assets=[...images.map(row=>row.asset),{...images[0].asset,assetKey:'bg.desk',kind:'background' as const},
    {...images[1].asset,assetKey:'bg.wait',kind:'background' as const},voice.asset,{...voice.asset,assetKey:'voice.wait'}]
  const pkg=compileAvgExecutablePackageV2({product:{key:'window.test',title:'资源窗口测试',description:''},
    sourceWorld:avgNativePackage().sourceWorld,systemPlan:avgSystemFixture(),scripts:avgNativeScripts(),aspectRatio:'16:9',
    stage:{version:1,assets,cues:[
      {cueKey:'desk.bg',beatKey:'line.desk',type:'set-background',assetKey:'bg.desk',phase:'before',durationMs:0,easing:'linear',order:0},
      {cueKey:'wait.bg',beatKey:'line.wait',type:'set-background',assetKey:'bg.wait',phase:'before',durationMs:0,easing:'linear',order:0},
    ]},reading:avgReadingFixture({voices:[...avgReadingFixture().voices,{...avgReadingFixture().voices[0],lineKey:'line.wait',assetKey:'voice.wait',text:'你把信封放回桌上。',speakerKey:null}]})})
  return {runtimePackage:pkg,sceneKey:'desk',currentLineKey:'line.desk',stage:structuredClone(EMPTY_AVG_STAGE),images:true,audio:true,inventoryEntries:[],historyAssetKey:null}
}

describe('AVG current scene media read window',()=>{
  it('loads the current scene and voice, without unrelated scenes or item detail/history files',async()=>{
    const input=await fixture(),before=structuredClone(input)
    const keys=selectAvgSceneMediaWindowV1(input)
    expect(keys).toEqual(['voice.calibration','bg.desk'])
    expect(keys).not.toContain('bg.wait');expect(keys).not.toContain('voice.wait')
    expect(keys).not.toContain('cg.seal-detail');expect(input).toEqual(before)
  })
  it('retains actual carried stage assets across a scene with no background Cue',async()=>{
    const input=await fixture();input.sceneKey='share';input.currentLineKey='line.share'
    input.stage.backgroundAssetKey='bg.desk'
    input.stage.activeAudio=[{channel:'bgm',assetKey:'music.persisted',volume:.5,loop:true}]
    // Invalid/unknown references are deliberately passed to the existing
    // resolver failure surface, never silently promoted to a valid catalog.
    expect(selectAvgSceneMediaWindowV1(input)).toEqual(['music.persisted','bg.desk'])
  })
  it('only adds explicitly projected public item images and the selected history clip',async()=>{
    const input=await fixture()
    const keys=selectAvgSceneMediaWindowV1({...input,inventoryEntries:[{iconAssetKey:'ui.envelope',detailAssetKey:'cg.seal-detail'}],historyAssetKey:'voice.wait'})!
    expect(keys).toEqual(['voice.calibration','voice.wait','ui.envelope','cg.seal-detail','bg.desk'])
    expect(keys).not.toContain('bg.wait')
  })
  it('honors image/audio preferences while retaining native voice for a real muted transport receipt',async()=>{
    const input=await fixture();input.images=false;input.audio=false;input.stage.backgroundAssetKey='bg.wait'
    input.stage.activeAudio=[{channel:'bgm',assetKey:'music.persisted',volume:.5,loop:true}]
    // A known music kind is needed to apply the audio policy.
    const module=input.runtimePackage.modules[0]
    if(module.version!==2)throw new Error('native fixture missing')
    module.stage.assets.push({...module.stage.assets.find(asset=>asset.kind==='voice')!,kind:'bgm',assetKey:'music.persisted'})
    expect(selectAvgSceneMediaWindowV1(input)).toEqual(['voice.calibration'])
  })
  it('returns legacy control to the existing V1 catalog path',async()=>{
    const input=await fixture()
    expect(selectAvgSceneMediaWindowV1({...input,runtimePackage:legacyPackage()})).toBeNull()
  })
})
