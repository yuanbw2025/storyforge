import { expect, type Locator, type Page } from '@playwright/test'
import { avgSoundCapabilityFixtureV1, avgSoundLibraryFixtureV1, avgSoundMusicResultFixtureV1, avgSoundPcmFixtureV1 } from './avg-sound-wire-data'
import { avgSoundPublisherFixtureV2 } from './avg-sound-publisher-fixture'
import { AVG_LOCAL_VOICE_IDS_V1, AVG_LOCAL_VOICE_MODEL_V1, AVG_LOCAL_VOICE_REVISION_V1 } from '../../src/lib/avg/voice-local-profile'
import { adoptSource } from './avg-combined-native-visual-fixture'

type Owner = { projectId: number; worldId: number; workId: number }
const declaration = 'ENGINEERING isolated UI/HTTP/native decoder controls; no real speech, hearing, art or commercial acceptance'
export const combinedProductionUrl = (scope: Owner) => `./avg/production?project=${scope.projectId}&work=${scope.workId}&assembly=1`

export async function reviseCombinedPreview(page: Page) {
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '以此预览开始修订', exact: true }).click()
  await page.getByRole('button', { name: '保存编辑草稿', exact: true }).click()
}

export async function startCombinedPlan(page: Page, titles: string[]) {
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '确认方案并开始组装', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已明确开始' })).toBeVisible()
  await page.getByRole('textbox', { name: '作者输入声明', exact: true }).fill(declaration)
  await adoptSource(page, '系统规则')
  for (const title of titles) await adoptSource(page, `场景：${title}`)
}

export async function freezeCombinedStage(page: Page) {
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await adoptSource(page, '演出与媒资', true)
  await page.getByRole('button', { name: '执行组装并生成新预览', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '新预览已冻结' })).toBeVisible({ timeout: 60_000 })
}

/** Supplies only editable Sound input and exact intercepted HTTP. All plan,
 * review, choice, Stage and Release authorities still require public UI acts.
 * No accepted row, Run, author receipt or quality result is seeded here. */
export async function prepareCombinedSoundInput(page: Page, scope: Owner) {
  const state = await page.evaluate(async ({ scope, declaration }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, sound, catalogue, config, fixtures] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/avg/sound-draft-service.ts'), load('/storyforge/src/lib/avg/sound-provider-contract.ts'), load('/storyforge/src/stores/ai-config.ts'),
      load('/storyforge/tests/helpers/avg-reading-fixture.ts')])
    const draft = await drafts.readAvgDraftV1(scope), workspace = JSON.parse(draft.editorJson), script = workspace.scripts[0]
    const library = catalogue.listAvgSoundLibraryMetadataV1().find((s: any) => s.memberPath === 'Audio/click_001.ogg')
    const publisher = catalogue.listAvgSoundLibraryMetadataV2().find((s: any) => s.memberPath === 'rain.ogg')
    if (!library || !publisher) throw new Error('The two original licensed source entries are required')
    const templates = (['bgm', 'sfx', 'ambience'] as const).map((channel, i) => ({
      requirementKey: `combined.${channel}`, assetKey: `combined.${channel}`, channel,
      purpose: `${declaration}: ${channel}`, constraints: ['Preserve exact original bytes and dialogue space'],
      consumer: { consumerKey: `combined.${channel}`, domain: 'stage', slot: channel, subjectKey: script.sceneKey,
        sceneKey: script.sceneKey, lineKey: null, required: true, fallback: 'none' },
      cue: { cueKey: `combined.${channel}`, beatKey: script.lines[0].lineKey, phase: 'before', order: 10 + i,
        volume: channel === 'bgm' ? .2 : channel === 'sfx' ? .5 : .3, loop: channel === 'bgm' },
      source: channel === 'bgm' ? { kind: 'generate-music', durationSeconds: 12, seed: 103, bpm: 68, keyscale: 'A Minor' }
        : { kind: 'licensed-library', allowedSourceKeys: [channel === 'sfx' ? library.sourceKey : publisher.sourceKey] },
    }))
    await sound.saveAvgSoundProductionDraftV1({ scope, expectedDraftRevision: draft.revision,
      planning: { schema: 'storyforge.avg.sound-planning-scope', version: 1, templates, librarySources: [library, publisher] } })
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://visual.fixture.invalid/v1',
      apiKey: 'isolated-engineering-no-live-account', model: 'agnes-2.5-flash' })
    // The existing PCM fixture is loaded in its actual browser environment;
    // importing its DB/Vitest helpers into the Node runner is unsupported.
    const voice = await fixtures.avgReadingAudioFixture(4000), bytes = new Uint8Array(voice.data), pcm = new DataView(bytes.buffer)
    for (let i = 44; i < bytes.length; i += 2) pcm.setInt16(i, pcm.getInt16(i, true) * 10, true)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384))
    return { voiceWave: btoa(binary), lineKey: script.lines[0].lineKey, text: script.lines[0].text, plan: {
      schema: 'storyforge.avg.sound-plan', version: 1,
      direction: { goal: declaration, dialogueSpace: 'Leave space for dialogue', continuity: 'Retain original exact sources' },
      entries: templates.map(t => ({ requirementKey: t.requirementKey, designIntent: declaration,
        prompt: t.channel === 'bgm' ? 'Original quiet spacious instrumental piano, no lyrics or voices' : null,
        librarySourceKey: t.channel === 'bgm' ? null : t.channel === 'sfx' ? library.sourceKey : publisher.sourceKey,
        acceptanceNotes: [declaration] })),
    } }
  }, { scope, declaration })
  const capability = avgSoundCapabilityFixtureV1(), library = avgSoundLibraryFixtureV1(), publisher = avgSoundPublisherFixtureV2()
  const voice = { data: Uint8Array.from(Buffer.from(state.voiceWave, 'base64')).buffer }
  const counts = { text: 0, music: 0, library: 0, publisher: 0, voice: 0, voiceBodies: [] as any[], unknown: [] as string[] }
  let phase: 'sound' | 'voice' | 'closed' = 'sound'
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, Authorization, X-Storyforge-Idempotency-Key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'X-Storyforge-Music-Result, X-Storyforge-Library-Result, X-Request-Id, X-Storyforge-Cost-Usd' }
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url())
    if (!['5298', '5297'].includes(u.port) && u.hostname !== 'visual.fixture.invalid') return route.fallback()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (phase === 'sound' && u.href === 'https://visual.fixture.invalid/v1/chat/completions' && req.method() === 'POST') {
      counts.text++; return route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: JSON.stringify(state.plan) } }],
        usage: { prompt_tokens: 200, completion_tokens: 200 } }, headers: cors })
    }
    if (phase === 'sound' && u.href === 'http://127.0.0.1:5298/v1/capabilities') return route.fulfill({ json: capability, headers: cors })
    if (phase === 'sound' && u.href === 'http://127.0.0.1:5298/v1/audio/music' && req.method() === 'POST') {
      counts.music++; const body = req.postDataJSON(), data = avgSoundPcmFixtureV1(body.durationSeconds)
      const result = await avgSoundMusicResultFixtureV1({ capability, data, body, idempotencyKey: req.headers()['x-storyforge-idempotency-key'] })
      return route.fulfill({ body: Buffer.from(data), headers: { ...cors, 'content-type': 'audio/wav',
        'x-request-id': result.jobId, 'x-storyforge-music-result': JSON.stringify(result) } })
    }
    for (const source of [library, publisher]) if (phase === 'sound' && req.method() === 'GET'
      && u.href === `http://127.0.0.1:5298/v1/library/audio/${source.source.archiveHash}/${source.source.memberHash}`) {
      counts.library++; if (source === publisher) counts.publisher++
      return route.fulfill({ body: Buffer.from(source.data), headers: { ...cors, 'content-type': 'audio/ogg',
        'x-storyforge-library-result': JSON.stringify(source.result) } })
    }
    if (phase === 'voice' && u.href === 'http://127.0.0.1:5297/v1/capabilities') return route.fulfill({ headers: cors, json: {
      schema: 'storyforge.avg.local-speech-capability', version: 1, provider: 'storyforge-local-qwen3',
      model: AVG_LOCAL_VOICE_MODEL_V1, modelRevision: AVG_LOCAL_VOICE_REVISION_V1, voices: [...AVG_LOCAL_VOICE_IDS_V1],
      locale: 'zh-CN', outputFormat: 'wav', maximumInputCharacters: 256, supportsInstructions: true,
      maximumInstructionsCharacters: 2048, speedRange: null, license: 'Apache-2.0', voiceMode: 'fixed-preset',
    } })
    if (phase === 'voice' && u.href === 'http://127.0.0.1:5297/v1/audio/speech' && req.method() === 'POST') {
      counts.voice++; const body = req.postDataJSON(); counts.voiceBodies.push(body)
      expect(body).toEqual({ input: state.text, model: AVG_LOCAL_VOICE_MODEL_V1, voice: 'Dylan', response_format: 'wav' })
      expect(req.headers()).not.toHaveProperty('authorization')
      return route.fulfill({ body: Buffer.from(voice.data), headers: { ...cors, 'content-type': 'audio/wav',
        'x-request-id': 'combined-native-fixed-Dylan', 'x-storyforge-cost-usd': '0' } })
    }
    counts.unknown.push(`${req.method()} ${u.href}`); return route.abort('blockedbyclient')
  })
  return { ...state, counts, publisher, library, voice, setPhase: (next: typeof phase) => { phase = next } }
}

async function confirmSound(panel: Locator, channel: 'bgm' | 'sfx' | 'ambience') {
  const loop = channel === 'bgm'
  await panel.getByRole('button', { name: '从头审听原声音', exact: true }).click()
  await expect(panel.getByRole('status').filter({ hasText: `原声音已完整原速播放 ${loop ? 2 : 1} 遍` })).toBeVisible({ timeout: 40_000 })
  for (const name of ['符合用途', '噪音与失真', '首尾完整', ...(loop ? ['纯器乐无歌词', '循环接缝'] : [])]) {
    await panel.getByRole('combobox', { name, exact: true }).selectOption('pass')
  }
  for (const input of await panel.getByRole('textbox', { name: '观察依据', exact: true }).all()) await input.fill(declaration)
  await panel.getByRole('textbox', { name: '本轮声音审听依据', exact: true }).fill(declaration)
  await panel.getByRole('button', { name: '保存为待确认声音观察', exact: true }).click()
  await panel.getByRole('button', { name: '确认这份声音观察', exact: true }).click()
  await panel.getByRole('button', { name: '将原声音列为待确认选择', exact: true }).click()
  await panel.getByRole('button', { name: '确认采用原声音', exact: true }).click()
  await expect(panel.getByText('已采用声音 v1。舞台配置和演出确认仍须另行完成。', { exact: true })).toBeVisible()
}

export async function produceCombinedSounds(page: Page, titles: string[]) {
  await page.getByRole('button', { name: '核对并准备声音制作', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '声音制作方案已保存' })).toBeVisible()
  await startCombinedPlan(page, titles)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  const panel = page.getByRole('region', { name: '声音生产工作台', exact: true })
  await panel.getByRole('button', { name: '生成本批声音方案', exact: true }).click()
  const plan = panel.getByRole('region', { name: '声音方案确认', exact: true })
  await expect(plan.getByRole('textbox', { name: '声音方向', exact: true })).toBeVisible({ timeout: 30_000 })
  await plan.getByRole('button', { name: '保存为待确认声音方案', exact: true }).click()
  await plan.getByRole('checkbox', { name: '我已核对声音方案、来源范围与投入边界', exact: true }).check()
  await plan.getByRole('button', { name: '确认采用声音方案', exact: true }).click()
  await expect(plan.getByText('已采用声音方案 v1', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    ;(await load('/storyforge/src/stores/ai-config.ts')).useAIConfigStore.getState().setConfig({ apiKey: '' })
  })
  await panel.getByRole('button', { name: '继续本批声音制作', exact: true }).click()
  await expect(panel.getByRole('button', { name: '查看并审听原声音', exact: true })).toHaveCount(3, { timeout: 60_000 })
  for (const channel of ['bgm', 'sfx', 'ambience'] as const) {
    const row = panel.getByRole('article', { name: `声音用途 combined.${channel}`, exact: true })
    await row.getByRole('button', { name: '查看并审听原声音', exact: true }).click()
    await confirmSound(row.getByRole('region', { name: '声音审听与选择', exact: true }), channel)
  }
  await panel.getByRole('button', { name: '将已采用声音配置到演出草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已采用声音已配置到准确台词触发拍和通道' })).toBeVisible()
  await freezeCombinedStage(page)
}

export async function produceCombinedVoice(page: Page, titles: string[]) {
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '保留已采用声音，结束本批需求', exact: true }).click()
  const editor = page.getByRole('region', { name: '逐句配音需求草稿', exact: true })
  await editor.getByRole('checkbox', { name: /第 1 句/ }).first().check()
  await editor.getByRole('combobox', { name: '音色', exact: true }).selectOption('Dylan')
  await editor.getByRole('textbox', { name: '音色使用权说明', exact: true }).fill(declaration)
  await editor.getByRole('button', { name: '保存配音需求草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '准确配音需求已保存' })).toBeVisible()
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '准备新版本方案', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '制作方案已准备' })).toBeVisible()
  await startCombinedPlan(page, titles)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '执行已确认的配音及联合媒资任务', exact: true }).click()
  const open = page.getByRole('button', { name: '查看并审听此句', exact: true })
  await expect(open).toHaveCount(1, { timeout: 60_000 }); await open.click()
  const review = page.getByRole('region', { name: '配音审听与选择', exact: true })
  await expect(review.getByLabel('与原句一致', { exact: true }).locator('option[value="pass"]')).toHaveJSProperty('disabled', true)
  await review.getByRole('button', { name: '从头开启新一轮审听', exact: true }).click()
  await review.locator('audio').evaluate((audio: HTMLAudioElement) => audio.play())
  await expect(review.locator('audio')).toHaveJSProperty('ended', true, { timeout: 10_000 })
  for (const label of ['与原句一致', '读音', '演法', '首尾完整', '噪音与破音']) await review.getByLabel(label, { exact: true }).selectOption('pass')
  for (const input of await review.getByLabel('观察依据', { exact: true }).all()) await input.fill(declaration)
  await review.getByLabel('本轮审听依据', { exact: true }).fill(declaration)
  await review.getByRole('button', { name: '保存为待确认审听记录', exact: true }).click()
  await review.getByRole('button', { name: '确认这份审听记录', exact: true }).click()
  await review.getByRole('button', { name: '将这版配音列为待确认选择', exact: true }).click()
  await review.getByRole('button', { name: '确认采用这版配音', exact: true }).click()
  await page.getByRole('button', { name: '将已采用配音配置到逐句阅读', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已采用配音已配置到准确句子' })).toBeVisible()
  await freezeCombinedStage(page)
}
