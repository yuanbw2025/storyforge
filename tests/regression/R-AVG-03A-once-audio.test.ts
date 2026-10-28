import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { seedAvgNativePreview, avgNativePackage } from '../helpers/avg-native-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import { createProductInitialStateV1, createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { commitAvgOnceAudioCommandV1 } from '../../src/lib/avg/once-audio-commands'
import { assertAvgOnceAudioStateV1, avgOnceAudioReceiptV1, selectAvgOnceAudioTargetV1 } from '../../src/lib/avg/once-audio-runtime'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { appendProductRuntimeEvent, branchProductRuntimeSession, commitNarrativeChoice, createProductRuntimeCheckpoint, deleteProductRuntimeSession,
  parseProductRuntimeState, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import type { AvgPresentationCue, ProductRuntimeState } from '../../src/lib/types'

async function start() {
  const pcm = await avgReadingAudioFixture(100)
  const media = (['sfx', 'ambience', 'bgm'] as const).map(kind => ({ data: pcm.data, asset: { ...pcm.asset, assetKey: `audio.${kind}`, kind } }))
  const cues: AvgPresentationCue[] = media.map(({ asset }, order) => ({ cueKey: `cue.${asset.kind}`, beatKey: 'line.desk', assetKey: asset.assetKey,
    type: 'play-audio', loop: asset.kind === 'bgm', phase: 'before', durationMs: 0, order, easing: 'linear' }))
  cues.push({ ...cues[0], cueKey: 'cue.sfx.after', phase: 'after', order: 4 })
  const s = await seedAvgNativePreview(avgSystemFixture(), media, undefined, cues)
  const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '一次性声音恢复隔离',
    productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
  return { ...s, sessionId: session.id!, cues }
}
async function base(sessionId: number) {
  const b = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, baseSequence: b.sequence, baseStateHash: b.stateHash, commandId: crypto.randomUUID() }
}
async function begin(sessionId: number, cueKey = 'cue.sfx', visit = 0, retry = false) {
  const e = await commitAvgOnceAudioCommandV1({ ...await base(sessionId), type: 'start', cueKey, visit, retry })
  return JSON.parse(e.payloadJson).generation as number
}
async function observe(sessionId: number, generation: number, cueKey = 'cue.sfx', outcome: 'ended' | 'failed' = 'ended', visit = 0) {
  return commitAvgOnceAudioCommandV1({ ...await base(sessionId), type: 'observe', cueKey, visit, generation, outcome,
    reason: outcome === 'ended' ? '' : '真实加载失败测试', playedMs: outcome === 'ended' ? 100 : 0 })
}
describe('native once-audio durable transport and portable lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('omits the new codec field for old state and preserves completed non-loop cue identity on read/reparse', async () => {
    const old = createProductInitialStateV1({ runtimePackage: avgNativePackage(), runtimeSourceHash: 'a'.repeat(64) })
    expect(old.presentation).not.toHaveProperty('onceAudio')
    expect(parseProductRuntimeState(JSON.stringify(old))).toEqual(old)
    const s = await start()
    await observe(s.sessionId, await begin(s.sessionId))
    await observe(s.sessionId, await begin(s.sessionId, 'cue.ambience'), 'cue.ambience')
    const state = await readProductRuntimeState(s.sessionId)
    expect(state.presentation!.onceAudio!.receipts.map(r => r.status)).toEqual(['ended', 'ended'])
    expect(parseProductRuntimeState(JSON.stringify(state))).toEqual(state)
    expect(await readProductRuntimeState(s.sessionId)).toEqual(state)
    expect(avgOnceAudioReceiptV1(state, 'cue.sfx', 0)).toMatchObject({ status: 'ended', playedMs: 100 })
    await expect(begin(s.sessionId)).rejects.toThrow(/已结算/)
    await expect(begin(s.sessionId, 'cue.sfx', 0, true)).rejects.toThrow(/已结算/)
  })
  it('admits independent same-clip cues, supersedes the previous request and rejects stale callbacks', async () => {
    const s = await start(), g1 = await begin(s.sessionId), g2 = await begin(s.sessionId, 'cue.sfx.after')
    expect(g2).toBeGreaterThan(g1)
    const state = await readProductRuntimeState(s.sessionId)
    expect(avgOnceAudioReceiptV1(state, 'cue.sfx', 0)).toMatchObject({ status: 'superseded', playedMs: null })
    const count = await db.productRuntimeEvents.count()
    await expect(observe(s.sessionId, g1)).rejects.toThrow(/已过期|已终结/)
    expect(await db.productRuntimeEvents.count()).toBe(count)
    await observe(s.sessionId, g2, 'cue.sfx.after')
  })
  it('keeps an unconfirmed request unknown and retries only with an explicit new generation', async () => {
    const s = await start(), first = await begin(s.sessionId)
    expect(avgOnceAudioReceiptV1(await readProductRuntimeState(s.sessionId), 'cue.sfx', 0)?.status).toBe('requested')
    await expect(begin(s.sessionId)).rejects.toThrow(/重复请求/)
    const retry = await begin(s.sessionId, 'cue.sfx', 0, true)
    await expect(observe(s.sessionId, first)).rejects.toThrow(/已过期/)
    await observe(s.sessionId, retry, 'cue.sfx', 'failed')
    await expect(begin(s.sessionId)).rejects.toThrow(/重复请求/)
    const last = await begin(s.sessionId, 'cue.sfx', 0, true)
    await observe(s.sessionId, last)
  })
  it('enforces CAS, command idempotence, frozen cue/visit and generic write fences atomically', async () => {
    const s = await start(), input = { ...await base(s.sessionId), type: 'start' as const, cueKey: 'cue.sfx', visit: 0, retry: false }
    const e = await commitAvgOnceAudioCommandV1(input)
    expect((await commitAvgOnceAudioCommandV1(input)).id).toBe(e.id)
    const count = await db.productRuntimeEvents.count()
    await expect(commitAvgOnceAudioCommandV1({ ...input, retry: true })).rejects.toThrow(/commandId/)
    await expect(commitAvgOnceAudioCommandV1({ ...input, commandId: crypto.randomUUID(), cueKey: 'cue.ambience' })).rejects.toThrow(/状态已变化/)
    await expect(begin(s.sessionId, 'cue.ambience', 1)).rejects.toThrow(/过期/)
    await expect(begin(s.sessionId, 'cue.bgm')).rejects.toThrow(/不是冻结/)
    await expect(begin(s.sessionId, 'unknown')).rejects.toThrow(/不是冻结/)
    await expect(appendProductRuntimeEvent({ sessionId: s.sessionId, type: 'avg.audio.once.started', payload: {} })).rejects.toThrow(/专用/)
    expect(await db.productRuntimeEvents.count()).toBe(count)
  })
  it('replays legal revisits once each while bounding receipts and keeping the current channel target', async () => {
    const s = await start()
    await observe(s.sessionId, await begin(s.sessionId))
    await observe(s.sessionId, await begin(s.sessionId, 'cue.ambience'), 'cue.ambience')
    await reachAvgPresentationBeat({ ...await base(s.sessionId), beatKey: 'line.desk' })
    let state = await readProductRuntimeState(s.sessionId)
    const ambience = { channel: 'ambience' as const, assetKey: 'audio.ambience', volume: 1, loop: false }
    expect(selectAvgOnceAudioTargetV1(state, ambience, [])).toEqual({ cueKey: 'cue.ambience', visit: 0 })
    expect(selectAvgOnceAudioTargetV1(state, { ...ambience, channel: 'sfx', assetKey: 'audio.sfx' }, [])).toBeNull()
    await commitNarrativeChoice({ ...await base(s.sessionId), choiceKey: 'inspect' })
    await observe(s.sessionId, await begin(s.sessionId, 'cue.sfx', 1), 'cue.sfx', 'ended', 1)
    await observe(s.sessionId, await begin(s.sessionId, 'cue.ambience', 1), 'cue.ambience', 'ended', 1)
    state = await readProductRuntimeState(s.sessionId)
    expect(state.presentation!.onceAudio!.receipts).toHaveLength(2)
    expect(state.presentation!.onceAudio!.receipts.every(r => r.visit === 1)).toBe(true)
    expect(await db.productRuntimeEvents.where('sessionId').equals(s.sessionId).filter(e => e.type === 'avg.audio.once.started').count()).toBe(4)
  })
  it('preserves ended receipts through checkpoint, detached branch, backup remap and copy deletion', async () => {
    const s = await start(); await observe(s.sessionId, await begin(s.sessionId))
    const checkpoint = await createProductRuntimeCheckpoint({ sessionId: s.sessionId, name: '音效确已结束' })
    const child = await branchProductRuntimeSession({ parentSessionId: s.sessionId, throughSequence: checkpoint.throughSequence, title: '保留声音结果' })
    const before = (await readProductRuntimeState(child.id!)).presentation!.onceAudio
    await deleteProductRuntimeSession(s.sessionId)
    expect((await readProductRuntimeState(child.id!)).presentation!.onceAudio).toEqual(before)
    const second = await branchProductRuntimeSession({ parentSessionId: child.id!, throughSequence: 0, title: '再次分支' })
    await begin(second.id!, 'cue.ambience')
    const snapshot = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(snapshot)
    const copy = (await db.productRuntimeSessions.where('projectId').equals(copyId).toArray()).find(r => r.title === child.title)!
    expect(copy.id).not.toBe(child.id)
    expect((await readProductRuntimeState(copy.id!)).presentation!.onceAudio).toEqual(before)
    await deleteWork(copyId, copy.workId!)
    expect(await db.productRuntimeSessions.where('projectId').equals(copyId).count()).toBe(0)
    expect((await readProductRuntimeState(child.id!)).presentation!.onceAudio).toEqual(before)
  })
  it('rejects forged receipt metadata and importing pre-consumed initial states before any write', async () => {
    const s = await start(); await observe(s.sessionId, await begin(s.sessionId))
    const state = await readProductRuntimeState(s.sessionId)
    for (const field of ['assetKey', 'contentHash', 'channel', 'visit', 'playedMs'] as const) {
      const forged = structuredClone(state), row = forged.presentation!.onceAudio!.receipts[0]
      Object.assign(row, { [field]: field === 'contentHash' ? '0'.repeat(64) : field === 'visit' ? 999 : field === 'playedMs' ? null : 'wrong' })
      expect(() => assertAvgOnceAudioStateV1(forged)).toThrow()
    }
    const snapshot = await exportProjectJSON(s.scope.projectId), count = await db.projects.count()
    const initial = JSON.parse(snapshot.productRuntimeSessions![0].initialStateJson) as ProductRuntimeState
    initial.presentation!.onceAudio = state.presentation!.onceAudio
    snapshot.productRuntimeSessions![0].initialStateJson = JSON.stringify(initial)
    await expect(importProjectJSON(snapshot)).rejects.toThrow(/预置播放回执/)
    expect(await db.projects.count()).toBe(count)
    expect(await db.agentRuns.count()).toBe(0)
  })
})
