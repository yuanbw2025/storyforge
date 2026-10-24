import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1, ChatTurnCompletionV1} from '../types/chat-narrative'
import {supportsChatActionChoiceMessagesV1} from './action-choice-message-evidence'

export const CHAT_TURN_COMPLETION_PRODUCER_V1 = 'chat-narrative-action-v52'
export const CHAT_TURN_COMPLETION_REVIEWER_V1 = 'chat-narrative-action-review-v35'

export function supportsChatTurnCompletionV1(version: string | undefined): boolean {
  return version === CHAT_TURN_COMPLETION_PRODUCER_V1 || supportsChatActionChoiceMessagesV1(version)
}

export function supportsChatTurnCompletionReviewV1(version: string | undefined): boolean {
  return version === CHAT_TURN_COMPLETION_REVIEWER_V1 || version === 'chat-narrative-action-review-v36' || (version === 'chat-narrative-action-review-v37' || version === 'chat-narrative-action-review-v38' || version === 'chat-narrative-action-review-v39' || version === 'chat-narrative-action-review-v40' || (version === 'chat-narrative-action-review-v41' || version === 'chat-narrative-action-review-v42'))
}

function fail(reason: string): never {throw new Error(`[chat-turn-completion] ${reason}`)}

/** This is a disposition of the same reviewed action, not another speech,
 * consequence, goal state or model call. Historical actions omit it. */
export function parseChatTurnCompletionV1(value: unknown): ChatTurnCompletionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('本轮结束依据必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'evidenceExcerpt,purpose,version' || row.version !== 1) fail('本轮结束合同字段或版本无效')
  for (const field of ['purpose', 'evidenceExcerpt']) {
    if (typeof row[field] !== 'string' || !row[field].trim() || row[field].length > 1200) fail('本轮结束依据为空或过长')
  }
  return structuredClone(value) as ChatTurnCompletionV1
}

/** Structural eligibility cannot prove useful progress. The separate review
 * must establish that this action actually meets the stated local purpose. */
export function assertChatTurnCompletionV1(state: CharacterInteractionRuntimeState, actorKey: string, action: ChatNarrativeActionV1): void {
  if (action.turnCompletion == null) return
  const completion = parseChatTurnCompletionV1(action.turnCompletion)
  const story = state.chatNarrative, trigger = story?.triggers.slice(-1)[0]
  if (!story || !trigger || trigger.status !== 'ready' || trigger.direction?.scheduling) fail('本轮结束只适用于当前单角色轮次')
  if (story.pendingEdit || story.pendingSituation || action.situationRequest || action.sceneTransition) fail('本轮结束不能跳过改写、情境结果或转场')
  if (action.waitingForPlayer || !['speak', 'complete'].includes(action.kind)) fail('等待决定或暂停不能伪装成本轮完成')
  if (!story.situation.goals.some(goal => goal.goalKey === action.goalKey && goal.actorKey === actorKey && goal.status === 'active')
    || action.goalStatus !== null || action.goalUpdates?.length || action.followupGoal || action.threadFollowupGoal || action.pauseGoal || action.resumeGoal) fail('本轮结束必须保留原有活跃目标')
  if (!action.text.includes(completion.evidenceExcerpt)) fail('本轮结束须引用本次实际表达，不能借用旧进展')
}

export function validateChatTurnCompletionCheckV1(value: unknown, action: ChatNarrativeActionV1): void {
  if (action.turnCompletion == null) {
    if (value !== undefined) fail('无本轮结束候选不能添加结束审查')
    return
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('本轮结束缺少独立审查')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'passed,reason' || typeof row.passed !== 'boolean'
    || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 2000) fail('本轮结束审查无效')
}

export function assertChatTurnCompletionReviewVersionV1(actions: readonly ChatNarrativeActionV1[], version: string | undefined): void {
  if (actions.some(action => action.turnCompletion != null) && !supportsChatTurnCompletionReviewV1(version)) fail('旧审查合同不能采用本轮结束结果')
}

export function assertChatTurnCompletionBindingV1(action: ChatNarrativeActionV1, contract: {
  executionBindings?: ReadonlyArray<{stepId: string; skillId: string; promptVersion: string}>
}): void {
  if (action.turnCompletion == null) return
  const bindings = contract.executionBindings ?? []
  if (!bindings.some(binding => binding.stepId === 'interaction:runtime-candidate'
    && binding.skillId === 'character.chat-narrative-action' && supportsChatTurnCompletionV1(binding.promptVersion))) fail('本轮结束缺少版本化原生成合同')
  assertChatTurnCompletionReviewVersionV1([action], bindings.find(binding => binding.stepId === 'interaction:action-review')?.promptVersion)
  const producer = bindings.find(binding => binding.stepId === 'interaction:runtime-candidate')?.promptVersion
  const reviewer = bindings.find(binding => binding.stepId === 'interaction:action-review')?.promptVersion
  if ((producer === 'chat-narrative-action-v70' || (producer === 'chat-narrative-action-v71' || producer === 'chat-narrative-action-v72')) ? reviewer !== 'chat-narrative-action-review-v42' : (producer === 'chat-narrative-action-v66' || (producer === 'chat-narrative-action-v67' || (producer === 'chat-narrative-action-v68' || producer === 'chat-narrative-action-v69'))) ? reviewer !== 'chat-narrative-action-review-v41' : producer === 'chat-narrative-action-v65' ? reviewer !== 'chat-narrative-action-review-v40' : producer === 'chat-narrative-action-v64' ? reviewer !== 'chat-narrative-action-review-v39' : (producer === 'chat-narrative-action-v61' || (producer === 'chat-narrative-action-v62' || producer === 'chat-narrative-action-v63')) ? reviewer !== 'chat-narrative-action-review-v38' : (producer === 'chat-narrative-action-v58' || producer === 'chat-narrative-action-v59' || producer === 'chat-narrative-action-v60') ? reviewer !== 'chat-narrative-action-review-v37' : producer === 'chat-narrative-action-v57' ? reviewer !== 'chat-narrative-action-review-v36' : reviewer !== CHAT_TURN_COMPLETION_REVIEWER_V1) fail('本轮结束生成与审查版本不匹配')
}

export const CHAT_TURN_COMPLETION_ACTION_RULE_V1 = '本轮行动次数是上限，不是必须用完的次数。若本次实际表达或行动已经完成一个有意义的局部目的，可输出 turnCompletion={version:1,purpose:"本次已实现的具体局部目的",evidenceExcerpt:"本次 text 中连续逐字原文"}，在同一行动审查通过并保存后结束本轮；否则填 null。原长期目标保持 active，goalStatus=null；本轮结束不等于暂停、完成或放弃目标，也不增加台词或事实。必须实际承接本轮玩家消息；不能只重复旧安排、宣布到此为止或拿结束标记冒充进展。待确认的观察结果、实际提问答复、情境结算、玩家决定不能跳过；多人调度、待改写或转场不用此标记。无需把所有未知查完，但本次局部目的仍需的直接后续不能省略。后续玩家消息或明确继续仍可沿原目标推进，无离线行动。'

export const CHAT_TURN_COMPLETION_REVIEW_RULE_V1 = '本轮结束专审：只有含 turnCompletion 的候选额外返回 turnCompletionCheck:{passed,reason}；没有则省略。对照完整本轮玩家消息、近期行动、当前事实与待处理事项，核对 purpose 是否已由本次实际表达或后果实现、evidenceExcerpt 是否确实支持它。新的具体安排、回应、关系变化或行动可以形成局部结束，无须完成长期目标或穷尽无关未知；但重复旧话、仅宣布停止、仍待结果的尝试，或省略实现该局部目的必需的直接后续必须拒绝。不得吞掉玩家尚未获得回应的请求，不能把等待玩家决定或待判定调查/询问藏进局部完成。标记只结束当前单角色轮次，长期目标和原责任继续保留，不以继续 active 为由要求凑满次数。该检查不替代原六项：正文仍须有意义，全部后果、权限、秘密和玩家选择仍须通过；审查失败时整条行动都不得采用。'
