import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenInteractionV1 } from '../helpers/open-ttrpg-interaction'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenIntentCandidateV1, generateTtrpgOpenCompanionCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { startTtrpgOpenEpochV1, clarifyTtrpgOpenIntentCandidateV2, startTtrpgOpenIntentCandidateOperationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { inspectTtrpgOpenIntentRoutingV2 } from '../../src/lib/ttrpg/open-intent-clarification'
import { routeTtrpgOpenIntentV1, routeTtrpgOpenIntentV2 } from '../../src/lib/ttrpg/open-intent'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'

describe('R-TTRPGOPEN3 explicitly selected own interaction target', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it.each(['hero', 'companion.1'] as const)('clarifies the original %s self move, retaining its raw and separate risk approval', async actorKey => {
    const x = await seedOpenInteractionV1('move', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000; pkg.ttrpg!.campaign.effectPlanTemplates.find(t => t.planKey === 'interaction.move')!.parameters[0].allowedRefs = [actorKey] })
    const rawInput = '明确选择行动者本人'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(x.f.sessionId, 'self.move.epoch'), viewerKey: x.input.viewerKey, triggerKind: actorKey === 'hero' ? 'submit-action' : 'continue-host', rawInput })
    const raw = JSON.stringify({ goal: '仅本人前往集市，不替同伴移动', method: x.rule.interactionKey, targetRefs: [actorKey], declaredResources: [], declaredAssumptions: [], requestedOutcome: '不取得额外访问权限' })
    const runAI = vi.fn(async () => raw)
    const generate = actorKey === 'hero' ? generateTtrpgOpenIntentCandidateV1 : generateTtrpgOpenCompanionCandidateV1
    const generated = await generate({ ...await openEnvelopeV1(x.f.sessionId, 'self.move.generate'), ...x.input, actorKey, rawInput, maximumOutputTokens: 800, maximumCostUsd: .1, runAI })
    const before = await readProductRuntimeState(x.f.sessionId), candidate = generated.candidate
    const snapshot = { rulePack: x.f.runtimePackage.ttrpg!.rulePack.content, campaign: x.f.runtimePackage.ttrpg!.campaign, predicateContext: ttrpgOpenPredicateContextV1(before, x.f.runtimePackage.ttrpg!) }
    expect(routeTtrpgOpenIntentV2(candidate.intent!, snapshot)).toMatchObject({ route: 'no-roll', routeDetail: { interactionKey: x.rule.interactionKey } })
    expect(routeTtrpgOpenIntentV1(candidate.intent!, snapshot).route).toBe('needs-clarification')
    expect(routeTtrpgOpenIntentV2({ ...candidate.intent!, targetRefs: ['companion.2'] }, snapshot).route).not.toBe('no-roll')
    expect(() => routeTtrpgOpenIntentV2({ ...candidate.intent!, targetRefs: [actorKey, actorKey] }, snapshot)).toThrow(/重复/)
    const review = await inspectTtrpgOpenIntentRoutingV2({ scope: x.f.scope, session: (await db.productRuntimeSessions.get(x.f.sessionId))!, state: before, content: x.f.runtimePackage.ttrpg!, viewerKey: x.input.viewerKey, candidate })
    const bindings = { 'interaction.move': { actor: actorKey } }
    const base = { ...x.input, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: candidate.candidateHash }
    const selection = { goal: candidate.intent!.goal, method: x.rule.interactionKey!, targetRefs: [actorKey], requestedOutcome: candidate.intent!.requestedOutcome }
    await expect(clarifyTtrpgOpenIntentCandidateV2({ ...await openEnvelopeV1(x.f.sessionId, 'self.move.foreign'), ...base, expectedCount: review.review.attempts, selection, effectBindings: { 'interaction.move': { actor: 'companion.2' } } })).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(before)
    await clarifyTtrpgOpenIntentCandidateV2({ ...await openEnvelopeV1(x.f.sessionId, 'self.move.clarify'), ...base, expectedCount: review.review.attempts, selection, effectBindings: bindings })
    const clarified = await readProductRuntimeState(x.f.sessionId), call = clarified.ttrpg!.openRun!.coordination.calls.find(c => c.requestKey === base.requestKey)!, record = call.intentClarifications!.at(-1)!
    expect(record.request).toMatchObject({ interactionKey: x.rule.interactionKey, targetKey: actorKey, actorKey, effectBindings: bindings })
    expect(clarified.entities).toEqual(before.entities)
    expect(clarified.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(x.f.sessionId, 'self.move.start'), ...base, decision: 'start', clarificationHash: record.clarificationHash })
    const state = await readProductRuntimeState(x.f.sessionId), op = state.ttrpg!.openRun!.operations[0]
    expect(op.status).toBe('awaiting-approval')
    expect(op.plan.request).toMatchObject({ actorKey, targetKey: actorKey, interactionKey: x.rule.interactionKey })
    expect(runAI).toHaveBeenCalledOnce()
    expect(state.ttrpg!.openRun!.coordination.calls).toHaveLength(1)
    const session = (await db.productRuntimeSessions.get(x.f.sessionId))!
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(x.f.sessionId).sortBy('sequence'))).toEqual(state)
  })
})
