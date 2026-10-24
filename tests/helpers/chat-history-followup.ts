import {chatHistorySelectionFixture} from './chat-history-selection'

/** Synthetic causal history under read pressure, not model quality evidence. */
export function chatHistoryFollowupFixture(count = 80) {
  const state = chatHistorySelectionFixture(), story = state.chatNarrative!
  // A later observation and a final state change explicitly refer to an older
  // event. Their vocabulary is unrelated to the player's old-map question.
  story.factEvidence!.records.find(r => r.factKey === 'observed-18')!.evidenceFactKeys = ['observed-7']
  story.factEvidence!.records.find(r => r.factKey === 'observed-70')!.evidenceFactKeys = ['observed-18']
  story.situation.facts.find(f => f.factKey === 'observed-70')!.text = '物件已交回柜台，角色现在双手空着。' + '交接记录的附注逐项保留。'.repeat(35)
  for (let i = 80; i < count; i++) {
    const factKey = `observed-${i}`
    story.situation.facts.push({...story.situation.facts[4], factKey, sourceEventSequence: i + 2,
      text: `第${i}项独立旧记录。` + '沿途无关观察保持原样。'.repeat(35)})
    story.factEvidence!.records.push({factKey, kind: 'observation', evidenceFactKeys: ['lost'], actorKey: 'guard', goalKey: 'find-seal', source: 'action'})
  }
  state.activeScene!.startedAtSequence = count + 500
  state.messages.at(-1)!.eventSequence = count + 501
  story.lastEventSequence = count + 501
  return state
}
