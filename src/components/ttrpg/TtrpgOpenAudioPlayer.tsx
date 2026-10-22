import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TtrpgOpenAudioDeskV1 } from '../../lib/ttrpg/open-audio-service'
import { startTtrpgAudioFadeInV1, ttrpgVoiceCaptionNavigationV1, ttrpgVoiceCaptionMarksV1 } from '../../lib/ttrpg/open-audio-playback'
import type { TtrpgLocalAudioHandleV1 } from '../../lib/ttrpg/open-audio-transition-playback'
import { ttrpgOpenVoiceReadingPositionV1 } from '../../lib/ttrpg/open-voice-timeline-contract'
import { applyTtrpgNarrationRateV1, useTtrpgNarrationRateV1 } from '../../lib/ttrpg/narration-listening-preferences'

export type TtrpgLocalAudioStopV1 = TtrpgLocalAudioHandleV1
type Track = TtrpgOpenAudioDeskV1['tracks'][number]
const labels = { music: '背景音乐', ambience: '环境声', sfx: '音效', voice: '配音' }

/** File playback and its exact caption, including text while muted/unavailable. */
export default function TtrpgOpenAudioPlayer(props: {
  track: Track; url?: string; failed: boolean; resumeSeconds: number
  register: (key: string, stop: TtrpgLocalAudioStopV1 | null) => void
  remember: (key: string, seconds: number) => void; onFailure: () => void; onVolumeTakeover?: () => void
}) {
  const { track, url, register, remember } = props, element = useRef<HTMLAudioElement | null>(null)
  const narrationRate = useTtrpgNarrationRateV1()
  useLayoutEffect(() => {
    if (element.current && track.channel === 'voice') applyTtrpgNarrationRateV1(element.current, narrationRate)
  }, [narrationRate, track.channel, url, props.failed])
  const [caption, setCaption] = useState({ active: -1, previous: -1, next: -1 }), [resumed, setResumed] = useState(false)
  const frame = useRef(0), stopFade = useRef<() => void>(() => undefined), latest = useRef(props)
  const nextFade = useRef<number | null>(null), followEpoch = useRef(0)
  const captionBox = useRef<HTMLParagraphElement | null>(null), captionMark = useRef<HTMLElement | null>(null)
  latest.current = props
  const marks = useMemo(() => ttrpgVoiceCaptionMarksV1(track.fallbackText, track.voiceMarks), [track.fallbackText, track.voiceMarks])
  const currentMarks = useRef(marks); currentMarks.current = marks
  const generated = track.generatedTimeline, currentGenerated = useRef(generated); currentGenerated.current = generated
  const sample = (node: HTMLAudioElement) => {
    const next = currentGenerated.current ? ttrpgOpenVoiceReadingPositionV1(currentGenerated.current.clock,node.currentTime)
      : ttrpgVoiceCaptionNavigationV1(currentMarks.current, node.currentTime)
    setCaption(old => old.active === next.active && old.previous === next.previous && old.next === next.next ? old : next)
  }
  const cancelFrame = useCallback(() => { cancelAnimationFrame(frame.current); frame.current = 0 }, [])
  useLayoutEffect(() => {
    const node = element.current
    if (!node || !url) return
    let transferred = false
    if (node.getAttribute('src') !== url) node.src = url
    const silence = () => {
      if (node.getAttribute('src')) remember(track.clipKey, node.ended ? 0 : node.currentTime)
      followEpoch.current++; nextFade.current = null
      node.pause(); cancelAnimationFrame(frame.current); frame.current = 0; stopFade.current()
      node.removeAttribute('src'); node.load()
    }
    const isPlaying = () => !node.paused && !node.ended && node.getAttribute('src') === url
    const cancelFollow = () => { followEpoch.current++; nextFade.current = null; node.pause(); stopFade.current(); cancelFrame() }
    const handle: TtrpgLocalAudioStopV1 = Object.assign(silence, {
      clipKey: track.clipKey, element: node, isPlaying, cancelFollow,
      take: () => {
        if (transferred || !isPlaying() || node.muted || node.volume <= 0) return null
        transferred = true
        const volume = node.volume; stopFade.current(); stopFade.current = () => undefined; node.volume = volume; cancelFrame()
        return { element: node, dispose: silence }
      },
      follow: async (fadeMs: number, volume: number) => {
        if (transferred || node.getAttribute('src') !== url || node.muted || !node.paused || node.volume !== 1) throw new Error('local audio follow is no longer available')
        const epoch = ++followEpoch.current
        nextFade.current = fadeMs; node.volume = volume
        try { await node.play() } catch (error) { nextFade.current = null; throw error }
        if (followEpoch.current !== epoch || !isPlaying()) throw new Error('local audio follow was cancelled')
      },
    })
    register(track.clipKey, handle)
    return () => { if (!transferred) silence(); register(track.clipKey, null) }
  }, [track.clipKey, url, props.failed, register, remember, cancelFrame])
  useLayoutEffect(() => {
    const box = captionBox.current, current = captionMark.current
    if (!url || props.failed || !box?.clientHeight || !current) return
    const area = box.getBoundingClientRect(), range = current.getBoundingClientRect()
    // Keep scrolling inside the caption; a whole-span mark makes no claim
    // about the location of an individual word inside that span.
    if (range.height > box.clientHeight) return
    if (range.top < area.top) box.scrollTop += range.top - area.top
    else if (range.bottom > area.bottom) box.scrollTop += range.bottom - area.bottom
  }, [caption.active, url, props.failed])
  const mark = !generated && url && !props.failed && caption.active >= 0 ? marks[caption.active] : undefined
  const readingMark = generated && url && !props.failed && caption.active >= 0 ? generated.clock.segments[caption.active] : undefined
  const text = track.channel === 'voice' || props.failed ? track.fallbackText : '音轨仅供辅助，可继续使用文字游玩。'
  const seek = (index: number) => {
    const node = element.current, segment = generated?.clock.segments[index], target = marks[index]
    const seconds = segment && generated ? segment.sampleOffset/generated.clock.sampleRate : target ? target.startMs/1000 : null
    if (!node || seconds===null || !Number.isFinite(node.duration)) return
    try { node.currentTime = Math.min(seconds, node.duration); sample(node) } catch { props.onFailure() }
  }
  return <>
    <p className="sf-open-audio-caption" ref={generated?undefined:captionBox} aria-label={track.channel === 'voice' ? '配音字幕' : undefined}>
      {mark ? <>{text.slice(0, mark.textOffset)}<mark ref={captionMark} data-testid="ttrpg-audio-caption-active">{text.slice(mark.textOffset, mark.textOffset + mark.textLength)}</mark>{text.slice(mark.textOffset + mark.textLength)}</> : text}
    </p>
    {generated&&<>
      <p aria-label="音轨朗读原文片段">{track.fallbackText.slice(generated.clock.originalPart.textOffset,generated.clock.originalPart.textOffset+generated.clock.originalPart.textLength)}</p>
      <p className="sf-open-audio-caption" ref={captionBox} aria-label="音轨实际读法">{readingMark?<>{generated.normalizedText.slice(0,readingMark.readingOffsetUtf16)}<mark ref={captionMark} data-testid="ttrpg-audio-reading-active">{generated.normalizedText.slice(readingMark.readingOffsetUtf16,readingMark.readingOffsetUtf16+readingMark.readingLengthUtf16)}</mark>{generated.normalizedText.slice(readingMark.readingOffsetUtf16+readingMark.readingLengthUtf16)}</>:generated.normalizedText}</p>
      <p>高亮按实际朗读片段定位，不代表逐字时间。</p>
    </>}
    {url && !props.failed && <audio controls preload="metadata" loop={track.channel === 'music' || track.channel === 'ambience'} src={url} ref={element}
      aria-label={`${labels[track.channel]}播放`} onError={event => { if (event.currentTarget === element.current) props.onFailure() }} onLoadedMetadata={event => {
        const node = event.currentTarget
        if (node !== element.current || !node.getAttribute('src')) return
        if (track.channel === 'voice' && track.durationMs !== null && (!Number.isFinite(node.duration) || node.duration <= 0 || Math.abs(node.duration * 1000 - track.durationMs) > 500)) {
          node.pause(); props.onFailure(); return
        }
        const previous = latest.current.resumeSeconds
        try {
          if (Number.isFinite(previous) && previous > 0 && previous < node.duration) { node.currentTime = previous; setResumed(true) }
          else setResumed(false)
        } catch { setResumed(false) }
        sample(node)
      }} onPlay={event => {
        const node = event.currentTarget
        if (node !== element.current || node.paused || node.ended || !node.getAttribute('src')) return
        setResumed(false)
        const fadeMs = nextFade.current ?? track.fade; nextFade.current = null
        stopFade.current(); stopFade.current = startTtrpgAudioFadeInV1(node, fadeMs, () => latest.current.onVolumeTakeover?.())
        if (track.channel !== 'voice') return
        cancelFrame()
        const tick = () => {
          if (element.current !== node || node.paused || node.ended || !node.getAttribute('src')) return
          sample(node); frame.current = requestAnimationFrame(tick)
        }
        sample(node); frame.current = requestAnimationFrame(tick)
      }} onVolumeChange={event => { if (event.currentTarget === element.current && event.currentTarget.muted) latest.current.onVolumeTakeover?.() }} onTimeUpdate={event => {
        if (event.currentTarget !== element.current) return
        remember(track.clipKey, event.currentTarget.ended ? 0 : event.currentTarget.currentTime)
        if (track.channel === 'voice') sample(event.currentTarget)
      }} onSeeked={event => { if (event.currentTarget === element.current && track.channel === 'voice') sample(event.currentTarget) }}
      onPause={event => {
        if (event.currentTarget !== element.current || !event.currentTarget.paused) return
        cancelFrame(); stopFade.current()
        if (event.currentTarget.getAttribute('src')) remember(track.clipKey, event.currentTarget.ended ? 0 : event.currentTarget.currentTime)
      }} onEnded={event => { if (event.currentTarget !== element.current || !event.currentTarget.ended) return; cancelFrame(); stopFade.current(); remember(track.clipKey, 0); sample(event.currentTarget) }} />}
    {url && !props.failed && resumed && <p>已定位到本次身份上次暂停的位置，按播放继续。</p>}
    {url && !props.failed && track.channel === 'voice' && (generated?generated.clock.segments.length:marks.length) > 1 && <div className="sf-open-audio-actions" aria-label="配音字幕定位">
      <button disabled={caption.previous < 0} onClick={() => seek(caption.previous)}>上一段字幕</button>
      <button disabled={caption.active < 0} onClick={() => seek(caption.active)}>回到本段开头</button>
      <button disabled={caption.next < 0} onClick={() => seek(caption.next)}>下一段字幕</button>
    </div>}
  </>
}
