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
  TextOpenWorldActionBindingsV1,
  TextOpenWorldBalanceReviewV1,
  TextOpenWorldChoiceContractsV1,
  TextOpenWorldContentBudgetV1,
  TextOpenWorldCraftingEconomyCatalogV1,
  TextOpenWorldDeterministicPreflightV1,
  TextOpenWorldEnemyEncounterCatalogV1,
  TextOpenWorldExperienceContractV1,
  TextOpenWorldItemRewardCatalogV1,
  TextOpenWorldMainlineThreadV1,
  TextOpenWorldNarrativePromisesV1,
  TextOpenWorldProgressionCatalogsV1,
  TextOpenWorldProductionArtifactKindV1,
  TextOpenWorldQuestDesignDocumentsV1,
  TextOpenWorldRegionNarrativePacksV1,
  TextOpenWorldReviewFindingV1,
  TextOpenWorldSceneScriptsV1,
  TextOpenWorldSemanticReviewV1,
  TextOpenWorldSignificantThreadsV1,
  TextOpenWorldSourceLedgerV1,
  TextOpenWorldStoryArcV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from './production-contract'

const BALANCE_SKILL_ID = 'text-open-world.production.balance-review.v1'
const SEMANTIC_SKILL_ID = 'text-open-world.production.semantic-review.v1'
const REVIEW_THRESHOLD = 70 as const
const ADVISORY_THRESHOLD = 85

const BALANCE_METRICS = [
  'progression', 'encounters', 'rewards', 'economy', 'solvability', 'content-supply',
] as const
const SEMANTIC_METRICS = [
  'source-fidelity', 'mainline-arc', 'significant-stories', 'regional-identity',
  'quest-experience', 'dialogue-and-knowledge', 'repetition', 'duration-and-guidance',
] as const

type BalanceMetric = typeof BALANCE_METRICS[number]
type SemanticMetric = typeof SEMANTIC_METRICS[number]
type ReviewMetric = BalanceMetric | SemanticMetric

interface ReviewMetricDemandV1 {
  metricNumber: number
  metricKey: ReviewMetric
  question: string
  targetArtifactKey: TextOpenWorldProductionArtifactKindV1
  targetTaskKey: string
  eligibleEntityKeys: string[]
}

interface ReviewDraftV1 {
  scores: Array<{ metricNumber: number; score: number; rationale: string }>
  findings: Array<{
    metricNumber: number
    summary: string
    evidence: string
    targetEntityKeys: string[]
    instruction: string
  }>
}

export interface TextOpenWorldQualityReviewModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldQualityReviewModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldQualityReviewModelExecutionV1>

export interface TextOpenWorldBalanceReviewInputContextV1 {
  schema: 'storyforge.text-open-world-balance-review-input'
  version: 1
  productInstanceKey: string
  artifactHashes: Array<{ artifactKey: TextOpenWorldProductionArtifactKindV1; contentHash: string; payloadHash: string }>
  progression: {
    maximumLevel: number
    acceptanceLevels: number[]
    skills: Array<{ key: string; activation: string; kind: string; unlockPlan: unknown; resourceCost: number; cooldownTurns: number }>
  }
  encounters: {
    enemies: Array<{ key: string; level: number; maximumHealth: number; attack: number; defense: number; skillKeys: string[] }>
    encounters: Array<{ key: string; recommendedLevel: number; levelBand: { minimum: number; maximum: number }; intensity: string; questObjectiveKeys: string[] }>
  }
  rewards: {
    items: Array<{ key: string; kind: string; baseValue: number; fulfilledRequirementKeys: string[] }>
    contracts: Array<{ key: string; sourceKind: string; sourceSemanticKey: string; expectedMinutes: number; budgetClass: string; experience: number; currency: number }>
  }
  economy: {
    recipes: Array<{ key: string; category: string; ingredients: unknown; outputs: unknown; learnedByDefault: boolean }>
    vendors: Array<{ key: string; buyPriceMultiplierBasisPoints: number; sellPriceMultiplierBasisPoints: number; inventoryEntries: unknown }>
    antiArbitrage: { riskFreeArbitrageRecipeKeys: string[]; noRiskFreeArbitrage: boolean }
  }
  quests: Array<{ key: string; type: string; estimatedMinutes: number; rewardContractKey: string; regionKeys: string[]; lifecyclePolicy: string; timePolicy: string }>
  contentBudget: TextOpenWorldContentBudgetV1
  preflight: TextOpenWorldDeterministicPreflightV1
  metricDemands: ReviewMetricDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldSemanticReviewInputContextV1 {
  schema: 'storyforge.text-open-world-semantic-review-input'
  version: 1
  productInstanceKey: string
  artifactHashes: Array<{ artifactKey: TextOpenWorldProductionArtifactKindV1; contentHash: string; payloadHash: string }>
  sourceClaims: Array<{ claimKey: string; claimKind: string; canonicalName: string; statement: string }>
  experience: Pick<TextOpenWorldExperienceContractV1, 'title' | 'pitch' | 'playerFantasy' | 'narrativePillars' | 'regionalVarietyPromise' | 'growthPromise' | 'toneGuide' | 'freedom'>
  story: {
    logline: string
    themeStatement: string
    coreConflict: TextOpenWorldStoryArcV1['coreConflict']
    macroBeats: Array<{ key: string; order: number; phase: string; title: string; dramaticPurpose: string; protagonistChange: string; requiredReveal: string; sourceClaimKeys: string[] }>
    promises: Array<{ key: string; kind: string; statement: string; setup: string; callbacks: string[]; payoff: string }>
  }
  mainline: {
    thread: Pick<TextOpenWorldMainlineThreadV1['thread'], 'key' | 'title' | 'summary' | 'coreGoal' | 'endingKeys'>
    stages: Array<{ key: string; order: number; title: string; summary: string; dramaticQuestion: string; playerGoals: string[]; requiredReveal: string; stageOutcome: string; estimatedMinutes: number }>
    endingRuntime: {
      finalMainlineQuestKey: string
      finalLocationKey: string
      routes: Array<{
        endingKey: string
        routeSummary: string
        decisivePlayerValue: string
        actionKey: string
        systemActionLabel: string
        fixedChoiceLabels: string[]
        naturalLanguageExamples: string[]
      }>
    }
    pacing: TextOpenWorldMainlineThreadV1['pacing']
  }
  significantThreads: Array<{
    key: string
    ownerKind: string
    ownerTitle: string
    title: string
    summary: string
    centralConflict: string
    theme: string
    sides: Array<{ name: string; goal: string; resource: string; pressure: string }>
    escalationSteps: string[]
    atmosphereSignals: string[]
    estimatedMinutes: number
  }>
  regions: Array<{
    regionKey: string
    identity: TextOpenWorldRegionNarrativePacksV1['packs'][number]['identity']
    tensions: TextOpenWorldRegionNarrativePacksV1['packs'][number]['tensions']
    ordinaryQuests: Array<{ key: string; title: string; premise: string; playerActivity: string }>
    templates: Array<{ key: string; title: string; storyFrame: string; variationAxes: string[] }>
    randomEvents: Array<{ key: string; kind: string; title: string; setup: string; playerOpportunity: string }>
  }>
  quests: Array<Pick<TextOpenWorldQuestDesignDocumentsV1['quests'][number], 'key' | 'type' | 'title' | 'description' | 'estimatedMinutes' | 'regionKeys'>>
  objectives: Array<Pick<TextOpenWorldQuestDesignDocumentsV1['objectives'][number], 'key' | 'questKey' | 'title' | 'description' | 'successDescription'>>
  scenes: Array<Pick<TextOpenWorldSceneScriptsV1['scenes'][number], 'key' | 'sourceKind' | 'sourceKey' | 'title' | 'openingText' | 'bodyText' | 'attitudeOpenings' | 'allowedKnowledgeClaimKeys'>>
  inputPolicy: Pick<TextOpenWorldActionBindingsV1, 'unmatchedNaturalLanguage' | 'thresholds' | 'governance'>
  contentBudget: TextOpenWorldContentBudgetV1
  preflight: TextOpenWorldDeterministicPreflightV1
  metricDemands: ReviewMetricDemandV1[]
  contextSelectionHash: string
}

const BALANCE_SPECS = [
  ['text-open-world.progression-catalogs', 'storyforge.text-open-world-progression-catalogs', 'progressionCatalogsHash'],
  ['text-open-world.enemy-encounter-catalog', 'storyforge.text-open-world-enemy-encounter-catalog', 'enemyEncounterCatalogHash'],
  ['text-open-world.item-reward-catalog', 'storyforge.text-open-world-item-reward-catalog', 'itemRewardCatalogHash'],
  ['text-open-world.crafting-economy-catalog', 'storyforge.text-open-world-crafting-economy-catalog', 'craftingEconomyCatalogHash'],
  ['text-open-world.quest-design-documents', 'storyforge.text-open-world-quest-design-documents', 'questDesignDocumentsHash'],
  ['text-open-world.content-budget', 'storyforge.text-open-world-content-budget', 'contentBudgetHash'],
  ['text-open-world.deterministic-preflight', 'storyforge.text-open-world-deterministic-preflight', 'deterministicPreflightHash'],
] as const satisfies ReadonlyArray<readonly [TextOpenWorldProductionArtifactKindV1, string, string]>

const SEMANTIC_SPECS = [
  ['text-open-world.source-ledger', 'storyforge.text-open-world-source-ledger', 'ledgerHash'],
  ['text-open-world.experience-contract', 'storyforge.text-open-world-experience-contract', 'experienceContractHash'],
  ['text-open-world.story-arc', 'storyforge.text-open-world-story-arc', 'storyArcHash'],
  ['text-open-world.narrative-promises', 'storyforge.text-open-world-narrative-promises', 'narrativePromisesHash'],
  ['text-open-world.mainline-thread', 'storyforge.text-open-world-mainline-thread', 'mainlineThreadHash'],
  ['text-open-world.significant-threads', 'storyforge.text-open-world-significant-threads', 'significantThreadsHash'],
  ['text-open-world.region-narrative-packs', 'storyforge.text-open-world-region-narrative-packs', 'regionNarrativePacksHash'],
  ['text-open-world.quest-design-documents', 'storyforge.text-open-world-quest-design-documents', 'questDesignDocumentsHash'],
  ['text-open-world.scene-scripts', 'storyforge.text-open-world-scene-scripts', 'sceneScriptsHash'],
  ['text-open-world.choice-contracts', 'storyforge.text-open-world-choice-contracts', 'choiceContractsHash'],
  ['text-open-world.action-bindings', 'storyforge.text-open-world-action-bindings', 'actionBindingsHash'],
  ['text-open-world.content-budget', 'storyforge.text-open-world-content-budget', 'contentBudgetHash'],
  ['text-open-world.deterministic-preflight', 'storyforge.text-open-world-deterministic-preflight', 'deterministicPreflightHash'],
] as const satisfies ReadonlyArray<readonly [TextOpenWorldProductionArtifactKindV1, string, string]>

const BALANCE_TARGETS: Record<BalanceMetric, { artifact: TextOpenWorldProductionArtifactKindV1; task: string; question: string }> = {
  progression: { artifact: 'text-open-world.progression-catalogs', task: 'p8.catalog.progression', question: '1到5级成长、技能解锁与资源是否形成清晰持续的成长感？' },
  encounters: { artifact: 'text-open-world.enemy-encounter-catalog', task: 'p8.catalog.encounters', question: '敌人数值、遭遇强度和推荐等级是否合理且有差异？' },
  rewards: { artifact: 'text-open-world.item-reward-catalog', task: 'p8.catalog.items-rewards', question: '经验、货币、装备和材料奖励是否匹配任务时长与成长需求？' },
  economy: { artifact: 'text-open-world.crafting-economy-catalog', task: 'p8.catalog.crafting-economy', question: '配方来源消耗、商店库存、价格与反套利是否构成闭环？' },
  solvability: { artifact: 'text-open-world.quest-design-documents', task: 'p8f.quest-finalize', question: '玩法需求和任务门槛是否会造成资源或等级软锁？' },
  'content-supply': { artifact: 'text-open-world.region-narrative-packs', task: 'p7.region-narrative-packs', question: '各地区可选内容供给是否均衡，且足以支撑目标游玩时长？' },
}

const SEMANTIC_TARGETS: Record<SemanticMetric, { artifact: TextOpenWorldProductionArtifactKindV1; task: string; question: string }> = {
  'source-fidelity': { artifact: 'text-open-world.story-arc', task: 'p3.story-architecture', question: '改编是否忠于来源事实，又形成可玩的核心冲突？' },
  'mainline-arc': { artifact: 'text-open-world.mainline-thread', task: 'p5.mainline', question: '主线是否有清晰升级、变化、承诺回收和多结局差异？' },
  'significant-stories': { artifact: 'text-open-world.significant-threads', task: 'p6.significant-threads', question: '角色、势力或地区重要故事线是否具有独立冲突与群体氛围？' },
  'regional-identity': { artifact: 'text-open-world.region-narrative-packs', task: 'p7.region-narrative-packs', question: '各地区是否具有可辨认身份、生活感、矛盾和地域内容？' },
  'quest-experience': { artifact: 'text-open-world.quest-design-documents', task: 'p8f.quest-finalize', question: '任务是否有动机、情境、行动变化和有意义的结果？' },
  'dialogue-and-knowledge': { artifact: 'text-open-world.scene-scripts', task: 'p9.scene-scripts', question: '场景对话是否符合角色、知识边界和三档关系，且引导清晰？' },
  repetition: { artifact: 'text-open-world.region-narrative-packs', task: 'p7.region-narrative-packs', question: '普通任务、模板和随机事件是否避免只换名不换体验？' },
  'duration-and-guidance': { artifact: 'text-open-world.quest-design-documents', task: 'p8f.quest-finalize', question: '内容密度、时长与下一步引导是否支持完整体验而不过度拖沓？' },
}

function fail(message: string): never { throw new Error(`[text-open-world-quality-review] ${message}`) }
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
function same(left: unknown, right: unknown): boolean { return canonicalProductProductionJsonV2(left) === canonicalProductProductionJsonV2(right) }
async function assertOwnHash(value: Record<string, unknown>, hashKey: string, label: string): Promise<void> {
  const actual = value[hashKey]
  if (!isSha256Hash(actual)) fail(`${label}.${hashKey}无效`)
  const body = { ...value }; delete body[hashKey]
  if (await hashProductProductionValueV2(body) !== actual) fail(`${label}内容Hash不匹配`)
}

async function readArtifacts(
  scope: WorkspaceScope,
  buildId: number,
  specs: ReadonlyArray<readonly [TextOpenWorldProductionArtifactKindV1, string, string]>,
): Promise<{ values: Map<string, Record<string, unknown>>; hashes: Array<{ artifactKey: TextOpenWorldProductionArtifactKindV1; contentHash: string; payloadHash: string }> }> {
  const accepted = await readAcceptedBuildArtifacts({ scope, buildId })
  const values = new Map<string, Record<string, unknown>>()
  const hashes = [] as Array<{ artifactKey: TextOpenWorldProductionArtifactKindV1; contentHash: string; payloadHash: string }>
  for (const [artifactKey, schema, hashKey] of specs) {
    const row = accepted.find(item => item.artifactKey === artifactKey) ?? fail(`缺少${artifactKey}`)
    const value = record(JSON.parse(row.payloadJson), artifactKey)
    if (value.schema !== schema || value.version !== 1 || row.contentHash !== await hashProductProductionValueV2(value)) fail(`${artifactKey}身份或记录Hash无效`)
    await assertOwnHash(value, hashKey, artifactKey)
    values.set(artifactKey, value)
    hashes.push({ artifactKey, contentHash: row.contentHash, payloadHash: value[hashKey] as string })
  }
  const productKeys = [...values.values()].map(value => value.productInstanceKey).filter(Boolean)
  if (new Set(productKeys).size !== 1) fail('评审输入跨产品实例')
  return { values, hashes }
}

function descendants(taskKey: string): string[] {
  const found = new Set<string>([taskKey])
  let changed = true
  while (changed) {
    changed = false
    for (const task of TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1) {
      if (!found.has(task.taskKey) && task.dependsOn.some(key => found.has(key))) {
        found.add(task.taskKey); changed = true
      }
    }
  }
  return TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.filter(task => found.has(task.taskKey)).map(task => task.taskKey)
}

function balanceMetricDemands(input: {
  progression: TextOpenWorldProgressionCatalogsV1
  encounters: TextOpenWorldEnemyEncounterCatalogV1
  rewards: TextOpenWorldItemRewardCatalogV1
  economy: TextOpenWorldCraftingEconomyCatalogV1
  quests: TextOpenWorldQuestDesignDocumentsV1
  budget: TextOpenWorldContentBudgetV1
}): ReviewMetricDemandV1[] {
  const entities: Record<BalanceMetric, string[]> = {
    progression: [...input.progression.skills.map(item => item.key), ...input.progression.levels.map(item => `level.${item.level}`)],
    encounters: [...input.encounters.enemies.map(item => item.key), ...input.encounters.encounters.map(item => item.key)],
    rewards: [...input.rewards.items.map(item => item.key), ...input.rewards.rewardContracts.map(item => item.key)],
    economy: [...input.economy.recipes.map(item => item.key), ...input.economy.vendors.map(item => item.key)],
    solvability: input.quests.quests.map(item => item.key),
    'content-supply': input.budget.perRegion.map(item => item.regionKey),
  }
  return BALANCE_METRICS.map((metricKey, index) => ({
    metricNumber: index + 1, metricKey, question: BALANCE_TARGETS[metricKey].question,
    targetArtifactKey: BALANCE_TARGETS[metricKey].artifact, targetTaskKey: BALANCE_TARGETS[metricKey].task,
    eligibleEntityKeys: entities[metricKey],
  }))
}

function semanticMetricDemands(input: {
  source: TextOpenWorldSourceLedgerV1
  story: TextOpenWorldStoryArcV1
  mainline: TextOpenWorldMainlineThreadV1
  significant: TextOpenWorldSignificantThreadsV1
  regions: TextOpenWorldRegionNarrativePacksV1
  quests: TextOpenWorldQuestDesignDocumentsV1
  scenes: TextOpenWorldSceneScriptsV1
}): ReviewMetricDemandV1[] {
  const entities: Record<SemanticMetric, string[]> = {
    'source-fidelity': [...input.source.entries.map(item => item.claimKey), ...input.story.macroBeats.map(item => item.key)],
    'mainline-arc': [...input.mainline.stages.map(item => item.key), ...input.mainline.endingRoutes.map(item => item.endingKey)],
    'significant-stories': input.significant.threads.map(item => item.key),
    'regional-identity': input.regions.packs.map(item => item.regionKey),
    'quest-experience': input.quests.quests.map(item => item.key),
    'dialogue-and-knowledge': input.scenes.scenes.map(item => item.key),
    repetition: input.regions.packs.flatMap(pack => [...pack.ordinaryQuestSeeds, ...pack.taskTemplateSeeds, ...pack.randomEventSeeds].map(item => item.key)),
    'duration-and-guidance': input.quests.quests.map(item => item.key),
  }
  return SEMANTIC_METRICS.map((metricKey, index) => ({
    metricNumber: index + 1, metricKey, question: SEMANTIC_TARGETS[metricKey].question,
    targetArtifactKey: SEMANTIC_TARGETS[metricKey].artifact, targetTaskKey: SEMANTIC_TARGETS[metricKey].task,
    eligibleEntityKeys: entities[metricKey],
  }))
}

async function buildBalanceContext(scope: WorkspaceScope, buildId: number): Promise<TextOpenWorldBalanceReviewInputContextV1> {
  const { values, hashes } = await readArtifacts(scope, buildId, BALANCE_SPECS)
  const progression = values.get('text-open-world.progression-catalogs') as unknown as TextOpenWorldProgressionCatalogsV1
  const encounters = values.get('text-open-world.enemy-encounter-catalog') as unknown as TextOpenWorldEnemyEncounterCatalogV1
  const rewards = values.get('text-open-world.item-reward-catalog') as unknown as TextOpenWorldItemRewardCatalogV1
  const economy = values.get('text-open-world.crafting-economy-catalog') as unknown as TextOpenWorldCraftingEconomyCatalogV1
  const quests = values.get('text-open-world.quest-design-documents') as unknown as TextOpenWorldQuestDesignDocumentsV1
  const budget = values.get('text-open-world.content-budget') as unknown as TextOpenWorldContentBudgetV1
  const preflight = values.get('text-open-world.deterministic-preflight') as unknown as TextOpenWorldDeterministicPreflightV1
  if (quests.progressionCatalogsHash !== progression.progressionCatalogsHash
    || quests.enemyEncounterCatalogHash !== encounters.enemyEncounterCatalogHash
    || quests.itemRewardCatalogHash !== rewards.itemRewardCatalogHash
    || quests.craftingEconomyCatalogHash !== economy.craftingEconomyCatalogHash
    || budget.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || preflight.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || preflight.contentBudgetHash !== budget.contentBudgetHash || !preflight.result.readyForModelReviews) fail('平衡评审输入Hash链或预检状态无效')
  const body = {
    schema: 'storyforge.text-open-world-balance-review-input' as const, version: 1 as const,
    productInstanceKey: progression.productInstanceKey, artifactHashes: hashes,
    progression: {
      maximumLevel: progression.rules.maximumLevel,
      acceptanceLevels: progression.levels.filter(level => level.level <= 5).map(level => level.level),
      skills: progression.skills.map(skill => ({ key: skill.key, activation: skill.activation, kind: skill.kind, unlockPlan: skill.unlockPlan, resourceCost: skill.resourceCost, cooldownTurns: skill.cooldownTurns })),
    },
    encounters: {
      enemies: encounters.enemies.map(enemy => ({ key: enemy.key, level: enemy.level, maximumHealth: enemy.maximumHealth, attack: enemy.attack, defense: enemy.defense, skillKeys: enemy.skillKeys })),
      encounters: encounters.encounters.map(item => ({ key: item.key, recommendedLevel: item.recommendedLevel, levelBand: item.levelBand, intensity: item.intensity, questObjectiveKeys: item.questObjectiveKeys })),
    },
    rewards: {
      items: rewards.items.map(item => ({ key: item.key, kind: item.kind, baseValue: item.baseValue, fulfilledRequirementKeys: item.fulfilledRequirementKeys })),
      contracts: rewards.rewardContracts.map(item => ({ key: item.key, sourceKind: item.sourceKind, sourceSemanticKey: item.sourceSemanticKey, expectedMinutes: item.expectedMinutes, budgetClass: item.budgetClass, experience: item.grants.experience, currency: item.grants.currency })),
    },
    economy: {
      recipes: economy.recipes.map(item => ({ key: item.key, category: item.category, ingredients: item.ingredients, outputs: item.outputs, learnedByDefault: item.learnedByDefault })),
      vendors: economy.vendors.map(item => ({ key: item.key, buyPriceMultiplierBasisPoints: item.buyPriceMultiplierBasisPoints, sellPriceMultiplierBasisPoints: item.sellPriceMultiplierBasisPoints, inventoryEntries: item.inventoryEntries })),
      antiArbitrage: { riskFreeArbitrageRecipeKeys: economy.coverage.riskFreeArbitrageRecipeKeys, noRiskFreeArbitrage: economy.governance.noRiskFreeArbitrage },
    },
    quests: quests.quests.map(item => ({ key: item.key, type: item.type, estimatedMinutes: item.estimatedMinutes, rewardContractKey: item.rewardContractKey, regionKeys: item.regionKeys, lifecyclePolicy: item.lifecyclePolicy, timePolicy: item.timePolicy })),
    contentBudget: budget, preflight,
    metricDemands: balanceMetricDemands({ progression, encounters, rewards, economy, quests, budget }),
  }
  return { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
}

async function buildSemanticContext(scope: WorkspaceScope, buildId: number): Promise<TextOpenWorldSemanticReviewInputContextV1> {
  const { values, hashes } = await readArtifacts(scope, buildId, SEMANTIC_SPECS)
  const source = values.get('text-open-world.source-ledger') as unknown as TextOpenWorldSourceLedgerV1
  const experience = values.get('text-open-world.experience-contract') as unknown as TextOpenWorldExperienceContractV1
  const story = values.get('text-open-world.story-arc') as unknown as TextOpenWorldStoryArcV1
  const promises = values.get('text-open-world.narrative-promises') as unknown as TextOpenWorldNarrativePromisesV1
  const mainline = values.get('text-open-world.mainline-thread') as unknown as TextOpenWorldMainlineThreadV1
  const significant = values.get('text-open-world.significant-threads') as unknown as TextOpenWorldSignificantThreadsV1
  const regions = values.get('text-open-world.region-narrative-packs') as unknown as TextOpenWorldRegionNarrativePacksV1
  const quests = values.get('text-open-world.quest-design-documents') as unknown as TextOpenWorldQuestDesignDocumentsV1
  const scenes = values.get('text-open-world.scene-scripts') as unknown as TextOpenWorldSceneScriptsV1
  const choices = values.get('text-open-world.choice-contracts') as unknown as TextOpenWorldChoiceContractsV1
  const bindings = values.get('text-open-world.action-bindings') as unknown as TextOpenWorldActionBindingsV1
  const budget = values.get('text-open-world.content-budget') as unknown as TextOpenWorldContentBudgetV1
  const preflight = values.get('text-open-world.deterministic-preflight') as unknown as TextOpenWorldDeterministicPreflightV1
  if (experience.sourceLedgerHash !== source.ledgerHash || story.sourceLedgerHash !== source.ledgerHash
    || promises.storyArcHash !== story.storyArcHash || mainline.storyArcHash !== story.storyArcHash
    || significant.mainlineThreadHash !== mainline.mainlineThreadHash || regions.mainlineThreadHash !== mainline.mainlineThreadHash
    || quests.regionNarrativePacksHash !== regions.regionNarrativePacksHash || scenes.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || choices.sceneScriptsHash !== scenes.sceneScriptsHash || choices.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || bindings.sceneScriptsHash !== scenes.sceneScriptsHash || bindings.choiceContractsHash !== choices.choiceContractsHash
    || budget.questDesignDocumentsHash !== quests.questDesignDocumentsHash
    || preflight.contentBudgetHash !== budget.contentBudgetHash || !preflight.result.readyForModelReviews) fail('语义评审输入Hash链或预检状态无效')
  const body = {
    schema: 'storyforge.text-open-world-semantic-review-input' as const, version: 1 as const,
    productInstanceKey: source.productInstanceKey, artifactHashes: hashes,
    sourceClaims: source.entries.map(claim => ({ claimKey: claim.claimKey, claimKind: claim.claimKind, canonicalName: claim.canonicalName, statement: claim.statement })),
    experience: {
      title: experience.title, pitch: experience.pitch, playerFantasy: experience.playerFantasy,
      narrativePillars: experience.narrativePillars, regionalVarietyPromise: experience.regionalVarietyPromise,
      growthPromise: experience.growthPromise, toneGuide: experience.toneGuide, freedom: experience.freedom,
    },
    story: {
      logline: story.logline, themeStatement: story.themeStatement, coreConflict: story.coreConflict,
      macroBeats: story.macroBeats.map(beat => ({
        key: beat.key, order: beat.order, phase: beat.phase, title: beat.title,
        dramaticPurpose: beat.dramaticPurpose, protagonistChange: beat.protagonistChange,
        requiredReveal: beat.requiredReveal, sourceClaimKeys: beat.sourceClaimKeys,
      })),
      promises: promises.promises.map(promise => ({
        key: promise.key, kind: promise.kind, statement: promise.statement, setup: promise.setup.description,
        callbacks: promise.callbacks.map(callback => callback.description), payoff: promise.payoff.description,
      })),
    },
    mainline: {
      thread: { key: mainline.thread.key, title: mainline.thread.title, summary: mainline.thread.summary, coreGoal: mainline.thread.coreGoal, endingKeys: mainline.thread.endingKeys },
      stages: mainline.stages.map(stage => ({
        key: stage.key, order: stage.order, title: stage.title, summary: stage.summary,
        dramaticQuestion: stage.dramaticQuestion, playerGoals: stage.playerGoals,
        requiredReveal: stage.requiredReveal, stageOutcome: stage.stageOutcome, estimatedMinutes: stage.estimatedMinutes,
      })),
      endingRuntime: {
        finalMainlineQuestKey: quests.endingBindings.finalMainlineQuestKey,
        finalLocationKey: quests.endingBindings.finalLocationKey,
        routes: quests.endingBindings.routes.map(route => {
          const sourceRoute = mainline.endingRoutes.find(item => item.endingKey === route.endingKey)
            ?? fail(`语义评审缺少主线结局路线:${route.endingKey}`)
          const action = quests.actions.find(item => item.key === route.actionKey)
            ?? fail(`语义评审缺少结局Action:${route.actionKey}`)
          const inputBinding = bindings.actions.find(item => item.actionKey === route.actionKey)
            ?? fail(`语义评审缺少结局输入绑定:${route.actionKey}`)
          return {
            endingKey: route.endingKey, routeSummary: sourceRoute.routeSummary,
            decisivePlayerValue: sourceRoute.decisivePlayerValue, actionKey: route.actionKey,
            systemActionLabel: action.label,
            fixedChoiceLabels: choices.choices.filter(item => item.actionKey === route.actionKey).map(item => item.label),
            naturalLanguageExamples: inputBinding.naturalLanguage.exampleUtterances,
          }
        }),
      },
      pacing: mainline.pacing,
    },
    significantThreads: significant.threads.map(thread => ({
      key: thread.key, ownerKind: thread.ownerKind, ownerTitle: thread.ownerTitle, title: thread.title,
      summary: thread.summary, centralConflict: thread.centralConflict, theme: thread.theme,
      sides: thread.conflictSystem.sides.map(side => ({ name: side.name, goal: side.goal, resource: side.resource, pressure: side.pressure })),
      escalationSteps: thread.conflictSystem.escalationSteps, atmosphereSignals: thread.conflictSystem.atmosphereSignals,
      estimatedMinutes: thread.estimatedMinutes,
    })),
    regions: regions.packs.map(pack => ({
      regionKey: pack.regionKey, identity: pack.identity, tensions: pack.tensions,
      ordinaryQuests: pack.ordinaryQuestSeeds.map(item => ({ key: item.key, title: item.title, premise: item.premise, playerActivity: item.playerActivity })),
      templates: pack.taskTemplateSeeds.map(item => ({ key: item.key, title: item.title, storyFrame: item.storyFrame, variationAxes: item.variationAxes })),
      randomEvents: pack.randomEventSeeds.map(item => ({ key: item.key, kind: item.kind, title: item.title, setup: item.setup, playerOpportunity: item.playerOpportunity })),
    })),
    quests: quests.quests.map(item => ({ key: item.key, type: item.type, title: item.title, description: item.description, estimatedMinutes: item.estimatedMinutes, regionKeys: item.regionKeys })),
    objectives: quests.objectives.map(item => ({ key: item.key, questKey: item.questKey, title: item.title, description: item.description, successDescription: item.successDescription })),
    scenes: scenes.scenes.map(item => ({ key: item.key, sourceKind: item.sourceKind, sourceKey: item.sourceKey, title: item.title, openingText: item.openingText, bodyText: item.bodyText, attitudeOpenings: item.attitudeOpenings, allowedKnowledgeClaimKeys: item.allowedKnowledgeClaimKeys })),
    inputPolicy: { unmatchedNaturalLanguage: bindings.unmatchedNaturalLanguage, thresholds: bindings.thresholds, governance: bindings.governance },
    contentBudget: budget, preflight,
    metricDemands: semanticMetricDemands({ source, story, mainline, significant, regions, quests, scenes }),
  }
  return { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
}

export async function readTextOpenWorldBalanceReviewInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !input.productBuildId) fail('平衡评审缺少scope或Build')
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('平衡评审Build不存在或跨Work')
  return canonicalProductProductionJsonV2(await buildBalanceContext(input.scope, build.id!))
}

export async function readTextOpenWorldSemanticReviewInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !input.productBuildId) fail('语义评审缺少scope或Build')
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('语义评审Build不存在或跨Work')
  return canonicalProductProductionJsonV2(await buildSemanticContext(input.scope, build.id!))
}

async function parseContext<T extends TextOpenWorldBalanceReviewInputContextV1 | TextOpenWorldSemanticReviewInputContextV1>(
  value: string,
  kind: 'balance' | 'semantic',
): Promise<T> {
  const row = record(parseProductionModelJsonObjectV1(value, `text-open-world-${kind}-review-input`), 'context')
  const balanceKeys = ['schema', 'version', 'productInstanceKey', 'artifactHashes', 'progression', 'encounters', 'rewards', 'economy', 'quests', 'contentBudget', 'preflight', 'metricDemands', 'contextSelectionHash']
  const semanticKeys = ['schema', 'version', 'productInstanceKey', 'artifactHashes', 'sourceClaims', 'experience', 'story', 'mainline', 'significantThreads', 'regions', 'quests', 'objectives', 'scenes', 'inputPolicy', 'contentBudget', 'preflight', 'metricDemands', 'contextSelectionHash']
  exactKeys(row, kind === 'balance' ? balanceKeys : semanticKeys, 'context')
  const expectedSchema = `storyforge.text-open-world-${kind}-review-input`
  if (row.schema !== expectedSchema || row.version !== 1 || !isSha256Hash(row.contextSelectionHash)) fail(`${kind} Context身份无效`)
  const body = { ...row }; delete body.contextSelectionHash
  if (await hashProductProductionValueV2(body) !== row.contextSelectionHash) fail(`${kind} Context选择Hash不匹配`)
  const context = row as unknown as T
  const expectedMetrics = kind === 'balance' ? BALANCE_METRICS : SEMANTIC_METRICS
  if (!same(context.metricDemands.map(item => item.metricKey), expectedMetrics)
    || context.metricDemands.some((item, index) => item.metricNumber !== index + 1 || !item.eligibleEntityKeys.length)) fail(`${kind}评审指标合同无效`)
  if (!context.preflight.result.readyForModelReviews || context.preflight.result.blockingCheckKeys.length) fail(`${kind}评审不能越过确定性预检`)
  return context
}

function parseDraft(value: unknown, demands: ReviewMetricDemandV1[], kind: 'balance' | 'semantic'): ReviewDraftV1 {
  const row = record(value, 'draft')
  exactKeys(row, ['schema', 'version', 'scores', 'findings'], 'draft')
  if (row.schema !== `storyforge.text-open-world-${kind}-review-draft` || row.version !== 1 || !Array.isArray(row.scores) || !Array.isArray(row.findings)) fail('评审draft身份无效')
  const scores = row.scores.map((item, index) => {
    const entry = record(item, `scores[${index}]`); exactKeys(entry, ['metricNumber', 'score', 'rationale'], `scores[${index}]`)
    return { metricNumber: integer(entry.metricNumber, `scores[${index}].metricNumber`, 1, demands.length), score: integer(entry.score, `scores[${index}].score`, 0, 100), rationale: text(entry.rationale, `scores[${index}].rationale`, 1_000) }
  }).sort((a, b) => a.metricNumber - b.metricNumber)
  if (scores.length !== demands.length || new Set(scores.map(item => item.metricNumber)).size !== scores.length) fail('必须逐项评分')
  const findings = row.findings.map((item, index) => {
    const entry = record(item, `findings[${index}]`)
    exactKeys(entry, ['metricNumber', 'summary', 'evidence', 'targetEntityKeys', 'instruction'], `findings[${index}]`)
    const metricNumber = integer(entry.metricNumber, `findings[${index}].metricNumber`, 1, demands.length)
    if (!Array.isArray(entry.targetEntityKeys) || !entry.targetEntityKeys.length) fail(`findings[${index}]必须定位实体`)
    const eligible = new Set(demands[metricNumber - 1]!.eligibleEntityKeys)
    const targetEntityKeys = entry.targetEntityKeys.map((key, keyIndex) => text(key, `findings[${index}].targetEntityKeys[${keyIndex}]`, 200))
    if (targetEntityKeys.some(key => !eligible.has(key)) || new Set(targetEntityKeys).size !== targetEntityKeys.length) fail(`findings[${index}]引用未知或重复实体`)
    return {
      metricNumber, summary: text(entry.summary, `findings[${index}].summary`, 1_000),
      evidence: text(entry.evidence, `findings[${index}].evidence`, 2_000), targetEntityKeys,
      instruction: text(entry.instruction, `findings[${index}].instruction`, 1_000),
    }
  })
  const findingMetrics = new Set(findings.map(item => item.metricNumber))
  if (scores.some(item => item.score < ADVISORY_THRESHOLD && !findingMetrics.has(item.metricNumber))) fail('低于85分的指标必须提供可定位修复项')
  if (findings.some(item => scores[item.metricNumber - 1]!.score >= ADVISORY_THRESHOLD)) fail('高分指标不得制造无依据修复项')
  return { scores, findings }
}

function buildFindings(draft: ReviewDraftV1, demands: ReviewMetricDemandV1[], kind: 'balance' | 'semantic'): TextOpenWorldReviewFindingV1[] {
  return draft.findings.map((finding, index) => {
    const demand = demands[finding.metricNumber - 1]!
    const score = draft.scores[finding.metricNumber - 1]!.score
    return {
      key: `review.${kind}.finding.${String(index + 1).padStart(3, '0')}`,
      metricKey: demand.metricKey, severity: score < REVIEW_THRESHOLD ? 'blocking' : 'advisory', score,
      summary: finding.summary, evidence: finding.evidence, targetArtifactKey: demand.targetArtifactKey,
      targetEntityKeys: finding.targetEntityKeys,
      repair: {
        targetTaskKey: demand.targetTaskKey, mode: 'new-build-bounded-local-repair', instruction: finding.instruction,
        staleTaskKeys: descendants(demand.targetTaskKey), mutatesAcceptedArtifact: false,
      },
    }
  })
}

async function createBalanceArtifact(
  context: TextOpenWorldBalanceReviewInputContextV1,
  draft: ReviewDraftV1,
  createdAt: number,
): Promise<TextOpenWorldBalanceReviewV1> {
  const hash = (key: TextOpenWorldProductionArtifactKindV1) => context.artifactHashes.find(item => item.artifactKey === key)?.payloadHash ?? fail(`缺少Hash:${key}`)
  const minimumScore = Math.min(...draft.scores.map(item => item.score))
  const body: Omit<TextOpenWorldBalanceReviewV1, 'balanceReviewHash'> = {
    schema: 'storyforge.text-open-world-balance-review', version: 1, productType: 'text-open-world', productInstanceKey: context.productInstanceKey,
    progressionCatalogsHash: hash('text-open-world.progression-catalogs'), enemyEncounterCatalogHash: hash('text-open-world.enemy-encounter-catalog'),
    itemRewardCatalogHash: hash('text-open-world.item-reward-catalog'), craftingEconomyCatalogHash: hash('text-open-world.crafting-economy-catalog'),
    questDesignDocumentsHash: hash('text-open-world.quest-design-documents'), contentBudgetHash: context.contentBudget.contentBudgetHash,
    deterministicPreflightHash: context.preflight.deterministicPreflightHash,
    scores: draft.scores.map((score, index) => ({ metricKey: BALANCE_METRICS[index]!, score: score.score, rationale: score.rationale })),
    findings: buildFindings(draft, context.metricDemands, 'balance'), verdict: minimumScore >= REVIEW_THRESHOLD ? 'pass' : 'repair-required',
    threshold: REVIEW_THRESHOLD, minimumScore,
    governance: { modelReviewsSemanticsOnly: true, deterministicFactsNotOverridden: true, acceptedArtifactsNeverMutated: true, repairCreatesNewBuild: true, impactClosureCodeOwned: true },
    basisHash: context.contextSelectionHash, createdAt,
  }
  return { ...body, balanceReviewHash: await hashProductProductionValueV2(body) }
}

async function createSemanticArtifact(
  context: TextOpenWorldSemanticReviewInputContextV1,
  draft: ReviewDraftV1,
  createdAt: number,
): Promise<TextOpenWorldSemanticReviewV1> {
  const hash = (key: TextOpenWorldProductionArtifactKindV1) => context.artifactHashes.find(item => item.artifactKey === key)?.payloadHash ?? fail(`缺少Hash:${key}`)
  const minimumScore = Math.min(...draft.scores.map(item => item.score))
  const body: Omit<TextOpenWorldSemanticReviewV1, 'semanticReviewHash'> = {
    schema: 'storyforge.text-open-world-semantic-review', version: 1, productType: 'text-open-world', productInstanceKey: context.productInstanceKey,
    storyArcHash: hash('text-open-world.story-arc'), mainlineThreadHash: hash('text-open-world.mainline-thread'),
    significantThreadsHash: hash('text-open-world.significant-threads'), regionNarrativePacksHash: hash('text-open-world.region-narrative-packs'),
    questDesignDocumentsHash: hash('text-open-world.quest-design-documents'), sceneScriptsHash: hash('text-open-world.scene-scripts'),
    contentBudgetHash: context.contentBudget.contentBudgetHash, deterministicPreflightHash: context.preflight.deterministicPreflightHash,
    scores: draft.scores.map((score, index) => ({ metricKey: SEMANTIC_METRICS[index]!, score: score.score, rationale: score.rationale })),
    findings: buildFindings(draft, context.metricDemands, 'semantic'), verdict: minimumScore >= REVIEW_THRESHOLD ? 'pass' : 'repair-required',
    threshold: REVIEW_THRESHOLD, minimumScore,
    governance: {
      modelReviewsSemanticsOnly: true, deterministicFactsNotOverridden: true, acceptedArtifactsNeverMutated: true,
      repairCreatesNewBuild: true, impactClosureCodeOwned: true, humanPlaytimeCalibrationStillRequired: true,
    },
    basisHash: context.contextSelectionHash, createdAt,
  }
  return { ...body, semanticReviewHash: await hashProductProductionValueV2(body) }
}

function draftFromReview(review: TextOpenWorldBalanceReviewV1 | TextOpenWorldSemanticReviewV1): ReviewDraftV1 {
  return {
    scores: review.scores.map((item, index) => ({ metricNumber: index + 1, score: item.score, rationale: item.rationale })),
    findings: review.findings.map(item => ({
      metricNumber: review.scores.findIndex(score => score.metricKey === item.metricKey) + 1,
      summary: item.summary, evidence: item.evidence, targetEntityKeys: item.targetEntityKeys, instruction: item.repair.instruction,
    })),
  }
}

export async function validateTextOpenWorldBalanceReviewV1(input: {
  artifact: TextOpenWorldBalanceReviewV1
  context: TextOpenWorldBalanceReviewInputContextV1 | string
}): Promise<TextOpenWorldBalanceReviewV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-balance-review' || input.artifact.version !== 1) fail('BalanceReview身份无效')
  await assertOwnHash(input.artifact as unknown as Record<string, unknown>, 'balanceReviewHash', 'BalanceReview')
  const context = await parseContext<TextOpenWorldBalanceReviewInputContextV1>(typeof input.context === 'string' ? input.context : canonicalProductProductionJsonV2(input.context), 'balance')
  const draft = parseDraft({ schema: 'storyforge.text-open-world-balance-review-draft', version: 1, ...draftFromReview(input.artifact) }, context.metricDemands, 'balance')
  const expected = await createBalanceArtifact(context, draft, input.artifact.createdAt)
  if (!same(expected, input.artifact)) fail('BalanceReview内容、影响闭包或Hash被篡改')
  return input.artifact
}

export async function validateTextOpenWorldSemanticReviewV1(input: {
  artifact: TextOpenWorldSemanticReviewV1
  context: TextOpenWorldSemanticReviewInputContextV1 | string
}): Promise<TextOpenWorldSemanticReviewV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-semantic-review' || input.artifact.version !== 1) fail('SemanticReview身份无效')
  await assertOwnHash(input.artifact as unknown as Record<string, unknown>, 'semanticReviewHash', 'SemanticReview')
  const context = await parseContext<TextOpenWorldSemanticReviewInputContextV1>(typeof input.context === 'string' ? input.context : canonicalProductProductionJsonV2(input.context), 'semantic')
  const draft = parseDraft({ schema: 'storyforge.text-open-world-semantic-review-draft', version: 1, ...draftFromReview(input.artifact) }, context.metricDemands, 'semantic')
  const expected = await createSemanticArtifact(context, draft, input.artifact.createdAt)
  if (!same(expected, input.artifact)) fail('SemanticReview内容、影响闭包或Hash被篡改')
  return input.artifact
}

function prompts(context: TextOpenWorldBalanceReviewInputContextV1 | TextOpenWorldSemanticReviewInputContextV1, kind: 'balance' | 'semantic') {
  return {
    system: [
      `你是StoryForge文字开放世界的${kind === 'balance' ? '游戏平衡' : '叙事语义'}评审员。只能返回JSON。`,
      '确定性预检已经完成；不得推翻代码证明、修改Artifact、虚构来源或把审美判断伪装成硬规则。',
      '按全部metricDemands独立给0到100整数分。低于85分必须给可定位finding，高于等于85分不得制造finding。',
      'finding只能引用该metricDemand.eligibleEntityKeys中的实体；代码将决定目标Artifact、修复任务和stale传播闭包。',
      '低于70分意味着本次评审不通过并进入新Build局部修复；证据必须具体指出当前内容中的问题。',
    ].join('\n'),
    user: [
      `按metricDemands输出${context.metricDemands.length}项scores：metricNumber/score/rationale。`,
      'findings输出metricNumber/summary/evidence/targetEntityKeys/instruction，不要输出Artifact、task或stale清单。',
      `返回：{"schema":"storyforge.text-open-world-${kind}-review-draft","version":1,"scores":[{"metricNumber":1,"score":88,"rationale":"..."}],"findings":[]}`,
    ].join('\n'),
  }
}

async function defaultRunner(input: Parameters<TextOpenWorldQualityReviewModelRunnerV1>[0]): Promise<TextOpenWorldQualityReviewModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `<quality-review-input>\n${input.contextText}\n</quality-review-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

function createReviewExecutor(kind: 'balance' | 'semantic', options: { runModel?: TextOpenWorldQualityReviewModelRunnerV1; now?: () => number }): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultRunner; const now = options.now ?? Date.now
  const skillId = kind === 'balance' ? BALANCE_SKILL_ID : SEMANTIC_SKILL_ID
  const taskKey = kind === 'balance' ? 'v2.balance-review' : 'v2.semantic-review'
  const outputKey = kind === 'balance' ? 'text-open-world.balance-review' : 'text-open-world.semantic-review'
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== taskKey || execution.task.skillId !== skillId || execution.task.executionMode !== 'model') fail(`${kind}评审执行器收到错误任务`)
    if (!same(execution.task.outputArtifactKeys, [outputKey]) || execution.task.capabilityRequirementKeys.length !== 1) fail(`${kind}评审输出或capability不精确`)
    const requirementKey = execution.task.capabilityRequirementKeys[0]!
    const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey) ?? fail(`${kind}评审缺少capability binding`)
    const context = kind === 'balance'
      ? await parseContext<TextOpenWorldBalanceReviewInputContextV1>(execution.contextText, kind)
      : await parseContext<TextOpenWorldSemanticReviewInputContextV1>(execution.contextText, kind)
    const prompt = prompts(context, kind); const started = performance.now()
    const model = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: skillId,
      system: `${prompt.system}\n${prompt.user}`, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(16_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (model.bindingReceipt.capabilityHash !== binding.bindingHash) fail(`${kind}评审capability与Plan不一致`)
    const draft = parseDraft(parseProductionModelJsonObjectV1(model.output, `text-open-world-${kind}-review`), context.metricDemands, kind)
    const createdAt = integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER)
    const artifact = kind === 'balance'
      ? await createBalanceArtifact(context as TextOpenWorldBalanceReviewInputContextV1, draft, createdAt)
      : await createSemanticArtifact(context as TextOpenWorldSemanticReviewInputContextV1, draft, createdAt)
    if (kind === 'balance') await validateTextOpenWorldBalanceReviewV1({ artifact: artifact as TextOpenWorldBalanceReviewV1, context: context as TextOpenWorldBalanceReviewInputContextV1 })
    else await validateTextOpenWorldSemanticReviewV1({ artifact: artifact as TextOpenWorldSemanticReviewV1, context: context as TextOpenWorldSemanticReviewInputContextV1 })
    if (artifact.verdict !== 'pass') {
      const blocking = artifact.findings.filter(item => item.severity === 'blocking').map(item => ({
        metricKey: item.metricKey, targetArtifactKey: item.targetArtifactKey, targetEntityKeys: item.targetEntityKeys,
        targetTaskKey: item.repair.targetTaskKey, staleTaskKeys: item.repair.staleTaskKeys,
      }))
      fail(`${kind}评审要求新Build局部修复:${canonicalProductProductionJsonV2(blocking)}`)
    }
    return {
      artifacts: [{
        artifactKey: outputKey, kind: outputKey, payload: artifact,
        quality: { verdict: artifact.verdict, minimumScore: artifact.minimumScore, advisoryFindingCount: artifact.findings.length },
        rights: { reviewDoesNotCopySource: true },
      }],
      usage: {
        modelCalls: 1, inputTokens: model.usage?.inputTokens ?? estimateTokens(prompt.system + prompt.user + execution.contextText),
        outputTokens: model.usage?.outputTokens ?? estimateTokens(model.output), mediaCalls: 0, costUsd: null,
        durationMs: Math.max(0, Math.round(performance.now() - started)), storageBytes: 0,
      },
      passedGateIds: [...execution.task.acceptanceGateIds],
    } satisfies ProductProductionTaskExecutionResultV1
  }
}

export function createTextOpenWorldBalanceReviewExecutorV1(options: { runModel?: TextOpenWorldQualityReviewModelRunnerV1; now?: () => number } = {}): ProductProductionTaskExecutorV1 {
  return createReviewExecutor('balance', options)
}

export function createTextOpenWorldSemanticReviewExecutorV1(options: { runModel?: TextOpenWorldQualityReviewModelRunnerV1; now?: () => number } = {}): ProductProductionTaskExecutorV1 {
  return createReviewExecutor('semantic', options)
}
