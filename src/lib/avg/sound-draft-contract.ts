import { avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgSoundPlanningScopeV1, type AvgSoundPlanningScopeV1 } from './sound-scope-contract'

export type AvgSoundPlanningDraftInputV1 = Omit<AvgSoundPlanningScopeV1, 'sourceInputHash'>

/** Author-owned requirements only. No route credentials, production start,
 * raw audio, review or adoption authority are stored in this editable draft. */
export interface AvgSoundProductionDraftV1 {
  schema: 'storyforge.avg.sound-production-draft'
  version: 1
  scope: AvgSoundPlanningScopeV1
}
export function parseAvgSoundProductionDraftV1(value: unknown): AvgSoundProductionDraftV1 {
  const row = avgRecord(avgProtocolBody(value), ['schema', 'version', 'scope'], 'sound production draft')
  if (row.schema !== 'storyforge.avg.sound-production-draft' || row.version !== 1) throw new Error('[avg-sound] 声音需求草稿版本无效')
  return { schema: row.schema, version: 1, scope: parseAvgSoundPlanningScopeV1(row.scope) }
}
