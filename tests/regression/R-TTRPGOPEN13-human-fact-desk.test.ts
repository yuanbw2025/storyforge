import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readTtrpgOpenFactDeskV1, prepareTtrpgOpenFactDeskAssertionV1, prepareTtrpgOpenFactDeskRetirementV1, confirmTtrpgOpenFactDeskV1,
  startTtrpgOpenFactDeskConsultationV1, consultTtrpgOpenFactDeskV1, closeTtrpgOpenFactDeskV1 } from '../../src/lib/ttrpg/open-fact-desk'
import { readTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { hashProductProductionValueV2 as hash } from '../../src/lib/product-production/hash'
import type { TtrpgOpenOracleFactProposalV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { ttrpgOpenSessionFactsV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { evaluateTtrpgPredicateV1 } from '../../src/lib/ttrpg/predicate'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { completeTtrpgOpenSessionZeroV1, consultTtrpgOracleV1, closeTtrpgOpenEpochV1, startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenOracleCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'

const proposal: TtrpgOpenOracleFactProposalV1 = { kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
  detail: '真人主持明确确认守灯人了解港口。', sourceFactRefs: ['fact.harbor'], audience: 'party', knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null }
async function setup(privateNpc = false, ai = false) {
  const s = await setupOpenEntityPlanningV1(pkg => {
    pkg.ttrpg!.campaign.gmMode = 'human'; pkg.ttrpg!.campaign.runtimePolicy.enabled = ai
    if (ai) pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    if (privateNpc) { pkg.ttrpg!.campaign.dynamicEntityTemplates[0].audience = 'private'; pkg.ttrpg!.campaign.dynamicEntityTemplates[0].knownByActorKeys = ['hero'] }
  }, 'viewer.gm')
  const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
  const draft = (patch: Partial<TtrpgOpenOracleFactProposalV1> = {}, includeRuntimeEntities = false, submissionKey = 'human.fact.first') => prepareTtrpgOpenFactDeskAssertionV1({
    ...input, submissionKey, oracleSourceRef: s.input.oracleSourceRef, proposal: { ...proposal, ...patch }, includeRuntimeEntities })
  const confirm = (review: Awaited<ReturnType<typeof draft>>) => confirmTtrpgOpenFactDeskV1({ ...input, review, decision: 'confirm-this-exact-fact-change' })
  return { ...s, deskInput: input, draft, confirm }
}
async function create(s: Awaited<ReturnType<typeof setup>>) {
  await proposeTtrpgOpenEntityDeskV1({ ...s.deskInput, submissionKey: 'human.fact.instances', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals.slice(0, 2) })
  const pending = (await readTtrpgOpenEntityDeskV1(s.deskInput))!.pending!
  for (const approval of pending.approvals) await confirmTtrpgOpenEntityDeskV1({ ...s.deskInput, operationKey: pending.operationKey, planHash: pending.planHash,
    actorKey: approval.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
  await materializeTtrpgOpenEntityDeskV1({ ...s.deskInput, operationKey: pending.operationKey, planHash: pending.planHash, decision: 'create-this-confirmed-plan' })
  return pending.items
}
describe('R-TTRPGOPEN13 real human-GM fact review, original commands and immutable source', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('reads and previews without writes/model calls, rejects private fallback access, then confirms the exact V1 once and feeds the original predicate', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), count = await db.productRuntimeEvents.count()
    expect(await readTtrpgOpenFactDeskV1(s.deskInput)).toMatchObject({ canPrepare: true, facts: [], oracles: [expect.objectContaining({ sourceRef: s.input.oracleSourceRef })] })
    expect(await readTtrpgOpenFactDeskV1({ ...s.deskInput, viewerKey: OPEN_HUMAN_VIEWER })).toBeNull()
    const review = await s.draft()
    expect(review.rows).toContainEqual({ label: '事实全文', value: proposal.detail })
    expect(review.rows).toContainEqual({ label: '准确取值', value: '成立' })
    expect(review.change).toMatchObject({ kind: 'assert', referencePolicy: 'release-only-v1' })
    expect(await db.productRuntimeEvents.count()).toBe(count); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await expect(confirmTtrpgOpenFactDeskV1({ ...s.deskInput, viewerKey: OPEN_HUMAN_VIEWER, review, decision: 'confirm-this-exact-fact-change' })).rejects.toThrow(/真人 GM/)
    const first = await s.confirm(review); expect(await s.confirm(review)).toEqual(first)
    const after = await readProductRuntimeState(s.f.sessionId), run = after.ttrpg!.openRun!
    expect(run.factLedger!.entries).toHaveLength(1); expect(run.factLedger!.entries[0].modelCandidate).toBeUndefined()
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(run.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(evaluateTtrpgPredicateV1({ op: 'session-fact', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', value: true }, ttrpgOpenPredicateContextV1(after, s.input.content))).toBe(true)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('allows frozen references after opting into available runtime objects without inventing a runtime proof or requiring any creation', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    const review = await s.draft({ canonicalValue: false }, true)
    expect(review.change).toMatchObject({ kind: 'assert', referencePolicy: 'release-only-v1' })
    expect(review.rows).toContainEqual({ label: '准确取值', value: '不成立' })
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await s.confirm(review)
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.factLedger!.entries[0].runtimeEntityReferences).toBeUndefined()
    expect(after.ttrpg!.openRun!.entityOperations).toEqual(before.ttrpg!.openRun!.entityOperations)
    expect(after.entities).toEqual(before.entities); expect(await db.agentRuns.count()).toBe(0)
  })
  it('keeps runtime references opt-in, uses real F13 evidence, supersedes with preserved history, and retires through the same original validator', async () => {
    const s = await setup(); await create(s)
    const state = await readProductRuntimeState(s.f.sessionId), items = state.ttrpg!.openRun!.entityOperations![0].plan.items
    const refs = { subjectRef: items[0].entityKey, objectRef: items[1].entityKey }
    await expect(s.draft(refs)).rejects.toThrow(/new-subject/)
    const review = await s.draft(refs, true); await s.confirm(review)
    const fact = (await readTtrpgOpenFactDeskV1(s.deskInput))!.facts[0].fact
    const replacement = await s.draft({ ...refs, canonicalValue: false, detail: '原判断有误，改为不了解。', supersedes: fact.factKey,
      supersedeReason: '核对原依据后更正', sourceFactRefs: ['fact.harbor', fact.factKey] }, true, 'human.fact.replacement')
    await s.confirm(replacement)
    let page = (await readTtrpgOpenFactDeskV1(s.deskInput))!
    expect(page.facts[0].fact).toMatchObject({ retired: true, factKey: fact.factKey }); expect(page.facts[1].fact).toMatchObject({ retired: false, canonicalValue: false })
    const retired = await prepareTtrpgOpenFactDeskRetirementV1({ ...s.deskInput, submissionKey: 'human.fact.retire', factKey: page.facts[1].fact.factKey, reason: '本次判断不再适用' })
    expect(retired.rows).toContainEqual({ label: '退休理由', value: '本次判断不再适用' }); await s.confirm(retired)
    page = (await readTtrpgOpenFactDeskV1(s.deskInput))!
    expect(page.facts.every(row => row.fact.retired)).toBe(true); expect(page.facts[1].retirementReason).toBe('本次判断不再适用')
    expect((await readProductRuntimeState(s.f.sessionId)).entities).toEqual(state.entities)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('rolls back a real storage failure and preserves the original review for exact idempotent retry', async () => {
    const s = await setup(), review = await s.draft(), before = await readProductRuntimeState(s.f.sessionId)
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('HUMAN-FACT-DESK-STORAGE-CUT'))
    await expect(s.confirm(review)).rejects.toThrow('HUMAN-FACT-DESK-STORAGE-CUT'); cut.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await s.confirm(review); await s.confirm(review)
    expect((await readTtrpgOpenFactDeskV1(s.deskInput))!.facts).toHaveLength(1)
  })
  it('rejects a changed or rehashed misleading review, foreign scope and a genuinely stale original baseline before writing', async () => {
    const s = await setup(), review = await s.draft(), before = await readProductRuntimeState(s.f.sessionId)
    const changed = structuredClone(review); changed.rows[0].value = '另一条无害操作'
    const { reviewHash: _hash, ...body } = changed; changed.reviewHash = await hash(body)
    await expect(s.confirm(changed)).rejects.toThrow(/显示内容/)
    await expect(confirmTtrpgOpenFactDeskV1({ ...s.deskInput, scope: { ...s.deskInput.scope, workId: s.deskInput.scope.workId + 1 }, review, decision: 'confirm-this-exact-fact-change' })).rejects.toThrow()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'human.fact.new.oracle'), viewerKey: 'viewer.gm', askedBy: 'gm', oracleKey: 'oracle.yes', question: '再核对一次来源？' })
    await expect(s.confirm(review)).rejects.toThrow(/基线已变化/)
    expect(ttrpgOpenSessionFactsV1((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger)).toEqual([])
  })
  it('does not offer mechanical facts, player decisions or widened private recipients as valid review', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    for (const patch of [{ predicateKey: 'located-at', canonicalValue: 'harbor', objectRef: null }, { subjectRef: 'hero' }, { audience: 'private', knownByActorKeys: ['unknown.actor'] }] as Partial<TtrpgOpenOracleFactProposalV1>[]) await expect(s.draft(patch)).rejects.toThrow()
    expect((await readTtrpgOpenFactDeskV1(s.deskInput))!.predicates.map(row => row.predicateKey)).not.toContain('located-at')
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.agentRuns.count()).toBe(0)
  })
  it('starts, consults once and explicitly closes without requiring dynamic templates or an AI configuration', async () => {
    const f = await readyOpenTtrpgSessionV1('Human fact consultation', pkg => { pkg.ttrpg!.campaign.gmMode = 'human' }), input = { scope: f.scope, sessionId: f.sessionId, viewerKey: 'viewer.gm' }
    expect((await readTtrpgOpenFactDeskV1(input))!.entities.every(row => !row.dynamic)).toBe(true)
    await startTtrpgOpenFactDeskConsultationV1({ ...input, submissionKey: 'start', decision: 'start-this-fact-consultation' })
    await consultTtrpgOpenFactDeskV1({ ...input, submissionKey: 'oracle', decision: 'consult-this-once', oracleKey: 'oracle.yes', question: '守灯人了解港口吗？', likelihoodTierKey: null })
    expect((await readTtrpgOpenFactDeskV1(input))!.oracles).toHaveLength(1)
    await closeTtrpgOpenFactDeskV1({ ...input, submissionKey: 'close', decision: 'close-this-fact-consultation' })
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(await db.agentRuns.count()).toBe(0)
  })
  it('keeps exact private instance recipients and denies pending entity plans and passive windows before preparing review', async () => {
    const s = await setup(true)
    await proposeTtrpgOpenEntityDeskV1({ ...s.deskInput, submissionKey: 'human.fact.pending', oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals.slice(0, 2) })
    const pending = (await readTtrpgOpenEntityDeskV1(s.deskInput))!.pending!, before = await readProductRuntimeState(s.f.sessionId)
    expect(await readTtrpgOpenFactDeskV1(s.deskInput)).toMatchObject({ canPrepare: false }); await expect(s.draft()).rejects.toThrow(/实体/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    for (const row of pending.approvals) await confirmTtrpgOpenEntityDeskV1({ ...s.deskInput, operationKey: pending.operationKey, planHash: pending.planHash, actorKey: row.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await materializeTtrpgOpenEntityDeskV1({ ...s.deskInput, operationKey: pending.operationKey, planHash: pending.planHash, decision: 'create-this-confirmed-plan' })
    const items = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.entityOperations![0].plan.items, refs = { subjectRef: items[0].entityKey, objectRef: items[1].entityKey }
    await expect(s.draft(refs, true)).rejects.toThrow(/原实例的准确接收者/)
    const review = await s.draft({ ...refs, audience: 'private', knownByActorKeys: ['hero'] }, true); await s.confirm(review)
    const hero = await loadTtrpgOpenPlayerContextV1({ ...s.deskInput, actorKey: 'hero' }), other = await loadTtrpgOpenPlayerContextV1({ ...s.deskInput, actorKey: 'companion.1' })
    expect(hero.view.sessionFacts).toHaveLength(1); expect(other.view.sessionFacts).toEqual([])
    const passive = await setup(false, true)
    const epochKey = (await readProductRuntimeState(passive.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(passive.f.sessionId, 'fact.before.passive.close'), viewerKey: 'viewer.gm', epochKey, reason: '明确结束普通窗口' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(passive.f.sessionId, 'fact.passive.start'), viewerKey: 'viewer.gm', triggerKind: 'request-situation', rawInput: '仅拟定局势' })
    expect(await readTtrpgOpenFactDeskV1(passive.deskInput)).toMatchObject({ canPrepare: false }); await expect(passive.draft()).rejects.toThrow(/局势或复盘/)
  })
  it('does not freeze future human fact work merely because a previous explicitly closed request remains historically unknown', async () => {
    const s = await setup(false, true)
    let calls = 0
    await expect(generateTtrpgOpenOracleCandidateV1({ ...s.deskInput, ...await openEnvelopeV1(s.f.sessionId, 'fact.old.unknown'),
      oracleSourceRef: s.input.oracleSourceRef, rawInput: '明确咨询并审查可实例化对象', maximumOutputTokens: 1000, maximumCostUsd: 0.1,
      runAI: async () => { calls++; throw new Error('HUMAN-FACT-PAST-UNKNOWN') } })).rejects.toThrow()
    expect(calls).toBe(1)
    const run = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!
    expect(run.coordination.calls[0].status).toBe('unknown')
    expect(await readTtrpgOpenFactDeskV1(s.deskInput)).toMatchObject({ canPrepare: false, canClose: false })
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'fact.old.unknown.close'), viewerKey: 'viewer.gm', epochKey: run.coordination.activeEpochKey!, reason: '明确结束，保留原未知结果与可能费用' })
    expect(await readTtrpgOpenFactDeskV1(s.deskInput)).toMatchObject({ canStart: true })
    await startTtrpgOpenFactDeskConsultationV1({ ...s.deskInput, submissionKey: 'after.unknown', decision: 'start-this-fact-consultation' })
    await s.confirm(await s.draft())
    expect((await readTtrpgOpenFactDeskV1(s.deskInput))!.facts).toHaveLength(1); expect(calls).toBe(1)
  })
  it('keeps confirmed runtime facts and their real sources through branch/parent deletion and complete import, without reusing a parent review as child authority', async () => {
    const s = await setup(); await create(s)
    const items = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.entityOperations![0].plan.items
    const review = await s.draft({ subjectRef: items[0].entityKey, objectRef: items[1].entityKey }, true), event = await s.confirm(review)
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: event.sequence, title: 'Human fact child' })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'human.fact.child.zero'), viewerKey: 'viewer.gm', selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    await deleteProductRuntimeSession(s.f.sessionId)
    const childInput = { ...s.deskInput, sessionId: child.id! }, inherited = (await readTtrpgOpenFactDeskV1(childInput))!
    expect(inherited.facts).toHaveLength(1); await expect(confirmTtrpgOpenFactDeskV1({ ...childInput, review, decision: 'confirm-this-exact-fact-change' })).rejects.toThrow(/原版本|作用域/)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
    const restoredInput = { scope: { projectId, worldId: restored.worldId!, workId: restored.workId! }, sessionId: restored.id!, viewerKey: 'viewer.gm' }
    expect((await readTtrpgOpenFactDeskV1(restoredInput))!.facts).toEqual(inherited.facts)
    const player = await loadTtrpgOpenPlayerContextV1({ ...restoredInput, actorKey: 'hero' })
    expect(player.view.sessionFacts).toHaveLength(1)
  })
})
