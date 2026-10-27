/** Product-owned E16 receipts. Presentation never settles a rule, pays a resource,
 * grants knowledge, dispatches a provider, or changes the frozen campaign. */
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1, assertTtrpgOpenSituationWindowEventV1 } from './open-coordination'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { createTtrpgOpenAudioScopeV1, parseTtrpgOpenAudioScopeV1, parseTtrpgOpenScopedAudioEventV1, type TtrpgOpenScopedAudioEventV1, type TtrpgOpenAudioScopeV1 } from './open-audio-scope'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import { TTRPG_AUDIO_CHANNELS_V1, TTRPG_AUDIO_AUDIENCES_V1, validateTtrpgVoiceTimelineV1,
  type TtrpgAudioChannelV1, type TtrpgAudioAudienceV1, type TtrpgVoiceTimelineV1 } from './open-audio-runtime'
import * as p from './open-contract-parse'
import { parseTtrpgOpenVoiceScriptV1, type TtrpgOpenVoiceScriptV1 } from './open-voice-script-contract'
import type { TtrpgOpenAudioReceiptV2 } from './open-generated-audio-contract'

export interface TtrpgOpenAudioAssetV1 {
  originSessionKey: string; assetKey: string; version: number; kind: 'bgm' | 'ambience' | 'sfx' | 'voice'
  name: string; mimeType: 'audio/wav' | 'audio/mpeg' | 'audio/ogg'; byteSize: number; durationMs: number | null
  contentHash: string; source: string; license: string
}
export interface TtrpgOpenAudioRequestV1 {
  action: 'play' | 'stop'; channel: TtrpgAudioChannelV1; audience: TtrpgAudioAudienceV1; privateActorKey: string | null
  narrationSourceRef: TtrpgOpenSourceRefV1; fade: number; voiceTimeline: TtrpgVoiceTimelineV1 | null
  media: { kind: 'upload'; submissionKey: string } | { kind: 'retained' | 'stop'; sourceRef: TtrpgOpenSourceRefV1 }
}
export interface TtrpgOpenAudioReceiptV1 {
  schema: 'storyforge.ttrpg-open-audio-receipt'; version: 1
  runtimeSourceHash: string; submissionKey: string; envelope: TtrpgOpenScopedAudioEventV1; request: TtrpgOpenAudioRequestV1
  asset: TtrpgOpenAudioAssetV1 | null
}
export const ttrpgOpenAudioKindV1 = (channel: TtrpgAudioChannelV1) => channel === 'music' ? 'bgm' as const : channel
export const ttrpgOpenAudioSourceEqualV1 = (a: TtrpgOpenSourceRefV1, b: TtrpgOpenSourceRefV1) => a.sessionKey === b.sessionKey && a.sequence === b.sequence

export function parseTtrpgOpenAudioAssetV1(value: unknown): TtrpgOpenAudioAssetV1 {
  const a = p.record(value, ['originSessionKey', 'assetKey', 'version', 'kind', 'name', 'mimeType', 'byteSize', 'durationMs', 'contentHash', 'source', 'license'], 'frozen audio asset')
  return { originSessionKey: p.key(a.originSessionKey, 'audio original session'), assetKey: p.key(a.assetKey, 'audio asset key'), version: p.integer(a.version, 'audio asset version', 1),
    kind: p.oneOf(a.kind, ['bgm', 'ambience', 'sfx', 'voice'], 'audio media kind'), name: p.text(a.name, 'audio asset name', 500),
    mimeType: p.oneOf(a.mimeType, ['audio/wav', 'audio/mpeg', 'audio/ogg'], 'audio MIME'), byteSize: p.integer(a.byteSize, 'audio bytes', 1, 100 * 1024 * 1024),
    durationMs: p.nullable(a.durationMs, (v, l) => p.integer(v, l, 1, 86400000), 'audio duration'), contentHash: p.hash(a.contentHash, 'audio content hash'),
    source: p.text(a.source, 'audio source declaration', 5000), license: p.text(a.license, 'audio license declaration', 5000) }
}
export function parseTtrpgOpenAudioRequestV1(value: unknown): TtrpgOpenAudioRequestV1 {
  const r = p.record(value, ['action', 'channel', 'audience', 'privateActorKey', 'narrationSourceRef', 'fade', 'voiceTimeline', 'media'], 'audio control request')
  const action = p.oneOf(r.action, ['play', 'stop'], 'audio action'), channel = p.oneOf(r.channel, TTRPG_AUDIO_CHANNELS_V1, 'audio channel')
  const m = p.object(r.media, 'audio media origin'), kind = p.oneOf(m.kind, ['upload', 'retained', 'stop'], 'audio media origin kind')
  p.exact(m, kind === 'upload' ? ['kind', 'submissionKey'] : ['kind', 'sourceRef'], 'audio media origin')
  if ((action === 'stop') !== (kind === 'stop') || channel !== 'voice' && r.voiceTimeline !== null || action === 'stop' && r.voiceTimeline !== null) p.fail('音频动作、媒资来源或时间轴不一致')
  let voiceTimeline: TtrpgVoiceTimelineV1 | null = null
  if (r.voiceTimeline !== null) {
    const t = p.record(r.voiceTimeline, ['granularity', 'marks', 'speakerVoiceId', 'styleKey', 'styleDegree'], 'audio voice timeline')
    const marks = p.list(t.marks, 'voice marks', value => {
      const m = p.record(value, ['textOffset', 'textLength', 'startMs', 'durationMs'], 'voice mark')
      return { textOffset: p.integer(m.textOffset, 'voice text offset', 0, 16000), textLength: p.integer(m.textLength, 'voice text length', 1, 16000),
        startMs: p.integer(m.startMs, 'voice start', 0, 86400000), durationMs: p.integer(m.durationMs, 'voice duration', 1, 86400000) }
    }, 16000, 1)
    voiceTimeline = { granularity: p.oneOf(t.granularity, ['char', 'word'], 'voice granularity'), marks, speakerVoiceId: p.key(t.speakerVoiceId, 'speaker voice'),
      styleKey: p.nullable(t.styleKey, p.key, 'voice style'), styleDegree: p.nullable(t.styleDegree, (v, l) => p.number(v, l, 0, 1), 'voice style degree') }
  }
  const audience = p.oneOf(r.audience, TTRPG_AUDIO_AUDIENCES_V1, 'audio audience'), privateActorKey = p.nullable(r.privateActorKey, p.key, 'private audio actor')
  if ((audience === 'private') !== (privateActorKey !== null)) p.fail('私密音频须指定一个准确角色')
  return { action, channel, audience, privateActorKey, narrationSourceRef: parseTtrpgOpenSourceRefV1(r.narrationSourceRef), fade: p.integer(r.fade, 'audio fade', 0, 60000), voiceTimeline,
    media: kind === 'upload' ? { kind, submissionKey: p.key(m.submissionKey, 'audio upload submission') } : { kind, sourceRef: parseTtrpgOpenSourceRefV1(m.sourceRef) } }
}
export function parseTtrpgOpenAudioReceiptV1(value: unknown): TtrpgOpenAudioReceiptV1 {
  const r = p.record(value, ['schema', 'version', 'runtimeSourceHash', 'submissionKey', 'envelope', 'request', 'asset'], 'audio receipt')
  const envelope = parseTtrpgOpenScopedAudioEventV1(r.envelope), request = parseTtrpgOpenAudioRequestV1(r.request), asset = p.nullable(r.asset, parseTtrpgOpenAudioAssetV1, 'audio asset')
  const event = envelope.event
  if (request.action !== event.action || request.channel !== event.channel || request.audience !== event.audience || request.fade !== event.fade
    || stable(request.voiceTimeline) !== stable(event.voiceTimeline) || request.privateActorKey !== envelope.scope.privateActorKey
    || (event.action === 'play') !== (asset !== null) || asset && (event.assetKey !== asset.assetKey || asset.kind !== ttrpgOpenAudioKindV1(event.channel))) p.fail('音频回执与原请求、范围或媒资版本不一致')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-audio-receipt', 'audio receipt schema'), version: p.literal(r.version, 1, 'audio receipt version'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'audio runtime source'), submissionKey: p.key(r.submissionKey, 'audio submission'), envelope, request, asset }
}

export function assertTtrpgOpenAudioWriteAllowedV1(runtime: TtrpgRuntimeStateV2, viewerKey: string, action: 'play' | 'stop'): void {
  const run = runtime.openRun, auth = runtime.authorization
  if (!run || !auth || !runtime.product.sessionZero.completed) p.fail('音频控制需要当前有效开团授权')
  assertTtrpgOpenHumanHostV1(auth, viewerKey)
  assertTtrpgOpenSituationWindowEventV1(runtime, 'ttrpg.audio.cue.applied')
  if (action === 'play' && (runtime.product.safety.status !== 'active' || run.stage.status !== 'open')) p.fail('暂停或阶段关闭后不能保存新音频播放')
  if (run.operations.some(row => ['awaiting-approval', 'executing'].includes(row.status))
    || run.coordination.calls.some(row => ['prepared', 'dispatched'].includes(row.status))
    || run.entityOperations?.some(row => row.resolution === null)
    || runtime.branchLineage?.recoveryTasks.some(row => !['completed', 'withdrawn'].includes(row.status))) p.fail('本轮仍在处理；稍后切换音轨，本机静音始终可用')
}

/** Resolve the actual accepted prose and completed operation; a mention or a draft is insufficient. */
export function ttrpgOpenAudioNarrationV1(runtime: TtrpgRuntimeStateV2, ref: TtrpgOpenSourceRefV1) {
  const narration = runtime.openRun?.narrations?.find(row => ttrpgOpenAudioSourceEqualV1(row.sourceRef, ref))
  const origin = ref.sessionKey === runtime.sessionKey ? runtime : runtime.branchLineage?.ancestors.find(a => a.sessionKey === ref.sessionKey)?.snapshot
  const operation = origin?.openRun?.operations.find(row => row.operationKey === narration?.binding.operationKey)
  if (!narration || !origin || !operation || operation.status !== 'completed' || operation.planHash !== narration.binding.frozenPlanHash
    || !origin.openRun?.narrations?.some(row => stable(row) === stable(narration))
    || !operation.businessRefs.some(row => row.stepKey === 'narration' && ttrpgOpenAudioSourceEqualV1(row.sourceRef, ref))) p.fail('音频必须引用已完成结算的原已确认叙述')
  return narration
}
/** Single source/audience policy for existing voice files and future synthesis.
 * A generated script is data; it does not authorize a model or an E16 write. */
export function createTtrpgOpenVoiceScriptV1(input: {
  runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; viewerKey: string
  narrationSourceRef: TtrpgOpenSourceRefV1; audience: TtrpgAudioAudienceV1; privateActorKey: string | null
}): TtrpgOpenVoiceScriptV1 {
  assertTtrpgOpenAudioWriteAllowedV1(input.runtime, input.viewerKey, 'play')
  const narration = ttrpgOpenAudioNarrationV1(input.runtime, parseTtrpgOpenSourceRefV1(input.narrationSourceRef))
  const scope = createTtrpgOpenAudioScopeV1({ authorization: input.runtime.authorization!, viewerKey: input.viewerKey,
    audience: input.audience, privateActorKey: input.privateActorKey })
  if (scope.audience === 'public' || scope.recipients.some(row => row.role === 'player' && !narration.recipientActorKeys.includes(row.actorKey!))) p.fail('配音不能扩大原全队叙述的准确接收者')
  return parseTtrpgOpenVoiceScriptV1({ schema: 'storyforge.ttrpg-open-voice-script', version: 1,
    sessionKey: input.runtime.sessionKey, runtimeSourceHash: input.runtimeSourceHash,
    narrationSourceRef: structuredClone(narration.sourceRef), narrationBinding: structuredClone(narration.binding), scope,
    text: narration.narration.paragraphs.map(row => row.text).join('\n\n') })
}
type AudioScopeOwner = {request: {action: 'play' | 'stop'}; envelope: {scope: TtrpgOpenAudioScopeV1}}
export function ttrpgOpenAudioReceiptVisibleV1(receipt: AudioScopeOwner, runtime: Pick<TtrpgRuntimeStateV2, 'authorization'>, viewerKey: string): boolean {
  const seat = runtime.authorization?.seats.find(row => row.viewerKey === viewerKey && row.controller !== 'ai' && row.assignmentState === 'claimed')
  return !!seat && (receipt.envelope.scope.audience === 'public' || receipt.envelope.scope.recipients.some(row => row.seatKey === seat.seatKey
    && row.viewerKey === seat.viewerKey && row.actorKey === seat.actorKey && row.role === seat.role && row.controller !== 'ai'))
}

/** A stop grants no file or prose. Keep the original listener fence even when
 * roster/consent changes; current explicit host authority controls the receipt.
 * A public control may add its current issuer, who could already hear public audio. */
export function createTtrpgOpenAudioStopScopeV1(authorization: TtrpgOpenAuthorizationV1, original: AudioScopeOwner, viewerKey: string) {
  const issuer = assertTtrpgOpenHumanHostV1(authorization, viewerKey)
  if (original.request.action !== 'play' || !ttrpgOpenAudioReceiptVisibleV1(original, { authorization }, viewerKey)) p.fail('停止必须由当前有原读取权限的真人主持确认')
  const recipients = structuredClone(original.envelope.scope.recipients)
  if (original.envelope.scope.audience === 'public') {
    const index = recipients.findIndex(row => row.seatKey === issuer.seatKey || row.viewerKey === issuer.viewerKey)
    const current = { seatKey: issuer.seatKey, viewerKey: issuer.viewerKey, actorKey: issuer.actorKey, role: issuer.role, controller: issuer.controller }
    if (index < 0) recipients.push(current); else recipients[index] = current
  }
  recipients.sort((a, b) => a.seatKey < b.seatKey ? -1 : a.seatKey > b.seatKey ? 1 : 0)
  return parseTtrpgOpenAudioScopeV1({ ...original.envelope.scope, authorizationRef: authorization.sourceRef,
    issuerSeatKey: issuer.seatKey, issuerViewerKey: issuer.viewerKey, recipients })
}

export function createTtrpgOpenAudioReceiptV1(input: {
  runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; viewerKey: string; request: TtrpgOpenAudioRequestV1
  asset: TtrpgOpenAudioAssetV1 | null; sequence: number; commandId: string; submissionKey: string
}): TtrpgOpenAudioReceiptV1 {
  const { runtime, viewerKey } = input, request = parseTtrpgOpenAudioRequestV1(input.request)
  assertTtrpgOpenAudioWriteAllowedV1(runtime, viewerKey, request.action)
  ttrpgOpenAudioNarrationV1(runtime, request.narrationSourceRef)
  if (request.narrationSourceRef.sessionKey === runtime.sessionKey && request.narrationSourceRef.sequence >= input.sequence) p.fail('音频不得先于原结算叙述')
  const retainedRef = request.media.kind === 'upload' ? null : request.media.sourceRef
  const prior = retainedRef ? runtime.openRun!.audioReceipts?.find(row => ttrpgOpenAudioSourceEqualV1(row.envelope.sourceRef, retainedRef)) : undefined
  if (request.media.kind === 'retained' && prior?.version === 2) p.fail('生成配音重播须保留显式 V2 来源与真实样本时间轴')
  if (request.media.kind !== 'upload' && (!prior || prior.request.action !== 'play' || !ttrpgOpenAudioReceiptVisibleV1(prior, runtime, viewerKey)
    || prior.envelope.event.channel !== request.channel || !ttrpgOpenAudioSourceEqualV1(prior.request.narrationSourceRef, request.narrationSourceRef))) p.fail('音频重播或停止需要本人可读的原准确播放记录')
  const scope = request.action === 'stop' ? createTtrpgOpenAudioStopScopeV1(runtime.authorization!, prior!, viewerKey)
    : createTtrpgOpenAudioScopeV1({ authorization: runtime.authorization!, viewerKey, audience: request.audience, privateActorKey: request.privateActorKey })
  const asset = request.action === 'stop' ? null : parseTtrpgOpenAudioAssetV1(input.asset)
  if (request.action === 'stop' && input.asset !== null || request.media.kind === 'retained' && stable(asset) !== stable(prior?.asset)) p.fail('音频不得替换原保留媒资版本')
  if (request.media.kind === 'upload' && asset?.originSessionKey !== runtime.sessionKey) p.fail('新上传必须归属本团局')
  if (request.action === 'stop' && (prior!.request.audience !== request.audience || prior!.request.privateActorKey !== request.privateActorKey)) p.fail('停止必须指向原准确音轨范围')
  if (prior && request.action === 'play') {
    const old = prior.envelope.scope
    if (scope.audience === 'public' ? old.audience !== 'public' : old.audience !== 'public' && scope.recipients.some(recipient =>
      !old.recipients.some(original => stable(original) === stable(recipient)))) p.fail('重播不得扩大原音频接收者；新披露须另行明确提供素材')
  }
  let fallbackText = request.channel === 'music' ? '背景音乐暂不可用。' : request.channel === 'ambience' ? '环境声暂不可用。' : request.channel === 'sfx' ? '音效暂不可用。' : '语音暂不可用。'
  if (request.action === 'play' && request.channel === 'voice') {
    const script = createTtrpgOpenVoiceScriptV1({ runtime, runtimeSourceHash: input.runtimeSourceHash, viewerKey,
      narrationSourceRef: request.narrationSourceRef, audience: request.audience, privateActorKey: request.privateActorKey })
    if (stable(scope) !== stable(script.scope)) p.fail('配音与音轨的接收范围不一致')
    fallbackText = script.text
    const timeline = validateTtrpgVoiceTimelineV1(request.voiceTimeline, fallbackText)
    if (!asset?.durationMs || timeline.marks.some(mark => mark.startMs + mark.durationMs > asset.durationMs!)) p.fail('语音时间轴超出素材声明时长')
  }
  return parseTtrpgOpenAudioReceiptV1({ schema: 'storyforge.ttrpg-open-audio-receipt', version: 1,
    runtimeSourceHash: input.runtimeSourceHash, submissionKey: input.submissionKey, request, asset, envelope: { schema: 'storyforge.ttrpg-open-scoped-audio', version: 1,
      sourceRef: { sessionKey: runtime.sessionKey, sequence: input.sequence }, scope, event: {
        type: 'ttrpg.audio.cue.applied', eventSequence: input.sequence, commandId: input.commandId, worldTurn: runtime.openRun!.worldTime.worldTurn,
        slotKey: request.action === 'stop' ? prior!.envelope.event.slotKey : input.commandId, channel: request.channel, action: request.action, fade: request.fade,
        audience: request.audience, targetRef: request.privateActorKey ?? 'audio.bus', assetKey: asset?.assetKey ?? null, fallbackText, voiceTimeline: request.voiceTimeline } } })
}

export function ttrpgOpenAudioPayloadV1(receipt: TtrpgOpenAudioReceiptV1) {
  return { receipt, intent: { viewerKey: receipt.envelope.scope.issuerViewerKey, submissionKey: receipt.submissionKey, request: receipt.request, asset: receipt.asset,
    decision: 'confirm-this-audio-and-audience' } }
}

/** Shape/origin closure only; async evidence verification also checks original event bytes. */
export function assertTtrpgOpenAudioJournalV1(runtime: TtrpgRuntimeStateV2,
  parseReceipt: (value: unknown) => TtrpgOpenAudioReceiptV1 | TtrpgOpenAudioReceiptV2 = parseTtrpgOpenAudioReceiptV1): void {
  const receipts = runtime.openRun?.audioReceipts ?? [], seen = new Set<string>()
  for (const raw of receipts) {
    const receipt = parseReceipt(raw), ref = receipt.envelope.sourceRef, key = stable(ref), media = receipt.request.media
    if (seen.has(key) || (media.kind === 'retained' || media.kind === 'stop') && !seen.has(stable(media.sourceRef))) p.fail('音频原事件来源重复或不是先前播放记录')
    seen.add(key)
    if (ref.sessionKey !== runtime.sessionKey && !runtime.branchLineage?.ancestors.some(a => a.sessionKey === ref.sessionKey && a.throughSequence >= ref.sequence
      && a.snapshot.openRun?.audioReceipts?.some(row => stable(row) === stable(receipt)))) p.fail('音频缺少准确祖先切点记录')
    ttrpgOpenAudioNarrationV1(runtime, receipt.request.narrationSourceRef)
  }
}
