import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceSession, type VoiceSnapshot } from '../../src/lib/longform-voice/session'
import { DEFAULT_COMPANION, type CompanionPreferences } from '../../src/lib/longform-voice/contract'

class FakeRecognition {
  static last: FakeRecognition
  onstart?: () => void
  onresult?: (event: unknown) => void
  onend?: () => void
  onerror?: (event: { error: string }) => void
  abort = vi.fn()
  constructor() { FakeRecognition.last = this }
  start() { this.onstart?.() }
  stop() { this.onend?.() }
}
class FakeRecorder {
  static last: FakeRecorder
  static isTypeSupported = () => true
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable?: (event: { data: Blob }) => void
  onstop?: () => void
  onerror?: () => void
  constructor() { FakeRecorder.last = this }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['isolated-audio'], { type: this.mimeType }) })
    this.onstop?.()
  }
}
class FakeUtterance {
  onstart?: () => void
  onend?: () => void
  onerror?: () => void
  constructor(public text: string) {}
}
const config = (): CompanionPreferences => structuredClone(DEFAULT_COMPANION)
const serviceConfig = () => {
  const value = config()
  value.inputMode = value.outputMode = 'service'
  value.input = { baseUrl: 'https://speech.example/v1', apiKey: 'isolated-key', model: 'asr', voice: '' }
  value.output = { ...value.input, model: 'tts', voice: 'voice-1' }
  return value
}
describe('长篇语音会话与资源回收', () => {
  let session: VoiceSession
  let state: VoiceSnapshot
  const transcript = vi.fn()
  const stopTrack = vi.fn()
  const getUserMedia = vi.fn()
  const fetcher = vi.fn()
  const synthesis = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    vi.stubGlobal('speechSynthesis', synthesis)
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] })
    state = { phase: 'idle', preview: '', error: '' }
    session = new VoiceSession((next) => { state = next }, transcript)
  })
  afterEach(() => { session.dispose(); vi.useRealTimers(); vi.unstubAllGlobals() })
  it('仅手动开始；识别完只回填文本，不调用创作模型', async () => {
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    await session.listen(config())
    expect(state.phase).toBe('listening')
    FakeRecognition.last.onresult?.({ results: [{ isFinal: true, 0: { transcript: '我们先讨论女主的动机' } }] })
    expect(transcript).not.toHaveBeenCalled()
    session.finish()
    expect(transcript).toHaveBeenCalledWith('我们先讨论女主的动机')
    expect(state.phase).toBe('idle')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('放弃之后忽略迟到的识别结果，不污染下一轮', async () => {
    await session.listen(config())
    const lateResult = FakeRecognition.last.onresult!
    const lateEnd = FakeRecognition.last.onend!
    session.cancel()
    lateResult({ results: [{ isFinal: true, 0: { transcript: '好的直接采纳' } }] })
    lateEnd()
    expect(transcript).not.toHaveBeenCalled()
    expect(state.phase).toBe('idle')
  })
  it('权限拒绝后可重新发起，不自动重试', async () => {
    await session.listen(config())
    FakeRecognition.last.onerror?.({ error: 'not-allowed' })
    expect(state.error).toContain('权限')
    expect(state.phase).toBe('idle')
    await session.listen(config())
    expect(state.error).toBe('')
    expect(state.phase).toBe('listening')
  })
  it('不支持浏览器识别时保留打字出口', async () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    await session.listen(config())
    expect(state.error).toContain('继续打字')
    expect(state.phase).toBe('idle')
  })
  it('离开作品后到达的麦克风授权立即释放，不开始录音', async () => {
    let resolve!: (value: unknown) => void
    getUserMedia.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const listening = session.listen(serviceConfig())
    expect(state.phase).toBe('requesting')
    session.dispose()
    resolve({ getTracks: () => [{ stop: stopTrack }] })
    await listening
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('使用指定麦克风；停止后只发送一次独立语音请求，401 不重试、不泄露密钥', async () => {
    fetcher.mockResolvedValue(new Response('', { status: 401 }))
    const value = serviceConfig()
    value.inputDeviceId = 'microphone-2'
    await session.listen(value)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, deviceId: { exact: 'microphone-2' } } })
    session.finish()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://speech.example/v1/audio/transcriptions')
    expect(options.body.get('model')).toBe('asr')
    expect(options.body.get('file').size).toBeGreaterThan(0)
    expect(options.credentials).toBe('omit')
    expect(options.redirect).toBe('error')
    expect(state.error).toContain('401')
    expect(state.error).not.toContain('isolated-key')
    expect(stopTrack).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('录音 60 秒自动收尾，转写成功后释放并回填', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ text: '写一段雨夜对话' }), { headers: { 'Content-Type': 'application/json' } }))
    await session.listen(serviceConfig())
    await vi.advanceTimersByTimeAsync(60_001)
    expect(transcript).toHaveBeenCalledWith('写一段雨夜对话')
    expect(stopTrack).toHaveBeenCalled()
    expect(state.phase).toBe('idle')
  })
  it('服务超时有明确状态，迟到响应不能回填或播放', async () => {
    let resolve!: (response: Response) => void
    fetcher.mockReturnValue(new Promise((done) => { resolve = done }))
    await session.listen(serviceConfig())
    session.finish()
    await vi.advanceTimersByTimeAsync(90_001)
    expect(state.error).toContain('90 秒')
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    resolve(new Response(JSON.stringify({ text: '迟到内容' })))
    await vi.advanceTimersByTimeAsync(1)
    expect(transcript).not.toHaveBeenCalled()
  })
  it('输入取消不上传录音', async () => {
    await session.listen(serviceConfig())
    session.cancel()
    expect(stopTrack).toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('无效或过大的转写响应不显示服务原文、不回填', async () => {
    fetcher.mockResolvedValueOnce(new Response('provider-secret-invalid-json'))
    await session.listen(serviceConfig())
    session.finish()
    await vi.advanceTimersByTimeAsync(1)
    expect(state.error).toContain('没有返回有效文字')
    expect(state.error).not.toContain('provider-secret')
    fetcher.mockResolvedValueOnce(new Response('oversize', { headers: { 'content-length': '900000' } }))
    await session.listen(serviceConfig())
    session.finish()
    await vi.advanceTimersByTimeAsync(1)
    expect(state.error).toContain('响应过大')
    expect(transcript).not.toHaveBeenCalled()
  })
  it('原生朗读分句，开始说话停止自己的播放', async () => {
    await session.speak('这是一段很长的故事。'.repeat(30), config())
    const first = synthesis.speak.mock.calls[0][0] as FakeUtterance
    first.onstart?.()
    expect(state.phase).toBe('speaking')
    first.onend?.()
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(synthesis.speak.mock.calls.every(([utterance]) => utterance.text.length <= 151)).toBe(true)
    await session.listen(config())
    expect(synthesis.cancel).toHaveBeenCalled()
    expect(state.phase).toBe('listening')
  })
  it('语音合成只发送可见文本和独立模型设置，失败不会执行 Agent', async () => {
    fetcher.mockResolvedValue(new Response('', { status: 429 }))
    await session.speak('**角色动机**是寻找真相。', serviceConfig())
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('https://speech.example/v1/audio/speech')
    expect(JSON.parse(options.body)).toEqual({ input: '角色动机是寻找真相。', model: 'tts', voice: 'voice-1', response_format: 'mp3' })
    expect(state.error).toContain('429')
    expect(transcript).not.toHaveBeenCalled()
  })
  it('服务音频播放与取消会释放对象 URL；输出设备失败不偷偷改用其他设备', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:isolated-voice')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const pause = vi.fn()
    const sink = vi.fn().mockResolvedValue(undefined)
    const play = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('Audio', class {
      pause = pause; setSinkId = sink; play = play
      removeAttribute() {}
      load() {}
    })
    fetcher.mockImplementation(() => Promise.resolve(new Response(new Blob(['audio'], { type: 'audio/mpeg' }))))
    const settings = serviceConfig()
    settings.outputDeviceId = 'headphones'
    await session.speak('只读内容', settings)
    expect(sink).toHaveBeenCalledWith('headphones')
    expect(state.phase).toBe('speaking')
    session.cancel()
    expect(pause).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:isolated-voice')
    play.mockClear()
    sink.mockRejectedValueOnce(new DOMException('missing', 'NotFoundError'))
    await session.speak('另一次只读内容', settings)
    expect(state.error).toContain('设备')
    expect(play).not.toHaveBeenCalled()
    createUrl.mockRestore()
    revoke.mockRestore()
  })
  it('停止之后返回的合成结果不能开始播放', async () => {
    let resolve!: (response: Response) => void
    fetcher.mockReturnValue(new Promise((done) => { resolve = done }))
    const createUrl = vi.spyOn(URL, 'createObjectURL')
    const speaking = session.speak('迟到音频', serviceConfig())
    session.cancel()
    resolve(new Response(new Blob(['audio'], { type: 'audio/mpeg' })))
    await speaking
    expect(createUrl).not.toHaveBeenCalled()
    expect(state.phase).toBe('idle')
    createUrl.mockRestore()
  })
})
