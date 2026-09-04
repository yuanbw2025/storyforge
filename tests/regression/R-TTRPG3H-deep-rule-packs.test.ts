import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  RulePackV1,
  ProductWorldSourceSelectionV1,
  WorkspaceScope,
} from "../../src/lib/types";
import { createD20FantasyRulePackV1 } from "../../src/lib/ttrpg/d20-fantasy-rule-pack";
import { createD100InvestigationRulePackV1 } from "../../src/lib/ttrpg/d100-investigation-rule-pack";
import { createStoryForgeRulePackV1 } from "../../src/lib/ttrpg/storyforge-rule-pack";
import {
  parseRulePackV1,
  resolveRulePackCheckV1,
  ruleCheckDifficultyOptionsV2,
  verifyRulePackCheckResolutionV2,
} from "../../src/lib/ttrpg/rule-pack";
import { previewTtrpgCheckProbabilityV2 } from "../../src/lib/ttrpg/house-rule";
import {
  compileTtrpgProductionBriefV2,
  resolveTtrpgProductionRulePackV2,
} from "../../src/lib/ttrpg/production-brief";
import { CURRENT_PRODUCT_RESOURCE_KEYS, currentProductSelection } from "../helpers/current-product-world";

const scope: WorkspaceScope = { projectId: 1, worldId: 1, workId: 1 };
const WORLD_HASH = "a".repeat(64);

function selection(): ProductWorldSourceSelectionV1 {
  return currentProductSelection("ttrpg", {
    participants: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
    locations: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
    quests: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
  });
}

const d20Values = {
  "strength-check": 8,
  "dexterity-check": 6,
  "constitution-check": 7,
  "intelligence-check": 5,
  "wisdom-check": 4,
  "charisma-check": 3,
};

describe("R-TTRPG-3H · executable deep rule packs", () => {
  it("5E-compatible built-in freezes current SRD attribution, d20 limits, progression and all three roll modes", async () => {
    const pack = createD20FantasyRulePackV1();
    expect(pack.license).toMatchObject({
      licenseId: "CC-BY-4.0-SRD-5.2.1",
      commercialUse: true,
      derivativesAllowed: true,
      sourceUrl: "https://www.dndbeyond.com/srd",
    });
    expect(pack.license.attribution).toBe(
      "This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.",
    );
    expect(
      Math.max(...pack.diceModels.map((model) => model.sides)),
    ).toBeLessThanOrEqual(100);
    expect(pack.advancement).toMatchObject({
      progressionModel: "numeric-level",
      maximumLevel: 20,
    });

    const normal = await resolveRulePackCheckV1({
      rulePack: pack,
      checkKey: "ability",
      attributeKey: "strength-check",
      attributes: d20Values,
      seed: "deep-d20-seed",
      nonce: "normal",
    });
    const advantage = await resolveRulePackCheckV1({
      rulePack: pack,
      checkKey: "ability-advantage",
      attributeKey: "strength-check",
      attributes: d20Values,
      seed: "deep-d20-seed",
      nonce: "advantage",
    });
    const disadvantage = await resolveRulePackCheckV1({
      rulePack: pack,
      checkKey: "ability-disadvantage",
      attributeKey: "strength-check",
      attributes: d20Values,
      seed: "deep-d20-seed",
      nonce: "disadvantage",
    });
    expect(normal.dice).toHaveLength(1);
    expect(advantage.dice).toHaveLength(2);
    expect(advantage.keptDice).toEqual([Math.max(...advantage.dice)]);
    expect(disadvantage.dice).toHaveLength(2);
    expect(disadvantage.keptDice).toEqual([Math.min(...disadvantage.dice)]);
    await expect(
      verifyRulePackCheckResolutionV2({
        rulePack: pack,
        checkKey: "ability-advantage",
        attributeKey: "strength-check",
        attributes: d20Values,
        seed: "deep-d20-seed",
        nonce: "advantage",
        resolution: advantage,
      }),
    ).resolves.toBe(true);
  });

  it("natural 20/1 override total margins, and opposed checks retain verifiable receipts for both contestants", async () => {
    const pack = createD20FantasyRulePackV1();
    let naturalTwenty: Awaited<
      ReturnType<typeof resolveRulePackCheckV1>
    > | null = null;
    let naturalOne: Awaited<ReturnType<typeof resolveRulePackCheckV1>> | null =
      null;
    for (
      let index = 0;
      index < 500 && (!naturalTwenty || !naturalOne);
      index += 1
    ) {
      const result = await resolveRulePackCheckV1({
        rulePack: pack,
        checkKey: "ability",
        attributeKey: "strength-check",
        attributes: d20Values,
        seed: `natural-face-${index}`,
        nonce: "d20",
        difficulty: 15,
      });
      if (result.keptDice[0] === 20) naturalTwenty = result;
      if (result.keptDice[0] === 1) naturalOne = result;
    }
    expect(naturalTwenty?.degree).toBe("critical-success");
    expect(naturalTwenty?.calculationTrace.at(-1)).toContain("natural-face 20");
    expect(naturalOne?.degree).toBe("critical-failure");
    expect(naturalOne?.calculationTrace.at(-1)).toContain("natural-face 1");

    const opposed = await resolveRulePackCheckV1({
      rulePack: pack,
      checkKey: "opposed-ability",
      attributeKey: "strength-check",
      attributes: d20Values,
      contestantRef: "actor.hero",
      opponent: {
        contestantRef: "actor.rival",
        attributeKey: "strength-check",
        attributes: { ...d20Values, "strength-check": 6 },
      },
      seed: "opposed-seed",
      nonce: "grapple",
    });
    expect(opposed.mode).toBe("opposed");
    expect(opposed.opponent).toMatchObject({
      contestantRef: "actor.rival",
      attributeKey: "strength-check",
    });
    expect(opposed.opponent?.dice).toHaveLength(1);
    await expect(
      verifyRulePackCheckResolutionV2({
        rulePack: pack,
        checkKey: "opposed-ability",
        attributeKey: "strength-check",
        attributes: d20Values,
        contestantRef: "actor.hero",
        opponent: {
          contestantRef: "actor.rival",
          attributeKey: "strength-check",
          attributes: { ...d20Values, "strength-check": 6 },
        },
        seed: "opposed-seed",
        nonce: "grapple",
        resolution: opposed,
      }),
    ).resolves.toBe(true);
  });

  it("first-party d100 pack exercises all six outcome degrees and exposes correctly ordered difficulty presets", async () => {
    const pack = createD100InvestigationRulePackV1();
    const check = pack.checks.find((item) => item.key === "percent-check")!;
    expect(check).toMatchObject({
      resolver: { mode: "roll-under", hardDivisor: 2, extremeDivisor: 5 },
    });
    expect(ruleCheckDifficultyOptionsV2(check, 60)).toEqual({
      easy: 70,
      standard: 60,
      hard: 50,
    });
    const observed = new Set<string>();
    for (let index = 0; index < 1_500 && observed.size < 6; index += 1) {
      const result = await resolveRulePackCheckV1({
        rulePack: pack,
        checkKey: "percent-check",
        attributeKey: "investigation",
        attributes: { investigation: 60 },
        seed: `d100-degree-${index}`,
        nonce: "investigate",
      });
      observed.add(result.degree);
      expect(result.rollTrace.sides).toBe(100);
    }
    expect(observed).toEqual(
      new Set([
        "critical-success",
        "extreme-success",
        "hard-success",
        "success",
        "failure",
        "critical-failure",
      ]),
    );
    const preview = previewTtrpgCheckProbabilityV2({
      rulePack: pack,
      checkKey: "percent-check",
      attributeValue: 60,
    });
    expect(preview.method).toBe("exact");
    expect(preview.successProbability).toBeCloseTo(0.6, 10);
  });

  it("success-pool is executable through RulePack, dynamically sizes dice, and still rejects d101", async () => {
    const base = createStoryForgeRulePackV1();
    const poolPack: RulePackV1 = {
      ...base,
      ruleSystemId: "storyforge.test-pool",
      diceModels: [
        ...base.diceModels,
        { key: "pool-d10", name: "d10 骰池", count: 1, sides: 10, keep: "all" },
      ],
      checks: [
        ...base.checks,
        {
          key: "pool",
          name: "骰池检定",
          diceModelKey: "pool-d10",
          attributeKeys: ["body"],
          resolver: {
            mode: "success-pool",
            defaultDifficulty: 2,
            dicePerAttributePoint: 2,
            minimumDice: 1,
            maximumDice: 20,
            successAtOrAbove: 7,
            criticalAtOrAbove: 10,
            criticalBonusSuccesses: 1,
            botchAtOrBelow: 1,
            botchesCancel: true,
            criticalSuccesses: 4,
            criticalFailureBotches: 2,
          },
        },
      ],
    };
    const parsed = parseRulePackV1(poolPack);
    const result = await resolveRulePackCheckV1({
      rulePack: parsed,
      checkKey: "pool",
      attributeKey: "body",
      attributes: { body: 3 },
      seed: "pool-seed",
      nonce: "pool-action",
    });
    expect(result.mode).toBe("success-pool");
    expect(result.dice).toHaveLength(6);
    expect(result.successes).not.toBeNull();
    expect(() =>
      parseRulePackV1({
        ...poolPack,
        diceModels: poolPack.diceModels.map((model) =>
          model.key === "pool-d10" ? { ...model, sides: 101 } : model,
        ),
      }),
    ).toThrow(/d2～d100|sides|骰/i);
  });

  it.each([
    ["builtin-d20-fantasy", "storyforge.d20-fantasy-srd-5.2.1", "1"],
    ["builtin-d100-investigation", "storyforge.d100-investigation", "规则默认"],
  ] as const)(
    "%s is selectable in world-to-TTRPG production and re-resolves its frozen hash",
    async (origin, ruleSystemId, startingLevelOrTier) => {
      const brief = await compileTtrpgProductionBriefV2({
        scope,
        selection: selection(),
        worldContentHash: WORLD_HASH,
        title: "深规则生产",
        premise: "把冻结世界改编为可玩的规则战役。",
        tone: ["冒险"],
        scale: {
          scope: "chapter",
          targetPlayMinutes: 180,
          targetEndingCount: 2,
        },
        contentBoundaries: ["安全"],
        confirmDefaultMappings: true,
        draft: { rules: { origin } },
      });
      expect(brief.rules).toMatchObject({ origin, ruleSystemId });
      expect(brief.characters.startingLevelOrTier).toBe(startingLevelOrTier);
      const resolved = await resolveTtrpgProductionRulePackV2({ scope, brief });
      expect(resolved.ruleSystemId).toBe(ruleSystemId);
    },
  );

  it("production wizard surfaces both deep built-ins and retains the hard d100 ceiling", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/ttrpg/TtrpgProductionWizard.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('value="builtin-d20-fantasy"');
    expect(source).toContain('value="builtin-d100-investigation"');
    expect(source).toContain("max={100}");
  });
});
