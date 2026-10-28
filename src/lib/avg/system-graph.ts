import type { FrozenProductNarrativeV1 } from '../types'
import { applyNarrativeEffects } from '../narrative/blueprint'
import { validateNarrativeContentGraph } from '../product/narrative-content'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgSystemStateSlotsV1, parseAvgSystemPlan } from './system-contract'
import { assertAvgSystemStateV1 } from './system-state'

/** Pure, synchronous graph lowering shared by package codecs and the compiler. */
export function buildAvgSystemGraphV1(value: unknown) {
  const plan = parseAvgSystemPlan(value)
  if (plan.scenes.filter(scene => scene.kind === 'entry').length !== 1
    || plan.scenes.find(scene => scene.key === plan.entrySceneKey)?.kind !== 'entry') throw new Error('[avg-system] 必须有唯一且匹配的入口场景')
  const narrative: FrozenProductNarrativeV1 = {
    moduleKind: 'main', moduleTitle: plan.title, entryNodeKey: plan.entrySceneKey,
    nodes: plan.scenes.map(scene => {
      const outgoing = plan.actions.filter(action => action.fromSceneKey === scene.key)
      if (scene.kind === 'ending' && outgoing.length) throw new Error('[avg-system] 结局不得包含后续行动')
      if (plan.storyMode === 'linear' && outgoing.length > 1) throw new Error('[avg-system] linear 不得包含分支行动')
      return { key: scene.key, kind: scene.kind, title: scene.title, summary: '', conditionJson: canonicalProductProductionJsonV2(scene.enterWhen),
        effectsJson: canonicalProductProductionJsonV2(scene.onEnter), successorKeys: [...new Set(outgoing.map(action => action.toSceneKey))] }
    }),
    // Text and presentation attach by stable scene/line identity in 02A2. Empty
    // beats deliberately make this a rules preview, never a playable story.
    beats: [],
    choices: plan.actions.map((action, order) => ({ choiceKey: action.key, sourceNodeKey: action.fromSceneKey, targetNodeKey: action.toSceneKey,
      text: action.label, description: action.description, unavailableReason: action.unavailableReason,
      displayConditionJson: canonicalProductProductionJsonV2(action.visibleWhen), availableConditionJson: canonicalProductProductionJsonV2(action.enabledWhen),
      effectsJson: canonicalProductProductionJsonV2(action.effects), tags: [], order })),
  }
  const graph = validateNarrativeContentGraph(narrative)
  if (!graph.valid) throw new Error(`[avg-system] 规则图无效:${canonicalProductProductionJsonV2(graph)}`)
  const initialVariables = applyNarrativeEffects(avgSystemStateSlotsV1(plan).map(slot => ({ op: 'set', path: slot.path, value: slot.definition.initial })), {})
  assertAvgSystemStateV1(plan, initialVariables)
  return { plan, narrative, initialVariables }
}
