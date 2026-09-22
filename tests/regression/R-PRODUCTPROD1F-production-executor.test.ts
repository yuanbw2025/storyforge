import {DEFAULT_CHAT_SETTINGS} from '../../src/lib/character-interaction/authoring-contract'
import {loadProductProductionConsultationSourceV2} from '../../src/lib/product-production/world-source'
import { authoredScenarioFixture } from '../helpers/ttrpg-authored-scenario'
import { resolveTtrpgProductionRulePackV2 } from '../../src/lib/ttrpg/production-brief'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import { getAgentSkillV1, TEXT_ADVENTURE_PRODUCTION_AGENT_IDS } from '../../src/lib/agent/skill-registry'
import { prepareProductProductionAdoption } from '../../src/lib/product-production/adoption'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { PRODUCT_BROWSER_PERFORMANCE_POLICY_V1 } from '../../src/lib/product-production/browser-performance'
import {
  resolveProductMediaProviderAdapterV1,
  type MediaProviderTransportV1,
  type RedactedMediaTransportRequestV1,
} from '../../src/lib/product-production/media-adapters'
import type { ResolvedProductMediaCapabilityV1 } from '../../src/lib/product-production/media-transport'
import {
  createBuiltInProductionCapabilityBindingV1,
  createConfiguredProductProductionExecutorV1,
  deterministicRegionMapPngV1,
  applyTextAdventureSceneRepairPatchV1,
  isolateCharacterProviderPromptV1,
  legalizeProductionModelProtocolDefaultsV1,
  normalizeTextAdventureVisualReviewPolicyV1,
  planTextAdventureMainQuestIdentityV1,
  parseProductMediaRequirementsArtifactV2,
  parseProductionModelJsonObjectV1,
  parseTextAdventureVisualQualityReviewArtifactV1,
  positiveImageRepairDirectiveV1,
  productMediaCharacterPresentationConstraintV1,
  productImageNegativePromptV1,
  productImageRequestNegativePromptV1,
  textAdventureVisualAnchorConfirmationHashV1,
  textAdventureQuestScriptCountRetryDirectiveV1,
  textAdventureQuestScriptOutcomeRetryDirectiveV1,
  textAdventureQuestScriptLocationRetryDirectiveV1,
  textAdventureQuestScriptResolutionRetryDirectiveV1,
  textAdventureQuestScriptRootRetryDirectiveV1,
  applyTextAdventureQuestScriptOutcomeAnchorsV1,
  textAdventureArchitectureLocationRetryDirectiveV1,
  textAdventureEndingRoutePartitionRetryDirectiveV1,
  textAdventureRepairBaselineDirectiveV1,
  textAdventureQualityReviewReferenceRetryDirectiveV1,
  textAdventureSceneIdentityRetryDirectiveV1,
  textAdventureSceneVolumeRetryDirectiveV1,
  textAdventureSceneChoiceGraphRetryDirectiveV1,
  textAdventureDialogueOrdinalRetryDirectiveV1,
  textAdventureDuplicateBeatIssuesV1,
  normalizeTextAdventureQualityIssuesV1,
  textAdventureQualityReviewBoundsRetryDirectiveV1,
  textAdventureQuestBundleContractRetryDirectiveV1,
  textAdventureGlyphSafeMapRepairPromptV1,
  textAdventureVisualBlueprintsV1,
  textAdventureVisualRepairCastConstraintV1,
  type ProductionTextRunnerV1,
  type ProductionVisionRunnerV1,
} from '../../src/lib/product-production/production-executor'
import { putMediaBlobObject, sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import {
  executionBindingDriftInvalidatedTaskKeysV1,
  runProductProductionUntilBlockedV1,
} from '../../src/lib/product-production/scheduler'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { evaluateProductRuntimeProductQualityV1 } from '../../src/lib/product-production/product-quality'
import {
  textAdventurePlayerPerspectiveIssuesV1,
  textAdventureUnauthorizedKinshipIssuesV1,
  textAdventureDialogueAttributionIssuesV1,
  textAdventureSceneSpeakerAuthorityIssuesV1,
  textAdventureQuestLocationAuthorityIssuesV1,
  textAdventureQualityReviewBeatClaimContradictionV1,
} from '../../src/lib/product-production/text-adventure-quality'
import { analyzeTextAdventureRouteQualityV1 } from '../../src/lib/adventure/quality-analysis'
import {
  conciseTextAdventureActionLabelV1,
  textAdventureDecisionEchoPresentationV1,
} from '../../src/lib/adventure/production-compiler'
import { adventureNarrativeActionContext, availableAdventureActions } from '../../src/lib/adventure/runtime'
import { commitAdventureAction, commitAdventureNarrativeChoice } from '../../src/lib/adventure/runtime-api'
import { planTextAdventureNarrativeLocationsV1 } from '../../src/lib/adventure/narrative-location-plan'
import {
  textAdventureActSceneKeysV1,
  textAdventureNarrativeSkeletonV1,
  textAdventureSceneScriptPartSceneKeysV1,
} from '../../src/lib/adventure/scene-script'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import { exportCommunityPrototypeDistributionBundleV2 } from '../../src/lib/product-platform/distribution-bundle'
import {
  exportProductDistributionBundleV2,
  importMarketplaceProductDistributionV2,
} from '../../src/lib/product-platform/distribution-bundle'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import {
  recordProductBrowserPerformanceMeasurementV1,
  recordProductBuildMainRoutePlaythroughV1,
  recordProductMediaRuntimeMeasurementV1,
} from '../../src/lib/product-production/quality-receipts'
import {
  beginProductProductionEvolutionV1,
  listProductProductionReviewArtifactsV1,
  publishProductProductionV1,
  startProductProductionPreviewV1,
} from '../../src/lib/product-production/service'
import {
  commitNarrativeChoice,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-api'
import {
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  submitTtrpgActionIntentV2,
} from '../../src/lib/ttrpg/runtime-api'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-api'
import {
  configureTtrpgSessionParticipantV2,
  readTtrpgSessionParticipantsV2,
} from '../../src/lib/ttrpg/participants'
import {
  AI_TOWN_DAY_SLOTS,
  type ProductBuildArtifactRecordV1,
  type ProductProductionBriefV3,
  type ProductRuntimePackageV1,
  type ProductionProductKindV1,
} from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

function crc32Fixture(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function decodeVisionPreflightQuadrants(data: ArrayBuffer): string[] {
  const png = Buffer.from(data)
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString('ascii')
    const chunkData = png.subarray(offset + 8, offset + 8 + length)
    const actualCrc = png.readUInt32BE(offset + 8 + length)
    expect(actualCrc).toBe(crc32Fixture(png.subarray(offset + 4, offset + 8 + length)))
    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0)
      height = chunkData.readUInt32BE(4)
      expect([...chunkData.subarray(8)]).toEqual([8, 2, 0, 0, 0])
    } else if (type === 'IDAT') idat.push(chunkData)
    offset += 12 + length
    if (type === 'IEND') break
  }
  expect({ width, height, offset }).toEqual({ width: 64, height: 64, offset: png.length })
  const raw = inflateSync(Buffer.concat(idat))
  const stride = 1 + width * 3
  expect(raw.length).toBe(stride * height)
  for (let y = 0; y < height; y += 1) expect(raw[y * stride]).toBe(0)
  const labelsByRgb = new Map([
    ['0,0,0', 'black'], ['0,0,255', 'blue'], ['0,255,255', 'cyan'], ['0,255,0', 'green'],
    ['255,0,255', 'magenta'], ['255,0,0', 'red'], ['255,255,255', 'white'], ['255,255,0', 'yellow'],
  ])
  return [[16, 16], [48, 16], [16, 48], [48, 48]].map(([x, y]) => {
    const pixelOffset = y * stride + 1 + x * 3
    const rgb = [...raw.subarray(pixelOffset, pixelOffset + 3)].join(',')
    const label = labelsByRgb.get(rgb)
    expect(label).toBeDefined()
    return label!
  })
}

async function fixture(qualityProfile: 'prototype' | 'commercial-candidate' = 'prototype') {
  const owned = await seedCurrentProductWorld('formal-executor')
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg', qualityProfile, scale: 'scene', visualLevel: 'key-scenes', audioLevel: 'music-sfx',
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: 'formal.intent', productionKey: 'formal.production',
      productType: 'avg', worldReleaseId: release.id!, userText: '正式自动制作 AVG',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: 'formal.brief', expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: 'formal.authorize', expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'formal.click',
    },
  })
  return { ...owned, release, brief, productionId: created.productionId }
}

async function fixtureForProduct(productType: ProductionProductKindV1, options?: {
  scale?: 'scene' | 'short-arc' | 'chapter'
  visualLevel?: 'none' | 'key-scenes'
  omitWorldArtifacts?: boolean
  qualityProfile?: 'prototype' | 'commercial-candidate'
  maximumModelCalls?: number
}) {
  const owned = await seedCurrentProductWorld(
    `formal-${productType}`,
    productType === 'ai-town' ? { minimumCharacters: 4 } : {},
  )
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const chatCatalog = productType === 'character-interaction' ? await loadProductProductionConsultationSourceV2({scope:owned.scope,worldReleaseId:release.id!}) : null
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType, qualityProfile: options?.qualityProfile ?? 'prototype', scale: options?.scale ?? 'scene',
    visualLevel: options?.visualLevel ?? (productType === 'text-adventure' ? 'key-scenes' : 'none'), audioLevel: 'none',
    playerRole: `扮演 ${productType} 的冻结世界行动者`,
    openingSituation: `从用户确认的雾港潮门入口开始 ${productType} 体验。`,
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
    ...(chatCatalog ? {characterChat:{...DEFAULT_CHAT_SETTINGS,characters:[{sourceKey:chatCatalog.selectionOptions.characters.find(c=>c.label==='林舟')!.resourceKey,voiceRules:'简短直接',privateKnowledge:'独自保管的暗号',initialTrust:24}]}} : {}),
    confirmTtrpgDefaultMappings: productType === 'ttrpg',
    textAdventure: productType === 'text-adventure' ? { confirmAll: true } : undefined,
  })
  if (options?.maximumModelCalls != null) brief.productionBudget.maximumModelCalls = options.maximumModelCalls
  if (options?.omitWorldArtifacts) {
    const artifactKeys = new Set(brief.source.selection.roleBindings.items ?? [])
    brief.source.selection.resourceKeys = brief.source.selection.resourceKeys
      .filter(resourceKey => !artifactKeys.has(resourceKey))
    brief.source.selection.roleBindings.items = []
  }
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `current.${productType}.intent`, productionKey: `current.${productType}`,
      productType, worldReleaseId: release.id!, userText: `正式自动制作 ${productType}`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `six.${productType}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  if (!saved.ok) {
    throw new Error(`save ${productType} failed: ${saved.errorCode ?? 'unknown'} ${String(saved.result.message ?? '')}`)
  }
  const authorized = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `six.${productType}.authorize`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `six.${productType}.click`,
    },
  })
  if (!authorized.ok) {
    throw new Error(`authorize ${productType} failed: ${authorized.errorCode ?? 'unknown'} ${String(authorized.result.message ?? '')}`)
  }
  return { ...owned, release, brief, productionId: created.productionId }
}

async function fixtureAiTownWithMedia() {
  const owned = await seedCurrentProductWorld('formal-ai-town-media', { minimumCharacters: 4 })
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId: owned.release.id!,
    suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'ai-town',
    qualityProfile: 'prototype',
    scale: 'scene',
    visualLevel: 'key-scenes',
    audioLevel: 'music-sfx',
    playerRole: '原作结束后来到共同体的新居民',
    openingSituation: '原作终局九十日后，四位居民开始修复共同生活的旧庭院。',
    requiredFacts: ['冻结世界事实保持一致'],
    forbiddenChanges: ['不得写回世界正式表'],
    aiTown: {
      playerRole: 'new-resident', playerName: '新居民', homeConcept: '广场旁的小屋',
      townTitle: '潮门后日镇', elapsedDays: 90, romance: 'off', residentTarget: 4,
      majorLocationTarget: 4, actionsPerDay: 3, offlineEnabled: true, offlineMaximumDays: 3,
      resourceKeys: ['materials', 'food', 'care'], startingMoney: 200,
      sharedProjectConcept: '修复旧庭院', portraits: true, expressions: true,
      locationCards: true, ambientAudio: true,
    },
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: 'town-media.intent', productionKey: 'town-media.production',
      productType: 'ai-town', worldReleaseId: owned.release.id!, userText: '制作带正式小镇媒资的后日谈产品',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: 'town-media.brief', expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: 'town-media.authorize', expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'town-media.click',
    },
  })
  return { ...owned, brief, productionId: created.productionId }
}

function firstCharacterAnchor(brief: Awaited<ReturnType<typeof fixture>>['brief']): string {
  const selected = brief.source.selection.roleBindings.characters
    ?? brief.source.selection.roleBindings.participants ?? []
  return selected.length ? 'character:1' : 'intent:protagonist'
}

async function completeAvgBuildPreviewMainRoute(input: {
  scope: Awaited<ReturnType<typeof fixture>>['scope']
  productionId: number
}): Promise<number> {
  const opened = await startProductProductionPreviewV1({
    scope: input.scope, productionId: input.productionId, worldGroupId: null,
  })
  expect(opened.productType).toBe('avg')
  for (let turn = 0; turn < 30; turn += 1) {
    let state = await readProductRuntimeState(opened.sessionId)
    if (state.narrative?.completed) return opened.sessionId
    const nodeKey = state.narrative?.currentNodeKey
    if (!nodeKey) throw new Error('商业 AVG 主路线缺少当前节点')
    const beats = (state.narrative?.beats ?? [])
      .filter(beat => beat.nodeKey === nodeKey)
      .sort((left, right) => left.order - right.order || left.beatKey.localeCompare(right.beatKey))
    const reachedIndex = state.presentation?.currentNodeKey === nodeKey && state.presentation.currentBeatKey
      ? beats.findIndex(beat => beat.beatKey === state.presentation!.currentBeatKey) : -1
    for (const beat of beats.slice(reachedIndex + 1)) {
      const base = await readProductRuntimeStateVersion(opened.sessionId)
      await reachAvgPresentationBeat({
        sessionId: opened.sessionId, beatKey: beat.beatKey,
        commandId: `commercial-preview:beat:${opened.sessionId}:${beat.beatKey}`,
        baseSequence: base.sequence, baseStateHash: base.stateHash,
        snapshotKey: `commercial-preview:${nodeKey}`,
      })
    }
    state = await readProductRuntimeState(opened.sessionId)
    const choiceKey = state.narrative?.availableChoiceKeys?.[0]
    if (!choiceKey) throw new Error('商业 AVG 主路线没有可提交选择')
    const base = await readProductRuntimeStateVersion(opened.sessionId)
    await commitNarrativeChoice({
      sessionId: opened.sessionId, choiceKey,
      commandId: `commercial-preview:choice:${opened.sessionId}:${turn}`,
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
  }
  throw new Error('商业 AVG 主路线在 30 次选择内未到达结局')
}

async function completeTextAdventureSessionMainRoute(input: {
  sessionId: number
  runtimePackage: ProductRuntimePackageV1
  commandPrefix: string
}) {
  const adventure = input.runtimePackage.adventure
  if (!adventure) throw new Error('文字冒险正式纵切面缺少 AdventureContentV2')
  for (let turn = 0; turn < 50; turn += 1) {
    const state = await readProductRuntimeState(input.sessionId)
    if (state.narrative?.completed) break
    const currentNodeKey = state.narrative?.currentNodeKey
    if (!currentNodeKey || !state.adventure) {
      throw new Error('文字冒险正式纵切面缺少当前节点或玩法状态')
    }
    const available = availableAdventureActions(
      adventure,
      state.adventure,
      adventureNarrativeActionContext({
        currentNodeKey,
        variables: state.narrative?.variables ?? {},
      }),
    ).filter(item => item.available)
    const objectiveAction = available.find(item => (
      item.action.key.startsWith('action.main.') && item.action.kind !== 'talk'
    ))
    if (objectiveAction) {
      const base = await readProductRuntimeStateVersion(input.sessionId)
      await commitAdventureAction({
        sessionId: input.sessionId,
        actionKey: objectiveAction.action.key,
        commandId: `${input.commandPrefix}.objective.${turn}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
      continue
    }
    const narrativeAction = available.find(item => item.action.narrativeChoiceKey)
    if (!narrativeAction?.action.narrativeChoiceKey) {
      throw new Error(`文字冒险正式纵切面在 ${currentNodeKey} 没有合法主线行动`)
    }
    await commitAdventureNarrativeChoice({
      sessionId: input.sessionId,
      choiceKey: narrativeAction.action.narrativeChoiceKey,
      commandId: `${input.commandPrefix}.choice.${turn}`,
    })
  }
  const completed = await readProductRuntimeState(input.sessionId)
  const mainQuestKey = adventure.quests.find(quest => quest.category === 'main')!.key
  const completedMainQuest = completed.adventure?.quests.find(quest => quest.questKey === mainQuestKey)
  expect(completed.narrative).toMatchObject({ completed: true })
  expect(completedMainQuest).toMatchObject({ status: 'completed' })
  expect(completedMainQuest?.objectives.every(objective => objective.completed)).toBe(true)
}

function playtestStrategyOutput() {
  const kinds = [
    'golden-route', 'alternate-route', 'failure-forward', 'each-ending', 'random-long-run',
    'resource-edge', 'side-quest-skip', 'side-quest-complete', 'refresh-resume',
    'save-load-branch', 'ai-offline', 'media-offline', 'corruption-recovery',
    'export-import', 'delete-lifecycle',
  ] as const
  const browserKinds = new Set([
    'random-long-run', 'resource-edge', 'side-quest-skip', 'side-quest-complete',
    'refresh-resume', 'save-load-branch', 'corruption-recovery', 'export-import', 'delete-lifecycle',
  ])
  return {
    schema: 'storyforge.text-adventure-playtest-strategy-artifact' as const, version: 1 as const,
    routeCases: kinds.map(kind => ({
      caseKey: `playtest.${kind}`, kind,
      executionMode: browserKinds.has(kind) ? 'real-browser' as const : 'deterministic-autoplay' as const,
      objective: `验证 ${kind} 的可执行结果与状态证据。`,
      steps: ['从当前 Build 的固定入口开始', '按登记路线执行并保留状态与界面证据'],
      expectedAssertions: ['没有软锁或越权写入', '结果绑定当前 Build 与 package hash'],
      evidenceRefs: [`quality.autoplay#autoplay.${kind}`], required: true,
    })),
    humanSessions: [{
      sessionKey: 'human.independent-golden', participantRole: 'independent-player' as const,
      routeKind: 'golden-route' as const, timingRequired: true,
      prompts: ['记录理解障碍、无聊点、选择感与情绪变化'],
      passCriteria: ['完整抵达结局', '实际时长达到 Brief 验收区间'],
    }, {
      sessionKey: 'human.author-alternate', participantRole: 'author' as const,
      routeKind: 'alternate-route' as const, timingRequired: false,
      prompts: ['核对替代路线与主线因果差异'],
      passCriteria: ['替代路线可完成且具有持续回响'],
    }],
    blockingRisks: [], recommendation: 'eligible-for-human-validation' as const,
  }
}

function productionSupervisionOutput() {
  const agents = [...TEXT_ADVENTURE_PRODUCTION_AGENT_IDS]
  const assignments = [
    agents.slice(0, 3),
    agents.slice(3, 8),
    agents.slice(8, 14),
    agents.slice(14, 16),
    agents.slice(16, 17),
    agents.slice(17),
  ]
  const stageKeys = [
    'g1-source-and-direction',
    'g2-architecture-and-quests',
    'g3-scripts-and-dialogue',
    'g4-quality-and-media',
    'g5-assembly-and-automation',
    'g6-human-validation-and-release',
  ] as const
  return {
    schema: 'storyforge.text-adventure-production-supervision-artifact' as const,
    version: 1 as const,
    productionPromise: '以冻结来源、专业分工、确定性状态权威和可验证质量门交付完整文字冒险。',
    stages: stageKeys.map((key, index) => ({
      key,
      objective: `完成 G${index + 1} 的专业工件并冻结可验证交接。`,
      responsibleAgentIds: assignments[index],
      exitCriteria: [`G${index + 1} 所有必需工件有 accepted receipt`],
      stopConditions: [`G${index + 1} 任一协议或质量硬门失败时暂停`],
    })),
    risks: [{
      key: 'risk.source-gap', severity: 'blocking' as const,
      ownerAgentId: 'text-adventure-source-editor', evidence: '来源可能不足以支撑目标时长。',
      mitigation: '先审计来源并通过作者闸门冻结私域补充。',
    }, {
      key: 'risk-content-shortage', severity: 'blocking' as const,
      ownerAgentId: 'text-adventure-scene-writer', evidence: '场景正文可能低于商业候选硬门。',
      mitigation: '按幕预算、内容量检查和有界修复闭环处理。',
    }, {
      key: 'risk-route-causality', severity: 'warning' as const,
      ownerAgentId: 'text-adventure-continuity-editor', evidence: '分支可能汇流后失去持续回响。',
      mitigation: '审查决定、状态效果、后续回响和结局条件。',
    }],
    authorGates: [{
      key: 'gate.source-scope', afterStageKey: 'g1-source-and-direction' as const,
      decision: '确认来源范围和产品私域补充。',
    }, {
      key: 'gate.visual-anchors', afterStageKey: 'g4-quality-and-media' as const,
      decision: '确认主要角色视觉锚点和媒资清单。',
    }, {
      key: 'gate.release', afterStageKey: 'g6-human-validation-and-release' as const,
      decision: '完成真人试玩后由作者确认发布。',
    }],
    nonGoals: ['不写回 WorldRelease', '不实现 AVG 连续舞台演出', '不把专用调查机制放入通用内核'],
  }
}

function questScriptRunOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
  questScript: {
    schema: 'storyforge.text-adventure-quest-script-artifact'
    version: 2
    mainObjectiveScripts: ReadonlyArray<{ sceneKey: string } & Record<string, unknown>>
    sideQuestScripts: ReadonlyArray<unknown>
    ambientEventScripts: ReadonlyArray<unknown>
  },
) {
  const emptySupplemental = { sideQuestScripts: [], ambientEventScripts: [] }
  return {
    ...Object.fromEntries([0, 1, 2].flatMap(actIndex => {
      const sceneKeys = new Set(textAdventureActSceneKeysV1(brief, actIndex))
      return (['single', 'multi'] as const).map(routeClass => [
        `content.quest-script.main.act-${actIndex + 1}.${routeClass}`,
        {
          schema: questScript.schema,
          version: questScript.version,
          mainObjectiveScripts: questScript.mainObjectiveScripts.filter(script => {
            const alternativeCount = Array.isArray(script.alternatives) ? script.alternatives.length : 0
            return sceneKeys.has(script.sceneKey) && (routeClass === 'multi'
              ? alternativeCount > 1 : alternativeCount <= 1)
          }),
          ...emptySupplemental,
        },
      ])
    })),
    'content.quest-script.supplemental': {
      schema: questScript.schema,
      version: questScript.version,
      mainObjectiveScripts: [],
      sideQuestScripts: questScript.sideQuestScripts,
      ambientEventScripts: questScript.ambientEventScripts,
    },
  }
}

function textAdventureQualityReviewBatchOutputs(options: {
  structureScores?: Partial<Record<'causality' | 'routeDifferentiation' | 'setupPayoff' | 'characterMotivation', number>>
  structureIssues?: unknown[]
  actIssues?: Partial<Record<1 | 2 | 3, unknown[]>>
} = {}) {
  const structureScores = {
    causality: 4, routeDifferentiation: 4, setupPayoff: 4, characterMotivation: 4,
    ...options.structureScores,
  }
  return {
    'content.adventure-quality-review.structure': {
      schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
      scope: 'structure', scores: structureScores,
      issues: options.structureIssues ?? [], passed: true,
    },
    ...Object.fromEntries(([1, 2, 3] as const).map(act => [
      `content.adventure-quality-review.act-${act}`,
      {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
        scope: `act-${act}`,
        scores: {
          causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
          characterMotivation: 4, emotionalImpact: 4,
        },
        issues: options.actIssues?.[act] ?? [], passed: true,
      },
    ])),
  }
}

function modelOutputs(
  worldHash: string,
  productType: ProductionProductKindV1 = 'avg',
  characterAnchorRef = 'character:0',
  playerRole = '扮演冻结 Brief 主角',
) {
  return {
    'production.supervision': productionSupervisionOutput(),
    'content.design': {
      schema: 'storyforge.product-design-artifact', version: 1, title: '雾港抉择',
      logline: '玩家必须在潮汐封锁前选择真相或庇护。', playerGoal: '调查港口信号并决定公开何种事实。',
      coreLoop: ['阅读现场', '作出选择', '承受后果'], sourceAnchors: [`world:${worldHash}`],
      invariants: ['冻结世界事实保持一致', '不得写回世界正式表'], tone: ['沉浸', '克制'],
      targetPlayMinutes: 20, targetEndingCount: 2,
    },
    'content.narrative': productType === 'text-adventure' ? {
      schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '雾港抉择',
      entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '潮门之前', summary: '玩家抵达潮门广场。', condition: {}, effects: [] },
        { key: 'square', kind: 'scene', title: '广场回声', summary: '玩家在潮门广场先理解封港局势。', condition: {}, effects: [] },
        { key: 'warehouse', kind: 'scene', title: '旧仓支路', summary: '旧仓街是一条承担额外风险的支路。', condition: {}, effects: [] },
        { key: 'tower', kind: 'choice', title: '信号塔抉择', summary: '决定公开或封存记录。', condition: {}, effects: [] },
        { key: 'truth-ending', kind: 'ending', title: '公开真相', summary: '真相改变了港口。', condition: {}, effects: [] },
        { key: 'shelter-ending', kind: 'ending', title: '守住庇护', summary: '秘密换来短暂安稳。', condition: {}, effects: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮声压过了塔顶的警铃。', order: 0 },
        { beatKey: 'beat.square', nodeKey: 'square', kind: 'narration', speakerKey: null, text: '雾中的人群把恐惧、责任与彼此矛盾的希望交给你。'.repeat(100), order: 0 },
        { beatKey: 'beat.warehouse', nodeKey: 'warehouse', kind: 'narration', speakerKey: null, text: '旧仓支路让你看见选择之外仍有人在承受代价。'.repeat(30), order: 0 },
        { beatKey: 'beat.tower', nodeKey: 'tower', kind: 'narration', speakerKey: null, text: '守灯人摊开最后一份信号记录。', order: 0 },
        { beatKey: 'beat.truth', nodeKey: 'truth-ending', kind: 'narration', speakerKey: null, text: '灯光把所有证词投向海面。', order: 0 },
        { beatKey: 'beat.shelter', nodeKey: 'shelter-ending', kind: 'narration', speakerKey: null, text: '门重新合拢，秘密仍在呼吸。', order: 0 },
      ],
      choices: [
        { choiceKey: 'choice.enter-square', sourceNodeKey: 'opening', text: '进入广场', description: '先理解局势', unavailableReason: '', targetNodeKey: 'square', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 0 },
        { choiceKey: 'choice.direct-tower', sourceNodeKey: 'square', text: '直接前往信号塔', description: '聚焦主线', unavailableReason: '', targetNodeKey: 'tower', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 0 },
        { choiceKey: 'choice.warehouse', sourceNodeKey: 'square', text: '绕行旧仓街', description: '承担额外风险', unavailableReason: '', targetNodeKey: 'warehouse', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 1 },
        { choiceKey: 'choice.warehouse-tower', sourceNodeKey: 'warehouse', text: '带着新发现前往信号塔', description: '支路汇流', unavailableReason: '', targetNodeKey: 'tower', displayCondition: {}, availableCondition: {}, effects: [], tags: [], order: 0 },
        { choiceKey: 'choice.truth', sourceNodeKey: 'tower', text: '公开信号记录', description: '承担真相的后果', unavailableReason: '', targetNodeKey: 'truth-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['truth'], order: 0 },
        { choiceKey: 'choice.shelter', sourceNodeKey: 'tower', text: '封存信号记录', description: '保护眼前的人', unavailableReason: '', targetNodeKey: 'shelter-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['shelter'], order: 1 },
      ],
    } : {
      schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '雾港抉择',
      entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '潮门之前', summary: '玩家抵达信号塔。', condition: {}, effects: [] },
        { key: '公开真相结局', kind: 'scene', title: '公开真相', summary: '真相改变了港口。', condition: {}, effects: [] },
        { key: 'shelter-ending', kind: 'ending', title: '守住庇护', summary: '秘密换来短暂安稳。', condition: {}, effects: [] },
        { key: '未连接草稿', kind: 'scene', title: '未采用草稿', summary: '供应商附带但入口不可达的草稿节点。', condition: {}, effects: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮声压过了塔顶的警铃。', order: 0 },
        { beatKey: '真相段落', nodeKey: '公开真相结局', kind: 'narration', speakerKey: null, text: '灯光把所有证词投向海面。', order: 0 },
        { beatKey: 'beat.shelter', nodeKey: 'shelter-ending', kind: 'narration', speakerKey: null, text: '门重新合拢，秘密仍在呼吸。', order: 0 },
        { beatKey: '草稿段落', nodeKey: '未连接草稿', kind: 'narration', speakerKey: null, text: '这段草稿不进入可玩闭包。', order: 0 },
      ],
      choices: [
        { choiceKey: '公开真相选项', sourceNodeKey: 'opening', text: '公开信号记录', description: '承担真相的后果', unavailableReason: '', targetNodeKey: '公开真相结局', displayCondition: {}, availableCondition: {}, effects: [], tags: ['真相'], order: 0 },
        { choiceKey: 'choice.shelter', sourceNodeKey: 'opening', text: '封存信号记录', description: '保护眼前的人', unavailableReason: '', targetNodeKey: 'shelter-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['shelter'], order: 1 },
      ],
    },
    'content.product-module': productType === 'text-adventure' ? {
      schema: 'storyforge.text-adventure-systems-artifact', version: 1,
      abilities: [
        { key: 'ability.health-capacity', title: '生命上限', description: '决定生命资源的承受上限。', role: 'stat', initial: 10, minimum: 0, maximum: 100 },
        { key: 'ability.mana-capacity', title: '法力上限', description: '决定法力资源的承受上限。', role: 'stat', initial: 8, minimum: 0, maximum: 100 },
        { key: 'ability.attack', title: '攻击', description: '通用攻击能力。', role: 'stat', initial: 3, minimum: 0, maximum: 20 },
        { key: 'ability.defense', title: '防御', description: '通用防护能力。', role: 'stat', initial: 3, minimum: 0, maximum: 20 },
        { key: 'ability.agility', title: '敏捷', description: '快速反应与精细行动。', role: 'stat', initial: 3, minimum: 0, maximum: 20 },
        { key: 'ability.perception', title: '感知', description: '发现环境细节。', role: 'stat', initial: 4, minimum: 0, maximum: 20 },
        { key: 'ability.exploration', title: '探索', description: '调查环境并寻找路径。', role: 'skill', initial: 4, minimum: 0, maximum: 20 },
        { key: 'ability.negotiation', title: '交涉', description: '通过沟通改变局面。', role: 'skill', initial: 4, minimum: 0, maximum: 20 },
        { key: 'ability.craft', title: '技艺', description: '运用工具与专业知识。', role: 'skill', initial: 4, minimum: 0, maximum: 20 },
        { key: 'ability.resolve', title: '意志', description: '面对压力保持行动。', role: 'skill', initial: 4, minimum: 0, maximum: 20 },
      ],
      resources: [
        { key: 'resource.health', title: '生命', description: '承受行动代价。', role: 'health', initial: 10, minimum: 0, maximum: 10 },
        { key: 'resource.mana', title: '法力', description: '驱动特殊能力。', role: 'mana', initial: 8, minimum: 0, maximum: 8 },
        { key: 'resource.stamina', title: '体力', description: '持续行动所需。', role: 'stamina', initial: 10, minimum: 0, maximum: 10 },
        { key: 'resource.experience', title: '经验', description: '记录成长。', role: 'experience', initial: 0, minimum: 0, maximum: 1000 },
        { key: 'resource.skill-points', title: '技能点', description: '用于能力成长。', role: 'skill-points', initial: 0, minimum: 0, maximum: 100 },
        { key: 'resource.currency', title: '货币', description: '通用交换资源。', role: 'currency', initial: 2, minimum: 0, maximum: 1000 },
        { key: 'resource.clock', title: '时间', description: '世界行动时间。', role: 'clock', initial: 0, minimum: 0, maximum: 100000 },
      ],
      equipmentSlots: [
        { key: 'slot.weapon', title: '武器', acceptsTags: ['weapon'] },
        { key: 'slot.body', title: '身体', acceptsTags: ['armor'] },
        { key: 'slot.accessory', title: '饰品', acceptsTags: ['accessory'] },
      ],
      starterEquipment: [{
        key: 'item.starter-lamp', title: '守灯杖', description: '能照亮雾中标记的旧灯杖。',
        slotKey: 'slot.weapon', tags: ['weapon'], modifierAbilityKey: 'ability.perception', modifierDelta: 1,
      }, {
        key: 'item.starter-cloak', title: '守灯披风', description: '能抵御潮雾侵蚀的旧披风。',
        slotKey: 'slot.body', tags: ['armor'], modifierAbilityKey: 'ability.resolve', modifierDelta: 1,
      }],
    } : {
      schema: 'storyforge.product-module-artifact', version: 1, productType,
      interfaceStyle: '低饱和雾港舞台，文字保持高对比。', interactionNotes: ['每次选择后明确展示后果。'],
      presentationPolicy: { pacing: 'balanced', transitionMs: 500, backgroundStrategy: 'key-scenes' },
    },
    'content.adventure-architecture': {
      schema: 'storyforge.text-adventure-architecture-artifact', version: 1,
      title: '雾港抉择', premise: '玩家穿行雾港，在潮门关闭前决定信号记录的去向。',
      emotionalPromise: '从猜疑走向承担，让每个结局回应玩家的选择。', themes: ['信任', '责任'],
      regions: [{
        title: '雾港大区', description: '被潮汐与旧信号塔控制的沿海大区。',
        areas: [{
          title: '外港区', description: '商船与守灯人聚集的入口区域。',
          locations: [
            { title: '潮门广场', description: '通往各处的石砌广场。', tags: ['hub'] },
            { title: '旧仓街', description: '堆放航海物资的狭长街区。', tags: ['trade'] },
          ],
        }, {
          title: '灯塔区', description: '掌控港口信号的高地。',
          locations: [{ title: '信号塔', description: '保存最后一份信号记录的塔楼。', tags: ['climax'] }],
        }],
      }],
      visualBible: {
        style: '克制的手绘海港奇幻风格。', palette: ['#0d1b2a', '#31506b', '#d8b26e'],
        compositionRules: ['环境优先于装饰', '关键人物保持轮廓一致'],
        characterAnchorNotes: ['守灯人使用深蓝制服与铜色灯具'],
      },
    },
    'content.adventure-side-quests': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 2, bundleKind: 'side',
      entries: [{
        key: 'lost-lamp', title: '失落的引航灯', description: '找回被潮水卷走的引航灯。',
        hook: '旧仓街的一名船工请求你在潮门关闭前帮忙。',
        stages: [{
          key: 'trace', title: '追查灯迹', objective: '在旧仓街追查引航灯留下的痕迹',
          locationOrdinal: 2, actionKind: 'inspect', abilityKey: 'ability.perception', difficulty: 10,
          successText: '你在旧仓街木箱夹层找到了引航灯。',
          costlySuccessText: '你在旧仓街找到了灯，但划伤了手臂。',
          failureText: '引航灯被冲出旧仓街，但船工指出了沿岸留下的新痕迹。', timeCostMinutes: 6,
        }, {
          key: 'relight', title: '重新点灯', objective: '在信号塔重新点亮引航灯',
          locationOrdinal: 3, actionKind: 'use', abilityKey: 'ability.resolve', difficulty: 11,
          successText: '你在信号塔重新点亮了引航灯。',
          costlySuccessText: '你在信号塔点亮灯火，却耗尽了备用燃料。',
          failureText: '信号塔的灯芯损坏，但应急反光板仍为船队打开了归路。', timeCostMinutes: 8,
        }],
        rewardExperience: 5, rewardCurrency: 2,
      }],
    },
    'content.adventure-ambient-events': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 2, bundleKind: 'ambient',
      entries: [{
        key: 'tide-warning', title: '潮汐警告', description: '辨认潮门墙上的水位记号。',
        hook: '潮门广场的海水正漫过旧刻度。', stages: [{
          key: 'read-tide', title: '读取潮汐', objective: '在潮门广场判断安全通过时间', locationOrdinal: 1,
          actionKind: 'inspect', abilityKey: 'ability.perception', difficulty: 8,
          successText: '你在潮门广场准确读出了潮汐变化。',
          costlySuccessText: '你在潮门广场读懂刻度，但浪费了一些时间。',
          failureText: '你在潮门广场判断失误，却因此发现墙后的避险通道。', timeCostMinutes: 5,
        }], rewardExperience: 2, rewardCurrency: 0,
      }, {
        key: 'warehouse-echo', title: '仓街回声', description: '追查仓街深处反复出现的敲击声。',
        hook: '旧仓街的雾里传来规律的三次敲击。', stages: [{
          key: 'follow-echo', title: '追随回声', objective: '在旧仓街确认敲击声来源', locationOrdinal: 2,
          actionKind: 'attempt', abilityKey: 'ability.resolve', difficulty: 9,
          successText: '你在旧仓街发现那是被困船员的求救信号。',
          costlySuccessText: '你在旧仓街救出船员，但耽误了赶往灯塔的时间。',
          failureText: '旧仓街的声音消失了，却留下一张通往灯塔的旧图。', timeCostMinutes: 8,
        }], rewardExperience: 3, rewardCurrency: 1,
      }],
    },
    ...textAdventureQualityReviewBatchOutputs(),
    'qa.playtest-strategy': playtestStrategyOutput(),
    'media.requirements': {
      schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: [
        { artifactKey: 'media.visual.001', mediaKind: 'background', sceneTag: 'opening', beatKey: 'beat.opening', prompt: '雾港信号塔与潮门的宽幅原创场景。', altText: '雾中的港口信号塔和潮门。', width: 1280, height: 720, palette: ['#0d1b2a', '#31506b', '#d8b26e'], characterAnchorRefs: [], hardConstraints: [] },
        { artifactKey: 'media.visual.002', mediaKind: 'character-pose', sceneTag: 'protagonist', beatKey: 'beat.opening', prompt: '披风主角的原创剪影立绘。', altText: '站在雾中的披风主角。', width: 720, height: 1080, palette: ['#14213d', '#6c7a89', '#e5c07b'], characterAnchorRefs: [characterAnchorRef], hardConstraints: ['不得写回世界正式表', '保持角色身份、年龄段与核心视觉特征', `角色定位：${playerRole}`].sort() },
      ],
      audio: [
        { artifactKey: 'media.audio.001', mediaKind: 'bgm', sceneTag: 'opening', beatKey: 'beat.opening', prompt: '雾港开场的克制主题音。', altText: '低沉而克制的雾港主题音。', durationMs: 3000 },
        { artifactKey: 'media.audio.002', mediaKind: 'sfx', sceneTag: 'opening-bell', beatKey: 'beat.opening', prompt: '远处的港口警铃。', altText: '远处港口警铃声。', durationMs: 1000 },
        { artifactKey: 'media.audio.003', mediaKind: 'sfx', sceneTag: 'truth-light', beatKey: 'beat.generated.002', prompt: '信号灯启动的短促电流声。', altText: '信号灯启动声。', durationMs: 1000 },
        { artifactKey: 'media.audio.004', mediaKind: 'sfx', sceneTag: 'shelter-door', beatKey: 'beat.shelter', prompt: '沉重潮门缓慢闭合。', altText: '潮门闭合声。', durationMs: 1000 },
      ],
    },
  } as const
}

function aiTownMediaRequirements(brief: ProductProductionBriefV3) {
  const settings = brief.aiTown!
  const characterAnchors = settings.sourceSelection.residentResourceKeys
  const visual: Array<Record<string, unknown>> = []
  const appendVisual = (value: Record<string, unknown>) => visual.push({
    artifactKey: `media.visual.${String(visual.length + 1).padStart(3, '0')}`,
    beatKey: 'beat.opening', prompt: '原创后日谈小镇画面，保持冻结世界的身份连续性。',
    altText: '后日谈小镇发布媒资。', palette: ['#18392b', '#58745f', '#e4cfaa'],
    hardConstraints: [], ...value,
  })
  if (settings.media.locationCards) {
    for (let index = 0; index < settings.town.majorLocationTarget; index += 1) appendVisual({
      mediaKind: 'background', sceneTag: `town-location-${String(index + 1).padStart(3, '0')}`,
      width: 1280, height: 720, characterAnchorRefs: [],
    })
  }
  if (settings.media.portraits) {
    for (let index = 0; index < settings.town.residentTarget; index += 1) appendVisual({
      mediaKind: 'character-pose', sceneTag: `town-resident-${String(index + 1).padStart(3, '0')}`,
      width: 720, height: 1080, characterAnchorRefs: [characterAnchors[index]],
    })
  }
  if (settings.media.expressions) {
    for (let index = 0; index < settings.town.residentTarget; index += 1) appendVisual({
      mediaKind: 'character-expression', sceneTag: `town-resident-${String(index + 1).padStart(3, '0')}-expression`,
      width: 720, height: 1080, characterAnchorRefs: [characterAnchors[index]],
    })
  }
  return {
    schema: 'storyforge.product-media-requirements-artifact', version: 2,
    visual,
    audio: brief.media.sfxCount > 0 ? [{
      artifactKey: 'media.audio.001', mediaKind: 'ambience', sceneTag: 'town-ambience',
      beatKey: 'beat.opening', prompt: '安静、可循环的小镇环境声。', altText: '小镇环境音。', durationMs: 3000,
    }] : [],
  }
}

function professionalTextAdventurePlanningOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
  frozenLocationTitles: readonly string[] = ['潮门广场', '旧仓街', '信号塔'],
) {
  const contract = brief.textAdventure!
  const skeleton = textAdventureNarrativeSkeletonV1(brief)
  const sceneKeys = skeleton.sceneKeys
  const sceneCount = sceneKeys.length
  const sceneLocationPlan = planTextAdventureNarrativeLocationsV1(
    sceneCount,
    contract.narrative.targetLocationCount,
  )
  const npcCount = brief.qualityProfile === 'commercial-candidate'
    ? Math.max(5, Math.ceil(brief.scale.targetPlayMinutes / 12)) : 2
  const characters = [{
    key: 'character.player', role: 'player' as const, sourceResourceKey: null, name: '守灯人',
    publicIdentity: '负责维护潮门信号的年轻守灯人。', desire: '让港口在风暴中活下来。',
    fear: '自己的选择会牺牲无辜者。', secret: '曾经隐瞒一次错误警报。', motivation: '弥补旧错并守住共同体。',
    voice: '简短、克制，面对责任时不回避。', initialKnowledge: ['潮门即将关闭'],
    forbiddenKnowledge: ['不知道议会密封记录的完整内容'], relationshipArc: ['被居民怀疑', '以行动赢得或失去信任'],
    visualAnchor: '深蓝守灯制服、铜色灯杖、被海风磨白的披风边缘。',
  }, ...Array.from({ length: npcCount }, (_, index) => ({
    key: `character.npc.${index + 1}`, role: index < 2 ? 'major-npc' as const : 'supporting-npc' as const,
    sourceResourceKey: null, name: `港民 ${index + 1}`, publicIdentity: `掌握第 ${index + 1} 段港口生活线索的居民。`,
    desire: `保护自己负责的港口群体 ${index + 1}。`, fear: '真相引发无法控制的报复。',
    secret: `隐瞒与第 ${index + 1} 次潮汐事故有关的一项选择。`, motivation: '在公共责任与私人牵挂之间寻找出路。',
    voice: `说话具体，常以第 ${index + 1} 号灯标比喻风险。`, initialKnowledge: [`知道线索 ${index + 1}`],
    forbiddenKnowledge: ['不知道其他角色未公开的秘密'], relationshipArc: ['试探守灯人', '根据玩家行动选择协助或疏远'],
    visualAnchor: `海港工作服，携带能辨认身份的 ${index + 1} 号铜制工具。`,
  }))]
  const storyEndings = Array.from({ length: Math.max(brief.scale.targetEndingCount, 4) }, (_, index) => ({
    key: `ending.${String(index + 1).padStart(3, '0')}`, title: `潮声之后 ${index + 1}`,
    dramaticAnswer: `玩家以第 ${index + 1} 种代价回答公开真相与保护共同体能否共存。`,
    requiredConsequences: [`承认选择 ${index + 1} 的代价`, `兑现人物关系 ${index + 1} 的变化`],
  }))
  const setupPayoffs = [{
    key: 'setup.warning-bell', setup: '第一幕异常警铃总比潮汐早三分钟响起。',
    payoff: '第三幕证实警铃被某人提前校准，用来为撤离争取时间。', introducedAct: 1, resolvedAct: 3,
  }, {
    key: 'setup.copper-mark', setup: '铜制灯标背面刻着被磨损的共同誓言。',
    payoff: '终局时誓言成为居民是否相信玩家的情感证据。', introducedAct: 1, resolvedAct: 3,
  }]
  const actSceneCounts = [0, 1, 2].map(actIndex => (
    Math.floor(sceneCount / 3) + (actIndex < sceneCount % 3 ? 1 : 0)
  ))
  const minuteCounts = [0, 1, 2].map(actIndex => (
    Math.floor(brief.scale.targetPlayMinutes / 3) + (actIndex < brief.scale.targetPlayMinutes % 3 ? 1 : 0)
  ))
  let sceneOffset = 0
  const acts = actSceneCounts.map((count, actIndex) => {
    const sceneCards = sceneKeys.slice(sceneOffset, sceneOffset + count).map((sceneKey, localIndex) => ({
      key: sceneKey,
      title: `${frozenLocationTitles[sceneLocationPlan[sceneOffset + localIndex].locationIndex]} · 第 ${actIndex + 1} 幕场景 ${localIndex + 1}`,
      locationOrdinal: sceneLocationPlan[sceneOffset + localIndex].locationOrdinal,
      purpose: '推进主冲突并让玩家获得可行动的信息。', conflict: '公开事实与保护眼前人物无法同时零成本完成。',
      entryState: '玩家带着上一场留下的关系与资源后果进入。', exitState: '局面发生不可忽略的变化并开启下一目标。',
      castKeys: ['character.player', `character.npc.${(sceneOffset + localIndex) % npcCount + 1}`],
      setupKeys: actIndex === 0 ? [setupPayoffs[localIndex % setupPayoffs.length].key] : [],
      payoffKeys: actIndex === 2 ? [setupPayoffs[localIndex % setupPayoffs.length].key] : [],
    }))
    sceneOffset += count
    return {
      key: `act.${actIndex + 1}`, title: `第 ${actIndex + 1} 幕`, targetMinutes: minuteCounts[actIndex],
      goal: '完成本幕可验证目标并提高风险。', irreversibleTurn: '玩家的选择改变后续人物立场与可用资源。', sceneCards,
    }
  })
  const decisions = skeleton.statefulDecisionSceneKeys.map((sceneKey, index) => {
    const sceneIndex = sceneKeys.indexOf(sceneKey)
    return {
      key: `decision.${index + 1}`, sceneKey,
      prompt: `第 ${index + 1} 次关键决定要承担什么代价？`, options: [0, 1].map(optionIndex => ({
        key: `option.${index + 1}.${optionIndex + 1}`, label: optionIndex === 0 ? '公开承担' : '暂时保护',
        cost: optionIndex === 0 ? '失去一名角色的信任' : '消耗有限的撤离时间',
        persistentEffectKey: `flag.decision.${index + 1}.${optionIndex + 1}`,
        echoSceneKeys: sceneKeys.slice(sceneIndex + 1, sceneIndex + 3),
      })),
    }
  })
  const stageCount = brief.qualityProfile === 'commercial-candidate'
    ? Math.max(3, Math.ceil(brief.scale.targetPlayMinutes / 20)) : 3
  const objectiveCount = brief.qualityProfile === 'commercial-candidate'
    ? Math.max(8, Math.ceil(brief.scale.targetPlayMinutes / 7.5)) : 8
  const objectiveKeys = Array.from({ length: objectiveCount }, (_, index) => `objective.${index + 1}`)
  const stageIndexForObjective = (objectiveIndex: number) => Math.min(
    stageCount - 1,
    Math.floor(objectiveIndex * stageCount / objectiveCount),
  )
  const stages = Array.from({ length: stageCount }, (_, stageIndex) => ({
    key: `stage.${stageIndex + 1}`, title: `主线阶段 ${stageIndex + 1}`,
    objectiveKeys: objectiveKeys.filter((_, index) => stageIndexForObjective(index) === stageIndex),
  }))
  const mainQuestPlan = {
    schema: 'storyforge.text-adventure-quest-plan-artifact' as const, version: 1 as const, bundleKind: 'main' as const,
    quests: [{
      key: 'quest.main', title: '最后的灯火', description: '调查信号记录、协调港民并决定潮门命运。',
      characterKeys: characters.map(character => character.key), stages,
      objectives: objectiveKeys.map((objectiveKey, index) => {
        const sceneIndex = Math.min(sceneKeys.length - 1, Math.floor(index * sceneKeys.length / objectiveCount))
        return {
          key: objectiveKey, stageKey: stages[stageIndexForObjective(index)].key, title: `主线目标 ${index + 1}`,
          narrativePurpose: '把场景冲突转成玩家可执行且有后果的任务。',
          sceneKeys: [sceneKeys[sceneIndex]],
          locationOrdinal: sceneLocationPlan[sceneIndex].locationOrdinal,
          alternatives: Array.from({ length: index < 2 ? 2 : 1 }, (_, alternativeIndex) => ({
            key: `alternative.${index + 1}.${alternativeIndex + 1}`,
            actionKind: alternativeIndex === 0 ? 'inspect' as const : 'talk' as const,
            targetCharacterKey: alternativeIndex === 1
              ? `character.npc.${sceneIndex % npcCount + 1}` : null,
            cost: '消耗时间或关系信任。',
            successConsequence: '目标完成并让后续人物态度发生可见变化。',
            failureForwardConsequence: '目标未按预期完成，但获得替代入口并继续主线。',
            persistentEffectKeys: [`flag.objective.${index + 1}.${alternativeIndex + 1}`],
          })),
        }
      }),
    }],
  }
  const mainObjectiveScripts = mainQuestPlan.quests[0].objectives.map(objective => ({
    objectiveKey: objective.key, sceneKey: objective.sceneKeys[0],
    alternatives: objective.alternatives.map(alternative => ({
      alternativeKey: alternative.key,
      resolution: alternative.actionKind === 'talk'
        ? { mode: 'automatic' as const, abilityKey: null, difficulty: null, costlySuccessFloor: null }
        : { mode: 'check' as const, abilityKey: 'ability.perception', difficulty: 10, costlySuccessFloor: 6 },
      timeCostMinutes: 5,
      successText: `你完成了${objective.title}，局面沿可验证的行动继续推进。`,
      costlySuccessText: `你完成了${objective.title}，但时间和身体状态付出了明确代价。`,
      failureForwardText: `你没有按预期完成${objective.title}，却获得替代入口并继续主线。`,
    })),
  }))
  const questScript = {
    schema: 'storyforge.text-adventure-quest-script-artifact' as const,
    version: 2 as const,
    mainObjectiveScripts,
    sideQuestScripts: [{
      entryKey: 'lost-lamp', stages: [{
        stageKey: 'trace', actionKind: 'inspect', abilityKey: 'ability.perception',
        difficulty: 10, costlySuccessFloor: 6, timeCostMinutes: 6,
        successText: '你在旧仓街木箱夹层找到了引航灯。',
        costlySuccessText: '你在旧仓街找到引航灯，但手臂受伤。',
        failureForwardText: '灯被冲出旧仓街，但船工指出了沿岸留下的新痕迹。',
      }, {
        stageKey: 'relight', actionKind: 'use', abilityKey: 'ability.resolve',
        difficulty: 11, costlySuccessFloor: 7, timeCostMinutes: 8,
        successText: '你在信号塔重新点亮了引航灯。',
        costlySuccessText: '你在信号塔点亮灯火，却耗尽了备用燃料。',
        failureForwardText: '信号塔的灯芯损坏，但应急反光板仍为船队打开了归路。',
      }],
    }],
    ambientEventScripts: [{
      entryKey: 'tide-warning', stages: [{
        stageKey: 'read-tide', actionKind: 'inspect', abilityKey: 'ability.perception',
        difficulty: 8, costlySuccessFloor: 4, timeCostMinutes: 5,
        successText: '你在潮门广场准确读出了潮汐变化。',
        costlySuccessText: '你在潮门广场读懂刻度，但浪费了一些时间。',
        failureForwardText: '你在潮门广场判断失误，却因此发现墙后的避险通道。',
      }],
    }, {
      entryKey: 'warehouse-echo', stages: [{
        stageKey: 'follow-echo', actionKind: 'attempt', abilityKey: 'ability.resolve',
        difficulty: 9, costlySuccessFloor: 5, timeCostMinutes: 8,
        successText: '你在旧仓街发现那是被困船员的求救信号。',
        costlySuccessText: '你在旧仓街救出船员，但耽误了赶往灯塔的时间。',
        failureForwardText: '旧仓街的声音消失了，却留下一张通往灯塔的旧图。',
      }],
    }],
  }
  return {
    'content.source-sufficiency': {
      schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
      decision: 'ready', adaptationStrategy: 'adapt-rich',
      coverage: [{ domain: 'world-premise', status: 'sufficient', resourceKeys: [], rationale: '冻结世界前提足以建立产品私域冒险。' }],
      gaps: [], privateAdditions: [], authorDecisionRequired: false,
    },
    'content.story-bible': {
      schema: 'storyforge.text-adventure-story-bible-artifact', version: 1, title: '雾港抉择',
      premise: '潮门关闭前，守灯人必须决定如何处理会改变港口秩序的信号记录。',
      playerFantasy: '以有限资源承担共同体守护者的艰难选择。', thematicQuestion: '真相与保护能否在责任中共存？',
      emotionalPromise: '让玩家从被怀疑走向承担，并在结局看见关系回响。', centralConflict: '公开记录会引发冲突，封存记录会延续伤害。',
      canonFacts: ['潮门按冻结规则关闭', '信号塔保存港口记录', '玩家不能改写世界引擎事实'],
      productPrivateFacts: [], prohibitions: ['不得临时制造推翻冻结世界的幕后设定'], setupPayoffs,
      endings: storyEndings.slice(0, brief.scale.targetEndingCount),
    },
    'content.cast-bible': {
      schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1, characters,
    },
    'content.narrative-arc-scenes': {
      schema: 'storyforge.text-adventure-narrative-arc-scenes-artifact', version: 1,
      acts,
      endings: storyEndings.slice(0, brief.scale.targetEndingCount).map(ending => ({
        endingKey: ending.key, sceneKey: sceneKeys[sceneKeys.length - 1],
      })),
    },
    'content.narrative-decision-plan': {
      schema: 'storyforge.text-adventure-narrative-decision-plan-artifact', version: 1,
      decisions,
    },
    'content.narrative-arc-plan': {
      schema: 'storyforge.text-adventure-narrative-arc-plan-artifact', version: 1,
      acts, decisions,
      endings: storyEndings.slice(0, brief.scale.targetEndingCount).map(ending => ({
        endingKey: ending.key, sceneKey: sceneKeys[sceneKeys.length - 1],
      })),
    },
    'content.ending-route-plan': {
      schema: 'storyforge.text-adventure-ending-route-plan-artifact', version: 1,
      routes: storyEndings.slice(0, brief.scale.targetEndingCount).map((ending, endingIndex, endings) => ({
        endingKey: ending.key,
        requiredEffectKeys: [
          ...decisions.slice(0, endingIndex).map(decision => decision.options[1].persistentEffectKey),
          ...(endingIndex < endings.length - 1
            ? [decisions[endingIndex].options[0].persistentEffectKey] : []),
        ],
        rationale: `${ending.title}由此前已登记选择的持久状态唯一决定。`,
      })),
    },
    'content.main-quest-plan': mainQuestPlan,
    'content.quest-script': questScript,
    ...questScriptRunOutputs(brief, questScript),
  } as const
}

function professionalTextAdventureSceneScriptOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
  planning: ReturnType<typeof professionalTextAdventurePlanningOutputs>,
  locationTitles: string[],
) {
  const storyBible = planning['content.story-bible']
  const arcPlan = planning['content.narrative-arc-plan']
  const castBible = planning['content.cast-bible']
  const skeleton = textAdventureNarrativeSkeletonV1(brief)
  const locations = planTextAdventureNarrativeLocationsV1(skeleton.sceneKeys.length, locationTitles.length)
  const sceneCards = arcPlan.acts.flatMap(act => act.sceneCards)
  const sceneCardByKey = new Map(sceneCards.map(scene => [scene.key, scene]))
  const npcKeys = castBible.characters.filter(character => character.role !== 'player').map(character => character.key)
  const endingByKey = new Map(storyBible.endings.map(ending => [ending.key, ending]))
  const targetUnitsPerScene = Math.max(240, Math.ceil(brief.scale.targetWordCount / skeleton.sceneKeys.length) + 80)
  const sceneScriptOutputs = Object.fromEntries([0, 1, 2].map(actIndex => {
    const sceneKeys = textAdventureActSceneKeysV1(brief, actIndex)
    const scenes = sceneKeys.map(sceneKey => {
      const sceneIndex = skeleton.sceneKeys.indexOf(sceneKey)
      const sceneCard = sceneCardByKey.get(sceneKey)!
      const sceneNpcKeys = sceneCard.castKeys.filter(key => key !== 'character.player')
      const locationTitle = locationTitles[locations[sceneIndex].locationIndex]
      const beatCount = Math.max(5, Math.ceil(targetUnitsPerScene / 75))
      const beats = Array.from({ length: beatCount }, (_, beatIndex) => {
        const dialogue = beatIndex % 2 === 1
        const turningPoint = ['确认风险', '交换条件', '承担代价', '发现回响'][beatIndex % 4]
        return {
          beatKey: `beat.act-${actIndex + 1}.${String(sceneIndex + 1).padStart(3, '0')}.${String(beatIndex + 1).padStart(3, '0')}`,
          kind: dialogue ? 'dialogue' as const : beatIndex % 4 === 2 ? 'action' as const : 'narration' as const,
          speakerKey: dialogue ? sceneNpcKeys[beatIndex % sceneNpcKeys.length] : null,
          text: dialogue
            ? `${locationTitle}的第${sceneIndex + 1}场对话推进到第${beatIndex + 1}个回合。角色不再复述已知事实，而是围绕${turningPoint}提出具体条件，逼迫守灯人把责任、关系和有限时间放在同一个选择里衡量。`
            : `${locationTitle}的潮声在第${sceneIndex + 1}场发生了新的变化。第${beatIndex + 1}段行动让${sceneCard.conflict}从抽象矛盾变成眼前可见的后果，也把${sceneCard.purpose}所需的信息交到玩家手中。`,
          order: beatIndex,
        }
      })
      return {
        sceneKey,
        title: sceneCard.title,
        summary: `${locationTitle}内，${sceneCard.purpose}；玩家进入时${sceneCard.entryState}，离开时${sceneCard.exitState}。`,
        beats,
      }
    })
    const choices = skeleton.edges.filter(edge => sceneKeys.includes(edge.sourceNodeKey)).map(edge => ({
      choiceKey: edge.choiceKey,
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      text: edge.targetNodeKey.startsWith('ending.')
        ? `接受${endingByKey.get(edge.targetNodeKey)!.title}的结局`
        : edge.order === 0 ? '以公开承担的方式前往下一场景' : '以保护同伴的方式前往下一场景',
      description: edge.order === 0
        ? '把事实公开给相关角色，以关系压力换取共同决策。'
        : '先保护眼前的人，以有限时间和后续信任承担代价。',
      unavailableReason: '必须先完成当前场景的主线目标。',
      order: edge.order,
    }))
    const endings = actIndex === 2 ? skeleton.endingKeys.map((endingKey, endingIndex) => ({
      endingKey,
      title: endingByKey.get(endingKey)!.title,
      summary: endingByKey.get(endingKey)!.dramaticAnswer,
      beats: Array.from({ length: 4 }, (_, beatIndex) => ({
        beatKey: `beat.act-3.ending-${String(endingIndex + 1).padStart(3, '0')}.${String(beatIndex + 1).padStart(3, '0')}`,
        kind: beatIndex === 1 ? 'dialogue' as const : 'narration' as const,
        speakerKey: beatIndex === 1 ? npcKeys[endingIndex % npcKeys.length] : null,
        text: `结局${endingIndex + 1}的第${beatIndex + 1}个回响明确交代此前的选择如何改变港城、同行者和你的责任，并让${endingByKey.get(endingKey)!.requiredConsequences.join('与')}成为可以理解的结果。`,
        order: beatIndex,
      })),
    })) : []
    const taskKey = `content.scene-script.act-${actIndex + 1}`
    return [taskKey, {
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact' as const,
      version: 1 as const,
      actKey: `act.${actIndex + 1}`,
      moduleTitle: storyBible.title,
      scenes,
      choices,
      endings,
    }]
  })) as Record<string, {
    schema: 'storyforge.text-adventure-scene-script-bundle-artifact'
    version: 1
    actKey: string
    moduleTitle: string
    scenes: Array<{ sceneKey: string; title: string; summary: string; beats: Array<{
      beatKey: string; kind: 'narration' | 'dialogue' | 'action'; speakerKey: string | null; text: string; order: number
    }> }>
    choices: Array<{
      choiceKey: string; sourceNodeKey: string; targetNodeKey: string; text: string
      description: string; unavailableReason: string; order: number
    }>
    endings: Array<{ endingKey: string; title: string; summary: string; beats: Array<{
      beatKey: string; kind: 'narration' | 'dialogue'; speakerKey: string | null; text: string; order: number
    }> }>
  }>
  const dialoguePassOutputs = Object.fromEntries(Object.values(sceneScriptOutputs).map(bundle => {
    const dialogueBeats = [
      ...bundle.scenes.flatMap(scene => scene.beats),
      ...bundle.endings.flatMap(ending => ending.beats),
    ].filter(beat => beat.kind === 'dialogue').sort((left, right) => left.beatKey.localeCompare(right.beatKey))
    const choices = [...bundle.choices].sort((left, right) => left.choiceKey.localeCompare(right.choiceKey))
    const usedSpeakerKeys = [...new Set(dialogueBeats.map(beat => beat.speakerKey!))].sort()
    const taskKey = `content.dialogue-pass.act-${bundle.actKey.slice('act.'.length)}`
    return [taskKey, {
      schema: 'storyforge.text-adventure-dialogue-pass-artifact' as const,
      version: 1 as const,
      actKey: bundle.actKey,
      reviewedCharacterCount: usedSpeakerKeys.length,
      reviewedBeatCount: dialogueBeats.length,
      reviewedChoiceCount: choices.length,
      beatReviews: [],
      choiceReviews: [],
    }]
  }))
  const sceneScriptPartOutputs = Object.fromEntries(Object.entries(sceneScriptOutputs).flatMap(([taskKey, bundle]) => {
    const actIndex = Number(taskKey.slice('content.scene-script.act-'.length)) - 1
    return textAdventureSceneScriptPartSceneKeysV1(brief, actIndex).map((sceneKeys, partIndex, parts) => {
      const selected = new Set(sceneKeys)
      return [`${taskKey}.part-${partIndex + 1}`, {
        ...bundle,
        scenes: bundle.scenes.filter(scene => selected.has(scene.sceneKey)),
        choices: bundle.choices.filter(choice => selected.has(choice.sourceNodeKey)),
        endings: partIndex === parts.length - 1 ? bundle.endings : [],
      }]
    })
  }))
  return {
    ...sceneScriptOutputs,
    ...sceneScriptPartOutputs,
    ...dialoguePassOutputs,
  }
}

function fullLengthTextAdventureOutputs(
  brief: Awaited<ReturnType<typeof fixtureForProduct>>['brief'],
) {
  const base = modelOutputs(
    brief.source.worldContentHash, 'text-adventure', firstCharacterAnchor(brief), brief.intent.playerRole,
  )
  const contract = brief.textAdventure!
  const regions = Array.from({ length: contract.narrative.targetRegionCount }, (_, regionIndex) => ({
    title: `雾港大区 ${regionIndex + 1}`,
    description: `承载主线第 ${regionIndex + 1} 阶段的完整大区域。`,
    areas: Array.from({ length: contract.narrative.targetAreaCount / contract.narrative.targetRegionCount }, (_, areaIndex) => ({
      title: `区域 ${regionIndex + 1}-${areaIndex + 1}`,
      description: '连接主线、支线和环境事件的中层区域。',
      locations: Array.from({ length: contract.narrative.targetLocationCount / contract.narrative.targetAreaCount }, (_, locationIndex) => ({
        title: `地点 ${regionIndex + 1}-${areaIndex + 1}-${locationIndex + 1}`,
        description: '具备独立场景目标、环境反馈与移动出口的可玩地点。', tags: ['adventure'],
      })),
    })),
  }))
  const locationTitles = regions.flatMap(region => region.areas.flatMap(area => (
    area.locations.map(location => location.title)
  )))
  const questEntry = (kind: 'side' | 'ambient', index: number) => {
    const firstLocationOrdinal = index % locationTitles.length + 1
    const secondLocationOrdinal = firstLocationOrdinal % locationTitles.length + 1
    const stage = (
      stageIndex: number,
      locationOrdinal: number,
      actionKind: 'inspect' | 'use',
    ) => {
      const locationTitle = locationTitles[locationOrdinal - 1]
      return {
        key: `${kind}-${index + 1}.stage-${stageIndex + 1}`,
        title: `${locationTitle}阶段 ${stageIndex + 1}`,
        objective: `在${locationTitle}完成${kind === 'side' ? '支线' : '区域事件'}阶段 ${stageIndex + 1}`,
        locationOrdinal, actionKind,
        abilityKey: stageIndex % 2 ? 'ability.resolve' : 'ability.perception',
        difficulty: 9 + index + stageIndex,
        successText: `你在${locationTitle}完成行动并改变了局部状态。`,
        costlySuccessText: `你在${locationTitle}达成目标，但付出了明确代价。`,
        failureText: `你在${locationTitle}行动失败，却打开了替代局面并继续推进。`,
        timeCostMinutes: 6 + stageIndex * 2,
      }
    }
    return {
      key: `${kind}-${index + 1}`, title: `${kind === 'side' ? '支线' : '区域事件'} ${index + 1}`,
      description: `${locationTitles[firstLocationOrdinal - 1]}里，与主线主题呼应但拥有独立目标和回响。`,
      hook: '一个可理解的局面邀请玩家介入。',
      stages: kind === 'side'
        ? [stage(0, firstLocationOrdinal, 'inspect'), stage(1, secondLocationOrdinal, 'use')]
        : [stage(0, firstLocationOrdinal, 'inspect')],
      rewardExperience: 3, rewardCurrency: 1,
    }
  }
  const professional = professionalTextAdventurePlanningOutputs(brief, locationTitles)
  const sceneScripts = professionalTextAdventureSceneScriptOutputs(brief, professional, locationTitles)
  const sideEntries = Array.from(
    { length: contract.narrative.targetSideQuestCount }, (_, index) => questEntry('side', index),
  )
  const ambientEntries = Array.from(
    { length: contract.narrative.targetAmbientEventCount }, (_, index) => questEntry('ambient', index),
  )
  const mainPlan = professional['content.main-quest-plan']
  const scriptedSupplemental = (entries: typeof sideEntries) => (
    entries.map(entry => ({
      entryKey: entry.key,
      stages: entry.stages.map(stage => ({
        stageKey: stage.key, actionKind: stage.actionKind, abilityKey: stage.abilityKey,
        difficulty: stage.difficulty, costlySuccessFloor: Math.max(1, stage.difficulty - 4),
        timeCostMinutes: stage.timeCostMinutes,
        successText: stage.successText, costlySuccessText: stage.costlySuccessText,
        failureForwardText: stage.failureText,
      })),
    }))
  )
  const questScript = {
    schema: 'storyforge.text-adventure-quest-script-artifact' as const, version: 2 as const,
    mainObjectiveScripts: mainPlan.quests[0].objectives.map(objective => ({
      objectiveKey: objective.key, sceneKey: objective.sceneKeys[0],
      alternatives: objective.alternatives.map(alternative => ({
        alternativeKey: alternative.key,
        resolution: alternative.actionKind === 'talk'
          ? { mode: 'automatic' as const, abilityKey: null, difficulty: null, costlySuccessFloor: null }
          : { mode: 'check' as const, abilityKey: 'ability.perception', difficulty: 10, costlySuccessFloor: 6 },
        timeCostMinutes: 5,
        successText: `你完成了${objective.title}，主线获得清晰进展。`,
        costlySuccessText: `你完成了${objective.title}，但付出了时间和体力。`,
        failureForwardText: `你没有按预期完成${objective.title}，却找到替代推进方式。`,
      })),
    })),
    sideQuestScripts: scriptedSupplemental(sideEntries),
    ambientEventScripts: scriptedSupplemental(ambientEntries),
  }
  return {
    ...base,
    ...professional,
    ...sceneScripts,
    'content.adventure-architecture': {
      ...base['content.adventure-architecture'],
      regions,
    },
    'content.adventure-side-quests': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 2 as const, bundleKind: 'side' as const,
      entries: sideEntries,
    },
    'content.adventure-ambient-events': {
      schema: 'storyforge.text-adventure-quest-bundle-artifact' as const, version: 2 as const, bundleKind: 'ambient' as const,
      entries: ambientEntries,
    },
    'content.quest-script': questScript,
    ...questScriptRunOutputs(brief, questScript),
    'media.requirements': {
      ...base['media.requirements'], visual: [], audio: [],
    },
  }
}

async function relayCapabilities(brief: Awaited<ReturnType<typeof fixture>>['brief'], calls: RedactedMediaTransportRequestV1[]) {
  const png = (width: number, height: number) => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 0, 0, 0, 0, 0,
    ])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width, false); view.setUint32(20, height, false)
    return String.fromCharCode(...bytes)
  }
  const transport: MediaProviderTransportV1 = {
    executionLocation: 'trusted-relay',
    async request(request) {
      calls.push(structuredClone(request))
      if (request.adapterId === 'openai.gpt-image-2.v1') return {
        status: 200, contentType: 'application/json', body: null,
        json: { created: 1, data: [{
          b64_json: btoa(png(String(request.body.prompt).includes('主角') ? 720 : 1280,
            String(request.body.prompt).includes('主角') ? 1080 : 720)),
          revised_prompt: '原创雾港构图',
        }] },
        providerRequestId: request.requestId, usage: { outputImages: 1 }, costUsd: 0.02,
      }
      return {
        status: 200, contentType: 'audio/mpeg',
        body: Uint8Array.from([0x49, 0x44, 0x33, 0x04]).buffer, json: null,
        providerRequestId: request.requestId, usage: { outputAudio: 1 }, costUsd: 0.01,
      }
    },
  }
  const resolved = new Map<string, ResolvedProductMediaCapabilityV1>()
  for (const requirement of brief.capabilityRequirements.filter(item => ['image', 'music', 'sfx'].includes(item.mediaClass))) {
    const adapterId = requirement.mediaClass === 'image'
      ? 'openai.gpt-image-2.v1'
      : requirement.mediaClass === 'music' ? 'elevenlabs.music.v2' : 'elevenlabs.sound-effects.v2'
    const capabilityHash = await hashProductProductionValueV2({ requirementKey: requirement.requirementKey, adapterId })
    const adapter = resolveProductMediaProviderAdapterV1(adapterId)
    resolved.set(requirement.requirementKey, {
      adapter, transport,
      binding: { requirementKey: requirement.requirementKey, adapterId, bindingHash: capabilityHash },
      receipt: {
        schema: 'storyforge.media-relay-binding-receipt', version: 1,
        requirementKey: requirement.requirementKey, adapterId, adapterVersion: 1,
        relayOrigin: 'https://relay.fixture.invalid', executionLocation: 'trusted-relay',
        credentialSource: 'relay-session', capabilityHash, boundAt: 1,
        receiptHash: await hashProductProductionValueV2({ requirementKey: requirement.requirementKey, capabilityHash }),
      },
    })
  }
  return resolved
}

describe('R-PRODUCTPROD-1F · provider JSON response normalization', () => {
  it('空间架构重试会针对缺失 tags 的地点重申精确字段合同', () => {
    const taskKey = 'content.adventure-architecture'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey, blockingIssues: [],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact] location[1] 字段不精确:description,title',
      }],
    })
    const directive = textAdventureArchitectureLocationRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('title、description、tags')
    expect(directive).toContain('Object.keys(location).sort()')
    expect(directive).toContain('不得省略 tags')
    expect(textAdventureArchitectureLocationRetryDirectiveV1('content.story-bible', feedback)).toBe('')
  })

  it('结局路线重试把穷举失败见证收口为唯一完整的真实 effect 分支集合', () => {
    const taskKey = 'content.ending-route-plan'
    const contextText = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey, blockingIssues: [],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] '
          + '结局路线没有形成互斥且完备的状态分区:'
          + '选择=flag.decision.1.2,flag.decision.4.1 匹配=none',
      }],
    })
    const directive = textAdventureEndingRoutePartitionRetryDirectiveV1({
      taskKey,
      contextText,
      endingCount: 3,
      decisions: [{
        key: 'decision.1', sceneKey: 'scene.001', options: [
          { persistentEffectKey: 'flag.decision.1.1', label: '检视原型' },
          { persistentEffectKey: 'flag.decision.1.2', label: '立即离开' },
        ],
      }, {
        key: 'decision.4', sceneKey: 'scene.008', options: [
          { persistentEffectKey: 'flag.decision.4.1', label: '停止调查' },
          { persistentEffectKey: 'flag.decision.4.2', label: '坚持追问' },
        ],
      }],
    })
    expect(directive).toContain('"decisionKey":"decision.4"')
    expect(directive).toContain('"decisionKey":"decision.1"')
    expect(directive).toContain(
      '[["flag.decision.4.2"],["flag.decision.4.1","flag.decision.1.2"],["flag.decision.4.1","flag.decision.1.1"]]',
    )
    expect(directive).toContain('只能依据结局语义决定哪一个 endingKey 配哪一个数组')
    expect(textAdventureEndingRoutePartitionRetryDirectiveV1({
      taskKey: 'content.main-quest-plan', contextText, endingCount: 3, decisions: [],
    })).toBe('')
  })

  it('任务脚本重试区分 automatic 空检查与 check 的完整能力绑定', () => {
    const taskKey = 'content.quest-script.main.act-1.multi'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey, blockingIssues: [],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] '
          + 'mainObjectiveScripts[0].alternatives[0] check resolution '
          + '必须绑定已登记能力与有效难度区间: abilityKey=null, difficulty=null, costlySuccessFloor=null',
      }, {
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] '
          + 'mainObjectiveScripts[0].alternatives[0] 字段不精确:'
          + 'alternativeKey,costlySuccessText,failureForwardConsequence,resolution,successText,timeCostMinutes',
      }],
    })
    const directive = textAdventureQuestScriptResolutionRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('凡 mode="check"')
    expect(directive).toContain('这三个字段都禁止为 null')
    expect(directive).toContain('只有 mode="automatic"')
    expect(directive).toContain('必须逐字为 failureForwardText')
    expect(directive).toContain('严禁沿用上游任务计划字段 failureForwardConsequence')
    expect(textAdventureQuestScriptResolutionRetryDirectiveV1(
      'content.story-bible', feedback,
    )).toBe('')
  })

  it('任务脚本重试把目标内缺失的多路线数量与精确 key 注入系统约束', () => {
    const taskKey = 'content.quest-script.main.act-1.multi'
    const identityPlan = {
      mainObjectiveScripts: [{
        objectiveKey: 'objective.01', sceneKey: 'scene.003',
        alternativeKeys: ['alternative.01.a', 'alternative.01.b'],
      }],
      sideQuestScripts: [], ambientEventScripts: [],
    }
    const contextText = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey, blockingIssues: [],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] '
          + 'mainObjectiveScripts[0].alternatives 数量无效 received=1 expected=2..2',
      }, {
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] '
          + 'mainObjectiveScripts[0] 字段不精确:alternativeKeys,objectiveKey,sceneKey',
      }],
    })
    const directive = textAdventureQuestScriptCountRetryDirectiveV1(
      taskKey, contextText, identityPlan,
    )
    expect(directive).toContain('"objectiveIndex":0')
    expect(directive).toContain('"received":1,"expected":2')
    expect(directive).toContain('"alternative.01.a","alternative.01.b"')
    expect(directive).toContain('alternativeKeys.length')
    expect(directive).toContain('严禁把 alternativeKeys 当作输出字段')
    expect(textAdventureQuestScriptCountRetryDirectiveV1(
      'content.scene-script.act-1.part-1', contextText, identityPlan,
    )).toBe('')
  })

  it('任务脚本结算文案偏离目标时注入字段级语义锚点', () => {
    const taskKey = 'content.quest-script.main.act-1.single'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] mainObjectiveScripts[0].alternatives[0].costlySuccessText 偏离冻结目标「修复第一座潮钟」与对应后果',
      }],
    })
    const directive = textAdventureQuestScriptOutcomeRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('mainObjectiveScripts[0].alternatives[0].costlySuccessText')
    expect(directive).toContain('修复第一座潮钟')
    expect(directive).toContain('逐字包含该 objective.title 的完整中文短语')
    expect(textAdventureQuestScriptOutcomeRetryDirectiveV1(
      'content.scene-script.act-1.part-1', feedback,
    )).toBe('')
  })

  it('任务脚本结算地点错位时冻结当前发生地并排除冲突地点', () => {
    const taskKey = 'content.quest-script.main.act-1.multi'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] mainObjectiveScripts[1].alternatives[0].successText 绑定「雾隐酒馆」却把行动写在「观潮台」',
      }],
    })
    const directive = textAdventureQuestScriptLocationRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('"expectedLocation":"雾隐酒馆"')
    expect(directive).toContain('"conflictingLocation":"观潮台"')
    expect(directive).toContain('全部发生在 expectedLocation')
    expect(textAdventureQuestScriptLocationRetryDirectiveV1(
      'content.scene-script.act-1.part-1', feedback,
    )).toBe('')
  })

  it('任务脚本根 schema/version 失败时冻结 v2 根身份', () => {
    const taskKey = 'content.quest-script.main.act-2.single'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact-v2] questScript schema/version 无效',
      }],
    })
    const directive = textAdventureQuestScriptRootRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('storyforge.text-adventure-quest-script-artifact')
    expect(directive).toContain('JSON 整数 2')
    expect(directive).toContain('五个字段')
    expect(textAdventureQuestScriptRootRetryDirectiveV1(
      'content.main-quest-plan', feedback,
    )).toBe('')
  })

  it('任务脚本三档玩家文本由上游目标、地点和后果确定性装配，消除跨目标串台', () => {
    const result = applyTextAdventureQuestScriptOutcomeAnchorsV1({
      schema: 'storyforge.text-adventure-quest-script-artifact', version: 2,
      mainObjectiveScripts: [{
        objectiveKey: 'objective.archive', sceneKey: 'scene.007',
        alternatives: [{
          alternativeKey: 'alternative.archive.look', resolution: {}, timeCostMinutes: 8,
          successText: '你在观潮台完成了另一个目标。',
          costlySuccessText: '你仍在观潮台。', failureForwardText: '你去了观潮台。',
        }],
      }],
      sideQuestScripts: [], ambientEventScripts: [],
    }, [{
      objectiveKey: 'objective.unrelated', objectiveTitle: '无关目标',
      locationTitle: '观潮台', alternatives: [{
        alternativeKey: 'alternative.unrelated', cost: '无',
        successConsequence: '无关成功。', failureForwardConsequence: '无关失败。',
      }],
    }, {
      objectiveKey: 'objective.archive', objectiveTitle: '找到原始供能记录',
      locationTitle: '议会档案库',
      alternatives: [{
        alternativeKey: 'alternative.archive.look', cost: '消耗体力',
        successConsequence: '你找到了原始记录，下一步需要去观潮台核对。',
        failureForwardConsequence: '只找到残页，但线索没有中断。',
      }],
    }], ['议会档案库', '观潮台'])
    const alternative = ((result.payload.mainObjectiveScripts as JsonRecord[])[0]
      .alternatives as JsonRecord[])[0]
    expect(alternative.successText).toContain('议会档案库')
    expect(alternative.successText).toContain('找到原始供能记录')
    expect(alternative.successText).toContain('后续地点核对')
    expect(alternative.successText).not.toContain('观潮台')
    expect(alternative.costlySuccessText).toContain('消耗体力为代价')
    expect(alternative.failureForwardText).toContain('线索没有中断')
    expect(alternative.successText).not.toContain('无关目标')
    expect(result.anchoredFields).toHaveLength(3)
  })

  it('文字冒险出图默认禁止文字，文字类返修同时下发双语强约束', () => {
    const ordinary = productImageNegativePromptV1('text-adventure')
    expect(ordinary).toContain('汉字')
    expect(ordinary).toContain('伪文字')
    expect(ordinary).not.toContain('pseudo-text')

    const repaired = productImageNegativePromptV1('text-adventure', true)
    expect(repaired).toContain('汉字')
    expect(repaired).toContain('pseudo-text')
    expect(productImageNegativePromptV1('avg')).not.toContain('汉字')
  })

  it('对峙 CG 返修只绑定证据中最先出现的已登记 NPC，并排除军装与无身份配角', () => {
    const constraint = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'cg',
      scenePrompt: '导师记忆真相被揭开的关键对峙',
      repairEvidence: '建议使用巡灯员祁岸或失踪导师沉砾；当前持斧军人为未登记角色，身份归属不明。',
      characters: [
        { key: 'character.player', name: '岚舟', role: 'player', publicIdentity: '守灯人', visualAnchor: '铜扣护腕' },
        { key: 'character.guard', name: '巡灯员祁岸', role: 'major-npc', publicIdentity: '议会巡灯员', visualAnchor: '铜哨徽' },
        { key: 'character.mentor', name: '沉砾', role: 'major-npc', publicIdentity: '失踪导师', visualAnchor: '铜制调律棒' },
        { key: 'character.guide', name: '涅洛', role: 'major-npc', publicIdentity: '退役领航员', visualAnchor: '银铃' },
      ],
    })
    expect(constraint.promptSuffix).toContain('「沉砾」')
    expect(constraint.promptSuffix).toContain('铜制调律棒')
    expect(constraint.promptSuffix).toContain('只能出现主角与「沉砾」两名')
    expect(constraint.promptSuffix).not.toContain('「涅洛」')
    expect(constraint.promptOverride).toContain('严格只有两名已登记角色')
    expect(constraint.promptOverride).toContain('「沉砾」')
    expect(constraint.promptOverride).not.toContain('军服')
    expect(constraint.negativePromptSuffix).toContain('现实军服')
    expect(constraint.negativePromptSuffix).toContain('未登记角色')
    expect(positiveImageRepairDirectiveV1('去除所有汉字；改为古旧黄铜匣', 'style'))
      .toBe('使用古旧黄铜匣')
    expect(positiveImageRepairDirectiveV1('清除伪文字', 'text')).toContain('平滑空白表面')
  })

  it('文字地图返修移除可被画进像素的地名，并保留空间、航线和地标关系', () => {
    const prompt = textAdventureGlyphSafeMapRepairPromptV1({
      originalPrompt: '无文字示意地图。中央描绘潮钟群岛，标注雾湾环礁位于东端、霜潮列岛位于西北端，以虚线航道连接，三座潮钟沿线分布，并从东南角画出方向箭头。',
      palette: ['#0a1a2e', '#3a5f7a', '#c8a86e'],
    })
    expect(prompt).toContain('STRICT MINIMAL FLAT-VECTOR UI TOPOLOGY DIAGRAM')
    expect(prompt).toContain('Render those three shapes only')
    expect(prompt).toContain('one thin dotted route')
    expect(prompt).toContain('eastern edge')
    expect(prompt).toContain('northwestern edge')
    expect(prompt).toContain('central island group')
    expect(prompt).toContain('These three cloche pictograms are the complete symbol set')
    expect(prompt).toContain('dotted route')
    expect(prompt).not.toContain('雾湾环礁')
    expect(prompt).not.toContain('霜潮列岛')
    expect(textAdventureGlyphSafeMapRepairPromptV1({
      originalPrompt: '角色全身立绘', palette: ['#000000', '#111111', '#222222'],
    })).toBe('')
  })

  it('区域拓扑图在模型无法守住计数后可确定性生成受审 PNG', async () => {
    const requirement = { width: 320, height: 180, palette: ['#0a1a2e', '#3a5f7a', '#c8a86e'] as const }
    const first = new Uint8Array(await deterministicRegionMapPngV1(requirement))
    const second = new Uint8Array(await deterministicRegionMapPngV1(requirement))
    expect([...first.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(new DataView(first.buffer).getUint32(16)).toBe(320)
    expect(new DataView(first.buffer).getUint32(20)).toBe(180)
    expect(first.byteLength).toBeGreaterThan(500)
    expect(await sha256MediaData(first)).toBe(await sha256MediaData(second))
  })

  it('运行期行动标签保持可扫读并优先保留首个完整语义分句', () => {
    expect(conciseTextAdventureActionLabelV1('先在沉砾的秘密工作室完成潮汐密码的最终解读，再前往冰窟渔村互助站对接各方势力'))
      .toBe('先在沉砾的秘密工作室完成潮汐密码的最终解读')
    expect([...conciseTextAdventureActionLabelV1('没有标点且明显超过三十二个字符的极长行动标签需要确定性截断以避免玩家操作区域失去可读性和层级关系')].length)
      .toBeLessThanOrEqual(32)
    expect(conciseTextAdventureActionLabelV1(
      '取得：观潮台：停摆的测潮钟与三枚碎镜 · 贴近观潮台的裂纹镜片辨认残像所需物',
    )).toBe('取得：观潮台：停摆的测潮钟与三枚碎镜 · 贴近观潮台的裂纹镜片…')
  })

  it('决定回响在审查投影与运行编译之间复用同一份玩家可见文案', () => {
    const echo = textAdventureDecisionEchoPresentationV1({
      decisionPrompt: '是否公开失踪者名单', optionLabel: '先保护仍在岛上的家属',
      optionCost: '你暂时失去公开证词的机会', sceneTitle: '回声议事厅',
      sceneConflict: '守灯人要求你解释为何隐去名单',
    })
    expect(echo).toEqual(expect.objectContaining({
      label: '回响：先保护仍在岛上的家属',
      description: '此前的决定正在改变「回声议事厅」的局面。',
      unavailableText: '只有作出对应决定后，才能看见这段回响。',
    }))
    expect(echo.successText).toContain('你先前面对“是否公开失踪者名单”')
    expect(echo.successText).toContain('眼前的冲突“守灯人要求你解释为何隐去名单”')
  })

  it('失踪导师场景返修只画主角，并把导师限制为遗留物表达', () => {
    const constraint = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'cg',
      scenePrompt: '岚舟睁开眼，在空荡工坊中发现导师留下的机械记忆匣。',
      repairEvidence: '岚舟缺席且画面成了无人物静物；失踪导师沉砾不应入画，只能通过遗留物表达其缺席。',
      characters: [
        { key: 'character.player', name: '岚舟', role: 'player', publicIdentity: '守灯人', visualAnchor: '黑色短发、海军蓝修理外套与黄铜调音钥匙' },
        { key: 'character.mentor', name: '沉砾', role: 'major-npc', publicIdentity: '失踪导师', visualAnchor: '铜制调律棒' },
      ],
    })
    expect(constraint.promptSuffix).toContain('唯一可见角色是「岚舟」')
    expect(constraint.promptSuffix).toContain('「沉砾」是失踪导师')
    expect(constraint.promptSuffix).not.toContain('只能出现主角与「沉砾」两名')
    expect(constraint.promptOverride).toContain('严格只有一个可见角色「岚舟」')
    expect(constraint.promptOverride).toContain('「沉砾」绝不能作为人物')
    expect(constraint.promptOverride).not.toContain('严格只有两名已登记角色')
    expect(constraint.negativePromptSuffix).toContain('导师肖像')
    expect(constraint.negativePromptSuffix).toContain('second character')
  })

  it('角色返修把彩色边缘和额外肩甲转成正向轮廓约束与负向禁止项', () => {
    const constraint = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'character-pose',
      repairEvidence: '肩部金色护甲属于额外装饰；透明背景边缘存在品红色光晕伪影；左眉细疤未呈现。',
      characters: [],
    })
    expect(constraint.promptSuffix).toContain('肩部造型保持简洁')
    expect(constraint.promptSuffix).toContain('边缘干净、无残色')
    expect(constraint.promptSuffix).toContain('左眉上有一条细长、已愈合')
    expect(constraint.negativePromptSuffix).toContain('magenta')
    expect(constraint.negativePromptSuffix).toContain('extra shoulder armor')
    expect(constraint.negativePromptSuffix).toContain('color fringe')
  })

  it('返修合同把断臂、袖口伪图案和机械匣外形编译为不可弱化约束', () => {
    const constraint = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'cg',
      scenePrompt: '机械记忆匣的物品特写',
      repairEvidence: '角色右臂被完整补画；袖口出现白色图案与 Logo；机械记忆匣被画成圆柱手持工具，应改为可开合盒形。',
      characters: [],
    })
    expect(constraint.promptSuffix).toContain('完全失去解剖学右臂')
    expect(constraint.promptSuffix).toContain('one arm total')
    expect(constraint.promptSuffix).toContain('纯色布料')
    expect(constraint.promptSuffix).toContain('盒形或匣形机械容器')
    expect(constraint.negativePromptSuffix).toContain('right arm')
    expect(constraint.negativePromptSuffix).toContain('sleeve logo')
    expect(constraint.negativePromptSuffix).toContain('cylindrical tool')
  })

  it('角色立绘断臂返修与纯环境返修使用消歧后的专用正向构图', () => {
    const portrait = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'character-pose', sceneTag: 'major-character-anchor',
      repairEvidence: '冻结外观明确要求失去右臂，但画面中角色双臂完整；腰间银铃表面还有伪文字。',
      characters: [{
        key: 'character.guide', name: '涅洛', role: 'major-npc', publicIdentity: '退役领航员',
        visualAnchor: '深褐色皮肤，失去右臂，腰间系一枚无字银铃',
      }],
    })
    expect(portrait.promptOverride).toContain('right shoulder ends at the torso in a flat pinned triangular empty sleeve cap')
    expect(portrait.promptOverride).toContain("anatomical RIGHT side appears on the viewer's LEFT")
    expect(portrait.promptOverride).toContain('exactly one visible arm total')
    expect(portrait.promptOverride).toContain('one visible left hand')
    expect(portrait.promptOverride).toContain('head to mid-thigh')
    expect(portrait.promptOverride).toContain('weathered one-armed coastal tavern owner')
    expect(portrait.promptOverride).toContain('A single smooth blank silver bell')
    expect(portrait.promptOverride).toContain('No cup, cloth, tool')
    expect(portrait.promptOverride).not.toContain('wipes a plain clay cup')
    expect(portrait.negativePromptSuffix).toContain('two arms')
    expect(productImageRequestNegativePromptV1({
      productType: 'text-adventure',
      repairNegativePrompt: portrait.negativePromptSuffix,
    })).toContain('right arm')

    const environment = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'background',
      scenePrompt: '冰封岩礁、苍白雾气与远处潮钟塔。',
      repairEvidence: 'Prompt 明确要求无人物，但画面前景出现女性角色；应移除人物并保持纯环境。',
      characters: [],
    })
    expect(environment.promptOverride).toContain('无人到访的纯环境远景')
    expect(environment.promptOverride).toContain('不出现角色、肖像、雕像、人形')
    expect(environment.negativePromptSuffix).toContain('human figure')
    expect(positiveImageRepairDirectiveV1('仅保留一把折叠冰镐，删除多余冰镐。', 'identity'))
      .toContain('严格为一把折叠冰镐')
  })

  it('角色持久约束只作用于当前图片登记的角色锚点', () => {
    const characters = [
      {
        key: 'character.player', name: '岚舟', role: 'player' as const,
        publicIdentity: '守灯人', visualAnchor: '黑色短发、海军蓝修理外套与黄铜调音钥匙',
      },
      {
        key: 'character.guide', name: '涅洛', role: 'major-npc' as const,
        publicIdentity: '退役领航员', visualAnchor: '深褐色皮肤，失去右臂，腰间系一枚无字银铃',
      },
      {
        key: 'character.support', name: '阿塔', role: 'supporting-npc' as const,
        publicIdentity: '冰礁向导', visualAnchor: '白色短发，只携带一把折叠冰镐',
      },
    ]
    const player = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'character-pose', anchorRefs: ['character.player'], characters,
      repairEvidence: '当前角色身份错误，应恢复冻结外观。',
    })
    expect(player.promptOverride).toContain('岚舟')
    expect(player.promptOverride).not.toContain('失去右臂')
    expect(player.promptOverride).not.toContain('冰镐')
    expect(player.negativePromptSuffix).not.toContain('right arm')

    const guide = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'character-pose', anchorRefs: ['character.guide'], characters,
      repairEvidence: '当前角色身份错误，应恢复冻结外观。',
    })
    expect(guide.promptOverride).toContain('涅洛')
    expect(guide.promptOverride).toContain('exactly one visible arm in the entire image')
    expect(guide.promptOverride).not.toContain('阿塔')

    const support = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'character-pose', anchorRefs: ['character.support'], characters,
      repairEvidence: '当前角色身份错误，应恢复冻结外观。',
    })
    expect(support.promptOverride).toContain('阿塔')
    expect(support.promptSuffix).toContain('严格为一把折叠冰镐')
    expect(support.promptOverride).not.toContain('失去右臂')
  })

  it('反复出现字形时按素材职责改用无字专用构图，且地图数量和边框建议可正向编译', () => {
    const cover = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'background', sceneTag: 'cover-opening',
      scenePrompt: '远方隐约可见一座老潮钟。',
      repairEvidence: '钟面出现可读罗马数字，违反无文字约束。', characters: [],
    })
    expect(cover.promptOverride).toContain('exactly one narrow asymmetric copper navigation beacon')
    expect(cover.promptOverride).toContain('irregular vertical stack of rectangular slabs')
    expect(cover.promptOverride).toContain('no front-facing ornamental surface')

    const key = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'cg', sceneTag: 'important-item-secondary',
      repairEvidence: '物品变成带罗马数字的圆形钟面，不像调音钥匙。', characters: [],
    })
    expect(key.promptOverride).toContain('exactly one long slender antique brass tuning key')
    expect(key.promptOverride).toContain('never a clock, watch, compass')
    expect(positiveImageRepairDirectiveV1('仅保留三个主要岛屿，删除四个小型副岛。', 'composition'))
      .toContain('严格只出现三个')
    expect(positiveImageRepairDirectiveV1('移除所有冰晶边框装饰，保持海洋背景开阔无边缘元素。', 'style'))
      .toContain('自然延伸到画布四边')
    const map = textAdventureGlyphSafeMapRepairPromptV1({
      originalPrompt: '无文字示意地图。中央、东端、西北端三片岛群，以虚线航道连接三座潮钟，并从东南角画出方向箭头。',
      palette: ['#0a1a2e', '#3a5f7a', '#c8a86e'],
    })
    expect(map).toContain('complete outer fifty percent and every corner show only the same opaque dark navy background')
    expect(map).toContain('exactly one small pale-gold triangular arrowhead')
    expect(map).toContain('These three cloche pictograms are the complete symbol set')

    const climax = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'cg', sceneTag: 'mainline-turn-act-3',
      scenePrompt: '岚舟的手指微微颤抖，她预感到接下来会揭示最终真相。',
      repairEvidence: '画面站姿平静，缺少手指微微颤抖的行动瞬间，并出现未登记控制台。',
      characters: [{
        key: 'character.player', name: '岚舟', role: 'player', publicIdentity: '守灯人与修复师',
        visualAnchor: '短黑发、盐灰发梢、深蓝修复工外套与铜扣护腕',
      }],
    })
    expect(climax.promptOverride).toContain('separated fingertips visibly tremble')
    expect(climax.promptOverride).toContain('One small old oil lamp')
    expect(climax.promptOverride).toContain('sparse chamber')

    const packingClimax = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'cg', sceneTag: 'mainline-turn-act-3',
      scenePrompt: '岚舟走向门口，把图纸和笔记都揣进怀里。',
      repairEvidence: '画面把角色画成空手举掌；必须清晰呈现把航线草图和笔记收入外套怀中的动作。',
      characters: [{
        key: 'character.player', name: '岚舟', role: 'player', publicIdentity: '守灯人与修复师',
        visualAnchor: '短黑发、盐灰发梢、深蓝修复工外套与铜扣护腕',
      }],
    })
    expect(packingClimax.promptOverride).toContain('slide two distinct blank paper objects')
    expect(packingClimax.promptOverride).toContain('both papers remain half-visible')
    expect(packingClimax.promptOverride).toContain('No hand is raised palm-out')
    expect(packingClimax.promptOverride).not.toContain('fingertips visibly tremble')
    expect(packingClimax.negativePromptSuffix).toContain('empty raised hand')

    const ending = textAdventureVisualRepairCastConstraintV1({
      mediaKind: 'cg', sceneTag: 'ending-consequence',
      scenePrompt: '雾潮开始退散，被公开的名字重新获得力量。',
      repairEvidence: '错误画成角色打开机械记忆匣的室内近景；必须改成雾潮消散、群岛重见天日的开阔结局远景。',
      characters: [{
        key: 'character.player', name: '岚舟', role: 'player', publicIdentity: '守灯人与修复师',
        visualAnchor: '短黑发、盐灰发梢、深蓝修复工外套与铜扣护腕',
      }],
    })
    expect(ending.promptOverride).toContain('Wide panoramic cinematic hand-painted ocean-fantasy aftermath')
    expect(ending.promptOverride).toContain('dense blue-gray salt fog visibly parts')
    expect(ending.promptOverride).toContain('final consequence landscape')
    expect(ending.promptOverride).not.toContain('memory casket')
    expect(ending.negativePromptSuffix).toContain('机械记忆匣')
    expect(ending.negativePromptSuffix).toContain('opening an object')
  })

  it('眉部细疤作为微细节不可单独阻塞 CG 或角色立绘', () => {
    const review = {
      artifactKey: 'media.visual.012', contentHash: 'a'.repeat(64), verdict: 'revise' as const,
      scores: {
        requirementFit: 4, identityContinuity: 3, styleContinuity: 5,
        composition: 5, technicalCleanliness: 5,
      },
      issues: [{
        severity: 'blocking' as const, category: 'identity' as const,
        detail: '左眉未出现细疤，与冻结外观明显冲突。',
        recommendation: '请在左眉处添加细疤。',
      }],
      reviewSource: 'multimodal-model' as const,
    }
    const [cg] = normalizeTextAdventureVisualReviewPolicyV1({
      reviews: [review], requirements: [{ artifactKey: review.artifactKey, mediaKind: 'cg' }],
    })
    const [portrait] = normalizeTextAdventureVisualReviewPolicyV1({
      reviews: [{ ...review, artifactKey: 'media.visual.002' }],
      requirements: [{ artifactKey: 'media.visual.002', mediaKind: 'character-pose' }],
    })
    expect(cg).toMatchObject({ verdict: 'accept', issues: [{ severity: 'warning' }] })
    expect(portrait).toMatchObject({ verdict: 'accept', issues: [{ severity: 'warning' }] })
  })

  it('审图模型把可读文字误标为 warning 时，确定性策略仍升级为阻塞返修', () => {
    const [review] = normalizeTextAdventureVisualReviewPolicyV1({
      reviews: [{
        artifactKey: 'media.visual.001', contentHash: 'b'.repeat(64), verdict: 'accept',
        scores: {
          requirementFit: 4, identityContinuity: 5, styleContinuity: 5,
          composition: 5, technicalCleanliness: 4,
        },
        issues: [{
          severity: 'warning', category: 'artifact',
          detail: '灯塔表盘上的罗马数字清晰可辨。',
          recommendation: '重绘为空白机械外壳。',
        }],
        reviewSource: 'multimodal-model',
      }],
      requirements: [{ artifactKey: 'media.visual.001', mediaKind: 'background' }],
    })
    expect(review).toMatchObject({ verdict: 'revise', issues: [{ severity: 'blocking' }] })
  })

  it('商业文字冒险的十二图槽位不重复，并覆盖三类角色与完整叙事职责', () => {
    const blueprints = textAdventureVisualBlueprintsV1(12)
    expect(blueprints).toHaveLength(12)
    expect(new Set(blueprints.map(item => item.sceneTag)).size).toBe(12)
    expect(blueprints.map(item => item.sceneTag)).toEqual([
      'cover-opening', 'protagonist-anchor', 'region-map', 'mainline-turn-act-1',
      'secondary-region-anchor', 'important-item-primary', 'major-character-anchor',
      'mainline-turn-act-2', 'supporting-character-anchor', 'mainline-turn-act-3',
      'important-item-secondary', 'ending-consequence',
    ])
    expect(blueprints.filter(item => item.mediaKind === 'background')).toHaveLength(3)
    expect(blueprints.filter(item => item.mediaKind === 'character-pose')).toHaveLength(3)
    expect(blueprints.filter(item => item.mediaKind === 'cg')).toHaveLength(6)
    expect(blueprints.filter(item => item.characterOrdinal != null)
      .map(item => item.characterOrdinal)).toEqual([0, 1, 2])
    expect(new Set(textAdventureVisualBlueprintsV1(30).map(item => item.sceneTag)).size).toBe(30)
  })

  it('保留陌生 Visual QA 分类的问题内容，并确定性归入通用 artifact 类别', () => {
    const parsed = parseTextAdventureVisualQualityReviewArtifactV1({
      schema: 'storyforge.text-adventure-visual-quality-review-artifact', version: 1,
      buildNumber: 7, mediaAuditHash: 'a'.repeat(64), status: 'revision-required',
      reviews: [{
        artifactKey: 'media.visual.008', contentHash: 'b'.repeat(64), verdict: 'revise',
        scores: {
          requirementFit: 3, identityContinuity: 4, styleContinuity: 4,
          composition: 3, technicalCleanliness: 3,
        },
        issues: [{
          severity: 'blocking', category: 'semantic-consistency',
          detail: '关键场景对象与冻结需求不一致',
        }],
        reviewSource: 'multimodal-model',
      }],
      blockingIssueCount: 1, providerReviewCompleted: true,
    })
    expect(parsed.reviews[0].issues[0]).toMatchObject({
      severity: 'blocking', category: 'artifact', detail: '关键场景对象与冻结需求不一致',
      recommendation: '修正上述问题，并重新执行独立 Visual QA。',
    })
  })

  it('质量审查只丢弃冗余 issue 元数据，保留四个权威字段与证据原文', () => {
    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-quality-review.act-1',
      {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
        scope: 'act-1', scores: {},
        issues: [{
          severity: 'blocking', artifactKey: 'content.narrative',
          detail: 'scene.003 的开场没有兑现 choice.002。',
          recommendation: '重写 choice.002.description。',
          fieldPath: 'nodes[2].openingBeat', ownerArtifactKey: 'content.narrative',
        }],
      },
    )
    expect(legalized.payload.issues).toEqual([{
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'scene.003 的开场没有兑现 choice.002。',
      recommendation: '重写 choice.002.description。',
    }])
    expect(legalized.defaultedFields).toEqual([
      'issues[0].fieldPath<-discarded-review-metadata',
      'issues[0].ownerArtifactKey<-discarded-review-metadata',
    ])
  })

  it('质量审查只在证据三字段完整时补中性 recommendation', () => {
    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-quality-review.act-1',
      {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
        scope: 'act-1', scores: {},
        issues: [{
          severity: 'warning', artifactKey: 'content.narrative',
          detail: '[owningKey=choice.002] 选择文案与冻结目标场景不一致。',
        }],
      },
    )
    expect(legalized.payload.issues).toEqual([{
      severity: 'warning', artifactKey: 'content.narrative',
      detail: '[owningKey=choice.002] 选择文案与冻结目标场景不一致。',
      recommendation: '保持冻结架构与未受影响内容，修正上述已登记问题。',
    }])
    expect(legalized.defaultedFields).toEqual([
      'issues[0].recommendation<-neutral-review-guidance',
    ])
    const incomplete = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-quality-review.act-1',
      { issues: [{ severity: 'warning', artifactKey: 'content.narrative' }] },
    )
    expect(incomplete.payload.issues).toEqual([{
      severity: 'warning', artifactKey: 'content.narrative',
    }])
  })

  it('质量审查只修复已观测且无歧义的 severity 重复属性标签损坏', () => {
    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-quality-review.structure',
      {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
        scope: 'structure', scores: {
          causality: 4, routeDifferentiation: 4, setupPayoff: 4, characterMotivation: 4,
        },
        issues: [{
          severity: 'severity":"warning', artifactKey: 'content.arc-plan',
          detail: '[owningKey=scene.001] 场景转折需要更清晰。',
          recommendation: '补强 scene.001 的因果承接。',
        }],
      },
    )
    expect((legalized.payload.issues as Array<Record<string, unknown>>)[0].severity).toBe('warning')
    expect((legalized.payload.issues as Array<Record<string, unknown>>)[0].artifactKey)
      .toBe('content.narrative-arc-plan')
    expect(legalized.defaultedFields).toEqual([
      'issues[0].artifactKey<-content.arc-plan',
      'issues[0].severity<-recovered-repeated-property-label',
    ])
  })

  it('质量审查把供应商 info 严格收敛为非阻塞 warning', () => {
    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-quality-review.structure',
      {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
        scope: 'structure', scores: {
          causality: 4, routeDifferentiation: 4, setupPayoff: 4, characterMotivation: 4,
        },
        issues: [{
          severity: 'info', artifactKey: 'content.narrative',
          detail: '非阻塞的节奏观察。', recommendation: '后续可局部润色。',
        }],
      },
    )
    expect((legalized.payload.issues as Array<Record<string, unknown>>)[0].severity).toBe('warning')
    expect(legalized.defaultedFields).toContain('issues[0].severity<-info-as-warning')
  })

  it('质量审查丢弃无法归属到登记工件的虚构 owner', () => {
    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-quality-review.structure',
      {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
        scope: 'structure', scores: {
          causality: 2, routeDifferentiation: 4, setupPayoff: 4, characterMotivation: 4,
        },
        issues: [{
          severity: 'blocking', artifactKey: 'content.dialogue-pass.act-structure',
          detail: '引用了不存在的结构审查 owner。', recommendation: '无法执行。',
        }],
      },
    )
    expect(legalized.payload.issues).toEqual([])
    expect((legalized.payload.scores as Record<string, number>).causality).toBe(3)
    expect(legalized.defaultedFields).toContain('issues[0]<-discarded-unregistered-owner')
  })

  it('质量审查丢弃要求增删二元决定选项的越权证据，并撤销无证据低分', () => {
    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-quality-review.structure',
      {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
        scope: 'structure', scores: {
          causality: 4, routeDifferentiation: 2, setupPayoff: 4, characterMotivation: 4,
        },
        issues: [{
          severity: 'blocking', artifactKey: 'content.narrative-arc-plan',
          detail: '[owningKey=decision.6] 两个选项不能直接对应三个结局。',
          recommendation: '在 decision.6 中新增第三个 option.6.3。',
        }],
      },
    )
    expect(legalized.payload).toMatchObject({
      scores: { routeDifferentiation: 3 }, issues: [],
    })
    expect(legalized.defaultedFields).toEqual([
      'issues[0]<-discarded-authority-violation',
      'scores.routeDifferentiation<-minimum-without-valid-blocking-evidence',
    ])
  })

  it('玩法系统只丢弃初始装备的已知 descriptionCn 供应商别名', () => {
    const legalized = legalizeProductionModelProtocolDefaultsV1('content.product-module', {
      schema: 'storyforge.text-adventure-systems-artifact', version: 1,
      starterEquipment: [{
        key: 'item.starter-lamp', title: '守灯杖', description: '照亮雾中航标。',
        descriptionCn: '照亮雾中航标。', slotKey: 'slot.weapon', tags: ['weapon'],
        modifierAbilityKey: 'ability.perception', modifierDelta: 1,
      }],
    })

    expect(legalized.payload.starterEquipment).toEqual([{
      key: 'item.starter-lamp', title: '守灯杖', description: '照亮雾中航标。',
      slotKey: 'slot.weapon', tags: ['weapon'],
      modifierAbilityKey: 'ability.perception', modifierDelta: 1,
    }])
    expect(legalized.defaultedFields).toEqual([
      'starterEquipment[0].descriptionCn<-discarded-provider-alias',
    ])

    const unknownField = legalizeProductionModelProtocolDefaultsV1('content.product-module', {
      starterEquipment: [{ key: 'item.starter-lamp', unregisteredFact: '不得静默接纳' }],
    })
    expect(unknownField.payload.starterEquipment).toEqual([{
      key: 'item.starter-lamp', unregisteredFact: '不得静默接纳',
    }])
  })

  it('试玩计划只保留登记路线并修复确定性 required 协议字段', () => {
    const valid = playtestStrategyOutput()
    const legalized = legalizeProductionModelProtocolDefaultsV1('qa.playtest-strategy', {
      ...valid,
      routeCases: [
        ...valid.routeCases.map((route, index) => (
          index === 0 ? { ...route, required: 'true' } : route
        )),
        {
          ...valid.routeCases[0],
          caseKey: 'playtest.duplicate-golden',
          required: false,
        },
        {
          ...valid.routeCases[0],
          caseKey: 'playtest.unregistered-rights-check',
          kind: 'rights-compliance',
          required: false,
        },
      ],
    })

    expect((legalized.payload.routeCases as Array<Record<string, unknown>>)).toHaveLength(15)
    expect((legalized.payload.routeCases as Array<Record<string, unknown>>)
      .every(route => route.required === true)).toBe(true)
    expect(legalized.defaultedFields).toEqual([
      'routeCases[0].required<-registered-route-contract',
      'routeCases[15]<-discarded-duplicate-route-kind',
      'routeCases[16]<-discarded-unregistered-route-kind',
    ])
  })

  it('试玩计划补齐已登记断言与真人验收协议并丢弃顶层 required 漂移', () => {
    const valid = playtestStrategyOutput()
    const legalized = legalizeProductionModelProtocolDefaultsV1('qa.playtest-strategy', {
      schema: valid.schema,
      version: valid.version,
      required: true,
      routeCases: valid.routeCases.map((route, index) => (
        index === 0
          ? Object.fromEntries(Object.entries(route).filter(([field]) => field !== 'expectedAssertions'))
          : route
      )),
    })

    expect(Object.keys(legalized.payload).sort()).toEqual([
      'blockingRisks', 'humanSessions', 'recommendation', 'routeCases', 'schema', 'version',
    ])
    const routeCases = legalized.payload.routeCases as Array<Record<string, unknown>>
    expect(routeCases[0].expectedAssertions).toEqual([
      '路线执行结果与当前 Build、RuntimePackage 和事件日志一致，且没有软锁或越权写入。',
    ])
    expect(legalized.payload.humanSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        participantRole: 'independent-player', routeKind: 'golden-route', timingRequired: true,
      }),
      expect.objectContaining({ participantRole: 'author', routeKind: 'alternate-route' }),
    ]))
    expect(legalized.payload.blockingRisks).toEqual([])
    expect(legalized.payload.recommendation).toBe('blocked')
    expect(legalized.defaultedFields).toEqual(expect.arrayContaining([
      'required<-discarded-playtest-protocol-field',
      'routeCases[0].expectedAssertions<-playtest-route-contract',
      'humanSessions<-registered-human-validation-contract',
      'blockingRisks<-empty-playtest-risk-register',
      'recommendation<-deterministic-playtest-gate',
    ]))
  })

  it('试玩计划丢弃未登记真人会话类型并保留必需的双角色覆盖', () => {
    const valid = playtestStrategyOutput()
    const legalized = legalizeProductionModelProtocolDefaultsV1('qa.playtest-strategy', {
      ...valid,
      humanSessions: [
        ...valid.humanSessions,
        {
          sessionKey: 'human.unsupported-ending-tour',
          participantRole: 'observer',
          routeKind: 'each-ending',
          timingRequired: 'yes',
          prompts: ['不受支持的旁观会话'],
          passCriteria: ['不应被采纳'],
        },
      ],
    })

    expect(legalized.payload.humanSessions).toEqual(valid.humanSessions)
    expect(legalized.defaultedFields).toContain(
      'humanSessions[2]<-discarded-unregistered-human-session',
    )
  })

  it('试玩计划补齐空证据引用与缺失的登记路线', () => {
    const valid = playtestStrategyOutput()
    const legalized = legalizeProductionModelProtocolDefaultsV1('qa.playtest-strategy', {
      ...valid,
      routeCases: valid.routeCases.slice(0, -1).map((route, index) => (
        index === 4 ? { ...route, evidenceRefs: [] } : route
      )),
    })
    const routeCases = legalized.payload.routeCases as Array<Record<string, unknown>>

    expect(routeCases).toHaveLength(15)
    expect(routeCases[4].evidenceRefs).toEqual(['quality.autoplay#random-long-run'])
    expect(routeCases.at(-1)).toMatchObject({
      kind: 'delete-lifecycle', executionMode: 'real-browser', required: true,
    })
    expect(legalized.defaultedFields).toEqual(expect.arrayContaining([
      'routeCases[4].evidenceRefs<-playtest-route-contract',
      'routeCases.delete-lifecycle<-registered-playtest-route',
    ]))
  })

  it('按商业时长冻结完整主线阶段与目标槽位，不允许单对象样例替代任务量', () => {
    const brief = {
      qualityProfile: 'commercial-candidate',
      scale: { targetPlayMinutes: 60 },
      textAdventure: {},
    } as ProductProductionBriefV3
    const sceneConstraints = Array.from({ length: 12 }, (_, index) => ({
      sceneKey: `scene.${String(index + 1).padStart(3, '0')}`,
      locationOrdinal: Math.floor(index / 2) + 1,
      nonPlayerCastKeys: index % 3 === 1 ? ['character.npc-01'] : [],
    }))
    const plan = planTextAdventureMainQuestIdentityV1(brief, sceneConstraints)

    expect(plan.stages).toHaveLength(3)
    expect(plan.objectives).toHaveLength(8)
    expect(plan.stages.flatMap(stage => stage.objectiveKeys)).toEqual(
      plan.objectives.map(objective => objective.objectiveKey),
    )
    expect(plan.objectives[0].sceneKey).toBe('scene.001')
    expect(plan.objectives.at(-1)?.sceneKey).toBe('scene.012')
    expect(plan.objectives.filter(objective => objective.alternativeKeys.length === 2)).toHaveLength(2)
    expect(new Set(plan.objectives.flatMap(objective => objective.requiredActionKinds))).toEqual(
      new Set(['talk', 'give', 'use']),
    )

    const legalized = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          key: 'invented-main', characterKeys: [],
          stages: plan.stages.map((_, index) => ({
            key: `invented-stage-${index}`, stageKey: `stage-scaffold-${index}`,
            title: `阶段 ${index + 1}`, objectiveKeys: [],
          })),
          objectives: plan.objectives.map((_, index) => ({
            key: `invented-objective-${index}`, stageKey: 'invented-stage',
            title: `目标 ${index + 1}`, narrativePurpose: '推进主线。',
            sceneKeys: ['scene.999'], sceneKey: 'scene.prompt-scaffold',
            locationOrdinal: 99, alternatives: [],
            objectiveKey: 'objective.prompt-scaffold',
            nonPlayerCastKeys: ['character.prompt-scaffold'],
            alternativeKeys: ['alternative.prompt-scaffold'],
            requiredActionKinds: ['talk'],
          })),
        }],
      },
      { questPlanIdentity: plan, questSceneCastPlan: sceneConstraints },
    )
    const quest = (legalized.payload.quests as Array<Record<string, unknown>>)[0]
    expect(quest.key).toBe('quest.main')
    expect((quest.stages as Array<Record<string, unknown>>).map(stage => ({
      stageKey: stage.key, objectiveKeys: stage.objectiveKeys,
    }))).toEqual(plan.stages)
    expect((quest.objectives as Array<Record<string, unknown>>).map(objective => ({
      objectiveKey: objective.key,
      stageKey: objective.stageKey,
      sceneKey: (objective.sceneKeys as string[])[0],
      locationOrdinal: objective.locationOrdinal,
    }))).toEqual(plan.objectives.map(objective => ({
      objectiveKey: objective.objectiveKey,
      stageKey: objective.stageKey,
      sceneKey: objective.sceneKey,
      locationOrdinal: objective.locationOrdinal,
    })))
    expect(quest.stages as Array<Record<string, unknown>>).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ stageKey: expect.anything() })]),
    )
    expect(quest.objectives as Array<Record<string, unknown>>).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ requiredActionKinds: expect.anything() }),
        expect.objectContaining({ nonPlayerCastKeys: expect.anything() }),
        expect.objectContaining({ alternativeKeys: expect.anything() }),
      ]),
    )
    expect(legalized.defaultedFields).toEqual(expect.arrayContaining([
      'quests[0].stages[0].stageKey<-discarded-prompt-scaffold',
      'quests[0].objectives[0].requiredActionKinds<-discarded-prompt-scaffold',
    ]))
  })

  it('角色 provider prompt 在冻结前剥离模型夹带的场景描述', () => {
    expect(isolateCharacterProviderPromptV1(
      '青年守灯人，深蓝制服，手持潮汐纸条；背景为灯塔控制室与风暴海面',
      '守灯人立绘',
    )).toBe('青年守灯人，深蓝制服，手持潮汐纸条')
    expect(isolateCharacterProviderPromptV1(
      '沈砚正面角色立绘，背景为纯品红。沈砚为四十岁上下瘦削男性，短发，深色旧工装，黄铜怀表。',
      '守灯人立绘',
    )).toBe('沈砚正面角色立绘，沈砚为四十岁上下瘦削男性，短发，深色旧工装，黄铜怀表')
  })

  it('接受原始对象、Markdown 围栏和单一说明文字包装，并正确处理字符串内花括号', () => {
    expect(parseProductionModelJsonObjectV1('{"ok":true}', 'raw')).toEqual({ ok: true })
    expect(parseProductionModelJsonObjectV1('```json\n{"ok":true}\n```', 'fenced')).toEqual({ ok: true })
    expect(parseProductionModelJsonObjectV1(
      '这是请求的结果：\n{"message":"保留 {角色} 与 \\"引号\\"","ok":true}\n以上。',
      'wrapped',
    )).toEqual({ message: '保留 {角色} 与 "引号"', ok: true })
  })

  it('拒绝数组、多个对象、结构损坏和过长输出', () => {
    expect(() => parseProductionModelJsonObjectV1('[{"ok":true}]', 'array')).toThrow('array 必须是对象')
    expect(() => parseProductionModelJsonObjectV1('{"a":1}\n{"b":2}', 'multiple')).toThrow('必须只包含一个完整 JSON 对象')
    expect(() => parseProductionModelJsonObjectV1('```json\n{"a":"unterminated}\n```', 'broken')).toThrow('必须只包含一个完整 JSON 对象')
    expect(() => parseProductionModelJsonObjectV1('x'.repeat(2_000_001), 'large')).toThrow('模型输出为空或过长')
  })

  it('仅补全有确定空语义的叙事协议字段，并保留未知字段供严格解析器拒绝', () => {
    const supervision = legalizeProductionModelProtocolDefaultsV1('production.supervision', {
      stages: Array.from({ length: 6 }, (_, index) => ({
        key: `g${index + 1}`, responsibleAgentIds: index === 0 ? ['showrunner'] : [],
      })),
    })
    expect((supervision.payload.stages as Array<{ responsibleAgentIds: string[] }>).flatMap(
      stage => stage.responsibleAgentIds,
    )).toEqual([
      'text-adventure-showrunner', 'text-adventure-source-editor', 'text-adventure-creative-director',
      'text-adventure-story-architect', 'text-adventure-cast-director',
      'text-adventure-space-designer', 'text-adventure-game-designer',
      'text-adventure-narrative-designer', 'text-adventure-ending-route-designer',
      'text-adventure-main-quest-designer',
      'text-adventure-side-quest-designer', 'text-adventure-storylet-designer',
      'text-adventure-quest-scripter', 'text-adventure-scene-writer',
      'text-adventure-dialogue-editor', 'text-adventure-continuity-editor',
      'text-adventure-art-director', 'text-adventure-visual-qa-director',
      'text-adventure-playtest-director',
    ])
    expect(supervision.defaultedFields).toEqual([
      'stages[0].responsibleAgentIds', 'stages[1].responsibleAgentIds',
      'stages[2].responsibleAgentIds', 'stages[3].responsibleAgentIds',
      'stages[4].responsibleAgentIds', 'stages[5].responsibleAgentIds',
    ])

    const sourceSufficiency = legalizeProductionModelProtocolDefaultsV1(
      'content.source-sufficiency',
      {
        decision: 'ready-with-private-additions',
        authorDecisionRequired: false,
        coverage: [{ domain: 'world-premise', status: 'sufficient', resourceKeys: [], ratione: '来源充分。' }],
        gaps: [
          { key: 'gap.items', severity: 'warning' },
          { key: '缺少视觉锚点', severity: 'warning' },
          { key: 'gap.items', severity: 'warning' },
        ],
        privateAdditions: [
          { key: '补充规则细节', kind: 'rule-detail' },
          { key: 'gap.items', kind: 'item' },
        ],
      },
      { allowedSourceResourceKeys: ['story.world-rules'] },
    )
    expect(sourceSufficiency.payload).toEqual({
      authorDecisionRequired: true,
      decision: 'ready-with-private-additions',
      coverage: [{ domain: 'world-premise', status: 'sufficient', resourceKeys: [], rationale: '来源充分。' }],
      gaps: [
        { key: 'gap.items', severity: 'warning' },
        { key: 'gap.generated.002', severity: 'warning' },
        { key: 'gap.generated.003', severity: 'warning' },
      ],
      privateAdditions: [
        { key: 'private-addition.generated.001', kind: 'rule-detail' },
        { key: 'private-addition.generated.002', kind: 'item' },
      ],
    })
    expect(sourceSufficiency.defaultedFields).toEqual([
      'authorDecisionRequired<-decision',
      'coverage[0].rationale<-ratione',
      'gaps[1].key',
      'gaps[2].key',
      'privateAdditions[0].key',
      'privateAdditions[1].key',
    ])

    const sourceReferences = legalizeProductionModelProtocolDefaultsV1(
      'content.source-sufficiency',
      {
        coverage: [{
          domain: 'space', status: 'partial', rationale: '只接受冻结引用。',
          resourceKeys: [' story.world-rules ', 'world:invented-hash', 42],
        }],
      },
      { allowedSourceResourceKeys: ['story.world-rules'] },
    )
    expect(sourceReferences.payload).toEqual({
      coverage: [{
        domain: 'space', status: 'partial', rationale: '只接受冻结引用。',
        resourceKeys: ['story.world-rules'],
      }],
    })
    expect(sourceReferences.defaultedFields).toEqual([
      'coverage[0].resourceKeys[1]<-discarded-unauthorized',
      'coverage[0].resourceKeys[2]<-discarded-unauthorized',
    ])

    const arcGrouping = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        metadata: { providerNote: 'not part of the governed artifact' },
        acts: [
          { key: 'act.1', targetMinutes: '20', sceneCards: [{ key: 'scene.001', title: '一', locationOrdinal: '1' }] },
          { key: 'act.2', sceneCards: [{ key: 'scene.003', title: '三' }, { key: 'scene.002', title: '二' }] },
          { key: 'act.3', sceneCards: [{ key: 'scene.004', title: '四' }] },
        ],
      },
      { narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']] },
    )
    expect((arcGrouping.payload.acts as Array<{ sceneCards: Array<{ key: string }> }>).map(
      act => act.sceneCards.map(card => card.key),
    )).toEqual([['scene.001', 'scene.002'], ['scene.003'], ['scene.004']])
    const legalizedArcActs = arcGrouping.payload.acts as Array<{
      targetMinutes?: unknown
      sceneCards: Array<{ key: string; locationOrdinal?: unknown }>
    }>
    expect(legalizedArcActs[0].targetMinutes).toBe(20)
    expect(legalizedArcActs[0].sceneCards[0].locationOrdinal).toBe(1)
    expect(arcGrouping.payload).not.toHaveProperty('metadata')
    expect(arcGrouping.defaultedFields).toEqual([
      'metadata<-discarded-provider-annotation',
      'acts[0].targetMinutes<-decimal-string',
      'acts[0].sceneCards[0].locationOrdinal<-decimal-string',
      'acts[0].sceneCards<-frozen-scene-key-group',
      'acts[1].sceneCards<-frozen-scene-key-group',
    ])
    const arcCastAliases = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        acts: [
          { key: 'act.1', sceneCards: [{ key: 'scene.001', castKeys: ['岚舟', 'character.npc-01'] }] },
          { key: 'act.2', sceneCards: [{ key: 'scene.002', castKeys: ['character.protagonist', '涅洛', '涅洛'] }] },
          { key: 'act.3', sceneCards: [{ key: 'scene.003', castKeys: ['character.unregistered'] }] },
        ],
      },
      {
        narrativeArcSceneKeys: [['scene.001'], ['scene.002'], ['scene.003']],
        narrativeCastIdentities: [
          { key: 'character.player', name: '岚舟', role: 'player' },
          { key: 'character.npc-01', name: '涅洛', role: 'major-npc' },
        ],
      },
    )
    expect((arcCastAliases.payload.acts as Array<{
      sceneCards: Array<{ castKeys: string[] }>
    }>).map(act => act.sceneCards[0].castKeys)).toEqual([
      ['character.player', 'character.npc-01'],
      ['character.player', 'character.npc-01'],
      ['character.unregistered'],
    ])
    expect(arcCastAliases.defaultedFields).toContain(
      'acts[0].sceneCards[0].castKeys<-registered-cast-aliases',
    )
    expect(arcCastAliases.defaultedFields).toContain(
      'acts[1].sceneCards[0].castKeys<-registered-cast-aliases',
    )
    const fourActProviderShape = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        acts: [
          { key: 'act.1', title: '一', targetMinutes: 15, goal: '一', irreversibleTurn: '一', sceneCards: [{ key: 'scene.001' }] },
          { key: 'act.2', title: '二', targetMinutes: 15, goal: '二', irreversibleTurn: '二', sceneCards: [{ key: 'scene.002' }] },
          { key: 'act.3', title: '三', targetMinutes: 15, goal: '三', irreversibleTurn: '三', sceneCards: [{ key: 'scene.003' }] },
          { key: 'act.4', title: '四', targetMinutes: 15, goal: '四', irreversibleTurn: '四', sceneCards: [{ key: 'scene.004' }] },
        ],
      },
      {
        narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']],
        narrativeArcActTargetMinutes: [20, 20, 20],
      },
    )
    const rebuiltActs = fourActProviderShape.payload.acts as Array<{
      key: string
      targetMinutes: number
      sceneCards: Array<{ key: string }>
    }>
    expect(rebuiltActs.map(act => act.key)).toEqual(['act.1', 'act.2', 'act.3'])
    expect(rebuiltActs.map(act => act.targetMinutes)).toEqual([20, 20, 20])
    expect(rebuiltActs.map(act => act.sceneCards.map(scene => scene.key))).toEqual([
      ['scene.001', 'scene.002'], ['scene.003'], ['scene.004'],
    ])
    expect(fourActProviderShape.defaultedFields).toContain('acts<-frozen-three-act-group')

    const incompleteFourActShape = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      { acts: [
        { key: 'act.1', sceneCards: [{ key: 'scene.001' }] },
        { key: 'act.2', sceneCards: [{ key: 'scene.002' }] },
        { key: 'act.3', sceneCards: [{ key: 'scene.003' }] },
        { key: 'act.4', sceneCards: [] },
      ] },
      { narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']] },
    )
    expect(incompleteFourActShape.payload.acts).toHaveLength(4)
    const frozenArcLocations = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        acts: [
          { key: 'act.1', sceneCards: [{ key: 'scene.001', locationOrdinal: 2 }, { key: 'scene.002', locationOrdinal: 2 }] },
          { key: 'act.2', sceneCards: [{ key: 'scene.003', locationOrdinal: 1 }] },
          { key: 'act.3', sceneCards: [{ key: 'scene.004', locationOrdinal: 1 }] },
        ],
      },
      {
        narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']],
        narrativeArcLocationOrdinals: [1, 1, 2, 2],
        narrativeArcEndingKeys: ['ending.open', 'ending.hidden'],
      },
    )
    expect((frozenArcLocations.payload.acts as Array<{
      sceneCards: Array<{ locationOrdinal: number }>
    }>).flatMap(act => act.sceneCards.map(card => card.locationOrdinal))).toEqual([1, 1, 2, 2])
    expect(frozenArcLocations.defaultedFields).toContain(
      'acts[0].sceneCards[0].locationOrdinal<-frozen-location-plan',
    )
    expect(frozenArcLocations.payload.endings).toEqual([
      { endingKey: 'ending.open', sceneKey: 'scene.004' },
      { endingKey: 'ending.hidden', sceneKey: 'scene.004' },
    ])
    expect(frozenArcLocations.defaultedFields).toContain('endings<-frozen-narrative-skeleton')

    const frozenArcLocationBeforeLaterIdentityFailure = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-arc-scenes',
      {
        acts: [
          { key: 'act.1', sceneCards: [{ key: 'scene.001', locationOrdinal: 9 }, { key: 'scene.002', locationOrdinal: 9 }] },
          { key: 'act.2', sceneCards: [{ key: 'scene.003', locationOrdinal: 9 }] },
          { key: 'act.3', sceneCards: [{ key: 'scene.wrong', locationOrdinal: 9 }] },
        ],
      },
      {
        narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']],
        narrativeArcLocationOrdinals: [1, 1, 2, 2],
      },
    )
    expect((frozenArcLocationBeforeLaterIdentityFailure.payload.acts as Array<{
      sceneCards: Array<{ locationOrdinal: number }>
    }>).flatMap(act => act.sceneCards.map(card => card.locationOrdinal))).toEqual([1, 1, 2, 9])
    expect(frozenArcLocationBeforeLaterIdentityFailure.defaultedFields).toContain(
      'acts[1].sceneCards[0].locationOrdinal<-frozen-location-plan',
    )

    const decisionKeys = legalizeProductionModelProtocolDefaultsV1(
      'content.narrative-decision-plan',
      {
        decisions: [{
          key: '第一处抉择', sceneKey: 'scene.wrong', prompt: '是否公开？',
          options: [
            { key: '公开真相', persistentEffectKey: '公开！', label: '公开', cost: '失去庇护' },
            { key: 'option.invalid key', persistentEffectKey: '隐瞒！', label: '隐瞒', cost: '承担秘密' },
          ],
        }],
      },
      {
        narrativeDecisionSceneKeys: ['scene.001'],
        narrativeArcSceneKeys: [['scene.001', 'scene.002'], ['scene.003'], ['scene.004']],
      },
    )
    expect(decisionKeys.payload.decisions).toEqual([{
      key: 'decision.1', sceneKey: 'scene.001', prompt: '是否公开？',
      options: [
        {
          key: 'option.1.1', persistentEffectKey: 'flag.decision.1.1', label: '公开',
          cost: '失去庇护', echoSceneKeys: ['scene.002', 'scene.003'],
        },
        {
          key: 'option.1.2', persistentEffectKey: 'flag.decision.1.2', label: '隐瞒',
          cost: '承担秘密', echoSceneKeys: ['scene.002', 'scene.003'],
        },
      ],
    }])
    expect(decisionKeys.defaultedFields).toEqual([
      'decisions[0].key<-frozen-ordinal',
      'decisions[0].sceneKey<-frozen-scene-plan',
      'decisions[0].options[0].key<-frozen-ordinal',
      'decisions[0].options[0].persistentEffectKey<-frozen-ordinal',
      'decisions[0].options[0].echoSceneKeys<-frozen-later-scenes',
      'decisions[0].options[1].key<-frozen-ordinal',
      'decisions[0].options[1].persistentEffectKey<-frozen-ordinal',
      'decisions[0].options[1].echoSceneKeys<-frozen-later-scenes',
    ])

    const projectedQuestCast = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          characterKeys: ['船长', 'character.hallucinated'],
          objectives: [
            { sceneKeys: ['scene.001'] },
            { sceneKeys: ['scene.002'] },
          ],
        }],
      },
      {
        questSceneCastPlan: [
          { sceneKey: 'scene.001', castKeys: ['character.player', 'character.npc.1'] },
          { sceneKey: 'scene.002', castKeys: ['character.player', 'character.npc.2'] },
        ],
        questFallbackCastKeys: ['character.player'],
      },
    )
    expect((projectedQuestCast.payload.quests as Array<{ characterKeys: string[] }>)[0].characterKeys)
      .toEqual(['character.player', 'character.npc.1', 'character.npc.2'])
    expect(projectedQuestCast.defaultedFields).toEqual([
      'quests[0].characterKeys<-scene-cast-projection',
    ])

    const topologicallyOrderedQuest = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          stages: [
            { key: 'stage.2', objectiveKeys: ['objective.3'] },
            { key: 'stage.1', objectiveKeys: ['objective.2', 'objective.1'] },
          ],
          objectives: [
            { key: 'objective.1', sceneKeys: ['scene.001'] },
            { key: 'objective.2', sceneKeys: ['scene.002'] },
            { key: 'objective.3', sceneKeys: ['scene.003'] },
          ],
        }],
      },
      {
        questSceneCastPlan: [
          { sceneKey: 'scene.001', castKeys: [] },
          { sceneKey: 'scene.002', castKeys: [] },
          { sceneKey: 'scene.003', castKeys: [] },
        ],
      },
    )
    expect((topologicallyOrderedQuest.payload.quests as Array<{ stages: unknown[] }>)[0].stages)
      .toEqual([
        { key: 'stage.1', objectiveKeys: ['objective.1', 'objective.2'] },
        { key: 'stage.2', objectiveKeys: ['objective.3'] },
      ])
    expect(topologicallyOrderedQuest.defaultedFields).toContain(
      'quests[0].stages<-frozen-scene-topology',
    )

    const frozenQuestScriptIdentities = legalizeProductionModelProtocolDefaultsV1(
      'content.quest-script',
      {
        mainObjectiveScripts: [{
          objectiveKey: 'invented-objective', sceneKey: 'invented-scene',
          alternatives: [{
            alternativeKey: 'invented-alternative',
            resolution: {
              mode: 'automatic', abilityKey: 'ability.invented', difficulty: '31', costlySuccessFloor: '30',
            },
            timeCostMinutes: '4.6',
            successText: '无需检定即可完成。', costlySuccessText: '', failureForwardText: '   ',
          }, {
            alternativeKey: 'invented-alternative-2',
            resolution: {
              mode: 'check', abilityKey: 'ability.insight', difficulty: '31', costlySuccessFloor: '30',
            },
            timeCostMinutes: 0,
          }, {
            alternativeKey: 'surplus-alternative',
            resolution: { mode: 'automatic' }, timeCostMinutes: 5,
          }],
        }, {
          objectiveKey: 'surplus-objective', sceneKey: 'surplus-scene', alternatives: [],
        }],
        sideQuestScripts: [{
          entryKey: 'invented-side', stages: [{
            stageKey: 'invented-side-stage', actionKind: 'inspect', abilityKey: 'invented-ability',
            difficulty: '31', costlySuccessFloor: '30', timeCostMinutes: '8.4',
          }, {
            stageKey: 'invented-side-stage-2', actionKind: 'use', abilityKey: 'invented-ability',
            difficulty: 1, costlySuccessFloor: 0, timeCostMinutes: 121,
          }, {
            stageKey: 'surplus-side-stage', actionKind: 'inspect', abilityKey: 'ability.insight',
          }],
        }, { entryKey: 'surplus-side', stages: [] }],
        ambientEventScripts: [{
          entryKey: 'invented-ambient', stages: [{
            stageKey: 'invented-ambient-stage', actionKind: 'inspect', abilityKey: 'invented-ability',
            difficulty: 1, costlySuccessFloor: 0, timeCostMinutes: 121,
          }],
        }, { entryKey: 'surplus-ambient', stages: [] }],
      },
      {
        questScriptIdentityPlan: {
          mainObjectiveScripts: [{
            objectiveKey: 'objective.1', sceneKey: 'scene.001',
            alternativeKeys: ['alternative.1', 'alternative.2'],
          }],
          sideQuestScripts: [{
            entryKey: 'side.1', stages: [{
              stageKey: 'side.1.stage.1', actionKind: 'use', abilityKey: 'ability.insight',
              difficulty: 14, costlySuccessFloor: 10, timeCostMinutes: 7,
            }, {
              stageKey: 'side.1.stage.2', actionKind: 'inspect', abilityKey: 'ability.agility',
              difficulty: 16, costlySuccessFloor: 12, timeCostMinutes: 9,
            }],
          }],
          ambientEventScripts: [{
            entryKey: 'ambient.1', stages: [{
              stageKey: 'ambient.1.stage.1', actionKind: 'quest-action', abilityKey: 'ability.agility',
              difficulty: 8, costlySuccessFloor: 4, timeCostMinutes: 5,
            }],
          }],
        },
      },
    )
    expect(frozenQuestScriptIdentities.payload).toMatchObject({
      mainObjectiveScripts: [{
        objectiveKey: 'objective.1', sceneKey: 'scene.001',
        alternatives: [{
          alternativeKey: 'alternative.1',
          resolution: { mode: 'automatic', abilityKey: null, difficulty: null, costlySuccessFloor: null },
          timeCostMinutes: 5,
          successText: '无需检定即可完成。',
          costlySuccessText: '无需检定即可完成。',
          failureForwardText: '无需检定即可完成。',
        }, {
          alternativeKey: 'alternative.2',
          resolution: {
            mode: 'check', abilityKey: 'ability.insight', difficulty: 30, costlySuccessFloor: 29,
          },
          timeCostMinutes: 1,
        }],
      }],
      sideQuestScripts: [{
        entryKey: 'side.1', stages: [{
          stageKey: 'side.1.stage.1', actionKind: 'use', abilityKey: 'ability.insight',
          difficulty: 14, costlySuccessFloor: 10, timeCostMinutes: 7,
        }, {
          stageKey: 'side.1.stage.2', actionKind: 'inspect', abilityKey: 'ability.agility',
          difficulty: 16, costlySuccessFloor: 12, timeCostMinutes: 9,
        }],
      }],
      ambientEventScripts: [{
        entryKey: 'ambient.1', stages: [{
          stageKey: 'ambient.1.stage.1', actionKind: 'quest-action', abilityKey: 'ability.agility',
          difficulty: 8, costlySuccessFloor: 4, timeCostMinutes: 5,
        }],
      }],
    })
    expect(frozenQuestScriptIdentities.defaultedFields.length).toBeGreaterThanOrEqual(35)
    expect(frozenQuestScriptIdentities.defaultedFields).toEqual(expect.arrayContaining([
      'mainObjectiveScripts[1..1]<-discarded-surplus',
      'mainObjectiveScripts[0].alternatives[2..2]<-discarded-surplus',
      'sideQuestScripts[1..1]<-discarded-surplus',
      'sideQuestScripts[0].stages[2..2]<-discarded-surplus',
      'sideQuestScripts[0].stages[0].stageKey<-frozen-plan',
      'sideQuestScripts[0].stages[0].actionKind<-frozen-plan',
      'sideQuestScripts[0].stages[0].abilityKey<-frozen-plan',
      'ambientEventScripts[1..1]<-discarded-surplus',
    ]))

    const flattenedQuestObjectives = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          key: 'quest.main', title: '主线', description: '主线说明', characterKeys: [],
          stages: [{
            key: 'stage.1', title: '启程',
            objectives: [{
              key: 'objective.1', title: '登船', sceneKeys: ['scene.001'], locationOrdinal: 2,
              alternatives: [{
                actionKind: 'inspect', targetCharacterKey: 'character.npc.1',
                persistentEffectKeys: ['记住了潮汐！'],
              }, {
                actionKind: 'talk', targetCharacterKey: 'character.player',
              }],
            }],
          }],
        }],
      },
      {
        questSceneCastPlan: [{
          sceneKey: 'scene.001', castKeys: ['character.player', 'character.npc.1'],
          nonPlayerCastKeys: ['character.npc.1'], locationOrdinal: 1,
        }],
      },
    )
    const flattenedQuest = (
      flattenedQuestObjectives.payload.quests as Array<Record<string, unknown>>
    )[0]
    expect(flattenedQuest.stages).toEqual([{
      key: 'stage.1', title: '启程', objectiveKeys: ['objective.1'],
    }])
    expect(flattenedQuest.objectives).toEqual([{
      key: 'objective.1', title: '登船', sceneKeys: ['scene.001'], locationOrdinal: 1, stageKey: 'stage.1',
      alternatives: [{
        actionKind: 'inspect', targetCharacterKey: null,
        persistentEffectKeys: ['flag.quest.1.objective.1.alternative.1.effect.1'],
      }, {
        actionKind: 'talk', targetCharacterKey: 'character.npc.1',
        persistentEffectKeys: ['flag.quest.1.objective.1.alternative.2.effect.1'],
      }],
    }])
    expect(flattenedQuest.characterKeys).toEqual(['character.player', 'character.npc.1'])
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[0].targetCharacterKey<-non-talk-null',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[1].targetCharacterKey<-scene-npc',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[1].persistentEffectKeys<-required-event-flag',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].alternatives[0].persistentEffectKeys<-frozen-ordinal',
    )
    expect(flattenedQuestObjectives.defaultedFields).toContain(
      'quests[0].objectives[0].locationOrdinal<-scene-location-projection',
    )

    const repairedTalkTargets = legalizeProductionModelProtocolDefaultsV1(
      'content.main-quest-plan',
      {
        quests: [{
          key: 'quest.main', title: '主线', description: '主线说明', characterKeys: [],
          stages: [{ key: 'stage.1', title: '推进', objectiveKeys: ['objective.1', 'objective.2'] }],
          objectives: [{
            key: 'objective.1', stageKey: 'stage.1', title: '向在场者询问',
            sceneKeys: ['scene.001'], locationOrdinal: 1,
            alternatives: [{ actionKind: 'talk', targetCharacterKey: 'character.npc.absent' }],
          }, {
            key: 'objective.2', stageKey: 'stage.1', title: '独自处理',
            sceneKeys: ['scene.002'], locationOrdinal: 2,
            alternatives: [{ actionKind: 'talk', targetCharacterKey: 'character.npc.absent' }],
          }],
        }],
      },
      {
        questSceneCastPlan: [{
          sceneKey: 'scene.001', castKeys: ['character.player', 'character.npc.2', 'character.npc.3'],
          nonPlayerCastKeys: ['character.npc.2', 'character.npc.3'], locationOrdinal: 1,
        }, {
          sceneKey: 'scene.002', castKeys: ['character.player'], nonPlayerCastKeys: [], locationOrdinal: 2,
        }],
      },
    )
    const repairedObjectives = (
      (repairedTalkTargets.payload.quests as Array<Record<string, unknown>>)[0].objectives
    ) as Array<Record<string, unknown>>
    expect(repairedObjectives[0].alternatives).toEqual([expect.objectContaining({
      actionKind: 'talk', targetCharacterKey: 'character.npc.2',
    })])
    expect(repairedObjectives[1].alternatives).toEqual([expect.objectContaining({
      actionKind: 'quest-action', targetCharacterKey: null,
    })])
    expect(repairedTalkTargets.defaultedFields).toEqual(expect.arrayContaining([
      'quests[0].objectives[0].alternatives[0].targetCharacterKey<-scene-npc',
      'quests[0].objectives[1].alternatives[0].actionKind<-scene-without-npc',
    ]))

    const sceneScript = legalizeProductionModelProtocolDefaultsV1(
      'content.scene-script.act-2.part-1',
      {
        schema: 'provider.scene-script', version: 2, actKey: 'act.9', moduleTitle: '临时标题',
        scenes: [{
          sceneKey: 'scene.004', title: '潮门', summary: '潮声逼近。',
          endings: [],
          locationOrdinal: 4,
          providerMystery: 'must-remain-for-strict-parser',
          beats: [
            { beatKey: 'beat.2', kind: 'description', speakerKey: null, text: '后发生。', order: 2 },
            { beatKey: 'beat.1', kind: 'narration', speakerKey: 'character.npc.1', text: '先发生。', description: '非权威冗余注释', order: 1 },
          ],
          choices: [{
            choiceKey: 'choice.1', sourceNodeKey: 'scene.004', targetNodeKey: 'scene.005',
            text: '继续', description: '走向潮门。', unavailableReason: null, order: 0,
          }],
        }],
        choices: [{
          choiceKey: 'choice.1', sourceNodeKey: 'scene.004', targetNodeKey: 'scene.005',
          text: '继续', description: '走向潮门。', unavailableReason: null, order: 0,
        }],
        choiceKey: 'choice.1', sourceNodeKey: 'scene.004', targetNodeKey: 'scene.005',
        text: '继续', description: '走向潮门。', unavailableReason: null, order: 0,
        endings: [{
          endingKey: 'ending.1', title: '余潮', summary: '潮声退去。',
          beats: [
            { beatKey: 'beat.end.2', kind: ' Speech ', speakerKey: 'character.npc.1', text: '灯火熄灭。', order: 2 },
            { beatKey: 'beat.end.1', kind: 'action', speakerKey: 'character.npc.1', text: '天光升起。', order: 1 },
          ],
        }],
      },
      { sceneScriptModuleTitle: '潮钟群岛：最后的灯火' },
    )
    expect(sceneScript.payload).toMatchObject({
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact',
      version: 1,
      actKey: 'act.2',
      moduleTitle: '潮钟群岛：最后的灯火',
      scenes: [{
        beats: [
          { beatKey: 'beat.act-2.part-1.scene-01.001', speakerKey: null, order: 0 },
          { beatKey: 'beat.act-2.part-1.scene-01.002', kind: 'narration', order: 1 },
        ],
        choices: [expect.not.objectContaining({ unavailableReason: expect.anything() })],
      }],
      choices: [expect.not.objectContaining({ unavailableReason: expect.anything() })],
      endings: [{ beats: [
        { beatKey: 'beat.act-2.part-1.ending-01.001', speakerKey: null },
        { beatKey: 'beat.act-2.part-1.ending-01.002', kind: 'dialogue', speakerKey: 'character.npc.1' },
      ] }],
    })
    expect(sceneScript.defaultedFields).toEqual([
      'schema<-frozen-scene-script-envelope',
      'version<-frozen-scene-script-envelope',
      'actKey<-frozen-scene-script-envelope',
      'moduleTitle<-frozen-scene-script-envelope',
      'scenes[0].endings<-discarded-empty-misnested-endings',
      'scenes[0].locationOrdinal<-discarded-scene-annotation',
      'scenes[0].beats<-stable-order',
      'scenes[0].beats[0].description<-discarded-beat-annotation',
      'scenes[0].beats[0].order<-canonical-position',
      'scenes[0].beats[0].speakerKey<-non-dialogue-null',
      'scenes[0].beats[0].beatKey<-frozen-part-ordinal',
      'scenes[0].beats[1].kind<-protocol:narration',
      'scenes[0].beats[1].order<-canonical-position',
      'scenes[0].beats[1].beatKey<-frozen-part-ordinal',
      'scenes[0].choices[0].unavailableReason<-null-as-omitted',
      'endings[0].beats<-stable-order',
      'endings[0].beats[0].order<-canonical-position',
      'endings[0].beats[0].speakerKey<-non-dialogue-null',
      'endings[0].beats[0].beatKey<-frozen-part-ordinal',
      'endings[0].beats[1].kind<-protocol:dialogue',
      'endings[0].beats[1].order<-canonical-position',
      'endings[0].beats[1].beatKey<-frozen-part-ordinal',
      'choices[0].unavailableReason<-null-as-omitted',
      'choiceKey<-discarded-duplicate-root-choice',
      'sourceNodeKey<-discarded-duplicate-root-choice',
      'targetNodeKey<-discarded-duplicate-root-choice',
      'text<-discarded-duplicate-root-choice',
      'description<-discarded-duplicate-root-choice',
      'unavailableReason<-discarded-duplicate-root-choice',
      'order<-discarded-duplicate-root-choice',
    ])
    expect(sceneScript.payload).not.toHaveProperty('choiceKey')
    expect((sceneScript.payload.scenes as JsonRecord[])[0]).not.toHaveProperty('endings')
    expect((sceneScript.payload.scenes as JsonRecord[])[0]).not.toHaveProperty('locationOrdinal')
    expect((sceneScript.payload.scenes as JsonRecord[])[0]).toHaveProperty(
      'providerMystery',
      'must-remain-for-strict-parser',
    )

    const authoredMisnestedEndings = legalizeProductionModelProtocolDefaultsV1(
      'content.scene-script.act-3.part-1',
      {
        scenes: [{
          sceneKey: 'scene.011', title: '风暴眼', summary: '钟潮逼近。', beats: [],
          endings: [{ endingKey: 'ending.authored', title: '不能静默丢弃' }],
        }],
      },
      { sceneScriptModuleTitle: '潮钟群岛：最后的灯火' },
    )
    expect((authoredMisnestedEndings.payload.scenes as JsonRecord[])[0]).toHaveProperty(
      'endings',
      [{ endingKey: 'ending.authored', title: '不能静默丢弃' }],
    )
    expect(authoredMisnestedEndings.defaultedFields).not.toContain(
      'scenes[0].endings<-discarded-empty-misnested-endings',
    )

    const unknownBeatKind = legalizeProductionModelProtocolDefaultsV1(
      'content.scene-script.act-1.part-1',
      {
        scenes: [{
          sceneKey: 'scene.001', title: '开场', summary: '风暴将至。',
          beats: [{ beatKey: 'beat.bad', kind: 'banana', speakerKey: null, text: '风吹过钟塔。', order: 0 }],
        }],
      },
      { sceneScriptModuleTitle: '潮钟群岛：最后的灯火' },
    )
    expect((((unknownBeatKind.payload.scenes as JsonRecord[])[0].beats as JsonRecord[])[0]).kind)
      .toBe('banana')
    expect(unknownBeatKind.defaultedFields.some(field => field.includes('.kind<-'))).toBe(false)

    const emptySceneBeat = legalizeProductionModelProtocolDefaultsV1(
      'content.scene-script.act-1.part-1',
      {
        scenes: [{
          sceneKey: 'scene.001', title: '开场', summary: '风暴将至。',
          beats: [
            { beatKey: 'beat.1', kind: 'narration', speakerKey: null, text: '潮声逼近。', order: 0 },
            { beatKey: 'beat.2', kind: 'action', speakerKey: null, text: null, order: 1 },
            { beatKey: 'beat.3', kind: 'system', speakerKey: null, text: '   ', order: 2 },
            { beatKey: 'beat.4', kind: 'action', speakerKey: null, text: '岚舟扣紧工具袋。', order: 3 },
          ],
        }],
      },
      { sceneScriptModuleTitle: '潮钟群岛：最后的灯火' },
    )
    expect(((emptySceneBeat.payload.scenes as JsonRecord[])[0].beats as JsonRecord[]))
      .toMatchObject([
        { beatKey: 'beat.act-1.part-1.scene-01.001', text: '潮声逼近。', order: 0 },
        { beatKey: 'beat.act-1.part-1.scene-01.002', text: '岚舟扣紧工具袋。', order: 1 },
      ])
    expect(emptySceneBeat.discardedNullEntries).toEqual([
      'scenes[0].beats[1]', 'scenes[0].beats[2]',
    ])

    const recoveredSceneChoice = legalizeProductionModelProtocolDefaultsV1(
      'content.scene-script.act-1.part-2',
      {
        schema: 'storyforge.text-adventure-scene-script-bundle-artifact',
        version: 1,
        actKey: 'act.1',
        moduleTitle: '潮钟群岛：最后的灯火',
        scenes: [{
          sceneKey: 'scene.003', title: '守望台', summary: '风暴逼近。', beats: [],
          choices: [{
            choiceKey: 'choice.005', sourceNodeKey: 'scene.003', targetNodeKey: 'scene.004',
            text: '公开警报', description: '承担港区恐慌的即时压力。', unavailableReason: '', order: 0,
          }],
        }],
        endings: [],
      },
      {
        sceneScriptModuleTitle: '潮钟群岛：最后的灯火',
        sceneScriptChoiceFallbacks: [{
          choiceKey: 'choice.005', sourceNodeKey: 'scene.003', targetNodeKey: 'scene.004',
          text: '公开警报', description: '承担港区恐慌的即时压力。', unavailableReason: '', order: 0,
        }, {
          choiceKey: 'choice.006', sourceNodeKey: 'scene.003', targetNodeKey: 'scene.004',
          text: '先护送居民', description: '延迟警报并承担失去先机的代价。', unavailableReason: '', order: 1,
        }],
      },
    )
    expect(recoveredSceneChoice.payload).toMatchObject({
      scenes: [{ choices: [{ choiceKey: 'choice.005', text: '公开警报' }] }],
      choices: [{
        choiceKey: 'choice.006', sourceNodeKey: 'scene.003', targetNodeKey: 'scene.004',
        text: '先护送居民', description: '延迟警报并承担失去先机的代价。', order: 1,
      }],
    })
    expect(recoveredSceneChoice.defaultedFields).toEqual([
      'choices[0]<-frozen-decision-fallback',
    ])

    const dialogueReview = legalizeProductionModelProtocolDefaultsV1(
      'content.dialogue-pass.act-3',
      {
        schema: 'provider.dialogue-review', version: 2, actKey: 'act.1',
        reviewedCharacterCount: 2, reviewedBeatCount: 18, reviewedChoiceCount: 4,
        beatReviews: [], choiceReviews: [],
      },
      {
        dialogueReviewContract: {
          actKey: 'act.3', reviewedCharacterCount: 3,
          reviewedBeatCount: 34, reviewedChoiceCount: 6,
          beatOrdinals: [{ key: 'beat.031', ordinal: 1 }],
          choiceOrdinals: [{ key: 'choice.019', ordinal: 1 }],
        },
      },
    )
    expect(dialogueReview.payload).toMatchObject({
        schema: 'storyforge.text-adventure-dialogue-pass-artifact', version: 1, actKey: 'act.3',
        reviewedCharacterCount: 3, reviewedBeatCount: 34, reviewedChoiceCount: 6,
    })
    expect(dialogueReview.defaultedFields).toEqual([
      'schema<-frozen-dialogue-review-contract',
      'version<-frozen-dialogue-review-contract',
      'actKey<-frozen-dialogue-review-contract',
      'reviewedCharacterCount<-frozen-dialogue-review-contract',
      'reviewedBeatCount<-frozen-dialogue-review-contract',
      'reviewedChoiceCount<-frozen-dialogue-review-contract',
    ])

    const normalizedDialogueOrdinals = legalizeProductionModelProtocolDefaultsV1(
      'content.dialogue-pass.act-3',
      {
        schema: 'storyforge.text-adventure-dialogue-pass-artifact', version: 1, actKey: 'act.3',
        reviewedCharacterCount: 3, reviewedBeatCount: 34, reviewedChoiceCount: 6,
        beatReviews: [{
          beatOrdinal: '2', issueTags: ['exposition'], rationale: '压缩说明。', revisedText: '潮声逼近。',
        }],
        choiceReviews: [{
          choiceOrdinal: 'choice.020', issueTags: ['player-intent'], rationale: '澄清行动。',
          revisedText: '守住灯塔', revisedDescription: '承担最后的代价。',
        }, {
          choiceKey: 'choice.021', issueTags: ['player-intent'], rationale: '澄清另一行动。',
          revisedText: '驶向外海', revisedDescription: '把消息带出群岛。',
        }, {
          choiceOrdinal: 22, issueTags: ['player-intent'], rationale: '按稳定 key 尾号引用。',
          revisedText: '交出钟钥', revisedDescription: '以钟钥换取航路。',
        }],
      },
      {
        dialogueReviewContract: {
          actKey: 'act.3', reviewedCharacterCount: 3,
          reviewedBeatCount: 34, reviewedChoiceCount: 6,
          beatOrdinals: [{ key: 'beat.031', ordinal: 1 }, { key: 'beat.032', ordinal: 2 }],
          choiceOrdinals: [
            { key: 'choice.019', ordinal: 1 },
            { key: 'choice.020', ordinal: 2 },
            { key: 'choice.021', ordinal: 3 },
            { key: 'choice.022', ordinal: 4 },
          ],
        },
      },
    )
    expect(normalizedDialogueOrdinals.payload).toMatchObject({
      beatReviews: [{ beatOrdinal: 2 }],
      choiceReviews: [{ choiceOrdinal: 2 }, { choiceOrdinal: 3 }, { choiceOrdinal: 4 }],
    })
    expect(normalizedDialogueOrdinals.payload).not.toHaveProperty('choiceReviews.1.choiceKey')
    expect(normalizedDialogueOrdinals.defaultedFields).toEqual([
      'beatReviews[0].beatOrdinal<-frozen-key-or-numeric-string',
      'choiceReviews[0].choiceOrdinal<-frozen-key-or-numeric-string',
      'choiceReviews[1].choiceOrdinal<-frozen-key-or-numeric-string',
      'choiceReviews[1].choiceKey<-discarded-after-exact-ordinal-resolution',
      'choiceReviews[2].choiceOrdinal<-frozen-key-or-numeric-string',
    ])

    const normalizedLegacyDialogueDelta = legalizeProductionModelProtocolDefaultsV1(
      'content.dialogue-pass.act-3',
      {
        reviewedCharacterCount: 3, reviewedBeatCount: 34, reviewedChoiceCount: 6,
        summary: '旧版完整审校摘要。',
        dialogueBeats: [{ beatOrdinal: 1, text: '只读输入回显。' }],
        choices: [{ choiceOrdinal: 1, text: '只读选择回显。' }],
        beatReviews: [{
          beatKey: 'beat.031', speakerKey: null, verdict: 'keep',
          issueTags: ['none'], rationale: '原文可保留。', revisedText: '原文。',
        }, {
          beatKey: 'beat.032', speakerKey: null, verdict: 'revise',
          issueTags: ['exposition'], rationale: '压缩说明。', revisedText: '潮声逼近。',
        }],
        choiceReviews: [{
          choiceKey: 'choice.019', speakerKey: null, verdict: 'keep', issueTags: ['none'],
          rationale: '意图清楚。', revisedText: '保留', revisedDescription: '保留。',
        }, {
          choiceKey: 'choice.020', choiceOrdinal: 'unknown-legacy-value', speakerKey: null,
          verdict: 'revise', issueTags: ['player-intent'],
          rationale: '澄清行动。', revisedText: '守住灯塔', revisedDescription: '承担最后的代价。',
        }],
      },
      {
        dialogueReviewContract: {
          actKey: 'act.3', reviewedCharacterCount: 3,
          reviewedBeatCount: 34, reviewedChoiceCount: 6,
          beatOrdinals: [{ key: 'beat.031', ordinal: 1 }, { key: 'beat.032', ordinal: 2 }],
          choiceOrdinals: [{ key: 'choice.019', ordinal: 1 }, { key: 'choice.020', ordinal: 2 }],
        },
      },
    )
    expect(normalizedLegacyDialogueDelta.payload).toMatchObject({
      beatReviews: [{ beatOrdinal: 2, issueTags: ['exposition'], revisedText: '潮声逼近。' }],
      choiceReviews: [{ choiceOrdinal: 2, issueTags: ['player-intent'], revisedText: '守住灯塔' }],
    })
    expect(normalizedLegacyDialogueDelta.payload).not.toHaveProperty('beatReviews.0.speakerKey')
    expect(normalizedLegacyDialogueDelta.payload).not.toHaveProperty('beatReviews.0.verdict')
    expect(normalizedLegacyDialogueDelta.payload).not.toHaveProperty('choiceReviews.0.verdict')
    expect(normalizedLegacyDialogueDelta.payload).not.toHaveProperty('summary')
    expect(normalizedLegacyDialogueDelta.payload).not.toHaveProperty('dialogueBeats')
    expect(normalizedLegacyDialogueDelta.payload).not.toHaveProperty('choices')

    const unknownDialogueOrdinal = legalizeProductionModelProtocolDefaultsV1(
      'content.dialogue-pass.act-3',
      {
        reviewedCharacterCount: 3, reviewedBeatCount: 34, reviewedChoiceCount: 6,
        beatReviews: [], choiceReviews: [{ choiceOrdinal: 'choice.unknown' }],
      },
      {
        dialogueReviewContract: {
          actKey: 'act.3', reviewedCharacterCount: 3,
          reviewedBeatCount: 34, reviewedChoiceCount: 6,
          beatOrdinals: [], choiceOrdinals: [{ key: 'choice.019', ordinal: 1 }],
        },
      },
    )
    expect(unknownDialogueOrdinal.payload).toMatchObject({
      choiceReviews: [{ choiceOrdinal: 'choice.unknown' }],
    })

    const narrative = legalizeProductionModelProtocolDefaultsV1('content.narrative', {
      nodes: [{
        key: 'entry', kind: 'entry', title: '入口', summary: '开始。',
        condition: { path: '', eq: true }, effects: ['invented-state-change'],
      }],
      beats: [{ beatKey: 'beat.entry', nodeKey: 'entry', kind: 'narration', text: '雾散了。' }],
      choices: [{
        choiceKey: 'choice.leave', sourceNodeKey: 'entry', text: '离开',
        targetNodeKey: 'ending', availableCondition: { all: [], leaked: true },
        effects: ['invented-choice-effect'], leaked: true,
      }, null],
    }, { narrativeStatePolicy: 'empty-unregistered' })
    expect(narrative.payload).toMatchObject({
      nodes: [{ condition: {}, effects: [] }],
      beats: [{ speakerKey: null, order: 0 }],
      choices: [{
        description: '', unavailableReason: '', displayCondition: {}, availableCondition: {},
        effects: [], tags: [], order: 0, leaked: true,
      }],
    })
    expect(narrative.defaultedFields).toContain('choices[0].description')
    expect(narrative.discardedNullEntries).toEqual(['choices[1]'])
    expect(narrative.discardedUnregisteredStateFields).toEqual([
      'nodes[0].condition', 'nodes[0].effects',
      'choices[0].availableCondition', 'choices[0].effects',
    ])

    const quests = legalizeProductionModelProtocolDefaultsV1('content.adventure-ambient-events', {
      entries: [{
        key: 'tide-warning', title: '潮汐警告', hook: '旧仓街响起三次敲击', leaked: true,
        stages: [{
          key: 'follow-echo', title: '追随回声', objective: '在旧仓街确认回声来源',
          locationOrdinal: 1, actionOrdinal: 2, successText: '旧仓街的回声得到回应。',
        }, null],
      }],
    }, { questLocationTitles: ['潮门广场', '旧仓街'] })
    expect(quests.payload).toMatchObject({
      entries: [{
        rewardExperience: 2, rewardCurrency: 0, leaked: true,
        stages: [{ locationOrdinal: 2 }],
      }],
    })
    expect(quests.defaultedFields).toEqual([
      'entries[0].rewardExperience', 'entries[0].rewardCurrency',
      'entries[0].stages[0].timeCostMinutes',
      'entries[0].stages[0].actionOrdinal<-discarded-order-metadata',
      'entries[0].stages[0].locationOrdinal<-stage-location',
    ])
    expect((quests.payload.entries as Array<{ stages: Array<Record<string, unknown>> }>)[0]
      .stages[0]).not.toHaveProperty('actionOrdinal')
    expect(quests.discardedNullEntries).toEqual(['entries[0].stages[1]'])
    expect(quests.discardedUnregisteredStateFields).toEqual([])

    const anchoredQuest = legalizeProductionModelProtocolDefaultsV1(
      'content.adventure-side-quests',
      {
        entries: [{
          stages: [{
            title: '修复破损浮标',
            objective: '找到被风暴卷走的铜制定位片',
            locationOrdinal: 2,
            successText: '定位片重新发出微光。',
            costlySuccessText: '定位片亮了，但耽误了潮汐窗口。',
            failureText: '虽然没能修好，你仍找到了替代航线。',
          }],
        }],
      },
      { questLocationTitles: ['潮门广场', '冰窟渔村'] },
    )
    expect(anchoredQuest.payload).toMatchObject({
      entries: [{
        stages: [{
          locationOrdinal: 2,
          objective: '在冰窟渔村，找到被风暴卷走的铜制定位片',
        }],
      }],
    })
    expect(anchoredQuest.defaultedFields).toContain(
      'entries[0].stages[0].objective<-frozen-location-anchor',
    )
  })

  it('文字冒险单项图片在有界重试耗尽后生成显式纯文字降级工件', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'key-scenes' })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: owned.brief })
    const task = plan.tasks.find(item => item.taskKey === 'media.visual.001')!
    const mediaRequirements = {
      ...modelOutputs(
      owned.brief.source.worldContentHash,
      'text-adventure',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
      )['media.requirements'],
      audio: [],
    }
    const professional = professionalTextAdventurePlanningOutputs(owned.brief)
    const cast = professional['content.cast-bible'] as {
      characters: Array<{
        key: string; name: string; role: 'player' | 'major-npc' | 'supporting-npc'
        publicIdentity: string; visualAnchor: string
      }>
    }
    const visualBibleHash = 'f'.repeat(64)
    const visualBible = {
      schema: 'storyforge.text-adventure-visual-bible-artifact', version: 1,
      style: '雾港写实插画', palette: ['#172033', '#52647A', '#D8C6A0'],
      compositionRules: ['保留文字安全区', '人物关系优先'],
      continuityRules: ['角色身份连续', '服装标志物连续', '场景光照连续'],
      characterAnchors: cast.characters.map(character => ({
        characterKey: character.key, name: character.name, role: character.role,
        identity: character.publicIdentity, visualAnchor: character.visualAnchor,
        requirementArtifactKeys: [], palette: ['#172033', '#52647A', '#D8C6A0'],
        hardConstraints: ['保持身份年龄', `身份:${character.publicIdentity}`, `锚点:${character.visualAnchor}`],
      })),
      assetRequirements: mediaRequirements.visual.map(requirement => ({
        artifactKey: requirement.artifactKey, mediaKind: requirement.mediaKind,
        sceneTag: requirement.sceneTag, beatKey: requirement.beatKey,
      })),
    }
    const visualAnchorConfirmationHash = await textAdventureVisualAnchorConfirmationHashV1(visualBible)
    const artifact = (
      artifactKey: string,
      kind: ProductBuildArtifactRecordV1['kind'],
      payload: unknown,
      contentHash: string,
    ): ProductBuildArtifactRecordV1 => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1,
      kind, mediaKind: null, status: 'accepted', producerRunId: null,
      producerReceiptHash: null, controlEpoch: 0, inputHash: 'a'.repeat(64),
      contentHash, payloadJson: JSON.stringify(payload),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: 1, parentArtifactHash: null, carriedFrom: null,
      createdAt: 1, updatedAt: 1,
    })
    const inputArtifacts = [
      artifact('media.requirements', 'asset-manifest', mediaRequirements, 'b'.repeat(64)),
      artifact('content.cast-bible', 'product-design', professional['content.cast-bible'], 'a'.repeat(64)),
      artifact('media.visual-bible', 'visual-bible', visualBible, visualBibleHash),
      artifact('media.anchor-decision', 'visual-bible', {
        schema: 'storyforge.text-adventure-media-anchor-decision-artifact', version: 1,
        visualBibleHash: visualAnchorConfirmationHash,
        decision: 'not-required-noncommercial', confirmedCharacterKeys: [],
        authorCommandId: null, authorNote: null,
      }, '9'.repeat(64)),
    ]
    const executor = createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief,
    })
    const execution = {
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'c'.repeat(64), task, attempt: 1,
      idempotencyKey: 'd'.repeat(64), contextText: '', inputArtifacts,
      capabilityBindings: [{
        requirementKey: 'media.visual', adapterId: 'missing.fixture', bindingHash: 'e'.repeat(64),
      }],
      authorResolution: null, signal: new AbortController().signal,
    }
    await expect(executor(execution)).rejects.toThrow('媒资 capability 未按冻结 binding 解析')
    const fallback = await executor({ ...execution, attempt: task.maxAttempts })
    expect(fallback.usage).toMatchObject({ mediaCalls: 1, costUsd: null, storageBytes: 0 })
    expect(fallback.artifacts).toEqual([expect.objectContaining({
      artifactKey: 'media.visual.001', kind: 'integration-report',
      payload: expect.objectContaining({
        schema: 'storyforge.omitted-media-artifact', fallback: 'text-only',
      }),
      quality: expect.objectContaining({ providerAttemptsExhausted: task.maxAttempts }),
    })])

    const fallbackRows: ProductBuildArtifactRecordV1[] = []
    for (const visualTask of plan.tasks.filter(item => /^media\.visual\.\d{3}$/.test(item.taskKey))) {
      const result = visualTask.taskKey === task.taskKey
        ? fallback
        : await executor({ ...execution, task: visualTask, attempt: visualTask.maxAttempts })
      const candidate = result.artifacts[0]
      const row = artifact(
        candidate.artifactKey,
        'integration-report',
        candidate.payload,
        await hashProductProductionValueV2(candidate.payload),
      )
      row.metadataJson = JSON.stringify(candidate.metadata ?? {})
      row.qualityJson = JSON.stringify(candidate.quality ?? {})
      row.rightsJson = JSON.stringify(candidate.rights ?? {})
      fallbackRows.push(row)
    }
    const auditTask = plan.tasks.find(item => item.taskKey === 'media.audit')!
    const audit = await executor({
      ...execution, task: auditTask, attempt: 1,
      inputArtifacts: [
        artifact('media.requirements', 'asset-manifest', mediaRequirements, 'b'.repeat(64)),
        artifact('content.cast-bible', 'product-design', professional['content.cast-bible'], 'a'.repeat(64)),
        artifact('media.visual-bible', 'visual-bible', visualBible, visualBibleHash),
        ...fallbackRows,
      ],
    })
    expect(audit.artifacts[0]).toMatchObject({
      artifactKey: 'media.audit', kind: 'integration-report',
      payload: {
        schema: 'storyforge.text-adventure-media-audit-artifact', passed: true,
        assets: mediaRequirements.visual.map((requirement: { artifactKey: string }) => ({
          artifactKey: requirement.artifactKey, status: 'text-fallback', assetKey: null,
          rightsComplete: true, fallbackReason: 'provider-unavailable-after-bounded-retry',
        })),
      },
    })
  })

  it('商业文字冒险先编译独立视觉圣经，未确认角色锚点时绝不允许开始出图', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'key-scenes', qualityProfile: 'commercial-candidate',
    })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: owned.brief })
    const compileTask = plan.tasks.find(item => item.taskKey === 'media.visual-bible.compile')!
    const preflightTask = plan.tasks.find(item => item.taskKey === 'media.vision-preflight')!
    const anchorGateTask = plan.tasks.find(item => item.taskKey === 'media.anchor-author-gate')!
    const visualKeys = plan.tasks.filter(item => /^media\.visual\.\d{3}$/.test(item.taskKey))
      .map(item => item.taskKey)
    const professional = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const castKeys = ['character.player', 'character.npc.1', 'character.npc.2']
    const visualBlueprints = textAdventureVisualBlueprintsV1(visualKeys.length)
    const mediaRequirements = {
      schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: visualKeys.map((artifactKey, index) => ({
        artifactKey, mediaKind: visualBlueprints[index].mediaKind,
        sceneTag: visualBlueprints[index].sceneTag,
        beatKey: visualBlueprints[index].beatKey,
        prompt: visualBlueprints[index].prompt,
        altText: visualBlueprints[index].altText,
        width: visualBlueprints[index].width, height: visualBlueprints[index].height,
        palette: ['#172033', '#52647A', '#D8C6A0'],
        characterAnchorRefs: visualBlueprints[index].characterOrdinal == null
          ? [] : [castKeys[visualBlueprints[index].characterOrdinal]],
        hardConstraints: [],
      })),
      audio: [],
    }
    mediaRequirements.visual[1].hardConstraints = ['只属于玩家立绘的测试姿势']
    mediaRequirements.visual[6].hardConstraints = ['只属于第一位 NPC 的测试道具']
    ;[
      ['#101820', '#203040', '#304860'],
      ['#402010', '#604020', '#806030'],
      ['#102840', '#205080', '#3078A0'],
      ['#302050', '#503070', '#704090'],
      ['#204030', '#306050', '#408070'],
    ].forEach((palette, paletteIndex) => {
      const visualIndex = [1, 3, 7, 9, 11][paletteIndex]
      mediaRequirements.visual[visualIndex].characterAnchorRefs = [castKeys[0]]
      if (visualBlueprints[visualIndex].characterOrdinal == null) {
        mediaRequirements.visual[visualIndex].prompt = `守灯人站在第 ${paletteIndex + 1} 个关键场面中采取行动。`
      }
      mediaRequirements.visual[visualIndex].palette = palette
    })
    const artifact = async (
      artifactKey: string,
      kind: ProductBuildArtifactRecordV1['kind'],
      payload: unknown,
    ): Promise<ProductBuildArtifactRecordV1> => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1, kind,
      mediaKind: null, status: 'accepted', producerRunId: null, producerReceiptHash: null,
      controlEpoch: 0, inputHash: 'a'.repeat(64),
      contentHash: await hashProductProductionValueV2(payload), payloadJson: JSON.stringify(payload),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: 1, parentArtifactHash: null, carriedFrom: null,
      createdAt: 1, updatedAt: 1,
    })
    const production = (await db.productProductions.get(owned.productionId))!
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = '8'.repeat(64)
    let preflightMode: 'observe' | 'wrong-order' | 'no-image' | 'echo-prompt' = 'observe'
    let acceptedQuadrants: string[] = []
    const observedImages: Array<{ artifactKey: string; contentHash: string; byteLength: number }> = []
    const runVision: ProductionVisionRunnerV1 = async request => {
      expect(request.images).toHaveLength(1)
      const decodedQuadrants = decodeVisionPreflightQuadrants(request.images[0].data)
      expect(request.images[0].contentHash).toBe(await sha256MediaData(request.images[0].data))
      expect(request.system).not.toContain(JSON.stringify(decodedQuadrants))
      if (preflightMode === 'no-image') throw new Error('fixture provider cannot observe attached image')
      observedImages.push(...request.images.map(image => ({
        artifactKey: image.artifactKey,
        contentHash: image.contentHash,
        byteLength: image.data.byteLength,
      })))
      const observedQuadrants = preflightMode === 'wrong-order'
        ? [...decodedQuadrants].reverse()
        : preflightMode === 'echo-prompt'
          ? ['black', 'blue', 'cyan', 'green']
          : decodedQuadrants
      if (preflightMode === 'observe') acceptedQuadrants = decodedQuadrants
      return {
        output: JSON.stringify({
          schema: 'storyforge.text-adventure-vision-capability-preflight-model-output',
          version: 1,
          observedQuadrants,
        }),
        usage: { inputTokens: 50, outputTokens: 20 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-vision', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: '7'.repeat(64),
        },
      }
    }
    const executor = createConfiguredProductProductionExecutorV1({
      production, brief: owned.brief, runVision,
    })
    const compileResult = await executor({
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'b'.repeat(64), task: compileTask, attempt: 1,
      idempotencyKey: 'c'.repeat(64), contextText: '', capabilityBindings: [],
      inputArtifacts: [
        await artifact('content.cast-bible', 'product-design', professional['content.cast-bible']),
        await artifact('content.adventure-architecture', 'product-design', professional['content.adventure-architecture']),
        await artifact('media.requirements', 'asset-manifest', mediaRequirements),
      ],
      authorResolution: null, signal: new AbortController().signal,
    })
    const visualBiblePayload = compileResult.artifacts[0].payload
    const playerVisualAnchor = (
      visualBiblePayload as { characterAnchors: Array<{ characterKey: string; palette: string[]; hardConstraints: string[] }> }
    ).characterAnchors.find(anchor => anchor.characterKey === castKeys[0])!
    expect(playerVisualAnchor.palette).toHaveLength(8)
    expect(playerVisualAnchor.palette).toEqual([
      '#101820', '#203040', '#304860', '#402010', '#604020', '#806030', '#102840', '#205080',
    ])
    expect(playerVisualAnchor.hardConstraints).not.toContain('只属于玩家立绘的测试姿势')
    expect(playerVisualAnchor.hardConstraints).not.toContain('只属于第一位 NPC 的测试道具')
    expect(playerVisualAnchor.hardConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining('角色身份：'),
      expect.stringContaining('视觉锚点：'),
    ]))
    const visualBibleArtifact = await artifact('media.visual-bible', 'visual-bible', visualBiblePayload)
    const preflightExecution = {
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'b'.repeat(64), task: preflightTask, attempt: 1,
      idempotencyKey: '6'.repeat(64), contextText: '{"registered":true}',
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text.v1',
        bindingHash,
        provider: 'fixture',
        model: 'fixture-vision',
      }],
      inputArtifacts: [visualBibleArtifact], authorResolution: null,
      signal: new AbortController().signal,
    }
    const preflightResult = await executor(preflightExecution)
    expect(observedImages).toEqual([expect.objectContaining({
      artifactKey: 'media.vision-preflight.fixture', byteLength: expect.any(Number),
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })])
    expect(observedImages[0].byteLength).toBeGreaterThan(0)
    expect(preflightResult).toMatchObject({
      usage: { modelCalls: 1, mediaCalls: 0, inputTokens: 50, outputTokens: 20 },
      artifacts: [{
        artifactKey: 'media.vision-preflight', kind: 'integration-report',
        payload: {
          schema: 'storyforge.text-adventure-vision-capability-preflight', version: 2,
          buildNumber: 1, passed: true, capabilityHash: bindingHash,
          provider: 'fixture', model: 'fixture-vision',
          textCapabilityBindingHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          observedQuadrants: acceptedQuadrants,
        },
      }],
    })
    preflightMode = 'wrong-order'
    await expect(executor({
      ...preflightExecution,
      idempotencyKey: '5'.repeat(64),
    })).rejects.toThrow('未能正确观察真实图片的四象限颜色')
    preflightMode = 'echo-prompt'
    await expect(executor({
      ...preflightExecution,
      idempotencyKey: '4'.repeat(64),
    })).rejects.toThrow('未能正确观察真实图片的四象限颜色')
    preflightMode = 'no-image'
    await expect(executor({
      ...preflightExecution,
      idempotencyKey: '3'.repeat(64),
    })).rejects.toThrow('cannot observe attached image')
    preflightMode = 'observe'
    const preflightArtifact = await artifact(
      'media.vision-preflight', 'integration-report', preflightResult.artifacts[0].payload,
    )
    const gateInput = {
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'b'.repeat(64), task: anchorGateTask, attempt: 1,
      idempotencyKey: 'd'.repeat(64), contextText: '',
      capabilityBindings: preflightExecution.capabilityBindings,
      inputArtifacts: [
        await artifact('content.cast-bible', 'product-design', professional['content.cast-bible']),
        visualBibleArtifact,
        preflightArtifact,
      ],
      authorResolution: null, signal: new AbortController().signal,
    }
    const legacyTwoImageBrief = structuredClone(owned.brief)
    legacyTwoImageBrief.media.imageCount = 2
    const legacyExecutor = createConfiguredProductProductionExecutorV1({
      production,
      brief: legacyTwoImageBrief,
    })
    await expect(legacyExecutor(gateInput)).rejects.toThrow(
      '商业文字冒险媒资计划不足:2/12',
    )
    await expect(executor({
      ...gateInput,
      inputArtifacts: gateInput.inputArtifacts.filter(item => item.artifactKey !== 'media.vision-preflight'),
    })).rejects.toThrow('输入 Artifact 缺失:media.vision-preflight')
    const wrongBuildPreflight = await artifact('media.vision-preflight', 'integration-report', {
      ...(preflightResult.artifacts[0].payload as Record<string, unknown>),
      buildNumber: 2,
    })
    await expect(executor({
      ...gateInput,
      inputArtifacts: gateInput.inputArtifacts.map(item => item.artifactKey === 'media.vision-preflight'
        ? wrongBuildPreflight : item),
    })).rejects.toThrow('图片输入能力预检缺失、过期或未通过')
    const wrongSchemaPreflight = await artifact('media.vision-preflight', 'integration-report', {
      ...(preflightResult.artifacts[0].payload as Record<string, unknown>),
      schema: 'storyforge.text-adventure-vision-capability-preflight-artifact',
    })
    await expect(executor({
      ...gateInput,
      inputArtifacts: gateInput.inputArtifacts.map(item => item.artifactKey === 'media.vision-preflight'
        ? wrongSchemaPreflight : item),
    })).rejects.toThrow('图片输入能力预检缺失、过期或未通过')
    await expect(executor({
      ...gateInput,
      capabilityBindings: [{
        ...preflightExecution.capabilityBindings[0],
        bindingHash: '9'.repeat(64),
      }],
    })).rejects.toThrow('图片输入能力预检缺失、过期或未通过')
    await expect(executor({
      ...gateInput,
      capabilityBindings: [{
        ...preflightExecution.capabilityBindings[0],
        model: 'fixture-vision-v2',
      }],
    })).rejects.toThrow('图片输入能力预检缺失、过期或未通过')
    await expect(executor(gateInput)).rejects.toThrow('需要作者明确确认角色视觉锚点')
    const confirmed = await executor({
      ...gateInput,
      authorResolution: {
        commandId: 'author.confirm-character-anchors', blockerKey: 'media.anchor-author-gate',
        resolution: { action: 'confirm-character-anchors' as const, note: '已逐项审查并确认全部角色锚点。' },
        resolvedAt: 2,
      },
    })
    expect(confirmed.artifacts[0]).toMatchObject({
      artifactKey: 'media.anchor-decision',
      payload: {
        decision: 'confirm-character-anchors',
        authorCommandId: 'author.confirm-character-anchors',
        confirmedCharacterKeys: expect.arrayContaining(['character.player']),
      },
    })
    const originalDecision = confirmed.artifacts[0].payload as Record<string, unknown>
    const changedVisualBible = structuredClone(visualBiblePayload) as {
      assetRequirements: Array<{ sceneTag: string; beatKey: string }>
    }
    changedVisualBible.assetRequirements[0].sceneTag = 'changed-scene'
    changedVisualBible.assetRequirements[0].beatKey = 'changed-beat'
    const firstVisualTask = plan.tasks.find(task => task.taskKey === visualKeys[0])!
    await expect(executor({
      ...gateInput,
      task: firstVisualTask,
      inputArtifacts: [
        await artifact('media.requirements', 'asset-manifest', mediaRequirements),
        await artifact('content.cast-bible', 'product-design', professional['content.cast-bible']),
        await artifact('media.visual-bible', 'visual-bible', changedVisualBible),
        await artifact('media.anchor-decision', 'visual-bible', originalDecision),
      ],
      authorResolution: null,
    })).rejects.toThrow('mediaAnchorDecision schema/version/hash 无效')
  })

  it('独立 Visual QA Director 实际接收冻结图片 key/hash，并由逐项证据派生审图结论', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'key-scenes' })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: owned.brief })
    const plannedTask = plan.tasks.find(item => item.taskKey === 'media.visual-quality-review.batch-1')!
    // Keep one legacy two-image task fixture to prove an in-flight plan from
    // before the one-image-per-Run migration remains parseable and repairable.
    const imageKeys = ['media.visual.001', 'media.visual.002']
    const task = {
      ...plannedTask,
      inputArtifactKeys: [...plannedTask.inputArtifactKeys, imageKeys[1]],
    }
    const plannedAssemblyTask = plan.tasks.find(item => item.taskKey === 'media.visual-quality-review')!
    const assemblyTask = {
      ...plannedAssemblyTask,
      dependsOn: [task.taskKey],
      inputArtifactKeys: ['media.audit', task.outputArtifactKeys[0]],
      requiredReceipts: [{ taskKey: task.taskKey, receiptHash: null }],
    }
    const blob = await putMediaBlobObject({
      scope: owned.scope,
      data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
      mimeType: 'image/png',
    })
    const auditPayload = {
      schema: 'storyforge.text-adventure-media-audit-artifact', version: 1,
      buildNumber: 1, requirementsHash: 'a'.repeat(64), visualBibleHash: 'b'.repeat(64),
      assets: imageKeys.map((artifactKey, index) => ({
        artifactKey, status: 'fulfilled', assetKey: `current.text-adventure.build-1.${artifactKey}`,
        requirementHash: String(index + 1).repeat(64).slice(0, 64), contentHash: blob.contentHash,
        mimeType: 'image/png', width: 1280, height: 720,
        source: 'fixture-provider', license: 'fixture-license', rightsComplete: true, fallbackReason: null,
      })),
      passed: true,
    }
    const auditHash = await hashProductProductionValueV2(auditPayload)
    const artifact = (artifactKey: string, options: Partial<ProductBuildArtifactRecordV1> = {}): ProductBuildArtifactRecordV1 => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1, kind: 'image', mediaKind: 'background',
      status: 'accepted', producerRunId: null, producerReceiptHash: null, controlEpoch: 0,
      inputHash: 'c'.repeat(64), contentHash: blob.contentHash, payloadJson: '{}',
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: blob.id!,
      mimeType: 'image/png', byteSize: blob.byteSize, parentArtifactHash: null, carriedFrom: null,
      createdAt: 1, updatedAt: 1, ...options,
    })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = 'd'.repeat(64)
    const seen: Array<{ artifactKey: string; contentHash: string; byteLength: number }> = []
    const runVision: ProductionVisionRunnerV1 = async request => {
      seen.push(...request.images.map(image => ({
        artifactKey: image.artifactKey, contentHash: image.contentHash, byteLength: image.data.byteLength,
      })))
      return {
        output: JSON.stringify({
          schema: 'storyforge.text-adventure-visual-quality-model-output', version: 1,
          reviews: request.images.map((image, index) => ({
            artifactKey: image.artifactKey, contentHash: image.contentHash, verdict: 'accept',
            scores: index === request.images.length - 1
              ? {
                  requirementFit: 5, identityContinuity: 5, styleContinuity: 4,
                  composition: 4, technicalCleanfulness: 5,
                }
              : {
                  requirementFit: 5, identityContinuity: 5, styleContinuity: 4,
                  composition: 4, technicalCleanliness: 5,
                },
            issues: index === 0
              ? {
                  severity: 'warning', category: 'artifact',
                  detail: '单项问题被 Provider 折叠为对象。',
                  recommendation: '保留诊断并规范化为数组。',
                }
              : [],
          })),
        }),
        usage: { inputTokens: 200, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-vision', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const executor = createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runVision,
    })
    const professional = professionalTextAdventurePlanningOutputs(owned.brief)
    const mediaRequirements = {
      ...modelOutputs(
        owned.brief.source.worldContentHash, 'text-adventure',
        firstCharacterAnchor(owned.brief), owned.brief.intent.playerRole,
      )['media.requirements'],
      audio: [],
    }
    const visualContextArtifacts = () => [
      artifact('content.cast-bible', {
        kind: 'product-design', mediaKind: null, blobObjectId: null, mimeType: null,
        contentHash: '2'.repeat(64), payloadJson: JSON.stringify(professional['content.cast-bible']), byteSize: 1,
      }),
      artifact('media.requirements', {
        kind: 'asset-manifest', mediaKind: null, blobObjectId: null, mimeType: null,
        contentHash: '3'.repeat(64), payloadJson: JSON.stringify(mediaRequirements), byteSize: 1,
      }),
    ]
    const result = await executor({
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'f'.repeat(64), task, attempt: 1,
      idempotencyKey: '1'.repeat(64), contextText: '{"registered":true}',
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
      inputArtifacts: [
        ...visualContextArtifacts(),
        artifact('media.audit', {
          kind: 'integration-report', mediaKind: null, blobObjectId: null, mimeType: null,
          contentHash: auditHash, payloadJson: JSON.stringify(auditPayload), byteSize: 1,
        }),
        ...imageKeys.map(artifactKey => artifact(artifactKey)),
      ],
      authorResolution: null, signal: new AbortController().signal,
    })
    expect(seen).toEqual(imageKeys.map(artifactKey => ({
      artifactKey, contentHash: blob.contentHash, byteLength: blob.byteSize,
    })))
    expect(result).toMatchObject({
      usage: { modelCalls: 1, inputTokens: 200, outputTokens: 100 },
      artifacts: [{
        artifactKey: 'quality.visual-review.batch-1', kind: 'playtest-report',
        payload: {
          status: 'passed', providerReviewCompleted: true, blockingIssueCount: 0,
          mediaAuditHash: auditHash,
          reviews: expect.arrayContaining([
            expect.objectContaining({
              artifactKey: imageKeys[0],
              issues: [expect.objectContaining({ detail: '单项问题被 Provider 折叠为对象。' })],
            }),
          ]),
        },
      }],
    })
    const singletonExecutor = createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(owned.productionId))!,
      brief: owned.brief,
      runVision: async _request => ({
        output: JSON.stringify({
          schema: 'storyforge.text-adventure-visual-quality-model-output', version: 1,
          reviews: [{
            artifactKey: 'media.visual.999', contentHash: '0'.repeat(64), verdict: 'accept',
            scores: {
              requirementFit: 5, identityContinuity: 5, styleContinuity: 4,
              composition: 4, technicalCleanliness: 5,
            },
            issues: [],
          }],
        }),
        usage: { inputTokens: 200, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-vision', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }),
    })
    const singleton = await singletonExecutor({
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'f'.repeat(64), task: plannedTask, attempt: 1,
      idempotencyKey: '2'.repeat(64), contextText: '{"registered":true}',
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
      inputArtifacts: [
        ...visualContextArtifacts(),
        artifact('media.audit', {
          kind: 'integration-report', mediaKind: null, blobObjectId: null, mimeType: null,
          contentHash: auditHash, payloadJson: JSON.stringify(auditPayload), byteSize: 1,
        }),
        artifact(imageKeys[0]),
      ],
      authorResolution: null, signal: new AbortController().signal,
    })
    expect(singleton.artifacts[0].payload).toMatchObject({
      reviews: [{ artifactKey: imageKeys[0], contentHash: blob.contentHash, verdict: 'accept' }],
    })
    const sourceReview = structuredClone(result.artifacts[0].payload) as {
      buildNumber: number
      status: 'passed' | 'revision-required'
      blockingIssueCount: number
      reviews: Array<{
        artifactKey: string; contentHash: string; verdict: string; scores: unknown
        issues: Array<{ severity: string; category: string; detail: string; recommendation: string }>
      }>
    }
    sourceReview.reviews[0].verdict = 'revise'
    sourceReview.reviews[0].issues = [{
      severity: 'blocking', category: 'text', detail: '画面出现伪文字',
      recommendation: '去除全部字形',
    }]
    sourceReview.status = 'revision-required'
    sourceReview.blockingIssueCount = 1
    const sourceReviewArtifactHash = await hashProductProductionValueV2(sourceReview)
    const repairFeedback = {
      schema: 'storyforge.text-adventure-visual-repair-feedback', version: 1,
      sourceBuildNumber: 1, sourceReviewArtifactHash, sourceReview,
      targets: [{
        artifactKey: sourceReview.reviews[0].artifactKey,
        priorContentHash: sourceReview.reviews[0].contentHash,
        verdict: 'revise', scores: sourceReview.reviews[0].scores,
        issues: sourceReview.reviews[0].issues,
      }],
    }
    const repairAudit = {
      ...auditPayload,
      buildNumber: 2,
      assets: auditPayload.assets.map((asset, index) => index === 1
        ? {
            ...asset,
            sourceRequirementHash: 'f'.repeat(64),
            requirementBinding: 'revalidated-reuse',
          }
        : asset),
    }
    const repairAuditHash = await hashProductProductionValueV2(repairAudit)
    seen.length = 0
    const repairedBatch = await executor({
      scope: owned.scope, productionId: owned.productionId, buildId: 2, buildNumber: 2,
      controlEpoch: 1, planHash: '9'.repeat(64),
      task: { ...task, inputArtifactKeys: [...task.inputArtifactKeys, 'media.repair-feedback'] },
      attempt: 1, idempotencyKey: '8'.repeat(64), contextText: '{"registered":true}',
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
      inputArtifacts: [
        ...visualContextArtifacts(),
        artifact('media.audit', {
          kind: 'integration-report', mediaKind: null, blobObjectId: null, mimeType: null,
          contentHash: repairAuditHash, payloadJson: JSON.stringify(repairAudit), byteSize: 1,
        }),
        ...imageKeys.map(artifactKey => artifact(artifactKey)),
        artifact('media.repair-feedback', {
          kind: 'integration-report', mediaKind: null, blobObjectId: null, mimeType: null,
          contentHash: await hashProductProductionValueV2(repairFeedback),
          payloadJson: JSON.stringify(repairFeedback), byteSize: 1,
        }),
      ],
      authorResolution: null, signal: new AbortController().signal,
    })
    expect(seen).toEqual([{
      artifactKey: imageKeys[0], contentHash: blob.contentHash, byteLength: blob.byteSize,
    }])
    expect(repairedBatch).toMatchObject({
      usage: { modelCalls: 1 },
      artifacts: [{
        payload: { status: 'passed', reviews: expect.arrayContaining([
          expect.objectContaining({ artifactKey: imageKeys[1], verdict: 'accept' }),
        ]) },
        quality: { carriedPriorReviewCount: 1 },
      }],
    })
    const batchPayload = result.artifacts[0].payload
    const batchPayloadJson = JSON.stringify(batchPayload)
    const batchHash = await hashProductProductionValueV2(batchPayload)
    const assembled = await executor({
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: 'f'.repeat(64), task: assemblyTask, attempt: 1,
      idempotencyKey: '2'.repeat(64), contextText: '', capabilityBindings: [],
      inputArtifacts: [
        artifact('media.audit', {
          kind: 'integration-report', mediaKind: null, blobObjectId: null, mimeType: null,
          contentHash: auditHash, payloadJson: JSON.stringify(auditPayload), byteSize: 1,
        }),
        artifact('quality.visual-review.batch-1', {
          kind: 'playtest-report', mediaKind: null, blobObjectId: null, mimeType: null,
          contentHash: batchHash, payloadJson: batchPayloadJson, byteSize: batchPayloadJson.length,
        }),
      ],
      authorResolution: null, signal: new AbortController().signal,
    })
    expect(assembled).toMatchObject({
      usage: { modelCalls: 0 },
      artifacts: [{
        artifactKey: 'quality.visual-review', kind: 'playtest-report',
        payload: {
          status: 'passed', providerReviewCompleted: true, blockingIssueCount: 0,
          mediaAuditHash: auditHash,
        },
      }],
    })
  })
})

describe('R-PRODUCTPROD-1F · configured formal production executor', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('文字冒险美术合同覆盖冲突角色描述、绑定场景人物并移除可读物品文字', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'key-scenes', qualityProfile: 'commercial-candidate',
    })
    const anchors = [{
      characterKey: 'character.player', sourceResourceKey: null, name: '岚舟', role: 'player' as const,
      publicIdentity: '见习守灯人与机械修复师',
      visualAnchor: '黑短发带盐雾浅灰发梢，深蓝修复工外套与铜扣护腕，左眉细疤',
    }, {
      characterKey: 'character.npc.1', sourceResourceKey: null, name: '涅洛', role: 'major-npc' as const,
      publicIdentity: '失去右臂的退役领航员',
      visualAnchor: '深褐皮肤，失去右臂，腰间系刻空名字的银铃',
    }, {
      characterKey: 'character.npc.2', sourceResourceKey: null, name: '阿塔', role: 'major-npc' as const,
      publicIdentity: '冰窟渔村村长与北境领航者',
      visualAnchor: '银发粗辫，左眼磨砂冰晶镜片，多层鲸皮外套与折叠冰镐',
    }]
    const blueprints = textAdventureVisualBlueprintsV1(owned.brief.media.imageCount)
    const requirements = {
      schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: blueprints.map((blueprint, index) => ({
        artifactKey: `media.visual.${String(index + 1).padStart(3, '0')}`,
        mediaKind: blueprint.mediaKind, sceneTag: blueprint.sceneTag, beatKey: blueprint.beatKey,
        prompt: blueprint.prompt, altText: blueprint.altText,
        width: blueprint.width, height: blueprint.height,
        palette: ['#112233', '#445566', '#ddeeff'],
        characterAnchorRefs: blueprint.characterOrdinal == null
          ? [] : [anchors[blueprint.characterOrdinal].characterKey],
        hardConstraints: [],
      })),
      audio: [],
    }
    requirements.visual[1].prompt = '岚舟，浅棕短发，右脸有疤，穿灰白制服。'
    requirements.visual[3].prompt = '岚舟发现潮钟内部刻有历代守灯人姓名与死亡日期，导师沉砾正是上一任牺牲者。泛黄的纸质日志上用暗红色墨水写着「潮钟的真正代价」等字样；画面中心是岚舟的手触碰发光的全息铭牌。'
    requirements.visual[3].characterAnchorRefs = ['character.player', 'character.npc.1']
    requirements.visual[6].prompt = '沉砾，灰白短发与胡须，双手持黄铜手杖。'
    requirements.visual[6].altText = '沉砾——失踪导师视觉锚点图'
    requirements.visual[8].prompt = '屿娘，短黑发，双手布满冻疮，腰挂鱼刀。'
    requirements.visual[7].prompt = "岚舟在废弃实验室发现全息记录，显示'记忆抽取协议'的字样。"
    requirements.visual[9].prompt = '最后抉择时，前景是岚舟的背影，岚舟的身影被冷光勾勒成剪影，面前悬浮着三个选择的光影：公开真相、延续旧制度、替代方案。'
    requirements.visual[9].characterAnchorRefs = ['character.player']
    requirements.visual[10].prompt = '银色潮汐钥匙，柄部刻有微小符文，边缘带有长期使用的磨损。'
    requirements.visual[2].prompt = '无文字区域地图，标注雾湾环礁和霜潮列岛，以航线连接。'
    requirements.visual[5].prompt = '黄铜罗盘，表盘刻有潮位刻度，指针停在「临界」位置，背面刻有「守灯人传承」字样。'
    requirements.visual[11].prompt = '岚舟站在潮钟塔顶，身边站着海岬与其他幸存者，远处海面恢复平静。'
    requirements.visual[11].characterAnchorRefs = ['character.player', 'character.npc.2']

    const parsed = parseProductMediaRequirementsArtifactV2(requirements, owned.brief, anchors)
    expect(parsed.visual[1].prompt).toContain('岚舟')
    expect(parsed.visual[1].prompt).toContain('黑短发带盐雾浅灰发梢')
    expect(parsed.visual[1].prompt).toContain('左眉细疤')
    expect(parsed.visual[1].prompt).not.toContain('右脸有疤')
    expect(parsed.visual[6].prompt).toContain('涅洛')
    expect(parsed.visual[6].prompt).not.toContain('沉砾')
    expect(parsed.visual[6].prompt).toContain('冻结外观中实际存在的肢体')
    expect(parsed.visual[6].prompt).toContain('严禁补画缺失肢体')
    expect(parsed.visual[6].prompt).not.toContain('双手')
    expect(parsed.visual[6].altText).toBe('涅洛的三分之二身透明背景视觉锚点图')
    expect(parsed.visual[8].prompt).toContain('阿塔')
    expect(parsed.visual[8].prompt).not.toContain('屿娘')
    expect(parsed.visual[3].characterAnchorRefs).toEqual(['character.player'])
    expect(parsed.visual[3].hardConstraints).toContain('视觉锚点：黑短发带盐雾浅灰发梢，深蓝修复工外套与铜扣护腕，左眉细疤')
    expect(parsed.visual[3].prompt).not.toContain('姓名')
    expect(parsed.visual[3].prompt).not.toContain('死亡日期')
    expect(parsed.visual[3].prompt).not.toContain('铭牌')
    expect(parsed.visual[3].prompt).not.toContain('潮钟的真正代价')
    expect(parsed.visual[3].prompt).not.toContain('写着')
    expect(parsed.visual[3].prompt).toContain('无字的颜色与凿痕记号')
    expect(parsed.visual[7].prompt).not.toContain('记忆抽取协议')
    expect(parsed.visual[7].prompt).not.toContain('全息记录')
    expect(parsed.visual[9].prompt).not.toContain('背影')
    expect(parsed.visual[9].prompt).not.toContain('剪影')
    expect(parsed.visual[9].prompt).toContain('三分之二侧面')
    expect(parsed.visual[9].prompt).not.toContain('三个选择')
    expect(parsed.visual[9].prompt).toContain('实际行动接通')
    expect(parsed.visual[10].prompt).not.toContain('符文')
    expect(parsed.visual[10].prompt).toContain('不得出现任何可读文字')
    expect(parsed.visual[2].prompt).toContain('STRICT MINIMAL FLAT-VECTOR UI TOPOLOGY DIAGRAM')
    expect(parsed.visual[2].prompt).not.toContain('雾湾环礁')
    expect(parsed.visual[2].prompt).not.toContain('霜潮列岛')
    expect(parsed.visual[2].prompt).toContain('These three cloche pictograms are the complete symbol set')
    expect(parsed.visual[5].prompt).toContain('不得出现任何可读文字')
    expect(parsed.visual[6].prompt).toContain('画面不得出现任何可读文字')
    expect(parsed.visual[5].prompt).not.toContain('守灯人传承')
    expect(parsed.visual[11].prompt).not.toContain('海岬')
    expect(parsed.visual[11].characterAnchorRefs).toEqual(['character.player'])
    expect(parsed.visual[5].prompt).not.toContain('「临界」')
    const routeAndArrival = structuredClone(requirements)
    routeAndArrival.visual[3].prompt = '岚舟抵达断裂的潮钟核心，沉砾保存的记忆在雾潮中回响。'
    routeAndArrival.visual[3].characterAnchorRefs = ['character.player', 'character.npc.1']
    routeAndArrival.visual[4].prompt = '霜潮列岛由 icy灰白岩石与薄冰构成。'
    routeAndArrival.visual[9].prompt = '岚舟站在最终潮钟前，面前是三条路——注入记忆、释放记忆或带领村民撤离。'
    routeAndArrival.visual[9].characterAnchorRefs = ['character.player']
    const governedVariant = parseProductMediaRequirementsArtifactV2(routeAndArrival, owned.brief, anchors)
    expect(governedVariant.visual[3].characterAnchorRefs).toEqual(['character.player'])
    expect(governedVariant.visual[4].prompt).toContain('冰冷灰白')
    expect(governedVariant.visual[9].prompt).not.toContain('三条路')
    expect(governedVariant.visual[9].prompt).toContain('实际行动启动')
    const modelHallucination = structuredClone(requirements)
    modelHallucination.visual[3].beatKey = 'invented-act-one-slug'
    modelHallucination.visual[3].prompt = '岚舟发现导师沉砾已经变成一具机械遗骸。'
    const frozenNarrative = {
      schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main',
      moduleTitle: '潮钟群岛', entryNodeKey: 'node.001',
      nodes: [
        { key: 'node.001', kind: 'entry', title: '第一幕', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: ['node.002'] },
        { key: 'node.002', kind: 'scene', title: '第二幕', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: ['node.003'] },
        { key: 'node.003', kind: 'ending', title: '结局', summary: '', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [
        { beatKey: 'beat.act-1.001', nodeKey: 'node.001', kind: 'narration', speakerKey: null, text: '晨雾覆盖灯塔，岚舟收起沉砾留下的调音钥匙。', order: 0 },
        { beatKey: 'beat.act-1.002', nodeKey: 'node.001', kind: 'narration', speakerKey: null, text: '岚舟迅速将手探入断裂的潮钟核心，冷蓝光照亮墙上的记录；其中一份证词讲述沉砾当年保存的记忆。', order: 1 },
        { beatKey: 'beat.act-1.003', nodeKey: 'node.001', kind: 'action', speakerKey: null, text: '岚舟独自穿过环礁栈桥，向下一座钟楼前进。', order: 2 },
        { beatKey: 'beat.act-2.001', nodeKey: 'node.002', kind: 'action', speakerKey: null, text: '岚舟打开机械记忆匣，冷蓝光照亮霜潮工坊。', order: 0 },
        { beatKey: 'beat.act-2.002', nodeKey: 'node.002', kind: 'narration', speakerKey: null, text: '岚舟睁开眼。', order: 1 },
        { beatKey: 'beat.act-2.003', nodeKey: 'node.002', kind: 'action', speakerKey: null, text: '冰封潮钟的外壳骤然开裂，机械回路在霜潮工坊深处投下层叠冷光。', order: 2 },
        { beatKey: 'beat.act-3.001', nodeKey: 'node.003', kind: 'narration', speakerKey: null, text: '岚舟面对三个按钮，每个按钮都写着代价：第一个按钮公开真相，第二个按钮延续旧制，第三个按钮选择撤离。', order: 0 },
        { beatKey: 'beat.act-3.002', nodeKey: 'node.003', kind: 'action', speakerKey: null, text: '岚舟把调音钥匙插入主控接口，转动钟钮并按下启动机构，潮钟轰然苏醒。', order: 1 },
        { beatKey: 'beat.act-3.003', nodeKey: 'node.003', kind: 'narration', speakerKey: null, text: '岚舟收回手，潮钟继续运转，雾潮开始退去。', order: 2 },
        { beatKey: 'beat.act-3.004', nodeKey: 'node.003', kind: 'narration', speakerKey: null, text: '岚舟感受到了变化。', order: 3 },
      ],
      choices: [],
    }
    const sourceGrounded = parseProductMediaRequirementsArtifactV2(
      modelHallucination, owned.brief, anchors, frozenNarrative as never,
    )
    expect(sourceGrounded.visual[3].beatKey).toBe('beat.act-1.002')
    expect(sourceGrounded.visual[3].prompt).toContain('岚舟迅速将手探入断裂的潮钟核心')
    expect(sourceGrounded.visual[3].prompt).not.toContain('机械遗骸')
    expect(sourceGrounded.visual[3].characterAnchorRefs).toEqual(['character.player'])
    expect(sourceGrounded.visual[3].characterAnchorRefs).not.toContain('character.npc.1')
    expect(sourceGrounded.visual[2].characterAnchorRefs).toEqual([])
    expect(sourceGrounded.visual[5].prompt).toContain('机械记忆匣')
    expect(sourceGrounded.visual[5].prompt).not.toContain('调音钥匙')
    expect(sourceGrounded.visual[5].characterAnchorRefs).toEqual([])
    expect(sourceGrounded.visual[5].prompt).toContain('不出现人物、手部或额外场景事件')
    expect(sourceGrounded.visual[7].prompt).toContain('冰封潮钟的外壳骤然开裂')
    expect(sourceGrounded.visual[7].prompt).not.toContain('岚舟睁开眼')
    expect(sourceGrounded.visual[10].prompt).toContain('调音钥匙')
    expect(sourceGrounded.visual[10].prompt).not.toContain('机械记忆匣')
    expect(sourceGrounded.visual[10].characterAnchorRefs).toEqual([])
    expect(sourceGrounded.visual[5].prompt).not.toBe(sourceGrounded.visual[10].prompt)
    expect(sourceGrounded.visual[9].prompt).toContain('按下启动机构')
    expect(sourceGrounded.visual[9].prompt).not.toContain('三个按钮')
    expect(sourceGrounded.visual[11].prompt).toContain('潮钟继续运转')
    expect(sourceGrounded.visual[11].prompt).not.toContain('感受到了变化')
    const duplicateBeat = structuredClone(modelHallucination)
    duplicateBeat.visual[7].prompt = modelHallucination.visual[3].prompt
    duplicateBeat.visual[7].characterAnchorRefs = ['character.player', 'character.npc.1']
    const deduplicated = parseProductMediaRequirementsArtifactV2(
      duplicateBeat, owned.brief, anchors, frozenNarrative as never,
    )
    expect(deduplicated.visual[3].beatKey).toBe('beat.act-1.002')
    expect(deduplicated.visual[7].beatKey).toBe('beat.act-2.003')
    expect(deduplicated.visual[7].prompt).toContain('冰封潮钟的外壳骤然开裂')
    expect(deduplicated.visual[7].prompt).not.toContain('沉砾当年保存的记忆')
    expect(deduplicated.visual[7].characterAnchorRefs).toEqual([])
    expect(productMediaCharacterPresentationConstraintV1('character-pose')).toContain('透明背景')
    expect(productMediaCharacterPresentationConstraintV1('cg')).toContain('禁止透明背景')
  })

  it('复用非密钥 binding，并行生成内容、视觉、音频，预览后完成三轮连续演化', async () => {
    const owned = await fixture()
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const imageRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
    const audioRequirements = owned.brief.capabilityRequirements.filter(item => item.mediaClass === 'music' || item.mediaClass === 'sfx')
    const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const forgedAnchors = structuredClone(outputs['media.requirements'])
    forgedAnchors.visual[1].characterAnchorRefs = ['character:999999']
    expect(() => parseProductMediaRequirementsArtifactV2(forgedAnchors, owned.brief))
      .toThrow(/角色锚点未绑定 Brief 冻结角色/)
    const anchoredScene = structuredClone(outputs['media.requirements'])
    anchoredScene.visual[0].characterAnchorRefs = [firstCharacterAnchor(owned.brief)]
    anchoredScene.visual[0].hardConstraints = [
      '不得写回世界正式表',
      '保持角色身份、年龄段与核心视觉特征',
      `角色定位：${owned.brief.intent.playerRole}`,
    ].sort()
    expect(parseProductMediaRequirementsArtifactV2(anchoredScene, owned.brief).visual[0].characterAnchorRefs)
      .toEqual(anchoredScene.visual[0].characterAnchorRefs)
    const weakenedConstraints = structuredClone(outputs['media.requirements'])
    weakenedConstraints.visual[1].hardConstraints = ['模型建议缩小约束']
    expect(parseProductMediaRequirementsArtifactV2(weakenedConstraints, owned.brief).visual[1].hardConstraints)
      .toEqual([
        '不得写回世界正式表',
        '保持角色身份、年龄段与核心视觉特征',
        `角色定位：${owned.brief.intent.playerRole}`,
      ].sort())
    const backgroundSuggestion = structuredClone(outputs['media.requirements'])
    backgroundSuggestion.visual[0].hardConstraints = ['背景不得出现人物']
    expect(parseProductMediaRequirementsArtifactV2(backgroundSuggestion, owned.brief).visual[0].hardConstraints)
      .toEqual([])
    const forgedSceneAnchor = structuredClone(anchoredScene)
    forgedSceneAnchor.visual[0].characterAnchorRefs = ['character:999999']
    expect(() => parseProductMediaRequirementsArtifactV2(forgedSceneAnchor, owned.brief))
      .toThrow(/角色锚点未绑定 Brief 冻结角色/)
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      calls.push(taskKey)
      const output = taskKey === 'content.narrative'
        ? {
            ...outputs[taskKey],
            choices: outputs[taskKey].choices.map((choice, index) => (
              index === 1 ? { ...choice, targetNodeKey: '公开真相结局' } : choice
            )),
          }
        : outputs[taskKey]
      return {
        output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'a'.repeat(64),
        },
      }
    }
    const production = (await db.productProductions.get(owned.productionId))!
    const executor = createConfiguredProductProductionExecutorV1({ production, brief: owned.brief, runText })
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash },
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: imageRequirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }),
      ...await Promise.all(audioRequirements.map(requirement => createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))),
    ]
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor,
      capabilityBindings,
    })
    expect(projection.terminal).toBe(true)
    expect(calls.sort()).toEqual([
      'content.design', 'content.narrative', 'content.product-module', 'media.requirements',
    ].sort())
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.status).toBe('release-ready')
    expect(JSON.parse(build.compatibilityJson)).toMatchObject({
      schema: 'storyforge.product-build-compatibility', level: 'compatible', migrationPolicy: 'initial-session',
    })
    const packageArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtimePackage = parseProductRuntimePackageV1(packageArtifact!.payloadJson)
    expect(runtimePackage.presentation?.assets).toHaveLength(6)
    expect(runtimePackage.presentation?.cues).toHaveLength(6)
    expect(runtimePackage.presentation?.assets.filter(asset => asset.mimeType === 'audio/wav')).toHaveLength(4)
    expect(await db.mediaBlobObjects.count()).toBe(6)
    const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
    expect(prepared).toMatchObject({ productType: 'avg', mediaAssetKeys: expect.arrayContaining([
      'formal.production.build-1.media.visual.001', 'formal.production.build-1.media.visual.002',
    ]) })
    const opened = await startProductProductionPreviewV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    expect(opened.productType).toBe('avg')
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({
      productBuildId: build.id, productReleaseId: null, kind: 'avg', runtimeSourceHash: build.packageHash,
    })
    const playable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash },
    })
    const imageAsset = runtimePackage.presentation!.assets.find(asset => asset.mimeType === 'image/svg+xml')!
    const media = await playable.mediaResolver.read(imageAsset.assetKey)
    expect(media.type).toBe('image/svg+xml')
    expect(media.size).toBeGreaterThan(100)
    playable.mediaResolver.dispose()
    const published = await publishProductProductionV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    const releasedPlayable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'release', productReleaseId: published.receipt.productReleaseId },
    })
    expect(releasedPlayable.packageHash).toBe(build.packageHash)
    expect(releasedPlayable.runtimePackage).toEqual(runtimePackage)
    const releasedMedia = await releasedPlayable.mediaResolver.read(imageAsset.assetKey)
    expect(releasedMedia.size).toBe(media.size)
    releasedPlayable.mediaResolver.dispose()
    const evolution = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '承接守住庇护的结局，让原来的配角调查第二座信号塔。',
    })
    const nextBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, evolution.briefRevision]).first()
    expect(nextBriefRow).toMatchObject({ parentRevision: 1, status: 'draft' })
    expect(JSON.parse(nextBriefRow!.briefJson)).toMatchObject({
      // An evolution goal is governed lineage, not a replacement for the
      // public story opening. The semantic Brief remains anchored to the last
      // non-evolution revision while the requested change lives in evolution.
      intent: { openingSituation: owned.brief.intent.openingSituation },
      unresolvedDecisionKeys: [],
      evolution: {
        userGoal: '承接守住庇护的结局，让原来的配角调查第二座信号塔。',
        affectedLanes: ['content', 'product', 'visual', 'audio'],
      },
    })
    expect(await db.productProductions.get(owned.productionId)).toMatchObject({
      status: 'brief-ready', currentBriefRevision: evolution.briefRevision, currentBuildNumber: 1,
    })
    const currentProduction = (await db.productProductions.get(owned.productionId))!
    const authorized = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.evolution.authorize',
        expectedStateRevision: currentProduction.stateRevision,
        briefRevision: evolution.briefRevision, briefHash: nextBriefRow!.briefHash,
        authorizationNonce: 'formal.evolution.click',
      },
    })
    expect(authorized).toMatchObject({ ok: true, result: { buildNumber: 2 } })
    const nextBrief = parseProductProductionBriefV3(nextBriefRow!.briefJson)
    const evolvedProjection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: nextBrief, runText,
      }),
      capabilityBindings,
    })
    expect(evolvedProjection.terminal).toBe(true)
    expect(await db.productBuilds.get(evolvedProjection.buildId)).toMatchObject({
      buildNumber: 2, parentBuildNumber: 1, sourceProductReleaseId: published.receipt.productReleaseId,
      status: 'release-ready',
    })
    expect(JSON.parse((await db.productBuilds.get(evolvedProjection.buildId))!.compatibilityJson)).toMatchObject({
      schema: 'storyforge.product-build-compatibility', fromBuildNumber: 1, toBuildNumber: 2,
      level: 'compatible', migrationPolicy: 'identity',
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({
      status: 'released', previewHash: build.previewHash, releasedProductReleaseId: published.receipt.productReleaseId,
    })
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({ productBuildId: build.id })

    let previousBuildNumber = 2
    for (const [index, goal] of [
      '继续第二座信号塔的调查，让第一轮选择改变可用路线与同伴态度。',
      '把已经揭示的真相推进到港口议会，保留前三版全部后果并增加最终抉择。',
    ].entries()) {
      const nextEvolution = await beginProductProductionEvolutionV1({
        scope: owned.scope, productionId: owned.productionId, userText: goal,
      })
      const row = await db.productProductionBriefs
        .where('[productionId+revision]').equals([owned.productionId, nextEvolution.briefRevision]).first()
      const productionBeforeStart = (await db.productProductions.get(owned.productionId))!
      await executeProductProductionCommand({
        scope: owned.scope, productionId: owned.productionId,
        command: {
          type: 'authorize-start', commandId: `formal.evolution.${index + 2}.authorize`,
          expectedStateRevision: productionBeforeStart.stateRevision,
          briefRevision: nextEvolution.briefRevision, briefHash: row!.briefHash,
          authorizationNonce: `formal.evolution.${index + 2}.click`,
        },
      })
      const parsedBrief = parseProductProductionBriefV3(row!.briefJson)
      const nextProjection = await runProductProductionUntilBlockedV1({
        scope: owned.scope, productionId: owned.productionId,
        executor: createConfiguredProductProductionExecutorV1({
          production: (await db.productProductions.get(owned.productionId))!, brief: parsedBrief, runText,
        }),
        capabilityBindings,
      })
      expect(nextProjection.terminal).toBe(true)
      const nextBuild = (await db.productBuilds.get(nextProjection.buildId))!
      expect(nextBuild).toMatchObject({
        buildNumber: previousBuildNumber + 1, parentBuildNumber: previousBuildNumber,
        sourceProductReleaseId: published.receipt.productReleaseId, status: 'release-ready',
      })
      previousBuildNumber = nextBuild.buildNumber
    }
    expect(previousBuildNumber).toBe(4)
    expect(await db.productBuilds.where('productionId').equals(owned.productionId).count()).toBe(4)
    expect(await db.productReleases.get(published.receipt.productReleaseId)).toMatchObject({
      contentHash: published.receipt.releaseContentHash,
    })
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({
      productBuildId: build.id, runtimeSourceHash: build.packageHash,
    })
  }, 30_000)

  it('商业候选通过可信中继生成可验证 PNG/MP3，且执行请求与冻结证据不含 API Key', async () => {
    const owned = await fixture('commercial-candidate')
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const textBindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: textBindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
        },
      }
    }
    const relayCalls: RedactedMediaTransportRequestV1[] = []
    const mediaCapabilities = await relayCapabilities(owned.brief, relayCalls)
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash: textBindingHash },
      ...[...mediaCapabilities.values()].map(item => item.binding),
    ]
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: owned.brief, runText, mediaCapabilities,
      }),
      capabilityBindings,
    })
    expect(projection.terminal).toBe(true)
    expect(relayCalls).toHaveLength(6)
    expect(JSON.stringify(relayCalls)).not.toMatch(/api[-_]?key|authorization|bearer\s|sk-/i)
    const characterImageCall = relayCalls.find(call => call.adapterId === 'openai.gpt-image-2.v1'
      && String(call.body.prompt).includes('冻结角色锚点'))
    expect(characterImageCall?.body.prompt).toContain('保持角色身份、年龄段与核心视觉特征')
    const backgroundImageCall = relayCalls.find(call => call.adapterId === 'openai.gpt-image-2.v1'
      && !String(call.body.prompt).includes('冻结角色锚点'))
    expect(backgroundImageCall?.body.prompt).toContain('不得出现任何人物、肖像、人形、倒影、剪影或照片')
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.status).toBe('preview-ready')
    const media = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    const providerMedia = media.filter(item => item.blobObjectId != null)
    expect(providerMedia.filter(item => item.mimeType === 'image/png')).toHaveLength(2)
    expect(providerMedia.filter(item => item.mimeType === 'audio/mpeg')).toHaveLength(4)
    for (const artifact of providerMedia) {
      expect(JSON.parse(artifact.qualityJson)).toMatchObject({
        mimeVerified: true, contentHashVerified: true,
        providerReceiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(JSON.parse(artifact.rightsJson)).toMatchObject({
        origin: 'generated', commercialUse: true,
        license: expect.stringMatching(/^rights-policy:/),
      })
      expect(artifact.qualityJson).not.toContain('outputImages')
      expect(artifact.qualityJson).not.toContain('outputAudio')
    }
    const characterArtifact = providerMedia.find(item => item.mediaKind === 'character-pose')!
    expect(JSON.parse(characterArtifact.qualityJson)).toMatchObject({
      anchorRulesHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      characterAnchorRefs: [firstCharacterAnchor(owned.brief)],
      hardConstraintsApplied: expect.arrayContaining([
        '不得写回世界正式表', '保持角色身份、年龄段与核心视觉特征',
        `角色定位：${owned.brief.intent.playerRole}`,
      ]),
    })
    // The shared blob store deduplicates the four identical fixture audio bytes.
    expect(await db.mediaBlobObjects.count()).toBe(3)
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/商业候选缺少真实浏览器性能回执/)
    await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: build.id!,
      measurement: {
        browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
        viewport: { width: 1440, height: 900 }, packageHash: build.packageHash, previewHash: build.previewHash,
        firstInteractiveBytes: 2 * 1024 * 1024,
        cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 40 + index),
        choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 20 + index),
        memorySamples: [
          { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
          { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 108 * 1024 * 1024 },
        ],
        measuredAt: Date.now(),
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'preview-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/真实主路线试玩回执/)
    const sessionId = await completeAvgBuildPreviewMainRoute({
      scope: owned.scope, productionId: owned.productionId,
    })
    await recordProductBuildMainRoutePlaythroughV1({
      scope: owned.scope, productBuildId: build.id!, productRuntimeSessionId: sessionId,
      authorConfirmation: 'author-confirmed-main-route',
      environment: {
        browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
        viewport: { width: 1440, height: 900 },
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'preview-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/媒资解码回执/)
    const runtimeArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtime = parseProductRuntimePackageV1(runtimeArtifact!.payloadJson)
    await recordProductMediaRuntimeMeasurementV1({
      scope: owned.scope, productBuildId: build.id!,
      measurement: {
        assets: [...runtime.presentation!.assets]
          .sort((left, right) => left.assetKey.localeCompare(right.assetKey))
          .map(asset => asset.mimeType.startsWith('image/') ? {
            assetKey: asset.assetKey, contentHash: asset.blobContentHash, mimeType: asset.mimeType,
            mediaClass: 'image' as const, status: 'decoded' as const,
            decodedWidth: asset.width!, decodedHeight: asset.height!, decodedDurationMs: null,
            decodedHasAlpha: asset.kind === 'character-pose' || asset.kind === 'character-expression',
            decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null,
            truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [], failureCode: null,
          } : {
            assetKey: asset.assetKey, contentHash: asset.blobContentHash, mimeType: asset.mimeType,
            mediaClass: 'audio' as const, status: 'decoded' as const,
            decodedWidth: null, decodedHeight: null, decodedDurationMs: asset.durationMs!,
            decodedHasAlpha: null, decodedChannelCount: 2, decodedSampleRateHz: 44_100,
            integratedLufs: -18, truePeakDbtp: -2, loopSeamDbfs: -40,
            policyFailures: [], failureCode: null,
          }),
        environment: {
          browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
          viewport: { width: 1440, height: 900 },
        },
        measuredAt: Date.now(),
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'release-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).resolves.toMatchObject({ productType: 'avg' })
  }, 30_000)

  it('作者声明只改玩法模块时跨 Build 复用未受影响闭包，并重新执行装配与 QA', async () => {
    const owned = await fixture()
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const imageRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
    const audioRequirements = owned.brief.capabilityRequirements.filter(item => item.mediaClass === 'music' || item.mediaClass === 'sfx')
    const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      calls.push(taskKey)
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'c'.repeat(64),
        },
      }
    }
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash },
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: imageRequirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }),
      ...await Promise.all(audioRequirements.map(requirement => createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))),
    ]
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }), capabilityBindings,
    })
    expect(first.terminal).toBe(true)
    expect(await db.mediaBlobObjects.count()).toBe(6)
    calls.length = 0

    const evolved = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '保持剧情和素材不变，只把交互节奏改成更快速的玩法模块。',
      affectedLanes: ['product'],
    })
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, evolved.briefRevision]).first()
    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.product-only.authorize',
        expectedStateRevision: production.stateRevision, briefRevision: evolved.briefRevision,
        briefHash: briefRow!.briefHash, authorizationNonce: 'formal.product-only.click',
      },
    })
    const nextBrief = parseProductProductionBriefV3(briefRow!.briefJson)
    expect(nextBrief.evolution).toMatchObject({ affectedLanes: ['product'] })
    expect(nextBrief.intent.openingSituation).toBe(owned.brief.intent.openingSituation)
    const second = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: nextBrief, runText,
      }), capabilityBindings,
    })
    expect(second.terminal).toBe(true)
    expect(calls).toEqual(['content.product-module'])
    const secondBuild = (await db.productBuilds.get(second.buildId))!
    const plan = JSON.parse(secondBuild.planJson) as { tasks: Array<{ taskKey: string; reuse: unknown }> }
    expect(plan.tasks.filter(task => task.reuse != null).map(task => task.taskKey).sort()).toEqual([
      'content.design', 'content.narrative', 'media.audio', 'media.requirements', 'media.visual',
    ])
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(second.buildId).toArray()
    expect(artifacts.filter(item => item.status === 'carried-forward')).toHaveLength(9)
    expect(artifacts.filter(item => item.status === 'accepted').map(item => item.artifactKey).sort()).toEqual([
      'content.product-module', 'quality.report', 'runtime.package',
    ])
    expect(await db.mediaBlobObjects.count()).toBe(6)

    calls.length = 0
    const reassembly = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '保留全部内容与媒资，只用当前编译器重新装配并复验运行包。',
      affectedLanes: ['runtime'],
    })
    const reassemblyBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, reassembly.briefRevision]).first()
    const reassemblyProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.runtime-only.authorize',
        expectedStateRevision: reassemblyProduction.stateRevision,
        briefRevision: reassembly.briefRevision, briefHash: reassemblyBriefRow!.briefHash,
        authorizationNonce: 'formal.runtime-only.click',
      },
    })
    const reassembled = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: parseProductProductionBriefV3(reassemblyBriefRow!.briefJson), runText,
      }), capabilityBindings,
    })
    expect(reassembled).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(calls).toEqual([])
    const reassembledArtifacts = await db.productBuildArtifacts.where('buildId').equals(reassembled.buildId).toArray()
    expect(reassembledArtifacts.filter(item => item.status === 'accepted').map(item => item.artifactKey).sort()).toEqual([
      'quality.report', 'runtime.package',
    ])
  }, 30_000)

  it('作者修订走相同校验和持久回执，不伪造模型调用，并拒绝错任务或无效内容', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'none', omitWorldArtifacts: true,
    })
    const requirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = 'a'.repeat(64)
    const capabilityBindings = [{ requirementKey: requirement.requirementKey, adapterId: 'configured-text.v1', bindingHash }]
    // This scenario targets the author-edit boundary, so every unrelated
    // specialist must return a contract-valid professional artifact. The old
    // four-task fixture predates the text-adventure team DAG and caused an
    // unrelated source-sufficiency retry before the intended module blocker.
    const outputs = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`))!
      calls.push(taskKey)
      return { output: JSON.stringify(taskKey === 'content.product-module' ? {} : taskKey === 'media.requirements' ? { ...outputs[taskKey], visual: [], audio: [] } : outputs[taskKey]),
        usage: { inputTokens: 100, outputTokens: 100 }, bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey: requirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config',
          credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
        } }
    }
    const execute = async () => runProductProductionUntilBlockedV1({ scope: owned.scope, productionId: owned.productionId, capabilityBindings,
      executor: createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText }) })
    const first = await execute()
    expect(first.buildStatus).toBe('recovery-required')
    const repair = async (draft: unknown, taskKey = 'content.product-module') => executeProductProductionCommand({ scope: owned.scope, productionId: owned.productionId,
      command: { type: 'resolve-blocker', commandId: `repair.${crypto.randomUUID()}`, expectedStateRevision: (await db.productProductions.get(owned.productionId))!.stateRevision,
        blockerKey: taskKey, resolution: { action: 'author-edit', note: '作者校订草稿', authorDraftJson: JSON.stringify(draft) } } })
    expect((await repair(outputs['content.product-module'], 'content.design')).ok).toBe(false)
    expect((await repair({})).ok).toBe(true)
    expect((await execute()).buildStatus).toBe('recovery-required')
    // The professional DAG performs its two visible, bounded model attempts
    // before pausing. Author-edit recovery itself must add no model call.
    expect(calls.filter(key => key === 'content.product-module')).toHaveLength(2)
    expect((await repair(outputs['content.product-module'])).ok).toBe(true)
    const completed = await execute()
    expect(completed.buildStatus).toBe('release-ready')
    expect(calls.filter(key => key === 'content.product-module')).toHaveLength(2)
    const artifact = await db.productBuildArtifacts.where('buildId').equals(completed.buildId)
      .filter(row => row.artifactKey === 'content.product-module' && row.controlEpoch === completed.controlEpoch).first()
    expect(JSON.parse(artifact!.rightsJson).origin).toBe('author-revised-model-draft')
    const events = await db.agentRunEvents.where('runId').equals(artifact!.producerRunId!).toArray()
    expect(events.some(row => row.type === 'model.requested')).toBe(false)
    expect(events.some(row => row.type === 'evidence.artifact.recorded' && JSON.parse(row.payloadJson).artifactKind === 'source-snapshot')).toBe(true)
  }, 30000)

  it('AI 小镇按地点、居民和环境音的冻结语义生产媒资并进入同一发布包', async () => {
    const owned = await fixtureAiTownWithMedia()
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const imageRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
    const audioRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'sfx')!
    const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config', productType: 'ai-town' })
    const outputs = modelOutputs(owned.brief.source.worldContentHash, 'ai-town')
    const mediaRequirements = aiTownMediaRequirements(owned.brief)
    const forged = structuredClone(mediaRequirements)
    forged.visual[0].sceneTag = 'town-location-999'
    expect(() => parseProductMediaRequirementsArtifactV2(forged, owned.brief))
      .toThrow(/视觉语义与冻结计划不一致/)
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown AI town model task')
      return {
        output: JSON.stringify(taskKey === 'media.requirements' ? mediaRequirements : outputs[taskKey]),
        usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash },
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: imageRequirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }),
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: audioRequirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }),
    ]
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(
      projection,
      `AI town media production projection:\n${JSON.stringify(projection, null, 2)}\nfailure=${build.failureJson}`,
    ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    const packageArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtimePackage = parseProductRuntimePackageV1(packageArtifact!.payloadJson)
    expect(runtimePackage.definition.enabledCapabilities).toEqual(['narrative', 'interaction', 'town', 'presentation'])
    expect(runtimePackage.presentation?.assets).toHaveLength(13)
    expect(runtimePackage.presentation?.assets.filter(item => item.kind === 'background')).toHaveLength(4)
    expect(runtimePackage.presentation?.assets.filter(item => item.kind === 'character-pose')).toHaveLength(4)
    expect(runtimePackage.presentation?.assets.filter(item => item.kind === 'character-expression')).toHaveLength(4)
    expect(runtimePackage.presentation?.assets.filter(item => item.kind === 'ambience')).toHaveLength(1)
    const firstMediaArtifact = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .find(item => item.blobObjectId != null)!
    const originalRightsJson = firstMediaArtifact.rightsJson
    await db.productBuildArtifacts.update(firstMediaArtifact.id!, {
      rightsJson: JSON.stringify({
        ...JSON.parse(firstMediaArtifact.rightsJson),
        commercialUse: false,
        requiresProviderTermsReview: false,
        license: 'rights-policy:StoryForge-community-prototype-rights-pending-v1',
      }),
    })
    await expect(exportCommunityPrototypeDistributionBundleV2({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/root terminal receipt 校验失败/)
    await db.productBuildArtifacts.update(firstMediaArtifact.id!, {
      rightsJson: JSON.stringify({
        ...JSON.parse(firstMediaArtifact.rightsJson),
        commercialUse: false,
        requiresProviderTermsReview: true,
        license: 'rights-policy:StoryForge-community-prototype-rights-pending-v1',
      }),
    })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/root terminal receipt 校验失败/)
    // v2 terminal receipt freezes the complete Artifact row, including rights.
    // Community packaging therefore cannot reinterpret rights by mutating a
    // completed Build; restore the signed row before exercising export.
    await db.productBuildArtifacts.update(firstMediaArtifact.id!, { rightsJson: originalRightsJson })
    const prototypeBundle = await exportCommunityPrototypeDistributionBundleV2({
      scope: owned.scope, productionId: owned.productionId,
    })
    expect(prototypeBundle).toMatchObject({
      schema: 'storyforge.product-distribution-bundle', version: 2,
      productRelease: { manifest: { productType: 'ai-town' } },
      sourceWorld: { contentHash: owned.brief.source.worldContentHash },
    })
    expect(prototypeBundle.media).toHaveLength(13)
    const preview = await startProductProductionPreviewV1({ scope: owned.scope, productionId: owned.productionId })
    expect((await readProductRuntimeState(preview.sessionId)).town?.content.title).toBe('潮门后日镇')
    const playable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash },
    })
    const concurrentPlayable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash },
    })
    const background = runtimePackage.presentation!.assets.find(item => item.kind === 'background')!
    const [loaded, concurrentlyLoaded] = await Promise.all([
      playable.mediaResolver.read(background.assetKey),
      concurrentPlayable.mediaResolver.read(background.assetKey),
    ])
    expect(loaded).toMatchObject({ type: 'image/svg+xml', size: expect.any(Number) })
    expect(loaded.size).toBeGreaterThan(100)
    expect(concurrentlyLoaded.size).toBe(loaded.size)
    playable.mediaResolver.dispose()
    concurrentPlayable.mediaResolver.dispose()
    const reopened = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash },
    })
    const reloaded = await reopened.mediaResolver.preload({
      assetKeys: runtimePackage.presentation!.assets.map(item => item.assetKey),
      maximumBytes: runtimePackage.presentation!.assets.reduce((sum, item) => sum + item.byteSize, 0),
    })
    expect(reloaded.failures).toEqual([])
    reopened.mediaResolver.dispose()
    const published = await publishProductProductionV1({ scope: owned.scope, productionId: owned.productionId })
    const released = await resolveProductRuntimeSource({
      scope: owned.scope, source: { kind: 'release', productReleaseId: published.receipt.productReleaseId },
    })
    expect(released.runtimePackage.presentation?.assets.map(item => item.blobContentHash))
      .toEqual(runtimePackage.presentation?.assets.map(item => item.blobContentHash))
    released.mediaResolver.dispose()
  }, 30_000)

  it('来源审查可被退回重做，接受私域补充后才允许专业团队继续生产', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'none' })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = await hashProductProductionValueV2({ provider: 'source-decision-fixture' })
    const professional = professionalTextAdventurePlanningOutputs(owned.brief)
    const outputs = {
      ...modelOutputs(
        owned.brief.source.worldContentHash, 'text-adventure',
        firstCharacterAnchor(owned.brief), owned.brief.intent.playerRole,
      ),
      ...professional,
      ...professionalTextAdventureSceneScriptOutputs(
        owned.brief, professional, ['潮门广场', '旧仓街', '信号塔'],
      ),
    } as Record<string, unknown>
    const readySourceAudit = {
      schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
      decision: 'ready-with-private-additions', adaptationStrategy: 'expand-sparse',
      coverage: [{
        domain: 'characters', status: 'partial', resourceKeys: [],
        rationale: '冻结来源足以支撑主线，但支线需要一个产品私域引路人。',
      }],
      gaps: [{
        key: 'gap.supporting-guide', severity: 'warning',
        description: '缺少承接支线的引路角色。', affectedStages: ['content.cast-bible'],
      }],
      privateAdditions: [{
        key: 'addition.supporting-guide', kind: 'character', title: '雾港引路人',
        rationale: '只存在于本游戏 Build，不写回冻结世界。',
      }],
      authorDecisionRequired: true,
    }
    outputs['content.source-sufficiency'] = {
      schema: 'storyforge.text-adventure-source-sufficiency-artifact', version: 1,
      decision: 'blocked', adaptationStrategy: 'expand-sparse',
      coverage: [{
        domain: 'characters', status: 'partial', resourceKeys: [],
        rationale: '第一次审查错误地把产品私域角色弧当成世界来源缺失。',
      }],
      gaps: [{
        key: 'gap.character-arc', severity: 'blocking',
        description: '缺少产品运行期的角色关系弧。', affectedStages: ['content.cast-bible'],
      }],
      privateAdditions: [], authorDecisionRequired: true,
    }
    outputs['media.requirements'] = {
      ...(outputs['media.requirements'] as Record<string, unknown>), visual: [], audio: [],
    }
    const taskCalls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`))
      if (!taskKey) throw new Error(`unknown source-decision task:${request.system}`)
      taskCalls.push(taskKey)
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-source-editor', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'c'.repeat(64),
        },
      }
    }
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
    }]
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(first).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(taskCalls).toEqual(['production.supervision', 'content.source-sufficiency'])
    const blockedBuild = (await db.productBuilds.get(first.buildId))!
    expect(JSON.parse(blockedBuild.failureJson)).toMatchObject({
      taskKey: 'source.author-gate', detail: expect.stringContaining('来源存在阻断'),
    })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([first.buildId, 'content.design']).count()).toBe(0)

    const firstBlockedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'source-review.retry',
        expectedStateRevision: firstBlockedProduction.stateRevision,
        blockerKey: 'content.source-sufficiency',
        resolution: {
          action: 'retry',
          note: '作者指出角色弧属于产品私域，要求保持来源和 Brief 不变重新审查。',
        },
      },
    })
    outputs['content.source-sufficiency'] = readySourceAudit
    const reviewed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(reviewed).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(taskCalls.filter(taskKey => taskKey === 'content.source-sufficiency')).toHaveLength(2)
    expect(JSON.parse((await db.productBuilds.get(reviewed.buildId))!.failureJson)).toMatchObject({
      taskKey: 'source.author-gate', detail: expect.stringContaining('作者明确接受'),
    })

    const blockedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'source-decision.accept',
        expectedStateRevision: blockedProduction.stateRevision, blockerKey: 'source.author-gate',
        resolution: {
          action: 'accept-product-private-expansion',
          note: '作者查看清单后接受产品私域引路人，不回写 WorldRelease。',
        },
      },
    })
    const validArcPlan = outputs['content.narrative-arc-scenes']
    const invalidArcPlan = structuredClone(validArcPlan) as {
      acts: Array<{ sceneCards: unknown[] }>
    }
    invalidArcPlan.acts[0].sceneCards = invalidArcPlan.acts[0].sceneCards.slice(1)
    outputs['content.narrative-arc-scenes'] = invalidArcPlan
    const arcBlocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(arcBlocked).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(JSON.parse((await db.productBuilds.get(arcBlocked.buildId))!.failureJson)).toMatchObject({
      taskKey: 'content.narrative-arc-scenes', detail: expect.stringContaining('sceneCards 数量无效'),
    })
    const decisionBeforeArcRetry = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([arcBlocked.buildId, 'content.source-decision'])
      .filter(row => row.controlEpoch === arcBlocked.controlEpoch && row.status === 'accepted').first()
    expect(decisionBeforeArcRetry).toBeDefined()
    const arcBlockedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'narrative-arc.retry',
        expectedStateRevision: arcBlockedProduction.stateRevision,
        blockerKey: 'content.narrative-arc-scenes',
        resolution: { action: 'retry', note: '修正三幕冻结场景槽位后继续。' },
      },
    })
    outputs['content.narrative-arc-scenes'] = validArcPlan
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    const postRetryArtifacts = await db.productBuildArtifacts.where('buildId').equals(completed.buildId).toArray()
    expect(
      completed,
      `post-arc-retry projection=${JSON.stringify(completed)} failure=${(await db.productBuilds.get(completed.buildId))?.failureJson} artifacts=${JSON.stringify(postRetryArtifacts.map(row => ({ key: row.artifactKey, epoch: row.controlEpoch, status: row.status })))}`,
    ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(taskCalls.filter(taskKey => taskKey === 'content.source-sufficiency')).toHaveLength(2)
    expect(taskCalls.filter(taskKey => taskKey === 'source.author-gate')).toHaveLength(0)
    const decision = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([completed.buildId, 'content.source-decision'])
      .filter(row => row.status === 'carried-forward').first()
    expect(JSON.parse(decision!.payloadJson)).toMatchObject({
      decision: 'accept-product-private-expansion',
      acceptedPrivateAdditionKeys: ['addition.supporting-guide'],
      authorCommandId: 'source-decision.accept',
    })
  }, 30_000)

  it('商业终幕正文遗漏冻结结局后果时，第二次尝试只接收逐值闭合的精确 system beat 返修清单', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'key-scenes', omitWorldArtifacts: true,
      qualityProfile: 'commercial-candidate',
    })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({
      buildNumber: 1, briefHash, brief: owned.brief,
    })
    const task = plan.tasks.find(candidate => (
      candidate.taskKey === 'content.scene-script.act-3.part-2'
    ))!
    const outputs = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const storyBible = outputs['content.story-bible'] as {
      endings: Array<{ key: string; requiredConsequences: string[] }>
    }
    const endingContract = storyBible.endings[0]
    const missingConsequence = endingContract.requiredConsequences[1]
    const invalidOutput = structuredClone(outputs[task.taskKey]) as {
      endings: Array<{
        endingKey: string
        summary: string
        beats: Array<{ text: string }>
      }>
    }
    const invalidEnding = invalidOutput.endings.find(ending => (
      ending.endingKey === endingContract.key
    ))!
    invalidEnding.summary = invalidEnding.summary.replaceAll(
      missingConsequence, '人物关系出现了变化',
    )
    invalidEnding.beats.forEach(beat => {
      beat.text = beat.text.replaceAll(missingConsequence, '人物关系出现了变化')
    })
    expect([invalidEnding.summary, ...invalidEnding.beats.map(beat => beat.text)].join('\n'))
      .not.toContain(missingConsequence)
    const repairedOutput = structuredClone(outputs[task.taskKey]) as {
      endings: Array<{
        endingKey: string
        beats: Array<{
          beatKey: string
          kind: 'narration' | 'dialogue' | 'action' | 'system'
          speakerKey: string | null
          text: string
          order: number
        }>
      }>
    }
    const repairedEnding = repairedOutput.endings.find(ending => (
      ending.endingKey === endingContract.key
    ))!
    repairedEnding.beats.push({
      beatKey: 'beat.act-3.ending-001.required-consequence-002',
      kind: 'system', speakerKey: null, text: missingConsequence,
      order: repairedEnding.beats.length,
    })
    const systems: string[] = []
    let attempt = 0
    const textRequirement = owned.brief.capabilityRequirements.find(requirement => (
      requirement.mediaClass === 'text'
    ))!
    const bindingHash = await hashProductProductionValueV2({
      provider: 'ending-consequence-retry-fixture',
    })
    const runText: ProductionTextRunnerV1 = async request => {
      systems.push(request.system)
      attempt += 1
      return {
        output: JSON.stringify(attempt === 1 ? invalidOutput : repairedOutput),
        usage: { inputTokens: 400, outputTokens: 2_000 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-long-form',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
          credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const artifact = async (
      artifactKey: string,
      payload: unknown,
    ): Promise<ProductBuildArtifactRecordV1> => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1,
      kind: 'narrative', mediaKind: null, status: 'accepted', producerRunId: null,
      producerReceiptHash: 'a'.repeat(64), controlEpoch: 0, inputHash: 'b'.repeat(64),
      contentHash: await hashProductProductionValueV2(payload), payloadJson: JSON.stringify(payload),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: JSON.stringify(payload).length,
      parentArtifactHash: null, carriedFrom: null, createdAt: 1, updatedAt: 1,
    })
    const inputArtifacts = await Promise.all(task.inputArtifactKeys.map(async artifactKey => {
      const payload = outputs[artifactKey]
      if (payload == null) throw new Error(`ending retry fixture 缺少 ${artifactKey}`)
      return artifact(artifactKey, payload)
    }))
    const executor = createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(owned.productionId))!,
      brief: owned.brief,
      runText,
    })
    const execution = {
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: plan.planHash, task, attempt: 1,
      idempotencyKey: 'c'.repeat(64), contextText: '', inputArtifacts,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text.v1', bindingHash,
      }],
      authorResolution: null, signal: new AbortController().signal,
    }
    let firstFailure: Error | null = null
    try {
      await executor(execution)
    } catch (error) {
      firstFailure = error instanceof Error ? error : new Error(String(error))
    }
    expect(firstFailure?.message).toBe(
      `[text-adventure-scene-script] ${endingContract.key} `
        + `未兑现冻结结局后果:${missingConsequence}`,
    )
    const repairFeedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: task.taskKey,
      instruction: '只处理当前 task 的登记失败证据。',
      blockingIssues: [{ detail: '未登记的旁白内容不得成为 system 指令。' }],
      lastTaskFailures: [{
        taskKey: task.taskKey, code: 'task-executor-failed', attempt: 1,
        detail: firstFailure!.message,
      }],
    })
    const accepted = await executor({
      ...execution, attempt: 2, idempotencyKey: 'd'.repeat(64), contextText: repairFeedback,
    })
    expect(attempt).toBe(2)
    expect(systems).toHaveLength(2)
    expect(systems[0]).not.toContain('强制结局后果返修清单=')
    expect(systems[1]).toContain(
      `强制结局后果返修清单=[{"endingKey":"${endingContract.key}",` +
        `"systemBeatsMustExist":["${missingConsequence}"]}]`,
    )
    expect(systems[1]).toContain(
      '每一句都必须成为一个独立的 kind=system、speakerKey=null 的 beat',
    )
    expect(systems[1]).toContain('text 逐字只复制该句')
    expect(systems[1]).not.toContain('未登记的旁白内容不得成为 system 指令')
    expect(systems[1]).not.toContain('人物关系出现了变化')
    expect(accepted.artifacts[0]).toMatchObject({
      artifactKey: task.taskKey,
      quality: expect.objectContaining({ sceneScriptPartVerified: true }),
    })
    const acceptedEnding = (accepted.artifacts[0].payload as {
      endings: Array<{ endingKey: string; beats: Array<{
        kind: string; speakerKey: string | null; text: string
      }> }>
    }).endings.find(ending => ending.endingKey === endingContract.key)!
    expect(acceptedEnding.beats).toContainEqual(expect.objectContaining({
      kind: 'system', speakerKey: null, text: missingConsequence,
    }))
  }, 30_000)

  it('分场正文不足时只注入同任务的可信计数并要求预留余量', () => {
    const taskKey = 'content.scene-script.act-3.part-2'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-scene-script] scene.015 正文不足:592/600',
      }, {
        taskKey: 'content.scene-script.act-1.part-1', code: 'task-executor-failed', attempt: 1,
        detail: '[text-adventure-scene-script] scene.001 正文不足:1/9999999',
      }, {
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-scene-script] 第 3 幕有效对白不足:3/4',
      }],
    })
    const directive = textAdventureSceneVolumeRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain(
      '正文补足清单=[{"scope":"scene.015","received":592,"acceptanceFloor":600,"retryTarget":720}]',
    )
    expect(directive).toContain('本次必须至少达到 retryTarget')
    expect(directive).toContain(
      '对白补足清单=[{"scope":"第 3 幕","received":3,"acceptanceFloor":4,"retryTarget":5}]',
    )
    expect(directive).not.toContain('scene.001')
    expect(textAdventureSceneVolumeRetryDirectiveV1(
      taskKey,
      feedback.replace('content.scene-script.act-3.part-2', 'content.scene-script.act-2.part-1'),
    )).toBe('')
  })

  it('分场 sceneKey 重复时要求从空数组按冻结槽位重建且只接受同任务证据', () => {
    const taskKey = 'content.scene-script.act-3.part-2'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-scene-script] sceneScriptBundle.scenes sceneKey 重复',
      }, {
        taskKey: 'content.scene-script.act-2.part-1', code: 'task-executor-failed', attempt: 1,
        detail: '[text-adventure-scene-script] sceneScriptBundle.scenes sceneKey 重复',
      }],
    })
    const directive = textAdventureSceneIdentityRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('必须从空的 scenes 数组开始')
    expect(directive).toContain('禁止在数组末尾追加同 key 的修订副本')
    expect(directive).toContain('冻结槽位之外的 sceneKey 一律不得输出')
    expect(directive).toContain('长度必须等于 Set 后长度')
    expect(textAdventureSceneIdentityRetryDirectiveV1(taskKey, JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-scene-script] scenes[2] 不属于本幕:scene.016',
      }],
    }))).toContain('越出本幕')
    const missingDirective = textAdventureSceneIdentityRetryDirectiveV1(taskKey, JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-scene-script] sceneScriptBundle.scenes 未覆盖冻结分包:实际=scene.011,scene.012;缺失=scene.013',
      }],
    }))
    expect(missingDirective).toContain(
      '覆盖失败证据=[{"actual":["scene.011","scene.012"],"missing":["scene.013"]}]',
    )
    expect(missingDirective).toContain('先逐项建立 missing 中每个 sceneKey')
    expect(textAdventureSceneIdentityRetryDirectiveV1(
      'content.scene-script.act-2.part-1', feedback,
    )).toBe('')
  })

  it('叙事审查引用伪 beat key 时回显真实只读 beat 身份而不允许拼号', () => {
    const taskKey = 'content.adventure-quality-review.act-1'
    const packet = JSON.stringify({
      schema: 'storyforge.text-adventure-quality-inputs', version: 3,
      reviewScope: {
        scope: 'act-1', sceneKeys: ['scene.001'], endingKeys: [], boundaryNodeKeys: [],
        choiceKeys: [], decisionKeys: [], optionKeys: [], objectiveKeys: [],
        alternativeKeys: [], sideQuestKeys: [], ambientEventKeys: [], supplementalStageKeys: [],
      },
      narrative: {
        nodes: [{
          key: 'scene.001',
          beats: [
            ['beat.act-1.001', 0, 'narration', null, '开场'],
            ['beat.act-1.005', 4, 'dialogue', 'character.npc-01', '对白'],
          ],
        }],
        choices: [],
      },
      arcPlan: { decisions: [] },
      mainQuestPlan: [],
    })
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[product-production-executor] 叙事质量审查错误引用冻结身份:'
          + '审查 引用未登记 key:scene.001.beat.005',
      }],
    })
    const directive = textAdventureQualityReviewReferenceRetryDirectiveV1(
      taskKey, `${packet}\n\n${feedback}`,
    )
    expect(directive).toContain(
      '"readOnlyBeatKeysByNode":[{"nodeKey":"scene.001","beatKeys":["beat.act-1.001","beat.act-1.005"]}]',
    )
    expect(directive).toContain('严禁把场景 key、字段名和序号拼成 scene.001.beat.005')
    expect(directive).toContain('owningKey 仍使用该 beat 所属的 sceneKey')
  })

  it('质量聚合确定性阻断同场景逐字重复正文，同时忽略系统提示和跨场景复用', () => {
    const repeated = '阿塔抬起结霜的护目镜，指向祭坛背后正在开裂的承重梁。'
    const issues = textAdventureDuplicateBeatIssuesV1({
      beats: [
        { beatKey: 'beat.scene-010.001', nodeKey: 'scene.010', kind: 'dialogue', text: repeated },
        { beatKey: 'beat.scene-010.002', nodeKey: 'scene.010', kind: 'dialogue', text: repeated },
        { beatKey: 'beat.scene-011.001', nodeKey: 'scene.011', kind: 'dialogue', text: repeated },
        { beatKey: 'beat.scene-010.system', nodeKey: 'scene.010', kind: 'system', text: repeated },
      ],
    })
    expect(issues).toEqual([expect.objectContaining({
      severity: 'blocking',
      artifactKey: 'content.narrative',
      detail: expect.stringContaining('[owningKey=scene.010]'),
    })])
    expect(issues[0]?.detail).toContain('beat.scene-010.001、beat.scene-010.002')
  })

  it('质量聚合确定性阻断跨场景复制给不同角色的包含关系对白', () => {
    const issues = textAdventureDuplicateBeatIssuesV1({
      beats: [{
        beatKey: 'beat.act-3.part-1.scene-01.011', nodeKey: 'scene.011', kind: 'dialogue',
        speakerKey: 'character.mentor',
        text: '「我是他留在最后的记录。也是我自己的回声。三十年前我就站在这里。」',
      }, {
        beatKey: 'beat.act-3.part-1.scene-02.008', nodeKey: 'scene.012', kind: 'dialogue',
        speakerKey: 'character.village-chief', text: '「我是他留在最后的记录。也是我自己的回声。」',
      }],
    })
    expect(issues).toEqual([expect.objectContaining({
      severity: 'blocking', artifactKey: 'content.dialogue-pass.act-3',
      detail: expect.stringContaining('[owningKey=scene.012]'),
    })])
    expect(issues[0]?.detail).toContain('character.mentor')
    expect(issues[0]?.detail).toContain('character.village-chief')
  })

  it('质量聚合阻断不同角色的短句改写复制和高度近似对白', () => {
    const shortEcho = textAdventureDuplicateBeatIssuesV1({ beats: [{
      beatKey: 'beat.act-2.part-1.scene-01.001', nodeKey: 'scene.007', kind: 'dialogue',
      speakerKey: 'character.npc-02',
      text: '涅洛？你怎么会在这儿？这里的事不该出现在任何人的航图上。',
    }, {
      beatKey: 'beat.act-2.part-1.scene-01.002', nodeKey: 'scene.007', kind: 'dialogue',
      speakerKey: 'character.player', text: '涅洛？你怎么会在这里？',
    }] })
    expect(shortEcho).toEqual([expect.objectContaining({
      severity: 'blocking', artifactKey: 'content.dialogue-pass.act-2',
      detail: expect.stringContaining('包含关系'),
    })])

    const fuzzyEcho = textAdventureDuplicateBeatIssuesV1({ beats: [{
      beatKey: 'beat.act-3.part-2.scene-01.020', nodeKey: 'scene.015', kind: 'dialogue',
      speakerKey: 'character.player',
      text: '我只负责记住。但如果记住本身就成了证词，我愿意让它们被听见。',
    }, {
      beatKey: 'beat.act-3.part-2.scene-01.021', nodeKey: 'scene.015', kind: 'dialogue',
      speakerKey: 'character.npc-04',
      text: '我只负责记录。但如果记录本身成了证词，我愿意让它被听见。',
    }] })
    expect(fuzzyEcho).toEqual([expect.objectContaining({
      severity: 'blocking', artifactKey: 'content.dialogue-pass.act-3',
      detail: expect.stringContaining('高度近似'),
    })])
  })

  it('场景说话者权威门阻断全局存在但当前场景未授权的角色', () => {
    const issues = textAdventureSceneSpeakerAuthorityIssuesV1({ beats: [{
      beatKey: 'beat.act-2.part-1.scene-01.004', nodeKey: 'scene.007', kind: 'dialogue',
      speakerKey: 'character.npc-02', text: '你不该来这里。',
    }, {
      beatKey: 'beat.act-2.part-1.scene-02.004', nodeKey: 'scene.008', kind: 'dialogue',
      speakerKey: 'character.player', text: '我只是读到一段记录。',
    }] }, {
      acts: [{ sceneCards: [
        { key: 'scene.007', castKeys: ['character.player'] },
        { key: 'scene.008', castKeys: ['character.player'] },
      ] }],
    })
    expect(issues).toEqual([expect.objectContaining({
      artifactKey: 'content.scene-script.act-2',
      detail: expect.stringContaining('character.npc-02'),
    })])
  })

  it('场景说话者权威门阻断用玩家 speakerKey 包装的越界角色对白', () => {
    const issues = textAdventureSceneSpeakerAuthorityIssuesV1({ beats: [{
      beatKey: 'beat.act-2.part-2.scene-01.007', nodeKey: 'scene.008', kind: 'dialogue',
      speakerKey: 'character.player', text: '「离开这里。」议会巡灯员·克罗打断你。',
    }] }, {
      acts: [{ sceneCards: [
        { key: 'scene.008', castKeys: ['character.player'] },
        { key: 'scene.009', castKeys: ['character.player', 'character.npc-05'] },
      ] }],
    }, {
      characters: [
        { key: 'character.player', name: '岚舟', role: 'player' },
        { key: 'character.npc-05', name: '议会巡灯员·克罗', role: 'supporting' },
      ],
    })
    expect(issues).toEqual([expect.objectContaining({
      artifactKey: 'content.scene-script.act-2',
      detail: expect.stringContaining('未列入冻结场景 castKeys'),
      recommendation: expect.stringContaining('不得仅修改 speakerKey'),
    })])
  })

  it('主线地点权威门能识别已登记地点的自然简称', () => {
    const locationTitles = ['沉船脊废墟', '议会档案库', '观潮台', '冰海祭坛', '主灯塔']
    const issues = textAdventureQuestLocationAuthorityIssuesV1({ quests: [{ objectives: [{
      key: 'objective.04', locationOrdinal: 1,
      title: '在档案库找到原始供能记录', narrativePurpose: '确认废墟里的物证。',
    }, {
      key: 'objective.05', locationOrdinal: 2,
      title: '在观潮台核对被篡改的数据', narrativePurpose: '查阅议会原始卷宗。',
    }, {
      key: 'objective.08', locationOrdinal: 4,
      title: '在灯塔顶端做出终局抉择', narrativePurpose: '在冰海祭坛完成决断。',
    }] }] }, locationTitles)
    expect(issues.map(issue => issue.detail)).toEqual([
      expect.stringContaining('objective.04'),
      expect.stringContaining('objective.05'),
      expect.stringContaining('objective.08'),
    ])
    expect(issues[0]?.detail).toContain('档案库')
    expect(issues[2]?.detail).toContain('灯塔')
  })

  it('确定性聚合把明确的事实权威矛盾升级为 blocking', () => {
    expect(normalizeTextAdventureQualityIssuesV1([{
      severity: 'warning', artifactKey: 'content.dialogue-pass.act-1',
      detail: '[owningKey=scene.003] 角色对白与冻结事实矛盾：导师仅失踪，并未确认死亡。',
      recommendation: '保留冻结失踪状态，不得将推测写成事实。',
    }])).toEqual([expect.objectContaining({ severity: 'blocking' })])
    expect(normalizeTextAdventureQualityIssuesV1([{
      severity: 'warning', artifactKey: 'content.dialogue-pass.act-1',
      detail: '[owningKey=scene.003] 这句对白略显生硬。', recommendation: '压缩句子。',
    }])).toEqual([expect.objectContaining({ severity: 'warning' })])
  })

  it('质量聚合确定性阻断 Scene Writer 擅自把冻结导师改写成父亲', () => {
    const cast = {
      characters: [{
        key: 'character.mentor', name: '沉砾', publicIdentity: '岚舟的导师',
        relationshipArc: ['师徒隔阂', '理解导师留下的选择'],
      }, {
        key: 'character.innkeeper', name: '涅洛', publicIdentity: '失去女儿的酒馆老板',
        relationshipArc: ['保持戒心', '决定共同作证'],
      }],
    }
    const issues = textAdventureUnauthorizedKinshipIssuesV1({
      beats: [{
        key: 'beat.ending-03.007', nodeKey: 'ending.003', kind: 'dialogue',
        text: '阿塔沉默了很久。“沉砾……如果他真是你父亲，他不会希望你付出这种代价。”',
      }, {
        key: 'beat.scene-004.003', nodeKey: 'scene.004', kind: 'dialogue',
        text: '涅洛说起自己失去的女儿，最终还是把银铃交给岚舟。',
      }],
    }, cast)
    expect(issues).toEqual([expect.objectContaining({
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: expect.stringContaining('[owningKey=ending.003]'),
    })])
    expect(issues[0]?.detail).toContain('未获 Cast Bible 授权的亲属身份:父亲')
  })

  it('亲属权威门允许导师保护玩家父亲以及明确否定导师是父亲', () => {
    const cast = {
      characters: [{
        key: 'character.mentor', name: '沉砾', publicIdentity: '岚舟的导师',
        relationshipArc: ['师徒隔阂', '理解导师留下的选择'],
      }],
    }
    expect(textAdventureUnauthorizedKinshipIssuesV1({
      beats: [{
        beatKey: 'beat.scene-007.006', nodeKey: 'scene.007', kind: 'narration',
        text: '这不是普通的师徒传承，而是一位父亲对女儿的托付。沉砾保护了你的父亲，也保护了你。',
      }, {
        beatKey: 'beat.scene-008.005', nodeKey: 'scene.008', kind: 'narration',
        text: '那不是沉砾，也不是你的父亲，而是一名你从未见过的守灯人。',
      }],
    }, cast)).toEqual([])
  })

  it('对白归属门返回正文明确说话人的稳定角色键', () => {
    const issues = textAdventureDialogueAttributionIssuesV1({
      beats: [{
        beatKey: 'beat.scene-006.012', nodeKey: 'scene.006', kind: 'dialogue',
        speakerKey: 'character.guard', text: '因为议会删掉了。涅洛指了指残屋深处，他把日志藏在这里。',
      }, {
        beatKey: 'beat.scene-009.019', nodeKey: 'scene.009', kind: 'dialogue',
        speakerKey: 'character.player', text: '岚舟，如果你读到这段留言……金属匣传出沉砾的声音。',
      }, {
        beatKey: 'beat.scene-009.020', nodeKey: 'scene.009', kind: 'dialogue',
        speakerKey: 'character.player', text: '我知道沉砾留下了什么，但我还没找到。',
      }, {
        beatKey: 'beat.scene-001.020', nodeKey: 'scene.001', kind: 'dialogue',
        speakerKey: 'character.player', text: '岚舟，如果你听到这段记录，说明潮钟已经开始停摆。',
      }, {
        beatKey: 'beat.scene-009.021', nodeKey: 'scene.009', kind: 'dialogue',
        speakerKey: 'character.guard',
        text: '你的声音低了下去。他原本紧绷的肩膀塌下一分。沉默了很久，久到我以为他不会再说。',
      }, {
        beatKey: 'beat.scene-008.009', nodeKey: 'scene.008', kind: 'dialogue',
        speakerKey: 'character.player', text: '「数据无误。」克罗终于开口，声音里没有温度。',
      }],
    }, {
      characters: [
        { key: 'character.player', name: '岚舟' },
        { key: 'character.neilo', name: '涅洛' },
        { key: 'character.mentor', name: '沉砾' },
        { key: 'character.guard', name: '奎因' },
        { key: 'character.inspector', name: '议会巡灯员·克罗' },
      ],
    })
    expect(issues).toHaveLength(5)
    expect(issues[0]?.detail).toContain('beat.scene-006.012')
    expect(issues[0]?.recommendation).toContain('character.neilo')
    expect(issues[1]?.detail).toContain('beat.scene-009.019')
    expect(issues[1]?.recommendation).toContain('character.mentor')
    expect(issues[2]?.detail).toContain('以玩家姓名向「你」留言')
    expect(issues[3]?.detail).toContain('kind=dialogue 但正文是第二人称旁白')
    expect(issues[4]?.detail).toContain('正文使用冻结简称「克罗」')
    expect(issues[4]?.recommendation).toContain('character.inspector')
  })

  it('质量聚合确定性阻断非对白正文把玩家退回小说式第三人称', () => {
    const issues = textAdventurePlayerPerspectiveIssuesV1({
      beats: [{
        beatKey: 'beat.scene-009.001', nodeKey: 'scene.009', kind: 'narration',
        text: '岚舟沿着铁梯下行。她的右手握着调音钥匙。',
      }, {
        beatKey: 'beat.scene-009.002', nodeKey: 'scene.009', kind: 'action',
        text: '岚舟把钥匙贴近潮钟，然后收回手。',
      }, {
        beatKey: 'beat.scene-009.003', nodeKey: 'scene.009', kind: 'dialogue',
        text: '涅洛喊道：“岚舟，别碰它！”',
      }, {
        beatKey: 'beat.scene-010.001', nodeKey: 'scene.010', kind: 'narration',
        text: '你在废墟里找到了导师的笔记。',
      }],
    }, {
      characters: [{ key: 'character.player', role: 'player', name: '岚舟' }],
    }, {
      regions: [{ areas: [{ locations: [{ title: '岚舟童年故居遗址' }] }] }],
    })
    expect(issues).toEqual([expect.objectContaining({
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: expect.stringContaining('[owningKey=scene.009]'),
    })])
    expect(issues[0]?.detail).toContain('beat.scene-009.001')
    expect(issues[0]?.detail).toContain('beat.scene-009.002')
    expect(issues[0]?.detail).not.toContain('beat.scene-009.003')
    expect(issues[0]?.recommendation).toContain('你/你的')
  })

  it('玩家视角门不把含玩家名的冻结地点标题误判为第三人称正文', () => {
    const issues = textAdventurePlayerPerspectiveIssuesV1({
      beats: [{
        beatKey: 'beat.scene-006.001', nodeKey: 'scene.006', kind: 'narration',
        text: '岚舟童年故居遗址在潮雾中露出半截门楣。',
      }, {
        beatKey: 'beat.scene-006.002', nodeKey: 'scene.006', kind: 'action',
        text: '岚舟站在岚舟童年故居遗址前，抬手擦去门牌上的盐霜。',
      }],
    }, {
      characters: [{ key: 'character.player', role: 'player', name: '岚舟' }],
    }, {
      regions: [{ areas: [{ locations: [{ title: '岚舟童年故居遗址' }] }] }],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.detail).not.toContain('beat.scene-006.001')
    expect(issues[0]?.detail).toContain('beat.scene-006.002')
  })

  it('玩家视角门允许书信、录音与题记在闭合引号中称呼玩家', () => {
    const issues = textAdventurePlayerPerspectiveIssuesV1({
      beats: [{
        beatKey: 'beat.scene-006.003', nodeKey: 'scene.006', kind: 'narration',
        text: '金属匣里传出留言：“潮钟在等你，岚舟。”你按住仍在震动的簧片。',
      }, {
        beatKey: 'beat.scene-012.009', nodeKey: 'scene.012', kind: 'action',
        text: '地图背面写着「给岚舟：不要独自进入深海井」。你把它折好收起。',
      }],
    }, {
      characters: [{ key: 'character.player', role: 'player', name: '岚舟' }],
    })
    expect(issues).toEqual([])
  })

  it('质量审查丢弃与冻结 beat 说话人事实冲突的单条与批量指控', () => {
    const facts = {
      'beat.scene-012.008': {
        nodeKey: 'scene.012', kind: 'dialogue', speakerKey: 'character.player', text: '我来调整潮钟。',
      },
      'beat.scene-012.013': {
        nodeKey: 'scene.012', kind: 'dialogue', speakerKey: 'character.player', text: '把地图交给我。',
      },
    }
    expect(textAdventureQualityReviewBeatClaimContradictionV1({
      detail: '[owningKey=scene.012] beat.scene-012.008 的 speakerKey 为 character.npc-01，但这句属于玩家。',
    }, facts)).toContain('冻结正文实际为 character.player')
    expect(textAdventureQualityReviewBeatClaimContradictionV1({
      detail: '[owningKey=scene.012] beat.scene-012.008、beat.scene-012.013 这些对白的 speakerKey 均为 character.npc-01，应改为玩家。',
    }, facts)).toContain('beat.scene-012.008')
    expect(textAdventureQualityReviewBeatClaimContradictionV1({
      detail: '[owningKey=scene.012] beat.scene-012.008 的 speakerKey 为 character.player，但措辞缺少角色声音。',
    }, facts)).toBeNull()
  })

  it('分场质量返修只接收稳定键字段补丁并由规则层保留未命中正文', () => {
    const taskKey = 'content.scene-script.act-1.part-2'
    const baselinePayload = {
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
      actKey: 'act.1', moduleTitle: '潮钟群岛',
      scenes: [{
        sceneKey: 'scene.004', title: '旧码头', summary: '未命中的摘要必须保留。',
        beats: [{
          beatKey: 'beat.act-1.scene-004.001', kind: 'narration', speakerKey: null,
          text: '你走进旧码头。', order: 0,
        }],
      }, {
        sceneKey: 'scene.005', title: '潮钟塔', summary: '岚舟来到塔下。',
        beats: [{
          beatKey: 'beat.act-1.scene-005.014', kind: 'dialogue', speakerKey: 'character.npc-05',
          text: '我会把他们的名字找回来。', order: 0,
        }, {
          beatKey: 'beat.act-1.scene-005.015', kind: 'narration', speakerKey: null,
          text: '她抬头看向潮钟。', order: 1,
        }],
      }],
      choices: [{
        choiceKey: 'choice.016', sourceNodeKey: 'scene.005', targetNodeKey: 'scene.006',
        text: '看看未来会发生什么', description: '预览未来结果。', unavailableReason: '', order: 0,
      }],
      endings: [],
    }
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      baselineArtifact: {
        artifactKey: taskKey, artifactVersion: 1, controlEpoch: 7,
        contentHash: 'a'.repeat(64),
        payload: baselinePayload,
      },
      blockingIssues: [{
        repairTaskKeys: [taskKey],
        detail: 'scene.005 的玩家旁白改用第三人称。', recommendation: '统一使用第二人称。',
      }, {
        repairTaskKeys: [taskKey],
        detail: 'beat.act-1.scene-005.014 的 speakerKey 属于 Quinn，但文本属于 Nello。',
        recommendation: '纠正说话人并保留原意。',
      }, {
        repairTaskKeys: [taskKey],
        detail: 'choice.016 预告了未来结果。', recommendation: '改成当下可执行行动。',
      }],
      lastTaskFailures: [],
    })
    const directive = textAdventureRepairBaselineDirectiveV1(taskKey, feedback)
    expect(directive).toContain('不得重新提交完整分场工件')
    expect(directive).toContain('storyforge.text-adventure-scene-repair-patch-artifact')
    expect(directive).toContain('scene.005 及其 beats')
    expect(directive).toContain('beat.act-1.scene-005.014')
    expect(directive).toContain('choice.016')
    const repaired = applyTextAdventureSceneRepairPatchV1(taskKey, feedback, {
      schema: 'storyforge.text-adventure-scene-repair-patch-artifact', version: 1,
      patches: [{
        issueIndexes: [0], targetKind: 'beat', targetKey: 'beat.act-1.scene-005.015',
        field: 'text', value: '你抬头看向潮钟。',
      }, {
        issueIndexes: [1], targetKind: 'beat', targetKey: 'beat.act-1.scene-005.014',
        field: 'speakerKey', value: 'character.npc-01',
      }, {
        issueIndexes: [2], targetKind: 'choice', targetKey: 'choice.016',
        field: 'text', value: '立即敲响警钟',
      }],
    })
    expect(repaired).toEqual({
      ...baselinePayload,
      scenes: [baselinePayload.scenes[0], {
        ...baselinePayload.scenes[1],
        beats: [{ ...baselinePayload.scenes[1].beats[0], speakerKey: 'character.npc-01' }, {
          ...baselinePayload.scenes[1].beats[1], text: '你抬头看向潮钟。',
        }],
      }],
      choices: [{ ...baselinePayload.choices[0], text: '立即敲响警钟' }],
    })
    expect(repaired.scenes[0]).toEqual(baselinePayload.scenes[0])
    expect(() => applyTextAdventureSceneRepairPatchV1(taskKey, feedback, {
      schema: 'storyforge.text-adventure-scene-repair-patch-artifact', version: 1,
      patches: [{
        issueIndexes: [0], targetKind: 'beat', targetKey: 'beat.act-1.scene-004.001',
        field: 'text', value: '不应允许跨场景修改。',
      }, {
        issueIndexes: [1], targetKind: 'beat', targetKey: 'beat.act-1.scene-005.014',
        field: 'speakerKey', value: 'character.npc-01',
      }, {
        issueIndexes: [2], targetKind: 'choice', targetKey: 'choice.016',
        field: 'text', value: '立即敲响警钟',
      }],
    })).toThrow('target 不属于 issue 0 的合法定位')
    expect(textAdventureRepairBaselineDirectiveV1(
      'content.scene-script.act-2.part-1', feedback,
    )).toBe('')
  })

  it('同任务正文结构失败仍使用完整工件返修合同而不误启用字段补丁', () => {
    const taskKey = 'content.scene-script.act-1.part-2'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      baselineArtifact: {
        artifactKey: taskKey, artifactVersion: 1, controlEpoch: 7,
        contentHash: 'a'.repeat(64),
        payload: { schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1 },
      },
      blockingIssues: [{ detail: 'scene.005 仍需修复', recommendation: '修复正文' }],
      lastTaskFailures: [{ taskKey, code: 'task-executor-failed', attempt: 1, detail: '正文不足' }],
    })
    const directive = textAdventureRepairBaselineDirectiveV1(taskKey, feedback)
    expect(directive).toContain('当前任务唯一正文底稿')
    expect(directive).toContain('最后输出完整工件')
    expect(directive).toContain('禁止只输出被点名的 scene')
  })

  it('旧 epoch 的候选失败不得覆盖更新底稿的精确字段返修协议', () => {
    const taskKey = 'content.scene-script.act-2.part-2'
    const feedback = (failureControlEpoch: number) => JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      baselineArtifact: {
        artifactKey: taskKey, artifactVersion: 13, controlEpoch: 436,
        contentHash: 'a'.repeat(64),
        payload: {
          schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
          actKey: 'act.2', moduleTitle: '潮钟群岛',
          scenes: [{
            sceneKey: 'scene.009', title: '失声港', summary: '你来到失声港。',
            beats: [{
              beatKey: 'beat.act-2.part-2.scene-01.001', kind: 'narration', speakerKey: null,
              text: '她沿着潮线前进。', order: 0,
            }],
          }],
          choices: [], endings: [],
        },
      },
      blockingIssues: [{
        detail: 'scene.009 的 beat.act-2.part-2.scene-01.001 误用第三人称。',
        recommendation: '只把该旁白改为第二人称。',
      }],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 1, controlEpoch: failureControlEpoch,
        detail: '[text-adventure-scene-script] scenes[0] 字段不精确:beats,locationOrdinal,sceneKey,summary,title',
      }],
    })
    const staleDirective = textAdventureRepairBaselineDirectiveV1(taskKey, feedback(430))
    expect(staleDirective).toContain('storyforge.text-adventure-scene-repair-patch-artifact')
    expect(staleDirective).toContain('不得重新提交完整分场工件')
    expect(staleDirective).not.toContain('最后输出完整工件')

    const currentDirective = textAdventureRepairBaselineDirectiveV1(taskKey, feedback(437))
    expect(currentDirective).toContain('当前任务唯一正文底稿')
    expect(currentDirective).toContain('最后输出完整工件')
    expect(currentDirective).not.toContain('storyforge.text-adventure-scene-repair-patch-artifact')
  })

  it('质量返修上下文存在但补丁计划不可重建时拒绝整包候选', () => {
    const taskKey = 'content.scene-script.act-2.part-1'
    const malformedFeedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      baselineArtifact: {
        artifactKey: taskKey,
        // 无合法 hash，使补丁计划构建失败；执行器必须 fail closed。
        contentHash: 'not-a-hash',
        payload: { scenes: [], choices: [], endings: [] },
      },
      blockingIssues: [{ detail: 'scene.006 需要修复', recommendation: '只改写点名字段' }],
      lastTaskFailures: [],
    })
    expect(() => applyTextAdventureSceneRepairPatchV1(taskKey, malformedFeedback, {
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
      actKey: 'act.2', moduleTitle: '不应被采纳', scenes: [], choices: [], endings: [],
    })).toThrow('无法重建字段补丁计划')
  })

  it('补丁协议失败后仍限定为字段补丁而不退回整包重写', () => {
    const taskKey = 'content.scene-script.act-1.part-2'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      baselineArtifact: {
        artifactKey: taskKey, artifactVersion: 1, controlEpoch: 7,
        contentHash: 'a'.repeat(64),
        payload: {
          schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
          actKey: 'act.1', moduleTitle: '潮钟群岛',
          scenes: [{
            sceneKey: 'scene.005', title: '潮钟塔', summary: '岚舟来到塔下。',
            beats: [{
              beatKey: 'beat.act-1.scene-005.001', kind: 'narration', speakerKey: null,
              text: '她抬头看向潮钟。', order: 0,
            }],
          }],
          choices: [], endings: [],
        },
      },
      blockingIssues: [{
        detail: 'scene.005 的玩家旁白误用第三人称。', recommendation: '统一使用第二人称。',
      }],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 1,
        detail: '[product-production-executor] sceneRepairPatch.patches[0].targetKey 无效',
      }],
    })
    const directive = textAdventureRepairBaselineDirectiveV1(taskKey, feedback)
    expect(directive).toContain('storyforge.text-adventure-scene-repair-patch-artifact')
    expect(directive).toContain('不得重新提交完整分场工件')
    expect(directive).not.toContain('最后输出完整工件')
  })

  it('补丁合并后的精确 speakerKey 校验失败仍保持字段补丁协议', () => {
    const taskKey = 'content.scene-script.act-2.part-2'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      baselineArtifact: {
        artifactKey: taskKey, artifactVersion: 9, controlEpoch: 442,
        contentHash: 'c'.repeat(64),
        payload: {
          schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
          actKey: 'act.2', moduleTitle: '潮钟群岛',
          scenes: [{
            sceneKey: 'scene.009', title: '失声港', summary: '你来到失声港。',
            beats: [{
              beatKey: 'beat.act-2.part-2.scene-01.007', kind: 'dialogue',
              speakerKey: 'character.player', text: '名字……好多名字……', order: 0,
            }],
          }],
          choices: [], endings: [],
        },
      },
      blockingIssues: [{
        detail: 'scene.009 beat.act-2.part-2.scene-01.007 的 speakerKey 与被动记忆体验冲突。',
        recommendation: '改成旁白式描写并保持稳定 beat key。',
      }],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 1, controlEpoch: 442,
        detail: '[text-adventure-scene-script] scenes[0].beats[0] dialogue speakerKey 无效',
      }],
    })
    const directive = textAdventureRepairBaselineDirectiveV1(taskKey, feedback)
    expect(directive).toContain('storyforge.text-adventure-scene-repair-patch-artifact')
    expect(directive).toContain('不得重新提交完整分场工件')
    expect(directive).not.toContain('最后输出完整工件')
  })

  it('确定性语言门点名具体字段时只允许字段补丁，不得放开整包重写', () => {
    const taskKey = 'content.scene-script.act-3.part-1'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      baselineArtifact: {
        artifactKey: taskKey, artifactVersion: 7, controlEpoch: 423,
        contentHash: 'b'.repeat(64),
        payload: {
          schema: 'storyforge.text-adventure-scene-script-bundle-artifact', version: 1,
          actKey: 'act.3', moduleTitle: '潮钟群岛',
          scenes: [{
            sceneKey: 'scene.011', title: '第三潮钟', summary: '岚舟进入钟塔。',
            beats: [{
              beatKey: 'beat.act-3.part-1.scene-01.001', kind: 'narration', speakerKey: null,
              text: '潮水拍击 stone walls。', order: 0,
            }],
          }],
          choices: [], endings: [],
        },
      },
      blockingIssues: [{
        artifactKey: taskKey, repairTaskKeys: [taskKey],
        detail: '玩家可见字段混入未本地化词 walls；位置：scenes[0].beats[0].text',
        recommendation: '保持原意，将外语词改成自然简体中文。',
      }],
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 1,
        detail: '[product-production-executor] 文字冒险玩家可见字段混入未本地化外语:scenes[0].beats[0].text:walls',
      }],
    })
    const directive = textAdventureRepairBaselineDirectiveV1(taskKey, feedback)
    expect(directive).toContain('storyforge.text-adventure-scene-repair-patch-artifact')
    expect(directive).toContain('beat.act-3.part-1.scene-01.001')
    expect(directive).toContain('不得重新提交完整分场工件')
    expect(directive).not.toContain('最后输出完整工件')
  })

  it('分场返修改动冻结 choice 边时只允许重写玩家可见文案', () => {
    const taskKey = 'content.scene-script.act-1.part-1'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-scene-script] choiceCandidates[3] 改写了冻结图骨架',
      }, {
        taskKey: 'content.scene-script.act-2.part-1', code: 'task-executor-failed', attempt: 1,
        detail: '[text-adventure-scene-script] choiceCandidates[1] 改写了冻结图骨架',
      }],
    })
    const directive = textAdventureSceneChoiceGraphRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('每个 choiceKey、sourceNodeKey、targetNodeKey、order 必须与槽位完全相同')
    expect(directive).toContain('只可修订 choice.text、choice.description 与 unavailableReason')
    expect(directive).toContain('不得输出 effectsJson、effects、flag 等额外字段')
    expect(directive).not.toContain('choiceCandidates[1]')
    expect(textAdventureSceneChoiceGraphRetryDirectiveV1(
      taskKey, feedback.replace(taskKey, 'content.scene-script.act-2.part-1'),
    )).toBe('')
  })

  it('对白差量引用未知选择序号时回显本幕冻结 ordinal 闭集', () => {
    const taskKey = 'content.dialogue-pass.act-3'
    const dialogueInputs = JSON.stringify({
      schema: 'storyforge.text-adventure-dialogue-inputs', version: 1, taskKey,
      reviewContract: { reviewedCharacterCount: 3, reviewedBeatCount: 18, reviewedChoiceCount: 3 },
      act: {
        dialogueBeats: [{ beatOrdinal: 1 }, { beatOrdinal: 2 }, { beatOrdinal: 18 }],
        choices: [{ choiceOrdinal: 1 }, { choiceOrdinal: 2 }, { choiceOrdinal: 3 }],
      },
    })
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-dialogue-pass] choiceReviews[0] 引用未知选择序号或 key',
      }],
    })
    const directive = textAdventureDialogueOrdinalRetryDirectiveV1(
      taskKey, `${dialogueInputs}\n\n${feedback}`,
    )
    expect(directive).toContain('choiceReviews[].choiceOrdinal 合法闭集=[1,2,3]')
    expect(directive).toContain('严禁输出 choiceKey、beatKey、数组下标 0')
    expect(directive).toContain('beatReviews[].beatOrdinal 合法闭集=[1,2,18]')
    expect(textAdventureDialogueOrdinalRetryDirectiveV1(taskKey, dialogueInputs))
      .toContain('choiceReviews[].choiceOrdinal 合法闭集=[1,2,3]')
    expect(textAdventureDialogueOrdinalRetryDirectiveV1(
      'content.dialogue-pass.act-2', `${dialogueInputs}\n\n${feedback}`,
    )).toBe('')
    const copiedFeedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 1,
        detail: '[text-adventure-dialogue-pass] beat.act-3.010 与 beat.act-3.011 不得在不同 speakerKey 之间复制对白',
      }],
    })
    expect(textAdventureDialogueOrdinalRetryDirectiveV1(
      taskKey, `${dialogueInputs}\n\n${copiedFeedback}`,
    )).toContain('严禁逐字或实质包含另一 speaker 的整段台词')
  })

  it('评审分数或问题数越界时给出可执行的有界重试约束', () => {
    const taskKey = 'content.adventure-quality-review.act-3'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 1,
        detail: '[text-adventure-production-artifact] qualityReviewBatch.scores.causality 无效',
      }, {
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact] qualityReviewBatch.issues 超出上限',
      }],
    })
    const directive = textAdventureQualityReviewBoundsRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('JSON 整数 1、2、3、4 或 5')
    expect(directive).toContain('issues 必须为 0–20 条')
    expect(directive).toContain('绝不得输出第 21 条')
    expect(textAdventureQualityReviewBoundsRetryDirectiveV1(
      'content.dialogue-pass.act-3', feedback,
    )).toBe('')
  })

  it('补充任务协议失败时限定精确字段和登记 actionKind，不采纳其他任务错误', () => {
    const taskKey = 'content.adventure-side-quests'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact] sideBundle 字段不精确:bundleKind,entries,key,schema,version',
      }, {
        taskKey: 'content.adventure-ambient-events', code: 'task-executor-failed', attempt: 1,
        detail: '[text-adventure-production-artifact] ambient[2].stages[0].actionKind 枚举无效 received="exploration" allowed=inspect,attempt,use,quest-action',
      }],
    })
    const directive = textAdventureQuestBundleContractRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('根对象必须且只能含 schema、version、bundleKind、entries 四个字段')
    expect(directive).toContain('严禁根级 key')
    expect(directive).toContain('根级额外字段=["key"]')
    expect(directive).not.toContain('exploration')
    expect(textAdventureQuestBundleContractRetryDirectiveV1(
      'content.adventure-ambient-events',
      feedback.replace('"content.adventure-side-quests"', '"content.adventure-ambient-events"'),
    )).toContain('inspect、attempt、use、quest-action')
  })

  it('补充任务条目不足时要求先建立 Brief 目标数量的完整骨架', () => {
    const taskKey = 'content.adventure-side-quests'
    const feedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: taskKey,
      lastTaskFailures: [{
        taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[text-adventure-production-artifact] sideBundle 条目少于 Brief 目标:3',
      }],
    })
    const directive = textAdventureQuestBundleContractRetryDirectiveV1(taskKey, feedback)
    expect(directive).toContain('entries 必须恰好包含 3 个完整对象')
    expect(directive).toContain('先一次性建立 3 个互不重复的 entry 骨架')
    expect(directive).toContain('严禁只提交前两条')
  })

  it('分场 beat.kind 枚举失败时只向同任务注入严格路径和四项合法值，修正后由原 parser 验收', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'none', omitWorldArtifacts: true,
      qualityProfile: 'commercial-candidate',
    })
    const briefHash = await hashProductProductionValueV2(owned.brief)
    const plan = await createProductProductionPlanV3({
      buildNumber: 1, briefHash, brief: owned.brief,
    })
    const task = plan.tasks.find(candidate => (
      candidate.taskKey === 'content.scene-script.act-1.part-1'
    ))!
    const outputs = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const validOutput = outputs[task.taskKey]
    const invalidOutput = structuredClone(validOutput) as {
      scenes: Array<{ beats: Array<{ kind: string }> }>
    }
    expect(invalidOutput.scenes[1]?.beats[10]).toBeDefined()
    invalidOutput.scenes[1].beats[10].kind = 'cinematic'
    const systems: string[] = []
    let providerAttempt = 0
    const textRequirement = owned.brief.capabilityRequirements.find(requirement => (
      requirement.mediaClass === 'text'
    ))!
    const bindingHash = await hashProductProductionValueV2({
      provider: 'scene-beat-kind-retry-fixture',
    })
    const runText: ProductionTextRunnerV1 = async request => {
      systems.push(request.system)
      providerAttempt += 1
      return {
        output: JSON.stringify(providerAttempt === 1 ? invalidOutput : validOutput),
        usage: { inputTokens: 400, outputTokens: 2_000 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-long-form',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
          credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const artifact = async (
      artifactKey: string,
      payload: unknown,
    ): Promise<ProductBuildArtifactRecordV1> => ({
      projectId: owned.scope.projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      buildId: 1, artifactKey, requirementKey: null, version: 1,
      kind: 'narrative', mediaKind: null, status: 'accepted', producerRunId: null,
      producerReceiptHash: 'a'.repeat(64), controlEpoch: 0, inputHash: 'b'.repeat(64),
      contentHash: await hashProductProductionValueV2(payload), payloadJson: JSON.stringify(payload),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: JSON.stringify(payload).length,
      parentArtifactHash: null, carriedFrom: null, createdAt: 1, updatedAt: 1,
    })
    const inputArtifacts = await Promise.all(task.inputArtifactKeys.map(async artifactKey => {
      const payload = outputs[artifactKey]
      if (payload == null) throw new Error(`beat.kind retry fixture 缺少 ${artifactKey}`)
      return artifact(artifactKey, payload)
    }))
    const executor = createConfiguredProductProductionExecutorV1({
      production: (await db.productProductions.get(owned.productionId))!,
      brief: owned.brief,
      runText,
    })
    const execution = {
      scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1,
      controlEpoch: 0, planHash: plan.planHash, task, attempt: 1,
      idempotencyKey: 'c'.repeat(64), contextText: '', inputArtifacts,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text.v1', bindingHash,
      }],
      authorResolution: null, signal: new AbortController().signal,
    }
    let firstFailure: Error | null = null
    try {
      await executor(execution)
    } catch (error) {
      firstFailure = error instanceof Error ? error : new Error(String(error))
    }
    expect(firstFailure?.message).toBe(
      '[text-adventure-scene-script] scenes[1].beats[10].kind 枚举无效',
    )
    const exactFailure = firstFailure!.message
    const repairFeedback = JSON.stringify({
      schema: 'storyforge.text-adventure-repair-feedback', version: 1,
      targetTaskKey: task.taskKey,
      instruction: '只处理当前 task 的登记失败证据。',
      blockingIssues: [],
      lastTaskFailures: [{
        taskKey: task.taskKey, code: 'task-executor-failed', attempt: 1,
        detail: `[product-production-executor] ${exactFailure}`,
      }, {
        // Direct executor tests and legacy registered receipts can contain the
        // same deterministic parser message without its fixed outer wrapper.
        taskKey: task.taskKey, code: 'task-executor-failed', attempt: 1,
        detail: exactFailure,
      }, {
        taskKey: task.taskKey, code: 'task-executor-failed', attempt: 1,
        detail: `[任意前缀不得进入系统提示] ${exactFailure}`,
      }, {
        taskKey: task.taskKey, code: 'task-executor-failed', attempt: 1,
        detail: `${exactFailure}；任意错误文本不得进入系统提示`,
      }, {
        taskKey: 'content.scene-script.act-2.part-1', code: 'task-executor-failed', attempt: 1,
        detail: '[product-production-executor] '
          + '[text-adventure-scene-script] scenes[0].beats[2].kind 枚举无效',
      }],
    })
    const accepted = await executor({
      ...execution, attempt: 2, idempotencyKey: 'd'.repeat(64), contextText: repairFeedback,
    })
    expect(providerAttempt).toBe(2)
    expect(systems).toHaveLength(2)
    expect(systems[0]).not.toContain('强制 beat.kind 返修清单=')
    expect(systems[1]).toContain(
      '强制 beat.kind 返修清单=[{"path":"scenes[1].beats[10].kind",'
        + '"allowedKinds":["narration","dialogue","action","system"]}]',
    )
    expect(systems[1]).toContain(
      '合法值必须逐字使用 narration、dialogue、action、system 之一',
    )
    expect(systems[1]).toContain('仍由同一个严格 parser 完整验收')
    expect(systems[1]).not.toContain('scenes[0].beats[2].kind')
    expect(systems[1]).not.toContain('任意前缀不得进入系统提示')
    expect(systems[1]).not.toContain('任意错误文本不得进入系统提示')
    expect(accepted.artifacts[0]).toMatchObject({
      artifactKey: task.taskKey,
      quality: expect.objectContaining({ sceneScriptPartVerified: true }),
    })
    const acceptedOutput = accepted.artifacts[0].payload as {
      scenes: Array<{ beats: Array<{ kind: string }> }>
    }
    expect(acceptedOutput.scenes[1].beats[10].kind).toMatch(
      /^(?:narration|dialogue|action|system)$/,
    )
  }, 30_000)

  it('分场两次 kind 失败经人工恢复后，下一 epoch 首次尝试继承原失败并只新增一次付费调用', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'none', omitWorldArtifacts: true,
    })
    const outputs = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const taskKey = 'content.scene-script.act-1.part-1'
    const validOutput = outputs[taskKey]
    const invalidOutput = structuredClone(validOutput) as {
      scenes: Array<{ beats: Array<{ kind: string }> }>
    }
    expect(invalidOutput.scenes[1]?.beats[2]).toBeDefined()
    invalidOutput.scenes[1].beats[2].kind = 'cinematic'
    const exactFailure = '[text-adventure-scene-script] scenes[1].beats[2].kind 枚举无效'
    const textRequirement = owned.brief.capabilityRequirements.find(requirement => (
      requirement.mediaClass === 'text'
    ))!
    const bindingHash = await hashProductProductionValueV2({
      provider: 'cross-epoch-scene-kind-repair-fixture',
    })
    const targetContexts: string[] = []
    const targetSystems: string[] = []
    let targetProviderCalls = 0
    const runText: ProductionTextRunnerV1 = async request => {
      const currentTaskKey = Object.keys(outputs).find(key => (
        request.system.includes(`任务=${key}。`)
      ))
      if (!currentTaskKey) throw new Error(`unknown cross-epoch repair task:${request.system}`)
      if (currentTaskKey === taskKey) {
        targetProviderCalls += 1
        targetContexts.push(request.contextText)
        targetSystems.push(request.system)
      }
      return {
        output: JSON.stringify(
          currentTaskKey === taskKey && targetProviderCalls <= 2
            ? invalidOutput
            : outputs[currentTaskKey],
        ),
        usage: { inputTokens: 400, outputTokens: 2_000 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-long-form',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
          credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text.v1', bindingHash,
    }]
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(blocked).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(
      targetProviderCalls,
      `pre-repair failure=${(await db.productBuilds.get(blocked.buildId))?.failureJson}`,
    ).toBe(2)
    expect(targetSystems).toHaveLength(2)
    expect(targetSystems[0]).not.toContain('强制 beat.kind 返修清单=')
    expect(targetSystems[1]).toContain(
      '强制 beat.kind 返修清单=[{"path":"scenes[1].beats[2].kind",'
        + '"allowedKinds":["narration","dialogue","action","system"]}]',
    )
    const blockedBuild = (await db.productBuilds.get(blocked.buildId))!
    const blockedFailure = JSON.parse(blockedBuild.failureJson) as {
      taskKey: string
      detail: string
      attempt: number
    }
    expect(blockedFailure).toMatchObject({
      taskKey, detail: exactFailure, attempt: 2,
    })
    const blockedLedger = JSON.parse(blockedBuild.budgetLedgerJson) as {
      attempts: Array<{
        controlEpoch: number
        taskKey: string
        attempt: number
        outcome: 'settled' | 'failed'
        usageKnown: boolean
        usage: { modelCalls: number } | null
      }>
    }
    expect(blockedLedger.attempts.filter(attempt => attempt.taskKey === taskKey)).toEqual([
      expect.objectContaining({
        controlEpoch: blocked.controlEpoch, attempt: 1, outcome: 'failed',
        usageKnown: true, usage: expect.objectContaining({ modelCalls: 1 }),
      }),
      expect.objectContaining({
        controlEpoch: blocked.controlEpoch, attempt: 2, outcome: 'failed',
        usageKnown: true, usage: expect.objectContaining({ modelCalls: 1 }),
      }),
    ])

    const blockedProduction = (await db.productProductions.get(owned.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'scene-kind.cross-epoch.retry',
        expectedStateRevision: blockedProduction.stateRevision,
        blockerKey: taskKey,
        resolution: { action: 'retry', note: '保持原分场失败证据并精确修正 beat.kind。' },
      },
    })
    expect(resolved.result.controlEpoch).toBe(blocked.controlEpoch + 1)
    const resumed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(
      resumed,
      `cross-epoch scene repair projection=${JSON.stringify(resumed)} failure=${(await db.productBuilds.get(blocked.buildId))?.failureJson}`,
    ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(targetProviderCalls).toBe(3)
    expect(targetContexts).toHaveLength(3)
    const resumedFeedbackSegment = targetContexts[2].split(/\n\s*\n/g).find(segment => (
      segment.includes('storyforge.text-adventure-repair-feedback')
    ))
    expect(resumedFeedbackSegment).toBeDefined()
    expect(JSON.parse(resumedFeedbackSegment!)).toMatchObject({
      targetTaskKey: taskKey,
      lastTaskFailures: [expect.objectContaining({
        taskKey, attempt: 2, detail: exactFailure,
      })],
    })
    expect(targetSystems[2]).toContain(
      '强制 beat.kind 返修清单=[{"path":"scenes[1].beats[2].kind",'
        + '"allowedKinds":["narration","dialogue","action","system"]}]',
    )
    const resumedBuild = (await db.productBuilds.get(resumed.buildId))!
    const resumedLedger = JSON.parse(resumedBuild.budgetLedgerJson) as {
      attempts: Array<{
        controlEpoch: number
        taskKey: string
        attempt: number
        outcome: 'settled' | 'failed'
        usageKnown: boolean
        usage: { modelCalls: number } | null
      }>
    }
    expect(resumedLedger.attempts.filter(attempt => attempt.taskKey === taskKey)).toEqual([
      expect.objectContaining({
        controlEpoch: blocked.controlEpoch, attempt: 1, outcome: 'failed',
        usageKnown: true, usage: expect.objectContaining({ modelCalls: 1 }),
      }),
      expect.objectContaining({
        controlEpoch: blocked.controlEpoch, attempt: 2, outcome: 'failed',
        usageKnown: true, usage: expect.objectContaining({ modelCalls: 1 }),
      }),
      expect.objectContaining({
        controlEpoch: resumed.controlEpoch, attempt: 1, outcome: 'settled',
        usageKnown: true, usage: expect.objectContaining({ modelCalls: 1 }),
      }),
    ])
  }, 45_000)

  it('act-2 越界审查由确定性 owning 闭集直接丢弃，不阻塞 Build 或重复付费调用', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'none', omitWorldArtifacts: true,
      maximumModelCalls: 120,
    })
    const outputs = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const taskKey = 'content.adventure-quality-review.act-2'
    const textRequirement = owned.brief.capabilityRequirements.find(requirement => (
      requirement.mediaClass === 'text'
    ))!
    const bindingHash = await hashProductProductionValueV2({
      provider: 'cross-epoch-quality-ownership-repair-fixture',
    })
    const targetContexts: string[] = []
    const targetSystems: string[] = []
    let targetProviderCalls = 0
    const runText: ProductionTextRunnerV1 = async request => {
      const currentTaskKey = Object.keys(outputs).find(key => (
        request.system.includes(`任务=${key}。`)
      ))
      if (!currentTaskKey) throw new Error(`unknown cross-epoch quality task:${request.system}`)
      let output = outputs[currentTaskKey]
      if (currentTaskKey === taskKey) {
        targetProviderCalls += 1
        targetContexts.push(request.contextText)
        targetSystems.push(request.system)
        if (targetProviderCalls === 1) {
          const qualitySegment = request.contextText.split(/\n\s*\n/g).find(segment => (
            segment.includes('storyforge.text-adventure-quality-inputs')
          ))
          if (!qualitySegment) throw new Error('missing act-2 quality inputs')
          const qualityInputs = JSON.parse(qualitySegment) as {
            reviewScope: { sceneKeys: string[]; choiceKeys: string[]; endingKeys: string[] }
          }
          expect(qualityInputs.reviewScope.choiceKeys).not.toContain('choice.015')
          expect(qualityInputs.reviewScope.choiceKeys).not.toContain('choice.016')
          expect(qualityInputs.reviewScope.endingKeys).toEqual([])
          const ownedSceneKey = qualityInputs.reviewScope.sceneKeys[0]
          if (!ownedSceneKey) throw new Error('missing act-2 owned scene')
          output = {
            schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
            scope: 'act-2',
            scores: {
              causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
              characterMotivation: 4, emotionalImpact: 4,
            },
            issues: [{
              severity: 'blocking', artifactKey: 'content.narrative',
              detail: '[owningKey=choice.015] choice.015 与 choice.016 的后续回响不足。',
              recommendation: '重写 choice.015、choice.016。',
            }, {
              severity: 'blocking', artifactKey: 'content.narrative',
              detail: `[owningKey=${ownedSceneKey}] ${ownedSceneKey} 的结果在 ending.001 未回收。`,
              recommendation: '修改 ending.001 的结局正文。',
            }],
          }
        }
      }
      return {
        output: JSON.stringify(output),
        usage: { inputTokens: 400, outputTokens: 2_000 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-long-form',
          endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
          credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text.v1', bindingHash,
    }]
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: owned.brief, runText,
      }),
      capabilityBindings,
    })
    expect(completed).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(targetProviderCalls).toBe(1)
    expect(targetSystems).toHaveLength(1)
    expect(targetSystems[0]).toContain('reviewScope 的 sceneKeys、endingKeys、choiceKeys')
    expect(targetSystems[0]).toContain('endingKeys 为空时，不得要求修改任何 ending')
    expect(targetContexts).toHaveLength(1)
    const batch = await db.productBuildArtifacts
      .where('[buildId+artifactKey]')
      .equals([completed.buildId, 'quality.adventure-review.act-2'])
      .first()
    expect(batch).toMatchObject({ status: 'accepted' })
    expect(JSON.parse(batch!.payloadJson)).toMatchObject({ passed: true, issues: [] })
    expect(JSON.parse(batch!.qualityJson)).toMatchObject({
      reviewBatchContractVerified: true,
      discardedReferenceIssueCount: 0,
      discardedCoverageIssueCount: 2,
      blockingIssueCount: 0,
    })
    const completedBuild = (await db.productBuilds.get(completed.buildId))!
    const completedLedger = JSON.parse(completedBuild.budgetLedgerJson) as {
      attempts: Array<{ taskKey: string; outcome: string; usage: { modelCalls: number } | null }>
    }
    expect(completedLedger.attempts.filter(attempt => attempt.taskKey === taskKey)).toEqual([
      expect.objectContaining({
        outcome: 'settled', usage: expect.objectContaining({ modelCalls: 1 }),
      }),
    ])
  }, 60_000)

  it('60 分钟文字冒险按 Brief 产出足量主线、空间、支线、区域事件并通过内容量硬门', async () => {
    const owned = await fixtureForProduct('text-adventure', {
      scale: 'short-arc', visualLevel: 'none', omitWorldArtifacts: true,
    })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = await hashProductProductionValueV2({ provider: 'full-length-text-adventure' })
    const outputs = fullLengthTextAdventureOutputs(owned.brief) as Record<string, unknown>
    const sceneScriptSystems: string[] = []
    const sceneScriptContexts: string[] = []
    let narrativeArcSystem = ''
    let narrativeDecisionSystem = ''
    let endingRouteSystem = ''
    let mainQuestSystem = ''
    let productModuleSystem = ''
    let sideQuestSystem = ''
    let questScriptSystem = ''
    const dialoguePassSystems: string[] = []
    const dialoguePassContexts: string[] = []
    const qualityReviewSystems = new Map<string, string[]>()
    const qualityReviewContexts = new Map<string, string[]>()
    let playtestSystem = ''
    let playtestContext = ''
    let modelCallCount = 0
    const qualityReviewAttempts = new Map<string, number>()
    let ambientEventAttempt = 0
    const ambientEventSystems: string[] = []
    const ambientEventContexts: string[] = []
    let sceneLocalizationAttempt = 0
    const sceneLocalizationSystems: string[] = []
    const sceneLocalizationContexts: string[] = []
    const invalidSceneOutput = structuredClone(outputs['content.scene-script.act-1.part-1']) as {
      scenes: Array<{ beats: Array<{ text: string }> }>
    }
    invalidSceneOutput.scenes[0].beats[0].text += ' vessels'
    invalidSceneOutput.scenes[1].beats[7].text += ' seal'
    const invalidAmbientOutput = structuredClone(outputs['content.adventure-ambient-events']) as {
      entries: Array<{ stages: Array<{ successText: string }> }>
    }
    invalidAmbientOutput.entries[2].stages[0].successText += ' descended'
    const runText: ProductionTextRunnerV1 = async request => {
      modelCallCount += 1
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`))
      if (!taskKey) throw new Error(`unknown full-length task:${request.system}`)
      if (taskKey.startsWith('content.scene-script.act-')) {
        sceneScriptSystems.push(request.system)
        sceneScriptContexts.push(request.contextText)
      }
      if (taskKey === 'content.scene-script.act-1.part-1') {
        sceneLocalizationAttempt += 1
        sceneLocalizationSystems.push(request.system)
        sceneLocalizationContexts.push(request.contextText)
      }
      if (taskKey === 'content.narrative-arc-scenes') narrativeArcSystem = request.system
      if (taskKey === 'content.narrative-decision-plan') narrativeDecisionSystem = request.system
      if (taskKey === 'content.ending-route-plan') endingRouteSystem = request.system
      if (taskKey === 'content.main-quest-plan') mainQuestSystem = request.system
      if (taskKey === 'content.product-module') productModuleSystem = request.system
      if (taskKey === 'content.adventure-side-quests') sideQuestSystem = request.system
      if (taskKey === 'content.adventure-ambient-events') {
        ambientEventAttempt += 1
        ambientEventSystems.push(request.system)
        ambientEventContexts.push(request.contextText)
      }
      if (taskKey.startsWith('content.quest-script.')) questScriptSystem += request.system
      if (taskKey.startsWith('content.dialogue-pass.act-')) {
        dialoguePassSystems.push(request.system)
        dialoguePassContexts.push(request.contextText)
      }
      if (/^content\.adventure-quality-review\.(?:structure|act-[123])$/.test(taskKey)) {
        qualityReviewAttempts.set(taskKey, (qualityReviewAttempts.get(taskKey) ?? 0) + 1)
        qualityReviewSystems.set(taskKey, [
          ...(qualityReviewSystems.get(taskKey) ?? []), request.system,
        ])
        qualityReviewContexts.set(taskKey, [
          ...(qualityReviewContexts.get(taskKey) ?? []), request.contextText,
        ])
      }
      if (taskKey === 'qa.playtest-strategy') {
        playtestSystem = request.system
        playtestContext = request.contextText
      }
      const output = taskKey === 'content.adventure-quality-review.structure'
        && qualityReviewAttempts.get(taskKey) === 1
        ? {
            schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
            scope: 'structure',
            scores: {
              causality: 4, routeDifferentiation: 4, setupPayoff: 4,
              characterMotivation: 4,
            },
            issues: [{
              severity: 'blocking', artifactKey: 'content.adventure-architecture',
              detail: '跨幕主要转折缺少因果铺垫。',
              recommendation: '补充前置场景与可见状态回响。',
            }],
            passed: false,
          }
        : taskKey === 'content.adventure-quality-review.act-1'
          && qualityReviewAttempts.get(taskKey) === 1
          ? {
              schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
              scope: 'act-1',
              scores: {
                causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
                characterMotivation: 4, emotionalImpact: 4,
              },
              issues: [{
                severity: 'blocking',
                artifactKey: 'content.adventure-side-quests',
                detail: '[owningKey=side-3.stage-1] side-3 的 side-3.stage-1 缺少失败推进。',
                recommendation: '改写 side-3.stage-1 的 failureText。',
              }],
            }
        : taskKey === 'content.adventure-quality-review.act-2'
          && qualityReviewAttempts.get(taskKey) === 1
          ? (() => {
              const segment = request.contextText.split('\n\n').find(value => (
                value.includes('storyforge.text-adventure-quality-inputs')
              ))
              if (!segment) throw new Error('missing act-2 quality projection')
              const packet = JSON.parse(segment) as {
                reviewScope: { sceneKeys: string[] }
                narrative: { choices: Array<{ key: string; sourceNodeKey: string; targetNodeKey: string }> }
              }
              const [firstChoice, secondChoice] = packet.narrative.choices
              const wrongTarget = packet.reviewScope.sceneKeys.find(key => (
                key !== secondChoice?.targetNodeKey
              ))
              if (!firstChoice || !secondChoice || !wrongTarget) {
                throw new Error('missing act-2 invalid reference fixture')
              }
              return {
                schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
                scope: 'act-2',
                scores: {
                  causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
                  characterMotivation: 4, emotionalImpact: 4,
                },
                issues: [{
                  severity: 'blocking', artifactKey: 'content.narrative',
                  detail: `[owningKey=${firstChoice.key}] ${firstChoice.key} 的 sourceNodeKey=${firstChoice.sourceNodeKey}、targetNodeKey=${firstChoice.targetNodeKey}；`
                    + `${secondChoice.key} 的 sourceNodeKey=${secondChoice.sourceNodeKey}、targetNodeKey=${wrongTarget}。`,
                  recommendation: '保持第一条冻结边，根据真实冻结关系重新判断第二条选择。',
                }, {
                  severity: 'blocking', artifactKey: 'content.narrative',
                  detail: `[owningKey=${firstChoice.key}] ${firstChoice.sourceNodeKey} 缺少通往 ${firstChoice.targetNodeKey} 的出边选择。`,
                  recommendation: `为 ${firstChoice.sourceNodeKey} 新增通往 ${firstChoice.targetNodeKey} 的选择。`,
                }],
              }
            })()
        : taskKey === 'content.adventure-quality-review.act-3'
          && qualityReviewAttempts.get(taskKey) === 1
          ? (() => {
              const segment = request.contextText.split('\n\n').find(value => (
                value.includes('storyforge.text-adventure-quality-inputs')
              ))
              if (!segment) throw new Error('missing act-3 quality projection')
              const packet = JSON.parse(segment) as {
                mainQuestPlan: Array<{
                  objectives: Array<{
                    key: string
                    sceneKeys: string[]
                    alternatives: Array<{ key: string }>
                  }>
                }>
              }
              const objective = packet.mainQuestPlan.flatMap(quest => quest.objectives)[0]
              const alternative = objective?.alternatives[0]
              if (!objective || !alternative || !objective.sceneKeys[0]) {
                throw new Error('missing act-3 objective authority fixture')
              }
              return {
                schema: 'storyforge.text-adventure-quality-review-batch-artifact', version: 1,
                scope: 'act-3',
                scores: {
                  causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
                  characterMotivation: 4, emotionalImpact: 4,
                },
                issues: [{
                  severity: 'blocking', artifactKey: 'content.main-quest-plan',
                  detail: `[owningKey=${alternative.key}] ${alternative.key}.sceneKey 与父目标 ${objective.key} 的场景不一致。`,
                  recommendation: `将 ${alternative.key}.sceneKey 调整为 ${objective.sceneKeys[0]}。`,
                }],
              }
            })()
        : taskKey === 'content.scene-script.act-1.part-1' && sceneLocalizationAttempt === 1
          ? invalidSceneOutput
        : taskKey === 'content.adventure-ambient-events' && ambientEventAttempt === 1
          ? invalidAmbientOutput
          : outputs[taskKey]
      const outputTokens = taskKey === 'content.adventure-side-quests'
        ? 7_457
        : taskKey === 'content.adventure-ambient-events' && ambientEventAttempt === 1
          ? 1_703
          : 2_000
      return {
        output: JSON.stringify(output), usage: { inputTokens: 400, outputTokens },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-long-form', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      }
    }
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    const projectedBuild = await db.productBuilds.get(projection.buildId)
    expect(
      projection,
      `full-length text-adventure projection:\n${JSON.stringify(projection, null, 2)}\nfailure=${projectedBuild?.failureJson}`,
    ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(sceneScriptSystems).toHaveLength(7)
    const actOneSceneSystem = sceneScriptSystems.find(system => (
      system.includes('任务=content.scene-script.act-1.part-1')
    ))
    const actThreeSceneSystem = sceneScriptSystems.find(system => (
      system.includes('任务=content.scene-script.act-3.part-2')
    ))
    expect(actOneSceneSystem).toContain('你是第 1 幕的专职分场叙事作者')
    expect(actOneSceneSystem).toContain(
      'scenes 必须恰好输出 2 项，并按顺序逐字覆盖 ["scene.001","scene.002"]',
    )
    expect(actOneSceneSystem).toContain('禁止只写前面部分就提交')
    expect(actOneSceneSystem).toContain('"sceneKey":"scene.001","locationTitle":"地点 1-1-1"')
    expect(actOneSceneSystem).toContain('"sceneKey":"scene.001","beats0MustStartWith":"地点 1-1-1"')
    expect(actOneSceneSystem).toContain('beats[0] 必须是 narration、speakerKey=null')
    expect(actOneSceneSystem).toContain('text 的第一个字开始逐字复制 beats0MustStartWith')
    expect(actOneSceneSystem).toContain('一律不得改写')
    expect(actOneSceneSystem).toContain('每个 locationTitle 必须至少一次逐字出现在对应 scene')
    expect(actOneSceneSystem).toContain('简称不能证明场景已经落实到冻结地点')
    expect(actOneSceneSystem).toContain('choices 只能作为根对象的数组')
    expect(actOneSceneSystem).toContain('禁止填写角色姓名、称谓、narrator、空字符串或 null')
    expect(actOneSceneSystem).toContain('必须使用 kind=narration 且 speakerKey=null')
    expect(actOneSceneSystem).toContain('凡出现三个或更多连续拉丁字母')
    expect(actOneSceneSystem).toContain('sealed、selectively、descended')
    expect(actOneSceneSystem).toContain('scenes.length 必须精确等于')
    expect(sceneLocalizationAttempt).toBe(2)
    expect(sceneLocalizationSystems).toHaveLength(2)
    expect(sceneLocalizationSystems[0]).not.toContain('强制返修清单=')
    expect(sceneLocalizationSystems[1]).toContain(
      '强制返修清单=[{"path":"scenes[0].beats[0].text","tokens":["vessels"]},{"path":"scenes[1].beats[7].text","tokens":["seal"]}]',
    )
    expect(sceneLocalizationSystems[1]).toContain('任何匹配 [A-Za-z]{3,} 的 ASCII 词都必须本地化')
    expect(sceneLocalizationSystems[1]).not.toContain('entries[2].stages[0].successText')
    const sceneRetryFeedbackSegment = sceneLocalizationContexts[1].split('\n\n').find(segment => (
      segment.includes('storyforge.text-adventure-repair-feedback')
    ))
    expect(sceneRetryFeedbackSegment).toBeDefined()
    const sceneRetryFeedback = JSON.parse(sceneRetryFeedbackSegment!) as {
      lastTaskFailures: Array<{ taskKey: string; detail: string }>
    }
    expect(sceneRetryFeedback.lastTaskFailures).toContainEqual({
      taskKey: 'content.scene-script.act-1.part-1', code: 'task-executor-failed', attempt: 1,
      controlEpoch: 0,
      detail: '[product-production-executor] '
        + '文字冒险玩家可见字段混入未本地化外语:'
        + 'scenes[0].beats[0].text:vessels；scenes[1].beats[7].text:seal',
    })
    expect(actThreeSceneSystem).toContain('"endings":["ending.001","ending.002","ending.003"]')
    expect(actThreeSceneSystem).toContain('终幕冻结结局后果逐字清单=')
    expect(actThreeSceneSystem).toContain(
      '"endingKey":"ending.001","title":"潮声之后 1","requiredConsequences":["承认选择 1 的代价","兑现人物关系 1 的变化"]',
    )
    expect(actThreeSceneSystem).toContain('这是验收合同而非参考资料')
    expect(actThreeSceneSystem).toContain('禁止改写、缩写、概括、移到其他 ending 或只兑现清单前几项')
    expect(actThreeSceneSystem).toContain('每一项 requiredConsequences 必须各自新增为一个独立的 kind=system')
    expect(actThreeSceneSystem).toContain('自然叙事与角色反应另写 narration/dialogue beat')
    expect(narrativeArcSystem).toContain('场景与地点的冻结映射=')
    expect(narrativeArcSystem).toContain('"sceneKey":"scene.001","locationOrdinal":1,"locationTitle":"地点 1-1-1"')
    expect(narrativeArcSystem).toContain('合法角色 key 白名单=["character.player","character.npc.1"')
    expect(narrativeArcSystem).toContain('严禁填写角色姓名、称谓、英文转写、角色类型或自造 key')
    expect(narrativeArcSystem).toContain('合法铺垫回收 key 白名单=["setup.warning-bell","setup.copper-mark"]')
    expect(narrativeArcSystem).toContain('setupKeys/payoffKeys 只能逐字来自这个数组')
    expect(narrativeDecisionSystem).toContain('你是同一位叙事设计师的决定设计 Run')
    expect(narrativeDecisionSystem).toContain('"decisionKey":"decision.1","sceneKey":"scene.001"')
    expect(narrativeDecisionSystem).toContain('"optionKeys":["option.1.1","option.1.2"]')
    const frozenDecisionSceneKeys = textAdventureNarrativeSkeletonV1(owned.brief)
      .statefulDecisionSceneKeys
    expect(frozenDecisionSceneKeys).toEqual(['scene.001', 'scene.009'])
    expect(narrativeDecisionSystem).toContain('"decisionKey":"decision.2","sceneKey":"scene.009"')
    expect(narrativeDecisionSystem).not.toContain('"decisionKey":"decision.2","sceneKey":"scene.002"')
    expect(endingRouteSystem).toContain('必须选择恰好 2 个彼此不同的二选一决定')
    expect(endingRouteSystem).toContain('"requiredAbstractEffects":["D1.B"]')
    expect(endingRouteSystem).toContain('"requiredAbstractEffects":["D1.A","D2.B"]')
    expect(endingRouteSystem).toContain('"requiredAbstractEffects":["D1.A","D2.A"]')
    expect(endingRouteSystem).toContain('若某条路线的 requiredEffectKeys 是另一条路线的真子集')
    expect(mainQuestSystem).toContain('场景的冻结地点与出场角色约束=')
    expect(mainQuestSystem).toContain('characterKeys 将由系统确定性投影')
    expect(mainQuestSystem).toContain('quests[0] 必须同时包含 key/title/description/characterKeys/stages/objectives')
    expect(mainQuestSystem).toContain('每个主线 objective.sceneKeys 必须恰好包含一个场景 key')
    expect(mainQuestSystem).toContain('locationOrdinal 必须复制所引用场景共同绑定的地点编号')
    expect(mainQuestSystem).toContain('stage 及其 objectiveKeys 必须按场景约束数组中的 sceneKey 顺序单调推进')
    expect(mainQuestSystem).toContain('nonPlayerCastKeys 是 talk 目标的唯一白名单')
    expect(mainQuestSystem).toContain('"nonPlayerCastKeys"')
    expect(mainQuestSystem).toContain('successConsequence 和 failureForwardConsequence 是玩家会直接读到的自然语言叙事')
    expect(mainQuestSystem).toContain('机器状态只能放入 persistentEffectKeys')
    expect(mainQuestSystem).toContain('alternatives 的数量也是冻结拓扑，不是建议')
    expect(mainQuestSystem).toContain('根对象只能包含 schema、version、bundleKind、quests 四个字段')
    expect(mainQuestSystem).toContain('requiredActionKinds 和 nonPlayerCastKeys 只是冻结输入约束')
    expect(mainQuestSystem).toContain('总数恰好')
    expect(sceneScriptContexts).toHaveLength(7)
    const actOneSceneContext = sceneScriptContexts.find(context => (
      context.includes('"taskKey":"content.scene-script.act-1.part-1"')
    ))
    expect(actOneSceneContext).toContain('storyforge.text-adventure-scene-script-inputs')
    expect(actOneSceneContext).not.toContain('storyforge.product-production.artifact-inputs')
    expect(actOneSceneContext).not.toContain('"key":"scene.012"')
    expect(sideQuestSystem).toContain('地点编号与标题的唯一映射=')
    expect(sideQuestSystem).toContain('"locationOrdinal":1,"locationTitle":"地点 1-1-1"')
    expect(sideQuestSystem).toContain('每条支线必须包含 2–4 个有因果顺序的实质阶段')
    expect(sideQuestSystem).toContain('不能把“接取任务”充当模型阶段')
    expect(sideQuestSystem).toContain('每个 stage 的 title、objective、successText、costlySuccessText、failureText')
    expect(sideQuestSystem).toContain('title 与 objective 合并后必须且只能出现这一个登记地点标题')
    expect(sideQuestSystem).toContain('跨地点线索只能写进 successText、costlySuccessText 或 failureText')
    expect(sideQuestSystem).toContain('abilityKey 只能逐字使用这些上游已登记能力=')
    expect(sideQuestSystem).toContain('"ability.perception"')
    expect(questScriptSystem).toContain('上游已冻结的脚本身份与顺序=')
    expect(questScriptSystem).toContain('不得重新命名、翻译、合并阶段、重设补充任务数值')
    expect(questScriptSystem).toContain('check.resolution.abilityKey 只能逐字使用')
    expect(questScriptSystem).toContain('"ability.perception"')
    expect(questScriptSystem).toContain('补充任务的失败推进字段名也是 failureForwardText')
    expect(questScriptSystem).toContain('"failureForwardText":"..."')
    expect(questScriptSystem).toContain('sideQuestScripts 恰好 3 项')
    expect(questScriptSystem).toContain('ambientEventScripts 恰好 4 项')
    expect(questScriptSystem).toContain('本 Run 每个主线目标的玩家可见结算锚点=')
    expect(questScriptSystem).toContain('objectiveTitle')
    expect(questScriptSystem).toContain('locationTitle')
    expect(questScriptSystem).toContain('逐字包含该 objectiveTitle 和 locationTitle')
    expect(dialoguePassSystems).toHaveLength(3)
    expect(dialoguePassSystems[0]).toContain('独立对白编辑，不是分场作者')
    expect(dialoguePassSystems[0]).toContain('使用序号差量协议')
    expect(dialoguePassSystems[0]).toContain('reviewedBeatCount')
    expect(dialoguePassSystems[0]).toContain('禁止回显 keep 项的原文')
    expect(dialoguePassContexts).toHaveLength(3)
    const firstActDialogueContext = dialoguePassContexts.find(context => (
      context.includes('"taskKey":"content.dialogue-pass.act-1"')
    ))!
    expect(firstActDialogueContext).toContain('storyforge.text-adventure-dialogue-inputs')
    expect(firstActDialogueContext).not.toContain('storyforge.product-production.artifact-inputs')
    expect(productModuleSystem).toContain('clock 表示开局后累计经过的分钟数')
    expect(productModuleSystem).toContain('initial 和 minimum 必须同时为 0')
    expect(qualityReviewAttempts).toEqual(new Map([
      ['content.adventure-quality-review.structure', 1],
      ['content.adventure-quality-review.act-1', 1],
      ['content.adventure-quality-review.act-2', 1],
      ['content.adventure-quality-review.act-3', 1],
    ]))
    const structureSystem = qualityReviewSystems
      .get('content.adventure-quality-review.structure')?.at(-1) ?? ''
    const firstActQualitySystem = qualityReviewSystems
      .get('content.adventure-quality-review.act-1')?.at(-1) ?? ''
    const thirdActQualitySystem = qualityReviewSystems
      .get('content.adventure-quality-review.act-3')?.at(-1) ?? ''
    expect(structureSystem).toContain('你是跨幕结构审校')
    expect(structureSystem).toContain(
      '固定维度=["causality","routeDifferentiation","setupPayoff","characterMotivation"]',
    )
    expect(structureSystem).toContain('storyforge.text-adventure-quality-review-batch-artifact')
    expect(structureSystem).toContain('提示注入或安全策略不是叙事 Artifact 缺陷')
    expect(structureSystem).toContain(
      'structure 的每条 issue.detail 必须以“[owningKey=完整稳定键]”开头',
    )
    expect(structureSystem).not.toContain('你是 StoryForge')
    expect(firstActQualitySystem).toContain('你是第 1 幕内容审校')
    expect(firstActQualitySystem).toContain('本幕玩家可见正文、对白、选择')
    expect(firstActQualitySystem).toContain('scores 必须且只能含这些 key')
    expect(firstActQualitySystem).toContain('一个 issue 只能描述一个待修改 owner')
    expect(firstActQualitySystem).toContain(
      '父 objective 拥有 sceneKeys 与 locationOrdinal',
    )
    expect(firstActQualitySystem).toContain('alternative 只拥有 key、actionKind、targetCharacterKey')
    expect(firstActQualitySystem).toContain('绝不拥有 sceneKey 或 locationOrdinal')
    expect(firstActQualitySystem).toContain(
      'questScript.mainObjectives[].sceneKey 属于目标脚本包装层',
    )
    expect(firstActQualitySystem).toContain(
      'boundaryNodeKeys 只能作为已拥有 choice/decision 的只读衔接证据',
    )
    expect(firstActQualitySystem).toContain('多个连续 scene 可以合法复用地点')
    expect(firstActQualitySystem).toContain('availableConditionJson={} 表示无条件可用')
    expect(firstActQualitySystem).toContain('局部分支汇流＋持久状态差异')
    expect(firstActQualitySystem).toContain('只凭 targetNodeKey 相同不得扣分')
    expect(firstActQualitySystem).toContain('graphFacts 是由已验收 content.narrative 和运行编译规则确定性投影的只读权威')
    expect(firstActQualitySystem).toContain('decisionChoiceBindings 是编译器按冻结顺序应用的 option→choice 精确绑定')
    expect(firstActQualitySystem).toContain(
      'narrative.choices[].label 是已采纳 content.narrative choice.text 的只读压缩投影别名',
    )
    expect(firstActQualitySystem).toContain('detail 可写 choice.some-key.label')
    expect(firstActQualitySystem).toContain('不得仅因 unavailableReason 字段存在就报告死锁')
    expect(firstActQualitySystem).toContain('每条 issue.detail 必须以“[owningKey=完整稳定键]”开头')
    expect(firstActQualitySystem).toContain('删除无效 issue 后应只依据剩余可定位证据重新评分')
    expect(thirdActQualitySystem).toContain('alternative 只拥有 key、actionKind、targetCharacterKey')
    expect(thirdActQualitySystem).toContain('绝不拥有 sceneKey 或 locationOrdinal')
    expect(thirdActQualitySystem).toContain('输出前必须逐条自检 issues')
    const qualityBatchEvidence = new Map((await db.productBuildArtifacts
      .where('buildId').equals(projection.buildId).toArray())
      .filter(row => row.artifactKey.startsWith('quality.adventure-review.'))
      .map(row => [row.artifactKey, JSON.parse(row.qualityJson) as Record<string, unknown>]))
    expect(qualityBatchEvidence.get('quality.adventure-review.structure'))
      .toMatchObject({ discardedCoverageIssueCount: 1, blockingIssueCount: 0 })
    expect(qualityBatchEvidence.get('quality.adventure-review.act-1'))
      .toMatchObject({ discardedCoverageIssueCount: 1, blockingIssueCount: 0 })
    expect(qualityBatchEvidence.get('quality.adventure-review.act-2'))
      .toMatchObject({
        discardedReferenceIssueCount: 1, discardedFactualIssueCount: 1, blockingIssueCount: 0,
        discardedFactualClaims: [{
          artifactKey: 'content.narrative',
          owningKey: expect.stringMatching(/^choice\./),
          reason: expect.stringContaining('冻结出边实际存在'),
        }],
      })
    const qualityProjection = (taskKey: string) => {
      const context = qualityReviewContexts.get(taskKey)?.at(-1) ?? ''
      expect(context).toContain('storyforge.text-adventure-quality-inputs')
      expect(context).not.toContain('该上下文源已按预算截断')
      const segment = context.split('\n\n').find(value => (
        value.includes('storyforge.text-adventure-quality-inputs')
      ))!
      return JSON.parse(segment) as {
        version: number
        reviewScope: {
          scope: string
          applicableScoreKeys: string[]
          sceneKeys: string[]
          endingKeys: string[]
          boundaryNodeKeys: string[]
          choiceKeys: string[]
          decisionKeys: string[]
          optionKeys: string[]
          alternativeKeys: string[]
          sideQuestKeys: string[]
          ambientEventKeys: string[]
          supplementalStageKeys: string[]
          supplementalAssignmentRule: string
        }
        globalStorySpine: {
          setupPayoffs: unknown[]
          endings: Array<{ key?: string; requiredConsequences?: string[] }>
        }
        graphFacts: {
          authority: string
          entryNodeKey: string
          reachableNodeKeys: string[]
          incomingChoiceKeysByNodeKey: Record<string, string[]>
          outgoingChoiceKeysByNodeKey: Record<string, string[]>
        }
        arcPlan: {
          acts: Array<{ key: string; sceneCards: Array<{ key: string }> }>
          endings: Array<{ endingKey: string }>
        }
        dialoguePass: null | {
          actKey: string
          reviewCoverage: {
            reviewedBeatCount: number
            revisedBeatCount: number
            reviewedChoiceCount: number
            revisedChoiceCount: number
          }
          flaggedBeatReviews: Array<{ beatKey: string }>
          flaggedChoiceReviews: Array<{ choiceKey: string }>
        }
        narrative: {
          beatColumns: string[]
          nodes: Array<{ key: string; projection: string; beats: Array<[string, number, string, string | null, string]> }>
          choices: Array<{
            key: string
            unavailableReason: string
            displayConditionJson: string
            availableConditionJson: string
            effectsJson: string
          }>
        }
        supplementalContent: Record<string, unknown>
      }
    }
    const structureProjection = qualityProjection('content.adventure-quality-review.structure')
    expect(structureProjection).toMatchObject({
      version: 3,
      reviewScope: {
        scope: 'structure',
        applicableScoreKeys: [
          'causality', 'routeDifferentiation', 'setupPayoff', 'characterMotivation',
        ],
        sceneKeys: textAdventureNarrativeSkeletonV1(owned.brief).sceneKeys,
        sideQuestKeys: ['side-1', 'side-2', 'side-3'],
        ambientEventKeys: ['ambient-1', 'ambient-2', 'ambient-3', 'ambient-4'],
      },
      dialoguePass: null,
    })
    expect(structureProjection.reviewScope.choiceKeys.length).toBeGreaterThan(0)
    expect(structureProjection.graphFacts).toMatchObject({
      authority: 'accepted-content.narrative-deterministic-projection',
      entryNodeKey: 'scene.001',
    })
    expect(structureProjection.graphFacts.reachableNodeKeys).toContain('scene.001')
    expect(structureProjection.graphFacts.decisionChoiceBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        decisionKey: 'decision.1',
        options: expect.arrayContaining([
          expect.objectContaining({
            optionKey: 'option.1.1', choiceKey: 'choice.001',
            echoes: expect.arrayContaining([expect.objectContaining({
              actionKey: expect.stringContaining('action.echo.decision.1.option.1.1.'),
              requiredConditionKey: expect.any(String),
              successText: expect.stringContaining('只属于这条路线的回应'),
            })]),
          }),
        ]),
      }),
    ]))
    expect(structureProjection.reviewScope.decisionKeys.length).toBeGreaterThan(0)
    expect(structureProjection.reviewScope.optionKeys.length).toBeGreaterThan(0)
    expect(structureProjection.reviewScope.alternativeKeys.length).toBeGreaterThan(0)
    expect(structureProjection.reviewScope.supplementalStageKeys).toHaveLength(10)
    expect(structureProjection.arcPlan.acts.map(act => act.key)).toEqual(['act.1', 'act.2', 'act.3'])
    expect(structureProjection.narrative.nodes.every(node => (
      node.projection === 'structure' && node.beats.length <= 1
    ))).toBe(true)
    expect(structureProjection.narrative.nodes.every(node => (
      node.beats.every(beat => beat[4].length <= 180)
    ))).toBe(true)
    expect(structureProjection.narrative.beatColumns).toEqual([
      'beatKey', 'order', 'kind', 'speakerKey', 'text',
    ])
    const actProjections = ([1, 2, 3] as const).map(act => (
      qualityProjection(`content.adventure-quality-review.act-${act}`)
    ))
    actProjections.forEach((projection, index) => {
      expect(projection.reviewScope).toMatchObject({
        scope: `act-${index + 1}`,
        supplementalAssignmentRule: 'bundle-entry-index-modulo-three',
        applicableScoreKeys: [
          'causality', 'playerAgency', 'routeDifferentiation', 'pacing',
          'characterMotivation', 'emotionalImpact',
        ],
      })
      expect(projection.arcPlan.acts.map(act => act.key)).toEqual([`act.${index + 1}`])
      expect(projection.dialoguePass?.actKey).toBe(`act.${index + 1}`)
      expect(projection.dialoguePass?.reviewCoverage.reviewedBeatCount).toBeGreaterThan(0)
      expect(projection.dialoguePass?.reviewCoverage.reviewedChoiceCount).toBeGreaterThan(0)
      expect(projection.dialoguePass?.flaggedBeatReviews).toHaveLength(
        projection.dialoguePass?.reviewCoverage.revisedBeatCount ?? -1,
      )
      expect(projection.dialoguePass?.flaggedChoiceReviews).toHaveLength(
        projection.dialoguePass?.reviewCoverage.revisedChoiceCount ?? -1,
      )
      expect(projection.dialoguePass?.flaggedChoiceReviews.every(review => (
        projection.reviewScope.choiceKeys.includes(review.choiceKey)
      ))).toBe(true)
      expect(projection.globalStorySpine.setupPayoffs.length).toBeGreaterThan(0)
      expect(projection.globalStorySpine.endings.length).toBe(3)
      if (index < 2) {
        expect(projection.arcPlan.endings).toEqual([])
        expect(projection.globalStorySpine.endings.every(ending => (
          ending.key === undefined && ending.requiredConsequences === undefined
        ))).toBe(true)
      } else {
        expect(projection.arcPlan.endings.length).toBeGreaterThan(0)
        expect(projection.globalStorySpine.endings.every(ending => (
          typeof ending.key === 'string' && (ending.requiredConsequences?.length ?? 0) >= 2
        ))).toBe(true)
      }
      expect(projection.narrative.nodes.some(node => (
        node.projection === 'full' && node.beats.some(beat => beat[4].length > 0)
      ))).toBe(true)
      expect(projection.narrative.choices.length).toBeGreaterThan(0)
      expect(projection.narrative.choices.every(choice => (
        typeof choice.displayConditionJson === 'string'
        && typeof choice.availableConditionJson === 'string'
        && typeof choice.effectsJson === 'string'
      ))).toBe(true)
      expect(projection.narrative.choices.some(choice => (
        choice.availableConditionJson === '{}'
        && choice.unavailableReason.length > 0
      ))).toBe(true)
    })
    const endingKeys = textAdventureNarrativeSkeletonV1(owned.brief).endingKeys
    expect(actProjections[0].reviewScope.endingKeys).toEqual([])
    expect(actProjections[1].reviewScope.endingKeys).toEqual([])
    expect(actProjections[2].reviewScope.endingKeys).toEqual(endingKeys)
    expect(actProjections[2].narrative.nodes.filter(node => endingKeys.includes(node.key)).every(node => (
      node.projection === 'full' && node.beats.length > 1
    ))).toBe(true)
    expect(new Set(actProjections.flatMap(projection => (
      projection.reviewScope.sideQuestKeys
    ))).size).toBe(3)
    expect(new Set(actProjections.flatMap(projection => (
      projection.reviewScope.ambientEventKeys
    ))).size).toBe(4)
    expect(actProjections.map(projection => projection.reviewScope.sideQuestKeys)).toEqual([
      ['side-1'], ['side-2'], ['side-3'],
    ])
    expect(actProjections.map(projection => projection.reviewScope.ambientEventKeys)).toEqual([
      ['ambient-1', 'ambient-4'], ['ambient-2'], ['ambient-3'],
    ])
    expect(actProjections.map(projection => projection.reviewScope.supplementalStageKeys)).toEqual([
      ['side-1.stage-1', 'side-1.stage-2', 'ambient-1.stage-1', 'ambient-4.stage-1'],
      ['side-2.stage-1', 'side-2.stage-2', 'ambient-2.stage-1'],
      ['side-3.stage-1', 'side-3.stage-2', 'ambient-3.stage-1'],
    ])
    expect(playtestSystem).toContain('独立 Playtest Director')
    expect(playtestSystem).toContain('不重不漏各覆盖一次上述 15 种 kind')
    expect(playtestContext).toContain('storyforge.text-adventure-playtest-inputs')
    expect(playtestContext).toContain('"deterministicEvidence":["quality.autoplay","quality.report"]')
    expect(playtestContext).not.toContain('storyforge.product-production.artifact-inputs')
    const build = (await db.productBuilds.get(projection.buildId))!
    const qualityBatchRows = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .filter(row => row.artifactKey.startsWith('quality.adventure-review.'))
    expect(qualityBatchRows).toHaveLength(4)
    const qualityBatchCoverage = qualityBatchRows.map(row => {
      expect(row).toMatchObject({ status: 'accepted', kind: 'playtest-report' })
      const quality = JSON.parse(row.qualityJson) as {
        reviewScope: string
        applicableScoreKeys: string[]
        coverage: {
          scope: string
          sourceHashes: Array<{ artifactKey: string; contentHash: string }>
          sceneKeys: string[]
          objectiveKeys: string[]
          sideQuestKeys: string[]
          ambientEventKeys: string[]
          allSupplementalEntryKeys: string[]
          ownedSupplementalEntryKeys: string[]
          allSupplementalStageKeys: string[]
          ownedSupplementalStageKeys: string[]
          supplementalAssignmentRule: string
        }
      }
      expect(quality.coverage.scope).toBe(quality.reviewScope)
      expect(quality.coverage.sourceHashes.length).toBeGreaterThanOrEqual(13)
      expect(quality.coverage.sourceHashes.every(source => source.contentHash.length === 64)).toBe(true)
      expect(quality.applicableScoreKeys).toEqual(expect.any(Array))
      return quality.coverage
    })
    expect(new Set(qualityBatchCoverage.flatMap(coverage => coverage.sideQuestKeys)).size).toBe(3)
    expect(new Set(qualityBatchCoverage.flatMap(coverage => coverage.ambientEventKeys)).size).toBe(4)
    expect(qualityBatchCoverage.every(coverage => (
      coverage.supplementalAssignmentRule === 'bundle-entry-index-modulo-three'
      && coverage.allSupplementalEntryKeys.length === 7
      && coverage.allSupplementalStageKeys.length === 10
    ))).toBe(true)
    const qualityCoverageByScope = new Map(qualityBatchCoverage.map(coverage => [coverage.scope, coverage]))
    expect(qualityCoverageByScope.get('structure')).toMatchObject({
      ownedSupplementalEntryKeys: [
        'side-1', 'side-2', 'side-3', 'ambient-1', 'ambient-2', 'ambient-3', 'ambient-4',
      ],
      ownedSupplementalStageKeys: [
        'side-1.stage-1', 'side-1.stage-2', 'side-2.stage-1', 'side-2.stage-2',
        'side-3.stage-1', 'side-3.stage-2', 'ambient-1.stage-1', 'ambient-2.stage-1',
        'ambient-3.stage-1', 'ambient-4.stage-1',
      ],
    })
    expect(qualityCoverageByScope.get('act-1')).toMatchObject({
      ownedSupplementalEntryKeys: ['side-1', 'ambient-1', 'ambient-4'],
      ownedSupplementalStageKeys: [
        'side-1.stage-1', 'side-1.stage-2', 'ambient-1.stage-1', 'ambient-4.stage-1',
      ],
    })
    expect(qualityCoverageByScope.get('act-2')).toMatchObject({
      ownedSupplementalEntryKeys: ['side-2', 'ambient-2'],
      ownedSupplementalStageKeys: ['side-2.stage-1', 'side-2.stage-2', 'ambient-2.stage-1'],
    })
    expect(qualityCoverageByScope.get('act-3')).toMatchObject({
      ownedSupplementalEntryKeys: ['side-3', 'ambient-3'],
      ownedSupplementalStageKeys: ['side-3.stage-1', 'side-3.stage-2', 'ambient-3.stage-1'],
    })
    const frozenPlan = JSON.parse(build.planJson) as Awaited<ReturnType<typeof createProductProductionPlanV3>>
    const qualitySkill = getAgentSkillV1('text-adventure.production-quality-review.v1')
    const mutableQualitySkill = qualitySkill as typeof qualitySkill & { promptVersion: string }
    const originalQualityPromptVersion = mutableQualitySkill.promptVersion
    try {
      mutableQualitySkill.promptVersion = `${originalQualityPromptVersion}.drift-fixture`
      const invalidated = await executionBindingDriftInvalidatedTaskKeysV1({
        scope: owned.scope,
        buildId: build.id!,
        previousControlEpoch: build.controlEpoch,
        plan: frozenPlan,
      })
      expect([...invalidated]).toEqual(expect.arrayContaining([
        'content.adventure-quality-review.structure',
        'content.adventure-quality-review.act-1',
        'content.adventure-quality-review.act-2',
        'content.adventure-quality-review.act-3',
        'content.adventure-quality-review',
      ]))
    } finally {
      mutableQualitySkill.promptVersion = originalQualityPromptVersion
    }
    const assembledQuality = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.adventure-review']).first()
    expect(JSON.parse(assembledQuality!.payloadJson)).toMatchObject({
      schema: 'storyforge.text-adventure-quality-review-artifact',
      passed: true,
      scores: {
        causality: 4, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
        setupPayoff: 4, characterMotivation: 4, emotionalImpact: 4,
      },
      issues: [],
    })
    expect(ambientEventAttempt).toBe(2)
    expect(ambientEventSystems).toHaveLength(2)
    expect(ambientEventSystems[0]).not.toContain('强制返修清单=')
    expect(ambientEventSystems[1]).toContain(
      '强制返修清单=[{"path":"entries[2].stages[0].successText","tokens":["descended"]}]',
    )
    expect(ambientEventSystems[1]).toContain('任何匹配 [A-Za-z]{3,} 的 ASCII 词都必须本地化')
    expect(ambientEventContexts).toHaveLength(2)
    expect(ambientEventContexts[0]).not.toContain('descended')
    const ambientRetryFeedbackSegment = ambientEventContexts[1].split('\n\n').find(segment => (
      segment.includes('storyforge.text-adventure-repair-feedback')
    ))
    expect(ambientRetryFeedbackSegment).toBeDefined()
    const ambientRetryFeedback = JSON.parse(ambientRetryFeedbackSegment!) as {
      lastTaskFailures: unknown[]
    }
    expect(ambientRetryFeedback.lastTaskFailures).toEqual([{
      taskKey: 'content.adventure-ambient-events', code: 'task-executor-failed', attempt: 1,
      controlEpoch: 0,
      detail: '[product-production-executor] '
        + '文字冒险玩家可见字段混入未本地化外语:entries[2].stages[0].successText:descended',
    }])
    const plan = JSON.parse(build.planJson) as {
      tasks: Array<{ taskKey: string; budgetReservation: { outputTokens: number } }>
    }
    expect(plan.tasks.find(task => task.taskKey === 'content.adventure-side-quests')
      ?.budgetReservation.outputTokens).toBe(12_000)
    const ledger = JSON.parse(build.budgetLedgerJson) as {
      attempts: Array<{
        taskKey: string
        attempt: number
        outcome: 'settled' | 'failed'
        usageKnown: boolean
        usage: { outputTokens: number } | null
        errorCode: string | null
      }>
    }
    expect(ledger.attempts.filter(attempt => attempt.taskKey === 'content.adventure-side-quests'))
      .toEqual([expect.objectContaining({
        attempt: 1, outcome: 'settled', usageKnown: true, errorCode: null,
        usage: expect.objectContaining({ outputTokens: 7_457 }),
      })])
    expect(ledger.attempts.filter(attempt => attempt.taskKey === 'content.adventure-ambient-events'))
      .toEqual([
        expect.objectContaining({
          attempt: 1, outcome: 'failed', usageKnown: true, errorCode: 'task-executor-failed',
          usage: expect.objectContaining({ outputTokens: 1_703 }),
        }),
        expect.objectContaining({
          attempt: 2, outcome: 'settled', usageKnown: true, errorCode: null,
          usage: expect.objectContaining({ outputTokens: 2_000 }),
        }),
      ])
    const sideQuestRows = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'content.adventure-side-quests']).toArray()
    expect(sideQuestRows).toHaveLength(1)
    expect(sideQuestRows[0]).toMatchObject({ status: 'accepted' })
    const ambientEventRows = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'content.adventure-ambient-events']).toArray()
    expect(ambientEventRows).toHaveLength(1)
    expect(ambientEventRows[0]).toMatchObject({ status: 'accepted' })
    expect(JSON.parse(ambientEventRows[0].payloadJson))
      .toEqual(outputs['content.adventure-ambient-events'])
    expect(ambientEventRows.every(row => !row.payloadJson.includes('descended'))).toBe(true)
    const quality = JSON.parse(build.qualityReportJson) as {
      hardGateResults: Array<{ gateId: string; passed: boolean; evidence: string[] }>
    }
    expect(quality.hardGateResults).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.content-volume', passed: true,
    }))
    const autoplayArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.autoplay']).first()
    expect(autoplayArtifact).toMatchObject({ status: 'accepted', kind: 'playtest-report' })
    expect(JSON.parse(autoplayArtifact!.payloadJson)).toMatchObject({
      schema: 'storyforge.text-adventure-autoplay-report', passed: true,
      cases: expect.arrayContaining([
        expect.objectContaining({ kind: 'golden-route', passed: true }),
        expect.objectContaining({ kind: 'ending-coverage', passed: true }),
        expect.objectContaining({ kind: 'failure-forward', passed: true }),
        expect.objectContaining({ kind: 'state-roundtrip', passed: true }),
      ]),
    })
    const playtestArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.playtest-plan']).first()
    expect(playtestArtifact).toMatchObject({ status: 'accepted', kind: 'playtest-report' })
    expect(JSON.parse(playtestArtifact!.payloadJson)).toMatchObject({
      buildNumber: build.buildNumber,
      recommendation: 'eligible-for-human-validation',
      routeCases: expect.arrayContaining([
        expect.objectContaining({ kind: 'export-import', executionMode: 'real-browser', required: true }),
      ]),
    })
    const runtimeArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtimePackage = parseProductRuntimePackageV1(runtimeArtifact!.payloadJson)
    expect(runtimePackage.adventure?.version).toBe(2)
    if (runtimePackage.adventure?.version !== 2) throw new Error('60 分钟夹具没有进入 AdventureContentV2')
    expect(runtimePackage.adventure.regions).toHaveLength(2)
    expect(runtimePackage.adventure.areas).toHaveLength(4)
    expect(runtimePackage.adventure.locations).toHaveLength(8)
    expect(runtimePackage.adventure.scenes).toHaveLength(12)
    const locationIndexByKey = new Map(runtimePackage.adventure.locations.map((location, index) => [location.key, index]))
    expect(runtimePackage.adventure.scenes.map(scene => locationIndexByKey.get(scene.locationKey))).toEqual([
      0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7,
    ])
    expect(runtimePackage.adventure.quests.filter(item => item.category === 'side')).toHaveLength(3)
    expect(runtimePackage.adventure.quests.filter(item => item.category === 'side')
      .every(item => item.initialStatus === 'available')).toBe(true)
    expect(runtimePackage.adventure.quests.filter(item => item.category === 'side')
      .every(item => item.stages.length === 3 && item.objectives.length === 3)).toBe(true)
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.accept.side.'))).toHaveLength(3)
    const locationByKey = new Map(runtimePackage.adventure.locations.map(location => [location.key, location]))
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.accept.side.')).every(action => (
      action.description.includes(locationByKey.get(action.locationKey)!.title)
    ))).toBe(true)
    expect(runtimePackage.adventure.actions.every(action => (
      [...action.label.replace(/\s+/g, '')].length <= 32
    ))).toBe(true)
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.side.'))
      .every(item => item.label.startsWith('推进：'))).toBe(true)
    const sideUseAction = runtimePackage.adventure.actions.find(item => (
      item.key.startsWith('action.side.side-1.') && item.kind === 'use'
    ))!
    expect(sideUseAction).toMatchObject({ kind: 'use' })
    expect(sideUseAction.targetKey).toMatch(/^item\.side\.side-1\./)
    expect(sideUseAction.requirements).toContainEqual({ itemKey: sideUseAction.targetKey, itemQuantity: 1 })
    expect(runtimePackage.adventure.items).toContainEqual(expect.objectContaining({
      key: sideUseAction.targetKey, usableActionKey: sideUseAction.key, category: 'quest',
    }))
    expect(runtimePackage.adventure.actions).toContainEqual(expect.objectContaining({
      key: expect.stringMatching(/^action\.prepare\.side\.side-1\./), kind: 'take',
      successEffects: [expect.objectContaining({ op: 'gain-item', itemKey: sideUseAction.targetKey })],
    }))
    expect(runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.ambient.'))
      .every(item => item.label.startsWith('处理：'))).toBe(true)
    expect(runtimePackage.adventure.actions.some(item => item.key.startsWith('action.travel.'))).toBe(false)
    expect(runtimePackage.adventure.storylets).toHaveLength(7)
    expect(runtimePackage.adventure.endings).toHaveLength(3)
    const routeQuality = analyzeTextAdventureRouteQualityV1(runtimePackage)
    expect(routeQuality.endingTextUnits).toHaveLength(3)
    expect(routeQuality.minimumRouteNarrativeChoices).toBeGreaterThanOrEqual(10)
    expect(routeQuality.minimumMainProgressActions).toBeGreaterThanOrEqual(20)
    expect(routeQuality.endingTextUnits.every(ending => (
      ending.npcDialogueTurns >= 1 && ending.stateSettlement
    ))).toBe(true)
    const commercialQuality = evaluateProductRuntimeProductQualityV1({
      runtimePackage,
      brief: { ...owned.brief, qualityProfile: 'commercial-candidate' },
    })
    expect(commercialQuality.gates).toContainEqual(expect.objectContaining({
      gateId: 'product.adventure.recommendation-decisions',
      // This internal fixture has enough route choices but only two
      // observable stateful decisions, so the combined commercial gate must
      // remain closed while still proving the 60-minute 10-choice threshold.
      passed: false,
      evidence: expect.arrayContaining([
        expect.stringMatching(/^minimumRouteNarrativeChoices=\d+\/10$/),
        expect.stringMatching(/^minimumRouteStatefulDecisions=\d+\/6$/),
      ]),
    }))
    const echoActions = runtimePackage.adventure.actions.filter(item => item.key.startsWith('action.echo.'))
    const arcDecisionCount = (outputs['content.narrative-arc-plan'] as {
      decisions: Array<{ options: Array<{ echoSceneKeys: string[] }> }>
    }).decisions.reduce((total, decision) => (
      total + decision.options.reduce((optionTotal, option) => optionTotal + option.echoSceneKeys.length, 0)
    ), 0)
    expect(echoActions).toHaveLength(arcDecisionCount)
    expect(echoActions.every(action => action.requirements.some(requirement => (
      'conditionKey' in requirement && requirement.conditionPresent === true
    )))).toBe(true)
    const packageWithoutEchoes = structuredClone(runtimePackage)
    packageWithoutEchoes.adventure!.actions = packageWithoutEchoes.adventure!.actions.filter(item => (
      !item.key.startsWith('action.echo.')
    ))
    expect(analyzeTextAdventureRouteQualityV1(packageWithoutEchoes).minimumRouteStatefulDecisions).toBe(0)
    const packageWithoutNarrativeActions = structuredClone(runtimePackage)
    packageWithoutNarrativeActions.adventure!.actions = packageWithoutNarrativeActions.adventure!.actions
      .map(action => ({ ...action, narrativeChoiceKey: null }))
    expect(analyzeTextAdventureRouteQualityV1(packageWithoutNarrativeActions).minimumMainProgressActions)
      .toBeLessThan(20)
    const packageWithBranchOnlyMainActions = structuredClone(runtimePackage)
    const firstEndingNodeKey = packageWithBranchOnlyMainActions.narrative.nodes
      .find(node => node.kind === 'ending')!.key
    packageWithBranchOnlyMainActions.adventure!.actions = packageWithBranchOnlyMainActions.adventure!.actions
      .map(action => {
        const completesMainObjective = [
          ...action.successEffects, ...action.costlySuccessEffects, ...action.failureEffects,
        ].some(effect => effect.op === 'complete-objective'
          && packageWithBranchOnlyMainActions.adventure!.quests.some(quest => (
            quest.category === 'main' && quest.key === effect.questKey
          )))
        if (!completesMainObjective) return action
        return {
          ...action,
          requirements: action.requirements.map(requirement => (
            requirement.narrativePath === '__storyforge.currentNarrativeNodeKey'
              ? { ...requirement, narrativeEquals: firstEndingNodeKey }
              : requirement
          )),
        }
      })
    expect(analyzeTextAdventureRouteQualityV1(packageWithBranchOnlyMainActions).minimumMainProgressActions)
      .toBeLessThan(20)
    const firstDecisionChoices = runtimePackage.narrative.choices.filter(choice => (
      choice.sourceNodeKey === runtimePackage.narrative.entryNodeKey
    ))
    const firstDecisionConditionKeys = firstDecisionChoices.map(choice => {
      const actionKey = choice.tags.find(tag => tag.startsWith('adventure-action:'))!.slice('adventure-action:'.length)
      const action = runtimePackage.adventure!.actions.find(item => item.key === actionKey)!
      return action.successEffects.find(effect => effect.op === 'apply-condition')!.conditionKey
    })
    const endingChoiceActions = runtimePackage.narrative.choices.filter(choice => choice.targetNodeKey.startsWith('ending.'))
      .map(choice => {
        const actionKey = choice.tags.find(tag => tag.startsWith('adventure-action:'))!.slice('adventure-action:'.length)
        return runtimePackage.adventure!.actions.find(item => item.key === actionKey)!
      })
    expect(endingChoiceActions[0].requirements).toContainEqual({
      conditionKey: firstDecisionConditionKeys[0], conditionPresent: true,
    })
    expect(endingChoiceActions[1].requirements).toContainEqual({
      conditionKey: firstDecisionConditionKeys[1], conditionPresent: true,
    })
    expect(endingChoiceActions[2].requirements).toContainEqual({
      conditionKey: firstDecisionConditionKeys[1], conditionPresent: true,
    })
    const mainQuest = runtimePackage.adventure.quests.find(item => item.category === 'main')!
    expect(mainQuest.stages).toHaveLength(3)
    expect(mainQuest.objectives).toHaveLength(8)
    expect(mainQuest.objectives.filter(item => item.alternativeActionKeys.length >= 2)).toHaveLength(2)
    expect(runtimePackage.interaction?.profiles).toHaveLength(2)
    expect(runtimePackage.adventure.actions.filter(item => item.kind === 'talk').length).toBeGreaterThanOrEqual(2)
    const firstMainAlternative = runtimePackage.adventure.actions.find(
      item => item.key === 'action.main.alternative.1.1',
    )!
    expect(firstMainAlternative).toMatchObject({
      rule: { kind: 'random', abilityKey: 'ability.perception', difficulty: 10, costlySuccessFloor: 6 },
    })
    expect(firstMainAlternative.successText).toContain('围绕“主线目标 1”')
    expect(firstMainAlternative.successText).toContain('目标完成并让后续人物态度发生可见变化')
    expect(runtimePackage.adventure.items).toContainEqual(expect.objectContaining({
      key: 'item.product.field-notes', tags: expect.arrayContaining(['product-private']),
    }))
    expect(runtimePackage.adventure.actions).toContainEqual(expect.objectContaining({
      key: 'action.take.product.field-notes', kind: 'take', locationKey: runtimePackage.adventure.initialLocationKey,
    }))
    const preview = await startProductProductionPreviewV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    const previewState = await readProductRuntimeState(preview.sessionId)
    const initialCandidates = availableAdventureActions(
      runtimePackage.adventure, previewState.adventure!,
      adventureNarrativeActionContext({ currentNodeKey: runtimePackage.narrative.entryNodeKey, variables: {} }),
    )
    expect(initialCandidates.filter(item => item.available && item.action.narrativeChoiceKey)).toHaveLength(0)
    const firstObjectiveAction = initialCandidates.find(item => (
      item.available && item.action.key.startsWith('action.main.') && item.action.kind !== 'talk'
    ))!
    const objectiveBase = await readProductRuntimeStateVersion(preview.sessionId)
    await commitAdventureAction({
      sessionId: preview.sessionId, actionKey: firstObjectiveAction.action.key,
      commandId: 'text-adventure:complete-first-main-objective',
      baseSequence: objectiveBase.sequence, baseStateHash: objectiveBase.stateHash,
    })
    const afterObjective = await readProductRuntimeState(preview.sessionId)
    const entryActions = availableAdventureActions(
      runtimePackage.adventure, afterObjective.adventure!,
      adventureNarrativeActionContext({ currentNodeKey: runtimePackage.narrative.entryNodeKey, variables: {} }),
    ).filter(item => item.available && item.action.narrativeChoiceKey).map(item => item.action.narrativeChoiceKey)
    expect(entryActions).toEqual(runtimePackage.narrative.choices.filter(choice => (
      choice.sourceNodeKey === runtimePackage.narrative.entryNodeKey
    )).map(choice => choice.choiceKey))
    const entrySideQuest = runtimePackage.adventure.quests.find(item => (
      item.category === 'side'
      && runtimePackage.adventure!.actions.find(action => action.key === `action.accept.side.${item.key.split('.').at(-1)}`)
        ?.locationKey === runtimePackage.adventure!.initialLocationKey
    ))!
    const entryAcceptAction = `action.accept.side.${entrySideQuest.key.split('.').at(-1)}`
    expect(availableAdventureActions(
      runtimePackage.adventure, previewState.adventure!,
      adventureNarrativeActionContext({ currentNodeKey: runtimePackage.narrative.entryNodeKey, variables: {} }),
    ).find(item => item.action.key === entryAcceptAction)?.available).toBe(true)
    const acceptBase = await readProductRuntimeStateVersion(preview.sessionId)
    await commitAdventureAction({
      sessionId: preview.sessionId, actionKey: entryAcceptAction,
      commandId: 'text-adventure:accept-side-quest',
      baseSequence: acceptBase.sequence,
      baseStateHash: acceptBase.stateHash,
    })
    const acceptedSideQuest = (await readProductRuntimeState(preview.sessionId)).adventure?.quests
      .find(item => item.questKey === entrySideQuest.key)
    expect(acceptedSideQuest?.status).toBe('active')
    expect(acceptedSideQuest?.objectives[0]).toMatchObject({ completed: true, optional: false })
    expect(acceptedSideQuest?.objectives[1]).toMatchObject({ completed: false, optional: false })

    const mainRoute = await startProductProductionPreviewV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    for (let turn = 0; turn < 50; turn += 1) {
      const state = await readProductRuntimeState(mainRoute.sessionId)
      if (state.narrative?.completed) break
      const currentNodeKey = state.narrative?.currentNodeKey
      if (!currentNodeKey || !state.adventure) throw new Error('文字冒险主路线缺少当前节点或玩法状态')
      const available = availableAdventureActions(
        runtimePackage.adventure, state.adventure,
        adventureNarrativeActionContext({ currentNodeKey, variables: state.narrative?.variables ?? {} }),
      ).filter(item => item.available)
      const objectiveAction = available.find(item => (
        item.action.key.startsWith('action.main.') && item.action.kind !== 'talk'
      ))
      if (objectiveAction) {
        const base = await readProductRuntimeStateVersion(mainRoute.sessionId)
        await commitAdventureAction({
          sessionId: mainRoute.sessionId, actionKey: objectiveAction.action.key,
          commandId: `text-adventure:main-route:objective:${turn}`,
          baseSequence: base.sequence, baseStateHash: base.stateHash,
        })
        continue
      }
      const narrativeAction = available.find(item => item.action.narrativeChoiceKey)
      if (!narrativeAction?.action.narrativeChoiceKey) {
        throw new Error(`文字冒险主路线在 ${currentNodeKey} 没有合法主线行动`)
      }
      await commitAdventureNarrativeChoice({
        sessionId: mainRoute.sessionId,
        choiceKey: narrativeAction.action.narrativeChoiceKey,
        commandId: `text-adventure:main-route:choice:${turn}`,
      })
    }
    const completedMainRoute = await readProductRuntimeState(mainRoute.sessionId)
    expect(completedMainRoute.narrative).toMatchObject({ completed: true })
    expect(completedMainRoute.adventure?.quests.find(item => item.questKey === mainQuest.key)?.status).toBe('completed')
    expect(completedMainRoute.adventure?.quests.find(item => item.questKey === mainQuest.key)?.objectives
      .every(objective => objective.completed)).toBe(true)
    const equipActions = runtimePackage.adventure.actions.filter(action => action.key.startsWith('action.equip.'))
    const unequipActions = runtimePackage.adventure.actions.filter(action => action.key.startsWith('action.unequip.'))
    const entrySceneActionKeys = new Set(runtimePackage.adventure.scenes
      .filter(scene => scene.locationKey === runtimePackage.adventure!.initialLocationKey)
      .flatMap(scene => scene.actionKeys))
    expect(equipActions).toHaveLength(2)
    expect(unequipActions).toHaveLength(2)
    expect(equipActions.every(action => action.requirements.some(requirement => requirement.itemState === 'carried'))).toBe(true)
    expect(unequipActions.every(action => action.requirements.some(requirement => requirement.itemState === 'equipped'))).toBe(true)
    expect(equipActions.every(action => action.locationKey === runtimePackage.adventure!.initialLocationKey)).toBe(true)
    expect(equipActions.every(action => entrySceneActionKeys.has(action.key))).toBe(true)

    await db.productBuildArtifacts.update(runtimeArtifact!.id!, { status: 'invalid' })
    await db.productBuildArtifacts.add({
      ...runtimeArtifact!, id: undefined, version: runtimeArtifact!.version + 1,
      status: 'accepted', createdAt: Date.now(), updatedAt: Date.now(),
    })
    const modelCallCountBeforeReassembly = modelCallCount
    const reassembly = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '保留全部文字冒险内容与媒资，只重新装配和复验运行包。',
      affectedLanes: ['runtime'],
    })
    const reassemblyBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, reassembly.briefRevision]).first()
    const reassemblyProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'text-adventure.runtime-only.authorize',
        expectedStateRevision: reassemblyProduction.stateRevision,
        briefRevision: reassembly.briefRevision, briefHash: reassemblyBriefRow!.briefHash,
        authorizationNonce: 'text-adventure.runtime-only.click',
      },
    })
    const reassembled = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: parseProductProductionBriefV3(reassemblyBriefRow!.briefJson), runText,
      }), capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(reassembled).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(modelCallCount).toBe(modelCallCountBeforeReassembly + 1)
    const reassemblyArtifacts = await db.productBuildArtifacts.where('buildId').equals(reassembled.buildId).toArray()
    expect(reassemblyArtifacts.filter(item => item.status === 'accepted').map(item => item.artifactKey).sort()).toEqual([
      'content.narrative', 'content.narrative-arc-plan', 'content.quest-script',
      'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3', 'media.visual-bible',
      'quality.adventure-review', 'quality.autoplay', 'quality.playtest-plan', 'quality.report', 'runtime.package',
    ])
  }, 120_000)

  it('保留独立叙事审查证据，并在存在阻塞问题时拒绝装配可玩包', async () => {
    const owned = await fixtureForProduct('text-adventure', { visualLevel: 'none', maximumModelCalls: 64 })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const bindingHash = await hashProductProductionValueV2({ provider: 'blocking-quality-review' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash, 'text-adventure', firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    ) as Record<string, unknown>
    const professional = professionalTextAdventurePlanningOutputs(owned.brief)
    Object.assign(
      outputs,
      professional,
      professionalTextAdventureSceneScriptOutputs(
        owned.brief,
        professional,
        ['潮门广场', '旧仓街', '信号塔'],
      ),
    )
    outputs['media.requirements'] = {
      ...(outputs['media.requirements'] as Record<string, unknown>), visual: [], audio: [],
    }
    Object.assign(outputs, textAdventureQualityReviewBatchOutputs({
      structureScores: { causality: 2 },
      structureIssues: [{
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: '[owningKey=scene.001] scene.001 到 scene.002 的主要转折缺少因果铺垫。',
        recommendation: '补充 scene.001 的前置铺垫与可见状态回响。',
      }],
      actIssues: { 1: [{
        severity: 'blocking', artifactKey: 'content.adventure-side-quests',
        detail: '[owningKey=lost-lamp] lost-lamp 的支线钩子与冻结地点错位。',
        recommendation: '保持 lost-lamp 稳定 key 并重写错位钩子。',
      }, {
        severity: 'blocking', artifactKey: 'content.quest-script',
        detail: '[owningKey=objective.1] objective.1 的任务脚本结算文案混入未本地化外语。',
        recommendation: '由对应专业脚本 Run 修复 objective.1 的玩家可见文案。',
      }, {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: '[owningKey=choice.001] choice.001 的立即行动与目标场景不一致。', recommendation: '重写选择文案。',
      }, {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: '[owningKey=scene.002] scene.002 的标题与冻结地点语义不一致。', recommendation: '统一场景地点语义。',
      }, {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: '[owningKey=choice.003] choice.003 的目标地点仍然错位。', recommendation: '按目标场景开场改写选择文案。',
      }] },
    }))
    const taskCalls = new Map<string, number>()
    const repairedSceneContexts: string[] = []
    const repairedSceneSystems: string[] = []
    let failFirstRepairEpoch = true
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`))
      if (!taskKey) throw new Error(`unknown blocking-review task:${request.system}`)
      taskCalls.set(taskKey, (taskCalls.get(taskKey) ?? 0) + 1)
      if (taskKey === 'content.scene-script.act-1.part-1' && (taskCalls.get(taskKey) ?? 0) >= 2) {
        repairedSceneContexts.push(request.contextText)
        repairedSceneSystems.push(request.system)
        if (failFirstRepairEpoch) throw new Error('fixture repair provider timeout')
      }
      let output = outputs[taskKey]
      if (request.system.includes('storyforge.text-adventure-scene-repair-patch-artifact')) {
        const feedback = request.contextText.split(/\n\s*\n/g).flatMap(segment => {
          try {
            const value = JSON.parse(segment) as Record<string, unknown>
            return value.schema === 'storyforge.text-adventure-repair-feedback' ? [value] : []
          } catch {
            return []
          }
        })[0]!
        const baseline = (feedback.baselineArtifact as { payload: {
          scenes: Array<{ sceneKey: string; summary: string }>
          choices: Array<{ choiceKey: string; text: string }>
        } }).payload
        const issues = feedback.blockingIssues as Array<{ detail: string }>
        const patches: Array<{
          issueIndexes: number[]
          targetKind: 'choice' | 'scene'
          targetKey: string
          field: 'text' | 'summary'
          value: string
        }> = []
        const addPatch = (patch: (typeof patches)[number]): void => {
          const existing = patches.find(candidate => (
            candidate.targetKind === patch.targetKind
            && candidate.targetKey === patch.targetKey
            && candidate.field === patch.field
          ))
          if (existing) {
            existing.issueIndexes.push(...patch.issueIndexes)
            return
          }
          patches.push(patch)
        }
        issues.forEach((issue, issueIndex) => {
          const choiceKey = issue.detail.match(/choice\.\d+/)?.[0]
          const choice = choiceKey
            ? baseline.choices.find(row => row.choiceKey === choiceKey)
            : undefined
          if (choice) {
            addPatch({
              issueIndexes: [issueIndex], targetKind: 'choice', targetKey: choice.choiceKey,
              field: 'text', value: `${choice.text}（行动已与眼前局面核对）`,
            })
            return
          }
          const requestedSceneKey = issue.detail.match(/scene\.\d+/)?.[0]
          const scene = baseline.scenes.find(row => row.sceneKey === requestedSceneKey)
            ?? baseline.scenes[0]!
          addPatch({
            issueIndexes: [issueIndex], targetKind: 'scene', targetKey: scene.sceneKey,
            field: 'summary', value: `${scene.summary}（因果铺垫已经补足。）`,
          })
        })
        output = {
          schema: 'storyforge.text-adventure-scene-repair-patch-artifact', version: 1,
          patches,
        }
      }
      return {
        output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-reviewer', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'f'.repeat(64),
        },
      }
    }
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(projection).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.failureJson).toContain('文字冒险叙事质量审查未通过')
    const review = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.adventure-review']).first()
    expect(review).toMatchObject({ status: 'accepted', kind: 'playtest-report' })
    expect(JSON.parse(review!.payloadJson)).toMatchObject({ passed: false })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).count()).toBe(0)
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'media.requirements']).count()).toBe(0)

    Object.assign(outputs, textAdventureQualityReviewBatchOutputs())
    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'text-adventure.quality-repair.retry',
        expectedStateRevision: production.stateRevision, blockerKey: 'integration.package',
        resolution: { action: 'retry', note: '修复质量审查上下文后重新审查并重建下游' },
      },
    })
    const repairingBuild = (await db.productBuilds.get(build.id!))!
    expect(JSON.parse(repairingBuild.failureJson)).toMatchObject({
      previousFailure: {
        taskKey: 'integration.package', detail: expect.stringContaining('文字冒险叙事质量审查未通过'),
      },
    })
    const interruptedRepair = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(interruptedRepair).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    const interruptedBuild = (await db.productBuilds.get(build.id!))!
    const interruptedFailure = JSON.parse(interruptedBuild.failureJson) as {
      taskKey: string
      taskFailures: Record<string, { detail?: string }>
    }
    expect(interruptedFailure).toMatchObject({
      repairCause: {
        taskKey: 'integration.package', detail: expect.stringContaining('文字冒险叙事质量审查未通过'),
      },
    })
    expect(
      interruptedFailure.taskFailures['content.scene-script.act-1.part-1']?.detail,
      `interrupted failure=${JSON.stringify(interruptedFailure)}`,
    )
      .toContain('fixture repair provider timeout')
    failFirstRepairEpoch = false
    const interruptedProduction = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'text-adventure.quality-repair.retry-after-timeout',
        expectedStateRevision: interruptedProduction.stateRevision, blockerKey: interruptedFailure.taskKey,
        resolution: { action: 'retry', note: '保留原质量反馈并重试超时的主线修复' },
      },
    })
    const repaired = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
      }],
    })
    expect(
      repaired,
      `quality repair projection=${JSON.stringify(repaired)} failure=${(await db.productBuilds.get(build.id!))?.failureJson}`,
    ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    const expectedCalls = new Map([
      ['production.supervision', 1], ['content.source-sufficiency', 1], ['content.design', 1], ['content.story-bible', 1],
      ['content.cast-bible', 1], ['content.adventure-architecture', 1],
      ['content.narrative-arc-scenes', 1], ['content.narrative-decision-plan', 1],
      ['content.main-quest-plan', 1], ['content.ending-route-plan', 1],
      // Stable scene ownership keeps scene.002 on its actual act-2 shard;
      // the interrupted act-1 repair is retried without fanning the issue out
      // to the unrelated act-1 part-2 shard.
      ['content.scene-script.act-1.part-1', 4], ['content.scene-script.act-1.part-2', 2],
      ['content.scene-script.act-2.part-1', 3],
      ['content.scene-script.act-3.part-1', 2],
      ['content.dialogue-pass.act-1', 2], ['content.dialogue-pass.act-2', 2],
      ['content.dialogue-pass.act-3', 2],
      ['content.product-module', 1], ['content.adventure-side-quests', 2],
      // The review names objective.1, so only its owning main-script shard is
      // retried; a stable identity must not fan a repair across every act.
      ['content.quest-script.main.act-1.single', 1], ['content.quest-script.main.act-1.multi', 2],
      ['content.quest-script.main.act-2.single', 1], ['content.quest-script.main.act-2.multi', 1],
      ['content.quest-script.main.act-3.single', 1], ['content.quest-script.main.act-3.multi', 1],
      ['content.quest-script.supplemental', 2],
      ['content.adventure-ambient-events', 1],
      ['content.adventure-quality-review.structure', 2],
      ['content.adventure-quality-review.act-1', 2],
      ['content.adventure-quality-review.act-2', 2],
      ['content.adventure-quality-review.act-3', 2],
      ['media.requirements', 1], ['qa.playtest-strategy', 1],
    ])
    expect(taskCalls).toEqual(expectedCalls)
    expect(repairedSceneContexts).toHaveLength(3)
    const qualityRepairSceneContexts = repairedSceneContexts.filter(context => (
      context.includes('storyforge.text-adventure-repair-feedback')
    ))
    expect(qualityRepairSceneContexts).toHaveLength(3)
    for (const repairedSceneContext of qualityRepairSceneContexts) {
      expect(repairedSceneContext).toContain('storyforge.text-adventure-repair-feedback')
      expect(repairedSceneContext).toContain('主要转折缺少因果铺垫')
      expect(repairedSceneContext).not.toContain('scene.002 的标题与冻结地点语义不一致')
      expect(repairedSceneContext).not.toContain('choice.003 的目标地点仍然错位')
      expect(repairedSceneContext).toContain('"repairTaskKeys"')
    }
    const retryAfterFailureContexts = qualityRepairSceneContexts.filter(context => (
      context.includes('fixture repair provider timeout')
    ))
    expect(retryAfterFailureContexts).toHaveLength(2)
    expect(retryAfterFailureContexts.every(context => context.includes('lastTaskFailures'))).toBe(true)
    expect(repairedSceneSystems).toHaveLength(3)
    expect(repairedSceneSystems[0]).toContain('detail 是需要消除的缺陷证据，recommendation 只是建议')
    expect(repairedSceneSystems[0]).toContain('优先重写错位的钩子与结果文本')
    const repairedReviewRows = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'quality.adventure-review']).toArray()
    expect(repairedReviewRows.filter(row => row.status === 'accepted')).toHaveLength(1)
    expect(JSON.parse(repairedReviewRows.find(row => row.status === 'accepted')!.payloadJson))
      .toMatchObject({ passed: true })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).count()).toBe(1)
  }, 120_000)

  it('五种通用生产产品经过正式生产、可玩 Build Preview 与同包原子发布', async () => {
    const products: ProductionProductKindV1[] = [
      'character-interaction', 'ai-town', 'text-adventure', 'avg', 'ttrpg',
    ]
    for (const productType of products) {
      const owned = await fixtureForProduct(productType)
      const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
      expect(owned.brief.capabilityRequirements.filter(item => item.mediaClass !== 'text'))
        .toHaveLength(productType === 'text-adventure' ? 1 : 0)
      const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config', productType })
      const baseOutputs = modelOutputs(
        owned.brief.source.worldContentHash,
        productType,
        firstCharacterAnchor(owned.brief),
        owned.brief.intent.playerRole,
      )
      const professional = productType === 'text-adventure'
        ? professionalTextAdventurePlanningOutputs(owned.brief) : null
      const outputs = {
        ...baseOutputs,
        ...(professional ?? {}),
        ...(professional ? professionalTextAdventureSceneScriptOutputs(
          owned.brief,
          professional,
          ['潮门广场', '旧仓街', '信号塔'],
        ) : {}),
      }
      const runText: ProductionTextRunnerV1 = async request => {
        const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
        if (!taskKey) throw new Error(`unknown ${productType} model task`)
        let output: unknown = taskKey === 'media.requirements'
          ? { ...outputs[taskKey], visual: productType === 'text-adventure' ? outputs[taskKey].visual : [], audio: [] }
          : outputs[taskKey]
        if (productType === 'ttrpg' && taskKey === 'content.product-module') {
          const currentBuild = await db.productBuilds.where('productionId').equals(owned.productionId).last()
          const narrative = await db.productBuildArtifacts.where('buildId').equals(currentBuild!.id!)
            .filter(row => row.artifactKey === 'content.narrative' && row.status === 'accepted').first()
          const rulePack = await resolveTtrpgProductionRulePackV2({ scope: owned.scope, brief: owned.brief.ttrpg! })
          output = { ...outputs[taskKey], ttrpgScenario: authoredScenarioFixture({ brief: owned.brief.ttrpg!, rulePack,
            nodes: JSON.parse(narrative!.payloadJson).nodes }) }
        }
        return {
          output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 },
          bindingReceipt: {
            schema: 'storyforge.provider-binding-receipt', version: 1,
            requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
            provider: 'fixture', model: productType === 'text-adventure'
              ? 'fixture-vision' : 'fixture-model', endpointOrigin: 'https://fixture.invalid',
            executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
            capabilityHash: bindingHash, boundAt: 1, receiptHash: 'd'.repeat(64),
          },
        }
      }
      const runVision: ProductionVisionRunnerV1 = async request => ({
        output: JSON.stringify({
          schema: 'storyforge.text-adventure-vision-capability-preflight-model-output',
          version: 1,
          observedQuadrants: decodeVisionPreflightQuadrants(request.images[0].data),
        }),
        usage: { inputTokens: 50, outputTokens: 20 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey,
          adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-vision', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'e'.repeat(64),
        },
      })
      const projection = await runProductProductionUntilBlockedV1({
        scope: owned.scope, productionId: owned.productionId,
        executor: createConfiguredProductProductionExecutorV1({
          production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief,
          runText, runVision: productType === 'text-adventure' ? runVision : undefined,
        }),
        capabilityBindings: [
          {
            requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
            ...(productType === 'text-adventure'
              ? { provider: 'fixture', model: 'fixture-vision' }
              : {}),
          },
          ...(productType === 'text-adventure' ? [await createBuiltInProductionCapabilityBindingV1({
            requirementKey: owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!.requirementKey,
            adapterId: 'storyforge.procedural-svg.v1',
          })] : []),
        ],
      })
      const projectedBuild = await db.productBuilds.get(projection.buildId)
      expect(
        projection,
        `${productType} production projection:\n${JSON.stringify(projection, null, 2)}\nfailure=${projectedBuild?.failureJson}`,
      ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
      const build = projectedBuild!
      const packageArtifact = await db.productBuildArtifacts
        .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
      const runtimePackage = parseProductRuntimePackageV1(packageArtifact!.payloadJson)
      expect(runtimePackage.productType).toBe(productType)
      expect(runtimePackage.sourceWorld.selection).toEqual(owned.brief.source.selection)
      if (productType === 'character-interaction') {
        expect(runtimePackage.interaction!.profiles).toHaveLength(1)
        expect(runtimePackage.interaction!.profiles[0]).toMatchObject({name:'林舟',voiceRules:expect.stringContaining('简短直接')})
        expect(runtimePackage.interaction!.profiles[0].initialKnowledge).toContainEqual(expect.objectContaining({visibility:'private',content:'独自保管的暗号'}))
        expect(runtimePackage.interaction!.profiles[0].relationshipDimensions[0].initial).toBe(24)
        expect(runtimePackage.interaction!.sceneTemplates[0].directorBudget).toBe(120)
      }
      if (productType === 'ai-town') {
        expect(runtimePackage.town).toMatchObject({
          schema: 'storyforge.ai-town-runtime-content',
          clock: { slots: [...AI_TOWN_DAY_SLOTS] },
          offline: { maximumDays: 3 },
        })
        expect(runtimePackage.town?.residents).toHaveLength(4)
      }
      if (productType === 'text-adventure') {
        expect(runtimePackage.adventure?.version).toBe(2)
        expect(runtimePackage.presentation?.assets).toHaveLength(2)
        expect(runtimePackage.adventure?.media.assetKeys).toEqual(
          runtimePackage.presentation?.assets.map(asset => asset.assetKey),
        )
        expect(runtimePackage.narrative.choices.some(choice => (
          choice.tags.some(tag => tag.startsWith('adventure-action:'))
        ))).toBe(true)
        const reviewArtifacts = await listProductProductionReviewArtifactsV1({
          scope: owned.scope,
          buildId: build.id!,
        })
        expect(reviewArtifacts.map(artifact => artifact.artifactKey)).toEqual(expect.arrayContaining([
          'content.adventure-architecture', 'content.narrative', 'content.product-module',
          'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
          'quality.adventure-review', 'media.requirements',
          'runtime.package', 'quality.report',
        ]))
        expect(reviewArtifacts.every(artifact => artifact.payload != null && artifact.contentHash.length === 64)).toBe(true)
      }
      if (productType === 'ttrpg') {
        expect(runtimePackage.ttrpg).toMatchObject({
          rulePack: { contentHash: owned.brief.ttrpg?.rules.effectiveContentHash },
          campaign: { tags: expect.arrayContaining(['production-campaign-v2']) },
        })
        expect(await db.productBuildArtifacts
          .where('[buildId+artifactKey]').equals([build.id!, 'ttrpg.rule-pack']).count()).toBe(1)
        expect(await db.productBuildArtifacts
          .where('[buildId+artifactKey]').equals([build.id!, 'ttrpg.campaign-pack']).count()).toBe(1)
      }
      const preview = await startProductProductionPreviewV1({
        scope: owned.scope, productionId: owned.productionId,
      })
      expect(preview.productType).toBe(productType)
      expect(await db.productRuntimeSessions.get(preview.sessionId)).toMatchObject({
        productBuildId: build.id, productReleaseId: null, runtimeSourceHash: build.packageHash,
      })
      if (productType === 'text-adventure') {
        await completeTextAdventureSessionMainRoute({
          sessionId: preview.sessionId,
          runtimePackage,
          commandPrefix: 'six.text-adventure.preview',
        })
      }
      if (productType === 'ttrpg') {
        const beforeSessionZero = await readProductRuntimeState(preview.sessionId)
        const beforeVersion = await readProductRuntimeStateVersion(preview.sessionId)
        await db.productBuilds.update(build.id!, { previewHash: 'f'.repeat(64) })
        await expect(completeTtrpgSessionZero({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.tampered',
          baseSequence: beforeVersion.sequence,
          baseStateHash: beforeVersion.stateHash,
          acceptedItemKeys: beforeSessionZero.ttrpg!.product!.sessionZero.requiredItemKeys,
          completedBy: 'gm',
        })).rejects.toThrow(/Preview|运行源|hash/)
        await db.productBuilds.update(build.id!, { previewHash: build.previewHash })
        const initialParticipants = await readTtrpgSessionParticipantsV2(preview.sessionId)
        for (const participant of initialParticipants) {
          await configureTtrpgSessionParticipantV2({
            sessionId: preview.sessionId,
            seatKey: participant.seatKey,
            expectedRevision: participant.revision,
            commandId: `six.ttrpg.preview.disclose.${participant.seatKey}`,
            requestedByViewerKey: 'viewer.gm',
            consent: { aiIdentityDisclosed: true },
          })
        }
        const sessionZero = await completeTtrpgSessionZero({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.session-zero',
          baseSequence: beforeVersion.sequence,
          baseStateHash: beforeVersion.stateHash,
          acceptedItemKeys: beforeSessionZero.ttrpg!.product!.sessionZero.requiredItemKeys,
          completedBy: 'gm',
        })
        expect(sessionZero.type).toBe('ttrpg.session-zero.completed')

        let state = await readProductRuntimeState(preview.sessionId)
        let version = await readProductRuntimeStateVersion(preview.sessionId)
        const openedScene = await openTtrpgCampaignScene({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.opening',
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          sceneKey: state.ttrpg!.product!.openingSceneKey,
        })
        expect(openedScene.type).toBe('ttrpg.scene.opened')
        state = await readProductRuntimeState(preview.sessionId)
        version = await readProductRuntimeStateVersion(preview.sessionId)
        const gm = (await readTtrpgSessionParticipantsV2(preview.sessionId))
          .find(participant => participant.role === 'gm')!
        const intent = await submitTtrpgActionIntentV2({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.intent',
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          intentKey: 'intent.preview.inspect',
          actorKey: state.ttrpg!.activeActorKey!,
          rawInput: '我观察潮门周围是否留下了可疑痕迹。',
          submittedBy: { role: 'gm', viewerKey: gm.viewerKey },
        })
        expect(intent.type).toBe('ttrpg.intent.receipted')
      }
      const published = await publishProductProductionV1({
        scope: owned.scope, productionId: owned.productionId,
      })
      const released = await resolveProductRuntimeSource({
        scope: owned.scope, source: { kind: 'release', productReleaseId: published.receipt.productReleaseId },
      })
      expect(released.packageHash).toBe(build.packageHash)
      expect(released.runtimePackage).toEqual(runtimePackage)
      released.mediaResolver.dispose()
      if (productType === 'text-adventure') {
        const distribution = await exportProductDistributionBundleV2({
          scope: owned.scope,
          productReleaseId: published.receipt.productReleaseId,
        })
        expect(distribution.productRelease.manifest.packageHash).toBe(build.packageHash)
        expect(distribution.media).toHaveLength(runtimePackage.presentation?.assets.length ?? 0)
        expect(distribution.media.every(item => item.dataBase64.length > 0)).toBe(true)
        const importedWorkspace = await seedCurrentProductWorld('formal-text-adventure-import-target')
        const importedRelease = await importMarketplaceProductDistributionV2({
          scope: importedWorkspace.scope,
          bundle: JSON.parse(JSON.stringify(distribution)),
          provenance: {
            listingId: `listing.formal-text-adventure.${build.id}`,
            orderId: `order.formal-text-adventure.${build.id}`,
            entitlementId: `entitlement.formal-text-adventure.${build.id}`,
            license: {
              licenseId: 'license.formal-text-adventure-fixture',
              licenseVersion: '1.0.0',
              allowOfflineExport: true,
              allowRemix: true,
              commercialReuse: false,
              requiresAttribution: true,
              termsUrl: 'https://storyforge.example/licenses/formal-text-adventure-fixture',
            },
            attribution: ['StoryForge 正式生产纵切面夹具'],
            localCopyPreserved: true,
            acquiredAt: 1_800_000_000_000,
          },
        })
        expect(importedRelease).toMatchObject({
          productType: 'text-adventure',
          contentHash: distribution.productRelease.contentHash,
          distributionProvenance: {
            source: 'marketplace',
            listingId: `listing.formal-text-adventure.${build.id}`,
          },
        })
        const importedSource = await resolveProductRuntimeSource({
          scope: importedWorkspace.scope,
          source: { kind: 'release', productReleaseId: importedRelease.id! },
        })
        expect(importedSource.packageHash).toBe(build.packageHash)
        expect(importedSource.runtimePackage).toEqual(runtimePackage)
        for (const asset of importedSource.runtimePackage.presentation?.assets ?? []) {
          const bytes = await importedSource.mediaResolver.read(asset.assetKey)
          expect(bytes).toMatchObject({ type: asset.mimeType, size: asset.byteSize })
        }
        importedSource.mediaResolver.dispose()
        const importedSession = await createProductRuntimeInstanceFromSource({
          scope: importedWorkspace.scope,
          source: { kind: 'release', productReleaseId: importedRelease.id! },
          title: '正式生产分发包导入通关',
        })
        await completeTextAdventureSessionMainRoute({
          sessionId: importedSession.id!,
          runtimePackage,
          commandPrefix: 'six.text-adventure.imported',
        })
      }
    }
  }, 180_000)
})
