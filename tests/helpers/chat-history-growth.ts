import * as api from '../../src/lib/character-interaction/runtime-api'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from './chat-narrative-fixture'

/** Injected engineering load over the formal Harness, never story-quality or
 * provider evidence. Also usable in native browser IndexedDB without the unit
 * test shim, whose transaction scheduler has its own growth cost. */
export async function seedChatHistoryGrowthFixture() {
  const f = await seedChatNarrativeRuntimeFixture({directorBudget: 10000, playerFollowup: true})
  let calls = 0
  const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId,
    commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
  const perform = async (action: ChatNarrativeActionV1, player?: string, inspect?: (phase: 'actor' | 'review', text: string) => void) => {
    const version = await api.readProductRuntimeStateVersion(f.sessionId)
    const source = player ? (await api.commitInteractionPlayerMessage({...await command(), messageId: crypto.randomUUID(), text: player})).sequence : version.sequence
    await api.requestChatNarrativeTrigger({...await command(), kind: player ? 'player-response' : source === f.sceneSequence ? 'scene-start' : 'continue', sourceEventSequence: source})
    const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId,
      participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '正式持续后果容量注入，不计入真实剧情验收',
      runAI: async (messages, signal) => {
        calls++ // Count choice and expression; inspection remains role expression only.
        return withChatActionChoiceFixture(async expression => {
          inspect?.('actor', expression.map(m => m.content).join('\n')); return JSON.stringify(action)
        })(messages, signal)
      },
      runReviewAI: async messages => {calls++; inspect?.('review', messages.map(m => m.content).join('\n')); return JSON.stringify(chatActionReviewOutputFixture())}})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  }
  return {...f, perform, calls: () => calls}
}

export function chatHistoryGrowthObservation(i: number): ChatNarrativeActionV1 {
  const texts = [0, 1].map(j => i === 0 && j === 0 ? '靛蓝地图登记旁有杉木叶标记。' : `第${i * 2 + j}次核对登记留下了当次独立记录。`)
  return {kind: 'complete', text: texts.join('\n'), goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: texts.map((text, j) => ({factKey: `capacity-${i * 2 + j}`, kind: 'observation', text, evidenceFactKeys: ['lost'], evidenceExcerpt: text})),
    disclosures: [], threadUpdates: [], goalStatus: null}
}
