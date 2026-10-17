import { AVG_UNHELD_V1, type AvgInventoryPlanV1 } from './inventory-contract'

export interface AvgItemInstanceStateV1 { holder: string; quantity: number; state: string; inspected: boolean }
export function avgInventoryValuesV1(variables: Record<string, unknown>): {
  instances: Record<string, AvgItemInstanceStateV1>; actions: Record<string, { performed: boolean }>
} {
  // The system's typed slot validator checks this shape before it is consumed.
  return (variables.avg as { inventory: ReturnType<typeof avgInventoryValuesV1> }).inventory
}
export function assertAvgInventoryCoherenceV1(plan: AvgInventoryPlanV1, variables: Record<string, unknown>): void {
  const state = avgInventoryValuesV1(variables)
  for (const i of plan.instances) {
    const current = state.instances[i.key]
    if ((current.quantity === 0) !== (current.holder === AVG_UNHELD_V1)) throw new Error('[avg-inventory] 物件数量/持有人不一致')
  }
}
export function assertAvgInventoryTransitionsV1(plan: AvgInventoryPlanV1, before: Record<string, unknown>, after: Record<string, unknown>): void {
  const from = avgInventoryValuesV1(before), to = avgInventoryValuesV1(after)
  for (const i of plan.instances) {
    const a = from.instances[i.key].state, b = to.instances[i.key].state
    const item = plan.items.find(item => item.key === i.itemKey)!
    if (a !== b && !item.transitions.some(t => t.from === a && t.to === b)) throw new Error('[avg-inventory] 未登记物件状态转换')
  }
}
