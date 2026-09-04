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
const unlimited = () => ({
  mode: "unlimited" as const,
  maximum: null,
  resourceKey: null,
  cost: null,
  sharedPoolKey: null,
  cooldownRounds: null,
  reset: [],
});
const itemMechanics = (category: string) => ({
  category,
  stackPolicy: "unique" as const,
  maxStack: 1,
  weight: null,
  equipSlots: [],
  requiresAttunement: false,
  maximumCharges: null,
  maximumDurability: null,
});

/** StoryForge-owned, commercially usable first-party narrative TTRPG rules. */
export const STORYFORGE_RULE_PACK_V1: RulePackV1 = {
  schema: "storyforge.rule-pack",
  version: 1,
  ruleSystemId: "storyforge.narrative",
  ruleSystemVersion: "2.0.0",
  title: "StoryForge 叙事 2d6",
  description:
    "面向调查、冒险和人物抉择的完整 2d6 规则：10+ 成功、7–9 部分成功并承担代价、6- 失败前进。所有数值由确定性规则引擎裁决，叙事不能改写骰点。",
  license: {
    licenseId: "storyforge-first-party-1.0",
    name: "StoryForge 第一方内容许可",
    attribution:
      "StoryForge original rules; copyright StoryForge contributors.",
    commercialUse: true,
    derivativesAllowed: true,
    sourceUrl: null,
  },
  attributes: [
    {
      key: "body",
      name: "体魄",
      description: "力量、耐力和直接行动。",
      minimum: -1,
      maximum: 4,
      defaultValue: 1,
    },
    {
      key: "mind",
      name: "心智",
      description: "观察、推理和知识。",
      minimum: -1,
      maximum: 4,
      defaultValue: 1,
    },
    {
      key: "presence",
      name: "风度",
      description: "交涉、意志和影响。",
      minimum: -1,
      maximum: 4,
      defaultValue: 1,
    },
  ],
  derivedStats: [
    {
      key: "defense",
      name: "防御",
      description: "避免直接攻击的目标值。",
      formula: add(constant(7), attribute("body")),
      minimum: 6,
      maximum: 12,
    },
    {
      key: "load",
      name: "负重",
      description: "能够便利携带的物品数量。",
      formula: add(constant(3), attribute("body")),
      minimum: 2,
      maximum: 7,
    },
  ],
  diceModels: [
    { key: "core-2d6", name: "核心 2d6", count: 2, sides: 6, keep: "all" },
    { key: "impact-d6", name: "影响 d6", count: 1, sides: 6, keep: "all" },
  ],
  checks: [
    {
      key: "standard",
      name: "标准检定",
      diceModelKey: "core-2d6",
      attributeKeys: ["body", "mind", "presence"],
      resolver: {
        mode: "total-vs-target",
        defaultDifficulty: 10,
        criticalSuccessMargin: 4,
        criticalFailureMargin: 6,
        partialSuccessWindow: 3,
      },
    },
  ],
  resources: [
    {
      key: "vigor",
      name: "活力",
      description: "承受伤害和劳累的能力。",
      maximumFormula: add(
        constant(6),
        multiply(attribute("body"), constant(2)),
      ),
      initialMode: "maximum",
      minimum: 0,
    },
    {
      key: "focus",
      name: "专注",
      description: "推动调查、协助和特殊行动。",
      maximumFormula: add(constant(2), attribute("mind")),
      initialMode: "maximum",
      minimum: 0,
    },
  ],
  conditions: [
    {
      key: "hindered",
      name: "受阻",
      description: "相关检定 -1。",
      stacking: "replace",
      maximumStacks: 1,
      defaultDurationRounds: 1,
      checkModifier: -1,
    },
    {
      key: "exposed",
      name: "暴露",
      description: "下一次承受的影响更严重。",
      stacking: "replace",
      maximumStacks: 1,
      defaultDurationRounds: 1,
      checkModifier: 0,
    },
    {
      key: "inspired",
      name: "振奋",
      description: "下一次相关检定 +1。",
      stacking: "replace",
      maximumStacks: 1,
      defaultDurationRounds: 1,
      checkModifier: 1,
    },
  ],
  actions: [
    {
      key: "investigate",
      name: "调查",
      description:
        "观察现场、研究资料或追问细节；部分成功会取得信息但消耗专注。",
      phase: "action",
      target: "scene",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "standard", attributeKey: "mind" },
        {
          kind: "resource",
          resourceKey: "focus",
          delta: -1,
          targetScope: "actor",
          appliesOnDegrees: ["partial-success"],
        },
        {
          kind: "condition",
          conditionKey: "hindered",
          stacks: 1,
          targetScope: "actor",
          appliesOnDegrees: ["failure", "critical-failure"],
        },
      ],
    },
    {
      key: "influence",
      name: "影响",
      description: "说服、欺骗、鼓舞或威慑一个目标；部分成功会暴露自己的诉求。",
      phase: "action",
      target: "single-enemy",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "standard", attributeKey: "presence" },
        {
          kind: "condition",
          conditionKey: "exposed",
          stacks: 1,
          targetScope: "actor",
          appliesOnDegrees: ["partial-success"],
        },
        {
          kind: "condition",
          conditionKey: "hindered",
          stacks: 1,
          targetScope: "actor",
          appliesOnDegrees: ["failure", "critical-failure"],
        },
      ],
    },
    {
      key: "overcome",
      name: "克服",
      description: "用直接行动突破物理障碍；部分成功会付出活力代价。",
      phase: "action",
      target: "scene",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "standard", attributeKey: "body" },
        {
          kind: "resource",
          resourceKey: "vigor",
          delta: -1,
          targetScope: "actor",
          appliesOnDegrees: ["partial-success"],
        },
        {
          kind: "condition",
          conditionKey: "hindered",
          stacks: 1,
          targetScope: "actor",
          appliesOnDegrees: ["failure", "critical-failure"],
        },
      ],
    },
    {
      key: "strike",
      name: "攻击",
      description: "对一个敌对目标造成影响；部分成功仍命中，但行动者会暴露。",
      phase: "action",
      target: "single-enemy",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [
        { kind: "check", checkKey: "standard", attributeKey: "body" },
        {
          kind: "damage",
          resourceKey: "vigor",
          diceModelKey: "impact-d6",
          modifierAttributeKey: null,
          appliesOnDegrees: [
            "partial-success",
            "success",
            "hard-success",
            "extreme-success",
            "critical-success",
          ],
        },
        {
          kind: "condition",
          conditionKey: "exposed",
          stacks: 1,
          targetScope: "actor",
          appliesOnDegrees: ["partial-success"],
        },
      ],
    },
    {
      key: "assist",
      name: "协助",
      description: "花费专注，让一名同伴获得振奋。",
      phase: "action",
      target: "single-ally",
      costResourceKey: null,
      costAmount: 0,
      usage: {
        mode: "resource-cost",
        maximum: null,
        resourceKey: "focus",
        cost: 1,
        sharedPoolKey: null,
        cooldownRounds: null,
        reset: [],
      },
      effects: [{ kind: "condition", conditionKey: "inspired", stacks: 1 }],
    },
    {
      key: "guard",
      name: "护援",
      description: "在他人的行动中及时掩护一名同伴。",
      phase: "reaction",
      target: "single-ally",
      costResourceKey: null,
      costAmount: 0,
      usage: unlimited(),
      effects: [{ kind: "condition", conditionKey: "inspired", stacks: 1 }],
    },
    {
      key: "recover",
      name: "休整",
      description: "在安全的幕间恢复一点活力；再次使用前需要等待。",
      phase: "downtime",
      target: "self",
      costResourceKey: null,
      costAmount: 0,
      usage: {
        mode: "cooldown",
        maximum: null,
        resourceKey: null,
        cost: null,
        sharedPoolKey: null,
        cooldownRounds: 2,
        reset: ["scene", "session", "long-rest"],
      },
      effects: [{ kind: "resource", resourceKey: "vigor", delta: 1 }],
    },
  ],
  turnStructure: {
    initiativeDiceModelKey: "core-2d6",
    initiativeAttributeKey: "mind",
    phases: ["start", "action", "end"],
    actionsPerTurn: 1,
    reactionsPerRound: 1,
  },
  items: [
    {
      key: "field-kit",
      name: "调查工具包",
      description: "记录、取样和现场检查所需的轻便工具。",
      tags: ["tool", "investigation"],
      grantedActionKeys: ["investigate"],
      mechanics: itemMechanics("tool"),
    },
    {
      key: "protective-gear",
      name: "防护装备",
      description: "适合危险现场的基础防护。",
      tags: ["armor"],
      grantedActionKeys: [],
      mechanics: itemMechanics("armor"),
    },
  ],
  advancement: {
    currencyKey: "growth",
    currencyName: "成长点",
    awardPerMilestone: 1,
    attributeIncreaseCost: 3,
    maximumAttributeValue: 4,
    progressionModel: "point-buy",
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
        key: "attributes",
        title: "属性",
        fieldKeys: ["body", "mind", "presence"],
      },
      { key: "derived", title: "派生值", fieldKeys: ["defense", "load"] },
      { key: "resources", title: "资源", fieldKeys: ["vigor", "focus"] },
    ],
  },
  compendium: [
    {
      key: "rules.checks",
      title: "如何检定",
      category: "check",
      body: "掷 2d6，加上所选属性和公开修正：10+ 成功，7–9 部分成功并承担规则化代价，6- 失败但故事继续；14+ 为关键成功，4- 为关键失败。",
      relatedKeys: ["standard", "core-2d6"],
    },
    {
      key: "rules.partial-success",
      title: "部分成功与代价",
      category: "core",
      body: "部分成功必须同时给出所得与代价。规则效果先结算资源或状态，KP 再依据 ActionReceipt 描述角色反应、场景变化和下一步选择。",
      relatedKeys: ["standard", "hindered", "exposed"],
    },
    {
      key: "rules.fail-forward",
      title: "失败也推进",
      category: "core",
      body: "关键线索不能因单次失败永久消失。失败会带来代价、时间推进、危险或较弱信息。",
      relatedKeys: ["investigate"],
    },
    {
      key: "rules.safety",
      title: "安全工具",
      category: "safety",
      body: "任何玩家都可暂停、淡出或离场；主持人不得要求解释私人边界。",
      relatedKeys: [],
    },
  ],
  migrations: [],
  tests: [
    {
      fixtureKey: "baseline",
      attributes: { body: 1, mind: 1, presence: 1 },
      expectedDerivedStats: { defense: 8, load: 4 },
      expectedResourceMaximums: { vigor: 8, focus: 3 },
    },
    {
      fixtureKey: "specialist",
      attributes: { body: 3, mind: 2, presence: 0 },
      expectedDerivedStats: { defense: 10, load: 6 },
      expectedResourceMaximums: { vigor: 12, focus: 4 },
    },
  ],
};

/** Parses and runs fixtures so callers never receive an unverified built-in pack. */
export function createStoryForgeRulePackV1(): RulePackV1 {
  const parsed = parseRulePackV1(STORYFORGE_RULE_PACK_V1);
  runRulePackFixturesV1(parsed);
  return parsed;
}
