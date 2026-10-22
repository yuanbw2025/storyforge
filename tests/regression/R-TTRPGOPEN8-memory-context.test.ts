import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { recordTtrpgOpenNarrativeMemoryV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { createTtrpgOpenMemoryContextProviderV1 } from '../../src/lib/ttrpg/open-memory-context-provider'
import { readTtrpgOpenNarrativeMemoriesV1 } from '../../src/lib/ttrpg/open-memory-service'
import { branchProductRuntimeSession, readProductRuntimeState, hashProductRuntimeStateV1 } from '../../src/lib/product/runtime-core'
import { readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { getAgentToolSchemaSnapshotV1 } from '../../src/lib/agent/tool-registry'
import { AGENT_TOOL_SCHEMA_HASH_V1 } from '../../src/lib/agent/execution-binding'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { createContextAccessPolicyForExecutionV1 } from '../../src/lib/context-gateway/skill-policy'
import { resolveScope } from '../../src/lib/workspace/scope'
import type { TtrpgOpenMemoryDraftV1 } from '../../src/lib/ttrpg/open-memory-contract'
import type { FrozenResourceScopeV1, ContextResourceProviderV1 } from '../../src/lib/registry/types'

const actor = createTtrpgOpenMemoryContextProviderV1('actor'), party = createTtrpgOpenMemoryContextProviderV1('party-narrator')
async function setup(enabled = true) {
  const f = await readyOpenTtrpgSessionV1('Memory context', p => { p.ttrpg!.campaign.runtimePolicy.enabled = enabled })
  const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'hero' }
  const note = async (key: string, audience: TtrpgOpenMemoryDraftV1['audience'], knownBy: string[] = [], summary = key) => {
    const envelope = await openEnvelopeV1(f.sessionId, `memory.${key}`)
    return recordTtrpgOpenNarrativeMemoryV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER,
      draft: { revisionKey: key, observerKey: audience === 'gm-only' ? 'gm' : 'hero', reliability: 'belief', audience, knownBy,
        summary, fromEventSequence: 1, toEventSequence: envelope.baseSequence } })
  }
  return { f, scope, note }
}
async function all(provider: ContextResourceProviderV1, scope: FrozenResourceScopeV1) {
  const page = await provider.listMetadata({ scope, limit: 100 })
  return { page, bodies: await Promise.all(page.items.map(async d => JSON.parse((await provider.read({ scope, resourceKey: d.resourceKey, depth: 'full', maxTokens: 20000 })).content))) }
}
describe('R-TTRPGOPEN8 actual consumer-scoped memory sources', { timeout: 90000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('matches the actual tool schema and registers separate sources with explicit consumer grants', async () => {
    expect(await hashCanonicalValue(getAgentToolSchemaSnapshotV1())).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
    expect(CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenMemory')?.resources?.providerId).toBe('storyforge.ttrpgOpenMemory')
    expect(CONTEXT_SOURCE_BY_KEY.get('ttrpgOpenPartyMemory')?.resources?.providerId).toBe('storyforge.ttrpgOpenPartyMemory')
    expect(getAgentSkillV1('prose.ttrpg-open-intent').contextSourceKeys).toContain('ttrpgOpenMemory')
    expect(getAgentSkillV1('prose.ttrpg-open-intent').contextSourceKeys).not.toContain('ttrpgOpenPartyMemory')
    expect(getAgentSkillV1('prose.ttrpg-open-oracle-interpret').contextSourceKeys).not.toContain('ttrpgOpenPartyMemory')
  })
  it('keeps the human AI-GM owner authority out of actor and party metadata, search, counts and full text', async () => {
    const s = await setup()
    await s.note('private-subset', 'private', ['hero', 'companion.1'], 'HIDDEN-SUBSET')
    await s.note('gm-secret', 'gm-only', [], 'HIDDEN-GM')
    await s.note('public-note', 'public', [], 'PUBLIC-MEMORY')
    await s.note('party-note', 'party', [], 'PARTY-MEMORY')
    await s.note('private-all', 'private', ['hero', 'companion.1', 'companion.2'], 'ALL-RECIPIENTS')
    const hero = await all(actor, s.scope), common = await all(party, { ...s.scope, runtimeActorKey: 'gm' })
    expect(hero.bodies.map(b => b.summary).filter(Boolean)).toEqual(['HIDDEN-SUBSET', 'PUBLIC-MEMORY', 'PARTY-MEMORY', 'ALL-RECIPIENTS'])
    expect(common.bodies.map(b => b.summary).filter(Boolean)).toEqual(['PUBLIC-MEMORY', 'PARTY-MEMORY', 'ALL-RECIPIENTS'])
    const excluded = await all(actor, { ...s.scope, runtimeActorKey: 'companion.2' })
    expect(JSON.stringify(excluded)).not.toContain('HIDDEN-SUBSET')
    expect(JSON.stringify(hero)).not.toContain('HIDDEN-GM')
    expect((await party.searchMetadata({ scope: { ...s.scope, runtimeActorKey: 'gm' }, limit: 100, query: 'HIDDEN' })).items).toEqual([])
    const human = await readTtrpgOpenNarrativeMemoriesV1({ scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER })
    expect(human.humanHost).toBe(true)
    expect(human.entries.some(e => e.summary === 'HIDDEN-GM')).toBe(true)
    const note = hero.bodies.find(b => b.summary === 'HIDDEN-SUBSET')
    expect(note).toMatchObject({ observerKey: 'hero', reliability: 'belief', origin: 'human-authored', noMechanicalAuthority: true, noKnowledgeGrant: true })
    for (const text of [JSON.stringify(hero), JSON.stringify(common)]) for (const forbidden of ['viewerKey', 'sourceEvents', 'authorizationRef', 'runtimeHeadStateJson":', 'runId']) expect(text).not.toContain(forbidden)
    expect(hero.page.items.find(d => d.authority === 'derived-summary')?.sourceRefs.some(r => r.table === 'ttrpgNarrativeMemories' && r.field === 'summary')).toBe(true)
  })
  it('joins the real registered actor and KP source sets in one frozen Gateway read session', async () => {
    const s = await setup(); await s.note('gateway', 'public')
    const joined = async (scope: FrozenResourceScopeV1, sourceKeys: string[], skillId: string) => {
      const pages = await Promise.all(sourceKeys.map(key => CONTEXT_SOURCE_BY_KEY.get(key)!.resources!.listMetadata({ scope, limit: 100 })))
      expect(new Set(pages.map(p => p.scopeFingerprint)).size).toBe(1)
      const policy = createContextAccessPolicyForExecutionV1(getAgentSkillV1(skillId))
      // Explicit test policy exercises the registered foundation under its explicit consumer grants.
      const session = await createContextGatewayToolSessionV1({ scope, freezeProviderReads: true,
        policy: { ...policy, allowedSourceKeys: sourceKeys, mandatorySourceKeys: sourceKeys, allowedResourceKinds: ['fact', 'reference'] },
        allowedResourceKeys: pages.flatMap(p => p.items.map(d => d.resourceKey)) })
      for (const guard of session.readSessionGuards ?? []) await guard()
      expect(session.providers.map(p => p.source.key).sort()).toEqual([...sourceKeys].sort())
    }
    await joined(s.scope, ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenActorContext', 'ttrpgOpenMemory'], 'prose.ttrpg-open-intent')
    const f = await setupChecksFixtureV1({ ai: true })
    await resumeTtrpgOpenChecksV1(f.command)
    const envelope = await openEnvelopeV1(f.f.sessionId, 'kp.memory')
    await recordTtrpgOpenNarrativeMemoryV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER,
      draft: { revisionKey: 'kp-note', observerKey: 'hero', reliability: 'observed', audience: 'public', knownBy: [], summary: '共同可读回顾', fromEventSequence: 1, toEventSequence: envelope.baseSequence } })
    await joined({ ...f.f.scope, productRuntimeSessionId: f.f.sessionId, runtimeActorKey: 'gm' },
      ['ttrpgOpenKpInput', 'ttrpgOpenPartyContext', 'ttrpgOpenPartyMemory'], 'prose.ttrpg-open-kp')
  })
  it('finds late relevant text and reads complete atomic JSON with genuine provenance', async () => {
    const s = await setup(), summary = '甲'.repeat(600) + 'TAIL-RELEVANT-CLUE'
    await s.note('long-note', 'private', ['hero'], summary)
    const page = await actor.searchMetadata({ scope: s.scope, limit: 10, query: 'TAIL-RELEVANT-CLUE' }), d = page.items[0]
    expect(page.items).toHaveLength(1)
    expect(d.shortSummary).not.toContain('TAIL-RELEVANT-CLUE')
    const read = await actor.read({ scope: s.scope, resourceKey: d.resourceKey, depth: 'full', maxTokens: d.tokenEstimate.full! })
    expect(JSON.parse(read.content).summary).toBe(summary)
    expect(read.contentHash).toBe(d.contentHash)
    await expect(actor.read({ scope: s.scope, resourceKey: d.resourceKey, depth: 'full', maxTokens: d.tokenEstimate.full! - 1 })).rejects.toThrow(/预算/)
    await expect(actor.read({ scope: s.scope, resourceKey: d.resourceKey, depth: 'summary', maxTokens: 10000 })).rejects.toThrow(/完整/)
    await expect(actor.readOriginal({ scope: s.scope, resourceKey: d.resourceKey, maxTokens: 10000 })).rejects.toThrow()
  })
  it('binds pagination and pinned views to the exact consumer, query and real memory revision', async () => {
    const s = await setup(); await s.note('one', 'public'); await s.note('two', 'public')
    const page = await actor.listMetadata({ scope: s.scope, limit: 1 }), cursor = page.nextCursor!
    await expect(actor.listMetadata({ scope: { ...s.scope, runtimeActorKey: 'companion.1' }, limit: 1, cursor })).rejects.toThrow(/cursor/)
    await expect(actor.searchMetadata({ scope: s.scope, limit: 1, cursor, query: 'one' })).rejects.toThrow(/cursor/)
    await expect(party.listMetadata({ scope: { ...s.scope, runtimeActorKey: 'gm' }, limit: 1, cursor })).rejects.toThrow(/cursor/)
    const pinned = await actor.openReadSession!(s.scope)
    await expect(pinned.provider.listMetadata({ scope: { ...s.scope, runtimeActorKey: 'companion.1' }, limit: 1 })).rejects.toThrow(/更换/)
    await s.note('three', 'public')
    await expect(actor.listMetadata({ scope: s.scope, limit: 1, cursor })).rejects.toThrow(/stale/)
    await expect(pinned.assertCurrent()).rejects.toThrow(/变化/)
  })
  it('rejects wrong consumer, NPC, workspace, and disabled model reading while retaining the human desk', async () => {
    const s = await setup(false); await s.note('human-only', 'private', ['hero'])
    await expect(actor.listMetadata({ scope: s.scope, limit: 10 })).rejects.toThrow(/模型/)
    expect((await readTtrpgOpenNarrativeMemoriesV1({ scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER })).entries).toHaveLength(1)
    await expect(actor.listMetadata({ scope: { ...s.scope, runtimeActorKey: 'gm' }, limit: 10 })).rejects.toThrow(/消费场景/)
    await expect(party.listMetadata({ scope: s.scope, limit: 10 })).rejects.toThrow(/消费场景/)
    const other = await setup()
    await expect(actor.listMetadata({ scope: { ...other.scope, runtimeActorKey: 'keeper' }, limit: 10 })).rejects.toThrow(/角色/)
    await expect(actor.listMetadata({ scope: { ...other.scope, productRuntimeSessionId: s.f.sessionId }, limit: 10 })).rejects.toThrow()
  })
  it('invalidates existing views when real consent changes', async () => {
    const s = await setup(); await s.note('private', 'private', ['hero'])
    const pinned = await actor.openReadSession!(s.scope)
    const seat = (await readTtrpgSessionParticipantsV2(s.f.sessionId)).find(s => s.actorKey === 'hero')!
    // Direct corruption emulates a stale row; normal post-Zero reconfiguration is itself forbidden.
    await db.ttrpgSessionParticipants.update(seat.id!, { revision: seat.revision + 1, consent: { ...seat.consent, aiAdviceAllowed: false } })
    await expect(actor.listMetadata({ scope: s.scope, limit: 100 })).rejects.toThrow()
    await expect(pinned.assertCurrent()).rejects.toThrow()
  })
  it.each(['summary', 'stale', 'extra-row', 'damaged-event', 'self-hashed-head'])('refuses %s instead of trusting an unverified projection', async kind => {
    const s = await setup(); await s.note('record', 'public')
    const row = (await db.ttrpgNarrativeMemories.toArray())[0]
    if (kind === 'summary') await db.ttrpgNarrativeMemories.update(row.id!, { summary: 'forged' })
    if (kind === 'stale') await db.ttrpgNarrativeMemories.update(row.id!, { stale: true })
    if (kind === 'extra-row') { const { id: _id, ...fields } = row; await db.ttrpgNarrativeMemories.add({ ...fields, revisionKey: 'unconfirmed' }) }
    if (kind === 'damaged-event') {
      const event = (await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).toArray()).find(e => e.type === 'ttrpg.memory.recorded')!
      const payload = JSON.parse(event.payloadJson); payload.memory.draft.summary = 'forged'
      await db.productRuntimeEvents.update(event.id!, { payloadJson: JSON.stringify(payload) })
    }
    if (kind === 'self-hashed-head') {
      const state = await readProductRuntimeState(s.f.sessionId)
      ;(state.ttrpg as any).openRun.memoryReceipts = []
      await db.ttrpgNarrativeMemories.delete(row.id!)
      await db.productRuntimeSessions.update(s.f.sessionId, { runtimeHeadStateJson: JSON.stringify(state), runtimeHeadStateHash: await hashProductRuntimeStateV1(state) })
    }
    await expect(actor.listMetadata({ scope: s.scope, limit: 100 })).rejects.toThrow()
  })
  it('inherits only actually confirmed notes across the branch cut with stable ancestor provenance', async () => {
    const s = await setup(), event = await s.note('inherited', 'private', ['hero'])
    const before = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: event.sequence - 1, title: 'Before memory' })
    const after = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: event.sequence, title: 'After memory' })
    for (const child of [before, after]) {
      const state = await readProductRuntimeState(child.id!)
      await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.zero'), viewerKey: OPEN_HUMAN_VIEWER,
        selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    }
    expect((await all(actor, { ...s.scope, productRuntimeSessionId: before.id! })).bodies.filter(b => b.summary)).toEqual([])
    const inherited = (await all(actor, { ...s.scope, productRuntimeSessionId: after.id! })).bodies.find(b => b.summary)
    expect(inherited).toMatchObject({ summary: 'inherited', historical: true, sourceRef: { sessionKey: JSON.parse(event.payloadJson).memory.sourceRef.sessionKey, sequence: event.sequence } })
  })
  it('reopens after backup remapping with the same private summary and portable source identity', async () => {
    const s = await setup(); const event = await s.note('portable', 'private', ['hero'])
    const backup = await exportProjectJSON(s.f.scope.projectId)
    const imported = await importProjectJSON(backup), scope = await resolveScope({ projectId: imported })
    const session = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(r => r.kind === 'ttrpg')!
    const memory = (await all(actor, { ...scope, productRuntimeSessionId: session.id!, runtimeActorKey: 'hero' })).bodies.find(b => b.summary)
    expect(memory).toMatchObject({ summary: 'portable', sourceRef: JSON.parse(event.payloadJson).memory.sourceRef, historical: false })
  })
})
