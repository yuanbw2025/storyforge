import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {chatActionReviewOutputFixture} from './chat-narrative-fixture'

export const CHAT_PROMISE_FIXTURE = '我答应检查后门后把结果告诉你，你不必跟过来。'
export function chatPromiseActionFixture(terms = CHAT_PROMISE_FIXTURE): ChatNarrativeActionV1 {
  return {kind: 'speak', text: terms, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null, commitmentEffects: [{kind: 'promise', terms, evidenceExcerpt: terms}]}
}
export function chatFulfillActionFixture(commitmentKey: string): ChatNarrativeActionV1 {
  const text = '叶岑查看了后门，回来告诉你：“门闩完好，没有撬动痕迹。”'
  return {...chatPromiseActionFixture(), kind: 'complete', text, newFacts: [{factKey: 'checked-door', kind: 'observation', text: '门闩完好，没有撬动痕迹。', evidenceFactKeys: ['lost'], evidenceExcerpt: text}],
    commitmentEffects: [{kind: 'fulfill', commitmentKey, evidenceExcerpt: text}]}
}
/** Injected semantic verdicts test orchestration only, not model accuracy. */
export function chatCommitmentReviewOutputFixture(action: ChatNarrativeActionV1, passed = true) {
  return {...chatActionReviewOutputFixture(), disclosureChecks: [], commitmentChecks: (action.commitmentEffects ?? []).map((_, effectIndex) => ({effectIndex, passed, reason: '注入的工程判定，不是真实模型质量证据。'}))}
}
