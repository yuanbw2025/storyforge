import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1, ChatNarrativeTriggerStateV1} from '../types/chat-narrative'
import {requireChatPlayerRequestV1} from './narrative-player-pause'
import {interactionMessageVisibleTo} from './message-visibility'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

function fail(message: string): never {throw new Error(`[chat-promise-request] ${message}`)}

/** Eligibility is deterministic. The independent commitment review must still
 * establish that the quoted request warrants exactly this own future duty. */
export function requireChatPromiseRequestV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: ChatNarrativeTriggerStateV1, action: ChatNarrativeActionV1) {
  if (action.promiseRequest == null) return null
  const story = state.chatNarrative, effects = action.commitmentEffects ?? []
  const goal = story?.situation.goals.find(g => g.actorKey === actorKey && g.goalKey === action.goalKey)
  if (!goal || !['active', 'paused'].includes(goal.status) || goal.playerPause
    || action.kind !== 'speak' || action.evidenceFactKeys.length || action.goalStatus !== null
    || effects.length !== 1 || effects[0].kind !== 'promise'
    || action.newFacts.length || action.disclosures.length || action.threadUpdates.length || action.goalUpdates?.length
    || action.relationshipUpdates?.length || action.beliefUpdates?.length || action.nextPossibilities != null
    || action.pauseGoal != null || action.situationRequest != null || action.followupGoal != null || action.threadFollowupGoal != null || action.resumeGoal != null) {
    fail('对话约定只可登记已有自身目标的一项新承诺，不能附带事实、履行、改约、恢复或其他后果')
  }
  const source = requireChatPlayerRequestV1(state, actorKey, trigger, action.promiseRequest, action.audienceKeys)
  const latest = state.messages.filter(m => m.supersededBySequence == null && interactionMessageVisibleTo(m, actorKey) && isChatMessageRetrievableV1(state, m)).slice(-1)[0]
  if (source !== latest) fail('对话约定必须来自当前实际读取的最新玩家消息')
  return source
}

export function supportsChatPromiseRequestV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v25', 'chat-narrative-options-review-v19', 'chat-narrative-action-review-v26', 'chat-narrative-options-review-v20', 'chat-narrative-action-review-v27', 'chat-narrative-options-review-v21', 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}
export function supportsChatPromiseRequestPromptV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v32', 'chat-narrative-options-v22', 'chat-action-revision-v14', 'chat-narrative-action-v33', 'chat-narrative-options-v23', 'chat-action-revision-v15', 'chat-narrative-action-v34', 'chat-narrative-options-v24', 'chat-action-revision-v16', 'chat-action-revision-v17', 'chat-action-revision-v18', 'chat-action-revision-v19', 'chat-action-revision-v20', 'chat-action-revision-v21', 'chat-action-revision-v22', 'chat-action-revision-v23', 'chat-action-revision-v24', 'chat-action-revision-v25', 'chat-narrative-action-v35', 'chat-narrative-options-v25', 'chat-narrative-action-v36', 'chat-narrative-action-v37', 'chat-narrative-action-v38', 'chat-narrative-action-v39', 'chat-narrative-action-v40', 'chat-narrative-action-v41', 'chat-narrative-action-v42', 'chat-narrative-action-v43', 'chat-narrative-action-v44', 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v26', 'chat-narrative-options-v27', 'chat-narrative-options-v28', 'chat-narrative-options-v29', 'chat-narrative-options-v30', 'chat-narrative-options-v31', 'chat-narrative-options-v32', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
}
export function assertChatPromiseRequestReviewVersionV1(actions: readonly ChatNarrativeActionV1[], version: string | undefined): void {
  if (actions.some(a => a.promiseRequest != null) && !supportsChatPromiseRequestV1(version)) fail('旧审查合同不支持玩家请求约定；保留原候选，不自动换约或重发')
}

export const CHAT_PROMISE_REQUEST_ACTION_RULE_V1 = 'promiseRequest 默认为 null。当前真实玩家消息明确请求你作出一项未来约定时，可以接受或拒绝，不必引用无关世界事实。若接受且本轮只作出这项新约定，使用 speak、evidenceFactKeys=[]、promiseRequest={playerEventSequence:本轮trigger.sourceEventSequence,playerExcerpt:"完整表达请求条件的玩家原话摘录"}，commitmentEffects 恰有一项 promise；goalKey 必须是已有自身未完成目标，所有听众必须看得到该玩家消息。系统绑定来源身份，不由你伪造。新约定仅约束自己的未来行为，不能承诺别人的行动、把询问当玩家同意、把假设说成事实或声称已履行。其余后果数组为空，goalStatus=null，nextPossibilities=null；不能同时改计划、改约、履行、披露、恢复暂停或提出新目标。需要这些实质变化时仍使用原事实依据路径，promiseRequest=null。普通提议、未接受请求或重申已记录承诺仍不新建承诺。修订必须保留原 promiseRequest，不得临时添加对话依据绕过原合同。'
export const CHAT_PROMISE_REQUEST_REVIEW_RULE_V1 = '玩家请求约定专审：仅当候选显式包含 promiseRequest，才按此独立依据路径审查无事实引用的新承诺。核对它是当前首个player-response的真实最新可读玩家消息，摘录完整保留请求条件、范围和否定；该请求在语义上确实支持本次接受的自身未来义务，且与原目标相容。commitmentChecks 对唯一promise同时审查这条来源与全部条款；猜测性问题、普通闲聊、被截断的条件、角色自己加码、他人义务或把待玩家同意的提议算已接受均拒绝。正文只能接受这项未来约定，不得夹带实际行动成果、知识披露、背景断言、计划变化或暗中解除暂停；若有这些变化，不能靠空后果数组通过。原玩家请求、角色声明和承诺一起保留；等待另一回答不等于履行。未含promiseRequest的候选继续遵守原事实/纯对话规则，不为旧失败自动补来源。'
