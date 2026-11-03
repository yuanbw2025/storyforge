import { parseAvgReadingStateV1 } from '../avg/reading-contract'
import { applyAvgOnceAudioEventV1, assertAvgOnceAudioStateV1 } from '../avg/once-audio-runtime'
import { createAvgBranchOriginV1, verifyAvgBranchOriginV1 } from '../avg/branch-origin'
import { applyAvgVoiceEventV1, recordAvgReadingHistoryV1, createAvgReadingStateV1, assertAvgReadingHistoryV1 } from '../avg/reading-runtime'
/**
 * Composition root for product-owned runtime adapters.
 *
 * ProductRuntime core owns durable session/event/checkpoint mechanics. Each
 * upper product owns parsing, event reduction, release-state validation and
 * branch extensions for its own state. Keeping every cross-product dispatch in
 * this explicit composition root prevents product code from growing back into
 * the shared runtime engine.
 */
import { applyAvgInventoryActionV1 } from '../avg/inventory-runtime'
import { parseAdventureState, adventureNarrativeProjection, applyAdventureEvent, createInitialAdventureState } from '../adventure/runtime'
import { adventureNarrativeActionCommandIdV1 } from '../adventure/command-identity'
import { parseAvgPresentationState, applyAvgPresentationEvent, createInitialAvgPresentationState } from '../avg/runtime'
import { parseInteractionState, applyInteractionEvent, createInitialInteractionState, rebaseInteractionStateForBranch } from '../character-interaction/runtime'
import {prepareChatMessageEditBranchV1} from '../character-interaction/narrative-edit-contract'
import {assertChatReleaseUpgradeReceiptV1} from '../character-interaction/release-upgrade-receipt'
import type {ChatHistoricalOptionBranchIntentV1, ChatMessageEditBranchIntentV1} from '../types/chat-narrative'
import {prepareChatHistoricalOptionBranchV1} from '../character-interaction/narrative-options-history'
import { evaluateNarrativeChoices } from './narrative-content'
import { assertAvgSnapshotKeyV1, avgExecutableModule, avgRuntimeStage, parseAvgRuntimeRulesStateV1 } from '../avg/executable-module'
import { assertAvgSystemStateV1, previewAvgSystemEffectsV1 } from '../avg/system-state'
import { buildAvgSystemGraphV1 } from '../avg/system-graph'
import { parseOpenWorldEvolutionState, applyOpenWorldEvolutionProductRuntimeEvent, openWorldEvolutionProjection, createInitialOpenWorldEvolutionState, rebaseOpenWorldEvolutionStateForBranch } from '../open-world/evolution-runtime'
import { parseOpenWorldState, applyOpenWorldEvent, openWorldMainlineProjection, createInitialOpenWorldState, rebaseOpenWorldStateForBranch } from '../open-world/runtime'
import { assertTextOpenWorldRuntimeNewWorkV1 } from '../open-world/source-admission'
import {
  createInitialTextOpenWorldSessionProjectionV1,
  applyTextOpenWorldSessionEventV1,
  parseTextOpenWorldSessionProjectionV1,
  rebaseTextOpenWorldSessionProjectionForBranchV1,
} from '../open-world/session-projection'
import { assertInitialTtrpgProductStateV1, assertInitialTtrpgOpenProductStateV1 } from '../ttrpg/runtime'
import { projectTtrpgRulePackMechanicalCoreV1 } from '../ttrpg/rule-pack-v2'
import { applyTtrpgRuntimeEventV1 } from '../ttrpg/runtime-event-reducer'
import { cloneTtrpgRuntimeBranchExtensionsV1, createTtrpgRuntimeOwnedBranchV1 } from '../ttrpg/runtime-branch'
import { parseTtrpgState } from '../ttrpg/runtime-state'
import { parseTtrpgRuntimeStateV2 } from '../ttrpg/open-runtime-contract'
import { TTRPG_RUNTIME_CONTENT_READER_V1, prepareTtrpgRuntimeBranchStateV1,
  consumeTtrpgRuntimeBranchPreparationV1 } from '../ttrpg/runtime-product-adapter'
import type { CreateProductRuntimeSessionInput } from './runtime-core'
import { applyAiTownEventV1, createInitialAiTownStateV1, parseAiTownStateV1, rebaseAiTownStateForBranchV1 } from '../ai-town/runtime'
import {
  isTtrpgRuntimeContentV1,
  isTtrpgRuntimeContentV2,
} from '../ttrpg/content-version'
import type {
  ProductRuntimeEvent,
  AnyProductRuntimePackage,
  ProductRuntimeSession,
  ProductRuntimeState,
  ProductRuntimeKind,
  FrozenNarrativeChoice,
} from '../types'
import {
  isProductRuntimeJsonObjectV1,
  stableProductRuntimeJsonV1,
  type ProductRuntimeJsonObjectV1,
} from './runtime-values'

/** Only native AVG snapshots need portable detached-branch admission. Legacy
 * and other products keep their existing contract and serialized bytes. */
export async function verifyProductOwnedBranchOriginV1(input: {
  kind: string; initialState: unknown; canonSnapshotJson: string; runtimeSourceHash: string
}): Promise<boolean> {
  if (input.kind !== 'avg') return false
  return verifyAvgBranchOriginV1(input)
}

export async function createProductOwnedBranchOriginV1(input: {
  parent: ProductRuntimeSession; state: ProductRuntimeState; events: ProductRuntimeEvent[]; throughSequence: number
}): Promise<Record<string, unknown>> {
  const canon = JSON.parse(input.parent.canonSnapshotJson) as Record<string, unknown>
  if (input.parent.kind !== 'avg' || (!input.state.avgRules && !input.state.avgReading)) return canon
  const avgBranchOrigin = await createAvgBranchOriginV1({
    runtimeSourceHash: input.parent.runtimeSourceHash, initialState: input.state,
    parentInitialState: JSON.parse(input.parent.initialStateJson), parentThroughSequence: input.throughSequence,
    parentEventPrefix: input.events.filter(event => event.sequence <= input.throughSequence)
      .map(({ sequence, type, payloadJson }) => ({ sequence, type, payloadJson })),
  })
  if (canon.schema === 'storyforge.product-runtime-source' && canon.version === 2) {
    return { schema: 'storyforge.product-runtime-source', version: 3, source: canon, avgBranchOrigin }
  }
  return { ...canon, avgBranchOrigin }
}

export type ProductRuntimeBranchIntentV1 = ChatMessageEditBranchIntentV1 | ChatHistoricalOptionBranchIntentV1

export async function prepareProductRuntimeBranchIntentV1(parent: ProductRuntimeSession, before: ProductRuntimeState, after: ProductRuntimeState, intent: ProductRuntimeBranchIntentV1): Promise<void> {
  if (parent.kind !== 'character-interaction') throw new Error('分支改写请求与产品不匹配。')
  if (intent.kind === 'character-chat-option-switch') await prepareChatHistoricalOptionBranchV1(parent, before, after, intent)
  else if (intent.kind === 'character-chat-message-edit') prepareChatMessageEditBranchV1(before, after, intent)
  else throw new Error('分支改写请求与产品不匹配。')
}

export type ProductRuntimePackageForAdaptersV1 = AnyProductRuntimePackage

/** Protocol selection belongs to the product composition root, not the runtime core. */
export function productRuntimeContentReaderV1(kind: ProductRuntimeKind) {
  return kind === 'ttrpg' ? TTRPG_RUNTIME_CONTENT_READER_V1 : undefined
}

/** New-operation permission belongs to each product; historical readers and
 * receipt replay continue to use the independent strict source verifier. */
export function assertProductOwnedRuntimeNewWorkV1(runtimePackage: AnyProductRuntimePackage, operation: string): void {
  if (runtimePackage.productType === 'text-open-world') assertTextOpenWorldRuntimeNewWorkV1(runtimePackage, operation)
}

export function parseProductOwnedRuntimeStateV1(
  value: ProductRuntimeState,
): Pick<
  ProductRuntimeState,
  'ttrpg' | 'interaction' | 'adventure' | 'presentation' | 'openWorldEvolution' | 'openWorld' | 'town' | 'textOpenWorld' | 'avgRules' | 'avgReading'
> {
  return {
    ...(Object.prototype.hasOwnProperty.call(value, 'avgReading') ? { avgReading: parseAvgReadingStateV1(value.avgReading) } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'avgRules') ? { avgRules: parseAvgRuntimeRulesStateV1(value.avgRules) } : {}),
    ttrpg: value.ttrpg && 'runFormat' in value.ttrpg && value.ttrpg.runFormat === 'open'
      ? parseTtrpgRuntimeStateV2(value.ttrpg)
      : parseTtrpgState(value.ttrpg),
    interaction: parseInteractionState(value.interaction),
    adventure: parseAdventureState(value.adventure),
    presentation: parseAvgPresentationState(value.presentation),
    openWorldEvolution: parseOpenWorldEvolutionState(value.openWorldEvolution),
    openWorld: parseOpenWorldState(value.openWorld),
    town: parseAiTownStateV1(value.town),
    textOpenWorld: value.textOpenWorld == null
      ? null
      : parseTextOpenWorldSessionProjectionV1(value.textOpenWorld),
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
  if (event.type.startsWith('avg.audio.')) {
    if (event.actorKey !== 'player' || event.targetKey !== payload.cueKey) throw new Error('[avg-audio] 观察身份无效')
    applyAvgOnceAudioEventV1(state, event.type, payload, event.sequence)
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('avg.reading.')) {
    if (event.actorKey !== 'player' || event.targetKey !== payload.lineKey) throw new Error('[avg-reading] 观察身份无效')
    applyAvgVoiceEventV1(state, event.type, payload)
    state.lastSequence = event.sequence
    return state
  }
  if (state.avgReading && event.type === 'presentation.beat.reached') recordAvgReadingHistoryV1(state, 'line', String(payload.beatKey))
  if (state.avgReading && event.type === 'narrative.choice.committed') recordAvgReadingHistoryV1(state, 'choice', String(payload.choiceKey))
  if (event.type.startsWith('avg.inventory.')) {
    if (event.type !== 'avg.inventory.action.committed' || event.actorKey !== 'player' || event.targetKey !== payload.actionKey) throw new Error('[avg-inventory] 事件身份无效')
    applyAvgInventoryActionV1(state, payload)
    refreshNarrativeChoices(state)
    state.lastSequence = event.sequence
    return state
  }
  if (state.avgRules && event.type === 'presentation.beat.reached' && payload.snapshotKey != null) assertAvgSnapshotKeyV1(payload.snapshotKey)
  if (state.avgRules && event.type === 'narrative.choice.committed') {
    const plan = state.avgRules.systemPlan
    const action = plan.actions.find(action => action.key === payload.choiceKey && action.fromSceneKey === state.narrative?.currentNodeKey)
    const target = action && plan.scenes.find(scene => scene.key === action.toSceneKey)
    if (!action || !target || !state.narrative) throw new Error('[avg] 规则行动与当前场景不一致')
    const afterAction = previewAvgSystemEffectsV1(plan, state.narrative.variables, action.effects)
    previewAvgSystemEffectsV1(plan, afterAction, target.onEnter)
  }
  if (event.type.startsWith('text-open-world.')) {
    if (state.textOpenWorld) {
      state.textOpenWorld = applyTextOpenWorldSessionEventV1(state.textOpenWorld, event)
    }
    state.lastSequence = event.sequence
    return state
  }
  if (event.type.startsWith('ttrpg.')) {
    return applyTtrpgRuntimeEventV1(state, event, payload)
  }
  if (event.type.startsWith('town.')) {
    state.town = applyAiTownEventV1(state.town ?? null, event, payload)
    state.lastSequence = event.sequence
    return state
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
    if (event.type === 'interaction.release.upgraded') assertChatReleaseUpgradeReceiptV1(state, event, payload)
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
  runtimePackage: AnyProductRuntimePackage
  runtimeSourceHash: string
  origin: 'release' | 'preview' | 'branch'
}): void {
  const { initial, runtimePackage, runtimeSourceHash } = input
  const avgModule = avgExecutableModule(runtimePackage)
  if (initial.presentation?.onceAudio && (input.origin !== 'branch' || !avgModule)) throw new Error('[avg-audio] 新游戏/旧来源不得预置播放回执')
  assertAvgOnceAudioStateV1(initial)
  if (initial.avgReading && !avgModule?.reading) throw new Error('[avg-reading] 来源未启用阅读协议')
  if (avgModule?.reading) {
    const expected = createAvgReadingStateV1(avgModule)!
    if (!initial.avgReading || stableProductRuntimeJsonV1(initial.avgReading.plan) !== stableProductRuntimeJsonV1(expected.plan)
      || stableProductRuntimeJsonV1(initial.avgReading.lines) !== stableProductRuntimeJsonV1(expected.lines)) throw new Error('[avg-reading] 阅读状态与冻结来源不一致')
    if (input.origin !== 'branch' && (initial.avgReading.current !== null || initial.avgReading.history.length)) throw new Error('[avg-reading] 初始来源不能预置播放/阅读历史')
    assertAvgReadingHistoryV1(initial.avgReading, initial)
  }
  if (initial.avgRules && !avgModule) throw new Error('[avg] 旧来源不得注入新规则状态')
  if (avgModule) {
    if (!initial.avgRules || stableProductRuntimeJsonV1(initial.avgRules.systemPlan) !== stableProductRuntimeJsonV1(avgModule.systemPlan) || !initial.narrative) throw new Error('[avg] 规则状态与冻结来源不一致')
    assertAvgSystemStateV1(avgModule.systemPlan, initial.narrative.variables)
    if (input.origin !== 'branch') {
      const compiled = buildAvgSystemGraphV1(avgModule.systemPlan)
      const entry = avgModule.systemPlan.scenes.find(scene => scene.key === avgModule.systemPlan.entrySceneKey)!
      const expected = previewAvgSystemEffectsV1(avgModule.systemPlan, compiled.initialVariables, entry.onEnter)
      if (stableProductRuntimeJsonV1(expected) !== stableProductRuntimeJsonV1(initial.narrative.variables)) throw new Error('[avg] 入口规则状态与冻结初值不一致')
    }
  }
  if (runtimePackage.productType === 'character-interaction') {
    const interaction = initial.interaction
    const expected = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
      chatSource: runtimePackage.interaction!.chatSource,
      chatNarrative: runtimePackage.interaction!.chatNarrative,
    })
    const frozenMismatch = !interaction
      || interaction.playerKey !== expected.playerKey
      || stableProductRuntimeJsonV1(interaction.profiles) !== stableProductRuntimeJsonV1(expected.profiles)
      || stableProductRuntimeJsonV1(interaction.sceneTemplates) !== stableProductRuntimeJsonV1(expected.sceneTemplates)
      || Boolean(interaction.chatNarrative) !== Boolean(expected.chatNarrative)
      || (expected.chatNarrative != null && (
        interaction.chatNarrative?.worldReleaseHash !== expected.chatNarrative.worldReleaseHash
        || stableProductRuntimeJsonV1(interaction.chatNarrative?.persona) !== stableProductRuntimeJsonV1(expected.chatNarrative.persona)
        || stableProductRuntimeJsonV1(interaction.chatNarrative?.permissions) !== stableProductRuntimeJsonV1(expected.chatNarrative.permissions)))
    const entryStateMismatch = input.origin !== 'branch'
      && stableProductRuntimeJsonV1(interaction) !== stableProductRuntimeJsonV1(expected)
    if (frozenMismatch || entryStateMismatch) {
      throw new Error('character-interaction 初始状态必须来自绑定 RuntimePackage 的冻结互动内容。')
    }
    return
  }

  if (runtimePackage.productType === 'ai-town') {
    const expectedInteraction = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    })
    const expected = createInitialAiTownStateV1(
      runtimePackage.town!,
      runtimeSourceHash,
    )
    const frozenMismatch = !initial.town
      || !initial.interaction
      || initial.town.contentHash !== runtimeSourceHash
      || stableProductRuntimeJsonV1(initial.town.content) !== stableProductRuntimeJsonV1(expected.content)
      || stableProductRuntimeJsonV1(initial.interaction.profiles) !== stableProductRuntimeJsonV1(expectedInteraction.profiles)
      || stableProductRuntimeJsonV1(initial.interaction.sceneTemplates) !== stableProductRuntimeJsonV1(expectedInteraction.sceneTemplates)
    const entryStateMismatch = input.origin !== 'branch'
      && (stableProductRuntimeJsonV1(initial.town) !== stableProductRuntimeJsonV1(expected)
        || stableProductRuntimeJsonV1(initial.interaction) !== stableProductRuntimeJsonV1(expectedInteraction))
    if (frozenMismatch || entryStateMismatch) {
      throw new Error('ai-town 初始状态必须来自绑定 RuntimePackage 的冻结小镇内容。')
    }
    return
  }

  if (runtimePackage.productType === 'text-adventure') {
    const adventure = initial.adventure
    const expected = createInitialAdventureState(runtimePackage.adventure!, runtimeSourceHash)
    const frozenMismatch = !adventure
      || adventure.contentHash !== runtimeSourceHash
      || stableProductRuntimeJsonV1(Object.keys(adventure.abilities).sort())
        !== stableProductRuntimeJsonV1(Object.keys(expected.abilities).sort())
      || stableProductRuntimeJsonV1(Object.keys(adventure.resources).sort())
        !== stableProductRuntimeJsonV1(Object.keys(expected.resources).sort())
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
      assets: avgRuntimeStage(runtimePackage)!.assets,
      content: avgRuntimeStage(runtimePackage)!,
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
    const hasLegacyRuntime = runtimePackage.interaction != null
      && runtimePackage.adventure != null
      && runtimePackage.openWorldEvolution != null
      && runtimePackage.openWorld != null
    if (runtimePackage.textOpenWorldVNext) {
      const expected = createInitialTextOpenWorldSessionProjectionV1(runtimePackage.textOpenWorldVNext)
      const frozenMismatch = !initial.textOpenWorld
        || (!hasLegacyRuntime && (
          initial.interaction != null
          || initial.adventure != null
          || initial.openWorldEvolution != null
          || initial.openWorld != null
        ))
        || stableProductRuntimeJsonV1(initial.textOpenWorld.runtimePackage)
          !== stableProductRuntimeJsonV1(expected.runtimePackage)
      const entryStateMismatch = input.origin !== 'branch'
        && stableProductRuntimeJsonV1(initial.textOpenWorld) !== stableProductRuntimeJsonV1(expected)
      if (frozenMismatch || entryStateMismatch) {
        throw new Error('text-open-world vNext初始状态必须来自绑定RuntimePackage的统一投影。')
      }
    }
    if (hasLegacyRuntime) {
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
        || (!runtimePackage.textOpenWorldVNext && initial.textOpenWorld != null)
      const entryStateMismatch = input.origin !== 'branch'
        && (
          stableProductRuntimeJsonV1(initial.interaction) !== stableProductRuntimeJsonV1(expectedInteraction)
          || stableProductRuntimeJsonV1(initial.adventure) !== stableProductRuntimeJsonV1(expectedAdventure)
          || stableProductRuntimeJsonV1(initial.openWorldEvolution) !== stableProductRuntimeJsonV1(expectedEvolution)
          || stableProductRuntimeJsonV1(initial.openWorld) !== stableProductRuntimeJsonV1(expectedOpenWorld)
          || (!runtimePackage.textOpenWorldVNext && initial.textOpenWorld != null)
        )
      if (frozenMismatch || entryStateMismatch) {
        throw new Error('text-open-world 初始状态必须来自绑定 RuntimePackage 的全部冻结内容。')
      }
    }
    return
  }

  if (runtimePackage.ttrpg && isTtrpgRuntimeContentV2(runtimePackage.ttrpg)) {
    assertInitialTtrpgOpenProductStateV1({ state: initial, content: runtimePackage.ttrpg,
      mechanicalRulePack: projectTtrpgRulePackMechanicalCoreV1(runtimePackage.ttrpg.rulePack.content),
      allowProgress: input.origin === 'branch' })
    return
  }
  if (!runtimePackage.ttrpg || !isTtrpgRuntimeContentV1(runtimePackage.ttrpg)) {
    throw new Error('scripted TTRPG 初始状态缺少 protocol-1 内容。')
  }
  assertInitialTtrpgProductStateV1({
    state: initial,
    content: runtimePackage.ttrpg,
    allowProgress: input.origin === 'branch',
  })
}

export function rebaseProductRuntimeStateForBranchV1(
  state: ProductRuntimeState,
  throughSequence: number,
): ProductRuntimeState {
  if (state.ttrpg && 'runFormat' in state.ttrpg && state.ttrpg.runFormat === 'open') {
    throw new Error('[ttrpg] open 分支血缘与来源继承尚未交付，不能按 scripted 静默克隆')
  }
  if (state.interaction) {
    state.interaction = rebaseInteractionStateForBranch(state.interaction, throughSequence)
  }
  if (state.openWorldEvolution) {
    state.openWorldEvolution = rebaseOpenWorldEvolutionStateForBranch(state.openWorldEvolution)
  }
  if (state.openWorld) state.openWorld = rebaseOpenWorldStateForBranch(state.openWorld)
  if (state.town) state.town = rebaseAiTownStateForBranchV1(state.town)
  if (state.textOpenWorld) {
    state.textOpenWorld = rebaseTextOpenWorldSessionProjectionForBranchV1(state.textOpenWorld)
  }
  return state
}

/** Only the branch coordinator supplies actual cutpoint evidence. Legacy product rebases stay synchronous. */
export async function prepareProductRuntimeStateForBranchV1(input: {
  parent: ProductRuntimeSession; state: ProductRuntimeState; events: ProductRuntimeEvent[]; throughSequence: number;
}): Promise<ProductRuntimeState> {
  if (input.parent.kind === 'ttrpg') {
    const state = await prepareTtrpgRuntimeBranchStateV1(input)
    if (state) return state
  }
  return rebaseProductRuntimeStateForBranchV1(input.state, input.throughSequence)
}
export async function consumeProductRuntimeBranchPreparationV1(
  kind: ProductRuntimeKind, state: ProductRuntimeState | undefined, runtimeSourceHash: string,
): Promise<void> {
  if (kind === 'ttrpg') await consumeTtrpgRuntimeBranchPreparationV1(state, runtimeSourceHash)
}

/** Product-owned atomic branch strategies; null keeps the original generic path. */
export async function createProductOwnedRuntimeBranchV1(input: {
  parent: ProductRuntimeSession; state: ProductRuntimeState; childInput: CreateProductRuntimeSessionInput
  events: ProductRuntimeEvent[]; throughSequence: number
}): Promise<ProductRuntimeSession | null> {
  return input.parent.kind === 'ttrpg' ? createTtrpgRuntimeOwnedBranchV1(input) : null
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

/** Product-owned guards apply equally to live commands and event replay. */
export function assertProductOwnedRuntimeInvariantsV1(state: ProductRuntimeState): void {
  assertAvgOnceAudioStateV1(state)
  if (state.avgReading) {
    if (!state.avgRules || !state.narrative || !state.presentation) throw new Error('[avg-reading] 阅读状态缺少原生规则/舞台')
    assertAvgReadingHistoryV1(state.avgReading, state)
  }
  if (state.avgRules) {
    if (!state.narrative) throw new Error('[avg] 规则状态缺少叙事投影')
    assertAvgSystemStateV1(state.avgRules.systemPlan, state.narrative.variables)
  }
}
