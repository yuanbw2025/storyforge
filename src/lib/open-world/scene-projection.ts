import type {
  TextOpenWorldActionInputBindingsV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { createTextOpenWorldActionRegistryV1 } from './action-registry'
import { projectTextOpenWorldActorsV1, type TextOpenWorldProjectedActorV1 } from './actors'
import { parseTextOpenWorldModulesV1 } from './modules'
import {
  effectiveTextOpenWorldSceneLocationKeyV1,
  effectiveTextOpenWorldSceneParticipantKeysV1,
  textOpenWorldSceneEligibleV1,
  type TextOpenWorldAuthoredSceneV2,
} from './scene-eligibility'
import {
  deriveTextOpenWorldContextsV1,
  parseTextOpenWorldSessionProjectionV1,
} from './session-projection'

type AuthoredSceneV1 = TextOpenWorldAuthoredSceneV2
const PARAMETERIZED_ACTION_CATEGORIES = new Set(['craft', 'buy', 'sell'])

export interface TextOpenWorldProjectedSceneActorV1 {
  key: string
  name: string
  attitude: 'bad' | 'neutral' | 'good'
  greetingTone: string
}

export interface TextOpenWorldProjectedSceneChoiceV1 {
  key: string
  label: string
  description: string
  actionKey: string
}

export interface TextOpenWorldProjectedSceneNaturalLanguageExamplesV1 {
  actionKey: string
  exampleUtterances: string[]
}

/**
 * A read-only view of one P9 scene that is legal in the current Session
 * projection. Knowledge-boundary authoring fields intentionally do not cross
 * this player-facing boundary.
 */
export interface TextOpenWorldProjectedSceneV1 {
  key: string
  order: number
  sourceKind: AuthoredSceneV1['sourceKind']
  sourceKey: string
  title: string
  regionKey: string
  locationKey: string
  participantKeys: string[]
  authoredOpeningText: string
  openingText: string
  bodyText: string
  actor: TextOpenWorldProjectedSceneActorV1 | null
  presentationMode: 'authored' | 'legacy-endpoint-fallback'
  compatibilityNotice: string | null
  fixedChoiceKeys: string[]
  fixedChoices: TextOpenWorldProjectedSceneChoiceV1[]
  actionKeys: string[]
  naturalLanguageExamples: TextOpenWorldProjectedSceneNaturalLanguageExamplesV1[]
}

export type TextOpenWorldSceneProjectionV1 =
  | {
      status: 'unsupported'
      reason: 'narrative-v2-and-action-v15-required'
      message: string
      narrativeVersion: number
      actionVersion: number
      currentLocationKey: string
      randomEventPolicy: 'hidden-without-current-activation-evidence'
      scenes: []
      recommendedSceneKey: null
    }
  | {
      status: 'ready'
      narrativeVersion: 2
      actionVersion: 15 | 16 | 17 | 18
      currentLocationKey: string
      randomEventPolicy: 'hidden-without-current-activation-evidence'
      scenes: TextOpenWorldProjectedSceneV1[]
      recommendedSceneKey: string | null
      /** Available player Actions intentionally not owned by any authored P9 scene. */
      ambientActionKeys: string[]
    }

function projectActor(actor: TextOpenWorldProjectedActorV1 | undefined): TextOpenWorldProjectedSceneActorV1 | null {
  return actor ? {
    key: actor.key,
    name: actor.name,
    attitude: actor.attitude,
    greetingTone: actor.greetingTone,
  } : null
}

function naturalLanguageExamples(
  actionKeys: readonly string[],
  bindings: TextOpenWorldActionInputBindingsV1,
): TextOpenWorldProjectedSceneNaturalLanguageExamplesV1[] {
  const bindingByActionKey = new Map(bindings.actions.map(binding => [binding.actionKey, binding]))
  return actionKeys.flatMap(actionKey => {
    const binding = bindingByActionKey.get(actionKey)
    return binding?.naturalLanguage.mode === 'existing-action-candidate'
      ? [{ actionKey, exampleUtterances: [...binding.naturalLanguage.exampleUtterances] }]
      : []
  })
}

/**
 * Derives the current player-visible P9 scene set without writing a
 * currentSceneKey or any other parallel runtime state.
 *
 * Director history proves that a random event happened, but the current
 * runtime contract has no activation/expiry token proving that its scene is
 * still active. Random-event scenes therefore fail closed until that evidence
 * exists in a later runtime contract.
 */
export function projectTextOpenWorldScenesV1(
  value: TextOpenWorldSessionProjectionV1,
): TextOpenWorldSceneProjectionV1 {
  const projection = parseTextOpenWorldSessionProjectionV1(value)
  const modules = parseTextOpenWorldModulesV1(projection.runtimePackage)
  const currentLocationKey = projection.state.map.currentLocationKey
  const randomEventPolicy = 'hidden-without-current-activation-evidence' as const

  if (modules.narrative.version !== 2 || !('inputBindings' in modules.actions)) {
    return {
      status: 'unsupported',
      reason: 'narrative-v2-and-action-v15-required',
      message: '当前冻结运行包不含P9场景与输入绑定；调用方必须使用旧版场景降级展示。',
      narrativeVersion: modules.narrative.version,
      actionVersion: modules.actions.version,
      currentLocationKey,
      randomEventPolicy,
      scenes: [],
      recommendedSceneKey: null,
    }
  }

  const narrative = modules.narrative
  const actions = modules.actions
  const contexts = deriveTextOpenWorldContextsV1(projection)
  const projectedActors = projectTextOpenWorldActorsV1({
    runtimePackage: projection.runtimePackage,
    state: projection.state,
    parsedModules: modules,
    attitudeByActorKey: contexts.condition.relations.attitudeByActorKey,
  })
  const projectedActorsByKey = new Map(projectedActors.map(actor => [actor.key, actor]))
  const availableActionKeys = new Set(createTextOpenWorldActionRegistryV1(projection.runtimePackage)
    .project(contexts.action)
    .filter(action => action.available)
    .map(action => action.action.key))
  const authoredSceneActionKeys = new Set(narrative.scenes.flatMap(scene => scene.actionKeys))
  const ambientActionKeys = actions.actions
    .map(action => action.key)
    .filter(actionKey => availableActionKeys.has(actionKey) && !authoredSceneActionKeys.has(actionKey))
  const choicesByKey = new Map(narrative.fixedChoices.map(choice => [choice.key, choice]))

  const scenes = narrative.scenes
    .filter(scene => textOpenWorldSceneEligibleV1({
      scene,
      modules: { narrative, actions, actors: modules.actors },
      context: contexts.action,
    }))
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
    .map(scene => {
      // Craft and transactions require quantity and/or item selection that the
      // G4-03 scene shortcut cannot express. Their dedicated product surfaces
      // consume the same Action later; hiding the shortcut is safer than
      // emitting a command that is guaranteed to fail parameter validation.
      const actionKeys = scene.actionKeys.filter(actionKey => {
        const action = actions.actions.find(candidate => candidate.key === actionKey)
        return availableActionKeys.has(actionKey)
          && action != null
          && !PARAMETERIZED_ACTION_CATEGORIES.has(action.category)
      })
      const actionKeySet = new Set(actionKeys)
      const fixedChoices = scene.fixedChoiceKeys.flatMap(choiceKey => {
        const choice = choicesByKey.get(choiceKey)
        return choice && actionKeySet.has(choice.actionKey)
          ? [{
              key: choice.key,
              label: choice.label,
              description: choice.description,
              actionKey: choice.actionKey,
            }]
          : []
      })
      const actor = projectActor(scene.actorKey ? projectedActorsByKey.get(scene.actorKey) : undefined)
      const locationKey = effectiveTextOpenWorldSceneLocationKeyV1(scene, modules.actors.actors)
      const location = modules.world.locations.find(candidate => candidate.key === locationKey)
      const regionKey = location?.regionKey
        ?? scene.regionKey
      const participantKeys = effectiveTextOpenWorldSceneParticipantKeysV1(
        scene,
        modules.actors.actors,
        narrative.scenes,
      )
      const openingText = scene.sourceKind === 'actor-dialogue' && scene.attitudeOpenings && actor
        ? scene.attitudeOpenings[actor.attitude]
        : scene.openingText
      const legacyEndpointFallback = locationKey !== scene.locationKey
      const presentationMode: TextOpenWorldProjectedSceneV1['presentationMode'] = legacyEndpointFallback
        ? 'legacy-endpoint-fallback'
        : 'authored'
      const endpointActorName = actor?.name ?? '任务发布者'
      const endpointLocationTitle = location?.title ?? '其常驻地点'
      const compatibilityOpening = scene.sourceKind === 'quest-offer'
        ? `${endpointActorName}正在${endpointLocationTitle}等候，并向你说明这项委托。`
        : `${endpointActorName}正在${endpointLocationTitle}等候你处理后续。`
      const compatibilityBody = scene.sourceKind === 'quest-offer'
        ? `你可以在这里了解“${scene.title}”并决定是否接受。`
        : `你可以在这里继续处理“${scene.title}”的收束与奖励。`
      return {
        key: scene.key,
        order: scene.order,
        sourceKind: scene.sourceKind,
        sourceKey: scene.sourceKey,
        title: scene.title,
        regionKey,
        locationKey,
        participantKeys,
        authoredOpeningText: legacyEndpointFallback ? compatibilityOpening : scene.openingText,
        openingText: legacyEndpointFallback ? compatibilityOpening : openingText,
        bodyText: legacyEndpointFallback ? compatibilityBody : scene.bodyText,
        actor,
        presentationMode,
        compatibilityNotice: legacyEndpointFallback
          ? '此旧版场景的任务端点已归一到发布者常驻地点；为避免地点矛盾，正文使用确定性兼容回退。'
          : null,
        fixedChoiceKeys: fixedChoices.map(choice => choice.key),
        fixedChoices,
        actionKeys,
        naturalLanguageExamples: naturalLanguageExamples(actionKeys, actions.inputBindings),
      }
    })
    // A completed quest remains in the authoritative history, but its
    // resolution is no longer an interactive scene after every settlement or
    // ending Action has become unavailable. This keeps final ending choices
    // reachable while preventing an already-claimed reward from becoming the
    // permanent recommended dead scene.
    .filter(scene => scene.sourceKind !== 'quest-resolution' || scene.actionKeys.length > 0)

  return {
    status: 'ready',
    narrativeVersion: 2,
    actionVersion: actions.version,
    currentLocationKey,
    randomEventPolicy,
    scenes,
    recommendedSceneKey: scenes[0]?.key ?? null,
    ambientActionKeys,
  }
}
