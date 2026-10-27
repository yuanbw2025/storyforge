/** Fixed, deterministic contract from plan §5.9. Oracle itself never changes chaos. */
import type { TtrpgOpenRunStateV1 } from './open-runtime-contract'
import * as p from './open-contract-parse'
export const TTRPG_CHAOS_ADVANCE_TRIGGERS_V1 = ['failed-check', 'front-advanced', 'clock-complete', 'player-retreat'] as const
export const TTRPG_CHAOS_RECEDE_TRIGGERS_V1 = ['situation-resolved', 'front-defeated', 'stage-closed'] as const
export function changeTtrpgOpenChaosV1(run: TtrpgOpenRunStateV1, trigger: typeof TTRPG_CHAOS_ADVANCE_TRIGGERS_V1[number] | typeof TTRPG_CHAOS_RECEDE_TRIGGERS_V1[number], sequence: number) {
  const before = p.integer(run.chaos.value, 'chaos value', 1, 9)
  const direction = TTRPG_CHAOS_ADVANCE_TRIGGERS_V1.some(t => t === trigger) ? 1 : -1
  run.chaos.value = Math.max(1, Math.min(9, before + direction))
  run.chaos.lastChangedAtSequence = p.integer(sequence, 'chaos sequence', 1)
}
