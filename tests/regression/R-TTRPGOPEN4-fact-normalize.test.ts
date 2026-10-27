import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1,openEnvelopeV1,OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1,closeTtrpgOpenEpochV1,consultTtrpgOracleV1,reviewTtrpgOpenOracleCandidateV1,completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { generateTtrpgOpenOracleCandidateV1,generateTtrpgOpenFactNormalizationCandidateV1,executeTtrpgOpenFactNormalizationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState,readProductRuntimeStateVersion,branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenFactNormalizationCandidateV1 } from '../../src/lib/ttrpg/open-oracle-candidate'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { prepareTtrpgOpenFactNormalizationInputV1,prepareTtrpgOpenOracleInputV1,prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { exportProjectJSON,importProjectJSON } from '../../src/lib/export/json-export'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

const fact = { kind: 'relation',subjectRef: 'keeper',predicateKey: 'promised',objectRef: 'harbor',canonicalValue: '提供地图',detail: '守灯人承诺提供地图。',
  sourceFactRefs: ['fact.harbor'],audience: 'party',knownByActorKeys: ['hero','companion.1','companion.2'],supersedes: null,supersedeReason: null }
async function setup(discardFact = false,rejectInterpretation = false) {
  const fixture = await readyOpenTtrpgSessionV1('fact normalization',pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true })
  const rawInput = '咨询守灯人的帮助'
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput })
  await consultTtrpgOracleV1({ ...await openEnvelopeV1(fixture.sessionId,'oracle'),viewerKey: OPEN_HUMAN_VIEWER,
    askedBy: 'player:hero',oracleKey: 'oracle.yes',question: '守灯人会提供地图吗？',likelihoodTierKey: 'even' })
  const state = await readProductRuntimeState(fixture.sessionId)
  const oracle = await generateTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(fixture.sessionId,'interpret'),scope: fixture.scope,viewerKey: OPEN_HUMAN_VIEWER,
    rawInput,oracleSourceRef: state.ttrpg!.openRun!.oracleReceipts![0].sourceRef,maximumOutputTokens: 1000,maximumCostUsd: 0.2,
    runAI: async () => JSON.stringify({ interpretation: '守灯人承诺向调查者提供地图。',facts: discardFact ? [fact] : [] }) })
  await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(fixture.sessionId,'review'),viewerKey: OPEN_HUMAN_VIEWER,runId: oracle.prepared.runId,
    requestKey: oracle.prepared.requestKey,candidateHash: oracle.candidate.candidateHash,interpretationDecision: rejectInterpretation ? 'reject' : 'accept',
    interpretationReason: rejectInterpretation ? '不采用这个解释' : null,choices: discardFact ? [{ proposalIndex: 0,decision: 'discard',reason: '不采用这条承诺' }] : [] })
  const reviewed = await readProductRuntimeState(fixture.sessionId),review = reviewed.ttrpg!.openRun!.oracleReviews![0]
  await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'close'),viewerKey: OPEN_HUMAN_VIEWER,
    epochKey: reviewed.ttrpg!.openRun!.coordination.activeEpochKey!,reason: '解释已完成审阅' })
  const normalizeInput = '把已经确认的解释归一为事实提案'
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'normalize.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: normalizeInput })
  const input = { ...await openEnvelopeV1(fixture.sessionId,'normalize'),scope: fixture.scope,viewerKey: OPEN_HUMAN_VIEWER,rawInput: normalizeInput,
    reviewSourceRef: review.sourceRef,maximumOutputTokens: 1000,maximumCostUsd: 0.2 }
  const resume = (prepared: { runId: number;requestKey: string }) => ({ scope: fixture.scope,sessionId: fixture.sessionId,viewerKey: OPEN_HUMAN_VIEWER,...prepared })
  return { fixture,review,input,resume }
}
describe('R-TTRPGOPEN4 formal normalization of a genuinely accepted interpretation',() => {
  beforeEach(async () => { await db.delete();await db.open() })
  afterEach(() => { vi.restoreAllMocks();db.close() })
  it('reads exactly the contract, original Oracle and accepted review under a distinct frozen Skill',async () => {
    const { fixture,review,input } = await setup()
    const prepared = await prepareTtrpgOpenFactNormalizationInputV1({ ...input,modelIdentity: { provider: 'test-adapter',model: 'injected' } })
    const sessionKey = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.sessionKey
    const prefix = `fact:ttrpg-open:${sessionKey}:gm:`
    expect(prepared.evidence.selector.selected.map(row => [row.sourceKey,row.resourceKey]).sort()).toEqual([
      ['ttrpgOpenGmOracleInput',`${prefix}gm-oracle-contract`],
      ['ttrpgOpenGmOracleInput',`${prefix}oracle.${await hashProductProductionValueV2(review.oracleSourceRef)}`],
      ['ttrpgOpenGmOracleInput',`${prefix}review.${await hashProductProductionValueV2(review.sourceRef)}`],
      ['ttrpgOpenGmContext',`${prefix}context-contract.gm-assistant`],
    ].sort())
    const snapshot = await readInstanceAgentRunV1(fixture.scope,prepared.runId)
    expect(snapshot.contract.executionBindings![0].skillId).toBe('prose.ttrpg-open-fact-normalize')
    const call = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[1]
    expect(call.supportSlot).toMatchObject({ sourceRef: review.sourceRef,sourceHash: review.reviewHash,purpose: 'fact-normalize',worldTurn: 0 })
    expect(JSON.stringify(prepared.messages)).toContain(review.interpretation)
    expect(JSON.stringify(prepared.messages)).not.toContain('seedCommitment')
  })
  it('retains raw normalization, restores the same candidate and requires separate human adoption',async () => {
    const { fixture,review,input,resume } = await setup(),before = await readProductRuntimeState(fixture.sessionId),runAI = vi.fn(async () => JSON.stringify({ facts: [fact] }))
    const generated = await generateTtrpgOpenFactNormalizationCandidateV1({ ...input,runAI })
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
    expect(generated.candidate.interpretation).toBe(review.interpretation)
    expect(generated.candidate.normalizationOf).toEqual({ sourceRef: review.sourceRef,reviewHash: review.reviewHash })
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.factLedger).toBeUndefined()
    db.close();await db.open()
    expect(await readTtrpgOpenFactNormalizationCandidateV1(resume(generated.prepared))).toEqual(generated.candidate)
    expect(await executeTtrpgOpenFactNormalizationRequestV1({ ...resume(generated.prepared),runAI })).toEqual({ status: 'not-sent' })
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(fixture.sessionId,'accept.normalized'),viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept',interpretationReason: null,choices: [{ proposalIndex: 0,decision: 'adopt',reason: null }] })
    const after = await readProductRuntimeState(fixture.sessionId)
    expect(after.ttrpg!.openRun!.factLedger!.entries[0].modelCandidate!.normalizationOf).toEqual(generated.candidate.normalizationOf)
    expect(after.ttrpg!.openRun!.oracleReceipts).toEqual(before.ttrpg!.openRun!.oracleReceipts)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect((await readInstanceAgentRunV1(fixture.scope,generated.prepared.runId)).projection.state).toBe('completed')
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it.each(['not-json',JSON.stringify({ facts: [fact],interpretation: '换一种解释' }),JSON.stringify({ facts: [{ ...fact,predicateKey: 'owns' }] })])('keeps invalid or overreaching output for manual repair without another model call (%s)',async raw => {
      const { input } = await setup(),runAI = vi.fn(async () => raw)
      const generated = await generateTtrpgOpenFactNormalizationCandidateV1({ ...input,runAI })
      expect(generated.candidate.artifact.status).toBe('manual-repair')
      expect(generated.candidate.facts).toBeNull()
      expect(generated.candidate.artifact.originalText).toBe(raw)
      expect(runAI).toHaveBeenCalledTimes(1)
    })
  it('cannot revive a fact explicitly discarded from the accepted explanation',async () => {
    const { input } = await setup(true)
    const generated = await generateTtrpgOpenFactNormalizationCandidateV1({ ...input,runAI: async () => JSON.stringify({ facts: [{ ...fact,detail: '用不同文字重新描述同一承诺' }] }) })
    expect(generated.candidate.artifact.status).toBe('manual-repair')
    expect(generated.candidate.facts).toBeNull()
  })
  it('refuses rejected or fabricated source reviews before reserving any additional Run',async () => {
    const { fixture,input } = await setup(false,true),before = await db.agentRuns.count()
    await expect(prepareTtrpgOpenFactNormalizationInputV1({ ...input,modelIdentity: { provider: 'test-adapter',model: 'injected' } })).rejects.toThrow(/已接受/)
    await expect(prepareTtrpgOpenFactNormalizationInputV1({ ...input,reviewSourceRef: { ...input.reviewSourceRef,sequence: 1 },modelIdentity: { provider: 'test-adapter',model: 'injected' } })).rejects.toThrow(/已接受/)
    expect(await db.agentRuns.count()).toBe(before)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls).toHaveLength(1)
  })
  it('does not reset its assistance slot through a new epoch or a fresh child authorization',async () => {
    const { fixture,input } = await setup(),runAI = vi.fn(async () => JSON.stringify({ facts: [fact] }))
    await generateTtrpgOpenFactNormalizationCandidateV1({ ...input,runAI })
    const parent = await readProductRuntimeState(fixture.sessionId)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'close.norm'),viewerKey: OPEN_HUMAN_VIEWER,
      epochKey: parent.ttrpg!.openRun!.coordination.activeEpochKey!,reason: '查看已有候选' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'next.norm'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: input.rawInput })
    await expect(generateTtrpgOpenFactNormalizationCandidateV1({ ...input,...await openEnvelopeV1(fixture.sessionId,'again'),runAI })).rejects.toThrow(/辅助槽/)
    const child = await branchProductRuntimeSession({ parentSessionId: fixture.sessionId,
      throughSequence: (await readProductRuntimeStateVersion(fixture.sessionId)).sequence,title: 'normalization child',seed: 'norm.child' })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!,'zero'),viewerKey: OPEN_HUMAN_VIEWER,
      acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys,selectedCharacterKeys: ['hero','companion.1','companion.2'] })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(child.id!,'epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput: input.rawInput })
    await expect(generateTtrpgOpenFactNormalizationCandidateV1({ ...input,...await openEnvelopeV1(child.id!,'child.again'),runAI })).rejects.toThrow(/辅助槽/)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('holds unknown transport results and refuses another send for the same request',async () => {
    const { fixture,input,resume } = await setup(),runAI = vi.fn(async () => { throw new Error('simulated normalization interruption') })
    await expect(generateTtrpgOpenFactNormalizationCandidateV1({ ...input,runAI })).rejects.toThrow(/interruption/)
    const call = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[1]
    expect(call.status).toBe('unknown')
    const run = await db.agentRuns.where('productRuntimeSessionId').equals(fixture.sessionId).filter(run => run.contractHash === call.runContractHash).first()
    expect(await executeTtrpgOpenFactNormalizationRequestV1({ ...resume({ runId: run!.id!,requestKey: call.requestKey }),runAI })).toEqual({ status: 'not-sent' })
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('preserves the original and normalized review chain through real project backup',async () => {
    const { fixture,input } = await setup()
    const generated = await generateTtrpgOpenFactNormalizationCandidateV1({ ...input,runAI: async () => JSON.stringify({ facts: [fact] }) })
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(fixture.sessionId,'adopt'),viewerKey: OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept',interpretationReason: null,choices: [{ proposalIndex: 0,decision: 'adopt',reason: null }] })
    const before = await readProductRuntimeState(fixture.sessionId)
    const projectId = await importProjectJSON(await exportProjectJSON(fixture.scope.projectId))
    const imported = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const restored = await readProductRuntimeState(imported!.id!)
    expect(restored.ttrpg!.openRun!.oracleReviews).toEqual(before.ttrpg!.openRun!.oracleReviews)
    expect(restored.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
  })
  it('rejects an ordinary player asking for human-GM private input, and rejects a GM asking for another human player intent',async () => {
    const fixture = await readyOpenTtrpgSessionV1('human GM request authority',pkg => {
      pkg.ttrpg!.campaign.gmMode = 'human';pkg.ttrpg!.campaign.runtimePolicy.enabled = true;pkg.ttrpg!.rulePack.content.oracles[0].audience = 'gm-only'
    })
    const rawInput = '主持人解释秘密咨询'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'gm.epoch'),viewerKey: 'viewer.gm',triggerKind: 'continue-host',rawInput })
    await consultTtrpgOracleV1({ ...await openEnvelopeV1(fixture.sessionId,'gm.oracle'),viewerKey: 'viewer.gm',askedBy: 'gm',oracleKey: 'oracle.yes',
      question: '守灯人的秘密会影响调查吗？',likelihoodTierKey: 'even' })
    const current = await readProductRuntimeState(fixture.sessionId)
    const oracle = await generateTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(fixture.sessionId,'gm.generate'),scope: fixture.scope,viewerKey: 'viewer.gm',
      rawInput,oracleSourceRef: current.ttrpg!.openRun!.oracleReceipts![0].sourceRef,maximumOutputTokens: 1000,maximumCostUsd: 0.2,
      runAI: async () => JSON.stringify({ interpretation: 'GM-ONLY-ACCEPTED-INTERPRETATION',facts: [] }) })
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(fixture.sessionId,'gm.accept'),viewerKey: 'viewer.gm',runId: oracle.prepared.runId,
      requestKey: oracle.prepared.requestKey,candidateHash: oracle.candidate.candidateHash,interpretationDecision: 'accept',interpretationReason: null,choices: [] })
    const reviewed = await readProductRuntimeState(fixture.sessionId)
    await expect(prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(fixture.sessionId,'gm.impersonate'),scope: fixture.scope,viewerKey: 'viewer.gm',actorKey: 'hero',
      rawInput,modelIdentity: { provider: 'test-adapter',model: 'injected' },maximumOutputTokens: 1000,maximumCostUsd: 0.2 })).rejects.toThrow(/其他真人/)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'gm.close'),viewerKey: 'viewer.gm',
      epochKey: reviewed.ttrpg!.openRun!.coordination.activeEpochKey!,reason: 'GM 审阅完成' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId,'player.epoch'),viewerKey: OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput })
    const before = await db.agentRuns.count(),base = { ...await openEnvelopeV1(fixture.sessionId,'player.private'),scope: fixture.scope,viewerKey: OPEN_HUMAN_VIEWER,
      rawInput,modelIdentity: { provider: 'test-adapter',model: 'injected' },maximumOutputTokens: 1000,maximumCostUsd: 0.2 }
    await expect(prepareTtrpgOpenFactNormalizationInputV1({ ...base,reviewSourceRef: reviewed.ttrpg!.openRun!.oracleReviews![0].sourceRef })).rejects.toThrow(/真人 GM/)
    await expect(prepareTtrpgOpenOracleInputV1({ ...base,oracleSourceRef: current.ttrpg!.openRun!.oracleReceipts![0].sourceRef })).rejects.toThrow(/真人 GM/)
    expect(await db.agentRuns.count()).toBe(before)
  })
})
