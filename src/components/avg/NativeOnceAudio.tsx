import { useEffect, useRef, useState } from 'react'
import type { AvgOnceAudioReceiptV1 } from '../../lib/avg/once-audio-runtime'
import { useAvgGamePlayerStore } from '../../stores/avg-game-player'

/** A persisted request is not proof that the browser played or finished it.
 * Only this mounted controller's newly admitted generation may auto-play. */
export function NativeOnceAudio(props: { sessionId: number; cueKey: string; visit: number; channel: AvgOnceAudioReceiptV1['channel']
  receipt: AvgOnceAudioReceiptV1 | null; src: string; paused: boolean; volume: number; durationMs: number }) {
  const [attempt, setAttempt] = useState(0), [generation, setGeneration] = useState<number | null>(null), [error, setError] = useState('')
  const reported = useRef<number | null>(null)
  const audio = useRef<HTMLAudioElement>(null), starts = useRef(new Map<number, Promise<number>>())
  const budget = useRef({ generation: 0, remaining: Math.min(86_400_000, Math.max(10_000, props.durationMs + 10_000)) })
  const status = props.receipt?.status ?? null
  useEffect(() => {
    if (props.paused || attempt === 0 && status !== null) return
    let active = true, request = starts.current.get(attempt)
    if (!request) {
      request = useAvgGamePlayerStore.getState().onceAudioCommand({ type: 'start', retry: props.receipt !== null,
        expectedSessionId: props.sessionId, cueKey: props.cueKey, visit: props.visit })
      starts.current.set(attempt, request)
    }
    void request.then(value => { if (active) { setGeneration(value); setError('') } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [attempt, props.paused]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, props.volume)) }, [props.volume, props.src, generation])
  useEffect(() => {
    const element = audio.current
    if (!element || generation === null || props.receipt?.generation !== generation || status !== 'requested' || props.paused || reported.current === generation) return
    if (budget.current.generation !== generation) budget.current = { generation, remaining: Math.min(86_400_000, Math.max(10_000, props.durationMs + 10_000)) }
    let active = true, sent = false
    const started = performance.now()
    const report = (outcome: 'ended' | 'failed', reason: string) => {
      if (!active || sent) return
      sent = true; reported.current = generation; element.pause()
      void useAvgGamePlayerStore.getState().onceAudioCommand({ type: 'observe', expectedSessionId: props.sessionId,
        cueKey: props.cueKey, visit: props.visit, generation, outcome, reason,
        playedMs: Math.max(0, Math.round((Number.isFinite(element.currentTime) ? element.currentTime : 0) * 1000)) })
        .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    }
    const ended = () => report('ended', '')
    const failed = () => report('failed', `音频解码/加载失败:${element.error?.code ?? 'unknown'}`)
    element.addEventListener('ended', ended); element.addEventListener('error', failed)
    const timeout = window.setTimeout(() => report('failed', '音频播放等待超时'), budget.current.remaining)
    void element.play().catch(cause => { if (active) report('failed', `音频播放失败：${cause instanceof Error ? cause.message : String(cause)}`) })
    return () => {
      active = false; window.clearTimeout(timeout); element.removeEventListener('ended', ended); element.removeEventListener('error', failed); element.pause()
      budget.current.remaining = Math.max(0, budget.current.remaining - (performance.now() - started))
    }
  }, [generation, props.receipt?.generation, status, props.src, props.paused]) // eslint-disable-line react-hooks/exhaustive-deps
  const unknown = status === 'requested' && generation === null && starts.current.size === 0
  const recover = unknown || status === 'failed' || !!error
  const channelLabel = { bgm: '音乐', ambience: '环境音', sfx: '音效', voice: '配音' }[props.channel]
  return <div className="avg-once-audio-transport" data-cue={props.cueKey} data-status={status ?? 'loading'}>
    <audio ref={audio} src={props.src} preload="auto" data-channel={props.channel} data-generation={generation ?? ''} />
    {recover && <div className="avg-voice-recovery" role="status" aria-label={`${channelLabel}恢复`}><strong>{channelLabel}</strong><span>{error || (unknown ? '上次声音播放未确认结束。' : props.receipt?.reason)}</span>
      <button type="button" disabled={props.paused} onClick={() => { audio.current?.pause(); setGeneration(null); setError(''); setAttempt(n => n + 1) }}>重新播放声音片段</button>
    </div>}
  </div>
}
