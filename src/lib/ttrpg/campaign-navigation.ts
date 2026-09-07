import type { ProductRuntimeState, TtrpgCampaignContentV1 } from '../types'

/** Only offer a terminal scene when an ending can be completed there. */
export function ttrpgCampaignNavigationV1(state: ProductRuntimeState, campaign: TtrpgCampaignContentV1) {
  const product = state.ttrpg?.product
  const scene = campaign.scenes.find(scene => scene.sceneKey === state.ttrpg?.scene?.sceneKey)
  if (!product?.sessionZero.completed || !scene || product.ending || product.safety.status !== 'active') return { nextScenes: [], endings: [] }
  const known = new Set(product.discoveredClues.flatMap(item => campaign.clues.find(clue => clue.clueKey === item.clueKey)?.conclusionKey ?? []))
  const eligible = campaign.endings.filter(ending => ending.trigger.requiredConclusionKeys.every(key => known.has(key))
    && ending.trigger.forbiddenConclusionKeys.every(key => !known.has(key)))
  return {
    nextScenes: campaign.scenes.filter(next => scene.nextSceneKeys.includes(next.sceneKey)
      && (next.nextSceneKeys.length > 0 || eligible.some(ending => ending.trigger.sceneKey === next.sceneKey)))
      .map(next => ({ sceneKey: next.sceneKey, title: next.title })),
    endings: scene.nextSceneKeys.length ? [] : eligible.filter(ending => ending.trigger.sceneKey === scene.sceneKey)
      .map(ending => ({ endingKey: ending.endingKey, title: ending.title })),
  }
}
