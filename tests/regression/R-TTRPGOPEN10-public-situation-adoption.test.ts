import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupPublicSituationAdoptionV1 } from '../helpers/open-public-situation-adoption'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { acceptTtrpgOpenPublicSituationV1, activateTtrpgOpenSessionSituationV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { parseTtrpgOpenSessionSituationReceiptV1, parseTtrpgOpenSessionSituationReceiptV2 } from '../../src/lib/ttrpg/open-session-situation-contract'
import { reconcileTtrpgOpenPublicSituationRunV1 } from '../../src/lib/ttrpg/open-public-situation-adoption'
import { TtrpgOpenSituationReceiptPendingError } from '../../src/lib/ttrpg/open-session-situation-adoption'
import { finishTtrpgOpenPublicSituationDraftV1 } from '../../src/lib/ttrpg/open-public-situation-stop'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { verifyTtrpgOpenSessionSituationHashesV1 } from '../../src/lib/ttrpg/open-session-situation-proof'

describe('R-TTRPGOPEN10 original once-authorized AI host adoption', { timeout: 180000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('adopts exactly one common definition with explicit AI authority, then closes and independently admits it without another call', async () => {
    const s = await setupPublicSituationAdoptionV1(), before = await readProductRuntimeState(s.read.sessionId)
    const worlds = await db.worldReleases.toArray(), releases = await db.productReleases.toArray()
    const event = await acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.accept'), ...s.adoption })
    const receipt = parseTtrpgOpenSessionSituationReceiptV2(JSON.parse(event.payloadJson).receipt)
    expect(receipt.version).toBe(2); expect(receipt.disclosure).toMatchObject({ kind: 'ai-host-once-authorized', scope: 'this-one-common-candidate',
      viewerKey: s.read.viewerKey, authorization: { basisHash: s.auth.grant.basisHash } })
    expect(() => parseTtrpgOpenSessionSituationReceiptV1(receipt)).toThrow()
    await verifyTtrpgOpenSessionSituationHashesV1([receipt])
    const after = await readProductRuntimeState(s.read.sessionId), { situationReceipts, ...run } = after.ttrpg!.openRun!
    expect(situationReceipts).toEqual([receipt]); expect(run).toEqual(before.ttrpg!.openRun)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product)
    expect(await db.worldReleases.toArray()).toEqual(worlds); expect(await db.productReleases.toArray()).toEqual(releases)
    let original = await readInstanceAgentRunV1(s.read.scope, s.read.runId)
    expect(original.projection.state).toBe('completed')
    const verification = original.events.find(row => row.type === 'evidence.artifact.recorded' && row.payload.artifactKind === 'source-snapshot'
      && row.payload.stepId === 'ttrpg.open.public-situation-propose' && row.sequence > original.events.find(row => row.type === 'verification.started')!.sequence)!
    if (verification.type !== 'evidence.artifact.recorded') throw new Error('verification required')
    const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: s.read.scope.projectId, artifactKind: 'source-snapshot', contentHash: verification.payload.contentHash }))
    expect(body.decisionAuthority.kind).toBe('ai-host-once-authorized'); expect(JSON.stringify(body)).not.toContain('human-gm-reviewed')
    const count = await db.productRuntimeEvents.count()
    expect(await acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.repeat'), ...s.adoption })).toEqual(event)
    expect(await db.productRuntimeEvents.count()).toBe(count)
    await expect(activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.too-early'), viewerKey: s.read.viewerKey, templateKey: receipt.template.templateKey })).rejects.toThrow()
    await finishTtrpgOpenPublicSituationDraftV1({ ...s.read, epochKey: s.auth.epochKey })
    await activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.admit'), viewerKey: s.read.viewerKey, templateKey: receipt.template.templateKey })
    const admitted = (await readProductRuntimeState(s.read.sessionId)).ttrpg!.openRun!
    expect(admitted.situations.active.some(row => row.templateKey === receipt.template.templateKey)).toBe(true)
    expect(admitted.worldTime).toEqual(before.ttrpg!.openRun!.worldTime); expect(admitted.coordination.calls).toHaveLength(1)
    expect(s.sends()).toBe(1); expect(await db.agentRuns.count()).toBe(1)
    original = await readInstanceAgentRunV1(s.read.scope, s.read.runId); expect(original.projection.state).toBe('completed')
  })
  it.each(['draft-only', 'human-gm', 'stopped', 'paused'] as const)('rejects %s without a definition, new Run or additional call', async reason => {
    const s = await setupPublicSituationAdoptionV1(reason === 'draft-only' ? 'draft-only' : 'adopt-this-one-candidate', reason === 'human-gm')
    if (reason === 'stopped') await finishTtrpgOpenPublicSituationDraftV1({ ...s.read, epochKey: s.auth.epochKey })
    if (reason === 'paused') await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.read.sessionId, 'public.pause'), viewerKey: s.read.viewerKey, changedBy: 'hero', status: 'paused', reason: '暂停' })
    const count = await db.productRuntimeEvents.count()
    await expect(acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.denied'), ...s.adoption })).rejects.toThrow()
    expect(await db.productRuntimeEvents.count()).toBe(count)
    expect((await readProductRuntimeState(s.read.sessionId)).ttrpg!.openRun!.situationReceipts ?? []).toEqual([])
    expect(s.sends()).toBe(1); expect(await db.agentRuns.count()).toBe(1)
  })
  it.each(['confirmation.recorded', 'verification.accepted'] as const)('repairs %s after the domain commit, even after explicit close and pause', async cut => {
    const s = await setupPublicSituationAdoptionV1(), add = db.agentRunEvents.add.bind(db.agentRunEvents)
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => { if (args[0].type === cut) throw new Error('public adoption terminal cut'); return add(...args) })
    await expect(acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.cut'), ...s.adoption })).rejects.toBeInstanceOf(TtrpgOpenSituationReceiptPendingError)
    vi.restoreAllMocks()
    expect((await readProductRuntimeState(s.read.sessionId)).ttrpg!.openRun!.situationReceipts).toHaveLength(1)
    await finishTtrpgOpenPublicSituationDraftV1({ ...s.read, epochKey: s.auth.epochKey })
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.read.sessionId, 'public.repair.pause'), viewerKey: s.read.viewerKey, changedBy: 'hero', status: 'paused', reason: '暂停后只补原回执' })
    const count = await db.productRuntimeEvents.count(), hash = await reconcileTtrpgOpenPublicSituationRunV1(s.adoption)
    expect(await reconcileTtrpgOpenPublicSituationRunV1(s.adoption)).toBe(hash)
    expect(await db.productRuntimeEvents.count()).toBe(count); expect((await readInstanceAgentRunV1(s.read.scope, s.read.runId)).projection.state).toBe('completed')
    expect(s.sends()).toBe(1)
  })
  it('serializes a competing Stop and adoption using the actual domain commit, without resurrecting permission', async () => {
    const s = await setupPublicSituationAdoptionV1(), envelope = await openEnvelopeV1(s.read.sessionId, 'public.accept.stop.race')
    await Promise.allSettled([
      acceptTtrpgOpenPublicSituationV1({ ...envelope, ...s.adoption }),
      finishTtrpgOpenPublicSituationDraftV1({ ...s.read, epochKey: s.auth.epochKey }),
    ])
    // A stale close can be retried explicitly; no model allowance is renewed.
    await finishTtrpgOpenPublicSituationDraftV1({ ...s.read, epochKey: s.auth.epochKey })
    const run = (await readProductRuntimeState(s.read.sessionId)).ttrpg!.openRun!, receipts = run.situationReceipts ?? []
    expect(receipts.length).toBeLessThanOrEqual(1); expect(run.coordination.activeEpochKey).toBeNull()
    if (receipts.length) {
      await reconcileTtrpgOpenPublicSituationRunV1(s.adoption)
      expect((await readInstanceAgentRunV1(s.read.scope, s.read.runId)).projection.state).toBe('completed')
    } else {
      expect((await readInstanceAgentRunV1(s.read.scope, s.read.runId)).projection.state).toBe('cancelled')
      await expect(acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.after.stop.race'), ...s.adoption })).rejects.toThrow()
    }
    expect(s.sends()).toBe(1); expect(await db.agentRuns.count()).toBe(1)
  })
})
