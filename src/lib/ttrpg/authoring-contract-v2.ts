import { parseTtrpgSettingsV1, type TtrpgAuthoringSettingsV1 } from "./authoring-contract";
import { createDefaultTtrpgProductionWizardValueV2 } from "./authoring-settings";
import type { TtrpgOpenAuthoringV1 } from "./open-contract";
import { parseTtrpgOpenAuthoringV1 } from "./open-contract-parse";

type CommonSettings = Pick<TtrpgAuthoringSettingsV1,
  "wizard" | "openingSituation" | "playerRole" | "qualityProfile">;

/** Work-owned draft. Revision and remappable rule IDs remain in the existing row. */
export type TtrpgAuthoringSettingsV2 = CommonSettings & {
  schema: "storyforge.ttrpg-authoring-settings";
  version: 2;
} & (
  | { runFormat: "scripted"; openAuthoring: null }
  | { runFormat: "open"; openAuthoring: TtrpgOpenAuthoringV1 }
);

export function defaultTtrpgSettingsV2(
  runFormat: "scripted" | "open" = "scripted",
): TtrpgAuthoringSettingsV2 {
  const common: CommonSettings & { schema: "storyforge.ttrpg-authoring-settings"; version: 2 } = {
    schema: "storyforge.ttrpg-authoring-settings",
    version: 2,
    wizard: createDefaultTtrpgProductionWizardValueV2(),
    openingSituation: "",
    playerRole: "",
    qualityProfile: "prototype",
  };
  if (runFormat === "scripted") return { ...common, runFormat, openAuthoring: null };
  return {
    ...common,
    runFormat,
    openAuthoring: {
      factPolicy: [],
      situationTemplates: [],
      openingSituationKeys: [],
      effectPlanTemplates: [],
      pressure: { clocks: [], fronts: [] },
      companionPolicy: null,
      stageClosurePolicy: null,
      dynamicEntityTemplates: [],
      runtimePolicy: null,
    },
  };
}

export function parseTtrpgAuthoringSettingsV2(input: unknown): TtrpgAuthoringSettingsV2 {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("跑团 Settings V2 必须是对象");
  const row = input as Record<string, unknown>;
  const fields = [
    "schema", "version", "runFormat", "wizard", "openingSituation",
    "playerRole", "qualityProfile", "openAuthoring",
  ];
  if (Object.keys(row).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.prototype.hasOwnProperty.call(row, key)))
    throw new Error("跑团 Settings V2 含未知字段或缺少必填字段");
  if (row.schema !== "storyforge.ttrpg-authoring-settings" || row.version !== 2)
    throw new Error("跑团 Settings schema/version 无效");
  if (row.runFormat !== "scripted" && row.runFormat !== "open")
    throw new Error("跑团 Settings runFormat 无效");
  const common = parseTtrpgSettingsV1({
    wizard: row.wizard,
    openingSituation: row.openingSituation,
    playerRole: row.playerRole,
    qualityProfile: row.qualityProfile,
  });
  const wizard = common.wizard;
  if (wizard.savedRulePackId !== null &&
    (!Number.isSafeInteger(wizard.savedRulePackId) || wizard.savedRulePackId < 1))
    throw new Error("跑团 Settings 规则引用无效");
  for (const value of Object.values(wizard))
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw new Error("跑团 Settings 数量必须为安全整数");
  for (const seat of wizard.seats) {
    if (!["human", "ai", "open"].includes(seat.controller) ||
      !["player", "assistant-gm"].includes(seat.role) ||
      !["world-template", "manual", "ai-generated", "quick-card"].includes(seat.characterMode) ||
      (seat.rankTier !== null && !["D", "C", "B", "A"].includes(seat.rankTier)))
      throw new Error("跑团 Settings 席位选项无效");
    if (seat.sourceCharacterResourceKey !== null && typeof seat.sourceCharacterResourceKey !== "string")
      throw new Error("跑团 Settings 角色来源必须是 resource key");
  }
  const base = {
    ...common,
    schema: "storyforge.ttrpg-authoring-settings" as const,
    version: 2 as const,
  };
  if (row.runFormat === "scripted") {
    if (row.openAuthoring !== null)
      throw new Error("scripted Settings 的 openAuthoring 必须为 null");
    return { ...base, runFormat: "scripted", openAuthoring: null };
  }
  return { ...base, runFormat: "open", openAuthoring: parseTtrpgOpenAuthoringV1(row.openAuthoring) };
}
