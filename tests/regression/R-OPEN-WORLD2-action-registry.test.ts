import { describe, expect, it } from 'vitest'
import { createTextOpenWorldActionRegistryV1 } from '../../src/lib/open-world/action-registry'
import type { TextOpenWorldActionProjectionContextV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function context(overrides: Partial<TextOpenWorldActionProjectionContextV1> = {}): TextOpenWorldActionProjectionContextV1 {
  return {
    actorKey: 'player', currentLocationKey: 'location.salt-port', worldMinute: 480, playerHealth: 37, combatStatus: null,
    conditionResults: {}, completedOnceActionKeys: [], cooldownUntilWorldMinuteByActionKey: {},
    validTargetKeysByScope: { location: ['location.salt-port'] },
    questDefinitionKeyByInstanceKey: {}, questStatusByInstanceKey: {}, questStageKeyByInstanceKey: {},
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
