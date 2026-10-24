import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

/** Synthetic closure evidence, never a real-model quality verdict. */
export function chatResolutionActionFixture(): ChatNarrativeActionV1 {
  return {kind: 'complete', text: '我已经说明：借用登记中没有记录铜印的去向。寻找先到这里，不再继续。', goalKey: 'clarify', evidenceFactKeys: ['lost', 'no-registration'],
    audienceKeys: ['guard', 'artisan', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], goalStatus: 'fulfilled', nextPossibilities: [],
    goalUpdates: [{goalKey: 'find-seal', status: 'abandoned', evidenceFactKeys: ['no-registration'], evidenceExcerpt: '借用登记中没有记录铜印的去向。'}],
    threadUpdates: [{threadKey: 'investigate', status: 'abandoned', evidenceExcerpt: '寻找先到这里，不再继续。'}]}
}
