import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleModelV1 as setup } from '../helpers/open-common-oracle-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenCommonOracleCandidateV1, executeTtrpgOpenCommonOracleRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenCommonOracleCandidateV1 } from '../../src/lib/ttrpg/open-common-oracle-candidate'
import { readTtrpgOpenOracleCandidateV1 } from '../../src/lib/ttrpg/open-oracle-candidate'
import { reviewTtrpgOpenCommonOracleCandidateV1, commitTtrpgOpenCommonOracleCandidateFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { reviewTtrpgOpenOracleCandidateV1, commitTtrpgOpenOracleCandidateFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TtrpgOpenOracleFactProposalV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import * as gm from '../../src/lib/ttrpg/open-gm-oracle-context'
import { closeTtrpgOpenReviewedCommonOracleWindowV1 } from '../../src/lib/ttrpg/open-common-oracle-close'
import { finishTtrpgOpenCommonOracleDraftV1 } from '../../src/lib/ttrpg/open-runtime-draft-stop'

function fact(s: Awaited<ReturnType<typeof setup>>, audience: 'public' | 'party'): TtrpgOpenOracleFactProposalV1 {
  return { kind: 'relation', subjectRef: audience === 'party' ? s.npc : 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
    detail: '仅是本次共同原结果支持的事实候选，另待真人确认。', sourceFactRefs: [], audience, knownByActorKeys: audience === 'party' ? s.grant.basis.recipientActorKeys : [], supersedes: null, supersedeReason: null }
}
describe('R-TTRPGOPEN14 independent common Oracle model candidate and explicit semantic owner confirmation', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  for (const audience of ['party', 'public'] as const) it(`sends the original ${audience} request once, retains an independent unconfirmed candidate and confirms an actual fact without any GM source or mechanical mutation`, async () => {
    const s = await setup(audience), before = await readProductRuntimeState(s.f.sessionId), proposal = fact(s, audience), privateRead = vi.spyOn(gm, 'loadTtrpgOpenGmOracleContextV1')
    let sends = 0
    const output = JSON.stringify({ interpretation: '按本次原 Oracle 解释共同结果。', facts: [proposal] })
    const generated = await generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async (messages, _signal, result) => {
      sends++; expect(JSON.stringify(messages)).not.toContain('COMMON-ORACLE-GM-'); result.usage = { inputTokens: 1000, outputTokens: 200 }; return output
    } })
    expect(sends).toBe(1); expect(generated.candidate.schema).toBe('storyforge.ttrpg-open-common-oracle-candidate'); expect(generated.candidate.basisHash).toBe(s.grant.basisHash)
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings'); expect(generated.candidate.facts).toEqual([proposal])
    expect(Object.keys(generated.prepared).sort()).toEqual(['requestKey', 'runId'])
    for (const secret of ['COMMON-ORACLE-GM-', 'COMMON-ORACLE-PRIVATE-', 'COMMON-ORACLE-FULL-', 'frozenContentJson', 'frozenWorldPredicateIndex', 'fact.private.common.oracle', 'operationKey']) expect(JSON.stringify(generated)).not.toContain(secret)
    const unconfirmed = await readProductRuntimeState(s.f.sessionId)
    expect(unconfirmed.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger); expect(unconfirmed.entities).toEqual(before.entities)
    expect(await readTtrpgOpenCommonOracleCandidateV1(s.read)).toEqual(generated.candidate)
    await expect(readTtrpgOpenOracleCandidateV1(s.read)).rejects.toThrow(/冻结 Skill|入口/)
    expect(await executeTtrpgOpenCommonOracleRequestV1({ ...s.read, runAI: async () => { sends++; return output } })).toEqual({ status: 'not-sent' })
    const review = { ...s.read, ...await openEnvelopeV1(s.f.sessionId, 'common.model.review'), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
    await expect(reviewTtrpgOpenOracleCandidateV1(review)).rejects.toThrow(/独立审阅入口/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(unconfirmed)
    const reviewed = await reviewTtrpgOpenCommonOracleCandidateV1(review)
    expect(Object.keys(reviewed)).toEqual(['sequence']); expect(await reviewTtrpgOpenCommonOracleCandidateV1(review)).toEqual(reviewed)
    const state = await readProductRuntimeState(s.f.sessionId), entries = state.ttrpg!.openRun!.factLedger!.entries
    expect(entries).toHaveLength(1); expect(entries[0].modelCandidate?.requestKey).toBe(s.read.requestKey); expect(entries[0].fact.audience).toBe(audience)
    if (audience === 'party') expect(entries[0].runtimeEntityReferences!.references.map(row => row.entityRef)).toContain(s.npc)
    else expect(entries[0].runtimeEntityReferences).toBeUndefined()
    expect(state.entities).toEqual(before.entities); expect(state.ttrpg!.product).toEqual(before.ttrpg!.product); expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    const snapshot = await readInstanceAgentRunV1(s.f.scope, s.read.runId)
    expect(snapshot.projection.state).toBe('completed'); expect(snapshot.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(snapshot.events.filter(row => row.type === 'model.requested')).toHaveLength(1); expect(await db.agentRuns.count()).toBe(1); expect(sends).toBe(1); expect(privateRead).not.toHaveBeenCalled()
    await expect(finishTtrpgOpenCommonOracleDraftV1({ ...s.read, decision: 'discard-this-common-oracle-request-and-close-window' })).rejects.toThrow(/已明确审阅|已.*确认/)
    const close = { ...s.owner, epochKey: s.grant.epochKey, decision: 'close-this-reviewed-common-oracle-window' as const }
    const closed = await closeTtrpgOpenReviewedCommonOracleWindowV1(close)
    expect(await closeTtrpgOpenReviewedCommonOracleWindowV1(close)).toEqual(closed)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect((await readInstanceAgentRunV1(s.f.scope, s.read.runId)).projection.state).toBe('completed')
  })
  it('supports one explicit fact confirmation through the same existing fact owner with original instance proof', async () => {
    const s = await setup(), generated = await generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => JSON.stringify({ interpretation: '明确审阅一条。', facts: [fact(s, 'party')] }) })
    const input = { ...s.read, ...await openEnvelopeV1(s.f.sessionId, 'common.model.one.fact'), candidateHash: generated.candidate.candidateHash, proposalIndex: 0, decision: 'assert' as const }
    await expect(commitTtrpgOpenOracleCandidateFactV1(input)).rejects.toThrow(/独立确认入口/)
    const committed = await commitTtrpgOpenCommonOracleCandidateFactV1(input)
    expect(Object.keys(committed)).toEqual(['sequence']); expect(await commitTtrpgOpenCommonOracleCandidateFactV1(input)).toEqual(committed)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect((await readInstanceAgentRunV1(s.f.scope, s.read.runId)).projection.state).toBe('completed')
  })
  it('retains raw output but blocks mechanical facts, private recipients and invented player knowledge', async () => {
    for (const change of [{ predicateKey: 'located-at', canonicalValue: 'harbor' }, { audience: 'gm-only', knownByActorKeys: [] }, { subjectRef: 'hero' }]) {
      await db.delete(); await db.open()
      const s = await setup(), output = JSON.stringify({ interpretation: '此提案必须受阻。', facts: [{ ...fact(s, 'party'), ...change }] })
      const generated = await generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => output })
      expect(generated.candidate.artifact.status).toBe('blocked'); expect(generated.candidate.facts).toBeNull()
      const state = await readProductRuntimeState(s.f.sessionId)
      await expect(reviewTtrpgOpenCommonOracleCandidateV1({ ...s.read, ...await openEnvelopeV1(s.f.sessionId, 'common.model.invalid.review'), candidateHash: generated.candidate.candidateHash,
        interpretationDecision: 'accept', interpretationReason: null, choices: [] })).rejects.toThrow()
      expect(await readProductRuntimeState(s.f.sessionId)).toEqual(state)
      expect((await readInstanceAgentRunV1(s.f.scope, s.read.runId)).events.some(row => row.type === 'model.responded')).toBe(true)
    }
  })
})
