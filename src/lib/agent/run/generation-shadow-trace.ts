import type {
  GenerationNodeShadowTrace,
  PreparedGenerationNode,
} from '../../generation/generation-node'
import type {
  AcceptedAgentRunContractV1,
  AgentRunEventPayloadByTypeV1,
  AgentRunEventTypeV1,
  AgentRunProjectionV1,
  AnyAgentRunEventV1,
  ContextManifestV1,
} from '../../types/agent-run'
import type { ChatMessage } from '../../types'
import { parseAgentRunEventV1 } from './event-schema'
import { hashCanonicalValue } from './hash'
import { replayAgentRunEventsV1 } from './projection'

export interface GenerationNodeShadowTraceV1 extends GenerationNodeShadowTrace {
  readonly runId: number
  readonly stepId: string
  readonly events: readonly AnyAgentRunEventV1[]
  readonly traceErrors: readonly string[]
  projection: () => AgentRunProjectionV1
}

const MAX_RECENT_SHADOW_TRACES = 20
const recentShadowTraces: GenerationNodeShadowTraceV1[] = []
let lastAllocatedRunId = 0

export function allocateInMemoryAgentRunIdV1(): number {
  const candidate = Date.now() * 1000
  lastAllocatedRunId = Math.max(candidate, lastAllocatedRunId + 1)
  return lastAllocatedRunId
}

export function listRecentGenerationShadowTracesV1(): readonly GenerationNodeShadowTraceV1[] {
  return [...recentShadowTraces]
}

export function clearRecentGenerationShadowTracesV1(): void {
  recentShadowTraces.splice(0, recentShadowTraces.length)
}

function errorCode(phase: 'model' | 'gate' | 'adoption', error: unknown): string {
  if (phase === 'gate') return 'generation_gate_blocked'
  if (phase === 'adoption') return 'generation_adoption_failed'
  if (error instanceof Error && error.name === 'AbortError') return 'generation_cancelled'
  return 'generation_model_failed'
}

export async function createGenerationNodeShadowTraceV1(input: {
  runId: number
  stepId: string
  acceptedContract: AcceptedAgentRunContractV1
  manifest?: ContextManifestV1
  now?: () => number
}): Promise<GenerationNodeShadowTraceV1> {
  const { contract, contractHash } = input.acceptedContract
  if (input.manifest) {
    if (input.manifest.runId !== input.runId || input.manifest.stepId !== input.stepId) {
      throw new Error('Shadow trace 的 Context Manifest 与 run/step 不匹配')
    }
    if (
      input.manifest.scope.projectId !== contract.scope.projectId
      || input.manifest.scope.worldGroupId !== contract.scope.worldGroupId
    ) {
      throw new Error('Shadow trace 的 Context Manifest 与 contract scope 不匹配')
    }
  }
  const events: AnyAgentRunEventV1[] = []
  const traceErrors: string[] = []
  const now = input.now ?? Date.now
  let modelOutputHash: string | null = null

  const append = <T extends AgentRunEventTypeV1>(
    type: T,
    payload: AgentRunEventPayloadByTypeV1[T],
  ) => {
    const event = parseAgentRunEventV1({
      version: 1,
      runId: input.runId,
      sequence: events.length + 1,
      generation: 1,
      projectId: contract.scope.projectId,
      worldGroupId: contract.scope.worldGroupId,
      contractHash,
      type,
      createdAt: now(),
      payload,
    })
    events.push(event)
  }

  append('run.created', { objectiveHash: await hashCanonicalValue(contract.objective) })
  append('contract.accepted', {})

  const trace: GenerationNodeShadowTraceV1 = {
    runId: input.runId,
    stepId: input.stepId,
    get events() {
      return [...events]
    },
    get traceErrors() {
      return [...traceErrors]
    },
    async beforeModel({ prepared, messages }: { prepared: PreparedGenerationNode; messages: ChatMessage[] }) {
      append('step.scheduled', { stepId: input.stepId })
      append('step.started', { stepId: input.stepId, attempt: 1 })
      if (input.manifest) {
        append('context.assembled', {
          stepId: input.stepId,
          attempt: 1,
          manifestHash: input.manifest.manifestHash,
        })
      }
      append('model.requested', {
        stepId: input.stepId,
        attempt: 1,
        bindingHash: await hashCanonicalValue({
          nodeId: prepared.nodeId,
          kind: prepared.kind,
          editableInput: prepared.editableInput,
          messages,
        }),
      })
    },
    async modelResponded(output: unknown) {
      modelOutputHash = await hashCanonicalValue(output)
      append('model.responded', {
        stepId: input.stepId,
        attempt: 1,
        outputHash: modelOutputHash,
      })
    },
    async stepSucceeded(output: unknown) {
      const outputHash = modelOutputHash ?? await hashCanonicalValue(output)
      append('step.succeeded', { stepId: input.stepId, attempt: 1, outputHash })
    },
    async stepFailed({ phase, error }) {
      append('step.failed', {
        stepId: input.stepId,
        attempt: 1,
        code: errorCode(phase, error),
        retryable: phase !== 'adoption',
      })
    },
    onTraceError(error: unknown) {
      traceErrors.push(error instanceof Error ? error.message : String(error))
    },
    projection() {
      return replayAgentRunEventsV1(events)
    },
  }
  recentShadowTraces.push(trace)
  if (recentShadowTraces.length > MAX_RECENT_SHADOW_TRACES) recentShadowTraces.shift()
  return trace
}
