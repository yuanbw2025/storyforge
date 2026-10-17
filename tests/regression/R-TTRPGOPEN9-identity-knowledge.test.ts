import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupIdentityKnowledgeRuntimeV1 as setup, identityKnowledgeWindowV1 as window } from '../helpers/open-identity-knowledge-runtime'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { changeTtrpgSafetyStatus, shareTtrpgOpenKnowledgeV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent,
  branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { prepareTtrpgOpenIdentityKnowledgeV1, confirmTtrpgOpenIdentityKnowledgeReviewV1, readTtrpgOpenLearnedIdentitiesV1, readTtrpgOpenIdentityKnowledgeDeskV1, type TtrpgOpenIdentityKnowledgeDeskInputV1 } from '../../src/lib/ttrpg/open-identity-knowledge-service'
import { ttrpgOpenActorKnowsEvidenceV1, projectTtrpgOpenKnowledgeForViewerV1 } from '../../src/lib/ttrpg/open-knowledge'
import { ttrpgOpenEntityIdentityCatalogV1 } from '../../src/lib/ttrpg/open-entity-catalog'
import { hashTtrpgOpenKnowledgeShareConfirmationV1 } from '../../src/lib/ttrpg/open-knowledge-share'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const confirm = (owner: TtrpgOpenIdentityKnowledgeDeskInputV1, review: Awaited<ReturnType<typeof prepareTtrpgOpenIdentityKnowledgeV1>>) =>
  confirmTtrpgOpenIdentityKnowledgeReviewV1({ ...owner, review, decision: 'confirm-these-identities-and-recipients' })
async function prepared(s: Awaited<ReturnType<typeof setup>>, submissionKey = 'identity.review') {
  return prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, request: s.request, submissionKey })
}
describe('R-TTRPGOPEN9 actual later observation and attributed identity propagation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('binds a real observation once, preserves original F13 scope, and exposes only a minimal human name projection', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), review = await prepared(s)
    const hiddenDesk = await readTtrpgOpenIdentityKnowledgeDeskV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER })
    expect(JSON.stringify(hiddenDesk)).not.toContain('新守灯人'); expect(hiddenDesk.canReview).toBe(false)
    expect(review.identities).toEqual([{ entityRef: s.entityRef, kind: 'actor', name: '新守灯人' }])
    expect(JSON.stringify(review)).not.toMatch(/frozenContent|gmProfile|planHash|templateKey|locationRef/)
    const result = await confirm(s.owner, review); expect(await confirm(s.owner, review)).toEqual(result)
    const state = await readProductRuntimeState(s.f.sessionId), run = rt(state).openRun!
    expect(run.knowledge[0]).toEqual(s.root); expect(run.knowledge).toHaveLength(2)
    expect(run.knowledge[1]).toMatchObject({ reliability: 'observed', audience: 'private', recipientActorKeys: ['hero'] })
    expect(ttrpgOpenEntityIdentityCatalogV1(s.f.runtimePackage.ttrpg!, run.entityOperations!).find(row => row.entityKey === s.entityRef)!.audience).toBe('gm-only')
    const hero = { ...s.owner, viewerKey: OPEN_HUMAN_VIEWER }, outsider = { ...s.owner, viewerKey: 'viewer.seat.companion.2' }
    expect(await readTtrpgOpenLearnedIdentitiesV1(hero)).toMatchObject([{ name: '新守灯人', reliability: 'observed' }])
    expect(await readTtrpgOpenLearnedIdentitiesV1(outsider)).toEqual([])
    expect((await readTtrpgOpenIdentityKnowledgeDeskV1(hero)).instances).toMatchObject([{ entityRef: s.entityRef, name: '新守灯人' }])
    expect(projectTtrpgOpenKnowledgeForViewerV1({ entries: run.knowledge, authorization: rt(state).authorization!, viewerKey: OPEN_HUMAN_VIEWER, campaign: s.f.campaign })).toHaveLength(1)
    expect(run.worldTime).toEqual(rt(before).openRun!.worldTime); expect(state.entities).toEqual(before.entities)
    expect(ttrpgOpenActorKnowsEvidenceV1([run.knowledge[1]], 'hero', s.root.evidenceRef)).toBe(false)
  })
  it('explicitly shares selected identities as hearsay and keeps the V1 share protocol free of identity grants', async () => {
    const s = await setup(), observed = await confirm(s.owner, await prepared(s))
    await window(s.f.sessionId, OPEN_HUMAN_VIEWER)
    const hero = { ...s.owner, viewerKey: OPEN_HUMAN_VIEWER }, request = { ...s.request, mode: 'share' as const, actorKey: 'hero', sourceKnowledgeKey: observed.knowledgeKey, recipientActorKeys: ['companion.2'] }
    const review = await prepareTtrpgOpenIdentityKnowledgeV1({ ...hero, request, submissionKey: 'identity.share' })
    await confirm(hero, review)
    const state = await readProductRuntimeState(s.f.sessionId), run = rt(state).openRun!
    expect(run.knowledge).toHaveLength(3); expect(run.knowledgeShares).toHaveLength(1)
    expect(run.knowledge[2]).toMatchObject({ reliability: 'hearsay', recipientActorKeys: ['companion.2'], identityGrant: { mode: 'share' } })
    expect(await readTtrpgOpenLearnedIdentitiesV1({ ...s.owner, viewerKey: 'viewer.seat.companion.2' })).toMatchObject([{ name: '新守灯人', reliability: 'hearsay' }])
    expect(ttrpgOpenActorKnowsEvidenceV1(run.knowledge, 'companion.2', s.root.evidenceRef)).toBe(false)
    const envelope = await openEnvelopeV1(s.f.sessionId, 'legacy.share'), legacy = { actorKey: 'hero', sourceKnowledgeKey: observed.knowledgeKey,
      audience: 'private' as const, recipientActorKeys: ['companion.1'], publicFieldsHash: s.root.publicFieldsHash }
    await shareTtrpgOpenKnowledgeV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER, request: legacy, confirmationHash: await hashTtrpgOpenKnowledgeShareConfirmationV1({ request: legacy,
      viewerKey: OPEN_HUMAN_VIEWER, baseStateHash: envelope.baseStateHash, runtimeSourceHash: s.f.session.runtimeSourceHash }) })
    expect(rt(await readProductRuntimeState(s.f.sessionId)).openRun!.knowledge[3].identityGrant).toBeUndefined()
  })
  it('refuses hidden-name guessing, unrelated observers, public expansion and invented identities', async () => {
    const s = await setup()
    for (const request of [{ ...s.request, recipientActorKeys: ['companion.2'] }, { ...s.request, audience: 'public' as const, recipientActorKeys: [] }, { ...s.request, entityRefs: ['hero'] }]) {
      await expect(prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, request, submissionKey: crypto.randomUUID() })).rejects.toThrow()
    }
    await window(s.f.sessionId, OPEN_HUMAN_VIEWER)
    await expect(prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER, request: { ...s.request, actorKey: 'hero' }, submissionKey: 'guess' })).rejects.toThrow(/隐藏身份/)
    expect(rt(await readProductRuntimeState(s.f.sessionId)).openRun!.knowledge).toEqual([s.root])
  })
  it('does not reinterpret an earlier clue as observation of a later-created real entity', async () => {
    const s = await setup(true)
    await expect(prepared(s)).rejects.toThrow(/晚于原实际创建/)
  })
  it('keeps the exact review through transaction rollback and a lost successful return, rejects copied or changed reviews', async () => {
    const s = await setup(), review = await prepared(s), before = await readProductRuntimeState(s.f.sessionId)
    await expect(confirm(s.owner, structuredClone(review))).rejects.toThrow(/重新核对/)
    review.identities[0].name = 'forged'; await expect(confirm(s.owner, review)).rejects.toThrow(/重新核对/); review.identities[0].name = '新守灯人'
    const failure = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('identity storage rollback'))
    await expect(confirm(s.owner, review)).rejects.toThrow(/identity storage rollback/); failure.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    const transaction = db.transaction.bind(db), lost = vi.spyOn(db, 'transaction').mockImplementationOnce(async (...args: Parameters<typeof db.transaction>) => {
      await transaction(...args); throw new Error('identity committed response lost')
    })
    await expect(confirm(s.owner, review)).rejects.toThrow(/committed response lost/); lost.mockRestore()
    const saved = await confirm(s.owner, review); expect(await confirm(s.owner, review)).toEqual(saved)
    expect(rt(await readProductRuntimeState(s.f.sessionId)).openRun!.knowledge).toHaveLength(2)
  })
  it('rejects stale, paused and forged replay payloads without changing the original game state', async () => {
    const s = await setup(), stale = await prepared(s)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'pause.identity'), viewerKey: 'viewer.gm', changedBy: 'gm', status: 'paused', reason: '暂停' })
    await expect(confirm(s.owner, stale)).rejects.toThrow(/变化|暂停/)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'resume.identity'), viewerKey: 'viewer.gm', changedBy: 'gm', status: 'active', reason: '恢复' })
    await confirm(s.owner, await prepared(s, 'fresh'))
    const session = (await db.productRuntimeSessions.get(s.f.sessionId))!, events = await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).sortBy('sequence')
    const event = events.find(row => row.type === 'ttrpg.open.knowledge.identity-confirmed')!, prior = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(row => row.sequence < event.sequence))
    const payload = JSON.parse(event.payloadJson); payload.knowledge.identityGrant.identities[0].name = '伪造名称'
    expect(() => applyProductRuntimeEvent(prior, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/不一致/)
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(await readProductRuntimeState(s.f.sessionId))
  })
  it('preserves the exact typed grant across branching, parent deletion and full project backup', async () => {
    const s = await setup(), observed = await confirm(s.owner, await prepared(s))
    await window(s.f.sessionId, OPEN_HUMAN_VIEWER)
    const share = { ...s.request, mode: 'share' as const, actorKey: 'hero', sourceKnowledgeKey: observed.knowledgeKey, recipientActorKeys: ['companion.2'] }
    await confirm({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER }, await prepareTtrpgOpenIdentityKnowledgeV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER, request: share, submissionKey: 'branch.original.share' }))
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence, title: 'identity child', seed: 'identity.child' })
    const beforeZero = rt(await readProductRuntimeState(child.id!))
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.zero'), viewerKey: 'viewer.gm', selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: beforeZero.product.sessionZero.requiredItemKeys })
    const input = { ...s.owner, sessionId: child.id!, viewerKey: OPEN_HUMAN_VIEWER }, expected = await readTtrpgOpenLearnedIdentitiesV1(input)
    const listener = { ...input, viewerKey: 'viewer.seat.companion.2' }, listenerExpected = await readTtrpgOpenLearnedIdentitiesV1(listener)
    expect(listenerExpected).toMatchObject([{ name: '新守灯人', reliability: 'hearsay' }])
    await deleteProductRuntimeSession(s.f.sessionId)
    expect(await readTtrpgOpenLearnedIdentitiesV1(input)).toEqual(expected)
    expect(await readTtrpgOpenLearnedIdentitiesV1(listener)).toEqual(listenerExpected)
    await window(child.id!, OPEN_HUMAN_VIEWER)
    await confirm(input, await prepareTtrpgOpenIdentityKnowledgeV1({ ...input, request: { ...share, recipientActorKeys: ['companion.1'] }, submissionKey: 'new.child.share' }))
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
    const imported = sessions.find(row => row.title === child.title)!
    expect(await readTtrpgOpenLearnedIdentitiesV1({ scope: { projectId, worldId: imported.worldId!, workId: imported.workId! }, sessionId: imported.id!, viewerKey: OPEN_HUMAN_VIEWER })).toEqual(expected)
    expect(await readTtrpgOpenLearnedIdentitiesV1({ scope: { projectId, worldId: imported.worldId!, workId: imported.workId! }, sessionId: imported.id!, viewerKey: 'viewer.seat.companion.2' })).toEqual(listenerExpected)
  })
})
