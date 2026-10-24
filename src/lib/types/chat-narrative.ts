/** Product-private chat fiction; never a profile of the real user. */
export interface ChatPersonaV1 {
  playerKey: 'player'
  name: string
  description: string
  origin: 'product-private' | 'world-character'
  source?: {resourceKey: string; sourceHash: string}
}

export const CHAT_NARRATIVE_TRIGGERS_V1 = ['scene-start', 'player-response', 'continue', 'return', 'player-seed'] as const
export type ChatNarrativeTriggerV1 = typeof CHAT_NARRATIVE_TRIGGERS_V1[number]
export const CHAT_THREAD_STATUSES_V1 = ['open', 'blocked', 'paused', 'resolved', 'abandoned', 'transformed'] as const
export type ChatThreadStatusV1 = typeof CHAT_THREAD_STATUSES_V1[number]

export interface ChatNarrativePermissionsV1 {
  mode: 'story' | 'companionship'
  triggers: ChatNarrativeTriggerV1[]
  allowedNewFactKinds: Array<'observation' | 'object' | 'place' | 'temporary-character'>
  maxNewFactsPerAction: number
  maxActiveThreads: number
  maxActionsPerTrigger: number
  maxActionCharacters: number
  intensity: 'everyday' | 'tension' | 'danger'
  /** Missing in historical Releases means no autonomous situation expansion. */
  allowActorSituationExpansion?: boolean
  /** Explicit opt-in for a new player request after the actor's old goals end. */
  allowPlayerFollowupSituations?: boolean
  /** Explicit opt-in for an own next goal within an existing unfinished thread.
   * Historical Releases do not grant this authority. */
  allowActorThreadFollowups?: boolean
  /** Explicit opt-in; absent historical Releases cannot unlock hidden facts. */
  maxDiscoveriesPerSituation?: number
  /** New releases may explicitly allow grounded scene-NPC replies to actual questions. */
  allowInquiryResults?: boolean
}

export interface ChatSituationFactV1 {
  factKey: string
  text: string
  /** Empty means coordinator-only, never automatically visible to a role. */
  audienceKeys: string[]
  origin: 'reviewed-world' | 'author-private' | 'runtime-consequence' | 'runtime-situation'
  sourceKnowledgeKey: string | null
  sourceEventSequence: number
  /** Author-selected discovery conditions, never part of a role's input. */
  discovery?: ChatFactDiscoveryRuleV1
}

/** Deterministic provenance of an adopted runtime fact, not another fact body
 * and never an AI-authored field. Legacy facts may have no such evidence. */
export interface ChatFactEvidenceRecordV1 {
  factKey: string
  kind: ChatNarrativePermissionsV1['allowedNewFactKinds'][number]
  evidenceFactKeys: string[]
  actorKey: string | null
  goalKey: string | null
  source: 'action' | 'situation' | 'inquiry'
}

/** Commit-derived references for a terminal goal/thread. The original message
 * owns the expression; canonical target.updatedSequence owns the event number. */
export interface ChatResolutionEvidenceRecordV1 {
  targetKey: string
  actorKey: string
  evidenceFactKeys: string[]
  source: {messageId: string; start: number; end: number}
}

export interface ChatFactDiscoveryRuleV1 {
  sceneKey: string
  actorKeys: string[]
  condition: string
  prerequisiteFactKeys: string[]
}

export interface ChatFactDiscoveryV1 {
  factKey: string
  actorKey: string
  actionSequence: number
  evidenceFactKeys: string[]
  evidenceExcerpt: string
  result: 'discovered' | 'not-discovered' | 'inconclusive'
  reason: string
}

export interface ChatFactDiscoveryRecordV1 extends ChatFactDiscoveryV1 {
  /** Assigned by the committing event, never by the model. */
  discoverySequence: number
}

export interface ChatInquiryResultV1 {
  actorKey: string
  questionSequence: number
  questionExcerpt: string
  respondentFactKey: string
  respondentExcerpt: string
  respondentName: string
  statementFactKey: string
  answerKind: 'statement' | 'uncertain' | 'declined'
  answerText: string
  audienceKeys: string[]
  evidenceFactKeys: string[]
  discoveries: Array<{factKey: string; answerExcerpt: string; reason: string}>
}
export interface ChatInquiryResultRecordV1 extends ChatInquiryResultV1 {resultSequence: number; sceneKey: string}
export const CHAT_INQUIRY_REVIEW_CHECKS_V1 = ['actual-question', 'grounded-respondent', 'bounded-answer', 'actual-audience', 'meaningful-result'] as const
export interface ChatInquiryReviewV1 {
  checks: Array<{check: typeof CHAT_INQUIRY_REVIEW_CHECKS_V1[number]; passed: boolean; reason: string}>
  discoveries: Array<{factKey: string; passed: boolean; reason: string}>
}

export interface ChatActorGoalV1 {
  goalKey: string
  actorKey: string
  desire: string
  concern: string
  boundary: string
  evidenceFactKeys: string[]
  status: 'active' | 'paused' | 'fulfilled' | 'abandoned'
  updatedSequence: number
  /** Runtime declarations owned by this goal, never inferred from summaries. */
  commitments?: ChatGoalCommitmentV1[]
  /** A player-requested hold on this actor's remaining responsibility. */
  playerPause?: ChatGoalPlayerPauseV1
}

export interface ChatGoalPlayerPauseV1 {
  threadKey: string
  requested: ChatCommitmentEvidenceV1
  acknowledged: ChatCommitmentEvidenceV1
}

export interface ChatPlayerRequestEvidenceV1 {
  playerEventSequence: number
  playerExcerpt: string
}

export interface ChatCommitmentEvidenceV1 {
  messageId: string
  sequence: number
  excerpt: string
}

export interface ChatGoalCommitmentV1 {
  commitmentKey: string
  terms: string
  audienceKeys: string[]
  declared: ChatCommitmentEvidenceV1
  /** Runtime-bound player request; absent on existing fact-grounded promises. */
  requested?: ChatCommitmentEvidenceV1
  resolution: null | (ChatCommitmentEvidenceV1 & {kind: 'fulfilled' | 'withdrawn'})
}

/** Candidate effects; runtime supplies identity, speaker, audience and sequence. */
export type ChatCommitmentEffectV1 = {kind: 'promise'; terms: string; evidenceExcerpt: string}
  | {kind: 'fulfill' | 'withdraw'; commitmentKey: string; evidenceExcerpt: string}

export interface ChatActorBeliefV1 {
  beliefKey: string
  actorKey: string
  text: string
  evidenceFactKeys: string[]
  updatedSequence: number
}

export interface ChatNarrativeThreadV1 {
  threadKey: string
  title: string
  question: string
  audienceKeys: string[]
  participantKeys: string[]
  evidenceFactKeys: string[]
  closureSignals: string[]
  status: ChatThreadStatusV1
  updatedSequence: number
}

export interface ChatSituationV1 {
  situationKey: string
  sceneKey: string
  title: string
  location: string
  timeLabel: string
  seed: {
    text: string
    origin: 'author-confirmed' | 'player-request' | 'continued-thread' | 'player-followup'
    sourceEventSequence: number
    sourceThreadKey: string | null
  }
  facts: ChatSituationFactV1[]
  goals: ChatActorGoalV1[]
  beliefs: ChatActorBeliefV1[]
  threads: ChatNarrativeThreadV1[]
  /** Suggestions are explicitly separated from facts, and private to the actor. */
  possibilities: Array<{ actorKey: string; text: string; evidenceFactKeys: string[] }>
}

export interface FrozenChatNarrativeV1 {
  schema: 'storyforge.chat-narrative-content'
  version: 1
  worldReleaseHash: string
  persona: ChatPersonaV1
  permissions: ChatNarrativePermissionsV1
  initialSituation: ChatSituationV1
}

export interface ChatNarrativeStateV1 {
  schema: 'storyforge.chat-narrative-state'
  version: 1
  worldReleaseHash: string
  persona: ChatPersonaV1
  permissions: ChatNarrativePermissionsV1
  situation: ChatSituationV1
  revision: number
  lastEventSequence: number
  /** Durable authorizations; only the latest ready trigger may execute. */
  triggers: ChatNarrativeTriggerStateV1[]
  /** Versioned commit-derived evidence survives parentless branches. Event
   * sequence remains owned by the canonical fact, so it is rebased only once. */
  factEvidence?: {version: 1; records: ChatFactEvidenceRecordV1[]}
  resolutionEvidence?: {version: 1; goals: ChatResolutionEvidenceRecordV1[]; threads: ChatResolutionEvidenceRecordV1[]}
  /** Reviewed intention, or a bounded result of an already completed observation.
   * Player input cancels intentions, but keeps explicitly marked observation results pending. */
  pendingSituation?: ChatActorSituationRequestV1 & {actorKey: string; goalKey: string | null; sourceEventSequence: number}
  /** User-authored replacement, not dialogue or a fact until committed. */
  pendingEdit?: ChatMessageEditDraftV1
  /** User-selected dialogue omissions, not erased facts or revoked knowledge. */
  excludedMessageIds?: string[]
  /** Coordinator evidence; role readers receive only their safe outcome summary. */
  discoveryHistory?: ChatFactDiscoveryRecordV1[]
  /** Full evidence stays in the coordinator; listeners receive only their actual reply. */
  inquiryHistory?: ChatInquiryResultRecordV1[]
  /** A reviewed action reconsidered a particular player-authored correction.
   * This acknowledges use, never certifies the summary as a world fact. */
  memoryReconciliations?: ChatMemoryReconciliationRecordV1[]
  /** Completed, player-authorized visits to an already shared-known place.
   * Never a movement permission inferred from a scene description. */
  sceneTransitions?: ChatSceneTransitionRecordV1[]
}

export interface ChatSceneTransitionV1 extends ChatPlayerRequestEvidenceV1 {
  destinationFactKey: string
  destinationExcerpt: string
  arrivalFactKey: string
  evidenceExcerpt: string
}

export interface ChatSceneTransitionRecordV1 {
  sceneKey: string
  actorKey: string
  fromLocation: string
  destinationFactKey: string
  destinationExcerpt: string
  arrivalFactKey: string
  requested: ChatCommitmentEvidenceV1
  arrived: ChatCommitmentEvidenceV1
}

export interface ChatSceneTransitionCheckV1 {
  destinationFactKey: string
  arrivalFactKey: string
  playerEventSequence: number
  passed: boolean
  reason: string
}

export interface ChatMemoryReconciliationRecordV1 {
  memoryId: string
  sourceSequence: number
  actorKey: string
  messageId: string
  sequence: number
}

export interface ChatMemoryReconciliationCheckV1 {
  memoryId: string
  sourceSequence: number
  passed: boolean
  reason: string
}

export interface ChatMessageEditDraftV1 {
  /** Absent means editable replacement; other modes retain a chosen source. */
  mode?: 'continue' | 'option'
  sourceOption?: {candidateHash: string; optionKey: 'option-1' | 'option-2'}
  audienceKeys: string[] | null
  sourceMessageId: string
  role: 'player' | 'character'
  actorKey: string
  text: string
  /** Zero means saved atomically in a new branch's initial state. */
  requestedSequence: number
}

export interface ChatMessageEditBranchIntentV1 {
  kind: 'character-chat-message-edit'
  mode?: 'continue'
  sourceMessageId: string
  text: string
}

export interface ChatHistoricalOptionBranchIntentV1 {
  kind: 'character-chat-option-switch'
  sourceMessageId: string
  runId: number
  candidateHash: string
  optionKey: 'option-1' | 'option-2'
}

export interface ChatNarrativeTriggerStateV1 {
  kind: ChatNarrativeTriggerV1
  requestedSequence: number
  sourceEventSequence: number
  seed: string | null
  status: 'ready' | 'waiting-player' | 'complete' | 'cancelled'
  actionSequences: number[]
  /** Explicit per-turn player choice; absent historical turns keep release limits. */
  direction?: ChatTurnDirectionV1
  /** Reviewed control disposition, separate from authored actions. Full
   * candidate/review remain in the event and run; no review prose enters role
   * context. Sequence references must rebase with parentless branches. */
  controlHandoff?: ChatControlHandoffRecordV1
}

export interface ChatControlHandoffRecordV1 {
  /** v1 waits for a decision; v2 ends adopted progress; v3 keeps an adopted
   * pause; v4 retains a decision after the exact triggering acknowledgement. */
  version: 1 | 2 | 3 | 4
  sequence: number
  actorKey: string
  sourceMessageId: string
  sourceSequence: number
}

export interface ChatTurnDirectionV1 {
  actorKey: string
  actionLimit: number
  /** New explicit turns may settle the last reviewed direction without another action. */
  settleSituationVersion?: 1
  /** Explicit conversation scope for new turns; cannot be widened by a candidate. */
  audienceParticipantKeys?: string[]
  /** Missing on historical turns; old narrowed turns retain conservative scene boundaries. */
  conversationMode?: 'private' | 'present'
  /** Absent on historical/manual turns. The pool is frozen for this trigger. */
  scheduling?: {mode: 'natural' | 'round-robin'; participantKeys: string[]}
}

export type ChatActorSituationRequestV1 = {
  direction: string
  evidenceFactKeys: string[]
  evidenceExcerpt: string
} & ({
  /** Historical requests without this field remain interruptible intentions. */
  purpose?: 'observation-result'
  threadKey: string
} | {
  purpose: 'inquiry-result'
  threadKey: string
  respondentFactKey: string
  respondentExcerpt: string
  respondentName: string
} | {
  purpose: 'player-followup'
  threadKey: null
  playerEventSequence: number
  playerExcerpt: string
})

/** The model may cite existing evidence events, never assign new event numbers,
 * world references or player-state writes. */
/** A bounded own intention accepted together with the first response to a new
 * player request. The runtime assigns ownership, visibility and event identity. */
export interface ChatActorFollowupGoalV1 {
  playerEventSequence: number
  playerExcerpt: string
  evidenceExcerpt: string
  goal: Pick<ChatActorGoalV1, 'goalKey' | 'desire' | 'concern' | 'boundary' | 'evidenceFactKeys'>
  thread: Pick<ChatNarrativeThreadV1, 'threadKey' | 'title' | 'question' | 'evidenceFactKeys' | 'closureSignals'>
}

export interface ChatNarrativeActionV1 {
  kind: 'speak' | 'attempt' | 'complete' | 'pause'
  text: string
  /** Null only for the first reply to new player input after all own goals end. */
  goalKey: string | null
  evidenceFactKeys: string[]
  audienceKeys: string[]
  waitingForPlayer: boolean
  newFacts: Array<{
    factKey: string
    kind: ChatNarrativePermissionsV1['allowedNewFactKinds'][number]
    text: string
    evidenceFactKeys: string[]
    evidenceExcerpt: string
  }>
  disclosures: Array<{factKey: string; toParticipantKeys: string[]; evidenceExcerpt: string; wording?: 'equivalent'}>
  threadUpdates: Array<{threadKey: string; status: ChatThreadStatusV1; evidenceExcerpt: string}>
  goalStatus: ChatActorGoalV1['status'] | null
  /** Only independently reviewed, exact expressions can change a promise. */
  commitmentEffects?: ChatCommitmentEffectV1[]
  /** Other existing goals belonging to this actor, changed by the same action. */
  goalUpdates?: Array<{goalKey: string; status: ChatActorGoalV1['status']; evidenceFactKeys: string[]; evidenceExcerpt: string}>
  /** Optional so historical canonical action/review bindings remain unchanged.
   * Only the acting character's attitude toward the player can change. */
  relationshipUpdates?: Array<{
    dimensionKey: string
    delta: number
    sourceEventSequence: number
    playerExcerpt: string
    evidenceExcerpt: string
  }>
  /** Undefined/null preserves current private plans; [] deliberately clears
   * them. The runtime stamps actor identity, never the model. */
  nextPossibilities?: Array<{text: string; evidenceFactKeys: string[]}> | null
  /** Own hypotheses only. Null withdraws an existing hypothesis; these never
   * become facts or another participant's beliefs. */
  beliefUpdates?: Array<{beliefKey: string; text: string | null; evidenceFactKeys: string[]}>
  /** A reviewed request to develop an existing own goal, not a new fact. */
  situationRequest?: ChatActorSituationRequestV1 | null
  /** No new background or authority. Omitted in historical action bindings. */
  followupGoal?: ChatActorFollowupGoalV1 | null
  /** Continues an existing known thread; never creates or reopens a thread. */
  threadFollowupGoal?: ChatActorThreadFollowupGoalV1 | null
  /** Only a new visible player message can release a recorded player hold. */
  resumeGoal?: ChatPlayerRequestEvidenceV1 | null
  /** Accepts a current player hold on an existing own unfinished goal. */
  pauseGoal?: (ChatPlayerRequestEvidenceV1 & {threadKey: string; evidenceExcerpt: string}) | null
  /** Explicit latest-player-request basis for a new own promise only. */
  promiseRequest?: ChatPlayerRequestEvidenceV1 | null
  /** A completed shared visit, not an invitation or an attempt to depart. */
  sceneTransition?: ChatSceneTransitionV1 | null
  /** End only this turn after the same action meets a reviewed local purpose. */
  turnCompletion?: ChatTurnCompletionV1 | null
}

export interface ChatTurnCompletionV1 {
  version: 1
  purpose: string
  evidenceExcerpt: string
}

export interface ChatActorThreadFollowupGoalV1 {
  threadKey: string
  evidenceExcerpt: string
  goal: Pick<ChatActorGoalV1, 'goalKey' | 'desire' | 'concern' | 'boundary' | 'evidenceFactKeys'>
  /** Acknowledges a hold on the remaining responsibility, not a new task. */
  pauseRequest?: ChatPlayerRequestEvidenceV1
}

/** A local background extension, never a replacement of established truth or a
 * script for the player's future behavior. Provenance is assigned by the runtime. */
export interface ChatSituationDraftV1 {
  kind: 'chat-situation'
  title: string
  location: string
  timeLabel: string
  newFacts: Array<{
    factKey: string
    kind: ChatNarrativePermissionsV1['allowedNewFactKinds'][number]
    text: string
    audienceKeys: string[]
    evidenceFactKeys: string[]
    seedExcerpt: string
  }>
  newGoals: Array<Omit<ChatActorGoalV1, 'status' | 'updatedSequence'>>
  newThreads: Array<Omit<ChatNarrativeThreadV1, 'status' | 'updatedSequence'>>
  possibilities: ChatSituationV1['possibilities']
  /** Optional to preserve canonical historical candidates and reviews. */
  discoveries?: ChatFactDiscoveryV1[]
  inquiryResult?: ChatInquiryResultV1
}

export const CHAT_SITUATION_REVIEW_CHECKS_V1 = ['continuity', 'permissions', 'player-agency', 'visibility', 'meaningful-direction'] as const
export interface ChatSituationReviewV1 {
  /** Canonical exact input retained by the system, not an AI-computed hash. */
  reviewedProposalJson: string
  checks: Array<{check: typeof CHAT_SITUATION_REVIEW_CHECKS_V1[number]; passed: boolean; reason: string}>
  inquiryReview?: ChatInquiryReviewV1
}


export const CHAT_ACTION_REVIEW_CHECKS_V1 = ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'] as const
export interface ChatNarrativeActionReviewV1 {
  /** System-bound exact action, not a hash supplied by the reviewing model. */
  reviewedActionJson: string
  checks: Array<{check: typeof CHAT_ACTION_REVIEW_CHECKS_V1[number]; passed: boolean; reason: string}>
  /** Every natural paraphrase needs a separately bound full-equivalence review. */
  disclosureChecks?: Array<{factKey: string; passed: boolean; reason: string}>
  commitmentChecks?: Array<{effectIndex: number; passed: boolean; reason: string}>
  memoryChecks?: ChatMemoryReconciliationCheckV1[]
  sceneTransitionCheck?: ChatSceneTransitionCheckV1
  turnCompletionCheck?: {passed: boolean; reason: string}
}
