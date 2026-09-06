import type { ChatResult } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { db } from '../db/schema'
import { readAcceptedBuildArtifacts } from '../product-production/artifact-store'
import { runConfiguredProductionTextV1, type ProviderBindingReceiptV1 } from '../product-production/capabilities'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/production-executor'
import type { ProductProductionTaskExecutionResultV1, ProductProductionTaskExecutorV1 } from '../product-production/scheduler'
import type { AssembleContextInput } from '../registry/types'
import type {
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

const SKILL_ID = 'text-open-world.production.scene-scripts.v1'
const MAX_CONTEXT_CHARS = 440_000
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
  version: 1
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
      'key' | 'name' | 'biography' | 'portrayal' | 'factionKey' | 'homeLocationKey' | 'regionKey'>>
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
    | 'requirementBindings'
    | 'questDesignDocumentsHash'> & {
      quests: Array<Pick<TextOpenWorldQuestDesignDocumentsV1['quests'][number],
        | 'key' | 'type' | 'title' | 'ownerKind' | 'ownerKey' | 'regionKeys' | 'stageKeys'
        | 'prerequisiteConditionKeys' | 'rewardContractKey' | 'acceptActionKey' | 'claimActionKey'>>
      objectives: Array<Pick<TextOpenWorldQuestDesignDocumentsV1['objectives'][number],
        | 'key' | 'questKey' | 'stageKey' | 'title' | 'description' | 'requirementKeys'
        | 'supportActionKeys' | 'completionActionKey' | 'completionConditionKeys'>>
      actions: TextOpenWorldSceneActionSourceV1[]
      catalogBindings: Pick<TextOpenWorldQuestDesignDocumentsV1['catalogBindings'],
        'actors' | 'encounters' | 'items' | 'recipes' | 'vendors' | 'interactions' | 'rewards'>
      governance: Pick<TextOpenWorldQuestDesignDocumentsV1['governance'],
        'questAndEncounterBindingsReady' | 'sceneBindingsDeferred'>
    }
  directorDecks: {
    productInstanceKey: string
    regionNarrativePacksHash: string
    mapInteractionCatalogHash: string
    questDesignDocumentsHash: string
    templates: Array<Pick<TextOpenWorldDirectorDecksV1['templates'][number],
      'key' | 'questKey' | 'regionKeys' | 'variantTextRequirementKeys'>>
    randomEvents: TextOpenWorldDirectorDecksV1['randomEvents']
    governance: Pick<TextOpenWorldDirectorDecksV1['governance'], 'presentationVariantsDeferred'>
    directorDecksHash: string
  }
  knowledgeBoundaries: TextOpenWorldSceneKnowledgeBoundaryV1[]
  sceneDemands: TextOpenWorldSceneDemandV1[]
  actionLanguageDemands: TextOpenWorldActionLanguageDemandV1[]
  templateVariantDemands: TextOpenWorldTemplateVariantDemandV1[]
  randomEventPresentationDemands: TextOpenWorldRandomEventPresentationDemandV1[]
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
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldSceneScriptsModelExecutionV1>

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
function playerActionKeys(context: TextOpenWorldSceneScriptsInputContextV1, keys: string[]): string[] {
  return [...new Set(keys)].filter(key => actionByKey(context, key).actorScope === 'player')
}
function existingClaimKeys(context: TextOpenWorldSceneScriptsInputContextV1, keys: string[]): string[] {
  const existing = new Set(context.sourceLedger.entries.map(entry => entry.claimKey))
  return [...new Set(keys)].filter(key => existing.has(key))
}
function packClaimKeys(context: TextOpenWorldSceneScriptsInputContextV1, regionKey: string): string[] {
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
function participantsForObjective(context: TextOpenWorldSceneScriptsInputContextV1, objectiveKey: string): string[] {
  const objective = context.questDesignDocuments.objectives.find(item => item.key === objectiveKey) ?? fail(`缺少定稿Objective:${objectiveKey}`)
  const actors = context.questDesignDocuments.requirementBindings
    .filter(binding => objective.requirementKeys.includes(binding.requirementKey) && binding.definitionKind === 'actor')
    .flatMap(binding => binding.definitionKeys)
  const quest = context.questDesignDocuments.quests.find(item => item.key === objective.questKey)!
  if (quest.ownerKind === 'actor' && quest.ownerKey) actors.push(quest.ownerKey)
  return [...new Set(actors)].filter(key => context.npcRuntimeCatalog.actors.some(actor => actor.key === key))
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
  'knowledgeBoundaries' | 'sceneDemands' | 'actionLanguageDemands' | 'templateVariantDemands' | 'randomEventPresentationDemands' | 'contextSelectionHash'>

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
    const regionKey = quest.regionKeys[0] ?? context.mapInteractionCatalog.initialRegionKey
    const locationKey = skeleton.locationKeys[0] ?? context.mapInteractionCatalog.initialLocationKey
    const orderedObjectiveKeys = skeleton.stageKeys.flatMap(stageKey => (
      context.questSkeletons.stages.find(stage => stage.key === stageKey)?.objectiveKeys ?? []
    ))
    const ownerActor = quest.ownerKind === 'actor' && quest.ownerKey && context.npcRuntimeCatalog.actors.some(actor => actor.key === quest.ownerKey)
      ? quest.ownerKey : null
    const offerActions = playerActionKeys(hydrated, [quest.acceptActionKey])
    addScene({
      sceneKey: `scene.offer.${quest.key}`, sourceKind: 'quest-offer', sourceKey: quest.key,
      suggestedTitle: `委托：${quest.title}`, purpose: skeleton.storyMotivation,
      regionKey, locationKey, questKey: quest.key, stageKey: null, objectiveKey: null,
      actorKey: ownerActor, interactionKey: null, randomEventKey: null,
      participantKeys: ownerActor ? [ownerActor] : [], actionKeys: offerActions,
      choiceCount: offerActions.length, allowedKnowledgeClaimKeys: questClaimKeys(hydrated, quest.key),
      forbiddenFutureObjectiveKeys: orderedObjectiveKeys.slice(1),
      availabilityConditionKeys: [...quest.prerequisiteConditionKeys],
    })
    const resolutionActions = playerActionKeys(hydrated, [quest.claimActionKey])
    addScene({
      sceneKey: `scene.resolution.${quest.key}`, sourceKind: 'quest-resolution', sourceKey: quest.key,
      suggestedTitle: `收束：${quest.title}`, purpose: '呈现任务结果并领取已冻结奖励。',
      regionKey, locationKey, questKey: quest.key, stageKey: quest.stageKeys[quest.stageKeys.length - 1] ?? null, objectiveKey: null,
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
    addScene({
      sceneKey: `scene.objective.${objective.key}`, sourceKind: 'quest-objective', sourceKey: objective.key,
      suggestedTitle: objective.title, purpose: objective.description, regionKey,
      locationKey: locationForActions(hydrated, actions, quest.locationKeys),
      questKey: objective.questKey, stageKey: objective.stageKey, objectiveKey: objective.key,
      actorKey: null, interactionKey: null, randomEventKey: null,
      participantKeys: participantsForObjective(hydrated, objective.key), actionKeys: actions, choiceCount: actions.length,
      allowedKnowledgeClaimKeys: questClaimKeys(hydrated, objective.questKey),
      forbiddenFutureObjectiveKeys: futureObjectiveKeys(hydrated, objective.key),
      availabilityConditionKeys: [...new Set(actions.flatMap(key => actionByKey(hydrated, key).requirementConditionKeys))],
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
      forbiddenFutureObjectiveKeys: allProtectedObjectives, availabilityConditionKeys: actions.flatMap(key => actionByKey(hydrated, key).requirementConditionKeys),
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
    return {
      eventNumber: index + 1, randomEventKey: event.key, title: event.title, kind: event.kind,
      regionKey: event.regionKeys[0]!, locationKeys: [...event.locationKeys], rumorRequirementKey: event.rumorRequirementKey,
      sourceClaimKeys: existingClaimKeys(hydrated, [...(seed?.sourceClaimKeys ?? []), ...(pack?.sourceClaimKeys ?? [])]),
    }
  })
  return { knowledgeBoundaries, sceneDemands: scenes, actionLanguageDemands, templateVariantDemands, randomEventPresentationDemands }
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
  if (context.questDesignDocuments.actions.length === 0
    || new Set(context.questDesignDocuments.actions.map(action => action.key)).size !== context.questDesignDocuments.actions.length
    || context.questDesignDocuments.actions.some(action => !isSha256Hash(action.actionDefinitionHash))) {
    fail('P9 Action投影键或Definition Hash无效')
  }
  const expected = buildDemands(context)
  if (canonicalProductProductionJsonV2(expected.knowledgeBoundaries) !== canonicalProductProductionJsonV2(context.knowledgeBoundaries)
    || canonicalProductProductionJsonV2(expected.sceneDemands) !== canonicalProductProductionJsonV2(context.sceneDemands)
    || canonicalProductProductionJsonV2(expected.actionLanguageDemands) !== canonicalProductProductionJsonV2(context.actionLanguageDemands)
    || canonicalProductProductionJsonV2(expected.templateVariantDemands) !== canonicalProductProductionJsonV2(context.templateVariantDemands)
    || canonicalProductProductionJsonV2(expected.randomEventPresentationDemands) !== canonicalProductProductionJsonV2(context.randomEventPresentationDemands)) {
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
    schema: 'storyforge.text-open-world-scene-scripts-input' as const, version: 1 as const,
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
      actions: actionSources,
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
      governance: { presentationVariantsDeferred: directorDecks.governance.presentationVariantsDeferred },
      directorDecksHash: directorDecks.directorDecksHash,
    },
  }
  const body: Omit<TextOpenWorldSceneScriptsInputContextV1, 'contextSelectionHash'> = { ...base, ...buildDemands(base) }
  await validateUpstream(body)
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
  if (context.schema !== 'storyforge.text-open-world-scene-scripts-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldSceneScriptsInputContextV1): SceneScriptsDraftV1 {
  const root = record(value, 'draft')
  exactKeys(root, ['schema', 'version', 'scenes', 'actionUtterances', 'templateVariants', 'randomEvents'], 'draft')
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
    if ((demand.rumorRequirementKey !== null) !== (rumorText !== null)) fail(`randomEvents[${index}]谣言文本必须与线索需求一致`)
    return {
      eventNumber: integer(row.eventNumber, `randomEvents[${index}].eventNumber`, 1, context.randomEventPresentationDemands.length),
      openingText: text(row.openingText, `randomEvents[${index}].openingText`),
      resolutionText: text(row.resolutionText, `randomEvents[${index}].resolutionText`), rumorText,
    }
  })
  if (randomEvents.some((event, index) => event.eventNumber !== index + 1)) fail('randomEvents必须按事件顺序覆盖')
  return { scenes, actionUtterances, templateVariants, randomEvents }
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
  const actionHashes = new Map<string, string>()
  input.context.questDesignDocuments.actions.forEach(action => actionHashes.set(action.key, action.actionDefinitionHash))
  const choiceRows: TextOpenWorldChoiceContractsV1['choices'] = []
  const sceneRows: TextOpenWorldSceneScriptsV1['scenes'] = input.context.sceneDemands.map((demand, index) => {
    const draft = input.draft.scenes[index]!
    const knowledgeBoundary = input.context.knowledgeBoundaries.find(item => item.key === demand.knowledgeBoundaryKey)
      ?? fail(`Scene引用未知知识边界:${demand.sceneKey}`)
    const fixedChoiceKeys = demand.actionKeys.map((_actionKey, actionIndex) => `choice.${demand.sceneKey}.${String(actionIndex + 1).padStart(2, '0')}`)
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
  const randomEventPresentations = input.context.randomEventPresentationDemands.map((demand, index) => ({
    key: `presentation.${demand.randomEventKey}`, order: demand.eventNumber, randomEventKey: demand.randomEventKey,
    openingText: input.draft.randomEvents[index]!.openingText, resolutionText: input.draft.randomEvents[index]!.resolutionText,
    rumorKey: demand.rumorRequirementKey ? `rumor.${demand.randomEventKey}` : null,
    rumorRequirementKey: demand.rumorRequirementKey, rumorText: input.draft.randomEvents[index]!.rumorText,
    reliability: demand.rumorRequirementKey ? 'uncertain' as const : null, sourceClaimKeys: [...demand.sourceClaimKeys],
  }))
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
    },
    governance: {
      proseOwner: 'model-validated', referenceOwner: 'deterministic-compiler', currentAndPriorKnowledgeOnly: true,
      futureObjectiveSpoilersForbidden: true, everyObjectiveHasScene: true, everyActorHasDialogueEntry: true,
      everyLocationInteractionHasScene: true, everyDirectorEventHasPresentation: true,
      allTemplateVariantsFulfilled: true, actionResultsReferencedNotDuplicated: true,
    },
    basisHash: await hashProductProductionValueV2({
      contextSelectionHash: input.context.contextSelectionHash, sceneKeys: sceneRows.map(scene => scene.key),
      actionHashes: [...actionHashes.entries()], templateRequirements: input.context.templateVariantDemands.map(demand => demand.requirementKey),
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
  if (!same(sceneScripts.coverage.requiredTemplateVariantRequirementKeys, sceneScripts.coverage.fulfilledTemplateVariantRequirementKeys)
    || !same(sceneScripts.coverage.requiredRandomEventKeys, sceneScripts.randomEventPresentations.map(event => event.randomEventKey))
    || !same(actionBindings.coverage.requiredActionKeys, actionBindings.coverage.boundActionKeys)
    || !same(actionBindings.coverage.naturalLanguageEligibleActionKeys, actionBindings.coverage.naturalLanguageBoundActionKeys)) fail('P9 Scene/Template/Event/Action覆盖未闭合')
}

function draftFromArtifacts(artifacts: TextOpenWorldSceneScriptsArtifactsV1): unknown {
  const choiceByKey = new Map(artifacts.choiceContracts.choices.map(choice => [choice.key, choice]))
  const utterances = artifacts.actionBindings.actions.filter(binding => binding.naturalLanguage.mode === 'existing-action-candidate')
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
    projectId: input.projectId, requirementKey: input.requirementKey, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是已验签的P9输入合同：\n<scene-scripts-input>\n${input.contextText}\n</scene-scripts-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
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
    const context = await parseContext(execution.contextText); const prompt = prompts(context); const started = performance.now()
    const model = await runModel({
      projectId: execution.scope.projectId, requirementKey, category: SKILL_ID,
      system: `${prompt.system}\n${prompt.user}`, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (model.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(model.output, 'text-open-world-scene-scripts'), context)
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
        modelCalls: 1, inputTokens: model.usage?.inputTokens ?? estimateTokens(prompt.system + prompt.user + execution.contextText),
        outputTokens: model.usage?.outputTokens ?? estimateTokens(model.output), mediaCalls: 0, costUsd: null,
        durationMs, storageBytes: 0,
      },
      passedGateIds: [...execution.task.acceptanceGateIds],
    }
    return result
  }
}
