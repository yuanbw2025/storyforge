import type { ProductProductionPlanTaskV3 } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/model-json-object'
import { avgHash, avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgSoundPlanV1, type AvgSoundPlanV1 } from './sound-plan-contract'
import { compileAvgSoundRequirementsV1 } from './sound-requirements'
import type { AvgSoundPlanningScopeV1 } from './sound-scope-contract'
import { AVG_SOUND_PLAN_KEY_V1, AVG_SOUND_PROPOSAL_KEY_V1 } from './sound-production-plan'

export interface AvgSoundRoleProposalV1 {
  schema: 'storyforge.avg.sound-role-proposal'; version: 1
  targetArtifactKey: typeof AVG_SOUND_PLAN_KEY_V1; scopeHash: string; payload: AvgSoundPlanV1
}
export function assertAvgSoundRoleTaskV1(task: ProductProductionPlanTaskV3) {
  if (task.kind !== 'avg-sound-plan-propose' || task.executionMode !== 'model' || task.skillId !== 'avg.sound-plan.v1'
    || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== AVG_SOUND_PROPOSAL_KEY_V1) throw new Error('[avg-sound-plan] 不属于准确登记的声音岗位/输出域')
}
/** Compilation validates the complete requirement/source/prompt closure; it
 * neither executes the resulting requests nor asserts any listening result. */
export async function validateAvgSoundPlanSemanticV1(value: unknown, scope: AvgSoundPlanningScopeV1) {
  const payload = parseAvgSoundPlanV1(value)
  await compileAvgSoundRequirementsV1(scope, payload)
  return payload
}
export async function prepareAvgSoundRoleProposalV1(output: string, task: ProductProductionPlanTaskV3, scope: AvgSoundPlanningScopeV1): Promise<AvgSoundRoleProposalV1> {
  assertAvgSoundRoleTaskV1(task)
  return { schema: 'storyforge.avg.sound-role-proposal', version: 1, targetArtifactKey: AVG_SOUND_PLAN_KEY_V1,
    scopeHash: await hashProductProductionValueV2(scope), payload: await validateAvgSoundPlanSemanticV1(parseProductionModelJsonObjectV1(output, task.taskKey), scope) }
}
export async function assertAvgSoundRoleProposalV1(value: unknown, task: ProductProductionPlanTaskV3, scope: AvgSoundPlanningScopeV1): Promise<AvgSoundRoleProposalV1> {
  assertAvgSoundRoleTaskV1(task)
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'targetArtifactKey', 'scopeHash', 'payload'], 'sound original proposal')
  if (r.schema !== 'storyforge.avg.sound-role-proposal' || r.version !== 1 || r.targetArtifactKey !== AVG_SOUND_PLAN_KEY_V1
    || avgHash(r.scopeHash, 'sound scope hash') !== await hashProductProductionValueV2(scope)) throw new Error('[avg-sound-plan] 原方案岗位、目标或冻结范围不一致')
  const payload = await validateAvgSoundPlanSemanticV1(r.payload, scope)
  if (canonicalProductProductionJsonV2(payload) !== canonicalProductProductionJsonV2(r.payload)) throw new Error('[avg-sound-plan] 原方案不符合严格语义合同')
  return { schema: r.schema, version: 1, targetArtifactKey: AVG_SOUND_PLAN_KEY_V1, scopeHash: String(r.scopeHash), payload }
}
