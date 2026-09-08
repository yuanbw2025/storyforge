import { hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductBuildQualityReportV1 } from '../product-production/adoption'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import { parseProductRuntimePackageV1 } from '../product-production/runtime-package'
import { db } from '../db/schema'
import type {
  ProductProductionTaskExecutionInputV1,
  ProductProductionTaskExecutionResultV1,
  ProductProductionTaskExecutorV1,
} from '../product-production/scheduler'
import type {
  ProductBuildQualityReportV1,
  ProductProductionBriefV3,
  ProductRuntimePackageV1,
  FrozenRuntimeMediaAssetV2,
  TextOpenWorldActionBindingsV1,
  TextOpenWorldBalanceReviewV1,
  TextOpenWorldChoiceContractsV1,
  TextOpenWorldContentBudgetV1,
  TextOpenWorldCraftingEconomyCatalogV1,
  TextOpenWorldDeterministicPreflightV1,
  TextOpenWorldDirectorDecksV1,
  TextOpenWorldEndingContractsV1,
  TextOpenWorldEnemyEncounterCatalogV1,
  TextOpenWorldExperienceContractV1,
  TextOpenWorldGameBriefV1,
  TextOpenWorldIntegrationReportV1,
  TextOpenWorldItemRewardCatalogV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldMapInteractionCatalogV1,
  TextOpenWorldMediaRequirementsV1,
  TextOpenWorldNpcRuntimeCatalogV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldPlayerBuildV1,
  TextOpenWorldPresentationProfileV1,
  TextOpenWorldProgressionCatalogsV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldRuntimeModuleKeyV1,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSceneScriptsV1,
  TextOpenWorldSemanticReviewV1,
  TextOpenWorldSignificantThreadsV1,
  TextOpenWorldSourceLedgerV1,
  TextOpenWorldSourcePinV1,
  TextOpenWorldStoryArcV1,
  TextOpenWorldSystemConfigsV1,
} from '../types'
import { TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1 } from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'
import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from './product-config'
import { parseTextOpenWorldRuntimePackageV1 } from './runtime-package'
import { createInitialTextOpenWorldSessionProjectionV1 } from './session-projection'
import { validateTextOpenWorldDeterministicPreflightV1 } from './system-finalize-production'
import {
  evaluateTextOpenWorldMediaCoverageV1,
  verifyTextOpenWorldMediaRightsV1,
  type TextOpenWorldVerifiedMediaRightsV1,
} from './media-quality'
import {
  compileTextOpenWorldSkillMechanicV2,
  compileTextOpenWorldStatusDefinitionV2,
} from './combat-mechanics-production'

const MODULE_DEPENDENCIES: Partial<Record<TextOpenWorldRuntimeModuleKeyV1, TextOpenWorldRuntimeModuleKeyV1[]>> = {
  world: ['narrative'],
  actors: ['world', 'time-weather'],
  actions: ['world'],
  quests: ['narrative', 'actors', 'actions'],
  progression: ['actions'],
  items: ['actions'],
  combat: ['progression', 'items'],
  crafting: ['actions', 'items', 'world'],
  relationships: ['actors', 'quests'],
  economy: ['actors', 'items', 'relationships'],
  'time-weather': ['world'],
  director: ['quests', 'time-weather'],
  knowledge: ['narrative', 'actors'],
  presentation: ['director', 'knowledge'],
}

interface V3Artifacts {
  sourcePin: TextOpenWorldSourcePinV1
  sourceLedger: TextOpenWorldSourceLedgerV1
  gameBrief: TextOpenWorldGameBriefV1
  experience: TextOpenWorldExperienceContractV1
  storyArc: TextOpenWorldStoryArcV1
  endings: TextOpenWorldEndingContractsV1
  mainline: TextOpenWorldMainlineThreadV1
  significant: TextOpenWorldSignificantThreadsV1
  skeletons: TextOpenWorldQuestSkeletonsV1
  presentationProfile: TextOpenWorldPresentationProfileV1
  player: TextOpenWorldPlayerBuildV1
  progression: TextOpenWorldProgressionCatalogsV1
  regionPacks: TextOpenWorldRegionNarrativePacksV1
  encounters: TextOpenWorldEnemyEncounterCatalogV1
  items: TextOpenWorldItemRewardCatalogV1
  craftingEconomy: TextOpenWorldCraftingEconomyCatalogV1
  npcs: TextOpenWorldNpcRuntimeCatalogV1
  map: TextOpenWorldMapInteractionCatalogV1
  quests: TextOpenWorldQuestDesignDocumentsV1
  director: TextOpenWorldDirectorDecksV1
  scenes: TextOpenWorldSceneScriptsV1
  choices: TextOpenWorldChoiceContractsV1
  system: TextOpenWorldSystemConfigsV1
  media: TextOpenWorldMediaRequirementsV1
  contentBudget: TextOpenWorldContentBudgetV1
  preflight: TextOpenWorldDeterministicPreflightV1
  balance: TextOpenWorldBalanceReviewV1
  semantic: TextOpenWorldSemanticReviewV1
  actionBindings: TextOpenWorldActionBindingsV1
}

const V3_INPUT_ARTIFACT_SPECS = [
  ['text-open-world.source-pin', 'storyforge.text-open-world-source-pin', 'pinHash'],
  ['text-open-world.source-ledger', 'storyforge.text-open-world-source-ledger', 'ledgerHash'],
  ['text-open-world.game-brief', 'storyforge.text-open-world-game-brief', 'gameBriefHash'],
  ['text-open-world.experience-contract', 'storyforge.text-open-world-experience-contract', 'experienceContractHash'],
  ['text-open-world.story-arc', 'storyforge.text-open-world-story-arc', 'storyArcHash'],
  ['text-open-world.ending-contracts', 'storyforge.text-open-world-ending-contracts', 'endingContractsHash'],
  ['text-open-world.mainline-thread', 'storyforge.text-open-world-mainline-thread', 'mainlineThreadHash'],
  ['text-open-world.significant-threads', 'storyforge.text-open-world-significant-threads', 'significantThreadsHash'],
  ['text-open-world.quest-skeletons', 'storyforge.text-open-world-quest-skeletons', 'questSkeletonsHash'],
  ['text-open-world.presentation-profile', 'storyforge.text-open-world-presentation-profile', 'presentationProfileHash'],
  ['text-open-world.player-build', 'storyforge.text-open-world-player-build', 'playerBuildHash'],
  ['text-open-world.region-narrative-packs', 'storyforge.text-open-world-region-narrative-packs', 'regionNarrativePacksHash'],
  ['text-open-world.progression-catalogs', 'storyforge.text-open-world-progression-catalogs', 'progressionCatalogsHash'],
  ['text-open-world.enemy-encounter-catalog', 'storyforge.text-open-world-enemy-encounter-catalog', 'enemyEncounterCatalogHash'],
  ['text-open-world.item-reward-catalog', 'storyforge.text-open-world-item-reward-catalog', 'itemRewardCatalogHash'],
  ['text-open-world.crafting-economy-catalog', 'storyforge.text-open-world-crafting-economy-catalog', 'craftingEconomyCatalogHash'],
  ['text-open-world.npc-runtime-catalog', 'storyforge.text-open-world-npc-runtime-catalog', 'npcRuntimeCatalogHash'],
  ['text-open-world.map-interaction-catalog', 'storyforge.text-open-world-map-interaction-catalog', 'mapInteractionCatalogHash'],
  ['text-open-world.quest-design-documents', 'storyforge.text-open-world-quest-design-documents', 'questDesignDocumentsHash'],
  ['text-open-world.director-decks', 'storyforge.text-open-world-director-decks', 'directorDecksHash'],
  ['text-open-world.scene-scripts', 'storyforge.text-open-world-scene-scripts', 'sceneScriptsHash'],
  ['text-open-world.choice-contracts', 'storyforge.text-open-world-choice-contracts', 'choiceContractsHash'],
  ['text-open-world.action-bindings', 'storyforge.text-open-world-action-bindings', 'actionBindingsHash'],
  ['text-open-world.system-configs', 'storyforge.text-open-world-system-configs', 'systemConfigsHash'],
  ['text-open-world.media-requirements', 'storyforge.text-open-world-media-requirements', 'mediaRequirementsHash'],
  ['text-open-world.content-budget', 'storyforge.text-open-world-content-budget', 'contentBudgetHash'],
  ['text-open-world.deterministic-preflight', 'storyforge.text-open-world-deterministic-preflight', 'deterministicPreflightHash'],
  ['text-open-world.balance-review', 'storyforge.text-open-world-balance-review', 'balanceReviewHash'],
  ['text-open-world.semantic-review', 'storyforge.text-open-world-semantic-review', 'semanticReviewHash'],
] as const

function fail(message: string): never {
  throw new Error(`[text-open-world-v3] ${message}`)
}

function payload<T>(input: ProductProductionTaskExecutionInputV1, artifactKey: string): T {
  const row = input.inputArtifacts.find(item => item.artifactKey === artifactKey)
    ?? fail(`缺少输入Artifact:${artifactKey}`)
  try { return JSON.parse(row.payloadJson) as T }
  catch { return fail(`输入Artifact不是合法JSON:${artifactKey}`) }
}

async function validateV3ArtifactClosure(input: ProductProductionTaskExecutionInputV1): Promise<void> {
  const productInstanceKeys = new Set<string>()
  for (const [artifactKey, schema, ownHashKey] of V3_INPUT_ARTIFACT_SPECS) {
    const row = input.inputArtifacts.find(item => item.artifactKey === artifactKey)
      ?? fail(`V3缺少受治理输入:${artifactKey}`)
    let parsed: Record<string, unknown>
    try {
      const value = JSON.parse(row.payloadJson) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`V3输入不是对象:${artifactKey}`)
      parsed = value as Record<string, unknown>
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('[text-open-world-v3]')) throw cause
      fail(`V3输入不是合法JSON:${artifactKey}`)
    }
    if (parsed.schema !== schema || parsed.version !== 1 || parsed.productType !== 'text-open-world') {
      fail(`V3输入身份无效:${artifactKey}`)
    }
    const ownHash = parsed[ownHashKey]
    if (typeof ownHash !== 'string' || !isSha256Hash(ownHash)) fail(`V3输入自身Hash无效:${artifactKey}`)
    const body = { ...parsed }
    delete body[ownHashKey]
    if (await hashProductProductionValueV2(body) !== ownHash) fail(`V3输入自身Hash不匹配:${artifactKey}`)
    const expectedContentHash = artifactKey === 'text-open-world.source-pin'
      ? ownHash : await hashProductProductionValueV2(parsed)
    if (row.contentHash !== expectedContentHash) fail(`V3输入Artifact内容Hash不匹配:${artifactKey}`)
    if (typeof parsed.productInstanceKey !== 'string' || !parsed.productInstanceKey.trim()) {
      fail(`V3输入缺少产品实例:${artifactKey}`)
    }
    productInstanceKeys.add(parsed.productInstanceKey)
  }
  if (productInstanceKeys.size !== 1) fail('V3输入跨产品实例')
  const preflight = payload<TextOpenWorldDeterministicPreflightV1>(input, 'text-open-world.deterministic-preflight')
  await validateTextOpenWorldDeterministicPreflightV1({ artifact: preflight, rows: input.inputArtifacts })
}

function readV3Artifacts(input: ProductProductionTaskExecutionInputV1): V3Artifacts {
  return {
    sourcePin: payload(input, 'text-open-world.source-pin'),
    sourceLedger: payload(input, 'text-open-world.source-ledger'),
    gameBrief: payload(input, 'text-open-world.game-brief'),
    experience: payload(input, 'text-open-world.experience-contract'),
    storyArc: payload(input, 'text-open-world.story-arc'),
    endings: payload(input, 'text-open-world.ending-contracts'),
    mainline: payload(input, 'text-open-world.mainline-thread'),
    significant: payload(input, 'text-open-world.significant-threads'),
    skeletons: payload(input, 'text-open-world.quest-skeletons'),
    presentationProfile: payload(input, 'text-open-world.presentation-profile'),
    player: payload(input, 'text-open-world.player-build'),
    progression: payload(input, 'text-open-world.progression-catalogs'),
    regionPacks: payload(input, 'text-open-world.region-narrative-packs'),
    encounters: payload(input, 'text-open-world.enemy-encounter-catalog'),
    items: payload(input, 'text-open-world.item-reward-catalog'),
    craftingEconomy: payload(input, 'text-open-world.crafting-economy-catalog'),
    npcs: payload(input, 'text-open-world.npc-runtime-catalog'),
    map: payload(input, 'text-open-world.map-interaction-catalog'),
    quests: payload(input, 'text-open-world.quest-design-documents'),
    director: payload(input, 'text-open-world.director-decks'),
    scenes: payload(input, 'text-open-world.scene-scripts'),
    choices: payload(input, 'text-open-world.choice-contracts'),
    system: payload(input, 'text-open-world.system-configs'),
    media: payload(input, 'text-open-world.media-requirements'),
    contentBudget: payload(input, 'text-open-world.content-budget'),
    preflight: payload(input, 'text-open-world.deterministic-preflight'),
    balance: payload(input, 'text-open-world.balance-review'),
    semantic: payload(input, 'text-open-world.semantic-review'),
    actionBindings: payload(input, 'text-open-world.action-bindings'),
  }
}

function validateV3HashChain(artifacts: V3Artifacts): void {
  const system = artifacts.system
  const mismatches = [
    artifacts.sourceLedger.sourcePinHash !== artifacts.sourcePin.pinHash,
    artifacts.gameBrief.source.sourcePinHash !== artifacts.sourcePin.pinHash,
    artifacts.experience.gameBriefHash !== artifacts.gameBrief.gameBriefHash,
    artifacts.storyArc.gameBriefHash !== artifacts.gameBrief.gameBriefHash,
    artifacts.endings.storyArcHash !== artifacts.storyArc.storyArcHash,
    artifacts.mainline.storyArcHash !== artifacts.storyArc.storyArcHash,
    artifacts.mainline.endingContractsHash !== artifacts.endings.endingContractsHash,
    artifacts.significant.mainlineThreadHash !== artifacts.mainline.mainlineThreadHash,
    system.gameBriefHash !== artifacts.gameBrief.gameBriefHash,
    system.experienceContractHash !== artifacts.experience.experienceContractHash,
    system.presentationProfileHash !== artifacts.presentationProfile.presentationProfileHash,
    system.playerBuildHash !== artifacts.player.playerBuildHash,
    system.regionNarrativePacksHash !== artifacts.regionPacks.regionNarrativePacksHash,
    system.progressionCatalogsHash !== artifacts.progression.progressionCatalogsHash,
    system.enemyEncounterCatalogHash !== artifacts.encounters.enemyEncounterCatalogHash,
    system.itemRewardCatalogHash !== artifacts.items.itemRewardCatalogHash,
    system.craftingEconomyCatalogHash !== artifacts.craftingEconomy.craftingEconomyCatalogHash,
    system.npcRuntimeCatalogHash !== artifacts.npcs.npcRuntimeCatalogHash,
    system.mapInteractionCatalogHash !== artifacts.map.mapInteractionCatalogHash,
    system.questDesignDocumentsHash !== artifacts.quests.questDesignDocumentsHash,
    system.directorDecksHash !== artifacts.director.directorDecksHash,
    system.sceneScriptsHash !== artifacts.scenes.sceneScriptsHash,
    system.choiceContractsHash !== artifacts.choices.choiceContractsHash,
    system.actionBindingsHash !== artifacts.actionBindings.actionBindingsHash,
    artifacts.media.presentationProfileHash !== artifacts.presentationProfile.presentationProfileHash,
    artifacts.media.npcRuntimeCatalogHash !== artifacts.npcs.npcRuntimeCatalogHash,
    artifacts.media.mapInteractionCatalogHash !== artifacts.map.mapInteractionCatalogHash,
    artifacts.media.sceneScriptsHash !== artifacts.scenes.sceneScriptsHash,
    artifacts.contentBudget.experienceContractHash !== artifacts.experience.experienceContractHash,
    artifacts.contentBudget.regionNarrativePacksHash !== artifacts.regionPacks.regionNarrativePacksHash,
    artifacts.contentBudget.questDesignDocumentsHash !== artifacts.quests.questDesignDocumentsHash,
    artifacts.contentBudget.directorDecksHash !== artifacts.director.directorDecksHash,
    artifacts.contentBudget.sceneScriptsHash !== artifacts.scenes.sceneScriptsHash,
    artifacts.preflight.systemConfigsHash !== system.systemConfigsHash,
    artifacts.preflight.contentBudgetHash !== artifacts.contentBudget.contentBudgetHash,
    artifacts.preflight.questDesignDocumentsHash !== artifacts.quests.questDesignDocumentsHash,
    artifacts.preflight.actionBindingsHash !== artifacts.actionBindings.actionBindingsHash,
    artifacts.balance.deterministicPreflightHash !== artifacts.preflight.deterministicPreflightHash,
    artifacts.balance.progressionCatalogsHash !== artifacts.progression.progressionCatalogsHash,
    artifacts.balance.enemyEncounterCatalogHash !== artifacts.encounters.enemyEncounterCatalogHash,
    artifacts.balance.itemRewardCatalogHash !== artifacts.items.itemRewardCatalogHash,
    artifacts.balance.craftingEconomyCatalogHash !== artifacts.craftingEconomy.craftingEconomyCatalogHash,
    artifacts.balance.questDesignDocumentsHash !== artifacts.quests.questDesignDocumentsHash,
    artifacts.balance.contentBudgetHash !== artifacts.contentBudget.contentBudgetHash,
    artifacts.semantic.deterministicPreflightHash !== artifacts.preflight.deterministicPreflightHash,
    artifacts.semantic.storyArcHash !== artifacts.storyArc.storyArcHash,
    artifacts.semantic.mainlineThreadHash !== artifacts.mainline.mainlineThreadHash,
    artifacts.semantic.significantThreadsHash !== artifacts.significant.significantThreadsHash,
    artifacts.semantic.regionNarrativePacksHash !== artifacts.regionPacks.regionNarrativePacksHash,
    artifacts.semantic.questDesignDocumentsHash !== artifacts.quests.questDesignDocumentsHash,
    artifacts.semantic.sceneScriptsHash !== artifacts.scenes.sceneScriptsHash,
    artifacts.semantic.contentBudgetHash !== artifacts.contentBudget.contentBudgetHash,
  ]
  if (mismatches.some(Boolean)) fail('V3输入Hash链不闭合')
}

function runtimeMediaKind(kind: TextOpenWorldMediaRequirementsV1['slots'][number]['kind']):
  TextOpenWorldParsedModulesV1['presentation']['mediaSlots'][number]['kind'] {
  if (kind === 'procedural-map') return 'map'
  if (kind === 'character-portrait') return 'portrait'
  if (kind === 'scene-background' || kind === 'ui-skin') return 'background'
  return 'audio'
}

async function generatedMediaBindings(
  execution: ProductProductionTaskExecutionInputV1,
  requirements: TextOpenWorldMediaRequirementsV1,
  brief: ProductProductionBriefV3,
): Promise<{
  assetKeyBySlot: Map<string, string>
  artifactKeys: string[]
  assets: FrozenRuntimeMediaAssetV2[]
  rightsEvidence: TextOpenWorldVerifiedMediaRightsV1[]
}> {
  const assetKeyBySlot = new Map<string, string>()
  const assets: FrozenRuntimeMediaAssetV2[] = []
  const rightsEvidence: TextOpenWorldVerifiedMediaRightsV1[] = []
  const compatible = (
    slot: TextOpenWorldMediaRequirementsV1['slots'][number],
    mediaKind: NonNullable<ProductProductionTaskExecutionInputV1['inputArtifacts'][number]['mediaKind']>,
  ) => slot.kind === 'character-portrait'
    ? ['character-pose', 'character-expression'].includes(mediaKind)
    : slot.kind === 'scene-background' ? ['background', 'cg'].includes(mediaKind)
      : slot.kind === 'ui-skin' ? mediaKind === 'ui'
        : slot.kind === 'music' ? mediaKind === 'bgm'
          : slot.kind === 'sound-effect' ? mediaKind === 'sfx'
            : slot.kind === 'ambient-sound' ? mediaKind === 'ambience'
              : slot.kind === 'voice' ? mediaKind === 'voice'
                : false
  const bindLane = async (
    artifactPrefix: string,
    slotKinds: TextOpenWorldMediaRequirementsV1['slots'][number]['kind'][],
  ) => {
    const rows = execution.inputArtifacts
      .filter(row => row.artifactKey.startsWith(artifactPrefix))
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
    const slots = requirements.slots.filter(slot => (
      slotKinds.includes(slot.kind)
      && slot.productionMode !== 'procedural-code'
      && slot.productionMode !== 'fallback-only'
    ))
    const remainingSlots = new Set(slots.map(slot => slot.key))
    if (rows.length !== slots.length) fail(`生成媒资与冻结生产槽数量不一致:${artifactPrefix}:${rows.length}/${slots.length}`)
    for (const row of rows) {
      if (row.blobObjectId == null || !row.mimeType || row.byteSize < 1) {
        fail(`生成媒资缺少Blob证据:${row.artifactKey}`)
      }
      let metadata: Record<string, unknown>
      try {
        const value = JSON.parse(row.metadataJson) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not-object')
        metadata = value as Record<string, unknown>
      }
      catch { fail(`生成媒资metadata不是合法JSON:${row.artifactKey}`) }
      if (!row.mediaKind) fail(`生成媒资缺少mediaKind:${row.artifactKey}`)
      const slot = slots.find(candidate => (
        remainingSlots.has(candidate.key)
        && metadata.sceneTag === candidate.subjectKey
        && compatible(candidate, row.mediaKind!)
      )) ?? fail(`生成媒资没有匹配的需求槽位:${row.artifactKey}`)
      remainingSlots.delete(slot.key)
      if (typeof metadata.assetKey !== 'string' || !metadata.assetKey.trim()) {
        fail(`生成媒资缺少assetKey:${row.artifactKey}`)
      }
      if (assets.some(asset => asset.assetKey === metadata.assetKey)) {
        fail(`生成媒资assetKey重复:${String(metadata.assetKey)}`)
      }
      const requiredText = (key: string, allowEmpty = false) => {
        const value = metadata[key]
        if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
          return fail(`生成媒资metadata.${key}无效:${row.artifactKey}`)
        }
        return value
      }
      const nullableInteger = (key: string) => {
        const value = metadata[key]
        if (value === null) return null
        if (!Number.isInteger(value) || Number(value) < 0) {
          return fail(`生成媒资metadata.${key}无效:${row.artifactKey}`)
        }
        return Number(value)
      }
      const capability = brief.capabilityRequirements.find(item => item.requirementKey === row.requirementKey)
        ?? fail(`生成媒资没有冻结Capability需求:${row.artifactKey}`)
      const expectedClass = row.mediaKind === 'bgm' ? 'music'
        : row.mediaKind === 'voice' ? 'voice'
          : ['ambience', 'sfx'].includes(row.mediaKind) ? 'sfx' : 'image'
      if (capability.mediaClass !== expectedClass) fail(`生成媒资Capability类型不匹配:${row.artifactKey}`)
      await readMediaBlobObjectData({
        scope: execution.scope, blobObjectId: row.blobObjectId,
        expected: { contentHash: row.contentHash, mimeType: row.mimeType, byteSize: row.byteSize },
      })
      rightsEvidence.push(await verifyTextOpenWorldMediaRightsV1({
        artifact: row, qualityProfile: brief.qualityProfile, capabilityRequirement: capability,
      }))
      assetKeyBySlot.set(slot.key, metadata.assetKey)
      assets.push({
        assetKey: metadata.assetKey, version: 1, kind: row.mediaKind,
        name: requiredText('name'), mimeType: row.mimeType, byteSize: row.byteSize,
        width: nullableInteger('width'), height: nullableInteger('height'),
        durationMs: nullableInteger('durationMs'), contentHash: row.contentHash,
        blobContentHash: row.contentHash, source: requiredText('source'),
        license: requiredText('license'), altText: requiredText('altText'),
        characterTag: requiredText('characterTag', true), sceneTag: requiredText('sceneTag', true),
      })
    }
  }
  await bindLane('text-open-world.media.visual.', ['character-portrait', 'scene-background', 'ui-skin'])
  await bindLane('text-open-world.media.audio.', ['music', 'ambient-sound', 'sound-effect', 'voice'])
  return {
    assetKeyBySlot,
    assets: assets.sort((left, right) => left.assetKey.localeCompare(right.assetKey)),
    artifactKeys: execution.inputArtifacts
      .filter(row => row.artifactKey.startsWith('text-open-world.media.'))
      .map(row => row.artifactKey).sort(),
    rightsEvidence: rightsEvidence.sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
  }
}

function compileModulePayloads(
  artifacts: V3Artifacts,
  assetKeyBySlot: ReadonlyMap<string, string>,
): TextOpenWorldParsedModulesV1 {
  const qdd = artifacts.quests
  const binding = qdd.catalogBindings
  const actionModuleVersion = artifacts.system.runtimeModules.find(module => module.moduleKey === 'actions')?.schemaVersion
  if (actionModuleVersion !== 15 && actionModuleVersion !== 16 && actionModuleVersion !== 17) {
    fail('SystemConfigs任务Action版本无效')
  }
  const expectedActionModuleVersion = qdd.governance.structuredCombatMechanicsReady === true
    ? 17
    : qdd.governance.allAbandonableQuestStagesCovered === true
      && qdd.governance.restartActionsRequireOriginalOfferRoute === true ? 16 : 15
  if (actionModuleVersion !== expectedActionModuleVersion) fail('SystemConfigs与QuestDesign任务生命周期版本不一致')
  const endingBindings = qdd.endingBindings
  const endingScene = [...artifacts.scenes.scenes]
    .find(scene => scene.sourceKind === 'quest-resolution'
      && scene.questKey === endingBindings.finalMainlineQuestKey)
    ?? fail('主线最终任务没有结局选择场景')
  const endingActionKeys = endingBindings.routes.map(route => route.actionKey)
  const endingChoiceRows = artifacts.choices.choices.filter(choice => endingActionKeys.includes(choice.actionKey))
  if (endingChoiceRows.length !== endingBindings.routes.length
    || endingChoiceRows.some(choice => choice.sceneKey !== endingScene.key)
    || endingBindings.routes.some(route => !endingScene.actionKeys.includes(route.actionKey))) {
    fail('P9没有为全部P8F结局Action生成最终场景Choice')
  }
  const skeletonByQuestKey = new Map(artifacts.skeletons.quests.map(quest => [quest.key, quest]))
  const sceneKeysByNarrativeStage = new Map<string, string[]>()
  for (const scene of artifacts.scenes.scenes) {
    if (!scene.questKey) continue
    const sourceStageKey = skeletonByQuestKey.get(scene.questKey)?.source.sourceKey
    if (!sourceStageKey) continue
    sceneKeysByNarrativeStage.set(sourceStageKey, [
      ...(sceneKeysByNarrativeStage.get(sourceStageKey) ?? []), scene.key,
    ])
  }
  const questKeysForStage = (stageKey: string) => artifacts.skeletons.quests
    .filter(quest => quest.source.sourceKey === stageKey)
    .map(quest => quest.key)
    .filter(key => qdd.quests.some(quest => quest.key === key))
  const significantOwner = (thread: TextOpenWorldSignificantThreadsV1['threads'][number]) => {
    const quest = qdd.quests.find(candidate => candidate.storylineKey === thread.key)
      ?? fail(`重要故事没有已绑定任务:${thread.key}`)
    if (quest.ownerKind === 'actor') return { ownerKind: 'character' as const, ownerKey: quest.ownerKey }
    if (quest.ownerKind === 'faction') return { ownerKind: 'faction' as const, ownerKey: quest.ownerKey }
    if (quest.ownerKind === 'region') return { ownerKind: 'region' as const, ownerKey: quest.ownerKey }
    return fail(`重要故事owner没有绑定到角色、势力或地区:${thread.key}`)
  }
  const mediaSlotBySubject = new Map<string, string[]>()
  for (const slot of artifacts.media.slots) {
    mediaSlotBySubject.set(slot.subjectKey, [...(mediaSlotBySubject.get(slot.subjectKey) ?? []), slot.key])
  }
  const worldMapSlotKeys = artifacts.media.slots.filter(slot => slot.kind === 'procedural-map').map(slot => slot.key)
  const itemBindingByKey = new Map(binding.items.map(item => [item.itemKey, item]))
  const rewardBindingByKey = new Map(binding.rewards.map(item => [item.rewardContractKey, item]))
  const dropBindingByKey = new Map(binding.dropTables.map(item => [item.dropTableKey, item]))
  const skillBindingByKey = new Map(binding.skills.map(item => [item.skillKey, item]))
  const enemyBindingByKey = new Map(binding.enemies.map(item => [item.enemyKey, item]))
  const encounterBindingByKey = new Map(binding.encounters.map(item => [item.encounterKey, item]))
  const recipeBindingByKey = new Map(binding.recipes.map(item => [item.recipeKey, item]))
  const vendorBindingByKey = new Map(binding.vendors.map(item => [item.vendorKey, item]))
  const runtimeVendorKeys = new Set(artifacts.craftingEconomy.vendors.map(vendor => vendor.key))
  const serviceKeysByActor = new Map<string, string[]>()
  for (const vendor of binding.vendors) {
    serviceKeysByActor.set(vendor.actorKey, [...(serviceKeysByActor.get(vendor.actorKey) ?? []), vendor.vendorKey])
  }
  const edgeBindingByKey = new Map(binding.edges.map(item => [item.edgeKey, item]))
  const finalQuestEffects = qdd.effects
  const finalQuestActions = qdd.actions
  const actionOwnerQuest = (effectKey: string) => {
    const actionKeys = finalQuestActions.filter(action => [
      ...action.costEffectKeys, ...action.successEffectKeys, ...action.failureEffectKeys,
    ].includes(effectKey)).map(action => action.key)
    const objective = qdd.objectives.find(item => [item.completionActionKey, ...item.supportActionKeys]
      .some(actionKey => actionKeys.includes(actionKey)))
    return objective?.questKey ?? qdd.quests.find(quest => quest.rewardEffectKeys.includes(effectKey))?.key
      ?? qdd.quests.find(quest => quest.type === 'significant')?.key
      ?? qdd.quests.find(quest => quest.type === 'mainline')!.key
  }
  const storyModifierRows = finalQuestEffects.flatMap(effect => {
    if (effect.operation !== 'set-story-modifier') return []
    return [{
      key: `story-modifier.${effect.key}`,
      actorKey: effect.payload.actorKey,
      value: effect.payload.value,
      sourceQuestKey: actionOwnerQuest(effect.key),
    }]
  })
  const rumorKnowledge = artifacts.scenes.randomEventPresentations.flatMap(item => item.rumorKey && item.rumorText ? [{
    key: `knowledge.${item.rumorKey}`,
    kind: 'quest-clue' as const,
    title: `传闻：${item.rumorKey}`,
    content: item.rumorText,
    sourceRefs: item.sourceClaimKeys,
    initialPlayerVisibility: 'hidden' as const,
    actorKeys: [],
  }] : [])
  const knowledgeKeys = new Set(rumorKnowledge.map(item => item.key))
  const sourceKnowledge = artifacts.sourceLedger.entries
    .filter(entry => !knowledgeKeys.has(entry.claimKey))
    .map(entry => ({
      key: entry.claimKey,
      kind: (entry.claimKind === 'identity' ? 'lore' : entry.claimKind === 'location' ? 'location' : 'lore') as 'location' | 'lore',
      title: entry.canonicalName,
      content: entry.statement,
      sourceRefs: entry.evidence.map(item => item.unitKey),
      initialPlayerVisibility: 'hidden' as const,
      actorKeys: entry.entityKeys.filter(key => artifacts.npcs.actors.some(actor => actor.key === key)),
    }))

  return {
    narrative: {
      version: 2,
      storylines: [{
        key: artifacts.mainline.thread.key,
        kind: 'mainline', ownerKind: 'core', ownerKey: null,
        title: artifacts.mainline.thread.title, summary: artifacts.mainline.thread.summary,
        stageKeys: artifacts.mainline.stages.map(stage => stage.key),
        endingKeys: artifacts.endings.endings.map(ending => ending.key),
      }, ...artifacts.significant.threads.map(thread => ({
        key: thread.key, kind: 'significant' as const, ...significantOwner(thread),
        title: thread.title, summary: thread.summary, stageKeys: thread.stageKeys, endingKeys: [],
      }))],
      stages: [
        ...artifacts.mainline.stages.map(stage => ({
          key: stage.key, storylineKey: artifacts.mainline.thread.key, order: stage.order,
          title: stage.title, summary: stage.summary, questKeys: questKeysForStage(stage.key),
          sceneKeys: [...new Set(sceneKeysByNarrativeStage.get(stage.key) ?? [])], safeWaitPoint: true,
        })),
        ...artifacts.significant.stages.map(stage => ({
          key: stage.key, storylineKey: stage.threadKey, order: stage.order,
          title: stage.title, summary: stage.summary, questKeys: questKeysForStage(stage.key),
          sceneKeys: [...new Set(sceneKeysByNarrativeStage.get(stage.key) ?? [])], safeWaitPoint: true,
        })),
      ],
      endings: artifacts.endings.endings.map(ending => ({
        key: ending.key, title: ending.title, summary: ending.outcomeSummary,
        conditionKeys: [endingBindings.routes.find(route => route.endingKey === ending.key)?.conditionKey
          ?? fail(`P8F缺少结局条件:${ending.key}`)],
      })),
      scenes: artifacts.scenes.scenes.map(scene => ({
        key: scene.key, order: scene.order, sourceKind: scene.sourceKind, sourceKey: scene.sourceKey,
        title: scene.title, purpose: scene.purpose, regionKey: scene.regionKey,
        locationKey: scene.locationKey, questKey: scene.questKey, stageKey: scene.stageKey,
        objectiveKey: scene.objectiveKey, actorKey: scene.actorKey,
        interactionKey: scene.interactionKey, randomEventKey: scene.randomEventKey,
        participantKeys: scene.participantKeys,
        openingText: scene.openingText, bodyText: scene.bodyText,
        successText: scene.successText, failureText: scene.failureText,
        attitudeOpenings: scene.attitudeOpenings,
        allowedKnowledgeClaimKeys: scene.allowedKnowledgeClaimKeys,
        forbiddenFutureObjectiveKeys: scene.forbiddenFutureObjectiveKeys,
        availabilityConditionKeys: scene.availabilityConditionKeys,
        actionKeys: scene.actionKeys, fixedChoiceKeys: scene.fixedChoiceKeys,
      })),
      fixedChoices: artifacts.choices.choices.map(choice => ({
        key: choice.key, sceneKey: choice.sceneKey, label: choice.label,
        description: choice.description, actionKey: choice.actionKey,
      })),
      randomEventPresentations: artifacts.scenes.randomEventPresentations.map(event => ({
        key: event.key, order: event.order, randomEventKey: event.randomEventKey,
        openingText: event.openingText, resolutionText: event.resolutionText,
        rumorKey: event.rumorKey, rumorRequirementKey: event.rumorRequirementKey,
        rumorText: event.rumorText,
        reliability: event.reliability, sourceClaimKeys: event.sourceClaimKeys,
      })),
    },
    world: {
      version: 3,
      initialLocationKey: artifacts.map.initialLocationKey,
      regions: artifacts.map.regions.map(region => {
        const encounterLevels = artifacts.encounters.encounters
          .filter(encounter => encounter.regionKey === region.key).map(encounter => encounter.levelBand)
        return {
          key: region.key, title: region.title, description: region.description, theme: region.theme,
          levelBand: encounterLevels.length ? {
            minimum: Math.min(...encounterLevels.map(item => item.minimum)),
            maximum: Math.max(...encounterLevels.map(item => item.maximum)),
          } : { minimum: 1, maximum: 5 },
          knowledgePolicy: region.initialKnowledge === 'visited' ? 'always-visible' as const : 'title-on-heard' as const,
          locationKeys: region.locationKeys, fastTravelPointKey: region.fastTravelPointKey,
          initialKnowledge: region.initialKnowledge, sourceRefs: region.sourceRefs,
          presentationRefs: [...new Set([...worldMapSlotKeys, ...(mediaSlotBySubject.get(region.key) ?? [])])],
        }
      }),
      locations: artifacts.map.locations.map(location => ({
        key: location.key, regionKey: location.regionKey, title: location.title, description: location.description,
        kind: location.kind, tags: [...location.functions], purpose: location.purpose, functions: location.functions,
        earlyArrivalDescription: location.earlyArrivalDescription, initialKnowledge: location.initialKnowledge,
        sourceRefs: location.sourceRefs,
        presentationRefs: [...new Set([...worldMapSlotKeys, ...(mediaSlotBySubject.get(location.regionKey) ?? [])])],
      })),
      edges: artifacts.map.edges.map(edge => ({
        key: edge.key, fromLocationKey: edge.fromLocationKey, toLocationKey: edge.toLocationKey,
        bidirectional: edge.bidirectional, travelMinutes: edge.travelMinutes,
        conditionKeys: edgeBindingByKey.get(edge.key)?.conditionKeys ?? [], description: edge.description,
        riskProfile: edge.riskProfile, sourceRefs: edge.sourceRefs,
      })),
      fastTravelPoints: artifacts.map.fastTravelPoints.map(point => ({
        key: point.key, locationKey: point.locationKey,
        unlockedByDefault: point.unlockedByDefault, canRespawn: point.canRespawn,
      })),
    },
    actors: {
      version: 3,
      player: {
        key: 'player', identity: artifacts.player.identity,
        build: artifacts.player.buildCandidate,
      },
      factions: artifacts.npcs.factions.map(faction => ({
        key: faction.key, title: faction.title, description: faction.description,
      })),
      actors: artifacts.npcs.actors.map(actor => ({
        key: actor.key, tier: actor.tier === 'mainline' ? 'mainline' : actor.tier === 'significant' ? 'significant' : actor.tier === 'transient' ? 'transient' : 'resident',
        name: actor.name, biography: actor.biography, portrayal: actor.portrayal,
        factionKey: actor.factionKey, homeLocationKey: actor.homeLocationKey,
        protected: actor.protected, mortalityPolicy: actor.mortalityPolicy,
        serviceKeys: serviceKeysByActor.get(actor.key) ?? [], scheduleKey: actor.scheduleKey,
      })),
      schedules: artifacts.npcs.schedules.map(schedule => ({
        key: schedule.key, actorKey: schedule.actorKey,
        entries: schedule.entries.map(entry => ({
          ...entry,
          availableServiceKeys: (serviceKeysByActor.get(schedule.actorKey) ?? []).filter(serviceKey => (
            artifacts.craftingEconomy.vendors.find(vendor => vendor.key === serviceKey)?.locationKey === entry.locationKey
          )),
        })),
      })),
      serviceContinuity: [...runtimeVendorKeys].map(serviceKey => {
        const ownerActorKey = vendorBindingByKey.get(serviceKey)?.actorKey ?? fail(`商店没有Actor绑定:${serviceKey}`)
        return {
          key: `service-continuity.${serviceKey}`, ownerActorKey, serviceKey,
          policy: 'disappear-on-owner-death' as const,
          replacementActorKey: null, replacementServiceKey: null,
        }
      }),
    },
    quests: {
      version: 2,
      quests: qdd.quests.map(quest => ({
        key: quest.key, type: quest.type, ownerKind: quest.ownerKind, ownerKey: quest.ownerKey,
        title: quest.title, description: quest.description, storylineKey: quest.storylineKey,
        regionKeys: quest.regionKeys, stageKeys: quest.stageKeys,
        prerequisiteConditionKeys: quest.prerequisiteConditionKeys, rewardEffectKeys: quest.rewardEffectKeys,
        rewardContractKey: quest.rewardContractKey, claimActionKey: quest.claimActionKey,
        lifecyclePolicy: quest.lifecyclePolicy, timePolicy: quest.timePolicy,
        expirationMinutes: quest.expirationMinutes, repeatable: quest.repeatable,
        instantiationPolicy: quest.instantiationPolicy, initialStatus: quest.initialStatus,
        estimatedMinutes: quest.estimatedMinutes, tags: quest.tags,
      })),
      stages: qdd.stages.map(stage => ({
        key: stage.key, questKey: stage.questKey, order: stage.order, title: stage.title,
        objectiveKeys: stage.objectiveKeys, completionConditionKeys: stage.completionConditionKeys,
        completionActionKey: stage.completionActionKey,
      })),
      objectives: qdd.objectives.map(objective => ({
        key: objective.key, stageKey: objective.stageKey, title: objective.title,
        optional: objective.optional,
        actionKeys: [...new Set([...objective.supportActionKeys, objective.completionActionKey])],
      })),
    },
    actions: {
      version: actionModuleVersion,
      conditions: qdd.conditions,
      effects: finalQuestEffects,
      actions: finalQuestActions,
      inputBindings: {
        sourceActionBindingsHash: artifacts.actionBindings.actionBindingsHash,
        actions: artifacts.actionBindings.actions,
        unmatchedNaturalLanguage: artifacts.actionBindings.unmatchedNaturalLanguage,
        thresholds: artifacts.actionBindings.thresholds,
        governance: artifacts.actionBindings.governance,
      },
    },
    progression: (actionModuleVersion === 17 ? {
      version: 2,
      rules: artifacts.progression.rules,
      levels: artifacts.progression.levels,
      skills: artifacts.progression.skills.map(skill => {
        const runtime = skillBindingByKey.get(skill.key) ?? fail(`技能未完成P8F绑定:${skill.key}`)
        if (runtime.effectKeys.length) fail(`Action v17技能不能保留旧Effect结果:${skill.key}`)
        const compiled = compileTextOpenWorldSkillMechanicV2({
          skill,
          statuses: artifacts.progression.statuses,
        })
        return {
          key: skill.key,
          title: skill.title,
          description: skill.description,
          tags: skill.tags,
          mechanic: compiled.mechanic,
          target: compiled.target,
          scalingAttribute: compiled.scalingAttribute,
          unlockSources: skill.unlockPlan.kind === 'initial'
            ? [{ kind: 'initial' as const, level: null, questKey: null }]
            : skill.unlockPlan.kind === 'level'
              ? [{ kind: 'level' as const, level: skill.unlockPlan.level, questKey: null }]
              : [{ kind: 'quest' as const, level: null, questKey: runtime.unlockQuestKey ?? fail(`任务技能未绑定任务:${skill.key}`) }],
          useConditionKeys: runtime.useConditionKeys,
          priority: skill.priority,
          resourceCost: skill.resourceCost,
          cooldownTurns: skill.cooldownTurns,
          effectKeys: [],
        }
      }),
      statuses: artifacts.progression.statuses.map(compileTextOpenWorldStatusDefinitionV2),
    } : {
      version: 1,
      rules: artifacts.progression.rules,
      levels: artifacts.progression.levels,
      skills: artifacts.progression.skills.map(skill => {
        const runtime = skillBindingByKey.get(skill.key) ?? fail(`技能未完成P8F绑定:${skill.key}`)
        return {
          key: skill.key, title: skill.title, description: skill.description, tags: skill.tags,
          activation: skill.activation, kind: skill.kind, target: skill.target,
          scalingAttribute: skill.scalingAttribute,
          unlockSources: skill.unlockPlan.kind === 'initial'
            ? [{ kind: 'initial' as const, level: null, questKey: null }]
            : skill.unlockPlan.kind === 'level'
              ? [{ kind: 'level' as const, level: skill.unlockPlan.level, questKey: null }]
              : [{ kind: 'quest' as const, level: null, questKey: runtime.unlockQuestKey ?? fail(`任务技能未绑定任务:${skill.key}`) }],
          useConditionKeys: runtime.useConditionKeys, priority: skill.priority,
          resourceCost: skill.resourceCost, cooldownTurns: skill.cooldownTurns, effectKeys: runtime.effectKeys,
        }
      }),
      statuses: artifacts.progression.statuses.map(status => ({
        key: status.key, title: status.title, description: status.description, polarity: status.polarity,
      })),
    }) as unknown as TextOpenWorldParsedModulesV1['progression'],
    combat: ({
      version: actionModuleVersion === 17 ? 4 : 3,
      rules: {
        difficulty: 'standard', defaultAttackHits: artifacts.encounters.rules.defaultAttackHits,
        playerPartyLimit: artifacts.encounters.rules.playerPartyLimit,
        allowFriendlyNpcCombatants: artifacts.encounters.rules.allowFriendlyNpcCombatants,
        allowElements: artifacts.encounters.rules.allowElements,
        allowEscape: artifacts.encounters.rules.allowEscape,
      },
      difficultyProfiles: artifacts.encounters.rules.difficultyProfiles,
      resolution: artifacts.encounters.rules.resolution,
      skillResolutions: artifacts.encounters.playerSkillResolutions,
      ...(actionModuleVersion === 17
        ? {}
        : { transientPlayerStatusKeys: artifacts.progression.statuses.map(status => status.key) }),
      strategyProfiles: artifacts.encounters.strategyProfiles,
      enemies: artifacts.encounters.enemies.map(enemy => ({
        key: enemy.key, familyKey: enemy.familyKey, title: enemy.title, description: enemy.description,
        tags: enemy.tags, level: enemy.level, maximumHealth: enemy.maximumHealth, attack: enemy.attack,
        defense: enemy.defense, criticalChance: enemy.criticalChance, initiative: enemy.initiative,
        skillKeys: enemy.skillKeys, strategyProfileKey: enemy.strategyProfileKey,
        dropTableKey: enemyBindingByKey.get(enemy.key)?.dropTableKey ?? null,
        sourceRefs: enemy.sourceRefs, presentationRefs: mediaSlotBySubject.get(enemy.key) ?? [],
      })),
      encounters: artifacts.encounters.encounters.map(encounter => {
        const runtime = encounterBindingByKey.get(encounter.key) ?? fail(`遭遇未完成P8F绑定:${encounter.key}`)
        return {
          key: encounter.key, title: encounter.title, description: encounter.description,
          locationKey: encounter.locationKey, questKeys: runtime.questKeys, enemyGroups: encounter.enemyGroups,
          recommendedLevel: encounter.recommendedLevel, levelBand: encounter.levelBand,
          difficultyProfileKey: encounter.difficultyProfileKey, intensity: encounter.intensity,
          escapePolicy: encounter.escapePolicy, defeatPolicy: encounter.defeatPolicy,
          rewardContractKey: runtime.rewardContractKey, openingText: encounter.openingText,
          victoryText: encounter.victoryText, defeatText: encounter.defeatText,
          sourceRefs: encounter.sourceRefs, presentationRefs: mediaSlotBySubject.get(encounter.key) ?? [],
        }
      }),
    }) as unknown as TextOpenWorldParsedModulesV1['combat'],
    items: {
      version: 1, equipmentSlots: artifacts.items.equipmentSlots,
      items: artifacts.items.items.map(item => {
        const runtime = itemBindingByKey.get(item.key) ?? fail(`物品未完成P8F绑定:${item.key}`)
        const critical = item.critical
        return {
          key: item.key, title: item.title, description: item.description, tags: item.tags,
          kind: critical ? 'quest' as const : item.kind,
          stackPolicy: critical ? 'instanced' as const : item.stackPolicy,
          maximumStack: critical ? null : item.maximumStack,
          unique: critical || item.unique, consumable: critical ? false : item.consumable,
          critical, droppable: critical ? false : item.droppable,
          sellable: critical ? false : item.sellable, baseValue: item.baseValue,
          useActionKey: critical ? null : runtime.useActionKey,
          equipActionKey: critical ? null : runtime.equipActionKey,
          unequipActionKey: critical ? null : runtime.unequipActionKey,
          equipConditionKeys: critical ? [] : runtime.equipConditionKeys,
          equipmentSlotKey: critical ? null : item.equipmentSlotKey,
          statModifiers: item.statModifiers, effectKeys: runtime.effectKeys,
          sourceRefs: item.sourceRefs, presentationRefs: mediaSlotBySubject.get(item.key) ?? [],
        }
      }),
      rewardContracts: artifacts.items.rewardContracts.map(reward => {
        const runtime = rewardBindingByKey.get(reward.key) ?? fail(`奖励未完成P8F绑定:${reward.key}`)
        return {
          key: reward.key, title: reward.title, sourceKind: reward.sourceKind,
          claimPolicy: 'once-per-source' as const, expectedMinutes: reward.expectedMinutes,
          budgetClass: reward.budgetClass, conditionKeys: runtime.conditionKeys,
          effectKeys: runtime.effectKeys, dropTableKeys: runtime.dropTableKeys,
        }
      }),
      dropTables: artifacts.items.dropTables.map(drop => {
        const runtime = dropBindingByKey.get(drop.key) ?? fail(`掉落表未完成P8F绑定:${drop.key}`)
        return {
          key: drop.key, algorithm: drop.algorithm, rolls: drop.rolls,
          conditionKeys: runtime.conditionKeys,
          entries: drop.entries.map(entry => ({
            itemKey: entry.itemKey, minimum: entry.minimum, maximum: entry.maximum,
            weight: entry.weight, uniquePolicy: entry.uniquePolicy,
            quantityEffects: runtime.quantityEffectBindings
              .filter(item => item.itemKey === entry.itemKey)
              .map(item => ({ quantity: item.quantity, effectKey: item.effectKey })),
          })),
        }
      }),
    },
    crafting: {
      version: 2,
      sourceVersion: 2,
      rules: {
        successPolicy: artifacts.craftingEconomy.craftingRules.successPolicy,
        maximumBatchQuantity: artifacts.craftingEconomy.craftingRules.maximumBatchQuantity,
        maximumTotalItemUnitsPerAction: artifacts.craftingEconomy.craftingRules.maximumTotalItemUnitsPerAction,
      },
      recipes: artifacts.craftingEconomy.recipes.map(recipe => {
        const runtime = recipeBindingByKey.get(recipe.key) ?? fail(`配方未完成P8F绑定:${recipe.key}`)
        return {
          key: recipe.key, title: recipe.title, description: recipe.description,
          category: recipe.category, learnedByDefault: recipe.learnedByDefault,
          stationLocationKeys: recipe.stationLocationKeys,
          requirementConditionKeys: runtime.requirementConditionKeys,
          ingredients: recipe.ingredients, outputs: recipe.outputs, timeCostMinutes: recipe.timeCostMinutes,
          presentationRefs: mediaSlotBySubject.get(recipe.key) ?? [],
        }
      }),
    },
    economy: {
      version: 2,
      sourceVersion: 2,
      currency: artifacts.craftingEconomy.currency,
      rules: {
        maximumTransactionQuantity: artifacts.craftingEconomy.economyRules.maximumTransactionQuantity,
        maximumTransactionTotal: artifacts.craftingEconomy.economyRules.maximumTransactionTotal,
      },
      vendors: artifacts.craftingEconomy.vendors.map(vendor => {
        const runtime = vendorBindingByKey.get(vendor.key) ?? fail(`商店未完成P8F绑定:${vendor.key}`)
        return {
          key: vendor.key, title: vendor.title, actorKey: runtime.actorKey,
          locationKey: vendor.locationKey, factionKey: runtime.factionKey,
          buyPriceMultiplierBasisPoints: vendor.buyPriceMultiplierBasisPoints,
          sellPriceMultiplierBasisPoints: vendor.sellPriceMultiplierBasisPoints,
          buyCategories: vendor.buyCategories, sellCategories: vendor.sellCategories,
          inventoryEntries: vendor.inventoryEntries,
          availabilityConditionKeys: runtime.availabilityConditionKeys,
          buyActionKey: runtime.buyActionKey, sellActionKey: runtime.sellActionKey,
        }
      }),
    },
    relationships: {
      version: 3,
      morality: artifacts.npcs.relationshipPolicy.morality,
      factionAffinity: artifacts.npcs.relationshipPolicy.factionAffinity,
      attitude: artifacts.npcs.relationshipPolicy.attitude,
      storyModifiers: storyModifierRows,
      unaffiliatedMoralityMultiplier: artifacts.npcs.relationshipPolicy.unaffiliatedMoralityMultiplier,
      factionMorality: artifacts.npcs.factions.map(faction => ({
        factionKey: faction.key, moralityMultiplier: faction.moralityMultiplier,
      })),
      attitudeBands: artifacts.npcs.relationshipPolicy.attitudeBands,
      crimeActions: [],
    },
    'time-weather': {
      version: 2, initialWorldMinute: 360, minutesPerDay: 1_440, weatherUpdateIntervalMinutes: 360,
      timePeriods: [
        { key: 'period.dawn', label: '清晨', startMinute: 0, endMinute: 360 },
        { key: 'period.day', label: '白天', startMinute: 360, endMinute: 900 },
        { key: 'period.evening', label: '傍晚', startMinute: 900, endMinute: 1_080 },
        { key: 'period.night', label: '夜晚', startMinute: 1_080, endMinute: 1_440 },
      ],
      weather: [
        { key: 'weather.clear', label: '晴朗', description: '天空清明，旅途与视野保持稳定。' },
        { key: 'weather.overcast', label: '阴云', description: '云层压低，地区气氛显得凝重。' },
        { key: 'weather.rain', label: '降雨', description: '雨水覆盖道路与屋瓦，环境声变得明显。' },
      ],
      regionWeatherTables: artifacts.map.regions.map(region => ({
        regionKey: region.key,
        entries: [
          { weatherKey: 'weather.clear', weight: 5 },
          { weatherKey: 'weather.overcast', weight: 3 },
          { weatherKey: 'weather.rain', weight: 2 },
        ],
      })),
    },
    director: {
      version: 2,
      sourceVersion: 2,
      rules: { ...artifacts.director.rules, systemActionKey: artifacts.director.rules.systemActionKey },
      decks: artifacts.director.decks.map(deck => ({
        regionKey: deck.regionKey, questKeys: deck.fixedQuestKeys, templateKeys: deck.templateKeys,
        randomEventKeys: deck.randomEventKeys, triggerKinds: deck.triggerKinds,
        maximumRevealed: deck.maximumRevealed, maximumActive: deck.maximumActive,
        cooldownMinutes: deck.cooldownMinutes, blankWeight: deck.blankWeight,
      })),
      templates: artifacts.director.templates.map(template => ({
        key: template.key, questKey: template.questKey, regionKeys: template.regionKeys,
        variantTextKeys: artifacts.scenes.templateTextVariants
          .filter(variant => variant.templateKey === template.key).map(variant => variant.key),
        fingerprint: template.fingerprint, cooldownMinutes: template.cooldownMinutes,
        conditionKeys: template.conditionKeys, levelBand: template.levelBand,
        category: template.category, intensity: template.intensity, weight: template.weight,
      })),
      randomEvents: artifacts.director.randomEvents.map(event => ({
        key: event.key, title: event.title, kind: event.kind, regionKeys: event.regionKeys,
        actionKeys: event.actionKeys, effectKeys: event.effectKeys, conditionKeys: event.conditionKeys,
        fingerprint: event.fingerprint,
        rumorKey: artifacts.scenes.randomEventPresentations.find(item => item.randomEventKey === event.key)?.rumorKey ?? null,
        upgradeTemplateKey: event.upgradeTemplateKey, intensity: event.intensity,
        weight: event.weight, cooldownMinutes: event.cooldownMinutes,
      })),
      regionRules: artifacts.director.regionRules,
    },
    knowledge: {
      version: 1,
      entries: [...sourceKnowledge, ...rumorKnowledge],
      rumors: artifacts.scenes.randomEventPresentations.flatMap(item => item.rumorKey && item.rumorText ? [{
        key: item.rumorKey, knowledgeKey: `knowledge.${item.rumorKey}`,
        text: item.rumorText, reliability: item.reliability ?? 'uncertain',
      }] : []),
      achievements: [],
    },
    presentation: {
      version: 2,
      textStyle: {
        narrationTone: artifacts.experience.toneGuide.join('、') || '沉浸而克制',
        dialogueStyle: '符合角色小传、当前态度与已知信息边界',
        systemReceiptStyle: '清楚说明确定性结果、数值变化与不可执行原因',
      },
      mapLayout: { ...artifacts.map.mapLayout, source: 'authored' },
      mediaSlots: artifacts.media.slots.map(slot => ({
        key: slot.key, kind: runtimeMediaKind(slot.kind), consumerRef: slot.consumerKeys.join(','),
        required: slot.required, assetKey: assetKeyBySlot.get(slot.key) ?? null,
        fallbackText: `${slot.title}：${slot.creativeBrief}`,
        altText: slot.title,
      })),
      taskTextVariants: artifacts.scenes.templateTextVariants.map(variant => ({
        key: variant.key, templateKey: variant.templateKey, title: variant.title, description: variant.description,
      })),
      tutorials: finalQuestActions.find(action => action.actorScope === 'player') ? [{
        key: 'tutorial.first-action',
        triggerActionKey: finalQuestActions.find(action => action.actorScope === 'player')!.key,
        targetUiKey: 'play.system-actions', title: '行动方式',
        body: '可以点击系统行动、选择固定选项，或输入自然语言；所有实际结果都由同一行动规则结算。',
      }] : [],
    },
  }
}

async function envelopes(
  modules: TextOpenWorldParsedModulesV1,
  artifacts: V3Artifacts,
): Promise<TextOpenWorldRuntimePackageV1['modules']> {
  const configByKey = new Map(artifacts.system.runtimeModules.map(module => [module.moduleKey, module]))
  return Object.fromEntries(await Promise.all(TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.map(async moduleKey => {
    const config = configByKey.get(moduleKey) ?? fail(`SystemConfigs缺少模块:${moduleKey}`)
    const payloadValue = structuredClone(modules[moduleKey]) as unknown as Record<string, unknown>
    delete payloadValue.sourceVersion
    return [moduleKey, {
      moduleKey, schemaVersion: config.schemaVersion,
      contentHash: await hashProductProductionValueV2(payloadValue),
      dependencies: MODULE_DEPENDENCIES[moduleKey] ?? [],
      payload: payloadValue,
    }]
  }))) as TextOpenWorldRuntimePackageV1['modules']
}

function productNarrativeShell(artifacts: V3Artifacts): ProductRuntimePackageV1['narrative'] {
  const entryKey = 'runtime.entry'
  const endingNodes = artifacts.endings.endings.map(ending => ({
    key: `runtime.${ending.key}`, kind: 'ending' as const, title: ending.title,
    summary: ending.outcomeSummary, conditionJson: '{}', effectsJson: '[]', successorKeys: [],
  }))
  return {
    moduleKind: 'main', moduleTitle: artifacts.gameBrief.title, entryNodeKey: entryKey,
    nodes: [{
      key: entryKey, kind: 'entry', title: artifacts.gameBrief.title,
      summary: artifacts.storyArc.logline, conditionJson: '{}', effectsJson: '[]',
      successorKeys: endingNodes.map(node => node.key),
    }, ...endingNodes],
    beats: [{
      beatKey: 'runtime.beat.opening', nodeKey: entryKey, kind: 'narration', speakerKey: null,
      text: artifacts.scenes.scenes[0]?.openingText ?? artifacts.gameBrief.authorIntent.openingSituation,
      order: 0,
    }],
    choices: artifacts.endings.endings.map((ending, index) => ({
      choiceKey: `runtime.choice.${ending.key}`, sourceNodeKey: entryKey,
      text: ending.title, description: ending.eligiblePathSummary, unavailableReason: '',
      targetNodeKey: `runtime.${ending.key}`, displayConditionJson: '{}',
      // The generic narrative graph is a compatibility index only. It must
      // never expose all endings at game start; vNext reaches them through
      // the governed ending Actions in the final mainline scene.
      availableConditionJson: JSON.stringify({
        path: 'compatibility.textOpenWorldEndingActionReady', eq: true,
      }),
      effectsJson: '[]', tags: ['compatibility-shell'], order: index,
    })),
  }
}

export async function compileTextOpenWorldRuntimePackageV1(input: {
  execution: ProductProductionTaskExecutionInputV1
  createdAt?: number
}): Promise<{ runtimePackage: ProductRuntimePackageV1; report: TextOpenWorldIntegrationReportV1 }> {
  await validateV3ArtifactClosure(input.execution)
  const artifacts = readV3Artifacts(input.execution)
  validateV3HashChain(artifacts)
  if (artifacts.preflight.result.blockingCheckKeys.length || artifacts.balance.verdict !== 'pass'
    || artifacts.semantic.verdict !== 'pass') fail('V1/V2仍有阻断项，不能进入V3')
  // Reopen the exact authorized shared Brief before media verification. P2's
  // GameBrief is immutable production data, but commercial policy and provider
  // rights must also close against the source authorization that owns them.
  const productionBriefRow = await db.productProductionBriefs
    .where('[productionId+revision]').equals([
      input.execution.productionId, artifacts.gameBrief.authorization.productBriefRevision,
    ]).first() ?? fail('找不到授权Product Brief')
  const sharedBrief = parseProductProductionBriefV3(productionBriefRow.briefJson)
  if (productionBriefRow.status !== 'authorized'
    || productionBriefRow.briefHash !== artifacts.gameBrief.authorization.productBriefHash
    || await hashProductProductionValueV2(sharedBrief) !== productionBriefRow.briefHash
    || sharedBrief.intent.productType !== 'text-open-world'
    || sharedBrief.qualityProfile !== artifacts.gameBrief.qualityProfile
    || sharedBrief.media.imageCount !== artifacts.gameBrief.media.imageCount
    || sharedBrief.media.musicTrackCount !== artifacts.gameBrief.media.musicTrackCount
    || sharedBrief.media.sfxCount !== artifacts.gameBrief.media.sfxCount
    || sharedBrief.media.voiceLineCount !== artifacts.gameBrief.media.voiceLineCount
    || Math.max(1, sharedBrief.completionContract.minimumMediaCoverage)
      !== artifacts.gameBrief.completion.minimumMediaCoverage) {
    fail('V3 GameBrief与授权Product Brief不一致')
  }
  const mediaBindings = await generatedMediaBindings(input.execution, artifacts.media, sharedBrief)
  const modulePayloads = compileModulePayloads(artifacts, mediaBindings.assetKeyBySlot)
  const innerCandidate: TextOpenWorldRuntimePackageV1 = {
    schema: 'storyforge.text-open-world.runtime-package', version: 1,
    metadata: {
      packageKey: `game.${artifacts.gameBrief.productInstanceKey.toLowerCase().replace(/[^a-z0-9._:-]/g, '-')}`,
      title: artifacts.gameBrief.title, description: artifacts.experience.pitch,
      contentLanguage: artifacts.presentationProfile.contentLanguage,
      rulesetKey: artifacts.system.productInstanceKey === artifacts.gameBrief.productInstanceKey
        ? 'storyforge.standard' : fail('SystemConfigs产品身份不一致'),
      rulesetVersion: 1,
    },
    sourceManifest: {
      kind: artifacts.sourcePin.sourceKind === 'world-release' ? 'world-release' : 'novel-source-pin',
      sourceKey: `source.${artifacts.sourcePin.sourceKind}.${artifacts.sourcePin.sourceVersionHash.slice(0, 16)}`,
      sourceVersion: artifacts.sourcePin.source.kind === 'world-release'
        ? artifacts.sourcePin.source.releaseVersion : artifacts.sourcePin.source.snapshotVersion,
      contentHash: artifacts.sourcePin.sourceVersionHash,
      selectionHash: artifacts.sourcePin.sourceBoundaryHash,
      resourceHashes: artifacts.sourcePin.units.map(unit => ({
        resourceId: unit.sourceResourceKey ?? unit.unitKey, contentHash: unit.sourceContentHash,
      })),
    },
    experienceContract: {
      corePromise: artifacts.experience.pitch, coreGoal: artifacts.storyArc.coreConflict.coreGoal,
      freedomBoundary: artifacts.experience.freedom.mode,
      mainlinePolicy: 'strict-sequence', endingCount: artifacts.endings.endingCount,
      requiredPlayMinutes: artifacts.gameBrief.scale.requiredPlayMinuteRange,
      optionalInventoryMinutes: artifacts.gameBrief.scale.optionalInventoryMinuteRange,
    },
    calibration: DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1,
    modules: await envelopes(modulePayloads, artifacts),
    mediaManifest: {
      version: 1, slotKeys: artifacts.media.slots.map(slot => slot.key),
      requiredSlotKeys: artifacts.media.slots.filter(slot => slot.required).map(slot => slot.key),
    },
    qualityManifest: {
      version: 1,
      hardGateIds: [...new Set([
        ...artifacts.gameBrief.completion.requiredGateIds,
        ...artifacts.preflight.result.passedCheckKeys,
      ])].sort(),
      softMetricIds: [...artifacts.balance.scores.map(score => `balance.${score.metricKey}`),
        ...artifacts.semantic.scores.map(score => `semantic.${score.metricKey}`)].sort(),
      waivedMetricIds: [],
    },
    compatibility: {
      minimumReaderVersion: 1, compatiblePreviousPackageHashes: [], legacyInputKinds: [],
      migrationPolicy: 'old-release-pinned',
    },
  }
  const inner = parseTextOpenWorldRuntimePackageV1(innerCandidate)
  parseTextOpenWorldModulesV1(inner)
  createInitialTextOpenWorldSessionProjectionV1(inner)
  const outerCandidate: ProductRuntimePackageV1 = {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'text-open-world',
    definition: {
      productKey: artifacts.gameBrief.productInstanceKey, title: artifacts.gameBrief.title,
      description: artifacts.experience.pitch,
      enabledCapabilities: mediaBindings.assets.length
        ? ['narrative', 'textOpenWorldVNext', 'presentation']
        : ['narrative', 'textOpenWorldVNext'],
      rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: artifacts.sourcePin.sourceVersionHash,
      selection: {} as ProductRuntimePackageV1['sourceWorld']['selection'],
    },
    narrative: productNarrativeShell(artifacts),
    ...(mediaBindings.assets.length ? {
      presentation: { version: 1 as const, cues: [], assets: mediaBindings.assets },
    } : {}),
    textOpenWorldVNext: inner,
  }
  // The outer release contract uses the exact selection frozen in the shared
  // authorized Brief; never reconstruct it from generated content.
  if (sharedBrief.source.worldContentHash !== artifacts.sourcePin.sourceVersionHash) {
    fail('SourcePin与授权Brief来源Hash不一致')
  }
  outerCandidate.sourceWorld = {
    contentHash: sharedBrief.source.worldContentHash,
    selection: sharedBrief.source.selection,
  }
  const runtimePackage = parseProductRuntimePackageV1(outerCandidate)
  const runtimePackageHash = await hashProductProductionValueV2(runtimePackage)
  const createdAt = input.createdAt ?? Date.now()
  const fallbackKeys = artifacts.media.slots
    .filter(slot => !mediaBindings.assetKeyBySlot.has(slot.key) && slot.fallback !== 'silent')
    .map(slot => slot.key)
  const generatedMediaArtifactKeys = mediaBindings.artifactKeys
  const coverage = evaluateTextOpenWorldMediaCoverageV1({
    requirements: artifacts.media,
    generatedSlotKeys: mediaBindings.assetKeyBySlot.keys(),
    qualityProfile: artifacts.gameBrief.qualityProfile,
    minimumCoverage: artifacts.gameBrief.completion.minimumMediaCoverage,
  })
  const mediaEvidenceBody = {
    qualityProfile: artifacts.gameBrief.qualityProfile,
    slotCount: artifacts.media.slots.length,
    requiredSlotCount: coverage.requiredSlotCount,
    requiredGeneratedSlotCount: coverage.requiredGeneratedSlotCount,
    generatedBindingCount: mediaBindings.assetKeyBySlot.size,
    generatedRequiredBindingCount: coverage.generatedRequiredBindingCount,
    fallbackReadyCount: coverage.fallbackReadyCount,
    playableCoverage: coverage.playableCoverage,
    generatedRequiredCoverage: coverage.generatedRequiredCoverage,
    evaluatedCoverage: coverage.evaluatedCoverage,
    minimumCoverage: coverage.minimumCoverage,
    releaseReady: coverage.releaseReady,
  }
  const mediaReport: TextOpenWorldIntegrationReportV1['media'] = {
    ...mediaEvidenceBody,
    coverageEvidenceHash: await hashProductProductionValueV2(mediaEvidenceBody),
  }
  const rightsEvidenceBody = {
    evaluatedArtifactCount: mediaBindings.rightsEvidence.length,
    evidence: mediaBindings.rightsEvidence,
    complete: true as const,
    commercialPolicyPassed: mediaBindings.rightsEvidence.every(item => item.commercialPolicyPassed),
  }
  const rightsReport: TextOpenWorldIntegrationReportV1['rights'] = {
    ...rightsEvidenceBody,
    rightsEvidenceHash: await hashProductProductionValueV2(rightsEvidenceBody),
  }
  const basisHash = await hashProductProductionValueV2({
    runtimePackageHash, sourcePinHash: artifacts.sourcePin.pinHash,
    systemConfigsHash: artifacts.system.systemConfigsHash,
    deterministicPreflightHash: artifacts.preflight.deterministicPreflightHash,
    balanceReviewHash: artifacts.balance.balanceReviewHash,
    semanticReviewHash: artifacts.semantic.semanticReviewHash,
    coverageEvidenceHash: mediaReport.coverageEvidenceHash,
    rightsEvidenceHash: rightsReport.rightsEvidenceHash,
  })
  const reportBody: Omit<TextOpenWorldIntegrationReportV1, 'integrationReportHash'> = {
    schema: 'storyforge.text-open-world-integration-report', version: 1,
    productType: 'text-open-world', productInstanceKey: artifacts.gameBrief.productInstanceKey,
    runtimePackageHash, sourcePinHash: artifacts.sourcePin.pinHash,
    systemConfigsHash: artifacts.system.systemConfigsHash,
    deterministicPreflightHash: artifacts.preflight.deterministicPreflightHash,
    balanceReviewHash: artifacts.balance.balanceReviewHash,
    semanticReviewHash: artifacts.semantic.semanticReviewHash,
    modules: TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.map(moduleKey => ({
      moduleKey, schemaVersion: inner.modules[moduleKey].schemaVersion,
      contentHash: inner.modules[moduleKey].contentHash,
      sourceArtifactKeys: artifacts.system.runtimeModules.find(item => item.moduleKey === moduleKey)!.sourceArtifactKeys,
      parsed: true,
    })),
    generatedBindings: {
      endingActionKeys: artifacts.quests.endingBindings.routes.map(route => route.actionKey),
      generatedMediaArtifactKeys, fallbackMediaSlotKeys: fallbackKeys,
    },
    verification: {
      productPackageParsed: true, allModulesParsed: true,
      initialProjectionCreated: true, mainlineHasStart: qddHasStart(artifacts.quests),
      endingActionsReachable: true, sourceProvenanceClosed: true,
      rightsEvidenceClosed: true, mediaCoveragePolicyEvaluated: true,
    },
    media: mediaReport,
    rights: rightsReport,
    governance: {
      compilerOnly: true, acceptedArtifactsNeverMutated: true,
      runtimeStateSessionOwned: true, productReleaseOwned: true,
    },
    basisHash, createdAt,
  }
  return {
    runtimePackage,
    report: { ...reportBody, integrationReportHash: await hashProductProductionValueV2(reportBody) },
  }
}

function qddHasStart(qdd: TextOpenWorldQuestDesignDocumentsV1): true {
  if (!qdd.quests.some(quest => quest.type === 'mainline' && quest.initialStatus === 'revealed')) {
    fail('主线没有可见起点')
  }
  return true
}

async function validateIntegrationReportV1(input: {
  runtimePackage: ProductRuntimePackageV1
  report: TextOpenWorldIntegrationReportV1
}): Promise<TextOpenWorldIntegrationReportV1> {
  const { runtimePackage, report } = input
  if (report.schema !== 'storyforge.text-open-world-integration-report' || report.version !== 1
    || report.productType !== 'text-open-world' || !runtimePackage.textOpenWorldVNext
    || report.productInstanceKey !== runtimePackage.definition.productKey) fail('IntegrationReport身份无效')
  const reportBody = { ...report }
  delete (reportBody as Partial<TextOpenWorldIntegrationReportV1>).integrationReportHash
  if (!isSha256Hash(report.integrationReportHash)
    || await hashProductProductionValueV2(reportBody) !== report.integrationReportHash) {
    fail('IntegrationReport自身Hash不匹配')
  }
  const packageHash = await hashProductProductionValueV2(runtimePackage)
  if (packageHash !== report.runtimePackageHash) fail('IntegrationReport与RuntimePackage Hash不一致')
  const parsedModules = parseTextOpenWorldModulesV1(runtimePackage.textOpenWorldVNext)
  const moduleKeys = new Set(report.modules.map(item => item.moduleKey))
  if (report.modules.length !== TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.length
    || moduleKeys.size !== report.modules.length
    || TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.some(key => !moduleKeys.has(key))) {
    fail('IntegrationReport模块集合不完整')
  }
  for (const module of report.modules) {
    const envelope = runtimePackage.textOpenWorldVNext.modules[module.moduleKey]
    if (!module.parsed || module.schemaVersion !== envelope.schemaVersion
      || module.contentHash !== envelope.contentHash || !module.sourceArtifactKeys.length) {
      fail(`IntegrationReport模块证据不一致:${module.moduleKey}`)
    }
  }
  const mediaBody = { ...report.media }
  delete (mediaBody as Partial<TextOpenWorldIntegrationReportV1['media']>).coverageEvidenceHash
  if (!isSha256Hash(report.media.coverageEvidenceHash)
    || await hashProductProductionValueV2(mediaBody) !== report.media.coverageEvidenceHash) {
    fail('IntegrationReport媒资覆盖证据Hash不匹配')
  }
  const coverageNumbers = [
    report.media.playableCoverage, report.media.generatedRequiredCoverage,
    report.media.evaluatedCoverage, report.media.minimumCoverage,
  ]
  const coverageCounts = [
    report.media.slotCount, report.media.requiredSlotCount,
    report.media.requiredGeneratedSlotCount, report.media.generatedBindingCount,
    report.media.generatedRequiredBindingCount, report.media.fallbackReadyCount,
  ]
  if (coverageNumbers.some(value => !Number.isFinite(value) || value < 0 || value > 1)
    || coverageCounts.some(value => !Number.isSafeInteger(value) || value < 0)
    || report.media.evaluatedCoverage !== (report.media.qualityProfile === 'commercial-candidate'
      ? report.media.generatedRequiredCoverage : report.media.playableCoverage)
    || report.media.releaseReady !== (report.media.evaluatedCoverage >= report.media.minimumCoverage)) {
    fail('IntegrationReport媒资覆盖结论无效')
  }
  const rightsBody = { ...report.rights }
  delete (rightsBody as Partial<TextOpenWorldIntegrationReportV1['rights']>).rightsEvidenceHash
  if (!isSha256Hash(report.rights.rightsEvidenceHash)
    || await hashProductProductionValueV2(rightsBody) !== report.rights.rightsEvidenceHash
    || !report.rights.complete || !report.rights.commercialPolicyPassed
    || report.rights.evaluatedArtifactCount !== report.rights.evidence.length) {
    fail('IntegrationReport媒资权利总证据无效')
  }
  for (const evidence of report.rights.evidence) {
    const evidenceBody = { ...evidence }
    delete (evidenceBody as Partial<typeof evidence>).evidenceHash
    if (!isSha256Hash(evidence.evidenceHash)
      || await hashProductProductionValueV2(evidenceBody) !== evidence.evidenceHash
      || !isSha256Hash(evidence.producerReceiptHash)
      || (evidence.providerReceiptHash != null && !isSha256Hash(evidence.providerReceiptHash))) {
      fail(`IntegrationReport媒资权利明细无效:${evidence.artifactKey}`)
    }
  }
  const generatedArtifactKeys = [...report.generatedBindings.generatedMediaArtifactKeys].sort()
  const evidenceArtifactKeys = report.rights.evidence.map(item => item.artifactKey).sort()
  const runtimeAssets = runtimePackage.presentation?.assets ?? []
  const runtimeAssetKeys = runtimeAssets.map(item => item.assetKey).sort()
  const boundSlotAssetKeys = parsedModules.presentation.mediaSlots
    .flatMap(slot => slot.assetKey == null ? [] : [slot.assetKey]).sort()
  const evidenceAssetKeys = report.rights.evidence.map(item => item.assetKey).sort()
  if (generatedArtifactKeys.join('|') !== evidenceArtifactKeys.join('|')
    || runtimeAssetKeys.join('|') !== evidenceAssetKeys.join('|')
    || runtimeAssetKeys.join('|') !== boundSlotAssetKeys.join('|')
    || runtimeAssets.length !== report.media.generatedBindingCount
    || report.media.slotCount !== parsedModules.presentation.mediaSlots.length
    || report.media.requiredSlotCount !== runtimePackage.textOpenWorldVNext.mediaManifest.requiredSlotKeys.length) {
    fail('IntegrationReport媒资绑定、权利或槽位集合不闭合')
  }
  for (const asset of runtimeAssets) {
    const evidence = report.rights.evidence.find(item => item.assetKey === asset.assetKey)
      ?? fail(`IntegrationReport缺少媒资权利:${asset.assetKey}`)
    if (asset.source !== evidence.source || asset.license !== evidence.license) {
      fail(`IntegrationReport媒资权利与运行包不一致:${asset.assetKey}`)
    }
  }
  const expectedBasisHash = await hashProductProductionValueV2({
    runtimePackageHash: report.runtimePackageHash, sourcePinHash: report.sourcePinHash,
    systemConfigsHash: report.systemConfigsHash,
    deterministicPreflightHash: report.deterministicPreflightHash,
    balanceReviewHash: report.balanceReviewHash, semanticReviewHash: report.semanticReviewHash,
    coverageEvidenceHash: report.media.coverageEvidenceHash,
    rightsEvidenceHash: report.rights.rightsEvidenceHash,
  })
  if (report.basisHash !== expectedBasisHash
    || !Object.values(report.verification).every(value => value === true)) {
    fail('IntegrationReport基础证据或验证结论无效')
  }
  return report
}

function zeroUsage(): ProductProductionTaskExecutionResultV1['usage'] {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0 }
}

export function createTextOpenWorldRuntimePackageExecutorV1(options: { now?: () => number } = {}): ProductProductionTaskExecutorV1 {
  return async execution => {
    if (execution.task.taskKey !== 'v3.runtime-package' || execution.task.executionMode !== 'deterministic') {
      fail('V3 executor收到错误任务')
    }
    const compiled = await compileTextOpenWorldRuntimePackageV1({ execution, createdAt: (options.now ?? Date.now)() })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.runtime-package', kind: 'text-open-world.runtime-package',
        payload: compiled.runtimePackage,
        quality: { parser: 'parseProductRuntimePackageV1', playable: true },
        rights: { sourcePinHash: compiled.report.sourcePinHash },
      }, {
        artifactKey: 'text-open-world.integration-report', kind: 'text-open-world.integration-report',
        payload: compiled.report,
        quality: { allModulesParsed: true, initialProjectionCreated: true },
        rights: { sourcePinHash: compiled.report.sourcePinHash },
      }],
      passedGateIds: [...execution.task.acceptanceGateIds], usage: zeroUsage(),
    }
  }
}

export function createTextOpenWorldReleaseQaExecutorV1(): ProductProductionTaskExecutorV1 {
  return async execution => {
    if (execution.task.taskKey !== 'qa.release' || execution.task.executionMode !== 'deterministic') {
      fail('QA executor收到错误任务')
    }
    const runtimePackage = parseProductRuntimePackageV1(payload(execution, 'text-open-world.runtime-package'))
    const report = await validateIntegrationReportV1({
      runtimePackage,
      report: payload<TextOpenWorldIntegrationReportV1>(execution, 'text-open-world.integration-report'),
    })
    const packageHash = await hashProductProductionValueV2(runtimePackage)
    const hardEvidence: Record<string, { passed: boolean; evidence: string[] }> = {
      'runtime.package.valid': {
        passed: packageHash === report.runtimePackageHash,
        evidence: [packageHash, report.integrationReportHash],
      },
      'runtime.playable': {
        passed: report.media.playableCoverage >= 1
          && report.verification.initialProjectionCreated && report.verification.mainlineHasStart,
        evidence: [report.deterministicPreflightHash, `playableCoverage=${report.media.playableCoverage}`],
      },
      'narrative.graph.valid': {
        passed: report.verification.mainlineHasStart && report.verification.endingActionsReachable,
        evidence: [report.deterministicPreflightHash, report.semanticReviewHash],
      },
      'rights.complete': {
        passed: report.rights.complete && report.rights.commercialPolicyPassed,
        evidence: [report.rights.rightsEvidenceHash, ...report.rights.evidence.map(item => item.evidenceHash)],
      },
    }
    const hardGateResults = execution.task.acceptanceGateIds.map(gateId => ({
      gateId,
      ...(hardEvidence[gateId] ?? { passed: false, evidence: [`unsupported-gate:${gateId}`] }),
    }))
    if (hardGateResults.some(gate => !gate.passed)) {
      fail(`QA硬门失败:${hardGateResults.filter(gate => !gate.passed).map(gate => gate.gateId).join(',')}`)
    }
    const warnings = [
      ...(report.generatedBindings.fallbackMediaSlotKeys.length
        ? ['部分媒资槽使用文字或程序化fallback。原型/内部档仍可玩，但不计入商业真实资产覆盖。'] : []),
      ...(!report.media.releaseReady
        ? [`媒资覆盖 ${report.media.evaluatedCoverage.toFixed(2)} 低于当前质量档要求 ${report.media.minimumCoverage.toFixed(2)}。`] : []),
      '任务时长为生产估算；正式发布后的真人游玩数据用于后续版本校准。',
    ]
    const quality: ProductBuildQualityReportV1 = {
      schema: 'storyforge.product-build-quality-report', version: 1,
      buildNumber: execution.buildNumber, packageHash,
      hardGateResults,
      softGateResults: [{
        gateId: 'media.coverage', passed: report.media.releaseReady,
        evidence: [report.media.coverageEvidenceHash,
          `coverage=${report.media.evaluatedCoverage}`, `required=${report.media.minimumCoverage}`],
      }, {
        gateId: 'human.playtime-calibration', passed: false,
        evidence: ['发布后由真人游玩数据校准，不阻断直接发布。'],
      }],
      mediaCoverage: report.media.evaluatedCoverage,
      playable: report.media.playableCoverage >= 1,
      releaseReady: report.media.releaseReady,
      warnings,
    }
    parseProductBuildQualityReportV1(JSON.stringify(quality))
    return {
      artifacts: [{
        artifactKey: 'text-open-world.quality-report', kind: 'text-open-world.quality-report',
        payload: quality, quality: { hardGatesPassed: true, releaseReady: quality.releaseReady },
        rights: { sourcePinHash: report.sourcePinHash },
      }],
      passedGateIds: [...execution.task.acceptanceGateIds], usage: zeroUsage(),
    }
  }
}
