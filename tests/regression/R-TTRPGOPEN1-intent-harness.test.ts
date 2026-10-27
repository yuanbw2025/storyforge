import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenIntentCandidateV1, executeTtrpgOpenIntentRequestV1,
  readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { startTtrpgOpenEpochV1, changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import type { ChatResult } from '../../src/lib/ai/client'
import type { ChatMessage } from '../../src/lib/types'

const output = JSON.stringify({ goal: '调查河港', method: '观察岸边', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
describe('R-TTRPGOPEN1 governed one-send intent transport and recoverable candidates', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function setup() {
    const fixture = await readyOpenTtrpgSessionV1('open semantic candidate', pkg => {
      pkg.ttrpg!.campaign.runtimePolicy.enabled = true
      pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50_000
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'intent.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '调查河港' })
    const input = { ...await openEnvelopeV1(fixture.sessionId, 'intent.prepare'), scope: fixture.scope,
      actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput: '调查河港', maximumOutputTokens: 800, maximumCostUsd: 0.1 }
    const resume = (prepared: { runId: number; requestKey: string }) => ({ scope: fixture.scope,
      sessionId: fixture.sessionId, viewerKey: OPEN_HUMAN_VIEWER, ...prepared })
    return { fixture, input, resume }
  }
  it('stores raw text and CreativeArtifact before human review, restores the same candidate without another send', async () => {
    const { fixture, input, resume } = await setup()
    const before = await readProductRuntimeState(fixture.sessionId)
    const declared = '这是角色提出的猜测，尚未验证'
    const runAI = vi.fn(async () => `\`\`\`json\n${JSON.stringify({ ...JSON.parse(output), declaredAssumptions: [declared] })}\n\`\`\``)
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...input, runAI })
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(generated.candidate.artifact.status).toBe('usable-with-warnings')
    expect(generated.candidate.intent).toMatchObject({ actorKey: 'hero', goal: '调查河港', source: 'player' })
    expect(generated.candidate.artifact.assumptions).toEqual([{ version: 1, id: 'assumption.0', text: declared,
      derivedFrom: [`raw-response:${generated.candidate.rawResponseHash}:declaredAssumptions[0]`], confidence: 'low', conflictsWith: [], status: 'provisional' }])
    expect(generated.candidate.artifact.originalText).toBe(await readAgentRunArtifactExactV1({ projectId: fixture.scope.projectId,
      artifactKind: 'raw-response', contentHash: generated.candidate.rawResponseHash }))
    const after = await readProductRuntimeState(fixture.sessionId)
    expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.coordination.calls[0].usage!.actualCostUsd).toBeNull()
    await db.agentRunCheckpoints.where('runId').equals(generated.prepared.runId).delete()
    db.close(); await db.open()
    expect(await readTtrpgOpenIntentCandidateV1(resume(generated.prepared))).toEqual(generated.candidate)
    expect(await executeTtrpgOpenIntentRequestV1({ ...resume(generated.prepared), runAI })).toEqual({ status: 'not-sent' })
    expect(runAI).toHaveBeenCalledTimes(1)
    const snapshot = await readInstanceAgentRunV1(fixture.scope, generated.prepared.runId)
    expect(snapshot.events.some(event => event.type === 'confirmation.recorded' || event.type === 'runtime.candidate.adopted')).toBe(false)
  })
  it('keeps an overlong declared assumption in raw evidence and a repair candidate without throwing or sending again', async () => {
    const { fixture, input, resume } = await setup(), raw = JSON.stringify({ ...JSON.parse(output), declaredAssumptions: ['a'.repeat(2001)] })
    const runAI = vi.fn(async () => raw), before = await readProductRuntimeState(fixture.sessionId)
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...input, runAI })
    expect(generated.candidate.intent).toBeNull(); expect(generated.candidate.artifact.assumptions).toEqual([])
    expect(generated.candidate.artifact.originalText).toBe(raw)
    expect(generated.candidate.artifact.issues.some(row => row.code === 'ttrpg-open-intent-protocol')).toBe(true)
    expect(await readTtrpgOpenIntentCandidateV1(resume(generated.prepared))).toEqual(generated.candidate)
    expect(await executeTtrpgOpenIntentRequestV1({ ...resume(generated.prepared), runAI })).toEqual({ status: 'not-sent' })
    expect(runAI).toHaveBeenCalledTimes(1)
    const after = await readProductRuntimeState(fixture.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  })
  it.each(['not-json', JSON.stringify({ ...JSON.parse(output), actorKey: 'other-human' }),
    JSON.stringify({ ...JSON.parse(output), targetRefs: ['secret.hidden-owner'] })])('retains invalid raw output with no automatic repair (%s)', async raw => {
    const { fixture, input } = await setup()
    const runAI = vi.fn(async () => raw)
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...input, runAI })
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(generated.candidate.artifact.status).toBe('manual-repair')
    expect(generated.candidate.intent).toBeNull()
    expect(generated.candidate.artifact.originalText).toBe(raw)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('succeeded')
  })
  it('records a charged response but blocks its candidate after a safety pause during generation', async () => {
    const { fixture, input } = await setup()
    const generated = await generateTtrpgOpenIntentCandidateV1({ ...input, runAI: async (_messages, _signal, result) => {
      await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'intent.pause'), status: 'paused',
        reason: '暂停', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
      result.usage = { inputTokens: 2200, outputTokens: 40, totalTokens: 2240 }
      return output
    } })
    expect(generated.candidate.artifact.status).toBe('blocked')
    expect(generated.candidate.artifact.issues.some(issue => issue.code === 'ttrpg-open-intent-stale')).toBe(true)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'succeeded',
      usage: { source: 'provider', inputTokens: 2200, outputTokens: 40, actualCostUsd: null } })
  })
  it('holds an uncertain external result, terminates the Run and never silently resends', async () => {
    const { fixture, input, resume } = await setup()
    const runAI = vi.fn(async () => { throw new Error('simulated transport interruption') })
    await expect(generateTtrpgOpenIntentCandidateV1({ ...input, runAI })).rejects.toThrow(/interruption/)
    const state = await readProductRuntimeState(fixture.sessionId), call = state.ttrpg!.openRun!.coordination.calls[0]
    expect(call.status).toBe('unknown')
    const run = await db.agentRuns.toCollection().first()
    expect((await readInstanceAgentRunV1(fixture.scope, run!.id!)).projection.state).toBe('failed')
    expect(await executeTtrpgOpenIntentRequestV1({ ...resume({ runId: run!.id!, requestKey: call.requestKey }), runAI })).toEqual({ status: 'not-sent' })
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('gives concurrent executors only one actual transport call', async () => {
    const { input, resume } = await setup()
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...input, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const runAI = vi.fn(async () => output)
    const results = await Promise.all([executeTtrpgOpenIntentRequestV1({ ...resume(prepared), runAI }),
      executeTtrpgOpenIntentRequestV1({ ...resume(prepared), runAI })])
    expect(results.map(result => result.status).sort()).toEqual(['candidate', 'not-sent'])
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('returns on human cancellation even when the transport ignores AbortSignal, preserving unknown usage', async () => {
    const { fixture, input } = await setup()
    const controller = new AbortController()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const generation = generateTtrpgOpenIntentCandidateV1({ ...input, signal: controller.signal, runAI: async () => {
      entered(); return new Promise<string>(() => {})
    } })
    const rejection = expect(generation).rejects.toThrow()
    await started; controller.abort()
    await rejection
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'unknown',
      usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null } })
  })
  it('blocks another request in the same epoch after a non-retryable provider denial', async () => {
    const { fixture, input } = await setup()
    const runAI = vi.fn(async (_messages: ChatMessage[], _signal: AbortSignal, result: ChatResult) => {
      result.requestLifecycle = { phase: 'response-observed', responseStatus: 403 }
      throw new Error('simulated denied request')
    })
    await expect(generateTtrpgOpenIntentCandidateV1({ ...input, runAI })).rejects.toThrow(/denied/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'failed',
      terminalReason: 'provider-denied-no-retry' })
    await expect(generateTtrpgOpenIntentCandidateV1({ ...input, ...await openEnvelopeV1(fixture.sessionId, 'intent.no-retry'), runAI })).rejects.toThrow(/回执/)
    expect(runAI).toHaveBeenCalledTimes(1)
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('rejects a different transport identity before the send permit', async () => {
    const { fixture, input, resume } = await setup()
    const prepared = await prepareTtrpgOpenIntentInputV1({ ...input, modelIdentity: { provider: 'ollama', model: 'author-chosen' } })
    const runAI = vi.fn(async () => output)
    await expect(executeTtrpgOpenIntentRequestV1({ ...resume(prepared), runAI })).rejects.toThrow(/冻结请求/)
    expect(runAI).not.toHaveBeenCalled()
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
})
