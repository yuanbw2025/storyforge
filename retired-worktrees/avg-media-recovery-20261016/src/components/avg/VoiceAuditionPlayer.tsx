import { useCallback, useEffect, useRef, useState } from 'react'
import { inspectAvgVoiceBytesV1 } from '../../lib/avg/voice-decoder'
import { createAvgNativeAuditionCaptureV1, type AvgNativeAuditionEventV1, type AvgNativeAuditionObservationV1 } from '../../lib/avg/voice-audition'

interface Props {
  /** Local owner/Build/epoch/raw-version identity supplied by the service UI.
   * It is not exported into the portable author audio evidence. */
  sourceKey: string
  data: ArrayBuffer
  assetKey: string
  contentHash: string
  requestIdentityHash: string
  durationMs: number
  maximumDurationMs: number
  text: string
  disabled?: boolean
  onObservation: (observation: { audioHash: string; requestIdentityHash: string; audition: AvgNativeAuditionObservationV1 } | null) => void
}

/** Private native audition control, not an adoption or provider entry. Parent
 * services still prove Work, producer, raw response, rights and exact request.
 * Changing the clip/retake unmounts the old generation and revokes its URL.
 */
export default function VoiceAuditionPlayer(props: Props) {
  return <VerifiedAudition key={JSON.stringify([props.sourceKey, props.assetKey, props.contentHash, props.requestIdentityHash,
    props.durationMs, props.maximumDurationMs, props.text])} {...props} />
}

function VerifiedAudition({ data, assetKey, contentHash, requestIdentityHash, durationMs, maximumDurationMs, text, disabled = false, onObservation }: Props) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [generation, setGeneration] = useState(0)
  const [observation, setObservation] = useState<AvgNativeAuditionObservationV1 | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null), callback = useRef(onObservation)
  callback.current = onObservation
  const bindAudio = useCallback((element: HTMLAudioElement | null) => {
    if (audio.current && audio.current !== element) audio.current.pause()
    audio.current = element
  }, [])
  const haltAudio = useCallback(() => { audio.current?.pause() }, [])
  const active = useRef(true)
  const capture = useRef<ReturnType<typeof createAvgNativeAuditionCaptureV1> | null>(null)
  const unique = useRef(crypto.randomUUID())
  useEffect(() => {
    active.current = true
    let created = ''
    const controller = new AbortController()
    capture.current = null
    setUrl(''); setError(''); setGeneration(0); setObservation(null); callback.current(null)
    void inspectAvgVoiceBytesV1({ data, assetKey, contentHash, maximumDurationMs, signal: controller.signal }).then(result => {
      if (!active.current || controller.signal.aborted) return
      if (Math.abs(result.measurement.durationMs - durationMs) > 1) throw new Error('duration mismatch')
      created = URL.createObjectURL(new Blob([result.data], { type: 'audio/wav' })); setUrl(created)
    }).catch(() => { if (active.current && !controller.signal.aborted) setError('准确音频的字节或实际解码检查失败，不能审听选用。') })
    return () => {
      active.current = false; controller.abort(); haltAudio()
      if (created) URL.revokeObjectURL(created)
      callback.current(null)
    }
  }, [data, assetKey, contentHash, durationMs, maximumDurationMs, haltAudio])

  const observe = (event: AvgNativeAuditionEventV1, element: HTMLAudioElement) => {
    if (!active.current || element !== audio.current) return
    if (event === 'playing' && (disabled || !capture.current || capture.current.isTerminal())) {
      capture.current = null; element.pause(); setObservation(null); callback.current(null)
      if (!disabled) setError('上一轮审听已结束或中断，请从头开启新一轮。')
      return
    }
    if (!capture.current) return
    try {
      const current = capture.current.observe(event, { currentTimeMs: element.currentTime * 1000,
        durationMs: element.duration * 1000, muted: element.muted, volume: element.volume,
        playbackRate: element.playbackRate, seeking: element.seeking, ended: element.ended })
      setObservation(current)
      callback.current(current ? { audioHash: contentHash, requestIdentityHash, audition: current } : null)
    } catch {
      capture.current = null; element.pause(); setObservation(null); callback.current(null)
      setError('播放观察与准确音频不一致，请重新读取并核对音频。')
    }
  }
  useEffect(() => {
    const interrupt = () => {
      const element = audio.current
      if (element && !element.paused) { observe('interrupt', element); element.pause() }
    }
    const hide = () => { if (document.visibilityState === 'hidden') interrupt() }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', interrupt)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', interrupt) }
  }) // Observe the current generation; cleanup never targets a prior element.
  useEffect(() => {
    if (disabled && audio.current && !audio.current.paused) { observe('interrupt', audio.current); audio.current.pause() }
  })

  const fresh = () => {
    audio.current?.pause()
    capture.current = createAvgNativeAuditionCaptureV1({ generation: `audition.${unique.current}.${generation + 1}`, durationMs })
    setGeneration(generation + 1); setObservation(null); setError(''); callback.current(null)
  }
  return <section className="avg-voice-audition" aria-label="准确配音审听">
    <p className="whitespace-pre-wrap">{text}</p>
    <p>完整原速审听后，再分别核对原句、读音、演法、首尾和噪音。拖动、静音或变速后，请从头开启一轮审听。</p>
    {error && <p role="alert">{error}</p>}
    {!url && !error && <p role="status">正在核对准确音频字节…</p>}
    <button type="button" disabled={disabled || !url} className="lf-action" onClick={fresh}>从头开启新一轮审听</button>
    {url && generation > 0 && <audio key={generation} ref={bindAudio} src={url} controls={!disabled} preload="metadata" aria-label="当前准确配音"
      onPlaying={e => observe('playing', e.currentTarget)} onTimeUpdate={e => observe('timeupdate', e.currentTarget)}
      onPause={e => observe('pause', e.currentTarget)} onWaiting={e => observe('waiting', e.currentTarget)}
      onEnded={e => observe('ended', e.currentTarget)} onError={e => observe('error', e.currentTarget)}
      onSeeking={e => observe('seeking', e.currentTarget)} onSeeked={e => observe('seeked', e.currentTarget)}
      onVolumeChange={e => observe('volumechange', e.currentTarget)} onRateChange={e => observe('ratechange', e.currentTarget)} />}
    {observation && <p role="status">{observation.outcome === 'ended' ? '本轮完整原速播放结束；仍须作者逐项判断。'
      : observation.outcome === 'failed' ? '本轮播放失败，未通过审听。'
      : `本轮已观察 ${observation.playedMs}/${durationMs} 毫秒；尚未形成完整审听。`}</p>}
  </section>
}
