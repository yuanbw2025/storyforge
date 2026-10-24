import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture} from './chat-narrative-fixture'
import {chatActionChoiceFixture, chatActionOutcomeFixture} from './chat-action-outcome'
import {chatTurnEndActionFixture, chatTurnEndReviewFixture} from './chat-turn-end-control'
import type {ChatTurnEndControlV1} from '../../src/lib/character-interaction/turn-end-control'
import type {ChatMessage} from '../../src/lib/types'

/** Synthetic responses exercise the production Harness, never a quality score. */
export async function seedChatTurnEndRuntimeFixture() {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 60, maxActionsPerTrigger: 2, onlyGuard: true})
  const base = await readProductRuntimeStateVersion(f.sessionId)
  const trigger = await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'open-turn', baseSequence: base.sequence, baseStateHash: base.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence, direction: {actorKey: 'guard', actionLimit: 2, audienceParticipantKeys: ['guard'], conversationMode: 'private'}})
  const action = chatTurnEndActionFixture()
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', objective: '整理已经核实的线索', runAI: async messages => JSON.stringify(
      messages[0].content.startsWith('这是尚未发生的角色行动选择草稿') ? chatActionChoiceFixture(messages, {
        directions: [{id: 'organize', action: action.text, evidenceFactKeys: ['lost'], changes: '完成已知线索整理', playerDependency: null, unconfirmedConditions: [], kind: 'own-action'}],
        selectedId: 'organize', decisionSummary: '先完成线索整理'}) : chatActionOutcomeFixture(messages, action)),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
  const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  const state = await readProductRuntimeState(f.sessionId), source = state.interaction!.messages.slice(-1)[0]
  const handoff: ChatTurnEndControlV1 = {version: 2, kind: 'finish-current-turn', reason: 'local-purpose-completed',
    source: {messageId: source.messageId, sequence: source.eventSequence, excerpt: '将已经核实的线索按时间排好'},
    purpose: '完成现有线索的整理，保留寻找铜印的目标'}
  return {...f, trigger, handoff, actionRunId: adopted.snapshot.run.id}
}

export function chatTurnEndRuntimeRequest(f: Awaited<ReturnType<typeof seedChatTurnEndRuntimeFixture>>) {
  const calls: ChatMessage[][] = [], reviews: ChatMessage[][] = []
  const choice = {directions: [], selectedId: null, decisionSummary: '本轮线索整理已经完成，整体目标保持。'}
  return {calls, reviews, choice, input: {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '承接本轮已经完成的行动', runAI: async (messages: ChatMessage[]) => {
      calls.push(messages)
      return JSON.stringify(messages[0].content.startsWith('这是尚未发生的角色行动选择草稿')
        ? chatActionChoiceFixture(messages, choice) : {outcome: 'handoff', action: null, handoff: f.handoff})
    }, runReviewAI: async (messages: ChatMessage[]) => {reviews.push(messages); return JSON.stringify({checks: chatTurnEndReviewFixture(f.handoff).checks})}}}
}
