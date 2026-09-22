import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldObjectiveAuthorizationV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-objective-state] ${message}`) }

export interface TextOpenWorldObjectiveCatalogV1 {
  prepare(input: {
    instanceKey: string
    objectiveKey: string
    state: TextOpenWorldEffectStateV1
  }): TextOpenWorldObjectiveAuthorizationV1
  apply(input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldObjectiveAuthorizationV1
  }): { before: 'active'; after: 'completed' }
  assertAuthorization(input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldObjectiveAuthorizationV1
  }): void
}

export function createTextOpenWorldObjectiveCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
): TextOpenWorldObjectiveCatalogV1 {
  const modules = parseTextOpenWorldModulesV1(value)
  const prepare: TextOpenWorldObjectiveCatalogV1['prepare'] = input => {
    const instance = input.state.quests.instancesByKey[input.instanceKey] ?? fail(`任务实例不存在:${input.instanceKey}`)
    const objective = modules.quests.objectives.find(candidate => candidate.key === input.objectiveKey)
      ?? fail(`Objective不存在:${input.objectiveKey}`)
    const stage = modules.quests.stages.find(candidate => candidate.key === objective.stageKey)!
    if (stage.questKey !== instance.definitionKey) fail('Objective不属于目标任务实例')
    if (instance.status !== 'active' || instance.currentStageKey !== stage.key) fail('Objective不属于当前active Stage')
    if (instance.objectiveStatusByKey[objective.key] !== 'active') fail('Objective当前不可完成')
    return {
      kind: 'quest-objective', instanceKey: instance.instanceKey, definitionKey: instance.definitionKey,
      stageKey: stage.key, objectiveKey: objective.key, worldMinute: input.state.time.worldMinute,
      fromStatus: 'active', toStatus: 'completed',
    }
  }
  const apply: TextOpenWorldObjectiveCatalogV1['apply'] = input => {
    if (input.state.time.worldMinute !== input.authorization.worldMinute) fail('Objective世界时间基线已变化')
    const expected = prepare({
      instanceKey: input.authorization.instanceKey,
      objectiveKey: input.authorization.objectiveKey,
      state: input.state,
    })
    if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('Objective授权与权威状态不一致')
    input.state.quests.instancesByKey[input.authorization.instanceKey].objectiveStatusByKey[input.authorization.objectiveKey] = 'completed'
    return { before: 'active', after: 'completed' }
  }
  return {
    prepare,
    apply,
    assertAuthorization: input => {
      const expected = prepare({
        instanceKey: input.authorization.instanceKey,
        objectiveKey: input.authorization.objectiveKey,
        state: input.state,
      })
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('Objective授权与权威状态不一致')
    },
  }
}
