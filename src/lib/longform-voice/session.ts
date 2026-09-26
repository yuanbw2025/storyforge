import {
  assertVoiceTransport, speechText, voiceEndpoint, VOICE_MAX_BYTES, VOICE_MAX_RECORDING_MS,
  type CompanionPreferences, type VoiceService,
} from './contract'

export type VoicePhase = 'idle' | 'requesting' | 'listening' | 'transcribing' | 'preparing' | 'speaking'
export interface VoiceSnapshot { phase: VoicePhase; preview: string; error: string }
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean
  onstart: (() => void) | null
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type RecognitionConstructor = new () => Recognition
export function browserRecognition(): RecognitionConstructor | undefined {
  const host = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return host.SpeechRecognition ?? host.webkitSpeechRecognition
}
export function voiceError(error: unknown): string {
  if (error instanceof TypeError) return '无法连接语音服务，请检查地址、网络与服务端跨域配置。也可以继续打字。'
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '麦克风或播放权限未开放。请检查浏览器权限，也可以继续打字。'
    if (error.name === 'NotFoundError') return '没有找到所选音频设备。请重新选择，或使用系统默认设备。'
    if (error.name === 'NotReadableError') return '麦克风正在被占用，或无法读取。请检查设备后重试。'
    if (error.name === 'OverconstrainedError') return '所选麦克风已不可用，请切换到系统默认设备。'
  }
  return error instanceof Error ? error.message : '语音操作未完成，请重试或继续打字。'
}

/** One cancellable turn. No DB, model context, Agent execution or adoption capability. */
export class VoiceSession {
  private generation = 0
  private recognition?: Recognition
  private recorder?: MediaRecorder
  private stream?: MediaStream
  private audio?: HTMLAudioElement
  private objectUrl?: string
  private utterance?: SpeechSynthesisUtterance
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private snapshot: VoiceSnapshot = { phase: 'idle', preview: '', error: '' }
  private disposed = false
  constructor(
    private readonly changed: (state: VoiceSnapshot) => void,
    private readonly transcript: (text: string) => void,
  ) {}

  private update(patch: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    if (!this.disposed) this.changed(this.snapshot)
  }
  private current(generation: number) { return !this.disposed && generation === this.generation }
  private deadline(ms: number, action: () => void) {
    clearTimeout(this.timer)
    this.timer = setTimeout(action, ms)
  }
  cancel() {
    this.generation++
    clearTimeout(this.timer)
    if (this.recognition) {
      this.recognition.onstart = this.recognition.onresult = this.recognition.onerror = this.recognition.onend = null
      this.recognition.abort()
      this.recognition = undefined
    }
    if (this.recorder) {
      this.recorder.ondataavailable = this.recorder.onstop = this.recorder.onerror = null
      if (this.recorder.state !== 'inactive') this.recorder.stop()
      this.recorder = undefined
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    this.controller?.abort()
    this.controller = undefined
    if (this.utterance) {
      this.utterance.onstart = this.utterance.onend = this.utterance.onerror = null
      window.speechSynthesis?.cancel()
      this.utterance = undefined
    }
    if (this.audio) {
      this.audio.onended = this.audio.onerror = null
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
      this.audio = undefined
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = undefined
    this.update({ phase: 'idle', preview: '', error: '' })
  }
  dispose() { this.disposed = true; this.cancel() }
  private fail(error: unknown, generation: number) {
    if (!this.current(generation)) return
    this.cancel()
    this.update({ error: voiceError(error) })
  }
  private accept(text: string, generation: number) {
    if (!this.current(generation)) return
    this.cancel()
    if (text.trim().length > 2000) this.update({ error: '识别文字超过单次输入的 2000 字限制，请分成短句录入。' })
    else if (text.trim()) this.transcript(text.trim())
    else this.update({ error: '没有识别到文字。可以再说一次，或直接打字。' })
  }

  async listen(config: CompanionPreferences): Promise<void> {
    this.cancel()
    const generation = this.generation
    assertVoiceTransport('longform.voice.input', 'src/lib/longform-voice/session.ts')
    this.update({ phase: 'requesting' })
    this.deadline(30_000, () => this.fail(new Error('等待麦克风权限超时；需要时请再次点击说话。'), generation))
    try {
      if (config.inputMode === 'browser') {
        const Constructor = browserRecognition()
        if (!Constructor) throw new Error('此浏览器不支持语音识别。可在助手设置中配置语音服务，或继续打字。')
        const recognition = new Constructor()
        this.recognition = recognition
        recognition.lang = 'zh-CN'
        recognition.continuous = false
        recognition.interimResults = true
        let finalText = ''
        recognition.onstart = () => {
          if (!this.current(generation)) return
          this.update({ phase: 'listening' })
          this.deadline(VOICE_MAX_RECORDING_MS, () => this.finish())
        }
        recognition.onresult = (event) => {
          if (!this.current(generation)) return
          const results = Array.from(event.results)
          finalText = results.filter((result) => result.isFinal).map((result) => result[0].transcript).join('')
          this.update({ preview: results.map((result) => result[0].transcript).join('') })
        }
        recognition.onerror = ({ error }) => this.fail(new Error(
          error === 'not-allowed' || error === 'service-not-allowed'
            ? '语音识别权限未开放，请检查浏览器权限。'
            : error === 'no-speech' ? '没有听到语音，请靠近麦克风再试。'
              : error === 'network' ? '浏览器识别服务连接失败。可切换模型服务或继续打字。'
                : '浏览器语音识别中断，请重试或继续打字。',
        ), generation)
        recognition.onend = () => this.accept(finalText, generation)
        recognition.start()
        return
      }
      voiceEndpoint(config.input, 'transcriptions')
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('此环境不支持录音，请使用 HTTPS 页面或支持录音的浏览器。')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true,
          ...(config.inputDeviceId ? { deviceId: { exact: config.inputDeviceId } } : {}) },
      })
      if (!this.current(generation)) { stream.getTracks().forEach((track) => track.stop()); return }
      this.stream = stream
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((mime) => MediaRecorder.isTypeSupported(mime))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      this.recorder = recorder
      const chunks: Blob[] = []
      let size = 0
      recorder.ondataavailable = ({ data }) => {
        if (!this.current(generation)) return
        size += data.size
        if (size > VOICE_MAX_BYTES) { this.fail(new Error('录音超过 8 MB，请缩短后再试。'), generation); return }
        if (data.size) chunks.push(data)
      }
      recorder.onerror = () => this.fail(new Error('录音中断，请检查麦克风后重试。'), generation)
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (!this.current(generation)) return
        void this.transcribe(new Blob(chunks, { type: recorder.mimeType }), config.input, generation)
      }
      recorder.start(1000)
      this.update({ phase: 'listening' })
      this.deadline(VOICE_MAX_RECORDING_MS, () => this.finish())
    } catch (error) { this.fail(error, generation) }
  }

  finish() {
    if (this.snapshot.phase !== 'listening') return
    this.update({ phase: 'transcribing' })
    const generation = this.generation
    this.deadline(15_000, () => this.fail(new Error('语音识别未及时结束，已停止；请重试。'), generation))
    this.recognition?.stop()
    if (this.recorder?.state === 'recording') this.recorder.stop()
  }
  private async request(config: VoiceService, operation: 'transcriptions' | 'speech', body: BodyInit, generation: number): Promise<Response> {
    const controller = new AbortController()
    this.controller = controller
    this.deadline(90_000, () => this.fail(new Error('语音服务等待超过 90 秒，已停止；不会自动重发。'), generation))
    const response = await fetch(voiceEndpoint(config, operation), {
      method: 'POST', body, signal: controller.signal, credentials: 'omit', redirect: 'error',
      headers: {
        ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}),
        ...(operation === 'speech' ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (!response.ok) throw new Error(`语音服务返回 HTTP ${response.status}。${[401, 403].includes(response.status) ? '请检查独立语音密钥与权限。' : response.status === 429 ? '请检查服务额度或稍后重试。' : '请检查模型、地址和服务状态。'}不会自动重发。`)
    return response
  }
  private async transcribe(blob: Blob, config: VoiceService, generation: number) {
    try {
      if (!blob.size) throw new Error('没有录到音频，请检查输入设备。')
      this.update({ phase: 'transcribing' })
      const form = new FormData()
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      form.set('file', blob, 'recording.' + ext)
      form.set('model', config.model.trim())
      form.set('language', 'zh')
      form.set('response_format', 'json')
      const response = await this.request(config, 'transcriptions', form, generation)
      const encoded = await this.readResponse(response, 64 * 1024)
      let result: unknown
      try { result = JSON.parse(await encoded.text()) } catch { throw new Error('语音服务没有返回有效文字。请检查兼容接口配置。') }
      if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string') throw new Error('语音服务没有返回有效文字。请检查兼容接口配置。')
      this.accept(result.text, generation)
    } catch (error) { this.fail(error, generation) }
  }

  private async readResponse(response: Response, limit: number): Promise<Blob> {
    if (Number(response.headers.get('content-length')) > limit) throw new Error('语音服务响应过大，已停止。')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('语音服务没有返回内容。')
    const chunks: ArrayBuffer[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) { await reader.cancel(); throw new Error('语音服务响应过大，已停止。') }
        chunks.push(new Uint8Array(value).buffer)
      }
    } finally { reader.releaseLock() }
    return new Blob(chunks, { type: response.headers.get('content-type') || '' })
  }

  async speak(text: string, config: CompanionPreferences): Promise<void> {
    this.cancel()
    const generation = this.generation
    assertVoiceTransport('longform.voice.output', 'src/lib/longform-voice/session.ts')
    const input = speechText(text)
    if (!input) { this.update({ error: '这条消息没有可朗读的文字。' }); return }
    this.update({ phase: 'preparing' })
    try {
      if (config.outputMode === 'browser') {
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) throw new Error('此浏览器不支持朗读。可在助手设置中配置语音合成服务。')
        const chunks = input.match(/[^。！？\n]{1,150}[。！？\n]?/g) ?? [input]
        const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === config.browserVoice)
        const next = (index: number) => {
          if (!this.current(generation)) return
          if (index >= chunks.length) { this.cancel(); return }
          const utterance = new SpeechSynthesisUtterance(chunks[index])
          this.utterance = utterance
          utterance.lang = 'zh-CN'
          if (voice) utterance.voice = voice
          utterance.onstart = () => { if (this.current(generation)) this.update({ phase: 'speaking' }) }
          utterance.onend = () => next(index + 1)
          utterance.onerror = () => this.fail(new Error('朗读未完成，请点击朗读重试，或检查系统音色。'), generation)
          this.deadline(60_000, () => this.fail(new Error('浏览器朗读未及时响应，已停止。'), generation))
          window.speechSynthesis.speak(utterance)
        }
        next(0)
        return
      }
      const response = await this.request(config.output, 'speech', JSON.stringify({
        input, model: config.output.model.trim(), voice: config.output.voice.trim(), response_format: 'mp3',
      }), generation)
      const blob = await this.readResponse(response, VOICE_MAX_BYTES)
      if (!this.current(generation)) return
      if (!blob.size || blob.size > VOICE_MAX_BYTES || !/^(audio\/|application\/octet-stream)/i.test(blob.type)) throw new Error('语音服务返回了无效或过大的音频。')
      this.objectUrl = URL.createObjectURL(blob)
      const audio = new Audio(this.objectUrl)
      this.audio = audio
      if (config.outputDeviceId) {
        const sink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
        if (!sink.setSinkId) throw new Error('此浏览器不支持指定输出设备，请在助手设置中切换到系统默认。')
        await sink.setSinkId(config.outputDeviceId)
      }
      if (!this.current(generation)) return
      audio.onended = () => { if (this.current(generation)) this.cancel() }
      audio.onerror = () => this.fail(new Error('音频无法播放，请检查语音服务格式。'), generation)
      await audio.play()
      if (!this.current(generation)) return
      this.update({ phase: 'speaking' })
      this.deadline(10 * 60_000, () => this.cancel())
    } catch (error) { this.fail(error, generation) }
  }
}
