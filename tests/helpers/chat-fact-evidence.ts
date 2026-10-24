import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

/** Synthetic facts for provenance engineering tests; not narrative acceptance. */
export const chatFactEvidenceAction: ChatNarrativeActionV1 = {kind: 'complete', text: '我取出借用登记卡。卡片右上角有一道折痕。', goalKey: 'find-seal', evidenceFactKeys: ['lost'],
  audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [
    {factKey: 'record-card', kind: 'object', text: '我取出借用登记卡。', evidenceFactKeys: ['lost'], evidenceExcerpt: '我取出借用登记卡。'},
    {factKey: 'card-corner', kind: 'observation', text: '卡片右上角有一道折痕。', evidenceFactKeys: ['record-card'], evidenceExcerpt: '卡片右上角有一道折痕。'},
  ], disclosures: [], threadUpdates: [], goalStatus: null}
