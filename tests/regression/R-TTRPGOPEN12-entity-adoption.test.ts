import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityModelV1 } from '../helpers/open-entity-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenEntityInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenEntityRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { acceptTtrpgOpenEntityCandidateV1, confirmTtrpgOpenEntityOperationV1, materializeTtrpgOpenEntityV1,
  ttrpgOpenOperationCommandIdV1, changeTtrpgSafetyStatus, disposeTtrpgOpenEntityOperationV1, closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { parseTtrpgOpenEntityPlanV1, parseTtrpgOpenEntityPlanV2 } from '../../src/lib/ttrpg/open-entity-contract'
import { reconcileTtrpgOpenEntityRunV1 } from '../../src/lib/ttrpg/open-entity-adoption'
import { finishTtrpgOpenEntityDraftV1 } from '../../src/lib/ttrpg/open-entity-stop'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { readTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { inspectAgentRunArtifactAvailabilityV1, markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'
import { verifyTtrpgOpenEntityStateV1, verifyTtrpgOpenEntityPlanHashesV1 } from '../../src/lib/ttrpg/open-entity-proof'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

async function candidate(audience: 'party' | 'private' | 'gm-only' = 'party', sharedTemplate = false, empty = false) {
  const s = await setupOpenEntityModelV1(audience)
  if (sharedTemplate) { s.selection.templateKeys = ['dynamic.npc']; s.proposal.templateKey = 'dynamic.npc' }
  const prepared = await prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.adoption.prepare'), scope: s.f.scope,
    viewerKey: s.viewerKey, selection: s.selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
  const read = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey, runId: prepared.runId, requestKey: prepared.requestKey }
  const result = await executeTtrpgOpenEntityRequestV1({ ...read, runAI: async () => JSON.stringify({ proposals: empty ? [] : [s.proposal] }) })
  if (result.status !== 'candidate') throw new Error('expected candidate')
  const acceptance = { ...read, candidateHash: result.candidate.candidateHash, decision: 'reviewed-this-model-entity-candidate' as const }
  return { ...s, prepared, read, candidate: result.candidate, acceptance }
}
async function adopt(s: Awaited<ReturnType<typeof candidate>>) {
  const event = await acceptTtrpgOpenEntityCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'ignored.entity.adopt'), ...s.acceptance })
  const plan = parseTtrpgOpenEntityPlanV2(JSON.parse(event.payloadJson).plan)
  return { ...s, event, plan }
}
async function op(s: Awaited<ReturnType<typeof adopt>>, step: string) {
  const state = await readProductRuntimeState(s.f.sessionId)
  return { ...await openEnvelopeV1(s.f.sessionId, 'ignored.entity.step'), viewerKey: s.viewerKey, operationKey: s.plan.operationKey,
    planHash: s.plan.planHash, commandId: await ttrpgOpenOperationCommandIdV1(state.ttrpg!.sessionKey, s.plan.operationKey, step) }
}
async function approve(s: Awaited<ReturnType<typeof adopt>>) {
  for (const required of s.plan.requiredApprovals) await confirmTtrpgOpenEntityOperationV1({ ...await op(s, 'entity.approval.' + required.actorKey), actorKey: required.actorKey, decision: 'approve' })
}

describe('R-TTRPGOPEN12 exact model candidate adoption into an independently confirmed F13 plan', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('records the actual AI origin, completes only plan adoption, and creates once after separate human approval', async () => {
    const c = await candidate(), before = await readProductRuntimeState(c.f.sessionId)
    const releases = await db.productReleases.toArray(), worlds = await db.worldReleases.toArray(), s = await adopt(c)
    expect(s.plan.version).toBe(2); expect(s.plan.modelOrigin.candidateHash).toBe(c.candidate.candidateHash)
    expect(s.plan.modelOrigin.call.entityProposal).toEqual(s.selection)
    expect(s.plan.items[0]).toMatchObject({ audience: 'party', recipientActorKeys: s.selection.scope.recipientActorKeys })
    expect(() => parseTtrpgOpenEntityPlanV1(s.plan)).toThrow()
    const pending = await readProductRuntimeState(s.f.sessionId)
    expect(pending.entities).toEqual(before.entities); expect(pending.ttrpg!.product.inventory).toEqual(before.ttrpg!.product.inventory)
    expect(pending.ttrpg!.openRun!.entityOperations![0].approvals).toEqual([])
    const run = await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)
    expect(run.projection.state).toBe('completed'); expect(run.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
    expect((await acceptTtrpgOpenEntityCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'ignored.entity.retry'), ...s.acceptance })).id).toBe(s.event.id)
    await expect(materializeTtrpgOpenEntityV1(await op(s, 'entity.materialize'))).rejects.toThrow(/确认/)
    await expect(finishTtrpgOpenEntityDraftV1({ ...s.read, decision: 'discard-this-entity-request-and-close-window' })).rejects.toThrow(/待确认计划/)
    await approve(s)
    const materialized = await materializeTtrpgOpenEntityV1(await op(s, 'entity.materialize'))
    expect((await materializeTtrpgOpenEntityV1(await op(s, 'entity.materialize'))).id).toBe(materialized.id)
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities[s.plan.items[0].entityKey]).toMatchObject({ kind: 'npc', name: s.proposal.name, locationKey: 'harbor' })
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge)
    expect(await db.productReleases.toArray()).toEqual(releases); expect(await db.worldReleases.toArray()).toEqual(worlds)
    const events = await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).sortBy('sequence')
    expect(events.filter(e => e.type === 'ttrpg.open.entity.proposed')).toEqual([])
    const session = await db.productRuntimeSessions.get(s.f.sessionId)
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session!.initialStateJson), events)).toEqual(after)
  })
  it('keeps private model text private even when the selected frozen template and Oracle could support party disclosure', async () => {
    const c = await candidate('private', true)
    // The actual request deliberately uses a party template inside a private input partition.
    expect(c.selection.scope.recipientActorKeys).toEqual(['hero'])
    const s = await adopt(c); await approve(s); await materializeTtrpgOpenEntityV1(await op(s, 'entity.materialize'))
    expect(s.plan.items[0]).toMatchObject({ audience: 'private', recipientActorKeys: ['hero'] })
    const own = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    const other = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'companion.1' })
    expect(JSON.stringify(own)).toContain(s.proposal.name); expect(JSON.stringify(other)).not.toContain(s.proposal.name)
    expect(JSON.stringify(other)).not.toContain('ENTITY-MODEL-PRIVATE-TEMPLATE-CANARY')
    await expect(readTtrpgOpenEntityDeskV1({ ...s.read, viewerKey: 'viewer.seat.companion.1' })).rejects.toThrow(/授权/)
  })
  it('rejects another viewer, changed candidate identity and missing explicit review before any domain write', async () => {
    const s = await candidate(), before = await readProductRuntimeState(s.f.sessionId)
    for (const change of [{ viewerKey: 'viewer.other' }, { candidateHash: 'f'.repeat(64) }, { decision: 'not-reviewed' }]) {
      await expect(acceptTtrpgOpenEntityCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.adopt.invalid'), ...s.acceptance, ...change } as Parameters<typeof acceptTtrpgOpenEntityCandidateV1>[0])).rejects.toThrow()
    }
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
  it('rolls back a failed model plan event and resumes the exact original candidate without another call', async () => {
    const s = await candidate(), before = await readProductRuntimeState(s.f.sessionId), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    const spy = vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'ttrpg.open.entity.model-proposed') throw new Error('entity plan storage cut')
      return add(...args)
    })
    await expect(adopt(s)).rejects.toThrow('entity plan storage cut'); spy.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    const adopted = await adopt(s); expect(adopted.plan.items[0].proposal).toEqual(s.proposal)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls).toHaveLength(1)
  })
  it('repairs a committed plan after a terminal write interruption and after explicit disposal/close without adopting twice', async () => {
    const s = await candidate(), add = db.agentRunEvents.add.bind(db.agentRunEvents)
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'confirmation.recorded') throw new Error('entity plan terminal cut')
      return add(...args)
    })
    await expect(adopt(s)).rejects.toThrow(/待确认计划已保存/); spy.mockRestore()
    const state = await readProductRuntimeState(s.f.sessionId), plan = parseTtrpgOpenEntityPlanV2(state.ttrpg!.openRun!.entityOperations![0].plan)
    const d = { ...s, plan, event: (await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).toArray()).find(e => e.type === 'ttrpg.open.entity.model-proposed')! }
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'entity.plan.pause'), viewerKey: s.viewerKey, changedBy: 'hero', status: 'paused', reason: '明确放弃本计划' })
    await disposeTtrpgOpenEntityOperationV1({ ...await op(d, 'entity.dispose'), reason: '原主持明确放弃，不创建实体' })
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.plan.close'), viewerKey: s.viewerKey, epochKey: plan.authorizationEpochKey, reason: '原窗口结束' })
    await reconcileTtrpgOpenEntityRunV1({ ...s.read, candidateHash: s.candidate.candidateHash })
    await reconcileTtrpgOpenEntityRunV1({ ...s.read, candidateHash: s.candidate.candidateHash })
    expect((await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)).projection.state).toBe('completed')
    expect((await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).toArray()).filter(e => e.type === 'ttrpg.open.entity.model-proposed')).toHaveLength(1)
    expect((await readProductRuntimeState(s.f.sessionId)).entities[plan.items[0].entityKey]).toBeUndefined()
  })
  it('keeps GM-only candidates and instances out of the actual player projection', async () => {
    const s = await adopt(await candidate('gm-only')); await approve(s)
    await materializeTtrpgOpenEntityV1(await op(s, 'entity.materialize'))
    expect(s.plan.items[0]).toMatchObject({ audience: 'gm-only', recipientActorKeys: [] })
    const player = await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'hero' })
    expect(JSON.stringify(player.view)).not.toContain(s.proposal.name)
    expect(JSON.stringify(player.view)).not.toContain('ENTITY-MODEL-GM-TEMPLATE-CANARY')
  })
  it('retains original model evidence through pending/materialized cutpoints, parent/Run deletion, pruning and two complete imports', async () => {
    const s = await adopt(await candidate()), pending = await readProductRuntimeState(s.f.sessionId)
    const pendingChild = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: pending.lastSequence, title: 'Model entity before F13' })
    const pendingState = await readProductRuntimeState(pendingChild.id!)
    expect(pendingState.ttrpg!.openRun!.entityOperations).toEqual([])
    expect(pendingState.ttrpg!.openRun!.coordination.calls).toEqual([])
    expect(pendingState.ttrpg!.branchLineage!.ancestors.at(-1)!.snapshot.openRun!.entityOperations![0].plan).toEqual(s.plan)
    await approve(s); const committed = await materializeTtrpgOpenEntityV1(await op(s, 'entity.materialize'))
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: committed.sequence, title: 'Model entity after F13' })
    const inherited = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'model.entity.child.zero'), viewerKey: s.viewerKey,
      selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: inherited.ttrpg!.product.sessionZero.requiredItemKeys })
    const raw = s.plan.modelOrigin.artifactRefs.find(ref => ref.artifactKind === 'raw-response')!
    await deleteAgentRunV1(s.f.scope, s.prepared.runId)
    await deleteProductRuntimeSession(s.f.sessionId)
    await markAndSweepAgentRunArtifactsV1(s.f.scope.projectId)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: s.f.scope.projectId, ...raw })).toMatchObject({ state: 'available' })
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: s.f.scope.projectId, targets: [raw] })).rejects.toThrow(/已确认产物/)
    const original = await readProductRuntimeState(child.id!)
    await verifyTtrpgOpenEntityStateV1(original, s.input.content)
    const firstProjectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const secondProjectId = await importProjectJSON(await exportProjectJSON(firstProjectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(secondProjectId).toArray()).find(row => row.title === child.title)!
    const after = await readProductRuntimeState(restored.id!)
    expect(after.entities).toEqual(original.entities)
    expect(after.ttrpg!.openRun!.entityOperations).toEqual(original.ttrpg!.openRun!.entityOperations)
    const scope = { projectId: secondProjectId, worldId: restored.worldId!, workId: restored.workId! }
    expect((await readTtrpgOpenEntityDeskV1({ scope, sessionId: restored.id!, viewerKey: s.viewerKey }))?.entities).toContainEqual(expect.objectContaining({ key: s.plan.items[0].entityKey }))
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: secondProjectId, ...raw })).toMatchObject({ state: 'available' })
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(restored.id!).count()).toBe(0)
    // The pending child is an independent retained evidence owner even without a live candidate/Run.
    await deleteProductRuntimeSession(child.id!)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: s.f.scope.projectId, ...raw })).toMatchObject({ state: 'available' })
    await deleteProductRuntimeSession(pendingChild.id!)
    await markAndSweepAgentRunArtifactsV1(s.f.scope.projectId)
    expect(await inspectAgentRunArtifactAvailabilityV1({ projectId: s.f.scope.projectId, ...raw })).toMatchObject({ state: 'evidence-pruned' })
  })
  it('rejects changed source purpose and rehashed disclosure widening during strict replay', async () => {
    const s = await adopt(await candidate('private', true))
    const session = await db.productRuntimeSessions.get(s.f.sessionId), events = await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).sortBy('sequence')
    const widened = structuredClone(events), last = widened.find(row => row.type === 'ttrpg.open.entity.model-proposed')!
    const body = JSON.parse(last.payloadJson), plan = body.plan
    plan.items[0].audience = 'party'; plan.items[0].recipientActorKeys = ['companion.1', 'companion.2', 'hero']
    const { planHash: _old, ...changed } = plan; plan.planHash = await hashProductProductionValueV2(changed)
    last.payloadJson = JSON.stringify(body)
    expect(() => replayProductRuntimeEvents(parseProductRuntimeState(session!.initialStateJson), widened)).toThrow(/披露范围/)
    const originChanged = structuredClone(s.plan)
    originChanged.modelOrigin.call.runContractHash = 'f'.repeat(64)
    const { planHash: _oldHash, ...newBody } = originChanged; originChanged.planHash = await hashProductProductionValueV2(newBody)
    await expect(verifyTtrpgOpenEntityPlanHashesV1([{ plan: originChanged, approvals: [], resolution: null }])).rejects.toThrow(/原 Skill|证据/)
  })
  it('rejects empty output and imported local-id aliases without writing an entity plan', async () => {
    const empty = await candidate('party', false, true), before = await readProductRuntimeState(empty.f.sessionId)
    await expect(adopt(empty)).rejects.toThrow(/没有实体/)
    expect(await readProductRuntimeState(empty.f.sessionId)).toEqual(before)
    await db.delete(); await db.open()
    const s = await candidate(), projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first(), run = await db.agentRuns.where('productRuntimeSessionId').equals(session!.id!).first()
    const importedBefore = await readProductRuntimeState(session!.id!)
    await expect(acceptTtrpgOpenEntityCandidateV1({ ...await openEnvelopeV1(session!.id!, 'entity.imported.no.adopt'), ...s.acceptance,
      sessionId: session!.id!, runId: run!.id! })).rejects.toThrow(/导入|本地/)
    expect(await readProductRuntimeState(session!.id!)).toEqual(importedBefore)
  })
  it('recovers each original adoption terminal cut without changing the pending plan or sending again', async () => {
    for (const cut of ['runtime.candidate.adopted', 'step.succeeded', 'verification.started', 'verification.accepted']) {
      if (cut !== 'runtime.candidate.adopted') { await db.delete(); await db.open() }
      const s = await candidate(), add = db.agentRunEvents.add.bind(db.agentRunEvents)
      const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
        if (args[0].type === cut) throw new Error('entity terminal cut ' + cut)
        return add(...args)
      })
      await expect(adopt(s)).rejects.toThrow(/待确认计划已保存/); spy.mockRestore()
      const before = await readProductRuntimeState(s.f.sessionId)
      await reconcileTtrpgOpenEntityRunV1({ ...s.read, candidateHash: s.candidate.candidateHash })
      expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
      const run = await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)
      expect(run.projection.state).toBe('completed')
      expect(run.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
      expect(before.ttrpg!.openRun!.coordination.calls).toHaveLength(1)
    }
  })
  it('lets only the committed domain decision win when adopt and explicit stop compete', async () => {
    const s = await candidate()
    await Promise.allSettled([adopt(s), finishTtrpgOpenEntityDraftV1({ ...s.read, decision: 'discard-this-entity-request-and-close-window' })])
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
    const plan = run.entityOperations?.[0]?.plan
    if (plan) {
      expect(run.coordination.epochs[0].status).toBe('active')
      await reconcileTtrpgOpenEntityRunV1({ ...s.read, candidateHash: s.candidate.candidateHash })
      expect((await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)).projection.state).toBe('completed')
    } else {
      expect(run.coordination.epochs[0].status).toBe('closed')
      expect((await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)).projection.state).toBe('cancelled')
    }
    expect(run.coordination.calls).toHaveLength(1)
    expect(Object.keys(state.entities)).toEqual(Object.keys(s.input.state.entities))
  })
})
