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
  TextOpenWorldContentRequirementManifestV1,
  TextOpenWorldCraftingEconomyCatalogV1,
  TextOpenWorldGameplayRulesetSkeletonV1,
  TextOpenWorldItemRewardCatalogV1,
  TextOpenWorldQuestSkeletonsV1,
  TextOpenWorldRegionNarrativePacksV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { validateTextOpenWorldGameplayRulesetSkeletonV1 } from './gameplay-ruleset'

const SKILL_ID = 'text-open-world.production.crafting-economy-catalog.v1'
const MAX_CONTEXT_CHARS = 300_000
const RECIPE_CATEGORIES = ['consumable', 'equipment', 'tool', 'material'] as const

interface RecipeDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  demandKind: 'content-requirement' | 'region-baseline'
  requirementKey: string | null
  title: string
  description: string
  requestedTraits: string[]
  regionKey: string
  candidateLocationKeys: string[]
  candidateIngredientItemKeys: string[]
  candidateOutputItemKeys: string[]
  questObjectiveKeys: string[]
}

interface VendorDemandV1 {
  demandNumber: number
  sourceDemandKey: string
  demandKind: 'content-requirement' | 'region-baseline'
  requirementKey: string | null
  title: string
  description: string
  requestedTraits: string[]
  regionKey: string
  candidateLocationKeys: string[]
  actorRequirementKey: string
  questObjectiveKeys: string[]
}

interface QuestConsumerProjectionV1 {
  productInstanceKey: string
  questSkeletonsHash: string
  quests: Array<{ key: string; regionKeys: string[] }>
  objectives: Array<{ key: string; questKey: string }>
}

export interface TextOpenWorldCraftingEconomyInputContextV1 {
  schema: 'storyforge.text-open-world-crafting-economy-input'
  version: 1
  productInstanceKey: string
  gameplayRuleset: TextOpenWorldGameplayRulesetSkeletonV1
  regionNarrativePacks: TextOpenWorldRegionNarrativePacksV1
  questSkeletons: QuestConsumerProjectionV1
  contentRequirementManifest: TextOpenWorldContentRequirementManifestV1
  itemRewardCatalog: TextOpenWorldItemRewardCatalogV1
  recipeDemands: RecipeDemandV1[]
  vendorDemands: VendorDemandV1[]
  contextSelectionHash: string
}

export interface TextOpenWorldCraftingEconomyModelExecutionV1 {
  output: string
  bindingReceipt: ProviderBindingReceiptV1
  usage: { inputTokens: number; outputTokens: number } | null
}

export type TextOpenWorldCraftingEconomyModelRunnerV1 = (input: {
  projectId: number
  requirementKey: string
  expectedCapabilityHash: string
  category: string
  system: string
  contextText: string
  maximumOutputTokens: number
  signal: AbortSignal
}) => Promise<TextOpenWorldCraftingEconomyModelExecutionV1>

interface CatalogDraftV1 {
  recipes: Array<{
    demandNumber: number
    title: string
    description: string
    category: typeof RECIPE_CATEGORIES[number]
    stationLocationNumber: number
    ingredientItemNumber: number
    outputItemNumber: number
  }>
  vendors: Array<{
    demandNumber: number
    title: string
    description: string
    locationNumber: number
    inventoryItemNumbers: number[]
  }>
}

function fail(message: string): never { throw new Error(`[text-open-world-crafting-economy] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`)
  return value as Record<string, unknown>
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  if (actual.length !== expected.length || expected.some((key, index) => key !== actual[index])) fail(`${label}字段不精确:${actual.join(',')}`)
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
function integerArray(value: unknown, label: string, maximum: number, itemMaximum: number): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) fail(`${label}必须是1到${maximum}项数组`)
  const result = value.map((item, index) => integer(item, `${label}[${index}]`, 1, itemMaximum))
  if (new Set(result).size !== result.length) fail(`${label}不得重复`)
  return result
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

function questForObjective(quests: QuestConsumerProjectionV1, objectiveKey: string) {
  const objective = quests.objectives.find(item => item.key === objectiveKey) ?? fail(`未知Objective:${objectiveKey}`)
  return quests.quests.find(item => item.key === objective.questKey) ?? fail(`Objective缺少Quest:${objectiveKey}`)
}

function regionForRequirement(input: {
  requirement: TextOpenWorldContentRequirementManifestV1['requirements'][number]
  quests: QuestConsumerProjectionV1
  packs: TextOpenWorldRegionNarrativePacksV1
}) {
  const objectiveKeys = input.requirement.consumerRefs.filter(ref => ref.kind === 'quest-objective').map(ref => ref.consumerKey)
  const quest = objectiveKeys.length ? questForObjective(input.quests, objectiveKeys[0]!) : null
  const regionKey = quest?.regionKeys[0] ?? input.packs.packs[0]?.regionKey ?? fail('没有可用地区')
  const pack = input.packs.packs.find(item => item.regionKey === regionKey) ?? fail(`需求引用未知地区:${regionKey}`)
  return { objectiveKeys, pack }
}

function sourceKindsForItem(catalog: TextOpenWorldItemRewardCatalogV1, itemKey: string): Array<'initial' | 'reward' | 'drop'> {
  const kinds: Array<'initial' | 'reward' | 'drop'> = []
  if (catalog.coverage.coveredPlayerItemKeys.includes(itemKey)) kinds.push('initial')
  if (catalog.rewardContracts.some(reward => reward.grants.items.some(item => item.itemKey === itemKey))) kinds.push('reward')
  if (catalog.dropTables.some(table => table.entries.some(item => item.itemKey === itemKey))) kinds.push('drop')
  return kinds
}

function buildDemands(input: {
  packs: TextOpenWorldRegionNarrativePacksV1
  quests: QuestConsumerProjectionV1
  manifest: TextOpenWorldContentRequirementManifestV1
  itemCatalog: TextOpenWorldItemRewardCatalogV1
}): { recipeDemands: RecipeDemandV1[]; vendorDemands: VendorDemandV1[] } {
  const sourceableItems = input.itemCatalog.items.filter(item => !item.critical && sourceKindsForItem(input.itemCatalog, item.key).length > 0)
  const ingredients = sourceableItems.filter(item => item.kind === 'material').concat(sourceableItems.filter(item => item.kind !== 'material'))
  const outputs = sourceableItems.filter(item => item.kind !== 'quest' && item.key !== 'item.player.starter-weapon')
  if (!ingredients.length || !outputs.length) fail('配方目录没有可验证来源的原料或合法产物')
  const recipeDemands: RecipeDemandV1[] = []
  const vendorDemands: VendorDemandV1[] = []
  input.manifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.crafting-economy').forEach(requirement => {
    if ((requirement.kind !== 'recipe' && requirement.kind !== 'vendor') || requirement.sourceReservationKey !== null
      || requirement.binding.status !== 'catalog-unbound' || requirement.binding.definitionKeys.length) fail(`经济目录收到非法需求:${requirement.key}`)
    const { objectiveKeys, pack } = regionForRequirement({ requirement, quests: input.quests, packs: input.packs })
    for (let index = 0; index < requirement.minimumCount; index += 1) {
      if (requirement.kind === 'recipe') recipeDemands.push({
        demandNumber: recipeDemands.length + 1,
        sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
        demandKind: 'content-requirement', requirementKey: requirement.key,
        title: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
        description: requirement.description, requestedTraits: requirement.requestedTraits,
        regionKey: pack.regionKey,
        candidateLocationKeys: pack.locationPlans.filter(plan => plan.requiredFunctions.includes('crafting')).map(plan => plan.locationKey)
          .concat(pack.locationPlans.map(plan => plan.locationKey)).filter((key, position, all) => all.indexOf(key) === position),
        candidateIngredientItemKeys: ingredients.map(item => item.key), candidateOutputItemKeys: outputs.map(item => item.key),
        questObjectiveKeys: objectiveKeys,
      })
      else vendorDemands.push({
        demandNumber: vendorDemands.length + 1,
        sourceDemandKey: `${requirement.key}.${String(index + 1).padStart(3, '0')}`,
        demandKind: 'content-requirement', requirementKey: requirement.key,
        title: requirement.minimumCount === 1 ? requirement.title : `${requirement.title} ${index + 1}`,
        description: requirement.description, requestedTraits: requirement.requestedTraits,
        regionKey: pack.regionKey,
        candidateLocationKeys: pack.locationPlans.filter(plan => plan.requiredFunctions.includes('service')).map(plan => plan.locationKey)
          .concat(pack.locationPlans.map(plan => plan.locationKey)).filter((key, position, all) => all.indexOf(key) === position),
        actorRequirementKey: `actor.vendor.${pack.regionKey}.${String(vendorDemands.length + 1).padStart(3, '0')}`,
        questObjectiveKeys: objectiveKeys,
      })
    }
  })
  input.packs.packs.forEach(pack => {
    const candidateLocationKeys = pack.locationPlans.filter(plan => plan.requiredFunctions.includes('crafting')).map(plan => plan.locationKey)
      .concat(pack.locationPlans.map(plan => plan.locationKey)).filter((key, position, all) => all.indexOf(key) === position)
    recipeDemands.push({
      demandNumber: recipeDemands.length + 1, sourceDemandKey: `region-recipe.${pack.regionKey}`,
      demandKind: 'region-baseline', requirementKey: null, title: `${pack.identity.title}基础配方`,
      description: `以${pack.identity.dailyLifeBaseline}为背景，提供可重复获得、可消费的地区基础制作循环。`,
      requestedTraits: [pack.identity.fantasy, '地区材料', '基础制作'], regionKey: pack.regionKey,
      candidateLocationKeys, candidateIngredientItemKeys: ingredients.map(item => item.key),
      candidateOutputItemKeys: outputs.map(item => item.key), questObjectiveKeys: [],
    })
    vendorDemands.push({
      demandNumber: vendorDemands.length + 1, sourceDemandKey: `region-vendor.${pack.regionKey}`,
      demandKind: 'region-baseline', requirementKey: null, title: `${pack.identity.title}基础商店`,
      description: `为${pack.identity.title}提供不依赖关键剧情的基础买卖服务。`,
      requestedTraits: [pack.identity.dailyLifeBaseline, '普通商品无限', '特殊商品限量'], regionKey: pack.regionKey,
      candidateLocationKeys: pack.locationPlans.filter(plan => plan.requiredFunctions.includes('service')).map(plan => plan.locationKey)
        .concat(pack.locationPlans.map(plan => plan.locationKey)).filter((key, position, all) => all.indexOf(key) === position),
      actorRequirementKey: `actor.vendor.${pack.regionKey}.baseline`, questObjectiveKeys: [],
    })
  })
  if (recipeDemands.length > 80 || vendorDemands.length > 80) fail('配方或商店需求超过单Build首版上限80')
  return { recipeDemands, vendorDemands }
}

async function validateUpstream(context: Omit<TextOpenWorldCraftingEconomyInputContextV1, 'contextSelectionHash'>): Promise<void> {
  const { gameplayRuleset, regionNarrativePacks, questSkeletons, contentRequirementManifest, itemRewardCatalog } = context
  await validateTextOpenWorldGameplayRulesetSkeletonV1({ artifact: gameplayRuleset })
  for (const [value, hashKey, label] of [
    [regionNarrativePacks, 'regionNarrativePacksHash', 'RegionNarrativePacks'],
    [contentRequirementManifest, 'contentRequirementManifestHash', 'Manifest'],
    [itemRewardCatalog, 'itemRewardCatalogHash', 'ItemRewardCatalog'],
  ] as const) await assertOwnHash(value as unknown as Record<string, unknown>, hashKey, label)
  if ([gameplayRuleset, regionNarrativePacks, questSkeletons, contentRequirementManifest, itemRewardCatalog]
    .some(value => value.productInstanceKey !== context.productInstanceKey)
    || contentRequirementManifest.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || itemRewardCatalog.questSkeletonsHash !== questSkeletons.questSkeletonsHash
    || itemRewardCatalog.contentRequirementManifestHash !== contentRequirementManifest.contentRequirementManifestHash
    || itemRewardCatalog.governance.everyItemHasSourcePlan !== true
    || gameplayRuleset.crafting.successPolicy !== 'guaranteed'
    || gameplayRuleset.economy.currencyModel !== 'single') fail('Crafting/Economy上游身份、引用或规则边界无效')
  const demands = buildDemands({ packs: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest, itemCatalog: itemRewardCatalog })
  if (canonicalProductProductionJsonV2(demands.recipeDemands) !== canonicalProductProductionJsonV2(context.recipeDemands)
    || canonicalProductProductionJsonV2(demands.vendorDemands) !== canonicalProductProductionJsonV2(context.vendorDemands)) fail('recipe/vendor demands不是上游确定性投影')
}

async function loadContext(input: { scope: WorkspaceScope; productionId: number; buildId: number }): Promise<TextOpenWorldCraftingEconomyInputContextV1> {
  const [production, build, rows] = await Promise.all([
    db.productProductions.get(input.productionId), db.productBuilds.get(input.buildId), readAcceptedBuildArtifacts({ scope: input.scope, buildId: input.buildId }),
  ])
  if (!production || production.productType !== 'text-open-world'
    || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('Production不存在、跨Work或类型错误')
  if (!build || build.productionId !== production.id
    || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('Build不属于当前Production/Work')
  const keys = [
    'text-open-world.gameplay-ruleset-skeleton', 'text-open-world.region-narrative-packs',
    'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest', 'text-open-world.item-reward-catalog',
  ] as const
  const rowsByKey = Object.fromEntries(keys.map(key => [key, unique(rows, key)])) as Record<typeof keys[number], ProductBuildArtifactRecordV1>
  const gameplayRuleset = artifact<TextOpenWorldGameplayRulesetSkeletonV1>(rowsByKey[keys[0]], keys[0])
  const regionNarrativePacks = artifact<TextOpenWorldRegionNarrativePacksV1>(rowsByKey[keys[1]], keys[1])
  const fullQuestSkeletons = artifact<TextOpenWorldQuestSkeletonsV1>(rowsByKey[keys[2]], keys[2])
  const contentRequirementManifest = artifact<TextOpenWorldContentRequirementManifestV1>(rowsByKey[keys[3]], keys[3])
  const itemRewardCatalog = artifact<TextOpenWorldItemRewardCatalogV1>(rowsByKey[keys[4]], keys[4])
  const payloads = [gameplayRuleset, regionNarrativePacks, fullQuestSkeletons, contentRequirementManifest, itemRewardCatalog]
  for (let index = 0; index < keys.length; index += 1) if (await hashProductProductionValueV2(payloads[index]) !== rowsByKey[keys[index]].contentHash) fail(`Artifact行Hash不匹配:${keys[index]}`)
  await assertOwnHash(fullQuestSkeletons as unknown as Record<string, unknown>, 'questSkeletonsHash', 'QuestSkeletons')
  const questSkeletons: QuestConsumerProjectionV1 = {
    productInstanceKey: fullQuestSkeletons.productInstanceKey,
    questSkeletonsHash: fullQuestSkeletons.questSkeletonsHash,
    quests: fullQuestSkeletons.quests.map(quest => ({ key: quest.key, regionKeys: quest.regionKeys })),
    objectives: fullQuestSkeletons.objectives.map(objective => ({ key: objective.key, questKey: objective.questKey })),
  }
  const demands = buildDemands({ packs: regionNarrativePacks, quests: questSkeletons, manifest: contentRequirementManifest, itemCatalog: itemRewardCatalog })
  const body: Omit<TextOpenWorldCraftingEconomyInputContextV1, 'contextSelectionHash'> = {
    schema: 'storyforge.text-open-world-crafting-economy-input', version: 1, productInstanceKey: production.productionKey,
    gameplayRuleset, regionNarrativePacks, questSkeletons, contentRequirementManifest, itemRewardCatalog, ...demands,
  }
  await validateUpstream(body)
  const context = { ...body, contextSelectionHash: await hashProductProductionValueV2(body) }
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Crafting/Economy Context超过硬上限')
  return context
}

export async function readTextOpenWorldCraftingEconomyInputContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.productProductionId) || !Number.isSafeInteger(input.productBuildId)) fail('Context读取缺少scope/production/build selector')
  return canonicalProductProductionJsonV2(await loadContext({ scope: input.scope, productionId: input.productProductionId!, buildId: input.productBuildId! }))
}

async function parseContext(value: string): Promise<TextOpenWorldCraftingEconomyInputContextV1> {
  let context: TextOpenWorldCraftingEconomyInputContextV1
  try { context = JSON.parse(value) as TextOpenWorldCraftingEconomyInputContextV1 } catch { return fail('Context JSON损坏') }
  if (context.schema !== 'storyforge.text-open-world-crafting-economy-input' || context.version !== 1) fail('Context身份无效')
  const { contextSelectionHash, ...body } = context; await validateUpstream(body)
  if (!isSha256Hash(contextSelectionHash) || await hashProductProductionValueV2(body) !== contextSelectionHash) fail('Context选择Hash不匹配')
  if (canonicalProductProductionJsonV2(context).length > MAX_CONTEXT_CHARS) fail('Context超过硬上限')
  return context
}

function parseDraft(value: unknown, context: TextOpenWorldCraftingEconomyInputContextV1): CatalogDraftV1 {
  const root = record(value, 'draft'); exactKeys(root, ['schema', 'version', 'recipes', 'vendors'], 'draft')
  if (root.schema !== 'storyforge.text-open-world-crafting-economy-draft' || root.version !== 1) fail('draft schema/version无效')
  if (!Array.isArray(root.recipes) || root.recipes.length !== context.recipeDemands.length) fail(`recipes必须与${context.recipeDemands.length}项需求一一对应`)
  const recipes = root.recipes.map((value, index) => {
    const row = record(value, `recipes[${index}]`)
    exactKeys(row, ['demandNumber', 'title', 'description', 'category', 'stationLocationNumber', 'ingredientItemNumber', 'outputItemNumber'], `recipes[${index}]`)
    const demandNumber = integer(row.demandNumber, `recipes[${index}].demandNumber`, 1, context.recipeDemands.length)
    const demand = context.recipeDemands[demandNumber - 1]!
    const ingredientItemNumber = integer(row.ingredientItemNumber, `recipes[${index}].ingredientItemNumber`, 1, demand.candidateIngredientItemKeys.length)
    const outputItemNumber = integer(row.outputItemNumber, `recipes[${index}].outputItemNumber`, 1, demand.candidateOutputItemKeys.length)
    const ingredientKey = demand.candidateIngredientItemKeys[ingredientItemNumber - 1]!
    const output = context.itemRewardCatalog.items.find(item => item.key === demand.candidateOutputItemKeys[outputItemNumber - 1])!
    const category = enumValue(row.category, RECIPE_CATEGORIES, `recipes[${index}].category`)
    const expectedCategory = output.kind === 'equipment' || output.kind === 'consumable' || output.kind === 'material'
      ? output.kind : 'tool'
    if (category !== expectedCategory) fail(`配方category必须匹配产物种类:${demand.sourceDemandKey}`)
    if (ingredientKey === output.key) fail(`配方不得把同一物品原样转换为自身:${demand.sourceDemandKey}`)
    return {
      demandNumber, title: text(row.title, `recipes[${index}].title`, 200), description: text(row.description, `recipes[${index}].description`),
      category,
      stationLocationNumber: integer(row.stationLocationNumber, `recipes[${index}].stationLocationNumber`, 1, demand.candidateLocationKeys.length),
      ingredientItemNumber,
      outputItemNumber,
    }
  })
  if (recipes.some((recipe, index) => recipe.demandNumber !== index + 1) || new Set(recipes.map(recipe => recipe.title.toLocaleLowerCase('zh-CN'))).size !== recipes.length) fail('recipes必须按序覆盖且标题不得重复')
  if (!Array.isArray(root.vendors) || root.vendors.length !== context.vendorDemands.length) fail(`vendors必须与${context.vendorDemands.length}项需求一一对应`)
  const vendors = root.vendors.map((value, index) => {
    const row = record(value, `vendors[${index}]`)
    exactKeys(row, ['demandNumber', 'title', 'description', 'locationNumber', 'inventoryItemNumbers'], `vendors[${index}]`)
    const demandNumber = integer(row.demandNumber, `vendors[${index}].demandNumber`, 1, context.vendorDemands.length)
    const demand = context.vendorDemands[demandNumber - 1]!
    return {
      demandNumber, title: text(row.title, `vendors[${index}].title`, 200), description: text(row.description, `vendors[${index}].description`),
      locationNumber: integer(row.locationNumber, `vendors[${index}].locationNumber`, 1, demand.candidateLocationKeys.length),
      inventoryItemNumbers: integerArray(row.inventoryItemNumbers, `vendors[${index}].inventoryItemNumbers`, 12, context.itemRewardCatalog.items.length),
    }
  })
  if (vendors.some((vendor, index) => vendor.demandNumber !== index + 1) || new Set(vendors.map(vendor => vendor.title.toLocaleLowerCase('zh-CN'))).size !== vendors.length) fail('vendors必须按序覆盖且标题不得重复')
  vendors.forEach((vendor, index) => vendor.inventoryItemNumbers.forEach(number => {
    const item = context.itemRewardCatalog.items[number - 1]!
    if (item.critical || !item.sellable) fail(`商店不得出售关键或不可交易物品:${context.vendorDemands[index]!.sourceDemandKey}`)
  }))
  return { recipes, vendors }
}

async function createArtifact(input: { context: TextOpenWorldCraftingEconomyInputContextV1; draft: CatalogDraftV1; createdAt: number }): Promise<TextOpenWorldCraftingEconomyCatalogV1> {
  const itemByKey = new Map(input.context.itemRewardCatalog.items.map(item => [item.key, item]))
  const recipes = input.draft.recipes.map((draft, index) => {
    const demand = input.context.recipeDemands[draft.demandNumber - 1]!
    const ingredient = itemByKey.get(demand.candidateIngredientItemKeys[draft.ingredientItemNumber - 1]!)!
    const output = itemByKey.get(demand.candidateOutputItemKeys[draft.outputItemNumber - 1]!)!
    const ingredientQuantity = Math.max(1, Math.ceil((output.baseValue * 5_000) / Math.max(1, ingredient.baseValue * 10_000)))
    return {
      key: `recipe.catalog.${String(index + 1).padStart(3, '0')}`, order: index + 1,
      sourceDemandKey: demand.sourceDemandKey, demandKind: demand.demandKind,
      title: draft.title, description: draft.description, category: draft.category,
      learnedByDefault: demand.demandKind === 'region-baseline', regionKey: demand.regionKey,
      stationLocationKeys: [demand.candidateLocationKeys[draft.stationLocationNumber - 1]!],
      ingredients: [{ itemKey: ingredient.key, quantity: ingredientQuantity }], outputs: [{ itemKey: output.key, quantity: 1 }],
      timeCostMinutes: draft.category === 'equipment' ? 60 : 30,
      fulfilledRequirementKeys: demand.requirementKey ? [demand.requirementKey] : [],
      runtimeBinding: {
        status: 'runtime-unbound' as const, requirementConditionKeys: [] as [], craftActionKey: null, learnActionKey: null,
        learnQuestKey: null, consumeEffectKeys: [] as [], outputEffectKeys: [] as [], presentationRefs: [] as [],
      },
    }
  })
  const ordinaryItems = input.context.itemRewardCatalog.items.filter(item => !item.critical && item.sellable)
  const vendors = input.draft.vendors.map((draft, index) => {
    const demand = input.context.vendorDemands[draft.demandNumber - 1]!
    const selected = draft.inventoryItemNumbers.map(number => input.context.itemRewardCatalog.items[number - 1]!)
    const inventory = [...selected, ...ordinaryItems].filter((item, position, all) => all.findIndex(candidate => candidate.key === item.key) === position)
    return {
      key: `vendor.catalog.${String(index + 1).padStart(3, '0')}`, order: index + 1,
      sourceDemandKey: demand.sourceDemandKey, demandKind: demand.demandKind,
      title: draft.title, description: draft.description, regionKey: demand.regionKey,
      locationKey: demand.candidateLocationKeys[draft.locationNumber - 1]!,
      buyPriceMultiplierBasisPoints: 10_000, sellPriceMultiplierBasisPoints: 5_000,
      buyCategories: ['equipment', 'consumable', 'material', 'misc'] as Array<'equipment' | 'consumable' | 'material' | 'misc'>,
      sellCategories: ['equipment', 'consumable', 'material', 'misc'] as Array<'equipment' | 'consumable' | 'material' | 'misc'>,
      inventoryEntries: inventory.map(item => ({
        itemKey: item.key, stockPolicy: item.kind === 'equipment' ? 'limited' as const : 'unlimited' as const,
        initialQuantity: item.kind === 'equipment' ? 1 : null,
      })),
      fulfilledRequirementKeys: demand.requirementKey ? [demand.requirementKey] : [],
      runtimeBinding: {
        status: 'runtime-unbound' as const, actorKey: null, actorRequirementKey: demand.actorRequirementKey,
        factionKey: null, availabilityConditionKeys: [] as [], buyActionKey: null, sellActionKey: null,
      },
    }
  })
  const itemFlows = input.context.itemRewardCatalog.items.map(item => {
    const sourceKinds: Array<'initial' | 'reward' | 'drop' | 'craft' | 'vendor'> = [...sourceKindsForItem(input.context.itemRewardCatalog, item.key)]
    if (recipes.some(recipe => recipe.outputs.some(output => output.itemKey === item.key))) sourceKinds.push('craft')
    if (vendors.some(vendor => vendor.inventoryEntries.some(entry => entry.itemKey === item.key))) sourceKinds.push('vendor')
    const sinkKinds: Array<'consume' | 'equip' | 'quest' | 'craft' | 'vendor-sale'> = []
    if (item.consumable) sinkKinds.push('consume')
    if (item.kind === 'equipment') sinkKinds.push('equip')
    if (item.critical || item.kind === 'quest') sinkKinds.push('quest')
    if (recipes.some(recipe => recipe.ingredients.some(ingredient => ingredient.itemKey === item.key))) sinkKinds.push('craft')
    if (item.sellable) sinkKinds.push('vendor-sale')
    return { itemKey: item.key, sourceKinds: [...new Set(sourceKinds)], sinkKinds: [...new Set(sinkKinds)] }
  })
  const recipeRequirements = input.context.contentRequirementManifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.crafting-economy' && requirement.kind === 'recipe').map(requirement => requirement.key)
  const vendorRequirements = input.context.contentRequirementManifest.requirements.filter(requirement => requirement.ownerTaskKey === 'p8.catalog.crafting-economy' && requirement.kind === 'vendor').map(requirement => requirement.key)
  const ingredientItemKeys = [...new Set(recipes.flatMap(recipe => recipe.ingredients.map(ingredient => ingredient.itemKey)))]
  const outputItemKeys = [...new Set(recipes.flatMap(recipe => recipe.outputs.map(output => output.itemKey)))]
  const riskFreeArbitrageRecipeKeys = recipes.filter(recipe => {
    const inputCost = recipe.ingredients.reduce((sum, ingredient) => sum + itemByKey.get(ingredient.itemKey)!.baseValue * ingredient.quantity * 10_000, 0)
    const outputProceeds = recipe.outputs.reduce((sum, output) => sum + itemByKey.get(output.itemKey)!.baseValue * output.quantity * 5_000, 0)
    return outputProceeds > inputCost
  }).map(recipe => recipe.key)
  const body: Omit<TextOpenWorldCraftingEconomyCatalogV1, 'craftingEconomyCatalogHash'> = {
    schema: 'storyforge.text-open-world-crafting-economy-catalog', version: 1, productType: 'text-open-world',
    productInstanceKey: input.context.productInstanceKey,
    gameplayRulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
    regionNarrativePacksHash: input.context.regionNarrativePacks.regionNarrativePacksHash,
    questSkeletonsHash: input.context.questSkeletons.questSkeletonsHash,
    contentRequirementManifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
    itemRewardCatalogHash: input.context.itemRewardCatalog.itemRewardCatalogHash,
    currency: input.context.gameplayRuleset.economy.currency,
    craftingRules: input.context.gameplayRuleset.crafting, economyRules: input.context.gameplayRuleset.economy,
    recipes, vendors, itemFlows,
    coverage: {
      requiredRecipeRequirementKeys: recipeRequirements,
      coveredRecipeRequirementKeys: [...new Set(recipes.flatMap(recipe => recipe.fulfilledRequirementKeys))],
      requiredVendorRequirementKeys: vendorRequirements,
      coveredVendorRequirementKeys: [...new Set(vendors.flatMap(vendor => vendor.fulfilledRequirementKeys))],
      requiredRegionKeys: input.context.regionNarrativePacks.packs.map(pack => pack.regionKey),
      regionsWithRecipe: [...new Set(recipes.map(recipe => recipe.regionKey))],
      regionsWithVendor: [...new Set(vendors.map(vendor => vendor.regionKey))],
      ingredientItemKeys,
      sourcedIngredientItemKeys: ingredientItemKeys.filter(key => itemFlows.find(flow => flow.itemKey === key)!.sourceKinds.some(kind => kind !== 'craft')),
      outputItemKeys,
      sinkedOutputItemKeys: outputItemKeys.filter(key => itemFlows.find(flow => flow.itemKey === key)!.sinkKinds.length > 0),
      riskFreeArbitrageRecipeKeys: riskFreeArbitrageRecipeKeys as [], uncoveredDemandKeys: [],
    },
    governance: {
      singleCurrency: true, guaranteedCrafting: true, recipeKnowledgeRequired: true,
      ordinaryStockUnlimited: true, specialStockLimited: true,
      quantityAndPriceOwner: 'deterministic-compiler', semanticSelectionOwner: 'model-validated',
      everyIngredientSourced: true, everyOutputHasSink: true, noRiskFreeArbitrage: true,
      allRuntimeBindingsUnbound: true, craftingEconomyModulesReady: false,
    },
    basisHash: await hashProductProductionValueV2({
      rulesetHash: input.context.gameplayRuleset.gameplayRulesetHash,
      manifestHash: input.context.contentRequirementManifest.contentRequirementManifestHash,
      itemCatalogHash: input.context.itemRewardCatalog.itemRewardCatalogHash,
      contextSelectionHash: input.context.contextSelectionHash,
      recipeDemandKeys: input.context.recipeDemands.map(demand => demand.sourceDemandKey),
      vendorDemandKeys: input.context.vendorDemands.map(demand => demand.sourceDemandKey),
    }),
    createdAt: input.createdAt,
  }
  if (!same(body.coverage.requiredRecipeRequirementKeys, body.coverage.coveredRecipeRequirementKeys)
    || !same(body.coverage.requiredVendorRequirementKeys, body.coverage.coveredVendorRequirementKeys)
    || !same(body.coverage.requiredRegionKeys, body.coverage.regionsWithRecipe)
    || !same(body.coverage.requiredRegionKeys, body.coverage.regionsWithVendor)
    || !same(body.coverage.ingredientItemKeys, body.coverage.sourcedIngredientItemKeys)
    || !same(body.coverage.outputItemKeys, body.coverage.sinkedOutputItemKeys)
    || riskFreeArbitrageRecipeKeys.length) fail('配方/商店需求、地区覆盖、来源/消耗或无风险套利没有闭合')
  return { ...body, craftingEconomyCatalogHash: await hashProductProductionValueV2(body) }
}

function draftFromArtifact(artifact: TextOpenWorldCraftingEconomyCatalogV1, context: TextOpenWorldCraftingEconomyInputContextV1): unknown {
  return {
    schema: 'storyforge.text-open-world-crafting-economy-draft', version: 1,
    recipes: artifact.recipes.map(recipe => {
      const demand = context.recipeDemands[recipe.order - 1]!
      return {
        demandNumber: recipe.order, title: recipe.title, description: recipe.description, category: recipe.category,
        stationLocationNumber: demand.candidateLocationKeys.indexOf(recipe.stationLocationKeys[0]!) + 1,
        ingredientItemNumber: demand.candidateIngredientItemKeys.indexOf(recipe.ingredients[0]!.itemKey) + 1,
        outputItemNumber: demand.candidateOutputItemKeys.indexOf(recipe.outputs[0]!.itemKey) + 1,
      }
    }),
    vendors: artifact.vendors.map(vendor => {
      const demand = context.vendorDemands[vendor.order - 1]!
      return {
        demandNumber: vendor.order, title: vendor.title, description: vendor.description,
        locationNumber: demand.candidateLocationKeys.indexOf(vendor.locationKey) + 1,
        inventoryItemNumbers: vendor.inventoryEntries.slice(0, 1)
          .map(entry => context.itemRewardCatalog.items.findIndex(item => item.key === entry.itemKey) + 1)
          .filter(number => number > 0),
      }
    }),
  }
}

export async function validateTextOpenWorldCraftingEconomyCatalogV1(input: {
  artifact: TextOpenWorldCraftingEconomyCatalogV1
  context: TextOpenWorldCraftingEconomyInputContextV1
}): Promise<TextOpenWorldCraftingEconomyCatalogV1> {
  if (input.artifact.schema !== 'storyforge.text-open-world-crafting-economy-catalog' || input.artifact.version !== 1
    || !isSha256Hash(input.artifact.craftingEconomyCatalogHash)) fail('CraftingEconomyCatalog身份或Hash字段无效')
  integer(input.artifact.createdAt, 'createdAt', 0, Number.MAX_SAFE_INTEGER)
  const context = await parseContext(canonicalProductProductionJsonV2(input.context))
  const draft = parseDraft(draftFromArtifact(input.artifact, context), context)
  const rebuilt = await createArtifact({ context, draft, createdAt: input.artifact.createdAt })
  if (canonicalProductProductionJsonV2(rebuilt) !== canonicalProductProductionJsonV2(input.artifact)) fail('配方、商店、价格、来源/消耗或运行绑定被篡改')
  return structuredClone(input.artifact)
}

export async function projectTextOpenWorldCraftingEconomyCatalogAuthorEditableDraftV1(input: {
  artifact: TextOpenWorldCraftingEconomyCatalogV1
  context: TextOpenWorldCraftingEconomyInputContextV1 | string
}): Promise<unknown> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const artifact = await validateTextOpenWorldCraftingEconomyCatalogV1({ artifact: input.artifact, context })
  return structuredClone(draftFromArtifact(artifact, context))
}

export async function rebuildTextOpenWorldCraftingEconomyCatalogFromAuthorEditableDraftV1(input: {
  baseArtifact: TextOpenWorldCraftingEconomyCatalogV1
  context: TextOpenWorldCraftingEconomyInputContextV1 | string
  draft: unknown
}): Promise<TextOpenWorldCraftingEconomyCatalogV1> {
  const context = await parseContext(typeof input.context === 'string'
    ? input.context
    : canonicalProductProductionJsonV2(input.context))
  const baseArtifact = await validateTextOpenWorldCraftingEconomyCatalogV1({ artifact: input.baseArtifact, context })
  const artifact = await createArtifact({
    context,
    draft: parseDraft(input.draft, context),
    createdAt: baseArtifact.createdAt,
  })
  return validateTextOpenWorldCraftingEconomyCatalogV1({ artifact, context })
}

function systemPrompt(context: TextOpenWorldCraftingEconomyInputContextV1): string {
  return [
    '你是StoryForge文字开放世界Crafting与Economy Catalog Designer。你只设计符合地区与任务语境的配方/商店语义，并从代码提供的候选地点和物品中选择；代码负责稳定键、数量、价格、库存、来源/消耗闭环、反套利与运行绑定。',
    `recipes共${context.recipeDemands.length}项、vendors共${context.vendorDemands.length}项，必须按demandNumber顺序精确覆盖。候选编号均从1开始，不得越界。`,
    'recipe的category必须匹配所选产物种类（misc对应tool），原料和产物不得是同一物品。商店inventoryItemNumbers选择1到12项非关键物品；代码会补齐普通货物。不得输出价格、数量、角色Key、Action、Effect、Condition、QuestKey、运行绑定或媒资。',
    '只输出字段精确的JSON：',
    '{"schema":"storyforge.text-open-world-crafting-economy-draft","version":1,"recipes":[{"demandNumber":1,"title":"...","description":"...","category":"consumable","stationLocationNumber":1,"ingredientItemNumber":1,"outputItemNumber":1}],"vendors":[{"demandNumber":1,"title":"...","description":"...","locationNumber":1,"inventoryItemNumbers":[1]}]}',
  ].join('\n')
}

async function defaultModelRunner(input: Parameters<TextOpenWorldCraftingEconomyModelRunnerV1>[0]): Promise<TextOpenWorldCraftingEconomyModelExecutionV1> {
  const result: ChatResult = {}
  const response = await runConfiguredProductionTextV1({
    projectId: input.projectId, requirementKey: input.requirementKey,
    expectedCapabilityHash: input.expectedCapabilityHash, category: input.category,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: `以下是已登记并验签的配方经济目录输入：\n<crafting-economy-input>\n${input.contextText}\n</crafting-economy-input>` }],
    maximumOutputTokens: input.maximumOutputTokens, signal: input.signal, result, responseFormat: 'json_object',
  })
  return { output: response.output, bindingReceipt: response.bindingReceipt, usage: result.usage ?? null }
}

export function createTextOpenWorldCraftingEconomyCatalogExecutorV1(options: {
  runModel?: TextOpenWorldCraftingEconomyModelRunnerV1
  now?: () => number
} = {}): ProductProductionTaskExecutorV1 {
  const runModel = options.runModel ?? defaultModelRunner; const now = options.now ?? Date.now
  return async execution => {
    if (execution.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (execution.task.taskKey !== 'p8.catalog.crafting-economy' || execution.task.skillId !== SKILL_ID || execution.task.executionMode !== 'model') fail('executor只接受P8 Crafting/Economy任务')
    if (canonicalProductProductionJsonV2(execution.task.outputArtifactKeys) !== canonicalProductProductionJsonV2(['text-open-world.crafting-economy-catalog'])) fail('Crafting/Economy输出Artifact集合不精确')
    if (execution.task.capabilityRequirementKeys.length !== 1) fail('Crafting/Economy需要唯一文本capability binding')
    const requirementKey = execution.task.capabilityRequirementKeys[0]!; const binding = execution.capabilityBindings.find(item => item.requirementKey === requirementKey)
    if (!binding) fail('Crafting/Economy缺少文本capability binding')
    const context = await parseContext(execution.contextText); const prompt = systemPrompt(context); const startedAt = performance.now()
    const response = await runModel({
      projectId: execution.scope.projectId, requirementKey, expectedCapabilityHash: binding.bindingHash,
      category: 'text-open-world.production.crafting-economy-catalog',
      system: prompt, contextText: execution.contextText,
      maximumOutputTokens: Math.max(1, Math.min(32_000, execution.task.budgetReservation.outputTokens)), signal: execution.signal,
    })
    if (response.bindingReceipt.capabilityHash !== binding.bindingHash) fail('执行时文本capability与Plan binding不一致')
    const draft = parseDraft(parseProductionModelJsonObjectV1(response.output, 'text-open-world-crafting-economy'), context)
    const artifact = await validateTextOpenWorldCraftingEconomyCatalogV1({
      artifact: await createArtifact({ context, draft, createdAt: integer(now(), 'createdAt', 0, Number.MAX_SAFE_INTEGER) }), context,
    })
    return {
      artifacts: [{
        artifactKey: 'text-open-world.crafting-economy-catalog', kind: 'text-open-world.crafting-economy-catalog', payload: artifact,
        quality: { recipeRequirementsCovered: true, vendorRequirementsCovered: true, everyIngredientSourced: true, everyOutputSinked: true, noRiskFreeArbitrage: true, runtimeBindingsUnbound: true },
        rights: { contentRequirementManifestHash: context.contentRequirementManifest.contentRequirementManifestHash },
      }],
      passedGateIds: [...execution.task.acceptanceGateIds],
      usage: {
        modelCalls: 1, inputTokens: response.usage?.inputTokens ?? estimateTokens(execution.contextText + prompt),
        outputTokens: response.usage?.outputTokens ?? estimateTokens(response.output), mediaCalls: 0, costUsd: null,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)), storageBytes: 0,
      },
    } satisfies ProductProductionTaskExecutionResultV1
  }
}
