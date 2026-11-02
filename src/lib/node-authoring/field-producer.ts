import Dexie from 'dexie'
import {
  chat, resolveRequestConfig, describeResolvedAIRequestSettingsV1,
} from '../ai/client'
import { db } from '../db/schema'
import type { WorkspaceScope, NodeRunRecord, AgentRunRecord, AgentRunEventRecord, AgentRunCheckpointRecord,
  AgentRunArtifactRecordV1, ExactRunArtifactKindV1 } from '../types'
import type { AgentRunEventPayloadByTypeV1, AgentRunEventTypeV1 } from '../types/agent-run'
import type { AssembleContextResult } from '../registry/types'
import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { finalizeContextGatewayAttemptEvidenceV1, recordContextGatewayPreflightEvidenceV1, verifyContextGatewayCandidateEvidenceV1,
  type ContextGatewayPreflightEvidenceV1 } from '../context-gateway/attempt-evidence'
import { createAgentSkillExecutionBindingV2, projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { executeFrozenFormalAIEntryV1, freezeFormalAIEntryBindingV1, assertFormalAIEntrySnapshotIntegrityV1 } from '../agent/formal-ai-entry'
import {
  createAgentRunV1, appendAgentRunEventV1, readAgentRunV1, type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { createContextManifestFromAssemblyV1, createContextManifestV2FromV1 } from '../agent/run/context-manifest'
import {
  recordCreationModelRequestV1, recordCreationModelResponseV1, recordUnavailableCreationResponseV1,
} from '../agent/run/creation-response-evidence'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { parseCreativeArtifactV1, type CreativeArtifactV1, type CreativeQualityModeV1 } from '../agent/creative-reliability'
import { createCreativeIssueV1 } from '../agent/creative-execution'
import { computeKnownCostUsd } from '../ai/usage-log'
import { parseWorldviewFieldCandidateDraft, type WorldviewFieldCopilotCandidate } from '../agent/worldview-field-copilot'
import { parseStoryCoreCandidateDraft, type StoryCoreCopilotCandidate } from '../agent/story-core-copilot'
import type { ContextManifestV2 } from '../types/agent-run'
import type { AuthoringBindingRead } from './bindings'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { assertRecordInScope } from '../workspace/scope'
import type { AuthoringNodeInstance, AuthoringNodeGraph, AuthoringCandidateDomain } from './contracts'
import { parseAuthoringGraph } from './graph-codec'
import { authoringExecutionSubgraph } from './graph'
import { AUTHORING_NODE_BY_ID } from './catalog'

type FieldProducerInput = {
  scope: WorkspaceScope
  worldGroupId: number | null
  nodeRunId: number
  node: AuthoringNodeInstance
  variantIndex: number
  family: 'worldview' | 'story-core'
  targetField: string
  assembled: AssembleContextResult
  gateway: ContextGatewayExecutionV1 | undefined
  targetSnapshot: unknown
}

type NodeFieldPayloadV1 = WorldviewFieldCopilotCandidate | StoryCoreCopilotCandidate
type NodeFieldDomainV1 = Extract<AuthoringCandidateDomain, { kind: 'worldview-field' | 'story-core-field' }>

// Closed, local-only evidence for these two existing field families. The real
// Run's existing tuple/contract/generation own identity; no Run ID is added to Node JSON.
interface NodeFieldCandidateBodyV1 {
  version: 1
  kind: 'node-field-candidate'
  portable: false
  payload: NodeFieldPayloadV1
  artifact: CreativeArtifactV1
  domain: NodeFieldDomainV1
  sourceBinding: AuthoringBindingRead
  requestArtifactHash: string
  responseArtifactHash: string
}
interface NodeFieldCandidateCheckpointV1 {
  version: 1
  kind: 'node-field-candidate'
  portable: false
  candidateHash: string
  manifestHash: string
  manifestArtifactHash: string
}

// The existing Node execution inputs, without presentation coordinates/title.
// This is a read precondition; stored Node JSON/signatures are never rewritten.
export function executionInput(graph: AuthoringNodeGraph, nodeId: string) {
  const selected = authoringExecutionSubgraph(graph, nodeId)
  return { version: selected.version, edges: selected.edges,
    nodes: selected.nodes.map(({ id, templateId, templateVersion, config, binding, inputs, outputs, disabled }) =>
      ({ id, templateId, templateVersion, config, binding, inputs, outputs, disabled })) }
}

// Keep native persistence causes visible through Node's existing string error
// carrier. Only Error data is followed; original objects remain in the cause.
function retainFailureMessages(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const messages = new Set<string>()
  const pending: Array<{ error: Error; depth: number }> = [{ error, depth: 0 }]
  const seen = new WeakSet<Error>([error])
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index]
    messages.add(current.error.message)
    if (current.depth >= 4) continue
    const enqueue = (value: unknown) => {
      if (!(value instanceof Error) || seen.has(value) || pending.length >= 32) return
      seen.add(value)
      pending.push({ error: value, depth: current.depth + 1 })
    }
    enqueue(Object.getOwnPropertyDescriptor(current.error, 'cause')?.value)
    const failures = Object.getOwnPropertyDescriptor(current.error, 'persistenceFailures')?.value
    if (Array.isArray(failures)) failures.slice(0, 8).forEach(enqueue)
  }
  return messages.size <= 1 ? error : Object.assign(new Error([...messages].join('\n')), {
    name: error.name, cause: error,
  })
}

/** One real Node slot owns one real Run and one mutation cursor. The original
 * Copilot still owns request construction, parsing, gating and adoption.
 */
export function createNodeFieldProducerV1(input: FieldProducerInput) {
  const fixed = {
    ...input, scope: { ...input.scope }, node: structuredClone(input.node),
    assembled: structuredClone(input.assembled), targetSnapshot: structuredClone(input.targetSnapshot),
    gateway: input.gateway ? {
      contextPacket: structuredClone(input.gateway.contextPacket),
      selector: structuredClone(input.gateway.selector),
      sourceSnapshots: structuredClone(input.gateway.sourceSnapshots),
      toolTranscript: structuredClone(input.gateway.toolTranscript),
      sufficiency: structuredClone(input.gateway.sufficiency),
      retrievalTrace: structuredClone(input.gateway.retrievalTrace),
    } : undefined,
  }
  const table = fixed.family === 'worldview' ? 'worldviews' : 'storyCores'
  const skill = structuredClone(getAgentSkillV1(fixed.family === 'worldview'
    ? 'world-origin.worldview-field' : 'world-origin.story-core', 'world-origin'))
  const entryId = fixed.family === 'worldview' ? 'node.worldview.field' : 'node.story-core.field'
  const stepId = 'node-field:generate'
  let snapshot: AgentRunSnapshotV1 | undefined
  let invoked = false
  let sealing = false
  let completed: {
    baseManifest: ContextManifestV2
    preflight: ContextGatewayPreflightEvidenceV1
    requestArtifactHash: string
    raw: string
    provider: string
    model: string
    usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
    latencyMs: number
  } | undefined

  async function append<T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
    if (!snapshot) throw new Error('节点生产尚无真实 Run，不能追加运行事件。')
    snapshot = await appendAgentRunEventV1({ scope: fixed.scope, runId: snapshot.run.id,
      type, payload, expectedLastSequence: snapshot.projection.lastSequence })
  }

  async function assertNodeExecutionCurrent() {
    const nodeRun = await db.nodeRuns.get(fixed.nodeRunId)
    const flow = nodeRun ? await db.nodeFlows.get(nodeRun.flowId) : undefined
    if (!nodeRun || !flow || nodeRun.status !== 'running'
      || !await assertRecordInScope(fixed.scope, 'nodeRuns', nodeRun, { owner: 'work' })
      || !await assertRecordInScope(fixed.scope, 'nodeFlows', flow, { owner: 'work' })) {
      throw new Error('节点生产必须绑定原作品中真实、仍在执行的 NodeRun 和节点图。')
    }
    const graph = parseAuthoringGraph(nodeRun.graphSnapshotJson)
    const originalNode = graph.nodes.find(node => node.id === fixed.node.id)
    const currentGraph = parseAuthoringGraph(flow.graphJson)
    const captured = { ...graph, nodes: graph.nodes.map(node => node.id === fixed.node.id ? fixed.node : node) }
    if (!originalNode || canonicalStringify(executionInput(graph, fixed.node.id))
        !== canonicalStringify(executionInput(captured, fixed.node.id))
      || canonicalStringify(executionInput(graph, fixed.node.id)) !== canonicalStringify(executionInput(currentGraph, fixed.node.id))) {
      throw new Error('节点生产的原图、节点或当前图已变化，未发送模型请求。')
    }
    return { nodeRun, flow }
  }

  const runModel = async (
    assertCurrent: () => Promise<void>,
    ...[messages, config, meta, signal, suppliedResult, options, suppliedResolution]: Parameters<typeof chat>
  ) => {
    // Capture plain request data before the first await; callbacks and signal
    // retain their real identities. No credentials enter persisted evidence.
    if (invoked) throw new Error('同一节点候选只能发送一次；请读取原 Run 证据。')
    invoked = true
    const requestMessages = structuredClone(messages)
    const requestConfig = { ...config }
    const requestMeta = { ...meta, configOverrides: meta?.configOverrides ? { ...meta.configOverrides } : undefined,
      transportRetryPolicy: 'none' as const, contextOverflowPolicy: 'reject' as const }
    const requestOptions = options ? structuredClone(options) : undefined
    const resolved = suppliedResolution ?? resolveRequestConfig(requestConfig, requestMeta)
    const frozenResolution = { ...resolved, config: { ...resolved.config } }
    const settings = describeResolvedAIRequestSettingsV1(frozenResolution, false, requestOptions)
    const result = suppliedResult ?? {}
    const template = AUTHORING_NODE_BY_ID.get(fixed.node.templateId)
    const expectedCategory = fixed.family === 'worldview' ? 'worldview.dimension' : 'story.core'
    if (!template || template.writes?.target !== table || template.writes.fields?.length !== 1
      || template.writes.fields[0] !== fixed.targetField || requestMeta.category !== template.promptModuleKey
      || requestMeta.category !== expectedCategory
      || requestMeta.projectId !== fixed.scope.projectId || !fixed.gateway
      || !Number.isInteger(fixed.variantIndex) || fixed.variantIndex < 0 || fixed.variantIndex >= 8
      || !Number.isFinite(frozenResolution.config.maxTokens)
      || frozenResolution.config.maxTokens <= 0 || frozenResolution.config.maxTokens > skill.maxOutputTokens) {
      throw new Error('节点生产的字段、请求、Gateway、候选槽位或 Skill 输出上限不匹配。')
    }
    const { nodeRun, flow } = await assertNodeExecutionCurrent()
    const tuple = { nodeRunId: fixed.nodeRunId, nodeProducerNodeId: fixed.node.id,
      nodeProducerVariantIndex: fixed.variantIndex, nodeProducerAttempt: 1 as const }
    const existing = await db.agentRuns.filter(row => row.nodeRunId === tuple.nodeRunId
      && row.nodeProducerNodeId === tuple.nodeProducerNodeId
      && row.nodeProducerVariantIndex === tuple.nodeProducerVariantIndex
      && row.nodeProducerAttempt === tuple.nodeProducerAttempt).first()
    if (existing) throw new Error('该候选已有原始运行证据；不能重新发送或创建替代 Run。')
    const binding = await createAgentSkillExecutionBindingV2(skill, {
      writeTargets: [{ table, fields: [fixed.targetField], mode: 'author-confirmed' }],
    })
    const formalEntry = await freezeFormalAIEntryBindingV1(entryId)
    const runtimeBindingHash = await hashCanonicalValue({ nodeId: fixed.node.id, templateId: fixed.node.templateId,
      variantIndex: fixed.variantIndex, settings, targetSnapshot: fixed.targetSnapshot })
    snapshot = await createAgentRunV1({ scope: fixed.scope, worldGroupId: fixed.worldGroupId,
      nodeProducer: { ...tuple, expectedNodeRunHash: await hashCanonicalValue(nodeRun), expectedFlowHash: await hashCanonicalValue(flow) },
      contract: {
        version: 3, executionBoundary: 'formal', workflowKind: 'direct-generation',
        objective: `${template.label}：第 ${fixed.variantIndex + 1} 个独立候选`,
        scope: { projectId: fixed.scope.projectId, worldGroupId: fixed.worldGroupId }, runtimeBindingHash,
        permissions: { contextSourceKeys: binding.contextSourceKeys, writeTargets: binding.writeTargets },
        executionBindings: [{ stepId, ...binding, formalEntry }],
        budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: fixed.assembled.inputBudget,
          maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
        acceptance: [
          { id: 'node-field.candidate', kind: 'output-present', required: true },
          { id: 'node-field.author', kind: 'author-confirmed', required: true },
          { id: 'node-field.post-state', kind: 'post-state-matches', required: true },
        ],
        verificationPlan: [{ id: 'node-field.terminal', kind: 'terminal', verifier: 'node-field-terminal-v1',
          criterionIds: ['node-field.candidate', 'node-field.author', 'node-field.post-state'] }],
        failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
      },
    })
    // createAgentRunV1 accepted/verified the complete binding. Dispatch uses
    // that immutable definition, even if the live registry later changes.
    const acceptedBinding = snapshot.contract.executionBindings?.[0]
    if (acceptedBinding?.version !== 2) throw new Error('节点生产缺少已验证的冻结 Skill binding。')
    const frozenSkill = projectFrozenAgentSkillDefinitionV1(acceptedBinding)
    await append('step.scheduled', { stepId })
    await append('step.started', { stepId, attempt: 1 })
    const manifestV1 = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId, attempt: 1,
      projectId: fixed.scope.projectId, worldGroupId: fixed.worldGroupId, declaredSourceKeys: binding.contextSourceKeys,
      assembled: fixed.assembled, readerVersion: 'node-field-context-v1' })
    const baseManifest = await createContextManifestV2FromV1({ manifest: manifestV1, scope: fixed.scope })
    const manifestEvidence = await recordAgentRunArtifactV1({ scope: fixed.scope, runId: snapshot.run.id,
      stepId, attempt: 1, artifactKind: 'context-manifest', content: canonicalStringify(baseManifest),
      expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = manifestEvidence.snapshot
    const preflight = await recordContextGatewayPreflightEvidenceV1({ scope: fixed.scope, runId: snapshot.run.id,
      stepId, attempt: 1, ...fixed.gateway, renderedRequest: { messages: requestMessages, settings },
      expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = preflight.snapshot
    const request = await recordCreationModelRequestV1({ scope: fixed.scope, snapshot, stepId, attempt: 1,
      contextManifestHash: baseManifest.manifestHash, messages: requestMessages })
    snapshot = request.snapshot
    // Reuse the original graph/owner and Copilot target checks after durable
    // preparation. These reads are not an atomic DB/network dispatch CAS.
    await assertNodeExecutionCurrent()
    await assertCurrent()
    signal?.throwIfAborted()
    await append('model.requested', { stepId, attempt: 1,
      bindingHash: await hashCanonicalValue({ runtimeBindingHash, requestArtifactHash: request.request.artifactHash,
        preflightHash: preflight.evidence.preflightHash }) })
    // The exact local request is saved before its existing single POST. No new
    // transport, generated request ID or borrowed receipt is introduced here.
    const originalPrepared = result.onCodexRequestPrepared
    const onPrepared: NonNullable<typeof originalPrepared> = async ref => {
      if (!snapshot) throw new Error('本机请求缺少原节点 Run。')
      const saved = await recordAgentRunArtifactV1({ scope: fixed.scope, runId: snapshot.run.id, stepId, attempt: 1,
        artifactKind: 'tool-result', content: JSON.stringify({ version: 'node-field-codex-request-v1', request: ref }),
        expectedLastSequence: snapshot.projection.lastSequence })
      snapshot = saved.snapshot
      const checkpoint = await createAgentRunCheckpointV1({ scope: fixed.scope, runId: snapshot.run.id,
        expectedLastSequence: snapshot.projection.lastSequence, resumePayload: {
          version: 1, kind: 'node-field-request', ...tuple, targetField: fixed.targetField,
          request: ref, requestArtifactHash: request.request.artifactHash,
        } })
      snapshot = checkpoint.snapshot
      await originalPrepared?.(ref)
    }
    if (frozenResolution.config.provider === 'codex') result.onCodexRequestPrepared = onPrepared
    let raw: string
    const startedAt = performance.now()
    try {
      // Runtime meta.category was checked above; these literal projections
      // preserve that value and make each real dispatcher binding machine-readable.
      raw = fixed.family === 'worldview'
        ? await executeFrozenFormalAIEntryV1('node.worldview.field', formalEntry, frozenSkill,
          'src/lib/node-authoring/field-producer.ts', requestMessages, requestConfig,
          { ...requestMeta, category: 'worldview.dimension' }, signal, result, requestOptions, frozenResolution)
        : await executeFrozenFormalAIEntryV1('node.story-core.field', formalEntry, frozenSkill,
          'src/lib/node-authoring/field-producer.ts', requestMessages, requestConfig,
          { ...requestMeta, category: 'story.core' }, signal, result, requestOptions, frozenResolution)
    } catch (error) {
      const unavailable = await recordUnavailableCreationResponseV1({ snapshot, request: request.request, result, error })
      snapshot = unavailable.snapshot
      try { await append('run.paused', { reason: 'node-field-model-outcome-unavailable', recoverable: false }) }
      catch (persistenceFailure) {
        throw Object.assign(new Error('节点模型返回未完成，暂停证据也未能完整保存。'), {
          cause: unavailable.report, persistenceFailures: [persistenceFailure],
        })
      }
      throw unavailable.report
    } finally {
      if (result.onCodexRequestPrepared === onPrepared) result.onCodexRequestPrepared = originalPrepared
    }
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt))
    snapshot = await recordCreationModelResponseV1({ snapshot, request: request.request, raw, result })
    await append('model.responded', { stepId, attempt: 1, outputHash: await hashCanonicalValue({ raw }) })
    completed = { baseManifest, preflight: preflight.evidence, requestArtifactHash: request.request.artifactHash,
      raw, provider: frozenResolution.config.provider, model: frozenResolution.config.model,
      usage: result.usage ? { ...result.usage } : null, latencyMs }
    return raw
  }

  async function sealCandidate(value: {
    payload: NodeFieldPayloadV1
    domain: NodeFieldDomainV1
    sourceBinding: AuthoringBindingRead
    qualityMode: CreativeQualityModeV1
  }): Promise<{ output: string; artifact: CreativeArtifactV1 }> {
    // The original Copilot parser and gate have already succeeded. Freeze only
    // their plain result and original handoff before any further await.
    const candidate = structuredClone(value)
    if (!snapshot || !completed || !fixed.gateway || sealing
      || snapshot.projection.state !== 'running' || candidate.payload.field !== fixed.targetField
      || candidate.domain.targetField !== fixed.targetField
      || candidate.domain.kind !== (fixed.family === 'worldview' ? 'worldview-field' : 'story-core-field')
      || canonicalStringify(candidate.domain.snapshot) !== canonicalStringify(fixed.targetSnapshot)) {
      throw new Error('字段候选未绑定原模型返回、原字段或原目标快照。')
    }
    await assertNodeExecutionCurrent()
    const responses = snapshot.events.filter((event): event is Extract<typeof event, { type: 'evidence.artifact.recorded' }> => (
      event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'raw-response' && event.payload.stepId === stepId && event.payload.attempt === 1))
    if (responses.length !== 1) throw new Error('字段候选需要唯一的原 B1 raw-response exact body。')
    const responseHash = responses[0].payload.contentHash
    const responseBody = await readAgentRunArtifactExactV1({ projectId: fixed.scope.projectId,
      artifactKind: 'raw-response', contentHash: responseHash })
    const response = JSON.parse(responseBody) as { version?: string; raw?: unknown; requestArtifactHash?: unknown;
      contextManifestHash?: unknown; observation?: { outcome?: string; usage?: unknown } }
    if (response.version !== 'creation-model-response-v1' || response.raw !== completed.raw
      || response.requestArtifactHash !== completed.requestArtifactHash
      || response.contextManifestHash !== completed.baseManifest.manifestHash
      || response.observation?.outcome !== 'returned'
      || canonicalStringify(response.observation.usage ?? null) !== canonicalStringify(completed.usage)) {
      throw new Error('字段候选的原 raw/request/usage 绑定不一致。')
    }
    const output = JSON.stringify(candidate.payload, null, 2)
    const assumptions = 'temporaryAssumptions' in candidate.payload ? candidate.payload.temporaryAssumptions ?? [] : []
    const artifact = parseCreativeArtifactV1({ version: 1, policyVersion: 'creative-reliability-v1',
      status: assumptions.length ? 'usable-with-warnings' : 'ready', qualityMode: candidate.qualityMode,
      originalText: completed.raw, editableText: output, validFragments: [], rejectedFragments: [],
      issues: assumptions.length ? [createCreativeIssueV1({ code: 'node-field-provisional-assumptions', path: '$.temporaryAssumptions',
        message: '候选含模型提出的临时假设；须由作者核对，尚未成为正式设定。', severity: 'warning',
        disposition: 'advisory', action: 'none' })] : [],
      assumptions: assumptions.map((text, index) => ({ version: 1, id: `node-field-assumption-${index + 1}`, text,
        derivedFrom: [`raw-response:${responseHash}`], confidence: 'low', conflictsWith: [], status: 'provisional' })),
      canonEvidenceRefs: completed.preflight.artifacts.filter(ref => ref.role === 'source-snapshot')
        .map(ref => `source-snapshot:${ref.contentHash}`),
      callEvidence: [{ version: 1, callIndex: 1, purpose: 'generate', status: 'succeeded',
        provider: completed.provider, model: completed.model,
        usageSource: completed.usage ? 'provider' : 'unknown', inputTokens: completed.usage?.inputTokens ?? null,
        outputTokens: completed.usage?.outputTokens ?? null, totalTokens: completed.usage?.totalTokens ?? null,
        latencyMs: completed.latencyMs, estimatedCostUsd: completed.usage
          ? computeKnownCostUsd(completed.model, completed.usage.inputTokens, completed.usage.outputTokens) : null,
        outputHash: await hashCanonicalValue(completed.raw) }], repair: null })
    const body: NodeFieldCandidateBodyV1 = { version: 1, kind: 'node-field-candidate', portable: false,
      payload: candidate.payload, artifact, domain: candidate.domain, sourceBinding: candidate.sourceBinding,
      requestArtifactHash: completed.requestArtifactHash, responseArtifactHash: responseHash }
    const candidateHash = await hashCanonicalValue(body)
    sealing = true
    const recorded = await recordAgentRunArtifactV1({ scope: fixed.scope, runId: snapshot.run.id, stepId, attempt: 1,
      artifactKind: 'tool-result', content: canonicalStringify(body), expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = recorded.snapshot
    if (recorded.artifact.contentHash !== candidateHash) throw new Error('字段候选正文与准确工件 hash 不一致。')
    const finalized = await finalizeContextGatewayAttemptEvidenceV1({ scope: fixed.scope, runId: snapshot.run.id,
      stepId, attempt: 1, baseManifest: completed.baseManifest, preflight: completed.preflight,
      selector: fixed.gateway.selector, sufficiency: fixed.gateway.sufficiency, retrievalTrace: fixed.gateway.retrievalTrace,
      gatewayVersionHash: fixed.gateway.contextPacket.gatewayVersionHash, policyHash: fixed.gateway.contextPacket.policyHash,
      // Already-saved exact B1 envelope STRING: dedup the same body/event, never
      // manufacture a second response or reserialize received raw/usage.
      rawResponse: responseBody, candidateHash, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = finalized.snapshot
    const resumePayload: NodeFieldCandidateCheckpointV1 = { version: 1, kind: 'node-field-candidate', portable: false,
      candidateHash, manifestHash: finalized.manifest.manifestHash, manifestArtifactHash: finalized.manifestArtifactHash }
    const checkpoint = await createAgentRunCheckpointV1({ scope: fixed.scope, runId: snapshot.run.id,
      resumePayload, expectedLastSequence: snapshot.projection.lastSequence })
    snapshot = checkpoint.snapshot
    await append('candidate.persisted', { stepId, attempt: 1, candidateHash, requiresConfirmation: true })
    return { output, artifact }
  }

  /** Parsing/length/stale failures follow saved raw. A persistence failure or
   * incomplete transport pauses instead of closing a possibly paid attempt.
   */
  async function fail(error: unknown): Promise<never> {
    if (snapshot) {
      try {
        snapshot = await readAgentRunV1(fixed.scope, snapshot.run.id)
        if (snapshot.projection.state === 'running') {
          if (sealing) {
            await append('run.paused', { reason: 'node-field-evidence-incomplete', recoverable: false })
          } else if (snapshot.events.some(event => event.type === 'model.responded'
            && event.payload.stepId === stepId && event.payload.attempt === 1)) {
            await append('step.failed', { stepId, attempt: 1, code: 'node-field-candidate-unavailable',
              retryable: false, category: 'protocol', action: 'fail' })
            await append('run.failed', { code: 'node-field-candidate-unavailable', retryable: false })
          } else {
            await append('run.paused', { reason: 'node-field-evidence-incomplete', recoverable: false })
          }
        }
      } catch (persistenceFailure) {
        throw retainFailureMessages(Object.assign(new Error('节点候选失败，原始错误与未完成的运行证据均需恢复核对。'), {
          cause: error, persistenceFailures: [persistenceFailure],
        }))
      }
    }
    throw retainFailureMessages(error)
  }
  return { runModel, sealCandidate, fail }
}

export class NodeFieldProducerWitnessConflictErrorV1 extends Error {
  constructor() { super('原节点候选的作用域、槽位或封存证据无法核验；未改写结果或重新调用模型。') }
}

// This is an ephemeral read/publication witness. Only prefix data is projected
// into the existing Node fields; no Run ID or recovery envelope is serialized.
export async function readNodeFieldProducerPrefixV1(input: {
  scope: WorkspaceScope
  nodeRun: NodeRunRecord
  node: AuthoringNodeInstance
  requestedCount: number
}, options: { includeDecided?: boolean } = {}) {
  const scope = { ...input.scope }, expectedRun = structuredClone(input.nodeRun)
  const node = structuredClone(input.node), count = input.requestedCount
  const failRead = (): never => { throw new Error('原节点候选的作用域、槽位或封存证据无法核验；未改写结果或重新调用模型。') }
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return failRead()
    return value as Record<string, unknown>
  }
  const decode = (value: string): unknown => {
    try { return JSON.parse(value) } catch (cause) {
      throw Object.assign(new Error('原节点候选的准确工件 JSON 无法核验。'), { cause })
    }
  }
  const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
    if (canonicalStringify(Object.keys(value).sort()) !== canonicalStringify([...keys].sort())) failRead()
  }
  const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
  if (expectedRun.id == null || scope.workId == null || !Number.isInteger(count) || count < 1 || count > 8
    || !expectedRun.graphSnapshotJson) return failRead()
  const nodeRunId = expectedRun.id
  const flow = await db.nodeFlows.get(expectedRun.flowId)
  if (!flow || !await assertRecordInScope(scope, 'nodeFlows', flow, { owner: 'work' })
    || !await assertRecordInScope(scope, 'nodeRuns', expectedRun, { owner: 'work' })) return failRead()
  const original = parseAuthoringGraph(expectedRun.graphSnapshotJson)
  const originalNode = original.nodes.find(row => row.id === node.id)
  const captured = { ...original, nodes: original.nodes.map(row => row.id === node.id ? node : row) }
  const template = AUTHORING_NODE_BY_ID.get(node.templateId)
  const world = template?.writes?.target === 'worldviews'
  if (!originalNode || canonicalStringify(executionInput(original, node.id))
      !== canonicalStringify(executionInput(captured, node.id))
    || !template || template.writes?.fields?.length !== 1
    || (!world && template.writes.target !== 'storyCores') || node.binding?.mode === 'live') return failRead()
  const field = template.writes.fields[0], table = world ? 'worldviews' : 'storyCores'
  const entryId = world ? 'node.worldview.field' : 'node.story-core.field'
  const skillId = world ? 'world-origin.worldview-field' : 'world-origin.story-core'
  const domainKind = world ? 'worldview-field' : 'story-core-field'
  const stepId = 'node-field:generate'
  const nativeInputs = record(decode(expectedRun.inputSnapshotsJson || '{}'))
  const savedInput = record(nativeInputs[node.id])
  if (savedInput.nodeId !== node.id || !Array.isArray(savedInput.inputs)
    || canonicalStringify(savedInput.config) !== canonicalStringify(node.config)) return failRead()
  const readRows = () => db.agentRuns.where('workId').equals(scope.workId!)
    .filter(row => row.nodeRunId === nodeRunId).sortBy('id')
  const producerRows = await readRows()
  const knownNodes = new Set(original.nodes.map(row => row.id))
  const tuples = new Set<string>()
  for (const row of producerRows) {
    const saved = row.nodeProducerNodeId ? nativeInputs[row.nodeProducerNodeId] : null
    const tuple = `${row.nodeProducerNodeId}:${row.nodeProducerVariantIndex}:${row.nodeProducerAttempt}`
    if (!row.nodeProducerNodeId || !knownNodes.has(row.nodeProducerNodeId) || !saved || tuples.has(tuple)) return failRead()
    tuples.add(tuple)
  }
  const slots = producerRows.filter(row => row.nodeProducerNodeId === node.id)
    .sort((left, right) => (left.nodeProducerVariantIndex ?? -1) - (right.nodeProducerVariantIndex ?? -1))
  if (slots.length > count || slots.some((row, index) => row.nodeProducerVariantIndex !== index
    || row.nodeProducerAttempt !== 1 || row.projectId !== scope.projectId || row.workId !== scope.workId
    || row.productRuntimeSessionId != null || row.productBuildId != null
    || (row.worldGroupId ?? null) !== (flow.worldGroupId ?? null))) return failRead()
  const artifacts = new Map<string, AgentRunArtifactRecordV1>()
  const ownedExactRefs = new Map<number, Map<string, { count: number; byteLength: number }>>()
  const exactRefKey = (ref: { artifactKind: ExactRunArtifactKindV1; contentHash: string; stepId?: string; attempt?: number }) =>
    canonicalStringify([ref.artifactKind, ref.contentHash, ref.stepId ?? null, ref.attempt ?? null])
  const producerSnapshots: AgentRunSnapshotV1[] = []
  const sealedSlots: Array<{ variantIndex: number; snapshot: AgentRunSnapshotV1;
    checkpoint: NodeFieldCandidateCheckpointV1; core: NodeFieldCandidateBodyV1;
    manifestHash: string; manifestArtifactHash: string; effectiveCandidateHash: string }> = []
  const ledgers: Array<{ run: AgentRunRecord; events: AgentRunEventRecord[]; checkpoints: AgentRunCheckpointRecord[] }> = []
  const exact = async (ref: { artifactKind: ExactRunArtifactKindV1; contentHash: string; byteLength?: number }) => {
    const content = await readAgentRunArtifactExactV1({ projectId: scope.projectId, ...ref })
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([scope.projectId, ref.artifactKind, ref.contentHash]).first()
    if (!row || row.id == null || row.content !== content || (ref.byteLength != null && row.byteLength !== ref.byteLength)) return failRead()
    artifacts.set(`${ref.artifactKind}:${ref.contentHash}`, row)
    return content
  }
  let prefix: { variants: string[]; creativeArtifacts: CreativeArtifactV1[]; domain: NodeFieldDomainV1;
    sourceBinding: AuthoringBindingRead; createdAt: number } | null = null
  for (const [index, row] of slots.entries()) {
    if (row.id == null) return failRead()
    const snapshot = await readAgentRunV1(scope, row.id)
    const binding = snapshot.contract.executionBindings?.[0]
    if (canonicalStringify(snapshot.run) !== canonicalStringify(row)
      || (snapshot.contract as Extract<AgentRunSnapshotV1['contract'], { version: 3 }>).executionBoundary !== 'formal' || snapshot.contract.workflowKind !== 'direct-generation'
      || snapshot.contract.executionBindings?.length !== 1 || binding?.version !== 2
      || binding.stepId !== stepId || binding.skillId !== skillId || !binding.formalEntry
      || canonicalStringify(binding.writeTargets) !== canonicalStringify([{ table, fields: [field], mode: 'author-confirmed' }])) return failRead()
    const frozenEntry = await assertFormalAIEntrySnapshotIntegrityV1(binding.formalEntry)
    if (frozenEntry.entryId !== entryId || frozenEntry.skillId !== skillId) return failRead()
    projectFrozenAgentSkillDefinitionV1(binding)
    const savedCheckpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, row.id)
    const events = await db.agentRunEvents.where('runId').equals(row.id).sortBy('sequence')
    const checkpoints = await db.agentRunCheckpoints.where('runId').equals(row.id).sortBy('id')
    const decodedEvents = events.map(({ id: _id, payloadJson, ...event }) => ({ version: 1, ...event, payload: decode(payloadJson) }))
    if (canonicalStringify(decodedEvents) !== canonicalStringify(snapshot.events)
      || (savedCheckpoint && (canonicalStringify(savedCheckpoint.snapshot.run) !== canonicalStringify(snapshot.run)
        || !checkpoints.some(value => canonicalStringify(value) === canonicalStringify(savedCheckpoint.checkpoint))))) return failRead()
    const runRefs = new Map<string, { count: number; byteLength: number }>()
    for (const event of snapshot.events) {
      if (event.type !== 'evidence.artifact.recorded') continue
      await exact(event.payload)
      const key = exactRefKey(event.payload), previous = runRefs.get(key)
      runRefs.set(key, { count: (previous?.count ?? 0) + 1, byteLength: event.payload.byteLength })
    }
    ownedExactRefs.set(row.id, runRefs)
    ledgers.push({ run: structuredClone(snapshot.run), events, checkpoints })
    producerSnapshots.push(snapshot)
    const candidateEvents = snapshot.events.filter((event): event is Extract<typeof event, { type: 'candidate.persisted' }> => event.type === 'candidate.persisted'
      && event.payload.stepId === stepId && event.payload.attempt === 1)
    if (candidateEvents.length > 1 || (candidateEvents.length === 1 && !candidateEvents[0].payload.requiresConfirmation)) return failRead()
    // Unknown, failed, in-flight and earlier sealing gaps retain their actual
    // original state. They are never turned into completed slots or resent.
    if (!candidateEvents.length || (!options.includeDecided && snapshot.projection.state !== 'awaiting_confirmation')) continue
    if (options.includeDecided && !['awaiting_confirmation', 'running', 'verifying', 'completed'].includes(snapshot.projection.state)) return failRead()
    if (!savedCheckpoint || !savedCheckpoint.resumePayload) return failRead()
    const checkpoint = record(savedCheckpoint.resumePayload)
    exactKeys(checkpoint, ['version', 'kind', 'portable', 'candidateHash', 'manifestHash', 'manifestArtifactHash'])
    if (checkpoint.version !== 1 || checkpoint.kind !== 'node-field-candidate' || checkpoint.portable !== false
      || !hash(checkpoint.candidateHash) || !hash(checkpoint.manifestHash) || !hash(checkpoint.manifestArtifactHash)
      || candidateEvents[0].payload.candidateHash !== checkpoint.candidateHash
      || (!options.includeDecided && snapshot.projection.steps[stepId]?.candidateHash !== checkpoint.candidateHash)) return failRead()
    const effectiveCandidateHash = snapshot.projection.steps[stepId]?.candidateHash
    if (!effectiveCandidateHash) return failRead()
    const verified = await verifyContextGatewayCandidateEvidenceV1({ scope, runId: row.id, stepId, attempt: 1,
      candidateHash: options.includeDecided ? effectiveCandidateHash : checkpoint.candidateHash })
    if (verified.manifest.manifestHash !== checkpoint.manifestHash
      || verified.manifestArtifactHash !== checkpoint.manifestArtifactHash) return failRead()
    const coreText = await exact({ artifactKind: 'tool-result', contentHash: checkpoint.candidateHash })
    const core = record(decode(coreText))
    exactKeys(core, ['version', 'kind', 'portable', 'payload', 'artifact', 'domain', 'sourceBinding', 'requestArtifactHash', 'responseArtifactHash'])
    const domain = record(core.domain), target = record(domain.snapshot), source = record(core.sourceBinding)
    record(target.values)
    exactKeys(target, ['id', 'ragDocumentId', 'updatedAt', 'values', 'serialized', ...(world ? ['foundationState'] : [])])
    if (world && !['empty', 'partial', 'complete'].includes(String(target.foundationState))) return failRead()
    exactKeys(domain, ['kind', 'targetField', 'snapshot'])
    exactKeys(source, ['content', 'sourceHash', 'sourceKeys', 'included', 'omitted', 'trimmed', 'missing'])
    const payload = world ? parseWorldviewFieldCandidateDraft(JSON.stringify(core.payload)) : parseStoryCoreCandidateDraft(JSON.stringify(core.payload))
    const artifact = parseCreativeArtifactV1(core.artifact)
    if (core.version !== 1 || core.kind !== 'node-field-candidate' || core.portable !== false
      || domain.kind !== domainKind || domain.targetField !== field || payload.field !== field
      || (target.id !== null && (!Number.isSafeInteger(target.id) || (target.id as number) <= 0))
      || (target.ragDocumentId !== null && typeof target.ragDocumentId !== 'string')
      || (target.updatedAt !== null && (typeof target.updatedAt !== 'number' || !Number.isFinite(target.updatedAt)))
      || typeof target.serialized !== 'string' || !target.values || typeof target.values !== 'object'
      || canonicalStringify(decode(target.serialized)) !== canonicalStringify({ id: target.id, ragDocumentId: target.ragDocumentId,
        updatedAt: target.updatedAt, values: target.values })
      || typeof source.content !== 'string' || typeof source.sourceHash !== 'string'
      || ['sourceKeys', 'included', 'omitted', 'trimmed', 'missing'].some(key => !Array.isArray(source[key])
        || !(source[key] as unknown[]).every(value => typeof value === 'string'))
      || artifact.editableText !== JSON.stringify(payload, null, 2)
      || !hash(core.requestArtifactHash) || !hash(core.responseArtifactHash)
      || await hashCanonicalValue(core) !== checkpoint.candidateHash) return failRead()
    const coreEvents = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
      && event.payload.stepId === stepId && event.payload.attempt === 1
      && event.payload.artifactKind === 'tool-result' && event.payload.contentHash === checkpoint.candidateHash)
    const rawRefs = verified.manifest.artifacts.filter(ref => ref.role === 'raw-response')
    const requestRefs = verified.manifest.artifacts.filter(ref => ref.role === 'rendered-request')
    if (coreEvents.length !== 1 || rawRefs.length !== 1 || rawRefs[0].contentHash !== core.responseArtifactHash
      || requestRefs.length !== 1) return failRead()
    const raw = record(decode(await exact({ artifactKind: 'raw-response', contentHash: core.responseArtifactHash })))
    const observation = record(raw.observation)
    const rendered = record(decode(await exact(requestRefs[0])))
    const settings = record(rendered.settings)
    if (raw.version !== 'creation-model-response-v1' || raw.raw !== artifact.originalText
      || raw.requestArtifactHash !== core.requestArtifactHash || raw.contextManifestHash !== verified.manifest.v2ManifestHash
      || observation.outcome !== 'returned' || !hash(raw.observationArtifactHash)
      || await hashCanonicalValue({ nodeId: node.id, templateId: node.templateId, variantIndex: index,
        settings, targetSnapshot: target }) !== snapshot.contract.runtimeBindingHash) return failRead()
    const observed = record(decode(await exact({ artifactKind: 'tool-result', contentHash: raw.observationArtifactHash })))
    if (observed.version !== 'creation-model-observation-v1' || observed.requestArtifactHash !== core.requestArtifactHash
      || observed.contextManifestHash !== raw.contextManifestHash
      || canonicalStringify(observed.observation) !== canonicalStringify(raw.observation)) return failRead()
    if (artifact.callEvidence.length !== 1 || artifact.callEvidence[0].outputHash !== await hashCanonicalValue(raw.raw)) return failRead()
    const call = artifact.callEvidence[0]
    if (call.callIndex !== 1 || call.purpose !== 'generate' || call.status !== 'succeeded'
      || call.provider !== settings.provider || call.model !== settings.model) return failRead()
    const usage = observation.usage == null ? null : record(observation.usage)
    if (usage ? call.usageSource !== 'provider' || call.inputTokens !== usage.inputTokens
      || call.outputTokens !== usage.outputTokens || call.totalTokens !== usage.totalTokens
      : call.usageSource !== 'unknown' || call.inputTokens !== null || call.outputTokens !== null || call.totalTokens !== null
        || call.estimatedCostUsd !== null) return failRead()
    if (index !== (prefix?.variants.length ?? 0)) return failRead()
    const body = core as unknown as NodeFieldCandidateBodyV1
    if (prefix && (canonicalStringify(prefix.domain) !== canonicalStringify(body.domain)
      || canonicalStringify(prefix.sourceBinding) !== canonicalStringify(body.sourceBinding))) return failRead()
    const coreRow = artifacts.get(`tool-result:${checkpoint.candidateHash}`)!
    prefix ??= { variants: [], creativeArtifacts: [], domain: body.domain, sourceBinding: body.sourceBinding, createdAt: coreRow.createdAt }
    prefix.variants.push(artifact.editableText); prefix.creativeArtifacts.push(artifact)
    sealedSlots.push({ variantIndex: index, snapshot, checkpoint: checkpoint as unknown as NodeFieldCandidateCheckpointV1,
      core: body, manifestHash: verified.manifest.manifestHash, manifestArtifactHash: verified.manifestArtifactHash, effectiveCandidateHash })
  }
  const assertSnapshotCurrent = async (mode: 'readonly' | 'readwrite') => {
    const changed = (): never => { throw new NodeFieldProducerWitnessConflictErrorV1() }
    if (Dexie.currentTransaction?.mode !== mode) return failRead()
    const current = await db.nodeRuns.get(nodeRunId), currentFlow = await db.nodeFlows.get(expectedRun.flowId)
    if (!current || !currentFlow || canonicalStringify(current) !== canonicalStringify(expectedRun)
      || canonicalStringify(currentFlow) !== canonicalStringify(flow)
      || !await assertRecordInScope(scope, 'nodeRuns', current, { owner: 'work' })
      || !await assertRecordInScope(scope, 'nodeFlows', currentFlow, { owner: 'work' })
      || canonicalStringify(await readRows()) !== canonicalStringify(producerRows)) return changed()
    for (const ledger of ledgers) {
      if (canonicalStringify(await db.agentRuns.get(ledger.run.id!)) !== canonicalStringify(ledger.run)
        || canonicalStringify(await db.agentRunEvents.where('runId').equals(ledger.run.id!).sortBy('sequence')) !== canonicalStringify(ledger.events)
        || canonicalStringify(await db.agentRunCheckpoints.where('runId').equals(ledger.run.id!).sortBy('id')) !== canonicalStringify(ledger.checkpoints)) return changed()
    }
    for (const row of artifacts.values()) {
      if (canonicalStringify(await db.agentRunArtifacts.get(row.id!)) !== canonicalStringify(row)) return changed()
    }
  }
  const assertCurrent = () => assertSnapshotCurrent('readwrite')
  const assertReadCurrent = () => assertSnapshotCurrent('readonly')
  const readExactBodyForRun = (runId: number, ref: { artifactKind: ExactRunArtifactKindV1; contentHash: string; stepId?: string; attempt?: number }) => {
    const link = ownedExactRefs.get(runId)?.get(exactRefKey(ref))
    const row = artifacts.get(`${ref.artifactKind}:${ref.contentHash}`)
    if (!link || link.count !== 1 || !row || row.retentionState !== 'available' || typeof row.content !== 'string'
      || row.byteLength !== link.byteLength) return failRead()
    return row.content
  }
  return { prefix, hasProducerEvidence: slots.length > 0, assertCurrent, assertReadCurrent, sealedSlots, producerSnapshots, readExactBodyForRun }
}
