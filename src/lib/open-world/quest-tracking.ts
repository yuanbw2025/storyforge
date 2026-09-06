import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldQuestTrackingAuthorizationV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

const TRACKABLE_STATUSES = new Set(['revealed', 'accepted', 'active', 'suspended'])

function fail(message: string): never { throw new Error(`[text-open-world-quest-tracking] ${message}`) }

export interface TextOpenWorldQuestTrackingCatalogV1 {
  prepare(input: {
    instanceKey: string
    state: TextOpenWorldEffectStateV1
    operation: 'track' | 'untrack'
    slot: 'primary' | 'pinned'
  }): TextOpenWorldQuestTrackingAuthorizationV1
  apply(input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldQuestTrackingAuthorizationV1
  }): { before: TextOpenWorldEffectStateV1['quests']['tracking']; after: TextOpenWorldEffectStateV1['quests']['tracking'] }
  assertAuthorization(input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldQuestTrackingAuthorizationV1
  }): void
}

export function createTextOpenWorldQuestTrackingCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
): TextOpenWorldQuestTrackingCatalogV1 {
  const modules = parseTextOpenWorldModulesV1(value)
  const clone = <T>(item: T): T => structuredClone(item)

  const applyAuthorization: TextOpenWorldQuestTrackingCatalogV1['apply'] = input => {
    const { state, authorization } = input
    if (state.time.worldMinute !== authorization.worldMinute) fail('任务追踪世界时间基线已变化')
    const instance = state.quests.instancesByKey[authorization.instanceKey] ?? fail(`任务实例不存在:${authorization.instanceKey}`)
    if (instance.definitionKey !== authorization.definitionKey
      || !modules.quests.quests.some(definition => definition.key === authorization.definitionKey)) fail('任务追踪定义引用漂移')
    const tracking = state.quests.tracking
    if (tracking.primaryInstanceKey !== authorization.beforePrimaryInstanceKey
      || canonicalProductProductionJsonV2(tracking.pinnedInstanceKeys) !== canonicalProductProductionJsonV2(authorization.beforePinnedInstanceKeys)) {
      fail('任务追踪基线已变化')
    }
    const before = clone(tracking)
    if (authorization.operation === 'track') {
      if (!TRACKABLE_STATUSES.has(instance.status)) fail('只有已揭示且未终结的任务能够追踪')
      if (authorization.slot === 'primary') {
        if (tracking.primaryInstanceKey === instance.instanceKey) fail('任务已经是主追踪')
        tracking.primaryInstanceKey = instance.instanceKey
        tracking.pinnedInstanceKeys = tracking.pinnedInstanceKeys.filter(key => key !== instance.instanceKey)
      } else {
        if (tracking.primaryInstanceKey === instance.instanceKey) fail('主追踪任务不能重复钉选')
        if (tracking.pinnedInstanceKeys.includes(instance.instanceKey)) fail('任务已经钉选')
        if (tracking.pinnedInstanceKeys.length >= 3) fail('HUD最多钉选3个任务')
        tracking.pinnedInstanceKeys.push(instance.instanceKey)
      }
    } else if (authorization.slot === 'primary') {
      if (tracking.primaryInstanceKey !== instance.instanceKey) fail('目标不是当前主追踪任务')
      tracking.primaryInstanceKey = null
    } else {
      if (!tracking.pinnedInstanceKeys.includes(instance.instanceKey)) fail('目标不是已钉选任务')
      tracking.pinnedInstanceKeys = tracking.pinnedInstanceKeys.filter(key => key !== instance.instanceKey)
    }
    return { before, after: clone(tracking) }
  }

  const prepare: TextOpenWorldQuestTrackingCatalogV1['prepare'] = input => {
    const instance = input.state.quests.instancesByKey[input.instanceKey] ?? fail(`任务实例不存在:${input.instanceKey}`)
    const authorization: TextOpenWorldQuestTrackingAuthorizationV1 = {
      kind: 'quest-tracking', instanceKey: instance.instanceKey, definitionKey: instance.definitionKey,
      worldMinute: input.state.time.worldMinute, operation: input.operation, slot: input.slot,
      beforePrimaryInstanceKey: input.state.quests.tracking.primaryInstanceKey,
      beforePinnedInstanceKeys: [...input.state.quests.tracking.pinnedInstanceKeys],
    }
    applyAuthorization({ state: clone(input.state), authorization })
    return authorization
  }

  return {
    prepare,
    apply: input => applyAuthorization({ state: input.state, authorization: clone(input.authorization) }),
    assertAuthorization: input => {
      const expected = prepare({
        instanceKey: input.authorization.instanceKey, state: clone(input.state),
        operation: input.authorization.operation, slot: input.authorization.slot,
      })
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) {
        fail('任务追踪授权与权威状态不一致')
      }
    },
  }
}
