import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupAudioRuntimeV1 } from '../helpers/open-audio-runtime'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { rt, operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { prepareTtrpgOpenVoiceScriptV1, reserveTtrpgOpenVoiceRequestV1, readTtrpgOpenVoiceRequestDeskV1,
  cancelTtrpgOpenVoiceRequestV1 } from '../../src/lib/ttrpg/open-audio-service'
import { TTRPG_OPEN_VOICE_RESERVE_DECISION_V1 as reserveDecision, TTRPG_OPEN_VOICE_CANCEL_DECISION_V1 as cancelDecision,
  parseTtrpgOpenVoicePartV1 } from '../../src/lib/ttrpg/open-voice-request-contract'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents, branchProductRuntimeSession,
  deleteProductRuntimeSession, hashProductRuntimeStateV1 } from '../../src/lib/product/runtime-core'
import { projectTtrpgOpenMechanicalBasisV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { readTtrpgOpenRunOriginV1, parseTtrpgOpenRunOriginV1 } from '../../src/lib/ttrpg/open-run-portability'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { completeTtrpgOpenSessionZeroV1, changeTtrpgSafetyStatus, postTtrpgOpenTableMessageV1, startTtrpgOpenEpochV1,
  acceptTtrpgOpenKpNarrationV1, closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { generateTtrpgOpenKpCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { readAgentRunArtifactExactV1, markAndSweepAgentRunArtifactsV1, pruneAgentRunArtifactsExplicitlyV1 } from '../../src/lib/memory/artifact-store'

type Setup = Awaited<ReturnType<typeof setupAudioRuntimeV1>>
const source = (s: Setup) => ({ ...s.owner, narrationSourceRef: s.narrationSourceRef, audience: 'party' as const,
  privateActorKey: null, decision: 'review-original-narration-for-voice' as const })
const reserve = async (s: Setup, submissionKey = 'voice.intent.1', part?: { textOffset: number; textLength: number }) => reserveTtrpgOpenVoiceRequestV1({ ...s.owner,
  review: await prepareTtrpgOpenVoiceScriptV1(source(s)), submissionKey, part: part ?? { textOffset: 0, textLength: s.text.length }, decision: reserveDecision })
const cancel = (s: Setup, requestKey: string) => cancelTtrpgOpenVoiceRequestV1({ ...s.owner, requestKey, decision: cancelDecision })
async function replay(sessionId: number) {
  const session = (await db.productRuntimeSessions.get(sessionId))!, events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence')
  expect(replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN10 durable original voice intent and cumulative reservations', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('records one exact original input and zero-model Run without rules, clock, media, context or adoption permission', async () => {
    const s = await setupAudioRuntimeV1(true, '路边写着8点。\n\n你确认了门口。'), before = await readProductRuntimeState(s.owner.sessionId)
    expect(rt(before).openRun).not.toHaveProperty('voiceRequests')
    const requested = await reserve(s), after = await readProductRuntimeState(s.owner.sessionId), row = rt(after).openRun!.voiceRequests![0]
    expect(projectTtrpgOpenMechanicalBasisV1(after)).toEqual(projectTtrpgOpenMechanicalBasisV1(before))
    expect(row.script.text).toBe(s.text); expect(row.cancelledRef).toBeNull(); expect(row.sourceRef.sequence).toBe(requested.sequence)
    const parent = (await db.agentRuns.toArray())[0], run = await readInstanceAgentRunV1(s.owner.scope, parent.id!)
    expect(run.contract.budget).toMatchObject({ maxModelCalls: 0, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: 1 })
    expect(run.contract.permissions).toEqual({ contextSourceKeys: [], writeTargets: [] })
    expect(run.events.some(e => e.type === 'model.requested')).toBe(false); expect(run.run.contractHash).toBe(row.runContractHash)
    expect(await readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, artifactKind: 'source-snapshot', contentHash: row.inputArtifactHash })).toContain('路边写着8点。')
    const desk = await readTtrpgOpenVoiceRequestDeskV1(s.owner)
    expect(desk).toMatchObject({ budget: { requests: 1, characters: s.text.length }, generationAllowed: false, adoptionAllowed: false })
    expect(desk.requests[0].status).toBe('reserved-without-dispatch'); desk.requests[0].script.text = 'mutated copy'
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).requests[0].script.text).toBe(s.text)
    expect(await db.productMediaAssets.count()).toBe(0); await replay(s.owner.sessionId)
  })
  it('does not truncate a long source, requires an exact selected part and refuses split surrogate characters', async () => {
    const s = await setupAudioRuntimeV1(true, '😀' + '长'.repeat(2001)), review = await prepareTtrpgOpenVoiceScriptV1(source(s))
    await expect(reserveTtrpgOpenVoiceRequestV1({ ...s.owner, review, submissionKey: 'voice.too-long', part: { textOffset: 0, textLength: s.text.length }, decision: reserveDecision })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(0)
    for (const [textOffset, textLength] of [[1, 20], [0, 1], [2000, 10], [0, 0], [-1, 20]]) {
      expect(() => parseTtrpgOpenVoicePartV1({ textOffset, textLength, textHash: 'a'.repeat(64) }, '😀' + '长'.repeat(2001))).toThrow()
    }
    await reserve(s, 'voice.long.part', { textOffset: 0, textLength: 2000 })
    const row = rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests![0]
    expect(row.script.text).toBe(s.text); expect(row.part.textLength).toBe(2000)
  })
  it('keeps all three reservations consumed after cancellations, refresh and new Run identities', async () => {
    const s = await setupAudioRuntimeV1(true, '长'.repeat(2000))
    for (let i = 0; i < 3; i++) { const requested = await reserve(s, 'voice.budget.' + i); await cancel(s, requested.requestKey) }
    const before = await db.agentRuns.count()
    await expect(reserve(s, 'voice.budget.overflow')).rejects.toThrow(/累计预算/)
    const desk = await readTtrpgOpenVoiceRequestDeskV1(s.owner)
    expect(desk.budget).toMatchObject({ requests: 3, characters: 6000 }); expect(desk.requests.every(r => r.status === 'cancelled-before-send')).toBe(true)
    expect(await db.agentRuns.count()).toBe(before); await replay(s.owner.sessionId)
  })
  it('does not reuse the original submission or copied/edited review and does not leak the host request desk to a player', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepareTtrpgOpenVoiceScriptV1(source(s))
    await expect(reserveTtrpgOpenVoiceRequestV1({ ...s.owner, review: structuredClone(review), submissionKey: 'voice.clone', part: { textOffset: 0, textLength: 1 }, decision: reserveDecision })).rejects.toThrow(/重新核对/)
    const requested = await reserve(s)
    await expect(reserve(s)).rejects.toThrow(/原配音请求已存在/)
    await expect(cancelTtrpgOpenVoiceRequestV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER, requestKey: requested.requestKey, decision: cancelDecision })).rejects.toThrow()
    expect(await readTtrpgOpenVoiceRequestDeskV1({ ...s.owner, viewerKey: OPEN_HUMAN_VIEWER })).toMatchObject({ requests: [], budget: null })
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('allows original unsent cancellation during safety pause and makes repeated cancellation exactly idempotent', async () => {
    const s = await setupAudioRuntimeV1(), requested = await reserve(s)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.pause'), viewerKey: s.owner.viewerKey, changedBy: s.owner.viewerKey, status: 'paused', reason: '暂停配音' })
    const before = await readProductRuntimeState(s.owner.sessionId), cancelled = await cancel(s, requested.requestKey)
    expect(await cancel(s, requested.requestKey)).toEqual(cancelled)
    expect(projectTtrpgOpenMechanicalBasisV1(await readProductRuntimeState(s.owner.sessionId))).toEqual(projectTtrpgOpenMechanicalBasisV1(before))
    expect((await db.agentRuns.toArray())[0].status).toBe('completed'); await replay(s.owner.sessionId)
  })
  it('does not acquire narrative windows and can cancel original unsent intent during a later consultation', async () => {
    const s = await setupAudioRuntimeV1(false), requested = await reserve(s)
    await postTtrpgOpenTableMessageV1({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.discussion'), viewerKey: OPEN_HUMAN_VIEWER, submissionKey: 'voice.discussion', request: { kind: 'out-of-character', text: '继续调查。', audience: 'party' } })
    const oldEpoch = rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.coordination.activeEpochKey!
    await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.old.close'), viewerKey: OPEN_HUMAN_VIEWER, epochKey: oldEpoch, reason: '结束原行动窗口' })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(s.owner.sessionId, 'voice.later-epoch'), viewerKey: s.owner.viewerKey, triggerKind: 'request-situation', rawInput: '讨论下一处局势' })
    const before = await readProductRuntimeState(s.owner.sessionId)
    await cancel(s, requested.requestKey)
    expect(projectTtrpgOpenMechanicalBasisV1(await readProductRuntimeState(s.owner.sessionId))).toEqual(projectTtrpgOpenMechanicalBasisV1(before))
    await expect(reserve(s, 'voice.during-window')).rejects.toThrow(); await replay(s.owner.sessionId)
  })
  it('rejects a self-hashed cached journal and refuses to guess unsent when an original child is present', async () => {
    const s = await setupAudioRuntimeV1(), requested = await reserve(s), original = (await db.agentRuns.toArray())[0]
    const child = { ...original, id: undefined, parentRunId: original.id, parentRelation: 'voice.synthesis', contractJson: JSON.stringify({ ...JSON.parse(original.contractJson), objective: 'corrupt-child-canary' }), contractHash: 'f'.repeat(64) }
    await db.agentRuns.add(child)
    await expect(cancel(s, requested.requestKey)).rejects.toThrow(/子任务/)
    const state = await readProductRuntimeState(s.owner.sessionId), runtime = rt(state)
    runtime.openRun!.voiceRequests![0].script.text = 'FORGED-VOICE-CACHE'; state.ttrpg = runtime
    await db.productRuntimeSessions.update(s.owner.sessionId, { runtimeHeadStateJson: JSON.stringify(state), runtimeHeadStateHash: await hashProductRuntimeStateV1(state) })
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).requests[0].script.text).toBe(s.text)
  })
  it('inherits cutpoint budget across branches and backups but never gains execution permission from portable Runs', async () => {
    const s = await setupAudioRuntimeV1(), requested = await reserve(s), state = await readProductRuntimeState(s.owner.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: s.owner.sessionId, throughSequence: state.lastSequence, title: 'voice reservation child' })
    const childOwner = { ...s.owner, sessionId: child.id! }, childRt = rt(await readProductRuntimeState(child.id!))
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'voice.child.zero'), viewerKey: childOwner.viewerKey,
      acceptedItemKeys: childRt.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    expect((await readTtrpgOpenVoiceRequestDeskV1(childOwner)).budget?.requests).toBe(1)
    await expect(cancelTtrpgOpenVoiceRequestV1({ ...childOwner, requestKey: requested.requestKey, decision: cancelDecision })).rejects.toThrow()
    await deleteProductRuntimeSession(s.owner.sessionId)
    const root = rt(await readProductRuntimeState(child.id!)).openRun!.voiceRequests![0].artifactRefs[0]
    await markAndSweepAgentRunArtifactsV1(s.owner.scope.projectId)
    await expect(pruneAgentRunArtifactsExplicitlyV1({ projectId: s.owner.scope.projectId, targets: [root] })).rejects.toThrow(/confirmed-owner/)
    expect(await readAgentRunArtifactExactV1({ projectId: s.owner.scope.projectId, ...root })).toContain(s.text)
    expect((await readTtrpgOpenVoiceRequestDeskV1(childOwner)).requests[0].script.text).toBe(s.text)
    const projectId = await importProjectJSON(await exportProjectJSON(s.owner.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const importedOwner = { scope: { projectId, worldId: imported.worldId, workId: imported.workId }, sessionId: imported.id!, viewerKey: s.owner.viewerKey }
    expect((await readTtrpgOpenVoiceRequestDeskV1(importedOwner)).budget?.requests).toBe(1)
    await expect(cancelTtrpgOpenVoiceRequestV1({ ...importedOwner, requestKey: requested.requestKey, decision: cancelDecision })).rejects.toThrow()
    const childReview = await prepareTtrpgOpenVoiceScriptV1({ ...source(s), ...importedOwner })
    await reserveTtrpgOpenVoiceRequestV1({ ...importedOwner, review: childReview, submissionKey: 'voice.new-after-import', part: { textOffset: 0, textLength: s.text.length }, decision: reserveDecision })
    expect((await readTtrpgOpenVoiceRequestDeskV1(importedOwner)).budget?.requests).toBe(2); await replay(imported.id!)
  })
  it('keeps an imported current-session request read-only even when its portable parent Run is retained', async () => {
    const s = await setupAudioRuntimeV1(), requested = await reserve(s)
    const projectId = await importProjectJSON(await exportProjectJSON(s.owner.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const owner = { scope: { projectId, worldId: session.worldId, workId: session.workId }, sessionId: session.id!, viewerKey: s.owner.viewerKey }
    const parent = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray())[0]
    expect(parent.portableRuntimeOriginJson).toBeTruthy()
    const origin = await parseTtrpgOpenRunOriginV1(parent.portableRuntimeOriginJson!)
    expect(origin).toMatchObject({ version: 3, phase: 'voice-intent-only' })
    await expect(readTtrpgOpenRunOriginV1(parent.id!)).rejects.toThrow(/仅供审计/)
    const { originHash: _originHash, ...body } = origin; void _originHash
    const forged = { ...body, version: 1 }; Reflect.deleteProperty(forged, 'phase')
    await expect(parseTtrpgOpenRunOriginV1(JSON.stringify({ ...forged, originHash: await hashCanonicalValue(forged) }))).rejects.toThrow()
    expect((await readTtrpgOpenVoiceRequestDeskV1(owner)).budget?.requests).toBe(1)
    await expect(cancelTtrpgOpenVoiceRequestV1({ ...owner, requestKey: requested.requestKey, decision: cancelDecision })).rejects.toThrow(/导入/)
    expect((await readTtrpgOpenVoiceRequestDeskV1(s.owner)).requests[0].status).toBe('reserved-without-dispatch')
  })
  it('keeps one original reservation under a simultaneous duplicate and never creates a second active Run for it', async () => {
    const s = await setupAudioRuntimeV1(), review = await prepareTtrpgOpenVoiceScriptV1(source(s))
    const input = { ...s.owner, review, submissionKey: 'voice.concurrent-original', part: { textOffset: 0, textLength: s.text.length }, decision: reserveDecision }
    const result = await Promise.allSettled([reserveTtrpgOpenVoiceRequestV1(input), reserveTtrpgOpenVoiceRequestV1(input)])
    const rows = rt(await readProductRuntimeState(s.owner.sessionId)).openRun!.voiceRequests ?? []
    expect(rows.length).toBeLessThanOrEqual(1); expect(result.some(r => r.status === 'rejected')).toBe(true)
    const active = (await db.agentRuns.toArray()).filter(r => !['failed', 'cancelled', 'completed'].includes(r.status))
    expect(active).toHaveLength(0)
    if (rows.length) expect((await db.agentRuns.toArray()).filter(r => r.status === 'completed').map(r => r.contractHash)).toEqual([rows[0].runContractHash])
    await replay(s.owner.sessionId)
  })
  it('accepts actual adopted KP model prose as source only after its original operation completes', async () => {
    const f = await setupChecksFixtureV1({ ai: true }); await resumeTtrpgOpenChecksV1(f.command)
    const raw = JSON.stringify({ paragraphs: [{ text: '你们确认门口写着8点。', sourceKeys: ['action.receipt'] }] })
    const generated = await generateTtrpgOpenKpCandidateV1({ ...await openEnvelopeV1(f.command.sessionId, 'voice.kp.prepare'), scope: f.f.scope,
      viewerKey: f.command.viewerKey, rawInput: '请叙述原结果', maximumOutputTokens: 800, maximumCostUsd: 0.1, runAI: async () => raw })
    await acceptTtrpgOpenKpNarrationV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), runId: generated.prepared.runId,
      requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })
    await resumeTtrpgOpenPlayV1(f.command)
    const runtime = rt(await readProductRuntimeState(f.command.sessionId)), narration = runtime.openRun!.narrations![0]
    const owner = { scope: f.f.scope, sessionId: f.command.sessionId, viewerKey: f.command.viewerKey }
    const review = await prepareTtrpgOpenVoiceScriptV1({ ...owner, narrationSourceRef: narration.sourceRef, audience: 'party', privateActorKey: null, decision: 'review-original-narration-for-voice' })
    expect(review.script.text).toBe('你们确认门口写着8点。')
    await reserveTtrpgOpenVoiceRequestV1({ ...owner, review, submissionKey: 'voice.actual-kp-source', part: { textOffset: 0, textLength: review.script.text.length }, decision: reserveDecision })
    expect((await readTtrpgOpenVoiceRequestDeskV1(owner)).budget?.requests).toBe(1); await replay(owner.sessionId)
  })
})
