import {assertChatConversationEvidenceReviewVersionV1} from './narrative-conversation-evidence'
import {normalizeChatReviewResponseV1} from './review-normalization'
import {assertChatThreadFollowupReviewVersionV1} from './narrative-thread-followup'
import {assertChatMemoryReconciliationReviewsV1, isChatActionReviewOutputV1} from './memory-reconciliation'
import {db} from '../db/schema'
import {canonicalStringify} from '../agent/run/hash'
import {assertRuntimeHarnessFreshV1} from '../agent/run/runtime-scope'
import {readAgentRunArtifactExactV1} from '../memory/artifact-store'
import {assertInstanceBinding} from '../product/runtime-instances'
import {readProductRuntimeState, readProductRuntimeStateVersion} from './runtime-api'
import {parseChatNarrativeActionReviewV1} from './narrative-actions'
import type {ChatNarrativeActionV1} from '../types/chat-narrative'
import type {WorkspaceScope} from '../types'

export const CHAT_ACTION_REVISION_SKILL = 'character.chat-action-revision' as const
export interface ChatActionRevisionSourceV1 {
  runId: number
  actorKey: string
  triggerSequence: number
  candidateHash: string
  reviewHash: string
  action: ChatNarrativeActionV1
}

/** An explicit new attempt, never a retry of the failed run. Only an otherwise
 * approved action with rejected consequence bookkeeping is eligible. Critic
 * prose can contain coordinator secrets and must never enter the actor view. */
export async function readChatActionRevisionSourceV1(input: {
  scope: WorkspaceScope; sessionId: number; actorKey?: string; currentRunId?: number
}): Promise<ChatActionRevisionSourceV1 | null> {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  if (session.kind !== 'character-interaction') return null
  const state = (await readProductRuntimeState(input.sessionId)).interaction
  const version = await readProductRuntimeStateVersion(input.sessionId)
  const trigger = state?.chatNarrative?.triggers.slice(-1)[0]
  if (!state || !trigger || trigger.status !== 'ready' || state.chatNarrative?.pendingEdit || state.remainingDirectorBudget < 2) return null
  const rows = (await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()).filter(row => {
    const contract = JSON.parse(row.contractJson)
    return contract.scope?.runtime?.baseSequence === version.sequence
      && contract.executionBindings?.some((b: {skillId?: string}) => ['character.chat-narrative-action', 'character.chat-narrative-options', 'character.chat-situation-construction', CHAT_ACTION_REVISION_SKILL].includes(b.skillId ?? ''))
  })
  const originals = rows.filter(row => JSON.parse(row.contractJson).executionBindings?.some((b: {skillId?: string}) => b.skillId === 'character.chat-narrative-action'))
  if (originals.length !== 1 || originals[0].status !== 'failed'
    || rows.some(row => row.id !== originals[0].id && row.id !== input.currentRunId)) return null
  if (input.currentRunId != null && !rows.some(row => row.id === input.currentRunId && row.status === 'running'
    && JSON.parse(row.contractJson).executionBindings?.some((b: {skillId?: string}) => b.skillId === CHAT_ACTION_REVISION_SKILL))) return null
  const {readInteractionRuntimeCandidateV1} = await import('./harness')
  const {snapshot, candidate} = await readInteractionRuntimeCandidateV1(input.scope, originals[0].id!)
  if (candidate.kind !== 'chat-narrative-action-candidate' || candidate.review || candidate.revision
    || candidate.triggerSequence !== trigger.requestedSequence || input.actorKey && input.actorKey !== candidate.participantKey) return null
  await assertRuntimeHarnessFreshV1({scope: input.scope, contractScope: snapshot.contract.scope, participantKey: candidate.participantKey})
  if (snapshot.events.some(event => event.type === 'model.requested' && !snapshot.events.some(response => response.type === 'evidence.artifact.recorded'
    && response.payload.artifactKind === 'raw-response' && response.payload.stepId === event.payload.stepId && response.payload.attempt === event.payload.attempt))) return null
  const responses = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === 'interaction:action-review' && e.payload.artifactKind === 'raw-response')
  if (responses.length !== 1 || responses[0].type !== 'evidence.artifact.recorded') return null
  const reviewHash = responses[0].payload.contentHash
  const raw = await readAgentRunArtifactExactV1({projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: reviewHash})
  let review
  try {
    assertChatConversationEvidenceReviewVersionV1([candidate.action], snapshot.contract.executionBindings?.find(b => b.stepId === 'interaction:action-review')?.promptVersion)
    assertChatThreadFollowupReviewVersionV1([candidate.action], snapshot.contract.executionBindings?.find(b => b.stepId === 'interaction:action-review')?.promptVersion)
    const body = JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1'))
    if (!isChatActionReviewOutputV1(body)) return null
    const normalized = normalizeChatReviewResponseV1({output: body, actions: [candidate.action], options: false, state, actorKey: candidate.participantKey,
      promptVersion: snapshot.contract.executionBindings?.find(b => b.stepId === 'interaction:action-review')?.promptVersion})
    review = parseChatNarrativeActionReviewV1({...normalized.output, reviewedActionJson: canonicalStringify(candidate.action)}, candidate.action)
    assertChatMemoryReconciliationReviewsV1(state, candidate.participantKey, [review], snapshot.contract.executionBindings?.find(b => b.stepId === 'interaction:action-review')?.promptVersion)
  } catch {return null}
  if (!review.checks.some(c => c.check === 'consequences' && !c.passed) || review.checks.some(c => c.check !== 'consequences' && !c.passed)
    || review.memoryChecks?.some(c => !c.passed) || review.disclosureChecks?.some(c => !c.passed) || review.commitmentChecks?.some(c => !c.passed)) return null
  return {runId: snapshot.run.id, actorKey: candidate.participantKey, triggerSequence: candidate.triggerSequence,
    candidateHash: candidate.candidateHash, reviewHash, action: candidate.action}
}

/** The revised action keeps the expression and its agency boundary unchanged.
 * Full deterministic and semantic checks still apply to every consequence. */
export function assertChatActionRevisionExpressionV1(source: ChatActionRevisionSourceV1, action: ChatNarrativeActionV1) {
  if (canonicalStringify(source.action.followupGoal ?? null) !== canonicalStringify(action.followupGoal ?? null)) throw new Error('[chat-revision] 后果修订不能更换原表达承接的新目标与请求依据')
  if (canonicalStringify(source.action.threadFollowupGoal ?? null) !== canonicalStringify(action.threadFollowupGoal ?? null)) throw new Error('[chat-revision] 后果修订不能更换原表达接续的事项与目标')
  if (canonicalStringify(source.action.promiseRequest ?? null) !== canonicalStringify(action.promiseRequest ?? null)) throw new Error('[chat-revision] 后果修订不能更换原约定的玩家请求依据')
  if (canonicalStringify(source.action.sceneTransition ?? null) !== canonicalStringify(action.sceneTransition ?? null)) throw new Error('[chat-revision] 后果修订不能更换转场授权与到达依据')
  if (canonicalStringify(source.action.pauseGoal ?? null) !== canonicalStringify(action.pauseGoal ?? null)) throw new Error('[chat-revision] 后果修订不能更换已有目标暂停的玩家请求依据')
  if (canonicalStringify(source.action.resumeGoal ?? null) !== canonicalStringify(action.resumeGoal ?? null)) throw new Error('[chat-revision] 后果修订不能更换恢复玩家暂停的依据')
  for (const key of ['kind', 'text', 'goalKey', 'audienceKeys', 'waitingForPlayer'] as const) {
    if (canonicalStringify(source.action[key]) !== canonicalStringify(action[key])) throw new Error('[chat-revision] 修订不能改变原表达、行动角色目标或玩家选择边界')
  }
}
