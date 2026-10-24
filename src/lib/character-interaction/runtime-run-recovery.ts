import {db} from '../db/schema'
import {readInstanceAgentRunV1, type AgentRunSnapshotV1} from '../agent/run/event-store'
import {replayAgentRunEventsV1} from '../agent/run/projection'
import type {ProductRuntimeEvent, WorkspaceScope} from '../types'

/** Import invalidates a receipt's old scope. A verified completed prefix is
 * history, not an unfinished candidate to regenerate or adopt again. Keep the
 * stale receipt intact and require the adopted commands in this same session. */
export function isImportedCompletedInteractionRunV1(snapshot: AgentRunSnapshotV1, events: ProductRuntimeEvent[]): boolean {
  const last = snapshot.events[snapshot.events.length - 1]
  if (snapshot.projection.state !== 'running' || last?.type !== 'verification.staled'
    || last.payload.reason !== 'project-import-scope-rebound') return false
  const prefix = replayAgentRunEventsV1(snapshot.events.slice(0, -1))
  if (prefix.errors.length || prefix.state !== 'completed' || !prefix.terminalReceiptHash
    || prefix.terminalReceiptHash !== last.payload.previousReceiptHash) return false
  const adopted = snapshot.events.find(e => e.type === 'runtime.candidate.adopted')
  if (adopted?.type !== 'runtime.candidate.adopted' || !adopted.payload.commandIds.length) return false
  return adopted.payload.commandIds.every(id => events.some(e => e.sessionId === snapshot.run.productRuntimeSessionId
    && e.commandId === id && e.sequence > adopted.payload.baseSequence && e.sequence <= adopted.payload.resultingSequence))
}

export async function readResumableInteractionRunsV1(scope: WorkspaceScope, sessionId: number) {
  const [rows, events] = await Promise.all([
    db.agentRuns.where('productRuntimeSessionId').equals(sessionId).toArray(),
    db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray(),
  ])
  const resumable = []
  for (const row of rows) {
    if (['completed', 'failed', 'cancelled'].includes(row.status)) continue
    const snapshot = await readInstanceAgentRunV1(scope, row.id!)
    if (!isImportedCompletedInteractionRunV1(snapshot, events)) resumable.push(snapshot.run)
  }
  return resumable
}
