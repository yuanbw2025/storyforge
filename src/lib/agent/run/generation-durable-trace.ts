import type {
  GenerationNodeShadowTrace,
  PreparedGenerationNode,
} from '../../generation/generation-node'
import type {
  AgentRunEventPayloadByTypeV1,
  AgentRunEventTypeV1,
  AgentRunProjectionV1,
  AnyAgentRunEventV1,
  ContextManifestV1,
  WorkspaceScope,
} from '../../types'
import type { ChatMessage } from '../../types'
import {
  appendAgentRunEventV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { hashCanonicalValue } from './hash'

export interface GenerationNodeDurableTraceV1 extends GenerationNodeShadowTrace {
  readonly runId: number
  readonly stepId: string
  readonly events: readonly AnyAgentRunEventV1[]
  readonly traceErrors: readonly string[]
  candidatePersisted: (candidateHash: string, requiresConfirmation: boolean) => Promise<void>
  projection: () => AgentRunProjectionV1
}

function failureCode(phase: 'model' | 'gate' | 'adoption', error: unknown): string {
  if (phase === 'gate') return 'generation_gate_blocked'
  if (phase === 'adoption') return 'generation_adoption_failed'
  if (error instanceof Error && error.name === 'AbortError') return 'generation_cancelled'
  return 'generation_model_failed'
}

/**
 * Adapts an already-created durable run to the existing GenerationNode trace
 * port. It records hashes and lifecycle evidence only; prompts and model output
 * remain in their established UI/session owner.
 */
export function createGenerationNodeDurableTraceV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: string
  manifest?: ContextManifestV1
  now?: () => number
}): GenerationNodeDurableTraceV1 {
  if (input.snapshot.run.id == null) throw new Error('Durable trace 缺少持久化 runId')
  if (input.snapshot.projection.state !== 'planned') {
    throw new Error('Durable trace 只能绑定尚未执行的 planned run')
  }
  if (input.manifest) {
    if (input.manifest.runId !== input.snapshot.run.id || input.manifest.stepId !== input.stepId) {
      throw new Error('Durable trace 的 Context Manifest 与 run/step 不匹配')
    }
    if (
      input.manifest.scope.projectId !== input.snapshot.run.projectId
      || input.manifest.scope.worldGroupId !== (input.snapshot.run.worldGroupId ?? null)
    ) {
      throw new Error('Durable trace 的 Context Manifest 与 run scope 不匹配')
    }
  }

  let snapshot = input.snapshot
  let modelOutputHash: string | null = null
  const traceErrors: string[] = []
  const now = input.now ?? Date.now

  const append = async <T extends AgentRunEventTypeV1>(
    type: T,
    payload: AgentRunEventPayloadByTypeV1[T],
  ) => {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope,
      runId: snapshot.run.id,
      type,
      payload,
      expectedLastSequence: snapshot.projection.lastSequence,
      now: now(),
    })
  }

  return {
    runId: snapshot.run.id,
    stepId: input.stepId,
    get events() {
      return [...snapshot.events]
    },
    get traceErrors() {
      return [...traceErrors]
    },
    async beforeModel({ prepared, messages }: { prepared: PreparedGenerationNode; messages: ChatMessage[] }) {
      await append('step.scheduled', { stepId: input.stepId })
      await append('step.started', { stepId: input.stepId, attempt: 1 })
      if (input.manifest) {
        await append('context.assembled', {
          stepId: input.stepId,
          attempt: 1,
          manifestHash: input.manifest.manifestHash,
        })
      }
      await append('model.requested', {
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
      await append('model.responded', {
        stepId: input.stepId,
        attempt: 1,
        outputHash: modelOutputHash,
      })
    },
    async stepSucceeded(output: unknown) {
      const outputHash = modelOutputHash ?? await hashCanonicalValue(output)
      await append('step.succeeded', { stepId: input.stepId, attempt: 1, outputHash })
    },
    async candidatePersisted(candidateHash: string, requiresConfirmation: boolean) {
      await append('candidate.persisted', {
        stepId: input.stepId,
        attempt: 1,
        candidateHash,
        requiresConfirmation,
      })
    },
    async stepFailed({ phase, error }) {
      await append('step.failed', {
        stepId: input.stepId,
        attempt: 1,
        code: failureCode(phase, error),
        retryable: phase !== 'adoption',
      })
    },
    onTraceError(error: unknown) {
      traceErrors.push(error instanceof Error ? error.message : String(error))
    },
    projection() {
      return snapshot.projection
    },
  }
}
