import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

test.skip(!process.env.AVG_SOUND_RELEASE_BACKUP_FILE && !process.env.AVG_SOUND_PUBLISHER_RELEASE_BACKUP_FILE, 'Requires preceding actual native Sound publication exports; no seeded release authority')

test('original published Sound backup remains natively playable with both factory switches closed, without credentials or new producer/quality writes', async ({ page }, info) => {
  test.setTimeout(150_000)
  test.skip(!process.env.AVG_SOUND_RELEASE_BACKUP_FILE, 'Requires the preceding original Sound publication export')
  expect(process.env.VITE_STORYFORGE_AVG_SOUND_PREPARATION ?? '0').toBe('0')
  expect(process.env.VITE_STORYFORGE_AVG_SOUND_PRODUCTION ?? '0').toBe('0')
  const bytes = await readFile(process.env.AVG_SOUND_RELEASE_BACKUP_FILE!), exported = JSON.parse(bytes.toString())
  expect(exported.schema).toBe('storyforge.avg.sound-release-native-test-export')
  expect(createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex')).toBe(exported.backupSHA256)
  const requests: string[] = []
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (['5297', '5298', '11434'].includes(u.port) || u.hostname === 'sound-proposal.fixture.invalid') { requests.push(u.href); return route.abort('blockedbyclient') }
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const copied = await page.evaluate(async ({ backup, releaseUid, sourceScope }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, files, { db }, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const occupied = Math.max(sourceScope.projectId, sourceScope.workId)
    if (!Number.isSafeInteger(occupied) || occupied < 1 || occupied > 32) throw new Error('Native fixture owner range exceeded')
    for (let i = 0; i < occupied; i++) await drafts.createAvgDraftV1(`声音版本恢复的隔离占位作品 ${i + 1}`)
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: '', model: 'agnes-2.5-flash' })
    const projectId = await files.importProjectJSON(backup), records = await db.productReleases.where('projectId').equals(projectId).toArray()
    const matches = records.filter((r: any) => JSON.parse(r.manifestJson).lineage.releaseUid === releaseUid)
    if (matches.length !== 1) throw new Error('Missing or ambiguous exact exported Release')
    const record = matches[0]
    return { projectId, worldId: record.worldId, workId: record.workId, releaseId: record.id, manifestJson: record.manifestJson,
      counts: [await db.productBuilds.count(), await db.agentRuns.count(), await db.productQualityGateReceipts.count(), await db.productProductionCommands.count(), await db.productReleases.count()] }
  }, { backup: exported.backup, releaseUid: exported.expected.releaseUid, sourceScope: exported.expected.scope })
  expect(copied.projectId).not.toBe(exported.expected.scope.projectId)
  expect(copied.workId).not.toBe(exported.expected.scope.workId)
  expect(createHash('sha256').update(copied.manifestJson).digest('hex')).toBe(createHash('sha256').update(exported.expected.manifestJson).digest('hex'))
  await page.goto(`./avg/production?project=${copied.projectId}&work=${copied.workId}&assembly=1`)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '当前生成、采用与本地原型验收关闭' })).toBeVisible()
  const panel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await expect(panel.getByRole('button', { name: '从此版本开始新存档', exact: true })).toBeEnabled()
  await expect(panel.getByRole('button', { name: '准备本地原型版本', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(rows => rows.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  await expect(page.locator('audio[data-channel="ambience"]')).toHaveJSProperty('loop', true)
  await page.reload()
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(rows => rows.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  const read = await page.evaluate(async ({ scope, sessionId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, pkg, module, media, hash, config] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/product-production/runtime-package.ts'),
      load('/storyforge/src/lib/avg/executable-module.ts'), load('/storyforge/src/lib/product-production/release-media.ts'), load('/storyforge/src/lib/avg/sound-provider-contract.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const record = await db.productReleases.get(scope.releaseId), manifest = await pkg.verifyProductReleaseManifest(record.manifestJson), assets = module.avgRuntimeStage(manifest.runtimePackage).assets
    const hashes = []
    for (const asset of assets) hashes.push({ assetKey: asset.assetKey, hash: await hash.hashAvgSoundBytesV1(await media.readProductReleaseMediaBytes({ scope, productReleaseId: record.id, asset })) })
    return { hashes, session: await db.productRuntimeSessions.get(sessionId), hasKey: !!config.useAIConfigStore.getState().config.apiKey,
      counts: [await db.productBuilds.count(), await db.agentRuns.count(), await db.productQualityGateReceipts.count(), await db.productProductionCommands.count(), await db.productReleases.count()] }
  }, { scope: copied, sessionId })
  expect(read.session.productReleaseId).toBe(copied.releaseId); expect(read.session.productBuildId).toBeNull()
  expect(read.hasKey).toBe(false); expect(read.counts).toEqual(copied.counts)
  expect(read.hashes).toEqual(exported.expected.assets.map((a: any) => ({ assetKey: a.assetKey, hash: a.blobContentHash })))
  expect(requests).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('native-sound-release-closed-factory.png') })
  expect(createHash('sha256').update(await readFile(process.env.AVG_SOUND_RELEASE_BACKUP_FILE!)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
})

test('published publisher-page V2 original ambience restores exact grant and Release bytes with both sound factories closed and no producer or quality writes', async ({ page }, info) => {
  test.setTimeout(150_000)
  test.skip(!process.env.AVG_SOUND_PUBLISHER_RELEASE_BACKUP_FILE, 'Requires the preceding actual publisher source Stage/Release export')
  expect(process.env.VITE_STORYFORGE_AVG_SOUND_PREPARATION ?? '0').toBe('0')
  expect(process.env.VITE_STORYFORGE_AVG_SOUND_PRODUCTION ?? '0').toBe('0')
  const bytes = await readFile(process.env.AVG_SOUND_PUBLISHER_RELEASE_BACKUP_FILE!), exported = JSON.parse(bytes.toString())
  expect(exported.schema).toBe('storyforge.avg.publisher-audio-release-native-test-export')
  expect(exported.version).toBe(1); expect(createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex')).toBe(exported.backupSHA256)
  expect(exported.expected.originalSource.version).toBe(2); expect(exported.expected.providerResult.version).toBe(2)
  expect(exported.expected.providerResult.licenseEvidence.publisherPageHash).toBe(exported.expected.originalSource.publisherPageHash)
  const requests: string[] = []
  await page.route('**/*', route => {
    const request = route.request(), u = new URL(request.url())
    if (!['GET','HEAD'].includes(request.method()) || ['5297','5298','11434'].includes(u.port)
      || u.protocol.startsWith('http') && !['127.0.0.1','localhost'].includes(u.hostname)) {
      requests.push(`${request.method()} ${u.origin}${u.pathname}`); return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed','e2e'))
  await page.goto('./avg/library')
  const copied = await page.evaluate(async ({ backup, expected }) => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const [drafts, files, { db }, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/stores/ai-config.ts')])
    const occupied = Math.max(expected.scope.projectId,expected.scope.workId)
    if (!Number.isSafeInteger(occupied) || occupied < 1 || occupied > 32) throw new Error('Publisher fixture owner range exceeded')
    for (let i=0;i<occupied;i++) await drafts.createAvgDraftV1(`原发布页声音恢复的隔离占位作品 ${i+1}`)
    config.useAIConfigStore.getState().setConfig({ provider:'agnes',baseUrl:'https://sound-proposal.fixture.invalid/v1',apiKey:'',model:'agnes-2.5-flash' })
    const projectId = await files.importProjectJSON(backup), records = await db.productReleases.where('projectId').equals(projectId).toArray()
    const matches = records.filter((r:any)=>JSON.parse(r.manifestJson).lineage.releaseUid===expected.releaseUid)
    if (matches.length!==1) throw new Error('Missing or ambiguous exact original publisher Release')
    const record = matches[0]
    return { projectId,worldId:record.worldId,workId:record.workId,releaseId:record.id,manifestJson:record.manifestJson,
      counts:[await db.productBuilds.count(),await db.agentRuns.count(),await db.productQualityGateReceipts.count(),await db.productProductionCommands.count(),await db.productReleases.count()] }
  },{ backup:exported.backup,expected:exported.expected })
  expect(copied.projectId).not.toBe(exported.expected.scope.projectId); expect(copied.workId).not.toBe(exported.expected.scope.workId)
  expect(copied.manifestJson).toBe(exported.expected.manifestJson)
  await page.goto(`./avg/production?project=${copied.projectId}&work=${copied.workId}&assembly=1`)
  await page.getByRole('button',{name:'制作与试玩',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'当前生成、采用与本地原型验收关闭'})).toBeVisible()
  const panel = page.getByRole('region',{name:'本地原型版本验收',exact:true})
  await expect(panel.getByRole('button',{name:'准备本地原型版本',exact:true})).toHaveCount(0)
  await panel.getByRole('button',{name:'从此版本开始新存档',exact:true}).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  const playing = () => page.locator('audio[data-channel="ambience"]').evaluateAll(rows=>rows.some(a=>!(a as HTMLAudioElement).paused&&(a as HTMLAudioElement).currentTime>.1))
  await expect.poll(playing,{timeout:30_000}).toBe(true)
  await expect(page.locator('audio[data-channel="ambience"]')).toHaveJSProperty('loop',false)
  await page.reload()
  const recovery = page.getByRole('status',{name:'环境音恢复',exact:true})
  await expect(recovery).toContainText('上次声音播放未确认结束。',{timeout:30_000})
  await expect.poll(playing).toBe(false)
  await recovery.getByRole('button',{name:'重新播放声音片段',exact:true}).click()
  await expect.poll(playing,{timeout:30_000}).toBe(true)
  const read = await page.evaluate(async ({scope,sessionId})=>{
    const load = new Function('p','return import(p)') as (p:string)=>Promise<any>
    const [{db},pkg,module,media,hash,config]=await Promise.all([load('/storyforge/src/lib/db/schema.ts'),load('/storyforge/src/lib/product-production/runtime-package.ts'),
      load('/storyforge/src/lib/avg/executable-module.ts'),load('/storyforge/src/lib/product-production/release-media.ts'),load('/storyforge/src/lib/avg/sound-provider-contract.ts'),load('/storyforge/src/stores/ai-config.ts')])
    const record=await db.productReleases.get(scope.releaseId),manifest=await pkg.verifyProductReleaseManifest(record.manifestJson),assets=module.avgRuntimeStage(manifest.runtimePackage).assets
    const hashes=[]
    for(const asset of assets) hashes.push({assetKey:asset.assetKey,hash:await hash.hashAvgSoundBytesV1(await media.readProductReleaseMediaBytes({scope,productReleaseId:record.id,asset}))})
    const builds=await db.productBuilds.where('projectId').equals(scope.projectId).filter((b:any)=>b.releasedProductReleaseId===record.id).toArray()
    if(builds.length!==1) throw new Error('Missing or ambiguous exact publisher release Build')
    const raw=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([builds[0].id,'avg.sound.raw.native.ambience']).first()
    return {hashes,raw:JSON.parse(raw.payloadJson),session:await db.productRuntimeSessions.get(sessionId),hasKey:!!config.useAIConfigStore.getState().config.apiKey,
      counts:[await db.productBuilds.count(),await db.agentRuns.count(),await db.productQualityGateReceipts.count(),await db.productProductionCommands.count(),await db.productReleases.count()]}
  },{scope:copied,sessionId})
  expect(read.session.productReleaseId).toBe(copied.releaseId);expect(read.session.productBuildId).toBeNull();expect(read.hasKey).toBe(false)
  expect(read.raw.requirement.dispatch.source).toEqual(exported.expected.originalSource);expect(read.raw.providerResult).toEqual(exported.expected.providerResult)
  expect(read.counts).toEqual(copied.counts);expect(read.hashes).toEqual(exported.expected.assets.map((a:any)=>({assetKey:a.assetKey,hash:a.blobContentHash})))
  expect(requests).toEqual([])
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath('native-publisher-release-closed-factory.png')})
  expect(createHash('sha256').update(await readFile(process.env.AVG_SOUND_PUBLISHER_RELEASE_BACKUP_FILE!)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
})
