import type {
  RuleActionDefinitionV1,
  RulePackV1,
  RuntimeAttributes,
  TtrpgRuntimeProductStateV1,
} from "../types";

export interface TtrpgActionRequirementEvaluationV2 {
  met: boolean;
  reason: string | null;
}

/**
 * Evaluate frozen, data-only action prerequisites. This is deliberately shared
 * by command classification and viewer/model projection so an unavailable
 * action is neither offered to a player nor accepted by a forged command.
 */
export function evaluateTtrpgActionRequirementsV2(input: {
  action: RuleActionDefinitionV1;
  rulePack: RulePackV1;
  actorAttributes: RuntimeAttributes | null | undefined;
  actorConditions:
    | TtrpgRuntimeProductStateV1["conditions"][string]
    | null
    | undefined;
}): TtrpgActionRequirementEvaluationV2 {
  for (const requirement of input.action.requirements ?? []) {
    if (requirement.kind === "resource") {
      const raw = input.actorAttributes?.[`resource.${requirement.resourceKey}`];
      const current = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      const resourceName =
        input.rulePack.resources.find(
          (resource) => resource.key === requirement.resourceKey,
        )?.name ?? requirement.resourceKey;
      const met =
        requirement.operator === "at-most"
          ? current <= requirement.value
          : current >= requirement.value;
      if (!met) {
        return {
          met: false,
          reason:
            requirement.operator === "at-most"
              ? `行动前置条件未满足：${resourceName} 必须不高于 ${requirement.value}，当前为 ${current}。`
              : `行动前置条件未满足：${resourceName} 必须至少为 ${requirement.value}，当前为 ${current}。`,
        };
      }
      continue;
    }

    const currentStacks =
      input.actorConditions?.find(
        (condition) => condition.conditionKey === requirement.conditionKey,
      )?.stacks ?? 0;
    const conditionName =
      input.rulePack.conditions.find(
        (condition) => condition.key === requirement.conditionKey,
      )?.name ?? requirement.conditionKey;
    const met =
      requirement.operator === "present"
        ? currentStacks >= requirement.stacks
        : currentStacks === 0;
    if (!met) {
      return {
        met: false,
        reason:
          requirement.operator === "present"
            ? `行动前置条件未满足：需要 ${conditionName} 至少 ${requirement.stacks} 层，当前为 ${currentStacks} 层。`
            : `行动前置条件未满足：处于 ${conditionName} 时不能执行这项行动。`,
      };
    }
  }
  return { met: true, reason: null };
}
