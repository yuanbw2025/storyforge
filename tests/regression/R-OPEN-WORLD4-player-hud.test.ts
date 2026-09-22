import { describe, expect, it } from 'vitest'
import { projectTextOpenWorldPlayerHudV1 } from '../../src/lib/open-world/player-hud'
import { createTextOpenWorldDirectorQuestInstanceV1 } from '../../src/lib/open-world/quests'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'

describe('Text Open World vNext · authoritative player HUD projection', () => {
  it('只从正式Projection与冻结包派生玩家、地点、时间天气和当前任务细节', () => {
    const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextP9Fixture())
    const main = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
    main.status = 'active'
    main.acceptedAtWorldMinute = 480
    main.currentStageKey = 'quest-stage.main.1'
    main.objectiveStatusByKey['objective.main.1'] = 'active'

    expect(projectTextOpenWorldPlayerHudV1(projection)).toMatchObject({
      player: { level: 1, health: 37, maximumHealth: 37, skillResource: 4, maximumSkillResource: 4 },
      location: { title: '盐港广场', regionTitle: '盐港' },
      clockWeather: { worldMinute: 480, day: 1, timePeriodLabel: '白天', weatherLabel: '晴朗' },
      primaryQuest: {
        instanceKey: MAIN_INSTANCE_KEY,
        title: '断流的盐渠',
        status: 'active',
        currentStage: { title: '检查内渠' },
        nextRequiredObjective: { title: '检查盐港内渠', status: 'active' },
        deadline: { deadlineWorldMinute: null, remainingMinutes: null, expired: false, label: null },
      },
      pinnedQuests: [],
    })
  })

  it('pin绝不回退为主追踪，并过滤主追踪和pin中的终态残留', () => {
    const runtimePackage = createTextOpenWorldVNextP9Fixture()
    const projection = createInitialTextOpenWorldSessionProjectionV1(runtimePackage)
    const ordinary = createTextOpenWorldDirectorQuestInstanceV1(runtimePackage, {
      definitionKey: 'quest.template.supplies', sourceInstanceKey: 'hud.1', worldMinute: 480,
    })
    ordinary.status = 'active'
    ordinary.acceptedAtWorldMinute = 480
    ordinary.currentStageKey = 'quest-stage.template.supplies'
    ordinary.objectiveStatusByKey['objective.template.supplies'] = 'active'
    projection.state.quests.instancesByKey[ordinary.instanceKey] = ordinary
    projection.state.quests.tracking.primaryInstanceKey = null
    projection.state.quests.tracking.pinnedInstanceKeys = [ordinary.instanceKey]
    projection.state.director.generatedQuestInstanceCount = 1
    projection.state.director.revealedQuestInstanceKeys = [ordinary.instanceKey]
    projection.state.director.activeQuestInstanceKeys = [ordinary.instanceKey]
    projection.director = structuredClone(projection.state.director)

    const pinnedOnly = projectTextOpenWorldPlayerHudV1(projection)
    expect(pinnedOnly.primaryQuest).toBeNull()
    expect(pinnedOnly.pinnedQuests).toMatchObject([{
      instanceKey: ordinary.instanceKey,
      title: '短缺物资',
      deadline: { label: '剩余1天' },
    }])

    const main = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
    main.status = 'completed'
    main.acceptedAtWorldMinute = 480
    main.currentStageKey = 'quest-stage.main.1'
    main.objectiveStatusByKey['objective.main.1'] = 'completed'
    main.terminalAtWorldMinute = 480
    ordinary.status = 'abandoned'
    ordinary.objectiveStatusByKey['objective.template.supplies'] = 'failed'
    ordinary.terminalAtWorldMinute = 480
    projection.state.quests.tracking.primaryInstanceKey = MAIN_INSTANCE_KEY
    projection.state.director.revealedQuestInstanceKeys = []
    projection.state.director.activeQuestInstanceKeys = []
    projection.director = structuredClone(projection.state.director)

    const terminalResidue = projectTextOpenWorldPlayerHudV1(projection)
    expect(terminalResidue.primaryQuest).toBeNull()
    expect(terminalResidue.pinnedQuests).toEqual([])
  })
})
