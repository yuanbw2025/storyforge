import { db } from "../db/schema";
import {
  hashProductProductionValueV2,
  isSha256Hash,
} from "../product-production/hash";
import type {
  RulePackV1,
  TtrpgHouseRuleDiffV2,
  TtrpgHouseRuleOverlayV2,
  TtrpgProductionBriefV2,
  TtrpgProductionSeatV2,
  WorkspaceScope,
  ProductWorldSourceSelectionV1,
} from "../types";
import { assertRecordInScope, resolveScope } from "../workspace/scope";
import {
  applyTtrpgHouseRuleOverlayV2,
  parseTtrpgHouseRuleOverlayV2,
} from "./house-rule";
import { createRankLiteRulePackV1 } from "./rank-lite-rule-pack";
import { createD20FantasyRulePackV1 } from "./d20-fantasy-rule-pack";
import { createD100InvestigationRulePackV1 } from "./d100-investigation-rule-pack";
import { parseRulePackV1, runRulePackFixturesV1 } from "./rule-pack";
import { createStoryForgeRulePackV1 } from "./storyforge-rule-pack";
import {
  createAuthorGuidedTtrpgCampaignDesignV2,
  parseTtrpgCampaignDesignV2,
} from "./campaign-proposal";

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function fail(message: string): never {
  throw new Error(`[ttrpg-production-brief] ${message}`);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, index) => key !== actual[index])
  ) {
    fail(`${label} 字段不精确:${actual.join(",")}`);
  }
}
function text(
  value: unknown,
  label: string,
  maximum = 10_000,
  allowEmpty = false,
): string {
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const parsed = value.trim().normalize("NFC");
  if ((!allowEmpty && !parsed) || parsed.length > maximum)
    fail(`${label} 为空或过长`);
  return parsed;
}
function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200);
  if (!STABLE_KEY.test(parsed)) fail(`${label} 不是稳定 key`);
  return parsed;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} 必须是 boolean`);
  return value;
}
function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    fail(`${label} 必须是 ${minimum}～${maximum} 的整数`);
  }
  return Number(value);
}
function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    fail(`${label} 枚举无效`);
  return value as T;
}
function texts(value: unknown, label: string, maximumItems = 100): string[] {
  if (!Array.isArray(value) || value.length > maximumItems)
    fail(`${label} 必须是有界数组`);
  const parsed = value.map((item, index) =>
    text(item, `${label}[${index}]`, 2_000),
  );
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`);
  return parsed;
}
function nullableId(value: unknown, label: string): number | null {
  return value === null
    ? null
    : integer(value, label, 1, Number.MAX_SAFE_INTEGER);
}
function nullableWorldResourceKey(value: unknown, label: string): string | null {
  if (value === null) return null;
  const resourceKey = text(value, label, 1_000);
  if (!resourceKey.startsWith("world-release:") || /\s/.test(resourceKey))
    fail(`${label} 不是中立世界资源 key`);
  return resourceKey;
}
function nullableTier(
  value: unknown,
  label: string,
): TtrpgProductionSeatV2["rankTier"] {
  return value === null
    ? null
    : enumValue<TtrpgProductionSeatV2["rankTier"] & string>(
        value,
        ["D", "C", "B", "A"],
        label,
      );
}

function parseSeat(value: unknown, index: number): TtrpgProductionSeatV2 {
  const label = `table.seats[${index}]`;
  const row = record(value, label);
  exact(
    row,
    [
      "seatKey",
      "label",
      "controller",
      "role",
      "characterMode",
      "sourceCharacterResourceKey",
      "characterName",
      "rankTier",
      "privateGoal",
    ],
    label,
  );
  const characterMode = enumValue(
    row.characterMode,
    ["world-template", "quick-card", "manual", "ai-generated"],
    `${label}.characterMode`,
  );
  const sourceCharacterResourceKey = nullableWorldResourceKey(
    row.sourceCharacterResourceKey,
    `${label}.sourceCharacterResourceKey`,
  );
  const rankTier = nullableTier(row.rankTier, `${label}.rankTier`);
  if (characterMode === "world-template" && sourceCharacterResourceKey === null)
    fail(`${label} 世界模板缺少世界资源 key`);
  if (characterMode !== "world-template" && sourceCharacterResourceKey !== null)
    fail(`${label} 非世界模板不得绑定世界资源 key`);
  if (characterMode === "quick-card" && rankTier === null)
    fail(`${label} 快速卡缺少阶位`);
  if (characterMode !== "quick-card" && rankTier !== null)
    fail(`${label} 非快速卡不得声明阶位`);
  return {
    seatKey: key(row.seatKey, `${label}.seatKey`),
    label: text(row.label, `${label}.label`, 200),
    controller: enumValue(
      row.controller,
      ["human", "ai", "open"],
      `${label}.controller`,
    ),
    role: enumValue(row.role, ["player", "assistant-gm"], `${label}.role`),
    characterMode,
    sourceCharacterResourceKey,
    characterName: text(row.characterName, `${label}.characterName`, 300, true),
    rankTier,
    privateGoal: text(row.privateGoal, `${label}.privateGoal`, 2_000, true),
  };
}

function parseHouseRuleDiff(value: unknown): TtrpgHouseRuleDiffV2[] {
  if (!Array.isArray(value) || value.length > 100)
    fail("rules.houseRuleDiff 必须是有界数组");
  return value.map((item, index) => {
    const row = record(item, `rules.houseRuleDiff[${index}]`);
    exact(
      row,
      ["patchKey", "path", "before", "after", "reason"],
      `rules.houseRuleDiff[${index}]`,
    );
    if (
      !["string", "number"].includes(typeof row.before) ||
      !["string", "number"].includes(typeof row.after) ||
      typeof row.before !== typeof row.after
    )
      fail(`rules.houseRuleDiff[${index}] 值类型无效`);
    return {
      patchKey: key(row.patchKey, `rules.houseRuleDiff[${index}].patchKey`),
      path: text(row.path, `rules.houseRuleDiff[${index}].path`, 300),
      before: row.before as string | number,
      after: row.after as string | number,
      reason: text(row.reason, `rules.houseRuleDiff[${index}].reason`, 2_000),
    };
  });
}

/** Strict closed parser used by Brief persistence, planning and production. */
export function parseTtrpgProductionBriefV2(
  value: unknown,
): TtrpgProductionBriefV2 {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      fail("内容不是合法 JSON");
    }
  }
  const row = record(candidate, "brief");
  const rootFields = [
      "schema",
      "version",
      "creationMode",
      "naturalLanguageInstruction",
      "campaign",
      "campaignDesign",
      "rules",
      "table",
      "characters",
      "story",
      "information",
      "safety",
      "media",
      "confirmations",
    ];
  exact(row, rootFields, "brief");
  if (row.schema !== "storyforge.ttrpg-production-brief" || row.version !== 2)
    fail("schema/version 无效");

  const campaign = record(row.campaign, "campaign");
  exact(
    campaign,
    [
      "title",
      "premise",
      "background",
      "coreConflict",
      "genreTags",
      "tone",
      "difficulty",
      "targetSessions",
      "targetSessionMinutes",
    ],
    "campaign",
  );
  const rules = record(row.rules, "rules");
  exact(
    rules,
    [
      "origin",
      "rulePackRecordId",
      "ruleSystemId",
      "ruleSystemVersion",
      "baseContentHash",
      "effectiveContentHash",
      "houseRuleOverlay",
      "houseRuleDiff",
    ],
    "rules",
  );
  const origin = enumValue(
    rules.origin,
    [
      "builtin-storyforge",
      "builtin-rank-lite",
      "builtin-d20-fantasy",
      "builtin-d100-investigation",
      "saved-rule-pack",
    ],
    "rules.origin",
  );
  const rulePackRecordId = nullableId(
    rules.rulePackRecordId,
    "rules.rulePackRecordId",
  );
  if ((origin === "saved-rule-pack") !== (rulePackRecordId !== null))
    fail("saved-rule-pack 与 recordId 不闭合");
  if (
    !isSha256Hash(rules.baseContentHash) ||
    !isSha256Hash(rules.effectiveContentHash)
  )
    fail("rules hash 无效");
  const houseRuleOverlay =
    rules.houseRuleOverlay === null
      ? null
      : parseTtrpgHouseRuleOverlayV2(rules.houseRuleOverlay);
  const houseRuleDiff = parseHouseRuleDiff(rules.houseRuleDiff);
  if ((houseRuleOverlay === null) !== (houseRuleDiff.length === 0))
    fail("Overlay 与 diff 不闭合");
  if (
    houseRuleOverlay &&
    (houseRuleOverlay.baseContentHash !== rules.baseContentHash ||
      houseRuleOverlay.baseRuleSystemId !== rules.ruleSystemId ||
      houseRuleOverlay.baseRuleSystemVersion !== rules.ruleSystemVersion ||
      houseRuleOverlay.patches.length !== houseRuleDiff.length ||
      houseRuleOverlay.patches.some(
        (patch, index) => patch.patchKey !== houseRuleDiff[index]?.patchKey,
      ))
  ) {
    fail("Overlay、基线规则与 diff 不闭合");
  }
  if (!houseRuleOverlay && rules.baseContentHash !== rules.effectiveContentHash)
    fail("无村规时 effective hash 必须等于 base hash");

  const table = record(row.table, "table");
  exact(
    table,
    [
      "gmMode",
      "seats",
      "spectatorPolicy",
      "joinInProgress",
      "asynchronousPlay",
    ],
    "table",
  );
  if (
    !Array.isArray(table.seats) ||
    table.seats.length < 1 ||
    table.seats.length > 12
  )
    fail("table.seats 数量必须是 1～12");
  const seats = table.seats.map(parseSeat);
  if (new Set(seats.map((seat) => seat.seatKey)).size !== seats.length)
    fail("seatKey 重复");
  const worldSeatIds = seats.flatMap((seat) =>
    seat.sourceCharacterResourceKey == null ? [] : [seat.sourceCharacterResourceKey],
  );
  if (new Set(worldSeatIds).size !== worldSeatIds.length)
    fail("同一世界角色不能同时绑定多个席位");
  if (
    !seats.some((seat) => seat.role === "player" && seat.controller !== "open")
  )
    fail("至少需要一个已分配玩家席位");

  const characters = record(row.characters, "characters");
  exact(
    characters,
    [
      "defaultCreationMode",
      "allowCustomSheets",
      "allowAiGeneration",
      "requireGmApproval",
      "progressionMode",
      "startingLevelOrTier",
      "requiredProfileFields",
    ],
    "characters",
  );
  const allowAiGeneration = bool(
    characters.allowAiGeneration,
    "characters.allowAiGeneration",
  );
  if (
    !allowAiGeneration &&
    seats.some((seat) => seat.characterMode === "ai-generated")
  )
    fail("AI 车卡被禁用但席位仍请求 AI 生成");

  const story = record(row.story, "story");
  exact(
    story,
    [
      "structure",
      "openingScene",
      "targetSceneCount",
      "targetQuestCount",
      "clueRedundancy",
      "targetEndingCount",
      "failForward",
      "freeRoam",
      "canonMutationPolicy",
    ],
    "story",
  );
  const information = record(row.information, "information");
  exact(
    information,
    [
      "characterPrivateChannels",
      "gmSecrets",
      "hiddenNpcState",
      "hiddenDice",
      "interPlayerWhispers",
      "revealAuditTrail",
    ],
    "information",
  );
  const safety = record(row.safety, "safety");
  exact(
    safety,
    [
      "sessionZeroRequired",
      "consentChecklist",
      "lines",
      "veils",
      "contentWarnings",
      "pauseSignal",
      "openDoor",
    ],
    "safety",
  );
  const media = record(row.media, "media");
  exact(
    media,
    [
      "visualStyle",
      "sceneImages",
      "characterPortraits",
      "characterExpressions",
      "itemIcons",
      "handouts",
      "maps",
      "tokens",
      "generationTiming",
      "backgroundGeneration",
      "textFallback",
      "maximumGeneratedAssets",
    ],
    "media",
  );
  const generationTiming = enumValue(
    media.generationTiming,
    ["prebuild", "background-during-play", "hybrid"],
    "media.generationTiming",
  );
  const backgroundGeneration = bool(
    media.backgroundGeneration,
    "media.backgroundGeneration",
  );
  if (backgroundGeneration !== (generationTiming !== "prebuild"))
    fail("后台生成开关与 generationTiming 不一致");
  const mediaEnabled = [
    "sceneImages",
    "characterPortraits",
    "characterExpressions",
    "itemIcons",
    "handouts",
    "maps",
    "tokens",
  ].some((field) => media[field] === true);
  const maximumGeneratedAssets = integer(
    media.maximumGeneratedAssets,
    "media.maximumGeneratedAssets",
    0,
    10_000,
  );
  if (mediaEnabled !== maximumGeneratedAssets > 0)
    fail("媒资目标与最大生成数量不闭合");

  const confirmations = record(row.confirmations, "confirmations");
  exact(
    confirmations,
    [
      "worldCanonBoundary",
      "numericMappings",
      "ruleLicense",
      "aiParticipationDisclosure",
      "mediaRights",
    ],
    "confirmations",
  );
  const campaignDesign = parseTtrpgCampaignDesignV2(row.campaignDesign);
  return {
    schema: "storyforge.ttrpg-production-brief",
    version: 2,
    creationMode: enumValue(
      row.creationMode,
      ["quick", "advanced"],
      "creationMode",
    ),
    naturalLanguageInstruction: text(
      row.naturalLanguageInstruction,
      "naturalLanguageInstruction",
      20_000,
    ),
    campaign: {
      title: text(campaign.title, "campaign.title", 300),
      premise: text(campaign.premise, "campaign.premise", 5_000),
      background: text(campaign.background, "campaign.background", 10_000),
      coreConflict: text(campaign.coreConflict, "campaign.coreConflict", 5_000),
      genreTags: texts(campaign.genreTags, "campaign.genreTags", 30),
      tone: texts(campaign.tone, "campaign.tone", 30),
      difficulty: enumValue(
        campaign.difficulty,
        ["introductory", "standard", "challenging"],
        "campaign.difficulty",
      ),
      targetSessions: integer(
        campaign.targetSessions,
        "campaign.targetSessions",
        1,
        100,
      ),
      targetSessionMinutes: integer(
        campaign.targetSessionMinutes,
        "campaign.targetSessionMinutes",
        15,
        720,
      ),
    },
    campaignDesign,
    rules: {
      origin,
      rulePackRecordId,
      ruleSystemId: key(rules.ruleSystemId, "rules.ruleSystemId"),
      ruleSystemVersion: text(
        rules.ruleSystemVersion,
        "rules.ruleSystemVersion",
        100,
      ),
      baseContentHash: rules.baseContentHash as string,
      effectiveContentHash: rules.effectiveContentHash as string,
      houseRuleOverlay,
      houseRuleDiff,
    },
    table: {
      gmMode: enumValue(
        table.gmMode,
        ["human", "ai", "hybrid"],
        "table.gmMode",
      ),
      seats,
      spectatorPolicy: enumValue(
        table.spectatorPolicy,
        ["disabled", "public-only", "invited"],
        "table.spectatorPolicy",
      ),
      joinInProgress: bool(table.joinInProgress, "table.joinInProgress"),
      asynchronousPlay: bool(table.asynchronousPlay, "table.asynchronousPlay"),
    },
    characters: {
      defaultCreationMode: enumValue(
        characters.defaultCreationMode,
        ["world-template", "quick-card", "manual", "ai-generated"],
        "characters.defaultCreationMode",
      ),
      allowCustomSheets: bool(
        characters.allowCustomSheets,
        "characters.allowCustomSheets",
      ),
      allowAiGeneration,
      requireGmApproval: bool(
        characters.requireGmApproval,
        "characters.requireGmApproval",
      ),
      progressionMode: enumValue(
        characters.progressionMode,
        ["rule-native", "rank-lite", "none"],
        "characters.progressionMode",
      ),
      startingLevelOrTier: text(
        characters.startingLevelOrTier,
        "characters.startingLevelOrTier",
        100,
      ),
      requiredProfileFields: texts(
        characters.requiredProfileFields,
        "characters.requiredProfileFields",
        100,
      ),
    },
    story: {
      structure: enumValue(
        story.structure,
        ["linear", "branching", "node-based", "sandbox"],
        "story.structure",
      ),
      openingScene: text(story.openingScene, "story.openingScene", 5_000),
      targetSceneCount: integer(
        story.targetSceneCount,
        "story.targetSceneCount",
        1,
        1_000,
      ),
      targetQuestCount: integer(
        story.targetQuestCount,
        "story.targetQuestCount",
        1,
        100,
      ),
      clueRedundancy: integer(
        story.clueRedundancy,
        "story.clueRedundancy",
        1,
        10,
      ),
      targetEndingCount: integer(
        story.targetEndingCount,
        "story.targetEndingCount",
        1,
        100,
      ),
      failForward: bool(story.failForward, "story.failForward"),
      freeRoam: bool(story.freeRoam, "story.freeRoam"),
      canonMutationPolicy: enumValue(
        story.canonMutationPolicy,
        ["session-only", "author-review", "allow-world-candidates"],
        "story.canonMutationPolicy",
      ),
    },
    information: {
      characterPrivateChannels: bool(
        information.characterPrivateChannels,
        "information.characterPrivateChannels",
      ),
      gmSecrets: bool(information.gmSecrets, "information.gmSecrets"),
      hiddenNpcState: bool(
        information.hiddenNpcState,
        "information.hiddenNpcState",
      ),
      hiddenDice: enumValue(
        information.hiddenDice,
        ["never", "gm-only", "allowed"],
        "information.hiddenDice",
      ),
      interPlayerWhispers: bool(
        information.interPlayerWhispers,
        "information.interPlayerWhispers",
      ),
      revealAuditTrail: bool(
        information.revealAuditTrail,
        "information.revealAuditTrail",
      ),
    },
    safety: {
      sessionZeroRequired: bool(
        safety.sessionZeroRequired,
        "safety.sessionZeroRequired",
      ),
      consentChecklist: texts(
        safety.consentChecklist,
        "safety.consentChecklist",
        100,
      ),
      lines: texts(safety.lines, "safety.lines", 100),
      veils: texts(safety.veils, "safety.veils", 100),
      contentWarnings: texts(
        safety.contentWarnings,
        "safety.contentWarnings",
        100,
      ),
      pauseSignal: text(safety.pauseSignal, "safety.pauseSignal", 100),
      openDoor: bool(safety.openDoor, "safety.openDoor"),
    },
    media: {
      visualStyle: text(media.visualStyle, "media.visualStyle", 1_000),
      sceneImages: bool(media.sceneImages, "media.sceneImages"),
      characterPortraits: bool(
        media.characterPortraits,
        "media.characterPortraits",
      ),
      characterExpressions: bool(
        media.characterExpressions,
        "media.characterExpressions",
      ),
      itemIcons: bool(media.itemIcons, "media.itemIcons"),
      handouts: bool(media.handouts, "media.handouts"),
      maps: bool(media.maps, "media.maps"),
      tokens: bool(media.tokens, "media.tokens"),
      generationTiming,
      backgroundGeneration,
      textFallback: bool(media.textFallback, "media.textFallback"),
      maximumGeneratedAssets,
    },
    confirmations: {
      worldCanonBoundary: bool(
        confirmations.worldCanonBoundary,
        "confirmations.worldCanonBoundary",
      ),
      numericMappings: bool(
        confirmations.numericMappings,
        "confirmations.numericMappings",
      ),
      ruleLicense: bool(confirmations.ruleLicense, "confirmations.ruleLicense"),
      aiParticipationDisclosure: bool(
        confirmations.aiParticipationDisclosure,
        "confirmations.aiParticipationDisclosure",
      ),
      mediaRights: bool(confirmations.mediaRights, "confirmations.mediaRights"),
    },
  };
}

export interface TtrpgProductionBriefDraftInputV2 {
  creationMode?: TtrpgProductionBriefV2["creationMode"];
  naturalLanguageInstruction?: string;
  campaign?: Partial<TtrpgProductionBriefV2["campaign"]>;
  campaignDesign?: TtrpgProductionBriefV2["campaignDesign"];
  rules?: {
    origin?: TtrpgProductionBriefV2["rules"]["origin"];
    savedRulePackId?: number | null;
    houseRulePatches?: Array<{
      path: string;
      value: string | number;
      reason: string;
    }>;
    overlayTitle?: string;
  };
  gmMode?: TtrpgProductionBriefV2["table"]["gmMode"];
  playerCount?: number;
  seats?: TtrpgProductionSeatV2[];
  table?: Partial<Omit<TtrpgProductionBriefV2["table"], "gmMode" | "seats">>;
  characters?: Partial<TtrpgProductionBriefV2["characters"]>;
  story?: Partial<TtrpgProductionBriefV2["story"]>;
  information?: Partial<TtrpgProductionBriefV2["information"]>;
  safety?: Partial<TtrpgProductionBriefV2["safety"]>;
  media?: Partial<TtrpgProductionBriefV2["media"]>;
  confirmations?: Partial<TtrpgProductionBriefV2["confirmations"]>;
}

function defaultSeats(input: {
  playerCount: number;
  selection: ProductWorldSourceSelectionV1;
  defaultMode: TtrpgProductionSeatV2["characterMode"];
}): TtrpgProductionSeatV2[] {
  return Array.from({ length: input.playerCount }, (_, index) => {
    const resourceKey = input.selection.roleBindings.participants?.[index] ?? null;
    const worldTemplate = resourceKey !== null;
    const characterMode = worldTemplate
      ? "world-template"
      : input.defaultMode === "world-template"
        ? "ai-generated"
        : input.defaultMode;
    return {
      seatKey: `player.${index + 1}`,
      label: `玩家 ${index + 1}`,
      controller: index === 0 ? ("human" as const) : ("ai" as const),
      role: "player" as const,
      characterMode,
      sourceCharacterResourceKey: worldTemplate ? resourceKey : null,
      characterName: worldTemplate ? `世界角色 ${index + 1}` : "",
      rankTier: characterMode === "quick-card" ? ("C" as const) : null,
      privateGoal: "",
    };
  });
}

async function resolveRulePack(input: {
  scope: WorkspaceScope;
  rules?: TtrpgProductionBriefDraftInputV2["rules"];
}): Promise<{
  origin: TtrpgProductionBriefV2["rules"]["origin"];
  recordId: number | null;
  base: RulePackV1;
  baseHash: string;
}> {
  const origin = input.rules?.origin ?? "builtin-storyforge";
  if (origin !== "saved-rule-pack") {
    const base =
      origin === "builtin-rank-lite"
        ? createRankLiteRulePackV1()
        : origin === "builtin-d20-fantasy"
          ? createD20FantasyRulePackV1()
          : origin === "builtin-d100-investigation"
            ? createD100InvestigationRulePackV1()
            : createStoryForgeRulePackV1();
    return {
      origin,
      recordId: null,
      base,
      baseHash: await hashProductProductionValueV2(base),
    };
  }
  const id = input.rules?.savedRulePackId;
  if (!Number.isInteger(id) || Number(id) < 1)
    fail("saved-rule-pack 缺少 rulePackRecordId");
  const scope = await resolveScope({ scope: input.scope });
  const row = await db.ttrpgRulePacks.get(Number(id));
  if (
    !row ||
    !(await assertRecordInScope(scope, "ttrpgRulePacks", row, { owner: "work" }))
  )
    fail("RulePack 不存在或跨 Work");
  if (row.status !== "validated") fail("只允许使用 validated RulePack");
  const base = parseRulePackV1(row.rulePackJson);
  runRulePackFixturesV1(base);
  const baseHash = await hashProductProductionValueV2(base);
  if (baseHash !== row.contentHash) fail("保存的 RulePack hash 已漂移");
  return { origin, recordId: row.id!, base, baseHash };
}

/** Re-resolve and verify the exact effective RulePack frozen by a saved Brief. */
export async function resolveTtrpgProductionRulePackV2(input: {
  scope: WorkspaceScope;
  brief: TtrpgProductionBriefV2;
}): Promise<RulePackV1> {
  const brief = parseTtrpgProductionBriefV2(input.brief);
  const resolved = await resolveRulePack({
    scope: input.scope,
    rules: {
      origin: brief.rules.origin,
      savedRulePackId: brief.rules.rulePackRecordId,
    },
  });
  if (
    resolved.base.ruleSystemId !== brief.rules.ruleSystemId ||
    resolved.base.ruleSystemVersion !== brief.rules.ruleSystemVersion ||
    resolved.baseHash !== brief.rules.baseContentHash
  )
    fail("Brief 的基础 RulePack 已漂移");
  if (!brief.rules.houseRuleOverlay) {
    if (brief.rules.effectiveContentHash !== resolved.baseHash)
      fail("Brief 的有效 RulePack hash 无效");
    return resolved.base;
  }
  const applied = await applyTtrpgHouseRuleOverlayV2({
    baseRulePack: resolved.base,
    overlay: brief.rules.houseRuleOverlay,
  });
  if (
    applied.contentHash !== brief.rules.effectiveContentHash ||
    JSON.stringify(applied.diff) !== JSON.stringify(brief.rules.houseRuleDiff)
  ) {
    fail("Brief 的村规结果已漂移");
  }
  return applied.rulePack;
}

/** Deterministically compile the nine-step author choices into a frozen contract. */
export async function compileTtrpgProductionBriefV2(input: {
  scope: WorkspaceScope;
  selection: ProductWorldSourceSelectionV1;
  worldContentHash: string;
  title: string;
  premise: string;
  tone: string[];
  scale: {
    targetPlayMinutes: number;
    targetEndingCount: number;
    scope: string;
  };
  contentBoundaries: string[];
  confirmDefaultMappings: boolean;
  draft?: TtrpgProductionBriefDraftInputV2;
}): Promise<TtrpgProductionBriefV2> {
  const draft = input.draft ?? {};
  const resolved = await resolveRulePack({
    scope: input.scope,
    rules: draft.rules,
  });
  const rawPatches = draft.rules?.houseRulePatches ?? [];
  let effectivePack = resolved.base;
  let effectiveHash = resolved.baseHash;
  let overlay: TtrpgHouseRuleOverlayV2 | null = null;
  let diff: TtrpgHouseRuleDiffV2[] = [];
  if (rawPatches.length) {
    overlay = parseTtrpgHouseRuleOverlayV2({
      schema: "storyforge.ttrpg-house-rule-overlay",
      version: 2,
      overlayKey: `brief.overlay.${resolved.base.ruleSystemId.replace(/[^A-Za-z0-9._:-]/g, "-")}`,
      title: draft.rules?.overlayTitle?.trim() || "本团村规",
      author: "StoryForge 作者",
      baseRuleSystemId: resolved.base.ruleSystemId,
      baseRuleSystemVersion: resolved.base.ruleSystemVersion,
      baseContentHash: resolved.baseHash,
      patches: rawPatches.map((patch, index) => ({
        patchKey: `patch.${index + 1}`,
        operation: "replace" as const,
        path: patch.path,
        value: patch.value,
        reason: patch.reason,
      })),
    });
    const applied = await applyTtrpgHouseRuleOverlayV2({
      baseRulePack: resolved.base,
      overlay,
    });
    effectivePack = applied.rulePack;
    effectiveHash = applied.contentHash;
    diff = applied.diff;
  }
  runRulePackFixturesV1(effectivePack);

  const defaultCreationMode =
    draft.characters?.defaultCreationMode ?? "ai-generated";
  const playerCount =
    draft.playerCount ??
    Math.max(1, Math.min(4, input.selection.roleBindings.participants?.length || 1));
  const seats =
    draft.seats ??
    defaultSeats({
      playerCount,
      selection: input.selection,
      defaultMode: defaultCreationMode,
    });
  const hasAi =
    (draft.gmMode ?? "ai") !== "human" ||
    seats.some((seat) => seat.controller === "ai");
  const mediaTargets = draft.media ?? {};
  const anyMedia = [
    "sceneImages",
    "characterPortraits",
    "characterExpressions",
    "itemIcons",
    "handouts",
    "maps",
    "tokens",
  ].some(
    (keyName) => mediaTargets[keyName as keyof typeof mediaTargets] === true,
  );
  const generationTiming =
    mediaTargets.generationTiming ?? (anyMedia ? "hybrid" : "prebuild");
  const confirmed = input.confirmDefaultMappings;
  const targetSessions = Math.max(
    1,
    Math.ceil(input.scale.targetPlayMinutes / 180),
  );
  const targetSceneCount =
    input.scale.scope === "campaign"
      ? 16
      : input.scale.scope === "multi-chapter"
        ? 10
        : input.scale.scope === "chapter"
          ? 6
          : input.scale.scope === "short-arc"
            ? 4
            : 2;
  const campaignTitle = draft.campaign?.title ?? input.title;
  const campaignPremise = draft.campaign?.premise ?? input.premise;
  const campaignBackground = draft.campaign?.background
    ?? "严格基于冻结 WorldRelease 展开，不把产品生成内容反写为世界 Canon。";
  const campaignCoreConflict = draft.campaign?.coreConflict ?? input.premise;
  const campaignStructure = draft.story?.structure ?? "node-based";
  const campaignDesign = draft.campaignDesign ?? (() => {
    const generated = createAuthorGuidedTtrpgCampaignDesignV2({
      sourceWorldContentHash: input.worldContentHash,
      title: campaignTitle,
      background: campaignBackground,
      coreConflict: campaignCoreConflict,
      opening: draft.story?.openingScene ?? input.premise,
      structure: campaignStructure,
      sourceRefs: [
        `world:${input.selection.worldReferenceHash}`,
        ...(input.selection.roleBindings.participants ?? []),
        ...(input.selection.roleBindings.locations ?? []),
        ...(input.selection.roleBindings.quests ?? []),
      ],
    });
    generated.selection.confirmed = confirmed;
    return parseTtrpgCampaignDesignV2(generated);
  })();
  if (campaignDesign.sourceWorldContentHash !== input.worldContentHash) fail("战役提案来源与冻结世界不一致");
  return parseTtrpgProductionBriefV2({
    schema: "storyforge.ttrpg-production-brief",
    version: 2,
    creationMode: draft.creationMode ?? "quick",
    naturalLanguageInstruction:
      draft.naturalLanguageInstruction?.trim() ||
      `请依据冻结 WorldRelease 制作跑团：${input.premise}`,
    campaign: {
      title: campaignTitle,
      premise: campaignPremise,
      background: campaignBackground,
      coreConflict: campaignCoreConflict,
      genreTags: draft.campaign?.genreTags ?? ["世界引擎衍生", "角色驱动"],
      tone: draft.campaign?.tone ?? input.tone,
      difficulty: draft.campaign?.difficulty ?? "standard",
      targetSessions: draft.campaign?.targetSessions ?? targetSessions,
      targetSessionMinutes:
        draft.campaign?.targetSessionMinutes ??
        Math.min(
          240,
          Math.max(
            30,
            Math.round(input.scale.targetPlayMinutes / targetSessions),
          ),
        ),
    },
    campaignDesign,
    rules: {
      origin: resolved.origin,
      rulePackRecordId: resolved.recordId,
      ruleSystemId: resolved.base.ruleSystemId,
      ruleSystemVersion: resolved.base.ruleSystemVersion,
      baseContentHash: resolved.baseHash,
      effectiveContentHash: effectiveHash,
      houseRuleOverlay: overlay,
      houseRuleDiff: diff,
    },
    table: {
      gmMode: draft.gmMode ?? "ai",
      seats,
      spectatorPolicy: draft.table?.spectatorPolicy ?? "public-only",
      joinInProgress: draft.table?.joinInProgress ?? true,
      asynchronousPlay: draft.table?.asynchronousPlay ?? false,
    },
    characters: {
      defaultCreationMode,
      allowCustomSheets: draft.characters?.allowCustomSheets ?? true,
      allowAiGeneration: draft.characters?.allowAiGeneration ?? true,
      requireGmApproval: draft.characters?.requireGmApproval ?? true,
      progressionMode:
        draft.characters?.progressionMode ??
        (resolved.origin === "builtin-rank-lite" ? "rank-lite" : "rule-native"),
      startingLevelOrTier:
        draft.characters?.startingLevelOrTier ??
        (resolved.origin === "builtin-rank-lite"
          ? "C"
          : resolved.origin === "builtin-d20-fantasy"
            ? "1"
            : "规则默认"),
      requiredProfileFields: draft.characters?.requiredProfileFields ?? [
        "姓名",
        "性别",
        "年龄",
        "身份",
        "外观",
        "动机",
        "属性",
        "技能",
        "资源",
        "物品",
        "行动",
      ],
    },
    story: {
      structure: campaignStructure,
      openingScene: draft.story?.openingScene ?? input.premise,
      targetSceneCount: draft.story?.targetSceneCount ?? targetSceneCount,
      targetQuestCount:
        draft.story?.targetQuestCount ??
        Math.max(1, Math.ceil(targetSceneCount / 4)),
      clueRedundancy: draft.story?.clueRedundancy ?? 3,
      targetEndingCount:
        draft.story?.targetEndingCount ?? input.scale.targetEndingCount,
      failForward: draft.story?.failForward ?? true,
      freeRoam: draft.story?.freeRoam ?? input.scale.scope === "campaign",
      canonMutationPolicy: draft.story?.canonMutationPolicy ?? "author-review",
    },
    information: {
      characterPrivateChannels:
        draft.information?.characterPrivateChannels ?? true,
      gmSecrets: draft.information?.gmSecrets ?? true,
      hiddenNpcState: draft.information?.hiddenNpcState ?? true,
      hiddenDice: draft.information?.hiddenDice ?? "gm-only",
      interPlayerWhispers: draft.information?.interPlayerWhispers ?? true,
      revealAuditTrail: draft.information?.revealAuditTrail ?? true,
    },
    safety: {
      sessionZeroRequired: draft.safety?.sessionZeroRequired ?? true,
      consentChecklist: draft.safety?.consentChecklist ?? [
        "主题与强度",
        "角色间冲突",
        "录制与回放",
        "AI 参与",
      ],
      lines: draft.safety?.lines ?? input.contentBoundaries,
      veils: draft.safety?.veils ?? [],
      contentWarnings: draft.safety?.contentWarnings ?? input.contentBoundaries,
      pauseSignal: draft.safety?.pauseSignal ?? "暂停",
      openDoor: draft.safety?.openDoor ?? true,
    },
    media: {
      visualStyle:
        mediaTargets.visualStyle ??
        "延续冻结世界的视觉语言，保证角色、场景和物品跨回合一致。",
      sceneImages: mediaTargets.sceneImages ?? anyMedia,
      characterPortraits: mediaTargets.characterPortraits ?? anyMedia,
      characterExpressions: mediaTargets.characterExpressions ?? false,
      itemIcons: mediaTargets.itemIcons ?? anyMedia,
      handouts: mediaTargets.handouts ?? anyMedia,
      maps: mediaTargets.maps ?? anyMedia,
      tokens: mediaTargets.tokens ?? anyMedia,
      generationTiming,
      backgroundGeneration: generationTiming !== "prebuild",
      textFallback: mediaTargets.textFallback ?? true,
      maximumGeneratedAssets:
        mediaTargets.maximumGeneratedAssets ?? (anyMedia ? 32 : 0),
    },
    confirmations: {
      worldCanonBoundary: draft.confirmations?.worldCanonBoundary ?? confirmed,
      numericMappings: draft.confirmations?.numericMappings ?? confirmed,
      ruleLicense: draft.confirmations?.ruleLicense ?? confirmed,
      aiParticipationDisclosure:
        draft.confirmations?.aiParticipationDisclosure ?? (!hasAi || confirmed),
      mediaRights: draft.confirmations?.mediaRights ?? (!anyMedia || confirmed),
    },
  });
}

export function unresolvedTtrpgProductionBriefDecisionsV2(
  brief: TtrpgProductionBriefV2,
): string[] {
  const parsed = parseTtrpgProductionBriefV2(brief);
  const unresolved: string[] = [];
  if (!parsed.campaignDesign.selection.confirmed)
    unresolved.push("ttrpg-campaign-proposal-selection");
  if (!parsed.confirmations.worldCanonBoundary)
    unresolved.push("ttrpg-world-canon-boundary");
  if (!parsed.confirmations.numericMappings)
    unresolved.push("ttrpg-default-rule-mappings");
  if (!parsed.confirmations.ruleLicense) unresolved.push("ttrpg-rule-license");
  const hasAi =
    parsed.table.gmMode !== "human" ||
    parsed.table.seats.some((seat) => seat.controller === "ai");
  if (hasAi && !parsed.confirmations.aiParticipationDisclosure)
    unresolved.push("ttrpg-ai-participation-disclosure");
  const hasMedia = parsed.media.maximumGeneratedAssets > 0;
  if (hasMedia && !parsed.confirmations.mediaRights)
    unresolved.push("ttrpg-media-rights");
  return unresolved;
}
