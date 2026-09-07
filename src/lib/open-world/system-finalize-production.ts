import type { ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { db } from '../db/schema'
import { readAcceptedBuildArtifacts } from '../product-production/artifact-store'
import { runConfiguredProductionTextV1, type ProviderBindingReceiptV1 } from '../product-production/capabilities'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/production-executor'
import type { ProductProductionTaskExecutionResultV1, ProductProductionTaskExecutorV1 } from '../product-production/scheduler'
import type { AssembleContextInput } from '../registry/types'
import {
  TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1,
  type ProductBuildArtifactRecordV1,
  type TextOpenWorldActionBindingsV1,
  type TextOpenWorldChoiceContractsV1,
  type TextOpenWorldContentBudgetV1,
  type TextOpenWorldCraftingEconomyCatalogV1,
  type TextOpenWorldDeterministicPreflightV1,
  type TextOpenWorldDirectorDecksV1,
  type TextOpenWorldEnemyEncounterCatalogV1,
  type TextOpenWorldExperienceContractV1,
  type TextOpenWorldGameBriefV1,
  type TextOpenWorldGameplayRulesetSkeletonV1,
  type TextOpenWorldItemRewardCatalogV1,
  type TextOpenWorldMapInteractionCatalogV1,
  type TextOpenWorldMediaRequirementsV1,
  type TextOpenWorldMediaSlotKindV1,
  type TextOpenWorldNpcRuntimeCatalogV1,
  type TextOpenWorldPlayerBuildV1,
  type TextOpenWorldPresentationProfileV1,
  type TextOpenWorldProductionArtifactKindV1,
  type TextOpenWorldProgressionCatalogsV1,
  type TextOpenWorldQuestDesignDocumentsV1,
  type TextOpenWorldRegionNarrativePacksV1,
  type TextOpenWorldRuntimeModuleKeyV1,
  type TextOpenWorldSceneScriptsV1,
  type TextOpenWorldSystemConfigsV1,
  type WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'

const SKILL_ID = 'text-open-world.production.system-finalize.v1'
const P10_INPUT_SPECS = [
  ['text-open-world.game-brief', 'storyforge.text-open-world-game-brief', 'gameBriefHash'],
  ['text-open-world.experience-contract', 'storyforge.text-open-world-experience-contract', 'experienceContractHash'],
  ['text-open-world.gameplay-ruleset-skeleton', 'storyforge.text-open-world-gameplay-ruleset-skeleton', 'gameplayRulesetHash'],
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
] as const satisfies ReadonlyArray<readonly [TextOpenWorldProductionArtifactKindV1, string, string]>

type P10Artifacts = {
  gameBrief: TextOpenWorldGameBriefV1
  experienceContract: TextOpenWorldExperienceContractV1
  gameplayRuleset: TextOpenWorldGameplayRulesetSkeletonV1
  presentationProfile: TextOpenWorldPresentationProfileV1
  playerBuild: TextOpenWorldPlayerBuildV1
  regionPacks: TextOpenWorldRegionNarrativePacksV1
  progression: TextOpenWorldProgressionCatalogsV1
  encounters: TextOpenWorldEnemyEncounterCatalogV1
  items: TextOpenWorldItemRewardCatalogV1
  craftingEconomy: TextOpenWorldCraftingEconomyCatalogV1
  npcs: TextOpenWorldNpcRuntimeCatalogV1
  map: TextOpenWorldMapInteractionCatalogV1
  quests: TextOpenWorldQuestDesignDocumentsV1
  director: TextOpenWorldDirectorDecksV1
  scenes: TextOpenWorldSceneScriptsV1
  choices: TextOpenWorldChoiceContractsV1
  bindings: TextOpenWorldActionBindingsV1
}

export interface TextOpenWorldMediaSlotDemandV1 {
  slotNumber: number
  key: string
  kind: TextOpenWorldMediaSlotKindV1
  subjectKind: TextOpenWorldMediaRequirementsV1['slots'][number]['subjectKind']
  subjectKey: string
  title: string
  required: boolean
  productionMode: TextOpenWorldMediaRequirementsV1['slots'][number]['productionMode']
  fallback: TextOpenWorldMediaRequirementsV1['slots'][number]['fallback']
  sourceArtifactKey: TextOpenWorldProductionArtifactKindV1
  sourceEntityKey: string
  consumerKeys: string[]
  semanticContext: string
}

type TextOpenWorldMediaSlotDemandWithoutNumberV1 = Omit<TextOpenWorldMediaSlotDemandV1, 'slotNumber'>

/**
 * The production Plan reserves one provider output per requested Brief audio
 * item before P10 runs. P10 must therefore derive exactly the same number of
 * semantic slots; a generic "music + ambience" pair would make every
 * music-sfx/full Build fail after the expensive narrative pipeline completed.
 */
export function deriveTextOpenWorldAudioSlotDemandsV1(input: {
  productInstanceKey: string
  media: TextOpenWorldGameBriefV1['media']
  audioLevel: TextOpenWorldPresentationProfileV1['mediaPolicy']['audioLevel']
  presentationProfileHash: string
  toneGuide: string[]
  scenes: Array<Pick<TextOpenWorldSceneScriptsV1['scenes'][number], 'key' | 'title' | 'purpose' | 'openingText'>>
  actors: Array<Pick<TextOpenWorldNpcRuntimeCatalogV1['actors'][number], 'key' | 'name' | 'portrayal'>>
}): TextOpenWorldMediaSlotDemandWithoutNumberV1[] {
  const requestedAudioCount = input.media.musicTrackCount + input.media.sfxCount + input.media.voiceLineCount
  if ((input.audioLevel === 'none') !== (requestedAudioCount === 0)) {
    fail('PresentationProfile与GameBrief音频档位不一致')
  }
  const demands: TextOpenWorldMediaSlotDemandWithoutNumberV1[] = []
  for (let index = 0; index < input.media.musicTrackCount; index += 1) {
    demands.push({
      key: `media.audio.music.${String(index + 1).padStart(3, '0')}`,
      kind: 'music', subjectKind: 'world', subjectKey: input.productInstanceKey,
      title: input.media.musicTrackCount === 1 ? '世界主题音乐' : `世界主题音乐 ${index + 1}`,
      required: false, productionMode: 'optional-generate-or-import', fallback: 'silent',
      sourceArtifactKey: 'text-open-world.presentation-profile', sourceEntityKey: input.presentationProfileHash,
      consumerKeys: ['play.scene'], semanticContext: input.toneGuide.join('；'),
    })
  }
  for (let index = 0; index < input.media.sfxCount; index += 1) {
    const scene = input.scenes[index % input.scenes.length] ?? fail('音效需求缺少可绑定Scene')
    demands.push({
      key: `media.audio.sfx.${String(index + 1).padStart(3, '0')}`,
      kind: 'sound-effect', subjectKind: 'scene', subjectKey: scene.key,
      title: `${scene.title}音效 ${index + 1}`,
      required: false, productionMode: 'optional-generate-or-import', fallback: 'silent',
      sourceArtifactKey: 'text-open-world.scene-scripts', sourceEntityKey: scene.key,
      consumerKeys: ['play.scene'], semanticContext: `${scene.purpose}；${scene.openingText}`,
    })
  }
  for (let index = 0; index < input.media.voiceLineCount; index += 1) {
    const actor = input.actors[index % input.actors.length] ?? fail('语音需求缺少可绑定Actor')
    demands.push({
      key: `media.audio.voice.${String(index + 1).padStart(3, '0')}`,
      kind: 'voice', subjectKind: 'actor', subjectKey: actor.key,
      title: `${actor.name}语音 ${index + 1}`,
      required: false, productionMode: 'optional-generate-or-import', fallback: 'silent',
      sourceArtifactKey: 'text-open-world.npc-runtime-catalog', sourceEntityKey: actor.key,
      consumerKeys: ['play.scene'], semanticContext: `${actor.name}；${actor.portrayal}`,
    })
  }
  return demands
}

export interface TextOpenWorldSystemFinalizeInputContextV1 {
  schema: 'storyforge.text-open-world-system-finalize-input'
  version: 1
  productInstanceKey: string
  artifactHashes: Array<{ artifactKey: TextOpenWorldProductionArtifactKindV1; contentHash: string; payloadHash: string }>
  gameBrief: Pick<TextOpenWorldGameBriefV1,
    'gameBriefHash' | 'qualityProfile' | 'scale' | 'media' | 'effectiveProductionBudget' | 'completion'>
  experience: Pick<TextOpenWorldExperienceContractV1, 'experienceContractHash' | 'title' | 'toneGuide' | 'coreLoop' | 'freedom' | 'narrative' | 'worldEvolution'>
  gameplayRuleset: Pick<TextOpenWorldGameplayRulesetSkeletonV1, 'gameplayRulesetHash' | 'progression' | 'combat' | 'inventory' | 'crafting' | 'economy'>
  presentationProfile: TextOpenWorldPresentationProfileV1
  player: Pick<TextOpenWorldPlayerBuildV1, 'playerBuildHash' | 'identity' | 'buildCandidate' | 'catalogBinding'>
  regionPacks: Array<{ regionKey: string; title: string; ordinaryQuestSeedCount: number; templateSeedCount: number; randomEventSeedCount: number }>
  regions: Array<{ key: string; title: string; description: string }>
  actors: Array<{ key: string; name: string; portrayal: string; regionKey: string }>
  quests: Array<Pick<TextOpenWorldQuestDesignDocumentsV1['quests'][number], 'key' | 'type' | 'title' | 'regionKeys' | 'estimatedMinutes' | 'lifecyclePolicy' | 'timePolicy'>>
  director: {
    templates: Array<Pick<TextOpenWorldDirectorDecksV1['templates'][number], 'key' | 'questKey' | 'regionKeys' | 'variantTextRequirementKeys'>>
    randomEvents: Array<Pick<TextOpenWorldDirectorDecksV1['randomEvents'][number], 'key' | 'title' | 'kind' | 'regionKeys' | 'locationKeys'>>
  }
  scenes: Array<Pick<TextOpenWorldSceneScriptsV1['scenes'][number], 'key' | 'title' | 'purpose' | 'regionKey' | 'locationKey' | 'sourceKind'>>
  mediaSlotDemands: TextOpenWorldMediaSlotDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldSystemFinalizeArtifactsV1 {
  systemConfigs: TextOpenWorldSystemConfigsV1
  mediaRequirements: TextOpenWorldMediaRequirementsV1
  contentBudget: TextOpenWorldContentBudgetV1
}

export interface TextOpenWorldSystemFinalizeModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldSystemFinalizeModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldSystemFinalizeModelExecutionV1>

interface SystemFinalizeDraftV1 {
  mediaSlots: Array<{ slotNumber: number; creativeBrief: string }>
}

const MODULE_SOURCES: Record<TextOpenWorldRuntimeModuleKeyV1, TextOpenWorldProductionArtifactKindV1[]> = {
  narrative: ['text-open-world.quest-design-documents', 'text-open-world.scene-scripts', 'text-open-world.choice-contracts'],
  world: ['text-open-world.map-interaction-catalog'],
  actors: ['text-open-world.player-build', 'text-open-world.npc-runtime-catalog'],
  quests: ['text-open-world.quest-design-documents'],
  actions: ['text-open-world.quest-design-documents', 'text-open-world.action-bindings'],
  progression: ['text-open-world.progression-catalogs'],
  combat: ['text-open-world.progression-catalogs', 'text-open-world.enemy-encounter-catalog', 'text-open-world.quest-design-documents'],
  items: ['text-open-world.item-reward-catalog', 'text-open-world.quest-design-documents'],
  crafting: ['text-open-world.crafting-economy-catalog', 'text-open-world.quest-design-documents'],
  economy: ['text-open-world.crafting-economy-catalog', 'text-open-world.quest-design-documents'],
  relationships: ['text-open-world.npc-runtime-catalog', 'text-open-world.quest-design-documents'],
  'time-weather': ['text-open-world.gameplay-ruleset-skeleton', 'text-open-world.map-interaction-catalog', 'text-open-world.director-decks'],
  director: ['text-open-world.director-decks'],
  knowledge: ['text-open-world.scene-scripts', 'text-open-world.director-decks'],
  presentation: ['text-open-world.presentation-profile', 'text-open-world.scene-scripts', 'text-open-world.action-bindings'],
}

const MODULE_SCHEMA_VERSIONS: Record<TextOpenWorldRuntimeModuleKeyV1, number> = {
  narrative: 2, world: 3, actors: 3, quests: 2, actions: 15, progression: 1,
  combat: 3, items: 1, crafting: 2, economy: 2, relationships: 3,
  'time-weather': 2, director: 2, knowledge: 1, presentation: 2,
}

const UI_MODULES: Record<string, TextOpenWorldRuntimeModuleKeyV1[]> = {
  'creation.overview': ['presentation'],
  'play.scene': ['narrative', 'knowledge', 'presentation'],
  'play.system-actions': ['actions', 'presentation'],
  'play.fixed-choices': ['narrative', 'actions', 'presentation'],
  'play.natural-language': ['actions', 'presentation'],
  'overlay.map': ['world', 'time-weather', 'presentation'],
  'overlay.quest-log': ['quests', 'narrative'],
  'overlay.character': ['actors', 'progression'],
  'overlay.skills': ['progression', 'actions'],
  'overlay.inventory': ['items', 'economy'],
  'overlay.equipment': ['items', 'actors'],
  'overlay.crafting': ['crafting', 'items', 'actions'],
  'overlay.shop': ['economy', 'relationships', 'actions'],
  'overlay.combat': ['combat', 'progression', 'items', 'actions'],
  'overlay.relationships': ['relationships', 'actors'],
  'overlay.world-status': ['time-weather', 'director', 'knowledge'],
  'system.save-branches': ['presentation'],
  'system.settings-help': ['presentation'],
}

function fail(message: string): never { throw new Error(`[text-open-world-system-finalize] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  if (actual.length !== expected.length || expected.some((key, index) => actual[index] !== key)) fail(`${label}字段不精确:${actual.join(',')}`)
}
function text(value: unknown, label: string, maximum = 2_000): string {
  if (typeof value !== 'string') fail(`${label}必须是字符串`)
  const normalized = value.trim().normalize('NFC')
  if (!normalized || normalized.length > maximum) fail(`${label}为空或过长`)
  return normalized
}
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label}整数无效`)
  return value
}
function same(left: unknown, right: unknown): boolean {
  return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right)
}
async function assertOwnHash(value: Record<string, unknown>, hashKey: string, label: string): Promise<void> {
  const actual = value[hashKey]
  if (!isSha256Hash(actual)) fail(`${label}.${hashKey}无效`)
  const body = { ...value }; delete body[hashKey]
  if (await hashProductProductionValueV2(body) !== actual) fail(`${label}内容Hash不匹配`)
}

async function readP10Artifacts(scope: WorkspaceScope, buildId: number): Promise<{ artifacts: P10Artifacts; rows: ProductBuildArtifactRecordV1[] }> {
  const accepted = await readAcceptedBuildArtifacts({ scope, buildId })
  const rows = P10_INPUT_SPECS.map(([key]) => accepted.find(row => row.artifactKey === key) ?? fail(`缺少${key}`))
  const payload = new Map<string, unknown>()
  for (const [key, schema, hashKey] of P10_INPUT_SPECS) {
    const row = rows.find(item => item.artifactKey === key)!
    const value = record(JSON.parse(row.payloadJson), key)
    if (value.schema !== schema || value.version !== 1) fail(`${key}身份无效`)
    if (row.contentHash !== await hashProductProductionValueV2(value)) fail(`${key}记录Hash不匹配`)
    await assertOwnHash(value, hashKey, key)
    payload.set(key, value)
  }
  const artifacts: P10Artifacts = {
    gameBrief: payload.get('text-open-world.game-brief') as TextOpenWorldGameBriefV1,
    experienceContract: payload.get('text-open-world.experience-contract') as TextOpenWorldExperienceContractV1,
    gameplayRuleset: payload.get('text-open-world.gameplay-ruleset-skeleton') as TextOpenWorldGameplayRulesetSkeletonV1,
    presentationProfile: payload.get('text-open-world.presentation-profile') as TextOpenWorldPresentationProfileV1,
    playerBuild: payload.get('text-open-world.player-build') as TextOpenWorldPlayerBuildV1,
    regionPacks: payload.get('text-open-world.region-narrative-packs') as TextOpenWorldRegionNarrativePacksV1,
    progression: payload.get('text-open-world.progression-catalogs') as TextOpenWorldProgressionCatalogsV1,
    encounters: payload.get('text-open-world.enemy-encounter-catalog') as TextOpenWorldEnemyEncounterCatalogV1,
    items: payload.get('text-open-world.item-reward-catalog') as TextOpenWorldItemRewardCatalogV1,
    craftingEconomy: payload.get('text-open-world.crafting-economy-catalog') as TextOpenWorldCraftingEconomyCatalogV1,
    npcs: payload.get('text-open-world.npc-runtime-catalog') as TextOpenWorldNpcRuntimeCatalogV1,
    map: payload.get('text-open-world.map-interaction-catalog') as TextOpenWorldMapInteractionCatalogV1,
    quests: payload.get('text-open-world.quest-design-documents') as TextOpenWorldQuestDesignDocumentsV1,
    director: payload.get('text-open-world.director-decks') as TextOpenWorldDirectorDecksV1,
    scenes: payload.get('text-open-world.scene-scripts') as TextOpenWorldSceneScriptsV1,
    choices: payload.get('text-open-world.choice-contracts') as TextOpenWorldChoiceContractsV1,
    bindings: payload.get('text-open-world.action-bindings') as TextOpenWorldActionBindingsV1,
  }
  const productKeys = Object.values(artifacts).map(item => item.productInstanceKey)
  if (new Set(productKeys).size !== 1) fail('P10输入跨产品实例')
  const chain = artifacts
  if (chain.experienceContract.gameBriefHash !== chain.gameBrief.gameBriefHash
    || chain.gameplayRuleset.gameBriefHash !== chain.gameBrief.gameBriefHash
    || chain.gameplayRuleset.experienceContractHash !== chain.experienceContract.experienceContractHash
    || chain.presentationProfile.gameBriefHash !== chain.gameBrief.gameBriefHash
    || chain.presentationProfile.experienceContractHash !== chain.experienceContract.experienceContractHash
    || chain.playerBuild.gameplayRulesetHash !== chain.gameplayRuleset.gameplayRulesetHash
    || chain.regionPacks.experienceContractHash !== chain.experienceContract.experienceContractHash
    || chain.quests.progressionCatalogsHash !== chain.progression.progressionCatalogsHash
    || chain.quests.enemyEncounterCatalogHash !== chain.encounters.enemyEncounterCatalogHash
    || chain.quests.itemRewardCatalogHash !== chain.items.itemRewardCatalogHash
    || chain.quests.craftingEconomyCatalogHash !== chain.craftingEconomy.craftingEconomyCatalogHash
    || chain.quests.npcRuntimeCatalogHash !== chain.npcs.npcRuntimeCatalogHash
    || chain.quests.mapInteractionCatalogHash !== chain.map.mapInteractionCatalogHash
    || chain.director.questDesignDocumentsHash !== chain.quests.questDesignDocumentsHash
    || chain.scenes.questDesignDocumentsHash !== chain.quests.questDesignDocumentsHash
    || chain.scenes.directorDecksHash !== chain.director.directorDecksHash
    || chain.choices.sceneScriptsHash !== chain.scenes.sceneScriptsHash
    || chain.bindings.choiceContractsHash !== chain.choices.choiceContractsHash
    || chain.bindings.sceneScriptsHash !== chain.scenes.sceneScriptsHash) fail('P10输入Hash链不闭合')
  return { artifacts, rows }
}

function mediaDemands(artifacts: P10Artifacts): TextOpenWorldMediaSlotDemandV1[] {
  const demands: TextOpenWorldMediaSlotDemandWithoutNumberV1[] = []
  demands.push({
    key: 'media.map.world.svg', kind: 'procedural-map', subjectKind: 'world', subjectKey: artifacts.gameBrief.productInstanceKey,
    title: '完整世界地图', required: true, productionMode: 'procedural-code', fallback: 'procedural-svg',
    sourceArtifactKey: 'text-open-world.map-interaction-catalog', sourceEntityKey: artifacts.map.mapInteractionCatalogHash,
    consumerKeys: ['overlay.map'], semanticContext: artifacts.map.regions.map(region => `${region.title}:${region.theme}`).join('；'),
  })
  for (const actor of artifacts.npcs.actors) {
    demands.push({
      key: `media.portrait.${actor.key}`, kind: 'character-portrait', subjectKind: 'actor', subjectKey: actor.key,
      title: `${actor.name}头像`, required: true, productionMode: 'generate-or-import', fallback: 'generated-placeholder',
      sourceArtifactKey: 'text-open-world.npc-runtime-catalog', sourceEntityKey: actor.key,
      consumerKeys: ['play.scene', 'overlay.relationships'], semanticContext: `${actor.name}；${actor.portrayal}；${actor.biography}`,
    })
  }
  for (const region of artifacts.map.regions) {
    demands.push({
      key: `media.background.${region.key}`, kind: 'scene-background', subjectKind: 'region', subjectKey: region.key,
      title: `${region.title}场景背景`, required: true, productionMode: 'generate-or-import', fallback: 'generated-placeholder',
      sourceArtifactKey: 'text-open-world.map-interaction-catalog', sourceEntityKey: region.key,
      consumerKeys: ['play.scene', 'overlay.map'], semanticContext: `${region.title}；${region.theme}；${region.description}`,
    })
  }
  demands.push({
    key: 'media.ui.skin.default', kind: 'ui-skin', subjectKind: 'ui', subjectKey: 'ui.default', title: '默认界面皮肤',
    required: false, productionMode: 'optional-generate-or-import', fallback: 'generated-placeholder',
    sourceArtifactKey: 'text-open-world.presentation-profile', sourceEntityKey: artifacts.presentationProfile.presentationProfileHash,
    consumerKeys: artifacts.presentationProfile.consumerSlots.map(slot => slot.key), semanticContext: artifacts.presentationProfile.theme.designIntent,
  })
  demands.push(...deriveTextOpenWorldAudioSlotDemandsV1({
    productInstanceKey: artifacts.gameBrief.productInstanceKey,
    media: artifacts.gameBrief.media,
    audioLevel: artifacts.presentationProfile.mediaPolicy.audioLevel,
    presentationProfileHash: artifacts.presentationProfile.presentationProfileHash,
    toneGuide: artifacts.experienceContract.toneGuide,
    scenes: artifacts.scenes.scenes,
    actors: artifacts.npcs.actors,
  }))
  const portraits = demands.filter(slot => slot.kind === 'character-portrait')
  const backgrounds = demands.filter(slot => slot.kind === 'scene-background')
  const optionalVisuals = demands.filter(slot => slot.kind === 'ui-skin')
  // `imageCount` is the exact provider-output count already frozen into the
  // Plan. P10 may describe every runtime slot, but only this deterministic
  // subset is eligible for generation; every other slot is explicitly
  // fallback-only instead of pretending that it has a scheduled provider job.
  const visualPriority = [
    ...backgrounds.slice(0, 1), ...portraits.slice(0, 1),
    ...backgrounds.slice(1), ...portraits.slice(1), ...optionalVisuals,
  ]
  if (visualPriority.length < artifacts.gameBrief.media.imageCount) {
    fail(`冻结图片数超过可生产视觉槽:${artifacts.gameBrief.media.imageCount}/${visualPriority.length}`)
  }
  const generatedVisualKeys = new Set(
    visualPriority.slice(0, artifacts.gameBrief.media.imageCount).map(slot => slot.key),
  )
  return demands.map((demand, index) => ({
    slotNumber: index + 1,
    ...demand,
    productionMode: ['character-portrait', 'scene-background', 'ui-skin'].includes(demand.kind)
      ? generatedVisualKeys.has(demand.key)
        ? demand.required ? 'generate-or-import' as const : 'optional-generate-or-import' as const
        : 'fallback-only' as const
      : demand.productionMode,
  }))
}

async function buildContext(scope: WorkspaceScope, buildId: number): Promise<TextOpenWorldSystemFinalizeInputContextV1> {
  const { artifacts, rows } = await readP10Artifacts(scope, buildId)
  const body = {
    schema: 'storyforge.text-open-world-system-finalize-input' as const, version: 1 as const,
    productInstanceKey: artifacts.gameBrief.productInstanceKey,
    artifactHashes: P10_INPUT_SPECS.map(([artifactKey, , hashKey]) => {
      const row = rows.find(item => item.artifactKey === artifactKey)!
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
      return { artifactKey, contentHash: row.contentHash, payloadHash: payload[hashKey] as string }
    }),
    gameBrief: {
      gameBriefHash: artifacts.gameBrief.gameBriefHash, qualityProfile: artifacts.gameBrief.qualityProfile,
      scale: artifacts.gameBrief.scale, media: artifacts.gameBrief.media,
      effectiveProductionBudget: artifacts.gameBrief.effectiveProductionBudget,
      completion: artifacts.gameBrief.completion,
    },
    experience: {
      experienceContractHash: artifacts.experienceContract.experienceContractHash,
      title: artifacts.experienceContract.title, toneGuide: artifacts.experienceContract.toneGuide,
      coreLoop: artifacts.experienceContract.coreLoop, freedom: artifacts.experienceContract.freedom,
      narrative: artifacts.experienceContract.narrative, worldEvolution: artifacts.experienceContract.worldEvolution,
    },
    gameplayRuleset: {
      gameplayRulesetHash: artifacts.gameplayRuleset.gameplayRulesetHash,
      progression: artifacts.gameplayRuleset.progression, combat: artifacts.gameplayRuleset.combat,
      inventory: artifacts.gameplayRuleset.inventory,
      crafting: artifacts.gameplayRuleset.crafting, economy: artifacts.gameplayRuleset.economy,
    },
    presentationProfile: artifacts.presentationProfile,
    player: {
      playerBuildHash: artifacts.playerBuild.playerBuildHash, identity: artifacts.playerBuild.identity,
      buildCandidate: artifacts.playerBuild.buildCandidate, catalogBinding: artifacts.playerBuild.catalogBinding,
    },
    regionPacks: artifacts.regionPacks.packs.map(pack => ({
      regionKey: pack.regionKey, title: pack.identity.title, ordinaryQuestSeedCount: pack.ordinaryQuestSeeds.length,
      templateSeedCount: pack.taskTemplateSeeds.length, randomEventSeedCount: pack.randomEventSeeds.length,
    })),
    regions: artifacts.map.regions.map(region => ({ key: region.key, title: region.title, description: region.description })),
    actors: artifacts.npcs.actors.map(actor => ({ key: actor.key, name: actor.name, portrayal: actor.portrayal, regionKey: actor.regionKey })),
    quests: artifacts.quests.quests.map(quest => ({
      key: quest.key, type: quest.type, title: quest.title, regionKeys: quest.regionKeys,
      estimatedMinutes: quest.estimatedMinutes, lifecyclePolicy: quest.lifecyclePolicy, timePolicy: quest.timePolicy,
    })),
    director: {
      templates: artifacts.director.templates.map(item => ({ key: item.key, questKey: item.questKey, regionKeys: item.regionKeys, variantTextRequirementKeys: item.variantTextRequirementKeys })),
      randomEvents: artifacts.director.randomEvents.map(item => ({ key: item.key, title: item.title, kind: item.kind, regionKeys: item.regionKeys, locationKeys: item.locationKeys })),
    },
    scenes: artifacts.scenes.scenes.map(scene => ({ key: scene.key, title: scene.title, purpose: scene.purpose, regionKey: scene.regionKey, locationKey: scene.locationKey, sourceKind: scene.sourceKind })),
    mediaSlotDemands: mediaDemands(artifacts),
  }
  return { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
}

export async function readTextOpenWorldSystemFinalizeInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !input.productBuildId) fail('缺少scope或productBuildId')
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不存在或跨Work')
  return canonicalProductProductionJsonV2(await buildContext(input.scope, build.id!))
}

async function parseContext(value: string): Promise<TextOpenWorldSystemFinalizeInputContextV1> {
  const row = record(parseProductionModelJsonObjectV1(value, 'text-open-world-system-finalize-input'), 'context')
  const expected = ['schema', 'version', 'productInstanceKey', 'artifactHashes', 'gameBrief', 'experience', 'gameplayRuleset', 'presentationProfile', 'player', 'regionPacks', 'regions', 'actors', 'quests', 'director', 'scenes', 'mediaSlotDemands', 'contextSelectionHash']
  exactKeys(row, expected, 'context')
  if (row.schema !== 'storyforge.text-open-world-system-finalize-input' || row.version !== 1 || !isSha256Hash(row.contextSelectionHash)) fail('Context身份无效')
  const body = { ...row }; delete body.contextSelectionHash
  if (await hashProductProductionValueV2(body) !== row.contextSelectionHash) fail('Context选择Hash不匹配')
  const context = row as unknown as TextOpenWorldSystemFinalizeInputContextV1
  if (!context.artifactHashes.every(item => isSha256Hash(item.contentHash) && isSha256Hash(item.payloadHash))
    || context.artifactHashes.length !== P10_INPUT_SPECS.length
    || !same(context.artifactHashes.map(item => item.artifactKey), P10_INPUT_SPECS.map(item => item[0]))) fail('Context Artifact Hash清单无效')
  if (context.presentationProfile.presentationProfileHash !== context.artifactHashes.find(item => item.artifactKey === 'text-open-world.presentation-profile')?.payloadHash
    || context.gameBrief.gameBriefHash !== context.artifactHashes.find(item => item.artifactKey === 'text-open-world.game-brief')?.payloadHash
    || context.experience.experienceContractHash !== context.artifactHashes.find(item => item.artifactKey === 'text-open-world.experience-contract')?.payloadHash
    || context.gameplayRuleset.gameplayRulesetHash !== context.artifactHashes.find(item => item.artifactKey === 'text-open-world.gameplay-ruleset-skeleton')?.payloadHash) fail('Context关键Hash不一致')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldSystemFinalizeInputContextV1): SystemFinalizeDraftV1 {
  const row = record(value, 'draft')
  exactKeys(row, ['schema', 'version', 'mediaSlots'], 'draft')
  if (row.schema !== 'storyforge.text-open-world-system-finalize-draft' || row.version !== 1 || !Array.isArray(row.mediaSlots)) fail('draft身份无效')
  const mediaSlots = row.mediaSlots.map((item, index) => {
    const entry = record(item, `mediaSlots[${index}]`)
    exactKeys(entry, ['slotNumber', 'creativeBrief'], `mediaSlots[${index}]`)
    return {
      slotNumber: integer(entry.slotNumber, `mediaSlots[${index}].slotNumber`, 1, context.mediaSlotDemands.length),
      creativeBrief: text(entry.creativeBrief, `mediaSlots[${index}].creativeBrief`, 1_000),
    }
  })
  if (mediaSlots.length !== context.mediaSlotDemands.length || new Set(mediaSlots.map(item => item.slotNumber)).size !== mediaSlots.length) fail('媒资需求必须逐槽完整返回')
  return { mediaSlots: mediaSlots.sort((a, b) => a.slotNumber - b.slotNumber) }
}

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0) }

function deriveContentBudget(context: TextOpenWorldSystemFinalizeInputContextV1, createdAt: number): Promise<TextOpenWorldContentBudgetV1> {
  const quests = context.quests
  const mainlineMinutes = sum(quests.filter(quest => quest.type === 'mainline').map(quest => quest.estimatedMinutes))
  const significantMinutes = sum(quests.filter(quest => quest.type === 'significant').map(quest => quest.estimatedMinutes))
  const ordinaryFixedMinutes = sum(quests.filter(quest => quest.type === 'ordinary').map(quest => quest.estimatedMinutes))
  const templateByQuest = new Map(quests.filter(quest => quest.type === 'template').map(quest => [quest.key, quest]))
  // A template's first variant carries the complete playable structure. Extra
  // variants only add authored setup/resolution prose, so counting each as a
  // full quest would triple-count the same mechanics and inflate inventory.
  const authoredTemplateMinutes = (questMinutes: number, variantCount: number) => (
    questMinutes + Math.max(0, variantCount - 1) * Math.ceil(questMinutes * 0.2)
  )
  const templateVariantMinutes = sum(context.director.templates.map(template => {
    const quest = templateByQuest.get(template.questKey) ?? fail(`模板引用未知Quest:${template.key}`)
    return authoredTemplateMinutes(quest.estimatedMinutes, template.variantTextRequirementKeys.length)
  }))
  const randomEventMinutes = context.director.randomEvents.length * 3
  const totalAuthoredMinutes = mainlineMinutes + significantMinutes + ordinaryFixedMinutes + templateVariantMinutes + randomEventMinutes
  const templateSingleRun = sum(context.director.templates.map(template => templateByQuest.get(template.questKey)?.estimatedMinutes ?? 0))
  const maximumOptional = significantMinutes + ordinaryFixedMinutes + templateSingleRun + randomEventMinutes
  const typicalOptional = Math.round(significantMinutes * 0.65 + ordinaryFixedMinutes * 0.65 + templateSingleRun * 0.5 + randomEventMinutes * 0.35)
  const optionalInventory = significantMinutes + ordinaryFixedMinutes + templateVariantMinutes + randomEventMinutes
  const perRegion = context.regions.map(region => {
    const fixedQuestMinutes = sum(quests.filter(quest => quest.type === 'ordinary' && quest.regionKeys.includes(region.key)).map(quest => quest.estimatedMinutes))
    const templateMinutes = sum(context.director.templates.filter(template => template.regionKeys.includes(region.key)).map(template => {
      const quest = templateByQuest.get(template.questKey)
      return quest ? authoredTemplateMinutes(quest.estimatedMinutes, template.variantTextRequirementKeys.length) : 0
    }))
    const events = context.director.randomEvents.filter(event => event.regionKeys.includes(region.key)).length * 3
    return { regionKey: region.key, fixedQuestMinutes, templateVariantMinutes: templateMinutes, randomEventMinutes: events, authoredInventoryMinutes: fixedQuestMinutes + templateMinutes + events }
  })
  const counts = {
    mainline: quests.filter(quest => quest.type === 'mainline').length,
    significant: quests.filter(quest => quest.type === 'significant').length,
    ordinary: quests.filter(quest => quest.type === 'ordinary').length,
    template: quests.filter(quest => quest.type === 'template').length,
  }
  const requested = {
    requiredPlayMinuteRange: context.gameBrief.scale.requiredPlayMinuteRange,
    optionalInventoryMinuteRange: context.gameBrief.scale.optionalInventoryMinuteRange,
  }
  const body: Omit<TextOpenWorldContentBudgetV1, 'contentBudgetHash'> = {
    schema: 'storyforge.text-open-world-content-budget', version: 1, productType: 'text-open-world',
    productInstanceKey: context.productInstanceKey,
    experienceContractHash: context.experience.experienceContractHash,
    regionNarrativePacksHash: context.artifactHashes.find(item => item.artifactKey === 'text-open-world.region-narrative-packs')!.payloadHash,
    questDesignDocumentsHash: context.artifactHashes.find(item => item.artifactKey === 'text-open-world.quest-design-documents')!.payloadHash,
    directorDecksHash: context.artifactHashes.find(item => item.artifactKey === 'text-open-world.director-decks')!.payloadHash,
    sceneScriptsHash: context.artifactHashes.find(item => item.artifactKey === 'text-open-world.scene-scripts')!.payloadHash,
    inventory: {
      mainlineMinutes, significantMinutes, ordinaryFixedMinutes, templateVariantMinutes, randomEventMinutes,
      totalAuthoredMinutes, questCounts: counts, templateVariantCount: context.director.templates.reduce((total, item) => total + item.variantTextRequirementKeys.length, 0),
      randomEventCount: context.director.randomEvents.length, regionCount: context.regions.length, sceneCount: context.scenes.length,
    },
    singlePlaythrough: {
      requiredMainlineMinutes: mainlineMinutes, minimumOptionalMinutes: 0, maximumOptionalMinutes: maximumOptional,
      minimumTotalMinutes: mainlineMinutes, typicalTotalMinutes: mainlineMinutes + typicalOptional,
      maximumTotalMinutes: mainlineMinutes + maximumOptional,
      assumptions: ['主线全部完成', '模板每种最多游玩一个实例', '随机事件每种最多计一次', '普通与重要内容按玩家选择计入'],
    },
    requested,
    fit: {
      requiredPlayMinutesInRange: mainlineMinutes >= requested.requiredPlayMinuteRange.minimum && mainlineMinutes <= requested.requiredPlayMinuteRange.maximum,
      optionalInventoryMinutesInRange: optionalInventory >= requested.optionalInventoryMinuteRange.minimum && optionalInventory <= requested.optionalInventoryMinuteRange.maximum,
      inventoryAtLeastSinglePlaythrough: totalAuthoredMinutes >= mainlineMinutes + maximumOptional,
      everyRegionHasOrdinarySupply: perRegion.every(region => region.authoredInventoryMinutes > 0),
    },
    perRegion,
    governance: {
      inventoryAndSingleRunSeparated: true, repeatedProceduralPlayNotCountedAsAuthoredInventory: true,
      durationIsEstimateUntilHumanCalibration: true, humanPlaytimeSampleCount: 0,
    },
    basisHash: context.contextSelectionHash, createdAt,
  }
  return hashProductProductionValueV2(body).then(contentBudgetHash => ({ ...body, contentBudgetHash }))
}

async function createArtifacts(input: {
  context: TextOpenWorldSystemFinalizeInputContextV1
  draft: SystemFinalizeDraftV1
  createdAt: number
}): Promise<TextOpenWorldSystemFinalizeArtifactsV1> {
  const { context, draft, createdAt } = input
  const hash = (key: TextOpenWorldProductionArtifactKindV1) => context.artifactHashes.find(item => item.artifactKey === key)?.payloadHash ?? fail(`缺少Hash:${key}`)
  const systemBody: Omit<TextOpenWorldSystemConfigsV1, 'systemConfigsHash'> = {
    schema: 'storyforge.text-open-world-system-configs', version: 1, productType: 'text-open-world', productInstanceKey: context.productInstanceKey,
    gameBriefHash: context.gameBrief.gameBriefHash, experienceContractHash: context.experience.experienceContractHash,
    presentationProfileHash: context.presentationProfile.presentationProfileHash, gameplayRulesetHash: context.gameplayRuleset.gameplayRulesetHash,
    playerBuildHash: context.player.playerBuildHash, regionNarrativePacksHash: hash('text-open-world.region-narrative-packs'),
    progressionCatalogsHash: hash('text-open-world.progression-catalogs'), enemyEncounterCatalogHash: hash('text-open-world.enemy-encounter-catalog'),
    itemRewardCatalogHash: hash('text-open-world.item-reward-catalog'), craftingEconomyCatalogHash: hash('text-open-world.crafting-economy-catalog'),
    npcRuntimeCatalogHash: hash('text-open-world.npc-runtime-catalog'), mapInteractionCatalogHash: hash('text-open-world.map-interaction-catalog'),
    questDesignDocumentsHash: hash('text-open-world.quest-design-documents'), directorDecksHash: hash('text-open-world.director-decks'),
    sceneScriptsHash: hash('text-open-world.scene-scripts'), choiceContractsHash: hash('text-open-world.choice-contracts'),
    actionBindingsHash: hash('text-open-world.action-bindings'),
    runtimeModules: TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1.map(moduleKey => ({
      moduleKey, schemaVersion: MODULE_SCHEMA_VERSIONS[moduleKey], sourceArtifactKeys: MODULE_SOURCES[moduleKey], status: 'ready-for-v3-assembly' as const,
    })),
    uiConsumers: context.presentationProfile.consumerSlots.map(slot => ({
      key: slot.key,
      sourceArtifactKeys: [...new Set((UI_MODULES[slot.key] ?? fail(`未知消费槽:${slot.key}`)).flatMap(moduleKey => MODULE_SOURCES[moduleKey]))],
      requiredRuntimeModuleKeys: UI_MODULES[slot.key]!, status: 'ready' as const,
    })),
    runtimePolicies: {
      difficulty: 'standard', maximumLevel: 20, initialLevel: 1, acceptanceFinalLevel: 5,
      professionSystem: 'none', manualAttributeAllocation: false, combatMode: 'turn-based-four-action',
      combatNaturalLanguage: false, inventoryCapacity: 'unlimited', equipmentSlots: ['weapon', 'armor', 'accessory'],
      craftingSuccess: 'guaranteed-known-recipes-only', currencyCount: 1,
      mapMode: 'svg-terrain-with-interactive-nodes', quickTravel: 'visited-region-points-no-interruption',
      worldClockDisplay: 'day-and-period', questTracking: 'one-primary-and-multiple-pinned',
      savePolicy: 'bounded-manual-list-with-branches', tutorial: 'progressive-hints', releaseLanguageCount: 1,
    },
    coverage: {
      requiredRuntimeModuleKeys: [...TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1], readyRuntimeModuleKeys: [...TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1],
      requiredConsumerKeys: context.presentationProfile.consumerSlots.map(slot => slot.key),
      readyConsumerKeys: context.presentationProfile.consumerSlots.map(slot => slot.key), missingRuntimeModuleKeys: [], missingConsumerKeys: [],
    },
    governance: {
      everyRuntimeModuleHasOneAssemblySourceSet: true, allPlayerSurfacesHaveConsumers: true,
      presentationCannotMutateState: true, runtimeStateSessionOwned: true, readyForDeterministicPreflight: true,
    },
    basisHash: context.contextSelectionHash, createdAt,
  }
  const systemConfigs: TextOpenWorldSystemConfigsV1 = { ...systemBody, systemConfigsHash: await hashProductProductionValueV2(systemBody) }
  const requestedGenerated = context.mediaSlotDemands.filter(slot => (
    slot.productionMode !== 'procedural-code' && slot.productionMode !== 'fallback-only'
  ))
  const authorized = context.gameBrief.effectiveProductionBudget.maximumMediaCalls
  const overflow = requestedGenerated.slice(authorized).map(slot => slot.key)
  const mediaBody: Omit<TextOpenWorldMediaRequirementsV1, 'mediaRequirementsHash'> = {
    schema: 'storyforge.text-open-world-media-requirements', version: 1, productType: 'text-open-world', productInstanceKey: context.productInstanceKey,
    presentationProfileHash: context.presentationProfile.presentationProfileHash,
    npcRuntimeCatalogHash: hash('text-open-world.npc-runtime-catalog'), mapInteractionCatalogHash: hash('text-open-world.map-interaction-catalog'),
    sceneScriptsHash: hash('text-open-world.scene-scripts'),
    slots: context.mediaSlotDemands.map((demand, index) => ({
      key: demand.key, order: demand.slotNumber, kind: demand.kind, subjectKind: demand.subjectKind, subjectKey: demand.subjectKey,
      title: demand.title, creativeBrief: draft.mediaSlots[index]!.creativeBrief, required: demand.required,
      productionMode: demand.productionMode, fallback: demand.fallback, sourceArtifactKey: demand.sourceArtifactKey,
      sourceEntityKey: demand.sourceEntityKey, consumerKeys: demand.consumerKeys,
    })),
    coverage: {
      requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'],
      coveredRequiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'],
      requiredActorKeys: context.actors.map(actor => actor.key), coveredActorKeys: context.actors.map(actor => actor.key),
      requiredRegionKeys: context.regions.map(region => region.key), coveredRegionKeys: context.regions.map(region => region.key),
      requiredSlotKeys: context.mediaSlotDemands.filter(slot => slot.required).map(slot => slot.key),
      fallbackReadySlotKeys: context.mediaSlotDemands.filter(slot => slot.required).map(slot => slot.key), missingRequiredSlotKeys: [],
    },
    productionBudget: {
      requestedGeneratedSlotCount: requestedGenerated.length, authorizedMaximumMediaCalls: authorized,
      fitsAuthorizedMediaCalls: requestedGenerated.length <= authorized, overflowSlotKeys: overflow,
    },
    governance: {
      requirementsDerivedAfterContent: true, mediaNeverBlocksTextFallback: true, proceduralMapRequiresNoModelCall: true,
      everyRequiredSlotHasFallback: true, rightsCheckedAtAssetAcceptance: true,
    },
    basisHash: systemConfigs.systemConfigsHash, createdAt,
  }
  const mediaRequirements: TextOpenWorldMediaRequirementsV1 = { ...mediaBody, mediaRequirementsHash: await hashProductProductionValueV2(mediaBody) }
  const expectedGeneratedCount = context.gameBrief.media.imageCount
    + context.gameBrief.media.musicTrackCount + context.gameBrief.media.sfxCount
    + context.gameBrief.media.voiceLineCount
  if (requestedGenerated.length !== expectedGeneratedCount) {
    fail(`P10生成槽与冻结Plan计数不一致:${requestedGenerated.length}/${expectedGeneratedCount}`)
  }
  if (!mediaRequirements.productionBudget.fitsAuthorizedMediaCalls) {
    fail(`P10生成槽超过冻结媒资预算:${mediaRequirements.productionBudget.overflowSlotKeys.join(',')}`)
  }
  const contentBudget = await deriveContentBudget(context, createdAt)
  return { systemConfigs, mediaRequirements, contentBudget }
}

export async function validateTextOpenWorldSystemFinalizeArtifactsV1(input: {
  artifacts: TextOpenWorldSystemFinalizeArtifactsV1
  context: TextOpenWorldSystemFinalizeInputContextV1 | string
}): Promise<TextOpenWorldSystemFinalizeArtifactsV1> {
  const { systemConfigs, mediaRequirements, contentBudget } = input.artifacts
  if (systemConfigs.schema !== 'storyforge.text-open-world-system-configs'
    || mediaRequirements.schema !== 'storyforge.text-open-world-media-requirements'
    || contentBudget.schema !== 'storyforge.text-open-world-content-budget') fail('P10 Artifact身份无效')
  await assertOwnHash(systemConfigs as unknown as Record<string, unknown>, 'systemConfigsHash', 'SystemConfigs')
  await assertOwnHash(mediaRequirements as unknown as Record<string, unknown>, 'mediaRequirementsHash', 'MediaRequirements')
  await assertOwnHash(contentBudget as unknown as Record<string, unknown>, 'contentBudgetHash', 'ContentBudget')
  const context = await parseContext(typeof input.context === 'string' ? input.context : canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft({
    schema: 'storyforge.text-open-world-system-finalize-draft', version: 1,
    mediaSlots: mediaRequirements.slots.map(slot => ({ slotNumber: slot.order, creativeBrief: slot.creativeBrief })),
  }, context)
  const expected = await createArtifacts({ context, draft, createdAt: systemConfigs.createdAt })
  if (mediaRequirements.createdAt !== systemConfigs.createdAt || contentBudget.createdAt !== systemConfigs.createdAt
    || canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.artifacts)) fail('P10系统、媒资、预算或Hash被篡改')
  if (!Object.values(contentBudget.fit).every(Boolean)) fail(`内容时长或地区供给不满足Brief预算:${canonicalProductProductionJsonV2({ inventory: contentBudget.inventory, requested: contentBudget.requested, fit: contentBudget.fit, perRegion: contentBudget.perRegion })}`)
  return input.artifacts
}

function prompts(context: TextOpenWorldSystemFinalizeInputContextV1) {
  return {
    system: [
      '你是StoryForge文字开放世界的媒资需求设计师。只能返回JSON。',
      '系统配置、UI槽、内容时长、运行规则、引用和预算全部由代码生成；你只为已给出的媒资槽写可生产的创意简报。',
      '不得增删槽、改变required/productionMode/fallback，也不得声称媒资生成成功。简报要忠于对应角色、地区或主题。',
    ].join('\n'),
    user: [
      `按mediaSlotDemands顺序输出${context.mediaSlotDemands.length}项mediaSlots，每项仅含slotNumber和creativeBrief。`,
      '返回：{"schema":"storyforge.text-open-world-system-finalize-draft","version":1,"mediaSlots":[{"slotNumber":1,"creativeBrief":"..."}]}',
    ].join('\n'),
  }
}

async function defaultRunner(input: Parameters<TextOpenWorldSystemFinalizeModelRunnerV1>[0]): Promise<TextOpenWorldSystemFinalizeModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `<system-finalize-input>\n${input.contextText}\n</system-finalize-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldSystemFinalizeExecutorV1(options: {
  runModel?: TextOpenWorldSystemFinalizeModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p10.system-finalize' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('执行器收到错误任务')
    const expectedOutputs = ['text-open-world.system-configs', 'text-open-world.media-requirements', 'text-open-world.content-budget']
    if (!same(execution.task.outputArtifactKeys, expectedOutputs)) fail('P10输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('P10需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey) ?? fail('P10缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = prompts(context); const started = performance.now()
    const model = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: SKILL_ID,
      system: `${prompt.system}\n${prompt.user}`, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(24_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (model.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(model.output, 'text-open-world-system-finalize'), context)
    const artifacts = await createArtifacts({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) })
    await validateTextOpenWorldSystemFinalizeArtifactsV1({ artifacts, context })
    return {
      artifacts: [
        { artifactKey: 'text-open-world.system-configs', kind: 'text-open-world.system-configs', payload: artifacts.systemConfigs, quality: { runtimeModulesReady: artifacts.systemConfigs.runtimeModules.length, consumersReady: artifacts.systemConfigs.uiConsumers.length }, rights: { productInstanceKey: context.productInstanceKey } },
        { artifactKey: 'text-open-world.media-requirements', kind: 'text-open-world.media-requirements', payload: artifacts.mediaRequirements, quality: { requiredSlots: artifacts.mediaRequirements.coverage.requiredSlotKeys.length, fallbackComplete: true, budgetFits: artifacts.mediaRequirements.productionBudget.fitsAuthorizedMediaCalls }, rights: { checkedAtAssetAcceptance: true } },
        { artifactKey: 'text-open-world.content-budget', kind: 'text-open-world.content-budget', payload: artifacts.contentBudget, quality: { inventoryMinutes: artifacts.contentBudget.inventory.totalAuthoredMinutes, typicalPlayMinutes: artifacts.contentBudget.singlePlaythrough.typicalTotalMinutes, fit: artifacts.contentBudget.fit }, rights: { durationEstimateOnly: true } },
      ],
      usage: {
        modelCalls: 1, inputTokens: model.usage?.inputTokens ?? estimateTokens(prompt.system + prompt.user + execution.contextText),
        outputTokens: model.usage?.outputTokens ?? estimateTokens(model.output), mediaCalls: 0, costUsd: null,
        durationMs: Math.max(0, Math.round(performance.now() - started)), storageBytes: 0,
      },
      passedGateIds: [...execution.task.acceptanceGateIds],
    } satisfies ProductProductionTaskExecutionResultV1
  }
}

function parsePreflightInput(rows: ProductBuildArtifactRecordV1[]) {
  const specs = [
    ['text-open-world.system-configs', 'storyforge.text-open-world-system-configs', 'systemConfigsHash'],
    ['text-open-world.media-requirements', 'storyforge.text-open-world-media-requirements', 'mediaRequirementsHash'],
    ['text-open-world.content-budget', 'storyforge.text-open-world-content-budget', 'contentBudgetHash'],
    ['text-open-world.quest-design-documents', 'storyforge.text-open-world-quest-design-documents', 'questDesignDocumentsHash'],
    ['text-open-world.scene-scripts', 'storyforge.text-open-world-scene-scripts', 'sceneScriptsHash'],
    ['text-open-world.choice-contracts', 'storyforge.text-open-world-choice-contracts', 'choiceContractsHash'],
    ['text-open-world.action-bindings', 'storyforge.text-open-world-action-bindings', 'actionBindingsHash'],
  ] as const
  const values = new Map<string, Record<string, unknown>>()
  return Promise.all(specs.map(async ([key, schema, hashKey]) => {
    const row = rows.find(item => item.artifactKey === key) ?? fail(`预检缺少${key}`)
    const value = record(JSON.parse(row.payloadJson), key)
    if (value.schema !== schema || value.version !== 1 || row.contentHash !== await hashProductProductionValueV2(value)) fail(`预检${key}身份或记录Hash无效`)
    await assertOwnHash(value, hashKey, key); values.set(key, value)
  })).then(() => ({
    system: values.get('text-open-world.system-configs') as unknown as TextOpenWorldSystemConfigsV1,
    media: values.get('text-open-world.media-requirements') as unknown as TextOpenWorldMediaRequirementsV1,
    budget: values.get('text-open-world.content-budget') as unknown as TextOpenWorldContentBudgetV1,
    quests: values.get('text-open-world.quest-design-documents') as unknown as TextOpenWorldQuestDesignDocumentsV1,
    scenes: values.get('text-open-world.scene-scripts') as unknown as TextOpenWorldSceneScriptsV1,
    choices: values.get('text-open-world.choice-contracts') as unknown as TextOpenWorldChoiceContractsV1,
    bindings: values.get('text-open-world.action-bindings') as unknown as TextOpenWorldActionBindingsV1,
  }))
}

export async function createTextOpenWorldDeterministicPreflightV1(input: {
  rows: ProductBuildArtifactRecordV1[]
  createdAt: number
}): Promise<TextOpenWorldDeterministicPreflightV1> {
  const { system, media, budget, quests, scenes, choices, bindings } = await parsePreflightInput(input.rows)
  if (new Set([system.productInstanceKey, media.productInstanceKey, budget.productInstanceKey, quests.productInstanceKey,
    scenes.productInstanceKey, choices.productInstanceKey, bindings.productInstanceKey]).size !== 1) fail('预检输入跨产品')
  if (system.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || system.actionBindingsHash !== bindings.actionBindingsHash
    || system.sceneScriptsHash !== scenes.sceneScriptsHash
    || system.choiceContractsHash !== choices.choiceContractsHash
    || choices.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || choices.sceneScriptsHash !== scenes.sceneScriptsHash
    || bindings.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || bindings.sceneScriptsHash !== scenes.sceneScriptsHash
    || bindings.choiceContractsHash !== choices.choiceContractsHash
    || media.presentationProfileHash !== system.presentationProfileHash
    || budget.questDesignDocumentsHash !== quests.questDesignDocumentsHash) fail('预检输入Hash链不一致')
  if (!same(system.coverage.requiredRuntimeModuleKeys, TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1)
    || !same(system.coverage.readyRuntimeModuleKeys, TEXT_OPEN_WORLD_RUNTIME_MODULE_KEYS_V1)
    || system.coverage.missingRuntimeModuleKeys.length || system.coverage.missingConsumerKeys.length) fail('预检运行模块或消费槽未闭合')
  if (media.coverage.missingRequiredSlotKeys.length
    || !same(media.coverage.requiredSlotKeys, media.coverage.fallbackReadySlotKeys)) fail('预检必需媒资槽无文字/占位降级')
  if (!Object.values(budget.fit).every(Boolean)) fail('预检内容预算未闭合')
  const conditionKeys = new Set(quests.conditions.map(item => item.key))
  const effectKeys = new Set(quests.effects.map(item => item.key))
  const actionByKey = new Map(quests.actions.map(item => [item.key, item]))
  const unknownConditions = new Set<string>(); const unknownEffects = new Set<string>(); const unknownActions = new Set<string>()
  const conditions = (keys: string[]) => keys.forEach(key => { if (!conditionKeys.has(key)) unknownConditions.add(key) })
  const effects = (keys: string[]) => keys.forEach(key => { if (!effectKeys.has(key)) unknownEffects.add(key) })
  const actions = (keys: string[]) => keys.forEach(key => { if (!actionByKey.has(key)) unknownActions.add(key) })
  for (const action of quests.actions) {
    conditions(action.requirementConditionKeys); effects([...action.costEffectKeys, ...action.successEffectKeys, ...action.failureEffectKeys])
  }
  for (const quest of quests.quests) {
    conditions(quest.prerequisiteConditionKeys); effects(quest.rewardEffectKeys)
    actions([quest.acceptActionKey, quest.claimActionKey, ...quest.expirationActionKeys, ...(quest.abandonActionKey ? [quest.abandonActionKey] : [])])
  }
  for (const stage of quests.stages) { conditions(stage.completionConditionKeys); actions([stage.completionActionKey]) }
  for (const objective of quests.objectives) { conditions(objective.completionConditionKeys); actions([...objective.supportActionKeys, objective.completionActionKey]) }
  const definitionHashes = new Map(await Promise.all(quests.actions.map(async action => [action.key, await hashProductProductionValueV2(action)] as const)))
  for (const binding of bindings.actions) {
    const action = actionByKey.get(binding.actionKey)
    if (!action || binding.actionDefinitionHash !== definitionHashes.get(binding.actionKey)
      || binding.resultAuthority.actionKey !== binding.actionKey
      || binding.resultAuthority.actionDefinitionHash !== binding.actionDefinitionHash) unknownActions.add(binding.actionKey)
  }
  const ending = quests.endingBindings
  const endingScene = scenes.scenes.find(scene => (
    scene.sourceKind === 'quest-resolution' && scene.questKey === ending.finalMainlineQuestKey
  )) ?? fail('预检缺少最终主线结局场景')
  if (!same(quests.coverage.requiredEndingKeys, quests.coverage.boundEndingKeys)
    || !ending.routes.length
    || new Set(ending.routes.map(route => route.endingKey)).size !== ending.routes.length
    || !quests.conditions.some(condition => condition.key === ending.selectionReadyConditionKey
      && same(condition.expression, { op: 'quest-status', questKey: ending.finalMainlineQuestKey, statuses: ['completed'] }))) {
    fail('预检结局覆盖或最终主线选择条件无效')
  }
  for (const route of ending.routes) {
    const action = actionByKey.get(route.actionKey)
    const condition = quests.conditions.find(item => item.key === route.conditionKey)
    const routeEffect = quests.effects.find(item => item.key === route.routeEffectKey)
    const unlockEffect = quests.effects.find(item => item.key === route.unlockEffectKey)
    const reachEffect = quests.effects.find(item => item.key === route.reachEffectKey)
    const routeChoices = choices.choices.filter(choice => choice.sceneKey === endingScene.key && choice.actionKey === route.actionKey)
    const inputBinding = bindings.actions.find(binding => binding.actionKey === route.actionKey)
    if (!action || action.category !== 'quest-action' || action.actorScope !== 'player' || action.targetScope !== 'none'
      || !same(action.locationKeys, [ending.finalLocationKey])
      || !same(action.requirementConditionKeys, [ending.selectionReadyConditionKey])
      || canonicalProductProductionJsonV2(action.successEffectKeys)
        !== canonicalProductProductionJsonV2([route.routeEffectKey, route.unlockEffectKey, route.reachEffectKey])
      || action.confirmationPolicy !== 'always' || action.repeatPolicy !== 'once'
      || !condition || !same(condition.expression, { op: 'all', conditions: [
        { op: 'quest-status', questKey: ending.finalMainlineQuestKey, statuses: ['completed'] },
        { op: 'world-flag', flagKey: 'flag.ending.route', value: route.endingKey },
      ] })
      || !same(routeEffect, { key: route.routeEffectKey, operation: 'set-world-flag', payload: { flagKey: 'flag.ending.route', value: route.endingKey } })
      || !same(unlockEffect, { key: route.unlockEffectKey, operation: 'unlock-ending', payload: { endingKey: route.endingKey } })
      || !same(reachEffect, { key: route.reachEffectKey, operation: 'reach-ending', payload: { endingKey: route.endingKey } })
      || routeChoices.length !== 1 || !endingScene.actionKeys.includes(route.actionKey)
      || !endingScene.fixedChoiceKeys.includes(routeChoices[0]!.key)
      || !inputBinding || !inputBinding.fixedChoiceKeys.includes(routeChoices[0]!.key)
      || inputBinding.naturalLanguage.mode !== 'existing-action-candidate'
      || inputBinding.naturalLanguage.exampleUtterances.length !== 2) {
      fail(`预检结局没有经过P8F Action、P9 Choice和自然语言绑定闭环:${route.endingKey}`)
    }
  }
  if (unknownConditions.size || unknownEffects.size || unknownActions.size) fail(`预检存在悬空引用 condition=${[...unknownConditions]} effect=${[...unknownEffects]} action=${[...unknownActions]}`)
  const mainline = quests.quests.filter(quest => quest.type === 'mainline').sort((a, b) => a.order - b.order)
  if (!mainline.length
    || mainline.some(quest => quest.lifecyclePolicy !== 'protected-wait' || quest.timePolicy !== 'waits')
    || mainline[0]!.initialStatus !== 'revealed'
    || mainline.slice(1).some(quest => quest.initialStatus !== 'locked')) fail('预检主线保护或顺序入口无效')
  const checks: TextOpenWorldDeterministicPreflightV1['checks'] = [
    { key: 'preflight.schema', category: 'schema', status: 'pass', summary: '所有输入Schema与内容Hash有效。', evidenceRefs: [system.systemConfigsHash, quests.questDesignDocumentsHash], targetArtifactKeys: ['text-open-world.system-configs', 'text-open-world.quest-design-documents'] },
    { key: 'preflight.hash-chain', category: 'hash-chain', status: 'pass', summary: 'P10、任务与交互Hash链闭合。', evidenceRefs: [media.mediaRequirementsHash, budget.contentBudgetHash, bindings.actionBindingsHash], targetArtifactKeys: ['text-open-world.media-requirements', 'text-open-world.content-budget', 'text-open-world.action-bindings'] },
    { key: 'preflight.references', category: 'reference', status: 'pass', summary: 'Action、Condition、Effect、场景Choice和三类输入绑定无悬空引用，所有结局已经P8F/P9治理。', evidenceRefs: [quests.questDesignDocumentsHash, scenes.sceneScriptsHash, choices.choiceContractsHash, bindings.actionBindingsHash], targetArtifactKeys: ['text-open-world.quest-design-documents', 'text-open-world.scene-scripts', 'text-open-world.choice-contracts', 'text-open-world.action-bindings'] },
    { key: 'preflight.solvability', category: 'solvability', status: 'pass', summary: '严格顺序主线具备受保护等待入口，普通内容不能写死主线。', evidenceRefs: mainline.map(quest => quest.key), targetArtifactKeys: ['text-open-world.quest-design-documents'] },
    { key: 'preflight.budget', category: 'budget', status: 'pass', summary: '主线时长、可选库存和地区供给符合Brief。', evidenceRefs: [budget.contentBudgetHash], targetArtifactKeys: ['text-open-world.content-budget'] },
    { key: 'preflight.consumer-slots', category: 'consumer-slot', status: 'pass', summary: '运行模块、UI消费槽与媒资降级全部闭合。', evidenceRefs: [system.systemConfigsHash, media.mediaRequirementsHash], targetArtifactKeys: ['text-open-world.system-configs', 'text-open-world.media-requirements'] },
  ]
  const body: Omit<TextOpenWorldDeterministicPreflightV1, 'deterministicPreflightHash'> = {
    schema: 'storyforge.text-open-world-deterministic-preflight', version: 1, productType: 'text-open-world',
    productInstanceKey: system.productInstanceKey, systemConfigsHash: system.systemConfigsHash,
    contentBudgetHash: budget.contentBudgetHash, questDesignDocumentsHash: quests.questDesignDocumentsHash,
    actionBindingsHash: bindings.actionBindingsHash, checks,
    reachability: {
      mainlineQuestKeys: mainline.map(quest => quest.key), reachableMainlineQuestKeys: mainline.map(quest => quest.key),
      protectedWaitQuestKeys: mainline.map(quest => quest.key), ordinaryContentMayBlockMainline: false,
      unknownConditionKeys: [], unknownEffectKeys: [], unknownActionKeys: [],
    },
    result: { passedCheckKeys: checks.map(check => check.key), blockingCheckKeys: [], readyForModelReviews: true },
    governance: { codeOnly: true, noSemanticQualityClaims: true, boundedAbstractReachability: true, exactInputHashesVerified: true },
    basisHash: await hashProductProductionValueV2({
      system: system.systemConfigsHash, media: media.mediaRequirementsHash, budget: budget.contentBudgetHash,
      quests: quests.questDesignDocumentsHash, scenes: scenes.sceneScriptsHash,
      choices: choices.choiceContractsHash, bindings: bindings.actionBindingsHash,
    }),
    createdAt: input.createdAt,
  }
  return { ...body, deterministicPreflightHash: await hashProductProductionValueV2(body) }
}

export async function validateTextOpenWorldDeterministicPreflightV1(input: {
  artifact: TextOpenWorldDeterministicPreflightV1
  rows: ProductBuildArtifactRecordV1[]
}): Promise<TextOpenWorldDeterministicPreflightV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-deterministic-preflight' || input.artifact.version !== 1) fail('预检Artifact身份无效')
  await assertOwnHash(input.artifact as unknown as Record<string, unknown>, 'deterministicPreflightHash', 'DeterministicPreflight')
  const expected = await createTextOpenWorldDeterministicPreflightV1({ rows: input.rows, createdAt: input.artifact.createdAt })
  if (!same(expected, input.artifact)) fail('预检结果或Hash被篡改')
  return input.artifact
}

export function createTextOpenWorldDeterministicPreflightExecutorV1(options: { now?: () => number } = {}): ProductProductionTaskExecutorV1 {
  const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'v1.deterministic-preflight' || execution.task.executionMode !== 'deterministic' || execution.task.skillId !== null) fail('预检执行器收到错误任务')
    if (!same(execution.task.outputArtifactKeys, ['text-open-world.deterministic-preflight'])) fail('预检输出不精确')
    const artifact = await createTextOpenWorldDeterministicPreflightV1({ rows: execution.inputArtifacts, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) })
    await validateTextOpenWorldDeterministicPreflightV1({ artifact, rows: execution.inputArtifacts })
    return {
      artifacts: [{ artifactKey: 'text-open-world.deterministic-preflight', kind: 'text-open-world.deterministic-preflight', payload: artifact, quality: { checks: artifact.checks.length, blocking: 0, readyForReviews: true }, rights: { codeOnly: true } }],
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, durationMs: 0, storageBytes: 0 },
      passedGateIds: [...execution.task.acceptanceGateIds],
    }
  }
}
