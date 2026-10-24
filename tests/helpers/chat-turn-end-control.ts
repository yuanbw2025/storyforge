import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {CHAT_TURN_END_CONTROL_CHECKS_V1, type ChatTurnEndControlV1} from '../../src/lib/character-interaction/turn-end-control'
import type {ChatControlHandoffReviewV1} from '../../src/lib/character-interaction/control-handoff-contract'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {chatNarrativeFixture, chatActionReviewFixture} from './chat-narrative-fixture'

export function chatTurnEndReviewFixture(control: ChatTurnEndControlV1): ChatControlHandoffReviewV1 {
  return {reviewedHandoffJson: canonicalStringify(control), checks: CHAT_TURN_END_CONTROL_CHECKS_V1.map(check =>
    ({check, passed: true, reason: '注入的工程审查，仅验证合同，不代表剧情质量'}))}
}

export const chatTurnEndActionFixture = (): ChatNarrativeActionV1 => ({kind: 'complete', text: '我退回柜台外，将已经核实的线索按时间排好。',
  goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
  newFacts: [{factKey: 'ordered-notes', kind: 'observation', text: '我退回柜台外，将已经核实的线索按时间排好。',
    evidenceFactKeys: ['lost'], evidenceExcerpt: '我退回柜台外，将已经核实的线索按时间排好。'}], disclosures: [], threadUpdates: [], goalStatus: null})

export function chatTurnEndControlFixture() {
  const content = chatNarrativeFixture(); content.chatNarrative!.permissions.maxActionsPerTrigger = 2
  const initial = createInitialInteractionState(content)
  initial.activeScene = {...initial.sceneTemplates[0], sceneId: 'scene-turn-end', status: 'active', activeParticipantKeys: ['guard', 'artisan'],
    startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  initial.remainingDirectorBudget = 100
  const opened = requestChatNarrativeTriggerV1(initial, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null,
    direction: {actorKey: 'guard', actionLimit: 2, audienceParticipantKeys: ['guard'], conversationMode: 'private'}})
  const action = chatTurnEndActionFixture()
  const state = applyReviewedChatNarrativeActionV1(opened, {sequence: 3, triggerSequence: 2, actorKey: 'guard', messageId: 'ordered-notes-message',
    action, review: chatActionReviewFixture(action)})
  const handoff: ChatTurnEndControlV1 = {version: 2, kind: 'finish-current-turn', reason: 'local-purpose-completed',
    source: {messageId: 'ordered-notes-message', sequence: 3, excerpt: '将已经核实的线索按时间排好'}, purpose: '完成现有线索的整理，保留寻找铜印的目标'}
  return {state, handoff, input: {sequence: 4, triggerSequence: 2, actorKey: 'guard', handoff, review: chatTurnEndReviewFixture(handoff)}}
}
