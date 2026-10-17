import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupInstanceSituationV1 as setup } from '../helpers/open-instance-situation'
import { situationGenerationOutputV1 } from '../helpers/open-situation-generation'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { requestTtrpgOpenSituationDeskV1 } from '../../src/lib/ttrpg/open-situation-desk-service'
import { loadTtrpgOpenSituationKernelInputV1 } from '../../src/lib/ttrpg/open-generated-situation-context'
import { readTtrpgOpenRuntimeCandidateForKernelV1 } from '../../src/lib/ttrpg/open-runtime-candidate'
import { acceptTtrpgOpenSituationV1, activateTtrpgOpenSessionSituationV1, startTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { finishTtrpgOpenSituationDraftV1 } from '../../src/lib/ttrpg/open-generated-situation-stop'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { parseTtrpgOpenSessionSituationReceiptV1, type TtrpgOpenSessionSituationReceipt } from '../../src/lib/ttrpg/open-session-situation-contract'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { publicSituationOutputV1 } from '../helpers/open-public-situation-generation'
import { requestTtrpgOpenPublicSituationDeskV1, readTtrpgOpenPublicSituationDeskV1, enableTtrpgOpenPublicSituationDeskV1 } from '../../src/lib/ttrpg/open-public-situation-desk'
import { loadTtrpgOpenPublicSituationContextV1 } from '../../src/lib/ttrpg/open-public-situation-context'
import { loadTtrpgOpenPublicSituationKernelV1 } from '../../src/lib/ttrpg/open-public-situation-kernel'
import { generateTtrpgOpenSituationCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { reconcileTtrpgOpenSituationRunV1, TtrpgOpenSituationReceiptPendingError } from '../../src/lib/ttrpg/open-session-situation-adoption'
import { verifyTtrpgOpenSessionSituationHashesV1 } from '../../src/lib/ttrpg/open-session-situation-proof'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { reviewTtrpgOpenGeneratedSituationProposalV1 } from '../../src/lib/ttrpg/open-generated-situation-contract'

async function privateDraft() {
  const s = await setup(), send = vi.fn(async () => {
    const kernel = await loadTtrpgOpenSituationKernelInputV1({ ...s.deskInput, actorKey: 'gm' }), value = situationGenerationOutputV1(kernel.basis)
    value.template.driverBinding = { kind: 'npc', characterKey: s.npc }; value.template.obstacles[0].ref = s.place
    value.template.sourceRefs.push(s.npc, s.place)
    return JSON.stringify(value)
  })
  const result = await requestTtrpgOpenSituationDeskV1({ ...s.deskInput, submissionKey: 'instance.situation.draft', includeRuntimeEntities: true,
    rawInput: '结合港口、英雄身份、新守灯人及新候选地点，拟定一个由新守灯人驱动的新局势。完整读取该人物、地点与原授权模板。', maximumCostUsd: 0.1, runAI: send })
  if (result.status !== 'candidate') throw new Error('expected saved original candidate')
  const id = { ...s.deskInput, runId: result.summary.runId, requestKey: result.summary.requestKey, candidateHash: result.summary.candidateHash }
  const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(id, 'situation-proposal')
  if (candidate?.schema !== 'storyforge.ttrpg-open-situation-candidate' || !candidate.review?.evaluation.accepted) throw new Error('expected actual validated candidate')
  const command = { ...await openEnvelopeV1(id.sessionId, 'instance.situation.accept'), ...id, templateHash: await hashCanonicalValue(candidate.review.proposal.template), disclosure: 'player-and-discovery-text-reviewed' as const }
  return { ...s, id, candidate, command, send }
}

async function discover(s: Awaited<ReturnType<typeof setup>>, receipt: TtrpgOpenSessionSituationReceipt) {
  const id = s.deskInput, active = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(id.sessionId, 'instance.discovery.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '检查新局势里的线索' })
  const action = s.input.content.rulePack.content.actions[0], instance = active.situations.active.find(row => row.templateKey === receipt.template.templateKey)!
  await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(id.sessionId, 'instance.discovery.operation'), viewerKey: OPEN_HUMAN_VIEWER,
    request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key,
      targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : s.npc, effectBindings: {},
      discovery: { situationKey: instance.situationKey, evidenceRef: receipt.template.evidence[0].clueRef,
        interventionPointKey: receipt.template.interventionPoints[0].pointKey, effectBindings: {} } } })
  const operation = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!.operations[0]
  expect(operation.plan.discoveryPlan?.sessionSituation).toEqual(receipt)
  for (const approval of operation.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({
    ...await openEnvelopeV1(id.sessionId, await ttrpgOpenOperationCommandIdV1(operation.startedRef.sessionKey, operation.operationKey, 'approval.' + approval.actorKey)),
    viewerKey: OPEN_HUMAN_VIEWER, actorKey: approval.actorKey, riskHash: operation.riskHash, decision: 'approve', operationKey: operation.operationKey, frozenPlanHash: operation.planHash })
  const command = { sessionId: id.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
  for (let i = 0; i < 16; i++) {
    const current = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!, next = nextTtrpgOpenOperationStepV1(current.operations[0])
    if (!next || ['terminal', 'gates', 'narration', 'handoff'].includes(next.kind)) break
    if (next.kind === 'pressure') await resumeTtrpgOpenPressureV1(command)
    else if (next.kind === 'situations') await resumeTtrpgOpenSituationsV1(command)
    else await resumeTtrpgOpenOperationV1(command)
  }
  const after = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
  return after
}

describe('R-TTRPGOPEN13 actual created instance → formal source → explicit situation adoption → runtime admission', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('uses complete actual model reads, keeps immutable source bytes, and activates the accepted instance NPC without granting player knowledge', async () => {
    const s = await setup(), builds = await db.productBuilds.toArray()
    const send = vi.fn(async () => {
      const kernel = await loadTtrpgOpenSituationKernelInputV1({ ...s.deskInput, actorKey: 'gm' }), value = situationGenerationOutputV1(kernel.basis)
      value.template.driverBinding = { kind: 'npc', characterKey: s.npc }
      value.template.preconditions = [{ op: 'actor-at', actorKey: s.npc, locationRef: 'harbor' }]
      value.template.obstacles[0].ref = s.place
      value.template.sourceRefs.push(s.npc, s.place)
      return JSON.stringify(value)
    })
    const result = await requestTtrpgOpenSituationDeskV1({ ...s.deskInput, submissionKey: 'instance.situation.draft', includeRuntimeEntities: true,
      rawInput: '结合港口、英雄身份、新守灯人及新候选地点，拟定一个由新守灯人驱动的新局势。完整读取该人物、地点与原授权模板。', maximumCostUsd: 0.1, runAI: send })
    expect(result.status).toBe('candidate'); expect(send).toHaveBeenCalledTimes(1)
    if (result.status !== 'candidate') throw new Error('Expected actual saved candidate')
    const id = { ...s.deskInput, runId: result.summary.runId, requestKey: result.summary.requestKey, candidateHash: result.summary.candidateHash }
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(id, 'situation-proposal')
    expect(candidate?.schema).toBe('storyforge.ttrpg-open-situation-candidate')
    if (candidate?.schema !== 'storyforge.ttrpg-open-situation-candidate') throw new Error('Expected actual saved situation')
    expect(candidate.review, JSON.stringify(candidate)).not.toBeNull()
    expect(candidate.review!.evaluation.accepted).toBe(true)
    expect(candidate.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'entity', ref: s.npc }), expect.objectContaining({ kind: 'entity', ref: s.place }),
      expect.objectContaining({ kind: 'original-npc-definition', ref: 'keeper' }),
      expect.objectContaining({ kind: 'original-instance-template', ref: 'dynamic.npc' }),
      expect.objectContaining({ kind: 'runtime-identity', ref: s.npc }),
    ]))
    const kernel = await loadTtrpgOpenSituationKernelInputV1({ ...s.deskInput, actorKey: 'gm' })
    expect(kernel.basis.runtimeEntityReferences!.references.map(row => row.entityRef).sort()).toEqual([s.npc, s.place].sort())
    const beforeAdoption = await readProductRuntimeState(id.sessionId)
    const event = await acceptTtrpgOpenSituationV1({ ...await openEnvelopeV1(id.sessionId, 'instance.situation.accept'), ...id,
      templateHash: await hashCanonicalValue(candidate.review!.proposal.template), disclosure: 'player-and-discovery-text-reviewed' })
    const receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    expect(receipt.runtimeEntityReferences).toEqual(kernel.basis.runtimeEntityReferences)
    const adopted = await readProductRuntimeState(id.sessionId)
    expect(adopted.entities).toEqual(beforeAdoption.entities); expect(adopted.ttrpg!.product).toEqual(beforeAdoption.ttrpg!.product)
    expect(await db.productBuilds.toArray()).toEqual(builds)
    await finishTtrpgOpenSituationDraftV1(id)
    await activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(id.sessionId, 'instance.situation.activate'), viewerKey: id.viewerKey, templateKey: receipt.template.templateKey })
    const active = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
    expect(active.situations.active).toContainEqual(expect.objectContaining({ templateKey: receipt.template.templateKey, activationReason: 'session-generation' }))
    expect(active.knowledge).toEqual([]); expect(active.worldTime.worldTurn).toBe(0)
    const after = await discover(s, receipt)
    expect(after.worldTime.worldTurn).toBe(2)
    expect(after.knowledge).toContainEqual(expect.objectContaining({ evidenceRef: receipt.template.evidence[0].clueRef, recipientActorKeys: ['hero'], reliability: 'observed' }))
    expect(after.situationCycles!.every(row => row.sessionSituationRefs?.some(ref => ref.receiptHash === receipt.receiptHash))).toBe(true)
    const hero = await loadTtrpgOpenPlayerContextV1({ ...id, actorKey: 'hero' }), companion = await loadTtrpgOpenPlayerContextV1({ ...id, actorKey: 'companion.1' })
    expect(hero.view.knowledge).toContainEqual(expect.objectContaining({ evidenceRef: receipt.template.evidence[0].clueRef }))
    expect(companion.view.knowledge).toEqual([])
    expect(JSON.stringify(hero.view)).not.toContain('PRIVATE-GENERATED-SITUATION-GOAL')
  })
  it('freezes only exact common instance identities, excludes private locations/equipment/profiles, and adopts once from the original shared request', async () => {
    const s = await setup(false), legacy = await loadTtrpgOpenPublicSituationContextV1({ ...s.deskInput, actorKey: 'gm' })
    expect(legacy.runtimeEntityReferencePolicy).toBeUndefined()
    const send = vi.fn(async (request: unknown) => {
      const wire = JSON.stringify(request)
      for (const hidden of [s.place, 'INSTANCE-SITUATION-PRIVATE-NPC-PROFILE', s.npc + '.equipment.0', 'gmProfile', 'frozenContentJson', 'dynamicTemplateKey']) expect(wire).not.toContain(hidden)
      expect(wire).toContain(s.npc); expect(wire).toContain('新守灯人')
      const run = (await readProductRuntimeState(s.deskInput.sessionId)).ttrpg!.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)!
      const kernel = await loadTtrpgOpenPublicSituationKernelV1({ ...s.deskInput, actorKey: 'gm' }, epoch.publicSituation!), value = publicSituationOutputV1(kernel)
      expect(kernel.basis.runtimeEntityReferences!.references.map(row => row.entityRef)).toEqual([s.npc])
      value.template.driverBinding = { kind: 'npc', characterKey: s.npc }
      value.template.obstacles[0].ref = s.npc; value.template.obstacles.forEach(row => { row.predicate = { op: 'world-turn-at-least', value: 20 } })
      value.template.sourceRefs.push(s.npc)
      return JSON.stringify(value)
    })
    await requestTtrpgOpenPublicSituationDeskV1({ ...s.deskInput, submissionKey: 'common.instances.draft', includeRuntimeEntities: true,
      rawInput: '结合大家已知的新守灯人和港口，为英雄拟定新局势。', maximumCostUsd: 0.1, runAI: send,
      sharingDecision: 'share-this-request-with-current-party', delegationDecision: 'adopt-this-one-candidate' })
    expect(send).toHaveBeenCalledTimes(1)
    const after = await readProductRuntimeState(s.deskInput.sessionId), receipt = after.ttrpg!.openRun!.situationReceipts?.[0]
    expect(receipt, JSON.stringify(await readTtrpgOpenPublicSituationDeskV1(s.deskInput))).toBeDefined()
    expect(receipt!.runtimeEntityReferences!.references.map(row => row.entityRef)).toEqual([s.npc])
    expect(receipt!.version).toBe(2); expect(after.entities).toEqual(s.before.entities); expect(after.ttrpg!.product).toEqual(s.before.ttrpg!.product)
    expect(await readTtrpgOpenPublicSituationDeskV1(s.deskInput)).toMatchObject({ adopted: true, currentWindow: false, receiptPending: false })
    await enableTtrpgOpenPublicSituationDeskV1({ ...s.deskInput, submissionKey: 'common.instances.activate', templateKey: receipt!.template.templateKey })
    const active = (await readProductRuntimeState(s.deskInput.sessionId)).ttrpg!.openRun!
    expect(active.situations.active).toContainEqual(expect.objectContaining({ templateKey: receipt!.template.templateKey }))
    expect(active.knowledge).toEqual([]); expect(active.worldTime.worldTurn).toBe(0)
    const discovered = await discover(s, receipt!)
    expect(discovered.worldTime.worldTurn).toBe(2)
    expect(discovered.knowledge).toContainEqual(expect.objectContaining({ evidenceRef: receipt!.template.evidence[0].clueRef,
      recipientActorKeys: ['companion.1', 'companion.2', 'hero'], reliability: 'observed' }))
    expect(discovered.situationCycles!.every(row => row.sessionSituationRefs?.some(ref => ref.receiptHash === receipt!.receiptHash))).toBe(true)
    for (const actorKey of ['hero', 'companion.1', 'companion.2']) {
      const player = await loadTtrpgOpenPlayerContextV1({ ...s.deskInput, actorKey })
      expect(player.view.knowledge).toContainEqual(expect.objectContaining({ evidenceRef: receipt!.template.evidence[0].clueRef }))
      for (const hidden of [s.npc + '.equipment.0', 'INSTANCE-SITUATION-PRIVATE-NPC-PROFILE', ...(actorKey === 'hero' ? [] : [s.place])]) expect(JSON.stringify(player.view)).not.toContain(hidden)
    }
  })
  it('does not widen the source or candidate grammar of an old private window merely because actual entities now exist', async () => {
    const s = await setup()
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.deskInput.sessionId, 'legacy.instance.window'), viewerKey: s.deskInput.viewerKey, triggerKind: 'request-situation', rawInput: '按原冻结资料起草' })
    const kernel = await loadTtrpgOpenSituationKernelInputV1({ ...s.deskInput, actorKey: 'gm' })
    expect(kernel.basis.runtimeEntityReferences).toBeUndefined()
    expect(JSON.stringify(kernel.context.resources)).not.toContain(s.npc)
    const value = situationGenerationOutputV1(kernel.basis); value.template.driverBinding = { kind: 'npc', characterKey: s.npc }
    const result = await generateTtrpgOpenSituationCandidateV1({ ...s.deskInput, ...await openEnvelopeV1(s.deskInput.sessionId, 'legacy.instance.prepare'), rawInput: '按原冻结资料起草',
      maximumOutputTokens: 4000, maximumCostUsd: 0.1, runAI: async () => JSON.stringify(value) })
    expect(result.status).toBe('candidate')
    if (result.status !== 'candidate') throw new Error('expected preserved rejected original answer')
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1({ ...s.deskInput, runId: result.summary.runId, requestKey: result.summary.requestKey }, 'situation-proposal')
    if (candidate?.schema !== 'storyforge.ttrpg-open-situation-candidate') throw new Error('expected actual candidate')
    expect(candidate.review).toBeNull(); expect(candidate.artifact.status).toBe('manual-repair')
    expect((await readProductRuntimeState(s.deskInput.sessionId)).ttrpg!.openRun!.situationReceipts ?? []).toEqual([])
  })
  it.each(['private-place', 'private-equipment', 'current-position'] as const)('retains the actual response but blocks %s without adoption, information leaks or mechanical changes', async attack => {
    const s = await setup(false), send = vi.fn(async (request: unknown) => {
      expect(JSON.stringify(request)).not.toContain(s.place)
      const run = (await readProductRuntimeState(s.deskInput.sessionId)).ttrpg!.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === run.coordination.activeEpochKey)!
      const kernel = await loadTtrpgOpenPublicSituationKernelV1({ ...s.deskInput, actorKey: 'gm' }, epoch.publicSituation!), value = publicSituationOutputV1(kernel)
      // Deliberately hostile outputs. A known NPC identity grants neither its private
      // equipment nor a current-position fact, and the private place was never read.
      if (attack === 'current-position') value.template.preconditions = [{ op: 'actor-at', actorKey: s.npc, locationRef: 'harbor' }]
      else value.template.obstacles[0].ref = attack === 'private-place' ? s.place : s.npc + '.equipment.0'
      return JSON.stringify(value)
    })
    await requestTtrpgOpenPublicSituationDeskV1({ ...s.deskInput, submissionKey: 'common.instances.unread', includeRuntimeEntities: true,
      rawInput: '结合大家已知的新守灯人和港口，为英雄拟定新局势。', maximumCostUsd: 0.1, runAI: send,
      sharingDecision: 'share-this-request-with-current-party', delegationDecision: 'adopt-this-one-candidate' })
    expect(send).toHaveBeenCalledTimes(1)
    const after = await readProductRuntimeState(s.deskInput.sessionId), page = (await readTtrpgOpenPublicSituationDeskV1(s.deskInput))!
    expect(page).toMatchObject({ adopted: false, currentWindow: true, canFinalize: false })
    expect(page.summary!.status).toBe('blocked')
    for (const hidden of [s.place, s.npc + '.equipment.0', 'INSTANCE-SITUATION-PRIVATE-NPC-PROFILE']) expect(JSON.stringify(page)).not.toContain(hidden)
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(page.request!.read!, 'public-situation-proposal')
    if (candidate?.schema !== 'storyforge.ttrpg-open-public-situation-candidate') throw new Error('expected retained original answer')
    expect(candidate.review).toBeNull(); expect(candidate.artifact.originalText).toContain(attack === 'current-position' ? 'actor-at' : attack === 'private-place' ? s.place : s.npc + '.equipment.0')
    expect(after.ttrpg!.openRun!.situationReceipts ?? []).toEqual([])
    expect(after.entities).toEqual(s.before.entities); expect(after.ttrpg!.product).toEqual(s.before.ttrpg!.product)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(s.before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.knowledge).toEqual([])
  })
  it('rolls back a real adoption storage cut, retains the committed instance receipt through a terminal cut and repairs after explicit Stop without another send', async () => {
    const s = await privateDraft(), before = await readProductRuntimeState(s.id.sessionId)
    const store = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('INSTANCE-SITUATION-STORAGE-CUT'))
    await expect(acceptTtrpgOpenSituationV1(s.command)).rejects.toThrow('INSTANCE-SITUATION-STORAGE-CUT'); store.mockRestore()
    expect(await readProductRuntimeState(s.id.sessionId)).toEqual(before)
    const terminal = vi.spyOn(db.agentRunEvents, 'add').mockRejectedValueOnce(new Error('INSTANCE-SITUATION-TERMINAL-CUT'))
    await expect(acceptTtrpgOpenSituationV1(s.command)).rejects.toBeInstanceOf(TtrpgOpenSituationReceiptPendingError); terminal.mockRestore()
    const receipt = (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!.situationReceipts![0]
    expect(receipt.runtimeEntityReferences!.references.map(row => row.entityRef).sort()).toEqual([s.npc, s.place].sort())
    await finishTtrpgOpenSituationDraftV1(s.id)
    const count = await db.productRuntimeEvents.count()
    await reconcileTtrpgOpenSituationRunV1(s.id); await reconcileTtrpgOpenSituationRunV1(s.id)
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(s.send).toHaveBeenCalledTimes(1)
    expect((await readInstanceAgentRunV1(s.id.scope, s.id.runId)).projection.state).toBe('completed')
    expect((await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!.situationReceipts).toEqual([receipt])
  })
  it('retains historical instance origins through branch cuts, parent/Run deletion and complete import, without granting an unversioned next window those identities', async () => {
    const s = await privateDraft(), event = await acceptTtrpgOpenSituationV1(s.command), receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    await finishTtrpgOpenSituationDraftV1(s.id)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.id.sessionId, 'instance.history.legacy'), viewerKey: s.id.viewerKey, triggerKind: 'request-situation', rawInput: '按原冻结资料起草另一个局势' })
    const kernel = await loadTtrpgOpenSituationKernelInputV1({ ...s.id, actorKey: 'gm' })
    expect(kernel.basis.runtimeEntityReferences).toBeUndefined()
    expect(kernel.basis.historicalRuntimeEntityReferences!.map(row => row.entityRef).sort()).toEqual([s.npc, s.place].sort())
    const value = situationGenerationOutputV1(kernel.basis); value.template.obstacles[0].ref = s.place
    await expect(reviewTtrpgOpenGeneratedSituationProposalV1({ value, basis: kernel.basis })).rejects.toThrow(/未知引用/)
    const before = await branchProductRuntimeSession({ parentSessionId: s.id.sessionId, throughSequence: event.sequence - 1, title: 'Before instance situation' })
    const child = await branchProductRuntimeSession({ parentSessionId: s.id.sessionId, throughSequence: event.sequence, title: 'After instance situation' })
    expect((await readProductRuntimeState(before.id!)).ttrpg!.openRun!.situationReceipts ?? []).toEqual([])
    await deleteProductRuntimeSession(s.id.sessionId)
    expect(await db.agentRuns.get(s.id.runId)).toBeUndefined()
    expect((await readProductRuntimeState(child.id!)).ttrpg!.openRun!.situationReceipts).toEqual([receipt])
    const importedProject = await importProjectJSON(await exportProjectJSON(s.id.scope.projectId)), restored = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray()).find(row => row.title === child.title)!
    const imported = (await readProductRuntimeState(restored.id!)).ttrpg!.openRun!.situationReceipts!
    expect(imported).toEqual([receipt]); await verifyTtrpgOpenSessionSituationHashesV1(imported)
    expect(s.send).toHaveBeenCalledTimes(1)
  })
})
