import type { TextOpenWorldEffectStateV1, TextOpenWorldParsedModulesV1 } from '../types'

/**
 * Player-visible projection of deterministic Director state. This lives in
 * the product boundary so the shared CONTEXT_SOURCES registry only composes
 * an already-governed view and never learns Director internals.
 */
export function projectTextOpenWorldDirectorContextV1(input: {
  modules: TextOpenWorldParsedModulesV1
  state: TextOpenWorldEffectStateV1
  regionKey: string
  regionTitle: string
}) {
  const { modules, state, regionKey, regionTitle } = input
  const recentContent = state.director.history.slice(-8).flatMap(entry => {
    if (entry.outcomeKind === 'blank') return []
    const quest = entry.questInstanceKey
      ? modules.quests.quests.find(item => item.key === state.quests.instancesByKey[entry.questInstanceKey!]?.definitionKey)
      : null
    const randomEvent = entry.outcomeKind === 'random-event'
      ? modules.director.randomEvents.find(item => item.key === entry.sourceKey)
      : null
    const variant = entry.variantTextKey
      ? modules.presentation.taskTextVariants.find(item => item.key === entry.variantTextKey)
      : null
    const title = variant?.title ?? quest?.title ?? randomEvent?.title ?? entry.sourceKey ?? '区域事件'
    const description = variant?.description ?? quest?.description ?? ''
    return [`- 第${Math.floor(entry.worldMinute / 1_440) + 1}天｜${entry.regionKey}｜${entry.trigger}｜${entry.outcomeKind}｜${title}${description ? `：${description}` : ''}${entry.questInstanceKey ? `｜任务实例=${entry.questInstanceKey}` : ''}`]
  })
  const achievements = state.knowledge.earnedAchievementKeys.flatMap(key => {
    const achievement = modules.knowledge.achievements.find(item => item.key === key)
    return achievement ? [`- ${achievement.key}:${achievement.title}｜${achievement.description}`] : []
  })
  return {
    regionStatus: `【地区状态】${regionTitle}｜状态=${state.world.regionStateByKey[regionKey] ?? '未定义'}｜压力=${state.world.regionPressureByKey[regionKey] ?? 0}`,
    recentContent,
    achievements,
  }
}
