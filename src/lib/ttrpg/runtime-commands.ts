import type { TtrpgOpenVoiceRunSetWitnessV1 } from './open-voice-request-run'
import { parseTtrpgOpenAudioRequestV1, ttrpgOpenAudioSourceEqualV1 } from './open-audio-contract'
import { createTtrpgOpenAudioReceipt, parseTtrpgOpenAudioRequest, type TtrpgOpenAudioRequest } from './open-audio-receipt'
import { parseTtrpgOpenAudioRequestV2 } from './open-generated-audio-contract'
import { readTtrpgOpenGeneratedAudioNativeProofV1, verifyTtrpgOpenGeneratedAudioOriginV1, assertTtrpgOpenGeneratedAudioCheckpointsV1, type TtrpgOpenGeneratedAudioWitnessV1 } from './open-generated-audio-evidence'
import { readTtrpgOpenAudioGeneratedTicketV2, type TtrpgOpenAudioGeneratedTicketV2, readTtrpgOpenAudioUploadTicketV1, readTtrpgOpenAudioMediaWitnessV1, assertTtrpgOpenAudioMediaWitnessV1, type TtrpgOpenAudioMediaWitnessV1, type TtrpgOpenAudioUploadTicketV1 } from './open-audio-media'
import { verifyTtrpgOpenAudioReceiptsV1 } from './open-audio-proof'
import { createTtrpgOpenIdentityKnowledgeV1, ttrpgOpenIdentityKnowledgeEventV1, ttrpgOpenIdentityKnowledgePayloadV1 } from './open-identity-knowledge'
import { parseTtrpgOpenIdentityKnowledgeRequestV1, type TtrpgOpenIdentityKnowledgeRequestV1 } from './open-identity-knowledge-contract'
import { hashTtrpgOpenIdentityKnowledgeConfirmationV1, verifyTtrpgOpenIdentityKnowledgeV1 } from './open-identity-knowledge-proof'
import { parseTtrpgOpenCommonOracleAuthorizationV1, hashTtrpgOpenCommonOracleRequestBasisV1, assertTtrpgOpenCommonOracleRequestSourceV1, TTRPG_OPEN_COMMON_ORACLE_INPUT_V1, type TtrpgOpenCommonOracleAuthorizationV1 } from './open-common-oracle-request'
import { assertTtrpgOpenCommonOracleEpochAuthorityV1, assertTtrpgOpenCommonOracleEpochOriginV1 } from './open-coordination'
import { assertTtrpgOpenEntityModelCallOriginV1 } from './open-model-calls'
import { prepareTtrpgOpenEntityAdoptionV1, reconcileTtrpgOpenEntityRunV1, TtrpgOpenEntityReceiptPendingError } from './open-entity-adoption'
import { assertTtrpgOpenEntityCandidateReaderV1 } from './open-entity-candidate'
import { verifyTtrpgOpenEntityStateV1 } from './open-entity-proof'
import { createTtrpgOpenEntityPlanV1 } from './open-entity-plan'
import { parseTtrpgOpenEntityProposalV1 } from './open-entity-contract'
import { assertTtrpgOpenEntityLiveV1, recheckTtrpgOpenEntityMaterializationV1 } from './open-entity-operation'
import { settleTtrpgOpenSessionSituationAdmissionV1 } from './open-session-situation-reducer'
import { verifyTtrpgOpenSessionSituationHashesV1 } from './open-session-situation-proof'
import { parseTtrpgOpenPublicSituationAuthorizationV1, TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1 } from './open-public-situation-authorization-contract'
import { verifyTtrpgOpenPublicSituationAuthorizationV1 } from './open-public-situation-authorization-proof'
import { ttrpgOpenSituationCatalogV1, ttrpgOpenSituationCatalogSnapshotV1 } from './open-session-situation-catalog'
import { prepareTtrpgOpenSituationAdoptionV1, reconcileTtrpgOpenSituationRunV1, TtrpgOpenSituationReceiptPendingError } from './open-session-situation-adoption'
import { prepareTtrpgOpenPublicSituationAdoptionV1, reconcileTtrpgOpenPublicSituationRunV1 } from './open-public-situation-adoption'
import { assertTtrpgOpenSituationHumanGmV1, assertTtrpgOpenSituationRequesterV1 } from './open-generated-situation-candidate'
import { ttrpgOpenEpochBudgetForTriggerV1, assertTtrpgOpenBriefEpochAuthorityV1, assertTtrpgOpenSituationEpochAuthorityV1, isTtrpgOpenPassiveEpochV1, assertTtrpgOpenSituationWindowEventV1 } from './open-coordination'
import { verifyTtrpgOpenBriefCandidateProofV1 } from './open-brief-candidate'
import { parseTtrpgOpenModelMemoryReceiptV2 } from './open-model-memory-contract'
import { ttrpgOpenMemoryPrefixRootsV2, ttrpgOpenModelMemoryWindowBodyV2 } from './open-memory-prefix-proof'
import { loadTtrpgOpenBriefContextV1 } from './open-brief-context'
import { reconcileTtrpgOpenBriefMemoryRunV1, TtrpgOpenBriefMemoryReceiptPendingError } from './open-brief-adoption'
import { ttrpgOpenOperationEffectTemplateKeyV1,ttrpgOpenOperationEffectDegreeV1,buildTtrpgOpenInteractionEffectV1,assertTtrpgOpenInteractionKnownCostsV1,assertTtrpgOpenInteractionChoiceCostV1 } from './open-interaction'
import { runtimeInstanceTablesV1 } from '../registry/lifecycle'
import { parseTtrpgOpenMemoryDraftV1, authorizeTtrpgOpenMemoryDraftV1, parseTtrpgOpenMemoryReceiptV1, assertTtrpgOpenManualMemoryInputV1,
  type TtrpgOpenMemoryDraftV1 } from './open-memory-contract'
import { assertTtrpgOpenAuthorizationRowsCurrentV1 } from './open-authorization'
import { ttrpgOpenMemoryEventDigestV1, ttrpgOpenMemoryWindowBodyV1, ttrpgOpenMemoryLineageBodyV1, verifyTtrpgOpenMemoryReceiptsV1, projectTtrpgOpenMemoryRowV1 } from './open-memory-proof'
import { createTtrpgOpenHostingDelegationV1,assertTtrpgOpenHostingRequestV1,assertTtrpgOpenHostingDelegationV1,assertTtrpgOpenDelegatedCompanionProposalV1,assertTtrpgOpenDelegatedNarrationV1 } from './open-hosting-delegation'
import { createTtrpgOpenTableMessageV1,parseTtrpgOpenTableMessageRequestV1,type TtrpgOpenTableMessageRequestV1 } from './open-table-conversation'
import { ttrpgOpenTurnOwnerStepV1,ttrpgOpenTurnCycleMatchesV1,ttrpgOpenTurnCycleMetadataV1 } from './open-turn-settlement'
import { verifyTtrpgOpenManualAuthorizationV1,assertTtrpgOpenManualRequestV1,type TtrpgOpenManualActionAuthorizationV1 } from './open-manual-action'
import { buildTtrpgOpenPrivateChoiceBodyV1,assertTtrpgOpenPrivateChoiceConsentV1,verifyTtrpgOpenPrivateChoiceHashesV1 } from './open-private-choice'
import { ttrpgOpenDiscoveryEffectTemplatesV1 } from './open-discovery-effect-templates'
import { planTtrpgOpenGateRecoveryV1, settleTtrpgOpenGateRecoveryV1, stopTtrpgOpenGateRecoveryV1 } from './open-gate-recovery'
import { reconcileTtrpgOpenHumanNarrationV1, TtrpgOpenHumanNarrationReceiptPendingError } from './open-human-narration-recovery'
import { createTtrpgOpenHumanNarrationReceiptV1 } from './open-kp-reducer'
import { readTtrpgOpenIntentCandidateV1 } from './open-intent-candidate'
import { verifyTtrpgOpenRuntimeCandidateEvidenceV1 } from './open-runtime-candidate'
import { evaluateTtrpgOpenHandoffV1 } from './open-handoff'
import { previewTtrpgOpenCompanionPermissionV1 } from './open-companion-preauthorization';
import { assertTtrpgOpenModelActorV1 } from './open-model-purpose';
import { loadTtrpgOpenKpContextV1 } from './open-kp-context';
import { verifyTtrpgOpenKpCandidateProofV1 } from './open-kp-candidate';
import { parseTtrpgOpenNarrationReceiptV1 } from './open-kp-receipt';
import { reconcileTtrpgOpenKpRunV1, TtrpgOpenKpReceiptPendingError } from './open-kp-adoption';
import { parseTtrpgOpenStageClosureV1, planTtrpgOpenStageClosureTicksV1, assertTtrpgOpenStageClosureEligibleV1, settleTtrpgOpenStageClockV1, ttrpgOpenClosedStageRecoveryAllowedV1 } from './open-stage-close';
import { parseTtrpgOpenTerminalReceiptV1, evaluateTtrpgOpenTerminalV1, parseTtrpgOpenGateReceiptV1, evaluateTtrpgOpenPlayerGatesV1, ttrpgOpenGateBasisJsonV1, ttrpgOpenGateHumanActorsV1 } from './open-terminal-gates';
import { parseTtrpgOpenSituationCycleV1, nextTtrpgOpenSituationCycleActionV1, ttrpgOpenSituationCycleActionKeyV1, settleTtrpgOpenSituationCycleActionV1, ttrpgOpenSituationEffectWorkV1, ttrpgOpenSituationQueueCreditsV1 } from './open-situation-cycle';
import { TtrpgOpenReadConflictV1 } from './open-read-conflict';
import { settleTtrpgOpenSituationWorkV1, ttrpgOpenSituationGateContextV1, ttrpgOpenSituationProjectionActorV1 } from './open-situation-runtime';
import { currentTtrpgOpenPressureEffectReviewV1, parseTtrpgOpenPressureEffectRequestV1, ttrpgOpenPressureEffectDefinitionV1, prepareTtrpgOpenPressureEffectReviewV1, ttrpgOpenPressureEffectReviewCurrentV1, createTtrpgOpenPressureEffectPlanV1, settleTtrpgOpenPressureEffectPlanV1, type TtrpgOpenPressureEffectRequestV1 } from './open-pressure-effect';
import * as pressureParse from './open-contract-parse';
import { parseTtrpgOpenPressureCycleV1, parseTtrpgOpenPressureSignalV1, assertTtrpgOpenPressureGmV1, planTtrpgOpenPressureTicksV1, nextTtrpgOpenPressureActionV1, ttrpgOpenPressureRuntimeProjectionV1, sameTtrpgOpenPressureSourceV1, ttrpgOpenPressureRuleSourceV1 } from './open-pressure-cycle';
import { pressureActionKeyV1 } from './open-pressure-reducer';
import { evaluateTtrpgFrontTelegraphV1, evaluateTtrpgFrontAdvanceV1, evaluateTtrpgFrontDefeatV1 } from './pressure-runtime';
import { resolveTtrpgRuleActionMechanicalV1 } from './rule-action-mechanical';
/** Product-owned deterministic runtime commands: ttrpg. */
import { applyTtrpgEffectPlanToRuntimeV2, proposeTtrpgEffectChoiceToRuntimeV2, resolveTtrpgEffectChoiceToRuntimeV2 } from "./effect-runtime";
import { assertProductReleaseUnchanged } from "../product/releases";
import { availableTtrpgCharacterCurrencyV2 } from "./advancement";
import { createCompleteTtrpgCharacterSheetV2 } from "./character-sheet";
import { createTtrpgActionReceiptV2, parseTtrpgGmSynthesisFrameV2, assertTtrpgFeedbackOutcomeConsistentV2, createDeterministicGmSynthesisFrameV2 } from "./action-feedback";
import { db } from "../db/schema";
import { evaluateTtrpgActionRequirementsV2 } from "./action-requirement";
import { parseRulePackV1, evaluateRuleNumberExpressionV1, resolveRulePackDiceModelV1, resolveRulePackCheckV1 } from "./rule-pack";
import { parseTtrpgEffectPlanV2 } from "./effect-plan";
import { parseTtrpgItemCommandV2, ttrpgItemDefinitionFromRuleV1, applyTtrpgItemCommandV2 } from "./item-ledger";
import { readTtrpgSessionParticipantsV2, finalizeTtrpgSessionParticipantsV2 } from "./participants";
import { resetTtrpgAbilityUsageV2, ttrpgAbilityStateKeyV2 } from "./ability-ledger";
import { spendTtrpgActionEconomyV2 } from "./action-economy";
import { applyProductRuntimeEvent, assertFiniteInteger, cloneState, hashStateJson, isObject, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readLatestSessionEventSequenceV1, readProductRuntimeState, readProductRuntimeStateVersion, readSessionEvents, readVerifiedProductRuntimeHeadV1, replayProductRuntimeEvents, stableJson } from "../product/runtime-core";
import { TTRPG_SHA256, applyTtrpgTabletopOperationV1, assertTtrpgCampaignMemoryV2, assertTtrpgRuleActionResult, longCampaignKey, longCampaignText, parseTtrpgIntentReceiptV2, parseTtrpgModelEvidenceV1, parseTtrpgTabletopOperationV1, ttrpgDegreeSucceededV2, type TtrpgTabletopOperationV1 } from "./runtime-state";
import {
  createTtrpgVerifiedContentViewV1,
} from "./content-version";
import { verifyProductReleaseManifestV1 } from "../product-production/runtime-package";
import { verifyProductRuntimeSource } from "../product-production/preview-source";
import type { TtrpgRuntimeContentV2 } from "./content-version";
import {
  createTtrpgOpenRunStateV1,
  parseTtrpgOpenRunStateV1,
  type TtrpgOpenFailureCategoryV1,
  type TtrpgOpenFailureRuntimeStateV1,
  type TtrpgOpenRunStateV1,
  type TtrpgOpenSituationRuntimeStateV1,
} from "./open-runtime-contract";
import { instantiateTtrpgSituationV1, assertTtrpgSituationInstanceGatesV1 } from "./situation-engine";
import { parseTtrpgRuntimeStateV2 } from "./open-runtime-contract";
import { createTtrpgOpenAuthorizationV1, assertTtrpgOpenAuthorizationCurrentV1, assertTtrpgOpenHumanHostV1 } from "./open-authorization";
import { parseTtrpgOpenEpochV1, frozenTtrpgOpenEpochBudgetV1,
  ttrpgOpenScopedKeyV1, assertTtrpgOpenEpochAuthorityV1 } from "./open-coordination";
import { key as openKey, text as openText, hash as openHash, list as openList } from "./open-contract-parse";
import { hashProductProductionValueV2 } from "../product-production/hash";
import { createTtrpgOpenRulePlanV1, ttrpgOpenMechanicalStateHashV1, parseTtrpgOpenRuleRequestV1, type TtrpgOpenRuleRequestV1 } from './open-rule-plan';
import { resolveTtrpgOpenIntentTargetV1 } from './open-rule-request-contract';
import { parseTtrpgOpenOperationV1, parseTtrpgOpenRuleReceiptV1, ttrpgOpenOperationStepsV1, nextTtrpgOpenOperationStepV1, ttrpgOpenOperationRuleCauseV1 } from './open-operation';
import { parseTtrpgOpenRulePlanV1 } from './open-rule-plan';
import { ttrpgOpenRecoveryApprovalsV1, ttrpgOpenAncestorRuleReceiptForTaskV1, ttrpgOpenCoveredBusinessKeysV1 } from './open-branch-recovery';
import { resolveTtrpgOpenRuleMechanicalV1 } from './open-rule-resolution';
import { parseTtrpgOpenModelCallV1, assertTtrpgOpenCallReservationV1, assertTtrpgOpenOracleInterpretationSlotV1, assertTtrpgOpenSupportSlotV1, assertTtrpgOpenNormalizationSourceV1, type TtrpgOpenModelCallV1 } from './open-model-calls';
import { verifyTtrpgOpenModelCallEvidenceV1, assertTtrpgOpenAgentEvidenceUnchangedV1, assertTtrpgOpenCommonOracleArchiveWitnessV1, type TtrpgOpenCommonOracleArchiveWitnessV1, type TtrpgOpenAgentEvidenceV1 } from './open-model-call-evidence';
import { resolveScope } from '../workspace/scope';
import { verifyTtrpgOpenIntentCandidateProofV1 } from './open-intent-candidate';
import { parseTtrpgOpenIntentSelectionV1, hashTtrpgOpenIntentClarificationV1, type TtrpgOpenIntentClarificationV1,
  type TtrpgOpenIntentSelectionV1 } from './open-intent-clarification-contract';
import { readTtrpgOpenOracleCandidateV1, readTtrpgOpenFactNormalizationCandidateV1, verifyTtrpgOpenOracleCandidateProofV1 } from './open-oracle-candidate';
import type { WorkspaceScope } from '../types';
import { parseTtrpgOpenCommonOracleRequestCloseV1, type TtrpgOpenCommonOracleRequestCloseV1 } from './open-common-oracle-request';
import { loadTtrpgOpenGmOracleContextV1 } from './open-gm-oracle-context';
import { parseTtrpgOpenOracleReviewV1, parseTtrpgOpenOracleReviewChoiceV1, verifyTtrpgOpenOracleReviewHashesV1, type TtrpgOpenOracleReviewChoiceV1 } from './open-oracle-review';
import { reconcileTtrpgOpenOracleFactRunV1, TtrpgOpenOracleReceiptPendingError } from './open-oracle-adoption';
import { loadTtrpgOpenPlayerContextV1 } from './open-player-context';
import { resolveTtrpgOracleV1, verifyTtrpgOracleOutcomeV1, type TtrpgOracleOutcomeV1 } from './oracle';
import { parseTtrpgOpenOracleReceiptV1, assertTtrpgOpenOracleCallerV1, verifyTtrpgOpenOracleJournalV1 } from './open-oracle-contract';
import { createTtrpgOpenFactBasisV1, verifyTtrpgOpenFactLedgerV1, parseTtrpgOpenOracleFactProposalV1, hashTtrpgOpenOracleFactCandidateV1,
  parseTtrpgOpenFactEntryV1, parseTtrpgOpenFactRetirementV1, ttrpgOpenFactSourceEventRefV1, assertTtrpgOpenFactEntryGatesV1,
  ttrpgOpenSessionFactsV1, ttrpgOpenFactIdentityV1, assertTtrpgOpenModelFactApproverV1, type TtrpgOpenFactModelCandidateV1, type TtrpgOpenOracleFactProposalV1 } from './open-fact-ledger';
import { assertTtrpgOpenOracleRuntimeEpochAuthorityV1, TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1, TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1 } from './open-coordination';
import { assertTtrpgOpenOracleRuntimeCallOriginV1, ttrpgOpenSemanticRuntimeReferencePolicyV1 } from './open-model-calls';
import { parseTtrpgOpenOracleRuntimeReferencePolicyV1, assertTtrpgOpenOracleRuntimeReferenceJournalV1,
  verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1, type TtrpgOpenOracleRuntimeReferencePolicyV1,
  parseTtrpgOpenNormalizationRuntimeReferencePolicyV1, createTtrpgOpenNormalizationRuntimeReferencePolicyV1,
  resolveTtrpgOpenNormalizationRuntimeSourceV1, type TtrpgOpenNormalizationRuntimeReferencePolicyV1 } from './open-runtime-entity-references';
import { createTtrpgOpenFactRuntimeReferencesV1 } from './open-fact-runtime-references';
import { parseTtrpgOpenSituationRuntimeReferencePolicyV1, assertTtrpgOpenRuntimeEntityReferencesMatchV1,
  assertTtrpgOpenSituationRuntimeReferenceJournalV1, type TtrpgOpenSituationRuntimeReferencePolicyV1 } from './open-runtime-entity-references';
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination';
import { settleTtrpgOpenKnowledgeV1 } from './open-knowledge-settlement';
import { hashTtrpgOpenEvidenceFieldsV1 } from './open-knowledge';
import { parseTtrpgOpenKnowledgeShareRequestV1, assertTtrpgOpenKnowledgeShareActorV1, createTtrpgOpenSharedKnowledgeV1,
  parseTtrpgOpenKnowledgeShareReceiptV1, hashTtrpgOpenKnowledgeShareConfirmationV1, type TtrpgOpenKnowledgeShareRequestV1 } from './open-knowledge-share';
import { ttrpgOpenKnowledgeDiscoveryOriginV1 } from './open-knowledge-share';
import { routeTtrpgOpenIntentV1 } from './open-intent';
import { ttrpgOpenPredicateContextV1 } from './open-rule-plan';
import type { ProductRuntimeEventType, ProductRuntimeSession, ProductRuntimeEvent, ProductRuntimeState, TtrpgCharacterSheetV2, TtrpgRuntimeCampaignSessionV2, TtrpgRuntimeCampaignMemoryV2, TtrpgRuntimeRosterEntryV2, TtrpgRuntimeSupplementReceiptV2, TtrpgRuntimeWorldEvolutionV2, TtrpgRuntimeVersionTransitionV2, TtrpgCampaignContentV1, TtrpgRuntimeIntentReceiptV2, TtrpgRuntimeHumanResponseV2, TtrpgRuntimeRestReceiptV2, TtrpgRuntimeModelEvidenceV1 } from "../types";
export interface FormalTtrpgCommandEnvelope {
  sessionId: number;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}

type FormalTtrpgEventType = Extract<
  ProductRuntimeEventType,
  | "ttrpg.character.customized"
  | "ttrpg.character.advanced"
  | "ttrpg.session-zero.completed"
  | "ttrpg.memory.recorded"
  | "ttrpg.scene.opened"
  | "ttrpg.clue.discovered"
  | "ttrpg.intent.receipted"
  | "ttrpg.human-response.recorded"
  | "ttrpg.check.resolved"
  | "ttrpg.rule.action.resolved"
  | "ttrpg.rest.completed"
  | "ttrpg.gm.response.recorded"
  | "ttrpg.director.committed"
  | "ttrpg.private-guidance.recorded"
  | "ttrpg.item.changed"
  | "ttrpg.effects.choice.proposed"
  | "ttrpg.effects.applied"
  | "ttrpg.campaign.ended"
  | "ttrpg.safety.changed"
  | "ttrpg.tabletop.updated"
  | "ttrpg.campaign.session.started"
  | "ttrpg.campaign.session.completed"
  | "ttrpg.campaign.roster.changed"
  | "ttrpg.campaign.supplement.activated"
  | "ttrpg.campaign.world-evolution.recorded"
  | "ttrpg.campaign.version-transition.recorded"
  | "ttrpg.open.run.started"
  | "ttrpg.open.epoch.started"
  | "ttrpg.open.epoch.closed"
  | "ttrpg.open.hosting.delegated"
  | "ttrpg.open.hosting.stopped"
  | "ttrpg.open.call.reserved"
  | "ttrpg.open.call.dispatched"
  | "ttrpg.open.call.finished"
  | "ttrpg.open.source.inherited"
  | "ttrpg.open.operation.started"
  | "ttrpg.open.operation.step.completed"
  | "ttrpg.open.operation.completed"
  | "ttrpg.open.intent.confirmed"
  | "ttrpg.open.choice.disclosed"
  | "ttrpg.open.table-message.posted"
  | "ttrpg.audio.voice.reserved"
  | "ttrpg.audio.voice.cancelled"
  | "ttrpg.audio.cue.applied"
  | "ttrpg.open.intent.disposed"
  | "ttrpg.open.intent.clarified"
  | "ttrpg.world-turn.advanced"
  | "ttrpg.situation.changed"
  | "ttrpg.open.failure.logged"
  | "ttrpg.oracle.consulted"
  | "ttrpg.open.oracle.reviewed"
  | "ttrpg.fact.asserted"
  | "ttrpg.fact.retired"
  | "ttrpg.open.knowledge.discovered"
  | "ttrpg.open.knowledge.shared"
  | "ttrpg.open.knowledge.identity-confirmed"
  | "ttrpg.open.knowledge.identity-shared"
  | "ttrpg.open.pressure.planned"
  | "ttrpg.open.pressure.settled"
  | "ttrpg.open.pressure.effect.confirmed"
  | "ttrpg.open.pressure.effect.applied"
  | "ttrpg.open.pressure.situation.completed"
  | "ttrpg.open.situations.planned"
  | "ttrpg.open.situations.changed"
  | "ttrpg.open.situations.settled"
  | "ttrpg.open.terminal.evaluated"
  | "ttrpg.open.gates.evaluated"
  | "ttrpg.open.gates.settled"
  | "ttrpg.open.gates.recovered"
  | "ttrpg.open.gates.recovery-stopped"
  | "ttrpg.open.handoff.offered"
  | "ttrpg.open.narration.recorded"
  | "ttrpg.open.narration.accepted"
  | "ttrpg.open.situation.accepted"
  | "ttrpg.open.entity.proposed"
  | "ttrpg.open.entity.model-proposed"
  | "ttrpg.open.entity.confirmed"
  | "ttrpg.open.entity.materialized"
  | "ttrpg.open.entity.disposed"
  | "ttrpg.open.situation.activated"
  | "ttrpg.open.intent.rejected"
  | "ttrpg.open.companion.preauthorized"
  | "ttrpg.open.stage.closed"
  | "ttrpg.open.stage.clock.advanced"
  | "ttrpg.open.stage.settled"
  | "ttrpg.open.stage.effect.confirmed"
  | "ttrpg.open.stage.effect.applied"
  | "ttrpg.open.situations.effect.confirmed"
  | "ttrpg.open.situations.effect.applied"
  | "ttrpg.clock.ticked"
  | "ttrpg.front.telegraphed"
  | "ttrpg.front.advanced"
  | "ttrpg.front.defeated"
>;

function assertScriptedTtrpgCampaign(
  campaign: TtrpgCampaignContentV1 | import("./open-contract").TtrpgCampaignContentV2,
): asserts campaign is TtrpgCampaignContentV1 {
  if (campaign.version !== 1) {
    throw new Error("[ttrpg] 此旧版命令仅适用于 scripted；open 行动入口尚未交付。");
  }
}

const OPEN_FOUNDATION_COMMANDS: readonly FormalTtrpgEventType[] = [
  "ttrpg.audio.voice.reserved",
  "ttrpg.audio.voice.cancelled",
  "ttrpg.audio.cue.applied",
  "ttrpg.memory.recorded",
  "ttrpg.open.run.started", "ttrpg.world-turn.advanced",
  "ttrpg.open.epoch.started", "ttrpg.open.epoch.closed", "ttrpg.open.hosting.delegated", "ttrpg.open.hosting.stopped",
  "ttrpg.open.call.reserved", "ttrpg.open.call.dispatched", "ttrpg.open.call.finished",
  "ttrpg.open.source.inherited",
  "ttrpg.open.operation.started", "ttrpg.open.operation.step.completed", "ttrpg.open.operation.completed",
  "ttrpg.open.intent.confirmed", "ttrpg.open.intent.clarified", "ttrpg.open.choice.disclosed", "ttrpg.open.table-message.posted", "ttrpg.open.intent.disposed", "ttrpg.rule.action.resolved", "ttrpg.effects.applied",
  "ttrpg.situation.changed", "ttrpg.open.failure.logged",
  "ttrpg.oracle.consulted",
  "ttrpg.fact.asserted", "ttrpg.fact.retired", "ttrpg.open.oracle.reviewed",
  "ttrpg.open.knowledge.discovered", "ttrpg.open.knowledge.shared",
  "ttrpg.open.knowledge.identity-confirmed", "ttrpg.open.knowledge.identity-shared",
  "ttrpg.open.pressure.planned", "ttrpg.open.pressure.settled", "ttrpg.open.pressure.effect.confirmed", "ttrpg.open.pressure.effect.applied", "ttrpg.open.pressure.situation.completed", "ttrpg.clock.ticked",
  "ttrpg.front.telegraphed", "ttrpg.front.advanced", "ttrpg.front.defeated",
  "ttrpg.open.situations.planned", "ttrpg.open.situations.changed", "ttrpg.open.situations.settled",
  "ttrpg.open.situations.effect.confirmed", "ttrpg.open.situations.effect.applied",
  "ttrpg.open.terminal.evaluated", "ttrpg.open.gates.evaluated", "ttrpg.open.gates.settled", "ttrpg.open.gates.recovered", "ttrpg.open.gates.recovery-stopped", "ttrpg.open.narration.accepted", "ttrpg.open.entity.proposed", "ttrpg.open.entity.model-proposed", "ttrpg.open.entity.confirmed", "ttrpg.open.entity.materialized", "ttrpg.open.entity.disposed", "ttrpg.open.situation.accepted", "ttrpg.open.situation.activated", "ttrpg.open.narration.recorded", "ttrpg.open.companion.preauthorized", "ttrpg.open.intent.rejected", "ttrpg.open.handoff.offered",
  "ttrpg.open.stage.closed", "ttrpg.open.stage.clock.advanced", "ttrpg.open.stage.settled", "ttrpg.open.stage.effect.confirmed", "ttrpg.open.stage.effect.applied",
];
const SHARED_SETUP_COMMANDS: readonly FormalTtrpgEventType[] = [
  "ttrpg.character.customized", "ttrpg.session-zero.completed", "ttrpg.safety.changed",
];

async function verifyFormalTtrpgSource(session: ProductRuntimeSession) {
  const sourceCount = [
    session.productReleaseId,
    session.productBuildId,
  ].filter((value) => value != null).length;
  if (
    session.kind !== "ttrpg" ||
    !session.runtimeSourceHash ||
    sourceCount !== 1
  ) {
    throw new Error("[ttrpg] 正式 TTRPG 实例没有唯一冻结运行源。");
  }
  if (session.productBuildId != null) {
    if (session.worldId == null || session.workId == null) {
      throw new Error("[ttrpg] Build Preview 实例缺少完整工作区作用域。");
    }
    const buildBefore = await db.productBuilds.get(session.productBuildId);
    if (!buildBefore || !buildBefore.previewHash) {
      throw new Error("[ttrpg] Build Preview 运行源不存在。");
    }
    const playable = await verifyProductRuntimeSource({
      scope: {
        projectId: session.projectId,
        worldId: session.worldId,
        workId: session.workId,
      },
      source: {
        kind: "build",
        productBuildId: session.productBuildId,
        expectedPreviewHash: buildBefore.previewHash,
      },
      ttrpgProtocol: 2,
    });
    const build = await db.productBuilds.get(session.productBuildId);
    if (!build || stableJson(build) !== stableJson(buildBefore)) {
      throw new Error("[ttrpg] ProductBuild 在运行源校验期间发生变化。");
    }
    if (
      playable.runtimePackage.productType !== "ttrpg" ||
      !playable.runtimePackage.ttrpg ||
      playable.packageHash !== session.runtimeSourceHash
    ) {
      throw new Error("[ttrpg] 实例与冻结 TTRPG Build Preview 不一致。");
    }
    const runtimeView = await createTtrpgVerifiedContentViewV1(
      playable.runtimePackage.ttrpg,
    );
    const rulePack = runtimeView.mechanicalRulePack;
    const campaign = runtimeView.rawContent.campaign;
    return {
      source: { kind: "build" as const, build },
      runtimePackage: playable.runtimePackage,
      packageHash: playable.packageHash,
      rulePack,
      campaign,
      ttrpgContent: runtimeView.rawContent,
    };
  }
  const release = await assertProductReleaseUnchanged(session.productReleaseId!, { ttrpgProtocol: 2 });
  const manifest = await verifyProductReleaseManifestV1(
    release.manifestJson,
    { ttrpgProtocol: 2 },
  );
  if (
    manifest.productType !== "ttrpg" ||
    !manifest.runtimePackage.ttrpg ||
    manifest.packageHash !== session.runtimeSourceHash
  ) {
    throw new Error("[ttrpg] 实例与冻结 TTRPG ProductRelease 不一致。");
  }
  const runtimeView = await createTtrpgVerifiedContentViewV1(
    manifest.runtimePackage.ttrpg,
  );
  const rulePack = runtimeView.mechanicalRulePack;
  const campaign = runtimeView.rawContent.campaign;
  return {
    source: { kind: "release" as const, release },
    runtimePackage: manifest.runtimePackage,
    packageHash: manifest.packageHash,
    rulePack,
    campaign,
    ttrpgContent: runtimeView.rawContent,
  };
}

function assertFormalTtrpgPrior(input: {
  prior: ProductRuntimeEvent;
  type: FormalTtrpgEventType;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
  intent: Record<string, unknown>;
}): void {
  const body = parseEventPayload(input.prior);
  if (
    input.prior.type !== input.type ||
    input.prior.commandId !== input.commandId ||
    input.prior.baseSequence !== input.baseSequence ||
    input.prior.baseStateHash !== input.baseStateHash ||
    stableJson(body.intent) !== stableJson(input.intent)
  ) {
    throw new Error("[ttrpg] commandId 已被不同命令使用。");
  }
}

async function appendFormalTtrpgCommand(
  input: FormalTtrpgCommandEnvelope & {
    type: FormalTtrpgEventType;
    intent: Record<string, unknown>;
    build: (context: {
      session: ProductRuntimeSession;
      state: ProductRuntimeState;
      sequence: number;
      rulePack: ReturnType<typeof parseRulePackV1>;
      campaign: TtrpgCampaignContentV1 | import("./open-contract").TtrpgCampaignContentV2;
      ttrpgContent: TtrpgRuntimeContentV2 | import("../types").TtrpgRuntimeContentV1;
      participants: import("../types").TtrpgSessionParticipantRecordV2[];
    }) => Promise<{
      actorKey: string | null;
      targetKey: string | null;
      payload: Record<string, unknown>;
      agentEvidence?: TtrpgOpenAgentEvidenceV1;
      commonOracleArchiveWitness?: TtrpgOpenCommonOracleArchiveWitnessV1;
      audioMediaWitness?: TtrpgOpenAudioMediaWitnessV1;
      voiceRunSetWitness?: TtrpgOpenVoiceRunSetWitnessV1;
      generatedAudioWitness?: TtrpgOpenGeneratedAudioWitnessV1;
      eventEvidence?: readonly ProductRuntimeEvent[];
    }>;
    afterCommit?: (context: {
      session: ProductRuntimeSession;
      state: ProductRuntimeState;
      event: ProductRuntimeEvent;
      rulePack: ReturnType<typeof parseRulePackV1>;
      campaign: TtrpgCampaignContentV1 | import("./open-contract").TtrpgCampaignContentV2;
      ttrpgContent: TtrpgRuntimeContentV2 | import("../types").TtrpgRuntimeContentV1;
    }) => Promise<void>;
  },
): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const baseStateHash = input.baseStateHash.trim();
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[ttrpg] 命令基线无效。");
  }
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (!previewSession) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const frozen = await verifyFormalTtrpgSource(previewSession);
  const open = frozen.ttrpgContent.campaign.version === 2;
  if (open && !OPEN_FOUNDATION_COMMANDS.includes(input.type) && !SHARED_SETUP_COMMANDS.includes(input.type)) {
    throw new Error("[ttrpg] open 尚未接入此 scripted 命令；不能回退到旧场景运行器。");
  }
  if (!open && OPEN_FOUNDATION_COMMANDS.includes(input.type) && !["ttrpg.rule.action.resolved", "ttrpg.effects.applied"].includes(input.type)) {
    throw new Error("[ttrpg] open 命令不能写入 scripted 团局。");
  }
  const previewPrior = await db.productRuntimeEvents
    .where("[sessionId+commandId]")
    .equals([input.sessionId, commandId])
    .first();
  if (previewPrior) {
    assertFormalTtrpgPrior({
      prior: previewPrior,
      type: input.type,
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
      intent: input.intent,
    });
    return previewPrior;
  }
  const previewHead = await readVerifiedProductRuntimeHeadV1(previewSession);
  const previewState = previewHead.state;
  if (open) await verifyTtrpgOpenEntityStateV1(previewState, requireTtrpgOpenContent(frozen.ttrpgContent));
  assertTtrpgOpenSituationWindowEventV1(previewState.ttrpg?.sessionKey ? parseTtrpgRuntimeStateV2(previewState.ttrpg) : null, input.type);
  const previewParticipants = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.sessionId)
    .sortBy("seatKey");
  const previewHash = previewHead.stateHash;
  if (
    previewState.lastSequence !== input.baseSequence ||
    previewHash !== baseStateHash
  ) {
    throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
  }
  if (
    !previewState.ttrpg?.product ||
    previewState.ttrpg.product.rulePackContentHash !==
      frozen.runtimePackage.ttrpg!.rulePack.contentHash ||
    previewState.ttrpg.product.campaignKey !== frozen.campaign.campaignKey
  ) {
    throw new Error("[ttrpg] 战役状态没有绑定冻结 RulePack/CampaignPack。");
  }
  if (
    previewState.ttrpg.product.safety.status === "paused" &&
    !["ttrpg.audio.voice.cancelled", "ttrpg.audio.cue.applied", "ttrpg.open.entity.disposed", "ttrpg.open.hosting.stopped", "ttrpg.open.table-message.posted", "ttrpg.safety.changed", "ttrpg.session-zero.completed", "ttrpg.open.failure.logged", "ttrpg.open.epoch.closed", "ttrpg.open.intent.disposed", "ttrpg.open.call.finished"].includes(input.type)
  ) {
    throw new Error(
      "[ttrpg] 战役已由安全工具暂停；恢复后才能继续规则、场景或 AI 主持。",
    );
  }
  // Preflight command-specific validation before opening the write transaction.
  const previewBuilt = await input.build({
    session: previewSession,
    state: previewState,
    sequence: previewState.lastSequence + 1,
    rulePack: frozen.rulePack,
    campaign: frozen.campaign,
    ttrpgContent: frozen.ttrpgContent,
    participants: previewParticipants,
  });
  const preparedEvent: ProductRuntimeEvent = {
    projectId: previewSession.projectId,
    worldGroupId: previewSession.worldGroupId ?? null,
    sessionId: previewSession.id!,
    sequence: previewState.lastSequence + 1,
    type: input.type,
    actorKey: previewBuilt.actorKey,
    targetKey: previewBuilt.targetKey,
    commandId,
    baseSequence: input.baseSequence,
    baseStateHash,
    payloadJson: JSON.stringify({
      ...previewBuilt.payload,
      intent: input.intent,
    }),
    createdAt: Date.now(),
  };
  const preparedState = applyProductRuntimeEvent(
    cloneState(previewState),
    preparedEvent,
  );
  const preparedStateJson = JSON.stringify(preparedState);
  const preparedStateHash = await hashStateJson(preparedStateJson);
  return db.transaction(
    "rw",
    [
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.ttrpgSessionParticipants,
      db.productReleases,
      db.productBuilds,
      ...(previewBuilt.agentEvidence ? [db.agentRuns, db.agentRunEvents, db.agentRunArtifacts] : previewBuilt.commonOracleArchiveWitness ? [db.agentRuns] : []),
      ...(input.type === 'ttrpg.memory.recorded' ? runtimeInstanceTablesV1() : []),
      ...(previewBuilt.audioMediaWitness ? [db.productMediaAssets, db.productMediaBlobs, db.mediaBlobObjects] : []),
      ...(previewBuilt.generatedAudioWitness ? [db.agentRuns,db.agentRunEvents,db.agentRunArtifacts,db.agentRunCheckpoints] : []),
    ],
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (!session) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
      const currentSource = frozen.source.kind === "release"
        ? session.productReleaseId == null
          ? null
          : await db.productReleases.get(session.productReleaseId)
        : session.productBuildId == null
          ? null
          : await db.productBuilds.get(session.productBuildId);
      const sourceUnchanged =
        frozen.source.kind === "release"
          ? currentSource != null &&
            currentSource.id === frozen.source.release.id &&
            "contentHash" in currentSource &&
            currentSource.manifestJson === frozen.source.release.manifestJson &&
            currentSource.contentHash === frozen.source.release.contentHash &&
            session.productBuildId == null
          : currentSource != null &&
            currentSource.id === frozen.source.build.id &&
            "previewHash" in currentSource &&
            currentSource.productionId === frozen.source.build.productionId &&
            currentSource.buildNumber === frozen.source.build.buildNumber &&
            currentSource.briefRevision === frozen.source.build.briefRevision &&
            currentSource.briefHash === frozen.source.build.briefHash &&
            currentSource.previewManifestJson ===
              frozen.source.build.previewManifestJson &&
            currentSource.previewHash === frozen.source.build.previewHash &&
            currentSource.packageHash === frozen.source.build.packageHash &&
            currentSource.manifestHash === frozen.source.build.manifestHash &&
            ["preview-ready", "release-ready", "released"].includes(
              currentSource.status,
            ) &&
            session.productReleaseId == null;
      if (
        !sourceUnchanged ||
        session.productReleaseId !== previewSession.productReleaseId ||
        session.productBuildId !== previewSession.productBuildId ||
        session.runtimeSourceHash !== frozen.packageHash ||
        session.seed !== previewSession.seed
      ) {
        throw new Error("[ttrpg] 冻结运行源在命令提交期间发生变化。");
      }
      const currentParticipants = await db.ttrpgSessionParticipants
        .where("sessionId")
        .equals(input.sessionId)
        .sortBy("seatKey");
      const prior = await db.productRuntimeEvents
        .where("[sessionId+commandId]")
        .equals([input.sessionId, commandId])
        .first();
      if (prior) {
        assertFormalTtrpgPrior({
          prior,
          type: input.type,
          commandId,
          baseSequence: input.baseSequence,
          baseStateHash,
          intent: input.intent,
        });
        return prior;
      }
      if (session.status !== "active")
        throw new Error("[ttrpg] 只有 active 战役可以提交命令。");
      const latestSequence = await readLatestSessionEventSequenceV1(
        input.sessionId,
      );
      let state: ProductRuntimeState;
      if (
        latestSequence === previewHead.sequence &&
        session.runtimeHeadSequence === previewHead.sequence &&
        session.runtimeHeadStateJson === previewHead.stateJson &&
        session.runtimeHeadStateHash === previewHead.stateHash
      ) {
        state = cloneState(previewState);
      } else {
        const events = await readSessionEvents(session);
        state = replayProductRuntimeEvents(
          parseProductRuntimeState(session.initialStateJson),
          events,
        );
      }
      const currentStateJson = JSON.stringify(state);
      if (
        state.lastSequence !== input.baseSequence ||
        currentStateJson !== previewHead.stateJson ||
        previewHead.stateHash !== baseStateHash ||
        state.lastSequence !== previewState.lastSequence ||
        stableJson(currentParticipants) !== stableJson(previewParticipants)
      ) {
        throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
      }
      // The state hash, release bytes, seed and next sequence were all compared
      // above, so the preflight result is the exact deterministic command plan.
      // Reusing it also keeps WebCrypto outside Dexie's active transaction.
      if (previewBuilt.agentEvidence) await assertTtrpgOpenAgentEvidenceUnchangedV1(previewBuilt.agentEvidence);
      if (previewBuilt.commonOracleArchiveWitness) await assertTtrpgOpenCommonOracleArchiveWitnessV1(previewBuilt.commonOracleArchiveWitness);
      if (previewBuilt.audioMediaWitness) await assertTtrpgOpenAudioMediaWitnessV1(previewBuilt.audioMediaWitness);
      if (previewBuilt.generatedAudioWitness) {
        for (const evidence of previewBuilt.generatedAudioWitness.runs) await assertTtrpgOpenAgentEvidenceUnchangedV1(evidence);
        await assertTtrpgOpenGeneratedAudioCheckpointsV1(previewBuilt.generatedAudioWitness);
      }
      if (previewBuilt.voiceRunSetWitness) {
        const rows = await db.agentRuns.where("productRuntimeSessionId").equals(previewBuilt.voiceRunSetWitness.sessionId).sortBy("id");
        if (stableJson(rows) !== stableJson(previewBuilt.voiceRunSetWitness.rows)) throw new Error("[ttrpg] 原配音 Run 或子任务已变化");
      }
      if (previewBuilt.eventEvidence) {
        const expected = previewBuilt.eventEvidence
        if (expected.some(event => event.id == null || event.sessionId !== session.id)) throw new Error('[ttrpg] 来源事件没有确切实例定位')
        const actual = await db.productRuntimeEvents.bulkGet(expected.map(event => event.id!))
        if (stableJson(actual) !== stableJson(expected)) throw new Error('[ttrpg] 记忆来源事件在提交期间发生变化')
      }
      const event: ProductRuntimeEvent = { ...preparedEvent };
      state = applyProductRuntimeEvent(state, event);
      if (stableJson(state) !== stableJson(preparedState)) {
        throw new Error("[ttrpg] 事务内规则结果与预提交计划不一致。");
      }
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      await input.afterCommit?.({
        session,
        state,
        event,
        rulePack: frozen.rulePack,
        campaign: frozen.campaign,
        ttrpgContent: frozen.ttrpgContent,
      });
      await db.productRuntimeSessions.update(session.id!, {
        updatedAt: event.createdAt,
        runtimeHeadSequence: event.sequence,
        runtimeHeadStateJson: preparedStateJson,
        runtimeHeadStateHash: preparedStateHash,
      });
      return event;
    },
  );
}

function requireTtrpgOpenContent(
  content: TtrpgRuntimeContentV2 | import("../types").TtrpgRuntimeContentV1,
): TtrpgRuntimeContentV2 {
  if (content.campaign.version !== 2) {
    throw new Error("[ttrpg] 此命令仅适用于 open 跑团。");
  }
  return content as TtrpgRuntimeContentV2;
}

function readOpenRunFromState(state: ProductRuntimeState): TtrpgOpenRunStateV1 {
  const ttrpg = state.ttrpg;
  if (
    !ttrpg ||
    !Object.prototype.hasOwnProperty.call(ttrpg, "openRun") ||
    ttrpg.openRun === null
  ) {
    throw new Error("[ttrpg] open run 尚未启动。");
  }
  return parseTtrpgOpenRunStateV1(ttrpg.openRun);
}

export async function startTtrpgOpenRunV1(
  input: FormalTtrpgCommandEnvelope & { viewerKey?: string },
): Promise<ProductRuntimeEvent> {
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.open.run.started",
    intent: { kind: "open-run-start", viewerKey: input.viewerKey ?? null },
    build: async ({ state, ttrpgContent, participants }) => {
      const content = requireTtrpgOpenContent(ttrpgContent);
      const runtime = parseTtrpgRuntimeStateV2(state.ttrpg);
      if (!runtime?.authorization || !runtime.product.sessionZero.completed) {
        throw new Error("[ttrpg] 请先完成有效 open Session Zero 和真人批准关系。");
      }
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,
        participants, viewerKey: input.viewerKey ?? "" });
      if (
        !state.ttrpg ||
        !Object.prototype.hasOwnProperty.call(state.ttrpg, "openRun") ||
        state.ttrpg.openRun !== null
      ) {
        throw new Error("[ttrpg] open run 只能启动一次。");
      }
      const openRun = createTtrpgOpenRunStateV1(content.campaign);
      openRun.companions = openRun.companions.filter(companion => runtime.authorization!.selectedActorKeys.includes(companion.actorKey));
      return {
        actorKey: seat.actorKey,
        targetKey: null,
        payload: {
          openRun,
          authorizationRevision: runtime.authorization.revision,
          startedBySeatKey: seat.seatKey,
          viewerKey: seat.viewerKey,
        },
      };
    },
  });
}

/** A human submits the exact question. Oracle consultation has frozen zero time cost. */
export async function consultTtrpgOracleV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; askedBy: TtrpgOracleOutcomeV1['askedBy']; oracleKey: string; question: string; likelihoodTierKey?: string | null;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'Oracle viewer');
  const oracleKey = openKey(input.oracleKey, 'Oracle key');
  const question = openText(input.question, 'Oracle question', 2000);
  const likelihoodTierKey = input.likelihoodTierKey == null ? null : openKey(input.likelihoodTierKey, 'Oracle likelihood');
  const commandId = normalizeCommandId(input.commandId);
  return appendFormalTtrpgCommand({ ...input, commandId, type: 'ttrpg.oracle.consulted',
    intent: { viewerKey, oracleKey, question, askedBy: input.askedBy, likelihoodTierKey },
    build: async ({ state, session, sequence, ttrpgContent, participants }) => {
      const content = requireTtrpgOpenContent(ttrpgContent);
      const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), run = runtime?.openRun, authorization = runtime?.authorization;
      if (!runtime || !run || !authorization) throw new Error('[ttrpg-oracle] 请先完成 Session Zero 并启动团局。');
      assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants, viewerKey });
      await verifyTtrpgOpenOracleJournalV1({ receipts: run.oracleReceipts ?? [], rulePack: content.rulePack.content,
        sessionKey: runtime.sessionKey, seed: session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] });
      const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === run.coordination.activeEpochKey);
      if (!epoch || epoch.status !== 'active' || epoch.viewerKey !== viewerKey || isTtrpgOpenPassiveEpochV1(epoch)
        || epoch.authorizationHash !== await hashProductProductionValueV2(authorization)
        || run.stage.status !== 'open' || runtime.product.safety.status !== 'active') throw new Error('[ttrpg-oracle] Oracle 需要本人当前活动窗口且团局未暂停。');
      if (run.consultedThisWorldTurn >= 2) throw new Error('[ttrpg-oracle] 每个 worldTurn 最多咨询两次，不能以新 commandId 重置额度。');
      if (run.operations.some(operation => ['awaiting-approval', 'executing'].includes(operation.status))
        || runtime.branchLineage?.recoveryTasks.some(task => !['completed', 'withdrawn'].includes(task.status))) {
        throw new Error('[ttrpg-oracle] 请先完成当前行动或继承结算。');
      }
      const table = content.rulePack.content.oracles.find(table => table.oracleKey === oracleKey);
      if (!table) throw new Error('[ttrpg-oracle] Oracle 不在冻结规则包中。');
      if (likelihoodTierKey !== null && !table.likelihood?.tiers.some(tier => tier.tierKey === likelihoodTierKey)) {
        throw new Error('[ttrpg-oracle] 可能性档位不在冻结表中。');
      }
      const actorKey = assertTtrpgOpenOracleCallerV1({ authorization, viewerKey, askedBy: input.askedBy, audience: table.audience });
      const resolution = await resolveTtrpgOracleV1({ rulePack: content.rulePack.content, oracleKey, question, askedBy: input.askedBy,
        seed: session.seed, commandId, eventSequence: sequence, likelihoodTierKey,
        chaosValue: table.chaosCoupled ? run.chaos.value : null });
      if (!await verifyTtrpgOracleOutcomeV1({ rulePack: content.rulePack.content, seed: session.seed, ...resolution })) {
        throw new Error('[ttrpg-oracle] 随机结果复算失败，未提交。');
      }
      const previous = [...(run.oracleReceipts ?? [])].reverse().find(receipt => receipt.resolution.outcome.oracleKey === oracleKey);
      const receipt = parseTtrpgOpenOracleReceiptV1({ sourceRef: { sessionKey: runtime.sessionKey, sequence },
        previousOracleRef: previous?.sourceRef ?? null, authorizationEpochKey: epoch.epochKey, viewerKey,
        worldTurn: run.worldTime.worldTurn, audience: table.audience, frozenRulePack: content.rulePack.content, resolution });
      return { actorKey, targetKey: null, payload: { receipt } };
    },
  });
}

/** New authority is explicit; the scripted Session Zero API retains its original payload. */
export async function completeTtrpgOpenSessionZeroV1(input: FormalTtrpgCommandEnvelope & {
  acceptedItemKeys: string[]; selectedCharacterKeys: string[]; viewerKey: string;
}): Promise<ProductRuntimeEvent> {
  const acceptedItemKeys = input.acceptedItemKeys.map(item => openKey(item, "acceptedItemKey")).sort();
  const selectedCharacterKeys = input.selectedCharacterKeys.map(item => openKey(item, "selectedCharacterKey"));
  const viewerKey = openKey(input.viewerKey, "viewerKey");
  return appendFormalTtrpgCommand({ ...input, type: "ttrpg.session-zero.completed",
    intent: { acceptedItemKeys, selectedCharacterKeys, viewerKey },
    build: async ({ state, sequence, ttrpgContent, participants }) => {
      const content = requireTtrpgOpenContent(ttrpgContent);
      const runtime = parseTtrpgRuntimeStateV2(state.ttrpg);
      if (!runtime || runtime.product.sessionZero.completed || runtime.authorization !== null) {
        throw new Error("[ttrpg] open Session Zero 已完成或运行态缺失。");
      }
      if (stableJson(acceptedItemKeys) !== stableJson([...runtime.product.sessionZero.requiredItemKeys].sort())) {
        throw new Error("[ttrpg] 必须确认全部 Session Zero 安全与共识事项。");
      }
      const authorization = createTtrpgOpenAuthorizationV1({ campaign: content.campaign, participants,
        selectedActorKeys: selectedCharacterKeys, viewerKey, sequence, sessionKey: runtime.sessionKey });
      return { actorKey: authorization.completedBySeatKey, targetKey: content.campaign.campaignKey,
        payload: { acceptedItemKeys, selectedCharacterKeys,
          completedBy: authorization.completedBySeatKey, authorization } };
    },
    afterCommit: async ({ event }) => finalizeTtrpgSessionParticipantsV2({ sessionId: input.sessionId,
      selectedCharacterKeys, eventSequence: event.sequence, completedBy: viewerKey }),
  });
}

async function prepareTtrpgOpenFactAuthorityV1(context: TtrpgFormalBuildContextV1, viewerKey: string, modelCandidate = false) {
  const content = requireTtrpgOpenContent(context.ttrpgContent);
  const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg), run = runtime?.openRun, authorization = runtime?.authorization;
  if (!runtime || !run || !authorization) throw new Error('[ttrpg-fact] 请先完成 Session Zero 和开局授权。');
  const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants: context.participants, viewerKey });
  const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === run.coordination.activeEpochKey);
  if (modelCandidate) assertTtrpgOpenModelFactApproverV1(authorization, viewerKey);
  if (!modelCandidate && (epoch?.commonOracle || epoch?.oracleRuntimeReferencePolicy || epoch?.normalizationRuntimeReferencePolicy)) throw new Error('实例事实模型窗口只允许审阅原模型候选，不能作为人类原创确认。');
  if ((!modelCandidate && seat.role !== 'gm') || seat.controller === 'ai' || !epoch || epoch.status !== 'active' || epoch.viewerKey !== viewerKey
    || epoch.authorizationHash !== await hashProductProductionValueV2(authorization)
    || runtime.product.safety.status !== 'active' || run.stage.status !== 'open') throw new Error('[ttrpg-fact] 手动事实确认需要本人当前真人 GM 窗口。');
  if (run.operations.some(operation => ['awaiting-approval', 'executing'].includes(operation.status))
    || runtime.branchLineage?.recoveryTasks.some(task => !['completed', 'withdrawn'].includes(task.status))) throw new Error('[ttrpg-fact] 请先完成行动或祖先结算，不能插入事实改写。');
  await verifyTtrpgOpenOracleJournalV1({ receipts: run.oracleReceipts ?? [], rulePack: content.rulePack.content,
    sessionKey: runtime.sessionKey, seed: context.session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] });
  await verifyTtrpgOpenFactLedgerV1({ ledger: run.factLedger, content, runtimeSourceHash: context.session.runtimeSourceHash,
    oracleReceipts: run.oracleReceipts ?? [], entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts });
  await verifyTtrpgOpenOracleReviewHashesV1(run.oracleReviews ?? []);
  const basis = await createTtrpgOpenFactBasisV1(content, context.session.runtimeSourceHash);
  return { content, runtime, run, authorization, seat, epoch, basis };
}

async function buildTtrpgOpenFactAssertionV1(context: TtrpgFormalBuildContextV1, input: {
  viewerKey: string; proposal: TtrpgOpenOracleFactProposalV1; oracleSourceRef: TtrpgOpenSourceRefV1;
  candidateHash: string; baseStateHash: string; modelCandidate?: TtrpgOpenFactModelCandidateV1; referencePolicy?: 'committed-runtime-entities-v1';
}, prepared?: Awaited<ReturnType<typeof prepareTtrpgOpenFactAuthorityV1>>) {
  const { viewerKey, proposal, oracleSourceRef, candidateHash, baseStateHash, modelCandidate } = input;
  const { runtime, run, authorization, seat, epoch, basis, content } = prepared ?? await prepareTtrpgOpenFactAuthorityV1(context, viewerKey, modelCandidate !== undefined);
  if (input.referencePolicy && modelCandidate) {
    const call = run.coordination.calls.find(row => row.requestKey === modelCandidate.requestKey);
    if (!call || !ttrpgOpenSemanticRuntimeReferencePolicyV1(call)) throw new Error('旧模型事实候选不取得运行实体引用权。');
    assertTtrpgOpenOracleRuntimeCallOriginV1(runtime, call);
    assertTtrpgOpenNormalizationSourceV1(runtime, call);
  }
  if (input.referencePolicy) await (await import('./open-entity-proof')).verifyTtrpgOpenEntityStateV1(context.state, content);
  const oracle = run.oracleReceipts?.find(receipt => stableJson(receipt.sourceRef) === stableJson(oracleSourceRef));
  if (!oracle) throw new Error('[ttrpg-fact] 事实必须引用本团局或已冻结祖先的真实 Oracle 结果。');
  if (candidateHash !== await hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef,
    runtimeSourceHash: context.session.runtimeSourceHash, viewerKey, baseStateHash })) {
    throw new Error('[ttrpg-fact] 事实候选字节、来源或确认基线不一致。');
  }
  const sourceRef = { sessionKey: runtime.sessionKey, sequence: context.sequence };
  const originRef = await ttrpgOpenFactSourceEventRefV1(oracleSourceRef);
  const { knownByActorKeys, ...body } = proposal;
  const runtimeEntityReferences = input.referencePolicy ? await createTtrpgOpenFactRuntimeReferencesV1({ ...basis,
    operations: run.entityOperations ?? [], entityRefs: [proposal.subjectRef, proposal.objectRef].filter((key): key is string => key !== null),
    frozenEntityRefs: basis.entityReferences.map(row => row.entityRef) }) : null;
  const entry = parseTtrpgOpenFactEntryV1({ sourceRef, oracleSourceRef, authorizationEpochKey: epoch.epochKey, viewerKey,
    candidateHash, ...(modelCandidate ? { modelCandidate } : {}), ...(runtimeEntityReferences ? { runtimeEntityReferences } : {}), confirmationStateHash: baseStateHash, fact: { ...body, knownBy: knownByActorKeys,
      factKey: await ttrpgOpenFactIdentityV1({ sourceRef, fact: proposal, modelCandidate }),
      layer: 'session', origin: 'oracle', originEventSequence: context.sequence, originRef,
      sourceEventRefs: [originRef], retired: false, retiredAtSequence: null } });
  assertTtrpgOpenFactEntryGatesV1({ basis, entries: ttrpgOpenSessionFactsV1(run.factLedger), entry, oracle, authorization,
    entityOperations: run.entityOperations, storyFacts: runtime.product.effectLedger.storyFacts });
  const retirement = proposal.supersedes === null ? null : parseTtrpgOpenFactRetirementV1({ factKey: proposal.supersedes,
    sourceRef, authorizationEpochKey: epoch.epochKey, viewerKey, reason: proposal.supersedeReason, supersededByFactKey: entry.fact.factKey });
  return { actorKey: seat.actorKey ?? 'gm', targetKey: proposal.subjectRef,
    payload: { viewerKey, authorizationEpochKey: epoch.epochKey, basis: run.factLedger ? null : basis, basisHash: basis.basisHash,
      entry, retirement, stateLayoutVersion: 1 } };
}


/** Explicit human GM confirmation only. A later governed AI candidate must use its own real Harness proof. */
export async function commitTtrpgOpenOracleFactV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; oracleSourceRef: TtrpgOpenSourceRefV1; proposal: TtrpgOpenOracleFactProposalV1; candidateHash: string;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'fact viewer'), proposal = parseTtrpgOpenOracleFactProposalV1(input.proposal);
  const oracleSourceRef = parseTtrpgOpenSourceRefV1(input.oracleSourceRef), candidateHash = openHash(input.candidateHash, 'fact candidate hash');
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.fact.asserted', intent: { viewerKey, oracleSourceRef, proposal, candidateHash },
    build: async context => {
      return buildTtrpgOpenFactAssertionV1(context, { viewerKey, proposal, oracleSourceRef, candidateHash, baseStateHash: input.baseStateHash });
    },
  });
}

/** Explicit current human-GM path; original model requests and the release-only V1 API retain their permissions. */
export async function commitTtrpgOpenOracleRuntimeEntityFactV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; oracleSourceRef: TtrpgOpenSourceRefV1; proposal: TtrpgOpenOracleFactProposalV1; candidateHash: string;
  referencePolicy: 'committed-runtime-entities-v1';
}): Promise<ProductRuntimeEvent> {
  if (input.referencePolicy !== 'committed-runtime-entities-v1') throw new Error('请明确确认本次事实只引用已实际创建的运行实体。');
  const viewerKey = openKey(input.viewerKey, 'runtime fact viewer'), proposal = parseTtrpgOpenOracleFactProposalV1(input.proposal);
  const oracleSourceRef = parseTtrpgOpenSourceRefV1(input.oracleSourceRef), candidateHash = openHash(input.candidateHash, 'runtime fact candidate');
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.fact.asserted',
    intent: { viewerKey, oracleSourceRef, proposal, candidateHash, referencePolicy: input.referencePolicy },
    build: context => buildTtrpgOpenFactAssertionV1(context, { viewerKey, proposal, oracleSourceRef, candidateHash,
      baseStateHash: input.baseStateHash, referencePolicy: input.referencePolicy }),
  });
}

function modelFactRuntimeReferencePolicyV1(call: TtrpgOpenModelCallV1, proposal: TtrpgOpenOracleFactProposalV1) {
  return ttrpgOpenSemanticRuntimeReferencePolicyV1(call)?.references.references.some(row => row.entityRef === proposal.subjectRef || row.entityRef === proposal.objectRef)
    ? 'committed-runtime-entities-v1' as const : undefined;
}

/** The human selects one exact proposed fact; proof and state are rechecked in the formal event CAS. */
export async function commitTtrpgOpenOracleCandidateFactV1(input: Parameters<typeof commitTtrpgOpenSemanticCandidateFactV1>[0]): Promise<ProductRuntimeEvent> {
  return commitTtrpgOpenSemanticCandidateFactV1(input, false);
}
export async function commitTtrpgOpenCommonOracleCandidateFactV1(input: Parameters<typeof commitTtrpgOpenSemanticCandidateFactV1>[0]) {
  try { const event = await commitTtrpgOpenSemanticCandidateFactV1(input, true); return { sequence: event.sequence }; }
  catch (error) { throw commonOracleConfirmationError(input, error, 'fact'); }
}
async function commitTtrpgOpenSemanticCandidateFactV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; requestKey: string; candidateHash: string; proposalIndex: number; decision: 'assert';
}, common: boolean): Promise<ProductRuntimeEvent> {
  if (input.decision !== 'assert' || !Number.isSafeInteger(input.proposalIndex) || input.proposalIndex < 0 || input.proposalIndex > 2) {
    throw new Error('[ttrpg-open-oracle] 必须明确选择并确认一个候选事实');
  }
  const viewerKey = openKey(input.viewerKey, 'fact viewer'), requestKey = openKey(input.requestKey, 'Oracle request'),
    modelHash = openHash(input.candidateHash, 'Oracle candidate');
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error('[ttrpg-open-oracle] 团局不存在');
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! } });
  const sourceCall = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)?.openRun?.coordination.calls.find(call => call.requestKey === requestKey);
  if (Boolean(sourceCall?.commonOracle) !== common) throw new Error('共同事实须使用独立确认入口，不能借用原 GM 返回资料');
  const candidate = sourceCall?.skillId === 'prose.ttrpg-open-common-oracle-interpret'
    ? await (await import('./open-common-oracle-candidate')).readTtrpgOpenCommonOracleCandidateV1({ ...input, scope })
    : sourceCall?.skillId === 'prose.ttrpg-open-fact-normalize'
    ? await readTtrpgOpenFactNormalizationCandidateV1({ ...input,scope }) : await readTtrpgOpenOracleCandidateV1({ ...input, scope });
  if (!candidate || candidate.candidateHash !== modelHash || !candidate.facts?.[input.proposalIndex]) throw new Error('[ttrpg-open-oracle] 不是本次明确选择的真实候选');
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)!;
  const call = runtime.openRun!.coordination.calls.find(call => call.requestKey === requestKey)!;
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'oracle.fact', [requestKey, modelHash, String(input.proposalIndex)]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first();
  const envelope = { sessionId: input.sessionId, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash };
  const proposal = candidate.facts[input.proposalIndex], oracleSourceRef = candidate.oracleSourceRef;
  const candidateHash = await hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef, runtimeSourceHash: candidate.runtimeSourceHash,
    viewerKey, baseStateHash: envelope.baseStateHash });
  const referencePolicy = modelFactRuntimeReferencePolicyV1(call, proposal);
  const modelCandidate: TtrpgOpenFactModelCandidateV1 = { requestKey, candidateHash: modelHash, runContractHash: call.runContractHash,
    inputManifestHash: candidate.inputManifestHash, rawResponseHash: candidate.rawResponseHash, proposalIndex: input.proposalIndex, ...(candidate.normalizationOf ? { normalizationOf: candidate.normalizationOf } : {}) };
  const event = await appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.fact.asserted', intent: { viewerKey, oracleSourceRef, proposal, candidateHash, modelCandidate, ...(referencePolicy ? { referencePolicy } : {}) },
    build: async context => {
      const proof = await verifyTtrpgOpenOracleCandidateProofV1({ ...input, scope });
      const { runtime: current, epoch } = await openModelCallCallerV1(context, viewerKey, true);
      if (current.openRun!.oracleReviews?.some(review => review.requestKey === requestKey)) throw new Error('[ttrpg-open-oracle] 此候选已完整审阅，不能另行采用被弃用事实');
      assertTtrpgOpenModelFactApproverV1(current.authorization!, viewerKey);
      const view = await loadTtrpgOpenSemanticReviewContextV1({ scope, sessionId: input.sessionId, viewerKey }, call);
      if (proof.candidate.epochKey !== epoch.epochKey || proof.candidate.runtimeSourceHash !== context.session.runtimeSourceHash
        || proof.candidate.admissionStateHash !== await ttrpgOpenMechanicalStateHashV1(context.state)
        || proof.candidate.visibilityHash !== view.visibilityHash || stableJson(proof.candidate.facts![input.proposalIndex]) !== stableJson(proposal)) {
        throw new Error('[ttrpg-open-oracle] 候选权限、来源、事实或机械基线已经 stale');
      }
      return { ...await buildTtrpgOpenFactAssertionV1(context, { viewerKey, proposal, oracleSourceRef, candidateHash,
        baseStateHash: envelope.baseStateHash, modelCandidate, ...(referencePolicy ? { referencePolicy } : {}) }), agentEvidence: proof.evidence };
    },
  });
  try { await reconcileTtrpgOpenOracleFactRunV1({ ...input, scope }); }
  catch (cause) { throw new TtrpgOpenOracleReceiptPendingError(input.sessionId, event.sequence, input.runId, cause); }
  return event;
}

/** Complete human review, with one atomic event for selected facts and retained discard reasons. */
/** A common candidate rechecks its own source and original local Run; it never reads GM-private material. */
async function loadTtrpgOpenSemanticReviewContextV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string }, call: TtrpgOpenModelCallV1) {
  if (call.commonOracle) {
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
    const grant = runtime?.openRun?.coordination.epochs.find(row => row.epochKey === call.authorizationEpochKey)?.commonOracle
    return (await (await import('./open-common-oracle-authorization-proof')).verifyTtrpgOpenCommonOracleAuthorizationV1({ ...input, authorization: grant, phase: 'review' })).context
  }
  return loadTtrpgOpenGmOracleContextV1({ ...input, actorKey: 'gm' })
}

export async function reviewTtrpgOpenOracleCandidateV1(input: Parameters<typeof reviewTtrpgOpenSemanticCandidateV1>[0]): Promise<ProductRuntimeEvent> {
  return reviewTtrpgOpenSemanticCandidateV1(input, false);
}
export async function reviewTtrpgOpenCommonOracleCandidateV1(input: Parameters<typeof reviewTtrpgOpenSemanticCandidateV1>[0]) {
  try { const event = await reviewTtrpgOpenSemanticCandidateV1(input, true); return { sequence: event.sequence }; }
  catch (error) { throw commonOracleConfirmationError(input, error, 'review'); }
}
function commonOracleConfirmationError(input: { sessionId: number; runId: number }, error: unknown, kind: 'fact' | 'review') {
  if (error instanceof TtrpgOpenOracleReceiptPendingError) return new TtrpgOpenOracleReceiptPendingError(input.sessionId, error.eventSequence, input.runId, new Error('请恢复本次原回执。'), kind);
  return new Error('共同事实确认未通过；请核对原本人、来源、逐项决定和当前状态。原候选及已保存记录保留。');
}
async function reviewTtrpgOpenSemanticCandidateV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; requestKey: string; candidateHash: string;
  interpretationDecision: 'accept' | 'reject'; interpretationReason: string | null; choices: TtrpgOpenOracleReviewChoiceV1[];
}, common: boolean): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'review viewer'), requestKey = openKey(input.requestKey, 'review request'), candidateHash = openHash(input.candidateHash, 'review candidate');
  const choices = openList(input.choices,'Oracle review choices',parseTtrpgOpenOracleReviewChoiceV1,3).sort((a,b) => a.proposalIndex - b.proposalIndex);
  const interpretationReason = input.interpretationReason === null ? null : openText(input.interpretationReason, 'interpretation reason', 2000);
  if (!['accept','reject'].includes(input.interpretationDecision)) throw new Error('[ttrpg-open-oracle] 必须明确审阅解释');
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error('[ttrpg-open-oracle] 团局不存在');
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! } });
  const before = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)!;
  if (Boolean(before.openRun?.coordination.calls.find(row => row.requestKey === requestKey)?.commonOracle) !== common) throw new Error('共同事实须使用独立审阅入口，不能借用原 GM 返回资料');
  const commandId = await ttrpgOpenScopedKeyV1(before.sessionKey, 'oracle.review', [requestKey,candidateHash]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId,commandId]).first();
  const envelope = { sessionId: input.sessionId, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence, baseStateHash: prior?.baseStateHash ?? input.baseStateHash };
  const event = await appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.oracle.reviewed',
    intent: { viewerKey,requestKey,candidateHash,interpretationDecision: input.interpretationDecision,interpretationReason,choices },
    build: async context => {
      const prepared = await prepareTtrpgOpenFactAuthorityV1(context,viewerKey,true);
      const { runtime,run,epoch } = prepared;
      if (run.oracleReviews?.some(review => review.requestKey === requestKey)
        || run.factLedger?.entries.some(entry => entry.modelCandidate?.requestKey === requestKey)) throw new Error('[ttrpg-open-oracle] 此候选已确认或处置，不能更换完整选择');
      const proof = await verifyTtrpgOpenOracleCandidateProofV1({ ...input,scope });
      const candidate = proof.candidate;
      if (choices.length !== candidate.facts!.length || choices.some((choice,index) => choice.proposalIndex !== index)) {
        throw new Error('[ttrpg-open-oracle] 必须逐项明确审阅全部提案，不能遗漏或重复选择');
      }
      const call = run.coordination.calls.find(call => call.requestKey === requestKey)!;
      const view = await loadTtrpgOpenSemanticReviewContextV1({ scope, sessionId: input.sessionId, viewerKey }, call);
      if (candidate.epochKey !== epoch.epochKey || candidate.runtimeSourceHash !== context.session.runtimeSourceHash
        || candidate.admissionStateHash !== await ttrpgOpenMechanicalStateHashV1(context.state) || candidate.visibilityHash !== view.visibilityHash) throw new Error('[ttrpg-open-oracle] 完整审阅基线已 stale');
      const oracle = run.oracleReceipts!.find(receipt => stableJson(receipt.sourceRef) === stableJson(candidate.oracleSourceRef))!;
      const sourceRef = { sessionKey: runtime.sessionKey,sequence: context.sequence };
      const selected = choices.filter(choice => choice.decision === 'adopt');
      const adoptedFactKeys = await Promise.all(selected.map(choice => {
        const proposal = candidate.facts![choice.proposalIndex];
        if (!proposal) throw new Error('[ttrpg-open-oracle] 选择不属于候选事实');
        return ttrpgOpenFactIdentityV1({ sourceRef,fact: proposal,modelCandidate: { requestKey,runContractHash: call.runContractHash,
          candidateHash,inputManifestHash: call.inputManifestHash,rawResponseHash: candidate.rawResponseHash,proposalIndex: choice.proposalIndex,reviewHash: '0'.repeat(64) } });
      }));
      const reviewBody = { schema: 'storyforge.ttrpg-open-oracle-review' as const,version: 1 as const,sourceRef,
        authorizationEpochKey: epoch.epochKey,viewerKey,requestKey,runContractHash: call.runContractHash,inputManifestHash: candidate.inputManifestHash,
        rawResponseHash: candidate.rawResponseHash,candidateHash,oracleSourceRef: candidate.oracleSourceRef,runtimeSourceHash: candidate.runtimeSourceHash,
        confirmationStateHash: envelope.baseStateHash,interpretation: candidate.interpretation!,audience: oracle.audience,
        interpretationDecision: input.interpretationDecision,interpretationReason,
        ...(candidate.normalizationOf ? { normalizationOf: candidate.normalizationOf } : {}),proposals: candidate.facts!,choices,adoptedFactKeys };
      const review = parseTtrpgOpenOracleReviewV1({ ...reviewBody,reviewHash: await hashProductProductionValueV2(reviewBody) });
      const entries = [],retirements = [];
      const originalLedger = run.factLedger;
      for (const choice of selected) {
        const proposal = candidate.facts![choice.proposalIndex];
        const modelCandidate: TtrpgOpenFactModelCandidateV1 = { requestKey,runContractHash: call.runContractHash,candidateHash,
          inputManifestHash: candidate.inputManifestHash,rawResponseHash: candidate.rawResponseHash,proposalIndex: choice.proposalIndex,reviewHash: review.reviewHash,
          ...(candidate.normalizationOf ? { normalizationOf: candidate.normalizationOf } : {}) };
        const built = await buildTtrpgOpenFactAssertionV1(context,{ viewerKey,proposal,oracleSourceRef: candidate.oracleSourceRef,
          candidateHash: await hashTtrpgOpenOracleFactCandidateV1({ proposal,oracleSourceRef: candidate.oracleSourceRef,
            runtimeSourceHash: candidate.runtimeSourceHash,viewerKey,baseStateHash: envelope.baseStateHash }),baseStateHash: envelope.baseStateHash,modelCandidate,
          ...(modelFactRuntimeReferencePolicyV1(call, proposal) ? { referencePolicy: modelFactRuntimeReferencePolicyV1(call, proposal) } : {}) },prepared);
        const entry = built.payload.entry,retirement = built.payload.retirement;
        entries.push(entry); if (retirement) retirements.push(retirement);
        run.factLedger = { schema: 'storyforge.ttrpg-open-fact-ledger',version: 1,basis: prepared.basis,
          entries: [...(run.factLedger?.entries ?? []),entry],retirements: [...(run.factLedger?.retirements ?? []),...(retirement ? [retirement] : [])] };
      }
      return { actorKey: prepared.seat.actorKey ?? 'gm',targetKey: null,
        payload: { review,entries,retirements,basis: entries.length && !originalLedger ? prepared.basis : null,
          basisHash: entries.length ? prepared.basis.basisHash : null,stateLayoutVersion: 1 },agentEvidence: proof.evidence };
    },
  });
  try { await reconcileTtrpgOpenOracleFactRunV1({ ...input,scope }); }
  catch (cause) { throw new TtrpgOpenOracleReceiptPendingError(input.sessionId,event.sequence,input.runId,cause,'review'); }
  return event;
}

async function buildTtrpgOpenFactRetirementV1(context: TtrpgFormalBuildContextV1, viewerKey: string, factKey: string, reason: string) {
  const current = parseTtrpgRuntimeStateV2(context.state.ttrpg);
  const modelEntry = current?.openRun?.factLedger?.entries.find(entry => entry.fact.factKey === factKey)?.modelCandidate;
  const { runtime, run, seat, epoch } = await prepareTtrpgOpenFactAuthorityV1(context, viewerKey, modelEntry !== undefined);
  if (!ttrpgOpenSessionFactsV1(run.factLedger).some(fact => fact.factKey === factKey && !fact.retired)) throw new Error('[ttrpg-fact] 只能退休活动会话事实；不能删除世界不变量、机械状态或已退休记录。');
  const retirement = parseTtrpgOpenFactRetirementV1({ factKey, reason, sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence },
    authorizationEpochKey: epoch.epochKey, viewerKey, supersededByFactKey: null });
  return { actorKey: seat.actorKey ?? 'gm', targetKey: factKey, payload: { viewerKey, authorizationEpochKey: epoch.epochKey, retirement } };
}
/** Internal human review only. The verified read is supplied by the desk; no event is appended. */
export async function previewTtrpgOpenHumanFactCommandV1(context: TtrpgFormalBuildContextV1, input: {
  viewerKey: string; action: { kind: 'assert'; proposal: TtrpgOpenOracleFactProposalV1; oracleSourceRef: TtrpgOpenSourceRefV1;
    candidateHash: string; baseStateHash: string; referencePolicy?: 'committed-runtime-entities-v1' } | { kind: 'retire'; factKey: string; reason: string };
}) {
  const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg), epoch = runtime?.openRun?.coordination.epochs.find(row => row.epochKey === runtime.openRun!.coordination.activeEpochKey);
  assertTtrpgOpenSituationWindowEventV1(runtime, input.action.kind === 'assert' ? 'ttrpg.fact.asserted' : 'ttrpg.fact.retired');
  if (!epoch || isTtrpgOpenPassiveEpochV1(epoch)) throw new Error('[ttrpg-fact] 事实审阅需要本人普通咨询窗口，不能借用局势或复盘授权。');
  if (runtime!.openRun!.coordination.calls.some(row => row.authorizationEpochKey === epoch.epochKey && ['prepared', 'dispatched', 'unknown'].includes(row.status))) throw new Error('[ttrpg-fact] 请先核对原模型请求、回答与未知费用。');
  if (input.action.kind === 'retire') return buildTtrpgOpenFactRetirementV1(context, input.viewerKey, input.action.factKey, input.action.reason);
  return buildTtrpgOpenFactAssertionV1(context, { ...input.action, viewerKey: input.viewerKey });
}
export async function retireTtrpgOpenSessionFactV1(input: FormalTtrpgCommandEnvelope & { viewerKey: string; factKey: string; reason: string }): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'fact retirement viewer'), factKey = openKey(input.factKey, 'retired fact key'), reason = openText(input.reason, 'fact retirement reason', 1000);
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.fact.retired', intent: { viewerKey, factKey, reason },
    build: context => buildTtrpgOpenFactRetirementV1(context, viewerKey, factKey, reason),
  });
}

export async function startTtrpgOpenEpochV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; triggerKind: "submit-action" | "continue-host" | "request-brief" | "request-situation"; rawInput: string; manualAction?: TtrpgOpenManualActionAuthorizationV1;
  runtimeEntityReferencePolicy?: TtrpgOpenSituationRuntimeReferencePolicyV1;
  oracleRuntimeReferencePolicy?: TtrpgOpenOracleRuntimeReferencePolicyV1;
  normalizationRuntimeReferencePolicy?: TtrpgOpenNormalizationRuntimeReferencePolicyV1;
  commonOracle?: TtrpgOpenCommonOracleAuthorizationV1;
}): Promise<ProductRuntimeEvent> {
  const commonOracle = input.commonOracle === undefined ? undefined : parseTtrpgOpenCommonOracleAuthorizationV1(input.commonOracle);
  const viewerKey = openKey(input.viewerKey, "viewerKey");
  const rawInput = openText(input.rawInput, "rawInput", 10_000);
  const oracleRuntimeReferencePolicy = input.oracleRuntimeReferencePolicy === undefined ? undefined : parseTtrpgOpenOracleRuntimeReferencePolicyV1(input.oracleRuntimeReferencePolicy);
  const normalizationRuntimeReferencePolicy = input.normalizationRuntimeReferencePolicy === undefined ? undefined : parseTtrpgOpenNormalizationRuntimeReferencePolicyV1(input.normalizationRuntimeReferencePolicy);
  if (commonOracle && (input.triggerKind !== 'continue-host' || input.manualAction || input.runtimeEntityReferencePolicy || oracleRuntimeReferencePolicy || normalizationRuntimeReferencePolicy
    || rawInput !== TTRPG_OPEN_COMMON_ORACLE_INPUT_V1)) throw new Error('共同事实必须使用本次准确来源的独立窗口。');
  if (normalizationRuntimeReferencePolicy && (input.triggerKind !== 'continue-host' || input.manualAction || input.runtimeEntityReferencePolicy || oracleRuntimeReferencePolicy
    || rawInput !== TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1)) throw new Error('实例归一必须单独明确选择原已接受解释。');
  if (oracleRuntimeReferencePolicy && (input.triggerKind !== 'continue-host' || input.manualAction || input.runtimeEntityReferencePolicy || rawInput !== TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1)) throw new Error('实例事实策略需要独立的明确咨询窗口。');
  const runtimeEntityReferencePolicy = input.runtimeEntityReferencePolicy === undefined ? undefined : parseTtrpgOpenSituationRuntimeReferencePolicyV1(input.runtimeEntityReferencePolicy);
  if (runtimeEntityReferencePolicy && (input.triggerKind !== 'request-situation' || runtimeEntityReferencePolicy.consumer !== 'private-gm')) throw new Error('[ttrpg-situation] 实例引用必须使用原用途的独立局势窗口。');
  if (input.triggerKind !== "submit-action" && input.triggerKind !== "continue-host" && input.triggerKind !== "request-brief" && input.triggerKind !== "request-situation") throw new Error("[ttrpg] epoch 触发种类无效。");
  return appendFormalTtrpgCommand({ ...input, type: "ttrpg.open.epoch.started",
    intent: { viewerKey, rawInput, triggerKind: input.triggerKind, ...(input.manualAction ? { manualAction: input.manualAction } : {}),
      ...(runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy } : {}), ...(oracleRuntimeReferencePolicy ? { oracleRuntimeReferencePolicy } : {}),
      ...(normalizationRuntimeReferencePolicy ? { normalizationRuntimeReferencePolicy } : {}), ...(commonOracle ? { commonOracle } : {}) },
    build: async ({ state, session, sequence, ttrpgContent, participants }) => {
      const content = requireTtrpgOpenContent(ttrpgContent);
      const runtime = parseTtrpgRuntimeStateV2(state.ttrpg);
      if (!runtime?.openRun || !runtime.authorization) throw new Error("[ttrpg] 请先启动已授权的 open 团局。");
      if (runtime.openRun.gateRecoveries?.some(r => r.stoppedRef && runtime.openRun!.operations.some(o => o.operationKey === r.operationKey && o.status === 'executing'))) throw new Error('质量门恢复已停止，请保存并显式处理待办，不能重开窗口绕过');
      if (runtime.openRun.stage.status !== "open" && input.triggerKind !== "request-brief" && !ttrpgOpenClosedStageRecoveryAllowedV1(runtime, input.triggerKind) || runtime.openRun.coordination.activeEpochKey !== null) {
        throw new Error("[ttrpg] 同一团局最多一个 active epoch，不能以新 commandId 重开授权窗口。");
      }
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants, viewerKey });
      const authorizationHash = await hashProductProductionValueV2(runtime.authorization);
      if (input.triggerKind === 'request-brief') {
        if (!content.campaign.runtimePolicy.enabled) throw new Error('[ttrpg-brief] 冻结作品未允许模型复盘');
        assertTtrpgOpenBriefEpochAuthorityV1(runtime, viewerKey);
      }
      if (input.triggerKind === 'request-situation') {
        if (!content.campaign.runtimePolicy.enabled) throw new Error('[ttrpg-situation] 冻结作品未允许模型生成局势');
        assertTtrpgOpenSituationEpochAuthorityV1(runtime, viewerKey);
      }
      let commonEvidence: TtrpgOpenAgentEvidenceV1 | undefined, commonRevision: string | undefined;
      if (commonOracle) {
        if (!content.campaign.runtimePolicy.enabled) throw new Error('冻结作品未允许共同事实请求');
        assertTtrpgOpenCommonOracleEpochAuthorityV1(runtime, viewerKey);
        assertTtrpgOpenOracleInterpretationSlotV1(runtime, runtime.openRun.worldTime.worldTurn);
        const basis = commonOracle.basis;
        if (basis.requester.viewerKey !== viewerKey || basis.readEvidence.sequence !== sequence - 1 || basis.readEvidence.stateHash !== input.baseStateHash
          || await hashTtrpgOpenCommonOracleRequestBasisV1(basis) !== commonOracle.basisHash) throw new Error('共同事实缺少本次准确本人、原读取切点或完整请求证据');
        const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! } });
        const actual = await (await import('./open-common-oracle-context')).loadTtrpgOpenCommonOracleContextV1({ scope, sessionId: input.sessionId, actorKey: 'gm' });
        await assertTtrpgOpenCommonOracleRequestSourceV1(basis, actual);
        const proof = await (await import('./open-common-oracle-authorization-proof')).verifyTtrpgOpenCommonOracleAuthorizationV1({ scope, sessionId: input.sessionId, viewerKey, authorization: commonOracle, phase: 'authorize' });
        if (commonOracle.authorizationCommandId !== input.commandId) throw new Error('共同事实不能更换原授权命令');
        commonEvidence = proof.evidence; commonRevision = proof.inputRevision;
      }
      if (normalizationRuntimeReferencePolicy) {
        if (!content.campaign.runtimePolicy.enabled) throw new Error('冻结作品未启用模型事实归一');
        assertTtrpgOpenOracleRuntimeEpochAuthorityV1(runtime, viewerKey);
        assertTtrpgOpenSupportSlotV1(runtime, runtime.openRun.worldTime.worldTurn);
        await (await import('./open-entity-proof')).verifyTtrpgOpenEntityStateV1(state, content);
        const source = { content, runtimeSourceHash: session.runtimeSourceHash, runtime, reviewSourceRef: normalizationRuntimeReferencePolicy.reviewSourceRef,
          consumerRef: { sessionKey: runtime.sessionKey, sequence } };
        if (stableJson(await createTtrpgOpenNormalizationRuntimeReferencePolicyV1(source)) !== stableJson(normalizationRuntimeReferencePolicy)) throw new Error('实例归一策略没有当前准确授权和原已接受解释');
        await verifyTtrpgOpenOracleJournalV1({ receipts: [resolveTtrpgOpenNormalizationRuntimeSourceV1(source).oracle], rulePack: content.rulePack.content,
          sessionKey: runtime.sessionKey, seed: session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] });
      }
      if (oracleRuntimeReferencePolicy) {
        if (!content.campaign.runtimePolicy.enabled) throw new Error('冻结作品未启用模型咨询');
        assertTtrpgOpenOracleRuntimeEpochAuthorityV1(runtime, viewerKey);
        assertTtrpgOpenOracleInterpretationSlotV1(runtime, runtime.openRun.worldTime.worldTurn);
        await (await import('./open-entity-proof')).verifyTtrpgOpenEntityStateV1(state, content);
        await verifyTtrpgOpenOracleRuntimeReferencePolicyHashV1(oracleRuntimeReferencePolicy);
        const oracle = runtime.openRun.oracleReceipts?.find(row => stableJson(row.sourceRef) === stableJson(oracleRuntimeReferencePolicy.oracleSourceRef));
        if (!oracle) throw new Error('实例事实需要已保存的原 Oracle');
        await verifyTtrpgOpenOracleJournalV1({ receipts: [oracle], rulePack: content.rulePack.content, sessionKey: runtime.sessionKey, seed: session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] });
        assertTtrpgOpenOracleRuntimeReferenceJournalV1({ policy: oracleRuntimeReferencePolicy, operations: runtime.openRun.entityOperations ?? [], oracle,
          recipientActorKeys: runtime.authorization.selectedActorKeys, runtimeSourceHash: session.runtimeSourceHash, rulePackContentHash: content.rulePack.contentHash,
          consumerRef: { sessionKey: runtime.sessionKey, sequence } });
      }
      if (runtimeEntityReferencePolicy) {
        await (await import('./open-entity-proof')).verifyTtrpgOpenEntityStateV1(state, content);
        assertTtrpgOpenSituationRuntimeReferenceJournalV1({ policy: runtimeEntityReferencePolicy, operations: runtime.openRun.entityOperations ?? [],
          recipientActorKeys: runtime.authorization.selectedActorKeys, rulePackContentHash: runtime.product.rulePackContentHash,
          consumerRef: { sessionKey: runtime.sessionKey, sequence } });
        await assertTtrpgOpenRuntimeEntityReferencesMatchV1({ content, operations: runtime.openRun.entityOperations ?? [], runtimeSourceHash: session.runtimeSourceHash,
          snapshot: runtimeEntityReferencePolicy.references, mode: 'current' });
      }
      const inputRevision = commonRevision ?? await hashProductProductionValueV2({ sessionKey: runtime.sessionKey,
        triggerKind: input.triggerKind, rawInput, viewerKey, authorizationHash, ...(input.manualAction ? { manualAction: input.manualAction } : {}),
        ...(runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy } : {}), ...(oracleRuntimeReferencePolicy ? { oracleRuntimeReferencePolicy } : {}),
        ...(normalizationRuntimeReferencePolicy ? { normalizationRuntimeReferencePolicy } : {}), ...(commonOracle ? { commonOracle } : {}) });
      const epoch = parseTtrpgOpenEpochV1({
        ...(normalizationRuntimeReferencePolicy ? { normalizationRuntimeReferencePolicy } : {}), ...(commonOracle ? { commonOracle } : {}),
        ...(oracleRuntimeReferencePolicy ? { oracleRuntimeReferencePolicy } : {}),
        ...(runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy } : {}),
        ...(input.manualAction ? { manualAction: input.manualAction } : {}),
        epochKey: await ttrpgOpenScopedKeyV1(runtime.sessionKey, "epoch", [String(sequence), inputRevision]),
        startedRef: { sessionKey: runtime.sessionKey, sequence }, closedRef: null, status: "active",
        triggeredBySeatKey: seat.seatKey, viewerKey, triggerKind: input.triggerKind, inputRevision,
        sessionZeroRevision: runtime.authorization.revision, authorizationHash,
        budget: ttrpgOpenEpochBudgetForTriggerV1(frozenTtrpgOpenEpochBudgetV1(content.campaign), input.triggerKind, Boolean(commonOracle || oracleRuntimeReferencePolicy || normalizationRuntimeReferencePolicy)), successfulActorKeys: [],
        reservedCalls: 0, consumedTokens: 0, actualCostUsd: 0, stopReason: null,
      });
      if (commonOracle) assertTtrpgOpenCommonOracleEpochOriginV1(runtime, epoch);
      if (epoch.manualAction) {
        if (runtime.branchLineage?.recoveryTasks.some(t => !['completed','withdrawn'].includes(t.status))) throw new Error('[ttrpg-manual] 请先完成继承结算，不能另开人工行动');
        const request = await verifyTtrpgOpenManualAuthorizationV1(epoch.manualAction);
        if (seat.role !== 'player' || request.actorKey !== seat.actorKey || input.triggerKind !== 'submit-action') throw new Error('[ttrpg-manual] 只能为本人已认领角色提交人工行动');
        // Validate legality against a temporary active window before persisting
        // anything. A failed target/binding/budget cannot leave an empty epoch.
        const preview = structuredClone(state),previewRuntime = parseTtrpgRuntimeStateV2(preview.ttrpg)!;
        previewRuntime.openRun!.coordination.epochs.push(epoch);previewRuntime.openRun!.coordination.activeEpochKey = epoch.epochKey;preview.ttrpg = previewRuntime;
        const plan = await createTtrpgOpenRulePlanV1({ state: preview,content,runtimeSourceHash: session.runtimeSourceHash,request });
        await assertTtrpgOpenInteractionKnownCostsV1(preview,plan,previewRuntime.openRun!.worldTime.worldTurn);
      }
      return { actorKey: seat.actorKey, targetKey: null, payload: { epoch }, ...(commonEvidence ? { agentEvidence: commonEvidence } : {}) };
    },
  });
}

/** The original local Run and explicit sharing must exist before this authority is committed. No model is sent here. */
export async function authorizeTtrpgOpenPublicSituationV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; authorization: unknown;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'public request viewer'), grant = parseTtrpgOpenPublicSituationAuthorizationV1(input.authorization)
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.open.epoch.started',
    intent: { viewerKey, triggerKind: TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1, rawInput: grant.basis.sharedRequest.text, publicSituation: grant,
      ...(grant.basis.runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy: grant.basis.runtimeEntityReferencePolicy } : {}) },
    build: async ({ state, session, sequence, ttrpgContent, participants }) => {
      const content = requireTtrpgOpenContent(ttrpgContent), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
      if (!runtime?.authorization || !runtime.openRun || !content.campaign.runtimePolicy.enabled
        || runtime.openRun.coordination.activeEpochKey !== null) throw new Error('[ttrpg-public-situation] 需要当前已授权团局和独立空闲窗口')
      const budget = ttrpgOpenEpochBudgetForTriggerV1(frozenTtrpgOpenEpochBudgetV1(content.campaign), TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1)
      if (grant.budget.maximumInputTokens + grant.budget.maximumOutputTokens > budget.maximumTokens
        || grant.budget.maximumOutputTokens > content.campaign.runtimePolicy.maximumOutputTokens
        || grant.budget.maximumCostUsd > budget.maximumCostUsd) throw new Error('[ttrpg-public-situation] 本次输入、输出或费用预算超过冻结作品策略')
      assertTtrpgOpenSituationEpochAuthorityV1(runtime, viewerKey)
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants, viewerKey })
      const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId } })
      const proof = await verifyTtrpgOpenPublicSituationAuthorizationV1({ scope, sessionId: input.sessionId, viewerKey, authorization: grant, phase: 'authorize' })
      if (grant.authorizationCommandId !== input.commandId || grant.basis.readEvidence.sequence !== input.baseSequence
        || grant.basis.readEvidence.stateHash !== input.baseStateHash || sequence !== input.baseSequence + 1) throw new Error('[ttrpg-public-situation] 不能改变原请求的授权命令或切点')
      const epoch = parseTtrpgOpenEpochV1({ publicSituation: grant,
        ...(grant.basis.runtimeEntityReferencePolicy ? { runtimeEntityReferencePolicy: grant.basis.runtimeEntityReferencePolicy } : {}), epochKey: grant.basis.authorizationEpochKey,
        startedRef: { sessionKey: runtime.sessionKey, sequence }, closedRef: null, status: 'active',
        triggeredBySeatKey: seat.seatKey, viewerKey, triggerKind: TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1,
        inputRevision: proof.inputRevision, sessionZeroRevision: runtime.authorization.revision,
        authorizationHash: await hashProductProductionValueV2(runtime.authorization),
        budget,
        successfulActorKeys: [], reservedCalls: 0, consumedTokens: 0, actualCostUsd: 0, stopReason: null })
      return { actorKey: seat.actorKey, targetKey: null, payload: { epoch }, agentEvidence: proof.evidence }
    } })
}

/** Cancellation closes authority, without claiming any unfinished business step succeeded. */
export async function closeTtrpgOpenEpochV1(input: FormalTtrpgCommandEnvelope & {
  epochKey: string; viewerKey: string; reason: string; commonOracleEmpty?: true; commonOracleRequest?: TtrpgOpenCommonOracleRequestCloseV1; commonOracleArchive?: 'archive-this-unresumable-common-oracle-window';
}): Promise<ProductRuntimeEvent> {
  const epochKey = openKey(input.epochKey, "epochKey");
  const viewerKey = openKey(input.viewerKey, "viewerKey");
  const reason = openText(input.reason, "reason", 2000);
  const commonOracleRequest = input.commonOracleRequest === undefined ? undefined : parseTtrpgOpenCommonOracleRequestCloseV1(input.commonOracleRequest);
  if (input.commonOracleArchive !== undefined && input.commonOracleArchive !== 'archive-this-unresumable-common-oracle-window') throw new Error('共同归档需要明确本次人工决定');
  if ([Boolean(input.commonOracleEmpty), Boolean(commonOracleRequest), Boolean(input.commonOracleArchive)].filter(Boolean).length > 1) throw new Error('共同事实空窗口与已预留请求的结束决定不能混用');
  return appendFormalTtrpgCommand({ ...input, type: "ttrpg.open.epoch.closed", intent: { epochKey, viewerKey, reason, ...(input.commonOracleEmpty ? { commonOracleEmpty: true } : {}), ...(commonOracleRequest ? { commonOracleRequest } : {}), ...(input.commonOracleArchive ? { commonOracleArchive: input.commonOracleArchive } : {}) },
    build: async ({ state, session, participants, sequence }) => {
      const runtime = parseTtrpgRuntimeStateV2(state.ttrpg);
      const authorization = runtime?.authorization;
      const epoch = runtime?.openRun?.coordination.epochs.find(item => item.epochKey === epochKey);
      if (!runtime?.openRun || !authorization || !epoch || runtime.openRun.coordination.activeEpochKey !== epochKey) {
        throw new Error("[ttrpg] 当前 epoch 不存在或已关闭。");
      }
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants, viewerKey });
      assertTtrpgOpenEpochAuthorityV1({ epoch, authorization, viewerKey,
        authorizationHash: await hashProductProductionValueV2(authorization) });
      if (!input.commonOracleArchive && epoch.reservedCalls > 0
        || runtime.openRun.operations.some(operation => operation.authorizationEpochKey === epochKey && ["awaiting-approval", "executing"].includes(operation.status))) throw new Error("[ttrpg] 已执行业务的 epoch 必须等待结算和调用回执闭合。");
      if (input.commonOracleArchive) {
        if (!epoch.commonOracle) throw new Error('只有原共同请求可以归档');
        const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! } });
        const built = await (await import('./open-common-oracle-archive')).prepareTtrpgOpenCommonOracleArchiveForKernelV1({ scope, sessionId: input.sessionId, viewerKey, epochKey, requestKey: epoch.commonOracle.requestKey, sequence });
        return { actorKey: seat.actorKey, targetKey: null, payload: { epochKey, viewerKey, reason, commonOracleArchive: built.archive },
          commonOracleArchiveWitness: built.witness, ...(built.agentEvidence ? { agentEvidence: built.agentEvidence } : {}) };
      }
      let commonEvidence: TtrpgOpenAgentEvidenceV1 | undefined;
      if (epoch.commonOracle) {
        const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! } });
        if (commonOracleRequest) commonEvidence = (await (await import('./open-common-oracle-close')).readTtrpgOpenCommonOracleRequestCloseOwnerV1({ scope, sessionId: input.sessionId, viewerKey, epochKey, close: commonOracleRequest })).evidence;
        else if (input.commonOracleEmpty === true) commonEvidence = (await (await import('./open-common-oracle-authorization-proof')).readTtrpgOpenEmptyCommonOracleOwnerV1({ scope, sessionId: input.sessionId, viewerKey, epochKey })).evidence;
        else throw new Error('共同事实窗口须按原本地 Run 明确结束，不能跳过其终验');
      } else if (input.commonOracleEmpty !== undefined || commonOracleRequest) throw new Error('其他窗口不能借用共同事实结束标记');
      return { actorKey: seat.actorKey, targetKey: null, payload: { epochKey, viewerKey, reason }, ...(commonEvidence ? { agentEvidence: commonEvidence } : {}) };
    },
  });
}

/** Explicit human grant of one existing window; it cannot reopen or replenish it. */
export async function delegateTtrpgOpenHostingV1(input: FormalTtrpgCommandEnvelope & {
  epochKey: string;viewerKey: string;maximumCostUsdPerCall: number;decision: 'delegate-this-epoch'
}): Promise<ProductRuntimeEvent> {
  const epochKey = openKey(input.epochKey,'hosting epoch'),viewerKey = openKey(input.viewerKey,'hosting viewer');
  if (input.decision !== 'delegate-this-epoch') throw new Error('[ttrpg-hosting] 需要真人明确委托本轮主持');
  return appendFormalTtrpgCommand({ ...input,type: 'ttrpg.open.hosting.delegated',intent: { epochKey,viewerKey,maximumCostUsdPerCall: input.maximumCostUsdPerCall,decision: input.decision },
    build: async context => {
      const content = requireTtrpgOpenContent(context.ttrpgContent),runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg);
      if (!content.campaign.runtimePolicy.enabled || !runtime?.authorization) throw new Error('[ttrpg-hosting] 本作品未允许 AI 主持');
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,participants: context.participants,viewerKey });
      const permission = createTtrpgOpenHostingDelegationV1(context.state,{ epochKey,viewerKey,maximumCostUsdPerCall: input.maximumCostUsdPerCall,sequence: context.sequence });
      return { actorKey: seat.actorKey,targetKey: null,payload: { epochKey,viewerKey,permission } };
    } });
}
/** Revocation is legal during pause or an unknown provider result and changes no completed work. */
export async function stopTtrpgOpenHostingV1(input: FormalTtrpgCommandEnvelope & {
  epochKey: string;viewerKey: string;reason: string
}): Promise<ProductRuntimeEvent> {
  const epochKey = openKey(input.epochKey,'hosting epoch'),viewerKey = openKey(input.viewerKey,'hosting viewer'),reason = openText(input.reason,'hosting stop reason',2000);
  return appendFormalTtrpgCommand({ ...input,type: 'ttrpg.open.hosting.stopped',intent: { epochKey,viewerKey,reason },build: async context => {
    const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg);
    if (!runtime?.authorization) throw new Error('[ttrpg-hosting] 团局缺少当前授权');
    const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,participants: context.participants,viewerKey });
    return { actorKey: seat.actorKey,targetKey: null,payload: { epochKey,viewerKey,reason } };
  } });
}

/** Freezes a genuine child cause event; it grants no new roll, effect or confirmation. */
export async function inheritTtrpgOpenSourceV1(input: FormalTtrpgCommandEnvelope & {
  taskKey: string; viewerKey: string;
}): Promise<ProductRuntimeEvent> {
  const taskKey = openKey(input.taskKey, 'recovery task'), viewerKey = openKey(input.viewerKey, 'viewerKey');
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  const task = runtime?.branchLineage?.recoveryTasks.find(task => task.taskKey === taskKey);
  if (!runtime?.branchLineage || !task) throw new Error('[ttrpg-open-branch] 恢复来源任务不存在');
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'inherit', [taskKey]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first();
  const envelope = { sessionId: input.sessionId, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash };
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.source.inherited', intent: { taskKey, viewerKey },
    build: async context => {
      const { runtime, epoch } = await openModelCallCallerV1(context, viewerKey, true);
      if (epoch.manualAction) throw new Error('[ttrpg-manual] 人工行动窗口不能代替继承结算授权');
      const current = runtime.branchLineage?.recoveryTasks.find(task => task.taskKey === taskKey);
      const ancestor = runtime.branchLineage?.ancestors.find(ancestor => ancestor.sessionKey === current?.ancestorSessionKey);
      if (!current || !ancestor || current.status !== 'awaiting-authorization') throw new Error('[ttrpg-open-branch] 来源任务已处置或缺少冻结祖先');
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization!, participants: context.participants, viewerKey });
      return { actorKey: seat.actorKey, targetKey: current.operation.plan.request.actorKey, payload: {
        taskKey, ancestorSessionKey: ancestor.sessionKey, ancestorEvidenceHash: ancestor.evidenceHash,
        sourceRefs: current.operation.businessRefs.map(business => business.sourceRef), viewerKey, epochKey: epoch.epochKey } };
    },
  });
}

/** The already rolled parent result is read-only; only remaining business becomes a child operation. */
export async function startTtrpgOpenInheritedOperationV1(input: FormalTtrpgCommandEnvelope & {
  taskKey: string; viewerKey: string;
}): Promise<ProductRuntimeEvent> {
  const taskKey = openKey(input.taskKey, 'recovery task'), viewerKey = openKey(input.viewerKey, 'viewerKey');
  const initial = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  const epochKey = initial?.openRun?.coordination.activeEpochKey;
  if (!initial?.branchLineage || !epochKey) throw new Error('[ttrpg-open-recovery] 需要当前子分支真人窗口');
  const commandId = await ttrpgOpenScopedKeyV1(initial.sessionKey, 'recover', [taskKey, epochKey]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first();
  const envelope = { sessionId: input.sessionId, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash };
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.operation.started', intent: { taskKey, viewerKey },
    build: async context => {
      const { runtime, epoch } = await openModelCallCallerV1(context, viewerKey, true);
      if (epoch.manualAction) throw new Error('[ttrpg-manual] 人工行动窗口不能代替继承结算授权');
      const task = runtime.branchLineage?.recoveryTasks.find(task => task.taskKey === taskKey);
      if (!task || task.status !== 'ready' || !task.inheritedRef || task.childOperationKey !== null
        || runtime.openRun!.operations.some(operation => ['awaiting-approval', 'executing'].includes(operation.status))) throw new Error('[ttrpg-open-recovery] 继承回执未准备或仍有活动操作');
      if (task.operation.plan.affectedActorKeys.some(actorKey => context.state.entities[actorKey]?.kind === 'player'
        && !runtime.authorization!.selectedActorKeys.includes(actorKey))) throw new Error('[ttrpg-open-recovery] 原受影响玩家尚未重新确认');
      const original = ttrpgOpenAncestorRuleReceiptForTaskV1(runtime.branchLineage!, task);
      const originalRuleRef = original.inheritedFrom?.originalSourceRef ?? original.sourceRef;
      const plan = parseTtrpgOpenRulePlanV1({ ...task.operation.plan, epochKey: epoch.epochKey,
        authorizationHash: await hashProductProductionValueV2(runtime.authorization),
        mechanicalStateHash: await ttrpgOpenMechanicalStateHashV1(context.state),
        requiredApprovals: ttrpgOpenRecoveryApprovalsV1(task, runtime.authorization!, runtime.branchLineage!) });
      const planHash = await hashProductProductionValueV2(plan);
      const coveredStepKeys = ttrpgOpenCoveredBusinessKeysV1(task);
      const inheritance = { taskKey, ancestorSessionKey: task.ancestorSessionKey, ancestorOperationKey: task.operation.operationKey,
        coveredStepKeys, ruleCauseRef: task.inheritedRef, originalRuleRef,
        selectedAlternativeKey: task.operation.pendingChoice?.selectedAlternativeKey ?? null,
        ...(task.operation.discoveryChoices ? { discoveryChoices: task.operation.discoveryChoices.map(({ templateKey, alternativeKey }) => ({ templateKey, alternativeKey })) } : {}) };
      const operation = parseTtrpgOpenOperationV1({
        operationKey: await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'recovery-operation', [taskKey, epoch.epochKey]),
        rootCommandId: commandId, inputHash: await hashProductProductionValueV2({ taskKey, inputRevision: epoch.inputRevision }),
        planHash, riskHash: await hashProductProductionValueV2({ planHash, inheritance,
          remainingStepKeys: task.remainingStepKeys, originalOutcome: original.result.outcome }),
        authorizationEpochKey: epoch.epochKey, startedRef: { sessionKey: runtime.sessionKey, sequence: context.sequence },
        ...(task.operation.settlementOrder ? { settlementOrder: task.operation.settlementOrder } : {}),
        status: 'awaiting-approval', privateChoiceDisclosures: [], plan, plannedSteps: ttrpgOpenOperationStepsV1(plan,task.operation.settlementOrder).slice(coveredStepKeys.length),
        approvals: [], businessRefs: [], receipts: [], completedRef: null, pendingChoice: null, inheritance,
        ...(task.operation.pressureTurnConditions ? { pressureTurnConditions: task.operation.pressureTurnConditions } : {}),
      }, runtime.sessionKey);
      const inheritedRuleReceipt = parseTtrpgOpenRuleReceiptV1({ operationKey: operation.operationKey,
        sourceRef: task.inheritedRef, frozenPlanHash: planHash, result: original.result, inheritedFrom: { originalSourceRef: originalRuleRef } });
      return { actorKey: operation.plan.request.actorKey, targetKey: operation.plan.request.targetKey,
        payload: { operation, inheritedRuleReceipt } };
    },
  });
}

export interface TtrpgOpenModelCallCommandV1 extends FormalTtrpgCommandEnvelope {
  requestKey: string; viewerKey: string; runId: number;
}

async function openModelCallEnvelopeV1(input: TtrpgOpenModelCallCommandV1, step: 'dispatch' | 'finish' | 'intent-rejection'): Promise<FormalTtrpgCommandEnvelope> {
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  if (!runtime?.openRun?.coordination.calls.some(call => call.requestKey === input.requestKey)) throw new Error('[ttrpg-open-call] 请求预留不存在');
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'call', [input.requestKey, step]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first();
  return { sessionId: input.sessionId, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash };
}

async function openModelCallCallerV1(context: {
  session: ProductRuntimeSession; state: ProductRuntimeState; participants: import('../types').TtrpgSessionParticipantRecordV2[];
}, viewerKey: string, checkCurrentAuthorization: boolean, request?: Pick<TtrpgOpenModelCallV1, 'skillId' | 'narrationBinding'>) {
  const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg);
  const epoch = runtime?.openRun?.coordination.epochs.find(epoch => epoch.epochKey === runtime.openRun!.coordination.activeEpochKey);
  const kpRequester = request?.skillId === 'prose.ttrpg-open-kp' && request.narrationBinding?.viewerKey === viewerKey;
  if (!runtime?.openRun || !runtime.authorization || !epoch || epoch.status !== 'active' || !kpRequester && epoch.viewerKey !== viewerKey) throw new Error('[ttrpg-open-call] 缺少本人活动授权窗口');
  if (epoch.manualAction && request && request.skillId !== 'prose.ttrpg-open-kp') throw new Error('[ttrpg-manual] 人工行动授权不能用于新的模型行动请求');
  if (kpRequester) assertTtrpgOpenModelActorV1(runtime.authorization, 'prose.ttrpg-open-kp', 'gm', viewerKey);
  if (checkCurrentAuthorization) {
    assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants: context.participants, viewerKey });
    assertTtrpgOpenEpochAuthorityV1({ epoch, authorization: runtime.authorization, viewerKey: epoch.viewerKey,
      authorizationHash: await hashProductProductionValueV2(runtime.authorization) });
  }
  const scope = await resolveScope({ scope: { projectId: context.session.projectId, worldId: context.session.worldId!, workId: context.session.workId! } });
  return { runtime, epoch, scope };
}

/** No provider is sent here. The exact request and manifest must already belong to a durable Run. */
export async function reserveTtrpgOpenModelCallV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; actorKey: string; skillId: string; stepId: string; attempt: number;
  runContractHash: string; inputManifestHash: string; requestHash: string;
  admissionStateHash: string; visibilityHash: string; runtimeSourceHash: string;
  reservedInputTokens: number; reservedOutputTokens: number; reservedCostUsd: number;
  entityProposal?: TtrpgOpenModelCallV1['entityProposal'];
  hostingDelegationRef?: TtrpgOpenModelCallV1['hostingDelegationRef'];
  oracleInterpretation?: TtrpgOpenModelCallV1['oracleInterpretation'];
  commonOracle?: TtrpgOpenModelCallV1['commonOracle'];
  supportSlot?: TtrpgOpenModelCallV1['supportSlot'];
  narrationBinding?: TtrpgOpenModelCallV1['narrationBinding'];
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'viewerKey');
  const metadata = { actorKey: input.actorKey, skillId: input.skillId, stepId: input.stepId, attempt: input.attempt,
    runContractHash: input.runContractHash, inputManifestHash: input.inputManifestHash, requestHash: input.requestHash,
    admissionStateHash: input.admissionStateHash, visibilityHash: input.visibilityHash, runtimeSourceHash: input.runtimeSourceHash,
    reservedInputTokens: input.reservedInputTokens, reservedOutputTokens: input.reservedOutputTokens, reservedCostUsd: input.reservedCostUsd,
    ...(input.entityProposal ? { entityProposal: input.entityProposal } : {}),
    ...(input.commonOracle ? { commonOracle: input.commonOracle } : {}),
    ...(input.hostingDelegationRef ? { hostingDelegationRef: input.hostingDelegationRef } : {}),
    ...(input.oracleInterpretation ? { oracleInterpretation: input.oracleInterpretation } : {}),...(input.supportSlot ? { supportSlot: input.supportSlot } : {}), ...(input.narrationBinding ? { narrationBinding: input.narrationBinding } : {}) };
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.open.call.reserved', intent: { viewerKey, ...metadata },
    build: async context => {
      const content = requireTtrpgOpenContent(context.ttrpgContent);
      if (!content.campaign.runtimePolicy.enabled || metadata.reservedOutputTokens > content.campaign.runtimePolicy.maximumOutputTokens) {
        throw new Error('[ttrpg-open-call] 冻结运行策略未启用 AI 或输出超过授权上限');
      }
      const { runtime, epoch, scope } = await openModelCallCallerV1(context, viewerKey, true, metadata);
      if (metadata.hostingDelegationRef) assertTtrpgOpenHostingRequestV1(context.state,{ epochKey: epoch.epochKey,viewerKey,delegationRef: metadata.hostingDelegationRef,
        purpose: metadata.skillId === 'prose.ttrpg-open-companion' ? 'companion' : metadata.skillId === 'prose.ttrpg-open-kp' ? 'kp-narration' : (() => { throw new Error('[ttrpg-hosting] 模型用途不属于本轮委托'); })(),actorKey: metadata.actorKey,maximumCostUsd: metadata.reservedCostUsd });
      if (metadata.supportSlot) {
        assertTtrpgOpenSupportSlotV1(runtime,metadata.supportSlot.worldTurn);
        if (metadata.supportSlot.worldTurn !== runtime.openRun!.worldTime.worldTurn) throw new Error('[ttrpg-open-call] 辅助槽必须属于当前世界轮');
      }
      if (metadata.oracleInterpretation) {
        assertTtrpgOpenOracleInterpretationSlotV1(runtime, metadata.oracleInterpretation.worldTurn);
        if (metadata.oracleInterpretation.worldTurn !== runtime.openRun!.worldTime.worldTurn
          || !runtime.openRun!.oracleReceipts?.some(receipt => stableJson(receipt.sourceRef) === stableJson(metadata.oracleInterpretation!.oracleSourceRef))) {
          throw new Error('[ttrpg-open-call] Oracle 解释没有当前世界轮与真实咨询绑定');
        }
      }
      if (runtime.branchLineage?.recoveryTasks.some(task => !['completed', 'withdrawn'].includes(task.status) && !(metadata.narrationBinding && task.status === 'executing' && task.childOperationKey === metadata.narrationBinding.operationKey))) {
        throw new Error('[ttrpg-open-branch] 请先恢复继承结算，再生成新行动意图');
      }
      const call = parseTtrpgOpenModelCallV1({ ...metadata,
        requestKey: await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'request', [epoch.epochKey, input.commandId]), authorizationEpochKey: epoch.epochKey,
        createdRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, dispatchRef: null, terminalRef: null,
        status: 'prepared', providerRequestId: null, responseArtifactHash: null, usage: null, terminalReason: null });
      assertTtrpgOpenEntityModelCallOriginV1(runtime, call);
      (await import('./open-model-calls')).assertTtrpgOpenCommonOracleCallOriginV1(runtime, call);
      if (call.commonOracle) assertTtrpgOpenOracleInterpretationSlotV1(runtime, call.commonOracle.worldTurn);
      assertTtrpgOpenOracleRuntimeCallOriginV1(runtime, call);
      assertTtrpgOpenNormalizationSourceV1(runtime,call);
      assertTtrpgOpenCallReservationV1({ epoch, calls: runtime.openRun!.coordination.calls, requestKey: call.requestKey,
        inputTokens: call.reservedInputTokens, outputTokens: call.reservedOutputTokens, maximumCostUsd: call.reservedCostUsd });
      const agentEvidence = await verifyTtrpgOpenModelCallEvidenceV1({ scope, sessionId: input.sessionId, runId: input.runId, call, mode: 'reserve' });
      return { actorKey: call.actorKey, targetKey: null, payload: { call, viewerKey }, agentEvidence };
    },
  });
}

/** Persist immediately before the external send; a lost result becomes unknown, never an implicit retry. */
export async function dispatchTtrpgOpenModelCallV1(input: TtrpgOpenModelCallCommandV1 & {
  providerRequestId?: string | null;
}): Promise<{ event: ProductRuntimeEvent; sendAuthorized: boolean }> {
  const viewerKey = openKey(input.viewerKey, 'viewerKey');
  const envelope = await openModelCallEnvelopeV1(input, 'dispatch');
  const providerRequestId = input.providerRequestId ?? null;
  let sendAuthorized = false;
  let event: ProductRuntimeEvent;
  try { event = await appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.call.dispatched', intent: { requestKey: input.requestKey, viewerKey, providerRequestId },
    build: async context => {
      const { runtime, scope } = await openModelCallCallerV1(context, viewerKey, true, parseTtrpgRuntimeStateV2(context.state.ttrpg)?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey));
      const previous = runtime.openRun!.coordination.calls.find(call => call.requestKey === input.requestKey);
      if (!previous || previous.status !== 'prepared') throw new Error('[ttrpg-open-call] 请求只能由 prepared 派发一次');
      if (previous.hostingDelegationRef) assertTtrpgOpenHostingDelegationV1(context.state,{ epochKey: previous.authorizationEpochKey,viewerKey,delegationRef: previous.hostingDelegationRef });
      const call = parseTtrpgOpenModelCallV1({ ...previous, status: 'dispatched', providerRequestId,
        dispatchRef: { sessionKey: runtime.sessionKey, sequence: context.sequence } });
      const agentEvidence = await verifyTtrpgOpenModelCallEvidenceV1({ scope, sessionId: input.sessionId, runId: input.runId, call, mode: 'dispatch' });
      return { actorKey: call.actorKey, targetKey: null, payload: { call, viewerKey }, agentEvidence };
    },
    afterCommit: async () => { sendAuthorized = true; },
  });
  } catch (error) {
    if (!(error instanceof TtrpgOpenReadConflictV1)) throw error;
    const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, envelope.commandId]).first();
    if (!prior) throw error;
    assertFormalTtrpgPrior({ ...envelope, prior, type: 'ttrpg.open.call.dispatched', intent: { requestKey: input.requestKey, viewerKey, providerRequestId } });
    // Only the already committed identical receipt is recovered; this executor never gains another send permit.
    return { event: prior, sendAuthorized: false };
  }
  return { event, sendAuthorized };
}

/** Completion records external usage even after safety pause or stale input; it cannot apply model output. */
export async function finishTtrpgOpenModelCallV1(input: TtrpgOpenModelCallCommandV1 & {
  status: 'succeeded' | 'failed' | 'unknown'; responseArtifactHash: string | null;
  providerRequestId?: string | null; usage: NonNullable<TtrpgOpenModelCallV1['usage']>; terminalReason: string;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'viewerKey');
  const envelope = await openModelCallEnvelopeV1(input, 'finish');
  const terminal = structuredClone({ status: input.status, responseArtifactHash: input.responseArtifactHash,
    usage: input.usage, terminalReason: input.terminalReason });
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.call.finished',
    intent: { requestKey: input.requestKey, viewerKey, providerRequestId: input.providerRequestId ?? null, ...terminal },
    build: async context => {
      const { runtime, scope } = await openModelCallCallerV1(context, viewerKey, false, parseTtrpgRuntimeStateV2(context.state.ttrpg)?.openRun?.coordination.calls.find(c => c.requestKey === input.requestKey));
      const previous = runtime.openRun!.coordination.calls.find(call => call.requestKey === input.requestKey);
      if (!previous || !['prepared', 'dispatched'].includes(previous.status)) throw new Error('[ttrpg-open-call] 请求已终态或不存在');
      const call = parseTtrpgOpenModelCallV1({ ...previous, ...terminal, providerRequestId: input.providerRequestId ?? previous.providerRequestId,
        terminalRef: { sessionKey: runtime.sessionKey, sequence: context.sequence } });
      const actualRun = await db.agentRuns.get(input.runId);
      let agentEvidence: TtrpgOpenAgentEvidenceV1;
      if (actualRun?.portableRuntimeOriginJson !== undefined && previous.status === 'prepared' && !previous.dispatchRef
        && previous.providerRequestId === null && call.providerRequestId === null
        && call.status === 'failed' && call.terminalReason === 'cancelled-before-dispatch') {
        const { readTtrpgOpenImportedCallOwnerV1 } = await import('./open-run-portability');
        const historical = await readTtrpgOpenImportedCallOwnerV1({ scope, sessionId: input.sessionId, runId: input.runId, requestKey: call.requestKey });
        if (!historical) throw new Error('[ttrpg-open-call] 导入的未发送请求缺少准确原始证明，不能取消记账');
        agentEvidence = historical.evidence;
      } else agentEvidence = await verifyTtrpgOpenModelCallEvidenceV1({ scope, sessionId: input.sessionId, runId: input.runId, call, mode: 'finish' });
      if (call.status === 'unknown' && agentEvidence.events.some(event => {
        if (event.type !== 'model.responded' && event.type !== 'evidence.artifact.recorded') return false;
        const payload = JSON.parse(event.payloadJson) as { stepId?: string; attempt?: number; artifactKind?: string };
        return payload.stepId === call.stepId && payload.attempt === call.attempt
          && (event.type === 'model.responded' || payload.artifactKind === 'raw-response');
      })) throw new Error('[ttrpg-open-call] 原请求已有实际回答证据，不能降格为结果未知；请恢复原回答回执');
      return { actorKey: call.actorKey, targetKey: null, payload: { call, viewerKey }, agentEvidence };
    },
  });
}

export interface TtrpgOpenOperationCommandV1 extends FormalTtrpgCommandEnvelope {
  operationKey: string; frozenPlanHash: string; viewerKey: string;
  hostingDelegationRef?: import('./open-coordination').TtrpgOpenSourceRefV1;
}
export type TtrpgOpenOperationResumeV1 = Pick<TtrpgOpenOperationCommandV1, 'sessionId' | 'operationKey' | 'frozenPlanHash' | 'viewerKey' | 'hostingDelegationRef'>;

export async function ttrpgOpenOperationCommandIdV1(sessionKey: string, operationKey: string, stepKey: string): Promise<string> {
  return ttrpgOpenScopedKeyV1(sessionKey, "op", [operationKey, stepKey]);
}

/** Qualified step keys prove replay identity; the original baseline is retained on retries. */
async function openOperationEnvelopeV1(input: TtrpgOpenOperationCommandV1, stepKey: string, kind: "rule" | "entity" = "rule"): Promise<FormalTtrpgCommandEnvelope> {
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  const planHash = kind === "rule" ? runtime?.openRun?.operations.find(operation => operation.operationKey === input.operationKey)?.planHash
    : runtime?.openRun?.entityOperations?.find(operation => operation.plan.operationKey === input.operationKey)?.plan.planHash;
  if (!runtime || planHash !== input.frozenPlanHash) throw new Error("[ttrpg] operation/plan 不存在或已变化。");
  const commandId = await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, input.operationKey, stepKey);
  if (input.commandId !== commandId) throw new Error("[ttrpg] operation 命令必须使用内核生成的步骤 key。");
  const prior = await db.productRuntimeEvents.where("[sessionId+commandId]").equals([input.sessionId, commandId]).first();
  return prior ? { sessionId: input.sessionId, commandId, baseSequence: prior.baseSequence!, baseStateHash: prior.baseStateHash! } : input;
}

async function openOperationCallerV1(context: Parameters<Parameters<typeof appendFormalTtrpgCommand>[0]["build"]>[0],
  input: TtrpgOpenOperationResumeV1, requireStarter = true) {
  const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg);
  const authorization = runtime?.authorization;
  const operation = runtime?.openRun?.operations.find(operation => operation.operationKey === input.operationKey);
  if (!runtime?.openRun || !authorization || !operation || operation.planHash !== input.frozenPlanHash) throw new Error("[ttrpg] operation/plan 不存在或已变化。");
  const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants: context.participants, viewerKey: input.viewerKey });
  const epoch = runtime.openRun.coordination.epochs.find(epoch => epoch.epochKey === operation.authorizationEpochKey);
  const authorizationHash = await hashProductProductionValueV2(authorization);
  if (!epoch || epoch.status !== "active" || runtime.openRun.coordination.activeEpochKey !== epoch.epochKey
    || epoch.authorizationHash !== authorizationHash || operation.plan.authorizationHash !== authorizationHash
    || operation.plan.runtimeSourceHash !== context.session.runtimeSourceHash
    || (requireStarter && epoch.viewerKey !== seat.viewerKey)) throw new Error("[ttrpg] operation 授权 stale 或不属于当前启动者。");
  if (input.hostingDelegationRef) assertTtrpgOpenHostingDelegationV1(context.state, {
    epochKey: epoch.epochKey, viewerKey: input.viewerKey, delegationRef: input.hostingDelegationRef,
  });
  return { runtime, operation, epoch, seat };
}

type TtrpgFormalBuildContextV1 = Pick<Parameters<Parameters<typeof appendFormalTtrpgCommand>[0]['build']>[0],
  'state' | 'session' | 'sequence' | 'ttrpgContent' | 'participants'>;
async function prepareStartedTtrpgOpenOperationV1(
  { state, session, sequence, ttrpgContent, participants }: TtrpgFormalBuildContextV1,
  viewerKey: string, request: TtrpgOpenRuleRequestV1, commandId: string,
  intentEvidence?: import('./open-operation').TtrpgOpenOperationV1['intentEvidence'],
) {
  const content = requireTtrpgOpenContent(ttrpgContent);
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg);
  if (!runtime?.authorization || !runtime.openRun) throw new Error("[ttrpg] open 团局未启动。");
  if (runtime.branchLineage?.recoveryTasks.some(task => !['completed', 'withdrawn'].includes(task.status))) {
    throw new Error('[ttrpg-open-branch] 请先恢复继承结算，不能绕过父已提交结果开始新行动');
  }
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants, viewerKey });
  const epoch = runtime.openRun.coordination.epochs.find(epoch => epoch.epochKey === runtime.openRun!.coordination.activeEpochKey);
  if (!epoch || epoch.viewerKey !== viewerKey || runtime.openRun.operations.some(operation => ["awaiting-approval", "executing"].includes(operation.status))) throw new Error("[ttrpg] 没有本人活动窗口或已有未完成操作。");
  if (epoch.manualAction) {
    await verifyTtrpgOpenManualAuthorizationV1(epoch.manualAction);assertTtrpgOpenManualRequestV1(epoch,request);
    if (intentEvidence || runtime.openRun.operations.some(o => o.authorizationEpochKey === epoch.epochKey)) throw new Error('[ttrpg-manual] 一次人工授权只对应原来的一个规则提案');
  }
  const plan = await createTtrpgOpenRulePlanV1({ state, content, runtimeSourceHash: session.runtimeSourceHash, request });
  await assertTtrpgOpenInteractionKnownCostsV1(state,plan,runtime.openRun.worldTime.worldTurn);
  const planHash = await hashProductProductionValueV2(plan);
  const operation = parseTtrpgOpenOperationV1({
    operationKey: await ttrpgOpenScopedKeyV1(runtime.sessionKey, "operation", [epoch.epochKey, commandId]),
    rootCommandId: commandId, inputHash: await hashProductProductionValueV2({ request, inputRevision: epoch.inputRevision }),
    planHash, riskHash: await hashProductProductionValueV2({ planHash, affectedActorKeys: plan.affectedActorKeys, timeCostWorldTurns: plan.timeCostWorldTurns }),
    authorizationEpochKey: epoch.epochKey, startedRef: { sessionKey: runtime.sessionKey, sequence },
    ...(plan.timeCostWorldTurns > 1 ? { settlementOrder: 'per-world-turn-v1' } : {}),
    status: "awaiting-approval", privateChoiceDisclosures: [], plan, plannedSteps: ttrpgOpenOperationStepsV1(plan,plan.timeCostWorldTurns > 1 ? 'per-world-turn-v1' : undefined), approvals: [], businessRefs: [], receipts: [], completedRef: null, pendingChoice: null,
  }, runtime.sessionKey);
  return intentEvidence ? parseTtrpgOpenOperationV1({ ...operation, intentEvidence }, runtime.sessionKey) : operation;
}

export async function startTtrpgOpenOperationV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; request: TtrpgOpenRuleRequestV1;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, "viewerKey"), request = parseTtrpgOpenRuleRequestV1(input.request);
  return appendFormalTtrpgCommand({ ...input, type: "ttrpg.open.operation.started", intent: { viewerKey, request },
    build: async ({ state, session, sequence, ttrpgContent, participants }) => {
      const operation = await prepareStartedTtrpgOpenOperationV1({ state, session, sequence, ttrpgContent, participants }, viewerKey, request, input.commandId);
      return { actorKey: request.actorKey, targetKey: request.targetKey, payload: { operation } };
    },
  });
}

/** Explicit human semantic confirmation only prepares an operation; affected humans still approve its frozen risk. */
type TtrpgOpenSemanticOperationInputV1 = FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; requestKey: string; candidateHash: string;
  clarificationHash?: string;
  effectBindings?: TtrpgOpenRuleRequestV1['effectBindings'];
};
/** Explicit human clarification keeps the original candidate, epoch and provider usage intact. */
export async function clarifyTtrpgOpenIntentCandidateV1(input: Omit<TtrpgOpenSemanticOperationInputV1,'clarificationHash'> & {
  selection: TtrpgOpenIntentSelectionV1; expectedCount: number; discovery?: TtrpgOpenRuleRequestV1['discovery'];
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey,'clarifying human'),requestKey = openKey(input.requestKey,'original request'),candidateHash = openHash(input.candidateHash,'original candidate');
  const selection = parseTtrpgOpenIntentSelectionV1(input.selection),expectedCount = input.expectedCount;
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount >= 3) throw Error('同一澄清线程最多提交三次补充');
  const effectBindings = structuredClone(input.effectBindings ?? {}),discovery = input.discovery === undefined ? undefined : structuredClone(input.discovery);
  const intent = { viewerKey,requestKey,candidateHash,selection,expectedCount,effectBindings,...(discovery ? { discovery } : {}) };
  const before = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  if (!before) throw Error('团局尚未开始');
  const commandId = await ttrpgOpenScopedKeyV1(before.sessionKey,'intent.clarify',[requestKey,candidateHash,await hashProductProductionValueV2(intent)]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId,commandId]).first();
  return appendFormalTtrpgCommand({ sessionId: input.sessionId,commandId,baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash,type: 'ttrpg.open.intent.clarified',intent,
    build: async context => {
      const { scope } = await openModelCallCallerV1(context,viewerKey,true);
      const { candidate,evidence } = await verifyTtrpgOpenIntentCandidateProofV1({ ...input,scope,candidateHash });
      const { inspectTtrpgOpenIntentRoutingV1,prepareTtrpgOpenClarifiedRuleRequestV1 } = await import('./open-intent-clarification');
      const content = requireTtrpgOpenContent(context.ttrpgContent);
      const inspected = await inspectTtrpgOpenIntentRoutingV1({ scope,session: context.session,state: context.state,content,viewerKey,candidate });
      if (!inspected.originalRequiresClarification || (inspected.call.intentClarifications?.length ?? 0) !== expectedCount) throw Error('原澄清线程已变化，不能替换其他候选或重置次数');
      if (!inspected.review.canClarify) throw Error('同一澄清线程最多提交三次补充');
      if (selection.method !== null && !inspected.review.catalog.rules.some(r => (r.interactionKey ?? r.ruleKey) === selection.method)) throw Error('请选择双方可见的冻结规则方法');
      const prepared = await prepareTtrpgOpenClarifiedRuleRequestV1({ inspected,candidate,selection,bindings: effectBindings,discovery,
        state: context.state,content,runtimeSourceHash: context.session.runtimeSourceHash! });
      const { request } = prepared;
      if (!request && (Object.keys(effectBindings).length || discovery)) throw Error('尚未明确裁定方式，不能附加后果或线索绑定');
      const body: Omit<TtrpgOpenIntentClarificationV1,'clarificationHash'> = { schema: 'storyforge.ttrpg-open-intent-clarification',version: 1,
        sourceRef: { sessionKey: inspected.runtime.sessionKey,sequence: context.sequence },candidateHash,
        threadKey: candidate.intent!.clarificationThreadKey,actorKey: candidate.actorKey,viewerKey,attempt: expectedCount + 1,selection,request,
        ...(prepared.sceneScope ? { sceneScope: prepared.sceneScope } : {}) };
      return { actorKey: candidate.actorKey,targetKey: null,payload: { requestKey,viewerKey,clarification: { ...body,clarificationHash: await hashTtrpgOpenIntentClarificationV1(body) } },agentEvidence: evidence };
    },
  });
}
export async function startTtrpgOpenIntentCandidateOperationV1(input: TtrpgOpenSemanticOperationInputV1 & { decision: 'start' }): Promise<ProductRuntimeEvent> {
  if (input.decision !== 'start') throw new Error('[ttrpg-open-intent] 需要真人明确确认此候选');
  return startTtrpgOpenSemanticOperationV1(input);
}
/** System proposal under an actual finite delegation. No human risk approval is fabricated. */
export async function startTtrpgOpenDelegatedCompanionOperationV1(input: TtrpgOpenSemanticOperationInputV1 & {
  hostingDelegationRef: NonNullable<TtrpgOpenModelCallV1['hostingDelegationRef']>
}): Promise<ProductRuntimeEvent> {
  return startTtrpgOpenSemanticOperationV1(input,parseTtrpgOpenSourceRefV1(input.hostingDelegationRef));
}
async function startTtrpgOpenSemanticOperationV1(input: TtrpgOpenSemanticOperationInputV1,
  hostingDelegationRef?: NonNullable<TtrpgOpenModelCallV1['hostingDelegationRef']>): Promise<ProductRuntimeEvent> {
  const { reconcileTtrpgOpenIntentRunV1,TtrpgOpenIntentReceiptPendingError } = await import('./open-intent-adoption');
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw Error('[ttrpg-open-intent] 团局不存在');
  const scope = await resolveScope({ scope: { projectId: session.projectId,worldId: session.worldId!,workId: session.workId! } });
  const viewerKey = openKey(input.viewerKey, 'viewerKey'), candidateHash = openHash(input.candidateHash, 'candidateHash');
  const requestKey = openKey(input.requestKey, 'requestKey');
  const effectBindings = structuredClone(input.effectBindings ?? {});
  const clarificationHash = input.clarificationHash === undefined ? undefined : openHash(input.clarificationHash,'clarification hash');
  const before = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  if (!before) throw new Error('[ttrpg-open-intent] 团局尚未启动');
  const commandId = await ttrpgOpenScopedKeyV1(before.sessionKey, 'intent.operation', [requestKey, candidateHash,...(clarificationHash ? [clarificationHash] : [])]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first();
  const envelope = { sessionId: input.sessionId, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash };
  const event = await appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.operation.started',
    intent: { viewerKey, requestKey, candidateHash, decision: hostingDelegationRef ? 'delegate-proposal' : 'start',effectBindings,
      ...(hostingDelegationRef ? { hostingDelegationRef } : {}),...(clarificationHash ? { clarificationHash } : {}) },
    build: async context => {
      const { runtime, epoch, scope } = await openModelCallCallerV1(context, viewerKey, true);
      const { candidate, evidence } = await verifyTtrpgOpenIntentCandidateProofV1({ ...input, scope });
      const call = runtime.openRun!.coordination.calls.find(call => call.requestKey === requestKey);
      if (!call?.terminalRef || call.authorizationEpochKey !== epoch.epochKey || candidate.epochKey !== epoch.epochKey
        || candidate.actorKey !== call.actorKey || candidate.runtimeSourceHash !== context.session.runtimeSourceHash
        || candidate.admissionStateHash !== await ttrpgOpenMechanicalStateHashV1(context.state)) {
        throw new Error('[ttrpg-open-intent] 候选机械状态、来源或授权窗口已经 stale');
      }
      if (hostingDelegationRef) assertTtrpgOpenDelegatedCompanionProposalV1(context.state,{ epochKey: epoch.epochKey,viewerKey,
        delegationRef: hostingDelegationRef,runContractHash: call.runContractHash,actorKey: candidate.actorKey });
      const view = await loadTtrpgOpenPlayerContextV1({ scope, sessionId: input.sessionId, actorKey: candidate.actorKey });
      if (view.visibilityHash !== candidate.visibilityHash) throw new Error('[ttrpg-open-intent] 候选角色读取权限已经 stale');
      const content = requireTtrpgOpenContent(context.ttrpgContent);
      let intent = candidate.intent!;
      const clarifications = call.intentClarifications ?? [],clarification = clarifications[clarifications.length - 1];
      if (clarification || clarificationHash) {
        const { inspectTtrpgOpenIntentRoutingV1,prepareTtrpgOpenClarifiedRuleRequestV1,assertTtrpgOpenClarifiedRequestEqualV1 } = await import('./open-intent-clarification');
        const inspected = await inspectTtrpgOpenIntentRoutingV1({ scope,session: context.session,state: context.state,content,viewerKey,candidate });
        if (!clarification || clarification.clarificationHash !== clarificationHash || !clarification.request) throw Error('请明确确认已核对的当前人工澄清版本');
        if (hostingDelegationRef) throw Error('人工澄清后的行动需要真人明确确认，不能自动采用');
        if (Object.keys(effectBindings).length && stableJson(effectBindings) !== stableJson(clarification.request.effectBindings)) throw Error('不能替换已核对的澄清后果绑定');
        const checked = await prepareTtrpgOpenClarifiedRuleRequestV1({ inspected,candidate,selection: clarification.selection,
          bindings: clarification.request.effectBindings,discovery: clarification.request.discovery,state: context.state,content,runtimeSourceHash: context.session.runtimeSourceHash! });
        if (!checked.request) throw Error('当前澄清仍需要补充，不能执行');
        assertTtrpgOpenClarifiedRequestEqualV1(checked.request,clarification.request);
        if (stableJson(checked.sceneScope ?? null) !== stableJson(clarification.sceneScope ?? null)) throw Error('已核对的澄清场景范围已变化');
        intent = inspected.intent;
      }
      if (intent.targetRefs.length > 1) throw new Error('[ttrpg-open-intent] 当前裁定需要单个明确目标，不能静默丢弃其他目标');
      const actors = content.campaign.characterTemplates.map(template => {
        const seat = runtime.authorization!.seats.find(seat => seat.actorKey === template.characterKey);
        return { ...template, ...(seat ? { controller: seat.controller, seatKey: seat.seatKey } : {}),
          ...(template.characterKey === candidate.actorKey ? { actionKeys: view.view.rules.actions.map(action => action.actionKey) } : {}) };
      });
      const preview = routeTtrpgOpenIntentV1(intent, { rulePack: content.rulePack.content, campaign: content.campaign,
        actors, predicateContext: ttrpgOpenPredicateContextV1(context.state, content) });
      const interactionKey = preview.routeDetail.interactionKey;
      const ruleRoute = preview.route === 'no-roll' && interactionKey ? 'existing-action' : preview.route;
      const ruleKey = ruleRoute === 'existing-action' ? preview.routeDetail.actionKey
        : preview.route === 'generic-check' ? preview.routeDetail.checkKey : null;
      if (!ruleKey || (ruleRoute !== 'existing-action' && ruleRoute !== 'generic-check')
        || (ruleRoute === 'existing-action' && !view.view.rules.actions.some(action => action.actionKey === ruleKey))
        || (preview.route === 'generic-check' && !view.view.rules.genericChecks.some(check => check.checkKey === ruleKey))) {
        throw new Error('[ttrpg-open-intent] 意图需要澄清或其他裁定 owner；不能冒充现有规则行动');
      }
      const allowedBindings = new Set<string>([candidate.actorKey, ...view.view.actorsHere.map(actor => actor.actorKey),
        ...view.view.initialObservations.flatMap(fact => [fact.subjectRef, fact.objectRef].filter((ref): ref is string => ref !== null)),
        ...view.view.self.inventory.flatMap(item => [item.itemInstanceId, item.definitionRef]),
        ...view.view.rules.core.resources.map(resource => resource.key)]);
      if (view.view.self.locationKey) allowedBindings.add(view.view.self.locationKey);
      if (Object.values(effectBindings).some(bindings => Object.values(bindings).some(ref => ref !== null && !allowedBindings.has(ref)))) {
        throw new Error('[ttrpg-open-intent] 后果绑定引用了当前角色不可见的对象');
      }
      const target = resolveTtrpgOpenIntentTargetV1({ route: ruleRoute,actorKey: candidate.actorKey,targetRefs: intent.targetRefs,
        actionTarget: view.view.rules.actions.find(action => action.actionKey === ruleKey)?.target,currentLocationRef: view.view.self.locationKey });
      const request = clarification?.request ?? parseTtrpgOpenRuleRequestV1({ route: ruleRoute, ruleKey, actorKey: candidate.actorKey,...(interactionKey ? { interactionKey } : {}),
        targetKey: target.targetKey, controllerMode: intent.source.startsWith('companion:') ? 'ai' : 'human', effectBindings });
      const operation = await prepareStartedTtrpgOpenOperationV1(context, viewerKey, request, commandId, {
        ...(hostingDelegationRef ? { hostingDelegationRef } : {}),
        ...(target.sceneScope ? { sceneScope: target.sceneScope } : {}),
        sourceRef: call.terminalRef, candidateHash, runContractHash: call.runContractHash,
        inputManifestHash: call.inputManifestHash, rawResponseHash: candidate.rawResponseHash,
        ...(clarification ? { clarificationRef: { sourceRef: clarification.sourceRef,clarificationHash: clarification.clarificationHash } } : {}) });
      return { actorKey: request.actorKey, targetKey: request.targetKey, payload: { operation }, agentEvidence: evidence };
    },
  });
  try { await reconcileTtrpgOpenIntentRunV1({ ...input,scope }); }
  catch (error) { throw new TtrpgOpenIntentReceiptPendingError(input.sessionId,event.sequence,input.runId,error); }
  return event;
}

export async function confirmTtrpgOpenOperationV1(input: TtrpgOpenOperationCommandV1 & {
  actorKey: string; riskHash: string; decision: "approve" | "reject";
}): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, `approval.${openKey(input.actorKey, "actorKey")}`);
  const intent = { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey,
    actorKey: input.actorKey, riskHash: input.riskHash, decision: input.decision };
  return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.open.intent.confirmed", intent,
    build: async context => {
      const { operation, seat } = await openOperationCallerV1(context, input, false);
      if (operation.plan.mechanicalStateHash !== await ttrpgOpenMechanicalStateHashV1(context.state)) throw new Error("[ttrpg] 确认前机械状态已变化，计划 stale。");
      return { actorKey: seat.actorKey, targetKey: operation.plan.request.actorKey,
        payload: { ...intent, approverSeatKey: seat.seatKey, confirmationKind: "operation", alternativeKey: null } };
    },
  });
}

export async function prepareTtrpgOpenPrivateChoiceDisclosureV1(input: {
  sessionId: number; operationKey: string; frozenPlanHash: string; viewerKey: string; kind: 'effect' | 'knowledge'; templateKey: string;
}) {
  const state = await readProductRuntimeState(input.sessionId),runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  const operation = runtime?.openRun?.operations.find(o => o.operationKey === input.operationKey && o.planHash === input.frozenPlanHash)
  if (!runtime?.authorization || !operation) throw new Error('[ttrpg-private-choice] 当前操作不存在或已变化')
  assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,participants: await readTtrpgSessionParticipantsV2(input.sessionId),viewerKey: input.viewerKey })
  assertTtrpgOpenHumanHostV1(runtime.authorization,input.viewerKey)
  const body = buildTtrpgOpenPrivateChoiceBodyV1({ state,runtime,operation,kind: input.kind,templateKey: input.templateKey })
  return { body,reviewHash: await hashProductProductionValueV2({ viewerKey: input.viewerKey,body }) }
}
export async function discloseTtrpgOpenPrivateChoiceV1(input: TtrpgOpenOperationCommandV1 & {
  kind: 'effect' | 'knowledge'; templateKey: string; reviewHash: string;
}): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input,`private-disclosure.${input.reviewHash}`)
  return appendFormalTtrpgCommand({ ...envelope,type: 'ttrpg.open.choice.disclosed',
    intent: { viewerKey: input.viewerKey,operationKey: input.operationKey,frozenPlanHash: input.frozenPlanHash,kind: input.kind,templateKey: input.templateKey,reviewHash: input.reviewHash },
    build: async context => {
      const { runtime,operation,seat } = await openOperationCallerV1(context,input,false)
      assertTtrpgOpenHumanHostV1(runtime.authorization!,input.viewerKey)
      const body = buildTtrpgOpenPrivateChoiceBodyV1({ state: context.state,runtime,operation,kind: input.kind,templateKey: input.templateKey })
      if (await hashProductProductionValueV2({ viewerKey: input.viewerKey,body }) !== input.reviewHash) throw new Error('[ttrpg-private-choice] 告知预览已变化，请重新核对')
      return { actorKey: seat.actorKey,targetKey: body.actorKey,payload: { operationKey: operation.operationKey,frozenPlanHash: operation.planHash,
        disclosure: { body,viewerKey: input.viewerKey,reviewHash: input.reviewHash,sourceRef: { sessionKey: runtime.sessionKey,sequence: context.sequence } } } }
    } })
}

export async function selectTtrpgOpenDiscoveryEffectV1(input: TtrpgOpenOperationCommandV1 & { templateKey: string; alternativeKey: string; riskHash: string; disclosureHash?: string }): Promise<ProductRuntimeEvent> {
  const templateKey = openKey(input.templateKey, 'discovery template'), alternativeKey = openKey(input.alternativeKey, 'discovery alternative');
  const envelope = await openOperationEnvelopeV1(input, `knowledge-choice.${templateKey}`);
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.intent.confirmed',
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, templateKey, alternativeKey, riskHash: input.riskHash, ...(input.disclosureHash !== undefined ? { disclosureHash: input.disclosureHash } : {}) },
    build: async context => {
      const { runtime, operation, seat } = await openOperationCallerV1(context, input, false);
      const privateReceipt = runtime.openRun!.ruleReceipts.find(r => r.operationKey === operation.operationKey);
      if (!privateReceipt) throw new Error('[ttrpg] 发现选择尚无真实规则结果');
      if (!ttrpgOpenDiscoveryEffectTemplatesV1(operation,privateReceipt).some(t => t.planKey === templateKey && t.alternatives.some(a => a.alternativeKey === alternativeKey))
        || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'knowledge') throw new Error('[ttrpg] 发现代价必须是本计划允许的真人选择');
      await verifyTtrpgOpenPrivateChoiceHashesV1([operation]);
      assertTtrpgOpenPrivateChoiceConsentV1({ state: context.state,runtime,operation,kind: 'knowledge',templateKey: templateKey,disclosureHash: input.disclosureHash,currentCommand: true });
      return { actorKey: seat.actorKey, targetKey: operation.plan.request.actorKey,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, riskHash: input.riskHash,
          actorKey: operation.plan.request.actorKey, approverSeatKey: seat.seatKey, viewerKey: seat.viewerKey,
          decision: 'approve', confirmationKind: 'knowledge-choice', templateKey, alternativeKey, ...(input.disclosureHash !== undefined ? { disclosureHash: input.disclosureHash } : {}) } };
    },
  });
}

export async function selectTtrpgOpenOperationEffectV1(input: TtrpgOpenOperationCommandV1 & { alternativeKey: string; riskHash: string; disclosureHash?: string }): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, "effect-choice");
  return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.open.intent.confirmed",
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey,
      alternativeKey: openKey(input.alternativeKey, "alternativeKey"), riskHash: input.riskHash, ...(input.disclosureHash !== undefined ? { disclosureHash: input.disclosureHash } : {}) },
    build: async context => {
      const { runtime, operation, seat } = await openOperationCallerV1(context, input, false);
      await verifyTtrpgOpenPrivateChoiceHashesV1([operation]);
      assertTtrpgOpenPrivateChoiceConsentV1({ state: context.state,runtime,operation,kind: 'effect',templateKey: operation.pendingChoice?.templateKey ?? '',disclosureHash: input.disclosureHash,currentCommand: true });
      assertTtrpgOpenInteractionChoiceCostV1(context.state,operation.plan,input.alternativeKey);
      return { actorKey: seat.actorKey, targetKey: operation.plan.request.actorKey,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, riskHash: input.riskHash,
          actorKey: operation.plan.request.actorKey, approverSeatKey: seat.seatKey, viewerKey: seat.viewerKey,
          decision: "approve", confirmationKind: "effect-choice", alternativeKey: input.alternativeKey, ...(input.disclosureHash !== undefined ? { disclosureHash: input.disclosureHash } : {}) } };
    },
  });
}

/** Withdrawal preserves the journal and cannot abandon already committed business effects. */
export async function disposeTtrpgOpenIntentV1(input: TtrpgOpenOperationCommandV1 & { reason: string }): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, "disposed");
  const reason = openText(input.reason, "dispose reason", 2000);
  return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.open.intent.disposed",
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, reason },
    build: async context => {
      const { operation, seat } = await openOperationCallerV1(context, input);
      if (!["awaiting-approval", "executing"].includes(operation.status) || operation.businessRefs.length || operation.inheritance) throw new Error("[ttrpg] 只能撤销未执行业务的本人计划；已提交后果必须恢复结算。");
      return { actorKey: seat.actorKey, targetKey: operation.plan.request.actorKey,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: seat.viewerKey, reason } };
    },
  });
}

export async function resolveTtrpgOpenOperationRuleV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, "rule");
  return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.rule.action.resolved",
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input);
      if (operation.status !== "executing" || nextTtrpgOpenOperationStepV1(operation)?.kind !== "rule"
        || operation.plan.mechanicalStateHash !== await ttrpgOpenMechanicalStateHashV1(context.state)) throw new Error("[ttrpg] 规则计划未批准、顺序不正确或已 stale。");
      const result = await resolveTtrpgOpenRuleMechanicalV1({ state: context.state, plan: operation.plan,
        seed: context.session.seed, operationKey: operation.operationKey, sequence: context.sequence });
      return { actorKey: operation.plan.request.actorKey, targetKey: operation.plan.request.targetKey,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, stepKey: "rule", causeRef: operation.startedRef, recordChaos: true,
          receipt: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash,
            sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, result } } };
    },
  });
}

export async function applyTtrpgOpenOperationEffectV1(input: TtrpgOpenOperationCommandV1 & { stepKey: "mechanics" | "effect" }): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, input.stepKey);
  return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.effects.applied",
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, stepKey: input.stepKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input);
      const receipt = runtime.openRun!.ruleReceipts.find(receipt => receipt.operationKey === operation.operationKey);
      if (!receipt || operation.status !== "executing" || nextTtrpgOpenOperationStepV1(operation)?.stepKey !== input.stepKey) throw new Error("[ttrpg] 效果缺少真实裁定或步骤不正确。");
      if (input.stepKey === "mechanics" && operation.plan.mechanicalStateHash !== await ttrpgOpenMechanicalStateHashV1(context.state)) throw new Error("[ttrpg] 机械效果基线已 stale。");
      let effectPlan: import("../types").TtrpgEffectPlanV2 | null = null;
      const degree = ttrpgOpenOperationEffectDegreeV1(operation.plan,receipt.result.outcome);
      const templateKey = ttrpgOpenOperationEffectTemplateKeyV1(operation.plan,receipt.result.outcome);
      if (input.stepKey === "effect" && operation.plan.interaction) {
        effectPlan = buildTtrpgOpenInteractionEffectV1(operation.plan,operation.pendingChoice?.selectedAlternativeKey ?? null,{
          planKey: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey,operation.operationKey,"effect-plan"),commandId: envelope.commandId,sourceEventId: `event.${receipt.sourceRef.sequence}` });
      } else if (input.stepKey === "effect" && templateKey !== null) {
        const template = operation.plan.effectTemplates.find(template => template.planKey === templateKey)!;
        if (template.alternatives.length && !operation.pendingChoice?.selectedAlternativeKey) throw new Error("[ttrpg] 后果需要持久化真人选择，不能自动提交。");
        const bindings = operation.plan.request.effectBindings[templateKey];
        const primitives = template.alternatives.length ? template.alternatives.find(alternative => alternative.alternativeKey === operation.pendingChoice!.selectedAlternativeKey)!.effects : template.effects;
        const effects: import("../types").TtrpgEffectPrimitiveV2[] = primitives.flatMap(effect => {
          if (effect.family === "knowledge") {
            if (!operation.plan.discoveryPlan || effect.evidenceRef !== operation.plan.discoveryPlan.request.evidenceRef) throw new Error('[ttrpg] 知识后果缺少冻结发现计划。');
            return [];
          }
          if (effect.family === "story" && effect.operation !== "location.set") throw new Error("[ttrpg] 后果 owner 尚未接入，必须保留待办。");
          const targetRef = effect.targetRef.startsWith("parameter:") ? bindings[effect.targetRef.slice(10)] : effect.targetRef;
          return targetRef === null ? [] : [{ ...effect, targetRef }];
        });
        effectPlan = parseTtrpgEffectPlanV2({ schema: "storyforge.ttrpg-effect-plan", version: 2,
          planKey: await ttrpgOpenOperationCommandIdV1(runtime.sessionKey, operation.operationKey, "effect-plan"),
          degree, sourceEventId: `event.${receipt.sourceRef.sequence}`, ruleRef: template.ruleRef, reason: template.reason,
          audience: template.audience, status: "immediate", effects,
          idempotencyKey: envelope.commandId });
      }
      return { actorKey: operation.plan.request.actorKey, targetKey: operation.plan.request.targetKey,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, stepKey: input.stepKey, causeRef: receipt.sourceRef, effectPlan } };
    },
  });
}

export async function completeTtrpgOpenOperationStepV1(input: TtrpgOpenOperationCommandV1 & { stepKey: string }): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, `${openKey(input.stepKey, "stepKey")}.receipt`);
  return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.open.operation.step.completed",
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, stepKey: input.stepKey },
    build: async context => {
      const { operation } = await openOperationCallerV1(context, input);
      const business = operation.businessRefs.find(ref => ref.stepKey === input.stepKey);
      if (!business) throw new Error("[ttrpg] 步骤尚无真实业务事件，不能完成回执。");
      return { actorKey: operation.plan.request.actorKey, targetKey: operation.plan.request.targetKey,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, stepKey: input.stepKey, businessRef: business.sourceRef } };
    },
  });
}

export async function discoverTtrpgOpenKnowledgeV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, 'knowledge');
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.knowledge.discovered',
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input);
      const plan = operation.plan.discoveryPlan, content = requireTtrpgOpenContent(context.ttrpgContent);
      const receipt = runtime.openRun!.ruleReceipts.find(receipt => receipt.operationKey === operation.operationKey);
      if (!plan || !receipt || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'knowledge'
        || stableJson(plan.frozenContent) !== stableJson(content) || plan.contentHash !== await hashProductProductionValueV2(content)
        || plan.publicFieldsHash !== await hashTtrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).validationView, plan.request.evidenceRef)) {
        throw new Error('[ttrpg-knowledge] 发现步骤、冻结内容或公开字段已变化。');
      }
      const knowledgeKey = `knowledge.${await hashProductProductionValueV2({ sessionKey: runtime.sessionKey, operationKey: operation.operationKey, evidenceRef: plan.request.evidenceRef })}`;
      const { settlement } = settleTtrpgOpenKnowledgeV1({ state: context.state, operation, ruleReceipt: receipt,
        sequence: context.sequence, commandId: envelope.commandId, knowledgeKey });
      return { actorKey: operation.plan.request.actorKey, targetKey: null,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, stepKey: 'knowledge',
          causeRef: receipt.sourceRef, knowledgeKey, settlement } };
    },
  });
}


type TtrpgOpenPressureEffectLocatorV1 = Pick<TtrpgOpenOperationCommandV1, 'sessionId' | 'operationKey' | 'frozenPlanHash' | 'viewerKey'> & { cycleKey: string; workKey: string };
function locateTtrpgOpenPressureEffectV1(runtime: import('./open-runtime-contract').TtrpgRuntimeStateV2, operationKey: string, cycleKey: string, workKey: string) {
  const run = runtime.openRun!, operation = run.operations.find(o => o.operationKey === operationKey);
  const receipt = run.ruleReceipts.find(r => r.operationKey === operationKey), cycle = run.pressureCycles?.find(c => c.cycleKey === cycleKey);
  const work = cycle?.work.find(w => w.workKey === workKey);
  if (!operation || !receipt || !cycle || !work || work.completedRef || cycle.completedRef || operation.status !== 'executing'
    || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'pressure' || cycle.work.find(w => !w.completedRef)?.workKey !== workKey
    || !ttrpgOpenTurnCycleMatchesV1(cycle,operation,ttrpgOpenPressureRuleSourceV1(receipt),'pressure')) throw new Error('[ttrpg-pressure] 不是本操作当前未完成的压力后果。');
  return { operation, cycle, work };
}

/** Reuse effect governance against the actual stage-owned journal. */
function locateTtrpgOpenConsequenceEffectV1(runtime: import('./open-runtime-contract').TtrpgRuntimeStateV2, operationKey: string, cycleKey: string, workKey: string, owner: 'pressure' | 'situations' | 'stage') {
  if (owner === 'pressure') return locateTtrpgOpenPressureEffectV1(runtime, operationKey, cycleKey, workKey);
  const run = runtime.openRun!, operation = run.operations.find(o => o.operationKey === operationKey), receipt = run.ruleReceipts.find(r => r.operationKey === operationKey);
  if (owner === 'stage') {
    const cycle = run.stageClosures?.find(c => c.cycleKey === cycleKey), work = cycle?.work.find(w => w.workKey === workKey);
    if (!operation || !receipt || !cycle || !work || work.completedRef || cycle.completedRef || cycle.work.find(w => !w.completedRef)?.workKey !== workKey
      || operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'gates' || run.stage.status !== 'closed'
      || !sameTtrpgOpenPressureSourceV1(cycle.ruleSourceRef, ttrpgOpenPressureRuleSourceV1(receipt))) throw new Error('[ttrpg-stage] 当前实际阶段效果不存在。');
    return { operation, cycle, work };
  }
  const cycle = run.situationCycles?.find(c => c.cycleKey === cycleKey), actual = cycle?.work.find(w => w.workKey === workKey);
  if (!operation || !receipt || !cycle || !actual || actual.kind !== 'effect' || actual.completedRef || cycle.completedRef || operation.status !== 'executing'
    || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'situations' || cycle.work.find(w => !w.completedRef)?.workKey !== workKey
    || !ttrpgOpenTurnCycleMatchesV1(cycle,operation,ttrpgOpenPressureRuleSourceV1(receipt),'situations')) throw new Error('[ttrpg-situation] 不是本操作当前真实局势效果。');
  return { operation, cycle, work: ttrpgOpenSituationEffectWorkV1(actual) };
}
/** Read-only GM preparation; full hidden mechanics never go to a stakeholder read view. */
export async function prepareTtrpgOpenPressureEffectV1(input: TtrpgOpenPressureEffectLocatorV1 & { request: TtrpgOpenPressureEffectRequestV1 }, owner: 'pressure' | 'situations' | 'stage' = 'pressure') {
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error('[ttrpg-pressure] 团局不存在。');
  const state = await readProductRuntimeState(input.sessionId), participants = await readTtrpgSessionParticipantsV2(input.sessionId);
  const frozen = await verifyFormalTtrpgSource(session);
  const { runtime, epoch } = await openOperationCallerV1({ ...frozen, session, state, participants, sequence: state.lastSequence + 1 }, input, false);
  const { cycle, work } = locateTtrpgOpenConsequenceEffectV1(runtime, input.operationKey, input.cycleKey, input.workKey, owner);
  if (cycle.contentHash !== await hashProductProductionValueV2(frozen.ttrpgContent) || stableJson(cycle.frozenContent) !== stableJson(frozen.ttrpgContent)) throw new Error('[ttrpg-pressure] 后果冻结来源已经变化。');
  return prepareTtrpgOpenPressureEffectReviewV1({ state, runtime, cycle, work, request: input.request, epochKey: epoch.epochKey, viewerKey: input.viewerKey });
}


/** Stakeholders see their own concrete effects and an opaque risk binding, never the GM mechanical snapshot. */
export async function readTtrpgOpenPressureEffectApprovalViewV1(input: TtrpgOpenPressureEffectLocatorV1 & { actorKey: string }, owner: 'pressure' | 'situations' | 'stage' = 'pressure') {
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error('[ttrpg-pressure] 团局不存在。');
  const state = await readProductRuntimeState(input.sessionId), participants = await readTtrpgSessionParticipantsV2(input.sessionId), frozen = await verifyFormalTtrpgSource(session);
  const { runtime, seat, epoch } = await openOperationCallerV1({ ...frozen, state, session, participants, sequence: state.lastSequence + 1 }, input, false);
  const { cycle, work } = locateTtrpgOpenConsequenceEffectV1(runtime, input.operationKey, input.cycleKey, input.workKey, owner), review = currentTtrpgOpenPressureEffectReviewV1(work);
  const required = review?.requiredApprovals.find(a => a.actorKey === input.actorKey);
  if (!review || !required?.allowedSeatKeys.includes(seat.seatKey)) throw new Error('[ttrpg-pressure] 只能读取本人或明确授权队友的压力后果。');
  const { effects } = ttrpgOpenPressureEffectDefinitionV1({ state, runtime, cycle, work, request: review.request });
  return { reviewKey: review.reviewKey, riskHash: review.riskHash, actorKey: input.actorKey, revision: review.revision, status: review.status,
    canApprove: runtime.product.safety.status === 'active' && review.status === 'awaiting-approval'
      && ttrpgOpenPressureEffectReviewCurrentV1(state, runtime, epoch.epochKey, review) && !review.decisions.some(d => d.actorKey === input.actorKey),
    effects: input.actorKey === 'gm' ? effects : effects.filter(effect => effect.targetRef === input.actorKey),
  };
}

export async function proposeTtrpgOpenPressureEffectV1(input: TtrpgOpenOperationCommandV1 & { cycleKey: string; workKey: string; request: TtrpgOpenPressureEffectRequestV1; riskHash: string; reviewKey: string }, owner: 'pressure' | 'situations' | 'stage' = 'pressure'): Promise<ProductRuntimeEvent> {
  const request = parseTtrpgOpenPressureEffectRequestV1(input.request);
  const envelope = await openOperationEnvelopeV1(input, `${owner}.work.${input.workKey}.${input.reviewKey}.propose`);
  return appendFormalTtrpgCommand({ ...envelope, type: owner === 'pressure' ? 'ttrpg.open.pressure.effect.confirmed' : owner === 'stage' ? 'ttrpg.open.stage.effect.confirmed' : 'ttrpg.open.situations.effect.confirmed',
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, cycleKey: input.cycleKey, workKey: input.workKey, viewerKey: input.viewerKey,
      request, riskHash: input.riskHash, reviewKey: input.reviewKey, actorKey: 'gm', decision: 'approve' },
    build: async context => {
      const { runtime, epoch, seat } = await openOperationCallerV1(context, input, false);
      const { cycle, work } = locateTtrpgOpenConsequenceEffectV1(runtime, input.operationKey, input.cycleKey, input.workKey, owner);
      if (cycle.contentHash !== await hashProductProductionValueV2(context.ttrpgContent) || cycle.runtimeSourceHash !== context.session.runtimeSourceHash) throw new Error('[ttrpg-pressure] 后果来源已 stale。');
      const review = await prepareTtrpgOpenPressureEffectReviewV1({ state: context.state, runtime, cycle, work, request, epochKey: epoch.epochKey, viewerKey: input.viewerKey });
      if (review.riskHash !== input.riskHash || review.reviewKey !== input.reviewKey) throw new Error('[ttrpg-pressure] 真人选择的后果风险或修订已变化。');
      return { actorKey: seat.actorKey, targetKey: null, payload: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, cycleKey: cycle.cycleKey,
        workKey: work.workKey, causeRef: work.causeRef, review, actorKey: 'gm', decision: 'approve', proposed: true } };
    },
  });
}

export async function confirmTtrpgOpenPressureEffectV1(input: TtrpgOpenOperationCommandV1 & { cycleKey: string; workKey: string; riskHash: string; reviewKey: string; actorKey: string; decision: 'approve' | 'reject' }, owner: 'pressure' | 'situations' | 'stage' = 'pressure'): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, `${owner}.work.${input.workKey}.${input.reviewKey}.approval.${input.actorKey}`);
  return appendFormalTtrpgCommand({ ...envelope, type: owner === 'pressure' ? 'ttrpg.open.pressure.effect.confirmed' : owner === 'stage' ? 'ttrpg.open.stage.effect.confirmed' : 'ttrpg.open.situations.effect.confirmed',
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, cycleKey: input.cycleKey, workKey: input.workKey, viewerKey: input.viewerKey,
      riskHash: input.riskHash, reviewKey: input.reviewKey, actorKey: input.actorKey, decision: input.decision },
    build: async context => {
      const { runtime, seat } = await openOperationCallerV1(context, input, false);
      const { cycle, work } = locateTtrpgOpenConsequenceEffectV1(runtime, input.operationKey, input.cycleKey, input.workKey, owner), review = currentTtrpgOpenPressureEffectReviewV1(work);
      if (!review || review.reviewKey !== input.reviewKey || review.riskHash !== input.riskHash) throw new Error('[ttrpg-pressure] 压力后果风险或修订已变化。');
      return { actorKey: seat.actorKey, targetKey: null, payload: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, cycleKey: cycle.cycleKey,
        workKey: work.workKey, causeRef: work.causeRef, review, actorKey: input.actorKey, decision: input.decision, proposed: false } };
    },
  });
}

export async function applyTtrpgOpenPressureEffectV1(input: TtrpgOpenOperationCommandV1 & { cycleKey: string; workKey: string; reviewKey: string }, owner: 'pressure' | 'situations' | 'stage' = 'pressure'): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, `${owner}.work.${input.workKey}.${input.reviewKey}.apply`);
  return appendFormalTtrpgCommand({ ...envelope, type: owner === 'pressure' ? 'ttrpg.open.pressure.effect.applied' : owner === 'stage' ? 'ttrpg.open.stage.effect.applied' : 'ttrpg.open.situations.effect.applied',
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, cycleKey: input.cycleKey, workKey: input.workKey, viewerKey: input.viewerKey, reviewKey: input.reviewKey },
    build: async context => {
      const { runtime, seat, epoch } = await openOperationCallerV1(context, input);
      const { cycle, work } = locateTtrpgOpenConsequenceEffectV1(runtime, input.operationKey, input.cycleKey, input.workKey, owner), review = currentTtrpgOpenPressureEffectReviewV1(work);
      if (!review || review.reviewKey !== input.reviewKey || review.status !== 'approved' || review.authorizationHash !== epoch.authorizationHash
        || !ttrpgOpenPressureEffectReviewCurrentV1(context.state, runtime, epoch.epochKey, review)) throw new Error('[ttrpg-pressure] 压力后果未获全部真人批准或已 stale。');
      if (cycle.contentHash !== await hashProductProductionValueV2(context.ttrpgContent) || cycle.runtimeSourceHash !== context.session.runtimeSourceHash) throw new Error('[ttrpg-pressure] 后果冻结来源已变化。');
      const effectPlan = createTtrpgOpenPressureEffectPlanV1({ state: context.state, runtime, cycle, work, review, commandId: envelope.commandId });
      // Same existing deterministic effect kernel, so an impossible cost aborts the complete formal transaction.
      settleTtrpgOpenPressureEffectPlanV1({ state: context.state, cycle, plan: effectPlan, sequence: context.sequence });
      return { actorKey: seat.actorKey, targetKey: null, payload: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, cycleKey: cycle.cycleKey,
        workKey: work.workKey, causeRef: work.causeRef, reviewKey: review.reviewKey, effectPlan } };
    },
  });
}

/** Consume only a typed actual front consequence; real gates/identity/terminal are retained. */
export async function completeTtrpgOpenPressureSituationV1(input: TtrpgOpenOperationCommandV1 & { cycleKey: string; workKey: string }): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, `pressure.work.${input.workKey}.situation`);
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.pressure.situation.completed',
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, cycleKey: input.cycleKey, workKey: input.workKey, viewerKey: input.viewerKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input);
      const { cycle, work } = locateTtrpgOpenPressureEffectV1(runtime, input.operationKey, input.cycleKey, input.workKey);
      if (cycle.contentHash !== await hashProductProductionValueV2(context.ttrpgContent) || cycle.runtimeSourceHash !== context.session.runtimeSourceHash) throw new Error('[ttrpg-situation] 局势后果冻结来源已变化。');
      const instanceKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'situation', [work.situationTemplateKey ?? 'invalid', String(context.sequence)]);
      const { result } = settleTtrpgOpenSituationWorkV1({ state: context.state, cycle, work, actorKey: operation.plan.request.actorKey, sequence: context.sequence, instanceKey, recordRejection: true });
      return { actorKey: 'gm', targetKey: work.situationTemplateKey, payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash,
        cycleKey: cycle.cycleKey, workKey: work.workKey, causeRef: work.causeRef, instanceKey, result, recordRejection: true } };
    },
  });
}

/** Human-authorized frozen warning, emitted before the action it warns about. */
export async function telegraphTtrpgOpenFrontV1(input: FormalTtrpgCommandEnvelope & { viewerKey: string; frontKey: string; telegraphKey: string }): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'signal viewer'), frontKey = openKey(input.frontKey, 'signal front'), telegraphKey = openKey(input.telegraphKey, 'signal key');
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  if (!runtime) throw new Error('[ttrpg-pressure] 征兆需要 open 团局。');
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'pressure-signal', [frontKey, telegraphKey]);
  if (input.commandId !== commandId) throw new Error('[ttrpg-pressure] 征兆命令必须使用确定性 key。');
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first();
  const envelope = prior ? { ...input, baseSequence: prior.baseSequence!, baseStateHash: prior.baseStateHash! } : input;
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.front.telegraphed', intent: { viewerKey, frontKey, telegraphKey },
    build: async context => {
      const { runtime } = await openModelCallCallerV1(context, viewerKey, true), content = requireTtrpgOpenContent(context.ttrpgContent);
      assertTtrpgOpenPressureGmV1(runtime.authorization!, viewerKey);
      const definition = content.campaign.fronts.find(f => f.frontKey === frontKey)?.telegraph.find(t => t.telegraphKey === telegraphKey);
      if (!definition) throw new Error('[ttrpg-pressure] 冻结征兆不存在。');
      const signal = parseTtrpgOpenPressureSignalV1({ sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, frontKey, telegraphKey,
        worldTurn: runtime.openRun!.worldTime.worldTurn, audience: definition.audience, recipientActorKeys: runtime.authorization!.selectedActorKeys,
        signalText: definition.signalText, frozenContent: content, contentHash: await hashProductProductionValueV2(content), runtimeSourceHash: context.session.runtimeSourceHash });
      return { actorKey: 'gm', targetKey: null, payload: { signal } };
    },
  });
}

/** One explicit deterministic pressure action; the coordinator never runs from a state read. */
export async function advanceTtrpgOpenPressureV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const current = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  const operation = current?.openRun?.operations.find(o => o.operationKey === input.operationKey);
  const receipt = current?.openRun?.ruleReceipts.find(r => r.operationKey === input.operationKey);
  if (!current || !operation || !receipt || operation.planHash !== input.frozenPlanHash) throw new Error('[ttrpg-pressure] 操作或真实检定不存在。');
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, input.commandId]).first();
  const priorActionKey = prior ? pressureParse.key(pressureParse.object(parseEventPayload(prior).intent, 'pressure prior intent').actionKey, 'pressure prior action') : null;
  const stepKey = nextTtrpgOpenOperationStepV1(operation)?.kind === 'pressure' ? ttrpgOpenTurnOwnerStepV1(operation,'pressure') : 'pressure';
  const cycle = current.openRun!.pressureCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,operation,ttrpgOpenPressureRuleSourceV1(receipt),'pressure'));
  const action = cycle ? nextTtrpgOpenPressureActionV1(await readProductRuntimeState(input.sessionId), cycle) : null;
  const actionKey = priorActionKey ?? (!cycle ? `${stepKey}.plan` : action ? pressureActionKeyV1(action,stepKey) : `${stepKey}.settled`);
  const envelope = await openOperationEnvelopeV1(input, actionKey);
  const type = prior ? pressureParse.oneOf(prior.type, ['ttrpg.open.pressure.planned', 'ttrpg.open.pressure.settled', 'ttrpg.clock.ticked', 'ttrpg.front.telegraphed', 'ttrpg.front.advanced', 'ttrpg.front.defeated'], 'pressure prior type') : !cycle ? 'ttrpg.open.pressure.planned' : !action ? 'ttrpg.open.pressure.settled'
    : action.kind === 'tick' ? 'ttrpg.clock.ticked' : action.kind === 'telegraph' ? 'ttrpg.front.telegraphed' : action.kind === 'advance' ? 'ttrpg.front.advanced' : 'ttrpg.front.defeated';
  return appendFormalTtrpgCommand({ ...envelope, type,
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, actionKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input);
      const run = runtime.openRun!, content = requireTtrpgOpenContent(context.ttrpgContent), receipt = run.ruleReceipts.find(r => r.operationKey === operation.operationKey)!;
      if (operation.status !== 'executing' || nextTtrpgOpenOperationStepV1(operation)?.kind !== 'pressure') throw new Error('[ttrpg-pressure] 压力只能接在真实机械、知识与耗时之后。');
      const ownerStep = ttrpgOpenTurnOwnerStepV1(operation,'pressure');
      const common = { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, stepKey: ownerStep, causeRef: receipt.sourceRef };
      const actualCycle = run.pressureCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,operation,ttrpgOpenPressureRuleSourceV1(receipt),'pressure'));
      if (!actualCycle) {
        if (actionKey !== `${ownerStep}.plan`) throw new Error('[ttrpg-pressure] 压力计划已变化。');
        const cycle = parseTtrpgOpenPressureCycleV1({ ...ttrpgOpenSituationCatalogSnapshotV1(content.campaign, run), ...ttrpgOpenTurnCycleMetadataV1(operation,'pressure'),cycleKey: await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'pressure', [receipt.sourceRef.sessionKey, String(receipt.sourceRef.sequence),...(operation.settlementOrder ? [ownerStep] : [])]),
          ruleSourceRef: ttrpgOpenPressureRuleSourceV1(receipt), startedRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, frozenContent: content,
          contentHash: await hashProductProductionValueV2(content), runtimeSourceHash: context.session.runtimeSourceHash,
          ...planTtrpgOpenPressureTicksV1({ state: context.state, operation, receipt, content }), tickRefs: [], frontReceipts: [], work: [], completedRef: null });
        return { actorKey: 'gm', targetKey: null, payload: { ...common, cycle } };
      }
      if (actualCycle.runtimeSourceHash !== context.session.runtimeSourceHash || actualCycle.contentHash !== await hashProductProductionValueV2(content)
        || stableJson(actualCycle.frozenContent) !== stableJson(content)) throw new Error('[ttrpg-pressure] 冻结压力来源已变化。');
      const actualAction = nextTtrpgOpenPressureActionV1(context.state, actualCycle);
      if ((actualAction ? pressureActionKeyV1(actualAction,ownerStep) : `${ownerStep}.settled`) !== actionKey) throw new Error('[ttrpg-pressure] 待执行压力动作已变化。');
      if (!actualAction) {
        if (actualCycle.work.some(w => !w.completedRef)) throw new Error('[ttrpg-pressure] 必須先完成明确的后果 owner，不能空过压力步骤。');
        return { actorKey: 'gm', targetKey: null, payload: { ...common, cycleKey: actualCycle.cycleKey } };
      }
      let result;
      const projection = ttrpgOpenPressureRuntimeProjectionV1(context.state);
      if (actualAction.kind === 'tick') result = actualCycle.tickQueue[actualAction.tickIndex];
      else {
        const front = content.campaign.fronts.find(f => f.frontKey === actualAction.frontKey)!, frontState = projection.fronts[front.frontKey];
        if (actualAction.kind === 'telegraph') {
          const signal = front.telegraph.find(t => t.telegraphKey === actualAction.telegraphKey)!;
          result = { ...evaluateTtrpgFrontTelegraphV1({ front, frontState, telegraphKey: signal.telegraphKey, audience: signal.audience, worldTime: run.worldTime }),
            signalText: signal.signalText, recipientActorKeys: [...runtime.authorization!.selectedActorKeys] };
        } else if (actualAction.kind === 'advance') result = evaluateTtrpgFrontAdvanceV1({ front, frontState, clockStates: projection.clocks, stageKey: actualAction.stageKey, worldTime: run.worldTime });
        else result = evaluateTtrpgFrontDefeatV1({ front, frontState, predicateContext: ttrpgOpenPredicateContextV1(context.state, content) });
      }
      return { actorKey: 'gm', targetKey: null, payload: { ...common, cycleKey: actualCycle.cycleKey, action: actualAction, result, ...(['advance', 'defeat'].includes(actualAction.kind) ? { recordSituationAction: true } : {}) } };
    },
  });
}

export async function shareTtrpgOpenKnowledgeV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; request: TtrpgOpenKnowledgeShareRequestV1; confirmationHash: string;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'share viewer'), request = parseTtrpgOpenKnowledgeShareRequestV1(input.request), confirmationHash = openHash(input.confirmationHash, 'share confirmation');
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.open.knowledge.shared', intent: { viewerKey, request, confirmationHash },
    build: async context => {
      const content = requireTtrpgOpenContent(context.ttrpgContent), runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg);
      const authorization = runtime?.authorization, run = runtime?.openRun;
      if (!runtime || !authorization || !run) throw new Error('[ttrpg-knowledge] 分享需要完成开局和桌面授权。');
      assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants: context.participants, viewerKey });
      assertTtrpgOpenKnowledgeShareActorV1(authorization, viewerKey, request.actorKey);
      const epoch = run.coordination.epochs.find(epoch => epoch.epochKey === run.coordination.activeEpochKey);
      if (!epoch || epoch.status !== 'active' || epoch.viewerKey !== viewerKey || epoch.authorizationHash !== await hashProductProductionValueV2(authorization)
        || runtime.product.safety.status !== 'active' || run.stage.status !== 'open') throw new Error('[ttrpg-knowledge] 分享需要当前真人窗口且团局未暂停。');
      const source = run.knowledge.find(entry => entry.knowledgeKey === request.sourceKnowledgeKey);
      if (!source || source.publicFieldsHash !== await hashTtrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(content.campaign, runtime.openRun).validationView, source.evidenceRef)
        || confirmationHash !== await hashTtrpgOpenKnowledgeShareConfirmationV1({ request, viewerKey, baseStateHash: input.baseStateHash, runtimeSourceHash: context.session.runtimeSourceHash })) {
        throw new Error('[ttrpg-knowledge] 分享源、公开字段或确认内容已经 stale。');
      }
      const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(runtime, source);
      if (origin.contentHash !== await hashProductProductionValueV2(content) || stableJson(origin.frozenContent) !== stableJson(content)) {
        throw new Error('[ttrpg-knowledge] 知识传播链没有同一真实冻结内容来源。');
      }
      const knowledgeKey = `knowledge.${await hashProductProductionValueV2({ sessionKey: runtime.sessionKey, commandId: input.commandId, sourceKnowledgeKey: source.knowledgeKey })}`;
      const knowledge = createTtrpgOpenSharedKnowledgeV1({ request, source, authorization, knowledgeKey,
        acquisitionRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, privateChannelsAllowed: content.campaign.informationPolicy.interPlayerWhispers });
      const receipt = parseTtrpgOpenKnowledgeShareReceiptV1({ sourceKnowledgeKey: source.knowledgeKey, sourceAcquisitionRef: source.acquisitionRef,
        sharedByActorKey: request.actorKey, viewerKey, authorizationEpochKey: epoch.epochKey, confirmationHash, knowledge });
      return { actorKey: request.actorKey, targetKey: null, payload: { receipt, privateChannelsAllowed: content.campaign.informationPolicy.interPlayerWhispers } };
    },
  });
}

/** Human review of semantic identities; no rule action, model call or world-time advancement. */
export async function confirmTtrpgOpenIdentityKnowledgeV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; submissionKey: string; request: TtrpgOpenIdentityKnowledgeRequestV1; confirmationHash: string
}): Promise<{ sequence: number; knowledgeKey: string }> {
  const viewerKey = openKey(input.viewerKey, 'identity viewer'), submissionKey = openKey(input.submissionKey, 'identity submission')
  const request = parseTtrpgOpenIdentityKnowledgeRequestV1(input.request), confirmationHash = openHash(input.confirmationHash, 'identity confirmation')
  request.entityRefs.sort(); request.recipientActorKeys.sort()
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (!runtime?.openRun) throw new Error('[ttrpg-knowledge] 身份确认需要有效 open 团局')
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'identity-control', [viewerKey, submissionKey])
  const knowledgeKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'identity-grant', [viewerKey, submissionKey])
  const event = await appendFormalTtrpgCommand({ ...input, commandId, type: ttrpgOpenIdentityKnowledgeEventV1(request.mode),
    intent: { viewerKey, request, submissionKey, confirmationHash }, build: async context => {
      requireTtrpgOpenContent(context.ttrpgContent)
      const current = parseTtrpgRuntimeStateV2(context.state.ttrpg)
      if (!current?.authorization || !current.openRun) throw new Error('[ttrpg-knowledge] 缺少当前开团授权')
      assertTtrpgOpenAuthorizationCurrentV1({ authorization: current.authorization, participants: context.participants, viewerKey })
      const events = await readSessionEvents(context.session), canonical = replayProductRuntimeEvents(parseProductRuntimeState(context.session.initialStateJson), events)
      if (stableJson(canonical) !== stableJson(context.state)) throw new Error('[ttrpg-knowledge] 原事件与缓存不一致，请核对原进度')
      await verifyTtrpgOpenIdentityKnowledgeV1({ runtime: current, runtimeSourceHash: context.session.runtimeSourceHash, events })
      const source = current.openRun.knowledge.find(row => row.knowledgeKey === request.sourceKnowledgeKey)
      const epoch = current.openRun.coordination.epochs.find(row => row.epochKey === current.openRun!.coordination.activeEpochKey)
      if (!source || epoch?.authorizationHash !== await hashProductProductionValueV2(current.authorization)) throw new Error('[ttrpg-knowledge] 原知识或本人窗口已变化')
      const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(current, source)
      if (stableJson(origin.frozenContent) !== stableJson(context.ttrpgContent) || origin.contentHash !== await hashProductProductionValueV2(context.ttrpgContent)) throw new Error('[ttrpg-knowledge] 识别源没有同一冻结内容')
      const knowledge = createTtrpgOpenIdentityKnowledgeV1({ runtime: current, runtimeSourceHash: context.session.runtimeSourceHash, viewerKey, request,
        acquisitionRef: { sessionKey: current.sessionKey, sequence: context.sequence }, knowledgeKey, sourceKnowledgeHash: await hashProductProductionValueV2(source),
        submissionKey, baseStateHash: input.baseStateHash, confirmationHash })
      if (confirmationHash !== await hashTtrpgOpenIdentityKnowledgeConfirmationV1(knowledge)) throw new Error('[ttrpg-knowledge] 这次识别内容或接收范围已 stale，请重新核对')
      return { actorKey: request.actorKey, targetKey: null, payload: ttrpgOpenIdentityKnowledgePayloadV1(knowledge), eventEvidence: events }
    } })
  return { sequence: event.sequence, knowledgeKey }
}

export async function completeTtrpgOpenOperationV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, "completed");
  return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.open.operation.completed",
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey },
    build: async context => {
      const { operation } = await openOperationCallerV1(context, input);
      if (nextTtrpgOpenOperationStepV1(operation)) throw new Error("[ttrpg] 必需 owner/业务步骤仍未完成。");
      return { actorKey: operation.plan.request.actorKey, targetKey: operation.plan.request.targetKey,
        payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash } };
    },
  });
}

export async function advanceTtrpgWorldTurnV1(
  input: FormalTtrpgCommandEnvelope & {
    reason:
      | "game-action"
      | "ai-companion-action"
      | "idle-tick"
      | "front-escalation"
      | "situation-maintenance"
      | "stage-close";
    operationKey?: string;
    frozenPlanHash?: string;
    viewerKey?: string;
    stepKey?: string;
  },
): Promise<ProductRuntimeEvent> {
  if (input.operationKey && input.frozenPlanHash && input.viewerKey && input.stepKey) {
    const operationInput: TtrpgOpenOperationCommandV1 = { ...input, operationKey: input.operationKey,
      frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey };
    const envelope = await openOperationEnvelopeV1(operationInput, input.stepKey);
    return appendFormalTtrpgCommand({ ...envelope, type: "ttrpg.world-turn.advanced",
      intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, stepKey: input.stepKey, reason: input.reason },
      build: async context => {
        const { operation } = await openOperationCallerV1(context, operationInput);
        const step = nextTtrpgOpenOperationStepV1(operation);
        const ruleCauseRef = ttrpgOpenOperationRuleCauseV1(operation);
        if (!step || step.kind !== "time" || step.stepKey !== input.stepKey || !ruleCauseRef) throw new Error("[ttrpg] 世界耗时缺少已结算行动和冻结步骤。");
        return { actorKey: operation.plan.request.actorKey, targetKey: operation.plan.request.targetKey,
          payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, stepKey: step.stepKey,
            causeRef: ruleCauseRef, byEventSequence: ruleCauseRef.sequence, tickIndex: step.tickIndex, reason: input.reason, recordPressureTurn: true } };
      },
    });
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.world-turn.advanced",
    intent: { reason: input.reason },
    build: async () => {
      throw new Error("[ttrpg] 世界时间推进必须引用已结算 operation；因果耗时入口尚在施工，禁止直接 tick。");
    },
  });
}

export async function changeTtrpgSituationV1(
  input: FormalTtrpgCommandEnvelope & {
    templateKey: string;
    activationReason: "opening" | "front-escalation" | "consequence";
    mode: "activated" | "queued" | "auto";
    viewerKey?: string;
  },
): Promise<ProductRuntimeEvent> {
  const templateKey = input.templateKey.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.situation.changed",
    intent: {
      templateKey,
      activationReason: input.activationReason,
      mode: input.mode,
      ...(input.viewerKey ? { viewerKey: input.viewerKey } : {}),
    },
    build: async ({ state, sequence, ttrpgContent, participants, session }) => {
      const content = requireTtrpgOpenContent(ttrpgContent);
      const runtime = parseTtrpgRuntimeStateV2(state.ttrpg);
      if (!runtime?.authorization || !runtime.openRun) throw new Error('[ttrpg-situation] 开局局势需要真实 Session Zero 与运行开始授权。');
      const openRun = runtime.openRun, viewerKey = input.viewerKey ?? runtime.authorization.viewerKey;
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants, viewerKey });
      if (viewerKey !== runtime.authorization.viewerKey || openRun.operations.length || openRun.worldTime.worldTurn !== 0 || runtime.branchLineage || input.activationReason !== 'opening'
        || !content.campaign.openingSituationKeys.includes(templateKey)) throw new Error('[ttrpg-situation] 此旧入口仅用于获授权开局；威胁和后果必须走真实待办 owner。');
      const template = content.campaign.situationTemplates.find(
        (item) => item.templateKey === templateKey,
      );
      if (!template) throw new Error("[ttrpg] 局势模板不属于冻结 Campaign。");
      let mustQueue = false;
      try { assertTtrpgSituationInstanceGatesV1({ template, actorKey: ttrpgOpenSituationProjectionActorV1(runtime, seat.actorKey), worldTurn: openRun.worldTime.worldTurn,
        predicateContext: ttrpgOpenSituationGateContextV1(state, content, ttrpgOpenSituationProjectionActorV1(runtime, seat.actorKey)), activeInstances: openRun.situations.active,
        cooldownUntilWorldTurn: openRun.situations.cooldowns, templateContext: content.campaign, rulePack: content.rulePack.content }); }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (/I[1-5]:/.test(reason) || !/I[67]:/.test(reason)) throw error;
        mustQueue = true;
      }
      if (input.mode !== 'auto' && input.mode !== (mustQueue ? 'queued' : 'activated')) throw new Error('[ttrpg-situation] 局势队列状态必须来自真实容量或冷却约束。');
      const instanceKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'situation', [templateKey, String(sequence)]);
      const situation = instantiateTtrpgSituationV1({
        template,
        activatedAtSequence: sequence,
        activatedAtWorldTurn: openRun.worldTime.worldTurn,
        activationReason: input.activationReason,
      });
      const mode = mustQueue ? 'queued' : 'activated';
      if (mode === "activated" && openRun.situations.active.length >= 5) {
        throw new Error("[ttrpg] 活跃局势已达到 5 个上限。");
      }
      const queuePosition =
        mode === "queued"
          ? openRun.situations.queued.reduce(
              (maximum, item) =>
                Math.max(maximum, item.queuePosition ?? -1),
              -1,
            ) + 1
          : null;
      const runtimeSituation: TtrpgOpenSituationRuntimeStateV1 = {
        ...situation,
        situationKey: instanceKey,
        status: mode === "activated" ? "active" : "queued",
        queuePosition,
      };
      return {
        actorKey: null,
        targetKey: templateKey,
        payload: {
          mode,
          situation: runtimeSituation,
          admission: { frozenContent: content, runtimeSourceHash: session.runtimeSourceHash, viewerKey, actorKey: seat.actorKey },
        },
      };
    },
  });
}

export async function recordTtrpgOpenFailureV1(
  input: FormalTtrpgCommandEnvelope & {
    category: TtrpgOpenFailureCategoryV1;
    violatedRule: string;
    failureKey?: string;
  },
): Promise<ProductRuntimeEvent> {
  const violatedRule = input.violatedRule.trim();
  const failureKey = (input.failureKey ?? input.commandId).trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.open.failure.logged",
    intent: {
      category: input.category,
      violatedRule,
      failureKey,
    },
    build: async ({ state, sequence }) => {
      const openRun = readOpenRunFromState(state);
      const failure: TtrpgOpenFailureRuntimeStateV1 = {
        failureKey,
        atSequence: sequence,
        atWorldTurn: openRun.worldTime.worldTurn,
        category: input.category,
        violatedRule,
      };
      return {
        actorKey: null,
        targetKey: null,
        payload: { failure },
      };
    },
  });
}

export async function customizeTtrpgPlayerCharacterV1(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    name: string;
    description: string;
    attributes: Record<string, number>;
    identity?: Partial<TtrpgCharacterSheetV2["identity"]>;
  },
): Promise<ProductRuntimeEvent> {
  const characterKey = input.characterKey.trim();
  const name = input.name.trim().normalize("NFC");
  const description = input.description.trim().normalize("NFC");
  const attributes = Object.fromEntries(
    Object.entries(input.attributes).map(([key, value]) => [
      key.trim(),
      Number(value),
    ]),
  );
  if (
    !characterKey ||
    !name ||
    name.length > 300 ||
    !description ||
    description.length > 20_000 ||
    Object.keys(attributes).some(
      (key) => !key || !Number.isFinite(attributes[key]),
    )
  ) {
    throw new Error("[ttrpg] 角色创建器输入无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.character.customized",
    intent: { characterKey, name, description, attributes },
    build: async ({ state, rulePack, campaign }) => {
      if (campaign.version === 2 && parseTtrpgRuntimeStateV2(state.ttrpg)?.branchLineage?.ancestors.some(ancestor => ancestor.snapshot.openRun !== null)) {
        throw new Error('[ttrpg-open-branch] 已运行分支保留原机械状态，不能用开局角色创建器覆盖');
      }
      const product = state.ttrpg?.product;
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === characterKey && item.role === "player",
      );
      if (
        !product ||
        product.sessionZero.completed ||
        state.ttrpg?.scene ||
        !template
      ) {
        throw new Error("[ttrpg] 只能在 Session Zero 前定制冻结玩家角色。");
      }
      const expectedKeys = rulePack.attributes.map(
        (attribute) => attribute.key,
      );
      if (
        Object.keys(attributes).length !== expectedKeys.length ||
        expectedKeys.some(
          (key) => !Object.prototype.hasOwnProperty.call(attributes, key),
        )
      ) {
        throw new Error("[ttrpg] 角色创建器必须填写全部规则属性。");
      }
      for (const attribute of rulePack.attributes) {
        const value = attributes[attribute.key];
        if (
          !Number.isInteger(value) ||
          value < attribute.minimum ||
          value > attribute.maximum
        ) {
          throw new Error(
            `[ttrpg] ${attribute.name} 必须在 ${attribute.minimum}–${attribute.maximum} 之间。`,
          );
        }
      }
      const frozenBudget = rulePack.attributes.reduce(
        (sum, attribute) => sum + template.attributes[attribute.key],
        0,
      );
      const allocatedBudget = rulePack.attributes.reduce(
        (sum, attribute) => sum + attributes[attribute.key],
        0,
      );
      if (allocatedBudget !== frozenBudget) {
        throw new Error(
          `[ttrpg] 属性点必须保持 ${frozenBudget} 点；当前为 ${allocatedBudget} 点。`,
        );
      }
      const derived = Object.fromEntries(
        rulePack.derivedStats.map((stat) => {
          let value = evaluateRuleNumberExpressionV1(stat.formula, attributes);
          if (stat.minimum != null) value = Math.max(stat.minimum, value);
          if (stat.maximum != null) value = Math.min(stat.maximum, value);
          return [stat.key, value];
        }),
      );
      const maximums = Object.fromEntries(
        rulePack.resources.map((resource) => [
          resource.key,
          evaluateRuleNumberExpressionV1(resource.maximumFormula, attributes),
        ]),
      );
      const resources = Object.fromEntries(
        rulePack.resources.map((resource) => [
          resource.key,
          resource.initialMode === "maximum"
            ? maximums[resource.key]
            : resource.minimum,
        ]),
      );
      const entityAttributes = {
        identity: description,
        ...attributes,
        ...derived,
        ...Object.fromEntries(
          Object.entries(resources).map(([key, value]) => [
            `resource.${key}`,
            value,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(maximums).map(([key, value]) => [
            `resourceMax.${key}`,
            value,
          ]),
        ),
        hp: resources.vigor ?? 1,
        maxHp: maximums.vigor ?? resources.vigor ?? 1,
        armorClass: derived.defense ?? 8,
        initiative:
          attributes[rulePack.turnStructure.initiativeAttributeKey] ?? 0,
      };
      const { characterSheet: _frozenSheet, ...templateWithoutSheet } =
        template;
      const effectiveTemplate = {
        ...templateWithoutSheet,
        name,
        description,
        attributes,
      };
      const previousIdentity: Partial<TtrpgCharacterSheetV2["identity"]> =
        template.characterSheet?.identity ?? {};
      const characterSheet = createCompleteTtrpgCharacterSheetV2({
        template: effectiveTemplate,
        rulePack,
        authoringMode: "manual",
        progression: template.characterSheet?.rules.progression,
        identity: {
          ...structuredClone(previousIdentity),
          ...structuredClone(input.identity ?? {}),
          name,
          background: input.identity?.background ?? description,
          appearance:
            input.identity?.appearance ??
            previousIdentity.appearance ??
            description,
        },
      });
      return {
        actorKey: characterKey,
        targetKey: characterKey,
        payload: {
          characterKey,
          name,
          description,
          attributes,
          entityAttributes,
          characterSheet,
        },
      };
    },
  });
}

export async function advanceTtrpgCharacterV1(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    kind: "attribute" | "skill" | "level" | "rank";
    targetKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const characterKey = input.characterKey.trim();
  const targetKey = input.targetKey.trim();
  if (
    !characterKey ||
    !targetKey ||
    !["attribute", "skill", "level", "rank"].includes(input.kind)
  ) {
    throw new Error("[ttrpg] 角色成长请求无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.character.advanced",
    intent: { characterKey, kind: input.kind, targetKey },
    build: async ({ state, rulePack, campaign }) => {
      const product = state.ttrpg?.product;
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === characterKey && item.role === "player",
      );
      const progression = product?.characterProgression?.[characterKey];
      const entity = state.entities[characterKey];
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        product.safety.status !== "active" ||
        !product.sessionZero.selectedCharacterKeys.includes(characterKey) ||
        !template ||
        !progression ||
        !entity
      ) {
        throw new Error(
          "[ttrpg] 只有已开团、未结局且安全状态正常的本局玩家角色可以成长。",
        );
      }
      const available = availableTtrpgCharacterCurrencyV2(
        product,
        characterKey,
      );
      let cost: number;
      let before: number | string;
      let after: number | string;
      const entityAttributes: Record<string, string | number | boolean | null> =
        {};
      if (input.kind === "attribute") {
        if (!["point-buy", "classless"].includes(progression.model)) {
          throw new Error(
            "[ttrpg] 当前成长模式不能直接购买属性；请使用等级或阶位成长。",
          );
        }
        const definition = rulePack.attributes.find(
          (item) => item.key === targetKey,
        );
        const current = entity.attributes[targetKey];
        const maximum = definition
          ? Math.min(
              definition.maximum,
              rulePack.advancement.maximumAttributeValue,
            )
          : null;
        if (
          !definition ||
          typeof current !== "number" ||
          maximum == null ||
          current >= maximum
        ) {
          throw new Error("[ttrpg] 属性不存在或已达到规则上限。");
        }
        cost = rulePack.advancement.attributeIncreaseCost;
        before = current;
        after = current + 1;
        entityAttributes[targetKey] = after;
      } else if (input.kind === "skill") {
        if (progression.model === "rank")
          throw new Error("[ttrpg] 阶位制角色必须先按阶位规则成长。");
        const base = template.skills[targetKey];
        if (typeof base !== "number")
          throw new Error("[ttrpg] 只能提高冻结角色卡上已有的技能。");
        before = base + (progression.skillIncreases[targetKey] ?? 0);
        const maximum = rulePack.advancement.maximumSkillValue ?? 10;
        if (before >= maximum) throw new Error("[ttrpg] 技能已达到规则上限。");
        cost =
          rulePack.advancement.skillIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        after = before + 1;
      } else if (input.kind === "level") {
        if (progression.model !== "numeric-level" || progression.level == null)
          throw new Error("[ttrpg] 当前角色不是等级制成长。");
        if (progression.level >= (rulePack.advancement.maximumLevel ?? 20))
          throw new Error("[ttrpg] 角色已达到等级上限。");
        cost =
          rulePack.advancement.levelIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        before = progression.level;
        after = progression.level + 1;
      } else {
        if (progression.model !== "rank" || progression.rankKey == null)
          throw new Error("[ttrpg] 当前角色不是阶位制成长。");
        const order = rulePack.advancement.rankOrder?.length
          ? rulePack.advancement.rankOrder
          : ["D", "C", "B", "A"];
        const index = order.indexOf(progression.rankKey);
        if (index < 0 || index >= order.length - 1)
          throw new Error("[ttrpg] 角色已达到最高阶位。");
        cost =
          rulePack.advancement.rankIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        before = progression.rankKey;
        after = order[index + 1];
        const rankPower = entity.attributes.rankPower;
        if (typeof rankPower === "number")
          entityAttributes.rankPower = rankPower + 1;
      }
      if (available < cost) {
        throw new Error(
          `[ttrpg] ${product.advancement.currencyName}不足：需要 ${cost}，当前可用 ${available}。`,
        );
      }
      if (
        Object.keys(entityAttributes).some((field) =>
          rulePack.attributes.some((attribute) => attribute.key === field),
        )
      ) {
        const effectiveAttributes = Object.fromEntries(
          [...rulePack.attributes, ...rulePack.derivedStats].map(
            (attribute) => [
              attribute.key,
              typeof entityAttributes[attribute.key] === "number"
                ? Number(entityAttributes[attribute.key])
                : Number(entity.attributes[attribute.key]),
            ],
          ),
        );
        for (const stat of rulePack.derivedStats) {
          let value = evaluateRuleNumberExpressionV1(
            stat.formula,
            effectiveAttributes,
          );
          if (stat.minimum != null) value = Math.max(stat.minimum, value);
          if (stat.maximum != null) value = Math.min(stat.maximum, value);
          entityAttributes[stat.key] = value;
        }
        for (const resource of rulePack.resources) {
          const maximum = evaluateRuleNumberExpressionV1(
            resource.maximumFormula,
            effectiveAttributes,
          );
          const current = Number(entity.attributes[`resource.${resource.key}`]);
          entityAttributes[`resourceMax.${resource.key}`] = maximum;
          entityAttributes[`resource.${resource.key}`] = Math.max(
            resource.minimum,
            Math.min(maximum, current),
          );
        }
        entityAttributes.hp =
          entityAttributes["resource.vigor"] ?? entity.attributes.hp ?? 1;
        entityAttributes.maxHp =
          entityAttributes["resourceMax.vigor"] ?? entity.attributes.maxHp ?? 1;
        entityAttributes.armorClass =
          entityAttributes.defense ?? entity.attributes.armorClass ?? 8;
        entityAttributes.initiative =
          effectiveAttributes[rulePack.turnStructure.initiativeAttributeKey] ??
          0;
      }
      return {
        actorKey: characterKey,
        targetKey: characterKey,
        payload: {
          characterKey,
          kind: input.kind,
          targetKey,
          before,
          after,
          cost,
          entityAttributes,
        },
      };
    },
  });
}

export async function completeTtrpgSessionZero(
  input: FormalTtrpgCommandEnvelope & {
    acceptedItemKeys: string[];
    selectedCharacterKeys?: string[];
    completedBy: string;
  },
): Promise<ProductRuntimeEvent> {
  const acceptedItemKeys = [
    ...new Set(
      input.acceptedItemKeys.map((item) => item.trim()).filter(Boolean),
    ),
  ].sort();
  const requestedCharacterKeys = [
    ...new Set(
      (input.selectedCharacterKeys ?? [])
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const completedBy = input.completedBy.trim();
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (!previewSession) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const { campaign: previewCampaign } =
    await verifyFormalTtrpgSource(previewSession);
  const allPlayerCharacterKeys = previewCampaign.characterTemplates
    .filter((item) => item.role === "player")
    .map((item) => item.characterKey);
  const selectedCharacterKeys = requestedCharacterKeys.length
    ? requestedCharacterKeys
    : allPlayerCharacterKeys;
  const participantRows = await readTtrpgSessionParticipantsV2(input.sessionId);
  const acknowledgedCharacterKeys = participantRows.flatMap((row) =>
    row.role === "player" &&
    row.actorKey != null &&
    row.controller !== "vacant" &&
    row.assignmentState !== "vacant" &&
    row.assignmentState !== "left"
      ? [row.actorKey]
      : [],
  );
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.session-zero.completed",
    intent: { acceptedItemKeys, selectedCharacterKeys, completedBy },
    build: async ({ state, campaign }) => {
      if (campaign.version !== 1) throw new Error("[ttrpg] open 必须使用显式真人授权的 Session Zero 入口。");
      const product = state.ttrpg?.product;
      if (!product || product.sessionZero.completed)
        throw new Error("[ttrpg] Session Zero 已完成或产品状态缺失。");
      if (!completedBy || completedBy.length > 160)
        throw new Error("[ttrpg] Session Zero 完成人无效。");
      if (
        stableJson(acceptedItemKeys) !==
        stableJson([...product.sessionZero.requiredItemKeys].sort())
      ) {
        throw new Error("[ttrpg] 必须确认全部 Session Zero 安全与共识事项。");
      }
      const allowed = new Set(
        campaign.characterTemplates
          .filter((item) => item.role === "player")
          .map((item) => item.characterKey),
      );
      if (
        selectedCharacterKeys.length < campaign.playerCount.minimum ||
        selectedCharacterKeys.length > campaign.playerCount.maximum ||
        selectedCharacterKeys.some((key) => !allowed.has(key))
      ) {
        throw new Error(
          `[ttrpg] 请选择 ${campaign.playerCount.minimum}–${campaign.playerCount.maximum} 名冻结玩家角色。`,
        );
      }
      const selected = new Set(selectedCharacterKeys);
      const activeSeats = participantRows.filter(
        (row) =>
          row.role === "gm" ||
          (row.actorKey != null && selected.has(row.actorKey)),
      );
      if (
        !activeSeats.some((row) => row.role === "gm") ||
        selectedCharacterKeys.some(
          (characterKey) =>
            !activeSeats.some((row) => row.actorKey === characterKey),
        ) ||
        activeSeats.some(
          (row) =>
            row.controller === "vacant" ||
            row.assignmentState === "vacant" ||
            row.assignmentState === "left",
        )
      ) {
        throw new Error(
          "[ttrpg] Session Zero 仍有未认领、空缺或已离席的活动席位。",
        );
      }
      if (
        activeSeats.some(
          (row) =>
            (row.controller === "ai" || row.controller === "hybrid") &&
            !row.consent.aiIdentityDisclosed,
        )
      ) {
        throw new Error(
          "[ttrpg] Session Zero 必须先向全部活动席位披露 AI 身份。",
        );
      }
      return {
        actorKey: completedBy,
        targetKey: product.campaignKey,
        payload: { acceptedItemKeys, selectedCharacterKeys, completedBy },
      };
    },
    afterCommit: async ({ event }) => {
      await finalizeTtrpgSessionParticipantsV2({
        sessionId: input.sessionId,
        // Session Zero acknowledges every configured seat in the frozen
        // roster. The subset in product.sessionZero remains the opening active
        // party; accepted reserve seats can later reinforce a long campaign
        // without inventing consent after play has started. Vacant reserves
        // remain unavailable until a future roster-release workflow.
        selectedCharacterKeys: acknowledgedCharacterKeys,
        eventSequence: event.sequence,
        completedBy,
      });
    },
  });
}

export async function changeTtrpgSafetyStatus(
  input: FormalTtrpgCommandEnvelope & {
    status: "active" | "paused";
    reason?: string | null;
    changedBy: string;
    viewerKey?: string;
  },
): Promise<ProductRuntimeEvent> {
  const changedBy = input.changedBy.trim();
  const reason = input.reason?.trim() || null;
  if (
    !changedBy ||
    changedBy.length > 160 ||
    (input.status === "paused" && !reason) ||
    (reason?.length ?? 0) > 2_000
  ) {
    throw new Error("[ttrpg] 安全状态命令无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.safety.changed",
    intent: { status: input.status, reason, changedBy,
      ...(input.viewerKey === undefined ? {} : { viewerKey: input.viewerKey }) },
    build: async ({ state, ttrpgContent, participants }) => {
      const product = state.ttrpg?.product;
      if (!product?.sessionZero.completed || product.ending)
        throw new Error("[ttrpg] 当前正式战役不能变更安全状态。");
      if (product.safety.status === input.status)
        throw new Error("[ttrpg] 安全状态没有变化。");
      if (ttrpgContent.campaign.version === 2) {
        const runtime = parseTtrpgRuntimeStateV2(state.ttrpg);
        if (!runtime?.authorization) throw new Error("[ttrpg] open 安全工具缺少真人授权。");
        const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization,
          participants, viewerKey: input.viewerKey ?? "" });
        if (![seat.seatKey, seat.actorKey, seat.viewerKey].includes(changedBy)) {
          throw new Error("[ttrpg] open 安全状态更改者与 claimed 真人席位不一致。");
        }
        return { actorKey: changedBy, targetKey: product.campaignKey,
          payload: { status: input.status, reason, changedBy, viewerKey: seat.viewerKey } };
      }
      return {
        actorKey: changedBy,
        targetKey: product.campaignKey,
        payload: { status: input.status, reason, changedBy },
      };
    },
  });
}

function assertFormalTtrpgGmV2(
  participants: import("../types").TtrpgSessionParticipantRecordV2[],
  gmKey: string,
): void {
  const gm = participants.find((row) => row.role === "gm");
  if (
    !gm ||
    ![gm.seatKey, gm.viewerKey].includes(gmKey) ||
    gm.controller === "vacant" ||
    gm.assignmentState === "vacant" ||
    gm.assignmentState === "left" ||
    gm.sessionZeroAcceptedAtSequence == null
  ) {
    throw new Error("[ttrpg] 长期战役命令必须由已确认的本局 GM 提交。");
  }
}

export async function startTtrpgCampaignSessionV2(
  input: FormalTtrpgCommandEnvelope & {
    sessionKey: string;
    title: string;
    participantKeys: string[];
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const sessionKey = longCampaignKey(input.sessionKey, "长期战役分场 key");
  const title = longCampaignText(input.title, "长期战役分场标题", 300);
  const participantKeys = [
    ...new Set(
      input.participantKeys.map((key) =>
        longCampaignKey(key, "长期战役参与者"),
      ),
    ),
  ];
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.session.started",
    intent: { sessionKey, title, participantKeys, gmKey },
    build: async ({ state, sequence, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const campaignState = ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.playSessions.some(
          (item) => item.sessionKey === sessionKey,
        )
      ) {
        throw new Error("[ttrpg] 当前正式战役不能开始新的长期分场。");
      }
      const activeRoster = campaignState.roster
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.characterKey)
        .sort();
      if (
        !activeRoster.length ||
        stableJson(activeRoster) !== stableJson([...participantKeys].sort())
      ) {
        throw new Error("[ttrpg] 分场参与者必须精确匹配当前活动编组。");
      }
      for (const characterKey of participantKeys) {
        const seat = participants.find(
          (row) => row.role === "player" && row.actorKey === characterKey,
        );
        if (
          !seat ||
          seat.controller === "vacant" ||
          seat.assignmentState === "vacant" ||
          seat.assignmentState === "left" ||
          seat.sessionZeroAcceptedAtSequence == null ||
          ((seat.controller === "ai" || seat.controller === "hybrid") &&
            !seat.consent.aiIdentityDisclosed)
        ) {
          throw new Error(`[ttrpg] 活动角色席位尚未确认:${characterKey}`);
        }
      }
      return {
        actorKey: gmKey,
        targetKey: product.campaignKey,
        payload: {
          playSession: {
            sessionKey,
            ordinal: campaignState.playSessions.length + 1,
            title,
            status: "active",
            participantKeys,
            startedSequence: sequence,
            completedSequence: null,
            summary: "",
            rulePackContentHash: product.rulePackContentHash,
            campaignKey: product.campaignKey,
          } satisfies TtrpgRuntimeCampaignSessionV2,
        },
      };
    },
  });
}

export async function completeTtrpgCampaignSessionV2(
  input: FormalTtrpgCommandEnvelope & {
    sessionKey: string;
    summary: string;
    memories?: Array<{
      memoryKey: string;
      subjectKey: string;
      summary: string;
      audience: TtrpgRuntimeCampaignMemoryV2["audience"];
    }>;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const sessionKey = longCampaignKey(input.sessionKey, "长期战役分场 key");
  const summary = longCampaignText(input.summary, "长期战役分场摘要", 20_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  const memoryInputs = (input.memories ?? []).map((memory) =>
    assertTtrpgCampaignMemoryV2({
      ...memory,
      sourceSessionKey: sessionKey,
      updatedSequence: 1,
    }),
  );
  if (
    new Set(memoryInputs.map((item) => item.memoryKey)).size !==
    memoryInputs.length
  ) {
    throw new Error("[ttrpg] 同一分场不能提交重复记忆 key。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.session.completed",
    intent: { sessionKey, summary, memories: memoryInputs, gmKey },
    build: async ({ state, sequence, rulePack, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const campaignState = ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        !campaignState ||
        campaignState.activeSessionKey !== sessionKey ||
        campaignState.playSessions.find(
          (item) => item.sessionKey === sessionKey,
        )?.status !== "active"
      ) {
        throw new Error("[ttrpg] 只能完成当前活动长期分场。");
      }
      if (
        memoryInputs.some(
          (memory) =>
            campaignState.memories.some(
              (prior) => prior.memoryKey === memory.memoryKey,
            ) ||
            (memory.audience.startsWith("actor:") &&
              !campaignState.roster.some(
                (entry) =>
                  entry.characterKey === memory.audience.slice("actor:".length),
              )),
        )
      ) {
        throw new Error("[ttrpg] 长期战役记忆 key 或受众无效。");
      }
      const memories = memoryInputs.map((memory) => ({
        ...memory,
        updatedSequence: sequence,
      }));
      const abilityResets = Object.entries(product.abilityStates ?? {}).flatMap(
        ([stateKey, before]) => {
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes("session")) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: "session",
            eventId: `event.${sequence}`,
          });
          return [{ stateKey, before, after }];
        },
      );
      return {
        actorKey: gmKey,
        targetKey: sessionKey,
        payload: { sessionKey, summary, memories, abilityResets },
      };
    },
  });
}

export async function changeTtrpgCampaignRosterV2(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    status: TtrpgRuntimeRosterEntryV2["status"];
    replacementFor?: string | null;
    reason: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const characterKey = longCampaignKey(input.characterKey, "长期战役角色");
  const replacementFor =
    input.replacementFor == null
      ? null
      : longCampaignKey(input.replacementFor, "补员替代角色");
  const reason = longCampaignText(input.reason, "编组变更理由", 2_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (!(["active", "reserve", "retired"] as string[]).includes(input.status))
    throw new Error("[ttrpg] 编组目标状态无效。");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.roster.changed",
    intent: {
      characterKey,
      status: input.status,
      replacementFor,
      reason,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const ttrpg = state.ttrpg;
      const campaignState = ttrpg?.campaign;
      const product = ttrpg?.product;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !campaignState ||
        !product?.sessionZero.completed ||
        product.ending ||
        campaignState.activeSessionKey != null
      ) {
        throw new Error("[ttrpg] 编组只能在未结束战役的两场之间调整。");
      }
      const prior = campaignState.roster.find(
        (entry) => entry.characterKey === characterKey,
      );
      if (!prior || prior.status === "retired" || prior.status === input.status)
        throw new Error("[ttrpg] 角色当前编组状态不能执行该迁移。");
      if (input.status === "active") {
        if (prior.status !== "reserve")
          throw new Error("[ttrpg] 只有后备角色可以加入活动编组。");
        const seat = participants.find(
          (row) => row.role === "player" && row.actorKey === characterKey,
        );
        if (
          !seat ||
          seat.controller === "vacant" ||
          seat.assignmentState === "vacant" ||
          seat.assignmentState === "left" ||
          seat.sessionZeroAcceptedAtSequence == null
        ) {
          throw new Error("[ttrpg] 补员席位尚未在 Session Zero 中确认。");
        }
        if (replacementFor != null) {
          const replaced = campaignState.roster.find(
            (entry) => entry.characterKey === replacementFor,
          );
          if (!replaced || replaced.status !== "retired")
            throw new Error("[ttrpg] 补员只能替代已经退役的角色。");
        }
      } else if (prior.status !== "active" || replacementFor != null) {
        throw new Error("[ttrpg] 只有活动角色可以轮换或退役。");
      }
      const lastCompleted = [...campaignState.playSessions]
        .reverse()
        .find((item) => item.status === "completed");
      if (input.status === "retired" && !lastCompleted)
        throw new Error("[ttrpg] 角色至少完成一场后才能正式退役。");
      return {
        actorKey: gmKey,
        targetKey: characterKey,
        payload: {
          entry: {
            ...prior,
            status: input.status,
            leftSessionKey:
              input.status === "retired" ? lastCompleted!.sessionKey : null,
            replacementFor: input.status === "active" ? replacementFor : null,
            reason,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeRosterEntryV2,
        },
      };
    },
  });
}

export async function activateTtrpgCampaignSupplementV2(
  input: FormalTtrpgCommandEnvelope & {
    supplementKey: string;
    title: string;
    contentHash: string;
    compatibility: TtrpgRuntimeSupplementReceiptV2["compatibility"];
    sourceRef: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const supplementKey = longCampaignKey(input.supplementKey, "补充包 key");
  const title = longCampaignText(input.title, "补充包标题", 300);
  const contentHash = String(input.contentHash).trim();
  const sourceRef = longCampaignKey(input.sourceRef, "补充包来源");
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (
    !TTRPG_SHA256.test(contentHash) ||
    !["same-release", "next-release"].includes(input.compatibility)
  ) {
    throw new Error("[ttrpg] 补充包兼容性或内容哈希无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.supplement.activated",
    intent: {
      supplementKey,
      title,
      contentHash,
      compatibility: input.compatibility,
      sourceRef,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !state.ttrpg?.product?.sessionZero.completed ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.supplements.some(
          (item) => item.supplementKey === supplementKey,
        )
      ) {
        throw new Error("[ttrpg] 当前不能激活该补充包。");
      }
      const activatedSessionKey =
        [...campaignState.playSessions]
          .reverse()
          .find((item) => item.status === "completed")?.sessionKey ?? null;
      return {
        actorKey: gmKey,
        targetKey: supplementKey,
        payload: {
          supplement: {
            supplementKey,
            title,
            contentHash,
            compatibility: input.compatibility,
            sourceRef,
            activatedSessionKey,
            approvedBy: gmKey,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeSupplementReceiptV2,
        },
      };
    },
  });
}

export async function recordTtrpgWorldEvolutionV2(
  input: FormalTtrpgCommandEnvelope & {
    candidateKey: string;
    category: TtrpgRuntimeWorldEvolutionV2["category"];
    summary: string;
    sourceSessionKey: string;
    status: TtrpgRuntimeWorldEvolutionV2["status"];
    targetWorldRef?: string | null;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const candidateKey = longCampaignKey(input.candidateKey, "世界演化候选 key");
  const summary = longCampaignText(input.summary, "世界演化摘要", 8_000);
  const sourceSessionKey = longCampaignKey(
    input.sourceSessionKey,
    "世界演化来源分场",
  );
  const targetWorldRef =
    input.targetWorldRef == null
      ? null
      : longCampaignKey(input.targetWorldRef, "世界演化目标");
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.world-evolution.recorded",
    intent: {
      candidateKey,
      category: input.category,
      summary,
      sourceSessionKey,
      status: input.status,
      targetWorldRef,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (!campaignState || campaignState.activeSessionKey != null)
        throw new Error("[ttrpg] 世界演化只能在两场之间处理。");
      const prior = campaignState.worldEvolution.find(
        (item) => item.candidateKey === candidateKey,
      );
      if (
        !campaignState.playSessions.some(
          (item) =>
            item.sessionKey === sourceSessionKey && item.status === "completed",
        ) ||
        (!prior && input.status !== "proposed") ||
        (prior && (prior.status !== "proposed" || input.status === "proposed"))
      ) {
        throw new Error("[ttrpg] 世界演化候选创建或复审状态无效。");
      }
      if (
        prior &&
        (prior.category !== input.category ||
          prior.summary !== summary ||
          prior.sourceSessionKey !== sourceSessionKey ||
          prior.targetWorldRef !== targetWorldRef)
      ) {
        throw new Error("[ttrpg] 世界演化复审不得篡改候选内容。");
      }
      return {
        actorKey: gmKey,
        targetKey: candidateKey,
        payload: {
          candidate: {
            candidateKey,
            category: input.category,
            summary,
            sourceSessionKey,
            status: input.status,
            targetWorldRef,
            reviewedBy: input.status === "proposed" ? null : gmKey,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeWorldEvolutionV2,
        },
      };
    },
  });
}

export async function recordTtrpgVersionTransitionV2(
  input: FormalTtrpgCommandEnvelope & {
    transitionKey: string;
    toRulePackContentHash: string;
    toCampaignKey: string;
    compatibility: TtrpgRuntimeVersionTransitionV2["compatibility"];
    status: TtrpgRuntimeVersionTransitionV2["status"];
    notes: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const transitionKey = longCampaignKey(input.transitionKey, "版本迁移 key");
  const toRulePackContentHash = String(input.toRulePackContentHash).trim();
  const toCampaignKey = longCampaignKey(
    input.toCampaignKey,
    "迁移后 Campaign key",
  );
  const notes = longCampaignText(input.notes, "版本迁移说明", 8_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (!TTRPG_SHA256.test(toRulePackContentHash))
    throw new Error("[ttrpg] 迁移目标 RulePack hash 无效。");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.version-transition.recorded",
    intent: {
      transitionKey,
      toRulePackContentHash,
      toCampaignKey,
      compatibility: input.compatibility,
      status: input.status,
      notes,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const product = state.ttrpg?.product;
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.versionTransitions.some(
          (item) => item.transitionKey === transitionKey,
        )
      ) {
        throw new Error("[ttrpg] 当前不能记录该版本迁移。");
      }
      if (
        input.status === "activated" &&
        (toRulePackContentHash !== product.rulePackContentHash ||
          toCampaignKey !== product.campaignKey)
      ) {
        throw new Error(
          "[ttrpg] 不得在运行中原地替换冻结规则；请创建跨版本续团 Instance。",
        );
      }
      return {
        actorKey: gmKey,
        targetKey: transitionKey,
        payload: {
          transition: {
            transitionKey,
            fromRulePackContentHash: product.rulePackContentHash,
            toRulePackContentHash,
            fromCampaignKey: product.campaignKey,
            toCampaignKey,
            compatibility: input.compatibility,
            status: input.status,
            notes,
            approvedBy: gmKey,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeVersionTransitionV2,
        },
      };
    },
  });
}

export async function openTtrpgCampaignScene(
  input: FormalTtrpgCommandEnvelope & {
    sceneKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const sceneKey = input.sceneKey.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.scene.opened",
    intent: { sceneKey },
    build: async ({ session, state, sequence, rulePack, campaign }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (!ttrpg || !product?.sessionZero.completed)
        throw new Error("[ttrpg] 请先完成 Session Zero。");
      if (product.ending) throw new Error("[ttrpg] 正式战役已经结束。");
      const scene = campaign.scenes.find((item) => item.sceneKey === sceneKey);
      if (!scene) throw new Error("[ttrpg] 场景不属于冻结 CampaignPack。");
      if (!ttrpg.scene && sceneKey !== product.openingSceneKey) {
        throw new Error("[ttrpg] 正式战役必须从冻结开场场景开始。");
      }
      if (ttrpg.scene?.sceneKey) {
        const current = campaign.scenes.find(
          (item) => item.sceneKey === ttrpg.scene?.sceneKey,
        );
        if (!current?.nextSceneKeys.includes(sceneKey)) {
          throw new Error("[ttrpg] 只能进入当前冻结场景声明的后继场景。");
        }
      }
      const allPlayers = campaign.characterTemplates
        .filter((item) => item.role === "player")
        .map((item) => item.characterKey);
      const selectedPlayers = product.sessionZero.selectedCharacterKeys.length
        ? product.sessionZero.selectedCharacterKeys
        : allPlayers;
      const playerSet = new Set(allPlayers);
      const participants = (
        scene.participantKeys.length ? scene.participantKeys : selectedPlayers
      ).filter((key) => !playerSet.has(key) || selectedPlayers.includes(key));
      if (!participants.length)
        throw new Error("[ttrpg] 正式场景没有可用行动者。");
      const initiativeEntries = await Promise.all(
        participants.map(async (actorKey) => {
          const modifier = Number(
            state.entities[actorKey]?.attributes[
              rulePack.turnStructure.initiativeAttributeKey
            ],
          );
          if (!Number.isFinite(modifier))
            throw new Error(`[ttrpg] 角色缺少先攻属性:${actorKey}`);
          const nonce = `${input.commandId}:${sequence}:initiative:${actorKey}`;
          const rolled = await resolveRulePackDiceModelV1({
            rulePack,
            diceModelKey: rulePack.turnStructure.initiativeDiceModelKey,
            seed: session.seed,
            nonce,
            modifier,
          });
          return {
            actorKey,
            rolledDice: rolled.dice,
            keptDice: rolled.keptDice,
            modifier,
            total: rolled.total,
            rollTrace: rolled.rollTrace,
            seedCommitment: rolled.seedCommitment,
            nonce: rolled.nonce,
            proofHash: rolled.proofHash,
          };
        }),
      );
      initiativeEntries.sort(
        (left, right) =>
          right.total - left.total ||
          left.actorKey.localeCompare(right.actorKey),
      );
      const turnOrder = initiativeEntries.map((entry) => entry.actorKey);
      const abilityResets = Object.entries(product.abilityStates ?? {}).flatMap(
        ([stateKey, before]) => {
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes("scene")) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: "scene",
            eventId: `event.${sequence}`,
          });
          return [{ stateKey, before, after }];
        },
      );
      return {
        actorKey: turnOrder[0],
        targetKey: scene.locationKey,
        payload: {
          scene: {
            sceneId: `campaign-scene:${scene.sceneKey}:${sequence}`,
            sceneKey: scene.sceneKey,
            title: scene.title,
            description: scene.description,
            locationKey: scene.locationKey,
            status: "active",
          },
          turnOrder,
          initiative: {
            sceneKey: scene.sceneKey,
            diceModelKey: rulePack.turnStructure.initiativeDiceModelKey,
            attributeKey: rulePack.turnStructure.initiativeAttributeKey,
            entries: initiativeEntries,
          },
          abilityResets,
        },
      };
    },
  });
}

export async function updateTtrpgTabletopV1(
  input: FormalTtrpgCommandEnvelope & {
    role: "gm" | "player";
    actorKey: string;
    operation: TtrpgTabletopOperationV1;
  },
): Promise<ProductRuntimeEvent> {
  const actorKey = input.actorKey.trim();
  const operation = parseTtrpgTabletopOperationV1(input.operation);
  if (
    !actorKey ||
    actorKey.length > 200 ||
    !["gm", "player"].includes(input.role)
  ) {
    throw new Error("[ttrpg] 桌面操作者无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.tabletop.updated",
    intent: { role: input.role, actorKey, operation },
    build: async ({ state, sequence }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.tabletop ||
        !state.ttrpg?.scene ||
        state.ttrpg.scene.status !== "active"
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可操作桌面。");
      }
      if (
        input.role === "player" &&
        !product.sessionZero.selectedCharacterKeys.includes(actorKey)
      ) {
        throw new Error("[ttrpg] 玩家桌面操作者不在本局角色名单中。");
      }
      applyTtrpgTabletopOperationV1({
        tabletop: structuredClone(product.tabletop),
        role: input.role,
        actorKey,
        operation,
        sequence,
      });
      const targetKey =
        operation.kind === "set-fog"
          ? operation.fogKey
          : operation.kind === "set-layer"
            ? operation.layerKey
            : operation.tokenKey;
      return {
        actorKey,
        targetKey,
        payload: { role: input.role, actorKey, operation },
      };
    },
  });
}

/**
 * Atomically grants, transfers, consumes, equips or changes one ItemInstance.
 * The formal command id is also the inventory idempotency key, so transport
 * retries cannot duplicate loot or apply a stale transfer twice.
 */
export async function commitTtrpgItemCommandV2(
  input: FormalTtrpgCommandEnvelope & {
    command: import("../ttrpg/item-ledger").TtrpgItemCommandV2;
    requestedBy: { role: "gm" | "player"; actorKey: string };
  },
): Promise<ProductRuntimeEvent> {
  const command = parseTtrpgItemCommandV2(input.command);
  if (!input.requestedBy || typeof input.requestedBy !== "object") {
    throw new Error("[ttrpg] 物品命令必须声明已验证的操作者。");
  }
  const requestedBy = {
    role: input.requestedBy.role,
    actorKey: input.requestedBy.actorKey.trim(),
  };
  if (
    !["gm", "player"].includes(requestedBy.role) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestedBy.actorKey)
  ) {
    throw new Error("[ttrpg] 物品命令操作者无效。");
  }
  if (command.commandId !== input.commandId.trim()) {
    throw new Error("[ttrpg] 物品命令必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.item.changed",
    intent: { command, requestedBy },
    build: async ({ state, sequence, rulePack, participants }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.inventory
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可操作库存。");
      }
      if (requestedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, requestedBy.actorKey);
      } else {
        const seat = participants.find(
          (row) =>
            row.role === "player" && row.actorKey === requestedBy.actorKey,
        );
        const prior = product.inventory.items[command.instanceId];
        if (
          !seat ||
          !["human", "hybrid"].includes(seat.controller) ||
          seat.assignmentState !== "claimed" ||
          seat.sessionZeroAcceptedAtSequence == null ||
          !prior ||
          prior.ownerRef !== requestedBy.actorKey ||
          ["grant", "remove"].includes(command.kind)
        ) {
          throw new Error(
            "[ttrpg] 玩家只能操作自己持有的物品，授予与移除由 GM 负责。",
          );
        }
      }
      if (command.kind === "grant" && command.eventId !== `event.${sequence}`) {
        throw new Error(
          `[ttrpg] 新物品 acquiredByEventId 必须为 event.${sequence}。`,
        );
      }
      const entityRefs =
        command.kind === "grant"
          ? [command.ownerRef, command.locationRef]
          : command.kind === "transfer"
            ? [command.expectedOwnerRef, command.destinationOwnerRef]
            : "expectedOwnerRef" in command
              ? [command.expectedOwnerRef]
              : [];
      if (entityRefs.some((ref) => ref != null && !state.entities[ref])) {
        throw new Error("[ttrpg] 物品所有者或地点不属于当前冻结运行时。");
      }
      const definitions = Object.fromEntries(
        rulePack.items.map((item) => [
          item.key,
          ttrpgItemDefinitionFromRuleV1(item),
        ]),
      );
      const applied = applyTtrpgItemCommandV2({
        state: product.inventory,
        definitions,
        command,
      });
      if (applied.replayed) throw new Error("[ttrpg] 物品命令已经执行。");
      const prior = product.inventory.items[command.instanceId];
      const actorKey = requestedBy.actorKey;
      const targetKey =
        command.kind === "transfer"
          ? command.destinationOwnerRef
          : (prior?.ownerRef ?? command.instanceId);
      return {
        actorKey,
        targetKey,
        payload: {
          command,
          requestedBy,
          // Frozen RulePack definitions are included so replay never reads mutable DB rows.
          definitions: Object.fromEntries(
            rulePack.items.map((item) => [item.key, item]),
          ),
        },
      };
    },
  });
}

/** Commit one closed reward/penalty plan as an all-or-nothing replayable event. */
export async function commitTtrpgEffectPlanV2(
  input: FormalTtrpgCommandEnvelope & {
    plan: import("../types").TtrpgEffectPlanV2;
    /** When set, this plan is the single authoritative consequence ledger for that resolved action. */
    actionSequence?: number;
  },
): Promise<ProductRuntimeEvent> {
  const plan = parseTtrpgEffectPlanV2(input.plan);
  const actionSequence =
    input.actionSequence == null
      ? null
      : assertFiniteInteger(
          input.actionSequence,
          "EffectPlan 来源行动序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  if (plan.idempotencyKey !== input.commandId.trim()) {
    throw new Error("[ttrpg] EffectPlan 必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.applied",
    intent: { plan, actionSequence },
    build: async ({ state, sequence, rulePack }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.effectLedger
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可提交的效果账本。");
      }
      if (actionSequence != null) {
        const sourceAction = product.actionHistory.find(
          (action) => action.eventSequence === actionSequence,
        );
        if (
          !sourceAction ||
          plan.sourceEventId !== `event.${actionSequence}` ||
          plan.ruleRef !== sourceAction.actionKey
        ) {
          throw new Error(
            "[ttrpg] 行动后果必须精确引用已经提交的规则行动与 actionKey。",
          );
        }
        const expectedDegree =
          sourceAction.outcome === "automatic"
            ? "success"
            : sourceAction.outcome;
        if (plan.degree !== expectedDegree) {
          throw new Error("[ttrpg] 行动后果等级与冻结判定结果不一致。");
        }
        if (
          product.effectLedger.entries.some(
            (entry) => entry.sourceEventId === plan.sourceEventId,
          ) ||
          product.effectLedger.pendingChoices.some(
            (choice) => choice.plan.sourceEventId === plan.sourceEventId,
          )
        ) {
          throw new Error("[ttrpg] 该规则行动已经提交过唯一后果计划。");
        }
      }
      applyTtrpgEffectPlanToRuntimeV2({
        state,
        rulePack,
        plan,
        eventSequence: sequence,
      });
      const audienceActor = plan.audience.startsWith("actor:")
        ? plan.audience.slice("actor:".length)
        : null;
      return {
        actorKey: audienceActor,
        targetKey: plan.effects[0]?.targetRef ?? product.campaignKey,
        payload: { plan, rulePack },
      };
    },
  });
}

/** Record a GM-authored set of mutually-exclusive consequences without applying one. */
export async function proposeTtrpgEffectChoiceV2(
  input: FormalTtrpgCommandEnvelope & {
    plan: import("../types").TtrpgEffectPlanV2;
    actionSequence: number;
    ownerActorKey: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const plan = parseTtrpgEffectPlanV2(input.plan);
  const actionSequence = assertFiniteInteger(
    input.actionSequence,
    "效果选择来源行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const ownerActorKey = normalizeCommandId(input.ownerActorKey);
  const gmKey = normalizeCommandId(input.gmKey);
  if (plan.idempotencyKey !== input.commandId.trim()) {
    throw new Error("[ttrpg] 效果选择提议必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.choice.proposed",
    intent: { plan, actionSequence, ownerActorKey, gmKey },
    build: async ({ state, sequence, participants }) => {
      assertFormalTtrpgGmV2(participants, gmKey);
      proposeTtrpgEffectChoiceToRuntimeV2({
        state,
        plan,
        actionSequence,
        ownerActorKey,
        eventSequence: sequence,
      });
      return {
        actorKey: "gm",
        targetKey: ownerActorKey,
        payload: { plan, actionSequence, ownerActorKey },
      };
    },
  });
}

/** Resolve one pending consequence choice through the owning seat authority. */
export async function resolveTtrpgEffectChoiceV2(
  input: FormalTtrpgCommandEnvelope & {
    choiceKey: string;
    selectedEffectKey: string;
    requestedBy: { role: "gm" | "player"; actorKey: string };
    gmKey?: string;
  },
): Promise<ProductRuntimeEvent> {
  const choiceKey = normalizeCommandId(input.choiceKey);
  const selectedEffectKey = normalizeCommandId(input.selectedEffectKey);
  const requestedBy = {
    role: input.requestedBy?.role,
    actorKey: normalizeCommandId(input.requestedBy?.actorKey ?? ""),
  };
  const gmKey = input.gmKey == null ? null : normalizeCommandId(input.gmKey);
  if (!["gm", "player"].includes(requestedBy.role)) {
    throw new Error("[ttrpg] 效果选择操作者无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.applied",
    intent: { choiceKey, selectedEffectKey, requestedBy, gmKey },
    build: async ({ state, sequence, rulePack, participants }) => {
      const product = state.ttrpg?.product;
      const choice = product?.effectLedger?.pendingChoices.find(
        (item) => item.choiceKey === choiceKey,
      );
      if (!product?.sessionZero.completed || product.ending || !choice) {
        throw new Error("[ttrpg] 待选择后果不存在或当前战役不可结算。");
      }
      if (choice.ownerActorKey !== requestedBy.actorKey) {
        throw new Error("[ttrpg] 只能结算自己角色的后果选择。");
      }
      const seat = participants.find(
        (row) => row.role === "player" && row.actorKey === choice.ownerActorKey,
      );
      if (requestedBy.role === "player") {
        if (
          !seat ||
          !["human", "hybrid"].includes(seat.controller) ||
          seat.assignmentState !== "claimed" ||
          seat.sessionZeroAcceptedAtSequence == null
        ) {
          throw new Error("[ttrpg] 该角色没有可确认选择的真人席位。");
        }
      } else {
        if (!gmKey) throw new Error("[ttrpg] GM 代管选择缺少主持身份。");
        assertFormalTtrpgGmV2(participants, gmKey);
        if (!seat || seat.controller !== "ai") {
          throw new Error("[ttrpg] GM 只能代纯 AI 玩家席位确认后果选择。");
        }
      }
      const resolved = resolveTtrpgEffectChoiceToRuntimeV2({
        state,
        rulePack,
        choiceKey,
        selectedEffectKey,
        commandId: input.commandId,
        eventSequence: sequence,
      });
      return {
        actorKey: choice.ownerActorKey,
        targetKey: resolved.plan.effects[0].targetRef,
        payload: {
          choiceKey,
          selectedEffectKey,
          requestedBy,
          plan: resolved.plan,
          rulePack,
        },
      };
    },
  });
}

export async function discoverTtrpgClue(
  input: FormalTtrpgCommandEnvelope & {
    clueKey: string;
    actorKey: string;
    visibility: "private" | "party";
  },
): Promise<ProductRuntimeEvent> {
  const clueKey = input.clueKey.trim();
  const actorKey = input.actorKey.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.clue.discovered",
    intent: { clueKey, actorKey, visibility: input.visibility },
    build: async ({ state, campaign }) => {
      if (
        !state.ttrpg?.product?.sessionZero.completed ||
        !state.ttrpg.scene?.sceneKey
      ) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      const clue = campaign.clues.find((item) => item.clueKey === clueKey);
      if (
        !clue ||
        !state.ttrpg.scene ||
        !campaign.scenes.find(
          (item) =>
            item.sceneKey === state.ttrpg!.scene!.sceneKey &&
            item.clueKeys.includes(clueKey),
        )
      )
        throw new Error("[ttrpg] 当前场景不包含该线索。");
      if (clue.visibility === "gm-only")
        throw new Error("[ttrpg] GM 私密线索不能通过玩家发现命令公开。");
      if (clue.visibility === "public" && input.visibility !== "party")
        throw new Error("[ttrpg] 公开线索必须对队伍可见。");
      const existing = state.ttrpg.product.discoveredClues.find(
        (item) => item.clueKey === clueKey,
      );
      if (
        existing &&
        !(existing.visibility === "private" && input.visibility === "party")
      ) {
        throw new Error("[ttrpg] 该线索已经发现。");
      }
      const actor = state.entities[actorKey];
      if (
        !actor ||
        !["player", "character"].includes(actor.kind) ||
        (state.ttrpg.product.sessionZero.selectedCharacterKeys.length > 0 &&
          !state.ttrpg.product.sessionZero.selectedCharacterKeys.includes(
            actorKey,
          ))
      ) {
        throw new Error("[ttrpg] 线索发现者不是本局已选择的玩家角色。");
      }
      return {
        actorKey,
        targetKey: clueKey,
        payload: { clueKey, actorKey, visibility: input.visibility },
      };
    },
  });
}

function resolveTtrpgActionSkillV2(input: {
  state: ProductRuntimeState;
  campaign: TtrpgCampaignContentV1;
  actorKey: string;
  actionKey: string;
}): { skillKey: string; skillValue: number } {
  const template = input.campaign.characterTemplates.find(
    (item) => item.characterKey === input.actorKey,
  );
  if (!template) throw new Error("[ttrpg] 技能判定角色不在冻结 CampaignPack。");
  const customization =
    input.state.ttrpg?.product?.characterCustomizations.find(
      (item) => item.characterKey === input.actorKey,
    );
  const raw =
    customization?.characterSheet?.rules.skills[input.actionKey] ??
    template.characterSheet?.rules.skills[input.actionKey] ??
    template.skills[input.actionKey] ??
    0;
  if (!Number.isFinite(raw) || raw < -1_000 || raw > 1_000) {
    throw new Error(
      `[ttrpg] 角色技能值无效:${input.actorKey}.${input.actionKey}`,
    );
  }
  return { skillKey: input.actionKey, skillValue: Number(raw) };
}

export function classifyTtrpgSubmittedIntentV2(input: {
  state: ProductRuntimeState;
  campaign: TtrpgCampaignContentV1;
  rulePack: ReturnType<typeof parseRulePackV1>;
  actorKey: string;
  actionKey: string | null;
  targetKey: string | null;
}): {
  status: "needs-clarification" | "rejected-illegal" | null;
  reason: string;
  suggestedActionKeys: string[];
} {
  const ttrpg = input.state.ttrpg;
  const product = ttrpg?.product;
  const scene = input.campaign.scenes.find(
    (item) => item.sceneKey === ttrpg?.scene?.sceneKey,
  );
  const template = input.campaign.characterTemplates.find(
    (item) => item.characterKey === input.actorKey,
  );
  const itemActionKeys = Object.values(product?.inventory?.items ?? {})
    .filter(
      (item) =>
        item.ownerRef === input.actorKey && !item.stateTags.includes("broken"),
    )
    .flatMap(
      (item) =>
        input.rulePack.items.find(
          (definition) => definition.key === item.definitionRef,
        )?.grantedActionKeys ?? [],
    );
  const granted = new Set([...(template?.actionKeys ?? []), ...itemActionKeys]);
  const suggestedActionKeys = (scene?.actionKeys ?? [])
    .filter((actionKey) => granted.has(actionKey))
    .slice(0, 12);
  if (!ttrpg || !product?.sessionZero.completed || !scene || !template) {
    return {
      status: "rejected-illegal",
      reason: "当前尚未完成 Session Zero 或打开可行动场景。",
      suggestedActionKeys,
    };
  }
  if (!input.actionKey) {
    return {
      status: "needs-clarification",
      reason:
        "请确认这段描述要使用哪一项规则行动；系统不会替你暗选风险、资源或检定方式。",
      suggestedActionKeys,
    };
  }
  const action = input.rulePack.actions.find(
    (item) => item.key === input.actionKey,
  );
  if (
    !action ||
    !scene.actionKeys.includes(input.actionKey) ||
    !granted.has(input.actionKey)
  ) {
    return {
      status: "rejected-illegal",
      reason: "当前场景、角色卡或所持物品没有授予这项规则行动。",
      suggestedActionKeys,
    };
  }
  if (!ttrpg.turnOrder.includes(input.actorKey)) {
    return {
      status: "rejected-illegal",
      reason: "该角色不在当前场景，不能感知或执行这里的行动。",
      suggestedActionKeys,
    };
  }
  if (action.phase !== "reaction" && ttrpg.activeActorKey !== input.actorKey) {
    return {
      status: "rejected-illegal",
      reason: `当前轮到 ${ttrpg.activeActorKey ?? "其他角色"}，本行动不会掷骰或消耗资源。`,
      suggestedActionKeys,
    };
  }
  const requirement = evaluateTtrpgActionRequirementsV2({
    action,
    rulePack: input.rulePack,
    actorAttributes: input.state.entities[input.actorKey]?.attributes,
    actorConditions: product.conditions[input.actorKey],
  });
  if (!requirement.met) {
    return {
      status: "rejected-illegal",
      reason: requirement.reason!,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  if (
    action.target === "self" &&
    input.targetKey != null &&
    input.targetKey !== input.actorKey
  ) {
    return {
      status: "rejected-illegal",
      reason: "这项行动只能以行动者自己为目标。",
      suggestedActionKeys,
    };
  }
  if (
    ["single-ally", "single-enemy"].includes(action.target) &&
    (!input.targetKey ||
      input.targetKey === input.actorKey ||
      !ttrpg.turnOrder.includes(input.targetKey))
  ) {
    return {
      status: "needs-clarification",
      reason: "请指定当前场景中的另一名合法目标。",
      suggestedActionKeys,
    };
  }
  const ability =
    product.abilityStates?.[ttrpgAbilityStateKeyV2(input.actorKey, action.key)];
  if (!ability) {
    return {
      status: "rejected-illegal",
      reason: "角色缺少这项能力的冻结次数账本。",
      suggestedActionKeys,
    };
  }
  if (ability.disabledReasons.length > 0) {
    return {
      status: "rejected-illegal",
      reason: `能力当前被禁用：${ability.disabledReasons.join("、")}。`,
      suggestedActionKeys,
    };
  }
  if (ability.remainingUses === 0) {
    const resetLabels = action.usage.reset.map(
      (trigger) =>
        ({
          turn: "下一回合",
          round: "下一轮",
          scene: "下一场景",
          encounter: "遭遇结束",
          session: "下一场游戏",
          "short-rest": "短休",
          "long-rest": "长休",
          "manual-gm": "KP 手动恢复",
          milestone: "指定里程碑",
        })[trigger] ?? trigger,
    );
    return {
      status: "rejected-illegal",
      reason: `次数已耗尽；${resetLabels.length ? `${resetLabels.join("或")}恢复` : "当前规则没有自动恢复条件"}。本次没有掷骰、消耗或重复奖励。`,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  if (
    ability.cooldownUntilRound != null &&
    ttrpg.round < ability.cooldownUntilRound
  ) {
    return {
      status: "rejected-illegal",
      reason: `能力冷却到第 ${ability.cooldownUntilRound} 轮；当前是第 ${ttrpg.round} 轮。`,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  const resourceCosts = new Map<string, number>();
  if (action.usage.resourceKey && (action.usage.cost ?? 0) > 0) {
    resourceCosts.set(action.usage.resourceKey, action.usage.cost ?? 0);
  }
  if (action.costResourceKey && action.costAmount > 0) {
    resourceCosts.set(
      action.costResourceKey,
      (resourceCosts.get(action.costResourceKey) ?? 0) + action.costAmount,
    );
  }
  for (const [resourceKey, resourceCost] of resourceCosts) {
    const available =
      input.state.entities[input.actorKey]?.attributes[
        `resource.${resourceKey}`
      ];
    if (typeof available !== "number" || available < resourceCost) {
      return {
        status: "rejected-illegal",
        reason: `资源不足：${resourceKey} 需要 ${resourceCost}，当前 ${typeof available === "number" ? available : 0}。`,
        suggestedActionKeys: suggestedActionKeys.filter(
          (actionKey) => actionKey !== action.key,
        ),
      };
    }
  }
  if (action.usage.sharedPoolKey) {
    const pool = product.usagePools?.[action.usage.sharedPoolKey];
    if (!pool || pool.remaining < (action.usage.cost ?? 1)) {
      return {
        status: "rejected-illegal",
        reason: `共享次数池 ${action.usage.sharedPoolKey} 不足。`,
        suggestedActionKeys: suggestedActionKeys.filter(
          (actionKey) => actionKey !== action.key,
        ),
      };
    }
  }
  try {
    if (product.actionEconomy) {
      spendTtrpgActionEconomyV2({
        economy: product.actionEconomy,
        turnOrder: ttrpg.turnOrder,
        actorKey: input.actorKey,
        phase: action.phase,
      });
    }
  } catch (cause) {
    return {
      status: "rejected-illegal",
      reason: cause instanceof Error ? cause.message : String(cause),
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  return {
    status: null,
    reason: "行动合法，进入冻结 RulePack 裁决。",
    suggestedActionKeys,
  };
}

/**
 * Human/GM intent gate. Legal declarations resolve through the same RulePack
 * action event; unclear or illegal declarations still commit one terminal,
 * player-visible receipt without rolling dice or mutating mechanics.
 */
export async function submitTtrpgActionIntentV2(
  input: FormalTtrpgCommandEnvelope & {
    intentKey: string;
    actorKey: string;
    rawInput: string;
    actionKey?: string | null;
    targetKey?: string | null;
    goal?: string | null;
    method?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    submittedBy: { role: "gm" | "player"; viewerKey: string };
  },
): Promise<ProductRuntimeEvent> {
  const intentKey = input.intentKey.trim();
  const actorKey = input.actorKey.trim();
  const rawInput = input.rawInput.trim().normalize("NFC");
  const actionKey = input.actionKey?.trim() || null;
  const targetKey = input.targetKey?.trim() || null;
  const goal = input.goal?.trim().normalize("NFC") || null;
  const method = input.method?.trim().normalize("NFC") || null;
  const submittedBy = {
    role: input.submittedBy?.role,
    viewerKey: input.submittedBy?.viewerKey?.trim() ?? "",
  };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(intentKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !rawInput ||
    rawInput.length > 10_000 ||
    (goal?.length ?? 0) > 2_000 ||
    (method?.length ?? 0) > 2_000 ||
    !["gm", "player"].includes(String(submittedBy.role)) ||
    !submittedBy.viewerKey
  ) {
    throw new Error("[ttrpg] 行动意图提交字段无效。");
  }
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const prior = (await readSessionEvents(session)).find(
    (event) => event.commandId === input.commandId.trim(),
  );
  if (prior) {
    const payload = parseEventPayload(prior);
    const priorIntent =
      prior.type === "ttrpg.intent.receipted" && isObject(payload.receipt)
        ? parseTtrpgIntentReceiptV2(payload.receipt)
        : prior.type === "ttrpg.rule.action.resolved" &&
            isObject(payload.result)
          ? assertTtrpgRuleActionResult(payload.result).receipt?.context
              .declaredIntent
          : null;
    if (
      !priorIntent ||
      priorIntent.intentKey !== intentKey ||
      priorIntent.rawInput !== rawInput
    ) {
      throw new Error("[ttrpg] commandId 已被不同行动意图使用。");
    }
    return prior;
  }
  const [state, version, frozen, participants] = await Promise.all([
    readProductRuntimeState(input.sessionId),
    readProductRuntimeStateVersion(input.sessionId),
    verifyFormalTtrpgSource(session),
    readTtrpgSessionParticipantsV2(input.sessionId),
  ]);
  if (
    version.sequence !== input.baseSequence ||
    version.stateHash !== input.baseStateHash
  ) {
    throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
  }
  if (submittedBy.role === "gm") {
    assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
  } else {
    const seat = participants.find(
      (row) =>
        row.role === "player" &&
        row.actorKey === actorKey &&
        row.viewerKey === submittedBy.viewerKey,
    );
    if (
      !seat ||
      !["human", "hybrid"].includes(seat.controller) ||
      seat.assignmentState !== "claimed" ||
      seat.sessionZeroAcceptedAtSequence == null
    ) {
      throw new Error("[ttrpg] 当前 viewer 没有为该角色提交行动的席位权限。");
    }
  }
  assertScriptedTtrpgCampaign(frozen.campaign);
  const classification = classifyTtrpgSubmittedIntentV2({
    state,
    campaign: frozen.campaign,
    rulePack: frozen.rulePack,
    actorKey,
    actionKey,
    targetKey,
  });
  if (classification.status == null && actionKey) {
    return resolveTtrpgRuleAction({
      sessionId: input.sessionId,
      commandId: input.commandId,
      baseSequence: input.baseSequence,
      baseStateHash: input.baseStateHash,
      actionKey,
      actorKey,
      targetKey,
      difficulty: input.difficulty,
      situationalModifier: input.situationalModifier,
      rollVisibility: input.rollVisibility,
      declaredIntent: { intentKey, rawInput, goal, method },
    });
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.intent.receipted",
    intent: {
      intentKey,
      actorKey,
      rawInput,
      actionKey,
      targetKey,
      goal,
      method,
      submittedBy,
    },
    build: async ({
      state: current,
      sequence,
      campaign,
      rulePack,
      participants,
    }) => {
      if (submittedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
      } else if (
        !participants.some(
          (row) =>
            row.role === "player" &&
            row.actorKey === actorKey &&
            row.viewerKey === submittedBy.viewerKey &&
            ["human", "hybrid"].includes(row.controller) &&
            row.assignmentState === "claimed" &&
            row.sessionZeroAcceptedAtSequence != null,
        )
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有为该角色提交行动的席位权限。");
      }
      assertScriptedTtrpgCampaign(campaign);
      const terminal = classifyTtrpgSubmittedIntentV2({
        state: current,
        campaign,
        rulePack,
        actorKey,
        actionKey,
        targetKey,
      });
      if (terminal.status == null) {
        throw new Error("[ttrpg] 行动已经合法，请刷新并进入正式规则裁决。");
      }
      const receipt: TtrpgRuntimeIntentReceiptV2 = {
        schema: "storyforge.ttrpg-intent-receipt",
        version: 2,
        receiptKey: `intent-receipt.${sequence}`,
        eventSequence: sequence,
        intentKey,
        actorKey,
        rawInput,
        proposedActionKey: actionKey,
        targetKey,
        terminalStatus: terminal.status,
        reason: terminal.reason,
        suggestedActionKeys: terminal.suggestedActionKeys,
      };
      return { actorKey, targetKey, payload: { receipt } };
    },
  });
}

/** Records one human-owned, non-mechanical response to an ActionReceipt prompt window. */
export async function recordTtrpgHumanResponseV2(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
    actionReceiptKey: string;
    actorKey: string;
    kind: "speak" | "act-narratively" | "decline";
    text?: string;
    audience: "party" | "gm-only";
    viewerKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const actionSequence = assertFiniteInteger(
    input.actionSequence,
    "真人回应行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actionReceiptKey = input.actionReceiptKey.trim();
  const actorKey = input.actorKey.trim();
  const viewerKey = input.viewerKey.trim();
  const kind = input.kind;
  const audience = input.audience;
  const text =
    kind === "decline"
      ? "本角色选择不作额外回应。"
      : String(input.text ?? "")
          .trim()
          .normalize("NFC");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actionReceiptKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(viewerKey) ||
    !["speak", "act-narratively", "decline"].includes(kind) ||
    !["party", "gm-only"].includes(audience) ||
    !text ||
    text.length > 10_000
  ) {
    throw new Error("[ttrpg] 真人角色回应字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.human-response.recorded",
    intent: {
      actionSequence,
      actionReceiptKey,
      actorKey,
      kind,
      text,
      audience,
      viewerKey,
    },
    build: async ({ state, sequence, participants }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        product.safety.status !== "active"
      ) {
        throw new Error("[ttrpg] 当前战役不能提交真人角色回应。");
      }
      const seat = participants.find(
        (row) =>
          row.role === "player" &&
          row.actorKey === actorKey &&
          row.viewerKey === viewerKey,
      );
      if (
        !seat ||
        !["human", "hybrid"].includes(seat.controller) ||
        seat.assignmentState !== "claimed" ||
        seat.sessionZeroAcceptedAtSequence == null
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有替该真人角色回应的席位权限。");
      }
      const sourceAction = product.actionHistory.find(
        (action) => action.eventSequence === actionSequence,
      );
      const sourceReceipt = sourceAction?.receipt;
      if (!sourceReceipt || sourceReceipt.receiptKey !== actionReceiptKey) {
        throw new Error(
          "[ttrpg] 真人回应绑定的 ActionReceipt 不存在或已变化。",
        );
      }
      const observer = sourceReceipt.context.observers.find(
        (item) => item.actorKey === actorKey,
      );
      const promptWindow = sourceReceipt.context.reactionWindows.some(
        (window) =>
          window.status !== "closed" &&
          window.layer === "immediate-character" &&
          window.humanConfirmationRequiredActorKeys.includes(actorKey),
      );
      if (observer?.responsePolicy !== "prompt-human" || !promptWindow) {
        throw new Error("[ttrpg] 该角色没有属于本人的开放回应窗口。");
      }
      if (
        (product.humanResponses ?? []).some(
          (response) =>
            response.actionSequence === actionSequence &&
            response.actorKey === actorKey,
        )
      ) {
        throw new Error("[ttrpg] 该真人角色已经回应本次行动。");
      }
      const response: TtrpgRuntimeHumanResponseV2 = {
        schema: "storyforge.ttrpg-human-response",
        version: 2,
        responseKey: `human-response.${actionSequence}.${actorKey}`,
        eventSequence: sequence,
        actionSequence,
        actionReceiptKey,
        actorKey,
        kind,
        text,
        audience,
        viewerKey,
      };
      return {
        actorKey,
        targetKey: sourceAction?.actorKey ?? null,
        payload: { response },
      };
    },
  });
}

/**
 * Records a non-resolution terminal disposition without rolling dice or
 * mutating action economy. Queueing/interruption requires a structurally
 * available frozen action; cancellation may also close an unstructured draft.
 */
export async function commitTtrpgIntentDispositionV2(
  input: FormalTtrpgCommandEnvelope & {
    intentKey: string;
    actorKey: string;
    rawInput: string;
    actionKey?: string | null;
    targetKey?: string | null;
    terminalStatus: "interrupted" | "queued/deferred" | "cancelled";
    reason: string;
    submittedBy: { role: "gm" | "player"; viewerKey: string };
  },
): Promise<ProductRuntimeEvent> {
  const intentKey = input.intentKey.trim();
  const actorKey = input.actorKey.trim();
  const rawInput = input.rawInput.trim().normalize("NFC");
  const actionKey = input.actionKey?.trim() || null;
  const targetKey = input.targetKey?.trim() || null;
  const reason = input.reason.trim().normalize("NFC");
  const terminalStatus = input.terminalStatus;
  const submittedBy = {
    role: input.submittedBy?.role,
    viewerKey: input.submittedBy?.viewerKey?.trim() ?? "",
  };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(intentKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !rawInput ||
    rawInput.length > 10_000 ||
    !reason ||
    reason.length > 4_000 ||
    !["interrupted", "queued/deferred", "cancelled"].includes(terminalStatus) ||
    !["gm", "player"].includes(String(submittedBy.role)) ||
    !submittedBy.viewerKey
  ) {
    throw new Error("[ttrpg] 行动意图终态处置字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.intent.receipted",
    intent: {
      intentKey,
      actorKey,
      rawInput,
      actionKey,
      targetKey,
      terminalStatus,
      reason,
      submittedBy,
    },
    build: async ({ state, sequence, campaign, rulePack, participants }) => {
      if (submittedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
      } else if (
        !participants.some(
          (row) =>
            row.role === "player" &&
            row.actorKey === actorKey &&
            row.viewerKey === submittedBy.viewerKey &&
            ["human", "hybrid"].includes(row.controller) &&
            row.assignmentState === "claimed" &&
            row.sessionZeroAcceptedAtSequence != null,
        )
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有处置该角色行动的席位权限。");
      }
      if (terminalStatus === "interrupted" && submittedBy.role !== "gm") {
        throw new Error("[ttrpg] 只有 KP/规则权威可以确认行动被正式打断。");
      }
      assertScriptedTtrpgCampaign(campaign);
      const classification = classifyTtrpgSubmittedIntentV2({
        state,
        campaign,
        rulePack,
        actorKey,
        actionKey,
        targetKey,
      });
      if (
        terminalStatus !== "cancelled" &&
        (!actionKey || !classification.suggestedActionKeys.includes(actionKey))
      ) {
        throw new Error(
          "[ttrpg] 只有当前场景与角色卡实际授予的行动可以排队或被打断。",
        );
      }
      const receipt: TtrpgRuntimeIntentReceiptV2 = {
        schema: "storyforge.ttrpg-intent-receipt",
        version: 2,
        receiptKey: `intent-receipt.${sequence}`,
        eventSequence: sequence,
        intentKey,
        actorKey,
        rawInput,
        proposedActionKey: actionKey,
        targetKey,
        terminalStatus,
        reason,
        suggestedActionKeys: classification.suggestedActionKeys.filter(
          (candidate) => candidate !== actionKey,
        ),
      };
      return { actorKey, targetKey, payload: { receipt } };
    },
  });
}

export async function resolveTtrpgRuleCheck(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
  },
): Promise<ProductRuntimeEvent> {
  const actionKey = input.actionKey.trim();
  const actorKey = input.actorKey.trim();
  const targetKey = input.targetKey?.trim() || null;
  const difficulty = input.difficulty;
  const situationalModifier = input.situationalModifier ?? 0;
  const rollVisibility = input.rollVisibility ?? "public";
  if (!["public", "gm-only"].includes(rollVisibility)) {
    throw new Error("[ttrpg] 检定可见性无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.check.resolved",
    intent: {
      actionKey,
      actorKey,
      targetKey,
      difficulty: difficulty ?? null,
      situationalModifier,
      rollVisibility,
    },
    build: async ({ session, state, sequence, rulePack, campaign }) => {
      const ttrpg = state.ttrpg;
      if (!ttrpg?.product?.sessionZero.completed || !ttrpg.scene?.sceneKey) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      if (
        rollVisibility === "gm-only" &&
        ttrpg.product.hiddenDicePolicy === "never"
      ) {
        throw new Error("[ttrpg] 冻结 CampaignPack 不允许暗骰。");
      }
      const scene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene!.sceneKey,
      );
      const action = rulePack.actions.find((item) => item.key === actionKey);
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === actorKey,
      );
      const checkEffect = action?.effects.find(
        (effect) => effect.kind === "check",
      );
      if (
        !scene?.actionKeys.includes(actionKey) ||
        !action ||
        !template ||
        !checkEffect ||
        checkEffect.kind !== "check"
      ) {
        throw new Error("[ttrpg] 当前角色/场景没有该冻结规则行动。");
      }
      const granted =
        template.actionKeys.includes(actionKey) ||
        template.itemKeys.some((itemKey) =>
          rulePack.items
            .find((item) => item.key === itemKey)
            ?.grantedActionKeys.includes(actionKey),
        );
      if (!granted) throw new Error("[ttrpg] 角色卡没有该行动。");
      if (action.target === "self" && targetKey !== actorKey)
        throw new Error("[ttrpg] 自身行动目标必须是行动者。");
      if (
        (action.target === "single-ally" || action.target === "single-enemy") &&
        (!targetKey || targetKey === actorKey)
      ) {
        throw new Error("[ttrpg] 单体行动必须选择另一名目标。");
      }
      if (targetKey && !state.entities[targetKey])
        throw new Error("[ttrpg] 行动目标不存在。");
      assertScriptedTtrpgCampaign(campaign);
      const actorSkill = resolveTtrpgActionSkillV2({
        state,
        campaign,
        actorKey,
        actionKey,
      });
      const opponentSkill =
        targetKey == null
          ? null
          : resolveTtrpgActionSkillV2({
              state,
              campaign,
              actorKey: targetKey,
              actionKey,
            });
      const resolution = await resolveRulePackCheckV1({
        rulePack,
        checkKey: checkEffect.checkKey,
        attributeKey: checkEffect.attributeKey,
        attributes: Object.fromEntries(
          [...rulePack.attributes, ...rulePack.derivedStats].map(
            (attribute) => [
              attribute.key,
              Number(state.entities[actorKey]?.attributes[attribute.key]),
            ],
          ),
        ),
        seed: session.seed,
        nonce: `${input.commandId}:${sequence}:${actionKey}`,
        difficulty,
        situationalModifier: situationalModifier + actorSkill.skillValue,
        contestantRef: actorKey,
        opponent:
          targetKey == null
            ? undefined
            : {
                contestantRef: targetKey,
                attributeKey: checkEffect.attributeKey,
                situationalModifier: opponentSkill?.skillValue ?? 0,
                attributes: Object.fromEntries(
                  [...rulePack.attributes, ...rulePack.derivedStats].map(
                    (attribute) => [
                      attribute.key,
                      Number(
                        state.entities[targetKey]?.attributes[attribute.key],
                      ),
                    ],
                  ),
                ),
              },
      });
      const model = rulePack.diceModels.find(
        (item) => item.key === resolution.diceModelKey,
      )!;
      const modifier = ["total-vs-target", "opposed"].includes(resolution.mode)
        ? resolution.attributeModifier + resolution.situationalModifier
        : 0;
      const expression = `${resolution.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`;
      return {
        actorKey,
        targetKey: targetKey ?? actorKey,
        payload: {
          check: {
            actorKey,
            skill: action.name,
            expression,
            dice: resolution.keptDice,
            modifier,
            total: resolution.total,
            dc: resolution.difficulty,
            success: ttrpgDegreeSucceededV2(resolution.degree),
            visibility: rollVisibility,
            rule: {
              actionKey,
              checkKey: resolution.checkKey,
              attributeKey: resolution.attributeKey,
              skillKey: actorSkill.skillKey,
              skillValue: actorSkill.skillValue,
              diceModelKey: resolution.diceModelKey,
              rolledDice: resolution.dice,
              keptDice: resolution.keptDice,
              degree: resolution.degree,
              mode: resolution.mode,
              successes: resolution.successes,
              winnerRef: resolution.winnerRef,
              tiedRefs: resolution.tiedRefs,
              calculationTrace: resolution.calculationTrace,
              opponent:
                resolution.opponent == null
                  ? null
                  : {
                      contestantRef: resolution.opponent.contestantRef,
                      attributeKey: resolution.opponent.attributeKey,
                      rolledDice: resolution.opponent.dice,
                      keptDice: resolution.opponent.keptDice,
                      attributeModifier: resolution.opponent.attributeModifier,
                      total: resolution.opponent.total,
                      degree: resolution.opponent.degree,
                      rollTrace: resolution.opponent.rollTrace,
                      proofHash: resolution.opponent.proofHash,
                    },
              rollTrace: resolution.rollTrace,
              seedCommitment: resolution.seedCommitment,
              nonce: resolution.nonce,
              proofHash: resolution.proofHash,
              rulePackContentHash: ttrpg.product.rulePackContentHash,
            },
          },
        },
      };
    },
  });
}

export async function resolveTtrpgRuleAction(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    declaredIntent?: {
      intentKey: string;
      rawInput: string;
      goal?: string | null;
      method?: string | null;
    } | null;
  },
): Promise<ProductRuntimeEvent> {
  return resolveTtrpgRuleActionWithAuthority(input);
}

async function resolveTtrpgRuleActionWithAuthority(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    declaredIntent?: {
      intentKey: string;
      rawInput: string;
      goal?: string | null;
      method?: string | null;
    } | null;
    actorAuthority?: NonNullable<
      import("../types").TtrpgRuntimeRuleActionResultV1["actorAuthority"]
    >;
  },
): Promise<ProductRuntimeEvent> {
  const actionKey = input.actionKey.trim();
  const actorKey = input.actorKey.trim();
  const targetKey = input.targetKey?.trim() || null;
  const difficulty = input.difficulty;
  const situationalModifier = input.situationalModifier ?? 0;
  const rollVisibility = input.rollVisibility ?? "public";
  if (!["public", "gm-only"].includes(rollVisibility)) {
    throw new Error("[ttrpg] 检定可见性无效。");
  }
  const actorAuthority =
    input.actorAuthority == null ? null : structuredClone(input.actorAuthority);
  const declaredIntent =
    input.declaredIntent == null
      ? null
      : {
          intentKey: input.declaredIntent.intentKey.trim(),
          rawInput: input.declaredIntent.rawInput.trim().normalize("NFC"),
          goal: input.declaredIntent.goal?.trim().normalize("NFC") || null,
          method: input.declaredIntent.method?.trim().normalize("NFC") || null,
        };
  if (
    declaredIntent &&
    (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(declaredIntent.intentKey) ||
      !declaredIntent.rawInput ||
      declaredIntent.rawInput.length > 10_000 ||
      (declaredIntent.goal?.length ?? 0) > 2_000 ||
      (declaredIntent.method?.length ?? 0) > 2_000)
  ) {
    throw new Error("[ttrpg] 行动声明意图无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.rule.action.resolved",
    intent: {
      actionKey,
      actorKey,
      targetKey,
      difficulty: difficulty ?? null,
      situationalModifier,
      rollVisibility,
      actorAuthority,
      declaredIntent,
    },
    build: async ({
      session,
      state,
      sequence,
      rulePack,
      campaign,
      participants,
    }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (!ttrpg || !product?.sessionZero.completed || !ttrpg.scene?.sceneKey) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      if (
        rollVisibility === "gm-only" &&
        product.hiddenDicePolicy === "never"
      ) {
        throw new Error("[ttrpg] 冻结 CampaignPack 不允许暗骰。");
      }
      const scene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene!.sceneKey,
      );
      const action = rulePack.actions.find((item) => item.key === actionKey);
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === actorKey,
      );
      if (!scene?.actionKeys.includes(actionKey) || !action || !template) {
        throw new Error("[ttrpg] 当前角色/场景没有该冻结规则行动。");
      }
      const actorSeat =
        participants.find(
          (row) => row.role === "player" && row.actorKey === actorKey,
        ) ?? null;
      const gmSeat = participants.find((row) => row.role === "gm") ?? null;
      const gmActorAuthority =
        actorAuthority?.source === "ai-gm-npc" ||
        actorAuthority?.source === "hybrid-gm-confirmed";
      if (
        !actorAuthority &&
        (actorSeat?.controller === "ai" || actorSeat?.controller === "vacant")
      ) {
        throw new Error("[ttrpg] AI 或空缺玩家席位不能通过真人直提入口行动。");
      }
      if (
        !actorAuthority &&
        template.role === "npc" &&
        gmSeat?.controller === "ai"
      ) {
        throw new Error("[ttrpg] AI KP 控制的 NPC 不能通过真人直提入口行动。");
      }
      if (actorAuthority) {
        if (gmActorAuthority) {
          if (
            template.role !== "npc" ||
            actorSeat ||
            !gmSeat ||
            gmSeat.viewerKey !== actorAuthority.viewerKey ||
            gmSeat.sessionZeroAcceptedAtSequence == null ||
            !gmSeat.consent.safetyBoundariesAccepted ||
            !gmSeat.consent.aiIdentityDisclosed ||
            (actorAuthority.source === "ai-gm-npc" &&
              gmSeat.controller !== "ai") ||
            (actorAuthority.source === "hybrid-gm-confirmed" &&
              (gmSeat.controller !== "hybrid" ||
                !gmSeat.consent.aiAdviceAllowed))
          ) {
            throw new Error(
              "[ttrpg] AI KP 角色行动与当前 GM 席位、NPC 权威或同意策略不一致。",
            );
          }
        } else {
          const seat = actorSeat;
          if (
            !seat ||
            seat.viewerKey !== actorAuthority.viewerKey ||
            seat.sessionZeroAcceptedAtSequence == null ||
            !seat.consent.safetyBoundariesAccepted ||
            !seat.consent.aiIdentityDisclosed ||
            (actorAuthority.source === "ai-player" &&
              seat.controller !== "ai") ||
            (actorAuthority.source === "hybrid-confirmed" &&
              (seat.controller !== "hybrid" || !seat.consent.aiAdviceAllowed))
          ) {
            throw new Error(
              "[ttrpg] AI 玩家行动与当前席位控制权或同意策略不一致。",
            );
          }
        }
      }
      const economyTransition = product.actionEconomy
        ? spendTtrpgActionEconomyV2({
            economy: product.actionEconomy,
            turnOrder: ttrpg.turnOrder,
            actorKey,
            phase: action.phase,
          })
        : null;
      if (!economyTransition && ttrpg.activeActorKey !== actorKey) {
        throw new Error("[ttrpg] 当前还没轮到该行动者。");
      }
      const inventoryItemKeys =
        product.inventory == null
          ? template.itemKeys
          : Object.values(product.inventory.items)
              .filter(
                (item) =>
                  item.ownerRef === actorKey &&
                  !item.stateTags.includes("broken"),
              )
              .map((item) => item.definitionRef);
      const granted =
        template.actionKeys.includes(actionKey) ||
        inventoryItemKeys.some((itemKey) =>
          rulePack.items
            .find((item) => item.key === itemKey)
            ?.grantedActionKeys.includes(actionKey),
        );
      if (!granted) throw new Error("[ttrpg] 角色卡没有该行动。");
      const participantSet = new Set(ttrpg.turnOrder);
      let resolvedTargetKey: string | null = targetKey;
      if (action.target === "self") resolvedTargetKey = actorKey;
      else if (action.target === "scene") resolvedTargetKey = null;
      else if (
        !resolvedTargetKey ||
        resolvedTargetKey === actorKey ||
        !participantSet.has(resolvedTargetKey)
      ) {
        throw new Error("[ttrpg] 单体行动必须选择当前场景中的另一名目标。");
      }
      if (
        !state.entities[actorKey] ||
        (resolvedTargetKey && !state.entities[resolvedTargetKey])
      ) {
        throw new Error("[ttrpg] 行动者或目标不存在。");
      }
      assertScriptedTtrpgCampaign(campaign);
      const actorSkill = resolveTtrpgActionSkillV2({
        state,
        campaign,
        actorKey,
        actionKey,
      });
      const opponentSkill =
        resolvedTargetKey == null
          ? null
          : resolveTtrpgActionSkillV2({
              state,
              campaign,
              actorKey: resolvedTargetKey,
              actionKey,
            });

      const completesTurn = economyTransition
        ? economyTransition.nextActorKey != null
        : action.phase === "action";
      const { outcome, check, resourceChanges, conditionChanges, abilityChange } =
        await resolveTtrpgRuleActionMechanicalV1({ state, rulePack, action, actorKey,
          targetKey: resolvedTargetKey, seed: session.seed, commandId: input.commandId,
          sequence, currentRound: ttrpg.round, advanceConditions: completesTurn,
          difficulty, situationalModifier, rollVisibility, actorSkill, opponentSkill });
      const currentIndex = ttrpg.turnOrder.indexOf(actorKey);
      const shouldAdvance = action.phase === "action";
      const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
      const nextActorKey =
        economyTransition?.nextActorKey ??
        (shouldAdvance ? ttrpg.turnOrder[nextIndex] : null);
      const nextRound =
        economyTransition?.nextRound ??
        (shouldAdvance ? ttrpg.round + (nextIndex === 0 ? 1 : 0) : ttrpg.round);
      const receipt = createTtrpgActionReceiptV2({
        state,
        campaign,
        rulePack,
        sequence,
        sceneKey: scene.sceneKey,
        action,
        actorKey,
        targetKey: resolvedTargetKey,
        check,
        outcome,
        resourceChanges,
        conditionChanges,
        abilityChange,
        nextActorKey,
        nextRound,
        participantControllers: Object.fromEntries(
          participants.flatMap((row) =>
            row.actorKey == null ? [] : [[row.actorKey, row.controller]],
          ),
        ),
        declaredIntent,
      });
      return {
        actorKey,
        targetKey: resolvedTargetKey,
        payload: {
          result: {
            eventSequence: sequence,
            actionKey,
            actionName: action.name,
            actorKey,
            targetKey: resolvedTargetKey,
            actionPhase: action.phase,
            outcome,
            check,
            resourceChanges,
            conditionChanges,
            abilityChange,
            actorAuthority,
            receipt,
            nextActorKey,
            nextRound,
          },
        },
      };
    },
  });
}

/**
 * GM-authorized short/long rest. The command resets only usages explicitly
 * named by the frozen RulePack and writes every before/after value to replay.
 */
export async function completeTtrpgRestV2(
  input: FormalTtrpgCommandEnvelope & {
    restKey: string;
    kind: "short-rest" | "long-rest";
    actorKeys: string[];
    gmKey: string;
    reason: string;
  },
): Promise<ProductRuntimeEvent> {
  const restKey = input.restKey.trim();
  const kind = input.kind;
  const actorKeys = [...new Set(input.actorKeys.map((key) => key.trim()))];
  const gmKey = input.gmKey.trim();
  const reason = input.reason.trim().normalize("NFC");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(restKey) ||
    !["short-rest", "long-rest"].includes(kind) ||
    !actorKeys.length ||
    actorKeys.some((key) => !key) ||
    !gmKey ||
    !reason ||
    reason.length > 2_000
  ) {
    throw new Error("[ttrpg] 休息命令字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.rest.completed",
    intent: { restKey, kind, actorKeys, gmKey, reason },
    build: async ({ state, sequence, rulePack, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        !product.abilityStates ||
        product.ending ||
        ttrpg?.encounter?.status === "active" ||
        (product.restHistory ?? []).some((item) => item.restKey === restKey)
      ) {
        throw new Error("[ttrpg] 当前战役不能完成这次休息。");
      }
      if (
        actorKeys.some(
          (key) => !product.sessionZero.selectedCharacterKeys.includes(key),
        )
      ) {
        throw new Error(
          "[ttrpg] 休息对象必须是 Session Zero 已确认的玩家角色。",
        );
      }
      const abilityChanges: TtrpgRuntimeRestReceiptV2["abilityChanges"] =
        Object.entries(product.abilityStates).flatMap(([stateKey, before]) => {
          if (!actorKeys.includes(before.actorInstanceId)) return [];
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes(kind)) return [];
          return [
            {
              stateKey,
              actorKey: before.actorInstanceId,
              abilityKey: before.abilityKey,
              before: structuredClone(before),
              after: resetTtrpgAbilityUsageV2({
                definition: {
                  abilityKey: action.key,
                  actionDefinitionKey: action.key,
                  usage: action.usage,
                },
                state: before,
                trigger: kind,
                eventId: `event.${sequence}`,
              }),
            },
          ];
        });
      const receipt: TtrpgRuntimeRestReceiptV2 = {
        schema: "storyforge.ttrpg-rest-receipt",
        version: 2,
        eventSequence: sequence,
        restKey,
        kind,
        actorKeys,
        completedBy: gmKey,
        reason,
        abilityChanges,
      };
      return {
        actorKey: gmKey,
        targetKey: restKey,
        payload: { receipt, rulePack },
      };
    },
  });
}

/**
 * The only commit gate for AI/hybrid player candidates. The mechanical action
 * is re-derived by RulePack after verifying the exact Instance-owned durable
 * checkpoint and, for hybrid seats, a human confirmation event.
 */
export async function commitTtrpgPlayerActionFromHarnessV1(input: {
  sessionId: number;
  runId: number;
  candidateHash: string;
}): Promise<ProductRuntimeEvent> {
  if (
    !Number.isInteger(input.runId) ||
    input.runId < 1 ||
    !/^[0-9a-f]{64}$/.test(input.candidateHash)
  ) {
    throw new Error("[ttrpg] AI 玩家候选授权无效。");
  }
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    session.worldId == null ||
    session.workId == null
  ) {
    throw new Error("[ttrpg] AI 玩家运行缺少正式工作区 owner。");
  }
  const scope = {
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
  };
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  // These readers each use their own verified Dexie boundary; keep them
  // sequential so nested read transactions cannot outlive one another.
  const run = await readInstanceAgentRunV1(scope, input.runId);
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    scope,
    input.runId,
    { owner: "instance" },
  );
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId);
  const candidate = checkpoint?.resumePayload;
  if (
    !isObject(candidate) ||
    candidate.schema !== "storyforge.ttrpg-player-action-candidate" ||
    candidate.version !== 1 ||
    candidate.portable !== false ||
    candidate.runId !== input.runId ||
    candidate.productRuntimeSessionId !== input.sessionId ||
    candidate.candidateHash !== input.candidateHash ||
    typeof candidate.actorKey !== "string" ||
    typeof candidate.seatKey !== "string" ||
    typeof candidate.viewerKey !== "string" ||
    typeof candidate.actionKey !== "string" ||
    typeof candidate.approach !== "string" ||
    typeof candidate.contextManifestHash !== "string" ||
    typeof candidate.baseSequence !== "number" ||
    typeof candidate.stateHash !== "string"
  ) {
    throw new Error("[ttrpg] AI 玩家检查点候选无效。");
  }
  const { candidateHash: _candidateHash, ...candidateBody } = candidate;
  const expectedCandidateHash = await (
    await import("../agent/run/hash")
  ).hashCanonicalValue(candidateBody);
  if (
    expectedCandidateHash !== input.candidateHash ||
    run.run.productRuntimeSessionId !== input.sessionId ||
    run.contract.permissions.contextSourceKeys.length !== 1 ||
    run.contract.permissions.contextSourceKeys[0] !== "ttrpgPlayerRuntime" ||
    run.contract.scope.runtime?.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== candidate.baseSequence ||
    run.contract.scope.runtime.stateHash !== candidate.stateHash
  ) {
    throw new Error("[ttrpg] AI 玩家 RunContract、上下文或候选哈希不一致。");
  }
  const seat = participants.find(
    (row) =>
      row.seatKey === candidate.seatKey && row.actorKey === candidate.actorKey,
  );
  if (
    !seat ||
    seat.viewerKey !== candidate.viewerKey ||
    seat.controller !== candidate.controller
  ) {
    throw new Error("[ttrpg] AI 玩家候选与当前席位不一致。");
  }
  const persisted = run.events.find(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === input.candidateHash,
  );
  if (!persisted || persisted.type !== "candidate.persisted")
    throw new Error("[ttrpg] AI 玩家候选没有持久化证据。");
  const hybrid = seat.controller === "hybrid";
  if (persisted.payload.requiresConfirmation !== hybrid) {
    throw new Error("[ttrpg] AI 玩家候选确认策略与席位控制权不一致。");
  }
  if (
    hybrid &&
    !run.events.some(
      (event) =>
        event.type === "confirmation.recorded" &&
        event.payload.candidateHash === input.candidateHash &&
        event.payload.decision === "adopt",
    )
  ) {
    throw new Error("[ttrpg] 混合席位行动候选尚未获得真人确认。");
  }
  return resolveTtrpgRuleActionWithAuthority({
    sessionId: input.sessionId,
    commandId: `ttrpg-ai-player:${input.runId}:${input.candidateHash.slice(0, 32)}`,
    baseSequence: Number(candidate.baseSequence),
    baseStateHash: String(candidate.stateHash),
    actionKey: String(candidate.actionKey),
    actorKey: String(candidate.actorKey),
    targetKey: candidate.targetKey == null ? null : String(candidate.targetKey),
    difficulty:
      candidate.defaultDifficulty == null
        ? undefined
        : Number(candidate.defaultDifficulty),
    situationalModifier: 0,
    actorAuthority: {
      source: hybrid ? "hybrid-confirmed" : "ai-player",
      viewerKey: String(candidate.viewerKey),
      runId: input.runId,
      candidateHash: input.candidateHash,
      contextManifestHash: String(candidate.contextManifestHash),
      approach: String(candidate.approach),
      spokenIntent:
        candidate.spokenIntent == null ? null : String(candidate.spokenIntent),
    },
  });
}

/**
 * The only commit gate for an AI/hybrid GM choosing an NPC's formal action.
 * The model may choose only an intent from the current GM projection; the
 * frozen RulePack still derives dice, effects, costs and turn advancement.
 */
export async function commitTtrpgGmActorActionFromHarnessV1(input: {
  sessionId: number;
  runId: number;
  candidateHash: string;
}): Promise<ProductRuntimeEvent> {
  if (
    !Number.isInteger(input.runId) ||
    input.runId < 1 ||
    !/^[0-9a-f]{64}$/.test(input.candidateHash)
  ) {
    throw new Error("[ttrpg] AI KP 角色行动候选授权无效。");
  }
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    session.worldId == null ||
    session.workId == null
  ) {
    throw new Error("[ttrpg] AI KP 运行缺少正式工作区 owner。");
  }
  const scope = {
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
  };
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  const run = await readInstanceAgentRunV1(scope, input.runId);
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    scope,
    input.runId,
    { owner: "instance" },
  );
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId);
  const candidate = checkpoint?.resumePayload;
  if (
    !isObject(candidate) ||
    candidate.schema !== "storyforge.ttrpg-gm-actor-action-candidate" ||
    candidate.version !== 1 ||
    candidate.portable !== false ||
    candidate.runId !== input.runId ||
    candidate.productRuntimeSessionId !== input.sessionId ||
    candidate.candidateHash !== input.candidateHash ||
    typeof candidate.actorKey !== "string" ||
    typeof candidate.viewerKey !== "string" ||
    typeof candidate.actionKey !== "string" ||
    typeof candidate.approach !== "string" ||
    typeof candidate.contextManifestHash !== "string" ||
    typeof candidate.baseSequence !== "number" ||
    typeof candidate.stateHash !== "string"
  ) {
    throw new Error("[ttrpg] AI KP 角色行动检查点候选无效。");
  }
  const { candidateHash: _candidateHash, ...candidateBody } = candidate;
  const expectedCandidateHash = await (
    await import("../agent/run/hash")
  ).hashCanonicalValue(candidateBody);
  if (
    expectedCandidateHash !== input.candidateHash ||
    run.run.productRuntimeSessionId !== input.sessionId ||
    run.contract.permissions.contextSourceKeys.length !== 1 ||
    run.contract.permissions.contextSourceKeys[0] !== "ttrpgNpcRuntime" ||
    run.contract.scope.runtime?.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== candidate.baseSequence ||
    run.contract.scope.runtime.stateHash !== candidate.stateHash
  ) {
    throw new Error(
      "[ttrpg] AI KP 角色行动 RunContract、上下文或候选哈希不一致。",
    );
  }
  const gmSeat = participants.find((row) => row.role === "gm");
  if (
    !gmSeat ||
    gmSeat.viewerKey !== candidate.viewerKey ||
    gmSeat.controller !== candidate.controller
  ) {
    throw new Error("[ttrpg] AI KP 候选与当前 GM 席位不一致。");
  }
  const persisted = run.events.find(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === input.candidateHash,
  );
  if (!persisted || persisted.type !== "candidate.persisted") {
    throw new Error("[ttrpg] AI KP 角色行动候选没有持久化证据。");
  }
  const hybrid = gmSeat.controller === "hybrid";
  if (persisted.payload.requiresConfirmation !== hybrid) {
    throw new Error("[ttrpg] AI KP 候选确认策略与 GM 控制权不一致。");
  }
  if (
    hybrid &&
    !run.events.some(
      (event) =>
        event.type === "confirmation.recorded" &&
        event.payload.candidateHash === input.candidateHash &&
        event.payload.decision === "adopt",
    )
  ) {
    throw new Error("[ttrpg] 混合 GM 角色行动候选尚未获得真人确认。");
  }
  return resolveTtrpgRuleActionWithAuthority({
    sessionId: input.sessionId,
    commandId: `ttrpg-ai-gm-actor:${input.runId}:${input.candidateHash.slice(0, 32)}`,
    baseSequence: Number(candidate.baseSequence),
    baseStateHash: String(candidate.stateHash),
    actionKey: String(candidate.actionKey),
    actorKey: String(candidate.actorKey),
    targetKey: candidate.targetKey == null ? null : String(candidate.targetKey),
    difficulty:
      candidate.defaultDifficulty == null
        ? undefined
        : Number(candidate.defaultDifficulty),
    situationalModifier: 0,
    actorAuthority: {
      source: hybrid ? "hybrid-gm-confirmed" : "ai-gm-npc",
      viewerKey: String(candidate.viewerKey),
      runId: input.runId,
      candidateHash: input.candidateHash,
      contextManifestHash: String(candidate.contextManifestHash),
      approach: String(candidate.approach),
      spokenIntent:
        candidate.spokenIntent == null ? null : String(candidate.spokenIntent),
    },
  });
}

/**
 * Commit author-confirmed GM prose for one already-resolved formal action.
 * This command never changes dice, resources, conditions, turns, clues, or
 * scene progression; those remain owned by RulePack commands.
 */
export async function commitTtrpgGmNarrationFromHarnessV1(
  input: FormalTtrpgCommandEnvelope & {
    runId: number;
    candidateHash: string;
    actionSequence: number;
    text: string;
    synthesisFrame: import("../types").TtrpgRuntimeGmSynthesisFrameV2;
  },
): Promise<ProductRuntimeEvent> {
  const runId = input.runId;
  const candidateHash = input.candidateHash.trim();
  const actionSequence = input.actionSequence;
  const narration = input.text.trim();
  if (
    !Number.isInteger(runId) ||
    runId < 1 ||
    !/^[0-9a-f]{64}$/.test(candidateHash) ||
    !Number.isInteger(actionSequence) ||
    actionSequence < 1 ||
    !narration ||
    narration.length > 20_000
  ) {
    throw new Error("[ttrpg] AI GM 候选授权或叙事无效。");
  }

  // A formal narration is accepted only after the Instance-owned durable Run
  // recorded an explicit author confirmation for the exact candidate hash.
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session || session.worldId == null || session.workId == null) {
    throw new Error("[ttrpg] AI GM 运行缺少正式工作区 owner。");
  }
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const run = await readInstanceAgentRunV1(
    {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    runId,
  );
  if (
    run.run.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime?.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== input.baseSequence ||
    run.contract.scope.runtime.stateHash !== input.baseStateHash
  ) {
    throw new Error("[ttrpg] AI GM RunContract 与当前战役基线不一致。");
  }
  const gm = (await db.ttrpgSessionParticipants.where('sessionId').equals(input.sessionId).toArray()).find(seat => seat.role === 'gm');
  const automatic = run.contract.acceptance.some(item => item.id === 'runtime.ai-gm-authorized' && item.kind === 'deterministic-check');
  if (automatic && (gm?.controller !== 'ai' || !gm.consent.aiIdentityDisclosed || !gm.consent.safetyBoundariesAccepted))
    throw new Error('[ttrpg] AI KP 自动主持授权已失效。');
  if (!run.contract.permissions.contextSourceKeys.includes('ttrpgPublicNarration'))
    throw new Error('[ttrpg] AI KP 叙述未绑定公开信息边界。');
  const persisted = run.events.some(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === candidateHash &&
      event.payload.requiresConfirmation === !automatic,
  );
  const confirmed = run.events.some(
    (event) =>
      event.type === "confirmation.recorded" &&
      event.payload.candidateHash === candidateHash &&
      event.payload.decision === "adopt",
  );
  if (!persisted || (!automatic && !confirmed))
    throw new Error("[ttrpg] AI GM 候选尚未获得作者确认。");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    runId,
    { owner: "instance" },
  );
  const frozenCandidate = checkpoint?.resumePayload;
  if (
    !isObject(frozenCandidate) ||
    frozenCandidate.candidateHash !== candidateHash ||
    frozenCandidate.runId !== runId ||
    frozenCandidate.productRuntimeSessionId !== input.sessionId ||
    frozenCandidate.baseSequence !== input.baseSequence ||
    frozenCandidate.stateHash !== input.baseStateHash ||
    frozenCandidate.actionSequence !== actionSequence ||
    frozenCandidate.narration !== narration ||
    (frozenCandidate.requiresHumanConfirmation === false) !== automatic ||
    stableJson(frozenCandidate.synthesisFrame) !==
      stableJson(input.synthesisFrame)
  ) {
    throw new Error("[ttrpg] AI GM 提交内容与已确认候选不一致。");
  }
  const { assertTtrpgGmRuntimeHarnessFreshV1 } = await import('../agent/run/runtime-scope');
  const existingNarration = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, input.commandId]).first();
  if (!existingNarration) await assertTtrpgGmRuntimeHarnessFreshV1({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId }, contractScope: run.contract.scope });
  const modelEvidence = parseTtrpgModelEvidenceV1(
    frozenCandidate.modelEvidence,
  );
  const modelCalls = Array.isArray(frozenCandidate.modelCalls)
    ? frozenCandidate.modelCalls
        .map(parseTtrpgModelEvidenceV1)
        .filter((item): item is TtrpgRuntimeModelEvidenceV1 => item != null)
    : modelEvidence
      ? [modelEvidence]
      : [];
  const repairApplied = isObject(frozenCandidate.repairEvidence);
  if (modelCalls.length > 2)
    throw new Error("[ttrpg] AI GM 模型调用证据超过固定预算。");

  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: { runId, candidateHash, actionSequence, text: narration },
    build: async ({ state }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== actionSequence
      ) {
        throw new Error("[ttrpg] AI GM 候选没有绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] AI GM 综合反馈缺少 ActionReceipt。");
        })();
      const synthesisFrame = parseTtrpgGmSynthesisFrameV2(
        input.synthesisFrame,
        receipt,
      );
      return {
        actorKey: null,
        targetKey: latest.actorKey,
        payload: {
          actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: narration,
          candidateHash,
          runId,
          modelEvidence,
          modelCalls,
          repairApplied,
          synthesisFrame,
          source: "ai-confirmed",
        },
      };
    },
  });
}

/**
 * Commit prose written by the authenticated human GM for the latest resolved
 * RulePack action. Human narration is first-class campaign history, but it is
 * never allowed to alter dice, resources, conditions, clues, turns or scenes.
 */
export async function commitTtrpgHumanGmNarrationV1(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
    text: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const actionSequence = input.actionSequence;
  const narration = input.text.trim().normalize("NFC");
  const gmKey = input.gmKey.trim();
  if (
    !Number.isInteger(actionSequence) ||
    actionSequence < 1 ||
    !narration ||
    narration.length > 20_000 ||
    !gmKey ||
    gmKey.length > 160
  ) {
    throw new Error("[ttrpg] 真人 GM 叙事输入无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: { actionSequence, text: narration, gmKey, source: "human-gm" },
    build: async ({ state }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== actionSequence
      ) {
        throw new Error("[ttrpg] 真人 GM 叙事必须绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      assertTtrpgFeedbackOutcomeConsistentV2(narration, latest.outcome);
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] 真人 GM 综合反馈缺少 ActionReceipt。");
        })();
      return {
        actorKey: gmKey,
        targetKey: latest.actorKey,
        payload: {
          actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: narration,
          candidateHash: null,
          runId: null,
          source: "human-gm",
          synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
        },
      };
    },
  });
}

function deterministicTtrpgNarrationV1(
  state: ProductRuntimeState,
  action: import("../types").TtrpgRuntimeRuleActionResultV1,
  rulePack: ReturnType<typeof parseRulePackV1>,
): string {
  const actorName = state.entities[action.actorKey]?.name ?? action.actorKey;
  const degreeLabels = {
    automatic: "规则自动生效",
    "critical-failure": "严重失败",
    failure: "失败，但场景仍可继续推进",
    "partial-success": "部分成功，并伴随代价",
    success: "成功",
    "hard-success": "困难成功",
    "extreme-success": "极难成功",
    "critical-success": "卓越成功",
  } as const;
  const parts = [
    `${actorName}执行「${action.actionName}」：${degreeLabels[action.outcome]}。`,
  ];
  if (action.check) {
    const signedModifier =
      action.check.modifier === 0
        ? ""
        : action.check.modifier > 0
          ? ` + ${action.check.modifier}`
          : ` - ${Math.abs(action.check.modifier)}`;
    parts.push(
      `检定 ${action.check.dice.join(" + ")}${signedModifier} = ${action.check.total}，难度 ${action.check.dc}。`,
    );
  }
  if (action.resourceChanges.length) {
    parts.push(
      action.resourceChanges
        .map((change) => {
          const targetName =
            state.entities[change.entityKey]?.name ?? change.entityKey;
          const resourceName =
            rulePack.resources.find((item) => item.key === change.resourceKey)
              ?.name ?? change.resourceKey;
          return `${targetName}的${resourceName}由 ${change.before} 变为 ${change.after}`;
        })
        .join("；") + "。",
    );
  }
  if (action.conditionChanges.length) {
    parts.push(
      action.conditionChanges
        .map((change) => {
          const targetName =
            state.entities[change.entityKey]?.name ?? change.entityKey;
          const conditionName =
            rulePack.conditions.find((item) => item.key === change.conditionKey)
              ?.name ?? change.conditionKey;
          return change.stacks > 0
            ? `${targetName}获得${conditionName}×${change.stacks}`
            : `${targetName}移除${conditionName}`;
        })
        .join("；") + "。",
    );
  }
  if (action.nextActorKey)
    parts.push(
      `接下来轮到${state.entities[action.nextActorKey]?.name ?? action.nextActorKey}。`,
    );
  return parts.join("");
}

/**
 * Code-owned fallback used when the model is unavailable or deliberately
 * disabled. It derives every claim from the already committed RulePack result
 * and, like AI prose, cannot mutate rules, permissions, clues or scene flow.
 */
export async function commitTtrpgDeterministicFallbackV1(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
  },
): Promise<ProductRuntimeEvent> {
  if (!Number.isInteger(input.actionSequence) || input.actionSequence < 1) {
    throw new Error("[ttrpg] 确定性旁白动作序号无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: {
      actionSequence: input.actionSequence,
      source: "deterministic-fallback",
    },
    build: async ({ state, rulePack }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== input.actionSequence
      ) {
        throw new Error("[ttrpg] 确定性旁白必须绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === input.actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] 确定性综合反馈缺少 ActionReceipt。");
        })();
      return {
        actorKey: null,
        targetKey: latest.actorKey,
        payload: {
          actionSequence: input.actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: deterministicTtrpgNarrationV1(state, latest, rulePack),
          candidateHash: null,
          runId: null,
          source: "deterministic-fallback",
          synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
        },
      };
    },
  });
}

export async function completeTtrpgCampaignEnding(
  input: FormalTtrpgCommandEnvelope & {
    endingKey: string;
    completedBy: string;
  },
): Promise<ProductRuntimeEvent> {
  const endingKey = input.endingKey.trim();
  const completedBy = input.completedBy.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.ended",
    intent: { endingKey, completedBy },
    build: async ({ state, campaign }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (
        !product ||
        product.ending ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("[ttrpg] 正式战役当前不能提交结局。");
      }
      if (!completedBy || completedBy.length > 160)
        throw new Error("[ttrpg] 战役结局提交者无效。");
      const currentScene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene?.sceneKey,
      );
      if (!currentScene || currentScene.nextSceneKeys.length > 0) {
        throw new Error(
          "[ttrpg] 只有冻结 CampaignPack 的终局场景可以选择结局。",
        );
      }
      const ending = campaign.endings.find(
        (item) => item.endingKey === endingKey,
      );
      if (!ending) throw new Error("[ttrpg] 结局不属于冻结 CampaignPack。");
      const knownConclusions = new Set(
        product.discoveredClues.flatMap((discovery) => {
          const clue = product.clueCatalog.find(
            (item) => item.clueKey === discovery.clueKey,
          );
          return clue ? [clue.conclusionKey] : [];
        }),
      );
      if (ending.trigger) {
        if (
          ending.trigger.sceneKey !== currentScene.sceneKey ||
          ending.trigger.requiredConclusionKeys.some(
            (key) => !knownConclusions.has(key),
          ) ||
          ending.trigger.forbiddenConclusionKeys.some((key) =>
            knownConclusions.has(key),
          )
        ) {
          throw new Error("[ttrpg] 当前场景与已发现结论不满足该结局触发条件。");
        }
      } else if (
        product.questProgress.some((quest) => quest.status !== "completed")
      ) {
        throw new Error("[ttrpg] 仍有主线结论未完成，不能选择无显式触发条件的结局。");
      }
      const awardedMilestones = product.advancement.milestones
        .filter(
          (item, index) =>
            !product.advancement.awardedMilestoneKeys.includes(
              item.milestoneKey,
            ) && product.questProgress[index]?.status === "completed",
        )
        .map((item) => ({
          milestoneKey: item.milestoneKey,
          award: item.award,
        }));
      return {
        actorKey: completedBy,
        targetKey: endingKey,
        payload: {
          endingKey,
          title: ending.title,
          epilogue: ending.epilogue,
          awardedMilestones,
        },
      };
    },
  });
}

/** Commit a typed AI KP decision atomically; opaque keys never become public prose. */
export async function commitTtrpgDirectorFromHarnessV1(input: { scope: import('../types').WorkspaceScope; runId: number; candidateHash: string }): Promise<ProductRuntimeEvent> {
  const { readAuthorizedTtrpgDecisionV1, ttrpgDecisionCommandIdV1 } = await import('./decision-harness');
  const { captureTtrpgDirectorViewV1, parseTtrpgDirectorOutputV1, assertTtrpgDirectorAuthorityV1, ttrpgDirectorOptionsV1 } = await import('./director-context');
  const { candidate } = await readAuthorizedTtrpgDecisionV1<import('./director-model').TtrpgDirectorPlanV1>({ ...input,
    kind: 'director', sourceKey: 'ttrpgDirector', skillId: 'prose.ttrpg-director' });
  const candidateHash = candidate.candidateHash;
  const commandId = ttrpgDecisionCommandIdV1(candidate);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([candidate.productRuntimeSessionId, commandId]).first();
  if (!prior) {
    const current = await captureTtrpgDirectorViewV1({ scope: input.scope, productRuntimeSessionId: candidate.productRuntimeSessionId });
    if (current.visibilityHash !== candidate.visibilityHash || current.releaseHash !== candidate.releaseHash
      || current.requiresHumanConfirmation !== candidate.requiresHumanConfirmation) throw new Error('[ttrpg] 主持边界已变化');
    parseTtrpgDirectorOutputV1(JSON.stringify(candidate.payload), current.view);
  }
  return appendFormalTtrpgCommand({ sessionId: candidate.productRuntimeSessionId, commandId,
    baseSequence: candidate.baseSequence, baseStateHash: candidate.stateHash, type: 'ttrpg.director.committed',
    intent: { runId: input.runId, candidateHash },
    build: async ({ state, sequence, campaign, participants }) => {
      assertTtrpgDirectorAuthorityV1(participants);
      assertScriptedTtrpgCampaign(campaign);
      const options = ttrpgDirectorOptionsV1(state, campaign);
      const reveals = candidate.payload.revealClueKeys.map(key => {
        const allowed = options.eligibleReveals.find(item => item.clueKey === key);
        if (!allowed) throw new Error('[ttrpg] 线索尚未满足发现路径');
        return { clueKey: key, actorKey: allowed.actorKey, visibility: allowed.visibility, pathKey: allowed.pathKey, failForward: allowed.failForward };
      });
      return { actorKey: options.actorKey, targetKey: options.sceneKey, payload: {
        runId: candidate.runId, candidateHash, modelCalls: candidate.modelCalls,
        decision: { ...candidate.payload, eventSequence: sequence, basisActionSequence: options.basisActionSequence,
          actorKey: options.actorKey, sceneKey: options.sceneKey, runId: candidate.runId, candidateHash, reveals },
      } };
    },
  });
}

export async function commitTtrpgPrivateGuidanceFromHarnessV1(input: { scope: import('../types').WorkspaceScope; runId: number; candidateHash: string }): Promise<ProductRuntimeEvent> {
  const { readAuthorizedTtrpgDecisionV1, ttrpgDecisionCommandIdV1 } = await import('./decision-harness');
  const { captureTtrpgPrivateGuidanceViewV1, parseTtrpgPrivateGuidanceOutputV1 } = await import('./private-guidance');
  const { candidate, snapshot } = await readAuthorizedTtrpgDecisionV1<import('./private-guidance-model').TtrpgPrivateGuidanceV1>({ ...input,
    kind: 'private-guidance', sourceKey: 'ttrpgPrivateGuidance', skillId: 'prose.ttrpg-private-guidance' });
  const commandId = ttrpgDecisionCommandIdV1(candidate);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([candidate.productRuntimeSessionId, commandId]).first();
  if (!prior) {
    const boundary = await captureTtrpgPrivateGuidanceViewV1({ scope: input.scope, productRuntimeSessionId: candidate.productRuntimeSessionId, actorKey: candidate.payload.actorKey });
    if (boundary.visibilityHash !== candidate.visibilityHash || boundary.releaseHash !== candidate.releaseHash) throw new Error('[ttrpg] 角色知情范围已变化');
    parseTtrpgPrivateGuidanceOutputV1(JSON.stringify(candidate.payload), boundary.view);
  }
  return appendFormalTtrpgCommand({ sessionId: candidate.productRuntimeSessionId, commandId, baseSequence: candidate.baseSequence, baseStateHash: candidate.stateHash,
    type: 'ttrpg.private-guidance.recorded', intent: { runId: input.runId, candidateHash: input.candidateHash },
    build: async ({ sequence, participants }) => {
      const seat = participants.find(seat => seat.actorKey === candidate.payload.actorKey && seat.role === 'player');
      if (!seat?.consent.aiAdviceAllowed || !['human', 'hybrid'].includes(seat.controller)) throw new Error('[ttrpg] 未授权这个角色接受私密指引');
      return { actorKey: candidate.payload.actorKey, targetKey: null, payload: { runId: input.runId, candidateHash: input.candidateHash, modelCalls: candidate.modelCalls,
        guidance: { ...candidate.payload, question: snapshot.contract.objective, runId: input.runId, candidateHash: input.candidateHash, eventSequence: sequence } } };
    },
  });
}

/** Explicit genuine maintenance; outstanding effect/activation owners remain pending. */
export async function advanceTtrpgOpenSituationsV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg), receipt = runtime?.openRun?.ruleReceipts.find(r => r.operationKey === input.operationKey);
  if (!runtime || !receipt) throw new Error('[ttrpg-situation] 维护需要真实规则回执。');
  const operation = runtime.openRun!.operations.find(o => o.operationKey === input.operationKey)!;
  const stepKey = nextTtrpgOpenOperationStepV1(operation)?.kind === 'situations' ? ttrpgOpenTurnOwnerStepV1(operation,'situations') : 'situations';
  const cycle = runtime.openRun!.situationCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,operation,ttrpgOpenPressureRuleSourceV1(receipt),'situations'));
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, input.commandId]).first();
  const actionKey = prior ? pressureParse.key(pressureParse.object(parseEventPayload(prior).intent, 'situation prior intent').actionKey, 'situation prior key')
    : ttrpgOpenSituationCycleActionKeyV1(cycle ? nextTtrpgOpenSituationCycleActionV1(state, cycle) : null, cycle,stepKey);
  const envelope = await openOperationEnvelopeV1(input, actionKey);
  const type = prior ? pressureParse.oneOf(prior.type, ['ttrpg.open.situations.planned', 'ttrpg.open.situations.changed', 'ttrpg.open.situations.settled'], 'situation prior type')
    : !cycle ? 'ttrpg.open.situations.planned' : nextTtrpgOpenSituationCycleActionV1(state, cycle) ? 'ttrpg.open.situations.changed' : 'ttrpg.open.situations.settled';
  return appendFormalTtrpgCommand({ ...envelope, type, intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, actionKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input), run = runtime.openRun!, content = requireTtrpgOpenContent(context.ttrpgContent), receipt = run.ruleReceipts.find(r => r.operationKey === input.operationKey)!;
      if (nextTtrpgOpenOperationStepV1(operation)?.kind !== 'situations') throw new Error('[ttrpg-situation] 维护只能接在真实压力步骤之后。');
      const common = { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, causeRef: receipt.sourceRef };
      const actual = run.situationCycles?.find(c => ttrpgOpenTurnCycleMatchesV1(c,operation,ttrpgOpenPressureRuleSourceV1(receipt),'situations'));
      if (!actual) {
        if (actionKey !== `${ttrpgOpenTurnOwnerStepV1(operation,'situations')}.plan`) throw new Error('[ttrpg-situation] 维护计划已变化。');
        const cycle = parseTtrpgOpenSituationCycleV1({ ...ttrpgOpenSituationCatalogSnapshotV1(content.campaign, run), ...ttrpgOpenTurnCycleMetadataV1(operation,'situations'),cycleKey: await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'situations', [receipt.sourceRef.sessionKey, String(receipt.sourceRef.sequence),...(operation.settlementOrder ? [ttrpgOpenTurnOwnerStepV1(operation,'situations')] : [])]),
          ruleSourceRef: ttrpgOpenPressureRuleSourceV1(receipt), startedRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, frozenContent: content,
          contentHash: await hashProductProductionValueV2(content), runtimeSourceHash: context.session.runtimeSourceHash, situationKeys: run.situations.active.map(i => i.situationKey),
          maintenanceRefs: [], queueCredits: ttrpgOpenSituationQueueCreditsV1(context.state), queueRefs: [], work: [], completedRef: null });
        return { actorKey: 'gm', targetKey: null, payload: { ...common, cycle } };
      }
      if (actual.runtimeSourceHash !== context.session.runtimeSourceHash || actual.contentHash !== await hashProductProductionValueV2(content) || stableJson(actual.frozenContent) !== stableJson(content)) throw new Error('[ttrpg-situation] 维护冻结来源已变化。');
      const action = nextTtrpgOpenSituationCycleActionV1(context.state, actual);
      if (actionKey !== ttrpgOpenSituationCycleActionKeyV1(action, actual)) throw new Error('[ttrpg-situation] 待执行维护已变化。');
      if (!action) return { actorKey: 'gm', targetKey: null, payload: { ...common, cycleKey: actual.cycleKey } };
      const work = action.kind === 'work' ? actual.work.find(w => w.workKey === action.workKey) : null;
      const instanceKey = work?.kind === 'activate' ? await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'situation', [work.targetKey, String(context.sequence)]) : null;
      const settled = settleTtrpgOpenSituationCycleActionV1({ state: context.state, cycle: actual, operation, action, sequence: context.sequence, instanceKey });
      return { actorKey: 'gm', targetKey: null, payload: { ...common, cycleKey: actual.cycleKey, action, instanceKey, result: settled.result } };
    },
  });
}

export const prepareTtrpgOpenSituationEffectV1 = (input: Parameters<typeof prepareTtrpgOpenPressureEffectV1>[0]) => prepareTtrpgOpenPressureEffectV1(input, 'situations');
export const readTtrpgOpenSituationEffectApprovalViewV1 = (input: Parameters<typeof readTtrpgOpenPressureEffectApprovalViewV1>[0]) => readTtrpgOpenPressureEffectApprovalViewV1(input, 'situations');
export const proposeTtrpgOpenSituationEffectV1 = (input: Parameters<typeof proposeTtrpgOpenPressureEffectV1>[0]) => proposeTtrpgOpenPressureEffectV1(input, 'situations');
export const confirmTtrpgOpenSituationEffectV1 = (input: Parameters<typeof confirmTtrpgOpenPressureEffectV1>[0]) => confirmTtrpgOpenPressureEffectV1(input, 'situations');
export const applyTtrpgOpenSituationEffectV1 = (input: Parameters<typeof applyTtrpgOpenPressureEffectV1>[0]) => applyTtrpgOpenPressureEffectV1(input, 'situations');

/** Actual stage/safety/time classification; it never announces a story ending or closes a stage. */
export async function evaluateTtrpgOpenOperationTerminalV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, 'terminal');
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.terminal.evaluated', intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, actionKey: 'terminal' },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input), content = requireTtrpgOpenContent(context.ttrpgContent), rule = runtime.openRun!.ruleReceipts.find(r => r.operationKey === input.operationKey)!;
      const receipt = parseTtrpgOpenTerminalReceiptV1({ sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, ruleSourceRef: ttrpgOpenPressureRuleSourceV1(rule), frozenContent: content,
        contentHash: await hashProductProductionValueV2(content), runtimeSourceHash: context.session.runtimeSourceHash, decision: evaluateTtrpgOpenTerminalV1(context.state, content) });
      return { actorKey: 'gm', targetKey: null, payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, receipt } };
    },
  });
}
/** Deterministic per-human evaluation, or a final join only after every actual projection passes. */
export async function evaluateTtrpgOpenOperationGatesV1(input: TtrpgOpenOperationCommandV1 & { actorKey: string | null }): Promise<ProductRuntimeEvent> {
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!;
  const rule = runtime.openRun!.ruleReceipts.find(r => r.operationKey === input.operationKey);
  if (!rule) throw new Error('[ttrpg-gates] 四门需要真实规则回执。');
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, input.commandId]).first();
  const evaluations = runtime.openRun!.gateReceipts?.filter(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, ttrpgOpenPressureRuleSourceV1(rule)) && r.actorKey === input.actorKey) ?? [];
  const key = prior ? pressureParse.key(pressureParse.object(parseEventPayload(prior).intent, 'gate prior intent').actionKey, 'gate prior key') : input.actorKey ? `gates.${input.actorKey}.${evaluations.length}` : 'gates.settled';
  const envelope = await openOperationEnvelopeV1(input, key);
  return appendFormalTtrpgCommand({ ...envelope, type: input.actorKey ? 'ttrpg.open.gates.evaluated' : 'ttrpg.open.gates.settled',
    intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, actionKey: key },
    build: async context => {
      const { runtime, operation, epoch } = await openOperationCallerV1(context, input), run = runtime.openRun!, rule = run.ruleReceipts.find(r => r.operationKey === input.operationKey)!;
      const common = { operationKey: operation.operationKey, frozenPlanHash: operation.planHash };
      if (!input.actorKey) return { actorKey: 'gm', targetKey: null, payload: common };
      const target = ttrpgOpenGateHumanActorsV1(runtime).find(s => s.actorKey === input.actorKey);
      const terminal = run.terminalReceipts?.find(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, ttrpgOpenPressureRuleSourceV1(rule)));
      if (!target || !terminal || terminal.contentHash !== await hashProductProductionValueV2(context.ttrpgContent) || terminal.runtimeSourceHash !== context.session.runtimeSourceHash) throw new Error('[ttrpg-gates] 当前真实角色或终态来源不存在/已变化。');
      const evaluationBasisJson = ttrpgOpenGateBasisJsonV1(context.state), basisHash = await hashProductProductionValueV2(pressureParse.json(evaluationBasisJson));
      const result = evaluateTtrpgOpenPlayerGatesV1({ state: context.state, terminal, actorKey: target.actorKey, viewerKey: target.viewerKey, basisHash });
      const receipt = parseTtrpgOpenGateReceiptV1({ sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, ruleSourceRef: ttrpgOpenPressureRuleSourceV1(rule), terminalRef: terminal.sourceRef,
        authorizationEpochKey: epoch.epochKey, actorKey: target.actorKey, viewerKey: target.viewerKey, evaluationBasisJson, result });
      return { actorKey: 'gm', targetKey: null, payload: { ...common, receipt } };
    },
  });
}

export const prepareTtrpgOpenStageEffectV1 = (input: Parameters<typeof prepareTtrpgOpenPressureEffectV1>[0]) => prepareTtrpgOpenPressureEffectV1(input, 'stage');
export const readTtrpgOpenStageEffectApprovalViewV1 = (input: Parameters<typeof readTtrpgOpenPressureEffectApprovalViewV1>[0]) => readTtrpgOpenPressureEffectApprovalViewV1(input, 'stage');
export const proposeTtrpgOpenStageEffectV1 = (input: Parameters<typeof proposeTtrpgOpenPressureEffectV1>[0]) => proposeTtrpgOpenPressureEffectV1(input, 'stage');
export const confirmTtrpgOpenStageEffectV1 = (input: Parameters<typeof confirmTtrpgOpenPressureEffectV1>[0]) => confirmTtrpgOpenPressureEffectV1(input, 'stage');
export const applyTtrpgOpenStageEffectV1 = (input: Parameters<typeof applyTtrpgOpenPressureEffectV1>[0]) => applyTtrpgOpenPressureEffectV1(input, 'stage');

/** Explicit current human GM closure; private summary is not a public narrator candidate. */
export async function closeTtrpgOpenStageV1(input: TtrpgOpenOperationCommandV1 & { summary: string }): Promise<ProductRuntimeEvent> {
  const summary = pressureParse.text(input.summary, 'explicit stage summary'), envelope = await openOperationEnvelopeV1(input, 'stage.close');
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.stage.closed', intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, summary, actionKey: 'stage.close' },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input, false), content = requireTtrpgOpenContent(context.ttrpgContent), run = runtime.openRun!, rule = run.ruleReceipts.find(r => r.operationKey === input.operationKey)!;
      assertTtrpgOpenPressureGmV1(runtime.authorization!, input.viewerKey);
      const decision = assertTtrpgOpenStageClosureEligibleV1(context.state, content), terminal = run.terminalReceipts?.find(r => sameTtrpgOpenPressureSourceV1(r.ruleSourceRef, ttrpgOpenPressureRuleSourceV1(rule)));
      if (!terminal) throw new Error('[ttrpg-stage] 阶段收束需要当前真实终态回执。');
      const sourceRef = { sessionKey: runtime.sessionKey, sequence: context.sequence };
      const closure = parseTtrpgOpenStageClosureV1({ cycleKey: await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'stage', [String(run.stageClosures?.length ?? 0), String(context.sequence)]), stageIndex: run.stageClosures?.length ?? 0,
        sourceRef, terminalRef: terminal.sourceRef, ruleSourceRef: ttrpgOpenPressureRuleSourceV1(rule), frozenContent: content, contentHash: await hashProductProductionValueV2(content), runtimeSourceHash: context.session.runtimeSourceHash,
        atWorldTurn: run.worldTime.worldTurn, summary: { text: summary, audience: 'gm-only' }, triggerKey: decision.closure.triggerKey, maximumReached: decision.closure.maximumReached,
        ticks: planTtrpgOpenStageClosureTicksV1(context.state, content, sourceRef), work: [], completedRef: null });
      return { actorKey: 'gm', targetKey: null, payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, closure } };
    },
  });
}
export async function advanceTtrpgOpenStageClosureV1(input: TtrpgOpenOperationCommandV1 & { cycleKey: string }): Promise<ProductRuntimeEvent> {
  const state = await readProductRuntimeState(input.sessionId), runtime = parseTtrpgRuntimeStateV2(state.ttrpg), cycle = runtime?.openRun?.stageClosures?.find(c => c.cycleKey === input.cycleKey);
  if (!cycle) throw new Error('[ttrpg-stage] 实际收束周期不存在。');
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, input.commandId]).first(), tick = cycle.ticks.find(t => !t.completedRef);
  const key = prior ? pressureParse.key(pressureParse.object(parseEventPayload(prior).intent, 'stage prior').actionKey, 'stage prior key') : tick ? `stage.clock.${tick.clockKey}` : 'stage.settled';
  const envelope = await openOperationEnvelopeV1(input, key), type = prior ? pressureParse.oneOf(prior.type, ['ttrpg.open.stage.clock.advanced', 'ttrpg.open.stage.settled'], 'stage prior type') : tick ? 'ttrpg.open.stage.clock.advanced' : 'ttrpg.open.stage.settled';
  return appendFormalTtrpgCommand({ ...envelope, type, intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, actionKey: key, cycleKey: input.cycleKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input), actual = runtime.openRun!.stageClosures?.find(c => c.cycleKey === input.cycleKey);
      if (!actual || actual.contentHash !== await hashProductProductionValueV2(context.ttrpgContent) || actual.runtimeSourceHash !== context.session.runtimeSourceHash) throw new Error('[ttrpg-stage] 实际阶段来源已变化。');
      const common = { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, cycleKey: actual.cycleKey };
      if (type === 'ttrpg.open.stage.settled') return { actorKey: 'gm', targetKey: null, payload: common };
      return { actorKey: 'gm', targetKey: null, payload: { ...common, result: settleTtrpgOpenStageClockV1({ state: context.state, closure: actual, sequence: context.sequence }).result } };
    },
  });
}

/** Explicit current human confirmation of one exact citation-bound party narration. */
type TtrpgOpenNarrationAdoptionInputV1 = TtrpgOpenOperationCommandV1 & { runId: number;requestKey: string;candidateHash: string };
export async function acceptTtrpgOpenKpNarrationV1(input: TtrpgOpenNarrationAdoptionInputV1): Promise<ProductRuntimeEvent> {
  return commitTtrpgOpenKpNarrationV1(input);
}
export async function acceptTtrpgOpenDelegatedKpNarrationV1(input: TtrpgOpenNarrationAdoptionInputV1 & {
  hostingDelegationRef: NonNullable<TtrpgOpenModelCallV1['hostingDelegationRef']>
}): Promise<ProductRuntimeEvent> {
  return commitTtrpgOpenKpNarrationV1(input,parseTtrpgOpenSourceRefV1(input.hostingDelegationRef));
}
async function commitTtrpgOpenKpNarrationV1(input: TtrpgOpenNarrationAdoptionInputV1,
  hostingDelegationRef?: NonNullable<TtrpgOpenModelCallV1['hostingDelegationRef']>): Promise<ProductRuntimeEvent> {
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error('[ttrpg-kp] 团局不存在。');
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! } }), envelope = await openOperationEnvelopeV1(input, 'narration');
  const event = await appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.narration.accepted', intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, requestKey: input.requestKey, candidateHash: input.candidateHash,...(hostingDelegationRef ? { hostingDelegationRef } : {}) },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input, false), proof = await verifyTtrpgOpenKpCandidateProofV1({ ...input, scope }), candidate = proof.candidate;
      if (hostingDelegationRef) assertTtrpgOpenDelegatedNarrationV1(context.state,{ epochKey: operation.authorizationEpochKey,viewerKey: input.viewerKey,delegationRef: hostingDelegationRef,requestKey: input.requestKey });
      assertTtrpgOpenModelActorV1(runtime.authorization!, 'prose.ttrpg-open-kp', 'gm', input.viewerKey);
      const view = await loadTtrpgOpenKpContextV1({ scope, sessionId: input.sessionId, actorKey: 'gm' });
      if (candidate.viewerKey !== input.viewerKey || candidate.binding.operationKey !== operation.operationKey || candidate.binding.frozenPlanHash !== operation.planHash
        || candidate.visibilityHash !== view.visibilityHash || candidate.admissionStateHash !== view.admissionStateHash || candidate.runtimeSourceHash !== context.session.runtimeSourceHash) throw new Error('[ttrpg-kp] 生成期间结果、接收者、权限或叙述步骤已改变。');
      const rule = runtime.openRun!.ruleReceipts.find(r => r.operationKey === operation.operationKey)!;
      if (operation.plan.rollVisibility === 'public') assertTtrpgFeedbackOutcomeConsistentV2(candidate.narration!.paragraphs.map(p => p.text).join('\n'), rule.result.outcome);
      const receipt = parseTtrpgOpenNarrationReceiptV1({ sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, binding: candidate.binding, requestKey: input.requestKey,
        ...(hostingDelegationRef ? { hostingDelegationRef } : {}),
        candidateHash: input.candidateHash, rawResponseHash: candidate.rawResponseHash, runContractHash: proof.evidence.run.contractHash, inputManifestHash: candidate.inputManifestHash,
        contextHash: candidate.visibilityHash, recipientActorKeys: [...runtime.authorization!.selectedActorKeys].sort(), narration: candidate.narration, allowedSourceKeys: proof.deliveredSourceKeys });
      return { actorKey: 'gm', targetKey: null, payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, receipt }, agentEvidence: proof.evidence };
    },
  });
  try { await reconcileTtrpgOpenKpRunV1({ ...input, scope }); } catch (error) { throw new TtrpgOpenKpReceiptPendingError(input.sessionId, event.sequence, input.runId, error); }
  return event;
}

/** Derive a prior explicit Session Zero permission; this never fabricates a new human approval. */
export async function preauthorizeTtrpgOpenCompanionV1(input: TtrpgOpenOperationCommandV1 & { runId: number; requestKey: string; candidateHash: string;
  hostingDelegationRef?: NonNullable<TtrpgOpenModelCallV1['hostingDelegationRef']>
}): Promise<ProductRuntimeEvent> {
  const hostingDelegationRef = input.hostingDelegationRef !== undefined ? parseTtrpgOpenSourceRefV1(input.hostingDelegationRef) : undefined;
  const envelope = await openOperationEnvelopeV1(input, 'preauthorization');
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.companion.preauthorized', intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, candidateHash: input.candidateHash,...(hostingDelegationRef ? { hostingDelegationRef } : {}) },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input), scope = await resolveScope({ scope: { projectId: context.session.projectId, worldId: context.session.worldId!, workId: context.session.workId! } });
      const proof = await verifyTtrpgOpenIntentCandidateProofV1({ ...input, scope }), content = requireTtrpgOpenContent(context.ttrpgContent);
      if (operation.intentEvidence?.candidateHash !== input.candidateHash) throw new Error('[ttrpg-companion] 不是本操作已确认的真实队友候选。');
      if (hostingDelegationRef) assertTtrpgOpenDelegatedCompanionProposalV1(context.state,{ epochKey: operation.authorizationEpochKey,viewerKey: input.viewerKey,
        delegationRef: hostingDelegationRef,runContractHash: operation.intentEvidence.runContractHash,actorKey: operation.plan.request.actorKey });
      const call = runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey)!;
      const semanticIntent = await (await import('./open-intent-clarification')).ttrpgOpenOperationSemanticIntentV1(operation,call,proof.candidate.intent!);
      const preview = previewTtrpgOpenCompanionPermissionV1(context.state, content, semanticIntent, operation.operationKey);
      return { actorKey: 'gm', targetKey: operation.plan.request.actorKey, payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash,
        permission: { sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, authorizationRef: runtime.authorization!.sourceRef,
          ...(hostingDelegationRef ? { hostingDelegationRef } : {}),
          candidateHash: input.candidateHash, actionKind: preview.actionKind, basis: 'session-zero-policy' }, semanticIntent, frozenContent: content, preview }, agentEvidence: proof.evidence };
    },
  });
}

/** Offer one next actor under the same original epoch. No provider call or world turn occurs. */
export async function offerTtrpgOpenHandoffV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, 'handoff');
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.handoff.offered', intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey },
    build: async context => {
      const { runtime, operation } = await openOperationCallerV1(context, input);
      return { actorKey: 'gm', targetKey: null, payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash,
        handoff: { sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, decision: evaluateTtrpgOpenHandoffV1(context.state, operation.operationKey) } } };
    },
  });
}

export async function rejectTtrpgOpenIntentCandidateCommandV1(input: FormalTtrpgCommandEnvelope & { viewerKey: string; runId: number; requestKey: string; candidateHash: string }): Promise<ProductRuntimeEvent> {
  const envelope = await openModelCallEnvelopeV1(input, 'intent-rejection');
  return appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.intent.rejected', intent: { requestKey: input.requestKey, candidateHash: input.candidateHash, viewerKey: input.viewerKey },
    build: async context => {
      const { runtime, scope } = await openModelCallCallerV1(context, input.viewerKey, true);
      const call = runtime.openRun!.coordination.calls.find(c => c.requestKey === input.requestKey);
      const candidate = await readTtrpgOpenIntentCandidateV1({ ...input, scope });
      if (!call || !candidate || candidate.candidateHash !== input.candidateHash || call.intentRejection || runtime.openRun!.operations.some(o => o.intentEvidence?.runContractHash === call.runContractHash)) throw new Error('候选已被拒绝、替换或已进入规则行动');
      const evidence = await verifyTtrpgOpenRuntimeCandidateEvidenceV1({ ...input, scope });
      return { actorKey: call.actorKey, targetKey: null, payload: { requestKey: input.requestKey, candidateHash: input.candidateHash, viewerKey: input.viewerKey,
        sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence } }, agentEvidence: evidence };
    },
  });
}

export async function recordTtrpgOpenHumanNarrationV1(input: TtrpgOpenOperationCommandV1 & { text: string; reason: import('./open-kp-receipt').TtrpgOpenHumanNarrationReceiptV1['reason'] }): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input, 'narration');
  const text = input.text.trim().normalize('NFC');
  const event = await appendFormalTtrpgCommand({ ...envelope, type: 'ttrpg.open.narration.recorded', intent: { operationKey: input.operationKey, frozenPlanHash: input.frozenPlanHash, viewerKey: input.viewerKey, text, reason: input.reason },
    build: async context => {
      const { operation } = await openOperationCallerV1(context, input, false);
      const receipt = createTtrpgOpenHumanNarrationReceiptV1(context.state, { operationKey: operation.operationKey, viewerKey: input.viewerKey, text, reason: input.reason, sequence: context.sequence });
      return { actorKey: 'gm', targetKey: null, payload: { operationKey: operation.operationKey, frozenPlanHash: operation.planHash, receipt } };
    },
  });
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error('团局已不存在');
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId!, workId: session.workId! } });
  try { await reconcileTtrpgOpenHumanNarrationV1({ ...input, scope }); } catch (error) { throw new TtrpgOpenHumanNarrationReceiptPendingError(input.sessionId, event.sequence, error); }
  return event;
}

/** One explicit deterministic local repair; no roll, charge, time or model request. */
export async function recoverTtrpgOpenOperationGatesV1(input: TtrpgOpenOperationCommandV1 & {
  evaluationRef: import('./open-coordination').TtrpgOpenSourceRefV1; evaluationBasisHash: string; gateKey: import('./open-gates').TtrpgOpenGateKeyV1; actorKey: string;
}): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input,'gates.recovery');
  const intent = { operationKey: input.operationKey,frozenPlanHash: input.frozenPlanHash,viewerKey: input.viewerKey,evaluationRef: input.evaluationRef,evaluationBasisHash: input.evaluationBasisHash,gateKey: input.gateKey,actorKey: input.actorKey };
  return appendFormalTtrpgCommand({ ...envelope,type: 'ttrpg.open.gates.recovered',intent,
    build: async context => {
      const { runtime,operation,seat } = await openOperationCallerV1(context,input,false);
      const planned = planTtrpgOpenGateRecoveryV1(context.state,operation.operationKey);
      if (!sameTtrpgOpenPressureSourceV1(planned.evaluation.sourceRef,input.evaluationRef) || planned.evaluation.result.evaluationBasisHash !== input.evaluationBasisHash || planned.gateKey !== input.gateKey || planned.evaluation.actorKey !== input.actorKey) throw new Error('实际失败评估已改变，请重新读取');
      const publicFieldsHash = planned.action === 'evidence' ? await hashTtrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(planned.terminal.frozenContent.campaign, planned.run).validationView,planned.targetRef!) : null;
      const recoveryKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey,'gate-recovery',[operation.operationKey,planned.epoch.epochKey]);
      const settled = settleTtrpgOpenGateRecoveryV1({ state: context.state,operationKey: operation.operationKey,viewerKey: input.viewerKey,recoveryKey,sequence: context.sequence,publicFieldsHash });
      return { actorKey: seat.actorKey,targetKey: settled.receipt.actorKey,payload: { operationKey: operation.operationKey,frozenPlanHash: operation.planHash,receipt: settled.receipt } };
    } });
}
export async function stopTtrpgOpenOperationGateRecoveryV1(input: TtrpgOpenOperationCommandV1): Promise<ProductRuntimeEvent> {
  const envelope = await openOperationEnvelopeV1(input,'gates.recovery.stop');
  return appendFormalTtrpgCommand({ ...envelope,type: 'ttrpg.open.gates.recovery-stopped',intent: { operationKey: input.operationKey,frozenPlanHash: input.frozenPlanHash,viewerKey: input.viewerKey },
    build: async context => {
      const { operation,seat } = await openOperationCallerV1(context,input,false);
      const settled = stopTtrpgOpenGateRecoveryV1({ state: context.state,operationKey: operation.operationKey,viewerKey: input.viewerKey,sequence: context.sequence });
      return { actorKey: seat.actorKey,targetKey: settled.receipt.actorKey,payload: { operationKey: operation.operationKey,frozenPlanHash: operation.planHash,receipt: settled.receipt } };
    } });
}


/** Explicit, post-settlement presentation. The public result contains no hidden media metadata. */
export async function applyTtrpgOpenAudioCueV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; submissionKey: string; request: TtrpgOpenAudioRequest
  uploadTicket?: TtrpgOpenAudioUploadTicketV1; generatedTicket?: TtrpgOpenAudioGeneratedTicketV2; decision: 'confirm-this-audio-and-audience'
}): Promise<{ sequence: number }> {
  input = {...input, request: structuredClone(input.request)}
  pressureParse.literal(input.decision, 'confirm-this-audio-and-audience', 'audio explicit confirmation')
  const viewerKey = openKey(input.viewerKey, 'audio viewer'), submissionKey = openKey(input.submissionKey, 'audio submission'), request = parseTtrpgOpenAudioRequest(input.request)
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (!runtime?.openRun) throw new Error('[ttrpg-audio] 需要有效开放跑团')
  const uploaded = request.media.kind === 'upload' ? readTtrpgOpenAudioUploadTicketV1(input.uploadTicket, {sessionId:input.sessionId,sessionKey:runtime.sessionKey,viewerKey,request:parseTtrpgOpenAudioRequestV1(request)}) : null
  const generatedGrant = request.media.kind === 'generated' ? readTtrpgOpenAudioGeneratedTicketV2(input.generatedTicket, {sessionId:input.sessionId,sessionKey:runtime.sessionKey,viewerKey,request:parseTtrpgOpenAudioRequestV2(request)}) : null
  const grant = generatedGrant ?? uploaded
  const retainedRef = request.media.kind === 'retained' || request.media.kind === 'stop' ? request.media.sourceRef : null
  const retained = retainedRef ? runtime.openRun.audioReceipts?.find(row => ttrpgOpenAudioSourceEqualV1(row.envelope.sourceRef, retainedRef)) : undefined
  const asset = grant?.asset ?? (request.action === 'stop' ? null : retained?.asset ?? null)
  const generated = 'version' in request ? generatedGrant?.generated ?? (retained?.version === 2 ? retained.generated : undefined) : undefined
  if ('version' in request && !generated) throw new Error('[ttrpg-audio] 生成音轨缺少原准确来源')
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'audio-control', [viewerKey, submissionKey])
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first()
  const result = await appendFormalTtrpgCommand({ ...input, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence, baseStateHash: prior?.baseStateHash ?? input.baseStateHash,
    type: 'ttrpg.audio.cue.applied', intent: { viewerKey, submissionKey, request, asset, ...(generated ? {generated} : {}), decision: input.decision },
    build: async context => {
      requireTtrpgOpenContent(context.ttrpgContent)
      const current = parseTtrpgRuntimeStateV2(context.state.ttrpg)
      if (!current?.openRun || !current.authorization || !context.session.runtimeSourceHash || context.session.worldId == null || context.session.workId == null) throw new Error('[ttrpg-audio] 缺少当前正式团局来源')
      const seat = assertTtrpgOpenAuthorizationCurrentV1({authorization:current.authorization,participants:context.participants,viewerKey})
      if (grant && (grant.runtimeSourceHash !== context.session.runtimeSourceHash || grant.sequence !== input.baseSequence || grant.stateHash !== input.baseStateHash
        || grant.scope.projectId !== context.session.projectId || grant.scope.worldId !== context.session.worldId || grant.scope.workId !== context.session.workId)) throw new Error('[ttrpg-audio] 文件核对后进度或授权已变化，请重新核对原文件')
      const events = await readSessionEvents(context.session)
      const canonical = replayProductRuntimeEvents(parseProductRuntimeState(context.session.initialStateJson), events)
      if (stableJson(canonical) !== stableJson(context.state)) throw new Error('[ttrpg-audio] 当前缓存与原事件不一致，须先核对原进度')
      await verifyTtrpgOpenAudioReceiptsV1({runtime:current,runtimeSourceHash:context.session.runtimeSourceHash,events,projectId:context.session.projectId})
      const scope = {projectId:context.session.projectId,worldId:context.session.worldId,workId:context.session.workId}
      const receipt = createTtrpgOpenAudioReceipt({runtime:current,runtimeSourceHash:context.session.runtimeSourceHash,viewerKey,request,asset,
        ...(generated ? {generated} : {}),sequence:context.sequence,commandId,submissionKey})
      const native = generatedGrant ? await readTtrpgOpenGeneratedAudioNativeProofV1({scope,sessionId:context.session.id!,viewerKey,
        requestKey:generatedGrant.generated.requestKey,candidateHash:generatedGrant.generated.completion.candidateHash}) : null
      if (native && (stableJson(native.source.completion) !== stableJson(generatedGrant!.generated.completion)
        || stableJson(native.source.artifactRefs) !== stableJson(generatedGrant!.generated.artifactRefs))) throw new Error('[ttrpg-audio] 原生成完成证据已变化')
      if (receipt.version === 2) await verifyTtrpgOpenGeneratedAudioOriginV1({projectId:scope.projectId,receipt})
      const media = asset ? await readTtrpgOpenAudioMediaWitnessV1({scope,session:context.session,expected:asset,
        ...(receipt.version===2?{exactArtifactRefs:receipt.generated.artifactRefs}:{})}) : null
      if (grant && media?.witness.asset.id !== grant.assetId) throw new Error('[ttrpg-audio] 原准备文件定位已变化')
      return {actorKey:seat.actorKey,targetKey:request.privateActorKey,payload:{receipt},eventEvidence:events,
        ...(media?{audioMediaWitness:media.witness}:{}),...(native?{generatedAudioWitness:native.witness,voiceRunSetWitness:native.runSet}:{})}
    } })
  return {sequence:result.sequence}
}

/** Human-only, zero-world-time discussion; the source policy never allows mechanical effects. */
export async function postTtrpgOpenTableMessageV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; submissionKey: string; request: TtrpgOpenTableMessageRequestV1;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey,'discussion viewer'),submissionKey = openKey(input.submissionKey,'discussion submission'),request = parseTtrpgOpenTableMessageRequestV1(input.request);
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg);
  if (!runtime?.openRun || !runtime.authorization) throw new Error('讨论需要已开始的 open 冒险');
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey,'table-message',[viewerKey,submissionKey]);
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId,commandId]).first();
  return appendFormalTtrpgCommand({ ...input,commandId,baseSequence: prior?.baseSequence ?? input.baseSequence,baseStateHash: prior?.baseStateHash ?? input.baseStateHash,
    type: 'ttrpg.open.table-message.posted',intent: { viewerKey,submissionKey,request },
    build: async context => {
      const content = requireTtrpgOpenContent(context.ttrpgContent),current = parseTtrpgRuntimeStateV2(context.state.ttrpg);
      if (!current?.openRun || !current.authorization || content.rulePack.content.timePolicy.outOfCharacter !== 0 || content.rulePack.content.timePolicy.rulesQuestion !== 0) throw new Error('讨论必须绑定当前冻结的零耗时策略');
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: current.authorization,participants: context.participants,viewerKey });
      const message = createTtrpgOpenTableMessageV1({ authorization: current.authorization,viewerKey,request,messages: current.openRun.tableMessages ?? [],
        messageKey: await ttrpgOpenScopedKeyV1(current.sessionKey,'table-message',[viewerKey,submissionKey]),sourceRef: { sessionKey: current.sessionKey,sequence: context.sequence } });
      return { actorKey: seat.actorKey,targetKey: null,payload: { message } };
    },
  });
}

/** Human-authored notes only. Formal AI candidates will use a separately registered adoption path. */
export async function recordTtrpgOpenNarrativeMemoryV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; draft: TtrpgOpenMemoryDraftV1
}): Promise<ProductRuntimeEvent> {
  assertTtrpgOpenManualMemoryInputV1(input)
  const viewerKey = input.viewerKey.trim(), draft = parseTtrpgOpenMemoryDraftV1(input.draft), commandId = normalizeCommandId(input.commandId)
  const intent = { viewerKey, origin: 'human-authored' as const, draft }
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.memory.recorded', intent,
    build: async ({ session, state, sequence, participants }) => {
      const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
      if (!runtime?.authorization || !runtime.openRun) throw new Error('[ttrpg-memory] 请先完成实际开团')
      assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: runtime.authorization, participants })
      const { seat, recipientActorKeys } = authorizeTtrpgOpenMemoryDraftV1(draft, runtime.authorization, viewerKey)
      if (draft.toEventSequence > state.lastSequence || runtime.openRun.memoryReceipts?.some(r => r.draft.revisionKey === draft.revisionKey)) throw new Error('[ttrpg-memory] 区间越界或版本已被确认')
      const events = await readSessionEvents(session, state.lastSequence)
      const replayed = replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events)
      if (stableJson(replayed) !== stableJson(state)) throw new Error('[ttrpg-memory] 实际事件重放与当前基线不一致，请先恢复原记录')
      await verifyTtrpgOpenMemoryReceiptsV1({ runtime, runtimeSourceHash: session.runtimeSourceHash, events })
      const window = events.filter(event => event.sequence >= draft.fromEventSequence && event.sequence <= draft.toEventSequence).sort((a, b) => a.sequence - b.sequence)
      const sourceEvents = await Promise.all(window.map(event => ttrpgOpenMemoryEventDigestV1(event, runtime.sessionKey)))
      const sourceRef = { sessionKey: runtime.sessionKey, sequence }
      const base = { schema: 'storyforge.ttrpg-open-memory-receipt' as const, version: 1 as const, commandId,
        draft, viewerKey, authorActorKey: seat.actorKey, authorizationRef: runtime.authorization.sourceRef, sourceRef,
        runtimeSourceHash: session.runtimeSourceHash, sourceLineageHash: await hashProductProductionValueV2(ttrpgOpenMemoryLineageBodyV1(runtime.sessionKey, session.runtimeSourceHash, runtime.branchLineage?.ancestors ?? [])), sourceEvents, recipientActorKeys,
        recordedAt: Date.now(), recordedAtWorldTurn: runtime.openRun.worldTime.worldTurn,
        origin: 'human-authored' as const, noMechanicalAuthority: true as const, noKnowledgeGrant: true as const }
      const body = { ...base, derivedFromHash: await hashProductProductionValueV2(ttrpgOpenMemoryWindowBodyV1(base)) }
      const receipt = parseTtrpgOpenMemoryReceiptV1({ ...body, receiptHash: await hashProductProductionValueV2(body) })
      return { actorKey: seat.actorKey, targetKey: null, payload: { commandId, memory: receipt, sourceLineageHash: receipt.sourceLineageHash },
        eventEvidence: events }
    },
    afterCommit: async ({ session, event }) => {
      const receipt = parseTtrpgOpenMemoryReceiptV1(JSON.parse(event.payloadJson).memory)
      await db.ttrpgNarrativeMemories.add(projectTtrpgOpenMemoryRowV1(receipt, session))
    },
  })
}

/** Explicit confirmation of a formal model candidate; never enters the manual author API. */
export async function acceptTtrpgOpenBriefMemoryV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; requestKey: string; candidateHash: string
}): Promise<ProductRuntimeEvent> {
  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session?.worldId || !session.workId) throw new Error('[ttrpg-brief] 当前跑团实例不存在')
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId } })
  const initial = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (!initial?.openRun) throw new Error('[ttrpg-brief] 当前不是已开团的开放模式')
  const commandId = await ttrpgOpenScopedKeyV1(initial.sessionKey, 'model-memory', [input.requestKey, input.candidateHash])
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first()
  const event = await appendFormalTtrpgCommand({ ...input, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash, type: 'ttrpg.memory.recorded',
    intent: { viewerKey: input.viewerKey, origin: 'model-reviewed', requestKey: input.requestKey, candidateHash: input.candidateHash },
    build: async context => {
      const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg)
      if (!runtime?.openRun || !runtime.authorization) throw new Error('[ttrpg-brief] 缺少实际授权')
      assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: runtime.authorization, participants: context.participants })
      assertTtrpgOpenModelActorV1(runtime.authorization, 'prose.ttrpg-open-brief', 'gm', input.viewerKey)
      const proof = await verifyTtrpgOpenBriefCandidateProofV1({ ...input, scope, currentSources: true }), candidate = proof.candidate
      const view = await loadTtrpgOpenBriefContextV1({ scope, sessionId: input.sessionId, actorKey: 'gm' })
      const call = runtime.openRun.coordination.calls.find(call => call.requestKey === input.requestKey)
      const baseline = proof.snapshot.contract.scope.runtime
      if (!call || candidate.viewerKey !== input.viewerKey || candidate.epochKey !== runtime.openRun.coordination.activeEpochKey
        || candidate.admissionStateHash !== view.admissionStateHash || candidate.visibilityHash !== view.visibilityHash
        || candidate.runtimeSourceHash !== context.session.runtimeSourceHash || !baseline || baseline.baseSequence !== call.createdRef.sequence - 1) throw new Error('[ttrpg-brief] 复盘来源、权限、阶段或原始窗口已经 stale')
      const draft: TtrpgOpenMemoryDraftV1 = { revisionKey: commandId, observerKey: 'gm', reliability: 'hearsay', audience: 'party', knownBy: [],
        summary: candidate.brief!.paragraphs.map(paragraph => paragraph.text).join('\n'), fromEventSequence: 1, toEventSequence: baseline.baseSequence }
      const { seat, recipientActorKeys } = authorizeTtrpgOpenMemoryDraftV1(draft, runtime.authorization, input.viewerKey)
      const events = await readSessionEvents(context.session, context.state.lastSequence)
      if (stableJson(replayProductRuntimeEvents(parseProductRuntimeState(context.session.initialStateJson), events)) !== stableJson(context.state)) throw new Error('[ttrpg-brief] 实际事件与当前状态不一致')
      await verifyTtrpgOpenMemoryReceiptsV1({ runtime, runtimeSourceHash: context.session.runtimeSourceHash, events })
      const digests = await Promise.all(events.filter(event => event.sequence <= draft.toEventSequence).map(event => ttrpgOpenMemoryEventDigestV1(event, runtime.sessionKey)))
      const roots = await ttrpgOpenMemoryPrefixRootsV2(runtime.sessionKey, digests), portableChainHash = roots.get(draft.toEventSequence)
      if (!portableChainHash) throw new Error('[ttrpg-brief] 原始来源前缀不完整')
      const base = { schema: 'storyforge.ttrpg-open-memory-receipt' as const, version: 2 as const, commandId, draft,
        viewerKey: input.viewerKey, authorActorKey: seat.actorKey, authorizationRef: runtime.authorization.sourceRef,
        sourceRef: { sessionKey: runtime.sessionKey, sequence: context.sequence }, runtimeSourceHash: context.session.runtimeSourceHash,
        sourceLineageHash: await hashProductProductionValueV2(ttrpgOpenMemoryLineageBodyV1(runtime.sessionKey, context.session.runtimeSourceHash, runtime.branchLineage?.ancestors ?? [])),
        sourceWindow: { eventCount: draft.toEventSequence, portableChainHash }, recipientActorKeys, recordedAt: Date.now(), recordedAtWorldTurn: runtime.openRun.worldTime.worldTurn,
        origin: 'model-reviewed' as const, noMechanicalAuthority: true as const, noKnowledgeGrant: true as const,
        model: { requestKey: input.requestKey, epochKey: candidate.epochKey, candidateHash: candidate.candidateHash, rawResponseHash: candidate.rawResponseHash,
          runContractHash: proof.evidence.run.contractHash, inputManifestHash: candidate.inputManifestHash, contextHash: candidate.visibilityHash,
          brief: candidate.brief!, attributions: proof.attributions } }
      const body = { ...base, derivedFromHash: await hashProductProductionValueV2(ttrpgOpenModelMemoryWindowBodyV2(base)) }
      const receipt = parseTtrpgOpenModelMemoryReceiptV2({ ...body, receiptHash: await hashProductProductionValueV2(body) })
      return { actorKey: seat.actorKey, targetKey: null, payload: { commandId, memory: receipt, sourceLineageHash: receipt.sourceLineageHash },
        agentEvidence: proof.evidence, eventEvidence: events }
    }, afterCommit: async ({ session, event }) => {
      const receipt = parseTtrpgOpenModelMemoryReceiptV2(JSON.parse(event.payloadJson).memory)
      await db.ttrpgNarrativeMemories.add(projectTtrpgOpenMemoryRowV1(receipt, session))
    } })
  try { await reconcileTtrpgOpenBriefMemoryRunV1({ ...input, scope }) }
  catch (error) { throw new TtrpgOpenBriefMemoryReceiptPendingError(input.sessionId, event.sequence, input.runId, error) }
  return event
}

/** Accept one private definition only after the actual human GM reviews its exact disclosure text. */
export async function acceptTtrpgOpenSituationV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; requestKey: string; candidateHash: string; templateHash: string; disclosure: 'player-and-discovery-text-reviewed'
}): Promise<ProductRuntimeEvent> {
  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session?.worldId || !session.workId) throw new Error('当前跑团实例不存在')
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId } })
  await assertTtrpgOpenSituationHumanGmV1({ ...input, scope })
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  if (!runtime?.openRun) throw new Error('当前不是已开团的开放模式')
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'session-situation', [input.requestKey, input.candidateHash])
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first()
  const event = await appendFormalTtrpgCommand({ ...input, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash, type: 'ttrpg.open.situation.accepted',
    intent: { viewerKey: input.viewerKey, requestKey: input.requestKey, candidateHash: input.candidateHash, templateHash: input.templateHash, disclosure: input.disclosure },
    build: async context => prepareTtrpgOpenSituationAdoptionV1({ ...input, scope }, { ...context, content: requireTtrpgOpenContent(context.ttrpgContent) }) })
  try { await reconcileTtrpgOpenSituationRunV1({ ...input, scope }) }
  catch { throw new TtrpgOpenSituationReceiptPendingError(input.sessionId, event.sequence, input.runId) }
  return event
}

/** Exactly one public candidate under the original explicit human delegation; no model call or human-review claim. */
export async function acceptTtrpgOpenPublicSituationV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; requestKey: string; candidateHash: string; templateHash: string; authorizationBasisHash: string;
}): Promise<ProductRuntimeEvent> {
  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session?.worldId || !session.workId) throw new Error('当前共同局势实例不存在')
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId } })
  const loaded = await assertTtrpgOpenSituationRequesterV1({ ...input, scope })
  const commandId = await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'public-session-situation', [input.requestKey, input.candidateHash])
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first()
  const event = await appendFormalTtrpgCommand({ ...input, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash, type: 'ttrpg.open.situation.accepted',
    intent: { mode: 'ai-host-once', viewerKey: input.viewerKey, runId: input.runId, requestKey: input.requestKey,
      candidateHash: input.candidateHash, templateHash: input.templateHash, authorizationBasisHash: input.authorizationBasisHash },
    build: async context => prepareTtrpgOpenPublicSituationAdoptionV1({ ...input, scope }, { ...context, content: requireTtrpgOpenContent(context.ttrpgContent) }) })
  try { await reconcileTtrpgOpenPublicSituationRunV1({ ...input, scope }) }
  catch { throw new TtrpgOpenSituationReceiptPendingError(input.sessionId, event.sequence, input.runId) }
  return event
}

/** Independent current human-host admission of an accepted definition, never part of drafting. */
export async function activateTtrpgOpenSessionSituationV1(input: FormalTtrpgCommandEnvelope & { viewerKey: string; templateKey: string }): Promise<ProductRuntimeEvent> {
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.open.situation.activated', intent: { viewerKey: input.viewerKey, templateKey: input.templateKey },
    build: async context => {
      const runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg)
      if (!runtime?.authorization || !runtime.openRun) throw new Error('局势准入需要当前真实授权')
      assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization: runtime.authorization, participants: context.participants })
      const content = requireTtrpgOpenContent(context.ttrpgContent), instanceKey = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'situation', [input.templateKey, String(context.sequence)])
      const settled = settleTtrpgOpenSessionSituationAdmissionV1({ ...input, state: context.state, content, instanceKey, sequence: context.sequence })
      await verifyTtrpgOpenSessionSituationHashesV1([settled.receipt])
      return { actorKey: 'gm', targetKey: input.templateKey, payload: { frozenContent: content, ownerReceiptHash: settled.receipt.receiptHash, instanceKey, result: settled.result } }
    } })
}

/** Exact model candidate becomes only a pending plan, with a separate event and source contract. */
export async function acceptTtrpgOpenEntityCandidateV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; runId: number; requestKey: string; candidateHash: string; decision: 'reviewed-this-model-entity-candidate';
}): Promise<ProductRuntimeEvent> {
  if (input.decision !== 'reviewed-this-model-entity-candidate') throw new Error('请明确审阅本次原模型实体候选。')
  const session = await db.productRuntimeSessions.get(input.sessionId)
  if (!session?.worldId || !session.workId) throw new Error('当前跑团实例不存在')
  const scope = await resolveScope({ scope: { projectId: session.projectId, worldId: session.worldId, workId: session.workId } })
  await assertTtrpgOpenEntityCandidateReaderV1({ ...input, scope })
  const owner = await (await import('../agent/run/event-store')).readInstanceAgentRunV1(scope, input.runId)
  if (owner.run.portableRuntimeOriginJson || owner.run.productRuntimeSessionId !== input.sessionId) throw new Error('实体候选采用只允许准确原本地 Run；导入证据不授予新采用权限。')
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)!
  const requestKey = openKey(input.requestKey, 'entity original request'), candidateHash = openHash(input.candidateHash, 'entity original candidate')
  const commandId = await ttrpgOpenScopedKeyV1(runtime.sessionKey, 'model-entity-plan', [requestKey, candidateHash])
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, commandId]).first()
  const event = await appendFormalTtrpgCommand({ ...input, commandId, baseSequence: prior?.baseSequence ?? input.baseSequence,
    baseStateHash: prior?.baseStateHash ?? input.baseStateHash, type: 'ttrpg.open.entity.model-proposed',
    intent: { origin: 'model-entity-candidate', viewerKey: input.viewerKey, requestKey, candidateHash, decision: input.decision },
    build: async context => prepareTtrpgOpenEntityAdoptionV1({ ...input, scope }, { ...context, commandId, content: requireTtrpgOpenContent(context.ttrpgContent) }) })
  try { await reconcileTtrpgOpenEntityRunV1({ ...input, scope }) }
  catch { throw new TtrpgOpenEntityReceiptPendingError(input.sessionId, event.sequence, input.runId) }
  return event
}

/** Human-authored, template-bound Oracle proposal; no model call or mechanical write. */
export async function proposeTtrpgOpenEntitiesV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; oracleSourceRef: import('./open-coordination').TtrpgOpenSourceRefV1;
  proposals: import('./open-entity-contract').TtrpgOpenEntityProposalV1[];
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'entity proposal viewer'), oracleSourceRef = parseTtrpgOpenSourceRefV1(input.oracleSourceRef)
  if (!Array.isArray(input.proposals) || input.proposals.length < 1 || input.proposals.length > 3) throw new Error('一次原咨询最多提出三个模板内实体')
  const proposals = input.proposals.map(parseTtrpgOpenEntityProposalV1)
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.open.entity.proposed', intent: { origin: 'human-oracle-proposal', viewerKey, oracleSourceRef, proposals },
    build: async context => {
      const content = requireTtrpgOpenContent(context.ttrpgContent), runtime = parseTtrpgRuntimeStateV2(context.state.ttrpg)
      if (!runtime?.authorization || !runtime.openRun) throw new Error('实体提案需要已开团的实际授权')
      const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: runtime.authorization, participants: context.participants, viewerKey })
      await verifyTtrpgOpenOracleJournalV1({ receipts: runtime.openRun.oracleReceipts ?? [], rulePack: content.rulePack.content,
        sessionKey: runtime.sessionKey, seed: context.session.seed, ancestors: runtime.branchLineage?.ancestors ?? [] })
      const plan = await createTtrpgOpenEntityPlanV1({ state: context.state, content, runtimeSourceHash: context.session.runtimeSourceHash,
        viewerKey, commandId: input.commandId, sequence: context.sequence, oracleSourceRef, proposals, previousOperations: runtime.openRun.entityOperations ?? [] })
      return { actorKey: seat.actorKey ?? 'gm', targetKey: plan.operationKey, payload: { plan } }
    } })
}
export async function confirmTtrpgOpenEntityOperationV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; operationKey: string; planHash: string; actorKey: string; decision: 'approve' | 'reject';
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'entity approval viewer'), operationKey = openKey(input.operationKey, 'entity operation')
  const planHash = openHash(input.planHash, 'entity original plan'), actorKey = openKey(input.actorKey, 'entity affected actor')
  if (input.decision !== 'approve' && input.decision !== 'reject') throw new Error('请明确同意或拒绝原实体计划')
  const envelope = await openOperationEnvelopeV1({ ...input, viewerKey, operationKey, frozenPlanHash: planHash }, 'entity.approval.' + actorKey, "entity")
  return appendFormalTtrpgCommand({ ...input, ...envelope, type: 'ttrpg.open.entity.confirmed', intent: { viewerKey, operationKey, planHash, actorKey, decision: input.decision },
    build: async context => {
      const basis = await assertTtrpgOpenEntityLiveV1({ state: context.state, participants: context.participants, viewerKey, operationKey, planHash })
      if (!basis.plan.requiredApprovals.some(row => row.actorKey === actorKey && row.allowedSeatKeys.includes(basis.seat.seatKey))
        || basis.operation.approvals.some(row => row.actorKey === actorKey)) throw new Error('当前真人不能替该受影响者确认，或原决定已经保存')
      return { actorKey, targetKey: operationKey, payload: { operationKey, planHash } }
    } })
}
/** F13 is the sole entity creation business event; inventory and identity commit atomically. */
export async function materializeTtrpgOpenEntityV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; operationKey: string; planHash: string;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'entity commit viewer'), operationKey = openKey(input.operationKey, 'entity operation'), planHash = openHash(input.planHash, 'entity original plan')
  const envelope = await openOperationEnvelopeV1({ ...input, viewerKey, operationKey, frozenPlanHash: planHash }, 'entity.materialize', "entity")
  return appendFormalTtrpgCommand({ ...input, ...envelope, type: 'ttrpg.open.entity.materialized', intent: { viewerKey, operationKey, planHash },
    build: async context => {
      const content = requireTtrpgOpenContent(context.ttrpgContent)
      const basis = await recheckTtrpgOpenEntityMaterializationV1({ state: context.state, content, runtimeSourceHash: context.session.runtimeSourceHash,
        participants: context.participants, viewerKey, operationKey, planHash })
      return { actorKey: basis.seat.actorKey ?? 'gm', targetKey: operationKey, payload: { operationKey, planHash } }
    } })
}
export async function disposeTtrpgOpenEntityOperationV1(input: FormalTtrpgCommandEnvelope & {
  viewerKey: string; operationKey: string; planHash: string; reason: string;
}): Promise<ProductRuntimeEvent> {
  const viewerKey = openKey(input.viewerKey, 'entity dispose viewer'), operationKey = openKey(input.operationKey, 'entity operation'), planHash = openHash(input.planHash, 'entity original plan')
  const reason = openText(input.reason, 'entity disposal reason', 2000)
  const envelope = await openOperationEnvelopeV1({ ...input, viewerKey, operationKey, frozenPlanHash: planHash }, 'entity.dispose', "entity")
  return appendFormalTtrpgCommand({ ...input, ...envelope, type: 'ttrpg.open.entity.disposed', intent: { viewerKey, operationKey, planHash, reason },
    build: async context => {
      const basis = await assertTtrpgOpenEntityLiveV1({ state: context.state, participants: context.participants, viewerKey, operationKey, planHash, allowPausedDisposal: true })
      if (viewerKey !== basis.plan.viewerKey && !basis.operation.approvals.some(row => row.viewerKey === viewerKey && row.decision === 'reject')) throw new Error('只有原主持或实际拒绝者可放弃未创建计划')
      return { actorKey: basis.seat.actorKey ?? 'gm', targetKey: operationKey, payload: { operationKey, planHash } }
    } })
}

/** Internal formal kernel. Human service owns review; the kernel independently
 * verifies actual source, original Run/artifact and the transaction witnesses. */
export async function reserveTtrpgOpenVoiceRequestForKernelV1(request: FormalTtrpgCommandEnvelope & {
  scope: import('../types').WorkspaceScope; viewerKey: string; request: import('./open-voice-request-contract').TtrpgOpenVoiceRequestV1
}) {
  const input = structuredClone(request)
  const contract = await import('./open-voice-request-contract'), row = contract.parseTtrpgOpenVoiceRequestV1(structuredClone(input.request))
  const intent = contract.ttrpgOpenVoiceReservationPayloadV1(row).intent
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.audio.voice.reserved', intent, build: async ({ session, state, sequence }) => {
    const { loadTtrpgOpenAudioReadStateV1 } = await import('./open-audio-read-state')
    const { verifyTtrpgOpenVoiceIntentRunV1 } = await import('./open-voice-request-run')
    const { verifyTtrpgOpenVoiceRequestHashesV1 } = await import('./open-voice-request-proof')
    const loaded = await loadTtrpgOpenAudioReadStateV1(input)
    if (session.id !== loaded.session.id || stableJson(state) !== stableJson(loaded.state) || sequence !== row.sourceRef.sequence
      || input.viewerKey !== row.script.scope.issuerViewerKey || session.runtimeSourceHash !== row.script.runtimeSourceHash
      || input.commandId !== await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'voice-request', [input.viewerKey, row.submissionKey])) throw new Error('[ttrpg] 配音预留来源或身份已变化')
    contract.assertTtrpgOpenVoiceReservationV1(loaded.runtime, row)
    await verifyTtrpgOpenVoiceRequestHashesV1(row, session.runtimeSourceHash)
    const proof = await verifyTtrpgOpenVoiceIntentRunV1({ ...input, row })
    await loaded.assertCurrent()
    return { actorKey: loaded.seat!.actorKey, targetKey: null, payload: contract.ttrpgOpenVoiceReservationPayloadV1(row), agentEvidence: proof.evidence,
      voiceRunSetWitness: proof.witness, eventEvidence: loaded.events }
  } })
}
export async function cancelTtrpgOpenVoiceRequestForKernelV1(request: FormalTtrpgCommandEnvelope & {
  scope: import('../types').WorkspaceScope; viewerKey: string; requestKey: string
}) {
  const input = structuredClone(request)
  const contract = await import('./open-voice-request-contract')
  const intent = { viewerKey: input.viewerKey, requestKey: input.requestKey, decision: contract.TTRPG_OPEN_VOICE_CANCEL_DECISION_V1 }
  return appendFormalTtrpgCommand({ ...input, type: 'ttrpg.audio.voice.cancelled', intent, build: async ({ state, sequence }) => {
    const { loadTtrpgOpenAudioReadStateV1 } = await import('./open-audio-read-state')
    const { verifyTtrpgOpenVoiceIntentRunV1 } = await import('./open-voice-request-run')
    const loaded = await loadTtrpgOpenAudioReadStateV1(input)
    if (stableJson(state) !== stableJson(loaded.state) || input.commandId !== await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'voice-cancel', [input.viewerKey, input.requestKey])) throw new Error('[ttrpg] 配音取消基线或身份已变化')
    const row = contract.assertTtrpgOpenVoiceCancellationV1(loaded.runtime, input.requestKey, input.viewerKey)
    const proof = await verifyTtrpgOpenVoiceIntentRunV1({ ...input, row, phase: 'cancel' })
    await loaded.assertCurrent()
    return { actorKey: loaded.seat!.actorKey, targetKey: null,
      payload: contract.ttrpgOpenVoiceCancellationPayloadV1({ ...row, cancelledRef: { sessionKey: loaded.runtime.sessionKey, sequence } }, input.viewerKey),
      agentEvidence: proof.evidence, voiceRunSetWitness: proof.witness, eventEvidence: loaded.events }
  } })
}
