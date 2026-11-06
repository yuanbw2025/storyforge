import type { ProductTaskBudgetReservationV1 } from '../types'

export function sumProductTaskBudgetReservationsV1(
  tasks: ReadonlyArray<{ budgetReservation: ProductTaskBudgetReservationV1 }>,
): ProductTaskBudgetReservationV1 {
  return tasks.reduce((sum, task) => ({
    modelCalls: sum.modelCalls + task.budgetReservation.modelCalls,
    inputTokens: sum.inputTokens + task.budgetReservation.inputTokens,
    outputTokens: sum.outputTokens + task.budgetReservation.outputTokens,
    mediaCalls: sum.mediaCalls + task.budgetReservation.mediaCalls,
    durationMs: sum.durationMs + task.budgetReservation.durationMs,
    storageBytes: sum.storageBytes + task.budgetReservation.storageBytes,
    maximumCostUsd: sum.maximumCostUsd == null || task.budgetReservation.maximumCostUsd == null
      ? null : sum.maximumCostUsd + task.budgetReservation.maximumCostUsd,
  }), {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    mediaCalls: 0,
    durationMs: 0,
    storageBytes: 0,
    maximumCostUsd: 0 as number | null,
  })
}
