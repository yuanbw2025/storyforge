import { isTtrpgRuntimeContentV1, isTtrpgRuntimeContentV2 } from './content-version'
import { buildTtrpgOpenReleaseContinuationV1, type TtrpgOpenContinuationRequestV1 } from './open-release-continuation'
import { createProductInitialStateV1, createProductRuntimeInstance } from '../product/runtime-instances'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { assertTtrpgOpenAuthorizationCurrentV1 } from './open-authorization'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { db } from "../db/schema";
import { verifyProductRuntimeSource } from "../product-production/preview-source";
import {
  hashProductRuntimeStateV1,
  readProductRuntimeState,
} from "./runtime-api";
import type {
  ProductRuntimeSession,
  WorkspaceScope,
} from "../types";
import { EMPTY_PRODUCT_RUNTIME_STATE } from "../types";
import { createContinuedTtrpgRuntimeInstanceV2 } from "../product/runtime-instances";
import { resolveScope } from "../workspace/scope";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import {
  buildTtrpgContinuationStateV2,
  type TtrpgContinuationCompatibilityV2,
  type TtrpgContinuationPlanV2,
} from "./continuity-state";
import { parseRulePackV1 } from "./rule-pack";
import { createInitialTtrpgProductStateV1 } from "./runtime";

async function verifiedTtrpgSource(
  scope: WorkspaceScope,
  productReleaseId: number,
  ttrpgProtocol?: 2,
) {
  const playable = await verifyProductRuntimeSource({
    scope,
    source: { kind: "release", productReleaseId },
    ttrpgProtocol,
  });
  if (
    playable.runtimePackage.productType !== "ttrpg" ||
    !playable.runtimePackage.ttrpg
  )
    throw new Error("[ttrpg-continuity] ProductRelease 不是正式 TTRPG 发布");
  return playable;
}

/** Read-only preview. Its hash is the mandatory approval token for creation. */
export async function previewTtrpgContinuationV2(input: {
  scope: WorkspaceScope;
  parentSessionId: number;
  targetProductReleaseId: number;
  compatibility: TtrpgContinuationCompatibilityV2;
  transitionKey: string;
  approvedBy: string;
}): Promise<TtrpgContinuationPlanV2> {
  const scope = await resolveScope({ scope: input.scope });
  const parent = await db.productRuntimeSessions.get(input.parentSessionId);
  if (
    !parent ||
    parent.kind !== "ttrpg" ||
    parent.status !== "active" ||
    parent.projectId !== scope.projectId ||
    parent.worldId !== scope.worldId ||
    parent.workId !== scope.workId ||
    parent.productReleaseId == null
  ) {
    throw new Error(
      "[ttrpg-continuity] 父 TTRPG Instance 不存在或不在当前 Work",
    );
  }
  const [parentPlayable, targetPlayable, parentState] = await Promise.all([
    verifiedTtrpgSource(scope, parent.productReleaseId),
    verifiedTtrpgSource(scope, input.targetProductReleaseId),
    readProductRuntimeState(parent.id!),
  ]);
  const parentContent = parentPlayable.runtimePackage.ttrpg!, targetContent = targetPlayable.runtimePackage.ttrpg!;
  if (!isTtrpgRuntimeContentV1(parentContent) || !isTtrpgRuntimeContentV1(targetContent)) throw new Error('scripted 续团预览仅接受协议 1');
  const targetInitialState = createInitialTtrpgProductStateV1({
    initialState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    content: targetContent,
  });
  const parentRulePack = parseRulePackV1(
    parentPlayable.runtimePackage.ttrpg!.rulePack.content,
  );
  const targetRulePack = parseRulePackV1(
    targetPlayable.runtimePackage.ttrpg!.rulePack.content,
  );
  const parentCampaign = parseTtrpgCampaignContentV1(
    parentPlayable.runtimePackage.ttrpg!.campaign,
    parentRulePack,
  );
  const targetCampaign = parseTtrpgCampaignContentV1(
    targetPlayable.runtimePackage.ttrpg!.campaign,
    targetRulePack,
  );
  const parentStateHash = await hashProductRuntimeStateV1(parentState);
  const result = await buildTtrpgContinuationStateV2({
    parentSessionId: parent.id!,
    parentSequence: parentState.lastSequence,
    parentStateHash,
    targetProductReleaseId: input.targetProductReleaseId,
    parentState,
    targetInitialState,
    parentRulePack,
    targetRulePack,
    parentCampaign,
    targetCampaign,
    compatibility: input.compatibility,
    transitionKey: input.transitionKey,
    approvedBy: input.approvedBy,
  });
  return result.plan;
}

export async function createTtrpgContinuationFromPlanV2(input: {
  scope: WorkspaceScope;
  plan: TtrpgContinuationPlanV2;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<ProductRuntimeSession> {
  if (
    input.plan.schema !== "storyforge.ttrpg-continuation-plan" ||
    input.plan.version !== 2
  ) {
    throw new Error("[ttrpg-continuity] 续团计划格式无效");
  }
  return createContinuedTtrpgRuntimeInstanceV2({
    scope: input.scope,
    targetProductReleaseId: input.plan.targetProductReleaseId,
    title: input.title,
    worldGroupId: input.worldGroupId,
    seed: input.seed,
    continuation: {
      parentSessionId: input.plan.parentSessionId,
      expectedParentSequence: input.plan.parentSequence,
      expectedParentStateHash: input.plan.parentStateHash,
      expectedPlanHash: input.plan.planHash,
      compatibility: input.plan.compatibility,
      transitionKey: input.plan.transitionKey,
      approvedBy: input.plan.approvedBy,
    },
  });
}

/** Read-only, actual source/seat-bound open continuation preview. */
export async function previewTtrpgOpenContinuationV1(input: {
  scope: WorkspaceScope; parentSessionId: number; targetProductReleaseId: number; transitionKey: string;
  approvedBy: string; reason: string; openingTemplateKeys: readonly string[]
}) {
  const scope = await resolveScope({ scope: input.scope }), parent = await db.productRuntimeSessions.get(input.parentSessionId);
  if (!parent || parent.kind !== 'ttrpg' || parent.status !== 'active' || parent.projectId !== scope.projectId || parent.worldId !== scope.worldId
    || parent.workId !== scope.workId || parent.productReleaseId == null || parent.productReleaseId === input.targetProductReleaseId) throw new Error('请从同一作品选择不同的正式发布用于续团');
  const [from, to, state, events, participants] = await Promise.all([
    verifiedTtrpgSource(scope, parent.productReleaseId, 2), verifiedTtrpgSource(scope, input.targetProductReleaseId, 2),
    readProductRuntimeState(parent.id!), db.productRuntimeEvents.where('sessionId').equals(parent.id!).sortBy('sequence'), readTtrpgSessionParticipantsV2(parent.id!),
  ]);
  const parentContent = from.runtimePackage.ttrpg!, targetContent = to.runtimePackage.ttrpg!, authorization = parseTtrpgRuntimeStateV2(state.ttrpg)?.authorization;
  if (!authorization || !isTtrpgRuntimeContentV2(parentContent) || !isTtrpgRuntimeContentV2(targetContent)) throw new Error('开放续团需要原团局权限和协议 2 发布');
  assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants, viewerKey: input.approvedBy });
  const stateHash = await hashProductRuntimeStateV1(state);
  const { plan } = await buildTtrpgOpenReleaseContinuationV1({ ...input, parent, parentState: state, parentStateHash: stateHash, events,
    parentContent, targetContent, targetRuntimeSourceHash: to.runtimeSourceHash,
    targetInitialState: createProductInitialStateV1({ runtimePackage: to.runtimePackage, runtimeSourceHash: to.runtimeSourceHash }) });
  return { parentSessionId: parent.id!, targetProductReleaseId: input.targetProductReleaseId, parentStateHash: stateHash, plan };
}
export async function createTtrpgOpenContinuationFromPlanV1(input: {
  scope: WorkspaceScope; preview: Awaited<ReturnType<typeof previewTtrpgOpenContinuationV1>>; title: string; worldGroupId?: number | null
}): Promise<ProductRuntimeSession> {
  const { preview } = input, { plan } = preview;
  const continuation: TtrpgOpenContinuationRequestV1 = { kind: 'open-compatible', compatibility: 'compatible', parentSessionId: preview.parentSessionId,
    expectedParentSequence: plan.parentSequence, expectedParentStateHash: preview.parentStateHash, expectedPlanHash: plan.planHash,
    transitionKey: plan.transitionKey, approvedBy: plan.approvedBy, reason: plan.reason, openingTemplateKeys: plan.openingTemplateKeys };
  return createProductRuntimeInstance({ scope: input.scope, kind: 'ttrpg', title: input.title,
    productSource: { kind: 'release', productReleaseId: preview.targetProductReleaseId }, worldGroupId: input.worldGroupId, ttrpgContinuation: continuation });
}
