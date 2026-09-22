import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRandomRequestV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldWeatherSettlementAuthorizationV1,
} from '../types'
import { parseTextOpenWorldRandomEvidenceV1 } from './event-contract'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-weather] ${message}`) }

function requestFor(modules: TextOpenWorldParsedModulesV1, regionKey: string, weatherEpoch: number): TextOpenWorldRandomRequestV1 {
  const table = modules['time-weather'].regionWeatherTables.find(candidate => candidate.regionKey === regionKey)
    ?? fail(`地区缺少天气表:${regionKey}`)
  const maximumInclusive = table.entries.reduce((total, entry) => total + entry.weight, 0)
  if (!Number.isSafeInteger(maximumInclusive) || maximumInclusive < 1) fail(`地区天气权重无效:${regionKey}`)
  return {
    drawKey: `weather.${regionKey}.epoch.${weatherEpoch}`,
    minimumInclusive: 1,
    maximumInclusive,
  }
}

function weatherForDraw(modules: TextOpenWorldParsedModulesV1, regionKey: string, drawValue: number): string {
  const table = modules['time-weather'].regionWeatherTables.find(candidate => candidate.regionKey === regionKey)
    ?? fail(`地区缺少天气表:${regionKey}`)
  let cursor = 0
  for (const entry of table.entries) {
    cursor += entry.weight
    if (drawValue <= cursor) return entry.weatherKey
  }
  return fail(`天气随机值超出权重表:${regionKey}:${drawValue}`)
}

function requestFromEvidence(evidence: TextOpenWorldRandomEvidenceV1): TextOpenWorldRandomRequestV1 {
  return {
    drawKey: evidence.drawKey,
    minimumInclusive: evidence.minimumInclusive,
    maximumInclusive: evidence.maximumInclusive,
  }
}

export interface TextOpenWorldClockWeatherProjectionV1 {
  day: number
  timePeriodKey: string
  timePeriodLabel: string
  regionKey: string
  weatherKey: string
  weatherLabel: string
  weatherDescription: string
}

export function projectTextOpenWorldClockWeatherV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
  parsedModules?: TextOpenWorldParsedModulesV1
}): TextOpenWorldClockWeatherProjectionV1 {
  const modules = input.parsedModules ?? parseTextOpenWorldModulesV1(input.runtimePackage)
  const minuteOfDay = input.state.time.worldMinute % modules['time-weather'].minutesPerDay
  const period = modules['time-weather'].timePeriods.find(candidate => minuteOfDay >= candidate.startMinute && minuteOfDay < candidate.endMinute)
    ?? fail(`世界时间无法映射时间段:${input.state.time.worldMinute}`)
  const regionKey = modules.world.locations.find(location => location.key === input.state.map.currentLocationKey)?.regionKey
    ?? fail(`当前位置没有所属地区:${input.state.map.currentLocationKey}`)
  const weatherKey = input.state.time.currentWeatherByRegionKey[regionKey] ?? fail(`当前地区缺少天气状态:${regionKey}`)
  const weather = modules['time-weather'].weather.find(candidate => candidate.key === weatherKey)
    ?? fail(`当前天气不存在于Release:${weatherKey}`)
  return {
    day: Math.floor(input.state.time.worldMinute / modules['time-weather'].minutesPerDay) + 1,
    timePeriodKey: period.key,
    timePeriodLabel: period.label,
    regionKey,
    weatherKey,
    weatherLabel: weather.label,
    weatherDescription: weather.description,
  }
}

export function createTextOpenWorldWeatherCatalogV1(
  runtimePackage: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(runtimePackage)
  const timeWeather = modules['time-weather']

  function requestsFor(state: TextOpenWorldEffectStateV1): TextOpenWorldRandomRequestV1[] {
    if (timeWeather.version < 2) fail('旧版时间天气模块不支持自动天气结算')
    const weatherEpoch = Math.floor(state.time.worldMinute / timeWeather.weatherUpdateIntervalMinutes)
    if (weatherEpoch <= state.time.lastWeatherSettlementEpoch) fail('当前天气周期已经结算')
    return [...modules.world.regions]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(region => requestFor(modules, region.key, weatherEpoch))
  }

  function resolve(input: {
    state: TextOpenWorldEffectStateV1
    evidence: TextOpenWorldRandomEvidenceV1[]
  }): TextOpenWorldWeatherSettlementAuthorizationV1 {
    const randomRequests = requestsFor(input.state)
    if (input.evidence.length !== randomRequests.length) fail('天气随机证据数量不一致')
    const evidence = input.evidence.map((item, index) => parseTextOpenWorldRandomEvidenceV1(item, `weather.evidence[${index}]`))
    evidence.forEach((item, index) => {
      if (item.drawIndex !== index) fail(`天气随机证据序号不一致:${index}`)
      if (canonicalProductProductionJsonV2(requestFromEvidence(item)) !== canonicalProductProductionJsonV2(randomRequests[index])) {
        fail(`天气随机证据请求不一致:${index}`)
      }
    })
    const weatherEpoch = Math.floor(input.state.time.worldMinute / timeWeather.weatherUpdateIntervalMinutes)
    const regions = [...modules.world.regions].sort((left, right) => left.key.localeCompare(right.key))
    return {
      kind: 'weather-settlement',
      worldMinute: input.state.time.worldMinute,
      weatherEpoch,
      randomRequests,
      changes: evidence.map((item, index) => {
        const regionKey = regions[index].key
        return {
          regionKey,
          fromWeatherKey: input.state.time.currentWeatherByRegionKey[regionKey] ?? fail(`地区缺少当前天气:${regionKey}`),
          toWeatherKey: weatherForDraw(modules, regionKey, item.value),
          drawKey: item.drawKey,
          drawValue: item.value,
        }
      }),
    }
  }

  function assertAuthorization(input: {
    state: TextOpenWorldEffectStateV1
    authorization: TextOpenWorldWeatherSettlementAuthorizationV1
    evidence?: TextOpenWorldRandomEvidenceV1[]
  }): void {
    if (input.authorization.kind !== 'weather-settlement') fail('天气授权kind无效')
    if (input.authorization.worldMinute !== input.state.time.worldMinute) fail('天气授权世界时间已经过期')
    const expectedEpoch = Math.floor(input.state.time.worldMinute / timeWeather.weatherUpdateIntervalMinutes)
    if (input.authorization.weatherEpoch !== expectedEpoch) fail('天气授权周期已经过期')
    if (input.authorization.weatherEpoch <= input.state.time.lastWeatherSettlementEpoch) fail('天气授权周期已经结算')
    const expectedRequests = requestsFor(input.state)
    if (canonicalProductProductionJsonV2(input.authorization.randomRequests) !== canonicalProductProductionJsonV2(expectedRequests)) fail('天气授权随机请求不一致')
    const values = input.authorization.changes.map((change, drawIndex) => ({
      drawKey: change.drawKey,
      minimumInclusive: expectedRequests.find(request => request.drawKey === change.drawKey)?.minimumInclusive ?? 0,
      maximumInclusive: expectedRequests.find(request => request.drawKey === change.drawKey)?.maximumInclusive ?? 0,
      algorithm: 'sha256-range-v1' as const,
      seedHash: '0'.repeat(64),
      inputHash: '0'.repeat(64),
      drawIndex,
      value: change.drawValue,
    }))
    const expected = resolve({ state: input.state, evidence: values })
    if (canonicalProductProductionJsonV2(input.authorization) !== canonicalProductProductionJsonV2(expected)) fail('天气授权变化与权重表不一致')
    if (input.evidence) {
      const actual = resolve({ state: input.state, evidence: input.evidence })
      if (canonicalProductProductionJsonV2(input.authorization) !== canonicalProductProductionJsonV2(actual)) fail('天气授权与事件随机证据不一致')
    }
  }

  return {
    prepare: ({ state }: { state: TextOpenWorldEffectStateV1 }) => requestsFor(state),
    resolve,
    assertAuthorization,
  }
}

export type TextOpenWorldWeatherCatalogV1 = ReturnType<typeof createTextOpenWorldWeatherCatalogV1>
