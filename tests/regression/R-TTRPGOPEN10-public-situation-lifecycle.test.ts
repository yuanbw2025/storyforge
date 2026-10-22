import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupPublicSituationAdoptionV1 } from '../helpers/open-public-situation-adoption'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { acceptTtrpgOpenPublicSituationV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { parseTtrpgOpenSessionSituationReceiptV2 } from '../../src/lib/ttrpg/open-session-situation-contract'
import { verifyTtrpgOpenSessionSituationHashesV1 } from '../../src/lib/ttrpg/open-session-situation-proof'
import { readTtrpgOpenPublicSessionSituationAuditV1 } from '../../src/lib/ttrpg/open-public-situation-audit'
import { markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { executeTtrpgOpenPublicSituationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'

async function accept(s: Awaited<ReturnType<typeof setupPublicSituationAdoptionV1>>) {
  return acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.lifecycle.accept'), ...s.adoption })
}
describe('R-TTRPGOPEN10 public situation original provenance and lifecycle', { timeout: 180000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('rejects substituted candidate, template, delegation, viewer, and Run identities without writes', async () => {
    const s = await setupPublicSituationAdoptionV1(), before = await readProductRuntimeState(s.read.sessionId), count = await db.productRuntimeEvents.count()
    for (const change of [{ candidateHash: 'f'.repeat(64) }, { templateHash: 'f'.repeat(64) }, { authorizationBasisHash: 'f'.repeat(64) }, { viewerKey: 'viewer.other' }, { runId: s.read.runId + 1 }]) {
      await expect(acceptTtrpgOpenPublicSituationV1({ ...await openEnvelopeV1(s.read.sessionId, 'public.foreign'), ...s.adoption, ...change })).rejects.toThrow()
    }
    expect(await readProductRuntimeState(s.read.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count)
    await accept(s); expect(s.sends()).toBe(1)
  })
  it('rolls back a failed domain write and commits the original candidate only once under competing acceptance', async () => {
    const s = await setupPublicSituationAdoptionV1(), before = await readProductRuntimeState(s.read.sessionId)
    const spy = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('public receipt storage cut'))
    await expect(accept(s)).rejects.toThrow('public receipt storage cut'); spy.mockRestore()
    expect(await readProductRuntimeState(s.read.sessionId)).toEqual(before)
    const count = await db.productRuntimeEvents.count(), envelope = await openEnvelopeV1(s.read.sessionId, 'public.compete')
    const results = await Promise.allSettled([acceptTtrpgOpenPublicSituationV1({ ...envelope, ...s.adoption }), acceptTtrpgOpenPublicSituationV1({ ...envelope, ...s.adoption })])
    expect(results.some(row => row.status === 'fulfilled')).toBe(true)
    expect((await readProductRuntimeState(s.read.sessionId)).ttrpg!.openRun!.situationReceipts).toHaveLength(1)
    expect(await db.productRuntimeEvents.count()).toBe(count + 1); await accept(s); expect(s.sends()).toBe(1)
  })
  it('cannot relabel a rehashed AI authorization receipt as human-GM review', async () => {
    const s = await setupPublicSituationAdoptionV1(), event = await accept(s)
    const receipt = parseTtrpgOpenSessionSituationReceiptV2(JSON.parse(event.payloadJson).receipt)
    const { receiptHash: _hash, ...body } = receipt
    const forged = { ...body, version: 1, disclosure: { kind: 'human-gm-reviewed', viewerKey: s.read.viewerKey, seatKey: 'seat.hero', authorizationHash: receipt.disclosure.authorizationHash, templateHash: receipt.templateHash, scope: 'player-and-discovery-text-reviewed' } }
    await expect(verifyTtrpgOpenSessionSituationHashesV1([parseTtrpgOpenSessionSituationReceiptV2({ ...forged, receiptHash: await hashCanonicalValue(forged) })])).rejects.toThrow(/权限|用途/)
  })
  it('preserves exact original bytes, safe historical proof and retention after branch, parent deletion and repeated ID remapping', async () => {
    const s = await setupPublicSituationAdoptionV1(), event = await accept(s), original = parseTtrpgOpenSessionSituationReceiptV2(JSON.parse(event.payloadJson).receipt)
    const before = await branchProductRuntimeSession({ parentSessionId: s.read.sessionId, throughSequence: event.sequence - 1, title: 'Before public adoption' })
    const child = await branchProductRuntimeSession({ parentSessionId: s.read.sessionId, throughSequence: event.sequence, title: 'After public adoption' })
    expect((await readProductRuntimeState(before.id!)).ttrpg!.openRun!.situationReceipts ?? []).toEqual([])
    const state = await readProductRuntimeState(child.id!)
    expect(state.ttrpg!.openRun!.situationReceipts).toEqual([original]); expect(state.ttrpg!.openRun!.coordination.calls).toEqual([])
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'public.child.zero'), viewerKey: s.read.viewerKey,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    await deleteProductRuntimeSession(s.read.sessionId); expect(await db.agentRuns.get(s.read.runId)).toBeUndefined()
    await markAndSweepAgentRunArtifactsV1(s.read.scope.projectId)
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: s.read.scope.projectId, targets: original.artifactRefs })).rejects.toThrow(/已确认产物/)
    let sessionId = child.id!, scope = s.read.scope
    let audit = await readTtrpgOpenPublicSessionSituationAuditV1({ scope, sessionId, viewerKey: s.read.viewerKey, templateKey: original.template.templateKey })
    expect(audit).toMatchObject({ historical: true, grantsSend: false, grantsAcceptance: false, authority: 'ai-host-once-authorized' })
    for (const hidden of ['PRIVATE-PUBLIC-ADOPTION-GM', 'PRIVATE-PUBLIC-ADOPTION-FRONT', original.template.driverGoal, original.template.evidence[0].description, 'rawResponse', 'originalRun', 'runOriginJson']) expect(JSON.stringify(audit)).not.toContain(hidden)
    for (let i = 0; i < 2; i++) {
      const projectId = await importProjectJSON(await exportProjectJSON(scope.projectId))
      const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
      scope = await resolveScope({ scope: { projectId, worldId: restored.worldId!, workId: restored.workId! } }); sessionId = restored.id!
      const inherited = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.situationReceipts!
      expect(inherited).toEqual([original]); await verifyTtrpgOpenSessionSituationHashesV1(inherited)
      const next = await readTtrpgOpenPublicSessionSituationAuditV1({ scope, sessionId, viewerKey: s.read.viewerKey, templateKey: original.template.templateKey })
      expect(next).toEqual(audit); audit = next
      await markAndSweepAgentRunArtifactsV1(projectId)
      await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId, targets: original.artifactRefs })).rejects.toThrow(/已确认产物/)
      let sends = 0
      await expect(executeTtrpgOpenPublicSituationRequestV1({ ...s.read, scope, sessionId, runAI: async () => { sends++; return '{}' } })).rejects.toThrow()
      expect(sends).toBe(0); expect(await db.agentRuns.where('projectId').equals(projectId).count()).toBe(0)
    }
  })
})
