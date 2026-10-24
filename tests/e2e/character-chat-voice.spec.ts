import {test, expect, type Page} from '@playwright/test'

interface VoiceFixture {
  mode: 'allow' | 'deny' | 'network'
  starts: number; spoken: Array<{text: string; voice: string; volume: number}>; pauses: number; resumes: number; cancels: number
  result(text: string): void; failPlayback(): void
}
type VoiceWindow = Window & {chatVoiceFixture: VoiceFixture}

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', model: 'test', baseUrl: 'https://chat-voice.invalid/v1', apiKey: ''}))
    let recognition: () => Recognition, utterance: Utterance
    const state: VoiceFixture = {mode: 'allow', starts: 0, spoken: [], pauses: 0, resumes: 0, cancels: 0,
      result: text => recognition().onresult?.({results: [{isFinal: true, 0: {transcript: text}}]}), failPlayback: () => utterance.onerror?.()}
    class Recognition {
      onstart?: () => void; onend?: () => void; onerror?: (event: {error: string}) => void
      onresult?: (event: {results: Array<{isFinal: boolean; 0: {transcript: string}}>}) => void
      start() {recognition = () => this; state.starts++; if (state.mode === 'allow') this.onstart?.(); else this.onerror?.({error: state.mode === 'deny' ? 'not-allowed' : 'network'})}
      stop() {this.onend?.()} abort() {}
    }
    class Utterance {
      onstart?: () => void; onend?: () => void; onerror?: () => void; volume = 1; voice?: SpeechSynthesisVoice
      constructor(public text: string) {}
    }
    const events = new EventTarget(), voices = [{voiceURI: 'isolated.zh', name: '工程测试音色', lang: 'zh-CN', localService: true, default: true}]
    Object.defineProperty(window, 'SpeechRecognition', {configurable: true, value: Recognition})
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable: true, value: Utterance})
    Object.defineProperty(window, 'speechSynthesis', {configurable: true, value: {
      getVoices: () => voices, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      speak: (item: Utterance) => {utterance = item; state.spoken.push({text: item.text, voice: item.voice?.voiceURI ?? '', volume: item.volume}); item.onstart?.()},
      cancel: () => {state.cancels++}, pause: () => {state.pauses++}, resume: () => {state.resumes++},
    }})
    ;(window as unknown as VoiceWindow).chatVoiceFixture = state
  })
  let externalCalls = 0
  await page.route('https://chat-voice.invalid/**', async route => {externalCalls++; await route.abort()})
  await page.route('**/local-codex/v1/requests', async route => {if (route.request().method() === 'POST') {externalCalls++; await route.abort()} else await route.continue()})
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), helpers = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const f = await helpers.seedChatNarrativeRuntimeFixture(), v = await api.readProductRuntimeStateVersion(f.sessionId)
    await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'voice.opening', baseSequence: v.sequence, baseStateHash: v.stateHash,
      kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 1}})
    let expressionAndReviewCalls = 0
    const candidate = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
      skillId: 'character.chat-narrative-action', objective: 'Voice UI engineering fixture; not narrative quality evidence',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => {expressionAndReviewCalls++; return JSON.stringify({kind: 'speak', text: '雨还没停，我先看看门边的告示。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
      runReviewAI: async () => {expressionAndReviewCalls++; return JSON.stringify(helpers.chatActionReviewOutputFixture())}})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {...f, expressionAndReviewCalls, state: JSON.stringify(await api.readProductRuntimeState(f.sessionId)), worlds: JSON.stringify(await db.worldReleases.toArray())}
  })
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await expect(page.getByRole('button', {name: '朗读', exact: true})).toBeEnabled()
  expect(f.expressionAndReviewCalls).toBe(2)
  return {f, calls: () => externalCalls}
}

for (const width of [390, 1440]) test(`voice requires transcript confirmation and never changes story state at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844})
  const {f, calls} = await prepare(page), controls = page.getByTestId('chat-voice-controls'), summary = controls.locator('summary').first()
  const input = page.getByLabel('发送给角色的消息', {exact: true})
  await input.fill('保留原有草稿。')
  await summary.click()
  await controls.getByRole('button', {name: '开始语音输入', exact: true}).click()
  await page.evaluate(() => (window as unknown as VoiceWindow).chatVoiceFixture.result('先休息，再商量。'))
  await expect(controls.getByRole('button', {name: '结束录音并查看转写', exact: true})).toBeInViewport({ratio: 1})
  await controls.getByRole('button', {name: '结束录音并查看转写', exact: true}).click()
  await expect(controls.getByLabel('待确认的语音转写')).toHaveValue('先休息，再商量。')
  await expect(input).toHaveValue('保留原有草稿。')
  await controls.getByRole('button', {name: '添加到输入框', exact: true}).click()
  await expect(input).toHaveValue('保留原有草稿。\n先休息，再商量。')
  await expect(controls.getByLabel('待确认的语音转写')).toHaveCount(0)
  await controls.getByText('此设备的角色音色', {exact: true}).click()
  await controls.getByLabel('叶岑的朗读音色').selectOption('isolated.zh')
  await controls.getByLabel('朗读音量').fill('0.5')
  await summary.click()
  await page.getByRole('button', {name: '朗读', exact: true}).click()
  await summary.click()
  await controls.getByRole('button', {name: '暂停朗读', exact: true}).click()
  await controls.getByRole('button', {name: '继续朗读', exact: true}).click()
  const spoken = await page.evaluate(() => {const s = (window as unknown as VoiceWindow).chatVoiceFixture; return {spoken: s.spoken, pauses: s.pauses, resumes: s.resumes}})
  expect(spoken).toEqual({spoken: [{text: '雨还没停，我先看看门边的告示。', voice: 'isolated.zh', volume: .5}], pauses: 1, resumes: 1})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({path: info.outputPath(`chat-voice-${width}.png`), fullPage: false})
  await summary.click()
  await page.getByLabel('对话范围', {exact: true}).selectOption(JSON.stringify(['guard']))
  await expect(page.getByRole('button', {name: '停止朗读', exact: true})).toHaveCount(0)
  await expect(input).toHaveValue('保留原有草稿。\n先休息，再商量。')
  await summary.click()
  await controls.getByRole('button', {name: '开始语音输入', exact: true}).click()
  await page.evaluate(() => (window as unknown as VoiceWindow).chatVoiceFixture.result('尚未确认的私聊。'))
  await expect(controls.getByRole('button', {name: '结束录音并查看转写', exact: true})).toBeInViewport({ratio: 1})
  await controls.getByRole('button', {name: '结束录音并查看转写', exact: true}).click()
  await summary.click()
  await page.getByLabel('对话范围', {exact: true}).selectOption('')
  await summary.click()
  await expect(controls.getByLabel('待确认的语音转写')).toHaveCount(0)
  await summary.click()
  await expect(input).toBeInViewport({ratio: 1})
  await expect(page.getByRole('button', {name: '仅保存消息', exact: true})).toBeInViewport({ratio: 1})
  await expect(page.getByText('草稿已保存，仅在此存档可见', {exact: true})).toBeVisible()
  await page.reload()
  await expect(input).toHaveValue('保留原有草稿。\n先休息，再商量。')
  expect(await page.evaluate(() => (window as unknown as VoiceWindow).chatVoiceFixture.spoken.length)).toBe(0)
  await summary.click()
  await controls.getByText('此设备的角色音色', {exact: true}).click()
  await expect(controls.getByLabel('叶岑的朗读音色')).toHaveValue('isolated.zh')
  await expect(controls.getByLabel('朗读音量')).toHaveValue('0.5')
  await summary.click()
  const after = await page.evaluate(async sessionId => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {state: JSON.stringify(await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(sessionId)), worlds: JSON.stringify(await db.worldReleases.toArray())}
  }, f.sessionId)
  expect(after).toEqual({state: f.state, worlds: f.worlds})
  expect(calls()).toBe(0)
})

test('microphone refusal, recognition network errors and playback failure leave text input usable', async ({page}) => {
  const {calls} = await prepare(page), controls = page.getByTestId('chat-voice-controls'), summary = controls.locator('summary').first()
  const input = page.getByLabel('发送给角色的消息', {exact: true})
  await input.fill('语音失败时保留这份文字。')
  await summary.click()
  for (const mode of ['deny', 'network'] as const) {
    await page.evaluate(mode => {(window as unknown as VoiceWindow).chatVoiceFixture.mode = mode}, mode)
    await controls.getByRole('button', {name: '开始语音输入', exact: true}).click()
    await expect(controls.getByRole('alert')).toContainText(mode === 'deny' ? '权限未开放' : '连接失败')
    await expect(input).toHaveValue('语音失败时保留这份文字。')
    await expect(input).toBeEnabled()
    await expect(page.getByRole('button', {name: '仅保存消息', exact: true})).toBeEnabled()
  }
  await summary.click()
  await page.getByRole('button', {name: '朗读', exact: true}).click()
  await page.evaluate(() => (window as unknown as VoiceWindow).chatVoiceFixture.failPlayback())
  await summary.click()
  await expect(controls.getByRole('alert')).toContainText('朗读未完成')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'storyforge-chat-voice-preferences-v1') throw new DOMException('isolated quota failure', 'QuotaExceededError')
      original.call(this, key, value)
    }
  })
  await controls.getByLabel('朗读音量').fill('0.4')
  await expect(controls.getByText('浏览器无法保存语音设置，本次修改仅在当前页面有效。', {exact: true})).toBeVisible()
  await expect(controls.getByLabel('朗读音量')).toHaveValue('0.4')
  await summary.click()
  await page.getByRole('button', {name: '仅保存消息', exact: true}).click()
  await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText('语音失败时保留这份文字。', {exact: true})).toBeVisible()
  expect(calls()).toBe(0)
})
