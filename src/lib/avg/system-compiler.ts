import type { FrozenProductNarrativeV1, ProductNarrativeRuntimeState } from '../types'
import { advanceFrozenNarrativeChoice, enterFrozenNarrativeNode } from '../product/runtime-core'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { avgKey, avgList } from './protocol-validation'
import { avgSystemStateSlotsV1, type AvgSystemPlan } from './system-contract'
import { assertAvgSystemStateV1, previewAvgSystemEffectsV1 } from './system-state'
import { buildAvgSystemGraphV1 } from './system-graph'

export interface CompiledAvgSystemV1 {
  plan: AvgSystemPlan
  planHash: string
  contentHash: string
  narrative: FrozenProductNarrativeV1
  initialVariables: Record<string, unknown>
}

/** Deterministic rules compilation has no story/Agent/media-provider dependency.
 * It produces the existing frozen graph, not another rule interpreter or release.
 * It neither persists candidates nor admits a package to the player. */
export async function compileAvgSystemPlanV1(value: unknown): Promise<CompiledAvgSystemV1> {
  const { plan, narrative, initialVariables } = buildAvgSystemGraphV1(value)
  const [planHash, contentHash] = await Promise.all([hashProductProductionValueV2(plan), hashProductProductionValueV2(narrative)])
  return { plan, planHash, contentHash, narrative, initialVariables }
}

export interface AvgSystemSimulationV1 {
  planHash: string
  contentHash: string
  /** Includes the initial entry and each actual action, including repeated visits. */
  steps: ProductNarrativeRuntimeState[]
  completed: boolean
}

/** Bounded, read-only engineering preview. No session/event/receipt is written.
 * The live runtime's entry/choice reducer owns every transition here. A failed
 * range/type/target guard rejects the whole preview, preserving its input. */
export async function simulateAvgSystemPlanV1(input: { plan: unknown; actionKeys: unknown }): Promise<AvgSystemSimulationV1> {
  const keys = avgList(input.actionKeys, 'simulation.actionKeys', avgKey, 1000)
  const compiled = await compileAvgSystemPlanV1(input.plan)
  const { narrative } = compiled
  const slotCount = Math.max(1, avgSystemStateSlotsV1(compiled.plan).length)
  let work = 0
  const reserve = (effectCount: number) => {
    work += slotCount * (effectCount + 1)
    if (work > 1_000_000) throw new Error('[avg-system] 模拟状态检查预算超限；请缩短路径分批验证')
  }
  const entry = compiled.plan.scenes.find(scene => scene.key === narrative.entryNodeKey)!
  reserve(entry.onEnter.length)
  previewAvgSystemEffectsV1(compiled.plan, compiled.initialVariables, entry.onEnter)
  let state: ProductNarrativeRuntimeState = enterFrozenNarrativeNode({
    schema: 'storyforge.product-narrative-runtime', version: 2, moduleKind: narrative.moduleKind, moduleTitle: narrative.moduleTitle,
    sourceHash: compiled.planHash, nodes: narrative.nodes, currentNodeKey: null, visitedNodeKeys: [], availableNodeKeys: [],
    variables: compiled.initialVariables, completed: false, contentHash: compiled.contentHash, beats: narrative.beats, choices: narrative.choices,
    visibleChoiceKeys: [], availableChoiceKeys: [], choiceHistory: [], endingKey: null, completedAtSequence: null, lastEnteredNodeSequence: null,
  }, narrative.entryNodeKey, { eventSequence: 0 })
  assertAvgSystemStateV1(compiled.plan, state.variables)
  const steps = [state]
  for (const [index, key] of keys.entries()) {
    if (!state.availableChoiceKeys.includes(key)) throw new Error('[avg-system] 所选行动当前不可用')
    const action = compiled.plan.actions.find(action => action.key === key)!
    const target = compiled.plan.scenes.find(scene => scene.key === action.toSceneKey)!
    reserve(action.effects.length + target.onEnter.length)
    const afterAction = previewAvgSystemEffectsV1(compiled.plan, state.variables, action.effects)
    previewAvgSystemEffectsV1(compiled.plan, afterAction, target.onEnter)
    state = advanceFrozenNarrativeChoice(state, key, index + 1)
    assertAvgSystemStateV1(compiled.plan, state.variables)
    steps.push(state)
  }
  return { planHash: compiled.planHash, contentHash: compiled.contentHash, steps, completed: state.completed }
}

export interface AvgSystemValidationV1 {
  schema: 'storyforge.avg.system-validation'
  version: 1
  compilerVersion: 1
  coverage: 'structure-and-entry'
  planHash: string
  contentHash: string
  initialStateHash: string
}

/** System-generated evidence of exactly the checks performed. It is neither
 * all-path coverage nor a playable/production-quality acceptance receipt. */
export async function validateAvgSystemPlanForAuthorV1(value: unknown): Promise<AvgSystemValidationV1> {
  const result = await simulateAvgSystemPlanV1({ plan: value, actionKeys: [] })
  return { schema: 'storyforge.avg.system-validation', version: 1, compilerVersion: 1, coverage: 'structure-and-entry',
    planHash: result.planHash, contentHash: result.contentHash, initialStateHash: await hashProductProductionValueV2(result.steps[0].variables) }
}
