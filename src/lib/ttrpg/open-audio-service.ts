/** Human audio desk. Reads never generate, import, confirm or play; file import is explicit. */
import { db } from '../db/schema'
// The existing audio service remains the public domain boundary for both
// licensed files and human-only script review. Source review grants no dispatch.
export { prepareTtrpgOpenVoiceScriptV1, readTtrpgOpenReviewedVoiceScriptV1 } from './open-voice-script-service'
export { captureTtrpgOpenVoiceCompletionV1 } from './open-voice-completion-evidence'
export { prepareTtrpgOpenVoiceReadingReviewV1, readTtrpgOpenReviewedVoiceReadingV1, previewTtrpgOpenVoiceReadingV1 } from './open-voice-reading-service'
export type { TtrpgOpenVoiceScriptReviewV1 } from './open-voice-script-service'
import { loadTtrpgOpenAudioReadStateV1 as owner, type TtrpgOpenAudioReadInputV1 } from './open-audio-read-state'
import { assertTtrpgOpenAudioWriteAllowedV1, parseTtrpgOpenAudioRequestV1, ttrpgOpenAudioKindV1,
  ttrpgOpenAudioNarrationV1, ttrpgOpenAudioReceiptVisibleV1, ttrpgOpenAudioSourceEqualV1,
  type TtrpgOpenAudioRequestV1, type TtrpgOpenAudioAssetV1 } from './open-audio-contract'
import { createTtrpgOpenAudioReceipt, type TtrpgOpenAudioRequest, type TtrpgOpenAudioReceipt } from './open-audio-receipt'
import { parseTtrpgOpenAudioRequestV2, parseTtrpgOpenGeneratedAudioOriginV1, ttrpgOpenGeneratedAudioChoiceKeyV1, TTRPG_GENERATED_AUDIO_RIGHTS_V1, type TtrpgOpenGeneratedAudioOriginV1 } from './open-generated-audio-contract'
import { readTtrpgOpenGeneratedAudioNativeProofV1, ttrpgOpenGeneratedAudioAssetKeyV1 } from './open-generated-audio-evidence'
import { captureTtrpgOpenVoiceCompletionV1 } from './open-voice-completion-evidence'
import { projectTtrpgOpenScopedAudioV1, projectTtrpgOpenAudioTransitionsV1 } from './open-audio-scope'
import { issueTtrpgOpenAudioUploadTicketV1, issueTtrpgOpenAudioGeneratedTicketV2, readTtrpgOpenAudioMediaWitnessV1, assertTtrpgOpenAudioMediaWitnessV1, ttrpgOpenAudioAssetSnapshotV1,
  type TtrpgOpenAudioUploadTicketV1, type TtrpgOpenAudioGeneratedTicketV2 } from './open-audio-media'
import { importProductRuntimeMediaAssetV1 } from '../product/runtime-media-library'
import { sha256MediaData } from '../product-production/media-blob-store'
import { detectProductMediaMimeTypeV1 } from '../product-production/media-adapters'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { applyTtrpgOpenAudioCueV1 } from './runtime-commands'
import { ttrpgOpenScopedKeyV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'

export type TtrpgOpenAudioDeskInputV1 = TtrpgOpenAudioReadInputV1
export interface TtrpgOpenAudioReviewV1 {
  schema: 'storyforge.ttrpg-open-audio-review'; version: 1; reviewKey: string
  sessionId: number; viewerKey: string; sequence: number; request: TtrpgOpenAudioRequest
  asset: TtrpgOpenAudioAssetV1 | null; recipients: string[]; fallbackText: string; generated?: TtrpgOpenGeneratedAudioOriginV1
}
interface ReviewOwner { input: TtrpgOpenAudioDeskInputV1; body: string; baseStateHash: string; submissionKey: string; uploadTicket?: TtrpgOpenAudioUploadTicketV1; generatedTicket?: TtrpgOpenAudioGeneratedTicketV2 }
const reviews = new WeakMap<TtrpgOpenAudioReviewV1, ReviewOwner>()
interface ReadViewOwner {
  inputKey: string; body: string; sessionKey: string; runtimeSourceHash: string; authorizationRevision: number
  sequence: number; stateHash: string; clipKeys: string[]
}
// A JSON DTO is not a fresh local read. No file, URL, playback flag or write ticket is retained here.
const readViews = new WeakMap<object, ReadViewOwner>()
// Immutable Blob identity proves an actual current file read, not a copied DTO or asset-key claim.
const readClips = new WeakMap<Blob, { inputKey: string; sessionKey: string; runtimeSourceHash: string; authorizationRevision: number; clipKey: string }>()
const inputKey = (input: TtrpgOpenAudioDeskInputV1) => stable({ scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey })
const snapshotInput = (input: TtrpgOpenAudioDeskInputV1): TtrpgOpenAudioDeskInputV1 => ({ scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey })
type Loaded = Awaited<ReturnType<typeof owner>>
function visible(loaded: Loaded, viewerKey: string) { return (loaded.runtime.openRun!.audioReceipts ?? []).filter(row => ttrpgOpenAudioReceiptVisibleV1(row, loaded.runtime, viewerKey)) }
function active(loaded: Loaded, viewerKey: string) {
  const receipts = visible(loaded, viewerKey), projection = projectTtrpgOpenScopedAudioV1({ events: receipts.map(row => row.envelope), authorization: loaded.authorization, reader: { kind: 'human', viewerKey } })
  return Object.values(projection.channels).flatMap(cue => {
    if (!cue) return []
    const matches = receipts.filter(row => row.request.action === 'play' && row.envelope.event.slotKey === cue.slotKey), receipt = matches[0]
    if (matches.length !== 1 || !receipt?.asset) p.fail('当前音轨缺少唯一原播放回执')
    return [{ cue, receipt }]
  })
}
function receiverLabels(loaded: Loaded, receipt: TtrpgOpenAudioReceipt) {
  return receipt.envelope.scope.recipients.map(row => row.role === 'gm' ? '主持' : loaded.state.entities[row.actorKey!]?.name ?? '原角色')
}
function createReview(input: TtrpgOpenAudioDeskInputV1, loaded: Loaded, request: TtrpgOpenAudioRequest, asset: TtrpgOpenAudioAssetV1 | null,
  submissionKey: string, uploadTicket?: TtrpgOpenAudioUploadTicketV1, generated?: TtrpgOpenGeneratedAudioOriginV1, generatedTicket?: TtrpgOpenAudioGeneratedTicketV2) {
  const receipt = createTtrpgOpenAudioReceipt({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey,
    request, asset, ...(generated ? {generated} : {}), sequence: loaded.state.lastSequence + 1, commandId: 'audio.review.pending', submissionKey })
  const review: TtrpgOpenAudioReviewV1 = { schema: 'storyforge.ttrpg-open-audio-review', version: 1, reviewKey: crypto.randomUUID(), sessionId: input.sessionId, viewerKey: input.viewerKey,
    sequence: loaded.state.lastSequence, request: structuredClone(request), asset: asset ? structuredClone(asset) : null, recipients: receiverLabels(loaded, receipt), fallbackText: receipt.envelope.event.fallbackText, ...(receipt.version === 2 ? {generated:receipt.generated} : {}) }
  reviews.set(review, { input: { scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey }, body: stable(review), baseStateHash: loaded.stateHash, submissionKey, ...(uploadTicket ? { uploadTicket } : {}), ...(generatedTicket ? { generatedTicket } : {}) })
  return review
}
export async function readTtrpgOpenAudioDeskV1(request: TtrpgOpenAudioDeskInputV1) {
  const input = snapshotInput(request)
  const loaded = await owner(input), runtime = loaded.runtime
  let canPlay = false, canStop = false, unavailable = ''
  if (loaded.humanHost) {
    try { assertTtrpgOpenAudioWriteAllowedV1(runtime, input.viewerKey, 'play'); canPlay = true } catch { unavailable = '本轮处理完成且未暂停时，可核对并切换音轨。' }
    try { assertTtrpgOpenAudioWriteAllowedV1(runtime, input.viewerKey, 'stop'); canStop = true } catch { /* Local mute remains independent. */ }
  }
  const tracks = active(loaded, input.viewerKey).map(({ cue, receipt }) => ({ channel: cue.channel, slotKey: cue.slotKey, audience: cue.audience, fallbackText: cue.fallbackText,
    sourceRef: receipt.envelope.sourceRef, clipKey: `${cue.slotKey}:${receipt.asset!.contentHash}`, fade: cue.fade, durationMs: receipt.asset!.durationMs,
    voiceMarks: cue.voiceTimeline?.marks ?? null, ...(cue.generatedTimeline ? {generatedTimeline:cue.generatedTimeline} : {}) }))
  const library = loaded.humanHost ? visible(loaded, input.viewerKey).filter(row => row.request.action === 'play').map(row => ({
    sourceRef: row.envelope.sourceRef, name: row.asset!.name, channel: row.request.channel, audience: row.request.audience, privateActorKey: row.request.privateActorKey,
    narrationSourceRef: row.request.narrationSourceRef, source: row.asset!.source, license: row.asset!.license, recipients: receiverLabels(loaded, row) })) : []
  const causes = loaded.humanHost ? (runtime.openRun!.narrations ?? []).flatMap(row => {
    try { ttrpgOpenAudioNarrationV1(runtime, row.sourceRef) } catch { return [] }
    if (loaded.seat?.role !== 'gm' && (!loaded.seat?.actorKey || !row.recipientActorKeys.includes(loaded.seat.actorKey))) return []
    return [{ sourceRef: row.sourceRef, text: row.narration.paragraphs.map(paragraph => paragraph.text).join('\n\n') }]
  }) : []
  await loaded.assertCurrent()
  const value = { sessionId: input.sessionId, viewerKey: input.viewerKey, sequence: loaded.state.lastSequence, authorizationRevision: loaded.authorization.revision,
    paused: runtime.product.safety.status !== 'active', humanHost: loaded.humanHost, privateControlAllowed: loaded.humanHost && loaded.seat?.role === 'gm', canPlay, canStop, unavailable, tracks, library, causes,
    players: loaded.humanHost ? loaded.authorization.seats.filter(row => row.role === 'player').map(row => ({ actorKey: row.actorKey!, name: loaded.state.entities[row.actorKey!]?.name ?? '角色' })) : [] }
  readViews.set(value, { inputKey: inputKey(input), body: stable(value), sessionKey: runtime.sessionKey, runtimeSourceHash: loaded.session.runtimeSourceHash,
    authorizationRevision: loaded.authorization.revision, sequence: loaded.state.lastSequence, stateHash: loaded.stateHash, clipKeys: tracks.map(track => track.clipKey) })
  return value
}
export type TtrpgOpenAudioDeskV1 = Awaited<ReturnType<typeof readTtrpgOpenAudioDeskV1>>

function adoptedGenerated(loaded: Loaded, viewerKey: string, requestKey: string) {
  const rows = visible(loaded,viewerKey).flatMap(row => row.version===2 && row.request.media.kind==='generated'
    && row.generated.requestKey===requestKey && row.generated.originScope.issuerViewerKey===viewerKey ? [row] : [])
  if(rows.length>1)p.fail('原配音请求存在多个采用结果，请保留证据并核对')
  return rows[0]??null
}
function adoptionSummary(row: NonNullable<ReturnType<typeof adoptedGenerated>>) {
  return {sourceRef:row.envelope.sourceRef,candidateHash:row.generated.completion.candidateHash,choiceKey:row.generated.choiceKey,
    name:row.asset.name,source:row.asset.source,license:row.asset.license,assetKey:row.asset.assetKey}
}
/** Reconcile already committed E16 before asking for a live generator, active
 * audition or another rights declaration. A read never adopts a partial file. */
export async function readTtrpgOpenGeneratedAudioAdoptionV1(request: TtrpgOpenAudioDeskInputV1 & {requestKey:string}) {
  const input={...snapshotInput(request),requestKey:p.key(request.requestKey,'original audio request')},loaded=await owner(input)
  const row=adoptedGenerated(loaded,input.viewerKey,input.requestKey)
  await loaded.assertCurrent();return row?adoptionSummary(row):null
}
function generatedOriginBody(source: Awaited<ReturnType<typeof captureTtrpgOpenVoiceCompletionV1>>) {
  return {schema:'storyforge.ttrpg-open-generated-audio-origin' as const,version:1 as const,originSessionKey:source.request.script.sessionKey,
    requestKey:source.request.requestKey,originScope:source.request.script.scope,rightsDeclaration:TTRPG_GENERATED_AUDIO_RIGHTS_V1,
    completion:source.completion,timeline:source.timeline,artifactRefs:source.artifactRefs}
}
/** These are existing unadopted files and their entered metadata, not portable
 * permissions. Reopening a choice still requires explicit current rights. */
export async function readTtrpgOpenPreparedGeneratedAudioV1(request: TtrpgOpenAudioDeskInputV1 & {requestKey:string;candidateHash:string}) {
  const input={...snapshotInput(request),requestKey:p.key(request.requestKey,'original prepared request'),candidateHash:p.hash(request.candidateHash,'original prepared candidate')}
  const loaded=await owner(input),accepted=adoptedGenerated(loaded,input.viewerKey,input.requestKey)
  if(accepted){if(accepted.generated.completion.candidateHash!==input.candidateHash)p.fail('原请求已经采用另一准确候选');return {adopted:adoptionSummary(accepted),choices:[]}}
  const source=await captureTtrpgOpenVoiceCompletionV1(input),body=generatedOriginBody(source)
  const rows=await db.productMediaAssets.where('productRuntimeSessionId').equals(input.sessionId).toArray()
  const choices:Array<{choiceKey:string;assetKey:string;version:number;name:string;source:string;license:string}>=[]
  for(const row of rows){
    if(row.ownerKind!=='runtime'||row.productType!=='ttrpg'||row.projectId!==input.scope.projectId||row.worldId!==input.scope.worldId||row.workId!==input.scope.workId
      ||row.productReleaseId!==null||row.kind!=='voice'||row.contentHash!==source.audio.contentHash||stable(p.json(row.exactArtifactRefsJson??null))!==stable(source.artifactRefs))continue
    const choiceKey=await ttrpgOpenGeneratedAudioChoiceKeyV1(body,row),origin=parseTtrpgOpenGeneratedAudioOriginV1({...body,choiceKey})
    if(row.assetKey===await ttrpgOpenGeneratedAudioAssetKeyV1(origin))choices.push({choiceKey,assetKey:row.assetKey,version:row.version,name:row.name,source:row.source,license:row.license})
  }
  await loaded.assertCurrent();return {adopted:null,choices}
}
export async function prepareTtrpgOpenGeneratedAudioV1(request: TtrpgOpenAudioDeskInputV1 & {
  requestKey:string;candidateHash:string;name:string;source:string;license:string
  rightsDeclaration:typeof TTRPG_GENERATED_AUDIO_RIGHTS_V1;decision:'prepare-this-original-generated-voice-for-session-use'
}) {
  const input={...snapshotInput(request),requestKey:p.key(request.requestKey,'original generated request'),candidateHash:p.hash(request.candidateHash,'original generated candidate'),
    name:p.text(request.name,'generated audio name',500),source:p.text(request.source,'generated audio source',5000),license:p.text(request.license,'generated audio license',5000),
    rightsDeclaration:p.literal(request.rightsDeclaration,TTRPG_GENERATED_AUDIO_RIGHTS_V1,'explicit generated audio rights'),
    decision:p.literal(request.decision,'prepare-this-original-generated-voice-for-session-use','explicit generated preparation')}
  const loaded=await owner(input),accepted=adoptedGenerated(loaded,input.viewerKey,input.requestKey)
  if(accepted){
    const {choiceKey,...body}=accepted.generated
    if(accepted.generated.completion.candidateHash!==input.candidateHash||await ttrpgOpenGeneratedAudioChoiceKeyV1(body,input)!==choiceKey)p.fail('原候选已按另一名称、来源或许可采用；不会重复加入音轨')
    await loaded.assertCurrent();return {status:'already-adopted' as const,adopted:adoptionSummary(accepted)}
  }
  assertTtrpgOpenAudioWriteAllowedV1(loaded.runtime,input.viewerKey,'play')
  const proof=await readTtrpgOpenGeneratedAudioNativeProofV1(input),body=generatedOriginBody(proof.source)
  const choiceKey=await ttrpgOpenGeneratedAudioChoiceKeyV1(body,input),origin=parseTtrpgOpenGeneratedAudioOriginV1({...body,choiceKey})
  const assetKey=await ttrpgOpenGeneratedAudioAssetKeyV1(origin),audio=proof.source.audio
  if(proof.data.byteLength!==audio.byteLength||await sha256MediaData(proof.data)!==audio.contentHash)p.fail('原生成文件的物理字节与准确完成来源不一致')
  const proposed:TtrpgOpenAudioAssetV1={originSessionKey:body.originSessionKey,assetKey,version:1,kind:'voice',name:input.name,mimeType:'audio/wav',byteSize:audio.byteLength,
    durationMs:audio.durationMs,contentHash:audio.contentHash,source:input.source,license:input.license}
  const cue=parseTtrpgOpenAudioRequestV2({version:2,action:'play',channel:'voice',audience:body.originScope.audience,privateActorKey:body.originScope.privateActorKey,
    narrationSourceRef:proof.source.request.script.narrationSourceRef,fade:0,voiceTimeline:null,media:{kind:'generated',requestKey:input.requestKey,candidateHash:input.candidateHash,choiceKey}})
  createTtrpgOpenAudioReceipt({runtime:loaded.runtime,runtimeSourceHash:loaded.session.runtimeSourceHash,viewerKey:input.viewerKey,request:cue,asset:proposed,generated:origin,
    sequence:loaded.state.lastSequence+1,commandId:'audio.generated.pending',submissionKey:choiceKey})
  await loaded.assertCurrent()
  const row=await importProductRuntimeMediaAssetV1({scope:input.scope,productRuntimeSessionId:input.sessionId,assetKey,kind:'voice',name:input.name,blob:new Blob([proof.data],{type:'audio/wav'}),
    source:input.source,license:input.license,durationMs:audio.durationMs,exactArtifactRefs:origin.artifactRefs})
  const asset=ttrpgOpenAudioAssetSnapshotV1(row,body.originSessionKey)
  if(stable(asset)!==stable({...proposed,version:row.version}))p.fail('原准备文件的名称、来源、许可或物理元数据已经变化')
  await loaded.assertCurrent()
  const ticket=issueTtrpgOpenAudioGeneratedTicketV2({scope:input.scope,sessionId:input.sessionId,sessionKey:loaded.runtime.sessionKey,runtimeSourceHash:loaded.session.runtimeSourceHash,
    viewerKey:input.viewerKey,sequence:loaded.state.lastSequence,stateHash:loaded.stateHash,request:cue,asset,assetId:row.id!,generated:origin})
  return {status:'review' as const,review:createReview(input,loaded,cue,asset,choiceKey,undefined,origin,ticket)}
}

/** A fresh current-file read cannot borrow an earlier view's different grant.
 * Synchronous local identity check only; not a new read or playback authority. */
export function ttrpgOpenAudioClipMatchesViewV1(view: TtrpgOpenAudioDeskV1, clipKey: string, blob: Blob): boolean {
  const page = readViews.get(view), file = readClips.get(blob)
  return !!page && !!file && page.body === stable(view) && page.clipKeys.includes(clipKey) && file.clipKey === clipKey
    && page.inputKey === file.inputKey && page.sessionKey === file.sessionKey && page.runtimeSourceHash === file.runtimeSourceHash
    && page.authorizationRevision === file.authorizationRevision
}

/** Only evidence for an already loaded local node; never reads an old Blob to the caller or starts playback.
 * Two exact issued views fence the observed change. Refresh/import/copies cannot recreate these witnesses. */
export async function readTtrpgOpenAudioTransitionsV1(input: TtrpgOpenAudioDeskInputV1 & {
  before: TtrpgOpenAudioDeskV1; after: TtrpgOpenAudioDeskV1; playingClips: readonly { clipKey: string; blob: Blob }[]
}) {
  const current = snapshotInput(input)
  const before = readViews.get(input.before), after = readViews.get(input.after), key = inputKey(current)
  if (!before || !after || input.before === input.after || before.inputKey !== key || after.inputKey !== key
    || before.body !== stable(input.before) || after.body !== stable(input.after)
    || before.sessionKey !== after.sessionKey || before.runtimeSourceHash !== after.runtimeSourceHash
    || before.authorizationRevision !== after.authorizationRevision || before.sequence >= after.sequence) p.fail('音频过渡需要同一本人身份的两次准确本机读取；复制、刷新或导入不能恢复')
  const playing = p.list(input.playingClips, 'caller local playing clips', value => {
    const row = p.record(value, ['clipKey', 'blob'], 'local clip read evidence'), clipKey = p.text(row.clipKey, 'local clip key', 1000)
    if (!before.clipKeys.includes(clipKey)) p.fail('渐变不能借用原视图外的文件或音轨')
    const file = row.blob instanceof Blob ? readClips.get(row.blob) : undefined
    if (!file || file.clipKey !== clipKey || file.inputKey !== key || file.sessionKey !== before.sessionKey
      || file.runtimeSourceHash !== before.runtimeSourceHash || file.authorizationRevision !== before.authorizationRevision) p.fail('音频过渡需要本人实际核验的原 Blob；复制、刷新或导入不能恢复')
    return clipKey
  }, 4, 0)
  p.unique(playing, 'caller local playing clips')
  const loaded = await owner(current), runtime = loaded.runtime
  if (runtime.product.safety.status !== 'active' || loaded.state.lastSequence !== after.sequence || loaded.stateHash !== after.stateHash
    || runtime.sessionKey !== after.sessionKey || loaded.session.runtimeSourceHash !== after.runtimeSourceHash
    || loaded.authorization.revision !== after.authorizationRevision) p.fail('音频过渡的进度、来源、身份或安全状态已变化')
  const receipts = visible(loaded, current.viewerKey)
  const changes = projectTtrpgOpenAudioTransitionsV1({ events: receipts.map(row => row.envelope), authorization: loaded.authorization,
    reader: { kind: 'human', viewerKey: current.viewerKey } })
  const transitions: Array<{ controlRef: TtrpgOpenSourceRefV1; channel: TtrpgOpenAudioRequestV1['channel']; action: 'play' | 'stop';
    fromClipKey: string; toClipKey: string | null; requestedFadeMs: number; fadeMs: number }> = []
  for (const change of changes) {
    if (!change.fromSlotKey || change.controlRef.sessionKey !== runtime.sessionKey || change.controlRef.sequence <= before.sequence) continue
    const from = receipts.find(row => row.request.action === 'play' && row.envelope.event.slotKey === change.fromSlotKey)
    const to = change.toSlotKey ? receipts.find(row => row.request.action === 'play' && row.envelope.event.slotKey === change.toSlotKey) : undefined
    if (!from?.asset || change.toSlotKey && !to?.asset) p.fail('音频过渡缺少原真实可读音轨')
    const fromClipKey = `${change.fromSlotKey}:${from.asset.contentHash}`, toClipKey = to?.asset ? `${change.toSlotKey}:${to.asset.contentHash}` : null
    if (!playing.includes(fromClipKey) || toClipKey !== null && !after.clipKeys.includes(toClipKey)) continue
    // A lost/deleted old physical version cannot gain a longer lifetime through a transition.
    try {
      const { witness } = await readTtrpgOpenAudioMediaWitnessV1({ scope: current.scope, session: loaded.session, expected: from.asset, ...(from.version===2?{exactArtifactRefs:from.generated.artifactRefs}:{}) })
      await assertTtrpgOpenAudioMediaWitnessV1(witness)
    } catch { continue }
    transitions.push({ controlRef: structuredClone(change.controlRef), channel: change.channel, action: change.action, fromClipKey, toClipKey,
      requestedFadeMs: change.fade, fadeMs: Math.min(3000, change.fade) })
  }
  await loaded.assertCurrent()
  return { sequence: after.sequence, stateHash: after.stateHash, transitions }
}

export async function prepareTtrpgOpenAudioUploadV1(input: TtrpgOpenAudioDeskInputV1 & {
  request: TtrpgOpenAudioRequestV1; file: Blob; name: string; source: string; license: string; durationMs: number | null
  decision: 'prepare-this-file-for-reviewed-audio'
}): Promise<TtrpgOpenAudioReviewV1> {
  p.literal(input.decision, 'prepare-this-file-for-reviewed-audio', 'audio file preparation')
  const loaded = await owner(input), request = parseTtrpgOpenAudioRequestV1(input.request)
  assertTtrpgOpenAudioWriteAllowedV1(loaded.runtime, input.viewerKey, 'play')
  if (request.media.kind !== 'upload' || request.action !== 'play') p.fail('上传核对仅适用于这次明确提供的新文件')
  if (!input.file || input.file.size < 1 || input.file.size > 100 * 1024 * 1024) p.fail('音频文件必须在 1 byte 到 100 MiB 之间')
  const data = await input.file.arrayBuffer(), mimeType = p.oneOf(detectProductMediaMimeTypeV1(data), ['audio/wav', 'audio/mpeg', 'audio/ogg'], 'actual audio format')
  const assetKey = await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'audio-asset', [input.viewerKey, request.media.submissionKey])
  const proposed: TtrpgOpenAudioAssetV1 = { originSessionKey: loaded.runtime.sessionKey, assetKey, version: 1, kind: ttrpgOpenAudioKindV1(request.channel),
    name: p.text(input.name, 'audio upload name', 500), mimeType, byteSize: data.byteLength, durationMs: input.durationMs,
    contentHash: await sha256MediaData(data), source: p.text(input.source, 'audio source declaration', 5000), license: p.text(input.license, 'audio license declaration', 5000) }
  // Validate disclosure, settled cause and voice script before storing any imported bytes.
  createTtrpgOpenAudioReceipt({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey, request,
    asset: proposed, sequence: loaded.state.lastSequence + 1, commandId: 'audio.upload.pending', submissionKey: request.media.submissionKey })
  await loaded.assertCurrent()
  const row = await importProductRuntimeMediaAssetV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, assetKey, kind: proposed.kind, name: proposed.name,
    blob: new Blob([data], { type: mimeType }), source: proposed.source, license: proposed.license, durationMs: proposed.durationMs })
  const asset = ttrpgOpenAudioAssetSnapshotV1(row, loaded.runtime.sessionKey)
  if (stable(asset) !== stable({ ...proposed, version: row.version })) p.fail('该上传标识已有不同的原元数据，请重新明确选择文件')
  await loaded.assertCurrent()
  const uploadTicket = issueTtrpgOpenAudioUploadTicketV1({ scope: input.scope, sessionId: input.sessionId, sessionKey: loaded.runtime.sessionKey,
    runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey, sequence: loaded.state.lastSequence, stateHash: loaded.stateHash,
    request, asset, assetId: row.id! })
  return createReview(input, loaded, request, asset, request.media.submissionKey, uploadTicket)
}
export async function prepareTtrpgOpenRetainedAudioV1(input: TtrpgOpenAudioDeskInputV1 & { sourceRef: TtrpgOpenSourceRefV1; submissionKey: string; action: 'play' | 'stop'; fade?: number }): Promise<TtrpgOpenAudioReviewV1> {
  const loaded = await owner(input), original = visible(loaded, input.viewerKey).find(row => row.request.action === 'play' && ttrpgOpenAudioSourceEqualV1(row.envelope.sourceRef, input.sourceRef))
  if (!original) p.fail('本人没有该原音频的读取权限')
  const action = p.oneOf(input.action, ['play','stop'], 'audio retained control')
  const base = {action,channel:original.request.channel,audience:original.request.audience,privateActorKey:original.request.privateActorKey,
    narrationSourceRef:original.request.narrationSourceRef,fade:input.fade??original.request.fade,voiceTimeline:action==='stop'?null:original.request.voiceTimeline,
    media:{kind:action==='stop'?'stop':'retained',sourceRef:original.envelope.sourceRef}}
  const request = original.version===2 && action==='play' ? parseTtrpgOpenAudioRequestV2({...base,version:2}) : parseTtrpgOpenAudioRequestV1(base)
  const result = createReview(input,loaded,request,action==='stop'?null:original.asset,p.key(input.submissionKey,'retained audio submission'),undefined,
    original.version===2&&action==='play'?original.generated:undefined)
  await loaded.assertCurrent(); return result
}
export async function confirmTtrpgOpenAudioReviewV1(input: TtrpgOpenAudioDeskInputV1 & { review: TtrpgOpenAudioReviewV1; decision: 'confirm-this-audio-and-audience' }): Promise<{ sequence: number }> {
  p.literal(input.decision, 'confirm-this-audio-and-audience', 'audio explicit confirmation')
  const saved = reviews.get(input.review)
  if (!saved || stable(saved.input) !== stable({ scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey }) || saved.body !== stable(input.review)) p.fail('请在当前本人页面重新核对音频；复制或刷新不能恢复未保存的确认')
  return applyTtrpgOpenAudioCueV1({ sessionId: input.sessionId, viewerKey: input.viewerKey, submissionKey: saved.submissionKey, request: input.review.request,
    baseSequence: input.review.sequence, baseStateHash: saved.baseStateHash, commandId: 'audio.explicit.confirmation', decision: input.decision,
    ...(saved.uploadTicket ? { uploadTicket: saved.uploadTicket } : {}), ...(saved.generatedTicket ? { generatedTicket: saved.generatedTicket } : {}) })
}
export async function readTtrpgOpenAudioClipV1(request: TtrpgOpenAudioDeskInputV1 & { sourceRef: TtrpgOpenSourceRefV1; expectedClipKey: string }): Promise<{ blob: Blob; slotKey: string }> {
  const input = { ...snapshotInput(request), sourceRef: structuredClone(request.sourceRef), expectedClipKey: p.text(request.expectedClipKey, 'expected current clip', 1000) }
  const loaded = await owner(input)
  if (loaded.runtime.product.safety.status !== 'active') p.fail('暂停期间不能读取新播放文件')
  const track = active(loaded, input.viewerKey).find(row => ttrpgOpenAudioSourceEqualV1(row.receipt.envelope.sourceRef, input.sourceRef))
  if (!track?.receipt.asset || `${track.cue.slotKey}:${track.receipt.asset.contentHash}` !== input.expectedClipKey) p.fail('音轨已变化或本人没有当前播放权限')
  const { data } = await readTtrpgOpenAudioMediaWitnessV1({ scope: input.scope, session: loaded.session, expected: track.receipt.asset, ...(track.receipt.version===2?{exactArtifactRefs:track.receipt.generated.artifactRefs}:{}) })
  await loaded.assertCurrent()
  const blob = new Blob([data], { type: track.receipt.asset.mimeType })
  readClips.set(blob, { inputKey: inputKey(input), sessionKey: loaded.runtime.sessionKey, runtimeSourceHash: loaded.session.runtimeSourceHash,
    authorizationRevision: loaded.authorization.revision, clipKey: `${track.cue.slotKey}:${track.receipt.asset.contentHash}` })
  return { blob, slotKey: track.cue.slotKey }
}

export { reserveTtrpgOpenVoiceRequestV1, cancelTtrpgOpenVoiceRequestV1, readTtrpgOpenVoiceRequestDeskV1 } from './open-voice-request-service'
export { readTtrpgOpenLocalVoiceJobV1 } from './open-voice-job-service'
export { freezeTtrpgOpenVoiceSourceEvidenceV1 } from './open-voice-source-evidence'
export { acceptTtrpgOpenVoiceCandidateReviewV1, readTtrpgOpenVoiceCandidateReviewV1,
  rejectTtrpgOpenVoiceCandidateReviewV1, readTtrpgOpenVoiceCandidateRejectionV1 } from './open-voice-review-service'
export { resumeTtrpgOpenVoiceCandidateReviewV1 } from './open-voice-review-recovery'
export { stopTtrpgOpenLocalVoiceJobV1 } from './open-voice-job-stop'
export { recoverTtrpgOpenLocalVoiceRawV1 } from './open-voice-raw-recovery'
export { prepareTtrpgOpenVoiceCandidateV1, readTtrpgOpenVoiceCandidateV1 } from './open-voice-candidate'
export { prepareTtrpgOpenVoiceAuditionV1, observeTtrpgOpenVoiceAuditionV1 } from './open-voice-audition'

export { recoverTtrpgOpenVoiceIntentV1 } from './open-voice-intent-receipt'
export { prepareTtrpgOpenLocalVoiceExecutionV1, readTtrpgOpenLocalVoicePreparationV1, generateTtrpgOpenLocalVoiceV1 } from './open-voice-execution'
