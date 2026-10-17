import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { confirmEngineeringVisualReview } from '../helpers/avg-visual-review-playwright'

async function adopt(page: Page, label: string) {
  const card = page.getByRole('article', { name: `作者确认：${label}`, exact: true })
  await card.getByRole('button', { name: `保存候选：${label}`, exact: true }).click()
  await card.getByRole('checkbox', { name: '我已核对该候选内容及素材来源授权', exact: true }).check()
  await card.getByRole('button', { name: `确认采用：${label}`, exact: true }).click()
  await expect(card.getByText('已采用 v1', { exact: true })).toBeVisible()
}

/** Await the visible completion receipt for the bounded assembly operation,
 * then retain the five-second control assertion. Diagnostics never rerun it. */
async function expectFiveLinePreviewReady(page: Page, info: TestInfo, scope: { workId: number }) {
  try {
    await expect(page.getByRole('status').filter({hasText:'新预览已冻结，可以开始试玩。'})).toBeVisible({timeout:30_000})
    await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  }
  catch (error) {
    const started = Date.now(), observations: unknown[] = []
    try {
      await expect.poll(async () => {
        const state = await page.evaluate(async workId => {
          const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
          const { db } = await load('/storyforge/src/lib/db/schema.ts')
          const build = await db.productBuilds.where('workId').equals(workId).first()
          if (!build) return { status: 'missing' }
          const ledger = JSON.parse(build.budgetLedgerJson)
          return { status: build.status, stateRevision: build.stateRevision, controlEpoch: build.controlEpoch,
            hasPreview: !!build.previewHash, failureJson: build.failureJson,
            tasks: ledger.tasks, rootRunId: ledger.rootRunId }
        }, scope.workId)
        observations.push({ afterFailureMs: Date.now() - started, ...state })
        return !['building', 'integrating', 'validating'].includes(state.status)
      }, { timeout: 10_000, intervals: [1000] }).toBe(true)
    } catch (diagnosticError) { observations.push({ diagnosticError: String(diagnosticError) }) }
    try {
      const path = info.outputPath('first-five-line-preview-failure-state.json')
      await writeFile(path, JSON.stringify(observations, null, 2))
      await info.attach('first-five-line-preview-failure-state', { path, contentType: 'application/json' })
    } catch (attachmentError) { console.error('AVG diagnostic attachment failed', String(attachmentError)) }
    throw error
  }
}

async function fillVoicePresets(editor: Locator, count: number, declaration: string, reference: string) {
  await expect(editor.getByRole('group', { name: /^第 \d+ 项配音$/ })).toHaveCount(count)
  for (let index = 0; index < count; index++) {
    const row = editor.getByRole('group', { name: `第 ${index + 1} 项配音`, exact: true })
    // A wrapped textarea's DOM label text includes its controlled value after
    // editing. Use the stable accessible textbox name inside the exact row;
    // enumerating matching labels once would skip rows as that set shrinks.
    for (const [name, value] of [['音色 ID', 'voice-a'], ['音色使用权说明', declaration], ['音色条款或授权依据', reference]]) {
      const field = row.getByRole('textbox', { name, exact: true })
      await field.fill(value)
      await expect(field).toHaveValue(value)
    }
  }
}

async function seedVoice(page: Page, unknown = false, withImage = false, batchSize = 1) {
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
  const seed = await page.evaluate(async ({ withImage, batchSize }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, editor, presets, worlds, config, fixtures] = await Promise.all([
      load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/avg/editor-service.ts'),
      load('/storyforge/src/lib/avg/authoring-presets.ts'), load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'),
      load('/storyforge/src/stores/ai-config.ts'), load('/storyforge/tests/helpers/avg-reading-fixture.ts')])
    const owner = await drafts.createAvgDraftV1('原生配音生产工程验证'), frozen = await worlds.createMistHarborWorld()
    const selected = await drafts.selectAvgWorldV1(owner.scope, 0, frozen.worldReleaseId)
    const workspace = presets.createAvgAuthoringPresetV1('linear')
    if (batchSize > 1) {
      const original = workspace.scripts[0].lines[0]
      workspace.scripts[0].lines = Array.from({ length: 10 }, (_, index) => index === 0 ? original : {
        ...structuredClone(original), lineKey: `line.dark.continuation.${index}`, beatKey: `line.dark.continuation.${index}`,
        text: `第 ${index + 1} 句原创工程校准文本，仅验证配音批次与演出。`,
      })
    }
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
      text: workspace.scripts[0].lines[0].text, lineKey: workspace.scripts[0].lines[0].lineKey,
      texts: workspace.scripts[0].lines.map((line: { text: string }) => line.text),
      lineKeys: workspace.scripts[0].lines.map((line: { lineKey: string }) => line.lineKey) }
  }, { withImage, batchSize })
  const bodies: any[] = [], imageBodies: any[] = []
  await page.route('https://speech.fixture.invalid/v1/audio/speech', async route => {
    const body = route.request().postDataJSON(); bodies.push(body)
    expect(seed.texts).toContain(body.input)
    expect(body).toEqual({ input: body.input, model: 'speech-fixture', voice: 'voice-a', response_format: 'wav' })
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
  for (let index = 0; index < batchSize; index++) await editor.getByRole('checkbox', { name: /第 \d+ 句/ }).nth(index).check()
  await fillVoicePresets(editor, batchSize, '原创工程校准音；不签 TTS、人声、专业听感或商用许可', '本测试原创 PCM 控制值；实际供应商音色条款另验')
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
  else if (batchSize === 1) await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toBeVisible()
  else await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toHaveCount(batchSize)
  expect(bodies).toHaveLength(batchSize)
  expect(imageBodies).toHaveLength(withImage ? 1 : 0)
  return { seed, bodies, imageBodies }
}

async function reviewAndChoose(page: Page, configure = true, expectedCards = 1) {
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
  await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toHaveCount(expectedCards)
  for (const button of await page.getByRole('button', { name: '查看并审听此句', exact: true }).all()) await expect(button).toBeDisabled()
  await review.getByRole('button', { name: '保存为待确认审听记录', exact: true }).click()
  await review.getByRole('button', { name: '确认这份审听记录', exact: true }).click()
  await review.getByRole('button', { name: '将这版配音列为待确认选择', exact: true }).click()
  await review.getByRole('button', { name: '确认采用这版配音', exact: true }).click()
  await expect(review.getByText(/已采用配音 v1/)).toBeVisible()
  if (configure) {
    await page.getByRole('button', { name: '将已采用配音配置到逐句阅读', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已采用配音已配置到准确句子' })).toBeVisible()
  }
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

async function finishGeneratedVoiceLine(page: Page, sessionId: number, lineKey?: string) {
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  const retry = page.getByRole('button', { name: '重试配音', exact: true })
  await expect.poll(async () => await retry.isVisible() || await page.locator('audio[data-channel="voice"]')
    .evaluateAll((rows: HTMLAudioElement[]) => rows.some(audio => !audio.paused || audio.ended))).toBe(true)
  if (await retry.isVisible()) await retry.click() // Explicit local playback, never another provider request.
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).avgReading.current
  }, sessionId)).toMatchObject({ status: 'ended', playedMs: 1000, ...(lineKey ? { lineKey } : {}) })
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

test('an adopted voice explicitly leaves its consumed batch, stays audible in an offline V1 Release and retains portable original authority', async ({ page }, info) => {
  test.setTimeout(180_000) // New source retirement, zero-call Build, native route, Release and restore slice.
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both experiments must be explicit')
  const s = await seedVoice(page); await reviewAndChoose(page)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click(); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  const old = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.where('workId').equals(scope.workId).first()
    const raw = await db.productBuildArtifacts.where('buildId').equals(build.id).filter((row: any) => row.artifactKey.startsWith('avg.voice.raw.') && row.status === 'accepted').first()
    return { buildId: build.id, previewHash: build.previewHash, raw }
  }, s.seed.scope)
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.text)
  const oldSessionId = Number(new URL(page.url()).searchParams.get('session'))
  await finishGeneratedVoiceLine(page, oldSessionId, s.seed.lineKey)
  await page.goto(`./avg/production?project=${s.seed.scope.projectId}&work=${s.seed.scope.workId}`)
  await page.getByRole('button', { name: '以此预览开始修订', exact: true }).click()
  await page.getByRole('button', { name: '保存编辑草稿', exact: true }).click()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '保留已采用配音，结束本批需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已保留准确已采用配音并结束本批需求' })).toBeVisible()
  const ended = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, workspaces, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/avg/author-workspace-contract.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const workspace = workspaces.parseAvgAuthorWorkspaceV1((await drafts.readAvgDraftV1(scope)).editorJson)
    config.useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'unused-offline' })
    return { hasBatch: !!workspace.voiceProduction, inherited: workspace.presentation.inheritedVoices,
      asset: workspace.presentation.stage.assets.find((asset: any) => asset.kind === 'voice') }
  }, s.seed.scope)
  expect(ended.hasBatch).toBe(false); expect(ended.inherited).toHaveLength(1)
  expect(ended.inherited[0].source.raw.contentHash).toBe(old.raw.contentHash)
  await page.getByRole('button', { name: `${ended.asset.name} · 配音`, exact: true }).click()
  const sourcePreview = page.locator('.avg-assembly-media-preview').filter({ has: page.locator('[aria-label="沿用配音来源"]') })
  await expect(sourcePreview).toContainText(`准确原句：${s.seed.text}`)
  await expect(sourcePreview.locator('audio')).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => sourcePreview.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1)
  await sourcePreview.locator('audio').evaluate((audio: HTMLAudioElement) => audio.play())
  await expect(sourcePreview.locator('audio')).toHaveJSProperty('ended', true)
  expect(s.bodies).toHaveLength(1)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '准备新版本方案', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await adopt(page, '系统规则'); for (const title of s.seed.scriptTitles) await adopt(page, `场景：${title}`)
  const refusals = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [service, authors, workspaces, schema] = await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),
      load('/storyforge/src/lib/avg/author-artifacts.ts'), load('/storyforge/src/lib/avg/author-workspace-contract.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const view = await service.readAvgAssemblyWorkspaceV1(scope), build = view.details.build
    const workspace = workspaces.parseAvgAuthorWorkspaceV1(view.draft.editorJson), task = JSON.parse(build.planJson).tasks.find((task: any) => task.outputArtifactKeys.includes('avg.author.stage'))
    const before = await schema.db.productBuildArtifacts.where('buildId').equals(build.id).count(), errors = []
    for (const kind of ['source', 'words']) {
      const payload = structuredClone(workspace.presentation)
      if (kind === 'source') payload.inheritedVoices[0].source.review.authorReceiptHash = '0'.repeat(64)
      else payload.reading.voices[0].text += ' 改字后不能沿用'
      try {
        await authors.stageAvgAuthorArtifactV1({ scope, buildId: build.id, expectedBuildRevision: build.stateRevision,
          controlEpoch: build.controlEpoch, taskKey: task.taskKey, artifactKey: 'avg.author.stage', kind: 'presentation', payload,
          declaration: '工程拒绝探针，不授予任何修订、审听或采用证明' })
        errors.push(null)
      } catch (error) { errors.push(String(error)) }
    }
    return { errors, before, after: await schema.db.productBuildArtifacts.where('buildId').equals(build.id).count(),
      draftUnchanged: (await service.readAvgAssemblyWorkspaceV1(scope)).draft.editorJson === view.draft.editorJson,
      assemblyVersion: view.details.executionBrief.avgAssembly.version }
  }, s.seed.scope)
  expect(refusals.errors[0]).toMatch(/审听|采用证明/); expect(refusals.errors[1]).toMatch(/原句|绑定/)
  expect(refusals.after).toBe(refusals.before); expect(refusals.draftUnchanged).toBe(true); expect(refusals.assemblyVersion).toBe(1)
  await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  const releasePanel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await releasePanel.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click()
  await expect(releasePanel.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible()
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.text)
  const nextSessionId = Number(new URL(page.url()).searchParams.get('session'))
  await finishGeneratedVoiceLine(page, nextSessionId, s.seed.lineKey)
  await page.getByRole('button', { name: '继续', exact: true }).click(); await page.getByRole('button', { name: '打开灯光', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText('灯光亮起')
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
  }, nextSessionId)).toBe(true)
  await page.goto(`./avg/production?project=${s.seed.scope.projectId}&work=${s.seed.scope.workId}`)
  await releasePanel.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check()
  await releasePanel.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click()
  await releasePanel.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(releasePanel.getByRole('status').filter({ hasText: '本地原型版本已准备' })).toBeVisible()
  await releasePanel.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check()
  await releasePanel.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click()
  await releasePanel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.text)
  const releaseSessionId = Number(new URL(page.url()).searchParams.get('session'))
  await finishGeneratedVoiceLine(page, releaseSessionId, s.seed.lineKey)
  const proof = await page.evaluate(async ({ scope, old, oldSessionId, releaseSessionId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [schema, backups, sources, media, packages, hashes, workspaces, lifecycle] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/avg/generated-voice-source.ts'),
      load('/storyforge/src/lib/product-production/release-media.ts'), load('/storyforge/src/lib/product-production/runtime-package.ts'),
      load('/storyforge/src/lib/product-production/media-blob-store.ts'), load('/storyforge/src/lib/avg/author-workspace-contract.ts'), load('/storyforge/src/lib/workspace/lifecycle.ts')])
    const { db } = schema, session = await db.productRuntimeSessions.get(releaseSessionId), release = await db.productReleases.get(session.productReleaseId)
    const manifest = await packages.verifyProductReleaseManifest(release.manifestJson), asset = manifest.runtimePackage.modules[0].stage.assets[0]
    const originalHash = await hashes.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: release.id, asset }))
    const backup = await backups.exportProjectJSON(scope.projectId)
    if (JSON.stringify(backup).includes('test-only-intercepted-no-network')) throw new Error('Private fixture configuration entered backup')
    const projectId = await backups.importProjectJSON(backup), copied = await db.productReleases.where('projectId').equals(projectId).first()
    const copiedScope = { projectId, worldId: copied.worldId, workId: copied.workId }, draft = await db.avgAuthoringDrafts.where('workId').equals(copied.workId).first()
    const inherited = workspaces.parseAvgAuthorWorkspaceV1(draft.editorJson).presentation.inheritedVoices[0]
    const audio = await sources.readAvgAdoptedGeneratedVoiceV1({ scope: copiedScope, source: inherited.source })
    const restoredHash = await hashes.sha256MediaData(audio.data), copiedManifest = await packages.verifyProductReleaseManifest(copied.manifestJson)
    await lifecycle.deleteWork(copied.workId)
    const retainedHash = await hashes.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: release.id, asset }))
    return { session, oldSession: await db.productRuntimeSessions.get(oldSessionId), originalHash, restoredHash, retainedHash,
      originalRawUnchanged: JSON.stringify(await db.productBuildArtifacts.get(old.raw.id)) === JSON.stringify(old.raw),
      originalPreviewUnchanged: (await db.productBuilds.get(old.buildId)).previewHash === old.previewHash,
      copiedDeleted: !await db.productReleases.get(copied.id), packageHash: manifest.packageHash, restoredPackageHash: copiedManifest.packageHash,
      noImportAliases: await db.avgDraftMedia.where('workId').equals(scope.workId).count() === 0 }
  }, { scope: s.seed.scope, old, oldSessionId, releaseSessionId })
  expect(proof.session.productBuildId).toBeNull(); expect(proof.session.productReleaseId).toBeGreaterThan(0)
  expect(proof.oldSession.productBuildId).toBe(old.buildId); expect(proof.oldSession.productReleaseId).toBeNull()
  expect(proof.originalHash).toBe(old.raw.contentHash); expect(proof.restoredHash).toBe(proof.originalHash); expect(proof.retainedHash).toBe(proof.originalHash)
  expect(proof.originalRawUnchanged).toBe(true); expect(proof.originalPreviewUnchanged).toBe(true)
  expect(proof.copiedDeleted).toBe(true); expect(proof.noImportAliases).toBe(true); expect(proof.restoredPackageHash).toBe(proof.packageHash)
  expect(s.bodies).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('avg-inherited-voice-offline-release.png') })
})

test('two explicitly started five-line batches keep old clips, publish ten native voice consumers and restore both generations without resending', async ({ page }, info) => {
  test.setTimeout(240_000) // New two-batch ten-clip author/route/Release/restore slice.
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both experiments must be explicit')
  const s = await seedVoice(page, false, false, 5)
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: '查看并审听此句', exact: true }).nth(index).click()
    await expect(page.getByRole('region', { name: '配音审听与选择', exact: true })).toBeVisible()
    await reviewAndChoose(page, false, 5)
  }
  await page.getByRole('button', { name: '将已采用配音配置到逐句阅读', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已采用配音已配置到准确句子' })).toBeVisible()
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click(); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expectFiveLinePreviewReady(page, info, s.seed.scope)
  const old = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.where('workId').equals(scope.workId).first()
    const raws = await db.productBuildArtifacts.where('buildId').equals(build.id)
      .filter((row: any) => row.status === 'accepted' && row.artifactKey.startsWith('avg.voice.raw.')).toArray()
    return { buildId: build.id, previewHash: build.previewHash, raws }
  }, s.seed.scope)
  expect(old.raws).toHaveLength(5)
  await page.getByRole('button', { name: '以此预览开始修订', exact: true }).click()
  await page.getByRole('button', { name: '保存编辑草稿', exact: true }).click()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '保留已采用配音，结束本批需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已保留准确已采用配音并结束本批需求' })).toBeVisible()
  const editor = page.getByRole('region', { name: '逐句配音需求草稿', exact: true })
  await editor.getByLabel('Agnes 配音模型 ID', { exact: true }).fill('speech-fixture')
  for (let index = 5; index < 10; index++) await editor.getByRole('checkbox', { name: /第 \d+ 句/ }).nth(index).check()
  await fillVoicePresets(editor, 5, '原创 PCM 工程控制值，未签人声、艺术或商用验收', '本测试原创音频；供应商音色能力和条款须另验')
  await editor.getByRole('button', { name: '保存配音需求草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '准确配音需求已保存' })).toBeVisible()
  expect(s.bodies).toHaveLength(5)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '准备新版本方案', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await adopt(page, '系统规则'); for (const title of s.seed.scriptTitles) await adopt(page, `场景：${title}`)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '执行已确认的配音及联合媒资任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '查看并审听此句', exact: true })).toHaveCount(5)
  expect(s.bodies).toHaveLength(10)
  expect(s.bodies.slice(0, 5).map(body => body.input).sort()).toEqual(s.seed.texts.slice(0, 5).sort())
  expect(s.bodies.slice(5).map(body => body.input).sort()).toEqual(s.seed.texts.slice(5).sort())
  for (let index = 0; index < 5; index++) {
    await page.getByRole('button', { name: '查看并审听此句', exact: true }).nth(index).click()
    await expect(page.getByRole('region', { name: '配音审听与选择', exact: true })).toBeVisible()
    await reviewAndChoose(page, false, 5)
  }
  await page.getByRole('button', { name: '将已采用配音配置到逐句阅读', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已采用配音已配置到准确句子' })).toBeVisible()
  const combined = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [service, workspaces, config] = await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),
      load('/storyforge/src/lib/avg/author-workspace-contract.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const view = await service.readAvgAssemblyWorkspaceV1(scope), workspace = workspaces.parseAvgAuthorWorkspaceV1(view.draft.editorJson)
    config.useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'unused-offline' })
    return { assetCount: workspace.presentation.stage.assets.length, voices: workspace.presentation.reading.voices,
      inherited: workspace.presentation.inheritedVoices.length,
      newTasks: JSON.parse(view.details.build.planJson).tasks.filter((task: any) => task.kind === 'avg-media-voice-generate').length }
  }, s.seed.scope)
  expect(combined.assetCount).toBe(10); expect(combined.voices).toHaveLength(10); expect(combined.inherited).toBe(5); expect(combined.newTasks).toBe(5)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click(); await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  const releasePanel = page.getByRole('region', { name: '本地原型版本验收', exact: true })
  await releasePanel.getByRole('button', { name: '验证全部冻结媒资', exact: true }).click()
  await expect(releasePanel.getByRole('status').filter({ hasText: '全部冻结媒资已实际解码' })).toBeVisible()
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.texts[0])
  const previewSessionId = Number(new URL(page.url()).searchParams.get('session'))
  for (let index = 0; index < 10; index++) {
    await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.texts[index])
    await finishGeneratedVoiceLine(page, previewSessionId, s.seed.lineKeys[index])
    await page.getByRole('button', { name: '继续', exact: true }).click()
  }
  await page.getByRole('button', { name: '打开灯光', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText('灯光亮起')
  await expect(page.locator('.avg-text-cursor')).toHaveClass(/is-complete/)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(id)).narrative.completed
  }, previewSessionId)).toBe(true)
  await page.goto(`./avg/production?project=${s.seed.scope.projectId}&work=${s.seed.scope.workId}`)
  await releasePanel.getByRole('checkbox', { name: '我已核对此预览存档的完整路线，确认系统与演出结果', exact: true }).check()
  await releasePanel.getByRole('button', { name: '确认此预览的完整路线', exact: true }).click()
  await releasePanel.getByRole('button', { name: '准备本地原型版本', exact: true }).click()
  await expect(releasePanel.getByRole('status').filter({ hasText: '本地原型版本已准备' })).toBeVisible()
  await releasePanel.getByRole('checkbox', { name: '我已核对版本，将它保存为本地原型', exact: true }).check()
  await releasePanel.getByRole('button', { name: '确认保存本地原型版本', exact: true }).click()
  await releasePanel.getByRole('button', { name: '从此版本开始新存档', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.texts[0])
  const releaseSessionId = Number(new URL(page.url()).searchParams.get('session'))
  await finishGeneratedVoiceLine(page, releaseSessionId, s.seed.lineKeys[0])
  const proof = await page.evaluate(async ({ scope, old, releaseSessionId }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [schema, packages, media, hashes, backup, sources, workspaces, lifecycle] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/product-production/runtime-package.ts'),
      load('/storyforge/src/lib/product-production/release-media.ts'), load('/storyforge/src/lib/product-production/media-blob-store.ts'),
      load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/avg/generated-voice-source.ts'),
      load('/storyforge/src/lib/avg/author-workspace-contract.ts'), load('/storyforge/src/lib/workspace/lifecycle.ts')])
    const { db } = schema, session = await db.productRuntimeSessions.get(releaseSessionId), release = await db.productReleases.get(session.productReleaseId)
    const manifest = await packages.verifyProductReleaseManifest(release.manifestJson), assets = manifest.runtimePackage.modules[0].stage.assets
    const originalHashes = []
    for (const asset of assets) originalHashes.push(await hashes.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: release.id, asset })))
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId)), copied = await db.productReleases.where('projectId').equals(projectId).first()
    const copiedScope = { projectId, worldId: copied.worldId, workId: copied.workId }, copiedManifest = await packages.verifyProductReleaseManifest(copied.manifestJson)
    const draft = await db.avgAuthoringDrafts.where('workId').equals(copied.workId).first(), inherited = workspaces.parseAvgAuthorWorkspaceV1(draft.editorJson).presentation.inheritedVoices
    const inheritedHashes = [], copiedHashes = []
    for (const entry of inherited) inheritedHashes.push(await hashes.sha256MediaData((await sources.readAvgAdoptedGeneratedVoiceV1({ scope: copiedScope, source: entry.source })).data))
    for (const asset of copiedManifest.runtimePackage.modules[0].stage.assets) copiedHashes.push(await hashes.sha256MediaData(await media.readProductReleaseMediaBytes({ scope: copiedScope, productReleaseId: copied.id, asset })))
    await lifecycle.deleteWork(copied.workId)
    const retainedHashes = []
    for (const asset of assets) retainedHashes.push(await hashes.sha256MediaData(await media.readProductReleaseMediaBytes({ scope, productReleaseId: release.id, asset })))
    const originalRaws = await Promise.all(old.raws.map((row: any) => db.productBuildArtifacts.get(row.id)))
    return { originalHashes, copiedHashes, retainedHashes, inheritedHashes, packageHash: manifest.packageHash, copiedPackageHash: copiedManifest.packageHash,
      originalPreviewUnchanged: (await db.productBuilds.get(old.buildId)).previewHash === old.previewHash,
      originalRawsUnchanged: JSON.stringify(originalRaws) === JSON.stringify(old.raws), noImportAliases: await db.avgDraftMedia.where('workId').equals(scope.workId).count() === 0 }
  }, { scope: s.seed.scope, old, releaseSessionId })
  expect(proof.originalHashes).toHaveLength(10); expect(new Set(proof.originalHashes).size).toBe(10)
  expect(proof.copiedHashes).toEqual(proof.originalHashes); expect(proof.retainedHashes).toEqual(proof.originalHashes)
  expect(proof.inheritedHashes.sort()).toEqual(old.raws.map((row: { contentHash: string }) => row.contentHash).sort())
  expect(proof.copiedPackageHash).toBe(proof.packageHash); expect(proof.originalPreviewUnchanged).toBe(true)
  expect(proof.originalRawsUnchanged).toBe(true); expect(proof.noImportAliases).toBe(true); expect(s.bodies).toHaveLength(10)
  await page.screenshot({ path: info.outputPath('avg-two-batches-ten-voices-release.png') })
})

test('a stopped consumed batch retains its adopted clip across the advanced control fence and starts a zero-call author version', async ({ page }, info) => {
  test.setTimeout(120_000) // New stopped-source epoch and author restart path.
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION !== '1', 'Both experiments must be explicit')
  const s = await seedVoice(page); await reviewAndChoose(page)
  await page.getByRole('button', { name: '停止本批并选择保留或重录', exact: true }).click()
  const finish = page.getByRole('button', { name: '保留已采用配音，结束本批需求', exact: true })
  await expect(finish).toBeEnabled(); await finish.click()
  await expect(page.getByRole('status').filter({ hasText: '已保留准确已采用配音并结束本批需求' })).toBeVisible()
  const before = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [service, schema, workspaces, config] = await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'),
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/avg/author-workspace-contract.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const view = await service.readAvgAssemblyWorkspaceV1(scope), workspace = workspaces.parseAvgAuthorWorkspaceV1(view.draft.editorJson)
    const raw = await schema.db.productBuildArtifacts.where('buildId').equals(view.details.build.id)
      .filter((row: any) => row.status === 'accepted' && row.artifactKey.startsWith('avg.voice.raw.')).first()
    config.useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'unused-offline' })
    return { build: view.details.build, source: workspace.presentation.inheritedVoices[0].source, raw, hasBatch: !!workspace.voiceProduction }
  }, s.seed.scope)
  expect(before.hasBatch).toBe(false); expect(before.build.status).toBe('cancelled')
  expect(before.build.controlEpoch).toBeGreaterThan(before.source.raw.controlEpoch)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '停止并保留当前组装，准备新版本', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await adopt(page, '系统规则'); for (const title of s.seed.scriptTitles) await adopt(page, `场景：${title}`)
  await adopt(page, '演出与媒资')
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩此预览', exact: true })).toBeEnabled()
  const proof = await page.evaluate(async ({ scope, before }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [service, schema] = await Promise.all([load('/storyforge/src/lib/avg/assembly-service.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const view = await service.readAvgAssemblyWorkspaceV1(scope)
    return { oldBuildUnchanged: JSON.stringify(await schema.db.productBuilds.get(before.build.id)) === JSON.stringify(before.build),
      oldRawUnchanged: JSON.stringify(await schema.db.productBuildArtifacts.get(before.raw.id)) === JSON.stringify(before.raw),
      currentBuildId: view.details.build.id, assemblyVersion: view.details.executionBrief.avgAssembly.version,
      voiceGenerationTasks: JSON.parse(view.details.build.planJson).tasks.filter((task: any) => task.kind === 'avg-media-voice-generate').length }
  }, { scope: s.seed.scope, before })
  expect(proof.oldBuildUnchanged).toBe(true); expect(proof.oldRawUnchanged).toBe(true)
  expect(proof.currentBuildId).not.toBe(before.build.id); expect(proof.assemblyVersion).toBe(1); expect(proof.voiceGenerationTasks).toBe(0)
  await page.getByRole('button', { name: '试玩此预览', exact: true }).click()
  await expect(page.locator('.avg-dialogue p')).toContainText(s.seed.text)
  const sessionId = Number(new URL(page.url()).searchParams.get('session'))
  await finishGeneratedVoiceLine(page, sessionId, s.seed.lineKey)
  expect(s.bodies).toHaveLength(1)
  await page.screenshot({ path: info.outputPath('avg-stopped-voice-zero-call-preview.png') })
})
