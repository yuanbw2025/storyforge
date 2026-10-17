/** Ephemeral native-node handoff only. Callers must supply the original service
 * evidence and current visit; this controller grants no file/read/write rights. */
import type { TtrpgAudioChannelV1 } from './open-audio-runtime'

export interface TtrpgLocalAudioHandleV1 {
  (): void
  clipKey: string
  element: HTMLAudioElement
  isPlaying: () => boolean
  take: () => { element: HTMLAudioElement; dispose: () => void } | null
  follow: (fadeMs: number, volume: number) => Promise<void>
  cancelFollow: () => void
}
export interface TtrpgLocalAudioTransitionV1 {
  channel: TtrpgAudioChannelV1; action: 'play' | 'stop'
  fromClipKey: string; toClipKey: string | null; fadeMs: number
}

/** Never restore volume over the listener on an outgoing node. Completion is
 * bounded by a timer as well as frames; backgrounding immediately ends a tail. */
export function startTtrpgAudioFadeOutV1(element: HTMLAudioElement, ms: number, done: () => void): () => void {
  let stopped = false, frame = 0, written = element.volume
  const started = performance.now(), initial = written
  const cancel = () => {
    stopped = true; clearTimeout(timer); cancelAnimationFrame(frame)
    element.removeEventListener('volumechange', changed)
    for (const event of ['pause', 'ended', 'error', 'emptied']) element.removeEventListener(event, finish)
    document.removeEventListener('visibilitychange', visibility)
  }
  const finish = () => { if (!stopped) { cancel(); done() } }
  const visibility = () => { if (document.hidden) finish() }
  const changed = () => { if (Math.abs(element.volume - written) > 0.00001) finish() }
  const tick = (now: number) => {
    if (stopped) return
    if (element.paused || element.ended || Math.abs(element.volume - written) > 0.00001) { finish(); return }
    // The first frame's timestamp can precede this callback's start clock.
    // Clamp both ends so fade-out never raises volume or exceeds the DOM range.
    const progress = Math.min(1, Math.max(0, (now - started) / ms))
    written = initial * (1 - progress); element.volume = written
    if (now - started >= ms) finish(); else frame = requestAnimationFrame(tick)
  }
  const timer = setTimeout(finish, Math.min(3000, Math.max(0, ms)))
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 3000 || element.paused || element.ended || document.hidden) { finish(); return cancel }
  element.addEventListener('volumechange', changed)
  for (const event of ['pause', 'ended', 'error', 'emptied']) element.addEventListener(event, finish)
  document.addEventListener('visibilitychange', visibility); frame = requestAnimationFrame(tick)
  return cancel
}

/** At most one outgoing node per channel. A new play is attempted once, only
 * for the exact current clip after an explicit local follow choice. */
export function createTtrpgAudioTransitionPlaybackV1() {
  type Held = NonNullable<ReturnType<TtrpgLocalAudioHandleV1['take']>>
  type Pending = { plan: TtrpgLocalAudioTransitionV1; old: Held; release: () => void; deadline: number; timer: ReturnType<typeof setTimeout>
    fade: () => void; detachOld: () => void; detachIncoming: () => void; incoming?: TtrpgLocalAudioHandleV1
    started: boolean; attempted: boolean; awaiting: boolean; released: boolean; volume: number; fallback: () => void }
  const channels = new Map<TtrpgAudioChannelV1, Pending>()
  const current = (row: Pending) => channels.get(row.plan.channel) === row
  function finish(row: Pending, cancelIncoming: boolean, fallback = false) {
    if (!current(row)) return
    channels.delete(row.plan.channel); clearTimeout(row.timer); row.fade(); row.detachOld(); row.detachIncoming()
    if (cancelIncoming) row.incoming?.cancelFollow()
    if (!row.released) { row.released = true; row.old.dispose(); row.release() }
    if (fallback) row.fallback()
  }
  function fade(row: Pending) {
    const ms = Math.min(row.plan.fadeMs, Math.floor(row.deadline - performance.now()))
    if (ms <= 0) { finish(row, !row.started, !row.started && row.plan.toClipKey !== null); return }
    row.fade = startTtrpgAudioFadeOutV1(row.old.element, ms, () => finish(row, false))
  }
  return {
    begin(plan: TtrpgLocalAudioTransitionV1, handle: TtrpgLocalAudioHandleV1, options: {
      follow: boolean; deadline: number; release: () => void; fallback: () => void
    }): boolean {
      const prior = channels.get(plan.channel); if (prior) finish(prior, !prior.started)
      const mayFollow = options.follow && (plan.channel === 'music' || plan.channel === 'ambience') && plan.toClipKey !== null
      if ((!mayFollow && plan.action !== 'stop') || plan.channel === 'voice' || !Number.isSafeInteger(plan.fadeMs)
        || plan.fromClipKey !== handle.clipKey || plan.fadeMs < 0 || plan.fadeMs > 3000 || plan.fadeMs === 0 && !mayFollow
        || !Number.isFinite(options.deadline) || options.deadline <= performance.now() || document.hidden) return false
      const old = handle.take(); if (!old) return false
      const row: Pending = { plan, old, release: options.release, deadline: Math.min(options.deadline, performance.now() + 3000),
        timer: 0 as unknown as ReturnType<typeof setTimeout>, fade: () => undefined, detachOld: () => undefined, detachIncoming: () => undefined,
        started: false, attempted: false, awaiting: mayFollow, released: false, volume: old.element.volume, fallback: options.fallback }
      channels.set(plan.channel, row)
      const stopped = () => finish(row, !row.started, mayFollow && !row.started)
      const hidden = () => { if (document.hidden) stopped() }
      for (const event of ['pause', 'ended', 'error', 'emptied']) old.element.addEventListener(event, stopped)
      document.addEventListener('visibilitychange', hidden)
      row.detachOld = () => {
        for (const event of ['pause', 'ended', 'error', 'emptied']) old.element.removeEventListener(event, stopped)
        document.removeEventListener('visibilitychange', hidden)
      }
      row.timer = setTimeout(() => finish(row, !row.started, mayFollow && !row.started), Math.max(0, row.deadline - performance.now()))
      if (plan.fadeMs === 0) {
        row.detachOld(); row.released = true; row.old.dispose(); row.release()
        document.addEventListener('visibilitychange', hidden)
        row.detachOld = () => document.removeEventListener('visibilitychange', hidden)
      } else if (!mayFollow) fade(row)
      return true
    },
    attach(clipKey: string, handle: TtrpgLocalAudioHandleV1) {
      if (handle.clipKey !== clipKey) return
      const row = [...channels.values()].find(value => value.awaiting && value.plan.toClipKey === clipKey && !value.attempted)
      if (!row) return
      row.attempted = true; row.incoming = handle
      const fail = () => finish(row, true, true)
      for (const event of ['pause', 'ended', 'error', 'emptied']) handle.element.addEventListener(event, fail)
      const hidden = () => { if (document.hidden) fail() }
      document.addEventListener('visibilitychange', hidden)
      row.detachIncoming = () => {
        for (const event of ['pause', 'ended', 'error', 'emptied']) handle.element.removeEventListener(event, fail)
        document.removeEventListener('visibilitychange', hidden)
      }
      const ms = Math.min(row.plan.fadeMs, Math.floor(row.deadline - performance.now()))
      if (row.deadline <= performance.now() || document.hidden) { fail(); return }
      void handle.follow(ms, row.volume).then(() => {
        if (!current(row)) return
        if (!handle.isPlaying()) { fail(); return }
        row.started = true; fade(row)
      }).catch(() => { if (current(row)) fail() })
    },
    yieldToListener(clipKey: string) {
      const row = [...channels.values()].find(value => value.plan.toClipKey === clipKey)
      if (row) finish(row, !row.incoming?.isPlaying())
    },
    retains(clipKey: string) { return [...channels.values()].some(row => !row.released && row.plan.fromClipKey === clipKey) },
    cancel() { for (const row of [...channels.values()]) finish(row, !row.started) },
  }
}
