import { verifyProductReleaseManifestV1 } from "../product-production/runtime-package";
import { verifyProductRuntimeSource } from "../product-production/preview-source";
import { db } from "../db/schema";
import type { AssembleContextInput } from "../registry/types";
import { readProductRuntimeState } from "./runtime-api";
import { assertProductReleaseUnchanged } from "../product/releases";
import type { ProductRuntimePackageV1, WorkspaceScope } from "../types";
import { assertInstanceBinding } from "../product/runtime-instances";
import { resolveScope } from "../workspace/scope";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import { readTtrpgSessionParticipantsV2 } from "./participants";
import { parseRulePackV1 } from "./rule-pack";
import {
  createTtrpgViewerProjectionV1,
  type TtrpgViewerProjectionV1,
} from "./viewer-projection";

type PlayerSafeSceneV1 = Omit<
  TtrpgViewerProjectionV1["scenes"][number],
  "failureForward" | "gmSecret"
>;
type PlayerSafeProjectionV1 = Omit<
  TtrpgViewerProjectionV1,
  "scenes" | "gmControls"
> & {
  scenes: PlayerSafeSceneV1[];
};

export interface TtrpgPlayerRuntimeViewV1 {
  schema: "storyforge.ttrpg-player-runtime-view";
  version: 1;
  session: {
    id: number;
    title: string;
    projectId: number;
    worldGroupId: number | null;
    releaseHash: string;
    packageHash: string;
    rulePackContentHash: string;
    campaignKey: string;
    eventSequence: number;
  };
  seat: {
    seatKey: string;
    actorKey: string;
    viewerKey: string;
    controller: "ai" | "hybrid";
    activation: "manual" | "initiative" | "natural" | "pooled";
    agency: "reactive" | "balanced" | "proactive";
    riskTolerance: "safe" | "balanced" | "bold";
    requiresHumanConfirmation: boolean;
  };
  projection: PlayerSafeProjectionV1;
}

function fail(message: string): never {
  throw new Error(`[ttrpg-player-context] ${message}`);
}

/**
 * The only AI-player read model. It is built from the same player projection
 * used by the UI and then strips even null-valued GM-only field names so a
 * player prompt never establishes a second, more permissive visibility path.
 */
export async function loadTtrpgPlayerRuntimeViewV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
  actorKey: string;
}): Promise<TtrpgPlayerRuntimeViewV1> {
  const actorKey = input.actorKey.trim();
  if (!actorKey) fail("缺少 AI 玩家角色 key");
  const session = await assertInstanceBinding(
    input.productRuntimeSessionId,
    input.scope,
  );
  const sourceCount = [
    session.productReleaseId,
    session.productBuildId,
  ].filter((value) => value != null).length;
  if (
    session.kind !== "ttrpg" ||
    session.id == null ||
    !session.runtimeSourceHash ||
    sourceCount !== 1
  ) {
    fail("只能读取绑定唯一已验证 Release 或 Build Preview 的 TTRPG Instance");
  }
  let runtimePackage: ProductRuntimePackageV1;
  let packageHash: string;
  let sourceIdentityHash: string;
  if (session.productReleaseId != null) {
    const release = await assertProductReleaseUnchanged(session.productReleaseId);
    const manifest = await verifyProductReleaseManifestV1(release.manifestJson);
    runtimePackage = manifest.runtimePackage;
    packageHash = manifest.packageHash;
    sourceIdentityHash = release.contentHash;
  } else if (session.productBuildId != null) {
    const build = await db.productBuilds.get(session.productBuildId!);
    if (!build?.previewHash) fail("Build Preview 缺少冻结 previewHash");
    const playable = await verifyProductRuntimeSource({
      scope: input.scope,
      source: {
        kind: "build",
        productBuildId: session.productBuildId!,
        expectedPreviewHash: build.previewHash,
      },
    });
    runtimePackage = playable.runtimePackage;
    packageHash = playable.packageHash;
    sourceIdentityHash = build.previewHash;
  } else fail("旧 TTRPG 专用 Build 已下线；请重新生成统一 Product Build");
  if (
    runtimePackage.productType !== "ttrpg" ||
    !runtimePackage.ttrpg ||
    packageHash !== session.runtimeSourceHash
  ) {
    fail("Instance 与冻结 TTRPG RuntimePackage 不一致");
  }
  const rulePack = parseRulePackV1(runtimePackage.ttrpg.rulePack.content);
  const campaign = parseTtrpgCampaignContentV1(
    runtimePackage.ttrpg.campaign,
    rulePack,
  );
  const [state, participants] = await Promise.all([
    readProductRuntimeState(session.id),
    readTtrpgSessionParticipantsV2(session.id),
  ]);
  const product = state.ttrpg?.product;
  if (
    !product?.sessionZero.completed ||
    !state.ttrpg?.scene ||
    product.safety.status !== "active" ||
    product.ending
  ) {
    fail("AI 玩家需要已完成 Session Zero、活动场景和未结束的安全运行状态");
  }
  const seat =
    participants.find(
      (row) => row.role === "player" && row.actorKey === actorKey,
    ) ?? fail("角色没有显式玩家席位");
  if (seat.controller !== "ai" && seat.controller !== "hybrid")
    fail("该角色不是 AI 或混合控制席位");
  if (
    seat.assignmentState === "vacant" ||
    seat.assignmentState === "left" ||
    seat.sessionZeroAcceptedAtSequence == null ||
    !seat.consent.safetyBoundariesAccepted ||
    !seat.consent.aiIdentityDisclosed
  ) {
    fail("AI 玩家席位尚未完成认领、安全边界或身份披露");
  }
  if (seat.controller === "hybrid" && !seat.consent.aiAdviceAllowed)
    fail("混合席位没有授权 AI 提供角色建议");
  const projection = createTtrpgViewerProjectionV1({
    state,
    campaign,
    rulePack,
    role: "player",
    actorKey,
    participantControllers: Object.fromEntries(
      participants.flatMap((row) =>
        row.actorKey == null ? [] : [[row.actorKey, row.controller]],
      ),
    ),
  });
  if (!projection.availableActions.length)
    fail("该席位当前没有可提交的闭集行动");
  const { gmControls: _gmControls, scenes, ...safeProjection } = projection;
  return {
    schema: "storyforge.ttrpg-player-runtime-view",
    version: 1,
    session: {
      id: session.id,
      title: session.title,
      projectId: session.projectId,
      worldGroupId: session.worldGroupId ?? null,
      releaseHash: sourceIdentityHash,
      packageHash,
      rulePackContentHash: runtimePackage.ttrpg.rulePack.contentHash,
      campaignKey: campaign.campaignKey,
      eventSequence: state.lastSequence,
    },
    seat: {
      seatKey: seat.seatKey,
      actorKey,
      viewerKey: seat.viewerKey,
      controller: seat.controller,
      activation: seat.activation,
      agency: seat.aiProfile?.agency ?? "balanced",
      riskTolerance: seat.aiProfile?.riskTolerance ?? "balanced",
      requiresHumanConfirmation: seat.controller === "hybrid",
    },
    projection: {
      ...safeProjection,
      scenes: scenes.map(
        ({ failureForward: _failureForward, gmSecret: _gmSecret, ...scene }) =>
          scene,
      ),
    },
  };
}

export async function readTtrpgPlayerRuntimeContextV1(
  input: AssembleContextInput,
): Promise<string> {
  if (input.productRuntimeSessionId == null || !input.ttrpgPlayerActorKey?.trim())
    return "";
  const scope =
    input.scope ?? (await resolveScope({ projectId: input.projectId }));
  const view = await loadTtrpgPlayerRuntimeViewV1({
    scope,
    productRuntimeSessionId: input.productRuntimeSessionId,
    actorKey: input.ttrpgPlayerActorKey,
  });
  if (
    input.worldGroupId !== undefined &&
    view.session.worldGroupId !== (input.worldGroupId ?? null)
  )
    return "";
  return JSON.stringify(view);
}
