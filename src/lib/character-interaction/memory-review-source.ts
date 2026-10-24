import {readInteractionRuntimeCandidateV1} from './harness'
import {readProductRuntimeState} from './runtime-api'
import {assertRuntimeHarnessFreshV1} from '../agent/run/runtime-scope'
import {assertInstanceBinding} from '../product/runtime-instances'
import {chatMemoryReviewBindingV1} from './memory-review-contract'
import type {WorkspaceScope} from '../types'

/** Only the exact saved candidate and its actual shared sources. The curator's
 * private role context is deliberately not part of the review evidence. */
export async function readChatMemoryReviewSourceV1(scope: WorkspaceScope, sessionId: number, runId: number, worldGroupId: number | null) {
  const owner = await assertInstanceBinding(sessionId, scope)
  if (owner.kind !== 'character-interaction' || (owner.worldGroupId ?? null) !== worldGroupId) throw new Error('记忆审查来源不属于当前聊天。')
  const {snapshot, candidate} = await readInteractionRuntimeCandidateV1(scope, runId)
  if (candidate.kind !== 'memory-curator-candidate' || candidate.productRuntimeSessionId !== sessionId) throw new Error('记忆审查缺少当前实例的持久化候选。')
  await assertRuntimeHarnessFreshV1({scope, contractScope: snapshot.contract.scope, participantKey: candidate.participantKey})
  const state = (await readProductRuntimeState(sessionId)).interaction!
  return chatMemoryReviewBindingV1(state, {...candidate, kind: candidate.memoryKind})
}
