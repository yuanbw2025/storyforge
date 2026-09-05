import { describe, expect, it } from 'vitest'
import { validateTextOpenWorldEffectStateV1 } from '../../src/lib/open-world/effect-dsl'
import { createTextOpenWorldConditionCatalogV1 } from '../../src/lib/open-world/condition-dsl'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import {
  createInitialTextOpenWorldQuestInstancesV1,
  createTextOpenWorldDirectorQuestInstanceV1,
  createTextOpenWorldQuestInstanceKeyV1,
  deriveTextOpenWorldQuestConditionProjectionV1,
  projectTextOpenWorldQuestInstancesV1,
} from '../../src/lib/open-world/quests'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  parseTextOpenWorldSessionProjectionV1,
} from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World vNext · QuestDefinition and QuestInstance boundary', () => {
  it('只为正式定义建立开局实例，模板保留为不可变Release资产', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const instances = createInitialTextOpenWorldQuestInstancesV1(runtimePackage)
    const instanceKey = 'quest-instance.12.quest.main.1.release.13.session-start'

    expect(modules.quests.quests).toMatchObject([
      { key: 'quest.main.1', type: 'mainline', ownerKind: 'actor', instantiationPolicy: 'session-start', initialStatus: 'available' },
      { key: 'quest.template.supplies', type: 'template', ownerKind: 'region', instantiationPolicy: 'director', initialStatus: 'locked' },
    ])
    expect(instances).toEqual({
      [instanceKey]: expect.objectContaining({
        instanceKey, definitionKey: 'quest.main.1', sourceKind: 'release', sourceInstanceKey: 'session-start',
        status: 'available', offeredAtWorldMinute: 480, objectiveStatusByKey: { 'objective.main.1': 'inactive' },
      }),
    })
  })

  it('同一模板可生成多个稳定实例而不会改写模板定义', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const definitionSnapshot = structuredClone(modules.quests.quests.find(item => item.key === 'quest.template.supplies'))
    const first = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'draw.1', worldMinute: 600,
    })
    const second = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'draw.2', worldMinute: 600,
    })
    projection.state.time.worldMinute = 600
    projection.state.quests.instancesByKey[first.instanceKey] = first
    projection.state.quests.instancesByKey[second.instanceKey] = second

    expect(first.instanceKey).not.toBe(second.instanceKey)
    expect(first.deadlineWorldMinute).toBe(2040)
    expect(createTextOpenWorldQuestInstanceKeyV1({
      definitionKey: 'quest.template.supplies', sourceKind: 'director', sourceInstanceKey: 'draw.1',
    })).toBe(first.instanceKey)
    expect(projectTextOpenWorldQuestInstancesV1(modules, projection.state.quests).map(item => item.instance.instanceKey))
      .toEqual(expect.arrayContaining([first.instanceKey, second.instanceKey]))
    expect(deriveTextOpenWorldQuestConditionProjectionV1(modules, projection.state.quests).statusByQuestKey['quest.template.supplies']).toBe('available')
    expect(modules.quests.quests.find(item => item.key === 'quest.template.supplies')).toEqual(definitionSnapshot)
    expect(() => validateTextOpenWorldEffectStateV1(projection.state, modules)).not.toThrow()
  })

  it('拒绝伪造实例ID、悬空目标闭集和来源Hash漂移', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const instanceKey = Object.keys(projection.state.quests.instancesByKey)[0]

    const badId = structuredClone(projection.state)
    badId.quests.instancesByKey[instanceKey].instanceKey = 'quest-instance.forged'
    expect(() => validateTextOpenWorldEffectStateV1(badId, modules)).toThrow('记录键与instanceKey不一致')

    const badObjectives = structuredClone(projection.state)
    delete badObjectives.quests.instancesByKey[instanceKey].objectiveStatusByKey['objective.main.1']
    expect(() => validateTextOpenWorldEffectStateV1(badObjectives, modules)).toThrow('Objective闭集不一致')

    const badHash = structuredClone(projection)
    badHash.state.quests.instancesByKey[instanceKey].sourceContentHash = 'b'.repeat(64)
    expect(() => parseTextOpenWorldSessionProjectionV1(badHash)).toThrow('来源Hash与冻结Quest模块不一致')
  })

  it('发布时拒绝错误Owner、模板开局实例化和非首个主线开放', () => {
    const badOwner = createTextOpenWorldVNextFixture()
    Object.assign((badOwner.modules.quests.payload as any).quests[0], { ownerKind: 'region', ownerKey: 'actor.caretaker' })
    expect(() => parseTextOpenWorldModulesV1(badOwner)).toThrow('quest region owner 引用不存在')

    const materializedTemplate = createTextOpenWorldVNextFixture()
    Object.assign((materializedTemplate.modules.quests.payload as any).quests[1], { instantiationPolicy: 'session-start', repeatable: false })
    expect(() => parseTextOpenWorldModulesV1(materializedTemplate)).toThrow('模板任务必须由Director重复实例化')

    const hiddenFirstMain = createTextOpenWorldVNextFixture()
    ;(hiddenFirstMain.modules.quests.payload as any).quests[0].initialStatus = 'locked'
    expect(() => parseTextOpenWorldModulesV1(hiddenFirstMain)).toThrow('严格顺序主线必须只开放第一个任务定义')

    const templateCondition = createTextOpenWorldVNextFixture()
    ;(templateCondition.modules.actions.payload as any).conditions.push({
      key: 'condition.template-global',
      expression: { op: 'quest-status', questKey: 'quest.template.supplies', statuses: ['active'] },
      failureMessage: '模板尚未激活。',
    })
    expect(() => createTextOpenWorldConditionCatalogV1(templateCondition)).toThrow('不能以模板定义代替运行时任务实例')
  })

  it('Director投影必须与生成任务实例账本一致', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const generated = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'draw.1', worldMinute: 480,
    })
    projection.state.quests.instancesByKey[generated.instanceKey] = generated
    expect(() => parseTextOpenWorldSessionProjectionV1(projection)).toThrow('director实例数量与任务实例账本不一致')
    projection.director.generatedQuestInstanceCount = 1
    projection.director.revealedQuestInstanceKeys = [generated.instanceKey]
    expect(() => parseTextOpenWorldSessionProjectionV1(projection)).not.toThrow()
  })
})
