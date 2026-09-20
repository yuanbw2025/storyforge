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
  TextOpenWorldActionDefinitionV1,
  TextOpenWorldConditionDefinitionV1,
  TextOpenWorldContentRequirementManifestV1,
  TextOpenWorldCraftingEconomyCatalogV1,
  TextOpenWorldDirectorDecksV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEnemyEncounterCatalogV1,
  TextOpenWorldItemRewardCatalogV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldMapInteractionCatalogV1,
  TextOpenWorldNpcRuntimeCatalogV1,
  TextOpenWorldProgressionCatalogsV1,
  TextOpenWorldQuestBindingDefinitionKindV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldSignificantThreadsV1,
  WorkspaceScope,
} from '../types'
import { assertTextOpenWorldSceneDemandCapacityV1 } from './scene-demand-capacity'
import { assertRecordInScope } from '../workspace/scope'
import {
  compileTextOpenWorldSkillMechanicV2,
  compileTextOpenWorldStatusDefinitionV2,
} from './combat-mechanics-production'
import { validateTextOpenWorldKnowledgeProductionClosureV1 } from './knowledge-production'

const SKILL_ID = 'text-open-world.production.quest-finalize.v1'
const MAX_CONTEXT_CHARS = 700_000
const TRIGGERS = ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity'] as const
type TriggerKind = typeof TRIGGERS[number]
type DirectorKind = TextOpenWorldDirectorDecksV1['randomEvents'][number]['kind']

interface ObjectiveBindingDemandV1 {
  objectiveNumber: number
  objectiveKey: string
}

type KnowledgeConfirmationSourceKindV1 = 'quest-reward-claim' | 'ending-action'

interface KnowledgeConfirmationCandidateV1 {
  candidateNumber: number
  sourceKind: KnowledgeConfirmationSourceKindV1
  sourceKey: string
}

interface KnowledgeBindingDemandV1 {
  rumorNumber: number
  sourceRumorKey: string
  regionKey: string
  propagationLocationCandidates: Array<{
    candidateNumber: number
    locationKey: string
  }>
  confirmationCandidates: KnowledgeConfirmationCandidateV1[]
}

type EndingEligibilityCandidateKindV1 = 'quest-complete' | 'faction-affinity' | 'recipe-known'

interface EndingEligibilityCandidateV1 {
  candidateNumber: number
  kind: EndingEligibilityCandidateKindV1
  sourceKey: string
  title: string
  summary: string
  questType: 'significant' | 'ordinary' | null
  storylineKey: string | null
}

interface EndingEligibilityDemandV1 {
  endingNumber: number
  endingKey: string
  title: string
  eligiblePathSummary: string
  candidates: EndingEligibilityCandidateV1[]
}

type AchievementBindingCandidateV1 = KnowledgeConfirmationCandidateV1

export interface TextOpenWorldQuestFinalizeInputContextV1 {
  schema: 'storyforge.text-open-world-quest-finalize-input'
  version: 1
  productInstanceKey: string
  mainlineThread: TextOpenWorldMainlineThreadV1
  significantThreads: TextOpenWorldSignificantThreadsV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
  questSkeletons: TextOpenWorldQuestSkeletonsV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
  progressionCatalogs: TextOpenWorldProgressionCatalogsV1
  enemyEncounterCatalog: TextOpenWorldEnemyEncounterCatalogV1
  itemRewardCatalog: TextOpenWorldItemRewardCatalogV1
  craftingEconomyCatalog: TextOpenWorldCraftingEconomyCatalogV1
  npcRuntimeCatalog: TextOpenWorldNpcRuntimeCatalogV1
  mapInteractionCatalog: TextOpenWorldMapInteractionCatalogV1
  objectiveBindingDemands: ObjectiveBindingDemandV1[]
  /** Missing from the pre-G4-05 durable P8F context; omission compiles the legacy contract. */
  questLifecycleContract?: 'governed-v16'
  /** Missing from pre-G4-09 durable contexts; omission preserves v15/v16 combat bindings. */
  combatMechanicsContract?: 'governed-v17'
  /** Missing from pre-G4-11 durable contexts; omission preserves the legacy Knowledge path. */
  knowledgeProgressContract?: 'governed-v18'
  knowledgeBindingDemands?: KnowledgeBindingDemandV1[]
  achievementBindingCandidates?: AchievementBindingCandidateV1[]
  /** Missing from pre-G7 durable contexts; omission preserves the historical ending/consequence graph. */
  storyOutcomeContract?: 'governed-v19'
  endingEligibilityDemands?: EndingEligibilityDemandV1[]
  contextSelectionHash: string
}

type QuestFinalizeContextWithoutHashV1 = Omit<TextOpenWorldQuestFinalizeInputContextV1, 'contextSelectionHash'>

export interface TextOpenWorldQuestFinalizeArtifactsV1 {
  questDesignDocuments: TextOpenWorldQuestDesignDocumentsV1
  directorDecks: TextOpenWorldDirectorDecksV1
}

export interface TextOpenWorldQuestFinalizeModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldQuestFinalizeModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldQuestFinalizeModelExecutionV1>

interface QuestFinalizeDraftV1 {
  quests: Array<{ questNumber: number; description: string; tags: string[] }>
  objectives: Array<{
    objectiveNumber: number
    description: string
    successDescription: string
    timeCostMinutes: number
  }>
  decks: Array<{
    regionNumber: number
    triggerKinds: TriggerKind[]
    maximumRevealed: number
    maximumActive: number
    cooldownMinutes: number
    blankWeight: number
  }>
  templates: Array<{
    templateNumber: number
    category: TextOpenWorldDirectorDecksV1['templates'][number]['category']
    intensity: number
    weight: number
    cooldownMinutes: number
  }>
  randomEvents: Array<{
    seedNumber: number
    description: string
    kind: DirectorKind
    intensity: number
    weight: number
    cooldownMinutes: number
    upgradeTemplateNumber: number | null
  }>
  knowledgeSelections?: Array<{
    rumorNumber: number
    propagationLocationNumber: number
    confirmationCandidateNumbers: number[]
  }>
  achievementCandidateNumbers?: number[]
  endingEligibilitySelections?: Array<{
    endingNumber: number
    requiredQuestCandidateNumbers: number[]
    anyQuestCandidateGroups: number[][]
    requiredFactionAffinities: Array<{ candidateNumber: number; minimum: number }>
    requiredRecipeCandidateNumbers: number[]
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-quest-finalize] ${message}`) }
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
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}必须是${minimum}到${maximum}之间的整数`)
  return Number(value)
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label}不在允许闭集`)
  return value as T
}
function stringArray(value: unknown, label: string, maximum = 12): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}必须是最多${maximum}项数组`)
  const values = value.map((item, index) => text(item, `${label}[${index}]`, 120))
  if (new Set(values.map(item => item.toLocaleLowerCase('zh-CN'))).size !== values.length) fail(`${label}不能重复`)
  return values
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
function same(left: string[], right: string[]): boolean {
  return canonicalProductProductionJsonV2([...left].sort()) === canonicalProductProductionJsonV2([...right].sort())
}
function pushUnique<T extends { key: string }>(rows: T[], value: T, label: string): void {
  if (rows.some(row => row.key === value.key)) fail(`${label}稳定键重复:${value.key}`)
  rows.push(value)
}

function definitionsForRequirement(
  context: Omit<TextOpenWorldQuestFinalizeInputContextV1, 'objectiveBindingDemands' | 'contextSelectionHash'>,
  requirement: TextOpenWorldContentRequirementManifestV1['requirements'][number],
): { kind: TextOpenWorldQuestBindingDefinitionKindV1; keys: string[] } {
  const matched = <T extends { key: string; fulfilledRequirementKeys: string[] }>(rows: T[]) => rows
    .filter(row => row.fulfilledRequirementKeys.includes(requirement.key)).map(row => row.key)
  if (requirement.kind === 'actor') return { kind: 'actor', keys: matched(context.npcRuntimeCatalog.actors) }
  if (requirement.kind === 'faction') return { kind: 'faction', keys: matched(context.npcRuntimeCatalog.factions) }
  if (requirement.kind === 'enemy') return { kind: 'enemy', keys: matched(context.enemyEncounterCatalog.enemies) }
  if (requirement.kind === 'encounter') return { kind: 'encounter', keys: matched(context.enemyEncounterCatalog.encounters) }
  if (requirement.kind === 'item' || requirement.kind === 'equipment' || requirement.kind === 'material') {
    return { kind: 'item', keys: matched(context.itemRewardCatalog.items) }
  }
  if (requirement.kind === 'skill') return { kind: 'skill', keys: matched(context.progressionCatalogs.skills) }
  if (requirement.kind === 'recipe') return { kind: 'recipe', keys: matched(context.craftingEconomyCatalog.recipes) }
  if (requirement.kind === 'vendor') return { kind: 'vendor', keys: matched(context.craftingEconomyCatalog.vendors) }
  if (requirement.kind === 'reward') return { kind: 'reward', keys: matched(context.itemRewardCatalog.rewardContracts) }
  if (requirement.kind === 'location-interaction') return { kind: 'interaction', keys: matched(context.mapInteractionCatalog.interactions) }
  return { kind: 'action', keys: [] }
}

function buildObjectiveDemands(
  context: Omit<TextOpenWorldQuestFinalizeInputContextV1, 'objectiveBindingDemands' | 'contextSelectionHash'>,
): ObjectiveBindingDemandV1[] {
  return context.questSkeletons.objectives.map((objective, index) => ({
    objectiveNumber: index + 1,
    objectiveKey: objective.key,
  }))
}

type RegionRumorV1 = TextOpenWorldRegionNarrativePacksV1['packs'][number]['rumors'][number]
type GovernedRegionRumorV1 = RegionRumorV1 & {
  truthSummary: string
  reliability: 'uncertain' | 'likely' | 'confirmed'
  subjectKind: 'location' | 'actor' | 'faction' | 'lore' | 'quest-clue'
  subjectSourceKey: string | null
  minimumRevealGate: {
    kind: 'regional-public' | 'mainline-stage-complete' | 'significant-stage-complete'
    stageKey: string | null
  }
}

function governedRumor(value: RegionRumorV1): value is GovernedRegionRumorV1 {
  return typeof value.truthSummary === 'string'
    && ['uncertain', 'likely', 'confirmed'].includes(value.reliability ?? '')
    && ['location', 'actor', 'faction', 'lore', 'quest-clue'].includes(value.subjectKind ?? '')
    && (typeof value.subjectSourceKey === 'string' || value.subjectSourceKey === null)
    && value.minimumRevealGate != null
    && ['regional-public', 'mainline-stage-complete', 'significant-stage-complete'].includes(value.minimumRevealGate.kind)
    && (typeof value.minimumRevealGate.stageKey === 'string' || value.minimumRevealGate.stageKey === null)
}

function protectedQuestCandidates(context: QuestFinalizeContextWithoutHashV1): KnowledgeConfirmationCandidateV1[] {
  return context.questSkeletons.quests.filter(quest => (
    (quest.type === 'mainline' || quest.type === 'significant')
    && quest.lifecyclePlan.lifecyclePolicy === 'protected-wait'
    && !quest.lifecyclePlan.repeatable
    && context.itemRewardCatalog.rewardContracts.some(reward => reward.sourceKind === 'quest' && reward.sourceSemanticKey === quest.key)
  )).map(quest => ({
    candidateNumber: 0,
    sourceKind: 'quest-reward-claim' as const,
    sourceKey: quest.key,
  }))
}

function endingCandidates(context: QuestFinalizeContextWithoutHashV1): KnowledgeConfirmationCandidateV1[] {
  return [...context.mainlineThread.endingRoutes]
    .sort((left, right) => context.mainlineThread.thread.endingKeys.indexOf(left.endingKey)
      - context.mainlineThread.thread.endingKeys.indexOf(right.endingKey))
    .map(route => ({
      candidateNumber: 0,
      sourceKind: 'ending-action' as const,
      sourceKey: route.endingKey,
    }))
}

function numberedCandidates(values: KnowledgeConfirmationCandidateV1[]): KnowledgeConfirmationCandidateV1[] {
  const uniqueValues = values.filter((value, index) => values.findIndex(candidate => (
    candidate.sourceKind === value.sourceKind && candidate.sourceKey === value.sourceKey
  )) === index)
  return uniqueValues.map((value, index) => ({ ...value, candidateNumber: index + 1 }))
}

function confirmationCandidatesForRumor(input: {
  context: QuestFinalizeContextWithoutHashV1
  regionKey: string
  rumor: GovernedRegionRumorV1
}): KnowledgeConfirmationCandidateV1[] {
  const protectedQuests = protectedQuestCandidates(input.context)
  const endings = endingCandidates(input.context)
  const gate = input.rumor.minimumRevealGate
  let quests: KnowledgeConfirmationCandidateV1[] = []
  if (gate.kind === 'regional-public') {
    quests = protectedQuests.filter(candidate => input.context.questSkeletons.quests
      .find(quest => quest.key === candidate.sourceKey)?.regionKeys.includes(input.regionKey))
    if (!quests.length) quests = protectedQuests
  } else if (gate.kind === 'mainline-stage-complete') {
    const gateStage = input.context.mainlineThread.stages.find(stage => stage.key === gate.stageKey)
      ?? fail(`传闻主线门槛不存在:${input.rumor.key}`)
    quests = protectedQuests.filter(candidate => {
      const quest = input.context.questSkeletons.quests.find(item => item.key === candidate.sourceKey)
      const stage = quest?.source.kind === 'mainline-stage'
        ? input.context.mainlineThread.stages.find(item => item.key === quest.source.sourceKey)
        : null
      // The reward for the quest compiled from the gate stage is claimed only
      // after that quest has completed, so the gate stage itself is a valid
      // confirmation owner. Never require an artificial later mainline stage.
      return stage != null && stage.order >= gateStage.order
    })
  } else {
    const gateStage = input.context.significantThreads.stages.find(stage => stage.key === gate.stageKey)
      ?? fail(`传闻重要支线门槛不存在:${input.rumor.key}`)
    quests = protectedQuests.filter(candidate => {
      const quest = input.context.questSkeletons.quests.find(item => item.key === candidate.sourceKey)
      const stage = quest?.source.kind === 'significant-stage'
        ? input.context.significantThreads.stages.find(item => item.key === quest.source.sourceKey)
        : null
      return stage != null && stage.threadKey === gateStage.threadKey && stage.order >= gateStage.order
    })
  }
  // A global ending is not proof that an arbitrary significant thread reached
  // its gated stage. Significant rumors therefore stay confirmable only by a
  // reward in that same thread at or after the gate.
  const result = numberedCandidates([
    ...quests,
    ...(gate.kind === 'significant-stage-complete' ? [] : endings),
  ])
  if (!result.length) fail(`传闻缺少可保证到达的确认候选:${input.rumor.key}`)
  return result
}

function buildKnowledgeProductionDemands(context: QuestFinalizeContextWithoutHashV1): {
  governed: boolean
  knowledgeBindingDemands: KnowledgeBindingDemandV1[]
  achievementBindingCandidates: AchievementBindingCandidateV1[]
} {
  const rows = context.regionNarrativePacks.packs.flatMap(pack => pack.rumors.map(rumor => ({ pack, rumor })))
  const governedCount = rows.filter(row => governedRumor(row.rumor)).length
  const anyGovernedField = rows.some(({ rumor }) => rumor.truthSummary !== undefined
    || rumor.reliability !== undefined || rumor.subjectKind !== undefined
    || rumor.subjectSourceKey !== undefined || rumor.minimumRevealGate !== undefined)
  if (anyGovernedField && governedCount !== rows.length) fail('P7传闻治理字段只能全部存在或全部缺失')
  if (!rows.length || governedCount === 0) {
    return { governed: false, knowledgeBindingDemands: [], achievementBindingCandidates: [] }
  }
  const knowledgeBindingDemands = rows.map(({ pack, rumor }, index) => {
    if (!governedRumor(rumor)) fail(`P7传闻治理字段缺失:${rumor.key}`)
    const propagationLocationCandidates = context.mapInteractionCatalog.locations
      .filter(location => location.regionKey === pack.regionKey)
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      .map((location, locationIndex) => ({ candidateNumber: locationIndex + 1, locationKey: location.key }))
    if (!propagationLocationCandidates.length) fail(`传闻地区缺少传播地点:${rumor.key}`)
    return {
      rumorNumber: index + 1,
      sourceRumorKey: rumor.key,
      regionKey: pack.regionKey,
      propagationLocationCandidates,
      confirmationCandidates: confirmationCandidatesForRumor({ context, regionKey: pack.regionKey, rumor }),
    }
  })
  const achievementBindingCandidates = numberedCandidates([
    ...protectedQuestCandidates(context),
    ...endingCandidates(context),
  ])
  if (achievementBindingCandidates.length < 3
    || !achievementBindingCandidates.some(candidate => candidate.sourceKind === 'quest-reward-claim')
    || !achievementBindingCandidates.some(candidate => candidate.sourceKind === 'ending-action')) {
    fail('首版需要至少三个且同时覆盖受保护任务与结局的成就候选')
  }
  return { governed: true, knowledgeBindingDemands, achievementBindingCandidates }
}

function buildEndingEligibilityDemands(context: QuestFinalizeContextWithoutHashV1): EndingEligibilityDemandV1[] {
  const candidates: EndingEligibilityCandidateV1[] = []
  const addCandidate = (candidate: Omit<EndingEligibilityCandidateV1, 'candidateNumber'>) => {
    if (candidates.some(item => item.kind === candidate.kind && item.sourceKey === candidate.sourceKey)) return
    candidates.push({ ...candidate, candidateNumber: candidates.length + 1 })
  }
  for (const thread of context.significantThreads.threads) {
    const orderedStages = context.significantThreads.stages
      .filter(stage => stage.threadKey === thread.key)
      .sort((left, right) => left.order - right.order)
    const finalStage = orderedStages[orderedStages.length - 1] ?? fail(`重要故事线缺少最终阶段:${thread.key}`)
    const quest = context.questSkeletons.quests.find(item => (
      item.type === 'significant'
      && item.storylineKey === thread.key
      && item.source.kind === 'significant-stage'
      && item.source.sourceKey === finalStage.key
    )) ?? fail(`重要故事线最终阶段缺少任务骨架:${thread.key}`)
    addCandidate({
      kind: 'quest-complete', sourceKey: quest.key, title: quest.title,
      summary: `完成重要故事线“${thread.title}”的最终任务。`, questType: 'significant', storylineKey: thread.key,
    })
  }
  context.questSkeletons.quests
    .filter(quest => quest.type === 'ordinary' && quest.lifecyclePlan.instantiationPolicy === 'session-start')
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
    .forEach(quest => addCandidate({
      kind: 'quest-complete', sourceKey: quest.key, title: quest.title,
      summary: '完成一项发布时已存在、可以永久记录结果的普通支线。', questType: 'ordinary', storylineKey: quest.storylineKey,
    }))
  ;[...context.npcRuntimeCatalog.factions]
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
    .forEach(faction => addCandidate({
      kind: 'faction-affinity', sourceKey: faction.key, title: faction.title,
      summary: faction.publicGoal, questType: null, storylineKey: null,
    }))
  ;[...context.craftingEconomyCatalog.recipes]
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
    .forEach(recipe => addCandidate({
      kind: 'recipe-known', sourceKey: recipe.key, title: recipe.title,
      summary: recipe.description, questType: null, storylineKey: null,
    }))
  if (candidates.length < 2) fail('结局资格至少需要两个可区分的闭集候选')
  return [...context.mainlineThread.endingRoutes]
    .sort((left, right) => context.mainlineThread.thread.endingKeys.indexOf(left.endingKey)
      - context.mainlineThread.thread.endingKeys.indexOf(right.endingKey))
    .map((route, index) => ({
      endingNumber: index + 1,
      endingKey: route.endingKey,
      title: route.decisivePlayerValue,
      eligiblePathSummary: route.routeSummary,
      candidates: candidates.map(candidate => ({ ...candidate })),
    }))
}

async function validateUpstream(context: Omit<TextOpenWorldQuestFinalizeInputContextV1, 'contextSelectionHash'>): Promise<void> {
  if (context.questLifecycleContract !== undefined && context.questLifecycleContract !== 'governed-v16') {
    fail('Quest生命周期生产合同无效')
  }
  if (context.combatMechanicsContract !== undefined && context.combatMechanicsContract !== 'governed-v17') {
    fail('结构化战斗机制生产合同无效')
  }
  if (context.knowledgeProgressContract !== undefined && context.knowledgeProgressContract !== 'governed-v18') {
    fail('Knowledge进展生产合同无效')
  }
  if (context.storyOutcomeContract !== undefined && context.storyOutcomeContract !== 'governed-v19') {
    fail('重要故事后果与结局资格生产合同无效')
  }
  if (context.combatMechanicsContract === 'governed-v17'
    && context.progressionCatalogs.governance.structuredCombatSemanticsReady !== true) {
    fail('结构化战斗机制合同缺少已验收的P8语义')
  }
  const knowledgeProduction = buildKnowledgeProductionDemands(context)
  if (knowledgeProduction.governed !== (context.knowledgeProgressContract === 'governed-v18')) {
    fail('Knowledge进展合同与P7传闻治理状态不一致')
  }
  if (context.knowledgeProgressContract === 'governed-v18') {
    if (canonicalProductProductionJsonV2(context.knowledgeBindingDemands)
        !== canonicalProductProductionJsonV2(knowledgeProduction.knowledgeBindingDemands)
      || canonicalProductProductionJsonV2(context.achievementBindingCandidates)
        !== canonicalProductProductionJsonV2(knowledgeProduction.achievementBindingCandidates)) {
      fail('Knowledge/成就候选不是上游目录的确定性投影')
    }
  } else if (context.knowledgeBindingDemands !== undefined || context.achievementBindingCandidates !== undefined) {
    fail('历史P8F Context不能携带Knowledge/成就候选')
  }
  if (context.storyOutcomeContract === 'governed-v19') {
    const expectedDemands = buildEndingEligibilityDemands(context)
    if (canonicalProductProductionJsonV2(context.endingEligibilityDemands)
      !== canonicalProductProductionJsonV2(expectedDemands)) {
      fail('结局资格候选不是受治理上游目录的确定性投影')
    }
    for (const stage of context.significantThreads.stages) {
      for (const consequence of stage.localConsequencePlans) {
        if (consequence.runtimeBinding.status !== 'effect-unbound'
          || consequence.runtimeBinding.conditionKeys.length
          || consequence.runtimeBinding.effectKeys.length) {
          fail(`重要故事后果已经被上游越权绑定:${consequence.key}`)
        }
        if (consequence.direction === 'change') {
          fail(`重要故事后果必须明确增加或减少方向:${consequence.key}`)
        }
      }
    }
  } else if (context.endingEligibilityDemands !== undefined) {
    fail('历史P8F Context不能携带结局资格候选')
  }
  const artifacts: Array<[Record<string, unknown>, string, string]> = [
    [context.mainlineThread as unknown as Record<string, unknown>, 'mainlineThreadHash', 'MainlineThread'],
    [context.significantThreads as unknown as Record<string, unknown>, 'significantThreadsHash', 'SignificantThreads'],
    [context.regionNarrativePacks as unknown as Record<string, unknown>, 'regionNarrativePacksHash', 'RegionNarrativePacks'],
    [context.questSkeletons as unknown as Record<string, unknown>, 'questSkeletonsHash', 'QuestSkeletons'],
    [context.contentRequirementManifest as unknown as Record<string, unknown>, 'contentRequirementManifestHash', 'Manifest'],
    [context.progressionCatalogs as unknown as Record<string, unknown>, 'progressionCatalogsHash', 'ProgressionCatalogs'],
    [context.enemyEncounterCatalog as unknown as Record<string, unknown>, 'enemyEncounterCatalogHash', 'EncounterCatalog'],
    [context.itemRewardCatalog as unknown as Record<string, unknown>, 'itemRewardCatalogHash', 'ItemRewardCatalog'],
    [context.craftingEconomyCatalog as unknown as Record<string, unknown>, 'craftingEconomyCatalogHash', 'CraftingEconomyCatalog'],
    [context.npcRuntimeCatalog as unknown as Record<string, unknown>, 'npcRuntimeCatalogHash', 'NpcRuntimeCatalog'],
    [context.mapInteractionCatalog as unknown as Record<string, unknown>, 'mapInteractionCatalogHash', 'MapInteractionCatalog'],
  ]
  for (const [value, hashKey, label] of artifacts) await assertOwnHash(value, hashKey, label)
  const productValues = artifacts.map(([value]) => value.productInstanceKey)
  if (productValues.some(key => key !== context.productInstanceKey)
    || context.questSkeletons.mainlineThreadHash !== context.mainlineThread.mainlineThreadHash
    || context.questSkeletons.significantThreadsHash !== context.significantThreads.significantThreadsHash
    || context.questSkeletons.regionNarrativePacksHash !== context.regionNarrativePacks.regionNarrativePacksHash
    || context.contentRequirementManifest.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.progressionCatalogs.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.enemyEncounterCatalog.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.itemRewardCatalog.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.craftingEconomyCatalog.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.npcRuntimeCatalog.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash
    || context.mapInteractionCatalog.questSkeletonsHash !== context.questSkeletons.questSkeletonsHash) {
    fail('P8F上游身份或Hash链不一致')
  }
  const requirementManifestHash = context.contentRequirementManifest.contentRequirementManifestHash
  if ([
    context.progressionCatalogs.contentRequirementManifestHash,
    context.enemyEncounterCatalog.contentRequirementManifestHash,
    context.itemRewardCatalog.contentRequirementManifestHash,
    context.craftingEconomyCatalog.contentRequirementManifestHash,
    context.npcRuntimeCatalog.contentRequirementManifestHash,
    context.mapInteractionCatalog.contentRequirementManifestHash,
  ].some(hash => hash !== requirementManifestHash)
    || context.enemyEncounterCatalog.progressionCatalogsHash !== context.progressionCatalogs.progressionCatalogsHash
    || context.itemRewardCatalog.progressionCatalogsHash !== context.progressionCatalogs.progressionCatalogsHash
    || context.itemRewardCatalog.enemyEncounterCatalogHash !== context.enemyEncounterCatalog.enemyEncounterCatalogHash
    || context.craftingEconomyCatalog.itemRewardCatalogHash !== context.itemRewardCatalog.itemRewardCatalogHash
    || context.npcRuntimeCatalog.craftingEconomyCatalogHash !== context.craftingEconomyCatalog.craftingEconomyCatalogHash
    || context.enemyEncounterCatalog.playerBuildHash !== context.progressionCatalogs.playerBuildHash
    || context.itemRewardCatalog.playerBuildHash !== context.progressionCatalogs.playerBuildHash
    || [
      context.enemyEncounterCatalog.gameplayRulesetHash,
      context.itemRewardCatalog.gameplayRulesetHash,
      context.craftingEconomyCatalog.gameplayRulesetHash,
      context.npcRuntimeCatalog.gameplayRulesetHash,
    ].some(hash => hash !== context.progressionCatalogs.gameplayRulesetHash)
    || [
      context.enemyEncounterCatalog.regionNarrativePacksHash,
      context.craftingEconomyCatalog.regionNarrativePacksHash,
      context.npcRuntimeCatalog.regionNarrativePacksHash,
      context.mapInteractionCatalog.regionNarrativePacksHash,
    ].some(hash => hash !== context.regionNarrativePacks.regionNarrativePacksHash)) {
    fail('P8F Gameplay Catalog来源链不一致')
  }
  if (!context.questSkeletons.governance.allRuntimeBindingsUnbound
    || !context.progressionCatalogs.governance.allRuntimeBindingsUnbound
    || !context.itemRewardCatalog.governance.allRuntimeBindingsUnbound
    || !context.craftingEconomyCatalog.governance.allRuntimeBindingsUnbound
    || !context.mapInteractionCatalog.governance.allRuntimeBindingsUnbound
    || !context.npcRuntimeCatalog.governance.dialogueAndActionsDeferred
    || !context.enemyEncounterCatalog.governance.rewardsAndDropsDeferred) fail('P8F只能消费尚未跨模块绑定的目录')
  for (const requirement of context.contentRequirementManifest.requirements) {
    const resolved = definitionsForRequirement(context, requirement)
    if (requirement.kind !== 'action' && resolved.keys.length < requirement.minimumCount) fail(`内容需求没有足量真实定义:${requirement.key}`)
  }
  const expectedDemands = buildObjectiveDemands(context)
  if (canonicalProductProductionJsonV2(expectedDemands) !== canonicalProductProductionJsonV2(context.objectiveBindingDemands)) {
    fail('objectiveBindingDemands不是上游目录的确定性投影')
  }
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldQuestFinalizeInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId),
    readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const keys = [
    'text-open-world.mainline-thread', 'text-open-world.significant-threads', 'text-open-world.region-narrative-packs',
    'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
    'text-open-world.progression-catalogs', 'text-open-world.enemy-encounter-catalog', 'text-open-world.item-reward-catalog',
    'text-open-world.crafting-economy-catalog', 'text-open-world.npc-runtime-catalog', 'text-open-world.map-interaction-catalog',
  ] as const
  const selected = Object.fromEntries(keys.map(key => [key, unique(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const values = keys.map(key => artifact<unknown>(selected[key], key))
  for (let index = 0; index < keys.length; index += 1) {
    if (await hashProductProductionValueV2(values[index]) !== selected[keys[index]].contentHash) fail(`Artifact行Hash不匹配:${keys[index]}`)
  }
  const base = {
    schema: 'storyforge.text-open-world-quest-finalize-input' as const, version: 1 as const,
    productInstanceKey: production.productionKey,
    mainlineThread: values[0] as TextOpenWorldMainlineThreadV1,
    significantThreads: values[1] as TextOpenWorldSignificantThreadsV1,
    regionNarrativePacks: values[2] as TextOpenWorldRegionNarrativePacksV1,
    questSkeletons: values[3] as TextOpenWorldQuestSkeletonsV1,
    contentRequirementManifest: values[4] as TextOpenWorldContentRequirementManifestV1,
    progressionCatalogs: values[5] as TextOpenWorldProgressionCatalogsV1,
    enemyEncounterCatalog: values[6] as TextOpenWorldEnemyEncounterCatalogV1,
    itemRewardCatalog: values[7] as TextOpenWorldItemRewardCatalogV1,
    craftingEconomyCatalog: values[8] as TextOpenWorldCraftingEconomyCatalogV1,
    npcRuntimeCatalog: values[9] as TextOpenWorldNpcRuntimeCatalogV1,
    mapInteractionCatalog: values[10] as TextOpenWorldMapInteractionCatalogV1,
  }
  const body: Omit<TextOpenWorldQuestFinalizeInputContextV1, 'contextSelectionHash'> = {
    ...base,
    objectiveBindingDemands: buildObjectiveDemands(base),
    questLifecycleContract: 'governed-v16',
    ...(base.progressionCatalogs.governance.structuredCombatSemanticsReady === true
      ? { combatMechanicsContract: 'governed-v17' as const }
      : {}),
  }
  const knowledgeProduction = buildKnowledgeProductionDemands(body)
  if (knowledgeProduction.governed) {
    body.knowledgeProgressContract = 'governed-v18'
    body.knowledgeBindingDemands = knowledgeProduction.knowledgeBindingDemands
    body.achievementBindingCandidates = knowledgeProduction.achievementBindingCandidates
  }
  body.storyOutcomeContract = 'governed-v19'
  body.endingEligibilityDemands = buildEndingEligibilityDemands(body)
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('QuestFinalize Context超过硬上限')
  return context
}

export async function readTextOpenWorldQuestFinalizeInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadContext({ scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId! }))
}

async function parseContext(value: string): Promise<TextOpenWorldQuestFinalizeInputContextV1> {
  let context: TextOpenWorldQuestFinalizeInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldQuestFinalizeInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-quest-finalize-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context
  await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldQuestFinalizeInputContextV1): QuestFinalizeDraftV1 {
  const root = record(value, 'draft')
  const governedKnowledge = context.knowledgeProgressContract === 'governed-v18'
  const governedStoryOutcome = context.storyOutcomeContract === 'governed-v19'
  const hasKnowledgeSelections = Object.prototype.hasOwnProperty.call(root, 'knowledgeSelections')
  const hasAchievementSelections = Object.prototype.hasOwnProperty.call(root, 'achievementCandidateNumbers')
  if (governedKnowledge && hasKnowledgeSelections !== hasAchievementSelections) {
    fail('Knowledge与成就模型选择字段必须同时存在或同时缺失')
  }
  const explicitKnowledgeSelections = governedKnowledge && hasKnowledgeSelections && hasAchievementSelections
  exactKeys(root, [
    'schema', 'version', 'quests', 'objectives', 'decks', 'templates', 'randomEvents',
    ...(explicitKnowledgeSelections ? ['knowledgeSelections', 'achievementCandidateNumbers'] : []),
    ...(governedStoryOutcome ? ['endingEligibilitySelections'] : []),
  ], 'draft')
  if (root.schema !== 'storyforge.text-open-world-quest-finalize-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.quests) || root.quests.length !== context.questSkeletons.quests.length) fail(`quests必须与${context.questSkeletons.quests.length}项骨架一一对应`)
  const quests = root.quests.map((value, index) => {
    const row = record(value, `quests[${index}]`); exactKeys(row, ['questNumber', 'description', 'tags'], `quests[${index}]`)
    return {
      questNumber: integer(row.questNumber, `quests[${index}].questNumber`, 1, context.questSkeletons.quests.length),
      description: text(row.description, `quests[${index}].description`), tags: stringArray(row.tags, `quests[${index}].tags`, 8),
    }
  })
  if (quests.some((quest, index) => quest.questNumber !== index + 1)) fail('quests必须按序精确覆盖')
  if (!Array.isArray(root.objectives) || root.objectives.length !== context.objectiveBindingDemands.length) fail(`objectives必须与${context.objectiveBindingDemands.length}项目标一一对应`)
  const objectives = root.objectives.map((value, index) => {
    const row = record(value, `objectives[${index}]`)
    exactKeys(row, ['objectiveNumber', 'description', 'successDescription', 'timeCostMinutes'], `objectives[${index}]`)
    return {
      objectiveNumber: integer(row.objectiveNumber, `objectives[${index}].objectiveNumber`, 1, context.objectiveBindingDemands.length),
      description: text(row.description, `objectives[${index}].description`),
      successDescription: text(row.successDescription, `objectives[${index}].successDescription`),
      timeCostMinutes: integer(row.timeCostMinutes, `objectives[${index}].timeCostMinutes`, 0, 60),
    }
  })
  if (objectives.some((objective, index) => objective.objectiveNumber !== index + 1)) fail('objectives必须按序精确覆盖')
  if (!Array.isArray(root.decks) || root.decks.length !== context.mapInteractionCatalog.regions.length) fail('decks必须逐地区覆盖')
  const decks = root.decks.map((value, index) => {
    const row = record(value, `decks[${index}]`)
    exactKeys(row, ['regionNumber', 'triggerKinds', 'maximumRevealed', 'maximumActive', 'cooldownMinutes', 'blankWeight'], `decks[${index}]`)
    const triggerKinds = stringArray(row.triggerKinds, `decks[${index}].triggerKinds`, TRIGGERS.length)
      .map((trigger, triggerIndex) => enumValue(trigger, TRIGGERS, `decks[${index}].triggerKinds[${triggerIndex}]`))
    if (!triggerKinds.length) fail(`decks[${index}]至少需要一种触发`)
    const maximumRevealed = integer(row.maximumRevealed, `decks[${index}].maximumRevealed`, 1, 4)
    const maximumActive = integer(row.maximumActive, `decks[${index}].maximumActive`, 1, 3)
    if (maximumActive > maximumRevealed) fail(`decks[${index}] active不能超过revealed`)
    return {
      regionNumber: integer(row.regionNumber, `decks[${index}].regionNumber`, 1, context.mapInteractionCatalog.regions.length),
      triggerKinds, maximumRevealed, maximumActive,
      cooldownMinutes: integer(row.cooldownMinutes, `decks[${index}].cooldownMinutes`, 60, 1_440),
      blankWeight: integer(row.blankWeight, `decks[${index}].blankWeight`, 1, 100),
    }
  })
  if (decks.some((deck, index) => deck.regionNumber !== index + 1)) fail('decks必须按地区顺序精确覆盖')
  if (governedKnowledge) {
    const knowledgeRegionKeys = new Set((context.knowledgeBindingDemands ?? []).map(demand => demand.regionKey))
    decks.forEach((deck, index) => {
      const region = context.mapInteractionCatalog.regions[index]!
      if (knowledgeRegionKeys.has(region.key)
        && !deck.triggerKinds.includes('rest')) {
        fail(`decks[${index}]承载Knowledge传播时必须包含编译器保证可达的rest触发`)
      }
    })
  }
  const templateQuests = context.questSkeletons.quests.filter(quest => quest.type === 'template')
  if (!Array.isArray(root.templates) || root.templates.length !== templateQuests.length) fail('templates必须逐模板任务覆盖')
  const categories = ['help', 'resource', 'exploration', 'conflict', 'mystery'] as const
  const templates = root.templates.map((value, index) => {
    const row = record(value, `templates[${index}]`)
    exactKeys(row, ['templateNumber', 'category', 'intensity', 'weight', 'cooldownMinutes'], `templates[${index}]`)
    return {
      templateNumber: integer(row.templateNumber, `templates[${index}].templateNumber`, 1, templateQuests.length),
      category: enumValue(row.category, categories, `templates[${index}].category`),
      intensity: integer(row.intensity, `templates[${index}].intensity`, 1, 6),
      weight: integer(row.weight, `templates[${index}].weight`, 1, 100),
      cooldownMinutes: integer(row.cooldownMinutes, `templates[${index}].cooldownMinutes`, 60, 10_080),
    }
  })
  if (templates.some((template, index) => template.templateNumber !== index + 1)) fail('templates必须按序精确覆盖')
  const eventSeeds = context.regionNarrativePacks.packs.flatMap(pack => pack.randomEventSeeds.map(seed => ({ pack, seed })))
  if (!Array.isArray(root.randomEvents) || root.randomEvents.length !== eventSeeds.length) fail('randomEvents必须逐地区事件种子覆盖')
  const eventKinds = ['atmosphere', 'resource', 'encounter', 'clue', 'quest-upgrade'] as const
  const randomEvents = root.randomEvents.map((value, index) => {
    const row = record(value, `randomEvents[${index}]`)
    exactKeys(row, ['seedNumber', 'description', 'kind', 'intensity', 'weight', 'cooldownMinutes', 'upgradeTemplateNumber'], `randomEvents[${index}]`)
    const seedNumber = integer(row.seedNumber, `randomEvents[${index}].seedNumber`, 1, eventSeeds.length)
    const source = eventSeeds[seedNumber - 1]!
    const regionTemplateIndexes = templateQuests.flatMap((quest, templateIndex) => quest.regionKeys.includes(source.pack.regionKey) ? [templateIndex + 1] : [])
    const upgradeTemplateNumber = row.upgradeTemplateNumber === null ? null
      : integer(row.upgradeTemplateNumber, `randomEvents[${index}].upgradeTemplateNumber`, 1, templateQuests.length)
    const kind = enumValue(row.kind, eventKinds, `randomEvents[${index}].kind`)
    if (governedKnowledge && kind === 'clue') fail(`randomEvents[${index}]不能绕过P7传闻绑定创建线索`)
    if ((kind === 'quest-upgrade') !== (upgradeTemplateNumber !== null)
      || (upgradeTemplateNumber !== null && !regionTemplateIndexes.includes(upgradeTemplateNumber))) fail(`randomEvents[${index}]升级模板与地区或类型不一致`)
    if (kind === 'resource' && !context.itemRewardCatalog.items.some(item => item.kind === 'material' && !item.critical)) {
      fail(`randomEvents[${index}]资源事件缺少非关键材料定义`)
    }
    if (kind === 'encounter' && !context.enemyEncounterCatalog.encounters.some(encounter => encounter.regionKey === source.pack.regionKey)) {
      fail(`randomEvents[${index}]遭遇事件缺少本地区遭遇定义`)
    }
    return {
      seedNumber, description: text(row.description, `randomEvents[${index}].description`), kind,
      intensity: integer(row.intensity, `randomEvents[${index}].intensity`, 1, 6),
      weight: integer(row.weight, `randomEvents[${index}].weight`, 1, 100),
      cooldownMinutes: integer(row.cooldownMinutes, `randomEvents[${index}].cooldownMinutes`, 60, 10_080),
      upgradeTemplateNumber,
    }
  })
  if (randomEvents.some((event, index) => event.seedNumber !== index + 1)) fail('randomEvents必须按序精确覆盖')
  const baseDraft: QuestFinalizeDraftV1 = { quests, objectives, decks, templates, randomEvents }
  if (governedStoryOutcome) {
    const demands = context.endingEligibilityDemands ?? fail('结局资格选择缺少候选合同')
    if (!Array.isArray(root.endingEligibilitySelections)
      || root.endingEligibilitySelections.length !== demands.length) {
      fail(`endingEligibilitySelections必须与${demands.length}个结局一一对应`)
    }
    const numberArray = (candidateValue: unknown, label: string, maximum: number): number[] => {
      if (!Array.isArray(candidateValue) || candidateValue.length > maximum) fail(`${label}必须是最多${maximum}项数组`)
      const values = candidateValue.map((item, index) => integer(item, `${label}[${index}]`, 1, maximum))
      if (new Set(values).size !== values.length
        || values.some((number, index) => index > 0 && number <= values[index - 1]!)) {
        fail(`${label}必须严格升序且不重复`)
      }
      return values
    }
    const endingEligibilitySelections = root.endingEligibilitySelections.map((value, index) => {
      const row = record(value, `endingEligibilitySelections[${index}]`)
      exactKeys(row, [
        'endingNumber', 'requiredQuestCandidateNumbers', 'anyQuestCandidateGroups',
        'requiredFactionAffinities', 'requiredRecipeCandidateNumbers',
      ], `endingEligibilitySelections[${index}]`)
      const demand = demands[index]!
      const endingNumber = integer(row.endingNumber, `endingEligibilitySelections[${index}].endingNumber`, 1, demands.length)
      if (endingNumber !== index + 1 || endingNumber !== demand.endingNumber) {
        fail('endingEligibilitySelections必须按结局顺序精确覆盖')
      }
      const requiredQuestCandidateNumbers = numberArray(
        row.requiredQuestCandidateNumbers,
        `endingEligibilitySelections[${index}].requiredQuestCandidateNumbers`,
        demand.candidates.length,
      )
      if (!Array.isArray(row.anyQuestCandidateGroups) || row.anyQuestCandidateGroups.length > 4) {
        fail(`endingEligibilitySelections[${index}].anyQuestCandidateGroups必须是最多4组数组`)
      }
      const anyQuestCandidateGroups = row.anyQuestCandidateGroups.map((group, groupIndex) => {
        const values = numberArray(
          group,
          `endingEligibilitySelections[${index}].anyQuestCandidateGroups[${groupIndex}]`,
          demand.candidates.length,
        )
        if (values.length < 2) fail(`endingEligibilitySelections[${index}]任一任务组至少需要两个替代候选`)
        return values
      })
      if (!Array.isArray(row.requiredFactionAffinities)
        || row.requiredFactionAffinities.length > demand.candidates.length) {
        fail(`endingEligibilitySelections[${index}].requiredFactionAffinities无效`)
      }
      const requiredFactionAffinities = row.requiredFactionAffinities.map((value, affinityIndex) => {
        const affinity = record(value, `endingEligibilitySelections[${index}].requiredFactionAffinities[${affinityIndex}]`)
        exactKeys(affinity, ['candidateNumber', 'minimum'], `endingEligibilitySelections[${index}].requiredFactionAffinities[${affinityIndex}]`)
        const minimum = integer(
          affinity.minimum,
          `endingEligibilitySelections[${index}].requiredFactionAffinities[${affinityIndex}].minimum`,
          context.npcRuntimeCatalog.relationshipPolicy.factionAffinity.minimum,
          context.npcRuntimeCatalog.relationshipPolicy.factionAffinity.maximum,
        )
        if (minimum <= context.npcRuntimeCatalog.relationshipPolicy.factionAffinity.initial) {
          fail(`endingEligibilitySelections[${index}]阵营资格必须高于初始亲合度`)
        }
        return {
          candidateNumber: integer(
            affinity.candidateNumber,
            `endingEligibilitySelections[${index}].requiredFactionAffinities[${affinityIndex}].candidateNumber`,
            1,
            demand.candidates.length,
          ),
          minimum,
        }
      })
      if (new Set(requiredFactionAffinities.map(item => item.candidateNumber)).size !== requiredFactionAffinities.length
        || requiredFactionAffinities.some((item, affinityIndex) => affinityIndex > 0
          && item.candidateNumber <= requiredFactionAffinities[affinityIndex - 1]!.candidateNumber)) {
        fail(`endingEligibilitySelections[${index}]阵营亲和候选必须严格升序且不重复`)
      }
      const requiredRecipeCandidateNumbers = numberArray(
        row.requiredRecipeCandidateNumbers,
        `endingEligibilitySelections[${index}].requiredRecipeCandidateNumbers`,
        demand.candidates.length,
      )
      const questNumbers = [requiredQuestCandidateNumbers, ...anyQuestCandidateGroups].flat()
      if (questNumbers.some(number => demand.candidates[number - 1]?.kind !== 'quest-complete')) {
        fail(`endingEligibilitySelections[${index}]任务资格引用了错误候选类型`)
      }
      if (requiredFactionAffinities.some(item => demand.candidates[item.candidateNumber - 1]?.kind !== 'faction-affinity')) {
        fail(`endingEligibilitySelections[${index}]阵营资格引用了错误候选类型`)
      }
      if (requiredRecipeCandidateNumbers.some(number => demand.candidates[number - 1]?.kind !== 'recipe-known')) {
        fail(`endingEligibilitySelections[${index}]配方资格引用了错误候选类型`)
      }
      const allCandidateNumbers = [
        ...questNumbers,
        ...requiredFactionAffinities.map(item => item.candidateNumber),
        ...requiredRecipeCandidateNumbers,
      ]
      if (!allCandidateNumbers.length) fail(`endingEligibilitySelections[${index}]必须至少选择一项路线资格`)
      if (new Set(allCandidateNumbers).size !== allCandidateNumbers.length) {
        fail(`endingEligibilitySelections[${index}]同一候选不能重复承担路线资格`)
      }
      return {
        endingNumber, requiredQuestCandidateNumbers, anyQuestCandidateGroups,
        requiredFactionAffinities, requiredRecipeCandidateNumbers,
      }
    })
    const signatures = endingEligibilitySelections.map(selection => canonicalProductProductionJsonV2({
      requiredQuestCandidateNumbers: selection.requiredQuestCandidateNumbers,
      anyQuestCandidateGroups: selection.anyQuestCandidateGroups,
      requiredFactionAffinities: selection.requiredFactionAffinities,
      requiredRecipeCandidateNumbers: selection.requiredRecipeCandidateNumbers,
    }))
    if (new Set(signatures).size !== signatures.length) fail('每个结局必须拥有可区分的路线资格')
    baseDraft.endingEligibilitySelections = endingEligibilitySelections
  }
  if (!governedKnowledge) return baseDraft
  const demands = context.knowledgeBindingDemands ?? fail('Knowledge选择缺少候选合同')
  if (!explicitKnowledgeSelections) {
    const achievementCandidates = context.achievementBindingCandidates ?? fail('成就选择缺少候选合同')
    const firstQuest = achievementCandidates.find(candidate => candidate.sourceKind === 'quest-reward-claim')
      ?? fail('成就默认选择缺少任务来源')
    const firstEnding = achievementCandidates.find(candidate => candidate.sourceKind === 'ending-action')
      ?? fail('成就默认选择缺少结局来源')
    const achievementCandidateNumbers = [firstQuest.candidateNumber, firstEnding.candidateNumber]
    for (const candidate of achievementCandidates) {
      if (achievementCandidateNumbers.length >= 3) break
      if (!achievementCandidateNumbers.includes(candidate.candidateNumber)) achievementCandidateNumbers.push(candidate.candidateNumber)
    }
    achievementCandidateNumbers.sort((left, right) => left - right)
    return {
      ...baseDraft,
      knowledgeSelections: demands.map(demand => ({
        rumorNumber: demand.rumorNumber,
        propagationLocationNumber: 1,
        confirmationCandidateNumbers: [1],
      })),
      achievementCandidateNumbers,
    }
  }
  if (!Array.isArray(root.knowledgeSelections) || root.knowledgeSelections.length !== demands.length) {
    fail(`knowledgeSelections必须与${demands.length}条传闻一一对应`)
  }
  const knowledgeSelections = root.knowledgeSelections.map((value, index) => {
    const row = record(value, `knowledgeSelections[${index}]`)
    exactKeys(row, ['rumorNumber', 'propagationLocationNumber', 'confirmationCandidateNumbers'], `knowledgeSelections[${index}]`)
    const demand = demands[index]!
    const rumorNumber = integer(row.rumorNumber, `knowledgeSelections[${index}].rumorNumber`, 1, demands.length)
    if (rumorNumber !== index + 1 || rumorNumber !== demand.rumorNumber) fail('knowledgeSelections必须按传闻顺序精确覆盖')
    const propagationLocationNumber = integer(
      row.propagationLocationNumber,
      `knowledgeSelections[${index}].propagationLocationNumber`,
      1,
      demand.propagationLocationCandidates.length,
    )
    if (!Array.isArray(row.confirmationCandidateNumbers)
      || row.confirmationCandidateNumbers.length < 1 || row.confirmationCandidateNumbers.length > 3) {
      fail(`knowledgeSelections[${index}]必须选择1到3个确认候选`)
    }
    const confirmationCandidateNumbers = row.confirmationCandidateNumbers.map((value, candidateIndex) => integer(
      value,
      `knowledgeSelections[${index}].confirmationCandidateNumbers[${candidateIndex}]`,
      1,
      demand.confirmationCandidates.length,
    ))
    if (new Set(confirmationCandidateNumbers).size !== confirmationCandidateNumbers.length
      || confirmationCandidateNumbers.some((number, candidateIndex) => candidateIndex > 0 && number <= confirmationCandidateNumbers[candidateIndex - 1]!)) {
      fail(`knowledgeSelections[${index}]确认候选必须严格升序且不重复`)
    }
    return { rumorNumber, propagationLocationNumber, confirmationCandidateNumbers }
  })
  const achievementCandidates = context.achievementBindingCandidates ?? fail('成就选择缺少候选合同')
  if (!Array.isArray(root.achievementCandidateNumbers)
    || root.achievementCandidateNumbers.length < 3 || root.achievementCandidateNumbers.length > 6) {
    fail('achievementCandidateNumbers必须选择3到6个候选')
  }
  const achievementCandidateNumbers = root.achievementCandidateNumbers.map((value, index) => integer(
    value,
    `achievementCandidateNumbers[${index}]`,
    1,
    achievementCandidates.length,
  ))
  if (new Set(achievementCandidateNumbers).size !== achievementCandidateNumbers.length
    || achievementCandidateNumbers.some((number, index) => index > 0 && number <= achievementCandidateNumbers[index - 1]!)) {
    fail('achievementCandidateNumbers必须严格升序且不重复')
  }
  const selectedAchievements = achievementCandidateNumbers.map(number => achievementCandidates[number - 1]!)
  if (!selectedAchievements.some(candidate => candidate.sourceKind === 'quest-reward-claim')
    || !selectedAchievements.some(candidate => candidate.sourceKind === 'ending-action')) {
    fail('首版成就必须同时覆盖受保护任务与结局')
  }
  return { ...baseDraft, knowledgeSelections, achievementCandidateNumbers }
}

function action(input: Partial<TextOpenWorldActionDefinitionV1> & Pick<TextOpenWorldActionDefinitionV1, 'key' | 'category' | 'label' | 'description'>): TextOpenWorldActionDefinitionV1 {
  return {
    actorScope: 'player', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0, confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    ...input,
  }
}

export type TextOpenWorldQuestFinalizeRuntimeItemInputV1 = Pick<
  TextOpenWorldItemRewardCatalogV1['items'][number],
  'key' | 'title' | 'description' | 'kind' | 'consumable' | 'critical' | 'droppable'
>

export interface TextOpenWorldQuestFinalizeItemRuntimeContractV1 {
  conditions: TextOpenWorldConditionDefinitionV1[]
  effects: TextOpenWorldEffectDefinitionV1[]
  actions: TextOpenWorldActionDefinitionV1[]
  binding: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['items'][number]
}

/** Deterministic P8F item contract. No model-authored Action/Condition/Effect is accepted here. */
export function compileTextOpenWorldQuestFinalizeItemRuntimeContractV1(
  item: TextOpenWorldQuestFinalizeRuntimeItemInputV1,
): TextOpenWorldQuestFinalizeItemRuntimeContractV1 {
  const conditions: TextOpenWorldConditionDefinitionV1[] = []
  const effects: TextOpenWorldEffectDefinitionV1[] = []
  const actions: TextOpenWorldActionDefinitionV1[] = []
  let useActionKey: string | null = null
  let equipActionKey: string | null = null
  let unequipActionKey: string | null = null
  const equipConditionKeys: string[] = []
  const itemEffectKeys: string[] = []

  if (item.consumable) {
    useActionKey = `action.use.${item.key}`
    const usableCondition = `condition.use.${item.key}.health-below-maximum`
    const consume = `effect.use.${item.key}.consume`
    const restore = `effect.use.${item.key}.restore`
    conditions.push({
      key: usableCondition,
      expression: { op: 'player-resource-below-maximum', resource: 'health' },
      failureMessage: '生命已经满了。',
    })
    effects.push(
      { key: consume, operation: 'remove-item', payload: { itemKey: item.key, quantity: 1, reason: 'consume' } },
      { key: restore, operation: 'change-player-resource', payload: { resource: 'health', amount: 10 } },
    )
    itemEffectKeys.push(restore)
    actions.push(
      action({
        key: useActionKey, category: 'use', label: `使用${item.title}`, description: item.description,
        targetScope: 'item', requirementConditionKeys: [usableCondition], costEffectKeys: [consume], successEffectKeys: [restore],
      }),
      action({
        key: `action.combat.item.${item.key}`, category: 'combat-item', label: `战斗中使用${item.title}`, description: item.description,
        targetScope: 'item', requirementConditionKeys: [usableCondition], costEffectKeys: [consume],
        successEffectKeys: [restore, `effect.combat.item.${item.key}`],
      }),
    )
    effects.push({
      key: `effect.combat.item.${item.key}`,
      operation: 'perform-combat-action',
      payload: { kind: 'item', skillKey: null, itemKey: item.key },
    })
  }

  if (item.kind === 'equipment') {
    equipActionKey = `action.equip.${item.key}`
    unequipActionKey = `action.unequip.${item.key}`
    const equipCondition = `condition.equip.${item.key}.not-equipped`
    const unequipCondition = `condition.unequip.${item.key}.equipped`
    const equip = `effect.equip.${item.key}`
    const unequip = `effect.unequip.${item.key}`
    equipConditionKeys.push(equipCondition)
    conditions.push(
      { key: equipCondition, expression: { op: 'inventory-equipped', itemKey: item.key, equipped: false }, failureMessage: '该物品已经装备。' },
      { key: unequipCondition, expression: { op: 'inventory-equipped', itemKey: item.key, equipped: true }, failureMessage: '该物品当前未装备。' },
    )
    effects.push(
      { key: equip, operation: 'equip-item', payload: { itemKey: item.key } },
      { key: unequip, operation: 'unequip-item', payload: { itemKey: item.key } },
    )
    actions.push(
      action({
        key: equipActionKey, category: 'equip', label: `装备${item.title}`, description: item.description,
        targetScope: 'item', requirementConditionKeys: [equipCondition], successEffectKeys: [equip],
      }),
      action({
        key: unequipActionKey, category: 'unequip', label: `卸下${item.title}`, description: item.description,
        targetScope: 'item', requirementConditionKeys: [unequipCondition], successEffectKeys: [unequip],
      }),
    )
  }

  if (item.droppable && !item.critical) {
    const remove = `effect.drop.${item.key}.remove`
    effects.push({ key: remove, operation: 'remove-item', payload: { itemKey: item.key, quantity: 1, reason: 'drop' } })
    actions.push(action({
      key: `action.drop.${item.key}`, category: 'drop', label: `丢弃${item.title}`,
      description: `从背包中丢弃一件${item.title}。`, targetScope: 'item', costEffectKeys: [remove], confirmationPolicy: 'always',
    }))
  }

  return {
    conditions,
    effects,
    actions,
    binding: { itemKey: item.key, useActionKey, equipActionKey, unequipActionKey, equipConditionKeys, effectKeys: itemEffectKeys },
  }
}

export function deriveTextOpenWorldQuestUnlockConditionV1(input: {
  quest: TextOpenWorldQuestSkeletonsV1['quests'][number]
  context: TextOpenWorldQuestFinalizeInputContextV1
}): TextOpenWorldConditionDefinitionV1 | null {
  if (input.quest.type === 'mainline') {
    const stageOrder = new Map(input.context.mainlineThread.stages.map(stage => [stage.key, stage.order]))
    const mainQuests = input.context.questSkeletons.quests
      .filter(quest => quest.type === 'mainline')
      .sort((left, right) => (stageOrder.get(left.source.sourceKey) ?? Number.MAX_SAFE_INTEGER)
        - (stageOrder.get(right.source.sourceKey) ?? Number.MAX_SAFE_INTEGER)
        || left.key.localeCompare(right.key))
    const index = mainQuests.findIndex(quest => quest.key === input.quest.key)
    if (index < 0) fail(`主线任务没有来源Stage:${input.quest.key}`)
    if (index === 0) return null
    return {
      key: `condition.unlock.${input.quest.key}`,
      expression: { op: 'quest-status', questKey: mainQuests[index - 1]!.key, statuses: ['completed'] },
      failureMessage: '需要先完成上一项主线任务。',
    }
  }
  if (input.quest.type === 'significant') {
    const sourceStage = input.context.significantThreads.stages.find(stage => stage.key === input.quest.source.sourceKey)
    const thread = sourceStage ? input.context.significantThreads.threads.find(item => item.key === sourceStage.threadKey) : null
    if (!sourceStage || !thread || input.quest.storylineKey !== thread.key) {
      fail(`重要任务没有唯一所属故事线:${input.quest.key}`)
    }
    const sameThreadQuests = input.context.questSkeletons.quests
      .filter(quest => quest.type === 'significant' && quest.storylineKey === thread.key)
      .sort((left, right) => {
        const leftOrder = input.context.significantThreads.stages.find(stage => stage.key === left.source.sourceKey)?.order
          ?? Number.MAX_SAFE_INTEGER
        const rightOrder = input.context.significantThreads.stages.find(stage => stage.key === right.source.sourceKey)?.order
          ?? Number.MAX_SAFE_INTEGER
        return leftOrder - rightOrder || left.key.localeCompare(right.key)
      })
    const index = sameThreadQuests.findIndex(quest => quest.key === input.quest.key)
    if (index < 0) fail(`重要任务没有来源Stage:${input.quest.key}`)
    if (index > 0) {
      return {
        key: `condition.unlock.${input.quest.key}`,
        expression: { op: 'quest-status', questKey: sameThreadQuests[index - 1]!.key, statuses: ['completed'] },
        failureMessage: '需要先完成这条重要故事的上一阶段。',
      }
    }
    const mainlineStage = thread
      ? input.context.mainlineThread.stages.find(stage => stage.key === thread.mainlineCompatibility.availableAfterStageKey)
      : null
    const mainQuest = mainlineStage
      ? input.context.questSkeletons.quests.find(quest => quest.type === 'mainline' && quest.source.sourceKey === mainlineStage.key)
      : null
    if (!mainQuest) fail(`重要任务缺少主线揭示窗口:${input.quest.key}`)
    return {
      key: `condition.unlock.${input.quest.key}`,
      expression: { op: 'quest-status', questKey: mainQuest.key, statuses: ['completed'] },
      failureMessage: '这条重要故事还没有进入可以公开推进的阶段。',
    }
  }
  return null
}

function ownerBinding(quest: TextOpenWorldQuestSkeletonsV1['quests'][number], context: TextOpenWorldQuestFinalizeInputContextV1) {
  if (quest.owner.kind === 'global') return { ownerKind: 'global' as const, ownerKey: null }
  if (quest.owner.kind === 'region') return { ownerKind: 'region' as const, ownerKey: quest.owner.semanticKey }
  const key = quest.owner.semanticKey
  if (!key) fail(`任务owner缺少语义键:${quest.key}`)
  if (quest.owner.kind === 'actor') {
    if (!context.npcRuntimeCatalog.actors.some(actor => actor.key === key)) fail(`任务Actor owner未兑现:${quest.key}:${key}`)
    return { ownerKind: 'actor' as const, ownerKey: key }
  }
  if (!context.npcRuntimeCatalog.factions.some(faction => faction.key === key)) fail(`任务Faction owner未兑现:${quest.key}:${key}`)
  return { ownerKind: 'faction' as const, ownerKey: key }
}

function supportActionsForDefinitions(input: {
  definitionKeys: string[]
  objective: TextOpenWorldQuestSkeletonsV1['objectives'][number]
  context: TextOpenWorldQuestFinalizeInputContextV1
}): string[] {
  const result: string[] = []
  input.definitionKeys.forEach(key => {
    if (input.context.npcRuntimeCatalog.actors.some(item => item.key === key)) result.push(`action.talk.${key}`)
    const enemy = input.context.enemyEncounterCatalog.enemies.find(item => item.key === key)
    const encounter = input.context.enemyEncounterCatalog.encounters.find(item => item.key === key)
      ?? (enemy ? input.context.enemyEncounterCatalog.encounters.find(item => item.enemyGroups.some(group => group.enemyKey === enemy.key)) : null)
    if (encounter) result.push(`action.start.${encounter.key}`)
    if (input.context.progressionCatalogs.skills.some(item => item.key === key)) result.push(`action.combat.${key}`)
    const item = input.context.itemRewardCatalog.items.find(candidate => candidate.key === key)
    if (item?.consumable) result.push(`action.use.${key}`)
    if (item?.kind === 'equipment') result.push(`action.equip.${key}`)
    if (input.context.craftingEconomyCatalog.recipes.some(item => item.key === key)) result.push(`action.craft.${key}`)
    if (input.context.craftingEconomyCatalog.vendors.some(item => item.key === key)) result.push(`action.buy.${key}`)
    if (input.context.mapInteractionCatalog.interactions.some(item => item.key === key)) result.push(`action.interaction.${key}`)
    if (key.startsWith('action.requirement.')) result.push(key)
  })
  return [...new Set(result)]
}

function stableRumorSuffix(sourceRumorKey: string): string {
  const matched = /^rumor-seed\.(\d{3})$/.exec(sourceRumorKey)
  if (!matched) fail(`传闻稳定键无效:${sourceRumorKey}`)
  return matched[1]!
}

function subjectDefinitionKey(input: {
  context: TextOpenWorldQuestFinalizeInputContextV1
  rumor: GovernedRegionRumorV1
}): string | null {
  const sourceKey = input.rumor.subjectSourceKey
  if (input.rumor.subjectKind === 'lore') return null
  if (!sourceKey) fail(`传闻主题缺少来源键:${input.rumor.key}`)
  if (input.rumor.subjectKind === 'location') {
    return input.context.mapInteractionCatalog.locations.find(item => item.key === sourceKey)?.key
      ?? fail(`传闻地点主题未兑现:${input.rumor.key}:${sourceKey}`)
  }
  if (input.rumor.subjectKind === 'actor') {
    const matches = input.context.npcRuntimeCatalog.actors.filter(item => item.key === sourceKey
      || item.fulfilledRequirementKeys.includes(sourceKey))
    if (matches.length !== 1) fail(`传闻Actor主题必须唯一兑现:${input.rumor.key}:${sourceKey}`)
    return matches[0]!.key
  }
  if (input.rumor.subjectKind === 'faction') {
    const matches = input.context.npcRuntimeCatalog.factions.filter(item => item.key === sourceKey
      || item.fulfilledRequirementKeys.includes(sourceKey))
    if (matches.length !== 1) fail(`传闻Faction主题必须唯一兑现:${input.rumor.key}:${sourceKey}`)
    return matches[0]!.key
  }
  const quest = input.context.questSkeletons.quests.find(item => item.key === sourceKey || item.source.sourceKey === sourceKey)
  if (quest) return quest.key
  const eventIndex = input.context.regionNarrativePacks.packs.flatMap(pack => pack.randomEventSeeds)
    .findIndex(item => item.key === sourceKey)
  if (eventIndex >= 0) return `event.director.${String(eventIndex + 1).padStart(3, '0')}`
  fail(`传闻任务线索主题未兑现:${input.rumor.key}:${sourceKey}`)
}

async function createArtifacts(input: {
  context: TextOpenWorldQuestFinalizeInputContextV1
  draft: QuestFinalizeDraftV1
  createdAt: number
  lifecycleContract?: 'legacy' | 'governed-v16'
  combatMechanicsContract?: 'legacy' | 'governed-v17'
  knowledgeProgressContract?: 'legacy' | 'governed-v18'
  storyOutcomeContract?: 'legacy' | 'governed-v19'
}): Promise<TextOpenWorldQuestFinalizeArtifactsV1> {
  const governedLifecycle = input.lifecycleContract !== 'legacy'
  const governedCombatMechanics = input.combatMechanicsContract === 'governed-v17'
  const governedKnowledge = input.knowledgeProgressContract === 'governed-v18'
  const governedStoryOutcome = input.storyOutcomeContract === 'governed-v19'
  const governedProtectedStoryReveal = governedLifecycle && governedCombatMechanics && governedKnowledge
  if (governedCombatMechanics) {
    input.context.progressionCatalogs.statuses.forEach(compileTextOpenWorldStatusDefinitionV2)
    input.context.progressionCatalogs.skills.forEach(skill => {
      compileTextOpenWorldSkillMechanicV2({
        skill,
        statuses: input.context.progressionCatalogs.statuses,
      })
    })
  }
  const conditions: TextOpenWorldConditionDefinitionV1[] = []
  const effects: TextOpenWorldEffectDefinitionV1[] = []
  const actions: TextOpenWorldActionDefinitionV1[] = []
  const addCondition = (value: TextOpenWorldConditionDefinitionV1) => pushUnique(conditions, value, 'Condition')
  const addEffect = (value: TextOpenWorldEffectDefinitionV1) => pushUnique(effects, value, 'Effect')
  const addAction = (value: TextOpenWorldActionDefinitionV1) => pushUnique(actions, value, 'Action')

  addCondition({ key: 'condition.system.ready', expression: { op: 'player-number', field: 'level', comparator: 'gte', value: 1 }, failureMessage: '角色尚未进入可行动状态。' })

  const requirementBindings: TextOpenWorldQuestDesignDocumentsV1['requirementBindings'] = input.context.contentRequirementManifest.requirements.map(requirement => {
    const resolved = definitionsForRequirement(input.context, requirement)
    const definitionKeys = resolved.keys.length ? resolved.keys : [`action.requirement.${requirement.key}`]
    return {
      requirementKey: requirement.key, kind: requirement.kind,
      consumerObjectiveKeys: requirement.consumerRefs.filter(ref => ref.kind === 'quest-objective').map(ref => ref.consumerKey),
      definitionKind: resolved.kind, definitionKeys,
    }
  })

  requirementBindings.filter(binding => binding.definitionKind === 'action').forEach(binding => {
    const requirement = input.context.contentRequirementManifest.requirements.find(item => item.key === binding.requirementKey)!
    addAction(action({
      key: binding.definitionKeys[0]!, category: 'observe', label: requirement.title,
      description: requirement.description, actorScope: 'player', targetScope: 'quest',
    }))
  })

  const rewardBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['rewards'] = []
  input.context.itemRewardCatalog.rewardContracts.forEach(reward => {
    const rewardEffects: string[] = []
    if (reward.sourceKind === 'quest') {
      const key = `effect.claim.${reward.key}`
      addEffect({ key, operation: 'claim-quest-reward', payload: { questKey: reward.sourceSemanticKey, rewardKey: reward.key } })
      rewardEffects.push(key)
    }
    if (reward.grants.experience > 0) {
      const key = `effect.reward.${reward.key}.experience`; addEffect({ key, operation: 'grant-experience', payload: { amount: reward.grants.experience } }); rewardEffects.push(key)
    }
    if (reward.grants.currency > 0) {
      const key = `effect.reward.${reward.key}.currency`; addEffect({ key, operation: 'change-currency', payload: { amount: reward.grants.currency } }); rewardEffects.push(key)
    }
    reward.grants.items.forEach((grant, index) => {
      const key = `effect.reward.${reward.key}.item.${String(index + 1).padStart(3, '0')}`
      addEffect({ key, operation: 'grant-item', payload: { itemKey: grant.itemKey, quantity: grant.quantity } }); rewardEffects.push(key)
    })
    reward.grants.skillKeys.forEach((skillKey, index) => {
      const key = `effect.reward.${reward.key}.skill.${String(index + 1).padStart(3, '0')}`
      addEffect({ key, operation: 'learn-skill', payload: { skillKey } }); rewardEffects.push(key)
    })
    if (reward.sourceKind === 'combat') {
      const key = `effect.reward.${reward.key}.victory-flag`
      addEffect({ key, operation: 'set-world-flag', payload: { flagKey: `flag.encounter.${reward.sourceSemanticKey}.completed`, value: true } })
      rewardEffects.push(key)
    }
    rewardBindings.push({
      rewardContractKey: reward.key, conditionKeys: [], effectKeys: rewardEffects,
      dropTableKeys: reward.runtimeBinding.dropTableKeys,
      sourceQuestKey: reward.sourceKind === 'quest' ? reward.sourceSemanticKey : null,
      sourceEncounterKey: reward.sourceKind === 'combat' ? reward.sourceSemanticKey : null,
    })
  })

  const dropBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['dropTables'] = input.context.itemRewardCatalog.dropTables.map(table => {
    const quantityEffectBindings = table.entries.flatMap(entry => entry.quantityEffectBindings.map(mapping => {
      const key = `effect.drop.${table.key}.${entry.itemKey}.${mapping.quantity}`
      addEffect({ key, operation: 'grant-item', payload: { itemKey: entry.itemKey, quantity: mapping.quantity } })
      return { itemKey: entry.itemKey, quantity: mapping.quantity, effectKey: key }
    }))
    return { dropTableKey: table.key, conditionKeys: [], quantityEffectBindings }
  })
  const enemyBindings = input.context.enemyEncounterCatalog.enemies.map(enemy => ({
    enemyKey: enemy.key,
    dropTableKey: input.context.itemRewardCatalog.dropTables.find(table => table.sourceEnemyKey === enemy.key)?.key
      ?? fail(`敌人缺少掉落表:${enemy.key}`),
  }))

  const encounterBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['encounters'] = input.context.enemyEncounterCatalog.encounters.map(encounter => {
    const startEffectKey = `effect.start.${encounter.key}`
    const startActionKey = `action.start.${encounter.key}`
    addEffect({ key: startEffectKey, operation: 'initialize-combat', payload: { encounterKey: encounter.key } })
    addAction(action({
      key: startActionKey, category: 'start-combat', label: `迎战：${encounter.title}`, description: encounter.openingText,
      targetScope: 'encounter', locationKeys: [encounter.locationKey], successEffectKeys: [startEffectKey],
    }))
    const reward = input.context.itemRewardCatalog.rewardContracts.find(item => item.sourceKind === 'combat' && item.sourceSemanticKey === encounter.key)
      ?? fail(`遭遇缺少奖励:${encounter.key}`)
    const questKeys = input.context.questSkeletons.objectives.filter(objective => encounter.questObjectiveKeys.includes(objective.key)).map(objective => objective.questKey)
    return {
      encounterKey: encounter.key, questKeys: [...new Set(questKeys)], rewardContractKey: reward.key,
      startActionKey, completionFlagKey: `flag.encounter.${encounter.key}.completed`,
    }
  })
  const settleCombatEffect = 'effect.system.settle-combat'
  addEffect({ key: settleCombatEffect, operation: 'settle-combat-state', payload: {} })
  addAction(action({
    key: 'action.system.settle-combat', category: 'combat-state-action', label: '结算战斗阶段', description: '确定性结算当前战斗阶段。',
    actorScope: 'system', targetScope: 'encounter', successEffectKeys: [settleCombatEffect],
  }))
  addAction(action({
    key: 'action.system.claim-combat-reward', category: 'combat-reward-action', label: '结算战斗奖励',
    description: '由确定性战斗终态结算唯一遭遇奖励与掉落。', actorScope: 'system', targetScope: 'encounter',
  }))

  const skillBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['skills'] = input.context.progressionCatalogs.skills.map(skill => {
    let actionKey: string | null = null
    const useConditionKeys: string[] = []
    const skillEffectKeys: string[] = []
    if (skill.activation === 'active') {
      actionKey = `action.combat.${skill.key}`
      if (!governedCombatMechanics && skill.kind !== 'attack') {
        const status = input.context.progressionCatalogs.statuses.find(item => item.polarity === 'beneficial')
          ?? input.context.progressionCatalogs.statuses[0] ?? fail(`主动状态技能缺少Status定义:${skill.key}`)
        const conditionKey = `condition.combat.${skill.key}.status-absent`
        addCondition({ key: conditionKey, expression: { op: 'player-status', statusKey: status.key, present: false }, failureMessage: '该状态已经生效。' })
        useConditionKeys.push(conditionKey)
        const effectKey = `effect.combat.${skill.key}.status`
        addEffect({ key: effectKey, operation: 'apply-status', payload: { statusKey: status.key } })
        skillEffectKeys.push(effectKey)
      }
      const isBasicAttack = skill.key === 'skill.player.basic-attack'
      const marker = `effect.combat.${skill.key}`
      addEffect({ key: marker, operation: 'perform-combat-action', payload: { kind: isBasicAttack ? 'basic-attack' : 'skill', skillKey: skill.key, itemKey: null } })
      const costEffectKeys: string[] = []
      if (skill.resourceCost > 0) {
        const cost = `effect.combat.${skill.key}.cost`
        addEffect({ key: cost, operation: 'change-player-resource', payload: { resource: 'skill-resource', amount: -skill.resourceCost } })
        costEffectKeys.push(cost)
      }
      addAction(action({
        key: actionKey, category: isBasicAttack ? 'combat-basic-attack' : 'combat-skill',
        label: skill.title, description: skill.description, targetScope: skill.target === 'single-enemy' ? 'combatant' : 'none',
        requirementConditionKeys: useConditionKeys, costEffectKeys, successEffectKeys: [...skillEffectKeys, marker],
      }))
    }
    const unlockQuestKey = skill.unlockPlan.kind === 'quest-requirement'
      ? requirementBindings.find(binding => binding.requirementKey === skill.unlockPlan.requirementKey)?.consumerObjectiveKeys
        .map(objectiveKey => input.context.questSkeletons.objectives.find(objective => objective.key === objectiveKey)!.questKey)[0] ?? null
      : null
    return { skillKey: skill.key, useConditionKeys, effectKeys: skillEffectKeys, actionKey, unlockQuestKey }
  })
  const enemySkillKeys = [...new Set(input.context.enemyEncounterCatalog.enemies.flatMap(enemy => enemy.skillKeys))]
  enemySkillKeys.forEach(skillKey => {
    const marker = `effect.combat.enemy.${skillKey}`
    addEffect({ key: marker, operation: 'perform-combat-action', payload: { kind: 'enemy-skill', skillKey, itemKey: null } })
    addAction(action({
      key: `action.combat.enemy.${skillKey}`, category: 'combat-enemy-skill', label: `敌方使用${skillKey}`,
      description: '由确定性敌人策略选择并执行技能。', actorScope: 'system', targetScope: 'none',
      successEffectKeys: [...(skillBindings.find(binding => binding.skillKey === skillKey)?.effectKeys ?? []), marker],
    }))
  })
  const escapeMarker = 'effect.combat.escape'
  addEffect({ key: escapeMarker, operation: 'perform-combat-action', payload: { kind: 'escape', skillKey: null, itemKey: null } })
  addAction(action({ key: 'action.combat.escape', category: 'escape', label: '逃跑', description: '尝试离开当前战斗。', successEffectKeys: [escapeMarker] }))

  const itemBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['items'] = input.context.itemRewardCatalog.items.map(item => {
    const compiled = compileTextOpenWorldQuestFinalizeItemRuntimeContractV1(item)
    compiled.conditions.forEach(addCondition)
    compiled.effects.forEach(addEffect)
    compiled.actions.forEach(addAction)
    return compiled.binding
  })

  const recipeBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['recipes'] = input.context.craftingEconomyCatalog.recipes.map(recipe => {
    const marker = `effect.craft.${recipe.key}`; const craftActionKey = `action.craft.${recipe.key}`
    addEffect({ key: marker, operation: 'perform-crafting', payload: { recipeKey: recipe.key } })
    addAction(action({ key: craftActionKey, category: 'craft', label: `制作${recipe.title}`, description: recipe.description, targetScope: 'recipe', locationKeys: recipe.stationLocationKeys, successEffectKeys: [marker] }))
    let learnActionKey: string | null = null; let learnQuestKey: string | null = null
    if (!recipe.learnedByDefault) {
      const requirementKey = recipe.fulfilledRequirementKeys[0]
      learnQuestKey = requirementKey
        ? requirementBindings.find(binding => binding.requirementKey === requirementKey)?.consumerObjectiveKeys
          .map(objectiveKey => input.context.questSkeletons.objectives.find(objective => objective.key === objectiveKey)!.questKey)[0] ?? null
        : null
      if (!learnQuestKey) fail(`非默认配方缺少任务来源:${recipe.key}`)
      learnActionKey = `action.learn.${recipe.key}`
      const learnEffect = `effect.learn.${recipe.key}`
      addEffect({ key: learnEffect, operation: 'learn-recipe', payload: { recipeKey: recipe.key } })
      addAction(action({ key: learnActionKey, category: 'quest-action', label: `学会${recipe.title}`, description: '由任务结果解锁这项配方。', actorScope: 'system', targetScope: 'quest', successEffectKeys: [learnEffect] }))
      const reward = rewardBindings.find(binding => binding.sourceQuestKey === learnQuestKey) ?? fail(`配方来源任务缺少奖励:${learnQuestKey}`)
      reward.effectKeys.push(learnEffect)
    }
    return {
      recipeKey: recipe.key, requirementConditionKeys: [], craftActionKey, learnActionKey, learnQuestKey,
      consumeEffectKeys: [], outputEffectKeys: [],
    }
  })

  const vendorBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['vendors'] = input.context.craftingEconomyCatalog.vendors.map(vendor => {
    const actorRequirementKey = vendor.runtimeBinding.actorRequirementKey
    const actor = input.context.npcRuntimeCatalog.actors.find(item => item.sourceDemandKey === actorRequirementKey || item.key === actorRequirementKey)
      ?? fail(`商店Actor预留未兑现:${vendor.key}`)
    const buyEffect = `effect.buy.${vendor.key}`; const sellEffect = `effect.sell.${vendor.key}`
    addEffect({ key: buyEffect, operation: 'perform-transaction', payload: { kind: 'buy', vendorKey: vendor.key } })
    addEffect({ key: sellEffect, operation: 'perform-transaction', payload: { kind: 'sell', vendorKey: vendor.key } })
    addAction(action({ key: `action.buy.${vendor.key}`, category: 'buy', label: `向${vendor.title}购买`, description: vendor.description, targetScope: 'vendor', locationKeys: [vendor.locationKey], successEffectKeys: [buyEffect] }))
    addAction(action({ key: `action.sell.${vendor.key}`, category: 'sell', label: `向${vendor.title}出售`, description: vendor.description, targetScope: 'vendor', locationKeys: [vendor.locationKey], successEffectKeys: [sellEffect] }))
    return { vendorKey: vendor.key, actorKey: actor.key, factionKey: actor.factionKey, availabilityConditionKeys: [], buyActionKey: `action.buy.${vendor.key}`, sellActionKey: `action.sell.${vendor.key}` }
  })

  const actorBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['actors'] = input.context.npcRuntimeCatalog.actors.map(actor => {
    const talkActionKey = `action.talk.${actor.key}`
    addAction(action({ key: talkActionKey, category: 'talk', label: `与${actor.name}交谈`, description: actor.portrayal, targetScope: 'actor', locationKeys: [actor.homeLocationKey] }))
    return { actorKey: actor.key, questKeys: actor.questConsumerKeys, actionKeys: [talkActionKey] }
  })

  const interactionBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['interactions'] = input.context.mapInteractionCatalog.interactions.map(interaction => {
    const actionKey = `action.interaction.${interaction.key}`
    const timeEffectKey = `effect.interaction.${interaction.key}.time`
    const category: TextOpenWorldActionDefinitionV1['category'] = interaction.kind === 'investigate' ? 'investigate' : 'observe'
    addEffect({ key: timeEffectKey, operation: 'advance-time', payload: { minutes: 10 } })
    addAction(action({
      key: actionKey, category, label: interaction.playerPrompt, description: interaction.description,
      targetScope: 'location', locationKeys: [interaction.locationKey], successEffectKeys: [timeEffectKey], timeCostMinutes: 10,
    }))
    return { interactionKey: interaction.key, actionKey, conditionKeys: [], effectKeys: [timeEffectKey], questKeys: interaction.questConsumerKeys }
  })

  const edgeBindings: TextOpenWorldQuestDesignDocumentsV1['catalogBindings']['edges'] = input.context.mapInteractionCatalog.edges.map(edge => {
    const direction = (suffix: string, origin: string, destination: string) => {
      const actionKey = `action.travel.${edge.key}.${suffix}`
      const start = `effect.travel.${edge.key}.${suffix}.start`; const time = `effect.travel.${edge.key}.${suffix}.time`; const enter = `effect.travel.${edge.key}.${suffix}.enter`
      addEffect({ key: start, operation: 'start-travel', payload: { edgeKey: edge.key, destinationLocationKey: destination } })
      addEffect({ key: time, operation: 'advance-time', payload: { minutes: edge.travelMinutes } })
      addEffect({ key: enter, operation: 'enter-location', payload: { locationKey: destination } })
      addAction(action({ key: actionKey, category: 'travel', label: `前往${destination}`, description: edge.description, targetScope: 'location', locationKeys: [origin], successEffectKeys: [start, time, enter], timeCostMinutes: edge.travelMinutes }))
      return { actionKey, effectKeys: [start, time, enter] }
    }
    const forward = direction('forward', edge.fromLocationKey, edge.toLocationKey)
    const reverse = edge.bidirectional ? direction('reverse', edge.toLocationKey, edge.fromLocationKey) : null
    return { edgeKey: edge.key, forwardActionKey: forward.actionKey, reverseActionKey: reverse?.actionKey ?? null, conditionKeys: [], effectKeys: [...forward.effectKeys, ...(reverse?.effectKeys ?? [])] }
  })
  const fastTravelEffect = 'effect.fast-travel'
  addEffect({ key: fastTravelEffect, operation: 'fast-travel', payload: { timeRatioNumerator: 1, timeRatioDenominator: 2, minimumMinutes: 15 } })
  addAction(action({ key: 'action.fast-travel', category: 'fast-travel', label: '快速旅行', description: '前往已经到访并解锁的地区旅行点。', targetScope: 'location', successEffectKeys: [fastTravelEffect] }))
  const fastTravelBindings = input.context.mapInteractionCatalog.fastTravelPoints.map(point => {
    const respawnEffectKey = `effect.respawn.${point.key}`
    const respawnActionKey = `action.respawn.${point.key}`
    addEffect({ key: respawnEffectKey, operation: 'respawn', payload: { fastTravelPointKey: point.key, healthRatio: 1 } })
    addAction(action({
      key: respawnActionKey, category: 'respawn', label: `在${point.key}复活`,
      description: '战败后无额外代价返回已经解锁的安全复活点。', successEffectKeys: [respawnEffectKey],
    }))
    if (point.unlockedByDefault) return { fastTravelPointKey: point.key, unlockEffectKey: null, respawnActionKey }
    const unlockEffectKey = `effect.unlock.${point.key}`
    addEffect({ key: unlockEffectKey, operation: 'unlock-fast-travel', payload: { fastTravelPointKey: point.key } })
    return { fastTravelPointKey: point.key, unlockEffectKey, respawnActionKey }
  })
  const restEffectKey = 'effect.rest.standard'
  const restTimeEffectKey = 'effect.rest.standard.time'
  addEffect({ key: restEffectKey, operation: 'rest', payload: { healthRatio: 1, skillResourceRatio: 1, clearHarmfulStatuses: true } })
  addEffect({ key: restTimeEffectKey, operation: 'advance-time', payload: { minutes: 480 } })
  addAction(action({
    key: 'action.rest.standard', category: 'rest', label: '休息', description: '休息至状态恢复，并让世界时间继续推进。',
    successEffectKeys: [restEffectKey, restTimeEffectKey], timeCostMinutes: 480,
  }))
  const weatherEffectKey = 'effect.system.settle-weather'
  addEffect({ key: weatherEffectKey, operation: 'settle-weather', payload: {} })
  addAction(action({
    key: 'action.system.settle-weather', category: 'weather-action', label: '结算天气',
    description: '按冻结天气状态机推进当前天气。', actorScope: 'system', successEffectKeys: [weatherEffectKey],
  }))

  const questRows: TextOpenWorldQuestDesignDocumentsV1['quests'] = []
  const stageRows: TextOpenWorldQuestDesignDocumentsV1['stages'] = []
  const objectiveRows: TextOpenWorldQuestDesignDocumentsV1['objectives'] = []
  const storyOutcomeBindings: NonNullable<TextOpenWorldQuestDesignDocumentsV1['storyOutcomeBindings']> = []
  input.context.questSkeletons.objectives.forEach((objective, index) => {
    const draft = input.draft.objectives[index]!
    const definitions = requirementBindings.filter(binding => objective.requirementKeys.includes(binding.requirementKey)).flatMap(binding => binding.definitionKeys)
    const stageConditionKey = `condition.objective.${objective.key}.stage`
    const objectiveQuest = input.context.questSkeletons.quests.find(quest => quest.key === objective.questKey)!
    addCondition({
      key: stageConditionKey,
      // Template definitions may have several runtime instances, so a
      // definition-level quest-status expression cannot identify the command
      // target. Action v16 delegates that exact instance/stage check to the
      // Action Registry and Quest authorization instead of publishing an
      // ambiguous Condition. Keep the legacy artifact byte shape unchanged.
      expression: governedLifecycle && objectiveQuest.type === 'template'
        ? { op: 'player-number', field: 'level', comparator: 'gte', value: 1 }
        : { op: 'all', conditions: [
            { op: 'quest-status', questKey: objective.questKey, statuses: ['active'] },
            { op: 'quest-stage', questKey: objective.questKey, stageKey: objective.stageKey },
          ] },
      failureMessage: '当前任务尚未进入这个目标阶段。',
    })
    const combatEncounter = definitions.map(key => {
      const direct = input.context.enemyEncounterCatalog.encounters.find(item => item.key === key)
      if (direct) return direct
      const enemy = input.context.enemyEncounterCatalog.enemies.find(item => item.key === key)
      return enemy
        ? input.context.enemyEncounterCatalog.encounters.find(item => item.enemyGroups.some(group => group.enemyKey === enemy.key))
        : undefined
    }).find(Boolean)
    const completionConditions = [stageConditionKey]
    if (objective.playerIntent === 'combat' && combatEncounter) {
      const key = `condition.objective.${objective.key}.combat`
      addCondition({ key, expression: { op: 'world-flag', flagKey: `flag.encounter.${combatEncounter.key}.completed`, value: true }, failureMessage: '需要先赢得对应战斗并结算战利品。' })
      completionConditions.push(key)
    }
    const completionEffectKey = `effect.complete.${objective.key}`
    const completionActionKey = `action.complete.${objective.key}`
    addEffect({ key: completionEffectKey, operation: 'complete-objective', payload: { objectiveKey: objective.key } })
    addAction(action({
      key: completionActionKey, category: 'objective-action', label: objective.title, description: draft.description,
      targetScope: 'quest', locationKeys: input.context.questSkeletons.quests.find(quest => quest.key === objective.questKey)!.locationKeys,
      requirementConditionKeys: completionConditions, successEffectKeys: [completionEffectKey],
    }))
    const supportActionKeys = supportActionsForDefinitions({ definitionKeys: definitions, objective, context: input.context })
    objectiveRows.push({
      key: objective.key, questKey: objective.questKey, stageKey: objective.stageKey, order: objective.order,
      title: objective.title, description: draft.description, successDescription: draft.successDescription,
      optional: objective.optional, requirementKeys: objective.requirementKeys, boundDefinitionKeys: definitions,
      supportActionKeys, interactionTimeCostMinutes: draft.timeCostMinutes,
      completionConditionKeys: completionConditions, completionActionKey,
    })
  })

  input.context.questSkeletons.stages.forEach(stage => {
    const requiredObjectiveKeys = stage.objectiveKeys.filter(key => !input.context.questSkeletons.objectives.find(objective => objective.key === key)!.optional)
    const quest = input.context.questSkeletons.quests.find(item => item.key === stage.questKey)!
    const completionConditionKeys = requiredObjectiveKeys.map(objectiveKey => {
      const key = `condition.stage.${stage.key}.${objectiveKey}`
      addCondition({
        key,
        expression: governedLifecycle && quest.type === 'template'
          ? { op: 'player-number', field: 'level', comparator: 'gte', value: 1 }
          : { op: 'quest-objective', objectiveKey, status: 'completed' },
        failureMessage: '仍有必需目标尚未完成。',
      })
      return key
    })
    const ordered = input.context.questSkeletons.stages.filter(item => item.questKey === quest.key).sort((left, right) => left.order - right.order)
    const stageIndex = ordered.findIndex(item => item.key === stage.key)
    const final = stageIndex === ordered.length - 1
    const effectKey = `effect.advance.${stage.key}`; const actionKey = `action.advance.${stage.key}`
    addEffect({ key: effectKey, operation: 'transition-quest', payload: { questKey: quest.key, status: final ? 'completed' : 'active', stageKey: final ? stage.key : ordered[stageIndex + 1]!.key } })
    const storyOutcomeEffectKeys: string[] = []
    if (governedStoryOutcome && final && quest.type === 'significant' && quest.source.kind === 'significant-stage') {
      const sourceStage = input.context.significantThreads.stages.find(item => item.key === quest.source.sourceKey)
        ?? fail(`重要故事任务来源阶段不存在:${quest.key}`)
      sourceStage.localConsequencePlans.forEach(plan => {
        const outcomeEffectKey = `effect.story-outcome.${plan.key}`
        const unsignedAmount = plan.magnitude === 'minor' ? 5 : plan.magnitude === 'moderate' ? 10 : 20
        const amount = plan.direction === 'decrease' ? -unsignedAmount : unsignedAmount
        const outcomeEffects: TextOpenWorldEffectDefinitionV1[] = []
        if (plan.kind === 'morality') {
          if (plan.targetSemanticKey !== 'player.morality') fail(`道德后果目标无效:${plan.key}`)
          outcomeEffects.push({ key: outcomeEffectKey, operation: 'change-morality', payload: { amount } })
        } else if (plan.kind === 'faction-affinity') {
          const factionRequirementKeys = input.context.regionNarrativePacks.packs
            .flatMap(pack => pack.factionRequirements)
            .filter(requirement => requirement.significantThreadKeys.includes(sourceStage.threadKey))
            .map(requirement => requirement.key)
          const manifestRequirementKeys = input.context.contentRequirementManifest.requirements
            .filter(requirement => requirement.kind === 'faction'
              && requirement.sourceReservationKey !== null
              && factionRequirementKeys.includes(requirement.sourceReservationKey))
            .map(requirement => requirement.key)
          const matches = input.context.npcRuntimeCatalog.factions.filter(faction => (
            faction.key === plan.targetSemanticKey
            || factionRequirementKeys.includes(faction.key)
            || faction.fulfilledRequirementKeys.some(key => manifestRequirementKeys.includes(key))
          ))
          if (!matches.length) fail(`阵营后果没有解析到运行Faction:${plan.key}`)
          matches.forEach((faction, factionIndex) => outcomeEffects.push({
            key: `${outcomeEffectKey}.${String(factionIndex + 1).padStart(3, '0')}`,
            operation: 'change-faction-affinity',
            payload: { factionKey: faction.key, amount },
          }))
        } else if (plan.kind === 'npc-attitude') {
          const matches = input.context.npcRuntimeCatalog.actors.filter(actor => (
            actor.key === plan.targetSemanticKey || actor.fulfilledRequirementKeys.includes(plan.targetSemanticKey)
          ))
          if (matches.length !== 1) fail(`NPC态度后果必须唯一解析到运行Actor:${plan.key}`)
          outcomeEffects.push({
            key: outcomeEffectKey,
            operation: 'set-story-modifier',
            payload: { actorKey: matches[0]!.key, value: amount },
          })
        } else if (plan.kind === 'regional-state') {
          const region = input.context.mapInteractionCatalog.regions.find(item => item.key === plan.targetSemanticKey)
            ?? fail(`地区后果目标不存在:${plan.key}`)
          outcomeEffects.push({
            key: outcomeEffectKey,
            operation: 'change-region-state',
            payload: { regionKey: region.key, state: `story-outcome.${plan.direction}.${plan.magnitude}` },
          })
        } else {
          if (plan.targetSemanticKey !== 'player.inventory') fail(`资源后果目标无效:${plan.key}`)
          outcomeEffects.push({ key: outcomeEffectKey, operation: 'change-currency', payload: { amount } })
        }
        outcomeEffects.forEach(addEffect)
        storyOutcomeEffectKeys.push(...outcomeEffects.map(effect => effect.key))
        storyOutcomeBindings.push({
          threadKey: sourceStage.threadKey,
          sourceStageKey: sourceStage.key,
          questKey: quest.key,
          questStageKey: stage.key,
          consequencePlanKey: plan.key,
          effectKeys: outcomeEffects.map(effect => effect.key),
        })
      })
    }
    addAction(action({
      key: actionKey,
      category: 'quest-action',
      label: final ? `完成${quest.title}` : `推进${quest.title}`,
      description: stage.completionIntent,
      actorScope: 'system',
      targetScope: 'quest',
      requirementConditionKeys: completionConditionKeys,
      successEffectKeys: [effectKey, ...storyOutcomeEffectKeys],
    }))
    stageRows.push({ key: stage.key, questKey: stage.questKey, order: stage.order, title: stage.title, objectiveKeys: stage.objectiveKeys, completionConditionKeys, completionActionKey: actionKey })
  })

  const firstMainlineQuestKey = input.context.questSkeletons.quests
    .find(quest => quest.type === 'mainline'
      && deriveTextOpenWorldQuestUnlockConditionV1({ quest, context: input.context }) === null)?.key
    ?? fail('任务骨架缺少主线任务')
  input.context.questSkeletons.quests.forEach((quest, index) => {
    const draft = input.draft.quests[index]!
    const unlock = deriveTextOpenWorldQuestUnlockConditionV1({ quest, context: input.context })
    if (unlock) addCondition(unlock)
    const orderedStages = input.context.questSkeletons.stages
      .filter(stage => stage.questKey === quest.key)
      .sort((left, right) => left.order - right.order)
    const firstStage = orderedStages[0]!
    const questOwner = ownerBinding(quest, input.context)
    const lifecyclePolicy = governedLifecycle && quest.type === 'ordinary' && quest.lifecyclePlan.timePolicy === 'timed'
      ? 'abandon-terminal' as const
      : quest.lifecyclePlan.lifecyclePolicy
    const offerLocationKey = questOwner.ownerKind === 'actor'
      ? input.context.npcRuntimeCatalog.actors.find(actor => actor.key === questOwner.ownerKey)?.homeLocationKey
        ?? fail(`任务发布Actor缺少常驻地:${quest.key}`)
      : quest.locationKeys[0] ?? input.context.mapInteractionCatalog.initialLocationKey
    const acceptOne = `effect.accept.${quest.key}`; const activate = `effect.activate.${quest.key}`; const acceptActionKey = `action.accept.${quest.key}`
    addEffect({ key: acceptOne, operation: 'transition-quest', payload: { questKey: quest.key, status: 'accepted', stageKey: null } })
    addEffect({ key: activate, operation: 'transition-quest', payload: { questKey: quest.key, status: 'active', stageKey: firstStage.key } })
    addAction(action({ key: acceptActionKey, category: 'accept-quest', label: `接受：${quest.title}`, description: draft.description, targetScope: 'quest', requirementConditionKeys: unlock ? [unlock.key] : [], successEffectKeys: [acceptOne, activate] }))
    const initialStatus: TextOpenWorldQuestDesignDocumentsV1['quests'][number]['initialStatus'] = quest.type === 'template'
      ? 'locked'
      : quest.type === 'mainline' && quest.key === firstMainlineQuestKey
        ? 'revealed'
        : quest.type === 'ordinary' ? 'available' : 'locked'
    if (governedProtectedStoryReveal && initialStatus === 'locked'
      && (quest.type === 'mainline' || quest.type === 'significant')) {
      if (!unlock) fail(`受保护任务缺少揭示条件:${quest.key}`)
      const unlockEffectKey = `effect.unlock.${quest.key}`
      const revealEffectKey = `effect.reveal.${quest.key}`
      addEffect({ key: unlockEffectKey, operation: 'transition-quest', payload: { questKey: quest.key, status: 'available', stageKey: null } })
      addEffect({ key: revealEffectKey, operation: 'transition-quest', payload: { questKey: quest.key, status: 'revealed', stageKey: null } })
      addAction(action({
        key: `action.reveal.${quest.key}`,
        category: 'quest-action',
        label: `揭示：${quest.title}`,
        description: '前置故事完成后，由任务系统确定性公开这条受保护故事线。',
        actorScope: 'system',
        targetScope: 'quest',
        requirementConditionKeys: [unlock.key],
        successEffectKeys: [unlockEffectKey, revealEffectKey],
      }))
    }
    let abandonActionKey: string | null = null
    if (quest.lifecyclePlan.abandonable) {
      abandonActionKey = `action.abandon.${quest.key}`
      if (!governedLifecycle) {
        const effectKey = `effect.abandon.${quest.key}`
        addEffect({ key: effectKey, operation: 'transition-quest', payload: { questKey: quest.key, status: 'abandoned', stageKey: firstStage.key } })
        addAction(action({
          key: abandonActionKey, category: 'abandon-quest', label: `放弃：${quest.title}`,
          description: '放弃当前任务；可重接任务保留重新接取入口。', targetScope: 'quest',
          successEffectKeys: [effectKey], confirmationPolicy: 'always',
        }))
      } else {
        const abandonmentDescription = lifecyclePolicy === 'abandon-restart'
          ? '放弃当前任务；之后可回到原发布场景重新接取。'
          : quest.lifecyclePlan.timePolicy === 'timed'
            ? '放弃当前任务；原截止时间仍然有效，且不可重新接取。'
            : '放弃当前任务；该任务将永久终结。'
        const abandonVariants: Array<{ actionKey: string; effectKey: string; stageKey: string | null; label: string }> = [
          {
            actionKey: abandonActionKey,
            effectKey: `effect.abandon.${quest.key}`,
            stageKey: firstStage.key,
            label: `放弃：${quest.title}`,
          },
          {
            actionKey: `action.abandon.${quest.key}.unstarted`,
            effectKey: `effect.abandon.${quest.key}.unstarted`,
            stageKey: null,
            label: `开始前放弃：${quest.title}`,
          },
          ...orderedStages.slice(1).map((stage, stageIndex) => ({
            actionKey: `action.abandon.${quest.key}.stage.${String(stageIndex + 2).padStart(3, '0')}`,
            effectKey: `effect.abandon.${quest.key}.stage.${String(stageIndex + 2).padStart(3, '0')}`,
            stageKey: stage.key,
            label: `在“${stage.title}”阶段放弃：${quest.title}`,
          })),
        ]
        abandonVariants.forEach(variant => {
          addEffect({ key: variant.effectKey, operation: 'transition-quest', payload: { questKey: quest.key, status: 'abandoned', stageKey: variant.stageKey } })
          addAction(action({
            key: variant.actionKey, category: 'abandon-quest', label: variant.label,
            description: abandonmentDescription, targetScope: 'quest', successEffectKeys: [variant.effectKey],
            confirmationPolicy: 'always',
          }))
        })
      }
    }
    if (governedLifecycle && quest.type === 'ordinary' && lifecyclePolicy === 'abandon-restart'
      && quest.lifecyclePlan.timePolicy === 'waits' && quest.lifecyclePlan.instantiationPolicy === 'session-start') {
      const restartEffects = [
        { key: `effect.restart.${quest.key}.available`, status: 'available' as const, stageKey: null },
        { key: `effect.restart.${quest.key}.revealed`, status: 'revealed' as const, stageKey: null },
        { key: `effect.restart.${quest.key}.accepted`, status: 'accepted' as const, stageKey: null },
        { key: `effect.restart.${quest.key}.active`, status: 'active' as const, stageKey: firstStage.key },
      ]
      restartEffects.forEach(effect => addEffect({
        key: effect.key, operation: 'transition-quest',
        payload: { questKey: quest.key, status: effect.status, stageKey: effect.stageKey },
      }))
      addAction(action({
        key: `action.restart.${quest.key}`, category: 'restart-quest', label: `重新接取：${quest.title}`,
        description: '在原任务发布场景重新接取，并从第一阶段开始。', targetScope: 'quest',
        locationKeys: [offerLocationKey], requirementConditionKeys: unlock ? [unlock.key] : [],
        successEffectKeys: restartEffects.map(effect => effect.key),
      }))
    }
    const expirationActionKeys: string[] = []
    if (quest.lifecyclePlan.timePolicy === 'timed') {
      const stages = input.context.questSkeletons.stages.filter(stage => stage.questKey === quest.key)
      ;[null, ...stages.map(stage => stage.key)].forEach((stageKey, expirationIndex) => {
        const effectKey = `effect.expire.${quest.key}.${expirationIndex}`; const actionKey = `action.expire.${quest.key}.${expirationIndex}`
        addEffect({ key: effectKey, operation: 'transition-quest', payload: { questKey: quest.key, status: 'expired', stageKey } })
        addAction(action({ key: actionKey, category: 'quest-action', label: `使${quest.title}过期`, description: '到达截止时间后由系统确定性关闭任务。', actorScope: 'system', targetScope: 'quest', successEffectKeys: [effectKey] }))
        expirationActionKeys.push(actionKey)
      })
    }
    const reward = input.context.itemRewardCatalog.rewardContracts.find(item => item.sourceKind === 'quest' && item.sourceSemanticKey === quest.key)
      ?? fail(`任务缺少奖励合同:${quest.key}`)
    const rewardBinding = rewardBindings.find(item => item.rewardContractKey === reward.key)!
    const claimActionKey = `action.claim.${quest.key}`
    addAction(action({ key: claimActionKey, category: 'claim-reward', label: `领取${quest.title}奖励`, description: reward.description, targetScope: 'quest' }))
    questRows.push({
      key: quest.key, order: quest.order, type: quest.type, ...questOwner, title: quest.title,
      description: draft.description, storylineKey: quest.storylineKey, regionKeys: quest.regionKeys, stageKeys: quest.stageKeys,
      prerequisiteConditionKeys: unlock ? [unlock.key] : [], rewardEffectKeys: rewardBinding.effectKeys,
      rewardContractKey: reward.key, claimActionKey, acceptActionKey, abandonActionKey, expirationActionKeys,
      lifecyclePolicy, timePolicy: quest.lifecyclePlan.timePolicy,
      expirationMinutes: quest.lifecyclePlan.expirationMinutes, repeatable: quest.lifecyclePlan.repeatable,
      instantiationPolicy: quest.lifecyclePlan.instantiationPolicy,
      initialStatus,
      estimatedMinutes: quest.estimatedMinutes, tags: [...new Set([quest.type, ...draft.tags])],
    })
  })

  const endingRoutes = [...input.context.mainlineThread.endingRoutes].sort((left, right) => (
    input.context.mainlineThread.thread.endingKeys.indexOf(left.endingKey)
      - input.context.mainlineThread.thread.endingKeys.indexOf(right.endingKey)
  ))
  if (!endingRoutes.length
    || !same(endingRoutes.map(route => route.endingKey), input.context.mainlineThread.thread.endingKeys)
    || new Set(endingRoutes.map(route => route.finalStageKey)).size !== 1) {
    fail('主线结局必须完整绑定到同一个最终Stage')
  }
  const finalMainlineStageKey = endingRoutes[0]!.finalStageKey
  const finalMainlineQuestSkeleton = input.context.questSkeletons.quests.find(quest => (
    quest.type === 'mainline' && quest.source.sourceKey === finalMainlineStageKey
  )) ?? fail(`最终主线Stage没有任务骨架:${finalMainlineStageKey}`)
  const finalMainlineQuest = questRows.find(quest => quest.key === finalMainlineQuestSkeleton.key)
    ?? fail(`最终主线任务没有完成定稿:${finalMainlineQuestSkeleton.key}`)
  const finalLocationKey = finalMainlineQuestSkeleton.locationKeys[0]
    ?? fail(`最终主线任务没有可演绎地点:${finalMainlineQuest.key}`)
  const selectionReadyConditionKey = 'condition.system.ending-selection-ready'
  addCondition({
    key: selectionReadyConditionKey,
    expression: { op: 'quest-status', questKey: finalMainlineQuest.key, statuses: ['completed'] },
    failureMessage: '完成主线最终任务后，才能作出最终选择。',
  })
  const endingRouteBindings: TextOpenWorldQuestDesignDocumentsV1['endingBindings']['routes'] = endingRoutes.map((route, routeIndex) => {
    const conditionKey = `condition.ending.${route.endingKey}`
    const eligibilityConditionKey = `condition.ending.eligibility.${route.endingKey}`
    const actionKey = `action.ending.${route.endingKey}`
    const routeEffectKey = `effect.ending.route.${route.endingKey}`
    const unlockEffectKey = `effect.ending.unlock.${route.endingKey}`
    const reachEffectKey = `effect.ending.reach.${route.endingKey}`
    addCondition({
      key: conditionKey,
      expression: {
        op: 'all',
        conditions: [
          { op: 'quest-status', questKey: finalMainlineQuest.key, statuses: ['completed'] },
          { op: 'world-flag', flagKey: 'flag.ending.route', value: route.endingKey },
        ],
      },
      failureMessage: `尚未选择“${route.decisivePlayerValue}”对应的最终道路。`,
    })
    let eligibility: NonNullable<TextOpenWorldQuestDesignDocumentsV1['endingBindings']['routes'][number]['eligibility']> | undefined
    if (governedStoryOutcome) {
      const demand = input.context.endingEligibilityDemands?.[routeIndex]
        ?? fail(`结局缺少资格候选:${route.endingKey}`)
      const selection = input.draft.endingEligibilitySelections?.[routeIndex]
        ?? fail(`结局缺少资格选择:${route.endingKey}`)
      if (demand.endingKey !== route.endingKey || selection.endingNumber !== demand.endingNumber) {
        fail(`结局资格选择与路线错位:${route.endingKey}`)
      }
      const candidate = (candidateNumber: number, kind: EndingEligibilityCandidateKindV1) => {
        const value = demand.candidates[candidateNumber - 1]
          ?? fail(`结局资格候选不存在:${route.endingKey}:${candidateNumber}`)
        if (value.kind !== kind) fail(`结局资格候选类型错误:${route.endingKey}:${candidateNumber}`)
        return value
      }
      const requiredQuestKeys = selection.requiredQuestCandidateNumbers
        .map(number => candidate(number, 'quest-complete').sourceKey)
      const anyQuestKeyGroups = selection.anyQuestCandidateGroups.map(group => group
        .map(number => candidate(number, 'quest-complete').sourceKey))
      const requiredFactionAffinities = selection.requiredFactionAffinities.map(item => ({
        factionKey: candidate(item.candidateNumber, 'faction-affinity').sourceKey,
        minimum: item.minimum,
      }))
      const requiredRecipeKeys = selection.requiredRecipeCandidateNumbers
        .map(number => candidate(number, 'recipe-known').sourceKey)
      eligibility = { requiredQuestKeys, anyQuestKeyGroups, requiredFactionAffinities, requiredRecipeKeys }
      addCondition({
        key: eligibilityConditionKey,
        expression: {
          op: 'all',
          conditions: [
            ...requiredQuestKeys.map(questKey => ({ op: 'quest-status' as const, questKey, statuses: ['completed' as const] })),
            ...anyQuestKeyGroups.map(questKeys => ({
              op: 'any' as const,
              conditions: questKeys.map(questKey => ({ op: 'quest-status' as const, questKey, statuses: ['completed' as const] })),
            })),
            ...requiredFactionAffinities.map(item => ({
              op: 'relation-faction-affinity' as const,
              factionKey: item.factionKey,
              comparator: 'gte' as const,
              value: item.minimum,
            })),
            ...requiredRecipeKeys.map(recipeKey => ({ op: 'inventory-recipe-known' as const, recipeKey, known: true })),
          ],
        },
        failureMessage: `尚未满足“${route.decisivePlayerValue}”的路线资格。`,
      })
    }
    addEffect({ key: routeEffectKey, operation: 'set-world-flag', payload: { flagKey: 'flag.ending.route', value: route.endingKey } })
    addEffect({ key: unlockEffectKey, operation: 'unlock-ending', payload: { endingKey: route.endingKey } })
    addEffect({ key: reachEffectKey, operation: 'reach-ending', payload: { endingKey: route.endingKey } })
    addAction(action({
      key: actionKey, category: 'quest-action', label: `走向结局：${route.decisivePlayerValue}`,
      description: route.routeSummary, actorScope: 'player', targetScope: 'none',
      locationKeys: [finalLocationKey], requirementConditionKeys: [
        selectionReadyConditionKey,
        ...(governedStoryOutcome ? [eligibilityConditionKey] : []),
      ],
      successEffectKeys: [routeEffectKey, unlockEffectKey, reachEffectKey],
      confirmationPolicy: 'always', repeatPolicy: 'once',
    }))
    return {
      endingKey: route.endingKey,
      conditionKey,
      ...(governedStoryOutcome ? { eligibilityConditionKey, eligibility } : {}),
      actionKey,
      routeEffectKey,
      unlockEffectKey,
      reachEffectKey,
    }
  })
  const endingBindings: TextOpenWorldQuestDesignDocumentsV1['endingBindings'] = {
    finalMainlineQuestKey: finalMainlineQuest.key,
    finalMainlineStageKey, finalLocationKey, selectionReadyConditionKey,
    routes: endingRouteBindings,
  }

  const trackingDefinitions = [
    ['track', 'primary'], ['track', 'pinned'], ['untrack', 'primary'], ['untrack', 'pinned'],
  ] as const
  trackingDefinitions.forEach(([operation, slot]) => {
    const effectKey = `effect.${operation}.${slot}`; const actionKey = `action.${operation}.${slot}`
    addEffect({ key: effectKey, operation: operation === 'track' ? 'track-quest' : 'untrack-quest', payload: { slot } })
    addAction(action({ key: actionKey, category: operation, label: `${operation === 'track' ? '追踪' : '取消追踪'}${slot === 'primary' ? '主任务' : '钉选任务'}`, description: '更新任务HUD追踪槽位。', targetScope: 'quest', successEffectKeys: [effectKey] }))
  })
  const settleDirectorEffect = 'effect.system.settle-director'
  addEffect({ key: settleDirectorEffect, operation: 'settle-director', payload: {} })
  addAction(action({ key: 'action.system.settle-director', category: 'director-action', label: '结算地区叙事牌组', description: '按冻结预算结算一次地区内容发牌。', actorScope: 'system', successEffectKeys: [settleDirectorEffect] }))
  const settleSchedulesEffect = 'effect.system.settle-actor-schedules'
  addEffect({ key: settleSchedulesEffect, operation: 'settle-actor-schedules', payload: {} })
  addAction(action({ key: 'action.system.settle-actor-schedules', category: 'actor-schedule-action', label: '结算角色日程', description: '按当前世界时段更新规则角色位置。', actorScope: 'system', successEffectKeys: [settleSchedulesEffect] }))

  const catalogDefinitionKeys = [
    ...input.context.progressionCatalogs.skills.map(item => item.key), ...input.context.progressionCatalogs.statuses.map(item => item.key),
    ...input.context.enemyEncounterCatalog.enemies.map(item => item.key), ...input.context.enemyEncounterCatalog.encounters.map(item => item.key),
    ...input.context.itemRewardCatalog.items.map(item => item.key), ...input.context.itemRewardCatalog.rewardContracts.map(item => item.key),
    ...input.context.itemRewardCatalog.dropTables.map(item => item.key), ...input.context.craftingEconomyCatalog.recipes.map(item => item.key),
    ...input.context.craftingEconomyCatalog.vendors.map(item => item.key), ...input.context.npcRuntimeCatalog.actors.map(item => item.key),
    ...input.context.npcRuntimeCatalog.factions.map(item => item.key), ...input.context.mapInteractionCatalog.interactions.map(item => item.key),
  ]
  const referencedCatalogDefinitionKeys = [...new Set(requirementBindings.flatMap(binding => binding.definitionKeys)
    .filter(key => catalogDefinitionKeys.includes(key)))]
  const randomSeeds = input.context.regionNarrativePacks.packs.flatMap(pack => pack.randomEventSeeds.map(seed => ({ pack, seed })))
  const nonCriticalMaterial = input.context.itemRewardCatalog.items.find(item => item.kind === 'material' && !item.critical)
  const randomEventEffectKeys = randomSeeds.map((_source, index) => {
    if (input.draft.randomEvents[index]!.kind !== 'resource' || !nonCriticalMaterial) return [] as string[]
    const key = `effect.director.event.${String(index + 1).padStart(3, '0')}.resource`
    addEffect({ key, operation: 'grant-item', payload: { itemKey: nonCriticalMaterial.key, quantity: 1 } })
    return [key]
  })
  type KnowledgeBindingV1 = NonNullable<TextOpenWorldQuestDesignDocumentsV1['knowledgeBindings']>[number]
  type AchievementBindingV1 = NonNullable<TextOpenWorldQuestDesignDocumentsV1['achievementBindings']>[number]
  const sourceOwner = (candidate: KnowledgeConfirmationCandidateV1) => {
    if (candidate.sourceKind === 'quest-reward-claim') {
      const quest = questRows.find(item => item.key === candidate.sourceKey)
        ?? fail(`Knowledge候选任务不存在:${candidate.sourceKey}`)
      const reward = rewardBindings.find(item => item.rewardContractKey === quest.rewardContractKey
        && item.sourceQuestKey === quest.key) ?? fail(`Knowledge候选任务缺少RewardContract:${quest.key}`)
      return {
        sourceActionKey: quest.claimActionKey,
        effectOwnerKind: 'reward-contract' as const,
        effectOwnerKey: reward.rewardContractKey,
        appendEffectKeys(effectKeys: string[]) {
          effectKeys.forEach(effectKey => {
            if (reward.effectKeys.includes(effectKey)) fail(`RewardContract重复绑定Effect:${reward.rewardContractKey}:${effectKey}`)
            reward.effectKeys.push(effectKey)
          })
          quest.rewardEffectKeys = [...reward.effectKeys]
        },
      }
    }
    const route = endingBindings.routes.find(item => item.endingKey === candidate.sourceKey)
      ?? fail(`Knowledge候选结局不存在:${candidate.sourceKey}`)
    const endingAction = actions.find(item => item.key === route.actionKey)
      ?? fail(`Knowledge候选结局Action不存在:${route.actionKey}`)
    return {
      sourceActionKey: route.actionKey,
      effectOwnerKind: 'action' as const,
      effectOwnerKey: route.actionKey,
      appendEffectKeys(effectKeys: string[]) {
        effectKeys.forEach(effectKey => {
          if (endingAction.successEffectKeys.includes(effectKey)) fail(`结局Action重复绑定Effect:${route.actionKey}:${effectKey}`)
          endingAction.successEffectKeys.push(effectKey)
        })
      },
    }
  }
  const knowledgeBindings: KnowledgeBindingV1[] = []
  const achievementBindings: AchievementBindingV1[] = []
  if (governedKnowledge) {
    const demands = input.context.knowledgeBindingDemands ?? fail('Knowledge编译缺少绑定需求')
    const selections = input.draft.knowledgeSelections ?? fail('Knowledge编译缺少模型选择')
    const sourceRumors = input.context.regionNarrativePacks.packs.flatMap(pack => pack.rumors.map(rumor => ({ pack, rumor })))
    demands.forEach((demand, index) => {
      const source = sourceRumors[index] ?? fail(`Knowledge缺少P7传闻:${demand.sourceRumorKey}`)
      if (source.rumor.key !== demand.sourceRumorKey || source.pack.regionKey !== demand.regionKey || !governedRumor(source.rumor)) {
        fail(`Knowledge需求与P7传闻不一致:${demand.sourceRumorKey}`)
      }
      const selection = selections[index] ?? fail(`Knowledge缺少模型选择:${demand.sourceRumorKey}`)
      const propagationLocation = demand.propagationLocationCandidates[selection.propagationLocationNumber - 1]
        ?? fail(`Knowledge传播地点选择无效:${demand.sourceRumorKey}`)
      const suffix = stableRumorSuffix(demand.sourceRumorKey)
      const knowledgeKey = `knowledge.${suffix}`
      const rumorKey = `rumor.${suffix}`
      const unreadConditionKey = `condition.knowledge.${suffix}.unread`
      addCondition({
        key: unreadConditionKey,
        expression: {
          op: 'all',
          conditions: [
            { op: 'knowledge-rumor-read', rumorKey, read: false },
            { op: 'not', condition: { op: 'knowledge-visibility', knowledgeKey, minimum: 'known' } },
          ],
        },
        failureMessage: '这条传闻已经听过，或其真相已经被确认。',
      })
      const propagationConditionKeys = [unreadConditionKey]
      if (source.rumor.minimumRevealGate.kind !== 'regional-public') {
        const stageKey = source.rumor.minimumRevealGate.stageKey
          ?? fail(`Knowledge阶段门槛缺少stageKey:${demand.sourceRumorKey}`)
        const expectedSourceKind = source.rumor.minimumRevealGate.kind === 'mainline-stage-complete'
          ? 'mainline-stage' : 'significant-stage'
        const gateQuests = questRows.filter(quest => {
          const skeleton = input.context.questSkeletons.quests.find(item => item.key === quest.key)
          return skeleton?.source.kind === expectedSourceKind && skeleton.source.sourceKey === stageKey
        })
        if (gateQuests.length !== 1) {
          fail(`Knowledge阶段门槛必须由唯一任务兑现:${demand.sourceRumorKey}:${stageKey}`)
        }
        const gateQuest = gateQuests[0]!
        const gateConditionKey = `condition.knowledge.${suffix}.gate`
        addCondition({
          key: gateConditionKey,
          expression: { op: 'quest-status', questKey: gateQuest.key, statuses: ['completed'] },
          failureMessage: '这条传闻尚未进入可以公开传播的故事阶段。',
        })
        propagationConditionKeys.push(gateConditionKey)
      }
      const confirmationBindings = selection.confirmationCandidateNumbers.map((candidateNumber, confirmationIndex) => {
        const candidate = demand.confirmationCandidates[candidateNumber - 1]
          ?? fail(`Knowledge确认候选不存在:${demand.sourceRumorKey}:${candidateNumber}`)
        const revealEffectKey = `effect.knowledge.${suffix}.confirm.${String(confirmationIndex + 1).padStart(3, '0')}`
        addEffect({ key: revealEffectKey, operation: 'reveal-knowledge', payload: { knowledgeKey, visibility: 'known' } })
        const owner = sourceOwner(candidate)
        owner.appendEffectKeys([revealEffectKey])
        return {
          order: confirmationIndex + 1,
          sourceKind: candidate.sourceKind,
          sourceKey: candidate.sourceKey,
          sourceActionKey: owner.sourceActionKey,
          effectOwnerKind: owner.effectOwnerKind,
          effectOwnerKey: owner.effectOwnerKey,
          revealEffectKey,
        }
      })
      knowledgeBindings.push({
        order: index + 1,
        sourceRumorKey: demand.sourceRumorKey,
        regionKey: demand.regionKey,
        propagationLocationKey: propagationLocation.locationKey,
        knowledgeKey,
        kind: source.rumor.subjectKind,
        subjectSourceKey: source.rumor.subjectSourceKey,
        subjectDefinitionKey: subjectDefinitionKey({ context: input.context, rumor: source.rumor }),
        truthSummary: source.rumor.truthSummary,
        sourceClaimKeys: [...source.rumor.sourceClaimKeys],
        rumorKey,
        rumorText: source.rumor.text,
        reliability: source.rumor.reliability,
        minimumRevealGate: { ...source.rumor.minimumRevealGate },
        propagationEventKey: `event.director.rumor.${suffix}`,
        propagationConditionKeys,
        confirmationBindings,
      })
    })
    const achievementCandidates = input.context.achievementBindingCandidates ?? fail('成就编译缺少候选合同')
    const achievementSelections = input.draft.achievementCandidateNumbers ?? fail('成就编译缺少模型选择')
    achievementSelections.forEach((candidateNumber, index) => {
      const candidate = achievementCandidates[candidateNumber - 1] ?? fail(`成就候选不存在:${candidateNumber}`)
      const achievementKey = `achievement.${candidate.sourceKey}`
      const earnEffectKey = `effect.achievement.${candidate.sourceKey}.earn`
      addEffect({ key: earnEffectKey, operation: 'earn-achievement', payload: { achievementKey } })
      const owner = sourceOwner(candidate)
      owner.appendEffectKeys([earnEffectKey])
      achievementBindings.push({
        order: index + 1,
        achievementKey,
        sourceKind: candidate.sourceKind,
        sourceKey: candidate.sourceKey,
        sourceActionKey: owner.sourceActionKey,
        effectOwnerKind: owner.effectOwnerKind,
        effectOwnerKey: owner.effectOwnerKey,
        earnEffectKey,
      })
    })
  }
  const questBody: Omit<TextOpenWorldQuestDesignDocumentsV1, 'questDesignDocumentsHash'> = {
    schema: 'storyforge.text-open-world-quest-design-documents', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey, mainlineThreadHash: input.context.mainlineThread.mainlineThreadHash,
    significantThreadsHash: input.context.significantThreads.significantThreadsHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
    progressionCatalogsHash: input.context.progressionCatalogs.progressionCatalogsHash,
    enemyEncounterCatalogHash: input.context.enemyEncounterCatalog.enemyEncounterCatalogHash,
    itemRewardCatalogHash: input.context.itemRewardCatalog.itemRewardCatalogHash,
    craftingEconomyCatalogHash: input.context.craftingEconomyCatalog.craftingEconomyCatalogHash,
    npcRuntimeCatalogHash: input.context.npcRuntimeCatalog.npcRuntimeCatalogHash,
    mapInteractionCatalogHash: input.context.mapInteractionCatalog.mapInteractionCatalogHash,
    requirementBindings, quests: questRows, stages: stageRows, objectives: objectiveRows, conditions, effects, actions,
    ...(governedKnowledge ? { knowledgeBindings, achievementBindings } : {}),
    ...(governedStoryOutcome ? { storyOutcomeBindings } : {}),
    endingBindings,
    catalogBindings: {
      skills: skillBindings, enemies: enemyBindings, encounters: encounterBindings, items: itemBindings,
      rewards: rewardBindings, dropTables: dropBindings, recipes: recipeBindings, vendors: vendorBindings,
      actors: actorBindings, interactions: interactionBindings, edges: edgeBindings, fastTravelPoints: fastTravelBindings,
    },
    coverage: {
      requiredQuestKeys: input.context.questSkeletons.quests.map(quest => quest.key), finalizedQuestKeys: questRows.map(quest => quest.key),
      requiredObjectiveKeys: input.context.questSkeletons.objectives.map(objective => objective.key), finalizedObjectiveKeys: objectiveRows.map(objective => objective.key),
      requiredRequirementKeys: input.context.contentRequirementManifest.requirements.map(requirement => requirement.key),
      boundRequirementKeys: requirementBindings.map(binding => binding.requirementKey),
      encounterKeys: input.context.enemyEncounterCatalog.encounters.map(encounter => encounter.key),
      encounterKeysWithRewardAndAction: encounterBindings.map(binding => binding.encounterKey), catalogDefinitionKeys,
      referencedCatalogDefinitionKeys,
      requiredEndingKeys: input.context.mainlineThread.thread.endingKeys,
      boundEndingKeys: endingRouteBindings.map(binding => binding.endingKey),
      ...(governedKnowledge ? {
        requiredKnowledgeKeys: knowledgeBindings.map(binding => binding.knowledgeKey),
        confirmableKnowledgeKeys: knowledgeBindings.filter(binding => binding.confirmationBindings.length > 0).map(binding => binding.knowledgeKey),
        requiredRumorSeedKeys: knowledgeBindings.map(binding => binding.sourceRumorKey),
        boundRumorSeedKeys: knowledgeBindings.map(binding => binding.sourceRumorKey),
        requiredAchievementKeys: achievementBindings.map(binding => binding.achievementKey),
        earnableAchievementKeys: achievementBindings.map(binding => binding.achievementKey),
      } : {}),
      orphanActionKeys: [], orphanEffectKeys: [], uncoveredRequirementKeys: [],
    },
    governance: {
      referenceOwner: 'deterministic-compiler', objectiveSemanticsOwner: 'model-validated', protectedStoriesWait: true,
      ordinaryFailureAllowed: true, criticalArrivalNeverSoleTrigger: true, allObjectivesHaveActions: true,
      allRewardsClaimableOnce: true, allTimedQuestsHaveExpirationCoverage: true,
      ...(governedLifecycle ? {
        allAbandonableQuestStagesCovered: true as const,
        restartActionsRequireOriginalOfferRoute: true as const,
      } : {}),
      ...(governedCombatMechanics ? { structuredCombatMechanicsReady: true as const } : {}),
      ...(governedKnowledge ? {
        allRumorsHaveUniquePropagationPath: true as const,
        allKnowledgeHasConfirmationPath: true as const,
        allAchievementsOneTimeReachable: true as const,
        knowledgeProgressReady: true as const,
      } : {}),
      ...(governedStoryOutcome ? { storyOutcomesRuntimeBound: true as const } : {}),
      ...(governedProtectedStoryReveal ? { protectedStoryRevealActionsReady: true as const } : {}),
      allCatalogBindingsResolved: true,
      allEndingsRuntimeBound: true, sceneBindingsDeferred: true, questAndEncounterBindingsReady: true,
    },
    basisHash: await hashProductProductionValueV2({
      contextSelectionHash: input.context.contextSelectionHash,
      inputHashes: artifactsHashes(input.context),
      questKeys: questRows.map(quest => quest.key), actionKeys: actions.map(item => item.key), effectKeys: effects.map(item => item.key),
    }), createdAt: input.createdAt,
  }
  assertQuestArtifact(questBody)
  const questDesignDocuments: TextOpenWorldQuestDesignDocumentsV1 = {
    ...questBody, questDesignDocumentsHash: await hashProductProductionValueV2(questBody),
  }

  const templates = input.context.questSkeletons.quests.filter(quest => quest.type === 'template').map((quest, index) => {
    const draft = input.draft.templates[index]!
    const requirementKeys = [1, 2, 3].map(number => `presentation-requirement.${quest.key}.${number}`) as [string, string, string]
    return {
      key: `template.director.${String(index + 1).padStart(3, '0')}`, questKey: quest.key, regionKeys: quest.regionKeys,
      variantTextRequirementKeys: requirementKeys, fingerprint: `fingerprint.template.${String(index + 1).padStart(3, '0')}`,
      cooldownMinutes: draft.cooldownMinutes, conditionKeys: questRows.find(item => item.key === quest.key)!.prerequisiteConditionKeys,
      levelBand: { minimum: 1, maximum: Math.min(5, Math.max(1, Math.ceil(quest.estimatedMinutes / 10))) },
      category: draft.category, intensity: draft.intensity, weight: draft.weight,
      presentationBinding: { status: 'variant-text-unbound' as const, variantTextKeys: [] as [] },
    }
  })
  const randomEvents: TextOpenWorldDirectorDecksV1['randomEvents'] = randomSeeds.map(({ pack, seed }, index) => {
    const draft = input.draft.randomEvents[index]!
    const regionEncounter = input.context.enemyEncounterCatalog.encounters.find(encounter => encounter.regionKey === pack.regionKey)
    const actionKeys = draft.kind === 'encounter' && regionEncounter ? [`action.start.${regionEncounter.key}`] : []
    const effectKeys = randomEventEffectKeys[index]!
    return {
      key: `event.director.${String(index + 1).padStart(3, '0')}`, sourceSeedKey: seed.key,
      title: seed.title, description: draft.description, kind: draft.kind, regionKeys: [pack.regionKey], locationKeys: seed.locationKeys,
      actionKeys, effectKeys, conditionKeys: [], fingerprint: `fingerprint.event.${String(index + 1).padStart(3, '0')}`,
      rumorRequirementKey: draft.kind === 'clue' ? `rumor-requirement.${seed.key}` : null,
      ...(governedKnowledge ? { rumorKey: null } : {}),
      upgradeTemplateKey: draft.upgradeTemplateNumber === null ? null : templates[draft.upgradeTemplateNumber - 1]!.key,
      intensity: draft.intensity, weight: draft.weight, cooldownMinutes: draft.cooldownMinutes,
    }
  })
  if (governedKnowledge) {
    knowledgeBindings.forEach(binding => {
      randomEvents.push({
        key: binding.propagationEventKey,
        sourceSeedKey: binding.sourceRumorKey,
        title: `传闻线索 ${String(binding.order).padStart(3, '0')}`,
        description: binding.rumorText,
        kind: 'clue',
        regionKeys: [binding.regionKey],
        locationKeys: [binding.propagationLocationKey],
        actionKeys: [],
        effectKeys: [],
        conditionKeys: [...binding.propagationConditionKeys],
        fingerprint: `fingerprint.rumor.${stableRumorSuffix(binding.sourceRumorKey)}`,
        rumorRequirementKey: `rumor-requirement.${binding.sourceRumorKey}`,
        rumorKey: binding.rumorKey,
        upgradeTemplateKey: null,
        intensity: 1,
        weight: 20,
        cooldownMinutes: 1_440,
      })
    })
  }
  const decks = input.context.mapInteractionCatalog.regions.map((region, index) => {
    const draft = input.draft.decks[index]!
    return {
      regionKey: region.key,
      fixedQuestKeys: questRows.filter(quest => quest.type === 'ordinary' && quest.regionKeys.includes(region.key)).map(quest => quest.key),
      templateKeys: templates.filter(template => template.regionKeys.includes(region.key)).map(template => template.key),
      randomEventKeys: randomEvents.filter(event => event.regionKeys.includes(region.key)).map(event => event.key),
      triggerKinds: draft.triggerKinds, maximumRevealed: draft.maximumRevealed, maximumActive: draft.maximumActive,
      cooldownMinutes: draft.cooldownMinutes, blankWeight: draft.blankWeight,
    }
  })
  const directorBody: Omit<TextOpenWorldDirectorDecksV1, 'directorDecksHash'> = {
    schema: 'storyforge.text-open-world-director-decks', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey, regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    questDesignDocumentsHash: questDesignDocuments.questDesignDocumentsHash,
    mapInteractionCatalogHash: input.context.mapInteractionCatalog.mapInteractionCatalogHash,
    rules: {
      globalMaximumRevealed: Math.min(8, decks.reduce((sum, deck) => sum + deck.maximumRevealed, 0)),
      globalMaximumActive: Math.min(4, decks.reduce((sum, deck) => sum + deck.maximumActive, 0)),
      maximumQuestInstances: Math.max(20, questRows.filter(quest => quest.type !== 'template').length + 8),
      highIntensityStreakLimit: 2, historyLimit: 64, maximumSettlementIntervals: 32,
      systemActionKey: 'action.system.settle-director',
    },
    decks, templates, randomEvents,
    regionRules: input.context.mapInteractionCatalog.regions.map(region => ({
      regionKey: region.key, settlementIntervalMinutes: 1_440, initialPressure: 10, minimumPressure: 0, maximumPressure: 100,
      driftPerInterval: 5, stateBands: [{ key: 'stable', minimumPressure: 0 }, { key: 'strained', minimumPressure: 30 }, { key: 'crisis', minimumPressure: 70 }],
    })),
    coverage: {
      requiredRegionKeys: input.context.mapInteractionCatalog.regions.map(region => region.key), coveredRegionKeys: decks.map(deck => deck.regionKey),
      ordinaryQuestKeys: questRows.filter(quest => quest.type === 'ordinary').map(quest => quest.key), fixedQuestKeys: decks.flatMap(deck => deck.fixedQuestKeys),
      templateQuestKeys: questRows.filter(quest => quest.type === 'template').map(quest => quest.key), coveredTemplateQuestKeys: templates.map(template => template.questKey),
      randomEventSeedKeys: randomSeeds.map(row => row.seed.key),
      coveredRandomEventSeedKeys: randomEvents.filter(event => !event.rumorKey).map(event => event.sourceSeedKey),
      ...(governedKnowledge ? {
        requiredRumorSeedKeys: knowledgeBindings.map(binding => binding.sourceRumorKey),
        boundRumorSeedKeys: randomEvents.filter(event => event.rumorKey).map(event => event.sourceSeedKey),
      } : {}),
      emptyPlayableDeckRegionKeys: [] as [],
    },
    governance: {
      regionalBudgetsBounded: true, protectedStoriesExcluded: true, mainlinePressureDisabled: true,
      duplicateFingerprintsRejected: true, highIntensityStreakBounded: true, runtimeHistorySessionOwned: true,
      presentationVariantsDeferred: true, directorRuntimeReadyExceptPresentation: true,
      ...(governedKnowledge ? { allRumorsHaveUniquePropagationPath: true as const, knowledgeProgressReady: true as const } : {}),
    },
    basisHash: await hashProductProductionValueV2({
      questDesignDocumentsHash: questDesignDocuments.questDesignDocumentsHash,
      regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
      mapInteractionCatalogHash: input.context.mapInteractionCatalog.mapInteractionCatalogHash,
      deckRegions: decks.map(deck => deck.regionKey), eventSeedKeys: randomSeeds.map(row => row.seed.key),
      ...(governedKnowledge ? { rumorSeedKeys: knowledgeBindings.map(binding => binding.sourceRumorKey) } : {}),
    }), createdAt: input.createdAt,
  }
  assertDirectorArtifact(directorBody)
  if (governedKnowledge) {
    validateTextOpenWorldKnowledgeProductionClosureV1({
      quests: questDesignDocuments,
      director: {
        ...directorBody,
        directorDecksHash: await hashProductProductionValueV2(directorBody),
      },
      questSkeletons: input.context.questSkeletons,
    })
    assertTextOpenWorldSceneDemandCapacityV1({
      quests: questDesignDocuments.quests,
      objectives: questDesignDocuments.objectives,
      actors: input.context.npcRuntimeCatalog.actors,
      interactions: input.context.mapInteractionCatalog.interactions,
      randomEvents: directorBody.randomEvents,
    })
  }
  return {
    questDesignDocuments,
    directorDecks: { ...directorBody, directorDecksHash: await hashProductProductionValueV2(directorBody) },
  }
}

function artifactsHashes(context: TextOpenWorldQuestFinalizeInputContextV1) {
  return {
    mainlineThreadHash: context.mainlineThread.mainlineThreadHash,
    significantThreadsHash: context.significantThreads.significantThreadsHash,
    regionNarrativePacksHash: context.regionNarrativePacks.regionNarrativePacksHash,
    questSkeletonsHash: context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: context.contentRequirementManifest.contentRequirementManifestHash,
    progressionCatalogsHash: context.progressionCatalogs.progressionCatalogsHash,
    enemyEncounterCatalogHash: context.enemyEncounterCatalog.enemyEncounterCatalogHash,
    itemRewardCatalogHash: context.itemRewardCatalog.itemRewardCatalogHash,
    craftingEconomyCatalogHash: context.craftingEconomyCatalog.craftingEconomyCatalogHash,
    npcRuntimeCatalogHash: context.npcRuntimeCatalog.npcRuntimeCatalogHash,
    mapInteractionCatalogHash: context.mapInteractionCatalog.mapInteractionCatalogHash,
  }
}

function assertQuestArtifact(artifact: Omit<TextOpenWorldQuestDesignDocumentsV1, 'questDesignDocumentsHash'>): void {
  const lifecycleGovernanceDeclared = artifact.governance.allAbandonableQuestStagesCovered !== undefined
    || artifact.governance.restartActionsRequireOriginalOfferRoute !== undefined
  const governedLifecycle = artifact.governance.allAbandonableQuestStagesCovered === true
    && artifact.governance.restartActionsRequireOriginalOfferRoute === true
  const knowledgeGovernanceDeclared = artifact.knowledgeBindings !== undefined
    || artifact.achievementBindings !== undefined
    || artifact.governance.knowledgeProgressReady !== undefined
    || artifact.coverage.requiredRumorSeedKeys !== undefined
  const governedKnowledge = artifact.knowledgeBindings !== undefined
    && artifact.achievementBindings !== undefined
    && artifact.governance.allRumorsHaveUniquePropagationPath === true
    && artifact.governance.allKnowledgeHasConfirmationPath === true
    && artifact.governance.allAchievementsOneTimeReachable === true
    && artifact.governance.knowledgeProgressReady === true
  const knowledgeBindings = artifact.knowledgeBindings ?? []
  const achievementBindings = artifact.achievementBindings ?? []
  const storyOutcomeDeclared = artifact.storyOutcomeBindings !== undefined
    || artifact.governance.storyOutcomesRuntimeBound !== undefined
    || artifact.endingBindings.routes.some(route => route.eligibilityConditionKey !== undefined || route.eligibility !== undefined)
  const governedStoryOutcome = artifact.storyOutcomeBindings !== undefined
    && artifact.governance.storyOutcomesRuntimeBound === true
    && artifact.endingBindings.routes.every(route => route.eligibilityConditionKey !== undefined && route.eligibility !== undefined)
  const storyOutcomeBindings = artifact.storyOutcomeBindings ?? []
  const ownerEffectKeys = (binding: {
    effectOwnerKind: 'reward-contract' | 'action'
    effectOwnerKey: string
  }): string[] => binding.effectOwnerKind === 'reward-contract'
    ? artifact.catalogBindings.rewards.find(item => item.rewardContractKey === binding.effectOwnerKey)?.effectKeys ?? []
    : artifact.actions.find(item => item.key === binding.effectOwnerKey)?.successEffectKeys ?? []
  const sourceOwnerValid = (binding: {
    sourceKind: KnowledgeConfirmationSourceKindV1
    sourceKey: string
    sourceActionKey: string
    effectOwnerKind: 'reward-contract' | 'action'
    effectOwnerKey: string
  }): boolean => {
    if (binding.sourceKind === 'quest-reward-claim') {
      const quest = artifact.quests.find(item => item.key === binding.sourceKey)
      return quest != null && quest.claimActionKey === binding.sourceActionKey
        && quest.rewardContractKey === binding.effectOwnerKey && binding.effectOwnerKind === 'reward-contract'
    }
    const route = artifact.endingBindings.routes.find(item => item.endingKey === binding.sourceKey)
    return route != null && route.actionKey === binding.sourceActionKey
      && route.actionKey === binding.effectOwnerKey && binding.effectOwnerKind === 'action'
  }
  const knowledgeRowsInvalid = knowledgeBindings.some((binding, index) => {
    const suffix = stableRumorSuffix(binding.sourceRumorKey)
    const unread = artifact.conditions.find(item => item.key === binding.propagationConditionKeys[0])
    const gate = binding.propagationConditionKeys[1]
      ? artifact.conditions.find(item => item.key === binding.propagationConditionKeys[1]) : null
    const gateExpression = gate?.expression
    const gateQuest = gateExpression?.op === 'quest-status'
      ? artifact.quests.find(item => item.key === gateExpression.questKey) : undefined
    const expectedGateQuestType = binding.minimumRevealGate.kind === 'mainline-stage-complete'
      ? 'mainline' : 'significant'
    const expectedUnread = {
      op: 'all', conditions: [
        { op: 'knowledge-rumor-read', rumorKey: binding.rumorKey, read: false },
        { op: 'not', condition: { op: 'knowledge-visibility', knowledgeKey: binding.knowledgeKey, minimum: 'known' } },
      ],
    }
    return binding.order !== index + 1
      || binding.knowledgeKey !== `knowledge.${suffix}` || binding.rumorKey !== `rumor.${suffix}`
      || binding.propagationEventKey !== `event.director.rumor.${suffix}`
      || binding.propagationConditionKeys[0] !== `condition.knowledge.${suffix}.unread`
      || !binding.truthSummary.trim() || !binding.rumorText.trim() || !binding.sourceClaimKeys.length
      || canonicalProductProductionJsonV2(unread?.expression) !== canonicalProductProductionJsonV2(expectedUnread)
      || (binding.minimumRevealGate.kind === 'regional-public'
        ? binding.minimumRevealGate.stageKey !== null || binding.propagationConditionKeys.length !== 1
        : binding.minimumRevealGate.stageKey === null || binding.propagationConditionKeys.length !== 2
          || binding.propagationConditionKeys[1] !== `condition.knowledge.${suffix}.gate`
          || gate?.expression.op !== 'quest-status' || !same(gate.expression.statuses, ['completed'])
          || gateQuest?.type !== expectedGateQuestType)
      || binding.confirmationBindings.length < 1 || binding.confirmationBindings.length > 3
      || binding.confirmationBindings.some((confirmation, confirmationIndex) => {
        const effect = artifact.effects.find(item => item.key === confirmation.revealEffectKey)
        return confirmation.order !== confirmationIndex + 1
          || confirmation.revealEffectKey !== `effect.knowledge.${suffix}.confirm.${String(confirmationIndex + 1).padStart(3, '0')}`
          || !sourceOwnerValid(confirmation)
          || ownerEffectKeys(confirmation).filter(key => key === confirmation.revealEffectKey).length !== 1
          || canonicalProductProductionJsonV2(effect) !== canonicalProductProductionJsonV2({
            key: confirmation.revealEffectKey,
            operation: 'reveal-knowledge',
            payload: { knowledgeKey: binding.knowledgeKey, visibility: 'known' },
          })
      })
  })
  const achievementRowsInvalid = achievementBindings.some((binding, index) => {
    const earn = artifact.effects.find(item => item.key === binding.earnEffectKey)
    const ownerEffects = ownerEffectKeys(binding)
    return binding.order !== index + 1 || !sourceOwnerValid(binding)
      || binding.achievementKey !== `achievement.${binding.sourceKey}`
      || binding.earnEffectKey !== `effect.achievement.${binding.sourceKey}.earn`
      || canonicalProductProductionJsonV2(earn) !== canonicalProductProductionJsonV2({
        key: binding.earnEffectKey,
        operation: 'earn-achievement',
        payload: { achievementKey: binding.achievementKey },
      })
      || ownerEffects.filter(key => key === binding.earnEffectKey).length !== 1
  })
  const knowledgeCoverageInvalid = knowledgeGovernanceDeclared && (!governedKnowledge
    || knowledgeRowsInvalid || achievementRowsInvalid
    || achievementBindings.length < 3 || achievementBindings.length > 6
    || !achievementBindings.some(binding => binding.sourceKind === 'quest-reward-claim')
    || !achievementBindings.some(binding => binding.sourceKind === 'ending-action')
    || new Set(knowledgeBindings.map(binding => binding.knowledgeKey)).size !== knowledgeBindings.length
    || new Set(knowledgeBindings.map(binding => binding.rumorKey)).size !== knowledgeBindings.length
    || new Set(knowledgeBindings.map(binding => binding.sourceRumorKey)).size !== knowledgeBindings.length
    || new Set(achievementBindings.map(binding => binding.achievementKey)).size !== achievementBindings.length
    || !same(artifact.coverage.requiredKnowledgeKeys ?? [], knowledgeBindings.map(binding => binding.knowledgeKey))
    || !same(artifact.coverage.confirmableKnowledgeKeys ?? [], knowledgeBindings.map(binding => binding.knowledgeKey))
    || !same(artifact.coverage.requiredRumorSeedKeys ?? [], knowledgeBindings.map(binding => binding.sourceRumorKey))
    || !same(artifact.coverage.boundRumorSeedKeys ?? [], knowledgeBindings.map(binding => binding.sourceRumorKey))
    || !same(artifact.coverage.requiredAchievementKeys ?? [], achievementBindings.map(binding => binding.achievementKey))
    || !same(artifact.coverage.earnableAchievementKeys ?? [], achievementBindings.map(binding => binding.achievementKey)))
  const questTransitionsFor = (actionKey: string) => {
    const action = artifact.actions.find(item => item.key === actionKey)
    return action?.successEffectKeys.map(effectKey => artifact.effects.find(effect => effect.key === effectKey))
      .filter((effect): effect is Extract<TextOpenWorldEffectDefinitionV1, { operation: 'transition-quest' }> => effect?.operation === 'transition-quest') ?? []
  }
  const abandonCoverageInvalid = artifact.quests.some(quest => {
    if (quest.abandonActionKey === null) return false
    const stageCoverage = artifact.actions.filter(action => action.category === 'abandon-quest')
      .flatMap(action => questTransitionsFor(action.key))
      .filter(effect => effect.payload.questKey === quest.key && effect.payload.status === 'abandoned')
      .map(effect => effect.payload.stageKey ?? '__unstarted__')
    return !same(stageCoverage, ['__unstarted__', ...quest.stageKeys])
  })
  const restartCoverageInvalid = artifact.quests.some(quest => {
    const eligible = quest.type === 'ordinary' && quest.lifecyclePolicy === 'abandon-restart'
      && quest.timePolicy === 'waits' && quest.instantiationPolicy === 'session-start'
    const action = artifact.actions.find(item => item.key === `action.restart.${quest.key}`)
    if (!eligible) return action != null
    const transitions = action ? questTransitionsFor(action.key) : []
    return action?.category !== 'restart-quest' || action.actorScope !== 'player' || action.targetScope !== 'quest'
      || canonicalProductProductionJsonV2(transitions.map(effect => ({
        status: effect.payload.status, stageKey: effect.payload.stageKey,
      }))) !== canonicalProductProductionJsonV2([
        { status: 'available', stageKey: null }, { status: 'revealed', stageKey: null },
        { status: 'accepted', stageKey: null }, { status: 'active', stageKey: quest.stageKeys[0]! },
      ])
  })
  const protectedRevealDeclared = artifact.governance.protectedStoryRevealActionsReady !== undefined
  const protectedRevealReady = artifact.governance.protectedStoryRevealActionsReady === true
  const protectedLockedQuests = artifact.quests.filter(quest => (
    (quest.type === 'mainline' || quest.type === 'significant')
    && quest.initialStatus === 'locked'
    && quest.lifecyclePolicy === 'protected-wait'
    && quest.timePolicy === 'waits'
    && quest.instantiationPolicy === 'session-start'
  ))
  const protectedRevealCoverageInvalid = protectedRevealDeclared && (
    !protectedRevealReady
    || artifact.governance.structuredCombatMechanicsReady !== true
    || !governedLifecycle
    || protectedLockedQuests.some(quest => {
      const action = artifact.actions.find(item => item.key === `action.reveal.${quest.key}`)
      const unlock = artifact.effects.find(item => item.key === `effect.unlock.${quest.key}`)
      const reveal = artifact.effects.find(item => item.key === `effect.reveal.${quest.key}`)
      return canonicalProductProductionJsonV2(unlock) !== canonicalProductProductionJsonV2({
        key: `effect.unlock.${quest.key}`,
        operation: 'transition-quest',
        payload: { questKey: quest.key, status: 'available', stageKey: null },
      }) || canonicalProductProductionJsonV2(reveal) !== canonicalProductProductionJsonV2({
        key: `effect.reveal.${quest.key}`,
        operation: 'transition-quest',
        payload: { questKey: quest.key, status: 'revealed', stageKey: null },
      }) || !action || action.category !== 'quest-action' || action.actorScope !== 'system'
        || action.targetScope !== 'quest' || action.locationKeys.length
        || canonicalProductProductionJsonV2(action.requirementConditionKeys)
          !== canonicalProductProductionJsonV2(quest.prerequisiteConditionKeys)
        || action.costEffectKeys.length || action.failureEffectKeys.length
        || canonicalProductProductionJsonV2(action.successEffectKeys)
          !== canonicalProductProductionJsonV2([`effect.unlock.${quest.key}`, `effect.reveal.${quest.key}`])
        || action.timeCostMinutes !== 0 || action.confirmationPolicy !== 'never'
        || action.repeatPolicy !== 'repeatable' || action.cooldownMinutes !== null
    })
    || artifact.actions.some(action => {
      const transitions = questTransitionsFor(action.key)
      if (!transitions.some(effect => effect.payload.status === 'available' || effect.payload.status === 'revealed')) return false
      return !protectedLockedQuests.some(quest => action.key === `action.reveal.${quest.key}`)
        && action.category === 'quest-action' && action.actorScope === 'system'
    })
  )
  const storyOutcomeCoverageInvalid = storyOutcomeDeclared && (
    !governedStoryOutcome
    || !storyOutcomeBindings.length
    || new Set(storyOutcomeBindings.map(binding => binding.consequencePlanKey)).size !== storyOutcomeBindings.length
    || storyOutcomeBindings.some(binding => {
      const stage = artifact.stages.find(item => item.key === binding.questStageKey && item.questKey === binding.questKey)
      const action = stage ? artifact.actions.find(item => item.key === stage.completionActionKey) : null
      return binding.effectKeys.length < 1
        || new Set(binding.effectKeys).size !== binding.effectKeys.length
        || binding.threadKey.length === 0 || binding.sourceStageKey.length === 0
        || !action
        || binding.effectKeys.some(effectKey => (
          !artifact.effects.some(effect => effect.key === effectKey)
          || action.successEffectKeys.filter(key => key === effectKey).length !== 1
        ))
    })
    || new Set(artifact.endingBindings.routes.map(route => canonicalProductProductionJsonV2(route.eligibility))).size
      !== artifact.endingBindings.routes.length
  )
  if (!same(artifact.coverage.requiredQuestKeys, artifact.coverage.finalizedQuestKeys)
    || !same(artifact.coverage.requiredObjectiveKeys, artifact.coverage.finalizedObjectiveKeys)
    || !same(artifact.coverage.requiredRequirementKeys, artifact.coverage.boundRequirementKeys)
    || !same(artifact.coverage.encounterKeys, artifact.coverage.encounterKeysWithRewardAndAction)
    || !same(artifact.coverage.requiredEndingKeys, artifact.coverage.boundEndingKeys)
    || artifact.requirementBindings.some(binding => !binding.definitionKeys.length)
    || artifact.objectives.some(objective => !objective.completionActionKey || !objective.completionConditionKeys.length)
    || artifact.quests.some(quest => (quest.type === 'mainline' || quest.type === 'significant')
      && (quest.lifecyclePolicy !== 'protected-wait' || quest.timePolicy !== 'waits' || quest.abandonActionKey !== null))
    || artifact.quests.some(quest => quest.timePolicy === 'timed' && quest.expirationActionKeys.length !== quest.stageKeys.length + 1)
    || lifecycleGovernanceDeclared && (!governedLifecycle || abandonCoverageInvalid || restartCoverageInvalid)
    || protectedRevealCoverageInvalid
    || knowledgeCoverageInvalid
    || storyOutcomeCoverageInvalid
    || artifact.catalogBindings.encounters.some(binding => !binding.rewardContractKey || !binding.startActionKey)
    || new Set(artifact.conditions.map(item => item.key)).size !== artifact.conditions.length
    || new Set(artifact.effects.map(item => item.key)).size !== artifact.effects.length
    || new Set(artifact.actions.map(item => item.key)).size !== artifact.actions.length
    || new Set(artifact.endingBindings.routes.map(item => item.endingKey)).size !== artifact.endingBindings.routes.length
    || !artifact.governance.allEndingsRuntimeBound) fail('QuestDesign覆盖、保护、限时、结局、目录引用或运行定义未闭合')
  const actionKeys = new Set(artifact.actions.map(item => item.key)); const effectKeys = new Set(artifact.effects.map(item => item.key)); const conditionKeys = new Set(artifact.conditions.map(item => item.key))
  artifact.actions.forEach(item => {
    if ([...item.requirementConditionKeys].some(key => !conditionKeys.has(key))
      || [...item.costEffectKeys, ...item.successEffectKeys, ...item.failureEffectKeys].some(key => !effectKeys.has(key))) fail(`Action引用未定义:${item.key}`)
  })
  artifact.objectives.forEach(objective => {
    if (!actionKeys.has(objective.completionActionKey) || objective.supportActionKeys.some(key => !actionKeys.has(key))) fail(`Objective Action未定义:${objective.key}`)
  })
  const finalQuest = artifact.quests.find(quest => quest.key === artifact.endingBindings.finalMainlineQuestKey)
  const selectionReady = artifact.conditions.find(condition => condition.key === artifact.endingBindings.selectionReadyConditionKey)
  if (!finalQuest || finalQuest.type !== 'mainline'
    || canonicalProductProductionJsonV2(selectionReady?.expression) !== canonicalProductProductionJsonV2({
      op: 'quest-status', questKey: finalQuest.key, statuses: ['completed'],
    })) fail('结局选择入口没有绑定最终主线完成条件')
  artifact.endingBindings.routes.forEach(binding => {
    const condition = artifact.conditions.find(item => item.key === binding.conditionKey)
    const eligibilityCondition = binding.eligibilityConditionKey === undefined
      ? undefined
      : artifact.conditions.find(item => item.key === binding.eligibilityConditionKey)
    const routeEffect = artifact.effects.find(item => item.key === binding.routeEffectKey)
    const unlockEffect = artifact.effects.find(item => item.key === binding.unlockEffectKey)
    const reachEffect = artifact.effects.find(item => item.key === binding.reachEffectKey)
    const endingAction = artifact.actions.find(item => item.key === binding.actionKey)
    const governedSuffixEffectKeys = [
      ...knowledgeBindings.flatMap(knowledge => knowledge.confirmationBindings
        .filter(confirmation => confirmation.sourceKind === 'ending-action' && confirmation.sourceKey === binding.endingKey)
        .map(confirmation => confirmation.revealEffectKey)),
      ...achievementBindings.filter(achievement => achievement.sourceKind === 'ending-action'
        && achievement.sourceKey === binding.endingKey)
        .map(achievement => achievement.earnEffectKey),
    ]
    const expectedEligibilityExpression = binding.eligibility === undefined ? undefined : {
      op: 'all' as const,
      conditions: [
        ...binding.eligibility.requiredQuestKeys.map(questKey => ({
          op: 'quest-status' as const, questKey, statuses: ['completed' as const],
        })),
        ...binding.eligibility.anyQuestKeyGroups.map(questKeys => ({
          op: 'any' as const,
          conditions: questKeys.map(questKey => ({
            op: 'quest-status' as const, questKey, statuses: ['completed' as const],
          })),
        })),
        ...binding.eligibility.requiredFactionAffinities.map(item => ({
          op: 'relation-faction-affinity' as const,
          factionKey: item.factionKey,
          comparator: 'gte' as const,
          value: item.minimum,
        })),
        ...binding.eligibility.requiredRecipeKeys.map(recipeKey => ({
          op: 'inventory-recipe-known' as const, recipeKey, known: true,
        })),
      ],
    }
    const expectedRequirementConditionKeys = [
      artifact.endingBindings.selectionReadyConditionKey,
      ...(binding.eligibilityConditionKey === undefined ? [] : [binding.eligibilityConditionKey]),
    ]
    if (canonicalProductProductionJsonV2(condition?.expression) !== canonicalProductProductionJsonV2({
      op: 'all', conditions: [
        { op: 'quest-status', questKey: finalQuest.key, statuses: ['completed'] },
        { op: 'world-flag', flagKey: 'flag.ending.route', value: binding.endingKey },
      ],
    })
      || (binding.eligibilityConditionKey === undefined) !== (binding.eligibility === undefined)
      || (expectedEligibilityExpression === undefined
        ? eligibilityCondition !== undefined
        : !eligibilityCondition || canonicalProductProductionJsonV2(eligibilityCondition.expression)
          !== canonicalProductProductionJsonV2(expectedEligibilityExpression))
      || (binding.eligibility !== undefined && expectedEligibilityExpression?.conditions.length === 0)
      || canonicalProductProductionJsonV2(routeEffect) !== canonicalProductProductionJsonV2({
        key: binding.routeEffectKey, operation: 'set-world-flag', payload: { flagKey: 'flag.ending.route', value: binding.endingKey },
      })
      || canonicalProductProductionJsonV2(unlockEffect) !== canonicalProductProductionJsonV2({
        key: binding.unlockEffectKey, operation: 'unlock-ending', payload: { endingKey: binding.endingKey },
      })
      || canonicalProductProductionJsonV2(reachEffect) !== canonicalProductProductionJsonV2({
        key: binding.reachEffectKey, operation: 'reach-ending', payload: { endingKey: binding.endingKey },
      })
      || !endingAction || endingAction.category !== 'quest-action' || endingAction.actorScope !== 'player'
      || endingAction.targetScope !== 'none'
      || !same(endingAction.locationKeys, [artifact.endingBindings.finalLocationKey])
      || !same(endingAction.requirementConditionKeys, expectedRequirementConditionKeys)
      || canonicalProductProductionJsonV2(endingAction.successEffectKeys)
        !== canonicalProductProductionJsonV2([
          binding.routeEffectKey, binding.unlockEffectKey, binding.reachEffectKey, ...governedSuffixEffectKeys,
        ])
      || endingAction.costEffectKeys.length || endingAction.failureEffectKeys.length
      || endingAction.confirmationPolicy !== 'always' || endingAction.repeatPolicy !== 'once') {
      fail(`结局运行绑定没有形成唯一Condition/Action/Effect闭环:${binding.endingKey}`)
    }
  })
}

function assertDirectorArtifact(artifact: Omit<TextOpenWorldDirectorDecksV1, 'directorDecksHash'>): void {
  const knowledgeDeclared = artifact.coverage.requiredRumorSeedKeys !== undefined
    || artifact.coverage.boundRumorSeedKeys !== undefined
    || artifact.governance.knowledgeProgressReady !== undefined
  const governedKnowledge = artifact.coverage.requiredRumorSeedKeys !== undefined
    && artifact.coverage.boundRumorSeedKeys !== undefined
    && artifact.governance.allRumorsHaveUniquePropagationPath === true
    && artifact.governance.knowledgeProgressReady === true
  const rumorEvents = artifact.randomEvents.filter(event => typeof event.rumorKey === 'string')
  const originalEvents = artifact.randomEvents.filter(event => event.rumorKey == null)
  if (!same(artifact.coverage.requiredRegionKeys, artifact.coverage.coveredRegionKeys)
    || !same(artifact.coverage.ordinaryQuestKeys, artifact.coverage.fixedQuestKeys)
    || !same(artifact.coverage.templateQuestKeys, artifact.coverage.coveredTemplateQuestKeys)
    || !same(artifact.coverage.randomEventSeedKeys, artifact.coverage.coveredRandomEventSeedKeys)
    || artifact.decks.some(deck => !deck.triggerKinds.length || deck.maximumActive > deck.maximumRevealed
      || (!deck.fixedQuestKeys.length && !deck.templateKeys.length && !deck.randomEventKeys.length))
    || new Set([...artifact.templates.map(item => item.fingerprint), ...artifact.randomEvents.map(item => item.fingerprint)]).size
      !== artifact.templates.length + artifact.randomEvents.length
    || artifact.randomEvents.some(event => (event.kind === 'quest-upgrade') !== (event.upgradeTemplateKey !== null))
    || knowledgeDeclared && (!governedKnowledge
      || artifact.randomEvents.some(event => !Object.prototype.hasOwnProperty.call(event, 'rumorKey'))
      || originalEvents.some(event => event.kind === 'clue' || event.rumorKey !== null)
      || rumorEvents.some(event => event.kind !== 'clue' || event.actionKeys.length || event.effectKeys.length
        || event.upgradeTemplateKey !== null || event.conditionKeys.length < 1 || event.locationKeys.length !== 1
        || event.regionKeys.length !== 1 || event.rumorRequirementKey === null)
      || new Set(rumorEvents.map(event => event.rumorKey)).size !== rumorEvents.length
      || !same(artifact.coverage.requiredRumorSeedKeys ?? [], artifact.coverage.boundRumorSeedKeys ?? [])
      || !same(artifact.coverage.boundRumorSeedKeys ?? [], rumorEvents.map(event => event.sourceSeedKey)))) {
    fail('Director地区覆盖、预算、指纹或事件升级绑定无效')
  }
}

function assertCrossArtifacts(artifacts: TextOpenWorldQuestFinalizeArtifactsV1): void {
  const quest = artifacts.questDesignDocuments
  const director = artifacts.directorDecks
  const actionKeys = new Set(quest.actions.map(item => item.key))
  const effectKeys = new Set(quest.effects.map(item => item.key))
  const conditionKeys = new Set(quest.conditions.map(item => item.key))
  const questKeys = new Set(quest.quests.map(item => item.key))
  const catalogKeys = new Set(quest.coverage.catalogDefinitionKeys)
  const knowledgeBindings = quest.knowledgeBindings ?? []
  const governedKnowledge = quest.governance.knowledgeProgressReady === true
    || director.governance.knowledgeProgressReady === true
  const rumorEvents = director.randomEvents.filter(event => typeof event.rumorKey === 'string')
  const knowledgeCrossInvalid = governedKnowledge && (
    quest.governance.knowledgeProgressReady !== true || director.governance.knowledgeProgressReady !== true
    || knowledgeBindings.some(binding => {
      const matches = rumorEvents.filter(event => event.key === binding.propagationEventKey)
      if (matches.length !== 1) return true
      const event = matches[0]!
      return event.sourceSeedKey !== binding.sourceRumorKey || event.rumorKey !== binding.rumorKey
        || !same(event.regionKeys, [binding.regionKey]) || !same(event.locationKeys, [binding.propagationLocationKey])
        || !same(event.conditionKeys, binding.propagationConditionKeys)
    })
    || rumorEvents.some(event => knowledgeBindings.filter(binding => binding.propagationEventKey === event.key).length !== 1)
    || !same(director.coverage.requiredRumorSeedKeys ?? [], knowledgeBindings.map(binding => binding.sourceRumorKey))
    || !same(director.coverage.boundRumorSeedKeys ?? [], knowledgeBindings.map(binding => binding.sourceRumorKey))
  )
  if (director.questDesignDocumentsHash !== quest.questDesignDocumentsHash
    || !actionKeys.has(director.rules.systemActionKey)
    || quest.actions.find(action => action.key === director.rules.systemActionKey)?.category !== 'director-action'
    || quest.requirementBindings.some(binding => binding.definitionKeys.some(key => !catalogKeys.has(key) && !actionKeys.has(key)))
    || quest.catalogBindings.skills.some(binding => binding.actionKey !== null && !actionKeys.has(binding.actionKey))
    || quest.catalogBindings.encounters.some(binding => !actionKeys.has(binding.startActionKey))
    || quest.catalogBindings.items.some(binding => [binding.useActionKey, binding.equipActionKey, binding.unequipActionKey]
      .some(key => key !== null && !actionKeys.has(key)))
    || quest.catalogBindings.recipes.some(binding => !actionKeys.has(binding.craftActionKey)
      || (binding.learnActionKey !== null && !actionKeys.has(binding.learnActionKey)))
    || quest.catalogBindings.vendors.some(binding => !actionKeys.has(binding.buyActionKey) || !actionKeys.has(binding.sellActionKey))
    || quest.catalogBindings.interactions.some(binding => !actionKeys.has(binding.actionKey))
    || quest.catalogBindings.edges.some(binding => !actionKeys.has(binding.forwardActionKey)
      || (binding.reverseActionKey !== null && !actionKeys.has(binding.reverseActionKey)))
    || quest.catalogBindings.fastTravelPoints.some(binding => !actionKeys.has(binding.respawnActionKey)
      || (binding.unlockEffectKey !== null && !effectKeys.has(binding.unlockEffectKey)))
    || director.templates.some(template => !questKeys.has(template.questKey)
      || template.conditionKeys.some(key => !conditionKeys.has(key)))
    || director.randomEvents.some(event => event.actionKeys.some(key => !actionKeys.has(key))
      || event.effectKeys.some(key => !effectKeys.has(key))
      || event.conditionKeys.some(key => !conditionKeys.has(key)))
    || knowledgeCrossInvalid) {
    fail('QuestDesign与Director跨Artifact引用未闭合')
  }
  const basicAttacks = quest.actions.filter(action => action.category === 'combat-basic-attack')
  const rewardActions = quest.actions.filter(action => action.category === 'combat-reward-action')
  const basicMarkers = basicAttacks.flatMap(action => action.successEffectKeys)
    .map(key => quest.effects.find(effect => effect.key === key))
    .filter(effect => effect?.operation === 'perform-combat-action' && effect.payload.kind === 'basic-attack')
  if (basicAttacks.length !== 1 || basicMarkers.length !== 1 || rewardActions.length !== 1) {
    fail('EncounterFinalize战斗Action闭包无效')
  }
}

function draftFromArtifacts(
  artifacts: TextOpenWorldQuestFinalizeArtifactsV1,
  context: TextOpenWorldQuestFinalizeInputContextV1,
): unknown {
  const governedKnowledge = context.knowledgeProgressContract === 'governed-v18'
  const randomSeedKeys = new Set(context.regionNarrativePacks.packs.flatMap(pack => pack.randomEventSeeds.map(seed => seed.key)))
  const sourceRandomEvents = governedKnowledge
    ? artifacts.directorDecks.randomEvents.filter(event => randomSeedKeys.has(event.sourceSeedKey))
    : artifacts.directorDecks.randomEvents
  const body: Record<string, unknown> = {
    schema: 'storyforge.text-open-world-quest-finalize-draft', version: 1,
    quests: artifacts.questDesignDocuments.quests.map((quest, index) => ({
      questNumber: index + 1, description: quest.description,
      tags: quest.tags.filter(tag => tag !== quest.type),
    })),
    objectives: artifacts.questDesignDocuments.objectives.map((objective, index) => ({
      objectiveNumber: index + 1, description: objective.description, successDescription: objective.successDescription,
      timeCostMinutes: objective.interactionTimeCostMinutes,
    })),
    decks: artifacts.directorDecks.decks.map((deck, index) => ({
      regionNumber: index + 1, triggerKinds: deck.triggerKinds, maximumRevealed: deck.maximumRevealed,
      maximumActive: deck.maximumActive, cooldownMinutes: deck.cooldownMinutes, blankWeight: deck.blankWeight,
    })),
    templates: artifacts.directorDecks.templates.map((template, index) => ({
      templateNumber: index + 1, category: template.category, intensity: template.intensity,
      weight: template.weight, cooldownMinutes: template.cooldownMinutes,
    })),
    randomEvents: sourceRandomEvents.map((event, index) => ({
      seedNumber: index + 1, description: event.description, kind: event.kind, intensity: event.intensity,
      weight: event.weight, cooldownMinutes: event.cooldownMinutes,
      upgradeTemplateNumber: event.upgradeTemplateKey === null ? null
        : artifacts.directorDecks.templates.findIndex(template => template.key === event.upgradeTemplateKey) + 1,
    })),
  }
  if (context.storyOutcomeContract === 'governed-v19') {
    const demands = context.endingEligibilityDemands ?? fail('结局资格反向验证缺少候选合同')
    body.endingEligibilitySelections = demands.map((demand, index) => {
      const route = artifacts.questDesignDocuments.endingBindings.routes[index]
      const eligibility = route?.eligibility ?? fail(`结局资格绑定缺失:${demand.endingKey}`)
      if (route.endingKey !== demand.endingKey) fail(`结局资格绑定顺序错位:${demand.endingKey}`)
      const candidateNumber = (kind: EndingEligibilityCandidateKindV1, sourceKey: string): number => (
        demand.candidates.find(candidate => candidate.kind === kind && candidate.sourceKey === sourceKey)?.candidateNumber
        ?? 0
      )
      return {
        endingNumber: demand.endingNumber,
        requiredQuestCandidateNumbers: eligibility.requiredQuestKeys
          .map(sourceKey => candidateNumber('quest-complete', sourceKey)).sort((left, right) => left - right),
        anyQuestCandidateGroups: eligibility.anyQuestKeyGroups.map(group => group
          .map(sourceKey => candidateNumber('quest-complete', sourceKey)).sort((left, right) => left - right)),
        requiredFactionAffinities: eligibility.requiredFactionAffinities
          .map(item => ({ candidateNumber: candidateNumber('faction-affinity', item.factionKey), minimum: item.minimum }))
          .sort((left, right) => left.candidateNumber - right.candidateNumber),
        requiredRecipeCandidateNumbers: eligibility.requiredRecipeKeys
          .map(sourceKey => candidateNumber('recipe-known', sourceKey)).sort((left, right) => left - right),
      }
    })
  }
  if (!governedKnowledge) return body
  const demands = context.knowledgeBindingDemands ?? fail('Knowledge反向验证缺少候选合同')
  const knowledgeBindings = artifacts.questDesignDocuments.knowledgeBindings ?? []
  const achievementBindings = artifacts.questDesignDocuments.achievementBindings ?? []
  return {
    ...body,
    knowledgeSelections: demands.map(demand => {
      const binding = knowledgeBindings.find(item => item.sourceRumorKey === demand.sourceRumorKey)
      return {
        rumorNumber: demand.rumorNumber,
        propagationLocationNumber: demand.propagationLocationCandidates
          .find(candidate => candidate.locationKey === binding?.propagationLocationKey)?.candidateNumber ?? 0,
        confirmationCandidateNumbers: binding?.confirmationBindings.map(confirmation => demand.confirmationCandidates
          .find(candidate => candidate.sourceKind === confirmation.sourceKind && candidate.sourceKey === confirmation.sourceKey)
          ?.candidateNumber ?? 0) ?? [],
      }
    }),
    achievementCandidateNumbers: achievementBindings.map(binding => context.achievementBindingCandidates
      ?.find(candidate => candidate.sourceKind === binding.sourceKind && candidate.sourceKey === binding.sourceKey)
      ?.candidateNumber ?? 0),
  }
}

function assertKnowledgeStageGateSources(input: {
  artifacts: TextOpenWorldQuestFinalizeArtifactsV1
  context: TextOpenWorldQuestFinalizeInputContextV1
}): void {
  for (const binding of input.artifacts.questDesignDocuments.knowledgeBindings ?? []) {
    if (binding.minimumRevealGate.kind === 'regional-public') continue
    const stageKey = binding.minimumRevealGate.stageKey
      ?? fail(`Knowledge阶段门槛缺少stageKey:${binding.knowledgeKey}`)
    const gateConditionKey = binding.propagationConditionKeys[1]
      ?? fail(`Knowledge阶段门槛缺少Condition:${binding.knowledgeKey}`)
    const gate = input.artifacts.questDesignDocuments.conditions.find(item => item.key === gateConditionKey)
    if (!gate || gate.expression.op !== 'quest-status') {
      fail(`Knowledge阶段门槛Condition无效:${binding.knowledgeKey}`)
    }
    const expectedSourceKind = binding.minimumRevealGate.kind === 'mainline-stage-complete'
      ? 'mainline-stage' : 'significant-stage'
    const matchingSkeletons = input.context.questSkeletons.quests.filter(item => (
      item.source.kind === expectedSourceKind && item.source.sourceKey === stageKey
    ))
    if (matchingSkeletons.length !== 1 || matchingSkeletons[0]!.key !== gate.expression.questKey) {
      fail(`Knowledge阶段门槛没有绑定唯一来源任务:${binding.knowledgeKey}`)
    }
  }
}

export async function validateTextOpenWorldQuestFinalizeArtifactsV1(input: {
  artifacts: TextOpenWorldQuestFinalizeArtifactsV1
  context: TextOpenWorldQuestFinalizeInputContextV1
}): Promise<TextOpenWorldQuestFinalizeArtifactsV1> {
  if (input.artifacts.questDesignDocuments.schema !== 'storyforge.text-open-world-quest-design-documents'
    || input.artifacts.directorDecks.schema !== 'storyforge.text-open-world-director-decks'
    || !isSha256Hash(input.artifacts.questDesignDocuments.questDesignDocumentsHash)
    || !isSha256Hash(input.artifacts.directorDecks.directorDecksHash)) fail('P8F Artifact身份或Hash无效')
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  assertKnowledgeStageGateSources({ artifacts: input.artifacts, context })
  const draft = parseDraft(draftFromArtifacts(input.artifacts, context), context)
  const lifecycleContract = context.questLifecycleContract ?? 'legacy'
  const expected = await createArtifacts({
    context,
    draft,
    createdAt: input.artifacts.questDesignDocuments.createdAt,
    lifecycleContract,
    combatMechanicsContract: context.combatMechanicsContract ?? 'legacy',
    knowledgeProgressContract: context.knowledgeProgressContract ?? 'legacy',
    storyOutcomeContract: context.storyOutcomeContract ?? 'legacy',
  })
  assertCrossArtifacts(input.artifacts)
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.artifacts)) fail('P8F Artifact固定引用、运行定义、预算或Hash被篡改')
  return input.artifacts
}

export async function projectTextOpenWorldQuestFinalizeAuthorEditableDraftV1(input: {
  artifacts: TextOpenWorldQuestFinalizeArtifactsV1
  context: TextOpenWorldQuestFinalizeInputContextV1 | string
}): Promise<unknown> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const artifacts = await validateTextOpenWorldQuestFinalizeArtifactsV1({ artifacts: input.artifacts, context })
  return structuredClone(draftFromArtifacts(artifacts, context))
}

/** Rebuilds QuestDesignDocuments and DirectorDecks as one atomic sibling group. */
export async function rebuildTextOpenWorldQuestFinalizeFromAuthorEditableDraftV1(input: {
  baseArtifacts: TextOpenWorldQuestFinalizeArtifactsV1
  context: TextOpenWorldQuestFinalizeInputContextV1 | string
  draft: unknown
}): Promise<TextOpenWorldQuestFinalizeArtifactsV1> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const baseArtifacts = await validateTextOpenWorldQuestFinalizeArtifactsV1({ artifacts: input.baseArtifacts, context })
  const artifacts = await createArtifacts({
    context,
    draft: parseDraft(input.draft, context),
    createdAt: baseArtifacts.questDesignDocuments.createdAt,
    lifecycleContract: context.questLifecycleContract ?? 'legacy',
    combatMechanicsContract: context.combatMechanicsContract ?? 'legacy',
    knowledgeProgressContract: context.knowledgeProgressContract ?? 'legacy',
    storyOutcomeContract: context.storyOutcomeContract ?? 'legacy',
  })
  return validateTextOpenWorldQuestFinalizeArtifactsV1({ artifacts, context })
}

function prompts(context: TextOpenWorldQuestFinalizeInputContextV1) {
  const system = [
    '你是StoryForge文字开放世界的任务最终化与地区导演设计师。只能返回JSON。',
    '所有稳定键、目录引用、数值奖励、生命周期、Action、Condition和Effect由代码生成；你只写任务/目标可玩语义与有界发牌参数。',
    '主线与重要故事必须等待玩家、不可放弃或过期；不得用地点抵达作为唯一关键触发。随机事件不得阻断主线。',
    ...(context.knowledgeProgressContract === 'governed-v18' ? [
      'Knowledge与成就只能从输入候选编号中选择；不得改写事实、传闻、可靠度、来源或创建稳定键。',
      '凡承载Knowledge传播的地区牌组，triggerKinds必须包含rest；这是编译器保证可在传播地点执行的稳定触发。',
    ] : []),
    ...(context.storyOutcomeContract === 'governed-v19' ? [
      '每个结局的资格只能从该结局输入的闭集候选编号中选择；不得新增任务、阵营、配方、稳定键或把最终主线自身当作资格。',
      '不同结局必须采用可区分的资格组合。代码会把选择编译为Condition；重要故事局部后果由代码绑定，模型不得输出Effect。',
    ] : []),
  ].join('\n')
  const user = [
    '以下用户消息将提供已登记、已验签且字段精确的QuestFinalize输入合同。',
    `quests按${context.questSkeletons.quests.length}项顺序输出questNumber/description/tags；objectives按${context.objectiveBindingDemands.length}项顺序输出objectiveNumber/description/successDescription/timeCostMinutes(0-60)。`,
    `decks按${context.mapInteractionCatalog.regions.length}个地区顺序输出regionNumber、非空triggerKinds、maximumRevealed(1-4)、maximumActive(1-3且不大于revealed)、cooldownMinutes(60-1440)、blankWeight(1-100)。`,
    `templates按${context.questSkeletons.quests.filter(quest => quest.type === 'template').length}项顺序输出templateNumber/category/help|resource|exploration|conflict|mystery、intensity(1-6)、weight(1-100)、cooldownMinutes(60-10080)。`,
    `randomEvents按${context.regionNarrativePacks.packs.flatMap(pack => pack.randomEventSeeds).length}项顺序输出seedNumber/description/kind(${context.knowledgeProgressContract === 'governed-v18' ? 'atmosphere|resource|encounter|quest-upgrade' : 'atmosphere|resource|encounter|clue|quest-upgrade'})/intensity/weight/cooldownMinutes/upgradeTemplateNumber；只有quest-upgrade必须且只能选择本地区模板编号。`,
    ...(context.knowledgeProgressContract === 'governed-v18' ? [
      `knowledgeSelections按${context.knowledgeBindingDemands?.length ?? 0}条传闻顺序输出rumorNumber/propagationLocationNumber/confirmationCandidateNumbers；传播地点只能选本条location候选编号，确认必须严格升序选择1到3个本条候选编号。`,
      `achievementCandidateNumbers严格升序选择3到6个输入候选编号，并同时包含至少一个任务奖励来源和一个结局来源。`,
    ] : []),
    ...(context.storyOutcomeContract === 'governed-v19' ? [
      `endingEligibilitySelections按${context.endingEligibilityDemands?.length ?? 0}个结局顺序输出endingNumber、requiredQuestCandidateNumbers、anyQuestCandidateGroups、requiredFactionAffinities(candidateNumber/minimum)、requiredRecipeCandidateNumbers。阵营minimum必须高于初始亲合度且不超过目录上限；所有编号数组严格升序；替代任务组至少两个候选；每条路线至少一项资格。`,
    ] : []),
    '不要输出敌人、物品、角色、地点、奖励、Action、Condition、Effect、Quest键或任何未要求字段。',
    `返回：{"schema":"storyforge.text-open-world-quest-finalize-draft","version":1,"quests":[...],"objectives":[...],"decks":[...],"templates":[...],"randomEvents":[...]${context.knowledgeProgressContract === 'governed-v18' ? ',"knowledgeSelections":[...],"achievementCandidateNumbers":[...]' : ''}${context.storyOutcomeContract === 'governed-v19' ? ',"endingEligibilitySelections":[...]' : ''}}`,
  ].join('\n')
  return { system, user }
}

async function defaultRunner(input: Parameters<TextOpenWorldQuestFinalizeModelRunnerV1>[0]): Promise<TextOpenWorldQuestFinalizeModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是QuestFinalize输入合同：\n<quest-finalize-input>\n${input.contextText}\n</quest-finalize-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldQuestFinalizeExecutorV1(options: {
  runModel?: TextOpenWorldQuestFinalizeModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8f.quest-finalize' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('执行器收到错误任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.quest-design-documents', 'text-open-world.director-decks'])) fail('P8F输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('P8F需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('P8F缺少文本capability binding')
    const context = await parseContext(execution.contextText)
    const prompt = prompts(context); const started = performance.now()
    const model = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: SKILL_ID,
      system: `${prompt.system}\n${prompt.user}`, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (model.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(model.output, 'text-open-world-quest-finalize'), context)
    const artifacts = await createArtifacts({
      context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER),
      lifecycleContract: context.questLifecycleContract ?? 'legacy',
      combatMechanicsContract: context.combatMechanicsContract ?? 'legacy',
      knowledgeProgressContract: context.knowledgeProgressContract ?? 'legacy',
      storyOutcomeContract: context.storyOutcomeContract ?? 'legacy',
    })
    await validateTextOpenWorldQuestFinalizeArtifactsV1({ artifacts, context })
    const durationMs = Math.max(0, Math.round(performance.now() - started))
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: [
        {
          artifactKey: 'text-open-world.quest-design-documents', kind: 'text-open-world.quest-design-documents', payload: artifacts.questDesignDocuments,
          quality: { questCount: artifacts.questDesignDocuments.quests.length, objectiveCount: artifacts.questDesignDocuments.objectives.length, requirementsBound: true, gameplayBindingsReady: true },
          rights: { contentRequirementManifestHash: context.contentRequirementManifest.contentRequirementManifestHash },
        },
        {
          artifactKey: 'text-open-world.director-decks', kind: 'text-open-world.director-decks', payload: artifacts.directorDecks,
          quality: { regionCount: artifacts.directorDecks.decks.length, templateCount: artifacts.directorDecks.templates.length, randomEventCount: artifacts.directorDecks.randomEvents.length, budgetsBounded: true },
          rights: { regionNarrativePacksHash: context.regionNarrativePacks.regionNarrativePacksHash },
        },
      ],
      usage: {
        modelCalls: 1, inputTokens: model.usage?.inputTokens ?? estimateTokens(prompt.system + prompt.user + execution.contextText),
        outputTokens: model.usage?.outputTokens ?? estimateTokens(model.output), mediaCalls: 0,
        costUsd: null, durationMs, storageBytes: 0,
      },
      passedGateIds: [...execution.task.acceptanceGateIds],
    }
    return result
  }
}
