import type { NarrativeEffect } from '../types'
import { applyNarrativeEffects, parseNarrativeEffects } from '../narrative/blueprint'
import { assertAvgSlotValueV1, avgSystemStateSlotsV1, type AvgSystemPlan } from './system-contract'
import { assertAvgInventoryCoherenceV1, assertAvgInventoryTransitionsV1 } from './inventory-state'
import { avgList, avgProtocolBody } from './protocol-validation'

/** This is the same variable payload later consumed by the shared event reducer. */
export function assertAvgSystemStateV1(plan: AvgSystemPlan, state: Record<string, unknown>, coherent = true): void {
  const slots = avgSystemStateSlotsV1(plan)
  const paths = new Map(slots.map(slot => [slot.path, slot.definition]))
  const prefixes = new Set(slots.flatMap(slot => {
    const segments = slot.path.split('.')
    return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('.'))
  }))
  const visited = new Set<string>()
  const visit = (value: unknown, path: string): void => {
    const definition = paths.get(path)
    if (definition) { assertAvgSlotValueV1(definition, value); visited.add(path); return }
    if ((path && !prefixes.has(path)) || !value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`[avg-system] 未声明状态或容器:${path}`)
    for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key)
  }
  visit(state, '')
  for (const slot of slots) if (!visited.has(slot.path) && !slot.definition.optional) throw new Error(`[avg-system] 缺少必需状态:${slot.path}`)
  if (coherent && plan.version === 2) assertAvgInventoryCoherenceV1(plan.inventory, state)
}

/** Preflight each intermediate result with the existing effect primitive. Even
 * an overflow followed by an opposite increment is invalid. These clones are
 * discarded; only the shared narrative reducer performs the actual transition. */
export function previewAvgSystemEffectsV1(plan: AvgSystemPlan, state: Record<string, unknown>, effects: NarrativeEffect[]): Record<string, unknown> {
  assertAvgSystemStateV1(plan, state)
  // This exported boundary may also be called outside the compiler. Validate
  // paths before the shared primitive can traverse any object prototype.
  const parsed = parseNarrativeEffects(JSON.stringify(avgList(avgProtocolBody(effects), 'effects', entry => entry, 100)))
  let checked = state
  for (const effect of parsed) {
    const next = applyNarrativeEffects([effect], checked)
    assertAvgSystemStateV1(plan, next, false)
    if (plan.version === 2) assertAvgInventoryTransitionsV1(plan.inventory, checked, next)
    checked = next
  }
  assertAvgSystemStateV1(plan, checked)
  return checked
}
