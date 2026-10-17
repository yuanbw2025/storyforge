/** Local presentation only. No storage, provider, authorization or game writes. */
import type { TtrpgVoiceTimelineMarkV1 } from './open-audio-runtime'

export function ttrpgVoiceCaptionMarksV1(text: string, marks: readonly TtrpgVoiceTimelineMarkV1[] | null): readonly TtrpgVoiceTimelineMarkV1[] {
  if (!marks?.length || marks.length > 16000) return []
  let offset = 0, endMs = 0
  const boundary = (index: number) => !(index > 0 && index < text.length && /[\uD800-\uDBFF]/u.test(text[index - 1]) && /[\uDC00-\uDFFF]/u.test(text[index]))
  for (const mark of marks) {
    if (![mark.textOffset, mark.textLength, mark.startMs, mark.durationMs].every(Number.isSafeInteger)
      || mark.textOffset !== offset || mark.textLength <= 0 || mark.startMs < endMs || mark.durationMs <= 0
      || !boundary(mark.textOffset) || !boundary(mark.textOffset + mark.textLength)) return []
    offset += mark.textLength; endMs = mark.startMs + mark.durationMs
    if (offset > text.length || !Number.isSafeInteger(endMs)) return []
  }
  return offset === text.length ? marks : []
}

/** Actual media time only; gaps and ended playback do not invent a word mark. */
export function ttrpgVoiceCaptionIndexV1(marks: readonly TtrpgVoiceTimelineMarkV1[], seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return -1
  const ms = seconds * 1000
  let lower = 0, upper = marks.length - 1
  while (lower <= upper) {
    const middle = (lower + upper) >>> 1, mark = marks[middle]
    if (ms < mark.startMs) upper = middle - 1
    else if (ms >= mark.startMs + mark.durationMs) lower = middle + 1
    else return middle
  }
  return -1
}

export function ttrpgVoiceCaptionNavigationV1(marks: readonly TtrpgVoiceTimelineMarkV1[], seconds: number) {
  const active = ttrpgVoiceCaptionIndexV1(marks, seconds)
  if (!Number.isFinite(seconds) || seconds < 0) return { active: -1, previous: -1, next: marks.length ? 0 : -1 }
  let lower = 0, upper = marks.length
  while (lower < upper) { const middle = (lower + upper) >>> 1; if (marks[middle].startMs <= seconds * 1000) lower = middle + 1; else upper = middle }
  const next = lower < marks.length ? lower : -1
  return { active, previous: active >= 0 ? active - 1 : lower - 1, next }
}

/** Ephemeral bookmarks hold positions, never files or listening rights. */
export function rememberTtrpgAudioPositionV1(bookmarks: Map<string, number>, clipKey: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return
  bookmarks.delete(clipKey); bookmarks.set(clipKey, seconds)
  while (bookmarks.size > 8) bookmarks.delete(bookmarks.keys().next().value!)
}

/** Preserve an explicit native volume change instead of fighting its slider. */
export function startTtrpgAudioFadeInV1(element: HTMLAudioElement, fadeMs: number, onUserVolume?: () => void): () => void {
  if (!Number.isSafeInteger(fadeMs) || fadeMs <= 0 || fadeMs > 60000 || element.paused || element.ended) return () => undefined
  const target = element.volume, started = performance.now()
  let frame = 0, stopped = false, written = 0
  element.volume = 0
  const cancel = () => { stopped = true; cancelAnimationFrame(frame); element.removeEventListener('volumechange', changed) }
  const changed = () => { if (Math.abs(element.volume - written) > 0.00001) { cancel(); onUserVolume?.() } }
  const tick = (now: number) => {
    if (stopped) return
    if (Math.abs(element.volume - written) > 0.00001) { cancel(); onUserVolume?.(); return }
    if (element.paused || element.ended) { cancel(); element.volume = target; return }
    written = target * Math.min(1, Math.max(0, (now - started) / fadeMs)); element.volume = written
    if (now - started >= fadeMs) cancel(); else frame = requestAnimationFrame(tick)
  }
  element.addEventListener('volumechange', changed); frame = requestAnimationFrame(tick)
  return () => { const restore = !stopped && Math.abs(element.volume - written) <= 0.00001; cancel(); if (restore) element.volume = target }
}
