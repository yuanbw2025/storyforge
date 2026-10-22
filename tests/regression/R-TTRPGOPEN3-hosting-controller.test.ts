import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readTtrpgOpenModelCallRunsV1 } from '../../src/lib/ttrpg/open-model-call-evidence'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { prepareTtrpgOpenCompanionInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenCompanionCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { stopTtrpgOpenTableHostingV1, readTtrpgOpenTableV1 } from '../../src/lib/ttrpg/open-table-service'
import { delegateTtrpgOpenHostingV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenHostingV1 } from '../../src/lib/ttrpg/open-hosting-coordinator'

const companion = JSON.stringify({ goal: '观察港口', method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
const kp = JSON.stringify({ paragraphs: [{ text: '你们看清了本次行动留下的结果。', sourceKeys: ['action.receipt'] }] })
describe('R-TTRPGOPEN3 bounded continuous hosting through existing owners', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('settles the real approved human action and two safe companions with three KP receipts under one epoch', async () => {
    const f = await setupChecksFixtureV1({ cooperative: true }, pkg => { pkg.ttrpg!.campaign.runtimePolicy.maximumOutputTokens = 2000 }), sessionId = f.command.sessionId
    const epoch = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.coordination.epochs[0]
    await delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(sessionId, 'controller.grant'), viewerKey: f.command.viewerKey,
      epochKey: epoch.epochKey, maximumCostUsdPerCall: 0.1, decision: 'delegate-this-epoch' })
    const permission = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.coordination.epochs[0].hostingDelegation!
    let calls = 0
    const input = { scope: f.f.scope, sessionId, viewerKey: f.command.viewerKey, epochKey: epoch.epochKey, hostingDelegationRef: permission.sourceRef,
      runAI: async (messages: import('../../src/lib/types').ChatMessage[]) => {
        calls++
        return messages.some(m => m.content.includes('storyforge.ttrpg-open-kp-contract')) ? kp : companion
      } }
    expect(await resumeTtrpgOpenHostingV1(input)).toMatchObject({ status: 'handoff', reason: 'budget' })
    const state = await readProductRuntimeState(sessionId), run = state.ttrpg!.openRun!
    expect(run.operations.map(o => o.status)).toEqual(['completed', 'completed', 'completed'])
    expect(run.worldTime.worldTurn).toBe(3); expect(run.narrations).toHaveLength(3); expect(calls).toBe(5)
    expect(run.coordination.calls.filter(c => c.skillId === 'prose.ttrpg-open-companion').map(c => c.reservedOutputTokens)).toEqual([1200, 1200])
    expect(run.coordination.calls.filter(c => c.skillId === 'prose.ttrpg-open-kp').map(c => c.reservedOutputTokens)).toEqual([2000, 2000, 2000])
    expect(run.operations.slice(1).every(o => o.approvals.length === 0 && o.intentEvidence?.hostingDelegationRef && o.preauthorization?.hostingDelegationRef)).toBe(true)
    expect(await resumeTtrpgOpenHostingV1(input)).toMatchObject({ reason: 'budget' })
    expect(await readProductRuntimeState(sessionId)).toEqual(state); expect(calls).toBe(5)
  }, process.env.CI ? 240000 : 120000)
  async function quick(safe = false) {
    const f = await readyOpenTtrpgSessionV1('bounded hosting stop', pkg => {
      pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 200000
      if (safe) pkg.ttrpg!.rulePack.content.actions.find(a => a.key === 'investigate')!.effects = []
    })
    await commands.startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'host.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'continue-host', rawInput: '本轮有限协作' })
    const epoch = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.epochs[0]
    await delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(f.sessionId, 'host.grant'), viewerKey: OPEN_HUMAN_VIEWER,
      epochKey: epoch.epochKey, maximumCostUsdPerCall: 0.1, decision: 'delegate-this-epoch' })
    const permission = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.epochs[0].hostingDelegation!
    const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, epochKey: epoch.epochKey, hostingDelegationRef: permission.sourceRef }
    const model = async () => ({ ...await openEnvelopeV1(f.sessionId, 'host.prepare'), ...input, actorKey: 'companion.1',
      rawInput: '依据自己已知的资料调查', maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    return { f, input, model }
  }
  it('keeps a risky system proposal pending for real humans and never silently asks another model', async () => {
    const { input, model } = await quick()
    await generateTtrpgOpenCompanionCandidateV1({ ...await model(), runAI: async () => companion })
    const before = await readProductRuntimeState(input.sessionId), runAI = vi.fn(async () => { throw new Error('unexpected second request') })
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'needs-human' })
    const state = await readProductRuntimeState(input.sessionId), op = state.ttrpg!.openRun!.operations[0]
    expect(op.status).toBe('awaiting-approval'); expect(op.approvals).toEqual([]); expect(op.businessRefs).toEqual([])
    expect(state.entities).toEqual(before.entities); expect(state.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'needs-human' })
    expect(await readProductRuntimeState(input.sessionId)).toEqual(state); expect(runAI).not.toHaveBeenCalled()
  })
  it('executes a genuinely prepared original request once and hands its risky candidate back', async () => {
    const { input, model } = await quick()
    const prepared = await prepareTtrpgOpenCompanionInputV1({ ...await model(), modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const runAI = vi.fn(async () => companion)
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'needs-human' })
    expect(runAI).toHaveBeenCalledTimes(1)
    const calls = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.coordination.calls
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ requestKey: prepared.requestKey, status: 'succeeded' })
  })
  it('stops and cancels only an unsent delegated request, retaining its counted slot and exact Run receipt', async () => {
    const { input, model } = await quick()
    const prepared = await prepareTtrpgOpenCompanionInputV1({ ...await model(), modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const before = await readProductRuntimeState(input.sessionId)
    let stoppedBeforeCleanup = false
    await stopTtrpgOpenTableHostingV1(input, async () => {
      const state = await readProductRuntimeState(input.sessionId)
      expect(state.ttrpg!.openRun!.coordination.epochs[0].hostingDelegation!.stoppedRef).toBeTruthy()
      expect(state.ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
      stoppedBeforeCleanup = true
    })
    expect(stoppedBeforeCleanup).toBe(true)
    const state = await readProductRuntimeState(input.sessionId), run = state.ttrpg!.openRun!
    expect(run.coordination.epochs[0].hostingDelegation!.stoppedRef).toBeTruthy()
    expect(run.coordination.calls[0]).toMatchObject({ status: 'failed', dispatchRef: null, terminalReason: 'cancelled-before-dispatch' })
    expect((await db.agentRuns.get(prepared.runId))!.status).toBe('cancelled')
    expect(run.coordination.calls).toHaveLength(1); expect(state.entities).toEqual(before.entities)
    await stopTtrpgOpenTableHostingV1(input)
    expect(await readProductRuntimeState(input.sessionId)).toEqual(state)
    expect(await resumeTtrpgOpenHostingV1(input)).toMatchObject({ reason: 'stopped' })
  })
  it('waits on an actually dispatched or unknown request, preserving charges and never resending', async () => {
    const { input, model } = await quick()
    const prepared = await prepareTtrpgOpenCompanionInputV1({ ...await model(), modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const original = { ...input, runId: prepared.runId, requestKey: prepared.requestKey }
    await commands.dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(input.sessionId, 'host.dispatch'), ...original })
    const runAI = vi.fn(async () => companion), before = await readProductRuntimeState(input.sessionId)
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'awaiting-result' })
    expect(await readProductRuntimeState(input.sessionId)).toEqual(before)
    await commands.finishTtrpgOpenModelCallV1({ ...await openEnvelopeV1(input.sessionId, 'host.unknown'), ...original,
      status: 'unknown', responseArtifactHash: null, usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'transport-result-unknown' })
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'model-recovery' })
    await stopTtrpgOpenTableHostingV1(input)
    expect((await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'unknown', usage: { actualCostUsd: null } })
    expect(runAI).not.toHaveBeenCalled()
  })
  it('recovers a paid response missing its candidate instead of generating a replacement', async () => {
    const { input, model } = await quick()
    const actual = commands.finishTtrpgOpenModelCallV1
    vi.spyOn(commands, 'finishTtrpgOpenModelCallV1').mockImplementationOnce(async command => { await actual(command); throw new Error('simulated close after response') })
    await expect(generateTtrpgOpenCompanionCandidateV1({ ...await model(), runAI: async () => companion })).rejects.toThrow(/simulated close/)
    vi.restoreAllMocks()
    const runAI = vi.fn(async () => { throw new Error('unexpected repeated paid request') })
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'needs-human' })
    expect(runAI).not.toHaveBeenCalled()
    expect((await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.coordination.calls).toHaveLength(1)
  })
  it('persists stop before disposing an unstarted automatic proposal, without removing its original evidence', async () => {
    const { input, model } = await quick()
    await generateTtrpgOpenCompanionCandidateV1({ ...await model(), runAI: async () => companion })
    await resumeTtrpgOpenHostingV1(input)
    const before = await readProductRuntimeState(input.sessionId)
    await stopTtrpgOpenTableHostingV1(input)
    const after = await readProductRuntimeState(input.sessionId), run = after.ttrpg!.openRun!
    expect(run.operations[0].status).toBe('stale'); expect(run.operations[0].businessRefs).toEqual([])
    expect(run.operations[0].intentEvidence).toEqual(before.ttrpg!.openRun!.operations[0].intentEvidence)
    expect(after.entities).toEqual(before.entities); expect(run.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    const events = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).sortBy('sequence')
    expect(events.find(e => e.type === 'ttrpg.open.hosting.stopped')!.sequence).toBeLessThan(events.find(e => e.type === 'ttrpg.open.intent.disposed')!.sequence)
  })
  it('rechecks the real grant at each deterministic submit and retains a rule already committed before stop', async () => {
    const { input, model } = await quick(true)
    const generated = await generateTtrpgOpenCompanionCandidateV1({ ...await model(), runAI: async () => companion })
    const candidate = { ...input, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, candidateHash: generated.candidate.candidateHash }
    await commands.startTtrpgOpenDelegatedCompanionOperationV1({ ...await openEnvelopeV1(input.sessionId, 'host.proposal'), ...candidate })
    const op = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.operations[0]
    await commands.preauthorizeTtrpgOpenCompanionV1({ ...await operationInput(input.sessionId, op.operationKey, 'preauthorization'), ...candidate })
    const actual = commands.resolveTtrpgOpenOperationRuleV1
    vi.spyOn(commands, 'resolveTtrpgOpenOperationRuleV1').mockImplementationOnce(async command => {
      const receipt = await actual(command)
      await commands.stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(input.sessionId, 'host.stop.after-rule'), epochKey: input.epochKey,
        viewerKey: input.viewerKey, reason: '在实际规则提交后停止' })
      return receipt
    })
    expect(await resumeTtrpgOpenHostingV1(input)).toMatchObject({ reason: 'stopped' })
    const state = await readProductRuntimeState(input.sessionId), run = state.ttrpg!.openRun!
    expect(run.ruleReceipts).toHaveLength(1); expect(run.worldTime.worldTurn).toBe(0)
    expect(run.operations[0].status).toBe('executing'); expect(run.operations[0].businessRefs).toHaveLength(1)
    await stopTtrpgOpenTableHostingV1(input)
    expect((await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.operations[0].businessRefs).toEqual(run.operations[0].businessRefs)
  })
  it('shows existing authority after reload but reading the table never starts the coordinator', async () => {
    const { input } = await quick(), before = await readProductRuntimeState(input.sessionId), count = await db.agentRunEvents.count()
    db.close(); await db.open()
    const view = await readTtrpgOpenTableV1(input)
    expect(view.player!.hosting).toMatchObject({ epochKey: input.epochKey, canDelegate: false, canResume: true, permission: { sourceRef: input.hostingDelegationRef } })
    expect(await readProductRuntimeState(input.sessionId)).toEqual(before); expect(await db.agentRunEvents.count()).toBe(count)
  })

  it('keeps a late paid response after explicit stop but never submits its automatic proposal', async () => {
    const { input, model } = await quick()
    await prepareTtrpgOpenCompanionInputV1({ ...await model(), modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    let calls = 0
    const result = await resumeTtrpgOpenHostingV1({ ...input, runAI: async () => {
      calls++; await stopTtrpgOpenTableHostingV1(input); return companion
    } })
    expect(result).toMatchObject({ reason: 'stopped' })
    const run = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!
    expect(run.coordination.calls[0]).toMatchObject({ status: 'succeeded', usage: { source: 'estimated', actualCostUsd: null } })
    expect(run.coordination.calls[0].responseArtifactHash).toBeTruthy()
    expect(run.operations).toEqual([]); expect(calls).toBe(1)
  })
  it('gives competing coordinators one real prepared send and at most one retained risky proposal', async () => {
    const { input, model } = await quick()
    await prepareTtrpgOpenCompanionInputV1({ ...await model(), modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const runAI = vi.fn(async () => companion)
    const result = await Promise.all([resumeTtrpgOpenHostingV1({ ...input, runAI }), resumeTtrpgOpenHostingV1({ ...input, runAI })])
    expect(result.every(r => ['needs-human', 'awaiting-result'].includes(r.reason))).toBe(true)
    const run = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!
    expect(runAI).toHaveBeenCalledTimes(1); expect(run.coordination.calls).toHaveLength(1)
    expect(run.operations.length).toBeLessThanOrEqual(1); expect(run.worldTime.worldTurn).toBe(0)
  })

  it('retains over-budget provider usage and hands back its blocked candidate without a replacement request', async () => {
    const { input, model } = await quick()
    await generateTtrpgOpenCompanionCandidateV1({ ...await model(), runAI: async (_messages, _signal, result) => {
      result.usage = { inputTokens: 200000, outputTokens: 40, totalTokens: 200040 }; return companion
    } })
    const runAI = vi.fn(async () => companion)
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'candidate-review' })
    const run = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!
    expect(run.coordination.calls[0]).toMatchObject({ status: 'succeeded', usage: { source: 'provider', inputTokens: 200000, actualCostUsd: null } })
    expect(run.operations).toEqual([]); expect(runAI).not.toHaveBeenCalled()
  })

  it('locates the winning request when an earlier competing preparation failed under the same contract', async () => {
    const { input, model } = await quick()
    const actualReserve = commands.reserveTtrpgOpenModelCallV1
    let entered!: () => void, release!: () => void
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(commands, 'reserveTtrpgOpenModelCallV1').mockImplementationOnce(async command => {
      entered(); await gate; return actualReserve(command)
    })
    const first = prepareTtrpgOpenCompanionInputV1({ ...await model(), modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const rejected = expect(first).rejects.toThrow()
    await waiting
    const prepared = await prepareTtrpgOpenCompanionInputV1({ ...await model(), modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    release(); await rejected; vi.restoreAllMocks()
    const rows = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).sortBy('id')
    expect(rows).toHaveLength(2); expect(rows[0].status).toBe('failed')
    expect(rows[0].contractHash).toBe(rows[1].contractHash); expect(rows[1].id).toBe(prepared.runId)
    const call = (await readProductRuntimeState(input.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    const runs = await readTtrpgOpenModelCallRunsV1({ ...input, calls: [call] })
    expect(runs.filter(row => row.contractHash === call.runContractHash).map(row => row.id)).toEqual([prepared.runId])
    const runAI = vi.fn(async () => companion)
    expect(await resumeTtrpgOpenHostingV1({ ...input, runAI })).toMatchObject({ reason: 'needs-human' })
    expect(runAI).toHaveBeenCalledTimes(1)
    const view = await readTtrpgOpenTableV1(input)
    expect(view.player!.operation?.operationKey).toBeTruthy()
    const projectId = await importProjectJSON(await exportProjectJSON(input.scope.projectId))
    const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const copyInput = { sessionId: copy.id!, scope: { projectId, worldId: copy.worldId!, workId: copy.workId! }, viewerKey: input.viewerKey }
    const restored = await readTtrpgOpenTableV1(copyInput)
    expect(restored.player!.operation?.operationKey).toBe(view.player!.operation?.operationKey)
    expect(restored.player!.hosting?.permission?.sourceRef).toEqual(input.hostingDelegationRef)
  })

})
