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
import type { GenerationNodeShadowTrace } from '../generation/generation-node'
import type { AssembleContextResult } from '../registry/types'
import { resolveScope } from '../world-engine/scope'
import type { AgentRunContractV1 } from '../types'
import type { WorkspaceScope } from '../types'
import type { OutlineGenerationRequest } from './generation-request'
import { encodeGenerationOperation, outlineGenerationModuleKey } from './generation-request'

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
}

function composeOutlineTraces(input: {
  shadow: GenerationNodeShadowTraceV1
  durable?: GenerationNodeDurableTraceV1
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
    stepSucceeded: value => notify(trace => trace.stepSucceeded(value)),
    stepFailed: value => notify(trace => trace.stepFailed(value)),
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
    return composeOutlineTraces({ shadow })
  }

  let created: AgentRunSnapshotV1 | null = null
  let scope: WorkspaceScope | null = null
  try {
    scope = await resolveScope({ projectId: input.projectId })
    created = await createAgentRunV1({
      scope,
      worldGroupId: input.worldGroupId,
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
    return composeOutlineTraces({ shadow, durable })
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
    return composeOutlineTraces({ shadow, initializationError })
  }
}
