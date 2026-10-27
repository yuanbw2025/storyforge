import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupNormalizationRuntimeSourceV1 } from '../helpers/open-normalization-runtime-model'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenNormalizationModelDeskV1, requestTtrpgOpenNormalizationModelDeskV1, resumeTtrpgOpenNormalizationModelDeskV1,
  reviewTtrpgOpenNormalizationModelDeskV1, repairTtrpgOpenNormalizationModelDeskV1, finishTtrpgOpenNormalizationModelDeskV1,
  closeTtrpgOpenNormalizationModelWindowDeskV1 } from '../../src/lib/ttrpg/open-normalization-model-desk'
import { readTtrpgOpenOracleModelDeskV1 } from '../../src/lib/ttrpg/open-oracle-model-desk'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

async function setup() {
  const s = await setupNormalizationRuntimeSourceV1(), page = await readTtrpgOpenNormalizationModelDeskV1(s.owner)
  if (!page?.canRequest) throw new Error('expected available accepted-source normalization: ' + page?.unavailable)
  const selected = page.catalog.find(row => row.reviewHash === s.review.reviewHash)!
  const command = { ...s.owner, reviewSourceRef: selected.reviewSourceRef!, reviewHash: selected.reviewHash!, snapshotHash: selected.snapshotHash,
    expectedSequence: page.sequence, submissionKey: 'normalization.desk.request', decision: 'request-this-normalization-instance-candidate' as const, maximumCostUsd: 0.1 }
  return { ...s, page, selected, command, output: JSON.stringify({ facts: [s.normalizedFact] }) }
}
async function requested() {
  const s = await setup(), result = await requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, runAI: async () => s.output })
  const read = { ...s.owner, requestKey: result.requestKey }, page = await readTtrpgOpenNormalizationModelDeskV1(read)
  if (!page?.request?.candidate) throw new Error('expected original saved normalization candidate')
  const review = { ...read, candidateHash: page.request.candidate.candidateHash, decision: 'reviewed-this-original-normalization-candidate' as const,
    interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
  return { ...s, read, candidate: page.request.candidate, reviewInput: review }
}
describe('R-TTRPGOPEN13 actual human normalization desk and exact original request', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('reads the exact accepted source and discarded decisions without a new window or send, and denies another actual human', async () => {
    const s = await setup(), state = await readProductRuntimeState(s.f.sessionId), count = await db.productRuntimeEvents.count(), runs = await db.agentRuns.count()
    const page = await readTtrpgOpenNormalizationModelDeskV1(s.owner)
    expect(page!.catalog).toHaveLength(1); expect(page!.catalog[0].interpretation).toBe(s.review.interpretation)
    expect(page!.catalog[0].discarded).toEqual([{ detail: s.fact.detail, reason: s.review.choices[0].reason }])
    expect(page!.catalog[0].entities.map(row => row.name)).toEqual(['新守灯人'])
    expect(JSON.stringify(page!.catalog)).not.toMatch(/ORACLE-POLICY-PRIVATE-PROFILE|新候选地点|equipment|planHash|templateKey/)
    expect(await readTtrpgOpenNormalizationModelDeskV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER })).toBeNull()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(state); expect(await db.productRuntimeEvents.count()).toBe(count); expect(await db.agentRuns.count()).toBe(runs)
  })
  it('keeps the original accepted interpretation and stores new facts only after exact review, then closes separately', async () => {
    const s = await requested(), before = await readProductRuntimeState(s.f.sessionId), page = await readTtrpgOpenNormalizationModelDeskV1(s.read)
    expect(page!.request).toMatchObject({ canReview: true, canFinish: true, committed: false, source: { interpretation: s.review.interpretation } })
    expect(before.ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0)
    expect((await readTtrpgOpenOracleModelDeskV1(s.read))!.request).toBeNull()
    await reviewTtrpgOpenNormalizationModelDeskV1(s.reviewInput)
    const count = await db.productRuntimeEvents.count(); await reviewTtrpgOpenNormalizationModelDeskV1(s.reviewInput); expect(await db.productRuntimeEvents.count()).toBe(count)
    await expect(finishTtrpgOpenNormalizationModelDeskV1({ ...s.read, decision: 'discard-this-normalization-instance-request-and-close-window' })).rejects.toThrow(/确认|拒绝/)
    const done = await readTtrpgOpenNormalizationModelDeskV1(s.read)
    expect(done!.request).toMatchObject({ committed: true, canReview: false, canRepairReview: false, review: { adoptedCount: 1 } })
    await closeTtrpgOpenNormalizationModelWindowDeskV1({ ...s.owner, epochKey: done!.closeWindowEpochKey!, decision: 'close-this-original-normalization-window' })
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.oracleReviews![0]).toEqual(s.review); expect(after.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect(after.ttrpg!.openRun!.factLedger!.entries[0].modelCandidate?.normalizationOf?.reviewHash).toBe(s.review.reviewHash)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product)
  })
  it('resumes only its prepared original request after a return cut and never sends during reads', async () => {
    const s = await setup(), sends = vi.fn(async () => s.output); let key = ''
    await expect(requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, runAI: sends, onPrepared: value => { key = value; throw new Error('NORMALIZATION-DESK-PREPARED-CUT') } })).rejects.toThrow('NORMALIZATION-DESK-PREPARED-CUT')
    const read = { ...s.owner, requestKey: key }, before = await readProductRuntimeState(s.f.sessionId)
    for (let n = 0; n < 2; n++) expect((await readTtrpgOpenNormalizationModelDeskV1(read))!.request).toMatchObject({ status: 'prepared', canResume: true, observed: false })
    expect(sends).not.toHaveBeenCalled(); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await resumeTtrpgOpenNormalizationModelDeskV1({ ...read, runAI: sends })
    expect(sends).toHaveBeenCalledOnce(); expect(await db.agentRuns.count()).toBe(2)
    await expect(resumeTtrpgOpenNormalizationModelDeskV1({ ...read, runAI: sends })).rejects.toThrow(/不能继续/)
  })
  it('retains exact saved choices across a committed return cut and rejects changed retry intent', async () => {
    const s = await requested(), original = commands.reviewTtrpgOpenOracleCandidateV1
    vi.spyOn(commands, 'reviewTtrpgOpenOracleCandidateV1').mockImplementationOnce(async input => { await original(input); throw new Error('NORMALIZATION-DESK-RETURN-CUT') })
    await expect(reviewTtrpgOpenNormalizationModelDeskV1(s.reviewInput)).rejects.toThrow('NORMALIZATION-DESK-RETURN-CUT')
    const count = await db.productRuntimeEvents.count(); await reviewTtrpgOpenNormalizationModelDeskV1(s.reviewInput); expect(await db.productRuntimeEvents.count()).toBe(count)
    await expect(reviewTtrpgOpenNormalizationModelDeskV1({ ...s.reviewInput, choices: [{ proposalIndex: 0, decision: 'discard', reason: '不能改写已保存决定' }] })).rejects.toThrow()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.oracleReviews![0]).toEqual(s.review)
  })
  it('saves unknown and closes the original request before a late answer, preserving source, fees and facts', async () => {
    const s = await setup(); let key = '', entered!: () => void, release!: () => void
    const started = new Promise<void>(r => { entered = r }), held = new Promise<void>(r => { release = r })
    const sends = vi.fn(async () => { entered(); await held; return s.output })
    const work = requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, runAI: sends, onPrepared: value => { key = value } }).catch(error => error)
    await started
    await finishTtrpgOpenNormalizationModelDeskV1({ ...s.owner, requestKey: key, decision: 'discard-this-normalization-instance-request-and-close-window' })
    const stopped = await readProductRuntimeState(s.f.sessionId)
    expect(stopped.ttrpg!.openRun!.coordination.calls.at(-1)).toMatchObject({ status: 'unknown', usage: { actualCostUsd: null } })
    expect(stopped.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull(); expect(stopped.ttrpg!.openRun!.oracleReviews).toEqual(s.state.ttrpg!.openRun!.oracleReviews)
    release(); await work
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(stopped); expect(sends).toHaveBeenCalledOnce()
  })
  it('closes only its actual empty normalization window after local Run storage fails', async () => {
    const s = await setup(), sends = vi.fn(async () => s.output), cut = vi.spyOn(db.agentRuns, 'add').mockRejectedValueOnce(new Error('NORMALIZATION-DESK-LOCAL-RUN-CUT'))
    await expect(requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, runAI: sends })).rejects.toThrow('NORMALIZATION-DESK-LOCAL-RUN-CUT'); cut.mockRestore()
    const page = await readTtrpgOpenNormalizationModelDeskV1(s.owner)
    expect(page!.request).toBeNull(); expect(page!.closeWindowEpochKey).toBeTruthy()
    await closeTtrpgOpenNormalizationModelWindowDeskV1({ ...s.owner, epochKey: page!.closeWindowEpochKey!, decision: 'close-this-original-normalization-window' })
    expect(sends).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(1)
  })
  it('rejects changed review, snapshot, sequence, cost and missing model before opening a new window', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), sends = vi.fn(async () => s.output)
    for (const patch of [{ expectedSequence: s.page.sequence - 1 }, { reviewHash: '0'.repeat(64) }, { snapshotHash: '0'.repeat(64) }, { maximumCostUsd: s.page.maximumCostUsd + 0.1 },
      { reviewSourceRef: { ...s.command.reviewSourceRef, sequence: s.command.reviewSourceRef.sequence - 1 } }]) await expect(requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, ...patch, runAI: sends })).rejects.toThrow(/变化/)
    await expect(requestTtrpgOpenNormalizationModelDeskV1(s.command)).rejects.toThrow(/配置/)
    expect(sends).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(1); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
  it('allows a fresh authorized derivation from imported accepted history while denying old remapped normalization execution', async () => {
    const s = await setup(), projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } }), owner = { scope, sessionId: session.id!, viewerKey: s.owner.viewerKey }
    const page = await readTtrpgOpenNormalizationModelDeskV1(owner); expect(page!.canRequest).toBe(true)
    const sends = vi.fn(async () => s.output), result = await requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, ...owner, expectedSequence: page!.sequence, runAI: sends })
    const nextProjectId = await importProjectJSON(await exportProjectJSON(projectId)), nextSession = (await db.productRuntimeSessions.where('projectId').equals(nextProjectId).toArray())[0]
    const nextScope = await resolveScope({ scope: { projectId: nextProjectId, worldId: nextSession.worldId!, workId: nextSession.workId! } }), read = { scope: nextScope, sessionId: nextSession.id!, viewerKey: s.owner.viewerKey, requestKey: result.requestKey }
    expect((await readTtrpgOpenNormalizationModelDeskV1(read))!.request).toMatchObject({ local: false, canResume: false, canReview: false, canRepairResponse: false, canRepairReview: false, canFinish: false })
    const before = await readProductRuntimeState(read.sessionId)
    await expect(resumeTtrpgOpenNormalizationModelDeskV1({ ...read, runAI: sends })).rejects.toThrow(/历史|本地/)
    await expect(repairTtrpgOpenNormalizationModelDeskV1(read)).rejects.toThrow(/历史|本地/)
    expect(await readProductRuntimeState(read.sessionId)).toEqual(before); expect(sends).toHaveBeenCalledOnce()
  })
  it('selects the actual accepted ancestor through the desk after a real child authorization and parent deletion', async () => {
    const s = await setup(), state = await readProductRuntimeState(s.f.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: state.lastSequence, title: 'Normalization desk ancestor' })
    await commands.completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'normalization.desk.child.zero'), viewerKey: s.owner.viewerKey,
      acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: state.ttrpg!.authorization!.selectedActorKeys })
    await deleteProductRuntimeSession(s.f.sessionId)
    const owner = { ...s.owner, sessionId: child.id! }, page = await readTtrpgOpenNormalizationModelDeskV1(owner)
    expect(page!.canRequest).toBe(true); expect(page!.catalog.map(row => row.reviewSourceRef)).toEqual([s.review.sourceRef])
    const sends = vi.fn(async () => s.output), result = await requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, ...owner, expectedSequence: page!.sequence, runAI: sends })
    const read = { ...owner, requestKey: result.requestKey }, candidate = (await readTtrpgOpenNormalizationModelDeskV1(read))!.request!.candidate!
    await reviewTtrpgOpenNormalizationModelDeskV1({ ...read, candidateHash: candidate.candidateHash, decision: 'reviewed-this-original-normalization-candidate',
      interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    const after = await readProductRuntimeState(child.id!)
    expect(after.ttrpg!.openRun!.factLedger!.entries[0].modelCandidate?.normalizationOf?.sourceRef).toEqual(s.review.sourceRef)
    expect(after.entities).toEqual(state.entities); expect(sends).toHaveBeenCalledOnce()
  })
  it.each(['model.responded', 'candidate.persisted', 'confirmation.recorded', 'run.cancelled'] as const)('repairs the actual original normalization %s cut with no second send or changed source', async cut => {
    const s = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents), sends = vi.fn(async () => s.output); let key = ''
    const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => { if (args[0].type === cut) throw new Error('NORMALIZATION-DESK-RECEIPT-CUT:' + cut); return add(...args) })
    const work = requestTtrpgOpenNormalizationModelDeskV1({ ...s.command, runAI: sends, onPrepared: value => { key = value } })
    if (cut === 'model.responded' || cut === 'candidate.persisted') await expect(work).rejects.toThrow()
    else {
      await work
      const read = { ...s.owner, requestKey: key }, candidate = (await readTtrpgOpenNormalizationModelDeskV1(read))!.request!.candidate!
      if (cut === 'confirmation.recorded') await expect(reviewTtrpgOpenNormalizationModelDeskV1({ ...read, candidateHash: candidate.candidateHash,
        interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }], decision: 'reviewed-this-original-normalization-candidate' })).rejects.toThrow(/确认已提交/)
      else await expect(finishTtrpgOpenNormalizationModelDeskV1({ ...read, decision: 'discard-this-normalization-instance-request-and-close-window' })).rejects.toThrow('NORMALIZATION-DESK-RECEIPT-CUT:run.cancelled')
    }
    spy.mockRestore()
    const read = { ...s.owner, requestKey: key }, page = await readTtrpgOpenNormalizationModelDeskV1(read)
    expect(page!.request!.canRepairResponse || page!.request!.canRepairReview || page!.request!.canRepairStop).toBe(true)
    const before = await readProductRuntimeState(s.f.sessionId); await repairTtrpgOpenNormalizationModelDeskV1(read)
    const after = await readProductRuntimeState(s.f.sessionId), repaired = (await readTtrpgOpenNormalizationModelDeskV1(read))!.request!
    expect(repaired.canRepairResponse || repaired.canRepairReview || repaired.canRepairStop).toBe(false)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    expect(after.ttrpg!.openRun!.oracleReviews![0]).toEqual(s.review); expect(sends).toHaveBeenCalledOnce()
  })
})
