import type {
  RuleActionEffectV1,
  RuleCheckDefinitionV1,
  RuleCheckResolverV2,
  RuleNumberExpressionV1,
  RulePackV1,
  TtrpgDegreeV2,
  TtrpgResolutionRequestV2,
} from "../types";
import { hashProductProductionValueV2 } from "../product-production/hash";
import { assertTtrpgDieSidesV2, sampleTtrpgDiceWithSha256V2 } from "./dice";
import type { TtrpgDiceRollTraceV2 } from "../types";
import { resolveTtrpgResolutionV2 } from "./resolution";
import { parseTtrpgAbilityDefinitionV2 } from "./ability-ledger";

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function fail(message: string): never {
  throw new Error(`[ttrpg-rule-pack] ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    expected.some((key, index) => key !== actual[index])
  ) {
    fail(`${label} 字段不精确:${actual.join(",")}`);
  }
}

function text(value: unknown, label: string, maximum = 10_000): string {
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const result = value.trim().normalize("NFC");
  if (!result || result.length > maximum) fail(`${label} 为空或过长`);
  return result;
}

function key(value: unknown, label: string): string {
  const result = text(value, label, 128);
  if (!KEY.test(result)) fail(`${label} 不是稳定 key`);
  return result;
}

function finite(
  value: unknown,
  label: string,
  minimum = -1_000_000,
  maximum = 1_000_000,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} 数值越界`);
  }
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = 1_000_000,
): number {
  const result = finite(value, label, minimum, maximum);
  if (!Number.isInteger(result)) fail(`${label} 必须是整数`);
  return result;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} 必须是 boolean`);
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    fail(`${label} 枚举无效`);
  return value as T;
}

function array(value: unknown, label: string, maximum = 500): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    fail(`${label} 必须是有界数组`);
  return value;
}

function keyArray(value: unknown, label: string, maximum = 500): string[] {
  const result = array(value, label, maximum).map((item, index) =>
    key(item, `${label}[${index}]`),
  );
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`);
  return result;
}

function textArray(value: unknown, label: string, maximum = 500): string[] {
  const result = array(value, label, maximum).map((item, index) =>
    text(item, `${label}[${index}]`, 2_000),
  );
  if (new Set(result).size !== result.length) fail(`${label} 不允许重复`);
  return result;
}

function parseExpression(
  value: unknown,
  label: string,
  depth = 0,
): RuleNumberExpressionV1 {
  if (depth > 12) fail(`${label} 表达式嵌套过深`);
  const row = object(value, label);
  const op = enumValue(
    row.op,
    ["constant", "attribute", "add", "multiply", "floor-divide"] as const,
    `${label}.op`,
  );
  if (op === "constant") {
    exact(row, ["op", "value"], label);
    return { op, value: finite(row.value, `${label}.value`) };
  }
  if (op === "attribute") {
    exact(row, ["op", "key"], label);
    return { op, key: key(row.key, `${label}.key`) };
  }
  if (op === "add") {
    exact(row, ["op", "values"], label);
    const values = array(row.values, `${label}.values`, 32).map((item, index) =>
      parseExpression(item, `${label}.values[${index}]`, depth + 1),
    );
    if (!values.length) fail(`${label}.values 不得为空`);
    return { op, values };
  }
  if (op === "multiply") {
    exact(row, ["op", "left", "right"], label);
    return {
      op,
      left: parseExpression(row.left, `${label}.left`, depth + 1),
      right: parseExpression(row.right, `${label}.right`, depth + 1),
    };
  }
  exact(row, ["op", "value", "divisor"], label);
  const divisor = finite(
    row.divisor,
    `${label}.divisor`,
    -1_000_000,
    1_000_000,
  );
  if (divisor === 0) fail(`${label}.divisor 不得为零`);
  return {
    op,
    value: parseExpression(row.value, `${label}.value`, depth + 1),
    divisor,
  };
}

function uniqueKeys(rows: Array<{ key: string }>, label: string): void {
  if (new Set(rows.map((row) => row.key)).size !== rows.length)
    fail(`${label} key 重复`);
}

function validateKnown(
  values: string[],
  known: Set<string>,
  label: string,
): void {
  const missing = values.filter((value) => !known.has(value));
  if (missing.length) fail(`${label} 引用了未知 key:${missing.join(",")}`);
}

function parseCheckResolverV2(
  value: unknown,
  label: string,
  diceSides: number,
): RuleCheckResolverV2 {
  const row = object(value, label);
  const mode = enumValue(
    row.mode,
    ["total-vs-target", "roll-under", "success-pool", "opposed"] as const,
    `${label}.mode`,
  );
  if (mode === "total-vs-target") {
    const fields = [
      "mode",
      "defaultDifficulty",
      "criticalSuccessMargin",
      "criticalFailureMargin",
      "partialSuccessWindow",
    ];
    for (const optional of [
      "naturalCriticalSuccessAtOrAbove",
      "naturalCriticalFailureAtOrBelow",
    ]) {
      if (Object.prototype.hasOwnProperty.call(row, optional))
        fields.push(optional);
    }
    exact(row, fields, label);
    const naturalCriticalSuccessAtOrAbove =
      row.naturalCriticalSuccessAtOrAbove == null
        ? null
        : integer(
            row.naturalCriticalSuccessAtOrAbove,
            `${label}.naturalCriticalSuccessAtOrAbove`,
            1,
            diceSides,
          );
    const naturalCriticalFailureAtOrBelow =
      row.naturalCriticalFailureAtOrBelow == null
        ? null
        : integer(
            row.naturalCriticalFailureAtOrBelow,
            `${label}.naturalCriticalFailureAtOrBelow`,
            1,
            diceSides,
          );
    if (
      naturalCriticalSuccessAtOrAbove != null &&
      naturalCriticalFailureAtOrBelow != null &&
      naturalCriticalFailureAtOrBelow >= naturalCriticalSuccessAtOrAbove
    ) {
      fail(`${label} 自然大失败与大成功点数重叠`);
    }
    return {
      mode,
      defaultDifficulty: finite(
        row.defaultDifficulty,
        `${label}.defaultDifficulty`,
      ),
      criticalSuccessMargin: finite(
        row.criticalSuccessMargin,
        `${label}.criticalSuccessMargin`,
        0,
      ),
      criticalFailureMargin: finite(
        row.criticalFailureMargin,
        `${label}.criticalFailureMargin`,
        0,
      ),
      partialSuccessWindow: finite(
        row.partialSuccessWindow,
        `${label}.partialSuccessWindow`,
        0,
      ),
      ...(naturalCriticalSuccessAtOrAbove == null
        ? {}
        : { naturalCriticalSuccessAtOrAbove }),
      ...(naturalCriticalFailureAtOrBelow == null
        ? {}
        : { naturalCriticalFailureAtOrBelow }),
    };
  }
  if (mode === "roll-under") {
    exact(
      row,
      [
        "mode",
        "defaultDifficulty",
        "hardDivisor",
        "extremeDivisor",
        "criticalSuccessMaximum",
        "criticalFailureMinimum",
      ],
      label,
    );
    if (diceSides !== 100) fail(`${label} roll-under 必须使用 d100`);
    const hardDivisor = integer(
      row.hardDivisor,
      `${label}.hardDivisor`,
      2,
      100,
    );
    const extremeDivisor = integer(
      row.extremeDivisor,
      `${label}.extremeDivisor`,
      hardDivisor,
      100,
    );
    const criticalSuccessMaximum = integer(
      row.criticalSuccessMaximum,
      `${label}.criticalSuccessMaximum`,
      1,
      100,
    );
    const criticalFailureMinimum = integer(
      row.criticalFailureMinimum,
      `${label}.criticalFailureMinimum`,
      1,
      100,
    );
    if (criticalSuccessMaximum >= criticalFailureMinimum)
      fail(`${label} 临界阈值顺序无效`);
    return {
      mode,
      defaultDifficulty:
        row.defaultDifficulty == null
          ? null
          : integer(
              row.defaultDifficulty,
              `${label}.defaultDifficulty`,
              1,
              100,
            ),
      hardDivisor,
      extremeDivisor,
      criticalSuccessMaximum,
      criticalFailureMinimum,
    };
  }
  if (mode === "success-pool") {
    exact(
      row,
      [
        "mode",
        "defaultDifficulty",
        "dicePerAttributePoint",
        "minimumDice",
        "maximumDice",
        "successAtOrAbove",
        "criticalAtOrAbove",
        "criticalBonusSuccesses",
        "botchAtOrBelow",
        "botchesCancel",
        "criticalSuccesses",
        "criticalFailureBotches",
      ],
      label,
    );
    const minimumDice = integer(
      row.minimumDice,
      `${label}.minimumDice`,
      1,
      100,
    );
    const maximumDice = integer(
      row.maximumDice,
      `${label}.maximumDice`,
      minimumDice,
      100,
    );
    const successAtOrAbove = integer(
      row.successAtOrAbove,
      `${label}.successAtOrAbove`,
      1,
      diceSides,
    );
    const criticalAtOrAbove =
      row.criticalAtOrAbove == null
        ? null
        : integer(
            row.criticalAtOrAbove,
            `${label}.criticalAtOrAbove`,
            successAtOrAbove,
            diceSides,
          );
    const botchAtOrBelow =
      row.botchAtOrBelow == null
        ? null
        : integer(
            row.botchAtOrBelow,
            `${label}.botchAtOrBelow`,
            1,
            Math.max(1, successAtOrAbove - 1),
          );
    if (botchAtOrBelow != null && botchAtOrBelow >= successAtOrAbove) {
      fail(`${label} 大失败点数不得与成功点数重叠`);
    }
    return {
      mode,
      defaultDifficulty: integer(
        row.defaultDifficulty,
        `${label}.defaultDifficulty`,
        1,
        100,
      ),
      dicePerAttributePoint: integer(
        row.dicePerAttributePoint,
        `${label}.dicePerAttributePoint`,
        1,
        100,
      ),
      minimumDice,
      maximumDice,
      successAtOrAbove,
      criticalAtOrAbove,
      criticalBonusSuccesses: integer(
        row.criticalBonusSuccesses,
        `${label}.criticalBonusSuccesses`,
        0,
        100,
      ),
      botchAtOrBelow,
      botchesCancel: bool(row.botchesCancel, `${label}.botchesCancel`),
      criticalSuccesses: integer(
        row.criticalSuccesses,
        `${label}.criticalSuccesses`,
        1,
        200,
      ),
      criticalFailureBotches: integer(
        row.criticalFailureBotches,
        `${label}.criticalFailureBotches`,
        1,
        100,
      ),
    };
  }
  const fields = [
    "mode",
    "defaultDifficulty",
    "criticalSuccessMargin",
    "criticalFailureMargin",
    "partialSuccessWindow",
    "tieBreak",
  ];
  for (const optional of [
    "naturalCriticalSuccessAtOrAbove",
    "naturalCriticalFailureAtOrBelow",
  ]) {
    if (Object.prototype.hasOwnProperty.call(row, optional))
      fields.push(optional);
  }
  exact(row, fields, label);
  const naturalCriticalSuccessAtOrAbove =
    row.naturalCriticalSuccessAtOrAbove == null
      ? null
      : integer(
          row.naturalCriticalSuccessAtOrAbove,
          `${label}.naturalCriticalSuccessAtOrAbove`,
          1,
          diceSides,
        );
  const naturalCriticalFailureAtOrBelow =
    row.naturalCriticalFailureAtOrBelow == null
      ? null
      : integer(
          row.naturalCriticalFailureAtOrBelow,
          `${label}.naturalCriticalFailureAtOrBelow`,
          1,
          diceSides,
        );
  if (
    naturalCriticalSuccessAtOrAbove != null &&
    naturalCriticalFailureAtOrBelow != null &&
    naturalCriticalFailureAtOrBelow >= naturalCriticalSuccessAtOrAbove
  ) {
    fail(`${label} 自然大失败与大成功点数重叠`);
  }
  return {
    mode,
    defaultDifficulty: finite(
      row.defaultDifficulty,
      `${label}.defaultDifficulty`,
    ),
    criticalSuccessMargin: finite(
      row.criticalSuccessMargin,
      `${label}.criticalSuccessMargin`,
      0,
    ),
    criticalFailureMargin: finite(
      row.criticalFailureMargin,
      `${label}.criticalFailureMargin`,
      0,
    ),
    partialSuccessWindow: finite(
      row.partialSuccessWindow,
      `${label}.partialSuccessWindow`,
      0,
    ),
    tieBreak: enumValue(
      row.tieBreak,
      ["higher-total", "higher-margin", "reroll", "stalemate"] as const,
      `${label}.tieBreak`,
    ),
    ...(naturalCriticalSuccessAtOrAbove == null
      ? {}
      : { naturalCriticalSuccessAtOrAbove }),
    ...(naturalCriticalFailureAtOrBelow == null
      ? {}
      : { naturalCriticalFailureAtOrBelow }),
  };
}

function expressionAttributeKeys(expression: RuleNumberExpressionV1): string[] {
  if (expression.op === "attribute") return [expression.key];
  if (expression.op === "add")
    return expression.values.flatMap(expressionAttributeKeys);
  if (expression.op === "multiply")
    return [
      ...expressionAttributeKeys(expression.left),
      ...expressionAttributeKeys(expression.right),
    ];
  if (expression.op === "floor-divide")
    return expressionAttributeKeys(expression.value);
  return [];
}

export function evaluateRuleNumberExpressionV1(
  expression: RuleNumberExpressionV1,
  attributes: Readonly<Record<string, number>>,
): number {
  if (expression.op === "constant") return expression.value;
  if (expression.op === "attribute") {
    const value = attributes[expression.key];
    if (!Number.isFinite(value)) fail(`缺少表达式属性:${expression.key}`);
    return value;
  }
  if (expression.op === "add")
    return expression.values.reduce(
      (sum, child) => sum + evaluateRuleNumberExpressionV1(child, attributes),
      0,
    );
  if (expression.op === "multiply")
    return (
      evaluateRuleNumberExpressionV1(expression.left, attributes) *
      evaluateRuleNumberExpressionV1(expression.right, attributes)
    );
  return Math.floor(
    evaluateRuleNumberExpressionV1(expression.value, attributes) /
      expression.divisor,
  );
}

export function ruleCheckDefaultDifficultyV2(
  check: RuleCheckDefinitionV1,
  actingAttributeValue?: number | null,
): number | null {
  if ("targetMode" in check) return check.defaultDifficulty;
  if (check.resolver.mode === "roll-under") {
    if (check.resolver.defaultDifficulty != null)
      return check.resolver.defaultDifficulty;
    return Number.isFinite(actingAttributeValue)
      ? Number(actingAttributeValue)
      : null;
  }
  return check.resolver.defaultDifficulty;
}

export interface RuleCheckDifficultyOptionsV2 {
  easy: number;
  standard: number;
  hard: number;
}

/** Produces human-facing difficulty presets without reversing roll-under semantics. */
export function ruleCheckDifficultyOptionsV2(
  check: RuleCheckDefinitionV1,
  actingAttributeValue?: number | null,
): RuleCheckDifficultyOptionsV2 | null {
  const standard = ruleCheckDefaultDifficultyV2(check, actingAttributeValue);
  if (standard == null || !Number.isFinite(standard)) return null;
  const mode = "targetMode" in check ? "total-vs-target" : check.resolver.mode;
  if (mode === "roll-under") {
    return {
      easy: Math.min(100, Math.max(1, Math.round(standard + 10))),
      standard: Math.min(100, Math.max(1, Math.round(standard))),
      hard: Math.min(100, Math.max(1, Math.round(standard - 10))),
    };
  }
  if (mode === "success-pool") {
    return {
      easy: Math.max(1, Math.round(standard - 1)),
      standard: Math.max(1, Math.round(standard)),
      hard: Math.min(100, Math.max(1, Math.round(standard + 1))),
    };
  }
  return {
    easy: standard - 2,
    standard,
    hard: standard + 2,
  };
}

function applyNaturalFaceOverrideV2(
  outcome: ReturnType<typeof resolveTtrpgResolutionV2>,
  resolver: Extract<
    RuleCheckResolverV2,
    { mode: "total-vs-target" | "opposed" }
  >,
  keptDice: number[],
): ReturnType<typeof resolveTtrpgResolutionV2> {
  if (keptDice.length !== 1) return outcome;
  const face = keptDice[0];
  if (
    resolver.naturalCriticalSuccessAtOrAbove != null &&
    face >= resolver.naturalCriticalSuccessAtOrAbove
  ) {
    return {
      ...outcome,
      degree: "critical-success",
      succeeded: true,
      calculationTrace: [
        ...outcome.calculationTrace,
        `natural-face ${face} >= ${resolver.naturalCriticalSuccessAtOrAbove}: critical-success`,
      ],
    };
  }
  if (
    resolver.naturalCriticalFailureAtOrBelow != null &&
    face <= resolver.naturalCriticalFailureAtOrBelow
  ) {
    return {
      ...outcome,
      degree: "critical-failure",
      succeeded: false,
      calculationTrace: [
        ...outcome.calculationTrace,
        `natural-face ${face} <= ${resolver.naturalCriticalFailureAtOrBelow}: critical-failure`,
      ],
    };
  }
  return outcome;
}

function validateEffects(
  effects: unknown,
  known: {
    attributes: Set<string>;
    checks: Set<string>;
    dice: Set<string>;
    resources: Set<string>;
    conditions: Set<string>;
  },
  label: string,
): RuleActionEffectV1[] {
  return array(effects, label, 20).map((value, index) => {
    const row = object(value, `${label}[${index}]`);
    const kind = enumValue(
      row.kind,
      ["check", "resource", "damage", "condition"] as const,
      `${label}[${index}].kind`,
    );
    if (kind === "check") {
      exact(row, ["kind", "checkKey", "attributeKey"], `${label}[${index}]`);
      const result: RuleActionEffectV1 = {
        kind,
        checkKey: key(row.checkKey, "checkKey"),
        attributeKey: key(row.attributeKey, "attributeKey"),
      };
      validateKnown([result.checkKey], known.checks, `${label}.checkKey`);
      validateKnown(
        [result.attributeKey],
        known.attributes,
        `${label}.attributeKey`,
      );
      return result;
    }
    const applicationFields = [
      ...(Object.prototype.hasOwnProperty.call(row, "appliesOnDegrees")
        ? ["appliesOnDegrees"]
        : []),
      ...(Object.prototype.hasOwnProperty.call(row, "targetScope")
        ? ["targetScope"]
        : []),
    ];
    const appliesOnDegrees = Object.prototype.hasOwnProperty.call(
      row,
      "appliesOnDegrees",
    )
      ? array(
          row.appliesOnDegrees,
          `${label}[${index}].appliesOnDegrees`,
          8,
        ).map((degree, degreeIndex) =>
          enumValue(
            degree,
            [
              "automatic",
              "critical-failure",
              "failure",
              "partial-success",
              "success",
              "hard-success",
              "extreme-success",
              "critical-success",
            ] as const,
            `${label}[${index}].appliesOnDegrees[${degreeIndex}]`,
          ),
        )
      : undefined;
    if (
      appliesOnDegrees &&
      (!appliesOnDegrees.length ||
        new Set(appliesOnDegrees).size !== appliesOnDegrees.length)
    ) {
      fail(`${label}[${index}].appliesOnDegrees 不能为空或重复`);
    }
    const targetScope = Object.prototype.hasOwnProperty.call(row, "targetScope")
      ? enumValue(
          row.targetScope,
          ["action-target", "actor"] as const,
          `${label}[${index}].targetScope`,
        )
      : undefined;
    const application = {
      ...(appliesOnDegrees == null ? {} : { appliesOnDegrees }),
      ...(targetScope == null ? {} : { targetScope }),
    };
    if (kind === "resource") {
      exact(
        row,
        ["kind", "resourceKey", "delta", ...applicationFields],
        `${label}[${index}]`,
      );
      const result: RuleActionEffectV1 = {
        kind,
        resourceKey: key(row.resourceKey, "resourceKey"),
        delta: finite(row.delta, "delta"),
        ...application,
      };
      validateKnown(
        [result.resourceKey],
        known.resources,
        `${label}.resourceKey`,
      );
      return result;
    }
    if (kind === "damage") {
      exact(
        row,
        [
          "kind",
          "resourceKey",
          "diceModelKey",
          "modifierAttributeKey",
          ...applicationFields,
        ],
        `${label}[${index}]`,
      );
      const modifierAttributeKey =
        row.modifierAttributeKey == null
          ? null
          : key(row.modifierAttributeKey, "modifierAttributeKey");
      const result: RuleActionEffectV1 = {
        kind,
        resourceKey: key(row.resourceKey, "resourceKey"),
        diceModelKey: key(row.diceModelKey, "diceModelKey"),
        modifierAttributeKey,
        ...application,
      };
      validateKnown(
        [result.resourceKey],
        known.resources,
        `${label}.resourceKey`,
      );
      validateKnown([result.diceModelKey], known.dice, `${label}.diceModelKey`);
      if (modifierAttributeKey)
        validateKnown(
          [modifierAttributeKey],
          known.attributes,
          `${label}.modifierAttributeKey`,
        );
      return result;
    }
    exact(
      row,
      ["kind", "conditionKey", "stacks", ...applicationFields],
      `${label}[${index}]`,
    );
    const result: RuleActionEffectV1 = {
      kind,
      conditionKey: key(row.conditionKey, "conditionKey"),
      stacks: integer(row.stacks, "stacks", 1, 100),
      ...application,
    };
    validateKnown(
      [result.conditionKey],
      known.conditions,
      `${label}.conditionKey`,
    );
    return result;
  });
}

export function parseRulePackV1(value: string | unknown): RulePackV1 {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      fail("不是合法 JSON");
    }
  }
  const root = object(raw, "rulePack");
  exact(
    root,
    [
      "schema",
      "version",
      "ruleSystemId",
      "ruleSystemVersion",
      "title",
      "description",
      "license",
      "attributes",
      "derivedStats",
      "diceModels",
      "checks",
      "resources",
      "conditions",
      "actions",
      "turnStructure",
      "items",
      "advancement",
      "characterSheetUi",
      "compendium",
      "migrations",
      "tests",
    ],
    "rulePack",
  );
  if (root.schema !== "storyforge.rule-pack" || root.version !== 1)
    fail("schema/version 无效");

  const license = object(root.license, "license");
  exact(
    license,
    [
      "licenseId",
      "name",
      "attribution",
      "commercialUse",
      "derivativesAllowed",
      "sourceUrl",
    ],
    "license",
  );
  key(license.licenseId, "license.licenseId");
  text(license.name, "license.name", 300);
  text(license.attribution, "license.attribution", 2_000);
  bool(license.commercialUse, "license.commercialUse");
  bool(license.derivativesAllowed, "license.derivativesAllowed");
  if (license.sourceUrl !== null && typeof license.sourceUrl !== "string")
    fail("license.sourceUrl 必须是字符串或 null");

  const attributes = array(root.attributes, "attributes", 64).map(
    (value, index) => {
      const row = object(value, `attributes[${index}]`);
      exact(
        row,
        ["key", "name", "description", "minimum", "maximum", "defaultValue"],
        `attributes[${index}]`,
      );
      const minimum = finite(row.minimum, `attributes[${index}].minimum`);
      const maximum = finite(row.maximum, `attributes[${index}].maximum`);
      const defaultValue = finite(
        row.defaultValue,
        `attributes[${index}].defaultValue`,
      );
      if (minimum > maximum || defaultValue < minimum || defaultValue > maximum)
        fail(`attributes[${index}] 范围无效`);
      return {
        key: key(row.key, `attributes[${index}].key`),
        name: text(row.name, "attribute.name", 200),
        description: text(row.description, "attribute.description"),
        minimum,
        maximum,
        defaultValue,
      };
    },
  );
  if (!attributes.length) fail("attributes 不得为空");
  uniqueKeys(attributes, "attributes");
  const attributeKeys = new Set(attributes.map((row) => row.key));

  const derivedStats = array(root.derivedStats, "derivedStats", 64).map(
    (value, index) => {
      const row = object(value, `derivedStats[${index}]`);
      exact(
        row,
        ["key", "name", "description", "formula", "minimum", "maximum"],
        `derivedStats[${index}]`,
      );
      const formula = parseExpression(
        row.formula,
        `derivedStats[${index}].formula`,
      );
      validateKnown(
        expressionAttributeKeys(formula),
        attributeKeys,
        `derivedStats[${index}].formula`,
      );
      return {
        key: key(row.key, `derivedStats[${index}].key`),
        name: text(row.name, "derivedStat.name", 200),
        description: text(row.description, "derivedStat.description"),
        formula,
        minimum:
          row.minimum == null
            ? null
            : finite(row.minimum, "derivedStat.minimum"),
        maximum:
          row.maximum == null
            ? null
            : finite(row.maximum, "derivedStat.maximum"),
      };
    },
  );
  uniqueKeys(derivedStats, "derivedStats");
  const checkTraitKeys = new Set([
    ...attributeKeys,
    ...derivedStats.map((row) => row.key),
  ]);

  const diceModels = array(root.diceModels, "diceModels", 32).map(
    (value, index) => {
      const row = object(value, `diceModels[${index}]`);
      exact(
        row,
        ["key", "name", "count", "sides", "keep"],
        `diceModels[${index}]`,
      );
      return {
        key: key(row.key, "diceModel.key"),
        name: text(row.name, "diceModel.name", 200),
        count: integer(row.count, "diceModel.count", 1, 100),
        sides: assertTtrpgDieSidesV2(row.sides, "diceModel.sides"),
        keep: enumValue(
          row.keep,
          ["all", "highest", "lowest"] as const,
          "diceModel.keep",
        ),
      };
    },
  );
  if (!diceModels.length) fail("diceModels 不得为空");
  uniqueKeys(diceModels, "diceModels");
  const diceKeys = new Set(diceModels.map((row) => row.key));

  const checks = array(root.checks, "checks", 64).map((value, index) => {
    const row = object(value, `checks[${index}]`);
    const attributeList = keyArray(
      row.attributeKeys,
      "check.attributeKeys",
      32,
    );
    validateKnown(attributeList, checkTraitKeys, "check.attributeKeys");
    const diceModelKey = key(row.diceModelKey, "check.diceModelKey");
    validateKnown([diceModelKey], diceKeys, "check.diceModelKey");
    const base = {
      key: key(row.key, "check.key"),
      name: text(row.name, "check.name", 200),
      diceModelKey,
      attributeKeys: attributeList,
    };
    if (Object.prototype.hasOwnProperty.call(row, "resolver")) {
      exact(
        row,
        ["key", "name", "diceModelKey", "attributeKeys", "resolver"],
        `checks[${index}]`,
      );
      const diceModel = diceModels.find((model) => model.key === diceModelKey)!;
      const resolver = parseCheckResolverV2(
        row.resolver,
        `checks[${index}].resolver`,
        diceModel.sides,
      );
      if (
        resolver.mode === "roll-under" &&
        (diceModel.count !== 1 || diceModel.keep !== "all")
      ) {
        fail(`checks[${index}] roll-under 必须使用单颗 d100`);
      }
      if (resolver.mode === "success-pool" && diceModel.keep !== "all") {
        fail(`checks[${index}] success-pool 必须保留全部骰子`);
      }
      return {
        ...base,
        resolver,
      };
    }
    exact(
      row,
      [
        "key",
        "name",
        "diceModelKey",
        "attributeKeys",
        "targetMode",
        "defaultDifficulty",
        "criticalSuccessMargin",
        "criticalFailureMargin",
      ],
      `checks[${index}]`,
    );
    return {
      ...base,
      targetMode: enumValue(
        row.targetMode,
        ["meet-or-beat"] as const,
        "check.targetMode",
      ),
      defaultDifficulty: finite(
        row.defaultDifficulty,
        "check.defaultDifficulty",
      ),
      criticalSuccessMargin: finite(
        row.criticalSuccessMargin,
        "check.criticalSuccessMargin",
        0,
      ),
      criticalFailureMargin: finite(
        row.criticalFailureMargin,
        "check.criticalFailureMargin",
        0,
      ),
    };
  });
  if (!checks.length) fail("checks 不得为空");
  uniqueKeys(checks, "checks");
  const checkKeys = new Set(checks.map((row) => row.key));

  const resources = array(root.resources, "resources", 32).map(
    (value, index) => {
      const row = object(value, `resources[${index}]`);
      exact(
        row,
        [
          "key",
          "name",
          "description",
          "maximumFormula",
          "initialMode",
          "minimum",
        ],
        `resources[${index}]`,
      );
      const maximumFormula = parseExpression(
        row.maximumFormula,
        `resources[${index}].maximumFormula`,
      );
      validateKnown(
        expressionAttributeKeys(maximumFormula),
        attributeKeys,
        `resources[${index}].maximumFormula`,
      );
      return {
        key: key(row.key, "resource.key"),
        name: text(row.name, "resource.name", 200),
        description: text(row.description, "resource.description"),
        maximumFormula,
        initialMode: enumValue(
          row.initialMode,
          ["maximum", "zero"] as const,
          "resource.initialMode",
        ),
        minimum: finite(row.minimum, "resource.minimum"),
      };
    },
  );
  uniqueKeys(resources, "resources");
  const resourceKeys = new Set(resources.map((row) => row.key));

  const conditions = array(root.conditions, "conditions", 64).map(
    (value, index) => {
      const row = object(value, `conditions[${index}]`);
      exact(
        row,
        [
          "key",
          "name",
          "description",
          "stacking",
          "maximumStacks",
          "defaultDurationRounds",
          "checkModifier",
        ],
        `conditions[${index}]`,
      );
      return {
        key: key(row.key, "condition.key"),
        name: text(row.name, "condition.name", 200),
        description: text(row.description, "condition.description"),
        stacking: enumValue(
          row.stacking,
          ["replace", "stack"] as const,
          "condition.stacking",
        ),
        maximumStacks: integer(
          row.maximumStacks,
          "condition.maximumStacks",
          1,
          100,
        ),
        defaultDurationRounds:
          row.defaultDurationRounds == null
            ? null
            : integer(
                row.defaultDurationRounds,
                "condition.defaultDurationRounds",
                1,
                10_000,
              ),
        checkModifier: finite(row.checkModifier, "condition.checkModifier"),
      };
    },
  );
  uniqueKeys(conditions, "conditions");
  const conditionKeys = new Set(conditions.map((row) => row.key));

  const known = {
    attributes: checkTraitKeys,
    checks: checkKeys,
    dice: diceKeys,
    resources: resourceKeys,
    conditions: conditionKeys,
  };
  const actions = array(root.actions, "actions", 128).map((value, index) => {
    const row = object(value, `actions[${index}]`);
    exact(
      row,
      [
        "key",
        "name",
        "description",
        "phase",
        "target",
        "costResourceKey",
        "costAmount",
        "usage",
        ...(row.requirements == null ? [] : ["requirements"]),
        "effects",
      ],
      `actions[${index}]`,
    );
    const actionKey = key(row.key, "action.key");
    const costResourceKey =
      row.costResourceKey == null
        ? null
        : key(row.costResourceKey, "action.costResourceKey");
    if (costResourceKey)
      validateKnown([costResourceKey], resourceKeys, "action.costResourceKey");
    const usage = parseTtrpgAbilityDefinitionV2({
      abilityKey: actionKey,
      actionDefinitionKey: actionKey,
      usage: row.usage,
    }).usage;
    if (usage.resourceKey)
      validateKnown(
        [usage.resourceKey],
        resourceKeys,
        "action.usage.resourceKey",
      );
    if (usage.mode === "resource-cost" && costResourceKey != null) {
      fail(
        `actions[${index}] 不能同时声明 usage.resource-cost 与旧 costResourceKey`,
      );
    }
    const requirements =
      row.requirements == null
        ? undefined
        : array(
            row.requirements,
            `actions[${index}].requirements`,
            32,
          ).map((rawRequirement, requirementIndex) => {
            const requirement = object(
              rawRequirement,
              `actions[${index}].requirements[${requirementIndex}]`,
            );
            if (requirement.kind === "resource") {
              exact(
                requirement,
                ["kind", "resourceKey", "operator", "value"],
                `actions[${index}].requirements[${requirementIndex}]`,
              );
              const requirementResourceKey = key(
                requirement.resourceKey,
                `actions[${index}].requirements[${requirementIndex}].resourceKey`,
              );
              validateKnown(
                [requirementResourceKey],
                resourceKeys,
                `actions[${index}].requirements[${requirementIndex}].resourceKey`,
              );
              return {
                kind: "resource" as const,
                resourceKey: requirementResourceKey,
                operator: enumValue(
                  requirement.operator,
                  ["at-most", "at-least"] as const,
                  `actions[${index}].requirements[${requirementIndex}].operator`,
                ),
                value: finite(
                  requirement.value,
                  `actions[${index}].requirements[${requirementIndex}].value`,
                ),
              };
            }
            if (requirement.kind === "condition") {
              exact(
                requirement,
                ["kind", "conditionKey", "operator", "stacks"],
                `actions[${index}].requirements[${requirementIndex}]`,
              );
              const requirementConditionKey = key(
                requirement.conditionKey,
                `actions[${index}].requirements[${requirementIndex}].conditionKey`,
              );
              validateKnown(
                [requirementConditionKey],
                conditionKeys,
                `actions[${index}].requirements[${requirementIndex}].conditionKey`,
              );
              const operator = enumValue(
                requirement.operator,
                ["present", "absent"] as const,
                `actions[${index}].requirements[${requirementIndex}].operator`,
              );
              const stacks = integer(
                requirement.stacks,
                `actions[${index}].requirements[${requirementIndex}].stacks`,
                0,
                100,
              );
              if (
                (operator === "present" && stacks < 1) ||
                (operator === "absent" && stacks !== 0)
              ) {
                fail(
                  `actions[${index}].requirements[${requirementIndex}] 状态层数与 operator 不一致`,
                );
              }
              return {
                kind: "condition" as const,
                conditionKey: requirementConditionKey,
                operator,
                stacks,
              };
            }
            fail(
              `actions[${index}].requirements[${requirementIndex}].kind 无效`,
            );
          });
    return {
      key: actionKey,
      name: text(row.name, "action.name", 200),
      description: text(row.description, "action.description"),
      phase: enumValue(
        row.phase,
        ["free", "action", "reaction", "downtime"] as const,
        "action.phase",
      ),
      target: enumValue(
        row.target,
        ["self", "single-ally", "single-enemy", "scene"] as const,
        "action.target",
      ),
      costResourceKey,
      costAmount: finite(row.costAmount, "action.costAmount", 0),
      usage,
      ...(requirements === undefined ? {} : { requirements }),
      effects: validateEffects(row.effects, known, `actions[${index}].effects`),
    };
  });
  if (!actions.length) fail("actions 不得为空");
  uniqueKeys(actions, "actions");
  const actionKeys = new Set(actions.map((row) => row.key));

  const turn = object(root.turnStructure, "turnStructure");
  exact(
    turn,
    [
      "initiativeDiceModelKey",
      "initiativeAttributeKey",
      "phases",
      "actionsPerTurn",
      "reactionsPerRound",
    ],
    "turnStructure",
  );
  validateKnown(
    [key(turn.initiativeDiceModelKey, "turnStructure.initiativeDiceModelKey")],
    diceKeys,
    "turnStructure.initiativeDiceModelKey",
  );
  validateKnown(
    [key(turn.initiativeAttributeKey, "turnStructure.initiativeAttributeKey")],
    checkTraitKeys,
    "turnStructure.initiativeAttributeKey",
  );
  const phases = array(turn.phases, "turnStructure.phases", 3).map(
    (value, index) =>
      enumValue(
        value,
        ["start", "action", "end"] as const,
        `turnStructure.phases[${index}]`,
      ),
  );
  if (phases.join(",") !== "start,action,end")
    fail("turnStructure.phases 必须是 start/action/end");
  integer(turn.actionsPerTurn, "turnStructure.actionsPerTurn", 1, 20);
  integer(turn.reactionsPerRound, "turnStructure.reactionsPerRound", 0, 20);

  const items = array(root.items, "items", 256).map((value, index) => {
    const row = object(value, `items[${index}]`);
    exact(
      row,
      [
        "key",
        "name",
        "description",
        "tags",
        "grantedActionKeys",
        ...(Object.prototype.hasOwnProperty.call(row, "mechanics")
          ? ["mechanics"]
          : []),
      ],
      `items[${index}]`,
    );
    const grantedActionKeys = keyArray(
      row.grantedActionKeys,
      "item.grantedActionKeys",
      64,
    );
    validateKnown(grantedActionKeys, actionKeys, "item.grantedActionKeys");
    let mechanics: import("../types").RuleItemDefinitionV1["mechanics"];
    if (row.mechanics != null) {
      const raw = object(row.mechanics, `items[${index}].mechanics`);
      exact(
        raw,
        [
          "category",
          "stackPolicy",
          "maxStack",
          "weight",
          "equipSlots",
          "requiresAttunement",
          "maximumCharges",
          "maximumDurability",
        ],
        `items[${index}].mechanics`,
      );
      const stackPolicy = enumValue(
        raw.stackPolicy,
        ["unique", "stackable"] as const,
        `items[${index}].mechanics.stackPolicy`,
      );
      const maxStack =
        raw.maxStack == null
          ? null
          : integer(
              raw.maxStack,
              `items[${index}].mechanics.maxStack`,
              1,
              100_000,
            );
      if (
        (stackPolicy === "unique" && maxStack != null && maxStack !== 1) ||
        (stackPolicy === "stackable" && maxStack == null)
      ) {
        fail(`items[${index}].mechanics 堆叠规则无效`);
      }
      const weight =
        raw.weight == null
          ? null
          : finite(raw.weight, `items[${index}].mechanics.weight`, 0, 1_000_000);
      if (typeof raw.requiresAttunement !== "boolean")
        fail(`items[${index}].mechanics.requiresAttunement 无效`);
      mechanics = {
        category: key(raw.category, `items[${index}].mechanics.category`),
        stackPolicy,
        maxStack,
        weight,
        equipSlots: keyArray(
          raw.equipSlots,
          `items[${index}].mechanics.equipSlots`,
          20,
        ),
        requiresAttunement: raw.requiresAttunement,
        maximumCharges:
          raw.maximumCharges == null
            ? null
            : integer(
                raw.maximumCharges,
                `items[${index}].mechanics.maximumCharges`,
                0,
                100_000,
              ),
        maximumDurability:
          raw.maximumDurability == null
            ? null
            : integer(
                raw.maximumDurability,
                `items[${index}].mechanics.maximumDurability`,
                1,
                100_000,
              ),
      };
    }
    return {
      key: key(row.key, "item.key"),
      name: text(row.name, "item.name", 200),
      description: text(row.description, "item.description"),
      tags: textArray(row.tags, "item.tags", 64),
      grantedActionKeys,
      ...(mechanics ? { mechanics } : {}),
    };
  });
  uniqueKeys(items, "items");

  const advancement = object(root.advancement, "advancement");
  const advancementFields = [
    "currencyKey",
    "currencyName",
    "awardPerMilestone",
    "attributeIncreaseCost",
    "maximumAttributeValue",
  ];
  for (const optional of [
    "progressionModel",
    "skillIncreaseCost",
    "maximumSkillValue",
    "levelIncreaseCost",
    "maximumLevel",
    "rankOrder",
    "rankIncreaseCost",
  ]) {
    if (Object.prototype.hasOwnProperty.call(advancement, optional))
      advancementFields.push(optional);
  }
  exact(advancement, advancementFields, "advancement");
  key(advancement.currencyKey, "advancement.currencyKey");
  text(advancement.currencyName, "advancement.currencyName", 200);
  integer(advancement.awardPerMilestone, "advancement.awardPerMilestone", 0);
  integer(
    advancement.attributeIncreaseCost,
    "advancement.attributeIncreaseCost",
    1,
  );
  finite(
    advancement.maximumAttributeValue,
    "advancement.maximumAttributeValue",
  );
  const progressionModel =
    advancement.progressionModel == null
      ? null
      : enumValue(
          advancement.progressionModel,
          ["numeric-level", "rank", "point-buy", "classless"] as const,
          "advancement.progressionModel",
        );
  if (advancement.skillIncreaseCost != null)
    integer(advancement.skillIncreaseCost, "advancement.skillIncreaseCost", 1);
  if (advancement.maximumSkillValue != null)
    finite(advancement.maximumSkillValue, "advancement.maximumSkillValue", 0);
  if (advancement.levelIncreaseCost != null)
    integer(advancement.levelIncreaseCost, "advancement.levelIncreaseCost", 1);
  if (advancement.maximumLevel != null)
    integer(advancement.maximumLevel, "advancement.maximumLevel", 1);
  if (advancement.rankIncreaseCost != null)
    integer(advancement.rankIncreaseCost, "advancement.rankIncreaseCost", 1);
  const rankOrder =
    advancement.rankOrder == null
      ? []
      : keyArray(advancement.rankOrder, "advancement.rankOrder", 32);
  if (progressionModel === "rank" && rankOrder.length < 2)
    fail("阶位成长必须声明至少两个 rankOrder");
  if (progressionModel !== "rank" && rankOrder.length)
    fail("非阶位成长不得声明 rankOrder");
  if (progressionModel === "numeric-level" && advancement.maximumLevel == null)
    fail("等级成长必须声明 maximumLevel");

  const sheet = object(root.characterSheetUi, "characterSheetUi");
  exact(sheet, ["sections"], "characterSheetUi");
  const knownSheetKeys = new Set([
    ...attributeKeys,
    ...derivedStats.map((row) => row.key),
    ...resourceKeys,
  ]);
  const sectionKeys = array(
    sheet.sections,
    "characterSheetUi.sections",
    32,
  ).map((value, index) => {
    const row = object(value, `characterSheetUi.sections[${index}]`);
    exact(
      row,
      ["key", "title", "fieldKeys"],
      `characterSheetUi.sections[${index}]`,
    );
    const fieldKeys = keyArray(row.fieldKeys, "characterSheetUi.fieldKeys", 64);
    validateKnown(fieldKeys, knownSheetKeys, "characterSheetUi.fieldKeys");
    return key(row.key, "characterSheetUi.section.key");
  });
  if (new Set(sectionKeys).size !== sectionKeys.length)
    fail("characterSheetUi section key 重复");

  const compendiumKeys = array(root.compendium, "compendium", 512).map(
    (value, index) => {
      const row = object(value, `compendium[${index}]`);
      exact(
        row,
        ["key", "title", "category", "body", "relatedKeys"],
        `compendium[${index}]`,
      );
      text(row.title, "compendium.title", 300);
      enumValue(
        row.category,
        [
          "core",
          "check",
          "combat",
          "condition",
          "item",
          "advancement",
          "safety",
        ] as const,
        "compendium.category",
      );
      text(row.body, "compendium.body", 20_000);
      keyArray(row.relatedKeys, "compendium.relatedKeys", 128);
      return key(row.key, "compendium.key");
    },
  );
  if (new Set(compendiumKeys).size !== compendiumKeys.length)
    fail("compendium key 重复");

  array(root.migrations, "migrations", 64).forEach((value, index) => {
    const row = object(value, `migrations[${index}]`);
    exact(
      row,
      ["fromVersion", "toVersion", "compatibility", "notes"],
      `migrations[${index}]`,
    );
    text(row.fromVersion, "migration.fromVersion", 100);
    text(row.toVersion, "migration.toVersion", 100);
    enumValue(
      row.compatibility,
      ["compatible", "migration-required", "breaking"] as const,
      "migration.compatibility",
    );
    text(row.notes, "migration.notes");
  });

  const fixtureKeys = array(root.tests, "tests", 128).map((value, index) => {
    const row = object(value, `tests[${index}]`);
    exact(
      row,
      [
        "fixtureKey",
        "attributes",
        "expectedDerivedStats",
        "expectedResourceMaximums",
      ],
      `tests[${index}]`,
    );
    const fixtureAttributes = object(
      row.attributes,
      `tests[${index}].attributes`,
    );
    const expectedDerived = object(
      row.expectedDerivedStats,
      `tests[${index}].expectedDerivedStats`,
    );
    const expectedResources = object(
      row.expectedResourceMaximums,
      `tests[${index}].expectedResourceMaximums`,
    );
    validateKnown(
      Object.keys(fixtureAttributes),
      attributeKeys,
      `tests[${index}].attributes`,
    );
    validateKnown(
      Object.keys(expectedDerived),
      new Set(derivedStats.map((item) => item.key)),
      `tests[${index}].expectedDerivedStats`,
    );
    validateKnown(
      Object.keys(expectedResources),
      resourceKeys,
      `tests[${index}].expectedResourceMaximums`,
    );
    Object.entries(fixtureAttributes).forEach(([name, number]) =>
      finite(number, `tests[${index}].attributes.${name}`),
    );
    Object.entries(expectedDerived).forEach(([name, number]) =>
      finite(number, `tests[${index}].expectedDerivedStats.${name}`),
    );
    Object.entries(expectedResources).forEach(([name, number]) =>
      finite(number, `tests[${index}].expectedResourceMaximums.${name}`),
    );
    return key(row.fixtureKey, `tests[${index}].fixtureKey`);
  });
  if (!fixtureKeys.length || new Set(fixtureKeys).size !== fixtureKeys.length)
    fail("tests 必须存在且 fixtureKey 唯一");

  text(root.ruleSystemId, "ruleSystemId", 128);
  text(root.ruleSystemVersion, "ruleSystemVersion", 128);
  text(root.title, "title", 300);
  text(root.description, "description", 10_000);
  return structuredClone(root) as unknown as RulePackV1;
}

export function runRulePackFixturesV1(
  rulePackValue: RulePackV1 | unknown,
): void {
  const rulePack = parseRulePackV1(rulePackValue);
  for (const fixture of rulePack.tests) {
    for (const stat of rulePack.derivedStats) {
      const expected = fixture.expectedDerivedStats[stat.key];
      if (expected == null) continue;
      let actual = evaluateRuleNumberExpressionV1(
        stat.formula,
        fixture.attributes,
      );
      if (stat.minimum != null) actual = Math.max(stat.minimum, actual);
      if (stat.maximum != null) actual = Math.min(stat.maximum, actual);
      if (actual !== expected)
        fail(
          `fixture ${fixture.fixtureKey} 派生值 ${stat.key}: ${actual} != ${expected}`,
        );
    }
    for (const resource of rulePack.resources) {
      const expected = fixture.expectedResourceMaximums[resource.key];
      if (expected == null) continue;
      const actual = evaluateRuleNumberExpressionV1(
        resource.maximumFormula,
        fixture.attributes,
      );
      if (actual !== expected)
        fail(
          `fixture ${fixture.fixtureKey} 资源 ${resource.key}: ${actual} != ${expected}`,
        );
    }
  }
}

export interface RuleCheckResolutionV1 {
  checkKey: string;
  attributeKey: string;
  diceModelKey: string;
  mode: Exclude<TtrpgResolutionRequestV2["mode"], "fixed/no-roll">;
  dice: number[];
  keptDice: number[];
  attributeModifier: number;
  situationalModifier: number;
  total: number;
  difficulty: number;
  degree: TtrpgDegreeV2;
  successes: number | null;
  winnerRef: string | null;
  tiedRefs: string[];
  calculationTrace: string[];
  opponent: null | {
    contestantRef: string;
    attributeKey: string;
    dice: number[];
    keptDice: number[];
    attributeModifier: number;
    total: number;
    degree: TtrpgDegreeV2;
    rollTrace: TtrpgDiceRollTraceV2;
    proofHash: string;
  };
  rollTrace: TtrpgDiceRollTraceV2;
  seedCommitment: string;
  nonce: string;
  proofHash: string;
}

export interface RuleDiceResolutionV1 {
  diceModelKey: string;
  dice: number[];
  keptDice: number[];
  modifier: number;
  total: number;
  rollTrace: TtrpgDiceRollTraceV2;
  seedCommitment: string;
  nonce: string;
  proofHash: string;
}

export async function commitRulePackDiceSeedV2(seed: string): Promise<string> {
  if (typeof seed !== "string" || !seed.trim() || seed.length > 10_000)
    fail("dice.seed 无效");
  return hashProductProductionValueV2({ seed });
}

async function deterministicRuleDice(input: {
  rulePack: RulePackV1;
  diceModelKey: string;
  seed: string;
  nonce: string;
  modifier: number;
  countOverride?: number;
}): Promise<RuleDiceResolutionV1> {
  const model = input.rulePack.diceModels.find(
    (row) => row.key === input.diceModelKey,
  );
  if (!model) fail(`未知骰型:${input.diceModelKey}`);
  finite(input.modifier, "dice.modifier", -1_000, 1_000);
  const count =
    input.countOverride == null
      ? model.count
      : integer(input.countOverride, "dice.countOverride", 1, 100);
  const material = `${input.rulePack.ruleSystemId}\u0000${input.rulePack.ruleSystemVersion}\u0000${input.seed}\u0000${input.nonce}\u0000${model.key}${input.countOverride == null ? "" : `\u0000count=${count}`}`;
  const sampled = await sampleTtrpgDiceWithSha256V2({
    count,
    sides: model.sides,
    materialForBlock: (blockIndex) => `${material}\u0000${blockIndex}`,
  });
  const dice = sampled.dice;
  const keptDice =
    model.keep === "all"
      ? dice
      : [model.keep === "highest" ? Math.max(...dice) : Math.min(...dice)];
  const basis = {
    diceModelKey: model.key,
    dice,
    keptDice,
    modifier: input.modifier,
    total: keptDice.reduce((sum, die) => sum + die, input.modifier),
    rollTrace: sampled.trace,
    seedCommitment: await commitRulePackDiceSeedV2(input.seed),
    nonce: input.nonce,
  };
  return { ...basis, proofHash: await hashProductProductionValueV2(basis) };
}

export async function resolveRulePackDiceModelV1(input: {
  rulePack: RulePackV1;
  diceModelKey: string;
  seed: string;
  nonce: string;
  modifier?: number;
}): Promise<RuleDiceResolutionV1> {
  return deterministicRuleDice({
    rulePack: parseRulePackV1(input.rulePack),
    diceModelKey: input.diceModelKey,
    seed: input.seed,
    nonce: input.nonce,
    modifier: input.modifier ?? 0,
  });
}

export async function verifyRulePackDiceResolutionV2(input: {
  rulePack: RulePackV1;
  diceModelKey: string;
  seed: string;
  nonce: string;
  modifier?: number;
  resolution: RuleDiceResolutionV1;
}): Promise<boolean> {
  try {
    if (
      input.resolution.seedCommitment !==
        (await commitRulePackDiceSeedV2(input.seed)) ||
      input.resolution.nonce !== input.nonce
    )
      return false;
    const expected = await resolveRulePackDiceModelV1(input);
    return (
      (await hashProductProductionValueV2(expected)) ===
      (await hashProductProductionValueV2(input.resolution))
    );
  } catch {
    return false;
  }
}

export async function resolveRulePackCheckV1(input: {
  rulePack: RulePackV1;
  checkKey: string;
  attributeKey: string;
  attributes: Record<string, number>;
  seed: string;
  nonce: string;
  difficulty?: number;
  situationalModifier?: number;
  contestantRef?: string;
  opponent?: {
    contestantRef: string;
    attributeKey: string;
    attributes: Record<string, number>;
    /** Skill, conditions and other target-side modifiers for opposed checks. */
    situationalModifier?: number;
  };
}): Promise<RuleCheckResolutionV1> {
  const pack = parseRulePackV1(input.rulePack);
  const check = pack.checks.find((row) => row.key === input.checkKey);
  if (!check) fail(`未知检定:${input.checkKey}`);
  if (!check.attributeKeys.includes(input.attributeKey))
    fail(`检定 ${input.checkKey} 不允许属性 ${input.attributeKey}`);
  const attribute = pack.attributes.find(
    (row) => row.key === input.attributeKey,
  );
  const derived = pack.derivedStats.find(
    (row) => row.key === input.attributeKey,
  );
  if (!attribute && !derived) fail(`未知角色检定数值 ${input.attributeKey}`);
  const attributeModifier = input.attributes[input.attributeKey];
  if (
    !Number.isFinite(attributeModifier) ||
    (attribute != null &&
      (attributeModifier < attribute.minimum ||
        attributeModifier > attribute.maximum)) ||
    (derived?.minimum != null && attributeModifier < derived.minimum) ||
    (derived?.maximum != null && attributeModifier > derived.maximum)
  ) {
    fail(`角色属性 ${input.attributeKey} 无效`);
  }
  const model = pack.diceModels.find((row) => row.key === check.diceModelKey)!;
  const situationalModifier = input.situationalModifier ?? 0;
  finite(situationalModifier, "situationalModifier", -1_000, 1_000);
  const resolver: RuleCheckResolverV2 =
    "resolver" in check
      ? check.resolver
      : {
          mode: "total-vs-target",
          defaultDifficulty: check.defaultDifficulty,
          criticalSuccessMargin: check.criticalSuccessMargin,
          criticalFailureMargin: check.criticalFailureMargin,
          partialSuccessWindow: 0,
        };
  let difficulty: number;
  let resolvedDice: RuleDiceResolutionV1;
  let genericOutcome: ReturnType<typeof resolveTtrpgResolutionV2>;
  let opponent: RuleCheckResolutionV1["opponent"] = null;
  if (resolver.mode === "roll-under") {
    difficulty =
      input.difficulty ??
      resolver.defaultDifficulty ??
      attributeModifier + situationalModifier;
    integer(difficulty, "difficulty", 1, 100);
    resolvedDice = await deterministicRuleDice({
      rulePack: pack,
      diceModelKey: model.key,
      seed: input.seed,
      nonce: `${input.nonce}:${check.key}:${input.attributeKey}`,
      modifier: 0,
    });
    if (resolvedDice.keptDice.length !== 1)
      fail("roll-under 检定必须只保留一颗 d100");
    const hardSuccessMaximum = Math.max(
      1,
      Math.floor(difficulty / resolver.hardDivisor),
    );
    const extremeSuccessMaximum = Math.max(
      1,
      Math.floor(difficulty / resolver.extremeDivisor),
    );
    genericOutcome = resolveTtrpgResolutionV2({
      mode: "roll-under",
      roll: resolvedDice.keptDice[0],
      successMaximum: difficulty,
      hardSuccessMaximum,
      extremeSuccessMaximum,
      criticalSuccessMaximum: Math.min(
        resolver.criticalSuccessMaximum,
        extremeSuccessMaximum,
      ),
      criticalFailureMinimum: Math.max(
        resolver.criticalFailureMinimum,
        difficulty,
      ),
    });
  } else if (resolver.mode === "success-pool") {
    difficulty = input.difficulty ?? resolver.defaultDifficulty;
    integer(difficulty, "difficulty", 1, 100);
    const diceCount = Math.max(
      resolver.minimumDice,
      Math.min(
        resolver.maximumDice,
        Math.round(
          attributeModifier * resolver.dicePerAttributePoint +
            situationalModifier,
        ),
      ),
    );
    resolvedDice = await deterministicRuleDice({
      rulePack: pack,
      diceModelKey: model.key,
      seed: input.seed,
      nonce: `${input.nonce}:${check.key}:${input.attributeKey}`,
      modifier: 0,
      countOverride: diceCount,
    });
    genericOutcome = resolveTtrpgResolutionV2({
      mode: "success-pool",
      dice: resolvedDice.keptDice,
      sides: model.sides,
      successAtOrAbove: resolver.successAtOrAbove,
      criticalAtOrAbove: resolver.criticalAtOrAbove,
      criticalBonusSuccesses: resolver.criticalBonusSuccesses,
      botchAtOrBelow: resolver.botchAtOrBelow,
      botchesCancel: resolver.botchesCancel,
      requiredSuccesses: difficulty,
      criticalSuccesses: resolver.criticalSuccesses,
      criticalFailureBotches: resolver.criticalFailureBotches,
    });
  } else {
    difficulty = input.difficulty ?? resolver.defaultDifficulty;
    finite(difficulty, "difficulty", -1_000, 1_000);
    resolvedDice = await deterministicRuleDice({
      rulePack: pack,
      diceModelKey: model.key,
      seed: input.seed,
      nonce: `${input.nonce}:${check.key}:${input.attributeKey}`,
      modifier: attributeModifier + situationalModifier,
    });
    const actingOutcome = applyNaturalFaceOverrideV2(
      resolveTtrpgResolutionV2({
        mode: "total-vs-target",
        total: resolvedDice.total,
        target: difficulty,
        criticalSuccessMargin: resolver.criticalSuccessMargin,
        criticalFailureMargin: resolver.criticalFailureMargin,
        partialSuccessWindow: resolver.partialSuccessWindow,
      }),
      resolver,
      resolvedDice.keptDice,
    );
    if (resolver.mode === "total-vs-target") {
      genericOutcome = actingOutcome;
    } else {
      if (!input.opponent) fail("opposed 检定必须提供目标角色属性");
      const opponentAttributeKey = key(
        input.opponent.attributeKey,
        "opponent.attributeKey",
      );
      if (!check.attributeKeys.includes(opponentAttributeKey)) {
        fail(`检定 ${input.checkKey} 不允许目标属性 ${opponentAttributeKey}`);
      }
      const opponentDefinition = pack.attributes.find(
        (row) => row.key === opponentAttributeKey,
      );
      const opponentDerived = pack.derivedStats.find(
        (row) => row.key === opponentAttributeKey,
      );
      if (!opponentDefinition && !opponentDerived)
        fail(`未知目标检定数值 ${opponentAttributeKey}`);
      const opponentModifier = input.opponent.attributes[opponentAttributeKey];
      const opponentSituationalModifier =
        input.opponent.situationalModifier ?? 0;
      finite(
        opponentSituationalModifier,
        "opponent.situationalModifier",
        -1_000,
        1_000,
      );
      if (
        !Number.isFinite(opponentModifier) ||
        (opponentDefinition != null &&
          (opponentModifier < opponentDefinition.minimum ||
            opponentModifier > opponentDefinition.maximum)) ||
        (opponentDerived?.minimum != null &&
          opponentModifier < opponentDerived.minimum) ||
        (opponentDerived?.maximum != null &&
          opponentModifier > opponentDerived.maximum)
      ) {
        fail(`目标属性 ${opponentAttributeKey} 无效`);
      }
      const opponentRef = key(
        input.opponent.contestantRef,
        "opponent.contestantRef",
      );
      const actorRef = key(input.contestantRef ?? "actor", "contestantRef");
      if (opponentRef === actorRef) fail("opposed 参与者引用不得相同");
      const opponentDice = await deterministicRuleDice({
        rulePack: pack,
        diceModelKey: model.key,
        seed: input.seed,
        nonce: `${input.nonce}:${check.key}:${opponentAttributeKey}:${opponentRef}`,
        modifier: opponentModifier + opponentSituationalModifier,
      });
      const opponentOutcome = applyNaturalFaceOverrideV2(
        resolveTtrpgResolutionV2({
          mode: "total-vs-target",
          total: opponentDice.total,
          target: difficulty,
          criticalSuccessMargin: resolver.criticalSuccessMargin,
          criticalFailureMargin: resolver.criticalFailureMargin,
          partialSuccessWindow: resolver.partialSuccessWindow,
        }),
        resolver,
        opponentDice.keptDice,
      );
      genericOutcome = resolveTtrpgResolutionV2({
        mode: "opposed",
        contestants: [
          {
            contestantRef: actorRef,
            degree: actingOutcome.degree,
            total: resolvedDice.total,
            margin: actingOutcome.margin!,
          },
          {
            contestantRef: opponentRef,
            degree: opponentOutcome.degree,
            total: opponentDice.total,
            margin: opponentOutcome.margin!,
          },
        ],
        tieBreak: resolver.tieBreak,
      });
      opponent = {
        contestantRef: opponentRef,
        attributeKey: opponentAttributeKey,
        dice: opponentDice.dice,
        keptDice: opponentDice.keptDice,
        attributeModifier: opponentModifier + opponentSituationalModifier,
        total: opponentDice.total,
        degree: opponentOutcome.degree,
        rollTrace: opponentDice.rollTrace,
        proofHash: opponentDice.proofHash,
      };
      if (genericOutcome.winnerRef !== actorRef) {
        genericOutcome = {
          ...genericOutcome,
          degree:
            genericOutcome.winnerRef == null
              ? genericOutcome.degree
              : actingOutcome.degree === "critical-failure"
                ? "critical-failure"
                : "failure",
          succeeded:
            genericOutcome.winnerRef == null ? genericOutcome.succeeded : false,
        };
      }
    }
  }
  const { dice, keptDice, total, rollTrace } = resolvedDice;
  const degree = genericOutcome.degree;
  const basis = {
    checkKey: check.key,
    attributeKey: input.attributeKey,
    diceModelKey: model.key,
    mode: resolver.mode,
    dice,
    keptDice,
    attributeModifier,
    situationalModifier,
    total,
    difficulty,
    degree,
    successes: genericOutcome.successes,
    winnerRef: genericOutcome.winnerRef,
    tiedRefs: genericOutcome.tiedRefs,
    calculationTrace: genericOutcome.calculationTrace,
    opponent,
    rollTrace,
    seedCommitment: await commitRulePackDiceSeedV2(input.seed),
    nonce: input.nonce,
  };
  return { ...basis, proofHash: await hashProductProductionValueV2(basis) };
}

export async function verifyRulePackCheckResolutionV2(input: {
  rulePack: RulePackV1;
  checkKey: string;
  attributeKey: string;
  attributes: Record<string, number>;
  seed: string;
  nonce: string;
  difficulty?: number;
  situationalModifier?: number;
  contestantRef?: string;
  opponent?: {
    contestantRef: string;
    attributeKey: string;
    attributes: Record<string, number>;
    situationalModifier?: number;
  };
  resolution: RuleCheckResolutionV1;
}): Promise<boolean> {
  try {
    if (
      input.resolution.seedCommitment !==
        (await commitRulePackDiceSeedV2(input.seed)) ||
      input.resolution.nonce !== input.nonce
    )
      return false;
    const expected = await resolveRulePackCheckV1({
      rulePack: input.rulePack,
      checkKey: input.checkKey,
      attributeKey: input.attributeKey,
      attributes: input.attributes,
      seed: input.seed,
      nonce: input.nonce,
      difficulty: input.difficulty,
      situationalModifier: input.situationalModifier,
      contestantRef: input.contestantRef,
      opponent: input.opponent,
    });
    return (
      (await hashProductProductionValueV2(expected)) ===
      (await hashProductProductionValueV2(input.resolution))
    );
  } catch {
    return false;
  }
}
