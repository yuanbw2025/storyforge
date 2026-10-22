import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenIntentInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { startTtrpgOpenEpochV1, dispatchTtrpgOpenModelCallV1, finishTtrpgOpenModelCallV1,
  changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { readInstanceAgentRunV1, appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { finalizeContextGatewayAttemptEvidenceV1, verifyContextGatewayCandidateEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { verifyTtrpgOpenInputEvidenceV1 } from '../../src/lib/ttrpg/open-input-evidence'
import { TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1 } from '../../src/lib/ttrpg/open-runtime-wire-budget'

describe('R-TTRPGOPEN1 actual progressive actor input before one authorized send', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  async function setup() {
    const fixture = await readyOpenTtrpgSessionV1('open actual input', pkg => {
      pkg.ttrpg!.campaign.runtimePolicy.enabled = true
      // Input/evidence lifecycle tests need room for the complete new wire.
      // The separate runtime-input-budget suite keeps the 10k refusal boundary.
      pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50_000
    })
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(fixture.sessionId, 'input.epoch'), viewerKey: OPEN_HUMAN_VIEWER,
      triggerKind: 'submit-action', rawInput: '调查河港' })
    const input = { ...await openEnvelopeV1(fixture.sessionId, 'input.prepare'), scope: fixture.scope,
      actorKey: 'hero', viewerKey: OPEN_HUMAN_VIEWER, rawInput: '调查河港', maximumOutputTokens: 800, maximumCostUsd: 0.1,
      modelIdentity: { provider: 'test-adapter', model: 'injected' } }
    return { fixture, input }
  }
  it('freezes real selected sources and exact request, without inventing a model response or candidate', async () => {
    const { fixture, input } = await setup()
    const prepared = await prepareTtrpgOpenIntentInputV1(input)
    const snapshot = await readInstanceAgentRunV1(fixture.scope, prepared.runId)
    expect(snapshot.events.some(event => event.type === 'context.assembled' || event.type === 'model.responded'
      || event.type === 'candidate.persisted')).toBe(false)
    expect(prepared.evidence.selector.selected.map(item => item.sourceKey)).toEqual(expect.arrayContaining(['ttrpgOpenAuthority', 'ttrpgOpenKnowledge']))
    expect(prepared.evidence.selector.selected.every(item => item.depth === 'full' && item.resourceKey.includes(':hero:'))).toBe(true)
    const rendered = await readAgentRunArtifactExactV1({ projectId: fixture.scope.projectId,
      artifactKind: 'rendered-request', contentHash: prepared.evidence.preflight.promptHash })
    expect(JSON.parse(rendered)).toEqual({ messages: prepared.messages, modelIdentity: input.modelIdentity,
      contextSelection: prepared.evidence.contextSelection, inputEstimation: TTRPG_OPEN_RUNTIME_INPUT_ESTIMATION_V1 })
    expect(rendered).not.toContain('effectPlanTemplates')
    const before = await readProductRuntimeState(fixture.sessionId)
    const envelope = { ...await openEnvelopeV1(fixture.sessionId, 'input.dispatch'), requestKey: prepared.requestKey,
      viewerKey: OPEN_HUMAN_VIEWER, runId: prepared.runId }
    expect((await dispatchTtrpgOpenModelCallV1(envelope)).sendAuthorized).toBe(true)
    expect((await dispatchTtrpgOpenModelCallV1(envelope)).sendAuthorized).toBe(false)
    const after = await readProductRuntimeState(fixture.sessionId)
    expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  })
  it('rejects a different human input and unknown budget before creating a Run', async () => {
    const { fixture, input } = await setup()
    const before = await readProductRuntimeState(fixture.sessionId)
    await expect(prepareTtrpgOpenIntentInputV1({ ...input, rawInput: '改变目标' })).rejects.toThrow(/同一真人输入/)
    await expect(prepareTtrpgOpenIntentInputV1({ ...input, maximumCostUsd: Number.NaN })).rejects.toThrow(/预算/)
    expect(await db.agentRuns.count()).toBe(0)
    expect(await readProductRuntimeState(fixture.sessionId)).toEqual(before)
  })
  it('refuses dispatch after safety revocation, while preserving the prepared input for audit', async () => {
    const { fixture, input } = await setup()
    const prepared = await prepareTtrpgOpenIntentInputV1(input)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(fixture.sessionId, 'input.pause'), status: 'paused',
      reason: '暂缓行动', changedBy: 'hero', viewerKey: OPEN_HUMAN_VIEWER })
    await expect(dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(fixture.sessionId, 'input.dispatch'),
      requestKey: prepared.requestKey, viewerKey: OPEN_HUMAN_VIEWER, runId: prepared.runId })).rejects.toThrow(/暂停|安全|stale/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('rejects missing exact preflight bytes at dispatch', async () => {
    const { fixture, input } = await setup()
    const prepared = await prepareTtrpgOpenIntentInputV1(input)
    const ref = prepared.evidence.preflight.artifacts.find(ref => ref.role === 'selector-result')!
    await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([fixture.scope.projectId, ref.artifactKind, ref.contentHash]).delete()
    await expect(dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(fixture.sessionId, 'input.dispatch'),
      requestKey: prepared.requestKey, viewerKey: OPEN_HUMAN_VIEWER, runId: prepared.runId })).rejects.toThrow(/artifact|available|工件/)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('rejects a forged selector without accepting its copied hash', async () => {
    const { fixture, input } = await setup()
    const prepared = await prepareTtrpgOpenIntentInputV1(input)
    const evidence = structuredClone(prepared.evidence)
    evidence.selector.selected[0].resourceKey = 'fact:ttrpg-open:forged-session:other-actor:authority'
    const runtime = (await readProductRuntimeState(fixture.sessionId)).ttrpg!
    await expect(verifyTtrpgOpenInputEvidenceV1({ scope: fixture.scope, sessionId: fixture.sessionId,
      sessionKey: runtime.sessionKey!, actorKey: 'hero', runId: prepared.runId, stepId: evidence.manifest.stepId,
      attempt: 1, evidence, requestHash: prepared.reservation.requestHash, inputManifestHash: evidence.manifest.manifestHash,
      mode: 'finish' })).rejects.toThrow(/selector-hash/)
  })
  it('does not create another Run while a previous request is still pending', async () => {
    const { fixture, input } = await setup()
    await prepareTtrpgOpenIntentInputV1(input)
    await expect(prepareTtrpgOpenIntentInputV1({ ...input, ...await openEnvelopeV1(fixture.sessionId, 'input.second') })).rejects.toThrow(/回执/)
    expect(await db.agentRuns.count()).toBe(1)
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls).toHaveLength(1)
  })
  it('uses the same preflight to finalize a genuine V3 receipt, retaining raw output before any parse', async () => {
    const { fixture, input } = await setup()
    const prepared = await prepareTtrpgOpenIntentInputV1(input)
    const envelope = async () => ({ ...await openEnvelopeV1(fixture.sessionId, 'input.terminal'),
      requestKey: prepared.requestKey, viewerKey: OPEN_HUMAN_VIEWER, runId: prepared.runId })
    await dispatchTtrpgOpenModelCallV1(await envelope())
    let snapshot = await readInstanceAgentRunV1(fixture.scope, prepared.runId)
    const output = '{"goal":"调查河港","method":"观察岸边","targetRefs":[],"declaredResources":[],"declaredAssumptions":[],"requestedOutcome":null}'
    const raw = await recordAgentRunArtifactV1({ scope: fixture.scope, runId: prepared.runId,
      productRuntimeSessionId: fixture.sessionId, artifactKind: 'raw-response', content: output,
      stepId: prepared.evidence.manifest.stepId, attempt: 1, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = await appendAgentRunEventV1({ scope: fixture.scope, runId: prepared.runId, productRuntimeSessionId: fixture.sessionId,
      type: 'model.responded', payload: { stepId: prepared.evidence.manifest.stepId, attempt: 1, outputHash: raw.artifact.contentHash },
      expectedLastSequence: raw.snapshot.projection.lastSequence })
    const candidateHash = await hashProductProductionValueV2(JSON.parse(output))
    const e = prepared.evidence
    const final = await finalizeContextGatewayAttemptEvidenceV1({ scope: fixture.scope, runId: prepared.runId,
      stepId: e.manifest.stepId, attempt: 1, baseManifest: e.manifest, preflight: e.preflight,
      selector: e.selector, sufficiency: e.sufficiency, retrievalTrace: e.retrievalTrace,
      gatewayVersionHash: e.gatewayVersionHash, policyHash: e.policyHash, rawResponse: output, candidateHash,
      expectedLastSequence: snapshot.projection.lastSequence })
    await appendAgentRunEventV1({ scope: fixture.scope, runId: prepared.runId, productRuntimeSessionId: fixture.sessionId,
      type: 'candidate.persisted', payload: { stepId: e.manifest.stepId, attempt: 1, candidateHash, requiresConfirmation: true },
      expectedLastSequence: final.snapshot.projection.lastSequence })
    await verifyContextGatewayCandidateEvidenceV1({ scope: fixture.scope, runId: prepared.runId,
      stepId: e.manifest.stepId, attempt: 1, candidateHash })
    await finishTtrpgOpenModelCallV1({ ...await envelope(), status: 'succeeded', responseArtifactHash: raw.artifact.contentHash,
      usage: { source: 'provider', inputTokens: 2000, outputTokens: 40, actualCostUsd: 0.01 }, terminalReason: 'response-recorded' })
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'succeeded',
      inputManifestHash: e.manifest.manifestHash, responseArtifactHash: raw.artifact.contentHash })
    expect(final.manifest.version).toBe(3)
  })
})
