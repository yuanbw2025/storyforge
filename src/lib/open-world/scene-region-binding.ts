import type {
  TextOpenWorldMapInteractionCatalogV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldSceneScriptsV1,
} from '../types'

type Scene = TextOpenWorldSceneScriptsV1['scenes'][number]

/** Geography is owned by the frozen map. Early P9 objective demands copied
 * the first quest region even when an Action selected its second region.
 * Only that exact compiler defect is repairable; unrelated mismatches fail. */
export function resolveTextOpenWorldSceneRegionV1(input: {
  scene: Pick<Scene, 'key' | 'sourceKind' | 'questKey' | 'regionKey' | 'locationKey'>
  locations: Pick<TextOpenWorldMapInteractionCatalogV1['locations'][number], 'key' | 'regionKey'>[]
  quests: Pick<TextOpenWorldQuestSkeletonsV1['quests'][number], 'key' | 'regionKeys' | 'locationKeys'>[]
}): string {
  const { scene } = input
  const location = input.locations.find(item => item.key === scene.locationKey)
  if (!location) throw new Error(`[text-open-world-scene-region] 场景地点不存在:${scene.key}`)
  if (scene.regionKey === location.regionKey) return location.regionKey
  const quest = input.quests.find(item => item.key === scene.questKey)
  if (scene.sourceKind !== 'quest-objective' || !quest
    || scene.regionKey !== quest.regionKeys[0]
    || !quest.regionKeys.includes(location.regionKey)
    || !quest.locationKeys.includes(location.key)) {
    throw new Error(`[text-open-world-scene-region] 场景地区不是可校正的跨地区任务投影:${scene.key}`)
  }
  return location.regionKey
}
