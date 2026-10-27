/** One read identity for actor recall, party narration and stage recap; it grants no resource permission. */
import type { WorkspaceScope } from '../types'
import type { FrozenResourceScopeV1 } from '../registry/types'
import type { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { hashCanonicalValue } from '../agent/run/hash'
import { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
import { loadTtrpgOpenKpContextV1 } from './open-kp-context'
import { nextTtrpgOpenOperationStepV1 } from './open-operation'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'

export async function ttrpgOpenRecallReadStampV1(input: {
  scope: FrozenResourceScopeV1; workspace: WorkspaceScope
  loaded: Awaited<ReturnType<typeof loadTtrpgOpenMemoryReadStateV1>>; consumer: 'actor' | 'party-narrator'
}) {
  const { scope, workspace, consumer, loaded: { runtime, state, stateHash, source } } = input
  const contextInput = { scope: workspace, sessionId: scope.productRuntimeSessionId!, actorKey: scope.runtimeActorKey! }
  // Preserve existing actor/KP source fingerprints, including historical prepared requests.
  const context = consumer === 'actor' ? await loadTtrpgOpenPlayerContextV1(contextInput)
    : runtime.openRun!.operations.some(o => o.status === 'executing' && nextTtrpgOpenOperationStepV1(o)?.kind === 'narration')
      ? await loadTtrpgOpenKpContextV1(contextInput) : undefined
  if (context && (context.readEvidence.sequence !== state.lastSequence || context.readEvidence.stateHash !== stateHash
    || context.readEvidence.runtimeSourceHash !== source.runtimeSourceHash)) throw new TtrpgOpenReadConflictV1('读取记忆与角色视图期间进度已变化')
  return context ? hashCanonicalValue({ scope, runtimeSourceHash: source.runtimeSourceHash, stateHash, visibilityHash: context.visibilityHash })
    : hashCanonicalValue({ scope, runtimeSourceHash: source.runtimeSourceHash, stateHash, consumer })
}
