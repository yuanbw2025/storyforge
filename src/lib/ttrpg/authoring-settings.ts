import type { ProductProductionSourceOptionsV1, ProductProductionSourceSelectionV1, TtrpgProductionSeatV2 } from "../types";
import type { TtrpgProductionBriefDraftInputV2 } from "./production-brief";
import type { TtrpgAuthoringSettings, TtrpgAuthoringSettingsV1 } from "./authoring-contract";
import type { TtrpgAuthoringSettingsV2 } from "./authoring-contract-v2";

/** P2a deliberately has no open production DAG. Guard before dropping to wizard-only input. */
export function assertTtrpgScriptedAuthoringSettings(
  settings: TtrpgAuthoringSettings,
): asserts settings is TtrpgAuthoringSettingsV1 | Extract<TtrpgAuthoringSettingsV2, { runFormat: "scripted" }> {
  if (settings.runFormat === "open")
    throw new Error("P2a 尚未开放 open 生产，不能编译为 scripted Brief V2");
}
export type SeatDraft = Omit<TtrpgProductionSeatV2, "sourceCharacterResourceKey"> & {
  sourceCharacterResourceKey: string | null;
};

type HouseRulePatchDraft = {
  path: string;
  value: string;
  reason: string;
};

export interface TtrpgProductionWizardValueV2 {
  creationMode: "quick" | "advanced";
  instruction: string;
  background: string;
  coreConflict: string;
  difficulty: "introductory" | "standard" | "challenging";
  targetSessions: number;
  targetSessionMinutes: number;
  ruleOrigin:
    | "builtin-storyforge"
    | "builtin-rank-lite"
    | "builtin-d20-fantasy"
    | "builtin-d100-investigation"
    | "saved-rule-pack";
  savedRulePackId: number | null;
  initiativeDiceSides: number | null;
  actionsPerTurn: number | null;
  reactionsPerRound: number | null;
  deathRecoveryHeroicDiceCost: number | null;
  customHouseRulePatches: HouseRulePatchDraft[];
  gmMode: "human" | "ai" | "hybrid";
  seats: SeatDraft[];
  allowCustomSheets: boolean;
  allowAiGeneration: boolean;
  requireGmApproval: boolean;
  progressionMode: "rule-native" | "rank-lite" | "none";
  startingLevelOrTier: string;
  structure: "linear" | "branching" | "node-based" | "sandbox";
  targetSceneCount: number;
  targetQuestCount: number;
  clueRedundancy: number;
  targetEndingCount: number;
  failForward: boolean;
  freeRoam: boolean;
  characterPrivateChannels: boolean;
  gmSecrets: boolean;
  hiddenNpcState: boolean;
  hiddenDice: "never" | "gm-only" | "allowed";
  interPlayerWhispers: boolean;
  revealAuditTrail: boolean;
  linesText: string;
  veilsText: string;
  sessionZeroRequired: boolean;
  pauseSignal: string;
  openDoor: boolean;
  visualStyle: string;
  sceneImages: boolean;
  characterPortraits: boolean;
  characterExpressions: boolean;
  itemIcons: boolean;
  handouts: boolean;
  maps: boolean;
  tokens: boolean;
  generationTiming: "prebuild" | "background-during-play" | "hybrid";
  maximumGeneratedAssets: number;
  confirmAll: boolean;
}

export function createDefaultTtrpgProductionWizardValueV2(): TtrpgProductionWizardValueV2 {
  return {
    creationMode: "quick",
    instruction: "",
    background: "",
    coreConflict: "",
    difficulty: "standard",
    targetSessions: 1,
    targetSessionMinutes: 120,
    ruleOrigin: "builtin-storyforge",
    savedRulePackId: null,
    initiativeDiceSides: null,
    actionsPerTurn: null,
    reactionsPerRound: null,
    deathRecoveryHeroicDiceCost: null,
    customHouseRulePatches: [],
    gmMode: "ai",
    seats: [
      {
        seatKey: "player.1",
        label: "玩家 1",
        controller: "human",
        role: "player",
        characterMode: "world-template",
        sourceCharacterResourceKey: null,
        characterName: "",
        rankTier: null,
        privateGoal: "",
      },
      {
        seatKey: "player.2",
        label: "玩家 2",
        controller: "ai",
        role: "player",
        characterMode: "ai-generated",
        sourceCharacterResourceKey: null,
        characterName: "",
        rankTier: null,
        privateGoal: "",
      },
    ],
    allowCustomSheets: true,
    allowAiGeneration: true,
    requireGmApproval: true,
    progressionMode: "rule-native",
    startingLevelOrTier: "规则默认",
    structure: "node-based",
    targetSceneCount: 6,
    targetQuestCount: 2,
    clueRedundancy: 3,
    targetEndingCount: 3,
    failForward: true,
    freeRoam: false,
    characterPrivateChannels: true,
    gmSecrets: true,
    hiddenNpcState: true,
    hiddenDice: "gm-only",
    interPlayerWhispers: true,
    revealAuditTrail: true,
    linesText: "不生成未授权的露骨或仇恨内容",
    veilsText: "",
    sessionZeroRequired: true,
    pauseSignal: "暂停",
    openDoor: true,
    visualStyle: "延续冻结世界的视觉语言，保持角色、场景与物品一致。",
    sceneImages: true,
    characterPortraits: true,
    characterExpressions: true,
    itemIcons: true,
    handouts: true,
    maps: true,
    tokens: true,
    generationTiming: "hybrid",
    maximumGeneratedAssets: 32,
    confirmAll: false,
  };
}

function uniqueLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function toTtrpgProductionBriefDraftInputV2(input: {
  value: TtrpgProductionWizardValueV2;
  sourceOptions: ProductProductionSourceOptionsV1 | null;
  sourceSelection: ProductProductionSourceSelectionV1 | null;
  openingSituation: string;
}): TtrpgProductionBriefDraftInputV2 {
  const value = input.value;
  const selectedWorldCharacters =
    input.sourceSelection?.characterResourceKeys ?? [];
  const selectedSet = new Set(selectedWorldCharacters);
  const used = new Set<string>();
  const seats = value.seats.map((seat, index): TtrpgProductionSeatV2 => {
    let sourceCharacterResourceKey = seat.sourceCharacterResourceKey;
    if (
      seat.characterMode === "world-template" &&
      (sourceCharacterResourceKey == null ||
        !selectedSet.has(sourceCharacterResourceKey))
    ) {
      sourceCharacterResourceKey =
        selectedWorldCharacters.find((id) => !used.has(id)) ??
        selectedWorldCharacters[0] ??
        null;
    }
    const characterMode =
      seat.characterMode === "world-template" && sourceCharacterResourceKey == null
        ? ("ai-generated" as const)
        : seat.characterMode;
    if (sourceCharacterResourceKey != null) used.add(sourceCharacterResourceKey);
    const sourceName =
      input.sourceOptions?.characters.find(
        (option) => option.resourceKey === sourceCharacterResourceKey,
      )?.label ?? "";
    return {
      ...seat,
      seatKey: `player.${index + 1}`,
      label: seat.label.trim() || `玩家 ${index + 1}`,
      characterMode,
      sourceCharacterResourceKey:
        characterMode === "world-template" ? sourceCharacterResourceKey : null,
      characterName: seat.characterName.trim() || sourceName,
      rankTier: characterMode === "quick-card" ? (seat.rankTier ?? "C") : null,
    };
  });
  const patches: NonNullable<
    NonNullable<TtrpgProductionBriefDraftInputV2["rules"]>["houseRulePatches"]
  > = [];
  if (
    value.initiativeDiceSides != null &&
    (value.ruleOrigin === "builtin-storyforge" ||
      value.ruleOrigin === "builtin-rank-lite")
  )
    patches.push({
      path: `diceModels.${
        value.ruleOrigin === "builtin-rank-lite" ? "rank-d20" : "core-2d6"
      }.sides`,
      value: value.initiativeDiceSides,
      reason: "作者在跑团创建向导中调整核心骰面数。",
    });
  if (value.actionsPerTurn != null)
    patches.push({
      path: "turnStructure.actionsPerTurn",
      value: value.actionsPerTurn,
      reason: "作者设定每回合行动数。",
    });
  if (value.reactionsPerRound != null)
    patches.push({
      path: "turnStructure.reactionsPerRound",
      value: value.reactionsPerRound,
      reason: "作者设定每轮反应数。",
    });
  if (
    value.ruleOrigin === "builtin-d20-fantasy" &&
    value.deathRecoveryHeroicDiceCost != null
  )
    patches.push({
      path: "actions.death-recovery.costAmount",
      value: value.deathRecoveryHeroicDiceCost,
      reason: "作者把濒死恢复改为消耗英雄骰资源后进行体质检定。",
    });
  for (const custom of value.customHouseRulePatches) {
    const path = custom.path.trim();
    const rawValue = custom.value.trim();
    const reason = custom.reason.trim();
    if (!path || !rawValue || !reason) continue;
    const numeric = Number(rawValue);
    patches.push({
      path,
      value: Number.isFinite(numeric) ? numeric : rawValue,
      reason,
    });
  }
  return {
    creationMode: value.creationMode,
    naturalLanguageInstruction:
      value.instruction.trim() ||
      `依据冻结世界制作并主持一场跑团：${input.openingSituation}`,
    campaign: {
      background:
        value.background.trim() ||
        "从冻结世界的历史、角色关系和地点约束中生成战役背景。",
      coreConflict: value.coreConflict.trim() || input.openingSituation,
      difficulty: value.difficulty,
      targetSessions: value.targetSessions,
      targetSessionMinutes: value.targetSessionMinutes,
    },
    rules: {
      origin: value.ruleOrigin,
      savedRulePackId:
        value.ruleOrigin === "saved-rule-pack" ? value.savedRulePackId : null,
      houseRulePatches: patches,
      overlayTitle: "创建向导村规",
    },
    gmMode: value.gmMode,
    playerCount: seats.length,
    seats,
    table: {
      spectatorPolicy: "public-only",
      joinInProgress: true,
      asynchronousPlay: false,
    },
    characters: {
      defaultCreationMode: "ai-generated",
      allowCustomSheets: value.allowCustomSheets,
      allowAiGeneration: value.allowAiGeneration,
      requireGmApproval: value.requireGmApproval,
      progressionMode: value.progressionMode,
      startingLevelOrTier: value.startingLevelOrTier,
    },
    story: {
      structure: value.structure,
      openingScene: input.openingSituation,
      targetSceneCount: value.targetSceneCount,
      targetQuestCount: value.targetQuestCount,
      clueRedundancy: value.clueRedundancy,
      targetEndingCount: value.targetEndingCount,
      failForward: value.failForward,
      freeRoam: value.freeRoam,
      canonMutationPolicy: "author-review",
    },
    information: {
      characterPrivateChannels: value.characterPrivateChannels,
      gmSecrets: value.gmSecrets,
      hiddenNpcState: value.hiddenNpcState,
      hiddenDice: value.hiddenDice,
      interPlayerWhispers: value.interPlayerWhispers,
      revealAuditTrail: value.revealAuditTrail,
    },
    safety: {
      sessionZeroRequired: value.sessionZeroRequired,
      lines: uniqueLines(value.linesText),
      veils: uniqueLines(value.veilsText),
      contentWarnings: uniqueLines(value.linesText),
      pauseSignal: value.pauseSignal,
      openDoor: value.openDoor,
    },
    media: {
      visualStyle: value.visualStyle,
      sceneImages: value.sceneImages,
      characterPortraits: value.characterPortraits,
      characterExpressions: value.characterExpressions,
      itemIcons: value.itemIcons,
      handouts: value.handouts,
      maps: value.maps,
      tokens: value.tokens,
      generationTiming: value.generationTiming,
      backgroundGeneration: value.generationTiming !== "prebuild",
      textFallback: true,
      maximumGeneratedAssets: value.maximumGeneratedAssets,
    },
    confirmations: {
      worldCanonBoundary: value.confirmAll,
      numericMappings: value.confirmAll,
      ruleLicense: value.confirmAll,
      aiParticipationDisclosure: value.confirmAll,
      mediaRights: value.confirmAll,
    },
  };
}
