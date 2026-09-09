import { db } from '../db/schema'
import { createConfiguredProductProductionExecutorV1 } from '../product-production/production-executor'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import {
  parseConfirmedProductBriefV1,
  parseProductProductionSourcePlanV1,
} from '../product-production/source-contracts'
import type {
  ProductProductionTaskExecutionInputV1,
  ProductProductionTaskExecutionResultV1,
  ProductProductionTaskExecutorV1,
} from '../product-production/scheduler'
import type {
  ProductProductionBriefV3,
  ProductProductionRecordV1,
  TextOpenWorldMediaRequirementsV1,
} from '../types'
import type { ProviderBindingReceiptV1 } from '../product-production/capabilities'
import type { ResolvedProductMediaCapabilityV1 } from '../product-production/media-transport'
import { textOpenWorldProductionArtifactKindForKeyV1 } from './production-contract'
import {
  freezeTextOpenWorldNovelSourceV1,
  freezeTextOpenWorldWorldReleaseSourceV1,
} from './source-pin'
import {
  readTextOpenWorldCreatorExecutionBriefV1,
} from './creator-production-start'
import { textOpenWorldCreatorLocatorFromBriefRowV1 } from './creator-brief-persistence'
import { createTextOpenWorldSourceCurationExecutorV1 } from './source-curation'
import { createTextOpenWorldExperienceDesignExecutorV1 } from './experience-design'
import { createTextOpenWorldGameplayRulesetExecutorV1 } from './gameplay-ruleset'
import { createTextOpenWorldPresentationProfileExecutorV1 } from './presentation-profile'
import { createTextOpenWorldStoryArchitectureExecutorV1 } from './story-architecture'
import { createTextOpenWorldRegionSkeletonExecutorV1 } from './region-skeleton'
import { createTextOpenWorldPlayerBuildExecutorV1 } from './player-build'
import { createTextOpenWorldMainlineExecutorV1 } from './mainline-production'
import { createTextOpenWorldSignificantThreadsExecutorV1 } from './significant-threads-production'
import { createTextOpenWorldRegionNarrativePacksExecutorV1 } from './region-narrative-packs-production'
import { createTextOpenWorldQuestSkeletonsExecutorV1 } from './quest-skeletons-production'
import { createTextOpenWorldProgressionCatalogsExecutorV1 } from './progression-catalogs-production'
import { createTextOpenWorldEncounterCatalogExecutorV1 } from './encounter-catalog-production'
import { createTextOpenWorldItemRewardCatalogExecutorV1 } from './item-reward-catalog-production'
import { createTextOpenWorldCraftingEconomyCatalogExecutorV1 } from './crafting-economy-catalog-production'
import { createTextOpenWorldNpcRuntimeCatalogExecutorV1 } from './npc-runtime-catalog-production'
import { createTextOpenWorldMapInteractionCatalogExecutorV1 } from './map-interaction-catalog-production'
import { createTextOpenWorldQuestFinalizeExecutorV1 } from './quest-finalize-production'
import { createTextOpenWorldSceneScriptsExecutorV1 } from './scene-scripts-production'
import {
  createTextOpenWorldDeterministicPreflightExecutorV1,
  createTextOpenWorldSystemFinalizeExecutorV1,
} from './system-finalize-production'
import {
  createTextOpenWorldBalanceReviewExecutorV1,
  createTextOpenWorldSemanticReviewExecutorV1,
} from './quality-review-production'
import {
  createTextOpenWorldReleaseQaExecutorV1,
  createTextOpenWorldRuntimePackageExecutorV1,
} from './runtime-package-production'
import {
  executeTextOpenWorldProductionModelProtocolV1,
  type TextOpenWorldProductionDomainExecutorFactoryV1,
  type TextOpenWorldProductionModelTransportV1,
} from './production-model-protocol'
import {
  TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1,
  type TextOpenWorldAuthorRepairTaskKeyV1,
} from '../product-production/recovery-policy'

function fail(message: string): never {
  throw new Error(`[text-open-world-production-executor] ${message}`)
}

function zeroUsage(): ProductProductionTaskExecutionResultV1['usage'] {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0 }
}

export function createTextOpenWorldSourceLockExecutorV1(options: { now?: () => number } = {}): ProductProductionTaskExecutorV1 {
  const now = options.now ?? Date.now
  return async execution => {
    if (execution.task.taskKey !== 'p0.source-lock' || execution.task.executionMode !== 'deterministic') {
      fail('P0 executor收到错误任务')
    }
    const production = await db.productProductions.get(execution.productionId)
    if (!production || production.currentBriefRevision == null) {
      fail('找不到当前Production或授权Brief修订号')
    }
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]')
      .equals([execution.productionId, production.currentBriefRevision])
      .first()
    if (!briefRow || briefRow.status !== 'authorized') {
      fail('找不到当前授权Production/Brief')
    }
    const build = await db.productBuilds.get(execution.buildId)
    if (!build || build.productionId !== execution.productionId) fail('找不到当前 Build')
    const bundle = briefRow.briefKind === 'text-open-world-creator-v1'
      ? await (async () => {
          const contracts = await readTextOpenWorldCreatorExecutionBriefV1({
            briefRow,
            planJson: build.planJson,
          })
          const locator = textOpenWorldCreatorLocatorFromBriefRowV1(briefRow)
          const authorization = {
            productInstanceKey: production.productionKey,
            briefRevision: briefRow.revision,
            briefHash: briefRow.briefHash,
            authorStartRevision: contracts.start.authorStartRevision,
            // Persisted one-way witness, hashed again with the exact P0 source
            // boundary; the raw author nonce never enters an Artifact.
            authorizationNonce: contracts.start.authorizationNonceHash,
            rightsBasis: contracts.start.rightsBasis,
            rightsNote: contracts.start.rightsNote,
            authorizedAt: contracts.start.authorizedAt,
          }
          const createdAt = Math.max(now(), contracts.start.authorizedAt)
          if (contracts.sourcePlan.sourceKind === 'world-release' && locator.kind === 'world-release'
            && contracts.sourcePlan.selection.kind === 'world-release') {
            return freezeTextOpenWorldWorldReleaseSourceV1({
              scope: execution.scope,
              localReleaseRecordId: locator.localReleaseRecordId,
              expectedReleaseHash: contracts.sourcePlan.sourceVersionHash,
              selection: {
                mode: 'selected-resources',
                resourceKeys: contracts.sourcePlan.selection.resourceKeys,
              },
              authorization,
              createdAt,
            })
          }
          if (contracts.sourcePlan.sourceKind === 'novel' && locator.kind === 'novel'
            && contracts.sourcePlan.selection.kind === 'novel') {
            return freezeTextOpenWorldNovelSourceV1({
              targetScope: execution.scope,
              sourceScope: execution.scope,
              selection: locator.selection,
              expectedSourceVersionHash: contracts.sourcePlan.sourceVersionHash,
              expectedSourceBoundaryHash: contracts.sourcePlan.expectedSourceBoundaryHash!,
              authorization,
              createdAt,
            })
          }
          return fail('Creator SourcePlan 与本地 locator 种类不一致')
        })()
      : await (async () => {
          const sourcePlan = await parseProductProductionSourcePlanV1(briefRow)
          const confirmed = await parseConfirmedProductBriefV1({ row: briefRow, sourcePlan })
          const brief = parseProductProductionBriefV3(briefRow.briefJson)
          const createdAt = Math.max(now(), confirmed.confirmedAt)
          return freezeTextOpenWorldWorldReleaseSourceV1({
            scope: execution.scope,
            localReleaseRecordId: brief.source.worldReleaseId,
            selection: { mode: 'selected-resources', resourceKeys: brief.source.selection.resourceKeys },
            authorization: {
              productInstanceKey: production.productionKey,
              briefRevision: briefRow.revision,
              briefHash: briefRow.briefHash,
              authorStartRevision: confirmed.authorStartRevision,
              authorizationNonce: confirmed.confirmationHash,
              rightsBasis: 'author-owned',
              rightsNote: '作者授权当前冻结WorldRelease仅用于本次文字开放世界产品派生。',
              authorizedAt: confirmed.confirmedAt,
            },
            createdAt,
          })
        })()
    // Persist source units before the pin index. The pin is the closure marker,
    // so a process crash can never expose an accepted index whose units are
    // still missing.
    const artifacts: ProductProductionTaskExecutionResultV1['artifacts'] = [...bundle.units.map(unit => ({
      artifactKey: unit.payload.artifactKey,
      kind: textOpenWorldProductionArtifactKindForKeyV1(unit.payload.artifactKey),
      payload: unit.payload,
      contentHash: unit.artifactContentHash,
      quality: { frozen: true, readDepth: unit.payload.readDepth },
      rights: { authorizationHash: bundle.pin.authorization.authorizationHash },
    })), {
      artifactKey: 'text-open-world.source-pin', kind: 'text-open-world.source-pin', payload: bundle.pin,
      contentHash: bundle.pin.pinHash,
      quality: { unitCount: bundle.units.length, sourceBoundaryHash: bundle.pin.sourceBoundaryHash },
      rights: {
        authorizationHash: bundle.pin.authorization.authorizationHash,
        rightsBasis: bundle.pin.authorization.rightsBasis,
      },
    }]
    const expected = [...execution.task.outputArtifactKeys].sort()
    const actual = artifacts.map(artifact => artifact.artifactKey).sort()
    if (expected.join('|') !== actual.join('|')) fail('P0冻结单元与Plan选择不一致')
    return { artifacts, passedGateIds: [...execution.task.acceptanceGateIds], usage: zeroUsage() }
  }
}

function mediaRequirement(input: ProductProductionTaskExecutionInputV1): TextOpenWorldMediaRequirementsV1 {
  const row = input.inputArtifacts.find(artifact => artifact.artifactKey === 'text-open-world.media-requirements')
    ?? fail('媒资任务缺少MediaRequirements')
  try { return JSON.parse(row.payloadJson) as TextOpenWorldMediaRequirementsV1 }
  catch { return fail('MediaRequirements不是合法JSON') }
}

function translatedMediaBrief(
  brief: ProductProductionBriefV3,
  counts: { image: number; music: number; sfx: number },
  visual: Array<{ mediaKind: string; subjectKey: string }>,
): ProductProductionBriefV3 {
  const translated = structuredClone(brief)
  const portraitSlots = visual.filter(item => item.mediaKind === 'character-pose')
  return {
    ...translated,
    intent: {
      ...translated.intent,
      productType: 'avg',
      // This Brief only adapts the shared media transport. The actor-specific
      // identity remains in each accepted P10 slot prompt and sceneTag.
      playerRole: '已验收文字开放世界角色；具体身份以对应媒资槽的冻结描述为准',
    },
    source: {
      ...translated.source,
      selection: {
        ...translated.source.selection,
        roleBindings: {
          ...translated.source.selection.roleBindings,
          characters: portraitSlots.map(item => item.subjectKey),
        },
      },
    },
    media: {
      ...translated.media, imageCount: counts.image,
      musicTrackCount: counts.music, sfxCount: counts.sfx, voiceLineCount: 0,
      requiredMediaKinds: [
        ...(visual.some(item => item.mediaKind === 'background') ? ['background' as const] : []),
        ...(portraitSlots.length > 0 ? ['character-pose' as const] : []),
        ...(counts.music > 0 ? ['bgm' as const] : []),
        ...(counts.sfx > 0 ? ['sfx' as const] : []),
      ],
    },
  }
}

function assertMediaLaneCostBoundary(input: ProductProductionTaskExecutionInputV1, options: {
  production: ProductProductionRecordV1
  brief: ProductProductionBriefV3
  mediaCapabilities: ReadonlyMap<string, ResolvedProductMediaCapabilityV1>
}): void {
  const isVisual = input.task.taskKey === 'media.visual'
  if (input.task.budgetReservation.maximumCostUsd === 0) {
    const expectedAdapter = isVisual
      ? 'storyforge.procedural-svg.v1'
      : 'storyforge.procedural-audio.v1'
    if (input.task.capabilityRequirementKeys.length === 0) {
      fail(`${input.task.taskKey} 零费用程序化任务缺少 capability 绑定`)
    }
    for (const requirementKey of input.task.capabilityRequirementKeys) {
      const binding = input.capabilityBindings.find(item => item.requirementKey === requirementKey)
      if (!binding || binding.adapterId !== expectedAdapter
        || options.mediaCapabilities.has(requirementKey)) {
        fail(`${input.task.taskKey} 未获外部媒资费用授权，只允许冻结的内置程序化 adapter`)
      }
    }
  }
}

async function executeMediaLane(input: ProductProductionTaskExecutionInputV1, options: {
  production: ProductProductionRecordV1
  brief: ProductProductionBriefV3
  mediaCapabilities: ReadonlyMap<string, ResolvedProductMediaCapabilityV1>
}): Promise<ProductProductionTaskExecutionResultV1> {
  const isVisual = input.task.taskKey === 'media.visual'
  assertMediaLaneCostBoundary(input, options)
  const requirements = mediaRequirement(input)
  const selected = requirements.slots.filter(slot => isVisual
    ? ['character-portrait', 'scene-background', 'ui-skin'].includes(slot.kind)
      && slot.productionMode !== 'fallback-only'
    : ['music', 'ambient-sound', 'sound-effect', 'voice'].includes(slot.kind)
      && slot.productionMode !== 'fallback-only')
    .sort((left, right) => {
      if (!isVisual) return left.order - right.order
      // Every visual bundle starts with an actual background because the
      // shared AVG transport requires one. Remaining capacity prioritizes
      // product-local actor portraits before optional UI skins/backgrounds.
      const priority = (kind: typeof left.kind) => kind === 'scene-background' ? 0
        : kind === 'character-portrait' ? 1 : 2
      return priority(left.kind) - priority(right.kind) || left.order - right.order
    })
    .slice(0, input.task.outputArtifactKeys.length)
  if (selected.length !== input.task.outputArtifactKeys.length) fail('专属媒资需求数量与Plan不一致')
  let portraitIndex = 0
  const visual = isVisual ? selected.map((slot, index) => {
    const isPortrait = slot.kind === 'character-portrait'
    const mediaKind = isPortrait ? 'character-pose' as const
      : slot.kind === 'ui-skin' ? 'ui' as const : 'background' as const
    const characterAnchorRefs = isPortrait ? [`character:${++portraitIndex}`] : []
    return {
      artifactKey: `media.visual.${String(index + 1).padStart(3, '0')}`,
      mediaKind,
      sceneTag: slot.subjectKey, beatKey: 'runtime.beat.opening',
      prompt: slot.creativeBrief, altText: slot.title,
      width: isPortrait ? 720 : 1200, height: isPortrait ? 1080 : 675,
      palette: ['#263238', '#607d8b', '#eceff1'], characterAnchorRefs, hardConstraints: [],
    }
  }) : []
  const audio = isVisual ? [] : selected.map((slot, index) => ({
    artifactKey: `media.audio.${String(index + 1).padStart(3, '0')}`,
    mediaKind: slot.kind === 'music' ? 'bgm' : slot.kind === 'sound-effect' ? 'sfx'
      : slot.kind === 'voice' ? fail('首版尚未实现独立voice媒资通路') : 'ambience',
    sceneTag: slot.subjectKey, beatKey: 'runtime.beat.opening',
    prompt: slot.creativeBrief, altText: slot.title, durationMs: slot.kind === 'music' ? 60_000 : 8_000,
  }))
  const music = audio.filter(item => item.mediaKind === 'bgm').length
  const sfx = audio.length - music
  const fakeBrief = translatedMediaBrief(
    options.brief,
    { image: visual.length, music, sfx },
    visual.map((item, index) => ({ mediaKind: item.mediaKind, subjectKey: selected[index]!.subjectKey })),
  )
  const genericOutputKeys = (isVisual ? visual : audio).map(item => item.artifactKey)
  const genericTask = {
    ...structuredClone(input.task), taskKey: isVisual ? 'media.visual' : 'media.audio',
    inputArtifactKeys: ['media.requirements'], outputArtifactKeys: genericOutputKeys,
  }
  const sourceRow = input.inputArtifacts.find(artifact => artifact.artifactKey === 'text-open-world.media-requirements')!
  const genericInput = {
    ...input, task: genericTask,
    inputArtifacts: [{
      ...sourceRow, artifactKey: 'media.requirements',
      payloadJson: JSON.stringify({
        schema: 'storyforge.product-media-requirements-artifact', version: 2, visual, audio,
      }),
    }],
  }
  const result = await createConfiguredProductProductionExecutorV1({
    production: options.production, brief: fakeBrief, mediaCapabilities: options.mediaCapabilities,
  })(genericInput)
  return {
    ...result,
    artifacts: result.artifacts.map((artifact, index) => {
      const slot = selected[index]!
      const metadata = artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
        ? artifact.metadata as Record<string, unknown> : {}
      return {
        ...artifact, artifactKey: input.task.outputArtifactKeys[index]!,
        metadata: {
          ...metadata,
          characterTag: slot.kind === 'character-portrait' ? slot.subjectKey : '',
          sceneTag: slot.subjectKey,
        },
      }
    }),
  }
}

export interface TextOpenWorldProductionExecutorOptionsV1 {
  production: ProductProductionRecordV1
  brief: ProductProductionBriefV3
  mediaCapabilities?: ReadonlyMap<string, ResolvedProductMediaCapabilityV1>
  /** Non-secret frozen provider identity used to validate author-revised JSON. */
  textCapabilityReceipt?: ProviderBindingReceiptV1
  /** Test seam for the shared configured-provider transport; never persisted. */
  modelTransport?: TextOpenWorldProductionModelTransportV1
  taskExecutors?: Partial<Record<string, ProductProductionTaskExecutorV1>>
}

interface TextOpenWorldModelTaskProtocolV1 {
  skillId: string
  factory: TextOpenWorldProductionDomainExecutorFactoryV1
  callPolicy?: 'single-exact-context' | 'bounded-derived-context'
}

type TextOpenWorldAuthorRepairModelProtocolsV1 = {
  [TaskKey in TextOpenWorldAuthorRepairTaskKeyV1]: TextOpenWorldModelTaskProtocolV1 & {
    skillId: typeof TEXT_OPEN_WORLD_AUTHOR_REPAIR_TASK_SKILL_IDS_V1[TaskKey]
  }
}

const TEXT_OPEN_WORLD_AUTHOR_REPAIR_MODEL_PROTOCOLS_V1 = {
  'p2.experience-design': {
    skillId: 'text-open-world.production.experience-design.v1', factory: createTextOpenWorldExperienceDesignExecutorV1,
  },
  'p2.gameplay-ruleset': {
    skillId: 'text-open-world.production.gameplay-ruleset.v1', factory: createTextOpenWorldGameplayRulesetExecutorV1,
  },
  'p2.presentation-profile': {
    skillId: 'text-open-world.production.presentation-profile.v1', factory: createTextOpenWorldPresentationProfileExecutorV1,
  },
  'p3.story-architecture': {
    skillId: 'text-open-world.production.story-architecture.v1', factory: createTextOpenWorldStoryArchitectureExecutorV1,
  },
  'p4.region-skeleton': {
    skillId: 'text-open-world.production.region-skeleton.v1', factory: createTextOpenWorldRegionSkeletonExecutorV1,
  },
  'p4.player-build': {
    skillId: 'text-open-world.production.player-build.v1', factory: createTextOpenWorldPlayerBuildExecutorV1,
  },
  'p5.mainline': {
    skillId: 'text-open-world.production.mainline.v1', factory: createTextOpenWorldMainlineExecutorV1,
  },
  'p6.significant-threads': {
    skillId: 'text-open-world.production.significant-threads.v1', factory: createTextOpenWorldSignificantThreadsExecutorV1,
  },
  'p7.region-narrative-packs': {
    skillId: 'text-open-world.production.region-narrative-packs.v1', factory: createTextOpenWorldRegionNarrativePacksExecutorV1,
  },
  'p8.quest-skeletons': {
    skillId: 'text-open-world.production.quest-skeletons.v1', factory: createTextOpenWorldQuestSkeletonsExecutorV1,
  },
  'p8.catalog.progression': {
    skillId: 'text-open-world.production.progression-catalogs.v1', factory: createTextOpenWorldProgressionCatalogsExecutorV1,
  },
  'p8.catalog.encounters': {
    skillId: 'text-open-world.production.encounter-catalog.v1', factory: createTextOpenWorldEncounterCatalogExecutorV1,
  },
  'p8.catalog.items-rewards': {
    skillId: 'text-open-world.production.item-reward-catalog.v1', factory: createTextOpenWorldItemRewardCatalogExecutorV1,
  },
  'p8.catalog.crafting-economy': {
    skillId: 'text-open-world.production.crafting-economy-catalog.v1', factory: createTextOpenWorldCraftingEconomyCatalogExecutorV1,
  },
  'p8.catalog.npc-runtime': {
    skillId: 'text-open-world.production.npc-runtime-catalog.v1', factory: createTextOpenWorldNpcRuntimeCatalogExecutorV1,
  },
  'p8.catalog.map-interactions': {
    skillId: 'text-open-world.production.map-interaction-catalog.v1', factory: createTextOpenWorldMapInteractionCatalogExecutorV1,
  },
  'p8f.quest-finalize': {
    skillId: 'text-open-world.production.quest-finalize.v1', factory: createTextOpenWorldQuestFinalizeExecutorV1,
  },
  'p9.scene-scripts': {
    skillId: 'text-open-world.production.scene-scripts.v1',
    factory: createTextOpenWorldSceneScriptsExecutorV1,
    callPolicy: 'bounded-derived-context',
  },
  'p10.system-finalize': {
    skillId: 'text-open-world.production.system-finalize.v1', factory: createTextOpenWorldSystemFinalizeExecutorV1,
  },
} satisfies TextOpenWorldAuthorRepairModelProtocolsV1

const TEXT_OPEN_WORLD_REVIEW_MODEL_PROTOCOLS_V1 = {
  'v2.balance-review': {
    skillId: 'text-open-world.production.balance-review.v1', factory: createTextOpenWorldBalanceReviewExecutorV1,
  },
  'v2.semantic-review': {
    skillId: 'text-open-world.production.semantic-review.v1', factory: createTextOpenWorldSemanticReviewExecutorV1,
  },
} as const satisfies Record<string, TextOpenWorldModelTaskProtocolV1>

const TEXT_OPEN_WORLD_MODEL_PROTOCOLS_V1 = {
  ...TEXT_OPEN_WORLD_AUTHOR_REPAIR_MODEL_PROTOCOLS_V1,
  ...TEXT_OPEN_WORLD_REVIEW_MODEL_PROTOCOLS_V1,
}

type TextOpenWorldModelTaskKeyV1 = keyof typeof TEXT_OPEN_WORLD_MODEL_PROTOCOLS_V1

function isTextOpenWorldModelTaskKeyV1(taskKey: string): taskKey is TextOpenWorldModelTaskKeyV1 {
  return Object.prototype.hasOwnProperty.call(TEXT_OPEN_WORLD_MODEL_PROTOCOLS_V1, taskKey)
}

/** The single dispatcher selected by the shared scheduler for text-open-world.
 * Each task still owns its independent Skill/Run/checkpoint/receipt boundary. */
export function createTextOpenWorldProductionExecutorV1(
  options: TextOpenWorldProductionExecutorOptionsV1,
): ProductProductionTaskExecutorV1 {
  const executors: Record<string, ProductProductionTaskExecutorV1> = {
    'p0.source-lock': createTextOpenWorldSourceLockExecutorV1(),
    'p1.source-curation': createTextOpenWorldSourceCurationExecutorV1(),
    'v1.deterministic-preflight': createTextOpenWorldDeterministicPreflightExecutorV1(),
    'v3.runtime-package': createTextOpenWorldRuntimePackageExecutorV1(),
    'qa.release': createTextOpenWorldReleaseQaExecutorV1(),
  }
  return async execution => {
    if (execution.task.taskKey === 'media.visual' || execution.task.taskKey === 'media.audio') {
      const mediaOptions = {
        production: options.production, brief: options.brief,
        mediaCapabilities: options.mediaCapabilities ?? new Map(),
      }
      // The local-only media authorization is checked before any executor
      // override so tests/extensions cannot bypass the same safety boundary.
      assertMediaLaneCostBoundary(execution, mediaOptions)
      const override = options.taskExecutors?.[execution.task.taskKey]
      if (override && execution.task.budgetReservation.maximumCostUsd === 0) {
        fail(`${execution.task.taskKey} 零费用程序化媒资禁止 executor override`)
      }
      if (override) return override(execution)
      return executeMediaLane(execution, mediaOptions)
    }
    const override = options.taskExecutors?.[execution.task.taskKey]
    if (override) return override(execution)
    if (isTextOpenWorldModelTaskKeyV1(execution.task.taskKey)) {
      const protocol = TEXT_OPEN_WORLD_MODEL_PROTOCOLS_V1[execution.task.taskKey]
      if (execution.task.executionMode !== 'model' || execution.task.skillId !== protocol.skillId) {
        fail(`${execution.task.taskKey} 与登记的模型任务协议不一致`)
      }
      return executeTextOpenWorldProductionModelProtocolV1({
        execution,
        factory: protocol.factory,
        skillId: protocol.skillId,
        callPolicy: 'callPolicy' in protocol ? protocol.callPolicy : undefined,
        textCapabilityReceipt: options.textCapabilityReceipt,
        modelTransport: options.modelTransport,
      })
    }
    const executor = executors[execution.task.taskKey]
      ?? fail(`未登记任务执行器:${execution.task.taskKey}`)
    return executor(execution)
  }
}
