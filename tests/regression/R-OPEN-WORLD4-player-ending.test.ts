import { describe, expect, it } from 'vitest'
import { projectTextOpenWorldPlayerEndingV1 } from '../../src/lib/open-world/player-ending'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import type { TextOpenWorldSessionProjectionV1 } from '../../src/lib/types'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

const MAIN_INSTANCE_KEY = 'quest-instance.12.quest.main.1.release.13.session-start'

function projectionWithProgress(): TextOpenWorldSessionProjectionV1 {
  const projection = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextP9Fixture())
  const main = projection.state.quests.instancesByKey[MAIN_INSTANCE_KEY]
  main.status = 'completed'
  main.offeredAtWorldMinute = 480
  main.acceptedAtWorldMinute = 480
  main.currentStageKey = 'quest-stage.main.1'
  main.objectiveStatusByKey['objective.main.1'] = 'completed'
  main.terminalAtWorldMinute = 480
  projection.state.quests.tracking.primaryInstanceKey = null
  projection.state.knowledge.earnedAchievementKeys = ['achievement.first-clue']
  projection.state.time.worldMinute = 1_200
  projection.state.time.lastActorScheduleSettlementWorldMinute = 1_080
  return projection
}

function reachCooperationEnding(projection: TextOpenWorldSessionProjectionV1): void {
  projection.state.endings.unlockedKeys = ['ending.cooperate']
  projection.state.endings.reachedKey = 'ending.cooperate'
}

describe('Text Open World player ending projection', () => {
  it('只以reachedKey确认结局，已解锁或eligible均不能冒充已抵达', () => {
    const projection = projectionWithProgress()
    projection.state.endings.unlockedKeys = ['ending.cooperate']
    projection.state.world.endingEligibleByKey['ending.control'] = true

    expect(projectTextOpenWorldPlayerEndingV1({
      projection,
      sessionStatus: 'active',
    })).toEqual({
      version: 1,
      phase: 'in-progress',
      ending: null,
      timelineSaved: false,
      statistics: {
        level: 1,
        completedQuestCount: 1,
        earnedAchievementCount: 1,
        worldDay: 1,
        timePeriodLabel: '夜晚',
        worldTimeLabel: '第 1 天 · 夜晚',
      },
    })
  })

  it('把active且已有权威结局的已落盘窗口区分为settling', () => {
    const projection = projectionWithProgress()
    reachCooperationEnding(projection)

    expect(projectTextOpenWorldPlayerEndingV1({
      projection,
      sessionStatus: 'active',
    })).toMatchObject({
      phase: 'settling',
      timelineSaved: true,
      ending: { title: '共管盐渠', summary: '两地共同维护盐渠。' },
    })
  })

  it('只展示冻结结局文案与安全统计，不向UI模型泄露稳定键或Hash', () => {
    const projection = projectionWithProgress()
    reachCooperationEnding(projection)
    const result = projectTextOpenWorldPlayerEndingV1({
      projection,
      sessionStatus: 'completed',
    })

    expect(result).toMatchObject({
      version: 1,
      phase: 'completed',
      ending: { title: '共管盐渠', summary: '两地共同维护盐渠。' },
      timelineSaved: true,
      statistics: {
        level: 1,
        completedQuestCount: 1,
        earnedAchievementCount: 1,
        worldDay: 1,
        timePeriodLabel: '夜晚',
      },
    })
    const publicBytes = JSON.stringify(result)
    expect(publicBytes).not.toContain('ending.cooperate')
    expect(publicBytes).not.toContain(projection.runtimePackage.metadata.packageKey)
    expect(publicBytes).not.toContain(projection.runtimePackage.modules.narrative.contentHash)
  })

  it('completed缺少reachedKey以及非active的半收束组合都失败关闭', () => {
    const missingEnding = projectionWithProgress()
    expect(() => projectTextOpenWorldPlayerEndingV1({
      projection: missingEnding,
      sessionStatus: 'completed',
    })).toThrow('已完成Session缺少权威结局记录')

    const ambiguous = projectionWithProgress()
    reachCooperationEnding(ambiguous)
    expect(() => projectTextOpenWorldPlayerEndingV1({
      projection: ambiguous,
      sessionStatus: 'paused',
    })).toThrow('非活动Session存在尚未收束的结局记录')
    expect(() => projectTextOpenWorldPlayerEndingV1({
      projection: ambiguous,
      sessionStatus: 'archived',
    })).toThrow('非活动Session存在尚未收束的结局记录')
  })
})
