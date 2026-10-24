import type {CharacterInteractionRuntimeState} from '../types'
import type {ChatNarrativeActionV1, ChatNarrativeTriggerStateV1} from '../types/chat-narrative'
import {chatCanRespondAfterClosureV1} from './narrative-scheduling'
import {isChatMessageRetrievableV1} from './narrative-retrieval'

function fail(message: string): never {throw new Error(`[chat-followup] ${message}`)}

/** Called only on the private action preview. No background, ownership or
 * permissions come from the model; rejection discards this entire preview. */
export function applyChatOwnFollowupGoalV1(state: CharacterInteractionRuntimeState, input: {
  action: ChatNarrativeActionV1; actorKey: string; sequence: number; trigger: ChatNarrativeTriggerStateV1
}): void {
  const {action, actorKey, sequence, trigger} = input, proposal = action.followupGoal
  if (proposal == null) return
  const story = state.chatNarrative!, source = state.messages.find(m => m.role === 'player' && m.eventSequence === proposal.playerEventSequence)
  if (story.permissions.allowPlayerFollowupSituations !== true || story.permissions.allowActorSituationExpansion !== true
    || !chatCanRespondAfterClosureV1(state, actorKey, trigger) || story.pendingSituation) fail('新目标只允许在授权且无待处理事项的首次玩家回应中建立')
  if (trigger.sourceEventSequence !== proposal.playerEventSequence || !source || source.supersededBySequence != null || !isChatMessageRetrievableV1(state, source)
    || state.messages.filter(m => m.role === 'player' && m.supersededBySequence == null).slice(-1)[0] !== source
    || !source.text.includes(proposal.playerExcerpt) || source.audienceKeys != null && action.audienceKeys.some(k => k !== state.playerKey && !source.audienceKeys!.includes(k))) fail('新目标须引用本轮真实可见的玩家请求并保持对话范围')
  if (action.goalKey !== proposal.goal.goalKey || !action.text.includes(proposal.evidenceExcerpt)
    || action.waitingForPlayer || action.kind === 'pause' || action.kind === 'attempt'
    || action.situationRequest != null && !['observation-result', 'inquiry-result'].includes(action.situationRequest.purpose ?? '')) fail('新目标须与自身实际表达一起成立；新背景仍须先构建')
  if (story.situation.goals.some(g => g.goalKey === proposal.goal.goalKey || g.actorKey === actorKey && g.desire === proposal.goal.desire)
    || story.situation.threads.some(t => t.threadKey === proposal.thread.threadKey || t.question === proposal.thread.question)) fail('不得复活、复制或覆写旧目标与剧情线')
  const evidence = (ids: string[], audiences: string[]) => {
    if (!ids.length || ids.some(id => {
      const fact = story.situation.facts.find(f => f.factKey === id)
      return !fact || audiences.some(viewer => !fact.audienceKeys.includes(viewer))
    })) fail('新目标或问题缺少当前可知事实依据')
  }
  evidence(proposal.goal.evidenceFactKeys, [actorKey])
  evidence(proposal.thread.evidenceFactKeys, action.audienceKeys)
  story.situation.goals.push({...proposal.goal, actorKey, status: 'active', updatedSequence: sequence})
  story.situation.threads.push({...proposal.thread, audienceKeys: [...action.audienceKeys], participantKeys: [actorKey], status: 'open', updatedSequence: sequence})
}

export const CHAT_OWN_FOLLOWUP_GOAL_RULE_V1 = 'followupGoal 默认为 null。只有 allowPlayerFollowupSituations=true 且 allowActorSituationExpansion=true、没有 pendingSituation、首次 player-response 且自己没有 active/paused 目标时，才可承接玩家明确提出的尚未解决事项：若现有可知背景已足够，直接把自己的新目标与第一步实际行动一起输出，无需先只说愿意再申请建立目标。结构为 {playerEventSequence:trigger.sourceEventSequence,playerExcerpt:"玩家本次请求的逐字摘录",evidenceExcerpt:"自己本次 text 的逐字摘录",goal:{goalKey,desire,concern,boundary,evidenceFactKeys},thread:{threadKey,title,question,evidenceFactKeys,closureSignals}}。goalKey 等于新 goal.goalKey；系统指定唯一行动者、知情者、初始状态和事件身份。目标依据可包含自己私有事实，问题依据必须对本次全部听众可知；听众不得超出玩家原消息。只建立自己的意向，不补背景、时间地点、他人意愿或玩家参与。旧目标和结果保留，不重开或复制旧问题；普通闲聊、拒绝、休息、离开或继续按钮不授权此字段。waitingForPlayer=false，不使用 attempt/pause；有未知条件须先构建背景时，改用 goalKey=null 的 player-followup 请求。实际行动的后果照常登记，观察的未知结果仍通过 purpose=observation-result 单独判定，不提前揭晓；followupGoal 不能并用其他 situationRequest。叙述只表达人物真正会说和做的内容，不反复解释系统权限、登记或审查。'

export const CHAT_OWN_FOLLOWUP_GOAL_REVIEW_RULE_V1 = '若含 followupGoal，核对冻结的两项跟进/扩展权限、无待处理情境且无自身未完成目标的首次玩家回应、真实最新玩家请求及逐字证据。只在该请求确有尚未解决的具体事项、角色动机成立且现有已知背景足够时通过；角色可以在同一表达中建立自己的新目标并完成第一步，无需额外的意向回应或目标构建。新目标/问题只是自身意向，不能发明背景、隐情、他人动机或玩家参与，不能复活、复制旧目标或靠私有字段泄密。自己私有的目标依据不等于对玩家披露，但问题标题/内容/收束条件须对所有听众可见。普通闲聊、拒绝、休息或要求停止不能借此转为新任务；有未知背景需先构建时不能用它绕过。第一步的真实后果与所有 goalStatus/threadUpdates 仍须完整审查；仅建立意向不等于完成目标，实际观察后请求判定未知结果是合法分阶段行为。拒绝强行增加矛盾或把台词写成规则说明；有效自主行动不要求玩家先表态。'
