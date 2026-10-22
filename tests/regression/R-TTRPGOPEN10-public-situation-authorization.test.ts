import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { createTtrpgOpenPublicSituationAuthorizationV1 } from '../../src/lib/ttrpg/open-public-situation-authorization'
import { verifyTtrpgOpenPublicSituationAuthorizationV1 } from '../../src/lib/ttrpg/open-public-situation-authorization-proof'
import { loadTtrpgOpenPublicSituationContextV1, createTtrpgOpenPublicSituationContextProviderV1 } from '../../src/lib/ttrpg/open-public-situation-context'
import * as api from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1, deleteAgentRunV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { prepareTtrpgOpenSituationInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { parseTtrpgOpenRunOriginV1 } from '../../src/lib/ttrpg/open-run-portability'
import { finishTtrpgOpenPublicSituationDraftV1 } from '../../src/lib/ttrpg/open-public-situation-stop'

async function setup() {
  const f = await readyOpenTtrpgSessionV1('Public one-request authorization', p => {
    p.ttrpg!.campaign.runtimePolicy.enabled = true
    p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    p.ttrpg!.campaign.runtimePolicy.maximumOutputTokens = 8000
  })
  const input = { ...await openEnvelopeV1(f.sessionId, 'public.authorize.once'), scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER,
    rawInput: '  请依据共同资料准备新局势 e\u0301。\n', sharingDecision: 'share-this-request-with-current-party' as const,
    delegationDecision: 'adopt-this-one-candidate' as const, modelIdentity: { provider: 'test-adapter', model: 'injected' },
    maximumOutputTokens: 4000, maximumCostUsd: 0.1 }
  return { f, input }
}
describe('R-TTRPGOPEN10 original local Run before public authorization', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('commits the exact sharing decision once, keeps one original Run and exposes the actual unnormalized input only as a full source', async () => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId)
    const base = await loadTtrpgOpenPublicSituationContextV1({ ...input, actorKey: 'gm' })
    const result = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    const repeated = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    expect(repeated).toEqual(result); expect(await db.agentRuns.count()).toBe(1)
    expect(result.grant.budget).toMatchObject({ maximumInputTokens: 44000, maximumOutputTokens: 4000 })
    const state = await readProductRuntimeState(f.sessionId), epoch = state.ttrpg!.openRun!.coordination.epochs[0]
    expect(epoch).toMatchObject({ triggerKind: 'request-public-situation', reservedCalls: 0, budget: { maximumCalls: 1, maximumAiActions: 0 } })
    expect(epoch.publicSituation!.basis.sharedRequest.text).toBe(input.rawInput)
    expect(epoch.publicSituation!.basis.sharedRequest.inputHash).toBe(await sha256Text(input.rawInput))
    expect(state.entities).toEqual(before.entities); expect(state.ttrpg!.product).toEqual(before.ttrpg!.product)
    expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    const context = await loadTtrpgOpenPublicSituationContextV1({ ...input, actorKey: 'gm' })
    expect(context.visibilityHash).toBe(base.visibilityHash); expect(context.admissionStateHash).toBe(base.admissionStateHash)
    const shared = context.resources.find(row => row.suffix === 'public-situation-shared-input')!
    expect(shared.mandatory).toBe(true); expect(shared.value).toMatchObject({ text: input.rawInput, basisHash: result.grant.basisHash })
    expect(context.resources.filter(row => row.mandatory)).toHaveLength(7)
    const proof = await verifyTtrpgOpenPublicSituationAuthorizationV1({ ...input, authorization: result.grant, phase: 'prepare' })
    expect(proof.evidence.run.id).toBe(result.runId)
    expect((await readInstanceAgentRunV1(f.scope, result.runId)).events.some(event => event.type === 'model.requested')).toBe(false)
    expect(state.ttrpg!.openRun!.coordination.calls).toEqual([])
    const session = (await db.productRuntimeSessions.get(f.sessionId))!
    const events = await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).sortBy('sequence')
    expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(state)
    const changed = structuredClone(events), start = changed.find(row => row.type === 'ttrpg.open.epoch.started')!
    const payload = JSON.parse(start.payloadJson)
    payload.epoch.publicSituation.basis.scope.projectId += 9000
    payload.intent.publicSituation = structuredClone(payload.epoch.publicSituation)
    start.payloadJson = JSON.stringify(payload)
    expect(() => replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), changed)).toThrow(/原始作用域与原契约/)
  })
  it('requires explicit sharing and an exact bounded choice before creating any Run or window', async () => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId)
    for (const patch of [{ sharingDecision: false }, { delegationDecision: 'always-adopt' }, { maximumCostUsd: 1001 }, { maximumOutputTokens: 8001 }, { viewerKey: 'viewer.seat.companion.1' }]) {
      await expect(createTtrpgOpenPublicSituationAuthorizationV1({ ...input, ...patch } as typeof input)).rejects.toThrow()
    }
    expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it.each(['input-total', 'output-limit', 'cost-limit'] as const)('rejects %s above the frozen policy before committing authority or reserving a model call', async kind => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId)
    const real = api.authorizeTtrpgOpenPublicSituationV1
    vi.spyOn(api, 'authorizeTtrpgOpenPublicSituationV1').mockImplementation(async command => {
      const authorization = structuredClone(command.authorization) as Awaited<ReturnType<typeof createTtrpgOpenPublicSituationAuthorizationV1>>['grant']
      if (kind === 'input-total') authorization.budget.maximumInputTokens = before.ttrpg!.epochBudget.maximumTokens - authorization.budget.maximumOutputTokens + 1
      if (kind === 'output-limit') authorization.budget.maximumOutputTokens = 8001
      if (kind === 'cost-limit') authorization.budget.maximumCostUsd = before.ttrpg!.epochBudget.maximumCostUsd + 0.01
      return real({ ...command, authorization })
    })
    await expect(createTtrpgOpenPublicSituationAuthorizationV1(input)).rejects.toThrow(/超过冻结作品策略/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    const runs = await db.agentRuns.toArray()
    expect(runs).toHaveLength(1); expect(runs[0].status).toBe('failed')
    expect((await db.agentRunEvents.toArray()).some(event => event.type === 'model.requested')).toBe(false)
  })
  it('explicitly closes the original authorization before any input or reservation, retaining its cancelled Run and zero model calls', async () => {
    const { f, input } = await setup(), result = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    await finishTtrpgOpenPublicSituationDraftV1({ ...input, epochKey: result.epochKey })
    const state = await readProductRuntimeState(f.sessionId)
    expect(state.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(state.ttrpg!.openRun!.coordination.calls).toEqual([])
    expect((await readInstanceAgentRunV1(f.scope, result.runId)).projection.state).toBe('cancelled')
    await expect(verifyTtrpgOpenPublicSituationAuthorizationV1({ ...input, authorization: result.grant, phase: 'prepare' })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('fails the unsent original Run when domain authorization cannot commit and never silently creates a replacement on retry', async () => {
    const { f, input } = await setup(), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
    vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'ttrpg.open.epoch.started') throw new Error('authorization write unavailable')
      return add(...args)
    })
    await expect(createTtrpgOpenPublicSituationAuthorizationV1(input)).rejects.toThrow(/authorization write unavailable/)
    vi.restoreAllMocks()
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.epochs).toEqual([])
    const runs = await db.agentRuns.toArray(); expect(runs).toHaveLength(1); expect(runs[0].status).toBe('failed')
    await expect(createTtrpgOpenPublicSituationAuthorizationV1(input)).rejects.toThrow(/原准备已经结束/)
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('lets a committed authorization win an interrupted return and recovers the same original Run through idempotent readback', async () => {
    const { f, input } = await setup(), real = api.authorizeTtrpgOpenPublicSituationV1
    vi.spyOn(api, 'authorizeTtrpgOpenPublicSituationV1').mockImplementation(async command => {
      await real(command); throw new Error('after authorization commit')
    })
    await expect(createTtrpgOpenPublicSituationAuthorizationV1(input)).rejects.toThrow(/after authorization commit/)
    vi.restoreAllMocks()
    const recovered = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    expect(await db.agentRuns.count()).toBe(1)
    expect((await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()).filter(event => event.type === 'ttrpg.open.epoch.started')).toHaveLength(1)
    expect((await readInstanceAgentRunV1(f.scope, recovered.runId)).projection.state).not.toBe('failed')
    await expect(verifyTtrpgOpenPublicSituationAuthorizationV1({ ...input, authorization: recovered.grant, phase: 'prepare' })).resolves.toBeDefined()
  })
  it('resumes the original pre-grant Run after a source-artifact cut and failed cleanup, with no new Run or model request', async () => {
    const { input } = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents)
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'evidence.artifact.recorded' || args[0].type === 'run.failed') throw new Error('isolated pre-grant crash cut')
      return add(...args)
    })
    await expect(createTtrpgOpenPublicSituationAuthorizationV1(input)).rejects.toThrow(/crash cut/)
    const original = (await db.agentRuns.toArray())[0]; expect(await db.agentRuns.count()).toBe(1)
    vi.restoreAllMocks()
    const resumed = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    expect(resumed.runId).toBe(original.id); expect(await db.agentRuns.count()).toBe(1)
    expect((await readInstanceAgentRunV1(input.scope, resumed.runId)).events.some(event => event.type === 'model.requested')).toBe(false)
  })
  it('rejects original authority after parent Run deletion and keeps shared historical material read-only', async () => {
    const { input } = await setup(), result = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    await deleteAgentRunV1(input.scope, result.runId)
    await expect(verifyTtrpgOpenPublicSituationAuthorizationV1({ ...input, authorization: result.grant, phase: 'prepare' })).rejects.toThrow()
    await expect(createTtrpgOpenPublicSituationAuthorizationV1(input)).rejects.toThrow(/导入记录不具有活授权/)
    const context = await loadTtrpgOpenPublicSituationContextV1({ ...input, actorKey: 'gm' })
    expect(context.resources.find(row => row.suffix === 'public-situation-shared-input')!.value).toMatchObject({ text: input.rawInput })
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('denies imported unprepared authority even when a new database reuses the same numeric identifiers', async () => {
    const { f, input } = await setup(), result = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    const backup = await exportProjectJSON(f.scope.projectId)
    await db.delete(); await db.open()
    const projectId = await importProjectJSON(backup), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId, workId: session.workId } })
    const importedRun = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray())[0]
    expect(session.id).toBe(input.sessionId); expect(importedRun.id).toBe(result.runId)
    expect(importedRun.portableRuntimeOriginJson).toBeTruthy()
    expect(await parseTtrpgOpenRunOriginV1(importedRun.portableRuntimeOriginJson!)).toMatchObject({ version: 2, phase: 'public-request-preparation' })
    await expect(verifyTtrpgOpenPublicSituationAuthorizationV1({ ...input, scope, sessionId: session.id!, authorization: result.grant, phase: 'prepare' })).rejects.toThrow(/原本地 Run|导入历史/)
    await expect(createTtrpgOpenPublicSituationAuthorizationV1({ ...input, scope, sessionId: session.id! })).rejects.toThrow(/导入记录不具有活授权/)
  })
  it('archives a pre-authorization orphan as preparation evidence and requires a new explicit request after import', async () => {
    const { f, input } = await setup(), add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents), agentAdd = db.agentRunEvents.add.bind(db.agentRunEvents)
    vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'ttrpg.open.epoch.started') throw new Error('pre-authorization cut')
      return add(...args)
    })
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'run.failed') throw new Error('cleanup interrupted')
      return agentAdd(...args)
    })
    await expect(createTtrpgOpenPublicSituationAuthorizationV1(input)).rejects.toThrow(/cleanup interrupted/)
    vi.restoreAllMocks()
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.epochs).toEqual([])
    const backup = await exportProjectJSON(f.scope.projectId)
    await db.delete(); await db.open()
    const projectId = await importProjectJSON(backup), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId, workId: session.workId } })
    const original = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray())[0]
    const archive = await parseTtrpgOpenRunOriginV1(original.portableRuntimeOriginJson!)
    expect(archive.version).toBe(2); expect(archive.events.some(event => event.type === 'model.requested')).toBe(false)
    await expect(createTtrpgOpenPublicSituationAuthorizationV1({ ...input, scope, sessionId: session.id! })).rejects.toThrow(/导入历史/)
    expect(await db.agentRuns.count()).toBe(1)
    const fresh = await createTtrpgOpenPublicSituationAuthorizationV1({ ...input, ...await openEnvelopeV1(session.id!, 'public.fresh.after.import'), scope })
    expect(fresh.runId).not.toBe(original.id)
    expect((await db.agentRuns.get(fresh.runId))!.portableRuntimeOriginJson).toBeUndefined()
    expect((await readProductRuntimeState(session.id!)).ttrpg!.openRun!.coordination.calls).toEqual([])
  })
  it('blocks old actions, Oracle and private generation during the public window, and invalidates pinned bytes on explicit close', async () => {
    const { f, input } = await setup(), result = await createTtrpgOpenPublicSituationAuthorizationV1(input)
    const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' }, provider = createTtrpgOpenPublicSituationContextProviderV1()
    const pinned = await provider.openReadSession!(scope)
    await expect(api.consultTtrpgOracleV1({ ...await openEnvelopeV1(f.sessionId, 'public.no.oracle'), viewerKey: OPEN_HUMAN_VIEWER,
      askedBy: 'gm', oracleKey: 'oracle.yes', question: '能否改变事实？', likelihoodTierKey: 'even' })).rejects.toThrow()
    const action = f.runtimePackage.ttrpg!.rulePack.content.actions[0]
    await expect(api.startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId, 'public.no.action'), viewerKey: OPEN_HUMAN_VIEWER,
      request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key,
        targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {} } })).rejects.toThrow(/生成窗口/)
    await expect(prepareTtrpgOpenSituationInputV1({ ...input, ...await openEnvelopeV1(f.sessionId, 'public.no.private') })).rejects.toThrow(/生成窗口/)
    await api.closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'public.close'), viewerKey: OPEN_HUMAN_VIEWER, epochKey: result.epochKey, reason: '取消本次拟定' })
    await expect(pinned.provider.listMetadata({ scope, limit: 1000 })).rejects.toThrow(/已变化/)
    await expect(verifyTtrpgOpenPublicSituationAuthorizationV1({ ...input, authorization: result.grant, phase: 'prepare' })).rejects.toThrow(/窗口已结束/)
  })
  it('refuses a different local Run with the same contract and output above the actual human grant before any request is reserved', async () => {
    const { f, input } = await setup(), result = await createTtrpgOpenPublicSituationAuthorizationV1(input), grant = result.grant
    const call = { ...await openEnvelopeV1(f.sessionId, grant.reservationCommandId), viewerKey: input.viewerKey, runId: result.runId,
      actorKey: 'gm', skillId: 'prose.ttrpg-open-public-situation-propose', stepId: 'ttrpg.open.public-situation-propose', attempt: 1,
      runContractHash: grant.run.contractHash, inputManifestHash: 'a'.repeat(64), requestHash: 'a'.repeat(64),
      admissionStateHash: grant.admissionStateHash, visibilityHash: grant.basis.sourceVisibilityHash, runtimeSourceHash: grant.basis.runtimeSourceHash,
      reservedInputTokens: 1000, reservedOutputTokens: 8000, reservedCostUsd: grant.budget.maximumCostUsd }
    await expect(api.reserveTtrpgOpenModelCallV1(call)).rejects.toThrow(/冻结预算/)
    const clone = await createAgentRunV1({ scope: input.scope, productRuntimeSessionId: f.sessionId, worldGroupId: null,
      contract: JSON.parse(grant.run.contractJson) })
    expect(clone.run.contractHash).toBe(grant.run.contractHash)
    await expect(api.reserveTtrpgOpenModelCallV1({ ...call, runId: clone.run.id, reservedOutputTokens: grant.budget.maximumOutputTokens })).rejects.toThrow(/本次原 Run/)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls).toEqual([])
  })
})
