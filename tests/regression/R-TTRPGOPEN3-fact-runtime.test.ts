import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, branchProductRuntimeSession, readProductRuntimeStateVersion, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { startTtrpgOpenEpochV1, consultTtrpgOracleV1, commitTtrpgOpenOracleFactV1, retireTtrpgOpenSessionFactV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { ttrpgOpenSessionFactsV1, hashTtrpgOpenOracleFactCandidateV1, projectTtrpgOpenSessionFactsForActorV1, type TtrpgOpenOracleFactProposalV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { evaluateTtrpgPredicateV1 } from '../../src/lib/ttrpg/predicate'
import { openEnvelopeV1, readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { TTRPG_OPEN_FACTS_PROVIDER_V1 } from '../../src/lib/ttrpg/open-context-provider'

const rt = (state: Awaited<ReturnType<typeof readProductRuntimeState>>) => parseTtrpgRuntimeStateV2(state.ttrpg)!
const proposal = (overrides: Partial<TtrpgOpenOracleFactProposalV1> = {}): TtrpgOpenOracleFactProposalV1 => ({
  kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
  detail: '守灯人知道港口的当前状况。', sourceFactRefs: ['fact.harbor'], audience: 'party',
  knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null, ...overrides,
})
async function setup(oracleAudience: 'party' | 'gm-only' = 'party') {
  const fixture = await readyOpenTtrpgSessionV1('fact runtime', pkg => { pkg.ttrpg!.campaign.gmMode = 'human'; pkg.ttrpg!.rulePack.content.oracles[0].audience = oracleAudience })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'gm.epoch'), viewerKey: 'viewer.gm', triggerKind: 'continue-host', rawInput: '确认主持咨询与解释' })
  const event = await consultTtrpgOracleV1({ ...await openEnvelopeV1(fixture.sessionId, 'oracle.source'), viewerKey: 'viewer.gm',
    askedBy: 'gm', oracleKey: 'oracle.yes', question: '守灯人知道港口情况吗？', likelihoodTierKey: 'even' })
  const oracleSourceRef = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.oracleReceipts![0].sourceRef
  return { ...fixture, event, oracleSourceRef }
}
async function input(fixture: Awaited<ReturnType<typeof setup>>, commandId: string, proposed = proposal(), viewerKey = 'viewer.gm') {
  const envelope = await openEnvelopeV1(fixture.sessionId, commandId)
  return { ...envelope, viewerKey, oracleSourceRef: fixture.oracleSourceRef, proposal: proposed,
    candidateHash: await hashTtrpgOpenOracleFactCandidateV1({ proposal: proposed, oracleSourceRef: fixture.oracleSourceRef,
      runtimeSourceHash: fixture.session.runtimeSourceHash, viewerKey, baseStateHash: envelope.baseStateHash }) }
}
async function assertReplay(sessionId: number) {
  const session = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson),
    await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN3 real session fact owner, gates and retirement', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('requires the exact human-confirmed candidate, commits once, and feeds the next predicate without changing the frozen world or mechanics', async () => {
    const fixture = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    const beforeWorld = await db.worldReleases.where('worldId').equals(fixture.scope.worldId!).toArray()
    const command = await input(fixture, 'fact.confirm')
    await expect(commitTtrpgOpenOracleFactV1({ ...command, candidateHash: '0'.repeat(64) })).rejects.toThrow(/候选字节/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    const event = await commitTtrpgOpenOracleFactV1(command)
    expect(await commitTtrpgOpenOracleFactV1(command)).toEqual(event)
    const state = await readProductRuntimeState(fixture.sessionId), runtime = rt(state), facts = ttrpgOpenSessionFactsV1(runtime.openRun!.factLedger)
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ origin: 'oracle', originEventSequence: event.sequence, retired: false, subjectRef: 'keeper', predicateKey: 'knows' })
    expect(evaluateTtrpgPredicateV1({ op: 'session-fact', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', value: true },
      ttrpgOpenPredicateContextV1(state, fixture.runtimePackage.ttrpg!))).toBe(true)
    expect(state.entities).toEqual(before.entities)
    expect(runtime.openRun!.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(await db.worldReleases.where('worldId').equals(fixture.scope.worldId!).toArray()).toEqual(beforeWorld)
    await assertReplay(fixture.sessionId)
  })
  it('refuses mechanical owners, nonexistent subjects, invented sources, player decisions and a different viewer', async () => {
    const fixture = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    for (const [proposed, reason] of [
      [proposal({ predicateKey: 'located-at', canonicalValue: 'harbor' }), /机械 owner/],
      [proposal({ subjectRef: 'invented.npc' }), /new-subject/],
      [proposal({ sourceFactRefs: ['invented.fact'] }), /不可解析/],
      [proposal({ subjectRef: 'hero', predicateKey: 'promised', canonicalValue: '替玩家决定进攻' }), /替玩家/],
    ] as const) await expect(commitTtrpgOpenOracleFactV1(await input(fixture, 'bad', proposed))).rejects.toThrow(reason)
    await expect(commitTtrpgOpenOracleFactV1(await input(fixture, 'other.viewer', proposal(), OPEN_HUMAN_VIEWER))).rejects.toThrow(/真人 GM/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
  it('rejects invariant conflicts and any lowering of a genuine GM-only source', async () => {
    const fixture = await setup()
    await expect(commitTtrpgOpenOracleFactV1(await input(fixture, 'invariant', proposal({ subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, canonicalValue: false })))).rejects.toThrow(/F1/)
    const hidden = await setup('gm-only')
    await expect(commitTtrpgOpenOracleFactV1(await input(hidden, 'leak', proposal()))).rejects.toThrow(/F4.*密级降级/)
    await commitTtrpgOpenOracleFactV1(await input(hidden, 'private.gm', proposal({ audience: 'gm-only', knownByActorKeys: [] })))
    expect(ttrpgOpenSessionFactsV1(rt(await readProductRuntimeState(hidden.sessionId)).openRun!.factLedger)[0].audience).toBe('gm-only')
  })
  it('requires same-slot provenance to supersede and atomically retires the original interpretation in the replacement event', async () => {
    const fixture = await setup()
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'first'))
    const original = ttrpgOpenSessionFactsV1(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.factLedger)[0]
    await expect(commitTtrpgOpenOracleFactV1(await input(fixture, 'conflict', proposal({ canonicalValue: false })))).rejects.toThrow(/F3/)
    await expect(commitTtrpgOpenOracleFactV1(await input(fixture, 'wrong.slot', proposal({ objectRef: 'keeper', supersedes: original.factKey,
      supersedeReason: '换槽位', sourceFactRefs: [original.factKey] })))).rejects.toThrow(/slot-mismatch/)
    const replacement = await commitTtrpgOpenOracleFactV1(await input(fixture, 'replace', proposal({ canonicalValue: false, detail: '修订先前解释，仍保留原始骰子结果。',
      supersedes: original.factKey, supersedeReason: '更正解释', sourceFactRefs: [original.factKey] })))
    const runtime = rt(await readProductRuntimeState(fixture.sessionId)), facts = ttrpgOpenSessionFactsV1(runtime.openRun!.factLedger)
    expect(facts[0]).toMatchObject({ retired: true, retiredAtSequence: replacement.sequence })
    expect(facts[1]).toMatchObject({ retired: false, supersedes: original.factKey, canonicalValue: false })
    expect(runtime.openRun!.factLedger!.retirements[0].sourceRef).toEqual(runtime.openRun!.factLedger!.entries[1].sourceRef)
    expect(runtime.openRun!.oracleReceipts).toHaveLength(1)
    await assertReplay(fixture.sessionId)
  })
  it('records explicit withdrawal once and cannot retire world, mechanical or already retired state', async () => {
    const fixture = await setup()
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'first'))
    const factKey = ttrpgOpenSessionFactsV1(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.factLedger)[0].factKey
    const withdraw = { ...await openEnvelopeV1(fixture.sessionId, 'withdraw'), viewerKey: 'viewer.gm', factKey, reason: '撤回未经充分支持的解释' }
    expect(await retireTtrpgOpenSessionFactV1(withdraw)).toEqual(await retireTtrpgOpenSessionFactV1(withdraw))
    await expect(retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(fixture.sessionId, 'again'), viewerKey: 'viewer.gm', factKey, reason: '再撤回' })).rejects.toThrow(/活动会话事实/)
    await expect(retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(fixture.sessionId, 'world'), viewerKey: 'viewer.gm', factKey: 'fact.harbor', reason: '删除世界' })).rejects.toThrow(/活动会话事实/)
    expect(ttrpgOpenSessionFactsV1(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.factLedger)[0].retired).toBe(true)
    await assertReplay(fixture.sessionId)
  })
  it('preserves qualified fact evidence on a branch, accepts a fresh child withdrawal, and survives project backup remapping', async () => {
    const fixture = await setup()
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'first'))
    const parentBefore = await readProductRuntimeState(fixture.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: fixture.sessionId,
      throughSequence: (await readProductRuntimeStateVersion(fixture.sessionId)).sequence, title: 'fact branch', seed: 'fact.child.seed' })
    const childState = await readProductRuntimeState(child.id!)
    expect(rt(childState).openRun!.factLedger).toEqual(rt(parentBefore).openRun!.factLedger)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'zero'), viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: rt(childState).product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'child.gm'), viewerKey: 'viewer.gm', triggerKind: 'continue-host', rawInput: '审阅继承事实' })
    const factKey = ttrpgOpenSessionFactsV1(rt(childState).openRun!.factLedger)[0].factKey
    await retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(child.id!, 'child.withdraw'), viewerKey: 'viewer.gm', factKey, reason: '子分支撤回解释' })
    expect(ttrpgOpenSessionFactsV1(rt(await readProductRuntimeState(child.id!)).openRun!.factLedger)[0].retired).toBe(true)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(parentBefore)
    await assertReplay(child.id!)
    const backup = await exportProjectJSON(fixture.scope.projectId), importedProjectId = await importProjectJSON(backup)
    const imported = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray()
    const childSessionKey = rt(await readProductRuntimeState(child.id!)).sessionKey
    const importedStates = await Promise.all(imported.map(async session => ({ session, runtime: rt(await readProductRuntimeState(session.id!)) })))
    const importedChild = importedStates.find(item => item.runtime.sessionKey === childSessionKey)!.session
    expect(rt(await readProductRuntimeState(importedChild.id!)).openRun!.factLedger).toEqual(rt(await readProductRuntimeState(child.id!)).openRun!.factLedger)
  })
  it('rejects fabricated Oracle source or changed candidate fields during replay', async () => {
    const fixture = await setup(), before = await readProductRuntimeState(fixture.sessionId)
    const event = await commitTtrpgOpenOracleFactV1(await input(fixture, 'fact'))
    const payload = JSON.parse(event.payloadJson)
    payload.entry.oracleSourceRef.sequence = 1
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/Oracle/)
    const changed = JSON.parse(event.payloadJson)
    changed.entry.fact.canonicalValue = false
    expect(() => applyProductRuntimeEvent(before, { ...event, payloadJson: JSON.stringify(changed) })).toThrow(/候选/)
  })
  it('keeps private and GM-only truth out of other actor projections and does not turn facts into evidence grants', async () => {
    const fixture = await setup()
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'private.fact', proposal({ audience: 'private', knownByActorKeys: ['hero'], detail: 'HERO-PRIVATE-FACT' })))
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'gm.fact', proposal({ audience: 'gm-only', knownByActorKeys: [], detail: 'GM-PRIVATE-FACT' })))
    const hero = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })
    const companion = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'companion.1' })
    expect(hero.view.sessionFacts.map(fact => fact.detail)).toEqual(['HERO-PRIVATE-FACT'])
    expect(companion.view.sessionFacts).toEqual([])
    expect(hero.view.knowledge).toEqual([])
    const scope = { ...fixture.scope, productRuntimeSessionId: fixture.sessionId, runtimeActorKey: 'hero' }
    const metadata = await TTRPG_OPEN_FACTS_PROVIDER_V1.listMetadata({ scope, limit: 10 })
    expect(metadata.items).toHaveLength(2)
    const descriptor = metadata.items.find(item => item.resourceKey.endsWith('session-fact.0'))!
    const body = await TTRPG_OPEN_FACTS_PROVIDER_V1.read({ scope, resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: 10000 })
    expect(body.content).toContain('HERO-PRIVATE-FACT')
    for (const hidden of ['GM-PRIVATE-FACT', 'factPolicy', 'confirmationStateHash', 'oracleSourceRef']) expect(body.content).not.toContain(hidden)
    await expect(TTRPG_OPEN_FACTS_PROVIDER_V1.read({ scope, resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: 1 })).rejects.toThrow(/预算/)
    await expect(TTRPG_OPEN_FACTS_PROVIDER_V1.readOriginal({ scope, resourceKey: descriptor.resourceKey, sourceRef: descriptor.sourceRefs[0], maxTokens: 10000 })).rejects.toThrow(/原始/)
  })
  it('does not widen a private predecessor during supersession or grant old party truth to a later actor', async () => {
    const fixture = await setup()
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'private.fact', proposal({ audience: 'private', knownByActorKeys: ['hero'] })))
    const privateFact = ttrpgOpenSessionFactsV1(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.factLedger)[0]
    await expect(commitTtrpgOpenOracleFactV1(await input(fixture, 'public.replace', proposal({
      supersedes: privateFact.factKey, supersedeReason: '扩大公开', sourceFactRefs: [privateFact.factKey] })))).rejects.toThrow(/F4.*密级降级/)
    expect(ttrpgOpenSessionFactsV1(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.factLedger)[0].retired).toBe(false)
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'new.party.fact'))
    const ledger = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.factLedger
    expect(projectTtrpgOpenSessionFactsForActorV1(ledger, 'later.actor')).toEqual([])
    expect(projectTtrpgOpenSessionFactsForActorV1(ledger, 'companion.1')).toHaveLength(1)
  })
  it('does not bypass a second active contradiction when superseding one interpretation', async () => {
    const fixture = await setup()
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'first'))
    await commitTtrpgOpenOracleFactV1(await input(fixture, 'independent', proposal({ detail: '另一条独立的相同事实依据。' })))
    const before = await readProductRuntimeState(fixture.sessionId)
    const originals = ttrpgOpenSessionFactsV1(rt(before).openRun!.factLedger)
    await expect(commitTtrpgOpenOracleFactV1(await input(fixture, 'partial.replace', proposal({ canonicalValue: false,
      supersedes: originals[0].factKey, supersedeReason: '只替代第一条', sourceFactRefs: [originals[0].factKey] })))).rejects.toThrow(/F3/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
})
