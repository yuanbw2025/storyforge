/** Human audio desk. Reads never generate, import, confirm or play; file import is explicit. */
// The existing audio service remains the public domain boundary for both
// licensed files and human-only script review. Source review grants no dispatch.
export { prepareTtrpgOpenVoiceScriptV1, readTtrpgOpenReviewedVoiceScriptV1 } from './open-voice-script-service'
export type { TtrpgOpenVoiceScriptReviewV1 } from './open-voice-script-service'
import { loadTtrpgOpenAudioReadStateV1 as owner, type TtrpgOpenAudioReadInputV1 } from './open-audio-read-state'
import { assertTtrpgOpenAudioWriteAllowedV1, createTtrpgOpenAudioReceiptV1, parseTtrpgOpenAudioRequestV1, ttrpgOpenAudioKindV1,
  ttrpgOpenAudioNarrationV1, ttrpgOpenAudioReceiptVisibleV1, ttrpgOpenAudioSourceEqualV1,
  type TtrpgOpenAudioRequestV1, type TtrpgOpenAudioAssetV1, type TtrpgOpenAudioReceiptV1 } from './open-audio-contract'
import { projectTtrpgOpenScopedAudioV1, projectTtrpgOpenAudioTransitionsV1 } from './open-audio-scope'
import { issueTtrpgOpenAudioUploadTicketV1, readTtrpgOpenAudioMediaWitnessV1, assertTtrpgOpenAudioMediaWitnessV1, ttrpgOpenAudioAssetSnapshotV1,
  type TtrpgOpenAudioUploadTicketV1 } from './open-audio-media'
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
  sessionId: number; viewerKey: string; sequence: number; request: TtrpgOpenAudioRequestV1
  asset: TtrpgOpenAudioAssetV1 | null; recipients: string[]; fallbackText: string
}
interface ReviewOwner { input: TtrpgOpenAudioDeskInputV1; body: string; baseStateHash: string; submissionKey: string; uploadTicket?: TtrpgOpenAudioUploadTicketV1 }
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
function receiverLabels(loaded: Loaded, receipt: TtrpgOpenAudioReceiptV1) {
  return receipt.envelope.scope.recipients.map(row => row.role === 'gm' ? '主持' : loaded.state.entities[row.actorKey!]?.name ?? '原角色')
}
function createReview(input: TtrpgOpenAudioDeskInputV1, loaded: Loaded, request: TtrpgOpenAudioRequestV1, asset: TtrpgOpenAudioAssetV1 | null,
  submissionKey: string, uploadTicket?: TtrpgOpenAudioUploadTicketV1) {
  const receipt = createTtrpgOpenAudioReceiptV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey,
    request, asset, sequence: loaded.state.lastSequence + 1, commandId: 'audio.review.pending', submissionKey })
  const review: TtrpgOpenAudioReviewV1 = { schema: 'storyforge.ttrpg-open-audio-review', version: 1, reviewKey: crypto.randomUUID(), sessionId: input.sessionId, viewerKey: input.viewerKey,
    sequence: loaded.state.lastSequence, request: structuredClone(request), asset: asset ? structuredClone(asset) : null, recipients: receiverLabels(loaded, receipt), fallbackText: receipt.envelope.event.fallbackText }
  reviews.set(review, { input: { scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey }, body: stable(review), baseStateHash: loaded.stateHash, submissionKey, ...(uploadTicket ? { uploadTicket } : {}) })
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
    voiceMarks: cue.voiceTimeline?.marks ?? null }))
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
      const { witness } = await readTtrpgOpenAudioMediaWitnessV1({ scope: current.scope, session: loaded.session, expected: from.asset })
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
  createTtrpgOpenAudioReceiptV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey, request,
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
  const action = p.oneOf(input.action, ['play', 'stop'], 'audio retained control'), request = parseTtrpgOpenAudioRequestV1({ ...original.request, action,
    ...(input.fade === undefined ? {} : { fade: input.fade }),
    media: { kind: action === 'stop' ? 'stop' : 'retained', sourceRef: original.envelope.sourceRef }, voiceTimeline: action === 'stop' ? null : original.request.voiceTimeline })
  const result = createReview(input, loaded, request, action === 'stop' ? null : original.asset, p.key(input.submissionKey, 'retained audio submission'))
  await loaded.assertCurrent(); return result
}
export async function confirmTtrpgOpenAudioReviewV1(input: TtrpgOpenAudioDeskInputV1 & { review: TtrpgOpenAudioReviewV1; decision: 'confirm-this-audio-and-audience' }): Promise<{ sequence: number }> {
  p.literal(input.decision, 'confirm-this-audio-and-audience', 'audio explicit confirmation')
  const saved = reviews.get(input.review)
  if (!saved || stable(saved.input) !== stable({ scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey }) || saved.body !== stable(input.review)) p.fail('请在当前本人页面重新核对音频；复制或刷新不能恢复未保存的确认')
  return applyTtrpgOpenAudioCueV1({ sessionId: input.sessionId, viewerKey: input.viewerKey, submissionKey: saved.submissionKey, request: input.review.request,
    baseSequence: input.review.sequence, baseStateHash: saved.baseStateHash, commandId: 'audio.explicit.confirmation', decision: input.decision,
    ...(saved.uploadTicket ? { uploadTicket: saved.uploadTicket } : {}) })
}
export async function readTtrpgOpenAudioClipV1(request: TtrpgOpenAudioDeskInputV1 & { sourceRef: TtrpgOpenSourceRefV1; expectedClipKey: string }): Promise<{ blob: Blob; slotKey: string }> {
  const input = { ...snapshotInput(request), sourceRef: structuredClone(request.sourceRef), expectedClipKey: p.text(request.expectedClipKey, 'expected current clip', 1000) }
  const loaded = await owner(input)
  if (loaded.runtime.product.safety.status !== 'active') p.fail('暂停期间不能读取新播放文件')
  const track = active(loaded, input.viewerKey).find(row => ttrpgOpenAudioSourceEqualV1(row.receipt.envelope.sourceRef, input.sourceRef))
  if (!track?.receipt.asset || `${track.cue.slotKey}:${track.receipt.asset.contentHash}` !== input.expectedClipKey) p.fail('音轨已变化或本人没有当前播放权限')
  const { data } = await readTtrpgOpenAudioMediaWitnessV1({ scope: input.scope, session: loaded.session, expected: track.receipt.asset })
  await loaded.assertCurrent()
  const blob = new Blob([data], { type: track.receipt.asset.mimeType })
  readClips.set(blob, { inputKey: inputKey(input), sessionKey: loaded.runtime.sessionKey, runtimeSourceHash: loaded.session.runtimeSourceHash,
    authorizationRevision: loaded.authorization.revision, clipKey: `${track.cue.slotKey}:${track.receipt.asset.contentHash}` })
  return { blob, slotKey: track.cue.slotKey }
}

export { reserveTtrpgOpenVoiceRequestV1, cancelTtrpgOpenVoiceRequestV1, readTtrpgOpenVoiceRequestDeskV1 } from './open-voice-request-service'
