import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  createContextManifestV1,
  createContextManifestV2FromV1,
  parseContextManifestV3,
  verifyContextManifestIntegrityV3,
} from '../../src/lib/agent/run/context-manifest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  createContextPacketV1,
  createRetrievalTraceV1,
} from '../../src/lib/context-gateway/contracts'
import {
  exportContextGatewayDiagnosticV1,
  finalizeContextGatewayAttemptEvidenceV1,
  inspectContextGatewayManifestFreshnessV1,
  recordContextGatewayPreflightEvidenceV1,
  summarizeContextGatewayManifestForAuthorV1,
  verifyContextGatewayCandidateEvidenceV1,
} from '../../src/lib/context-gateway/attempt-evidence'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { selectContextResourcesV1 } from '../../src/lib/context-gateway/selector'
import { createContextGatewayToolSessionV1 } from '../../src/lib/context-gateway/tool-session'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import {
  createWorkingContextCompactionCheckpointV1,
  readWorkingContextReplayV1,
} from '../../src/lib/memory/working-context'
import { updateRagDocumentPolicy } from '../../src/lib/retrieval/rag-library'
import type {
  ContextAccessPolicyV1,
  ContextResourceDescriptorV1,
  RetrievalDecisionV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const NOW = 1_787_700_000_000

function policy(): ContextAccessPolicyV1 {
  return {
    version: 'context-access-policy-v1',
    policyId: 'ctxg6-worldview-v1',
    mandatorySourceKeys: ['ragSelection'],
    allowedSourceKeys: ['ragSelection'],
    allowedResourceKinds: ['worldview-field'],
    allowedDepths: ['index', 'summary', 'focused', 'full'],
    selectorPolicyId: 'selector-world-origin-v2',
    maxReadCalls: 12,
    maxRetrievedTokens: 10_000,
    allowOriginalRead: false,
    candidateAccess: 'forbidden',
  }
}

async function seed() {
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(), name: 'CTXG-6 证据项目', genre: 'fantasy', genres: ['fantasy'],
    status: 'drafting', description: '', targetWordCount: 1_000_000, createdAt: NOW, updatedAt: NOW,
  } as any) as number
  const ownership = await ensureWorkspaceOwnership(projectId)
  const worldviewId = await db.worldviews.add(stampNewRecord(ownership.scope, 'worldviews', {
    projectId, worldGroupId: null, races: '潮民依靠月相航行，不向无风海撤帆。',
    createdAt: NOW, updatedAt: NOW,
  }, { owner: 'world' }) as any) as number
  return { projectId, worldviewId, scope: ownership.scope }
}

function contract(projectId: number) {
  return {
    version: 1,
    objective: '生成种族与民族候选',
    workflowKind: 'direct-generation',
    scope: { projectId, worldGroupId: null },
    permissions: { contextSourceKeys: ['ragSelection'], writeTargets: [] },
    budget: {
      maxModelCalls: 1, maxToolCalls: 12, maxInputTokens: 10_000,
      maxOutputTokens: 2_000, maxAttemptsPerStep: 1,
    },
    acceptance: [{ id: 'candidate', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'ctxg6-v1', criterionIds: ['candidate'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  }
}

async function descriptors(scope: WorkspaceScope): Promise<ContextResourceDescriptorV1[]> {
  const items: ContextResourceDescriptorV1[] = []
  let cursor: string | undefined
  do {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({
      scope: { ...scope, worldGroupId: null }, kinds: ['worldview-field'], limit: 100, cursor,
    })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return items
}

function traced(decision: Awaited<ReturnType<typeof selectContextResourcesV1>>['selected'][number], descriptor: ContextResourceDescriptorV1, tokenCount: number): RetrievalDecisionV1 {
  return {
    resourceKey: decision.resourceKey,
    sourceKey: decision.sourceKey,
    reason: decision.reasonCodes.join('+'),
    depth: decision.depth,
    revision: decision.contentRevision,
    contentHash: decision.contentHash,
    policyRevision: decision.policyRevision,
    policyHash: decision.policyHash,
    sourceRefs: descriptor.sourceRefs,
    tokenCount,
  }
}

async function beginAttempt() {
  const fixture = await seed()
  let snapshot = await createAgentRunV1({ scope: fixture.scope, contract: contract(fixture.projectId), now: NOW + 1 })
  const append = async (type: any, payload: any) => {
    snapshot = await appendAgentRunEventV1({
      scope: fixture.scope, runId: snapshot.run.id, type, payload,
      expectedLastSequence: snapshot.projection.lastSequence, now: NOW + snapshot.projection.lastSequence + 2,
    } as any)
  }
  await append('step.scheduled', { stepId: 'races' })
  await append('step.started', { stepId: 'races', attempt: 1 })
  const session = await createContextGatewayToolSessionV1({ scope: { ...fixture.scope, worldGroupId: null }, policy: policy() })
  const catalog = await descriptors(fixture.scope)
  const descriptor = catalog.find(item => item.resourceKey.endsWith(':field:races'))!
  const selector = await selectContextResourcesV1({
    taskKind: 'agent-world-origin', accessPolicy: session.policy, scope: session.scope,
    descriptors: [descriptor], budgetTokens: 10_000, targetResourceKeys: [descriptor.resourceKey], readsAllowed: false,
  })
  const selected = selector.selected[0]
  const read = await CANON_RESOURCE_PROVIDER_V1.read({
    scope: session.scope, resourceKey: descriptor.resourceKey, depth: selected.depth, maxTokens: 2_000,
  })
  const decision = traced(selected, descriptor, read.tokenCount)
  const trace = await createRetrievalTraceV1({
    catalogVersion: CANON_RESOURCE_PROVIDER_V1.providerVersion,
    selectorPolicyId: selector.selectorPolicyId,
    mandatory: [decision], autoSelected: [], agentReads: [],
    omitted: selector.omitted.map(item => ({
      resourceKey: item.resourceKey, sourceKey: item.sourceKey,
      reasonCode: item.reasonCode, tokenEstimate: item.estimatedTokens,
    })),
    queries: [], fallbackUsed: false,
  })
  const gatewayVersionHash = await hashCanonicalValue({ gateway: 'ctxg6-v1' })
  const packet = await createContextPacketV1({
    scopeFingerprint: session.scopeFingerprint,
    gatewayVersionHash,
    policyHash: session.policyHash,
    sufficiencyReportHash: selector.sufficiency.reportHash,
    retrievalTraceHash: trace.traceHash,
    content: `【种族与民族】\n${read.content}`,
    sourceRefs: descriptor.sourceRefs,
  })
  const v1 = await createContextManifestV1({
    version: 1, runId: snapshot.run.id, stepId: 'races', attempt: 1,
    scope: { projectId: fixture.projectId, worldGroupId: null },
    inputBudget: 10_000, totalInputTokens: packet.tokenCount,
    sources: [{ key: 'ragSelection', status: 'included', contentHash: packet.contentHash, tokens: packet.tokenCount }],
  })
  const baseManifest = await createContextManifestV2FromV1({ manifest: v1, scope: fixture.scope })
  const renderedRequest = { messages: [{ role: 'user', content: `请生成新的种族设定。\n${packet.content}` }] }
  const preflight = await recordContextGatewayPreflightEvidenceV1({
    scope: fixture.scope, runId: snapshot.run.id, stepId: 'races', attempt: 1,
    contextPacket: packet, selector, renderedRequest,
    sourceSnapshots: [{
      sourceKey: descriptor.sourceKey, resourceKey: descriptor.resourceKey,
      sourceRefs: descriptor.sourceRefs, content: read.content,
    }],
    toolTranscript: [{
      toolName: 'read_context_resource', callIndex: 0,
      sourceKey: descriptor.sourceKey, resourceKey: descriptor.resourceKey,
      arguments: { resourceKey: descriptor.resourceKey, depth: selected.depth, maxTokens: 2_000 },
      result: { content: read.content, contentHash: read.contentHash, tokenCount: read.tokenCount },
    }],
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = preflight.snapshot
  return {
    ...fixture, session, descriptor, selector, trace, packet, baseManifest, renderedRequest,
    preflight: preflight.evidence, read,
    get snapshot() { return snapshot }, append,
  }
}

async function completeAttempt() {
  const fixture = await beginAttempt()
  const candidateText = '新候选：潮民以星潮评定成年仪式。'
  const candidateHash = await sha256Text(candidateText)
  await fixture.append('model.requested', { stepId: 'races', attempt: 1, bindingHash: fixture.preflight.promptHash })
  await fixture.append('model.responded', { stepId: 'races', attempt: 1, outputHash: candidateHash })
  const finalized = await finalizeContextGatewayAttemptEvidenceV1({
    scope: fixture.scope, runId: fixture.snapshot.run.id, stepId: 'races', attempt: 1,
    baseManifest: fixture.baseManifest, preflight: fixture.preflight,
    selector: fixture.selector, sufficiency: fixture.selector.sufficiency, retrievalTrace: fixture.trace,
    gatewayVersionHash: fixture.packet.gatewayVersionHash, policyHash: fixture.session.policyHash,
    rawResponse: { content: candidateText }, candidateHash,
    expectedLastSequence: fixture.snapshot.projection.lastSequence,
  })
  const candidateSnapshot = await appendAgentRunEventV1({
    scope: fixture.scope, runId: finalized.snapshot.run.id, type: 'candidate.persisted',
    payload: { stepId: 'races', attempt: 1, candidateHash, requiresConfirmation: true },
    expectedLastSequence: finalized.snapshot.projection.lastSequence,
  })
  return { ...fixture, snapshot: candidateSnapshot, candidateText, candidateHash, finalized }
}

describe('CTXG-6 · Manifest V3 and exact attempt evidence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('persists exact preflight before the model boundary and replays one candidate from its immutable V3 chain', async () => {
    const fixture = await completeAttempt()
    expect(await verifyContextManifestIntegrityV3(fixture.finalized.manifest)).toBe(true)
    const verified = await verifyContextGatewayCandidateEvidenceV1({
      scope: fixture.scope, runId: fixture.snapshot.run.id, stepId: 'races', attempt: 1,
      candidateHash: fixture.candidateHash,
    })
    const events = (await db.agentRunEvents.where('runId').equals(fixture.snapshot.run.id).sortBy('sequence'))
    const requested = events.findIndex(event => event.type === 'model.requested')
    expect(events.filter(event => event.type === 'evidence.artifact.recorded'
      && ['selector-result', 'context-packet', 'source-snapshot', 'tool-result', 'rendered-request'].includes(JSON.parse(event.payloadJson).artifactKind))
      .every(event => events.indexOf(event) < requested)).toBe(true)
    const requestRef = verified.manifest.artifacts.find(item => item.role === 'rendered-request')!
    expect(JSON.parse(verified.artifactBodies[`rendered-request:${requestRef.contentHash}`]))
      .toEqual(fixture.renderedRequest)
    expect(Object.values(verified.artifactBodies).some(body => body.includes(fixture.candidateText))).toBe(true)
    expect(events.findIndex(event => event.type === 'evidence.artifact.recorded'
      && JSON.parse(event.payloadJson).artifactKind === 'context-manifest'))
      .toBeLessThan(events.findIndex(event => event.type === 'context.assembled'))
    expect(events.findIndex(event => event.type === 'context.assembled'))
      .toBeLessThan(events.findIndex(event => event.type === 'candidate.persisted'))
    expect(summarizeContextGatewayManifestForAuthorV1(verified.manifest)).toMatchObject({
      selectedResources: 1, mandatoryResources: 1, evidenceStatus: 'complete',
    })
    const diagnostic = await exportContextGatewayDiagnosticV1({
      scope: fixture.scope, runId: fixture.snapshot.run.id, stepId: 'races', attempt: 1,
      candidateHash: fixture.candidateHash,
    })
    expect(diagnostic).toContain(fixture.candidateText)
    expect(diagnostic).not.toMatch(/api[-_]?key|authorization|thinking/i)
  })

  it('fails closed on preflight secrets, incoherent trace policy and duplicate finalize', async () => {
    const secretFixture = await beginAttempt()
    await expect(recordContextGatewayPreflightEvidenceV1({
      scope: secretFixture.scope, runId: secretFixture.snapshot.run.id, stepId: 'races', attempt: 1,
      contextPacket: secretFixture.packet, selector: secretFixture.selector,
      renderedRequest: { api_key: 'abcdefghijklmnopqrstuvwxyz' },
      expectedLastSequence: secretFixture.snapshot.projection.lastSequence,
    })).rejects.toThrow('禁止字段')
    expect((await db.agentRunEvents.where('runId').equals(secretFixture.snapshot.run.id).toArray())
      .some(event => event.type === 'model.requested')).toBe(false)

    await db.delete(); await db.open()
    const fixture = await beginAttempt()
    const candidateHash = await sha256Text('candidate')
    await fixture.append('model.requested', { stepId: 'races', attempt: 1, bindingHash: fixture.preflight.promptHash })
    await fixture.append('model.responded', { stepId: 'races', attempt: 1, outputHash: candidateHash })
    const badTrace = structuredClone(fixture.trace)
    badTrace.mandatory[0].policyHash = 'f'.repeat(64)
    const { traceHash: _old, ...traceBody } = badTrace
    badTrace.traceHash = await hashCanonicalValue(traceBody)
    await expect(finalizeContextGatewayAttemptEvidenceV1({
      scope: fixture.scope, runId: fixture.snapshot.run.id, stepId: 'races', attempt: 1,
      baseManifest: fixture.baseManifest, preflight: fixture.preflight,
      selector: fixture.selector, sufficiency: fixture.selector.sufficiency, retrievalTrace: badTrace,
      gatewayVersionHash: fixture.packet.gatewayVersionHash, policyHash: fixture.session.policyHash,
      rawResponse: 'candidate', candidateHash,
    })).rejects.toThrow('gateway-link')

    const good = await finalizeContextGatewayAttemptEvidenceV1({
      scope: fixture.scope, runId: fixture.snapshot.run.id, stepId: 'races', attempt: 1,
      baseManifest: fixture.baseManifest, preflight: fixture.preflight,
      selector: fixture.selector, sufficiency: fixture.selector.sufficiency, retrievalTrace: fixture.trace,
      gatewayVersionHash: fixture.packet.gatewayVersionHash, policyHash: fixture.session.policyHash,
      rawResponse: 'candidate', candidateHash,
    })
    await expect(finalizeContextGatewayAttemptEvidenceV1({
      scope: fixture.scope, runId: fixture.snapshot.run.id, stepId: 'races', attempt: 1,
      baseManifest: fixture.baseManifest, preflight: fixture.preflight,
      selector: fixture.selector, sufficiency: fixture.selector.sufficiency, retrievalTrace: fixture.trace,
      gatewayVersionHash: fixture.packet.gatewayVersionHash, policyHash: fixture.session.policyHash,
      rawResponse: 'candidate', candidateHash,
    })).rejects.toThrow('duplicate-finalize')
    expect(good.manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('separately reports content and retrieval-policy staleness without mutating historical bytes', async () => {
    const content = await completeAttempt()
    const before = await exportContextGatewayDiagnosticV1({
      scope: content.scope, runId: content.snapshot.run.id, stepId: 'races', attempt: 1,
      candidateHash: content.candidateHash,
    })
    await db.worldviews.update(content.worldviewId, { races: '新的航行禁忌。', updatedAt: NOW + 100 })
    const contentStale = await inspectContextGatewayManifestFreshnessV1({
      manifest: content.finalized.manifest, session: content.session,
    })
    expect(contentStale.status).toBe('stale')
    expect(contentStale.resources[0].status).toBe('content-stale')
    expect(await exportContextGatewayDiagnosticV1({
      scope: content.scope, runId: content.snapshot.run.id, stepId: 'races', attempt: 1,
      candidateHash: content.candidateHash,
    })).toBe(before)

    await db.delete(); await db.open()
    const retrieval = await completeAttempt()
    await updateRagDocumentPolicy({
      projectId: retrieval.projectId, scope: retrieval.scope,
      tableName: 'worldviews', recordId: retrieval.worldviewId, patch: { weight: 2 },
    })
    const policyStale = await inspectContextGatewayManifestFreshnessV1({
      manifest: retrieval.finalized.manifest, session: retrieval.session,
    })
    expect(policyStale.resources[0].status).toBe('policy-stale')
  })

  it('rejects a missing exact artifact even when the immutable event hashes still look valid', async () => {
    const fixture = await completeAttempt()
    const responseRef = fixture.finalized.manifest.artifacts.find(item => item.role === 'raw-response')!
    await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([fixture.projectId, responseRef.artifactKind, responseRef.contentHash]).delete()
    await expect(verifyContextGatewayCandidateEvidenceV1({
      scope: fixture.scope, runId: fixture.snapshot.run.id, stepId: 'races', attempt: 1,
      candidateHash: fixture.candidateHash,
    })).rejects.toThrow('artifact-unavailable')
    const tampered = structuredClone(fixture.finalized.manifest)
    tampered.candidate.candidateHash = 'f'.repeat(64)
    expect(await verifyContextManifestIntegrityV3(tampered)).toBe(false)
    const unknownNested = structuredClone(fixture.finalized.manifest) as any
    unknownNested.gateway.retrievalTrace.mandatory[0].untrusted = true
    expect(() => parseContextManifestV3(unknownNested)).toThrow('未知字段')
  })

  it('verifies every compaction base plus exact packets and fails when an older packet body disappears', async () => {
    const fixture = await beginAttempt()
    let snapshot = fixture.snapshot
    const recordPacket = async (content: string) => {
      const result = await recordAgentRunArtifactV1({
        scope: fixture.scope, runId: snapshot.run.id, artifactKind: 'context-packet', content,
        stepId: 'races', attempt: 1, expectedLastSequence: snapshot.projection.lastSequence,
      })
      snapshot = result.snapshot
      return result.artifact.contentHash
    }
    const firstOriginal = await recordPacket('{"packet":"first-original"}')
    const firstReplacement = await recordPacket('{"packet":"first-replacement"}')
    const first = await createWorkingContextCompactionCheckpointV1({
      scope: fixture.scope, runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence,
      originalPacketHash: firstOriginal, replacementPacketHash: firstReplacement,
      sources: [], strategy: 'ctxg6-test', provider: null, promptVersion: null,
      gatewayVersion: 'ctxg6-v1', beforeTokens: 100, afterTokens: 50,
      rawArtifactRefs: [firstOriginal, firstReplacement], now: NOW + 500,
    })
    snapshot = first.snapshot
    const secondOriginal = await recordPacket('{"packet":"second-original"}')
    const secondReplacement = await recordPacket('{"packet":"second-replacement"}')
    const second = await createWorkingContextCompactionCheckpointV1({
      scope: fixture.scope, runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence,
      originalPacketHash: secondOriginal, replacementPacketHash: secondReplacement,
      sources: [], strategy: 'ctxg6-test', provider: null, promptVersion: null,
      gatewayVersion: 'ctxg6-v1', beforeTokens: 50, afterTokens: 25,
      rawArtifactRefs: [secondOriginal, secondReplacement], now: NOW + 600,
    })
    const replay = await readWorkingContextReplayV1(fixture.scope, second.snapshot.run.id)
    expect(replay?.checkpointChainHashes).toEqual([first.checkpoint.checkpointHash, second.checkpoint.checkpointHash])
    expect((await readWorkingContextReplayV1(fixture.scope, second.snapshot.run.id))?.replayHash).toBe(replay?.replayHash)
    await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([fixture.projectId, 'context-packet', firstOriginal]).delete()
    await expect(readWorkingContextReplayV1(fixture.scope, second.snapshot.run.id))
      .rejects.toMatchObject({ code: 'packet-artifact-unavailable' })
  })
})
