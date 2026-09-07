import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { createTextOpenWorldObjectiveCatalogV1 } from '../../src/lib/open-world/objective-state'
import { createTextOpenWorldQuestTransitionCatalogV1 } from '../../src/lib/open-world/quest-state-machine'
import { createTextOpenWorldDirectorQuestInstanceV1 } from '../../src/lib/open-world/quests'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import type { TextOpenWorldRuntimePackageV1 } from '../../src/lib/types'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'
const ORDINARY_INSTANCE_KEY = 'quest-instance.16.quest.ordinary.1.release.13.session-start'

function addRestartableOrdinaryQuest(runtimePackage = createTextOpenWorldVNextFixture()) {
  const quests = runtimePackage.modules.quests.payload as any
  quests.quests.push({
    key: 'quest.ordinary.1', type: 'ordinary', ownerKind: 'location', ownerKey: 'location.salt-port',
    title: '遗失的渠尺', description: '寻找工匠遗失的渠尺。', storylineKey: null,
    regionKeys: ['region.salt-port'], stageKeys: ['quest-stage.ordinary.1'], prerequisiteConditionKeys: [], rewardEffectKeys: [], rewardContractKey: null, claimActionKey: null,
    lifecyclePolicy: 'abandon-restart', timePolicy: 'waits', expirationMinutes: null, repeatable: false,
    instantiationPolicy: 'session-start', initialStatus: 'revealed', estimatedMinutes: 10, tags: ['local'],
  })
  quests.stages.push({
    key: 'quest-stage.ordinary.1', questKey: 'quest.ordinary.1', order: 1, title: '寻找渠尺',
    objectiveKeys: ['objective.ordinary.1'], completionConditionKeys: ['condition.always'], completionActionKey: 'action.complete-ordinary-quest',
  })
  quests.objectives.push({
    key: 'objective.ordinary.1', stageKey: 'quest-stage.ordinary.1', title: '询问盐港工匠', optional: false,
    actionKeys: ['action.investigate-channel', 'action.complete-ordinary-objective'],
  })
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push(
    { key: 'effect.complete-ordinary-objective', operation: 'complete-objective', payload: { objectiveKey: 'objective.ordinary.1' } },
    { key: 'effect.complete-ordinary-quest', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.1', status: 'completed', stageKey: 'quest-stage.ordinary.1' } },
  )
  actions.actions.push({
    key: 'action.complete-ordinary-objective', category: 'objective-action', label: '完成渠尺询问', description: '完成普通任务目标。',
    actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.complete-ordinary-objective'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  }, {
    key: 'action.complete-ordinary-quest', category: 'quest-action', label: '结算渠尺任务', description: '由系统结算普通任务。',
    actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: ['condition.always'], costEffectKeys: [],
    successEffectKeys: ['effect.complete-ordinary-quest'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  })
  return runtimePackage
}

function addOrdinaryQuestActions(runtimePackage = addRestartableOrdinaryQuest()) {
  const actions = runtimePackage.modules.actions.payload as any
  actions.effects.push(
    { key: 'effect.accept-ordinary', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.1', status: 'accepted', stageKey: null } },
    { key: 'effect.activate-ordinary', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.1', status: 'active', stageKey: 'quest-stage.ordinary.1' } },
    { key: 'effect.abandon-ordinary', operation: 'transition-quest', payload: { questKey: 'quest.ordinary.1', status: 'abandoned', stageKey: 'quest-stage.ordinary.1' } },
  )
  actions.actions.push({
    key: 'action.accept-ordinary', category: 'accept-quest', label: '接受渠尺委托', description: '接受并开始寻找渠尺。',
    actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.accept-ordinary', 'effect.activate-ordinary'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
  }, {
    key: 'action.abandon-ordinary', category: 'abandon-quest', label: '放弃渠尺委托', description: '放弃当前渠尺委托。',
    actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: ['effect.abandon-ordinary'], failureEffectKeys: [], timeCostMinutes: 0,
    confirmationPolicy: 'always', repeatPolicy: 'repeatable', cooldownMinutes: null,
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

describe('Text Open World vNext · governed Quest lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('主线可接取、暂停、恢复和完成，但不能失败、放弃、过期或撤回', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const catalog = createTextOpenWorldQuestTransitionCatalogV1(runtimePackage)
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const accepted = catalog.prepare({
      instanceKey: MAIN_INSTANCE_KEY, state,
      transitions: [{ toStatus: 'accepted', stageKey: null }, { toStatus: 'active', stageKey: 'quest-stage.main.1' }],
    })
    expect(accepted.transitions.map(step => `${step.actorKind}:${step.intent}`)).toEqual(['player:accept', 'system:activate'])
    catalog.apply({ state, authorization: accepted })
    expect(state.quests.instancesByKey[MAIN_INSTANCE_KEY]).toMatchObject({ status: 'active', currentStageKey: 'quest-stage.main.1' })

    for (const status of ['failed', 'abandoned', 'expired'] as const) {
      expect(() => catalog.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, transitions: [{ toStatus: status, stageKey: 'quest-stage.main.1' }] }))
        .toThrow('主线不允许')
    }
    const suspended = catalog.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, transitions: [{ toStatus: 'suspended', stageKey: 'quest-stage.main.1' }] })
    catalog.apply({ state, authorization: suspended })
    const resumed = catalog.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, transitions: [{ toStatus: 'active', stageKey: 'quest-stage.main.1' }] })
    catalog.apply({ state, authorization: resumed })
    const objective = createTextOpenWorldObjectiveCatalogV1(runtimePackage)
    objective.apply({ state, authorization: objective.prepare({ instanceKey: MAIN_INSTANCE_KEY, objectiveKey: 'objective.main.1', state }) })
    const completed = catalog.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, transitions: [{ toStatus: 'completed', stageKey: 'quest-stage.main.1' }] })
    catalog.apply({ state, authorization: completed })
    expect(state.quests.instancesByKey[MAIN_INSTANCE_KEY]).toMatchObject({ status: 'completed', terminalAtWorldMinute: 480 })
  })

  it('不限时普通任务可放弃并重新揭示，失败则永久终结', () => {
    const runtimePackage = addRestartableOrdinaryQuest()
    const catalog = createTextOpenWorldQuestTransitionCatalogV1(runtimePackage)
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const start = catalog.prepare({
      instanceKey: ORDINARY_INSTANCE_KEY, state,
      transitions: [{ toStatus: 'accepted', stageKey: null }, { toStatus: 'active', stageKey: 'quest-stage.ordinary.1' }],
    })
    catalog.apply({ state, authorization: start })
    const abandon = catalog.prepare({ instanceKey: ORDINARY_INSTANCE_KEY, state, transitions: [{ toStatus: 'abandoned', stageKey: 'quest-stage.ordinary.1' }] })
    catalog.apply({ state, authorization: abandon })
    state.time.worldMinute = 600
    const reoffer = catalog.prepare({
      instanceKey: ORDINARY_INSTANCE_KEY, state,
      transitions: [{ toStatus: 'available', stageKey: null }, { toStatus: 'revealed', stageKey: null }],
    })
    catalog.apply({ state, authorization: reoffer })
    expect(state.quests.instancesByKey[ORDINARY_INSTANCE_KEY]).toMatchObject({
      status: 'revealed', offeredAtWorldMinute: 600, acceptedAtWorldMinute: null, currentStageKey: null, terminalAtWorldMinute: null,
    })

    const restart = catalog.prepare({
      instanceKey: ORDINARY_INSTANCE_KEY, state,
      transitions: [{ toStatus: 'accepted', stageKey: null }, { toStatus: 'active', stageKey: 'quest-stage.ordinary.1' }],
    })
    catalog.apply({ state, authorization: restart })
    const failed = catalog.prepare({ instanceKey: ORDINARY_INSTANCE_KEY, state, transitions: [{ toStatus: 'failed', stageKey: 'quest-stage.ordinary.1' }] })
    catalog.apply({ state, authorization: failed })
    expect(() => catalog.prepare({ instanceKey: ORDINARY_INSTANCE_KEY, state, transitions: [{ toStatus: 'available', stageKey: null }] }))
      .toThrow('不存在合法迁移')
  })

  it('限时任务只有到达实例截止时间后才能过期，授权篡改和裸迁移Effect均被拒绝', async () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const timed = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'expiry.1', worldMinute: 600,
    })
    state.time.worldMinute = 600
    state.quests.instancesByKey[timed.instanceKey] = timed
    const catalog = createTextOpenWorldQuestTransitionCatalogV1(runtimePackage)
    expect(() => catalog.prepare({ instanceKey: timed.instanceKey, state, transitions: [{ toStatus: 'expired', stageKey: null }] }))
      .toThrow('任务尚未到期')
    state.time.worldMinute = timed.deadlineWorldMinute!
    const expiration = catalog.prepare({ instanceKey: timed.instanceKey, state, transitions: [{ toStatus: 'expired', stageKey: null }] })
    const forged = structuredClone(expiration)
    forged.transitions[0].fromStatus = 'active'
    expect(() => catalog.assertAuthorization({ state, authorization: forged })).toThrow('授权与权威状态不一致')
    catalog.apply({ state, authorization: expiration })
    expect(state.quests.instancesByKey[timed.instanceKey]).toMatchObject({ status: 'expired', terminalAtWorldMinute: timed.deadlineWorldMinute })

    const initial = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    await expect(createTextOpenWorldEffectCatalogV1(runtimePackage).plan({
      effectKeys: ['effect.accept-main'], claimKey: 'claim.unauthorized-quest-transition', state: initial,
    })).rejects.toThrow('缺少QuestTransition授权')
  })

  it('同一模板的多个任务实例分别完成Objective，不会按定义串改另一实例', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    state.time.worldMinute = 600
    const first = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'multi.1', worldMinute: 600,
    })
    const second = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'multi.2', worldMinute: 600,
    })
    state.quests.instancesByKey[first.instanceKey] = first
    state.quests.instancesByKey[second.instanceKey] = second
    const quests = createTextOpenWorldQuestTransitionCatalogV1(runtimePackage)
    for (const instanceKey of [first.instanceKey, second.instanceKey]) {
      quests.apply({ state, authorization: quests.prepare({
        instanceKey, state,
        transitions: [{ toStatus: 'accepted', stageKey: null }, { toStatus: 'active', stageKey: 'quest-stage.template.supplies' }],
      }) })
    }
    const objectives = createTextOpenWorldObjectiveCatalogV1(runtimePackage)
    objectives.apply({ state, authorization: objectives.prepare({
      instanceKey: first.instanceKey, objectiveKey: 'objective.template.supplies', state,
    }) })
    expect(state.quests.instancesByKey[first.instanceKey].objectiveStatusByKey['objective.template.supplies']).toBe('completed')
    expect(state.quests.instancesByKey[second.instanceKey].objectiveStatusByKey['objective.template.supplies']).toBe('active')
  })

  it('多Stage任务只能在必需目标完成后按相邻顺序推进，最终Stage完成后才终结', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const questsModule = runtimePackage.modules.quests.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    questsModule.quests.find((quest: any) => quest.key === 'quest.main.1').stageKeys.push('quest-stage.main.2')
    questsModule.stages.push({
      key: 'quest-stage.main.2', questKey: 'quest.main.1', order: 2, title: '追查上游',
      objectiveKeys: ['objective.main.2'], completionConditionKeys: ['condition.always'], completionActionKey: 'action.complete-main-final',
    })
    questsModule.objectives.push({
      key: 'objective.main.2', stageKey: 'quest-stage.main.2', title: '确认断脊渠口', optional: false,
      actionKeys: ['action.complete-main-objective-2'],
    })
    actions.effects.find((effect: any) => effect.key === 'effect.complete-main-quest').payload = {
      questKey: 'quest.main.1', status: 'active', stageKey: 'quest-stage.main.2',
    }
    actions.effects.push(
      { key: 'effect.complete-main-objective-2', operation: 'complete-objective', payload: { objectiveKey: 'objective.main.2' } },
      { key: 'effect.complete-main-final', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'completed', stageKey: 'quest-stage.main.2' } },
    )
    actions.actions.push({
      key: 'action.complete-main-objective-2', category: 'objective-action', label: '确认渠口', description: '完成第二阶段目标。',
      actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.complete-main-objective-2'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    }, {
      key: 'action.complete-main-final', category: 'quest-action', label: '结算最终阶段', description: '由系统完成主线任务。',
      actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: ['condition.always'], costEffectKeys: [],
      successEffectKeys: ['effect.complete-main-final'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    })
    parseTextOpenWorldModulesV1(runtimePackage)
    const state = createInitialTextOpenWorldSessionProjectionV1(runtimePackage).state
    const transitions = createTextOpenWorldQuestTransitionCatalogV1(runtimePackage)
    const objectives = createTextOpenWorldObjectiveCatalogV1(runtimePackage)
    transitions.apply({ state, authorization: transitions.prepare({
      instanceKey: MAIN_INSTANCE_KEY, state,
      transitions: [{ toStatus: 'accepted', stageKey: null }, { toStatus: 'active', stageKey: 'quest-stage.main.1' }],
    }) })
    expect(() => transitions.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, transitions: [{ toStatus: 'active', stageKey: 'quest-stage.main.2' }] }))
      .toThrow('必需目标完成后')
    objectives.apply({ state, authorization: objectives.prepare({ instanceKey: MAIN_INSTANCE_KEY, objectiveKey: 'objective.main.1', state }) })
    transitions.apply({ state, authorization: transitions.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, transitions: [{ toStatus: 'active', stageKey: 'quest-stage.main.2' }] }) })
    expect(state.quests.instancesByKey[MAIN_INSTANCE_KEY]).toMatchObject({
      status: 'active', currentStageKey: 'quest-stage.main.2',
      objectiveStatusByKey: { 'objective.main.1': 'completed', 'objective.main.2': 'active' },
    })
    objectives.apply({ state, authorization: objectives.prepare({ instanceKey: MAIN_INSTANCE_KEY, objectiveKey: 'objective.main.2', state }) })
    transitions.apply({ state, authorization: transitions.prepare({ instanceKey: MAIN_INSTANCE_KEY, state, transitions: [{ toStatus: 'completed', stageKey: 'quest-stage.main.2' }] }) })
    expect(state.quests.instancesByKey[MAIN_INSTANCE_KEY].status).toBe('completed')
  })

  it('发布时拒绝给受保护主线配置玩家放弃Action', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const actions = runtimePackage.modules.actions.payload as any
    actions.effects.push({ key: 'effect.abandon-main', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'abandoned', stageKey: 'quest-stage.main.1' } })
    actions.actions.push({
      key: 'action.abandon-main', category: 'abandon-quest', label: '放弃主线', description: '不应通过发布。',
      actorScope: 'player', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.abandon-main'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'always', repeatPolicy: 'repeatable', cooldownMinutes: null,
    })
    expect(() => parseTextOpenWorldModulesV1(runtimePackage)).toThrow('不能违反任务保护策略')
  })

  it('发布时拒绝普通Action夹带任务迁移，也拒绝系统使受保护主线失败', () => {
    const smuggled = createTextOpenWorldVNextFixture()
    ;(smuggled.modules.actions.payload as any).actions[0].successEffectKeys = ['effect.accept-main', 'effect.investigate-time']
    expect(() => parseTextOpenWorldModulesV1(smuggled)).toThrow('任务迁移Effect只能由任务生命周期Action引用')

    const failedMain = createTextOpenWorldVNextFixture()
    const actions = failedMain.modules.actions.payload as any
    actions.effects.push({ key: 'effect.fail-main', operation: 'transition-quest', payload: { questKey: 'quest.main.1', status: 'failed', stageKey: 'quest-stage.main.1' } })
    actions.actions.push({
      key: 'action.system-fail-main', category: 'quest-action', label: '系统终结主线', description: '不应通过发布。',
      actorScope: 'system', targetScope: 'quest', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
      successEffectKeys: ['effect.fail-main'], failureEffectKeys: [], timeCostMinutes: 0,
      confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    })
    expect(() => parseTextOpenWorldModulesV1(failedMain)).toThrow('不能破坏受保护故事线')
  })

  it('玩家接取主线通过正式Action/Event原子落地，刷新重放与幂等重试保持一致', async () => {
    const session = await createSession(createTextOpenWorldVNextFixture(), 'quest-lifecycle-main')
    const feedback = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.accept-main', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.quest.accept-main', requestedAt: 1_000,
    })
    expect(feedback).toMatchObject({ status: 'succeeded', outcomeCommitted: true, evidenceEventSequences: [3, 4] })
    expect(feedback.changes.map(change => change.operation)).toEqual(['transition-quest', 'transition-quest'])
    expect((await readProductRuntimeState(session.id!, 3)).textOpenWorld?.state.quests.instancesByKey[MAIN_INSTANCE_KEY].status).toBe('revealed')
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.state.quests.instancesByKey[MAIN_INSTANCE_KEY]).toMatchObject({
      status: 'active', currentStageKey: 'quest-stage.main.1', acceptedAtWorldMinute: 480,
    })
    const retry = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.accept-main', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.quest.accept-main', requestedAt: 9_999,
    })
    expect(retry.receiptHash).toBe(feedback.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(4)
  })

  it('目标、任务完成和奖励领取分成可重放的三次结算且不能重复领取', async () => {
    const session = await createSession(createTextOpenWorldVNextFixture(), 'quest-progress-reward')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.accept-main', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.quest-progress.accept', requestedAt: 1_000,
    })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.state.quests.instancesByKey[MAIN_INSTANCE_KEY])
      .toMatchObject({ status: 'active', objectiveStatusByKey: { 'objective.main.1': 'active' }, rewardClaimKey: null })

    const objective = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.complete-main-objective', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.quest-progress.objective', requestedAt: 1_100,
    })
    expect(objective).toMatchObject({ status: 'succeeded', evidenceEventSequences: [5, 6] })
    expect((await readProductRuntimeState(session.id!, 6)).textOpenWorld?.state.quests.instancesByKey[MAIN_INSTANCE_KEY])
      .toMatchObject({ status: 'active', objectiveStatusByKey: { 'objective.main.1': 'completed' }, rewardClaimKey: null })
    expect((await readProductRuntimeState(session.id!, 8)).textOpenWorld?.state.quests.instancesByKey[MAIN_INSTANCE_KEY])
      .toMatchObject({ status: 'completed', rewardClaimKey: null })

    const reward = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.claim-main-reward', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.quest-progress.reward', requestedAt: 1_300,
    })
    expect(reward).toMatchObject({ status: 'succeeded', evidenceEventSequences: [9, 10] })
    expect(reward.changes.map(change => change.operation)).toEqual(['claim-quest-reward', 'grant-experience'])
    const final = (await readProductRuntimeState(session.id!)).textOpenWorld!.state
    expect(final.player).toMatchObject({ level: 2, experience: 100 })
    expect(final.quests.instancesByKey[MAIN_INSTANCE_KEY].rewardClaimKey).toBe(`claim.reward.reward.quest-main.${MAIN_INSTANCE_KEY}`)

    const retry = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.claim-main-reward', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.quest-progress.reward', requestedAt: 9_999,
    })
    expect(retry.receiptHash).toBe(reward.receiptHash)
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(10)
    const rejected = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.claim-main-reward', targetKey: MAIN_INSTANCE_KEY,
      commandId: 'command.quest-progress.reward-again', requestedAt: 10_000,
    })
    expect(rejected).toMatchObject({ phase: 'preflight', status: 'rejected', outcomeCommitted: false })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(10)
  }, 15_000)

  it('普通任务放弃先返回确认回执，明确确认后才产生正式终态事件', async () => {
    const session = await createSession(addOrdinaryQuestActions(), 'quest-lifecycle-abandon')
    await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.accept-ordinary', targetKey: ORDINARY_INSTANCE_KEY,
      commandId: 'command.quest.accept-ordinary', requestedAt: 1_000,
    })
    const preflight = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.abandon-ordinary', targetKey: ORDINARY_INSTANCE_KEY,
      commandId: 'command.quest.abandon-ordinary', requestedAt: 1_100,
    })
    expect(preflight).toMatchObject({ status: 'confirmation-required', phase: 'preflight', outcomeCommitted: false, evidenceEventSequences: [] })
    expect(await db.productRuntimeEvents.where('sessionId').equals(session.id!).count()).toBe(4)
    const confirmationBaseline = await readProductRuntimeState(session.id!)
    const abandoned = await executeTextOpenWorldActionV1({
      sessionId: session.id!, actionKey: 'action.abandon-ordinary', targetKey: ORDINARY_INSTANCE_KEY,
      commandId: 'command.quest.abandon-ordinary', requestedAt: 1_100, confirmed: true,
      expectedBaseSequence: confirmationBaseline.lastSequence,
    })
    expect(abandoned).toMatchObject({ status: 'succeeded', outcomeCommitted: true, evidenceEventSequences: [5, 6] })
    expect((await readProductRuntimeState(session.id!)).textOpenWorld?.state.quests.instancesByKey[ORDINARY_INSTANCE_KEY].status).toBe('abandoned')
  })
})
