import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, readProductRuntimeStateVersion, replayProductRuntimeEvents, parseProductRuntimeState } from '../../src/lib/product/runtime-core'
import { completeTtrpgSessionZero, completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1,
  startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, advanceTtrpgWorldTurnV1 } from '../../src/lib/ttrpg/runtime-commands'
import { changeTtrpgSafetyStatus, recordTtrpgOpenFailureV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readTtrpgSessionParticipantsV2, configureTtrpgSessionParticipantV2, buildInitialTtrpgParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { parseTtrpgOpenAuthorizationV1, createTtrpgOpenAuthorizationV1 } from '../../src/lib/ttrpg/open-authorization'
import { parseTtrpgOpenCoordinationV1, ttrpgOpenScopedKeyV1 } from '../../src/lib/ttrpg/open-coordination'
import { assertFrozenProductRuntimeStateV1 } from '../../src/lib/product/runtime-product-adapters'
import { openHybridCampaignFixture } from '../helpers/ttrpg-open-content'
import { projectTtrpgRulePackMechanicalCoreV1 } from '../../src/lib/ttrpg/rule-pack-v2'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { configureOpenSeatsV1, openEnvelopeV1, readyOpenTtrpgSessionV1, seedOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'

async function readOpen(sessionId: number) {
  const state = await readProductRuntimeState(sessionId)
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime) throw new Error('missing open fixture')
  return { state, runtime }
}
async function eventCount(sessionId: number) { return db.productRuntimeEvents.where('sessionId').equals(sessionId).count() }

describe('R-TTRPGOPEN1 authoritative Session Zero and epochs', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('initializes real mechanical values and rejects changed initial state at the source boundary', async () => {
    const fixture = await seedOpenTtrpgSessionV1()
    const { state, runtime } = await readOpen(fixture.sessionId)
    expect(runtime.authorization).toBeNull()
    expect(runtime.openRun).toBeNull()
    expect(runtime.sessionKey).toMatch(/^ttrpg\./)
    const actor = fixture.campaign.characterTemplates.find(actor => actor.characterKey === 'hero')!
    for (const [key, value] of Object.entries(actor.attributes)) expect(state.entities.hero.attributes[key]).toBe(value)
    for (const [key, value] of Object.entries(actor.resources)) expect(state.entities.hero.attributes[`resource.${key}`]).toBe(value)
    const good = { initial: state, runtimePackage: fixture.runtimePackage,
      runtimeSourceHash: fixture.preview.packageHash, origin: 'preview' as const }
    expect(() => assertFrozenProductRuntimeStateV1(good)).not.toThrow()
    const altered = structuredClone(state)
    altered.entities.hero.locationKey = 'missing'
    expect(() => assertFrozenProductRuntimeStateV1({ ...good, initial: altered })).toThrow(/冻结内容/)
    const resource = Object.keys(actor.resources)[0]
    altered.entities.hero.locationKey = state.entities.hero.locationKey
    altered.entities.hero.attributes[`resource.${resource}`] = -1
    expect(() => assertFrozenProductRuntimeStateV1({ ...good, initial: altered })).toThrow(/冻结内容/)
  })

  it('cannot start before Session Zero or use the old implicit authority API', async () => {
    const fixture = await seedOpenTtrpgSessionV1()
    const before = await db.productRuntimeSessions.get(fixture.sessionId)
    const { state } = await readOpen(fixture.sessionId)
    const envelope = await openEnvelopeV1(fixture.sessionId, 'no.zero')
    await expect(startTtrpgOpenRunV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/Session Zero/)
    await expect(completeTtrpgSessionZero({ ...envelope, commandId: 'old.zero',
      acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, completedBy: 'gm' })).rejects.toThrow(/显式真人授权/)
    expect(await db.productRuntimeSessions.get(fixture.sessionId)).toEqual(before)
  })

  it('installs initial item bindings through the inventory owner and rejects changed ownership', async () => {
    const fixture = await seedOpenTtrpgSessionV1('initial inventory', runtimePackage => {
      const content = runtimePackage.ttrpg!
      if (content.campaign.version !== 2 || content.rulePack.content.version !== 2) throw new Error('requires open fixture')
      const rule = projectTtrpgRulePackMechanicalCoreV1(content.rulePack.content)
      const itemKey = rule.items[0].key
      const hero = content.campaign.characterTemplates.find(actor => actor.characterKey === 'hero')!
      hero.itemKeys = [itemKey]
      const { characterSheet: _sheet, ...template } = hero
      hero.characterSheet = createCompleteTtrpgCharacterSheetV2({ template, rulePack: rule })
      content.campaign.entityBindings.find(binding => binding.bindingKey === 'hero')!.initialInventoryRefs = ['item.starting']
      content.campaign.entityBindings.push({ bindingKey: 'item.starting', sourceResourceRef: null, kind: 'item',
        templateKey: itemKey, initialLocationRef: null, initialInventoryRefs: [], sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
    })
    const { state } = await readOpen(fixture.sessionId)
    expect(state.entities['item.starting'].kind).toBe('item')
    expect(state.ttrpg!.product.inventory.items['item.starting']).toMatchObject({
      ownerRef: 'hero', itemInstanceId: 'item.starting', acquiredByEventId: 'release.initial', quantity: 1 })
    const corrupted = structuredClone(state)
    corrupted.ttrpg!.product.inventory.items['item.starting'].ownerRef = 'companion.1'
    expect(() => assertFrozenProductRuntimeStateV1({ initial: corrupted, runtimePackage: fixture.runtimePackage,
      runtimeSourceHash: fixture.preview.packageHash, origin: 'preview' })).toThrow(/冻结内容/)
  })

  it('requires a claimed human and disclosed AI identity without partially accepting seats', async () => {
    const fixture = await seedOpenTtrpgSessionV1()
    const { state } = await readOpen(fixture.sessionId)
    const seats = await readTtrpgSessionParticipantsV2(fixture.sessionId)
    const count = await eventCount(fixture.sessionId)
    const input = { ...await openEnvelopeV1(fixture.sessionId, 'unclaimed.zero'), viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] }
    await expect(completeTtrpgOpenSessionZeroV1(input)).rejects.toThrow(/claimed|认领/)
    const human = seats.find(seat => seat.actorKey === 'hero')!
    await configureTtrpgSessionParticipantV2({ sessionId: fixture.sessionId, seatKey: human.seatKey,
      expectedRevision: human.revision, commandId: 'claim.only', requestedByViewerKey: human.viewerKey, assignmentState: 'claimed' })
    await expect(completeTtrpgOpenSessionZeroV1({ ...input, commandId: 'undisclosed.zero' })).rejects.toThrow(/AI 身份/)
    expect(await eventCount(fixture.sessionId)).toBe(count)
    expect((await readOpen(fixture.sessionId)).runtime.authorization).toBeNull()
    expect((await readTtrpgSessionParticipantsV2(fixture.sessionId)).every(seat => seat.sessionZeroAcceptedAtSequence === null)).toBe(true)
  })

  it('saves approval bindings and seat revisions atomically with Session Zero', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    const { runtime } = await readOpen(fixture.sessionId)
    const auth = runtime.authorization!
    expect(auth.completedBySeatKey).toBe('seat.hero')
    expect(auth.revision).toBe(fixture.zero.sequence)
    expect(auth.sourceRef).toEqual({ sessionKey: runtime.sessionKey, sequence: fixture.zero.sequence })
    expect(auth.approvalBindings).toHaveLength(2)
    expect(auth.approvalBindings.every(binding => binding.approverSeatKeys[0] === 'seat.hero')).toBe(true)
    const seats = await readTtrpgSessionParticipantsV2(fixture.sessionId)
    for (const bound of auth.seats) {
      const actual = seats.find(seat => seat.seatKey === bound.seatKey)!
      expect(actual.revision).toBe(bound.revision)
      expect(actual.sessionZeroAcceptedAtSequence).toBe(auth.revision)
      expect(actual.consent.safetyBoundariesAccepted).toBe(true)
    }
    const session = (await db.productRuntimeSessions.get(fixture.sessionId))!
    const events = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual((await readOpen(fixture.sessionId)).state)
  })

  it.each(['seat-finalization', 'runtime-head'])('rolls back Session Zero at %s and permits one explicit retry', async boundary => {
    const fixture = await seedOpenTtrpgSessionV1()
    await configureOpenSeatsV1(fixture.sessionId)
    const before = await db.productRuntimeSessions.get(fixture.sessionId)
    const seats = await readTtrpgSessionParticipantsV2(fixture.sessionId)
    const count = await eventCount(fixture.sessionId)
    const { state } = await readOpen(fixture.sessionId)
    const input = { ...await openEnvelopeV1(fixture.sessionId, `fault.${boundary}`), viewerKey: OPEN_HUMAN_VIEWER,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys }
    let calls = 0
    const originalPut = db.ttrpgSessionParticipants.put.bind(db.ttrpgSessionParticipants)
    const originalUpdate = db.productRuntimeSessions.update.bind(db.productRuntimeSessions)
    const spy = boundary === 'seat-finalization'
      ? vi.spyOn(db.ttrpgSessionParticipants, 'put').mockImplementation(async row => {
        if (++calls === 2) throw new Error('injected Session Zero fault')
        return originalPut(row)
      })
      : vi.spyOn(db.productRuntimeSessions, 'update').mockImplementation(async (id, changes) => {
        if (typeof changes === 'object' && 'runtimeHeadSequence' in changes) throw new Error('injected Session Zero fault')
        return originalUpdate(id, changes)
      })
    await expect(completeTtrpgOpenSessionZeroV1(input)).rejects.toThrow(/injected/)
    spy.mockRestore()
    expect(await eventCount(fixture.sessionId)).toBe(count)
    expect(await db.productRuntimeSessions.get(fixture.sessionId)).toEqual(before)
    expect(await readTtrpgSessionParticipantsV2(fixture.sessionId)).toEqual(seats)
    const event = await completeTtrpgOpenSessionZeroV1(input)
    expect(await completeTtrpgOpenSessionZeroV1(input)).toEqual(event)
    expect(await eventCount(fixture.sessionId)).toBe(count + 1)
  })

  it('rejects AI self-approval and missing companion bindings in the portable authority parser', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    const auth = (await readOpen(fixture.sessionId)).runtime.authorization!
    const selfApproval = structuredClone(auth)
    selfApproval.approvalBindings[0].approverSeatKeys = ['seat.companion.1']
    await expect(Promise.resolve().then(() => parseTtrpgOpenAuthorizationV1(selfApproval))).rejects.toThrow(/AI 自批/)
    const missing = structuredClone(auth)
    missing.approvalBindings.pop()
    expect(() => parseTtrpgOpenAuthorizationV1(missing)).toThrow(/恰有一项/)
    expect(() => parseTtrpgOpenAuthorizationV1({ ...auth, unexpected: true })).toThrow(/字段不精确/)
  })

  it('builds a valid hybrid claimed seat and allows only human-controlled approval relations', async () => {
    const fixture = await seedOpenTtrpgSessionV1()
    const campaign = openHybridCampaignFixture()
    const rows = buildInitialTtrpgParticipantsV2({ session: fixture.session, campaign }).map(seat => ({ ...seat,
      assignmentState: seat.controller === 'ai' ? 'assigned' as const : 'claimed' as const,
      consent: { ...seat.consent, aiIdentityDisclosed: true } }))
    const auth = createTtrpgOpenAuthorizationV1({ campaign, participants: rows,
      sessionKey: (await readOpen(fixture.sessionId)).runtime.sessionKey,
      selectedActorKeys: ['hero', 'companion.1', 'companion.2'], viewerKey: OPEN_HUMAN_VIEWER, sequence: 3 })
    expect(auth.seats.find(seat => seat.actorKey === 'companion.1')!.controller).toBe('hybrid')
    expect(auth.approvalBindings[1].approverSeatKeys).toEqual(['seat.companion.1'])
    const rowsWithoutClaim = rows.map(seat => seat.actorKey === 'companion.1' ? { ...seat, assignmentState: 'assigned' as const } : seat)
    expect(() => createTtrpgOpenAuthorizationV1({ campaign, participants: rowsWithoutClaim,
      sessionKey: auth.sourceRef.sessionKey,
      selectedActorKeys: auth.selectedActorKeys, viewerKey: OPEN_HUMAN_VIEWER, sequence: 3 })).toThrow(/claimed/)
  })

  it('rejects AI and unknown viewers from starting an epoch', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    const count = await eventCount(fixture.sessionId)
    const envelope = await openEnvelopeV1(fixture.sessionId, 'invalid.viewer')
    for (const viewerKey of ['viewer.gm', 'viewer.seat.companion.1', 'viewer.other']) {
      await expect(startTtrpgOpenEpochV1({ ...envelope, commandId: `bad.${viewerKey}`, viewerKey,
        triggerKind: 'submit-action', rawInput: '检查灯塔' })).rejects.toThrow(/真人主持授权/)
    }
    expect(await eventCount(fixture.sessionId)).toBe(count)
  })

  it('retains frozen budgets and authority across reload without advancing game time', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    const input = { ...await openEnvelopeV1(fixture.sessionId, 'epoch.one'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action' as const, rawInput: '检查灯塔门上的线索' }
    const event = await startTtrpgOpenEpochV1(input)
    const before = await readOpen(fixture.sessionId)
    const epoch = before.runtime.openRun!.coordination.epochs[0]
    expect(epoch.startedRef).toEqual({ sessionKey: before.runtime.sessionKey, sequence: event.sequence })
    expect(epoch.budget.maximumCalls).toBe(fixture.campaign.runtimePolicy.maximumCallsPerEpoch)
    expect(epoch.budget.maximumTokens).toBe(fixture.campaign.runtimePolicy.maximumEpochTokens)
    const inflatedBudget = structuredClone(before.runtime)
    inflatedBudget.openRun!.coordination.epochs[0].budget.maximumCalls++
    expect(() => parseTtrpgRuntimeStateV2(inflatedBudget)).toThrow(/冻结预算/)
    expect(before.runtime.openRun!.worldTime.worldTurn).toBe(0)
    expect(before.state.clock).toBe(0)
    const count = await eventCount(fixture.sessionId)
    db.close(); await db.open()
    expect(await readOpen(fixture.sessionId)).toEqual(before)
    expect(await eventCount(fixture.sessionId)).toBe(count)
    expect(await startTtrpgOpenEpochV1(input)).toEqual(event)
    expect(await eventCount(fixture.sessionId)).toBe(count)
    await expect(startTtrpgOpenEpochV1({ ...input, rawInput: '改成另一行动' })).rejects.toThrow(/commandId/)
  })

  it('prevents parallel and repeated command IDs from opening a second active window', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    const envelope = await openEnvelopeV1(fixture.sessionId, 'parallel.a')
    const input = { ...envelope, viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host' as const, rawInput: '继续主持' }
    const results = await Promise.allSettled([startTtrpgOpenEpochV1(input), startTtrpgOpenEpochV1({ ...input, commandId: 'parallel.b' })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((await readOpen(fixture.sessionId)).runtime.openRun!.coordination.epochs).toHaveLength(1)
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'second.window'),
      viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput: '继续' })).rejects.toThrow(/active epoch/)
  })

  it('persists cancellation and allows a new explicit authority window while retaining history', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    const start = await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'first.window'),
      viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '查看灯塔' })
    const epochKey = (await readOpen(fixture.sessionId)).runtime.openRun!.coordination.activeEpochKey!
    const closeInput = { ...await openEnvelopeV1(fixture.sessionId, 'close.window'), epochKey, viewerKey: OPEN_HUMAN_VIEWER, reason: '用户取消，未执行行动' }
    const closed = await closeTtrpgOpenEpochV1(closeInput)
    expect(await closeTtrpgOpenEpochV1(closeInput)).toEqual(closed)
    const runtime = (await readOpen(fixture.sessionId)).runtime
    expect(runtime.openRun!.coordination.activeEpochKey).toBeNull()
    expect(runtime.openRun!.coordination.epochs[0]).toMatchObject({ status: 'closed', startedRef: { sequence: start.sequence }, closedRef: { sequence: closed.sequence } })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'next.window'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'continue-host', rawInput: '重新明确授权继续' })
    expect((await readOpen(fixture.sessionId)).runtime.openRun!.coordination.epochs).toHaveLength(2)
    expect((await readOpen(fixture.sessionId)).state.clock).toBe(0)
  })

  it('rejects stale seat revisions and arbitrary world ticks without changing events or head', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    const seats = await readTtrpgSessionParticipantsV2(fixture.sessionId)
    const human = seats.find(seat => seat.actorKey === 'hero')!
    await db.ttrpgSessionParticipants.update(human.id!, { revision: human.revision + 1 })
    const input = { ...await openEnvelopeV1(fixture.sessionId, 'stale.window'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action' as const, rawInput: '检查门' }
    const count = await eventCount(fixture.sessionId)
    const version = await readProductRuntimeStateVersion(fixture.sessionId)
    await expect(startTtrpgOpenEpochV1(input)).rejects.toThrow(/stale/)
    await expect(advanceTtrpgWorldTurnV1({ ...input, commandId: 'free.tick', reason: 'game-action' })).rejects.toThrow(/operation/)
    expect(await eventCount(fixture.sessionId)).toBe(count)
    expect(await readProductRuntimeStateVersion(fixture.sessionId)).toEqual(version)
  })

  it('keeps separate identities for equal seeds and rejects cross-session source references', async () => {
    const left = await readyOpenTtrpgSessionV1('left'), right = await readyOpenTtrpgSessionV1('right')
    const leftRuntime = (await readOpen(left.sessionId)).runtime, rightRuntime = (await readOpen(right.sessionId)).runtime
    expect(left.session.seed).toBe(right.session.seed)
    expect(leftRuntime.sessionKey).not.toBe(rightRuntime.sessionKey)
    const crossAuthorization = structuredClone(rightRuntime)
    crossAuthorization.authorization = structuredClone(leftRuntime.authorization)
    expect(() => parseTtrpgRuntimeStateV2(crossAuthorization)).toThrow(/授权与 Session Zero/)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(left.sessionId, 'left.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '检查门' })
    const coordination = (await readOpen(left.sessionId)).runtime.openRun!.coordination
    expect(() => parseTtrpgOpenCoordinationV1(coordination, rightRuntime.sessionKey)).toThrow(/session/)
    const longSessionKey = 's'.repeat(200)
    const generated = await ttrpgOpenScopedKeyV1(longSessionKey, 'epoch', ['x'.repeat(200)])
    expect(generated).toMatch(/^epoch\.[a-f0-9]{64}$/)
    expect(await ttrpgOpenScopedKeyV1(longSessionKey, 'epoch', ['x'.repeat(200)])).toBe(generated)
  })

  it('requires human authority for safety changes and permits diagnostics and empty-epoch cancellation while paused', async () => {
    const fixture = await readyOpenTtrpgSessionV1()
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'pause.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '检查门' })
    const epochKey = (await readOpen(fixture.sessionId)).runtime.openRun!.coordination.activeEpochKey!
    const paused = await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'human.pause'),
      status: 'paused', reason: '玩家使用暂停工具', changedBy: 'seat.hero', viewerKey: OPEN_HUMAN_VIEWER })
    await expect(changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'ai.resume'),
      status: 'active', changedBy: 'gm', viewerKey: 'viewer.gm' })).rejects.toThrow(/真人主持授权/)
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'paused.new.epoch'),
      viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput: '继续' })).rejects.toThrow(/安全工具暂停/)
    const diagnostic = await recordTtrpgOpenFailureV1({ ...await openEnvelopeV1(fixture.sessionId, 'paused.diagnostic'),
      category: 'gate-failed', violatedRule: '暂停时仅记录失败证据', failureKey: 'failure.paused' })
    expect(diagnostic.sequence).toBe(paused.sequence + 1)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'paused.cancel'),
      epochKey, viewerKey: OPEN_HUMAN_VIEWER, reason: '撤销未执行的授权窗口' })
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'human.resume'),
      status: 'active', changedBy: 'seat.hero', viewerKey: OPEN_HUMAN_VIEWER })
    const { runtime, state } = await readOpen(fixture.sessionId)
    expect(runtime.product.safety.status).toBe('active')
    expect(runtime.openRun!.coordination.activeEpochKey).toBeNull()
    expect(runtime.openRun!.failures).toHaveLength(1)
    expect(state.clock).toBe(0)
  })
})
