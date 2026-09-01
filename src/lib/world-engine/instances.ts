import { db } from '../db/schema'
import {
  applySimulationEvent,
  createPreviewGameSession,
  createReleasedGameSession,
  hashSimulationRuntimeStateV1,
  readSimulationState,
  withAdventureNarrativeProjection,
  withNarrativeSimulationProjection,
  withOpenWorldNarrativeProjection,
  type CreateSimulationSessionInput,
} from '../simulation/runtime'
import {
  EMPTY_SIMULATION_STATE,
  type FrozenNarrativeBeat,
  type FrozenNarrativeChoice,
  type GameRuntimePackageV2,
  type PlayableGameSourceV1,
  type SimulationNarrativeNodeSnapshot,
  type SimulationNarrativeState,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
  type WorkspaceScope,
} from '../types'
import { createInitialInteractionState } from '../character-interaction/runtime'
import { createInitialAdventureState } from '../adventure/runtime'
import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
} from '../narrative/blueprint'
import { evaluateNarrativeChoices } from '../text-game/content'
import { assertGameReleaseUnchanged } from '../text-game/releases'
import { createInitialAvgPresentationState } from '../avg/runtime'
import { createInitialNarrativeSimulationState } from '../narrative-simulation/runtime'
import { createInitialOpenWorldState } from '../open-world/runtime'
import { createInitialTtrpgProductStateV1 } from '../ttrpg/runtime'
import { verifyPlayableGamePackageSource } from '../game-production/preview-source'
import {
  carryTtrpgContinuationParticipantsV2,
  installInitialTtrpgParticipantsV2,
} from '../ttrpg/participants'
import { parseRulePackV1 } from '../ttrpg/rule-pack'
import { parseTtrpgCampaignContentV1 } from '../ttrpg/campaign'
import {
  buildTtrpgContinuationStateV2,
  type TtrpgContinuationRequestV2,
} from '../ttrpg/continuity-state'
import { isFormalProductSessionKindV1 } from '../product/runtime-boundary'
import { resolveScope, scopeTransactionTables } from './scope'

/**
 * Sole upper-product runtime entry.
 *
 * A WorldRelease is production input, never an executable source. Callers must
 * provide an immutable Product/Game Release or a governed product Build.
 */
export interface CreateWorldInstanceInput {
  scope: WorkspaceScope
  kind: SimulationSessionKind
  title: string
  gameSource: PlayableGameSourceV1
  worldGroupId?: number | null
  seed?: string
  ttrpgContinuation?: TtrpgContinuationRequestV2
}

interface FrozenNarrativeDefinition {
  version: 2
  moduleKind: GameRuntimePackageV2['narrative']['moduleKind']
  moduleTitle: string
  entryNodeKey: string
  nodes: SimulationNarrativeNodeSnapshot[]
  sourceHash: string
  contentHash: string
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
  initialVariables: Record<string, unknown>
}

function gameReleaseNarrativeDefinition(
  runtimeSourceHash: string,
  runtimePackage: GameRuntimePackageV2,
): FrozenNarrativeDefinition {
  return {
    version: 2,
    moduleKind: runtimePackage.narrative.moduleKind,
    moduleTitle: runtimePackage.narrative.moduleTitle,
    entryNodeKey: runtimePackage.narrative.entryNodeKey,
    nodes: structuredClone(runtimePackage.narrative.nodes),
    sourceHash: runtimeSourceHash,
    contentHash: runtimeSourceHash,
    beats: structuredClone(runtimePackage.narrative.beats),
    choices: structuredClone(runtimePackage.narrative.choices),
    initialVariables: structuredClone(runtimePackage.definition.initialVariables),
  }
}

function sessionKindForProduct(
  productType: GameRuntimePackageV2['productType'],
): SimulationSessionKind {
  return productType === 'storygame'
    ? 'storygame'
    : productType === 'character-interaction'
      ? 'chatgame'
      : productType === 'text-adventure'
        ? 'textadventure'
        : productType === 'avg'
          ? 'avg'
          : productType === 'narrative-simulation'
            ? 'textsimulation'
            : productType === 'ttrpg'
              ? 'ttrpg'
              : 'textworld'
}

function initialNarrativeState(
  definition: FrozenNarrativeDefinition,
): SimulationNarrativeState {
  const entry = definition.nodes.find(node => node.key === definition.entryNodeKey)
  if (!entry) throw new Error('[instance] 冻结产品叙事入口不存在')
  const initialVariables = structuredClone(definition.initialVariables)
  if (!evaluateNarrativeCondition(parseNarrativeCondition(entry.conditionJson), initialVariables)) {
    throw new Error('[instance] 冻结产品叙事入口条件在初始状态下不成立')
  }
  const variables = applyNarrativeEffects(parseNarrativeEffects(entry.effectsJson), initialVariables)
  const completed = entry.kind === 'ending'
  const choiceEvaluations = completed
    ? []
    : evaluateNarrativeChoices({
        ...variables,
        __visitedNodeKeys: [entry.key],
        __selectedChoiceKeys: [],
      }, entry.key, definition.choices)
  return {
    schema: 'storyforge.simulation-narrative',
    version: 2,
    moduleKind: definition.moduleKind,
    moduleTitle: definition.moduleTitle,
    sourceHash: definition.sourceHash,
    contentHash: definition.contentHash,
    nodes: structuredClone(definition.nodes),
    beats: structuredClone(definition.beats),
    choices: structuredClone(definition.choices),
    currentNodeKey: entry.key,
    visitedNodeKeys: [entry.key],
    availableNodeKeys: [...new Set(choiceEvaluations
      .filter(choice => choice.available)
      .map(choice => choice.targetNodeKey))],
    visibleChoiceKeys: choiceEvaluations.filter(choice => choice.visible).map(choice => choice.choiceKey),
    availableChoiceKeys: choiceEvaluations.filter(choice => choice.available).map(choice => choice.choiceKey),
    choiceHistory: [],
    variables,
    completed,
    endingKey: completed ? entry.key : null,
    completedAtSequence: completed ? 0 : null,
    lastEnteredNodeSequence: null,
  }
}

function productOwnedCanonSnapshot(input: {
  runtimePackage: GameRuntimePackageV2
  runtimeSourceHash: string
}): Record<string, unknown> {
  return {
    schema: 'storyforge.product-runtime-source',
    version: 1,
    productType: input.runtimePackage.productType,
    runtimeSourceHash: input.runtimeSourceHash,
    sourceWorldContentHash: input.runtimePackage.sourceWorld.contentHash,
  }
}

function createProductInitialState(input: {
  runtimePackage: GameRuntimePackageV2
  runtimeSourceHash: string
}): SimulationRuntimeState {
  const gamePackage = input.runtimePackage
  let state = structuredClone(EMPTY_SIMULATION_STATE)
  const definition = gameReleaseNarrativeDefinition(
    input.runtimeSourceHash,
    gamePackage,
  )
  state.narrative = initialNarrativeState(definition)

  if (gamePackage.productType === 'character-interaction') {
    state.interaction = createInitialInteractionState({
      playerKey: gamePackage.interaction!.playerKey,
      profiles: gamePackage.interaction!.profiles,
      sceneTemplates: gamePackage.interaction!.sceneTemplates,
    })
  }
  if (gamePackage.productType === 'text-adventure') {
    state.interaction = createInitialInteractionState({
      playerKey: gamePackage.interaction!.playerKey,
      profiles: gamePackage.interaction!.profiles,
      sceneTemplates: gamePackage.interaction!.sceneTemplates,
    })
    state.adventure = createInitialAdventureState(gamePackage.adventure!, input.runtimeSourceHash)
    state = withAdventureNarrativeProjection(state)
  }
  if (gamePackage.productType === 'avg') {
    state.presentation = createInitialAvgPresentationState({
      contentHash: input.runtimeSourceHash,
      assets: gamePackage.presentation!.assets,
      content: gamePackage.presentation!,
      entryNodeKey: gamePackage.narrative.entryNodeKey,
    })
  }
  if (gamePackage.productType === 'narrative-simulation') {
    state.narrativeSimulation = createInitialNarrativeSimulationState(
      gamePackage.simulation!,
      input.runtimeSourceHash,
    )
    state = withNarrativeSimulationProjection(state)
  }
  if (gamePackage.productType === 'text-open-world') {
    state.interaction = createInitialInteractionState({
      playerKey: gamePackage.interaction!.playerKey,
      profiles: gamePackage.interaction!.profiles,
      sceneTemplates: gamePackage.interaction!.sceneTemplates,
    })
    state.adventure = createInitialAdventureState(gamePackage.adventure!, input.runtimeSourceHash)
    state.narrativeSimulation = createInitialNarrativeSimulationState(
      gamePackage.simulation!,
      input.runtimeSourceHash,
    )
    state.openWorld = createInitialOpenWorldState(gamePackage.openWorld!, input.runtimeSourceHash)
    state = withAdventureNarrativeProjection(state)
    state = withNarrativeSimulationProjection(state)
    state = withOpenWorldNarrativeProjection(state)
  }
  if (gamePackage.productType === 'ttrpg') {
    state = createInitialTtrpgProductStateV1({
      initialState: state,
      content: gamePackage.ttrpg!,
    })
  }
  return state
}

async function addInitialNarrativeEvents(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  session: SimulationSession
  state: SimulationRuntimeState
}): Promise<void> {
  const narrative = input.state.narrative
  if (narrative?.version !== 2) return
  const entryNodeKey = narrative.currentNodeKey
  if (!entryNodeKey) throw new Error('[instance] 产品叙事初始节点缺失')
  let projected = structuredClone(input.state)
  const started = {
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    sessionId: input.session.id!,
    sequence: 1,
    type: 'narrative.started' as const,
    actorKey: null,
    targetKey: entryNodeKey,
    payloadJson: JSON.stringify({
      entryNodeKey,
      contentHash: narrative.contentHash,
    }),
    createdAt: input.session.createdAt,
  }
  projected = applySimulationEvent(projected, started)
  const entered = {
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    sessionId: input.session.id!,
    sequence: 2,
    type: 'narrative.node.entered' as const,
    actorKey: null,
    targetKey: entryNodeKey,
    payloadJson: JSON.stringify({
      nodeKey: entryNodeKey,
      causeSequence: 1,
    }),
    createdAt: input.session.createdAt,
  }
  projected = applySimulationEvent(projected, entered)
  await db.simulationEvents.bulkAdd([started, entered])
  if (projected.narrative?.completed) {
    const ending = {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      sessionId: input.session.id!,
      sequence: 3,
      type: 'narrative.ending.reached' as const,
      actorKey: null,
      targetKey: entryNodeKey,
      payloadJson: JSON.stringify({
        endingKey: entryNodeKey,
        enteredSequence: 2,
      }),
      createdAt: input.session.createdAt,
    }
    await db.simulationEvents.add(ending)
  }
}

export async function createWorldInstance(
  input: CreateWorldInstanceInput,
): Promise<SimulationSession> {
  const scope = await resolveScope({ scope: input.scope })
  if (!isFormalProductSessionKindV1(input.kind)) {
    throw new Error('[instance] 此入口只创建上层产品实例；Sandbox 使用独立模拟入口')
  }
  if (!input.gameSource || (input.gameSource.kind !== 'release' && input.gameSource.kind !== 'build')) {
    throw new Error('[instance] 正式产品实例必须且只能绑定一个 Product Release/Build')
  }
  const playable = await verifyPlayableGamePackageSource({
    scope,
    source: input.gameSource,
  })
  const gamePackage = playable.runtimePackage
  const expectedKind = sessionKindForProduct(gamePackage.productType)
  if (input.kind !== expectedKind) {
    throw new Error(`[instance] ${gamePackage.productType} 必须创建 ${expectedKind} 会话`)
  }

  const gameRelease = input.gameSource.kind === 'release'
    ? await assertGameReleaseUnchanged(input.gameSource.gameReleaseId)
    : null
  const gameBuild = input.gameSource.kind === 'build'
    ? await db.gameBuilds.get(input.gameSource.gameBuildId)
    : null
  if (input.gameSource.kind === 'build' && !gameBuild) throw new Error('[instance] 产品 Build 不存在')

  const continuation = input.ttrpgContinuation ?? null
  if (continuation && (
    input.kind !== 'ttrpg'
    || input.gameSource.kind !== 'release'
    || gamePackage.productType !== 'ttrpg'
  )) {
    throw new Error('[instance] 跨发布续团只能创建绑定正式产品发布的 TTRPG Instance')
  }
  const continuationParent = continuation
    ? await db.simulationSessions.get(continuation.parentSessionId) ?? null
    : null
  if (continuation && (
    !continuationParent
    || continuationParent.kind !== 'ttrpg'
    || continuationParent.status !== 'active'
    || continuationParent.projectId !== scope.projectId
    || continuationParent.worldId !== scope.worldId
    || continuationParent.workId !== scope.workId
    || continuationParent.gameReleaseId == null
  )) {
    throw new Error('[instance] 跨发布续团父 Instance 不存在、已结束或不在同一 Work')
  }
  const continuationParentState = continuationParent
    ? await readSimulationState(continuationParent.id!)
    : null
  const continuationParentStateHash = continuationParentState
    ? await hashSimulationRuntimeStateV1(continuationParentState)
    : null
  if (continuation && continuationParentState && (
    continuation.expectedParentSequence !== continuationParentState.lastSequence
    || continuation.expectedParentStateHash !== continuationParentStateHash
    || !/^[0-9a-f]{64}$/.test(continuation.expectedPlanHash)
  )) {
    throw new Error('[instance] 跨发布续团父状态已变化或计划哈希无效')
  }
  const continuationParentPlayable = continuationParent
    ? await verifyPlayableGamePackageSource({
        scope,
        source: { kind: 'release', gameReleaseId: continuationParent.gameReleaseId! },
      })
    : null
  if (continuationParentPlayable
    && continuationParentPlayable.runtimePackage.productType !== 'ttrpg') {
    throw new Error('[instance] 跨发布续团父产品发布不是 TTRPG')
  }

  let initialState = createProductInitialState({
    runtimePackage: gamePackage,
    runtimeSourceHash: playable.runtimeSourceHash,
  })
  if (
    continuation
    && continuationParent
    && continuationParentState
    && continuationParentPlayable?.runtimePackage.ttrpg
  ) {
    const parentRulePack = parseRulePackV1(
      continuationParentPlayable.runtimePackage.ttrpg.rulePack.content,
    )
    const parentCampaign = parseTtrpgCampaignContentV1(
      continuationParentPlayable.runtimePackage.ttrpg.campaign,
      parentRulePack,
    )
    const targetRulePack = parseRulePackV1(gamePackage.ttrpg!.rulePack.content)
    const targetCampaign = parseTtrpgCampaignContentV1(
      gamePackage.ttrpg!.campaign,
      targetRulePack,
    )
    const migrated = await buildTtrpgContinuationStateV2({
      parentSessionId: continuationParent.id!,
      parentSequence: continuation.expectedParentSequence,
      parentStateHash: continuation.expectedParentStateHash,
      targetGameReleaseId: gameRelease!.id!,
      parentState: continuationParentState,
      targetInitialState: initialState,
      parentRulePack,
      targetRulePack,
      parentCampaign,
      targetCampaign,
      compatibility: continuation.compatibility,
      transitionKey: continuation.transitionKey,
      approvedBy: continuation.approvedBy,
    })
    if (migrated.plan.planHash !== continuation.expectedPlanHash) {
      throw new Error('[instance] 跨发布续团计划已变化，请重新预览并确认')
    }
    initialState = migrated.state
  }

  const sessionInput: CreateSimulationSessionInput = {
    projectId: scope.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: productOwnedCanonSnapshot({
      runtimePackage: gamePackage,
      runtimeSourceHash: playable.runtimeSourceHash,
    }),
    initialState,
  }

  return db.transaction('rw', scopeTransactionTables(
    db.worldGroups,
    db.simulationSessions,
    db.ttrpgSessionParticipants,
    db.gameReleases,
    db.gameProductions,
    db.gameProductionBriefs,
    db.gameBuilds,
    db.simulationEvents,
  ), async () => {
    const currentScope = await resolveScope({ scope })
    if (continuation && continuationParent) {
      const currentParent = await db.simulationSessions.get(continuationParent.id!)
      const parentEvents = await db.simulationEvents
        .where('sessionId').equals(continuationParent.id!).sortBy('sequence')
      const currentSequence = parentEvents[parentEvents.length - 1]?.sequence ?? 0
      if (
        !currentParent
        || currentParent.status !== 'active'
        || currentParent.updatedAt !== continuationParent.updatedAt
        || currentParent.gameReleaseId !== continuationParent.gameReleaseId
        || currentSequence !== continuation.expectedParentSequence
      ) {
        throw new Error('[instance] 父战役在续团创建期间发生变化')
      }
    }
    if (gameRelease) {
      const current = await db.gameReleases.get(gameRelease.id!)
      if (!current
        || current.manifestJson !== gameRelease.manifestJson
        || current.contentHash !== gameRelease.contentHash) {
        throw new Error('[instance] 产品发布在实例创建过程中发生变化')
      }
    }
    if (gameBuild && input.gameSource.kind === 'build') {
      const current = await db.gameBuilds.get(gameBuild.id!)
      if (!current
        || current.previewManifestJson !== gameBuild.previewManifestJson
        || current.previewHash !== gameBuild.previewHash
        || current.packageHash !== gameBuild.packageHash) {
        throw new Error('[instance] 产品 Build 在实例创建过程中发生变化')
      }
    }
    const session = input.gameSource.kind === 'release' && gameRelease
      ? await createReleasedGameSession({
          ...sessionInput,
          worldId: currentScope.worldId,
          workId: currentScope.workId,
          gameReleaseId: gameRelease.id!,
          origin: continuation ? 'branch' : 'release',
        })
      : input.gameSource.kind === 'build' && gameBuild
        ? await createPreviewGameSession({
            ...sessionInput,
            worldId: currentScope.worldId,
            workId: currentScope.workId,
            gameBuildId: gameBuild.id!,
            expectedPreviewHash: input.gameSource.expectedPreviewHash,
            runtimeSourceHash: playable.runtimeSourceHash,
            origin: 'preview',
          })
        : (() => { throw new Error('[instance] 不支持的产品来源') })()

    const binding = {
      parentSessionId: continuationParent?.id ?? null,
      parentThroughSequence: continuation?.expectedParentSequence ?? null,
    }
    await db.simulationSessions.update(session.id!, binding)
    const boundSession = { ...session, ...binding }
    await addInitialNarrativeEvents({
      scope: currentScope,
      worldGroupId: input.worldGroupId ?? null,
      session: boundSession,
      state: initialState,
    })
    if (gamePackage.productType === 'ttrpg') {
      await installInitialTtrpgParticipantsV2({
        session: boundSession,
        campaign: gamePackage.ttrpg!.campaign,
      })
      if (continuationParent) {
        await carryTtrpgContinuationParticipantsV2({
          parentSessionId: continuationParent.id!,
          child: boundSession,
          transitionKey: continuation!.transitionKey,
        })
      }
    }
    return boundSession
  })
}

/** Unified launch boundary for Build Preview and formal Product Release. */
export async function createPlayableGameInstance(input: {
  scope: WorkspaceScope
  source: PlayableGameSourceV1
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  const playable = await verifyPlayableGamePackageSource({
    scope: input.scope,
    source: input.source,
  })
  return createWorldInstance({
    scope: input.scope,
    gameSource: input.source,
    kind: sessionKindForProduct(playable.runtimePackage.productType),
    title: input.title,
    worldGroupId: input.worldGroupId,
    seed: input.seed,
  })
}

export async function createContinuedTtrpgGameInstanceV2(input: {
  scope: WorkspaceScope
  targetGameReleaseId: number
  title: string
  continuation: TtrpgContinuationRequestV2
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({
    scope: input.scope,
    kind: 'ttrpg',
    title: input.title,
    gameSource: { kind: 'release', gameReleaseId: input.targetGameReleaseId },
    worldGroupId: input.worldGroupId,
    seed: input.seed,
    ttrpgContinuation: input.continuation,
  })
}

function releaseSource(gameReleaseId: number): PlayableGameSourceV1 {
  return { kind: 'release', gameReleaseId }
}

export async function createStoryGameInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'storygame', gameSource: releaseSource(input.gameReleaseId) })
}

export async function createInteractionGameInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'chatgame', gameSource: releaseSource(input.gameReleaseId) })
}

export async function createTextAdventureInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'textadventure', gameSource: releaseSource(input.gameReleaseId) })
}

export async function createAvgGameInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'avg', gameSource: releaseSource(input.gameReleaseId) })
}

export async function createNarrativeSimulationInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'textsimulation', gameSource: releaseSource(input.gameReleaseId) })
}

export async function createTextOpenWorldInstance(input: {
  scope: WorkspaceScope
  gameReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: 'textworld', gameSource: releaseSource(input.gameReleaseId) })
}

export async function readBoundInstances(scope: WorkspaceScope): Promise<SimulationSession[]> {
  const resolved = await resolveScope({ scope })
  const rows = await db.simulationSessions.where('projectId').equals(resolved.projectId).toArray()
  return rows.filter(row => row.worldId === resolved.worldId && row.workId === resolved.workId)
}

export async function assertInstanceBinding(
  instanceId: number,
  scope: WorkspaceScope,
): Promise<SimulationSession> {
  const resolved = await resolveScope({ scope })
  const session = await db.simulationSessions.get(instanceId)
  if (!session
    || session.projectId !== resolved.projectId
    || session.worldId !== resolved.worldId
    || session.workId !== resolved.workId) {
    throw new Error('[instance] 实例不属于当前 World/Work')
  }
  const initialState = JSON.parse(session.initialStateJson) as SimulationRuntimeState
  const sources = [
    session.gameReleaseId != null,
    session.gameBuildId != null,
  ].filter(Boolean).length
  if (isFormalProductSessionKindV1(session.kind) && sources !== 1) {
    throw new Error('[instance] 正式产品实例必须且只能绑定一个 Product Release/Build')
  }
  if (session.gameReleaseId != null) {
    const verified = await verifyPlayableGamePackageSource({
      scope: resolved,
      source: { kind: 'release', gameReleaseId: session.gameReleaseId },
    })
    if (verified.runtimeSourceHash !== session.runtimeSourceHash
      || initialState.narrative?.version !== 2
      || initialState.narrative.contentHash !== verified.runtimeSourceHash) {
      throw new Error('[instance] 产品发布来源越界或 RuntimePackage 已变化')
    }
  }
  if (session.gameBuildId != null) {
    const build = await db.gameBuilds.get(session.gameBuildId)
    if (!build?.previewHash || !session.runtimeSourceHash) {
      throw new Error('[instance] 产品 Build 绑定缺失')
    }
    const verified = await verifyPlayableGamePackageSource({
      scope: resolved,
      source: {
        kind: 'build',
        gameBuildId: build.id!,
        expectedPreviewHash: build.previewHash,
      },
    })
    if (verified.runtimeSourceHash !== session.runtimeSourceHash
      || initialState.narrative?.version !== 2
      || initialState.narrative.contentHash !== verified.runtimeSourceHash) {
      throw new Error('[instance] 产品 Build 来源越界或 RuntimePackage 已变化')
    }
  }
  return session
}
