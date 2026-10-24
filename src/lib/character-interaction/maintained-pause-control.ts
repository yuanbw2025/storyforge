import type {CharacterInteractionRuntimeState} from '../types'
import {interactionMessageVisibleTo} from './message-visibility'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {assertChatTurnActorV1} from './narrative-scheduling'

/** A disposition of an already adopted pause. It never adds dialogue or
 * changes a goal, responsibility, permission, fact or story progress. */
export interface ChatMaintainedPauseControlV1 {
  version: 3
  kind: 'maintain-existing-pause'
  reason: 'pause-still-applicable'
  source: {messageId: string; sequence: number; excerpt: string}
  goalKey: string
  rationale: string
}
export const CHAT_MAINTAINED_PAUSE_PRODUCER_V1 = 'chat-narrative-action-v66'
export function supportsChatMaintainedPauseV1(version: string | undefined): boolean {
  return version === CHAT_MAINTAINED_PAUSE_PRODUCER_V1 || (version === 'chat-narrative-action-v67' || (version === 'chat-narrative-action-v68' || (version === 'chat-narrative-action-v69' || (version === 'chat-narrative-action-v70' || (version === 'chat-narrative-action-v71' || version === 'chat-narrative-action-v72')))))
}
export const CHAT_MAINTAINED_PAUSE_REVIEWER_V1 = 'chat-narrative-action-review-v41'
export const CHAT_MAINTAINED_PAUSE_CHECKS_V1 = [
  'current-pause', 'current-opportunity', 'pending-obligations', 'available-direction', 'player-agency', 'visibility',
] as const
function fail(reason: string): never {throw new Error(`[chat-maintained-pause] ${reason}`)}
function record(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('维持暂停必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) fail('维持暂停字段缺失或夹带写入')
  return row
}
function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('维持暂停文本为空或过长')
}
export function parseChatMaintainedPauseControlV1(value: unknown): ChatMaintainedPauseControlV1 {
  const row = record(value, ['version', 'kind', 'reason', 'source', 'goalKey', 'rationale'])
  if (row.version !== 3 || row.kind !== 'maintain-existing-pause' || row.reason !== 'pause-still-applicable') fail('维持暂停版本或原因无效')
  const source = record(row.source, ['messageId', 'sequence', 'excerpt'])
  text(source.messageId, 200); text(source.excerpt, 1200); text(row.goalKey, 160); text(row.rationale, 1200)
  if (!Number.isSafeInteger(source.sequence) || source.sequence === 0) fail('维持暂停来源事件无效')
  return structuredClone(value) as ChatMaintainedPauseControlV1
}

/** Do not let an excluded answer disappear from the independent review. */
export function readChatMaintainedPauseBasisV1(state: CharacterInteractionRuntimeState, actorKey: string, handoff: ChatMaintainedPauseControlV1) {
  const index = state.messages.findIndex(message => message.messageId === handoff.source.messageId && message.eventSequence === handoff.source.sequence)
  if (index < 0) fail('暂停的实际表达缺失')
  const basis = state.messages.slice(index).filter(message => message.supersededBySequence == null && interactionMessageVisibleTo(message, actorKey))
  if (basis.some(message => !isChatMessageRetrievableV1(state, message))) fail('暂停后对话已被排除，无法核对暂停仍然适用')
  return structuredClone(basis)
}

export function previewChatMaintainedPauseControlV1(state: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: number; actorKey: string; handoff: ChatMaintainedPauseControlV1
}): CharacterInteractionRuntimeState {
  const handoff = parseChatMaintainedPauseControlV1(input.handoff), story = state.chatNarrative, scene = state.activeScene
  const trigger = story?.triggers.slice(-1)[0]
  if (!story || !scene || scene.status !== 'active' || scene.sceneKey !== story.situation.sceneKey || !scene.activeParticipantKeys.includes(input.actorKey)) fail('维持暂停缺少当前角色与情境')
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0 || input.sequence <= story.lastEventSequence) fail('维持暂停事件序号无效')
  if (!trigger || trigger.status !== 'ready' || trigger.requestedSequence !== input.triggerSequence
    || !['continue', 'return'].includes(trigger.kind) || trigger.actionSequences.length) fail('维持暂停只适用于尚未行动的继续或返回轮次')
  if (story.pendingEdit || story.pendingSituation || trigger.direction?.scheduling) fail('维持暂停不能跳过待处理结果、改写或多人调度')
  assertChatTurnActorV1(state, trigger, input.actorKey)
  const ownGoals = story.situation.goals.filter(goal => goal.actorKey === input.actorKey)
  const goal = ownGoals.find(goal => goal.goalKey === handoff.goalKey)
  if (!goal || goal.status !== 'paused' || goal.playerPause || goal.updatedSequence !== handoff.source.sequence
    || ownGoals.some(other => other.status === 'active' || other.status === 'paused' && other.playerPause)) fail('缺少已采用的自主暂停，或仍有活跃目标/玩家暂停')
  const matches = state.messages.filter(message => message.messageId === handoff.source.messageId && message.eventSequence === handoff.source.sequence)
  const source = matches[0]
  if (matches.length !== 1 || source.role !== 'character' || source.speakerKey !== input.actorKey || source.supersededBySequence != null
    || !interactionMessageVisibleTo(source, state.playerKey) || !interactionMessageVisibleTo(source, input.actorKey)
    || !isChatMessageRetrievableV1(state, source) || !source.text.includes(handoff.source.excerpt)
    || source.eventSequence < scene.startedAtSequence || source.eventSequence >= trigger.requestedSequence) fail('暂停来源不是当前场景中已保存的共同可见表达')
  const basis = readChatMaintainedPauseBasisV1(state, input.actorKey, handoff)
  const lastPlayer = basis.filter(message => message.role === 'player').slice(-1)[0]
  const lastActor = basis.filter(message => message.role === 'character' && message.speakerKey === input.actorKey).slice(-1)[0]
  if (lastPlayer && (!lastActor || lastPlayer.eventSequence > lastActor.eventSequence)) fail('新的玩家消息尚未承接')
  if (state.remainingDirectorBudget < 3) fail('维持暂停的选择、结果与审查预算不足')
  const result = structuredClone(state), target = result.chatNarrative!, next = target.triggers.slice(-1)[0]
  next.status = 'complete'
  next.controlHandoff = {version: 3, sequence: input.sequence, actorKey: input.actorKey,
    sourceMessageId: source.messageId, sourceSequence: source.eventSequence}
  target.revision += 1; target.lastEventSequence = input.sequence; result.remainingDirectorBudget -= 3
  return result
}

export const CHAT_MAINTAINED_PAUSE_RULES_V1 = [
  'continue/return 的首步若自己已正式自主暂停、没有 active 目标或 playerPause，且现有暂停仍适用，可选择不新增表达：handoff={version:3,kind:"maintain-existing-pause",reason:"pause-still-applicable",source:{messageId:"实际暂停消息ID",sequence:该目标updatedSequence,excerpt:"暂停原文"},goalKey:"自己的paused目标",rationale:"依据当前情况说明原暂停仍适用"}，action=null。这只结束本轮机会，不新增台词、暂停、事实或进展，不声称所有办法穷尽。',
  '维持暂停需要已采纳目标状态和已交付共同对话的证据，空方向草稿本身不能授权。重新核对原责任、近期答复、当前可行方向和未处理请求；新玩家消息、直接结果或必要后续不能跳过。有依据的新方向仍应正常行动或恢复原目标；无新变化时不要再说一遍暂停。待改写、待情境结算和多人调度不能用此结果。',
] as const
export const CHAT_MAINTAINED_PAUSE_REVIEW_RULES_V1 = [
  '本次只审查维持已采用自主暂停的控制候选，不产生台词、事实、目标变化或剧情进展。actionChoice 是未采用草稿，不是执行依据；空方向不自动通过，草稿中的理由也不能替代实际证据。',
  'current-pause：goalKey 是否由角色自主且共同可见地正式暂停，source 是否是该次实际表达；完整对话和当前状态是否仍支持原暂停？不能借控制第一次暂停或扩大原暂停范围，不能把玩家暂停改作自主暂停。',
  'current-opportunity：是否为新的 continue/return 且本轮还没有行动？继续/返回只给演绎机会，不代表新许可、时间流逝、外部条件改善或必须新增事件。维持暂停不是本轮完成了新局部目的。',
  'pending-obligations：核对全部已有责任、承诺、共同事项和暂停后的对话，是否仍欠直接答复、结算结果、必要告知或后续行动？有这些内容则拒绝，不能以整体暂停掩盖它们。原责任与未解决事项继续保留。',
  'available-direction：核对角色实际可知的近期事实、答复、动机及选择草稿，有意义且当前应承接的新方向不能被忽略。仍有假想办法本身不否决有据暂停；不能凭审查者所知秘密规划、虚构困难或宣称所有办法穷尽。',
  'player-agency：新玩家请求必须已经实际承接，不能吞掉拒绝、改道或恢复意图；不替玩家接受、不强迫玩家提供剧情，不把控制结果当作事项完成或解除原边界。',
  'visibility：依据只来自已交付的角色所知及共同可见实际表达；rationale 不得引入隐藏事实、他人内心或未来剧情。审查原因不发布为台词。',
  '仅输出 JSON {"checks":[{"check":"current-pause|current-opportunity|pending-obligations|available-direction|player-agency|visibility","passed":true,"reason":"依据实际材料判断"}]}，六项各一次；任一失败保留候选和失败，不自动重发。',
] as const
