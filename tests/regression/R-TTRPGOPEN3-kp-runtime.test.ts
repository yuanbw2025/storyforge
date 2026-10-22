import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { operationInput, rt } from '../helpers/open-ttrpg-branch-recovery'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { loadTtrpgOpenKpContextV1 } from '../../src/lib/ttrpg/open-kp-context'
import { generateTtrpgOpenKpCandidateV1, executeTtrpgOpenKpRequestV1, generateTtrpgOpenCompanionCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenKpCandidateV1 } from '../../src/lib/ttrpg/open-kp-candidate'
import { evaluateTtrpgOpenHandoffV1 } from '../../src/lib/ttrpg/open-handoff'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { offerTtrpgOpenHandoffV1 } from '../../src/lib/ttrpg/runtime-commands'
import { startTtrpgOpenIntentCandidateOperationV1, preauthorizeTtrpgOpenCompanionV1 } from '../../src/lib/ttrpg/runtime-commands'
import { acceptTtrpgOpenKpNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState, parseProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/product/runtime-core'
import { branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
const raw = JSON.stringify({ paragraphs: [{ text: '你们确认了眼前行动的结果，新的线索仍需亲自调查。', sourceKeys: ['action.receipt'] }] })
async function setup() {
  const f = await setupChecksFixtureV1({ ai: true });await resumeTtrpgOpenChecksV1(f.command)
  return { ...f, input: { ...await openEnvelopeV1(f.command.sessionId, 'kp.prepare'), scope: f.f.scope, viewerKey: f.command.viewerKey,
    rawInput: 'PRIVATE-HUMAN-THOUGHT-NOT-FOR-PARTY', maximumOutputTokens: 800, maximumCostUsd: 0.1 } }
}
async function replay(sessionId: number) {
  const row = (await db.productRuntimeSessions.get(sessionId))!
  expect(replayProductRuntimeEvents(parseProductRuntimeState(row.initialStateJson), await db.productRuntimeEvents.where('sessionId').equals(sessionId).sortBy('sequence'))).toEqual(await readProductRuntimeState(sessionId))
}
describe('R-TTRPGOPEN3 real KP post-result candidate and adoption', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete();await db.open() });afterEach(() => { vi.restoreAllMocks();db.close() })
  it('uses only actual party-intersection sources, retains raw candidate and adopts once without facts, resources or time writes', async () => {
    const f = await setup(), before = await readProductRuntimeState(f.command.sessionId), runAI = vi.fn(async () => raw)
    const generated = await generateTtrpgOpenKpCandidateV1({ ...f.input, runAI })
    expect(runAI).toHaveBeenCalledTimes(1);expect(generated.candidate.narration).toEqual(JSON.parse(raw))
    expect(generated.prepared.messages.map(m => m.content).join('\n')).not.toContain(f.input.rawInput)
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
    expect(await readAgentRunArtifactExactV1({ projectId: f.f.scope.projectId, artifactKind: 'raw-response', contentHash: generated.candidate.rawResponseHash })).toBe(raw)
    const read = { scope: f.f.scope, sessionId: f.command.sessionId, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, viewerKey: f.command.viewerKey }
    expect(await readTtrpgOpenKpCandidateV1(read)).toEqual(generated.candidate)
    expect(await executeTtrpgOpenKpRequestV1({ ...read, runAI })).toEqual({ status: 'not-sent' })
    const command = { ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), runId: read.runId, requestKey: read.requestKey, candidateHash: generated.candidate.candidateHash }
    const event = await acceptTtrpgOpenKpNarrationV1(command);expect(await acceptTtrpgOpenKpNarrationV1(command)).toEqual(event)
    const state = await readProductRuntimeState(f.command.sessionId), run = rt(state).openRun!
    expect(state.entities).toEqual(before.entities);expect(run.factLedger).toEqual(rt(before).openRun!.factLedger);expect(run.knowledge).toEqual(rt(before).openRun!.knowledge);expect(run.worldTime).toEqual(rt(before).openRun!.worldTime)
    expect(run.narrations).toHaveLength(1);expect(run.narrations![0].narration).toEqual(JSON.parse(raw))
    const snapshot = await readInstanceAgentRunV1(f.f.scope, read.runId);expect(snapshot.projection.state).toBe('completed')
    expect(snapshot.events.filter(e => e.type === 'runtime.candidate.adopted')).toHaveLength(1)
    const result = await resumeTtrpgOpenPlayV1(f.command)
    expect(result).toEqual({ status: 'completed', nextStepKey: null, handoff: { kind: 'companion-ready', actorKey: 'companion.1' } })
    const finished = await readProductRuntimeState(f.command.sessionId)
    expect(await resumeTtrpgOpenPlayV1(f.command)).toEqual(result);expect(await readProductRuntimeState(f.command.sessionId)).toEqual(finished)
    expect(finished.entities).toEqual(before.entities);expect(rt(finished).openRun!.worldTime).toEqual(rt(state).openRun!.worldTime);expect(runAI).toHaveBeenCalledTimes(1)
    await replay(f.command.sessionId)
  })
  it('preserves accepted narration through a child branch and project backup without granting ancestor request authority', async () => {
    const f = await setup(), generated = await generateTtrpgOpenKpCandidateV1({ ...f.input, runAI: async () => raw })
    await acceptTtrpgOpenKpNarrationV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })
    await resumeTtrpgOpenPlayV1(f.command)
    const parent = await readProductRuntimeState(f.command.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: f.command.sessionId, title: 'KP lineage', throughSequence: (await openEnvelopeV1(f.command.sessionId, 'cut')).baseSequence })
    const childState = await readProductRuntimeState(child.id!), childRuntime = rt(childState)
    expect(childRuntime.openRun!.narrations).toEqual(rt(parent).openRun!.narrations)
    expect(childRuntime.openRun!.coordination.calls).toEqual([]);expect(childRuntime.authorization).toBeNull()
    const importedId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId)), rows = await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()
    const copy = rows.find(row => rt(parseProductRuntimeState(row.initialStateJson)).sessionKey === childRuntime.sessionKey)!
    expect(copy.id).not.toBe(child.id)
    expect(rt(await readProductRuntimeState(copy.id!)).openRun!.narrations).toEqual(childRuntime.openRun!.narrations)
    expect(rt(await readProductRuntimeState(copy.id!)).branchLineage).toEqual(childRuntime.branchLineage)
    await replay(copy.id!);expect(await readProductRuntimeState(f.command.sessionId)).toEqual(parent)
  }, 60000)
  it('settles one human and two distinct AI companions in the original bounded window through actual KP receipts', async () => {
    const f = await setupChecksFixtureV1({ cooperative: true }), sessionId = f.command.sessionId
    let command = f.command
    const narrate = async () => {
      expect(await resumeTtrpgOpenPlayV1(command)).toEqual({ status: 'awaiting-narration', nextStepKey: 'narration' })
      const generated = await generateTtrpgOpenKpCandidateV1({ ...await openEnvelopeV1(sessionId, `kp.${command.operationKey}`), scope: f.f.scope,
        viewerKey: command.viewerKey, rawInput: '不可共享的人类私密想法', maximumOutputTokens: 800, maximumCostUsd: 0.1, runAI: async () => raw })
      await acceptTtrpgOpenKpNarrationV1({ ...await operationInput(sessionId, command.operationKey, 'narration'), runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })
      return resumeTtrpgOpenPlayV1(command)
    }
    expect((await narrate()).handoff).toEqual({ kind: 'companion-ready', actorKey: 'companion.1' })
    for (const actorKey of ['companion.1', 'companion.2']) {
      const generated = await generateTtrpgOpenCompanionCandidateV1({ ...await openEnvelopeV1(sessionId, `propose.${actorKey}`), scope: f.f.scope,
        viewerKey: command.viewerKey, actorKey, rawInput: '根据自己已知的资料协作观察现场。', maximumOutputTokens: 800, maximumCostUsd: 0.1,
        runAI: async () => JSON.stringify({ goal: '观察港口', method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) })
      await startTtrpgOpenIntentCandidateOperationV1({ ...await openEnvelopeV1(sessionId, `admit.${actorKey}`), viewerKey: command.viewerKey,
        runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash, decision: 'start' })
      const operation = rt(await readProductRuntimeState(sessionId)).openRun!.operations.at(-1)!
      command = { sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: command.viewerKey }
      await preauthorizeTtrpgOpenCompanionV1({ ...await operationInput(sessionId, command.operationKey, 'preauthorization'), runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })
      const finished = await narrate()
      expect(finished.handoff).toEqual(actorKey === 'companion.1' ? { kind: 'companion-ready', actorKey: 'companion.2' } : { kind: 'budget', actorKey: null })
    }
    const state = await readProductRuntimeState(sessionId), run = rt(state).openRun!
    expect(run.operations.map(o => o.status)).toEqual(['completed', 'completed', 'completed'])
    expect(run.worldTime.worldTurn).toBe(3);expect(run.narrations).toHaveLength(3);expect(run.coordination.epochs).toHaveLength(1)
    expect(run.coordination.epochs[0].successfulActorKeys).toEqual(['companion.1', 'companion.2'])
    expect(run.coordination.calls).toHaveLength(5);expect(run.coordination.calls.every(c => c.status === 'succeeded')).toBe(true)
    expect(run.operations.slice(1).every(o => o.approvals.length === 0 && o.preauthorization)).toBe(true);await replay(sessionId)
  }, process.env.CI ? 240000 : 120000)
  it('never grants a new window or acts for hybrid/human seats, exhausted budget or unknown request', async () => {
    const f = await setup(), state = await readProductRuntimeState(f.command.sessionId), choose = (value: typeof state) => evaluateTtrpgOpenHandoffV1(value, f.command.operationKey)
    expect(choose(state)).toEqual({ kind: 'companion-ready', actorKey: 'companion.1' })
    const hybrid = structuredClone(state), hybridRuntime = rt(hybrid);hybrid.ttrpg = hybridRuntime;Object.assign(hybridRuntime.authorization!.seats.find(s => s.actorKey === 'companion.1')!, { controller: 'hybrid', assignmentState: 'claimed' })
    expect(choose(hybrid)).toEqual({ kind: 'companion-ready', actorKey: 'companion.2' })
    Object.assign(hybridRuntime.authorization!.seats.find(s => s.actorKey === 'companion.2')!, { controller: 'hybrid', assignmentState: 'claimed' })
    expect(choose(hybrid)).toEqual({ kind: 'human', actorKey: null })
    const exhausted = structuredClone(state), exhaustedRuntime = rt(exhausted);exhausted.ttrpg = exhaustedRuntime;exhaustedRuntime.openRun!.coordination.epochs[0].budget.maximumAiActions = 0;exhaustedRuntime.epochBudget!.maximumAiActions = 0
    expect(choose(exhausted)).toEqual({ kind: 'budget', actorKey: null })
    const runAI = vi.fn(async () => { throw new Error('simulated KP transport interruption') })
    await expect(generateTtrpgOpenKpCandidateV1({ ...f.input, runAI })).rejects.toThrow(/interruption/)
    const unknown = await readProductRuntimeState(f.command.sessionId)
    expect(rt(unknown).openRun!.coordination.calls[0].status).toBe('unknown')
    expect(choose(unknown)).toEqual({ kind: 'model-recovery', actorKey: null });expect(runAI).toHaveBeenCalledTimes(1)
    await replay(f.command.sessionId)
  })
  it('stops the full settlement before narration and rejects a fabricated early handoff', async () => {
    const f = await setupChecksFixtureV1({ ai: true })
    expect(await resumeTtrpgOpenPlayV1(f.command)).toEqual({ status: 'awaiting-narration', nextStepKey: 'narration' })
    const before = await readProductRuntimeState(f.command.sessionId)
    await expect(offerTtrpgOpenHandoffV1(await operationInput(f.command.sessionId, f.command.operationKey, 'handoff'))).rejects.toThrow(/交接/)
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before);await replay(f.command.sessionId)
  })
  it('does not let KP read pre-check/incomplete result owners', async () => {
    const f = await setupChecksFixtureV1({ ai: true })
    await expect(loadTtrpgOpenKpContextV1({ scope: f.f.scope, sessionId: f.command.sessionId, actorKey: 'gm' })).rejects.toThrow(/实际结算和运行检查/)
  })
  it.each(['not-json', JSON.stringify({ paragraphs: [{ text: '杜撰秘密', sourceKeys: ['gm.secret'] }] }), JSON.stringify({ paragraphs: [], facts: [] })])('retains invalid raw output and refuses adoption without silently resending: %s', async output => {
    const f = await setup(), runAI = vi.fn(async () => output), generated = await generateTtrpgOpenKpCandidateV1({ ...f.input, runAI })
    expect(generated.candidate.narration).toBeNull();expect(runAI).toHaveBeenCalledTimes(1)
    await expect(acceptTtrpgOpenKpNarrationV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash })).rejects.toThrow(/修订|受阻/)
    expect(rt(await readProductRuntimeState(f.command.sessionId)).openRun!.narrations).toBeUndefined()
  })
})
