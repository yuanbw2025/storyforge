import {
  acceptAgentRunContractV1,
  appendAgentRunEventV1,
  allocateInMemoryAgentRunIdV1,
  createContextManifestFromAssemblyV1,
  createAgentRunV1,
  createGenerationNodeDurableTraceV1,
  createGenerationNodeShadowTraceV1,
  type AgentRunSnapshotV1,
  type GenerationNodeDurableTraceV1,
  type GenerationNodeShadowTraceV1,
} from '../agent/run'
import { getOrCreateAgentConversation } from '../agent/conversations'
import type { GenerationNodeShadowTrace } from '../generation/generation-node'
import type { AssembleContextResult } from '../registry/types'
import { resolveScope } from '../world-engine/scope'
import type { AgentRunContractV1, WorkspaceScope } from '../types'
import type { OutlineGenerationRequest } from './generation-request'
import {
  encodeGenerationOperation,
  outlineGenerationModuleKey,
} from './generation-request'
import {
  OUTLINE_GENERATION_CONVERSATION_PURPOSE,
  persistOutlineGenerationCandidateV1,
  type OutlineGenerationCandidateV1,
} from './candidate-lifecycle'

export * from './candidate-lifecycle'

export const OUTLINE_GENERATION_SOURCE_KEYS = [
  'canonAssertions',
  'worldview',
  'storyCore',
  'activeNarrativeBlueprint',
  'characterDrivenPlan',
  'powerSystem',
  'cultivationProgress',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'foreshadows',
  'storyArcs',
  'storylineProgress',
  'existingVolumeOutlines',
  'writtenChapterProgress',
] as const

export const OUTLINE_DURABLE_HARNESS_STORAGE_KEY = 'storyforge:harness:outline-durable-v1'

export function isOutlineDurableHarnessEnabledV1(): boolean {
  try {
    return globalThis.localStorage?.getItem(OUTLINE_DURABLE_HARNESS_STORAGE_KEY) !== 'disabled'
  } catch {
    return true
  }
}

function targetOutlineNodeId(request: OutlineGenerationRequest): number | undefined {
  if (request.kind === 'single-chapter') return request.chapterId
  if (request.kind === 'single-volume' || request.kind === 'chapters') return request.volumeId
  return undefined
}

function writeFields(request: OutlineGenerationRequest): string[] {
  if (request.kind === 'single-chapter' || request.kind === 'single-volume') return ['summary']
  return ['parentId', 'type', 'title', 'summary', 'order']
}

function outlineRunContract(input: {
  projectId: number
  worldGroupId: number | null
  request: OutlineGenerationRequest
  assembled: AssembleContextResult
}): AgentRunContractV1 {
  const stepId = encodeGenerationOperation(input.request)
  const outlineNodeId = targetOutlineNodeId(input.request)
  return {
    version: 1,
    objective: `生成${outlineGenerationModuleKey(input.request) === 'outline.volume' ? '卷纲' : '章纲'}候选：${stepId}`,
    workflowKind: 'direct-generation',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: outlineNodeId == null ? undefined : [outlineNodeId],
    },
    permissions: {
      contextSourceKeys: [...OUTLINE_GENERATION_SOURCE_KEYS],
      writeTargets: [
        { table: 'outlineNodes', fields: writeFields(input.request), mode: 'candidate-only' },
      ],
    },
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: input.assembled.inputBudget,
      maxOutputTokens: 8_000,
      maxAttemptsPerStep: 1,
    },
    acceptance: [
      { id: 'outline.output-present', kind: 'output-present', required: true },
    ],
    verificationPlan: [
      {
        id: 'outline.shadow-terminal',
        kind: 'terminal',
        verifier: 'shadow-output-presence-v1',
        criterionIds: ['outline.output-present'],
      },
    ],
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
}) {
  const outlineNodeId = targetOutlineNodeId(input.request)
  return createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: encodeGenerationOperation(input.request),
    attempt: 1,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: OUTLINE_GENERATION_SOURCE_KEYS,
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
}): Promise<GenerationNodeShadowTraceV1> {
  const runId = allocateInMemoryAgentRunIdV1()
  const stepId = encodeGenerationOperation(input.request)
  const acceptedContract = await acceptAgentRunContractV1(outlineRunContract(input))
  const manifest = await outlineManifest({
    runId,
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    request: input.request,
    assembled: input.assembled,
  })
  return createGenerationNodeShadowTraceV1({ runId, stepId, acceptedContract, manifest })
}

export interface OutlineGenerationTraceV1 extends GenerationNodeShadowTrace {
  readonly mode: 'durable-shadow' | 'shadow-only'
  readonly shadow: GenerationNodeShadowTraceV1
  readonly durable?: GenerationNodeDurableTraceV1
  readonly initializationError?: string
  readonly traceErrors: readonly string[]
  persistCandidate: (output: string) => Promise<OutlineGenerationCandidateV1 | null>
}

function composeOutlineTraces(input: {
  shadow: GenerationNodeShadowTraceV1
  durable?: GenerationNodeDurableTraceV1
  scope?: WorkspaceScope
  conversationId?: number
  request: OutlineGenerationRequest
  initializationError?: string
}): OutlineGenerationTraceV1 {
  const diagnostics: string[] = input.initializationError ? [input.initializationError] : []
  const traces: GenerationNodeShadowTrace[] = [input.shadow]
  if (input.durable) traces.push(input.durable)
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
      }
    }
  }
  return {
    mode: input.durable ? 'durable-shadow' : 'shadow-only',
    shadow: input.shadow,
    durable: input.durable,
    initializationError: input.initializationError,
    get traceErrors() {
      return [...diagnostics]
    },
    beforeModel: value => notify(trace => trace.beforeModel(value)),
    modelResponded: value => notify(trace => trace.modelResponded(value)),
    // The H0 shadow remains behavior-neutral. Durable outline runs do not
    // succeed until the persisted candidate has been confirmed and adopted.
    stepSucceeded: value => notify(trace => trace === input.shadow
      ? trace.stepSucceeded(value)
      : Promise.resolve()),
    stepFailed: value => notify(trace => trace.stepFailed(value)),
    async persistCandidate(output: string) {
      if (!input.durable || !input.scope || input.conversationId == null || !output.trim()) return null
      return persistOutlineGenerationCandidateV1({
        scope: input.scope,
        conversationId: input.conversationId,
        request: input.request,
        durable: input.durable,
        output,
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
  durable?: boolean
}): Promise<OutlineGenerationTraceV1> {
  const shadow = await createOutlineGenerationShadowTraceV1(input)
  if ((input.durable ?? isOutlineDurableHarnessEnabledV1()) === false) {
    return composeOutlineTraces({ shadow, request: input.request })
  }

  let created: AgentRunSnapshotV1 | null = null
  let scope: WorkspaceScope | null = null
  try {
    scope = await resolveScope({ projectId: input.projectId })
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
      contract: outlineRunContract(input),
    })
    const manifest = await outlineManifest({
      runId: created.run.id,
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      request: input.request,
      assembled: input.assembled,
    })
    const durable = createGenerationNodeDurableTraceV1({
      scope,
      snapshot: created,
      stepId: encodeGenerationOperation(input.request),
      manifest,
    })
    return composeOutlineTraces({
      shadow,
      durable,
      scope,
      conversationId: conversation.id,
      request: input.request,
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
    return composeOutlineTraces({ shadow, request: input.request, initializationError })
  }
}
