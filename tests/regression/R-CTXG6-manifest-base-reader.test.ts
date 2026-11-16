import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  createContextManifestV1,
  createContextManifestV2FromV1,
  createContextManifestV3,
  verifyContextManifestIntegrityV2,
  verifyContextManifestIntegrityV3,
} from '../../src/lib/agent/run/context-manifest'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { executeContextGatewayV1 } from '../../src/lib/context-gateway/execution'
import {
  readContextGatewayManifestV3ForAttemptV1,
  recordContextGatewayPreflightEvidenceV1,
  verifyContextGatewayCandidateEvidenceV1,
} from '../../src/lib/context-gateway/attempt-evidence'
import { recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { generateWorkspaceUid, generateWorkCode } from '../../src/lib/memory/identity'
import type {
  AgentRunEventPayloadByTypeV1, AgentRunEventTypeV1,
  ContextManifestV2, ContextManifestV3,
} from '../../src/lib/types/agent-run'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const STEP = 'races'
const ATTEMPT = 1
const dispatch = vi.fn<typeof fetch>(async () => { throw new Error('Reader fixture must not dispatch') })

function contract(projectId: number) {
  return {
    version: 1,
    objective: '读取原 V2 基线与最终 V3 的准确证据',
    workflowKind: 'direct-generation', runtimeBindingHash: 'a'.repeat(64),
    scope: { projectId, worldGroupId: null },
    permissions: { contextSourceKeys: ['ragSelection'], writeTargets: [] },
    budget: { maxModelCalls: 1, maxToolCalls: 12, maxInputTokens: 24_000,
      maxOutputTokens: 2_000, maxAttemptsPerStep: 1 },
    acceptance: [{ id: 'candidate', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'terminal', kind: 'terminal', verifier: 'ctxg-base-reader-v1', criterionIds: ['candidate'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  }
}

type BaseBody = (base: ContextManifestV2, scope: WorkspaceScope) => Promise<string> | string

// A real isolated event/exact-artifact fixture, not a model or author-acceptance run.
// Every event is appended through the existing immutable ledger API.
async function completeAttempt(options: {
  baseBody?: BaseBody
  finalBody?: (manifest: ContextManifestV3) => ContextManifestV3
} = {}) {
  const { scope } = await seedCurrentWorkspace('Context Manifest 基线读取')
  const gateway = await executeContextGatewayV1({
    skill: getAgentSkillV1('world-origin.worldview-field'), scope,
    worldGroupId: null, query: '空作品的准确读取证据', additionalReadsEnabled: false,
  })
  expect(gateway.metrics.additionalPlanningModelCalls).toBe(0)
  let snapshot = await createAgentRunV1({ scope, contract: contract(scope.projectId) })
  const runId = snapshot.run.id
  async function append<T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
    snapshot = await appendAgentRunEventV1({ scope, runId, type, payload,
      expectedLastSequence: snapshot.projection.lastSequence })
  }
  const record = async (kind: 'context-manifest' | 'raw-response', content: string) => {
    const recorded = await recordAgentRunArtifactV1({ scope, runId, stepId: STEP, attempt: ATTEMPT,
      artifactKind: kind, content, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = recorded.snapshot
    return recorded.artifact
  }
  await append('step.scheduled', { stepId: STEP })
  await append('step.started', { stepId: STEP, attempt: ATTEMPT })
  const v1 = await createContextManifestV1({
    version: 1, runId, stepId: STEP, attempt: ATTEMPT,
    scope: { projectId: scope.projectId, worldGroupId: null }, inputBudget: 24_000,
    totalInputTokens: gateway.contextPacket.tokenCount,
    sources: [{ key: 'ragSelection', status: 'included', contentHash: gateway.contextPacket.contentHash,
      tokens: gateway.contextPacket.tokenCount }],
  })
  const base = await createContextManifestV2FromV1({ manifest: v1, scope })
  const preflight = await recordContextGatewayPreflightEvidenceV1({
    scope, runId, stepId: STEP, attempt: ATTEMPT,
    contextPacket: gateway.contextPacket, selector: gateway.selector,
    renderedRequest: { messages: [{ role: 'user', content: '原始只读测试请求' }] },
    sourceSnapshots: gateway.sourceSnapshots, toolTranscript: gateway.toolTranscript,
    expectedLastSequence: snapshot.projection.lastSequence,
  })
  snapshot = preflight.snapshot
  if (options.baseBody) await record('context-manifest', await options.baseBody(base, scope))
  const candidateHash = await sha256Text('原始候选正文')
  await append('model.requested', { stepId: STEP, attempt: ATTEMPT, bindingHash: preflight.evidence.promptHash })
  await append('model.responded', { stepId: STEP, attempt: ATTEMPT, outputHash: candidateHash })
  const raw = await record('raw-response', canonicalStringify({ content: '原始候选正文' }))
  const manifest = await createContextManifestV3({
    manifest: base, scopeFingerprint: preflight.evidence.contextPacket.scopeFingerprint,
    gatewayVersionHash: gateway.contextPacket.gatewayVersionHash, policyHash: gateway.session.policyHash,
    selectorPolicyId: gateway.selector.selectorPolicyId, selectorHash: gateway.selector.selectorHash,
    selectorArtifactHash: preflight.evidence.selectorArtifactHash, inventoryHash: gateway.selector.inventoryHash,
    catalogVersion: gateway.retrievalTrace.catalogVersion, contextPacketHash: gateway.contextPacket.packetHash,
    sufficiency: gateway.sufficiency, retrievalTrace: gateway.retrievalTrace,
    artifacts: [...preflight.evidence.artifacts, { role: 'raw-response', artifactKind: raw.artifactKind,
      contentHash: raw.contentHash, byteLength: raw.byteLength }],
    promptHash: preflight.evidence.promptHash, candidateHash,
    workingContextGeneration: snapshot.projection.generation,
    packetArtifactHash: preflight.evidence.contextPacketArtifactHash,
  })
  const storedManifest = options.finalBody ? options.finalBody(manifest) : manifest
  const finalArtifact = await record('context-manifest', canonicalStringify(storedManifest))
  await append('context.assembled', { stepId: STEP, attempt: ATTEMPT, manifestHash: storedManifest.manifestHash })
  await append('candidate.persisted', { stepId: STEP, attempt: ATTEMPT, candidateHash, requiresConfirmation: true })
  return { scope, runId, stepId: STEP, attempt: ATTEMPT, base, manifest: storedManifest,
    finalArtifact, candidateHash, record }
}

async function allRows() {
  return Object.fromEntries(await Promise.all([...db.tables]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async table => [table.name, await table.toArray()] as const)))
}

async function expectRejectedWithoutWrites(fixture: Awaited<ReturnType<typeof completeAttempt>>, code: string) {
  const before = await allRows()
  await expect(readContextGatewayManifestV3ForAttemptV1(fixture)).rejects.toMatchObject({ code })
  expect(await allRows()).toEqual(before)
  expect(dispatch).not.toHaveBeenCalled()
}

async function rehashBase(base: ContextManifestV2, changes: Partial<ContextManifestV2>) {
  const { manifestHash: _oldHash, ...body } = { ...base, ...changes }
  const changed = { ...body, manifestHash: await hashCanonicalValue(body) }
  expect(await verifyContextManifestIntegrityV2(changed)).toBe(true)
  return canonicalStringify(changed)
}

describe('Context Gateway · bound V2 base and unique final V3 reader', () => {
  beforeEach(async () => {
    await db.delete(); await db.open(); dispatch.mockClear(); vi.stubGlobal('fetch', dispatch)
  })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('preserves the existing V3-only read and candidate chain with native zero writes', async () => {
    const fixture = await completeAttempt()
    const before = await allRows()
    const read = await readContextGatewayManifestV3ForAttemptV1(fixture)
    expect(read.manifest).toEqual(fixture.manifest)
    expect(read.manifestArtifactHash).toBe(fixture.finalArtifact.contentHash)
    expect(await verifyContextManifestIntegrityV3(read.manifest)).toBe(true)
    expect((await verifyContextGatewayCandidateEvidenceV1(fixture)).manifest).toEqual(fixture.manifest)
    expect(await allRows()).toEqual(before); expect(dispatch).not.toHaveBeenCalled()
  })

  it('reads a valid exact V2 base alongside its final V3 without changing historical bytes', async () => {
    const fixture = await completeAttempt({ baseBody: canonicalStringify })
    expect(await verifyContextManifestIntegrityV2(fixture.base)).toBe(true)
    const before = await allRows()
    const read = await readContextGatewayManifestV3ForAttemptV1(fixture)
    expect(read.manifest.v2ManifestHash).toBe(fixture.base.manifestHash)
    expect(read.manifestArtifactHash).toBe(fixture.finalArtifact.contentHash)
    expect((await verifyContextGatewayCandidateEvidenceV1(fixture)).manifest).toEqual(fixture.manifest)
    expect(await allRows()).toEqual(before); expect(dispatch).not.toHaveBeenCalled()
  })

  it.each([
    ['bad-json', '{'], ['unknown-version', '{"version":4}'],
  ])('rejects an exact but %s manifest body', async (_label, content) => {
    const fixture = await completeAttempt({ baseBody: () => content })
    await expectRejectedWithoutWrites(fixture, 'manifest-body')
  })

  it('rejects a V2 whose exact artifact hash is valid but V2 integrity is broken', async () => {
    const fixture = await completeAttempt({ baseBody: base => canonicalStringify({ ...base, inputBudget: base.inputBudget + 1 }) })
    await expectRejectedWithoutWrites(fixture, 'manifest-integrity')
  })

  it('rejects a hash-valid V2 belonging to another actual native Run', async () => {
    const fixture = await completeAttempt({ baseBody: async (base, scope) => {
      const other = await createAgentRunV1({ scope, contract: contract(scope.projectId) })
      return rehashBase(base, { runId: other.run.id })
    } })
    await expectRejectedWithoutWrites(fixture, 'manifest-base')
  })

  it.each(['stepId', 'attempt', 'base-hash'] as const)('rejects a hash-valid V2 with another %s binding', async field => {
    const fixture = await completeAttempt({ baseBody: base => rehashBase(base,
      field === 'stepId' ? { stepId: 'another-step' }
        : field === 'attempt' ? { attempt: ATTEMPT + 1 } : { inputBudget: base.inputBudget + 1 }) })
    await expectRejectedWithoutWrites(fixture, 'manifest-base')
  })

  it.each(['projectId', 'worldGroupId', 'workspaceUid', 'worldCode', 'workCode'] as const)(
    'rejects a hash-valid V2 with another frozen scope.%s', async field => {
      const fixture = await completeAttempt({ baseBody: base => rehashBase(base, { scope: {
        ...base.scope,
        [field]: field === 'projectId' ? base.scope.projectId + 1
          : field === 'worldGroupId' ? 1 : field === 'workspaceUid' ? generateWorkspaceUid()
            : field === 'workCode' ? generateWorkCode() : `${base.scope.worldCode}-other`,
      } }) })
      await expectRejectedWithoutWrites(fixture, 'manifest-base')
    },
  )

  it('rejects a shape-valid V3 with a valid exact artifact hash but corrupt manifest integrity', async () => {
    const fixture = await completeAttempt({ finalBody: manifest => ({ ...manifest,
      candidate: { ...manifest.candidate, candidateHash: 'f'.repeat(64) } }) })
    expect(await verifyContextManifestIntegrityV3(fixture.manifest)).toBe(false)
    await expectRejectedWithoutWrites(fixture, 'manifest-integrity')
  })

  it('rejects two different exact bodies of the same final V3 rather than selecting one', async () => {
    const fixture = await completeAttempt()
    const duplicate = await fixture.record('context-manifest', JSON.stringify(fixture.manifest, null, 2))
    expect(duplicate.contentHash).not.toBe(fixture.finalArtifact.contentHash)
    await expectRejectedWithoutWrites(fixture, 'manifest-integrity')
  })
})
