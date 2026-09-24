import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

async function setup(page: Page, browserVoice = true) {
  await page.addInitScript(({ browserVoice }) => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama', baseUrl: 'https://companion-test.invalid/v1', model: 'isolated-test', temperature: 0,
    }))
    if (!browserVoice) return
    const probe = { recognition: null as any, starts: 0, aborts: 0, spoken: [] as string[], canceled: 0 }
    ;(window as any).__voiceProbe = probe
    class Recognition {
      onstart?: () => void
      onend?: () => void
      onresult?: (event: unknown) => void
      start() { probe.recognition = this; probe.starts++; this.onstart?.() }
      stop() {
        this.onresult?.({ results: [{ isFinal: true, 0: { transcript: '我们先讨论女主的动机，暂时不要生成正文。' } }] })
        this.onend?.()
      }
      abort() { probe.aborts++ }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(public text: string) {} } })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [], addEventListener: () => {}, removeEventListener: () => {},
      speak: (utterance: any) => { probe.spoken.push(utterance.text); utterance.onstart?.() },
      cancel: () => { probe.canceled++ },
    } })
  }, { browserVoice })
  await createLongform(page, '墨灵隔离验收')
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toBeEnabled()
}

test('voice enters an editable request, shares the same discussion, speaks and interrupts without adopting', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await setup(page)
  let calls = 0
  await page.route('https://companion-test.invalid/v1/chat/completions', async (route) => {
    calls++
    expect(route.request().postData()).toContain('女主的动机')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: '可以先从她需要守护的人谈起，再讨论背叛的代价。', tasks: [] }) } }],
    }) })
  })
  expect(await page.evaluate(() => (window as any).__voiceProbe.starts)).toBe(0)
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('已有想法：')
  await page.getByRole('button', { name: '语音输入', exact: true }).click()
  await expect(page.getByText('正在听，结束后可编辑文字')).toBeVisible()
  await expect(page.locator('.companion-portrait-compact')).toHaveAttribute('data-pose', 'listening')
  await page.getByRole('button', { name: '结束说话并识别' }).click()
  const input = page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })
  await expect(input).toHaveValue('已有想法：\n我们先讨论女主的动机，暂时不要生成正文。')
  expect(calls).toBe(0)
  await page.getByRole('button', { name: '讨论与规划', exact: true }).click()
  await expect(page.getByText('可以先从她需要守护的人谈起，再讨论背叛的代价。', { exact: true })).toBeVisible()
  expect(calls).toBe(1)
  await expect(page.getByRole('button', { name: '确认计划并开始', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '朗读这条回复' }).last().click()
  await expect(page.locator('.companion-portrait-compact')).toHaveAttribute('data-pose', 'speaking')
  await expect(page.getByRole('button', { name: '停止朗读', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('companion-speaking.png') })
  await page.getByRole('button', { name: '语音输入', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__voiceProbe.canceled)).toBeGreaterThan(0)
  await page.getByRole('button', { name: '放弃本次语音' }).click()
  await expect(input).toHaveValue('')
  const counts = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return [await db.chapters.count(), await db.characters.count(), await db.outlineNodes.count()]
  })
  expect(counts).toEqual([0, 0, 0])
})

test('companion and settings fit mobile, hide persistently and preserve the author request', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setup(page)
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('这个想法要保留')
  const messageBounds = await page.locator('.agent-messages').boundingBox()
  expect(messageBounds!.height).toBeGreaterThan(260)
  await page.getByRole('button', { name: '助手与语音设置' }).click()
  await expect(page.getByRole('dialog', { name: '墨灵 · 助手设置' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('companion-settings-mobile.png') })
  const dialog = await page.getByRole('dialog').boundingBox()
  expect(dialog!.width).toBeLessThan(390)
  expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(844)
  await page.getByRole('checkbox', { name: '显示原创助手形象' }).uncheck()
  await page.getByRole('button', { name: '关闭助手设置' }).click()
  await expect(page.locator('.companion-portrait')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toHaveValue('这个想法要保留')
  await page.reload()
  await expect(page.locator('.companion-portrait')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '语音输入' })).toBeEnabled()
})

test('microphone permission denial remains actionable and never sends a model request', async ({ page }) => {
  await setup(page, false)
  await page.getByRole('button', { name: '助手与语音设置' }).click()
  await page.getByLabel('语音识别方式').selectOption('service')
  await page.getByLabel('识别服务地址（含版本路径）').fill('https://speech-test.invalid/v1')
  await page.getByLabel('识别模型', { exact: true }).fill('asr-fixture')
  await page.getByRole('button', { name: '关闭助手设置' }).click()
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
  })
  let requests = 0
  await page.route('https://speech-test.invalid/**', () => { requests++ })
  await page.getByRole('button', { name: '语音输入' }).click()
  await expect(page.getByRole('alert')).toContainText('权限未开放')
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toBeEnabled()
  expect(requests).toBe(0)
})

test('real MediaRecorder encodes isolated Web Audio input, reaches configured ASR and releases tracks', async ({ page }) => {
  await setup(page, false)
  await page.getByRole('button', { name: '助手与语音设置' }).click()
  await page.getByLabel('语音识别方式').selectOption('service')
  await page.getByLabel('识别服务地址（含版本路径）').fill('https://speech-test.invalid/v1')
  await page.getByLabel('识别模型', { exact: true }).fill('asr-fixture')
  await page.getByRole('button', { name: '关闭助手设置' }).click()
  await page.evaluate(() => {
    // Real browser audio and encoder, with no dependency on an OS microphone.
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext()
      const destination = audio.createMediaStreamDestination()
      const oscillator = audio.createOscillator()
      oscillator.connect(destination)
      oscillator.start()
      await audio.resume()
      const stream = destination.stream
      ;(window as any).__recordedStream = stream
      ;(window as any).__audioFixture = audio
      return stream
    }
    const Recorder = window.MediaRecorder
    window.MediaRecorder = class extends Recorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options)
        this.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) (window as any).__encodedChunk = true
        })
      }
    }
  })
  let calls = 0
  await page.route('https://speech-test.invalid/v1/audio/transcriptions', async (route) => {
    calls++
    expect(route.request().headers()['content-type']).toContain('multipart/form-data')
    expect(route.request().postDataBuffer()!.length).toBeGreaterThan(100)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: '录音测试只进入输入框。' }) })
  })
  await page.getByRole('button', { name: '语音输入' }).click()
  await expect(page.getByText('正在听，结束后可编辑文字')).toBeVisible()
  await page.waitForFunction(() => (window as any).__encodedChunk === true)
  await page.getByRole('button', { name: '结束说话并识别' }).click()
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toHaveValue('录音测试只进入输入框。')
  expect(calls).toBe(1)
  expect(await page.evaluate(() => (window as any).__recordedStream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
  await page.evaluate(() => (window as any).__audioFixture.close())
})

test('configured speech plays a real audio response and stop releases playback resources', async ({ page }) => {
  await setup(page, false)
  await page.getByRole('button', { name: '助手与语音设置' }).click()
  await page.getByLabel('朗读方式').selectOption('service')
  await page.getByLabel('合成服务地址（含版本路径）').fill('https://speech-test.invalid/v1')
  await page.getByLabel('合成模型', { exact: true }).fill('tts-fixture')
  await page.getByLabel('合成音色 ID').fill('test-voice')
  await page.getByRole('button', { name: '关闭助手设置' }).click()
  // Two seconds of local PCM silence: verifies decoding/playback, not voice quality.
  const wave = Buffer.alloc(44 + 16000 * 2 * 2)
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8)
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28); wave.writeUInt16LE(2, 32)
  wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40)
  let calls = 0
  await page.route('https://speech-test.invalid/v1/audio/speech', async (route) => {
    calls++
    expect(route.request().postDataJSON().voice).toBe('test-voice')
    await route.fulfill({ contentType: 'audio/wav', body: wave })
  })
  await page.evaluate(() => {
    const Original = window.Audio
    window.Audio = class extends Original {
      constructor(src?: string) { super(src); (window as any).__spokenAudio = this }
    }
  })
  await page.getByRole('button', { name: '朗读这条回复' }).first().click()
  await expect(page.locator('.companion-portrait-compact')).toHaveAttribute('data-pose', 'speaking')
  await page.getByRole('button', { name: '停止朗读', exact: true }).click()
  expect(calls).toBe(1)
  expect(await page.evaluate(() => (window as any).__spokenAudio.paused && !(window as any).__spokenAudio.getAttribute('src'))).toBe(true)
  await expect(page.locator('.companion-portrait-compact')).toHaveAttribute('data-pose', 'idle')
})

test('auto-read starts with new replies only and leaving Agent cancels an active microphone', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '助手与语音设置' }).click()
  await page.getByRole('checkbox', { name: '自动朗读新回复的开头（最多 400 字）' }).check()
  await page.getByRole('button', { name: '关闭助手设置' }).click()
  expect(await page.evaluate(() => (window as any).__voiceProbe.spoken)).toEqual([])
  await page.route('https://companion-test.invalid/v1/chat/completions', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: '先讨论动机，不写入作品。', tasks: [] }) } }],
    }),
  }))
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('先讨论人物动机')
  await page.getByRole('button', { name: '讨论与规划', exact: true }).click()
  await expect(page.locator('.companion-portrait-compact')).toHaveAttribute('data-pose', 'speaking')
  expect(await page.evaluate(() => (window as any).__voiceProbe.spoken.join(''))).toContain('先讨论动机')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__voiceProbe.spoken)).toEqual([])
  await page.getByRole('button', { name: '语音输入' }).click()
  await expect(page.locator('.companion-portrait-compact')).toHaveAttribute('data-pose', 'listening')
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: '分步骤模式' }).click()
  await expect(page.getByRole('complementary', { name: '主 Agent 创作副驾' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__voiceProbe.aborts)).toBeGreaterThan(0)
})
