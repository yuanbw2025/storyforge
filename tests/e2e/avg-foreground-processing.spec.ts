import { expect,test } from '@playwright/test'

// Native pixels/real dedicated Worker only. No provider, production/author
// acceptance, professional foreground artwork or listening claim.
test('native foreground Worker clears declared original pixels before fitting and preserves exact PNG lineage',async({page},info)=>{
 const remote:string[]=[]
 page.on('request',request=>{if(/^https?:/.test(request.url())&&!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))remote.push(request.url())})
 await page.goto('./avg/library')
 const result=await page.evaluate(async()=>{
  const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
  const [processor,contracts,foreground,blob,schema]=await Promise.all([load('/storyforge/src/lib/avg/image-processing.ts'),
   load('/storyforge/src/lib/avg/image-processing-contract-v2.ts'),load('/storyforge/src/lib/avg/image-foreground-contract.ts'),
   load('/storyforge/src/lib/product-production/media-blob-store.ts'),load('/storyforge/src/lib/db/schema.ts')])
  const db=schema.db
  const snapshot=()=>db.transaction('r',[db.productBuilds,db.productBuildArtifacts,db.mediaBlobObjects,db.agentRuns,db.agentRunEvents],async()=>({
   builds:await db.productBuilds.toArray(),artifacts:await db.productBuildArtifacts.toArray(),blobs:await db.mediaBlobObjects.toArray(),
   runs:await db.agentRuns.toArray(),events:await db.agentRunEvents.toArray()}))
  const before=JSON.stringify(await snapshot())
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=80
  const ctx=canvas.getContext('2d')!
  ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,100,80);ctx.fillStyle='#1e3c5a';ctx.fillRect(25,20,50,40)
  ctx.fillStyle='#ffffff';ctx.fillRect(40,30,8,8);ctx.fillStyle='#ff00ff';ctx.fillRect(55,35,5,5)
  const encode=()=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNG encoding failed')),'image/png'))
  const data=await(await encode()).arrayBuffer(),source={contentHash:await blob.sha256MediaData(data),mimeType:'image/png',width:100,height:80}
  const policy={schema:'storyforge.avg.foreground-policy',version:1,method:'reserved-magenta',reservedColor:'#FF00FF',subjectUsesReservedColor:false,
   algorithm:'storyforge.character-alpha.declared-magenta.v1',declaration:'原创色块背景与主体的明确工程声明，不签真实美术或商业通过'}
  const requirement={mediaKind:'character-pose',alpha:'required',consumer:{consumerKey:'native.actor',domain:'stage',slot:'actor',subjectKey:'native',sceneKey:'scene',lineKey:null,required:true,fallback:'none'},
   invariants:[foreground.AVG_RESERVED_MAGENTA_INVARIANT_V1],forbiddenDepictions:[foreground.AVG_RESERVED_MAGENTA_FORBIDDEN_V1]}
  const recipe={schema:'storyforge.avg.image-processing-recipe',version:2,crop:null,width:100,height:100,fit:'contain',anchor:{x:5000,y:5000},background:null,
   declaration:'先在原尺寸分离，再适配共同画布',foreground:policy}
  const NativeWorker=window.Worker,workers:Array<{url:string;type:string|undefined;terminated:number}>=[]
  class ObservedWorker extends NativeWorker {
   readonly record:{url:string;type:string|undefined;terminated:number}
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.record={url:String(url),type:options?.type,terminated:0};workers.push(this.record)}
   terminate(){this.record.terminated++;super.terminate()}
  }
  window.Worker=ObservedWorker
  try{
   const output=await processor.processAvgImageBytesV2({data,source,recipe,frozenRequirement:requirement})
   const bitmap=await createImageBitmap(new Blob([output.data],{type:'image/png'})),read=document.createElement('canvas');read.width=100;read.height=100
   const view=read.getContext('2d')!;view.drawImage(bitmap,0,0);bitmap.close()
   const at=(x:number,y:number)=>Array.from(view.getImageData(x,y,1,1).data)
   const failures:Array<{kind:string;message:string}>=[]
   const reject=async(kind:string,input:unknown)=>{try{await processor.processAvgImageBytesV2(input);failures.push({kind,message:'unexpected success'})}catch(error){failures.push({kind,message:String(error)})}}
   const controller=new AbortController();controller.abort()
   await reject('missing-declaration',{data,source,recipe,frozenRequirement:{...requirement,invariants:[]}})
   await reject('already-aborted',{data,source,recipe,frozenRequirement:requirement,signal:controller.signal})
   ctx.fillStyle='#ffffff';ctx.fillRect(0,0,100,80)
   const complex=await(await encode()).arrayBuffer()
   await reject('undeclared-actual-backdrop',{data:complex,source:{...source,contentHash:await blob.sha256MediaData(complex)},recipe,frozenRequirement:requirement})
   ctx.clearRect(0,0,1,80)
   const alpha=await(await encode()).arrayBuffer()
   await reject('existing-alpha',{data:alpha,source:{...source,contentHash:await blob.sha256MediaData(alpha)},recipe,frozenRequirement:requirement})
   const bytes=new Uint8Array(output.data);let binary='';for(const value of bytes)binary+=String.fromCharCode(value)
   return {receipt:output.receipt,pixels:{canvasPadding:at(2,2),originalBackdrop:at(2,15),subject:at(30,35),whitePaint:at(43,43),closedHole:at(57,47)},
    pngBase64:btoa(binary),sourceUnchanged:await blob.sha256MediaData(data)===source.contentHash,
    outputHashMatches:await blob.sha256MediaData(output.data)===output.receipt.output.contentHash,
    receiptVerified:!!await contracts.assertAvgImageProcessingReceiptV2(recipe,output.receipt),storeUnchanged:JSON.stringify(await snapshot())===before,workers,failures}
  }finally{window.Worker=NativeWorker}
 })
 expect(result.pixels).toEqual({canvasPadding:[0,0,0,0],originalBackdrop:[0,0,0,0],subject:[30,60,90,255],whitePaint:[255,255,255,255],closedHole:[0,0,0,0]})
 expect(result.receipt).toMatchObject({version:2,processor:'storyforge.avg.local-foreground-canvas.v2',source:{width:100,height:80},
  output:{width:100,height:100,hasAlpha:true},foreground:{width:100,height:80,clearedPixelCount:6025,translucentPixelCount:0,opaquePixelCount:1975,
   removedPixelRatio:6025/8000,reservedBorderRatio:1},geometry:{source:{x:0,y:0,width:100,height:80},destination:{x:0,y:10,width:100,height:80}}})
 expect(result.receipt.foreground.sourcePixelHash).not.toBe(result.receipt.foreground.cutoutPixelHash)
 expect(result.sourceUnchanged&&result.outputHashMatches&&result.receiptVerified&&result.storeUnchanged).toBe(true)
 expect(result.workers).toHaveLength(2)
 for(const worker of result.workers){expect(worker.type).toBe('module');expect(worker.url).toContain('image-foreground.worker');expect(worker.terminated).toBe(1)}
 expect(result.failures.find(f=>f.kind==='missing-declaration')!.message).toContain('冻结')
 expect(result.failures.find(f=>f.kind==='already-aborted')!.message).toContain('AbortError')
 expect(result.failures.find(f=>f.kind==='undeclared-actual-backdrop')!.message).toContain('边缘')
 expect(result.failures.find(f=>f.kind==='existing-alpha')!.message).toContain('不透明')
 expect(remote).toEqual([])
 const {pngBase64,...observation}=result
 await info.attach('native-foreground-observation.json',{body:JSON.stringify(observation,null,2),contentType:'application/json'})
 await info.attach('native-foreground-output.png',{body:Buffer.from(pngBase64,'base64'),contentType:'image/png'})
})

test('native boundary unmix2 uses exact recomputation, cleans an encoded PNG edge and terminates cancellation during verification',async({page},info)=>{
 const remote:string[]=[]
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!/^(127\.0\.0\.1|localhost)$/.test(new URL(r.url()).hostname))remote.push(r.url())})
 await page.goto('./avg/library')
 const result=await page.evaluate(async()=>{
  const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
  const [processor,contracts,foreground,blob,schema]=await Promise.all([load('/storyforge/src/lib/avg/image-processing.ts'),
   load('/storyforge/src/lib/avg/image-processing-contract-v2.ts'),load('/storyforge/src/lib/avg/image-foreground-contract.ts'),
   load('/storyforge/src/lib/product-production/media-blob-store.ts'),load('/storyforge/src/lib/db/schema.ts')])
  const db=schema.db,snapshot=()=>db.transaction('r',[db.productBuilds,db.productBuildArtifacts,db.mediaBlobObjects,db.agentRuns,db.agentRunEvents],async()=>({
   builds:await db.productBuilds.toArray(),artifacts:await db.productBuildArtifacts.toArray(),blobs:await db.mediaBlobObjects.toArray(),runs:await db.agentRuns.toArray(),events:await db.agentRunEvents.toArray()}))
  const before=JSON.stringify(await snapshot()),canvas=document.createElement('canvas');canvas.width=100;canvas.height=80
  const context=canvas.getContext('2d')!,image=context.createImageData(100,80)
  for(let at=0;at<image.data.length;at+=4)image.data.set([255,0,255,255],at)
  for(let y=20;y<60;y++)for(let x=20;x<80;x++)image.data.set([200,149,99,255],(y*100+x)*4)
  for(let y=21;y<59;y++)for(const x of [19,80])image.data.set([241,37,216,255],(y*100+x)*4)
  context.putImageData(image,0,0)
  const encoded=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Original PNG failed')),'image/png'))
  const data=await encoded.arrayBuffer(),source={contentHash:await blob.sha256MediaData(data),mimeType:'image/png',width:100,height:80}
  const reservation={schema:'storyforge.avg.foreground-policy',method:'reserved-magenta',reservedColor:'#FF00FF',subjectUsesReservedColor:false,
   declaration:'原创几何测试原件的底色声明，供独立算法数值与原生复核，不签人物美术'}
  const recipe={schema:'storyforge.avg.image-processing-recipe',version:2,crop:null,width:100,height:80,fit:'contain',anchor:{x:5000,y:5000},background:null,
   declaration:'本次明确还原边缘，原件与旧结果独立保留',foreground:{...reservation,version:2,algorithm:'storyforge.avg.foreground.declared-magenta-boundary-unmix.v2'}}
  const requirement={mediaKind:'character-pose',alpha:'required',consumer:{consumerKey:'native.actor',domain:'stage',slot:'actor',subjectKey:'native',sceneKey:'scene',lineKey:null,required:true,fallback:'none'},
   invariants:[foreground.AVG_RESERVED_MAGENTA_INVARIANT_V1],forbiddenDepictions:[foreground.AVG_RESERVED_MAGENTA_FORBIDDEN_V1]}
  const NativeWorker=window.Worker,workers:Array<{name:string|undefined;terminated:number}>=[]
  let cancelOnVerify:AbortController|null=null
  class ObservedWorker extends NativeWorker{
   record:{name:string|undefined;terminated:number}
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.record={name:options?.name,terminated:0};workers.push(this.record)
    if(options?.name==='avg-foreground-v2-verify'&&cancelOnVerify){const controller=cancelOnVerify;queueMicrotask(()=>controller.abort())}}
   terminate(){this.record.terminated++;super.terminate()}
  }
  const inspect=async(bytes:ArrayBuffer)=>{
   const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),read=document.createElement('canvas');read.width=100;read.height=80
   const ctx=read.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(0,0,100,80).data
   let fringe=0;for(let at=0;at<pixels.length;at+=4)if(pixels[at+3]>=16&&pixels[at]>=pixels[at+1]+25&&pixels[at+2]>=pixels[at+1]+25)fringe++
   const at=(x:number,y:number)=>Array.from(pixels.slice((y*100+x)*4,(y*100+x)*4+4))
   return {edge:at(19,40),body:at(50,40),corner:at(0,0),fringe}
  }
  const base64=(bytes:ArrayBuffer)=>{let text='';for(const b of new Uint8Array(bytes))text+=String.fromCharCode(b);return btoa(text)}
  window.Worker=ObservedWorker
  try{
   const prior=await processor.processAvgImageBytesV2({data,source,recipe:{...recipe,foreground:{...reservation,version:1,algorithm:'storyforge.character-alpha.declared-magenta.v1'}},frozenRequirement:requirement})
   const output=await processor.processAvgImageBytesV2({data,source,recipe,frozenRequirement:requirement})
   const priorPixels=await inspect(prior.data),pixels=await inspect(output.data)
   cancelOnVerify=new AbortController();let cancelled='unexpected success'
   try{await processor.processAvgImageBytesV2({data,source,recipe,frozenRequirement:requirement,signal:cancelOnVerify.signal})}catch(error){cancelled=String(error)}
   return {receipt:output.receipt,priorPixels,pixels,workers,cancelled,sourceUnchanged:await blob.sha256MediaData(data)===source.contentHash,
    hashVerified:await blob.sha256MediaData(output.data)===output.receipt.output.contentHash,
    receiptVerified:!!await contracts.assertAvgImageProcessingReceiptV2(recipe,output.receipt),storeUnchanged:JSON.stringify(await snapshot())===before,
    originalPNG:base64(data),priorPNG:base64(prior.data),outputPNG:base64(output.data)}
  }finally{window.Worker=NativeWorker}
 })
 expect(result.priorPixels.edge).toEqual([241,37,216,255]);expect(result.priorPixels.fringe).toBeGreaterThan(0)
 expect(result.pixels.fringe).toBe(0);expect(result.pixels.corner).toEqual([0,0,0,0]);expect(result.pixels.body).toEqual([200,149,99,255])
 expect(result.pixels.edge[3]).toBeGreaterThanOrEqual(63);expect(result.pixels.edge[3]).toBeLessThanOrEqual(65)
 for(const [i,value]of [200,149,99].entries())expect(Math.abs(result.pixels.edge[i]-value)).toBeLessThanOrEqual(3)
 expect(result.receipt.foreground).toMatchObject({version:2,algorithm:'storyforge.avg.foreground.declared-magenta-boundary-unmix.v2'})
 expect(result.workers.map(w=>w.name)).toEqual(['avg-foreground-v1','avg-foreground-v2-compute','avg-foreground-v2-verify','avg-foreground-v2-compute','avg-foreground-v2-verify'])
 for(const w of result.workers)expect(w.terminated).toBe(1)
 expect(result.cancelled).toContain('AbortError');expect(result.sourceUnchanged&&result.hashVerified&&result.receiptVerified&&result.storeUnchanged).toBe(true)
 expect(remote).toEqual([])
 const {originalPNG,priorPNG,outputPNG,...observation}=result
 await info.attach('native-boundary-unmix2-observation.json',{body:JSON.stringify(observation,null,2),contentType:'application/json'})
 for(const [name,data]of [['original',originalPNG],['prior-v1',priorPNG],['unmix-v2',outputPNG]])await info.attach(`native-boundary-${name}.png`,{body:Buffer.from(data,'base64'),contentType:'image/png'})
})
