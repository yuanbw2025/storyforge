import { test, expect, type Page } from '@playwright/test'

test.use({actionTimeout:15_000})
async function prepare(page:Page){
  await page.addInitScript(()=>{
    localStorage.setItem('storyforge_guide_completed','e2e')
    const rows:Record<string,{revoked:boolean;type:string}>={},create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL)
    ;(window as any).__avgWindowUrls={rows,maxLive:0}
    URL.createObjectURL=blob=>{const url=create(blob);rows[url]={revoked:false,type:blob instanceof Blob?blob.type:''};(window as any).__avgWindowUrls.maxLive=Math.max((window as any).__avgWindowUrls.maxLive,Object.values(rows).filter(row=>!row.revoked).length);return url}
    URL.revokeObjectURL=url=>{if(rows[url])rows[url].revoked=true;revoke(url)}
  })
  await page.goto('./avg/library')
  const s=await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as (p:string)=>Promise<any>
    const s=await (await load('/storyforge/tests/helpers/avg-scene-window-fixture.ts')).seedAvgSceneWindowPreview()
    return {scope:s.scope,sessionId:s.sessionId,buildId:s.buildId}
  })
  await page.goto(`./avg/play?project=${s.scope.projectId}&work=${s.scope.workId}&session=${s.sessionId}`)
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await expect.poll(()=>page.locator('.avg-background img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(960)
  return s
}
async function state(page:Page){return page.evaluate(async()=>{const load=new Function('p','return import(p)') as(p:string)=>Promise<any>;const [player,runtime]=await Promise.all([load('/storyforge/src/stores/avg-game-player.ts'),load('/storyforge/src/lib/product/runtime-core.ts')]);return runtime.readProductRuntimeState(player.useAvgGamePlayerStore.getState().selectedSessionId)})}
async function finishVoice(page:Page){
  const retry=page.getByRole('button',{name:'重试配音',exact:true})
  await expect.poll(async()=>await retry.isVisible()||await page.locator('audio[data-channel="voice"]').evaluateAll((rows:HTMLAudioElement[])=>rows.some(a=>!a.paused||a.ended))).toBe(true)
  if(await retry.isVisible())await retry.click()
  await expect.poll(async()=>(await state(page)).avgReading.current.status).toBe('ended')
}
async function alive(page:Page){return page.evaluate(()=>Object.values((window as any).__avgWindowUrls.rows).filter((row:any)=>!row.revoked).length)}
async function gone(page:Page,url:string){return page.evaluate(async url=>{try{await fetch(url);return false}catch{return true}},url)}

test('native player keeps a bounded scene window, lazily reads public item images and history, and reloads a saved source',async({page},info)=>{
  test.setTimeout(120_000)
  const s=await prepare(page);await finishVoice(page)
  await expect.poll(()=>alive(page)).toBe(3)
  const beforeImageToggle=await page.locator('.avg-background img').getAttribute('src')
  await page.locator('summary[aria-label="设置"]').click()
  await page.getByRole('button',{name:'图片',exact:true}).press('Enter')
  await expect.poll(()=>alive(page)).toBe(2)
  await expect.poll(()=>gone(page,beforeImageToggle!)).toBe(true)
  await expect(page.locator('.avg-dialogue p')).toHaveText('封口仍在。')
  await page.getByRole('button',{name:'图片',exact:true}).press('Enter')
  await expect.poll(()=>page.locator('.avg-background img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(960)
  await expect.poll(()=>alive(page)).toBe(3)
  await page.locator('summary[aria-label="设置"]').click()
  const originalBg=await page.locator('.avg-background img').getAttribute('src'),originalVoice=await page.locator('audio[data-channel="voice"]').getAttribute('src')
  const bgm=page.locator('audio[data-channel="bgm"]'),music=await bgm.getAttribute('src')
  await expect.poll(()=>bgm.evaluate((a:HTMLAudioElement)=>!a.paused&&a.currentTime>0)).toBe(true)
  await page.getByRole('button',{name:'快速存档',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'已快速存档'})).toBeVisible()
  await page.getByRole('button',{name:'物品与证据',exact:true}).click()
  const inventory=page.getByRole('dialog',{name:'物品与证据'})
  await expect.poll(()=>inventory.locator('nav img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(256)
  await expect(inventory.locator('.avg-inventory-detail-image')).toHaveCount(0)
  await expect.poll(()=>alive(page)).toBe(4)
  await inventory.getByRole('button',{name:'检查信封',exact:true}).click()
  await expect.poll(()=>inventory.locator('.avg-inventory-detail-image').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(640)
  await expect.poll(()=>alive(page)).toBe(5)
  const detail=await inventory.locator('.avg-inventory-detail-image').getAttribute('src')
  await inventory.getByRole('button',{name:'关闭',exact:true}).click()
  await expect.poll(()=>gone(page,detail!)).toBe(true)
  await expect.poll(()=>alive(page)).toBe(3)
  await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'等待',exact:true}).click()
  await expect(page.locator('.avg-dialogue p')).toHaveText('你把信封放回桌上。');await finishVoice(page)
  await expect.poll(()=>page.locator('.avg-background img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(960)
  expect(await page.locator('.avg-background img').getAttribute('src')).not.toBe(originalBg)
  await expect.poll(()=>gone(page,originalBg!)).toBe(true);await expect.poll(()=>gone(page,originalVoice!)).toBe(true)
  expect(await bgm.getAttribute('src')).toBe(music)
  await expect.poll(()=>bgm.evaluate((a:HTMLAudioElement)=>!a.paused&&a.currentTime>0)).toBe(true)
  const before=await state(page)
  await page.getByRole('button',{name:'历史',exact:true}).click();const history=page.getByRole('dialog',{name:'历史回看'})
  await history.getByRole('button',{name:'回听第 1 条',exact:true}).click()
  await expect.poll(()=>page.locator('audio[data-channel="history"]').evaluateAll((rows:HTMLAudioElement[])=>rows.some(a=>!a.paused&&a.currentTime>.05))).toBe(true)
  const replay=await page.locator('audio[data-channel="history"]').getAttribute('src');expect(replay).not.toBe(originalVoice)
  expect(await state(page)).toEqual(before)
  await history.getByRole('button',{name:'停止回听',exact:true}).click();await history.getByRole('button',{name:'关闭',exact:true}).click()
  await expect.poll(()=>gone(page,replay!)).toBe(true);await expect.poll(()=>alive(page)).toBe(3)
  expect(await page.evaluate(()=>(window as any).__avgWindowUrls.maxLive)).toBeLessThanOrEqual(5)
  await page.screenshot({path:info.outputPath('avg-scene-window.png'),fullPage:true})
  await page.reload();await expect(page.locator('.avg-dialogue p')).toHaveText('你把信封放回桌上。')
  await expect.poll(()=>page.locator('.avg-background img').evaluate((img:HTMLImageElement)=>img.complete?img.naturalWidth:0)).toBe(960)
  expect((await state(page)).avgReading.history).toEqual(before.avgReading.history)
  expect(new URL(page.url()).searchParams.get('session')).toBe(String(s.sessionId))
})

test('future-scene corruption is detected on entry and retry reads an externally restored valid object',async({page})=>{
  test.setTimeout(90_000)
  const s=await prepare(page);await finishVoice(page)
  await page.evaluate(async buildId=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
    const artifact=await db.productBuildArtifacts.where('buildId').equals(buildId).filter((row:any)=>JSON.parse(row.metadataJson).assetKey==='bg.wait').first()
    const blob=await db.mediaBlobObjects.get(artifact.blobObjectId)
    ;(window as any).__avgRestoreBlob={id:blob.id,data:blob.data,contentHash:blob.contentHash}
    await db.mediaBlobObjects.update(blob.id,{data:new ArrayBuffer(blob.byteSize)})
  },s.buildId)
  await expect(page.getByRole('button',{name:'重试资源',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'等待',exact:true}).click()
  await expect(page.getByRole('button',{name:'重试资源',exact:true})).toBeVisible()
  await page.evaluate(async()=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts'),original=(window as any).__avgRestoreBlob
    const {sha256MediaData}=await load('/storyforge/src/lib/product-production/media-blob-store.ts')
    if(await sha256MediaData(original.data)!==original.contentHash)throw new Error('fixture backup bytes changed')
    // Simulate an external verified storage restore, including its ready state.
    // The retry UI only re-reads; it does not repair or re-label corrupt bytes.
    await db.mediaBlobObjects.update(original.id,{data:original.data,storageState:'ready'})
  })
  await page.getByRole('button',{name:'重试资源',exact:true}).click()
  await expect.poll(()=>page.locator('.avg-background img').evaluateAll((rows:HTMLImageElement[])=>rows.some(img=>img.complete&&img.naturalWidth===960))).toBe(true)
  await expect(page.getByRole('button',{name:'重试资源',exact:true})).toHaveCount(0)
  expect((await state(page)).narrative.currentNodeKey).toBe('wait')
})
