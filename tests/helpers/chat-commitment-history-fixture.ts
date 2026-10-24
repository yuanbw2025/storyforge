import {createInitialInteractionState, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {chatNarrativeFixture} from './chat-narrative-fixture'
import type {ChatGoalCommitmentV1} from '../../src/lib/types/chat-narrative'

export const historyTerms = (i: number) => i === 7 ? '我答应修补靛蓝地图后还给你。'
  : i === 15 ? '我答应把明天的巡视记录交给你。' : `我答应整理第${i}号海岸风物笔记。` + '记录渔村旧家具和船帆的颜色。'.repeat(42)
export const historyResolution = (i: number) => `我撤回第${i}项整理约定，目前无法负责。` + '原先的安排到此为止，不要求你接受其他安排。'.repeat(25)

/** Synthetic, source-bound state for retrieval scale tests. It is never
 * installed as a runtime event or presented as real conversation quality. */
export function chatCommitmentHistoryStateFixture() {
  const state = createInitialInteractionState(chatNarrativeFixture()), story = state.chatNarrative!
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.return', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 40, endedAtSequence: null, playerTurns: 1}
  const history: ChatGoalCommitmentV1[] = []
  for (let i = 0; i < 16; i++) {
    const sequence = i * 2 + 1, terms = historyTerms(i), messageId = `promise-${i}`
    state.messages.push({messageId, eventSequence: sequence, role: 'character', speakerKey: 'guard', audienceKeys: ['guard', 'player'],
      text: terms, replyToSequence: null, supersededBySequence: null})
    const resolution = i < 15 ? {kind: 'withdrawn' as const, messageId: `resolved-${i}`, sequence: sequence + 1, excerpt: historyResolution(i)} : null
    if (resolution) state.messages.push({messageId: resolution.messageId, eventSequence: resolution.sequence, role: 'character', speakerKey: 'guard', audienceKeys: ['guard', 'player'],
      text: resolution.excerpt, replyToSequence: null, supersededBySequence: null})
    history.push({commitmentKey: `${messageId}:promise`, terms, audienceKeys: ['guard', 'player'], declared: {messageId, sequence, excerpt: terms}, resolution})
  }
  story.situation.goals[0].commitments = history
  story.situation.goals[0].updatedSequence = 31
  story.revision = 1
  story.lastEventSequence = 41
  state.messages.push({messageId: 'query', eventSequence: 41, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'player'],
    text: '以前靛蓝地图的约定后来怎样了？', replyToSequence: null, supersededBySequence: null})
  return parseInteractionState(state)!
}
