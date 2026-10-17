import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as runtimeCore from '../../src/lib/product/runtime-core'
import { loadTtrpgOpenCommonProjectionV1, loadTtrpgOpenPartyProjectionV1 } from '../../src/lib/ttrpg/open-player-context'
import { loadTtrpgOpenPublicSituationContextV1 } from '../../src/lib/ttrpg/open-public-situation-context'
import { assertTtrpgOpenPublicPredicateV1 } from '../../src/lib/ttrpg/open-public-situation-predicates'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { canonicalStringify } from '../../src/lib/agent/run/hash'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { seedTtrpgWorldPatchReviewV1 } from '../helpers/open-ttrpg-world-patch'

describe('R-TTRPGOPEN9 common situation source basis', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('intersects actual human and AI players, preserving legacy common rows without exposing any individual view', async () => {
    const f = await readyOpenTtrpgSessionV1('Common intersection', p => {
      p.ttrpg!.campaign.runtimePolicy.enabled = true
      const actor = p.ttrpg!.campaign.characterTemplates.find(a => a.characterKey === 'companion.2')!
      actor.actionKeys = []
      actor.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: actor, rulePack: p.ttrpg!.rulePack.content })
    })
    const input = { scope: f.scope, sessionId: f.sessionId }, common = await loadTtrpgOpenCommonProjectionV1(input)
    expect(common.recipientActorKeys).toEqual(['companion.1', 'companion.2', 'hero'])
    expect(common.view.rules.actions).toEqual([])
    expect(common.view.rules.genericChecks.length).toBeGreaterThan(0)
    const original = await Promise.all(common.recipientActorKeys.map(actorKey => loadTtrpgOpenPartyProjectionV1({ ...input, actorKey })))
    for (const key of ['actorsHere', 'initialObservations', 'knowledge', 'sessionFacts', 'pressureSignals'] as const) {
      const expected = original[0].view[key].filter(row => original.every(v => v.view[key].some(other => canonicalStringify(other) === canonicalStringify(row))))
      expect(common.view[key]).toEqual(expected)
    }
    const text = JSON.stringify(common)
    for (const hidden of ['playerProfile', 'characterSheet', 'inventory', 'abilityStates', 'available', '曾经离开港口', '害怕洪水', 'viewerKey']) expect(text).not.toContain(hidden)
  })
  it('delivers only actual common sources and visible clock slots; private front/effect/clock metadata never becomes a resource', async () => {
    const f = await readyOpenTtrpgSessionV1('Public situation canaries', p => {
      const c = p.ttrpg!.campaign; c.runtimePolicy.enabled = true
      c.fronts[0].goal = 'PRIVATE-FRONT-GOAL'; c.clocks[0].onComplete = 'PRIVATE-CLOCK-OUTCOME'
      c.effectPlanTemplates[0].reason = 'PRIVATE-EFFECT-REASON'
      c.situationTemplates[0].driverGoal = 'PRIVATE-AUTHORED-TEMPLATE'
      c.clocks.push({ ...structuredClone(c.clocks[0]), clockKey: 'private.clock', title: 'PRIVATE-CLOCK-TITLE', visibility: 'gm-only' })
      c.entityBindings.find(b => b.bindingKey === 'keeper')!.audience = 'gm-only'
    })
    const before = await runtimeCore.readProductRuntimeState(f.sessionId)
    const context = await loadTtrpgOpenPublicSituationContextV1({ scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' })
    expect(context).not.toHaveProperty('loaded')
    expect(context.frame.clocks).toEqual([{ clockKey: 'flood', title: '涨潮', value: 0, maximum: 6, completed: false }])
    expect(context.frame.actors.some(actor => actor.actorKey === 'keeper')).toBe(false)
    expect(context.predicateScope.invariantFacts[0]).toMatchObject({ factRef: 'fact.harbor', sourceResourceRefs: f.campaign.frozenWorldPredicateIndex.entries[0].sourceResourceRefs })
    expect(context.resources.filter(resource => resource.mandatory)).toHaveLength(5)
    const text = JSON.stringify(context)
    for (const hidden of ['PRIVATE-', 'private.clock', '曾经离开港口', '害怕洪水', 'viewerKey', 'onComplete', 'frozenContent', 'effectPlanByDegree', 'riskFactRefs', 'narration', 'memory']) expect(text).not.toContain(hidden)
    expect(await runtimeCore.readProductRuntimeState(f.sessionId)).toEqual(before)
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('keeps initial mechanical observations historical and refuses to probe mutable owners even beneath not/any', async () => {
    const f = await readyOpenTtrpgSessionV1('Historical mechanical value', p => {
      const c = p.ttrpg!.campaign; c.runtimePolicy.enabled = true
      c.frozenWorldPredicateIndex.entries.push({ ...structuredClone(c.frozenWorldPredicateIndex.entries[0]), factKey: 'fact.keeper.initial',
        subjectRef: 'keeper', predicateKey: 'located-at', canonicalValue: 'harbor', authority: 'initial-state', owner: 'entity' })
    })
    const context = await loadTtrpgOpenPublicSituationContextV1({ scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' })
    expect(context.entries.find(row => row.kind === 'release-observation' && 'factRef' in row.value && row.value.factRef === 'fact.keeper.initial')).toMatchObject({ reliability: 'release-time', value: { asOf: 'release', canonicalValue: 'harbor' } })
    expect(context.predicateScope.invariantFacts.some(f => f.subjectRef === 'keeper')).toBe(false)
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'world-fact', subjectRef: 'keeper', predicateKey: 'located-at', objectRef: null, value: 'harbor' }, context.predicateScope)).toThrow(/当前权威证明/)
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'any', of: [{ op: 'world-turn-at-least', value: 0 }, { op: 'not', of: { op: 'actor-at', actorKey: 'keeper', locationRef: 'secret.place' } }] }, context.predicateScope)).toThrow(/当前权威证明/)
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'world-fact', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, value: true }, context.predicateScope)).not.toThrow()
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'clock-at-least', clockKey: 'flood', value: 2 }, context.predicateScope)).not.toThrow()
  })
  it('omits a real private discovery and cannot upgrade hearsay/belief to an objective evidence condition', async () => {
    const f = await setupChecksFixtureV1({ ai: true, privateDiscovery: true })
    const context = await loadTtrpgOpenPublicSituationContextV1({ scope: f.f.scope, sessionId: f.f.sessionId, actorKey: 'gm' })
    expect(context.entries.filter(row => row.kind === 'known-evidence')).toEqual([])
    expect(context.predicateScope.observedEvidenceRefs).toEqual([])
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'evidence-known-by', actorKey: 'hero', clueRef: f.f.campaign.situationTemplates[0].evidence[0].clueRef }, context.predicateScope)).toThrow(/当前权威证明/)
  })
  it('does not invent a common current location or actor observation when the actual party is split', async () => {
    const f = await readyOpenTtrpgSessionV1('Split party source', p => {
      const c = p.ttrpg!.campaign; c.runtimePolicy.enabled = true
      c.entityBindings.push({ bindingKey: 'market', templateKey: 'market', kind: 'location', sourceResourceRef: null,
        sourceFieldRefs: [], initialLocationRef: null, initialInventoryRefs: [], audience: 'public', knownByActorKeys: [] })
      c.entityBindings.find(b => b.bindingKey === 'companion.2')!.initialLocationRef = 'market'
    })
    const common = await loadTtrpgOpenPublicSituationContextV1({ scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' })
    expect(common.frame.actors).toEqual([])
    expect(common.frame).not.toHaveProperty('locationKey')
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'actor-at', actorKey: 'hero', locationRef: 'harbor' }, common.predicateScope)).toThrow(/当前权威证明/)
  })
  it('uses actual produced confirmed common facts while excluding retired slots, private facts and attributed memory belief', async () => {
    const f = await seedTtrpgWorldPatchReviewV1()
    const context = await loadTtrpgOpenPublicSituationContextV1({ scope: f.scope, sessionId: f.host.sessionId, actorKey: 'gm' })
    const text = JSON.stringify(context.resources)
    for (const hidden of ['PRIVATE-PATCH-REQUIRES-CHOICE', 'GM-PATCH-REQUIRES-CHOICE', 'RETIRED-PATCH-EXCLUDED', 'BELIEF-MEMORY-MUST-NOT-BECOME-FACT']) expect(text).not.toContain(hidden)
    expect(context.predicateScope.sessionFacts).toHaveLength(2)
    const { subjectRef, predicateKey, objectRef, canonicalValue } = f.entries[0].fact
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'session-fact', subjectRef, predicateKey, objectRef, value: canonicalValue }, context.predicateScope)).not.toThrow()
    const retired = f.entries[4].fact
    expect(() => assertTtrpgOpenPublicPredicateV1({ op: 'session-fact', subjectRef: retired.subjectRef, predicateKey: retired.predicateKey, objectRef: retired.objectRef }, context.predicateScope)).toThrow(/当前权威证明/)
  })
  it('recomputes the actual common grant after a new branch seat joins and preserves only that view across full backup import', async () => {
    const f = await setupChecksFixtureV1({ ai: true }, p => {
      const c = p.ttrpg!.campaign, late = structuredClone(c.characterTemplates.find(a => a.characterKey === 'companion.2')!)
      late.characterKey = 'late'; late.seatKey = 'seat.late'; late.name = '后来者'
      late.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: late, rulePack: p.ttrpg!.rulePack.content })
      c.characterTemplates.push(late)
      c.companionPolicy.approvalBindings.push({ companionActorKey: 'late', approverSeatKeys: ['seat.hero'], partyResourceApprovalAllowed: false })
      c.entityBindings.push({ ...structuredClone(c.entityBindings.find(b => b.bindingKey === 'companion.2')!), bindingKey: 'late', templateKey: 'late' })
    })
    const input = { scope: f.f.scope, sessionId: f.f.sessionId, actorKey: 'gm' }
    const before = await loadTtrpgOpenPublicSituationContextV1(input)
    expect(before.entries.some(row => row.kind === 'known-evidence')).toBe(true)
    const child = await runtimeCore.branchProductRuntimeSession({ parentSessionId: f.f.sessionId,
      throughSequence: before.readEvidence.sequence, title: 'New common recipient' })
    const state = await runtimeCore.readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'public.child.zero'), viewerKey: OPEN_HUMAN_VIEWER,
      selectedCharacterKeys: ['hero', 'companion.1', 'late'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    const joined = await loadTtrpgOpenPublicSituationContextV1({ ...input, sessionId: child.id! })
    expect(joined.frame.recipientActorKeys).toEqual(['companion.1', 'hero', 'late'])
    expect(joined.entries.filter(row => row.kind === 'known-evidence')).toEqual([])
    expect(joined.predicateScope.observedEvidenceRefs).toEqual([])
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())
      .find(row => JSON.parse(row.initialStateJson).ttrpg.sessionKey === joined.readEvidence.sessionKey)!
    const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } })
    const restored = await loadTtrpgOpenPublicSituationContextV1({ scope, sessionId: copy.id!, actorKey: 'gm' })
    expect(restored.resources).toEqual(joined.resources)
    expect(await db.agentRuns.where('projectId').equals(projectId).count()).toBe(0)
  })
  it('requires exact instance, safety and current seat authorization and detects an actual concurrent read', async () => {
    const f = await readyOpenTtrpgSessionV1('Common read guards', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true })
    const input = { scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' }
    await expect(loadTtrpgOpenPublicSituationContextV1({ ...input, actorKey: 'hero' })).rejects.toThrow(/共同视图/)
    const other = await readyOpenTtrpgSessionV1('Other common scope', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true })
    await expect(loadTtrpgOpenCommonProjectionV1({ ...input, scope: other.scope })).rejects.toThrow()
    const current = await runtimeCore.readProductRuntimeStateVersion(f.sessionId)
    vi.spyOn(runtimeCore, 'readProductRuntimeStateVersion').mockResolvedValue({ ...current, sequence: current.sequence + 1 })
    await expect(loadTtrpgOpenCommonProjectionV1(input)).rejects.toThrow(/读取期间/)
    vi.restoreAllMocks()
    const seat = await db.ttrpgSessionParticipants.where('sessionId').equals(f.sessionId).filter(seat => seat.actorKey === 'companion.1').first()
    await db.ttrpgSessionParticipants.update(seat!.id!, { revision: seat!.revision + 1 })
    await expect(loadTtrpgOpenPublicSituationContextV1(input)).rejects.toThrow(/stale/)
  })
})
