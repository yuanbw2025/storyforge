import {assertRuntimeHarnessFreshV1} from '../agent/run/runtime-scope'
import {db} from '../db/schema'
import type {WorkspaceScope} from '../types'
import {readInteractionRuntimeCandidateV1} from './harness'
import {assertChatNarrativeOptionsPreviewableV1, CHAT_NARRATIVE_OPTION_KEYS_V1, selectedChatNarrativeOptionV1, type ChatNarrativeOptionKeyV1} from './narrative-options'
import {readProductRuntimeState} from './runtime-api'

export interface ChatNarrativeOptionsPreviewV1 {
  runId: number
  options: Array<{key: ChatNarrativeOptionKeyV1; text: string}>
  selectedOptionKey: ChatNarrativeOptionKeyV1 | null
  unavailableReason: string | null
}

/** A player projection, never the candidate object or the coordinator review.
 * Corrupt/stale candidates remain cancellable without hiding the whole chat. */
export async function readChatNarrativeOptionsPreviewV1(scope: WorkspaceScope, sessionId: number, runId: number): Promise<ChatNarrativeOptionsPreviewV1> {
  const preview: ChatNarrativeOptionsPreviewV1 = {runId, options: [], selectedOptionKey: null, unavailableReason: null}
  try {
    const {candidate, snapshot} = await readInteractionRuntimeCandidateV1(scope, runId)
    if (candidate.productRuntimeSessionId !== sessionId || candidate.kind !== 'chat-narrative-options-candidate') throw new Error('candidate-binding')
    if (!candidate.review) return {...preview, unavailableReason: '候选正在等待审查。'}
    const state = await readProductRuntimeState(sessionId)
    if (!state.interaction) throw new Error('candidate-visibility')
    assertChatNarrativeOptionsPreviewableV1(state.interaction, candidate.options)
    preview.options = CHAT_NARRATIVE_OPTION_KEYS_V1.map(key => ({key, text: selectedChatNarrativeOptionV1(candidate.options, candidate.review, key).action.text}))
    const confirmation = snapshot.events.find(e => e.type === 'confirmation.recorded' && e.payload.decision === 'adopt')
    if (confirmation?.type === 'confirmation.recorded') {
      if (confirmation.payload.candidateHash !== candidate.candidateHash || !CHAT_NARRATIVE_OPTION_KEYS_V1.includes(confirmation.payload.reviewItemId as ChatNarrativeOptionKeyV1)) throw new Error('selection-binding')
      preview.selectedOptionKey = confirmation.payload.reviewItemId as ChatNarrativeOptionKeyV1
    }
    if (!['running', 'awaiting_confirmation'].includes(snapshot.projection.state)) return {...preview, unavailableReason: '这组候选已结束或失效，请取消后重新发起。'}
    // A crash after the command commit can finish the same receipt. It cannot
    // choose the other alternative or replay consequences.
    const committed = preview.selectedOptionKey && (await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray())
      .find(e => e.commandId === `${candidate.commandId}:${preview.selectedOptionKey}`)
    if (!committed) await assertRuntimeHarnessFreshV1({scope, contractScope: snapshot.contract.scope, participantKey: candidate.participantKey})
    else if (committed.sequence !== state.lastSequence) throw new Error('post-selection-stale')
    return preview
  } catch {
    return {...preview, unavailableReason: '局面或候选已变化，这组行动不能再采用。请取消后重新发起。'}
  }
}
