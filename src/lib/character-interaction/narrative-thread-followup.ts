import {CHAT_HISTORY_CAPACITY_V1} from './history-capacity'
import {assertChatExistingGoalPauseReviewVersionV1} from './narrative-player-pause'
import {requireChatPlayerRequestV1, supportsChatPlayerPauseV1} from './narrative-player-pause'
import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1, ChatNarrativeTriggerStateV1} from '../types/chat-narrative'

type Trigger = Pick<ChatNarrativeTriggerStateV1, 'kind' | 'actionSequences'>
function fail(message: string): never {throw new Error(`[chat-thread-followup] ${message}`)}

/** One bounded opportunity, not consent to participate or resume a pause. */
export function chatThreadFollowupThreadsV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: Trigger) {
  const story = state.chatNarrative
  if (!story || story.permissions.allowActorThreadFollowups !== true || story.permissions.allowActorSituationExpansion !== true
    || !state.activeScene?.activeParticipantKeys.includes(actorKey) || story.pendingEdit || story.pendingSituation
    || !['player-response', 'continue', 'return'].includes(trigger.kind) || trigger.actionSequences.length
    || story.situation.goals.some(g => g.actorKey === actorKey && ['active', 'paused'].includes(g.status))) return []
  return story.situation.threads.filter(t => ['open', 'blocked'].includes(t.status)
    && t.participantKeys.includes(actorKey) && t.audienceKeys.includes(actorKey))
}

export function chatCanFollowThreadV1(state: CharacterInteractionRuntimeState, actorKey: string, trigger: Trigger): boolean {
  return chatThreadFollowupThreadsV1(state, actorKey, trigger).length > 0
}

/** Preview only; the existing reviewed action atomically commits the new goal
 * and first step. Historical goals, threads and facts remain unchanged. */
export function applyChatThreadFollowupGoalV1(state: CharacterInteractionRuntimeState, input: {
  action: ChatNarrativeActionV1; actorKey: string; sequence: number; messageId: string; trigger: ChatNarrativeTriggerStateV1
}): void {
  const {action, actorKey, sequence, messageId, trigger} = input, proposal = action.threadFollowupGoal
  if (proposal == null) return
  const threads = chatThreadFollowupThreadsV1(state, actorKey, trigger), story = state.chatNarrative!
  if (!threads.some(t => t.threadKey === proposal.threadKey)) fail('没有授权、参与且可接续的未完成事项')
  const pause = proposal.pauseRequest
  if (action.followupGoal != null || action.resumeGoal != null || action.goalKey !== proposal.goal.goalKey
    || !pause && (action.waitingForPlayer || ['attempt', 'pause'].includes(action.kind)) || !action.text.includes(proposal.evidenceExcerpt)
    || action.situationRequest != null && (!['observation-result', 'inquiry-result'].includes(action.situationRequest.purpose ?? '') || action.situationRequest.threadKey !== proposal.threadKey)) fail('接续目标必须与自己的实际行动一起成立，不能代替新背景或玩家决定')
  if (story.situation.goals.some(g => g.goalKey === proposal.goal.goalKey || g.actorKey === actorKey && g.desire === proposal.goal.desire)) fail('接续不能复活、复制或覆盖旧目标')
  if (story.situation.goals.length >= CHAT_HISTORY_CAPACITY_V1.goals) fail('目标历史已达上限，请保存并停止演绎')
  if (!proposal.goal.evidenceFactKeys.length || proposal.goal.evidenceFactKeys.some(id => !story.situation.facts.some(f => f.factKey === id && f.audienceKeys.includes(actorKey)))) fail('接续目标缺少角色当前可知的事实依据')
  let playerPause
  if (pause) {
    const source = requireChatPlayerRequestV1(state, actorKey, trigger, pause, action.audienceKeys)
    if (action.kind !== 'speak' || !action.waitingForPlayer || action.goalStatus !== 'paused' || action.newFacts.length || action.disclosures.length
      || action.goalUpdates?.length || action.relationshipUpdates?.length || action.beliefUpdates?.length || action.nextPossibilities?.length || action.situationRequest != null
      || action.commitmentEffects?.some(e => e.kind !== 'promise') || action.threadUpdates.some(e => e.threadKey !== proposal.threadKey || e.status !== 'paused')) fail('明确暂停只能确认自身剩余责任及约定，不能夹带推进或其他后果')
    playerPause = {threadKey: proposal.threadKey, requested: {messageId: source.messageId, sequence: source.eventSequence, excerpt: pause.playerExcerpt},
      acknowledged: {messageId, sequence, excerpt: proposal.evidenceExcerpt}}
  }
  story.situation.goals.push({...proposal.goal, actorKey, status: 'active', updatedSequence: sequence, ...(playerPause ? {playerPause} : {})})
}

export function supportsChatThreadFollowupV1(version: string | undefined): boolean {
  return supportsChatPlayerPauseV1(version) || ['chat-narrative-action-review-v21', 'chat-narrative-options-review-v15'].includes(version ?? '')
}

export function assertChatThreadFollowupReviewVersionV1(actions: readonly ChatNarrativeActionV1[], version: string | undefined): void {
  assertChatExistingGoalPauseReviewVersionV1(actions, version)
  if (actions.some(a => a.resumeGoal !== undefined || a.threadFollowupGoal?.pauseRequest !== undefined) && !supportsChatPlayerPauseV1(version)) fail('旧审查合同不支持玩家暂停与恢复；保留原候选，不自动换约或重发')
  if (actions.some(a => a.threadFollowupGoal !== undefined) && !supportsChatThreadFollowupV1(version)) fail('旧审查合同不支持既有事项接续；保留原候选，不自动换约或重发')
}

export const CHAT_THREAD_FOLLOWUP_ACTION_RULE_V1 = 'threadFollowupGoal 默认为 null。只有 allowActorThreadFollowups=true 且 allowActorSituationExpansion=true、本轮为 player-response/continue/return 的首个行动、自己没有 active/paused 目标且无 pendingSituation/pendingEdit 时，才可在自己参与且知情的 open/blocked 原剧情线内提出下一项自身目标并实际行动。结构为 {threadKey:"原线标识",evidenceExcerpt:"本次实际表达的逐字摘录",goal:{goalKey,desire,concern,boundary,evidenceFactKeys}}，行动 goalKey 等于新 goal.goalKey。只承接原问题仍未完成的部分，不新增剧情线、背景、时地、权限、他人意愿，不复活或换词复制已经完成的目标。玩家只说“嗯”或明确继续时不必再要求其编任务，但不能把继续当成接受建议；拒绝参与不等于同意参与，要求休息或停止时不得借接续继续强推。paused/resolved/abandoned/transformed 的事项不能接续。新目标须有既有可知事实和自然动机，第一步须是自己的实际行动；waitingForPlayer=false，不用 attempt/pause，不能并用 followupGoal；situationRequest 仅可为同一原线的已完成 observation-result。实际后果仍完整登记，目标和原线是否结束各自判断。'

export const CHAT_THREAD_FOLLOWUP_REVIEW_RULE_V1 = '若含 threadFollowupGoal，独立核对冻结的两项授权、首个允许触发、无自身未完成目标或待处理情境/改写、原 threadKey 的参与和知情范围及 open/blocked 状态。新目标只能服务原问题尚未完成的部分，须有真实动机、既有可知事实和第一步实际表达，不得换词重做旧目标、创造背景或借其他人的事项强行插入。核对玩家最新拒绝、暂停及停止：继续操作或简单回应不是同意参加，不能迫使玩家重回原路线。旧目标和原线结果不改写，不新增或重开剧情线；不能因字段合法就放行无意义接续。新目标建立、实际行为、所有后果和目标/剧情线状态须一起审查。'

export const CHAT_GOAL_THREAD_COMPLETION_RULE_V1 = '个人目标完成与整条事项解决分别判断：对照目标 desire、原线 question 和实际已发生结果，closureSignals 仅为判断线索。完成制作、调查或准备，不等于已完成尚待的交付、确认或他人行动；保留尚未解决的原线。自己的目标确已完成则如实结束，不为维持行动资格延长旧目标，也不把整线一并关闭；可在后续获准的一轮按既有事项接续规则处理余下部分。反过来，问题确已解决也不要凭空增加确认环节或强留尾巴。'
