import { hashProductProductionValueV2 } from "../product-production/hash";
import type {
  RulePackV1,
  ProductRuntimeState,
  TtrpgRuntimeRosterEntryV2,
  TtrpgCampaignContentV1,
} from "../types";

export type TtrpgContinuationCompatibilityV2 =
  "same-content" | "compatible" | "manual-migration" | "breaking";

export interface TtrpgContinuationRequestV2 {
  parentSessionId: number;
  expectedParentSequence: number;
  expectedParentStateHash: string;
  expectedPlanHash: string;
  compatibility: TtrpgContinuationCompatibilityV2;
  transitionKey: string;
  approvedBy: string;
}

export interface TtrpgContinuationPlanV2 {
  schema: "storyforge.ttrpg-continuation-plan";
  version: 2;
  parentSessionId: number;
  parentSequence: number;
  parentStateHash: string;
  targetProductReleaseId: number;
  fromRulePackContentHash: string;
  toRulePackContentHash: string;
  fromCampaignKey: string;
  toCampaignKey: string;
  compatibility: TtrpgContinuationCompatibilityV2;
  transitionKey: string;
  approvedBy: string;
  activeCharacterKeys: string[];
  carried: string[];
  reset: string[];
  warnings: string[];
  migratedStateHash: string;
  planHash: string;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function key(value: string, label: string): string {
  const parsed = value.trim();
  if (!KEY.test(parsed)) throw new Error(`[ttrpg-continuity] ${label} 无效`);
  return parsed;
}

function sameProgressionRules(left: RulePackV1, right: RulePackV1): boolean {
  return (
    stableJson(left.advancement) === stableJson(right.advancement) &&
    stableJson(left.attributes) === stableJson(right.attributes)
  );
}

function compatibleCustomization(input: {
  characterKey: string;
  parentCampaign: TtrpgCampaignContentV1;
  targetCampaign: TtrpgCampaignContentV1;
  parentState: ProductRuntimeState;
}): boolean {
  const customization =
    input.parentState.ttrpg?.product?.characterCustomizations.find(
      (item) => item.characterKey === input.characterKey,
    );
  if (!customization) return false;
  const parent = input.parentCampaign.characterTemplates.find(
    (item) => item.characterKey === input.characterKey,
  );
  const target = input.targetCampaign.characterTemplates.find(
    (item) => item.characterKey === input.characterKey,
  );
  if (
    !parent ||
    !target ||
    parent.role !== "player" ||
    target.role !== "player"
  )
    return false;
  const keys = Object.keys(customization.attributes).sort();
  if (stableJson(keys) !== stableJson(Object.keys(target.attributes).sort()))
    return false;
  const customizedBudget = Object.values(customization.attributes).reduce(
    (sum, value) => sum + value,
    0,
  );
  const targetBudget = Object.values(target.attributes).reduce(
    (sum, value) => sum + value,
    0,
  );
  return customizedBudget === targetBudget;
}

/**
 * Builds a new release-bound state. It never mutates the parent and never
 * hot-swaps frozen content. Narrative continuity is preserved broadly;
 * mechanics are carried only where the target RulePack can validate them.
 */
export async function buildTtrpgContinuationStateV2(input: {
  parentSessionId: number;
  parentSequence: number;
  parentStateHash: string;
  targetProductReleaseId: number;
  parentState: ProductRuntimeState;
  targetInitialState: ProductRuntimeState;
  parentRulePack: RulePackV1;
  targetRulePack: RulePackV1;
  parentCampaign: TtrpgCampaignContentV1;
  targetCampaign: TtrpgCampaignContentV1;
  compatibility: TtrpgContinuationCompatibilityV2;
  transitionKey: string;
  approvedBy: string;
}): Promise<{
  state: ProductRuntimeState;
  plan: TtrpgContinuationPlanV2;
}> {
  if (
    !Number.isInteger(input.parentSessionId) ||
    input.parentSessionId < 1 ||
    !Number.isInteger(input.parentSequence) ||
    input.parentSequence < 1 ||
    !/^[0-9a-f]{64}$/.test(input.parentStateHash)
  ) {
    throw new Error("[ttrpg-continuity] 父战役版本证据无效");
  }
  const transitionKey = key(input.transitionKey, "transitionKey");
  const approvedBy = key(input.approvedBy, "approvedBy");
  const parentTtrpg = input.parentState.ttrpg;
  const targetTtrpg = input.targetInitialState.ttrpg;
  const parentProduct = parentTtrpg?.product;
  const targetProduct = targetTtrpg?.product;
  const parentContinuity = parentTtrpg?.campaign;
  const targetContinuity = targetTtrpg?.campaign;
  if (
    !parentProduct?.sessionZero.completed ||
    !parentContinuity ||
    parentContinuity.activeSessionKey != null ||
    !targetProduct ||
    !targetContinuity ||
    input.parentState.lastSequence !== input.parentSequence ||
    parentProduct.campaignKey !== input.parentCampaign.campaignKey ||
    targetProduct.campaignKey !== input.targetCampaign.campaignKey
  ) {
    throw new Error(
      "[ttrpg-continuity] 续团必须从已完成 Session Zero、当前处于会间阶段的冻结战役创建",
    );
  }
  const sameContent =
    parentProduct.rulePackContentHash === targetProduct.rulePackContentHash &&
    parentProduct.campaignKey === targetProduct.campaignKey;
  if (
    (input.compatibility === "same-content") !== sameContent ||
    input.compatibility === "breaking"
  ) {
    throw new Error(
      "[ttrpg-continuity] same-content 必须精确同包；breaking 迁移必须先人工改造为可执行计划",
    );
  }

  const state = structuredClone(input.targetInitialState);
  const product = state.ttrpg!.product!;
  const continuity = state.ttrpg!.campaign!;
  const carried: string[] = [];
  const reset: string[] = [];
  const warnings: string[] = [];
  const targetPlayerKeys = new Set(
    input.targetCampaign.characterTemplates
      .filter((item) => item.role === "player")
      .map((item) => item.characterKey),
  );
  const parentRoster = parentContinuity.roster.length
    ? parentContinuity.roster
    : parentProduct.sessionZero.selectedCharacterKeys.map(
        (characterKey): TtrpgRuntimeRosterEntryV2 => ({
          characterKey,
          status: "active",
          joinedSessionKey: null,
          leftSessionKey: null,
          replacementFor: null,
          reason: "旧版战役活动角色",
          updatedSequence: input.parentSequence,
        }),
      );
  const missingActive = parentRoster.filter(
    (entry) =>
      entry.status === "active" && !targetPlayerKeys.has(entry.characterKey),
  );
  if (missingActive.length) {
    throw new Error(
      `[ttrpg-continuity] 目标 CampaignPack 缺少活动角色:${missingActive
        .map((entry) => entry.characterKey)
        .join(",")}`,
    );
  }
  const rosterByKey = new Map(
    parentRoster
      .filter((entry) => targetPlayerKeys.has(entry.characterKey))
      .map((entry) => [entry.characterKey, structuredClone(entry)]),
  );
  continuity.roster = input.targetCampaign.characterTemplates
    .filter((item) => item.role === "player")
    .map((template) => {
      const prior = rosterByKey.get(template.characterKey);
      return prior
        ? {
            ...prior,
            replacementFor:
              prior.replacementFor != null &&
              targetPlayerKeys.has(prior.replacementFor)
                ? prior.replacementFor
                : null,
          }
        : {
            characterKey: template.characterKey,
            status: "reserve" as const,
            joinedSessionKey: null,
            leftSessionKey: null,
            replacementFor: null,
            reason: "目标发布新增后备角色",
            updatedSequence: input.parentSequence,
          };
    });
  carried.push("长期分场与活动/后备/退役编组");

  continuity.summary = parentContinuity.summary;
  continuity.activeSessionKey = null;
  continuity.playSessions = structuredClone(parentContinuity.playSessions);
  continuity.memories = structuredClone(parentContinuity.memories);
  continuity.supplements = structuredClone(parentContinuity.supplements);
  continuity.worldEvolution = structuredClone(parentContinuity.worldEvolution);
  continuity.versionTransitions = [
    ...parentContinuity.versionTransitions.filter(
      (item) => item.transitionKey !== transitionKey,
    ),
    {
      transitionKey,
      fromRulePackContentHash: parentProduct.rulePackContentHash,
      toRulePackContentHash: targetProduct.rulePackContentHash,
      fromCampaignKey: parentProduct.campaignKey,
      toCampaignKey: targetProduct.campaignKey,
      compatibility: input.compatibility,
      status: "activated",
      notes: "已创建独立目标发布 Instance；需重新完成 Session Zero 后继续。",
      approvedBy,
      updatedSequence: input.parentSequence,
    },
  ];
  carried.push("跨场摘要、权限记忆、补充包、世界演化与版本收据");

  // A new release always re-runs Session Zero. Existing consent is not inferred
  // from the old release, even when controller assignments can be copied.
  product.sessionZero = {
    ...product.sessionZero,
    completed: false,
    acceptedItemKeys: [],
    selectedCharacterKeys: [],
    completedBy: null,
    completedAtSequence: null,
  };
  product.safety = {
    status: "active",
    reason: null,
    changedBy: null,
    changedAtSequence: null,
  };
  reset.push("Session Zero、安全边界、当前场景、行动历史与媒资队列");

  const mechanicsCompatible =
    sameContent ||
    sameProgressionRules(input.parentRulePack, input.targetRulePack);
  if (mechanicsCompatible) {
    product.advancement.totalAwarded = parentProduct.advancement.totalAwarded;
    const targetMilestones = new Set(
      product.advancement.milestones.map((item) => item.milestoneKey),
    );
    product.advancement.awardedMilestoneKeys =
      parentProduct.advancement.awardedMilestoneKeys.filter((key) =>
        targetMilestones.has(key),
      );
    for (const characterKey of targetPlayerKeys) {
      const parentProgression =
        parentProduct.characterProgression?.[characterKey];
      const targetProgression = product.characterProgression?.[characterKey];
      if (
        parentProgression &&
        targetProgression &&
        parentProgression.model === targetProgression.model
      ) {
        product.characterProgression![characterKey] =
          structuredClone(parentProgression);
      }
      if (
        compatibleCustomization({
          characterKey,
          parentCampaign: input.parentCampaign,
          targetCampaign: input.targetCampaign,
          parentState: input.parentState,
        })
      ) {
        const customization = parentProduct.characterCustomizations.find(
          (item) => item.characterKey === characterKey,
        );
        if (customization)
          product.characterCustomizations.push(structuredClone(customization));
      }
    }
    carried.push("兼容角色成长、车卡自定义与累计成长货币");
  } else {
    reset.push("不兼容的数值成长与车卡自定义");
    warnings.push(
      "目标规则成长模型不同；旧成长保留在连续性记忆中，未伪造数值映射。",
    );
  }

  const targetDefinitions = new Set(
    input.targetRulePack.items.map((item) => item.key),
  );
  if (parentProduct.inventory && product.inventory) {
    const carriedItems = Object.fromEntries(
      Object.entries(parentProduct.inventory.items)
        .filter(
          ([, item]) =>
            targetDefinitions.has(item.definitionRef) &&
            (item.ownerRef == null || !!state.entities[item.ownerRef]) &&
            (item.locationRef == null || !!state.entities[item.locationRef]),
        )
        .map(([instanceId, item]) => [instanceId, structuredClone(item)]),
    );
    for (const item of Object.values(carriedItems)) {
      if (item.containerRef != null && !carriedItems[item.containerRef])
        item.containerRef = null;
      if (
        item.attunedToActorRef != null &&
        !state.entities[item.attunedToActorRef]
      )
        item.attunedToActorRef = null;
    }
    product.inventory.items = {
      ...product.inventory.items,
      ...carriedItems,
    };
    product.inventory.appliedCommandIds = [
      ...new Set([
        ...product.inventory.appliedCommandIds,
        ...parentProduct.inventory.appliedCommandIds,
      ]),
    ];
    carried.push(
      `${Object.keys(carriedItems).length} 个目标规则仍认识的物品实例`,
    );
  }

  const targetActionUsage = new Map(
    input.targetRulePack.actions.map((action) => [
      action.key,
      stableJson(action.usage),
    ]),
  );
  const parentActionUsage = new Map(
    input.parentRulePack.actions.map((action) => [
      action.key,
      stableJson(action.usage),
    ]),
  );
  for (const [stateKey, ability] of Object.entries(
    parentProduct.abilityStates ?? {},
  )) {
    if (
      state.entities[ability.actorInstanceId] &&
      targetActionUsage.get(ability.abilityKey) ===
        parentActionUsage.get(ability.abilityKey) &&
      product.abilityStates?.[stateKey]
    ) {
      product.abilityStates[stateKey] = structuredClone(ability);
    }
  }
  carried.push("定义和次数策略未变化的技能使用次数/冷却");

  const targetConditions = new Set(
    input.targetRulePack.conditions.map((condition) => condition.key),
  );
  product.conditions = Object.fromEntries(
    Object.entries(parentProduct.conditions)
      .filter(([entityKey]) => !!state.entities[entityKey])
      .map(([entityKey, conditions]) => [
        entityKey,
        conditions.filter((condition) =>
          targetConditions.has(condition.conditionKey),
        ),
      ]),
  );
  for (const resource of input.targetRulePack.resources) {
    for (const characterKey of targetPlayerKeys) {
      const source = input.parentState.entities[characterKey];
      const target = state.entities[characterKey];
      const current = source?.attributes[`resource.${resource.key}`];
      const maximum = target?.attributes[`resourceMax.${resource.key}`];
      if (
        target &&
        typeof current === "number" &&
        typeof maximum === "number"
      ) {
        target.attributes[`resource.${resource.key}`] = Math.max(
          resource.minimum,
          Math.min(maximum, current),
        );
        if (resource.key === "vigor")
          target.attributes.hp = target.attributes[`resource.${resource.key}`];
      }
    }
  }
  carried.push("目标规则仍定义的资源当前值与状态效果");

  state.lastSequence = 0;
  const migratedStateHash = await hashProductProductionValueV2({
    ttrpg: state.ttrpg,
    entities: Object.fromEntries(
      input.targetCampaign.characterTemplates.map((template) => [
        template.characterKey,
        state.entities[template.characterKey],
      ]),
    ),
  });
  const planWithoutHash = {
    schema: "storyforge.ttrpg-continuation-plan" as const,
    version: 2 as const,
    parentSessionId: input.parentSessionId,
    parentSequence: input.parentSequence,
    parentStateHash: input.parentStateHash,
    targetProductReleaseId: input.targetProductReleaseId,
    fromRulePackContentHash: parentProduct.rulePackContentHash,
    toRulePackContentHash: targetProduct.rulePackContentHash,
    fromCampaignKey: parentProduct.campaignKey,
    toCampaignKey: targetProduct.campaignKey,
    compatibility: input.compatibility,
    transitionKey,
    approvedBy,
    activeCharacterKeys: continuity.roster
      .filter((entry) => entry.status === "active")
      .map((entry) => entry.characterKey),
    carried,
    reset,
    warnings,
    migratedStateHash,
  };
  const planHash = await hashProductProductionValueV2(planWithoutHash);
  return { state, plan: { ...planWithoutHash, planHash } };
}
