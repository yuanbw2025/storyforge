import {CHAT_MAINTAINED_PAUSE_CHECKS_V1, parseChatMaintainedPauseControlV1, previewChatMaintainedPauseControlV1, readChatMaintainedPauseBasisV1, type ChatMaintainedPauseControlV1} from './maintained-pause-control'
import {canonicalStringify} from '../agent/run/hash'
import type {CharacterInteractionRuntimeState} from '../types'
import type {InteractionContextWindow} from './runtime'
import {interactionMessageVisibleTo} from './message-visibility'
import {chatTurnActionLimitV1} from './narrative-contract'
import {isChatMessageRetrievableV1} from './narrative-retrieval'
import {assertChatTurnActorV1} from './narrative-scheduling'
import {CHAT_TURN_END_CONTROL_CHECKS_V1, parseChatTurnEndControlV1, previewChatTurnEndControlV1, readChatTurnEndBasisV1, type ChatTurnEndControlV1} from './turn-end-control'
import {assertChatPlayerAcknowledgementContextV1, assertChatPlayerAcknowledgementStateV1, type ChatPlayerAcknowledgementHandoffV1} from './player-acknowledgement-control'

/** A control result, never an action, speech, permission or story consequence.
 * Generation, independent review and adoption must all retain this exact body.
 * V1 covers an explicitly continued single-actor turn; ensemble scheduling
 * needs its own per-actor disposition before it can use a silent handoff. */
export interface ChatPlayerDecisionHandoffV1 {
  version: 1
  kind: 'yield-to-player'
  reason: 'awaiting-player-decision'
  source: {messageId: string; sequence: number; excerpt: string}
  decision: string
  dependentStep: string
}
export type ChatControlHandoffV1 = ChatPlayerDecisionHandoffV1 | ChatTurnEndControlV1 | ChatMaintainedPauseControlV1 | ChatPlayerAcknowledgementHandoffV1

export const CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1 = [
  'current-decision', 'actual-dependency', 'available-direction', 'player-agency', 'visibility',
] as const
export const CHAT_PLAYER_ACKNOWLEDGEMENT_REVIEW_CHECKS_V1 = [...CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1, 'latest-player-response'] as const
export interface ChatControlHandoffReviewV1 {
  /** Bound by the system to the candidate, never supplied by the model. */
  reviewedHandoffJson: string
  checks: Array<{check: typeof CHAT_PLAYER_ACKNOWLEDGEMENT_REVIEW_CHECKS_V1[number] | typeof CHAT_TURN_END_CONTROL_CHECKS_V1[number] | typeof CHAT_MAINTAINED_PAUSE_CHECKS_V1[number]; passed: boolean; reason: string}>
}

/** Choice, result and review still consume their actual three model calls.
 * This allowance is not a provider token limit or a story advancement count. */
export const CHAT_CONTROL_HANDOFF_CALL_ALLOWANCE_V1 = 3

function fail(reason: string): never {throw new Error(`[chat-control-handoff] ${reason}`)}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('交还控制合同必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) fail('交还控制字段缺失或夹带额外写入')
  return row
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('交还控制文本为空或过长')
  return value
}

export function parseChatControlHandoffV1(value: unknown): ChatControlHandoffV1 {
  if (value && typeof value === 'object' && 'version' in value && value.version === 3) return parseChatMaintainedPauseControlV1(value)
  if (value && typeof value === 'object' && 'version' in value && value.version === 2) {
    if (!('kind' in value) || value.kind !== 'finish-current-turn') fail('交还控制版本或原因无效')
    return parseChatTurnEndControlV1(value)
  }
  const row = record(value, ['version', 'kind', 'reason', 'source', 'decision', 'dependentStep'])
  if ((row.version !== 1 && row.version !== 4) || row.kind !== 'yield-to-player' || row.reason !== 'awaiting-player-decision') fail('交还控制版本或原因无效')
  const source = record(row.source, ['messageId', 'sequence', 'excerpt'])
  text(source.messageId, 200); text(source.excerpt, 1200)
  // Imported parentless branches retain negative historical event identities.
  if (!Number.isSafeInteger(source.sequence) || source.sequence === 0) fail('交还控制来源事件无效')
  text(row.decision, 1200); text(row.dependentStep, 1200)
  return structuredClone(value) as ChatControlHandoffV1
}

/** Eligibility only. Exact quotations cannot establish that a decision is
 * still unresolved or that waiting is preferable; those are review questions. */
export function assertChatControlHandoffContextV1(handoff: ChatControlHandoffV1, context: InteractionContextWindow): void {
  const draft = parseChatControlHandoffV1(handoff)
  const source = context.messages.find(message => message.messageId === draft.source.messageId && message.eventSequence === draft.source.sequence)
  if (!source || source.role !== 'character' || source.speakerKey !== context.participantKey
    || source.supersededBySequence != null || !source.text.includes(draft.source.excerpt)) fail('交还控制没有本次已交付角色对话依据')
  if (draft.version === 4) {
    assertChatPlayerAcknowledgementContextV1(context)
    if (draft.source.sequence >= context.chatNarrative!.trigger!.sourceEventSequence) fail('未决问题必须早于本轮玩家回应')
  }
}

/** The reviewer needs the complete exchange since the proposed dependency,
 * not just a matching excerpt. Excluded later dialogue cannot silently erase
 * an answer; reject this result rather than reading it behind the author. */
export function readChatControlHandoffBasisV1(state: CharacterInteractionRuntimeState, actorKey: string, handoff: ChatControlHandoffV1) {
  if (handoff.version === 3) return readChatMaintainedPauseBasisV1(state, actorKey, handoff)
  if (handoff.version === 2) return readChatTurnEndBasisV1(state, actorKey, handoff)
  const sourceIndex = state.messages.findIndex(message => message.messageId === handoff.source.messageId && message.eventSequence === handoff.source.sequence)
  if (sourceIndex < 0) fail('交还控制对话依据缺失')
  const basis = state.messages.slice(sourceIndex).filter(message => message.supersededBySequence == null && interactionMessageVisibleTo(message, actorKey))
  if (basis.some(message => !isChatMessageRetrievableV1(state, message))) fail('交还控制依据之后有排除的对话，无法确认决定仍未作出')
  return structuredClone(basis)
}

export function parseChatControlHandoffReviewV1(value: unknown, handoff: ChatControlHandoffV1): ChatControlHandoffReviewV1 {
  const draft = parseChatControlHandoffV1(handoff)
  const checks: readonly string[] = draft.version === 4 ? CHAT_PLAYER_ACKNOWLEDGEMENT_REVIEW_CHECKS_V1 : draft.version === 3 ? CHAT_MAINTAINED_PAUSE_CHECKS_V1 : draft.version === 2 ? CHAT_TURN_END_CONTROL_CHECKS_V1 : CHAT_CONTROL_HANDOFF_REVIEW_CHECKS_V1
  const row = record(value, ['reviewedHandoffJson', 'checks'])
  if (row.reviewedHandoffJson !== canonicalStringify(draft)) fail('交还控制审查与候选正文不一致')
  if (!Array.isArray(row.checks) || row.checks.length !== checks.length) fail('交还控制审查缺少必要项目')
  const seen = new Set<string>()
  for (const value of row.checks) {
    const check = record(value, ['check', 'passed', 'reason'])
    if (!checks.includes(String(check.check))
      || seen.has(String(check.check)) || typeof check.passed !== 'boolean') fail('交还控制审查项目重复或无效')
    seen.add(String(check.check)); text(check.reason, 4000)
  }
  return structuredClone(value) as ChatControlHandoffReviewV1
}

export function chatControlHandoffReviewPassedV1(review: ChatControlHandoffReviewV1, handoff: ChatControlHandoffV1): boolean {
  return parseChatControlHandoffReviewV1(review, handoff).checks.every(check => check.passed)
}

/** Pure preflight/replay contract. The eventual command must additionally bind
 * the exact durable run, review, source manifest and expected state head. */
export function previewChatControlHandoffV1(state: CharacterInteractionRuntimeState, input: {
  sequence: number; triggerSequence: number; actorKey: string; handoff: unknown
}): CharacterInteractionRuntimeState {
  const handoff = parseChatControlHandoffV1(input.handoff)
  if (handoff.version === 3) return previewChatMaintainedPauseControlV1(state, {...input, handoff})
  if (handoff.version === 2) return previewChatTurnEndControlV1(state, {...input, handoff})
  const story = state.chatNarrative, scene = state.activeScene, trigger = story?.triggers.slice(-1)[0]
  if (!story || !scene || scene.status !== 'active' || scene.sceneKey !== story.situation.sceneKey
    || !scene.activeParticipantKeys.includes(input.actorKey)) fail('交还控制缺少当前角色与情境')
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= story.lastEventSequence || input.sequence <= 0) fail('交还控制事件序号无效')
  if (!trigger || trigger.requestedSequence !== input.triggerSequence || trigger.status !== 'ready'
    || trigger.kind !== (handoff.version === 4 ? 'player-response' : 'continue')) fail(handoff.version === 4
      ? '交还控制只适用于本次新玩家回应的可运行轮次' : '交还控制只适用于当前明确继续的可运行轮次')
  if (story.pendingEdit || story.pendingSituation) fail('交还控制不能跳过待处理改写或情境结算')
  if (trigger.direction?.scheduling) fail('多人调度不能用单角色等待结束所有人的轮次')
  assertChatTurnActorV1(state, trigger, input.actorKey)
  if (trigger.actionSequences.length >= chatTurnActionLimitV1(story.permissions, trigger)) fail('本轮行动已结束')
  if (state.remainingDirectorBudget < CHAT_CONTROL_HANDOFF_CALL_ALLOWANCE_V1) fail('交还控制的选择、结果与审查预算不足')
  const matches = state.messages.filter(message => message.messageId === handoff.source.messageId && message.eventSequence === handoff.source.sequence)
  const source = matches[0]
  if (matches.length !== 1 || source.role !== 'character' || source.speakerKey !== input.actorKey
    || source.supersededBySequence != null || !isChatMessageRetrievableV1(state, source)
    || !interactionMessageVisibleTo(source, state.playerKey) || !source.text.includes(handoff.source.excerpt)
    || source.eventSequence < scene.startedAtSequence || source.eventSequence > story.lastEventSequence) fail('交还控制来源不是当前共同可见的有效角色表达')
  readChatControlHandoffBasisV1(state, input.actorKey, handoff)
  const visible = state.messages.filter(message => message.supersededBySequence == null && interactionMessageVisibleTo(message, input.actorKey))
  const playerIndex = visible.reduce((last, message, index) => message.role === 'player' ? index : last, -1)
  const actorIndex = visible.reduce((last, message, index) => message.role === 'character' && message.speakerKey === input.actorKey ? index : last, -1)
  if (handoff.version === 4) assertChatPlayerAcknowledgementStateV1(state, input.actorKey, handoff)
  else if (playerIndex > actorIndex) fail('新的玩家消息尚未承接，不能静默交还控制')
  const result = structuredClone(state)
  const resultTrigger = result.chatNarrative!.triggers.slice(-1)[0]
  resultTrigger.status = 'waiting-player'
  resultTrigger.controlHandoff = {version: handoff.version, sequence: input.sequence, actorKey: input.actorKey,
    sourceMessageId: handoff.source.messageId, sourceSequence: handoff.source.sequence}
  result.chatNarrative!.revision += 1
  result.chatNarrative!.lastEventSequence = input.sequence
  result.remainingDirectorBudget -= CHAT_CONTROL_HANDOFF_CALL_ALLOWANCE_V1
  return result
}

export function applyReviewedChatControlHandoffV1(state: CharacterInteractionRuntimeState,
  input: Parameters<typeof previewChatControlHandoffV1>[1] & {review: unknown}): CharacterInteractionRuntimeState {
  const handoff = parseChatControlHandoffV1(input.handoff)
  const review = parseChatControlHandoffReviewV1(input.review, handoff)
  if (!chatControlHandoffReviewPassedV1(review, handoff)) fail('交还控制审查未通过，原轮次保持')
  return previewChatControlHandoffV1(state, input)
}

export const CHAT_CONTROL_HANDOFF_REVIEW_RULES_V1 = [
  '本次审查的是不生成气泡的交还控制候选，不是台词或剧情推进。不得为了通过而改写候选或补造进展。',
  'current-decision：依据完整原对话及之后的回应，具体决定是否仍未作出？摘录出现过不代表它现在仍未解决；拒绝、取消或已经回答不能当成未答。',
  'actual-dependency：dependentStep 是否确实依赖玩家自己的许可或决定？普通邀请、可选陪同或旧问题不能阻塞无需该许可的下一步。',
  'available-direction：核对当前动机、原事实、近期行动及选择草稿；若已有可落实且有意义的自主行动、必要说明或待结算结果，应拒绝交还控制。不能以等一项许可宣称所有办法均已穷尽，也不能强造新事实来阻止合理等待。',
  'player-agency：只等待具体决定，不替玩家承诺或接受，不把点击继续视为同意，不强制暂停/完成角色目标或共同事项；需要承接的新玩家消息不得被吞掉。',
  'visibility：具体决定及其依赖只来自实际交付的角色视角和共同可见对话；不得借控制原因暗示隐藏事实、他人心理或未来剧情。原因仅作内部证据，不作为新台词发布。',
  '仅输出 JSON {"checks":[{"check":"current-decision|actual-dependency|available-direction|player-agency|visibility","passed":true,"reason":"根据完整现有证据说明判断"}]}，每项各一次；普通行动仍执行原有 meaningful-direction 审查，不能把交还控制算成剧情进展。',
] as const

export const CHAT_PLAYER_ACKNOWLEDGEMENT_REVIEW_RULES_V1 = [
  ...CHAT_CONTROL_HANDOFF_REVIEW_RULES_V1.slice(0, -1),
  'latest-player-response：必须逐字核对本轮 sourceEventSequence 对应的最新玩家原话，以及此前问题之后完整的 basisMessages。只有回应明确仅表示倾听、没有仍需承接的内容，且此前具体决定确实仍未答复，才可通过。已经回答、拒绝、取消、要求暂停、带来新事实、提出问题或要求行动，均不得静默忽略；不能仅凭短句或语气词分类，不能把含糊回应推定成许可。说明判断依据；无法确认时不通过。',
  '本结果 version:4 不发布新气泡；它只保留待决状态，既不确认玩家选择，也不更新目标、关系或承诺。available-direction 仍须独立检查，不能因玩家短回应而停止其它可落实的方向。',
  '仅输出 JSON {"checks":[{"check":"current-decision|actual-dependency|available-direction|player-agency|visibility|latest-player-response","passed":true,"reason":"根据最新玩家原话和完整现有证据说明判断"}]}，六项各一次；不能把交还控制算成剧情推进。',
] as const
