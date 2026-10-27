import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1, audioWavFixtureV1 } from '../helpers/open-audio-runtime'
import { readTtrpgOpenAudioDeskV1, readTtrpgOpenAudioTransitionsV1, ttrpgOpenAudioClipMatchesViewV1, prepareTtrpgOpenAudioUploadV1, prepareTtrpgOpenRetainedAudioV1, confirmTtrpgOpenAudioReviewV1, readTtrpgOpenAudioClipV1 } from '../../src/lib/ttrpg/open-audio-service'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

type Setup = Awaited<ReturnType<typeof setupAudioRuntimeV1>>
async function upload(s: Setup, key: string, fade = 0, audience: 'party' | 'public' | 'private' | 'gm-only' = 'party') {
  const review = await prepareTtrpgOpenAudioUploadV1({ ...s.owner, request: { ...s.request(key, 'music', audience), fade }, file: audioWavFixtureV1(), name: key,
    source: 'ENGINEERING-ONLY-TRANSITION-SOURCE', license: '工程样本，不作供应方或真人验收', durationMs: 250, decision: 'prepare-this-file-for-reviewed-audio' })
  await confirmTtrpgOpenAudioReviewV1({ ...s.owner, review, decision: 'confirm-this-audio-and-audience' }); return review
}
const clips = new WeakMap<object, Array<{ clipKey: string; blob: Blob }>>()
async function readView(owner: Setup['owner']) {
  const view = await readTtrpgOpenAudioDeskV1(owner)
  clips.set(view, await Promise.all(view.tracks.map(async row => ({ clipKey: row.clipKey, blob: (await readTtrpgOpenAudioClipV1({ ...owner, sourceRef: row.sourceRef, expectedClipKey: row.clipKey })).blob }))))
  return view
}
const request = (s: Setup, before: Awaited<ReturnType<typeof readTtrpgOpenAudioDeskV1>>, after: typeof before) => ({ ...s.owner, before, after, playingClips: clips.get(before)! })
describe('R-TTRPGOPEN10 actual visible audio transition read evidence', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('binds a real replacement to exact before/after views, current receiver and file without importing, starting, calling a model or writing gameplay', async () => {
    const s = await setupAudioRuntimeV1(); await upload(s, 'old')
    // Callers may reuse/mutate their descriptor while IDB is pending. All three
    // reads must bind the original scope, viewer and exact requested clip.
    const viewInput = structuredClone(s.owner), pendingView = readTtrpgOpenAudioDeskV1(viewInput)
    viewInput.viewerKey = OPEN_HUMAN_VIEWER; viewInput.scope.projectId = -1
    const before = await pendingView, track = before.tracks[0]
    expect(before.viewerKey).toBe(s.owner.viewerKey)
    const clipInput = { ...structuredClone(s.owner), sourceRef: structuredClone(track.sourceRef), expectedClipKey: track.clipKey }
    const pendingClip = readTtrpgOpenAudioClipV1(clipInput)
    clipInput.viewerKey = OPEN_HUMAN_VIEWER; clipInput.scope.projectId = -1; clipInput.expectedClipKey = 'forged.clip'; clipInput.sourceRef.sequence++
    clips.set(before, [{ clipKey: track.clipKey, blob: (await pendingClip).blob }])
    await upload(s, 'new', 60000)
    const after = await readView(s.owner), state = await readProductRuntimeState(s.owner.sessionId), events = await db.productRuntimeEvents.count(), assets = await db.productMediaAssets.count(), models = await db.agentRuns.count()
    expect(ttrpgOpenAudioClipMatchesViewV1(after, after.tracks[0].clipKey, clips.get(after)![0].blob)).toBe(true)
    expect(ttrpgOpenAudioClipMatchesViewV1(structuredClone(after), after.tracks[0].clipKey, clips.get(after)![0].blob)).toBe(false)
    expect(ttrpgOpenAudioClipMatchesViewV1(after, track.clipKey, clips.get(before)![0].blob)).toBe(false)
    const transitionInput = { ...request(s, before, after), scope: structuredClone(s.owner.scope) }
    const pendingTransition = readTtrpgOpenAudioTransitionsV1(transitionInput)
    transitionInput.viewerKey = OPEN_HUMAN_VIEWER; transitionInput.scope.projectId = -1
    const evidence = await pendingTransition
    expect(evidence).toMatchObject({ sequence: after.sequence, transitions: [{ channel: 'music', action: 'play', fromClipKey: before.tracks[0].clipKey, toClipKey: after.tracks[0].clipKey, requestedFadeMs: 60000, fadeMs: 3000 }] })
    expect(JSON.stringify(evidence)).not.toMatch(/ENGINEERING-ONLY|license|mimeType|blob|viewerKey|fallbackText/)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(state); expect(await db.productRuntimeEvents.count()).toBe(events); expect(await db.productMediaAssets.count()).toBe(assets); expect(await db.agentRuns.count()).toBe(models)
    await expect(readTtrpgOpenAudioClipV1({ ...s.owner, sourceRef: before.tracks[0].sourceRef, expectedClipKey: before.tracks[0].clipKey })).rejects.toThrow(/已变化|权限/)
  })
  it('preserves the exact stop fade and rejects copied, modified, foreign-owner or unobserved clip views', async () => {
    const s = await setupAudioRuntimeV1(); await upload(s, 'stop.original')
    const before = await readView(s.owner), track = before.tracks[0]
    const otherViewer = await readView({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER })
    expect(ttrpgOpenAudioClipMatchesViewV1(before, track.clipKey, clips.get(otherViewer)![0].blob)).toBe(false)
    const review = await prepareTtrpgOpenRetainedAudioV1({ ...s.owner, sourceRef: track.sourceRef, action: 'stop', fade: 1000, submissionKey: 'stop.exact.fade' })
    expect(review.request.fade).toBe(1000)
    await confirmTtrpgOpenAudioReviewV1({ ...s.owner, review, decision: 'confirm-this-audio-and-audience' })
    const after = await readView(s.owner), input = request(s, before, after)
    expect((await readTtrpgOpenAudioTransitionsV1(input)).transitions).toMatchObject([{ action: 'stop', fromClipKey: track.clipKey, toClipKey: null, fadeMs: 1000 }])
    await expect(readTtrpgOpenAudioTransitionsV1({ ...input, before: structuredClone(before) })).rejects.toThrow(/准确本机读取/)
    await expect(readTtrpgOpenAudioTransitionsV1({ ...input, after: structuredClone(after) })).rejects.toThrow(/准确本机读取/)
    await expect(readTtrpgOpenAudioTransitionsV1({ ...input, playingClips: [{ clipKey: track.clipKey, blob: new Blob([await clips.get(before)![0].blob.arrayBuffer()]) }] })).rejects.toThrow(/实际核验/)
    await expect(readTtrpgOpenAudioTransitionsV1({ ...input, playingClips: clips.get(otherViewer)! })).rejects.toThrow(/实际核验/)
    await expect(readTtrpgOpenAudioTransitionsV1({ ...input, viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/准确本机读取/)
    await expect(readTtrpgOpenAudioTransitionsV1({ ...input, playingClips: [{ clipKey: 'invented.clip', blob: clips.get(before)![0].blob }] })).rejects.toThrow(/原视图外/)
    before.tracks[0].fade = 999
    await expect(readTtrpgOpenAudioTransitionsV1(input)).rejects.toThrow(/准确本机读取/)
  })
  it('retains a real zero-fade change as immediate-cut evidence without giving the old file a tail', async () => {
    const s = await setupAudioRuntimeV1(); await upload(s, 'zero.old')
    const before = await readView(s.owner)
    await upload(s, 'zero.new')
    const after = await readView(s.owner)
    expect((await readTtrpgOpenAudioTransitionsV1(request(s, before, after))).transitions).toMatchObject([
      { action: 'play', fromClipKey: before.tracks[0].clipKey, toClipKey: after.tracks[0].clipKey, requestedFadeMs: 0, fadeMs: 0 },
    ])
  })
  it('does not let an obsolete stop or a hidden cue claim a change in a different listener current music', async () => {
    const s = await setupAudioRuntimeV1(); await upload(s, 'public', 0, 'public')
    const old = (await readView(s.owner)).tracks[0]
    await upload(s, 'replacement', 1000, 'public')
    const before = await readView(s.owner)
    const stop = await prepareTtrpgOpenRetainedAudioV1({ ...s.owner, sourceRef: old.sourceRef, action: 'stop', fade: 3000, submissionKey: 'old.noop.stop' })
    await confirmTtrpgOpenAudioReviewV1({ ...s.owner, review: stop, decision: 'confirm-this-audio-and-audience' })
    const after = await readView(s.owner)
    expect((await readTtrpgOpenAudioTransitionsV1(request(s, before, after))).transitions).toEqual([])
    const player = { ...s.owner, viewerKey: OPEN_HUMAN_VIEWER }, playerBefore = await readView(player)
    await upload(s, 'GM-HIDDEN-AUDIO-NAME', 3000, 'gm-only')
    const playerAfter = await readView(player)
    const result = await readTtrpgOpenAudioTransitionsV1({ ...player, before: playerBefore, after: playerAfter, playingClips: clips.get(playerBefore)! })
    expect(result.transitions).toEqual([]); expect(JSON.stringify(result)).not.toMatch(/GM-HIDDEN|ENGINEERING-ONLY|controlRef/)
  })
  it('refuses an after-view made stale by a later real cue and does not tail a file whose exact original binding is gone', async () => {
    const s = await setupAudioRuntimeV1(), original = await upload(s, 'binding.original')
    const before = await readView(s.owner)
    await upload(s, 'binding.new', 1000)
    const after = await readView(s.owner)
    const asset = await db.productMediaAssets.where('productRuntimeSessionId').equals(s.owner.sessionId).filter(row => row.assetKey === original.asset!.assetKey).first()
    await db.productMediaBlobs.where('mediaAssetId').equals(asset!.id!).delete()
    expect((await readTtrpgOpenAudioTransitionsV1(request(s, before, after))).transitions).toEqual([])
    const current = after.tracks[0]; expect((await readTtrpgOpenAudioClipV1({ ...s.owner, sourceRef: current.sourceRef, expectedClipKey: current.clipKey })).blob.size).toBeGreaterThan(0)
    await upload(s, 'later', 1000)
    await expect(readTtrpgOpenAudioTransitionsV1(request(s, before, after))).rejects.toThrow(/已变化/)
  })
  it('ends transition eligibility immediately on actual safety pause', async () => {
    const s = await setupAudioRuntimeV1(); await upload(s, 'pause.old')
    const before = await readView(s.owner)
    await upload(s, 'pause.new', 1000)
    const after = await readView(s.owner)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'transition.pause'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: '停止本机音频过渡' })
    await expect(readTtrpgOpenAudioTransitionsV1(request(s, before, after))).rejects.toThrow(/已变化/)
    const paused = await readTtrpgOpenAudioDeskV1(s.owner)
    await expect(readTtrpgOpenAudioTransitionsV1(request(s, before, paused))).rejects.toThrow(/已变化/)
  })
  it('uses new child views and actual inherited media after parent deletion, and never restores read witnesses through complete import', async () => {
    const s = await setupAudioRuntimeV1(); await upload(s, 'branch.original')
    const parentView = await readView(s.owner)
    const child = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: parentView.sequence, title: 'audio transition child' })
    const childState = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'transition.child.zero'), viewerKey: s.owner.viewerKey, acceptedItemKeys: childState.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await deleteProductRuntimeSession(s.owner.sessionId)
    const owner = { ...s.owner, sessionId: child.id! }, before = await readView(owner)
    const review = await prepareTtrpgOpenRetainedAudioV1({ ...owner, sourceRef: before.tracks[0].sourceRef, action: 'play', fade: 1000, submissionKey: 'child.replay' })
    await confirmTtrpgOpenAudioReviewV1({ ...owner, review, decision: 'confirm-this-audio-and-audience' })
    const after = await readView(owner)
    expect((await readTtrpgOpenAudioTransitionsV1({ ...owner, before, after, playingClips: clips.get(before)! })).transitions).toHaveLength(1)
    await expect(readTtrpgOpenAudioTransitionsV1({ ...owner, before: parentView, after, playingClips: clips.get(parentView)! })).rejects.toThrow(/准确本机读取/)
    const importedId = await importProjectJSON(await exportProjectJSON(owner.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(row => row.title === 'audio transition child')!
    const copy = { scope: await resolveScope({ projectId: importedId }), sessionId: imported.id!, viewerKey: owner.viewerKey }, importedView = await readView(copy)
    await expect(readTtrpgOpenAudioTransitionsV1({ ...copy, before, after: importedView, playingClips: clips.get(before)! })).rejects.toThrow(/准确本机读取/)
  })
})
