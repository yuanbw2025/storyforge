import { seedAvgNativePreview } from './avg-native-fixture'
import { avgInventoryFixture } from './avg-inventory-fixture'
import { avgInventoryMediaFixture } from './avg-inventory-media-fixture'
import { avgReadingAudioFixture, avgReadingFixture } from './avg-reading-fixture'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'

/** Player-resource probe only: controlled Preview seam, actual original image
 * and PCM bytes. Formal planner/workbench production has its own browser test. */
export async function seedAvgSceneWindowPreview() {
  const image=async(assetKey:string,color:string)=>{
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540
    const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,960,540)
    ctx.fillStyle='#d6c3a3';ctx.fillRect(80,90,390,300);ctx.fillStyle='#54798a';ctx.fillRect(490,130,330,200)
    const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png')),data=await blob.arrayBuffer()
    const contentHash=await sha256MediaData(data)
    return {data,asset:{assetKey,version:1,kind:'background' as const,name:assetKey==='bg.desk'?'校准场景一':'校准场景二',mimeType:'image/png',byteSize:data.byteLength,width:960,height:540,durationMs:null,
      contentHash,blobContentHash:contentHash,source:'original procedural engineering image',license:'CC0-1.0',altText:'原创几何场景校准图',characterTag:'',sceneTag:''}}
  }
  const [desk,wait,voice,second,music,items]=await Promise.all([image('bg.desk','#324c64'),image('bg.wait','#5f6f48'),avgReadingAudioFixture(900),avgReadingAudioFixture(1200),avgReadingAudioFixture(6000),avgInventoryMediaFixture()])
  const media=[desk,wait,voice,{...second,asset:{...second.asset,assetKey:'voice.wait'}},
    {...music,asset:{...music.asset,kind:'bgm' as const,assetKey:'music.continuous',characterTag:''}},...items]
  const plan=avgInventoryFixture()
  plan.inventory.items[0].iconAssetKey='ui.envelope';plan.inventory.items[0].variants[0].iconAssetKey='ui.envelope';plan.inventory.items[0].variants[0].detailAssetKey='cg.seal-detail'
  const reading=avgReadingFixture({voices:[...avgReadingFixture().voices,{...avgReadingFixture().voices[0],lineKey:'line.wait',assetKey:'voice.wait',text:'你把信封放回桌上。',speakerKey:null}]})
  const s=await seedAvgNativePreview(plan,media,reading,[
    {cueKey:'desk.bg',beatKey:'line.desk',type:'set-background',assetKey:'bg.desk',phase:'before',durationMs:0,order:1,easing:'linear'},
    {cueKey:'desk.music',beatKey:'line.desk',type:'play-audio',assetKey:'music.continuous',phase:'before',durationMs:0,order:2,easing:'linear',volume:.2,loop:true},
    {cueKey:'wait.bg',beatKey:'line.wait',type:'set-background',assetKey:'bg.wait',phase:'before',durationMs:0,order:1,easing:'linear'},
  ])
  const session=await createProductRuntimeInstance({scope:s.scope,kind:'avg',title:'场景资源窗口校准',productSource:{kind:'build',productBuildId:s.buildId,expectedPreviewHash:s.preview.previewHash}})
  return {...s,media,sessionId:session.id!}
}
