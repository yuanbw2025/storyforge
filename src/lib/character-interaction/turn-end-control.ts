import type {CharacterInteractionRuntimeState} from '../types'
import {interactionMessageVisibleTo} from './message-visibility'
import {chatTurnActionLimitV1} from './narrative-contract'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {assertChatTurnActorV1} from './narrative-scheduling'

/** A reviewed disposition of progress already adopted in this same turn.
 * It contributes no speech, action, goal change or claimed story progress. */
export interface ChatTurnEndControlV1 {
  version: 2
  kind: 'finish-current-turn'
  reason: 'local-purpose-completed'
  source: {messageId: string; sequence: number; excerpt: string}
  purpose: string
}

export const CHAT_TURN_END_CONTROL_PRODUCER_V1 = 'chat-narrative-action-v57'
export const CHAT_TURN_END_CONTROL_REVIEWER_V1 = 'chat-narrative-action-review-v36'
export function chatTurnEndReviewerForProducerV1(version: string | undefined): string | undefined {
  if ((version === 'chat-narrative-action-v70' || (version === 'chat-narrative-action-v71' || version === 'chat-narrative-action-v72'))) return 'chat-narrative-action-review-v42'
  if (version === 'chat-narrative-action-v66' || (version === 'chat-narrative-action-v67' || (version === 'chat-narrative-action-v68' || version === 'chat-narrative-action-v69'))) return 'chat-narrative-action-review-v41'
  if (version === 'chat-narrative-action-v65') return 'chat-narrative-action-review-v40'
  if (version === 'chat-narrative-action-v64') return 'chat-narrative-action-review-v39'
  if (version === CHAT_TURN_END_CONTROL_PRODUCER_V1) return CHAT_TURN_END_CONTROL_REVIEWER_V1
  if ((version === 'chat-narrative-action-v61' || (version === 'chat-narrative-action-v62' || version === 'chat-narrative-action-v63'))) return 'chat-narrative-action-review-v38'
  if ((version === 'chat-narrative-action-v58' || version === 'chat-narrative-action-v59' || version === 'chat-narrative-action-v60')) return 'chat-narrative-action-review-v37'
  return undefined
}
export const CHAT_TURN_END_CONTROL_CHECKS_V1 = [
  'current-turn-progress', 'local-purpose', 'pending-obligations', 'player-agency', 'visibility',
] as const

function fail(reason: string): never {throw new Error(`[chat-turn-end] ${reason}`)}
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('本轮结束合同必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) fail('本轮结束字段缺失或夹带写入')
  return row
}
function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('本轮结束文本为空或过长')
}

export function parseChatTurnEndControlV1(value: unknown): ChatTurnEndControlV1 {
  const row = object(value, ['version', 'kind', 'reason', 'source', 'purpose'])
  if (row.version !== 2 || row.kind !== 'finish-current-turn' || row.reason !== 'local-purpose-completed') fail('本轮结束版本或原因无效')
  const source = object(row.source, ['messageId', 'sequence', 'excerpt'])
  text(source.messageId, 200); text(source.excerpt, 1200); text(row.purpose, 1200)
  if (!Number.isSafeInteger(source.sequence) || source.sequence === 0) fail('本轮结束来源事件无效')
  return structuredClone(value) as ChatTurnEndControlV1
}

/** All visible dialogue for the triggering player input and this turn must
 * reach the reviewer. Exclusion cannot erase an unanswered request. */
export function readChatTurnEndBasisV1(state: CharacterInteractionRuntimeState, actorKey: string, control: ChatTurnEndControlV1) {
  const trigger = state.chatNarrative?.triggers.slice(-1)[0]
  if (!trigger || !trigger.actionSequences.length || trigger.actionSequences.slice(-1)[0] !== control.source.sequence) fail('结束依据不是本轮最新已保存行动')
  const start = Math.min(trigger.requestedSequence, trigger.sourceEventSequence)
  const basis = state.messages.filter(message => message.eventSequence >= start
    && message.supersededBySequence == null && interactionMessageVisibleTo(message, actorKey))
  if (basis.some(message => !isChatMessageRetrievableV1(state, message))) fail('本轮对话已被排除，无法核对局部目的是否完成')
  const source = basis.find(message => message.messageId === control.source.messageId && message.eventSequence === control.source.sequence)
  if (!source || source.role !== 'character' || source.speakerKey !== actorKey
    || !interactionMessageVisibleTo(source, state.playerKey) || !source.text.includes(control.source.excerpt)) fail('本轮结束缺少共同可见的真实行动原文')
  if (basis.some(message => message.role === 'player' && message.eventSequence > source.eventSequence)) fail('新的玩家消息尚未承接')
  return structuredClone(basis)
}

export function previewChatTurnEndControlV1(state: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: number; actorKey: string; handoff: ChatTurnEndControlV1
}): CharacterInteractionRuntimeState {
  const control = parseChatTurnEndControlV1(input.handoff)
  const story = state.chatNarrative, scene = state.activeScene, trigger = story?.triggers.slice(-1)[0]
  if (!story || !scene || scene.status !== 'active' || scene.sceneKey !== story.situation.sceneKey
    || !scene.activeParticipantKeys.includes(input.actorKey)) fail('本轮结束缺少当前角色与情境')
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0 || input.sequence <= story.lastEventSequence) fail('本轮结束事件序号无效')
  if (!trigger || trigger.status !== 'ready' || trigger.requestedSequence !== input.triggerSequence) fail('本轮结束只适用于当前可运行轮次')
  if (story.pendingEdit || story.pendingSituation || trigger.direction?.scheduling) fail('本轮结束不能跳过待处理结果、改写或多人调度')
  assertChatTurnActorV1(state, trigger, input.actorKey)
  if (trigger.actionSequences.length >= chatTurnActionLimitV1(story.permissions, trigger)) fail('本轮额度已经结束')
  if (state.remainingDirectorBudget < 3) fail('本轮结束的选择、结果与审查预算不足')
  if (control.source.sequence <= trigger.requestedSequence || control.source.sequence < scene.startedAtSequence
    || control.source.sequence > story.lastEventSequence) fail('结束依据不属于当前场景和轮次')
  readChatTurnEndBasisV1(state, input.actorKey, control)
  const result = structuredClone(state), target = result.chatNarrative!
  const next = target.triggers.slice(-1)[0]
  next.status = 'complete'
  next.controlHandoff = {version: 2, sequence: input.sequence, actorKey: input.actorKey,
    sourceMessageId: control.source.messageId, sourceSequence: control.source.sequence}
  target.revision += 1; target.lastEventSequence = input.sequence
  result.remainingDirectorBudget -= 3
  return result
}

export const CHAT_TURN_END_CONTROL_RULES_V1 = [
  '若同一单角色轮次中已有正式保存的行动完成一个有意义的局部目的，后续不需新增台词、行动或直接结果，可用交还控制外层输出 handoff={version:2,kind:"finish-current-turn",reason:"local-purpose-completed",source:{messageId:"本轮最新已保存的自身行动消息ID",sequence:实际事件序号,excerpt:"连续逐字原文"},purpose:"该行动已经实现的具体局部目的"}。action 必须为 null；本结果不生成气泡、不增加行动、不暂停或完成长期目标。',
  '这是对本轮已发生进展的确认，不能引用前一轮的进展结束新的继续，也不能仅因选择草稿为空就结束。未承接的玩家请求、实际提问或观察仍需的直接结果、待情境结算/改写/转场和多人调度不能跳过。没有新进展、只是反复解释限制或宣布结束，也不满足条件。',
  '本次新行动本身已实现局部目的时，优先在该行动上填写 turnCompletion；version:2 只处理该行动已经保存后，当前轮次仍有剩余额度的情况。整段故事尚有活跃目标可以保留，下一条玩家消息或明确继续重新推进；控制结束本身不算有意义的剧情推进。',
] as const

export const CHAT_TURN_END_CONTROL_REVIEW_RULES_V1 = [
  '本次审查的是不新增气泡的本轮结束候选。它只确认本轮已保存的进展，不创造新进展、不改变长期目标或共同事项，不得为了通过补写行动。',
  'current-turn-progress：source 是否来自本次触发之后、当前角色最新的实际已保存行动？完整本轮对话是否确有实际回应、具体安排、信息、关系变化或行动，不能把前轮进展、重复解释和宣布结束充作进展。',
  'local-purpose：purpose 是否已由本轮实际行动或后果实现，引用原文是否支持？长期目标未完成不妨碍局部目的达成；但局部受阻、未知原因或选择草稿为空本身不证明局部目的完成。',
  'pending-obligations：本轮玩家请求、实际提问或观察是否仍需要直接答复/结果、必要说明或实现该局部目的的后续？仍有这些事项时拒绝。无需穷尽无关未知，也不强造新方法来阻止合理结束；有意义且可选的下一个局部目的可留待下一轮。',
  'player-agency：不得吞掉尚未回应的新玩家消息，替玩家决定，绕过拒绝、待决定或暂停；当前目标、责任和选择保持，结束本轮不代表玩家同意、事项完成或整体暂停。',
  'visibility：依据仅来自已交付角色视角和共同可见的当前轮次；不得用内部原因泄露秘密、他人内心或未来剧情。原因只作审查证据，不发布为台词。',
  '仅输出 JSON {"checks":[{"check":"current-turn-progress|local-purpose|pending-obligations|player-agency|visibility","passed":true,"reason":"根据完整现有证据说明判断"}]}，每项各一次。任何一项失败都不结束轮次，原始候选与失败保留。',
] as const

/** Only the new reviewer distinguishes an unadopted choice from the final
 * turn disposition. Historical saved runs retain their exact instructions. */
export const CHAT_TURN_END_CHOICE_DRAFT_REVIEW_RULES_V1 = [
  'actionChoice 是尚未采纳的方向选择草稿，包括 selectedId 和 decisionSummary；它不发布为台词，不暂停目标、不改变责任或任何运行状态。当前待审对象只由 handoff 给出，已有行为由 basisMessages 与运行事件证明。不得把未采用草稿中的暂停、等待、许可或结果当作该 handoff 已经实施的行为。',
  '草稿可以提示需核查的未完工作，但须回到实际对话、既有承诺、待结算结果和 handoff 的 purpose/source 独立验证。草稿中的好建议不能替代本轮真实进展，空草稿或放弃建议也不能免除实际未决义务；如果 handoff 本身或已交付表达越过玩家拒绝、泄露秘密、声称整体暂停/完成或跳过必要结果，仍须拒绝。',
] as const

export function chatTurnEndControlReviewRulesV1(reviewerVersion: string): readonly string[] {
  if (!['chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42'].includes(reviewerVersion)) return CHAT_TURN_END_CONTROL_REVIEW_RULES_V1
  return [CHAT_TURN_END_CONTROL_REVIEW_RULES_V1[0], ...CHAT_TURN_END_CHOICE_DRAFT_REVIEW_RULES_V1, ...CHAT_TURN_END_CONTROL_REVIEW_RULES_V1.slice(1)]
}
