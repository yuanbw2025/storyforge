import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldEffectsAppliedEventPayloadV1 } from '../../src/lib/open-world/event-contract'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createInitialTextOpenWorldSessionProjectionV1, parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldWeatherCatalogV1, projectTextOpenWorldClockWeatherV1 } from '../../src/lib/open-world/weather'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture, downgradeTextOpenWorldFixtureWithoutCrimeV1 } from '../helpers/text-open-world-vnext-fixture'

async function publishedSession(seed = 'weather-seed') {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const session = (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 时间天气验收-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: '盐脊时间天气',
    seed,
  })).session
  return { runtimePackage, session }
}

describe('Text Open World vNext · monotonic world time and replayable weather', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('昼夜与当前地区天气来自同一只读投影，玩家只看到天数和时间段', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const before = structuredClone(projection.state)
    expect(projectTextOpenWorldClockWeatherV1({ runtimePackage, state: projection.state })).toEqual({
      day: 1,
      timePeriodKey: 'time.day',
      timePeriodLabel: '白天',
      regionKey: 'region.salt-port',
      weatherKey: 'weather.clear',
      weatherLabel: '晴朗',
      weatherDescription: '干燥而明亮。',
    })
    expect(projection.state).toEqual(before)

    projection.state.time.worldMinute = 1_500
    expect(projectTextOpenWorldClockWeatherV1({ runtimePackage, state: projection.state })).toMatchObject({ day: 2, timePeriodLabel: '清晨' })
  })

  it('休息跨越天气周期后，以独立系统命令原子结算所有地区并保存随机证据；重试不重复抽取', async () => {
    const { session } = await publishedSession()
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.rest', commandId: 'command.weather.rest', requestedAt: 1_100,
    })
    expect(feedback).toMatchObject({ status: 'succeeded', evidenceEventSequences: [3, 4] })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(event => event.type)).toEqual([
      'narrative.started', 'narrative.node.entered',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.random.resolved', 'text-open-world.random.resolved', 'text-open-world.effects.applied',
    ])
    const weatherEvent = events[7]
    const payload = parseTextOpenWorldEffectsAppliedEventPayloadV1(JSON.parse(weatherEvent.payloadJson))
    expect(payload.plan.authorization).toMatchObject({ kind: 'weather-settlement', worldMinute: 960, weatherEpoch: 2 })
    if (payload.plan.authorization?.kind !== 'weather-settlement') throw new Error('expected weather authorization')
    expect(payload.plan.authorization.randomRequests).toHaveLength(2)
    expect(payload.plan.authorization.changes.map(change => change.regionKey)).toEqual(['region.ridge', 'region.salt-port'])
    const runtime = await readProductRuntimeState(session.id!)
    expect(runtime.textOpenWorld!.state.time).toMatchObject({
      worldMinute: 960,
      lastWeatherSettlementEpoch: 2,
      currentWeatherByRegionKey: Object.fromEntries(payload.plan.authorization.changes.map(change => [change.regionKey, change.toWeatherKey])),
    })

    const retried = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.rest', commandId: 'command.weather.rest', requestedAt: 9_999,
    })
    expect(retried.receiptHash).toBe(feedback.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(8)
  })

  it('若进程在耗时Effect与天气系统命令之间中断，下一次成功行动会补齐未结算周期', async () => {
    const { runtimePackage, session } = await publishedSession('weather-recovery-seed')
    const base = await readProductRuntimeStateVersion(session.id!)
    await commitTextOpenWorldCommandV1({
      schema: 'storyforge.text-open-world.command', version: 1,
      commandId: 'command.weather.interrupted-rest', sessionId: session.id!, actorKey: 'player', actionKey: 'action.rest', payload: {},
      baseSequence: base.sequence, baseStateHash: base.stateHash, source: 'system-action', requestedAt: 1_000,
    })
    const pending = (await readProductRuntimeState(session.id!)).textOpenWorld!
    const catalog = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await catalog.plan({ effectKeys: ['effect.rest-full', 'effect.rest-time'], claimKey: 'claim.command.weather.interrupted-rest', state: pending.state })
    const { receipt } = await catalog.apply({ plan, state: pending.state })
    await commitTextOpenWorldOutcomeBatchV1({
      sessionId: session.id!, commandId: 'command.weather.interrupted-rest', ruleset: pending.ruleset,
      randomRequests: [], plan, receipt, outcome: 'success', reason: null, degradation: null,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld!.state.time).toMatchObject({ worldMinute: 960, lastWeatherSettlementEpoch: 1 })

    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.equip-rust-sword', targetKey: 'item.rust-sword',
      commandId: 'command.weather.recovery-trigger', requestedAt: 1_100,
    })
    const recovered = (await readProductRuntimeState(session.id!)).textOpenWorld!
    expect(recovered.state.time).toMatchObject({ worldMinute: 960, lastWeatherSettlementEpoch: 2 })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(event => event.type)).toEqual([
      'narrative.started', 'narrative.node.entered',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.random.resolved', 'text-open-world.random.resolved', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
    ])
  })

  it('天气授权冻结世界分钟、周期、权重请求和抽取结果，任一篡改都会失败关闭', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.time.worldMinute = 960
    const catalog = createTextOpenWorldWeatherCatalogV1(runtimePackage)
    const requests = catalog.prepare({ state: projection.state })
    const evidence = requests.map((request, drawIndex) => ({
      ...request,
      algorithm: 'sha256-range-v1' as const,
      seedHash: 'a'.repeat(64),
      inputHash: 'b'.repeat(64),
      drawIndex,
      value: request.minimumInclusive,
    }))
    const authorization = catalog.resolve({ state: projection.state, evidence })
    expect(() => catalog.assertAuthorization({ state: projection.state, authorization, evidence })).not.toThrow()

    const forged = structuredClone(authorization)
    forged.changes[0].toWeatherKey = forged.changes[0].toWeatherKey === 'weather.clear' ? 'weather.rain' : 'weather.clear'
    expect(() => catalog.assertAuthorization({ state: projection.state, authorization: forged, evidence })).toThrow('天气授权变化与权重表不一致')
    projection.state.time.worldMinute += 1
    expect(() => catalog.assertAuthorization({ state: projection.state, authorization, evidence })).toThrow('天气授权世界时间已经过期')
  })

  it('新版构建拒绝非整数天气权重、缺失结算Action和只声明不落实的行动耗时；旧版仍可读取', () => {
    const fractional = createTextOpenWorldVNextFixture()
    ;(fractional.modules['time-weather'].payload as any).regionWeatherTables[0].entries[0].weight = 1.5
    expect(() => parseTextOpenWorldModulesV1(fractional)).toThrow('weather weight 必须是整数')

    const missingWeatherAction = createTextOpenWorldVNextFixture()
    const actions = missingWeatherAction.modules.actions.payload as any
    actions.actions = actions.actions.filter((action: any) => action.category !== 'weather-action')
    expect(() => parseTextOpenWorldModulesV1(missingWeatherAction)).toThrow('必须且只能定义一个天气结算Action')

    const missingTimeEffect = createTextOpenWorldVNextFixture()
    ;(missingTimeEffect.modules.actions.payload as any).actions.find((action: any) => action.key === 'action.investigate-channel').successEffectKeys = []
    expect(() => parseTextOpenWorldModulesV1(missingTimeEffect)).toThrow('Action声明耗时必须由唯一advance-time Effect落实')

    const missingSettlementCursor = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture()) as any
    delete missingSettlementCursor.state.time.lastWeatherSettlementEpoch
    expect(() => parseTextOpenWorldSessionProjectionV1(missingSettlementCursor)).toThrow('新版Session缺少天气结算周期游标')

    const legacy = createTextOpenWorldVNextFixture()
    downgradeTextOpenWorldFixtureWithoutCrimeV1(legacy)
    const legacyTime = legacy.modules['time-weather'].payload as any
    legacyTime.version = 1
    delete legacyTime.weatherUpdateIntervalMinutes
    legacy.modules['time-weather'].schemaVersion = 1
    const legacyActions = legacy.modules.actions.payload as any
    legacyActions.version = 4
    legacy.modules.actions.schemaVersion = 4
    legacyActions.actions = legacyActions.actions.filter((action: any) => action.category !== 'weather-action')
    legacyActions.effects = legacyActions.effects.filter((effect: any) => effect.operation !== 'settle-weather')
    expect(parseTextOpenWorldModulesV1(legacy)['time-weather']).toMatchObject({ version: 1, weatherUpdateIntervalMinutes: 1440 })
  })
})
