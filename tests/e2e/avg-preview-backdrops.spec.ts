import { expect,test } from '@playwright/test'

for(const viewport of [{width:1280,height:720},{width:390,height:844}]){
 test(`native author preview compares the same owned PNG on multiple backdrops at ${viewport.width}px without changing Work data`,async({page},info)=>{
  await page.setViewportSize(viewport)
  await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  const s=await page.evaluate(async()=>{
   const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
   const [fixture,presets,editor,draft]=await Promise.all([load('/storyforge/tests/helpers/avg-production-assembly-fixture.ts'),
    load('/storyforge/src/lib/avg/authoring-presets.ts'),load('/storyforge/src/lib/avg/editor-service.ts'),load('/storyforge/src/lib/avg/draft-service.ts')])
   const workspace=presets.createAvgAuthoringPresetV1('evidence'),owner=await fixture.prepareNativeAvgAssembly(workspace)
   const canvas=document.createElement('canvas');canvas.width=256;canvas.height=320
   const context=canvas.getContext('2d')!;context.fillStyle='#2e5d79';context.fillRect(64,48,128,224)
   context.fillStyle='#ffffff';context.fillRect(96,80,32,48);context.clearRect(144,160,16,32)
   const data=await(await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('encode failed')),'image/png'))).arrayBuffer()
   const asset=await editor.importAvgMediaForAssemblyV1({scope:owner.scope,data,mimeType:'image/png',name:'原创透明工程图',kind:'character-pose',
    license:'CC0 原创工程色块，仅验本地预览，不签人物艺术通过',altText:'原创透明工程图',characterTag:'keeper'})
   const d=await draft.readAvgDraftV1(owner.scope);workspace.presentation.stage.assets.push(asset)
   await editor.saveAvgAuthorWorkspaceV1(owner.scope,d.revision,workspace)
   return {scope:owner.scope,productionId:owner.productionId,contentHash:asset.contentHash}
  })
  let requests=0
  page.on('request',request=>{if(/\/(images\/(generations|edits)|audio\/speech|chat\/completions)(\?|$)/.test(request.url()))requests++})
  await page.goto(`./avg/media-all?project=${s.scope.projectId}&work=${s.scope.workId}&production=${s.productionId}`)
  await page.getByRole('button',{name:'原创透明工程图 · 角色姿势',exact:true}).click()
  const figure=page.locator('figure.avg-assembly-media-preview').filter({has:page.getByAltText('原创透明工程图',{exact:true})}),image=figure.getByAltText('原创透明工程图',{exact:true})
  await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(img=>(img as HTMLImageElement).complete&&(img as HTMLImageElement).naturalWidth===256)).toBe(true)
  const snapshot=()=>page.evaluate(async(scope)=>{
   const load=new Function('p','return import(p)') as(p:string)=>Promise<any>
   const exported=await(await load('/storyforge/src/lib/export/json-export.ts')).exportProjectJSON(scope.projectId)
   return JSON.stringify({...exported,exportedAt:0})
  },s.scope)
  const before=await snapshot(),src=await image.getAttribute('src')
  const alpha=await image.evaluate(element=>{const c=document.createElement('canvas');c.width=256;c.height=320;const ctx=c.getContext('2d')!
   ctx.drawImage(element as HTMLImageElement,0,0);return {border:ctx.getImageData(0,0,1,1).data[3],subject:ctx.getImageData(80,100,1,1).data[3],hole:ctx.getImageData(150,170,1,1).data[3]}})
  expect(alpha).toEqual({border:0,subject:255,hole:0})
  await figure.getByText('透明边缘与底色检查',{exact:true}).click()
  const group=figure.getByRole('group',{name:'图片对比底色：原创透明工程图',exact:true})
  for(const [label,color] of [['浅色','rgb(247, 247, 247)'],['中性灰','rgb(128, 128, 128)'],['深色','rgb(24, 24, 24)']] as const){
   const button=group.getByRole('button',{name:label,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true')
   await expect.poll(()=>image.evaluate(element=>getComputedStyle(element).backgroundColor)).toBe(color)
   await expect(image).toHaveAttribute('src',src!)
  }
  await figure.scrollIntoViewIfNeeded()
  await expect.poll(()=>group.getByRole('button',{name:'深色',exact:true}).evaluate(element=>{const r=element.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===element})).toBe(true)
  await figure.screenshot({path:info.outputPath(`preview-backdrops-dark-${viewport.width}.png`)})
  await group.getByRole('button',{name:'透明网格',exact:true}).click();await expect.poll(()=>image.evaluate(element=>getComputedStyle(element).backgroundImage)).toContain('repeating-conic-gradient')
  await group.getByRole('button',{name:'原样',exact:true}).click();await expect(image).toHaveAttribute('src',src!)
  expect(await snapshot()).toBe(before);expect(requests).toBe(0)
  await info.attach('backdrop-readonly-observation.json',{body:JSON.stringify({viewport,contentHash:s.contentHash,alpha,unchangedFullExport:true,actualRequests:requests,scope:'Native owned author image and local display only; no processing/producer/art/author acceptance'}),contentType:'application/json'})
 })
}
