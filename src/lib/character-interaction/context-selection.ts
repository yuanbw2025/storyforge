import {createContextTextScorerV1} from '../context-gateway/lexical-query'
import type {InteractionRuntimeProfile} from '../types'
import type {InteractionContextWindow, InteractionVisibilityView} from './runtime'
import {formatInteractionRuntimeContextV1} from './context-format'
import {chatCommitmentContextTextV1, projectChatGoalCommitmentsV1} from './commitment-context'
import {estimateTokens} from '../ai/context-budget'
import {CHAT_CONTEXT_SOURCE_TOKENS_V1} from './source-budgets'
export {CHAT_CONTEXT_SOURCE_TOKENS_V1} from './source-budgets'

export const CHAT_CONTEXT_READER_VERSION_V1 = 'chat-narrative-runtime-view-v5'
export const CHAT_CONTEXT_READER_VERSION_V2 = 'chat-narrative-runtime-view-v6'
export const CHAT_CONTEXT_READER_VERSION_V3 = 'chat-narrative-runtime-view-v7'
export const CHAT_CONTEXT_READER_VERSION_V4 = 'chat-narrative-runtime-view-v8'
// v9 retains v8's actor projection and binds the subsequent review to the
// protected coordinator dialogue policy. Old producer packets keep v8.
export const CHAT_CONTEXT_READER_VERSION_V5 = 'chat-narrative-runtime-view-v9'
// v10 keeps the actor projection and freezes commit-time fact provenance.
export const CHAT_CONTEXT_READER_VERSION_V6 = 'chat-narrative-runtime-view-v10'
// v11 freezes terminal goal/thread evidence while retaining v10 input bytes.
export const CHAT_CONTEXT_READER_VERSION_V7 = 'chat-narrative-runtime-view-v11'
export const CHAT_CONTEXT_READER_VERSION_V8 = 'chat-narrative-runtime-view-v12'
// v13 reserves review space and moves complete coordinator selection evidence
// into durable packets; v12 inputs remain reproducible.
export const CHAT_CONTEXT_READER_VERSION_V9 = 'chat-narrative-runtime-view-v13'
// v14 retrieves witnessed historical relationship causes with their original dialogue.
export const CHAT_CONTEXT_READER_VERSION_V10 = 'chat-narrative-runtime-view-v14'
// v15 delivers exact dialogue identities and budgets their rendered bytes.
export const CHAT_CONTEXT_READER_VERSION_V11 = 'chat-narrative-runtime-view-v15'
// v16 distinguishes public scene-person contact from scheduled role audiences.
export const CHAT_CONTEXT_READER_VERSION_V12 = 'chat-narrative-runtime-view-v16'
// v17 retains later known consequences of selected runtime facts.
export const CHAT_CONTEXT_READER_VERSION_V13 = 'chat-narrative-runtime-view-v17'
// v18 protects the latest complete visible exchanges and their explicit reply sources.
export const CHAT_CONTEXT_READER_VERSION_V14 = 'chat-narrative-runtime-view-v18'
export type ChatRetrievalVersion = 'legacy' | 'chat-relevance-v1' | 'chat-relevance-v2' | 'chat-relevance-v3' | 'chat-relevance-v4' | 'chat-relevance-v5' | 'chat-relevance-v6' | 'chat-relevance-v7' | 'chat-relevance-v8' | 'chat-relevance-v9' | 'chat-relevance-v10' | 'chat-relevance-v11' | 'chat-relevance-v12' | 'chat-relevance-v13' | 'chat-relevance-v14'
/** Selection and expression must use the same frozen reader, including recovery. */
export function chatActionContextVersionsV1(producerVersion: string | undefined) {
  if (['chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42', 'chat-action-revision-v23', 'chat-action-revision-v24', 'chat-action-revision-v25'].includes(producerVersion ?? '')) return {readerVersion: CHAT_CONTEXT_READER_VERSION_V14, retrievalVersion: 'chat-relevance-v14' as const}
  if (['chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-action-revision-v21', 'chat-action-revision-v22'].includes(producerVersion ?? '')) return {readerVersion: CHAT_CONTEXT_READER_VERSION_V13, retrievalVersion: 'chat-relevance-v13' as const}
  if (['chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55'].includes(producerVersion ?? '')) return {readerVersion: CHAT_CONTEXT_READER_VERSION_V12, retrievalVersion: 'chat-relevance-v12' as const}
  return ['chat-narrative-action-v47', 'chat-narrative-action-v48'].includes(producerVersion ?? '')
    ? {readerVersion: CHAT_CONTEXT_READER_VERSION_V11, retrievalVersion: 'chat-relevance-v11' as const}
    : {readerVersion: CHAT_CONTEXT_READER_VERSION_V10, retrievalVersion: 'chat-relevance-v10' as const}
}
/** Only a producer's own frozen run may select its versioned actor source. */
export function usesChatActionBoundContextV1(binding: {skillId: string; promptVersion: string} | undefined): boolean {
  return binding?.skillId === 'character.chat-narrative-action'
    && ['chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72'].includes(binding.promptVersion)
    || binding?.skillId === 'character.chat-narrative-options' && ['chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(binding.promptVersion)
    || binding?.skillId === 'character.chat-action-revision' && ['chat-action-revision-v21', 'chat-action-revision-v22', 'chat-action-revision-v23', 'chat-action-revision-v24', 'chat-action-revision-v25'].includes(binding.promptVersion)
}
export function supportsChatCorrectionContextV1(version: ChatRetrievalVersion): boolean {
  return version === 'chat-relevance-v14' || version === 'chat-relevance-v13' || version === 'chat-relevance-v12' || version === 'chat-relevance-v11' || version === 'chat-relevance-v10' || version === 'chat-relevance-v9' || version === 'chat-relevance-v8' || version === 'chat-relevance-v4' || version === 'chat-relevance-v5' || version === 'chat-relevance-v6' || version === 'chat-relevance-v7'
}
export function chatRetrievalVersionForReader(reader: string | undefined): ChatRetrievalVersion | null {
  if (reader === 'chat-narrative-runtime-view-v3') return 'legacy'
  if (reader === 'chat-narrative-runtime-view-v4' || reader === CHAT_CONTEXT_READER_VERSION_V1) return 'chat-relevance-v1'
  if (reader === CHAT_CONTEXT_READER_VERSION_V2) return 'chat-relevance-v2'
  if (reader === CHAT_CONTEXT_READER_VERSION_V4) return 'chat-relevance-v4'
  if (reader === CHAT_CONTEXT_READER_VERSION_V10) return 'chat-relevance-v10'
  if (reader === CHAT_CONTEXT_READER_VERSION_V11) return 'chat-relevance-v11'
  if (reader === CHAT_CONTEXT_READER_VERSION_V14) return 'chat-relevance-v14'
  if (reader === CHAT_CONTEXT_READER_VERSION_V13) return 'chat-relevance-v13'
  if (reader === CHAT_CONTEXT_READER_VERSION_V12) return 'chat-relevance-v12'
  if (reader === CHAT_CONTEXT_READER_VERSION_V9) return 'chat-relevance-v9'
  if (reader === CHAT_CONTEXT_READER_VERSION_V8) return 'chat-relevance-v8'
  if (reader === CHAT_CONTEXT_READER_VERSION_V7) return 'chat-relevance-v7'
  if (reader === CHAT_CONTEXT_READER_VERSION_V6) return 'chat-relevance-v6'
  if (reader === CHAT_CONTEXT_READER_VERSION_V5) return 'chat-relevance-v5'
  return reader === CHAT_CONTEXT_READER_VERSION_V3 ? 'chat-relevance-v3' : null
}
export type ChatContextSelectionReasonV1 = 'current-fact' | 'protected-memory' | 'player-pin' | 'dialogue' | 'goal' | 'thread' | 'scene' | 'importance' | 'open-commitment' | 'latest-resolution' | 'pending-correction' | 'historical-relevance'
export interface ChatContextSelectionV1 {
  version: 1 | 2 | 3 | 4 | 5 | 6
  history?: ReturnType<import('./history-selection').ChatHistoryPlanV1['evidence']>
  knowledge: Array<{key: string; included: boolean; reason: ChatContextSelectionReasonV1}>
  memories: Array<{key: string; included: boolean; reason: ChatContextSelectionReasonV1}>
  commitments?: Array<{key: string; included: boolean; reason: ChatContextSelectionReasonV1}>
}

/** Input must already be the role's authorized retrieval view. Never search
 * the coordinator state, omitted dialogue, other roles or unaccepted memories. */
export function selectChatContextWindowV1(
  view: InteractionVisibilityView & {excludedMessageCount?: number},
  profile: InteractionRuntimeProfile,
  limits: {maxCharacters: number; maxRecentMessages: number; retrievalVersion?: ChatRetrievalVersion; requiredCommitmentKeys?: ReadonlySet<string>},
): InteractionContextWindow {
  const corrections = supportsChatCorrectionContextV1(limits.retrievalVersion ?? 'chat-relevance-v1')
  const pending = new Set(corrections ? view.memoryCorrections?.map(m => m.memoryId) : [])
  const promises = corrections || limits.retrievalVersion === 'chat-relevance-v3'
  const modern = promises || limits.retrievalVersion === 'chat-relevance-v2'
  const narrative = view.chatNarrative!
  const lastPlayer = [...view.messages].reverse().find(m => m.speakerKey === 'player')
  const queries = [
    ['dialogue', lastPlayer?.text ?? view.messages[view.messages.length - 1]?.text ?? '', 4],
    ['goal', narrative.goals.filter(g => g.status === 'active').map(g => `${g.desire}\n${g.concern}\n${g.boundary}`).join('\n'), 3],
    ['thread', narrative.threads.filter(t => t.status === 'open' || t.status === 'blocked').map(t => `${t.title}\n${t.question}`).join('\n'), 2],
    ['scene', `${narrative.title}\n${narrative.location}\n${narrative.timeLabel}`, 1],
  ] as const
  const scorers = queries.map(([reason, query, weight]) => ({reason, score: createContextTextScorerV1(query), weight}))
  const relevance = (text: string) => {
    let score = 0; let strongest = 0; let reason: ChatContextSelectionReasonV1 = 'importance'
    for (const scorer of scorers) {
      const match = scorer.score(text) * scorer.weight
      score += match
      if (match > strongest) {strongest = match; reason = scorer.reason}
    }
    return {score, reason}
  }
  const requiredKnowledge = new Set(narrative.facts.map(f => f.sourceKnowledgeKey).filter(Boolean))
  const commitments = promises ? [...narrative.goals.flatMap(g => g.commitments ?? []), ...(view.sharedCommitments ?? [])] : []
  const requiredCommitments = limits.requiredCommitmentKeys ?? new Set<string>()
  const candidates = [
    ...view.knowledge.map((item, index) => ({kind: 'knowledge' as const, key: item.knowledgeKey, index, importance: item.importance,
      required: requiredKnowledge.has(item.knowledgeKey), ...relevance(item.content)})),
    ...view.memories.map((item, index) => ({kind: 'memories' as const, key: item.memoryId, index, importance: item.importance,
      required: modern ? pending.has(item.memoryId) || item.playerPinned === true : ['commitment', 'key-memory'].includes(item.kind) || item.importance >= 90, ...relevance(item.content)})),
    ...commitments.map((item, index) => ({kind: 'commitments' as const, key: item.commitmentKey, index, importance: 0,
      required: item.resolution === null || requiredCommitments.has(item.commitmentKey), ...relevance(chatCommitmentContextTextV1(item))})),
  ]
  const result: InteractionContextWindow = {...view, knowledge: [], memories: [],
    messages: view.messages.slice(-limits.maxRecentMessages), omittedMessageCount: 0, characterCount: 0}
  const selectedCommitments = new Set<string>()
  const projectCommitments = () => {
    if (!promises) return
    result.chatNarrative = {...narrative, goals: projectChatGoalCommitmentsV1(narrative.goals, selectedCommitments)}
    const shared = view.sharedCommitments?.filter(c => selectedCommitments.has(c.commitmentKey))
    if (shared?.length) result.sharedCommitments = shared; else delete result.sharedCommitments
  }
  projectCommitments()
  if (modern) result.selection = {version: corrections ? 4 : promises ? 3 : 2,
    knowledge: candidates.filter(c => c.kind === 'knowledge').map(c => ({key: c.key, included: false, reason: c.reason})),
    memories: candidates.filter(c => c.kind === 'memories').map(c => ({key: c.key, included: false, reason: c.reason})),
    ...(promises ? {commitments: commitments.map(c => ({key: c.commitmentKey, included: false, reason: 'importance' as const}))} : {})}
  // Reserve room for the profile, source labels and selection summary; the
  // Gateway still enforces its final token budget on the exact rendered input.
  const rendered = () => formatInteractionRuntimeContextV1(profile, modern ? {...result, characterCount: 0,
    omittedMessageCount: view.messages.length - result.messages.length} : result)
  const size = () => modern ? rendered().length + 200
    : JSON.stringify({...result, characterCount: 0}).length + profile.voiceRules.length + profile.name.length + 400
  const fits = () => size() <= limits.maxCharacters
    && estimateTokens(rendered()) + 200 <= CHAT_CONTEXT_SOURCE_TOKENS_V1
  const selected = new Set<string>()
  const include = (candidate: typeof candidates[number]) => {
    if (candidate.kind === 'knowledge') result.knowledge.push(view.knowledge[candidate.index])
    else if (candidate.kind === 'memories') result.memories.push(view.memories[candidate.index])
    else {selectedCommitments.add(candidate.key); projectCommitments()}
    if (modern) result.selection![candidate.kind]!.find(d => d.key === candidate.key)!.included = true
  }
  for (const candidate of candidates.filter(c => c.required)) {
    include(candidate); selected.add(`${candidate.kind}:${candidate.key}`)
  }
  while (!fits() && result.messages.length > 1) result.messages.shift()
  if (!fits() && corrections && pending.size) throw new Error('待处理记忆修正及完整来源超过预算，已停止发送；不会静默省略修正、固定记忆或未处理约定。')
  if (!fits() && promises) throw new Error('当前事实、未处理承诺、最近处置或玩家固定记忆超过预算，已停止发送；不会静默省略固定记忆或未处理约定。')
  if (!fits()) throw new Error(modern ? '当前事实、玩家固定记忆或安全上下文超过预算，请调整固定范围后继续；不会静默省略固定记忆。' : '当前事实、已确认承诺或安全上下文超过预算，请调整配置后继续；不会静默省略关键记忆。')
  for (const candidate of candidates.filter(c => !c.required).sort((a, b) => b.score - a.score || b.importance - a.importance || a.kind.localeCompare(b.kind) || a.index - b.index)) {
    const priorMessages = result.messages.slice()
    include(candidate)
    // Do not let raw dialogue from previous scenes crowd out a relevant,
    // source-bound resolution. Keep current-scene dialogue and the last input.
    if (promises && candidate.kind === 'commitments' && candidate.score > 0) {
      while (!fits() && result.messages.length > 1
        && result.messages[0].eventSequence <= (view.activeScene?.startedAtSequence ?? -Infinity)) result.messages.shift()
    }
    if (fits()) selected.add(`${candidate.kind}:${candidate.key}`)
    else {
      result.messages = priorMessages
      if (candidate.kind === 'commitments') {selectedCommitments.delete(candidate.key); projectCommitments()}
      else result[candidate.kind].pop()
      if (modern) result.selection![candidate.kind]!.find(d => d.key === candidate.key)!.included = false
    }
  }
  // Selection is ranked, but retained passages keep their original source order.
  result.knowledge = view.knowledge.filter(item => selected.has(`knowledge:${item.knowledgeKey}`))
  result.memories = view.memories.filter(item => selected.has(`memories:${item.memoryId}`))
  result.omittedMessageCount = view.messages.length - result.messages.length
  result.characterCount = size()
  const decisions = (kind: 'knowledge' | 'memories' | 'commitments') => candidates.filter(c => c.kind === kind).map(c => ({
    key: c.key, included: selected.has(`${kind}:${c.key}`),
    reason: c.required ? kind === 'commitments' ? commitments[c.index].resolution === null ? 'open-commitment' as const : 'latest-resolution' as const : kind === 'knowledge' ? 'current-fact' as const : pending.has(c.key) ? 'pending-correction' as const : modern ? 'player-pin' as const : 'protected-memory' as const : c.reason,
  }))
  result.selection = {version: corrections ? 4 : promises ? 3 : modern ? 2 : 1, knowledge: decisions('knowledge'), memories: decisions('memories'),
    ...(promises ? {commitments: decisions('commitments')} : {})}
  if (modern) {
    result.characterCount = size()
    if (!fits()) throw new Error('本轮记忆选择证据超过预算，已停止发送。')
  }
  return result
}
