import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedTtrpgWorldPatchReviewV1 } from '../helpers/open-ttrpg-world-patch'
import { readTtrpgWorldPatchDeskV1, exportTtrpgWorldPatchCandidateV1 } from '../../src/lib/ttrpg/open-world-patch-service'
import { verifyTtrpgWorldPatchCandidateV1, ttrpgWorldPatchConflictsV1, ttrpgWorldPatchFactVisibleV1 } from '../../src/lib/ttrpg/open-world-patch-contract'
import { hashProductProductionValueV2 as hash } from '../../src/lib/product-production/hash'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { openEnvelopeV1, readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { completeTtrpgOpenSessionZeroV1, retireTtrpgOpenSessionFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN8 confirmed session facts to portable author review only', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('bounds imported UTF-8 bytes before parsing even when character count is below the file limit', async () => {
    await expect(verifyTtrpgWorldPatchCandidateV1('界'.repeat(12 * 1024 * 1024))).rejects.toThrow(/32 MB/)
  })
  it('does not grant an incoming host historical party/private knowledge or GM truth', () => {
    const original = { audience: 'party' as const, knownBy: ['hero'] }, reader = { isHumanGm: false, actorKey: 'new.hero', includePrivate: false, includeGmOnly: false }
    expect(ttrpgWorldPatchFactVisibleV1(original, reader)).toBe(false)
    expect(ttrpgWorldPatchFactVisibleV1(original, { ...reader, actorKey: 'hero' })).toBe(true)
    expect(ttrpgWorldPatchFactVisibleV1({ ...original, audience: 'public' }, reader)).toBe(true)
    expect(ttrpgWorldPatchFactVisibleV1({ ...original, audience: 'private' }, { ...reader, includePrivate: true })).toBe(false)
    expect(ttrpgWorldPatchFactVisibleV1({ ...original, audience: 'private' }, { ...reader, actorKey: 'hero', includePrivate: true })).toBe(true)
    expect(ttrpgWorldPatchFactVisibleV1({ ...original, audience: 'gm-only' }, { ...reader, includeGmOnly: true })).toBe(false)
    expect(ttrpgWorldPatchFactVisibleV1(original, { ...reader, isHumanGm: true })).toBe(true)
    expect(ttrpgWorldPatchFactVisibleV1({ ...original, audience: 'gm-only' }, { ...reader, isHumanGm: true, includeGmOnly: true })).toBe(true)
  })
  it('uses an actually produced release, excludes private/retired/belief rows, retains pending choices and never writes any owner', async () => {
    const f = await seedTtrpgWorldPatchReviewV1(), page = await readTtrpgWorldPatchDeskV1(f.host)
    if (!page?.canExport) throw new Error('expected published desk')
    expect(page.facts).toHaveLength(2); expect(page.canIncludeGmOnly).toBe(true)
    const before = { state: await readProductRuntimeState(f.host.sessionId), world: await db.worldReleases.toArray(), product: await db.productReleases.toArray(), memories: await db.ttrpgNarrativeMemories.toArray(), runs: await db.agentRuns.count() }
    const file = await exportTtrpgWorldPatchCandidateV1({ ...f.host, reviewBasisHash: page.reviewBasisHash, selectedFactKeys: [page.facts[0].fact.factKey] })
    const checked = await verifyTtrpgWorldPatchCandidateV1(file.content, page.source)
    expect(checked.facts).toHaveLength(1); expect(checked.decisions.map(d => d.decision)).toEqual(['selected-for-review', 'pending'])
    expect(checked.source.worldReference.localReleaseRecordId).toBe(0)
    expect(checked.source.sourceManifestHash).toBe(JSON.parse(before.product[0].manifestJson).sourceContracts.sourceManifest.manifestHash)
    for (const secret of ['PRIVATE-PATCH', 'GM-PATCH', 'RETIRED-PATCH', 'BELIEF-MEMORY', 'apiKey', 'runtimePackage', 'initialStateJson', 'sessionId']) expect(file.content).not.toContain(secret)
    db.close(); await db.open()
    expect(await readProductRuntimeState(f.host.sessionId)).toEqual(before.state); expect(await db.worldReleases.toArray()).toEqual(before.world)
    expect(await db.productReleases.toArray()).toEqual(before.product); expect(await db.ttrpgNarrativeMemories.toArray()).toEqual(before.memories); expect(await db.agentRuns.count()).toBe(before.runs)
  })
  it('requires explicit secret inclusion and current host authority; player, unknown and cross-project identities cannot read it', async () => {
    const f = await seedTtrpgWorldPatchReviewV1()
    expect(await readTtrpgWorldPatchDeskV1(f.other)).toBeNull()
    await expect(readTtrpgWorldPatchDeskV1({ ...f.host, viewerKey: 'viewer.unknown' })).rejects.toThrow()
    const p = await readTtrpgWorldPatchDeskV1({ ...f.host, includePrivate: true, includeGmOnly: true })
    if (!p?.canExport) throw new Error('desk')
    expect(p.facts).toHaveLength(4)
    const file = await exportTtrpgWorldPatchCandidateV1({ ...f.host, includePrivate: true, includeGmOnly: true, reviewBasisHash: p.reviewBasisHash, selectedFactKeys: p.facts.map(f => f.fact.factKey) })
    expect(file.content).toContain('PRIVATE-PATCH'); expect(file.content).toContain('GM-PATCH'); expect(file.content).not.toContain('BELIEF-MEMORY')
    await expect(exportTtrpgWorldPatchCandidateV1({ ...f.host, reviewBasisHash: p.reviewBasisHash, selectedFactKeys: p.facts.map(f => f.fact.factKey) })).rejects.toThrow(/变化/)
    const other = await readyOpenTtrpgSessionV1('separate project')
    await expect(readTtrpgWorldPatchDeskV1({ ...f.host, scope: other.scope })).rejects.toThrow()
    await expect(readTtrpgWorldPatchDeskV1({ scope: other.scope, sessionId: other.sessionId, viewerKey: OPEN_HUMAN_VIEWER, includeGmOnly: true })).rejects.toThrow(/没有此权限/)
    expect((await readTtrpgWorldPatchDeskV1({ scope: other.scope, sessionId: other.sessionId, viewerKey: OPEN_HUMAN_VIEWER }))?.canExport).toBe(false)
  })
  it('rejects stale selection, hash/schema tampering, changed original facts and mismatched trusted source', async () => {
    const f = await seedTtrpgWorldPatchReviewV1(), p = await readTtrpgWorldPatchDeskV1(f.host)
    if (!p?.canExport) throw new Error('desk')
    const request = { ...f.host, reviewBasisHash: p.reviewBasisHash, selectedFactKeys: [p.facts[0].fact.factKey] }
    const { candidate } = await exportTtrpgWorldPatchCandidateV1(request)
    await expect(verifyTtrpgWorldPatchCandidateV1({ ...candidate, version: 2 })).rejects.toThrow()
    await expect(verifyTtrpgWorldPatchCandidateV1({ ...candidate, exportedAt: candidate.exportedAt + 1 })).rejects.toThrow(/hash/)
    await expect(verifyTtrpgWorldPatchCandidateV1(candidate, { ...p.source, sourcePlanHash: '0'.repeat(64) })).rejects.toThrow(/指定冻结/)
    const forged = structuredClone(candidate); forged.facts[0].entry.fact.detail = 'changed original'
    const { reviewHash: _reviewHash, ...body } = forged; forged.reviewHash = await hash(body)
    await expect(verifyTtrpgWorldPatchCandidateV1(forged)).rejects.toThrow(/原确认/)
    await retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(f.host.sessionId, 'retire.selected'), viewerKey: f.host.viewerKey, factKey: p.facts[0].fact.factKey, reason: '审阅时已撤回' })
    await expect(exportTtrpgWorldPatchCandidateV1(request)).rejects.toThrow(/变化/)
    const event = (await db.productRuntimeEvents.where('sessionId').equals(f.host.sessionId).toArray()).find(e => e.type === 'ttrpg.fact.asserted')!, payload = JSON.parse(event.payloadJson)
    payload.entry.fact.detail = 'tampered persisted original'
    await db.productRuntimeEvents.update(event.id!, { payloadJson: JSON.stringify(payload) })
    await expect(readTtrpgWorldPatchDeskV1(f.host)).rejects.toThrow()
  })
  it('retains session-qualified parent coordinates across a branch and real backup remapping', async () => {
    const f = await seedTtrpgWorldPatchReviewV1(), parent = await readProductRuntimeState(f.host.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: f.host.sessionId, throughSequence: parent.lastSequence, title: '补丁分支', seed: 'patch.child' })
    let state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.zero'), viewerKey: f.host.viewerKey, acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    const input = { ...f.host, sessionId: child.id! }, p = await readTtrpgWorldPatchDeskV1(input)
    if (!p?.canExport) throw new Error('desk')
    const file = await exportTtrpgWorldPatchCandidateV1({ ...input, reviewBasisHash: p.reviewBasisHash, selectedFactKeys: [p.facts[0].fact.factKey] })
    expect(file.candidate.cutpoint.ancestors[0].sessionKey).toBe(parent.ttrpg!.sessionKey)
    expect(file.candidate.facts[0].entry.sourceRef.sessionKey).toBe(parent.ttrpg!.sessionKey)
    expect(file.candidate.cutpoint.sessionKey).not.toBe(parent.ttrpg!.sessionKey)
    await deleteProductRuntimeSession(f.host.sessionId)
    expect((await readTtrpgWorldPatchDeskV1(input))?.canExport).toBe(true)
    const importedProjectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray()).find(s => JSON.parse(s.initialStateJson).ttrpg?.sessionKey === file.candidate.cutpoint.sessionKey)!
    state = await readProductRuntimeState(restored.id!)
    const rp = await readTtrpgWorldPatchDeskV1({ scope: { projectId: importedProjectId, worldId: restored.worldId, workId: restored.workId! }, sessionId: restored.id!, viewerKey: f.host.viewerKey })
    expect(rp?.canExport).toBe(true)
    if (rp?.canExport) { expect(rp.source).toEqual(file.candidate.source); expect(rp.facts[0].sourceRef).toEqual(file.candidate.facts[0].entry.sourceRef) }
    expect(state.lastSequence).toBeGreaterThan(0)
  })
  it('reuses exact canonical conflicts for frozen initial differences and invariant conflicts without comparing prose', async () => {
    const f = await seedTtrpgWorldPatchReviewV1(), p = await readTtrpgWorldPatchDeskV1(f.host)
    if (!p?.canExport) throw new Error('desk')
    const { candidate } = await exportTtrpgWorldPatchCandidateV1({ ...f.host, reviewBasisHash: p.reviewBasisHash, selectedFactKeys: [p.facts[0].fact.factKey] })
    const fact = candidate.facts[0].entry.fact, frozen = { ...candidate.frozenComparisons[0], factKey: 'frozen.keeper.knows', subjectRef: fact.subjectRef, predicateKey: fact.predicateKey, objectRef: fact.objectRef, canonicalValue: false }
    expect(ttrpgWorldPatchConflictsV1(candidate.facts, [{ ...frozen, authority: 'initial-state' }])).toEqual([{ factKey: fact.factKey, against: frozen.factKey, reason: 'frozen-initial-state-difference' }])
    expect(ttrpgWorldPatchConflictsV1(candidate.facts, [frozen])[0].reason).toBe('frozen-invariant-conflict')
    expect(ttrpgWorldPatchConflictsV1(candidate.facts, [{ ...frozen, canonicalValue: true }])).toEqual([])
  })
})
