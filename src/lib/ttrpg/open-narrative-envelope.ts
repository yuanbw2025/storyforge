import { parseNarrativeCondition, parseNarrativeEffects } from "../narrative/blueprint";
import type { ProductRuntimePackageV1 } from "../types";

/**
 * The shared package parser validates closed field sets, enums and lengths first.
 * This validates the open product's references without imposing a closed story graph.
 * Narrative material is read-only; mechanics must enter formal TTRPG commands.
 */
export function validateTtrpgOpenNarrativeEnvelopeV1(
  narrative: ProductRuntimePackageV1["narrative"],
  knownSpeakerKeys: ReadonlySet<string>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodes = new Set(narrative.nodes.map(node => node.key));
  if (nodes.size !== narrative.nodes.length) errors.push("open narrative 节点 key 重复");
  if (!nodes.has(narrative.entryNodeKey)) errors.push("open narrative 入口不存在");
  const beats = new Set<string>();
  const choices = new Set<string>();
  const inspect = (work: () => void) => {
    try { work(); } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  for (const node of narrative.nodes) {
    inspect(() => {
      parseNarrativeCondition(node.conditionJson);
      if (parseNarrativeEffects(node.effectsJson).length) {
        throw new Error(`open narrative 不允许机械效果:${node.key}`);
      }
    });
    for (const target of node.successorKeys) {
      if (!nodes.has(target)) errors.push(`open narrative 后继不存在:${node.key}:${target}`);
    }
  }
  for (const beat of narrative.beats) {
    if (beats.has(beat.beatKey)) errors.push(`open narrative beat key 重复:${beat.beatKey}`);
    beats.add(beat.beatKey);
    if (!nodes.has(beat.nodeKey)) errors.push(`open narrative beat 节点不存在:${beat.beatKey}`);
    if (beat.kind === "dialogue" && !beat.speakerKey) {
      errors.push(`open narrative 对话缺少角色:${beat.beatKey}`);
    }
    if (beat.speakerKey && !knownSpeakerKeys.has(beat.speakerKey)) {
      errors.push(`open narrative 角色不存在:${beat.beatKey}`);
    }
  }
  for (const choice of narrative.choices) {
    if (choices.has(choice.choiceKey)) errors.push(`open narrative choice key 重复:${choice.choiceKey}`);
    choices.add(choice.choiceKey);
    if (!nodes.has(choice.sourceNodeKey) || !nodes.has(choice.targetNodeKey)) {
      errors.push(`open narrative choice 节点不存在:${choice.choiceKey}`);
    }
    inspect(() => {
      parseNarrativeCondition(choice.displayConditionJson);
      parseNarrativeCondition(choice.availableConditionJson);
      if (parseNarrativeEffects(choice.effectsJson).length) {
        throw new Error(`open narrative 不允许机械效果:${choice.choiceKey}`);
      }
    });
  }
  if (narrative.choices.length || narrative.nodes.some(node => node.successorKeys.length)) {
    errors.push("open narrative 不允许通用导航");
  }
  return { valid: errors.length === 0, errors };
}
