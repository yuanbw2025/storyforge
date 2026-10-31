import type { ChatResult } from '../../ai/client'
import type { ChatMessage, WorkspaceScope } from '../../types'
import { recordAgentRunArtifactV1 } from '../../memory/artifact-store'
import type { AgentRunSnapshotV1 } from './event-store'

interface CreationRequestEvidenceV1 {
  readonly scope: Readonly<WorkspaceScope>
  readonly runId: number
  readonly generation: number
  readonly contractHash: string
  readonly stepId: string
  readonly attempt: number
  readonly contextManifestHash: string
  readonly artifactHash: string
}
interface ObservationV1 {
  outcome: 'returned' | 'unavailable'
  usage: ChatResult['usage'] | null
  finishReason: string | null
  requestLifecycle: ChatResult['requestLifecycle'] | null
}
function observe(outcome: ObservationV1['outcome'], result?: ChatResult): ObservationV1 {
  return {
    outcome,
    usage: result?.usage ? { ...result.usage } : null,
    finishReason: result?.finishReason ?? null,
    requestLifecycle: result?.requestLifecycle ? { ...result.requestLifecycle } : null,
  }
}
function assertPrefix(snapshot: AgentRunSnapshotV1, request: CreationRequestEvidenceV1): void {
  if (snapshot.run.id !== request.runId || snapshot.projection.generation !== request.generation
    || snapshot.projection.contractHash !== request.contractHash
    || snapshot.projection.steps[request.stepId]?.attempt !== request.attempt) {
    throw new Error('模型响应证据不属于原运行、代际或当前 attempt。')
  }
}
function record(snapshot: AgentRunSnapshotV1, request: CreationRequestEvidenceV1, kind: 'raw-response' | 'tool-result', content: string) {
  return recordAgentRunArtifactV1({
    scope: request.scope, runId: request.runId, stepId: request.stepId, attempt: request.attempt,
    artifactKind: kind, content, expectedLastSequence: snapshot.projection.lastSequence,
  })
}

/** A prepared request is evidence, not proof that a model was dispatched. */
export async function recordCreationModelRequestV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  stepId: string
  attempt: number
  contextManifestHash: string
  messages: readonly ChatMessage[]
}): Promise<{ snapshot: AgentRunSnapshotV1; request: CreationRequestEvidenceV1 }> {
  const bound = {
    scope: Object.freeze({ ...input.scope }), runId: input.snapshot.run.id,
    generation: input.snapshot.projection.generation, contractHash: input.snapshot.projection.contractHash,
    stepId: input.stepId, attempt: input.attempt, contextManifestHash: input.contextManifestHash,
  }
  // Serialize before the first await. Never put AIConfig, headers or credentials
  // in this body, and never use Canon NFC normalization for received evidence.
  const content = JSON.stringify({ version: 'creation-model-request-v1', generation: bound.generation,
    contractHash: bound.contractHash, stepId: bound.stepId, attempt: bound.attempt,
    contextManifestHash: bound.contextManifestHash, messages: input.messages })
  const saved = await recordAgentRunArtifactV1({ scope: bound.scope, runId: bound.runId,
    stepId: bound.stepId, attempt: bound.attempt, artifactKind: 'rendered-request', content,
    expectedLastSequence: input.snapshot.projection.lastSequence })
  return { snapshot: saved.snapshot, request: Object.freeze({ ...bound, artifactHash: saved.artifact.contentHash }) }
}

/** Preserve observed metering independently before the larger raw transaction.
 * Both remain in the existing exact store; neither grants candidate authority.
 */
export async function recordCreationModelResponseV1(input: {
  snapshot: AgentRunSnapshotV1
  request: CreationRequestEvidenceV1
  raw: string
  result?: ChatResult
}): Promise<AgentRunSnapshotV1> {
  const { request, raw } = input
  let snapshot = input.snapshot
  assertPrefix(snapshot, request)
  const observation = observe('returned', input.result)
  const metadata = JSON.stringify({ version: 'creation-model-observation-v1',
    requestArtifactHash: request.artifactHash, contextManifestHash: request.contextManifestHash, observation })
  const failures: unknown[] = []
  let observationArtifactHash: string | null = null
  try {
    const saved = await record(snapshot, request, 'tool-result', metadata)
    snapshot = saved.snapshot
    observationArtifactHash = saved.artifact.contentHash
  } catch (error) { failures.push(error) }
  // If the small metadata write failed, still try preserving the returned text
  // and its complete observation in the original store. Report either failure.
  try {
    if (typeof raw !== 'string') throw new TypeError('模型原始响应必须是字符串。')
    const saved = await record(snapshot, request, 'raw-response', JSON.stringify({
      version: 'creation-model-response-v1', raw, requestArtifactHash: request.artifactHash,
      contextManifestHash: request.contextManifestHash, observationArtifactHash, observation,
    }))
    snapshot = saved.snapshot
  } catch (error) { failures.push(error) }
  if (failures.length) throw Object.assign(new Error('模型响应证据未完整保存；已停止后续解析、修复和模型调用。'), {
    name: 'CreationResponseEvidenceError', cause: failures[0], persistenceFailures: failures,
    observation, observationArtifactHash,
  })
  return snapshot
}

/** No completed text was returned. Keep only actual observable metadata and
 * retain the original transport error, rather than manufacturing a raw body.
 */
export async function recordUnavailableCreationResponseV1(input: {
  snapshot: AgentRunSnapshotV1
  request: CreationRequestEvidenceV1
  result?: ChatResult
  error: unknown
}): Promise<{ snapshot: AgentRunSnapshotV1; error: unknown; report: unknown; observation: ObservationV1; persistenceFailures: unknown[] }> {
  const { snapshot, request, error } = input
  const observation = observe('unavailable', input.result)
  try {
    assertPrefix(snapshot, request)
    const saved = await record(snapshot, request, 'tool-result', JSON.stringify({
      version: 'creation-model-observation-v1', requestArtifactHash: request.artifactHash,
      contextManifestHash: request.contextManifestHash, observation,
    }))
    return { snapshot: saved.snapshot, error, report: error, observation, persistenceFailures: [] }
  } catch (persistenceError) {
    return { snapshot, error, observation, persistenceFailures: [persistenceError],
      report: Object.assign(new Error('模型请求未形成完整文本，观测证据也未能完整保存。'), {
        cause: error, persistenceFailures: [persistenceError], observation,
      }),
    }
  }
}
