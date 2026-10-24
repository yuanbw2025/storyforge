import {isChatActionReviewOutputV1} from './memory-reconciliation'
import {canonicalStringify} from '../agent/run/hash'
import type {ChatNarrativeActionV1, ChatNarrativeActionReviewV1} from '../types/chat-narrative'
import type {CharacterInteractionRuntimeState} from '../types'
import {chatNarrativeActionReviewPassedV1, parseChatNarrativeActionV1, parseChatNarrativeActionReviewV1} from './narrative-actions'

export const CHAT_NARRATIVE_OPTION_KEYS_V1 = ['option-1', 'option-2'] as const
export type ChatNarrativeOptionKeyV1 = typeof CHAT_NARRATIVE_OPTION_KEYS_V1[number]
export interface ChatNarrativeOptionsReviewV1 {
  optionReviews: Array<{optionKey: ChatNarrativeOptionKeyV1; review: ChatNarrativeActionReviewV1}>
}
function fail(message: string): never {throw new Error(`[chat-options] ${message}`)}

/** Merely reading an unchosen preview must not reveal a previously hidden fact.
 * Normal committed actions may still disclose through their existing contract. */
export function assertChatNarrativeOptionsPreviewableV1(state: CharacterInteractionRuntimeState, actions: ChatNarrativeActionV1[]) {
  if (actions.some(action => !action.audienceKeys.includes(state.playerKey))) fail('可比较的行动表达必须对玩家可见')
  if (actions.some(action => action.disclosures.some(d => !state.chatNarrative?.situation.facts.find(f => f.factKey === d.factKey)?.audienceKeys.includes(state.playerKey)))) fail('未选中的预览不能提前披露玩家未知的事实；请通过正式角色行动揭示')
}

/** Alternatives all start from the same state; none is a sequel to another. */
export function parseChatNarrativeOptionsV1(value: unknown): ChatNarrativeActionV1[] {
  if (!Array.isArray(value) || value.length !== 2) fail('每次比较必须包含两条完整行动候选')
  const actions = value.map(parseChatNarrativeActionV1)
  if (new Set(actions.map(a => a.text.trim())).size !== 2) fail('行动候选不能是相同表达')
  return actions
}

export function bindChatNarrativeOptionsReviewV1(value: unknown, actions: ChatNarrativeActionV1[]): ChatNarrativeOptionsReviewV1 {
  parseChatNarrativeOptionsV1(actions)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'options') fail('候选组审查字段无效')
  const options = (value as {options: unknown}).options
  if (!Array.isArray(options) || options.length !== 2) fail('候选组审查必须覆盖两条候选')
  const seen = new Set<string>()
  const optionReviews = options.map(row => {
    if (!isChatActionReviewOutputV1(row, ['optionKey'])) fail('单条候选审查字段无效')
    const key = (row as {optionKey: unknown}).optionKey
    if (!CHAT_NARRATIVE_OPTION_KEYS_V1.includes(key as ChatNarrativeOptionKeyV1) || seen.has(String(key))) fail('审查候选标识无效或重复')
    const optionKey = key as ChatNarrativeOptionKeyV1; seen.add(optionKey)
    const action = actions[CHAT_NARRATIVE_OPTION_KEYS_V1.indexOf(optionKey)]
    return {optionKey, review: parseChatNarrativeActionReviewV1({checks: (row as {checks: unknown}).checks,
      ...('disclosureChecks' in row ? {disclosureChecks: row.disclosureChecks} : {}),
      ...('commitmentChecks' in row ? {commitmentChecks: row.commitmentChecks} : {}),
      ...('sceneTransitionCheck' in row ? {sceneTransitionCheck: row.sceneTransitionCheck} : {}),
      ...('memoryChecks' in row ? {memoryChecks: row.memoryChecks} : {}), reviewedActionJson: canonicalStringify(action)}, action)}
  })
  return {optionReviews: CHAT_NARRATIVE_OPTION_KEYS_V1.map(key => optionReviews.find(r => r.optionKey === key)!)}
}

export function selectedChatNarrativeOptionV1(actions: ChatNarrativeActionV1[], review: ChatNarrativeOptionsReviewV1 | null, optionKey: string | undefined) {
  if (!CHAT_NARRATIVE_OPTION_KEYS_V1.includes(optionKey as ChatNarrativeOptionKeyV1)) fail('请选择要采用的行动候选')
  parseChatNarrativeOptionsV1(actions)
  const action = actions[CHAT_NARRATIVE_OPTION_KEYS_V1.indexOf(optionKey as ChatNarrativeOptionKeyV1)]
  if (!review || !Array.isArray(review.optionReviews) || review.optionReviews.length !== 2) fail('候选组尚未完成审查')
  const selected = review.optionReviews.find(r => r.optionKey === optionKey)
  if (!selected) fail('所选候选缺少绑定审查')
  const validated = parseChatNarrativeActionReviewV1(selected.review, action)
  if (!chatNarrativeActionReviewPassedV1(validated)) fail('所选候选未通过审查')
  return {action, review: validated}
}
