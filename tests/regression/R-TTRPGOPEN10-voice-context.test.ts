import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1 } from '../helpers/open-audio-runtime'
import { rt } from '../helpers/open-ttrpg-branch-recovery'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenVoiceScriptV1, reserveTtrpgOpenVoiceRequestV1, recoverTtrpgOpenVoiceIntentV1,
  cancelTtrpgOpenVoiceRequestV1 } from '../../src/lib/ttrpg/open-audio-service'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { readProductRuntimeState, hashProductRuntimeStateV1 } from '../../src/lib/product/runtime-core'
import { projectTtrpgOpenMechanicalBasisV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { changeTtrpgSafetyStatus, postTtrpgOpenTableMessageV1 } from '../../src/lib/ttrpg/runtime-commands'
import * as ledger from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { verifyVerificationReceiptIntegrityV1 } from '../../src/lib/agent/run/verification-receipt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const reserveInput = async (s: Awaited<ReturnType<typeof setupAudioRuntimeV1>>) => ({ ...s.owner,
  review: await prepareTtrpgOpenVoiceScriptV1({ ...s.owner, narrationSourceRef: s.narrationSourceRef,
    audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' }),
  submissionKey: 'voice.context.original', part: { textOffset: 4, textLength: 6 }, decision: 'reserve-this-original-voice-part' as const })
const contextInput = (owner: Awaited<ReturnType<typeof setupAudioRuntimeV1>>['owner'], requestKey: string, intentReceiptHash: string) => ({
  projectId: owner.scope.projectId, scope: owner.scope, productRuntimeSessionId: owner.sessionId,
  sourceKeys: ['ttrpgOpenVoiceText'], ttrpgVoiceRequest: { viewerKey: owner.viewerKey, requestKey, intentReceiptHash }, inputBudgetTokens: 8000 })
describe('R-TTRPGOPEN10 verified voice intent and exact registered context', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('verifies the actual reservation post-state and supplies only the selected original bytes through the source registry', async () => {
    const s = await setupAudioRuntimeV1(true, '第一段。\n\n第二段内容。'), input = await reserveInput(s), requested = await reserveTtrpgOpenVoiceRequestV1(input)
    const state = await readProductRuntimeState(s.owner.sessionId), events = await db.productRuntimeEvents.count(), count = await db.agentRunEvents.count()
    const run = (await db.agentRuns.toArray())[0], snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, run.id!)
    expect(snapshot.projection.state).toBe('completed'); expect(snapshot.events.some(e => e.type === 'context.assembled' || e.type === 'model.requested' || e.type === 'candidate.persisted')).toBe(false)
    const refs = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'source-snapshot')
    const bodies = await Promise.all(refs.map(e => readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: e.payload.contentHash })))
    const proof = bodies.map(s => JSON.parse(s)).find(s => s.schema === 'storyforge.ttrpg-open-voice-intent-verification')
    expect(proof.receipt.contextManifestHashes).toEqual([]); expect(proof.receipt.zeroModelCommit.contractJson).toBe(run.contractJson)
    expect(await verifyVerificationReceiptIntegrityV1(proof.receipt)).toBe(true); expect(proof.receipt.receiptHash).toBe(requested.intentReceiptHash)
    const assembled = await assembleContext(contextInput(s.owner, requested.requestKey, requested.intentReceiptHash))
    expect(assembled.text).toBe('\n\n第二段内'); expect(assembled.included).toEqual(['ttrpgOpenVoiceText'])
    expect(assembled.sourceEvidence?.[0]).toMatchObject({ key: 'ttrpgOpenVoiceText', delivery: 'full' })
    expect(await db.productRuntimeEvents.count()).toBe(events); expect(await db.agentRunEvents.count()).toBe(count)
    expect(await readProductRuntimeState(s.owner.sessionId)).toEqual(state)
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.context.discussion'), viewerKey: OPEN_HUMAN_VIEWER,
      submissionKey: 'voice.context.discussion', request: { kind: 'out-of-character', text: '后续讨论不能改写原已确认文字。', audience: 'party' } })
    const discussed = await assembleContext(contextInput(s.owner, requested.requestKey, requested.intentReceiptHash))
    expect(discussed.text).toBe(assembled.text)
    expect(await db.agentRunEvents.count()).toBe(count)
    expect((await recoverTtrpgOpenVoiceIntentV1({ ...s.owner, requestKey: requested.requestKey, decision: 'verify-original-voice-intent-only' })).receiptHash).toBe(requested.intentReceiptHash)
  })
  it('fails closed on wrong receipt, viewer, scope, cancelled intent or insufficient atomic budget without writing or sending', async () => {
    const s = await setupAudioRuntimeV1(true, '第一段。\n\n' + '长'.repeat(1000)), input = await reserveInput(s)
    input.part = { textOffset: 0, textLength: 1000 }
    const requested = await reserveTtrpgOpenVoiceRequestV1(input), c = contextInput(s.owner, requested.requestKey, requested.intentReceiptHash)
    for (const changed of [
      { ...c, ttrpgVoiceRequest: { ...c.ttrpgVoiceRequest, intentReceiptHash: 'f'.repeat(64) } },
      { ...c, ttrpgVoiceRequest: { ...c.ttrpgVoiceRequest, viewerKey: OPEN_HUMAN_VIEWER } },
      { ...c, scope: { ...c.scope, projectId: c.scope.projectId + 999 } },
      { ...c, inputBudgetTokens: 64 },
    ]) await expect(assembleContext(changed)).rejects.toThrow()
    await cancelTtrpgOpenVoiceRequestV1({ ...s.owner, requestKey: requested.requestKey, decision: 'cancel-this-unsent-voice-request' })
    const events = await db.agentRunEvents.count()
    await expect(assembleContext(c)).rejects.toThrow(/取消/)
    expect(await db.agentRunEvents.count()).toBe(events); expect(await db.productMediaAssets.count()).toBe(0)
  })
  it('does not turn safety-paused or imported original input into a fresh model source', async () => {
    const s = await setupAudioRuntimeV1(true, '第一段。\n\n第二段内容。'), requested = await reserveTtrpgOpenVoiceRequestV1(await reserveInput(s))
    const projectId = await importProjectJSON(await exportProjectJSON(s.owner.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const owner = { scope: { projectId, worldId: session.worldId, workId: session.workId }, sessionId: session.id!, viewerKey: s.owner.viewerKey }
    await expect(assembleContext(contextInput(owner, requested.requestKey, requested.intentReceiptHash))).rejects.toThrow()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.context.pause'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: '暂停本机语音准备' })
    await expect(assembleContext(contextInput(s.owner, requested.requestKey, requested.intentReceiptHash))).rejects.toThrow(/暂停/)
  })
  it('supports one real lineage child from the verified receipt, while a wrong parent proof or duplicate relation cannot create another execution', async () => {
    const s = await setupAudioRuntimeV1(true, '第一段。\n\n第二段内容。'), requested = await reserveTtrpgOpenVoiceRequestV1(await reserveInput(s))
    const parent = (await db.agentRuns.toArray())[0], state = await readProductRuntimeState(s.owner.sessionId)
    const row = rt(state).openRun!.voiceRequests![0]
    const lineage = { parent: { runId: parent.id!, receiptHash: requested.intentReceiptHash, relation: 'voice.synthesis', artifactHash: row.inputArtifactHash } }
    const contract = { version: 1 as const, objective: 'Engineering only: one voice execution lineage, no transport', workflowKind: 'direct-generation' as const, lineage,
      scope: { projectId: s.owner.scope.projectId, worldGroupId: null, runtime: { productRuntimeSessionId: s.owner.sessionId, baseSequence: state.lastSequence,
        stateHash: await hashProductRuntimeStateV1(state), visibilityHash: row.scriptHash, releaseHash: row.script.runtimeSourceHash } },
      permissions: { contextSourceKeys: ['ttrpgOpenVoiceText'], writeTargets: [] }, runtimeBindingHash: row.inputArtifactHash,
      budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 8000, maxOutputTokens: 1, maxAttemptsPerStep: 1 },
      acceptance: [{ id: 'voice.candidate', kind: 'output-present' as const, required: true }], verificationPlan: [{ id: 'voice.terminal', kind: 'terminal' as const, verifier: 'engineering-only-v1', criterionIds: ['voice.candidate'] }],
      failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const } }
    const create = (value: typeof contract) => ledger.createAgentRunV1({ scope: s.owner.scope, productRuntimeSessionId: s.owner.sessionId, worldGroupId: null, contract: value })
    await expect(create({ ...contract, lineage: { parent: { ...lineage.parent, receiptHash: 'f'.repeat(64) } } })).rejects.toThrow(/parent_receipt/)
    const child = await create(contract)
    expect(child.run.parentRunId).toBe(parent.id); expect(child.contract.budget.maxModelCalls).toBe(1)
    expect((await assembleContext(contextInput(s.owner, requested.requestKey, requested.intentReceiptHash))).text).toBe('\n\n第二段内')
    await expect(create(contract)).rejects.toThrow(/duplicate_child/)
    await expect(cancelTtrpgOpenVoiceRequestV1({ ...s.owner, requestKey: requested.requestKey, decision: 'cancel-this-unsent-voice-request' })).rejects.toThrow(/子任务/)
    expect((await db.agentRunEvents.toArray()).some(e => e.type === 'model.requested')).toBe(false)
  })
  for (const type of ['step.succeeded', 'verification.started', 'verification.accepted'] as const) for (const after of [false, true]) {
    it(`recovers the same original zero-call intent after ${type} ${after ? 'lost return' : 'pre-write cut'}`, async () => {
      const s = await setupAudioRuntimeV1(true, '第一段。\n\n第二段内容。'), input = await reserveInput(s)
      const original = ledger.appendAgentRunEventV1; let cut = false
      const spy = vi.spyOn(ledger, 'appendAgentRunEventV1').mockImplementation(async request => {
        if (!cut && request.type === type) { cut = true; if (after) await original(request); throw new Error('VOICE-INTENT-TERMINAL-CUT') }
        return original(request)
      })
      await expect(reserveTtrpgOpenVoiceRequestV1(input)).rejects.toThrow('VOICE-INTENT-TERMINAL-CUT'); spy.mockRestore()
      const runtimeEvents = await db.productRuntimeEvents.where('sessionId').equals(s.owner.sessionId).toArray()
      const reservation = runtimeEvents.filter(e => e.type === 'ttrpg.audio.voice.reserved'); expect(reservation).toHaveLength(1)
      const row = JSON.parse(reservation[0].payloadJson).request, before = await readProductRuntimeState(s.owner.sessionId)
      const result = await recoverTtrpgOpenVoiceIntentV1({ ...s.owner, requestKey: row.requestKey, decision: 'verify-original-voice-intent-only' })
      expect(result).toMatchObject({ runState: 'completed', generationAllowed: false, adoptionAllowed: false })
      expect(await recoverTtrpgOpenVoiceIntentV1({ ...s.owner, requestKey: row.requestKey, decision: 'verify-original-voice-intent-only' })).toEqual(result)
      const snapshot = await ledger.readInstanceAgentRunV1(s.owner.scope, (await db.agentRuns.toArray())[0].id!)
      expect(snapshot.events.filter(e => e.type === 'verification.accepted')).toHaveLength(1)
      expect(snapshot.events.filter(e => e.type === 'model.requested' || e.type === 'tool.called')).toHaveLength(0)
      expect(await db.agentRuns.count()).toBe(1); expect(await db.productRuntimeEvents.where('sessionId').equals(s.owner.sessionId).count()).toBe(runtimeEvents.length)
      expect(projectTtrpgOpenMechanicalBasisV1(await readProductRuntimeState(s.owner.sessionId))).toEqual(projectTtrpgOpenMechanicalBasisV1(before))
      expect((await assembleContext(contextInput(s.owner, row.requestKey, result.receiptHash))).text).toBe('\n\n第二段内')
    })
  }
})
