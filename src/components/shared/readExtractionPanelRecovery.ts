import { resolveScopeLike } from '../../lib/workspace/scope'
import type { WorkspaceScope } from '../../lib/types'

type RunSnapshot = { snapshot: { run: { id: number } } }

export async function readExtractionPanelRecovery<Event>(
  projectId: number,
  readPending: (input: { scope: WorkspaceScope }) => Promise<(RunSnapshot & {
    candidate: { events: Event[] }
    selectedIndexes: number[] | null
    adoptionStarted: boolean
  }) | null>,
  readRecoverable: (input: { scope: WorkspaceScope }) => Promise<(RunSnapshot & {
    nextCallIndex: number
    totalCalls: number
    safeToResume: boolean
  }) | null>,
) {
  const scope = await resolveScopeLike(projectId)
  const pending = await readPending({ scope })
  if (pending) {
    return { pending: {
      runId: pending.snapshot.run.id,
      events: pending.candidate.events,
      selectedCandidates: new Set(pending.selectedIndexes ?? pending.candidate.events.map((_, index) => index)),
      selectionFrozen: pending.selectedIndexes != null,
      adoptionStarted: pending.adoptionStarted,
    }, recoverable: null }
  }
  const recoverable = await readRecoverable({ scope })
  return { pending: null, recoverable: recoverable ? {
    runId: recoverable.snapshot.run.id,
    nextCallIndex: recoverable.nextCallIndex,
    totalCalls: recoverable.totalCalls,
    safeToResume: recoverable.safeToResume,
  } : null }
}
