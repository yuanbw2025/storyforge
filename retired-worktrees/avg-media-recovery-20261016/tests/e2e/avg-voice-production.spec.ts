import { expect, test, type Page } from '@playwright/test'
import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'

async function adopt(page: Page, label: string) {
  const card = page.getByRole('article', { name: `作者确认：${label}`, exact: true })
  await card.getByRole('button', { name: `保存候选：${label}`, exact: true }).click()
  await card.getByRole('checkbox', { name: '我已核对该候选内容及素材来源授权', exact: true }).check()
  await card.getByRole('button', { name: `确认采用：${label}`, exact: true }).click()
  await expect(card.getByText('已采用 v1', { exact: true })).toBeVisible()
}

async function seedVoice(page: Page, unknown = false, withImage = false) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const localOrigin = new URL(page.url()).origin
  // Only the isolated application and the two exact original-byte fixtures
  // below may respond. An accidental live route fails instead of sending.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === localOrigin || ['blob:', 'data:'].includes(url.protocol)) await route.continue()
    else await route.abort('blockedbyclient')
  })
  const seed = await page.evaluate(async withImage => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, editor, presets, worlds, config, fixtures] = await Promise.all([
      load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/avg/editor-service.ts'),
      load('/storyforge/src/lib/avg/authoring-presets.ts'), load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'),
      load('/storyforge/src/stores/ai-config.ts'), load('/storyforge/tests/helpers/avg-reading-fixture.ts')])
    const owner = await drafts.createAvgDraftV1('原生配音生产工程验证'), frozen = await worlds.createMistHarborWorld()
    const selected = await drafts.selectAvgWorldV1(owner.scope, 0, frozen.worldReleaseId)
    const workspace = presets.createAvgAuthoringPresetV1('linear')
    await editor.saveAvgAuthorWorkspaceV1(owner.scope, selected.revision, workspace)
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: 'test-only-intercepted-no-network', model: 'agnes-2.5-flash', baseUrl: 'https://speech.fixture.invalid/v1' })
    // Original engineering PCM, explicitly not speech, human listening or art
    // evidence. Decode and native playback are real; no media event is forged.
    const tone = await fixtures.avgReadingAudioFixture(1000), bytes = new Uint8Array(tone.data), pcm = new DataView(bytes.buffer)
    for (let i = 44; i < bytes.length; i += 2) pcm.setInt16(i, pcm.getInt16(i, true) * 10, true)
    let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
    const canvas = document.createElement('canvas'); canvas.width = 576; canvas.height = 324
    const context = canvas.getContext('2d')!; context.fillStyle = '#20394b'; context.fillRect(0, 0, canvas.width, canvas.height)
    return { scope: owner.scope, wave: btoa(binary), png: withImage ? canvas.toDataURL('image/png').split(',')[1] : null, scriptTitles: workspace.systemPlan.scenes.map((s: { title: string }) => s.title),
      text: workspace.scripts[0].lines[0].text, lineKey: workspace.scripts[0].lines[0].lineKey }
  }, withImage)
  const bodies: any[] = [], imageBodies: any[] = []
  await page.route('https://speech.fixture.invalid/v1/audio/speech', async route => {
    const body = route.request().postDataJSON(); bodies.push(body)
    expect(body).toEqual({ input: seed.text, model: 'speech-fixture', voice: 'voice-a', response_format: 'wav' })
    if (unknown) { await route.abort('failed'); return }
    const bytes = Buffer.from(seed.wave, 'base64'); bytes[100] ^= bodies.length
    await route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'x-request-id': `voice.browser.fixture.${bodies.length}` }, body: bytes })
  })
  await page.route('https://speech.fixture.invalid/v1/images/generations', async route => {
    imageBodies.push(route.request().postDataJSON()); expect(seed.png).toBeTruthy()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: seed.png }] }) })
  })
  await page.goto(`./avg/production?project=${seed.scope.projectId}&work=${seed.scope.workId}`)
  await expect(page.getByRole('region', { name: '系统与效果组装（实验）', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  if (withImage) {
    const imageEditor = page.getByRole('region', { name: '图片生产（实验）', exact: true })
    await imageEditor.getByLabel('需求名称', { exact: true }).fill('联合恢复工程背景')
    await imageEditor.getByLabel('画面要求', { exact: true }).fill('原创工程场景背景，固定横向三色构图，仅验证真实像素链路')
    await imageEditor.getByRole('button', { name: '加入本批需求', exact: true }).click()
    await imageEditor.getByRole('button', { name: '保存并冻结图片需求', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '图片需求和准确来源已保存' })).toBeVisible()
  }
  const editor = page.getByRole('region', { name: '逐句配音需求草稿', exact: true })
  await editor.getByLabel('Agnes 配音模型 ID', { exact: true }).fill('speech-fixture')
  await editor.getByRole('checkbox', { name: /第 1 句/ }).first().check()
  await editor.getByLabel('音色 ID', { exact: true }).fill('voice-a')
  await editor.getByLabel('音色使用权说明', { exact: true }).fill('原创工程校准音；不签 TTS、人声、专业听感或商用许可')
  await editor.getByLabel('音色条款或授权依据', { exact: true }).fill('本测试原创 PCM 控制值；实际供应商音色条款另验')
  await editor.getByRole('button', { name: '保存配音需求草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '准确配音需求已保存' })).toBeVisible()
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '准备制作方案', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await adopt(page, '系统规则')
  for (const title of seed.scriptTitles) await adopt(page, `场景：${title}`)
  expect(bodies).toHaveLength(0)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '执行已确认的配音及联合媒资任务', exact: true }).click()
  if (unknown) await expect(page.getByRole('region', { name: '图音恢复方案', exact: true })).toBeVisible()
  else await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toBeVisible()
  expect(bodies).toHaveLength(1)
  expect(imageBodies).toHaveLength(withImage ? 1 : 0)
  return { seed, bodies, imageBodies }
}

async function reviewAndChoose(page: Page) {
  const review = page.getByRole('region', { name: '配音审听与选择', exact: true })
  if (!await review.isVisible()) await page.getByRole('button', { name: '查看并审听此句', exact: true }).click()
  await expect(review.getByRole('button', { name: '从头开启新一轮审听', exact: true })).toBeEnabled()
  await expect(review.getByLabel('与原句一致', { exact: true }).locator('option[value="pass"]')).toHaveJSProperty('disabled', true)
  await review.getByRole('button', { name: '从头开启新一轮审听', exact: true }).click()
  await review.locator('audio').evaluate((audio: HTMLAudioElement) => audio.play())
  await expect(review.locator('audio')).toHaveJSProperty('ended', true)
  await expect(review.getByLabel('与原句一致', { exact: true }).locator('option[value="pass"]')).toHaveJSProperty('disabled', false)
  // Synthetic author control values exercise adoption; the PCM tone cannot
  // establish pronunciation/text matching or genuine human/art acceptance.
  for (const label of ['与原句一致', '读音', '演法', '首尾完整', '噪音与破音']) {
    await review.getByLabel(label, { exact: true }).selectOption('pass')
  }
  for (const field of await review.getByLabel('观察依据', { exact: true }).all()) await field.fill('工程控制断言，非真实台词/人声或专业听感结论')
  await review.getByLabel('本轮审听依据', { exact: true }).fill('真实浏览器播放工程 PCM；本测试合成评审只验证采用通路，不作为人声、艺术或商业质量验收')
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toBeDisabled()
  await review.getByRole('button', { name: '保存为待确认审听记录', exact: true }).click()
  await review.getByRole('button', { name: '确认这份审听记录', exact: true }).click()
  await review.getByRole('button', { name: '将这版配音列为待确认选择', exact: true }).click()
  await review.getByRole('button', { name: '确认采用这版配音', exact: true }).click()
  await expect(review.getByText(/已采用配音 v1/)).toBeVisible()
  await page.getByRole('button', { name: '将已采用配音配置到逐句阅读', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已采用配音已配置到准确句子' })).toBeVisible()
}

test('native voice production reaches real decoded audio, native ended, separate review/choice and an offline frozen Preview', async ({ page }, info) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both default-off experiments must be explicit')
  const s = await seedVoice(page)
  await reviewAndChoose(page)
  await page.reload()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    ;(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'unused-offline' })
  })
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  const proof = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, schema, previews, voice] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/product-production/preview-manifest.ts'), load('/storyforge/src/lib/avg/voice-exact-storage.ts')])
    const draft = await drafts.readAvgDraftV1(scope), production = await schema.db.productProductions.get(draft.productionId)
    const build = await schema.db.productBuilds.where('[productionId+buildNumber]').equals([production.id, production.currentBuildNumber]).first()
    const verified = await previews.verifyStoredProductBuildPreview(build)
    const artifacts = await schema.db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
    const raw = artifacts.find((a: { artifactKey: string; status: string }) => a.artifactKey.startsWith('avg.voice.raw.') && a.status === 'accepted')
    const audioReview = artifacts.find((a: { artifactKey: string; status: string }) => a.artifactKey.startsWith('avg.review.audio.') && a.status === 'accepted')
    return { status: build.status, rootReceipt: build.rootTerminalReceiptHash, packageHash: verified.packageHash,
      workspace: JSON.parse(draft.editorJson), raw: (await voice.decodeAvgVoiceExactStorageV1(raw.payloadJson, 'raw-voice')).payload, audioReview: JSON.parse(audioReview.payloadJson),
      ledger: JSON.parse(build.budgetLedgerJson) }
  }, s.seed.scope)
  expect(proof.status).toBe('preview-ready'); expect(proof.rootReceipt).toBeTruthy(); expect(proof.packageHash).toBeTruthy()
  expect(proof.workspace.presentation.reading.voices[0]).toMatchObject({ lineKey: s.seed.lineKey, text: s.seed.text })
  expect(proof.audioReview.audioEvidence.audition).toMatchObject({ outcome: 'ended', playedMs: 1000, muted: false, playbackRate: 1, seeked: false })
  expect(proof.raw.provider.costUsd).toBeNull(); expect(s.bodies).toHaveLength(1)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '查看并审听此句', exact: true }).click()
  await page.getByRole('region', { name: '配音审听与选择', exact: true }).screenshot({ path: info.outputPath('avg-voice-native-adopted-offline.png') })
})

test('native voice recovery explicitly keeps configured audio, creates a fresh zero-call producer and re-adopts it without credentials', async ({ page }, info) => {
  // Two actual Builds and two native playback/adoption rounds, with a fixed
  // bound from creation. No original production/test timeout is increased.
  test.setTimeout(120_000)
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both default-off experiments must be explicit')
  const s = await seedVoice(page); await reviewAndChoose(page)
  await page.getByRole('button', { name: '停止本批并选择保留或重录', exact: true }).click()
  const recovery = page.getByRole('region', { name: '图音恢复方案', exact: true })
  await recovery.getByRole('button', { name: '查看原音频：第 1 句', exact: true }).click()
  await recovery.getByRole('checkbox', { name: '保留本句原音频待复验', exact: true }).check()
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeDisabled()
  await recovery.getByRole('checkbox', { name: '我已核对保留/重做清单、原始调用和费用；明确开始后才执行，旧记录保留', exact: true }).check()
  const before = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const drafts = await load('/storyforge/src/lib/avg/draft-service.ts'), schema = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await drafts.readAvgDraftV1(scope), production = await schema.db.productProductions.get(draft.productionId)
    const build = await schema.db.productBuilds.where('[productionId+buildNumber]').equals([production.id, production.currentBuildNumber]).first()
    const raw = (await schema.db.productBuildArtifacts.where('buildId').equals(build.id).toArray()).find((a: any) => a.artifactKey.startsWith('avg.voice.raw.') && a.status === 'accepted')
    ;(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'unused-offline' })
    return { productionId: production.id, build, raw }
  }, s.seed.scope)
  await recovery.getByRole('button', { name: '准备图音恢复方案', exact: true }).click()
  await expect(recovery.getByRole('heading', { name: '图音恢复方案已保存', exact: true })).toBeVisible()
  expect(s.bodies).toHaveLength(1)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await adopt(page, '系统规则'); for (const title of s.seed.scriptTitles) await adopt(page, `场景：${title}`)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '执行已确认的配音及联合媒资任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toBeVisible()
  expect(s.bodies).toHaveLength(1)
  await reviewAndChoose(page)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click(); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  const after = await page.evaluate(async ({ scope, productionId, oldBuildId, oldRawId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const schema = await load('/storyforge/src/lib/db/schema.ts'), production = await schema.db.productProductions.get(productionId)
    const build = await schema.db.productBuilds.where('[productionId+buildNumber]').equals([productionId, production.currentBuildNumber]).first()
    const raw = (await schema.db.productBuildArtifacts.where('buildId').equals(build.id).toArray()).find((a: any) => a.artifactKey.startsWith('avg.voice.raw.') && a.status === 'accepted')
    const ledger = JSON.parse(build.budgetLedgerJson), attempt = ledger.attempts.find((a: any) => a.taskKey.startsWith('avg.voice.generate.'))
    return { raw, oldBuild: await schema.db.productBuilds.get(oldBuildId), oldRaw: await schema.db.productBuildArtifacts.get(oldRawId), usage: attempt.usage, workId: scope.workId }
  }, { scope: s.seed.scope, productionId: before.productionId, oldBuildId: before.build.id, oldRawId: before.raw.id })
  expect(after.oldBuild).toEqual(before.build); expect(after.oldRaw).toEqual(before.raw)
  expect(after.raw.blobObjectId).toBe(before.raw.blobObjectId); expect(after.raw.producerRunId).not.toBe(before.raw.producerRunId)
  expect(JSON.parse(after.raw.qualityJson)).toMatchObject({ noProviderRequest: true, schema: 'storyforge.avg.raw-voice-revalidation' })
  expect(after.usage).toMatchObject({ mediaCalls: 0, costUsd: 0 }); expect(s.bodies).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('avg-voice-recovered-preview-offline.png') })
})

test('native unknown voice result retains the held request and disables a new recovery attempt without another POST', async ({ page }, info) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both default-off experiments must be explicit')
  const s = await seedVoice(page, true), recovery = page.getByRole('region', { name: '图音恢复方案', exact: true })
  await expect(recovery.getByRole('alert').filter({ hasText: '未知结果' })).toBeVisible()
  await recovery.getByRole('checkbox', { name: '我已核对保留/重做清单、原始调用和费用；明确开始后才执行，旧记录保留', exact: true }).check()
  await expect(recovery.getByRole('button', { name: '准备图音恢复方案', exact: true })).toBeDisabled()
  expect(s.bodies).toHaveLength(1)
  const state = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { builds: await db.productBuilds.count(), rawVoices: await db.productBuildArtifacts.filter((a: any) => a.artifactKey.startsWith('avg.voice.raw.') && a.status === 'accepted').count() }
  })
  expect(state).toEqual({ builds: 1, rawVoices: 0 })
  await recovery.screenshot({ path: info.outputPath('avg-voice-unknown-held-no-resend.png') })
})

test('native joint recovery keeps proved image pixels, explicitly retakes configured voice and requires fresh selections before Preview', async ({ page }, info) => {
  test.setTimeout(120_000) // Two actual mixed Builds, native decoding and independent author paths.
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both default-off experiments must be explicit')
  const s = await seedVoice(page, false, true); await reviewAndChoose(page)
  await page.getByRole('button', { name: '停止本批并选择保留或重录', exact: true }).click()
  const recovery = page.getByRole('region', { name: '图音恢复方案', exact: true })
  await recovery.getByRole('button', { name: '查看保留原图：联合恢复工程背景', exact: true }).click()
  await recovery.getByRole('checkbox', { name: '保留原图：联合恢复工程背景', exact: true }).check()
  // Leaving the voice unchecked is the explicit retake partition, confirmed below.
  await recovery.getByRole('checkbox', { name: '我已核对保留/重做清单、原始调用和费用；明确开始后才执行，旧记录保留', exact: true }).check()
  const before = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const drafts = await load('/storyforge/src/lib/avg/draft-service.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await drafts.readAvgDraftV1(scope), production = await db.productProductions.get(draft.productionId)
    const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, production.currentBuildNumber]).first()
    const rows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
    return { build, voice: rows.find((a: any) => a.artifactKey.startsWith('avg.voice.raw.') && a.status === 'accepted'),
      image: rows.find((a: any) => a.artifactKey.startsWith('avg.media.raw.') && a.status === 'accepted') }
  }, s.seed.scope)
  await recovery.getByRole('button', { name: '准备图音恢复方案', exact: true }).click()
  await expect(recovery.getByRole('heading', { name: '图音恢复方案已保存', exact: true })).toBeVisible()
  expect(s.bodies).toHaveLength(1); expect(s.imageBodies).toHaveLength(1)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await adopt(page, '系统规则'); for (const title of s.seed.scriptTitles) await adopt(page, `场景：${title}`)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '执行已确认的配音及联合媒资任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toBeVisible()
  expect(s.bodies).toHaveLength(2); expect(s.imageBodies).toHaveLength(1)
  const card = page.getByRole('article', { name: '图片候选：联合恢复工程背景', exact: true })
  await confirmEngineeringVisualReview(card, '联合恢复工程背景')
  await card.getByRole('button', { name: '保存选图候选：联合恢复工程背景', exact: true }).click()
  await card.getByRole('checkbox', { name: '我已查看这张图片并核对用途、来源与使用权', exact: true }).check()
  await card.getByRole('button', { name: '确认选用：联合恢复工程背景', exact: true }).click()
  await page.getByRole('button', { name: '将已选图片配置到演出草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已选图片已配置到演出草稿' })).toBeVisible()
  await reviewAndChoose(page)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click(); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  const after = await page.evaluate(async ({ scope, oldBuildId, oldVoiceId, oldImageId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const drafts = await load('/storyforge/src/lib/avg/draft-service.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await drafts.readAvgDraftV1(scope), production = await db.productProductions.get(draft.productionId)
    const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, production.currentBuildNumber]).first()
    const rows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
    return { oldBuild: await db.productBuilds.get(oldBuildId), oldVoice: await db.productBuildArtifacts.get(oldVoiceId), oldImage: await db.productBuildArtifacts.get(oldImageId),
      voice: rows.find((a: any) => a.artifactKey.startsWith('avg.voice.raw.') && a.status === 'accepted'),
      image: rows.find((a: any) => a.artifactKey.startsWith('avg.media.raw.') && a.status === 'accepted') }
  }, { scope: s.seed.scope, oldBuildId: before.build.id, oldVoiceId: before.voice.id, oldImageId: before.image.id })
  expect(after.oldBuild).toEqual(before.build); expect(after.oldVoice).toEqual(before.voice); expect(after.oldImage).toEqual(before.image)
  expect(after.voice.contentHash).not.toBe(before.voice.contentHash); expect(after.voice.blobObjectId).not.toBe(before.voice.blobObjectId)
  expect(after.image.contentHash).toBe(before.image.contentHash); expect(after.image.blobObjectId).toBe(before.image.blobObjectId)
  expect(JSON.parse(after.image.qualityJson)).toMatchObject({ noProviderRequest: true, schema: 'storyforge.avg.raw-image-revalidation' })
  expect(s.bodies).toHaveLength(2); expect(s.imageBodies).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('avg-voice-image-joint-retake-preview.png') })
})

async function finishGeneratedVoiceLine(page: Page, sessionId: number) {
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  const retry = page.getByRole('button', { name: '重试配音', exact: true })
  await expect.poll(async () => await retry.isVisible() || await page.locator('audio[data-channel="voice"]')
    .evaluateAll((rows: HTMLAudioElement[]) => rows.some(audio => !audio.paused || audio.ended))).toBe(true)
  if (await retry.isVisible()) await retry.click() // Explicit local playback, never another provider request.
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).avgReading.current
  }, sessionId)).toMatchObject({ status: 'ended', playedMs: 1000 })
}

test('generated image and voice freeze a local Release, play from its own save and survive portable restore without another provider request', async ({ page }, info) => {
  test.setTimeout(150_000) // New full production, playthrough, local release and restore slice.
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both default-off experiments must be explicit')
  const s = await seedVoice(page, false, true); await reviewAndChoose(page)
  const image = page.getByRole('article', { name: '图片候选：联合恢复工程背景', exact: true })
  await confirmEngineeringVisualReview(image, '联合恢复工程背景')
  await image.getByRole('button', { name: '保存选图候选：联合恢复工程背景', exact: true }).click()
  await image.getByRole('checkbox', { name: '我已查看这张图片并核对用途、来源与使用权', exact: true }).check()
  await image.getByRole('button', { name: '确认选用：联合恢复工程背景', exact: true }).click()
  await page.getByRole('button', { name: '将已选图片配置到演出草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已选图片已配置到演出草稿' })).toBeVisible()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    ;(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'unused-offline' })
  })
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click(); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  const panel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await panel.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible()
  // Decoding the generated media alone never approves a route or a release.
  await panel.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.text)
  const previewSessionId = Number(new URL(page.url()).searchParams.get('session'))
  await expect.poll(() => page.locator('.avg-background img').evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0)).toBe(576)
  await finishGeneratedVoiceLine(page, previewSessionId)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '打开灯光', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText('灯光亮起')
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
  }, previewSessionId)).toBe(true)
  await page.goto(`./avg/production?project=${s.seed.scope.projectId}&work=${s.seed.scope.workId}`)
  await panel.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check()
  await panel.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click()
  await expect(panel.getByText(/完整路线：已确认/)).toBeVisible()
  const tampered = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.where('workId').equals(scope.workId).first()
    const row = await db.productBuildArtifacts.where('buildId').equals(build.id).filter((r: any) => r.status === 'accepted'
      && /^avg\.media\.\d+$/.test(r.artifactKey) && r.mediaKind === 'voice').first()
    await db.productBuildArtifacts.update(row.id, { rightsJson: JSON.stringify({ ...JSON.parse(row.rightsJson), audioReviewReceipt: '0'.repeat(64) }) })
    return { id: row.id, rightsJson: row.rightsJson }
  }, s.seed.scope)
  await panel.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  expect(await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { releases: await db.productReleases.where('workId').equals(scope.workId).count(), media: await db.productMediaAssets.where('workId').equals(scope.workId).count() }
  }, s.seed.scope)).toEqual({ releases: 0, media: 0 })
  await page.evaluate(async row => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    await (await load('/storyforge/src/lib/db/schema.ts')).db.productBuildArtifacts.update(row.id, { rightsJson: row.rightsJson })
  }, tampered)
  await panel.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: '本地原型版本已准备' })).toBeVisible()
  await panel.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check()
  await panel.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click()
  await expect(panel.getByRole('button', { name: '从此版本开始新存档', exact: true })).toBeEnabled()
  await panel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.text)
  const releaseSessionId = Number(new URL(page.url()).searchParams.get('session'))
  expect(releaseSessionId).not.toBe(previewSessionId)
  await finishGeneratedVoiceLine(page, releaseSessionId)
  await page.reload()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.text)
  const proof = await page.evaluate(async ({ scope, releaseSessionId, previewSessionId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, packages, media, blobs, backups, lifecycle, voices] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/product-production/runtime-package.ts'),
      load('/storyforge/src/lib/product-production/release-media.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts'),
      load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/workspace/lifecycle.ts'), load('/storyforge/src/lib/avg/assembly-service.ts')])
    const session = await db.productRuntimeSessions.get(releaseSessionId), release = await db.productReleases.get(session.productReleaseId)
    const manifest = await packages.verifyProductReleaseManifest(release.manifestJson), assets = manifest.runtimePackage.modules[0].stage.assets
    const voiceAsset = assets.find((a: any) => a.kind === 'voice')
    const binding = await db.productMediaAssets.where('[productReleaseId+assetKey+version]').equals([release.id, voiceAsset.assetKey, voiceAsset.version]).first()
    const link = await db.productMediaBlobs.where('mediaAssetId').equals(binding.id).first(), originalBlob = await db.mediaBlobObjects.get(link.blobObjectId)
    let corruptRejected = false
    try {
      await db.mediaBlobObjects.update(originalBlob.id, { data: new Uint8Array([1, 2, 3]).buffer })
      try { await media.readProductReleaseMediaBytes({ scope, productReleaseId: release.id, asset: voiceAsset }) } catch { corruptRejected = true }
    } finally { await db.mediaBlobObjects.put(originalBlob) }
    const originalHashes = []
    for (const asset of assets) originalHashes.push(await blobs.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: release.id, asset })))
    const backup = await backups.exportProjectJSON(scope.projectId)
    if (JSON.stringify(backup).includes('test-only-intercepted-no-network')) throw new Error('Private test credential entered portable backup')
    const projectId = await backups.importProjectJSON(backup), copied = await db.productReleases.where('projectId').equals(projectId).first()
    const restored = await packages.verifyProductReleaseManifest(copied.manifestJson), copiedScope = { projectId, worldId: copied.worldId, workId: copied.workId }
    const copiedHashes = []
    for (const asset of restored.runtimePackage.modules[0].stage.assets) copiedHashes.push(await blobs.sha256MediaData(await media.readProductReleaseMediaBytes({ scope: copiedScope, productReleaseId: copied.id, asset })))
    const build = await db.productBuilds.where('workId').equals(copied.workId).filter((b: any) => b.releasedProductReleaseId === copied.id).first()
    const raw = await db.productBuildArtifacts.where('buildId').equals(build.id).filter((r: any) => r.status === 'accepted' && r.artifactKey.startsWith('avg.voice.raw.')).first()
    const audio = await voices.readAvgRawVoiceCandidateV3({ scope: copiedScope, productionId: build.productionId,
      requirementKey: raw.artifactKey.slice('avg.voice.raw.'.length), version: raw.version, contentHash: raw.contentHash })
    await lifecycle.deleteWork(copied.workId)
    const retainedHashes = []
    for (const asset of assets) retainedHashes.push(await blobs.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: release.id, asset })))
    const previewSession = await db.productRuntimeSessions.get(previewSessionId)
    return { session, previewSession, version: manifest.version, packageHash: manifest.packageHash, restoredPackageHash: restored.packageHash,
      originalHashes, copiedHashes, retainedHashes, assetHashes: assets.map((a: any) => a.blobContentHash), restoredVoiceHash: audio.asset.contentHash,
      voiceHash: voiceAsset.blobContentHash, corruptRejected, copyId: copied.id, originalId: release.id,
      copiedDeleted: !await db.productReleases.get(copied.id), originalManifestUnchanged: (await db.productReleases.get(release.id)).manifestJson === release.manifestJson }
  }, { scope: s.seed.scope, releaseSessionId, previewSessionId })
  expect(proof.version).toBe(2); expect(proof.originalHashes).toHaveLength(2)
  expect(proof.session.productBuildId).toBeNull(); expect(proof.session.productReleaseId).toBe(proof.originalId)
  expect(proof.previewSession.productBuildId).toBeGreaterThan(0); expect(proof.previewSession.productReleaseId).toBeNull()
  expect(proof.originalHashes).toEqual(proof.assetHashes); expect(proof.copiedHashes).toEqual(proof.originalHashes)
  expect(proof.retainedHashes).toEqual(proof.originalHashes); expect(proof.restoredPackageHash).toBe(proof.packageHash)
  expect(proof.restoredVoiceHash).toBe(proof.voiceHash); expect(proof.copyId).not.toBe(proof.originalId)
  expect(proof.corruptRejected).toBe(true)
  expect(proof.copiedDeleted).toBe(true); expect(proof.originalManifestUnchanged).toBe(true)
  expect(s.bodies).toHaveLength(1); expect(s.imageBodies).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('avg-generated-voice-local-release-player.png') })
})
