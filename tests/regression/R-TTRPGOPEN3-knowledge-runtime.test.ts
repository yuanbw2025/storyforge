import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, applyProductRuntimeEvent, branchProductRuntimeSession, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { startTtrpgOpenOperationV1,
  discoverTtrpgOpenKnowledgeV1, shareTtrpgOpenKnowledgeV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { ttrpgOpenActorKnowsEvidenceV1 } from '../../src/lib/ttrpg/open-knowledge'
import { hashTtrpgOpenKnowledgeShareConfirmationV1 } from '../../src/lib/ttrpg/open-knowledge-share'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { setup, start } from '../helpers/open-ttrpg-knowledge'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'

const rt = (state: Awaited<ReturnType<typeof readProductRuntimeState>>) => parseTtrpgRuntimeStateV2(state.ttrpg)!
async function assertReplay(sessionId: number) {
  const session = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN3 governed discovery in a causal operation', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('requires an exact active intervention/path and does not grant evidence merely from an action name', async () => {
    const fixture = await setup()
    const bad = { ...fixture.request, discovery: { ...fixture.request.discovery, interventionPointKey: 'invented.point' } }
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'bad'), viewerKey: OPEN_HUMAN_VIEWER, request: bad })).rejects.toThrow(/介入点/)
    const { discovery: _discovery, ...ordinary } = fixture.request
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'ordinary'), viewerKey: OPEN_HUMAN_VIEWER, request: ordinary })
    expect(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.knowledge).toEqual([])
    expect(rt(await readProductRuntimeState(fixture.sessionId)).openRun!.operations[0].plannedSteps.some(step => step.kind === 'knowledge')).toBe(false)
  })
  it('settles actual private discovery once and keeps its public fields out of other characters', async () => {
    const fixture = await setup({ private: true }), command = await start(fixture)
    expect(await resumeTtrpgOpenOperationV1(command)).toMatchObject({ status: 'awaiting-owner', nextStepKey: 'pressure' })
    const before = await readProductRuntimeState(fixture.sessionId), run = rt(before).openRun!
    expect(run.knowledge).toHaveLength(1)
    expect(ttrpgOpenActorKnowsEvidenceV1(run.knowledge, 'hero', fixture.request.discovery.evidenceRef)).toBe(true)
    expect(ttrpgOpenActorKnowsEvidenceV1(run.knowledge, 'companion.1', fixture.request.discovery.evidenceRef)).toBe(false)
    const hero = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })
    const companion = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'companion.1' })
    expect(hero.view.knowledge).toHaveLength(1)
    expect(companion.view.knowledge).toEqual([])
    await resumeTtrpgOpenOperationV1(command)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    expect((await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).toArray()).filter(event => event.type === 'ttrpg.open.knowledge.discovered')).toHaveLength(1)
    await assertReplay(fixture.sessionId)
  })
  it('does not award knowledge on failed checks without a frozen fail-forward path', async () => {
    const fixture = await setup({ generic: true }), command = await start(fixture)
    await resumeTtrpgOpenOperationV1(command)
    const run = rt(await readProductRuntimeState(fixture.sessionId)).openRun!
    expect(run.ruleReceipts[0].result.outcome).toMatch(/failure/)
    expect(run.knowledge).toEqual([])
    const event = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).filter(event => event.type === 'ttrpg.open.knowledge.discovered').first()
    expect(JSON.parse(event!.payloadJson).settlement.outcome).toBe('not-discovered')
    await assertReplay(fixture.sessionId)
  })
  it('pays frozen fail-forward cost before awarding knowledge and never charges it again during recovery', async () => {
    const fixture = await setup({ generic: true, failForward: true }), command = await start(fixture)
    const resource = fixture.runtimePackage.ttrpg!.rulePack.content.resources[0].key
    const before = Number((await readProductRuntimeState(fixture.sessionId)).entities.hero.attributes[`resource.${resource}`])
    await resumeTtrpgOpenOperationV1(command)
    const state = await readProductRuntimeState(fixture.sessionId)
    expect(Number(state.entities.hero.attributes[`resource.${resource}`])).toBe(before - 1)
    expect(rt(state).openRun!.knowledge).toHaveLength(1)
    await resumeTtrpgOpenOperationV1(command)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(state)
    await assertReplay(fixture.sessionId)
  })
  it('rejects forged recipient/outcome payloads during replay', async () => {
    const fixture = await setup({ private: true }), command = await start(fixture)
    await resumeTtrpgOpenOperationV1(command)
    const session = (await db.productRuntimeSessions.get(fixture.sessionId))!
    const events = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).sortBy('sequence')
    const event = events.find(event => event.type === 'ttrpg.open.knowledge.discovered')!
    const prior = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events.filter(item => item.sequence < event.sequence))
    const payload = JSON.parse(event.payloadJson)
    payload.settlement.knowledge.recipientActorKeys.push('companion.1')
    expect(() => applyProductRuntimeEvent(prior, { ...event, payloadJson: JSON.stringify(payload) })).toThrow(/接收者/)
    await expect(discoverTtrpgOpenKnowledgeV1({ ...await openEnvelopeV1(fixture.sessionId, 'forged'), ...command })).rejects.toThrow(/步骤 key/)
  })
  it('records explicit sharing as hearsay without changing the original private grant or ticking time', async () => {
    const fixture = await setup({ private: true }), operation = await start(fixture)
    await resumeTtrpgOpenOperationV1(operation)
    const before = await readProductRuntimeState(fixture.sessionId), original = rt(before).openRun!.knowledge[0]
    const envelope = await openEnvelopeV1(fixture.sessionId, 'share')
    const request = { actorKey: 'hero', sourceKnowledgeKey: original.knowledgeKey, audience: 'private' as const,
      recipientActorKeys: ['companion.1'], publicFieldsHash: original.publicFieldsHash }
    const input = { ...envelope, viewerKey: OPEN_HUMAN_VIEWER, request, confirmationHash: await hashTtrpgOpenKnowledgeShareConfirmationV1({ request,
      viewerKey: OPEN_HUMAN_VIEWER, baseStateHash: envelope.baseStateHash, runtimeSourceHash: fixture.session.runtimeSourceHash }) }
    const shared = await shareTtrpgOpenKnowledgeV1(input)
    expect(await shareTtrpgOpenKnowledgeV1(input)).toEqual(shared)
    const state = await readProductRuntimeState(fixture.sessionId), run = rt(state).openRun!
    expect(run.knowledge[0]).toEqual(original)
    expect(run.knowledge[1]).toMatchObject({ reliability: 'hearsay', audience: 'private', recipientActorKeys: ['companion.1'] })
    expect(run.knowledgeShares![0].sourceAcquisitionRef).toEqual(original.acquisitionRef)
    expect(ttrpgOpenActorKnowsEvidenceV1(run.knowledge, 'companion.1', original.evidenceRef)).toBe(false)
    expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(state.entities).toEqual(before.entities)
    const listener = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'companion.1' })
    expect(listener.view.knowledge[0].reliability).toBe('hearsay')
    const outsider = await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'companion.2' })
    expect(outsider.view.knowledge).toEqual([])
    await assertReplay(fixture.sessionId)
  })
  it('refuses an invented or unowned source, altered confirmation and paused sharing', async () => {
    const fixture = await setup({ private: true }), operation = await start(fixture)
    await resumeTtrpgOpenOperationV1(operation)
    const before = await readProductRuntimeState(fixture.sessionId), original = rt(before).openRun!.knowledge[0]
    const envelope = await openEnvelopeV1(fixture.sessionId, 'bad.share')
    const request = { actorKey: 'hero', sourceKnowledgeKey: original.knowledgeKey, audience: 'private' as const,
      recipientActorKeys: ['companion.1'], publicFieldsHash: original.publicFieldsHash }
    await expect(shareTtrpgOpenKnowledgeV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER, request, confirmationHash: '0'.repeat(64) })).rejects.toThrow(/stale/)
    const other = { ...request, actorKey: 'companion.2' }
    await expect(shareTtrpgOpenKnowledgeV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER, request: other,
      confirmationHash: await hashTtrpgOpenKnowledgeShareConfirmationV1({ request: other, viewerKey: OPEN_HUMAN_VIEWER,
        baseStateHash: envelope.baseStateHash, runtimeSourceHash: fixture.session.runtimeSourceHash }) })).rejects.toThrow(/未获授权/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'pause'), status: 'paused', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER, reason: '暂停' })
    const paused = await openEnvelopeV1(fixture.sessionId, 'paused.share')
    await expect(shareTtrpgOpenKnowledgeV1({ ...paused, viewerKey: OPEN_HUMAN_VIEWER, request,
      confirmationHash: await hashTtrpgOpenKnowledgeShareConfirmationV1({ request, viewerKey: OPEN_HUMAN_VIEWER,
        baseStateHash: paused.baseStateHash, runtimeSourceHash: fixture.session.runtimeSourceHash }) })).rejects.toThrow(/暂停/)
  })
  it('retains discovery/share provenance and recipient scope in a branch and a project backup', async () => {
    const fixture = await setup({ private: true }), operation = await start(fixture)
    await resumeTtrpgOpenOperationV1(operation)
    const original = rt(await readProductRuntimeState(fixture.sessionId)).openRun!.knowledge[0]
    const request = { actorKey: 'hero', sourceKnowledgeKey: original.knowledgeKey, audience: 'private' as const,
      recipientActorKeys: ['companion.1'], publicFieldsHash: original.publicFieldsHash }
    const envelope = await openEnvelopeV1(fixture.sessionId, 'share')
    await shareTtrpgOpenKnowledgeV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER, request,
      confirmationHash: await hashTtrpgOpenKnowledgeShareConfirmationV1({ request, viewerKey: OPEN_HUMAN_VIEWER,
        baseStateHash: envelope.baseStateHash, runtimeSourceHash: fixture.session.runtimeSourceHash }) })
    const before = await readProductRuntimeState(fixture.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: fixture.sessionId,
      throughSequence: (await readProductRuntimeStateVersion(fixture.sessionId)).sequence, title: 'knowledge branch', seed: 'knowledge.child' })
    const childRun = rt(await readProductRuntimeState(child.id!)).openRun!
    expect(childRun.knowledge).toEqual(rt(before).openRun!.knowledge)
    expect(childRun.knowledgeShares).toEqual(rt(before).openRun!.knowledgeShares)
    const backup = await exportProjectJSON(fixture.scope.projectId), projectId = await importProjectJSON(backup)
    const sessions = await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()
    const states = await Promise.all(sessions.map(async session => ({ session, state: await readProductRuntimeState(session.id!) })))
    // Compare by the real child state identity, never by a nonexistent session row property.
    const childIdentity = rt(await readProductRuntimeState(child.id!)).sessionKey
    expect(rt(states.find(item => rt(item.state).sessionKey === childIdentity)!.state).openRun!.knowledgeShares).toEqual(childRun.knowledgeShares)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
})
