/** P10 audience/replay foundation. These pure envelopes do not authorize a model,
 * verify media bytes/licenses, append runtime events, or start playback.
 * The future formal owner must verify the original Session Zero and event lineage
 * before projecting retained envelopes. A parsed envelope is not that proof. */
import { assertTtrpgOpenHumanHostV1, parseTtrpgOpenAuthorizationV1, type TtrpgOpenAuthorizationV1 } from './open-authorization'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import { applyTtrpgAudioCueAppliedEventV1, createTtrpgAudioStateV1, parseTtrpgAudioCueAppliedEventV1,
  TTRPG_AUDIO_AUDIENCES_V1, TTRPG_AUDIO_CHANNELS_V1,
  type TtrpgAudioAudienceV1, type TtrpgAudioChannelV1, type TtrpgAudioCueAppliedEventV1, type TtrpgAudioProjectionV1 } from './open-audio-runtime'
import * as p from './open-contract-parse'
import { parseTtrpgOpenGeneratedVoiceTimeline, type TtrpgOpenGeneratedVoiceTimeline } from './open-voice-timeline-contract'

type Recipient = { seatKey: string; viewerKey: string; actorKey: string | null; role: 'gm' | 'player'; controller: 'human' | 'hybrid' | 'ai' }
export interface TtrpgOpenAudioScopeV1 {
  schema: 'storyforge.ttrpg-open-audio-scope'; version: 1
  authorizationRef: TtrpgOpenSourceRefV1
  issuerSeatKey: string; issuerViewerKey: string
  audience: TtrpgAudioAudienceV1; privateActorKey: string | null
  recipients: Recipient[]
}
export interface TtrpgOpenScopedAudioEventV1 {
  schema: 'storyforge.ttrpg-open-scoped-audio'; version: 1
  sourceRef: TtrpgOpenSourceRefV1; scope: TtrpgOpenAudioScopeV1; event: TtrpgAudioCueAppliedEventV1
}
export interface TtrpgOpenScopedAudioEventV2 extends Omit<TtrpgOpenScopedAudioEventV1, 'version'> {
  version: 2; generatedTimeline: TtrpgOpenGeneratedVoiceTimeline
}
export type TtrpgOpenScopedAudioEvent = TtrpgOpenScopedAudioEventV1 | TtrpgOpenScopedAudioEventV2
const EVENT_FIELDS = ['type', 'eventSequence', 'commandId', 'worldTurn', 'slotKey', 'channel', 'action',
  'fade', 'audience', 'targetRef', 'assetKey', 'fallbackText', 'voiceTimeline'] as const

export function parseTtrpgOpenAudioScopeV1(value: unknown): TtrpgOpenAudioScopeV1 {
  const r = p.record(value, ['schema', 'version', 'authorizationRef', 'issuerSeatKey', 'issuerViewerKey',
    'audience', 'privateActorKey', 'recipients'], 'audio scope')
  const audience = p.oneOf(r.audience, TTRPG_AUDIO_AUDIENCES_V1, 'audio audience')
  const privateActorKey = p.nullable(r.privateActorKey, p.key, 'private audio actor')
  const issuerSeatKey = p.key(r.issuerSeatKey, 'audio issuer seat'), issuerViewerKey = p.key(r.issuerViewerKey, 'audio issuer viewer')
  const recipients = p.list(r.recipients, 'frozen audio recipients', value => {
    const row = p.record(value, ['seatKey', 'viewerKey', 'actorKey', 'role', 'controller'], 'audio recipient')
    const role = p.oneOf(row.role, ['gm', 'player'], 'audio recipient role'), actorKey = p.nullable(row.actorKey, p.key, 'audio recipient actor')
    if ((role === 'player') !== (actorKey !== null)) p.fail('音频接收席位与角色不一致')
    return { seatKey: p.key(row.seatKey, 'audio recipient seat'), viewerKey: p.key(row.viewerKey, 'audio recipient viewer'), role, actorKey,
      controller: p.oneOf(row.controller, ['human', 'hybrid', 'ai'], 'audio recipient controller') }
  }, 1001, 1)
  p.unique(recipients.map(row => row.seatKey), 'audio recipient seats')
  p.unique(recipients.map(row => row.viewerKey), 'audio recipient viewers')
  p.unique(recipients.filter(row => row.actorKey !== null).map(row => row.actorKey), 'audio recipient actors')
  const issuer = recipients.find(row => row.seatKey === issuerSeatKey && row.viewerKey === issuerViewerKey)
  if (!issuer || issuer.controller === 'ai' || (audience === 'private') !== (privateActorKey !== null)
    || recipients.filter(row => row.role === 'gm').length > 1
    || audience === 'gm-only' && recipients.some(row => row.role !== 'gm')
    || audience === 'private' && (issuer.role !== 'gm' || !recipients.some(row => row.actorKey === privateActorKey)
      || recipients.some(row => row.role === 'player' && row.actorKey !== privateActorKey))) p.fail('音频原接收者、主持或私密目标不闭合')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-audio-scope', 'audio scope schema'),
    version: p.literal(r.version, 1, 'audio scope version'), authorizationRef: parseTtrpgOpenSourceRefV1(r.authorizationRef),
    issuerSeatKey, issuerViewerKey, audience, privateActorKey, recipients }
}

/** Explicit human presentation authority; host fallback does not acquire GM secrets.
 * All player recipients, including AI seats, are frozen. Listening is human-only. */
export function createTtrpgOpenAudioScopeV1(input: {
  authorization: TtrpgOpenAuthorizationV1; viewerKey: string; audience: TtrpgAudioAudienceV1; privateActorKey: string | null
}): TtrpgOpenAudioScopeV1 {
  const authorization = parseTtrpgOpenAuthorizationV1(input.authorization)
  const issuer = assertTtrpgOpenHumanHostV1(authorization, p.key(input.viewerKey, 'audio issuer'))
  const audience = p.oneOf(input.audience, TTRPG_AUDIO_AUDIENCES_V1, 'audio audience')
  const privateActorKey = p.nullable(input.privateActorKey, p.key, 'audio private actor')
  if ((audience === 'private') !== (privateActorKey !== null)) p.fail('仅私密音频可指定单个实际角色')
  if (['gm-only', 'private'].includes(audience) && issuer.role !== 'gm') p.fail('私域音频必须由实际真人 GM 明确授权')
  const players = authorization.seats.filter(row => row.role === 'player' && authorization.selectedActorKeys.includes(row.actorKey!))
  if (audience === 'private' && !players.some(row => row.actorKey === privateActorKey)) p.fail('私密音频目标不是活动角色')
  const selected = authorization.seats.filter(row => row.role === 'gm'
    ? row.controller !== 'ai' && row.assignmentState === 'claimed'
    : audience !== 'gm-only' && (audience !== 'private' || row.actorKey === privateActorKey))
  if (selected.some(row => !row.consent.sessionLoggingAllowed)
    || audience === 'public' && selected.some(row => !row.consent.publicSharingAllowed)) p.fail('音频记录或公开分享缺少实际接收席位同意')
  return parseTtrpgOpenAudioScopeV1({ schema: 'storyforge.ttrpg-open-audio-scope', version: 1,
    authorizationRef: authorization.sourceRef, issuerSeatKey: issuer.seatKey, issuerViewerKey: issuer.viewerKey,
    audience, privateActorKey, recipients: selected.map(({ seatKey, viewerKey, actorKey, role, controller }) => ({ seatKey, viewerKey, actorKey, role, controller }))
      .sort((a, b) => a.seatKey < b.seatKey ? -1 : a.seatKey > b.seatKey ? 1 : 0) })
}

export function parseTtrpgOpenScopedAudioEventV1(value: unknown): TtrpgOpenScopedAudioEventV1 {
  const r = p.record(value, ['schema', 'version', 'sourceRef', 'scope', 'event'], 'scoped audio')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef), scope = parseTtrpgOpenAudioScopeV1(r.scope)
  const raw = p.record(r.event, EVENT_FIELDS, 'scoped audio event'), event = parseTtrpgAudioCueAppliedEventV1(raw)
  // The legacy parser intentionally tolerates old payloads; the new envelope is closed.
  p.nullable(raw.assetKey, p.key, 'scoped audio asset')
  if (raw.voiceTimeline !== null) p.object(raw.voiceTimeline, 'scoped voice timeline')
  if (sourceRef.sessionKey !== scope.authorizationRef.sessionKey || sourceRef.sequence <= scope.authorizationRef.sequence
    || sourceRef.sequence !== event.eventSequence || scope.audience !== event.audience
    || scope.audience === 'private' && scope.privateActorKey !== event.targetRef
    || event.channel !== 'voice' && raw.voiceTimeline !== null
    || event.action === 'stop' && (event.assetKey !== null || raw.voiceTimeline !== null)
    || event.channel === 'voice' && event.assetKey !== null && !event.voiceTimeline?.marks.length) p.fail('音频事件与原授权、来源或受众不一致')
  if (event.voiceTimeline) {
    const timeline = p.record(raw.voiceTimeline, ['granularity', 'marks', 'speakerVoiceId', 'styleKey', 'styleDegree'], 'scoped voice timeline')
    p.list(timeline.marks, 'scoped voice marks', mark => p.record(mark, ['textOffset', 'textLength', 'startMs', 'durationMs'], 'scoped voice mark'), 20000)
  }
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-scoped-audio', 'scoped audio schema'),
    version: p.literal(r.version, 1, 'scoped audio version'), sourceRef, scope, event }
}

/** Generated speech has a sample clock, never invented char/word marks. The
 * explicit outer version leaves the legacy event and parser bytes intact. */
export function parseTtrpgOpenScopedAudioEventV2(value: unknown): TtrpgOpenScopedAudioEventV2 {
  const r = p.record(value, ['schema','version','sourceRef','scope','event','generatedTimeline'], 'generated scoped audio')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef), scope = parseTtrpgOpenAudioScopeV1(r.scope)
  const raw = p.record(r.event, EVENT_FIELDS, 'generated audio event'), event = parseTtrpgAudioCueAppliedEventV1(raw)
  const generatedTimeline = parseTtrpgOpenGeneratedVoiceTimeline(r.generatedTimeline)
  if (event.channel !== 'voice' || event.action !== 'play' || raw.voiceTimeline !== null || event.assetKey === null
    || sourceRef.sessionKey !== scope.authorizationRef.sessionKey || sourceRef.sequence <= scope.authorizationRef.sequence
    || sourceRef.sequence !== event.eventSequence || scope.audience !== event.audience || scope.audience === 'public'
    || (scope.audience === 'private' ? scope.privateActorKey !== event.targetRef : event.targetRef !== 'audio.bus')
    || generatedTimeline.sourceTextLengthUtf16 !== event.fallbackText.length) p.fail('生成音频事件与真实来源、样本时间轴或受众不一致')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-scoped-audio', 'generated audio schema'),
    version: p.literal(r.version, 2, 'generated audio version'), sourceRef, scope, event, generatedTimeline }
}
export function parseTtrpgOpenScopedAudioEvent(value: unknown): TtrpgOpenScopedAudioEvent {
  return value !== null && typeof value === 'object' && 'version' in value && value.version === 2
    ? parseTtrpgOpenScopedAudioEventV2(value) : parseTtrpgOpenScopedAudioEventV1(value)
}

/** Re-derive at commit using the actual historical authorization, not caller-stated recipients. */
export function assertTtrpgOpenAudioScopeAuthorityV1(scope: TtrpgOpenAudioScopeV1, authorization: TtrpgOpenAuthorizationV1): void {
  const checked = parseTtrpgOpenAudioScopeV1(scope), expected = createTtrpgOpenAudioScopeV1({ authorization,
    viewerKey: checked.issuerViewerKey, audience: checked.audience, privateActorKey: checked.privateActorKey })
  if (JSON.stringify(checked) !== JSON.stringify(expected)) p.fail('音频范围不是原实际开团授权的准确接收者')
}

/** Filter before replay. Per-audience layers keep a private cue/stop from erasing
 * another listener's public track. Stopping the private overlay reveals the
 * still-playing common track; stopping an old slot cannot stop its replacement.
 * Input order is verified lineage order; local sequence numbers may restart in
 * a child session. No hidden counts, sequence numbers, or rejected rows escape. */
export interface TtrpgOpenAudioTransitionV1 {
  controlRef: TtrpgOpenSourceRefV1; channel: TtrpgAudioChannelV1; action: 'play' | 'stop'; fade: number
  fromSlotKey: string | null; toSlotKey: string | null
}
type ProjectionInput = {
  events: readonly TtrpgOpenScopedAudioEvent[]; authorization: TtrpgOpenAuthorizationV1
  reader: { kind: 'human'; viewerKey: string } | { kind: 'public' }
}
export interface TtrpgOpenScopedAudioProjection extends Omit<TtrpgAudioProjectionV1, 'channels'> {
  channels: { [K in TtrpgAudioChannelV1]: (NonNullable<TtrpgAudioProjectionV1['channels'][K]> & {generatedTimeline?: TtrpgOpenGeneratedVoiceTimeline}) | null }
}
export function projectTtrpgOpenScopedAudioV1(input: ProjectionInput): TtrpgOpenScopedAudioProjection { return replayScopedAudio(input).projection }
/** Latest actually audible changes only. A pure projection is not a media or playback grant. */
export function projectTtrpgOpenAudioTransitionsV1(input: ProjectionInput): TtrpgOpenAudioTransitionV1[] { return replayScopedAudio(input).transitions }
function replayScopedAudio(input: ProjectionInput) {
  const authorization = parseTtrpgOpenAuthorizationV1(input.authorization), reader = input.reader
  if (!Array.isArray(input.events) || input.events.length > 100000) p.fail('音频回放事件必须是有界列表')
  const seat = reader.kind === 'human' ? authorization.seats.find(row => row.viewerKey === reader.viewerKey
    && row.controller !== 'ai' && row.assignmentState === 'claimed') : undefined
  if (reader.kind === 'human' && !seat) p.fail('音频读取需要当前实际真人席位')
  const layers = new Map<string, { state: ReturnType<typeof createTtrpgAudioStateV1>; order: Map<string, number>; generated: Map<TtrpgAudioChannelV1, TtrpgOpenGeneratedVoiceTimeline> }>()
  const transitions = new Map<TtrpgAudioChannelV1, TtrpgOpenAudioTransitionV1>()
  const selected = (channel: TtrpgAudioChannelV1) => {
    let cue: TtrpgOpenScopedAudioProjection['channels'][TtrpgAudioChannelV1] = null, order = -1
    for (const layer of layers.values()) if (layer.state.channels[channel] && (layer.order.get(channel) ?? -1) > order) {
      const original = layer.state.channels[channel]!, generatedTimeline = layer.generated.get(channel)
      cue = generatedTimeline ? {...original, generatedTimeline} : original; order = layer.order.get(channel) ?? -1
    }
    return cue
  }
  const seen = new Map<string, number>()
  for (const [index, raw] of input.events.entries()) {
    const row = parseTtrpgOpenScopedAudioEvent(raw), { scope, event, sourceRef } = row
    if (sourceRef.sequence <= (seen.get(sourceRef.sessionKey) ?? 0)) p.fail('音频原事件来源重复或顺序倒退')
    seen.set(sourceRef.sessionKey, sourceRef.sequence)
    const visible = scope.audience === 'public' || seat && scope.recipients.some(recipient => recipient.seatKey === seat.seatKey
      && recipient.viewerKey === seat.viewerKey && recipient.actorKey === seat.actorKey && recipient.role === seat.role && recipient.controller !== 'ai')
    if (reader.kind === 'public' ? scope.audience !== 'public' : !visible) continue
    const layerKey = scope.audience === 'private' ? `private:${scope.privateActorKey}` : scope.audience
    const layer = layers.get(layerKey) ?? { state: createTtrpgAudioStateV1(), order: new Map<string, number>(), generated: new Map<TtrpgAudioChannelV1, TtrpgOpenGeneratedVoiceTimeline>() }
    if (event.action === 'stop' && layer.state.channels[event.channel]?.slotKey !== event.slotKey) continue
    const beforeSlotKey = selected(event.channel)?.slotKey ?? null
    layer.state = applyTtrpgAudioCueAppliedEventV1(layer.state, { ...event, eventSequence: index + 1 })
    if (row.version === 2) layer.generated.set(event.channel, row.generatedTimeline)
    else layer.generated.delete(event.channel)
    layer.order.set(event.channel, index); layers.set(layerKey, layer)
    const after = selected(event.channel)
    if (beforeSlotKey !== (after?.slotKey ?? null)) transitions.set(event.channel, {
      controlRef: sourceRef, channel: event.channel, action: event.action, fade: event.fade,
      fromSlotKey: beforeSlotKey, toSlotKey: after?.slotKey ?? null,
    })
  }
  const channels: TtrpgOpenScopedAudioProjection['channels'] = createTtrpgAudioStateV1().channels
  for (const channel of TTRPG_AUDIO_CHANNELS_V1) channels[channel] = selected(channel)
  return { projection: { channels, visibleChannelCount: Object.values(channels).filter(Boolean).length },
    transitions: TTRPG_AUDIO_CHANNELS_V1.flatMap(channel => transitions.has(channel) ? [transitions.get(channel)!] : []) }
}
