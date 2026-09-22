import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldFastTravelAuthorizationV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { planTextOpenWorldRouteV1 } from './map-topology'
import { parseTextOpenWorldModulesV1 } from './modules'

type FastTravelEffect = Extract<TextOpenWorldEffectDefinitionV1, { operation: 'fast-travel' }>

function fail(message: string): never { throw new Error(`[text-open-world-fast-travel] ${message}`) }

function authorizationFor(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown
  modules: TextOpenWorldParsedModulesV1
  state: TextOpenWorldEffectStateV1
  effect: FastTravelEffect
  destinationLocationKey: string
}): TextOpenWorldFastTravelAuthorizationV1 {
  const modules = input.modules
  const { state, effect, destinationLocationKey } = input
  if (state.player.health <= 0 || state.combat?.status === 'active' || state.combat?.status === 'defeat') fail('当前状态不能快速旅行')
  if (state.map.travel) fail('进行中的普通旅行不能切换为快速旅行')
  if (destinationLocationKey === state.map.currentLocationKey) fail('不能快速旅行到当前位置')
  const destination = modules.world.locations.find(location => location.key === destinationLocationKey)
    ?? fail(`目标地点不存在:${destinationLocationKey}`)
  const knowledge = state.map.locationKnowledgeByKey[destinationLocationKey] ?? 'unknown'
  if (knowledge !== 'visited' && knowledge !== 'familiar') fail('快速旅行目标必须已经到访')
  const unlocked = modules.world.fastTravelPoints
    .filter(point => point.locationKey === destinationLocationKey && state.map.unlockedFastTravelPointKeys.includes(point.key))
    .sort((left, right) => left.key.localeCompare(right.key))[0]
    ?? fail('目标地点的快速旅行点尚未解锁')
  const route = planTextOpenWorldRouteV1({
    runtimePackage: input.runtimePackage,
    fromLocationKey: state.map.currentLocationKey,
    destinationLocationKey,
    openEdgeKeys: state.map.openEdgeKeys,
  }) ?? fail('当前没有通往目标地点的开放路线')
  const { timeRatioNumerator, timeRatioDenominator, minimumMinutes } = effect.payload
  const scaledMinutes = Math.ceil(route.totalTravelMinutes * timeRatioNumerator / timeRatioDenominator)
  const travelMinutes = Math.max(minimumMinutes, scaledMinutes)
  if (!Number.isSafeInteger(travelMinutes) || travelMinutes < 1 || state.time.worldMinute + travelMinutes > Number.MAX_SAFE_INTEGER) fail('快速旅行时间无效')
  return {
    kind: 'fast-travel',
    fastTravelPointKey: unlocked.key,
    originLocationKey: state.map.currentLocationKey,
    destinationLocationKey: destination.key,
    routeEdgeKeys: [...route.edgeKeys],
    openEdgeKeys: [...state.map.openEdgeKeys].sort((left, right) => left.localeCompare(right)),
    baseWorldMinute: state.time.worldMinute,
    travelMinutes,
  }
}

export interface TextOpenWorldFastTravelCatalogV1 {
  prepare(input: {
    state: TextOpenWorldEffectStateV1
    effect: FastTravelEffect
    destinationLocationKey: string
  }): TextOpenWorldFastTravelAuthorizationV1
  assertAuthorization(input: {
    state: TextOpenWorldEffectStateV1
    effect: FastTravelEffect
    authorization: TextOpenWorldFastTravelAuthorizationV1
  }): void
}

/**
 * Computes a command-scoped fast-travel authorization from authoritative
 * Session state. The authorization freezes the open route and time cost; the
 * Effect applies destination and time atomically and never creates map.travel.
 */
export function createTextOpenWorldFastTravelCatalogV1(
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
): TextOpenWorldFastTravelCatalogV1 {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(runtimePackage)
  const prepare = (input: {
    state: TextOpenWorldEffectStateV1
    effect: FastTravelEffect
    destinationLocationKey: string
  }) => authorizationFor({ runtimePackage, modules, ...input })
  return {
    prepare,
    assertAuthorization: input => {
      const expected = prepare({
        state: input.state,
        effect: input.effect,
        destinationLocationKey: input.authorization.destinationLocationKey,
      })
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) {
        fail('快速旅行授权与权威状态不一致')
      }
    },
  }
}
