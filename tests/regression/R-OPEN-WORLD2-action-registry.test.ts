import { describe, expect, it } from 'vitest'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  deriveTextOpenWorldContextsV1,
} from '../../src/lib/open-world/session-projection'
import type { TextOpenWorldActionProjectionContextV1 } from '../../src/lib/types'
import {
  createTextOpenWorldVNextFixture,
  createTextOpenWorldVNextP9Fixture,
} from '../helpers/text-open-world-vnext-fixture'

function context(overrides: Partial<TextOpenWorldActionProjectionContextV1> = {}): TextOpenWorldActionProjectionContextV1 {
  return {
    actorKey: 'player', currentLocationKey: 'location.salt-port', worldMinute: 480, playerHealth: 37, combatStatus: null,
    conditionResults: {}, completedOnceActionKeys: [], cooldownUntilWorldMinuteByActionKey: {},
    openEdgeKeys: ['edge.port-ridge'],
    unlockedFastTravelPointKeys: ['fast-travel.salt-port'],
    validTargetKeysByScope: { location: ['location.salt-port'] },
    questDefinitionKeyByInstanceKey: {}, questStatusByInstanceKey: {}, questStageKeyByInstanceKey: {},
    questObjectiveStatusByInstanceKey: {}, questRewardClaimKeyByInstanceKey: {}, questDeadlineWorldMinuteByInstanceKey: {},
    primaryTrackedQuestInstanceKey: null, pinnedQuestInstanceKeys: [],
    ...overrides,
  }
}

describe('Text Open World vNext · unified Action registry and availability projection', () => {
  it('同一Action目录向固定选项、任务、随机事件和教程提供稳定引用', () => {
    const registry = createTextOpenWorldActionRegistryV1(createTextOpenWorldVNextFixture())
    const entry = registry.get('action.investigate-channel')

    expect(entry).toMatchObject({
      action: { key: 'action.investigate-channel', category: 'investigate' },
      consumers: {
        fixedChoiceKeys: ['choice.investigate-channel'],
        questObjectiveKeys: ['objective.main.1', 'objective.template.supplies'],
        randomEventKeys: ['event.channel-rumor'],
        tutorialKeys: ['tutorial.investigate'],
      },
    })
    entry!.action.label = '外部篡改'
    expect(registry.get('action.investigate-channel')?.action.label).toBe('检查盐渠')
  })

  it('投影可用行动、合法目标和确认策略，解析时只接受投影中的目标', () => {
    const fixture = createTextOpenWorldVNextFixture()
    const action = (fixture.modules.actions.payload as any).actions[0]
    action.confirmationPolicy = 'high-risk'
    const registry = createTextOpenWorldActionRegistryV1(fixture)
    const projection = registry.project(context())[0]

    expect(projection).toMatchObject({
      available: true, targetScope: 'location', validTargetKeys: ['location.salt-port'],
      confirmationRequired: true, cooldownRemainingMinutes: 0,
    })
    expect(registry.resolve({ actionKey: action.key, targetKey: 'location.salt-port', context: context() }))
      .toMatchObject({ targetKey: 'location.salt-port', confirmationRequired: true })
    expect(() => registry.resolve({ actionKey: action.key, targetKey: 'location.ridge-channel', context: context() }))
      .toThrow('targetKey不在Action可用目标中')
  })

  it('系统按钮、固定选项和自然语言映射命令都收口到同一Action解析', () => {
    const registry = createTextOpenWorldActionRegistryV1(createTextOpenWorldVNextFixture())
    const command = {
      schema: 'storyforge.text-open-world.command', version: 1, commandId: 'command.shared-action', sessionId: 1,
      actorKey: 'player', actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
      baseSequence: 0, baseStateHash: 'a'.repeat(64), source: 'system-action', requestedAt: 1,
    } as const
    for (const source of ['system-action', 'fixed-choice', 'mapped-intent'] as const) {
      expect(registry.resolveCommand({ command: { ...command, source }, context: context() }).entry.action.key)
        .toBe('action.investigate-channel')
    }
    expect(() => registry.resolveCommand({ command: { ...command, actorKey: 'system' }, context: context() }))
      .toThrow('操作者与Action投影上下文不一致')
  })

  it('条件未知时fail-closed，条件失败只暴露公共原因', () => {
    const fixture = createTextOpenWorldVNextFixture()
    ;(fixture.modules.actions.payload as any).actions[0].requirementConditionKeys = ['condition.always']
    const registry = createTextOpenWorldActionRegistryV1(fixture)

    expect(registry.project(context())[0].unavailableReasons).toEqual([{ code: 'condition-unknown', message: '行动条件尚未完成校验。', conditionKey: 'condition.always' }])
    const failed = registry.project(context({ conditionResults: {
      'condition.always': { satisfied: false, publicReason: '需要先查看渠图。' },
    } }))[0]
    expect(failed).toMatchObject({ available: false, unavailableReasons: [{ code: 'condition-failed', message: '需要先查看渠图。' }] })
  })

  it('统一处理操作者、地点、一次性和冷却限制', () => {
    const fixture = createTextOpenWorldVNextFixture()
    const action = (fixture.modules.actions.payload as any).actions[0]
    action.locationKeys = ['location.salt-port']
    action.repeatPolicy = 'once'
    const registry = createTextOpenWorldActionRegistryV1(fixture)
    const blocked = registry.project(context({
      actorKey: 'system', currentLocationKey: 'location.ridge-channel',
      validTargetKeysByScope: { location: ['location.ridge-channel'] },
      completedOnceActionKeys: ['action.investigate-channel'],
    }))[0]
    expect(blocked.unavailableReasons.map(item => item.code)).toEqual(['actor-scope', 'wrong-location', 'once-consumed'])

    action.repeatPolicy = 'cooldown'
    action.cooldownMinutes = 60
    const cooldownRegistry = createTextOpenWorldActionRegistryV1(fixture)
    expect(cooldownRegistry.project(context({
      cooldownUntilWorldMinuteByActionKey: { 'action.investigate-channel': 510 },
    }))[0]).toMatchObject({ available: false, cooldownRemainingMinutes: 30, unavailableReasons: [{ code: 'cooldown' }] })
  })

  it('需要目标却没有合法目标时不可用，并拒绝伪造上下文引用', () => {
    const registry = createTextOpenWorldActionRegistryV1(createTextOpenWorldVNextFixture())
    expect(registry.project(context({ validTargetKeysByScope: {} }))[0])
      .toMatchObject({ available: false, unavailableReasons: [{ code: 'no-valid-target' }] })
    expect(() => registry.project(context({
      conditionResults: { 'condition.missing': { satisfied: true, publicReason: null } },
    }))).toThrow('conditionResults引用未知条件')
  })

  it('使用和丢弃Action只能作用于其Effect声明的物品，不能伪造同背包目标', () => {
    const registry = createTextOpenWorldActionRegistryV1(createTextOpenWorldVNextFixture())
    const itemContext = context({
      conditionResults: { 'condition.health-not-full': { satisfied: true, publicReason: null } },
      validTargetKeysByScope: { item: ['item.rust-sword', 'item.salt-crystal', 'item.brine-tonic'] },
    })
    const projection = registry.project(itemContext)
    expect(projection.find(item => item.action.key === 'action.use-brine-tonic'))
      .toMatchObject({ available: true, validTargetKeys: ['item.brine-tonic'] })
    expect(projection.find(item => item.action.key === 'action.drop-salt-crystal'))
      .toMatchObject({ available: true, validTargetKeys: ['item.salt-crystal'], confirmationRequired: true })
    expect(() => registry.resolve({ actionKey: 'action.use-brine-tonic', targetKey: 'item.rust-sword', context: itemContext }))
      .toThrow('targetKey不在Action可用目标中')
  })

  it('普通旅行Action只接受道路声明的可见相邻目标，并服从道路开放状态', () => {
    const registry = createTextOpenWorldActionRegistryV1(createTextOpenWorldVNextFixture())
    const travelContext = context({ validTargetKeysByScope: { location: ['location.salt-port', 'location.ridge-channel'] } })
    expect(registry.project(travelContext).find(item => item.action.key === 'action.travel-port-ridge'))
      .toMatchObject({ available: true, validTargetKeys: ['location.ridge-channel'] })
    expect(() => registry.resolve({ actionKey: 'action.travel-port-ridge', targetKey: 'location.salt-port', context: travelContext }))
      .toThrow('targetKey不在Action可用目标中')
    expect(registry.project(context({
      validTargetKeysByScope: { location: ['location.salt-port', 'location.ridge-channel'] }, openEdgeKeys: [],
    })).find(item => item.action.key === 'action.travel-port-ridge'))
      .toMatchObject({ available: false, validTargetKeys: [], unavailableReasons: expect.arrayContaining([expect.objectContaining({ code: 'route-closed' })]) })
  })

  it('P9交谈与开战Action按冻结场景或Effect收窄唯一目标', () => {
    const registry = createTextOpenWorldActionRegistryV1(createTextOpenWorldVNextP9Fixture())
    const actorProjection = registry.project(context({
      validTargetKeysByScope: { actor: ['actor.caretaker', 'actor.other-present'] },
    }))
    expect(actorProjection.find(item => item.action.key === 'action.talk-caretaker'))
      .toMatchObject({ available: true, validTargetKeys: ['actor.caretaker'] })

    const encounterProjection = registry.project(context({
      currentLocationKey: 'location.ridge-channel',
      validTargetKeysByScope: { encounter: ['encounter.ridge-jackal', 'encounter.other-present'] },
    }))
    expect(encounterProjection.find(item => item.action.key === 'action.start-ridge-jackal'))
      .toMatchObject({ available: true, validTargetKeys: ['encounter.ridge-jackal'] })
  })

  it('P9场景失效时只关闭场景专属任务Action，不锁死被Objective引用的通用Action', () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const narrative = runtimePackage.modules.narrative.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    const objectiveScene = narrative.scenes
      .find((scene: any) => scene.sourceKind === 'quest-objective')
    const useChoice = {
      key: 'choice.use-tonic-as-support', sceneKey: objectiveScene.key,
      label: '使用盐露药剂', description: '先处理伤势，再继续任务。',
      actionKey: 'action.use-brine-tonic',
    }
    objectiveScene.actionKeys.push(useChoice.actionKey)
    objectiveScene.fixedChoiceKeys.push(useChoice.key)
    narrative.fixedChoices.push(useChoice)
    actions.inputBindings.actions
      .find((binding: any) => binding.actionKey === useChoice.actionKey)
      .fixedChoiceKeys.push(useChoice.key)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    projection.state.player.health -= 1
    projection.state.inventory.stackQuantities['item.brine-tonic'] = 1
    Object.assign(projection.state.actors['actor.caretaker'], { alive: false, present: false })
    const actionContext = deriveTextOpenWorldContextsV1(projection).action
    const availability = createTextOpenWorldActionRegistryV1(runtimePackage).project(actionContext)
    const accept = availability.find(action => action.action.key === 'action.accept-main')
    const useTonic = availability.find(action => action.action.key === 'action.use-brine-tonic')

    expect(accept).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining([
        expect.objectContaining({ code: 'scene-unavailable' }),
      ]),
    })
    expect(useTonic).toMatchObject({
      available: true,
      unavailableReasons: [],
      validTargetKeys: ['item.brine-tonic'],
    })
    expect(() => createTextOpenWorldActionRegistryV1(runtimePackage).resolve({
      actionKey: 'action.accept-main',
      targetKey: actionContext.validTargetKeysByScope.quest?.[0] ?? null,
      context: actionContext,
    })).toThrow('Action不可用:scene-unavailable')
  })

  it('P9未落目录的Quest目标Action只作用于当前合法Objective所属实例', () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const narrative = runtimePackage.modules.narrative.payload as any
    const actions = runtimePackage.modules.actions.payload as any
    const fallbackAction = {
      key: 'action.requirement.inspect-ledger', category: 'observe', label: '核对盐运账册',
      description: '执行尚未落入专用目录的任务需求。', actorScope: 'player', targetScope: 'quest',
      locationKeys: [], requirementConditionKeys: [], costEffectKeys: [], successEffectKeys: [],
      failureEffectKeys: [], timeCostMinutes: 0, confirmationPolicy: 'never',
      repeatPolicy: 'repeatable', cooldownMinutes: null,
    }
    actions.actions.push(fallbackAction)
    const fallbackChoice = {
      key: 'choice.requirement.inspect-ledger', sceneKey: 'scene.objective.main.1',
      label: fallbackAction.label, description: fallbackAction.description,
      actionKey: fallbackAction.key,
    }
    const objectiveScene = narrative.scenes
      .find((scene: any) => scene.key === fallbackChoice.sceneKey)
    objectiveScene.actionKeys.push(fallbackAction.key)
    objectiveScene.fixedChoiceKeys.push(fallbackChoice.key)
    narrative.fixedChoices.push(fallbackChoice)
    actions.inputBindings.actions.push({
      key: 'binding.action.requirement.inspect-ledger',
      order: actions.inputBindings.actions.length + 1,
      actionKey: fallbackAction.key,
      actionDefinitionHash: 'f'.repeat(64),
      actorScope: fallbackAction.actorScope,
      category: fallbackAction.category,
      targetScope: fallbackAction.targetScope,
      systemAction: {
        enabled: true,
        label: fallbackAction.label,
        description: fallbackAction.description,
        executionSource: 'system-action',
      },
      fixedChoiceKeys: [fallbackChoice.key],
      naturalLanguage: {
        mode: 'existing-action-candidate',
        exampleUtterances: ['核对盐运账册', '查看这份盐运记录'],
        candidateMayOnlySelectThisAction: true,
        targetResolution: 'current-projection-valid-targets-only',
        highConfidenceLowRisk: 'execute-after-runtime-validation',
        highRiskOrIrreversible: 'require-explicit-confirmation',
        lowConfidence: 'respond-and-recommend-formal-actions',
        mayCreateAction: false,
        mayCreateQuest: false,
        mayCreateMapContent: false,
        mayWriteState: false,
      },
      resultAuthority: {
        artifactKey: 'text-open-world.quest-design-documents',
        collection: 'actions',
        actionKey: fallbackAction.key,
        actionDefinitionHash: 'f'.repeat(64),
      },
    })

    const session = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const main = Object.values(session.state.quests.instancesByKey)
      .find(instance => instance.definitionKey === 'quest.main.1')!
    main.status = 'active'
    main.acceptedAtWorldMinute = session.state.time.worldMinute
    main.currentStageKey = 'quest-stage.main.1'
    main.objectiveStatusByKey['objective.main.1'] = 'active'
    const actionContext = deriveTextOpenWorldContextsV1(session).action
    const sameDefinitionRevealedInstanceKey = 'quest-instance.same-definition-revealed'
    actionContext.validTargetKeysByScope.quest = [main.instanceKey, sameDefinitionRevealedInstanceKey]
    actionContext.questDefinitionKeyByInstanceKey[sameDefinitionRevealedInstanceKey] = 'quest.main.1'
    actionContext.questStatusByInstanceKey[sameDefinitionRevealedInstanceKey] = 'revealed'
    actionContext.questStageKeyByInstanceKey[sameDefinitionRevealedInstanceKey] = null
    actionContext.questObjectiveStatusByInstanceKey[sameDefinitionRevealedInstanceKey] = {
      'objective.main.1': 'inactive',
    }
    actionContext.questRewardClaimKeyByInstanceKey[sameDefinitionRevealedInstanceKey] = null
    actionContext.questDeadlineWorldMinuteByInstanceKey[sameDefinitionRevealedInstanceKey] = null

    expect(createTextOpenWorldActionRegistryV1(runtimePackage).project(actionContext)
      .find(action => action.action.key === fallbackAction.key)).toMatchObject({
      available: true,
      validTargetKeys: [main.instanceKey],
    })
  })

  it('任务Action同时按定义、状态和当前Stage收窄到合法实例', () => {
    const registry = createTextOpenWorldActionRegistryV1(createTextOpenWorldVNextFixture())
    const main = 'quest-instance.12.quest.main.1.release.13.session-start'
    const supplies = 'quest-instance.23.quest.template.supplies.director.6.draw.1'
    const questContext = context({
      validTargetKeysByScope: { quest: [main, supplies] },
      questDefinitionKeyByInstanceKey: { [main]: 'quest.main.1', [supplies]: 'quest.template.supplies' },
      questStatusByInstanceKey: { [main]: 'revealed', [supplies]: 'active' },
      questStageKeyByInstanceKey: { [main]: null, [supplies]: 'quest-stage.template.supplies' },
    })
    const projection = registry.project(questContext)
    expect(projection.find(item => item.action.key === 'action.accept-main'))
      .toMatchObject({ available: true, validTargetKeys: [main] })
    expect(projection.find(item => item.action.key === 'action.accept-supplies'))
      .toMatchObject({ available: false, validTargetKeys: [] })
    expect(projection.find(item => item.action.key === 'action.abandon-supplies'))
      .toMatchObject({ available: true, validTargetKeys: [supplies], confirmationRequired: true })

    const wrongStage = registry.project(context({
      ...questContext,
      questStageKeyByInstanceKey: { [main]: null, [supplies]: 'quest-stage.main.1' },
    }))
    expect(wrongStage.find(item => item.action.key === 'action.abandon-supplies'))
      .toMatchObject({ available: false, validTargetKeys: [] })
  })
})
