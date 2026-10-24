import type {CharacterInteractionRuntimeState} from '../types'
import {chatTurnAudienceBoundaryV1} from './narrative-audience'
import {supportsChatTurnCompletionV1} from './turn-completion'
import {assertChatInquirySettlementOutputV1} from './inquiry-settlement'
import {assertChatReviewedDisclosureOutputV1} from './natural-disclosure-output'

/** One explicit choice binds action kind and player-decision dependency. These
 * are transport names; saved actions keep the existing domain contract. */
export const CHAT_ACTION_EXPRESSION_MODES_V1 = {
  speech: {kind: 'speak', waitingForPlayer: false},
  'speech-awaiting-player': {kind: 'speak', waitingForPlayer: true},
  'player-dependent-attempt': {kind: 'attempt', waitingForPlayer: true},
  'self-action-performed': {kind: 'complete', waitingForPlayer: false},
  'self-action-awaiting-player': {kind: 'complete', waitingForPlayer: true},
  'self-pause': {kind: 'pause', waitingForPlayer: false},
  'self-pause-awaiting-player': {kind: 'pause', waitingForPlayer: true},
} as const

export function supportsChatActionWireV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v41', 'chat-narrative-options-v31', 'chat-action-revision-v20', 'chat-action-revision-v21', 'chat-action-revision-v22', 'chat-action-revision-v23', 'chat-action-revision-v24', 'chat-action-revision-v25', 'chat-narrative-action-v42', 'chat-narrative-action-v43', 'chat-narrative-action-v44', 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v32', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
}

/** Capture before dispatch, from the registered runtime's actual conversation.
 * Explicit revisions/edits retain their original audience instead of widening
 * it to the current scene. The normal stale check still guards adoption. */
export function resolveChatActionWireAudienceV1(state: CharacterInteractionRuntimeState, actorKey: string, revisionAudience?: readonly string[]): string[] {
  const trigger = state.chatNarrative?.triggers.slice(-1)[0], scene = state.activeScene
  if (!trigger || !scene) throw new Error('[chat-output] 缺少本轮对话听众')
  const allowed = chatTurnAudienceBoundaryV1(state, trigger)?.audienceParticipantKeys ?? scene.activeParticipantKeys
  const audience = revisionAudience ?? state.chatNarrative?.pendingEdit?.audienceKeys ?? [state.playerKey, ...allowed]
  if (!audience.includes(actorKey) || !audience.includes(state.playerKey) || new Set(audience).size !== audience.length
    || audience.some(key => key !== state.playerKey && (!allowed.includes(key) || !scene.activeParticipantKeys.includes(key)))) throw new Error('[chat-output] 本轮绑定听众超出实际对话范围')
  return [...audience]
}

/** Never infer a mode from prose or repair a contradictory canonical action.
 * Canonical adapters remain accepted by the unchanged domain parser. */
export function compileChatActionWireV1(value: unknown, version: string | undefined, audience?: readonly string[]): unknown {
  assertChatInquirySettlementOutputV1(value, version)
  if (value && typeof value === 'object' && 'turnCompletion' in value && !supportsChatTurnCompletionV1(version)) throw new Error('[chat-turn-completion] 旧生成合同不能添加本轮结束字段')
  if (!supportsChatActionWireV1(version) || value === null || typeof value !== 'object' || Array.isArray(value)) return value
  assertChatReviewedDisclosureOutputV1(value, version)
  const result = structuredClone(value) as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(result, 'expressionMode')) {
    if ('kind' in result || 'waitingForPlayer' in result) throw new Error('[chat-output] 新旧行动表达字段不能混用')
    const mode = result.expressionMode
    if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(CHAT_ACTION_EXPRESSION_MODES_V1, mode)) throw new Error('[chat-output] 行动表达模式无效')
    delete result.expressionMode
    Object.assign(result, CHAT_ACTION_EXPRESSION_MODES_V1[mode as keyof typeof CHAT_ACTION_EXPRESSION_MODES_V1])
  }
  if (result.audienceKeys === null) {
    if (!audience?.length) throw new Error('[chat-output] 缺少冻结听众，不能补写')
    result.audienceKeys = [...audience]
  }
  return result
}

export function chatActionWireExampleV1(example: string, version: string | undefined): string {
  if (!supportsChatActionWireV1(version)) return example
  const result = JSON.parse(example), actions = result.options ?? [result]
  for (const action of actions) {
    if (supportsChatTurnCompletionV1(version)) action.turnCompletion = null
    delete action.kind; delete action.waitingForPlayer
    action.expressionMode = Object.keys(CHAT_ACTION_EXPRESSION_MODES_V1).join('|')
    action.audienceKeys = null
  }
  return JSON.stringify(result)
}
