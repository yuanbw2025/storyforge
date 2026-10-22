import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOracleRuntimeDeskV1 } from '../helpers/open-oracle-runtime-model'
import { OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenOracleModelDeskV1, requestTtrpgOpenOracleModelDeskV1, resumeTtrpgOpenOracleModelDeskV1,
  reviewTtrpgOpenOracleModelDeskV1, repairTtrpgOpenOracleModelDeskV1, finishTtrpgOpenOracleModelDeskV1, closeTtrpgOpenOracleModelWindowDeskV1 } from '../../src/lib/ttrpg/open-oracle-model-desk'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

async function setup(audience: 'public' | 'party' | 'gm-only' = 'party') {
  const s = await setupOracleRuntimeDeskV1(audience), page = await readTtrpgOpenOracleModelDeskV1(s.owner)
  if (!page?.canRequest) throw new Error('expected available original Oracle model desk: ' + page?.unavailable)
  const selected = page.catalog.find(row => row.oracleSourceRef.sequence === s.input.oracle.sourceRef.sequence)!
  const command = { ...s.owner, oracleSourceRef: selected.oracleSourceRef, snapshotHash: selected.snapshotHash, expectedSequence: page.sequence,
    submissionKey: 'oracle.desk.request', decision: 'request-this-oracle-instance-candidate' as const, maximumCostUsd: 0.1 }
  const output = JSON.stringify({ interpretation: '依据原咨询拟定本次可审阅关系。', facts: [s.fact] })
  return { ...s, page, selected, command, output }
}
async function requested() {
  const s = await setup(), result = await requestTtrpgOpenOracleModelDeskV1({ ...s.command, runAI: async () => s.output })
  const read = { ...s.owner, requestKey: result.requestKey }, page = await readTtrpgOpenOracleModelDeskV1(read)
  if (!page?.request?.candidate) throw new Error('expected saved original candidate')
  const review = { ...read, candidateHash: page.request.candidate.candidateHash, decision: 'reviewed-this-original-oracle-candidate' as const,
    interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
  return { ...s, read, candidate: page.request.candidate, review }
}
describe('R-TTRPGOPEN13 real human Oracle model desk and original request recovery', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('reads only current human-GM choices, skips unrelated empty public scopes and never opens a window or sends', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), count = await db.productRuntimeEvents.count()
    const page = await readTtrpgOpenOracleModelDeskV1(s.owner)
    expect(page!.catalog).toHaveLength(1); expect(page!.catalog[0].entities.map(row => row.name)).toEqual(['新守灯人'])
    expect(JSON.stringify(page!.catalog)).not.toMatch(/ORACLE-POLICY-PRIVATE-PROFILE|新候选地点|equipment|planHash|templateKey/)
    expect(await readTtrpgOpenOracleModelDeskV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER })).toBeNull()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRuns.count()).toBe(0)
  })
  it('saves an exact candidate before human review, confirms it once and separately closes the original window', async () => {
    const s = await requested(), before = await readProductRuntimeState(s.f.sessionId)
    expect(before.ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
    const request = (await readTtrpgOpenOracleModelDeskV1(s.read))!.request!
    expect(request).toMatchObject({ canReview: true, canFinish: true, committed: false })
    await reviewTtrpgOpenOracleModelDeskV1(s.review)
    const count = await db.productRuntimeEvents.count()
    await reviewTtrpgOpenOracleModelDeskV1(s.review); expect(await db.productRuntimeEvents.count()).toBe(count)
    await expect(finishTtrpgOpenOracleModelDeskV1({ ...s.read, decision: 'discard-this-oracle-instance-request-and-close-window' })).rejects.toThrow(/确认|拒绝/)
    const page = await readTtrpgOpenOracleModelDeskV1(s.read)
    expect(page!.request).toMatchObject({ committed: true, canReview: false, canFinish: false, canRepairReview: false })
    expect(page!.request!.review!.adoptedCount).toBe(1)
    await closeTtrpgOpenOracleModelWindowDeskV1({ ...s.owner, epochKey: page!.closeWindowEpochKey!, decision: 'close-this-original-oracle-window' })
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1); expect(after.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product)
  })
  it('recovers an actual prepared-but-unsent request through the same Run after a return cut, without sending during reads', async () => {
    const s = await setup(), sends = vi.fn(async () => s.output)
    let key = ''
    await expect(requestTtrpgOpenOracleModelDeskV1({ ...s.command, runAI: sends, onPrepared: value => { key = value; throw new Error('ORACLE-DESK-PREPARED-RETURN-CUT') } })).rejects.toThrow('ORACLE-DESK-PREPARED-RETURN-CUT')
    const read = { ...s.owner, requestKey: key }, before = await readProductRuntimeState(s.f.sessionId)
    for (let n = 0; n < 2; n++) expect((await readTtrpgOpenOracleModelDeskV1(read))!.request).toMatchObject({ canResume: true, status: 'prepared', observed: false })
    expect(sends).not.toHaveBeenCalled(); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await resumeTtrpgOpenOracleModelDeskV1({ ...read, runAI: sends })
    expect(sends).toHaveBeenCalledOnce(); expect(await db.agentRuns.count()).toBe(1)
    await expect(resumeTtrpgOpenOracleModelDeskV1({ ...read, runAI: sends })).rejects.toThrow(/不能继续/)
    expect(sends).toHaveBeenCalledOnce()
  })
  it('keeps the saved confirmation through a return cut, retries the same choices and rejects any changed intent', async () => {
    const s = await requested(), original = commands.reviewTtrpgOpenOracleCandidateV1
    vi.spyOn(commands, 'reviewTtrpgOpenOracleCandidateV1').mockImplementationOnce(async input => { await original(input); throw new Error('ORACLE-DESK-REVIEW-RETURN-CUT') })
    await expect(reviewTtrpgOpenOracleModelDeskV1(s.review)).rejects.toThrow('ORACLE-DESK-REVIEW-RETURN-CUT')
    const count = await db.productRuntimeEvents.count()
    await reviewTtrpgOpenOracleModelDeskV1(s.review)
    expect(await db.productRuntimeEvents.count()).toBe(count)
    await expect(reviewTtrpgOpenOracleModelDeskV1({ ...s.review, choices: [{ proposalIndex: 0, decision: 'discard', reason: '试图更换已保存选择' }] })).rejects.toThrow()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
  })
  it('records unknown and closes before stopping the original wait; a late answer cannot become a fact or a replacement request', async () => {
    const s = await setup(); let key = '', release!: () => void, sent!: () => void
    const held = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { sent = r })
    const sends = vi.fn(async () => { sent(); await held; return s.output })
    const work = requestTtrpgOpenOracleModelDeskV1({ ...s.command, runAI: sends, onPrepared: value => { key = value } }).catch(error => error)
    await started
    await finishTtrpgOpenOracleModelDeskV1({ ...s.owner, requestKey: key, decision: 'discard-this-oracle-instance-request-and-close-window' })
    const stopped = await readProductRuntimeState(s.f.sessionId)
    expect(stopped.ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'unknown', usage: { source: 'unknown', actualCostUsd: null } })
    expect(stopped.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    release(); await work
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(stopped); expect(sends).toHaveBeenCalledOnce(); expect(await db.agentRuns.count()).toBe(1)
  })
  it('closes a real empty window after local Run storage fails, while retaining its original saved authorization', async () => {
    const s = await setup(), sends = vi.fn(async () => s.output), cut = vi.spyOn(db.agentRuns, 'add').mockRejectedValueOnce(new Error('ORACLE-DESK-LOCAL-RUN-CUT'))
    await expect(requestTtrpgOpenOracleModelDeskV1({ ...s.command, runAI: sends })).rejects.toThrow('ORACLE-DESK-LOCAL-RUN-CUT'); cut.mockRestore()
    const page = await readTtrpgOpenOracleModelDeskV1(s.owner)
    expect(page!.request).toBeNull(); expect(page!.canRequest).toBe(false); expect(page!.closeWindowEpochKey).toBeTruthy()
    await closeTtrpgOpenOracleModelWindowDeskV1({ ...s.owner, epochKey: page!.closeWindowEpochKey!, decision: 'close-this-original-oracle-window' })
    expect(sends).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.epochs.at(-1)!.status).toBe('closed')
  })
  it('rejects changed source, sequence, cost and missing model before opening any new window or Run', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), sends = vi.fn(async () => s.output)
    for (const patch of [{ expectedSequence: s.page.sequence - 1 }, { snapshotHash: '0'.repeat(64) }, { maximumCostUsd: s.page.maximumCostUsd + 0.1 }, { oracleSourceRef: s.state.ttrpg!.openRun!.oracleReceipts![0].sourceRef }]) {
      await expect(requestTtrpgOpenOracleModelDeskV1({ ...s.command, ...patch, runAI: sends })).rejects.toThrow(/变化/)
    }
    await expect(requestTtrpgOpenOracleModelDeskV1(s.command)).rejects.toThrow(/配置/)
    expect(sends).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
  it('retains imported history without turning remapped Runs into a resume, review or repair authority', async () => {
    const s = await requested(), projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const read = { scope, sessionId: session.id!, viewerKey: s.owner.viewerKey, requestKey: s.read.requestKey }
    const before = await readProductRuntimeState(read.sessionId), page = await readTtrpgOpenOracleModelDeskV1(read), sends = vi.fn(async () => s.output)
    expect(page!.request).toMatchObject({ local: false, canResume: false, canReview: false, canRepairResponse: false, canRepairReview: false, canFinish: false })
    await expect(resumeTtrpgOpenOracleModelDeskV1({ ...read, runAI: sends })).rejects.toThrow(/历史|本地/)
    await expect(reviewTtrpgOpenOracleModelDeskV1({ ...s.review, ...read })).rejects.toThrow(/历史|本地/)
    await expect(repairTtrpgOpenOracleModelDeskV1(read)).rejects.toThrow(/历史|本地/)
    expect(await readProductRuntimeState(read.sessionId)).toEqual(before); expect(sends).not.toHaveBeenCalled()
  })
  it.each(['model.responded', 'candidate.persisted', 'confirmation.recorded', 'run.cancelled'] as const)('repairs the actual original %s cut through the desk without another request or changed fact decision', async cut => {
    const s = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents), sends = vi.fn(async () => s.output)
    let key = ''
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === cut) throw new Error('ORACLE-DESK-RECEIPT-CUT:' + cut)
      return add(...args)
    })
    const work = requestTtrpgOpenOracleModelDeskV1({ ...s.command, runAI: sends, onPrepared: value => { key = value } })
    if (cut === 'model.responded' || cut === 'candidate.persisted') await expect(work).rejects.toThrow()
    else {
      await work
      const read = { ...s.owner, requestKey: key }, candidate = (await readTtrpgOpenOracleModelDeskV1(read))!.request!.candidate!
      if (cut === 'confirmation.recorded') await expect(reviewTtrpgOpenOracleModelDeskV1({ ...read, candidateHash: candidate.candidateHash,
        interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }], decision: 'reviewed-this-original-oracle-candidate' })).rejects.toThrow(/确认已提交/)
      else await expect(finishTtrpgOpenOracleModelDeskV1({ ...read, decision: 'discard-this-oracle-instance-request-and-close-window' })).rejects.toThrow('ORACLE-DESK-RECEIPT-CUT:run.cancelled')
    }
    spy.mockRestore()
    const read = { ...s.owner, requestKey: key }, page = await readTtrpgOpenOracleModelDeskV1(read)
    expect(page!.request!.canRepairResponse || page!.request!.canRepairReview || page!.request!.canRepairStop).toBe(true)
    const before = await readProductRuntimeState(s.f.sessionId)
    await repairTtrpgOpenOracleModelDeskV1(read)
    const after = await readProductRuntimeState(s.f.sessionId), repaired = (await readTtrpgOpenOracleModelDeskV1(read))!.request!
    expect(repaired.canRepairResponse || repaired.canRepairReview || repaired.canRepairStop).toBe(false)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    expect(after.ttrpg!.openRun!.coordination.calls).toHaveLength(1); expect(await db.agentRuns.count()).toBe(1); expect(sends).toHaveBeenCalledOnce()
  })
})
