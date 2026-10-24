import {supportsChatMaintainedPauseV1, CHAT_MAINTAINED_PAUSE_RULES_V1} from './maintained-pause-control'
import {parseChatControlHandoffV1, type ChatControlHandoffV1} from './control-handoff-contract'
import {supportsChatTurnCompletionV1, CHAT_TURN_COMPLETION_REVIEWER_V1} from './turn-completion'
import {chatTurnEndReviewerForProducerV1, CHAT_TURN_END_CONTROL_RULES_V1} from './turn-end-control'
import {supportsChatPlayerAcknowledgementV1, CHAT_PLAYER_ACKNOWLEDGEMENT_RULES_V1} from './player-acknowledgement-control'

export const CHAT_CONTROL_HANDOFF_PRODUCER_V1 = 'chat-narrative-action-v46'
export const CHAT_CONTROL_HANDOFF_REVIEWER_V1 = 'chat-narrative-action-review-v33'
export const CHAT_CONTROL_HANDOFF_PRODUCER_V2 = 'chat-narrative-action-v47'
export const CHAT_CONTROL_HANDOFF_REVIEWER_V2 = 'chat-narrative-action-review-v34'
export const CHAT_CONTROL_HANDOFF_PRODUCER_V3 = 'chat-narrative-action-v48'
export const CHAT_CONTROL_HANDOFF_PRODUCER_V4 = 'chat-narrative-action-v50'
export const CHAT_CONTROL_HANDOFF_PRODUCER_V5 = 'chat-narrative-action-v51'

export function supportsChatControlHandoffV1(version: string | undefined): boolean {
  return !!chatTurnEndReviewerForProducerV1(version) || version === CHAT_CONTROL_HANDOFF_PRODUCER_V1 || version === CHAT_CONTROL_HANDOFF_PRODUCER_V2 || version === CHAT_CONTROL_HANDOFF_PRODUCER_V3 || version === CHAT_CONTROL_HANDOFF_PRODUCER_V4 || version === CHAT_CONTROL_HANDOFF_PRODUCER_V5 || supportsChatTurnCompletionV1(version)
}

/** New output envelope preserves the old action body exactly. The two results
 * are exclusive; null is explicit and never repaired into a missing field. */
export function parseChatNarrativeOutcomeWireV1(value: unknown, producerVersion?: string): {outcome: 'action'; action: unknown} | {outcome: 'handoff'; handoff: ChatControlHandoffV1} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[chat-control-handoff] 运行结果必须是对象')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'action,handoff,outcome') throw new Error('[chat-control-handoff] 运行结果字段不完整或含额外写入')
  if (row.outcome === 'action' && row.handoff === null && row.action && typeof row.action === 'object' && !Array.isArray(row.action)) return {outcome: 'action', action: row.action}
  if (row.outcome === 'handoff' && row.action === null) {
    const handoff = parseChatControlHandoffV1(row.handoff)
    if (handoff.version === 4 && !supportsChatPlayerAcknowledgementV1(producerVersion)) throw new Error('[chat-player-acknowledgement] 旧生成合同不能静默承接新的玩家回应')
    if (handoff.version === 3 && !supportsChatMaintainedPauseV1(producerVersion)) throw new Error('[chat-maintained-pause] 旧生成合同不能维持已有暂停')
    if (handoff.version === 2 && !chatTurnEndReviewerForProducerV1(producerVersion)) throw new Error('[chat-turn-end] 旧生成合同不能输出本轮结束控制')
    return {outcome: 'handoff', handoff}
  }
  throw new Error('[chat-control-handoff] 行动与交还控制必须互斥，不能省略或混合结果')
}

type Schema = Record<string, unknown>
export function chatNarrativeOutcomeSchemaV1(action: Schema, producerVersion?: string, waitOnly = false): Schema {
  const text = {type: 'string'}, nullable = (value: Schema) => ({anyOf: [value, {type: 'null'}]})
  const object = (properties: Record<string, Schema>): Schema => ({type: 'object', properties, required: Object.keys(properties), additionalProperties: false})
  const original = object({
    version: {type: 'integer', enum: [1]}, kind: {type: 'string', enum: ['yield-to-player']}, reason: {type: 'string', enum: ['awaiting-player-decision']},
    source: object({messageId: text, sequence: {type: 'integer'}, excerpt: text}), decision: text, dependentStep: text,
  })
  const acknowledgement = object({
    version: {type: 'integer', enum: [4]}, kind: {type: 'string', enum: ['yield-to-player']}, reason: {type: 'string', enum: ['awaiting-player-decision']},
    source: object({messageId: text, sequence: {type: 'integer'}, excerpt: text}), decision: text, dependentStep: text,
  })
  if (waitOnly) return object({outcome: {type: 'string', enum: ['handoff']}, action: {type: 'null'},
    handoff: supportsChatPlayerAcknowledgementV1(producerVersion) ? {anyOf: [original, acknowledgement]} : original})
  const previous = chatTurnEndReviewerForProducerV1(producerVersion) ? {anyOf: [original, object({
    version: {type: 'integer', enum: [2]}, kind: {type: 'string', enum: ['finish-current-turn']}, reason: {type: 'string', enum: ['local-purpose-completed']},
    source: object({messageId: text, sequence: {type: 'integer'}, excerpt: text}), purpose: text,
  })]} : original
  const priorHandoff = supportsChatMaintainedPauseV1(producerVersion) ? {anyOf: [previous, object({
    version: {type: 'integer', enum: [3]}, kind: {type: 'string', enum: ['maintain-existing-pause']}, reason: {type: 'string', enum: ['pause-still-applicable']},
    source: object({messageId: text, sequence: {type: 'integer'}, excerpt: text}), goalKey: text, rationale: text,
  })]} : previous
  const handoff = supportsChatPlayerAcknowledgementV1(producerVersion) ? {anyOf: [priorHandoff, acknowledgement]} : priorHandoff
  return object({outcome: {type: 'string', enum: ['action', 'handoff']}, action: nullable(action), handoff: nullable(handoff)})
}

export function chatNarrativeOutcomeRulesV1(version: string | undefined): string[] {
  if (!supportsChatControlHandoffV1(version)) return []
  const rules = [
    '最终输出使用互斥结果外层：正常行动为 {"outcome":"action","action":上述完整行动对象,"handoff":null}；交还控制为 {"outcome":"handoff","action":null,"handoff":{"version":1,"kind":"yield-to-player","reason":"awaiting-player-decision","source":{"messageId":"实际角色消息ID","sequence":实际事件序号,"excerpt":"连续逐字原文"},"decision":"尚未作出的具体玩家决定","dependentStep":"确实需要该决定的下一步"}}。不得同时输出行动与交还控制，不输出不存在的台词、空行动或状态变化。',
    '交还控制仅用于明确 continue 的单角色手动轮次：已交付角色对话中已有玩家共同可见的未决许可，当前下一步仍确实依赖它，且没有可落实的自主行动或必要的新说明。它不发布气泡，不算剧情推进，不等于所有办法耗尽。choice 草稿仅供重新核对，选择 wait 本身不授权交还控制；有依据的独立行动仍选择 action。',
    '新玩家消息、scene-start/return/player-seed、多人调度、待处理改写或情境结果不能静默交还控制。不要把旧邀请、已经拒绝或回答的问题、可选陪同当作阻碍。source 必须来自本次实际交付的自己在当前场景的有效消息，不能引用未给出的历史；之后对话可能已经改变其含义，仍需独立审查。',
  ]
  const existing = chatTurnEndReviewerForProducerV1(version)
    ? [...rules.map((rule, index) => index === 0 ? rule : `以下限制仅针对 version:1 等待玩家决定的控制结果：${rule}`), ...CHAT_TURN_END_CONTROL_RULES_V1, ...(supportsChatMaintainedPauseV1(version) ? CHAT_MAINTAINED_PAUSE_RULES_V1 : [])]
    : rules
  return supportsChatPlayerAcknowledgementV1(version) ? [...existing, ...CHAT_PLAYER_ACKNOWLEDGEMENT_RULES_V1] : existing
}

export function assertChatControlHandoffBindingsV1(contract: {
  executionBindings?: ReadonlyArray<{stepId: string; skillId: string; promptVersion: string}>
  budget: {maxModelCalls: number; maxAttemptsPerStep: number}
}, handoff?: ChatControlHandoffV1): void {
  const bindings = contract.executionBindings ?? []
  const producer = bindings.find(binding => binding.stepId === 'interaction:runtime-candidate')?.promptVersion
  const turnEnd = !!chatTurnEndReviewerForProducerV1(producer)
  if (handoff?.version === 4 && !supportsChatPlayerAcknowledgementV1(producer)) throw new Error('[chat-player-acknowledgement] 新玩家回应控制缺少版本化生成及独立审查合同')
  if (handoff?.version === 3 && !supportsChatMaintainedPauseV1(producer)) throw new Error('[chat-maintained-pause] 维持已有暂停缺少新版本生成及审查合同')
  if (handoff?.version === 2 && !turnEnd) throw new Error('[chat-turn-end] 本轮结束控制缺少新版本生成及审查合同')
  const current = turnEnd || producer === CHAT_CONTROL_HANDOFF_PRODUCER_V2 || producer === CHAT_CONTROL_HANDOFF_PRODUCER_V3 || producer === CHAT_CONTROL_HANDOFF_PRODUCER_V4 || producer === CHAT_CONTROL_HANDOFF_PRODUCER_V5 || supportsChatTurnCompletionV1(producer)
  const expected = [
    ['interaction:action-choice', 'character.chat-narrative-action', current ? producer : CHAT_CONTROL_HANDOFF_PRODUCER_V1],
    ['interaction:runtime-candidate', 'character.chat-narrative-action', current ? producer : CHAT_CONTROL_HANDOFF_PRODUCER_V1],
    ['interaction:action-review', 'character.chat-narrative-action-review', turnEnd ? chatTurnEndReviewerForProducerV1(producer)! : supportsChatTurnCompletionV1(producer) ? CHAT_TURN_COMPLETION_REVIEWER_V1 : current ? CHAT_CONTROL_HANDOFF_REVIEWER_V2 : CHAT_CONTROL_HANDOFF_REVIEWER_V1],
  ]
  if (bindings.length !== 3 || expected.some(([stepId, skillId, promptVersion]) => bindings.filter(binding => binding.stepId === stepId
    && binding.skillId === skillId && binding.promptVersion === promptVersion).length !== 1)
    || contract.budget.maxModelCalls !== 3 || contract.budget.maxAttemptsPerStep !== 1) throw new Error('[chat-control-handoff] 交还控制缺少版本化选择、结果与独立审查合同')
}
