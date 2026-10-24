import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {commitInteractionPlayerMessage, endInteractionScene, readProductRuntimeStateVersion, requestChatNarrativeTrigger, startInteractionScene} from '../../src/lib/character-interaction/runtime-api'
import {seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from './chat-narrative-fixture'
import {chatCommitmentReviewOutputFixture, chatPromiseActionFixture} from './chat-commitment-fixture'
import {historyTerms, historyResolution} from './chat-commitment-history-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

/** Real durable events with injected producer/reviewer outputs, not model or
 * human acceptance. Scene changes keep unrelated raw dialogue out of review. */
export async function seedChatCommitmentHistoryRuntimeFixture(options: {count?: number} = {}) {
  const count = options.count ?? 16
  const f = await seedChatNarrativeRuntimeFixture()
  const command = async () => {const v = await readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
  const perform = async (action: ChatNarrativeActionV1) => {
    const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '承诺历史工程夹具',
      runAI: withChatActionChoiceFixture(async () => JSON.stringify(action)), runReviewAI: async () => JSON.stringify(chatCommitmentReviewOutputFixture(action))})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
    return generated.snapshot.run.id
  }
  let sceneId = 'inn.current', sceneSequence = f.sceneSequence
  for (let i = 0; i < count; i++) {
    await requestChatNarrativeTrigger({...await command(), kind: 'scene-start', sourceEventSequence: sceneSequence})
    const runId = await perform(chatPromiseActionFixture(historyTerms(i)))
    if (i < count - 1) {
      await requestChatNarrativeTrigger({...await command(), kind: 'continue', sourceEventSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence})
      const text = historyResolution(i)
      await perform({...chatPromiseActionFixture(), text, commitmentEffects: [{kind: 'withdraw', commitmentKey: `message:harness:${runId}:promise`, evidenceExcerpt: text}]})
    }
    await endInteractionScene({...await command(), sceneId, reason: '跨场景保留承诺记录'})
    sceneId = `inn.history-${i}`
    sceneSequence = (await startInteractionScene({...await command(), sceneId, sceneKey: 'inn'})).sequence
  }
  const query = await commitInteractionPlayerMessage({...await command(), messageId: 'history-query', text: '以前靛蓝地图的约定后来怎样了？'})
  await requestChatNarrativeTrigger({...await command(), kind: 'player-response', sourceEventSequence: query.sequence})
  return f
}
