import { useEffect, useRef, useState } from 'react'
import type { AvgReadingPlanV1, AvgVoiceReceiptV1 } from '../../lib/avg/reading-contract'
import { useAvgGamePlayerStore } from '../../stores/avg-game-player'

/** One controller per session/visit/line. Its generation is issued by the
 * durable command; stale DOM callbacks can never settle a later attempt. */
export function NativeVoice(props: { sessionId:number; lineKey: string; visit: number; plan: AvgReadingPlanV1; current: AvgVoiceReceiptV1 | null
  src: string | undefined; missing: boolean; paused: boolean; muted: boolean; volume: number }) {
  const [retry, setRetry] = useState(0), [generation, setGeneration] = useState<string | null>(null), [error, setError] = useState('')
  const starts = useRef(new Map<number, Promise<string>>()), audio = useRef<HTMLAudioElement>(null)
  const budget = useRef({ generation: '', remaining: props.plan.maximumVoiceWaitMs })
  const c = props.current?.lineKey === props.lineKey && props.current.visit === props.visit ? props.current : null
  const status = c?.status ?? null
  useEffect(() => {
    if (props.paused || retry === 0 && status && status !== 'requested') return
    let active = true
    let request = starts.current.get(retry)
    if (!request) {
      request = useAvgGamePlayerStore.getState().voiceCommand({ type: 'start', lineKey: props.lineKey, visit: props.visit, expectedSessionId:props.sessionId })
      starts.current.set(retry, request)
    }
    void request.then(value => { if (active) { setGeneration(value); setError('') } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [retry, props.paused]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (audio.current) audio.current.volume = props.muted ? 0 : Math.max(0, Math.min(1, props.volume)) }, [props.volume, props.muted, generation])
  useEffect(() => {
    const element = audio.current
    if (!element || !generation || c?.generation !== generation || status !== 'requested' || props.paused) return
    if (budget.current.generation !== generation) budget.current = { generation, remaining: props.plan.maximumVoiceWaitMs }
    let active = true, sent = false
    const started = performance.now()
    const report = (outcome: 'ended' | 'failed' | 'interrupted', reason: string) => {
      if (!active || sent) return
      sent = true; element.pause()
      void useAvgGamePlayerStore.getState().voiceCommand({ type: 'observe', lineKey: props.lineKey, visit: props.visit, expectedSessionId:props.sessionId, generation, outcome, reason, playedMs: Math.max(0, Math.round((Number.isFinite(element.currentTime) ? element.currentTime : 0)*1000)) })
        .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    }
    const ended = () => report('ended', '')
    const failed = () => report('failed', `音频解码/加载失败:${element.error?.code ?? 'unknown'}`)
    element.addEventListener('ended', ended); element.addEventListener('error', failed)
    const timeout = window.setTimeout(() => report('failed', '音频播放等待超时'), Math.max(0, budget.current.remaining))
    if (props.muted && props.plan.manualVoice === 'interrupt') report('interrupted', '用户选择静音')
    else if (props.missing) report('failed', '该句音频资源不可用')
    else if (props.src) void element.play().catch(cause => { if (active) report('failed', cause instanceof DOMException && cause.name === 'NotAllowedError' ? '浏览器尚未允许播放声音，请点击重试' : cause instanceof DOMException && cause.name === 'NotSupportedError' ? '音频无法解码或格式不受支持' : `音频播放失败：${cause instanceof Error ? cause.message : String(cause)}`) })
    return () => {
      active = false; window.clearTimeout(timeout); element.removeEventListener('ended', ended); element.removeEventListener('error', failed); element.pause()
      budget.current.remaining = Math.max(0, budget.current.remaining - (performance.now() - started))
    }
  }, [generation, c?.generation, status, props.src, props.missing, props.paused, props.muted]) // eslint-disable-line react-hooks/exhaustive-deps
  const failed = status === 'failed' || !!error
  return <div className="avg-voice-transport" data-status={error ? 'failed' : status ?? 'loading'}>
    <audio ref={audio} src={props.src} preload="auto" data-channel="voice" data-generation={generation ?? ''} />
    {failed && <div className="avg-voice-recovery" role="status"><span>{error || c?.reason || '配音无法播放'}</span>
      <button type="button" onClick={() => { audio.current?.pause(); setError(''); setGeneration(null); setRetry(n => n+1) }}>重试配音</button>
      {props.plan.manualVoice === 'interrupt' && c?.generation && <button type="button" onClick={() => {
        void useAvgGamePlayerStore.getState().voiceCommand({ type: 'observe', expectedSessionId:props.sessionId, lineKey: props.lineKey, visit: props.visit, generation: c.generation, outcome: 'interrupted', reason: '用户确认静音继续', playedMs: c.playedMs ?? 0 }).catch(cause => setError(String(cause)))
      }}>静音继续</button>}
    </div>}
  </div>
}
