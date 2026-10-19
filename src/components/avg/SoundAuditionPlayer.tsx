import { useEffect, useRef, useState } from 'react'
import { sha256MediaData } from '../../lib/product-production/media-blob-store'
import { createAvgSoundAuditionCaptureV1, type AvgSoundAuditionObservationV1 } from '../../lib/avg/sound-audition'

export type SoundObservation = { audioHash: string; requestIdentityHash: string; audition: AvgSoundAuditionObservationV1 }
type Props = { sourceKey: string; data: ArrayBuffer; assetKey: string; contentHash: string; requestIdentityHash: string
  durationMs: number; channelCount: number; loop: boolean; disabled: boolean; onObservation: (value: SoundObservation | null) => void }
type Engine = { context: AudioContext; source: AudioBufferSourceNode | null; gain: GainNode | null
  capture: ReturnType<typeof createAvgSoundAuditionCaptureV1> | null; timer: ReturnType<typeof setInterval> | null; deadline: ReturnType<typeof setTimeout> | null }

/** Exactly one original native source per generation. Loops are scheduled in
 * the rendering graph, not by restarting an ended element. Device output time
 * and original source end are both required. No Blob/URL/store/model writes. */
export default function SoundAuditionPlayer(props: Props) {
  return <OriginalSoundAudition key={JSON.stringify([props.sourceKey, props.assetKey, props.contentHash, props.requestIdentityHash,
    props.durationMs, props.channelCount, props.loop])} {...props} />
}
function OriginalSoundAudition({ data, contentHash, requestIdentityHash, durationMs, channelCount, loop, disabled, onObservation }: Props) {
  const [playing, setPlaying] = useState(false), [error, setError] = useState('')
  const [observation, setObservation] = useState<AvgSoundAuditionObservationV1 | null>(null)
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1)
  const engine = useRef<Engine | null>(null), alive = useRef(true), callback = useRef(onObservation)
  callback.current = onObservation
  const release = (e: Engine) => {
    if (engine.current === e) engine.current = null
    if (e.timer) clearInterval(e.timer)
    if (e.deadline) clearTimeout(e.deadline)
    e.context.onstatechange = null
    if (e.source) { e.source.onended = null; try { e.source.stop(); e.source.disconnect() } catch { /* already stopped */ } }
    e.gain?.disconnect()
    void e.context.close().catch(() => { /* disconnected native graph owns no sound */ })
    if (alive.current) setPlaying(false)
  }
  const observe = (e: Engine, event: 'sample' | 'source-ended' | 'interrupt' | 'error') => {
    if (engine.current !== e || !e.capture || !e.source || !e.gain) return
    try {
      const r = e.capture.observe(event, { generation: e.capture.snapshot()?.generation ?? generationOf.current,
        outputTimeSeconds: e.context.getOutputTimestamp().contextTime ?? Number.NaN, renderTimeSeconds: e.context.currentTime,
        contextState: e.context.state, bufferDurationMs: e.source.buffer!.duration * 1000, loop: e.source.loop,
        playbackRate: e.source.playbackRate.value, detune: e.source.detune.value, volume: e.gain.gain.value,
        muted: e.gain.gain.value === 0 })
      if (alive.current) { setObservation(r); callback.current(r ? { audioHash: contentHash, requestIdentityHash, audition: r } : null) }
      if (e.capture.isTerminal()) release(e)
    } catch {
      release(e)
      if (alive.current) { setObservation(null); callback.current(null); setError('原音频或原生输出观察已变化，本轮不能作为审听依据。') }
    }
  }
  const generationOf = useRef('')
  const interrupt = () => {
    const e = engine.current
    if (!e) return
    if (e.capture) observe(e, 'interrupt')
    if (engine.current === e) release(e)
  }
  const currentInterrupt = useRef(interrupt)
  currentInterrupt.current = interrupt
  useEffect(() => {
    alive.current = true; callback.current(null)
    const stop = () => currentInterrupt.current()
    const hide = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', stop)
    return () => {
      alive.current = false; stop(); callback.current(null)
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', stop)
    }
  }, [])
  useEffect(() => { if (disabled) interrupt() })
  const start = async () => {
    interrupt(); setObservation(null); callback.current(null); setError('')
    let e: Engine | null = null
    try {
      const context = new AudioContext()
      e = { context, source: null, gain: null, capture: null, timer: null, deadline: null }
      engine.current = e; setPlaying(true)
      // Watchdog only interrupts; wall time can never grant heard coverage.
      e.deadline = setTimeout(() => { if (engine.current === e) { interrupt(); setError('原生播放未在期限内完成，请检查声音权限后从头重听。') } }, durationMs * (loop ? 2 : 1) + 15_000)
      await context.resume()
      if (!alive.current || engine.current !== e) return
      if (typeof context.getOutputTimestamp !== 'function' || context.state !== 'running') throw new Error('Native output clock unavailable')
      if (data.byteLength < 27 || data.byteLength > 8 * 1024 * 1024 || await sha256MediaData(data) !== contentHash) throw new Error('Original bytes changed')
      const buffer = await context.decodeAudioData(data.slice(0))
      if (!alive.current || engine.current !== e) return
      if (Math.abs(buffer.duration * 1000 - durationMs) > 1 || buffer.numberOfChannels !== channelCount) throw new Error('Original decode changed')
      const source = context.createBufferSource(), gain = context.createGain()
      source.buffer = buffer; source.loop = loop; source.loopStart = 0; source.loopEnd = buffer.duration
      source.playbackRate.value = 1; source.detune.value = 0; gain.gain.value = muted ? 0 : volume
      source.connect(gain); gain.connect(context.destination); e.source = source; e.gain = gain
      const startTimeSeconds = context.currentTime + .05
      generationOf.current = `audition.${crypto.randomUUID()}`
      e.capture = createAvgSoundAuditionCaptureV1({ generation: generationOf.current, durationMs,
        decodedDurationMs: buffer.duration * 1000, startTimeSeconds, loop })
      const owned = e
      context.onstatechange = () => { if (context.state !== 'running') observe(owned, 'interrupt') }
      source.onended = () => observe(owned, 'source-ended')
      source.start(startTimeSeconds, 0); source.stop(startTimeSeconds + buffer.duration * (loop ? 2 : 1))
      e.timer = setInterval(() => observe(owned, 'sample'), 50)
    } catch {
      if (e && engine.current === e) {
        release(e); setObservation(null); callback.current(null)
        if (alive.current) setError('准确声音无法在当前浏览器解码或启动原生输出，请检查声音权限后重新审听。')
      }
      if (!e && alive.current) setError('当前浏览器不支持所需的原生声音输出，请使用兼容浏览器。')
    }
  }
  return <section className="avg-sound-audition" aria-label="准确声音审听">
    <p>{loop ? '本轮连续原速播放两遍，观察循环接缝后自动结束。' : '本轮从头完整原速播放一次，结束后逐项记录观察。'}中断、切换页面或静音后须重新从头审听。</p>
    {error && <p role="alert">{error}</p>}
    <div className="avg-actions"><button className="lf-action" disabled={disabled || playing || muted || volume <= 0} onClick={() => void start()}>从头审听原声音</button>
      <button className="lf-action" disabled={!playing} onClick={interrupt}>中断本轮审听</button></div>
    <label><input type="checkbox" checked={muted} onChange={event => {
      const next = event.target.checked; setMuted(next)
      const e = engine.current; if (e?.gain) { e.gain.gain.value = next ? 0 : volume; observe(e, 'sample') }
    }}/>审听静音</label>
    <label>审听音量<input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => {
      const next = Number(event.target.value); setVolume(next)
      const e = engine.current; if (e?.gain) { e.gain.gain.value = muted ? 0 : next; observe(e, 'sample') }
    }}/></label>
    {playing && <p role="status">原生审听进行中；完整次数 {observation?.completedCycles ?? 0}，连续接缝 {observation?.continuousLoops ?? 0}。</p>}
    {playing && <progress aria-label="本轮原生播放进度" max={durationMs * (loop ? 2 : 1)} value={observation?.playedMs ?? 0}/>}
    {observation && !playing && <p role="status">{observation.outcome === 'ended'
      ? `原声音已完整原速播放 ${observation.completedCycles} 遍；仍须作者逐项判断。`
      : `本轮已中断或改变播放条件，保留 ${observation.playedMs} 毫秒观察；不能据此签发通过。`}</p>}
  </section>
}
