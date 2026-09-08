import type { ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { appendAgentRunEventV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { canonicalStringify } from '../agent/run/hash'
import { createContextManifestV1 } from '../agent/run/context-manifest'
import { db } from '../db/schema'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { readAcceptedBuildArtifacts } from '../product-production/artifact-store'
import {
  runConfiguredProductionTextV1,
  type ProviderBindingReceiptV1,
} from '../product-production/capabilities'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/production-executor'
import {
  ProductProductionDraftRejectedErrorV1,
  ProductProductionRetryableExecutionErrorV1,
  ProductProductionResultUnknownErrorV1,
  type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskExecutorV1,
  type ProductProductionTaskUsageV1,
} from '../product-production/scheduler'
import type { AssembleContextInput } from '../registry/types'
import {
  AIError,
  type
  ProductBuildArtifactRecordV1,
  TextOpenWorldActionBindingsV1,
  TextOpenWorldActionDefinitionV1,
  TextOpenWorldChoiceContractsV1,
  TextOpenWorldContentRequirementManifestV1,
  TextOpenWorldDirectorDecksV1,
  TextOpenWorldExperienceContractV1,
  TextOpenWorldNpcRuntimeCatalogV1,
  TextOpenWorldMapInteractionCatalogV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldSceneScriptsV1,
  TextOpenWorldSourceLedgerV1,
  TextOpenWorldStoryArcV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import {
  assertTextOpenWorldSceneDemandCapacityV1,
  TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1,
} from './scene-demand-capacity'

const SKILL_ID = 'text-open-world.production.scene-scripts.v1'
const MAX_CONTEXT_CHARS = 440_000
const FRAGMENT_CONTEXT_SOURCE_KEY = 'text-open-world.scene-scripts-input'
const FRAGMENT_CONTEXT_READER_VERSION = 'text-open-world-scene-scripts-governed-v3-fragment-v1'
const COMBAT_CATEGORIES = new Set<TextOpenWorldActionDefinitionV1['category']>([
  'start-combat', 'continue-combat', 'combat-state-action', 'combat-reward-action',
  'combat-basic-attack', 'combat-skill', 'combat-item', 'combat-enemy-skill', 'escape',
])

export interface TextOpenWorldSceneDemandV1 {
  sceneNumber: number
  sceneKey: string
  sourceKind: TextOpenWorldSceneScriptsV1['scenes'][number]['sourceKind']
  sourceKey: string
  suggestedTitle: string
  purpose: string
  regionKey: string
  locationKey: string
  questKey: string | null
  stageKey: string | null
  objectiveKey: string | null
  actorKey: string | null
  interactionKey: string | null
  randomEventKey: string | null
  participantKeys: string[]
  actionKeys: string[]
  choiceCount: number
  knowledgeBoundaryKey: string
  availabilityConditionKeys: string[]
}

export interface TextOpenWorldSceneKnowledgeBoundaryV1 {
  key: string
  allowedKnowledgeClaimKeys: string[]
  forbiddenFutureObjectiveKeys: string[]
}

export interface TextOpenWorldActionLanguageDemandV1 {
  actionNumber: number
  actionKey: string
}

export interface TextOpenWorldTemplateVariantDemandV1 {
  variantNumber: number
  requirementKey: string
  templateKey: string
  questKey: string
  regionKeys: string[]
}

export interface TextOpenWorldRandomEventPresentationDemandV1 {
  eventNumber: number
  randomEventKey: string
  title: string
  kind: TextOpenWorldDirectorDecksV1['randomEvents'][number]['kind']
  regionKey: string
  locationKeys: string[]
  rumorRequirementKey: string | null
  sourceClaimKeys: string[]
}

export interface TextOpenWorldKnowledgePresentationDemandV1 {
  knowledgeNumber: number
  knowledgeKey: string
  kind: NonNullable<TextOpenWorldQuestDesignDocumentsV1['knowledgeBindings']>[number]['kind']
  publicSubjectLabel: string
}

export interface TextOpenWorldAchievementPresentationDemandV1 {
  achievementNumber: number
  achievementKey: string
  sourceKind: NonNullable<TextOpenWorldQuestDesignDocumentsV1['achievementBindings']>[number]['sourceKind']
  publicSourceLabel: string
}

export interface TextOpenWorldSceneActionSourceV1 {
  key: string
  category: TextOpenWorldActionDefinitionV1['category']
  label: string
  description: string
  actorScope: TextOpenWorldActionDefinitionV1['actorScope']
  targetScope: TextOpenWorldActionDefinitionV1['targetScope']
  locationKeys: string[]
  requirementConditionKeys: string[]
  confirmationPolicy: TextOpenWorldActionDefinitionV1['confirmationPolicy']
  actionDefinitionHash: string
}

export interface TextOpenWorldSceneScriptsInputContextV1 {
  schema: 'storyforge.text-open-world-scene-scripts-input'
  /** v1 is retained for durable-run replay; all newly assembled contexts use v2. */
  version: 1 | 2
  /** Fresh governed Knowledge builds keep the durable v2 envelope while the
   * executor sends only a disclosure-safe deterministic projection to the
   * model. Historical v1/v2 contexts omit this marker. */
  modelDisclosureContract?: 'governed-v3'
  productInstanceKey: string
  sourceLedger: TextOpenWorldSourceLedgerV1
  experienceContract: TextOpenWorldExperienceContractV1
  storyArc: TextOpenWorldStoryArcV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
  questSkeletons: {
    productInstanceKey: string
    regionNarrativePacksHash: string
    quests: Array<Pick<TextOpenWorldQuestSkeletonsV1['quests'][number],
      'key' | 'source' | 'regionKeys' | 'locationKeys' | 'stageKeys' | 'storyMotivation'>>
    stages: Array<Pick<TextOpenWorldQuestSkeletonsV1['stages'][number],
      'key' | 'questKey' | 'order' | 'objectiveKeys'>>
    objectives: Array<Pick<TextOpenWorldQuestSkeletonsV1['objectives'][number],
      'key' | 'questKey' | 'stageKey' | 'order' | 'title'>>
    questSkeletonsHash: string
  }
  contentRequirementManifestHash: string
  npcRuntimeCatalog: {
    productInstanceKey: string
    regionNarrativePacksHash: string
    questSkeletonsHash: string
    contentRequirementManifestHash: string
    factions: Array<Pick<TextOpenWorldNpcRuntimeCatalogV1['factions'][number],
      'key' | 'title' | 'description' | 'publicGoal'>>
    actors: Array<Pick<TextOpenWorldNpcRuntimeCatalogV1['actors'][number],
      'key' | 'name' | 'biography' | 'portrayal' | 'factionKey' | 'homeLocationKey' | 'regionKey'>
      & Partial<Pick<TextOpenWorldNpcRuntimeCatalogV1['actors'][number],
        'sourceDemandKey' | 'demandKind' | 'tier' | 'runtimeMode' | 'serviceKeys' | 'fulfilledRequirementKeys'>>>
    npcRuntimeCatalogHash: string
  }
  mapInteractionCatalog: {
    productInstanceKey: string
    regionNarrativePacksHash: string
    questSkeletonsHash: string
    contentRequirementManifestHash: string
    initialRegionKey: string
    initialLocationKey: string
    regions: Array<Pick<TextOpenWorldMapInteractionCatalogV1['regions'][number],
      'key' | 'title' | 'description' | 'theme' | 'locationKeys'>>
    locations: Array<Pick<TextOpenWorldMapInteractionCatalogV1['locations'][number],
      'key' | 'regionKey' | 'title' | 'description' | 'purpose'>>
    interactions: Array<Pick<TextOpenWorldMapInteractionCatalogV1['interactions'][number],
      'key' | 'title' | 'description' | 'playerPrompt' | 'regionKey' | 'locationKey'>>
    mapInteractionCatalogHash: string
  }
  questDesignDocuments: Pick<TextOpenWorldQuestDesignDocumentsV1,
    | 'productInstanceKey' | 'regionNarrativePacksHash' | 'questSkeletonsHash'
    | 'contentRequirementManifestHash' | 'npcRuntimeCatalogHash' | 'mapInteractionCatalogHash'
    | 'requirementBindings' | 'knowledgeBindings' | 'achievementBindings'
    | 'questDesignDocumentsHash'> & {
      quests: Array<Pick<TextOpenWorldQuestDesignDocumentsV1['quests'][number],
        | 'key' | 'type' | 'title' | 'ownerKind' | 'ownerKey' | 'regionKeys' | 'stageKeys'
        | 'prerequisiteConditionKeys' | 'rewardContractKey' | 'acceptActionKey' | 'claimActionKey'>>
      objectives: Array<Pick<TextOpenWorldQuestDesignDocumentsV1['objectives'][number],
        | 'key' | 'questKey' | 'stageKey' | 'title' | 'description' | 'requirementKeys'
        | 'supportActionKeys' | 'completionActionKey' | 'completionConditionKeys'>>
      actions: TextOpenWorldSceneActionSourceV1[]
      endingBindings: TextOpenWorldQuestDesignDocumentsV1['endingBindings']
      catalogBindings: Pick<TextOpenWorldQuestDesignDocumentsV1['catalogBindings'],
        'actors' | 'encounters' | 'items' | 'recipes' | 'vendors' | 'interactions' | 'rewards'>
      governance: Pick<TextOpenWorldQuestDesignDocumentsV1['governance'],
        | 'questAndEncounterBindingsReady' | 'sceneBindingsDeferred' | 'restartActionsRequireOriginalOfferRoute'
        | 'knowledgeProgressReady' | 'allRumorsHaveUniquePropagationPath'
        | 'allKnowledgeHasConfirmationPath' | 'allAchievementsOneTimeReachable'>
    }
  directorDecks: {
    productInstanceKey: string
    regionNarrativePacksHash: string
    mapInteractionCatalogHash: string
    questDesignDocumentsHash: string
    templates: Array<Pick<TextOpenWorldDirectorDecksV1['templates'][number],
      'key' | 'questKey' | 'regionKeys' | 'variantTextRequirementKeys'>>
    randomEvents: TextOpenWorldDirectorDecksV1['randomEvents']
    governance: Pick<TextOpenWorldDirectorDecksV1['governance'],
      'presentationVariantsDeferred' | 'knowledgeProgressReady' | 'allRumorsHaveUniquePropagationPath'>
    directorDecksHash: string
  }
  knowledgeBoundaries: TextOpenWorldSceneKnowledgeBoundaryV1[]
  sceneDemands: TextOpenWorldSceneDemandV1[]
  actionLanguageDemands: TextOpenWorldActionLanguageDemandV1[]
  templateVariantDemands: TextOpenWorldTemplateVariantDemandV1[]
  randomEventPresentationDemands: TextOpenWorldRandomEventPresentationDemandV1[]
  knowledgePresentationDemands?: TextOpenWorldKnowledgePresentationDemandV1[]
  achievementPresentationDemands?: TextOpenWorldAchievementPresentationDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldSceneScriptsArtifactsV1 {
  sceneScripts: TextOpenWorldSceneScriptsV1
  choiceContracts: TextOpenWorldChoiceContractsV1
  actionBindings: TextOpenWorldActionBindingsV1
}

export interface TextOpenWorldSceneScriptsModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldSceneScriptsModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldSceneScriptsModelExecutionV1>

export type TextOpenWorldSceneScriptsModelContextSliceV1 =
  | { kind: 'scene'; sceneIndex: number }
  | { kind: 'shared-presentations' }

interface SceneDraftV1 {
  sceneNumber: number
  title: string
  openingText: string
  bodyText: string
  successText: string
  failureText: string | null
  choiceLabels: string[]
  attitudeOpenings: { bad: string; neutral: string; good: string } | null
}

interface SceneScriptsDraftV1 {
  scenes: SceneDraftV1[]
  actionUtterances: Array<{ actionNumber: number; examples: string[] }>
  templateVariants: Array<{ variantNumber: number; title: string; description: string }>
  randomEvents: Array<{
    eventNumber: number
    openingText: string
    resolutionText: string
    rumorText: string | null
  }>
  knowledgePresentations: Array<{ knowledgeNumber: number; title: string; summary: string }>
  achievementPresentations: Array<{ achievementNumber: number; title: string; description: string }>
}

function fail(message: string): never { throw new Error(`[text-open-world-scene-scripts] ${message}`) }
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
function nullableText(value: unknown, label: string, maximum = 2_000): string | null {
  if (value === null) return null
  return text(value, label, maximum)
}
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}必须是${minimum}到${maximum}之间的整数`)
  return Number(value)
}
function exactStringArray(value: unknown, label: string, length: number, maximumLength = 120): string[] {
  if (!Array.isArray(value) || value.length !== length) fail(`${label}必须精确包含${length}项`)
  const values = value.map((item, index) => text(item, `${label}[${index}]`, maximumLength))
  if (new Set(values.map(item => item.toLocaleLowerCase('zh-CN'))).size !== values.length) fail(`${label}不能重复`)
  return values
}
function same(left: string[], right: string[]): boolean {
  return canonicalProductProductionJsonV2([...left].sort()) === canonicalProductProductionJsonV2([...right].sort())
}
function selectByKeys<T extends { key: string }>(rows: readonly T[], keys: Set<string>, label: string): T[] {
  const selected = rows.filter(row => keys.has(row.key))
  if (selected.length !== keys.size) fail(`安全模型投影缺少${label}:${[...keys].filter(key => !selected.some(row => row.key === key)).join(',')}`)
  return selected
}
function unique(rows: ProductBuildArtifactRecordV1[], key: string): ProductBuildArtifactRecordV1 {
  const matched = rows.filter(row => row.artifactKey === key && (row.status === 'accepted' || row.status === 'carried-forward'))
  if (matched.length !== 1) fail(`需要唯一已验收Artifact:${key}`)
  return matched[0]!
}
function artifact<T>(row: ProductBuildArtifactRecordV1, key: string): T {
  if (row.artifactKey !== key || row.kind !== key) fail(`Artifact身份错误:${key}`)
  try { return JSON.parse(row.payloadJson) as T } catch { return fail(`Artifact JSON损坏:${key}`) }
}
async function assertOwnHash(value: Record<string, unknown>, hashKey: string, label: string): Promise<void> {
  const ownHash = value[hashKey]
  if (!isSha256Hash(ownHash)) fail(`${label} Hash字段无效`)
  const body = { ...value }; delete body[hashKey]
  if (await hashProductProductionValueV2(body) !== ownHash) fail(`${label} Hash不匹配`)
}
function actionByKey(context: TextOpenWorldSceneScriptsInputContextV1, actionKey: string): TextOpenWorldSceneActionSourceV1 {
  return context.questDesignDocuments.actions.find(action => action.key === actionKey)
    ?? fail(`引用未知Action:${actionKey}`)
}
function governedKnowledge(context: Pick<TextOpenWorldSceneScriptsInputContextV1, 'questDesignDocuments'>): boolean {
  return context.questDesignDocuments.governance.knowledgeProgressReady === true
}

function governedSceneDemandCount(context: TextOpenWorldSceneScriptsContextBaseV1): number {
  return assertTextOpenWorldSceneDemandCapacityV1({
    quests: context.questDesignDocuments.quests,
    objectives: context.questDesignDocuments.objectives,
    actors: context.npcRuntimeCatalog.actors,
    interactions: context.mapInteractionCatalog.interactions,
    randomEvents: context.directorDecks.randomEvents,
  })
}
function knowledgeBindings(context: TextOpenWorldSceneScriptsInputContextV1) {
  return context.questDesignDocuments.knowledgeBindings ?? []
}
function achievementBindings(context: TextOpenWorldSceneScriptsInputContextV1) {
  return context.questDesignDocuments.achievementBindings ?? []
}
function playerActionKeys(context: TextOpenWorldSceneScriptsInputContextV1, keys: string[]): string[] {
  return [...new Set(keys)].filter(key => actionByKey(context, key).actorScope === 'player')
}
function existingClaimKeys(context: TextOpenWorldSceneScriptsInputContextV1, keys: string[]): string[] {
  const existing = new Set(context.sourceLedger.entries.map(entry => entry.claimKey))
  return [...new Set(keys)].filter(key => existing.has(key))
}
function packClaimKeys(context: TextOpenWorldSceneScriptsInputContextV1, regionKey: string): string[] {
  if (governedKnowledge(context)) {
    return knowledgeBindings(context)
      .filter(binding => binding.regionKey === regionKey)
      .sort((left, right) => left.order - right.order)
      .map(binding => binding.knowledgeKey)
  }
  const pack = context.regionNarrativePacks.packs.find(item => item.regionKey === regionKey)
  const story = [
    ...context.experienceContract.sourceClaimKeys,
    ...context.storyArc.sourceClaimKeys,
    ...context.storyArc.macroBeats.flatMap(beat => beat.sourceClaimKeys),
  ]
  if (!pack) return existingClaimKeys(context, story)
  return existingClaimKeys(context, [
    ...story, ...pack.sourceClaimKeys,
    ...pack.characterRequirements.flatMap(item => item.sourceClaimKeys),
    ...pack.factionRequirements.flatMap(item => item.sourceClaimKeys),
    ...pack.ordinaryQuestSeeds.flatMap(item => item.sourceClaimKeys),
    ...pack.taskTemplateSeeds.flatMap(item => item.sourceClaimKeys),
    ...pack.randomEventSeeds.flatMap(item => item.sourceClaimKeys),
    ...pack.rumors.flatMap(item => item.sourceClaimKeys),
  ])
}
function questClaimKeys(context: TextOpenWorldSceneScriptsInputContextV1, questKey: string): string[] {
  const quest = context.questSkeletons.quests.find(item => item.key === questKey) ?? fail(`缺少QuestSkeleton:${questKey}`)
  if (governedKnowledge(context)) {
    const regionKeys = new Set(quest.regionKeys)
    return knowledgeBindings(context)
      .filter(binding => regionKeys.has(binding.regionKey)
        || binding.confirmationBindings.some(confirmation => confirmation.sourceKey === questKey))
      .sort((left, right) => left.order - right.order)
      .map(binding => binding.knowledgeKey)
  }
  const keys = quest.regionKeys.flatMap(regionKey => packClaimKeys(context, regionKey))
  for (const pack of context.regionNarrativePacks.packs) {
    if (quest.source.kind === 'ordinary-seed') {
      keys.push(...(pack.ordinaryQuestSeeds.find(seed => seed.key === quest.source.sourceKey)?.sourceClaimKeys ?? []))
    }
    if (quest.source.kind === 'template-seed') {
      keys.push(...(pack.taskTemplateSeeds.find(seed => seed.key === quest.source.sourceKey)?.sourceClaimKeys ?? []))
    }
  }
  return existingClaimKeys(context, keys)
}
function protectedObjectiveKeys(context: TextOpenWorldSceneScriptsInputContextV1): string[] {
  const protectedQuests = new Set(context.questDesignDocuments.quests
    .filter(quest => quest.type === 'mainline' || quest.type === 'significant').map(quest => quest.key))
  return context.questDesignDocuments.objectives.filter(objective => protectedQuests.has(objective.questKey)).map(objective => objective.key)
}
function futureObjectiveKeys(context: TextOpenWorldSceneScriptsInputContextV1, objectiveKey: string): string[] {
  const objective = context.questSkeletons.objectives.find(item => item.key === objectiveKey) ?? fail(`缺少Objective:${objectiveKey}`)
  const stages = context.questSkeletons.stages.filter(stage => stage.questKey === objective.questKey).sort((left, right) => left.order - right.order)
  const stageOrder = new Map(stages.map(stage => [stage.key, stage.order]))
  return context.questSkeletons.objectives.filter(candidate => candidate.questKey === objective.questKey
    && ((stageOrder.get(candidate.stageKey) ?? 0) > (stageOrder.get(objective.stageKey) ?? 0)
      || (candidate.stageKey === objective.stageKey && candidate.order > objective.order))).map(candidate => candidate.key)
}
function legacyParticipantsForObjective(
  context: TextOpenWorldSceneScriptsInputContextV1,
  objectiveKey: string,
): string[] {
  const objective = context.questDesignDocuments.objectives.find(item => item.key === objectiveKey) ?? fail(`缺少定稿Objective:${objectiveKey}`)
  const actors = context.questDesignDocuments.requirementBindings
    .filter(binding => objective.requirementKeys.includes(binding.requirementKey) && binding.definitionKind === 'actor')
    .flatMap(binding => binding.definitionKeys)
  const quest = context.questDesignDocuments.quests.find(item => item.key === objective.questKey)!
  if (quest.ownerKind === 'actor' && quest.ownerKey) actors.push(quest.ownerKey)
  return [...new Set(actors)].filter(key => context.npcRuntimeCatalog.actors.some(actor => actor.key === key))
}

function participantsForObjective(
  context: TextOpenWorldSceneScriptsInputContextV1,
  objectiveKey: string,
  locationKey: string,
): string[] {
  if (context.version === 1) return legacyParticipantsForObjective(context, objectiveKey)
  const objective = context.questDesignDocuments.objectives.find(item => item.key === objectiveKey) ?? fail(`缺少定稿Objective:${objectiveKey}`)
  const actors = context.questDesignDocuments.requirementBindings
    .filter(binding => objective.requirementKeys.includes(binding.requirementKey) && binding.definitionKind === 'actor')
    .flatMap(binding => binding.definitionKeys)
  return [...new Set(actors)].filter(key => {
    const actor = context.npcRuntimeCatalog.actors.find(candidate => candidate.key === key)
    // P8 currently compiles every rule-driven schedule entry to the actor's
    // home location. Keep P9's participant gate aligned with that frozen
    // runtime contract without pulling schedules into this atomic context.
    return actor?.homeLocationKey === locationKey
  })
}

/**
 * Scene availability is a scene-level gate. Action requirements remain owned
 * by each Action/Choice and may differ inside the same scene. Only conditions
 * shared by every action can therefore be promoted to the scene boundary.
 */
function sharedActionConditionKeys(
  context: TextOpenWorldSceneScriptsInputContextV1,
  actionKeys: string[],
): string[] {
  if (context.version === 1) {
    return [...new Set(actionKeys.flatMap(key => actionByKey(context, key).requirementConditionKeys))]
  }
  if (!actionKeys.length) return []
  const conditionSets = actionKeys.map(key => new Set(actionByKey(context, key).requirementConditionKeys))
  return [...conditionSets[0]!].filter(conditionKey => (
    conditionSets.slice(1).every(keys => keys.has(conditionKey))
  ))
}
function locationForActions(
  context: TextOpenWorldSceneScriptsInputContextV1,
  actionKeys: string[],
  fallbackLocationKeys: string[],
): string {
  for (const actionKey of actionKeys) {
    const locationKey = actionByKey(context, actionKey).locationKeys[0]
    if (locationKey) return locationKey
  }
  return fallbackLocationKeys[0] ?? context.mapInteractionCatalog.initialLocationKey
}

type TextOpenWorldSceneScriptsContextBaseV1 = Omit<TextOpenWorldSceneScriptsInputContextV1,
  | 'knowledgeBoundaries' | 'sceneDemands' | 'actionLanguageDemands' | 'templateVariantDemands'
  | 'randomEventPresentationDemands' | 'knowledgePresentationDemands'
  | 'achievementPresentationDemands' | 'contextSelectionHash'>

function publicKnowledgeSubjectLabel(
  context: TextOpenWorldSceneScriptsInputContextV1,
  binding: NonNullable<TextOpenWorldQuestDesignDocumentsV1['knowledgeBindings']>[number],
): string {
  if (binding.kind === 'actor' && binding.subjectDefinitionKey) {
    return context.npcRuntimeCatalog.actors.find(actor => actor.key === binding.subjectDefinitionKey)?.name
      ?? `角色知识${binding.order}`
  }
  if (binding.kind === 'faction' && binding.subjectDefinitionKey) {
    return context.npcRuntimeCatalog.factions.find(faction => faction.key === binding.subjectDefinitionKey)?.title
      ?? `势力知识${binding.order}`
  }
  if (binding.kind === 'location' && binding.subjectDefinitionKey) {
    return context.mapInteractionCatalog.locations.find(location => location.key === binding.subjectDefinitionKey)?.title
      ?? `地点知识${binding.order}`
  }
  return binding.kind === 'quest-clue' ? `任务线索${binding.order}`
    : binding.kind === 'enemy' ? `敌人知识${binding.order}`
      : `世界知识${binding.order}`
}

function publicAchievementSourceLabel(
  context: TextOpenWorldSceneScriptsInputContextV1,
  binding: NonNullable<TextOpenWorldQuestDesignDocumentsV1['achievementBindings']>[number],
): string {
  if (binding.sourceKind === 'quest-reward-claim') {
    return context.questDesignDocuments.quests.find(quest => quest.key === binding.sourceKey)?.title
      ?? `任务成果${binding.order}`
  }
  return `结局成果${binding.order}`
}

function buildDemands(context: TextOpenWorldSceneScriptsContextBaseV1) {
  const hydrated = context as TextOpenWorldSceneScriptsInputContextV1
  const scenes: TextOpenWorldSceneDemandV1[] = []
  const knowledgeBoundaries: TextOpenWorldSceneKnowledgeBoundaryV1[] = []
  const addScene = (value: Omit<TextOpenWorldSceneDemandV1, 'sceneNumber' | 'knowledgeBoundaryKey'> & {
    allowedKnowledgeClaimKeys: string[]
    forbiddenFutureObjectiveKeys: string[]
  }) => {
    if (scenes.some(scene => scene.sceneKey === value.sceneKey)) fail(`Scene稳定键重复:${value.sceneKey}`)
    const { allowedKnowledgeClaimKeys, forbiddenFutureObjectiveKeys, ...scene } = value
    const signature = canonicalProductProductionJsonV2({
      allowedKnowledgeClaimKeys: [...allowedKnowledgeClaimKeys].sort(),
      forbiddenFutureObjectiveKeys: [...forbiddenFutureObjectiveKeys].sort(),
    })
    let boundary = knowledgeBoundaries.find(item => canonicalProductProductionJsonV2({
      allowedKnowledgeClaimKeys: [...item.allowedKnowledgeClaimKeys].sort(),
      forbiddenFutureObjectiveKeys: [...item.forbiddenFutureObjectiveKeys].sort(),
    }) === signature)
    if (!boundary) {
      boundary = {
        key: `knowledge-boundary.${String(knowledgeBoundaries.length + 1).padStart(3, '0')}`,
        allowedKnowledgeClaimKeys: [...new Set(allowedKnowledgeClaimKeys)],
        forbiddenFutureObjectiveKeys: [...new Set(forbiddenFutureObjectiveKeys)],
      }
      knowledgeBoundaries.push(boundary)
    }
    scenes.push({ sceneNumber: scenes.length + 1, ...scene, knowledgeBoundaryKey: boundary.key })
  }
  for (const quest of context.questDesignDocuments.quests) {
    const skeleton = context.questSkeletons.quests.find(item => item.key === quest.key) ?? fail(`缺少QuestSkeleton:${quest.key}`)
    const questLocationKey = skeleton.locationKeys[0] ?? context.mapInteractionCatalog.initialLocationKey
    const orderedObjectiveKeys = skeleton.stageKeys.flatMap(stageKey => (
      context.questSkeletons.stages.find(stage => stage.key === stageKey)?.objectiveKeys ?? []
    ))
    const ownerActorDefinition = quest.ownerKind === 'actor' && quest.ownerKey
      ? context.npcRuntimeCatalog.actors.find(actor => actor.key === quest.ownerKey) ?? null
      : null
    const ownerActor = ownerActorDefinition?.key ?? null
    // An actor-owned commission is offered and settled where that actor is
    // actually authored to live. Quest locations describe the adventure body,
    // not permission to teleport its owner into the first stage location.
    const endpointLocationKey = context.version === 1
      ? questLocationKey
      : ownerActorDefinition?.homeLocationKey ?? questLocationKey
    const endpointRegionKey = context.version === 1
      ? quest.regionKeys[0] ?? context.mapInteractionCatalog.initialRegionKey
      : context.mapInteractionCatalog.locations
        .find(location => location.key === endpointLocationKey)?.regionKey
        ?? fail(`任务端点地点缺少地区:${quest.key}:${endpointLocationKey}`)
    const restartActionKey = hydrated.questDesignDocuments.actions
      .find(action => action.key === `action.restart.${quest.key}` && action.category === 'restart-quest')?.key
    const offerActions = playerActionKeys(hydrated, [quest.acceptActionKey, ...(restartActionKey ? [restartActionKey] : [])])
    addScene({
      sceneKey: `scene.offer.${quest.key}`, sourceKind: 'quest-offer', sourceKey: quest.key,
      suggestedTitle: `委托：${quest.title}`, purpose: skeleton.storyMotivation,
      regionKey: endpointRegionKey, locationKey: endpointLocationKey, questKey: quest.key, stageKey: null, objectiveKey: null,
      actorKey: ownerActor, interactionKey: null, randomEventKey: null,
      participantKeys: ownerActor ? [ownerActor] : [], actionKeys: offerActions,
      choiceCount: offerActions.length, allowedKnowledgeClaimKeys: questClaimKeys(hydrated, quest.key),
      forbiddenFutureObjectiveKeys: orderedObjectiveKeys.slice(1),
      availabilityConditionKeys: [...quest.prerequisiteConditionKeys],
    })
    const resolutionActions = playerActionKeys(hydrated, [
      quest.claimActionKey,
      ...(quest.key === context.questDesignDocuments.endingBindings.finalMainlineQuestKey
        ? context.questDesignDocuments.endingBindings.routes.map(route => route.actionKey)
        : []),
    ])
    addScene({
      sceneKey: `scene.resolution.${quest.key}`, sourceKind: 'quest-resolution', sourceKey: quest.key,
      suggestedTitle: `收束：${quest.title}`, purpose: '呈现任务结果并领取已冻结奖励。',
      regionKey: endpointRegionKey, locationKey: endpointLocationKey, questKey: quest.key,
      stageKey: quest.stageKeys[quest.stageKeys.length - 1] ?? null, objectiveKey: null,
      actorKey: ownerActor, interactionKey: null, randomEventKey: null,
      participantKeys: ownerActor ? [ownerActor] : [], actionKeys: resolutionActions,
      choiceCount: resolutionActions.length, allowedKnowledgeClaimKeys: questClaimKeys(hydrated, quest.key), forbiddenFutureObjectiveKeys: [],
      availabilityConditionKeys: context.questDesignDocuments.catalogBindings.rewards
        .find(reward => reward.rewardContractKey === quest.rewardContractKey)?.conditionKeys ?? [],
    })
  }
  for (const objective of context.questDesignDocuments.objectives) {
    const quest = context.questSkeletons.quests.find(item => item.key === objective.questKey) ?? fail(`缺少QuestSkeleton:${objective.questKey}`)
    const actions = playerActionKeys(hydrated, [...objective.supportActionKeys, objective.completionActionKey])
    const regionKey = quest.regionKeys[0] ?? context.mapInteractionCatalog.initialRegionKey
    const locationKey = locationForActions(hydrated, actions, quest.locationKeys)
    addScene({
      sceneKey: `scene.objective.${objective.key}`, sourceKind: 'quest-objective', sourceKey: objective.key,
      suggestedTitle: objective.title, purpose: objective.description, regionKey,
      locationKey,
      questKey: objective.questKey, stageKey: objective.stageKey, objectiveKey: objective.key,
      actorKey: null, interactionKey: null, randomEventKey: null,
      participantKeys: participantsForObjective(hydrated, objective.key, locationKey), actionKeys: actions, choiceCount: actions.length,
      allowedKnowledgeClaimKeys: questClaimKeys(hydrated, objective.questKey),
      forbiddenFutureObjectiveKeys: futureObjectiveKeys(hydrated, objective.key),
      availabilityConditionKeys: sharedActionConditionKeys(hydrated, actions),
    })
  }
  const allProtectedObjectives = protectedObjectiveKeys(hydrated)
  for (const actor of context.npcRuntimeCatalog.actors) {
    const binding = context.questDesignDocuments.catalogBindings.actors.find(item => item.actorKey === actor.key)
    const actions = playerActionKeys(hydrated, binding?.actionKeys ?? [])
    addScene({
      sceneKey: `scene.actor.${actor.key}`, sourceKind: 'actor-dialogue', sourceKey: actor.key,
      suggestedTitle: `与${actor.name}交谈`, purpose: actor.portrayal, regionKey: actor.regionKey,
      locationKey: actor.homeLocationKey, questKey: null, stageKey: null, objectiveKey: null,
      actorKey: actor.key, interactionKey: null, randomEventKey: null, participantKeys: [actor.key],
      actionKeys: actions, choiceCount: actions.length, allowedKnowledgeClaimKeys: packClaimKeys(hydrated, actor.regionKey),
      forbiddenFutureObjectiveKeys: allProtectedObjectives, availabilityConditionKeys: sharedActionConditionKeys(hydrated, actions),
    })
  }
  for (const interaction of context.mapInteractionCatalog.interactions) {
    const binding = context.questDesignDocuments.catalogBindings.interactions.find(item => item.interactionKey === interaction.key)
      ?? fail(`缺少地点交互运行绑定:${interaction.key}`)
    const location = context.mapInteractionCatalog.locations.find(item => item.key === interaction.locationKey)!
    const actions = playerActionKeys(hydrated, [binding.actionKey])
    addScene({
      sceneKey: `scene.interaction.${interaction.key}`, sourceKind: 'location-interaction', sourceKey: interaction.key,
      suggestedTitle: interaction.title, purpose: interaction.description, regionKey: location.regionKey,
      locationKey: interaction.locationKey, questKey: null, stageKey: null, objectiveKey: null,
      actorKey: null, interactionKey: interaction.key, randomEventKey: null, participantKeys: [],
      actionKeys: actions, choiceCount: actions.length, allowedKnowledgeClaimKeys: packClaimKeys(hydrated, location.regionKey),
      forbiddenFutureObjectiveKeys: allProtectedObjectives, availabilityConditionKeys: [...binding.conditionKeys],
    })
  }
  for (const event of context.directorDecks.randomEvents) {
    const regionKey = event.regionKeys[0] ?? context.mapInteractionCatalog.initialRegionKey
    addScene({
      sceneKey: `scene.event.${event.key}`, sourceKind: 'random-event', sourceKey: event.key,
      suggestedTitle: event.title, purpose: event.description, regionKey,
      locationKey: event.locationKeys[0] ?? context.mapInteractionCatalog.regions.find(region => region.key === regionKey)?.locationKeys[0]
        ?? context.mapInteractionCatalog.initialLocationKey,
      questKey: null, stageKey: null, objectiveKey: null, actorKey: null, interactionKey: null,
      randomEventKey: event.key, participantKeys: [], actionKeys: playerActionKeys(hydrated, event.actionKeys),
      choiceCount: playerActionKeys(hydrated, event.actionKeys).length,
      allowedKnowledgeClaimKeys: packClaimKeys(hydrated, regionKey), forbiddenFutureObjectiveKeys: allProtectedObjectives,
      availabilityConditionKeys: [...event.conditionKeys],
    })
  }
  const actionLanguageDemands: TextOpenWorldActionLanguageDemandV1[] = context.questDesignDocuments.actions
    .filter(action => action.actorScope === 'player' && !COMBAT_CATEGORIES.has(action.category))
    .map((action, index) => ({
      actionNumber: index + 1, actionKey: action.key,
    }))
  const templateVariantDemands: TextOpenWorldTemplateVariantDemandV1[] = context.directorDecks.templates.flatMap(template => (
    template.variantTextRequirementKeys.map(requirementKey => ({
      variantNumber: 0, requirementKey, templateKey: template.key, questKey: template.questKey, regionKeys: [...template.regionKeys],
    }))
  )).map((value, index) => ({ ...value, variantNumber: index + 1 }))
  const randomEventPresentationDemands: TextOpenWorldRandomEventPresentationDemandV1[] = context.directorDecks.randomEvents.map((event, index) => {
    const pack = context.regionNarrativePacks.packs.find(item => item.regionKey === event.regionKeys[0])
    const seed = pack?.randomEventSeeds.find(item => item.key === event.sourceSeedKey)
    const runtimeKnowledge = governedKnowledge(hydrated) && event.rumorKey
      ? knowledgeBindings(hydrated).find(binding => (
          binding.propagationEventKey === event.key && binding.rumorKey === event.rumorKey
        )) ?? fail(`Director传闻事件缺少P8F Knowledge绑定:${event.key}`)
      : null
    return {
      eventNumber: index + 1, randomEventKey: event.key, title: event.title, kind: event.kind,
      regionKey: event.regionKeys[0]!, locationKeys: [...event.locationKeys], rumorRequirementKey: event.rumorRequirementKey,
      sourceClaimKeys: governedKnowledge(hydrated)
        ? [...(runtimeKnowledge?.sourceClaimKeys ?? [])]
        : existingClaimKeys(hydrated, [...(seed?.sourceClaimKeys ?? []), ...(pack?.sourceClaimKeys ?? [])]),
    }
  })
  const knowledgePresentationDemands = governedKnowledge(hydrated)
    ? knowledgeBindings(hydrated).map(binding => ({
        knowledgeNumber: binding.order,
        knowledgeKey: binding.knowledgeKey,
        kind: binding.kind,
        publicSubjectLabel: publicKnowledgeSubjectLabel(hydrated, binding),
      }))
    : undefined
  const achievementPresentationDemands = governedKnowledge(hydrated)
    ? achievementBindings(hydrated).map(binding => ({
        achievementNumber: binding.order,
        achievementKey: binding.achievementKey,
        sourceKind: binding.sourceKind,
        publicSourceLabel: publicAchievementSourceLabel(hydrated, binding),
      }))
    : undefined
  return {
    knowledgeBoundaries,
    sceneDemands: scenes,
    actionLanguageDemands,
    templateVariantDemands,
    randomEventPresentationDemands,
    ...(knowledgePresentationDemands ? { knowledgePresentationDemands } : {}),
    ...(achievementPresentationDemands ? { achievementPresentationDemands } : {}),
  }
}

async function validateUpstream(context: Omit<TextOpenWorldSceneScriptsInputContextV1, 'contextSelectionHash'>): Promise<void> {
  const artifacts: Array<[Record<string, unknown>, string, string]> = [
    [context.sourceLedger as unknown as Record<string, unknown>, 'ledgerHash', 'SourceLedger'],
    [context.experienceContract as unknown as Record<string, unknown>, 'experienceContractHash', 'ExperienceContract'],
    [context.storyArc as unknown as Record<string, unknown>, 'storyArcHash', 'StoryArc'],
    [context.regionNarrativePacks as unknown as Record<string, unknown>, 'regionNarrativePacksHash', 'RegionNarrativePacks'],
  ]
  for (const [value, hashKey, label] of artifacts) await assertOwnHash(value, hashKey, label)
  if (!isSha256Hash(context.questSkeletons.questSkeletonsHash)
    || !isSha256Hash(context.contentRequirementManifestHash)
    || !isSha256Hash(context.npcRuntimeCatalog.npcRuntimeCatalogHash)
    || !isSha256Hash(context.mapInteractionCatalog.mapInteractionCatalogHash)
    || !isSha256Hash(context.questDesignDocuments.questDesignDocumentsHash)
    || !isSha256Hash(context.directorDecks.directorDecksHash)) fail('P9上游投影Hash无效')
  if (artifacts.some(([value]) => value.productInstanceKey !== context.productInstanceKey)
    || context.questSkeletons.productInstanceKey !== context.productInstanceKey
    || context.npcRuntimeCatalog.productInstanceKey !== context.productInstanceKey
    || context.mapInteractionCatalog.productInstanceKey !== context.productInstanceKey
    || context.questDesignDocuments.productInstanceKey !== context.productInstanceKey
    || context.directorDecks.productInstanceKey !== context.productInstanceKey) fail('P9上游产品实例不一致')
  if (context.experienceContract.sourceLedgerHash !== context.sourceLedger.ledgerHash
    || context.storyArc.sourceLedgerHash !== context.sourceLedger.ledgerHash
    || context.storyArc.experienceContractHash !== context.experienceContract.experienceContractHash
    || context.regionNarrativePacks.sourceLedgerHash !== context.sourceLedger.ledgerHash
    || context.regionNarrativePacks.experienceContractHash !== context.experienceContract.experienceContractHash
    || context.questSkeletons.regionNarrativePacksHash !== context.regionNarrativePacks.regionNarrativePacksHash
    || context.npcRuntimeCatalog.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.npcRuntimeCatalog.contentRequirementManifestHash !== context.contentRequirementManifestHash
    || context.npcRuntimeCatalog.regionNarrativePacksHash !== context.regionNarrativePacks.regionNarrativePacksHash
    || context.mapInteractionCatalog.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.mapInteractionCatalog.contentRequirementManifestHash !== context.contentRequirementManifestHash
    || context.mapInteractionCatalog.regionNarrativePacksHash !== context.regionNarrativePacks.regionNarrativePacksHash
    || context.questDesignDocuments.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.questDesignDocuments.contentRequirementManifestHash !== context.contentRequirementManifestHash
    || context.questDesignDocuments.npcRuntimeCatalogHash !== context.npcRuntimeCatalog.npcRuntimeCatalogHash
    || context.questDesignDocuments.mapInteractionCatalogHash !== context.mapInteractionCatalog.mapInteractionCatalogHash
    || context.questDesignDocuments.regionNarrativePacksHash !== context.regionNarrativePacks.regionNarrativePacksHash
    || context.directorDecks.questDesignDocumentsHash !== context.questDesignDocuments.questDesignDocumentsHash
    || context.directorDecks.mapInteractionCatalogHash !== context.mapInteractionCatalog.mapInteractionCatalogHash
    || context.directorDecks.regionNarrativePacksHash !== context.regionNarrativePacks.regionNarrativePacksHash) fail('P9上游Hash链不一致')
  if (!context.questDesignDocuments.governance.questAndEncounterBindingsReady
    || !context.questDesignDocuments.governance.sceneBindingsDeferred
    || !context.directorDecks.governance.presentationVariantsDeferred
    || !context.experienceContract.freedom.acceptedInputs.includes('system-action')
    || !context.experienceContract.freedom.acceptedInputs.includes('fixed-choice')
    || !context.experienceContract.freedom.acceptedInputs.includes('natural-language')) fail('P9所需运行绑定或三类交互边界尚未就绪')
  const freshKnowledge = governedKnowledge(context)
  if (freshKnowledge) {
    const bindings = context.questDesignDocuments.knowledgeBindings
    const achievements = context.questDesignDocuments.achievementBindings
    if (context.modelDisclosureContract !== 'governed-v3'
      || !context.questDesignDocuments.governance.allRumorsHaveUniquePropagationPath
      || !context.questDesignDocuments.governance.allKnowledgeHasConfirmationPath
      || !context.questDesignDocuments.governance.allAchievementsOneTimeReachable
      || !context.directorDecks.governance.knowledgeProgressReady
      || !context.directorDecks.governance.allRumorsHaveUniquePropagationPath
      || !Array.isArray(bindings) || !Array.isArray(achievements)) {
      fail('P9 governed-v3知识、传闻或成就上游合同未闭合')
    }
    if (bindings.some((binding, index) => binding.order !== index + 1)
      || achievements.some((binding, index) => binding.order !== index + 1)
      || new Set(bindings.map(binding => binding.knowledgeKey)).size !== bindings.length
      || new Set(bindings.map(binding => binding.rumorKey)).size !== bindings.length
      || new Set(achievements.map(binding => binding.achievementKey)).size !== achievements.length) {
      fail('P9 governed-v3知识、传闻或成就顺序/稳定键无效')
    }
    for (const binding of bindings) {
      const event = context.directorDecks.randomEvents.find(candidate => candidate.key === binding.propagationEventKey)
      if (!event || event.kind !== 'clue' || event.sourceSeedKey !== binding.sourceRumorKey
        || event.rumorKey !== binding.rumorKey
        || canonicalProductProductionJsonV2(event.conditionKeys) !== canonicalProductProductionJsonV2(binding.propagationConditionKeys)) {
        fail(`P9 governed-v3传闻没有唯一P8F/Director传播绑定:${binding.rumorKey}`)
      }
      if (context.directorDecks.randomEvents.filter(candidate => candidate.rumorKey === binding.rumorKey).length !== 1) {
        fail(`P9 governed-v3传闻被多个Director事件引用:${binding.rumorKey}`)
      }
    }
  } else if (context.modelDisclosureContract != null
    || context.questDesignDocuments.knowledgeBindings != null
    || context.questDesignDocuments.achievementBindings != null) {
    fail('历史P9 Context不得伪装governed-v3知识合同')
  }
  if (context.questDesignDocuments.actions.length === 0
    || new Set(context.questDesignDocuments.actions.map(action => action.key)).size !== context.questDesignDocuments.actions.length
    || context.questDesignDocuments.actions.some(action => !isSha256Hash(action.actionDefinitionHash))) {
    fail('P9 Action投影键或Definition Hash无效')
  }
  const endingBindingActionKeys = context.questDesignDocuments.endingBindings.routes.map(route => route.actionKey)
  if (!context.questDesignDocuments.quests.some(quest => (
    quest.key === context.questDesignDocuments.endingBindings.finalMainlineQuestKey && quest.type === 'mainline'
  ))
    || !endingBindingActionKeys.length
    || new Set(context.questDesignDocuments.endingBindings.routes.map(route => route.endingKey)).size !== endingBindingActionKeys.length
    || endingBindingActionKeys.some(actionKey => {
      const action = context.questDesignDocuments.actions.find(item => item.key === actionKey)
      return !action || action.actorScope !== 'player' || action.category !== 'quest-action'
        || action.targetScope !== 'none'
        || !action.locationKeys.includes(context.questDesignDocuments.endingBindings.finalLocationKey)
        || !action.requirementConditionKeys.includes(context.questDesignDocuments.endingBindings.selectionReadyConditionKey)
    })) fail('P9上游没有完整的P8F结局Action绑定')
  const expected = buildDemands(context)
  if (canonicalProductProductionJsonV2(expected.knowledgeBoundaries) !== canonicalProductProductionJsonV2(context.knowledgeBoundaries)
    || canonicalProductProductionJsonV2(expected.sceneDemands) !== canonicalProductProductionJsonV2(context.sceneDemands)
    || canonicalProductProductionJsonV2(expected.actionLanguageDemands) !== canonicalProductProductionJsonV2(context.actionLanguageDemands)
    || canonicalProductProductionJsonV2(expected.templateVariantDemands) !== canonicalProductProductionJsonV2(context.templateVariantDemands)
    || canonicalProductProductionJsonV2(expected.randomEventPresentationDemands) !== canonicalProductProductionJsonV2(context.randomEventPresentationDemands)
    || canonicalProductProductionJsonV2(expected.knowledgePresentationDemands ?? []) !== canonicalProductProductionJsonV2(context.knowledgePresentationDemands ?? [])
    || canonicalProductProductionJsonV2(expected.achievementPresentationDemands ?? []) !== canonicalProductProductionJsonV2(context.achievementPresentationDemands ?? [])) {
    fail('P9生产需求不是已验收Artifact的确定性投影')
  }
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldSceneScriptsInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId),
    readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const keys = [
    'text-open-world.source-ledger', 'text-open-world.experience-contract', 'text-open-world.story-arc',
    'text-open-world.region-narrative-packs', 'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
    'text-open-world.npc-runtime-catalog', 'text-open-world.map-interaction-catalog',
    'text-open-world.quest-design-documents', 'text-open-world.director-decks',
  ] as const
  const selected = Object.fromEntries(keys.map(key => [key, unique(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const values = keys.map(key => artifact<unknown>(selected[key], key))
  for (let index = 0; index < keys.length; index += 1) {
    if (await hashProductProductionValueV2(values[index]) !== selected[keys[index]].contentHash) fail(`Artifact行Hash不匹配:${keys[index]}`)
  }
  const sourceLedger = values[0] as TextOpenWorldSourceLedgerV1
  const experienceContract = values[1] as TextOpenWorldExperienceContractV1
  const storyArc = values[2] as TextOpenWorldStoryArcV1
  const regionNarrativePacks = values[3] as TextOpenWorldRegionNarrativePacksV1
  const questSkeletons = values[4] as TextOpenWorldQuestSkeletonsV1
  const contentRequirementManifest = values[5] as TextOpenWorldContentRequirementManifestV1
  const npcRuntimeCatalog = values[6] as TextOpenWorldNpcRuntimeCatalogV1
  const mapInteractionCatalog = values[7] as TextOpenWorldMapInteractionCatalogV1
  const questDesignDocuments = values[8] as TextOpenWorldQuestDesignDocumentsV1
  const directorDecks = values[9] as TextOpenWorldDirectorDecksV1
  const fullArtifacts: Array<[Record<string, unknown>, string, string]> = [
    [sourceLedger as unknown as Record<string, unknown>, 'ledgerHash', 'SourceLedger'],
    [experienceContract as unknown as Record<string, unknown>, 'experienceContractHash', 'ExperienceContract'],
    [storyArc as unknown as Record<string, unknown>, 'storyArcHash', 'StoryArc'],
    [regionNarrativePacks as unknown as Record<string, unknown>, 'regionNarrativePacksHash', 'RegionNarrativePacks'],
    [questSkeletons as unknown as Record<string, unknown>, 'questSkeletonsHash', 'QuestSkeletons'],
    [contentRequirementManifest as unknown as Record<string, unknown>, 'contentRequirementManifestHash', 'Manifest'],
    [npcRuntimeCatalog as unknown as Record<string, unknown>, 'npcRuntimeCatalogHash', 'NpcRuntimeCatalog'],
    [mapInteractionCatalog as unknown as Record<string, unknown>, 'mapInteractionCatalogHash', 'MapInteractionCatalog'],
    [questDesignDocuments as unknown as Record<string, unknown>, 'questDesignDocumentsHash', 'QuestDesignDocuments'],
    [directorDecks as unknown as Record<string, unknown>, 'directorDecksHash', 'DirectorDecks'],
  ]
  for (const [value, hashKey, label] of fullArtifacts) await assertOwnHash(value, hashKey, label)
  const actionSources: TextOpenWorldSceneActionSourceV1[] = await Promise.all(questDesignDocuments.actions.map(async action => ({
    key: action.key, category: action.category, label: action.label, description: action.description,
    actorScope: action.actorScope, targetScope: action.targetScope, locationKeys: [...action.locationKeys],
    requirementConditionKeys: [...action.requirementConditionKeys], confirmationPolicy: action.confirmationPolicy,
    actionDefinitionHash: await hashProductProductionValueV2(action),
  })))
  const base: TextOpenWorldSceneScriptsContextBaseV1 = {
    schema: 'storyforge.text-open-world-scene-scripts-input' as const, version: 2 as const,
    ...(questDesignDocuments.governance.knowledgeProgressReady === true
      ? { modelDisclosureContract: 'governed-v3' as const }
      : {}),
    productInstanceKey: production.productionKey,
    sourceLedger, experienceContract, storyArc, regionNarrativePacks,
    questSkeletons: {
      productInstanceKey: questSkeletons.productInstanceKey,
      regionNarrativePacksHash: questSkeletons.regionNarrativePacksHash,
      quests: questSkeletons.quests.map(quest => ({
        key: quest.key, source: quest.source, regionKeys: quest.regionKeys, locationKeys: quest.locationKeys,
        stageKeys: quest.stageKeys, storyMotivation: quest.storyMotivation,
      })),
      stages: questSkeletons.stages.map(stage => ({
        key: stage.key, questKey: stage.questKey, order: stage.order, objectiveKeys: stage.objectiveKeys,
      })),
      objectives: questSkeletons.objectives.map(objective => ({
        key: objective.key, questKey: objective.questKey, stageKey: objective.stageKey,
        order: objective.order, title: objective.title,
      })),
      questSkeletonsHash: questSkeletons.questSkeletonsHash,
    },
    contentRequirementManifestHash: contentRequirementManifest.contentRequirementManifestHash,
    npcRuntimeCatalog: {
      productInstanceKey: npcRuntimeCatalog.productInstanceKey,
      regionNarrativePacksHash: npcRuntimeCatalog.regionNarrativePacksHash,
      questSkeletonsHash: npcRuntimeCatalog.questSkeletonsHash,
      contentRequirementManifestHash: npcRuntimeCatalog.contentRequirementManifestHash,
      factions: npcRuntimeCatalog.factions.map(faction => ({
        key: faction.key, title: faction.title, description: faction.description, publicGoal: faction.publicGoal,
      })),
      actors: npcRuntimeCatalog.actors.map(actor => ({
        key: actor.key, name: actor.name, biography: actor.biography, portrayal: actor.portrayal,
        factionKey: actor.factionKey, homeLocationKey: actor.homeLocationKey, regionKey: actor.regionKey,
        sourceDemandKey: actor.sourceDemandKey, demandKind: actor.demandKind, tier: actor.tier,
        runtimeMode: actor.runtimeMode, serviceKeys: [...actor.serviceKeys],
        fulfilledRequirementKeys: [...actor.fulfilledRequirementKeys],
      })),
      npcRuntimeCatalogHash: npcRuntimeCatalog.npcRuntimeCatalogHash,
    },
    mapInteractionCatalog: {
      productInstanceKey: mapInteractionCatalog.productInstanceKey,
      regionNarrativePacksHash: mapInteractionCatalog.regionNarrativePacksHash,
      questSkeletonsHash: mapInteractionCatalog.questSkeletonsHash,
      contentRequirementManifestHash: mapInteractionCatalog.contentRequirementManifestHash,
      initialRegionKey: mapInteractionCatalog.initialRegionKey,
      initialLocationKey: mapInteractionCatalog.initialLocationKey,
      regions: mapInteractionCatalog.regions.map(region => ({
        key: region.key, title: region.title, description: region.description,
        theme: region.theme, locationKeys: region.locationKeys,
      })),
      locations: mapInteractionCatalog.locations.map(location => ({
        key: location.key, regionKey: location.regionKey, title: location.title,
        description: location.description, purpose: location.purpose,
      })),
      interactions: mapInteractionCatalog.interactions.map(interaction => ({
        key: interaction.key, title: interaction.title, description: interaction.description,
        playerPrompt: interaction.playerPrompt, regionKey: interaction.regionKey, locationKey: interaction.locationKey,
      })),
      mapInteractionCatalogHash: mapInteractionCatalog.mapInteractionCatalogHash,
    },
    questDesignDocuments: {
      productInstanceKey: questDesignDocuments.productInstanceKey,
      regionNarrativePacksHash: questDesignDocuments.regionNarrativePacksHash,
      questSkeletonsHash: questDesignDocuments.questSkeletonsHash,
      contentRequirementManifestHash: questDesignDocuments.contentRequirementManifestHash,
      npcRuntimeCatalogHash: questDesignDocuments.npcRuntimeCatalogHash,
      mapInteractionCatalogHash: questDesignDocuments.mapInteractionCatalogHash,
      quests: questDesignDocuments.quests.map(quest => ({
        key: quest.key, type: quest.type, title: quest.title, ownerKind: quest.ownerKind, ownerKey: quest.ownerKey,
        regionKeys: quest.regionKeys, stageKeys: quest.stageKeys, prerequisiteConditionKeys: quest.prerequisiteConditionKeys,
        rewardContractKey: quest.rewardContractKey, acceptActionKey: quest.acceptActionKey, claimActionKey: quest.claimActionKey,
      })),
      objectives: questDesignDocuments.objectives.map(objective => ({
        key: objective.key, questKey: objective.questKey, stageKey: objective.stageKey, title: objective.title,
        description: objective.description, requirementKeys: objective.requirementKeys,
        supportActionKeys: objective.supportActionKeys, completionActionKey: objective.completionActionKey,
        completionConditionKeys: objective.completionConditionKeys,
      })),
      requirementBindings: questDesignDocuments.requirementBindings,
      ...(questDesignDocuments.knowledgeBindings
        ? { knowledgeBindings: structuredClone(questDesignDocuments.knowledgeBindings) }
        : {}),
      ...(questDesignDocuments.achievementBindings
        ? { achievementBindings: structuredClone(questDesignDocuments.achievementBindings) }
        : {}),
      actions: actionSources,
      endingBindings: questDesignDocuments.endingBindings,
      catalogBindings: {
        actors: questDesignDocuments.catalogBindings.actors,
        encounters: questDesignDocuments.catalogBindings.encounters,
        items: questDesignDocuments.catalogBindings.items,
        recipes: questDesignDocuments.catalogBindings.recipes,
        vendors: questDesignDocuments.catalogBindings.vendors,
        interactions: questDesignDocuments.catalogBindings.interactions,
        rewards: questDesignDocuments.catalogBindings.rewards,
      },
      governance: {
        questAndEncounterBindingsReady: questDesignDocuments.governance.questAndEncounterBindingsReady,
        sceneBindingsDeferred: questDesignDocuments.governance.sceneBindingsDeferred,
        ...(questDesignDocuments.governance.restartActionsRequireOriginalOfferRoute === true
          ? { restartActionsRequireOriginalOfferRoute: true as const }
          : {}),
        ...(questDesignDocuments.governance.knowledgeProgressReady === true
          ? {
              knowledgeProgressReady: true as const,
              allRumorsHaveUniquePropagationPath: questDesignDocuments.governance.allRumorsHaveUniquePropagationPath,
              allKnowledgeHasConfirmationPath: questDesignDocuments.governance.allKnowledgeHasConfirmationPath,
              allAchievementsOneTimeReachable: questDesignDocuments.governance.allAchievementsOneTimeReachable,
            }
          : {}),
      },
      questDesignDocumentsHash: questDesignDocuments.questDesignDocumentsHash,
    },
    directorDecks: {
      productInstanceKey: directorDecks.productInstanceKey,
      regionNarrativePacksHash: directorDecks.regionNarrativePacksHash,
      mapInteractionCatalogHash: directorDecks.mapInteractionCatalogHash,
      questDesignDocumentsHash: directorDecks.questDesignDocumentsHash,
      templates: directorDecks.templates.map(template => ({
        key: template.key, questKey: template.questKey, regionKeys: template.regionKeys,
        variantTextRequirementKeys: template.variantTextRequirementKeys,
      })),
      randomEvents: directorDecks.randomEvents,
      governance: {
        presentationVariantsDeferred: directorDecks.governance.presentationVariantsDeferred,
        ...(directorDecks.governance.knowledgeProgressReady === true
          ? {
              knowledgeProgressReady: true as const,
              allRumorsHaveUniquePropagationPath: directorDecks.governance.allRumorsHaveUniquePropagationPath,
            }
          : {}),
      },
      directorDecksHash: directorDecks.directorDecksHash,
    },
  }
  const body: Omit<TextOpenWorldSceneScriptsInputContextV1, 'contextSelectionHash'> = { ...base, ...buildDemands(base) }
  await validateUpstream(body)
  if (governedKnowledge(body) && body.sceneDemands.length !== governedSceneDemandCount(body)) {
    fail('P9 governed-v3 SceneDemand数量不等于确定性上游容量投影')
  }
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  const contextCharacters = canonicalProductProductionJsonV2(context).length
  if (contextCharacters > MAX_CONTEXT_CHARS) fail(`SceneScripts Context超过硬上限(${contextCharacters}/${MAX_CONTEXT_CHARS})，需要拆分P9生产批次`)
  return context
}

export async function readTextOpenWorldSceneScriptsInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadContext({ scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId! }))
}

async function parseContext(value: string): Promise<TextOpenWorldSceneScriptsInputContextV1> {
  let context: TextOpenWorldSceneScriptsInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldSceneScriptsInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-scene-scripts-input'
    || (context.version !== 1 && context.version !== 2)) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (governedKnowledge(context) && context.sceneDemands.length !== governedSceneDemandCount(context)) {
    fail('P9 governed-v3 SceneDemand数量不等于确定性上游容量投影')
  }
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function safeSceneTitle(
  context: TextOpenWorldSceneScriptsInputContextV1,
  demand: TextOpenWorldSceneDemandV1,
): string {
  const quest = demand.questKey
    ? context.questDesignDocuments.quests.find(candidate => candidate.key === demand.questKey)
    : null
  const objective = demand.objectiveKey
    ? context.questDesignDocuments.objectives.find(candidate => candidate.key === demand.objectiveKey)
    : null
  const actor = demand.actorKey
    ? context.npcRuntimeCatalog.actors.find(candidate => candidate.key === demand.actorKey)
    : null
  const interaction = demand.interactionKey
    ? context.mapInteractionCatalog.interactions.find(candidate => candidate.key === demand.interactionKey)
    : null
  const event = demand.randomEventKey
    ? context.directorDecks.randomEvents.find(candidate => candidate.key === demand.randomEventKey)
    : null
  if (demand.sourceKind === 'quest-offer') return quest ? `委托：${quest.title}` : `任务委托场景${demand.sceneNumber}`
  if (demand.sourceKind === 'quest-objective') return objective?.title ?? `任务目标场景${demand.sceneNumber}`
  if (demand.sourceKind === 'quest-resolution') return quest ? `收束：${quest.title}` : `任务收束场景${demand.sceneNumber}`
  if (demand.sourceKind === 'actor-dialogue') return actor ? `与${actor.name}交谈` : `角色对话场景${demand.sceneNumber}`
  if (demand.sourceKind === 'location-interaction') return interaction?.title ?? `地点交互场景${demand.sceneNumber}`
  return event?.title ?? `地区事件场景${demand.sceneNumber}`
}

function safeCurrentObjective(
  context: TextOpenWorldSceneScriptsInputContextV1,
  demand: TextOpenWorldSceneDemandV1,
) {
  if (demand.objectiveKey) {
    return context.questDesignDocuments.objectives.find(candidate => candidate.key === demand.objectiveKey)
      ?? fail(`安全模型投影缺少当前目标:${demand.objectiveKey}`)
  }
  if (!demand.questKey || (demand.sourceKind !== 'quest-offer' && demand.sourceKind !== 'quest-resolution')) return null
  const quest = context.questSkeletons.quests.find(candidate => candidate.key === demand.questKey)
    ?? fail(`安全模型投影缺少任务骨架:${demand.questKey}`)
  const objectiveKeys = quest.stageKeys.flatMap(stageKey => (
    context.questSkeletons.stages.find(stage => stage.key === stageKey)?.objectiveKeys ?? []
  ))
  const objectiveKey = demand.sourceKind === 'quest-offer' ? objectiveKeys[0] : objectiveKeys[objectiveKeys.length - 1]
  return objectiveKey
    ? context.questDesignDocuments.objectives.find(candidate => candidate.key === objectiveKey)
      ?? fail(`安全模型投影缺少任务端点目标:${objectiveKey}`)
    : null
}

function safeScenePurpose(demand: TextOpenWorldSceneDemandV1): string {
  if (demand.sourceKind === 'quest-objective') return '依据currentObjective呈现当前任务目标与正式行动。'
  if (demand.sourceKind === 'location-interaction') return '依据interactionKey引用的公开交互呈现当前地点行动。'
  if (demand.sourceKind === 'random-event') return '依据randomEventKey引用的公开事件材料呈现当前地区事件。'
  if (demand.sourceKind === 'quest-offer') return '依据questKey与currentObjective呈现当前任务委托。'
  if (demand.sourceKind === 'quest-resolution') return '依据questKey与currentObjective呈现已经完成的任务收束。'
  if (demand.sourceKind === 'actor-dialogue') return '依据角色公开身份呈现当前对话入口与可用正式行动。'
  return '呈现当前场景与可用正式行动。'
}

function safeActorPublicProfile(
  actor: TextOpenWorldSceneScriptsInputContextV1['npcRuntimeCatalog']['actors'][number],
) {
  const hasService = (actor.serviceKeys?.length ?? 0) > 0
  return {
    // P7 roleTitle/narrativeFunction/routine/serviceNeeds are content-planning
    // fields, and runtime tier/mode are not diegetic public identity. Everything
    // here is therefore a neutral description derived only from service presence.
    source: 'governed-runtime-public-profile' as const,
    roleTitle: hasService ? '公共服务角色' : '当地角色',
    narrativeFunction: '回应当前场景列出的公开交互与正式行动。',
    routine: '在当前地点按已公开状态提供简短回应。',
    serviceNeeds: hasService ? ['提供当前场景已登记的公共服务。'] : [],
  }
}

function safeActionPublicWritingMaterial(
  context: TextOpenWorldSceneScriptsInputContextV1,
  demand: TextOpenWorldSceneDemandV1,
  action: TextOpenWorldSceneActionSourceV1,
): { label: string; description: string } {
  const objective = demand.objectiveKey
    ? context.questDesignDocuments.objectives.find(candidate => candidate.key === demand.objectiveKey)
    : null
  const quest = demand.questKey
    ? context.questDesignDocuments.quests.find(candidate => candidate.key === demand.questKey)
    : null
  const actor = demand.actorKey
    ? context.npcRuntimeCatalog.actors.find(candidate => candidate.key === demand.actorKey)
    : null
  if (action.category === 'objective-action' && objective) {
    return { label: objective.title, description: objective.description }
  }
  if (action.category === 'talk') {
    return {
      label: actor ? `与${actor.name}交谈` : '与当前角色交谈',
      description: '与当前角色交谈，只呈现其在当前场景愿意公开的信息或服务。',
    }
  }
  if (action.category === 'accept-quest') return {
    label: quest ? `接受：${quest.title}` : '接受当前任务',
    description: '接受当前场景已经公开的任务。',
  }
  if (action.category === 'restart-quest') return {
    label: quest ? `重新接取：${quest.title}` : '重新接取当前任务',
    description: '通过当前公开入口重新接取任务。',
  }
  if (action.category === 'abandon-quest') return {
    label: quest ? `放弃：${quest.title}` : '放弃当前任务',
    description: '放弃当前允许放弃的任务。',
  }
  if (action.category === 'claim-reward') return {
    label: quest ? `领取${quest.title}奖励` : '领取当前任务奖励',
    description: '领取当前已经完成任务的公开奖励。',
  }
  const generic: Partial<Record<TextOpenWorldActionDefinitionV1['category'], [string, string]>> = {
    move: ['移动', '移动到当前场景允许到达的位置。'],
    travel: ['前往目的地', '沿当前可用道路前往指定地点。'],
    'fast-travel': ['快速旅行', '前往已经到访并解锁的旅行点。'],
    observe: ['观察', '观察当前地点已经公开的环境。'],
    investigate: ['调查', '调查当前地点已经公开的线索。'],
    take: ['拿取物品', '拿取当前场景允许取得的物品。'],
    use: ['使用物品', '使用当前场景指定的物品。'],
    equip: ['装备物品', '装备当前指定的物品。'],
    unequip: ['卸下装备', '卸下当前指定的装备。'],
    drop: ['丢弃物品', '丢弃当前允许丢弃的物品。'],
    buy: ['购买', '向当前商店购买可用商品。'],
    sell: ['出售', '向当前商店出售可交易物品。'],
    craft: ['制作', '使用当前已学习配方制作物品。'],
    'quest-action': ['推进当前任务', '按当前已公开条件推进任务。'],
    'start-combat': ['开始战斗', '进入当前场景已经公开的战斗。'],
    escape: ['逃跑', '尝试离开当前战斗。'],
    'attack-actor': ['攻击', '攻击当前允许成为目标的角色。'],
    steal: ['偷窃', '尝试从当前允许的目标处偷窃。'],
    deceive: ['欺骗', '尝试欺骗当前交互目标。'],
    crime: ['实施犯罪行为', '执行当前允许判定的犯罪行为。'],
    rest: ['休息', '休息并让世界时间继续推进。'],
    respawn: ['复活', '在当前可用的安全点恢复。'],
    read: ['阅读', '阅读当前可见的记录。'],
    track: ['追踪任务', '更新当前任务追踪。'],
    untrack: ['取消追踪任务', '取消当前任务追踪。'],
    save: ['保存进度', '保存当前游戏进度。'],
    'load-branch': ['读取存档', '读取当前可用的存档分支。'],
  }
  const material = generic[action.category]
  return material
    ? { label: material[0], description: material[1] }
    : { label: '执行当前行动', description: '执行当前场景列出的确定性系统行动。' }
}

function safeSceneActionTargets(
  context: TextOpenWorldSceneScriptsInputContextV1,
  demand: TextOpenWorldSceneDemandV1,
) {
  return demand.actionKeys.map(actionKey => {
    const action = actionByKey(context, actionKey)
    const target = fixedTarget({ context, demand, action })
    return { actionKey: action.key, targetPolicy: target.targetPolicy, targetKey: target.targetKey }
  })
}

function modelDemandView(
  context: TextOpenWorldSceneScriptsInputContextV1,
  slice: TextOpenWorldSceneScriptsModelContextSliceV1,
) {
  if (slice.kind === 'shared-presentations') {
    return {
      knowledgeBoundaries: [] as TextOpenWorldSceneKnowledgeBoundaryV1[],
      sceneDemands: [] as TextOpenWorldSceneDemandV1[],
      // Global Action prose may encode future objectives, ending routes or NPC
      // portrayal. Fresh builds generate conservative mapper utterances in
      // deterministic code instead of disclosing those Actions to a shared model.
      actionLanguageDemands: [] as TextOpenWorldActionLanguageDemandV1[],
      templateVariantDemands: context.templateVariantDemands,
      randomEventPresentationDemands: context.randomEventPresentationDemands,
      knowledgePresentationDemands: context.knowledgePresentationDemands ?? [],
      achievementPresentationDemands: context.achievementPresentationDemands ?? [],
    }
  }
  if (!Number.isInteger(slice.sceneIndex)
    || slice.sceneIndex < 0
    || slice.sceneIndex >= context.sceneDemands.length) {
    fail(`场景模型切片序号无效:${slice.sceneIndex}`)
  }
  const source = context.sceneDemands[slice.sceneIndex]!
  const boundaries = context.knowledgeBoundaries
    .filter(boundary => boundary.key === source.knowledgeBoundaryKey)
  if (boundaries.length !== 1) fail(`场景模型切片需要唯一知识边界:${source.sceneKey}`)
  return {
    knowledgeBoundaries: boundaries,
    // Fragment-local ordinals let the existing strict draft parser validate
    // each response in isolation. The executor restores canonical global
    // ordinals only after all fragments have passed their narrowed contracts.
    sceneDemands: [{ ...source, sceneNumber: 1 }],
    actionLanguageDemands: [] as TextOpenWorldActionLanguageDemandV1[],
    templateVariantDemands: [] as TextOpenWorldTemplateVariantDemandV1[],
    randomEventPresentationDemands: [] as TextOpenWorldRandomEventPresentationDemandV1[],
    knowledgePresentationDemands: [] as TextOpenWorldKnowledgePresentationDemandV1[],
    achievementPresentationDemands: [] as TextOpenWorldAchievementPresentationDemandV1[],
  }
}

function draftParsingContext(
  context: TextOpenWorldSceneScriptsInputContextV1,
  slice: TextOpenWorldSceneScriptsModelContextSliceV1,
): TextOpenWorldSceneScriptsInputContextV1 {
  const view = modelDemandView(context, slice)
  return {
    ...context,
    knowledgeBoundaries: view.knowledgeBoundaries.map(boundary => ({
      ...boundary,
      allowedKnowledgeClaimKeys: [...boundary.allowedKnowledgeClaimKeys],
      forbiddenFutureObjectiveKeys: [...boundary.forbiddenFutureObjectiveKeys],
    })),
    sceneDemands: view.sceneDemands.map(demand => ({
      ...demand,
      participantKeys: [...demand.participantKeys],
      actionKeys: [...demand.actionKeys],
      availabilityConditionKeys: [...demand.availabilityConditionKeys],
    })),
    actionLanguageDemands: view.actionLanguageDemands.map(demand => ({ ...demand })),
    templateVariantDemands: view.templateVariantDemands.map(demand => ({
      ...demand,
      regionKeys: [...demand.regionKeys],
    })),
    randomEventPresentationDemands: view.randomEventPresentationDemands.map(demand => ({
      ...demand,
      locationKeys: [...demand.locationKeys],
      sourceClaimKeys: [...demand.sourceClaimKeys],
    })),
    knowledgePresentationDemands: view.knowledgePresentationDemands.map(demand => ({ ...demand })),
    achievementPresentationDemands: view.achievementPresentationDemands.map(demand => ({ ...demand })),
  }
}

/**
 * The durable P9 Context remains the complete version-2 compiler contract so
 * historical runs can still be replayed. Fresh Knowledge builds must never
 * deliver that envelope to the model: this deterministic projection contains
 * only ordinals, stable references and public labels needed by one isolated
 * prose request. In particular it has no SourceLedger rows, story prose, NPC
 * private prose or hidden truths. Governed callers must choose exactly one
 * Scene (with at most its current/already-completed endpoint objective) or the
 * zero-Scene shared-presentation slice; a full governed projection is rejected.
 */
export async function createTextOpenWorldSceneScriptsModelContextV1(
  context: TextOpenWorldSceneScriptsInputContextV1,
  slice?: TextOpenWorldSceneScriptsModelContextSliceV1,
): Promise<TextOpenWorldSceneScriptsInputContextV1 | Record<string, unknown>> {
  if (!governedKnowledge(context)) return context
  if (context.sceneDemands.length > TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1) {
    fail(`P9 governed-v3场景数超过硬上限:${context.sceneDemands.length}/${TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1}`)
  }
  if (!slice) fail('governed-v3模型上下文必须使用场景或共享表现硬隔离切片')
  const view = modelDemandView(context, slice)
  const regionKeys = new Set([
    ...view.sceneDemands.map(demand => demand.regionKey),
    ...view.templateVariantDemands.flatMap(demand => demand.regionKeys),
    ...view.randomEventPresentationDemands.map(demand => demand.regionKey),
  ])
  const locationKeys = new Set([
    ...view.sceneDemands.map(demand => demand.locationKey),
    ...view.randomEventPresentationDemands.flatMap(demand => demand.locationKeys),
  ])
  const questKeys = new Set([
    ...view.sceneDemands.flatMap(demand => demand.questKey ? [demand.questKey] : []),
    ...view.templateVariantDemands.map(demand => demand.questKey),
  ])
  const actorKeys = new Set(view.sceneDemands.flatMap(demand => [
    ...demand.participantKeys,
    ...(demand.actorKey ? [demand.actorKey] : []),
  ]))
  const actionKeys = new Set([
    ...view.sceneDemands.flatMap(demand => demand.actionKeys),
    ...view.actionLanguageDemands.map(demand => demand.actionKey),
  ])
  const interactionKeys = new Set(view.sceneDemands.flatMap(demand => demand.interactionKey ? [demand.interactionKey] : []))
  const randomEventKeys = new Set([
    ...view.sceneDemands.flatMap(demand => demand.randomEventKey ? [demand.randomEventKey] : []),
    ...view.randomEventPresentationDemands.map(demand => demand.randomEventKey),
  ])
  const publicActors = selectByKeys(context.npcRuntimeCatalog.actors, actorKeys, '公开角色')
  const factionKeys = new Set(publicActors.flatMap(actor => actor.factionKey ? [actor.factionKey] : []))
  const templateSourceByQuestKey = new Map<string, string>()
  for (const demand of view.templateVariantDemands) {
    const skeleton = context.questSkeletons.quests.find(candidate => candidate.key === demand.questKey)
      ?? fail(`安全模型投影缺少模板任务骨架:${demand.questKey}`)
    if (skeleton.source.kind !== 'template-seed') fail(`模板文字需求没有P7模板种子来源:${demand.questKey}`)
    templateSourceByQuestKey.set(demand.questKey, skeleton.source.sourceKey)
  }
  const templateSourceKeys = new Set(templateSourceByQuestKey.values())
  const publicCatalogs = {
    regions: selectByKeys(context.mapInteractionCatalog.regions, regionKeys, '地区').map(region => ({
      regionKey: region.key,
      title: region.title,
      description: region.description,
      theme: region.theme,
    })),
    locations: selectByKeys(context.mapInteractionCatalog.locations, locationKeys, '地点').map(location => ({
      locationKey: location.key,
      regionKey: location.regionKey,
      title: location.title,
      description: location.description,
      purpose: location.purpose,
    })),
    factions: selectByKeys(context.npcRuntimeCatalog.factions, factionKeys, '公开势力').map(faction => ({
      factionKey: faction.key,
      title: faction.title,
      publicGoal: faction.publicGoal,
    })),
    actors: publicActors.map(actor => ({
      actorKey: actor.key,
      name: actor.name,
      factionKey: actor.factionKey,
      ...(slice.kind === 'scene' && view.sceneDemands[0]?.sourceKind === 'actor-dialogue'
        ? { publicProfile: safeActorPublicProfile(actor) }
        : {}),
    })),
    quests: selectByKeys(context.questDesignDocuments.quests, questKeys, '任务').map(quest => ({
      questKey: quest.key,
      type: quest.type,
      title: quest.title,
    })),
    actions: selectByKeys(context.questDesignDocuments.actions, actionKeys, 'Action').map(action => {
      const sceneDemand = view.sceneDemands[0] ?? fail('共享表现模型请求不得读取Action正文')
      const material = safeActionPublicWritingMaterial(context, sceneDemand, action)
      return {
        actionKey: action.key,
        label: material.label,
        description: material.description,
        targetScope: action.targetScope,
      }
    }),
    interactions: selectByKeys(context.mapInteractionCatalog.interactions, interactionKeys, '地点交互').map(interaction => ({
      interactionKey: interaction.key,
      title: interaction.title,
      description: interaction.description,
      playerPrompt: interaction.playerPrompt,
      regionKey: interaction.regionKey,
      locationKey: interaction.locationKey,
    })),
    randomEvents: selectByKeys(context.directorDecks.randomEvents, randomEventKeys, 'Director事件').map(event => ({
      randomEventKey: event.key,
      title: event.title,
      description: event.rumorKey ? null : event.description,
      kind: event.kind,
      regionKeys: [...event.regionKeys],
      locationKeys: [...event.locationKeys],
    })),
    taskTemplates: context.regionNarrativePacks.packs.flatMap(pack => pack.taskTemplateSeeds)
      .filter(seed => templateSourceKeys.has(seed.key))
      .map(seed => ({
        sourceSeedKey: seed.key,
        title: seed.title,
        storyFrame: seed.storyFrame,
        variationAxes: [...seed.variationAxes],
        eligibilitySummary: seed.eligibilitySummary,
        cooldownIntent: seed.cooldownIntent,
      })),
  }
  if (publicCatalogs.taskTemplates.length !== templateSourceKeys.size) fail('安全模型投影缺少P7模板种子')
  const compactPublicCatalogs = Object.fromEntries(
    Object.entries(publicCatalogs).filter(([, rows]) => rows.length > 0),
  )
  const body = {
    schema: 'storyforge.text-open-world-scene-scripts-model-input' as const,
    version: 1 as const,
    productInstanceKey: context.productInstanceKey,
    modelDisclosureContract: 'governed-v3' as const,
    writingPolicy: slice.kind === 'scene'
      ? { toneGuide: [...context.experienceContract.toneGuide] }
      : {
          toneGuide: [...context.experienceContract.toneGuide],
          resultAuthority: 'text-open-world.quest-design-documents.actions' as const,
        },
    publicCatalogs: compactPublicCatalogs,
    knowledgeBoundaries: view.knowledgeBoundaries.map(boundary => ({
      key: boundary.key,
      // The durable compiler contract keeps the forbidden objective keys for
      // validation. The writer does not emit Knowledge references, so neither
      // allowed nor forbidden opaque keys are useful in its transport payload.
    })),
    sceneDemands: view.sceneDemands.map(demand => {
      const objective = safeCurrentObjective(context, demand)
      return {
        sceneNumber: demand.sceneNumber,
        sceneKey: demand.sceneKey,
        sourceKind: demand.sourceKind,
        sourceKey: demand.sourceKey,
        regionKey: demand.regionKey,
        locationKey: demand.locationKey,
        ...(demand.questKey ? { questKey: demand.questKey } : {}),
        ...(demand.actorKey ? { actorKey: demand.actorKey } : {}),
        ...(demand.interactionKey ? { interactionKey: demand.interactionKey } : {}),
        ...(demand.randomEventKey ? { randomEventKey: demand.randomEventKey } : {}),
        participantKeys: [...demand.participantKeys],
        actionKeys: [...demand.actionKeys],
        choiceCount: demand.choiceCount,
        suggestedTitle: safeSceneTitle(context, demand),
        purpose: safeScenePurpose(demand),
        currentObjective: objective ? {
          objectiveKey: objective.key,
          title: objective.title,
          description: objective.description,
        } : null,
        actionTargets: safeSceneActionTargets(context, demand),
      }
    }),
    actionLanguageDemands: view.actionLanguageDemands.map(demand => ({ ...demand })),
    templateVariantDemands: view.templateVariantDemands.map(demand => ({
      ...demand,
      regionKeys: [...demand.regionKeys],
      sourceTemplateSeedKey: templateSourceByQuestKey.get(demand.questKey)
        ?? fail(`模板文字需求缺少P7模板引用:${demand.questKey}`),
    })),
    randomEventPresentationDemands: view.randomEventPresentationDemands.map(demand => {
      const event = context.directorDecks.randomEvents.find(candidate => candidate.key === demand.randomEventKey)
        ?? fail(`安全模型投影缺少事件:${demand.randomEventKey}`)
      return {
        eventNumber: demand.eventNumber,
        randomEventKey: demand.randomEventKey,
        title: event.title,
        kind: demand.kind,
        regionKey: demand.regionKey,
        locationKeys: [...demand.locationKeys],
        rumorRequirementKey: demand.rumorRequirementKey,
      }
    }),
    knowledgePresentationDemands: view.knowledgePresentationDemands.map(demand => ({ ...demand })),
    achievementPresentationDemands: view.achievementPresentationDemands.map(demand => ({ ...demand })),
  }
  return {
    ...body,
    contextSelectionHash: await hashProductProductionValueV2(body),
  }
}

export type TextOpenWorldSceneScriptsVerifiedModelBoundaryV1 =
  | { kind: 'legacy-single' }
  | TextOpenWorldSceneScriptsModelContextSliceV1

/** Dispatcher-facing proof for the P9 exception to the ordinary one-call
 * production protocol. A governed request is accepted only when its exact
 * bytes equal one deterministic per-Scene or shared projection rebuilt from
 * the frozen durable context. */
export async function verifyTextOpenWorldSceneScriptsModelRequestBoundaryV1(input: {
  durableContextText: string
  modelContextText: string
}): Promise<TextOpenWorldSceneScriptsVerifiedModelBoundaryV1> {
  const context = await parseContext(input.durableContextText)
  if (!governedKnowledge(context)) {
    if (input.modelContextText !== input.durableContextText) fail('历史P9模型请求必须保持完整冻结Context')
    return { kind: 'legacy-single' }
  }
  let request: Record<string, unknown>
  try {
    request = record(JSON.parse(input.modelContextText), 'P9模型请求')
  } catch {
    return fail('P9模型请求不是有效JSON')
  }
  const sceneRows = Array.isArray(request.sceneDemands) ? request.sceneDemands : fail('P9模型请求缺少sceneDemands')
  let slice: TextOpenWorldSceneScriptsModelContextSliceV1
  if (sceneRows.length === 0) {
    slice = { kind: 'shared-presentations' }
  } else if (sceneRows.length === 1) {
    const scene = record(sceneRows[0], 'P9模型请求.sceneDemands[0]')
    const sceneKey = typeof scene.sceneKey === 'string' ? scene.sceneKey : fail('P9场景模型请求缺少sceneKey')
    const indexes = context.sceneDemands.flatMap((demand, index) => demand.sceneKey === sceneKey ? [index] : [])
    if (indexes.length !== 1) fail(`P9场景模型请求没有唯一冻结Scene:${sceneKey}`)
    slice = { kind: 'scene', sceneIndex: indexes[0]! }
  } else {
    return fail('P9 governed-v3每次模型请求最多包含一个Scene')
  }
  const expected = canonicalProductProductionJsonV2(
    await createTextOpenWorldSceneScriptsModelContextV1(context, slice),
  )
  if (input.modelContextText !== expected) fail('P9模型请求不等于冻结Context导出的安全投影')
  return slice
}

function parseDraft(value: unknown, context: TextOpenWorldSceneScriptsInputContextV1): SceneScriptsDraftV1 {
  const root = record(value, 'draft')
  const legacyKeys = ['schema', 'version', 'scenes', 'actionUtterances', 'templateVariants', 'randomEvents'] as const
  if (!governedKnowledge(context)) {
    exactKeys(root, legacyKeys, 'draft')
  } else {
    const allowedKeys = new Set([...legacyKeys, 'knowledgePresentations', 'achievementPresentations'])
    const actualKeys = Object.keys(root)
    if (legacyKeys.some(key => !actualKeys.includes(key)) || actualKeys.some(key => !allowedKeys.has(key))) {
      fail(`draft字段不精确:${actualKeys.sort().join(',')}`)
    }
    const hasKnowledge = root.knowledgePresentations !== undefined
    const hasAchievements = root.achievementPresentations !== undefined
    if (hasKnowledge !== hasAchievements) fail('governed-v3 draft必须同时提供或同时省略Knowledge与成就表现')
  }
  if (root.schema !== 'storyforge.text-open-world-scene-scripts-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.scenes) || root.scenes.length !== context.sceneDemands.length) fail(`scenes必须与${context.sceneDemands.length}项需求一一对应`)
  const scenes = root.scenes.map((value, index) => {
    const row = record(value, `scenes[${index}]`)
    exactKeys(row, ['sceneNumber', 'title', 'openingText', 'bodyText', 'successText', 'failureText', 'choiceLabels', 'attitudeOpenings'], `scenes[${index}]`)
    const demand = context.sceneDemands[index]!
    let attitudeOpenings: SceneDraftV1['attitudeOpenings'] = null
    if (row.attitudeOpenings !== null) {
      const attitude = record(row.attitudeOpenings, `scenes[${index}].attitudeOpenings`)
      exactKeys(attitude, ['bad', 'neutral', 'good'], `scenes[${index}].attitudeOpenings`)
      attitudeOpenings = {
        bad: text(attitude.bad, `scenes[${index}].attitudeOpenings.bad`, 500),
        neutral: text(attitude.neutral, `scenes[${index}].attitudeOpenings.neutral`, 500),
        good: text(attitude.good, `scenes[${index}].attitudeOpenings.good`, 500),
      }
    }
    if ((demand.sourceKind === 'actor-dialogue') !== (attitudeOpenings !== null)) fail(`scenes[${index}]只有角色对话场景可拥有三档态度开场`)
    return {
      sceneNumber: integer(row.sceneNumber, `scenes[${index}].sceneNumber`, 1, context.sceneDemands.length),
      title: text(row.title, `scenes[${index}].title`, 160),
      openingText: text(row.openingText, `scenes[${index}].openingText`),
      bodyText: text(row.bodyText, `scenes[${index}].bodyText`, 4_000),
      successText: text(row.successText, `scenes[${index}].successText`),
      failureText: nullableText(row.failureText, `scenes[${index}].failureText`),
      choiceLabels: exactStringArray(row.choiceLabels, `scenes[${index}].choiceLabels`, demand.choiceCount, 100),
      attitudeOpenings,
    }
  })
  if (scenes.some((scene, index) => scene.sceneNumber !== index + 1)) fail('scenes必须按需求顺序精确覆盖')
  if (!Array.isArray(root.actionUtterances) || root.actionUtterances.length !== context.actionLanguageDemands.length) fail(`actionUtterances必须与${context.actionLanguageDemands.length}项可映射Action一一对应`)
  const actionUtterances = root.actionUtterances.map((value, index) => {
    const row = record(value, `actionUtterances[${index}]`)
    exactKeys(row, ['actionNumber', 'examples'], `actionUtterances[${index}]`)
    return {
      actionNumber: integer(row.actionNumber, `actionUtterances[${index}].actionNumber`, 1, context.actionLanguageDemands.length),
      examples: exactStringArray(row.examples, `actionUtterances[${index}].examples`, 2, 120),
    }
  })
  if (actionUtterances.some((item, index) => item.actionNumber !== index + 1)) fail('actionUtterances必须按可映射Action顺序覆盖')
  const normalizedExamples = actionUtterances.flatMap(item => item.examples.map(example => example.toLocaleLowerCase('zh-CN')))
  if (new Set(normalizedExamples).size !== normalizedExamples.length) fail('自然语言示例不得跨Action重复，避免歧义映射')
  if (!Array.isArray(root.templateVariants) || root.templateVariants.length !== context.templateVariantDemands.length) fail(`templateVariants必须与${context.templateVariantDemands.length}项需求一一对应`)
  const templateVariants = root.templateVariants.map((value, index) => {
    const row = record(value, `templateVariants[${index}]`)
    exactKeys(row, ['variantNumber', 'title', 'description'], `templateVariants[${index}]`)
    return {
      variantNumber: integer(row.variantNumber, `templateVariants[${index}].variantNumber`, 1, context.templateVariantDemands.length),
      title: text(row.title, `templateVariants[${index}].title`, 160),
      description: text(row.description, `templateVariants[${index}].description`),
    }
  })
  if (templateVariants.some((variant, index) => variant.variantNumber !== index + 1)) fail('templateVariants必须按需求顺序覆盖')
  if (new Set(templateVariants.map(variant => variant.title.toLocaleLowerCase('zh-CN'))).size !== templateVariants.length) fail('模板文字变体标题不得重复')
  if (!Array.isArray(root.randomEvents) || root.randomEvents.length !== context.randomEventPresentationDemands.length) fail(`randomEvents必须与${context.randomEventPresentationDemands.length}项事件一一对应`)
  const randomEvents = root.randomEvents.map((value, index) => {
    const row = record(value, `randomEvents[${index}]`)
    exactKeys(row, ['eventNumber', 'openingText', 'resolutionText', 'rumorText'], `randomEvents[${index}]`)
    const demand = context.randomEventPresentationDemands[index]!
    const rumorText = nullableText(row.rumorText, `randomEvents[${index}].rumorText`)
    if (!governedKnowledge(context)
      && (demand.rumorRequirementKey !== null) !== (rumorText !== null)) fail(`randomEvents[${index}]谣言文本必须与线索需求一致`)
    return {
      eventNumber: integer(row.eventNumber, `randomEvents[${index}].eventNumber`, 1, context.randomEventPresentationDemands.length),
      openingText: text(row.openingText, `randomEvents[${index}].openingText`),
      resolutionText: text(row.resolutionText, `randomEvents[${index}].resolutionText`), rumorText,
    }
  })
  if (randomEvents.some((event, index) => event.eventNumber !== index + 1)) fail('randomEvents必须按事件顺序覆盖')
  const knowledgeDemands = context.knowledgePresentationDemands ?? []
  const knowledgePresentations = root.knowledgePresentations === undefined
    ? knowledgeDemands.map(demand => {
        const binding = knowledgeBindings(context).find(candidate => candidate.knowledgeKey === demand.knowledgeKey)
          ?? fail(`Knowledge表现需求缺少P8F绑定:${demand.knowledgeKey}`)
        return {
          knowledgeNumber: demand.knowledgeNumber,
          title: demand.publicSubjectLabel,
          summary: binding.truthSummary,
        }
      })
    : (() => {
        if (!Array.isArray(root.knowledgePresentations)
          || root.knowledgePresentations.length !== knowledgeDemands.length) {
          return fail(`knowledgePresentations必须与${knowledgeDemands.length}项需求一一对应`)
        }
        const rows = root.knowledgePresentations.map((value, index) => {
          const row = record(value, `knowledgePresentations[${index}]`)
          exactKeys(row, ['knowledgeNumber', 'title', 'summary'], `knowledgePresentations[${index}]`)
          return {
            knowledgeNumber: integer(row.knowledgeNumber, `knowledgePresentations[${index}].knowledgeNumber`, 1, knowledgeDemands.length),
            title: text(row.title, `knowledgePresentations[${index}].title`, 160),
            summary: text(row.summary, `knowledgePresentations[${index}].summary`),
          }
        })
        if (rows.some((row, index) => row.knowledgeNumber !== index + 1)) fail('knowledgePresentations必须按需求顺序覆盖')
        return rows
      })()
  const achievementDemands = context.achievementPresentationDemands ?? []
  const achievementPresentations = root.achievementPresentations === undefined
    ? achievementDemands.map(demand => ({
        achievementNumber: demand.achievementNumber,
        title: `完成：${demand.publicSourceLabel}`,
        description: demand.sourceKind === 'quest-reward-claim'
          ? `完成“${demand.publicSourceLabel}”并领取成果。`
          : `沿着自己的选择抵达“${demand.publicSourceLabel}”。`,
      }))
    : (() => {
        if (!Array.isArray(root.achievementPresentations)
          || root.achievementPresentations.length !== achievementDemands.length) {
          return fail(`achievementPresentations必须与${achievementDemands.length}项需求一一对应`)
        }
        const rows = root.achievementPresentations.map((value, index) => {
          const row = record(value, `achievementPresentations[${index}]`)
          exactKeys(row, ['achievementNumber', 'title', 'description'], `achievementPresentations[${index}]`)
          return {
            achievementNumber: integer(row.achievementNumber, `achievementPresentations[${index}].achievementNumber`, 1, achievementDemands.length),
            title: text(row.title, `achievementPresentations[${index}].title`, 160),
            description: text(row.description, `achievementPresentations[${index}].description`),
          }
        })
        if (rows.some((row, index) => row.achievementNumber !== index + 1)) fail('achievementPresentations必须按需求顺序覆盖')
        return rows
      })()
  return { scenes, actionUtterances, templateVariants, randomEvents, knowledgePresentations, achievementPresentations }
}

function fixedTarget(input: {
  context: TextOpenWorldSceneScriptsInputContextV1
  demand: TextOpenWorldSceneDemandV1
  action: TextOpenWorldSceneActionSourceV1
}): { targetPolicy: TextOpenWorldChoiceContractsV1['choices'][number]['targetPolicy']; targetKey: string | null } {
  const { context, demand, action } = input
  if (action.targetScope === 'none') return { targetPolicy: 'none', targetKey: null }
  if (action.targetScope === 'quest' && demand.questKey) return { targetPolicy: 'fixed', targetKey: demand.questKey }
  if (action.targetScope === 'actor' && demand.participantKeys.length === 1) return { targetPolicy: 'fixed', targetKey: demand.participantKeys[0]! }
  if (action.targetScope === 'location' && action.locationKeys.includes(demand.locationKey)) {
    return { targetPolicy: 'fixed', targetKey: demand.locationKey }
  }
  if (action.targetScope === 'encounter') {
    const binding = context.questDesignDocuments.catalogBindings.encounters.find(item => item.startActionKey === action.key)
    if (binding) return { targetPolicy: 'fixed', targetKey: binding.encounterKey }
  }
  if (action.targetScope === 'item') {
    const binding = context.questDesignDocuments.catalogBindings.items.find(item => (
      item.useActionKey === action.key || item.equipActionKey === action.key || item.unequipActionKey === action.key
    ))
    if (binding) return { targetPolicy: 'fixed', targetKey: binding.itemKey }
  }
  if (action.targetScope === 'recipe') {
    const binding = context.questDesignDocuments.catalogBindings.recipes.find(item => item.craftActionKey === action.key || item.learnActionKey === action.key)
    if (binding) return { targetPolicy: 'fixed', targetKey: binding.recipeKey }
  }
  if (action.targetScope === 'vendor') {
    const binding = context.questDesignDocuments.catalogBindings.vendors.find(item => item.buyActionKey === action.key || item.sellActionKey === action.key)
    if (binding) return { targetPolicy: 'fixed', targetKey: binding.vendorKey }
  }
  return { targetPolicy: 'runtime-valid-target', targetKey: null }
}

async function createArtifacts(input: {
  context: TextOpenWorldSceneScriptsInputContextV1
  draft: SceneScriptsDraftV1
  createdAt: number
}): Promise<TextOpenWorldSceneScriptsArtifactsV1> {
  const freshKnowledge = governedKnowledge(input.context)
  const actionHashes = new Map<string, string>()
  input.context.questDesignDocuments.actions.forEach(action => actionHashes.set(action.key, action.actionDefinitionHash))
  const choiceRows: TextOpenWorldChoiceContractsV1['choices'] = []
  const sceneRows: TextOpenWorldSceneScriptsV1['scenes'] = input.context.sceneDemands.map((demand, index) => {
    const draft = input.draft.scenes[index]!
    const knowledgeBoundary = input.context.knowledgeBoundaries.find(item => item.key === demand.knowledgeBoundaryKey)
      ?? fail(`Scene引用未知知识边界:${demand.sceneKey}`)
    const fixedChoiceKeys = demand.actionKeys.map((actionKey, actionIndex) => {
      const endingRoute = input.context.questDesignDocuments.endingBindings.routes.find(route => route.actionKey === actionKey)
      return endingRoute ? `choice.ending.${endingRoute.endingKey}`
        : `choice.${demand.sceneKey}.${String(actionIndex + 1).padStart(2, '0')}`
    })
    demand.actionKeys.forEach((actionKey, actionIndex) => {
      const action = actionByKey(input.context, actionKey)
      const target = fixedTarget({ context: input.context, demand, action })
      choiceRows.push({
        key: fixedChoiceKeys[actionIndex]!, sceneKey: demand.sceneKey, order: actionIndex + 1,
        label: draft.choiceLabels[actionIndex]!, description: action.description, actionKey,
        actionDefinitionHash: actionHashes.get(actionKey)!, ...target,
        availabilityConditionKeys: [...action.requirementConditionKeys], confirmationPolicy: action.confirmationPolicy,
        executionSource: 'fixed-choice', resultAuthority: 'text-open-world.quest-design-documents.actions',
      })
    })
    return {
      key: demand.sceneKey, order: demand.sceneNumber, sourceKind: demand.sourceKind, sourceKey: demand.sourceKey,
      title: draft.title, purpose: demand.purpose, regionKey: demand.regionKey, locationKey: demand.locationKey,
      questKey: demand.questKey, stageKey: demand.stageKey, objectiveKey: demand.objectiveKey, actorKey: demand.actorKey,
      interactionKey: demand.interactionKey, randomEventKey: demand.randomEventKey,
      participantKeys: [...demand.participantKeys], openingText: draft.openingText, bodyText: draft.bodyText,
      successText: draft.successText, failureText: draft.failureText, attitudeOpenings: draft.attitudeOpenings,
      allowedKnowledgeClaimKeys: [...knowledgeBoundary.allowedKnowledgeClaimKeys],
      forbiddenFutureObjectiveKeys: [...knowledgeBoundary.forbiddenFutureObjectiveKeys],
      availabilityConditionKeys: [...new Set(demand.availabilityConditionKeys)], actionKeys: [...demand.actionKeys], fixedChoiceKeys,
    }
  })
  const templateTextVariants = input.context.templateVariantDemands.map((demand, index) => ({
    key: `variant.${demand.requirementKey}`, order: demand.variantNumber, requirementKey: demand.requirementKey,
    templateKey: demand.templateKey, title: input.draft.templateVariants[index]!.title,
    description: input.draft.templateVariants[index]!.description,
  }))
  const randomEventPresentations: TextOpenWorldSceneScriptsV1['randomEventPresentations'] = input.context.randomEventPresentationDemands.map((demand, index) => {
    if (!freshKnowledge) {
      return {
        key: `presentation.${demand.randomEventKey}`, order: demand.eventNumber, randomEventKey: demand.randomEventKey,
        openingText: input.draft.randomEvents[index]!.openingText, resolutionText: input.draft.randomEvents[index]!.resolutionText,
        rumorKey: demand.rumorRequirementKey ? `rumor.${demand.randomEventKey}` : null,
        rumorRequirementKey: demand.rumorRequirementKey, rumorText: input.draft.randomEvents[index]!.rumorText,
        reliability: demand.rumorRequirementKey ? 'uncertain' : null, sourceClaimKeys: [...demand.sourceClaimKeys],
      }
    }
    const event = input.context.directorDecks.randomEvents.find(candidate => candidate.key === demand.randomEventKey)
      ?? fail(`事件表现引用未知Director事件:${demand.randomEventKey}`)
    const binding = event.rumorKey
      ? knowledgeBindings(input.context).find(candidate => (
          candidate.propagationEventKey === event.key && candidate.rumorKey === event.rumorKey
        )) ?? fail(`Director传闻事件缺少唯一P8F事实绑定:${event.key}`)
      : null
    return {
      key: `presentation.${demand.randomEventKey}`, order: demand.eventNumber, randomEventKey: demand.randomEventKey,
      openingText: input.draft.randomEvents[index]!.openingText, resolutionText: input.draft.randomEvents[index]!.resolutionText,
      rumorKey: event.rumorKey ?? null,
      rumorRequirementKey: event.rumorRequirementKey,
      rumorText: binding?.rumorText ?? null,
      reliability: binding?.reliability ?? null,
      sourceClaimKeys: [...(binding?.sourceClaimKeys ?? [])],
    }
  })
  const knowledgePresentations: NonNullable<TextOpenWorldSceneScriptsV1['knowledgePresentations']> = freshKnowledge
    ? knowledgeBindings(input.context).map((binding, index) => ({
        key: `presentation.${binding.knowledgeKey}`,
        order: binding.order,
        knowledgeKey: binding.knowledgeKey,
        title: input.draft.knowledgePresentations[index]!.title,
        // The model never receives hidden truthSummary. P8F remains the sole
        // fact owner; P9 may author a title but cannot rewrite the fact.
        summary: binding.truthSummary,
      }))
    : []
  const achievementPresentations: NonNullable<TextOpenWorldSceneScriptsV1['achievementPresentations']> = freshKnowledge
    ? achievementBindings(input.context).map((binding, index) => ({
        key: `presentation.${binding.achievementKey}`,
        order: binding.order,
        achievementKey: binding.achievementKey,
        title: input.draft.achievementPresentations[index]!.title,
        description: input.draft.achievementPresentations[index]!.description,
      }))
    : []
  const sceneBody: Omit<TextOpenWorldSceneScriptsV1, 'sceneScriptsHash'> = {
    schema: 'storyforge.text-open-world-scene-scripts', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey, sourceLedgerHash: input.context.sourceLedger.ledgerHash,
    experienceContractHash: input.context.experienceContract.experienceContractHash, storyArcHash: input.context.storyArc.storyArcHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    npcRuntimeCatalogHash: input.context.npcRuntimeCatalog.npcRuntimeCatalogHash,
    mapInteractionCatalogHash: input.context.mapInteractionCatalog.mapInteractionCatalogHash,
    questDesignDocumentsHash: input.context.questDesignDocuments.questDesignDocumentsHash,
    directorDecksHash: input.context.directorDecks.directorDecksHash,
    scenes: sceneRows, templateTextVariants, randomEventPresentations,
    ...(freshKnowledge ? { knowledgePresentations, achievementPresentations } : {}),
    coverage: {
      requiredQuestKeys: input.context.questDesignDocuments.quests.map(quest => quest.key),
      questOfferSceneKeys: sceneRows.filter(scene => scene.sourceKind === 'quest-offer').map(scene => scene.key),
      questResolutionSceneKeys: sceneRows.filter(scene => scene.sourceKind === 'quest-resolution').map(scene => scene.key),
      requiredObjectiveKeys: input.context.questDesignDocuments.objectives.map(objective => objective.key),
      objectiveSceneKeys: sceneRows.filter(scene => scene.sourceKind === 'quest-objective').map(scene => scene.key),
      requiredActorKeys: input.context.npcRuntimeCatalog.actors.map(actor => actor.key),
      actorSceneKeys: sceneRows.filter(scene => scene.sourceKind === 'actor-dialogue').map(scene => scene.key),
      requiredInteractionKeys: input.context.mapInteractionCatalog.interactions.map(interaction => interaction.key),
      interactionSceneKeys: sceneRows.filter(scene => scene.sourceKind === 'location-interaction').map(scene => scene.key),
      requiredRandomEventKeys: input.context.directorDecks.randomEvents.map(event => event.key),
      randomEventSceneKeys: sceneRows.filter(scene => scene.sourceKind === 'random-event').map(scene => scene.key),
      requiredTemplateVariantRequirementKeys: input.context.templateVariantDemands.map(demand => demand.requirementKey),
      fulfilledTemplateVariantRequirementKeys: templateTextVariants.map(variant => variant.requirementKey), uncoveredSceneSourceKeys: [],
      ...(freshKnowledge ? {
        requiredKnowledgeKeys: knowledgeBindings(input.context).map(binding => binding.knowledgeKey),
        presentedKnowledgeKeys: knowledgePresentations.map(presentation => presentation.knowledgeKey),
        requiredAchievementKeys: achievementBindings(input.context).map(binding => binding.achievementKey),
        presentedAchievementKeys: achievementPresentations.map(presentation => presentation.achievementKey),
      } : {}),
    },
    governance: {
      proseOwner: 'model-validated', referenceOwner: 'deterministic-compiler', currentAndPriorKnowledgeOnly: true,
      futureObjectiveSpoilersForbidden: true, everyObjectiveHasScene: true, everyActorHasDialogueEntry: true,
      everyLocationInteractionHasScene: true, everyDirectorEventHasPresentation: true,
      allTemplateVariantsFulfilled: true, actionResultsReferencedNotDuplicated: true,
      ...(freshKnowledge ? {
        disclosureSafeModelContextV3: true as const,
        knowledgePresentationsComplete: true as const,
        achievementPresentationsComplete: true as const,
        rumorFactsCopiedFromQuestDesign: true as const,
        sceneKnowledgeRefsAreRuntimeKnowledgeKeys: true as const,
      } : {}),
    },
    basisHash: await hashProductProductionValueV2({
      contextSelectionHash: input.context.contextSelectionHash, sceneKeys: sceneRows.map(scene => scene.key),
      actionHashes: [...actionHashes.entries()], templateRequirements: input.context.templateVariantDemands.map(demand => demand.requirementKey),
      ...(freshKnowledge ? {
        knowledgePresentationKeys: knowledgePresentations.map(presentation => presentation.key),
        achievementPresentationKeys: achievementPresentations.map(presentation => presentation.key),
        rumorFactBindings: randomEventPresentations.filter(presentation => presentation.rumorKey).map(presentation => ({
          randomEventKey: presentation.randomEventKey,
          rumorKey: presentation.rumorKey,
        })),
      } : {}),
    }), createdAt: input.createdAt,
  }
  const sceneScripts: TextOpenWorldSceneScriptsV1 = { ...sceneBody, sceneScriptsHash: await hashProductProductionValueV2(sceneBody) }
  const requiredSceneActionPairs = sceneRows.flatMap(scene => scene.actionKeys.map(actionKey => ({ sceneKey: scene.key, actionKey })))
  const choiceBody: Omit<TextOpenWorldChoiceContractsV1, 'choiceContractsHash'> = {
    schema: 'storyforge.text-open-world-choice-contracts', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey, questDesignDocumentsHash: input.context.questDesignDocuments.questDesignDocumentsHash,
    sceneScriptsHash: sceneScripts.sceneScriptsHash, choices: choiceRows,
    coverage: {
      requiredSceneActionPairs, coveredSceneActionPairs: choiceRows.map(choice => ({ sceneKey: choice.sceneKey, actionKey: choice.actionKey })),
      scenesWithActions: sceneRows.filter(scene => scene.actionKeys.length).map(scene => scene.key),
      scenesWithChoices: sceneRows.filter(scene => scene.fixedChoiceKeys.length).map(scene => scene.key),
      duplicateChoiceKeys: [], uncoveredSceneActionPairs: [],
    },
    governance: {
      exactActionReferenceOnly: true, effectsNeverDuplicated: true, availabilityInheritedFromAction: true,
      confirmationInheritedFromAction: true, runtimeTargetValidationRequired: true,
    },
    basisHash: await hashProductProductionValueV2({ sceneScriptsHash: sceneScripts.sceneScriptsHash, requiredSceneActionPairs }),
    createdAt: input.createdAt,
  }
  const choiceContracts: TextOpenWorldChoiceContractsV1 = { ...choiceBody, choiceContractsHash: await hashProductProductionValueV2(choiceBody) }
  const utterances = new Map(input.context.actionLanguageDemands.map((demand, index) => [demand.actionKey, input.draft.actionUtterances[index]!.examples]))
  const actionRows: TextOpenWorldActionBindingsV1['actions'] = input.context.questDesignDocuments.actions.map((action, index) => {
    const naturalMode = action.actorScope === 'system' ? 'disabled-system-only' as const
      : COMBAT_CATEGORIES.has(action.category) ? 'disabled-combat-button-only' as const : 'existing-action-candidate' as const
    const actionDefinitionHash = actionHashes.get(action.key)!
    return {
      key: `binding.${action.key}`, order: index + 1, actionKey: action.key, actionDefinitionHash,
      actorScope: action.actorScope, category: action.category, targetScope: action.targetScope,
      systemAction: { enabled: action.actorScope === 'player', label: action.label, description: action.description, executionSource: 'system-action' },
      fixedChoiceKeys: choiceRows.filter(choice => choice.actionKey === action.key).map(choice => choice.key),
      naturalLanguage: {
        mode: naturalMode, exampleUtterances: naturalMode === 'existing-action-candidate' ? [...(utterances.get(action.key) ?? [])] : [],
        candidateMayOnlySelectThisAction: true, targetResolution: 'current-projection-valid-targets-only',
        highConfidenceLowRisk: 'execute-after-runtime-validation', highRiskOrIrreversible: 'require-explicit-confirmation',
        lowConfidence: 'respond-and-recommend-formal-actions', mayCreateAction: false, mayCreateQuest: false,
        mayCreateMapContent: false, mayWriteState: false,
      },
      resultAuthority: {
        artifactKey: 'text-open-world.quest-design-documents', collection: 'actions', actionKey: action.key, actionDefinitionHash,
      },
    }
  })
  const playerActions = input.context.questDesignDocuments.actions.filter(action => action.actorScope === 'player')
  const naturalEligible = input.context.actionLanguageDemands.map(demand => demand.actionKey)
  const actionBody: Omit<TextOpenWorldActionBindingsV1, 'actionBindingsHash'> = {
    schema: 'storyforge.text-open-world-action-bindings', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey, experienceContractHash: input.context.experienceContract.experienceContractHash,
    questDesignDocumentsHash: input.context.questDesignDocuments.questDesignDocumentsHash,
    sceneScriptsHash: sceneScripts.sceneScriptsHash, choiceContractsHash: choiceContracts.choiceContractsHash, actions: actionRows,
    unmatchedNaturalLanguage: {
      policy: 'natural-response-then-formal-action-redirect', impossibleActionPolicy: 'explicit-decline-with-in-world-alternative',
      customSolutionPolicy: 'future-extension-disabled', stateMutationAllowed: false,
    },
    thresholds: { directExecutionMinimumConfidence: 0.9, recommendationMinimumConfidence: 0.55 },
    coverage: {
      requiredActionKeys: input.context.questDesignDocuments.actions.map(action => action.key), boundActionKeys: actionRows.map(binding => binding.actionKey),
      playerActionKeys: playerActions.map(action => action.key),
      systemActionUiKeys: actionRows.filter(binding => binding.systemAction.enabled).map(binding => binding.key),
      naturalLanguageEligibleActionKeys: naturalEligible,
      naturalLanguageBoundActionKeys: actionRows.filter(binding => binding.naturalLanguage.mode === 'existing-action-candidate').map(binding => binding.actionKey),
      combatButtonOnlyActionKeys: playerActions.filter(action => COMBAT_CATEGORIES.has(action.category)).map(action => action.key),
      fixedChoiceActionKeys: [...new Set(choiceRows.map(choice => choice.actionKey))], duplicateNaturalLanguageExamples: [], unboundActionKeys: [],
    },
    governance: {
      singleResultSource: true, allThreeInputsUseActionRegistry: true, modelCannotCreateActionOrResult: true,
      combatFreeTextDisabled: true, lowConfidenceNeverExecutes: true, irreversibleActionsRequireConfirmation: true,
      runtimeProjectionValidationRequired: true,
    },
    basisHash: await hashProductProductionValueV2({
      experienceContractHash: input.context.experienceContract.experienceContractHash,
      questDesignDocumentsHash: input.context.questDesignDocuments.questDesignDocumentsHash,
      sceneScriptsHash: sceneScripts.sceneScriptsHash, choiceContractsHash: choiceContracts.choiceContractsHash,
      actionHashes: [...actionHashes.entries()],
    }), createdAt: input.createdAt,
  }
  const actionBindings: TextOpenWorldActionBindingsV1 = { ...actionBody, actionBindingsHash: await hashProductProductionValueV2(actionBody) }
  await assertCrossArtifacts({ sceneScripts, choiceContracts, actionBindings }, input.context)
  return { sceneScripts, choiceContracts, actionBindings }
}

async function assertCrossArtifacts(
  artifacts: TextOpenWorldSceneScriptsArtifactsV1,
  context: TextOpenWorldSceneScriptsInputContextV1,
): Promise<void> {
  const { sceneScripts, choiceContracts, actionBindings } = artifacts
  if (choiceContracts.sceneScriptsHash !== sceneScripts.sceneScriptsHash
    || actionBindings.sceneScriptsHash !== sceneScripts.sceneScriptsHash
    || actionBindings.choiceContractsHash !== choiceContracts.choiceContractsHash
    || [sceneScripts.questDesignDocumentsHash, choiceContracts.questDesignDocumentsHash, actionBindings.questDesignDocumentsHash]
      .some(hash => hash !== context.questDesignDocuments.questDesignDocumentsHash)) fail('P9跨Artifact Hash引用未闭合')
  const sceneKeys = new Set(sceneScripts.scenes.map(scene => scene.key))
  const choiceKeys = new Set(choiceContracts.choices.map(choice => choice.key))
  const actions = new Map(context.questDesignDocuments.actions.map(action => [action.key, action]))
  if (sceneKeys.size !== sceneScripts.scenes.length || choiceKeys.size !== choiceContracts.choices.length
    || new Set(actionBindings.actions.map(binding => binding.actionKey)).size !== context.questDesignDocuments.actions.length) fail('P9稳定键或Action覆盖重复')
  for (const scene of sceneScripts.scenes) {
    if (!context.mapInteractionCatalog.locations.some(location => location.key === scene.locationKey)) fail(`Scene引用未知地点:${scene.key}`)
    if (!scene.fixedChoiceKeys.every(key => choiceKeys.has(key))) fail(`Scene引用未知Choice:${scene.key}`)
    if (!scene.actionKeys.every(key => actions.get(key)?.actorScope === 'player')) fail(`Scene只能引用玩家Action:${scene.key}`)
    if (!same(scene.fixedChoiceKeys, choiceContracts.choices.filter(choice => choice.sceneKey === scene.key).map(choice => choice.key))) fail(`Scene/Choice反向绑定不一致:${scene.key}`)
    if (scene.sourceKind === 'actor-dialogue' && !scene.attitudeOpenings) fail(`角色场景缺少三档态度:${scene.key}`)
  }
  if (context.questDesignDocuments.governance.restartActionsRequireOriginalOfferRoute === true) {
    for (const action of context.questDesignDocuments.actions.filter(item => item.category === 'restart-quest')) {
      const questKey = action.key.startsWith('action.restart.')
        ? action.key.slice('action.restart.'.length)
        : fail(`重接Action稳定键无法反向定位任务:${action.key}`)
      const offerScene = sceneScripts.scenes.find(scene => scene.sourceKind === 'quest-offer' && scene.questKey === questKey)
        ?? fail(`可重接任务没有原发布场景:${questKey}`)
      if (!offerScene.actionKeys.includes(action.key) || !same(action.locationKeys, [offerScene.locationKey])) {
        fail(`重接Action没有精确绑定原发布场景与地点:${questKey}`)
      }
    }
  }
  const endingScene = sceneScripts.scenes.find(scene => (
    scene.sourceKind === 'quest-resolution'
      && scene.questKey === context.questDesignDocuments.endingBindings.finalMainlineQuestKey
  )) ?? fail('P9没有最终主线结局场景')
  const endingActionKeys = context.questDesignDocuments.endingBindings.routes.map(route => route.actionKey)
  if (!same(endingActionKeys, endingScene.actionKeys.filter(actionKey => endingActionKeys.includes(actionKey)))
    || endingActionKeys.some(actionKey => choiceContracts.choices.filter(choice => (
      choice.sceneKey === endingScene.key && choice.actionKey === actionKey
    )).length !== 1)) fail('P9没有把全部P8F结局Action作为最终场景唯一Choice')
  for (const choice of choiceContracts.choices) {
    const action = actions.get(choice.actionKey) ?? fail(`Choice引用未知Action:${choice.key}`)
    if (!sceneKeys.has(choice.sceneKey) || choice.actionDefinitionHash !== action.actionDefinitionHash
      || !same(choice.availabilityConditionKeys, action.requirementConditionKeys)
      || choice.confirmationPolicy !== action.confirmationPolicy) fail(`Choice没有精确继承Action:${choice.key}`)
  }
  for (const binding of actionBindings.actions) {
    const action = actions.get(binding.actionKey) ?? fail(`ActionBinding引用未知Action:${binding.key}`)
    const expectedHash = action.actionDefinitionHash
    if (binding.actionDefinitionHash !== expectedHash || binding.resultAuthority.actionDefinitionHash !== expectedHash
      || binding.resultAuthority.actionKey !== action.key || binding.category !== action.category
      || binding.actorScope !== action.actorScope || binding.targetScope !== action.targetScope
      || !same(binding.fixedChoiceKeys, choiceContracts.choices.filter(choice => choice.actionKey === action.key).map(choice => choice.key))) {
      fail(`ActionBinding结果权威或反向Choice不一致:${binding.key}`)
    }
    if (COMBAT_CATEGORIES.has(action.category) && action.actorScope === 'player'
      && (binding.naturalLanguage.mode !== 'disabled-combat-button-only' || binding.naturalLanguage.exampleUtterances.length)) fail(`战斗Action不得开放自由语言:${action.key}`)
    if (binding.naturalLanguage.mode === 'existing-action-candidate' && binding.naturalLanguage.exampleUtterances.length !== 2) fail(`可映射Action必须有两条唯一示例:${action.key}`)
  }
  const examples = actionBindings.actions.flatMap(binding => binding.naturalLanguage.exampleUtterances.map(example => example.toLocaleLowerCase('zh-CN')))
  if (new Set(examples).size !== examples.length) fail('自然语言映射示例存在歧义重复')
  if (governedKnowledge(context)) {
    const knowledge = knowledgeBindings(context)
    const achievements = achievementBindings(context)
    const knowledgePresentations = sceneScripts.knowledgePresentations
      ?? fail('governed-v3 SceneScripts缺少Knowledge表现')
    const achievementPresentations = sceneScripts.achievementPresentations
      ?? fail('governed-v3 SceneScripts缺少成就表现')
    if (knowledgePresentations.length !== knowledge.length
      || knowledgePresentations.some((presentation, index) => {
        const binding = knowledge[index]!
        return presentation.key !== `presentation.${binding.knowledgeKey}`
          || presentation.order !== binding.order
          || presentation.knowledgeKey !== binding.knowledgeKey
          || presentation.summary !== binding.truthSummary
      })) fail('Knowledge表现没有按P8F稳定键、顺序与事实一对一覆盖')
    if (achievementPresentations.length !== achievements.length
      || achievementPresentations.some((presentation, index) => {
        const binding = achievements[index]!
        return presentation.key !== `presentation.${binding.achievementKey}`
          || presentation.order !== binding.order
          || presentation.achievementKey !== binding.achievementKey
      })) fail('成就表现没有按P8F稳定键与顺序一对一覆盖')
    const runtimeKnowledgeKeys = new Set(knowledge.map(binding => binding.knowledgeKey))
    if (sceneScripts.scenes.some(scene => (
      scene.allowedKnowledgeClaimKeys.some(key => !runtimeKnowledgeKeys.has(key))
    ))) fail('governed-v3 Scene仍引用SourceLedger Claim而非运行时Knowledge')
    for (const presentation of sceneScripts.randomEventPresentations) {
      const event = context.directorDecks.randomEvents.find(candidate => candidate.key === presentation.randomEventKey)
        ?? fail(`事件表现引用未知Director事件:${presentation.randomEventKey}`)
      if (presentation.rumorKey !== (event.rumorKey ?? null)
        || presentation.rumorRequirementKey !== event.rumorRequirementKey) {
        fail(`事件表现没有精确复制Director传闻引用:${presentation.randomEventKey}`)
      }
      const binding = event.rumorKey
        ? knowledge.find(candidate => candidate.propagationEventKey === event.key && candidate.rumorKey === event.rumorKey)
          ?? fail(`Director传闻没有P8F事实:${event.key}`)
        : null
      if (presentation.rumorText !== (binding?.rumorText ?? null)
        || presentation.reliability !== (binding?.reliability ?? null)
        || canonicalProductProductionJsonV2(presentation.sourceClaimKeys)
          !== canonicalProductProductionJsonV2(binding?.sourceClaimKeys ?? [])) {
        fail(`事件表现传闻事实没有从P8F逐字段复制:${presentation.randomEventKey}`)
      }
    }
    if (!same(sceneScripts.randomEventPresentations.flatMap(presentation => presentation.rumorKey ? [presentation.rumorKey] : []),
      knowledge.map(binding => binding.rumorKey))) fail('P9没有一对一覆盖全部P8F传闻')
    if (!same(sceneScripts.coverage.requiredKnowledgeKeys ?? [], knowledge.map(binding => binding.knowledgeKey))
      || !same(sceneScripts.coverage.presentedKnowledgeKeys ?? [], knowledgePresentations.map(presentation => presentation.knowledgeKey))
      || !same(sceneScripts.coverage.requiredAchievementKeys ?? [], achievements.map(binding => binding.achievementKey))
      || !same(sceneScripts.coverage.presentedAchievementKeys ?? [], achievementPresentations.map(presentation => presentation.achievementKey))
      || sceneScripts.governance.disclosureSafeModelContextV3 !== true
      || sceneScripts.governance.knowledgePresentationsComplete !== true
      || sceneScripts.governance.achievementPresentationsComplete !== true
      || sceneScripts.governance.rumorFactsCopiedFromQuestDesign !== true
      || sceneScripts.governance.sceneKnowledgeRefsAreRuntimeKnowledgeKeys !== true) {
      fail('governed-v3 Knowledge、传闻与成就覆盖治理未闭合')
    }
  } else if (sceneScripts.knowledgePresentations !== undefined
    || sceneScripts.achievementPresentations !== undefined
    || sceneScripts.coverage.requiredKnowledgeKeys !== undefined
    || sceneScripts.coverage.requiredAchievementKeys !== undefined
    || sceneScripts.governance.disclosureSafeModelContextV3 !== undefined) {
    fail('历史P9 Artifact不得伪装governed-v3表现合同')
  }
  if (!same(sceneScripts.coverage.requiredTemplateVariantRequirementKeys, sceneScripts.coverage.fulfilledTemplateVariantRequirementKeys)
    || !same(sceneScripts.coverage.requiredRandomEventKeys, sceneScripts.randomEventPresentations.map(event => event.randomEventKey))
    || !same(actionBindings.coverage.requiredActionKeys, actionBindings.coverage.boundActionKeys)
    || !same(actionBindings.coverage.naturalLanguageEligibleActionKeys, actionBindings.coverage.naturalLanguageBoundActionKeys)) fail('P9 Scene/Template/Event/Action覆盖未闭合')
}

function draftFromArtifacts(artifacts: TextOpenWorldSceneScriptsArtifactsV1): unknown {
  const choiceByKey = new Map(artifacts.choiceContracts.choices.map(choice => [choice.key, choice]))
  const utterances = artifacts.actionBindings.actions.filter(binding => binding.naturalLanguage.mode === 'existing-action-candidate')
  const governedPresentations = artifacts.sceneScripts.governance.disclosureSafeModelContextV3 === true
  return {
    schema: 'storyforge.text-open-world-scene-scripts-draft', version: 1,
    scenes: artifacts.sceneScripts.scenes.map(scene => ({
      sceneNumber: scene.order, title: scene.title, openingText: scene.openingText, bodyText: scene.bodyText,
      successText: scene.successText, failureText: scene.failureText,
      choiceLabels: scene.fixedChoiceKeys.map(key => choiceByKey.get(key)?.label ?? fail(`Scene引用不存在的Choice:${key}`)),
      attitudeOpenings: scene.attitudeOpenings,
    })),
    actionUtterances: utterances.map((binding, index) => ({ actionNumber: index + 1, examples: binding.naturalLanguage.exampleUtterances })),
    templateVariants: artifacts.sceneScripts.templateTextVariants.map(variant => ({
      variantNumber: variant.order, title: variant.title, description: variant.description,
    })),
    randomEvents: artifacts.sceneScripts.randomEventPresentations.map(event => ({
      eventNumber: event.order, openingText: event.openingText, resolutionText: event.resolutionText, rumorText: event.rumorText,
    })),
    ...(governedPresentations ? {
      knowledgePresentations: (artifacts.sceneScripts.knowledgePresentations ?? []).map(presentation => ({
        knowledgeNumber: presentation.order,
        title: presentation.title,
        summary: presentation.summary,
      })),
      achievementPresentations: (artifacts.sceneScripts.achievementPresentations ?? []).map(presentation => ({
        achievementNumber: presentation.order,
        title: presentation.title,
        description: presentation.description,
      })),
    } : {}),
  }
}

export async function validateTextOpenWorldSceneScriptsArtifactsV1(input: {
  artifacts: TextOpenWorldSceneScriptsArtifactsV1
  context: TextOpenWorldSceneScriptsInputContextV1 | string
}): Promise<TextOpenWorldSceneScriptsArtifactsV1> {
  if (input.artifacts.sceneScripts.schema !== 'storyforge.text-open-world-scene-scripts'
    || input.artifacts.choiceContracts.schema !== 'storyforge.text-open-world-choice-contracts'
    || input.artifacts.actionBindings.schema !== 'storyforge.text-open-world-action-bindings'
    || !isSha256Hash(input.artifacts.sceneScripts.sceneScriptsHash)
    || !isSha256Hash(input.artifacts.choiceContracts.choiceContractsHash)
    || !isSha256Hash(input.artifacts.actionBindings.actionBindingsHash)) fail('P9 Artifact身份或Hash无效')
  await assertOwnHash(input.artifacts.sceneScripts as unknown as Record<string, unknown>, 'sceneScriptsHash', 'SceneScripts')
  await assertOwnHash(input.artifacts.choiceContracts as unknown as Record<string, unknown>, 'choiceContractsHash', 'ChoiceContracts')
  await assertOwnHash(input.artifacts.actionBindings as unknown as Record<string, unknown>, 'actionBindingsHash', 'ActionBindings')
  const context = await parseContext(typeof input.context === 'string' ? input.context : canonicalProductProductionJsonV2(input.context))
  const createdAt = input.artifacts.sceneScripts.createdAt
  if (input.artifacts.choiceContracts.createdAt !== createdAt || input.artifacts.actionBindings.createdAt !== createdAt) fail('P9 Artifact createdAt不一致')
  const draft = parseDraft(draftFromArtifacts(input.artifacts), context)
  const expected = await createArtifacts({ context, draft, createdAt })
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.artifacts)) fail('P9场景、Choice、交互绑定或Hash被篡改')
  return input.artifacts
}

function prompts(context: TextOpenWorldSceneScriptsInputContextV1) {
  if (governedKnowledge(context)) {
    const isolatedScene = context.sceneDemands.length === 1
      && context.actionLanguageDemands.length === 0
      && context.templateVariantDemands.length === 0
      && context.randomEventPresentationDemands.length === 0
      && (context.knowledgePresentationDemands?.length ?? 0) === 0
      && (context.achievementPresentationDemands?.length ?? 0) === 0
    if (isolatedScene) {
      const demand = context.sceneDemands[0]!
      return {
        system: [
          '只为输入中的唯一当前Scene写公开叙事，只返回JSON。',
          '仅用currentObjective与publicCatalogs；禁止输入外事实、未来目标、私密资料、来源证据和新Action。',
        ].join('\n'),
        user: [
          `scenes精确1项且sceneNumber=1；choiceLabels精确${demand.choiceCount}条；${demand.sourceKind === 'actor-dialogue' ? 'attitudeOpenings为bad/neutral/good字符串对象' : 'attitudeOpenings=null'}。`,
          'Scene字段仅title/openingText/bodyText/successText/failureText/choiceLabels/attitudeOpenings；根schema="storyforge.text-open-world-scene-scripts-draft",version=1，另五组数组actionUtterances/templateVariants/randomEvents/knowledgePresentations/achievementPresentations均=[]。',
        ].join('\n'),
      }
    }
    const system = [
      '你是StoryForge文字开放世界的场景、对话与交互表现设计师。只能返回JSON。',
      '你收到的是governed-v3最小披露投影：只可使用其中公开标签与稳定引用，不得猜测被隐藏的世界真相、未来任务目标、人物私密背景或来源证据。',
      '你只写可读叙事、对话语气、固定选项文案、自然语言示例以及Knowledge/成就的公开展示标题；稳定键、Action、Condition、Effect、奖励、任务状态、传闻事实和数值全由代码生成。',
      '系统Action、固定Choice和自然语言只是同一已冻结Action的三种入口；不得新建解法、任务、地图、技能、状态结果、传闻或事实。',
      '每个Scene只能使用该sceneDemand.currentObjective及其稳定引用在publicCatalogs中解析出的公开材料；不得借用其他Scene的目标材料。',
      'Scene只能按knowledgeBoundaryKey引用当前可见Knowledge键；不得解释键背后的隐藏内容。战斗Action不提供自由语言映射。',
    ].join('\n')
    const user = [
      `scenes按${context.sceneDemands.length}项需求顺序输出sceneNumber/title/openingText/bodyText/successText/failureText/choiceLabels/attitudeOpenings。choiceLabels数量必须等于choiceCount；仅actor-dialogue填写bad/neutral/good三档开场，其他填null。`,
      `actionUtterances按${context.actionLanguageDemands.length}项可映射Action顺序输出actionNumber和精确2条不重复示例；按actionKey读取publicCatalogs.actions的label/description/target，不要输出actionKey或结果。`,
      `templateVariants按${context.templateVariantDemands.length}项需求输出variantNumber/title/description；必须按sourceTemplateSeedKey读取publicCatalogs.taskTemplates中的storyFrame/variationAxes/eligibilitySummary/cooldownIntent，同一模板的3份文字必须明显不同。`,
      `randomEvents按${context.randomEventPresentationDemands.length}项事件输出eventNumber/openingText/resolutionText/rumorText；rumorText一律填null，事实文本和可靠度由编译器从P8F复制。`,
      `knowledgePresentations按${context.knowledgePresentationDemands?.length ?? 0}项需求输出knowledgeNumber/title/summary；title只可改写publicSubjectLabel，summary只写不新增事实的简短界面说明。`,
      `achievementPresentations按${context.achievementPresentationDemands?.length ?? 0}项需求输出achievementNumber/title/description；只可依据publicSourceLabel和sourceKind写公开展示文案。`,
      '不要输出任何键、引用、条件、效果、数值结算、隐藏事实或未要求字段。',
      '返回：{"schema":"storyforge.text-open-world-scene-scripts-draft","version":1,"scenes":[...],"actionUtterances":[...],"templateVariants":[...],"randomEvents":[...],"knowledgePresentations":[...],"achievementPresentations":[...]}',
    ].join('\n')
    return { system, user }
  }
  const system = [
    '你是StoryForge文字开放世界的场景、对话与交互表现设计师。只能返回JSON。',
    '你只写可读叙事、对话语气、固定选项文案和自然语言示例；稳定键、Action、Condition、Effect、奖励、任务状态和数值全由代码生成。',
    '系统Action、固定Choice和自然语言只是同一已冻结Action的三种入口；不得新建解法、任务、地图、技能或状态结果。',
    '严格按SceneDemand.knowledgeBoundaryKey查阅knowledgeBoundaries，只使用允许知识且不剧透后续目标；战斗Action不提供自由语言映射。',
  ].join('\n')
  const user = [
    `scenes按${context.sceneDemands.length}项需求顺序输出sceneNumber/title/openingText/bodyText/successText/failureText/choiceLabels/attitudeOpenings。choiceLabels数量必须等于choiceCount；仅actor-dialogue填写bad/neutral/good三档开场，其他填null。`,
    `actionUtterances按${context.actionLanguageDemands.length}项可映射Action顺序输出actionNumber和精确2条不重复示例；不要输出actionKey或结果。`,
    `templateVariants按${context.templateVariantDemands.length}项需求输出variantNumber/title/description，同一模板的3份文字必须明显不同。`,
    `randomEvents按${context.randomEventPresentationDemands.length}项事件输出eventNumber/openingText/resolutionText/rumorText；只有rumorRequirementKey非null时填写不确定传闻，否则必须为null。`,
    '不要输出任何键、引用、条件、效果、数值结算或未要求字段。',
    '返回：{"schema":"storyforge.text-open-world-scene-scripts-draft","version":1,"scenes":[...],"actionUtterances":[...],"templateVariants":[...],"randomEvents":[...]}',
  ].join('\n')
  return { system, user }
}

async function defaultRunner(input: Parameters<TextOpenWorldSceneScriptsModelRunnerV1>[0]): Promise<TextOpenWorldSceneScriptsModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是已验签的P9输入合同：\n<scene-scripts-input>\n${input.contextText}\n</scene-scripts-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

function modelDraftEnvelope(draft: SceneScriptsDraftV1): Record<string, unknown> {
  return {
    schema: 'storyforge.text-open-world-scene-scripts-draft',
    version: 1,
    scenes: draft.scenes,
    actionUtterances: draft.actionUtterances,
    templateVariants: draft.templateVariants,
    randomEvents: draft.randomEvents,
    knowledgePresentations: draft.knowledgePresentations,
    achievementPresentations: draft.achievementPresentations,
  }
}

function deterministicActionUtterances(
  context: TextOpenWorldSceneScriptsInputContextV1,
): SceneScriptsDraftV1['actionUtterances'] {
  const used = new Set<string>()
  const reserve = (source: string, actionNumber: number, variant: number): string => {
    const normalized = source.trim().normalize('NFC').slice(0, 96) || '执行行动'
    let candidate = normalized
    let disambiguator = 0
    while (used.has(candidate.toLocaleLowerCase('zh-CN'))) {
      disambiguator += 1
      const suffix = `（行动${actionNumber}-${variant}-${disambiguator}）`
      candidate = `${normalized.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`
    }
    used.add(candidate.toLocaleLowerCase('zh-CN'))
    return candidate
  }
  return context.actionLanguageDemands.map(demand => {
    const action = actionByKey(context, demand.actionKey)
    const stem = action.label.trim().normalize('NFC').slice(0, 96) || '执行行动'
    return {
      actionNumber: demand.actionNumber,
      examples: [
        reserve(stem, demand.actionNumber, 1),
        reserve(`我要${stem}`, demand.actionNumber, 2),
      ],
    }
  })
}

function fragmentOutputWeight(context: TextOpenWorldSceneScriptsInputContextV1): number {
  return 1
    + context.sceneDemands.reduce((sum, demand) => sum + 12 + demand.choiceCount, 0)
    + context.actionLanguageDemands.length * 3
    + context.templateVariantDemands.length * 4
    + context.randomEventPresentationDemands.length * 5
    + (context.knowledgePresentationDemands?.length ?? 0) * 3
    + (context.achievementPresentationDemands?.length ?? 0) * 3
}

function minimumFragmentOutputTokens(context: TextOpenWorldSceneScriptsInputContextV1): number {
  // This is a structural floor, not a content target. It makes a Plan that
  // cannot even carry the required JSON fail before the first paid request.
  return Math.max(96, fragmentOutputWeight(context) * 8)
}

/** Deterministically partitions one task-level output reservation. The sum of
 * per-call maxima never exceeds the frozen task reservation and no individual
 * provider request can exceed the existing 32k response ceiling. */
function allocateFragmentOutputBudgets(total: number, weights: number[], minimums: number[]): number[] {
  if (!Number.isSafeInteger(total) || weights.length !== minimums.length) {
    fail('P9隔离调用输出预算参数无效')
  }
  if (weights.some(weight => !Number.isSafeInteger(weight) || weight < 1)) fail('P9隔离调用权重无效')
  if (minimums.some(minimum => !Number.isSafeInteger(minimum) || minimum < 1 || minimum > 32_000)) {
    fail('P9隔离调用最小输出预算无效')
  }
  const minimumTotal = minimums.reduce((sum, minimum) => sum + minimum, 0)
  if (total < minimumTotal) fail(`P9隔离调用输出预算不足:${total}/${minimumTotal}`)
  const budgets = [...minimums]
  const distributable = total - minimumTotal
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  const fractions = weights.map((weight, index) => {
    const exact = distributable * weight / weightTotal
    const whole = Math.min(32_000 - budgets[index]!, Math.floor(exact))
    budgets[index]! += whole
    return { index, remainder: exact - whole }
  })
  let residual = total - budgets.reduce((sum, budget) => sum + budget, 0)
  fractions.sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (const item of fractions) {
    if (residual === 0) break
    if (budgets[item.index]! >= 32_000) continue
    budgets[item.index]! += 1
    residual -= 1
  }
  return budgets
}

interface PreparedSceneScriptsFragmentV1 {
  fragmentNumber: number
  slice: TextOpenWorldSceneScriptsModelContextSliceV1
  parsingContext: TextOpenWorldSceneScriptsInputContextV1
  contextText: string
  systemText: string
  weight: number
  minimumOutputTokens: number
  maximumOutputTokens: number
}

function zeroTaskUsage(durationMs = 0): ProductProductionTaskUsageV1 {
  return {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    mediaCalls: 0,
    costUsd: 0,
    durationMs,
    storageBytes: 0,
  }
}

function addTaskUsage(
  left: ProductProductionTaskUsageV1,
  right: ProductProductionTaskUsageV1,
): ProductProductionTaskUsageV1 {
  return {
    modelCalls: left.modelCalls + right.modelCalls,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    mediaCalls: left.mediaCalls + right.mediaCalls,
    costUsd: left.costUsd == null || right.costUsd == null ? null : left.costUsd + right.costUsd,
    durationMs: left.durationMs + right.durationMs,
    storageBytes: left.storageBytes + right.storageBytes,
  }
}

function observedTokenUsage(value: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const usage = value as Record<string, unknown>
  if (!Number.isSafeInteger(usage.inputTokens) || Number(usage.inputTokens) < 0
    || !Number.isSafeInteger(usage.outputTokens) || Number(usage.outputTokens) < 0) return null
  return { inputTokens: Number(usage.inputTokens), outputTokens: Number(usage.outputTokens) }
}

function estimatedFragmentInputTokens(fragment: PreparedSceneScriptsFragmentV1): number {
  // Include the stable transport envelope as well as the domain prompt and
  // safe projection; otherwise 116 small calls systematically undercount.
  return estimateTokens([
    fragment.systemText,
    '下一条user消息是本任务唯一权威的原子JSON上下文。',
    fragment.contextText,
  ].join('\n')) + 32
}

function responseUsage(
  response: TextOpenWorldSceneScriptsModelExecutionV1,
  fragment: PreparedSceneScriptsFragmentV1,
  startedAt: number,
): ProductProductionTaskUsageV1 {
  const observed = observedTokenUsage(response.usage)
  return {
    modelCalls: 1,
    inputTokens: observed?.inputTokens ?? estimatedFragmentInputTokens(fragment),
    outputTokens: observed?.outputTokens ?? estimateTokens(response.output),
    mediaCalls: 0,
    costUsd: null,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    storageBytes: 0,
  }
}

function durableFragmentStepId(
  execution: ProductProductionTaskExecutionInputV1,
  slice: TextOpenWorldSceneScriptsModelContextSliceV1,
): string {
  return slice.kind === 'scene'
    ? `${execution.task.taskKey}.fragment.scene.${String(slice.sceneIndex + 1).padStart(5, '0')}`
    : `${execution.task.taskKey}.fragment.shared-presentations`
}

async function appendFragmentEvent(
  execution: ProductProductionTaskExecutionInputV1,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: unknown,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope: execution.scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0])
}

async function fragmentContextManifest(input: {
  execution: ProductProductionTaskExecutionInputV1
  fragment: PreparedSceneScriptsFragmentV1
  stepId: string
  attempt: number
}) {
  if (input.execution.taskRunId == null) fail('P9分片ContextManifest缺少taskRunId')
  const tokens = estimateTokens(input.fragment.contextText)
  return createContextManifestV1({
    version: 1,
    runId: input.execution.taskRunId,
    stepId: input.stepId,
    attempt: input.attempt,
    scope: { projectId: input.execution.scope.projectId, worldGroupId: null },
    inputBudget: Math.max(1, tokens),
    totalInputTokens: tokens,
    sources: [{
      key: FRAGMENT_CONTEXT_SOURCE_KEY,
      status: 'included',
      contentHash: await sha256Text(input.fragment.contextText),
      tokens,
      delivery: 'full',
      originalTokens: tokens,
      readerVersion: FRAGMENT_CONTEXT_READER_VERSION,
    }],
  })
}

function fragmentRenderedRequest(input: {
  execution: ProductProductionTaskExecutionInputV1
  fragment: PreparedSceneScriptsFragmentV1
  requirementKey: string
  stepId: string
}) {
  return {
    schema: 'storyforge.text-open-world-scene-scripts-fragment-request' as const,
    version: 1 as const,
    stepId: input.stepId,
    fragmentNumber: input.fragment.fragmentNumber,
    slice: input.fragment.slice,
    requirementKey: input.requirementKey,
    category: SKILL_ID,
    system: input.fragment.systemText,
    contextText: input.fragment.contextText,
    maximumOutputTokens: input.fragment.maximumOutputTokens,
  }
}

async function restoreSuccessfulFragment(input: {
  execution: ProductProductionTaskExecutionInputV1
  snapshot: AgentRunSnapshotV1
  fragment: PreparedSceneScriptsFragmentV1
  requirementKey: string
  bindingHash: string
  stepId: string
}): Promise<SceneScriptsDraftV1> {
  const step = input.snapshot.projection.steps[input.stepId]
  if (!step || step.status !== 'succeeded' || !step.candidateHash) {
    fail(`P9分片没有可恢复的成功候选:${input.stepId}`)
  }
  const expectedManifest = await fragmentContextManifest({
    execution: input.execution,
    fragment: input.fragment,
    stepId: input.stepId,
    attempt: step.attempt,
  })
  const assembledManifestHashes = input.snapshot.events.flatMap(event => event.type === 'context.assembled'
    && event.payload.stepId === input.stepId && event.payload.attempt === step.attempt
    ? [event.payload.manifestHash]
    : [])
  if (assembledManifestHashes.length !== 1 || assembledManifestHashes[0] !== expectedManifest.manifestHash) {
    fail(`P9分片恢复ContextManifest不一致:${input.stepId}`)
  }
  const manifestHashes = input.snapshot.events.flatMap(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === input.stepId
    && event.payload.attempt === step.attempt
    && event.payload.artifactKind === 'context-manifest'
    ? [event.payload.contentHash]
    : [])
  if (manifestHashes.length !== 1) fail(`P9分片缺少唯一ContextManifest证据:${input.stepId}`)
  const storedManifest = await readAgentRunArtifactExactV1({
    projectId: input.execution.scope.projectId,
    artifactKind: 'context-manifest',
    contentHash: manifestHashes[0]!,
  })
  if (storedManifest !== canonicalStringify(expectedManifest)) {
    fail(`P9分片ContextManifest正文与当前安全投影不一致:${input.stepId}`)
  }
  const expectedRequest = canonicalStringify(fragmentRenderedRequest({
    execution: input.execution,
    fragment: input.fragment,
    requirementKey: input.requirementKey,
    stepId: input.stepId,
  }))
  const requestHashes = input.snapshot.events.flatMap(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === input.stepId
    && event.payload.attempt === step.attempt
    && event.payload.artifactKind === 'rendered-request'
    ? [event.payload.contentHash]
    : [])
  if (requestHashes.length !== 1) fail(`P9分片缺少唯一请求证据:${input.stepId}`)
  if (await readAgentRunArtifactExactV1({
    projectId: input.execution.scope.projectId,
    artifactKind: 'rendered-request',
    contentHash: requestHashes[0]!,
  }) !== expectedRequest) fail(`P9分片请求证据与当前安全投影不一致:${input.stepId}`)
  const requestBindingHashes = input.snapshot.events.flatMap(event => event.type === 'model.requested'
    && event.payload.stepId === input.stepId && event.payload.attempt === step.attempt
    ? [event.payload.bindingHash]
    : [])
  if (requestBindingHashes.length !== 1 || requestBindingHashes[0] !== input.bindingHash) {
    fail(`P9分片恢复binding不一致:${input.stepId}`)
  }
  const responseHashes = input.snapshot.events.flatMap(event => event.type === 'evidence.artifact.recorded'
    && event.payload.stepId === input.stepId
    && event.payload.attempt === step.attempt
    && event.payload.artifactKind === 'raw-response'
    ? [event.payload.contentHash]
    : [])
  if (responseHashes.length !== 1) fail(`P9分片缺少唯一raw-response:${input.stepId}`)
  let response: TextOpenWorldSceneScriptsModelExecutionV1
  try {
    response = JSON.parse(await readAgentRunArtifactExactV1({
      projectId: input.execution.scope.projectId,
      artifactKind: 'raw-response',
      contentHash: responseHashes[0]!,
    })) as TextOpenWorldSceneScriptsModelExecutionV1
  } catch {
    return fail(`P9分片raw-response损坏:${input.stepId}`)
  }
  const candidateHash = typeof response.output === 'string'
    ? await hashProductProductionValueV2(response.output)
    : null
  const respondedHashes = input.snapshot.events.flatMap(event => event.type === 'model.responded'
    && event.payload.stepId === input.stepId && event.payload.attempt === step.attempt
    ? [event.payload.outputHash]
    : [])
  const candidates = input.snapshot.events.flatMap(event => event.type === 'candidate.persisted'
    && event.payload.stepId === input.stepId && event.payload.attempt === step.attempt
    ? [{ candidateHash: event.payload.candidateHash, requiresConfirmation: event.payload.requiresConfirmation }]
    : [])
  if (!candidateHash || candidateHash !== step.candidateHash || step.outputHash !== candidateHash
    || response.bindingReceipt?.capabilityHash !== input.bindingHash
    || respondedHashes.length !== 1 || respondedHashes[0] !== candidateHash
    || candidates.length !== 1 || candidates[0]!.candidateHash !== candidateHash
    || candidates[0]!.requiresConfirmation !== false) {
    fail(`P9分片恢复候选与冻结证据不一致:${input.stepId}`)
  }
  return parseDraft(
    parseProductionModelJsonObjectV1(response.output, `text-open-world-scene-scripts:${input.stepId}`),
    input.fragment.parsingContext,
  )
}

async function callFragmentModel(input: {
  execution: ProductProductionTaskExecutionInputV1
  fragment: PreparedSceneScriptsFragmentV1
  runModel: TextOpenWorldSceneScriptsModelRunnerV1
  requirementKey: string
  bindingHash: string
  onPaidUsage: (usage: ProductProductionTaskUsageV1) => void
}): Promise<{ response: TextOpenWorldSceneScriptsModelExecutionV1; usage: ProductProductionTaskUsageV1 }> {
  const startedAt = performance.now()
  let response: TextOpenWorldSceneScriptsModelExecutionV1
  try {
    response = await input.runModel({
      projectId: input.execution.scope.projectId,
      requirementKey: input.requirementKey,
      expectedCapabilityHash: input.bindingHash,
      category: SKILL_ID,
      system: input.fragment.systemText,
      contextText: input.fragment.contextText,
      maximumOutputTokens: input.fragment.maximumOutputTokens,
      signal: input.execution.signal,
    })
  } catch (error) {
    if (error instanceof ProductProductionResultUnknownErrorV1
      || (error instanceof Error && error.name === 'ProductProductionResultUnknownErrorV1')) throw error
    if (error instanceof ProductProductionRetryableExecutionErrorV1) {
      input.onPaidUsage(error.usage)
      throw error
    }
    if (error instanceof ProductProductionDraftRejectedErrorV1) {
      input.onPaidUsage(error.usage)
      throw error
    }
    if (error instanceof AIError) {
      if ([408, 409, 425, 429].includes(error.status) || error.status >= 500) {
        throw new ProductProductionRetryableExecutionErrorV1(
          error.message,
          zeroTaskUsage(Math.max(0, Math.round(performance.now() - startedAt))),
        )
      }
      // A provider HTTP rejection is an observed, known failure. It carries no
      // successful response usage and must not be treated as an unknown result.
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError' && input.execution.signal.aborted) throw error
    // A generic network/transport exception does not prove whether dispatch or
    // charging crossed the provider boundary, so automatic replay is unsafe.
    throw new ProductProductionResultUnknownErrorV1()
  }
  // Keep all local receipt, evidence and parser failures outside the transport
  // catch. The provider response is known and billable from this point onward.
  const usage = responseUsage(response, input.fragment, startedAt)
  return { response, usage }
}

async function runGovernedFragment(input: {
  execution: ProductProductionTaskExecutionInputV1
  fragment: PreparedSceneScriptsFragmentV1
  runModel: TextOpenWorldSceneScriptsModelRunnerV1
  requirementKey: string
  bindingHash: string
  onPaidUsage: (usage: ProductProductionTaskUsageV1) => void
}): Promise<SceneScriptsDraftV1> {
  if (input.execution.taskRunId == null) {
    const { response, usage } = await callFragmentModel(input)
    input.onPaidUsage(usage)
    if (response.bindingReceipt.capabilityHash !== input.bindingHash) {
      fail(`执行时文本capability与Plan binding不一致:fragment-${input.fragment.fragmentNumber}`)
    }
    return parseDraft(
      parseProductionModelJsonObjectV1(
        response.output,
        `text-open-world-scene-scripts-fragment-${input.fragment.fragmentNumber}`,
      ),
      input.fragment.parsingContext,
    )
  }
  const stepId = durableFragmentStepId(input.execution, input.fragment.slice)
  let snapshot = await readAgentRunV1(input.execution.scope, input.execution.taskRunId)
  const existing = snapshot.projection.steps[stepId]
  if (existing?.status === 'succeeded') {
    return restoreSuccessfulFragment({
      execution: input.execution,
      snapshot,
      fragment: input.fragment,
      requirementKey: input.requirementKey,
      bindingHash: input.bindingHash,
      stepId,
    })
  }
  if (existing && existing.status !== 'failed' && existing.status !== 'scheduled') {
    // A running fragment has crossed model.requested but lacks a verified
    // terminal candidate. Re-dispatch could duplicate both content and cost.
    throw new ProductProductionResultUnknownErrorV1()
  }
  if (!existing) snapshot = await appendFragmentEvent(input.execution, snapshot, 'step.scheduled', { stepId })
  const attempt = existing?.status === 'failed' ? existing.attempt + 1 : 1
  snapshot = await appendFragmentEvent(input.execution, snapshot, 'step.started', { stepId, attempt })
  const manifest = await fragmentContextManifest({
    execution: input.execution,
    fragment: input.fragment,
    stepId,
    attempt,
  })
  snapshot = (await recordAgentRunArtifactV1({
    scope: input.execution.scope,
    runId: snapshot.run.id,
    artifactKind: 'context-manifest',
    content: canonicalStringify(manifest),
    stepId,
    attempt,
    expectedLastSequence: snapshot.projection.lastSequence,
  })).snapshot
  snapshot = (await recordAgentRunArtifactV1({
    scope: input.execution.scope,
    runId: snapshot.run.id,
    artifactKind: 'rendered-request',
    content: canonicalStringify(fragmentRenderedRequest({
      execution: input.execution,
      fragment: input.fragment,
      requirementKey: input.requirementKey,
      stepId,
    })),
    stepId,
    attempt,
    expectedLastSequence: snapshot.projection.lastSequence,
  })).snapshot
  snapshot = await appendFragmentEvent(input.execution, snapshot, 'context.assembled', {
    stepId,
    attempt,
    manifestHash: manifest.manifestHash,
  })
  snapshot = await appendFragmentEvent(input.execution, snapshot, 'model.requested', {
    stepId,
    attempt,
    bindingHash: input.bindingHash,
  })
  try {
    const { response, usage } = await callFragmentModel(input)
    const candidateHash = await hashProductProductionValueV2(response.output)
    snapshot = await appendFragmentEvent(input.execution, snapshot, 'model.responded', {
      stepId,
      attempt,
      outputHash: candidateHash,
    })
    snapshot = (await recordAgentRunArtifactV1({
      scope: input.execution.scope,
      runId: snapshot.run.id,
      artifactKind: 'raw-response',
      content: canonicalStringify(response),
      stepId,
      attempt,
      expectedLastSequence: snapshot.projection.lastSequence,
    })).snapshot
    // The provider response is already billable. Preserve its exact durable
    // evidence before enforcing the remaining attempt reservation: an
    // over-report must stop later calls, but must never erase the paid result.
    input.onPaidUsage(usage)
    if (response.bindingReceipt.capabilityHash !== input.bindingHash) {
      fail(`执行时文本capability与Plan binding不一致:${stepId}`)
    }
    let draft: SceneScriptsDraftV1
    try {
      draft = parseDraft(
        parseProductionModelJsonObjectV1(response.output, `text-open-world-scene-scripts:${stepId}`),
        input.fragment.parsingContext,
      )
    } catch (error) {
      // The response and exact paid usage are known and durably recorded. A
      // single schema repair is therefore safe: retry this fragment only,
      // while every already accepted fragment is restored from its evidence.
      throw new ProductProductionRetryableExecutionErrorV1(
        error instanceof Error ? error.message : String(error),
        usage,
      )
    }
    snapshot = await appendFragmentEvent(input.execution, snapshot, 'candidate.persisted', {
      stepId,
      attempt,
      candidateHash,
      requiresConfirmation: false,
    })
    await appendFragmentEvent(input.execution, snapshot, 'step.succeeded', {
      stepId,
      attempt,
      outputHash: candidateHash,
    })
    return draft
  } catch (error) {
    if (error instanceof ProductProductionResultUnknownErrorV1
      || (error instanceof Error && error.name === 'ProductProductionResultUnknownErrorV1')) throw error
    snapshot = await readAgentRunV1(input.execution.scope, snapshot.run.id)
    if (snapshot.projection.steps[stepId]?.status === 'running') {
      await appendFragmentEvent(input.execution, snapshot, 'step.failed', {
        stepId,
        attempt,
        code: 'scene-scripts-fragment-failed',
        retryable: error instanceof ProductProductionRetryableExecutionErrorV1
          && input.execution.attempt < input.execution.task.maxAttempts,
      })
    }
    throw error
  }
}

export function createTextOpenWorldSceneScriptsExecutorV1(options: {
  runModel?: TextOpenWorldSceneScriptsModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p9.scene-scripts' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('执行器收到错误任务')
    const expectedOutputs = ['text-open-world.scene-scripts', 'text-open-world.choice-contracts', 'text-open-world.action-bindings']
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(expectedOutputs)) fail('P9输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('P9需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('P9缺少文本capability binding')
    const context = await parseContext(execution.contextText)
    const started = performance.now()
    let draft: SceneScriptsDraftV1
    let modelCalls: number
    let inputTokens: number
    let outputTokens: number
    if (execution.authorDraftJson !== undefined) {
      draft = parseDraft(
        parseProductionModelJsonObjectV1(execution.authorDraftJson, 'text-open-world-scene-scripts-author-draft'),
        context,
      )
      modelCalls = 0
      inputTokens = 0
      outputTokens = 0
    } else if (!governedKnowledge(context)) {
      // Historical durable v1/v2 runs keep their exact single-call contract.
      const modelContext = await createTextOpenWorldSceneScriptsModelContextV1(context)
      const modelContextText = canonicalProductProductionJsonV2(modelContext)
      const prompt = prompts(context)
      const model = await runModel({
        projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
        category: SKILL_ID,
        system: `${prompt.system}\n${prompt.user}`, contextText: modelContextText,
        maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
      })
      if (model.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
      draft = parseDraft(parseProductionModelJsonObjectV1(model.output, 'text-open-world-scene-scripts'), context)
      modelCalls = 1
      inputTokens = model.usage?.inputTokens ?? estimateTokens(prompt.system + prompt.user + modelContextText)
      outputTokens = model.usage?.outputTokens ?? estimateTokens(model.output)
    } else {
      if (context.sceneDemands.length > TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1) {
        fail(`P9 governed-v3场景数超过硬上限:${context.sceneDemands.length}/${TEXT_OPEN_WORLD_MAX_GOVERNED_SCENES_V1}`)
      }
      const slices: TextOpenWorldSceneScriptsModelContextSliceV1[] = [
        ...context.sceneDemands.map((_, sceneIndex) => ({ kind: 'scene' as const, sceneIndex })),
        { kind: 'shared-presentations' },
      ]
      const requiredCallsWithRepair = slices.length + 1
      if (requiredCallsWithRepair > execution.task.budgetReservation.modelCalls) {
        fail(`P9 governed-v3硬隔离与一次片段修复需要${requiredCallsWithRepair}次模型调用，但Plan只预留${execution.task.budgetReservation.modelCalls}次`)
      }
      const fragmentBases = await Promise.all(slices.map(async (slice, index) => {
        const parsingContext = draftParsingContext(context, slice)
        const modelContext = await createTextOpenWorldSceneScriptsModelContextV1(context, slice)
        const contextText = canonicalProductProductionJsonV2(modelContext)
        const prompt = prompts(parsingContext)
        const weight = fragmentOutputWeight(parsingContext)
        return {
          fragmentNumber: index + 1,
          slice,
          parsingContext,
          contextText,
          systemText: `${prompt.system}\n${prompt.user}`,
          weight,
          minimumOutputTokens: minimumFragmentOutputTokens(parsingContext),
        }
      }))
      const estimatedFragmentInputs = fragmentBases.map(fragment => (
        estimatedFragmentInputTokens({ ...fragment, maximumOutputTokens: fragment.minimumOutputTokens })
      ))
      const estimatedInputTokens = estimatedFragmentInputs.reduce((sum, tokens) => sum + tokens, 0)
      const inputRepairReserve = Math.max(...estimatedFragmentInputs)
      if (estimatedInputTokens + inputRepairReserve > execution.task.budgetReservation.inputTokens) {
        fail(`P9 governed-v3隔离投影与一次最大片段修复超出输入预算:${estimatedInputTokens}+${inputRepairReserve}/${execution.task.budgetReservation.inputTokens}`)
      }
      const provisionalOutputBudgets = allocateFragmentOutputBudgets(
        execution.task.budgetReservation.outputTokens,
        fragmentBases.map(fragment => fragment.weight),
        fragmentBases.map(fragment => fragment.minimumOutputTokens),
      )
      const outputRepairReserve = Math.max(...provisionalOutputBudgets)
      const outputBudgets = allocateFragmentOutputBudgets(
        execution.task.budgetReservation.outputTokens - outputRepairReserve,
        fragmentBases.map(fragment => fragment.weight),
        fragmentBases.map(fragment => fragment.minimumOutputTokens),
      )
      const fragments: PreparedSceneScriptsFragmentV1[] = fragmentBases.map((fragment, index) => ({
        ...fragment,
        maximumOutputTokens: outputBudgets[index]!,
      }))
      const parsed: SceneScriptsDraftV1[] = []
      let paidUsage = zeroTaskUsage()
      const activeReservation = execution.attemptBudgetReservation ?? execution.task.budgetReservation
      const accountPaidUsage = (usage: ProductProductionTaskUsageV1) => {
        const next = addTaskUsage(paidUsage, usage)
        // The response is already billable. Record it before enforcing the
        // current attempt's remaining reservation so an over-report cannot
        // erase a real paid call or permit avoidable later fragment calls.
        paidUsage = next
        if (next.modelCalls > activeReservation.modelCalls
          || next.inputTokens > activeReservation.inputTokens
          || next.outputTokens > activeReservation.outputTokens
          || next.mediaCalls > activeReservation.mediaCalls
          || next.durationMs > activeReservation.durationMs
          || next.storageBytes > activeReservation.storageBytes
          || (activeReservation.maximumCostUsd !== null
            && next.costUsd !== null
            && next.costUsd > activeReservation.maximumCostUsd)) {
          fail(`P9 governed-v3实际模型用量超过本次attempt剩余预留:${next.modelCalls}/${next.inputTokens}/${next.outputTokens}`)
        }
      }
      try {
        for (const fragment of fragments) {
          if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
          parsed.push(await runGovernedFragment({
            execution,
            fragment,
            runModel,
            requirementKey,
            bindingHash: binding.bindingHash,
            onPaidUsage: accountPaidUsage,
          }))
        }
      } catch (error) {
        if (error instanceof ProductProductionResultUnknownErrorV1
          || (error instanceof Error && error.name === 'ProductProductionResultUnknownErrorV1')) throw error
        if (error instanceof ProductProductionRetryableExecutionErrorV1) {
          throw new ProductProductionRetryableExecutionErrorV1(
            error.message,
            { ...paidUsage, durationMs: Math.max(0, Math.round(performance.now() - started)) },
          )
        }
        if (error instanceof DOMException && error.name === 'AbortError' && paidUsage.modelCalls === 0) throw error
        throw new ProductProductionDraftRejectedErrorV1(
          error instanceof Error ? error.message : String(error),
          { ...paidUsage, durationMs: Math.max(0, Math.round(performance.now() - started)) },
        )
      }
      const sceneDrafts = parsed.slice(0, context.sceneDemands.length).map((fragment, index) => ({
        ...fragment.scenes[0]!,
        sceneNumber: index + 1,
      }))
      const shared = parsed[parsed.length - 1]!
      draft = parseDraft(modelDraftEnvelope({
        scenes: sceneDrafts,
        actionUtterances: deterministicActionUtterances(context),
        templateVariants: shared.templateVariants,
        randomEvents: shared.randomEvents,
        knowledgePresentations: shared.knowledgePresentations,
        achievementPresentations: shared.achievementPresentations,
      }), context)
      modelCalls = paidUsage.modelCalls
      inputTokens = paidUsage.inputTokens
      outputTokens = paidUsage.outputTokens
    }
    const artifacts = await createArtifacts({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) })
    await validateTextOpenWorldSceneScriptsArtifactsV1({ artifacts, context })
    const durationMs = Math.max(0, Math.round(performance.now() - started))
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: [
        {
          artifactKey: 'text-open-world.scene-scripts', kind: 'text-open-world.scene-scripts', payload: artifacts.sceneScripts,
          quality: { sceneCount: artifacts.sceneScripts.scenes.length, objectiveCoverage: true, actorDialogueCoverage: true, directorPresentationCoverage: true },
          rights: { sourceLedgerHash: context.sourceLedger.ledgerHash },
        },
        {
          artifactKey: 'text-open-world.choice-contracts', kind: 'text-open-world.choice-contracts', payload: artifacts.choiceContracts,
          quality: { choiceCount: artifacts.choiceContracts.choices.length, exactActionReferences: true },
          rights: { questDesignDocumentsHash: context.questDesignDocuments.questDesignDocumentsHash },
        },
        {
          artifactKey: 'text-open-world.action-bindings', kind: 'text-open-world.action-bindings', payload: artifacts.actionBindings,
          quality: { actionCount: artifacts.actionBindings.actions.length, singleResultSource: true, combatFreeTextDisabled: true },
          rights: { experienceContractHash: context.experienceContract.experienceContractHash },
        },
      ],
      usage: {
        modelCalls, inputTokens, outputTokens, mediaCalls: 0, costUsd: null,
        durationMs, storageBytes: 0,
      },
      passedGateIds: [...execution.task.acceptanceGateIds],
    }
    return result
  }
}
