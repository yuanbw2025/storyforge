import { expect, test, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { avgSoundCapabilityFixtureV1, avgSoundLibraryFixtureV1, avgSoundPcmFixtureV1, avgSoundMusicResultFixtureV1 } from '../helpers/avg-sound-wire-data'
import { avgSoundPublisherFixtureV2 } from '../helpers/avg-sound-publisher-fixture'

test.setTimeout(300_000)
test.skip(process.env.VITE_STORYFORGE_AVG_SOUND_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_SOUND_PREPARATION !== '1', 'Explicit experimental Sound build only; default factory remains closed')

/** Only provider HTTP is controlled. Work/Brief/start, registered model Run,
 * author candidates/adoption, original bytes, DOM decoding/output and preview
 * all use actual commands. Engineering assessments are not real hearing. */
async function open(page: Page, publisher = false) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    const w = window as any; w.__avgNativeSoundWitness = { sources: [], html: [] }
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args), context = source.context as AudioContext, row: any = {}
      const start = source.start.bind(source), stop = source.stop.bind(source), disconnect = source.disconnect.bind(source)
      context.addEventListener('statechange', () => { row.contextState = context.state })
      source.start = ((...a: Parameters<AudioBufferSourceNode['start']>) => {
        Object.assign(row, { duration: source.buffer?.duration, frames: source.buffer?.length, sampleRate: source.buffer?.sampleRate, rate: source.playbackRate.value, loop: source.loop,
          start: a[0], outputAtStart: context.getOutputTimestamp().contextTime }); w.__avgNativeSoundWitness.sources.push(row); start(...a)
      }) as typeof source.start
      source.stop = (...a) => { if (typeof a[0] === 'number') row.scheduledStop = a[0]; else row.immediateStop = true; stop(...a) }
      source.disconnect = ((...a: any[]) => { row.disconnected = true; (disconnect as (...args: any[]) => void)(...a) }) as typeof source.disconnect
      source.addEventListener('ended', e => { row.ended = e.isTrusted; row.renderEnd = context.currentTime })
      return source
    }
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if ((this as HTMLElement).dataset.channel) {
        for (const kind of ['playing', 'ended']) this.addEventListener(kind, event => w.__avgNativeSoundWitness.html.push({ kind, channel: (this as HTMLElement).dataset.channel,
          trusted: event.isTrusted, loop: this.loop, src: this.currentSrc, duration: this.duration, currentTime: this.currentTime }), { once: true })
      }
      return play.call(this)
    }
  })
  await page.goto('./avg/library')
  const state = await page.evaluate(async publisher => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, editor, presets, worlds, config, sound, catalog] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/avg/editor-service.ts'),
      load('/storyforge/src/lib/avg/authoring-presets.ts'), load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'), load('/storyforge/src/stores/ai-config.ts'),
      load('/storyforge/src/lib/avg/sound-draft-service.ts'), load('/storyforge/src/lib/avg/sound-provider-contract.ts')])
    const owner = await drafts.createAvgDraftV1('原生声音完整工程验收'), world = await worlds.createMistHarborWorld()
    const selected = await drafts.selectAvgWorldV1(owner.scope, 0, world.worldReleaseId), workspace = presets.createAvgAuthoringPresetV1('linear')
    const saved = await editor.saveAvgAuthorWorkspaceV1(owner.scope, selected.revision, workspace), script = workspace.scripts[0], line = script.lines[0]
    const source = publisher ? catalog.listAvgSoundLibraryMetadataV2().find((s: any) => s.memberPath === 'rain.ogg')
      : catalog.listAvgSoundLibraryMetadataV1().find((s: any) => s.memberPath === 'Audio/click_001.ogg')
    const templates = (publisher ? ['ambience'] : ['bgm', 'sfx', 'ambience']).map((channel, i) => ({ requirementKey: `native.${channel}`, assetKey: `native.${channel}`, channel,
      purpose: `ENGINEERING ${channel} 原生制作与消费检查`, constraints: ['ENGINEERING original or licensed only'],
      consumer: { consumerKey: `native.${channel}.consumer`, domain: 'stage', slot: channel, subjectKey: script.sceneKey, sceneKey: script.sceneKey, lineKey: null, required: true, fallback: 'none' },
      cue: { cueKey: `native.${channel}.cue`, beatKey: line.lineKey, phase: i ? 'during' : 'before', order: 10 + i, volume: i ? .6 : .2, loop: !publisher && channel !== 'sfx' },
      source: publisher || i ? { kind: 'licensed-library', allowedSourceKeys: [source.sourceKey] } : { kind: 'generate-music', durationSeconds: 12, seed: 103, bpm: 68, keyscale: 'A Minor' } }))
    await sound.saveAvgSoundProductionDraftV1({ scope: owner.scope, expectedDraftRevision: saved.revision, planning: {
      schema: 'storyforge.avg.sound-planning-scope', version: 1, templates, librarySources: [source] } })
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'isolated-engineering-route-no-external-account', model: 'agnes-2.5-flash' })
    return { scope: owner.scope, workspace, plan: { schema: 'storyforge.avg.sound-plan', version: 1,
      direction: { goal: 'ENGINEERING original instrumental and licensed click', dialogueSpace: 'Leave space for dialogue', continuity: 'Use one bounded original source' },
      entries: templates.map(t => ({ requirementKey: t.requirementKey, designIntent: 'ENGINEERING original purpose',
        prompt: t.channel === 'bgm' ? 'Original calm instrumental piano, quiet spacious arrangement, no lyrics or voices' : null,
        librarySourceKey: t.channel !== 'bgm' ? source.sourceKey : null, acceptanceNotes: ['ENGINEERING inspect original exact clip'] })) } }
  }, publisher)
  const counts = { text: 0, music: 0, library: 0, capabilities: 0, unknown: [] as string[] }, capability = avgSoundCapabilityFixtureV1(), library = publisher ? avgSoundPublisherFixtureV2() : avgSoundLibraryFixtureV1()
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, Authorization, X-Storyforge-Idempotency-Key',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'X-Storyforge-Music-Result, X-Storyforge-Library-Result, X-Request-Id' }
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url())
    if (!['5298', '5297'].includes(u.port) && u.hostname !== 'sound-proposal.fixture.invalid') return route.continue()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (u.href === 'https://sound-proposal.fixture.invalid/v1/chat/completions') {
      counts.text++; return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(state.plan) } }], usage: { prompt_tokens: 200, completion_tokens: 200 } }, headers: cors })
    }
    if (u.href === 'http://127.0.0.1:5298/v1/capabilities') { counts.capabilities++; return route.fulfill({ json: capability, headers: cors }) }
    if (u.href === 'http://127.0.0.1:5298/v1/audio/music' && req.method() === 'POST') {
      counts.music++; const body = req.postDataJSON(), data = avgSoundPcmFixtureV1(body.durationSeconds)
      const result = await avgSoundMusicResultFixtureV1({ capability, data, body, idempotencyKey: req.headers()['x-storyforge-idempotency-key'] })
      return route.fulfill({ body: Buffer.from(data), headers: { ...cors, 'content-type': 'audio/wav', 'x-request-id': result.jobId, 'x-storyforge-music-result': JSON.stringify(result) } })
    }
    if (u.href === `http://127.0.0.1:5298/v1/library/audio/${library.source.archiveHash}/${library.source.memberHash}`) {
      counts.library++; return route.fulfill({ body: Buffer.from(library.data), headers: { ...cors, 'content-type': 'audio/ogg', 'x-storyforge-library-result': JSON.stringify(library.result) } })
    }
    counts.unknown.push(u.href); return route.abort('blockedbyclient')
  })
  await page.goto(`./avg/media-all?project=${state.scope.projectId}&work=${state.scope.workId}&assembly=1`)
  return { ...state, counts }
}
async function tab(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click() }
async function adopt(page: Page, label: string) {
  const card = page.getByRole('article', { name: `作者确认：${label}`, exact: true })
  await card.getByRole('button', { name: `保存候选：${label}`, exact: true }).click()
  await card.getByRole('checkbox', { name: '我已核对该候选内容及素材来源授权', exact: true }).check()
  await card.getByRole('button', { name: `确认采用：${label}`, exact: true }).click()
  await expect(card.getByText('已采用 v1', { exact: true })).toBeVisible()
}
async function produced(page: Page, publisher = false) {
  const s = await open(page, publisher)
  await page.getByRole('button', { name: '核对并准备声音制作', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '声音制作方案已保存' })).toBeVisible()
  await tab(page, '制作与试玩')
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已明确开始' })).toBeVisible()
  await page.getByRole('textbox', { name: '作者输入声明', exact: true }).fill('ENGINEERING actual author checks and original source permission; no real hearing or commercial acceptance')
  await adopt(page, '系统规则')
  for (const scene of s.workspace.systemPlan.scenes) await adopt(page, `场景：${scene.title}`)
  await tab(page, '素材')
  const panel = page.getByRole('region', { name: '声音生产工作台', exact: true })
  await panel.getByRole('button', { name: '生成本批声音方案', exact: true }).click()
  const plan = panel.getByRole('region', { name: '声音方案确认', exact: true })
  await expect(plan.getByRole('textbox', { name: '声音方向', exact: true })).toBeVisible({ timeout: 30_000 })
  await plan.getByRole('textbox', { name: '声音方向', exact: true }).fill('ENGINEERING author retained original proposal and checked this edited direction')
  await plan.getByRole('button', { name: '保存为待确认声音方案', exact: true }).click()
  await plan.getByRole('checkbox', { name: '我已核对声音方案、来源范围与投入边界', exact: true }).check()
  await plan.getByRole('button', { name: '确认采用声音方案', exact: true }).click()
  await expect(plan.getByText('已采用声音方案 v1', { exact: true })).toBeVisible()
  await page.evaluate(async () => { const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>; (await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({ apiKey: '' }) })
  await panel.getByRole('button', { name: '继续本批声音制作', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看并审听原声音', exact: true })).toHaveCount(publisher ? 1 : 3, { timeout: 60_000 })
  expect(s.counts.text).toBe(1); expect(s.counts.music).toBe(publisher ? 0 : 1); expect(s.counts.library).toBe(publisher ? 1 : 2); expect(s.counts.unknown).toEqual([])
  return { ...s, panel }
}
async function review(page: Page, channel: string) {
  const row = page.getByRole('article', { name: `声音用途 native.${channel}`, exact: true })
  await row.getByRole('button', { name: '查看并审听原声音', exact: true }).click()
  const panel = row.getByRole('region', { name: '声音审听与选择', exact: true })
  await expect(panel.getByRole('button', { name: '从头审听原声音', exact: true })).toBeVisible({ timeout: 30_000 })
  return panel
}
async function confirmObservation(panel: Locator) {
  await panel.getByRole('button', { name: '保存为待确认声音观察', exact: true }).click()
  await panel.getByRole('button', { name: '确认这份声音观察', exact: true }).click()
  await expect(panel.getByText(/已确认声音观察 v\d+/)).toBeVisible()
}
async function passed(panel: Locator, channel: 'bgm' | 'sfx' | 'ambience', loop = channel !== 'sfx') {
  await panel.getByRole('button', { name: '从头审听原声音', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: `原声音已完整原速播放 ${loop ? 2 : 1} 遍` })).toBeVisible({ timeout: 40_000 })
  const labels = ['符合用途', '噪音与失真', '首尾完整', ...(channel === 'bgm' ? ['纯器乐无歌词'] : []), ...(loop ? ['循环接缝'] : [])]
  for (const label of labels) await panel.getByRole('combobox', { name: label, exact: true }).selectOption('pass')
  for (const input of await panel.getByRole('textbox', { name: '观察依据', exact: true }).all()) await input.fill('ENGINEERING native functional observation, not an actual listener judgment')
  await panel.getByRole('textbox', { name: '本轮声音审听依据', exact: true }).fill(`ENGINEERING new native ${loop ? 'continuous loop' : 'full clip'} observation; no real hearing or commercial proof`)
  await confirmObservation(panel)
  await panel.getByRole('button', { name: '将原声音列为待确认选择', exact: true }).click()
  await panel.getByRole('button', { name: '确认采用原声音', exact: true }).click()
  await expect(panel.getByText('已采用声音 v1。舞台配置和演出确认仍须另行完成。', { exact: true })).toBeVisible()
}

test('native publisher-page V2 original audio keeps unknown hearing through actual decoding, playback and portable raw recovery without a Key or music request', async ({ page }, info) => {
  const s = await produced(page, true), actual = avgSoundPublisherFixtureV2(), panel = await review(page, 'ambience')
  await panel.getByRole('button', { name: '从头审听原声音', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '原声音已完整原速播放 1 遍' })).toBeVisible({ timeout: 20_000 })
  for (const label of ['符合用途', '噪音与失真', '首尾完整']) {
    await expect(panel.getByRole('combobox', { name: label, exact: true })).toHaveValue('unknown')
  }
  await expect(panel.getByRole('button', { name: '将原声音列为待确认选择', exact: true })).toBeDisabled()
  const original = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, drafts, media] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts')])
    const draft = await drafts.readAvgDraftV1(scope), build = await db.productBuilds.where('productionId').equals(draft.productionId).first()
    const rows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray(), row = rows.find((r: any) => r.artifactKey === 'avg.sound.raw.native.ambience' && r.status === 'accepted')
    const data = await media.readVerifiedMediaBlobObjectData(await db.mediaBlobObjects.get(row.blobObjectId))
    return { raw: JSON.parse(row.payloadJson), quality: JSON.parse(row.qualityJson), contentHash: row.contentHash, dataHash: await media.sha256MediaData(data),
      noReviewOrChoice: !rows.some((r: any) => r.artifactKey.startsWith('avg.review.audio.') || r.artifactKey.startsWith('avg.sound.choice.')),
      hasKey: !!(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().config.apiKey,
      witness: (window as any).__avgNativeSoundWitness }
  }, s.scope)
  expect(original.hasKey).toBe(false); expect(original.noReviewOrChoice).toBe(true)
  expect(original.contentHash).toBe(actual.source.memberHash); expect(original.dataHash).toBe(actual.source.memberHash)
  expect(original.raw.providerResult).toEqual(actual.result); expect(original.raw.requirement.dispatch.source).toEqual(actual.source)
  expect(original.raw.measurement).toMatchObject({ mimeType: 'audio/ogg', byteSize: actual.data.byteLength, durationMs: 3991, channelCount: 2, decodedSampleRateHz: 48000 })
  expect(original.quality).toMatchObject({ hearing: 'unobserved', authorAdopted: false })
  expect(original.witness.sources.some((r: any) => r.ended && r.rate === 1 && !r.loop && Math.abs(r.duration - 3.990666666666667) < .01)).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.getByRole('heading', { name: /准确声音/ }).scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('native-publisher-original-unknown-hearing.png') })
  await page.reload(); await tab(page, '素材')
  await expect(page.getByRole('button', { name: '查看并审听原声音', exact: true })).toHaveCount(1)
  const lifecycle = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, files, owners, proof, media] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/workspace/lifecycle.ts'), load('/storyforge/src/lib/avg/sound-production-admission.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts')])
    const before = await files.exportProjectJSON(scope.projectId), copyId = await files.importProjectJSON(before)
    const build = await db.productBuilds.where('projectId').equals(copyId).first(), copyScope = { projectId: copyId, workId: build.workId, worldId: build.worldId }
    const row = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id, 'avg.sound.raw.native.ambience']).first()
    const raw = JSON.parse(row.payloadJson), key = 'avg.sound.generate.native.ambience', ledger = JSON.parse(build.budgetLedgerJson).tasks[key]
    const response = await proof.readAvgSoundOriginalMediaResponseV1({ scope: copyScope, producerRunId: row.producerRunId, taskKey: key,
      requirement: raw.requirement, responseEvidenceHash: raw.responseEvidenceHash, idempotencyKey: ledger.idempotencyKey, musicBinding: null })
    const copyHash = await media.sha256MediaData(response.data)
    await owners.deleteWork(copyScope.workId)
    const after = await files.exportProjectJSON(scope.projectId)
    return { copyId, copyWorkId: copyScope.workId, copyHash, rawSource: raw.requirement.dispatch.source, providerResult: raw.providerResult,
      originalUnchanged: JSON.stringify({ ...before, exportedAt: 0 }) === JSON.stringify({ ...after, exportedAt: 0 }),
      releases: await db.productReleases.count() }
  }, s.scope)
  expect(lifecycle.copyId).not.toBe(s.scope.projectId); expect(lifecycle.copyWorkId).not.toBe(s.scope.workId)
  expect(lifecycle.copyHash).toBe(actual.source.memberHash); expect(lifecycle.rawSource).toEqual(actual.source); expect(lifecycle.providerResult).toEqual(actual.result)
  expect(lifecycle.originalUnchanged).toBe(true); expect(lifecycle.releases).toBe(0)
  expect(s.counts).toEqual({ text: 1, music: 0, library: 1, capabilities: 0, unknown: [] })
})

test('native publisher-page V2 engineering choice independently configures ambience Stage and original Release for exact closed-factory export without generating music', async ({ page }, info) => {
  const s = await produced(page, true), actual = avgSoundPublisherFixtureV2(), observation = await review(page, 'ambience')
  await expect(observation.getByRole('combobox', { name: '符合用途', exact: true })).toHaveValue('unknown')
  await expect(observation.getByRole('button', { name: '将原声音列为待确认选择', exact: true })).toBeDisabled()
  // These are explicit isolated ENGINEERING author declarations. They test
  // current-use authority after actual playback, never this sample's real
  // hearing/commercial acceptance or the author's existing real workspace.
  await passed(observation, 'ambience', false)
  await s.panel.getByRole('button', { name: '将已采用声音配置到演出草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已采用声音已配置到准确台词触发拍和通道' })).toBeVisible()
  await tab(page, '制作与试玩'); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '新预览已冻结' })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const previewSession = Number(new URL(page.url()).searchParams.get('session'))
  await expect.poll(() => page.locator('audio[data-channel="ambience"]').evaluateAll(rows => rows.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1))).toBe(true)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '打开灯光', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText('灯光亮起')
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
  }, previewSession)).toBe(true)
  await page.goto(`./avg/production?project=${s.scope.projectId}&work=${s.scope.workId}&assembly=1`)
  await tab(page, '制作与试玩')
  const release = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await release.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check()
  await release.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click()
  await expect(release.getByText(/完整路线：已确认/)).toBeVisible()
  await release.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click()
  await expect(release.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible({ timeout: 60_000 })
  await release.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(release.getByRole('status').filter({ hasText: '本地原型版本已准备，请核对后保存。' })).toBeVisible({ timeout: 60_000 })
  await expect(release.getByRole('button', { name: '确认保存本地原型版本', exact: true })).toBeDisabled()
  await release.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check()
  await release.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click()
  await expect(release.getByText('此版本已冻结；后续修改请创建新 Build。', { exact: true })).toBeVisible({ timeout: 60_000 })
  const exported = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, files, pkg, module, config] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/product-production/runtime-package.ts'), load('/storyforge/src/lib/avg/executable-module.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const build = await db.productBuilds.where('workId').equals(scope.workId).first(), record = await db.productReleases.get(build.releasedProductReleaseId)
    const manifest = await pkg.verifyProductReleaseManifest(record.manifestJson), raw = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id,'avg.sound.raw.native.ambience']).first()
    const body = JSON.parse(raw.payloadJson), final = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id,'avg.media.0']).first()
    return { backup: await files.exportProjectJSON(scope.projectId), expected: { scope, releaseId: record.id, releaseUid: manifest.lineage.releaseUid,
      manifestJson: record.manifestJson, assets: module.avgRuntimeStage(manifest.runtimePackage).assets, originalSource: body.requirement.dispatch.source,
      providerResult: body.providerResult, finalRights: JSON.parse(final.rightsJson), sameBlob: final.blobObjectId === raw.blobObjectId,
      frozenQA: JSON.parse(build.qualityReportJson).releaseReady, hasKey: !!config.useAIConfigStore.getState().config.apiKey } }
  }, s.scope)
  expect(exported.expected.originalSource).toEqual(actual.source); expect(exported.expected.providerResult).toEqual(actual.result)
  expect(exported.expected.finalRights.originalRights.source).toEqual(actual.source)
  expect(exported.expected.sameBlob).toBe(true); expect(exported.expected.frozenQA).toBe(false); expect(exported.expected.hasKey).toBe(false)
  expect(exported.expected.assets).toHaveLength(1); expect(exported.expected.assets[0]).toMatchObject({ kind: 'ambience', blobContentHash: actual.source.memberHash, license: 'CC0-1.0' })
  await release.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  await expect.poll(() => page.locator('audio[data-channel="ambience"]').evaluateAll(rows => rows.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1))).toBe(true)
  const releasedSession = Number(new URL(page.url()).searchParams.get('session'))
  const pinned = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/src/lib/db/schema.ts')).db.productRuntimeSessions.get(id)
  }, releasedSession)
  expect(pinned.productReleaseId).toBe(exported.expected.releaseId); expect(pinned.productBuildId).toBeNull()
  expect(releasedSession).not.toBe(previewSession)
  await page.screenshot({ path: info.outputPath('native-publisher-original-release.png') })
  expect(s.counts).toEqual({ text: 1, music: 0, library: 1, capabilities: 0, unknown: [] })
  const exportPath = process.env.AVG_SOUND_PUBLISHER_RELEASE_BACKUP_FILE ?? info.outputPath('publisher-original-release.json')
  await mkdir(dirname(exportPath), { recursive: true })
  await writeFile(exportPath, JSON.stringify({ schema: 'storyforge.avg.publisher-audio-release-native-test-export', version: 1, ...exported,
    backupSHA256: createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex') }), { flag: 'wx' })
})

test('native original sound plan, actual continuous audition, independent author choices and original Preview remain usable without a text Key', async ({ page }, info) => {
  const s = await produced(page), bgm = await review(page, 'bgm')
  await page.setViewportSize({ width: 390, height: 844 })
  for (const control of await bgm.locator('textarea, select, input').all()) {
    const box = await control.boundingBox()
    if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(391) }
  }
  await bgm.getByRole('heading', { name: /准确声音/ }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('native-sound-review-390px.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(bgm.getByRole('combobox', { name: '循环接缝', exact: true }).getByRole('option', { name: '通过', exact: true })).toHaveJSProperty('disabled', true)
  await bgm.getByRole('textbox', { name: '本轮声音审听依据', exact: true }).fill('ENGINEERING did not observe any audio; keep every check unknown')
  await confirmObservation(bgm)
  await expect(bgm.getByRole('button', { name: '将原声音列为待确认选择', exact: true })).toBeDisabled()
  await passed(bgm, 'bgm')
  await passed(await review(page, 'sfx'), 'sfx')
  await passed(await review(page, 'ambience'), 'ambience')
  await s.panel.getByRole('button', { name: '将已采用声音配置到演出草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已采用声音已配置到准确台词触发拍和通道' })).toBeVisible()
  await page.locator('.avg-assembly-media-row').filter({ hasText: ' · 音乐' }).getByRole('button').first().click()
  const selected = page.locator('figure.avg-assembly-media-preview audio')
  await expect.poll(async () => selected.evaluate(a => (a as HTMLAudioElement).readyState)).toBeGreaterThan(0)
  expect(await selected.evaluate(async element => {
    const data = await (await fetch((element as HTMLAudioElement).currentSrc)).arrayBuffer()
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('')
  })).toBe(createHash('sha256').update(new Uint8Array(avgSoundPcmFixtureV1())).digest('hex'))
  await page.screenshot({ path: info.outputPath('native-sound-workbench-configured.png') })
  await tab(page, '制作与试玩'); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '新预览已冻结' })).toBeVisible({ timeout: 60_000 })
  const receipt = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, drafts] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/avg/draft-service.ts')])
    const draft = await drafts.readAvgDraftV1(scope), build = await db.productBuilds.where('productionId').equals(draft.productionId).first(), rows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
    return { build, rows: rows.filter((r: any) => r.status === 'accepted'), draft: JSON.parse(draft.editorJson), aliases: await db.avgDraftMedia.count(), witness: (window as any).__avgNativeSoundWitness }
  }, s.scope)
  expect(receipt.build.status).toBe('preview-ready'); expect(receipt.build.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  expect(receipt.aliases).toBe(0); expect(receipt.draft.presentation.stage.assets).toHaveLength(3)
  const observed = receipt.rows.find((r: any) => r.artifactKey === 'avg.review.audio.native.bgm')
  expect(JSON.parse(observed.payloadJson).soundEvidence.audition).toMatchObject({ outcome: 'ended', playedMs: 24000, completedCycles: 2, continuousLoops: 1, playbackRate: 1, muted: false, seeked: false })
  const loop = receipt.witness.sources.find((r: any) => r.loop && r.duration === 12)
  expect(loop).toMatchObject({ rate: 1, duration: 12, ended: true })
  expect(loop.frames).toBe(12 * loop.sampleRate); expect(loop.scheduledStop - loop.start).toBeCloseTo(24, 5)
  const raw = receipt.rows.find((r: any) => r.artifactKey === 'avg.sound.raw.native.bgm')
  expect(raw.contentHash).toBe(createHash('sha256').update(new Uint8Array(avgSoundPcmFixtureV1())).digest('hex'))
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(elements => elements.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  await expect.poll(async () => page.locator('audio[data-channel="ambience"]').evaluateAll(elements => elements.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).loop)), { timeout: 10_000 }).toBe(true)
  await expect.poll(async () => page.evaluate(() => (window as any).__avgNativeSoundWitness.html.some((e: any) => e.channel === 'sfx' && e.kind === 'ended' && e.trusted)), { timeout: 10_000 }).toBe(true)
  expect(s.counts.text).toBe(1); expect(s.counts.music).toBe(1); expect(s.counts.library).toBe(2)
  await page.screenshot({ path: info.outputPath('native-sound-joint-preview.png') })
  const copy = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [files, { db }] = await Promise.all([load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const projectId = await files.importProjectJSON(await files.exportProjectJSON(scope.projectId))
    const draft = await db.avgAuthoringDrafts.where('projectId').equals(projectId).first()
    return { projectId, workId: draft.workId, worldId: draft.worldId, productionId: draft.productionId }
  }, s.scope)
  expect(copy.projectId).not.toBe(s.scope.projectId); expect(copy.workId).not.toBe(s.scope.workId)
  await page.goto(`./avg/production?project=${copy.projectId}&work=${copy.workId}&assembly=1`)
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '复验导入声音证明', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '导入声音完成记录已在当前作品复验' })).toBeVisible({ timeout: 60_000 })
  const restored = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.where('productionId').equals(scope.productionId).first()
    return { preview: build.previewManifestJson, packageHash: build.packageHash, aliases: await db.avgDraftMedia.count() }
  }, copy)
  expect(restored.preview).toBe(receipt.build.previewManifestJson); expect(restored.packageHash).toBe(receipt.build.packageHash); expect(restored.aliases).toBe(0)
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(elements => elements.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  await page.goto(`./avg/production?project=${s.scope.projectId}&work=${s.scope.workId}&assembly=1`)
  await page.evaluate(async workId => { const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>; await (await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId) }, copy.workId)
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(elements => elements.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  expect(s.counts.text).toBe(1); expect(s.counts.music).toBe(1); expect(s.counts.library).toBe(2); expect(s.counts.unknown).toEqual([])

  // Complete an actual Preview route. The separate route confirmation,
  // full native catalog scan and publication all use the existing controls.
  const previewSession = Number(new URL(page.url()).searchParams.get('session'))
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '打开灯光', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText('灯光亮起')
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
  }, previewSession)).toBe(true)
  await page.goto(`./avg/production?project=${s.scope.projectId}&work=${s.scope.workId}&assembly=1`)
  await tab(page, '制作与试玩')
  const release = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await expect(release).toBeVisible()
  await release.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check()
  await release.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click()
  await expect(release.getByText(/完整路线：已确认/)).toBeVisible()
  await release.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(release.getByRole('alert')).toBeVisible()
  await release.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click()
  await expect(release.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible({ timeout: 60_000 })
  await release.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(release.getByRole('button', { name: '确认保存本地原型版本', exact: true })).toBeDisabled()
  await release.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check()
  await release.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click()
  await expect(release.getByText('此版本已冻结；后续修改请创建新 Build。', { exact: true })).toBeVisible({ timeout: 60_000 })
  const exported = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, files, pkg, module, config] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/product-production/runtime-package.ts'), load('/storyforge/src/lib/avg/executable-module.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const build = await db.productBuilds.where('workId').equals(scope.workId).first(), record = await db.productReleases.get(build.releasedProductReleaseId)
    const manifest = await pkg.verifyProductReleaseManifest(record.manifestJson), gates = await db.productQualityGateReceipts.where('buildId').equals(build.id).toArray()
    const media = gates.find((row: any) => JSON.parse(row.receiptJson).verifierId === 'storyforge.browser-media-runtime')
    return { backup: await files.exportProjectJSON(scope.projectId), expected: { scope, releaseId: record.id, releaseUid: manifest.lineage.releaseUid,
      manifestJson: record.manifestJson, packageHash: build.packageHash, previewJson: build.previewManifestJson, assets: module.avgRuntimeStage(manifest.runtimePackage).assets,
      nativeMedia: JSON.parse(JSON.parse(media.receiptJson).measuredJson), frozenQA: JSON.parse(build.qualityReportJson).releaseReady,
      hasTextKey: !!config.useAIConfigStore.getState().config.apiKey } }
  }, s.scope)
  expect(exported.expected.hasTextKey).toBe(false); expect(exported.expected.frozenQA).toBe(false)
  expect(exported.expected.previewJson).toBe(receipt.build.previewManifestJson)
  expect(exported.expected.nativeMedia.assets).toHaveLength(3)
  expect(exported.expected.nativeMedia.assets.every((a: any) => a.status === 'decoded' && a.decodedSampleRateHz > 0)).toBe(true)
  await release.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(elements => elements.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  const releasedSession = Number(new URL(page.url()).searchParams.get('session'))
  const pinned = await page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/src/lib/db/schema.ts')).db.productRuntimeSessions.get(id)
  }, releasedSession)
  expect(pinned.productReleaseId).toBe(exported.expected.releaseId); expect(pinned.productBuildId).toBeNull()
  expect(releasedSession).not.toBe(previewSession)
  await page.screenshot({ path: info.outputPath('native-sound-release-playing.png') })
  expect(s.counts.text).toBe(1); expect(s.counts.music).toBe(1); expect(s.counts.library).toBe(2); expect(s.counts.unknown).toEqual([])
  // Export only after every actual publication/playback assertion passed;
  // do not let a failed earlier attempt supply the next closed-build test.
  const exportPath = process.env.AVG_SOUND_RELEASE_BACKUP_FILE ?? info.outputPath('original-sound-native-release.json')
  await mkdir(dirname(exportPath), { recursive: true })
  await writeFile(exportPath, JSON.stringify({ schema: 'storyforge.avg.sound-release-native-test-export', version: 1, ...exported,
    backupSHA256: createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex') }), { flag: 'wx' })
})

test('native explicit sound inheritance creates a separately adopted revision and release with original audio and no generation requests', async ({ page }, info) => {
  test.skip(!process.env.AVG_SOUND_RELEASE_BACKUP_FILE, 'Requires the preceding actual native publication export')
  const sourceBytes = await readFile(process.env.AVG_SOUND_RELEASE_BACKUP_FILE!), exported = JSON.parse(sourceBytes.toString())
  expect(createHash('sha256').update(JSON.stringify(exported.backup)).digest('hex')).toBe(exported.backupSHA256)
  const requests: string[] = []
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (['5297', '5298', '11434'].includes(u.port) || !['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) {
      requests.push(u.href); return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const saved = await page.evaluate(async backup => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, files, { db }, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/stores/ai-config.ts')])
    await drafts.createAvgDraftV1('沿用声音的隔离占位作品')
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: '', model: 'agnes-2.5-flash' })
    const projectId = await files.importProjectJSON(backup), build = await db.productBuilds.where('projectId').equals(projectId).first()
    return { scope: { projectId, worldId: build.worldId, workId: build.workId }, productionId: build.productionId, old: build,
      oldRelease: await db.productReleases.get(build.releasedProductReleaseId), runs: await db.agentRuns.where('workId').equals(build.workId).toArray() }
  }, exported.backup)
  await page.goto(`./avg/production?project=${saved.scope.projectId}&work=${saved.scope.workId}&assembly=1`)
  await tab(page, '制作与试玩')
  await page.getByRole('button', { name: '复验导入声音证明', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '以此预览开始修订', exact: true }).click()
  await page.getByRole('button', { name: '保存编辑草稿', exact: true }).click()
  await tab(page, '素材')
  await page.getByRole('button', { name: '保留已采用声音，结束本批需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已保留原声音与播放用途' })).toBeVisible()
  await tab(page, '对白与选择')
  const text = page.getByRole('textbox', { name: /第1句$/, exact: false }).first()
  await text.fill((await text.inputValue()) + ' 修订仅调整对白，保持原声音用途。')
  await page.getByRole('button', { name: '保存编辑草稿', exact: true }).click()
  await tab(page, '制作与试玩')
  await page.getByRole('button', { name: '准备新版本方案', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await adopt(page, '系统规则')
  const sceneLabels = await page.getByRole('article', { name: /^作者确认：场景：/ }).getByRole('heading').allTextContents()
  for (const label of sceneLabels) await adopt(page, label)
  await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled({ timeout: 60_000 })
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page).toHaveURL(/[?&]session=[1-9]\d*(?:&|$)/)
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(rows => rows.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  await expect(page.locator('audio[data-channel="ambience"]')).toHaveJSProperty('loop', true)
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '打开灯光', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText('灯光亮起')
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
  }, sessionId)).toBe(true)
  await page.goto(`./avg/production?project=${saved.scope.projectId}&work=${saved.scope.workId}&assembly=1`)
  await tab(page, '制作与试玩')
  const release = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await release.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check()
  await release.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click()
  await release.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click()
  await expect(release.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible({ timeout: 60_000 })
  await release.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await release.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check()
  await release.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click()
  await expect(release.getByText('此版本已冻结；后续修改请创建新 Build。', { exact: true })).toBeVisible({ timeout: 60_000 })
  const actual = await page.evaluate(async s => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, drafts, media, files, pkg, module] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/product-production/release-media.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/product-production/runtime-package.ts'), load('/storyforge/src/lib/avg/executable-module.ts')])
    const production = await db.productProductions.get(s.productionId), build = await db.productBuilds.where('[productionId+buildNumber]').equals([s.productionId, production.currentBuildNumber]).first()
    const record = await db.productReleases.get(build.releasedProductReleaseId), manifest = await pkg.verifyProductReleaseManifest(record.manifestJson)
    const stage = module.avgRuntimeStage(manifest.runtimePackage), artifacts = await db.productBuildArtifacts.where('buildId').equals(build.id).filter((a: any) => a.kind === 'audio').toArray()
    for (const asset of stage.assets) await media.readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id, asset })
    return { build, old: await db.productBuilds.get(s.old.id), oldRelease: await db.productReleases.get(s.old.releasedProductReleaseId), artifacts,
      draft: JSON.parse((await drafts.readAvgDraftV1(s.scope)).editorJson), backup: await files.exportProjectJSON(s.scope.projectId),
      expected: { scope: s.scope, releaseId: record.id, releaseUid: manifest.lineage.releaseUid, manifestJson: record.manifestJson,
        packageHash: build.packageHash, previewJson: build.previewManifestJson, assets: stage.assets } }
  }, saved)
  expect(actual.build.buildNumber).toBe(saved.old.buildNumber + 1)
  expect(actual.old.previewManifestJson).toBe(saved.old.previewManifestJson); expect(actual.old.packageHash).toBe(saved.old.packageHash)
  expect(actual.oldRelease.manifestJson).toBe(saved.oldRelease.manifestJson)
  expect(actual.draft.presentation.inheritedSounds).toHaveLength(3)
  expect(actual.artifacts).toHaveLength(3)
  for (const artifact of actual.artifacts) expect(JSON.parse(artifact.rightsJson).origin).toBe('author-inherited-original-sound')
  expect(requests).toEqual([])
  await release.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect.poll(async () => page.locator('audio[data-channel="bgm"]').evaluateAll(rows => rows.some(a => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).currentTime > .1)), { timeout: 30_000 }).toBe(true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('native-inherited-sound-release.png') })
  await writeFile(info.outputPath('retained-sound-native-release.json'), JSON.stringify({ schema: 'storyforge.avg.sound-release-native-test-export', version: 1,
    backup: actual.backup, expected: actual.expected, backupSHA256: createHash('sha256').update(JSON.stringify(actual.backup)).digest('hex') }), { flag: 'wx' })
  expect(createHash('sha256').update(await readFile(process.env.AVG_SOUND_RELEASE_BACKUP_FILE!)).digest('hex')).toBe(createHash('sha256').update(sourceBytes).digest('hex'))
})

test('native loop boundary failure survives interruption and refresh as blocking evidence, with no selection or duplicate dispatch', async ({ page }) => {
  const s = await produced(page), panel = await review(page, 'bgm')
  await panel.getByRole('button', { name: '从头审听原声音', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '完整次数 1，连续接缝 1' })).toBeVisible({ timeout: 25_000 })
  await expect(panel.getByRole('combobox', { name: '循环接缝', exact: true }).getByRole('option', { name: '通过', exact: true })).toHaveJSProperty('disabled', true)
  await panel.getByRole('combobox', { name: '循环接缝', exact: true }).selectOption('fail')
  await panel.getByRole('textbox', { name: '观察依据', exact: true }).last().fill('ENGINEERING declared seam issue after actual native boundary; not actual listening')
  await panel.getByRole('textbox', { name: '允许的声音返修范围', exact: true }).fill('ENGINEERING retain exact original, repair seam only in an explicit new version')
  await panel.getByRole('button', { name: '中断本轮审听', exact: true }).click()
  await panel.getByRole('textbox', { name: '本轮声音审听依据', exact: true }).fill('ENGINEERING boundary observed in native output, interrupted remainder and other checks remain unknown')
  await confirmObservation(panel)
  await expect(panel.getByRole('button', { name: '将原声音列为待确认选择', exact: true })).toBeDisabled()
  await page.reload(); const restored = await review(page, 'bgm')
  await restored.getByText('已确认声音观察 v1', { exact: true }).click()
  await expect(restored.getByText(/ENGINEERING declared seam issue/).first()).toBeVisible()
  await expect(restored.getByRole('button', { name: '将原声音列为待确认选择', exact: true })).toBeDisabled()
  expect(s.counts.text).toBe(1); expect(s.counts.music).toBe(1); expect(s.counts.library).toBe(2)
})

test('native mute/unmute cannot turn a partial generation into a passing observation and page switching stops its source', async ({ page }) => {
  const s = await produced(page), panel = await review(page, 'bgm')
  await panel.getByRole('button', { name: '从头审听原声音', exact: true }).click()
  await expect.poll(async () => Number(await panel.getByRole('progressbar', { name: '本轮原生播放进度', exact: true }).getAttribute('value'))).toBeGreaterThan(100)
  await panel.getByRole('checkbox', { name: '审听静音', exact: true }).check()
  await panel.getByRole('checkbox', { name: '审听静音', exact: true }).uncheck()
  await tab(page, '制作与试玩'); await tab(page, '素材')
  await expect(panel.getByRole('status').filter({ hasText: '本轮已中断或改变播放条件' })).toBeVisible()
  await expect(panel.getByRole('combobox', { name: '符合用途', exact: true }).getByRole('option', { name: '通过', exact: true })).toHaveJSProperty('disabled', true)
  await panel.getByRole('textbox', { name: '本轮声音审听依据', exact: true }).fill('ENGINEERING altered controls and left page; retain partial/inaudible observation as unknown')
  await confirmObservation(panel)
  await expect(panel.getByRole('button', { name: '将原声音列为待确认选择', exact: true })).toBeDisabled()
  const report = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const row = await db.productBuildArtifacts.where('workId').equals(scope.workId).filter((r: any) => r.artifactKey === 'avg.review.audio.native.bgm' && r.status === 'accepted').first()
    return { value: JSON.parse(row.payloadJson), sources: (window as any).__avgNativeSoundWitness.sources }
  }, s.scope)
  expect(report.value.soundEvidence.audition).toMatchObject({ outcome: 'interrupted', muted: true, volume: 0, completedCycles: 0 })
  expect(report.value.unobserved.length).toBeGreaterThan(0); expect(report.sources).toHaveLength(1)
  // Closing an interrupted context need not dispatch source-ended. Witness
  // the actual stop, graph disconnection and closed native context instead.
  expect(report.sources[0]).toMatchObject({ immediateStop: true, disconnected: true, contextState: 'closed' })
  expect(s.counts.text).toBe(1); expect(s.counts.music).toBe(1); expect(s.counts.library).toBe(2)
})
