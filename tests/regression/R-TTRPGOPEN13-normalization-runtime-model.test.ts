import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupNormalizationRuntimeModelV1 as setup, setupNormalizationRuntimeSourceV1 } from '../helpers/open-normalization-runtime-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenFactNormalizationCandidateV2, executeTtrpgOpenFactNormalizationRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { prepareTtrpgOpenFactNormalizationInputV1, prepareTtrpgOpenOracleInputV2 } from '../../src/lib/ttrpg/open-intent-input'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { reviewTtrpgOpenOracleCandidateV1, commitTtrpgOpenOracleCandidateFactV1, closeTtrpgOpenEpochV1, startTtrpgOpenEpochV1,
  consultTtrpgOracleV1, commitTtrpgOpenOracleFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { evaluateTtrpgPredicateV1 } from '../../src/lib/ttrpg/predicate'
import { loadTtrpgOpenGmOracleContextV1 } from '../../src/lib/ttrpg/open-gm-oracle-context'
import { reviewTtrpgOpenNormalizationRuntimeDeliveryV1 } from '../../src/lib/ttrpg/open-oracle-runtime-delivery'
import { readTtrpgOpenFactNormalizationCandidateV1 } from '../../src/lib/ttrpg/open-oracle-candidate'
import { createTtrpgOpenNormalizationRuntimeReferencePolicyV1 } from '../../src/lib/ttrpg/open-runtime-entity-references'

describe('R-TTRPGOPEN13 actual accepted interpretation instance normalization', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it.each(['public', 'party', 'gm-only'] as const)('delivers only the exact %s original interpretation, keeps discard decisions and confirms a new semantic leaf once', async audience => {
    const s = await setup(audience), before = await readProductRuntimeState(s.f.sessionId), runs = await db.agentRuns.count()
    await expect(prepareTtrpgOpenFactNormalizationInputV1({ ...s.normalizationInput, rawInput: '旧入口不能扩权', modelIdentity: { provider: 'test-adapter', model: 'injected' } })).rejects.toThrow(/V2/)
    await expect(prepareTtrpgOpenOracleInputV2({ ...s.input, ...await openEnvelopeV1(s.f.sessionId, 'normalization.not.oracle'), modelIdentity: { provider: 'test-adapter', model: 'injected' } })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(runs)
    const sends = vi.fn(async (messages: Array<{ content: string }>) => {
      const text = JSON.stringify(messages)
      expect(text).toContain(s.review.interpretation); expect(text).toContain('discardedProposals'); expect(text).toContain(s.npc)
      expect(text).not.toContain('ORACLE-POLICY-PRIVATE-PROFILE'); expect(text).not.toContain('dynamicTemplateKey')
      expect(text).not.toContain(s.policy.oraclePolicy.references.references[0].planHash)
      if (audience !== 'gm-only') { expect(text).not.toContain(s.place); expect(text).not.toContain('.equipment.0') }
      return s.output
    })
    const generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput, runAI: sends }), resume = s.resume(generated.prepared)
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings'); expect(generated.candidate.interpretation).toBe(s.review.interpretation)
    expect(generated.candidate.normalizationOf).toEqual({ sourceRef: s.review.sourceRef, reviewHash: s.review.reviewHash })
    await expect(readTtrpgOpenFactNormalizationCandidateV1({ ...resume, viewerKey: 'viewer.seat.hero' })).rejects.toThrow()
    const pending = await readProductRuntimeState(s.f.sessionId)
    expect(pending.ttrpg!.openRun!.factLedger?.entries ?? []).toHaveLength(0); expect(pending.ttrpg!.openRun!.oracleReviews).toEqual(before.ttrpg!.openRun!.oracleReviews)
    const command = { ...await openEnvelopeV1(s.f.sessionId, 'normalization.instance.review'), ...resume, candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
    await reviewTtrpgOpenOracleCandidateV1(command); await reviewTtrpgOpenOracleCandidateV1(command)
    const after = await readProductRuntimeState(s.f.sessionId), run = after.ttrpg!.openRun!, entry = run.factLedger!.entries[0]
    expect(run.oracleReviews![0]).toEqual(s.review); expect(run.oracleReviews![1].interpretation).toBe(s.review.interpretation)
    expect(entry.modelCandidate).toMatchObject({ requestKey: generated.prepared.requestKey, normalizationOf: generated.candidate.normalizationOf })
    expect(entry.runtimeEntityReferences!.references.map(row => row.entityRef)).toContain(s.npc); expect(run.factLedger!.basis.entityReferences.map(row => row.entityRef)).not.toContain(s.npc)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(run.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(run.knowledge).toEqual(before.ttrpg!.openRun!.knowledge)
    expect(evaluateTtrpgPredicateV1({ op: 'session-fact', subjectRef: s.npc, predicateKey: 'knows', objectRef: s.normalizedFact.objectRef, value: false }, ttrpgOpenPredicateContextV1(after, s.f.runtimePackage.ttrpg!))).toBe(true)
    expect((await readInstanceAgentRunV1(s.f.scope, generated.prepared.runId)).projection.state).toBe('completed')
    await expect(createTtrpgOpenNormalizationRuntimeReferencePolicyV1({ ...s.source, runtime: after.ttrpg!, reviewSourceRef: run.oracleReviews![1].sourceRef,
      consumerRef: { sessionKey: after.ttrpg!.sessionKey, sequence: after.lastSequence + 1 } })).rejects.toThrow(/已接受|旧归一/)
    expect(await executeTtrpgOpenFactNormalizationRequestV1({ ...resume, runAI: sends })).toEqual({ status: 'not-sent' }); expect(sends).toHaveBeenCalledOnce()
  })
  it('does not revive the actually discarded tuple, widen the party source or accept a model rewritten interpretation', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), raw = JSON.stringify({ facts: [s.fact] })
    const generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput, runAI: async () => raw })
    expect(['blocked', 'manual-repair']).toContain(generated.candidate.artifact.status)
    expect(await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'raw-response', contentHash: generated.candidate.rawResponseHash })).toBe(raw)
    await expect(reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.revive.denied'), ...s.resume(generated.prepared),
      candidateHash: generated.candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })).rejects.toThrow()
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    expect(after.ttrpg!.openRun!.oracleReviews).toEqual(before.ttrpg!.openRun!.oracleReviews)
    const context = await loadTtrpgOpenGmOracleContextV1({ ...s.owner, actorKey: 'gm' }), snapshots = context.resources.map(row => ({ sourceKey: 'ttrpgOpenGmOracleInput', content: JSON.stringify(row.value) }))
    reviewTtrpgOpenNormalizationRuntimeDeliveryV1(s.policy, snapshots, s.review)
    for (const change of ['interpretation', 'discarded', 'scope', 'missing'] as const) {
      const bad = structuredClone(snapshots), index = bad.findIndex(row => JSON.parse(row.content).schema === 'storyforge.ttrpg-open-gm-fact-normalization-input'), value = JSON.parse(bad[index].content)
      if (change === 'interpretation') value.interpretation = '改写原解释'
      if (change === 'discarded') value.discardedProposals = []
      if (change === 'scope') value.runtimeIdentityScope.recipientActorKeys = ['unshared.actor']
      if (change === 'missing') bad.splice(index, 1); else bad[index].content = JSON.stringify(value)
      expect(() => reviewTtrpgOpenNormalizationRuntimeDeliveryV1(s.policy, bad, s.review)).toThrow()
    }
  })
  it('uses the original frozen basis for a frozen-only normalization fact and the single-proposal confirmation path', async () => {
    const s = await setup(), generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput,
      runAI: async () => JSON.stringify({ facts: [{ ...s.normalizedFact, subjectRef: 'keeper' }] }) })
    await commitTtrpgOpenOracleCandidateFactV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.frozen.single'), ...s.resume(generated.prepared),
      candidateHash: generated.candidate.candidateHash, proposalIndex: 0, decision: 'assert' })
    const entry = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries[0]
    expect(entry.runtimeEntityReferences).toBeUndefined(); expect(entry.modelCandidate!.normalizationOf?.reviewHash).toBe(s.review.reviewHash)
  })
  it('rolls back a real confirmation storage cut and consumes its support slot across closed/new windows', async () => {
    const s = await setup(), sends = vi.fn(async () => s.output), generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput, runAI: sends })
    const before = await readProductRuntimeState(s.f.sessionId), command = { ...await openEnvelopeV1(s.f.sessionId, 'normalization.storage.cut'), ...s.resume(generated.prepared),
      candidateHash: generated.candidate.candidateHash, interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('NORMALIZATION-REAL-STORAGE-CUT'))
    await expect(reviewTtrpgOpenOracleCandidateV1(command)).rejects.toThrow('NORMALIZATION-REAL-STORAGE-CUT'); cut.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await reviewTtrpgOpenOracleCandidateV1(command); await reviewTtrpgOpenOracleCandidateV1(command)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.reviewed.close'), viewerKey: s.owner.viewerKey, epochKey: generated.candidate.epochKey, reason: '原归一审阅完成' })
    await expect(startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.no.new.slot'), viewerKey: s.owner.viewerKey,
      triggerKind: 'continue-host', rawInput: '仅整理已选且已接受的原解释中的事实；原解释、弃用决定和原创建范围保持不变。', normalizationRuntimeReferencePolicy: s.policy })).rejects.toThrow(/最多|辅助槽/)
    expect(sends).toHaveBeenCalledOnce()
  })
  it('cannot use its passive normalization window for another consultation or an original human fact', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId)
    expect(before.ttrpg!.openRun!.coordination.epochs.at(-1)!.budget).toMatchObject({ maximumCalls: 1, maximumAiActions: 0 })
    await expect(consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.no.reroll'), viewerKey: s.owner.viewerKey, askedBy: 'gm',
      oracleKey: 'oracle.reference.scope', question: '不能借此再次咨询' })).rejects.toThrow(/只允许/)
    await expect(commitTtrpgOpenOracleFactV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.no.human.fact'), viewerKey: s.owner.viewerKey,
      oracleSourceRef: s.review.oracleSourceRef, proposal: s.fact, candidateHash: '0'.repeat(64) })).rejects.toThrow(/不能作为人类原创/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.agentRuns.count()).toBe(1)
  })
  it('denies a new V1 normalization of a new instance interpretation even in an ordinary old window, before creating another Run', async () => {
    const s = await setupNormalizationRuntimeSourceV1(), rawInput = '普通旧窗口不能把新版解释隐式转为新归一'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.no.implicit.upgrade'), viewerKey: s.owner.viewerKey, triggerKind: 'continue-host', rawInput })
    const state = await readProductRuntimeState(s.f.sessionId), runs = await db.agentRuns.count()
    await expect(prepareTtrpgOpenFactNormalizationInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'normalization.no.implicit.prepare'), ...s.owner, rawInput,
      reviewSourceRef: s.review.sourceRef, maximumOutputTokens: 1000, maximumCostUsd: 0.2, modelIdentity: { provider: 'test-adapter', model: 'injected' } })).rejects.toThrow(/明确 V2/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(state); expect(await db.agentRuns.count()).toBe(runs)
  })
  it.each(['contract', 'oracle', 'review'] as const)('rejects damaged actual %s full-source bytes before confirmation and repairs with the same original evidence', async source => {
    const s = await setup(), sends = vi.fn(async () => s.output), generated = await generateTtrpgOpenFactNormalizationCandidateV2({ ...s.normalizationInput, runAI: sends })
    const ref = generated.prepared.evidence.preflight.artifacts.find(row => row.role === 'source-snapshot' && row.sourceKey === 'ttrpgOpenGmOracleInput'
      && (source === 'contract' ? row.resourceKey?.endsWith(':gm-oracle-contract') : row.resourceKey?.includes(':' + source + '.')))!
    const row = (await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.f.scope.projectId, ref.artifactKind, ref.contentHash]).first())!
    const before = await readProductRuntimeState(s.f.sessionId), command = { ...await openEnvelopeV1(s.f.sessionId, 'normalization.exact.' + source), ...s.resume(generated.prepared),
      candidateHash: generated.candidate.candidateHash, interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
    await db.agentRunArtifacts.update(row.id!, { content: row.content + 'DAMAGED-ORIGINAL-NORMALIZATION-SOURCE' })
    await expect(reviewTtrpgOpenOracleCandidateV1(command)).rejects.toThrow(); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await db.agentRunArtifacts.update(row.id!, { content: row.content }); await reviewTtrpgOpenOracleCandidateV1(command)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1); expect(sends).toHaveBeenCalledOnce()
  })
})
