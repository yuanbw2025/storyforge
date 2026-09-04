/**
 * Composition root for product-owned runtime adapters.
 *
 * ProductRuntime core owns durable session/event/checkpoint mechanics. Each
 * upper product owns parsing, event reduction, release-state validation and
 * branch extensions for its own state. Keeping every cross-product dispatch in
 * this explicit composition root prevents product code from growing back into
 * the shared runtime engine.
 */
import { parseAdventureState, adventureNarrativeProjection, applyAdventureEvent, createInitialAdventureState } from '../adventure/runtime'
import { adventureNarrativeActionCommandIdV1 } from '../adventure/command-identity'
import { parseAvgPresentationState, applyAvgPresentationEvent, createInitialAvgPresentationState } from '../avg/runtime'
import { parseInteractionState, applyInteractionEvent, createInitialInteractionState, rebaseInteractionStateForBranch } from '../character-interaction/runtime'
import { evaluateNarrativeChoices } from './narrative-content'
import { parseOpenWorldEvolutionState, applyOpenWorldEvolutionProductRuntimeEvent, openWorldEvolutionProjection, createInitialOpenWorldEvolutionState, rebaseOpenWorldEvolutionStateForBranch } from '../open-world/evolution-runtime'
import { parseOpenWorldState, applyOpenWorldEvent, openWorldMainlineProjection, createInitialOpenWorldState, rebaseOpenWorldStateForBranch } from '../open-world/runtime'
import { assertInitialTtrpgProductStateV1 } from '../ttrpg/runtime'
import { applyTtrpgRuntimeEventV1 } from '../ttrpg/runtime-event-reducer'
import { cloneTtrpgRuntimeBranchExtensionsV1 } from '../ttrpg/runtime-branch'
import { parseTtrpgState } from '../ttrpg/runtime-state'
import type {
  ProductRuntimeEvent,
  ProductRuntimePackageV1,
  ProductRuntimeSession,
  ProductRuntimeState,
  FrozenNarrativeChoice,
} from '../types'
import {
  isProductRuntimeJsonObjectV1,
  stableProductRuntimeJsonV1,
  type ProductRuntimeJsonObjectV1,
} from './runtime-values'

export function parseProductOwnedRuntimeStateV1(
  value: ProductRuntimeState,
): Pick<
  ProductRuntimeState,
  'ttrpg' | 'interaction' | 'adventure' | 'presentation' | 'openWorldEvolution' | 'openWorld'
> {
  return {
    ttrpg: parseTtrpgState(value.ttrpg),
    interaction: parseInteractionState(value.interaction),
    adventure: parseAdventureState(value.adventure),
    presentation: parseAvgPresentationState(value.presentation),
    openWorldEvolution: parseOpenWorldEvolutionState(value.openWorldEvolution),
    openWorld: parseOpenWorldState(value.openWorld),
  }
}

function refreshNarrativeChoices(state: ProductRuntimeState): void {
  const narrative = state.narrative
  if (!narrative || narrative.version !== 2 || narrative.completed || !narrative.currentNodeKey) return
  const evaluations = evaluateNarrativeChoices(
    {
      ...narrative.variables,
      __visitedNodeKeys: narrative.visitedNodeKeys,
      __selectedChoiceKeys: (narrative.choiceHistory ?? []).map(item => item.choiceKey),
    },
    narrative.currentNodeKey,
    narrative.choices ?? [],
  )
  narrative.visibleChoiceKeys = evaluations.filter(item => item.visible).map(item => item.choiceKey)
  narrative.availableChoiceKeys = evaluations.filter(item => item.available).map(item => item.choiceKey)
  narrative.availableNodeKeys = [
    ...new Set(evaluations.filter(item => item.available).map(item => item.targetNodeKey)),
  ]
}

/** Return null when the event belongs to the shared runtime protocol. */
export function applyProductOwnedRuntimeEventV1(
  state: ProductRuntimeState,
  event: ProductRuntimeEvent,
  payload: ProductRuntimeJsonObjectV1,
): ProductRuntimeState | null {
  if (event.type.startsWith('ttrpg.')) {
    return applyTtrpgRuntimeEventV1(state, event, payload)
  }
  if (event.type.startsWith('world.')) {
    state.openWorld = applyOpenWorldEvent(state.openWorld ?? null, event)
    if (event.type === 'world.narrative.synced') {
      if (
        !state.openWorld
        || !state.narrative
        || state.narrative.version !== 2
        || !isProductRuntimeJsonObjectV1(payload.projection)
      ) {
        throw new Error('[text-open-world] Narrative 同步需要正式开放世界与冻结叙事状态。')
      }
      const expected = openWorldMainlineProjection(
        state.openWorld,
        state.openWorld.mainlineQuestKeys,
      )
      if (stableProductRuntimeJsonV1(payload.projection) !== stableProductRuntimeJsonV1(expected)) {
        throw new Error('[text-open-world] Narrative 投影与开放世界状态不一致。')
      }
      state.narrative.variables = {
        ...state.narrative.variables,
        openWorld: structuredClone(expected),
      }
      refreshNarrativeChoices(state)
    }
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('open-world-evolution.')) {
    state.openWorldEvolution = applyOpenWorldEvolutionProductRuntimeEvent(
      state.openWorldEvolution ?? null,
      event,
    )
    if (event.type === 'open-world-evolution.narrative.synced') {
      if (
        !state.narrative
        || state.narrative.version !== 2
        || !isProductRuntimeJsonObjectV1(payload.projection)
      ) {
        throw new Error('[text-open-world/evolution] Narrative 同步需要正式演化状态与冻结叙事状态。')
      }
      const expected = openWorldEvolutionProjection(state.openWorldEvolution)
      if (stableProductRuntimeJsonV1(payload.projection) !== stableProductRuntimeJsonV1(expected)) {
        throw new Error('[text-open-world/evolution] Narrative 投影与演化状态不一致。')
      }
      state.narrative.variables = {
        ...state.narrative.variables,
        openWorldEvolution: structuredClone(expected),
      }
      refreshNarrativeChoices(state)
    }
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('presentation.')) {
    state.presentation = applyAvgPresentationEvent(
      state.presentation ?? null,
      event,
      state.narrative?.currentNodeKey ?? null,
      state.narrative?.beats ?? [],
    )
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('interaction.')) {
    state.interaction = applyInteractionEvent(state.interaction ?? null, event)
    state.lastSequence = event.sequence
    return state
  }
  if (event.type === 'adventure.narrative.synced') {
    if (!state.adventure || !state.narrative || state.narrative.version !== 2) {
      throw new Error('[adventure] Narrative 同步需要正式冒险与冻结叙事状态。')
    }
    if (!isProductRuntimeJsonObjectV1(payload.projection)) {
      throw new Error('[adventure] Narrative 投影无效。')
    }
    const expected = adventureNarrativeProjection(state.adventure)
    if (stableProductRuntimeJsonV1(payload.projection) !== stableProductRuntimeJsonV1(expected)) {
      throw new Error('[adventure] Narrative 投影与冒险状态不一致。')
    }
    state.narrative.variables = {
      ...state.narrative.variables,
      adventure: structuredClone(expected),
      ...(state.openWorld
        ? {
            openWorld: openWorldMainlineProjection(
              state.openWorld,
              state.openWorld.mainlineQuestKeys,
            ),
          }
        : {}),
    }
    refreshNarrativeChoices(state)
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('adventure.')) {
    state.adventure = applyAdventureEvent(state.adventure ?? null, event)
    if (state.openWorld) state.openWorld = applyOpenWorldEvent(state.openWorld, event)
    state.lastSequence = event.sequence
    return state
  }
  return null
}

export function withAdventureNarrativeProjectionV1(
  current: ProductRuntimeState,
): ProductRuntimeState {
  const state = structuredClone(current)
  if (!state.adventure || !state.narrative || state.narrative.version !== 2) return state
  state.narrative.variables = {
    ...state.narrative.variables,
    adventure: adventureNarrativeProjection(state.adventure),
  }
  refreshNarrativeChoices(state)
  return state
}

export function withOpenWorldEvolutionProjectionV1(
  current: ProductRuntimeState,
): ProductRuntimeState {
  const state = structuredClone(current)
  if (!state.openWorldEvolution || !state.narrative || state.narrative.version !== 2) return state
  state.narrative.variables = {
    ...state.narrative.variables,
    openWorldEvolution: openWorldEvolutionProjection(state.openWorldEvolution),
  }
  refreshNarrativeChoices(state)
  return state
}

export function withOpenWorldNarrativeProjectionV1(
  current: ProductRuntimeState,
): ProductRuntimeState {
  const state = structuredClone(current)
  if (!state.openWorld || !state.narrative || state.narrative.version !== 2) return state
  state.narrative.variables = {
    ...state.narrative.variables,
    openWorld: openWorldMainlineProjection(state.openWorld, state.openWorld.mainlineQuestKeys),
  }
  refreshNarrativeChoices(state)
  return state
}

export function assertFrozenProductRuntimeStateV1(input: {
  initial: ProductRuntimeState
  runtimePackage: ProductRuntimePackageV1
  runtimeSourceHash: string
  origin: 'release' | 'preview' | 'branch'
}): void {
  const { initial, runtimePackage, runtimeSourceHash } = input
  if (runtimePackage.productType === 'character-interaction') {
    const interaction = initial.interaction
    const expected = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    })
    const frozenMismatch = !interaction
      || interaction.playerKey !== expected.playerKey
      || stableProductRuntimeJsonV1(interaction.profiles) !== stableProductRuntimeJsonV1(expected.profiles)
      || stableProductRuntimeJsonV1(interaction.sceneTemplates) !== stableProductRuntimeJsonV1(expected.sceneTemplates)
    const entryStateMismatch = input.origin !== 'branch'
      && stableProductRuntimeJsonV1(interaction) !== stableProductRuntimeJsonV1(expected)
    if (frozenMismatch || entryStateMismatch) {
      throw new Error('character-interaction 初始状态必须来自绑定 RuntimePackage 的冻结互动内容。')
    }
    return
  }

  if (runtimePackage.productType === 'text-adventure') {
    const adventure = initial.adventure
    const expected = createInitialAdventureState(runtimePackage.adventure!, runtimeSourceHash)
    const frozenMismatch = !adventure
      || adventure.contentHash !== runtimeSourceHash
      || stableProductRuntimeJsonV1(adventure.abilities) !== stableProductRuntimeJsonV1(expected.abilities)
      || Object.keys(adventure.resources).some(
        key => !Object.prototype.hasOwnProperty.call(expected.resources, key),
      )
    const entryStateMismatch = input.origin !== 'branch'
      && stableProductRuntimeJsonV1(adventure) !== stableProductRuntimeJsonV1(expected)
    if (frozenMismatch || entryStateMismatch) {
      throw new Error('text-adventure 初始状态必须来自绑定 RuntimePackage 的冻结冒险内容。')
    }
    return
  }

  if (runtimePackage.productType === 'avg') {
    const presentation = initial.presentation
    const expected = createInitialAvgPresentationState({
      contentHash: runtimeSourceHash,
      assets: runtimePackage.presentation!.assets,
      content: runtimePackage.presentation!,
      entryNodeKey: runtimePackage.narrative.entryNodeKey,
    })
    const frozenMismatch = !presentation
      || presentation.contentHash !== runtimeSourceHash
      || stableProductRuntimeJsonV1(presentation.assets) !== stableProductRuntimeJsonV1(expected.assets)
      || stableProductRuntimeJsonV1(presentation.cues) !== stableProductRuntimeJsonV1(expected.cues)
    const entryStateMismatch = input.origin !== 'branch'
      && stableProductRuntimeJsonV1(presentation) !== stableProductRuntimeJsonV1(expected)
    if (frozenMismatch || entryStateMismatch) {
      throw new Error('avg 初始演出必须来自绑定 RuntimePackage 的冻结内容。')
    }
    return
  }

  if (runtimePackage.productType === 'text-open-world') {
    const expectedInteraction = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    })
    const expectedAdventure = createInitialAdventureState(runtimePackage.adventure!, runtimeSourceHash)
    const expectedEvolution = createInitialOpenWorldEvolutionState(runtimePackage.openWorldEvolution!, runtimeSourceHash)
    const expectedOpenWorld = createInitialOpenWorldState(runtimePackage.openWorld!, runtimeSourceHash)
    const frozenMismatch = !initial.interaction
      || !initial.adventure
      || !initial.openWorldEvolution
      || !initial.openWorld
      || initial.adventure.contentHash !== runtimeSourceHash
      || initial.openWorldEvolution.contentHash !== runtimeSourceHash
      || initial.openWorld.contentHash !== runtimeSourceHash
      || stableProductRuntimeJsonV1(initial.interaction.profiles) !== stableProductRuntimeJsonV1(expectedInteraction.profiles)
      || stableProductRuntimeJsonV1(initial.interaction.sceneTemplates) !== stableProductRuntimeJsonV1(expectedInteraction.sceneTemplates)
      || stableProductRuntimeJsonV1(initial.openWorld.mainlineQuestKeys) !== stableProductRuntimeJsonV1(expectedOpenWorld.mainlineQuestKeys)
    const entryStateMismatch = input.origin !== 'branch'
      && (
        stableProductRuntimeJsonV1(initial.interaction) !== stableProductRuntimeJsonV1(expectedInteraction)
        || stableProductRuntimeJsonV1(initial.adventure) !== stableProductRuntimeJsonV1(expectedAdventure)
        || stableProductRuntimeJsonV1(initial.openWorldEvolution) !== stableProductRuntimeJsonV1(expectedEvolution)
        || stableProductRuntimeJsonV1(initial.openWorld) !== stableProductRuntimeJsonV1(expectedOpenWorld)
      )
    if (frozenMismatch || entryStateMismatch) {
      throw new Error('text-open-world 初始状态必须来自绑定 RuntimePackage 的全部冻结内容。')
    }
    return
  }

  assertInitialTtrpgProductStateV1({
    state: initial,
    content: runtimePackage.ttrpg!,
    allowProgress: input.origin === 'branch',
  })
}

export function rebaseProductRuntimeStateForBranchV1(
  state: ProductRuntimeState,
  throughSequence: number,
): ProductRuntimeState {
  if (state.interaction) {
    state.interaction = rebaseInteractionStateForBranch(state.interaction, throughSequence)
  }
  if (state.openWorldEvolution) {
    state.openWorldEvolution = rebaseOpenWorldEvolutionStateForBranch(state.openWorldEvolution)
  }
  if (state.openWorld) state.openWorld = rebaseOpenWorldStateForBranch(state.openWorld)
  return state
}

export function assertProductNarrativeChoiceReadyV1(input: {
  session: ProductRuntimeSession
  state: ProductRuntimeState
  choice: FrozenNarrativeChoice
}): void {
  const { session, state, choice } = input
  const narrative = state.narrative
  if (!narrative?.currentNodeKey) return

  if (session.kind === 'avg') {
    const nodeBeats = (narrative.beats ?? [])
      .filter(beat => beat.nodeKey === narrative.currentNodeKey)
      .sort((a, b) => a.order - b.order || a.beatKey.localeCompare(b.beatKey))
    const reachedIndex = state.presentation?.currentNodeKey === narrative.currentNodeKey
      && state.presentation.currentBeatKey
      ? nodeBeats.findIndex(beat => beat.beatKey === state.presentation!.currentBeatKey)
      : -1
    if (nodeBeats.slice(reachedIndex + 1).length) {
      throw new Error('[avg] 必须先读完当前节点的全部 Beat 才能选择。')
    }
  }

  const actionTags = choice.tags.filter(tag => tag.startsWith('adventure-action:'))
  if (
    (session.kind === 'text-adventure' || session.kind === 'text-open-world')
    && actionTags.length
  ) {
    if (actionTags.length !== 1 || !state.adventure) {
      throw new Error('[adventure] Narrative Choice 公共行动绑定无效。')
    }
    const actionKey = actionTags[0].slice('adventure-action:'.length)
    const requiredCommandId = adventureNarrativeActionCommandIdV1(session.id!, choice.choiceKey)
    if (!state.adventure.actionHistory.some(
      item => item.actionKey === actionKey && item.commandId === requiredCommandId,
    )) {
      throw new Error('[adventure] Narrative Choice 必须先通过公共 Adventure 行动桥接。')
    }
  }
}

export async function cloneProductRuntimeBranchExtensionsV1(input: {
  parent: ProductRuntimeSession
  child: ProductRuntimeSession
  throughSequence: number
  state: ProductRuntimeState
  events: ProductRuntimeEvent[]
}): Promise<void> {
  if (input.parent.kind !== 'ttrpg') return
  await cloneTtrpgRuntimeBranchExtensionsV1(input)
}
