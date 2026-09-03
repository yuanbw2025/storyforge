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
) {
  const playable = await verifyProductRuntimeSource({
    scope,
    source: { kind: "release", productReleaseId },
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
  const targetInitialState = createInitialTtrpgProductStateV1({
    initialState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    content: targetPlayable.runtimePackage.ttrpg!,
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
