import { test, expect, type Page } from '@playwright/test';
test.use({ actionTimeout: 15000 });
async function prepare(page: Page) {
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'));
    await page.goto('./avg/library');
    await expect(page.getByRole('button', { name: '新建 AVG', exact: true })).toBeVisible({ timeout: 30000 });
    return page.evaluate(async () => { const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>; return (await load('/storyforge/tests/helpers/avg-release-fixture.ts')).prepareAvgMediaReleasePreview(); });
}
async function openWorkbench(page: Page, s: any) {
    await page.goto(`./avg/production?project=${s.scope.projectId}&work=${s.scope.workId}`);
    await expect(page.getByRole('region', { name: '系统与效果组装（实验）' })).toBeVisible();
    return page.getByRole('region', { name: '本地原型版本验收' });
}
async function finishLine(page:Page,sessionId:number){
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  const retry=page.getByRole('button',{name:'重试配音',exact:true})
  await expect.poll(async()=>await retry.isVisible()||await page.locator('audio[data-channel="voice"]').evaluateAll((rows:HTMLAudioElement[])=>rows.some(audio=>!audio.paused||audio.ended))).toBe(true)
  if(await retry.isVisible())await retry.click()
  await expect.poll(()=>page.evaluate(async id=>{const load=new Function('p','return import(p)') as(p:string)=>Promise<any>;return (await(await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).avgReading.current.status},sessionId)).toBe('ended')
}
async function complete(page: Page, s: any) {
    await page.goto(`./avg/play?project=${s.scope.projectId}&work=${s.scope.workId}&session=${s.sessionId}`);
    await expect(page.locator('.avg-dialogue p')).toContainText('这是原创工程校准文本');
    await expect.poll(() => page.locator('.avg-background img').evaluate((image: HTMLImageElement) => image.complete ? image.naturalWidth : 0)).toBe(960);
    await finishLine(page,s.sessionId);
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await page.getByRole('button', { name: '打开灯光', exact: true }).click();
    await expect(page.locator('.avg-dialogue p')).toContainText('灯光亮起');
    await finishLine(page,s.sessionId);
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await expect.poll(() => page.evaluate(async (id) => { const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>; return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed; }, s.sessionId)).toBe(true);
}
test('native author prototype validates the full actual PNG/PCM catalog, explicitly freezes V2 and starts/refreshes a separate release save', async ({ page }, info) => {
    test.setTimeout(150000);
    const s = await prepare(page);
    await complete(page, s);
    const panel = await openWorkbench(page, s);
    await panel.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check();
    await panel.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click();
    await expect(panel.getByText(/完整路线：已确认/)).toBeVisible();
    await panel.getByRole('button', { name: '准备本地原型版本', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await panel.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible({ timeout: 60000 });
    await panel.getByRole('button', { name: '准备本地原型版本', exact: true }).click();
    await panel.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check();
    await page.screenshot({ path: info.outputPath('avg-prototype-release-review.png') });
    await panel.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click();
    await expect(panel.getByRole('button', { name: '从此版本开始新存档', exact: true })).toBeEnabled({ timeout: 60000 });
    const result = await page.evaluate(async (s) => {
        const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts');
        const build = await db.productBuilds.get(s.buildId), record = await db.productReleases.get(build.releasedProductReleaseId);
        const manifest = await (await load('/storyforge/src/lib/product-production/runtime-package.ts')).verifyProductReleaseManifest(record.manifestJson);
        const assets = await db.productMediaAssets.where('productReleaseId').equals(record.id).toArray();
        const gates = await db.productQualityGateReceipts.where('buildId').equals(s.buildId).toArray();
        const media = gates.find((row: any) => row.gateId === 'media-runtime') ?? gates.find((row: any) => JSON.parse(row.receiptJson).verifierKind === 'browser-runtime');
        return { version: manifest.version, sourceManifest: manifest.sourceContracts.sourceManifest, assetCount: assets.length, releaseId: record.id, previewHash: build.previewHash,
            frozenQA: JSON.parse(build.qualityReportJson).releaseReady, media: JSON.parse(JSON.parse(media.receiptJson).measuredJson) };
    }, s);
    expect(result.version).toBe(2);
    expect(result.assetCount).toBe(4);
    expect(result.frozenQA).toBe(false);
    expect(result.sourceManifest).toBeTruthy();
    expect(result.media.assets).toHaveLength(4);
    expect(result.media.assets.every((asset: any) => asset.status === 'decoded')).toBe(true);
    expect(result.media.assets.filter((asset: any) => asset.mediaClass === 'image').every((asset: any) => asset.decodedWidth === 960)).toBe(true);
    expect(result.media.assets.filter((asset: any) => asset.mediaClass === 'audio').every((asset: any) => asset.decodedSampleRateHz > 0)).toBe(true);
    await panel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click();
    await expect(page.locator('.avg-dialogue p')).toContainText('这是原创工程校准文本');
    const releaseSessionId = Number(new URL(page.url()).searchParams.get('session'));
    expect(releaseSessionId).not.toBe(s.sessionId);
    await page.reload();
    await expect.poll(() => page.locator('.avg-background img').evaluate((image: HTMLImageElement) => image.complete ? image.naturalWidth : 0)).toBe(960);
    const source = await page.evaluate(async (id) => { const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>; return (await load('/storyforge/src/lib/db/schema.ts')).db.productRuntimeSessions.get(id); }, releaseSessionId);
    expect(source.productReleaseId).toBe(result.releaseId);
    expect(source.productBuildId).toBeNull();
    await finishLine(page,releaseSessionId)
    const restored=await page.evaluate(async originalId=>{
      const load=new Function('p','return import(p)') as(p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts')
      const original=await db.productReleases.get(originalId),backup=await load('/storyforge/src/lib/export/json-export.ts')
      const copiedProjectId=await backup.importProjectJSON(await backup.exportProjectJSON(original.projectId))
      const copy=await db.productReleases.where('projectId').equals(copiedProjectId).first(),verify=await load('/storyforge/src/lib/product-production/runtime-package.ts')
      const copiedManifest=await verify.verifyProductReleaseManifest(copy.manifestJson),media=await load('/storyforge/src/lib/product-production/release-media.ts')
      const assets=copiedManifest.runtimePackage.modules[0].stage.assets,scope={projectId:copy.projectId,worldId:copy.worldId,workId:copy.workId}
      const sizes=[]
      for(const asset of assets)sizes.push((await media.readProductReleaseMediaBytes({scope,productReleaseId:copy.id,asset})).byteLength)
      await(await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(copy.workId)
      const originalManifest=await verify.verifyProductReleaseManifest(original.manifestJson)
      const stillReadable=await media.readProductReleaseMediaBytes({scope:{projectId:original.projectId,worldId:original.worldId,workId:original.workId},productReleaseId:original.id,asset:originalManifest.runtimePackage.modules[0].stage.assets[0]})
      return {sizes,copiedId:copy.id,originalId,deleted:!await db.productReleases.get(copy.id),originalBytes:stillReadable.byteLength}
    },result.releaseId)
    expect(restored.sizes).toHaveLength(4);expect(restored.sizes.every(size=>size>0)).toBe(true)
    expect(restored.copiedId).not.toBe(restored.originalId);expect(restored.deleted).toBe(true);expect(restored.originalBytes).toBeGreaterThan(0)
    await page.screenshot({ path: info.outputPath('avg-prototype-release-playing.png') });
});
test('cancelling after one real decoder batch never writes a partial full-catalog receipt',async({page})=>{
  test.setTimeout(90_000)
  const s=await prepare(page)
  const result=await page.evaluate(async s=>{
    const load=new Function('p','return import(p)') as(p:string)=>Promise<any>,{db}=await load('/storyforge/src/lib/db/schema.ts'),scan=await load('/storyforge/src/lib/avg/prototype-media-scan.ts')
    const build=await db.productBuilds.get(s.buildId),abort=new AbortController(),progress:number[]=[];let error=''
    try{await scan.scanAvgPrototypeMediaV1({scope:s.scope,buildId:s.buildId,expectedPreviewHash:build.previewHash,signal:abort.signal,environment:{browserName:'chromium',browserVersion:navigator.userAgent,platform:navigator.platform,viewport:{width:innerWidth,height:innerHeight}},onProgress:(done:number)=>{progress.push(done);abort.abort()}})}catch(cause){error=(cause as Error).name}
    const receipts=await db.productQualityGateReceipts.where('buildId').equals(s.buildId).toArray()
    return {error,progress,count:receipts.length}
  },s)
  expect(result).toEqual({error:'AbortError',progress:[2],count:0})
})
test('a partial scene window cannot pass full-catalog validation; corrupted future image remains blocked until real storage recovery', async ({ page }) => {
    test.setTimeout(150000);
    const s = await prepare(page);
    const backup = await page.evaluate(async (s) => {
        const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts');
        const media = await db.avgDraftMedia.where('workId').equals(s.scope.workId).filter((row: any) => JSON.parse(row.assetJson).assetKey === s.assets[1].assetKey).first();
        const blob = await db.mediaBlobObjects.get(media.blobObjectId);
        await db.mediaBlobObjects.update(blob.id, { data: new Uint8Array([1, 2, 3]).buffer });
        return { ...blob, data: Array.from(new Uint8Array(blob.data)) };
    }, s);
    const panel = await openWorkbench(page, s);
    await panel.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: '部分媒资解码失败' })).toBeVisible({ timeout: 60000 });
    await expect(panel.getByText(/全目录媒资：未通过/)).toBeVisible();
    await panel.getByRole('button', { name: '准备本地原型版本', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await page.evaluate(async (blob) => { const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts'); await db.mediaBlobObjects.put({ ...blob, data: new Uint8Array(blob.data).buffer }); }, backup);
    await panel.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible({ timeout: 60000 });
    await expect(panel.getByText(/完整路线：待确认/)).toBeVisible();
});
