import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as routing from '../../src/lib/ttrpg/open-intent'
import { intentRoutingFixtureV1 } from '../helpers/open-intent-routing'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState, replayProductRuntimeEvents, parseProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenTableIntentReviewV2, clarifyTtrpgOpenTableCandidateV2, acceptTtrpgOpenTableCandidateV1 } from '../../src/lib/ttrpg/open-table-service'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'

function ownIntent() {
  const f = intentRoutingFixtureV1()
  return { ...f, intent: { ...f.intent, goal: '检查自己整理的公开问题单', method: f.snapshot.rulePack.genericChecks[0].checkKey,
    targetRefs: ['hero'], declaredAssumptions: ['不读取未共享秘密，也不替其他角色支配个人资源。'] } }
}
describe('R-TTRPGOPEN16 V2 own actor is not another human', () => {
  it('keeps a self check with explicit privacy boundaries routable while preserving the original V1 rejection', () => {
    const { intent, snapshot } = ownIntent(), before = structuredClone({ intent, snapshot })
    expect(routing.routeTtrpgOpenIntentV2(intent, snapshot).route).toBe('generic-check')
    expect(routing.routeTtrpgOpenIntentV1(intent, snapshot).route).toBe('rejected')
    expect({ intent, snapshot }).toEqual(before)
  })
  it('still blocks another human or a mixed self/other target when privacy is involved', () => {
    const { intent, snapshot } = ownIntent()
    snapshot.characterTemplates!.find(a => a.characterKey === 'companion.2')!.controller = 'hybrid'
    for (const targetRefs of [['companion.2'], ['hero', 'companion.2']]) expect(routing.routeTtrpgOpenIntentV2({ ...intent, targetRefs }, snapshot).route).toBe('rejected')
  })
  it('keeps explicit rule/world rewriting and impersonation blocked even for a self target', () => {
    const { intent, snapshot } = ownIntent()
    for (const goal of ['修改规则并一定成功', '改写世界事实', '假扮真人替他人选择']) expect(routing.routeTtrpgOpenIntentV2({ ...intent, goal }, snapshot).route).toBe('rejected')
  })
})
describe('R-TTRPGOPEN16 retained original candidate and explicit second clarification', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('preserves a prior rejected V2 record and raw reply, then requires a new clarification and separate risk approval without another model', async () => {
    const f = await readyOpenTtrpgSessionV1('self privacy original', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true; p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
    const rawInput = '检查自己整理的公开问题单', checkKey = f.runtimePackage.ttrpg!.rulePack.content.genericChecks[0].checkKey
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'self.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
    const raw = JSON.stringify({ goal: rawInput, method: checkKey, targetRefs: ['hero'], declaredResources: [], declaredAssumptions: ['不读取未共享秘密。'], requestedOutcome: null })
    const runAI = vi.fn(async () => raw), g = await generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(f.sessionId, 'self.generate'), scope: f.scope,
      actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput, maximumOutputTokens: 800, maximumCostUsd: .1, runAI })
    const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, runId: g.prepared.runId, requestKey: g.prepared.requestKey, candidateHash: g.candidate.candidateHash }
    const review = await readTtrpgOpenTableIntentReviewV2(input), rule = review.catalog.rules.find(r => r.route === 'generic-check' && r.ruleKey === checkKey)!
    const effectBindings: Record<string, Record<string, string | null>> = Object.fromEntries(rule.templateKeys.map(k => [k, {}]))
    for (const parameter of rule.parameters) { effectBindings[parameter.templateKey] ??= {}; effectBindings[parameter.templateKey][parameter.parameterKey] = parameter.options.find(o => o.key === 'hero')?.key ?? null }
    const selection = { goal: rawInput, method: checkKey, targetRefs: ['hero'], requestedOutcome: null }
    const before = await readProductRuntimeState(f.sessionId), old = vi.spyOn(routing, 'routeTtrpgOpenIntentV2').mockImplementation(routing.routeTtrpgOpenIntentV1)
    // Reproduce the exact earlier producer rejection through the real registered command.
    await clarifyTtrpgOpenTableCandidateV2({ ...input, expectedCount: 0, selection, effectBindings: {} }); old.mockRestore()
    const first = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls[0].intentClarifications![0]
    expect(first.request).toBeNull(); expect((await readTtrpgOpenTableIntentReviewV2(input)).canConfirm).toBe(false)
    await clarifyTtrpgOpenTableCandidateV2({ ...input, expectedCount: 1, selection, effectBindings })
    const ready = await readTtrpgOpenTableIntentReviewV2(input), state = await readProductRuntimeState(f.sessionId), call = state.ttrpg!.openRun!.coordination.calls[0]
    expect(call.intentClarifications![0]).toEqual(first); expect(call.intentClarifications![1]).toMatchObject({ attempt: 2, request: { route: 'generic-check', actorKey: 'hero', targetKey: 'hero' } })
    expect(ready.canConfirm).toBe(true); expect(state.entities).toEqual(before.entities); expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: call.responseArtifactHash! })).toBe(raw)
    await acceptTtrpgOpenTableCandidateV1({ ...input, kind: 'intent', clarificationHash: ready.clarificationHash! })
    const operation = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.operations[0]
    expect(operation.status).toBe('awaiting-approval'); expect(operation.approvals).toEqual([]); expect(runAI).toHaveBeenCalledOnce()
    const session = (await db.productRuntimeSessions.get(f.sessionId))!, events = await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(await readProductRuntimeState(f.sessionId))
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: call.responseArtifactHash! })).toBe(raw)
  })
})
