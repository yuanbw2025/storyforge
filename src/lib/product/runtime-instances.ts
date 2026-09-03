import { db } from '../db/schema'
import {
  applyProductRuntimeEvent,
  insertPreparedProductRuntimeSessionV1,
  hashProductRuntimeStateV1,
  preparePreviewProductRuntimeSessionRecordV1,
  prepareReleasedProductRuntimeSessionRecordV1,
  readProductRuntimeState,
  type CreateProductRuntimeSessionInput,
} from './runtime-core'
import {
  withAdventureNarrativeProjectionV1,
  withOpenWorldEvolutionProjectionV1,
  withOpenWorldNarrativeProjectionV1,
} from './runtime-product-adapters'
import {
  EMPTY_PRODUCT_RUNTIME_STATE,
  type FrozenNarrativeBeat,
  type FrozenNarrativeChoice,
  type ProductRuntimePackageV1,
  type ProductRuntimeSourceV1,
  type ProductNarrativeRuntimeNodeSnapshot,
  type ProductNarrativeRuntimeState,
  type ProductRuntimeState,
  type ProductRuntimeSession,
  type ProductRuntimeKind,
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
import { evaluateNarrativeChoices } from './narrative-content'
import { assertProductReleaseUnchanged } from './releases'
import { createInitialAvgPresentationState } from '../avg/runtime'
import { createInitialOpenWorldEvolutionState } from '../open-world/evolution-runtime'
import { createInitialOpenWorldState } from '../open-world/runtime'
import { createInitialTtrpgProductStateV1 } from '../ttrpg/runtime'
import { verifyProductRuntimeSource } from '../product-production/preview-source'
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
import { resolveScope, scopeTransactionTables } from '../workspace/scope'

/**
 * Sole upper-product runtime entry.
 *
 * A WorldRelease is production input, never an executable source. Callers must
 * provide an immutable ProductRelease or a governed product Build.
 */
export interface CreateProductRuntimeInstanceInput {
  scope: WorkspaceScope
  kind: ProductRuntimeKind
  title: string
  productSource: ProductRuntimeSourceV1
  worldGroupId?: number | null
  seed?: string
  ttrpgContinuation?: TtrpgContinuationRequestV2
}

interface FrozenNarrativeDefinition {
  version: 2
  moduleKind: ProductRuntimePackageV1['narrative']['moduleKind']
  moduleTitle: string
  entryNodeKey: string
  nodes: ProductNarrativeRuntimeNodeSnapshot[]
  sourceHash: string
  contentHash: string
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
  initialVariables: Record<string, unknown>
}

function productReleaseNarrativeDefinition(
  runtimeSourceHash: string,
  runtimePackage: ProductRuntimePackageV1,
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
  productType: ProductRuntimePackageV1['productType'],
): ProductRuntimeKind {
  return productType
}

function initialNarrativeState(
  definition: FrozenNarrativeDefinition,
): ProductNarrativeRuntimeState {
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
    schema: 'storyforge.product-narrative-runtime',
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
  runtimePackage: ProductRuntimePackageV1
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
  runtimePackage: ProductRuntimePackageV1
  runtimeSourceHash: string
}): ProductRuntimeState {
  const runtimePackage = input.runtimePackage
  let state = structuredClone(EMPTY_PRODUCT_RUNTIME_STATE)
  const definition = productReleaseNarrativeDefinition(
    input.runtimeSourceHash,
    runtimePackage,
  )
  state.narrative = initialNarrativeState(definition)

  if (runtimePackage.productType === 'character-interaction') {
    state.interaction = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    })
  }
  if (runtimePackage.productType === 'text-adventure') {
    state.interaction = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    })
    state.adventure = createInitialAdventureState(runtimePackage.adventure!, input.runtimeSourceHash)
    state = withAdventureNarrativeProjectionV1(state)
  }
  if (runtimePackage.productType === 'avg') {
    state.presentation = createInitialAvgPresentationState({
      contentHash: input.runtimeSourceHash,
      assets: runtimePackage.presentation!.assets,
      content: runtimePackage.presentation!,
      entryNodeKey: runtimePackage.narrative.entryNodeKey,
    })
  }
  if (runtimePackage.productType === 'text-open-world') {
    state.interaction = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    })
    state.adventure = createInitialAdventureState(runtimePackage.adventure!, input.runtimeSourceHash)
    state.openWorldEvolution = createInitialOpenWorldEvolutionState(
      runtimePackage.openWorldEvolution!,
      input.runtimeSourceHash,
    )
    state.openWorld = createInitialOpenWorldState(runtimePackage.openWorld!, input.runtimeSourceHash)
    state = withAdventureNarrativeProjectionV1(state)
    state = withOpenWorldEvolutionProjectionV1(state)
    state = withOpenWorldNarrativeProjectionV1(state)
  }
  if (runtimePackage.productType === 'ttrpg') {
    state = createInitialTtrpgProductStateV1({
      initialState: state,
      content: runtimePackage.ttrpg!,
    })
  }
  return state
}

async function addInitialNarrativeEvents(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  session: ProductRuntimeSession
  state: ProductRuntimeState
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
  projected = applyProductRuntimeEvent(projected, started)
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
  projected = applyProductRuntimeEvent(projected, entered)
  await db.productRuntimeEvents.bulkAdd([started, entered])
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
    await db.productRuntimeEvents.add(ending)
  }
}

export async function createProductRuntimeInstance(
  input: CreateProductRuntimeInstanceInput,
): Promise<ProductRuntimeSession> {
  const scope = await resolveScope({ scope: input.scope })
  if (!isFormalProductSessionKindV1(input.kind)) {
    throw new Error('[instance] 此入口只创建上层产品实例；Sandbox 使用独立测试入口')
  }
  if (!input.productSource || (input.productSource.kind !== 'release' && input.productSource.kind !== 'build')) {
    throw new Error('[instance] 正式产品实例必须且只能绑定一个 Product Release/Build')
  }
  const playable = await verifyProductRuntimeSource({
    scope,
    source: input.productSource,
  })
  const runtimePackage = playable.runtimePackage
  const expectedKind = sessionKindForProduct(runtimePackage.productType)
  if (input.kind !== expectedKind) {
    throw new Error(`[instance] ${runtimePackage.productType} 必须创建 ${expectedKind} 会话`)
  }

  const productRelease = input.productSource.kind === 'release'
    ? await assertProductReleaseUnchanged(input.productSource.productReleaseId)
    : null
  const productBuild = input.productSource.kind === 'build'
    ? await db.productBuilds.get(input.productSource.productBuildId)
    : null
  if (input.productSource.kind === 'build' && !productBuild) throw new Error('[instance] 产品 Build 不存在')

  const continuation = input.ttrpgContinuation ?? null
  if (continuation && (
    input.kind !== 'ttrpg'
    || input.productSource.kind !== 'release'
    || runtimePackage.productType !== 'ttrpg'
  )) {
    throw new Error('[instance] 跨发布续团只能创建绑定正式产品发布的 TTRPG Instance')
  }
  const continuationParent = continuation
    ? await db.productRuntimeSessions.get(continuation.parentSessionId) ?? null
    : null
  if (continuation && (
    !continuationParent
    || continuationParent.kind !== 'ttrpg'
    || continuationParent.status !== 'active'
    || continuationParent.projectId !== scope.projectId
    || continuationParent.worldId !== scope.worldId
    || continuationParent.workId !== scope.workId
    || continuationParent.productReleaseId == null
  )) {
    throw new Error('[instance] 跨发布续团父 Instance 不存在、已结束或不在同一 Work')
  }
  const continuationParentState = continuationParent
    ? await readProductRuntimeState(continuationParent.id!)
    : null
  const continuationParentStateHash = continuationParentState
    ? await hashProductRuntimeStateV1(continuationParentState)
    : null
  if (continuation && continuationParentState && (
    continuation.expectedParentSequence !== continuationParentState.lastSequence
    || continuation.expectedParentStateHash !== continuationParentStateHash
    || !/^[0-9a-f]{64}$/.test(continuation.expectedPlanHash)
  )) {
    throw new Error('[instance] 跨发布续团父状态已变化或计划哈希无效')
  }
  const continuationParentPlayable = continuationParent
    ? await verifyProductRuntimeSource({
        scope,
        source: { kind: 'release', productReleaseId: continuationParent.productReleaseId! },
      })
    : null
  if (continuationParentPlayable
    && continuationParentPlayable.runtimePackage.productType !== 'ttrpg') {
    throw new Error('[instance] 跨发布续团父产品发布不是 TTRPG')
  }

  let initialState = createProductInitialState({
    runtimePackage: runtimePackage,
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
    const targetRulePack = parseRulePackV1(runtimePackage.ttrpg!.rulePack.content)
    const targetCampaign = parseTtrpgCampaignContentV1(
      runtimePackage.ttrpg!.campaign,
      targetRulePack,
    )
    const migrated = await buildTtrpgContinuationStateV2({
      parentSessionId: continuationParent.id!,
      parentSequence: continuation.expectedParentSequence,
      parentStateHash: continuation.expectedParentStateHash,
      targetProductReleaseId: productRelease!.id!,
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

  const sessionInput: CreateProductRuntimeSessionInput = {
    projectId: scope.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: productOwnedCanonSnapshot({
      runtimePackage: runtimePackage,
      runtimeSourceHash: playable.runtimeSourceHash,
    }),
    initialState,
  }
  // Cryptographic Release/Build and initial-state validation must finish before
  // the atomic commit transaction; the transaction only repeats row-level CAS,
  // inserts the prepared session and appends its initial events.
  const preparedSession = input.productSource.kind === 'release' && productRelease
    ? await prepareReleasedProductRuntimeSessionRecordV1({
        ...sessionInput,
        worldId: scope.worldId,
        workId: scope.workId,
        productReleaseId: productRelease.id!,
        origin: continuation ? 'branch' : 'release',
      })
    : input.productSource.kind === 'build' && productBuild
      ? await preparePreviewProductRuntimeSessionRecordV1({
          ...sessionInput,
          worldId: scope.worldId,
          workId: scope.workId,
          productBuildId: productBuild.id!,
          expectedPreviewHash: input.productSource.expectedPreviewHash,
          runtimeSourceHash: playable.runtimeSourceHash,
          origin: 'preview',
        })
      : (() => { throw new Error('[instance] 不支持的产品来源') })()

  return db.transaction('rw', scopeTransactionTables(
    db.productRuntimeSessions,
    db.ttrpgSessionParticipants,
    db.productReleases,
    db.productProductions,
    db.productProductionBriefs,
    db.productBuilds,
    db.productRuntimeEvents,
  ), async () => {
    const currentScope = await resolveScope({ scope })
    if (continuation && continuationParent) {
      const currentParent = await db.productRuntimeSessions.get(continuationParent.id!)
      const parentEvents = await db.productRuntimeEvents
        .where('sessionId').equals(continuationParent.id!).sortBy('sequence')
      const currentSequence = parentEvents[parentEvents.length - 1]?.sequence ?? 0
      if (
        !currentParent
        || currentParent.status !== 'active'
        || currentParent.updatedAt !== continuationParent.updatedAt
        || currentParent.productReleaseId !== continuationParent.productReleaseId
        || currentSequence !== continuation.expectedParentSequence
      ) {
        throw new Error('[instance] 父战役在续团创建期间发生变化')
      }
    }
    if (productRelease) {
      const current = await db.productReleases.get(productRelease.id!)
      if (!current
        || current.manifestJson !== productRelease.manifestJson
        || current.contentHash !== productRelease.contentHash) {
        throw new Error('[instance] 产品发布在实例创建过程中发生变化')
      }
    }
    if (productBuild && input.productSource.kind === 'build') {
      const current = await db.productBuilds.get(productBuild.id!)
      if (!current
        || current.previewManifestJson !== productBuild.previewManifestJson
        || current.previewHash !== productBuild.previewHash
        || current.packageHash !== productBuild.packageHash) {
        throw new Error('[instance] 产品 Build 在实例创建过程中发生变化')
      }
    }
    const session = await insertPreparedProductRuntimeSessionV1(preparedSession)

    const binding = {
      parentSessionId: continuationParent?.id ?? null,
      parentThroughSequence: continuation?.expectedParentSequence ?? null,
    }
    await db.productRuntimeSessions.update(session.id!, binding)
    const boundSession = { ...session, ...binding }
    await addInitialNarrativeEvents({
      scope: currentScope,
      worldGroupId: input.worldGroupId ?? null,
      session: boundSession,
      state: initialState,
    })
    if (runtimePackage.productType === 'ttrpg') {
      await installInitialTtrpgParticipantsV2({
        session: boundSession,
        campaign: runtimePackage.ttrpg!.campaign,
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
export async function createProductRuntimeInstanceFromSource(input: {
  scope: WorkspaceScope
  source: ProductRuntimeSourceV1
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<ProductRuntimeSession> {
  const playable = await verifyProductRuntimeSource({
    scope: input.scope,
    source: input.source,
  })
  return createProductRuntimeInstance({
    scope: input.scope,
    productSource: input.source,
    kind: sessionKindForProduct(playable.runtimePackage.productType),
    title: input.title,
    worldGroupId: input.worldGroupId,
    seed: input.seed,
  })
}

export async function createContinuedTtrpgRuntimeInstanceV2(input: {
  scope: WorkspaceScope
  targetProductReleaseId: number
  title: string
  continuation: TtrpgContinuationRequestV2
  worldGroupId?: number | null
  seed?: string
}): Promise<ProductRuntimeSession> {
  return createProductRuntimeInstance({
    scope: input.scope,
    kind: 'ttrpg',
    title: input.title,
    productSource: { kind: 'release', productReleaseId: input.targetProductReleaseId },
    worldGroupId: input.worldGroupId,
    seed: input.seed,
    ttrpgContinuation: input.continuation,
  })
}

function releaseSource(productReleaseId: number): ProductRuntimeSourceV1 {
  return { kind: 'release', productReleaseId }
}

export async function createCharacterInteractionInstance(input: {
  scope: WorkspaceScope
  productReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<ProductRuntimeSession> {
  return createProductRuntimeInstance({ ...input, kind: 'character-interaction', productSource: releaseSource(input.productReleaseId) })
}

export async function createTextAdventureInstance(input: {
  scope: WorkspaceScope
  productReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<ProductRuntimeSession> {
  return createProductRuntimeInstance({ ...input, kind: 'text-adventure', productSource: releaseSource(input.productReleaseId) })
}

export async function createAvgGameInstance(input: {
  scope: WorkspaceScope
  productReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<ProductRuntimeSession> {
  return createProductRuntimeInstance({ ...input, kind: 'avg', productSource: releaseSource(input.productReleaseId) })
}

export async function createTextOpenWorldInstance(input: {
  scope: WorkspaceScope
  productReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<ProductRuntimeSession> {
  return createProductRuntimeInstance({ ...input, kind: 'text-open-world', productSource: releaseSource(input.productReleaseId) })
}

export async function readBoundInstances(scope: WorkspaceScope): Promise<ProductRuntimeSession[]> {
  const resolved = await resolveScope({ scope })
  const rows = await db.productRuntimeSessions.where('projectId').equals(resolved.projectId).toArray()
  return rows.filter(row => row.worldId === resolved.worldId && row.workId === resolved.workId)
}

export async function assertInstanceBinding(
  instanceId: number,
  scope: WorkspaceScope,
): Promise<ProductRuntimeSession> {
  const resolved = await resolveScope({ scope })
  const session = await db.productRuntimeSessions.get(instanceId)
  if (!session
    || session.projectId !== resolved.projectId
    || session.worldId !== resolved.worldId
    || session.workId !== resolved.workId) {
    throw new Error('[instance] 实例不属于当前 World/Work')
  }
  const initialState = JSON.parse(session.initialStateJson) as ProductRuntimeState
  const sources = [
    session.productReleaseId != null,
    session.productBuildId != null,
  ].filter(Boolean).length
  if (isFormalProductSessionKindV1(session.kind) && sources !== 1) {
    throw new Error('[instance] 正式产品实例必须且只能绑定一个 Product Release/Build')
  }
  if (session.productReleaseId != null) {
    const verified = await verifyProductRuntimeSource({
      scope: resolved,
      source: { kind: 'release', productReleaseId: session.productReleaseId },
    })
    if (verified.runtimeSourceHash !== session.runtimeSourceHash
      || initialState.narrative?.version !== 2
      || initialState.narrative.contentHash !== verified.runtimeSourceHash) {
      throw new Error('[instance] 产品发布来源越界或 RuntimePackage 已变化')
    }
  }
  if (session.productBuildId != null) {
    const build = await db.productBuilds.get(session.productBuildId)
    if (!build?.previewHash || !session.runtimeSourceHash) {
      throw new Error('[instance] 产品 Build 绑定缺失')
    }
    const verified = await verifyProductRuntimeSource({
      scope: resolved,
      source: {
        kind: 'build',
        productBuildId: build.id!,
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
