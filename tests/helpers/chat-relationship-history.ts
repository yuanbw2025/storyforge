import {chatHistorySelectionFixture} from './chat-history-selection'
import {parseInteractionState} from '../../src/lib/character-interaction/runtime'

/** Read-pressure fixture. Dialogue and causes are historical engineering data,
 * not a model-authored story or evidence of relationship quality. */
export function chatRelationshipHistoryFixture() {
  const state = chatHistorySelectionFixture(40)
  state.relationships.push({fromParticipantKey: 'guard', toParticipantKey: 'player', dimensionKey: 'trust', label: '信任',
    value: 2, minimum: -100, maximum: 100, largeChangeThreshold: 20, lastChangedSequence: 81})
  for (const [source, sequence, text, reason] of [
    [70, 71, '我把借来的靛蓝钥匙按约定还给你了。', '靛蓝钥匙如约归还，让我更愿意相信你。'],
    [80, 81, '我提醒一下，今天路边风很大。', '这次提醒让我感到你很细心。'],
  ] as const) {
    state.messages.push({messageId: `relationship-player-${source}`, eventSequence: source, role: 'player', speakerKey: 'player',
      audienceKeys: ['guard', 'player'], text, replyToSequence: null, supersededBySequence: null},
    {messageId: `relationship-actor-${sequence}`, eventSequence: sequence, role: 'character', speakerKey: 'guard',
      audienceKeys: ['guard', 'player'], text: reason, replyToSequence: source, supersededBySequence: null})
    state.relationshipHistory.push({eventSequence: sequence, fromParticipantKey: 'guard', toParticipantKey: 'player', dimensionKey: 'trust',
      before: source === 70 ? 0 : 1, after: source === 70 ? 1 : 2, delta: 1, reason,
      ruleKey: 'chat.narrative.evidence.v1', sourceEventSequence: source, significantEventKey: null})
  }
  state.messages.sort((a, b) => a.eventSequence - b.eventSequence)
  state.messages.at(-1)!.text = '还记得靛蓝钥匙归还的事吗？这影响你是否愿意相信我吗？'
  return parseInteractionState(state)!
}
