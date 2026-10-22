import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1, audioWavFixtureV1 } from '../helpers/open-audio-runtime'
import { readTtrpgOpenAudioDeskV1, prepareTtrpgOpenAudioUploadV1, prepareTtrpgOpenRetainedAudioV1, confirmTtrpgOpenAudioReviewV1, readTtrpgOpenAudioClipV1 } from '../../src/lib/ttrpg/open-audio-service'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { sha256MediaData, collectUnreferencedMediaBlobObjects } from '../../src/lib/product-production/media-blob-store'
import { verifyTtrpgOpenAudioReceiptsV1 } from '../../src/lib/ttrpg/open-audio-proof'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { loadTtrpgOpenBriefContextV1 } from '../../src/lib/ttrpg/open-brief-context'

type Setup = Awaited<ReturnType<typeof setupAudioRuntimeV1>>
async function prepare(s: Setup, id = 'one', channel: Parameters<Setup['request']>[1] = 'music', audience: Parameters<Setup['request']>[2] = 'party') {
  return prepareTtrpgOpenAudioUploadV1({ ...s.owner, request: s.request(id, channel, audience), file: audioWavFixtureV1(), name: '工程静音样本', source: '确定性测试生成的 PCM 样本',
    license: '仅工程验证；不作为商业音频验收', durationMs: 250, decision: 'prepare-this-file-for-reviewed-audio' })
}
async function confirm(s: Setup, review: Awaited<ReturnType<typeof prepare>>) { return confirmTtrpgOpenAudioReviewV1({ ...s.owner, review, decision: 'confirm-this-audio-and-audience' }) }
function mechanical(state: Awaited<ReturnType<typeof readProductRuntimeState>>) {
  const runtime = rt(state), { audioReceipts: _audio, ...run } = runtime.openRun!
  const { lastSequence: _sequence, ...rest } = state
  return { ...rest, ttrpg: { ...runtime, openRun: run } }
}
async function clip(owner: Setup['owner']) {
  const view = await readTtrpgOpenAudioDeskV1(owner), track = view.tracks[0]
  return readTtrpgOpenAudioClipV1({ ...owner, sourceRef: track.sourceRef, expectedClipKey: track.clipKey })
}
describe('R-TTRPGOPEN10 actual E16, licensed upload, recovery and media ownership', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('imports only after explicit file preparation, keeps play pending and confirms one exact event without changing settlement', async () => {
    const s = await setupAudioRuntimeV1(), before = await readProductRuntimeState(s.owner.sessionId), n = await db.productRuntimeEvents.count(), models = await db.agentRuns.count()
    const review = await prepare(s)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(n)
    expect((await readTtrpgOpenAudioDeskV1(s.owner)).tracks).toEqual([]); expect(await db.productMediaAssets.count()).toBe(1)
    await expect(confirm(s, structuredClone(review))).rejects.toThrow(/重新核对/)
    const result = await confirm(s, review); expect(Object.keys(result)).toEqual(['sequence']); expect(await confirm(s, review)).toEqual(result)
    const after = await readProductRuntimeState(s.owner.sessionId)
    expect(mechanical(after)).toEqual(mechanical(before)); expect(await db.productRuntimeEvents.count()).toBe(n + 1); expect(await db.agentRuns.count()).toBe(models)
    const view = await readTtrpgOpenAudioDeskV1(s.owner), bytes = await (await clip(s.owner)).blob.arrayBuffer()
    expect(view.tracks).toHaveLength(1); expect(await sha256MediaData(bytes)).toBe(review.asset!.contentHash)
    expect(JSON.stringify(view.tracks)).not.toContain('license'); expect(await sha256MediaData(await audioWavFixtureV1().arrayBuffer())).toBe(review.asset!.contentHash)
  })
  it('plays four independent channels, preserves public music under a private overlay and restores it after the exact stop', async () => {
    const s = await setupAudioRuntimeV1()
    await confirm(s, await prepare(s, 'public', 'music', 'public'))
    const privateReview = await prepare(s, 'private', 'music', 'private'); await confirm(s, privateReview)
    const view = await readTtrpgOpenAudioDeskV1(s.owner), privateTrack = view.tracks.find(t => t.channel === 'music')!
    expect(privateTrack.audience).toBe('private')
    const stop = await prepareTtrpgOpenRetainedAudioV1({ ...s.owner, sourceRef: privateTrack.sourceRef, submissionKey: 'stop.private', action: 'stop' }); await confirm(s, stop)
    expect((await readTtrpgOpenAudioDeskV1(s.owner)).tracks[0].audience).toBe('public')
    for (const channel of ['ambience', 'sfx', 'voice'] as const) await confirm(s, await prepare(s, `channel.${channel}`, channel))
    expect((await readTtrpgOpenAudioDeskV1(s.owner)).tracks).toHaveLength(4)
    const player = await readTtrpgOpenAudioDeskV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER })
    expect(player.library).toEqual([]); expect(player.causes).toEqual([]); expect(player.canPlay).toBe(false)
    expect(player.tracks.find(t => t.channel === 'voice')?.fallbackText).toBe(s.text)
  })
  it('supports an explicit common upload by the AI-host human fallback but denies GM/private scope and unaccepted voice text', async () => {
    const s = await setupAudioRuntimeV1(false)
    await confirm(s, await prepare(s)); expect((await readTtrpgOpenAudioDeskV1(s.owner)).tracks).toHaveLength(1)
    const count = await db.productMediaAssets.count()
    await expect(prepare(s, 'secret', 'music', 'gm-only')).rejects.toThrow(/实际真人 GM/)
    await expect(prepare(s, 'private', 'voice', 'private')).rejects.toThrow(/实际真人 GM/)
    await expect(prepare(s, 'public.voice', 'voice', 'public')).rejects.toThrow(/扩大原全队/)
    const request = s.request('false.voice', 'voice'); request.voiceTimeline!.marks[0].textLength = 1
    await expect(prepareTtrpgOpenAudioUploadV1({ ...s.owner, request, file: audioWavFixtureV1(), name: 'voice', source: 'test', license: 'test', durationMs: 250, decision: 'prepare-this-file-for-reviewed-audio' })).rejects.toThrow(/覆盖全文/)
    expect(await db.productMediaAssets.count()).toBe(count)
  })
  it('retains the exact pending review after storage rollback and a lost commit return, with no duplicate event or physical binding', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepare(s)
    const save = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('audio storage rollback'))
    const before = await readProductRuntimeState(s.owner.sessionId)
    await expect(confirm(s, review)).rejects.toThrow(/audio storage rollback/); expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(before)
    save.mockRestore()
    const transaction = db.transaction.bind(db)
    const lost = vi.spyOn(db, 'transaction').mockImplementationOnce(async (...args: Parameters<typeof db.transaction>) => {
      await transaction(...args); throw new Error('audio committed response lost')
    })
    await expect(confirm(s, review)).rejects.toThrow(/committed response lost/); lost.mockRestore()
    const result = { sequence: (await readProductRuntimeState(s.owner.sessionId)).lastSequence }
    expect(await confirm(s, review)).toEqual(result); expect(await db.productMediaBlobs.count()).toBe(1)
    expect((await db.productRuntimeEvents.where('sessionId').equals(s.owner.sessionId).toArray()).filter(row => row.type === 'ttrpg.audio.cue.applied')).toHaveLength(1)
  })
  it('refuses a changed review, wrong owner, stale source and a real asset race at the formal transaction', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepare(s)
    await expect(confirmTtrpgOpenAudioReviewV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER, review, decision: 'confirm-this-audio-and-audience' })).rejects.toThrow(/重新核对/)
    const originalName = review.asset!.name; review.asset!.name = 'benign forged label'
    await expect(confirm(s, review)).rejects.toThrow(/重新核对/); review.asset!.name = originalName
    const add = db.transaction.bind(db), asset = (await db.productMediaAssets.toArray())[0]
    let changed = false
    const tx = vi.spyOn(db, 'transaction').mockImplementation((...args: Parameters<typeof db.transaction>) => {
      if (!changed && Array.isArray(args[1]) && args[1].includes(db.productRuntimeEvents) && args[1].includes(db.productMediaAssets)) {
        changed = true
        return db.productMediaAssets.update(asset.id!, { license: 'changed after actual byte preflight' }).then(() => add(...args)) as ReturnType<typeof db.transaction>
      }
      return add(...args)
    })
    await expect(confirm(s, review)).rejects.toThrow(/提交期间发生变化/); tx.mockRestore()
    expect((await readTtrpgOpenAudioDeskV1(s.owner)).tracks).toEqual([])
    await db.productMediaAssets.update(asset.id!, { license: review.asset!.license })
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'stale.audio.pause'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: '原核对之后的真实变化' })
    await expect(confirm(s, review)).rejects.toThrow(/战役状态已变化/)
  })
  it('fails audio-byte delivery to text without altering rules and permits a paused exact stop while refusing new play', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepare(s); await confirm(s, review)
    const before = await readProductRuntimeState(s.owner.sessionId), object = (await db.mediaBlobObjects.toArray())[0]
    await db.mediaBlobObjects.update(object.id!, { data: new Uint8Array([1, 2, 3]).buffer })
    await expect(clip(s.owner)).rejects.toThrow(/大小不匹配|哈希不匹配/)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(before)
    const track = (await readTtrpgOpenAudioDeskV1(s.owner)).tracks[0]
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'audio.pause'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: 'audio test pause' })
    await expect(prepare(s, 'paused')).rejects.toThrow(/暂停/)
    await expect(clip(s.owner)).rejects.toThrow(/暂停/)
    const stop = await prepareTtrpgOpenRetainedAudioV1({ ...s.owner, sourceRef: track.sourceRef, submissionKey: 'paused.stop', action: 'stop' }); await confirm(s, stop)
    expect((await readTtrpgOpenAudioDeskV1(s.owner)).tracks).toEqual([])
  })
  it('clones only committed cutpoint versions, survives parent deletion and complete backup, and keeps new playback approval local', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepare(s); await confirm(s, review)
    const state = await readProductRuntimeState(s.owner.sessionId)
    const future = await prepareTtrpgOpenAudioUploadV1({ ...s.owner, request: s.request('future.audio', 'sfx'), file: audioWavFixtureV1(500), name: '未来切点的样本', source: 'test PCM',
      license: 'engineering only', durationMs: 500, decision: 'prepare-this-file-for-reviewed-audio' })
    await confirm(s, future); await prepare(s, 'unconfirmed.audio')
    const child = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: state.lastSequence, title: 'audio child' })
    const childOwner = { ...s.owner, sessionId: child.id! }, before = rt(await readProductRuntimeState(child.id!))
    await expect(readTtrpgOpenAudioDeskV1(childOwner)).rejects.toThrow(/授权/)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'audio.child.zero'), viewerKey: s.owner.viewerKey,
      acceptedItemKeys: before.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    expect((await db.productMediaAssets.where('productRuntimeSessionId').equals(child.id!).toArray()).map(a => a.contentHash)).toEqual([review.asset!.contentHash])
    await deleteProductRuntimeSession(s.owner.sessionId); await collectUnreferencedMediaBlobObjects({ scope: s.owner.scope })
    expect((await (await clip(childOwner)).blob.arrayBuffer()).byteLength).toBe(review.asset!.byteSize)
    const projectId = await importProjectJSON(await exportProjectJSON(s.owner.scope.projectId))
    const copied = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const copiedOwner = { scope: { projectId, worldId: copied.worldId, workId: copied.workId }, sessionId: copied.id!, viewerKey: s.owner.viewerKey }
    expect((await (await clip(copiedOwner)).blob.arrayBuffer()).byteLength).toBe(review.asset!.byteSize)
    await expect(confirmTtrpgOpenAudioReviewV1({ ...copiedOwner, review, decision: 'confirm-this-audio-and-audience' })).rejects.toThrow(/重新核对/)
    const copiedState = rt(await readProductRuntimeState(copied.id!))
    await verifyTtrpgOpenAudioReceiptsV1({ runtime: copiedState, runtimeSourceHash: copied.runtimeSourceHash, events: await db.productRuntimeEvents.where('sessionId').equals(copied.id!).toArray() })
  })
  it('keeps historical party/private files unavailable when an original AI seat is explicitly claimed by a human in a child', async () => {
    const s = await setupAudioRuntimeV1()
    await confirm(s, await prepare(s, 'party.original'))
    await confirm(s, await prepare(s, 'public.original', 'music', 'public'))
    await confirm(s, await prepare(s, 'private.original', 'music', 'private'))
    const parent = await readProductRuntimeState(s.owner.sessionId), child = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: parent.lastSequence, title: 'new audio listener' })
    const row = (await readTtrpgSessionParticipantsV2(child.id!)).find(p => p.actorKey === 'companion.1')!
    await configureTtrpgSessionParticipantV2({ sessionId: child.id!, seatKey: row.seatKey, expectedRevision: row.revision, commandId: 'audio.claim.ai-seat', requestedByViewerKey: row.viewerKey,
      controller: 'hybrid', assignmentState: 'claimed' })
    const current = rt(await readProductRuntimeState(child.id!))
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'new.audio.zero'), viewerKey: s.owner.viewerKey,
      acceptedItemKeys: current.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    const newOwner = { ...s.owner, sessionId: child.id!, viewerKey: row.viewerKey }, page = await readTtrpgOpenAudioDeskV1(newOwner)
    expect(page.tracks).toHaveLength(1); expect(page.tracks[0].audience).toBe('public'); expect(page.library).toEqual([])
    const gm = { ...s.owner, sessionId: child.id! }, gmPage = await readTtrpgOpenAudioDeskV1(gm), party = gmPage.library.find(r => r.audience === 'party')!
    await expect(prepareTtrpgOpenRetainedAudioV1({ ...gm, sourceRef: party.sourceRef, submissionKey: 'no-new-listeners', action: 'play' })).rejects.toThrow(/扩大原音频/)
    const privateSource = gmPage.library.find(r => r.audience === 'private')!.sourceRef
    await expect(readTtrpgOpenAudioClipV1({ ...newOwner, sourceRef: privateSource, expectedClipKey: page.tracks[0].clipKey })).rejects.toThrow(/当前播放权限/)
  })
  it('does not feed file metadata into actor or common recap input, and rejects a forged unassigned playback slot', async () => {
    const s = await setupAudioRuntimeV1(false), input = { scope: s.owner.scope, sessionId: s.owner.sessionId }
    const actorBefore = await loadTtrpgOpenPlayerContextV1({ ...input, actorKey: 'hero' }), briefBefore = await loadTtrpgOpenBriefContextV1({ ...input, actorKey: 'gm' })
    const before = await readProductRuntimeState(s.owner.sessionId)
    const review = await prepareTtrpgOpenAudioUploadV1({ ...s.owner, request: s.request('metadata.boundary'), file: audioWavFixtureV1(), name: 'AUDIO-PRIVATE-NAME-CANARY',
      source: 'AUDIO-UNTRUSTED-SOURCE-CANARY', license: 'AUDIO-LICENSE-PROMPT-CANARY', durationMs: 250, decision: 'prepare-this-file-for-reviewed-audio' })
    await confirm(s, review)
    const actor = await loadTtrpgOpenPlayerContextV1({ ...input, actorKey: 'hero' }), brief = await loadTtrpgOpenBriefContextV1({ ...input, actorKey: 'gm' })
    expect(actor.view).toEqual(actorBefore.view); expect(brief.resources).toEqual(briefBefore.resources)
    expect(JSON.stringify([actor.view, brief.resources])).not.toContain('AUDIO-')
    const event = (await db.productRuntimeEvents.where('sessionId').equals(s.owner.sessionId).sortBy('sequence')).at(-1)!, payload = JSON.parse(event.payloadJson)
    payload.receipt.envelope.event.slotKey = 'unknown.audio.slot'
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/音频事件与真实/)
  })
  it.each(['license', 'binding', 'object'] as const)('rolls back the entire child when its original %s binding no longer closes', async failure => {
    const s = await setupAudioRuntimeV1(); await confirm(s, await prepare(s))
    const state = await readProductRuntimeState(s.owner.sessionId), sessions = await db.productRuntimeSessions.count(), assets = await db.productMediaAssets.count()
    if (failure === 'license') await db.productMediaAssets.update((await db.productMediaAssets.toArray())[0].id!, { license: 'a different declaration' })
    if (failure === 'binding') await db.productMediaBlobs.clear()
    if (failure === 'object') await db.mediaBlobObjects.clear()
    await expect(branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: state.lastSequence, title: 'must not create partial audio child' })).rejects.toThrow(/分支|媒资/)
    expect(await db.productRuntimeSessions.count()).toBe(sessions); expect(await db.productMediaAssets.count()).toBe(assets)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(state)
  })
  it('can explicitly stop inherited public sound after new public-sharing consent is withdrawn, without granting a replay', async () => {
    const s = await setupAudioRuntimeV1(); await confirm(s, await prepare(s, 'public.original', 'music', 'public'))
    const state = await readProductRuntimeState(s.owner.sessionId), child = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: state.lastSequence, title: 'stop despite new privacy choice' })
    const hero = (await readTtrpgSessionParticipantsV2(child.id!)).find(row => row.actorKey === 'hero')!
    await configureTtrpgSessionParticipantV2({ sessionId: child.id!, seatKey: hero.seatKey, expectedRevision: hero.revision, requestedByViewerKey: hero.viewerKey,
      commandId: 'decline.new.public.audio', consent: { publicSharingAllowed: false } })
    const runtime = rt(await readProductRuntimeState(child.id!)), owner = { ...s.owner, sessionId: child.id! }
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'privacy.audio.zero'), viewerKey: owner.viewerKey,
      acceptedItemKeys: runtime.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    const original = (await readTtrpgOpenAudioDeskV1(owner)).tracks[0]
    await expect(prepareTtrpgOpenRetainedAudioV1({ ...owner, sourceRef: original.sourceRef, submissionKey: 'no.replay', action: 'play' })).rejects.toThrow(/公开分享/)
    const stop = await prepareTtrpgOpenRetainedAudioV1({ ...owner, sourceRef: original.sourceRef, submissionKey: 'allowed.stop', action: 'stop' })
    await confirmTtrpgOpenAudioReviewV1({ ...owner, review: stop, decision: 'confirm-this-audio-and-audience' })
    expect((await readTtrpgOpenAudioDeskV1(owner)).tracks).toEqual([]); expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(state)
  })
})
