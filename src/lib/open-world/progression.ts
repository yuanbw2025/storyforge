import type { TextOpenWorldParsedModulesV1, TextOpenWorldProgressionStatusV1 } from '../types'

function fail(message: string): never { throw new Error(`[text-open-world-progression] ${message}`) }

export function levelForTextOpenWorldExperienceV1(modules: TextOpenWorldParsedModulesV1, experience: number): number {
  if (!Number.isSafeInteger(experience) || experience < 0) fail('experience必须是非负安全整数')
  const lastLevel = modules.progression.levels[modules.progression.levels.length - 1] ?? fail('等级曲线为空')
  const maximumThreshold = lastLevel.cumulativeExperience
  if (experience > maximumThreshold) fail('experience超过最高等级阈值')
  let result = 1
  for (const level of modules.progression.levels) {
    if (level.cumulativeExperience > experience) break
    result = level.level
  }
  return result
}

/** Read-only level progress projection shared by UI, context and reward rules. */
export function deriveTextOpenWorldProgressionStatusV1(
  modules: TextOpenWorldParsedModulesV1,
  experience: number,
): TextOpenWorldProgressionStatusV1 {
  const level = levelForTextOpenWorldExperienceV1(modules, experience)
  const maximumLevel = modules.progression.rules.maximumLevel
  const currentLevelThreshold = modules.progression.levels[level - 1].cumulativeExperience
  const nextLevelThreshold = level >= maximumLevel ? null : modules.progression.levels[level].cumulativeExperience
  const experienceIntoLevel = experience - currentLevelThreshold
  const experienceForNextLevel = nextLevelThreshold == null ? null : nextLevelThreshold - currentLevelThreshold
  return {
    level, maximumLevel, experience, currentLevelThreshold, nextLevelThreshold, experienceIntoLevel, experienceForNextLevel,
    progressRatio: experienceForNextLevel == null ? 1 : experienceIntoLevel / experienceForNextLevel,
    atMaximumLevel: level === maximumLevel,
  }
}
