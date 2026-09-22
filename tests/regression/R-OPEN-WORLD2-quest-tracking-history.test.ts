import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { projectTextOpenWorldQuestDeadlineV1, projectTextOpenWorldQuestHistoryV1 } from '../../src/lib/open-world/quest-history'
import { createTextOpenWorldQuestTrackingCatalogV1 } from '../../src/lib/open-world/quest-tracking'
import { createTextOpenWorldDirectorQuestInstanceV1 } from '../../src/lib/open-world/quests'
import { createInitialTextOpenWorldSessionProjectionV1, parseTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'
const TIMED_INSTANCE_KEY = 'quest-instance.20.quest.ordinary.timed.release.13.session-start'

function addTimedOrdinary(runtimePackage = createTextOpenWorldVNextFixture()) {
  const quests = runtimePackage.modules.quests.payload as any
  quests.quests.push({
    key: 'quest.ordinary.timed', type: 'ordinary', ownerKind: 'region', ownerKey: 'region.salt-port',
    title: '退潮前的药草', description: '在潮水回来前处理一份地方委托。', storylineKey: null,
    regionKeys: ['region.salt-port'], stageKeys: ['quest-stage.ordinary.timed'], prerequisiteConditionKeys: [],
    rewardEffectKeys: [], rewardContractKey: null, claimActionKey: null, lifecyclePolicy: 'abandon-terminal',
    timePolicy: 'timed', expirationMinutes: 60, repeatable: false, instantiationPolicy: 'session-start',
    initialStatus: 'revealed', estimatedMinutes: 10, tags: ['timed'],
  })
  quests.stages.push({
    key: 'quest-stage.ordinary.timed', questKey: 'quest.ordinary.timed', order: 1, title: '寻找药草',
    objectiveKeys: ['objective.ordinary.timed'], completionConditionKeys: ['condition.always'], completionActionKey: 'action.complete-ordinary-timed',
  })
  quests.objectives.push({
    key: 'objective.ordinary.timed', stageKey: 'quest-stage.ordinary.timed', title: '找到药草', optional: false,
    actionKeys: ['action.complete-ordinary-timed-objective'],
  })
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push(
    { key: 'effect.complete-ordinary-timed-objective', operation: 'complete-objective', payload: { objectiveKey: 'objective.ordinary.timed' } },
    { key: 'effect.complete-ordinary-timed', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.timed', status: 'completed', stageKey: 'quest-stage.ordinary.timed' } },
    { key: 'effect.expire-ordinary-timed-unstarted', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.timed', status: 'expired', stageKey: null } },
    { key: 'effect.expire-ordinary-timed-active', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.timed', status: 'expired', stageKey: 'quest-stage.ordinary.timed' } },
  )
  actions.actions.push({
    key: 'action.complete-ordinary-timed-objective', category: 'objective-action', label: '找到药草', description: '完成限时任务目标。',
    actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.complete-ordinary-timed-objective'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  }, {
    key: 'action.complete-ordinary-timed', category: 'quest-action', label: '结算药草任务', description: '由系统完成药草任务。',
    actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: ['condition.always'], costEffectKeys: [],
    successEffectKeys: ['effect.complete-ordinary-timed'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  }, {
    key: 'action.expire-ordinary-timed-unstarted', category: 'quest-action', label: '过期未接药草任务', description: '由系统关闭到期任务。',
    actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.expire-ordinary-timed-unstarted'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  }, {
    key: 'action.expire-ordinary-timed-active', category: 'quest-action', label: '过期进行中药草任务', description: '由系统关闭到期任务。',
    actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.expire-ordinary-timed-active'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  })
  return runtimePackage
}

async function createSession(runtimePackage: TextOpenWorldRuntimePackageV1, label: string) {
  return (await createGovernedTextOpenWorldSessionFixtureV1({
    name: `${label}-${crypto.randomUUID()}`,
    textOpenWorldVNext: runtimePackage,
    title: label,
    seed: `${label}.seed`,
  })).session
}

describe('Text Open World vNext · quest tracking, deadlines and history', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('主追踪和最多三个HUD钉选属于Session状态，取消追踪不改变任务生命周期', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const catalog = createTextOpenWorldQuestTrackingCatalogV1(runtimePackage)
    const instances = Array.from({ length: 4 }, (_, index) => createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: `tracking.${index + 1}`, worldMinute: 480,
    }))
    instances.forEach(instance => { state.quests.instancesByKey[instance.instanceKey] = instance })
    for (const instance of instances.slice(0, 3)) catalog.apply({ state, authorization: catalog.prepare({ instanceKey: instance.instanceKey, state, operation: 'track', slot: 'pinned' }) })
    expect(state.quests.tracking.pinnedInstanceKeys).toHaveLength(3)
    expect(() => catalog.prepare({ instanceKey: instances[3].instanceKey, state, operation: 'track', slot: 'pinned' })).toThrow('最多钉选3个')
    catalog.apply({ state, authorization: catalog.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, operation: 'untrack', slot: 'primary' }) })
    expect(state.quests.tracking.primaryInstanceKey).toBeNull()
    expect(state.quests.instancesByKey[MAIN_INSTANCE_KEY].status).toBe('revealed')
  })

  it('追踪Action可回放并形成可按实例查询的任务历史，篡改授权会失败关闭', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const session = await createSession(runtimePackage, 'tracking-history')
    await executeTextOpenWorldActionV1({ sessionId: session.id!, actionKey: 'action.untrack-quest-primary', targetKey: MAIN_INSTANCE_KEY })
    await executeTextOpenWorldActionV1({ sessionId: session.id!, actionKey: 'action.track-quest-primary', targetKey: MAIN_INSTANCE_KEY })
    const runtime = await readProductRuntimeState(session.id!)
    expect(runtime.textOpenWorld!.state.quests.tracking.primaryInstanceKey).toBe(MAIN_INSTANCE_KEY)
    expect(runtime.textOpenWorld!.state.quests.instancesByKey[MAIN_INSTANCE_KEY].status).toBe('revealed')
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(projectTextOpenWorldQuestHistoryV1({ runtimePackage, events, instanceKey: MAIN_INSTANCE_KEY }).map(entry => entry.kind))
      .toEqual(['untracked', 'tracked'])

    const state = runtime.textOpenWorld!.state
    const authorization = createTextOpenWorldQuestTrackingCatalogV1(runtimePackage).prepare({
      instanceKey: MAIN_INSTANCE_KEY, state, operation: 'untrack', slot: 'primary',
    })
    authorization.beforePinnedInstanceKeys = ['quest-instance.forged']
    await expect(createTextOpenWorldEffectCatalogV1(runtimePackage).plan({
      effectKeys: ['effect.untrack-quest-primary'], claimKey: 'claim.forged-tracking', state, authorization,
    })).rejects.toThrow('任务追踪基线已变化')
  }, 10_000)

  it('旧投影补齐追踪状态；时间越过期限后由系统Action使普通任务过期并进入历史', async () => {
    const runtimePackage = addTimedOrdinary()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    expect(projection.state.quests.instancesByKey[TIMED_INSTANCE_KEY].deadlineWorldMinute).toBe(540)
    const legacy = structuredClone(projection) as any
    delete legacy.state.quests.tracking
    expect(parseTextOpenWorldSessionProjectionV1(legacy).state.quests.tracking).toEqual({ primaryInstanceKey: MAIN_INSTANCE_KEY, pinnedInstanceKeys: [] })
    expect(projectTextOpenWorldQuestDeadlineV1(projection.state.quests.instancesByKey[TIMED_INSTANCE_KEY], 500)).toMatchObject({ remainingMinutes: 40, expired: false, label: '剩余40分钟' })

    const session = await createSession(runtimePackage, 'deadline-expiry')
    await executeTextOpenWorldActionV1({ sessionId: session.id!, actionKey: 'action.rest' })
    const runtime = await readProductRuntimeState(session.id!)
    expect(runtime.textOpenWorld!.state.time.worldMinute).toBe(960)
    expect(runtime.textOpenWorld!.state.quests.instancesByKey[TIMED_INSTANCE_KEY]).toMatchObject({ status: 'expired', terminalAtWorldMinute: 960 })
    const events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).sortBy('sequence')
    expect(events.filter(event => event.type.startsWith('text-open-world.')).map(event => event.type)).toEqual([
      'text-open-world.command.committed', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.random.resolved', 'text-open-world.random.resolved', 'text-open-world.effects.applied',
      'text-open-world.command.committed', 'text-open-world.effects.applied',
    ])
    expect(projectTextOpenWorldQuestHistoryV1({ runtimePackage, events, instanceKey: TIMED_INSTANCE_KEY }).map(entry => entry.kind)).toEqual(['expired'])
  }, 10_000)
})
