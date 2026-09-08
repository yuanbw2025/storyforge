export const TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1 = 127

export interface TextOpenWorldSceneDemandCapacityInputV1 {
  quests: readonly unknown[]
  objectives: readonly unknown[]
  actors: readonly unknown[]
  interactions: readonly unknown[]
  randomEvents: readonly unknown[]
}

/**
 * P9 deterministically creates two endpoint Scenes for every Quest plus one
 * Scene for every Objective, runtime Actor, location Interaction and Director
 * event. Keep this formula upstream of prose generation so P8F cannot accept a
 * package that the governed per-Scene disclosure protocol is unable to run.
 */
export function countTextOpenWorldSceneDemandsV1(
  input: TextOpenWorldSceneDemandCapacityInputV1,
): number {
  return input.quests.length * 2
    + input.objectives.length
    + input.actors.length
    + input.interactions.length
    + input.randomEvents.length
}

export function assertTextOpenWorldSceneDemandCapacityV1(
  input: TextOpenWorldSceneDemandCapacityInputV1,
): number {
  const count = countTextOpenWorldSceneDemandsV1(input)
  if (count > TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1) {
    throw new Error(
      `[text-open-world-scene-capacity] governed-v3场景数超过硬上限:${count}/${TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1}`,
    )
  }
  return count
}
