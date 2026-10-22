import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../src/lib/types'
import type { ChatResult } from '../../src/lib/ai/client'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { setupChecksFixtureV1 } from '../helpers/open-ttrpg-checks'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { readTtrpgOpenTableV1, recoverTtrpgOpenTableResponseV1 } from '../../src/lib/ttrpg/open-table-service'
import { generateTtrpgOpenCompanionCandidateV1, generateTtrpgOpenKpCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { operationInput } from '../helpers/open-ttrpg-branch-recovery'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenIntentRequestV1, recoverTtrpgOpenRuntimeCandidateV1, readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import * as commands from '../../src/lib/ttrpg/runtime-commands'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as gateway from '../../src/lib/context-gateway/attempt-evidence'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

const output = JSON.stringify({ goal: '调查河港', method: '观察岸边', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
const interrupted = new Error('simulated browser close after durable write')
describe('R-TTRPGOPEN3 paid-response materialization recovery without transport', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  async function setup() {
    const fixture = await readyOpenTtrpgSessionV1('response recovery', pkg => { pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000 })
    await commands.startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'recovery.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '调查河港' })
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...await openEnvelopeV1(fixture.sessionId, 'recovery.prepare'), scope: fixture.scope,
      actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput: '调查河港', maximumOutputTokens: 800, maximumCostUsd: 0.1,
      modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const input = { scope: fixture.scope, sessionId: fixture.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
      runId: prepared.runId, requestKey: prepared.requestKey }
    const transport = { calls: 0 }
    const runAI = vi.fn(async (_messages: ChatMessage[], _signal: AbortSignal, result: ChatResult) => {
      transport.calls++
      result.usage = { inputTokens: 2200, outputTokens: 40, totalTokens: 2240 }
      return output
    })
    return { fixture, input, runAI, transport }
  }
  function interruptAt(boundary: string) {
    if (boundary === 'finished-call') {
      const actual = commands.finishTtrpgOpenModelCallV1
      vi.spyOn(commands, 'finishTtrpgOpenModelCallV1').mockImplementationOnce(async input => {
        await actual(input); throw interrupted
      })
    } else if (boundary === 'assembled-context') {
      const actual = gateway.finalizeContextGatewayAttemptEvidenceV1
      vi.spyOn(gateway, 'finalizeContextGatewayAttemptEvidenceV1').mockImplementationOnce(async input => {
        await actual(input); throw interrupted
      })
    } else if (boundary === 'persisted-candidate') {
      vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockRejectedValueOnce(interrupted)
    } else {
      const actual = artifacts.recordAgentRunArtifactV1
      vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
        const result = await actual(input)
        const value = typeof input.content === 'string' ? input.content : JSON.stringify(input.content)
        if (boundary === 'candidate-artifact' && input.artifactKind === 'source-snapshot'
          && value.includes('storyforge.ttrpg-open-intent-candidate')) throw interrupted
        if (boundary === 'manifest-artifact' && input.artifactKind === 'context-manifest') throw interrupted
        return result
      })
    }
  }
  it.each(['finished-call', 'candidate-artifact', 'manifest-artifact', 'assembled-context', 'persisted-candidate'])(
    'restores exactly once after %s and keeps actual usage, sources and mechanical state', async boundary => {
      const { fixture, input, runAI, transport } = await setup()
      interruptAt(boundary)
      await expect(executeTtrpgOpenIntentRequestV1({ ...input, runAI })).rejects.toThrow(interrupted)
      vi.restoreAllMocks()
      const before = await readProductRuntimeState(fixture.sessionId)
      const call = before.ttrpg!.openRun!.coordination.calls[0]
      expect(call).toMatchObject({ status: 'succeeded', usage: { source: 'provider', inputTokens: 2200, outputTokens: 40, actualCostUsd: null } })
      const saved = await db.agentRunArtifacts.where('projectId').equals(fixture.scope.projectId).toArray()
      const retained = saved.filter(row => row.artifactKind === 'source-snapshot' && row.content.includes('storyforge.ttrpg-open-intent-candidate'))
      db.close(); await db.open()
      const candidate = await recoverTtrpgOpenRuntimeCandidateV1(input)
      expect(candidate!.artifact.status).toBe('usable-with-warnings')
      expect(candidate!.artifact.callEvidence[0]).toMatchObject({ provider: 'test-adapter', model: 'injected', usageSource: 'provider', inputTokens: 2200, outputTokens: 40 })
      if (boundary === 'finished-call') expect(candidate!.artifact.callEvidence[0].latencyMs).toBeNull()
      else expect(candidate).toEqual(JSON.parse(retained[0].content))
      expect(await readTtrpgOpenIntentCandidateV1(input)).toEqual(candidate)
      expect(await recoverTtrpgOpenRuntimeCandidateV1(input)).toEqual(candidate)
      expect(await executeTtrpgOpenIntentRequestV1({ ...input, runAI })).toEqual({ status: 'not-sent' })
      expect(transport.calls).toBe(1)
      expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
      const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
      for (const type of ['model.requested', 'model.responded', 'context.assembled', 'candidate.persisted', 'checkpoint.created']) {
        expect(snapshot.events.filter(event => event.type === type)).toHaveLength(1)
      }
      expect(snapshot.events.some(event => event.type === 'confirmation.recorded' || event.type === 'runtime.candidate.adopted')).toBe(false)
    })
  it('arbitrates simultaneous recovery by existing Run CAS and produces one candidate', async () => {
    const { input, runAI, transport } = await setup()
    interruptAt('finished-call')
    await expect(executeTtrpgOpenIntentRequestV1({ ...input, runAI })).rejects.toThrow(interrupted)
    vi.restoreAllMocks()
    const recovered = await Promise.all([recoverTtrpgOpenRuntimeCandidateV1(input), recoverTtrpgOpenRuntimeCandidateV1(input)])
    expect(recovered[0]).toEqual(recovered[1])
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    expect(snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
    expect(transport.calls).toBe(1)
  })
  it('marks newly restored output blocked after a real safety pause without erasing the paid response', async () => {
    const { input, fixture, runAI, transport } = await setup()
    interruptAt('finished-call')
    await expect(executeTtrpgOpenIntentRequestV1({ ...input, runAI })).rejects.toThrow(interrupted)
    vi.restoreAllMocks()
    await commands.changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'recovery.pause'), status: 'paused', reason: '暂停', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
    const candidate = await recoverTtrpgOpenRuntimeCandidateV1(input)
    expect(candidate!.artifact.status).toBe('blocked')
    expect(candidate!.artifact.issues.some(issue => issue.code === 'ttrpg-open-intent-stale')).toBe(true)
    expect(transport.calls).toBe(1)
  })
  it('requires original viewer and exact retained raw bytes, without writing recovery evidence on rejection', async () => {
    const { input, fixture, runAI, transport } = await setup()
    interruptAt('finished-call')
    await expect(executeTtrpgOpenIntentRequestV1({ ...input, runAI })).rejects.toThrow(interrupted)
    vi.restoreAllMocks()
    const count = await db.agentRunEvents.count()
    await expect(recoverTtrpgOpenRuntimeCandidateV1({ ...input, viewerKey: 'other-human' })).rejects.toThrow(/无权/)
    const call = (await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    const raw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, 'raw-response', call.responseArtifactHash!]).first()
    await db.agentRunArtifacts.update(raw!.id!, { content: 'tampered' })
    await expect(recoverTtrpgOpenRuntimeCandidateV1(input)).rejects.toThrow()
    expect(await db.agentRunEvents.count()).toBe(count)
    expect(transport.calls).toBe(1)
  })
  it('does not claim a prepared, dispatched or unknown request has recoverable output', async () => {
    const { input } = await setup()
    expect(await recoverTtrpgOpenRuntimeCandidateV1(input)).toBeNull()
    await commands.dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(input.sessionId, 'recovery.dispatch'), ...input })
    expect(await recoverTtrpgOpenRuntimeCandidateV1(input)).toBeNull()
    await commands.finishTtrpgOpenModelCallV1({ ...await openEnvelopeV1(input.sessionId, 'recovery.unknown'), ...input,
      status: 'unknown', responseArtifactHash: null, usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'transport-result-unknown' })
    expect(await recoverTtrpgOpenRuntimeCandidateV1(input)).toBeNull()
  })
  it.each(['companion', 'kp'] as const)('restores %s after authority withdrawal and cannot auto-adopt it', async purpose => {
    const f = await setupChecksFixtureV1({ cooperative: true })
    await resumeTtrpgOpenChecksV1(f.command)
    const sessionId = f.command.sessionId, scope = f.f.scope, viewerKey = f.command.viewerKey
    const epoch = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.coordination.epochs[0]
    await commands.delegateTtrpgOpenHostingV1({ ...await openEnvelopeV1(sessionId, 'response.grant'), viewerKey,
      epochKey: epoch.epochKey, maximumCostUsdPerCall: 0.1, decision: 'delegate-this-epoch' })
    const grant = (await readProductRuntimeState(sessionId)).ttrpg!.openRun!.coordination.epochs[0].hostingDelegation!
    const input = { ...await openEnvelopeV1(sessionId, 'response.role'), scope, viewerKey, rawInput: '依据实际已知资料继续',
      maximumOutputTokens: 800, maximumCostUsd: 0.1, hostingDelegationRef: grant.sourceRef }
    interruptAt('finished-call')
    const raw = purpose === 'kp' ? JSON.stringify({ paragraphs: [{ text: '行动已有结果。', sourceKeys: ['action.receipt'] }] }) : output
    const generated = purpose === 'kp' ? generateTtrpgOpenKpCandidateV1({ ...input, runAI: async () => raw })
      : generateTtrpgOpenCompanionCandidateV1({ ...input, actorKey: 'companion.1', runAI: async () => raw })
    await expect(generated).rejects.toThrow(interrupted)
    vi.restoreAllMocks()
    await commands.stopTtrpgOpenHostingV1({ ...await openEnvelopeV1(sessionId, 'response.stop'), viewerKey,
      epochKey: epoch.epochKey, reason: '停止自动继续' })
    const before = await readProductRuntimeState(sessionId), call = before.ttrpg!.openRun!.coordination.calls.at(-1)!
    const run = (await db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray()).find(row => row.contractHash === call.runContractHash)
    const restored = await recoverTtrpgOpenRuntimeCandidateV1({ scope, sessionId, viewerKey, runId: run!.id!, requestKey: call.requestKey })
    expect(restored!.artifact.status).toBe('blocked')
    expect(restored!.artifact.callEvidence[0].latencyMs).toBeNull()
    const candidate = { ...await openEnvelopeV1(sessionId, 'response.denied'), viewerKey, runId: run!.id!, requestKey: call.requestKey,
      candidateHash: restored!.candidateHash, hostingDelegationRef: grant.sourceRef }
    if (purpose === 'kp') await expect(commands.acceptTtrpgOpenDelegatedKpNarrationV1({ ...await operationInput(sessionId, f.command.operationKey, 'narration'), ...candidate })).rejects.toThrow()
    else await expect(commands.startTtrpgOpenDelegatedCompanionOperationV1(candidate)).rejects.toThrow()
    expect(await readProductRuntimeState(sessionId)).toEqual(before)
  })
  it('projects an explicit player recovery affordance and keeps projection read-only', async () => {
    const { input, runAI, transport } = await setup()
    interruptAt('finished-call')
    await expect(executeTtrpgOpenIntentRequestV1({ ...input, runAI })).rejects.toThrow(interrupted)
    vi.restoreAllMocks()
    const eventCount = await db.agentRunEvents.count()
    const view = await readTtrpgOpenTableV1(input)
    expect(view.player!.candidates).toEqual([])
    expect(view.player!.candidateRecoveries).toEqual([{ runId: input.runId, requestKey: input.requestKey, purpose: '行动建议' }])
    expect(view.player!.blockedByModel).toBe(true)
    expect(await db.agentRunEvents.count()).toBe(eventCount)
    await recoverTtrpgOpenTableResponseV1(input)
    const restored = await readTtrpgOpenTableV1(input)
    expect(restored.player!.candidateRecoveries).toEqual([])
    expect(restored.player!.candidates).toHaveLength(1)
    expect(transport.calls).toBe(1)
  })

  it('rejects two different retained candidates instead of selecting or rewriting either', async () => {
    const { input, runAI } = await setup()
    interruptAt('candidate-artifact')
    await expect(executeTtrpgOpenIntentRequestV1({ ...input, runAI })).rejects.toThrow(interrupted)
    vi.restoreAllMocks()
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    const candidateRef = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded').at(-1)!
    if (candidateRef.type !== 'evidence.artifact.recorded') throw new Error('missing candidate artifact')
    const candidate = JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
      artifactKind: 'source-snapshot', contentHash: candidateRef.payload.contentHash }))
    const { candidateHash: _hash, ...body } = candidate
    body.artifact.editableText = 'a competing retained candidate'
    const alternate = { ...body, candidateHash: await hashCanonicalValue(body) }
    await artifacts.recordAgentRunArtifactV1({ scope: input.scope, productRuntimeSessionId: input.sessionId, runId: input.runId,
      artifactKind: 'source-snapshot', content: JSON.stringify(alternate), stepId: candidateRef.payload.stepId,
      attempt: candidateRef.payload.attempt, expectedLastSequence: snapshot.projection.lastSequence })
    const count = await db.agentRunEvents.count()
    await expect(recoverTtrpgOpenRuntimeCandidateV1(input)).rejects.toThrow(/多个候选/)
    expect(await db.agentRunEvents.count()).toBe(count)
  })

  it('lets original completion and recovery converge when their latency observations differ', async () => {
    const { input, runAI, transport } = await setup()
    const actual = artifacts.recordAgentRunArtifactV1
    let entered!: () => void, release!: () => void, delayed = false
    const waiting = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async write => {
      if (!delayed && write.artifactKind === 'source-snapshot' && write.content.includes('storyforge.ttrpg-open-intent-candidate')) {
        delayed = true; entered(); await gate
      }
      return actual(write)
    })
    const finishing = executeTtrpgOpenIntentRequestV1({ ...input, runAI })
    await waiting
    const recovered = await recoverTtrpgOpenRuntimeCandidateV1(input)
    release()
    const completed = await finishing
    expect(completed.status).toBe('candidate')
    if (completed.status === 'candidate') expect(completed.candidate).toEqual(recovered)
    const snapshot = await readInstanceAgentRunV1(input.scope, input.runId)
    expect(snapshot.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
    expect(await readTtrpgOpenIntentCandidateV1(input)).toEqual(recovered)
    expect(transport.calls).toBe(1)
  })

})
