import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, seedOpenTtrpgSessionV1, configureOpenSeatsV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { seedTtrpgWorldPatchReviewV1 } from '../helpers/open-ttrpg-world-patch'
import { createTtrpgOpenSituationContextProviderV1, loadTtrpgOpenSituationContextV1 } from '../../src/lib/ttrpg/open-generated-situation-context'
import { loadTtrpgOpenSituationProposalBasisV1 } from '../../src/lib/ttrpg/open-generated-situation-basis'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, consultTtrpgOracleV1, startTtrpgOpenOperationV1,
  changeTtrpgSafetyStatus, retireTtrpgOpenSessionFactV1, startTtrpgOpenRunV1, completeTtrpgOpenSessionZeroV1, recordTtrpgOpenHumanNarrationV1, postTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/runtime-commands'
import { assertTtrpgOpenEpochPurposeV1, parseTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/open-coordination'
import { createTtrpgOpenHostingDelegationV1 } from '../../src/lib/ttrpg/open-hosting-delegation'
import { readProductRuntimeState, replayProductRuntimeEvents, parseProductRuntimeState, applyProductRuntimeEvent, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import { AGENT_TOOL_SCHEMA_HASH_V1 } from '../../src/lib/agent/execution-binding'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenIntentRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readTtrpgSessionParticipantsV2, configureTtrpgSessionParticipantV2 } from '../../src/lib/ttrpg/participants'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import type { FrozenResourceScopeV1 } from '../../src/lib/registry/types'

const provider = createTtrpgOpenSituationContextProviderV1(), rawInput = '结合当前调查和玩家身份生成一个新的局势候选'
const modelIdentity = { provider: 'test-adapter', model: 'injected' }
async function setup(enabled = true, gmAdvice = true) {
  const create = gmAdvice ? readyOpenTtrpgSessionV1 : seedOpenTtrpgSessionV1
  const f = await create('GM situation source', p => {
    p.ttrpg!.campaign.runtimePolicy.enabled = enabled
    p.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid'
  })
  if (!gmAdvice) {
    await configureOpenSeatsV1(f.sessionId)
    const gm = (await readTtrpgSessionParticipantsV2(f.sessionId)).find(s => s.role === 'gm')!
    await configureTtrpgSessionParticipantV2({ sessionId: f.sessionId, seatKey: gm.seatKey, expectedRevision: gm.revision, requestedByViewerKey: gm.viewerKey, commandId: 'gm.no.advice', consent: { aiAdviceAllowed: false } })
    const state = await readProductRuntimeState(f.sessionId)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(f.sessionId, 'zero'), viewerKey: OPEN_HUMAN_VIEWER, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    await startTtrpgOpenRunV1({ ...await openEnvelopeV1(f.sessionId, 'start'), viewerKey: OPEN_HUMAN_VIEWER })
  }
  return { f, input: { scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' },
    scope: { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' } }
}
async function start(sessionId: number, viewerKey = OPEN_HUMAN_VIEWER, commandId = 'situation.start') {
  return startTtrpgOpenEpochV1({ ...await openEnvelopeV1(sessionId, commandId), viewerKey, triggerKind: 'request-situation', rawInput })
}
async function readAll(scope: FrozenResourceScopeV1) {
  const page = await provider.listMetadata({ scope, limit: 1000 })
  const bodies = await Promise.all(page.items.map(async d => JSON.parse((await provider.read({ scope, resourceKey: d.resourceKey, depth: 'full', maxTokens: 16000 })).content)))
  return { page, bodies }
}
describe('R-TTRPGOPEN10 source and passive situation authority foundation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('freezes the actual tool declaration and adds no grant to any existing runtime Skill', async () => {
    expect(await hashCanonicalValue(getAgentToolSchemaSnapshotV1())).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
    expect(CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenSituationInput')!.resources!.providerId).toBe('storyforge.ttrpgOpenSituationInput')
    for (const id of ['prose.ttrpg-open-intent', 'prose.ttrpg-open-companion', 'prose.ttrpg-open-kp', 'prose.ttrpg-open-brief', 'prose.ttrpg-open-oracle-interpret']) {
      expect(getAgentSkillV1(id).contextSourceKeys).not.toContain('ttrpgOpenSituationInput')
    }
  })
  it('requires the exact explicit window before metadata, search, fingerprint or any full resource is returned', async () => {
    const f = await setup()
    await expect(provider.listMetadata({ scope: f.scope, limit: 10 })).rejects.toThrow(/生成窗口/)
    await expect(provider.searchMetadata({ scope: f.scope, limit: 10, query: '私密' })).rejects.toThrow(/生成窗口/)
    await expect(provider.fingerprint(f.scope)).rejects.toThrow(/生成窗口/)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.f.sessionId, 'ordinary'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
    await expect(loadTtrpgOpenSituationContextV1(f.input)).rejects.toThrow(/生成窗口/)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('starts and replays a one-call zero-action window without changing gameplay, and survives refresh', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.f.sessionId)
    const envelope = { ...await openEnvelopeV1(f.f.sessionId, 'one.request'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'request-situation' as const, rawInput }
    const event = await startTtrpgOpenEpochV1(envelope)
    expect((await startTtrpgOpenEpochV1(envelope)).id).toBe(event.id)
    const after = await readProductRuntimeState(f.f.sessionId), epoch = after.ttrpg!.openRun!.coordination.epochs[0]
    expect(epoch).toMatchObject({ triggerKind: 'request-situation', budget: { maximumCalls: 1, maximumAiActions: 0 } })
    const { coordination: _a, ...game } = after.ttrpg!.openRun!, { coordination: _b, ...original } = before.ttrpg!.openRun!
    expect(game).toEqual(original); expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product)
    const session = (await db.productRuntimeSessions.get(f.f.sessionId))!, events = await db.productRuntimeEvents.where('sessionId').equals(f.f.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(after)
    const context = await loadTtrpgOpenSituationContextV1(f.input)
    db.close(); await db.open()
    expect(await loadTtrpgOpenSituationContextV1(f.input)).toEqual(context); expect(await db.agentRuns.count()).toBe(0)
  })
  it('returns complete scoped resources and real identity values, excluding whole owners, memory prose and private human authority', async () => {
    const f = await setup(); await start(f.f.sessionId)
    const before = await readProductRuntimeState(f.f.sessionId), context = await loadTtrpgOpenSituationContextV1(f.input), result = await readAll(f.scope)
    const mandatory = result.page.items.filter(d => d.priority === 'must-read')
    for (const suffix of ['situation-contract', 'situation-frame', 'situation-directory', 'situation-recent-history']) expect(mandatory.some(d => d.resourceKey.endsWith(':' + suffix))).toBe(true)
    expect(result.bodies.find(b => b.schema === 'storyforge.ttrpg-open-situation-input-contract')).toMatchObject({
      homogeneityThreshold: 0.8, historyComparisonLimit: 8, cooldownWorldTurns: 3 })
    const identities = result.bodies.filter(b => b.source?.kind === 'identity')
    expect(identities).toHaveLength(3)
    for (const entry of identities) expect(await hashCanonicalValue(entry.value)).toBe(entry.source.contentHash)
    expect(identities[0].value.name).toBeTruthy(); expect(identities[0].grantsPlayerCommitment).toBe(false)
    const text = JSON.stringify(result.bodies)
    for (const forbidden of ['runtimeHeadStateJson', 'frozenContent', 'viewerKey', 'open.foundation.seed', 'coordination', 'memoryReceipts', 'runtimePackage']) expect(text).not.toContain(forbidden)
    expect(context).not.toHaveProperty('loaded'); expect(context).not.toHaveProperty('basis')
    expect(await readProductRuntimeState(f.f.sessionId)).toEqual(before)
    await expect(loadTtrpgOpenSituationProposalBasisV1({ ...f.input, viewerKey: OPEN_HUMAN_VIEWER, proposalKey: 'fallback.no.gm' })).rejects.toThrow(/真人 GM/)
  })
  it('blocks ordinary actions, Oracle, delegated hosting and unrelated model purposes before any write or Run', async () => {
    const f = await setup(); await start(f.f.sessionId)
    const before = await readProductRuntimeState(f.f.sessionId), epoch = before.ttrpg!.openRun!.coordination.epochs[0]
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.f.sessionId, 'deny.action'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: 'investigate', targetKey: 'keeper', effectBindings: {} } })).rejects.toThrow(/局势生成窗口/)
    await expect(consultTtrpgOracleV1({ ...await openEnvelopeV1(f.f.sessionId, 'deny.oracle'), viewerKey: OPEN_HUMAN_VIEWER,
      askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '码头安全吗？', likelihoodTierKey: 'even' })).rejects.toThrow(/局势生成窗口/)
    expect(() => createTtrpgOpenHostingDelegationV1(before, { epochKey: epoch.epochKey, viewerKey: OPEN_HUMAN_VIEWER, maximumCostUsdPerCall: 0.1, sequence: before.lastSequence + 1 })).toThrow(/当前窗口/)
    await expect(prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(f.f.sessionId, 'deny.intent'), scope: f.f.scope, actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput,
      modelIdentity, maximumOutputTokens: 800, maximumCostUsd: 0.1 })).rejects.toThrow(/局势生成窗口/)
    for (const skill of ['prose.ttrpg-open-brief', 'prose.ttrpg-open-kp', 'prose.ttrpg-open-oracle-interpret']) expect(() => assertTtrpgOpenEpochPurposeV1(epoch, skill)).toThrow()
    expect(() => assertTtrpgOpenEpochPurposeV1(epoch, 'prose.ttrpg-open-situation-propose')).not.toThrow()
    expect(() => assertTtrpgOpenEpochPurposeV1({ triggerKind: 'submit-action' }, 'prose.ttrpg-open-situation-propose')).toThrow()
    expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(f.f.sessionId)).toEqual(before)
  })
  it('keeps semantic input bytes stable across unrelated table discussion while retaining the real newer read stamp', async () => {
    const f = await setup(); await start(f.f.sessionId)
    const before = await readAll(f.scope), pinned = await provider.openReadSession!(f.scope)
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(f.f.sessionId, 'discussion'), viewerKey: OPEN_HUMAN_VIEWER,
      submissionKey: 'unrelated.discussion', request: { kind: 'out-of-character', audience: 'party', text: '桌外讨论不是玩家承诺，也不是世界事实。' } })
    const after = await readAll(f.scope)
    expect(after.bodies).toEqual(before.bodies)
    expect(after.page.scopeFingerprint).not.toBe(before.page.scopeFingerprint)
    const beforeRef = before.page.items[0].sourceRefs.find(r => r.table === 'productRuntimeSessions')!
    const afterRef = after.page.items[0].sourceRefs.find(r => r.table === 'productRuntimeSessions')!
    expect(afterRef.revision).toBeGreaterThan(beforeRef.revision as number)
    expect(afterRef.contentHash).not.toBe(beforeRef.contentHash)
    await expect(pinned.assertCurrent()).rejects.toThrow(/变化/)
    await expect(provider.listMetadata({ scope: f.scope, limit: 1000, cursor: before.page.nextCursor ?? 'invalid' })).rejects.toThrow(/stale/)
  })
  it('rejects invented budgets, successful actions and manual authorization in both parsing and offline replay', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.f.sessionId), event = await start(f.f.sessionId)
    const payload = JSON.parse(event.payloadJson), epoch = payload.epoch
    for (const bad of [{ ...epoch, budget: { ...epoch.budget, maximumCalls: 2 } }, { ...epoch, budget: { ...epoch.budget, maximumAiActions: 1 } },
      { ...epoch, successfulActorKeys: ['hero'] }, { ...epoch, manualAction: { requestJson: '{}', requestHash: 'a'.repeat(64) } }]) {
      expect(() => parseTtrpgOpenEpochV1(bad)).toThrow()
      expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify({ ...payload, epoch: bad }) })).toThrow()
    }
    for (const type of ['ttrpg.fact.retired', 'ttrpg.world-turn.advanced', 'ttrpg.front.telegraphed', 'ttrpg.open.hosting.delegated']) {
      expect(() => applyProductRuntimeEvent(awaitState(event, before), { ...event, type: type as any, sequence: event.sequence + 1, payloadJson: '{}' })).toThrow(/局势生成窗口/)
    }
  })
  it('denies another player, disabled runtime, missing GM advice consent, pending action and a duplicate window', async () => {
    const f = await setup()
    await expect(start(f.f.sessionId, 'viewer.seat.companion.1')).rejects.toThrow(/主持/)
    await start(f.f.sessionId)
    await expect(start(f.f.sessionId, OPEN_HUMAN_VIEWER, 'second.window')).rejects.toThrow()
    const disabled = await setup(false)
    await expect(start(disabled.f.sessionId)).rejects.toThrow(/未允许/)
    const noAdvice = await setup(true, false)
    await expect(start(noAdvice.f.sessionId)).rejects.toThrow(/GM/)
    await expect(provider.listMetadata({ scope: noAdvice.scope, limit: 10 })).rejects.toThrow()
    const pending = await setupChecksFixtureV1({ ai: true })
    await expect(start(pending.f.sessionId)).rejects.toThrow()
  })
  it('enforces exact actor/work scope, atomic full JSON, original-read denial and query-bound cursors', async () => {
    const f = await setup(); await start(f.f.sessionId)
    const page = await provider.listMetadata({ scope: f.scope, limit: 1 }), key = page.items[0].resourceKey
    await expect(provider.read({ scope: f.scope, resourceKey: key, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(provider.read({ scope: f.scope, resourceKey: key, depth: 'summary', maxTokens: 16000 })).rejects.toThrow(/完整/)
    await expect(provider.readOriginal({ scope: f.scope, resourceKey: key, maxTokens: 16000 })).rejects.toThrow()
    await expect(provider.listMetadata({ scope: { ...f.scope, runtimeActorKey: 'hero' }, limit: 10 })).rejects.toThrow(/GM/)
    await expect(provider.searchMetadata({ scope: f.scope, limit: 1, query: 'actor', cursor: page.nextCursor! })).rejects.toThrow(/查询/)
    const other = await setup()
    await expect(provider.listMetadata({ scope: { ...other.scope, productRuntimeSessionId: f.f.sessionId }, limit: 10 })).rejects.toThrow()
  })
  it('rechecks actual authority before pinned cached bytes or metadata after pause, cancellation and inconsistent seat data', async () => {
    const f = await setup(); await start(f.f.sessionId)
    const pinned = await provider.openReadSession!(f.scope), page = await pinned.provider.listMetadata({ scope: f.scope, limit: 1 })
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.f.sessionId, 'pause'), viewerKey: OPEN_HUMAN_VIEWER, changedBy: 'hero', status: 'paused', reason: '明确暂停生成' })
    await expect(pinned.provider.listMetadata({ scope: f.scope, limit: 10 })).rejects.toThrow()
    await expect(pinned.provider.read({ scope: f.scope, resourceKey: page.items[0].resourceKey, depth: 'full', maxTokens: 16000 })).rejects.toThrow()
    await expect(pinned.assertCurrent()).rejects.toThrow()
    const epoch = (await readProductRuntimeState(f.f.sessionId)).ttrpg!.openRun!.coordination.epochs[0]
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.f.sessionId, 'cancel'), viewerKey: OPEN_HUMAN_VIEWER, epochKey: epoch.epochKey, reason: '明确取消' })
    await expect(provider.listMetadata({ scope: f.scope, limit: 10 })).rejects.toThrow()
    const second = await setup(); await start(second.f.sessionId)
    const cache = await provider.openReadSession!(second.scope), gm = (await readTtrpgSessionParticipantsV2(second.f.sessionId)).find(s => s.role === 'gm')!
    // Corrupt only this isolated fixture: the actual API forbids changing consent after Session Zero.
    await db.ttrpgSessionParticipants.update(gm.id!, { consent: { ...gm.consent, aiAdviceAllowed: false } })
    await expect(cache.provider.searchMetadata({ scope: second.scope, limit: 10, query: '秘密' })).rejects.toThrow(/stale|变化/)
  })
  it('projects actual normally produced GM facts while excluding retired entries and unconfirmed narrative belief, and prevents fact edits in the drafting window', async () => {
    const f = await seedTtrpgWorldPatchReviewV1(), current = await readProductRuntimeState(f.host.sessionId)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.host.sessionId, 'old.close'), viewerKey: f.host.viewerKey, epochKey: current.ttrpg!.openRun!.coordination.activeEpochKey!, reason: '结束原主持窗口' })
    await start(f.host.sessionId, f.host.viewerKey)
    const scope = { ...f.host.scope, productRuntimeSessionId: f.host.sessionId, runtimeActorKey: 'gm' }, result = await readAll(scope)
    const text = JSON.stringify(result.bodies)
    expect(text).toContain('GM-PATCH-REQUIRES-CHOICE'); expect(text).toContain('PRIVATE-PATCH-REQUIRES-CHOICE')
    expect(text).not.toContain('RETIRED-PATCH-EXCLUDED'); expect(text).not.toContain('BELIEF-MEMORY-MUST-NOT-BECOME-FACT')
    const before = await readProductRuntimeState(f.host.sessionId)
    await expect(retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(f.host.sessionId, 'deny.fact.edit'), viewerKey: f.host.viewerKey, factKey: f.entries[0].fact.factKey, reason: '不能借用生成窗口改写事实' })).rejects.toThrow(/局势生成窗口/)
    expect(await readProductRuntimeState(f.host.sessionId)).toEqual(before)
  })
  it('delivers a completed human choice body together with its exact approval proof without inventing a promise', async () => {
    const f = await setupChecksFixtureV1({ humanGm: true, ai: true }); await resumeTtrpgOpenPlayV1(f.command)
    await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.f.sessionId, f.command.operationKey, 'narration'), viewerKey: 'viewer.gm', text: '本次调查已完成。', reason: 'host-authored' })
    await resumeTtrpgOpenPlayV1(f.command)
    const state = await readProductRuntimeState(f.f.sessionId)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.f.sessionId, 'action.close'), viewerKey: OPEN_HUMAN_VIEWER, epochKey: state.ttrpg!.openRun!.coordination.activeEpochKey!, reason: '结束已完成行动' })
    await start(f.f.sessionId, 'viewer.gm')
    const context = await loadTtrpgOpenSituationContextV1({ scope: f.f.scope, sessionId: f.f.sessionId, actorKey: 'gm' })
    const entry = context.resources.map(r => r.value as any).find(v => v.source?.kind === 'choice')
    expect(entry.value.status).toBe('completed'); expect(entry.value.request.actorKey).toBe('hero')
    expect(await hashCanonicalValue(entry.value.approval)).toBe(entry.source.contentHash)
    expect(entry.value.grantsPlayerCommitment).toBe(false)
    const actor = context.resources.find(r => r.suffix === 'entity.hero')!.value as any
    expect(actor.current.attributes).toEqual((await readProductRuntimeState(f.f.sessionId)).entities.hero.attributes)
    expect(actor.current.abilityStates.length).toBeGreaterThan(0)
  })
  it('requires a fresh human request on a branch and preserves authorized source semantics across full backup remapping', async () => {
    const f = await setup(); await start(f.f.sessionId)
    const parent = await loadTtrpgOpenSituationContextV1(f.input), state = await readProductRuntimeState(f.f.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: f.f.sessionId, throughSequence: state.lastSequence, title: 'new generation branch' })
    const childScope = { ...f.scope, productRuntimeSessionId: child.id! }
    await expect(provider.listMetadata({ scope: childScope, limit: 10 })).rejects.toThrow()
    const childState = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.zero'), viewerKey: OPEN_HUMAN_VIEWER,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: childState.ttrpg!.product.sessionZero.requiredItemKeys })
    await start(child.id!)
    const context = await loadTtrpgOpenSituationContextV1({ ...f.input, sessionId: child.id! })
    expect(context.frame.assignedTemplateKey).not.toBe(parent.frame.assignedTemplateKey)
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => JSON.parse(row.initialStateJson).ttrpg.sessionKey === context.frame.sessionKey)!
    const workspace = await resolveScope({ scope: { projectId, worldId: copy.worldId, workId: copy.workId } })
    const imported = await loadTtrpgOpenSituationContextV1({ scope: workspace, sessionId: copy.id!, actorKey: 'gm' })
    expect(imported.resources).toEqual(context.resources); expect(imported.frame).toEqual(context.frame)
    expect(await db.agentRuns.where('projectId').equals(projectId).count()).toBe(0)
  })
  it('finishes the actual original v14 prepared request after source addition with unchanged frozen permissions', async () => {
    const legacy = JSON.parse(gunzipSync(readFileSync('tests/fixtures/ttrpg-open-pre-situation-source-prepared-v1.json.gz')).toString())
    expect(legacy.format).toBe('same-id-isolated-db'); expect(legacy.toolVersion).toBe('agent-read-tools-v14')
    await db.transaction('rw', db.tables, async () => { for (const [name, rows] of Object.entries(legacy.tables)) if ((rows as unknown[]).length) await db.table(name).bulkAdd(rows as any[]) })
    const before = await readInstanceAgentRunV1(legacy.scope, legacy.runId), sources = [...before.contract.permissions.contextSourceKeys]
    let sends = 0
    const result = await executeTtrpgOpenIntentRequestV1({ scope: legacy.scope, sessionId: legacy.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
      runId: legacy.runId, requestKey: legacy.requestKey, runAI: async () => { sends++; return JSON.stringify({ goal: '调查河港', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) } })
    expect(result.status).toBe('candidate'); expect(sends).toBe(1)
    const after = await readInstanceAgentRunV1(legacy.scope, legacy.runId)
    expect(after.contract.permissions.contextSourceKeys).toEqual(sources); expect(sources).not.toContain('ttrpgOpenSituationInput')
    expect(before.contract.executionBindings![0].toolSchemaVersion).toBe('agent-read-tools-v14')
    expect(before.contract.executionBindings![0].toolSchemaHash).toBe(legacy.toolHash)
    expect(after.contract.executionBindings).toEqual(before.contract.executionBindings)
  })
})
function awaitState(event: Parameters<typeof applyProductRuntimeEvent>[1], before: Parameters<typeof applyProductRuntimeEvent>[0]) {
  return applyProductRuntimeEvent(before, event)
}
