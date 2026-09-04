import type { RuleNumberExpressionV1, RulePackV1 } from "../types";
import { parseRulePackV1, runRulePackFixturesV1 } from "./rule-pack";

const constant = (value: number): RuleNumberExpressionV1 => ({
  op: "constant",
  value,
});
const attribute = (key: string): RuleNumberExpressionV1 => ({
  op: "attribute",
  key,
});
const add = (...values: RuleNumberExpressionV1[]): RuleNumberExpressionV1 => ({
  op: "add",
  values,
});
const multiply = (
  left: RuleNumberExpressionV1,
  right: RuleNumberExpressionV1,
): RuleNumberExpressionV1 => ({ op: "multiply", left, right });
const floorDivide = (
  value: RuleNumberExpressionV1,
  divisor: number,
): RuleNumberExpressionV1 => ({ op: "floor-divide", value, divisor });
const abilityModifier = (key: string): RuleNumberExpressionV1 =>
  floorDivide(add(attribute(key), constant(-10)), 2);
const proficiencyBonus = (): RuleNumberExpressionV1 =>
  add(constant(2), floorDivide(add(attribute("level"), constant(-1)), 4));
const trainedCheck = (key: string): RuleNumberExpressionV1 =>
  add(abilityModifier(key), proficiencyBonus());
const unlimited = () => ({
  mode: "unlimited" as const,
  maximum: null,
  resourceKey: null,
  cost: null,
  sharedPoolKey: null,
  cooldownRounds: null,
  reset: [],
});
const itemMechanics = (category: string, stackable = false) => ({
  category,
  stackPolicy: stackable ? "stackable" as const : "unique" as const,
  maxStack: stackable ? 10 : 1,
  weight: null,
  equipSlots: [],
  requiresAttunement: false,
  maximumCharges: null,
  maximumDurability: null,
});

const SRD_5_2_1_ATTRIBUTION =
  "This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.";

const d20Resolver = {
  mode: "total-vs-target" as const,
  defaultDifficulty: 15,
  criticalSuccessMargin: 10,
  criticalFailureMargin: 10,
  partialSuccessWindow: 0,
  naturalCriticalSuccessAtOrAbove: 20,
  naturalCriticalFailureAtOrBelow: 1,
};

const opposedResolver = {
  mode: "opposed" as const,
  defaultDifficulty: 10,
  criticalSuccessMargin: 10,
  criticalFailureMargin: 10,
  partialSuccessWindow: 0,
  tieBreak: "higher-total" as const,
  naturalCriticalSuccessAtOrAbove: 20,
  naturalCriticalFailureAtOrBelow: 1,
};

const CHECK_TRAITS = [
  "strength-check",
  "dexterity-check",
  "constitution-check",
  "intelligence-check",
  "wisdom-check",
  "charisma-check",
] as const;

/**
 * Playable 5E-compatible core subset. It intentionally contains only the
 * mechanics StoryForge can execute and verify end-to-end; campaign prose,
 * settings and non-SRD content remain StoryForge/user-authored.
 */
export const STORYFORGE_D20_FANTASY_RULE_PACK_V1: RulePackV1 = {
  schema: "storyforge.rule-pack",
  version: 1,
  ruleSystemId: "storyforge.d20-fantasy-srd-5.2.1",
  ruleSystemVersion: "1.0.0",
  title: "StoryForge 5E 兼容奇幻核心",
  description:
    "可执行的 d20 奇幻核心：六项能力、熟练加值、优势/劣势、对抗、生命、行动、反应、短休与 1～20 级成长。规则结算和骰子证明由确定性引擎完成。",
  license: {
    licenseId: "CC-BY-4.0-SRD-5.2.1",
    name: "Creative Commons Attribution 4.0 International",
    attribution: SRD_5_2_1_ATTRIBUTION,
    commercialUse: true,
    derivativesAllowed: true,
    sourceUrl: "https://www.dndbeyond.com/srd",
  },
  attributes: [
    {
      key: "level",
      name: "等级",
      description: "角色当前等级，决定熟练加值和部分资源。",
      minimum: 1,
      maximum: 20,
      defaultValue: 1,
    },
    {
      key: "strength",
      name: "力量",
      description: "举、推、攀爬、近战和强行突破。",
      minimum: 3,
      maximum: 20,
      defaultValue: 10,
    },
    {
      key: "dexterity",
      name: "敏捷",
      description: "反应、潜行、平衡、远程和先攻。",
      minimum: 3,
      maximum: 20,
      defaultValue: 10,
    },
    {
      key: "constitution",
      name: "体质",
      description: "耐力、生命和对环境危害的承受。",
      minimum: 3,
      maximum: 20,
      defaultValue: 10,
    },
    {
      key: "intelligence",
      name: "智力",
      description: "回忆、研究、推理和技术知识。",
      minimum: 3,
      maximum: 20,
      defaultValue: 10,
    },
    {
      key: "wisdom",
      name: "感知",
      description: "观察、洞察、生存和直觉。",
      minimum: 3,
      maximum: 20,
      defaultValue: 10,
    },
    {
      key: "charisma",
      name: "魅力",
      description: "说服、欺瞒、威吓和领导。",
      minimum: 3,
      maximum: 20,
      defaultValue: 10,
    },
  ],
  derivedStats: [
    {
      key: "proficiency",
      name: "熟练加值",
      description: "随等级从 +2 成长至 +6。",
      formula: proficiencyBonus(),
      minimum: 2,
      maximum: 6,
    },
    {
      key: "strength-mod",
      name: "力量调整值",
      description: "用于武器伤害等不叠加熟练加值的机械结算。",
      formula: abilityModifier("strength"),
      minimum: -4,
      maximum: 5,
    },
    ...(
      [
        ["strength", "力量检定"],
        ["dexterity", "敏捷检定"],
        ["constitution", "体质检定"],
        ["intelligence", "智力检定"],
        ["wisdom", "感知检定"],
        ["charisma", "魅力检定"],
      ] as const
    ).map(([key, name]) => ({
      key: `${key}-check`,
      name,
      description: "能力调整值与熟练加值之和。",
      formula: trainedCheck(key),
      minimum: -2,
      maximum: 11,
    })),
    {
      key: "initiative",
      name: "先攻",
      description: "敏捷调整值。",
      formula: abilityModifier("dexterity"),
      minimum: -4,
      maximum: 5,
    },
    {
      key: "defense",
      name: "防御",
      description: "未着重甲时的基础防御。",
      formula: add(constant(10), abilityModifier("dexterity")),
      minimum: 6,
      maximum: 15,
    },
    {
      key: "load",
      name: "负重格",
      description: "可便利携带的重要物品数量。",
      formula: add(constant(5), abilityModifier("strength")),
      minimum: 1,
      maximum: 10,
    },
  ],
  diceModels: [
    { key: "d20", name: "d20", count: 1, sides: 20, keep: "all" },
    {
      key: "d20-advantage",
      name: "优势 d20",
      count: 2,
      sides: 20,
      keep: "highest",
    },
    {
      key: "d20-disadvantage",
      name: "劣势 d20",
      count: 2,
      sides: 20,
      keep: "lowest",
    },
    { key: "weapon-d8", name: "武器 d8", count: 1, sides: 8, keep: "all" },
  ],
  checks: [
    {
      key: "ability",
      name: "标准 d20 检定",
      diceModelKey: "d20",
      attributeKeys: [...CHECK_TRAITS],
      resolver: d20Resolver,
    },
    {
      key: "ability-advantage",
      name: "优势 d20 检定",
      diceModelKey: "d20-advantage",
      attributeKeys: [...CHECK_TRAITS],
      resolver: d20Resolver,
    },
    {
      key: "ability-disadvantage",
      name: "劣势 d20 检定",
      diceModelKey: "d20-disadvantage",
      attributeKeys: [...CHECK_TRAITS],
      resolver: d20Resolver,
    },
    {
      key: "opposed-ability",
      name: "对抗 d20 检定",
      diceModelKey: "d20",
      attributeKeys: [...CHECK_TRAITS],
      resolver: opposedResolver,
    },
  ],
  resources: [
    {
      key: "vigor",
      name: "生命",
      description: "归零后角色失去继续冒险的能力，后果由当前场景规则处理。",
      maximumFormula: add(
        constant(8),
        multiply(attribute("level"), constant(5)),
        abilityModifier("constitution"),
      ),
      initialMode: "maximum",
      minimum: 0,
    },
    {
      key: "heroic-dice",
      name: "英雄骰",
      description: "用于协助、特殊行动和团队配合的有限资源。",
      maximumFormula: add(constant(1), floorDivide(attribute("level"), 4)),
      initialMode: "maximum",
      minimum: 0,
    },
  ],
  conditions: [
    {
      key: "inspired",
      name: "受激励",
      description: "下一次相关检定获得 +2 公开修正。",
      stacking: "replace",
      maximumStacks: 1,
      defaultDurationRounds: 1,
      checkModifier: 2,
    },
    {
      key: "hindered",
      name: "受阻",
      description: "相关检定承受 -2 公开修正。",
      stacking: "replace",
      maximumStacks: 1,
      defaultDurationRounds: 1,
      checkModifier: -2,
    },
    {
      key: "guarded",
      name: "受护",
      description: "队友及时护援形成的短暂防护。",
      stacking: "replace",
      maximumStacks: 1,
      defaultDurationRounds: 1,
      checkModifier: 1,
    },
  ],
  actions: [
    {
      key: "investigate",
      name: "研究",
      description: "查阅知识、拆解机关或推演线索。",
      phase: "action",
      target: "scene",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        {
          kind: "check",
          checkKey: "ability",
          attributeKey: "intelligence-check",
        },
      ],
    },
    {
      key: "perceive",
      name: "观察",
      description: "搜寻异常、读取态度或追踪迹象。",
      phase: "action",
      target: "scene",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "ability", attributeKey: "wisdom-check" },
      ],
    },
    {
      key: "influence",
      name: "交涉",
      description: "说服、欺瞒、威吓或鼓舞一个目标。",
      phase: "action",
      target: "single-enemy",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "ability", attributeKey: "charisma-check" },
      ],
    },
    {
      key: "overcome",
      name: "强行突破",
      description: "以力量移动、破坏、攀爬或压制障碍。",
      phase: "action",
      target: "scene",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "ability", attributeKey: "strength-check" },
      ],
    },
    {
      key: "maneuver",
      name: "灵巧行动",
      description: "潜行、翻越、脱身或精准操作。",
      phase: "action",
      target: "scene",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "ability", attributeKey: "dexterity-check" },
      ],
    },
    {
      key: "endure",
      name: "抵抗",
      description: "抵抗毒素、严寒、疲劳或其他身体威胁。",
      phase: "action",
      target: "self",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        {
          kind: "check",
          checkKey: "ability",
          attributeKey: "constitution-check",
        },
      ],
    },
    {
      key: "strike",
      name: "攻击",
      description: "以标准 d20 检定命中后造成 d8 加力量调整值的伤害。",
      phase: "action",
      target: "single-enemy",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "ability", attributeKey: "strength-check" },
        {
          kind: "damage",
          resourceKey: "vigor",
          diceModelKey: "weapon-d8",
          modifierAttributeKey: "strength-mod",
        },
      ],
    },
    {
      key: "strike-advantage",
      name: "优势攻击",
      description: "掷两颗 d20 取高；命中后造成正常伤害。",
      phase: "action",
      target: "single-enemy",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        {
          kind: "check",
          checkKey: "ability-advantage",
          attributeKey: "strength-check",
        },
        {
          kind: "damage",
          resourceKey: "vigor",
          diceModelKey: "weapon-d8",
          modifierAttributeKey: "strength-mod",
        },
      ],
    },
    {
      key: "strike-disadvantage",
      name: "劣势攻击",
      description: "掷两颗 d20 取低；命中后造成正常伤害。",
      phase: "action",
      target: "single-enemy",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        {
          kind: "check",
          checkKey: "ability-disadvantage",
          attributeKey: "strength-check",
        },
        {
          kind: "damage",
          resourceKey: "vigor",
          diceModelKey: "weapon-d8",
          modifierAttributeKey: "strength-mod",
        },
      ],
    },
    {
      key: "grapple",
      name: "擒抱对抗",
      description: "双方进行可验证的力量对抗；平手保持现状。",
      phase: "action",
      target: "single-enemy",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        {
          kind: "check",
          checkKey: "opposed-ability",
          attributeKey: "strength-check",
        },
      ],
    },
    {
      key: "assist",
      name: "协助",
      description: "消耗 1 英雄骰，使一名同伴受激励。",
      phase: "action",
      target: "single-ally",
      costResourceKey: null,
      costAmount: 0,
      usage: {
        mode: "resource-cost",
        maximum: null,
        resourceKey: "heroic-dice",
        cost: 1,
        sharedPoolKey: null,
        cooldownRounds: null,
        reset: [],
      },
      effects: [{ kind: "condition", conditionKey: "inspired", stacks: 1 }],
    },
    {
      key: "protect",
      name: "护援反应",
      description: "在他人回合为同伴提供短暂防护。",
      phase: "reaction",
      target: "single-ally",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [{ kind: "condition", conditionKey: "guarded", stacks: 1 }],
    },
    {
      key: "death-recovery",
      name: "濒死恢复检定",
      description:
        "仅在生命降至 0 时进行体质检定；成功恢复 1 点生命。基础规则不消耗英雄骰，村规可把本行动改为一次资源检定。",
      phase: "action",
      target: "self",
      costResourceKey: "heroic-dice",
      costAmount: 0,
      usage: unlimited(),
      requirements: [
        {
          kind: "resource",
          resourceKey: "vigor",
          operator: "at-most",
          value: 0,
        },
      ],
      effects: [
        {
          kind: "check",
          checkKey: "ability",
          attributeKey: "constitution-check",
        },
        {
          kind: "resource",
          resourceKey: "vigor",
          delta: 1,
          appliesOnDegrees: ["success", "critical-success"],
          targetScope: "actor",
        },
      ],
    },
    {
      key: "second-wind",
      name: "重整旗鼓",
      description: "短休或长休后可再次使用，恢复 4 点生命。",
      phase: "downtime",
      target: "self",
      costResourceKey: null,
      costAmount: 0,
      usage: {
        mode: "charges",
        maximum: 1,
        resourceKey: null,
        cost: null,
        sharedPoolKey: null,
        cooldownRounds: null,
        reset: ["short-rest", "long-rest"],
      },
      effects: [{ kind: "resource", resourceKey: "vigor", delta: 4 }],
    },
  ],
  turnStructure: {
    initiativeDiceModelKey: "d20",
    initiativeAttributeKey: "initiative",
    phases: ["start", "action", "end"],
    actionsPerTurn: 1,
    reactionsPerRound: 1,
  },
  items: [
    {
      key: "adventuring-kit",
      name: "冒险工具包",
      description: "绳索、照明、书写和简单露营用品。",
      tags: ["tool", "travel"],
      grantedActionKeys: ["investigate", "perceive", "overcome"],
      mechanics: itemMechanics("tool"),
    },
    {
      key: "martial-weapon",
      name: "趁手武器",
      description: "用于攻击、优势攻击、劣势攻击和擒抱配合。",
      tags: ["weapon"],
      grantedActionKeys: [
        "strike",
        "strike-advantage",
        "strike-disadvantage",
        "grapple",
      ],
      mechanics: itemMechanics("weapon"),
    },
    {
      key: "healer-kit",
      name: "治疗包",
      description: "支持安全休整与伤势叙事的消耗品集合。",
      tags: ["healing", "consumable"],
      grantedActionKeys: ["second-wind"],
      mechanics: itemMechanics("consumable", true),
    },
  ],
  advancement: {
    currencyKey: "xp",
    currencyName: "经验值",
    awardPerMilestone: 1,
    attributeIncreaseCost: 4,
    maximumAttributeValue: 20,
    progressionModel: "numeric-level",
    skillIncreaseCost: 2,
    maximumSkillValue: 6,
    levelIncreaseCost: 5,
    maximumLevel: 20,
    rankOrder: [],
    rankIncreaseCost: 4,
  },
  characterSheetUi: {
    sections: [
      {
        key: "abilities",
        title: "等级与六项能力",
        fieldKeys: [
          "level",
          "strength",
          "dexterity",
          "constitution",
          "intelligence",
          "wisdom",
          "charisma",
        ],
      },
      {
        key: "checks",
        title: "检定与防御",
        fieldKeys: [
          "proficiency",
          "strength-mod",
          ...CHECK_TRAITS,
          "initiative",
          "defense",
          "load",
        ],
      },
      { key: "resources", title: "资源", fieldKeys: ["vigor", "heroic-dice"] },
    ],
  },
  compendium: [
    {
      key: "d20.core",
      title: "d20 检定",
      category: "check",
      body: "掷 d20，加对应的能力检定值和公开情境修正；达到难度即成功。自然 20 与自然 1 会在证明中记录为大成功或大失败。",
      relatedKeys: ["d20", "ability"],
    },
    {
      key: "d20.advantage",
      title: "优势与劣势",
      category: "check",
      body: "优势掷两颗 d20 取高，劣势掷两颗 d20 取低。原始两颗骰与最终保留骰都会进入可验证记录。",
      relatedKeys: ["d20-advantage", "d20-disadvantage"],
    },
    {
      key: "d20.opposed",
      title: "对抗检定",
      category: "combat",
      body: "双方分别掷骰并比较成功等级，再按总值破除同级；完全相同则保持现状。双方证明都进入事件。",
      relatedKeys: ["opposed-ability", "grapple"],
    },
    {
      key: "d20.rest",
      title: "休整与次数",
      category: "core",
      body: "反应每轮恢复；重整旗鼓在短休或长休后恢复。所有消耗和恢复均写入能力账本。",
      relatedKeys: ["protect", "second-wind"],
    },
    {
      key: "d20.advancement",
      title: "等级成长",
      category: "advancement",
      body: "角色以经验值购买等级，最高 20 级；等级变化会重新计算熟练加值、生命和英雄骰上限。",
      relatedKeys: ["level", "proficiency"],
    },
    {
      key: "d20.safety",
      title: "桌面安全",
      category: "safety",
      body: "任何参与者都可暂停、淡出或离桌，无需解释私人边界；Session Zero 的共同约定高于题材预设。",
      relatedKeys: [],
    },
  ],
  migrations: [],
  tests: [
    {
      fixtureKey: "level-1-balanced",
      attributes: {
        level: 1,
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      },
      expectedDerivedStats: {
        proficiency: 2,
        "strength-mod": 0,
        "strength-check": 2,
        "dexterity-check": 2,
        "constitution-check": 2,
        "intelligence-check": 2,
        "wisdom-check": 2,
        "charisma-check": 2,
        initiative: 0,
        defense: 10,
        load: 5,
      },
      expectedResourceMaximums: { vigor: 13, "heroic-dice": 1 },
    },
    {
      fixtureKey: "level-9-specialist",
      attributes: {
        level: 9,
        strength: 18,
        dexterity: 14,
        constitution: 16,
        intelligence: 12,
        wisdom: 10,
        charisma: 8,
      },
      expectedDerivedStats: {
        proficiency: 4,
        "strength-mod": 4,
        "strength-check": 8,
        "dexterity-check": 6,
        "constitution-check": 7,
        "intelligence-check": 5,
        "wisdom-check": 4,
        "charisma-check": 3,
        initiative: 2,
        defense: 12,
        load: 9,
      },
      expectedResourceMaximums: { vigor: 56, "heroic-dice": 3 },
    },
  ],
};

export function createD20FantasyRulePackV1(): RulePackV1 {
  const pack = parseRulePackV1(STORYFORGE_D20_FANTASY_RULE_PACK_V1);
  runRulePackFixturesV1(pack);
  return pack;
}
