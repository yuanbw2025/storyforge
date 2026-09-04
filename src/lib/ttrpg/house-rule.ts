import type {
  RulePackV1,
  TtrpgHouseRuleDiffV2,
  TtrpgHouseRuleOverlayV2,
  TtrpgHouseRulePatchV2,
} from "../types";
import { hashProductProductionValueV2 } from "../product-production/hash";
import { parseRulePackV1, runRulePackFixturesV1 } from "./rule-pack";
import { resolveTtrpgResolutionV2 } from "./resolution";

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type {
  TtrpgHouseRuleDiffV2,
  TtrpgHouseRuleOverlayV2,
  TtrpgHouseRulePatchV2,
};

function fail(message: string): never {
  throw new Error(`[ttrpg-house-rule] ${message}`);
}

function key(value: unknown, label: string): string {
  if (typeof value !== "string" || !KEY.test(value.trim()))
    fail(`${label} 无效`);
  return value.trim();
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    fail(`${label} 无效`);
  return value.trim().normalize("NFC");
}

export function parseTtrpgHouseRuleOverlayV2(
  value: unknown,
): TtrpgHouseRuleOverlayV2 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Overlay 必须是对象");
  const row = value as Record<string, unknown>;
  const expected = [
    "schema",
    "version",
    "overlayKey",
    "title",
    "author",
    "baseRuleSystemId",
    "baseRuleSystemVersion",
    "baseContentHash",
    "patches",
  ];
  if (
    Object.keys(row).sort().join(",") !== expected.sort().join(",") ||
    row.schema !== "storyforge.ttrpg-house-rule-overlay" ||
    row.version !== 2 ||
    typeof row.baseContentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.baseContentHash) ||
    !Array.isArray(row.patches) ||
    !row.patches.length ||
    row.patches.length > 100
  )
    fail("Overlay 结构无效");
  const patches = row.patches.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      fail(`patches[${index}] 无效`);
    const patch = raw as Record<string, unknown>;
    if (
      Object.keys(patch).sort().join(",") !==
        "operation,patchKey,path,reason,value" ||
      patch.operation !== "replace" ||
      !["string", "number"].includes(typeof patch.value) ||
      (typeof patch.value === "number" && !Number.isFinite(patch.value))
    )
      fail(`patches[${index}] 结构无效`);
    const path = text(patch.path, `patches[${index}].path`, 300);
    if (
      !/^(diceModels|checks|actions|conditions|turnStructure|advancement)\./.test(
        path,
      )
    )
      fail(`patches[${index}] 路径不在村规白名单`);
    return {
      patchKey: key(patch.patchKey, `patches[${index}].patchKey`),
      operation: "replace" as const,
      path,
      value: patch.value as string | number,
      reason: text(patch.reason, `patches[${index}].reason`, 2_000),
    };
  });
  if (new Set(patches.map((patch) => patch.patchKey)).size !== patches.length)
    fail("patchKey 重复");
  if (new Set(patches.map((patch) => patch.path)).size !== patches.length)
    fail("同一路径存在冲突 patch");
  return {
    schema: "storyforge.ttrpg-house-rule-overlay",
    version: 2,
    overlayKey: key(row.overlayKey, "overlayKey"),
    title: text(row.title, "title", 300),
    author: text(row.author, "author", 200),
    baseRuleSystemId: key(row.baseRuleSystemId, "baseRuleSystemId"),
    baseRuleSystemVersion: text(
      row.baseRuleSystemVersion,
      "baseRuleSystemVersion",
      100,
    ),
    baseContentHash: row.baseContentHash,
    patches,
  };
}

function resolvePatchTarget(
  pack: RulePackV1,
  path: string,
): { parent: Record<string, unknown>; field: string } {
  const parts = path.split(".");
  const root = parts.shift()!;
  const scalar = (parent: object, field: string) => ({
    parent: parent as Record<string, unknown>,
    field,
  });
  if (
    root === "turnStructure" &&
    parts.length === 1 &&
    ["actionsPerTurn", "reactionsPerRound"].includes(parts[0])
  )
    return scalar(pack.turnStructure, parts[0]);
  if (
    root === "advancement" &&
    parts.length === 1 &&
    [
      "awardPerMilestone",
      "attributeIncreaseCost",
      "maximumAttributeValue",
    ].includes(parts[0])
  )
    return scalar(pack.advancement, parts[0]);
  if (parts.length < 2) fail(`村规路径无效:${path}`);
  const entityKey = parts.shift()!;
  const field = parts.join(".");
  if (root === "diceModels") {
    const row =
      pack.diceModels.find((item) => item.key === entityKey) ??
      fail(`未知骰型:${entityKey}`);
    if (!["count", "sides", "keep"].includes(field))
      fail(`骰型字段不可覆盖:${field}`);
    return scalar(row, field);
  }
  if (root === "checks") {
    const row =
      pack.checks.find((item) => item.key === entityKey) ??
      fail(`未知检定:${entityKey}`);
    if (
      [
        "defaultDifficulty",
        "criticalSuccessMargin",
        "criticalFailureMargin",
      ].includes(field) &&
      "targetMode" in row
    )
      return scalar(row, field);
    if (
      [
        "defaultDifficulty",
        "criticalSuccessMargin",
        "criticalFailureMargin",
      ].includes(field) &&
      "resolver" in row &&
      (row.resolver.mode === "total-vs-target" ||
        row.resolver.mode === "opposed")
    ) {
      return scalar(row.resolver, field);
    }
    if (field.startsWith("resolver.") && "resolver" in row) {
      const resolverField = field.slice("resolver.".length);
      if (
        ![
          "defaultDifficulty",
          "criticalSuccessMargin",
          "criticalFailureMargin",
          "partialSuccessWindow",
          "hardDivisor",
          "extremeDivisor",
          "criticalSuccessMaximum",
          "criticalFailureMinimum",
          "successAtOrAbove",
          "criticalAtOrAbove",
          "criticalBonusSuccesses",
          "botchAtOrBelow",
          "criticalSuccesses",
          "criticalFailureBotches",
        ].includes(resolverField)
      )
        fail(`检定 resolver 字段不可覆盖:${resolverField}`);
      return scalar(row.resolver, resolverField);
    }
    fail(`检定字段不可覆盖:${field}`);
  }
  if (root === "conditions") {
    const row =
      pack.conditions.find((item) => item.key === entityKey) ??
      fail(`未知状态:${entityKey}`);
    if (
      !["maximumStacks", "defaultDurationRounds", "checkModifier"].includes(
        field,
      )
    )
      fail(`状态字段不可覆盖:${field}`);
    return scalar(row, field);
  }
  if (root === "actions") {
    const row =
      pack.actions.find((item) => item.key === entityKey) ??
      fail(`未知行动:${entityKey}`);
    if (["costAmount", "phase"].includes(field)) return scalar(row, field);
    if (
      field.startsWith("usage.") &&
      ["maximum", "cost", "cooldownRounds"].includes(field.slice(6))
    )
      return scalar(row.usage, field.slice(6));
    fail(`行动字段不可覆盖:${field}`);
  }
  fail(`村规路径无效:${path}`);
}

export async function applyTtrpgHouseRuleOverlayV2(input: {
  baseRulePack: RulePackV1;
  overlay: TtrpgHouseRuleOverlayV2;
}): Promise<{
  rulePack: RulePackV1;
  contentHash: string;
  diff: TtrpgHouseRuleDiffV2[];
}> {
  const base = parseRulePackV1(input.baseRulePack);
  const overlay = parseTtrpgHouseRuleOverlayV2(input.overlay);
  const baseHash = await hashProductProductionValueV2(base);
  if (
    overlay.baseRuleSystemId !== base.ruleSystemId ||
    overlay.baseRuleSystemVersion !== base.ruleSystemVersion ||
    overlay.baseContentHash !== baseHash
  )
    fail("Overlay 基线规则或 hash 已变化");
  const next = structuredClone(base);
  const diff = overlay.patches.map((patch) => {
    const target = resolvePatchTarget(next, patch.path);
    const before = target.parent[target.field];
    if (
      !["string", "number"].includes(typeof before) ||
      typeof before !== typeof patch.value
    ) {
      fail(`patch 类型与原字段不一致:${patch.path}`);
    }
    target.parent[target.field] = patch.value;
    return {
      patchKey: patch.patchKey,
      path: patch.path,
      before: before as string | number,
      after: patch.value,
      reason: patch.reason,
    };
  });
  const rulePack = parseRulePackV1(next);
  runRulePackFixturesV1(rulePack);
  return {
    rulePack,
    contentHash: await hashProductProductionValueV2(rulePack),
    diff,
  };
}

export interface TtrpgCheckProbabilityPreviewV2 {
  method: "exact" | "normal-approximation";
  successProbability: number;
  criticalSuccessProbability: number;
  failureProbability: number;
  criticalFailureProbability: number;
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Exact preview for total-vs-target and d100 roll-under checks. */
export function previewTtrpgCheckProbabilityV2(input: {
  rulePack: RulePackV1;
  checkKey: string;
  attributeValue: number;
  situationalModifier?: number;
  difficulty?: number;
}): TtrpgCheckProbabilityPreviewV2 {
  const pack = parseRulePackV1(input.rulePack);
  const check =
    pack.checks.find((item) => item.key === input.checkKey) ??
    fail(`未知检定:${input.checkKey}`);
  const dice = pack.diceModels.find((item) => item.key === check.diceModelKey)!;
  const resolver =
    "resolver" in check
      ? check.resolver
      : {
          mode: "total-vs-target" as const,
          defaultDifficulty: check.defaultDifficulty,
          criticalSuccessMargin: check.criticalSuccessMargin,
          criticalFailureMargin: check.criticalFailureMargin,
          partialSuccessWindow: 0,
        };
  if (resolver.mode === "roll-under") {
    const difficulty =
      input.difficulty ??
      resolver.defaultDifficulty ??
      input.attributeValue + (input.situationalModifier ?? 0);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 100)
      fail("roll-under 预览阈值必须为 1～100");
    const buckets = {
      success: 0,
      criticalSuccess: 0,
      failure: 0,
      criticalFailure: 0,
    };
    for (let roll = 1; roll <= 100; roll += 1) {
      const hard = Math.max(1, Math.floor(difficulty / resolver.hardDivisor));
      const extreme = Math.max(
        1,
        Math.floor(difficulty / resolver.extremeDivisor),
      );
      const outcome = resolveTtrpgResolutionV2({
        mode: "roll-under",
        roll,
        successMaximum: difficulty,
        hardSuccessMaximum: hard,
        extremeSuccessMaximum: extreme,
        criticalSuccessMaximum: Math.min(
          resolver.criticalSuccessMaximum,
          extreme,
        ),
        criticalFailureMinimum: Math.max(
          resolver.criticalFailureMinimum,
          difficulty,
        ),
      });
      const probability = 0.01;
      if (outcome.succeeded) buckets.success += probability;
      else buckets.failure += probability;
      if (outcome.degree === "critical-success")
        buckets.criticalSuccess += probability;
      if (outcome.degree === "critical-failure")
        buckets.criticalFailure += probability;
    }
    return {
      method: "exact",
      successProbability: clampProbability(buckets.success),
      criticalSuccessProbability: clampProbability(buckets.criticalSuccess),
      failureProbability: clampProbability(buckets.failure),
      criticalFailureProbability: clampProbability(buckets.criticalFailure),
    };
  }
  if (resolver.mode !== "total-vs-target" && resolver.mode !== "opposed") {
    fail(`概率预览暂不支持 ${resolver.mode}`);
  }
  const modifier = input.attributeValue + (input.situationalModifier ?? 0);
  const difficulty = input.difficulty ?? resolver.defaultDifficulty;
  const classify = (total: number) =>
    total >= difficulty + resolver.criticalSuccessMargin
      ? "critical-success"
      : total >= difficulty
        ? "success"
        : total >= difficulty - resolver.partialSuccessWindow &&
            resolver.partialSuccessWindow > 0
          ? "partial-success"
          : total <= difficulty - resolver.criticalFailureMargin
            ? "critical-failure"
            : "failure";
  const totals = new Map<number, number>();
  let method: TtrpgCheckProbabilityPreviewV2["method"] = "exact";
  if (dice.keep === "all" && dice.count * dice.sides <= 2_000) {
    let distribution = new Map([[0, 1]]);
    for (let index = 0; index < dice.count; index += 1) {
      const next = new Map<number, number>();
      for (const [sum, probability] of distribution)
        for (let face = 1; face <= dice.sides; face += 1) {
          next.set(
            sum + face,
            (next.get(sum + face) ?? 0) + probability / dice.sides,
          );
        }
      distribution = next;
    }
    for (const [sum, probability] of distribution)
      totals.set(sum + modifier, probability);
  } else if (dice.keep !== "all") {
    for (let face = 1; face <= dice.sides; face += 1) {
      const cumulative =
        dice.keep === "highest"
          ? (face / dice.sides) ** dice.count
          : 1 - ((dice.sides - face) / dice.sides) ** dice.count;
      const previous =
        face === 1
          ? 0
          : dice.keep === "highest"
            ? ((face - 1) / dice.sides) ** dice.count
            : 1 - ((dice.sides - face + 1) / dice.sides) ** dice.count;
      totals.set(face + modifier, cumulative - previous);
    }
  } else {
    method = "normal-approximation";
    const mean = (dice.count * (dice.sides + 1)) / 2 + modifier;
    const variance = (dice.count * (dice.sides ** 2 - 1)) / 12;
    const sigma = Math.sqrt(variance);
    const cdf = (x: number) =>
      0.5 *
      (1 +
        Math.sign((x - mean) / sigma) *
          Math.sqrt(1 - Math.exp((-2 * ((x - mean) / sigma) ** 2) / Math.PI)));
    const criticalSuccessProbability = clampProbability(
      1 - cdf(difficulty + resolver.criticalSuccessMargin - 0.5),
    );
    const successProbability = clampProbability(1 - cdf(difficulty - 0.5));
    const criticalFailureProbability = clampProbability(
      cdf(difficulty - resolver.criticalFailureMargin + 0.5),
    );
    return {
      method,
      successProbability,
      criticalSuccessProbability,
      failureProbability: 1 - successProbability,
      criticalFailureProbability,
    };
  }
  const buckets = {
    success: 0,
    criticalSuccess: 0,
    failure: 0,
    criticalFailure: 0,
  };
  for (const [total, probability] of totals) {
    const degree = classify(total);
    if (degree === "critical-success") buckets.criticalSuccess += probability;
    if (
      degree === "partial-success" ||
      degree === "success" ||
      degree === "critical-success"
    )
      buckets.success += probability;
    if (degree === "failure" || degree === "critical-failure")
      buckets.failure += probability;
    if (degree === "critical-failure") buckets.criticalFailure += probability;
  }
  return {
    method,
    successProbability: clampProbability(buckets.success),
    criticalSuccessProbability: clampProbability(buckets.criticalSuccess),
    failureProbability: clampProbability(buckets.failure),
    criticalFailureProbability: clampProbability(buckets.criticalFailure),
  };
}
