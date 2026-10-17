import type { RulePackV1 } from "../types";
import { evaluateRuleNumberExpressionV1 } from "./rule-pack";

/** One mechanical compiler is shared by both formats; it owns no scene semantics. */
export function initialCharacterAttributes(input: {
  attributes: Record<string, number>; resources: Record<string, number>;
}, rulePack: Pick<RulePackV1, "derivedStats" | "resources" | "turnStructure">): import("../types").RuntimeAttributes {
  const derived = Object.fromEntries(rulePack.derivedStats.map(stat => {
    let value = evaluateRuleNumberExpressionV1(stat.formula, input.attributes);
    if (stat.minimum != null) value = Math.max(stat.minimum, value);
    if (stat.maximum != null) value = Math.min(stat.maximum, value);
    return [stat.key, value];
  }));
  const maximums = Object.fromEntries(rulePack.resources.map(resource => [resource.key,
    evaluateRuleNumberExpressionV1(resource.maximumFormula, input.attributes)]));
  return {
    ...input.attributes, ...derived,
    ...Object.fromEntries(Object.entries(input.resources).map(([key, value]) => [`resource.${key}`, value])),
    ...Object.fromEntries(Object.entries(maximums).map(([key, value]) => [`resourceMax.${key}`, value])),
    hp: input.resources.vigor ?? 1,
    maxHp: maximums.vigor ?? input.resources.vigor ?? 1,
    armorClass: derived.defense ?? 8,
    initiative: input.attributes[rulePack.turnStructure.initiativeAttributeKey] ?? 0,
  };
}
