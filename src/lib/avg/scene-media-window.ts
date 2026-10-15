import type { AnyProductRuntimePackage, AvgStageState } from '../types'
import type { AvgInventoryEntryV1 } from './inventory-runtime'
import { avgExecutableModule } from './executable-module'

/** Ephemeral read selection only. Current persisted/clock-projected stage assets
 * survive a scene change; future scenes, hidden items and unrelated history do
 * not become a preload requirement. Legacy packages keep their existing path. */
export function selectAvgSceneMediaWindowV1(input: {
  runtimePackage: AnyProductRuntimePackage
  sceneKey: string | null
  currentLineKey: string | null
  stage: AvgStageState | null
  images: boolean
  audio: boolean
  inventoryEntries: readonly Pick<AvgInventoryEntryV1,'iconAssetKey'|'detailAssetKey'>[]
  historyAssetKey: string | null
}): string[] | null {
  const module=avgExecutableModule(input.runtimePackage)
  if(!module)return null
  const assets=new Map(module.stage.assets.map(asset=>[asset.assetKey,asset]))
  const selected=new Set<string>()
  const add=(key:string|null|undefined)=>{
    if(!key)return
    const asset=assets.get(key)
    if(asset?.mimeType.startsWith('image/')&&!input.images)return
    // Native voice still has a real transport/receipt when the reader mutes it.
    if(asset?.mimeType.startsWith('audio/')&&asset.kind!=='voice'&&!input.audio)return
    selected.add(key)
  }
  // Actual currently playing voice and the requested replay take priority.
  add(module.reading?.voices.find(voice=>voice.lineKey===input.currentLineKey)?.assetKey)
  add(input.historyAssetKey)
  for(const sound of input.stage?.activeAudio??[]){
    if(sound.channel!=='voice'||!module.reading)add(sound.assetKey)
  }
  add(input.stage?.backgroundAssetKey);add(input.stage?.cgAssetKey);add(input.stage?.overlayAssetKey)
  for(const actor of input.stage?.actors??[])add(actor.assetKey)
  for(const entry of input.inventoryEntries){add(entry.iconAssetKey);add(entry.detailAssetKey)}
  const lines=new Set(module.lines.filter(line=>line.sceneKey===input.sceneKey).map(line=>line.lineKey))
  // Prepare this scene's Cue changes and lines; snapshot restore is additionally
  // covered by the actual stage projection above when its clock reaches it.
  for(const cue of module.stage.cues){
    if(!lines.has(cue.beatKey))continue
    if(module.reading&&assets.get(cue.assetKey??'')?.kind==='voice')continue
    add(cue.assetKey)
  }
  for(const voice of module.reading?.voices??[])if(lines.has(voice.lineKey))add(voice.assetKey)
  return [...selected]
}
