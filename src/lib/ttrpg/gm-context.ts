import { verifyGameReleaseManifestV2 } from "../game-production/runtime-package";
import { verifyPlayableGamePackageSource } from "../game-production/preview-source";
import { db } from "../db/schema";
import type { AssembleContextInput } from "../registry/types";
import type {
  GameRuntimePackageV2,
  SimulationTtrpgRuleActionResultV1,
  WorkspaceScope,
} from "../types";
import { assertInstanceBinding } from "../world-engine/instances";
import { resolveScope } from "../world-engine/scope";
import { assertGameReleaseUnchanged } from "../text-game/releases";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import { parseRulePackV1 } from "./rule-pack";
import { readTtrpgSessionParticipantsV2 } from "./participants";
import {
  createTtrpgViewerProjectionV1,
  type TtrpgViewerProjectionV1,
} from "./viewer-projection";

export interface TtrpgGmRuntimeViewV1 {
  schema: "storyforge.ttrpg-gm-runtime-view";
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
  safety: {
    completed: boolean;
    status: "active" | "paused";
    reason: string | null;
    premise: string;
    contentWarnings: string[];
    lines: string[];
    veils: string[];
    pauseSignal: string;
    openDoor: boolean;
    selectedCharacterKeys: string[];
  };
  scene: null | {
    sceneKey: string;
    title: string;
    description: string;
    locationKey: string | null;
    participantKeys: string[];
    failureForward: string;
    gmSecret: string;
    sourceRefs: string[];
  };
  activeTurn: null | {
    actorKey: string;
    actorName: string;
    role: "npc";
    gmController: "human" | "ai" | "hybrid";
    availableActions: TtrpgViewerProjectionV1["availableActions"];
    visibleTargets: Array<{
      actorKey: string;
      name: string;
      role: "player" | "npc";
    }>;
  };
  latestAction: SimulationTtrpgRuleActionResultV1 | null;
  participants: Array<{
    entityKey: string;
    name: string;
    kind: string;
    controller?: "human" | "ai" | "hybrid" | "vacant" | "gm";
    attributes: Record<string, string | number | boolean | null>;
    conditions: Array<{
      conditionKey: string;
      stacks: number;
      duration: number | null;
    }>;
    privateProfile?: null | {
      kind: "player" | "npc";
      privateGoal?: string;
      secret: string;
      portrayal: string;
      objective?: string;
      leverage?: string;
      escalation?: string;
    };
  }>;
  discoveredClues: Array<{
    clueKey: string;
    title: string;
    description: string;
    visibility: "private" | "party";
    actorKey: string;
    eventSequence: number;
  }>;
  suggestibleClues: Array<{
    clueKey: string;
    title: string;
    discoveryActions: string[];
    sourceVisibility: "discoverable" | "public";
  }>;
  forbiddenSecretPhrases: string[];
  nextScenes: Array<{
    sceneKey: string;
    title: string;
    description: string;
    sourceRefs: string[];
  }>;
  campaignProgress: {
    summary: string;
    quests: Array<{
      questKey: string;
      title: string;
      objective: string;
      status: "active" | "completed";
      requiredConclusionKeys: string[];
      failureForward: string;
    }>;
    endingKey: string | null;
    advancement: {
      currencyKey: string;
      currencyName: string;
      totalAwarded: number;
      awardedMilestoneKeys: string[];
    };
  };
  memory: {
    openedScenes: Array<{ sceneKey: string; title: string }>;
    recentActions: Array<{
      eventSequence: number;
      actorKey: string;
      targetKey: string | null;
      actionKey: string;
      actionName: string;
      outcome: SimulationTtrpgRuleActionResultV1["outcome"];
      resourceChanges: Array<{
        entityKey: string;
        resourceKey: string;
        delta: number;
        after: number;
      }>;
      conditionChanges: Array<{
        entityKey: string;
        conditionKey: string;
        stacks: number;
        duration: number | null;
      }>;
    }>;
    knownConclusionKeys: string[];
    unresolvedRequiredClueKeys: string[];
  };
  recentNarrations: Array<{ eventSequence: number; text: string }>;
}

function fail(message: string): never {
  throw new Error(`[ttrpg-gm-context] ${message}`);
}

/**
 * Load the exact, bounded GM-only view used by the trustworthy AI-GM Harness.
 * It intentionally omits unrelated scenes, mutable authoring tables and every
 * capability that could perform rule or clue mutations.
 */
export async function loadTtrpgGmRuntimeViewV1(input: {
  scope: WorkspaceScope;
  simulationSessionId: number;
}): Promise<TtrpgGmRuntimeViewV1> {
  const session = await assertInstanceBinding(
    input.simulationSessionId,
    input.scope,
  );
  const sourceCount = [
    session.gameReleaseId,
    session.gameBuildId,
  ].filter((value) => value != null).length;
  if (
    session.kind !== "ttrpg" ||
    !session.runtimeSourceHash ||
    sourceCount !== 1
  ) {
    fail("只能读取绑定唯一已验证 Release 或 Build Preview 的 TTRPG 实例");
  }
  let runtimePackage: GameRuntimePackageV2;
  let packageHash: string;
  let sourceIdentityHash: string;
  if (session.gameReleaseId != null) {
    const release = await assertGameReleaseUnchanged(session.gameReleaseId);
    const manifest = await verifyGameReleaseManifestV2(release.manifestJson);
    runtimePackage = manifest.runtimePackage;
    packageHash = manifest.packageHash;
    sourceIdentityHash = release.contentHash;
  } else if (session.gameBuildId != null) {
    const build = await db.gameBuilds.get(session.gameBuildId!);
    if (!build?.previewHash) fail("Build Preview 缺少冻结 previewHash");
    const playable = await verifyPlayableGamePackageSource({
      scope: input.scope,
      source: {
        kind: "build",
        gameBuildId: session.gameBuildId!,
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
    fail("实例与冻结 TTRPG RuntimePackage 不一致");
  }
  const rulePack = parseRulePackV1(runtimePackage.ttrpg.rulePack.content);
  const campaign = parseTtrpgCampaignContentV1(
    runtimePackage.ttrpg.campaign,
    rulePack,
  );
  const { readSimulationState } = await import("../simulation/runtime");
  const state = await readSimulationState(session.id!);
  const product = state.ttrpg?.product;
  if (
    !product ||
    product.rulePackContentHash !== runtimePackage.ttrpg.rulePack.contentHash ||
    product.campaignKey !== campaign.campaignKey
  ) {
    fail("运行时投影没有严格绑定冻结 RulePack/CampaignPack");
  }
  const currentScene =
    campaign.scenes.find(
      (item) => item.sceneKey === state.ttrpg?.scene?.sceneKey,
    ) ?? null;
  const discoveredByKey = new Map(
    product.discoveredClues.map((item) => [item.clueKey, item]),
  );
  const discoveredClues = product.discoveredClues.map((discovered) => {
    const clue = campaign.clues.find(
      (item) => item.clueKey === discovered.clueKey,
    );
    if (!clue) fail(`已发现线索不在冻结 CampaignPack:${discovered.clueKey}`);
    return {
      clueKey: clue.clueKey,
      title: clue.title,
      description: clue.description,
      visibility: discovered.visibility,
      actorKey: discovered.actorKey,
      eventSequence: discovered.eventSequence,
    };
  });
  const currentClues = currentScene
    ? currentScene.clueKeys.map(
        (key) =>
          campaign.clues.find((item) => item.clueKey === key) ??
          fail(`场景线索缺失:${key}`),
      )
    : [];
  const suggestibleClues = currentClues
    .filter(
      (clue) =>
        clue.visibility !== "gm-only" && !discoveredByKey.has(clue.clueKey),
    )
    .map((clue) => ({
      clueKey: clue.clueKey,
      title: clue.title,
      discoveryActions: [
        ...new Set(
          clue.discoveryPaths
            .filter((path) => path.sceneKey === currentScene?.sceneKey)
            .map((path) => path.actionKey),
        ),
      ],
      sourceVisibility: clue.visibility as "discoverable" | "public",
    }));
  const forbiddenSecretPhrases = [
    ...new Set(
      [
        ...(currentScene?.gmSecret ? [currentScene.gmSecret] : []),
        ...currentClues
          .filter((clue) => !discoveredByKey.has(clue.clueKey))
          .flatMap((clue) => [
            clue.title,
            clue.description,
            clue.conclusionKey,
          ]),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length >= 2),
    ),
  ];
  const participantKeys = currentScene
    ? [...(state.ttrpg?.turnOrder ?? [])]
    : [];
  const participantAuthority = await readTtrpgSessionParticipantsV2(
    session.id!,
  );
  const controllerByActor = new Map(
    participantAuthority.flatMap((row) =>
      row.actorKey == null ? [] : [[row.actorKey, row.controller] as const],
    ),
  );
  const participants = participantKeys.map((entityKey) => {
    const entity = state.entities[entityKey];
    if (!entity) fail(`当前场景参与者缺失:${entityKey}`);
    const template =
      campaign.characterTemplates.find(
        (item) => item.characterKey === entityKey,
      ) ?? fail(`当前场景参与者没有 CampaignPack 角色卡:${entityKey}`);
    return {
      entityKey,
      name: entity.name,
      kind: entity.kind,
      controller:
        controllerByActor.get(entityKey) ??
        (template.controller === "open"
          ? "vacant"
          : (template.controller ??
            (template.role === "npc" ? "gm" : "human"))),
      attributes: Object.fromEntries(
        Object.entries(entity.attributes).slice(0, 80),
      ),
      conditions: product.conditions[entityKey] ?? [],
      privateProfile:
        template.role === "player" && template.playerProfile
          ? {
              kind: "player" as const,
              ...structuredClone(template.playerProfile),
            }
          : template.role === "npc" && template.gmProfile
            ? { kind: "npc" as const, ...structuredClone(template.gmProfile) }
            : null,
    };
  });
  const nextScenes = (currentScene?.nextSceneKeys ?? []).map((sceneKey) => {
    const scene =
      campaign.scenes.find((item) => item.sceneKey === sceneKey) ??
      fail(`后继场景缺失:${sceneKey}`);
    return {
      sceneKey: scene.sceneKey,
      title: scene.title,
      description: scene.description,
      sourceRefs: scene.sourceRefs,
    };
  });
  const gmSeat =
    participantAuthority.find((row) => row.role === "gm") ??
    fail("正式 TTRPG 实例缺少 GM 席位权威");
  if (!["human", "ai", "hybrid"].includes(gmSeat.controller))
    fail("GM 席位控制方式无效");
  const activeActorKey = state.ttrpg?.activeActorKey ?? null;
  const activeTemplate =
    activeActorKey == null
      ? null
      : (campaign.characterTemplates.find(
          (item) => item.characterKey === activeActorKey,
        ) ?? null);
  const gmProjection = createTtrpgViewerProjectionV1({
    state,
    campaign,
    rulePack,
    role: "gm",
    actorKey: activeActorKey,
    participantControllers: Object.fromEntries(controllerByActor),
  });
  const activeTurn =
    currentScene && activeActorKey && activeTemplate?.role === "npc"
      ? {
          actorKey: activeActorKey,
          actorName:
            state.entities[activeActorKey]?.name ?? activeTemplate.name,
          role: "npc" as const,
          gmController: gmSeat.controller as "human" | "ai" | "hybrid",
          availableActions: structuredClone(gmProjection.availableActions),
          visibleTargets: gmProjection.actors.map((actor) => ({
            actorKey: actor.actorKey,
            name: actor.name,
            role: actor.role,
          })),
        }
      : null;
  return {
    schema: "storyforge.ttrpg-gm-runtime-view",
    version: 1,
    session: {
      id: session.id!,
      title: session.title,
      projectId: session.projectId,
      worldGroupId: session.worldGroupId ?? null,
      releaseHash: sourceIdentityHash,
      packageHash,
      rulePackContentHash: runtimePackage.ttrpg.rulePack.contentHash,
      campaignKey: campaign.campaignKey,
      eventSequence: state.lastSequence,
    },
    safety: {
      completed: product.sessionZero.completed,
      status: product.safety.status,
      reason: product.safety.reason,
      premise: campaign.sessionZero.premise,
      contentWarnings: campaign.contentWarnings,
      lines: campaign.sessionZero.lines,
      veils: campaign.sessionZero.veils,
      pauseSignal: campaign.sessionZero.pauseSignal,
      openDoor: campaign.sessionZero.openDoor,
      selectedCharacterKeys: product.sessionZero.selectedCharacterKeys,
    },
    scene: currentScene
      ? {
          sceneKey: currentScene.sceneKey,
          title: currentScene.title,
          description: currentScene.description,
          locationKey: currentScene.locationKey,
          participantKeys,
          failureForward: currentScene.failureForward,
          gmSecret: currentScene.gmSecret,
          sourceRefs: currentScene.sourceRefs,
        }
      : null,
    activeTurn,
    latestAction:
      product.actionHistory[product.actionHistory.length - 1] ?? null,
    participants,
    discoveredClues,
    suggestibleClues,
    forbiddenSecretPhrases,
    nextScenes,
    campaignProgress: {
      summary: state.ttrpg?.campaign?.summary ?? campaign.pitch,
      quests: campaign.quests.map((quest) => ({
        questKey: quest.questKey,
        title: quest.title,
        objective: quest.objective,
        status:
          product.questProgress.find((item) => item.questKey === quest.questKey)
            ?.status ?? "active",
        requiredConclusionKeys: quest.requiredConclusionKeys,
        failureForward: quest.failureForward,
      })),
      endingKey: product.ending?.endingKey ?? null,
      advancement: {
        currencyKey: product.advancement.currencyKey,
        currencyName: product.advancement.currencyName,
        totalAwarded: product.advancement.totalAwarded,
        awardedMilestoneKeys: product.advancement.awardedMilestoneKeys,
      },
    },
    memory: {
      openedScenes: product.openedSceneKeys.map((sceneKey) => {
        const scene =
          campaign.scenes.find((item) => item.sceneKey === sceneKey) ??
          fail(`已开启场景不在冻结 CampaignPack:${sceneKey}`);
        return { sceneKey, title: scene.title };
      }),
      recentActions: product.actionHistory.slice(-12).map((action) => ({
        eventSequence: action.eventSequence,
        actorKey: action.actorKey,
        targetKey: action.targetKey,
        actionKey: action.actionKey,
        actionName: action.actionName,
        outcome: action.outcome,
        resourceChanges: action.resourceChanges.map((change) => ({
          entityKey: change.entityKey,
          resourceKey: change.resourceKey,
          delta: change.delta,
          after: change.after,
        })),
        conditionChanges: action.conditionChanges.map((change) => ({
          entityKey: change.entityKey,
          conditionKey: change.conditionKey,
          stacks: change.stacks,
          duration: change.duration,
        })),
      })),
      knownConclusionKeys: [
        ...new Set(
          product.discoveredClues.map(
            (discovered) =>
              product.clueCatalog.find(
                (clue) => clue.clueKey === discovered.clueKey,
              )?.conclusionKey ??
              fail(`已发现线索缺少结论索引:${discovered.clueKey}`),
          ),
        ),
      ],
      unresolvedRequiredClueKeys: product.clueCatalog
        .filter((clue) => clue.required && !discoveredByKey.has(clue.clueKey))
        .map((clue) => clue.clueKey),
    },
    recentNarrations: state.narratives.slice(-12),
  };
}

export async function readTtrpgGmRuntimeContextV1(
  input: AssembleContextInput,
): Promise<string> {
  if (input.simulationSessionId == null) return "";
  const scope =
    input.scope ?? (await resolveScope({ projectId: input.projectId }));
  const view = await loadTtrpgGmRuntimeViewV1({
    scope,
    simulationSessionId: input.simulationSessionId,
  });
  if (
    input.worldGroupId !== undefined &&
    view.session.worldGroupId !== (input.worldGroupId ?? null)
  )
    return "";
  return JSON.stringify(view);
}
