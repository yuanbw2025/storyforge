import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { openContextPolicyFixtureV1 } from '../helpers/open-ttrpg-context'
import { prepareTtrpgOpenIntentInputV1, prepareTtrpgOpenOracleInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { startTtrpgOpenEpochV1, consultTtrpgOracleV1 } from '../../src/lib/ttrpg/runtime-commands'
import { executeTtrpgOpenIntentRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { cancelTtrpgOpenPreparedRequestV1 } from '../../src/lib/ttrpg/open-request-cancellation'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { verifyTtrpgOpenInputEvidenceV1 } from '../../src/lib/ttrpg/open-input-evidence'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { TtrpgOpenContextPolicyV1 } from '../../src/lib/ttrpg/open-context-policy'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
const rawInput = 'storm 调查河港', output = JSON.stringify({ goal: '调查河港', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
function policy(): TtrpgOpenContextPolicyV1 {
  const result = openContextPolicyFixtureV1()
  result.maximumContextTokens = 8000
  result.triggers[0].trigger = { ...result.triggers[0].trigger, logic: 'text-match', predicate: null,
    timing: { stickyWorldTurns: 0, cooldownWorldTurns: 3, delayWorldTurns: 0 }, injectText: 'VISIBLE-STORM-GUIDANCE' }
  return result
}
async function setup(contextPolicy = policy()) {
  const f = await readyOpenTtrpgSessionV1('formal context', pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    pkg.ttrpg!.campaign.contextPolicy = contextPolicy
  })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'context.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
  const prepare = async (commandId: string) => prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.sessionId, commandId), scope: f.scope,
    actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput, maximumOutputTokens: 800, maximumCostUsd: 0.1, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
  return { ...f, prepare }
}
describe('R-TTRPGOPEN7 actual frozen runtime context selection', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('rejects an owner snapshot after actual consent revocation during reads, before creating any Run', async () => {
    const f = await setup(), p = CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenAuthority')!.resources!, original = p.openReadSession!.bind(p)
    let revoked = false
    vi.spyOn(p, 'openReadSession').mockImplementation(async scope => {
      const snapshot = await original(scope)
      return { ...snapshot, provider: { ...snapshot.provider, read: async request => {
        const result = await snapshot.provider.read(request)
        if (!revoked) {
          const seat = await db.ttrpgSessionParticipants.where('sessionId').equals(f.sessionId).filter(seat => seat.actorKey === 'hero').first()
          await db.ttrpgSessionParticipants.update(seat!.id!, { consent: { ...seat!.consent, aiAdviceAllowed: false } })
          revoked = true
        }
        return result
      } } }
    })
    await expect(f.prepare('revoked-in-flight')).rejects.toThrow(/变化|授权/)
    expect(revoked).toBe(true); expect(await db.agentRuns.count()).toBe(0)
  })
  it('uses matching guidance in the actual request while keeping unreadable negated conditions and other-player text out', async () => {
    const p = policy(), base = p.triggers[0].trigger
    p.triggers.push({ consumers: ['actor'], trigger: { ...base, triggerKey: 'hidden.condition', group: null, logic: 'predicate', textPatterns: [],
      predicate: { op: 'not', of: { op: 'front-stage-at-least', frontKey: 'front.harbor', stageKey: 'stage.warning' } }, injectText: 'SECRET-CONDITION-LEAK' } })
    // Use a real frozen front/stage rather than inventing author references.
    const f = await readyOpenTtrpgSessionV1('formal privacy', pkg => {
      const front = pkg.ttrpg!.campaign.fronts[0]
      p.triggers[1].trigger.predicate = { op: 'not', of: { op: 'front-stage-at-least', frontKey: front.frontKey, stageKey: front.escalationStages[0].stageKey } }
      pkg.ttrpg!.campaign.contextPolicy = p; pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'privacy.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.sessionId, 'privacy.prepare'), scope: f.scope, actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER,
      rawInput, maximumOutputTokens: 800, maximumCostUsd: 0.1, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    expect(JSON.stringify(prepared.messages)).toContain('VISIBLE-STORM-GUIDANCE')
    expect(JSON.stringify(prepared.messages)).not.toContain('SECRET-CONDITION-LEAK')
    expect(prepared.evidence.contextSelection!.deliveredTriggerKeys).toEqual(['harbor.storm'])
    expect(prepared.evidence.contextSelection!.matchedTriggerKeys).not.toContain('hidden.condition')
  })
  it('does not consume cooldown for unsent cancellation, then consumes the actual dispatched input across refresh', async () => {
    const f = await setup(), first = await f.prepare('first')
    const read = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }
    await cancelTtrpgOpenPreparedRequestV1({ ...read, requestKey: first.requestKey, runId: first.runId })
    const second = await f.prepare('second')
    expect(second.evidence.contextSelection!.deliveredTriggerKeys).toEqual(['harbor.storm'])
    await executeTtrpgOpenIntentRequestV1({ ...read, requestKey: second.requestKey, runId: second.runId, runAI: async () => output })
    db.close(); await db.open()
    const third = await f.prepare('third')
    expect(third.evidence.contextSelection!.deliveredTriggerKeys).toEqual([])
    expect(JSON.stringify(third.messages)).not.toContain('VISIBLE-STORM-GUIDANCE')
    expect(parseTtrpgRuntimeStateV2((await readProductRuntimeState(f.sessionId)).ttrpg)!.openRun!.worldTime.worldTurn).toBe(0)
  })
  it('drops oversized dynamic guidance whole and retains protected rules; protected overflow creates no Run', async () => {
    const p = policy(); p.maximumContextTokens = 3000; p.triggers[0].trigger.injectText = 'LONG-GUIDANCE '.repeat(1400)
    const f = await setup(p), prepared = await f.prepare('budget')
    expect(prepared.evidence.contextSelection!.tokenBudget.tiers.find(tier => tier.tierKey === 'dynamic-injection')!.demoted).toBe(true)
    expect(prepared.evidence.contextSelection!.deliveredTriggerKeys).toEqual([])
    expect(JSON.stringify(prepared.messages)).not.toContain('LONG-GUIDANCE')
    expect(prepared.evidence.selector.selected.some(row => row.resourceKey.endsWith(':rules-core'))).toBe(true)
    const low = policy(); low.maximumContextTokens = 256
    const blocked = await setup(low), before = await db.agentRuns.count()
    await expect(blocked.prepare('overflow')).rejects.toThrow(/不可降级上下文/)
    expect(await db.agentRuns.count()).toBe(before)
  })
  it('rejects a rehashed caller-supplied receipt that differs from the exact retained request', async () => {
    const f = await setup(), prepared = await f.prepare('proof'), evidence = structuredClone(prepared.evidence)
    evidence.contextSelection!.deliveredTriggerKeys = []
    const { receiptHash: _receiptHash, ...body } = evidence.contextSelection!
    evidence.contextSelection!.receiptHash = await hashCanonicalValue(body)
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(f.sessionId)).ttrpg)!
    await expect(verifyTtrpgOpenInputEvidenceV1({ scope: f.scope, sessionId: f.sessionId, sessionKey: runtime.sessionKey, actorKey: 'hero', runId: prepared.runId,
      stepId: 'ttrpg.open.intent', attempt: 1, evidence, requestHash: prepared.reservation.requestHash, inputManifestHash: prepared.reservation.inputManifestHash, mode: 'dispatch' })).rejects.toThrow(/原始请求字节/)
  })
  it('retains modern E14 proof but fails closed when a full backup rebinds local Run identity', async () => {
    const f = await setup(), prepared = await f.prepare('portable')
    expect(prepared.evidence.contextAssembly!.eventType).toBe('ttrpg.context.assembled')
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const importedCall = parseTtrpgRuntimeStateV2((await readProductRuntimeState(session.id!)).ttrpg)!.openRun!.coordination.calls[0]
    const rows = await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray()
    expect(rows).toHaveLength(1); expect(rows[0].contractHash).not.toBe(importedCall.runContractHash)
    const send = vi.fn(async () => output)
    await expect(executeTtrpgOpenIntentRequestV1({ scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER, runId: rows[0].id!, requestKey: importedCall.requestKey,
      runAI: send })).rejects.toThrow(/请求|运行|契约/)
    expect(send).not.toHaveBeenCalled()
    const retained = (await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()).some(row => {
      try { const value = JSON.parse(row.content ?? 'null'); return value?.schema === 'storyforge.ttrpg-open-input-evidence'
        && value.contextAssembly?.receiptHash === prepared.evidence.contextAssembly!.receiptHash } catch { return false }
    })
    expect(retained).toBe(true)
    expect(parseTtrpgRuntimeStateV2((await readProductRuntimeState(f.sessionId)).ttrpg)!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('does not send GM-only authored guidance to a party Oracle consultation', async () => {
    const p = policy(), base = p.triggers[0].trigger
    p.triggers = [{ consumers: ['gm-assistant'], trigger: { ...base, triggerKey: 'gm.secret', logic: 'always', textPatterns: [], audience: 'gm-only', sourceRefs: [], injectText: 'UNRELATED-GM-GUIDANCE' } }]
    const f = await setup(p)
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, 'oracle'), viewerKey: OPEN_HUMAN_VIEWER, askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '码头会下雨吗？', likelihoodTierKey: 'even' })
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(f.sessionId)).ttrpg)!
    const prepared = await prepareTtrpgOpenOracleInputV1({ ...await openEnvelopeV1(f.sessionId, 'oracle.context'), scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER,
      rawInput, oracleSourceRef: runtime.openRun!.oracleReceipts![0].sourceRef, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.1 })
    expect(prepared.evidence.contextSelection!.deliveredTriggerKeys).toEqual([])
    expect(JSON.stringify(prepared.messages)).not.toContain('UNRELATED-GM-GUIDANCE')
  })
})
