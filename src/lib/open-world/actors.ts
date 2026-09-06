import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldActorScheduleSettlementAuthorizationV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-actors] ${message}`) }

function currentPeriod(
  modules: TextOpenWorldParsedModulesV1,
  worldMinute: number,
): { key: string; settlementWorldMinute: number } {
  if (!Number.isSafeInteger(worldMinute) || worldMinute < 0) fail('worldMinute无效')
  const { minutesPerDay, timePeriods } = modules['time-weather']
  const minuteInDay = worldMinute % minutesPerDay
  const period = timePeriods.find(item => minuteInDay >= item.startMinute && minuteInDay < item.endMinute)
    ?? fail('世界时间无法映射到时间段')
  return {
    key: period.key,
    settlementWorldMinute: Math.floor(worldMinute / minutesPerDay) * minutesPerDay + period.startMinute,
  }
}

function expectedAuthorization(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
): TextOpenWorldActorScheduleSettlementAuthorizationV1 {
  const period = currentPeriod(modules, state.time.worldMinute)
  if (state.time.lastActorScheduleSettlementWorldMinute >= period.settlementWorldMinute) fail('当前角色日程时间段已经结算')
  const changes = modules.actors.schedules.flatMap(schedule => {
    const runtime = state.actors[schedule.actorKey] ?? fail(`角色运行状态不存在:${schedule.actorKey}`)
    const entry = schedule.entries.find(item => item.timePeriodKey === period.key) ?? fail(`角色日程缺少当前时间段:${schedule.key}:${period.key}`)
    if (!runtime.alive || !runtime.present || (runtime.locationKey === entry.locationKey && runtime.scheduleState === entry.activity)) return []
    return [{
      actorKey: schedule.actorKey,
      fromLocationKey: runtime.locationKey,
      toLocationKey: entry.locationKey,
      fromScheduleState: runtime.scheduleState,
      toScheduleState: entry.activity,
    }]
  }).sort((left, right) => left.actorKey.localeCompare(right.actorKey))
  return {
    kind: 'actor-schedule-settlement',
    worldMinute: state.time.worldMinute,
    fromSettlementWorldMinute: state.time.lastActorScheduleSettlementWorldMinute,
    toSettlementWorldMinute: period.settlementWorldMinute,
    timePeriodKey: period.key,
    changes,
  }
}

export interface TextOpenWorldProjectedActorV1 {
  key: string
  name: string
  tier: 'mainline' | 'significant' | 'resident' | 'transient'
  factionKey: string | null
  locationKey: string
  activity: string
  attitude: 'bad' | 'neutral' | 'good'
  portrayal: string | null
  availableServices: Array<{ key: string; title: string }>
}

export function projectTextOpenWorldActorsV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown
  state: TextOpenWorldEffectStateV1
  attitudeByActorKey?: Record<string, 'bad' | 'neutral' | 'good'>
  locationKey?: string
}): TextOpenWorldProjectedActorV1[] {
  const modules = parseTextOpenWorldModulesV1(input.runtimePackage)
  const locationKey = input.locationKey ?? input.state.map.currentLocationKey
  const period = currentPeriod(modules, input.state.time.worldMinute)
  const scheduleSettlementCurrent = modules.actions.version < 6
    || input.state.time.lastActorScheduleSettlementWorldMinute >= period.settlementWorldMinute
  return modules.actors.actors.flatMap(actor => {
    const runtime = input.state.actors[actor.key]
    if (!runtime?.alive || !runtime.present || runtime.locationKey !== locationKey) return []
    const schedule = modules.actors.schedules.find(item => item.key === actor.scheduleKey)
    const entry = schedule?.entries.find(item => item.timePeriodKey === period.key)
    const scheduleMatches = scheduleSettlementCurrent && (!entry || (
      entry.locationKey === runtime.locationKey && entry.activity === runtime.scheduleState
    ))
    const availableServiceKeys = modules.actions.version < 6
      ? actor.serviceKeys
      : schedule
        ? scheduleMatches ? entry?.availableServiceKeys ?? [] : []
        : actor.serviceKeys
    const availableServices = availableServiceKeys.flatMap(serviceKey => {
      const vendor = modules.economy.vendors.find(item => item.key === serviceKey)
      return vendor?.actorKey === actor.key && vendor.locationKey === runtime.locationKey
        ? [{ key: vendor.key, title: vendor.title }]
        : []
    })
    return [{
      key: actor.key,
      name: actor.name,
      tier: actor.tier,
      factionKey: actor.factionKey,
      locationKey: runtime.locationKey,
      activity: runtime.scheduleState,
      attitude: input.attitudeByActorKey?.[actor.key] ?? 'neutral',
      portrayal: actor.tier === 'mainline' || actor.tier === 'significant' ? actor.portrayal : null,
      availableServices,
    }]
  })
}

export function createTextOpenWorldActorScheduleCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  return {
    currentPeriod(worldMinute: number) { return currentPeriod(modules, worldMinute) },
    prepare(state: TextOpenWorldEffectStateV1) { return expectedAuthorization(modules, state) },
    assertAuthorization(input: { state: TextOpenWorldEffectStateV1; authorization: TextOpenWorldActorScheduleSettlementAuthorizationV1 }) {
      const expected = expectedAuthorization(modules, input.state)
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) fail('角色日程结算授权与冻结日程或当前状态不一致')
    },
  }
}

export type TextOpenWorldActorScheduleCatalogV1 = ReturnType<typeof createTextOpenWorldActorScheduleCatalogV1>
