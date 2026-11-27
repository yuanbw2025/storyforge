import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AgentEvent, WorkspaceScope } from '../types'
import type { MasterCandidatePayload } from '../agent/orchestrator'
import { assertRecordInScope, scopeTransactionTables } from '../workspace/scope'
import { readVerifiedAgentRunInTransactionV1 } from '../agent/run/event-store'
import { computeMasterCandidateHashV1 } from '../agent/run/master-candidate-hash'
import { hashCanonicalValue } from '../agent/run/hash'

export interface CandidateLocalDraftStateV1 {
  revision: number
  status: 'idle' | 'saving' | 'failed' | 'blocked' | 'discarding'
  error?: string
}
export interface CandidateLocalSaveWitnessV1 {
  version: 1
  scope: WorkspaceScope
  eventId: number
  conversationId: number
  runId: number
  stepId: string
  generation: number
  candidateHash: string
}

/** Read-only confirmation of this exact stored candidate, not adoption or quality. */
export async function readCandidateLocalSaveWitnessV1(scope: WorkspaceScope, expected: AgentEvent): Promise<CandidateLocalSaveWitnessV1 | null> {
  if (expected.id == null || expected.durableRunId == null || expected.kind !== 'candidate') return null
  return db.transaction('r', scopeTransactionTables(db.agentConversations, db.agentEvents, db.agentRuns, db.agentRunEvents), async () => {
    const actual = await db.agentEvents.get(expected.id!)
    if (!actual || actual.kind !== 'candidate' || actual.content !== expected.content || actual.payload !== expected.payload
      || actual.conversationId !== expected.conversationId || actual.durableRunId !== expected.durableRunId
      || actual.createdAt !== expected.createdAt || actual.sequence !== expected.sequence
      || !await assertRecordInScope(scope, 'agentEvents', actual, { owner: 'work' })) return null
    const conversation = await db.agentConversations.get(actual.conversationId)
    if (!conversation || !await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })) return null
    const payload = JSON.parse(actual.payload) as MasterCandidatePayload
    if (payload.runId !== actual.durableRunId || typeof payload.runStepId !== 'string'
      || typeof payload.candidateHash !== 'string' || payload.workspaceScope?.projectId !== scope.projectId
      || payload.workspaceScope.worldId !== scope.worldId || payload.workspaceScope.workId !== scope.workId) return null
    const saved = await readVerifiedAgentRunInTransactionV1(scope, actual.durableRunId!)
    const step = saved.projection.steps[payload.runStepId]
    if (saved.run.conversationId !== actual.conversationId || payload.runGeneration !== saved.projection.generation
      || !step || step.status !== 'awaiting_confirmation' || step.candidateHash !== payload.candidateHash) return null
    const { candidateHash: _hash, ...body } = payload
    const computed = await Dexie.waitFor(payload.skillId === 'world-origin.worldview-field.v2'
      ? hashCanonicalValue({ draft: actual.content, payload: body })
      : computeMasterCandidateHashV1(payload, actual.content))
    if (computed !== payload.candidateHash) return null
    return { version: 1, scope: { ...scope }, eventId: actual.id!, conversationId: actual.conversationId,
      runId: actual.durableRunId!, stepId: payload.runStepId, generation: saved.projection.generation, candidateHash: payload.candidateHash }
  })
}
