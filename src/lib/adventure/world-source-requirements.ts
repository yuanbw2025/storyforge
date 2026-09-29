import type {
  ProductProductionPlanTaskV3,
  ProductWorldSourceSelectionV1,
  ProductionProductKindV1,
} from '../types'

/** A source audit cannot diagnose absence from a summary. These specialist
 * tasks read their entire selected subject through the existing Gateway;
 * other tasks keep progressive selection and the frozen permission boundary. */
const FULL_READ_TASKS = new Map<string, { skillId: string; role: 'all' | 'characters' | 'locations' }>([
  ['content.source-sufficiency', { skillId: 'text-adventure.source-sufficiency.v1', role: 'all' }],
  ['content.story-bible', { skillId: 'text-adventure.story-bible.v1', role: 'all' }],
  ['content.cast-bible', { skillId: 'text-adventure.cast-bible.v1', role: 'characters' }],
  ['content.adventure-architecture', { skillId: 'text-adventure.production-architecture.v1', role: 'locations' }],
])

export function textAdventureMandatoryFullWorldResourcesV1(input: {
  productType: ProductionProductKindV1
  selection: ProductWorldSourceSelectionV1
  task: Pick<ProductProductionPlanTaskV3, 'taskKey' | 'skillId' | 'executionMode'>
}): string[] {
  if (input.productType !== 'text-adventure' || input.selection.productType !== 'text-adventure'
    || input.task.executionMode !== 'model') return []
  const requirement = FULL_READ_TASKS.get(input.task.taskKey)
  if (!requirement || requirement.skillId !== input.task.skillId) return []
  const selected = new Set(input.selection.resourceKeys)
  const subject = requirement.role === 'all'
    ? input.selection.resourceKeys : input.selection.roleBindings[requirement.role] ?? []
  return [...new Set(subject.filter(key => selected.has(key)))].sort()
}
