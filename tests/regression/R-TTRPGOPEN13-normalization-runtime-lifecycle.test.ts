import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupNormalizationRuntimeSourceV1 as setup } from '../helpers/open-normalization-runtime-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { branchProductRuntimeSession, deleteProductRuntimeSession, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenEpochV1, reviewTtrpgOpenOracleCandidateV1, closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { createTtrpgOpenNormalizationRuntimeReferencePolicyV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'
import { TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1 } from '../../src/lib/ttrpg/open-coordination'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { generateTtrpgOpenFactNormalizationCandidateV2, executeTtrpgOpenOracleRequestV1, executeTtrpgOpenFactNormalizationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { resolveScope } from '../../src/lib/workspace/scope'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { verifyProductRuntimeSessionSourceV1 } from '../../src/lib/product-production/preview-source'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'

function addLaterSeat(pkg: Parameters<NonNullable<Parameters<typeof setup>[1]>>[0]) {
  const c = pkg.ttrpg!.campaign, original = c.characterTemplates.find(row => row.characterKey === 'companion.2')!
  const template = { ...structuredClone(original), characterKey: 'companion.later', seatKey: 'seat.companion.later', name: '稍后加入的同伴' }
  template.characterSheet = createCompleteTtrpgCharacterSheetV2({ template, rulePack: pkg.ttrpg!.rulePack.content })
  c.characterTemplates.push(template)
  c.entityBindings.push({ ...structuredClone(c.entityBindings.find(row => row.bindingKey === 'companion.2')!), bindingKey: template.characterKey, templateKey: template.characterKey })
  c.companionPolicy.approvalBindings.push({ companionActorKey: template.characterKey, approverSeatKeys: ['seat.hero'], partyResourceApprovalAllowed: false })
}
async function zero(sessionId: number, selectedCharacterKeys: string[]) {
  const state = await readProductRuntimeState(sessionId)
  await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(sessionId, 'normalization.child.zero'), viewerKey: 'viewer.gm',
    acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys })
}
async function start(s: Awaited<ReturnType<typeof setup>>, sessionId: number, scope = s.owner.scope) {
  const state = await readProductRuntimeState(sessionId), session = (await db.productRuntimeSessions.get(sessionId))!, source = await verifyProductRuntimeSessionSourceV1({ scope, session, ttrpgProtocol: 2 })
  const policy = await createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ content: source.runtimePackage.ttrpg!, runtimeSourceHash: session.runtimeSourceHash,
    runtime: state.ttrpg!, reviewSourceRef: s.review.sourceRef, consumerRef: { sessionKey: state.ttrpg!.sessionKey, sequence: state.lastSequence + 1 } })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, 'normalization.child.start'), viewerKey: s.owner.viewerKey,
    triggerKind: 'continue-host', rawInput: TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1, normalizationRuntimeReferencePolicy: policy })
  return { ...await openEnvelopeV1(sessionId, 'normalization.child.prepare'), scope, viewerKey: s.owner.viewerKey, reviewSourceRef: s.review.sourceRef,
    referencePolicy: 'accepted-interpretation-instances-v1' as const, maximumOutputTokens: 1000, maximumCostUsd: 0.1 }
}
describe('R-TTRPGOPEN13 normalized instance history and real roster boundaries', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it.each(['party', 'public'] as const)('checks a real newly authorized late seat against the original %s interpretation, without rewriting the old roster', async audience => {
    const s = await setup(audience, addLaterSeat), child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: s.state.lastSequence, title: 'Actual late seat' })
    const actors = [...s.state.ttrpg!.authorization!.selectedActorKeys, 'companion.later']
    await zero(child.id!, actors)
    const before = await readProductRuntimeState(child.id!), runs = await db.agentRuns.count()
    if (audience === 'party') {
      await expect(start(s, child.id!)).rejects.toThrow(/新加入|接收者/)
      expect(await readProductRuntimeState(child.id!)).toEqual(before); expect(await db.agentRuns.count()).toBe(runs)
    } else {
      const input = await start(s, child.id!), generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...input, runAI: async () => JSON.stringify({ facts: [s.normalizedFact] }) })
      expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
      const call = (await readProductRuntimeState(child.id!)).ttrpg!.openRun!.coordination.calls.at(-1)!
      expect(call.supportSlot!.runtimeReferencePolicy!.recipientActorKeys).toEqual(actors)
      expect(call.supportSlot!.runtimeReferencePolicy!.oraclePolicy.recipientActorKeys).toHaveLength(3)
    }
  })
  it('starts a fresh derivation from actually imported ancestor history after parent deletion, then preserves normalized facts on another child/import without execution rights', async () => {
    const s = await setup('party', addLaterSeat), child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: s.state.lastSequence, title: 'Normalized original child' })
    await zero(child.id!, s.state.ttrpg!.authorization!.selectedActorKeys)
    await deleteProductRuntimeSession(s.f.sessionId)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } }), before = await readProductRuntimeState(session.id!)
    const originalRaw = vi.fn(async () => '不得重发已导入的原 Oracle')
    await expect(executeTtrpgOpenOracleRequestV1({ scope, sessionId: session.id!, viewerKey: s.owner.viewerKey,
      runId: s.original.prepared.runId, requestKey: s.original.prepared.requestKey, runAI: originalRaw })).rejects.toThrow()
    expect(originalRaw).not.toHaveBeenCalled()
    const input = await start(s, session.id!, scope), sends = vi.fn(async () => JSON.stringify({ facts: [s.normalizedFact] })), generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...input, runAI: sends })
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
    const resume = { scope, sessionId: session.id!, viewerKey: s.owner.viewerKey, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey }
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(session.id!, 'normalization.imported.derive.review'), ...resume,
      candidateHash: generated.candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(session.id!, 'normalization.imported.derive.close'), viewerKey: s.owner.viewerKey, epochKey: generated.candidate.epochKey, reason: '原归一已审阅' })
    const after = await readProductRuntimeState(session.id!)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(after.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect(parseTtrpgRuntimeStateV2(after.ttrpg)).toEqual(after.ttrpg)
    const grandchild = await branchProductRuntimeSession({ parentSessionId: session.id!, throughSequence: after.lastSequence, title: 'Normalized grandchild' })
    await zero(grandchild.id!, [...before.ttrpg!.authorization!.selectedActorKeys, 'companion.later'])
    const nextProjectId = await importProjectJSON(await exportProjectJSON(projectId)), nextSession = (await db.productRuntimeSessions.where('projectId').equals(nextProjectId).toArray()).find(row => row.title === grandchild.title)!
    const restored = await readProductRuntimeState(nextSession.id!)
    expect(restored.ttrpg!.openRun!.factLedger).toEqual(after.ttrpg!.openRun!.factLedger)
    const nextScope = await resolveScope({ scope: { projectId: nextProjectId, worldId: nextSession.worldId!, workId: nextSession.workId! } })
    const lateView = await loadTtrpgOpenPlayerContextV1({ scope: nextScope, sessionId: nextSession.id!, actorKey: 'companion.later' })
    expect(lateView.view.sessionFacts).toHaveLength(0)
    await expect(executeTtrpgOpenFactNormalizationRequestV1({ scope: { projectId: nextProjectId, worldId: nextSession.worldId!, workId: nextSession.workId! }, sessionId: nextSession.id!,
      viewerKey: s.owner.viewerKey, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, runAI: sends })).rejects.toThrow()
    expect(sends).toHaveBeenCalledOnce()
  })
  it('makes an actual narrower authorized read while keeping the original four recipients and creation scope immutable', async () => {
    const s = await setup('party', addLaterSeat, { selectedCharacterKeys: ['hero', 'companion.1', 'companion.2', 'companion.later'] }), child = await branchProductRuntimeSession({
      parentSessionId: s.f.sessionId, throughSequence: s.state.lastSequence, title: 'Actually narrower normalization' })
    const actors = ['hero', 'companion.1', 'companion.2']; await zero(child.id!, actors)
    const input = await start(s, child.id!), generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...input,
      runAI: async () => JSON.stringify({ facts: [{ ...s.normalizedFact, knownByActorKeys: actors }] }) })
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
    const policy = (await readProductRuntimeState(child.id!)).ttrpg!.openRun!.coordination.calls.at(-1)!.supportSlot!.runtimeReferencePolicy!
    expect(policy.recipientActorKeys).toEqual(actors); expect(policy.oraclePolicy).toEqual(s.policy); expect(policy.oraclePolicy.recipientActorKeys).toHaveLength(4)
  })
})
