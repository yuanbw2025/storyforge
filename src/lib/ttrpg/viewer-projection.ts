import type {
  RulePackV1,
  ProductRuntimeState,
  TtrpgCharacterSheetV2,
  TtrpgCampaignContentV1,
  TtrpgTabletopMapV1,
} from "../types";
import { resolveTtrpgCharacterControllerV2 } from "./action-feedback";
import { createCompleteTtrpgCharacterSheetV2 } from "./character-sheet";
import {
  availableTtrpgCharacterCurrencyV2,
  earnedTtrpgCharacterCurrencyV2,
} from "./advancement";
import { ruleCheckDefaultDifficultyV2 } from "./rule-pack";
import { evaluateTtrpgActionRequirementsV2 } from "./action-requirement";

export type TtrpgViewerRoleV1 = "player" | "gm" | "spectator";

export interface TtrpgVisibleCharacterSheetV2 {
  identity: TtrpgCharacterSheetV2["identity"];
  rules: TtrpgCharacterSheetV2["rules"];
  authoring: TtrpgCharacterSheetV2["authoring"];
  gates: TtrpgCharacterSheetV2["gates"];
  privateFieldsVisible: boolean;
}

export interface TtrpgViewerProjectionV1 {
  schema: "storyforge.ttrpg-viewer-projection";
  version: 1;
  role: TtrpgViewerRoleV1;
  actorKey: string | null;
  /** Public Session Zero disclosure used to render the correct GM control path. */
  gmController?: "human" | "ai" | "hybrid";
  eventSequence: number;
  safety: {
    status: "active" | "paused";
    reason: string | null;
  };
  turn: {
    round: number;
    activeActorKey: string | null;
    actorKeys: string[];
    budget: null | {
      actionsRemaining: number;
      reactionsRemaining: number;
      freeActionsRemaining: number;
    };
    initiative: Array<{
      actorKey: string;
      total: number;
      dice: number[];
      modifier: number;
    }>;
  };
  actors: Array<{
    actorKey: string;
    name: string;
    role: "player" | "npc";
    controller: "human" | "ai" | "hybrid" | "vacant" | "gm";
    controlledByViewer: boolean;
    characterSheet: TtrpgVisibleCharacterSheetV2;
    privateProfile: null | {
      kind: "player" | "npc";
      privateGoal?: string;
      secret: string;
      portrayal: string;
      objective?: string;
      leverage?: string;
      escalation?: string;
    };
    attributes: Array<{ key: string; name: string; value: number }>;
    resources: Array<{
      key: string;
      name: string;
      current: number;
      maximum: number;
    }>;
    conditions: Array<{
      key: string;
      name: string;
      stacks: number;
      duration: number | null;
    }>;
  }>;
  inventory: Array<{
    itemInstanceId: string;
    definitionRef: string;
    title: string;
    ownerRef: string | null;
    quantity: number;
    charges: number | null;
    durability: number | null;
    equippedSlots: string[];
    attunedToActorRef: string | null;
    allowedEquipSlots: string[];
    requiresAttunement: boolean;
    maximumDurability: number | null;
    canUse: boolean;
    identification: "unknown" | "partly-known" | "identified";
    stateTags: string[];
  }>;
  scenes: Array<{
    sceneKey: string | null;
    status: "current" | "opened" | "locked";
    title: string | null;
    description: string | null;
    locationKey: string | null;
    failureForward: string | null;
    gmSecret: string | null;
  }>;
  visibleClues: Array<{
    clueKey: string;
    title: string;
    description: string;
    conclusionKey: string;
    visibility: "private" | "party";
    actorKey: string;
  }>;
  visibleHandoutKeys: string[];
  visibleHandouts: Array<{
    handoutKey: string;
    title: string;
    body: string;
    assetKey: string | null;
  }>;
  visibleConclusionKeys: string[];
  availableActions: Array<{
    actionKey: string;
    name: string;
    description: string;
    phase: "free" | "action" | "reaction" | "downtime";
    target: "self" | "single-ally" | "single-enemy" | "scene";
    costResourceKey: string | null;
    costResourceName: string | null;
    costAmount: number;
    defaultDifficulty: number | null;
  }>;
  recentActions: Array<{
    eventSequence: number;
    actionKey: string;
    actionName: string;
    actorKey: string;
    targetKey: string | null;
    outcome:
      | "hidden"
      | "automatic"
      | "critical-failure"
      | "failure"
      | "partial-success"
      | "success"
      | "hard-success"
      | "extreme-success"
      | "critical-success";
    dice: number[];
    modifier: number | null;
    total: number | null;
    difficulty: number | null;
    resourceChanges: Array<{
      entityKey: string;
      resourceKey: string;
      before: number;
      after: number;
    }>;
    conditionChanges: Array<{
      entityKey: string;
      conditionKey: string;
      stacks: number;
      duration: number | null;
    }>;
    receipt: null | {
      receiptKey: string;
      terminalStatus: "resolved" | "resolved-no-roll" | "resolved-check";
      declaredIntent: null | {
        intentKey: string;
        rawInput: string;
        goal: string | null;
        method: string | null;
      };
      criticality: "routine" | "meaningful" | "critical";
      mechanicalSummary: string;
      actorConsequence: string;
      sceneConsequence: string;
      worldConsequence: string;
      failForwardAvailable: boolean;
      observers: Array<{
        actorKey: string;
        relation: "actor" | "target" | "direct-effect" | "scene-witness";
        relevance: "primary" | "relevant" | "ambient";
        responsePolicy:
          | "actor-owned"
          | "prompt-human"
          | "ai-eligible"
          | "gm-eligible"
          | "observe-only";
      }>;
      reactionWindows: Array<{
        layer:
          | "mechanical-reaction"
          | "immediate-character"
          | "scene-consequence"
          | "campaign-consequence";
        status: "open" | "advisory" | "closed";
        eligibleActorKeys: string[];
        humanConfirmationRequiredActorKeys: string[];
      }>;
      suggestedNextActionKeys: string[];
    };
  }>;
  recentIntentReceipts: Array<{
    receiptKey: string;
    eventSequence: number;
    intentKey: string;
    actorKey: string;
    rawInput: string;
    proposedActionKey: string | null;
    targetKey: string | null;
    terminalStatus:
      | "needs-clarification"
      | "rejected-illegal"
      | "interrupted"
      | "queued/deferred"
      | "cancelled";
    reason: string;
    suggestedActionKeys: string[];
  }>;
  humanResponses: Array<{
    responseKey: string;
    eventSequence: number;
    actionSequence: number;
    actorKey: string;
    kind: "speak" | "act-narratively" | "decline";
    text: string;
    audience: "party" | "gm-only";
  }>;
  pendingHumanResponses: Array<{
    actionSequence: number;
    actionReceiptKey: string;
    sourceActorKey: string;
    actorKey: string;
  }>;
  recentRests: Array<{
    eventSequence: number;
    restKey: string;
    kind: "short-rest" | "long-rest";
    actorKeys: string[];
    completedBy: string;
    reason: string;
    resetAbilityKeys: string[];
  }>;
  recentNarrations: Array<{
    eventSequence: number;
    actionSequence: number;
    text: string;
    source: "human-gm" | "ai-confirmed" | "deterministic-fallback";
    audit: null | {
      runId: number | null;
      candidateHash: string | null;
      repairApplied: boolean;
    };
    synthesisFrame: null | {
      mechanicalOutcome: string;
      actorFeedback: string;
      reactions: Array<{
        actorKey: string;
        responsePolicy: string;
        text: string | null;
      }>;
      sceneUpdate: string;
      worldUpdate: string;
      nextPrompts: string[];
    };
  }>;
  effectReceipts: Array<{
    eventSequence: number;
    planKey: string;
    degree: string;
    sourceEventId: string;
    ruleRef: string;
    reason: string;
    audience: string;
    transitions: Array<{
      effectKey: string;
      family: string;
      operation: string;
      targetRef: string;
    }>;
  }>;
  pendingEffectChoices: Array<{
    choiceKey: string;
    proposedEventSequence: number;
    actionSequence: number;
    ownerActorKey: string;
    degree: string;
    reason: string;
    options: Array<{
      effectKey: string;
      family: string;
      operation: string;
      targetRef: string;
      detail: string;
    }>;
  }>;
  quests: Array<{
    questKey: string;
    title: string;
    objective: string;
    status: "active" | "completed";
    conclusions: Array<{
      conclusionKey: string;
      title: string | null;
      discovered: boolean;
    }>;
  }>;
  clocks: Array<{
    clockKey: string;
    title: string;
    current: number;
    maximum: number;
    visibility: "gm-only" | "party" | "public";
    completed: boolean;
    onComplete: string | null;
  }>;
  ruleReference: Array<{
    key: string;
    title: string;
    category: string;
    body: string;
  }>;
  gmControls: null | {
    openableScenes: Array<{ sceneKey: string; title: string }>;
    currentClues: Array<{
      clueKey: string;
      title: string;
      description: string;
      visibility: "gm-only" | "discoverable" | "public";
      discoveryVisibility: "private" | "party" | null;
    }>;
    endings: Array<{ endingKey: string; title: string; enabled: boolean }>;
    itemDefinitions: Array<{
      itemKey: string;
      title: string;
      maximumStack: number;
    }>;
  };
  tabletop: null | {
    mapKey: string;
    title: string;
    width: number;
    height: number;
    backgroundAssetKey: string | null;
    fallbackDescription: string;
    grid: TtrpgTabletopMapV1["grid"];
    layers: Array<{
      layerKey: string;
      title: string;
      kind: "terrain" | "objects" | "annotation";
      zIndex: number;
      opacity: number;
      gmOnly: boolean;
      visible: boolean;
    }>;
    areas: Array<{
      areaKey: string;
      title: string | null;
      x: number;
      y: number;
      width: number;
      height: number;
      gmOnly: boolean;
    }>;
    tokens: Array<{
      tokenKey: string;
      entityKey: string;
      x: number;
      y: number;
      size: number;
      controllerKey: string | null;
      hidden: boolean;
    }>;
    fog: Array<{
      fogKey: string;
      title: string | null;
      x: number;
      y: number;
      width: number;
      height: number;
      revealed: boolean;
    }>;
  };
  media: null | {
    generatedCount: number;
    maximumGeneratedAssets: number;
    slots: Array<{
      slotKey: string;
      kind: import("../types").TtrpgRuntimeMediaKindV1;
      targetRef: string;
      fallbackText: string;
      altText: string;
      status: "placeholder" | "queued" | "available" | "failed" | "cancelled";
      requestKey: string | null;
      assetKey: string | null;
      mediaAssetId: number | null;
      mediaContentHash: string | null;
      lastErrorCode: string | null;
    }>;
  };
  continuity: {
    activeSessionKey: string | null;
    playSessions: Array<{
      sessionKey: string;
      ordinal: number;
      title: string;
      status: "active" | "completed" | "cancelled";
      participantKeys: string[];
      summary: string;
    }>;
    roster: Array<{
      characterKey: string;
      status: "active" | "reserve" | "retired";
      joinedSessionKey: string | null;
      leftSessionKey: string | null;
      replacementFor: string | null;
    }>;
    memories: Array<{
      memoryKey: string;
      subjectKey: string;
      summary: string;
      audience: "party" | "gm-only" | `actor:${string}`;
      sourceSessionKey: string;
    }>;
    supplements: Array<{
      supplementKey: string;
      title: string;
      compatibility: "same-release" | "next-release";
      activatedSessionKey: string | null;
    }>;
    worldEvolution: Array<{
      candidateKey: string;
      category:
        "character" | "location" | "faction" | "artifact" | "event" | "lore";
      summary: string;
      sourceSessionKey: string;
      status: "proposed" | "approved-for-world-review" | "rejected";
      targetWorldRef: string | null;
    }>;
    versionTransitions: Array<{
      transitionKey: string;
      compatibility:
        "same-content" | "compatible" | "manual-migration" | "breaking";
      status: "planned" | "activated" | "rejected";
      toCampaignKey: string;
      notes: string | null;
    }>;
  };
  recap: {
    schema: "storyforge.ttrpg-session-fact-recap";
    version: 2;
    scope: {
      sessionKey: string | null;
      title: string;
      status: "active" | "completed" | "cancelled" | "whole-instance";
      fromSequence: number;
      toSequence: number;
    };
    viewerKind: "gm-complete" | "character-private" | "spectator-public";
    openedSceneTitles: string[];
    visibleClueTitles: string[];
    discoveredThisSessionTitles: string[];
    unresolvedRequiredClues: { visibleTitles: string[]; hiddenCount: number };
    resolvedActionCount: number;
    intentDispositionCount: number;
    resourceChanges: Array<{
      eventSequence: number;
      actorKey: string;
      actorName: string;
      resourceKey: string;
      resourceName: string;
      before: number;
      after: number;
      delta: number;
    }>;
    abilityChanges: Array<{
      eventSequence: number;
      actorKey: string;
      actorName: string;
      abilityKey: string;
      abilityName: string;
      reason: "action" | "short-rest" | "long-rest";
      usesBefore: number | null;
      usesAfter: number | null;
      cooldownBefore: number | null;
      cooldownAfter: number | null;
    }>;
    itemChanges: Array<{
      eventSequence: number;
      operation: string;
      itemInstanceId: string;
      definitionRef: string;
      title: string;
      ownerBefore: string | null;
      ownerAfter: string | null;
      quantityBefore: number | null;
      quantityAfter: number | null;
      chargesBefore: number | null;
      chargesAfter: number | null;
      durabilityBefore: number | null;
      durabilityAfter: number | null;
      source: "direct-command" | "effect-plan";
    }>;
    conditionChanges: Array<{
      eventSequence: number;
      actorKey: string;
      actorName: string;
      conditionKey: string;
      conditionName: string;
      stacks: number;
      duration: number | null;
    }>;
    ledgerChanges: Array<{
      eventSequence: number;
      family: string;
      operation: string;
      targetRef: string;
      before: string;
      after: string;
      reason: string;
    }>;
    outstanding: {
      exhaustedAbilityNames: string[];
      activeConditionNames: string[];
      activeQuestTitles: string[];
      incompleteClockTitles: string[];
    };
    ending: null | { title: string; epilogue: string };
    advancementAwarded: number;
    nextPreparation: string;
  };
}

/** Converts the already viewer-safe factual projection into durable, bounded recap prose. */
export function summarizeTtrpgSessionFactRecapV2(
  recap: TtrpgViewerProjectionV1["recap"],
): string {
  const resource = recap.resourceChanges.slice(-12).map(change => (
    `${change.actorName}${change.resourceName}${change.delta >= 0 ? "+" : ""}${change.delta}`
  ));
  const abilities = recap.abilityChanges.slice(-12).map(change => (
    `${change.actorName}${change.abilityName}:${change.usesBefore ?? "∞"}→${change.usesAfter ?? "∞"}`
  ));
  const items = recap.itemChanges.slice(-12).map(change => `${change.title}:${change.operation}`);
  const ledgers = recap.ledgerChanges
    .filter(change => !["item", "ability", "numeric", "condition"].includes(change.family))
    .slice(-12)
    .map(change => `${change.family}/${change.operation}:${change.targetRef}`);
  const outstanding = [
    ...recap.outstanding.exhaustedAbilityNames.map(name => `恢复${name}`),
    ...recap.outstanding.activeConditionNames,
    ...recap.outstanding.activeQuestTitles.map(name => `任务:${name}`),
    ...recap.outstanding.incompleteClockTitles.map(name => `Clock:${name}`),
  ];
  const lines = [
    `${recap.scope.title}（事件 ${recap.scope.fromSequence}–${recap.scope.toSequence}）`,
    `已历场景：${recap.openedSceneTitles.join("、") || "无"}。`,
    `本场行动 ${recap.resolvedActionCount} 次，未进入规则结算的意图 ${recap.intentDispositionCount} 次。`,
    `本场新发现：${recap.discoveredThisSessionTitles.join("、") || "无"}。`,
    `未解必需线索：${recap.unresolvedRequiredClues.visibleTitles.join("、") || `${recap.unresolvedRequiredClues.hiddenCount} 条未公开`}。`,
    resource.length ? `资源变化：${resource.join("；")}。` : "",
    abilities.length ? `能力次数：${abilities.join("；")}。` : "",
    items.length ? `物品变化：${items.join("；")}。` : "",
    ledgers.length ? `奖惩与剧情：${ledgers.join("；")}。` : "",
    outstanding.length ? `待处理：${outstanding.join("；")}。` : "待处理：无。",
    recap.nextPreparation,
  ].filter(Boolean);
  return lines.join("\n").slice(0, 10_000);
}

export function createTtrpgAutomaticSessionRecapsV2(input: {
  state: ProductRuntimeState;
  campaign: TtrpgCampaignContentV1;
  rulePack: RulePackV1;
  sessionKey: string;
  participantKeys: string[];
}): {
  publicSummary: string;
  gmSummary: string;
  memories: Array<{
    memoryKey: string;
    subjectKey: string;
    summary: string;
    audience: "party" | "gm-only" | `actor:${string}`;
  }>;
} {
  const product = input.state.ttrpg?.product ?? fail("自动会后回顾缺少正式 TTRPG 产品状态");
  const publicSummary = summarizeTtrpgSessionFactRecapV2(createTtrpgViewerProjectionV1({
    state: input.state, campaign: input.campaign, rulePack: input.rulePack,
    role: "spectator", actorKey: null,
  }).recap);
  const gmSummary = summarizeTtrpgSessionFactRecapV2(createTtrpgViewerProjectionV1({
    state: input.state, campaign: input.campaign, rulePack: input.rulePack,
    role: "gm", actorKey: null,
  }).recap);
  return {
    publicSummary,
    gmSummary,
    memories: [
      {
        memoryKey: `memory.${input.sessionKey}.auto.party`,
        subjectKey: product.campaignKey,
        summary: publicSummary,
        audience: "party",
      },
      {
        memoryKey: `memory.${input.sessionKey}.auto.gm`,
        subjectKey: product.campaignKey,
        summary: gmSummary,
        audience: "gm-only",
      },
      ...input.participantKeys.map(characterKey => ({
        memoryKey: `memory.${input.sessionKey}.auto.actor.${characterKey}`,
        subjectKey: characterKey,
        summary: summarizeTtrpgSessionFactRecapV2(createTtrpgViewerProjectionV1({
          state: input.state, campaign: input.campaign, rulePack: input.rulePack,
          role: "player", actorKey: characterKey,
        }).recap),
        audience: `actor:${characterKey}` as const,
      })),
    ],
  };
}

function fail(message: string): never {
  throw new Error(`[ttrpg-viewer] ${message}`);
}

/**
 * Fail-closed local projection shared by player UI and the future room server.
 * A non-GM projection never contains future scene metadata, GM notes, failure
 * routes, or another character's private clues. Spectators receive party-only
 * knowledge and never inherit a player's private actor view.
 */
export function createTtrpgViewerProjectionV1(input: {
  state: ProductRuntimeState;
  campaign: TtrpgCampaignContentV1;
  rulePack: RulePackV1;
  role: TtrpgViewerRoleV1;
  actorKey?: string | null;
  participantControllers?: Record<string, "human" | "ai" | "hybrid" | "vacant">;
}): TtrpgViewerProjectionV1 {
  const product = input.state.ttrpg?.product;
  if (!product || product.campaignKey !== input.campaign.campaignKey) {
    fail("运行时没有绑定指定 CampaignPack");
  }
  const actorKey =
    input.role === "player" ? input.actorKey?.trim() || null : null;
  if (
    input.role === "player" &&
    (!actorKey || !product.sessionZero.selectedCharacterKeys.includes(actorKey))
  ) {
    fail("玩家投影必须绑定本局已选择的角色");
  }
  const currentSceneKey = input.state.ttrpg?.scene?.sceneKey ?? null;
  const opened = new Set(product.openedSceneKeys);
  const scenes = input.campaign.scenes.map((scene) => {
    const status =
      scene.sceneKey === currentSceneKey
        ? "current"
        : opened.has(scene.sceneKey)
          ? "opened"
          : "locked";
    if (input.role !== "gm" && status === "locked") {
      return {
        sceneKey: null,
        status,
        title: null,
        description: null,
        locationKey: null,
        failureForward: null,
        gmSecret: null,
      } as const;
    }
    return {
      sceneKey: scene.sceneKey,
      status,
      title: scene.title,
      description: scene.description,
      locationKey: scene.locationKey,
      failureForward: input.role === "gm" ? scene.failureForward : null,
      gmSecret: input.role === "gm" ? scene.gmSecret : null,
    } as const;
  });
  const visibleDiscoveries = product.discoveredClues.filter(
    (item) =>
      input.role === "gm" ||
      item.visibility === "party" ||
      (input.role === "player" && item.actorKey === actorKey),
  );
  const visibleClues = visibleDiscoveries.map((discovery) => {
    const clue = input.campaign.clues.find(
      (item) => item.clueKey === discovery.clueKey,
    );
    if (!clue) fail(`运行时线索不属于 CampaignPack:${discovery.clueKey}`);
    return {
      clueKey: clue.clueKey,
      title: clue.title,
      description: clue.description,
      conclusionKey: clue.conclusionKey,
      visibility: discovery.visibility,
      actorKey: discovery.actorKey,
    };
  });
  const visibleClueKeys = new Set(visibleClues.map((item) => item.clueKey));
  const visibleConclusionKeys = new Set(
    visibleClues.map((item) => item.conclusionKey),
  );
  const currentScene =
    input.campaign.scenes.find((item) => item.sceneKey === currentSceneKey) ??
    null;
  const actorKeys = input.state.ttrpg?.turnOrder ?? [];
  const actors = actorKeys.map((currentActorKey) => {
    const template = input.campaign.characterTemplates.find(
      (item) => item.characterKey === currentActorKey,
    );
    const entity = input.state.entities[currentActorKey];
    if (!template || !entity)
      fail(`当前回合角色不属于冻结战役:${currentActorKey}`);
    const showAttributes = input.role === "gm" || template.role === "player";
    const customization = product.characterCustomizations.find(
      (item) => item.characterKey === currentActorKey,
    );
    const { characterSheet: _frozenSheet, ...templateWithoutSheet } = template;
    const completeSheet =
      customization?.characterSheet ??
      template.characterSheet ??
      createCompleteTtrpgCharacterSheetV2({
        template: templateWithoutSheet,
        rulePack: input.rulePack,
      });
    const runtimeProgression =
      product.characterProgression?.[currentActorKey] ?? null;
    const runtimeItemKeys =
      product.inventory == null
        ? completeSheet.rules.itemKeys
        : Object.values(product.inventory.items)
            .filter(
              (item) =>
                item.ownerRef === currentActorKey &&
                !item.stateTags.includes("broken"),
            )
            .map((item) => item.definitionRef);
    const privateFieldsVisible =
      input.role === "gm" ||
      (input.role === "player" && actorKey === currentActorKey);
    const visibleSheet: TtrpgVisibleCharacterSheetV2 = {
      identity: {
        ...structuredClone(completeSheet.identity),
        background: privateFieldsVisible
          ? completeSheet.identity.background
          : "仅该角色与主持人可见",
        personalityTraits: privateFieldsVisible
          ? structuredClone(completeSheet.identity.personalityTraits)
          : [],
        beliefs: privateFieldsVisible
          ? structuredClone(completeSheet.identity.beliefs)
          : [],
        flaws: privateFieldsVisible
          ? structuredClone(completeSheet.identity.flaws)
          : [],
        fears: privateFieldsVisible
          ? structuredClone(completeSheet.identity.fears)
          : [],
        desires: privateFieldsVisible
          ? structuredClone(completeSheet.identity.desires)
          : [],
        boundaries: privateFieldsVisible
          ? structuredClone(completeSheet.identity.boundaries)
          : [],
        shortTermGoal: privateFieldsVisible
          ? completeSheet.identity.shortTermGoal
          : "仅该角色与主持人可见",
        longTermGoal: privateFieldsVisible
          ? completeSheet.identity.longTermGoal
          : "仅该角色与主持人可见",
        privateKnowledge: privateFieldsVisible
          ? structuredClone(completeSheet.identity.privateKnowledge)
          : [],
        safetyNotes: privateFieldsVisible
          ? structuredClone(completeSheet.identity.safetyNotes)
          : [],
        portrayal: privateFieldsVisible
          ? completeSheet.identity.portrayal
          : "由该角色操作者控制",
        voice: privateFieldsVisible ? completeSheet.identity.voice : "未公开",
        sampleLines: privateFieldsVisible
          ? structuredClone(completeSheet.identity.sampleLines)
          : [],
        relationships: completeSheet.identity.relationships
          .filter(
            (item) => privateFieldsVisible || item.visibility === "public",
          )
          .map((item) => structuredClone(item)),
        worldBindings: privateFieldsVisible
          ? structuredClone(completeSheet.identity.worldBindings)
          : [],
      },
      rules: {
        ...structuredClone(completeSheet.rules),
        progression: runtimeProgression
          ? {
              model: runtimeProgression.model,
              level: runtimeProgression.level,
              rankKey: runtimeProgression.rankKey,
              experience: earnedTtrpgCharacterCurrencyV2(
                product,
                currentActorKey,
              ),
              unspentPoints: availableTtrpgCharacterCurrencyV2(
                product,
                currentActorKey,
              ),
            }
          : structuredClone(completeSheet.rules.progression),
        attributes: Object.fromEntries(
          input.rulePack.attributes.map((attribute) => [
            attribute.key,
            typeof entity.attributes[attribute.key] === "number"
              ? Number(entity.attributes[attribute.key])
              : completeSheet.rules.attributes[attribute.key],
          ]),
        ),
        skills: Object.fromEntries(
          Object.entries(completeSheet.rules.skills).map(
            ([skillKey, value]) => [
              skillKey,
              value + (runtimeProgression?.skillIncreases[skillKey] ?? 0),
            ],
          ),
        ),
        itemKeys: [...new Set(runtimeItemKeys)].sort(),
        currency: {
          [input.rulePack.advancement.currencyKey]: runtimeProgression
            ? availableTtrpgCharacterCurrencyV2(product, currentActorKey)
            : (completeSheet.rules.currency[
                input.rulePack.advancement.currencyKey
              ] ?? 0),
        },
      },
      authoring: {
        ...structuredClone(completeSheet.authoring),
        rationale: privateFieldsVisible
          ? completeSheet.authoring.rationale
          : "机械权限已经冻结 RulePack 校验。",
        sourceRefs: privateFieldsVisible
          ? structuredClone(completeSheet.authoring.sourceRefs)
          : [],
        lockedFields: privateFieldsVisible
          ? structuredClone(completeSheet.authoring.lockedFields)
          : [],
      },
      gates: structuredClone(completeSheet.gates),
      privateFieldsVisible,
    };
    return {
      actorKey: currentActorKey,
      name: entity.name,
      role: template.role,
      controller: resolveTtrpgCharacterControllerV2(
        template,
        input.participantControllers?.[currentActorKey],
      ),
      controlledByViewer:
        input.role === "gm" ||
        (input.role === "player" && actorKey === currentActorKey),
      characterSheet: visibleSheet,
      privateProfile:
        template.role === "player"
          ? (input.role === "gm" ||
              (input.role === "player" && actorKey === currentActorKey)) &&
            template.playerProfile
            ? {
                kind: "player" as const,
                ...structuredClone(template.playerProfile),
              }
            : null
          : input.role === "gm" && template.gmProfile
            ? { kind: "npc" as const, ...structuredClone(template.gmProfile) }
            : null,
      attributes: showAttributes
        ? input.rulePack.attributes.map((attribute) => ({
            key: attribute.key,
            name: attribute.name,
            value:
              typeof entity.attributes[attribute.key] === "number"
                ? Number(entity.attributes[attribute.key])
                : (template.attributes[attribute.key] ??
                  attribute.defaultValue),
          }))
        : [],
      resources: input.rulePack.resources.flatMap((resource) => {
        const current = entity.attributes[`resource.${resource.key}`];
        const maximum = entity.attributes[`resourceMax.${resource.key}`];
        return typeof current === "number" && typeof maximum === "number"
          ? [{ key: resource.key, name: resource.name, current, maximum }]
          : [];
      }),
      conditions: (product.conditions[currentActorKey] ?? []).map(
        (condition) => ({
          key: condition.conditionKey,
          name:
            input.rulePack.conditions.find(
              (item) => item.key === condition.conditionKey,
            )?.name ?? condition.conditionKey,
          stacks: condition.stacks,
          duration: condition.duration,
        }),
      ),
    };
  });
  const activeActorKey = input.state.ttrpg?.activeActorKey ?? null;
  const actionActorKey =
    input.role === "player"
      ? actorKey
      : input.role === "gm"
        ? activeActorKey
        : null;
  const actionTemplate = input.campaign.characterTemplates.find(
    (item) => item.characterKey === actionActorKey,
  );
  const mayAct =
    !!currentScene && !!actionTemplate && input.role !== "spectator";
  const activeItemKeys =
    product.inventory && actionActorKey
      ? Object.values(product.inventory.items)
          .filter(
            (item) =>
              item.ownerRef === actionActorKey &&
              !item.stateTags.includes("broken"),
          )
          .map((item) => item.definitionRef)
      : (actionTemplate?.itemKeys ?? []);
  const grantedActionKeys = new Set(
    actionTemplate
      ? [
          ...actionTemplate.actionKeys,
          ...activeItemKeys.flatMap(
            (itemKey) =>
              input.rulePack.items.find((item) => item.key === itemKey)
                ?.grantedActionKeys ?? [],
          ),
        ]
      : [],
  );
  const availableActions = mayAct
    ? currentScene.actionKeys.flatMap((actionKey) => {
        const action = input.rulePack.actions.find(
          (item) => item.key === actionKey,
        );
        if (
          !action ||
          !grantedActionKeys.has(action.key) ||
          (actionActorKey !== activeActorKey && action.phase !== "reaction")
        )
          return [];
        const economyBudget =
          actionActorKey == null
            ? null
            : (product.actionEconomy?.budgets[actionActorKey] ?? null);
        const economyAvailable =
          !economyBudget ||
          (action.phase === "reaction"
            ? economyBudget.reactionsRemaining > 0
            : action.phase === "free"
              ? economyBudget.freeActionsRemaining > 0
              : economyBudget.actionsRemaining > 0);
        const ability =
          actionActorKey == null
            ? null
            : (product.abilityStates?.[`${actionActorKey}::${action.key}`] ??
              null);
        const abilityAvailable =
          !ability ||
          (ability.disabledReasons.length === 0 &&
            ability.remainingUses !== 0 &&
            (ability.cooldownUntilRound == null ||
              input.state.ttrpg!.round >= ability.cooldownUntilRound));
        const actorEntity =
          actionActorKey == null ? null : input.state.entities[actionActorKey];
        const costAvailable = (resourceKey: string | null, amount: number) =>
          resourceKey == null ||
          amount <= 0 ||
          Number(actorEntity?.attributes[`resource.${resourceKey}`]) >= amount;
        const requirementsAvailable = evaluateTtrpgActionRequirementsV2({
          action,
          rulePack: input.rulePack,
          actorAttributes: actorEntity?.attributes,
          actorConditions:
            actionActorKey == null
              ? []
              : input.state.ttrpg?.product?.conditions[actionActorKey],
        }).met;
        if (
          !economyAvailable ||
          !abilityAvailable ||
          !requirementsAvailable ||
          !costAvailable(action.costResourceKey, action.costAmount) ||
          !costAvailable(action.usage.resourceKey, action.usage.cost ?? 0)
        )
          return [];
        const checkEffect = action.effects.find(
          (effect) => effect.kind === "check",
        );
        const check =
          checkEffect?.kind === "check"
            ? input.rulePack.checks.find(
                (item) => item.key === checkEffect.checkKey,
              )
            : null;
        const cost =
          action.costResourceKey == null
            ? null
            : (input.rulePack.resources.find(
                (item) => item.key === action.costResourceKey,
              ) ?? null);
        return [
          {
            actionKey: action.key,
            name: action.name,
            description: action.description,
            phase: action.phase,
            target: action.target,
            costResourceKey: action.costResourceKey,
            costResourceName: cost?.name ?? null,
            costAmount: action.costAmount,
            defaultDifficulty:
              check && checkEffect?.kind === "check"
                ? ruleCheckDefaultDifficultyV2(
                    check,
                    Number(actorEntity?.attributes[checkEffect.attributeKey]),
                  )
                : null,
          },
        ];
      })
    : [];
  const visibleHandouts = input.campaign.handouts
    .filter(
      (item) =>
        item.revealClueKey == null || visibleClueKeys.has(item.revealClueKey),
    )
    .map((item) => ({
      handoutKey: item.handoutKey,
      title: item.title,
      body: item.body || item.fallbackText,
      assetKey: item.assetKey,
    }));
  const recentActions = product.actionHistory.slice(-50).map((action) => {
    const hidden = action.check?.visibility === "gm-only" && input.role !== "gm";
    return {
      eventSequence: action.eventSequence,
      actionKey: action.actionKey,
      actionName: action.actionName,
      actorKey: action.actorKey,
      targetKey: action.targetKey,
      outcome: hidden ? ("hidden" as const) : action.outcome,
      dice: hidden ? [] : (action.check?.dice ?? []),
      modifier: hidden ? null : (action.check?.modifier ?? null),
      total: hidden ? null : (action.check?.total ?? null),
      difficulty: hidden ? null : (action.check?.dc ?? null),
      resourceChanges: action.resourceChanges.map((change) => ({
        entityKey: change.entityKey,
        resourceKey: change.resourceKey,
        before: change.before,
        after: change.after,
      })),
      conditionChanges: action.conditionChanges.map((change) => ({
        entityKey: change.entityKey,
        conditionKey: change.conditionKey,
        stacks: change.stacks,
        duration: change.duration,
      })),
      receipt: action.receipt
        ? {
          receiptKey: action.receipt.receiptKey,
          terminalStatus: action.receipt.terminalStatus,
          declaredIntent:
            action.receipt.context.declaredIntent &&
            (input.role === "gm" || input.actorKey === action.actorKey)
              ? structuredClone(action.receipt.context.declaredIntent)
              : null,
          criticality: action.receipt.context.criticality,
          mechanicalSummary: hidden
            ? "暗骰结果仅 KP 可见，等待主持反馈。"
            : action.receipt.mechanicalSummary,
          actorConsequence: hidden ? "等待 KP 描述行动反馈。" : action.receipt.actorConsequence,
          sceneConsequence: hidden ? "等待 KP 确认场景变化。" : action.receipt.sceneConsequence,
          worldConsequence: hidden ? "等待 KP 确认长期影响。" : action.receipt.worldConsequence,
          failForwardAvailable: hidden ? false : action.receipt.failForwardAvailable,
          observers: action.receipt.context.observers.map((observer) => ({
            actorKey: observer.actorKey,
            relation: observer.relation,
            relevance: observer.relevance,
            responsePolicy: observer.responsePolicy,
          })),
          reactionWindows: action.receipt.context.reactionWindows.map(
            (window) => ({
              layer: window.layer,
              status: window.status,
              eligibleActorKeys: [...window.eligibleActorKeys],
              humanConfirmationRequiredActorKeys: [
                ...window.humanConfirmationRequiredActorKeys,
              ],
            }),
          ),
          suggestedNextActionKeys: [...action.receipt.suggestedNextActionKeys],
          }
        : null,
    };
  });
  const recentRests = (product.restHistory ?? []).slice(-50).map((rest) => ({
    eventSequence: rest.eventSequence,
    restKey: rest.restKey,
    kind: rest.kind,
    actorKeys: [...rest.actorKeys],
    completedBy: rest.completedBy,
    reason: rest.reason,
    resetAbilityKeys: rest.abilityChanges.map((change) => change.abilityKey),
  }));
  const recentIntentReceipts = (product.intentReceipts ?? [])
    .filter(
      (receipt) =>
        input.role === "gm" ||
        (input.role === "player" && receipt.actorKey === input.actorKey),
    )
    .slice(-50)
    .map((receipt) => ({
      receiptKey: receipt.receiptKey,
      eventSequence: receipt.eventSequence,
      intentKey: receipt.intentKey,
      actorKey: receipt.actorKey,
      rawInput: receipt.rawInput,
      proposedActionKey: receipt.proposedActionKey,
      targetKey: receipt.targetKey,
      terminalStatus: receipt.terminalStatus,
      reason: receipt.reason,
      suggestedActionKeys: [...receipt.suggestedActionKeys],
    }));
  const humanResponses = (product.humanResponses ?? [])
    .filter(response => (
      input.role === "gm"
      || response.audience === "party"
      || (input.role === "player" && response.actorKey === actorKey)
    ))
    .slice(-100)
    .map(response => ({
      responseKey: response.responseKey,
      eventSequence: response.eventSequence,
      actionSequence: response.actionSequence,
      actorKey: response.actorKey,
      kind: response.kind,
      text: response.text,
      audience: response.audience,
    }));
  const respondedHumanKeys = new Set((product.humanResponses ?? []).map(response => (
    `${response.actionSequence}:${response.actorKey}`
  )));
  const pendingHumanResponses = product.actionHistory.slice(-100).flatMap(action => {
    if (!action.receipt) return [];
    return action.receipt.context.observers.flatMap(observer => {
      if (observer.responsePolicy !== "prompt-human"
        || respondedHumanKeys.has(`${action.eventSequence}:${observer.actorKey}`)
        || !action.receipt!.context.reactionWindows.some(window => (
          window.status !== "closed" && window.layer === "immediate-character"
          && window.humanConfirmationRequiredActorKeys.includes(observer.actorKey)
        ))
        || (input.role === "player" && observer.actorKey !== actorKey)
        || input.role === "spectator") return [];
      return [{
        actionSequence: action.eventSequence,
        actionReceiptKey: action.receipt!.receiptKey,
        sourceActorKey: action.actorKey,
        actorKey: observer.actorKey,
      }];
    });
  });
  const recentNarrations = product.gmNarrations.slice(-50).map((narration) => ({
    eventSequence: narration.eventSequence,
    actionSequence: narration.actionSequence,
    text: narration.text,
    source: narration.source,
    audit:
      input.role === "gm"
        ? {
            runId: narration.runId,
            candidateHash: narration.candidateHash,
            repairApplied: narration.repairApplied,
          }
        : null,
    synthesisFrame: narration.synthesisFrame
      ? {
          mechanicalOutcome: narration.synthesisFrame.mechanicalOutcome,
          actorFeedback: narration.synthesisFrame.actorFeedback,
          reactions: narration.synthesisFrame.reactions.map((reaction) => ({
            ...reaction,
          })),
          sceneUpdate: narration.synthesisFrame.sceneUpdate,
          worldUpdate: narration.synthesisFrame.worldUpdate,
          nextPrompts: [...narration.synthesisFrame.nextPrompts],
        }
      : null,
  }));
  const visibleEffectLedgerEntries = (product.effectLedger?.entries ?? [])
    .filter(
      (entry) =>
        input.role === "gm" ||
        entry.audience === "public" ||
        entry.audience === "party" ||
        (input.role === "player" && entry.audience === `actor:${actorKey}`),
    );
  const effectReceipts = visibleEffectLedgerEntries
    .slice(-50)
    .map((entry) => ({
      eventSequence: entry.eventSequence,
      planKey: entry.planKey,
      degree: entry.degree,
      sourceEventId: entry.sourceEventId,
      ruleRef: entry.ruleRef,
      reason: entry.reason,
      audience: entry.audience,
      transitions: entry.transitions.map((transition) => ({
        effectKey: transition.effectKey,
        family: transition.family,
        operation: transition.operation,
        targetRef: transition.targetRef,
      })),
    }));
  const pendingEffectChoices = (product.effectLedger?.pendingChoices ?? [])
    .filter(choice => input.role === "gm"
      || (input.role === "player" && choice.ownerActorKey === actorKey))
    .map(choice => ({
      choiceKey: choice.choiceKey,
      proposedEventSequence: choice.proposedEventSequence,
      actionSequence: choice.actionSequence,
      ownerActorKey: choice.ownerActorKey,
      degree: choice.plan.degree,
      reason: choice.plan.reason,
      options: choice.plan.effects.map(effect => ({
        effectKey: effect.effectKey,
        family: effect.family,
        operation: effect.operation,
        targetRef: effect.targetRef,
        detail: effect.family === "numeric"
          ? `${effect.valueKey} ${effect.operation} ${effect.amount}`
          : effect.family === "condition"
            ? `${effect.conditionKey} ${effect.operation} ×${effect.stacks}`
            : effect.family === "item"
              ? `${effect.itemDefinitionRef ?? effect.itemInstanceRef ?? "item"} ${effect.operation} ×${effect.amount}`
              : effect.family === "ability"
                ? `${effect.abilityKey} ${effect.operation}${effect.amount == null ? "" : ` ${effect.amount}`}`
                : effect.family === "advancement"
                  ? `${effect.advancementKey} ${effect.operation} ${effect.amount}`
                  : effect.family === "social"
                    ? `${effect.socialKey} ${effect.operation} ${effect.amount}`
                    : `${effect.storyKey} ${effect.operation} ${String(effect.value)}`,
      })),
    }));
  const quests = input.campaign.quests.map((quest) => {
    const progress = product.questProgress.find(
      (item) => item.questKey === quest.questKey,
    );
    const discovered = quest.requiredConclusionKeys.every((key) =>
      visibleConclusionKeys.has(key),
    );
    return {
      questKey: quest.questKey,
      title: quest.title,
      objective: quest.objective,
      status:
        input.role === "gm"
          ? (progress?.status ?? "active")
          : discovered
            ? ("completed" as const)
            : ("active" as const),
      conclusions: quest.requiredConclusionKeys.map((conclusionKey) => ({
        conclusionKey,
        title:
          input.role === "gm" || visibleConclusionKeys.has(conclusionKey)
            ? (input.campaign.clues.find(
                (clue) => clue.conclusionKey === conclusionKey,
              )?.title ?? "已确认结论")
            : null,
        discovered:
          input.role === "gm"
            ? product.discoveredClues.some(
                (item) =>
                  item.clueKey ===
                  input.campaign.clues.find(
                    (clue) => clue.conclusionKey === conclusionKey,
                  )?.clueKey,
              )
            : visibleConclusionKeys.has(conclusionKey),
      })),
    };
  });
  const clocks = (product.clockCatalog ?? [])
    .filter((clock) => input.role === "gm" || clock.visibility === "public"
      || (input.role === "player" && clock.visibility === "party"))
    .map((clock) => {
      const recorded = Object.entries(product.effectLedger?.storyClocks ?? {})
        .filter(([ledgerKey]) => ledgerKey.endsWith(`:${clock.clockKey}`))
        .map(([, value]) => value);
      const current = recorded.length ? Math.max(clock.initialValue, ...recorded) : clock.initialValue;
      const completed = current >= clock.maximum;
      return {
        clockKey: clock.clockKey, title: clock.title, current, maximum: clock.maximum,
        visibility: clock.visibility, completed,
        onComplete: input.role === "gm" || completed ? clock.onComplete : null,
      };
    });
  const ending =
    product.ending == null
      ? null
      : (product.endingCatalog.find(
          (item) => item.endingKey === product.ending?.endingKey,
        ) ?? null);
  const nextSceneTitles =
    input.role === "gm" && currentSceneKey
      ? (input.campaign.scenes
          .find((item) => item.sceneKey === currentSceneKey)
          ?.nextSceneKeys.map(
            (key) =>
              input.campaign.scenes.find((item) => item.sceneKey === key)
                ?.title ?? key,
          ) ?? [])
      : [];
  const tabletopState = product.tabletop;
  const inventory =
    product.inventory == null
      ? []
      : Object.values(product.inventory.items)
          .filter(
            (item) =>
              input.role === "gm" ||
              (input.role === "player" && item.ownerRef === actorKey),
          )
          .map((item) => {
            const definition = input.rulePack.items.find(
              (candidate) => candidate.key === item.definitionRef,
            );
            const mechanics = definition?.mechanics;
            return {
            itemInstanceId: item.itemInstanceId,
            definitionRef: item.definitionRef,
            title: definition?.name ?? item.definitionRef,
            ownerRef: item.ownerRef,
            quantity: item.quantity,
            charges: item.charges,
            durability: item.durability,
            equippedSlots: [...item.equippedSlots],
            attunedToActorRef: item.attunedToActorRef,
            allowedEquipSlots: [...(mechanics?.equipSlots ?? [])],
            requiresAttunement: mechanics?.requiresAttunement ?? false,
            maximumDurability: mechanics?.maximumDurability ?? null,
            canUse:
              (item.charges != null && item.charges > 0) ||
              (mechanics?.stackPolicy === "stackable" && item.quantity > 0),
            identification: item.identification,
            stateTags: [...item.stateTags],
            };
          });
  const actorName = (key: string | null) => key == null
    ? "无"
    : (input.state.entities[key]?.name ?? key);
  const campaignSessions = input.state.ttrpg?.campaign?.playSessions ?? [];
  const recapSession = campaignSessions.find(session => (
    session.sessionKey === input.state.ttrpg?.campaign?.activeSessionKey
  )) ?? [...campaignSessions].sort((left, right) => right.ordinal - left.ordinal)[0] ?? null;
  const recapFromSequence = recapSession?.startedSequence ?? 1;
  const recapToSequence = recapSession?.completedSequence ?? input.state.lastSequence;
  const inRecapScope = (sequence: number) => sequence >= recapFromSequence && sequence <= recapToSequence;
  const scopedActions = product.actionHistory.filter(action => inRecapScope(action.eventSequence));
  const scopedIntentReceipts = (product.intentReceipts ?? []).filter(receipt => (
    inRecapScope(receipt.eventSequence)
    && (input.role === "gm" || (input.role === "player" && receipt.actorKey === actorKey))
  ));
  const resourceChanges = scopedActions.flatMap(action => action.resourceChanges.map(change => ({
    eventSequence: action.eventSequence,
    actorKey: change.entityKey,
    actorName: actorName(change.entityKey),
    resourceKey: change.resourceKey,
    resourceName: input.rulePack.resources.find(resource => resource.key === change.resourceKey)?.name ?? change.resourceKey,
    before: change.before,
    after: change.after,
    delta: change.after - change.before,
  })));
  const conditionChanges = scopedActions.flatMap(action => action.conditionChanges.map(change => ({
    eventSequence: action.eventSequence,
    actorKey: change.entityKey,
    actorName: actorName(change.entityKey),
    conditionKey: change.conditionKey,
    conditionName: input.rulePack.conditions.find(condition => condition.key === change.conditionKey)?.name ?? change.conditionKey,
    stacks: change.stacks,
    duration: change.duration,
  })));
  const abilityVisible = (key: string) => input.role === "gm" || (input.role === "player" && key === actorKey);
  const abilityChanges = [
    ...scopedActions.flatMap(action => {
      const change = action.abilityChange;
      if (!change || !abilityVisible(action.actorKey)) return [];
      return [{
        eventSequence: action.eventSequence,
        actorKey: action.actorKey,
        actorName: actorName(action.actorKey),
        abilityKey: change.after.abilityKey,
        abilityName: input.rulePack.actions.find(item => item.key === change.after.abilityKey)?.name ?? change.after.abilityKey,
        reason: "action" as const,
        usesBefore: change.before.remainingUses,
        usesAfter: change.after.remainingUses,
        cooldownBefore: change.before.cooldownUntilRound,
        cooldownAfter: change.after.cooldownUntilRound,
      }];
    }),
    ...(product.restHistory ?? []).filter(rest => inRecapScope(rest.eventSequence)).flatMap(rest => (
      rest.abilityChanges.filter(change => abilityVisible(change.actorKey)).map(change => ({
        eventSequence: rest.eventSequence,
        actorKey: change.actorKey,
        actorName: actorName(change.actorKey),
        abilityKey: change.abilityKey,
        abilityName: input.rulePack.actions.find(item => item.key === change.abilityKey)?.name ?? change.abilityKey,
        reason: rest.kind,
        usesBefore: change.before.remainingUses,
        usesAfter: change.after.remainingUses,
        cooldownBefore: change.before.cooldownUntilRound,
        cooldownAfter: change.after.cooldownUntilRound,
      }))
    )),
  ].sort((left, right) => left.eventSequence - right.eventSequence);
  const directItemChanges = (product.itemHistory ?? [])
    .filter(receipt => inRecapScope(receipt.eventSequence))
    .filter(receipt => input.role === "gm" || (input.role === "player" && (
      receipt.before?.ownerRef === actorKey || receipt.after?.ownerRef === actorKey || receipt.requestedBy.actorKey === actorKey
    )))
    .map(receipt => ({
      eventSequence: receipt.eventSequence,
      operation: receipt.operation,
      itemInstanceId: receipt.itemInstanceId,
      definitionRef: receipt.definitionRef,
      title: input.rulePack.items.find(item => item.key === receipt.definitionRef)?.name ?? receipt.definitionRef,
      ownerBefore: receipt.before?.ownerRef ?? null,
      ownerAfter: receipt.after?.ownerRef ?? null,
      quantityBefore: receipt.before?.quantity ?? null,
      quantityAfter: receipt.after?.quantity ?? null,
      chargesBefore: receipt.before?.charges ?? null,
      chargesAfter: receipt.after?.charges ?? null,
      durabilityBefore: receipt.before?.durability ?? null,
      durabilityAfter: receipt.after?.durability ?? null,
      source: "direct-command" as const,
    }));
  const parseLedgerJson = (json: string): unknown => {
    try { return JSON.parse(json); } catch { return null; }
  };
  const inventoryItemsFromLedger = (json: string): Record<string, Record<string, unknown>> => {
    const parsed = parseLedgerJson(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const items = (parsed as Record<string, unknown>).items;
    return items && typeof items === "object" && !Array.isArray(items)
      ? items as Record<string, Record<string, unknown>>
      : {};
  };
  const itemSnapshotField = <T,>(item: Record<string, unknown> | undefined, field: string): T | null => (
    item?.[field] == null ? null : item[field] as T
  );
  const effectItemChanges = visibleEffectLedgerEntries
    .filter(entry => inRecapScope(entry.eventSequence))
    .flatMap(entry => entry.transitions.filter(transition => transition.family === "item").flatMap(transition => {
      const beforeItems = inventoryItemsFromLedger(transition.beforeJson);
      const afterItems = inventoryItemsFromLedger(transition.afterJson);
      return [...new Set([...Object.keys(beforeItems), ...Object.keys(afterItems)])].flatMap(itemInstanceId => {
        const before = beforeItems[itemInstanceId];
        const after = afterItems[itemInstanceId];
        if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return [];
        const ownerBefore = itemSnapshotField<string>(before, "ownerRef");
        const ownerAfter = itemSnapshotField<string>(after, "ownerRef");
        if (input.role === "spectator" || (input.role === "player" && ownerBefore !== actorKey && ownerAfter !== actorKey)) return [];
        const definitionRef = itemSnapshotField<string>(after, "definitionRef")
          ?? itemSnapshotField<string>(before, "definitionRef") ?? transition.targetRef;
        return [{
          eventSequence: entry.eventSequence,
          operation: transition.operation,
          itemInstanceId,
          definitionRef,
          title: input.rulePack.items.find(item => item.key === definitionRef)?.name ?? definitionRef,
          ownerBefore, ownerAfter,
          quantityBefore: itemSnapshotField<number>(before, "quantity"),
          quantityAfter: itemSnapshotField<number>(after, "quantity"),
          chargesBefore: itemSnapshotField<number>(before, "charges"),
          chargesAfter: itemSnapshotField<number>(after, "charges"),
          durabilityBefore: itemSnapshotField<number>(before, "durability"),
          durabilityAfter: itemSnapshotField<number>(after, "durability"),
          source: "effect-plan" as const,
        }];
      });
    }));
  const displayLedgerValue = (json: string) => {
    const value = parseLedgerJson(json);
    if (value == null || ["string", "number", "boolean"].includes(typeof value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.length} 项]`;
    return `{${Object.keys(value as Record<string, unknown>).length} 项}`;
  };
  const scopedEffectEntries = visibleEffectLedgerEntries.filter(entry => inRecapScope(entry.eventSequence));
  const ledgerChanges = scopedEffectEntries.flatMap(entry => entry.transitions.map(transition => ({
    eventSequence: entry.eventSequence,
    family: transition.family,
    operation: transition.operation,
    targetRef: transition.targetRef,
    before: displayLedgerValue(transition.beforeJson),
    after: displayLedgerValue(transition.afterJson),
    reason: entry.reason,
  })));
  const discoveredThisSessionTitles = visibleClues.filter(clue => {
    const discovery = product.discoveredClues.find(item => item.clueKey === clue.clueKey);
    return discovery ? inRecapScope(discovery.eventSequence) : false;
  }).map(clue => clue.title);
  const unresolvedRequired = input.campaign.clues.filter(clue => (
    clue.required && !visibleConclusionKeys.has(clue.conclusionKey)
  ));
  const visibleAbilityStates = Object.values(product.abilityStates ?? {}).filter(state => abilityVisible(state.actorInstanceId));
  const exhaustedAbilityNames = visibleAbilityStates.filter(state => (
    state.remainingUses === 0 || (state.cooldownUntilRound != null && state.cooldownUntilRound > (input.state.ttrpg?.round ?? 0))
  )).map(state => input.rulePack.actions.find(action => action.key === state.abilityKey)?.name ?? state.abilityKey);
  const visibleConditionActors = input.role === "gm"
    ? Object.keys(product.conditions)
    : input.role === "player" && actorKey ? [actorKey] : [];
  const activeConditionNames = visibleConditionActors.flatMap(key => (product.conditions[key] ?? []).map(condition => (
    `${actorName(key)}：${input.rulePack.conditions.find(item => item.key === condition.conditionKey)?.name ?? condition.conditionKey}`
  )));
  const incompleteClockTitles = clocks.filter(clock => !clock.completed).map(clock => clock.title);
  const activeQuestTitles = quests.filter(quest => quest.status === "active").map(quest => quest.title);
  const nextPreparationItems = [
    ...activeQuestTitles.map(title => `继续任务：${title}`),
    ...incompleteClockTitles.map(title => `关注 Clock：${title}`),
    ...exhaustedAbilityNames.map(title => `恢复能力：${title}`),
    ...activeConditionNames.map(title => `处理状态：${title}`),
    ...(input.role === "gm" ? unresolvedRequired.map(clue => `准备未解线索：${clue.title}`) : []),
  ];
  const tabletopContent = input.campaign.tabletop?.maps.find(
    (map) => map.mapKey === tabletopState?.currentMapKey,
  );
  const tabletop =
    !tabletopState || !tabletopContent
      ? null
      : {
          mapKey: tabletopContent.mapKey,
          title: tabletopContent.title,
          width: tabletopContent.width,
          height: tabletopContent.height,
          backgroundAssetKey: tabletopContent.backgroundAssetKey,
          fallbackDescription: tabletopContent.fallbackDescription,
          grid: structuredClone(tabletopContent.grid),
          layers: tabletopContent.layers
            .filter((layer) => input.role === "gm" || !layer.gmOnly)
            .map((layer) => ({
              ...structuredClone(layer),
              visible: tabletopState.visibleLayerKeys.includes(layer.layerKey),
            })),
          areas: tabletopContent.areas
            .filter((area) => input.role === "gm" || !area.gmOnly)
            .map((area) => ({
              ...structuredClone(area),
              title: input.role === "gm" || !area.gmOnly ? area.title : null,
            })),
          tokens: tabletopState.tokens
            .filter(
              (token) =>
                token.mapKey === tabletopContent.mapKey &&
                (input.role === "gm" || !token.hidden),
            )
            .map((token) => structuredClone(token)),
          fog: tabletopContent.fog.map((fog) => ({
            ...structuredClone(fog),
            title: input.role === "gm" ? fog.title : null,
            revealed: tabletopState.revealedFogKeys.includes(fog.fogKey),
          })),
        };
  const visibleHandoutSet = new Set(
    visibleHandouts.map((item) => item.handoutKey),
  );
  const visibleItemDefinitions = new Set(
    inventory.map((item) => item.definitionRef),
  );
  const media =
    product.media == null
      ? null
      : {
          generatedCount: product.media.generatedCount,
          maximumGeneratedAssets:
            product.media.runtimePolicy.maximumGeneratedAssets,
          slots: product.media.slots
            .filter((slot) => {
              if (input.role !== "gm") {
                if (
                  slot.audience === "gm-only" ||
                  (input.role === "spectator" && slot.audience !== "public") ||
                  (slot.audience === "private" && actorKey !== slot.targetRef)
                )
                  return false;
                if (
                  slot.kind === "scene" &&
                  slot.targetRef !== currentSceneKey &&
                  !opened.has(slot.targetRef)
                )
                  return false;
                if (slot.kind === "map") {
                  const mapState = product.tabletop?.maps.find(
                    (map) => map.mapKey === slot.targetRef,
                  );
                  if (
                    !mapState?.sceneKeys.some(
                      (sceneKey) =>
                        sceneKey === currentSceneKey || opened.has(sceneKey),
                    )
                  )
                    return false;
                }
                if (
                  slot.kind === "handout" &&
                  !visibleHandoutSet.has(slot.targetRef)
                )
                  return false;
                if (
                  slot.kind === "item-icon" &&
                  !visibleItemDefinitions.has(slot.targetRef)
                )
                  return false;
              }
              return true;
            })
            .map((slot) => ({
              slotKey: slot.slotKey,
              kind: slot.kind,
              targetRef: slot.targetRef,
              fallbackText: slot.fallbackText,
              altText: slot.altText,
              status: slot.status,
              requestKey: slot.requestKey,
              assetKey: slot.assetKey,
              mediaAssetId: slot.mediaAssetId,
              mediaContentHash: slot.mediaContentHash,
              lastErrorCode: slot.lastErrorCode,
            })),
        };
  const continuityState = input.state.ttrpg?.campaign;
  const continuity: TtrpgViewerProjectionV1["continuity"] = {
    activeSessionKey: continuityState?.activeSessionKey ?? null,
    playSessions: (continuityState?.playSessions ?? []).map((session) => ({
      sessionKey: session.sessionKey,
      ordinal: session.ordinal,
      title: session.title,
      status: session.status,
      participantKeys: [...session.participantKeys],
      summary: session.status === "active" ? "" : session.summary,
    })),
    roster: (continuityState?.roster ?? []).map((entry) => ({
      characterKey: entry.characterKey,
      status: entry.status,
      joinedSessionKey: entry.joinedSessionKey,
      leftSessionKey: entry.leftSessionKey,
      replacementFor: entry.replacementFor,
    })),
    memories: (continuityState?.memories ?? [])
      .filter(
        (memory) =>
          input.role === "gm" ||
          memory.audience === "party" ||
          (input.role === "player" && memory.audience === `actor:${actorKey}`),
      )
      .map((memory) => ({
        memoryKey: memory.memoryKey,
        subjectKey: memory.subjectKey,
        summary: memory.summary,
        audience: memory.audience,
        sourceSessionKey: memory.sourceSessionKey,
      })),
    supplements: (continuityState?.supplements ?? []).map((supplement) => ({
      supplementKey: supplement.supplementKey,
      title: supplement.title,
      compatibility: supplement.compatibility,
      activatedSessionKey: supplement.activatedSessionKey,
    })),
    worldEvolution: (continuityState?.worldEvolution ?? [])
      .filter(
        (candidate) =>
          input.role === "gm" ||
          candidate.status === "approved-for-world-review",
      )
      .map((candidate) => ({
        candidateKey: candidate.candidateKey,
        category: candidate.category,
        summary: candidate.summary,
        sourceSessionKey: candidate.sourceSessionKey,
        status: candidate.status,
        targetWorldRef: candidate.targetWorldRef,
      })),
    versionTransitions: (continuityState?.versionTransitions ?? []).map(
      (transition) => ({
        transitionKey: transition.transitionKey,
        compatibility: transition.compatibility,
        status: transition.status,
        toCampaignKey: transition.toCampaignKey,
        notes: input.role === "gm" ? transition.notes : null,
      }),
    ),
  };
  return {
    schema: "storyforge.ttrpg-viewer-projection",
    version: 1,
    role: input.role,
    actorKey,
    gmController: input.campaign.gmMode ?? "human",
    eventSequence: input.state.lastSequence,
    safety: {
      status: product.safety.status,
      reason: product.safety.status === "paused" ? product.safety.reason : null,
    },
    turn: {
      round: input.state.ttrpg?.round ?? 0,
      activeActorKey,
      actorKeys: [...actorKeys],
      budget:
        actionActorKey && product.actionEconomy?.budgets[actionActorKey]
          ? structuredClone(product.actionEconomy.budgets[actionActorKey])
          : null,
      initiative: (input.state.ttrpg?.initiative?.entries ?? []).map(
        (entry) => ({
          actorKey: entry.actorKey,
          total: entry.total,
          dice: [...entry.keptDice],
          modifier: entry.modifier,
        }),
      ),
    },
    actors,
    inventory,
    scenes,
    visibleClues,
    visibleHandoutKeys: visibleHandouts.map((item) => item.handoutKey),
    visibleHandouts,
    visibleConclusionKeys: [...visibleConclusionKeys],
    availableActions,
    recentActions,
    recentIntentReceipts,
    humanResponses,
    pendingHumanResponses,
    recentRests,
    recentNarrations,
    effectReceipts,
    pendingEffectChoices,
    quests,
    clocks,
    ruleReference: input.rulePack.compendium.map((entry) => ({
      key: entry.key,
      title: entry.title,
      category: entry.category,
      body: entry.body,
    })),
    gmControls:
      input.role !== "gm"
        ? null
        : {
            openableScenes: (currentScene
              ? currentScene.nextSceneKeys
              : [input.campaign.openingSceneKey]
            )
              .map((sceneKey) =>
                input.campaign.scenes.find(
                  (item) => item.sceneKey === sceneKey,
                ),
              )
              .filter((scene): scene is NonNullable<typeof scene> => !!scene)
              .map((scene) => ({
                sceneKey: scene.sceneKey,
                title: scene.title,
              })),
            currentClues: (currentScene?.clueKeys ?? [])
              .map((clueKey) =>
                input.campaign.clues.find((item) => item.clueKey === clueKey),
              )
              .filter((clue): clue is NonNullable<typeof clue> => !!clue)
              .map((clue) => ({
                clueKey: clue.clueKey,
                title: clue.title,
                description: clue.description,
                visibility: clue.visibility,
                discoveryVisibility:
                  product.discoveredClues.find(
                    (item) => item.clueKey === clue.clueKey,
                  )?.visibility ?? null,
              })),
            endings: input.campaign.endings.map((item) => ({
              endingKey: item.endingKey,
              title: item.title,
              enabled:
                currentScene?.nextSceneKeys.length === 0
                && (!item.trigger || item.trigger.sceneKey === currentScene.sceneKey)
                && (item.trigger?.requiredConclusionKeys ?? []).every((key) => visibleConclusionKeys.has(key))
                && !(item.trigger?.forbiddenConclusionKeys ?? []).some((key) => visibleConclusionKeys.has(key)),
            })),
            itemDefinitions: input.rulePack.items.map(item => ({
              itemKey: item.key,
              title: item.name,
              maximumStack: item.mechanics?.maxStack ?? 1,
            })),
          },
    tabletop,
    media,
    continuity,
    recap: {
      schema: "storyforge.ttrpg-session-fact-recap",
      version: 2,
      scope: {
        sessionKey: recapSession?.sessionKey ?? null,
        title: recapSession?.title ?? product.campaignTitle,
        status: recapSession?.status ?? "whole-instance",
        fromSequence: recapFromSequence,
        toSequence: recapToSequence,
      },
      viewerKind: input.role === "gm"
        ? "gm-complete"
        : input.role === "player" ? "character-private" : "spectator-public",
      openedSceneTitles: scenes
        .filter((item) => item.status !== "locked" && item.title)
        .map((item) => item.title!),
      visibleClueTitles: visibleClues.map((item) => item.title),
      discoveredThisSessionTitles,
      unresolvedRequiredClues: {
        visibleTitles: input.role === "gm" ? unresolvedRequired.map(clue => clue.title) : [],
        hiddenCount: input.role === "gm" ? 0 : unresolvedRequired.length,
      },
      resolvedActionCount: scopedActions.length,
      intentDispositionCount: scopedIntentReceipts.length,
      resourceChanges,
      abilityChanges,
      itemChanges: [...directItemChanges, ...effectItemChanges].sort((left, right) => left.eventSequence - right.eventSequence),
      conditionChanges,
      ledgerChanges,
      outstanding: {
        exhaustedAbilityNames: [...new Set(exhaustedAbilityNames)],
        activeConditionNames: [...new Set(activeConditionNames)],
        activeQuestTitles,
        incompleteClockTitles,
      },
      ending: ending
        ? { title: ending.title, epilogue: ending.epilogue }
        : null,
      advancementAwarded: product.advancement.totalAwarded,
      nextPreparation: ending
        ? "战役已完成；可回看事件、建立分支或从新发布开启下一阶段。"
        : input.role === "gm" && (nextSceneTitles.length || nextPreparationItems.length)
          ? `下一场准备：${[...nextSceneTitles, ...nextPreparationItems].join("、")}`
          : nextPreparationItems.length
            ? `下次继续：${nextPreparationItems.join("、")}`
          : "等待主持人公开下一阶段安排。",
    },
  };
}
