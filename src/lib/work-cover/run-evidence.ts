import { appendAgentRunEventV1, readAgentRunV1 } from '../agent/run/event-store'
import type { AgentRunEventPayloadByTypeV1, AgentRunEventTypeV1, WorkspaceScope } from '../types'
import { canonicalStringify } from '../agent/run/hash'

export const WORK_COVER_STEP_V1 = 'work-cover.image'
export const WORK_COVER_SOURCES_V1 = ['workCoverMetadataV1', 'workCoverBriefV1', 'workCoverSelectedTextV1'] as const

/** Recovery appends missing evidence only. It never advances another attempt
 * or repeats a paid dispatch. The ledger's unique sequence is the CAS. */
export async function appendCoverEvidenceOnceV1<T extends AgentRunEventTypeV1>(scope: WorkspaceScope, runId: number, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  const snapshot = await readAgentRunV1(scope, runId)
  const prior = snapshot.events.find(event => event.type === type && canonicalStringify(event.payload) === canonicalStringify(payload))
  if (prior) return snapshot
  return appendAgentRunEventV1({ scope, runId, type, payload, expectedLastSequence: snapshot.projection.lastSequence })
}

export async function failCoverRunV1(scope: WorkspaceScope, runId: number, code: string) {
  const snapshot = await readAgentRunV1(scope, runId)
  if (['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) return
  await appendAgentRunEventV1({ scope, runId, type: 'run.failed', payload: { code, retryable: false }, expectedLastSequence: snapshot.projection.lastSequence })
}
