import { PRODUCT_RUNTIME_STATUSES } from '../types'
import type {
  ProductRuntimeSession,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'

function fail(message: string): never {
  throw new Error(`[text-open-world-player-ending] ${message}`)
}

export type TextOpenWorldPlayerEndingPhaseV1 =
  | 'in-progress'
  | 'settling'
  | 'completed'

export interface TextOpenWorldPlayerEndingStatisticsV1 {
  level: number
  completedQuestCount: number
  earnedAchievementCount: number
  worldDay: number
  timePeriodLabel: string
  worldTimeLabel: string
}

interface TextOpenWorldPlayerEndingProjectionBaseV1 {
  version: 1
  statistics: TextOpenWorldPlayerEndingStatisticsV1
}

export type TextOpenWorldPlayerEndingProjectionV1 =
  | (TextOpenWorldPlayerEndingProjectionBaseV1 & {
      phase: 'in-progress'
      ending: null
      timelineSaved: false
    })
  | (TextOpenWorldPlayerEndingProjectionBaseV1 & {
      phase: 'settling' | 'completed'
      ending: { title: string; summary: string }
      timelineSaved: true
    })

export interface TextOpenWorldPlayerEndingProjectionInputV1 {
  projection: TextOpenWorldSessionProjectionV1 | unknown
  /** The only ProductRuntimeSession fact this read model consumes. */
  sessionStatus: ProductRuntimeSession['status']
}

function endingPhase(
  status: ProductRuntimeSession['status'],
  reached: boolean,
): TextOpenWorldPlayerEndingPhaseV1 {
  if (!PRODUCT_RUNTIME_STATUSES.includes(status)) fail('Session状态无效')
  if (status === 'completed') {
    if (!reached) fail('已完成Session缺少权威结局记录')
    return 'completed'
  }
  if (!reached) return 'in-progress'
  if (status !== 'active') fail('非活动Session存在尚未收束的结局记录')
  return 'settling'
}

/**
 * Disclosure-safe, read-only ending model for the player surface.
 *
 * Completion is never inferred from quests, eligibility flags or Release
 * metadata. The Session status establishes lifecycle, while reachedKey is the
 * sole ending fact. Stable keys and hashes are resolved here and deliberately
 * omitted from the returned UI model.
 */
export function projectTextOpenWorldPlayerEndingV1(
  input: TextOpenWorldPlayerEndingProjectionInputV1,
): TextOpenWorldPlayerEndingProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(input.projection)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const reachedKey = projection.state.endings.reachedKey
  const phase = endingPhase(input.sessionStatus, reachedKey != null)
  const minuteInDay = projection.state.time.worldMinute % modules['time-weather'].minutesPerDay
  const timePeriod = modules['time-weather'].timePeriods.find(candidate => (
    minuteInDay >= candidate.startMinute && minuteInDay < candidate.endMinute
  )) ?? fail('世界时间无法映射冻结时段')
  const worldDay = Math.floor(
    projection.state.time.worldMinute / modules['time-weather'].minutesPerDay,
  ) + 1
  const statistics: TextOpenWorldPlayerEndingStatisticsV1 = {
    level: projection.state.player.level,
    completedQuestCount: Object.values(projection.state.quests.instancesByKey)
      .filter(instance => instance.status === 'completed').length,
    earnedAchievementCount: projection.state.knowledge.earnedAchievementKeys.length,
    worldDay,
    timePeriodLabel: timePeriod.label,
    worldTimeLabel: `第 ${worldDay} 天 · ${timePeriod.label}`,
  }

  if (phase === 'in-progress') {
    return { version: 1, phase, ending: null, timelineSaved: false, statistics }
  }

  const ending = modules.narrative.endings.find(candidate => candidate.key === reachedKey)
    ?? fail('权威结局记录不在冻结叙事模块中')
  return {
    version: 1,
    phase,
    ending: { title: ending.title, summary: ending.summary },
    timelineSaved: true,
    statistics,
  }
}
