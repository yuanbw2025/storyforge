import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldActorScheduleCatalogV1, projectTextOpenWorldActorsV1 } from '../../src/lib/open-world/actors'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldEffectsAppliedEventPayloadV1 } from '../../src/lib/open-world/event-contract'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  createTextOpenWorldInitialProjectionCandidatesV1,
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function publishedNightSession() {
  const runtimePackage = createTextOpenWorldVNextFixture()
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.find((effect: any) => effect.key === 'effect.rest-time').payload.minutes = 600
  actions.actions.find((action: any) => action.key === 'action.rest').timeCostMinutes = 600
  const session = (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 角色日程验收-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: '盐脊角色日程',
    seed: 'actor-schedule-seed',
  })).session
  return { runtimePackage, session }
}

describe('Text Open World vNext · actor tiers, schedules and service availability', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('只投影当前位置所需角色信息，并按角色层级控制叙事上下文成本', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actors = runtimePackage.modules.actors.payload as any
    actors.actors.push(
      { key: 'actor.resident', tier: 'resident', name: '盐商', biography: '经营盐货多年。', portrayal: '健谈但谨慎。', factionKey: null, homeLocationKey: 'location.salt-port', protected: false, serviceKeys: [], scheduleKey: null },
      { key: 'actor.transient', tier: 'transient', name: '路人', biography: '短暂停留。', portrayal: '匆忙。', factionKey: null, homeLocationKey: 'location.salt-port', protected: false, serviceKeys: [], scheduleKey: null },
    )
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const projected = projectTextOpenWorldActorsV1({ runtimePackage, state: projection.state })
    expect(projected).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'actor.caretaker', tier: 'mainline', activity: '检查内渠', portrayal: '说话简短，重视可验证的行动。', availableServices: [{ key: 'vendor.caretaker', title: '守渠补给' }] }),
      expect.objectContaining({ key: 'actor.resident', tier: 'resident', portrayal: null }),
      expect.objectContaining({ key: 'actor.transient', tier: 'transient', portrayal: null }),
    ]))
    expect(JSON.stringify(projected)).not.toContain('经营盐货多年')
    expect(JSON.stringify(projected)).not.toContain('短暂停留')
    expect(deriveTextOpenWorldContextsV1(projection).action.validTargetKeysByScope.vendor).toEqual(['vendor.caretaker'])
  })

  it('同一时间段内不覆盖剧情移动，进入下一时间段后才恢复冻结日程', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.actors['actor.caretaker'].locationKey = 'location.ridge-channel'
    projection.state.actors['actor.caretaker'].scheduleState = '跟随主线调查'
    const catalog = createTextOpenWorldActorScheduleCatalogV1(runtimePackage)
    expect(() => catalog.prepare(projection.state)).toThrow('当前角色日程时间段已经结算')
    expect(projectTextOpenWorldActorsV1({ runtimePackage, state: projection.state, locationKey: 'location.ridge-channel' })[0]).toMatchObject({ activity: '跟随主线调查' })

    projection.state.time.worldMinute = 1080
    const authorization = catalog.prepare(projection.state)
    expect(authorization).toMatchObject({
      fromSettlementWorldMinute: 360, toSettlementWorldMinute: 1080, timePeriodKey: 'time.night',
      changes: [{ actorKey: 'actor.caretaker', fromLocationKey: 'location.ridge-channel', toLocationKey: 'location.salt-port', fromScheduleState: '跟随主线调查', toScheduleState: '整理渠图' }],
    })
    const forged = structuredClone(authorization)
    forged.changes[0].toScheduleState = '伪造活动'
    expect(() => catalog.assertAuthorization({ state: projection.state, authorization: forged })).toThrow('授权与冻结日程或当前状态不一致')
    const effects = createTextOpenWorldEffectCatalogV1(runtimePackage)
    const plan = await effects.plan({ effectKeys: ['effect.settle-actor-schedules'], claimKey: 'claim.actor-schedule.night', state: projection.state, authorization })
    const settled = (await effects.apply({ plan, state: projection.state })).state
    expect(settled.time.lastActorScheduleSettlementWorldMinute).toBe(1080)
    expect(settled.actors['actor.caretaker']).toMatchObject({ locationKey: 'location.salt-port', scheduleState: '整理渠图' })
    expect(projectTextOpenWorldActorsV1({ runtimePackage, state: settled })[0].availableServices).toEqual([])
  })

  it('跨时间段后按天气、角色日程、任务的顺序结算，并关闭非营业服务', async () => {
    const { session } = await publishedNightSession()
    await executeTextOpenWorldActionV1({ sessionId: session.id!, actionKey: 'action.rest', commandId: 'command.actor.night', requestedAt: 1_100 })
    const runtime = await readProductRuntimeState(session.id!)
    expect(runtime.textOpenWorld!.state.time).toMatchObject({ worldMinute: 1080, lastWeatherSettlementEpoch: 3, lastActorScheduleSettlementWorldMinute: 1080 })
    expect(runtime.textOpenWorld!.state.actors['actor.caretaker']).toMatchObject({ scheduleState: '整理渠图' })
    expect(deriveTextOpenWorldContextsV1(runtime.textOpenWorld!).action.validTargetKeysByScope.vendor).toEqual([])
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.map(event => event.type)).toEqual([
      'narrative.started', 'narrative.node.entered',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.random.resolved', 'text-open-world.random.resolved', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
    ])
    const scheduleEvent = parseTextOpenWorldEffectsAppliedEventPayloadV1(JSON.parse(events[9].payloadJson))
    expect(scheduleEvent.plan.authorization).toMatchObject({ kind: 'actor-schedule-settlement', worldMinute: 1080, timePeriodKey: 'time.night' })
  })

  it('Actor v2拒绝缺口日程、越权服务和服务地点漂移', () => {
    const missingPeriod = createTextOpenWorldVNextFixture()
    ;(missingPeriod.modules.actors.payload as any).schedules[0].entries.pop()
    expect(() => parseTextOpenWorldModulesV1(missingPeriod)).toThrow('time period coverage 双向引用不一致')

    const foreignService = createTextOpenWorldVNextFixture()
    ;(foreignService.modules.actors.payload as any).schedules[0].entries[1].availableServiceKeys = ['vendor.unknown']
    expect(() => parseTextOpenWorldModulesV1(foreignService)).toThrow('日程开放了不属于角色的服务')

    const wrongLocation = createTextOpenWorldVNextFixture()
    ;(wrongLocation.modules.actors.payload as any).schedules[0].entries[1].locationKey = 'location.ridge-channel'
    expect(() => parseTextOpenWorldModulesV1(wrongLocation)).toThrow('日程服务地点与vendor地点不一致')
  })

  it('旧Actor v1可规范化读取，新Session则必须带有角色日程游标', () => {
    const legacy = createTextOpenWorldVNextFixture()
    const actors = legacy.modules.actors.payload as any
    actors.version = 1
    legacy.modules.actors.schemaVersion = 1
    actors.schedules.flatMap((schedule: any) => schedule.entries).forEach((entry: any) => { delete entry.availableServiceKeys })
    const actions = legacy.modules.actions.payload as any
    actions.version = 5
    legacy.modules.actions.schemaVersion = 5
    actions.actions = actions.actions.filter((action: any) => action.category !== 'actor-schedule-action')
    actions.effects = actions.effects.filter((effect: any) => effect.operation !== 'settle-actor-schedules')
    const parsed = parseTextOpenWorldModulesV1(legacy)
    expect(parsed.actors).toMatchObject({ version: 2 })
    expect(parsed.actors.schedules[0].entries[0].availableServiceKeys).toEqual(['vendor.caretaker'])
    expect(createTextOpenWorldInitialProjectionCandidatesV1(legacy).some((candidate: any) => candidate.state.time.lastActorScheduleSettlementWorldMinute === undefined)).toBe(true)

    const current = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextFixture()) as any
    delete current.state.time.lastActorScheduleSettlementWorldMinute
    expect(() => parseTextOpenWorldSessionProjectionV1(current)).toThrow('新版Session缺少角色日程结算游标')
  })
})
