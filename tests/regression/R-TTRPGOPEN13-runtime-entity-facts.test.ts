import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1, confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { commitTtrpgOpenOracleFactV1, commitTtrpgOpenOracleRuntimeEntityFactV1, completeTtrpgOpenSessionZeroV1, reviewTtrpgOpenOracleCandidateV1 } from '../../src/lib/ttrpg/runtime-commands'
import { hashTtrpgOpenOracleFactCandidateV1, ttrpgOpenSessionFactsV1, verifyTtrpgOpenFactLedgerV1, type TtrpgOpenOracleFactProposalV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { evaluateTtrpgPredicateV1 } from '../../src/lib/ttrpg/predicate'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { ttrpgOpenEntityIdentityCatalogV1 } from '../../src/lib/ttrpg/open-entity-catalog'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { generateTtrpgOpenOracleCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'

async function setup(privateNpc = false, gear = false, ai = false) {
  const s = await setupOpenEntityPlanningV1(pkg => {
    pkg.ttrpg!.campaign.gmMode = 'human'
    if (ai) pkg.ttrpg!.campaign.runtimePolicy.enabled = true
    if (privateNpc) { pkg.ttrpg!.campaign.dynamicEntityTemplates[0].audience = 'private'; pkg.ttrpg!.campaign.dynamicEntityTemplates[0].knownByActorKeys = ['hero'] }
    if (gear) {
      const c = pkg.ttrpg!.campaign, npc = c.characterTemplates.find(row => row.characterKey === 'keeper')!, definition = pkg.ttrpg!.rulePack.content.items[0]
      npc.itemKeys = [definition.key]; npc.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: pkg.ttrpg!.rulePack.content })
      c.entityBindings.find(row => row.bindingKey === 'keeper')!.initialInventoryRefs = ['keeper.initial.gear']
      c.entityBindings.push({ bindingKey: 'keeper.initial.gear', templateKey: definition.key, kind: 'item', initialLocationRef: null,
        initialInventoryRefs: [], sourceResourceRef: null, sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
    }
  }, 'viewer.gm')
  const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
  await proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'runtime.fact.entities', oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[0], s.proposals[1]] })
  const pending = (await readTtrpgOpenEntityDeskV1(input))!.pending!
  return { ...s, deskInput: input, pending }
}
async function create(s: Awaited<ReturnType<typeof setup>>) {
  for (const a of s.pending.approvals) await confirmTtrpgOpenEntityDeskV1({ ...s.deskInput, operationKey: s.pending.operationKey, planHash: s.pending.planHash,
    actorKey: a.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
  await materializeTtrpgOpenEntityDeskV1({ ...s.deskInput, operationKey: s.pending.operationKey, planHash: s.pending.planHash, decision: 'create-this-confirmed-plan' })
}
async function command(s: Awaited<ReturnType<typeof setup>>, overrides: Partial<TtrpgOpenOracleFactProposalV1> = {}, commandId = 'runtime.fact.confirm') {
  const state = await readProductRuntimeState(s.f.sessionId), items = state.ttrpg!.openRun!.entityOperations![0].plan.items
  const proposal: TtrpgOpenOracleFactProposalV1 = { kind: 'relation', subjectRef: items[0].entityKey, predicateKey: 'knows', objectRef: items[1].entityKey,
    canonicalValue: true, detail: '新守灯人知道本局新地点的通行路线。', sourceFactRefs: ['fact.harbor'], audience: 'party',
    knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null, ...overrides }
  const envelope = await openEnvelopeV1(s.f.sessionId, commandId)
  return { ...envelope, viewerKey: 'viewer.gm', oracleSourceRef: s.input.oracleSourceRef, proposal, referencePolicy: 'committed-runtime-entities-v1' as const,
    candidateHash: await hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef: s.input.oracleSourceRef,
      runtimeSourceHash: s.f.session.runtimeSourceHash, viewerKey: 'viewer.gm', baseStateHash: envelope.baseStateHash }) }
}
describe('R-TTRPGOPEN13 semantic facts reference actual prior F13 instances through an explicit versioned path', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('rejects pending entity proposals and keeps the original release-only fact API closed after creation', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s))).rejects.toThrow(/当前实体计划/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await create(s)
    const { referencePolicy: _policy, ...legacy } = await command(s)
    await expect(commitTtrpgOpenOracleFactV1(legacy)).rejects.toThrow(/new-subject/)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger).toBeUndefined()
  })
  it('confirms once with exact creation/recipient evidence and feeds a real predicate without changing mechanics, time or the immutable basis', async () => {
    const s = await setup(); await create(s)
    const before = await readProductRuntimeState(s.f.sessionId), worlds = await db.worldReleases.toArray(), releases = await db.productReleases.toArray()
    const input = await command(s), event = await commitTtrpgOpenOracleRuntimeEntityFactV1(input)
    expect(await commitTtrpgOpenOracleRuntimeEntityFactV1(input)).toEqual(event)
    const after = await readProductRuntimeState(s.f.sessionId), run = after.ttrpg!.openRun!, entry = run.factLedger!.entries[0]
    const cached = (await db.productRuntimeSessions.get(s.f.sessionId))!.runtimeHeadStateJson!, parsed = JSON.stringify(after)
    if (cached !== parsed) {
      let i = 0; while (cached[i] === parsed[i]) i++
      throw new Error('runtime fact parse changed saved bytes at ' + i + ': ' + JSON.stringify({ cached: cached.slice(i, i + 160), parsed: parsed.slice(i, i + 160) }))
    }
    expect(entry.runtimeEntityReferences?.references.map(row => row.entityRef).sort()).toEqual([input.proposal.subjectRef, input.proposal.objectRef!].sort())
    expect(entry.runtimeEntityReferences!.references.every(row => row.planHash === s.pending.planHash && row.sourceRef.sequence < event.sequence)).toBe(true)
    expect(run.factLedger!.basis.entityReferences.some(row => row.entityRef === input.proposal.subjectRef)).toBe(false)
    expect(evaluateTtrpgPredicateV1({ op: 'session-fact', subjectRef: input.proposal.subjectRef, predicateKey: 'knows', objectRef: input.proposal.objectRef, value: true }, ttrpgOpenPredicateContextV1(after, s.input.content))).toBe(true)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(run.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await db.worldReleases.toArray()).toEqual(worlds); expect(await db.productReleases.toArray()).toEqual(releases)
    const view = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    expect(view.view.sessionFacts[0].subjectRef).toBe(input.proposal.subjectRef); expect(JSON.stringify(view.view)).not.toContain('proofHash')
  })
  it('preserves the exact private recipients even if the fact text and its other entity are shareable', async () => {
    const s = await setup(true); await create(s)
    const before = await readProductRuntimeState(s.f.sessionId)
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s))).rejects.toThrow(/准确接收者/)
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s, { audience: 'private', knownByActorKeys: ['companion.1'] }))).rejects.toThrow(/准确接收者/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s, { audience: 'private', knownByActorKeys: ['hero'], detail: 'RUNTIME-PRIVATE-FACT-CANARY' }))
    const hero = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    const other = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'companion.1' })
    expect(JSON.stringify(hero.view)).toContain('RUNTIME-PRIVATE-FACT-CANARY'); expect(JSON.stringify(other.view)).not.toContain('RUNTIME-PRIVATE-FACT-CANARY')
  })
  it('retains mechanical ownership, explicit consent, exact current human identity and unknown-reference rejection', async () => {
    const s = await setup(); await create(s); const before = await readProductRuntimeState(s.f.sessionId)
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s, { predicateKey: 'located-at', canonicalValue: 'harbor' }))).rejects.toThrow(/机械 owner/)
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s, { subjectRef: 'entity.' + '0'.repeat(48) }))).rejects.toThrow(/实际 F13 创建/)
    const input = await command(s)
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1({ ...input, referencePolicy: 'not-consented' } as typeof input)).rejects.toThrow(/明确确认/)
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1({ ...input, viewerKey: 'viewer.seat.hero' })).rejects.toThrow(/真人 GM/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
  it('resolves actual NPC equipment from its original F13 source while retaining its GM-only scope and sole inventory owner', async () => {
    const s = await setup(false, true); await create(s)
    const before = await readProductRuntimeState(s.f.sessionId), gear = ttrpgOpenEntityIdentityCatalogV1(s.input.content, before.ttrpg!.openRun!.entityOperations!)
      .find(row => row.dynamic && row.kind === 'item')!
    expect(gear.audience).toBe('gm-only')
    const proposal = { predicateKey: 'promised' as const, objectRef: gear.entityKey, canonicalValue: '答应以后归还物品', detail: 'GM-RUNTIME-GEAR-CANARY' }
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s, proposal))).rejects.toThrow(/准确接收者/)
    await commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s, { ...proposal, audience: 'gm-only', knownByActorKeys: [] }))
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.product.inventory).toEqual(before.ttrpg!.product.inventory)
    expect(after.ttrpg!.openRun!.factLedger!.entries[0].runtimeEntityReferences!.references.some(row => row.entityRef === gear.entityKey && row.audience === 'gm-only')).toBe(true)
    const view = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    expect(JSON.stringify(view.view)).not.toContain('GM-RUNTIME-GEAR-CANARY')
  })
  it('rolls back a failed original event and retries that same confirmation without creating another fact or entity', async () => {
    const s = await setup(); await create(s); const before = await readProductRuntimeState(s.f.sessionId), input = await command(s)
    const add = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('runtime fact storage cut'))
    await expect(commitTtrpgOpenOracleRuntimeEntityFactV1(input)).rejects.toThrow('runtime fact storage cut'); add.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await commitTtrpgOpenOracleRuntimeEntityFactV1(input); await commitTtrpgOpenOracleRuntimeEntityFactV1(input)
    expect(ttrpgOpenSessionFactsV1((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger)).toHaveLength(1)
  })
  it('also saves a first release-only fact canonically after F13, while replaying unversioned history with its original field order', async () => {
    const s = await setup(); await create(s); const before = await readProductRuntimeState(s.f.sessionId)
    const { referencePolicy: _policy, ...input } = await command(s, { subjectRef: 'keeper', objectRef: 'harbor' })
    const event = await commitTtrpgOpenOracleFactV1(input), payload = JSON.parse(event.payloadJson), after = await readProductRuntimeState(s.f.sessionId)
    expect(payload.stateLayoutVersion).toBe(1); expect(payload.entry.runtimeEntityReferences).toBeUndefined()
    expect((await db.productRuntimeSessions.get(s.f.sessionId))!.runtimeHeadStateJson).toBe(JSON.stringify(after))
    const view = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    expect(view.view.sessionFacts[0].subjectRef).toBe('keeper')
    delete payload.stateLayoutVersion
    const historical = applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })
    const oldRun = historical.ttrpg!.openRun!, normalized = parseTtrpgRuntimeStateV2(historical.ttrpg)!.openRun!
    expect(Object.keys(oldRun).indexOf('entityOperations')).toBeLessThan(Object.keys(oldRun).indexOf('factLedger'))
    expect(Object.keys(normalized).indexOf('factLedger')).toBeLessThan(Object.keys(normalized).indexOf('entityOperations'))
    expect(normalized.factLedger).toEqual(oldRun.factLedger)
  })
  it('rejects rehashed reference widening or another operation during replay and fails closed without the original entity journal', async () => {
    const s = await setup(); await create(s); const before = await readProductRuntimeState(s.f.sessionId)
    const event = await commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s))
    for (const field of ['knownByActorKeys', 'operationKey', 'planHash']) {
      const payload = JSON.parse(event.payloadJson), proof = payload.entry.runtimeEntityReferences
      proof.references[0][field] = field === 'knownByActorKeys' ? [] : field === 'planHash' ? '0'.repeat(64) : 'invented.operation'
      const { proofHash: _hash, ...body } = proof; proof.proofHash = await hashProductProductionValueV2(body)
      expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/准确原实例/)
    }
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
    await expect(verifyTtrpgOpenFactLedgerV1({ ledger: run.factLedger, content: s.input.content, runtimeSourceHash: s.f.session.runtimeSourceHash,
      oracleReceipts: run.oracleReceipts!, storyFacts: state.ttrpg!.product.effectLedger.storyFacts })).rejects.toThrow(/F13 来源/)
  })
  it('keeps a real release-only model interpretation batch readable after F13 without expanding its entity permissions', async () => {
    const s = await setup(false, false, true); await create(s)
    const before = await readProductRuntimeState(s.f.sessionId), { proposal } = await command(s, { subjectRef: 'keeper', objectRef: 'harbor' })
    let sends = 0
    const generated = await generateTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'runtime.fact.oracle.model'), ...s.deskInput,
      rawInput: '明确咨询并审查可实例化对象', oracleSourceRef: s.input.oracleSourceRef, maximumOutputTokens: 1000, maximumCostUsd: 0.1,
      runAI: async () => { sends++; return JSON.stringify({ interpretation: '守灯人了解港口情况。', facts: [proposal] }) } })
    const event = await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'runtime.fact.oracle.review'), ...s.deskInput,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    const after = await readProductRuntimeState(s.f.sessionId), payload = JSON.parse(event.payloadJson)
    expect(payload.stateLayoutVersion).toBe(1); expect(payload.entries[0].runtimeEntityReferences).toBeUndefined()
    expect((await db.productRuntimeSessions.get(s.f.sessionId))!.runtimeHeadStateJson).toBe(JSON.stringify(after))
    expect(after.entities).toEqual(before.entities); expect(sends).toBe(1)
    const view = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    expect(view.view.sessionFacts[0].subjectRef).toBe('keeper')
  })
  it('keeps stable identity through a created cut, parent deletion and two complete imports; the earlier cut never gains an instance', async () => {
    const s = await setup(), early = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence, title: 'Before F13 fact' })
    await create(s); await commitTtrpgOpenOracleRuntimeEntityFactV1(await command(s))
    const parent = await readProductRuntimeState(s.f.sessionId), child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: parent.lastSequence, title: 'After F13 fact' })
    const childBefore = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'runtime.fact.child.zero'), viewerKey: 'viewer.seat.hero',
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: childBefore.ttrpg!.product.sessionZero.requiredItemKeys })
    await deleteProductRuntimeSession(s.f.sessionId)
    let projectId = s.f.scope.projectId
    for (let n = 0; n < 2; n++) {
      projectId = await importProjectJSON(await exportProjectJSON(projectId))
      const sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray(), restored = sessions.find(row => row.title === child.title)!
      const state = await readProductRuntimeState(restored.id!), run = state.ttrpg!.openRun!
      expect(run.factLedger).toEqual(parent.ttrpg!.openRun!.factLedger); expect(run.entityOperations).toEqual(parent.ttrpg!.openRun!.entityOperations)
      await verifyTtrpgOpenFactLedgerV1({ ledger: run.factLedger, content: s.input.content, runtimeSourceHash: s.f.session.runtimeSourceHash,
        oracleReceipts: run.oracleReceipts!, entityOperations: run.entityOperations, storyFacts: state.ttrpg!.product.effectLedger.storyFacts })
      const view = await loadTtrpgOpenPlayerContextV1({ scope: { projectId, worldId: restored.worldId!, workId: restored.workId! }, sessionId: restored.id!, actorKey: 'hero' })
      expect(view.view.sessionFacts).toHaveLength(1)
    }
    expect((await readProductRuntimeState(early.id!)).ttrpg!.openRun!.entityOperations).toEqual([])
  })
})
