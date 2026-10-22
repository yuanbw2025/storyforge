import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOracleRuntimeModelV1 as setup } from '../helpers/open-oracle-runtime-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { reviewTtrpgOpenOracleCandidateV1, commitTtrpgOpenOracleCandidateFactV1, closeTtrpgOpenEpochV1,
  consultTtrpgOracleV1, commitTtrpgOpenOracleFactV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenOracleInputV1, prepareTtrpgOpenOracleInputV2 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenOracleCandidateV2, executeTtrpgOpenOracleRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { loadTtrpgOpenGmOracleContextV1 } from '../../src/lib/ttrpg/open-gm-oracle-context'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { ttrpgOpenSessionFactsV1 } from '../../src/lib/ttrpg/open-fact-ledger'
import { evaluateTtrpgPredicateV1 } from '../../src/lib/ttrpg/predicate'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import * as adoption from '../../src/lib/ttrpg/open-oracle-adoption'

describe('R-TTRPGOPEN13 actual versioned Oracle instance input/candidate/human confirmation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it.each(['public', 'party', 'gm-only'] as const)('delivers the exact %s scope, keeps the original model origin, confirms once and feeds the real predicate without creating or moving entities', async audience => {
    const s = await setup(audience), before = await readProductRuntimeState(s.f.sessionId)
    await expect(prepareTtrpgOpenOracleInputV1({ ...s.input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })).rejects.toThrow(/明确 V2/)
    expect(await db.agentRuns.count()).toBe(0)
    const runAI = vi.fn(async (messages: Array<{ content: string }>) => {
      const text = JSON.stringify(messages)
      expect(text).toContain(s.npc); expect(text).toContain('runtimeOrigin'); expect(text).not.toContain('ORACLE-POLICY-PRIVATE-PROFILE')
      expect(text).not.toContain('dynamicTemplateKey'); expect(text).not.toContain(s.policy.references.references[0].planHash)
      if (audience !== 'gm-only') { expect(text).not.toContain(s.place); expect(text).not.toContain('.equipment.0') }
      return JSON.stringify({ interpretation: '依据原咨询提出一条可审阅关系。', facts: [s.fact] })
    })
    const generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI })
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings'); expect(runAI).toHaveBeenCalledTimes(1)
    expect(ttrpgOpenSessionFactsV1((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger)).toEqual([])
    const event = await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.review'), ...s.resume(generated.prepared),
      candidateHash: generated.candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    const after = await readProductRuntimeState(s.f.sessionId), run = after.ttrpg!.openRun!, entry = run.factLedger!.entries[0]
    expect(entry.modelCandidate).toMatchObject({ requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })
    expect(entry.runtimeEntityReferences!.references.some(row => row.entityRef === s.npc)).toBe(true)
    expect(run.factLedger!.basis.entityReferences.some(row => row.entityRef === s.npc)).toBe(false)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(run.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(evaluateTtrpgPredicateV1({ op: 'session-fact', subjectRef: s.npc, predicateKey: 'knows', objectRef: s.fact.objectRef, value: true }, ttrpgOpenPredicateContextV1(after, s.f.runtimePackage.ttrpg!))).toBe(true)
    expect((await readInstanceAgentRunV1(s.f.scope, generated.prepared.runId)).projection.state).toBe('completed')
    expect(await executeTtrpgOpenOracleRequestV1({ ...s.resume(generated.prepared), runAI })).toEqual({ status: 'not-sent' }); expect(runAI).toHaveBeenCalledTimes(1)
    expect(event.type).toBe('ttrpg.open.oracle.reviewed')
  })
  it('keeps frozen-only facts on their original basis even though this request explicitly permits created identities', async () => {
    const s = await setup('party'), generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI: async () => JSON.stringify({ interpretation: '只需原对象。', facts: [{ ...s.fact, subjectRef: 'keeper' }] }) })
    await commitTtrpgOpenOracleCandidateFactV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.single'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash, proposalIndex: 0, decision: 'assert' })
    const entry = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries[0]
    expect(entry.runtimeEntityReferences).toBeUndefined(); expect(entry.modelCandidate?.requestKey).toBe(generated.prepared.requestKey)
  })
  it('retains the original hostile answer and denies unreceived private objects without facts, knowledge or mechanical changes', async () => {
    const s = await setup('party'), before = await readProductRuntimeState(s.f.sessionId)
    const raw = JSON.stringify({ interpretation: '擅自使用未读私密地点。', facts: [{ ...s.fact, objectRef: s.place }] })
    const generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI: async () => raw })
    expect(['manual-repair', 'blocked']).toContain(generated.candidate.artifact.status)
    expect(await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'raw-response', contentHash: generated.candidate.rawResponseHash })).toBe(raw)
    await expect(reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.bad.review'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })).rejects.toThrow()
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge); expect(after.ttrpg!.openRun!.factLedger).toEqual(before.ttrpg!.openRun!.factLedger)
    const sources = await loadTtrpgOpenGmOracleContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'gm' })
    expect(JSON.stringify(sources.resources)).not.toContain(s.place)
  })
  it('recovers the exact completed request after a real fact storage rollback without sending another model request', async () => {
    const s = await setup(), runAI = vi.fn(async () => JSON.stringify({ interpretation: '原依据与关系。', facts: [s.fact] }))
    const generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI }), before = await readProductRuntimeState(s.f.sessionId)
    const input = { ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.rollback'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
    const cut = vi.spyOn(db.productRuntimeEvents, 'add').mockRejectedValueOnce(new Error('ORACLE-INSTANCE-FACT-STORAGE-CUT'))
    await expect(reviewTtrpgOpenOracleCandidateV1(input)).rejects.toThrow('ORACLE-INSTANCE-FACT-STORAGE-CUT'); cut.mockRestore()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await reviewTtrpgOpenOracleCandidateV1(input); await reviewTtrpgOpenOracleCandidateV1(input)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1); expect(runAI).toHaveBeenCalledTimes(1)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.close'), viewerKey: s.owner.viewerKey,
      epochKey: generated.candidate.epochKey, reason: '原候选已明确审阅并完成终验' })
  })
  it('denies a different actual Oracle and a V2 preparation without the recorded window before creating any Run', async () => {
    const s = await setup(), input = { ...s.input, modelIdentity: { provider: 'test-adapter', model: 'injected' } }
    const other = s.state.ttrpg!.openRun!.oracleReceipts![0].sourceRef
    await expect(prepareTtrpgOpenOracleInputV2({ ...input, oracleSourceRef: other })).rejects.toThrow(/明确 V2/)
    expect(await db.agentRuns.count()).toBe(0)
    const state = await readProductRuntimeState(s.f.sessionId)
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.empty.close'), viewerKey: s.owner.viewerKey,
      epochKey: state.ttrpg!.openRun!.coordination.activeEpochKey!, reason: '尚未请求模型，明确结束本次空窗口' })
    const before = await readProductRuntimeState(s.f.sessionId)
    await expect(prepareTtrpgOpenOracleInputV2({ ...input, ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.no.window') })).rejects.toThrow(/明确 V2/)
    expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
  it('rolls back a contradictory actual instance batch, then retains the explicit discarded choice when the human confirms one fact', async () => {
    const s = await setup(), generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI: async () => JSON.stringify({ interpretation: '这两项互相矛盾，须真人处置。',
      facts: [s.fact, { ...s.fact, canonicalValue: false, detail: '同一候选中相反的判断。' }] }) })
    const before = await readProductRuntimeState(s.f.sessionId)
    const input = { ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.atomic'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept' as const, interpretationReason: null,
      choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }, { proposalIndex: 1, decision: 'adopt' as const, reason: null }] }
    await expect(reviewTtrpgOpenOracleCandidateV1(input)).rejects.toThrow()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await reviewTtrpgOpenOracleCandidateV1({ ...input, choices: [input.choices[0], { proposalIndex: 1, decision: 'discard', reason: '与原第一条判断冲突，不采用第二条' }] })
    const run = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!
    expect(run.factLedger!.entries).toHaveLength(1)
    expect(run.oracleReviews![0].choices[1]).toMatchObject({ decision: 'discard', reason: '与原第一条判断冲突，不采用第二条' })
  })
  it('repairs only the original terminal receipt after the actual instance fact commit was retained', async () => {
    const s = await setup(), runAI = vi.fn(async () => JSON.stringify({ interpretation: '原咨询关系。', facts: [s.fact] })), generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI })
    const cut = vi.spyOn(adoption, 'reconcileTtrpgOpenOracleFactRunV1').mockRejectedValueOnce(new Error('ORACLE-INSTANCE-TERMINAL-CUT'))
    const input = { ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.terminal'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
    await expect(reviewTtrpgOpenOracleCandidateV1(input)).rejects.toThrow('ORACLE-INSTANCE-TERMINAL-CUT'); cut.mockRestore()
    const retained = await readProductRuntimeState(s.f.sessionId); expect(retained.ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    await adoption.reconcileTtrpgOpenOracleFactRunV1({ ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash })
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(retained)
    expect((await readInstanceAgentRunV1(s.f.scope, generated.prepared.runId)).projection.state).toBe('completed'); expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('keeps original scope, model and F13 evidence through a child cut, parent deletion and two complete imports without restoring execution authority', async () => {
    const s = await setup(), runAI = vi.fn(async () => JSON.stringify({ interpretation: '供历史保留的原咨询关系。', facts: [s.fact] })), generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI })
    await reviewTtrpgOpenOracleCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.lifecycle'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.lifecycle.close'), viewerKey: s.owner.viewerKey, epochKey: generated.candidate.epochKey, reason: '已完成事实审阅' })
    const parent = await readProductRuntimeState(s.f.sessionId), child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: parent.lastSequence, title: 'After real model instance fact' })
    await deleteProductRuntimeSession(s.f.sessionId)
    expect((await readProductRuntimeState(child.id!)).ttrpg!.openRun!.factLedger).toEqual(parent.ttrpg!.openRun!.factLedger)
    let projectId = s.f.scope.projectId
    for (let index = 0; index < 2; index++) {
      projectId = await importProjectJSON(await exportProjectJSON(projectId))
      const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === child.title)!
      const state = await readProductRuntimeState(restored.id!)
      expect(state.ttrpg!.openRun!.factLedger).toEqual(parent.ttrpg!.openRun!.factLedger)
      const original = state.ttrpg!.branchLineage!.ancestors.find(row => row.sessionKey === parent.ttrpg!.sessionKey)!.snapshot.openRun!
      expect(original.coordination.calls[0].oracleInterpretation!.runtimeReferencePolicy).toEqual(s.policy)
      expect(state.entities).toEqual(parent.entities)
      await expect(executeTtrpgOpenOracleRequestV1({ scope: { projectId, worldId: restored.worldId!, workId: restored.workId! }, sessionId: restored.id!,
        viewerKey: s.owner.viewerKey, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, runAI })).rejects.toThrow()
    }
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('cannot borrow the one-call zero-action model window for another consultation or a human-original fact', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), epoch = before.ttrpg!.openRun!.coordination.epochs.at(-1)!
    expect(epoch.budget).toMatchObject({ maximumCalls: 1, maximumAiActions: 0 })
    await expect(consultTtrpgOracleV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.forbidden.reroll'), viewerKey: s.owner.viewerKey,
      oracleKey: 'oracle.reference.scope', question: '借用窗口再咨询一次', askedBy: 'gm' })).rejects.toThrow(/实例事实咨询只允许/)
    await expect(commitTtrpgOpenOracleFactV1({ ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.forbidden.human'), viewerKey: s.owner.viewerKey,
      oracleSourceRef: s.input.oracleSourceRef, proposal: { ...s.fact, subjectRef: 'keeper', objectRef: 'harbor' }, candidateHash: '0'.repeat(64) })).rejects.toThrow(/不能作为人类原创/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before); expect(await db.agentRuns.count()).toBe(0)
  })
  it('rejects damaged actual full source bytes before any fact write, then confirms using the restored same original evidence', async () => {
    const s = await setup(), runAI = vi.fn(async () => JSON.stringify({ interpretation: '只基于原实际正文。', facts: [s.fact] })), generated = await generateTtrpgOpenOracleCandidateV2({ ...s.input, runAI })
    const ref = generated.prepared.evidence.preflight.artifacts.find(row => row.role === 'source-snapshot' && row.sourceKey === 'ttrpgOpenGmOracleInput' && row.resourceKey?.includes(':oracle.'))!
    const row = (await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.f.scope.projectId, ref.artifactKind, ref.contentHash]).first())!
    const before = await readProductRuntimeState(s.f.sessionId)
    await db.agentRunArtifacts.update(row.id!, { content: row.content + 'DAMAGED-ORACLE-INSTANCE-SOURCE' })
    const input = { ...await openEnvelopeV1(s.f.sessionId, 'oracle.model.exact.source'), ...s.resume(generated.prepared), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept' as const, interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt' as const, reason: null }] }
    await expect(reviewTtrpgOpenOracleCandidateV1(input)).rejects.toThrow()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await db.agentRunArtifacts.update(row.id!, { content: row.content })
    await reviewTtrpgOpenOracleCandidateV1(input); expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.factLedger!.entries).toHaveLength(1)
    expect(runAI).toHaveBeenCalledTimes(1)
  })
})
