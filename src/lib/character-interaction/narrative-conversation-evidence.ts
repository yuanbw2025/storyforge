import {assertChatPromiseRequestReviewVersionV1} from './narrative-promise-request'
import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1, ChatNarrativeTriggerStateV1} from '../types/chat-narrative'
import {interactionMessageVisibleTo} from './message-visibility'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {assertChatPlayerPauseSourcesV1} from './narrative-player-pause'

/** Conversation can ground an acknowledgement, never an unrecorded action.
 * This only establishes evidence eligibility; the independent reviewer still
 * checks the meaning of the full text and every required consequence. */
export function chatConversationEvidenceV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: ChatNarrativeTriggerStateV1, action: ChatNarrativeActionV1): 'player-message' | 'confirmed-pause' | null {
  const story = state.chatNarrative
  // The caller validates the same action's local completion before applying
  // evidence. A completed response need not invent another player decision.
  const completedResponse = trigger.kind === 'player-response' && action.kind === 'speak' && action.turnCompletion != null
  if (!story || trigger.actionSequences.length || !['speak', 'pause'].includes(action.kind)
    || action.goalKey !== null && !action.waitingForPlayer && !completedResponse || action.goalStatus !== null
    || action.newFacts.length || action.disclosures.length || action.threadUpdates.length || action.goalUpdates?.length
    || action.relationshipUpdates?.length || action.beliefUpdates?.length || action.commitmentEffects?.length
    || action.nextPossibilities?.length || action.nextPossibilities != null && story.situation.possibilities.some(p => p.actorKey === actorKey)
    || action.situationRequest != null || action.followupGoal != null || action.threadFollowupGoal != null || action.resumeGoal != null || action.pauseGoal != null || action.promiseRequest != null) return null
  const visible = state.messages.filter(m => m.supersededBySequence == null && interactionMessageVisibleTo(m, actorKey) && isChatMessageRetrievableV1(state, m))
  const latest = visible.slice(-1)[0]
  // The latest visible message is retained by the registered role reader even
  // at its final budget boundary. Do not rely on omitted older conversation.
  if (trigger.kind === 'player-response' && latest?.role === 'player' && latest.eventSequence === trigger.sourceEventSequence
    && action.audienceKeys.every(k => interactionMessageVisibleTo(latest, k))) return 'player-message'
  const goal = story.situation.goals.find(g => g.actorKey === actorKey && g.goalKey === action.goalKey && g.status === 'paused' && g.playerPause)
  if (!goal || !['player-response', 'continue', 'return'].includes(trigger.kind)) return null
  assertChatPlayerPauseSourcesV1(state)
  const pause = goal.playerPause!
  const sources = [pause.requested, pause.acknowledged].map(e => state.messages.find(m => m.messageId === e.messageId && m.eventSequence === e.sequence)!)
  // A pause is still binding when its dialogue is excluded. Its confirmed
  // evidence remains in the own-goal context; exclusion cannot release it.
  return sources.every(m => action.audienceKeys.every(k => interactionMessageVisibleTo(m, k))) ? 'confirmed-pause' : null
}

export function supportsChatConversationEvidenceV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v23', 'chat-narrative-options-review-v17', 'chat-narrative-action-review-v24', 'chat-narrative-options-review-v18', 'chat-narrative-action-review-v25', 'chat-narrative-options-review-v19', 'chat-narrative-action-review-v26', 'chat-narrative-options-review-v20', 'chat-narrative-action-review-v27', 'chat-narrative-options-review-v21', 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}
export function assertChatConversationEvidenceReviewVersionV1(actions: readonly ChatNarrativeActionV1[], version: string | undefined): void {
  assertChatPromiseRequestReviewVersionV1(actions, version)
  if (actions.some(a => !a.evidenceFactKeys.length) && !supportsChatConversationEvidenceV1(version)) throw new Error('[chat-conversation] 旧审查合同不支持无事实引用的对话回应；保留原候选，不自动换约或重发')
}

export const CHAT_CONVERSATION_EVIDENCE_ACTION_RULE_V1 = '自然回应也可以有对话依据：本轮首个 player-response 的来源是自己实际可读的最新玩家消息、且本次听众均能看到它时，纯粹的回应、确认听见或留白可用 evidenceFactKeys=[]，不必引用无关世界事实。自己的 goalKey 含已确认 playerPause 时，也可依据该暂停请求与确认在本轮首个 player-response/continue/return 中自然等待；不能由此解除暂停。此类表达只用 speak/pause；有 goalKey 时 waitingForPlayer=true。goalStatus=null，newFacts/disclosures/threadUpdates/goalUpdates/relationshipUpdates/beliefUpdates/commitmentEffects=[]，situationRequest/followupGoal/threadFollowupGoal/resumeGoal=null；nextPossibilities=null 保留原打算，已有打算时不能用[]清空。正文不得增加事实、行动成果、知识披露、关系或猜测，不制造或改动承诺；只是自然重申同一已记录约定时不重复新建承诺。实际新增、改变或完成的事情仍按原规则提供事实依据和全部后果；不能把它藏在没有后果的文本里。没有上述对话或暂停依据的主动行动仍须 evidenceFactKeys。'
export const CHAT_CONVERSATION_EVIDENCE_REVIEW_RULE_V1 = '无事实引用的对话回应专审：evidenceFactKeys=[] 仅在本轮首次实际可读的最新玩家消息、或自己目标上完整且共同可见的 playerPause 依据下，支持纯回应/等待。核对完整正文确无新的实质行动、结果、披露、承诺、关系或猜测，不能因所有后果数组为空就放行隐含变化；若正文已有实质变化，仍应拒绝漏记后果或依据。普通确认听见、留白和自然重申同一已记录等待约定可以成立，不强求世界事实引用、虚构新进展或重复新建承诺。暂停不被解除，不能把“嗯”、继续/返回当许可；恢复仍走原明确依据合同。其它没有事实依据的行动拒绝。'

/** Frozen older prompts retain their original wording. Local completion still
 * requires its existing same-action review; this adds no output or state field. */
export function chatConversationEvidenceActionRuleV1(producerVersion: string | undefined): string {
  return ['chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72'].includes(producerVersion ?? '')
    ? CHAT_CONVERSATION_EVIDENCE_ACTION_RULE_V1.replace('有 goalKey 时 waitingForPlayer=true。',
      '有 goalKey 且仍需玩家决定时 waitingForPlayer=true。仅在本轮首个 player-response 中已实际回应当前可见玩家消息、满足 turnCompletion 条件并保持活跃目标时，纯 speak 回应可用 waitingForPlayer=false 和 turnCompletion 结束本轮，evidenceFactKeys 仍可为空；不要为凑依据引用无关世界事实。结束标记须通过同次独立审查，不能把重复、等待必要决定或遗漏后果伪装成完成。')
    : CHAT_CONVERSATION_EVIDENCE_ACTION_RULE_V1
}
