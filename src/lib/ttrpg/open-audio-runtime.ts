/**
 * P10 audio planning and replay primitives.
 *
 * This module deliberately has no transport, database, timer, resource
 * reservation, settlement, or reducer dependency. Audio is a presentation
 * side effect: callers may dispatch the returned requests after a turn has
 * been committed, and a failed request can only produce fallback text.
 */

export const TTRPG_AUDIO_CHANNELS_V1 = [
  'music',
  'ambience',
  'sfx',
  'voice',
] as const

export type TtrpgAudioChannelV1 = typeof TTRPG_AUDIO_CHANNELS_V1[number]

export const TTRPG_AUDIO_AUDIENCES_V1 = [
  'gm-only',
  'party',
  'private',
  'public',
] as const

export type TtrpgAudioAudienceV1 = typeof TTRPG_AUDIO_AUDIENCES_V1[number]

export const TTRPG_AUDIO_SLOT_KINDS_V1 = [
  'bgm',
  'ambience',
  'sfx',
  'voice',
] as const

export type TtrpgAudioSlotKindV1 = typeof TTRPG_AUDIO_SLOT_KINDS_V1[number]

export const TTRPG_AUDIO_CUE_ACTIONS_V1 = ['play', 'stop'] as const
export type TtrpgAudioCueActionV1 = typeof TTRPG_AUDIO_CUE_ACTIONS_V1[number]

export const TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1 = 2_000
export const TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1 = 3
export const TTRPG_AUDIO_MAX_VOICE_CHARACTERS_PER_WORLD_TURN_V1 =
  TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1 *
  TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

export interface TtrpgVoiceTimelineMarkV1 {
  textOffset: number
  textLength: number
  startMs: number
  durationMs: number
}

export interface TtrpgVoiceTimelineV1 {
  granularity: 'char' | 'word'
  marks: TtrpgVoiceTimelineMarkV1[]
  speakerVoiceId: string
  styleKey: string | null
  styleDegree: number | null
}

export interface TtrpgAudioViewerV1 {
  role: 'gm' | 'player' | 'spectator'
  actorKey: string | null
}

export interface TtrpgAudioCueV1 {
  cueKey: string
  slotKey: string
  kind: TtrpgAudioSlotKindV1
  channel: TtrpgAudioChannelV1
  audience: TtrpgAudioAudienceV1
  targetRef: string
  text: string
  fallbackText: string
  assetKey: string | null
  voiceTimeline: TtrpgVoiceTimelineV1 | null
  /**
   * `request` is the default because the caller has already decided that this
   * cue is worth dispatching. `ready` avoids a provider request, while
   * `missing` and `failed` immediately select the text fallback.
   */
  availability?: 'request' | 'ready' | 'missing' | 'failed'
}

export interface TtrpgAudioRuntimePolicyV1 {
  maximumVoiceCharacters?: number
  maximumVoiceRequestsPerTurn?: number
  /**
   * This may be lower than the hard 2,000-character ceiling, but can never
   * raise it.
   */
  maximumRequestCharacters?: number
}

export interface TtrpgAudioRequestV1 {
  requestKey: string
  worldTurn: number
  cueKey: string
  slotKey: string
  kind: TtrpgAudioSlotKindV1
  channel: TtrpgAudioChannelV1
  audience: TtrpgAudioAudienceV1
  targetRef: string
  text: string
  fallbackText: string
  assetKey: string | null
  partIndex: number
  partCount: number
  voiceTimeline: TtrpgVoiceTimelineV1 | null
}

export interface TtrpgAudioReadyV1 {
  cueKey: string
  slotKey: string
  channel: TtrpgAudioChannelV1
  audience: TtrpgAudioAudienceV1
  targetRef: string
  assetKey: string | null
  fallbackText: string
  voiceTimeline: TtrpgVoiceTimelineV1 | null
}

export type TtrpgAudioFallbackReasonV1 =
  | 'missing'
  | 'failed'
  | 'voice-timeline-missing'
  | 'voice-character-budget'
  | 'world-turn-request-budget'

export interface TtrpgAudioFallbackV1 {
  cueKey: string
  slotKey: string
  channel: TtrpgAudioChannelV1
  audience: TtrpgAudioAudienceV1
  targetRef: string
  fallbackText: string
  reason: TtrpgAudioFallbackReasonV1
}

export interface TtrpgAudioDispatchPlanV1 {
  worldTurn: number
  requests: TtrpgAudioRequestV1[]
  ready: TtrpgAudioReadyV1[]
  fallbacks: TtrpgAudioFallbackV1[]
  requestCount: number
  voiceCharacters: number
  /**
   * These are part of the P10 contract and make accidental coupling to
   * settlement visible to callers and tests.
   */
  blocking: false
  rollsBackResolution: false
  reservesResources: false
}

export interface TtrpgAudioRequestOutcomeV1 {
  request: TtrpgAudioRequestV1
  status: 'available' | 'missing' | 'failed'
  assetKey?: string | null
}

export interface TtrpgAudioPlaybackV1 {
  cueKey: string
  slotKey: string
  channel: TtrpgAudioChannelV1
  status: 'audio' | 'fallback'
  assetKey: string | null
  fallbackText: string
  displayText: string | null
  voiceTimeline: TtrpgVoiceTimelineV1 | null
}

export interface TtrpgAudioCueAppliedEventV1 {
  type: 'ttrpg.audio.cue.applied'
  eventSequence: number
  commandId: string
  worldTurn: number
  slotKey: string
  channel: TtrpgAudioChannelV1
  action: TtrpgAudioCueActionV1
  fade: number
  audience: TtrpgAudioAudienceV1
  targetRef: string
  assetKey: string | null
  fallbackText: string
  voiceTimeline: TtrpgVoiceTimelineV1 | null
}

export interface TtrpgActiveAudioCueV1 {
  slotKey: string
  channel: TtrpgAudioChannelV1
  audience: TtrpgAudioAudienceV1
  targetRef: string
  assetKey: string | null
  fallbackText: string
  fade: number
  voiceTimeline: TtrpgVoiceTimelineV1 | null
}

export interface TtrpgAudioStateV1 {
  channels: Record<TtrpgAudioChannelV1, TtrpgActiveAudioCueV1 | null>
  lastEventSequence: number
  lastWorldTurn: number
}

function fail(message: string): never {
  throw new Error(`[ttrpg-open-audio] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`${label}必须是对象`)
  }
  return value as Record<string, unknown>
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string') return fail(`${label}必须是字符串`)
  const result = value.trim()
  if (!result || !KEY.test(result)) return fail(`${label}不是稳定 key`)
  return result
}

function nonEmptyText(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== 'string') return fail(`${label}必须是字符串`)
  const result = value.normalize('NFC')
  if (!result.trim() || result.length > maximum) {
    return fail(`${label}为空或过长`)
  }
  return result
}

function nonNegativeInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    return fail(`${label}必须是非负整数`)
  }
  return Number(value)
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = nonNegativeInteger(value, label, maximum)
  if (result < 1) return fail(`${label}必须大于 0`)
  return result
}

function numberInRange(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return fail(`${label}超出范围`)
  }
  return value
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value === 'string' && values.includes(value as T)) return value as T
  return fail(`${label}不在闭集内`)
}

function channelForKind(kind: TtrpgAudioSlotKindV1): TtrpgAudioChannelV1 {
  return kind === 'bgm' ? 'music' : kind
}

function cloneTimeline(timeline: TtrpgVoiceTimelineV1 | null): TtrpgVoiceTimelineV1 | null {
  if (!timeline) return null
  return {
    ...timeline,
    marks: timeline.marks.map(mark => ({ ...mark })),
  }
}

function assertTimelineShape(
  value: unknown,
  label: string,
  textLength?: number,
): TtrpgVoiceTimelineV1 {
  const row = record(value, label)
  const granularity = oneOf(row.granularity, ['char', 'word'] as const, `${label}.granularity`)
  if (!Array.isArray(row.marks) || row.marks.length > 20_000) {
    return fail(`${label}.marks必须是有界数组`)
  }
  const speakerVoiceId = key(row.speakerVoiceId, `${label}.speakerVoiceId`)
  const styleKey = row.styleKey == null ? null : key(row.styleKey, `${label}.styleKey`)
  const styleDegree = row.styleDegree == null
    ? null
    : numberInRange(row.styleDegree, `${label}.styleDegree`, 0, 1)
  const marks = row.marks.map((raw, index) => {
    const mark = record(raw, `${label}.marks[${index}]`)
    return {
      textOffset: nonNegativeInteger(mark.textOffset, `${label}.marks[${index}].textOffset`),
      textLength: positiveInteger(mark.textLength, `${label}.marks[${index}].textLength`),
      startMs: nonNegativeInteger(mark.startMs, `${label}.marks[${index}].startMs`),
      durationMs: positiveInteger(mark.durationMs, `${label}.marks[${index}].durationMs`),
    }
  })
  let textEnd = 0
  let audioEnd = 0
  for (const mark of marks) {
    if (mark.textOffset !== textEnd) return fail(`${label}.marks必须连续覆盖全文`)
    if (mark.startMs < audioEnd) return fail(`${label}.marks音频时间重叠`)
    textEnd = mark.textOffset + mark.textLength
    audioEnd = mark.startMs + mark.durationMs
  }
  if (textLength !== undefined && (marks.length === 0 || textEnd !== textLength)) {
    return fail(`${label}.marks未覆盖全文`)
  }
  return { granularity, marks, speakerVoiceId, styleKey, styleDegree }
}

export function validateTtrpgVoiceTimelineV1(
  value: unknown,
  text: string,
): TtrpgVoiceTimelineV1 {
  const normalizedText = nonEmptyText(text, 'voiceTimeline.text')
  return assertTimelineShape(value, 'voiceTimeline', normalizedText.length)
}

function assertCue(cue: TtrpgAudioCueV1, index: number): TtrpgAudioCueV1 {
  const label = `audio.cues[${index}]`
  const cueKey = key(cue.cueKey, `${label}.cueKey`)
  const slotKey = key(cue.slotKey, `${label}.slotKey`)
  const kind = oneOf(cue.kind, TTRPG_AUDIO_SLOT_KINDS_V1, `${label}.kind`)
  const channel = oneOf(cue.channel, TTRPG_AUDIO_CHANNELS_V1, `${label}.channel`)
  if (channel !== channelForKind(kind)) return fail(`${label}.kind与channel不匹配`)
  const audience = oneOf(cue.audience, TTRPG_AUDIO_AUDIENCES_V1, `${label}.audience`)
  const targetRef = key(cue.targetRef, `${label}.targetRef`)
  const text = cue.text === '' ? '' : nonEmptyText(cue.text, `${label}.text`)
  const fallbackText = nonEmptyText(cue.fallbackText, `${label}.fallbackText`)
  const assetKey = cue.assetKey == null ? null : key(cue.assetKey, `${label}.assetKey`)
  const voiceTimeline = cue.voiceTimeline == null
    ? null
    : validateTtrpgVoiceTimelineV1(cue.voiceTimeline, text)
  const availability = cue.availability ?? 'request'
  oneOf(availability, ['request', 'ready', 'missing', 'failed'] as const, `${label}.availability`)
  if (audience === 'private' && !targetRef) return fail(`${label}.private缺少targetRef`)
  return {
    cueKey,
    slotKey,
    kind,
    channel,
    audience,
    targetRef,
    text,
    fallbackText,
    assetKey,
    voiceTimeline,
    availability,
  }
}

export function canViewTtrpgAudioAudienceV1(
  audience: TtrpgAudioAudienceV1,
  viewer: TtrpgAudioViewerV1,
  targetRef: string,
): boolean {
  oneOf(audience, TTRPG_AUDIO_AUDIENCES_V1, 'audio.audience')
  if (viewer.role === 'gm') return true
  if (audience === 'gm-only') return false
  if (audience === 'private') return viewer.actorKey === targetRef
  if (audience === 'party') return viewer.role === 'player'
  return true
}

function splitRanges(text: string, maximumCharacters: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + maximumCharacters)
    let end = hardEnd
    if (hardEnd < text.length) {
      const candidate = text.slice(start, hardEnd).search(/[。！？.!?\n](?!.*[。！？.!?\n])/u)
      if (candidate >= Math.floor(maximumCharacters / 2)) end = start + candidate + 1
    }
    ranges.push({ start, end })
    start = end
  }
  return ranges
}

function timelineForRange(
  timeline: TtrpgVoiceTimelineV1,
  range: { start: number; end: number },
): TtrpgVoiceTimelineV1 {
  const marks: TtrpgVoiceTimelineMarkV1[] = []
  for (const mark of timeline.marks) {
    const markStart = mark.textOffset
    const markEnd = mark.textOffset + mark.textLength
    const overlapStart = Math.max(markStart, range.start)
    const overlapEnd = Math.min(markEnd, range.end)
    if (overlapStart >= overlapEnd) continue
    const startRatio = (overlapStart - markStart) / mark.textLength
    const endRatio = (overlapEnd - markStart) / mark.textLength
    const startMs = mark.startMs + Math.round(mark.durationMs * startRatio)
    const endMs = mark.startMs + Math.round(mark.durationMs * endRatio)
    marks.push({
      textOffset: overlapStart - range.start,
      textLength: overlapEnd - overlapStart,
      startMs,
      durationMs: Math.max(1, endMs - startMs),
    })
  }
  return {
    ...timeline,
    marks,
  }
}

export function splitTtrpgVoiceTextV1(input: {
  text: string
  voiceTimeline: TtrpgVoiceTimelineV1
  maximumCharacters?: number
}): Array<{ text: string; voiceTimeline: TtrpgVoiceTimelineV1 }> {
  const text = nonEmptyText(input.text, 'voiceText')
  const timeline = validateTtrpgVoiceTimelineV1(input.voiceTimeline, text)
  const maximumCharacters = Math.min(
    input.maximumCharacters ?? TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1,
    TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1,
  )
  positiveInteger(maximumCharacters, 'maximumCharacters', TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1)
  return splitRanges(text, maximumCharacters).map(range => ({
    text: text.slice(range.start, range.end),
    voiceTimeline: timelineForRange(timeline, range),
  }))
}

function fallbackFor(
  cue: TtrpgAudioCueV1,
  reason: TtrpgAudioFallbackReasonV1,
): TtrpgAudioFallbackV1 {
  return {
    cueKey: cue.cueKey,
    slotKey: cue.slotKey,
    channel: cue.channel,
    audience: cue.audience,
    targetRef: cue.targetRef,
    fallbackText: cue.fallbackText,
    reason,
  }
}

function readyFor(cue: TtrpgAudioCueV1): TtrpgAudioReadyV1 {
  return {
    cueKey: cue.cueKey,
    slotKey: cue.slotKey,
    channel: cue.channel,
    audience: cue.audience,
    targetRef: cue.targetRef,
    assetKey: cue.assetKey,
    fallbackText: cue.fallbackText,
    voiceTimeline: cloneTimeline(cue.voiceTimeline),
  }
}

export function planTtrpgAudioRequestsV1(input: {
  worldTurn: number
  cues: readonly TtrpgAudioCueV1[]
  viewer?: TtrpgAudioViewerV1
  policy?: TtrpgAudioRuntimePolicyV1
}): TtrpgAudioDispatchPlanV1 {
  const worldTurn = nonNegativeInteger(input.worldTurn, 'worldTurn')
  if (!Array.isArray(input.cues)) return fail('audio.cues必须是数组')
  const policy = input.policy ?? {}
  const maximumVoiceCharacters = Math.min(
    policy.maximumVoiceCharacters ?? TTRPG_AUDIO_MAX_VOICE_CHARACTERS_PER_WORLD_TURN_V1,
    TTRPG_AUDIO_MAX_VOICE_CHARACTERS_PER_WORLD_TURN_V1,
  )
  const maximumRequests = Math.min(
    policy.maximumVoiceRequestsPerTurn ?? TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1,
    TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1,
  )
  const maximumRequestCharacters = Math.min(
    policy.maximumRequestCharacters ?? TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1,
    TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1,
  )
  nonNegativeInteger(maximumVoiceCharacters, 'policy.maximumVoiceCharacters')
  nonNegativeInteger(maximumRequests, 'policy.maximumVoiceRequestsPerTurn', TTRPG_AUDIO_MAX_REQUESTS_PER_WORLD_TURN_V1)
  positiveInteger(maximumRequestCharacters, 'policy.maximumRequestCharacters', TTRPG_AUDIO_MAX_REQUEST_CHARACTERS_V1)

  const requests: TtrpgAudioRequestV1[] = []
  const ready: TtrpgAudioReadyV1[] = []
  const fallbacks: TtrpgAudioFallbackV1[] = []
  let voiceCharacters = 0

  input.cues.forEach((rawCue, index) => {
    const cue = assertCue(rawCue, index)
    if (input.viewer && !canViewTtrpgAudioAudienceV1(cue.audience, input.viewer, cue.targetRef)) return
    if (cue.availability === 'ready') {
      ready.push(readyFor(cue))
      return
    }
    if (cue.availability === 'missing' || cue.availability === 'failed') {
      fallbacks.push(fallbackFor(cue, cue.availability))
      return
    }
    if (cue.channel === 'voice') {
      if (!cue.text || !cue.voiceTimeline) {
        fallbacks.push(fallbackFor(cue, 'voice-timeline-missing'))
        return
      }
      if (cue.text.length > maximumVoiceCharacters) {
        fallbacks.push(fallbackFor(cue, 'voice-character-budget'))
        return
      }
      const parts = splitTtrpgVoiceTextV1({
        text: cue.text,
        voiceTimeline: cue.voiceTimeline,
        maximumCharacters: maximumRequestCharacters,
      })
      if (requests.length + parts.length > maximumRequests) {
        fallbacks.push(fallbackFor(cue, 'world-turn-request-budget'))
        return
      }
      const partCount = parts.length
      parts.forEach((part, partIndex) => {
        requests.push({
          requestKey: `audio.${worldTurn}.${cue.cueKey}.${partIndex + 1}`,
          worldTurn,
          cueKey: cue.cueKey,
          slotKey: cue.slotKey,
          kind: cue.kind,
          channel: cue.channel,
          audience: cue.audience,
          targetRef: cue.targetRef,
          text: part.text,
          fallbackText: cue.fallbackText,
          assetKey: cue.assetKey,
          partIndex,
          partCount,
          voiceTimeline: part.voiceTimeline,
        })
      })
      voiceCharacters += cue.text.length
      return
    }
    if (requests.length >= maximumRequests) {
      fallbacks.push(fallbackFor(cue, 'world-turn-request-budget'))
      return
    }
    requests.push({
      requestKey: `audio.${worldTurn}.${cue.cueKey}.1`,
      worldTurn,
      cueKey: cue.cueKey,
      slotKey: cue.slotKey,
      kind: cue.kind,
      channel: cue.channel,
      audience: cue.audience,
      targetRef: cue.targetRef,
      text: cue.text.slice(0, maximumRequestCharacters),
      fallbackText: cue.fallbackText,
      assetKey: cue.assetKey,
      partIndex: 0,
      partCount: 1,
      voiceTimeline: null,
    })
  })

  return {
    worldTurn,
    requests,
    ready,
    fallbacks,
    requestCount: requests.length,
    voiceCharacters,
    blocking: false,
    rollsBackResolution: false,
    reservesResources: false,
  }
}

export function resolveTtrpgAudioRequestV1(
  input: TtrpgAudioRequestOutcomeV1,
): TtrpgAudioPlaybackV1 {
  const request = input.request
  const status = oneOf(input.status, ['available', 'missing', 'failed'] as const, 'audio.outcome.status')
  const assetKey = status === 'available' && input.assetKey != null
    ? key(input.assetKey, 'audio.outcome.assetKey')
    : null
  if (!assetKey) {
    return {
      cueKey: request.cueKey,
      slotKey: request.slotKey,
      channel: request.channel,
      status: 'fallback',
      assetKey: null,
      fallbackText: request.fallbackText,
      displayText: request.fallbackText,
      voiceTimeline: null,
    }
  }
  return {
    cueKey: request.cueKey,
    slotKey: request.slotKey,
    channel: request.channel,
    status: 'audio',
    assetKey,
    fallbackText: request.fallbackText,
    displayText: null,
    voiceTimeline: cloneTimeline(request.voiceTimeline),
  }
}

export const resolveTtrpgAudioFallbackV1 = resolveTtrpgAudioRequestV1

function emptyChannels(): Record<TtrpgAudioChannelV1, TtrpgActiveAudioCueV1 | null> {
  return {
    music: null,
    ambience: null,
    sfx: null,
    voice: null,
  }
}

export function createTtrpgAudioStateV1(): TtrpgAudioStateV1 {
  return {
    channels: emptyChannels(),
    lastEventSequence: 0,
    lastWorldTurn: 0,
  }
}

export function parseTtrpgAudioCueAppliedEventV1(event: unknown): TtrpgAudioCueAppliedEventV1 {
  const row = record(event, 'audio.event')
  if (row.type !== 'ttrpg.audio.cue.applied') return fail('audio.event.type无效')
  const eventSequence = positiveInteger(row.eventSequence, 'audio.event.eventSequence')
  const commandId = key(row.commandId, 'audio.event.commandId')
  const worldTurn = nonNegativeInteger(row.worldTurn, 'audio.event.worldTurn')
  const slotKey = key(row.slotKey, 'audio.event.slotKey')
  const channel = oneOf(row.channel, TTRPG_AUDIO_CHANNELS_V1, 'audio.event.channel')
  const action = oneOf(row.action, TTRPG_AUDIO_CUE_ACTIONS_V1, 'audio.event.action')
  const fade = nonNegativeInteger(row.fade, 'audio.event.fade', 60_000)
  const audience = oneOf(row.audience, TTRPG_AUDIO_AUDIENCES_V1, 'audio.event.audience')
  const targetRef = key(row.targetRef, 'audio.event.targetRef')
  const assetKey = row.assetKey == null ? null : key(row.assetKey, 'audio.event.assetKey')
  const fallbackText = nonEmptyText(row.fallbackText, 'audio.event.fallbackText')
  const voiceTimeline = row.voiceTimeline == null
    ? null
    : assertTimelineShape(row.voiceTimeline, 'audio.event.voiceTimeline')
  return {
    type: 'ttrpg.audio.cue.applied',
    eventSequence,
    commandId,
    worldTurn,
    slotKey,
    channel,
    action,
    fade,
    audience,
    targetRef,
    assetKey,
    fallbackText,
    voiceTimeline: channel === 'voice' ? cloneTimeline(voiceTimeline) : null,
  }
}

export function applyTtrpgAudioCueAppliedEventV1(
  state: TtrpgAudioStateV1,
  event: TtrpgAudioCueAppliedEventV1,
): TtrpgAudioStateV1 {
  const checked = parseTtrpgAudioCueAppliedEventV1(event)
  if (checked.eventSequence <= state.lastEventSequence) {
    return fail('audio.event.eventSequence必须递增')
  }
  const channels = { ...state.channels }
  if (checked.action === 'stop') {
    channels[checked.channel] = null
  } else {
    channels[checked.channel] = {
      slotKey: checked.slotKey,
      channel: checked.channel,
      audience: checked.audience,
      targetRef: checked.targetRef,
      assetKey: checked.assetKey,
      fallbackText: checked.fallbackText,
      fade: checked.fade,
      voiceTimeline: cloneTimeline(checked.voiceTimeline),
    }
  }
  return {
    channels,
    lastEventSequence: checked.eventSequence,
    lastWorldTurn: Math.max(state.lastWorldTurn, checked.worldTurn),
  }
}

export function replayTtrpgAudioEventsV1(
  initialState: TtrpgAudioStateV1,
  events: readonly TtrpgAudioCueAppliedEventV1[],
): TtrpgAudioStateV1 {
  return events.reduce(
    (state, event) => applyTtrpgAudioCueAppliedEventV1(state, event),
    {
      channels: { ...initialState.channels },
      lastEventSequence: initialState.lastEventSequence,
      lastWorldTurn: initialState.lastWorldTurn,
    },
  )
}

export const replayTtrpgAudioStateV1 = replayTtrpgAudioEventsV1

export interface TtrpgAudioProjectionV1 {
  channels: Record<TtrpgAudioChannelV1, TtrpgActiveAudioCueV1 | null>
  visibleChannelCount: number
}

export function projectTtrpgAudioForAudienceV1(
  state: TtrpgAudioStateV1,
  viewer: TtrpgAudioViewerV1,
): TtrpgAudioProjectionV1 {
  const channels = emptyChannels()
  for (const channel of TTRPG_AUDIO_CHANNELS_V1) {
    const cue = state.channels[channel]
    if (
      cue &&
      canViewTtrpgAudioAudienceV1(cue.audience, viewer, cue.targetRef)
    ) {
      channels[channel] = {
        ...cue,
        voiceTimeline: cloneTimeline(cue.voiceTimeline),
      }
    }
  }
  return {
    channels,
    visibleChannelCount: Object.values(channels).filter(Boolean).length,
  }
}

export const filterTtrpgAudioStateForAudienceV1 = projectTtrpgAudioForAudienceV1
