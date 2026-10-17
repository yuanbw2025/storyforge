/** Explicit human audio review/E16 plus pure scope helpers; no provider dispatch. */
export { readTtrpgOpenAudioDeskV1, prepareTtrpgOpenAudioUploadV1, prepareTtrpgOpenRetainedAudioV1, confirmTtrpgOpenAudioReviewV1, readTtrpgOpenAudioClipV1 } from './open-audio-service'
export type { TtrpgOpenAudioDeskInputV1, TtrpgOpenAudioDeskV1, TtrpgOpenAudioReviewV1 } from './open-audio-service'
export { createTtrpgOpenAudioScopeV1, assertTtrpgOpenAudioScopeAuthorityV1, parseTtrpgOpenAudioScopeV1,
  parseTtrpgOpenScopedAudioEventV1, projectTtrpgOpenScopedAudioV1 } from './open-audio-scope'
export type { TtrpgOpenAudioScopeV1, TtrpgOpenScopedAudioEventV1 } from './open-audio-scope'
export { archiveTtrpgOpenUnresumableCommonOracleWindowV1 } from './open-common-oracle-archive'
export { startTtrpgOpenCommonOracleWindowV1, finishTtrpgOpenEmptyCommonOracleWindowV1 } from './open-common-oracle-window'
export { prepareTtrpgOpenCommonOracleInputV1 } from './open-intent-input'
export { reviewTtrpgOpenCommonOracleCandidateV1, commitTtrpgOpenCommonOracleCandidateFactV1 } from './runtime-commands'
export { generateTtrpgOpenCommonOracleCandidateV1, executeTtrpgOpenCommonOracleRequestV1, recoverTtrpgOpenCommonOracleCandidateV1 } from './open-intent-harness'
export { readTtrpgOpenCommonOracleCandidateV1 } from './open-common-oracle-candidate'
export { closeTtrpgOpenReviewedCommonOracleWindowV1 } from './open-common-oracle-close'
export { finishTtrpgOpenCommonOracleDraftV1, reconcileTtrpgOpenStoppedCommonOracleV1 } from './open-runtime-draft-stop'
export { repairTtrpgOpenCommonOracleResponseReceiptV1, abandonTtrpgOpenCommonOracleWaitV1 } from './open-situation-request-recovery'
export { proposeTtrpgOpenEntitiesV1, confirmTtrpgOpenEntityOperationV1, materializeTtrpgOpenEntityV1, disposeTtrpgOpenEntityOperationV1 } from './runtime-commands'
/** Public deterministic runtime commands owned by the TTRPG product. */
export { createTtrpgOpenPublicSituationAuthorizationV1 } from './open-public-situation-authorization'
export type { TtrpgOpenPublicSituationAuthorizationInputV1 } from './open-public-situation-authorization'
export { prepareTtrpgOpenPublicSituationInputV1 } from './open-intent-input'
export {
  activateTtrpgCampaignSupplementV2,
  advanceTtrpgCharacterV1,
  changeTtrpgCampaignRosterV2,
  changeTtrpgSafetyStatus,
  classifyTtrpgSubmittedIntentV2,
  commitTtrpgDeterministicFallbackV1,
  commitTtrpgEffectPlanV2,
  commitTtrpgGmActorActionFromHarnessV1,
  commitTtrpgGmNarrationFromHarnessV1,
  commitTtrpgDirectorFromHarnessV1,
  commitTtrpgPrivateGuidanceFromHarnessV1,
  commitTtrpgHumanGmNarrationV1,
  commitTtrpgIntentDispositionV2,
  commitTtrpgItemCommandV2,
  commitTtrpgPlayerActionFromHarnessV1,
  completeTtrpgCampaignEnding,
  completeTtrpgCampaignSessionV2,
  completeTtrpgRestV2,
  completeTtrpgSessionZero,
  customizeTtrpgPlayerCharacterV1,
  discoverTtrpgClue,
  openTtrpgCampaignScene,
  proposeTtrpgEffectChoiceV2,
  recordTtrpgHumanResponseV2,
  recordTtrpgVersionTransitionV2,
  recordTtrpgWorldEvolutionV2,
  resolveTtrpgEffectChoiceV2,
  resolveTtrpgRuleAction,
  resolveTtrpgRuleCheck,
  startTtrpgCampaignSessionV2,
  submitTtrpgActionIntentV2,
  updateTtrpgTabletopV1,
  completeTtrpgOpenSessionZeroV1,
  startTtrpgOpenRunV1,
  consultTtrpgOracleV1,
  commitTtrpgOpenOracleFactV1,
  commitTtrpgOpenOracleRuntimeEntityFactV1,
  commitTtrpgOpenOracleCandidateFactV1,
  reviewTtrpgOpenOracleCandidateV1,
  retireTtrpgOpenSessionFactV1,
  discoverTtrpgOpenKnowledgeV1,
  shareTtrpgOpenKnowledgeV1,
  startTtrpgOpenEpochV1,
  closeTtrpgOpenEpochV1,
  inheritTtrpgOpenSourceV1,
  startTtrpgOpenInheritedOperationV1,
  reserveTtrpgOpenModelCallV1,
  dispatchTtrpgOpenModelCallV1,
  finishTtrpgOpenModelCallV1,
  startTtrpgOpenOperationV1,
  startTtrpgOpenIntentCandidateOperationV1,
  confirmTtrpgOpenOperationV1,
  selectTtrpgOpenOperationEffectV1,
  selectTtrpgOpenDiscoveryEffectV1,
  prepareTtrpgOpenPrivateChoiceDisclosureV1,
  discloseTtrpgOpenPrivateChoiceV1,
  disposeTtrpgOpenIntentV1,
  resolveTtrpgOpenOperationRuleV1,
  applyTtrpgOpenOperationEffectV1,
  completeTtrpgOpenOperationStepV1,
  completeTtrpgOpenOperationV1,
  advanceTtrpgWorldTurnV1,
  advanceTtrpgOpenPressureV1,
  prepareTtrpgOpenPressureEffectV1,
  readTtrpgOpenPressureEffectApprovalViewV1,
  proposeTtrpgOpenPressureEffectV1,
  confirmTtrpgOpenPressureEffectV1,
  applyTtrpgOpenPressureEffectV1,
  completeTtrpgOpenPressureSituationV1,
  advanceTtrpgOpenSituationsV1,
  preauthorizeTtrpgOpenCompanionV1,
  acceptTtrpgOpenKpNarrationV1,
  closeTtrpgOpenStageV1,
  advanceTtrpgOpenStageClosureV1,
  prepareTtrpgOpenStageEffectV1,
  readTtrpgOpenStageEffectApprovalViewV1,
  proposeTtrpgOpenStageEffectV1,
  confirmTtrpgOpenStageEffectV1,
  applyTtrpgOpenStageEffectV1,
  evaluateTtrpgOpenOperationTerminalV1,
  evaluateTtrpgOpenOperationGatesV1,
  prepareTtrpgOpenSituationEffectV1,
  readTtrpgOpenSituationEffectApprovalViewV1,
  proposeTtrpgOpenSituationEffectV1,
  confirmTtrpgOpenSituationEffectV1,
  applyTtrpgOpenSituationEffectV1,
  telegraphTtrpgOpenFrontV1,
  ttrpgOpenOperationCommandIdV1,
  type FormalTtrpgCommandEnvelope,
  type TtrpgOpenModelCallCommandV1,
} from './runtime-commands'

/** Internal open recovery is explicit; player routes remain gated until joint acceptance. */
export { resumeTtrpgOpenOperationV1 } from './open-operation-coordinator'
/** Actor reader foundation; formal open Skill/Context registration is still required before model dispatch. */
export { loadTtrpgOpenPlayerContextV1 } from './open-player-context'

export {
  applyProductRuntimeEvent,
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  hashProductRuntimeStateV1,
  parseProductRuntimeState,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  replayProductRuntimeEvents,
  verifyProductRuntimeCheckpoint,
} from '../product/runtime-api'

export {
  type TtrpgTabletopOperationV1,
} from './runtime-state'
export { prepareTtrpgOpenIntentInputV1, prepareTtrpgOpenOracleInputV1, prepareTtrpgOpenOracleInputV2, prepareTtrpgOpenFactNormalizationInputV1, prepareTtrpgOpenFactNormalizationInputV2 } from './open-intent-input'
export { recoverTtrpgOpenRuntimeCandidateV1, generateTtrpgOpenIntentCandidateV1, executeTtrpgOpenIntentRequestV1, readTtrpgOpenIntentCandidateV1,
  generateTtrpgOpenOracleCandidateV1, generateTtrpgOpenOracleCandidateV2, executeTtrpgOpenOracleRequestV1, readTtrpgOpenOracleCandidateV1, generateTtrpgOpenFactNormalizationCandidateV1, generateTtrpgOpenFactNormalizationCandidateV2, executeTtrpgOpenFactNormalizationRequestV1, readTtrpgOpenFactNormalizationCandidateV1 } from './open-intent-harness'
export { reconcileTtrpgOpenOracleFactRunV1, TtrpgOpenOracleReceiptPendingError } from './open-oracle-adoption'

export { resumeTtrpgOpenPressureV1 } from './open-pressure-coordinator'

export { resumeTtrpgOpenSituationsV1 } from './open-situation-coordinator'

export { resumeTtrpgOpenChecksV1 } from './open-checks-coordinator'

export { generateTtrpgOpenKpCandidateV1, generateTtrpgOpenCompanionCandidateV1, executeTtrpgOpenKpRequestV1, executeTtrpgOpenCompanionRequestV1 } from './open-intent-harness'
export { readTtrpgOpenKpCandidateV1 } from './open-kp-candidate'
export { reconcileTtrpgOpenKpRunV1 } from './open-kp-adoption'

export { offerTtrpgOpenHandoffV1 } from './runtime-commands'
export { delegateTtrpgOpenHostingV1,stopTtrpgOpenHostingV1 } from './runtime-commands'
export { startTtrpgOpenDelegatedCompanionOperationV1 } from './runtime-commands'
export { acceptTtrpgOpenDelegatedKpNarrationV1 } from './runtime-commands'
export { resumeTtrpgOpenPlayV1 } from './open-play-coordinator'

export { recordTtrpgOpenHumanNarrationV1 } from './runtime-commands'
export { recordTtrpgOpenNarrativeMemoryV1 } from './runtime-commands'
export { readTtrpgOpenNarrativeMemoriesV1 } from './open-memory-service'
export { reconcileTtrpgOpenHumanNarrationV1 } from './open-human-narration-recovery'
export { cancelTtrpgOpenPreparedRequestV1 } from './open-request-cancellation'

export { recoverTtrpgOpenOperationGatesV1, stopTtrpgOpenOperationGateRecoveryV1 } from './runtime-commands'

export { resumeTtrpgOpenHostingV1, type TtrpgOpenHostingInputV1, type TtrpgOpenHostingResultV1 } from './open-hosting-coordinator'

export { prepareTtrpgOpenBriefInputV1 } from './open-intent-input'
export { generateTtrpgOpenBriefCandidateV1, executeTtrpgOpenBriefRequestV1 } from './open-intent-harness'
export { readTtrpgOpenBriefCandidateV1 } from './open-brief-candidate'
export { acceptTtrpgOpenBriefMemoryV1 } from './runtime-commands'
export { reconcileTtrpgOpenBriefMemoryRunV1, TtrpgOpenBriefMemoryReceiptPendingError } from './open-brief-adoption'
export { readTtrpgWorldPatchDeskV1, buildTtrpgWorldPatchCandidateV1, exportTtrpgWorldPatchCandidateV1 } from './open-world-patch-service'
export { parseTtrpgWorldPatchCandidateV1, verifyTtrpgWorldPatchCandidateV1 } from './open-world-patch-contract'
export { loadTtrpgOpenSituationProposalBasisV1, preflightTtrpgOpenGeneratedSituationV1 } from './open-generated-situation-basis'

export { TtrpgOpenSituationRequestError, generateTtrpgOpenSituationCandidateV1, executeTtrpgOpenSituationRequestV1, recoverTtrpgOpenSituationCandidateV1 } from './open-intent-harness'
export { generateTtrpgOpenPublicSituationCandidateV1, executeTtrpgOpenPublicSituationRequestV1, recoverTtrpgOpenPublicSituationCandidateV1 } from './open-intent-harness'
export { readTtrpgOpenPublicSituationCandidateV1, readTtrpgOpenPublicSituationCandidateSummaryV1 } from './open-public-situation-candidate'
export { finishTtrpgOpenPublicSituationDraftV1, reconcileTtrpgOpenStoppedPublicSituationV1, readTtrpgOpenPublicSituationStopRepairsV1 } from './open-public-situation-stop'
export { repairTtrpgOpenPublicSituationResponseReceiptV1, abandonTtrpgOpenPublicSituationWaitV1 } from './open-situation-request-recovery'
export { acceptTtrpgOpenPublicSituationV1 } from './runtime-commands'
export { reconcileTtrpgOpenPublicSituationRunV1 } from './open-public-situation-adoption'
export { readTtrpgOpenPublicSessionSituationAuditV1 } from './open-public-situation-audit'
export { readTtrpgOpenSituationCandidateV1, readTtrpgOpenSituationCandidateSummaryV1 } from './open-generated-situation-candidate'

export { finishTtrpgOpenSituationDraftV1, reconcileTtrpgOpenStoppedSituationV1 } from './open-generated-situation-stop'
export { acceptTtrpgOpenSituationV1, activateTtrpgOpenSessionSituationV1 } from './runtime-commands'
export { reconcileTtrpgOpenSituationRunV1, TtrpgOpenSituationReceiptPendingError } from './open-session-situation-adoption'

export { readTtrpgOpenSessionSituationAuditV1 } from './open-session-situation-audit'

export { generateTtrpgOpenEntityCandidateV1, executeTtrpgOpenEntityRequestV1 } from './open-intent-harness'
export { prepareTtrpgOpenEntityInputV1 } from './open-intent-input'
export { readTtrpgOpenEntityCandidateV1 } from './open-entity-candidate'
export type { TtrpgOpenEntityCandidateV1 } from './open-entity-candidate'
export { finishTtrpgOpenEntityDraftV1, reconcileTtrpgOpenStoppedEntityV1 } from './open-entity-stop'
export { repairTtrpgOpenEntityResponseReceiptV1, abandonTtrpgOpenEntityWaitV1 } from './open-situation-request-recovery'
export { finishTtrpgOpenOracleInstanceDraftV1, reconcileTtrpgOpenStoppedOracleInstanceV1 } from './open-runtime-draft-stop'
export { repairTtrpgOpenOracleInstanceResponseReceiptV1, abandonTtrpgOpenOracleInstanceWaitV1 } from './open-situation-request-recovery'
export { finishTtrpgOpenNormalizationInstanceDraftV1, reconcileTtrpgOpenStoppedNormalizationInstanceV1 } from './open-runtime-draft-stop'
export { repairTtrpgOpenNormalizationInstanceResponseReceiptV1, abandonTtrpgOpenNormalizationInstanceWaitV1 } from './open-situation-request-recovery'
export { acceptTtrpgOpenEntityCandidateV1 } from './runtime-commands'
export { reconcileTtrpgOpenEntityRunV1, TtrpgOpenEntityReceiptPendingError } from './open-entity-adoption'
