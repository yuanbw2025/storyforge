import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, consultTtrpgOracleV1, reviewTtrpgOpenOracleCandidateV1, commitTtrpgOpenOracleCandidateFactV1,
  completeTtrpgOpenSessionZeroV1, retireTtrpgOpenSessionFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenOracleCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState, readProductRuntimeStateVersion, branchProductRuntimeSession, applyProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import type { TtrpgOpenOracleFactProposalV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import * as adoption from '../../src/lib/ttrpg/open-oracle-adoption'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'

const fact: TtrpgOpenOracleFactProposalV1 = { kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
  detail: '守灯人知道港口情况。', sourceFactRefs: ['fact.harbor'], audience: 'party', knownByActorKeys: ['hero','companion.1','companion.2'], supersedes: null, supersedeReason: null }
const proposals = [fact, { ...fact,predicateKey: 'promised' as const,canonicalValue: '协助调查',detail: '守灯人愿意协助调查。' },
  { ...fact,predicateKey: 'promised' as const,objectRef: 'keeper',canonicalValue: '保持中立',detail: '守灯人承诺保持中立。' }]
async function setup(facts = proposals) {
  const fixture = await readyOpenTtrpgSessionV1('complete Oracle review', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true })
  const rawInput = '咨询并审阅守灯人的解释'
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput })
  await consultTtrpgOracleV1({ ...await openEnvelopeV1(fixture.sessionId,'oracle'),viewerKey: OPEN_HUMAN_VIEWER,
    askedBy: 'player:hero',oracleKey: 'oracle.yes',question: '守灯人会协助调查吗？',likelihoodTierKey: 'even' })
  const state = await readProductRuntimeState(fixture.sessionId),runAI = vi.fn(async () => JSON.stringify({ interpretation: '守灯人可提供调查帮助。',facts }))
  const generated = await generateTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(fixture.sessionId,'generate'),scope: fixture.scope,
    viewerKey: OPEN_HUMAN_VIEWER,rawInput,oracleSourceRef: state.ttrpg!.openRun!.oracleReceipts![0].sourceRef,maximumOutputTokens: 1000,maximumCostUsd: 0.2,runAI })
  expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
  const review = async () => ({ ...await openEnvelopeV1(fixture.sessionId,'review'),viewerKey: OPEN_HUMAN_VIEWER,runId: generated.prepared.runId,
    requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash,interpretationDecision: 'accept' as const,interpretationReason: null,
    choices: facts.map((_fact,proposalIndex) => ({ proposalIndex,decision: 'adopt' as const,reason: null })) })
  return { fixture,generated,runAI,review }
}
describe('R-TTRPGOPEN4 complete human Oracle interpretation review', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('adopts three proposals atomically with distinct IDs and one terminal receipt, preserving the raw Oracle and time', async () => {
    const { fixture,generated,runAI,review } = await setup(),before = await readProductRuntimeState(fixture.sessionId)
    const input = await review(),event = await reviewTtrpgOpenOracleCandidateV1(input)
    const after = await readProductRuntimeState(fixture.sessionId),run = after.ttrpg!.openRun!
    expect(run.factLedger!.entries).toHaveLength(3)
    expect(new Set(run.factLedger!.entries.map(entry => entry.fact.factKey)).size).toBe(3)
    expect(run.factLedger!.entries.every(entry => entry.sourceRef.sequence === event.sequence)).toBe(true)
    expect(run.oracleReviews![0].adoptedFactKeys).toEqual(run.factLedger!.entries.map(entry => entry.fact.factKey))
    expect(run.oracleReceipts).toEqual(before.ttrpg!.openRun!.oracleReceipts)
    expect(run.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.entities).toEqual(before.entities)
    expect(await reviewTtrpgOpenOracleCandidateV1({ ...input,...await openEnvelopeV1(fixture.sessionId,'repeat') })).toEqual(event)
    expect((await readInstanceAgentRunV1(fixture.scope,generated.prepared.runId)).projection.state).toBe('completed')
    db.close();await db.open()
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(after)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('keeps explicit reasons for discarded proposals and refuses omitting or changing a choice', async () => {
    const { fixture,review } = await setup(),before = await readProductRuntimeState(fixture.sessionId),input = await review()
    await expect(reviewTtrpgOpenOracleCandidateV1({ ...input,choices: input.choices.slice(0,1) })).rejects.toThrow(/全部提案/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    const choices = [{ proposalIndex: 0,decision: 'adopt' as const,reason: null },{ proposalIndex: 1,decision: 'discard' as const,reason: '尚无充分支持' },
      { proposalIndex: 2,decision: 'discard' as const,reason: '不采用这一解释' }]
    await reviewTtrpgOpenOracleCandidateV1({ ...input,choices })
    const after = await readProductRuntimeState(fixture.sessionId)
    expect(after.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect(after.ttrpg!.openRun!.oracleReviews![0].choices).toEqual(choices)
    await expect(reviewTtrpgOpenOracleCandidateV1({ ...input,...await openEnvelopeV1(fixture.sessionId,'change') })).rejects.toThrow(/一致|变化|不同/)
  })
  it('rejects a contradictory batch entirely, without keeping the earlier valid selected fact', async () => {
    const { fixture,review } = await setup([fact,{ ...fact,canonicalValue: false,detail: '守灯人不知道港口情况。' }])
    const before = await readProductRuntimeState(fixture.sessionId)
    await expect(reviewTtrpgOpenOracleCandidateV1(await review())).rejects.toThrow(/F3/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
  it('accepts narration with every fact discarded, without a fake empty fact ledger', async () => {
    const { fixture,generated,review } = await setup(),input = await review()
    await reviewTtrpgOpenOracleCandidateV1({ ...input,choices: input.choices.map(choice => ({ ...choice,decision: 'discard',reason: '仅保留叙事候选' })) })
    const state = await readProductRuntimeState(fixture.sessionId)
    expect(state.ttrpg!.openRun!.factLedger).toBeUndefined()
    expect(state.ttrpg!.openRun!.oracleReviews![0].adoptedFactKeys).toEqual([])
    expect((await readInstanceAgentRunV1(fixture.scope,generated.prepared.runId)).projection.state).toBe('completed')
    await expect(commitTtrpgOpenOracleCandidateFactV1({ ...await openEnvelopeV1(fixture.sessionId,'bypass'),viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash,proposalIndex: 0,decision: 'assert' })).rejects.toThrow(/完整审阅/)
  })
  it('records a full rejection with reasons and a failed Run, never as an adopted or completed candidate', async () => {
    const { fixture,generated,review } = await setup(),input = await review()
    const event = await reviewTtrpgOpenOracleCandidateV1({ ...input,interpretationDecision: 'reject',interpretationReason: '解释不符合本团目标',
      choices: input.choices.map(choice => ({ ...choice,decision: 'discard',reason: '连同解释弃用' })) })
    const state = await readProductRuntimeState(fixture.sessionId),snapshot = await readInstanceAgentRunV1(fixture.scope,generated.prepared.runId)
    expect(event.type).toBe('ttrpg.open.oracle.reviewed')
    expect(state.ttrpg!.openRun!.factLedger).toBeUndefined()
    expect(snapshot.projection.state).toBe('failed')
    expect(snapshot.events.some(event => event.type === 'runtime.candidate.adopted' || event.type === 'verification.accepted')).toBe(false)
    expect(snapshot.events.some(event => event.type === 'confirmation.recorded' && event.payload.decision === 'reject')).toBe(true)
  })
  it('recovers a committed batch after a terminal interruption without repeating its facts', async () => {
    const { fixture,generated,review } = await setup(),input = await review()
    const interrupted = vi.spyOn(adoption,'reconcileTtrpgOpenOracleFactRunV1').mockRejectedValueOnce(new Error('simulated review receipt interruption'))
    await expect(reviewTtrpgOpenOracleCandidateV1(input)).rejects.toThrow(/interruption/)
    interrupted.mockRestore()
    const before = await readProductRuntimeState(fixture.sessionId)
    expect(before.ttrpg!.openRun!.factLedger!.entries).toHaveLength(3)
    await adoption.reconcileTtrpgOpenOracleFactRunV1({ scope: fixture.scope,sessionId: fixture.sessionId,viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash })
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
  it('rejects replay that changes a selected entry or silently drops a discarded proposal', async () => {
    const { fixture,review } = await setup(),before = await readProductRuntimeState(fixture.sessionId),event = await reviewTtrpgOpenOracleCandidateV1(await review())
    const payload = JSON.parse(event.payloadJson)
    payload.entries[0].fact.detail = '篡改已选内容'
    expect(() => applyProductRuntimeEvent(before,{ ...event,payloadJson: JSON.stringify(payload) })).toThrow(/提案/)
    const missing = JSON.parse(event.payloadJson);missing.review.choices.pop()
    expect(() => applyProductRuntimeEvent(before,{ ...event,payloadJson: JSON.stringify(missing) })).toThrow(/全部提案/)
  })
  it('preserves the full reviewed batch on a branch and backup, allowing only a fresh child withdrawal', async () => {
    const { fixture,review } = await setup()
    await reviewTtrpgOpenOracleCandidateV1(await review())
    const parent = await readProductRuntimeState(fixture.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: fixture.sessionId,
      throughSequence: (await readProductRuntimeStateVersion(fixture.sessionId)).sequence,title: 'review batch child',seed: 'review.child' })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!,'zero'),viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys,selectedCharacterKeys: ['hero','companion.1','companion.2'] })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!,'epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: '审阅继承的解释' })
    await retireTtrpgOpenSessionFactV1({ ...await openEnvelopeV1(child.id!,'withdraw'),viewerKey: OPEN_HUMAN_VIEWER,
      factKey: state.ttrpg!.openRun!.factLedger!.entries[0].fact.factKey,reason: '子分支撤回第一条解释' })
    expect((await readProductRuntimeState(child.id!)).ttrpg!.openRun!.oracleReviews).toEqual(parent.ttrpg!.openRun!.oracleReviews)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(parent)
    expect((await loadTtrpgOpenPlayerContextV1({ scope: fixture.scope,sessionId: child.id!,actorKey: 'hero' })).view.sessionFacts).toHaveLength(2)
    const importedProjectId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const imported = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray()
    const restored = await Promise.all(imported.map(session => readProductRuntimeState(session.id!)))
    expect(restored.every(state => JSON.stringify(state.ttrpg!.openRun!.oracleReviews) === JSON.stringify(parent.ttrpg!.openRun!.oracleReviews))).toBe(true)
  })
  it('creates distinct IDs for two values in the same predicate slot and rejects repeated indexes or missing discard reasons', async () => {
    const first = { ...fact,predicateKey: 'promised' as const,canonicalValue: '提供地图',detail: '守灯人承诺提供地图。' }
    const second = { ...first,canonicalValue: '提供油灯',detail: '守灯人承诺提供油灯。' }
    const { fixture,review } = await setup([first,second]),input = await review(),before = await readProductRuntimeState(fixture.sessionId)
    await expect(reviewTtrpgOpenOracleCandidateV1({ ...input,choices: [input.choices[0],input.choices[0]] })).rejects.toThrow(/全部提案/)
    await expect(reviewTtrpgOpenOracleCandidateV1({ ...input,choices: input.choices.map(choice => ({ ...choice,decision: 'discard',reason: null })) })).rejects.toThrow(/弃用必须有原因/)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
    await reviewTtrpgOpenOracleCandidateV1(input)
    const entries = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger!.entries
    expect(entries).toHaveLength(2)
    expect(entries[0].fact.factKey).not.toBe(entries[1].fact.factKey)
  })
})
