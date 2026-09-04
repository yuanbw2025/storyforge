import {
  acceptAgentRunContract,
  appendAgentRunEventV1,
  allocateInMemoryAgentRunIdV1,
  createContextManifestFromAssemblyV1,
  createContextManifestV2FromV1,
  createAgentRunV1,
  createGenerationNodeDurableTraceV1,
  createGenerationNodeShadowTraceV1,
  hashCanonicalValue,
  readAgentRunV1,
  type AgentRunSnapshotV1,
  type GenerationNodeDurableTraceV1,
  type GenerationNodeShadowTraceV1,
} from '../agent/run'
import {
  finalizeContextGatewayAttemptEvidenceV1,
  recordContextGatewayPreflightEvidenceV1,
  type ContextGatewayPreflightEvidenceV1,
} from '../context-gateway/attempt-evidence'
import {
  assertAgentSkillBindingMatchesAssemblyV2,
  createAgentSkillExecutionBindingV2,
} from '../agent/execution-binding'
import {
  getAgentSkillV1,
  resolveAgentSkillContextSourceKeysV1,
} from '../agent/skill-registry'
import { getOrCreateAgentConversation } from '../agent/conversations'
import type { GenerationNodeShadowTrace } from '../generation/generation-node'
import {
  assertWorkspaceContentRevisionFreshV1,
  captureWorkspaceContentRevisionV1,
  type WorkspaceContentRevisionVectorV1,
} from '../authoring/content-revision'
import type { AssembleContextResult } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import type {
  AgentExecutionBoundaryV1,
  AgentRunContractV3,
  AgentSkillExecutionBindingV2,
  WorkspaceScope,
} from '../types'
import type { OutlineGenerationRequest } from './generation-request'
import {
  encodeGenerationOperation,
  outlineGenerationModuleKey,
} from './generation-request'
import {
  OUTLINE_GENERATION_CONVERSATION_PURPOSE,
  OUTLINE_GENERATION_TERMINAL_VERIFIER_V1,
  persistOutlineGenerationCandidateV1,
  type OutlineGenerationBatchRefV1,
  type OutlineGenerationCandidateV1,
} from './candidate-lifecycle'
import { outlineGatewayExecutionFromAssemblyV1 } from './gateway-context'

export * from './candidate-lifecycle'

function targetOutlineNodeId(request: OutlineGenerationRequest): number | undefined {
  if (request.kind === 'single-chapter') return request.chapterId
  if (request.kind === 'single-volume' || request.kind === 'chapters') return request.volumeId
  return undefined
}

function writeFields(request: OutlineGenerationRequest): string[] {
  if (request.kind === 'single-chapter' || request.kind === 'single-volume') return ['summary']
  return ['parentId', 'type', 'title', 'summary', 'order']
}

function outlineSkillId(request: OutlineGenerationRequest): 'outline.volumes' | 'outline.chapters' {
  return request.kind === 'volumes' || request.kind === 'single-volume'
    ? 'outline.volumes'
    : 'outline.chapters'
}

export function resolveOutlineGenerationSourceKeysV2(input: {
  request: OutlineGenerationRequest
  hasPriorOutlineCandidate?: boolean
}): string[] {
  const skill = getAgentSkillV1(outlineSkillId(input.request), 'outline')
  return resolveAgentSkillContextSourceKeysV1(skill, {
    includeOptional: input.hasPriorOutlineCandidate === true,
  })
}

export async function resolveOutlineGenerationExecutionBindingV2(input: {
  request: OutlineGenerationRequest
  priorOutlineCandidateText?: string
  executionBoundary?: AgentExecutionBoundaryV1
}): Promise<AgentSkillExecutionBindingV2> {
  const skill = getAgentSkillV1(outlineSkillId(input.request), 'outline')
  const priorText = input.priorOutlineCandidateText?.trim() ?? ''
  return createAgentSkillExecutionBindingV2(skill, {
    optionalContextActivations: priorText ? [{
      sourceKey: 'priorOutlineCandidate',
      reasonCode: 'prior-outline-candidate',
      boundaryHash: await hashCanonicalValue(priorText),
    }] : [],
    writeTargets: (input.executionBoundary ?? 'formal') === 'formal' ? [{
      table: 'outlineNodes',
      fields: writeFields(input.request),
      mode: 'author-confirmed',
    }] : [],
  })
}

async function outlineRunContract(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  priorOutlineCandidateText?: string
  executionBoundary: AgentExecutionBoundaryV1
  binding?: AgentSkillExecutionBindingV2
}): Promise<AgentRunContractV3> {
  const stepId = encodeGenerationOperation(input.request)
  const outlineNodeId = targetOutlineNodeId(input.request)
  const binding = input.binding ?? await resolveOutlineGenerationExecutionBindingV2({
    request: input.request,
    priorOutlineCandidateText: input.priorOutlineCandidateText,
    executionBoundary: input.executionBoundary,
  })
  assertAgentSkillBindingMatchesAssemblyV2(binding, input.assembled, `大纲 ${stepId}`)
  return {
    version: 3,
    executionBoundary: input.executionBoundary,
    objective: `生成${outlineGenerationModuleKey(input.request) === 'outline.volume' ? '卷纲' : '章纲'}候选：${stepId}`,
    workflowKind: input.executionBoundary === 'formal' ? 'long-running-resumable' : 'direct-generation',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: outlineNodeId == null ? undefined : [outlineNodeId],
    },
    permissions: {
      contextSourceKeys: [...binding.contextSourceKeys],
      writeTargets: binding.writeTargets.map(target => ({ ...target, fields: [...target.fields] })),
    },
    executionBindings: [{ stepId, ...binding }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: input.assembled.inputBudget,
      maxOutputTokens: binding.maxOutputTokens,
      maxAttemptsPerStep: 1,
    },
    acceptance: input.executionBoundary === 'formal' ? [
      { id: 'outline.output', kind: 'output-present', required: true },
      { id: 'outline.confirmed', kind: 'author-confirmed', required: true },
      { id: 'outline.adopted', kind: 'adoption-committed', required: true },
      { id: 'outline.post-state', kind: 'post-state-matches', required: true },
    ] : [
      { id: 'outline.output', kind: 'output-present', required: true },
    ],
    verificationPlan: input.executionBoundary === 'formal' ? [{
      id: 'outline.terminal',
      kind: 'terminal',
      verifier: OUTLINE_GENERATION_TERMINAL_VERIFIER_V1,
      criterionIds: [
        'outline.output',
        'outline.confirmed',
        'outline.adopted',
        'outline.post-state',
      ],
    }] : [{
      id: 'outline.shadow-terminal',
      kind: 'terminal',
      verifier: 'shadow-output-presence-v1',
      criterionIds: ['outline.output'],
    }],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
}

async function outlineManifest(input: {
  runId: number
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  binding: AgentSkillExecutionBindingV2
}) {
  const outlineNodeId = targetOutlineNodeId(input.request)
  return createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: encodeGenerationOperation(input.request),
    attempt: 1,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: input.binding.contextSourceKeys,
    assembled: input.assembled,
    boundary: outlineNodeId == null ? undefined : { outlineNodeId },
    readerVersion: 'assemble-context-v1',
  })
}

export async function createOutlineGenerationShadowTraceV1(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  priorOutlineCandidateText?: string
  binding?: AgentSkillExecutionBindingV2
  executionBoundary?: AgentExecutionBoundaryV1
}): Promise<GenerationNodeShadowTraceV1> {
  const runId = allocateInMemoryAgentRunIdV1()
  const stepId = encodeGenerationOperation(input.request)
  const executionBoundary = input.executionBoundary ?? 'evaluation'
  const binding = input.binding ?? await resolveOutlineGenerationExecutionBindingV2({
    ...input,
    executionBoundary,
  })
  const acceptedContract = await acceptAgentRunContract(await outlineRunContract({
    ...input,
    executionBoundary,
    binding,
  }))
  const manifest = await outlineManifest({
    runId,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    request: input.request,
    assembled: input.assembled,
    binding,
  })
  return createGenerationNodeShadowTraceV1({ runId, stepId, acceptedContract, manifest })
}

export interface OutlineGenerationTraceV1 extends GenerationNodeShadowTrace {
  readonly executionBoundary: AgentExecutionBoundaryV1
  readonly adoptable: boolean
  readonly mode: 'durable-shadow' | 'shadow-only'
  readonly shadow: GenerationNodeShadowTraceV1
  readonly durable?: GenerationNodeDurableTraceV1
  readonly initializationError?: string
  readonly traceErrors: readonly string[]
  persistCandidate: (output: string) => Promise<OutlineGenerationCandidateV1 | null>
  terminateRun: (input: { status: 'failed' | 'cancelled'; code: string }) => Promise<void>
}

export type OutlineGenerationTraceFaultBoundaryV1 =
  | 'trace-initialization'
  | 'before-model-evidence'
  | 'candidate-persistence'

function composeOutlineTraces(input: {
  shadow: GenerationNodeShadowTraceV1
  durable?: GenerationNodeDurableTraceV1
  scope?: WorkspaceScope
  conversationId?: number
  request: OutlineGenerationRequest
  batch?: OutlineGenerationBatchRefV1
  contentRevision?: WorkspaceContentRevisionVectorV1
  initializationError?: string
  executionBoundary: AgentExecutionBoundaryV1
  faultInjector?: (boundary: OutlineGenerationTraceFaultBoundaryV1) => void | Promise<void>
}): OutlineGenerationTraceV1 {
  const diagnostics: string[] = input.initializationError ? [input.initializationError] : []
  const traces: GenerationNodeShadowTrace[] = [input.shadow]
  if (input.durable) traces.push(input.durable)
  let persistedCandidate: OutlineGenerationCandidateV1 | null = null
  let pendingModelOutput: unknown
  const strict = input.executionBoundary === 'formal'
  const notify = async (action: (trace: GenerationNodeShadowTrace) => Promise<void>) => {
    for (const trace of traces) {
      try {
        await action(trace)
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error))
        try {
          trace.onTraceError?.(error)
        } catch {
          // Trace diagnostics must not replace the generation result.
        }
        if (strict) throw error
      }
    }
  }
  return {
    executionBoundary: input.executionBoundary,
    adoptable: strict && Boolean(input.durable),
    mode: input.durable ? 'durable-shadow' : 'shadow-only',
    shadow: input.shadow,
    durable: input.durable,
    initializationError: input.initializationError,
    get traceErrors() {
      return [...diagnostics]
    },
    async beforeModel(value) {
      if (input.faultInjector && !import.meta.env.PROD) {
        await input.faultInjector('before-model-evidence')
      }
      await notify(trace => trace.beforeModel(value))
    },
    // Durable model.responded is committed together with the candidate body.
    // The in-memory shadow still observes the response immediately.
    modelResponded: value => {
      pendingModelOutput = value
      return notify(trace => trace === input.durable
        ? Promise.resolve()
        : trace.modelResponded(value))
    },
    async candidateReady(output: unknown) {
      if (typeof output !== 'string') return
      if (!input.durable || !input.scope || input.conversationId == null) {
        if (strict) throw new Error('正式大纲运行缺少 durable candidate store')
        return
      }
      try {
        if (input.faultInjector && !import.meta.env.PROD) {
          await input.faultInjector('candidate-persistence')
        }
        persistedCandidate = await persistOutlineGenerationCandidateV1({
          scope: input.scope,
          conversationId: input.conversationId,
          request: input.request,
          durable: input.durable,
          output,
          batch: input.batch,
          contentRevision: input.contentRevision,
        })
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error))
        try {
          input.durable.onTraceError?.(error)
        } catch {
          // Candidate tracing remains behavior-neutral until the durable path is authoritative.
        }
        if (strict) throw error
      }
    },
    // The H0 shadow remains behavior-neutral. Durable outline runs do not
    // succeed until the persisted candidate has been confirmed and adopted.
    stepSucceeded: value => notify(trace => trace === input.shadow
      ? trace.stepSucceeded(value)
      : Promise.resolve()),
    stepFailed: value => notify(async trace => {
      // Successful candidates commit model.responded atomically with the
      // candidate body. A deterministic gate rejection has no candidate, so
      // persist its response hash immediately before the failure evidence.
      if (trace === input.durable && value.phase === 'gate') {
        await trace.modelResponded(pendingModelOutput)
      }
      await trace.stepFailed(value)
    }),
    async persistCandidate(output: string) {
      if (!output.trim()) return null
      if (!input.durable || !input.scope || input.conversationId == null) {
        if (strict) throw new Error('正式大纲运行缺少 durable candidate store')
        return null
      }
      if (persistedCandidate?.output === output) return persistedCandidate
      if (input.faultInjector && !import.meta.env.PROD) {
        await input.faultInjector('candidate-persistence')
      }
      persistedCandidate = await persistOutlineGenerationCandidateV1({
        scope: input.scope,
        conversationId: input.conversationId,
        request: input.request,
        durable: input.durable,
        output,
        batch: input.batch,
        contentRevision: input.contentRevision,
      })
      return persistedCandidate
    },
    async terminateRun({ status, code }) {
      if (!input.durable || !input.scope) return
      const projection = (await readAgentRunV1(input.scope, input.durable.runId)).projection
      if (['completed', 'failed', 'cancelled', 'recovery_required'].includes(projection.state)) return
      await appendAgentRunEventV1({
        scope: input.scope,
        runId: input.durable.runId,
        type: status === 'cancelled' ? 'run.cancelled' : 'run.failed',
        payload: status === 'cancelled'
          ? { reason: code.trim().slice(0, 200) || 'outline_generation_cancelled' }
          : { code: code.trim().slice(0, 160) || 'outline_generation_failed', retryable: false },
        expectedLastSequence: projection.lastSequence,
      })
    },
    onTraceError(error: unknown) {
      diagnostics.push(error instanceof Error ? error.message : String(error))
    },
  }
}

export async function createOutlineGenerationTraceV1(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
  priorOutlineCandidateText?: string
  batch?: OutlineGenerationBatchRefV1
  contentRevision?: WorkspaceContentRevisionVectorV1
  durable?: boolean
  executionBoundary?: AgentExecutionBoundaryV1
  /** Development/test-only deterministic interruption hook. */
  faultInjector?: (boundary: OutlineGenerationTraceFaultBoundaryV1) => void | Promise<void>
}): Promise<OutlineGenerationTraceV1> {
  const executionBoundary = input.executionBoundary ?? 'formal'
  const binding = await resolveOutlineGenerationExecutionBindingV2({ ...input, executionBoundary })
  assertAgentSkillBindingMatchesAssemblyV2(binding, input.assembled, `大纲 ${encodeGenerationOperation(input.request)}`)
  const shadow = await createOutlineGenerationShadowTraceV1({ ...input, executionBoundary, binding })
  const durableEnabled = input.durable ?? true
  if (!durableEnabled) {
    if (executionBoundary === 'formal') {
      throw new Error('正式大纲运行必须启用 durable Harness，已阻止模型调用。')
    }
    return composeOutlineTraces({
      shadow,
      request: input.request,
      batch: input.batch,
      executionBoundary,
      faultInjector: input.faultInjector,
    })
  }

  let created: AgentRunSnapshotV1 | null = null
  let scope: WorkspaceScope | null = null
  try {
    if (input.faultInjector && !import.meta.env.PROD) {
      await input.faultInjector('trace-initialization')
    }
    scope = await resolveScope({ projectId: input.projectId })
    const resolvedScope = scope
    const contentRevision = input.contentRevision ?? (executionBoundary === 'formal'
      ? await captureWorkspaceContentRevisionV1({
          scope,
          worldGroupId: input.worldGroupId,
        })
      : undefined)
    if (contentRevision) {
      await assertWorkspaceContentRevisionFreshV1(contentRevision, {
        scope,
        worldGroupId: input.worldGroupId,
      })
    }
    const conversation = await getOrCreateAgentConversation({
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      purpose: OUTLINE_GENERATION_CONVERSATION_PURPOSE,
      title: '大纲生成记录',
      scope,
    })
    if (conversation.id == null) throw new Error('大纲生成对话缺少持久化 ID')
    created = await createAgentRunV1({
      scope,
      worldGroupId: input.worldGroupId,
      conversationId: conversation.id,
      contract: await outlineRunContract({ ...input, executionBoundary, binding }),
    })
    const manifestV1 = await outlineManifest({
      runId: created.run.id,
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      request: input.request,
      assembled: input.assembled,
      binding,
    })
    const gatewayExecution = outlineGatewayExecutionFromAssemblyV1(input.assembled)
    if (executionBoundary === 'formal' && !gatewayExecution) {
      throw new Error('正式大纲运行缺少 required Context Gateway 执行结果，已阻止模型调用。')
    }
    const baseManifest = gatewayExecution
      ? await createContextManifestV2FromV1({ manifest: manifestV1, scope: resolvedScope })
      : null
    let preflight: ContextGatewayPreflightEvidenceV1 | null = null
    const durable = createGenerationNodeDurableTraceV1({
      scope: resolvedScope,
      snapshot: created,
      stepId: encodeGenerationOperation(input.request),
      ...(gatewayExecution && baseManifest ? {
        beforeModelEvidence: async ({ snapshot, messages }) => {
          const recorded = await recordContextGatewayPreflightEvidenceV1({
            scope: resolvedScope,
            runId: snapshot.run.id!,
            stepId: encodeGenerationOperation(input.request),
            attempt: 1,
            contextPacket: gatewayExecution.contextPacket,
            selector: gatewayExecution.selector,
            renderedRequest: messages,
            sourceSnapshots: gatewayExecution.sourceSnapshots,
            toolTranscript: gatewayExecution.toolTranscript,
            expectedLastSequence: snapshot.projection.lastSequence,
          })
          preflight = recorded.evidence
          return recorded.snapshot
        },
        afterModelRespondedEvidence: async ({ snapshot, output, candidateHash }) => {
          if (!preflight) throw new Error('大纲 Gateway 缺少模型调用前的 exact preflight 证据。')
          const finalized = await finalizeContextGatewayAttemptEvidenceV1({
            scope: resolvedScope,
            runId: snapshot.run.id!,
            stepId: encodeGenerationOperation(input.request),
            attempt: 1,
            baseManifest,
            preflight,
            selector: gatewayExecution.selector,
            sufficiency: gatewayExecution.sufficiency,
            retrievalTrace: gatewayExecution.retrievalTrace,
            gatewayVersionHash: gatewayExecution.contextPacket.gatewayVersionHash,
            policyHash: gatewayExecution.contextPacket.policyHash,
            rawResponse: output,
            candidateHash,
            expectedLastSequence: snapshot.projection.lastSequence,
          })
          return finalized.snapshot
        },
      } : { manifest: manifestV1 }),
    })
    return composeOutlineTraces({
      shadow,
      durable,
      scope,
      conversationId: conversation.id,
      request: input.request,
      batch: input.batch,
      contentRevision,
      executionBoundary,
      faultInjector: input.faultInjector,
    })
  } catch (error) {
    const initializationError = error instanceof Error ? error.message : String(error)
    if (created && scope) {
      await appendAgentRunEventV1({
        scope,
        runId: created.run.id,
        type: 'run.failed',
        payload: { code: 'trace_initialization_failed', retryable: true },
        expectedLastSequence: created.projection.lastSequence,
      }).catch(() => undefined)
    }
    if (executionBoundary === 'formal') throw error
    return composeOutlineTraces({
      shadow,
      request: input.request,
      batch: input.batch,
      initializationError,
      executionBoundary,
      faultInjector: input.faultInjector,
    })
  }
}
