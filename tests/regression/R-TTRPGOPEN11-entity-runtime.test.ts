import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityPlanningV1 } from '../helpers/open-entity-runtime'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { proposeTtrpgOpenEntitiesV1, confirmTtrpgOpenEntityOperationV1 as confirmEntityCommand, materializeTtrpgOpenEntityV1 as materializeEntityCommand,
  disposeTtrpgOpenEntityOperationV1 as disposeEntityCommand, consultTtrpgOracleV1, closeTtrpgOpenEpochV1, changeTtrpgSafetyStatus, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { verifyTtrpgOpenEntityPlanHashesV1 } from '../../src/lib/ttrpg/open-entity-proof'
import { ttrpgOpenEntityIdentityCatalogV1 } from '../../src/lib/ttrpg/open-entity-catalog'
import { initialCharacterAttributes } from '../../src/lib/ttrpg/character-mechanical-initialization'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { readTtrpgOpenManualActionCatalogV1 } from '../../src/lib/ttrpg/open-table-service'
import { validateTtrpgOpenEffectBindingsV1 } from '../../src/lib/ttrpg/open-effect-binding'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { startTtrpgOpenOperationV1, confirmTtrpgOpenOperationV1, ttrpgOpenOperationCommandIdV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenOperationV1 } from '../../src/lib/ttrpg/open-operation-coordinator'
import { verifyTtrpgOpenEntityStateV1 } from '../../src/lib/ttrpg/open-entity-proof'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { readTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { generateTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { delegateTtrpgOpenHostingV1, stopTtrpgOpenHostingV1 } from '../../src/lib/ttrpg/runtime-commands'
import { replayProductRuntimeEvents, parseProductRuntimeState } from '../../src/lib/product/runtime-core'

async function confirmTtrpgOpenEntityOperationV1(input: Parameters<typeof confirmEntityCommand>[0]) {
  const state = await readProductRuntimeState(input.sessionId)
  return confirmEntityCommand({ ...input, commandId: await ttrpgOpenOperationCommandIdV1(state.ttrpg!.sessionKey, input.operationKey, 'entity.approval.' + input.actorKey) })
}
async function materializeTtrpgOpenEntityV1(input: Parameters<typeof materializeEntityCommand>[0]) {
  const state = await readProductRuntimeState(input.sessionId)
  return materializeEntityCommand({ ...input, commandId: await ttrpgOpenOperationCommandIdV1(state.ttrpg!.sessionKey, input.operationKey, 'entity.materialize') })
}
async function disposeTtrpgOpenEntityOperationV1(input: Parameters<typeof disposeEntityCommand>[0]) {
  const state = await readProductRuntimeState(input.sessionId)
  return disposeEntityCommand({ ...input, commandId: await ttrpgOpenOperationCommandIdV1(state.ttrpg!.sessionKey, input.operationKey, 'entity.dispose') })
}

async function setup(configure?: Parameters<typeof setupOpenEntityPlanningV1>[0]) {
  const s = await setupOpenEntityPlanningV1(configure)
  const event = await proposeTtrpgOpenEntitiesV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.propose'), viewerKey: OPEN_HUMAN_VIEWER,
    oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals })
  const plan = JSON.parse(event.payloadJson).plan as Awaited<ReturnType<typeof import('../../src/lib/ttrpg/open-entity-plan')['createTtrpgOpenEntityPlanV1']>>
  return { ...s, event, plan, command: { sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, operationKey: plan.operationKey, planHash: plan.planHash } }
}
async function approve(s: Awaited<ReturnType<typeof setup>>) {
  for (const row of s.plan.requiredApprovals) await confirmTtrpgOpenEntityOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.confirm.' + row.actorKey),
    ...s.command, actorKey: row.actorKey, decision: 'approve' })
}
describe('R-TTRPGOPEN11 actual F13 transaction, permission journal and recovery', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('creates the three actual kinds only after all confirmations, once, with frozen NPC mechanics and unchanged world/release/time', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), worlds = await db.worldReleases.toArray(), releases = await db.productReleases.toArray()
    expect(s.plan.items.every(i => !before.entities[i.entityKey])).toBe(true)
    await expect(materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.early'), ...s.command })).rejects.toThrow(/确认/)
    await expect(consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.parallel'), viewerKey: OPEN_HUMAN_VIEWER, askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '不能并行咨询' })).rejects.toThrow(/实体计划/)
    await expect(closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.premature.close'), viewerKey: OPEN_HUMAN_VIEWER, epochKey: before.ttrpg!.openRun!.coordination.activeEpochKey!, reason: '尚未处置' })).rejects.toThrow(/实体计划/)
    await approve(s)
    const input = { ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.materialize'), ...s.command }, event = await materializeTtrpgOpenEntityV1(input)
    expect((await materializeTtrpgOpenEntityV1(input)).id).toBe(event.id)
    const after = await readProductRuntimeState(s.f.sessionId), [npc, location, item] = s.plan.items
    const frozenNpc = s.input.content.campaign.characterTemplates.find(row => row.characterKey === 'keeper')!
    expect(after.entities[npc.entityKey]).toMatchObject({ kind: 'npc', locationKey: 'harbor', name: npc.proposal.name,
      attributes: initialCharacterAttributes(frozenNpc, s.input.content.rulePack.content) })
    expect(after.entities[location.entityKey]).toMatchObject({ kind: 'location', locationKey: null })
    expect(after.ttrpg!.product.inventory.items[item.entityKey]).toMatchObject({ ownerRef: 'companion.1', definitionRef: s.input.content.rulePack.content.items[0].key, quantity: 1 })
    expect(Object.values(after.ttrpg!.product.abilityStates).some(row => row.actorInstanceId === npc.entityKey)).toBe(true)
    expect(after.ttrpg!.openRun!.entityOperations![0].resolution).toEqual({ kind: 'materialized', sourceRef: { sessionKey: after.ttrpg!.sessionKey, sequence: event.sequence } })
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime); expect(after.ttrpg!.openRun!.knowledge).toEqual([])
    expect(after.ttrpg!.product.usagePools).toEqual(before.ttrpg!.product.usagePools)
    expect(await db.worldReleases.toArray()).toEqual(worlds); expect(await db.productReleases.toArray()).toEqual(releases); expect(await db.agentRuns.count()).toBe(0)
    await verifyTtrpgOpenEntityPlanHashesV1(after.ttrpg!.openRun!.entityOperations!)
    expect(ttrpgOpenEntityIdentityCatalogV1(s.input.content, after.ttrpg!.openRun!.entityOperations!).filter(row => row.dynamic)).toHaveLength(3)
    expect((await materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.no.repeat'), ...s.command })).id).toBe(event.id)
  })
  it('rolls back failed F13 persistence completely and resumes the same confirmed plan', async () => {
    const s = await setup(); await approve(s)
    const before = await readProductRuntimeState(s.f.sessionId), count = await db.productRuntimeEvents.count(), input = { ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.storage.cut'), ...s.command }
    const spy = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('F13 storage cut'))
    await expect(materializeTtrpgOpenEntityV1(input)).rejects.toThrow('F13 storage cut'); spy.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count)
    await materializeTtrpgOpenEntityV1(input)
    expect(await db.productRuntimeEvents.count()).toBe(count + 1)
  })
  it('blocks another model preparation before creating a Run, artifact or reservation while the original entity plan is pending', async () => {
    const s = await setup(pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true }), before = await readProductRuntimeState(s.f.sessionId)
    const runs = await db.agentRuns.count(), artifacts = await db.agentRunArtifacts.count(), runAI = vi.fn(async () => '{}')
    await expect(generateTtrpgOpenIntentCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.no.orphan.model'), scope: s.f.scope,
      viewerKey: OPEN_HUMAN_VIEWER, actorKey: 'hero', rawInput: '明确咨询并审查可实例化对象', maximumOutputTokens: 1000, maximumCostUsd: 0.1, runAI })).rejects.toThrow(/实体计划/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    expect(await db.agentRuns.count()).toBe(runs); expect(await db.agentRunArtifacts.count()).toBe(artifacts); expect(runAI).not.toHaveBeenCalled()
  })
  it('requires explicit stopping of an active hosting delegation before proposing an entity in that window', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true })
    const epochKey = s.input.state.ttrpg!.openRun!.coordination.activeEpochKey!
    await delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.original.hosting'), viewerKey: OPEN_HUMAN_VIEWER,
      epochKey, maximumCostUsdPerCall: 0.1, decision: 'delegate-this-epoch' })
    const proposal = { viewerKey: OPEN_HUMAN_VIEWER, oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[0]] }
    await expect(proposeTtrpgOpenEntitiesV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.no.active.hosting'), ...proposal })).rejects.toThrow(/空闲/)
    expect((await readTtrpgOpenEntityDeskV1({ scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }))?.canPropose).toBe(false)
    await stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.stop.original.hosting'), viewerKey: OPEN_HUMAN_VIEWER,
      epochKey, reason: '真人明确停止自动主持后，改为审阅创建提案' })
    await proposeTtrpgOpenEntitiesV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.after.explicit.stop'), ...proposal })
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('does not let a host confirm another human inventory, preserves rejection, and permits explicit disposal while paused', async () => {
    const s = await setup(pkg => { pkg.ttrpg!.campaign.characterTemplates.find(row => row.characterKey === 'companion.1')!.controller = 'hybrid' })
    await expect(confirmTtrpgOpenEntityOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.impersonation'), ...s.command, actorKey: 'companion.1', decision: 'approve' })).rejects.toThrow(/不能替/)
    await confirmTtrpgOpenEntityOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.owner.reject'), ...s.command, viewerKey: 'viewer.seat.companion.1', actorKey: 'companion.1', decision: 'reject' })
    await expect(materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.rejected'), ...s.command })).rejects.toThrow(/确认/)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.pause'), viewerKey: OPEN_HUMAN_VIEWER, changedBy: 'hero', status: 'paused', reason: '暂停并放弃候选' })
    await disposeTtrpgOpenEntityOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.dispose'), ...s.command, reason: '受影响者明确拒绝' })
    const state = await readProductRuntimeState(s.f.sessionId)
    expect(state.ttrpg!.openRun!.entityOperations![0].resolution?.kind).toBe('declined'); expect(s.plan.items.every(item => !state.entities[item.entityKey])).toBe(true)
    await expect(materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.disposed'), ...s.command })).rejects.toThrow()
  })
  it('inherits only committed entities at branch cutpoints, retaining identity after parent deletion and full import', async () => {
    const s = await setup(); await approve(s)
    const pending = await readProductRuntimeState(s.f.sessionId)
    const before = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: pending.lastSequence, title: 'Before actual F13' })
    expect((await readProductRuntimeState(before.id!)).ttrpg!.openRun!.entityOperations).toEqual([])
    const event = await materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'actual.entity.branch.commit'), ...s.command })
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: event.sequence, title: 'After actual F13' })
    const inherited = await readProductRuntimeState(child.id!)
    expect(inherited.ttrpg!.openRun!.entityOperations![0].resolution?.kind).toBe('materialized')
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'actual.entity.child.zero'), viewerKey: OPEN_HUMAN_VIEWER, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: inherited.ttrpg!.product.sessionZero.requiredItemKeys })
    await deleteProductRuntimeSession(s.f.sessionId)
    const original = await readProductRuntimeState(child.id!)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
    const after = await readProductRuntimeState(restored.id!)
    expect(after.entities).toEqual(original.entities); expect(after.ttrpg!.openRun!.entityOperations).toEqual(original.ttrpg!.openRun!.entityOperations)
    const desk = await readTtrpgOpenEntityDeskV1({ scope: { projectId, worldId: restored.worldId!, workId: restored.workId! }, sessionId: restored.id!, viewerKey: OPEN_HUMAN_VIEWER })
    expect(desk?.entities).toHaveLength(3); expect(desk?.pending).toBeNull()
  })
  it('counts NPC intrinsic equipment, creates fresh legal stock once, and preserves the original NPC inventory owner', async () => {
    const s = await setupOpenEntityPlanningV1(pkg => {
      const c = pkg.ttrpg!.campaign, npc = c.characterTemplates.find(row => row.characterKey === 'keeper')!, definition = pkg.ttrpg!.rulePack.content.items[0]
      npc.itemKeys = [definition.key]; npc.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: npc, rulePack: pkg.ttrpg!.rulePack.content })
      c.entityBindings.find(row => row.bindingKey === 'keeper')!.initialInventoryRefs = ['keeper.initial.gear']
      c.entityBindings.push({ bindingKey: 'keeper.initial.gear', templateKey: definition.key, kind: 'item', initialLocationRef: null, initialInventoryRefs: [], sourceResourceRef: null, sourceFieldRefs: [], audience: 'party', knownByActorKeys: [] })
    })
    await expect(proposeTtrpgOpenEntitiesV1({ ...await openEnvelopeV1(s.f.sessionId, 'gear.too.many'), viewerKey: OPEN_HUMAN_VIEWER, oracleSourceRef: s.input.oracleSourceRef, proposals: s.proposals })).rejects.toThrow(/数量|上限/)
    const event = await proposeTtrpgOpenEntitiesV1({ ...await openEnvelopeV1(s.f.sessionId, 'gear.npc.only'), viewerKey: OPEN_HUMAN_VIEWER, oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[0]] })
    const plan = JSON.parse(event.payloadJson).plan as Awaited<ReturnType<typeof import('../../src/lib/ttrpg/open-entity-plan')['createTtrpgOpenEntityPlanV1']>>
    const command = { sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, operationKey: plan.operationKey, planHash: plan.planHash }
    await confirmTtrpgOpenEntityOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'gear.npc.confirm'), ...command, actorKey: 'hero', decision: 'approve' })
    await materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'gear.npc.commit'), ...command })
    const state = await readProductRuntimeState(s.f.sessionId), npcKey = plan.items[0].entityKey, gearKey = npcKey + '.equipment.0'
    expect(state.entities[gearKey].kind).toBe('item'); expect(state.ttrpg!.product.inventory.items[gearKey]).toMatchObject({ ownerRef: npcKey, quantity: 1 })
    expect(state.ttrpg!.product.inventory.items['keeper.initial.gear'].ownerRef).toBe('keeper')
    const desk = await readTtrpgOpenEntityDeskV1({ scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER })
    expect(desk?.entities.some(e => e.key === npcKey)).toBe(true)
    expect(desk?.entities.some(e => e.key === gearKey)).toBe(false)
    await expect(proposeTtrpgOpenEntitiesV1({ ...await openEnvelopeV1(s.f.sessionId, 'gear.quota.not.reset'), viewerKey: OPEN_HUMAN_VIEWER, oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[1], s.proposals[2]] })).rejects.toThrow(/上限/)
  })
  it('exposes an authorized created NPC as an actual nearby target and settles a real frozen rule against that instance', async () => {
    const s = await setup(pkg => {
      pkg.ttrpg!.campaign.characterTemplates.find(row => row.characterKey === 'keeper')!.gmProfile!.secret = 'F13-PRIVATE-ORIGINAL-NPC'
      // A real frozen no-roll rule makes the materialized target's actual resource owner observable.
      pkg.ttrpg!.rulePack.content.actions.find(row => row.key === 'strike')!.effects = [
        { kind: 'resource', resourceKey: 'vigor', delta: -1, targetScope: 'action-target' },
      ]
    }); await approve(s)
    await materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'target.entity.commit'), ...s.command })
    const key = s.plan.items[0].entityKey, input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, actorKey: 'hero' }
    const visible = await loadTtrpgOpenPlayerContextV1(input)
    expect(visible.view.actorsHere).toContainEqual(expect.objectContaining({ actorKey: key, name: s.plan.items[0].proposal.name }))
    expect(JSON.stringify(visible.view)).not.toContain('F13-PRIVATE-ORIGINAL-NPC')
    expect(JSON.stringify(await readTtrpgOpenManualActionCatalogV1(input))).toContain(key)
    const beforeHp = (await readProductRuntimeState(s.f.sessionId)).entities[key].attributes.hp
    const action = s.input.content.rulePack.content.actions.find(row => row.key === 'strike')!
    await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(s.f.sessionId, 'target.new.npc.action'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { actorKey: 'hero', controllerMode: 'human', route: 'existing-action', ruleKey: action.key, targetKey: key, effectBindings: {} } })
    const op = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.operations[0]
    for (const row of op.plan.requiredApprovals) await confirmTtrpgOpenOperationV1({ ...await openEnvelopeV1(s.f.sessionId, await ttrpgOpenOperationCommandIdV1(op.startedRef.sessionKey, op.operationKey, 'approval.' + row.actorKey)), viewerKey: OPEN_HUMAN_VIEWER,
      operationKey: op.operationKey, frozenPlanHash: op.planHash, actorKey: row.actorKey, riskHash: op.riskHash, decision: 'approve' })
    await resumeTtrpgOpenOperationV1({ sessionId: s.f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, operationKey: op.operationKey, frozenPlanHash: op.planHash })
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.operations[0].plan.request.targetKey).toBe(key)
    expect(after.ttrpg!.openRun!.ruleReceipts[0].result.resourceChanges).toContainEqual(expect.objectContaining({ entityKey: key, resourceKey: 'vigor', delta: -1 }))
    expect(after.entities[key].attributes.hp).toBe(Number(beforeHp) - 1)
    expect(after.ttrpg!.openRun!.operations[0].businessRefs.some(row => row.stepKey === 'mechanics')).toBe(true)
  })
  it('resolves dynamic effect permission from actual F13 provenance and rejects a mutable template attribute impostor', async () => {
    const s = await setup(); await approve(s); await materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'binding.entity.commit'), ...s.command })
    const state = await readProductRuntimeState(s.f.sessionId), key = s.plan.items[0].entityKey, authorization = parseTtrpgRuntimeStateV2(state.ttrpg)!.authorization!
    const template = structuredClone(s.input.content.campaign.effectPlanTemplates[0]); template.parameters = [{ parameterKey: 'npc', entityKinds: ['actor'], allowedRefs: [], allowDynamicFromTemplateKeys: ['dynamic.npc'], required: true }]
    template.effects = [{ effectKey: 'npc.damage', family: 'numeric', operation: 'resource.spend', targetRef: 'parameter:npc', valueKey: s.input.content.rulePack.content.resources[0].key, amount: 1 }]
    expect(validateTtrpgOpenEffectBindingsV1({ state, authorization, templates: [template], bindings: { [template.planKey]: { npc: key } }, readableBinding: () => true })).toEqual([])
    const forged = structuredClone(state); forged.entities.keeper.attributes.templateKey = 'dynamic.npc'
    expect(() => validateTtrpgOpenEffectBindingsV1({ state: forged, authorization, templates: [template], bindings: { [template.planKey]: { npc: 'keeper' } }, readableBinding: () => true })).toThrow(/允许范围/)
  })
  it('rejects a rehashed frozen-definition substitution and missing owner without changing live data', async () => {
    const s = await setup(); await approve(s); await materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'proof.entity.commit'), ...s.command })
    const good = await readProductRuntimeState(s.f.sessionId), changed = structuredClone(good), operation = changed.ttrpg!.openRun!.entityOperations![0]
    const snapshot = JSON.parse(operation.plan.frozenContentJson); snapshot.campaign.characterTemplates.find((row: { characterKey: string }) => row.characterKey === 'keeper').attributes.body = 999
    operation.plan.frozenContentJson = JSON.stringify(snapshot)
    const { planHash: _old, ...body } = operation.plan; operation.plan.planHash = await hashProductProductionValueV2(body)
    await expect(verifyTtrpgOpenEntityStateV1(changed, s.input.content)).rejects.toThrow(/实际来源/)
    const missing = structuredClone(good); Reflect.deleteProperty(missing.entities, s.plan.items[0].entityKey)
    await expect(verifyTtrpgOpenEntityStateV1(missing, s.input.content)).rejects.toThrow(/owner|身份/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(good)
  })
  it('rejects a self-rehashed replay plan that removes an affected inventory approval', async () => {
    const s = await setup(), events = await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).sortBy('sequence')
    const event = events.find(row => row.id === s.event.id)!, payload = JSON.parse(event.payloadJson)
    payload.plan.requiredApprovals = payload.plan.requiredApprovals.filter((row: { actorKey: string }) => row.actorKey === 'hero')
    const { planHash: _old, ...body } = payload.plan; payload.plan.planHash = await hashProductProductionValueV2(body); event.payloadJson = JSON.stringify(payload)
    const session = await db.productRuntimeSessions.get(s.f.sessionId)
    expect(() => replayProductRuntimeEvents(parseProductRuntimeState(session!.initialStateJson), events)).toThrow(/批准权限/)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.entityOperations![0].plan.requiredApprovals).toHaveLength(2)
  })
  it('uses one original kernel step under competing creation/disposal, with no duplicate entities or quota reset', async () => {
    const s = await setup(); await approve(s)
    const before = await db.productRuntimeEvents.count(), envelope = await openEnvelopeV1(s.f.sessionId, 'competing.entity')
    await expect(materializeEntityCommand({ ...envelope, ...s.command })).rejects.toThrow(/内核/)
    await Promise.allSettled([
      materializeTtrpgOpenEntityV1({ ...envelope, ...s.command }),
      disposeTtrpgOpenEntityOperationV1({ ...envelope, ...s.command, reason: '真人同时提出结束计划' }),
    ])
    const after = await readProductRuntimeState(s.f.sessionId), operation = after.ttrpg!.openRun!.entityOperations![0]
    expect(operation.resolution).not.toBeNull(); expect(await db.productRuntimeEvents.count()).toBe(before + 1)
    expect(s.plan.items.filter(row => after.entities[row.entityKey])).toHaveLength(operation.resolution!.kind === 'materialized' ? 3 : 0)
  })
  it('does not extend an inherited party instance to a later human seat', async () => {
    const s = await setup(pkg => {
      const c = pkg.ttrpg!.campaign, late = structuredClone(c.characterTemplates.find(row => row.characterKey === 'hero')!)
      late.characterKey = 'late'; late.seatKey = 'seat.late'; late.name = '后加入者'; late.characterSheet = createCompleteTtrpgCharacterSheetV2({ template: late, rulePack: pkg.ttrpg!.rulePack.content })
      c.playerCount.maximum = 4; c.characterTemplates.push(late)
      c.entityBindings.push({ ...structuredClone(c.entityBindings.find(row => row.bindingKey === 'hero')!), bindingKey: 'late', templateKey: 'late' })
    }); await approve(s)
    const event = await materializeTtrpgOpenEntityV1({ ...await openEnvelopeV1(s.f.sessionId, 'private.party.entity.commit'), ...s.command })
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: event.sequence, title: 'New entity observer' }), state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'new.entity.observer.zero'), viewerKey: OPEN_HUMAN_VIEWER, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2', 'late'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
    const input = { scope: s.f.scope, sessionId: child.id!, viewerKey: 'viewer.seat.late', actorKey: 'late' }
    expect((await loadTtrpgOpenPlayerContextV1(input)).view.actorsHere.some(row => row.actorKey === s.plan.items[0].entityKey)).toBe(false)
    expect(JSON.stringify(await readTtrpgOpenManualActionCatalogV1(input))).not.toContain(s.plan.items[0].entityKey)
  })
})
