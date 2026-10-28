import { createAvgReadingStateV1 } from '../avg/reading-runtime'
import { cloneTtrpgRuntimePreservedExtensionsV1 } from '../ttrpg/runtime-branch'
import { runtimeInstanceTablesV1, transactionTablesForReferenceCascade } from '../registry/lifecycle'
import { buildTtrpgOpenReleaseContinuationV1, isTtrpgOpenContinuationRequestV1, type TtrpgOpenContinuationRequestV1 } from '../ttrpg/open-release-continuation'
import { parseTtrpgRuntimeStateV2 } from '../ttrpg/open-runtime-contract'
import { assertTtrpgOpenAuthorizationCurrentV1 } from '../ttrpg/open-authorization'
import { readTtrpgSessionParticipantsV2 } from '../ttrpg/participants'
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
  type AnyProductRuntimePackage,
  type ProductRuntimeSourceV1,
  type ProductNarrativeRuntimeNodeSnapshot,
  type ProductNarrativeRuntimeState,
  type ProductRuntimeState,
  type ProductRuntimeSession,
  type ProductRuntimeEvent,
  type ProductRuntimeKind,
  type WorkspaceScope,
} from '../types'
import {
  isTtrpgRuntimeContentV1,
  isTtrpgRuntimeContentV2,
  type ProductRuntimePackageWithTtrpgV2,
} from '../ttrpg/content-version'
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
import { avgExecutableModule, avgRuntimeStage } from '../avg/executable-module'
import { previewAvgSystemEffectsV1 } from '../avg/system-state'
import { createInitialOpenWorldEvolutionState } from '../open-world/evolution-runtime'
import { createInitialOpenWorldState } from '../open-world/runtime'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../open-world/session-projection'
import {
  createInitialTtrpgOpenProductStateV1,
  createInitialTtrpgProductStateV1,
} from '../ttrpg/runtime'
import { createInitialAiTownStateV1 } from '../ai-town/runtime'
import { verifyProductRuntimeSource } from '../product-production/preview-source'
import {
  carryTtrpgContinuationParticipantsV2,
  installInitialTtrpgParticipantsV2,
} from '../ttrpg/participants'
import { parseRulePackV1 } from '../ttrpg/rule-pack'
import {
  parseRulePackV2,
  projectTtrpgRulePackMechanicalCoreV1,
} from '../ttrpg/rule-pack-v2'
import { parseTtrpgCampaignContentV1 } from '../ttrpg/campaign'
import {
  buildTtrpgContinuationStateV2,
  type TtrpgContinuationRequestV2,
} from '../ttrpg/continuity-state'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import {createChatReleaseUpgradeInitialStateV1} from '../character-interaction/release-upgrade-branch'
import {
  prepareChatReleaseUpgradeV1,
  assertChatReleaseUpgradeUnchangedV1,
  readCompletedChatReleaseUpgradeV1,
  type ChatReleaseUpgradeRequestV1,
} from '../character-interaction/release-upgrade-plan'

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
  ttrpgContinuation?: TtrpgContinuationRequestV2 | TtrpgOpenContinuationRequestV1
  chatReleaseUpgrade?: ChatReleaseUpgradeRequestV1
}

interface FrozenNarrativeDefinition {
  version: 2
  moduleKind: AnyProductRuntimePackage['narrative']['moduleKind']
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
  runtimePackage: AnyProductRuntimePackage,
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
  productType: AnyProductRuntimePackage['productType'],
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

export function createProductRuntimeCanonSnapshotV1(input: {
  runtimePackage: AnyProductRuntimePackage
  runtimeSourceHash: string
}): Record<string, unknown> {
  return {
    schema: 'storyforge.product-runtime-source',
    version: 1,
    ...(input.runtimePackage.version === 2 ? { packageVersion: 2 } : {}),
    productType: input.runtimePackage.productType,
    runtimeSourceHash: input.runtimeSourceHash,
    sourceWorldContentHash: input.runtimePackage.sourceWorld.contentHash,
  }
}

export function createProductInitialStateV1(input: {
  runtimePackage: AnyProductRuntimePackage
  runtimeSourceHash: string
  ttrpgSessionKey?: string
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
      chatSource: runtimePackage.interaction!.chatSource,
      chatNarrative: runtimePackage.interaction!.chatNarrative,
    })
  }
  if (runtimePackage.productType === 'ai-town') {
    state.interaction = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    })
    state.town = createInitialAiTownStateV1(
      runtimePackage.town!,
      input.runtimeSourceHash,
    )
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
    const module = avgExecutableModule(runtimePackage)
    if (module) {
      state.avgRules = { schema: 'storyforge.avg.rules-state', version: 1, systemPlan: structuredClone(module.systemPlan) }
      if (module.reading) state.avgReading = createAvgReadingStateV1(module)
      const entry = module.systemPlan.scenes.find(scene => scene.key === module.systemPlan.entrySceneKey)!
      previewAvgSystemEffectsV1(module.systemPlan, runtimePackage.definition.initialVariables, entry.onEnter)
    }
    state.presentation = createInitialAvgPresentationState({
      contentHash: input.runtimeSourceHash,
      assets: avgRuntimeStage(runtimePackage)!.assets,
      content: avgRuntimeStage(runtimePackage)!,
      entryNodeKey: runtimePackage.narrative.entryNodeKey,
    })
  }
  if (runtimePackage.productType === 'text-open-world') {
    const hasLegacyRuntime = runtimePackage.interaction != null
      && runtimePackage.adventure != null
      && runtimePackage.openWorldEvolution != null
      && runtimePackage.openWorld != null
    if (runtimePackage.textOpenWorldVNext) {
      state.textOpenWorld = createInitialTextOpenWorldSessionProjectionV1(
        runtimePackage.textOpenWorldVNext,
      )
    }
    if (hasLegacyRuntime) {
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
  }
  if (runtimePackage.productType === 'ttrpg') {
    if (!runtimePackage.ttrpg) throw new Error('[instance] TTRPG runtime content 缺失')
    if (isTtrpgRuntimeContentV2(runtimePackage.ttrpg)) {
      const rulePack = parseRulePackV2(runtimePackage.ttrpg.rulePack.content)
      state = createInitialTtrpgOpenProductStateV1({
        initialState: state,
        content: runtimePackage.ttrpg,
        mechanicalRulePack: projectTtrpgRulePackMechanicalCoreV1(rulePack),
        sessionKey: input.ttrpgSessionKey ?? `ttrpg.${crypto.randomUUID()}`,
      })
    } else if (isTtrpgRuntimeContentV1(runtimePackage.ttrpg)) {
      state = createInitialTtrpgProductStateV1({
        initialState: state,
        content: runtimePackage.ttrpg,
      })
    }
  }
  return state
}

async function addInitialNarrativeEvents(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  session: ProductRuntimeSession
  state: ProductRuntimeState
}): Promise<{ lastSequence: number; projectedState: ProductRuntimeState }> {
  const narrative = input.state.narrative
  if (narrative?.version !== 2) {
    return { lastSequence: input.state.lastSequence, projectedState: input.state }
  }
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
    projected = applyProductRuntimeEvent(projected, ending)
  }
  return { lastSequence: projected.lastSequence, projectedState: projected }
}

export async function createProductRuntimeInstance(
  input: CreateProductRuntimeInstanceInput,
): Promise<ProductRuntimeSession> {
  input = structuredClone(input)
  const scope = await resolveScope({ scope: input.scope })
  if (!input.productSource || (input.productSource.kind !== 'release' && input.productSource.kind !== 'build')) {
    throw new Error('[instance] 正式产品实例必须且只能绑定一个 Product Release/Build')
  }
  const playable = await verifyProductRuntimeSource({
    scope,
    source: input.productSource,
    ttrpgProtocol: input.kind === 'ttrpg' ? 2 : undefined,
  })
  const runtimePackage = playable.runtimePackage as ProductRuntimePackageWithTtrpgV2
  const expectedKind = sessionKindForProduct(runtimePackage.productType)
  if (input.kind !== expectedKind) {
    throw new Error(`[instance] ${runtimePackage.productType} 必须创建 ${expectedKind} 会话`)
  }

  const productRelease = input.productSource.kind === 'release'
    ? await assertProductReleaseUnchanged(input.productSource.productReleaseId, input.kind === 'ttrpg' ? { ttrpgProtocol: 2 } : undefined)
    : null
  const productBuild = input.productSource.kind === 'build'
    ? await db.productBuilds.get(input.productSource.productBuildId)
    : null
  if (input.productSource.kind === 'build' && !productBuild) throw new Error('[instance] 产品 Build 不存在')

  const chatRequest = input.chatReleaseUpgrade
  if (chatRequest && (input.kind !== 'character-interaction' || input.productSource.kind !== 'release'
    || chatRequest.targetReleaseId !== productRelease?.id || input.ttrpgContinuation
    || !/^[a-zA-Z0-9._:-]{1,200}$/.test(chatRequest.commandId) || !/^[a-f0-9]{64}$/.test(chatRequest.expectedPlanHash))) {
    throw new Error('[instance] 角色聊天升级请求与目标版本不一致')
  }
  if (chatRequest) {
    const completed = await readCompletedChatReleaseUpgradeV1(scope, chatRequest)
    if (completed) return assertInstanceBinding(completed.id!, scope)
  }
  const chatUpgrade = chatRequest ? await prepareChatReleaseUpgradeV1({scope,
    parentSessionId: chatRequest.parentSessionId, targetReleaseId: chatRequest.targetReleaseId}) : null
  if (chatUpgrade && (!chatUpgrade.plan.canCopy || chatUpgrade.plan.planHash !== chatRequest!.expectedPlanHash
    || chatUpgrade.plan.compatibility.targetPackageHash !== playable.runtimeSourceHash)) {
    throw new Error('[instance] 存档升级条件或预览已变化，请重新预览')
  }

  const continuation = input.ttrpgContinuation ?? null
  const openContinuation = isTtrpgOpenContinuationRequestV1(continuation) ? continuation : null
  if (continuation && (
    input.kind !== 'ttrpg'
    || input.productSource.kind !== 'release'
    || runtimePackage.productType !== 'ttrpg'
  )) {
    throw new Error('[instance] 跨发布续团只能创建绑定正式产品发布的 TTRPG Instance')
  }
  if (continuation && !openContinuation && runtimePackage.ttrpg && isTtrpgRuntimeContentV2(runtimePackage.ttrpg)) {
    throw new Error('[instance] open 跑团续团尚未进入 protocol-2 迁移路径')
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
        ttrpgProtocol: 2,
      })
    : null
  if (continuationParentPlayable
    && continuationParentPlayable.runtimePackage.productType !== 'ttrpg') {
    throw new Error('[instance] 跨发布续团父产品发布不是 TTRPG')
  }
  if (
    !openContinuation && continuationParentPlayable?.runtimePackage.ttrpg
    && isTtrpgRuntimeContentV2(continuationParentPlayable.runtimePackage.ttrpg)
  ) {
    throw new Error('[instance] open 跑团父 Instance 不能进入 scripted 续团路径')
  }

  let initialState = createProductInitialStateV1({
    runtimePackage: runtimePackage,
    runtimeSourceHash: playable.runtimeSourceHash,
  })
  if (
    continuation
    && !openContinuation
    && continuationParent
    && continuationParentState
      && continuationParentPlayable?.runtimePackage.ttrpg
      && isTtrpgRuntimeContentV1(continuationParentPlayable.runtimePackage.ttrpg)
      && runtimePackage.ttrpg
      && isTtrpgRuntimeContentV1(runtimePackage.ttrpg)
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
    const continued = await buildTtrpgContinuationStateV2({
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
    if (continued.plan.planHash !== continuation.expectedPlanHash) {
      throw new Error('[instance] 跨发布续团计划已变化，请重新预览并确认')
    }
    initialState = continued.state
  }
  if (chatUpgrade) {
    initialState = createChatReleaseUpgradeInitialStateV1(chatUpgrade.state, playable.runtimeSourceHash)
  }

  if (openContinuation) {
    if (openContinuation.compatibility !== 'compatible') throw new Error('[instance] 开放续团必须使用明确兼容计划');
    const parentContent = continuationParentPlayable?.runtimePackage.ttrpg, targetContent = runtimePackage.ttrpg;
    if (!continuationParent || !continuationParentState || !parentContent || !targetContent
      || !isTtrpgRuntimeContentV2(parentContent) || !isTtrpgRuntimeContentV2(targetContent)) throw new Error('[instance] 开放续团必须同时绑定两个协议 2 发布');
    const authorization = parseTtrpgRuntimeStateV2(continuationParentState.ttrpg)?.authorization;
    if (!authorization) throw new Error('[instance] 原团局尚无当前真人授权');
    assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants: await readTtrpgSessionParticipantsV2(continuationParent.id!), viewerKey: openContinuation.approvedBy });
    if (input.seed !== undefined && input.seed !== continuationParent.seed) throw new Error('[instance] 续团必须保留原随机种子');
    const continued = await buildTtrpgOpenReleaseContinuationV1({ parent: continuationParent, parentState: continuationParentState,
      parentStateHash: continuationParentStateHash!, events: await db.productRuntimeEvents.where('sessionId').equals(continuationParent.id!).sortBy('sequence'),
      parentContent, targetContent, targetRuntimeSourceHash: playable.runtimeSourceHash, targetInitialState: initialState,
      transitionKey: openContinuation.transitionKey, approvedBy: openContinuation.approvedBy,
      reason: openContinuation.reason, openingTemplateKeys: openContinuation.openingTemplateKeys });
    if (continued.plan.planHash !== openContinuation.expectedPlanHash) throw new Error('[instance] 续团预览已变化，请重新核对并明确确认');
    initialState = continued.state;
  }

  const sessionInput: CreateProductRuntimeSessionInput = {
    projectId: scope.projectId,
    worldGroupId: chatUpgrade ? chatUpgrade.saved.parent.worldGroupId ?? null : input.worldGroupId ?? (openContinuation ? continuationParent!.worldGroupId ?? null : null),
    kind: input.kind,
    title: input.title,
    seed: openContinuation ? continuationParent!.seed : input.seed,
    canonSnapshot: createProductRuntimeCanonSnapshotV1({
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
        origin: continuation || chatUpgrade ? 'branch' : 'release',
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

  // Precompute the new session's first receipt and projection before opening
  // the transaction. This event does not replay opening effects or dialogue.
  let upgradeEvent: Omit<ProductRuntimeEvent, 'sessionId'> | null = null
  let upgradeHead: Pick<ProductRuntimeSession, 'status' | 'runtimeHeadSequence' | 'runtimeHeadStateJson' | 'runtimeHeadStateHash'> | null = null
  if (chatUpgrade) {
    const {plan} = chatUpgrade, {compatibility} = plan
    const envelope = {commandId: chatRequest!.commandId, baseSequence: 0, baseStateHash: await hashProductRuntimeStateV1(initialState)}
    upgradeEvent = {projectId: scope.projectId, worldGroupId: preparedSession.worldGroupId,
      type: 'interaction.release.upgraded', sequence: 1, ...envelope,
      createdAt: preparedSession.createdAt, payloadJson: JSON.stringify({version: 1, policy: 'copy-preserving-story-v1',
        planHash: plan.planHash, compatibilityHash: compatibility.compatibilityHash,
        sourceReleaseHash: compatibility.sourceReleaseHash, targetReleaseHash: compatibility.targetReleaseHash,
        sourcePackageHash: compatibility.sourcePackageHash, targetPackageHash: compatibility.targetPackageHash,
        sourceStateHash: plan.sourceStateHash, sourceSequence: plan.sourceSequence, ...envelope})}
    const projected = applyProductRuntimeEvent(initialState, {...upgradeEvent, sessionId: 0})
    upgradeHead = {status: chatUpgrade.saved.parent.status, runtimeHeadSequence: 1,
      runtimeHeadStateJson: JSON.stringify(projected), runtimeHeadStateHash: await hashProductRuntimeStateV1(projected)}
  }

  return db.transaction('rw', scopeTransactionTables(
    ...(openContinuation ? [...runtimeInstanceTablesV1(), ...transactionTablesForReferenceCascade('productRuntimeSessions'), ...transactionTablesForReferenceCascade('mediaBlobObjects')] : []),
    db.productRuntimeSessions,
    db.ttrpgSessionParticipants,
    db.productReleases,
    db.productProductions,
    db.productProductionBriefs,
    db.productBuilds,
    db.productRuntimeEvents,
    ...(chatUpgrade ? [db.agentRuns] : []),
  ), async () => {
    const currentScope = await resolveScope({ scope })
    if (chatUpgrade) {
      const completed = await readCompletedChatReleaseUpgradeV1(currentScope, chatRequest!)
      if (completed) return completed
      await assertChatReleaseUpgradeUnchangedV1(chatUpgrade)
    }
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
    if (openContinuation && continuationParent && continuationParentState) {
      const authorization = parseTtrpgRuntimeStateV2(continuationParentState.ttrpg)!.authorization!;
      assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants: await db.ttrpgSessionParticipants.where('sessionId').equals(continuationParent.id!).toArray(), viewerKey: openContinuation.approvedBy });
      const existing = await db.productRuntimeSessions.where('parentSessionId').equals(continuationParent.id!).toArray();
      const duplicate = existing.find(row => JSON.parse(row.initialStateJson).ttrpg?.openRun?.releaseContinuation?.plan.planHash === openContinuation.expectedPlanHash);
      if (duplicate) {
        if (duplicate.productReleaseId !== productRelease!.id) throw new Error('[instance] 此续团确认已绑定另一个发布，请重新预览');
        return duplicate;
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
      parentSessionId: chatUpgrade?.saved.parent.id ?? continuationParent?.id ?? null,
      parentThroughSequence: chatUpgrade?.plan.sourceSequence ?? continuation?.expectedParentSequence ?? null,
      // Keep the verified prepared record intact until insertion. Apply the
      // precomputed upgrade projection atomically with its first event below.
      ...upgradeHead,
    }
    await db.productRuntimeSessions.update(session.id!, binding)
    const boundSession = { ...session, ...binding }
    if (upgradeEvent) await db.productRuntimeEvents.add({...upgradeEvent, sessionId: boundSession.id!})
    else await addInitialNarrativeEvents({
      scope: currentScope,
      worldGroupId: input.worldGroupId ?? null,
      session: boundSession,
      state: initialState,
    })
    if (runtimePackage.productType === 'ttrpg') {
      if (!runtimePackage.ttrpg) throw new Error('[instance] TTRPG 发布缺少冻结运行内容')
      await installInitialTtrpgParticipantsV2({
        session: boundSession,
        campaign: runtimePackage.ttrpg.campaign,
      })
      if (continuationParent) {
        await carryTtrpgContinuationParticipantsV2({
          parentSessionId: continuationParent.id!,
          child: boundSession,
          transitionKey: continuation!.transitionKey,
        })
      }
    }
    if (openContinuation && continuationParent) await cloneTtrpgRuntimePreservedExtensionsV1({ parent: continuationParent, child: boundSession,
      throughSequence: openContinuation.expectedParentSequence, state: initialState,
      events: await db.productRuntimeEvents.where('sessionId').equals(continuationParent.id!).sortBy('sequence') })
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
    ttrpgProtocol: 2,
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

export async function createAiTownInstance(input: {
  scope: WorkspaceScope
  productReleaseId: number
  title: string
  worldGroupId?: number | null
  seed?: string
}): Promise<ProductRuntimeSession> {
  return createProductRuntimeInstance({ ...input, kind: 'ai-town', productSource: releaseSource(input.productReleaseId) })
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
  if (sources !== 1) {
    throw new Error('[instance] 正式产品实例必须且只能绑定一个 Product Release/Build')
  }
  if (session.productReleaseId != null) {
    const verified = await verifyProductRuntimeSource({
      scope: resolved,
      source: { kind: 'release', productReleaseId: session.productReleaseId },
      ttrpgProtocol: session.kind === 'ttrpg' ? 2 : undefined,
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
      ttrpgProtocol: session.kind === 'ttrpg' ? 2 : undefined,
    })
    if (verified.runtimeSourceHash !== session.runtimeSourceHash
      || initialState.narrative?.version !== 2
      || initialState.narrative.contentHash !== verified.runtimeSourceHash) {
      throw new Error('[instance] 产品 Build 来源越界或 RuntimePackage 已变化')
    }
  }
  return session
}
