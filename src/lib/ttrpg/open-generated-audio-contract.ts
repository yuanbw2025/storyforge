/** Explicit generated-origin E16 generation. V1 upload/char/word receipts and
 * their bytes stay unchanged; no parser or pure creator grants adoption. */
import type { ExactRunArtifactIdentityV1 } from '../types'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenAudioAssetV1, assertTtrpgOpenAudioWriteAllowedV1, ttrpgOpenAudioNarrationV1,
  createTtrpgOpenVoiceScriptV1, ttrpgOpenAudioSourceEqualV1, ttrpgOpenAudioReceiptVisibleV1, type TtrpgOpenAudioAssetV1 } from './open-audio-contract'
import { parseTtrpgOpenAudioScopeV1, createTtrpgOpenAudioScopeV1, parseTtrpgOpenScopedAudioEventV2,
  type TtrpgOpenAudioScopeV1, type TtrpgOpenScopedAudioEventV2 } from './open-audio-scope'
import { parseTtrpgOpenVoiceCompletionV1, type TtrpgOpenVoiceCompletionV1 } from './open-voice-completion-contract'
import { parseTtrpgOpenGeneratedVoiceTimeline, type TtrpgOpenGeneratedVoiceTimeline } from './open-voice-timeline-contract'
import * as p from './open-contract-parse'

export const TTRPG_GENERATED_AUDIO_RIGHTS_V1 = 'i-have-rights-to-use-this-voice-for-its-original-session-recipients' as const
export interface TtrpgOpenGeneratedAudioOriginV1 {
  schema: 'storyforge.ttrpg-open-generated-audio-origin'; version: 1
  originSessionKey: string; requestKey: string; originScope: TtrpgOpenAudioScopeV1
  choiceKey: string; rightsDeclaration: typeof TTRPG_GENERATED_AUDIO_RIGHTS_V1
  completion: TtrpgOpenVoiceCompletionV1; timeline: TtrpgOpenGeneratedVoiceTimeline
  artifactRefs: ExactRunArtifactIdentityV1[]
}
export interface TtrpgOpenAudioRequestV2 {
  version: 2; action: 'play'; channel: 'voice'; audience: 'gm-only' | 'party' | 'private'; privateActorKey: string | null
  narrationSourceRef: TtrpgOpenSourceRefV1; fade: number; voiceTimeline: null
  media: {kind: 'generated'; requestKey: string; candidateHash: string; choiceKey: string} | {kind: 'retained'; sourceRef: TtrpgOpenSourceRefV1}
}
export interface TtrpgOpenAudioReceiptV2 {
  schema: 'storyforge.ttrpg-open-audio-receipt'; version: 2; runtimeSourceHash: string; submissionKey: string
  envelope: TtrpgOpenScopedAudioEventV2; request: TtrpgOpenAudioRequestV2; asset: TtrpgOpenAudioAssetV1
  generated: TtrpgOpenGeneratedAudioOriginV1
}
export function ttrpgOpenGeneratedAudioFenceV1(scope: TtrpgOpenAudioScopeV1) {
  const {authorizationRef: _ref, schema: _schema, version: _version, ...fence} = scope
  return fence
}
export function ttrpgOpenGeneratedAudioIdentityV1(origin: TtrpgOpenGeneratedAudioOriginV1) {
  return stable([origin.originSessionKey, origin.completion.candidateHash, ttrpgOpenGeneratedAudioFenceV1(origin.originScope)])
}
export function parseTtrpgOpenGeneratedAudioOriginV1(value: unknown): TtrpgOpenGeneratedAudioOriginV1 {
  const r = p.record(value, ['schema','version','originSessionKey','requestKey','originScope','choiceKey','rightsDeclaration','completion','timeline','artifactRefs'], 'generated audio origin')
  const originScope = parseTtrpgOpenAudioScopeV1(r.originScope), completion = parseTtrpgOpenVoiceCompletionV1(r.completion)
  const artifactRefs = p.list(r.artifactRefs, 'generated audio exact roots', value => {
    const ref = p.record(value, ['artifactKind','contentHash'], 'generated audio exact root')
    return {artifactKind: p.oneOf(ref.artifactKind, ['source-snapshot','context-manifest','raw-response'], 'generated root kind'), contentHash: p.hash(ref.contentHash, 'generated root hash')}
  }, 64, 1)
  const keys = artifactRefs.map(ref => ref.artifactKind + ':' + ref.contentHash)
  if (new Set(keys).size !== keys.length || keys.some((key,i) => i > 0 && keys[i-1] >= key)
    || [completion.sourceEvidenceArtifactHash,completion.reviewArtifactHash,completion.verificationArtifactHash].some(h => !keys.includes('source-snapshot:' + h))
    || originScope.audience === 'public' || r.originSessionKey !== originScope.authorizationRef.sessionKey) p.fail('生成音频的原接收者或准确证据根不闭合')
  return {schema: p.literal(r.schema, 'storyforge.ttrpg-open-generated-audio-origin', 'generated audio origin schema'), version: p.literal(r.version, 1, 'generated origin version'),
    originSessionKey: p.key(r.originSessionKey, 'generated original session'), requestKey: p.key(r.requestKey, 'generated original request'), originScope,
    choiceKey: p.hash(r.choiceKey, 'generated metadata choice'), rightsDeclaration: p.literal(r.rightsDeclaration, TTRPG_GENERATED_AUDIO_RIGHTS_V1, 'explicit generated media rights'),
    completion, timeline: parseTtrpgOpenGeneratedVoiceTimeline(r.timeline), artifactRefs }
}
export function parseTtrpgOpenAudioRequestV2(value: unknown): TtrpgOpenAudioRequestV2 {
  const r = p.record(value, ['version','action','channel','audience','privateActorKey','narrationSourceRef','fade','voiceTimeline','media'], 'generated audio request')
  const m = p.object(r.media, 'generated audio media'), kind = p.oneOf(m.kind, ['generated','retained'], 'generated audio media kind')
  p.exact(m, kind === 'generated' ? ['kind','requestKey','candidateHash','choiceKey'] : ['kind','sourceRef'], 'generated audio media')
  const audience = p.oneOf(r.audience, ['gm-only','party','private'], 'generated audio audience'), privateActorKey = p.nullable(r.privateActorKey, p.key, 'generated private actor')
  if ((audience === 'private') !== (privateActorKey !== null)) p.fail('生成配音的私密目标不一致')
  return {version: p.literal(r.version, 2, 'generated audio request version'), action: p.literal(r.action, 'play', 'generated audio action'), channel: p.literal(r.channel, 'voice', 'generated audio channel'),
    audience, privateActorKey, narrationSourceRef: parseTtrpgOpenSourceRefV1(r.narrationSourceRef), fade: p.integer(r.fade, 'generated audio fade', 0, 60000),
    voiceTimeline: p.literal(r.voiceTimeline, null, 'generated speech never has invented legacy word marks'),
    media: kind === 'generated' ? {kind, requestKey: p.key(m.requestKey, 'generated request key'), candidateHash: p.hash(m.candidateHash, 'generated candidate'), choiceKey: p.hash(m.choiceKey, 'generated choice')} : {kind, sourceRef: parseTtrpgOpenSourceRefV1(m.sourceRef)} }
}
export function parseTtrpgOpenAudioReceiptV2(value: unknown): TtrpgOpenAudioReceiptV2 {
  const r = p.record(value, ['schema','version','runtimeSourceHash','submissionKey','envelope','request','asset','generated'], 'generated audio receipt')
  const envelope = parseTtrpgOpenScopedAudioEventV2(r.envelope), request = parseTtrpgOpenAudioRequestV2(r.request), asset = parseTtrpgOpenAudioAssetV1(r.asset)
  const generated = parseTtrpgOpenGeneratedAudioOriginV1(r.generated), event = envelope.event
  if (asset.kind !== 'voice' || asset.mimeType !== 'audio/wav' || asset.durationMs === null || asset.originSessionKey !== generated.originSessionKey
    || request.audience !== event.audience || request.privateActorKey !== envelope.scope.privateActorKey || request.fade !== event.fade || event.assetKey !== asset.assetKey
    || stable(envelope.generatedTimeline) !== stable(generated.timeline)
    || request.media.kind === 'generated' && (request.media.requestKey !== generated.requestKey || request.media.candidateHash !== generated.completion.candidateHash || request.media.choiceKey !== generated.choiceKey)) p.fail('生成配音回执与实际来源、文件或原请求不一致')
  return {schema: p.literal(r.schema, 'storyforge.ttrpg-open-audio-receipt', 'generated receipt schema'), version: p.literal(r.version, 2, 'generated receipt version'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'generated frozen source'), submissionKey: p.key(r.submissionKey, 'generated submission'), envelope, request, asset, generated}
}
export async function ttrpgOpenGeneratedAudioChoiceKeyV1(origin: Omit<TtrpgOpenGeneratedAudioOriginV1, 'choiceKey'>, metadata: Pick<TtrpgOpenAudioAssetV1, 'name' | 'source' | 'license'>) {
  return hash({schema: 'storyforge.ttrpg-open-generated-audio-choice', version: 1, origin: structuredClone(origin),
    metadata: {name: metadata.name, source: metadata.source, license: metadata.license}})
}
export function createTtrpgOpenAudioReceiptV2(input: {
  runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; viewerKey: string; request: TtrpgOpenAudioRequestV2; asset: TtrpgOpenAudioAssetV1
  generated: TtrpgOpenGeneratedAudioOriginV1; sequence: number; commandId: string; submissionKey: string
}): TtrpgOpenAudioReceiptV2 {
  const {runtime,viewerKey} = input, request = parseTtrpgOpenAudioRequestV2(input.request), generated = parseTtrpgOpenGeneratedAudioOriginV1(input.generated), asset = parseTtrpgOpenAudioAssetV1(input.asset)
  assertTtrpgOpenAudioWriteAllowedV1(runtime, viewerKey, 'play'); ttrpgOpenAudioNarrationV1(runtime, request.narrationSourceRef)
  if (request.narrationSourceRef.sessionKey === runtime.sessionKey && request.narrationSourceRef.sequence >= input.sequence) p.fail('生成音轨不能先于已确认叙述')
  const scope = createTtrpgOpenAudioScopeV1({authorization: runtime.authorization!, viewerKey, audience: request.audience, privateActorKey: request.privateActorKey})
  const script = createTtrpgOpenVoiceScriptV1({runtime, runtimeSourceHash: input.runtimeSourceHash, viewerKey, narrationSourceRef: request.narrationSourceRef, audience: request.audience, privateActorKey: request.privateActorKey})
  if (request.media.kind === 'generated') {
    const original = runtime.openRun!.voiceRequests?.find(row => row.requestKey === generated.requestKey)
    if (generated.originSessionKey !== runtime.sessionKey || !original || original.script.sessionKey !== runtime.sessionKey
      || original.script.runtimeSourceHash !== input.runtimeSourceHash || !ttrpgOpenAudioSourceEqualV1(original.script.narrationSourceRef, request.narrationSourceRef)
      || original.script.text !== script.text || stable(original.script.scope) !== stable(generated.originScope)
      || stable(ttrpgOpenGeneratedAudioFenceV1(scope)) !== stable(ttrpgOpenGeneratedAudioFenceV1(generated.originScope))) p.fail('首次生成音轨须保留准确本局原请求与原本人接收范围')
    if (runtime.openRun!.audioReceipts?.some(row => row.version === 2 && row.request.media.kind === 'generated' && ttrpgOpenGeneratedAudioIdentityV1(row.generated) === ttrpgOpenGeneratedAudioIdentityV1(generated))) p.fail('原候选和接收范围已有正式采用；不能用另一名称或许可重复加入音轨')
  } else {
    const retainedRef = request.media.sourceRef
    const prior = runtime.openRun!.audioReceipts?.find(row => ttrpgOpenAudioSourceEqualV1(row.envelope.sourceRef, retainedRef))
    if (prior?.version !== 2 || !ttrpgOpenAudioReceiptVisibleV1(prior, runtime, viewerKey) || stable(prior.generated) !== stable(generated) || stable(prior.asset) !== stable(asset)
      || !ttrpgOpenAudioSourceEqualV1(prior.request.narrationSourceRef, request.narrationSourceRef)
      || scope.recipients.some(recipient => !prior.envelope.scope.recipients.some(original => stable(original) === stable(recipient)))) p.fail('生成配音重播不能替换原来源、版本或扩大接收者')
  }
  if (generated.timeline.sourceTextLengthUtf16 !== script.text.length) p.fail('生成音轨缺少完整原文回退')
  return parseTtrpgOpenAudioReceiptV2({schema: 'storyforge.ttrpg-open-audio-receipt', version: 2, runtimeSourceHash: input.runtimeSourceHash, submissionKey: input.submissionKey,
    request, asset, generated, envelope: {schema: 'storyforge.ttrpg-open-scoped-audio', version: 2, sourceRef: {sessionKey:runtime.sessionKey,sequence:input.sequence}, scope,
      generatedTimeline: generated.timeline, event: {type:'ttrpg.audio.cue.applied',eventSequence:input.sequence,commandId:input.commandId,worldTurn:runtime.openRun!.worldTime.worldTurn,
        slotKey:input.commandId,channel:'voice',action:'play',fade:request.fade,audience:request.audience,targetRef:request.privateActorKey??'audio.bus',assetKey:asset.assetKey,fallbackText:script.text,voiceTimeline:null}}})
}
