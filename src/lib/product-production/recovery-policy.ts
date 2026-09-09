import type {
  ProductProductionPlanTaskV3,
  ProductionProductKindV1,
} from '../types'
import { parseProductProductionPlanV3 } from './plan'

const STABLE_TASK_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

const GENERIC_AUTHOR_REPAIR_TASKS = new Map<string, string>([
  ['content.design', 'product-production.content.v1'],
  ['content.narrative', 'product-production.content.v1'],
  ['content.product-module', 'product-production.content.v1'],
  ['media.requirements', 'product-production.media-requirements.v1'],
])

/**
 * Exact product contract for the single-call P2-P10 authoring tasks that can
 * consume an author's repair note or complete JSON revision. Keep task and
 * Skill identities paired: stage-shaped names alone are not authorization.
 * The open-world dispatcher is compile-time checked against this map.
 */
export const TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1 = {
  'p2.experience-design': 'text-open-world.production.experience-design.v1',
  'p2.gameplay-ruleset': 'text-open-world.production.gameplay-ruleset.v1',
  'p2.presentation-profile': 'text-open-world.production.presentation-profile.v1',
  'p3.story-architecture': 'text-open-world.production.story-architecture.v1',
  'p4.region-skeleton': 'text-open-world.production.region-skeleton.v1',
  'p4.player-build': 'text-open-world.production.player-build.v1',
  'p5.mainline': 'text-open-world.production.mainline.v1',
  'p6.significant-threads': 'text-open-world.production.significant-threads.v1',
  'p7.region-narrative-packs': 'text-open-world.production.region-narrative-packs.v1',
  'p8.quest-skeletons': 'text-open-world.production.quest-skeletons.v1',
  'p8.catalog.progression': 'text-open-world.production.progression-catalogs.v1',
  'p8.catalog.encounters': 'text-open-world.production.encounter-catalog.v1',
  'p8.catalog.items-rewards': 'text-open-world.production.item-reward-catalog.v1',
  'p8.catalog.crafting-economy': 'text-open-world.production.crafting-economy-catalog.v1',
  'p8.catalog.npc-runtime': 'text-open-world.production.npc-runtime-catalog.v1',
  'p8.catalog.map-interactions': 'text-open-world.production.map-interaction-catalog.v1',
  'p8f.quest-finalize': 'text-open-world.production.quest-finalize.v1',
  'p9.scene-scripts': 'text-open-world.production.scene-scripts.v1',
  'p10.system-finalize': 'text-open-world.production.system-finalize.v1',
} as const

export type TextOpenWorldAuthorRepairTaskKeyV1 =
  keyof typeof TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1

export interface ProductProductionTaskRecoveryPolicyV1 {
  taskKey: string
  retryAllowed: true
  repairNoteAllowed: boolean
  authorDraftAllowed: boolean
  repairFeedbackContextAllowed: boolean
  reason: 'author-repair-supported' | 'task-does-not-support-author-repair'
}

function supportsGenericAuthorRepair(
  productType: ProductionProductKindV1,
  task: ProductProductionPlanTaskV3,
): boolean {
  if (productType === 'text-open-world' || task.executionMode !== 'model' || task.failurePolicy !== 'pause') return false
  return GENERIC_AUTHOR_REPAIR_TASKS.get(task.taskKey) === task.skillId
}

function supportsTextOpenWorldAuthorRepair(
  productType: ProductionProductKindV1,
  task: ProductProductionPlanTaskV3,
): boolean {
  const taskKey = task.taskKey as TextOpenWorldAuthorRepairTaskKeyV1
  const expectedSkillId = Object.prototype.hasOwnProperty.call(
    TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1,
    taskKey,
  )
    ? TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1[taskKey]
    : null
  return productType === 'text-open-world'
    && task.executionMode === 'model'
    && task.failurePolicy === 'pause'
    && expectedSkillId !== null
    && task.skillId === expectedSkillId
}

/**
 * Single recovery-capability policy for an already parsed Plan task.
 * P1 owns a bounded multi-call protocol, V2 is review-only, and provider or
 * deterministic tasks cannot safely consume an author-authored JSON payload.
 */
export function resolveProductProductionTaskRecoveryPolicyV1(input: {
  productType: ProductionProductKindV1
  task: ProductProductionPlanTaskV3
}): ProductProductionTaskRecoveryPolicyV1 {
  const authorRepairSupported = supportsGenericAuthorRepair(input.productType, input.task)
    || supportsTextOpenWorldAuthorRepair(input.productType, input.task)
  return {
    taskKey: input.task.taskKey,
    retryAllowed: true,
    repairNoteAllowed: authorRepairSupported,
    authorDraftAllowed: authorRepairSupported,
    repairFeedbackContextAllowed: authorRepairSupported,
    reason: authorRepairSupported ? 'author-repair-supported' : 'task-does-not-support-author-repair',
  }
}

/** Strictly parse the frozen Build Plan and inspect one exact task. */
export function inspectProductProductionBuildRecoveryPolicyV1(input: {
  productType: ProductionProductKindV1
  planJson: string
  taskKey: string
}): ProductProductionTaskRecoveryPolicyV1 {
  if (!STABLE_TASK_KEY.test(input.taskKey)) {
    throw new Error('[product-production-recovery] blocker taskKey 无效')
  }
  const plan = parseProductProductionPlanV3(input.planJson)
  if (plan.productType !== input.productType) {
    throw new Error('[product-production-recovery] Plan 与 Production 产品类型不一致')
  }
  const task = plan.tasks.find(candidate => candidate.taskKey === input.taskKey)
  if (!task) throw new Error('[product-production-recovery] blocker 任务不属于当前 Build Plan')
  return resolveProductProductionTaskRecoveryPolicyV1({ productType: input.productType, task })
}

/** Read only the stable task identity from a scheduler failure payload. */
export function readProductProductionRecoveryTaskKeyV1(failureJson: string): string | null {
  try {
    const failure = JSON.parse(failureJson) as { taskKey?: unknown }
    return typeof failure.taskKey === 'string' && STABLE_TASK_KEY.test(failure.taskKey)
      ? failure.taskKey : null
  } catch {
    return null
  }
}
