import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { preparedOpenTtrpgCallV1 } from '../helpers/open-ttrpg-call'
import { branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, deleteProductRuntimeSession,
  createPreviewProductRuntimeSession, replayProductRuntimeEvents, parseProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { verifyTtrpgOpenBranchLineageV1 } from '../../src/lib/ttrpg/open-branch-contract'
import { prepareTtrpgOpenBranchStateV1 } from '../../src/lib/ttrpg/open-branch'
import { startTtrpgOpenEpochV1, startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, completeTtrpgOpenSessionZeroV1,
  dispatchTtrpgOpenModelCallV1, finishTtrpgOpenModelCallV1, ttrpgOpenOperationCommandIdV1, inheritTtrpgOpenSourceV1,
  customizeTtrpgPlayerCharacterV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN1 frozen branch evidence and local authority renewal', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  const fork = async (sessionId: number, throughSequence?: number) => branchProductRuntimeSession({ parentSessionId: sessionId,
    throughSequence: throughSequence ?? (await readProductRuntimeStateVersion(sessionId)).sequence, title: '子分支', seed: 'child.seed' })
  const runtime = (state: Awaited<ReturnType<typeof readProductRuntimeState>>) => parseTtrpgRuntimeStateV2(state.ttrpg)!
  async function confirmChild(sessionId: number) {
    const state = await readProductRuntimeState(sessionId)
    return completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(sessionId, 'child.zero'), viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: runtime(state).product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
  }
  it('freezes an exact cutpoint, keeps the parent intact and requires new child authority before a new epoch', async () => {
    const fixture = await readyOpenTtrpgSessionV1('branch source')
    const parentBefore = await readProductRuntimeState(fixture.sessionId)
    const parentRows = await db.ttrpgSessionParticipants.where('sessionId').equals(fixture.sessionId).toArray()
    const child = await fork(fixture.sessionId)
    const state = await readProductRuntimeState(child.id!), run = runtime(state)
    expect(run.sessionKey).not.toBe(runtime(parentBefore).sessionKey)
    expect(run.authorization).toBeNull()
    expect(run.openRun!.coordination).toEqual({ activeEpochKey: null, epochs: [], calls: [] })
    expect(run.branchLineage!.ancestors[0].throughSequence).toBe(parentBefore.lastSequence)
    await verifyTtrpgOpenBranchLineageV1(run.branchLineage!, run.sessionKey)
    expect(state.entities).toEqual(parentBefore.entities)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(parentBefore)
    expect(await db.ttrpgSessionParticipants.where('sessionId').equals(fixture.sessionId).toArray()).toEqual(parentRows)
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'no.renewal'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '继续' })).rejects.toThrow(/已授权/)
    await confirmChild(child.id!)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'child.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '继续' })
    const authorized = runtime(await readProductRuntimeState(child.id!))
    expect(authorized.authorization!.sourceRef.sessionKey).toBe(authorized.sessionKey)
    expect(authorized.openRun!.coordination.epochs).toHaveLength(1)
  })
  it('preserves committed effects/time and plans only the remaining deterministic steps', async () => {
    const fixture = await readyOpenTtrpgSessionV1('partial business branch')
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '行动' })
    const action = fixture.runtimePackage.ttrpg!.rulePack.content.actions[0]
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId, 'plan'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', ruleKey: action.key, actorKey: 'hero', targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper',
        controllerMode: 'human', effectBindings: {} } })
    const planned = runtime(await readProductRuntimeState(fixture.sessionId)), op = planned.openRun!.operations[0]
    for (const approval of op.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({ ...await openEnvelopeV1(fixture.sessionId,
      await ttrpgOpenOperationCommandIdV1(planned.sessionKey, op.operationKey, `approval.${approval.actorKey}`)),
      operationKey: op.operationKey, frozenPlanHash: op.planHash, riskHash: op.riskHash, actorKey: approval.actorKey,
      viewerKey: OPEN_HUMAN_VIEWER, decision: 'approve' })
    await resumeTtrpgOpenOperationV1({ sessionId: fixture.sessionId, operationKey: op.operationKey, frozenPlanHash: op.planHash, viewerKey: OPEN_HUMAN_VIEWER })
    const before = await readProductRuntimeState(fixture.sessionId), parentRun = runtime(before)
    const child = await fork(fixture.sessionId), childState = await readProductRuntimeState(child.id!), childRun = runtime(childState)
    expect(childState.entities).toEqual(before.entities)
    expect(childRun.product.abilityStates).toEqual(parentRun.product.abilityStates)
    expect(childRun.openRun!.worldTime.worldTurn).toBe(parentRun.openRun!.worldTime.worldTurn)
    expect(childRun.openRun!.worldTime.lastAdvancedByEventSequence).toBe(-1)
    expect(childRun.branchLineage!.recoveryTasks).toHaveLength(1)
    const task = childRun.branchLineage!.recoveryTasks[0]
    expect(task.remainingStepKeys[0]).toBe('pressure')
    expect(task.status).toBe('awaiting-authorization')
    expect(task.operation).toEqual(parentRun.openRun!.operations[0])
    expect(childRun.openRun!.ruleReceipts).toEqual([])
    expect(childRun.branchLineage!.ancestors[0].snapshot.openRun!.ruleReceipts).toEqual(parentRun.openRun!.ruleReceipts)
    await expect(customizeTtrpgPlayerCharacterV1({ ...await openEnvelopeV1(child.id!, 'overwrite.initial'), characterKey: 'hero',
      name: childState.entities.hero.name, description: '改写开局', attributes: Object.fromEntries(fixture.runtimePackage.ttrpg!.rulePack.content.attributes
        .map(attribute => [attribute.key, Number(childState.entities.hero.attributes[attribute.key])])) })).rejects.toThrow(/保留原机械状态/)
    await expect(inheritTtrpgOpenSourceV1({ ...await openEnvelopeV1(child.id!, 'inherit.before.auth'), taskKey: task.taskKey,
      viewerKey: OPEN_HUMAN_VIEWER })).rejects.toThrow(/授权窗口/)
    await confirmChild(child.id!)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!, 'recovery.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'continue-host', rawInput: '恢复父分支已经裁定的结果' })
    const inherited = await inheritTtrpgOpenSourceV1({ ...await openEnvelopeV1(child.id!, 'inherit'), taskKey: task.taskKey, viewerKey: OPEN_HUMAN_VIEWER })
    const retried = await inheritTtrpgOpenSourceV1({ ...await openEnvelopeV1(child.id!, 'inherit.retry'), taskKey: task.taskKey, viewerKey: OPEN_HUMAN_VIEWER })
    expect(retried.id).toBe(inherited.id)
    const after = runtime(await readProductRuntimeState(child.id!)), receipt = after.branchLineage!.recoveryTasks[0]
    expect(receipt.status).toBe('ready')
    expect(receipt.inheritedRef).toEqual({ sessionKey: after.sessionKey, sequence: inherited.sequence })
    expect(inherited.type).toBe('ttrpg.open.source.inherited')
    expect(after.product.abilityStates).toEqual(parentRun.product.abilityStates)
    expect(after.openRun!.worldTime.worldTurn).toBe(parentRun.openRun!.worldTime.worldTurn)
    await expect(startTtrpgOpenOperationV1({ ...await openEnvelopeV1(child.id!, 'bypass.recovery'), viewerKey: OPEN_HUMAN_VIEWER,
      request: op.plan.request })).rejects.toThrow(/先恢复继承结算/)
  })
  it('keeps a parent unknown call receipt without creating or resending a child request', async () => {
    const call = await preparedOpenTtrpgCallV1()
    const reserved = await call.reserve(), requestKey = JSON.parse(reserved.payloadJson).call.requestKey
    await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(call.fixture.sessionId, 'dispatch'), viewerKey: OPEN_HUMAN_VIEWER, requestKey, runId: call.snapshot().run.id })
    await finishTtrpgOpenModelCallV1({ ...await openEnvelopeV1(call.fixture.sessionId, 'unknown'), viewerKey: OPEN_HUMAN_VIEWER, requestKey, runId: call.snapshot().run.id,
      status: 'unknown', responseArtifactHash: null, usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'interrupted-after-dispatch' })
    const child = await fork(call.fixture.sessionId), run = runtime(await readProductRuntimeState(child.id!))
    expect(run.openRun!.coordination.calls).toEqual([])
    expect(run.branchLineage!.ancestors[0].snapshot.openRun!.coordination.calls[0]).toMatchObject({ status: 'unknown', responseArtifactHash: null })
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(child.id!).count()).toBe(0)
    expect(await db.productRuntimeEvents.where('sessionId').equals(child.id!).count()).toBe(0)
  })
  it('rolls back child session and side tables if participant cloning fails', async () => {
    const fixture = await readyOpenTtrpgSessionV1('atomic branch')
    const before = await db.productRuntimeSessions.count()
    vi.spyOn(db.ttrpgSessionParticipants, 'bulkAdd').mockRejectedValueOnce(new Error('injected clone failure'))
    await expect(fork(fixture.sessionId)).rejects.toThrow(/clone failure/)
    expect(await db.productRuntimeSessions.count()).toBe(before)
    expect((await db.ttrpgSessionParticipants.toArray()).every(row => row.sessionId === fixture.sessionId)).toBe(true)
  })
  it('retains self-contained frozen source evidence after deleting its physical parent', async () => {
    const fixture = await readyOpenTtrpgSessionV1('parent delete')
    const child = await fork(fixture.sessionId), before = await readProductRuntimeState(child.id!)
    await deleteProductRuntimeSession(fixture.sessionId)
    const row = await db.productRuntimeSessions.get(child.id!)
    expect(row!.parentSessionId).toBeNull()
    expect(await readProductRuntimeState(child.id!)).toEqual(before)
    const run = runtime(before)
    await verifyTtrpgOpenBranchLineageV1(run.branchLineage!, run.sessionKey)
    await confirmChild(child.id!)
  })
  it('rejects a modified prepared state and a forged ancestor hash', async () => {
    const fixture = await readyOpenTtrpgSessionV1('branch tamper')
    const parent = (await db.productRuntimeSessions.get(fixture.sessionId))!
    const state = await readProductRuntimeState(fixture.sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).sortBy('sequence')
    const prepared = await prepareTtrpgOpenBranchStateV1({ parent, state, events, throughSequence: state.lastSequence, childSessionKey: 'child.test' })
    prepared.entities.hero.attributes.hp = 999
    const build = (await db.productBuilds.get(parent.productBuildId!))!
    await expect(createPreviewProductRuntimeSession({ projectId: parent.projectId, worldId: parent.worldId, workId: parent.workId,
      productBuildId: parent.productBuildId!, expectedPreviewHash: build.previewHash!, runtimeSourceHash: parent.runtimeSourceHash!,
      kind: 'ttrpg', title: 'forged child', seed: 'seed', initialState: prepared, origin: 'branch' })).rejects.toThrow(/未改写/)
    const lineage = runtime(prepared).branchLineage!
    lineage.ancestors[0].events[0].payloadHash = 'f'.repeat(64)
    await expect(verifyTtrpgOpenBranchLineageV1(lineage, 'child.test')).rejects.toThrow(/hash/)
    expect(await db.productRuntimeSessions.count()).toBe(1)
  })
  it('supports a cutpoint before Session Zero without copying future authority or events', async () => {
    const fixture = await readyOpenTtrpgSessionV1('pre-zero branch')
    const child = await fork(fixture.sessionId, 0), state = await readProductRuntimeState(child.id!), run = runtime(state)
    expect(run.branchLineage!.ancestors[0].events).toEqual([])
    expect(run.branchLineage!.ancestors[0].snapshot.authorization).toBeNull()
    expect(run.authorization).toBeNull()
    expect(run.openRun).toBeNull()
    expect(replayProductRuntimeEvents(parseProductRuntimeState(child.initialStateJson), [])).toEqual(state)
  })
  it('roundtrips child lineage and consent renewal while remapping only physical workspace locators', async () => {
    const fixture = await readyOpenTtrpgSessionV1('lineage backup')
    const child = await fork(fixture.sessionId)
    const before = runtime(await readProductRuntimeState(child.id!))
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const copies = await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()
    const copy = copies.find(row => runtime(parseProductRuntimeState(row.initialStateJson)).sessionKey === before.sessionKey)!
    expect(copy.id).not.toBe(child.id)
    expect(copy.worldId).not.toBe(child.worldId)
    const restored = runtime(await readProductRuntimeState(copy.id!))
    expect(restored.branchLineage).toEqual(before.branchLineage)
    await verifyTtrpgOpenBranchLineageV1(restored.branchLineage!, restored.sessionKey)
    await confirmChild(copy.id!)
    expect(runtime(await readProductRuntimeState(copy.id!)).authorization!.sourceRef.sessionKey).toBe(before.sessionKey)
    expect(runtime(await readProductRuntimeState(child.id!)).authorization).toBeNull()
  })
})
