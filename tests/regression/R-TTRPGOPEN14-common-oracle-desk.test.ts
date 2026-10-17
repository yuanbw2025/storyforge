import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleDeskV1 as setup } from '../helpers/open-common-oracle-desk'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenCommonOracleDeskV1 as read, requestTtrpgOpenCommonOracleDeskV1 as request,
  resumeTtrpgOpenCommonOracleDeskV1 as resume, reviewTtrpgOpenCommonOracleDeskV1 as review, repairTtrpgOpenCommonOracleDeskV1 as repair,
  finishTtrpgOpenCommonOracleDeskV1 as finish, closeTtrpgOpenCommonOracleDeskV1 as close, archiveTtrpgOpenCommonOracleDeskV1 as archive } from '../../src/lib/ttrpg/open-common-oracle-desk'
import * as source from '../../src/lib/ttrpg/open-common-oracle-context'
import * as events from '../../src/lib/agent/run/event-store'
import { changeTtrpgSafetyStatus, commitTtrpgOpenCommonOracleCandidateFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

const stop = { decision: 'discard-this-common-oracle-request-and-close-window' as const }
async function requested() {
  const s = await setup(), result = await request({ ...s.command, runAI: async () => s.output })
  const input = { ...s.owner, requestKey: result.requestKey }, page = await read(input)
  if (!page?.request?.candidate) throw new Error('Expected retained common candidate')
  const decision = { ...input, candidateHash: page.request.candidate.candidateHash, interpretationDecision: 'accept' as const,
    interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }], decision: 'reviewed-this-original-common-oracle-candidate' as const }
  return { ...s, input, decision, candidate: page.request.candidate }
}
describe('R-TTRPGOPEN14 common-human desk without private return values or implicit actions', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  for (const audience of ['party', 'public'] as const) it(`reads ${audience} common sources without opening a Run, exposes only exact common identities and refuses an AI/private viewer`, async () => {
    const s = await setup(audience), before = await readProductRuntimeState(s.f.sessionId), count = await db.productRuntimeEvents.count()
    expect((await read(s.owner))!.catalog).toEqual(s.page.catalog)
    const serialized = JSON.stringify(s.page)
    for (const value of ['COMMON-ORACLE-GM-', 'COMMON-ORACLE-PRIVATE-', 'COMMON-ORACLE-FULL-', s.privatePlace, 'operationKey', 'templateHash', 'frozenContentJson', 'characterSheet', '.equipment.0']) expect(serialized).not.toContain(value)
    await expect(read({ ...s.owner, viewerKey: 'viewer.gm' })).rejects.toThrow('当前不能读取')
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRuns.count()).toBe(0)
  })
  it('keeps the exact unconfirmed candidate, rolls back failed review, retries only the original choices and reads confirmed facts without renewing a stale source', async () => {
    const s = await requested(), before = await readProductRuntimeState(s.f.sessionId)
    expect(before.ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
    const projected = JSON.stringify(await read(s.input))
    for (const secret of ['COMMON-ORACLE-GM-', 'COMMON-ORACLE-PRIVATE-', 'COMMON-ORACLE-FULL-', s.privatePlace, 'frozenContentJson', 'templateHash', 'operationKey']) expect(projected).not.toContain(secret)
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('COMMON-UI-REVIEW-STORAGE-CUT'))
    await expect(review(s.decision)).rejects.toThrow(); cut.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await review(s.decision); await review(s.decision)
    const denyFresh = vi.spyOn(source, 'loadTtrpgOpenCommonOracleContextV1').mockRejectedValue(new Error('MUST-NOT-RENEW-COMMON-SOURCE-AFTER-REVIEW'))
    const page = await read(s.input)
    expect(denyFresh).not.toHaveBeenCalled(); denyFresh.mockRestore()
    expect(page!.request!.review).toMatchObject({ interpretationDecision: 'accept', adoptedCount: 1 })
    expect(page!.request!.candidate).toBeNull(); expect(page!.request!.canReview).toBe(false)
    expect(page!.request!.confirmedFactDetails).toEqual([s.fact.detail])
    await close({ ...s.input, decision: 'close-this-reviewed-common-oracle-window' }); await close({ ...s.input, decision: 'close-this-reviewed-common-oracle-window' })
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product)
    expect(await db.agentRuns.count()).toBe(1)
    await expect(finish({ ...s.input, ...stop })).rejects.toThrow('原共同操作尚未完成')
  })
  it('retains a real authorization if the UI handoff stops before preparation, then explicitly ends that zero-call window', async () => {
    const s = await setup(); let requestKey = '', sends = 0
    await expect(request({ ...s.command, runAI: async () => { sends++; return s.output }, onAuthorized: key => { requestKey = key; throw new Error('COMMON-UI-AUTHORIZED-RETURN-CUT') } })).rejects.toThrow('原共同操作尚未完成')
    const input = { ...s.owner, requestKey }, page = await read(input)
    expect(page!.request).toMatchObject({ status: 'authorized', canResume: true, canFinish: true })
    await finish({ ...input, ...stop })
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(sends).toBe(0)
  })
  it('saves an unknown result and cost before stopping the local wait; the late response cannot replace them', async () => {
    const s = await setup(); let requestKey = '', release!: () => void, started!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve }), sending = new Promise<void>(resolve => { started = resolve })
    const generation = request({ ...s.command, onAuthorized: key => { requestKey = key }, runAI: async () => { started(); await waiting; return s.output } })
    const observed = generation.then(value => value, error => error)
    await sending; const input = { ...s.owner, requestKey }
    expect((await read(input))!.request).toMatchObject({ status: 'dispatched', observed: false, canFinish: true })
    await finish({ ...input, ...stop }); const saved = await readProductRuntimeState(s.f.sessionId)
    expect(saved.ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'unknown', usage: { actualCostUsd: null } })
    release(); expect(await observed).toBeInstanceOf(Error); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(saved)
  })
  it('repairs an already observed original answer without a second send and permits explicit stopping while paused', async () => {
    const s = await setup(), append = events.appendAgentRunEventV1; let requestKey = '', sends = 0
    const cut = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => { if (input.type === 'model.responded') throw new Error('COMMON-UI-OBSERVED-CUT'); return append(input) })
    await expect(request({ ...s.command, onAuthorized: key => { requestKey = key }, runAI: async () => { sends++; return s.output } })).rejects.toThrow('原共同操作尚未完成'); cut.mockRestore()
    const input = { ...s.owner, requestKey }
    expect((await read(input))!.request).toMatchObject({ observed: true, canRepairResponse: true })
    await repair(input)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'common.ui.pause'), viewerKey: s.owner.viewerKey, changedBy: 'hero', status: 'paused', reason: '暂停后明确停止原候选' })
    await finish({ ...input, ...stop }); expect(sends).toBe(1)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
  })
  it('closes a paused original request whose actual raw answer preceded its interrupted response receipt, without requiring candidate recovery', async () => {
    const s = await setup(), append = events.appendAgentRunEventV1; let requestKey = '', sends = 0
    const cut = vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => { if (input.type === 'model.responded') throw new Error('COMMON-UI-PAUSED-OBSERVED-CUT'); return append(input) })
    await expect(request({ ...s.command, onAuthorized: key => { requestKey = key }, runAI: async () => { sends++; return s.output } })).rejects.toThrow(); cut.mockRestore()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'common.ui.pause.before.stop'), viewerKey: s.owner.viewerKey, changedBy: 'hero', status: 'paused', reason: '暂停后直接收尾已观察回答' })
    await finish({ ...s.owner, requestKey, ...stop })
    const state = await readProductRuntimeState(s.f.sessionId), run = state.ttrpg!.openRun!
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run.coordination.calls[0]).toMatchObject({ status: 'succeeded', usage: { actualCostUsd: null } })
    expect(run.factLedger?.entries ?? []).toHaveLength(0); expect(sends).toBe(1)
  })
  it('keeps a blocked original answer and its common source visible after explicit discard without granting confirmation', async () => {
    const s = await setup(), result = await request({ ...s.command, runAI: async () => JSON.stringify({ interpretation: '不可自动落入机械状态。', facts: [{ ...s.fact, predicateKey: 'hp' }] }) })
    const input = { ...s.owner, requestKey: result.requestKey }, page = await read(input)
    expect(page!.request).toMatchObject({ canReview: false, canFinish: true, candidate: { status: 'blocked', facts: null } })
    await finish({ ...input, ...stop })
    const retained = await read(input)
    expect(retained!.request).toMatchObject({ closed: true, candidate: { status: 'blocked' }, canReview: false })
    expect(retained!.request!.source).toBeTruthy(); expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
  })
  it('fails closed on damaged retained delivery and never returns the corrupted body or private error text', async () => {
    const s = await requested(), rows = await db.agentRunArtifacts.where('projectId').equals(s.f.scope.projectId).toArray()
    const artifact = rows.find(row => row.artifactKind === 'source-snapshot' && row.content?.includes('storyforge.context-resource-snapshot') && row.content.includes('ttrpgOpenCommonOracleInput'))
      ?? rows.find(row => row.artifactKind === 'source-snapshot' && row.content?.includes('common-oracle-contract') && row.content.includes('content'))!
    expect(artifact).toBeTruthy()
    await db.agentRunArtifacts.update(artifact.id!, { content: 'COMMON-DESK-PRIVATE-CORRUPTED-DELIVERY' })
    const page = await read(s.input)
    expect(page!.request!.canReview).toBe(false); expect(page!.request!.source).toBeNull(); expect(JSON.stringify(page)).not.toContain('COMMON-DESK-PRIVATE-CORRUPTED-DELIVERY')
    await expect(review(s.decision)).rejects.toThrow('原共同操作尚未完成')
    await db.agentRunArtifacts.put(artifact)
    expect((await read(s.input))!.request!.canReview).toBe(true)
  })
  it('projects a legitimate single confirmed fact and rejects a corrupted actual fact event before returning any altered text', async () => {
    const s = await requested(), state = await readProductRuntimeState(s.f.sessionId), grant = state.ttrpg!.openRun!.coordination.epochs.slice(-1)[0].commonOracle!
    await commitTtrpgOpenCommonOracleCandidateFactV1({ ...s.input, ...await openEnvelopeV1(s.f.sessionId, 'common.ui.single'), runId: grant.run.runId, candidateHash: s.candidate.candidateHash, proposalIndex: 0, decision: 'assert' })
    expect((await read(s.input))!.request!.confirmedFactDetails).toEqual([s.fact.detail])
    const event = (await db.productRuntimeEvents.where('sessionId').equals(s.f.sessionId).toArray()).find(row => row.type === 'ttrpg.fact.asserted')!
    const payload = JSON.parse(event.payloadJson); payload.entry.fact.detail = 'COMMON-PRIVATE-CORRUPTED-FACT-DETAIL'
    await db.productRuntimeEvents.update(event.id!, { payloadJson: JSON.stringify(payload) })
    await expect(read(s.input)).rejects.toThrow('当前不能读取本人的共同事实进度')
    await db.productRuntimeEvents.put(event)
    expect((await read(s.input))!.request!.confirmedFactDetails).toEqual([s.fact.detail])
  })
  it('keeps imported known responses read-only, explicitly archives them and preserves the source Run and confirmed owners', async () => {
    const s = await requested(), originalRuns = await db.agentRuns.toArray()
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } }), input = { ...s.input, scope, sessionId: copy.id! }
    const before = await readProductRuntimeState(copy.id!), rows = await db.agentRuns.toArray(), page = await read(input)
    expect(page!.request).toMatchObject({ local: false, canResume: false, canReview: false, canArchive: true, status: 'succeeded' })
    expect(page!.request!.historicalResponse?.text).toBe(s.output)
    expect(await db.agentRuns.toArray()).toEqual(rows); expect(await readProductRuntimeState(copy.id!)).toEqual(before)
    await expect(resume({ ...input, runAI: async () => { throw new Error('must not send') } })).rejects.toThrow()
    await archive({ ...input, decision: 'archive-this-unresumable-common-oracle-window' })
    expect((await read(input))!.request).toMatchObject({ archived: true, closed: true, status: 'succeeded', canArchive: false })
    expect((await db.agentRuns.toArray()).filter(row => row.projectId === s.f.scope.projectId)).toEqual(originalRuns)
  })
})
