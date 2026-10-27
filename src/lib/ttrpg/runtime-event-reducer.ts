import { applyTtrpgOpenContinuationStartV1 } from './open-release-continuation-start'
import { applyTtrpgOpenStageOpeningEventV1 } from './open-stage-opening-reducer'
import { applyTtrpgOpenVoiceRequestEventV1 } from './open-voice-request-reducer'
import { applyTtrpgOpenAudioEventV1 } from './open-audio-reducer'
import { applyTtrpgOpenCommonOracleArchiveV1 } from './open-common-oracle-archive-contract'
import { TTRPG_OPEN_COMMON_ORACLE_INPUT_V1, parseTtrpgOpenCommonOracleRequestCloseV1 } from './open-common-oracle-request'
import { assertTtrpgOpenCommonOracleCallOriginV1 } from './open-model-calls'
import { assertTtrpgOpenCommonOracleEpochAuthorityV1, assertTtrpgOpenCommonOracleEpochOriginV1 } from './open-coordination'
import { applyTtrpgOpenEntityEventV1 } from './open-entity-reducer'
import { assertTtrpgOpenSupportSlotV1, assertTtrpgOpenOracleInterpretationSlotV1 } from './open-model-calls'
import { assertTtrpgOpenSituationRuntimeReferenceJournalV1, assertTtrpgOpenOracleRuntimeReferenceJournalV1, assertTtrpgOpenNormalizationRuntimeReferenceOriginV1 } from './open-runtime-entity-references'
import { applyTtrpgOpenSessionSituationEventV1 } from './open-session-situation-reducer'
import { TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1, assertTtrpgOpenPublicSituationOriginalScopeV1 } from './open-public-situation-authorization-contract'
import { TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1, TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1, assertTtrpgOpenOracleRuntimeEpochAuthorityV1, ttrpgOpenEpochBudgetForTriggerV1, assertTtrpgOpenBriefEpochAuthorityV1, assertTtrpgOpenSituationEpochAuthorityV1, assertTtrpgOpenSituationWindowEventV1 } from './open-coordination'
import { applyTtrpgOpenTableMessageEventV1 } from './open-table-conversation-reducer'
import { applyTtrpgOpenMemoryEventV1 } from './open-memory-reducer'
import { applyTtrpgOpenHostingDelegationEventV1 } from './open-hosting-delegation'
import { parseTtrpgOpenManualRequestV1 } from './open-manual-action'
import { applyTtrpgOpenPrivateChoiceDisclosureEventV1 } from './open-private-choice-reducer'
import { applyTtrpgOpenGateRecoveryEventV1 } from './open-gate-recovery-reducer'
import { applyTtrpgOpenHandoffEventV1 } from './open-handoff'
import { applyTtrpgOpenCompanionPreauthorizationEventV1 } from './open-companion-preauthorization'
import { applyTtrpgOpenNarrationEventV1 } from './open-kp-reducer'
import { ttrpgOpenClosedStageRecoveryAllowedV1 } from './open-stage-close'
import { applyTtrpgOpenStageClosureEventV1 } from './open-stage-close-reducer'
import { applyTtrpgOpenTerminalGateEventV1 } from './open-terminal-gates-reducer'
import { applyTtrpgOpenSituationCycleEventV1 } from './open-situation-cycle-reducer'
import { applyTtrpgOpenSituationWorkEventV1 } from './open-situation-work-reducer'
import { applyTtrpgOpenPressureEffectEventV1 } from './open-pressure-effect-reducer'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { applyTtrpgOpenPressureEventV1 } from './open-pressure-reducer'
import { applyTtrpgMechanicalResultV1 } from './rule-action-mechanical';
import { parseTtrpgPrivateGuidanceReceiptV1 } from './private-guidance-model'
import { parseTtrpgDirectorReceiptV1 } from './director-model'
/** TTRPG-owned event reducer. Shared runtime storage dispatches here by product event namespace. */
import { earnedTtrpgCharacterCurrencyV2 } from './advancement'
import { parseTtrpgAbilityRuntimeStateV2, resetTtrpgAbilityUsageV2, ttrpgAbilityStateKeyV2 } from './ability-ledger'
import { spendTtrpgActionEconomyV2, startTtrpgActionEconomySceneV2 } from './action-economy'
import { parseTtrpgGmSynthesisFrameV2 } from './action-feedback'
import { applyTtrpgEffectPlanToRuntimeV2, proposeTtrpgEffectChoiceToRuntimeV2, resolveTtrpgEffectChoiceToRuntimeV2 } from './effect-runtime'
import { parseTtrpgEffectPlanV2 } from './effect-plan'
import { applyTtrpgItemCommandV2, parseTtrpgItemCommandV2, ttrpgItemDefinitionFromRuleV1 } from './item-ledger'
import { parseRulePackV1 } from './rule-pack'
import {
  applyTtrpgTabletopOperationV1,
  assertTtrpgCampaignMemoryV2,
  assertTtrpgCampaignPlaySessionV2,
  assertTtrpgCheck,
  assertTtrpgRosterEntryV2,
  assertTtrpgRuleActionResult,
  assertTtrpgScene,
  assertTtrpgSupplementReceiptV2,
  assertTtrpgVersionTransitionV2,
  assertTtrpgWorldEvolutionV2,
  longCampaignKey,
  longCampaignText,
  parseTtrpgHumanResponseV2,
  parseTtrpgIntentReceiptV2,
  parseTtrpgModelEvidenceV1,
  parseTtrpgRestReceiptV2,
  parseTtrpgState,
  parseTtrpgTabletopOperationV1,
  requireTtrpgState,
} from './runtime-state'
import type {
  ProductRuntimeEvent,
  ProductRuntimeState,
  TtrpgCharacterSheetV2,
  TtrpgRuntimeModelEvidenceV1,
} from '../types'
import {
  assertProductRuntimeIntegerV1 as assertFiniteInteger,
  isProductRuntimeJsonObjectV1 as isObject,
  stableProductRuntimeJsonV1 as stableJson,
  type ProductRuntimeJsonObjectV1,
} from '../product/runtime-values'
import {
  parseTtrpgOpenFailureRuntimeStateV1,
  parseTtrpgOpenRunStateV1,
  parseTtrpgOpenSituationRuntimeStateV1,
} from './open-runtime-contract'
import { parseTtrpgOpenAuthorizationV1 } from './open-authorization'
import { parseTtrpgOpenEpochV1 } from './open-coordination'
import { applyTtrpgOpenOperationEventV1 } from './open-operation-reducer'
import { applyTtrpgOpenModelCallEventV1 } from './open-model-call-reducer'
import { applyTtrpgOpenBranchEventV1 } from './open-branch-reducer'
import { applyTtrpgOpenOracleEventV1 } from './open-oracle-reducer'
import { applyTtrpgOpenFactEventV1 } from './open-fact-reducer'
import { applyTtrpgOpenOracleReviewEventV1 } from './open-oracle-review-reducer'
import { applyTtrpgOpenKnowledgeShareEventV1 } from './open-knowledge-share-reducer'
import { applyTtrpgOpenIdentityKnowledgeEventV1 } from './open-identity-knowledge-reducer'

export function applyTtrpgRuntimeEventV1(
  state: ProductRuntimeState,
  event: ProductRuntimeEvent,
  payload: ProductRuntimeJsonObjectV1,
): ProductRuntimeState {
  assertTtrpgOpenSituationWindowEventV1(state.ttrpg?.sessionKey ? parseTtrpgRuntimeStateV2(state.ttrpg) : null, event.type)
  if (applyTtrpgOpenVoiceRequestEventV1(state, event, payload) || applyTtrpgOpenAudioEventV1(state, event, payload) || applyTtrpgOpenEntityEventV1(state, event, payload) || applyTtrpgOpenSessionSituationEventV1(state, event, payload) || applyTtrpgOpenMemoryEventV1(state, event, payload)) {
    state.ttrpg = parseTtrpgRuntimeStateV2(state.ttrpg)!
    state.lastSequence = event.sequence
    return state
  }
  if (state.ttrpg?.sessionKey && (applyTtrpgOpenHostingDelegationEventV1(state,event,payload) || applyTtrpgOpenTableMessageEventV1(state,event,payload) || applyTtrpgOpenPrivateChoiceDisclosureEventV1(state,event,payload) || applyTtrpgOpenHandoffEventV1(state, event, payload) || applyTtrpgOpenCompanionPreauthorizationEventV1(state, event, payload) || applyTtrpgOpenNarrationEventV1(state, event, payload) || applyTtrpgOpenGateRecoveryEventV1(state, event, payload) || applyTtrpgOpenStageOpeningEventV1(state, event, payload) || applyTtrpgOpenStageClosureEventV1(state, event, payload) || applyTtrpgOpenTerminalGateEventV1(state, event, payload) || applyTtrpgOpenSituationCycleEventV1(state, event, payload) || applyTtrpgOpenSituationWorkEventV1(state, event, payload) || applyTtrpgOpenPressureEffectEventV1(state, event, payload) || applyTtrpgOpenPressureEventV1(state, event, payload))) {
    state.ttrpg = parseTtrpgRuntimeStateV2(state.ttrpg)!;
    state.lastSequence = event.sequence;
    return state;
  }
  if (state.ttrpg?.sessionKey && (applyTtrpgOpenOperationEventV1(state, event, payload) || applyTtrpgOpenModelCallEventV1(state, event, payload)
    || applyTtrpgOpenBranchEventV1(state, event, payload) || applyTtrpgOpenOracleEventV1(state, event, payload) || applyTtrpgOpenFactEventV1(state, event, payload)
    || applyTtrpgOpenKnowledgeShareEventV1(state, event, payload) || applyTtrpgOpenIdentityKnowledgeEventV1(state, event, payload) || applyTtrpgOpenOracleReviewEventV1(state, event, payload))) {
    const openState = parseTtrpgRuntimeStateV2(state.ttrpg)!;
    if (openState.openRun?.operations.some(o => o.pressureTurnConditions) || openState.openRun?.narrations || openState.openRun?.stageClosures || openState.openRun?.terminalReceipts || openState.openRun?.gateReceipts || openState.openRun?.situationCycles || openState.openRun?.pressureCycles || openState.openRun?.pressureSignals) state.ttrpg = openState;
    state.lastSequence = event.sequence;
    return state;
  }
  switch (event.type) {
    case "ttrpg.open.run.started": {
      const ttrpg = requireTtrpgState(state);
      const authorization = parseTtrpgOpenAuthorizationV1(ttrpg.authorization);
      if (!ttrpg.product.sessionZero.completed || authorization.revision !== ttrpg.product.sessionZero.completedAtSequence) {
        throw new Error("open run 需要有效 Session Zero 和真人批准关系。");
      }
      if (
        !Object.prototype.hasOwnProperty.call(ttrpg, "openRun") ||
        ttrpg.openRun !== null
      ) {
        throw new Error("open run 只能由第一次 started 事件初始化。");
      }
      if (Object.keys(payload).sort().join(",") !== "authorizationRevision,intent,openRun,startedBySeatKey,viewerKey") {
        throw new Error("open run started 事件字段不精确。");
      }
      const openRun = parseTtrpgOpenRunStateV1(payload.openRun);
      const seat = authorization.seats.find(item => item.seatKey === payload.startedBySeatKey && item.viewerKey === payload.viewerKey);
      if (
        Object.prototype.hasOwnProperty.call(openRun, "situationReceipts") || openRun.worldTime.worldTurn !== 0 ||
        openRun.worldTime.lastAdvancedByEventSequence !== -1 ||
        openRun.chaos.value !== 5 ||
        openRun.stage.status !== "open" || openRun.stage.openedAtWorldTurn !== 0 ||
        openRun.stage.closedAtWorldTurn !== null || openRun.consultedThisWorldTurn !== 0 ||
        openRun.coordination.epochs.length !== 0 || openRun.coordination.calls.length !== 0 || openRun.coordination.activeEpochKey !== null ||
        openRun.operations.length !== 0 || openRun.ruleReceipts.length !== 0 || openRun.knowledge.length !== 0 ||
        (openRun.oracleReceipts?.length ?? 0) !== 0 ||
        openRun.factLedger !== undefined ||
        (openRun.knowledgeShares?.length ?? 0) !== 0 ||
        openRun.gates.length !== 0 || openRun.failures.length !== 0 ||
        openRun.situations.active.length !== 0 || openRun.situations.queued.length !== 0 ||
        Object.keys(openRun.situations.cooldowns).length !== 0 ||
        payload.authorizationRevision !== authorization.revision || !seat || seat.controller === "ai" ||
        seat.assignmentState !== "claimed" || event.actorKey !== seat.actorKey ||
        stableJson(openRun.companions.map(companion => companion.actorKey).sort()) !== stableJson([...authorization.selectedActorKeys].sort()) ||
        openRun.companions.some(companion => companion.consecutiveActions !== 0)
      ) {
        throw new Error("open run started 初始状态不符合固定起点。");
      }
      ttrpg.openRun = openRun;
      state.clock = 0;
      break;
    }
    case "ttrpg.open.epoch.started": {
      const ttrpg = requireTtrpgState(state);
      const authorization = parseTtrpgOpenAuthorizationV1(ttrpg.authorization);
      const openRun = parseTtrpgOpenRunStateV1(ttrpg.openRun, ttrpg.sessionKey);
      if (Object.keys(payload).sort().join(",") !== "epoch,intent") throw new Error("epoch.started 字段不精确。");
      const epoch = parseTtrpgOpenEpochV1(payload.epoch);
      if (openRun.gateRecoveries?.some(r => r.stoppedRef && openRun.operations.some(o => o.operationKey === r.operationKey && o.status === 'executing'))) throw new Error('本轮质量门恢复已停止，未完成业务不能借新 epoch 绕过');
      const seat = authorization.seats.find(item => item.seatKey === epoch.triggeredBySeatKey && item.viewerKey === epoch.viewerKey);
      if (!ttrpg.sessionKey || !seat || seat.controller === "ai" || seat.assignmentState !== "claimed"
        || event.actorKey !== seat.actorKey || !isObject(payload.intent)
        || payload.intent.viewerKey !== epoch.viewerKey || payload.intent.triggerKind !== epoch.triggerKind
        || typeof payload.intent.rawInput !== "string" || !payload.intent.rawInput.trim()
        || epoch.startedRef.sessionKey !== ttrpg.sessionKey || epoch.startedRef.sequence !== event.sequence
        || epoch.sessionZeroRevision !== authorization.revision || epoch.status !== "active"
        || epoch.closedRef !== null || epoch.stopReason !== null || epoch.hostingDelegation || epoch.successfulActorKeys.length !== 0
        || epoch.reservedCalls !== 0 || epoch.consumedTokens !== 0 || epoch.actualCostUsd !== 0
        || stableJson(epoch.budget) !== stableJson(ttrpgOpenEpochBudgetForTriggerV1(ttrpg.epochBudget, epoch.triggerKind, Boolean(epoch.commonOracle || epoch.oracleRuntimeReferencePolicy || epoch.normalizationRuntimeReferencePolicy)))
        || openRun.stage.status !== "open" && epoch.triggerKind !== "request-brief" && !ttrpgOpenClosedStageRecoveryAllowedV1(parseTtrpgRuntimeStateV2(state.ttrpg)!, epoch.triggerKind) || openRun.coordination.activeEpochKey !== null
        || openRun.coordination.epochs.some(item => item.epochKey === epoch.epochKey)) {
        throw new Error("epoch.started 的真人授权、初始额度或活动窗口无效。");
      }
      if (epoch.triggerKind === 'request-brief') assertTtrpgOpenBriefEpochAuthorityV1(parseTtrpgRuntimeStateV2(state.ttrpg)!, epoch.viewerKey);
      if (epoch.triggerKind === 'request-situation') assertTtrpgOpenSituationEpochAuthorityV1(parseTtrpgRuntimeStateV2(state.ttrpg)!, epoch.viewerKey);
      if (epoch.commonOracle) {
        const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, basis = epoch.commonOracle.basis;
        assertTtrpgOpenCommonOracleEpochAuthorityV1(runtime, epoch.viewerKey);
        assertTtrpgOpenOracleInterpretationSlotV1(runtime, openRun.worldTime.worldTurn);
        if (payload.intent.rawInput !== TTRPG_OPEN_COMMON_ORACLE_INPUT_V1 || stableJson(payload.intent.commonOracle) !== stableJson(epoch.commonOracle)
          || basis.readEvidence.sequence !== event.baseSequence || basis.readEvidence.stateHash !== event.baseStateHash) throw new Error('共同事实窗口不是本次本人确认的原准确来源和切点');
        assertTtrpgOpenCommonOracleEpochOriginV1(runtime, epoch);
      } else if (Object.prototype.hasOwnProperty.call(payload.intent, 'commonOracle')) throw new Error('旧窗口不能夹带共同事实授权');
      if (epoch.normalizationRuntimeReferencePolicy) {
        const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!, policy = epoch.normalizationRuntimeReferencePolicy;
        assertTtrpgOpenOracleRuntimeEpochAuthorityV1(runtime, epoch.viewerKey);
        assertTtrpgOpenSupportSlotV1(runtime, openRun.worldTime.worldTurn);
        if (payload.intent.rawInput !== TTRPG_OPEN_NORMALIZATION_INSTANCE_INPUT_V1 || stableJson(payload.intent.normalizationRuntimeReferencePolicy) !== stableJson(policy)) throw new Error('实例归一不是本次原已接受解释的明确策略');
        assertTtrpgOpenNormalizationRuntimeReferenceOriginV1({ runtime, policy, reviewSourceRef: policy.reviewSourceRef, recipientActorKeys: authorization.selectedActorKeys,
          runtimeSourceHash: policy.oraclePolicy.references.runtimeSourceHash, rulePackContentHash: ttrpg.product.rulePackContentHash, consumerRef: epoch.startedRef });
      } else if (Object.prototype.hasOwnProperty.call(payload.intent, 'normalizationRuntimeReferencePolicy')) throw new Error('旧窗口不能夹带新的实例归一策略');
      if (epoch.oracleRuntimeReferencePolicy) {
        const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!;
        assertTtrpgOpenOracleRuntimeEpochAuthorityV1(runtime, epoch.viewerKey);
        if (payload.intent.rawInput !== TTRPG_OPEN_ORACLE_INSTANCE_INPUT_V1 || stableJson(payload.intent.oracleRuntimeReferencePolicy) !== stableJson(epoch.oracleRuntimeReferencePolicy)) throw new Error('实例事实不是本次明确冻结的原策略');
        const oracle = openRun.oracleReceipts?.find(row => stableJson(row.sourceRef) === stableJson(epoch.oracleRuntimeReferencePolicy!.oracleSourceRef));
        if (!oracle) throw new Error('实例事实窗口缺少原 Oracle');
        assertTtrpgOpenOracleRuntimeReferenceJournalV1({ policy: epoch.oracleRuntimeReferencePolicy, operations: openRun.entityOperations ?? [], oracle,
          recipientActorKeys: authorization.selectedActorKeys, runtimeSourceHash: epoch.oracleRuntimeReferencePolicy.references.runtimeSourceHash,
          rulePackContentHash: ttrpg.product.rulePackContentHash, consumerRef: epoch.startedRef });
      } else if (Object.prototype.hasOwnProperty.call(payload.intent, 'oracleRuntimeReferencePolicy')) throw new Error('旧窗口不能伪装新的实例事实策略');
      if (epoch.runtimeEntityReferencePolicy) {
        if (stableJson(payload.intent.runtimeEntityReferencePolicy) !== stableJson(epoch.runtimeEntityReferencePolicy)) throw new Error('局势实例引用不是本次明确冻结的原策略');
        assertTtrpgOpenSituationRuntimeReferenceJournalV1({ policy: epoch.runtimeEntityReferencePolicy, operations: openRun.entityOperations ?? [],
          recipientActorKeys: authorization.selectedActorKeys, rulePackContentHash: ttrpg.product.rulePackContentHash,
          consumerRef: epoch.startedRef });
      } else if (Object.prototype.hasOwnProperty.call(payload.intent, 'runtimeEntityReferencePolicy')) throw new Error('旧窗口不能借元数据扩大实例读取策略');
      if (epoch.publicSituation) {
        const grant = epoch.publicSituation, b = grant.basis;
        assertTtrpgOpenSituationEpochAuthorityV1(parseTtrpgRuntimeStateV2(state.ttrpg)!, epoch.viewerKey);
        assertTtrpgOpenPublicSituationOriginalScopeV1(grant, ttrpg.sessionKey);
        if (epoch.triggerKind !== TTRPG_OPEN_PUBLIC_SITUATION_TRIGGER_V1 || stableJson(payload.intent.publicSituation) !== stableJson(grant)
          || payload.intent.rawInput !== b.sharedRequest.text
          || b.readEvidence.sequence !== event.baseSequence || b.readEvidence.stateHash !== event.baseStateHash
          || grant.authorizationCommandId !== event.commandId || b.requester.seatRevision !== seat.revision
          || stableJson(b.recipientActorKeys) !== stableJson([...authorization.selectedActorKeys].sort())) throw new Error('共同局势授权没有绑定原请求、共享输入及实际接收者');
      } else if (Object.prototype.hasOwnProperty.call(payload.intent, 'publicSituation')) throw new Error('其他窗口不能携带共同局势授权');
      if (epoch.manualAction) {
        const request = parseTtrpgOpenManualRequestV1(epoch.manualAction);
        if (seat.role !== 'player' || request.actorKey !== seat.actorKey || !isObject(payload.intent)
          || stableJson(payload.intent.manualAction) !== stableJson(epoch.manualAction)) throw new Error('人工 epoch 未绑定本人的明确请求');
      } else if (isObject(payload.intent) && Object.prototype.hasOwnProperty.call(payload.intent,'manualAction')) throw new Error('人工请求元数据不闭合');
      openRun.coordination.epochs.push(epoch);
      openRun.coordination.activeEpochKey = epoch.epochKey;
      ttrpg.openRun = openRun;
      break;
    }
    case "ttrpg.open.epoch.closed": {
      const ttrpg = requireTtrpgState(state);
      const openRun = parseTtrpgOpenRunStateV1(ttrpg.openRun, ttrpg.sessionKey);
      const hasArchive = Object.prototype.hasOwnProperty.call(payload, 'commonOracleArchive');
      if (Object.keys(payload).sort().join(",") !== (hasArchive ? "commonOracleArchive,epochKey,intent,reason,viewerKey" : "epochKey,intent,reason,viewerKey")) throw new Error("epoch.closed 字段不精确。");
      const epoch = openRun.coordination.epochs.find(item => item.epochKey === payload.epochKey);
      const authorization = parseTtrpgOpenAuthorizationV1(ttrpg.authorization);
      const seat = authorization.seats.find(item => item.viewerKey === payload.viewerKey);
      if (!epoch || epoch.status !== "active" || openRun.coordination.activeEpochKey !== epoch.epochKey
        || epoch.viewerKey !== payload.viewerKey || !seat || seat.controller === "ai" || seat.assignmentState !== "claimed"
        || event.actorKey !== seat.actorKey || typeof payload.reason !== "string" || !payload.reason.trim()
        || payload.reason.length > 2000 || !isObject(payload.intent)
        || payload.intent.epochKey !== epoch.epochKey || payload.intent.viewerKey !== payload.viewerKey
        || payload.intent.reason !== payload.reason || !hasArchive && epoch.reservedCalls > 0) {
        throw new Error("epoch.closed 不能跳过业务回执、额度或真人授权。");
      }
      if (openRun.operations.some(operation => operation.authorizationEpochKey === epoch.epochKey && ["awaiting-approval", "executing"].includes(operation.status))) {
        throw new Error("epoch 仍有未完成操作，不能跳过业务步骤关闭。");
      }
      if (hasArchive) {
        if (!isObject(payload.intent) || payload.intent.commonOracleEmpty !== undefined || payload.intent.commonOracleRequest !== undefined
          || payload.intent.commonOracleArchive !== 'archive-this-unresumable-common-oracle-window') throw new Error('归档不能混用本地原 Run 的结束许可');
        const runtime = parseTtrpgRuntimeStateV2(ttrpg)!;
        runtime.openRun = openRun;
        applyTtrpgOpenCommonOracleArchiveV1(runtime, epoch, payload.commonOracleArchive, event.sequence, String(payload.viewerKey));
      } else if (isObject(payload.intent) && payload.intent.commonOracleArchive !== undefined) throw new Error('缺少准确共同归档回执');
      if (epoch.commonOracle && !hasArchive) {
        const calls = openRun.coordination.calls.filter(call => call.authorizationEpochKey === epoch.epochKey);
        if (payload.intent.commonOracleEmpty === true) {
          if (calls.length || payload.intent.commonOracleRequest !== undefined) throw new Error('共同事实空窗口结束不能跳过原请求终验');
        } else {
          const close = parseTtrpgOpenCommonOracleRequestCloseV1(payload.intent.commonOracleRequest), call = calls[0];
          if (calls.length !== 1 || !call || call.requestKey !== close.requestKey || ['prepared', 'dispatched'].includes(call.status)) throw new Error('共同事实须先闭合原请求与费用记录');
          assertTtrpgOpenCommonOracleCallOriginV1({ openRun }, call);
          const reviewed = openRun.oracleReviews?.some(row => row.requestKey === close.requestKey) || openRun.factLedger?.entries.some(row => row.modelCandidate?.requestKey === close.requestKey);
          if ((close.decision === 'close-this-reviewed-common-oracle-window') !== Boolean(reviewed)) throw new Error('共同事实结束不能改变原审阅、采用或弃用决定');
        }
      } else if (!hasArchive && (payload.intent.commonOracleEmpty !== undefined || payload.intent.commonOracleRequest !== undefined)) throw new Error('其他窗口不能夹带共同事实结束授权');
      const closingEpoch = openRun.coordination.epochs.find(row => row.epochKey === epoch.epochKey)!;
      closingEpoch.closedRef = { sessionKey: ttrpg.sessionKey!, sequence: event.sequence };
      closingEpoch.status = "closed";
      closingEpoch.stopReason = payload.reason;
      openRun.coordination.activeEpochKey = null;
      ttrpg.openRun = openRun;
      break;
    }
    case "ttrpg.world-turn.advanced": {
      throw new Error("世界时间推进需要已结算 operation 的因果耗时回执，禁止直接 tick。");
    }
    case "ttrpg.situation.changed": {
      const ttrpg = requireTtrpgState(state);
      if (!Object.prototype.hasOwnProperty.call(ttrpg, "openRun")) {
        throw new Error("situation 事件只能用于 protocol-2/open。");
      }
      const openRun = parseTtrpgOpenRunStateV1(ttrpg.openRun);
      if (
        Object.keys(payload).sort().join(",") !==
        "intent,mode,situation"
      ) {
        throw new Error("situation changed 事件字段不精确。");
      }
      const mode = String(payload.mode ?? "");
      if (mode !== "activated" && mode !== "queued") {
        throw new Error("situation changed mode 无效。");
      }
      const situation = parseTtrpgOpenSituationRuntimeStateV1(
        payload.situation,
        "situation.changed.situation",
      );
      if (
        situation.activatedAtSequence !== event.sequence ||
        situation.activatedAtWorldTurn !== openRun.worldTime.worldTurn
      ) {
        throw new Error("situation changed 没有绑定当前事件和世界轮次。");
      }
      if (
        (mode === "activated" && situation.status !== "active") ||
        (mode === "queued" && situation.status !== "queued")
      ) {
        throw new Error("situation changed mode 与状态不一致。");
      }
      if (
        [...openRun.situations.active, ...openRun.situations.queued].some(
          (item) => item.situationKey === situation.situationKey,
        )
      ) {
        throw new Error("同一局势实例不能重复进入 active/queued。");
      }
      if (mode === "activated") {
        if (openRun.situations.active.length >= 5) {
          throw new Error("活跃局势不能超过 5 个。");
        }
        if (situation.queuePosition !== null) {
          throw new Error("activated 局势不能携带 queuePosition。");
        }
        openRun.situations.active.push(situation);
      } else {
        const maxQueuePosition = openRun.situations.queued.reduce(
          (maximum, item) =>
            Math.max(maximum, item.queuePosition ?? -1),
          -1,
        );
        if (situation.queuePosition !== maxQueuePosition + 1) {
          throw new Error("queued 局势必须按 FIFO 顺序排队。");
        }
        openRun.situations.queued.push(situation);
      }
      ttrpg.openRun = openRun;
      break;
    }
    case "ttrpg.open.failure.logged": {
      const ttrpg = requireTtrpgState(state);
      if (!Object.prototype.hasOwnProperty.call(ttrpg, "openRun")) {
        throw new Error("failure 事件只能用于 protocol-2/open。");
      }
      const openRun = parseTtrpgOpenRunStateV1(ttrpg.openRun);
      if (Object.keys(payload).sort().join(",") !== "failure,intent") {
        throw new Error("open failure 事件字段不精确。");
      }
      const failure = parseTtrpgOpenFailureRuntimeStateV1(payload.failure);
      if (
        failure.atSequence !== event.sequence ||
        failure.atWorldTurn !== openRun.worldTime.worldTurn ||
        openRun.failures.some((item) => item.failureKey === failure.failureKey)
      ) {
        throw new Error("open failure 记录没有绑定当前事件或重复。");
      }
      openRun.failures.push(failure);
      if (openRun.failures.length > 200) {
        openRun.failures.splice(0, openRun.failures.length - 200);
      }
      ttrpg.openRun = openRun;
      break;
    }
    case "ttrpg.character.customized": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (product.sessionZero.completed || ttrpg.scene) {
        throw new Error("角色只能在正式战役 Session Zero 完成前定制。");
      }
      const characterKey = String(payload.characterKey ?? "").trim();
      const name = String(payload.name ?? "").trim();
      const description = String(payload.description ?? "").trim();
      if (
        !characterKey ||
        event.actorKey !== characterKey ||
        !name ||
        name.length > 300 ||
        !description ||
        description.length > 20_000 ||
        !isObject(payload.attributes) ||
        !isObject(payload.entityAttributes) ||
        !isObject(payload.characterSheet) ||
        state.entities[characterKey]?.kind !== "player"
      ) {
        throw new Error("正式 TTRPG 角色定制事件无效。");
      }
      const attributes = Object.fromEntries(
        Object.entries(payload.attributes).map(([key, value]) => {
          const parsed = Number(value);
          if (!key.trim() || !Number.isFinite(parsed))
            throw new Error("正式 TTRPG 角色属性无效。");
          return [key.trim(), parsed];
        }),
      );
      const entityAttributes = Object.fromEntries(
        Object.entries(payload.entityAttributes).map(([key, value]) => {
          if (
            !key.trim() ||
            (!["string", "number", "boolean"].includes(typeof value) &&
              value !== null)
          ) {
            throw new Error("正式 TTRPG 角色投影属性无效。");
          }
          return [key, value as string | number | boolean | null];
        }),
      );
      const entity = state.entities[characterKey];
      entity.name = name;
      entity.attributes = { ...entity.attributes, ...entityAttributes };
      const current = product.characterCustomizations.find(
        (item) => item.characterKey === characterKey,
      );
      const customization = {
        characterKey,
        name,
        description,
        attributes,
        characterSheet: structuredClone(
          payload.characterSheet,
        ) as unknown as TtrpgCharacterSheetV2,
        customizedAtSequence: event.sequence,
      };
      if (current) Object.assign(current, customization);
      else product.characterCustomizations.push(customization);
      break;
    }
    case "ttrpg.character.advanced": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      const characterKey = String(payload.characterKey ?? "").trim();
      const kind = String(payload.kind);
      const targetKey = String(payload.targetKey ?? "").trim();
      const before = payload.before;
      const after = payload.after;
      const cost = assertFiniteInteger(payload.cost, "成长消费", 1, 1_000_000);
      const progression = product.characterProgression[characterKey];
      if (
        !product.sessionZero.completed ||
        product.ending ||
        !progression ||
        event.actorKey !== characterKey ||
        !targetKey ||
        !["attribute", "skill", "level", "rank"].includes(kind) ||
        !["number", "string"].includes(typeof before) ||
        typeof before !== typeof after ||
        !isObject(payload.entityAttributes) ||
        progression.spentCurrency + cost >
          earnedTtrpgCharacterCurrencyV2(product, characterKey)
      ) {
        throw new Error("正式 TTRPG 角色成长事件无效。");
      }
      if (kind === "attribute") {
        const current = state.entities[characterKey]?.attributes[targetKey];
        if (
          typeof before !== "number" ||
          typeof after !== "number" ||
          current !== before ||
          after !== before + 1
        ) {
          throw new Error("角色属性成长前后值不连续。");
        }
        progression.attributeIncreases[targetKey] =
          (progression.attributeIncreases[targetKey] ?? 0) + 1;
      } else if (kind === "skill") {
        if (
          typeof before !== "number" ||
          typeof after !== "number" ||
          after !== before + 1
        ) {
          throw new Error("角色技能成长前后值不连续。");
        }
        progression.skillIncreases[targetKey] =
          (progression.skillIncreases[targetKey] ?? 0) + 1;
      } else if (kind === "level") {
        if (
          progression.model !== "numeric-level" ||
          typeof before !== "number" ||
          typeof after !== "number" ||
          progression.level !== before ||
          after !== before + 1
        )
          throw new Error("角色等级成长无效。");
        progression.level = after;
      } else {
        if (
          progression.model !== "rank" ||
          typeof before !== "string" ||
          typeof after !== "string" ||
          progression.rankKey !== before ||
          before === after
        )
          throw new Error("角色阶位成长无效。");
        progression.rankKey = after;
        if (
          typeof state.entities[characterKey]?.attributes.rankPower === "number"
        ) {
          progression.attributeIncreases.rankPower =
            (progression.attributeIncreases.rankPower ?? 0) + 1;
        }
      }
      const entity = state.entities[characterKey];
      if (!entity) throw new Error("角色成长目标不存在。");
      for (const [field, raw] of Object.entries(payload.entityAttributes)) {
        if (
          !field.trim() ||
          (!["string", "number", "boolean"].includes(typeof raw) &&
            raw !== null) ||
          (typeof raw === "number" && !Number.isFinite(raw))
        )
          throw new Error("角色成长实体投影无效。");
        entity.attributes[field] = raw as string | number | boolean | null;
      }
      progression.spentCurrency += cost;
      progression.history.push({
        eventSequence: event.sequence,
        kind: kind as "attribute" | "skill" | "level" | "rank",
        targetKey,
        before: before as number | string,
        after: after as number | string,
        cost,
      });
      break;
    }
    case "ttrpg.session-zero.completed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (product.sessionZero.completed)
        throw new Error("Session Zero 已完成，不能重复提交。");
      if (!Array.isArray(payload.acceptedItemKeys))
        throw new Error("Session Zero 缺少确认项。");
      const acceptedItemKeys = payload.acceptedItemKeys
        .map((item) => String(item).trim())
        .sort();
      if (!Array.isArray(payload.selectedCharacterKeys))
        throw new Error("Session Zero 缺少玩家角色编组。");
      const selectedCharacterKeys = payload.selectedCharacterKeys.map((item) =>
        String(item).trim(),
      );
      const requiredItemKeys = [...product.sessionZero.requiredItemKeys].sort();
      if (stableJson(acceptedItemKeys) !== stableJson(requiredItemKeys)) {
        throw new Error("必须确认全部 Session Zero 安全与共识事项。");
      }
      if (
        !selectedCharacterKeys.length ||
        new Set(selectedCharacterKeys).size !== selectedCharacterKeys.length ||
        selectedCharacterKeys.some(
          (key) => state.entities[key]?.kind !== "player",
        )
      ) {
        throw new Error("Session Zero 玩家角色编组无效。");
      }
      const completedBy = String(payload.completedBy ?? "").trim();
      if (!completedBy || completedBy !== event.actorKey)
        throw new Error("Session Zero 完成人身份无效。");
      if (Object.prototype.hasOwnProperty.call(ttrpg, "authorization")) {
        const continuedRuntime = parseTtrpgRuntimeStateV2(state.ttrpg);
        const continuedOpening = continuedRuntime?.openRun?.releaseContinuation?.plan.childSessionKey === continuedRuntime?.sessionKey && !continuedRuntime?.openRun?.releaseContinuation?.confirmedRef;
        const expectedKeys = ['acceptedItemKeys', 'authorization', 'completedBy', 'intent', 'selectedCharacterKeys', ...(continuedOpening ? ['continuationOpening'] : [])].sort().join(',');
        if (Object.keys(payload).sort().join(",") !== expectedKeys) {
          throw new Error("open Session Zero 必须携带完整授权回执。");
        }
        const authorization = parseTtrpgOpenAuthorizationV1(payload.authorization);
        if (ttrpg.authorization !== null || authorization.revision !== event.sequence
          || authorization.sourceRef.sessionKey !== ttrpg.sessionKey
          || authorization.completedBySeatKey !== completedBy
          || stableJson([...authorization.selectedActorKeys].sort()) !== stableJson([...selectedCharacterKeys].sort())) {
          throw new Error("open Session Zero 授权与本事件不一致。");
        }
        ttrpg.authorization = authorization;
        if (ttrpg.openRun && Object.prototype.hasOwnProperty.call(ttrpg, 'branchLineage')) {
          const run = parseTtrpgOpenRunStateV1(ttrpg.openRun);
          run.companions = run.companions.filter(companion => selectedCharacterKeys.includes(companion.actorKey));
          ttrpg.openRun = run;
        }
      } else if (Object.prototype.hasOwnProperty.call(payload, "authorization")) {
        throw new Error("scripted Session Zero 不能接受 open 授权。");
      }
      product.sessionZero = {
        ...product.sessionZero,
        completed: true,
        acceptedItemKeys,
        selectedCharacterKeys,
        completedBy,
        completedAtSequence: event.sequence,
      };
      const existingRoster = new Map(
        ttrpg.campaign.roster.map((entry) => [entry.characterKey, entry]),
      );
      const allPlayerKeys = Object.values(state.entities)
        .filter((entity) => entity.kind === "player")
        .map((entity) => entity.entityKey);
      const continuationRuntime = 'runFormat' in ttrpg && ttrpg.runFormat === 'open'
        ? parseTtrpgRuntimeStateV2(state.ttrpg) : null;
      if (!continuationRuntime?.openRun?.releaseContinuation) ttrpg.campaign.roster = allPlayerKeys.map((characterKey) => ({
        characterKey,
        status: selectedCharacterKeys.includes(characterKey)
          ? ("active" as const)
          : ("reserve" as const),
        joinedSessionKey: null,
        leftSessionKey: null,
        replacementFor: null,
        reason: existingRoster.get(characterKey)?.reason ?? "",
        updatedSequence: event.sequence,
      }));
      const pendingContinuation = continuationRuntime;
      if (pendingContinuation && pendingContinuation.openRun?.releaseContinuation?.plan.childSessionKey === pendingContinuation.sessionKey && !pendingContinuation.openRun.releaseContinuation.confirmedRef) applyTtrpgOpenContinuationStartV1(state, event, payload);
      break;
    }
    case "ttrpg.safety.changed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed || product.ending)
        throw new Error("当前正式战役不能变更安全状态。");
      const status = String(payload.status ?? "");
      const reason =
        payload.reason == null ? null : String(payload.reason).trim() || null;
      const changedBy = String(payload.changedBy ?? "").trim();
      if (Object.prototype.hasOwnProperty.call(ttrpg, "authorization")) {
        const authorization = parseTtrpgOpenAuthorizationV1(ttrpg.authorization);
        const seat = authorization.seats.find(item => item.viewerKey === payload.viewerKey);
        if (Object.keys(payload).sort().join(",") !== "changedBy,intent,reason,status,viewerKey"
          || !seat || seat.controller === "ai" || seat.assignmentState !== "claimed"
          || ![seat.seatKey, seat.actorKey, seat.viewerKey].includes(changedBy)) {
          throw new Error("open 安全状态必须由已确认真人席位更改。");
        }
      }
      if (
        !["active", "paused"].includes(status) ||
        !changedBy ||
        changedBy !== event.actorKey ||
        (status === "paused" && !reason) ||
        status === product.safety.status
      ) {
        throw new Error("安全状态变更无效。");
      }
      product.safety = {
        status: status as "active" | "paused",
        reason: status === "paused" ? reason : null,
        changedBy,
        changedAtSequence: event.sequence,
      };
      break;
    }
    case "ttrpg.clue.discovered": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed)
        throw new Error("正式战役尚未完成 Session Zero。");
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("请先打开一个正式战役场景。");
      const clueKey = String(payload.clueKey ?? "").trim();
      const actorKey = String(payload.actorKey ?? "").trim();
      const visibility = String(payload.visibility ?? "");
      const catalog = product.clueCatalog.find(
        (item) => item.clueKey === clueKey,
      );
      if (!catalog) throw new Error("线索不属于冻结 CampaignPack。");
      if (catalog.sourceVisibility === "gm-only")
        throw new Error("GM 私密线索不能通过玩家发现路径公开。");
      if (catalog.sourceVisibility === "public" && visibility !== "party")
        throw new Error("公开线索必须对队伍可见。");
      if (visibility !== "private" && visibility !== "party")
        throw new Error("线索可见范围无效。");
      const actor = state.entities[actorKey];
      if (
        !actor ||
        !["player", "character"].includes(actor.kind) ||
        actorKey !== event.actorKey
      ) {
        throw new Error("线索发现者必须是当前正式战役中的玩家角色。");
      }
      const existing = product.discoveredClues.find(
        (item) => item.clueKey === clueKey,
      );
      if (existing) {
        if (existing.visibility !== "private" || visibility !== "party")
          throw new Error("同一线索不能重复发现。");
        existing.visibility = "party";
        existing.actorKey = actorKey;
        existing.eventSequence = event.sequence;
      } else {
        product.discoveredClues.push({
          clueKey,
          actorKey,
          visibility: visibility as "private" | "party",
          eventSequence: event.sequence,
        });
      }
      const discoveredConclusions = new Set(
        product.discoveredClues
          .map(
            (item) =>
              product.clueCatalog.find((clue) => clue.clueKey === item.clueKey)
                ?.conclusionKey,
          )
          .filter((item): item is string => !!item),
      );
      for (const quest of product.questProgress) {
        if (
          quest.status === "active" &&
          quest.requiredConclusionKeys.every((key) =>
            discoveredConclusions.has(key),
          )
        ) {
          quest.status = "completed";
          quest.completedAtSequence = event.sequence;
        }
      }
      break;
    }
    case "ttrpg.scene.opened": {
      const ttrpg = requireTtrpgState(state);
      const scene = assertTtrpgScene(payload.scene);
      if (!ttrpg.product.sessionZero.completed)
        throw new Error("正式战役必须先完成 Session Zero。");
      if (ttrpg.product.ending)
        throw new Error("正式战役已经结束，不能再打开场景。");
      if (!ttrpg.product.sceneKeys.includes(scene.sceneKey)) {
        throw new Error("正式场景必须来自冻结 CampaignPack。");
      }
      const rawTurnOrder = payload.turnOrder;
      if (!Array.isArray(rawTurnOrder) || rawTurnOrder.length === 0) {
        throw new Error("跑团场景至少需要一个行动者。");
      }
      const turnOrder = rawTurnOrder.map((raw) => String(raw).trim());
      if (new Set(turnOrder).size !== turnOrder.length)
        throw new Error("跑团回合顺序不能重复。");
      for (const actorKey of turnOrder) {
        const actor = state.entities[actorKey];
        if (!actor || !["player", "character", "npc"].includes(actor.kind)) {
          throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`);
        }
      }
      const initiative = parseTtrpgState({
        ...ttrpg,
        scene,
        round: 1,
        activeActorKey: turnOrder[0],
        turnOrder,
        initiative: payload.initiative,
      })!.initiative;
      if (initiative?.sceneKey !== scene.sceneKey) {
        throw new Error("正式场景先攻收据没有绑定当前场景。");
      }
      if (scene.locationKey != null) {
        const location = state.entities[scene.locationKey];
        if (!location || location.kind !== "location")
          throw new Error(`跑团场景地点不存在: ${scene.locationKey}`);
      }
      ttrpg.scene = scene;
      if (!ttrpg.product.openedSceneKeys.includes(scene.sceneKey)) {
        ttrpg.product.openedSceneKeys.push(scene.sceneKey);
      }
      if (ttrpg.product.tabletop) {
        const tabletopMap = ttrpg.product.tabletop.maps.find((map) =>
          map.sceneKeys.includes(scene.sceneKey),
        );
        ttrpg.product.tabletop.currentMapKey = tabletopMap?.mapKey ?? null;
        ttrpg.product.tabletop.updatedAtSequence = event.sequence;
      }
      ttrpg.round = 1;
      ttrpg.activeActorKey = turnOrder[0];
      ttrpg.turnOrder = turnOrder;
      ttrpg.initiative = initiative;
      if (!Array.isArray(payload.abilityResets))
        throw new Error("正式场景事件缺少能力场景重置计划。");
      for (const raw of payload.abilityResets) {
        if (!isObject(raw)) throw new Error("能力场景重置项无效。");
        const stateKey = String(raw.stateKey ?? "").trim();
        const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
        const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
        if (
          stateKey !==
            ttrpgAbilityStateKeyV2(
              before.actorInstanceId,
              before.abilityKey,
            ) ||
          stableJson(ttrpg.product.abilityStates[stateKey]) !==
            stableJson(before)
        ) {
          throw new Error(`能力场景重置基线不一致:${stateKey}`);
        }
        ttrpg.product.abilityStates[stateKey] = after;
      }
      ttrpg.product.actionEconomy = startTtrpgActionEconomySceneV2({
        economy: ttrpg.product.actionEconomy,
        sceneKey: scene.sceneKey,
        turnOrder,
      });
      ttrpg.actions = [];
      ttrpg.checks = [];
      ttrpg.attacks = [];
      ttrpg.encounter = null;
      break;
    }
    case "ttrpg.media.requested": {
      const product = requireTtrpgState(state).product;
      if (
        !product.media.runtimePolicy.enabled ||
        product.media.runtimePolicy.networkPolicy === "disabled"
      ) {
        throw new Error("正式 TTRPG 没有启用运行时媒资。");
      }
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const styleBibleHash = String(payload.styleBibleHash ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestKey) ||
        !/^[a-f0-9]{64}$/.test(styleBibleHash) ||
        payload.kind !== slot.kind ||
        payload.targetRef !== slot.targetRef ||
        payload.audience !== slot.audience ||
        (slot.status === "available" && slot.requestKey !== requestKey)
      ) {
        throw new Error("运行时媒资请求没有严格绑定冻结槽位。");
      }
      if (
        product.media.visualBibleHash != null &&
        product.media.visualBibleHash !== styleBibleHash
      ) {
        throw new Error("运行时媒资请求的视觉圣经已经漂移。");
      }
      product.media.visualBibleHash = styleBibleHash;
      slot.status = "queued";
      slot.requestKey = requestKey;
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.media.available": {
      const product = requireTtrpgState(state).product;
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const assetKey = String(payload.assetKey ?? "").trim();
      const contentHash = String(payload.mediaContentHash ?? "").trim();
      const mediaAssetId = assertFiniteInteger(
        payload.mediaAssetId,
        "运行时媒资 ID",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const mediaAssetVersion = assertFiniteInteger(
        payload.mediaAssetVersion,
        "运行时媒资版本",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        slot.status !== "queued" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(assetKey) ||
        !/^[a-f0-9]{64}$/.test(contentHash) ||
        product.media.generatedCount >=
          product.media.runtimePolicy.maximumGeneratedAssets
      ) {
        throw new Error("运行时媒资可用事件无效或超过冻结预算。");
      }
      slot.status = "available";
      slot.assetKey = assetKey;
      slot.mediaAssetId = mediaAssetId;
      slot.mediaAssetVersion = mediaAssetVersion;
      slot.mediaContentHash = contentHash;
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      product.media.generatedCount += 1;
      break;
    }
    case "ttrpg.media.failed": {
      const product = requireTtrpgState(state).product;
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const errorCode = String(payload.errorCode ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        slot.status !== "queued" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(errorCode)
      ) {
        throw new Error("运行时媒资失败事件无效。");
      }
      slot.status = "failed";
      slot.lastErrorCode = errorCode;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.media.cancelled": {
      const product = requireTtrpgState(state).product;
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        !["queued", "failed"].includes(slot.status)
      )
        throw new Error("运行时媒资取消事件无效。");
      slot.status = "cancelled";
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.tabletop.updated": {
      const product = requireTtrpgState(state).product;
      if (
        !product.sessionZero.completed ||
        !product.tabletop ||
        !state.ttrpg?.scene ||
        state.ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式桌面操作需要已开始且未暂停的 CampaignPack 场景。");
      }
      const role = String(payload.role ?? "");
      const actorKey = String(payload.actorKey ?? "").trim();
      if (
        !["gm", "player"].includes(role) ||
        !actorKey ||
        event.actorKey !== actorKey
      )
        throw new Error("桌面操作者身份无效。");
      const operation = parseTtrpgTabletopOperationV1(payload.operation);
      applyTtrpgTabletopOperationV1({
        tabletop: product.tabletop,
        role: role as "gm" | "player",
        actorKey,
        operation,
        sequence: event.sequence,
      });
      break;
    }
    case "ttrpg.check.resolved": {
      const ttrpg = requireTtrpgState(state);
      if (!isObject(payload.check))
        throw new Error("跑团检定缺少 check 对象。");
      const check = assertTtrpgCheck({
        ...payload.check,
        eventSequence: event.sequence,
      });
      if (!ttrpg.turnOrder.includes(check.actorKey))
        throw new Error("跑团检定行动者不在当前回合顺序中。");
      if (
        check.rule.rulePackContentHash !== ttrpg.product.rulePackContentHash
      ) {
        throw new Error("正式 TTRPG 检定缺少匹配冻结规则包的裁定证据。");
      }
      if (ttrpg.activeActorKey !== check.actorKey)
        throw new Error("当前还没轮到该正式规则行动者。");
      ttrpg.checks.push(check);
      break;
    }
    case "ttrpg.intent.receipted": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed || !ttrpg.scene) {
        throw new Error("正式行动意图收据需要已打开的 CampaignPack 场景。");
      }
      const receipt = parseTtrpgIntentReceiptV2(payload.receipt);
      if (
        receipt.eventSequence !== event.sequence ||
        receipt.actorKey !== event.actorKey ||
        receipt.targetKey !== event.targetKey
      ) {
        throw new Error("正式行动意图收据与事件身份不一致。");
      }
      const history = product.intentReceipts;
      if (history.some((item) => item.intentKey === receipt.intentKey)) {
        throw new Error("正式行动意图已经存在终态收据。");
      }
      history.push(receipt);
      break;
    }
    case "ttrpg.human-response.recorded": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed || !ttrpg.scene) {
        throw new Error("真人角色回应需要已打开的正式 CampaignPack 场景。");
      }
      const response = parseTtrpgHumanResponseV2(payload.response);
      if (
        response.eventSequence !== event.sequence ||
        response.actorKey !== event.actorKey
      ) {
        throw new Error("真人角色回应与事件身份不一致。");
      }
      const sourceAction = product.actionHistory.find(
        (action) => action.eventSequence === response.actionSequence,
      );
      const sourceReceipt = sourceAction?.receipt;
      if (
        !sourceReceipt ||
        sourceReceipt.receiptKey !== response.actionReceiptKey
      ) {
        throw new Error("真人角色回应没有绑定有效 ActionReceipt。");
      }
      const observer = sourceReceipt.context.observers.find(
        (item) => item.actorKey === response.actorKey,
      );
      const promptWindow = sourceReceipt.context.reactionWindows.some(
        (window) =>
          window.status !== "closed" &&
          window.layer === "immediate-character" &&
          window.humanConfirmationRequiredActorKeys.includes(response.actorKey),
      );
      if (observer?.responsePolicy !== "prompt-human" || !promptWindow) {
        throw new Error("该角色没有属于本人的开放回应窗口。");
      }
      const history = product.humanResponses;
      if (history.some((item) => item.responseKey === response.responseKey)) {
        throw new Error("该真人角色已经回应本次行动。");
      }
      history.push(response);
      break;
    }
    case "ttrpg.rule.action.resolved": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product.sessionZero.completed ||
        !ttrpg.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式规则行动需要已开始的 CampaignPack 场景。");
      }
      if (!isObject(payload.result)) throw new Error("正式规则行动缺少结果。");
      const result = assertTtrpgRuleActionResult({
        ...payload.result,
        eventSequence: event.sequence,
      });
      if (
        result.actorKey !== event.actorKey ||
        result.targetKey !== event.targetKey
      ) {
        throw new Error("正式规则行动的行动者或目标与事件元数据不一致。");
      }
      if (
        result.actionPhase !== "reaction" &&
        ttrpg.activeActorKey !== result.actorKey
      ) {
        throw new Error("当前还没轮到该正式规则行动者。");
      }
      if (
        result.check &&
        (!result.check.rule ||
          result.check.rule.rulePackContentHash !==
            product.rulePackContentHash ||
          result.check.rule.actionKey !== result.actionKey)
      ) {
        throw new Error("正式规则行动的检定证据与冻结 RulePack 不一致。");
      }
      if (result.receipt) {
        const receipt = result.receipt;
        const declaredIntentKey = receipt.context.declaredIntent?.intentKey;
        if (
          declaredIntentKey &&
          (product.intentReceipts.some(
            (item) => item.intentKey === declaredIntentKey,
          ) ||
            product.actionHistory.some(
              (item) =>
                item.receipt?.context.declaredIntent?.intentKey ===
                declaredIntentKey,
            ))
        ) {
          throw new Error("正式行动意图已经存在终态收据。");
        }
        const observerKeys = receipt.context.observers.map(
          (observer) => observer.actorKey,
        );
        const changedEntityKeys = [
          ...new Set([
            ...result.resourceChanges.map((change) => change.entityKey),
            ...result.conditionChanges.map((change) => change.entityKey),
          ]),
        ];
        const actorConditions = (product.conditions[result.actorKey] ?? []).map(
          (condition) => condition.conditionKey,
        );
        const actorInventory = Object.values(product.inventory.items)
          .filter(
            (item) =>
              item.ownerRef === result.actorKey &&
              !item.stateTags.includes("broken"),
          )
          .map((item) => item.itemInstanceId);
        if (
          receipt.context.sceneKey !== ttrpg.scene.sceneKey ||
          receipt.context.round !== ttrpg.round ||
          receipt.context.activeActorKey !==
            (ttrpg.activeActorKey ?? result.actorKey) ||
          stableJson(observerKeys) !== stableJson(ttrpg.turnOrder) ||
          stableJson(receipt.context.actorConditionKeys) !==
            stableJson(actorConditions) ||
          stableJson(receipt.context.actorInventoryInstanceIds) !==
            stableJson(actorInventory) ||
          stableJson(receipt.changedEntityKeys) !==
            stableJson(changedEntityKeys)
        ) {
          throw new Error("ActionReceipt 上下文与规则行动提交前状态不一致。");
        }
      }
      if (!result.abilityChange) throw new Error("正式规则行动缺少能力次数/冷却变化证据。");
      applyTtrpgMechanicalResultV1(state, result);
      if (result.actionPhase) {
        const transition = spendTtrpgActionEconomyV2({
          economy: product.actionEconomy,
          turnOrder: ttrpg.turnOrder,
          actorKey: result.actorKey,
          phase: result.actionPhase,
        });
        if (
          transition.nextActorKey !== result.nextActorKey ||
          transition.nextRound !== result.nextRound
        ) {
          throw new Error("正式规则行动的行动经济推进不一致。");
        }
        product.actionEconomy = transition.economy;
        ttrpg.activeActorKey = transition.economy.activeActorKey;
        ttrpg.round = transition.economy.round;
      } else if (result.nextActorKey == null) {
        if (result.nextRound !== ttrpg.round)
          throw new Error("非回合行动不能修改回合数。");
      } else {
        const currentIndex = ttrpg.turnOrder.indexOf(result.actorKey);
        const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
        const expectedActor = ttrpg.turnOrder[nextIndex];
        const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0);
        if (
          result.nextActorKey !== expectedActor ||
          result.nextRound !== expectedRound
        ) {
          throw new Error("正式规则行动的回合推进不一致。");
        }
        ttrpg.activeActorKey = result.nextActorKey;
        ttrpg.round = result.nextRound;
      }
      ttrpg.actions.push({
        eventSequence: event.sequence,
        actorKey: result.actorKey,
        text: result.actionName,
      });
      if (result.check) ttrpg.checks.push(result.check);
      product.actionHistory.push(result);
      break;
    }
    case "ttrpg.rest.completed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product.sessionZero.completed ||
        product.ending
      ) {
        throw new Error("正式休息需要进行中的 CampaignPack 与能力账本。");
      }
      if (ttrpg.encounter?.status === "active") {
        throw new Error("战斗遭遇进行中不能完成休息。");
      }
      const receipt = parseTtrpgRestReceiptV2(payload.receipt);
      if (
        receipt.eventSequence !== event.sequence ||
        receipt.completedBy !== event.actorKey
      ) {
        throw new Error("正式休息收据与事件身份不一致。");
      }
      const history = product.restHistory;
      if (history.some((item) => item.restKey === receipt.restKey)) {
        throw new Error("正式休息 key 已经提交。");
      }
      const rulePack = parseRulePackV1(payload.rulePack);
      const expectedChanges = Object.entries(product.abilityStates).flatMap(
        ([stateKey, before]) => {
          if (!receipt.actorKeys.includes(before.actorInstanceId)) return [];
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes(receipt.kind)) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: receipt.kind,
            eventId: `event.${event.sequence}`,
          });
          return [
            {
              stateKey,
              actorKey: before.actorInstanceId,
              abilityKey: before.abilityKey,
              before: structuredClone(before),
              after,
            },
          ];
        },
      );
      if (stableJson(receipt.abilityChanges) !== stableJson(expectedChanges)) {
        throw new Error("正式休息恢复清单与冻结 RulePack 或当前账本不一致。");
      }
      for (const change of receipt.abilityChanges) {
        if (
          stableJson(product.abilityStates[change.stateKey]) !==
          stableJson(change.before)
        ) {
          throw new Error(`正式休息能力账本基线不一致:${change.stateKey}`);
        }
        product.abilityStates[change.stateKey] = structuredClone(change.after);
      }
      history.push(receipt);
      break;
    }
    case "ttrpg.item.changed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed) {
        throw new Error("正式物品命令需要已完成 Session Zero 的库存账本。");
      }
      const command = parseTtrpgItemCommandV2(payload.command);
      if (command.commandId !== event.commandId)
        throw new Error("物品命令与正式事件幂等键不一致。");
      const definitions = isObject(payload.definitions)
        ? Object.fromEntries(
            Object.entries(payload.definitions).map(
              ([definitionKey, definition]) => [
                definitionKey,
                ttrpgItemDefinitionFromRuleV1(
                  definition as import("../types").RuleItemDefinitionV1,
                ),
              ],
            ),
          )
        : null;
      if (!definitions) throw new Error("正式物品命令缺少冻结定义。");
      const before = structuredClone(
        product.inventory.items[command.instanceId] ?? null,
      );
      const applied = applyTtrpgItemCommandV2({
        state: product.inventory,
        definitions,
        command,
      });
      if (applied.replayed) throw new Error("物品命令已经在库存账本执行。");
      const changed = applied.changedItemIds
        .map((itemId) => applied.state.items[itemId])
        .filter(Boolean);
      if (
        changed.some(
          (item) => item.ownerRef != null && !state.entities[item.ownerRef],
        )
      ) {
        throw new Error("物品命令产生了未知角色所有者。");
      }
      product.inventory = applied.state;
      const requestedBy = isObject(payload.requestedBy)
        ? {
            role: String(payload.requestedBy.role),
            actorKey: String(payload.requestedBy.actorKey ?? "").trim(),
          }
        : {
            role: event.actorKey === "gm" ? "gm" : "player",
            actorKey: String(event.actorKey ?? "").trim(),
          };
      if (
        !["gm", "player"].includes(requestedBy.role) ||
        requestedBy.actorKey !== event.actorKey
      ) {
        throw new Error("物品收据操作者与正式事件身份不一致。");
      }
      const after = structuredClone(
        product.inventory.items[command.instanceId] ?? null,
      );
      const history = product.itemHistory;
      if (
        history.some(
          (receipt) =>
            receipt.commandId === event.commandId ||
            receipt.eventSequence === event.sequence,
        )
      ) {
        throw new Error("物品收据已经存在。");
      }
      history.push({
        schema: "storyforge.ttrpg-item-receipt",
        version: 2,
        eventSequence: event.sequence,
        commandId: event.commandId,
        operation: command.kind,
        itemInstanceId: command.instanceId,
        definitionRef:
          before?.definitionRef ??
          after?.definitionRef ??
          (command.kind === "grant" ? command.definitionRef : ""),
        requestedBy: {
          role: requestedBy.role as "gm" | "player",
          actorKey: requestedBy.actorKey,
        },
        before,
        after,
      });
      break;
    }
    case "ttrpg.effects.choice.proposed": {
      const product = requireTtrpgState(state).product;
      if (!product.sessionZero.completed) {
        throw new Error("正式效果选择需要已完成 Session Zero 的效果账本。");
      }
      const plan = parseTtrpgEffectPlanV2(payload.plan);
      if (plan.idempotencyKey !== event.commandId) {
        throw new Error("效果选择提议幂等键与正式事件 commandId 不一致。");
      }
      const actionSequence = assertFiniteInteger(
        payload.actionSequence,
        "效果选择来源行动序号",
        1,
        event.sequence - 1,
      );
      const ownerActorKey = String(payload.ownerActorKey ?? "").trim();
      if (event.actorKey !== "gm" || !ownerActorKey) {
        throw new Error("效果选择提议必须由 GM 提交并绑定所有者。");
      }
      const proposed = proposeTtrpgEffectChoiceToRuntimeV2({
        state,
        plan,
        actionSequence,
        ownerActorKey,
        eventSequence: event.sequence,
      });
      Object.assign(state, proposed.state);
      break;
    }
    case "ttrpg.effects.applied": {
      const product = requireTtrpgState(state).product;
      if (!product.sessionZero.completed) {
        throw new Error("正式 EffectPlan 需要已完成 Session Zero 的效果账本。");
      }
      const plan = parseTtrpgEffectPlanV2(payload.plan);
      if (plan.idempotencyKey !== event.commandId)
        throw new Error("EffectPlan 幂等键与正式事件 commandId 不一致。");
      const rulePack = parseRulePackV1(payload.rulePack);
      if (payload.choiceKey != null) {
        if (!isObject(payload.requestedBy)) {
          throw new Error("效果选择结算缺少操作者。");
        }
        const choiceKey = String(payload.choiceKey ?? "").trim();
        const selectedEffectKey = String(
          payload.selectedEffectKey ?? "",
        ).trim();
        const requestedBy = {
          role: String(payload.requestedBy.role ?? ""),
          actorKey: String(payload.requestedBy.actorKey ?? "").trim(),
        };
        const pending = product.effectLedger.pendingChoices.find(
          (choice) => choice.choiceKey === choiceKey,
        );
        if (
          !pending ||
          !["gm", "player"].includes(requestedBy.role) ||
          requestedBy.actorKey !== pending.ownerActorKey ||
          event.actorKey !== pending.ownerActorKey
        ) {
          throw new Error("效果选择结算身份或所有者不一致。");
        }
        const resolved = resolveTtrpgEffectChoiceToRuntimeV2({
          state,
          rulePack,
          choiceKey,
          selectedEffectKey,
          commandId: event.commandId,
          eventSequence: event.sequence,
        });
        if (stableJson(resolved.plan) !== stableJson(plan)) {
          throw new Error("效果选择结算计划不是由冻结选项派生。");
        }
        Object.assign(state, resolved.state);
        break;
      }
      if (
        product.effectLedger.pendingChoices.some(
          (choice) => choice.plan.sourceEventId === plan.sourceEventId,
        )
      ) {
        throw new Error("该行动已有待玩家确认的后果，不能绕过选择直接结算。");
      }
      const applied = applyTtrpgEffectPlanToRuntimeV2({
        state,
        rulePack,
        plan,
        eventSequence: event.sequence,
      });
      Object.assign(state, applied.state);
      break;
    }
    case "ttrpg.private-guidance.recorded": {
      const product = requireTtrpgState(state).product;
      const receipt = parseTtrpgPrivateGuidanceReceiptV1(payload.guidance);
      if (!product.sessionZero.completed || product.safety.status !== 'active' || product.ending
        || event.actorKey !== receipt.actorKey || receipt.eventSequence !== event.sequence
        || receipt.runId !== payload.runId || receipt.candidateHash !== payload.candidateHash
        || !product.sessionZero.selectedCharacterKeys.includes(receipt.actorKey)) throw new Error('私密指引身份或状态无效');
      (product.privateGuidance ??= []).push(receipt);
      break;
    }
    case "ttrpg.director.committed": {
      const ttrpg = requireTtrpgState(state), product = ttrpg.product;
      const receipt = parseTtrpgDirectorReceiptV1(payload.decision);
      if (!product.sessionZero.completed || product.safety.status !== 'active' || product.ending
        || receipt.eventSequence !== event.sequence || receipt.sceneKey !== ttrpg.scene?.sceneKey
        || receipt.basisActionSequence !== product.actionHistory[product.actionHistory.length - 1]?.eventSequence
        || receipt.actorKey !== product.actionHistory[product.actionHistory.length - 1]?.actorKey
        || receipt.runId !== payload.runId || receipt.candidateHash !== payload.candidateHash
        || product.directorDecisions?.some(item => item.basisActionSequence === receipt.basisActionSequence)
        || receipt.recommendedSceneKeys.some(key => !product.sceneKeys.includes(key))
        || receipt.recommendedEndingKeys.some(key => !product.endingCatalog.some(ending => ending.endingKey === key)))
        throw new Error('主持决策未绑定当前行动、场景或授权');
      for (const reveal of receipt.reveals) {
        applyTtrpgRuntimeEventV1(state, { ...event, type: 'ttrpg.clue.discovered', actorKey: reveal.actorKey, targetKey: reveal.clueKey },
          { clueKey: reveal.clueKey, actorKey: reveal.actorKey, visibility: reveal.visibility });
      }
      (product.directorDecisions ??= []).push(receipt);
      break;
    }
    case "ttrpg.gm.response.recorded": {
      const ttrpg = requireTtrpgState(state);
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("跑团尚未开始活动场景。");
      const actionSequence = assertFiniteInteger(
        payload.actionSequence,
        "跑团动作序号",
        1,
        event.sequence - 1,
      );
      if (
        !ttrpg.actions.some((action) => action.eventSequence === actionSequence)
      ) {
        throw new Error("AI GM 叙事没有对应的玩家动作。");
      }
      if (payload.checkSequence != null) {
        const checkSequence = assertFiniteInteger(
          payload.checkSequence,
          "跑团检定序号",
          1,
          event.sequence - 1,
        );
        if (
          !ttrpg.checks.some((check) => check.eventSequence === checkSequence)
        ) {
          throw new Error("AI GM 叙事引用了不存在的检定。");
        }
      }
      const text = String(payload.text ?? "").trim();
      if (!text || text.length > 20_000)
        throw new Error("AI GM 叙事文本无效。");
      {
        const source = String(payload.source ?? "");
        const candidateHash =
          payload.candidateHash == null ? null : String(payload.candidateHash);
        const runId =
          payload.runId == null
            ? null
            : assertFiniteInteger(
                payload.runId,
                "AI GM Run ID",
                1,
                Number.MAX_SAFE_INTEGER,
              );
        const latestAction =
          ttrpg.product.actionHistory[ttrpg.product.actionHistory.length - 1];
        if (
          !["human-gm", "ai-confirmed", "deterministic-fallback"].includes(
            source,
          ) ||
          (source === "ai-confirmed" &&
            (!candidateHash ||
              !/^[0-9a-f]{64}$/.test(candidateHash) ||
              runId == null)) ||
          ((source === "human-gm" || source === "deterministic-fallback") &&
            (candidateHash != null || runId != null)) ||
          latestAction?.eventSequence !== actionSequence
        ) {
          throw new Error("正式 GM 叙事证据无效或没有绑定最近规则行动。");
        }
        const checkSequence =
          payload.checkSequence == null
            ? null
            : assertFiniteInteger(
                payload.checkSequence,
                "跑团检定序号",
                1,
                event.sequence - 1,
              );
        if ((latestAction.check?.eventSequence ?? null) !== checkSequence) {
          throw new Error("正式 AI GM 叙事引用的检定与规则行动不一致。");
        }
        if (
          ttrpg.product.gmNarrations.some(
            (item) => item.actionSequence === actionSequence,
          )
        ) {
          throw new Error("最近规则行动已经有正式 GM 叙事。");
        }
        const modelEvidence = parseTtrpgModelEvidenceV1(payload.modelEvidence);
        if (!Array.isArray(payload.modelCalls)) {
          throw new Error("正式 GM 响应缺少模型调用账本。");
        }
        const modelCalls = payload.modelCalls
          .map(parseTtrpgModelEvidenceV1)
          .filter(
            (item): item is TtrpgRuntimeModelEvidenceV1 => item != null,
          );
        const repairApplied = payload.repairApplied === true;
        if (
          modelCalls.length > 2 ||
          ((source === "human-gm" || source === "deterministic-fallback") &&
            (modelEvidence || modelCalls.length || repairApplied))
        ) {
          throw new Error("正式 GM 模型调用或修复证据无效。");
        }
        const synthesisFrame = parseTtrpgGmSynthesisFrameV2(
          payload.synthesisFrame,
          latestAction.receipt,
        );
        ttrpg.product.gmNarrations.push({
          eventSequence: event.sequence,
          actionSequence,
          checkSequence,
          text,
          candidateHash,
          runId,
          modelEvidence,
          modelCalls,
          repairApplied,
          synthesisFrame,
          source: source as
            "human-gm" | "ai-confirmed" | "deterministic-fallback",
        });
      }
      state.narratives.push({ eventSequence: event.sequence, text });
      break;
    }
    case "ttrpg.campaign.ended": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        product.ending ||
        !ttrpg.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式战役当前不能提交结局。");
      }
      const endingKey = String(payload.endingKey ?? "").trim();
      const ending = product.endingCatalog.find(
        (item) => item.endingKey === endingKey,
      );
      if (
        !ending ||
        payload.title !== ending.title ||
        payload.epilogue !== ending.epilogue
      ) {
        throw new Error("战役结局与冻结 CampaignPack 不一致。");
      }
      const knownConclusions = new Set(
        product.discoveredClues.flatMap((discovery) => {
          const clue = product.clueCatalog.find(
            (item) => item.clueKey === discovery.clueKey,
          );
          return clue ? [clue.conclusionKey] : [];
        }),
      );
      if (
        ending.trigger.sceneKey !== ttrpg.scene.sceneKey ||
        ending.trigger.requiredConclusionKeys.some(
          (key) => !knownConclusions.has(key),
        ) ||
        ending.trigger.forbiddenConclusionKeys.some((key) =>
          knownConclusions.has(key),
        )
      ) {
        throw new Error("战役结局触发条件与当前状态不一致。");
      }
      if (!Array.isArray(payload.awardedMilestones))
        throw new Error("战役结局缺少成长里程碑。");
      const awardedMilestones = payload.awardedMilestones.map((raw, index) => {
        if (!isObject(raw)) throw new Error(`战役成长奖励 ${index} 无效。`);
        return {
          milestoneKey: String(raw.milestoneKey ?? "").trim(),
          award: assertFiniteInteger(raw.award, "战役成长奖励", 0, 1_000_000),
        };
      });
      const expectedMilestones = product.advancement.milestones
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
      if (stableJson(awardedMilestones) !== stableJson(expectedMilestones)) {
        throw new Error("战役成长奖励与冻结 CampaignPack 不一致。");
      }
      product.advancement.awardedMilestoneKeys.push(
        ...awardedMilestones.map((item) => item.milestoneKey),
      );
      product.advancement.totalAwarded += awardedMilestones.reduce(
        (sum, item) => sum + item.award,
        0,
      );
      product.ending = { endingKey, eventSequence: event.sequence };
      ttrpg.scene.status = "resolved";
      ttrpg.activeActorKey = null;
      state.narratives.push({
        eventSequence: event.sequence,
        text: ending.epilogue,
      });
      break;
    }
    case "ttrpg.campaign.session.started": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product.sessionZero.completed ||
        product.ending ||
        ttrpg.campaign.activeSessionKey != null
      ) {
        throw new Error("当前正式战役不能开始新的长期分场。");
      }
      const playSession = assertTtrpgCampaignPlaySessionV2(payload.playSession);
      if (
        playSession.status !== "active" ||
        playSession.startedSequence !== event.sequence ||
        playSession.completedSequence != null ||
        playSession.ordinal !== ttrpg.campaign.playSessions.length + 1 ||
        playSession.rulePackContentHash !== product.rulePackContentHash ||
        playSession.campaignKey !== product.campaignKey ||
        ttrpg.campaign.playSessions.some(
          (item) => item.sessionKey === playSession.sessionKey,
        )
      ) {
        throw new Error("长期战役分场开始收据与当前冻结战役不一致。");
      }
      const activeRoster = ttrpg.campaign.roster
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.characterKey)
        .sort();
      const participants = [...playSession.participantKeys].sort();
      if (
        !activeRoster.length ||
        stableJson(activeRoster) !== stableJson(participants) ||
        participants.some((key) => state.entities[key]?.kind !== "player")
      ) {
        throw new Error("长期战役分场参与者必须精确匹配当前活动编组。");
      }
      ttrpg.campaign.playSessions.push(playSession);
      ttrpg.campaign.activeSessionKey = playSession.sessionKey;
      ttrpg.campaign.roster = ttrpg.campaign.roster.map((entry) =>
        entry.status === "active" && entry.joinedSessionKey == null
          ? {
              ...entry,
              joinedSessionKey: playSession.sessionKey,
              updatedSequence: event.sequence,
            }
          : entry,
      );
      break;
    }
    case "ttrpg.campaign.session.completed": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      const sessionKey = longCampaignKey(
        payload.sessionKey,
        "长期战役完成分场 key",
      );
      const active = campaignState.playSessions.find(
        (item) => item.sessionKey === sessionKey,
      );
      const summary = longCampaignText(
        payload.summary,
        "长期战役分场摘要",
        20_000,
      );
      if (
        campaignState.activeSessionKey !== sessionKey ||
        active?.status !== "active" ||
        active.completedSequence != null ||
        !Array.isArray(payload.memories) ||
        !Array.isArray(payload.abilityResets)
      ) {
        throw new Error("长期战役完成事件没有绑定当前活动分场。");
      }
      const memories = payload.memories.map(assertTtrpgCampaignMemoryV2);
      if (
        new Set(memories.map((item) => item.memoryKey)).size !==
          memories.length ||
        memories.some(
          (item) =>
            item.sourceSessionKey !== sessionKey ||
            item.updatedSequence !== event.sequence ||
            campaignState.memories.some(
              (prior) => prior.memoryKey === item.memoryKey,
            ) ||
            (item.audience.startsWith("actor:") &&
              !campaignState.roster.some(
                (entry) =>
                  entry.characterKey === item.audience.slice("actor:".length),
              )),
        )
      ) {
        throw new Error("长期战役记忆没有唯一绑定当前分场或合法受众。");
      }
      const product = ttrpg.product;
      for (const raw of payload.abilityResets) {
        if (!isObject(raw)) throw new Error("能力跨场重置项无效。");
        const stateKey = String(raw.stateKey ?? "").trim();
        const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
        const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
        if (
          stateKey !==
            ttrpgAbilityStateKeyV2(before.actorInstanceId, before.abilityKey) ||
          stableJson(product.abilityStates[stateKey]) !== stableJson(before) ||
          after.actorInstanceId !== before.actorInstanceId ||
          after.abilityKey !== before.abilityKey ||
          after.lastUsedEventId !== `event.${event.sequence}`
        ) {
          throw new Error(`能力跨场重置基线不一致:${stateKey}`);
        }
        product.abilityStates[stateKey] = after;
      }
      active.status = "completed";
      active.completedSequence = event.sequence;
      active.summary = summary;
      campaignState.activeSessionKey = null;
      campaignState.memories.push(...memories);
      const summaryEntry = `第 ${active.ordinal} 场《${active.title}》：${summary}`;
      campaignState.summary = [campaignState.summary, summaryEntry]
        .filter(Boolean)
        .join("\n\n")
        .slice(-20_000);
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.roster.changed": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      if (campaignState.activeSessionKey != null)
        throw new Error("长期战役只能在两场之间变更编组。");
      const entry = assertTtrpgRosterEntryV2(payload.entry);
      const priorIndex = campaignState.roster.findIndex(
        (item) => item.characterKey === entry.characterKey,
      );
      const prior = campaignState.roster[priorIndex];
      if (
        !prior ||
        entry.updatedSequence !== event.sequence ||
        state.entities[entry.characterKey]?.kind !== "player" ||
        !ttrpg.product.characterProgression[entry.characterKey] ||
        prior.status === "retired" ||
        prior.status === entry.status ||
        (prior.status === "reserve" && entry.status !== "active") ||
        (prior.status === "active" && entry.status === "active") ||
        entry.joinedSessionKey !== prior.joinedSessionKey ||
        (entry.status === "retired" && entry.leftSessionKey == null) ||
        (entry.status !== "retired" && entry.leftSessionKey != null)
      ) {
        throw new Error("长期战役编组变更不是允许的补员、轮换或退役迁移。");
      }
      if (entry.replacementFor != null) {
        const replaced = campaignState.roster.find(
          (item) => item.characterKey === entry.replacementFor,
        );
        if (
          entry.status !== "active" ||
          entry.replacementFor === entry.characterKey ||
          replaced?.status !== "retired"
        ) {
          throw new Error("补员替代关系必须指向已经退役的不同角色。");
        }
      }
      const nextRoster = [...campaignState.roster];
      nextRoster[priorIndex] = entry;
      const activeKeys = nextRoster
        .filter((item) => item.status === "active")
        .map((item) => item.characterKey);
      if (!activeKeys.length || activeKeys.length > 12)
        throw new Error("长期战役必须保留 1–12 名活动角色。");
      campaignState.roster = nextRoster;
      ttrpg.campaign = campaignState;
      ttrpg.product.sessionZero.selectedCharacterKeys = activeKeys;
      break;
    }
    case "ttrpg.campaign.supplement.activated": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      if (campaignState.activeSessionKey != null)
        throw new Error("补充包只能在两场之间激活。");
      const supplement = assertTtrpgSupplementReceiptV2(payload.supplement);
      if (
        supplement.updatedSequence !== event.sequence ||
        campaignState.supplements.some(
          (item) => item.supplementKey === supplement.supplementKey,
        ) ||
        (supplement.activatedSessionKey != null &&
          !campaignState.playSessions.some(
            (item) =>
              item.sessionKey === supplement.activatedSessionKey &&
              item.status === "completed",
          ))
      ) {
        throw new Error("补充包激活收据无效或重复。");
      }
      campaignState.supplements.push(supplement);
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.world-evolution.recorded": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      if (campaignState.activeSessionKey != null)
        throw new Error("世界演化候选只能在两场之间记录或复审。");
      const candidate = assertTtrpgWorldEvolutionV2(payload.candidate);
      if (
        candidate.updatedSequence !== event.sequence ||
        !campaignState.playSessions.some(
          (item) =>
            item.sessionKey === candidate.sourceSessionKey &&
            item.status === "completed",
        )
      ) {
        throw new Error("世界演化候选没有绑定已完成分场。");
      }
      const index = campaignState.worldEvolution.findIndex(
        (item) => item.candidateKey === candidate.candidateKey,
      );
      const prior = campaignState.worldEvolution[index];
      if (!prior) {
        if (candidate.status !== "proposed" || candidate.reviewedBy != null)
          throw new Error("新世界演化候选必须先进入 proposed 状态。");
        campaignState.worldEvolution.push(candidate);
      } else {
        if (
          prior.status !== "proposed" ||
          candidate.status === "proposed" ||
          candidate.reviewedBy == null ||
          candidate.category !== prior.category ||
          candidate.summary !== prior.summary ||
          candidate.sourceSessionKey !== prior.sourceSessionKey ||
          candidate.targetWorldRef !== prior.targetWorldRef
        ) {
          throw new Error("世界演化候选只能由 proposed 审核为批准或拒绝。");
        }
        campaignState.worldEvolution[index] = candidate;
      }
      // Approval deliberately stops at a review candidate. World Canon writes
      // still require the normal AdoptionSchema/FIELD_REGISTRY path.
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.version-transition.recorded": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      const product = ttrpg.product;
      if (campaignState.activeSessionKey != null)
        throw new Error("版本迁移只能在冻结战役的两场之间记录。");
      const transition = assertTtrpgVersionTransitionV2(payload.transition);
      if (
        transition.updatedSequence !== event.sequence ||
        transition.fromRulePackContentHash !== product.rulePackContentHash ||
        transition.fromCampaignKey !== product.campaignKey ||
        campaignState.versionTransitions.some(
          (item) => item.transitionKey === transition.transitionKey,
        ) ||
        (transition.status === "activated" &&
          (transition.toRulePackContentHash !== product.rulePackContentHash ||
            transition.toCampaignKey !== product.campaignKey))
      ) {
        throw new Error("版本迁移记录与当前冻结内容不一致或试图原地换包。");
      }
      campaignState.versionTransitions.push(transition);
      ttrpg.campaign = campaignState;
      break;
    }
    default:
      throw new Error(`[ttrpg] 未登记运行事件：${event.type}`)
  }
  state.lastSequence = event.sequence
  return state
}
