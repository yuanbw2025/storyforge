import { startInteractionScene } from '../character-interaction/runtime-api'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../product/runtime-api'

/**
 * Product-owned launch hook for a newly-created AI town session. Build previews
 * and formal Release sessions must enter the same first frozen interaction
 * scene; otherwise the map is visible but resident conversation cannot start.
 */
export async function startAiTownInitialSceneV1(input: {
  sessionId: number
  commandId: string
}): Promise<void> {
  const state = await readProductRuntimeState(input.sessionId)
  if (!state.town || !state.interaction) throw new Error('[ai-town] 新存档缺少冻结小镇互动状态')
  if (state.interaction.activeScene) return
  const firstScene = state.interaction.sceneTemplates[0]
  if (!firstScene) throw new Error('[ai-town] 新存档缺少首个冻结互动场景')
  const base = await readProductRuntimeStateVersion(input.sessionId)
  await startInteractionScene({
    sessionId: input.sessionId,
    commandId: input.commandId,
    baseSequence: base.sequence,
    baseStateHash: base.stateHash,
    sceneId: `town-scene:${firstScene.sceneKey}:${crypto.randomUUID()}`,
    sceneKey: firstScene.sceneKey,
  })
}
