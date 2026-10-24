import {CHAT_NARRATIVE_OPTION_KEYS_V1} from './narrative-options'
import type {ChatNarrativeActionV1} from '../types/chat-narrative'
import type {CharacterInteractionRuntimeState} from '../types'

export function supportsChatKnownFactReviewNormalizationV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v26', 'chat-narrative-options-review-v20', 'chat-narrative-action-review-v27', 'chat-narrative-options-review-v21', 'chat-narrative-action-review-v28', 'chat-narrative-options-review-v22', 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}

export function supportsChatReviewNormalizationV1(version: string | undefined): boolean {
  return supportsChatKnownFactReviewNormalizationV1(version)
    || ['chat-narrative-action-review-v24', 'chat-narrative-options-review-v18', 'chat-narrative-action-review-v25', 'chat-narrative-options-review-v19'].includes(version ?? '')
}

/** The stored review contract requires per-fact checks for paraphrases only.
 * A new reviewer may redundantly approve an exact quotation. Remove only that
 * well-formed affirmative annotation; never invent a required check, erase a
 * rejection, change an action, or reinterpret an older frozen response. The
 * caller retains the raw response and records the deterministic conversion.
 * New bindings also allow redundant approval of cited, already shared facts.
 * This requires the unchanged pre-action state, never candidate consequences. */
export function normalizeChatReviewResponseV1(input: {
  output: Record<string, unknown>; actions: readonly ChatNarrativeActionV1[]; options: boolean; promptVersion: string | undefined
  state?: CharacterInteractionRuntimeState; actorKey?: string
}): {output: Record<string, unknown>; removed: Array<{optionKey: string | null; factKey: string; basis?: 'already-known'}>} {
  const removed: Array<{optionKey: string | null; factKey: string; basis?: 'already-known'}> = []
  if (!supportsChatReviewNormalizationV1(input.promptVersion)) return {output: input.output, removed}
  const fail = (message: string): never => {throw new Error(`[chat-review-normalization] ${message}`)}
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('审查条目无效')
    return value as Record<string, unknown>
  }
  const normalize = (row: Record<string, unknown>, action: ChatNarrativeActionV1, optionKey: string | null) => {
    if (!Object.prototype.hasOwnProperty.call(row, 'disclosureChecks')) return row
    if (!Array.isArray(row.disclosureChecks) || row.disclosureChecks.length > 12) fail('披露审查数量无效')
    const checks = row.disclosureChecks as unknown[], seen = new Set<string>(), retained: unknown[] = []
    for (const value of checks) {
      const check = object(value), factKey = check.factKey
      if (Object.keys(check).sort().join(',') !== 'factKey,passed,reason'
        || typeof factKey !== 'string' || factKey.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(factKey)
        || typeof check.passed !== 'boolean' || typeof check.reason !== 'string' || !check.reason.trim() || check.reason.length > 2000) fail('披露审查字段无效')
      const matches = action.disclosures.filter(d => d.factKey === factKey)
      if (seen.has(factKey as string) || matches.length > 1) fail('披露审查重复或不属于当前候选')
      seen.add(factKey as string)
      if (!matches.length) {
        const state = input.state, actorKey = input.actorKey
        const facts = state?.chatNarrative?.situation.facts.filter(f => f.factKey === factKey) ?? []
        if (!supportsChatKnownFactReviewNormalizationV1(input.promptVersion) || !state || !actorKey
          || !state.activeScene?.activeParticipantKeys.includes(actorKey)
          || !action.audienceKeys.includes(actorKey) || !action.audienceKeys.includes(state.playerKey)
          || !action.evidenceFactKeys.includes(factKey as string) || facts.length !== 1
          || action.newFacts.some(f => f.factKey === factKey)
          || action.audienceKeys.some(key => !facts[0].audienceKeys.includes(key))) fail('披露审查不属于当前候选的既有共同事实')
        if (check.passed !== true) fail('既有共同事实审查未通过，不能忽略失败判定')
        removed.push({optionKey, factKey: factKey as string, basis: 'already-known'})
        continue
      }
      if (matches[0].wording === undefined) {
        if (check.passed !== true) fail('逐字披露审查未通过，不能忽略失败判定')
        removed.push({optionKey, factKey: factKey as string})
      } else retained.push(value)
    }
    return retained.length === checks.length ? row : {...row, disclosureChecks: retained}
  }
  if (!input.options) {
    if (input.actions.length !== 1) fail('单条审查缺少精确行动')
    return {output: normalize(input.output, input.actions[0], null), removed}
  }
  if (input.actions.length !== 2 || !Array.isArray(input.output.options) || input.output.options.length !== 2) fail('候选组审查数量无效')
  const seen = new Set<string>()
  const options = (input.output.options as unknown[]).map(value => {
    const row = object(value), optionKey = row.optionKey
    const index = CHAT_NARRATIVE_OPTION_KEYS_V1.findIndex(key => key === optionKey)
    if (index < 0 || seen.has(String(optionKey))) fail('候选组审查身份无效或重复')
    seen.add(String(optionKey))
    return normalize(row, input.actions[index], String(optionKey))
  })
  return {output: removed.length ? {...input.output, options} : input.output, removed}
}
