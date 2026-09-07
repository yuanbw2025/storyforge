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
import { assertRecordInScope } from '../workspace/scope'

const SKILL_ID = 'text-open-world.production.quest-finalize.v1'
const MAX_CONTEXT_CHARS = 700_000
const TRIGGERS = ['arrival', 'explore', 'talk', 'rest', 'quest-complete', 'time-batch', 'activity'] as const
type TriggerKind = typeof TRIGGERS[number]
type DirectorKind = TextOpenWorldDirectorDecksV1['randomEvents'][number]['kind']

interface ObjectiveBindingDemandV1 {
  objectiveNumber: number
  objectiveKey: string
}

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
  contextSelectionHash: string
}

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

async function validateUpstream(context: Omit<TextOpenWorldQuestFinalizeInputContextV1, 'contextSelectionHash'>): Promise<void> {
  if (context.questLifecycleContract !== undefined && context.questLifecycleContract !== 'governed-v16') {
    fail('Quest生命周期生产合同无效')
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
    ...base, objectiveBindingDemands: buildObjectiveDemands(base), questLifecycleContract: 'governed-v16',
  }
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
  exactKeys(root, ['schema', 'version', 'quests', 'objectives', 'decks', 'templates', 'randomEvents'], 'draft')
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
  return { quests, objectives, decks, templates, randomEvents }
}

function action(input: Partial<TextOpenWorldActionDefinitionV1> & Pick<TextOpenWorldActionDefinitionV1, 'key' | 'category' | 'label' | 'description'>): TextOpenWorldActionDefinitionV1 {
  return {
    actorScope: 'player', targetScope: 'none', locationKeys: [], requirementConditionKeys: [], costEffectKeys: [],
    successEffectKeys: [], failureEffectKeys: [], timeCostMinutes: 0, confirmationPolicy: 'never', repeatPolicy: 'repeatable', cooldownMinutes: null,
    ...input,
  }
}

function questUnlockCondition(input: {
  quest: TextOpenWorldQuestSkeletonsV1['quests'][number]
  context: TextOpenWorldQuestFinalizeInputContextV1
}): TextOpenWorldConditionDefinitionV1 | null {
  if (input.quest.type === 'mainline') {
    const mainQuests = input.context.questSkeletons.quests.filter(quest => quest.type === 'mainline')
    const index = mainQuests.findIndex(quest => quest.key === input.quest.key)
    if (index <= 0) return null
    return {
      key: `condition.unlock.${input.quest.key}`,
      expression: { op: 'quest-status', questKey: mainQuests[index - 1]!.key, statuses: ['completed'] },
      failureMessage: '需要先完成上一项主线任务。',
    }
  }
  if (input.quest.type === 'significant') {
    const sourceStage = input.context.significantThreads.stages.find(stage => stage.key === input.quest.source.sourceKey)
    const thread = sourceStage ? input.context.significantThreads.threads.find(item => item.key === sourceStage.threadKey) : null
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

async function createArtifacts(input: {
  context: TextOpenWorldQuestFinalizeInputContextV1
  draft: QuestFinalizeDraftV1
  createdAt: number
  lifecycleContract?: 'legacy' | 'governed-v16'
}): Promise<TextOpenWorldQuestFinalizeArtifactsV1> {
  const governedLifecycle = input.lifecycleContract !== 'legacy'
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
      if (skill.kind !== 'attack') {
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
    let useActionKey: string | null = null; let equipActionKey: string | null = null; let unequipActionKey: string | null = null
    const itemEffectKeys: string[] = []
    if (item.consumable) {
      useActionKey = `action.use.${item.key}`
      const consume = `effect.use.${item.key}.consume`; const restore = `effect.use.${item.key}.restore`
      addEffect({ key: consume, operation: 'remove-item', payload: { itemKey: item.key, quantity: 1, reason: 'consume' } })
      addEffect({ key: restore, operation: 'change-player-resource', payload: { resource: 'health', amount: 10 } })
      itemEffectKeys.push(restore)
      addAction(action({ key: useActionKey, category: 'use', label: `使用${item.title}`, description: item.description, targetScope: 'item', costEffectKeys: [consume], successEffectKeys: [restore] }))
      const marker = `effect.combat.item.${item.key}`
      addEffect({ key: marker, operation: 'perform-combat-action', payload: { kind: 'item', skillKey: null, itemKey: item.key } })
      addAction(action({ key: `action.combat.item.${item.key}`, category: 'combat-item', label: `战斗中使用${item.title}`, description: item.description, targetScope: 'item', costEffectKeys: [consume], successEffectKeys: [...itemEffectKeys, marker] }))
    }
    if (item.kind === 'equipment') {
      equipActionKey = `action.equip.${item.key}`; unequipActionKey = `action.unequip.${item.key}`
      const equip = `effect.equip.${item.key}`; const unequip = `effect.unequip.${item.key}`
      addEffect({ key: equip, operation: 'equip-item', payload: { itemKey: item.key } })
      addEffect({ key: unequip, operation: 'unequip-item', payload: { itemKey: item.key } })
      addAction(action({ key: equipActionKey, category: 'equip', label: `装备${item.title}`, description: item.description, targetScope: 'item', successEffectKeys: [equip] }))
      addAction(action({ key: unequipActionKey, category: 'unequip', label: `卸下${item.title}`, description: item.description, targetScope: 'item', successEffectKeys: [unequip] }))
    }
    return { itemKey: item.key, useActionKey, equipActionKey, unequipActionKey, equipConditionKeys: [], effectKeys: itemEffectKeys }
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
    addAction(action({ key: actionKey, category: 'quest-action', label: final ? `完成${quest.title}` : `推进${quest.title}`, description: stage.completionIntent, actorScope: 'system', targetScope: 'quest', requirementConditionKeys: completionConditionKeys, successEffectKeys: [effectKey] }))
    stageRows.push({ key: stage.key, questKey: stage.questKey, order: stage.order, title: stage.title, objectiveKeys: stage.objectiveKeys, completionConditionKeys, completionActionKey: actionKey })
  })

  input.context.questSkeletons.quests.forEach((quest, index) => {
    const draft = input.draft.quests[index]!
    const unlock = questUnlockCondition({ quest, context: input.context })
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
      initialStatus: quest.type === 'template' ? 'locked' : quest.type === 'mainline' && index === 0 ? 'revealed' : quest.type === 'ordinary' ? 'available' : 'locked',
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
  const endingRouteBindings: TextOpenWorldQuestDesignDocumentsV1['endingBindings']['routes'] = endingRoutes.map(route => {
    const conditionKey = `condition.ending.${route.endingKey}`
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
    addEffect({ key: routeEffectKey, operation: 'set-world-flag', payload: { flagKey: 'flag.ending.route', value: route.endingKey } })
    addEffect({ key: unlockEffectKey, operation: 'unlock-ending', payload: { endingKey: route.endingKey } })
    addEffect({ key: reachEffectKey, operation: 'reach-ending', payload: { endingKey: route.endingKey } })
    addAction(action({
      key: actionKey, category: 'quest-action', label: `走向结局：${route.decisivePlayerValue}`,
      description: route.routeSummary, actorScope: 'player', targetScope: 'none',
      locationKeys: [finalLocationKey], requirementConditionKeys: [selectionReadyConditionKey],
      successEffectKeys: [routeEffectKey, unlockEffectKey, reachEffectKey],
      confirmationPolicy: 'always', repeatPolicy: 'once',
    }))
    return { endingKey: route.endingKey, conditionKey, actionKey, routeEffectKey, unlockEffectKey, reachEffectKey }
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
  const randomEvents = randomSeeds.map(({ pack, seed }, index) => {
    const draft = input.draft.randomEvents[index]!
    const regionEncounter = input.context.enemyEncounterCatalog.encounters.find(encounter => encounter.regionKey === pack.regionKey)
    const actionKeys = draft.kind === 'encounter' && regionEncounter ? [`action.start.${regionEncounter.key}`] : []
    const effectKeys = randomEventEffectKeys[index]!
    return {
      key: `event.director.${String(index + 1).padStart(3, '0')}`, sourceSeedKey: seed.key,
      title: seed.title, description: draft.description, kind: draft.kind, regionKeys: [pack.regionKey], locationKeys: seed.locationKeys,
      actionKeys, effectKeys, conditionKeys: [], fingerprint: `fingerprint.event.${String(index + 1).padStart(3, '0')}`,
      rumorRequirementKey: draft.kind === 'clue' ? `rumor-requirement.${seed.key}` : null,
      upgradeTemplateKey: draft.upgradeTemplateNumber === null ? null : templates[draft.upgradeTemplateNumber - 1]!.key,
      intensity: draft.intensity, weight: draft.weight, cooldownMinutes: draft.cooldownMinutes,
    }
  })
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
      randomEventSeedKeys: randomSeeds.map(row => row.seed.key), coveredRandomEventSeedKeys: randomEvents.map(event => event.sourceSeedKey),
      emptyPlayableDeckRegionKeys: [] as [],
    },
    governance: {
      regionalBudgetsBounded: true, protectedStoriesExcluded: true, mainlinePressureDisabled: true,
      duplicateFingerprintsRejected: true, highIntensityStreakBounded: true, runtimeHistorySessionOwned: true,
      presentationVariantsDeferred: true, directorRuntimeReadyExceptPresentation: true,
    },
    basisHash: await hashProductProductionValueV2({
      questDesignDocumentsHash: questDesignDocuments.questDesignDocumentsHash,
      regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
      mapInteractionCatalogHash: input.context.mapInteractionCatalog.mapInteractionCatalogHash,
      deckRegions: decks.map(deck => deck.regionKey), eventSeedKeys: randomSeeds.map(row => row.seed.key),
    }), createdAt: input.createdAt,
  }
  assertDirectorArtifact(directorBody)
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
    const routeEffect = artifact.effects.find(item => item.key === binding.routeEffectKey)
    const unlockEffect = artifact.effects.find(item => item.key === binding.unlockEffectKey)
    const reachEffect = artifact.effects.find(item => item.key === binding.reachEffectKey)
    const endingAction = artifact.actions.find(item => item.key === binding.actionKey)
    if (canonicalProductProductionJsonV2(condition?.expression) !== canonicalProductProductionJsonV2({
      op: 'all', conditions: [
        { op: 'quest-status', questKey: finalQuest.key, statuses: ['completed'] },
        { op: 'world-flag', flagKey: 'flag.ending.route', value: binding.endingKey },
      ],
    })
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
      || !same(endingAction.requirementConditionKeys, [artifact.endingBindings.selectionReadyConditionKey])
      || canonicalProductProductionJsonV2(endingAction.successEffectKeys)
        !== canonicalProductProductionJsonV2([binding.routeEffectKey, binding.unlockEffectKey, binding.reachEffectKey])
      || endingAction.costEffectKeys.length || endingAction.failureEffectKeys.length
      || endingAction.confirmationPolicy !== 'always' || endingAction.repeatPolicy !== 'once') {
      fail(`结局运行绑定没有形成唯一Condition/Action/Effect闭环:${binding.endingKey}`)
    }
  })
}

function assertDirectorArtifact(artifact: Omit<TextOpenWorldDirectorDecksV1, 'directorDecksHash'>): void {
  if (!same(artifact.coverage.requiredRegionKeys, artifact.coverage.coveredRegionKeys)
    || !same(artifact.coverage.ordinaryQuestKeys, artifact.coverage.fixedQuestKeys)
    || !same(artifact.coverage.templateQuestKeys, artifact.coverage.coveredTemplateQuestKeys)
    || !same(artifact.coverage.randomEventSeedKeys, artifact.coverage.coveredRandomEventSeedKeys)
    || artifact.decks.some(deck => !deck.triggerKinds.length || deck.maximumActive > deck.maximumRevealed
      || (!deck.fixedQuestKeys.length && !deck.templateKeys.length && !deck.randomEventKeys.length))
    || new Set([...artifact.templates.map(item => item.fingerprint), ...artifact.randomEvents.map(item => item.fingerprint)]).size
      !== artifact.templates.length + artifact.randomEvents.length
    || artifact.randomEvents.some(event => (event.kind === 'quest-upgrade') !== (event.upgradeTemplateKey !== null))) {
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
      || event.conditionKeys.some(key => !conditionKeys.has(key)))) {
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

function draftFromArtifacts(artifacts: TextOpenWorldQuestFinalizeArtifactsV1): unknown {
  return {
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
    randomEvents: artifacts.directorDecks.randomEvents.map((event, index) => ({
      seedNumber: index + 1, description: event.description, kind: event.kind, intensity: event.intensity,
      weight: event.weight, cooldownMinutes: event.cooldownMinutes,
      upgradeTemplateNumber: event.upgradeTemplateKey === null ? null
        : artifacts.directorDecks.templates.findIndex(template => template.key === event.upgradeTemplateKey) + 1,
    })),
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
  const draft = parseDraft(draftFromArtifacts(input.artifacts), context)
  const lifecycleContract = context.questLifecycleContract ?? 'legacy'
  const expected = await createArtifacts({
    context, draft, createdAt: input.artifacts.questDesignDocuments.createdAt, lifecycleContract,
  })
  assertCrossArtifacts(input.artifacts)
  if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.artifacts)) fail('P8F Artifact固定引用、运行定义、预算或Hash被篡改')
  return input.artifacts
}

function prompts(context: TextOpenWorldQuestFinalizeInputContextV1) {
  const system = [
    '你是StoryForge文字开放世界的任务最终化与地区导演设计师。只能返回JSON。',
    '所有稳定键、目录引用、数值奖励、生命周期、Action、Condition和Effect由代码生成；你只写任务/目标可玩语义与有界发牌参数。',
    '主线与重要故事必须等待玩家、不可放弃或过期；不得用地点抵达作为唯一关键触发。随机事件不得阻断主线。',
  ].join('\n')
  const user = [
    '以下用户消息将提供已登记、已验签且字段精确的QuestFinalize输入合同。',
    `quests按${context.questSkeletons.quests.length}项顺序输出questNumber/description/tags；objectives按${context.objectiveBindingDemands.length}项顺序输出objectiveNumber/description/successDescription/timeCostMinutes(0-60)。`,
    `decks按${context.mapInteractionCatalog.regions.length}个地区顺序输出regionNumber、非空triggerKinds、maximumRevealed(1-4)、maximumActive(1-3且不大于revealed)、cooldownMinutes(60-1440)、blankWeight(1-100)。`,
    `templates按${context.questSkeletons.quests.filter(quest => quest.type === 'template').length}项顺序输出templateNumber/category/help|resource|exploration|conflict|mystery、intensity(1-6)、weight(1-100)、cooldownMinutes(60-10080)。`,
    `randomEvents按${context.regionNarrativePacks.packs.flatMap(pack => pack.randomEventSeeds).length}项顺序输出seedNumber/description/kind(atmosphere|resource|encounter|clue|quest-upgrade)/intensity/weight/cooldownMinutes/upgradeTemplateNumber；只有quest-upgrade必须且只能选择本地区模板编号。`,
    '不要输出敌人、物品、角色、地点、奖励、Action、Condition、Effect、Quest键或任何未要求字段。',
    '返回：{"schema":"storyforge.text-open-world-quest-finalize-draft","version":1,"quests":[...],"objectives":[...],"decks":[...],"templates":[...],"randomEvents":[...]}',
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
