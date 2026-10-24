import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {CHAT_MAINTAINED_PAUSE_CHECKS_V1, type ChatMaintainedPauseControlV1} from '../../src/lib/character-interaction/maintained-pause-control'
import type {ChatControlHandoffReviewV1} from '../../src/lib/character-interaction/control-handoff-contract'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import type {ChatMessage} from '../../src/lib/types'
import {chatTurnEndControlFixture} from './chat-turn-end-control'
import {chatActionReviewFixture, chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from './chat-narrative-fixture'
import {chatActionChoiceFixture, chatActionOutcomeFixture} from './chat-action-outcome'

export const maintainedPauseText = '我先暂缓寻找铜印。它还没找回，未查明的部分也不能算作谁的过错。'
export const maintainedPauseAction = (): ChatNarrativeActionV1 => ({kind: 'pause', text: maintainedPauseText, goalKey: 'find-seal',
  evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: 'paused'})
export function maintainedPauseHandoff(source: {messageId: string; eventSequence: number}): ChatMaintainedPauseControlV1 {
  return {version: 3, kind: 'maintain-existing-pause', reason: 'pause-still-applicable', source: {
    messageId: source.messageId, sequence: source.eventSequence, excerpt: '我先暂缓寻找铜印'}, goalKey: 'find-seal', rationale: '工程候选：原自主暂停保持；不作为故事质量证据。'}
}
export function maintainedPauseReview(handoff: ChatMaintainedPauseControlV1): ChatControlHandoffReviewV1 {
  return {reviewedHandoffJson: canonicalStringify(handoff), checks: CHAT_MAINTAINED_PAUSE_CHECKS_V1.map(check => ({check, passed: true, reason: '注入审查，仅验证工程合同'}))}
}
export function maintainedPauseFixture(kind: 'continue' | 'return' = 'continue') {
  const f = chatTurnEndControlFixture(), action = maintainedPauseAction()
  const paused = applyReviewedChatNarrativeActionV1(f.state, {sequence: 4, triggerSequence: 2, actorKey: 'guard', messageId: 'pause-message', action, review: chatActionReviewFixture(action)})
  const state = requestChatNarrativeTriggerV1(paused, {sequence: 5, kind, sourceEventSequence: 4, seed: null,
    direction: {actorKey: 'guard', actionLimit: 2, audienceParticipantKeys: ['guard'], conversationMode: 'private'}})
  const handoff = maintainedPauseHandoff(state.messages.at(-1)!)
  return {state, handoff, input: {sequence: 6, triggerSequence: 5, actorKey: 'guard', handoff, review: maintainedPauseReview(handoff)}}
}
export async function seedChatMaintainedPauseRuntimeFixture(kind: 'continue' | 'return' | null = 'continue') {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 90, maxActionsPerTrigger: 2, onlyGuard: true})
  const base = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'pause-open', baseSequence: base.sequence, baseStateHash: base.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 2, audienceParticipantKeys: ['guard'], conversationMode: 'private'}})
  const action = maintainedPauseAction()
  const made = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '工程夹具：明确自主暂停', runAI: async messages => JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
      ? chatActionChoiceFixture(messages, {directions: [], selectedId: null, decisionSummary: '工程夹具：明确暂停'}) : chatActionOutcomeFixture(messages, action)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: made.snapshot.run.id})
  const paused = await readProductRuntimeState(f.sessionId), source = paused.interaction!.messages.at(-1)!
  if (kind) {
    const version = await readProductRuntimeStateVersion(f.sessionId)
    await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'pause-continue', baseSequence: version.sequence, baseStateHash: version.stateHash,
      kind, sourceEventSequence: paused.lastSequence, direction: {actorKey: 'guard', actionLimit: 2, audienceParticipantKeys: ['guard'], conversationMode: 'private'}})
  }
  return {...f, actionRunId: made.snapshot.run.id, handoff: maintainedPauseHandoff(source)}
}
export function maintainedPauseRuntimeRequest(f: Awaited<ReturnType<typeof seedChatMaintainedPauseRuntimeFixture>>) {
  const calls: ChatMessage[][] = [], reviews: ChatMessage[][] = []
  return {calls, reviews, input: {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '工程测试：核对当前机会', runAI: async (messages: ChatMessage[]) => {
      calls.push(messages); return JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
        ? chatActionChoiceFixture(messages, {directions: [], selectedId: null, decisionSummary: '工程空方向不是结束授权'}) : {outcome: 'handoff', action: null, handoff: f.handoff})
    }, runReviewAI: async (messages: ChatMessage[]) => {reviews.push(messages); return JSON.stringify({checks: maintainedPauseReview(f.handoff).checks})}}}
}
