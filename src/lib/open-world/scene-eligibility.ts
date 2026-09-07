import type {
  TextOpenWorldActionProjectionContextV1,
  TextOpenWorldNarrativeModuleV2,
  TextOpenWorldParsedModulesV1,
} from '../types'

export type TextOpenWorldAuthoredSceneV2 = TextOpenWorldNarrativeModuleV2['scenes'][number]

export function effectiveTextOpenWorldSceneLocationKeyV1(
  scene: TextOpenWorldAuthoredSceneV2,
  actors: readonly { key: string; homeLocationKey: string }[],
): string {
  if ((scene.sourceKind === 'quest-offer' || scene.sourceKind === 'quest-resolution') && scene.actorKey) {
    // Early P9 v2 packages placed actor-owned quest endpoints at the quest's
    // first stage while still requiring the owner as a participant. Normalize
    // those indistinguishable frozen packages to the owner's authored home.
    return actors.find(actor => actor.key === scene.actorKey)?.homeLocationKey ?? scene.locationKey
  }
  return scene.locationKey
}

export function effectiveTextOpenWorldSceneConditionKeysV1(
  scene: TextOpenWorldAuthoredSceneV2,
  actions: readonly { key: string; requirementConditionKeys: string[] }[],
): string[] {
  if (scene.sourceKind !== 'quest-objective' && scene.sourceKind !== 'actor-dialogue') {
    return scene.availabilityConditionKeys
  }
  const conditionSets = scene.actionKeys.map(actionKey => (
    new Set(actions.find(action => action.key === actionKey)?.requirementConditionKeys ?? [])
  ))
  if (!conditionSets.length) return []
  return [...conditionSets[0]!].filter(conditionKey => (
    conditionSets.slice(1).every(keys => keys.has(conditionKey))
  ))
}

export function effectiveTextOpenWorldSceneParticipantKeysV1(
  scene: TextOpenWorldAuthoredSceneV2,
  actors: readonly { key: string; homeLocationKey: string }[],
  scenes: readonly TextOpenWorldAuthoredSceneV2[],
): string[] {
  if (scene.sourceKind !== 'quest-objective') return scene.participantKeys
  // P9 Context v1 added every quest owner to every Objective. Older v2/v15
  // RuntimePackages do not identify that compiler revision, so normalize out
  // participants that were not bound as an explicit Actor requirement. P9
  // gives every explicit Actor requirement the same governed Actor Action that
  // appears in that Actor's dialogue scene; the legacy owner injection adds no
  // such Action. Current P8 schedules are home-location only; future mobile
  // schedules require a versioned scene-location contract rather than guessing.
  return scene.participantKeys.filter(actorKey => {
    const actorActionKeys = new Set(scenes
      .filter(candidate => candidate.sourceKind === 'actor-dialogue' && candidate.actorKey === actorKey)
      .flatMap(candidate => candidate.actionKeys))
    return scene.actionKeys.some(actionKey => actorActionKeys.has(actionKey))
      && actors.find(actor => actor.key === actorKey)?.homeLocationKey === scene.locationKey
  })
}

export function textOpenWorldSceneQuestInstanceKeysV1(
  scene: TextOpenWorldAuthoredSceneV2,
  context: TextOpenWorldActionProjectionContextV1,
): string[] {
  if (!scene.questKey) return []
  const instanceKeys = Object.entries(context.questDefinitionKeyByInstanceKey)
    .filter(([, questKey]) => questKey === scene.questKey)
    .map(([instanceKey]) => instanceKey)
  if (scene.sourceKind === 'quest-offer') {
    return instanceKeys.filter(instanceKey => context.questStatusByInstanceKey[instanceKey] === 'revealed')
  }
  if (scene.sourceKind === 'quest-objective') {
    return instanceKeys.filter(instanceKey => (
      context.questStatusByInstanceKey[instanceKey] === 'active'
      && context.questStageKeyByInstanceKey[instanceKey] === scene.stageKey
      && scene.objectiveKey != null
      && context.questObjectiveStatusByInstanceKey[instanceKey]?.[scene.objectiveKey] === 'active'
    ))
  }
  if (scene.sourceKind === 'quest-resolution') {
    return instanceKeys.filter(instanceKey => (
      context.questStatusByInstanceKey[instanceKey] === 'completed'
      && context.questStageKeyByInstanceKey[instanceKey] === scene.stageKey
    ))
  }
  return instanceKeys
}

function questLifecycleAllows(
  scene: TextOpenWorldAuthoredSceneV2,
  context: TextOpenWorldActionProjectionContextV1,
): boolean {
  return !scene.questKey || textOpenWorldSceneQuestInstanceKeysV1(scene, context).length > 0
}

/**
 * Shared runtime gate for a frozen P9 scene. The scene surface always uses the
 * result; the Action registry additionally applies it only to scene-exclusive
 * player quest actions. A generic use/equip/craft/trade Action may be mentioned
 * by an Objective scene and must remain available to its dedicated product UI.
 *
 * Director history is not current activation evidence. Random-event scenes
 * therefore remain closed until a later projection contract supplies an
 * explicit active/expiry token.
 */
export function textOpenWorldSceneEligibleV1(input: {
  scene: TextOpenWorldAuthoredSceneV2
  modules: {
    narrative: TextOpenWorldNarrativeModuleV2
    actions: TextOpenWorldParsedModulesV1['actions']
    actors: TextOpenWorldParsedModulesV1['actors']
  }
  context: TextOpenWorldActionProjectionContextV1
}): boolean {
  const { scene, modules, context } = input
  if (scene.sourceKind === 'random-event') return false
  if (effectiveTextOpenWorldSceneLocationKeyV1(scene, modules.actors.actors) !== context.currentLocationKey) return false
  const conditionKeys = effectiveTextOpenWorldSceneConditionKeysV1(scene, modules.actions.actions)
  if (!conditionKeys.every(conditionKey => context.conditionResults[conditionKey]?.satisfied === true)) {
    return false
  }
  const presentActorKeys = new Set(context.validTargetKeysByScope.actor ?? [])
  const participantKeys = effectiveTextOpenWorldSceneParticipantKeysV1(
    scene,
    modules.actors.actors,
    modules.narrative.scenes,
  )
  if (!participantKeys.every(actorKey => presentActorKeys.has(actorKey))) return false
  return questLifecycleAllows(scene, context)
}
