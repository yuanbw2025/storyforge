import { createDeterministicGmSynthesisFrameV2 } from '../ttrpg/action-feedback'
import type { TtrpgViewerProjectionV1 } from '../ttrpg/viewer-projection'
import type { TtrpgRuntimeRuleActionResultV1 } from '../types'

export function createOnlineTtrpgNpcDecisionViewV1(projection: TtrpgViewerProjectionV1, actorKey: string) {
  const actor = projection.actors.find(actor => actor.actorKey === actorKey)
  if (!actor || actor.role !== 'npc') throw new Error('[online-ai-view] NPC 不在当前投影')
  return {
    schema: 'storyforge.online-npc-decision-view' as const, version: 1 as const,
    self: { actorKey, name: actor.name, privateProfile: actor.privateProfile, attributes: actor.attributes, resources: actor.resources },
    turn: structuredClone(projection.turn),
    scenes: projection.scenes.filter(scene => scene.status === 'current').map(scene => ({ sceneKey: scene.sceneKey, title: scene.title, description: scene.description })),
    actors: projection.actors.map(actor => ({ actorKey: actor.actorKey, name: actor.name, role: actor.role })),
    availableActions: structuredClone(projection.availableActions),
  }
}

/** The caller supplies the spectator projection. The explicit allowlist also tolerates a mistaken GM caller safely. */
export function createOnlineTtrpgPublicNarrationViewV1(projection: TtrpgViewerProjectionV1) {
  return {
    schema: 'storyforge.online-public-narration-view' as const, version: 1 as const,
    scenes: projection.scenes.filter(scene => scene.status === 'current').map(scene => ({ sceneKey: scene.sceneKey, title: scene.title, description: scene.description })),
    actors: projection.actors.map(actor => ({ actorKey: actor.actorKey, name: actor.name, role: actor.role })),
    clues: projection.visibleClues.filter(clue => clue.visibility === 'party').map(clue => ({ title: clue.title, description: clue.description })),
    priorNarration: projection.recentNarrations.map(item => ({ text: item.text })),
  }
}

export function createOnlineTtrpgNarratedActionV1(action: TtrpgRuntimeRuleActionResultV1) {
  if (!action.receipt) throw new Error('[online-ai-view] 缺少正式行动回执')
  return {
    eventSequence: action.eventSequence, actorKey: action.actorKey, targetKey: action.targetKey,
    actionKey: action.actionKey, actionName: action.actionName, outcome: action.outcome,
    synthesisTemplate: createDeterministicGmSynthesisFrameV2(action.receipt),
  }
}
