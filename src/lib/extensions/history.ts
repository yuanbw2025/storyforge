import type { WorkspaceScope } from '../types'
import type { AgentRunSnapshotV1 } from '../agent/run/event-store'

/** Call only after the ledger has verified that the run/checkpoint belongs to scope.
 * The embedded payload preserves original identities as evidence, never as authority.
 */
export function isExtensionHistoryCopy(snapshot: AgentRunSnapshotV1, scope: WorkspaceScope, original: WorkspaceScope): boolean {
  const imported = snapshot.events.some(event =>
    (event.type === 'verification.staled' && event.payload.reason === 'project-import-scope-rebound')
    || (event.type === 'run.cancelled' && event.payload.reason === 'project-import-nonportable-checkpoint'))
  const rebound = original.projectId !== scope.projectId || original.worldId !== scope.worldId || original.workId !== scope.workId
  // Previously failed/cancelled runs need no extra import event. Their verified
  // local checkpoint can still be displayed, but can never authorize an action.
  if (rebound && !imported && !['failed', 'cancelled'].includes(snapshot.projection.state)) throw new Error('插件任务检查点越界')
  return imported || rebound
}
