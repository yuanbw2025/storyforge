import { useEffect, useMemo, useState } from "react";
import type {
  ProductProductionSourceOptionsV1,
  ProductProductionSourceSelectionV1,
  TtrpgRulePackRecordV1,
  TtrpgProductionSeatV2,
  WorkspaceScope,
} from "../../lib/types";
import { listValidatedTtrpgRulePacksV1 } from "../../lib/ttrpg/rule-pack-library";
import type { TtrpgProductionBriefDraftInputV2 } from "../../lib/ttrpg/production-brief";

type SeatDraft = Omit<TtrpgProductionSeatV2, "sourceCharacterResourceKey"> & {
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

const STEPS = [
  "世界与指令",
  "战役愿景",
  "规则与村规",
  "主持与席位",
  "车卡策略",
  "剧情结构",
  "信息与安全",
  "动态媒资",
  "审查确认",
] as const;

const inputClass =
  "rounded border border-border bg-bg-base p-2 text-xs text-text-primary";
const labelClass = "grid gap-2 text-[10px] text-text-muted";

export default function TtrpgProductionWizard(props: {
  scope: WorkspaceScope;
  value: TtrpgProductionWizardValueV2;
  onChange: (next: TtrpgProductionWizardValueV2) => void;
  sourceOptions: ProductProductionSourceOptionsV1 | null;
  sourceSelection: ProductProductionSourceSelectionV1 | null;
  sourceLabel?: string;
}) {
  const [step, setStep] = useState(0);
  const [rulePacks, setRulePacks] = useState<TtrpgRulePackRecordV1[]>([]);
  const scopeProjectId = props.scope.projectId;
  const scopeWorldId = props.scope.worldId;
  const scopeWorkId = props.scope.workId;
  useEffect(() => {
    let active = true;
    void listValidatedTtrpgRulePacksV1({
      projectId: scopeProjectId,
      worldId: scopeWorldId,
      workId: scopeWorkId,
    })
      .then((result) => {
        if (active) setRulePacks(result);
      })
      .catch(() => {
        if (active) setRulePacks([]);
      });
    return () => {
      active = false;
    };
  }, [scopeProjectId, scopeWorldId, scopeWorkId]);
  const value = props.value;
  const patch = (next: Partial<TtrpgProductionWizardValueV2>) =>
    props.onChange({ ...value, ...next });
  const selectedCharacters = useMemo(() => {
    const ids = new Set(props.sourceSelection?.characterResourceKeys ?? []);
    return (
      props.sourceOptions?.characters.filter((option) =>
        ids.has(option.resourceKey),
      ) ?? []
    );
  }, [props.sourceOptions, props.sourceSelection]);
  const patchSeat = (index: number, next: Partial<SeatDraft>) =>
    patch({
      seats: value.seats.map((seat, seatIndex) =>
        seatIndex === index ? { ...seat, ...next } : seat,
      ),
    });
  const boolean = (
    label: string,
    field: keyof TtrpgProductionWizardValueV2,
  ) => (
    <label className="flex items-center gap-2 text-[10px] text-text-muted">
      <input
        type="checkbox"
        checked={Boolean(value[field])}
        onChange={(event) =>
          patch({
            [field]: event.target.checked,
          } as Partial<TtrpgProductionWizardValueV2>)
        }
      />
      {label}
    </label>
  );
  const mediaCount = [
    value.sceneImages,
    value.characterPortraits,
    value.characterExpressions,
    value.itemIcons,
    value.handouts,
    value.maps,
    value.tokens,
  ].filter(Boolean).length;

  return (
    <section
      className="rounded border border-accent/30 bg-accent/5 p-4 md:col-span-2"
      data-testid="ttrpg-production-wizard"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <small className="font-mono text-[9px] text-accent">
            TTRPG BRIEF V2 · 9 STEPS
          </small>
          <h3 className="mt-1 text-sm font-semibold">
            {step + 1}. {STEPS[step]}
          </h3>
        </div>
        <span className="text-[10px] text-text-muted">
          {step + 1}/9 · {Math.round(((step + 1) / 9) * 100)}%
        </span>
      </div>
      <div className="mt-3 grid grid-cols-9 gap-1" aria-label="跑团创建进度">
        {STEPS.map((label, index) => (
          <button
            type="button"
            key={label}
            title={label}
            aria-label={`步骤 ${index + 1} ${label}`}
            onClick={() => setStep(index)}
            className={`h-1.5 rounded ${index <= step ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {step === 0 && (
          <>
            <label className={labelClass}>
              创建模式
              <select
                className={inputClass}
                value={value.creationMode}
                onChange={(event) =>
                  patch({
                    creationMode: event.target
                      .value as typeof value.creationMode,
                  })
                }
              >
                <option value="quick">快速创建 · AI 补齐</option>
                <option value="advanced">高级创建 · 完整控制</option>
              </select>
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              给 AI 的跑团制作指令
              <textarea
                rows={5}
                className={inputClass}
                value={value.instruction}
                onChange={(event) => patch({ instruction: event.target.value })}
                placeholder="例如：用这个世界制作一场 4 人悬疑调查团；AI 担任 KP，强调角色秘密、失败推进和多结局。"
              />
            </label>
            <p className="text-[10px] leading-5 text-text-muted md:col-span-2">
              {props.sourceLabel ?? "冻结 WorldRelease"}
              是世界事实来源；本指令决定如何把它设计成战役，不会让规则数值反写世界
              Canon。
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <label className={`${labelClass} md:col-span-2`}>
              战役背景
              <textarea
                rows={4}
                className={inputClass}
                value={value.background}
                onChange={(event) => patch({ background: event.target.value })}
                placeholder="留空则由 AI 依据冻结世界生成"
              />
            </label>
            <label className={`${labelClass} md:col-span-2`}>
              核心冲突
              <textarea
                rows={3}
                className={inputClass}
                value={value.coreConflict}
                onChange={(event) =>
                  patch({ coreConflict: event.target.value })
                }
              />
            </label>
            <label className={labelClass}>
              难度
              <select
                className={inputClass}
                value={value.difficulty}
                onChange={(event) =>
                  patch({
                    difficulty: event.target.value as typeof value.difficulty,
                  })
                }
              >
                <option value="introductory">入门</option>
                <option value="standard">标准</option>
                <option value="challenging">挑战</option>
              </select>
            </label>
            <label className={labelClass}>
              场次数 / 每场分钟
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  className={inputClass}
                  value={value.targetSessions}
                  onChange={(event) =>
                    patch({ targetSessions: Number(event.target.value) })
                  }
                />
                <input
                  type="number"
                  min={15}
                  max={720}
                  className={inputClass}
                  value={value.targetSessionMinutes}
                  onChange={(event) =>
                    patch({ targetSessionMinutes: Number(event.target.value) })
                  }
                />
              </div>
            </label>
          </>
        )}
        {step === 2 && (
          <>
            <label className={`${labelClass} md:col-span-2`}>
              基础规则
              <select
                className={inputClass}
                value={value.ruleOrigin}
                onChange={(event) =>
                  patch({
                    ruleOrigin: event.target.value as typeof value.ruleOrigin,
                    savedRulePackId: null,
                    progressionMode:
                      event.target.value === "builtin-rank-lite"
                        ? "rank-lite"
                        : "rule-native",
                    startingLevelOrTier:
                      event.target.value === "builtin-rank-lite"
                        ? "C"
                        : event.target.value === "builtin-d20-fantasy"
                          ? "1"
                          : "规则默认",
                    deathRecoveryHeroicDiceCost: null,
                  })
                }
              >
                <option value="builtin-storyforge">
                  StoryForge 2d6 叙事规则
                </option>
                <option value="builtin-rank-lite">
                  Rank Lite · D/C/B/A + d20
                </option>
                <option value="builtin-d20-fantasy">
                  5E 兼容奇幻 · d20 / 优劣势 / 1～20 级
                </option>
                <option value="builtin-d100-investigation">
                  StoryForge 调查 · d100 百分检定
                </option>
                <option value="saved-rule-pack">
                  已验证自定义 / 兼容规则包
                </option>
              </select>
            </label>
            {value.ruleOrigin === "saved-rule-pack" && (
              <label className={`${labelClass} md:col-span-2`}>
                规则包
                <select
                  className={inputClass}
                  value={value.savedRulePackId ?? ""}
                  onChange={(event) =>
                    patch({
                      savedRulePackId: Number(event.target.value) || null,
                    })
                  }
                >
                  <option value="">请选择 validated RulePack</option>
                  {rulePacks.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.title} · {pack.ruleSystemId}@
                      {pack.ruleSystemVersion}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(value.ruleOrigin === "builtin-storyforge" ||
              value.ruleOrigin === "builtin-rank-lite") && (
              <label className={labelClass}>
                核心骰面数（2～100）
                <input
                  type="number"
                  min={2}
                  max={100}
                  className={inputClass}
                  value={value.initiativeDiceSides ?? ""}
                  placeholder="沿用规则"
                  onChange={(event) =>
                    patch({
                      initiativeDiceSides: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </label>
            )}
            {(value.ruleOrigin === "builtin-d20-fantasy" ||
              value.ruleOrigin === "builtin-d100-investigation") && (
              <p className="rounded border border-border bg-bg-base p-2 text-[10px] leading-5 text-text-muted">
                该深规则包的核心骰型已冻结；可通过行动数、反应数和规则允许的难度字段制定村规。
              </p>
            )}
            <label className={labelClass}>
              村规：行动 / 反应
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label="每回合行动数"
                  type="number"
                  min={1}
                  max={20}
                  className={inputClass}
                  value={value.actionsPerTurn ?? ""}
                  placeholder="默认"
                  onChange={(event) =>
                    patch({
                      actionsPerTurn: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
                <input
                  aria-label="每轮反应数"
                  type="number"
                  min={0}
                  max={20}
                  className={inputClass}
                  value={value.reactionsPerRound ?? ""}
                  placeholder="默认"
                  onChange={(event) =>
                    patch({
                      reactionsPerRound: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </div>
            </label>
            {value.ruleOrigin === "builtin-d20-fantasy" && (
              <label className={labelClass}>
                濒死恢复英雄骰消耗
                <input
                  aria-label="濒死恢复英雄骰消耗"
                  type="number"
                  min={0}
                  max={100}
                  className={inputClass}
                  value={value.deathRecoveryHeroicDiceCost ?? ""}
                  placeholder="基础规则：0"
                  onChange={(event) =>
                    patch({
                      deathRecoveryHeroicDiceCost: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
                <span>
                  仅生命为 0 时可执行；填 1 即成为一次英雄骰资源检定，资源不足会在掷骰前拒绝。
                </span>
              </label>
            )}
            <section className="space-y-2 rounded border border-border bg-bg-base p-3 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="text-[10px] text-text-primary">高级村规白名单</strong>
                  <p className="mt-1 text-[9px] leading-4 text-text-muted">
                    可覆盖 diceModels、checks、actions、conditions、turnStructure 或 advancement 的受支持标量路径；保存 Brief 时会验证路径、类型、d100 上限和规则 fixtures。
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded border border-accent/40 px-2 py-1 text-[10px] text-accent"
                  onClick={() =>
                    patch({
                      customHouseRulePatches: [
                        ...value.customHouseRulePatches,
                        { path: "", value: "", reason: "" },
                      ],
                    })
                  }
                >
                  添加村规补丁
                </button>
              </div>
              {value.customHouseRulePatches.map((custom, index) => (
                <div
                  key={`house-rule-${index}`}
                  className="grid gap-2 md:grid-cols-[2fr_1fr_3fr_auto]"
                >
                  <input
                    aria-label={`村规 ${index + 1} 路径`}
                    className={inputClass}
                    value={custom.path}
                    placeholder="如 checks.ability.defaultDifficulty"
                    onChange={(event) =>
                      patch({
                        customHouseRulePatches: value.customHouseRulePatches.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, path: event.target.value }
                              : item,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`村规 ${index + 1} 值`}
                    className={inputClass}
                    value={custom.value}
                    placeholder="新值"
                    onChange={(event) =>
                      patch({
                        customHouseRulePatches: value.customHouseRulePatches.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, value: event.target.value }
                              : item,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`村规 ${index + 1} 理由`}
                    className={inputClass}
                    value={custom.reason}
                    placeholder="为什么要改，以及桌上如何解释"
                    onChange={(event) =>
                      patch({
                        customHouseRulePatches: value.customHouseRulePatches.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, reason: event.target.value }
                              : item,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label={`移除村规 ${index + 1}`}
                    className="rounded border border-error/30 px-2 text-[10px] text-error"
                    onClick={() =>
                      patch({
                        customHouseRulePatches: value.customHouseRulePatches.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      })
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
            </section>
            <p className="text-[10px] leading-5 text-text-muted md:col-span-2">
              村规只覆盖白名单字段，绑定基础规则 hash，并在保存前重跑规则
              fixtures；任何 d101 或更高骰会被拒绝。
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <label className={labelClass}>
              KP / GM 模式
              <select
                className={inputClass}
                value={value.gmMode}
                onChange={(event) =>
                  patch({ gmMode: event.target.value as typeof value.gmMode })
                }
              >
                <option value="ai">AI KP</option>
                <option value="human">真人 KP</option>
                <option value="hybrid">真人 + AI 助理 KP</option>
              </select>
            </label>
            <div className="md:col-span-2 space-y-2">
              {value.seats.map((seat, index) => (
                <article
                  key={seat.seatKey}
                  className="grid gap-2 rounded border border-border bg-bg-base p-3 md:grid-cols-4"
                >
                  <input
                    aria-label={`席位 ${index + 1} 名称`}
                    className={inputClass}
                    value={seat.label}
                    onChange={(event) =>
                      patchSeat(index, { label: event.target.value })
                    }
                  />
                  <select
                    aria-label={`席位 ${index + 1} 控制者`}
                    className={inputClass}
                    value={seat.controller}
                    onChange={(event) =>
                      patchSeat(index, {
                        controller: event.target
                          .value as SeatDraft["controller"],
                      })
                    }
                  >
                    <option value="human">真人玩家</option>
                    <option value="ai">AI 玩家</option>
                    <option value="open">待加入</option>
                  </select>
                  <select
                    aria-label={`席位 ${index + 1} 车卡方式`}
                    className={inputClass}
                    value={seat.characterMode}
                    onChange={(event) =>
                      patchSeat(index, {
                        characterMode: event.target
                          .value as SeatDraft["characterMode"],
                        sourceCharacterResourceKey: null,
                        rankTier:
                          event.target.value === "quick-card" ? "C" : null,
                      })
                    }
                  >
                    <option value="world-template">世界角色模板</option>
                    <option value="quick-card">D/C/B/A 快速卡</option>
                    <option value="manual">手动车卡</option>
                    <option value="ai-generated">AI 生成车卡</option>
                  </select>
                  {seat.characterMode === "world-template" ? (
                    <select
                      aria-label={`席位 ${index + 1} 世界角色`}
                      className={inputClass}
                      value={seat.sourceCharacterResourceKey ?? ""}
                      onChange={(event) =>
                        patchSeat(index, {
                          sourceCharacterResourceKey: event.target.value || null,
                        })
                      }
                    >
                      <option value="">自动匹配</option>
                      {selectedCharacters.map((character) => (
                        <option
                          key={character.resourceKey}
                          value={character.resourceKey}
                        >
                          {character.label}
                        </option>
                      ))}
                    </select>
                  ) : seat.characterMode === "quick-card" ? (
                    <select
                      aria-label={`席位 ${index + 1} 阶位`}
                      className={inputClass}
                      value={seat.rankTier ?? "C"}
                      onChange={(event) =>
                        patchSeat(index, {
                          rankTier: event.target.value as SeatDraft["rankTier"],
                        })
                      }
                    >
                      <option>D</option>
                      <option>C</option>
                      <option>B</option>
                      <option>A</option>
                    </select>
                  ) : (
                    <input
                      aria-label={`席位 ${index + 1} 角色名`}
                      className={inputClass}
                      value={seat.characterName}
                      placeholder="可留空由 AI 命名"
                      onChange={(event) =>
                        patchSeat(index, { characterName: event.target.value })
                      }
                    />
                  )}
                  <textarea
                    aria-label={`席位 ${index + 1} 私人目标`}
                    className={`${inputClass} md:col-span-3`}
                    rows={2}
                    value={seat.privateGoal}
                    placeholder="仅该玩家与 KP 可见的目标（可选）"
                    onChange={(event) =>
                      patchSeat(index, { privateGoal: event.target.value })
                    }
                  />
                  {value.seats.length > 1 && (
                    <button
                      type="button"
                      className="rounded border border-error/30 px-2 text-[10px] text-error"
                      onClick={() =>
                        patch({
                          seats: value.seats.filter(
                            (_, seatIndex) => seatIndex !== index,
                          ),
                        })
                      }
                    >
                      移除席位
                    </button>
                  )}
                </article>
              ))}
            </div>
            <button
              type="button"
              disabled={value.seats.length >= 12}
              className="rounded border border-accent/40 px-3 py-2 text-[10px] text-accent disabled:opacity-40"
              onClick={() =>
                patch({
                  seats: [
                    ...value.seats,
                    {
                      seatKey: `player.${value.seats.length + 1}`,
                      label: `玩家 ${value.seats.length + 1}`,
                      controller: "open",
                      role: "player",
                      characterMode: "ai-generated",
                      sourceCharacterResourceKey: null,
                      characterName: "",
                      rankTier: null,
                      privateGoal: "",
                    },
                  ],
                })
              }
            >
              添加席位（最多 12）
            </button>
          </>
        )}
        {step === 4 && (
          <>
            <div className="space-y-3 md:col-span-2">
              {boolean("允许玩家自定义完整角色卡", "allowCustomSheets")}
              {boolean("允许 AI 按规则生成角色卡", "allowAiGeneration")}
              {boolean("开团前必须由 KP 审核角色卡", "requireGmApproval")}
            </div>
            <label className={labelClass}>
              成长方式
              <select
                className={inputClass}
                value={value.progressionMode}
                onChange={(event) =>
                  patch({
                    progressionMode: event.target
                      .value as typeof value.progressionMode,
                  })
                }
              >
                <option value="rule-native">规则原生成长 / 等级</option>
                <option value="rank-lite">D/C/B/A 阶位</option>
                <option value="none">不成长</option>
              </select>
            </label>
            <label className={labelClass}>
              初始等级 / 阶位
              <input
                className={inputClass}
                value={value.startingLevelOrTier}
                onChange={(event) =>
                  patch({ startingLevelOrTier: event.target.value })
                }
              />
            </label>
            <p className="text-[10px] leading-5 text-text-muted md:col-span-2">
              正式车卡会覆盖身份、性别、年龄、外观、动机、属性、技能、资源、物品、行动、次数与冷却；世界资料只提供叙事依据，数值映射单独审查。
            </p>
          </>
        )}
        {step === 5 && (
          <>
            <label className={labelClass}>
              结构
              <select
                className={inputClass}
                value={value.structure}
                onChange={(event) =>
                  patch({
                    structure: event.target.value as typeof value.structure,
                  })
                }
              >
                <option value="linear">线性</option>
                <option value="branching">分支</option>
                <option value="node-based">节点图</option>
                <option value="sandbox">沙盒</option>
              </select>
            </label>
            <label className={labelClass}>
              场景 / 任务 / 结局
              <div className="grid grid-cols-3 gap-2">
                <input
                  aria-label="目标场景数"
                  type="number"
                  min={1}
                  max={1000}
                  className={inputClass}
                  value={value.targetSceneCount}
                  onChange={(event) =>
                    patch({ targetSceneCount: Number(event.target.value) })
                  }
                />
                <input
                  aria-label="目标任务数"
                  type="number"
                  min={1}
                  max={100}
                  className={inputClass}
                  value={value.targetQuestCount}
                  onChange={(event) =>
                    patch({ targetQuestCount: Number(event.target.value) })
                  }
                />
                <input
                  aria-label="目标结局数"
                  type="number"
                  min={1}
                  max={100}
                  className={inputClass}
                  value={value.targetEndingCount}
                  onChange={(event) =>
                    patch({ targetEndingCount: Number(event.target.value) })
                  }
                />
              </div>
            </label>
            <label className={labelClass}>
              关键线索冗余路径
              <input
                type="number"
                min={1}
                max={10}
                className={inputClass}
                value={value.clueRedundancy}
                onChange={(event) =>
                  patch({ clueRedundancy: Number(event.target.value) })
                }
              />
            </label>
            <div className="space-y-2">
              {boolean("失败也推进剧情并产生明确代价", "failForward")}
              {boolean("允许脱离主线自由探索", "freeRoam")}
            </div>
          </>
        )}
        {step === 6 && (
          <>
            <div className="space-y-2">
              {boolean("角色私人频道", "characterPrivateChannels")}
              {boolean("KP 秘密与准备信息", "gmSecrets")}
              {boolean("隐藏 NPC 内部状态", "hiddenNpcState")}
              {boolean("玩家之间可私聊", "interPlayerWhispers")}
              {boolean("所有揭示保留审计轨迹", "revealAuditTrail")}
            </div>
            <label className={labelClass}>
              暗骰策略
              <select
                className={inputClass}
                value={value.hiddenDice}
                onChange={(event) =>
                  patch({
                    hiddenDice: event.target.value as typeof value.hiddenDice,
                  })
                }
              >
                <option value="never">不允许暗骰</option>
                <option value="gm-only">仅 KP 可暗骰</option>
                <option value="allowed">按桌规允许</option>
              </select>
            </label>
            <label className={labelClass}>
              Lines · 禁止出现
              <textarea
                rows={4}
                className={inputClass}
                value={value.linesText}
                onChange={(event) => patch({ linesText: event.target.value })}
                placeholder="每行一项"
              />
            </label>
            <label className={labelClass}>
              Veils · 淡出处理
              <textarea
                rows={4}
                className={inputClass}
                value={value.veilsText}
                onChange={(event) => patch({ veilsText: event.target.value })}
                placeholder="每行一项"
              />
            </label>
            <div className="space-y-2">
              {boolean("必须进行 Session Zero", "sessionZeroRequired")}
              {boolean("开放离桌，无需解释", "openDoor")}
            </div>
            <label className={labelClass}>
              暂停信号
              <input
                className={inputClass}
                value={value.pauseSignal}
                onChange={(event) => patch({ pauseSignal: event.target.value })}
              />
            </label>
          </>
        )}
        {step === 7 && (
          <>
            <label className={`${labelClass} md:col-span-2`}>
              统一视觉风格
              <textarea
                rows={3}
                className={inputClass}
                value={value.visualStyle}
                onChange={(event) => patch({ visualStyle: event.target.value })}
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2 md:col-span-2 lg:grid-cols-4">
              {boolean("场景图", "sceneImages")}
              {boolean("角色立绘", "characterPortraits")}
              {boolean("立绘表情", "characterExpressions")}
              {boolean("物品图标", "itemIcons")}
              {boolean("可揭示讲义", "handouts")}
              {boolean("地图", "maps")}
              {boolean("棋子 / Token", "tokens")}
            </div>
            <label className={labelClass}>
              生成时机
              <select
                className={inputClass}
                value={value.generationTiming}
                onChange={(event) =>
                  patch({
                    generationTiming: event.target
                      .value as typeof value.generationTiming,
                  })
                }
              >
                <option value="prebuild">开团前全部生成</option>
                <option value="background-during-play">游玩中后台生成</option>
                <option value="hybrid">核心预生成 + 后台补充</option>
              </select>
            </label>
            <label className={labelClass}>
              最大生成素材数
              <input
                type="number"
                min={mediaCount ? 1 : 0}
                max={10000}
                className={inputClass}
                value={value.maximumGeneratedAssets}
                onChange={(event) =>
                  patch({ maximumGeneratedAssets: Number(event.target.value) })
                }
              />
            </label>
            <p className="text-[10px] leading-5 text-text-muted md:col-span-2">
              每类素材必须有文字
              fallback；后台生成失败不会阻断规则结算或丢失行动。
            </p>
          </>
        )}
        {step === 8 && (
          <>
            <div className="grid gap-2 text-[10px] text-text-muted md:col-span-2 sm:grid-cols-2">
              <span>
                规则：{value.ruleOrigin}{" "}
                {value.actionsPerTurn != null ||
                value.reactionsPerRound != null ||
                value.initiativeDiceSides != null
                  ? "· 含村规"
                  : "· 原版"}
              </span>
              <span>
                桌型：{value.gmMode} KP · {value.seats.length} 席
              </span>
              <span>
                剧情：{value.structure} · {value.targetSceneCount} 场景 ·{" "}
                {value.targetEndingCount} 结局
              </span>
              <span>
                媒资：{mediaCount} 类 · 上限 {value.maximumGeneratedAssets}
              </span>
            </div>
            <label className="flex items-start gap-2 rounded border border-border bg-bg-base p-3 text-[10px] leading-5 text-text-muted md:col-span-2">
              <input
                type="checkbox"
                checked={value.confirmAll}
                onChange={(event) =>
                  patch({ confirmAll: event.target.checked })
                }
                className="mt-1"
              />
              <span>
                <strong className="block text-xs text-text-primary">
                  确认世界边界、数值映射、规则授权、AI 参与和媒资权利
                </strong>
                我理解世界 Canon
                与游戏状态分离；确认规则数值映射可审查，所选规则许可允许本用途，真人玩家会知晓
                AI 身份，生成或导入素材具有相应使用权。
              </span>
            </label>
            {!value.confirmAll && (
              <p className="text-[10px] text-error md:col-span-2">
                未确认时 Brief 会保持 consulting，不能授权创建 Build。
              </p>
            )}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-between">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          className="rounded border border-border px-3 py-2 text-[10px] disabled:opacity-30"
        >
          上一步
        </button>
        <button
          type="button"
          disabled={step === STEPS.length - 1}
          onClick={() =>
            setStep((current) => Math.min(STEPS.length - 1, current + 1))
          }
          className="rounded border border-accent/40 bg-accent/10 px-3 py-2 text-[10px] text-accent disabled:opacity-30"
        >
          下一步
        </button>
      </div>
    </section>
  );
}
