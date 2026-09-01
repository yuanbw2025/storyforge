import { db } from "../db/schema";
import { verifyPlayableGamePackageSource } from "../game-production/preview-source";
import {
  hashSimulationRuntimeStateV1,
  readSimulationState,
} from "../simulation/runtime";
import type {
  SimulationSession,
  WorkspaceScope,
} from "../types";
import { EMPTY_SIMULATION_STATE } from "../types";
import { createContinuedTtrpgGameInstanceV2 } from "../world-engine/instances";
import { resolveScope } from "../world-engine/scope";
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
  gameReleaseId: number,
) {
  const playable = await verifyPlayableGamePackageSource({
    scope,
    source: { kind: "release", gameReleaseId },
  });
  if (
    playable.runtimePackage.productType !== "ttrpg" ||
    !playable.runtimePackage.ttrpg
  )
    throw new Error("[ttrpg-continuity] GameRelease 不是正式 TTRPG 发布");
  return playable;
}

/** Read-only preview. Its hash is the mandatory approval token for creation. */
export async function previewTtrpgContinuationV2(input: {
  scope: WorkspaceScope;
  parentSessionId: number;
  targetGameReleaseId: number;
  compatibility: TtrpgContinuationCompatibilityV2;
  transitionKey: string;
  approvedBy: string;
}): Promise<TtrpgContinuationPlanV2> {
  const scope = await resolveScope({ scope: input.scope });
  const parent = await db.simulationSessions.get(input.parentSessionId);
  if (
    !parent ||
    parent.kind !== "ttrpg" ||
    parent.status !== "active" ||
    parent.projectId !== scope.projectId ||
    parent.worldId !== scope.worldId ||
    parent.workId !== scope.workId ||
    parent.gameReleaseId == null
  ) {
    throw new Error(
      "[ttrpg-continuity] 父 TTRPG Instance 不存在或不在当前 Work",
    );
  }
  const [parentPlayable, targetPlayable, parentState] = await Promise.all([
    verifiedTtrpgSource(scope, parent.gameReleaseId),
    verifiedTtrpgSource(scope, input.targetGameReleaseId),
    readSimulationState(parent.id!),
  ]);
  const targetInitialState = createInitialTtrpgProductStateV1({
    initialState: structuredClone(EMPTY_SIMULATION_STATE),
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
  const parentStateHash = await hashSimulationRuntimeStateV1(parentState);
  const result = await buildTtrpgContinuationStateV2({
    parentSessionId: parent.id!,
    parentSequence: parentState.lastSequence,
    parentStateHash,
    targetGameReleaseId: input.targetGameReleaseId,
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
}): Promise<SimulationSession> {
  if (
    input.plan.schema !== "storyforge.ttrpg-continuation-plan" ||
    input.plan.version !== 2
  ) {
    throw new Error("[ttrpg-continuity] 续团计划格式无效");
  }
  return createContinuedTtrpgGameInstanceV2({
    scope: input.scope,
    targetGameReleaseId: input.plan.targetGameReleaseId,
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
