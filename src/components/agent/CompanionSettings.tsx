import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useCompanionStore } from '../../stores/companion'
import { voiceError } from '../../lib/longform-voice/session'
import type { VoiceService } from '../../lib/longform-voice/contract'

export default function CompanionSettings({ onClose }: { onClose: () => void }) {
  const { preferences, update, storageError } = useCompanionStore()
  const dialog = useRef<HTMLDialogElement>(null)
  const portraitInput = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [checkingDevices, setCheckingDevices] = useState(false)
  useEffect(() => {
    alive.current = true
    dialog.current?.showModal()
    const sync = () => setVoices(window.speechSynthesis?.getVoices() ?? [])
    sync()
    window.speechSynthesis?.addEventListener('voiceschanged', sync)
    return () => { alive.current = false; window.speechSynthesis?.removeEventListener('voiceschanged', sync) }
  }, [])
  async function discoverDevices() {
    setCheckingDevices(true)
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境不支持设备访问，请检查 HTTPS 与浏览器权限。')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      const available = await navigator.mediaDevices.enumerateDevices()
      if (alive.current) setDevices(available)
    } catch (cause) { if (alive.current) setError(voiceError(cause)) }
    finally { if (alive.current) setCheckingDevices(false) }
  }
  async function chooseOutput() {
    try {
      const media = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> }
      if (!media?.selectAudioOutput) throw new Error('此浏览器不提供输出设备选择，请使用系统默认设备或系统声音设置。')
      const device = await media.selectAudioOutput()
      if (alive.current) {
        setDevices((value) => [...value.filter((item) => item.deviceId !== device.deviceId), device])
        update({ outputDeviceId: device.deviceId })
      }
    } catch (cause) { if (alive.current) setError(voiceError(cause)) }
  }
  async function choosePortrait(file: File | undefined) {
    if (!file) return
    setError('')
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('请选择小于 2 MB 的 PNG、JPG 或 WebP 立绘。')
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
      })
      const picture = new Image()
      picture.src = data
      await picture.decode()
      if (picture.width > 4096 || picture.height > 4096) throw new Error('图片边长不能超过 4096 像素。')
      if (alive.current) update({ portrait: data })
    } catch (cause) { if (alive.current) setError(voiceError(cause)) }
  }
  const serviceFields = (kind: 'input' | 'output') => {
    const config = preferences[kind]
    const label = kind === 'input' ? '识别' : '合成'
    const change = (key: keyof VoiceService, value: string) => update({ [kind]: { ...config, [key]: value } })
    return (
      <div className="companion-service-fields">
        <label>{label}服务地址（含版本路径）
          <input value={config.baseUrl} onChange={(e) => change('baseUrl', e.target.value)} placeholder="http://localhost:8000/v1" autoComplete="off" />
        </label>
        <label>{label}模型<input value={config.model} onChange={(e) => change('model', e.target.value)} placeholder="填写服务中已安装的模型 ID" /></label>
        {kind === 'output' && <label>合成音色 ID<input value={config.voice} onChange={(e) => change('voice', e.target.value)} placeholder="填写该模型支持的音色" /></label>}
        <label>{label}服务密钥（可选，仅当前标签页）
          <input type="password" value={config.apiKey} onChange={(e) => change('apiKey', e.target.value)} autoComplete="new-password" />
        </label>
      </div>
    )
  }
  return (
    <dialog ref={dialog} className="companion-settings" aria-labelledby="companion-settings-title" onCancel={(e) => { e.preventDefault(); onClose() }}>
      <header>
        <div><h2 id="companion-settings-title">墨灵 · 助手设置</h2><p>陪你构思，按你的决定落笔。</p></div>
        <button type="button" onClick={onClose} aria-label="关闭助手设置" autoFocus><X size={18} /></button>
      </header>
      <div className="companion-settings-body">
        <fieldset>
          <legend>陪伴方式</legend>
          <label className="companion-check"><input type="checkbox" checked={preferences.visible} onChange={(e) => update({ visible: e.target.checked })} />显示原创助手形象</label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => portraitInput.current?.click()}>更换立绘（PNG / JPG / WebP）</button>
            <input ref={portraitInput} className="sr-only" aria-label="选择助手立绘" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { void choosePortrait(e.target.files?.[0]); e.target.value = '' }} />
            {preferences.portrait && <button type="button" onClick={() => update({ portrait: '' })}>恢复墨灵原画</button>}
          </div>
          <p>立绘只保存在此浏览器。自定义图片保留轻微动作；内置原画有六种状态。</p>
        </fieldset>
        <fieldset>
          <legend>听你说</legend>
          <label>语音识别方式<select value={preferences.inputMode} onChange={(e) => update({ inputMode: e.target.value as 'browser' | 'service' })}>
            <option value="browser">浏览器语音识别</option><option value="service">配置语音模型服务</option>
          </select></label>
          {preferences.inputMode === 'browser' ? <p>使用系统默认麦克风。部分浏览器不支持识别；音频可能由浏览器厂商在线处理。</p> : <>
            {serviceFields('input')}
            <label>录音麦克风<select value={preferences.inputDeviceId} onChange={(e) => update({ inputDeviceId: e.target.value })}>
              <option value="">系统默认麦克风</option>
              {preferences.inputDeviceId && !devices.some((d) => d.deviceId === preferences.inputDeviceId) && <option value={preferences.inputDeviceId}>上次选择的麦克风（请刷新确认）</option>}
              {devices.filter((d) => d.kind === 'audioinput' && d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || '麦克风 ' + (i + 1)}</option>)}
            </select></label>
            <button type="button" disabled={checkingDevices} onClick={() => void discoverDevices()}>{checkingDevices ? '等待设备权限…' : '授权并刷新麦克风列表'}</button>
            <p>录音结束后发送到你配置的识别服务。最多 60 秒；音频不保存到作品。</p>
          </>}
          <p>识别文字先进入输入框，检查后发送。语音不会自动确认计划或采纳内容。</p>
        </fieldset>
        <fieldset>
          <legend>听她说</legend>
          <label>朗读方式<select value={preferences.outputMode} onChange={(e) => update({ outputMode: e.target.value as 'browser' | 'service' })}>
            <option value="browser">浏览器与系统音色</option><option value="service">配置语音合成服务</option>
          </select></label>
          {preferences.outputMode === 'browser' ? <>
            <label>浏览器音色<select value={preferences.browserVoice} onChange={(e) => update({ browserVoice: e.target.value })}>
              <option value="">系统中文默认音色</option>
              {preferences.browserVoice && !voices.some((v) => v.voiceURI === preferences.browserVoice) && <option value={preferences.browserVoice}>所选音色不可用，将使用系统默认</option>}
              {[...voices].sort((a, b) => Number(b.lang.startsWith('zh')) - Number(a.lang.startsWith('zh'))).map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}{v.localService ? ' · 本机' : ' · 在线'}</option>)}
            </select></label>
            <p>通过系统默认扬声器或耳机播放。音色由设备提供，可能不是女性或中文音色。</p>
          </> : <>
            {serviceFields('output')}
            <label>播放设备<select value={preferences.outputDeviceId} onChange={(e) => update({ outputDeviceId: e.target.value })}>
              <option value="">系统默认输出</option>
              {preferences.outputDeviceId && !devices.some((d) => d.deviceId === preferences.outputDeviceId) && <option value={preferences.outputDeviceId}>上次选择的输出设备</option>}
              {devices.filter((d) => d.kind === 'audiooutput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || '已授权输出设备'}</option>)}
            </select></label>
            <button type="button" onClick={() => void chooseOutput()}>选择并授权输出设备</button>
            <p>仅支持部分浏览器；不可用时选系统默认。朗读文本会发送到所配服务。</p>
          </>}
          <label className="companion-check"><input type="checkbox" checked={preferences.autoRead} onChange={(e) => update({ autoRead: e.target.checked })} />自动朗读新回复的开头（最多 400 字）</label>
          <p>默认安静陪伴。手动朗读每次最多 2000 字，随时可停止；开始说话会停止播放。</p>
        </fieldset>
        {(preferences.inputMode === 'service' || preferences.outputMode === 'service') && <p>
          支持 <a href="https://speaches.ai/" target="_blank" rel="noreferrer">Speaches 等兼容服务</a>的 audio/transcriptions 与 audio/speech 接口。需要服务允许当前网页跨域访问；模型与中文音色须在服务端就绪，不使用创作模型密钥。
        </p>}
        {(error || storageError) && <p role="alert" className="text-error">{error || storageError}</p>}
      </div>
      <footer><span>更改即时生效 · 仅此浏览器</span><button type="button" onClick={onClose}>完成</button></footer>
    </dialog>
  )
}
