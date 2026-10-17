import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupSituationGenerationV1, situationGenerationOutputV1 } from '../helpers/open-situation-generation'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenSituationCandidateV1, recoverTtrpgOpenSituationCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenRuntimeCandidateForKernelV1 } from '../../src/lib/ttrpg/open-runtime-candidate'
import { readTtrpgOpenSituationCandidateSummaryV1 } from '../../src/lib/ttrpg/open-generated-situation-candidate'
import { acceptTtrpgOpenSituationV1, activateTtrpgOpenSessionSituationV1, completeTtrpgOpenSessionZeroV1, startTtrpgOpenEpochV1, changeTtrpgSafetyStatus,
  startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, changeTtrpgSituationV1, consultTtrpgOracleV1, closeTtrpgOpenEpochV1,
  commitTtrpgOpenOracleFactV1, retireTtrpgOpenSessionFactV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { reconcileTtrpgOpenSituationRunV1, TtrpgOpenSituationReceiptPendingError } from '../../src/lib/ttrpg/open-session-situation-adoption'
import { parseTtrpgOpenSessionSituationReceiptV1 } from '../../src/lib/ttrpg/open-session-situation-contract'
import { verifyTtrpgOpenSessionSituationHashesV1 } from '../../src/lib/ttrpg/open-session-situation-proof'
import { readTtrpgOpenSessionSituationAuditV1 } from '../../src/lib/ttrpg/open-session-situation-audit'
import { markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { ttrpgOpenSituationCatalogV1 } from '../../src/lib/ttrpg/open-session-situation-catalog'
import { finishTtrpgOpenSituationDraftV1, readTtrpgOpenSituationStopRepairsV1 } from '../../src/lib/ttrpg/open-generated-situation-stop'
import { loadTtrpgOpenSituationKernelInputV1 } from '../../src/lib/ttrpg/open-generated-situation-context'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { resumeTtrpgOpenPressureV1 } from '../../src/lib/ttrpg/open-pressure-coordinator'
import { resumeTtrpgOpenSituationsV1 } from '../../src/lib/ttrpg/open-situation-coordinator'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { nextTtrpgOpenOperationStepV1 } from '../../src/lib/ttrpg/open-operation'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { hashTtrpgOpenOracleFactCandidateV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { reviewTtrpgOpenGeneratedSituationProposalV1 } from '../../src/lib/ttrpg/open-generated-situation-contract'

async function setup(humanGm = true, configure?: Parameters<typeof setupSituationGenerationV1>[1]) {
  const f = await setupSituationGenerationV1(humanGm, configure), result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => JSON.stringify(f.value) })
  if (result.status !== 'candidate') throw new Error('fixture candidate missing')
  const id = { ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey, candidateHash: result.summary.candidateHash }
  const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(id, 'situation-proposal')
  if (candidate?.schema !== 'storyforge.ttrpg-open-situation-candidate' || !candidate.review) throw new Error('fixture private candidate missing')
  return { f, id, candidate, templateHash: await hashCanonicalValue(candidate.review.proposal.template) }
}
async function accept(s: Awaited<ReturnType<typeof setup>>) {
  return acceptTtrpgOpenSituationV1({ ...await openEnvelopeV1(s.id.sessionId, 'human.confirm.situation'), ...s.id,
    templateHash: s.templateHash, disclosure: 'player-and-discovery-text-reviewed' })
}
async function payAndMaintain(s: Awaited<ReturnType<typeof setup>>, receipt: ReturnType<typeof parseTtrpgOpenSessionSituationReceiptV1>, discover = false) {
  const template = receipt.template, admitted = (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.id.sessionId, 'actual.discovery.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '检查新局势里门口的线索' })
    const action = s.f.kernel.basis.rule.actions[0]
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(s.id.sessionId, 'actual.discovery.operation'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key,
        targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {},
        ...(discover ? { discovery: { situationKey: admitted.situations.active.find(i => i.templateKey === template.templateKey)!.situationKey, evidenceRef: template.evidence[0].clueRef,
          interventionPointKey: template.interventionPoints[0].pointKey, effectBindings: {} } } : {}) } })
    const operation = (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!.operations[0]
    if (discover) expect(operation.plan.discoveryPlan?.sessionSituation).toEqual(receipt)
    for (const required of operation.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({
      ...await openEnvelopeV1(s.id.sessionId, await ttrpgOpenOperationCommandIdV1(operation.startedRef.sessionKey, operation.operationKey, 'approval.' + required.actorKey)),
      viewerKey: OPEN_HUMAN_VIEWER, actorKey: required.actorKey, riskHash: operation.riskHash, decision: 'approve', operationKey: operation.operationKey, frozenPlanHash: operation.planHash })
    const command = { sessionId: s.id.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
    for (let i = 0; i < 16; i++) {
      const state = await readProductRuntimeState(s.id.sessionId), op = state.ttrpg!.openRun!.operations[0], next = nextTtrpgOpenOperationStepV1(op)
      if (!next || ['terminal', 'gates', 'narration', 'handoff'].includes(next.kind)) break
      if (next.kind === 'pressure') await resumeTtrpgOpenPressureV1(command)
      else if (next.kind === 'situations') await resumeTtrpgOpenSituationsV1(command)
      else await resumeTtrpgOpenOperationV1(command)
    }
  return { command, run: (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun! }
}
describe('R-TTRPGOPEN10 session-owned exact human-GM situation adoption', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('accepts one explicitly disclosed immutable definition, finishes its original Run and changes no gameplay or frozen source bytes', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.id.sessionId), buildBefore = await db.productBuilds.toArray(), event = await accept(s)
    const receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    await verifyTtrpgOpenSessionSituationHashesV1([receipt])
    expect(receipt).toMatchObject({ templateHash: s.templateHash, model: { candidateHash: s.id.candidateHash, rawResponseHash: s.candidate.rawResponseHash },
      disclosure: { kind: 'human-gm-reviewed', viewerKey: s.id.viewerKey, scope: 'player-and-discovery-text-reviewed' } })
    expect((await accept(s)).id).toBe(event.id)
    const after = await readProductRuntimeState(s.id.sessionId), { situationReceipts, ...run } = after.ttrpg!.openRun!
    expect(situationReceipts).toEqual([receipt]); expect(run).toEqual(before.ttrpg!.openRun)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(await db.productBuilds.toArray()).toEqual(buildBefore)
    const catalog = ttrpgOpenSituationCatalogV1(s.f.kernel.basis.campaign, after.ttrpg!.openRun)
    expect(catalog.byKey.get(receipt.template.templateKey)).toEqual(receipt.template)
    expect(s.f.kernel.basis.campaign.situationTemplates).toHaveLength(1)
    const original = await readInstanceAgentRunV1(s.id.scope, s.id.runId)
    expect(original.projection.state).toBe('completed'); expect(original.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
    expect(await readTtrpgOpenSituationCandidateSummaryV1(s.id)).toMatchObject({ adopted: true, requiresExplicitAcceptance: false })
    expect(await recoverTtrpgOpenSituationCandidateV1(s.id)).toMatchObject({ adopted: true, requiresExplicitAcceptance: false })
  })
  it('rejects the fallback host, another viewer and a different template/disclosure before any adoption write', async () => {
    const fallback = await setup(false)
    await expect(accept(fallback)).rejects.toThrow(/真人 GM/)
    await expect(readTtrpgOpenSessionSituationAuditV1({ ...fallback.id, templateKey: 'unknown' })).rejects.toThrow(/真人 GM/)
    expect((await readProductRuntimeState(fallback.id.sessionId)).ttrpg!.openRun).not.toHaveProperty('situationReceipts')
    const s = await setup(), envelope = await openEnvelopeV1(s.id.sessionId, 'wrong.disclosure')
    await expect(acceptTtrpgOpenSituationV1({ ...envelope, ...s.id, viewerKey: 'viewer.seat.hero', templateHash: s.templateHash, disclosure: 'player-and-discovery-text-reviewed' })).rejects.toThrow(/真人 GM/)
    await expect(acceptTtrpgOpenSituationV1({ ...envelope, ...s.id, templateHash: 'f'.repeat(64), disclosure: 'player-and-discovery-text-reviewed' })).rejects.toThrow(/披露|版本/)
    await expect(acceptTtrpgOpenSituationV1({ ...envelope, ...s.id, templateHash: s.templateHash, disclosure: 'private-only' as 'player-and-discovery-text-reviewed' })).rejects.toThrow(/披露/)
    expect((await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun).not.toHaveProperty('situationReceipts')
    await accept(s)
  })
  it('rolls back the original event/head on adoption storage failure and retries that same candidate once', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.id.sessionId)
    const spy = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('fixture situation event failure'))
    await expect(accept(s)).rejects.toThrow('fixture situation event failure'); spy.mockRestore()
    expect(await readProductRuntimeState(s.id.sessionId)).toEqual(before)
    await accept(s); expect((await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!.situationReceipts).toHaveLength(1)
  })
  it('retains a domain commit through Stop before any Run confirmation, then repairs only that original terminal receipt', async () => {
    const s = await setup(), spy = vi.spyOn(db.agentRunEvents, 'add').mockRejectedValueOnce(new Error('fixture pre-confirmation interruption'))
    await expect(accept(s)).rejects.toBeInstanceOf(TtrpgOpenSituationReceiptPendingError); spy.mockRestore()
    expect((await readInstanceAgentRunV1(s.id.scope, s.id.runId)).events.some(e => e.type === 'confirmation.recorded')).toBe(false)
    const receipt = (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!.situationReceipts![0]
    await finishTtrpgOpenSituationDraftV1(s.id)
    expect(await readTtrpgOpenSituationStopRepairsV1(s.id)).toEqual([])
    expect((await readInstanceAgentRunV1(s.id.scope, s.id.runId)).projection.state).not.toBe('cancelled')
    const count = await db.productRuntimeEvents.count(), hash = await reconcileTtrpgOpenSituationRunV1(s.id)
    expect((await readInstanceAgentRunV1(s.id.scope, s.id.runId)).projection.terminalReceiptHash).toBe(hash)
    expect((await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!.situationReceipts).toEqual([receipt]); expect(await db.productRuntimeEvents.count()).toBe(count)
    await reconcileTtrpgOpenSituationRunV1(s.id); expect(await db.productRuntimeEvents.count()).toBe(count)
  })
  it('rejects a candidate after an actual safety pause and refuses damaged stored definition bytes', async () => {
    const s = await setup()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.id.sessionId, 'pause.before.accept'), viewerKey: s.id.viewerKey, changedBy: 'gm', status: 'paused', reason: '明确暂停' })
    await expect(accept(s)).rejects.toThrow(/暂停/)
    const good = await setup(), event = await accept(good), receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    receipt.template.title += 'changed'
    await expect(verifyTtrpgOpenSessionSituationHashesV1([receipt])).rejects.toThrow(/损坏/)
  })
  it('uses a real accepted-but-uninstantiated definition as the next generation history without rewriting the frozen campaign', async () => {
    const s = await setup(), event = await accept(s), receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    await finishTtrpgOpenSituationDraftV1(s.id)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.id.sessionId, 'next.drafting'), viewerKey: s.id.viewerKey, triggerKind: 'request-situation', rawInput: '另拟一个有区别的局势' })
    const next = await loadTtrpgOpenSituationKernelInputV1({ ...s.id, actorKey: 'gm' })
    expect(next.basis.sessionTemplates).toEqual([receipt.template]); expect(next.basis.campaign.situationTemplates).toHaveLength(1)
    expect(next.basis.history).toContainEqual(expect.objectContaining({ sourceKind: 'adopted-definition', sourceRef: receipt.sourceRef, template: receipt.template }))
  })
  it('inherits only confirmed definitions through real branch cuts, parent deletion and complete backup ID remapping', async () => {
    const s = await setup(), event = await accept(s), original = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    const before = await branchProductRuntimeSession({ parentSessionId: s.id.sessionId, throughSequence: event.sequence - 1, title: 'before situation adoption' })
    const child = await branchProductRuntimeSession({ parentSessionId: s.id.sessionId, throughSequence: event.sequence, title: 'after situation adoption' })
    expect((await readProductRuntimeState(before.id!)).ttrpg!.openRun).not.toHaveProperty('situationReceipts')
    const state = await readProductRuntimeState(child.id!)
    expect(state.ttrpg!.openRun!.situationReceipts).toEqual([original])
    expect(state.ttrpg!.openRun!.coordination.calls).toEqual([])
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.situation.zero'), viewerKey: s.id.viewerKey,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    await deleteProductRuntimeSession(s.id.sessionId)
    expect(await db.agentRuns.get(s.id.runId)).toBeUndefined()
    await markAndSweepAgentRunArtifactsV1(s.id.scope.projectId)
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: s.id.scope.projectId, targets: original.artifactRefs })).rejects.toThrow(/已确认产物/)
    const inheritedAudit = await readTtrpgOpenSessionSituationAuditV1({ ...s.id, sessionId: child.id!, templateKey: original.template.templateKey })
    expect(inheritedAudit).toMatchObject({ historical: true, grantsSend: false, grantsAcceptance: false })
    expect(inheritedAudit.rawResponse).toBe(JSON.stringify(s.f.value)); expect(inheritedAudit.originalRun.sourceRunId).toBe(s.id.runId)
    const importedProject = await importProjectJSON(await exportProjectJSON(s.id.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray()).find(r => r.title === child.title)!
    const scope = await resolveScope({ scope: { projectId: importedProject, worldId: restored.worldId!, workId: restored.workId! } })
    expect(scope.projectId).not.toBe(s.id.scope.projectId)
    const inherited = (await readProductRuntimeState(restored.id!)).ttrpg!.openRun!.situationReceipts!
    expect(inherited).toEqual([original]); await verifyTtrpgOpenSessionSituationHashesV1(inherited)
    await markAndSweepAgentRunArtifactsV1(importedProject)
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: importedProject, targets: original.artifactRefs })).rejects.toThrow(/已确认产物/)
    const importedAudit = await readTtrpgOpenSessionSituationAuditV1({ scope, sessionId: restored.id!, viewerKey: s.id.viewerKey, templateKey: original.template.templateKey })
    expect(importedAudit.rawResponse).toBe(inheritedAudit.rawResponse); expect(importedAudit.originalRun).toEqual(inheritedAudit.originalRun)
  })
  it('admits the actual accepted template, discovers its private clue, and consumes real two-turn maintenance and expiry consequences', async () => {
    const s = await setup(true, pkg => {
      const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content, template = c.situationTemplates[0]
      rule.actions[0].effects = []; rule.timePolicy.existingAction = 2; rule.timePolicy.actionOverrides = []
      template.obstacles.forEach(o => { o.predicate = { op: 'world-turn-at-least', value: 20 } })
      template.noInterventionOutcome.afterWorldTurns = 2; template.consequences = []
      template.evidence[0].audience = 'gm-only'; template.evidence[0].knownByActorKeys = []
      template.evidence[0].discoveryPolicy.allowedAudience = 'private'; template.evidence[0].discoveryPolicy.recipientActorKeys = ['hero']
      template.evidence[0].discoveryPolicy.requiresPlayerConfirmation = true
      c.fronts[0].escalationStages[0].newSituationTemplateKey = null
      c.clocks[0].maximum = 8; c.clocks[0].onCompleteEffectPlanRef = null; c.clocks[0].autoAdvance.onIdleWorldTurns = 1
    })
    const adopted = await accept(s), receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(adopted.payloadJson).receipt), template = receipt.template
    await expect(activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(s.id.sessionId, 'too.early'), viewerKey: s.id.viewerKey, templateKey: template.templateKey })).rejects.toThrow(/生成窗口/)
    await finishTtrpgOpenSituationDraftV1(s.id)
    const admissionInput = { ...await openEnvelopeV1(s.id.sessionId, 'activate.actual'), viewerKey: s.id.viewerKey, templateKey: template.templateKey }
    const admission = await activateTtrpgOpenSessionSituationV1(admissionInput)
    expect((await activateTtrpgOpenSessionSituationV1(admissionInput)).id).toBe(admission.id)
    const admitted = (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!
    expect(admitted.situations.active[0]).toMatchObject({ templateKey: template.templateKey, activationReason: 'session-generation' })
    expect(admitted.worldTime.worldTurn).toBe(0); expect(admitted.knowledge).toEqual([])
    const { run } = await payAndMaintain(s, receipt, true)
    expect(run.worldTime.worldTurn).toBe(2); expect(run.knowledge[0]).toMatchObject({ evidenceRef: template.evidence[0].clueRef, recipientActorKeys: ['hero'], reliability: 'observed' })
    expect(run.situations.history).toContainEqual(expect.objectContaining({ instance: expect.objectContaining({ templateKey: template.templateKey, resolutionKind: 'no-intervention' }) }))
    expect(run.situations.cooldowns[template.templateKey]).toBeGreaterThan(2)
    expect(run.situationCycles!.every(c => c.sessionSituationRefs?.some(r => r.receiptHash === receipt.receiptHash))).toBe(true)
    const hero = await loadTtrpgOpenPlayerContextV1({ ...s.id, actorKey: 'hero' }), companion = await loadTtrpgOpenPlayerContextV1({ ...s.id, actorKey: 'companion.1' })
    expect(hero.view.knowledge).toContainEqual(expect.objectContaining({ evidenceRef: template.evidence[0].clueRef, description: template.evidence[0].description }))
    expect(companion.view.knowledge).toEqual([]); expect(JSON.stringify(hero.view)).not.toContain('PRIVATE-GENERATED-SITUATION-GOAL')
  })
  it('keeps a generated FIFO reservation and admits it only after real frozen owners release capacity, then evaluates its actual missing clue gate', async () => {
    const s = await setup(true, pkg => {
      const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content, original = c.situationTemplates[0]
      rule.actions[0].effects = []; rule.timePolicy.existingAction = 1; rule.timePolicy.actionOverrides = []
      original.obstacles.forEach(o => { o.predicate = { op: 'world-turn-at-least', value: 20 } }); original.noInterventionOutcome.afterWorldTurns = 1; original.consequences = []
      // A root intervention is a valid hypothesis without a clue. This fixture instead
      // offers only the dependent obstacle, whose prerequisite has not been observed.
      original.interventionPoints.forEach(p => { p.targetsObstacleKeys = ['lamp'] })
      c.clocks[0].maximum = 100; c.clocks[0].autoAdvance.onIdleWorldTurns = 0; c.clocks[0].onCompleteEffectPlanRef = null
      c.fronts[0].escalationStages[0].atClockValue = 100
      for (let i = 1; i < 5; i++) {
        const template = structuredClone(original); template.templateKey = 'situation.capacity.' + i
        template.evidence.forEach(e => { e.clueRef += '.capacity.' + i })
        c.situationTemplates.push(template); c.openingSituationKeys.push(template.templateKey)
      }
    })
    const event = await accept(s), receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    await finishTtrpgOpenSituationDraftV1(s.id)
    for (const templateKey of s.f.kernel.basis.campaign.openingSituationKeys) await changeTtrpgSituationV1({ ...await openEnvelopeV1(s.id.sessionId, 'capacity.' + templateKey), templateKey, activationReason: 'opening', mode: 'auto' })
    await activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(s.id.sessionId, 'queue.generated'), viewerKey: s.id.viewerKey, templateKey: receipt.template.templateKey })
    const queued = (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!
    expect(queued.situations.active).toHaveLength(5); expect(queued.situations.queued[0].templateKey).toBe(receipt.template.templateKey)
    const paid = await payAndMaintain(s, receipt), instance = paid.run.situations.active.find(i => i.templateKey === receipt.template.templateKey)!
    expect(instance).toMatchObject({ activatedAtWorldTurn: 1, noInterventionDueWorldTurn: 2, queuePosition: null })
    expect(paid.run.situations.queued).toEqual([]); expect(paid.run.situations.history).toHaveLength(5)
    await resumeTtrpgOpenChecksV1(paid.command)
    const gates = (await readProductRuntimeState(s.id.sessionId)).ttrpg!.openRun!.gateReceipts!
    expect(gates[0].result.results['hypothesis-formable']).toMatchObject({ applicability: 'applicable', passed: false })
  })
  it('cleans up only the accepted front-driven instance from the real front defeat owner and retains its exact receipt', async () => {
    const s = await setup(true, pkg => {
      const c = pkg.ttrpg!.campaign, rule = pkg.ttrpg!.rulePack.content, template = c.situationTemplates[0]
      rule.actions[0].effects = []; rule.timePolicy.existingAction = 2; rule.timePolicy.actionOverrides = []
      template.driverBinding = { kind: 'front', frontKey: c.fronts[0].frontKey }; template.consequences = []
      template.obstacles.forEach(o => { o.predicate = { op: 'world-turn-at-least', value: 20 } }); template.noInterventionOutcome.afterWorldTurns = 20
      c.clocks[0].autoAdvance.onIdleWorldTurns = 0; c.fronts[0].defeatPredicates = [{ op: 'world-turn-at-least', value: 2 }]
    })
    const event = await accept(s), receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(event.payloadJson).receipt)
    await finishTtrpgOpenSituationDraftV1(s.id)
    await activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(s.id.sessionId, 'activate.front.generated'), viewerKey: s.id.viewerKey, templateKey: receipt.template.templateKey })
    const { run } = await payAndMaintain(s, receipt)
    expect(run.fronts[0].defeated).toBe(true); expect(run.chaos.value).toBe(4)
    expect(run.situations.active).toEqual([]); expect(run.situations.history).toContainEqual(expect.objectContaining({ instance: expect.objectContaining({ templateKey: receipt.template.templateKey, resolutionKind: 'front-defeated' }) }))
    expect(run.situationReceipts).toEqual([receipt]); expect(run.pressureCycles!.some(c => c.work.some(w => w.situationTemplateKey === receipt.template.templateKey && w.completedRef))).toBe(true)
  })
  it('keeps an adopted definition readable after its referenced fact retires, without delivering or reusing that retired truth as a new generation source', async () => {
    const f = await setupSituationGenerationV1(true)
    await finishTtrpgOpenSituationDraftV1(f.input)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.input.sessionId, 'fact.source.epoch'), viewerKey: f.input.viewerKey, triggerKind: 'continue-host', rawInput: '核对守灯人的港口知识' })
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(f.input.sessionId, 'fact.source.oracle'), viewerKey: f.input.viewerKey, askedBy: 'gm',
      oracleKey: 'oracle.yes', question: '守灯人是否了解港口？', likelihoodTierKey: 'even' })
    const oracleSourceRef = (await readProductRuntimeState(f.input.sessionId)).ttrpg!.openRun!.oracleReceipts![0].sourceRef
    const proposal = { kind: 'relation' as const, subjectRef: 'keeper', predicateKey: 'knows' as const, objectRef: 'harbor', canonicalValue: true,
      detail: 'RETIRABLE-LIVE-TRUTH', sourceFactRefs: ['fact.harbor'], audience: 'party' as const, knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null }
    const envelope = await openEnvelopeV1(f.input.sessionId, 'fact.source.confirm')
    await commitTtrpgOpenOracleFactV1({ ...envelope, viewerKey: f.input.viewerKey, oracleSourceRef, proposal,
      candidateHash: await hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef, runtimeSourceHash: f.f.session.runtimeSourceHash, viewerKey: f.input.viewerKey, baseStateHash: envelope.baseStateHash }) })
    const before = (await readProductRuntimeState(f.input.sessionId)).ttrpg!.openRun!, factKey = before.factLedger!.entries[0].fact.factKey
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.input.sessionId, 'fact.source.close'), viewerKey: f.input.viewerKey, epochKey: before.coordination.activeEpochKey!, reason: '明确结束事实核对' })
    const rawInput = 'RETIRABLE-LIVE-TRUTH'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.input.sessionId, 'fact.situation.start'), viewerKey: f.input.viewerKey, triggerKind: 'request-situation', rawInput })
    const kernel = await loadTtrpgOpenSituationKernelInputV1({ ...f.input, actorKey: 'gm' }), value = situationGenerationOutputV1(kernel.basis)
    value.template.driverBinding = { kind: 'world-event', factRef: factKey }; value.template.driverBeliefs[0].factRef = factKey
    value.template.evidence[0].sourceFactRefs = [factKey]; value.template.sourceRefs.push(factKey); value.template.whyNowRefs = ['session:' + factKey, 'world:harbor:exists']
    const result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, ...await openEnvelopeV1(f.input.sessionId, 'fact.situation.prepare'), rawInput, runAI: async () => JSON.stringify(value) })
    if (result.status !== 'candidate') throw new Error('actual fact candidate missing')
    const diagnostic = await readTtrpgOpenRuntimeCandidateForKernelV1({ ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey }, 'situation-proposal')
    expect(result.summary.status, JSON.stringify(diagnostic?.artifact.issues)).toBe('usable-with-warnings')
    const id = { ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey, candidateHash: result.summary.candidateHash }
    const templateHash = await hashCanonicalValue({ ...value.template, templateKey: kernel.basis.assignedTemplateKey })
    const adopted = await acceptTtrpgOpenSituationV1({ ...await openEnvelopeV1(id.sessionId, 'fact.situation.accept'), ...id, templateHash, disclosure: 'player-and-discovery-text-reviewed' })
    const receipt = parseTtrpgOpenSessionSituationReceiptV1(JSON.parse(adopted.payloadJson).receipt)
    await finishTtrpgOpenSituationDraftV1(id)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(id.sessionId, 'retire.authority'), viewerKey: id.viewerKey, triggerKind: 'continue-host', rawInput: '明确退休这条旧事实' })
    await retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(id.sessionId, 'fact.retirement'), viewerKey: id.viewerKey, factKey, reason: '只退休当前事实，保留已采用历史定义' })
    const retiredState = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(id.sessionId, 'retire.close'), viewerKey: id.viewerKey, epochKey: retiredState.coordination.activeEpochKey!, reason: '结束本次明确退休操作' })
    await activateTtrpgOpenSessionSituationV1({ ...await openEnvelopeV1(id.sessionId, 'activate.historical'), viewerKey: id.viewerKey, templateKey: receipt.template.templateKey })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(id.sessionId, 'next.after.retirement'), viewerKey: id.viewerKey, triggerKind: 'request-situation', rawInput: '结合当前港口事实拟定另一个不同的局势' })
    const next = await loadTtrpgOpenSituationKernelInputV1({ ...id, actorKey: 'gm' })
    expect(next.basis.sessionFacts.some(f => f.factKey === factKey)).toBe(false)
    expect(next.basis.retiredSessionFacts?.some(f => f.factKey === factKey)).toBe(true)
    expect(JSON.stringify(next.context.resources)).not.toContain('RETIRABLE-LIVE-TRUTH')
    expect(next.context.resources.some(r => r.suffix === 'situation-definition.' + receipt.template.templateKey && r.mandatory)).toBe(true)
    const illegal = situationGenerationOutputV1(next.basis); illegal.template.evidence[0].sourceFactRefs = [factKey]
    await expect(reviewTtrpgOpenGeneratedSituationProposalV1({ value: illegal, basis: next.basis })).rejects.toThrow(/退休/)
    const legal = situationGenerationOutputV1(next.basis); legal.template.motive = 'protection'
    legal.template.driverBinding = { kind: 'world-event', factRef: 'fact.harbor' }
    expect((await reviewTtrpgOpenGeneratedSituationProposalV1({ value: legal, basis: next.basis })).evaluation.accepted).toBe(true)
    const followup = await generateTtrpgOpenSituationCandidateV1({ ...f.request, ...await openEnvelopeV1(id.sessionId, 'after.retirement.prepare'),
      rawInput: '结合当前港口事实拟定另一个不同的局势', runAI: async () => JSON.stringify(legal) })
    if (followup.status !== 'candidate') throw new Error('actual followup candidate missing')
    const followupDiagnostic = await readTtrpgOpenRuntimeCandidateForKernelV1({ ...f.input, runId: followup.summary.runId, requestKey: followup.summary.requestKey }, 'situation-proposal')
    expect(followup.summary.status, JSON.stringify(followupDiagnostic?.artifact.issues)).toBe('usable-with-warnings')
    const nextId = { ...f.input, runId: followup.summary.runId, requestKey: followup.summary.requestKey, candidateHash: followup.summary.candidateHash }
    await acceptTtrpgOpenSituationV1({ ...await openEnvelopeV1(id.sessionId, 'after.retirement.accept'), ...nextId,
      templateHash: await hashCanonicalValue({ ...legal.template, templateKey: next.basis.assignedTemplateKey }), disclosure: 'player-and-discovery-text-reviewed' })
    const final = (await readProductRuntimeState(id.sessionId)).ttrpg!.openRun!
    expect(final.situationReceipts).toHaveLength(2); expect(final.situationReceipts![0]).toEqual(receipt)
    expect(final.factLedger!.retirements.some(r => r.factKey === factKey)).toBe(true)
  }, 120_000) // Two complete formal source/Run/adoption paths plus real Oracle retirement, including coverage overhead.
})
