import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldActorScheduleSettlementAuthorizationV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-actors] ${message}`) }

type ActorStateEffect = Extract<TextOpenWorldEffectDefinitionV1, { operation: 'change-actor-state' }>

function expectedActorState(
  modules: TextOpenWorldParsedModulesV1,
  state: TextOpenWorldEffectStateV1,
  effect: ActorStateEffect,
) {
  const definition = modules.actors.actors.find(actor => actor.key === effect.payload.actorKey)
    ?? fail(`角色定义不存在:${effect.payload.actorKey}`)
  const before = state.actors[effect.payload.actorKey] ?? fail(`角色运行状态不存在:${effect.payload.actorKey}`)
  const { cause } = effect.payload
  if (!before.alive && effect.payload.alive === true) fail(`首版不允许复活已死亡角色:${definition.key}`)
  if (!before.alive && (effect.payload.present === true || effect.payload.locationKey != null)) fail(`已死亡角色不能重新出现或移动:${definition.key}`)

  const killing = before.alive && effect.payload.alive === false
  if (killing) {
    if (definition.mortalityPolicy === 'protected') fail(`不能杀死受保护Actor:${definition.key}`)
    if (definition.mortalityPolicy === 'story-only' && cause !== 'story') fail(`Actor只允许由正式剧情结果致死:${definition.key}`)
    if (definition.mortalityPolicy === 'mortal' && !['player-attack', 'story', 'random-event', 'legacy-system'].includes(cause)) fail(`Actor死亡原因不符合mortal策略:${definition.key}`)
    if (definition.mortalityPolicy === 'despawn-on-resolution') fail(`临时Actor只能在事件解决时退场，不能写入死亡:${definition.key}`)
  }

  const hidesLivingActor = before.alive && effect.payload.alive !== false && effect.payload.present === false
  if (hidesLivingActor) {
    if (definition.mortalityPolicy === 'protected') fail(`受保护Actor不能从运行世界退场:${definition.key}`)
    if (definition.mortalityPolicy === 'despawn-on-resolution' && cause !== 'resolution') fail(`临时Actor只能由事件解决结果退场:${definition.key}`)
    if (definition.mortalityPolicy !== 'despawn-on-resolution' && !['story', 'random-event', 'legacy-system'].includes(cause)) fail(`常驻Actor退场原因无效:${definition.key}`)
  }

  const after = structuredClone(before)
  if (effect.payload.alive != null) after.alive = effect.payload.alive
  if (!after.alive) after.present = false
  else if (effect.payload.present != null) after.present = effect.payload.present
  if (effect.payload.locationKey != null) after.locationKey = effect.payload.locationKey
  return { definition, before: structuredClone(before), after }
}

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
      const takeover = modules.actors.serviceContinuity.find(rule => rule.replacementServiceKey === serviceKey)
      const activated = !takeover || input.state.actors[takeover.ownerActorKey]?.alive === false
      return activated && vendor?.actorKey === actor.key && vendor.locationKey === runtime.locationKey
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

/**
 * Deterministic lifecycle boundary shared by player attacks, story outcomes and
 * regional event resolution. The model may select a frozen Action, but it
 * cannot override mortality policy or revive a dead actor in prose.
 */
export function createTextOpenWorldActorLifecycleCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)
  return {
    preview(input: { state: TextOpenWorldEffectStateV1; effect: ActorStateEffect }) {
      return expectedActorState(modules, input.state, input.effect)
    },
  }
}

export type TextOpenWorldActorLifecycleCatalogV1 = ReturnType<typeof createTextOpenWorldActorLifecycleCatalogV1>
