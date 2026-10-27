/** New Plans opt into this exact prompt generation. Historical Plan/Run IDs
 * remain valid and never acquire a different wire format during recovery. */
export const TTRPG_OPEN_PRODUCTION_BINDINGS_V2 = {
  'ttrpg.open.source-facts': {
    skillId: 'product-production.ttrpg-open-source-facts.v2',
    promptVersion: 'ttrpg-open-source-facts-v2',
  },
  'ttrpg.open.rule-system': {
    skillId: 'product-production.ttrpg-open-rule-system.v2',
    promptVersion: 'ttrpg-open-rule-system-v2',
  },
  'ttrpg.open.situation-layer': {
    skillId: 'product-production.ttrpg-open-situation-layer.v2',
    promptVersion: 'ttrpg-open-situation-layer-v3',
  },
} as const

export type TtrpgOpenProductionTaskKeyV2 = keyof typeof TTRPG_OPEN_PRODUCTION_BINDINGS_V2

/** Retained whole generation; a mixed Plan is never inferred as compatible. */
export const TTRPG_OPEN_PRODUCTION_SKILL_IDS_V1 = {
  'ttrpg.open.source-facts': 'product-production.ttrpg-open-source-facts.v1',
  'ttrpg.open.rule-system': 'product-production.ttrpg-open-rule-system.v1',
  'ttrpg.open.situation-layer': 'product-production.ttrpg-open-situation-layer.v1',
} as const

export function isTtrpgOpenProductionTaskV2(task: {
  taskKey: string; skillId: string | null; executionMode: string
}): task is typeof task & { taskKey: TtrpgOpenProductionTaskKeyV2 } {
  const binding = Object.prototype.hasOwnProperty.call(TTRPG_OPEN_PRODUCTION_BINDINGS_V2, task.taskKey)
    ? TTRPG_OPEN_PRODUCTION_BINDINGS_V2[task.taskKey as TtrpgOpenProductionTaskKeyV2] : null
  return task.executionMode === 'model' && binding !== null && binding.skillId === task.skillId
}

/** New task-source/time generation. Neither old predicate changes identity. */
export const TTRPG_OPEN_PRODUCTION_BINDINGS_V3 = {
  'ttrpg.open.source-facts': { skillId: 'product-production.ttrpg-open-source-facts.v3', promptVersion: 'ttrpg-open-source-facts-v3' },
  'ttrpg.open.rule-system': { skillId: 'product-production.ttrpg-open-rule-system.v3', promptVersion: 'ttrpg-open-rule-system-v3' },
  'ttrpg.open.situation-layer': { skillId: 'product-production.ttrpg-open-situation-layer.v3', promptVersion: 'ttrpg-open-situation-layer-v4' },
  'ttrpg.open.media-plan': { skillId: 'product-production.ttrpg-open-media-plan.v1', promptVersion: 'ttrpg-open-media-plan-v1' },
} as const
export type TtrpgOpenProductionTaskKeyV3 = keyof typeof TTRPG_OPEN_PRODUCTION_BINDINGS_V3
export function isTtrpgOpenProductionTaskV3(task: { taskKey: string; skillId: string | null; executionMode: string }):
  task is typeof task & { taskKey: TtrpgOpenProductionTaskKeyV3 } {
  const binding = Object.prototype.hasOwnProperty.call(TTRPG_OPEN_PRODUCTION_BINDINGS_V3, task.taskKey)
    ? TTRPG_OPEN_PRODUCTION_BINDINGS_V3[task.taskKey as TtrpgOpenProductionTaskKeyV3] : null
  return task.executionMode === 'model' && binding !== null && binding.skillId === task.skillId
}

/** Only the closed new Plan can contain this no-provider task. */
export function isTtrpgOpenEmptyMediaTaskV3(task: { taskKey: string; skillId: string | null; executionMode: string }): boolean {
  return task.taskKey === 'ttrpg.open.media-plan' && task.skillId === null && task.executionMode === 'deterministic'
}
