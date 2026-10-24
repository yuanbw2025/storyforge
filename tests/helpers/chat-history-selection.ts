import {createInitialInteractionState, parseInteractionState} from '../../src/lib/character-interaction/runtime'
import {chatNarrativeFixture} from './chat-narrative-fixture'

/** Synthetic source-bound read-pressure state, not a meaningful-story score. */
export function chatHistorySelectionFixture(count = 80) {
  const state = createInitialInteractionState(chatNarrativeFixture()), story = state.chatNarrative!
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.history', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 500, endedAtSequence: null, playerTurns: 1}
  story.factEvidence = {version: 1, records: []}; story.resolutionEvidence = {version: 1, goals: [], threads: []}
  for (let i = 0; i < count; i++) {
    const factKey = `observed-${i}`, text = i === 7 ? '靛蓝地图背面有一枚杉木叶标记。' : `第${i}次沿途观察记录。` + '海岸旧家具的颜色当时被逐项记下，渔村风景保持安静。'.repeat(15)
    const sequence = i + 2
    story.situation.facts.push({factKey, text, audienceKeys: ['guard', 'player'], origin: 'runtime-consequence', sourceKnowledgeKey: null, sourceEventSequence: sequence})
    story.factEvidence.records.push({factKey, kind: 'observation', evidenceFactKeys: ['lost'], actorKey: 'guard', goalKey: 'find-seal', source: 'action'})
    state.messages.push({messageId: `observed-message-${i}`, eventSequence: sequence, role: 'character', speakerKey: 'guard', audienceKeys: ['guard', 'player'], text, replyToSequence: null, supersededBySequence: null})
    if (i < 12) {
      const goalKey = `closed-${i}`, threadKey = `closed-thread-${i}`, expression = i === 7 ? '靛蓝地图已核查，杉木叶标记确认，先结束这件事。' : `第${i}项旧记录核查结束。`
      const closedSequence = 300 + i, messageId = `closure-${i}`
      story.situation.goals.push({goalKey, actorKey: 'guard', desire: i === 7 ? '核查靛蓝地图' : `核查第${i}项旧记录`, concern: '避免误记', boundary: '不代替旅人决定', evidenceFactKeys: [factKey], status: 'fulfilled', updatedSequence: closedSequence})
      story.situation.threads.push({threadKey, title: i === 7 ? '靛蓝地图核查' : `第${i}项旧事`, question: '记录是否完成核查', audienceKeys: ['guard', 'player'], participantKeys: ['guard'], evidenceFactKeys: [factKey], closureSignals: ['核查完毕'], status: 'resolved', updatedSequence: closedSequence})
      state.messages.push({messageId, eventSequence: closedSequence, role: 'character', speakerKey: 'guard', audienceKeys: ['guard', 'player'], text: expression, replyToSequence: null, supersededBySequence: null})
      const record = {actorKey: 'guard', evidenceFactKeys: [factKey], source: {messageId, start: 0, end: expression.length}}
      story.resolutionEvidence.goals.push({targetKey: goalKey, ...record}); story.resolutionEvidence.threads.push({targetKey: threadKey, ...record})
    }
  }
  state.messages.sort((a, b) => a.eventSequence - b.eventSequence)
  state.messages.push({messageId: 'query', eventSequence: 501, role: 'player', speakerKey: 'player', audienceKeys: ['guard', 'player'], text: '以前靛蓝地图后来核查得怎样？', replyToSequence: null, supersededBySequence: null})
  story.revision = 1; story.lastEventSequence = 501
  return parseInteractionState(state)!
}
